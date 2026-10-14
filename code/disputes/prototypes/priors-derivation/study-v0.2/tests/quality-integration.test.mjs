// SPDX-License-Identifier: AGPL-3.0-only
// DECLARED_SYNTHETIC: authored judgments below are executable fixtures, never
// actual source reviews. Real study data, reserves and public requests are absent.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest,sha256} from '../../lib/common.mjs';
import {appendLedger,hashFile,readJSON,readRows,validateStudyRoot} from '../lib/store.mjs';
import {acquireStudy,readAcquired} from '../lib/acquisition.mjs';
import {sealQualityGate,verifyCalibrationGate} from '../lib/quality.mjs';
import {qualityFixture as fixture,qualityOptions as options,registerSyntheticSourceIssue} from './helpers/quality-fixture.mjs';
const collect=async iterator=>{const rows=[];for await(const row of iterator)rows.push(row);return rows;};

async function replace(root,path,value){
  // Mutation is intentional fault injection within this test's own exact root.
  validateStudyRoot(root);await writeFile(join(root,path),`${JSON.stringify(value,null,2)}\n`);
}


async function assertExpansionBlocked(root){
  let calls=0;await assert.rejects(acquireStudy(root,{limit:1,cohorts:['discovery-broad'],fetcher:async()=>{calls++;return new Response('Synthetic request must not occur');},log:()=>{}}));assert.equal(calls,0,'Gate refusal must precede every fake request');
  const rawPath='raw/synthetic-cal-1000.html',body='Declared synthetic source outside calibration.';await mkdir(join(root,'raw'),{recursive:true});await writeFile(join(root,rawPath),body);
  const row=(await collect(readRows(root,'selection.parquet'))).find(value=>value.id==='synthetic-cal-1000');await appendLedger(root,{kind:'download-committed',id:row.id,cohort:row.cohort,raw_path:rawPath,sha256:sha256(body),bytes:Buffer.byteLength(body),url:row.corpus_url,http_status:200,attempt:1});
  let yielded=0;await assert.rejects(async()=>{for await(const ignored of readAcquired(root,{cohorts:['discovery-broad']})){yielded++;void ignored;}});assert.equal(yielded,0,'Gate refusal must precede reading any new noncalibration body');
}

test('a complete terminal frozen 1000-ID synthetic calibration authorizes precisely the next discovery source',async t=>{
  const {root}=await fixture(t);const gate=await sealQualityGate(root,options);assert.equal(gate.status,'CALIBRATION_GATE_PASSED');assert.equal((await verifyCalibrationGate(root)).status,'CALIBRATION_GATE_PASSED');
  let calls=0;const acquired=await acquireStudy(root,{limit:1,cohorts:['discovery-broad'],fetcher:async()=>{calls++;return new Response('Declared synthetic new source.');},log:()=>{}});assert.equal(calls,1);assert.equal(acquired.acquired,1);
  const rows=await collect(readAcquired(root,{cohorts:['discovery-broad']}));assert.equal(rows.length,1);assert.equal(rows[0].id,'synthetic-cal-1000');
});

test('changing a review bound by a passed gate blocks expansion before request or content yield',async t=>{
  const {root}=await fixture(t);await sealQualityGate(root,options);const review=await readJSON(root,options.reviewPath);review.judgments[0].reason+=' Changed after sealing.';await replace(root,options.reviewPath,review);await assert.rejects(verifyCalibrationGate(root),/bound review artifact differs/);await assertExpansionBlocked(root);
});

test('an observed source loss in another pool invalidates a passed gate before expansion',async t=>{
  const data=await fixture(t),{root}=data;await sealQualityGate(root,options);
  await registerSyntheticSourceIssue(data);
  await assert.rejects(verifyCalibrationGate(root),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
  await assert.rejects(sealQualityGate(root,options),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
  await assertExpansionBlocked(root);
});

test('changing reviewed raw source after a gate passes invalidates the source review before expansion',async t=>{
  const {root,members}=await fixture(t);await sealQualityGate(root,options);await writeFile(join(root,`raw/${members[300].id}.html`),'Changed synthetic raw source after review.');await assert.rejects(verifyCalibrationGate(root));await assertExpansionBlocked(root);
});

for(const [name,mutate] of [
  ['a partial prefix',data=>{data.extraction.eligible_prefix_contracts=999;}],
  ['a pending record disguised as a terminal shortage',data=>{data.extraction.missing_contracts[0].acquisition_status='PENDING_OR_UNATTEMPTED';}],
  ['a source version different from current methods',data=>{data.extraction.source={...data.source,sha256:'0'.repeat(64)};}],
  ['a duplicate complete parent in the fresh denominator',data=>{data.freshRows[1].parent={...data.freshRows[0].parent};}],
  ['acceptance counts that disagree with the retained per-contract status',data=>{data.extraction.contract_records[2].status='rejected';}],
  ['a fresh contract declared previously exposed',data=>{data.freshRows[0]=data.auditRow(data.members[900],'fresh_representation',0);}],
  ['a complete parent from the development pool relabelled as fresh',data=>{data.freshRows[0]=data.auditRow(data.members[2],'fresh_representation',0);}],
  ['duplicated rejection controls that omit a rejected source',data=>{data.integrityRows[1]=data.auditRow(data.members[0],'source_integrity',1);}],
])test(`${name} cannot seal an expansion gate`,async t=>{const {root}=await fixture(t,{mutate});await assert.rejects(sealQualityGate(root,options));await assertExpansionBlocked(root);});

test('a rebound current-source marker cannot substitute another input extraction for the calibration audit',async t=>{
  const {root}=await fixture(t);const packet=await readJSON(root,options.packetPath);packet.source.input_manifest={path:'processing/unrelated.json',sha256:'1'.repeat(64),bytes:1};const {sha256:unused,...sourceBody}=packet.source;packet.source.sha256=digest(sourceBody);await replace(root,options.packetPath,packet);const review=await readJSON(root,options.reviewPath);review.packet_sha256=(await hashFile(join(root,options.packetPath))).sha256;await replace(root,options.reviewPath,review);await assert.rejects(sealQualityGate(root,options),/exact calibration extraction/);await assertExpansionBlocked(root);
});

test('removing an optional uniqueness flag cannot make repeated fresh parents acceptable',async t=>{
  const {root}=await fixture(t);const packet=await readJSON(root,options.packetPath);delete packet.source.unique_fresh_parent_sections;packet.rows[1].parent={...packet.rows[0].parent};const {sha256:unused,...sourceBody}=packet.source;packet.source.sha256=digest(sourceBody);await replace(root,options.packetPath,packet);const review=await readJSON(root,options.reviewPath);review.packet_sha256=(await hashFile(join(root,options.packetPath))).sha256;await replace(root,options.reviewPath,review);await assert.rejects(sealQualityGate(root,options),/unique parent/);await assertExpansionBlocked(root);
});
