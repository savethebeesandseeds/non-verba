// SPDX-License-Identifier: AGPL-3.0-only
// Focused real-Parquet review checks run only in the managed Linux container.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { STUDY_BASE, writeRows, writeJSON } from '../lib/store.mjs';
import { createStudyReviewServer, localReviewCsp, sourceUrl } from '../lib/review.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const schema = { id: 'VARCHAR', contract_id: 'VARCHAR', cohort: 'VARCHAR', kind: 'VARCHAR', payload: 'VARCHAR' };
const container = process.platform === 'linux' && process.env.NONVERBA_CONTAINER === '1';

async function fixture(t, { reserve = false, payloadMismatch = false, assignmentReserve = false } = {}) {
  await mkdir(STUDY_BASE, { recursive: true }); const runDir = path.join(STUDY_BASE, `review-test-${randomUUID()}`); await mkdir(runDir, { recursive: false });
  t.after(async () => { assert.equal(path.dirname(runDir), STUDY_BASE); assert.match(path.basename(runDir), /^review-test-[a-f0-9-]+$/); await rm(runDir, { recursive: true, force: true }); });
  const unitRows = []; const parentRows = []; const contractRecords = [];
  for (let contract = 0; contract < 3; contract++) {
    const id = `contract-${contract}`; const cohort = contract % 2 ? 'discovery-relevant' : 'discovery-broad';
    const textPieces = Array.from({ length: 6 }, (_, item) => {
      const index = contract * 6 + item;
      return index === 2 || index === 11 ? `Unit ${index}: the needle notice is retained.` : index === 5 ? '<script>window.__sourceExecuted=true</script><img onerror="bad()">' : `Unit ${index}: the parties preserve this synthetic obligation and its exception.`;
    });
    const normalized = textPieces.join('\n\n'); const normalizedPath = `normalized/${id}.txt`; await mkdir(path.join(runDir, 'normalized'), { recursive: true }); await writeFile(path.join(runDir, normalizedPath), normalized);
    const parentId = `parent-${contract}`;
    parentRows.push({ id: parentId, contract_id: id, cohort, kind: 'operative', payload: JSON.stringify({ id: parentId, contract_id: id, start: 0, end: normalized.length, text: normalized, sha256: sha(normalized), heading_path: ['Synthetic contract', 'Duties'], normalized_path: normalizedPath }) });
    contractRecords.push({ id, normalized_path: normalizedPath, normalized_sha256: sha(normalized), raw_sha256: sha(`synthetic raw ${normalized}`) });
    let offset = 0;
    for (const [item, text] of textPieces.entries()) {
      const index = contract * 6 + item; const unitId = `unit-${String(index).padStart(3, '0')}`;
      const columnCohort = reserve && index === 17 ? 'reserve-evaluation' : cohort;
      const payloadCohort = payloadMismatch && index === 17 ? 'reserve-evaluation' : columnCohort;
      const unit = { id: unitId, contract_id: id, cohort: payloadCohort, parent_section_id: parentId, normalized_path: normalizedPath, text, sha256: sha(text), start: offset, end: offset + text.length, source_url: index === 17 ? 'javascript:bad()' : `https://example.com/synthetic/${id}`, heading_path: ['Synthetic contract', 'Duties'], kind: 'operative', family_id: `family-${index}`, vector: [9999, 9999] };
      unitRows.push({ id: unitId, contract_id: id, cohort: columnCohort, kind: 'operative', payload: JSON.stringify(unit) }); offset += text.length + 2;
    }
  }
  const units = [await writeRows(runDir, 'admission/units-0.parquet', unitRows.slice(0, 9), { schema }), await writeRows(runDir, 'admission/units-1.parquet', unitRows.slice(9), { schema })];
  const sections = [await writeRows(runDir, 'extraction/sections.parquet', parentRows, { schema })];
  const extraction = await writeJSON(runDir, 'extraction/manifest.json', { schema_version: 2, contract_records: contractRecords });
  const assignmentRows = unitRows.map((row, index) => ({ id: row.id, cluster: `cluster-${index % 3 + 1}`, payload: JSON.stringify({ unit_id: row.id, contract_id: row.contract_id, cluster_id: `cluster-${index % 3 + 1}`, label: index % 3, similarity: 0.6, second_similarity: 0.4, margin: 0.2, partition: assignmentReserve && index === 17 ? 'holdout' : 'fit', vector: [9999, 9999] }) }));
  const assigned = [await writeRows(runDir, 'geometry/assigned.parquet', assignmentRows, { schema: { id: 'VARCHAR', cluster: 'VARCHAR', payload: 'VARCHAR' } })];
  const admission = { schema_version: 2, status: 'DECLARED_SYNTHETIC_ADMISSION', authority: 'NONE', adopted_catalog: false, counts: { input_units: 18, admitted_units: 18, representatives: 18, contracts_input: 3, contracts_admitted: 3 },
    source: { sha256: 'a'.repeat(64), parameters: { seed: 'synthetic-review' } }, gates: { reserve_accessed: false, semantic_validity_established: false }, shards: { units }, input: { sections_shards: sections, extraction_manifest_path: extraction.path, extraction_manifest_sha256: extraction.sha256 } };
  const geometry = { schema_version: 2, status: 'DECLARED_SYNTHETIC_GEOMETRY', authority: 'NONE', execution_attested: false, primary: 'synthetic-primary', assignment_shards: assigned, runs: [{ id: 'synthetic-primary', effective_k: 3 }], evaluation: { sha256: 'b'.repeat(64), unit_ids: ['synthetic'] } };
  return { runDir, admission, geometry, units: unitRows.map(row => JSON.parse(row.payload)), contractRecords };
}
async function running(t, f) {
  const server = await createStudyReviewServer(f.runDir, f);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); })); return server.address().port;
}
function request(port, target, method = 'GET') {
  return new Promise((resolve, reject) => { const req = http.request({ host: '127.0.0.1', port, path: target, method }, res => { const parts = []; res.on('data', part => parts.push(part)); res.on('end', () => { const body = Buffer.concat(parts).toString('utf8'); resolve({ status: res.statusCode, headers: res.headers, body, json: () => JSON.parse(body) }); }); }); req.on('error', reject); req.end(); });
}

