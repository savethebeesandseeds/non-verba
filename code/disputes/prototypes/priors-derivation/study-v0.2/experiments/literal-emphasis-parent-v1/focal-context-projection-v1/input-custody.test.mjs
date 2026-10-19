// SPDX-License-Identifier: AGPL-3.0-only
// Authored SOURCE_FREE fixtures. No actual artifacts, source words or permits.
import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSections} from '../sections.prototype.mjs';
import {sha,digest} from '../finite-codec.mjs';
import {RUN,SOURCE,COMPARISON_CASES,FAILED_AVAILABLE} from '../source-only-adverse-comparison-v1/fixed-cases.mjs';
import {checkContextPolicyScope,checkContextCustodyMetadata,validateContextInputCustody,checkBaselineArtifact,verifyBaselineArtifact} from './input-custody.mjs';
const Q=RUN+'/qa/literal-emphasis-parent-v1-boundary-activation-probe-v1';
const methods={tracer_sha256:'803a661ac8880d1f43bdf99f2a8303402cd3c9ecdd0e16981b10e8fc2fda4d02',baseline_collector_sha256:'96bfc4a6baab4e31efa0b7f7a21ea2bed158983adc6ff8556d3ac5d6769142cd'};
const runtime={path:'/opt/nonverba-tools/node/bin/node',sha256:'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48',bytes:124827920};
const flags=['--max-old-space-size=256','--disable-proto=throw','--experimental-vm-modules'];
const clone=structuredClone,deny=(f,code)=>assert.throws(f,e=>e.code===code),ref=path=>({path,sha256:'a'.repeat(64),bytes:1});
const id=b=>({audit_id:b.audit_id,contract_id:b.contract_id,case_id:b.case_id});
function guardFixture(){const rows=Array.from({length:100},(_,i)=>({audit_id:'SYNTHETIC_FRESH_'+i,contract_id:'SYNTHETIC_PROTECTED_'+i%29}));const g={schema:'stored-reader-complete-fresh100-guard-v1',rows,contract_ids:[...new Set(rows.map(r=>r.contract_id))].sort()};return{...g,projection_sha256:digest(g)};}
// Exact historical metadata schema retained in the actual Q15/Q16 policies;
// these are failure metadata, not actual contract/source payload fixtures.
function historicalFailure(){return[{original_order_rank:2,audit_id:'development-0048',contract_id:'contract-8faf2a71fbf78fa09f1c',case_kind:'AVAILABLE_FOCAL',focal_kind:'ACTUAL_UNIT',focal:[60131,61938],parent:[29177,407893],duplicate:false,cache_decoded:5982449,native_decoded:28524170,raw_bytes:1377002,normalized_bytes:409313,combined_input_decoded:36292934,encoded_cache:638285,encoded_native:2084271,protected_CID:false,prospective_status:'FAILED_AVAILABLE_RESOURCE_BOUND_BEFORE_PAYLOAD',excess_decoded_bytes:2738502,replacement_allowed:false}];}
function metadataFixture(){
  const bindings=clone(COMPARISON_CASES),policy={source_metadata_bindings:bindings,source_sha256:SOURCE,methods,failed_available:historicalFailure(),prior_charged_bytes:10,prior_source_active_ms:20,prior_capture_bytes:30,prior_journal_rows:40,prior_journal_bytes:50};
  for(const k of ['completion','admission','source_epoch','pending','manifest','closed','terminal'])policy['prior_'+k+'_ref']=ref('/SYNTHETIC/'+k+'.json');policy.guard_ref=ref('/SYNTHETIC/guard.json');
  const summaries=[];policy.baseline_inputs=bindings.map((b,i)=>{const baseline_ref={path:Q+'/outputs/'+b.audit_id+'/baseline.json.gz',sha256:'b'.repeat(64),bytes:50,encoding:'gzip',decoded_bytes:100,decoded_sha256:'c'.repeat(64)},summary_ref=ref(Q+'/outputs/'+b.audit_id+'/summary.json');summaries.push({schema:'boundary-source-replay-summary-v1',case_id:b.case_id,audit_number:Number(b.audit_id.slice(-4)),comparison_sequence_index:i,current_source_sha256:SOURCE,raw_sha256:b.source_refs.raw.sha256,normalized_sha256:b.source_refs.normalized.sha256,baseline_core_bridge_equal:true,baseline_native_exact_prior_bytes:true,quality_gate_pass:false,authority:'NONE',baseline:{collector_sha256:methods.baseline_collector_sha256,artifact_sha256:baseline_ref.decoded_sha256,artifact_bytes:baseline_ref.decoded_bytes}});return{audit_number:Number(b.audit_id.slice(-4)),case_id:b.case_id,baseline_ref,summary_ref};});
  const code=ref('/tmp/nonverba-unified-source/'+'1'.repeat(32)+'/code/synthetic.mjs'),epoch={schema:'boundary-source-replay-source-epoch-v1',authority:'NONE',runtime_ref:runtime,node_flags:flags,source_refs:[code]};
  const admission={schema:'ROOT_BOUNDARY_SOURCE_REPLAY_ADMISSION_V1',status:'ADMITTED_EXACT_TWO_CASE_SOURCE_ONLY_REPLAY',root:Q,source_epoch_ref:policy.prior_source_epoch_ref,policy_ref:ref('/SYNTHETIC/old-policy.json'),cases:bindings.map(id),model_access:false,tokenizer_access:false,quality_gate_pass:false,runtime_ref:runtime,node_flags:flags,source_refs:[code]};
  for(const k of ['run_entry_ref','guard_entry_ref','custody_entry_ref','kernel_entry_ref','checker_entry_ref','probe_helper_ref'])admission[k]=code;
  const cases=policy.baseline_inputs.map(x=>({...x})),actor={pid:123,start_ticks:'456',group:123};
  const completion={schema:'boundary-source-replay-completion-v1',status:'COMPLETE_BOUNDARY_SOURCE_REPLAY_NOT_QUALITY',original_actor_absent:true,all_replay_artifacts_rehashed:true,baseline_prior_native_identity_verified:true,activation_probes_verified:true,observational_V2_core_equal:true,observational_V2_native_equal:true,quality_gate_pass:false,source_quality_passed:false,model_access:false,tokenizer_access:false,authority:'NONE',admission_ref:policy.prior_admission_ref,pending_ref:policy.prior_pending_ref,manifest_ref:policy.prior_manifest_ref,source_epoch_ref:policy.prior_source_epoch_ref,metadata_guard_ref:policy.guard_ref,policy_ref:admission.policy_ref,cases,original_actor:actor,boot_id:'SYNTHETIC_BOOT',origin_ns:'789',initial_active_carry_ms:0};
  const pending={schema:'boundary-source-replay-exit-pending-v1',status:'PENDING_EXTERNAL_ROOT_EXIT_READBACK',own_exit_claimed:false,actor,boot_id:completion.boot_id,origin_ns:completion.origin_ns,initial_active_carry_ms:0,admission_ref:policy.prior_admission_ref,source_epoch_ref:policy.prior_source_epoch_ref,manifest_ref:policy.prior_manifest_ref,metadata_guard_ref:policy.guard_ref};
  const manifest={schema:'boundary-source-replay-output-manifest-v1',status:'SOURCE_ONLY_REPLAY_PREPARED_PENDING_EXTERNAL_ROOT_EXIT',admission_ref:policy.prior_admission_ref,source_epoch_ref:policy.prior_source_epoch_ref,metadata_guard_ref:policy.guard_ref,semantic_review_complete:false,quality_gate_pass:false,model_access:false,failed_available:policy.failed_available,cases:bindings.map((b,i)=>({...id(b),baseline_ref:policy.baseline_inputs[i].baseline_ref,summary_ref:policy.baseline_inputs[i].summary_ref}))};
  const closed={schema:'ROOT-boundary-source-replay-clock-closed-v1',source_replay_clock_closed:true,completion_ref:policy.prior_completion_ref,source_replay_active_ms_charged:20,charged_pilot_bytes:10,cumulative_private_and_metadata_capture_bytes:30,cumulative_journal_rows:40,cumulative_journal_bytes:50,unused_reservations_not_refunded:true,quality_gate_pass:false};
  const terminal={schema:'ROOT-boundary-probe-terminal-followup-v1',clock_close_ref:policy.prior_closed_ref,charged_pilot_bytes:10,source_active_ms_closed:20,quality_gate_pass:false,goal_complete:false,authority:'NONE'};
  return{policy,completion,admission,epoch,pending,manifest,closed,terminal,summaries,guard:guardFixture()};
}

