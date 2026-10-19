// SPDX-License-Identifier: AGPL-3.0-only
// Pure in-memory metadata controls. No actual buffers, packets, payloads or IO.
// Fictional guard rows are self-sealed declarations, not observed fresh rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import {digest} from '../finite-codec.mjs';
import {COMPARISON_CASES as CASES,COMPARISON_ROWS as ROWS,COMPARISON_REFS as REFS,FAILED_AVAILABLE,LIMITS} from './fixed-cases.mjs';
import {checkComparisonCaseMetadata,validateComparisonMetadata} from './guard.mjs';
import {prepareComparisonSource} from './kernel.mjs';
const copy=structuredClone,denied=(fn,code)=>assert.throws(fn,e=>e.code===code);
function guard(){const rows=Array.from({length:100},(_,i)=>({audit_id:'SYNTHETIC_FRESH_AUDIT_'+i,contract_id:'SYNTHETIC_PROTECTED_'+i%29})),body={schema:'stored-reader-complete-fresh100-guard-v1',fresh_packet_ref:copy(REFS.relative_fresh_ref),source_epoch_sha256:REFS.metadata_source_epoch_ref.sha256,rows,contract_ids:[...new Set(rows.map(r=>r.contract_id))].sort()};return{...body,projection_sha256:digest(body)};}
function metadata(index=0){const b=CASES[index],row=copy(ROWS[index]);return{row,selected:{case_id:b.case_id,audit_id:b.audit_id,contract_id:b.contract_id,case_kind:'AVAILABLE_FOCAL',selection_role:'MANDATORY',stratum:null,focal:copy(row)},guard:guard(),refs:copy(b.source_refs),ordered_index:b.ordered_index};}
function reseal(g){delete g.projection_sha256;g.projection_sha256=digest(g);}

test('exact0055 then0047 retain independent focal/parent identities and declared ledgers',()=>{
  assert.deepEqual(CASES.map(c=>c.audit_id),['development-0055','development-0047']);assert.deepEqual(CASES.map(c=>c.ordered_index),[4,25]);
  for(const[i,b]of CASES.entries()){
    const input=metadata(i),out=checkComparisonCaseMetadata(input);
    assert.equal(digest(out.row),b.row_canonical_sha256);assert.equal(out.row.focal_kind,'ACTUAL_UNIT');assert.notEqual(out.row.focal_id,out.row.parent_id);
    assert.ok(out.row.focal_start>out.row.parent_start);assert.ok(out.row.focal_end<out.row.parent_end);assert.notEqual(out.row.focal_sha256,out.row.parent_sha256);
    assert.equal(out.guard.rows.length,100);assert.equal(out.guard.contract_ids.length,29);
    assert.equal(b.cache_storage.decoded_bytes+b.native_storage.decoded_bytes+b.source_refs.raw.bytes+b.source_refs.normalized.bytes,b.declared_combined_decoded_input_bytes);assert.ok(b.declared_combined_decoded_input_bytes<LIMITS.combined_decoded_input_bytes);
    assert.deepEqual(Object.keys(out.refs),['raw','normalized','cache','receipt','native']);
    for(const v of[out,out.row,out.selected,out.selected.focal,out.guard,out.guard.rows,out.refs,out.refs.native,out.binding])assert.ok(Object.isFrozen(v));
    input.row.parent_end++;input.guard.rows[0].contract_id='SYNTHETIC_CHANGED';input.refs.native.bytes++;
    assert.equal(out.row.parent_end,b.parent.end);assert.equal(out.guard.rows[0].contract_id,'SYNTHETIC_PROTECTED_0');assert.equal(out.refs.native.bytes,b.source_refs.native.bytes);
  }
});

test('0048 stays failed AVAILABLE before payload with no replacement and unchanged32MiB',()=>{
  const f=FAILED_AVAILABLE[0];assert.equal(f.audit_id,'development-0048');assert.equal(f.case_kind,'AVAILABLE_FOCAL');assert.equal(f.focal_kind,'ACTUAL_UNIT');assert.equal(f.status,'FAILED_AVAILABLE_RESOURCE_BOUND_BEFORE_PAYLOAD');
  assert.equal(f.source_payloads_opened,false);assert.equal(f.replacement_allowed,false);assert.equal(f.decoded_limit_bytes,33554432);
  assert.equal(f.cache_decoded_bytes+f.native_decoded_bytes+f.raw_bytes+f.normalized_bytes,36292934);assert.equal(f.excess_decoded_bytes,2738502);assert.ok(f.cache_decoded_bytes+f.native_decoded_bytes>f.decoded_limit_bytes);
  const input=metadata();input.selected.audit_id=f.audit_id;input.selected.contract_id=f.contract_id;input.selected.case_id=f.case_id;input.ordered_index=f.ordered_index;
  denied(()=>checkComparisonCaseMetadata(input),'COMPARISON_FIXED_CASE');
});

test('both protected fixed CIDs are denied with a complete resealed fictional guard',()=>{
  for(let i=0;i<2;i++){const input=metadata(i);for(const r of input.guard.rows)if(r.contract_id==='SYNTHETIC_PROTECTED_0')r.contract_id=CASES[i].contract_id;input.guard.contract_ids=[...new Set(input.guard.rows.map(r=>r.contract_id))].sort();reseal(input.guard);denied(()=>checkComparisonCaseMetadata(input),'COMPARISON_PROTECTED_CONTRACT');}
});

