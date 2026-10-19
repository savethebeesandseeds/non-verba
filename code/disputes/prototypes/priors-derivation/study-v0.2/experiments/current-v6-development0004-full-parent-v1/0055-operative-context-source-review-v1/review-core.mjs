// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE. Pure recipe checks; no IO, active clock, selection or judgment.
import {H,D,same,check,integer,hash,ID,METHOD,LIMITS,RUN,PINS as OLD,exactRef,scalarText,validateFreshGuard} from '../automatic-context-source-review0055-v1/reader-core.mjs';
export {H,D,same,check,integer,hash,ID,METHOD,LIMITS,RUN,exactRef,paginateDocuments,renderPage,validateObservation,forwardState} from '../automatic-context-source-review0055-v1/reader-core.mjs';
export const Q=RUN+'/qa/current-v6-0055-operative-context-source-review-v1';
export const CLOSED_POOL_CARRY=Object.freeze({planning:40886,recount:246,elapsed_ms:955387.035676,output_bytes:51988112});
export const BASE_PIN=Object.freeze({sha256:'255f6a6e5dcdded662a536453a6adc42bfea9a5dab1f54b16b70d561405d1e77',bytes:14092});
export const PINS=Object.freeze({body:OLD.body,epoch:OLD.epoch,guard:OLD.guard,selection:OLD.selection});
export const NORMALIZED_PIN=Object.freeze({path:RUN+'/normalized/82a3dab1396336ed/contract-5e4763782d47aca7d67c.txt',sha256:'2626a8d05aac59e504a72e78b46572a5c50c3c7c31c4453c465c7864ba95f0cd',bytes:25435});
export const RAW_PIN=Object.freeze({path:RUN+'/raw/contract-5e4763782d47aca7d67c.html',sha256:'c11d94ff0cc9355d9276065d62b5a77daa8a236c9801dd292c4d7f30055fa066',bytes:47662});
export const SCOPE=Object.freeze({raw_UTF16:[0,47662],normalized_UTF16:[0,25329],purpose:'WHOLE_ORIGINAL_EXCEPTION_DISPOSITIONS_AND_NAMED_OPERATIVE_CONTEXT_SPANS',html_render:false,external_resources:false,computed_styles:false,tokenizer:false,model:false,coder_meanings:false,adoption:false});
export function validateAdmissionShape(a,sourcePaths){
 check(a?.schema==='ROOT-fixed0055-operative-context-source-reading-admission-v1'&&a.status==='ADMITTED_FIXED_0055_OPERATIVE_SOURCE_READING_ONLY'&&a.admitted_by==='ROOT'&&a.reviewer===ID.reviewer&&same(a.identity,ID)&&a.method_sha256===METHOD&&same(a.input_refs,PINS)&&same(a.limits,LIMITS)&&same(a.scope,SCOPE)&&same(a.closed_tokenizer_pool_carry,CLOSED_POOL_CARRY)&&a.closed_tokenizer_pool_reopened===false&&a.state_path===Q+'/reading'&&a.payload_source_display_approved===true&&a.context_judgment_requires_complete_own_reading===true&&a.model_access===false&&a.coder_meanings_access===false&&a.other_cases_access===false&&a.native_envelope_access===false&&a.materiality_holds_cleared===0&&a.quality_gate_pass===false&&a.authority==='NONE','OPERATIVE_ROOT_ADMISSION');
 exactRef(a.normalized_ref);check(same(a.normalized_ref,NORMALIZED_PIN),'OPERATIVE_NORMALIZED_PIN');
 check(Array.isArray(a.source_refs)&&a.source_refs.length===3&&same(a.source_refs.map(r=>r.path),sourcePaths)&&a.source_refs.every(r=>hash(r.sha256)&&integer(r.bytes,1,LIMITS.source_copy_bytes))&&a.source_refs[2].sha256===BASE_PIN.sha256&&a.source_refs[2].bytes===BASE_PIN.bytes&&integer(a.source_copy_charge_bytes,1,LIMITS.source_copy_bytes)&&a.source_copy_charge_bytes>=a.source_refs.reduce((n,r)=>n+r.bytes,0),'OPERATIVE_SOURCE_CLOSURE');
 return true;
}
export function qualifyMetadata({body,epoch,guard,selection},normalizedRef){
 // This complete ID-only guard is checked before either source document IO.
 validateFreshGuard(guard);exactRef(normalizedRef);
 check(body?.schema==='current-v6-body-prior-actual-scope-qualification-v1'&&body.source_sha256===METHOD&&body.rows?.length===200&&body.current_supporting_review_assembled===false&&body.materiality_holds_cleared===0&&body.new_actual_readings===0,'OPERATIVE_BODY_METADATA');
 const rows=body.rows.filter(r=>r.audit_id===ID.audit_id);check(rows.length===1&&rows[0].contract_id===ID.contract_id,'OPERATIVE_FIXED_ONE_CASE');
 const row=rows[0],p=row.current_v6_body_scope_qualification,raw=row.prior_qualification_unchanged?.source_scopes?.raw,norm=row.prior_qualification_unchanged?.source_scopes?.entire_normalized;
 check(p?.status==='EXACT_PRIOR_OBSERVATION_SCOPE_INPUTS_PRESERVED_CURRENT_V6'&&p.current_extraction_source_sha256===METHOD&&p.new_actual_reading===false&&p.current_supporting_review_ready===false&&p.quality_gate_pass===false&&raw?.sha256===p.raw_sha256&&norm?.sha256===p.normalized_sha256&&norm.characters===25329&&normalizedRef.sha256===norm.sha256&&normalizedRef.bytes<=131072,'OPERATIVE_CURRENT_ROW');
 const raw_ref=exactRef({path:raw.path.startsWith('/')?raw.path:RUN+'/'+raw.path,sha256:raw.sha256,bytes:raw.bytes});check(same(raw_ref,RAW_PIN)&&same(normalizedRef,NORMALIZED_PIN),'OPERATIVE_SOURCE_PINS');
 const{sha256,...sourceBody}=epoch?.source??{};
 check(epoch?.schema==='ROOT-current-method-frozen-extraction-source-v1'&&sha256===METHOD&&D(sourceBody)===sha256&&epoch.snapshot_code==='/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code'&&epoch.source.files?.length===23,'OPERATIVE_CURRENT_EPOCH');
 check(selection?.schema==='automatic-literal-context-selection-v1'&&selection.status==='SELECTED_BOUNDED_PROVISIONAL_CONTEXT'&&selection.source?.normalized_sha256===norm.sha256&&selection.focal?.start===13926&&selection.focal?.end===15707&&hash(selection.focal.sha256)&&selection.attachments?.length===6&&selection.attached_characters===11408&&selection.prototype===true&&selection.adopted===false&&selection.authority==='NONE'&&selection.semantic_completeness_verified===false&&selection.quality_gate_pass===false,'OPERATIVE_SELECTION');
 return {raw_ref,normalized_ref:normalizedRef,normalized_sha256:norm.sha256,focal:selection.focal};
}
export function prepareDocuments(raw,normalized,binding){
 scalarText(raw);scalarText(normalized);
 check(raw.length===47662&&H(raw)===binding.raw_ref.sha256,'OPERATIVE_COMPLETE_RAW');
 check(normalized.length===25329&&H(normalized)===binding.normalized_sha256&&H(normalized)===binding.normalized_ref.sha256&&Buffer.byteLength(normalized)===binding.normalized_ref.bytes,'OPERATIVE_COMPLETE_NORMALIZED');
 check(H(normalized.slice(binding.focal.start,binding.focal.end))===binding.focal.sha256,'OPERATIVE_UNCHANGED_FOCAL');
 const documents=[{id:'raw-original-html',source_ref:binding.raw_ref,text:raw},{id:'current-normalized-source',source_ref:binding.normalized_ref,text:normalized}].map(d=>({...d,models:[],sha256:H(d.text),utf16:d.text.length,bytes:Buffer.byteLength(d.text)}));
 return {documents,binding:{raw_ref:binding.raw_ref,normalized_ref:binding.normalized_ref,focal:binding.focal,scope:SCOPE}};
}