test('actual historical failure schema normalizes shared facts without relabeling or replacements',()=>{
  const policy={...metadataFixture().policy,QA_root:RUN+'/qa/literal-emphasis-parent-v1-focal-context-projection-v1-retry2',manual_reader_opening:false,model_access:false,tokenizer_access:false,quality_gate_pass:false,authority:'NONE'},before=clone(policy);
  assert.notDeepEqual(policy.failed_available,FAILED_AVAILABLE);assert.equal(checkContextPolicyScope(policy),true);assert.deepEqual(policy,before);
  for(const mutate of[
    r=>{r.audit_id='development-0047';},r=>{r.contract_id='SYNTHETIC_REPLACEMENT';},r=>{r.original_order_rank=3;},r=>{r.prospective_status='AVAILABLE';},r=>{r.cache_decoded++;},r=>{r.combined_input_decoded++;},r=>{r.excess_decoded_bytes--;},r=>{r.replacement_allowed=true;},r=>{r.source_payloads_opened=false;},r=>{delete r.native_decoded;}
  ]){const bad=clone(policy);mutate(bad.failed_available[0]);assert.throws(()=>checkContextPolicyScope(bad),e=>['CONTEXT_INPUT_FAILED_AVAILABLE_SCHEMA','CONTEXT_INPUT_FAILED_AVAILABLE_FACTS'].includes(e.code));}
  const typed=clone(policy);typed.failed_available=clone(FAILED_AVAILABLE);deny(()=>checkContextPolicyScope(typed),'CONTEXT_INPUT_FAILED_AVAILABLE_SCHEMA');
});

