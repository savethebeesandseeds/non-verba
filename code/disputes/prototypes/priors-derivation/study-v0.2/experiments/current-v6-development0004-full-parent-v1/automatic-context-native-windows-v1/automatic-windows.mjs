// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED. Pure automatic-range adapter; no IO, counter loader or authority.
import {createHash} from 'node:crypto';
import {createDeclaredContextSet,declaredContextSourceIdentity} from '../../literal-emphasis-parent-v1/declared-context-set-v1/context-set.mjs';
import {prepareDeclaredNativeNodes,verifyDeclaredNativeNodes,POLICY_SHA256 as NATIVE_POLICY_SHA256} from './native-nodes-dictionary.mjs';
import {DICTIONARY_WINDOW_POLICY,decodeNativeDictionaryWindow,reconstructDictionaryWindowSource} from '../integrated-empty-dictionary-v1/window-dictionary.mjs';

export const SELECTOR_POLICY_SHA256='2e1521977c9d2d85691d4e3b36a8b1dfaca42a2961424b034f883e08bb8a9d7a';
export const POLICY='AUTOMATIC_SELECTED_SEPARATE_NATIVE_DICTIONARY_NODES_V1_UNADOPTED';
export const CODEC_SOURCES=Object.freeze({window:'172591f4d6f859527bcfdf99e437736701edb847d4ef0b899fa7a3ccd321a2a0',cluster:'c16f82b341a3424bb10f9aa3a3521afa70dbc01c651b43645ff29e6d9399570e'});
const H=x=>createHash('sha256').update(x).digest('hex');
const C=v=>Array.isArray(v)?'['+v.map(C).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+C(v[k])).join(',')+'}':JSON.stringify(v);
const D=v=>H(C(v)),J=v=>JSON.stringify(v,null,2)+'\n';
const check=(v,c='AUTOMATIC_NATIVE_BINDING')=>{if(!v)throw Object.assign(Error(c),{code:c});};
const int=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/u.test(s);
function freeze(v){if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}
function copy(v,depth=0){check(depth<=64);if(v===null||typeof v==='string'||typeof v==='boolean')return v;if(typeof v==='number'){check(Number.isFinite(v));return v;}check(v&&typeof v==='object');const a=Array.isArray(v);check(Object.getPrototypeOf(v)===(a?Array.prototype:Object.prototype));const out=a?[]:{};const keys=Reflect.ownKeys(v);check(keys.length<=65536);for(const k of keys){if(a&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(v,k);check(typeof k==='string'&&d.enumerable&&Object.hasOwn(d,'value'));if(a)check(/^(0|[1-9][0-9]*)$/u.test(k)&&Number(k)<v.length);out[k]=copy(d.value,depth+1);}if(a)check(keys.length===v.length+1);return out;}
function exact(v,keys){check(v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)));}
function ref(v){exact(v,['path','sha256','bytes']);check(typeof v.path==='string'&&v.path.length>0&&v.path.length<=1024&&!/[\u0000-\u001f]/u.test(v.path)&&hash(v.sha256)&&int(v.bytes,1,262144));return v;}
function document(s,r,limit){check(typeof s==='string'&&Buffer.byteLength(s)<=limit&&Buffer.byteLength(s)===r.bytes&&H(s)===r.sha256,'AUTOMATIC_NATIVE_DOCUMENT_REF');let v;try{v=JSON.parse(s);}catch{check(false,'AUTOMATIC_NATIVE_DOCUMENT_JSON');}return v;}
function checked(x){
 const b=copy(x.binding);exact(b,['selection_ref','epoch_ref','current_source_sha256']);ref(b.selection_ref);ref(b.epoch_ref);check(hash(b.current_source_sha256));
 const selection=document(x.selection_document,b.selection_ref,262144),epoch=document(x.epoch_document,b.epoch_ref,65536);
 check(selection.schema==='automatic-literal-context-selection-v1'&&selection.status==='SELECTED_BOUNDED_PROVISIONAL_CONTEXT'&&selection.prototype===true&&selection.adopted===false&&selection.authority==='NONE','AUTOMATIC_NATIVE_SELECTION_STATUS');
 check(selection.policy_sha256===SELECTOR_POLICY_SHA256&&D(selection.policy)===SELECTOR_POLICY_SHA256,'AUTOMATIC_NATIVE_SELECTOR_POLICY');
 for(const k of ['semantic_completeness_verified','source_custody_authenticated','manual_witness_catalog_used','heading_promoted_into_input','source_text_concatenated','model_or_counter_called','quality_gate_pass'])check(selection[k]===false,'AUTOMATIC_NATIVE_SELECTION_FLAGS');
 check(Array.isArray(selection.issues)&&selection.issues.length===0&&Array.isArray(selection.attachments)&&selection.attachments.length>0&&selection.attachments.length<=32,'AUTOMATIC_NATIVE_SELECTION_STATUS');
 check(epoch.schema==='ROOT-current-method-frozen-extraction-source-v1'&&epoch.source?.sha256===b.current_source_sha256&&x.source?.source_sha256===b.current_source_sha256,'AUTOMATIC_NATIVE_EPOCH');
 check(Array.isArray(epoch.source.files)&&epoch.source.files.filter(f=>f.path==='source-decoration.mjs').length===1&&epoch.source.files.filter(f=>f.path==='sections.mjs').length===1,'AUTOMATIC_NATIVE_EPOCH');
 const methodPins=copy(x.methodPins);exact(methodPins,['tracer_source_sha256','collector_source_sha256']);
 check(epoch.source.files.find(f=>f.path==='source-decoration.mjs').sha256===methodPins.tracer_source_sha256&&epoch.source.files.find(f=>f.path==='sections.mjs').sha256===methodPins.collector_source_sha256,'AUTOMATIC_NATIVE_METHOD_PINS');
 check(selection.source?.normalized_sha256===x.source?.normalized_sha256&&selection.source?.normalized_utf16_length===x.source?.normalized_utf16_length,'AUTOMATIC_NATIVE_SOURCE');
 const source=copy(x.source),identity=declaredContextSourceIdentity(source),ids=new Set(['focal']);
 const node=(id,range,role)=>({id,source_identity_sha256:identity,range:copy(range),declared_role:role,annotation_ref:{...b.selection_ref}});
 const focal=node('focal',selection.focal,'FOCAL');
 let attached=0;
 const attachments=selection.attachments.map(a=>{check(typeof a.id==='string'&&!ids.has(a.id)&&a.boundary_verified===false&&a.governing_hierarchy_verified===false,'AUTOMATIC_NATIVE_ATTACHMENT');ids.add(a.id);attached+=a.range.end-a.range.start;return node(a.id,a.range,'AUTOMATIC_LITERAL_CONTEXT');});
 check(selection.attached_characters===attached,'AUTOMATIC_NATIVE_ATTACHMENT');
 const declaration={source,focal,attachments};
 const contextSet=createDeclaredContextSet({...declaration,normalized_text:x.normalizedText}).artifact;
 const inputBinding={policy:POLICY,selection_ref:b.selection_ref,current_epoch_ref:b.epoch_ref,current_source_sha256:b.current_source_sha256,selector_policy_sha256:SELECTOR_POLICY_SHA256,codec_policy:DICTIONARY_WINDOW_POLICY,codec_sources:CODEC_SOURCES,native_node_policy_sha256:NATIVE_POLICY_SHA256,source_identity_sha256:identity,raw_sha256:H(x.raw),normalized_sha256:source.normalized_sha256,envelope_sha256:x.envelope.sha256,method_pins:methodPins,nodes:contextSet.nodes.map(n=>({id:n.id,range:n.range,declared_role:n.declared_role})),order:'FOCAL_THEN_FROZEN_ATTACHMENT_ORDER',automatic_selection_recomputed:false,manual_witness_catalog_used:false,source_authenticity_claimed:false};
 return {inputBinding,contextSet,declaration,raw:x.raw,normalizedText:x.normalizedText,envelope:x.envelope,methodPins,limits:x.limits};
}
function nativeRequest(p){return{contextSet:p.contextSet,declaration:p.declaration,raw:p.raw,normalizedText:p.normalizedText,envelope:p.envelope,methodPins:p.methodPins,limits:p.limits};}
const SERIALIZED_WINDOW_KEYS=['text','representation_start','representation_end','source_ranges','input_policy','mapping_status','input_eligibility','envelope_sha256','window_annotations_self_contained','computed_style_verified','effectiveness_verified','sha256','empty_native_dictionary'];
function dictionaryWindow(w){return Object.fromEntries(SERIALIZED_WINDOW_KEYS.map(k=>[k,w[k]]));}
function inversions(p,a){return a.nodes.map((n,i)=>{const source=p.contextSet.nodes[i].text;const windows=n.windows.map((w,index)=>{const encoded=dictionaryWindow(w),native=decodeNativeDictionaryWindow(encoded),literal=source.slice(w.source_utf16_start,w.source_utf16_end);check(reconstructDictionaryWindowSource(encoded)===literal,'AUTOMATIC_NATIVE_SOURCE_INVERSE');return{index,local_start:w.source_utf16_start,local_end:w.source_utf16_end,original_start:n.declaration.range.start+w.source_utf16_start,original_end:n.declaration.range.start+w.source_utf16_end,source_sha256:H(literal),dictionary_window_sha256:w.sha256,original_native_sha256:native.sha256,original_native_object_sha256:w.empty_native_dictionary.original_window_sha256,include_end_zero_width:w.source_ranges[0].include_end_zero_width??false};});return{node_id:n.declaration.id,status:n.status,normalized_range:n.declaration.range,complete_source_coverage:n.status==='COMPLETE',windows};});}
const flags={prototype:true,adopted:false,authority:'NONE',source_authenticity_claimed:false,actual_reading:false,source_text_concatenated:false,selection_recomputed:false,manual_witness_catalog_used:false,native_roles_are_structural_supplied_declarations:true,context_adequate:null,semantic_completeness_verified:false,quality_gate_pass:false,pooling_performed:false,model_inference:false};
/** Supplied counter only. Caller must externally authenticate source/code/counter custody. */
export function prepareAutomaticNativeWindows(x){
 const p=checked(x),planned=prepareDeclaredNativeNodes({...nativeRequest(p),counter:x.counter});
 const artifact={schema:'automatic-context-native-dictionary-windows-v1',...flags,input_binding:p.inputBinding,input_sha256:D(p.inputBinding),native_artifact:planned.artifact,coverage:inversions(p,planned.artifact)};
 check(Buffer.byteLength(J(artifact))<=planned.artifact.limits.output_bytes,'AUTOMATIC_NATIVE_OUTPUT_BOUND');
 return freeze({artifact,metadata:{schema:'automatic-context-native-dictionary-summary-v1',...flags,input_sha256:artifact.input_sha256,artifact_sha256:H(J(artifact)),artifact_bytes:Buffer.byteLength(J(artifact)),native_summary:planned.metadata}});
}
/** Re-authenticates source/native ranges and dictionary inversions; never calls a counter. */
export function verifyAutomaticNativeWindows({artifact,...x}){
 const p=checked(x);exact(artifact,['schema',...Object.keys(flags),'input_binding','input_sha256','native_artifact','coverage']);
 check(artifact.schema==='automatic-context-native-dictionary-windows-v1');for(const[k,v]of Object.entries(flags))check(artifact[k]===v);
 check(D(artifact.input_binding)===D(p.inputBinding)&&artifact.input_sha256===D(p.inputBinding),'AUTOMATIC_NATIVE_INPUT_IDENTITY');
 verifyDeclaredNativeNodes({artifact:artifact.native_artifact,...nativeRequest(p),counter_policy:x.counter_policy});
 check(D(artifact.coverage)===D(inversions(p,artifact.native_artifact)),'AUTOMATIC_NATIVE_COVERAGE');return true;
}
/** One fresh request per complete final dictionary window; no planner rerun or inference. */
export function recountAutomaticNativeWindows({artifact,counter,max_requests,...x}){
 check(counter&&typeof Object.getOwnPropertyDescriptor(counter,'tokenCount')?.value==='function'&&int(max_requests,1,20000),'AUTOMATIC_NATIVE_RECOUNT_BOUND');
 check(D(counter.policy)===counter.policy_sha256&&D(counter.policy)===D(artifact.native_artifact.counter_policy),'AUTOMATIC_NATIVE_COUNTER_POLICY');
 verifyAutomaticNativeWindows({artifact,...x,counter_policy:counter.policy});
 let requests=0;const rows=[];let held=artifact.native_artifact.nodes.some(n=>n.status!=='COMPLETE');
 for(const n of artifact.native_artifact.nodes)for(let i=0;i<n.windows.length;i++){
  if(requests>=max_requests){held=true;return freeze({schema:'automatic-context-independent-recount-v1',...flags,status:'HELD_RECOUNT_REQUEST_BOUND',input_sha256:artifact.input_sha256,requests,remaining_windows:artifact.native_artifact.nodes.reduce((s,n)=>s+n.windows.length,0)-requests,rows});}
  const w=n.windows[i];requests++;let tokens=null,code=null;try{tokens=counter.tokenCount(w.text);if(!int(tokens,1,256)||tokens!==w.tokens)code='FINAL_DICTIONARY_TOKEN_COUNT_MISMATCH';}catch{code='FINAL_DICTIONARY_COUNTER_FAILURE';}
  if(code)held=true;rows.push({node_id:n.declaration.id,window:i,dictionary_sha256:w.sha256,original_native_sha256:w.empty_native_dictionary.original_text_sha256,planned_tokens:w.tokens,recount_tokens:Number.isSafeInteger(tokens)?tokens:null,status:code??'MATCHED_WITHIN_256'});
 }
 return freeze({schema:'automatic-context-independent-recount-v1',...flags,status:held?'HELD':'MATCHED_FINAL_WINDOWS_UNADOPTED',input_sha256:artifact.input_sha256,counter_policy_sha256:counter.policy_sha256,requests,remaining_windows:0,rows});
}
export function runActualDiagnostic(){throw Object.assign(Error('AUTOMATIC_CONTEXT_ACTUAL_DIAGNOSTIC_CLOSED'),{code:'AUTOMATIC_CONTEXT_ACTUAL_DIAGNOSTIC_CLOSED'});}
