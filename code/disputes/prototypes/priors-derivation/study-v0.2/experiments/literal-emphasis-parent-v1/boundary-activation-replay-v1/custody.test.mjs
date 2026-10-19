// SPDX-License-Identifier: AGPL-3.0-only
// Inert in-memory metadata controls. Fictional actors/guard/code refs are NOT
// actual attestations; no original report buffers, source words or IO occur.
import test from 'node:test';
import assert from 'node:assert/strict';
import {digest} from '../finite-codec.mjs';
import {COMPARISON_CASES as CASES,COMPARISON_ROWS as ROWS,COMPARISON_REFS as REFS,FAILED_AVAILABLE} from '../source-only-adverse-comparison-v1/fixed-cases.mjs';
import {REPLAY_PRIOR_REFS as PRIOR,REPLAY_DERIVED_INPUTS as DERIVED,checkReplayCustodyMetadata,validateReplayCustody} from './custody.mjs';
const copy=structuredClone,identity=b=>({audit_id:b.audit_id,contract_id:b.contract_id,case_id:b.case_id});
function fixture(){
 const rows=Array.from({length:100},(_,i)=>({audit_id:'SYNTHETIC_FRESH_'+i,contract_id:'SYNTHETIC_PROTECTED_'+i%29})),body={schema:'stored-reader-complete-fresh100-guard-v1',source_epoch_sha256:REFS.metadata_source_epoch_ref.sha256,fresh_packet_ref:copy(REFS.relative_fresh_ref),rows,contract_ids:[...new Set(rows.map(r=>r.contract_id))].sort()},guard={...body,projection_sha256:digest(body)};
 const identities=CASES.map(identity),source_refs=[{path:'/SYNTHETIC_CODE/literal-emphasis-parent-v1/sections.prototype.mjs',sha256:DERIVED[0].baseline_collector_sha256,bytes:1},{path:'/SYNTHETIC_CODE/literal-emphasis-parent-v1/source-decoration.prototype.mjs',sha256:DERIVED[0].baseline_tracer_sha256,bytes:1}],runtime={path:'/SYNTHETIC_CODE/node',sha256:'1'.repeat(64),bytes:1},flags=['SYNTHETIC_INERT'],actor={pid:101,start_ticks:'202',group:101};
 const failed=[{audit_id:'development-0048',prospective_status:'FAILED_AVAILABLE_RESOURCE_BOUND_BEFORE_PAYLOAD',replacement_allowed:false}];
 const comparison={cases:CASES.map((b,i)=>({row:copy(ROWS[i]),binding:copy(b),refs:copy(b.source_refs),guard})),guard,failed_available:copy(FAILED_AVAILABLE),source_payloads_opened:false,authority:'NONE'};
 const priorCompletion={schema:'two-case-source-only-completion-v1',status:'COMPLETE_SOURCE_ONLY_PREPARATION_NOT_QUALITY',cases:identities.map((b,i)=>({...b,manifest_ref:copy(DERIVED[i].manifest_ref),source_input_decoded_bytes:CASES[i].declared_combined_decoded_input_bytes})),admission_ref:copy(PRIOR.admission),pending_ref:copy(PRIOR.pending),source_epoch_ref:copy(PRIOR.epoch),metadata_guard_ref:copy(REFS.metadata_inputs.guard),original_actor:copy(actor),original_actor_absent:true,boot_id:'SYNTHETIC_BOOT',origin_ns:'1',initial_active_carry_ms:479198,all_output_documents_rehashed:true,finite9_literal_roundtrip_verified:true,actual_source_only:true,semantic_reading_complete:false,full69_complete:false,model_access:false,quality_gate_pass:false,failed_available:copy(failed)};
 const priorAdmission={schema:'ROOT_TWO_CASE_SOURCE_ONLY_ADMISSION_V1',status:'ADMITTED_PREPARATION_AND_BOUNDED_EXPLORATORY_PAGES',root:REFS.run+'/qa/literal-emphasis-parent-v1-source-only-adverse-comparison-v1',cases:copy(identities),source_epoch_ref:copy(PRIOR.epoch),source_refs,runtime_ref:runtime,node_flags:flags,metadata_source_epoch_ref:copy(REFS.metadata_source_epoch_ref),model_access:false,tokenizer_access:false,quality_gate_pass:false,coding_authority:false,failed_available:copy(failed)};
 const priorEpoch={schema:'two-case-source-only-source-epoch-v1',source_refs,runtime_ref:runtime,node_flags:flags,authority:'NONE'};
 const priorPending={schema:'two-case-source-only-exit-pending-v1',status:'PENDING_EXTERNAL_ROOT_EXIT_READBACK',manifest_refs:copy(priorCompletion.cases),admission_ref:copy(PRIOR.admission),source_epoch_ref:copy(PRIOR.epoch),metadata_guard_ref:copy(REFS.metadata_inputs.guard),actor:copy(actor),boot_id:'SYNTHETIC_BOOT',origin_ns:'1',initial_active_carry_ms:479198,actual_source_only:true,quality_gate_pass:false,own_exit_claimed:false};
 const manifests=CASES.map((b,i)=>({schema:'exploratory-source-only-output-manifest-v1',...identity(b),admission_ref:copy(PRIOR.admission),source_epoch_ref:copy(PRIOR.epoch),metadata_guard_ref:copy(REFS.metadata_inputs.guard),descriptor_ref:copy(DERIVED[i].descriptor_ref),documents:{raw_full:copy(DERIVED[i].raw_document_ref),normalized_full:copy(DERIVED[i].normalized_document_ref),new_native:copy(DERIVED[i].native_document_ref)},actual_source_bytes_opened:true,semantic_review_complete:false,full69_complete:false,model_access:false,quality_gate_pass:false}));
 const descriptors=CASES.map((b,i)=>({schema:'fixed-case-source-only-adverse-comparison-descriptor-v1',audit_id:b.audit_id,contract_id:b.contract_id,current_source_sha256:b.current_source_sha256,focal_kind:'ACTUAL_UNIT',focal:{id:ROWS[i].focal_id,start:b.focal.start,end:b.focal.end,sha256:b.focal.sha256},parent:copy(b.parent),focal_equals_parent_range:false,focal_equals_parent_id:false,epoch_sha256:DERIVED[i].baseline_epoch_sha256,tracer_source_sha256:DERIVED[i].baseline_tracer_sha256,collector_source_sha256:DERIVED[i].baseline_collector_sha256,old_native_envelope_sha256:b.native_envelope_sha256,new_native_envelope_sha256:DERIVED[i].baseline_envelope_sha256,raw_sha256:b.source_refs.raw.sha256,normalized_sha256:b.source_refs.normalized.sha256,non_native_fields_equal:true,selection_equal:true,normalized_literal_equal:true,source_words_truncated:false,tokenizer_calls:0,model_inference:false}));
 return{comparison,priorCompletion,priorAdmission,priorEpoch,priorPending,manifests,descriptors};
}
const denied=(input,code)=>assert.throws(()=>checkReplayCustodyMetadata(input),e=>e.code===code);
test('fictional metadata chain returns detached immutable fixed cases without authority',()=>{
 const input=fixture(),out=checkReplayCustodyMetadata(input);
 assert.deepEqual(out.cases.map(c=>c.row.audit_id),['development-0055','development-0047']);assert.equal(out.actual_io_authority,false);assert.equal(out.authority,'NONE');
 assert.deepEqual(out.cases.map(c=>c.native_document_ref.decoded_bytes),[862794,2517046]);
 assert.deepEqual(DERIVED.map(d=>d.input_decoded_bytes),[1331457,3584431]);
 for(const x of[out,out.cases,out.cases[0],out.cases[0].row,out.cases[0].descriptor,out.guard.rows[0]])assert.ok(Object.isFrozen(x));
 input.descriptors[0].parent.end++;assert.equal(out.cases[0].descriptor.parent.end,25329);assert.ok(!Object.hasOwn(out.cases[0],'record'));
});
test('protected CID remains denied even after a complete fictional guard is resealed',()=>{
 const input=fixture(),g=input.comparison.guard;for(const r of g.rows)if(r.contract_id==='SYNTHETIC_PROTECTED_0')r.contract_id=CASES[0].contract_id;
 g.contract_ids=[...new Set(g.rows.map(r=>r.contract_id))].sort();delete g.projection_sha256;g.projection_sha256=digest(g);
 denied(input,'REPLAY_PROTECTED_CID');
});
test('fixed comparison and every prior ordered case mapping reject swaps',()=>{
 for(const[name,field,code]of[['comparison','cases','REPLAY_FIXED_COMPARISON_CASE'],['priorCompletion','cases','REPLAY_COMPLETION_ORDER'],['priorAdmission','cases','REPLAY_ADMISSION_ORDER'],['priorPending','manifest_refs','REPLAY_PENDING_ORDER']]){const input=fixture();input[name][field].reverse();denied(input,code);}
 const input=fixture();input.manifests.reverse();denied(input,'REPLAY_PRIOR_MANIFEST');
});
test('manifest reference substitutions and descriptor swaps are denied',()=>{
 const input=fixture();input.priorPending.manifest_refs[0].manifest_ref=copy(DERIVED[1].manifest_ref);denied(input,'REPLAY_PRIOR_MANIFEST_MAPPING');
 const descriptors=fixture();descriptors.descriptors.reverse();denied(descriptors,'REPLAY_BASELINE_GEOMETRY');
});
test('each derived source document reference is exact, including native encoded/decoded seals',()=>{
 for(const name of['raw_full','normalized_full','new_native'])for(const field of['path','sha256','bytes','decoded_sha256','decoded_bytes','encoding']){const input=fixture(),r=input.manifests[0].documents[name];r[field]=field==='path'?r.path+'.other':field.includes('sha256')?'0'.repeat(64):field.includes('bytes')?r[field]+1:'SYNTHETIC_OTHER';denied(input,'REPLAY_DERIVED_DOCUMENT_REFS');}
});
test('current source and either baseline geometry cannot drift',()=>{
 const source=fixture();source.comparison.cases[0].row.source_sha256='0'.repeat(64);denied(source,'REPLAY_FIXED_COMPARISON_CASE');
 for(const scope of['focal','parent']){const input=fixture();input.descriptors[1][scope].end++;denied(input,'REPLAY_BASELINE_GEOMETRY');}
});
test('old V4 native envelope is not relabelled as the Q12 baseline',()=>{
 const input=fixture();input.descriptors[0].new_native_envelope_sha256=CASES[0].native_envelope_sha256;denied(input,'REPLAY_BASELINE_METHOD');
 const epoch=fixture();epoch.priorEpoch.source_refs[0].sha256='0'.repeat(64);denied(epoch,'REPLAY_BASELINE_SOURCE_PIN');
});
test('prior admission/epoch/exit chain remains joined',()=>{
 const input=fixture();input.priorCompletion.source_epoch_ref.sha256='0'.repeat(64);denied(input,'REPLAY_PRIOR_REFS');
 const actor=fixture();actor.priorPending.actor.start_ticks='999';denied(actor,'REPLAY_PRIOR_PENDING');
 const gate=fixture();gate.priorCompletion.quality_gate_pass=true;denied(gate,'REPLAY_PRIOR_COMPLETION');
});
test('missing guard and alteration of retained0048 failure are denied',()=>{
 const input=fixture();input.comparison.guard.rows.pop();denied(input,'REPLAY_COMPLETE_GUARD');
 const failed=fixture();failed.comparison.failed_available=[];denied(failed,'REPLAY_COMPARISON');
});
test('actual ROOT route has no fixture flag or arbitrary policy escape',()=>{
 assert.throws(()=>validateReplayCustody({...fixture(),policy:{fixture:true}}),e=>e.code==='REPLAY_PINNED_POLICY');
 assert.throws(()=>validateReplayCustody({...fixture(),policy:{QA_root:'/SYNTHETIC_OTHER',authority:'NONE'}}),e=>e.code==='REPLAY_PINNED_POLICY');
});