test('metadata joins return detached immutable allowlist without actual authority',()=>{
  const f=metadataFixture(),v=checkContextCustodyMetadata(f);assert.equal(v.actual_io_authority,false);assert.equal(v.authority,'NONE');assert.equal(v.cases.length,2);assert.ok(Object.isFrozen(v.cases[0].baseline_ref));f.policy.baseline_inputs[0].baseline_ref.path='/SYNTHETIC_CHANGED';assert.notEqual(v.cases[0].baseline_ref.path,'/SYNTHETIC_CHANGED');
});
test('protected CID stays rejected even after guard resealing',()=>{
  const f=metadataFixture();f.guard.rows[0].contract_id=f.policy.source_metadata_bindings[0].contract_id;f.guard.rows[29].contract_id='SYNTHETIC_PROTECTED_0';f.guard.contract_ids=[...new Set(f.guard.rows.map(r=>r.contract_id))].sort();
  // Keep exactly29 CIDs while introducing the fixed exposed contract.
  f.guard.rows=f.guard.rows.map(r=>r.contract_id==='SYNTHETIC_PROTECTED_1'?{...r,contract_id:'SYNTHETIC_PROTECTED_2'}:r);f.guard.contract_ids=[...new Set(f.guard.rows.map(r=>r.contract_id))].sort();const{projection_sha256,...body}=f.guard;f.guard.projection_sha256=digest(body);
  deny(()=>checkContextCustodyMetadata(f),'CONTEXT_INPUT_PROTECTED_CID');
});
test('fixed order, swapped case outputs and baseline substitution are denied',()=>{
  const f=metadataFixture();f.policy.source_metadata_bindings.reverse();deny(()=>checkContextCustodyMetadata(f),'CONTEXT_INPUT_FIXED_ORDER');
  const g=metadataFixture();g.manifest.cases.reverse();deny(()=>checkContextCustodyMetadata(g),'CONTEXT_INPUT_CASE_JOIN');
  const h=metadataFixture();h.completion.cases[0].baseline_ref={...h.completion.cases[0].baseline_ref,decoded_sha256:'d'.repeat(64)};deny(()=>checkContextCustodyMetadata(h),'CONTEXT_INPUT_OUTPUT_REFS');
});
test('source-epoch membership, actor joins and retained carry cannot be bypassed',()=>{
  const f=metadataFixture();f.admission.kernel_entry_ref=ref('/SYNTHETIC_UNBOUND');deny(()=>checkContextCustodyMetadata(f),'CONTEXT_INPUT_ENTRY_SOURCE_REF');
  const g=metadataFixture();g.pending.actor={...g.pending.actor,start_ticks:'999'};deny(()=>checkContextCustodyMetadata(g),'CONTEXT_INPUT_PENDING');
  const h=metadataFixture();h.closed.charged_pilot_bytes--;deny(()=>checkContextCustodyMetadata(h),'CONTEXT_INPUT_CLOSED_CARRY');
  const j=metadataFixture();j.guard.rows.pop();deny(()=>checkContextCustodyMetadata(j),'CONTEXT_INPUT_FRESH100');
});
test('strict actual metadata route has no fixture or arbitrary-policy escape',()=>{
  deny(()=>validateContextInputCustody(metadataFixture()),'CONTEXT_INPUT_PINNED_POLICY');deny(()=>validateContextInputCustody({policy:{fixture:true}}),'CONTEXT_INPUT_PINNED_POLICY');
});

