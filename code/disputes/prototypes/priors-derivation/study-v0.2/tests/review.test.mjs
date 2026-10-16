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
import {traceNativeDecoration,bindNativeDecoration} from '../lib/source-decoration.mjs';
import {storeNativeDecoration} from '../lib/native-decoration-store.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const schema = { id: 'VARCHAR', contract_id: 'VARCHAR', cohort: 'VARCHAR', kind: 'VARCHAR', payload: 'VARCHAR' };
const container = process.platform === 'linux' && process.env.NONVERBA_CONTAINER === '1';

async function fixture(t, { reserve = false, payloadMismatch = false, assignmentReserve = false, navigation = false, badNavigation = false,native=false } = {}) {
  await mkdir(STUDY_BASE, { recursive: true }); const runDir = path.join(STUDY_BASE, `review-test-${randomUUID()}`); await mkdir(runDir, { recursive: false });
  t.after(async () => { assert.equal(path.dirname(runDir), STUDY_BASE); assert.match(path.basename(runDir), /^review-test-[a-f0-9-]+$/); await rm(runDir, { recursive: true, force: true }); });
  const unitRows = []; const parentRows = []; const contractRecords = [];const caches=[];
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
    let nativeEnvelope=null;
    if(native){
      const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),first=textPieces[0];
      const raw='<BODY style="font-size:10pt"><STRIKE>'+escape(first)+'</STRIKE><U>'+escape(normalized.slice(first.length))+'</U></BODY>',rawPath=path.join(runDir,`${id}.html`);await writeFile(rawPath,raw);
      const trace=traceNativeDecoration(raw);let end=0;
      nativeEnvelope=bindNativeDecoration(trace,{raw,normalizedText:normalized,tracerSourceSHA256:'a'.repeat(64),collectorSourceSHA256:'b'.repeat(64),collectorSegments:trace.runs.map(run=>{const start=end;end+=run.decoded_text.length;return {normalized_start:start,normalized_end:end,sources:[{run_id:run.id,decoded_start:0,decoded_end:run.decoded_text.length}],normalization:'EXACT_DECODED'};})});
      const {reference}=await storeNativeDecoration(runDir,`native/${id}.json.gz`,nativeEnvelope);
      const artifact=await writeJSON(runDir,`cache/${id}.json`,{contract:{id,raw_path:rawPath},raw_sha256:sha(raw),normalized_text:normalized,normalized_sha256:sha(normalized),native_source_decorations:reference});caches.push({id,...artifact});contractRecords.at(-1).raw_sha256=sha(raw);contractRecords.at(-1).native_source_decorations=reference;
    }
    let offset = 0;
    for (const [item, text] of textPieces.entries()) {
      const index = contract * 6 + item; const unitId = `unit-${String(index).padStart(3, '0')}`;
      const columnCohort = reserve && index === 17 ? 'reserve-evaluation' : cohort;
      const payloadCohort = payloadMismatch && index === 17 ? 'reserve-evaluation' : columnCohort;
      const unit = { id: unitId, contract_id: id, cohort: payloadCohort, parent_section_id: parentId, normalized_path: normalizedPath, text, sha256: sha(text), start: offset, end: offset + text.length, source_url: index === 17 ? 'javascript:bad()' : `https://example.com/synthetic/${id}`, heading_path: ['Synthetic contract', 'Duties'], kind: 'operative', family_id: `family-${index}`, vector: [9999, 9999] };
      if(nativeEnvelope)unit.native_source_decorations_ref={envelope_sha256:nativeEnvelope.sha256,raw_sha256:nativeEnvelope.raw.sha256,normalized_sha256:nativeEnvelope.normalized.sha256,policy:nativeEnvelope.policy,mapping_status:nativeEnvelope.mapping_status,start:unit.start,end:unit.end};
      if (navigation && index===5) {
        const label=text.slice(0,8),scope='LITERAL_SOURCE_NAVIGATION_ONLY';
        const anchor={id:'synthetic-navigation',label,start:offset,end:offset+label.length,parts:[{text:label,start:offset,end:offset+label.length,machine_labels:['must not leak']}],kind:'declared_synthetic_literal_caption',scope,governing_hierarchy_verified:false,source_evidence:{source_kind:'DECLARED_SYNTHETIC',html_level:2,vector:[9999]},ambiguity:{source_quote_context:true,other_coding:['must not leak']}};
        unit.source_navigation={scope,governing_hierarchy_verified:false,status:'LITERAL_ANCHORS_PRESENT',nearest_anchor:anchor,within_unit:Array.from({length:40},(_,i)=>({...anchor,id:`synthetic-navigation-${i}`})),vector:[9999]};
        if (badNavigation) unit.source_navigation.within_unit[39].governing_hierarchy_verified=true;
      }
      unitRows.push({ id: unitId, contract_id: id, cohort: columnCohort, kind: 'operative', payload: JSON.stringify(unit) }); offset += text.length + 2;
    }
  }
  const units = [await writeRows(runDir, 'admission/units-0.parquet', unitRows.slice(0, 9), { schema }), await writeRows(runDir, 'admission/units-1.parquet', unitRows.slice(9), { schema })];
  const sections = [await writeRows(runDir, 'extraction/sections.parquet', parentRows, { schema })];
  const extraction = await writeJSON(runDir, 'extraction/manifest.json', { schema_version: 2, contract_records: contractRecords,cache:caches });
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