test('actual representative pagination is stable across shards and cursor filters are bound', { skip: !container }, async t => {
  const f = await fixture(t); const port = await running(t, f); const ids = []; let cursor = null;
  do { const response = await request(port, `/api/units?limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); assert.equal(response.status, 200); const page = response.json(); assert.ok(page.items.length <= 5); ids.push(...page.items.map(unit => unit.id)); cursor = page.next_cursor; } while (cursor);
  assert.equal(ids.length, 18); assert.equal(new Set(ids).size, 18); assert.deepEqual(ids, f.units.map(unit => unit.id));
  const first = (await request(port, '/api/units?q=needle&limit=1')).json(); assert.equal(first.items.length, 1); assert.ok(first.next_cursor);
  const second = (await request(port, `/api/units?q=needle&limit=1&cursor=${first.next_cursor}`)).json(); assert.equal(second.items.length, 1); assert.notEqual(first.items[0].id, second.items[0].id); assert.equal(second.next_cursor, null);
  assert.equal((await request(port, `/api/units?q=changed&cursor=${first.next_cursor}`)).status, 400);
  assert.equal((await request(port, '/api/units?limit=51')).status, 400); assert.equal((await request(port, '/api/units?cursor=not-base64-json')).status, 400);
  const injection = (await request(port, `/api/units?q=${encodeURIComponent("' OR 1=1 --")}`)).json(); assert.equal(injection.items.length, 0);
});

test('source/cluster/contract lineage is bounded and excludes vector payloads and inferred meanings', { skip: !container }, async t => {
  const f = await fixture(t); const port = await running(t, f);
  const summary = (await request(port, '/api/summary')).json(); assert.deepEqual(summary.counts, { admitted_representatives: 18, represented_contracts: 3, primary_assignments: 18, primary_clusters: 3 }); assert.equal(summary.authority, 'NONE'); assert.equal(summary.adopted_catalog, false); assert.equal(summary.geometry.execution_attested, false); assert.equal(summary.gates.first_priors, 'UNRESOLVED_NOT_SELECTED');
  const cluster = (await request(port, '/api/clusters?limit=2')).json(); assert.equal(cluster.items.length, 2); assert.ok(cluster.next_cursor); assert.equal(cluster.items[0].representatives, 6);
  const filtered = (await request(port, '/api/units?cluster=cluster-1&contract=contract-0')).json(); assert.equal(filtered.items.length, 2); assert.ok(filtered.items.every(unit => unit.assignment.cluster_id === 'cluster-1' && unit.contract_id === 'contract-0'));
  const contracts = (await request(port, '/api/contracts?limit=2')).json(); assert.equal(contracts.items.length, 2); assert.ok(contracts.next_cursor);
  const unit = (await request(port, '/api/unit?id=unit-005')).json(); assert.match(unit.text, /<script>/); assert.equal(unit.vector, undefined); assert.equal(unit.assignment.vector, undefined); assert.equal(unit.inferred_prior_meaning, null); assert.equal(unit.evidence_classification, 'RAW_ADMITTED_SOURCE_TEXT');
  const hostileUrl = (await request(port, '/api/unit?id=unit-017')).json(); assert.equal(hostileUrl.source_url, null);
  const context = (await request(port, '/api/context?unit=unit-005')).json(); assert.equal(context.parent_section_id, 'parent-0'); assert.equal(context.excerpt.complete_parent, true); assert.equal(context.parent.text, undefined); assert.equal(context.normalized_source_sha256, f.contractRecords[0].normalized_sha256); assert.equal(context.normalized_hash_bound_to_extraction, true); assert.ok(context.excerpt.text.includes(unit.text)); assert.match(context.offsets, /UTF-16/);
  assert.equal((await request(port, '/api/context?unit=unit-005&start=999999')).status, 400);
});

test('reserve, mismatched payload and heldout assignments fail closed before serving', { skip: !container }, async t => {
  const reserve = await fixture(t, { reserve: true }); await assert.rejects(createStudyReviewServer(reserve.runDir, reserve), /Reserve or unknown-cohort/);
  const mismatch = await fixture(t, { payloadMismatch: true }); await assert.rejects(createStudyReviewServer(mismatch.runDir, mismatch), /payload identity or cohort/);
  const heldout = await fixture(t, { assignmentReserve: true }); await assert.rejects(createStudyReviewServer(heldout.runDir, heldout), /reserve, non-admitted or mismatched/);
  const valid = await fixture(t); const port = await running(t, valid); assert.equal((await request(port, '/api/units?cohort=reserve-evaluation')).status, 400); assert.equal((await request(port, '/api/unit?id=reserve-unit')).status, 404);
  const changed = { ...valid, admission: { ...valid.admission, shards: { units: [{ ...valid.admission.shards.units[0], sha256: 'f'.repeat(64) }] } } }; await assert.rejects(createStudyReviewServer(changed.runDir, changed), /hash mismatch/);
});

test('local review CSP is narrow, noindex and read-only with explicit routes only', { skip: !container }, async t => {
  const f = await fixture(t); const port = await running(t, f); const response = await request(port, '/review.html'); assert.equal(response.status, 200);
  assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow'); assert.match(response.headers['content-security-policy'], /style-src-elem 'self' 'unsafe-inline'/); assert.match(response.headers['content-security-policy'], /style-src-attr 'none'/); assert.match(response.headers['content-security-policy'], /script-src 'self';/); assert.doesNotMatch(response.headers['content-security-policy'], /script-src[^;]*unsafe-inline/); assert.match(response.body, /PROTOTYPE \/ RESEARCH ONLY/);
  for (const target of ['/recipe.json', '/report.json', '/admission/units-0.parquet', '/normalized/contract-0.txt', '/../api/summary', '/%2e%2e/api/summary']) assert.equal((await request(port, target)).status, 404, target);
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await request(port, '/api/units', method)).status, 405);
  const head = await request(port, '/api/summary', 'HEAD'); assert.equal(head.status, 200); assert.equal(head.body, ''); assert.ok(Number(head.headers['content-length']) > 0);
  assert.equal(localReviewCsp(), response.headers['content-security-policy']);
});

test('only safe source URL schemes are exposed', () => {
  assert.equal(sourceUrl('https://example.com/synthetic'), 'https://example.com/synthetic');
  for (const value of ['javascript:bad()', 'data:text/html,bad', 'file:///private/source', 'https://user:pass@example.com', '//example.com/relative', null]) assert.equal(sourceUrl(value), null);
});
