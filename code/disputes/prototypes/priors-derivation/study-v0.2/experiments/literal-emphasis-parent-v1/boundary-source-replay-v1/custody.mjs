// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE. Pure custody denial checks; no filesystem, runtime or IO permit.
import {digest,sha} from '../finite-codec.mjs';
import {immutableCopy} from '../immutable-state.mjs';
import {COMPARISON_CASES as CASES,COMPARISON_REFS as REFS,FAILED_AVAILABLE,SOURCE} from '../source-only-adverse-comparison-v1/fixed-cases.mjs';
const Q=REFS.run+'/qa/literal-emphasis-parent-v1-source-only-adverse-comparison-v1';
const POLICY_DIGEST='7f300e7b685e18543bf9717aa59bcb44a4b47d54a19432ecab95cfaece48d538';
const BASE_EPOCH='67813e63f2e4b39c7cfc22d79a107c3c2fc7e8c14e1ac620c1ad6aa1979013e2';
const TRACER='803a661ac8880d1f43bdf99f2a8303402cd3c9ecdd0e16981b10e8fc2fda4d02';
const COLLECTOR='96bfc4a6baab4e31efa0b7f7a21ea2bed158983adc6ff8556d3ac5d6769142cd';
const check=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
const same=(a,b)=>digest(a)===digest(b);
const ref=(name,sha256,bytes)=>({path:Q+'/'+name,sha256,bytes});
const identity=b=>({audit_id:b.audit_id,contract_id:b.contract_id,case_id:b.case_id});
export const REPLAY_PRIOR_REFS=immutableCopy({
 completion:ref('ROOT-source-only-completion.json','d0d40307f1ab055e71f8de596f81fe9460f3bbe7f79546fc0b60ae781d5c9c00',4825),
 admission:ref('ROOT-two-case-admission.json','43bd7b21c866982f368e2439329d24a38a9976b954bec51229b62c3bc5337d55',47178),
 epoch:ref('ROOT-source-epoch.json','5a6ff14a55248e1965cad9fac2190404f4328e3c257c753ffbec9a32c16feff5',40740),
 pending:ref('exit-pending.json','ecab0e6f7b192f6bdb8936e6f329366ee83b2581fa4156911efd155e771269f9',3451)
});
function document(path,sha256,bytes,encoding='identity',decoded_bytes=bytes,decoded_sha256=sha256){return{path,sha256,bytes,encoding,decoded_bytes,decoded_sha256};}
function derived(index,pins){const b=CASES[index],prefix=Q+'/outputs/'+b.audit_id+'/';return{...identity(b),manifest_ref:ref('outputs/'+b.audit_id+'/manifest.json',pins[0],pins[1]),descriptor_ref:ref('outputs/'+b.audit_id+'/descriptor.json',pins[2],pins[3]),raw_document_ref:document(prefix+'raw_full.txt',b.source_refs.raw.sha256,b.source_refs.raw.bytes),normalized_document_ref:document(prefix+'normalized_full.txt',b.source_refs.normalized.sha256,b.source_refs.normalized.bytes),native_document_ref:document(prefix+'new_native.json.gz',pins[4],pins[5],'gzip',pins[6],pins[7]),baseline_envelope_sha256:pins[8],baseline_epoch_sha256:BASE_EPOCH,baseline_tracer_sha256:TRACER,baseline_collector_sha256:COLLECTOR,input_decoded_bytes:b.cache_storage.decoded_bytes+b.source_refs.raw.bytes+b.source_refs.normalized.bytes+pins[6]};}
/** Fixed references are metadata, never IO capabilities. */
export const REPLAY_DERIVED_INPUTS=immutableCopy([
 derived(0,['4e4205bbf40b446b158fc8e0cb789ca216de23fadfdfb15d4527bfe000b7abd0',6529,'2a6a0f992573b555202ff05edd950841a4dc956ae6daad3c41a8f0447a8dc490',3010,'8a29ec4a2b00d78adf5c9bfc99b19209db8e954f295dd1c8980c02b5839e9752',85718,862794,'db22a3216151a6e546201cba68373e9fc5f7a160b5b75b8c59722cfec69b7616','b3b12a7bd64acd06fd0bd0f8d374c4161cfa3db17735d4b3c6bfd19c9bd90bf3']),
 derived(1,['beb3633c065a4b0e05481e4b86b29792ed421cc5c26609a2297d20a6d20fc29b',6536,'1c9004f07d3bc3ac5e44fc9e39d4c342f3ace0199c1e079c26261aa71285e9aa',3016,'aef11662220ad03cb4a4d2693d8aff5cef7b119d1f392ec8ac4863496026f844',255858,2517046,'bb805d2d5f6517622826b8b3ec6b8024a2229e2e0811ed30bbfbf3bfe2b46150','aa604d0d5925293afea8f305c9e1bfb8e406982947b8e158150992a1158a2834'])
]);
function stored(value,r,code){const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');check(bytes.length===r.bytes&&sha(bytes)===r.sha256,code);}
function guarded(g,cid){
 check(g?.schema==='stored-reader-complete-fresh100-guard-v1'&&g.source_epoch_sha256===REFS.metadata_source_epoch_ref.sha256&&same(g.fresh_packet_ref,REFS.relative_fresh_ref)&&Array.isArray(g.rows)&&g.rows.length===100&&Array.isArray(g.contract_ids)&&g.contract_ids.length===29,'REPLAY_COMPLETE_GUARD');
 const ids=new Set(),audits=new Set();for(const r of g.rows){check(r&&Object.keys(r).length===2&&typeof r.audit_id==='string'&&r.audit_id.length>0&&r.audit_id.length<=256&&typeof r.contract_id==='string'&&r.contract_id.length>0&&r.contract_id.length<=256&&!audits.has(r.audit_id),'REPLAY_GUARD_ROW');ids.add(r.contract_id);audits.add(r.audit_id);}
 const{projection_sha256,...body}=g;check(digest(body)===projection_sha256&&ids.size===29&&same([...ids].sort(),g.contract_ids),'REPLAY_GUARD_SEAL');check(!ids.has(cid),'REPLAY_PROTECTED_CID');
}
function fixedOrder(rows,code){check(Array.isArray(rows)&&rows.length===2&&same(rows.map(identity),CASES.map(identity)),code);}
function geometry(row,descriptor){return same(descriptor.focal,{id:row.focal_id,start:row.focal_start,end:row.focal_end,sha256:row.focal_sha256})&&same(descriptor.parent,{id:row.parent_id,start:row.parent_start,end:row.parent_end,sha256:row.parent_sha256});}

/** Lower-level metadata controls only. Fictional self-sealed fixtures may pass
 * these joins; this helper skips stored-report hashes and cannot admit IO.
 * ROOT must use validateReplayCustody with already authenticated parsed JSON.
 * Supported domain is bounded trusted plain JSON metadata, not arbitrary JS. */
export function checkReplayCustodyMetadata(args){
 const{comparison,priorCompletion:p,priorAdmission:a,priorEpoch:e,priorPending:n,manifests,descriptors}=immutableCopy(args);
 check(comparison?.authority==='NONE'&&comparison.source_payloads_opened===false&&Array.isArray(comparison.cases)&&comparison.cases.length===2&&same(comparison.failed_available,FAILED_AVAILABLE),'REPLAY_COMPARISON');
 check(Array.isArray(manifests)&&manifests.length===2&&Array.isArray(descriptors)&&descriptors.length===2,'REPLAY_TWO_METADATA_ARRAYS');
 fixedOrder(p?.cases,'REPLAY_COMPLETION_ORDER');fixedOrder(a?.cases,'REPLAY_ADMISSION_ORDER');fixedOrder(n?.manifest_refs,'REPLAY_PENDING_ORDER');
 check(p.schema==='two-case-source-only-completion-v1'&&p.status==='COMPLETE_SOURCE_ONLY_PREPARATION_NOT_QUALITY'&&p.original_actor_absent===true&&p.all_output_documents_rehashed===true&&p.finite9_literal_roundtrip_verified===true&&p.actual_source_only===true&&p.semantic_reading_complete===false&&p.full69_complete===false&&p.model_access===false&&p.quality_gate_pass===false,'REPLAY_PRIOR_COMPLETION');
 check(a.schema==='ROOT_TWO_CASE_SOURCE_ONLY_ADMISSION_V1'&&a.status==='ADMITTED_PREPARATION_AND_BOUNDED_EXPLORATORY_PAGES'&&a.root===Q&&a.model_access===false&&a.tokenizer_access===false&&a.quality_gate_pass===false&&a.coding_authority===false,'REPLAY_PRIOR_ADMISSION');
 check(n.schema==='two-case-source-only-exit-pending-v1'&&n.status==='PENDING_EXTERNAL_ROOT_EXIT_READBACK'&&n.actual_source_only===true&&n.quality_gate_pass===false&&n.own_exit_claimed===false&&same(p.original_actor,n.actor)&&p.boot_id===n.boot_id&&p.origin_ns===n.origin_ns&&p.initial_active_carry_ms===n.initial_active_carry_ms&&n.initial_active_carry_ms===479198,'REPLAY_PRIOR_PENDING');
 check(same(p.admission_ref,REPLAY_PRIOR_REFS.admission)&&same(n.admission_ref,REPLAY_PRIOR_REFS.admission)&&same(p.pending_ref,REPLAY_PRIOR_REFS.pending)&&same(p.source_epoch_ref,REPLAY_PRIOR_REFS.epoch)&&same(n.source_epoch_ref,REPLAY_PRIOR_REFS.epoch)&&same(a.source_epoch_ref,REPLAY_PRIOR_REFS.epoch),'REPLAY_PRIOR_REFS');
 check(e.schema==='two-case-source-only-source-epoch-v1'&&e.authority==='NONE'&&same(a.source_refs,e.source_refs)&&same(a.runtime_ref,e.runtime_ref)&&same(a.node_flags,e.node_flags)&&Array.isArray(e.source_refs)&&e.source_refs.length<=256,'REPLAY_PRIOR_EPOCH');
 for(const[name,hash]of[['sections.prototype.mjs',COLLECTOR],['source-decoration.prototype.mjs',TRACER]]){const matches=e.source_refs.filter(r=>r.path.endsWith('/literal-emphasis-parent-v1/'+name));check(matches.length===1&&matches[0].sha256===hash,'REPLAY_BASELINE_SOURCE_PIN');}
 check(same(p.metadata_guard_ref,REFS.metadata_inputs.guard)&&same(n.metadata_guard_ref,REFS.metadata_inputs.guard)&&same(a.metadata_source_epoch_ref,REFS.metadata_source_epoch_ref),'REPLAY_PRIOR_GUARD_REFS');
 check(same(p.failed_available,a.failed_available)&&p.failed_available?.length===1&&p.failed_available[0].audit_id==='development-0048'&&p.failed_available[0].prospective_status==='FAILED_AVAILABLE_RESOURCE_BOUND_BEFORE_PAYLOAD'&&p.failed_available[0].replacement_allowed===false,'REPLAY_RETAINED_FAILURE');
 const cases=[];
 for(let i=0;i<2;i++){
  const b=CASES[i],r=REPLAY_DERIVED_INPUTS[i],c=comparison.cases[i],row=c?.row,m=manifests[i],d=descriptors[i];
  check(row?.audit_id===b.audit_id&&row.contract_id===b.contract_id&&row.source_sha256===SOURCE&&row.development_row===true&&row.focal_kind==='ACTUAL_UNIT'&&digest(row)===b.row_canonical_sha256&&same(c.binding,b)&&same(c.refs,b.source_refs)&&same(c.guard,comparison.guard),'REPLAY_FIXED_COMPARISON_CASE');
  guarded(comparison.guard,b.contract_id);
  check(same(p.cases[i].manifest_ref,r.manifest_ref)&&same(n.manifest_refs[i].manifest_ref,r.manifest_ref)&&p.cases[i].source_input_decoded_bytes===b.declared_combined_decoded_input_bytes&&n.manifest_refs[i].source_input_decoded_bytes===b.declared_combined_decoded_input_bytes,'REPLAY_PRIOR_MANIFEST_MAPPING');
  check(m?.schema==='exploratory-source-only-output-manifest-v1'&&same(identity(m),identity(b))&&same(m.admission_ref,REPLAY_PRIOR_REFS.admission)&&same(m.source_epoch_ref,REPLAY_PRIOR_REFS.epoch)&&same(m.metadata_guard_ref,REFS.metadata_inputs.guard)&&same(m.descriptor_ref,r.descriptor_ref)&&m.actual_source_bytes_opened===true&&m.semantic_review_complete===false&&m.full69_complete===false&&m.model_access===false&&m.quality_gate_pass===false,'REPLAY_PRIOR_MANIFEST');
  check(same(m.documents?.raw_full,r.raw_document_ref)&&same(m.documents?.normalized_full,r.normalized_document_ref)&&same(m.documents?.new_native,r.native_document_ref),'REPLAY_DERIVED_DOCUMENT_REFS');
  check(r.raw_document_ref.sha256===b.source_refs.raw.sha256&&r.raw_document_ref.bytes===b.source_refs.raw.bytes&&r.normalized_document_ref.sha256===b.source_refs.normalized.sha256&&r.normalized_document_ref.bytes===b.source_refs.normalized.bytes&&r.native_document_ref.sha256!==b.source_refs.native.sha256&&r.baseline_envelope_sha256!==b.native_envelope_sha256,'REPLAY_ORIGINAL_AND_NEW_NATIVE');
  check(d?.schema==='fixed-case-source-only-adverse-comparison-descriptor-v1'&&d.audit_id===b.audit_id&&d.contract_id===b.contract_id&&d.current_source_sha256===SOURCE&&d.focal_kind==='ACTUAL_UNIT'&&geometry(row,d)&&d.focal_equals_parent_range===false&&d.focal_equals_parent_id===false,'REPLAY_BASELINE_GEOMETRY');
  check(d.epoch_sha256===r.baseline_epoch_sha256&&d.tracer_source_sha256===r.baseline_tracer_sha256&&d.collector_source_sha256===r.baseline_collector_sha256&&d.old_native_envelope_sha256===b.native_envelope_sha256&&d.new_native_envelope_sha256===r.baseline_envelope_sha256&&d.raw_sha256===r.raw_document_ref.sha256&&d.normalized_sha256===r.normalized_document_ref.sha256&&d.non_native_fields_equal===true&&d.selection_equal===true&&d.normalized_literal_equal===true&&d.source_words_truncated===false&&d.tokenizer_calls===0&&d.model_inference===false,'REPLAY_BASELINE_METHOD');
  check(r.input_decoded_bytes===b.cache_storage.decoded_bytes+r.raw_document_ref.decoded_bytes+r.normalized_document_ref.decoded_bytes+r.native_document_ref.decoded_bytes&&r.input_decoded_bytes<=33554432,'REPLAY_INPUT_LEDGER');
  cases.push({row,binding:b,raw_document_ref:r.raw_document_ref,normalized_document_ref:r.normalized_document_ref,native_document_ref:r.native_document_ref,descriptor_ref:r.descriptor_ref,descriptor:d});
 }
 return immutableCopy({cases,guard:comparison.guard,failed_available:comparison.failed_available,authority:'NONE',actual_io_authority:false});
}

/** Sole ROOT integration route. ROOT authenticates every original byte buffer
 * before parsing; these stored-JSON checks additionally bind the supplied
 * values to the exact already-issued prior metadata. No paths are opened. */
export function validateReplayCustody(args){
 const a=immutableCopy(args),p=a.policy;
 check(p&&digest(p)===POLICY_DIGEST,'REPLAY_PINNED_POLICY');
 check(same(p.source_metadata_bindings,CASES)&&same(p.derived_inputs,REPLAY_DERIVED_INPUTS)&&same(p.prior_completion_ref,REPLAY_PRIOR_REFS.completion)&&same(p.prior_admission_ref,REPLAY_PRIOR_REFS.admission)&&same(p.prior_source_epoch_ref,REPLAY_PRIOR_REFS.epoch)&&same(p.prior_pending_ref,REPLAY_PRIOR_REFS.pending)&&p.original_contract_from_authenticated_cache===true&&p.old_V4_native_ref_not_relabeled===true,'REPLAY_POLICY_CUSTODY_REFS');
 for(const[name,r]of Object.entries(REPLAY_PRIOR_REFS)){stored(a[{completion:'priorCompletion',admission:'priorAdmission',epoch:'priorEpoch',pending:'priorPending'}[name]],r,'REPLAY_STORED_PRIOR_PIN');}
 stored(a.comparison?.guard,REFS.metadata_inputs.guard,'REPLAY_STORED_GUARD_PIN');
 check(same(a.priorCompletion.failed_available,p.failed_available),'REPLAY_POLICY_FAILED_AVAILABLE');
 check(Array.isArray(a.manifests)&&a.manifests.length===2&&Array.isArray(a.descriptors)&&a.descriptors.length===2,'REPLAY_TWO_METADATA_ARRAYS');
 for(let i=0;i<2;i++){stored(a.manifests[i],REPLAY_DERIVED_INPUTS[i].manifest_ref,'REPLAY_STORED_MANIFEST_PIN');stored(a.descriptors[i],REPLAY_DERIVED_INPUTS[i].descriptor_ref,'REPLAY_STORED_DESCRIPTOR_PIN');}
 return checkReplayCustodyMetadata(a);
}
