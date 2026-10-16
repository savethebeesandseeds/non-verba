// SPDX-License-Identifier: AGPL-3.0-only
// Actual-source adapter PREPARATION. No corpus loader or actual69 launcher.
import {readFileSync} from 'node:fs';
import {digest,sha,deriveFiniteNine} from './finite-codec.mjs';
import {immutableCopy} from './immutable-state.mjs';
import {verifyNativeDecorationEnvelope} from './source-decoration.prototype.mjs';
import {computePilotEpoch,verifyCurrentProof,assertConfiguredEntryPoint} from './pilot-identity.mjs';
import {PILOT_LIMITS} from './pilot-resources.mjs';
import {preparePrototypeWindows} from './window-planner.mjs';
import {openPinnedCounters} from './pinned-tokenizers.mjs';
import {metadataAccessRequest} from './pilot-sampling.mjs';
const states=new WeakMap();
const REF_KEYS=new Set(['envelope_sha256','raw_sha256','normalized_sha256','tracer_source_sha256','collector_source_sha256','policy','collector_policy','start','end','mapping_status','input_eligibility','projection_required']);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
function stableCore(input){const copy=structuredClone(input);delete copy.source;delete copy.raw_sha256;delete copy.native_source_decorations;if(copy.parameters)delete copy.parameters.native_decoration_policy;for(const row of [...copy.sections??[],...copy.units??[]]){delete row.native_source_decorations_ref;for(const unit of row.units??[])delete unit.native_source_decorations_ref;}return copy;}
function stableSelection(input){const copy=structuredClone(input);for(const row of copy.selected)delete row.native_source_decorations_ref;return copy;}
function differences(a,b,path='',out=[]){if(Object.is(a,b))return out;if(!a||!b||typeof a!=='object'||typeof b!=='object'){out.push(path||'/');return out;}for(const key of new Set([...Object.keys(a),...Object.keys(b)])){if(out.length>=128)break;if(!Object.hasOwn(a,key)||!Object.hasOwn(b,key))out.push(path+'/'+key);else differences(a[key],b[key],path+'/'+key,out);}return out;}
/** Internal consistency only, not independent source-authenticity review.
 * Old and rebuilt methods keep their own sealed envelope/status identities. */
export function verifyPilotNativeReferences(result,{tracer,collector,policy,raw}){
  const envelope=result?.native_source_decorations,{sha256,...body}=envelope??{},trace=envelope?.trace,{sha256:traceSHA,...traceBody}=trace??{};
  if(typeof raw!=='string'||!sha256||digest(body)!==sha256||!traceSHA||digest(traceBody)!==traceSHA||envelope.policy!==policy||trace.policy!==policy||envelope.tracer_source_sha256!==tracer||envelope.collector_source_sha256!==collector||envelope.raw?.sha256!==sha(raw)||envelope.raw.characters!==raw.length||envelope.raw.bytes!==Buffer.byteLength(raw)||digest(trace.raw)!==digest(envelope.raw)||envelope.normalized?.sha256!==sha(result.normalized_text)||envelope.normalized.sha256!==result.normalized_sha256||envelope.normalized.characters!==result.normalized_text.length)fail('PILOT_NATIVE_ENVELOPE_BINDING','Sealed current/new native envelope must bind exact raw, normalized text and method');
  for(const row of [...result.sections,...result.units,...result.sections.flatMap(s=>s.units??[])]){
    const ref=row.native_source_decorations_ref,expected={envelope_sha256:sha256,raw_sha256:envelope.raw.sha256,normalized_sha256:envelope.normalized.sha256,tracer_source_sha256:tracer,collector_source_sha256:collector,policy,collector_policy:'EXTRACTOR_EMITTED_ORIGIN_ROPES_V3',start:row.start,end:row.end,mapping_status:envelope.mapping_status,input_eligibility:envelope.input_eligibility,projection_required:true};
    if(!ref||Object.keys(ref).some(k=>!REF_KEYS.has(k))||digest(ref)!==digest(expected))fail('PILOT_NATIVE_REFERENCE_BINDING','Every current/new native reference identity, status and scope must equal its bound envelope');
  }
  return true;
}
function controlOnly(mode,request){if(mode!=='SOURCE_FREE_CONTROL')fail('PILOT_ACTUAL_EXECUTION_DISABLED','Actual69 guardian/driver is not implemented or authorized in this preparation revision');if(request?.source_kind!=='DECLARED_SYNTHETIC_CONTROL'||request?.status!=='METADATA_ELIGIBLE_NOT_SOURCE_AUTHORIZATION'||!/^SYNTHETIC_/u.test(request.row?.contract_id??''))fail('PILOT_SOURCE_FREE_REQUEST_REQUIRED','Declared synthetic control of actual adapter required');}

