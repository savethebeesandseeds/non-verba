// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic inert controls only. No observer, process, IO, actor or real fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createLineageEvidenceRecorder,LINEAGE_EVIDENCE_LIMITS} from './lineage-evidence.mjs';
const parent=()=>({pid:10,start_ticks:'100',group:10,ppid:0});
const child=()=>({pid:11,start_ticks:'110',group:11,ppid:10});
const sameBirth=(a,b)=>a&&b&&a.pid===b.pid&&a.start_ticks===b.start_ticks&&a.group===b.group;

// A clearly fictional model of the existing expression, not an observer export.
function fictionalBranch(candidate,expected,observed,held=null){
  const recorder=createLineageEvidenceRecorder(),events=[];
  recorder.capture(candidate,expected,observed,17,held);
  const rejected=observed==='UNKNOWN'||!sameBirth(observed,expected)||candidate.ppid!==expected.pid||candidate.group!==candidate.pid;
  if(rejected){recorder.markHeldLineage();events.push('FICTIONAL_HELD');}
  else events.push('FICTIONAL_LATER_ROLE_CHECK_NOT_IMPLEMENTED');
  return{rejected,events,evidence:recorder.read()};
}
const last=result=>result.evidence.last_discovered_candidate;

test('PPID0 remains diagnostic data and a valid fictional parent does not reject',()=>{
  const p=parent(),r=fictionalBranch(child(),p,p);
  assert.equal(r.rejected,false);assert.equal(last(r).expected_parent.fields.ppid.value,0);
  assert.equal(r.evidence.first_held_lineage_candidate,null);
  assert.deepEqual(r.events,['FICTIONAL_LATER_ROLE_CHECK_NOT_IMPLEMENTED']);
});

test('wrong PPID retains the positive unadmitted candidate and exact expected parent',()=>{
  const p=parent(),c={...child(),ppid:99},r=fictionalBranch(c,p,p);
  assert.equal(r.rejected,true);assert.equal(last(r).candidate.fields.ppid.value,99);
  assert.equal(last(r).expected_parent.fields.pid.value,10);
  assert.equal(r.evidence.first_held_lineage_candidate.classification,'UNADMITTED');
  assert.equal(r.evidence.first_held_lineage_candidate.authority,'NONE');
});

test('changed parent birth is retained without replacing expected birth',()=>{
  const p=parent(),r=fictionalBranch(child(),p,{...p,start_ticks:'101'});
  assert.equal(r.rejected,true);assert.equal(last(r).expected_parent.fields.start_ticks.value,'100');
  assert.equal(last(r).observed_parent.fields.start_ticks.value,'101');
});

test('ABSENT and UNKNOWN parent observations remain distinct',()=>{
  for(const [value,status]of[[null,'ABSENT'],['UNKNOWN','UNKNOWN']]){
    const r=fictionalBranch(child(),parent(),value,'ROOT_PROCESS_OBSERVATION_UNKNOWN');
    assert.equal(r.rejected,true);assert.equal(last(r).observed_parent.observation,status);
    assert.equal(last(r).held_at_capture.value,'ROOT_PROCESS_OBSERVATION_UNKNOWN');
    assert.equal(r.evidence.first_held_lineage_candidate.held_at_capture.value,'ROOT_PROCESS_OBSERVATION_UNKNOWN');
  }
});

test('wrong group remains a fictional rejection with candidate birth preserved',()=>{
  const p=parent(),r=fictionalBranch({...child(),group:10},p,p);
  assert.equal(r.rejected,true);assert.equal(last(r).candidate.fields.group.value,10);
  assert.equal(last(r).candidate.fields.pid.value,11);
});