test('native source context hydrates one bound sidecar and shows relevant and full style evidence',{skip:!container},async t=>{
  const f=await fixture(t,{native:true}),port=await running(t,f),unit=(await request(port,'/api/unit?id=unit-005')).json();assert.equal(unit.native_source_evidence.status,'BOUND_NATIVE_SOURCE_EVIDENCE_AVAILABLE_IN_CONTEXT');
  const response=await request(port,'/api/context?unit=unit-005');assert.equal(response.status,200);const context=response.json(),projection=context.native_source_decorations;
  assert.equal(projection.annotations.length,2);assert.deepEqual(projection.annotations.map(a=>a.marks.map(m=>m.native_tag)),[['strike'],['u']]);assert.equal(projection.effectiveness_verified,false);assert.equal(projection.computed_style_verified,false);assert.equal(projection.envelope_sha256,unit.native_source_evidence.envelope_sha256);
  assert.ok(context.excerpt.text.includes('<script>'));assert.ok(!JSON.stringify(projection).includes('9999'));
  const full=(await request(port,'/api/context?unit=unit-005&native_styles=all')).json();assert.ok(full.native_source_decorations.annotations.some(a=>a.marks.some(m=>m.tag==='body')));
  assert.equal((await request(port,'/api/context?unit=unit-005&native_styles=invalid')).status,400);
});

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

test('literal navigation is bounded, unverified and excludes nested vectors or coder labels',{skip:!container},async t=>{
  const f=await fixture(t,{navigation:true}),port=await running(t,f);
  const response=await request(port,'/api/unit?id=unit-005');assert.equal(response.status,200);
  const unit=response.json(),nav=unit.source_navigation;
  assert.equal(nav.nearest_anchor.label,'<script>');assert.equal(nav.governing_hierarchy_verified,false);
  assert.equal(nav.nearest_anchor.governing_hierarchy_verified,false);assert.equal(nav.nearest_anchor.scope,'LITERAL_SOURCE_NAVIGATION_ONLY');
  assert.equal(nav.within_unit.length,32);assert.equal(nav.within_unit_total,40);assert.equal(nav.within_unit_truncated,true);
  assert.equal(nav.vector,undefined);assert.equal(nav.nearest_anchor.source_evidence.vector,undefined);
  assert.equal(nav.nearest_anchor.parts[0].machine_labels,undefined);assert.equal(nav.nearest_anchor.ambiguity.other_coding,undefined);
  const context=(await request(port,'/api/context?unit=unit-005')).json();assert.equal(context.source_navigation.nearest_anchor.label,'<script>');
  assert.equal(context.source_navigation.within_unit_total,40);assert.equal(context.source_navigation.within_unit_truncated,true);
  assert.equal(context.source_navigation.nearest_anchor.governing_hierarchy_verified,false);
  const malformed=await fixture(t,{navigation:true,badNavigation:true}),badPort=await running(t,malformed);
  assert.equal((await request(badPort,'/api/unit?id=unit-005')).status,500);
});

test('summary and context recheck later gate records instead of displaying an unchecked historical pass',{skip:!container},async t=>{
  const f=await fixture(t),source='a'.repeat(64);f.admission.input.extraction_source_sha256=source;
  const port=await running(t,f),before=(await request(port,'/api/summary')).json();
  assert.equal(before.gates.representation.status,'NOT_PASSED_CALIBRATION_IN_PROGRESS');
  await writeJSON(f.runDir,`quality-gates/${source}/gate.json`,{status:'CALIBRATION_GATE_PASSED',extraction_source_sha256:source,authority:'NONE',data_classification:'DECLARED_SYNTHETIC_UNVERIFIED_PASS_RECORD'});
  const after=(await request(port,'/api/summary')).json();
  assert.equal(after.gates.representation.historical_status,'CALIBRATION_GATE_PASSED');
  assert.equal(after.gates.representation.status,'CURRENT_SOURCE_GATE_NOT_PASSED');
  const context=(await request(port,'/api/context?unit=unit-005')).json();
  assert.equal(context.representation_gate.historical_status,'CALIBRATION_GATE_PASSED');
  assert.equal(context.representation_gate.status,'CURRENT_SOURCE_GATE_NOT_PASSED');
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
