// SPDX-License-Identifier: AGPL-3.0-only
// In-memory metadata controls only. No actual buffers, packet, payload or IO.
// The fictional guard rows below are self-sealed test data, not observations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {digest} from '../finite-codec.mjs';
import {DIAGNOSTIC_REFS,checkSelectedDiagnosticMetadata,validateDiagnosticMetadata} from './guard.mjs';

const copy=structuredClone,CID='contract-af284f93afed7c37b17e';
const HASH='ca0e37a53f0a70366e67cad593b0c420ba2eee5422817e12a7fce0216ac5e876';
function metadata(){
  // Fixed projected metadata has no source literal. It is not a source fixture.
  const row={audit_id:'development-0045',contract_id:CID,focal_kind:'ACTUAL_UNIT',focal_id:CID+':section:25713-27030:ca0e37a53f0a:unit:25713-27030:ca0e37a53f0a',focal_start:25713,focal_end:27030,focal_sha256:HASH,parent_id:CID+':section:25713-27030:ca0e37a53f0a',parent_start:25713,parent_end:27030,parent_sha256:HASH,source_sha256:'874c6b505ae5fc09fd3d92d46c64cd5474abf90fe574537c5e101b4fcaac6afa',metadata_basis_sha256:'f765edb69086be0fe992c92da050357fc61e9d411c9de06f1a2e8a33d49b3aa2',development_row:true,raw_path:'raw/'+CID+'.html',raw_sha256:DIAGNOSTIC_REFS.raw.sha256,raw_bytes:220353,normalized_path:'normalized/874c6b505ae5fc09/'+CID+'.txt',normalized_sha256:DIAGNOSTIC_REFS.normalized.sha256,cache_path:'extraction-cache/874c6b505ae5fc09/'+CID+'.json.gz',cache_sha256:DIAGNOSTIC_REFS.cache.sha256,cache_bytes:123393,cache_receipt_sha256:DIAGNOSTIC_REFS.receipt.sha256,native_reference_sha256:'7be0d8a3e0d7abe42ea5160793daee4145087b46e30d5f8fbdc1e422a97dc019',css_emphasis_sources:0,native_mark_sources:80,emphasized_caption_count:1,joint_groups:8,zero_events:4,parent_units:1};
  const rows=Array.from({length:100},(_,i)=>({audit_id:'SYNTHETIC_FRESH_AUDIT_'+i,contract_id:'SYNTHETIC_PROTECTED_'+i%29}));
  const body={schema:'stored-reader-complete-fresh100-guard-v1',fresh_packet_ref:{path:'audits/592ddf76b713d8ad4a13/fresh_representation.json',sha256:'b7f2a7d36149a64aa63a127fcc22989dc3b1f1eaf7701bf74c06701558917e18',bytes:452683},source_epoch_sha256:'48372b760ebbf6a06ccb488642201335c944dc2ff1b7f65a7a18269e158a0464',rows,contract_ids:[...new Set(rows.map(r=>r.contract_id))].sort()};
  return{row,selected:{case_id:'281472ea5d6b14852c6b03e805511a95f6f8b29137a23c4e6d930225a06e8ed0',audit_id:row.audit_id,contract_id:CID,case_kind:'AVAILABLE_FOCAL',selection_role:'MANDATORY',stratum:null,focal:copy(row)},guard:{...body,projection_sha256:digest(body)},refs:copy(DIAGNOSTIC_REFS)};
}
function reseal(guard){delete guard.projection_sha256;guard.projection_sha256=digest(guard);}
const denied=(fn,code)=>assert.throws(fn,e=>e.code===code);

test('fixed metadata returns only detached immutable row, complete guard and five refs',()=>{
  const input=metadata(),out=checkSelectedDiagnosticMetadata(input);
  assert.deepEqual(Object.keys(out),['row','guard','refs']);
  assert.equal(digest(out.row),'afc659d00a4919a1e38d79c2b5ca1eadc9f1b2690d396b93a7206f13b32fc14a');
  assert.equal(out.row.focal_kind,'ACTUAL_UNIT');assert.notEqual(out.row.focal_id,out.row.parent_id);
  assert.equal(out.row.focal_start,out.row.parent_start);assert.equal(out.row.focal_end,out.row.parent_end);
  assert.equal(out.guard.rows.length,100);assert.equal(out.guard.contract_ids.length,29);
  assert.deepEqual(Object.keys(out.refs),['raw','normalized','cache','receipt','native']);
  assert.ok(out.refs.raw.path.endsWith('/raw/'+CID+'.html'));assert.equal(out.refs.raw.bytes,220353);
  for(const value of[out,out.row,out.guard,out.guard.rows,out.guard.rows[0],out.refs,out.refs.native])assert.ok(Object.isFrozen(value));
  input.row.parent_end++;input.guard.rows[0].contract_id='SYNTHETIC_CHANGED';input.refs.native.bytes++;
  assert.equal(out.row.parent_end,27030);assert.equal(out.guard.rows[0].contract_id,'SYNTHETIC_PROTECTED_0');assert.equal(out.refs.native.bytes,305031);
});

test('a protected fixed CID is denied even when the entire fictional guard is resealed',()=>{
  const input=metadata();for(const row of input.guard.rows)if(row.contract_id==='SYNTHETIC_PROTECTED_0')row.contract_id=CID;
  input.guard.contract_ids=[...new Set(input.guard.rows.map(r=>r.contract_id))].sort();reseal(input.guard);
  denied(()=>checkSelectedDiagnosticMetadata(input),'DIAGNOSTIC_PROTECTED_CONTRACT');
});

