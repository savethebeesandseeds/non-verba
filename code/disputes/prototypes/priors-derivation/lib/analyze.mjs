// SPDX-License-Identifier: AGPL-3.0-only
import { readFile, appendFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractContract, deduplicateContracts, deduplicateClauses } from './extract.mjs';
import { discover } from './discover.mjs';
import { createEmbedder } from './embed.mjs';
import { digest, sha256, readJSON, writeJSON, within, requireContainer, regularFile } from './common.mjs';

const prototypeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function sourceManifest() {
  const files = [];
  async function visit(directory, prefix = '') {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (['artifacts', 'node_modules', '.git'].includes(item.name)) continue;
      const relative = prefix + item.name; const path = resolve(directory, item.name);
      if (item.isSymbolicLink()) throw new Error('Linked prototype source is not admitted');
      if (item.isDirectory()) await visit(path, `${relative}/`);
      else if (item.isFile() && /\.(?:mjs|json|html|css|md|sh|ps1|txt)$/.test(item.name)) files.push({ path: relative, sha256: sha256(await readFile(path)) });
    }
  }
  await visit(prototypeRoot); files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, sha256: digest(files), base_revision: process.env.NONVERBA_SOURCE_REVISION ?? null, source_dirty: process.env.NONVERBA_SOURCE_DIRTY ?? null, snapshot_sha256: process.env.NONVERBA_SOURCE_SNAPSHOT_SHA256 ?? null };
}

export function partitionFamilies(families, seed, fraction = 0.2) {
  const ordered = [...families].sort((a, b) => digest([seed, a.id]).localeCompare(digest([seed, b.id])));
  const count = families.length < 2 ? 0 : Math.max(1, Math.floor(families.length * fraction));
  const holdout = new Set(ordered.slice(0, count).map(family => family.id));
  return new Map(families.map(family => [family.id, holdout.has(family.id) ? 'holdout' : 'fit']));
}

export function selectClauses(clauses, config, seed) {
  const groups = new Map();
  for (const clause of clauses) {
    if ((clause.segmentation?.word_count ?? clause.text.split(/\s+/).length) < config.minWords) continue;
    if (!groups.has(clause.contract_id)) groups.set(clause.contract_id, []);
    groups.get(clause.contract_id).push(clause);
  }
  const selected = [];
  for (const [id, group] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    group.sort((a, b) => digest([seed, id, a.sha256]).localeCompare(digest([seed, id, b.sha256])) || a.id.localeCompare(b.id));
    selected.push(...group.slice(0, config.max_clauses_per_contract));
  }
  // If the global bound is reached, round robin over contracts rather than prefix selection.
  const admitted = [];
  const pools = [...groups].sort((a,b) => digest([seed,a[0]]).localeCompare(digest([seed,b[0]]))).map(([,group])=>group.slice(0,config.max_clauses_per_contract));
  for(let rank=0;rank<config.max_clauses_per_contract && admitted.length<config.max_clauses;rank++) {
    for(const pool of pools) { if(pool[rank]) admitted.push(pool[rank]); if(admitted.length===config.max_clauses) break; }
  }
  const ids = new Set(admitted.map(clause => clause.id));
  return { admitted, excluded: clauses.filter(clause => !ids.has(clause.id)).map(clause => ({ id: clause.id, contract_id: clause.contract_id, reason: (clause.segmentation?.word_count ?? clause.text.split(/\s+/).length) < config.minWords ? 'below_discovery_minimum_retained_in_extraction' : 'seeded_per_contract_or_global_bound' })) };
}

export async function verifyAcquisition(runDir) {
  const acquisition = await readJSON(within(runDir, 'acquisition.json'));
  const checks = [];
  if (acquisition.config_sha256 && sha256(await readFile(within(runDir, 'config.json'))) !== acquisition.config_sha256) throw new Error('Frozen research configuration changed');
  for (const record of acquisition.source_records) {
    const path = within(runDir, record.path); await regularFile(path);
    if (sha256(await readFile(path)) !== record.sha256) throw new Error(`Source artifact changed: ${record.path}`);
    checks.push(record.path);
  }
  if (sha256(await readFile(within(runDir, 'sample.json'))) !== acquisition.sample_sha256) throw new Error('Frozen sample changed');
  for (const record of acquisition.records) {
    const path = within(runDir, record.path); await regularFile(path);
    if (sha256(await readFile(path)) !== record.acquisition.sha256) throw new Error(`Raw contract changed: ${record.id}`);
    checks.push(record.path);
  }
  return { acquisition, checks };
}