test('capture alone never marks a held lineage; first mark is sticky while last advances',()=>{
  const r=createLineageEvidenceRecorder();r.capture(child(),parent(),null,1);
  assert.equal(r.read().first_held_lineage_candidate,null);r.markHeldLineage();
  r.capture({...child(),pid:12,group:12},parent(),'UNKNOWN',2,'ROOT_EXISTING_HELD');r.markHeldLineage();
  assert.equal(r.read().last_discovered_candidate.sequence,2);
  assert.equal(r.read().first_held_lineage_candidate.sequence,1);
  assert.equal(r.read().first_held_lineage_candidate.observed_parent.observation,'ABSENT');
});

test('readout is detached from inputs and immutable at every retained level',()=>{
  const r=createLineageEvidenceRecorder(),c=child(),p=parent();r.capture(c,p,p,3);
  const a=r.read();c.pid=999;p.ppid=999;
  assert.equal(a.last_discovered_candidate.candidate.fields.pid.value,11);
  assert.equal(a.last_discovered_candidate.expected_parent.fields.ppid.value,0);
  assert.throws(()=>{a.last_discovered_candidate.candidate.fields.pid.value=999;},TypeError);
  assert.throws(()=>{a.last_discovered_candidate.authority='OWNED';},TypeError);
  assert.notEqual(r.read(),a);assert.notEqual(r.read().last_discovered_candidate,a.last_discovered_candidate);
});

test('accessors and unrelated payloads are not read; invalid fields stay bounded diagnostics',()=>{
  let reads=0;const c={pid:-1,start_ticks:'error text must not be retained',group:Infinity};
  Object.defineProperty(c,'ppid',{get(){reads++;throw Error('must not execute');}});
  for(const key of['children','command','message'])Object.defineProperty(c,key,{get(){reads++;throw Error('unrelated property');}});
  const r=createLineageEvidenceRecorder();r.capture(c,undefined,false,NaN,'arbitrary error text');
  const out=r.read(),row=out.last_discovered_candidate;
  assert.equal(reads,0);assert.equal(row.candidate.fields.pid.value,-1);
  assert.equal(row.candidate.fields.ppid.kind,'ACCESSOR_OMITTED');
  assert.equal(row.candidate.fields.start_ticks.kind,'INVALID_TICKS_OMITTED');
  assert.equal(row.observed_parent.observation,'INVALID_OBSERVATION');
  assert.equal(row.held_at_capture.kind,'INVALID_HELD_CODE_OMITTED');
  assert.equal(JSON.stringify(out).includes('error text'),false);
  assert.ok(JSON.stringify(row).length<=LINEAGE_EVIDENCE_LIMITS.record_json_characters);
});

test('large invalid primitives, maximum retained fields and repeated captures have fixed readout size',()=>{
  const r=createLineageEvidenceRecorder(),p={pid:Number.MAX_SAFE_INTEGER,start_ticks:'9'.repeat(32),group:Number.MIN_SAFE_INTEGER,ppid:0};
  r.capture(p,p,p,Number.MAX_SAFE_INTEGER,'A'.repeat(96));r.markHeldLineage();
  for(let n=0;n<1000;n++)r.capture({...p,start_ticks:n%2?'x'.repeat(100000):p.start_ticks},p,'UNKNOWN',n);
  const out=r.read();assert.equal(out.last_discovered_candidate.sequence,1001);
  assert.equal(out.first_held_lineage_candidate.sequence,1);
  assert.ok(JSON.stringify(out).length<=LINEAGE_EVIDENCE_LIMITS.readout_json_characters);
  assert.equal(out.authority,'NONE');assert.equal(out.classification,'UNADMITTED');
});

test('mark before capture is explicit inert misuse, not an ownership decision',()=>{
  const r=createLineageEvidenceRecorder();r.markHeldLineage();
  assert.equal(r.read().marks_without_candidate,1);assert.equal(r.read().first_held_lineage_candidate,null);
  r.capture(null,'UNKNOWN',null,-1);r.markHeldLineage();
  assert.equal(r.read().first_held_lineage_candidate.candidate.observation,'ABSENT');
  assert.equal(r.read().first_held_lineage_candidate.elapsed_ms.value,-1);
});
