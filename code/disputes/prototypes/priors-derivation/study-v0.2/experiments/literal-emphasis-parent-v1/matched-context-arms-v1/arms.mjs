// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED. Pure range preparation; custody and all IO are external.
import {sha,digest,deriveFiniteNine,decodeModelText,policy as codecPolicy} from '../finite-codec.mjs';
import {immutableCopy} from '../immutable-state.mjs';
import {verifyFocalContext} from '../focal-context-projection-v1/projection.mjs';

export const POLICY='PROTOTYPE_UNADOPTED_MATCHED_FOCAL_CONTEXT_RANGES_V1';
export const LIMITS=Object.freeze({input_bytes:33554432,arm_bytes:2097152,combined_bytes:8388608});
export const ARM_ORDER=Object.freeze(['FOCAL_ONLY','PARENT_NEIGHBORS_60','COMPLETE_EXISTING_FRAME','FULL_AVAILABLE_NORMALIZED_DOCUMENT']);
export const FAILURE_ENVELOPE_BYTES=16384;
const J=v=>JSON.stringify(v,null,2)+'\n',bytes=v=>Buffer.byteLength(J(v)),same=(a,b)=>digest(a)===digest(b);
const fail=(code,reason)=>{throw Object.assign(Error(code),{code,reason});};
const check=(v,reason)=>{if(!v)fail('MATCHED_SOURCE_BINDING',reason);};
function bounds(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(LIMITS,k)))fail('INVALID_INPUT','LIMIT_KEYS');
 const out={...LIMITS,...value};for(const[k,max]of Object.entries(LIMITS))if(!Number.isSafeInteger(out[k])||out[k]<1||out[k]>max)fail('INVALID_INPUT','LIMIT_VALUE');return out;
}
function plainInput(root,limit){
 const active=new WeakSet();let nodes=0,lower=0;
 const charge=n=>{lower+=n;if(lower>limit)throw Object.assign(Error('MATCHED_INPUT_TOO_LARGE'),{code:'MATCHED_INPUT_TOO_LARGE',required_lower_bound_bytes:lower,limit_bytes:limit});};
 function visit(v,depth=0){
  if(typeof v==='string'){charge(Buffer.byteLength(v));return;}if(v===null||typeof v==='boolean')return;
  if(typeof v==='number'&&Number.isFinite(v))return;
  if(!v||typeof v!=='object'||depth>256||++nodes>1000000)fail('INVALID_INPUT','PLAIN_JSON_BOUND');
  const array=Array.isArray(v),proto=Object.getPrototypeOf(v);if((array?proto!==Array.prototype:![Object.prototype,null].includes(proto))||Object.getOwnPropertySymbols(v).length||active.has(v))fail('INVALID_INPUT','PLAIN_JSON_REQUIRED');
  if(array){const keys=Object.keys(v);if(v.length>1000000||keys.length!==v.length||keys.some((k,i)=>k!==String(i)))fail('INVALID_INPUT','DENSE_JSON_ARRAY_REQUIRED');}
  active.add(v);for(const[k,d]of Object.entries(Object.getOwnPropertyDescriptors(v))){if(array&&k==='length')continue;if(!Object.hasOwn(d,'value')||!d.enumerable)fail('INVALID_INPUT','PLAIN_DATA_PROPERTIES');if(!array)charge(Buffer.byteLength(k));visit(d.value,depth+1);}active.delete(v);
 }
 visit(root);const n=bytes(root);if(n>limit)throw Object.assign(Error('MATCHED_INPUT_TOO_LARGE'),{code:'MATCHED_INPUT_TOO_LARGE',required_bytes:n,limit_bytes:limit});return n;
}
function input({extraction,focal_id,projection},b){
 const inputBytes=plainInput({extraction,focal_id,projection},b.input_bytes);
 check(typeof focal_id==='string'&&projection&&extraction,'INPUT_SHAPE');
 verifyFocalContext({artifact:projection,extraction,focal_id,limits:projection.limits});
 const focal=extraction.units.find(u=>u.id===focal_id),parent=extraction.sections.find(s=>s.id===focal.parent_section_id),envelope=extraction.native_source_decorations,trace=envelope.trace;
 const {sha256,...body}=trace??{};check(typeof sha256==='string'&&digest(body)===sha256&&same(trace.raw,envelope.raw),'NATIVE_TRACE_SEAL');
 for(const v of[envelope,trace])check(v.authority==='NONE'&&v.computed_style_verified===false&&v.effectiveness_verified===false&&v.semantic_completeness_verified===false,'NATIVE_UNKNOWN_STATUS');
 const source={source_input_sha256:digest({extraction,focal_id,projection}),source_extraction_sha256:digest(extraction),projection_sha256:digest(projection),native_envelope_sha256:envelope.sha256,native_record_sha256:digest(envelope),focal_record_sha256:digest(focal),parent_record_sha256:digest(parent),normalized_sha256:extraction.normalized_sha256,input_bytes:inputBytes};
 return{extraction,focal,parent,envelope,projection,text:extraction.normalized_text,source};
}
const range=(p,start,end)=>({start,end,sha256:sha(p.text.slice(start,end))});
function nearest(text,start,end,reverse){
 const found=[];let at=reverse?end:start;
 while(found.length<60&&(reverse?at>start:at<end)){
  if(reverse){while(at>start&&/\s/u.test(text[at-1]))at--;if(at===start)break;const high=at;while(at>start&&!/\s/u.test(text[at-1]))at--;found.unshift({start:at,end:high});}
  else{while(at<end&&/\s/u.test(text[at]))at++;if(at===end)break;const low=at;while(at<end&&!/\s/u.test(text[at]))at++;found.push({start:low,end:at});}
 }return found;
}
function neighborRange(p){
 const before=nearest(p.text,p.parent.start,p.focal.start,true),after=nearest(p.text,p.focal.end,p.parent.end,false);let left=Math.min(30,before.length),right=Math.min(30,after.length);
 left+=Math.min(60-left-right,before.length-left);right+=Math.min(60-left-right,after.length-right);
 return{range:range(p,left?before[before.length-left].start:p.focal.start,right?after[right-1].end:p.focal.end),neighbor_words:{before:left,after:right,maximum:60,word_count_basis:'WHITESPACE_SEPARATED_SOURCE_SPANS_NOT_SEMANTIC_WORDS',policy:'30_EACH_SIDE_UNUSED_CAPACITY_REDISTRIBUTED_WITHIN_PARENT'}};
}
function framePlan(p){
 if(p.projection.status!=='PROJECTED_EXISTING_SOURCE_FRAMES_UNVERIFIED')return{range:null,frame:null,reason:'PROJECTED_FRAME_UNAVAILABLE'};
 if(p.projection.contexts.length!==1)return{range:null,frame:null,reason:'SINGLE_COMPLETE_STORED_FRAME_REQUIRED'};
 const frame=p.projection.contexts[0].frame;
 if(frame.start>p.focal.start||frame.end<p.focal.end)return{range:null,frame:null,reason:'STORED_FRAME_DOES_NOT_CONTAIN_FULL_FOCAL'};
 return{range:range(p,frame.start,frame.end),frame,reason:null};
}
function plans(p){const n=neighborRange(p),f=framePlan(p);return[
 {name:ARM_ORDER[0],range:range(p,p.focal.start,p.focal.end),frame:null,neighbor_words:null,reason:null},
 {name:ARM_ORDER[1],...n,frame:null,reason:null},
 {name:ARM_ORDER[2],...f,neighbor_words:null},
 {name:ARM_ORDER[3],range:range(p,0,p.text.length),frame:null,neighbor_words:null,reason:null}
 ];}