test('every path, hash and size substitution in each of five payload refs is denied',()=>{
  for(const name of Object.keys(DIAGNOSTIC_REFS))for(const field of['path','sha256','bytes']){
    const input=metadata();input.refs[name][field]=field==='path'?input.refs[name].path+'.other':field==='sha256'?'0'.repeat(64):input.refs[name].bytes+1;
    denied(()=>checkSelectedDiagnosticMetadata(input),'DIAGNOSTIC_PAYLOAD_REF_SUBSTITUTION');
  }
  const extra=metadata();extra.refs.extra=copy(extra.refs.raw);denied(()=>checkSelectedDiagnosticMetadata(extra),'DIAGNOSTIC_FIVE_REFS');
});

test('wrong case, audit, contract, availability and selection membership are denied',()=>{
  for(const[field,value]of[['case_id','0'.repeat(64)],['audit_id','development-0046'],['contract_id','SYNTHETIC_OTHER'],['case_kind','UNAVAILABLE_CONTROL'],['selection_role','ADDITIONAL'],['stratum','CSS_EMPHASIS_PROXY']]){
    const input=metadata();input.selected[field]=value;denied(()=>checkSelectedDiagnosticMetadata(input),'DIAGNOSTIC_FIXED_CASE');
  }
});

test('selected row cannot be replaced with another otherwise valid metadata row',()=>{
  const input=metadata();input.row.audit_id='development-0046';input.selected.focal=copy(input.row);
  denied(()=>checkSelectedDiagnosticMetadata(input),'DIAGNOSTIC_SELECTED_ROW');
  const mismatch=metadata();mismatch.selected.focal.raw_bytes++;
  denied(()=>checkSelectedDiagnosticMetadata(mismatch),'DIAGNOSTIC_SELECTED_ROW');
});

test('focal and parent geometry must retain the exact fixed UTF16 range and distinct IDs',()=>{
  for(const change of[row=>{row.focal_end++;row.parent_end++;},row=>{row.focal_start--;row.parent_start--;},row=>{row.parent_id=row.focal_id;},row=>{row.parent_sha256='0'.repeat(64);}]){
    const input=metadata();change(input.row);input.selected.focal=copy(input.row);
    denied(()=>checkSelectedDiagnosticMetadata(input),'DIAGNOSTIC_FIXED_GEOMETRY');
  }
});

test('unchanged geometry cannot conceal another projected field or added unknown field',()=>{
  const input=metadata();input.row.native_mark_sources++;input.selected.focal=copy(input.row);
  denied(()=>checkSelectedDiagnosticMetadata(input),'DIAGNOSTIC_CANONICAL_ROW');
  const unknown=metadata();unknown.row.unsupported_source_field=true;unknown.selected.focal=copy(unknown.row);
  assert.throws(()=>checkSelectedDiagnosticMetadata(unknown),/EXACT69_TYPED_SOURCE_ONLY_METADATA_REQUIRED/u);
});

test('missing or incomplete guard and substituted fresh packet are denied',()=>{
  const absent=metadata();delete absent.guard;denied(()=>checkSelectedDiagnosticMetadata(absent),'DIAGNOSTIC_COMPLETE_FRESH_GUARD');
  const short=metadata();short.guard.rows.pop();reseal(short.guard);denied(()=>checkSelectedDiagnosticMetadata(short),'DIAGNOSTIC_COMPLETE_FRESH_GUARD');
  for(const field of['path','sha256','bytes']){
    const input=metadata();input.guard.fresh_packet_ref[field]=field==='path'?'SYNTHETIC_OTHER/fresh.json':field==='sha256'?'0'.repeat(64):1;reseal(input.guard);
    denied(()=>checkSelectedDiagnosticMetadata(input),'DIAGNOSTIC_COMPLETE_FRESH_GUARD');
  }
});

test('duplicate fresh audit IDs, omitted CID and corrupt guard seal are denied',()=>{
  const duplicate=metadata();duplicate.guard.rows[1].audit_id=duplicate.guard.rows[0].audit_id;reseal(duplicate.guard);denied(()=>checkSelectedDiagnosticMetadata(duplicate),'DIAGNOSTIC_FRESH_ROW');
  const omitted=metadata();omitted.guard.contract_ids[0]='SYNTHETIC_UNOBSERVED';reseal(omitted.guard);denied(()=>checkSelectedDiagnosticMetadata(omitted),'DIAGNOSTIC_FRESH_SEAL');
  const corrupt=metadata();corrupt.guard.projection_sha256='0'.repeat(64);denied(()=>checkSelectedDiagnosticMetadata(corrupt),'DIAGNOSTIC_FRESH_SEAL');
});

test('the main guard has no caller fixture escape from the pinned policy envelope',()=>{
  denied(()=>validateDiagnosticMetadata({bindings:{fixture:true},input:{},typedRoster:{},manifest:{},development:{}}),'DIAGNOSTIC_PINNED_BINDINGS');
  denied(()=>validateDiagnosticMetadata({bindings:{source_kind:'SOURCE_FREE_FIXTURE'},input:{},typedRoster:{},manifest:{},development:{}}),'DIAGNOSTIC_PINNED_BINDINGS');
});