export async function analyze(runDir, { log = console.log } = {}) {
  requireContainer(); const started = new Date().toISOString();
  const { acquisition } = await verifyAcquisition(runDir);
  const config = await readJSON(within(runDir, 'config.json'));
  const source = await sourceManifest();
  log('Extracting contextual clauses from verified raw source bytes');
  const extractions = [];
  for (const record of acquisition.records) {
    const content = await readFile(within(runDir, record.path), 'utf8');
    extractions.push(extractContract({ ...record, content }, config.extraction));
  }
  const accepted = extractions.filter(result => result.status === 'accepted');
  const contractDedup = deduplicateContracts(accepted);
  const contractPartitions = partitionFamilies(contractDedup.families, config.sampling.seed, config.sampling.holdout_fraction);
  const contractRows = contractDedup.records.map(result => ({ ...result.contract, family_id: result.family_id, family_representative_id: result.family_representative_id, duplicate_kind: result.duplicate_kind, partition: contractPartitions.get(result.family_id), normalized_sha256: result.normalized_sha256, normalized_characters: result.normalized_text.length, clause_count: result.clauses.length }));
  const representatives = new Set(contractDedup.families.map(family => family.representative_id));
  const contractMap = new Map(contractRows.map(row => [row.id, row]));
  const allClauses = accepted.flatMap(result => result.clauses.map(clause => ({ ...clause, contract_family_id: contractMap.get(clause.contract_id).family_id, partition: contractMap.get(clause.contract_id).partition })));
  const uniqueContractClauses = allClauses.filter(clause => representatives.has(clause.contract_id));
  const selection = selectClauses(uniqueContractClauses, config.extraction, config.sampling.seed);
  log(`Deduplicating ${selection.admitted.length} selected units; ${allClauses.length} extracted units retained`);
  const clauseDedup = deduplicateClauses(selection.admitted);
  const clauseById = new Map(clauseDedup.records.map(row => [row.id, row]));
  const discoveryClauses = []; const holdoutDuplicateExclusions = [];
  for (const family of clauseDedup.families) {
    const records = family.members.map(id => clauseById.get(id));
    const fit = records.filter(row => row.partition === 'fit');
    const chosen = [...(fit.length ? fit : records)].sort((a, b) => a.id.localeCompare(b.id))[0];
    discoveryClauses.push({ ...chosen, duplicate_family: chosen.family_id });
    if (fit.length) holdoutDuplicateExclusions.push(...records.filter(row => row.partition === 'holdout').map(row => ({ id: row.id, family_id: row.family_id, fit_representative_id: chosen.id, reason: 'repeated_clause_family_already_in_fit' })));
  }
  discoveryClauses.sort((a, b) => a.id.localeCompare(b.id));
  const extractionStage = { schema_version: 1, source, parameters: config.extraction, results: extractions, selection: { admitted_ids: selection.admitted.map(row => row.id), excluded: selection.excluded, duplicate_contract_clause_count: allClauses.length - uniqueContractClauses.length }, contracts: contractRows, contract_families: contractDedup.families, contract_deduplication: { stats: contractDedup.stats, parameters: contractDedup.parameters, near_matches: contractDedup.near_matches, limitations: contractDedup.limitations }, clause_families: clauseDedup.families, clause_deduplication: { stats: clauseDedup.stats, parameters: clauseDedup.parameters, near_matches: clauseDedup.near_matches, limitations: clauseDedup.limitations }, selected_clauses: clauseDedup.records, discovery_clause_ids: discoveryClauses.map(row => row.id), holdout_duplicate_exclusions: holdoutDuplicateExclusions };
  await writeJSON(within(runDir, 'extraction.json'), extractionStage);
  if (!discoveryClauses.length) throw new Error('No contextual units admitted; extraction retained for inspection');
  log(`Embedding ${discoveryClauses.length} distinct contextual units`);
  const embedder = await createEmbedder(config.embedding, { log });
  const texts = discoveryClauses.map(clause => `${clause.heading ? `${clause.heading}\n` : ''}${clause.text}`);
  let embeddings;
  try {
    const result = await embedder.embed(texts, { onVector: async record => appendFile(within(runDir, 'embedding-progress.ndjson'), `${JSON.stringify({ clause_id: discoveryClauses[record.index].id, ...record })}\n`, { flag: 'a' }) });
    embeddings = { schema_version: 1, execution_attested: false, source, model: embedder.model, runtime: { node: process.version, platform: process.platform, architecture: process.arch, transformers: '3.8.1', onnxruntime: '1.21.0', intra_op_threads: 2, inter_op_threads: 1 }, input_method: 'section heading followed by complete selected clause; surrounding context retained in extraction', clause_ids: discoveryClauses.map(clause => clause.id), ...result };
    await writeJSON(within(runDir, 'embeddings.json'), embeddings);
  } finally { await embedder.dispose(); }
  log('Discovering families using multiple fixed cluster settings and seeds');
  const fitIds = discoveryClauses.filter(clause => clause.partition === 'fit').map(clause => clause.id);
  const discovery = discover(discoveryClauses, embeddings.vectors, { ...config.discovery, fitIds });
  await writeJSON(within(runDir, 'discovery.json'), { schema_version: 1, source, embeddings_sha256: sha256(await readFile(within(runDir, 'embeddings.json'))), ...discovery });
  const primary = discovery.runs.find(run => run.requested_k === config.discovery.primary_k && run.repeat === 1) ?? discovery.runs[0];
  const holdoutByCluster = new Map(primary.holdout_support.map(row => [row.cluster_id, row]));
  const clusters = primary.clusters.map(cluster => ({ ...cluster, holdout_support: holdoutByCluster.get(cluster.id) ?? null, holdout_member_ids: primary.assignments.filter(row => row.partition === 'holdout' && row.cluster_id === cluster.id).map(row => row.id ?? row.clause_id) }));
  const report = { schema_version: 1, title: 'Priors Derivation Lab — MCC Pilot 0.1', status: 'PROTOTYPE_RESEARCH_ONLY', authority: 'NONE', adopted_catalog: false, summary: { selected_contracts: acquisition.records.length + acquisition.failures.length, contracts: contractRows.length, rejected_contracts: extractions.length - accepted.length, contract_families: contractDedup.families.length, extracted_clauses: allClauses.length, selected_clauses: selection.admitted.length, clauses: discoveryClauses.length, fit_clauses: fitIds.length, holdout_clauses: discoveryClauses.length - fitIds.length, clusters: clusters.length, candidates: 0, acquisition_failures: acquisition.failures.length, corpus_bytes: acquisition.bytes }, contracts: contractRows, clauses: clauseDedup.records, clusters, assignments: primary.assignments, candidates: [], provenance: { source, corpus_version: acquisition.corpus_version, corpus_generated_at: acquisition.corpus_generated_at, acquisition_date: acquisition.acquired_at, started, completed: new Date().toISOString(), execution_attested: false }, license: config.corpus, attribution: config.corpus.citation, method: { sampling: config.sampling, extraction: config.extraction, embedding: embeddings.model, discovery: discovery.parameters, primary_run: primary.id, primary_selection: 'Preselected middle setting, first fixed repeat; not selected for the best observed result', holdout: 'Contract-family partition before fitting; clause families shared with fit excluded from independent holdout support' }, sampling: await readJSON(within(runDir, 'sample.json')), stability: discovery.stability, discovery: { status: discovery.status, runs: discovery.runs.map(run => ({ id: run.id, requested_k: run.requested_k, effective_k: run.effective_k, repeat: run.repeat, iterations: run.iterations, converged: run.converged, metrics: run.metrics, warnings: run.warnings })), comparisons: discovery.comparisons }, deduplication: { contracts: extractionStage.contract_deduplication, clauses: extractionStage.clause_deduplication, holdout_duplicates_excluded: holdoutDuplicateExclusions.length }, evaluation: { status: 'CANDIDATE_REVIEW_PENDING', semantic_quality: 'Not established by geometric or structural checks' }, findings: [], limitations: [...new Set([...contractDedup.limitations, ...clauseDedup.limitations, ...discovery.limitations, 'Machine contract-type labels were used for sampling and are not verified classifications.', 'Corporate SEC contracts are not representative of every small assignment or every participant.', 'A general sentence embedder has not been validated as a legal meaning or fairness model.', 'Geometric groups and frequency generate hypotheses; candidate interpretation requires explicit review.', 'No candidate catalog is adopted and no signed catalog, participant declaration or financial rule changes.'])] };
  await writeJSON(within(runDir, 'discovery-report.json'), report);
  await finalizeManifest(runDir, 'discovery-artifacts.json', ['config.json','sample.json','acquisition.json','extraction.json','embeddings.json','embedding-progress.ndjson','discovery.json','discovery-report.json','DATA_NOTICE.txt']);
  return report;
}

export async function finalizeManifest(runDir, name, names) {
  const files = [];
  for (const path of names) { await regularFile(within(runDir, path)); const bytes = await readFile(within(runDir, path)); files.push({ path, bytes: bytes.length, sha256: sha256(bytes) }); }
  return writeJSON(within(runDir, name), { schema_version: 1, files, files_sha256: digest(files), created_at: new Date().toISOString(), execution_attested: false });
}
