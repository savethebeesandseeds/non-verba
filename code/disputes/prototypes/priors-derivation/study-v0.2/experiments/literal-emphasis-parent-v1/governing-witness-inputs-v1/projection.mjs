// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED. Supplied stored-data projection only; no IO/counters.
import {sha,digest} from '../finite-codec.mjs';
import {immutableCopy} from '../immutable-state.mjs';
import {checkStoredMatchedInput} from '../matched-context-windows-v3/input-custody.mjs';
import {verifyWindowCensus,summarizeWindowCensus} from '../matched-context-windows-v3/census.mjs';
export const POLICY='PROTOTYPE_UNADOPTED_GOVERNING_WITNESS_SOURCE_WINDOW_INPUTS_V1';
export const LIMITS=Object.freeze({input_bytes:33554432,output_bytes:2097152,catalog_block_utf16:6000});
const ARMS=['FOCAL_ONLY','PARENT_NEIGHBORS_60','COMPLETE_EXISTING_FRAME','FULL_AVAILABLE_NORMALIZED_DOCUMENT'];
const J=v=>JSON.stringify(v,null,2)+'\n',bytes=v=>Buffer.byteLength(J(v)),same=(a,b)=>digest(a)===digest(b);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v),int=(v,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const fail=(code,reason,extra={})=>{throw Object.assign(Error(code),{code,reason,...extra});},check=(v,r)=>{if(!v)fail('WITNESS_INPUT_SOURCE_BINDING',r);};
function bound(reason,observed,limit){if(observed>limit)fail('WITNESS_INPUT_RESOURCE_BOUND',reason,{observed_at_least:observed,limit,partial_projection_accepted:false});}
const keys=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...names].sort().join('|');
function limits(v={}){check(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>Object.hasOwn(LIMITS,k)),'LIMIT_KEYS');const b={...LIMITS,...v};for(const[k,n]of Object.entries(LIMITS))check(int(b[k],1,n),'LOWER_ONLY_LIMIT');return b;}
// Reject executable properties before the old plain-JSON validators. Bounds
// precede descriptor-map allocation for wide objects and dense/sparse arrays.
function plain(root,max,kind='INPUT_BYTES'){
 let lower=0,nodes=0;const active=new WeakSet(),charge=n=>{lower+=n;bound(kind,lower,max);};
 function visit(v,depth=0){
  check(depth<=128,'JSON_DEPTH');if(v===null||typeof v==='boolean')return;if(typeof v==='number'){check(Number.isFinite(v),'FINITE_JSON_NUMBER');return;}if(typeof v==='string'){charge(Buffer.byteLength(v));return;}
  check(v&&typeof v==='object'&&++nodes<=100000,'PLAIN_JSON');const a=Array.isArray(v),p=Object.getPrototypeOf(v);check((a?p===Array.prototype:[Object.prototype,null].includes(p))&&!active.has(v),'PLAIN_JSON');
  if(a)bound('JSON_MEMBERS',v.length,32768);const ks=Object.keys(v);bound('JSON_MEMBERS',ks.length,32768);bound(kind,lower+ks.length*2,max);check(!a||ks.length===v.length&&ks.every((k,i)=>k===String(i)),'DENSE_ARRAY');
  const names=Object.getOwnPropertyNames(v);bound('JSON_MEMBERS',names.length-(a?1:0),32768);check(names.length===ks.length+(a?1:0)&&Object.getOwnPropertySymbols(v).length===0,'DATA_PROPERTIES');const ds=Object.getOwnPropertyDescriptors(v);active.add(v);
  for(const k of ks){const d=ds[k];check(d.enumerable&&Object.hasOwn(d,'value'),'DATA_PROPERTIES');if(!a)charge(Buffer.byteLength(k));visit(d.value,depth+1);}active.delete(v);
 }
 visit(root);bound(kind,bytes(root),max);
}
function ref(r,gzip=false){check(keys(r,gzip?['path','sha256','bytes','encoding','decoded_sha256','decoded_bytes']:['path','sha256','bytes'])&&typeof r.path==='string'&&r.path.startsWith('/')&&hash(r.sha256)&&int(r.bytes,1,gzip?8388608:262144),'REFERENCE');if(gzip)check(r.encoding==='gzip'&&hash(r.decoded_sha256)&&int(r.decoded_bytes,1,33554432),'GZIP_REFERENCE');}
function pin(v,r,gzip=false){ref(r,gzip);const n=bytes(v);check(n===(gzip?r.decoded_bytes:r.bytes)&&sha(J(v))===(gzip?r.decoded_sha256:r.sha256),'STORED_BYTES_PIN');}
const ids=b=>({audit_id:b.audit_id,contract_id:b.contract_id,case_id:b.case_id});
const point=(text,n)=>int(n,0,text.length)&&!(n>0&&n<text.length&&/[\uD800-\uDBFF]/u.test(text[n-1])&&/[\uDC00-\uDFFF]/u.test(text[n]));
function range(r,text){check(keys(r,['start','end','sha256'])&&point(text,r.start)&&point(text,r.end)&&r.end>r.start&&r.sha256===sha(text.slice(r.start,r.end)),'ORIGINAL_NORMALIZED_RANGE');}
const closed={authenticated_scope_required_externally:true,actual_io_authority:false,source_origin_provenance_rebuilt:false,new_counter_calls:0,tokenizer_execution_attested_by_this_module:false,prior_count_witness_authentication_required_externally:true,reading_declared:false,witness_offsets_inferred:false,semantic_adequacy:null,governance_verified:false,antecedents_reviewed:false,document_completeness_verified:false,formal_coding_authority:false,quality_gate_pass:false,adopted:false,authority:'NONE'};
function inputs(args){
 plain(args,LIMITS.input_bytes);check(args&&typeof args==='object'&&!Array.isArray(args),'ARGUMENT_OBJECT');check(keys(args,['slot','matched_wrapper','matched_summary','census_wrapper','census_summary','counter_policies','census_limits',...(Object.hasOwn(args,'limits')?['limits']:[])]),'ARGUMENT_KEYS');const b=limits(args.limits);plain(args,b.input_bytes);
 const {slot,matched_wrapper:m,matched_summary:ms,census_wrapper:c,census_summary:cs,counter_policies:cp,census_limits:cl}=args;
 check(slot&&slot.binding&&typeof slot.binding.audit_id==='string'&&typeof slot.binding.contract_id==='string'&&hash(slot.binding.case_id),'CASE_IDENTITY');
 const literal=m?.arms?.arms?.[3]?.forms?.strip?.text;check(typeof literal==='string'&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(literal),'NORMALIZED_LITERAL_UTF16');
 checkStoredMatchedInput({slot,wrapper:m,summary:ms});pin(c,slot.census_ref,true);pin(cs,slot.census_summary_ref);const s=m.arms;
 for(const k of['policy_ref','admission_ref','source_epoch_ref','runtime_bindings_ref'])ref(c[k]);
 const header={schema:'fixed-source-matched-window-result-v1',...ids(slot.binding),arms_ref:slot.arms_ref,policy_ref:c.policy_ref,admission_ref:c.admission_ref,source_epoch_ref:c.source_epoch_ref,runtime_bindings_ref:c.runtime_bindings_ref,census:c.census,actual_counter_construction:true,model_inference:false,pooling_performed:false,quality_gate_pass:false,authority:'NONE'};check(same(c,header),'Q22_WRAPPER');
 verifyWindowCensus({census:c.census,matched:s,matched_ref:slot.arms_ref,counter_policies:cp,limits:cl});const measured=summarizeWindowCensus(c.census);
 const expectedSummary={schema:'fixed-source-matched-window-summary-v1',audit_number:Number(slot.binding.audit_id.slice(-4)),case_id:slot.binding.case_id,arms_ref_sha256:slot.arms_ref.sha256,census:measured,input_decoded_bytes:slot.arms_ref.decoded_bytes,output_decoded_bytes:slot.census_ref.decoded_bytes,actual_counter_construction:true,quality_gate_pass:false,authority:'NONE'};check(same(cs,expectedSummary),'Q22_SUMMARY');
 check(c.census.streams.length===16&&c.census.streams.every(x=>x.status==='COMPLETE_TOKENIZER_WINDOW_PLAN'&&x.windows?.length>0),'COMPLETE_Q22_PLANS_REQUIRED');
 const w=slot.count_witness;check(keys(w,['completion_ref','native_ref','closed_ref','completion_case']),'COUNT_WITNESS');for(const k of['completion_ref','native_ref','closed_ref'])ref(w[k]);const cc=w.completion_case;
 const count=c.census.streams.reduce((n,x)=>n+x.windows.length,0),expectedCase={...ids(slot.binding),arms_ref:slot.arms_ref,census_ref:slot.census_ref,summary_ref:slot.census_summary_ref,input_decoded_bytes:slot.arms_ref.decoded_bytes,output_decoded_bytes:slot.census_ref.decoded_bytes+slot.census_summary_ref.bytes,census:measured,independent_final_window_recounts:count};check(same(cc,expectedCase),'EXACT_COMPLETION_CASE_COUNT_WITNESS');
 check(same(s.arms.map(a=>a.arm),ARMS),'ARM_ORDER');const full=s.arms[3],text=full.forms.strip.text;
 check(typeof text==='string'&&text.length>0&&full.range.start===0&&full.range.end===text.length&&sha(text)===s.source.normalized_sha256&&sha(text)===slot.binding.source_refs.normalized.sha256,'COMPLETE_AVAILABLE_NORMALIZED_LITERAL');
 for(const a of s.arms){range(a.range,text);check(a.forms.strip.text===text.slice(a.range.start,a.range.end),'MATCHED_ARM_NORMALIZED_SLICE');}
 const source={normalized_sha256:sha(text),normalized_utf16_length:text.length,case_identity_sha256:digest(ids(slot.binding))},sourceSHA=digest(source);
 return{args,b,slot,matched:s,census:c.census,text,source,sourceSHA,inputSHA:digest(args),count};
}
function method(d){return{method:d.method,window_policy:d.window_policy,geometry_policy:d.geometry_policy,planner_budget:d.planner_budget};}
function provenance(p){return{q19_arms_ref:p.slot.arms_ref,q19_summary_ref:p.slot.summary_ref,q22_census_ref:p.slot.census_ref,q22_summary_ref:p.slot.census_summary_ref,q22_completion_ref:p.slot.count_witness.completion_ref,q22_native_invocation_ref:p.slot.count_witness.native_ref,q22_closed_ref:p.slot.count_witness.closed_ref,q22_completion_case_sha256:digest(p.slot.count_witness.completion_case),q22_census_artifact_sha256:digest(p.census),q19_matched_artifact_sha256:digest(p.matched),independent_final_window_recounts:p.count,origin_provenance:'INHERITED_PINNED_Q19_READBACK_NOT_REBUILT',count_provenance:'INHERITED_EXACT_Q22_EXTERNAL_RECOUNT_READBACK_NOT_REEXECUTED'};}
function header(p,arms,plans,pp,blocks){return{schema:'governing-witness-inputs-v1',policy:POLICY,source_projection_input_sha256:p.inputSHA,source:p.source,source_identity_sha256:p.sourceSHA,limits:p.b,case:ids(p.slot.binding),provenance:provenance(p),normalized_literal:{text:p.text,sha256:p.source.normalized_sha256,utf16_length:p.text.length},paging_table:{coordinates:'ORIGINAL_NORMALIZED_UTF16_HALF_OPEN',catalog_only:true,published_page_receipts:false,actual_reader_must_receive_full_literal:true,maximum_block_utf16:p.b.catalog_block_utf16,blocks},arms,plans,plan_provenance:pp,witness_declarations:null,required_witness_sets:null,annotations_frozen:false,...closed};}
function windowProvenance(w,index,stream){return{window_index:index,q22_window_record_sha256:digest(w),model_input_sha256:w.sha256,tokens:w.tokens,source_range:w.source_range,normalized_source_range:w.normalized_source_range,include_end_zero_width:w.include_end_zero_width,zero_events_sha256:digest(w.zero_events),normalized_zero_events_sha256:digest(w.normalized_zero_events),native_window_sha256:stream.descriptor.form==='NATIVE9'?w.sha256:w.native_window_sha256};}
/** Pure bridge only. A caller-supplied slot is not a permit or a verified page.
 * ROOT must separately authenticate its metadata/decoded-byte custody graph. */