test('fixed geometry cannot swap focal/parent hashes, collapse to parent or move ranges',()=>{
  for(let i=0;i<2;i++)for(const change of[r=>r.focal_end++,r=>r.parent_start--,r=>{r.focal_start=r.parent_start;r.focal_end=r.parent_end;r.focal_sha256=r.parent_sha256;},r=>{[r.focal_sha256,r.parent_sha256]=[r.parent_sha256,r.focal_sha256];},r=>{r.parent_id=r.focal_id;}]){
    const input=metadata(i);change(input.row);input.selected.focal=copy(input.row);denied(()=>checkComparisonCaseMetadata(input),'COMPARISON_FIXED_GEOMETRY');
  }
});

test('canonical row binds nongeometry features and rejects unknown metadata keys',()=>{
  for(let i=0;i<2;i++){const input=metadata(i);input.row.native_mark_sources++;input.selected.focal=copy(input.row);denied(()=>checkComparisonCaseMetadata(input),'COMPARISON_CANONICAL_ROW');
    const extra=metadata(i);extra.row.source_text='SYNTHETIC_UNSUPPORTED';extra.selected.focal=copy(extra.row);assert.throws(()=>checkComparisonCaseMetadata(extra),/EXACT69_TYPED_SOURCE_ONLY_METADATA_REQUIRED/u);}
});

test('every path/hash/size substitution in either five-ref set is rejected',()=>{
  for(let i=0;i<2;i++)for(const name of Object.keys(CASES[i].source_refs))for(const field of['path','sha256','bytes']){const input=metadata(i);input.refs[name][field]=field==='path'?input.refs[name].path+'.other':field==='sha256'?'0'.repeat(64):input.refs[name].bytes+1;denied(()=>checkComparisonCaseMetadata(input),'COMPARISON_PAYLOAD_REF_SUBSTITUTION');}
  const extra=metadata();extra.refs.extra=copy(extra.refs.raw);denied(()=>checkComparisonCaseMetadata(extra),'COMPARISON_FIVE_REFS');
});

test('cross-case refs, ordered positions, identities and control relabeling are rejected',()=>{
  const cross=metadata();cross.refs=copy(CASES[1].source_refs);denied(()=>checkComparisonCaseMetadata(cross),'COMPARISON_PAYLOAD_REF_SUBSTITUTION');
  for(let i=0;i<2;i++)for(const change of[x=>{x.ordered_index=CASES[1-i].ordered_index;},x=>{x.selected.case_kind='UNAVAILABLE_CONTROL';},x=>{x.selected.selection_role='ADDITIONAL';},x=>{x.selected.case_id='0'.repeat(64);},x=>{x.selected.contract_id='SYNTHETIC_OTHER';},x=>{x.selected.stratum='CSS_EMPHASIS_PROXY';}]){const input=metadata(i);change(input);denied(()=>checkComparisonCaseMetadata(input),'COMPARISON_FIXED_CASE');}
});

test('missing, duplicate, corrupt and substituted complete fresh guards are rejected',()=>{
  const absent=metadata();delete absent.guard;denied(()=>checkComparisonCaseMetadata(absent),'COMPARISON_COMPLETE_FRESH_GUARD');
  const short=metadata();short.guard.rows.pop();reseal(short.guard);denied(()=>checkComparisonCaseMetadata(short),'COMPARISON_COMPLETE_FRESH_GUARD');
  const duplicate=metadata();duplicate.guard.rows[1].audit_id=duplicate.guard.rows[0].audit_id;reseal(duplicate.guard);denied(()=>checkComparisonCaseMetadata(duplicate),'COMPARISON_FRESH_ROW');
  const omitted=metadata();omitted.guard.contract_ids[0]='SYNTHETIC_UNOBSERVED';reseal(omitted.guard);denied(()=>checkComparisonCaseMetadata(omitted),'COMPARISON_FRESH_SEAL');
  const corrupt=metadata();corrupt.guard.projection_sha256='0'.repeat(64);denied(()=>checkComparisonCaseMetadata(corrupt),'COMPARISON_FRESH_SEAL');
  for(const field of['path','sha256','bytes']){const input=metadata();input.guard.fresh_packet_ref[field]=field==='path'?'SYNTHETIC_OTHER/fresh.json':field==='sha256'?'0'.repeat(64):1;reseal(input.guard);denied(()=>checkComparisonCaseMetadata(input),'COMPARISON_COMPLETE_FRESH_GUARD');}
});

test('main guard rejects reordered/truncated/forged policy before any metadata inspection',()=>{
  const reverse=copy(CASES).reverse(),short=copy(CASES).slice(0,1),extra=[...copy(CASES),copy(CASES[0])],forged=copy(CASES);forged[0].parent.end++;
  for(const bindings of[reverse,short,extra,forged,{fixture:true},{source_kind:'SOURCE_FREE_FIXTURE'}])denied(()=>validateComparisonMetadata({bindings,input:null,typedRoster:null,manifest:null,development:null}),'COMPARISON_PINNED_BINDINGS');
});

test('kernel rejects old0045/failed0048/unknown IDs and invalid bytes before epoch source IO',async()=>{
  for(const audit_id of['development-0045','development-0048','SYNTHETIC_UNKNOWN'])await assert.rejects(prepareComparisonSource({row:{audit_id},rawBytes:Buffer.alloc(0)}),e=>e.code==='COMPARISON_FIXED_CASE');
  for(const row of ROWS){await assert.rejects(prepareComparisonSource({row,rawBytes:Buffer.alloc(0)}),e=>e.code==='ADVERSE_FIXED_RAW_BYTES');await assert.rejects(prepareComparisonSource({row,rawBytes:Buffer.alloc(row.raw_bytes)}),e=>e.code==='ADVERSE_EXACT_UTF8_RAW');}
});