function artifactFixture(){
  const raw='<html><body><h2>1. Synthetic permission</h2><p>The synthetic permission depends on the following conditions:</p><p>(i) '+Array(320).fill('retain').join(' ')+';</p><p>(ii) The synthetic holder keeps the receipt;</p><p>This synthetic qualification governs every item.</p></body></html>';
  const record={id:'SYNTHETIC_CONTEXT_BASELINE',format:'html',path:'raw/SYNTHETIC_CONTEXT_BASELINE.html',source_url:'https://synthetic.invalid/context'};
  const extraction=extractSections({...record,content:raw},{minWords:1,maxUnitWords:300,nativeDecorationIdentity:{tracerSourceSHA256:methods.tracer_sha256,collectorSourceSHA256:methods.baseline_collector_sha256}}),parent=extraction.sections[0],unit=parent.units.at(-1),native=extraction.native_source_decorations;
  const sourceBody={schema:'SYNTHETIC_SOURCE_PROOF',control:true},source={...sourceBody,sha256:digest(sourceBody)};
  const binding={audit_id:'SYNTHETIC_EXPOSED',contract_id:record.id,case_id:'e'.repeat(64),current_source_sha256:source.sha256,source_refs:{raw:{sha256:sha(raw),bytes:Buffer.byteLength(raw)},normalized:{sha256:sha(extraction.normalized_text),bytes:Buffer.byteLength(extraction.normalized_text)}},focal:{start:unit.start,end:unit.end,sha256:unit.sha256},parent:{id:parent.id,start:parent.start,end:parent.end,sha256:parent.sha256}};
  const row={raw_path:record.path,focal_id:unit.id,focal_start:unit.start,focal_end:unit.end,focal_sha256:unit.sha256},custody={synthetic_metadata_only:true};
  const artifact={schema:'boundary-source-replay-artifact-v1',source_kind:'ACTUAL_EXPLORATORY_SOURCE_ONLY',method_kind:'BASELINE_NINE_TAG',...id(binding),current_source_sha256:source.sha256,selection_recomputed:false,source_words_truncated:false,quality_gate_pass:false,authority:'NONE',record,raw_full:raw,source_proof:source,method:{tracer_sha256:methods.tracer_sha256,collector_sha256:methods.baseline_collector_sha256,boundary_policy:null},original_focal:{id:unit.id,start:unit.start,end:unit.end,sha256:unit.sha256},original_parent:binding.parent,custody,extraction};
  const{sha256:seal,collector_source_sha256,...nativeBody}=native,unknown={unmapped:native.unmapped,unmapped_normalized:native.unmapped_normalized,ambiguous_segments:native.ambiguous_segments,joint_whitespace_segments:native.joint_whitespace_segments,blocking_ambiguous_segments:native.blocking_ambiguous_segments,collector_issues:native.collector_issues,trace_unresolved:native.trace.unresolved,parser_errors:native.trace.parser_errors};
  const baseline={collector_sha256:methods.baseline_collector_sha256,native_envelope_sha256:native.sha256,native_invariant_sha256:digest(nativeBody),trace_sha256:native.trace.sha256,segments_sha256:digest(native.segments),unknowns_sha256:digest(unknown),geometry_sha256:digest({sections:extraction.sections.map(s=>({id:s.id,start:s.start,end:s.end,sha256:s.sha256})),units:extraction.units.map(u=>({id:u.id,parent_section_id:u.parent_section_id,start:u.start,end:u.end,sha256:u.sha256}))}),section_count:extraction.sections.length,unit_count:extraction.units.length,original_focal_id_sha256:sha(unit.id),original_parent_id_sha256:sha(parent.id),original_focal_identity_present:true,original_parent_identity_present:true,selection_recomputed:false,quality_gate_pass:false,authority:'NONE',artifact_bytes:Buffer.byteLength(JSON.stringify(artifact)),artifact_sha256:sha(JSON.stringify(artifact))};
  return{artifact,binding,row,summary:{case_id:binding.case_id,current_source_sha256:source.sha256,raw_sha256:binding.source_refs.raw.sha256,normalized_sha256:binding.source_refs.normalized.sha256,custody_sha256:digest(custody),baseline}};
}
test('decoded baseline helper verifies a real synthetic collector and grants no actual route',()=>{
  const f=artifactFixture();assert.ok(f.artifact.extraction.units.length>1);assert.equal(checkBaselineArtifact(f),true);deny(()=>verifyBaselineArtifact(f),'CONTEXT_BASELINE_FIXED_CASE');
});
test('altered raw/native method, focal and parent literals are rejected',()=>{
  const a=artifactFixture();a.artifact.raw_full+='X';deny(()=>checkBaselineArtifact(a),'CONTEXT_BASELINE_SOURCE');
  const b=artifactFixture();b.artifact.method.collector_sha256='0'.repeat(64);deny(()=>checkBaselineArtifact(b),'CONTEXT_BASELINE_METHOD');
  const c=artifactFixture();c.artifact.original_focal.sha256='0'.repeat(64);deny(()=>checkBaselineArtifact(c),'CONTEXT_BASELINE_IDENTITY');
  const d=artifactFixture();d.artifact.extraction.sections[0].text+='X';deny(()=>checkBaselineArtifact(d),'CONTEXT_BASELINE_LITERAL');
});
test('duplicate units, summary geometry drift and scoped native substitution fail closed',()=>{
  const a=artifactFixture();a.artifact.extraction.units.push(clone(a.artifact.extraction.units[0]));deny(()=>checkBaselineArtifact(a),'CONTEXT_BASELINE_IDENTITY');
  const b=artifactFixture();b.summary.baseline.geometry_sha256='0'.repeat(64);deny(()=>checkBaselineArtifact(b),'CONTEXT_BASELINE_SUMMARY_FACTS');
  const c=artifactFixture();c.artifact.extraction.units[0].native_source_decorations_ref.envelope_sha256='0'.repeat(64);deny(()=>checkBaselineArtifact(c),'CONTEXT_BASELINE_NATIVE_REF');
});