export function projectGoverningWitnessInputs(args){
 const p=inputs(args),arms=p.matched.arms.map(a=>({id:a.arm,source_identity_sha256:p.sourceSHA,range:a.range})),plans=[],pp=[],blocks=[];
 for(const stream of p.census.streams){const d=stream.descriptor,a=p.matched.arms.find(x=>x.arm===d.arm),formSHA=d.form==='NATIVE9'?a.forms.native9.encoded.sha256:a.forms.strip.sha256;
  plans.push({id:d.stream_id,source_identity_sha256:p.sourceSHA,status:'COMPLETE',form_sha256:formSHA,tokenizer_policy_sha256:d.tokenizer_policy_sha256,window_method_sha256:digest(method(d)),windows:stream.windows.map((w,i)=>({id:d.stream_id+':'+i,source_identity_sha256:p.sourceSHA,normalized_source_range:w.normalized_source_range,tokens:w.tokens}))});
  pp.push({plan_id:d.stream_id,arm_id:d.arm,form:d.form,descriptor_sha256:digest(d),source_stream_sha256:digest(stream),method:method(d),arm_representation_sha256:d.arm_representation_sha256,source_windows_sha256:digest(stream.windows),windows:stream.windows.map((w,i)=>windowProvenance(w,i,stream))});
 }
 for(let start=0;start<p.text.length;){let end=Math.min(start+p.b.catalog_block_utf16,p.text.length);if(!point(p.text,end))end--;if(end===start)fail('WITNESS_INPUT_RESOURCE_BOUND','CATALOG_CODEPOINT_BOUND',{limit:p.b.catalog_block_utf16,partial_projection_accepted:false});const text=p.text.slice(start,end);blocks.push({block_index:blocks.length,source_identity_sha256:p.sourceSHA,range:{start,end,sha256:sha(text)},utf8_bytes:Buffer.byteLength(text)});start=end;}
 const artifact=header(p,arms,plans,pp,blocks),metadata=summarizeGoverningWitnessInputs(artifact);bound('OUTPUT_BYTES',metadata.combined_bytes,p.b.output_bytes);return immutableCopy({artifact,metadata});
}
export function summarizeGoverningWitnessInputs(a){
 const m={schema:'governing-witness-inputs-metadata-v1',policy:POLICY,artifact_sha256:sha(J(a)),artifact_bytes:bytes(a),metadata_bytes:0,combined_bytes:0,source_projection_input_sha256:a.source_projection_input_sha256,source_identity_sha256:a.source_identity_sha256,normalized_sha256:a.source.normalized_sha256,normalized_utf16_length:a.source.normalized_utf16_length,case_identity_sha256:a.source.case_identity_sha256,arm_count:a.arms.length,plan_count:a.plans.length,window_count:a.plans.reduce((n,p)=>n+p.windows.length,0),catalog_block_count:a.paging_table.blocks.length,independent_prior_final_window_recounts:a.provenance.independent_final_window_recounts,plans_sha256:digest(a.plans),plan_provenance_sha256:digest(a.plan_provenance),paging_table_sha256:digest(a.paging_table),...closed};
 for(let i=0;i<16;i++){m.metadata_bytes=bytes(m);m.combined_bytes=m.artifact_bytes+m.metadata_bytes;if(bytes(m)===m.metadata_bytes)return immutableCopy(m);}fail('WITNESS_INPUT_SOURCE_BINDING','METADATA_SIZE_FIXPOINT');
}
/** Independent direct mapping check; never invokes the projector or counters.
 * Authenticated Q22 count evidence remains an external custody prerequisite. */