const uncertainty={context_adequate:null,governance_verified:false,semantic_completeness_verified:false,antecedents_reviewed:false,later_governors_complete:false,document_completeness_verified:false,referenced_attachments_reconstructed:false,source_quality_passed:false,quality_gate_pass:false,model_access:false,tokenizer_access:false,formal_coding_authority:false,adopted:false,authority:'NONE'};
function identity(p,plan){return{schema:'matched-context-representation-identity-v1',method_policy:POLICY,arm:plan.name,source_binding_sha256:digest(p.source),projection_sha256:p.source.projection_sha256,native_envelope_sha256:p.source.native_envelope_sha256,range:plan.range,source_frame_record_sha256:plan.frame?digest(plan.frame):null,neighbor_words:plan.neighbor_words,codec_policy_sha256:digest(codecPolicy),strip_policy:'EXACT_NORMALIZED_LITERAL_FROM_REVERSIBLE_FINITE_NINE_DECODING',tokenizer:'NOT_OPEN',window_policy:'NOT_OPEN',aggregation:'NOT_OPEN'};}
function held(p,plan,reason,required=null){const id=identity(p,plan);return{schema:'matched-context-range-arm-v1',arm:plan.name,status:'HELD_UNRESOLVED_CONTEXT',reason,representation_identity:id,representation_sha256:digest(id),range:plan.range,source_frame:null,neighbor_words:plan.neighbor_words,forms:null,required_bytes:required,payload_retained:false,source_text_truncated:false,...uncertainty};}
function prepared(p,plan){
 const evidence={schema:'matched-context-range-evidence-v1',representation_sha256:digest(identity(p,plan)),projection_sha256:p.source.projection_sha256,arm:plan.name};
 const finite=deriveFiniteNine({normalizedText:p.text,envelope:p.envelope,start:plan.range.start,end:plan.range.end,evidence,qualification:{status:'EXPERIMENTAL_RANGE_PREPARATION_NOT_SOURCE_REVIEW',...uncertainty}}),encoded=finite.encodeWindow({includeEndZeroWidth:true}),literal=p.text.slice(plan.range.start,plan.range.end);
 check(decodeModelText(encoded.text)===literal&&encoded.source_literal_roundtrip===true,'LITERAL_ROUNDTRIP');
 const id=identity(p,plan);return{schema:'matched-context-range-arm-v1',arm:plan.name,status:'PREPARED_RANGE_NOT_TOKENIZED',reason:null,representation_identity:id,representation_sha256:digest(id),range:plan.range,source_frame:plan.frame,neighbor_words:plan.neighbor_words,forms:{native9:{binding:finite.binding,features:finite.features,external_segments:finite.externalSegments,encoded},strip:{text:literal,sha256:sha(literal),source_range:plan.range,policy:'EXACT_NORMALIZED_LITERAL_NOT_NATIVE_EQUIVALENCE'}},required_bytes:null,payload_retained:true,source_text_truncated:false,...uncertainty};
}
function source(p,refsOnly=false){return{...p.source,focal:refsOnly?null:p.focal,focal_reference:{id_sha256:sha(p.focal.id),start:p.focal.start,end:p.focal.end,sha256:p.focal.sha256,record_sha256:digest(p.focal)},parent_reference:refsOnly?{role:'PARENT_REVIEW_CONTEXT_UNVERIFIED',id_sha256:sha(p.parent.id),start:p.parent.start,end:p.parent.end,sha256:p.parent.sha256,record_sha256:digest(p.parent)}:p.projection.parent_reference,full_native_evidence_retained_in_authenticated_input:true,full_native_evidence_copied_into_each_arm:false};}
function header(p,b,arms,{failure=false,required=null}={}){return{schema:'matched-context-arms-v1',policy:POLICY,status:failure?'HELD_RESOURCE_BOUND':arms.every(a=>a.status==='PREPARED_RANGE_NOT_TOKENIZED')?'PREPARED_FOUR_RANGES_NOT_TOKENIZED':'HELD_WITH_COMPLETE_OTHER_ARMS',limits:b,source:source(p,failure),arms,combined_resource_failure:failure,required_combined_bytes:required,full_document_arm_scope:'FULL_AVAILABLE_NORMALIZED_DOCUMENT_UPPER_BOUND_NOT_VERIFIED_COMPLETE_CONTRACT',focal_replaced:false,selection_recomputed:false,heading_promoted:false,disjoint_ranges_joined:false,source_text_truncated:false,accepted_runtime_brand_minted:false,old_method_adopted:false,...uncertainty};}
export function summarizeMatchedContextArms(artifact){
 const out={schema:'matched-context-arms-metadata-v1',status:artifact.status,artifact_sha256:sha(J(artifact)),artifact_bytes:bytes(artifact),metadata_bytes:0,combined_bytes:0,source_input_sha256:artifact.source.source_input_sha256,projection_sha256:artifact.source.projection_sha256,native_record_sha256:artifact.source.native_record_sha256,focal_record_sha256:artifact.source.focal_record_sha256,parent_record_sha256:artifact.source.parent_record_sha256,arm_count:artifact.arms.length,prepared_count:artifact.arms.filter(a=>a.status==='PREPARED_RANGE_NOT_TOKENIZED').length,held_count:artifact.arms.filter(a=>a.status!=='PREPARED_RANGE_NOT_TOKENIZED').length,arms:artifact.arms.map(a=>({arm:a.arm,status:a.status,reason:a.reason,representation_sha256:a.representation_sha256,range:a.range,artifact_bytes:bytes(a),native9_sha256:a.forms?.native9.encoded.sha256??null,strip_sha256:a.forms?.strip.sha256??null})),tokenizer:'NOT_OPEN',window_policy:'NOT_OPEN',aggregation:'NOT_OPEN',...uncertainty};
 for(let i=0;i<16;i++){out.metadata_bytes=bytes(out);out.combined_bytes=out.artifact_bytes+out.metadata_bytes;if(bytes(out)===out.metadata_bytes)return immutableCopy(out);}fail('INVALID_INPUT','METADATA_SIZE_FIXPOINT');
}
function result(artifact){const metadata=summarizeMatchedContextArms(artifact);if(artifact.combined_resource_failure&&metadata.combined_bytes>FAILURE_ENVELOPE_BYTES)fail('MATCHED_CONTEXT_TOO_LARGE','FAILURE_ENVELOPE_BOUND');return immutableCopy({artifact,metadata});}