/** Rebuilds through the ORIGINAL production normalizer/origin collector, with
 * just the reviewed tracer import changed. It never invokes bindSynthetic or
 * upgrades a stored five-tag envelope. Actual execution remains hard-disabled
 * until a separately reviewed exact69 external guardian/driver is connected. */
export async function prepareSourceBytesForPilot(input){
  controlOnly(input?.mode,input?.request); // Must precede any byte/record access.
  if(digest(metadataAccessRequest(input.request.row,input.freshGuard,{control:true}))!==digest(input.request))fail('PILOT_FRESH_REQUEST_BINDING','Rechecked contract-ID-only guard/request differs before bytes');
  const {request,rawBytes}=input;
  if(!Buffer.isBuffer(rawBytes)||rawBytes.length!==request.row.raw_bytes||rawBytes.length>PILOT_LIMITS.raw_bytes)fail('PILOT_RAW_RESOURCE_OR_BINDING','Exact raw bytes within unchanged source budget required');
  const ownedRawBytes=Buffer.from(rawBytes),raw=ownedRawBytes.toString('utf8');
  // Buffer decoding replaces malformed UTF8. Require an exact byte roundtrip
  // BEFORE record/cache access; retain a literal BOM rather than stripping it.
  if(!Buffer.from(raw,'utf8').equals(ownedRawBytes))fail('PILOT_INVALID_UTF8_RAW_BYTES','Original raw bytes must roundtrip UTF8 exactly; no replacement decoding or accepted prefix');
  const {record,currentCache,extractionOptions,selectionOptions}=input,rawSHA=sha(ownedRawBytes),metadata=immutableCopy(record),epoch=await computePilotEpoch({extractionOptions,selectionOptions});
  if(rawSHA!==request.row.raw_sha256||metadata.id!==request.row.contract_id||currentCache.contract?.id!==metadata.id||currentCache.raw_sha256!==rawSHA)fail('PILOT_RAW_IDENTITY','Original raw/contract/current-cache binding differs');
  verifyCurrentProof(currentCache.source,epoch,{control:true});if(request.row.source_sha256!==currentCache.source.sha256)fail('PILOT_CURRENT_SOURCE_BINDING','Metadata and current source proof differ');
  const oldFile=name=>currentCache.source.files.find(f=>f.path===name)?.sha256;
  verifyPilotNativeReferences(currentCache,{tracer:oldFile('source-decoration.mjs'),collector:oldFile('sections.mjs'),policy:'NATIVE_SOURCE_DECORATION_COLLECTOR_ORIGIN_V4',raw});
  assertConfiguredEntryPoint('prototype_collector','./sections.prototype.mjs');const {extractSections,selectUnits}=await import('./sections.prototype.mjs');
  const fresh=extractSections({...metadata,content:raw},{...extractionOptions,nativeDecorationIdentity:{tracerSourceSHA256:epoch.tracer_source_sha256,collectorSourceSHA256:epoch.collector_source_sha256}});
  const delta=differences(stableCore(currentCache),stableCore(fresh));
  const oldSelection=selectUnits(currentCache.units,selectionOptions),newSelection=selectUnits(fresh.units,selectionOptions);
  const selectionDelta=differences(stableSelection(oldSelection),stableSelection(newSelection));
  if(delta.length||selectionDelta.length)fail('PILOT_NON_NATIVE_BRIDGE_DIFFERENCE',JSON.stringify({fields:delta,selection_fields:selectionDelta,values_disclosed:false}));
  verifyNativeDecorationEnvelope(fresh.native_source_decorations,{raw,normalizedText:fresh.normalized_text,expectedTracerSourceSHA256:epoch.tracer_source_sha256,expectedCollectorSourceSHA256:epoch.collector_source_sha256});
  verifyPilotNativeReferences(fresh,{tracer:epoch.tracer_source_sha256,collector:epoch.collector_source_sha256,policy:fresh.native_source_decorations.policy,raw});
  const unit=fresh.units.find(u=>u.id===request.row.unit_id),parent=fresh.sections.find(p=>p.id===request.row.parent_id);
  if(!unit||!parent||unit.parent_section_id!==parent.id||unit.sha256!==request.row.unit_sha256||fresh.normalized_sha256!==request.row.normalized_sha256||unit.start!==request.row.unit_start||unit.end!==request.row.unit_end||parent.start!==request.row.parent_start||parent.end!==request.row.parent_end)fail('PILOT_SELECTED_ROW_BINDING','Exact frozen focal/parent/normalized row required');
  if(fresh.normalized_text.length>PILOT_LIMITS.decoded_characters||parent.end-parent.start>PILOT_LIMITS.selected_characters)fail('PILOT_SELECTED_RESOURCE_BOUND','Whole source retained failed; no truncation');
  const nativeCounts={};for(const source of fresh.native_source_decorations.trace.sources)if(source.native_tag)nativeCounts[source.native_tag]=(nativeCounts[source.native_tag]??0)+1;
  const descriptor=immutableCopy({schema:'pilot-current-bridge-and-parent-descriptor-v1',source_kind:'DECLARED_SYNTHETIC_CONTROL_OF_ACTUAL_ADAPTER',audit_id:request.row.audit_id,contract_id:metadata.id,epoch_sha256:epoch.sha256,current_source_sha256:currentCache.source.sha256,new_native_envelope_sha256:fresh.native_source_decorations.sha256,new_native_source_counts:nativeCounts,tracer_source_sha256:epoch.tracer_source_sha256,collector_source_sha256:epoch.collector_source_sha256,raw_sha256:rawSHA,normalized_sha256:fresh.normalized_sha256,unit:{id:unit.id,start:unit.start,end:unit.end,sha256:unit.sha256},parent:{id:parent.id,start:parent.start,end:parent.end,sha256:parent.sha256},bridge:'ALL_NON_NATIVE_FIELDS_AND_SELECTION_EXACT',allowed_native_delta:['top native envelope','native references','parameters.native_decoration_policy'],new_native_evidence_not_storage_equivalence:true,dependency_completeness_verified:false,pooling_validated:false,actual_reading:false,source_quality_passed:false,authority:'NONE'});
  const build=(form,row)=>deriveFiniteNine({normalizedText:fresh.normalized_text,envelope:fresh.native_source_decorations,start:row.start,end:row.end,evidence:{source_kind:descriptor.source_kind,descriptor_sha256:digest(descriptor),epoch_sha256:epoch.sha256,form},qualification:{status:'MECHANICAL_PREPARATION_NOT_SOURCE_REVIEW',authority:'NONE'}});
  const forms=Object.freeze({unit:build('UNIT_ONLY_ABLATION',unit),parent:build('FULL_STORED_PARENT_AVAILABILITY_ONLY',parent)}),handle=Object.freeze({status:'SOURCE_FREE_ACTUAL_ADAPTER_CONTROL_PREPARED',descriptor,forms,epoch,source_access_authorized:false,actual_execution_enabled:false});
  states.set(handle,{raw,fresh,unit,parent,request,forms,measured:null});return handle;
}
export async function measurePreparedPilotInputs(handle,{controlCounters=null}={}){
  const state=states.get(handle);if(!state)throw new Error('Owned prepared source handle required');
  const opened=controlCounters?{counters:controlCounters,bindings:{source_kind:'DECLARED_SYNTHETIC_COUNTER_TEST_ONLY'}}:await openPinnedCounters();
  const rows=[];for(const counter of opened.counters)for(const form of ['unit','parent']){try{const result=preparePrototypeWindows(state.forms[form],counter);rows.push({form,tokenizer_policy_sha256:counter.policy_sha256,status:'COMPLETE_TOKENIZER_PREPARATION_NOT_INFERENCE',result});}catch(error){rows.push({form,tokenizer_policy_sha256:counter.policy_sha256,status:'FAILED_WHOLE_INPUT',code:error.code??'UNEXPECTED_ERROR',work:error.work??null,partial_stream_accepted:false});}}
  const summaries=rows.map(({result,...row})=>{const encoded=result?digest(result.windows.map(w=>({text_sha256:w.sha256,source_range:w.source_range,tokens:w.tokens,zero_events:w.zero_events}))):null,range=state.forms[row.form].binding.source_range;return {...row,work:result?.work??row.work,budget:result?.budget??null,overlap:result?.overlap??null,window_count:result?.windows.length??0,maximum_tokens:result?Math.max(...result.windows.map(w=>w.tokens)):null,source_literal_coverage:result?.source_literal_coverage??false,encoded_windows_sha256:encoded,source_range:range,exact_computation_identity:encoded?digest({purpose:'TOKENIZER_PREPARATION_ONLY',epoch:handle.epoch.sha256,raw:handle.descriptor.raw_sha256,normalized:handle.descriptor.normalized_sha256,range,codec_policy:state.forms[row.form].binding.policy_sha256,tokenizer:row.tokenizer_policy_sha256,encoded}):null,computation_reused:false};});
  state.measured=rows;return immutableCopy({status:'SOURCE_FREE_MODEL_INPUT_PREPARATION_ONLY',bindings:opened.bindings,rows:summaries,geometry:{parent_characters:state.parent.end-state.parent.start,unit_characters:state.unit.end-state.unit.start,parent_unit_count:state.parent.units.length,unit_fraction_of_parent_utf16:(state.unit.end-state.unit.start)/(state.parent.end-state.parent.start),dilution_or_pooling_quality_verified:false},all_complete:rows.every(r=>r.result),reuse_does_not_create_independent_evidence:true,failures_remain_in_original_denominators:true,inference:false,actual_reading:false,authority:'NONE'});
}
/** Complete relevant evidence dictionary, never a guessed decoded-text match. */
export function preparedPilotReadDocuments(handle){
  const state=states.get(handle);if(!state)throw new Error('Owned prepared source handle required');const {fresh,parent}=state,e=fresh.native_source_decorations;
  const segments=e.segments.filter(s=>s.end>parent.start&&s.start<parent.end||s.start===s.end&&s.start>=parent.start&&s.start<=parent.end),runIDs=new Set(segments.flatMap(s=>s.sources.map(p=>p.run_id))),runs=e.trace.runs.filter(r=>runIDs.has(r.id)),paths=new Map(e.trace.paths.map(p=>[p.id,p]));
  const ancestry=(sourceRuns)=>{const done=new Set(),sourceIDs=new Set();for(const run of sourceRuns){let id=run.path_id;const active=new Set();while(id&&!done.has(id)){if(active.has(id)||active.size>paths.size)throw new Error('Native dictionary path cycle');active.add(id);const path=paths.get(id);if(!path)throw new Error('Native dictionary path missing');sourceIDs.add(path.source_id);id=path.parent_id;}for(const pathID of active)done.add(pathID);}return sourceIDs;};
  const parentSourceIDs=ancestry(runs),anyRunSourceIDs=ancestry(e.trace.runs);
  // No normalized coordinate can be invented for empty/recovered/no-run
  // sources. Retain ALL source/path records, with every unassigned relation
  // explicit, rather than silently deciding it is outside this parent.
  const associations=e.trace.sources.map(source=>({source_id:source.id,parent_relation:parentSourceIDs.has(source.id)?'SELECTED_PARENT_SEGMENT_ORIGIN_ANCESTRY':'UNASSIGNED_NORMALIZED_PARENT_RELATION_UNKNOWN',has_any_trace_text_run_ancestry:anyRunSourceIDs.has(source.id),normalized_scope_assigned:parentSourceIDs.has(source.id)}));
  const dictionary={schema:'full-parent-native-with-unassigned-document-evidence-v2',scope_policy:'SELECTED_PARENT_ORIGINS_PLUS_ALL_UNASSIGNED_DOCUMENT_NATIVE_SOURCES_V1',envelope_sha256:e.sha256,epoch_sha256:handle.epoch.sha256,raw_sha256:e.raw.sha256,normalized_sha256:e.normalized.sha256,selected_parent:handle.descriptor.parent,segments,runs,paths:e.trace.paths,sources:e.trace.sources,source_parent_associations:associations,all_trace_sources_and_paths_preserved:true,unassigned_source_count:associations.filter(a=>!a.normalized_scope_assigned).length,no_run_source_count:associations.filter(a=>!a.has_any_trace_text_run_ancestry).length,unassigned_sources_not_asserted_inside_or_outside_parent:true,unresolved:e.trace.unresolved,unmapped:e.unmapped,unmapped_normalized:e.unmapped_normalized,collector_issues:e.collector_issues,decoded_run_scope_may_extend_parent:true,computed_style_verified:false,effectiveness_verified:false,source_word_omission:false};
  const documents={raw_full:state.raw,normalized_full:fresh.normalized_text,native_parent_dictionary:JSON.stringify(dictionary),omitted_fields:readFileSync(new URL('./omitted-fields.json',import.meta.url),'utf8')};
  for(const row of state.measured??[])documents['candidate_'+row.tokenizer_policy_sha256+'_'+row.form]=JSON.stringify(row.result?{status:row.status,windows:row.result.windows,policy:row.result.policy,source_range:row.result.source_range,whole_input_complete:true}:{...row,required_scope_missing:true});
  if(!state.measured)documents.candidate_preparation_missing=JSON.stringify({status:'NOT_MEASURED',required_scope_missing:true,actual_reading:false});
  documents.preparation_scope_manifest=JSON.stringify({candidate_preparation_complete:Boolean(state.measured?.length)&&state.measured.every(row=>row.result),required_raw_scope:{start:0,end:state.raw.length},required_normalized_scope:{start:0,end:fresh.normalized_text.length},required_native_scope:handle.descriptor.parent,actual_reading:false,source_quality_passed:false});
  const strings=Object.values(documents);if(strings.reduce((n,s)=>n+Buffer.byteLength(s),0)>PILOT_LIMITS.per_case_uncompressed_artifact_bytes)fail('PILOT_READER_PREPARATION_RESOURCE_BOUND','Unabridged required evidence exceeds declared budget; record missing scope, no qualified reading');
  return Object.freeze({...documents});
}