export function verifyGoverningWitnessInputs({artifact,...args}){
 const p=inputs(args);plain(artifact,p.b.output_bytes,'OUTPUT_BYTES');check(artifact&&Array.isArray(artifact.arms)&&Array.isArray(artifact.plans)&&Array.isArray(artifact.plan_provenance)&&Array.isArray(artifact.paging_table?.blocks),'ARTIFACT_ARRAYS');
 check(artifact.arms.length===4&&artifact.plans.length===16&&artifact.plan_provenance.length===16,'PROJECTION_COUNTS');
 for(let i=0;i<4;i++){const a=artifact.arms[i],src=p.matched.arms[i];check(same(a,{id:ARMS[i],source_identity_sha256:p.sourceSHA,range:src.range}),'EXACT_ARM');range(a.range,p.text);}
 for(let i=0;i<16;i++){
  const q=artifact.plans[i],x=artifact.plan_provenance[i],s=p.census.streams[i],d=s.descriptor,a=p.matched.arms.find(a=>a.arm===d.arm),formSHA=d.form==='NATIVE9'?a.forms.native9.encoded.sha256:a.forms.strip.sha256;
  check(Array.isArray(q.windows)&&q.windows.length===s.windows.length&&same(q,{id:d.stream_id,source_identity_sha256:p.sourceSHA,status:'COMPLETE',form_sha256:formSHA,tokenizer_policy_sha256:d.tokenizer_policy_sha256,window_method_sha256:digest({method:d.method,window_policy:d.window_policy,geometry_policy:d.geometry_policy,planner_budget:d.planner_budget}),windows:q.windows}),'EXACT_PLAN_IDENTITY');
  let cursor=a.range.start;for(let j=0;j<q.windows.length;j++){const w=q.windows[j],original=s.windows[j],r=original.normalized_source_range;range(w.normalized_source_range,p.text);check(same(w,{id:d.stream_id+':'+j,source_identity_sha256:p.sourceSHA,normalized_source_range:r,tokens:original.tokens})&&r.start===cursor&&r.start===a.range.start+original.source_range.start&&r.end===a.range.start+original.source_range.end&&int(w.tokens,1,256),'EXACT_Q22_WINDOW_NO_DOUBLE_OFFSET');cursor=r.end;}check(cursor===a.range.end,'COMPLETE_WINDOW_TILING');
  check(Array.isArray(x.windows)&&x.windows.length===s.windows.length&&same(x,{plan_id:d.stream_id,arm_id:d.arm,form:d.form,descriptor_sha256:digest(d),source_stream_sha256:digest(s),method:{method:d.method,window_policy:d.window_policy,geometry_policy:d.geometry_policy,planner_budget:d.planner_budget},arm_representation_sha256:d.arm_representation_sha256,source_windows_sha256:digest(s.windows),windows:x.windows}),'EXACT_PLAN_PROVENANCE');
  for(let j=0;j<x.windows.length;j++){const w=s.windows[j];check(same(x.windows[j],{window_index:j,q22_window_record_sha256:digest(w),model_input_sha256:w.sha256,tokens:w.tokens,source_range:w.source_range,normalized_source_range:w.normalized_source_range,include_end_zero_width:w.include_end_zero_width,zero_events_sha256:digest(w.zero_events),normalized_zero_events_sha256:digest(w.normalized_zero_events),native_window_sha256:d.form==='NATIVE9'?w.sha256:w.native_window_sha256}),'EXACT_COUNTED_WINDOW_PROVENANCE');}
 }
 let cursor=0;for(let i=0;i<artifact.paging_table.blocks.length;i++){const block=artifact.paging_table.blocks[i];let end=Math.min(cursor+p.b.catalog_block_utf16,p.text.length);if(!point(p.text,end))end--;check(end>cursor&&same(block,{block_index:i,source_identity_sha256:p.sourceSHA,range:{start:cursor,end,sha256:sha(p.text.slice(cursor,end))},utf8_bytes:Buffer.byteLength(p.text.slice(cursor,end))}),'EXACT_LITERAL_CATALOG_BLOCK');cursor=end;}check(cursor===p.text.length,'COMPLETE_LITERAL_CATALOG');
 check(same(artifact,header(p,artifact.arms,artifact.plans,artifact.plan_provenance,artifact.paging_table.blocks)),'EXACT_PROJECTION_HEADER');bound('OUTPUT_BYTES',summarizeGoverningWitnessInputs(artifact).combined_bytes,p.b.output_bytes);return true;
}