/** No source reads, model/tokenizer calls, reselection, or accepted native brand. */
export function buildMatchedContextArms({extraction,focal_id,projection,limits}={}){
 const b=bounds(limits),p=input({extraction,focal_id,projection},b),expected=plans(p),arms=expected.map(plan=>{
  if(plan.reason)return held(p,plan,plan.reason);
  const a=prepared(p,plan),n=bytes(a);return n<=b.arm_bytes?a:held(p,plan,'ARM_PAYLOAD_BOUND',n);
 });
 const artifact=header(p,b,arms),out=result(artifact);if(out.metadata.combined_bytes<=b.combined_bytes)return out;
 return result(header(p,b,expected.map(plan=>held(p,plan,'COMBINED_PAYLOAD_BOUND')), {failure:true,required:out.metadata.combined_bytes}));
}

/** Independent readback: no builder call; range decisions, complete codec data,
 * source records, every flag and exact final byte bounds are checked again. */
export function verifyMatchedContextArms({artifact,extraction,focal_id,projection,limits}={}){
 const b=bounds(limits),p=input({extraction,focal_id,projection},b);check(artifact&&artifact.schema==='matched-context-arms-v1'&&Array.isArray(artifact.arms)&&artifact.arms.length===4&&same(artifact.limits,b),'ARTIFACT_SHAPE');
 const expected=plans(p),reconstructed=[];
 for(let i=0;i<4;i++){
  const plan=expected[i],a=artifact.arms[i];check(a&&a.arm===ARM_ORDER[i]&&same(a.representation_identity,identity(p,plan))&&a.representation_sha256===digest(identity(p,plan)),'ARM_IDENTITY_OR_ORDER');
  if(plan.reason){const wanted=held(p,plan,plan.reason);check(same(a,artifact.combined_resource_failure?held(p,plan,'COMBINED_PAYLOAD_BOUND'):wanted),'UNRESOLVED_NO_REPLACEMENT');reconstructed.push(wanted);continue;}
  const id=identity(p,plan),evidence={schema:'matched-context-range-evidence-v1',representation_sha256:digest(id),projection_sha256:p.source.projection_sha256,arm:plan.name},finite=deriveFiniteNine({normalizedText:p.text,envelope:p.envelope,start:plan.range.start,end:plan.range.end,evidence,qualification:{status:'EXPERIMENTAL_RANGE_PREPARATION_NOT_SOURCE_REVIEW',...uncertainty}}),encoded=finite.encodeWindow({start:plan.range.start,end:plan.range.end,includeEndZeroWidth:true});
  const complete={schema:'matched-context-range-arm-v1',arm:plan.name,status:'PREPARED_RANGE_NOT_TOKENIZED',reason:null,representation_identity:id,representation_sha256:digest(id),range:plan.range,source_frame:plan.frame,neighbor_words:plan.neighbor_words,forms:{native9:{binding:finite.binding,features:finite.features,external_segments:finite.externalSegments,encoded},strip:{text:p.text.slice(plan.range.start,plan.range.end),sha256:plan.range.sha256,source_range:plan.range,policy:'EXACT_NORMALIZED_LITERAL_NOT_NATIVE_EQUIVALENCE'}},required_bytes:null,payload_retained:true,source_text_truncated:false,...uncertainty};
  const n=bytes(complete),wanted=n<=b.arm_bytes?complete:held(p,plan,'ARM_PAYLOAD_BOUND',n);check(same(a,artifact.combined_resource_failure?held(p,plan,'COMBINED_PAYLOAD_BOUND'):wanted),'EXACT_COMPLETE_ARM_OR_BOUND_FAILURE');if(a.forms)check(decodeModelText(a.forms.native9.encoded.text)===a.forms.strip.text,'MATCHED_STRIP_LITERAL');reconstructed.push(wanted);
 }
 if(artifact.combined_resource_failure){
  // Reconstruct only to prove the aggregate bound, never to accept a clipped arm.
  const n=summarizeMatchedContextArms(header(p,b,reconstructed)).combined_bytes;
  check(n>b.combined_bytes&&artifact.required_combined_bytes===n&&same(artifact,header(p,b,artifact.arms,{failure:true,required:n}))&&summarizeMatchedContextArms(artifact).combined_bytes<=FAILURE_ENVELOPE_BYTES,'COMBINED_BOUND_PROOF');
 }else check(same(artifact,header(p,b,artifact.arms))&&summarizeMatchedContextArms(artifact).combined_bytes<=b.combined_bytes&&artifact.arms.every(a=>!a.forms||bytes(a)<=b.arm_bytes),'ACCEPTED_BYTES_OR_HEADER');
 return true;
}
