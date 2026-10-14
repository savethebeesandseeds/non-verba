// SPDX-License-Identifier: AGPL-3.0-only
// Study-wide balanced admission before repetition and geometric discovery.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, digest, sha256, requireContainer } from '../../lib/common.mjs';
import { hashFile, readJSON, writeJSON, readRows, writeRows, studyPath, validateStudyRoot } from './store.mjs';
import { deduplicateUnits } from './repetition.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SCHEMA = { id: 'VARCHAR', contract_id: 'VARCHAR', cohort: 'VARCHAR', kind: 'VARCHAR', payload: 'VARCHAR' };
const COHORTS = new Set(['discovery-broad', 'discovery-relevant']);
const HEX = /^[a-f0-9]{64}$/;
const unique = (values) => [...new Set(values)];

function bound(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${name} must be an integer in ${min}..${max}`);
  return value;
}

function recordDigest(rows) {
  const hash = createHash('sha256');
  for (const row of rows) hash.update(canonical(row)).update('\n');
  return hash.digest('hex');
}

function strippedManifest(value) {
  const { manifest_path, ...body } = value;
  return body;
}

function memoryTracker(limit) {
  const start = process.memoryUsage(); const peak = { ...start }; let samples = 0;
  const sample = () => {
    const current = process.memoryUsage(); samples += 1;
    for (const [key, value] of Object.entries(current)) peak[key] = Math.max(peak[key] ?? 0, value);
    if (current.rss > limit) throw new Error(`ADMISSION_MEMORY_BOUND: process RSS ${current.rss} exceeds declared ${limit}; scope was not silently reduced`);
    return current;
  };
  sample();
  return { sample, report: () => ({ start, peak, final: sample(), samples, limit_rss_bytes: limit, method: 'process.memoryUsage samples; peak is sampled rather than continuously measured', scope: 'this process, not total container memory' }) };
}

async function verifyShards(runDir, shards) {
  if (!Array.isArray(shards)) throw new TypeError('Extraction manifest requires unit shards');
  const verified = [];
  for (const shard of shards) {
    if (!shard || typeof shard.path !== 'string' || !HEX.test(shard.sha256 ?? '')) throw new Error('Input shard requires an exact path and SHA256');
    const actual = await hashFile(await studyPath(runDir, shard.path));
    if (actual.sha256 !== shard.sha256 || shard.bytes != null && actual.bytes !== shard.bytes) throw new Error(`ADMISSION_INPUT_CHANGED: ${shard.path}`);
    verified.push({ ...shard, ...actual });
  }
  return verified;
}

async function stableJSON(runDir, path, value) {
  try {
    const existing = await readJSON(runDir, path, { maxBytes: 64 * 1024 * 1024 });
    if (digest(existing) !== digest(value)) throw new Error(`Immutable JSON differs from this attempt: ${path}`);
    return { path, ...await hashFile(await studyPath(runDir, path)), resumed: true };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return writeJSON(runDir, path, value);
}

async function stableRows(runDir, path, rows, totalBytes) {
  const expected = recordDigest(rows); const sidecar = `${path}.manifest.json`;
  try {
    const existing = await readJSON(runDir, sidecar);
    const actual = await hashFile(await studyPath(runDir, path));
    if (existing.records_sha256 !== expected || existing.sha256 !== actual.sha256) throw new Error(`Immutable admission shard differs: ${path}`);
    return existing;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let shard;
  try {
    const pathToExisting = await studyPath(runDir, path);
    const hash = createHash('sha256'); let count = 0;
    for await (const row of readRows(runDir, path)) { hash.update(canonical(row)).update('\n'); count += 1; }
    if (hash.digest('hex') !== expected || count !== rows.length) throw new Error(`Orphan admission shard differs: ${path}`);
    shard = { path, rows: count, ...await hashFile(pathToExisting), schema: SCHEMA, execution_attested: false };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    shard = await writeRows(runDir, path, rows, { schema: SCHEMA, totalBytes });
  }
  const manifest = { ...shard, records_sha256: expected };
  await stableJSON(runDir, sidecar, manifest);
  return manifest;
}

/** Descriptor-only selection preserves retained per-contract selection priority. */
export function balancedAdmission(descriptors, { seed = 'nonverba-admission-v0.2', maxUnits = 300000 } = {}) {
  if (!Array.isArray(descriptors)) throw new TypeError('Admission descriptors must be an array');
  bound(maxUnits, 'maxUnits', 1, 1000000);
  const pools = new Map(); const ids = new Set();
  for (const descriptor of descriptors) {
    if (!descriptor || typeof descriptor.id !== 'string' || !descriptor.id || typeof descriptor.contract_id !== 'string' || !descriptor.contract_id || ids.has(descriptor.id)) throw new TypeError('Admission requires distinct id and contract_id');
    ids.add(descriptor.id);
    if (!pools.has(descriptor.contract_id)) pools.set(descriptor.contract_id, []);
    pools.get(descriptor.contract_id).push(descriptor);
  }
  for (const pool of pools.values()) {
    if (pool.every((row) => Number.isSafeInteger(row.selection_rank))) pool.sort((left, right) => left.selection_rank - right.selection_rank || left.id.localeCompare(right.id));
  }
  const ranks = new Map([...pools.keys()].map((id) => [id, digest([String(seed), 'contract-order', id])]));
  const order = [...pools.keys()].sort((left, right) => ranks.get(left).localeCompare(ranks.get(right)) || left.localeCompare(right));
  const selected = []; let rank = 0;
  while (selected.length < maxUnits) {
    let added = false;
    for (const id of order) {
      const descriptor = pools.get(id)[rank];
      if (descriptor) { selected.push(descriptor); added = true; }
      if (selected.length === maxUnits) break;
    }
    if (!added) break;
    rank += 1;
  }
  const admitted = new Set(selected.map((row) => row.id));
  return { selected, excluded: descriptors.filter((row) => !admitted.has(row.id)).map((row) => ({ ...row, reason: 'explicit_study_wide_unit_bound' })), contract_order: order, parameters: { seed: String(seed), maxUnits, algorithm: 'hash_rank_contracts_then_round_robin_retained_selection_priority', within_contract_order: 'explicit_selection_rank_when_complete_else_frozen_input_order', scope_reduction: 'none_except_declared_global_unit_bound' } };
}

/** Bounded two-pass admission; all exclusions and variants retain source lineage. */
export async function prepareDiscovery(runDir, extractionManifest, options = {}) {
  requireContainer(); validateStudyRoot(runDir);
  if (!extractionManifest || typeof extractionManifest !== 'object' || !HEX.test(extractionManifest.source?.sha256 ?? '')) throw new TypeError('Require a source-bound extraction manifest');
  const recipe = await readJSON(runDir, 'recipe.json');
  const seed = String(options.seed ?? recipe.seed);
  let mainUnitBudget=null;try{mainUnitBudget=await readJSON(runDir,'main-unit-budget.json');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(mainUnitBudget&&(mainUnitBudget.main_limit!==recipe.extraction.maxUnits||mainUnitBudget.discovery_limit+mainUnitBudget.confirmation_limit+mainUnitBudget.temporal_limit!==mainUnitBudget.main_limit))throw new Error('Declared whole-study unit allocation differs');
  const maxUnits = bound(options.maxUnits ?? mainUnitBudget?.discovery_limit ?? recipe.extraction?.maxUnits ?? 300000, 'maxUnits', 1, 1000000);
  if(mainUnitBudget&&maxUnits>mainUnitBudget.discovery_limit)throw new Error('Discovery admission exceeds reserved main-unit allocation');
  const maxInputRows = bound(options.maxInputRows ?? Math.max(maxUnits, 600000), 'maxInputRows', maxUnits, 5000000);
  const maxPayloadBytes = bound(options.maxPayloadBytes ?? 256 * 1024, 'maxPayloadBytes', 1024, 8 * 1024 * 1024);
  const maxMemoryBytes = bound(options.maxMemoryBytes ?? recipe.limits?.memoryBytes ?? 6 * 1024 ** 3, 'maxMemoryBytes', 64 * 1024 ** 2, 64 * 1024 ** 3);
  const shardRows = bound(options.shardRows ?? 5000, 'shardRows', 1, 50000);
  const repetitionOptions = { ...(options.repetition ?? recipe.repetition ?? {}), seed };
  const parameters = { seed, maxUnits,mainUnitBudget, maxInputRows, maxPayloadBytes, maxMemoryBytes, shardRows, repetition: repetitionOptions, algorithm: 'two_pass_global_round_robin_then_guarded_repetition', version: 2 };
  const files = [];
  for (const name of ['admission.mjs', 'repetition.mjs', 'store.mjs']) files.push({ path: name, sha256: sha256(await readFile(resolve(ROOT, name))) });
  const inputManifestHash = digest(strippedManifest(extractionManifest));
  let inputManifestFile=null;
  if (extractionManifest.manifest_path) {
    const persisted = await readJSON(runDir, extractionManifest.manifest_path, { maxBytes: 64 * 1024 * 1024 });
    if (digest(strippedManifest(persisted)) !== inputManifestHash) throw new Error('Extraction manifest bytes differ from the supplied stage');
    inputManifestFile=await hashFile(await studyPath(runDir,extractionManifest.manifest_path));
  }
  const [inputShards, sectionShards] = await Promise.all([verifyShards(runDir, extractionManifest.shards?.units), verifyShards(runDir, extractionManifest.shards?.sections ?? [])]);
  const sourceBody = { parameters, files, input_manifest_sha256: inputManifestHash, input_manifest_digest_encoding:'canonical-finite-json-sha256',input_manifest_file:inputManifestFile, extraction_source_sha256: extractionManifest.source.sha256 };
  const source = { ...sourceBody, sha256: digest(sourceBody) };
  const prefix = `admission/${source.sha256.slice(0, 24)}`;
  const manifestPath = `${prefix}/manifest.json`;
  try {
    const existing = await readJSON(runDir, manifestPath, { maxBytes: 64 * 1024 * 1024 });
    if (existing.source?.sha256 !== source.sha256) throw new Error('Retained admission source identity differs');
    for (const artifacts of Object.values(existing.shards ?? {})) await verifyShards(runDir, artifacts);
    return { ...existing, manifest_path: manifestPath, resumed: true };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const memory = memoryTracker(maxMemoryBytes); const descriptors = []; const contractData = new Map(); let inputCount = 0;
  for (const shard of inputShards) {
    let ordinal = 0;
    for await (const wrapped of readRows(runDir, shard.path)) {
      inputCount += 1;
      if (inputCount > maxInputRows) throw new Error('ADMISSION_INPUT_BOUND: complete scope exceeds declared descriptor count; no arbitrary input prefix was admitted');
      if (typeof wrapped.payload !== 'string' || Buffer.byteLength(wrapped.payload) > maxPayloadBytes) throw new Error('ADMISSION_PAYLOAD_BOUND: input unit exceeds declared byte limit');
      const unit = JSON.parse(wrapped.payload);
      if (unit.id !== wrapped.id || unit.contract_id !== wrapped.contract_id || !COHORTS.has(wrapped.cohort) || unit.cohort != null && unit.cohort !== wrapped.cohort || typeof unit.text !== 'string' || !unit.text.trim()) throw new Error('ADMISSION_LINEAGE: payload identity/cohort mismatch or reserve input refused');
      if (!contractData.has(unit.contract_id)) contractData.set(unit.contract_id, { contract_id: unit.contract_id, cohort: wrapped.cohort, input_units: 0, admitted_units: 0, input_tags: new Set(), admitted_tags: new Set() });
      const contract = contractData.get(unit.contract_id);
      if (contract.cohort !== wrapped.cohort) throw new Error('A contract appears in multiple discovery cohorts');
      const priority = Number.isSafeInteger(unit.selection_rank) ? unit.selection_rank : contract.input_units;
      contract.input_units += 1;
      for (const tag of unit.function_tags ?? []) if (typeof tag === 'string') contract.input_tags.add(tag);
      descriptors.push({ id: unit.id, contract_id: unit.contract_id, cohort: wrapped.cohort, kind: wrapped.kind ?? unit.kind ?? 'unknown', selection_rank: priority, input_shard: shard.path, input_shard_sha256: shard.sha256, input_ordinal: ordinal, payload_sha256: sha256(wrapped.payload) });
      ordinal += 1;
      if (inputCount % 1000 === 0) memory.sample();
    }
    if (shard.rows != null && ordinal !== shard.rows) throw new Error(`Input shard row count differs: ${shard.path}`);
  }
  if (extractionManifest.selected_units != null && extractionManifest.selected_units !== inputCount) throw new Error('Extraction selected-unit total differs from complete shard enumeration');
  const selection = balancedAdmission(descriptors, { seed, maxUnits });
  const selectedById = new Map(selection.selected.map((descriptor) => [descriptor.id, descriptor]));
  const selectedRank = new Map(selection.selected.map((descriptor, index) => [descriptor.id, index]));
  const loaded = new Map();
  for (const shard of inputShards) for await (const wrapped of readRows(runDir, shard.path)) {
    const descriptor = selectedById.get(wrapped.id); if (!descriptor) continue;
    if (loaded.has(wrapped.id) || sha256(wrapped.payload) !== descriptor.payload_sha256) throw new Error('Input unit changed or repeated between admission passes');
    const unit = JSON.parse(wrapped.payload);
    loaded.set(wrapped.id, { ...unit, cohort: wrapped.cohort, kind: wrapped.kind ?? unit.kind ?? 'unknown', admission_rank: selectedRank.get(wrapped.id), admission_source: { shard: descriptor.input_shard, shard_sha256: descriptor.input_shard_sha256, ordinal: descriptor.input_ordinal, payload_sha256: descriptor.payload_sha256 } });
    const contract = contractData.get(unit.contract_id); contract.admitted_units += 1;
    for (const tag of unit.function_tags ?? []) if (typeof tag === 'string') contract.admitted_tags.add(tag);
    if (loaded.size % 1000 === 0) memory.sample();
  }
  if (loaded.size !== selection.selected.length) throw new Error('Not every globally admitted ID was recovered');
  const admitted = selection.selected.map((descriptor) => loaded.get(descriptor.id));
  memory.sample();
  const repeated = deduplicateUnits(admitted, repetitionOptions);
  memory.sample();
  const rowById = new Map(repeated.records.map((row) => [row.id, row]));
  const shards = { units: [], membership: [], excluded: [], families: [], template_families: [], repetition_audit: [] };
  const totalBytes = recipe.limits?.totalBytes ?? 24 * 1024 ** 3;
  const pack = (id, contractId, cohort, kind, payload) => ({ id, contract_id: contractId ?? '', cohort: cohort ?? '', kind: kind ?? 'unknown', payload: JSON.stringify(payload) });
  function* mapped(iterable, mapper) { for (const value of iterable) yield mapper(value); }
  async function emit(name, iterable) {
    let batch = []; let ordinal = 0;
    for (const row of iterable) {
      batch.push(row);
      if (batch.length === shardRows) { shards[name].push(await stableRows(runDir, `${prefix}/${name}-${String(ordinal++).padStart(5, '0')}.parquet`, batch, totalBytes)); batch = []; memory.sample(); }
    }
    if (batch.length) shards[name].push(await stableRows(runDir, `${prefix}/${name}-${String(ordinal).padStart(5, '0')}.parquet`, batch, totalBytes));
  }
  await emit('units', mapped(repeated.representatives, (unit) => pack(unit.id, unit.contract_id, unit.cohort, unit.kind, unit)));
  await emit('membership', mapped(repeated.records, (unit) => pack(unit.id, unit.contract_id, unit.cohort, unit.kind, { id: unit.id, parent_section_id: unit.parent_section_id ?? null, family_id: unit.family_id, family_representative_id: unit.family_representative_id, duplicate_kind: unit.duplicate_kind, template_blocking_id: unit.template_blocking_id, template_blocking_coarse: unit.template_blocking_coarse, start: unit.start ?? null, end: unit.end ?? null, normalized_path: unit.normalized_path ?? null, admission_rank: unit.admission_rank, admission_source: unit.admission_source })));
  await emit('excluded', mapped(selection.excluded, (descriptor) => pack(descriptor.id, descriptor.contract_id, descriptor.cohort, descriptor.kind, descriptor)));
  await emit('families', mapped(repeated.families, (family) => {
    const representative = rowById.get(family.representative_id);
    return pack(family.id, representative.contract_id, representative.cohort, family.kind, { id: family.id, representative_id: family.representative_id, kind: family.kind, member_count: family.members.length, distinct_contracts: new Set(family.members.map((id) => rowById.get(id).contract_id)).size, example_member_ids: family.members.slice(0, 12), complete_membership: 'shards.membership payload.family_id' });
  }));
  await emit('template_families', mapped(repeated.template_families, (family) => {
    const representative = rowById.get(family.representative_id);
    return pack(family.id, representative.contract_id, representative.cohort, 'template_blocking_only', { id: family.id, representative_id: family.representative_id, member_count: family.members.length, coarse_hot_bucket_block: family.coarse_hot_bucket_block, purpose: family.purpose, example_member_ids: family.members.slice(0, 12), complete_membership: 'shards.membership payload.template_blocking_id' });
  }));
  await emit('repetition_audit', mapped(repeated.audit.pairs, (pair) => pack(`pair-${digest(pair)}`, rowById.get(pair.left_id)?.contract_id, rowById.get(pair.left_id)?.cohort, 'repetition_proposal_decision', pair)));
  const coverage = [...contractData.values()].map((row) => ({ contract_id: row.contract_id, cohort: row.cohort, input_units: row.input_units, admitted_units: row.admitted_units, observed_function_tags: [...row.input_tags].sort(), admitted_function_tags: [...row.admitted_tags].sort(), unrepresented_function_tags: [...row.input_tags].filter((tag) => !row.admitted_tags.has(tag)).sort() })).sort((left, right) => left.contract_id.localeCompare(right.contract_id));
  const selectionHash = createHash('sha256'); for (const row of selection.selected) selectionHash.update(row.id).update('\n');
  const manifest = { schema_version: 2, status: 'DISCOVERY_RESEARCH_ONLY', authority: 'NONE', adopted_catalog: false, source, parameters, input: { extraction_manifest_path: extractionManifest.manifest_path ?? null, extraction_manifest_sha256: inputManifestHash, extraction_source_sha256: extractionManifest.source.sha256, units_shards: inputShards, sections_shards: sectionShards }, counts: { input_units: inputCount, admitted_units: admitted.length, excluded_units: selection.excluded.length, representatives: repeated.representatives.length, contracts_input: contractData.size, contracts_admitted: coverage.filter((row) => row.admitted_units).length }, selected_ids_sha256: selectionHash.digest('hex'), coverage, shards, repetition: { stats: repeated.stats, parameters: repeated.parameters, warnings: repeated.audit.warnings, hot_buckets: repeated.audit.hot_buckets, audit_pairs_omitted: repeated.stats.audit_pairs_omitted, skipped_proposal_visits: repeated.audit.skipped_proposal_visits, limitations: repeated.limitations }, gates: { input_hashes_verified: true, global_cap_enforced: true, reserve_accessed: false, repetition_operating_bounds_complete: repeated.audit.coverage_complete, semantic_validity_established: false }, memory: memory.report(), execution_attested: false, limitations: ['The declared study-wide unit bound is enforced across every input contract, with complete excluded-ID lineage.', 'Full extraction and original per-contract selections remain retained; representative fitting does not delete variants.', 'Lexical function coverage is a sampling category, not a candidate-prior catalog or a semantic evaluation.', 'Template blocking is broader than duplicate admission and can include materially different variants.', 'Process memory peaks are sampled, not a continuous total-container measurement.'] };
  manifest.input.extraction_manifest_digest_encoding='canonical-finite-json-sha256';manifest.input.extraction_manifest_file=inputManifestFile;
  await stableJSON(runDir, manifestPath, manifest);
  return { ...manifest, manifest_path: manifestPath, resumed: false };
}

export async function* readDiscoveryUnits(runDir, manifest) {
  requireContainer(); validateStudyRoot(runDir);
  if (!manifest?.shards?.units || !HEX.test(manifest.source?.sha256 ?? '')) throw new TypeError('Require a source-bound discovery manifest');
  const shards = await verifyShards(runDir, manifest.shards.units);
  for (const shard of shards) for await (const wrapped of readRows(runDir, shard.path)) {
    const unit = JSON.parse(wrapped.payload);
    if (unit.id !== wrapped.id || unit.contract_id !== wrapped.contract_id || !COHORTS.has(wrapped.cohort)) throw new Error('Discovery representative lineage differs from its Parquet row');
    yield unit;
  }
}
