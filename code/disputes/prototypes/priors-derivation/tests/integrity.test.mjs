// SPDX-License-Identifier: AGPL-3.0-only
// Declared synthetic retained-artifact fixtures. No embedding inference or download.
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { complete, verifyRun } from '../cli.mjs';
import { finalizeManifest } from '../lib/analyze.mjs';
import { discover } from '../lib/discover.mjs';
import { digest, readJSON, requireContainer, sha256, writeJSON } from '../lib/common.mjs';

const discoveryFiles = ['config.json', 'sample.json', 'acquisition.json', 'extraction.json', 'embeddings.json', 'embedding-progress.ndjson', 'discovery.json', 'discovery-report.json', 'DATA_NOTICE.txt'];

async function replaceJSON(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

// Re-seal one changed file in a manifest, simulating an accidental or deliberate
// downstream re-hash. This is not an independent signature or execution proof.
async function resealFile(runDir, manifestName, path) {
  const manifest = await readJSON(join(runDir, manifestName));
  const bytes = await readFile(join(runDir, path));
  const entry = manifest.files.find(file => file.path === path);
  assert.ok(entry, `Fixture manifest contains ${path}`);
  entry.bytes = bytes.length;
  entry.sha256 = sha256(bytes);
  manifest.files_sha256 = digest(manifest.files);
  await replaceJSON(join(runDir, manifestName), manifest);
}

async function fixture(t) {
  requireContainer();
  const runDir = await mkdtemp(join(tmpdir(), 'nonverba-priors-integrity-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));
  const config = { discovery: { kValues: [2], repeats: 2, seed: 71, maxIterations: 20, primary_k: 2 } };
  const source = { data_classification: 'DECLARED_SYNTHETIC', files: [], sha256: digest([]), base_revision: null, source_dirty: null, snapshot_sha256: null };
  const texts = [
    'The parties shall promptly give notice of a defect and consider a bounded opportunity to correct the agreed work.',
    'Notice of an observed defect must describe the agreed scope and a feasible opportunity for correction.',
    'A delivery schedule records the agreed date and requires communication when access prevents completion.',
    'The parties shall record an expected delivery date and retain the reasons for any disputed delay.',
    'A reported defect can be discussed before deciding whether a practical correction is available.',
  ];
  const contracts = texts.map((_, i) => ({ id: `contract-${i}`, family_id: `contract-family-${i}`, partition: i === 4 ? 'holdout' : 'fit' }));
  const clauses = texts.map((text, i) => ({ id: `clause-${i}`, contract_id: contracts[i].id, text, heading: 'Declared synthetic section', start: 0, end: text.length, sha256: sha256(text), family_id: `clause-family-${i}`, partition: contracts[i].partition }));
  const vectors = [[1, 0], [0.98, 0.2], [-1, 0], [-0.98, 0.2], [0.9, 0.1]];
  await writeJSON(join(runDir, 'config.json'), config);
  await writeJSON(join(runDir, 'sample.json'), { data_classification: 'DECLARED_SYNTHETIC', records: contracts });
  await mkdir(join(runDir, 'raw'));
  const records = [];
  for (let i = 0; i < texts.length; i++) {
    const path = `raw/contract-${i}.txt`;
    await writeFile(join(runDir, path), texts[i]);
    records.push({ id: contracts[i].id, path, acquisition: { sha256: sha256(texts[i]) } });
  }
  await writeFile(join(runDir, 'source.txt'), 'Declared synthetic source metadata; no MCC records.\n');
  await writeJSON(join(runDir, 'acquisition.json'), {
    corpus_version: 'DECLARED_SYNTHETIC_INTEGRITY_FIXTURE',
    config_sha256: sha256(await readFile(join(runDir, 'config.json'))),
    sample_sha256: sha256(await readFile(join(runDir, 'sample.json'))),
    source_records: [{ path: 'source.txt', sha256: sha256(await readFile(join(runDir, 'source.txt'))) }],
    records,
  });
  await writeJSON(join(runDir, 'extraction.json'), {
    source,
    results: contracts.map((contract, i) => ({ contract, normalized_text: texts[i] })),
    contracts, selected_clauses: clauses,
  });
  await mkdir(join(runDir, 'model'));
  const dummyModel = Buffer.from('Declared synthetic model-file integrity fixture; not usable model weights.');
  await writeFile(join(runDir, 'model', 'dummy.onnx'), dummyModel);
  const inputs = clauses.map(clause => {
    const input = `${clause.heading}\n${clause.text}`;
    const words = input.match(/\S+/gu);
    const text = words.join(' ');
    return { input_sha256: sha256(input), windows: [{ text, sha256: sha256(text), word_start: 0, word_end: words.length, tokens: words.length, weight: words.length }] };
  });
  await writeJSON(join(runDir, 'embeddings.json'), {
    source,
    model: { directory: join(runDir, 'model'), dimensions: 2, max_tokens: 256, files: [{ path: 'dummy.onnx', sha256: sha256(dummyModel) }] },
    clause_ids: clauses.map(clause => clause.id), vectors, inputs,
  });
  await writeFile(join(runDir, 'embedding-progress.ndjson'), '');
  const fitIds = clauses.filter(clause => clause.partition === 'fit').map(clause => clause.id);
  const discovered = discover(clauses.map(clause => ({ ...clause, duplicate_family: clause.family_id })), vectors, { ...config.discovery, fitIds });
  await writeJSON(join(runDir, 'discovery.json'), {
    schema_version: 1, source,
    embeddings_sha256: sha256(await readFile(join(runDir, 'embeddings.json'))), ...discovered,
  });
  const primary = discovered.runs[0];
  const clusters = primary.clusters.map(cluster => ({
    ...cluster, holdout_support: primary.holdout_support.find(row => row.cluster_id === cluster.id) ?? null,
    holdout_member_ids: primary.assignments.filter(row => row.partition === 'holdout' && row.cluster_id === cluster.id).map(row => row.clause_id),
  }));
  const report = {
    schema_version: 1, title: 'Declared synthetic integrity fixture', status: 'PROTOTYPE_RESEARCH_ONLY',
    authority: 'NONE', adopted_catalog: false, summary: { candidates: 0, clauses: clauses.length, clusters: clusters.length },
    contracts, clauses, clusters, assignments: primary.assignments, candidates: [],
    provenance: { source, data_classification: 'DECLARED_SYNTHETIC', execution_attested: false },
    method: { primary_run: primary.id }, findings: [], limitations: ['Synthetic geometry does not establish a candidate meaning.'],
  };
  await writeJSON(join(runDir, 'discovery-report.json'), report);
  await writeFile(join(runDir, 'DATA_NOTICE.txt'), 'Declared synthetic test data, authored for integrity tests.\n');
  await finalizeManifest(runDir, 'discovery-artifacts.json', discoveryFiles);
  const supportAssignment = primary.assignments.find(row => row.clause_id === 'clause-0');
  const candidate = {
    id: 'synthetic-notice', name: 'Synthetic notice hypothesis', status: 'AGENT_DRAFT_REQUIRES_OWNER_REVIEW',
    declaration: 'A relevant notice may help the parties discuss a bounded opportunity to correct agreed work.',
    scope: ['procedure'], contrast: { higher: 'Attend more to the opportunity for a relevant notice.', lower: 'Attend less to that opportunity while retaining established evidence.' },
    boundaries: ['This does not promise that a correction is feasible.'],
    domain_limits: ['This synthetic fixture establishes no legal or financial authority.'],
    nearest_confusions: [{ name: 'Scheduling', difference: 'A notice opportunity and a delivery date answer distinct research questions.' }],
    support: [{ clause_id: 'clause-0', cluster_id: supportAssignment.cluster_id, partition: 'fit', reason: 'This exact synthetic clause connects notice of a defect with considering a bounded correction opportunity.' }],
    counterexamples: ['A notice cannot make an impossible correction feasible.'],
  };
  const reviewPath = join(runDir, 'authored-review-input.json');
  await writeJSON(reviewPath, { candidates: [candidate], findings: ['Declared synthetic fixture only.'] });
  return { runDir, reviewPath };
}

test('retained synthetic vectors replay exactly and a completed grounded draft remains verifiable', async t => {
  const { runDir, reviewPath } = await fixture(t);
  const initial = await verifyRun(runDir, { replay: true });
  assert.equal(initial.replay.status, 'EXACT_RETAINED_VECTOR_REPLAY');
  assert.equal(initial.replay.runs, 2);
  assert.equal(initial.execution_attested, false);
  const report = await complete(runDir, reviewPath);
  assert.equal(report.status, 'PROTOTYPE_AGENT_DRAFT_REQUIRES_OWNER_REVIEW');
  assert.equal(report.authority, 'NONE');
  assert.equal(report.adopted_catalog, false);
  assert.equal(report.provenance.candidate_review.source_input_sha256, sha256(await readFile(reviewPath)));
  const verified = await verifyRun(runDir, { replay: true });
  assert.equal(verified.candidate_references_checked, 1);
  assert.equal(verified.replay.fresh_inference, false);
});

test('Complete refuses a changed discovery report before creating any final artifacts', async t => {
  const { runDir, reviewPath } = await fixture(t);
  const report = await readJSON(join(runDir, 'discovery-report.json'));
  report.clauses[0].text = 'An invented replacement for retained source text.';
  await replaceJSON(join(runDir, 'discovery-report.json'), report);
  await assert.rejects(complete(runDir, reviewPath), /Artifact digest mismatch: discovery-report\.json/);
  for (const name of ['candidate-review.json', 'meaning-probes.json', 'report.json', 'artifacts.json']) {
    await assert.rejects(access(join(runDir, name)), { code: 'ENOENT' }, `${name} must not be written`);
  }
});

test('a final manifest cannot re-seal changed upstream discovery evidence', async t => {
  const { runDir, reviewPath } = await fixture(t);
  await complete(runDir, reviewPath);
  const report = await readJSON(join(runDir, 'discovery-report.json'));
  report.clauses[0].text = 'Changed upstream evidence after the final draft was sealed.';
  await replaceJSON(join(runDir, 'discovery-report.json'), report);
  await resealFile(runDir, 'artifacts.json', 'discovery-report.json');
  await assert.rejects(verifyRun(runDir, { replay: true }), /Artifact digest mismatch: discovery-report\.json/);
});

test('re-hashing a final report does not permit changes to immutable discovery evidence', async t => {
  const { runDir, reviewPath } = await fixture(t);
  await complete(runDir, reviewPath);
  const report = await readJSON(join(runDir, 'report.json'));
  report.clusters[0].centroid[0] += 0.125;
  await replaceJSON(join(runDir, 'report.json'), report);
  await resealFile(runDir, 'artifacts.json', 'report.json');
  await assert.rejects(verifyRun(runDir, { replay: true }), /Final report changed immutable discovery evidence/);
});

test('a self-consistent manifest digest cannot silently omit required retained artifacts', async t => {
  const { runDir, reviewPath } = await fixture(t);
  await complete(runDir, reviewPath);
  const manifest = await readJSON(join(runDir, 'artifacts.json'));
  manifest.files = manifest.files.filter(file => file.path !== 'embeddings.json');
  manifest.files_sha256 = digest(manifest.files);
  await replaceJSON(join(runDir, 'artifacts.json'), manifest);
  await assert.rejects(verifyRun(runDir), /Artifact manifest required file set mismatch: artifacts\.json/);
});

test('re-hashing a final report cannot promote unexecuted semantic evaluation to passed', async t => {
  const { runDir, reviewPath } = await fixture(t);
  await complete(runDir, reviewPath);
  const report = await readJSON(join(runDir, 'report.json'));
  assert.equal(report.evaluation.semantic_evaluation_status, 'NOT_RUN');
  report.evaluation.semantic_evaluation_status = 'PASSED';
  await replaceJSON(join(runDir, 'report.json'), report);
  await resealFile(runDir, 'artifacts.json', 'report.json');
  await assert.rejects(verifyRun(runDir, { replay: true }), /Final evaluation differs from retained review and structural checks/);
});
