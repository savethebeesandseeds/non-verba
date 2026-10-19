// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED. Exactly0055 then0047; no IO permit or model entry.
import {sha,digest,deriveFiniteNine,decodeModelText} from '../finite-codec.mjs';
import {LIMITS,COMPARISON_CASES as CASES,COMPARISON_ROWS as ROWS} from './fixed-cases.mjs';
import {immutableCopy} from '../immutable-state.mjs';
import {computePilotEpoch,verifyCurrentProof} from '../pilot-identity.mjs';
import {verifyNativeDecorationEnvelope} from '../source-decoration.prototype.mjs';
import {stableCoreDifferences,stableSelectionDifferences} from '../typed-owned-preparation-v1/comparison.mjs';

const KIND='ACTUAL_EXPLORATORY_SOURCE_ONLY';
function pins(binding){const row=ROWS.find(r=>r.audit_id===binding.audit_id);return{audit_id:binding.audit_id,contract_id:binding.contract_id,row_sha256:binding.row_canonical_sha256,source_sha256:binding.current_source_sha256,raw_sha256:binding.source_refs.raw.sha256,raw_bytes:binding.source_refs.raw.bytes,normalized_sha256:binding.source_refs.normalized.sha256,normalized_bytes:binding.source_refs.normalized.bytes,old_envelope_sha256:binding.native_envelope_sha256,old_native_reference_sha256:binding.native_reference_sha256,parent_id:binding.parent.id,focal_id:row.focal_id,focal_start:binding.focal.start,focal_end:binding.focal.end,focal_sha256:binding.focal.sha256,parent_start:binding.parent.start,parent_end:binding.parent.end,parent_sha256:binding.parent.sha256,declared_combined_decoded_input_bytes:binding.declared_combined_decoded_input_bytes};}
const REF_KEYS=new Set(['envelope_sha256','raw_sha256','normalized_sha256','tracer_source_sha256','collector_source_sha256','policy','collector_policy','start','end','mapping_status','input_eligibility','projection_required']);
function check(ok,code){if(!ok)throw Object.assign(new Error(code),{code});}
function point(text,n){return !(n>0&&n<text.length&&/[\uD800-\uDBFF]/u.test(text[n-1])&&/[\uDC00-\uDFFF]/u.test(text[n]));}
function range(text,start,end){check(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&end>=start&&end<=text.length&&point(text,start)&&point(text,end),'ADVERSE_EXACT_RANGE');}
function sealed(value){const{sha256,...body}=value??{};return typeof sha256==='string'&&sha256===digest(body);}
function mapUnique(rows,code){check(Array.isArray(rows),code);const map=new Map();for(const row of rows){check(typeof row?.id==='string'&&!map.has(row.id),code);map.set(row.id,row);}return map;}

// Narrow consistency verification, not a replacement for ROOT's private read gate.
// Current V4 and rebuilt prototype native evidence retain distinct identities.
function nativeReferences(result,{tracer,collector,policy,raw}){
  const e=result.native_source_decorations,t=e?.trace;
  check(sealed(e)&&sealed(t)&&e.policy===policy&&t.policy===policy&&e.tracer_source_sha256===tracer&&e.collector_source_sha256===collector&&e.raw?.sha256===sha(raw)&&e.raw.characters===raw.length&&e.raw.bytes===Buffer.byteLength(raw)&&digest(t.raw)===digest(e.raw)&&e.normalized?.sha256===sha(result.normalized_text)&&e.normalized.sha256===result.normalized_sha256&&e.normalized.characters===result.normalized_text.length,'ADVERSE_NATIVE_BINDING');
  check(Array.isArray(result.sections)&&Array.isArray(result.units),'ADVERSE_NATIVE_ROWS');
  for(const row of [...result.sections,...result.units,...result.sections.flatMap(s=>s.units??[])]){
    const ref=row.native_source_decorations_ref,expected={envelope_sha256:e.sha256,raw_sha256:e.raw.sha256,normalized_sha256:e.normalized.sha256,tracer_source_sha256:tracer,collector_source_sha256:collector,policy,collector_policy:'EXTRACTOR_EMITTED_ORIGIN_ROPES_V3',start:row.start,end:row.end,mapping_status:e.mapping_status,input_eligibility:e.input_eligibility,projection_required:true};
    check(ref&&Object.keys(ref).every(k=>REF_KEYS.has(k))&&digest(ref)===digest(expected),'ADVERSE_NATIVE_REFERENCE');
  }
}

function frozenGeometry(result,row,fixed){
  const units=result.units.filter(u=>u.id===row.focal_id),parents=result.sections.filter(p=>p.id===row.parent_id),unit=units[0],parent=parents[0];
  check(units.length===1&&parents.length===1&&unit.parent_section_id===parent.id&&unit.contract_id===fixed.contract_id&&parent.contract_id===fixed.contract_id&&unit.start===fixed.focal_start&&unit.end===fixed.focal_end&&parent.start===fixed.parent_start&&parent.end===fixed.parent_end&&unit.sha256===fixed.focal_sha256&&parent.sha256===fixed.parent_sha256,'ADVERSE_FROZEN_GEOMETRY');
  range(result.normalized_text,parent.start,parent.end);
  check(unit.text===result.normalized_text.slice(unit.start,unit.end)&&parent.text===result.normalized_text.slice(parent.start,parent.end)&&sha(unit.text)===unit.sha256&&sha(parent.text)===parent.sha256,'ADVERSE_LITERAL_GEOMETRY');
  return{unit,parent};
}

function parentEvidence(envelope,parent,raw,epoch){
  const trace=envelope.trace,paths=mapUnique(trace.paths,'ADVERSE_PATH_DICTIONARY'),sources=mapUnique(trace.sources,'ADVERSE_SOURCE_DICTIONARY'),allRuns=mapUnique(trace.runs,'ADVERSE_RUN_DICTIONARY');
  const segments=envelope.segments.filter(s=>s.end>parent.start&&s.start<parent.end||s.start===s.end&&s.start>=parent.start&&s.start<=parent.end),runIDs=new Set(segments.flatMap(s=>s.sources.map(o=>o.run_id)));
  const runs=[...runIDs].map(id=>{check(allRuns.has(id),'ADVERSE_SELECTED_RUN_MISSING');return allRuns.get(id);});
  function ancestry(sourceRuns){const selectedPaths=new Set(),selectedSources=new Set();for(const run of sourceRuns){let id=run.path_id;const active=new Set();while(id&&!selectedPaths.has(id)){check(!active.has(id)&&active.size<=paths.size,'ADVERSE_PATH_CYCLE');active.add(id);const path=paths.get(id);check(path&&sources.has(path.source_id),'ADVERSE_PATH_SOURCE_MISSING');selectedSources.add(path.source_id);id=path.parent_id;}for(const id of active)selectedPaths.add(id);}return{paths:selectedPaths,sources:selectedSources};}
  const selected=ancestry(runs),any=ancestry(trace.runs);
  const associations=trace.sources.map(source=>({source_id:source.id,parent_relation:selected.sources.has(source.id)?'SELECTED_PARENT_SEGMENT_ORIGIN_ANCESTRY':'UNASSIGNED_NORMALIZED_PARENT_RELATION_UNKNOWN',has_any_trace_text_run_ancestry:any.sources.has(source.id),normalized_scope_assigned:selected.sources.has(source.id),reviewed:false}));
  const refs=[],unknown=[];
  function exactRaw(ref,kind,owner,{element=false}={}){
    if(!ref){unknown.push({...owner,kind,raw_range_unknown:true,reason:'NO_VERIFIED_RAW_INTERVAL'});return;}
    range(raw,ref.start,ref.end);const text=raw.slice(ref.start,ref.end),sliceSHA=sha(text);
    check(element?ref.raw_sha256===envelope.raw.sha256&&ref.binding==='WHOLE_RAW_SHA256_AND_EXACT_UTF16_INTERVAL_V1':ref.sha256===sliceSHA,'ADVERSE_RAW_CONTEXT_BINDING');
    refs.push({...owner,kind,start:ref.start,end:ref.end,sha256:sliceSHA,whole_raw_sha256:envelope.raw.sha256,offset_basis:'UTF16_IN_DECODED_RAW_SOURCE_NOT_BYTES',scope_may_extend_selected_parent:true,reviewed:false});
  }
  for(const run of runs){check(typeof run.decoded_text==='string'&&sha(run.decoded_text)===run.decoded_sha256,'ADVERSE_RUN_DECODED_BINDING');exactRaw(run.raw,'SELECTED_ORIGIN_RUN_RAW',{run_id:run.id,path_id:run.path_id});}
  for(const pathID of selected.paths){
    const path=paths.get(pathID),source=sources.get(path.source_id),owner={path_id:path.id,source_id:source.id,dom_scope_id:path.dom_scope_id??null};
    // Literal tokens remain useful even when a reconstructed DOM scope has no
    // verified element interval. They never establish an invented raw parent.
    exactRaw(source.start_tag,'ANCESTOR_LITERAL_SOURCE_TOKEN',owner);
    let scope=null;
    if(path.dom_scope_id!=null){const matches=source.dom_scopes?.filter(s=>s.id===path.dom_scope_id)??[];check(matches.length===1,'ADVERSE_DOM_SCOPE_BINDING');scope=matches[0];}
    else if(!source.dom_scopes)scope={...source.element_scope,element:source.element,element_start_tag:source.element_start_tag,end_tag:source.end_tag};
    if(scope?.raw_interval_verified===true&&scope.element){exactRaw(scope.element,'VERIFIED_ANCESTOR_ELEMENT_INTERVAL',owner,{element:true});if(scope.element_start_tag)exactRaw(scope.element_start_tag,'VERIFIED_ELEMENT_START_TOKEN',owner);if(scope.end_tag)exactRaw(scope.end_tag,'VERIFIED_ELEMENT_END_TOKEN',owner);}
    else unknown.push({...owner,kind:'ANCESTOR_ELEMENT_INTERVAL',raw_range_unknown:true,reason:'RECOVERED_OR_RECONSTRUCTED_SCOPE_NOT_VERIFIED',parser_reported_location_is_not_a_verified_range:true});
  }
  // Merge only overlapping/adjacent KNOWN raw coordinates, never decoded-text
  // searching. Original references stay intact; gaps remain explicitly absent.
  const intervals=refs.map(r=>({start:r.start,end:r.end})).sort((a,b)=>a.start-b.start||a.end-b.end),merged=[];
  for(const interval of intervals){const last=merged.at(-1);if(last&&interval.start<=last.end)last.end=Math.max(last.end,interval.end);else merged.push({...interval});}
  let joined=0;const spans=merged.map(({start,end})=>{const text=raw.slice(start,end),span={start,end,sha256:sha(text),joined_start:joined,joined_end:joined+text.length,text};joined+=text.length;return span;}),literalJoin=spans.map(s=>s.text).join('');
  const rawParentContext=immutableCopy({schema:'selected-parent-exact-raw-origin-context-v1',source_kind:KIND,whole_raw_sha256:envelope.raw.sha256,selected_parent:{id:parent.id,start:parent.start,end:parent.end,sha256:parent.sha256},raw_offset_basis:'UTF16_IN_DECODED_RAW_SOURCE_NOT_BYTES',spans,range_references:refs,raw_range_unknown:unknown,literal_join:literalJoin,literal_join_sha256:sha(literalJoin),join_is_discontinuous:spans.some((s,i)=>i>0&&spans[i-1].end!==s.start),gap_text_invented:false,decoded_text_search_used:false,scope:'EXACT_KNOWN_ORIGIN_CONTEXTS_MAY_EXTEND_PARENT_NOT_A_RAW_PARENT_BOUNDARY',whole_document_reviewed:false,reviewed:false,authority:'NONE'});
  const summary=immutableCopy({schema:'adverse-native-scope-summary-v1',source_kind:KIND,envelope_sha256:envelope.sha256,parent_segment_count:segments.length,parent_run_count:runs.length,parent_ancestry_path_count:selected.paths.size,parent_ancestry_source_count:selected.sources.size,whole_document_source_count:trace.sources.length,whole_document_path_count:trace.paths.length,unassigned_source_count:associations.filter(a=>!a.normalized_scope_assigned).length,no_run_source_count:associations.filter(a=>!a.has_any_trace_text_run_ancestry).length,raw_context_known_reference_count:refs.length,raw_context_unknown_range_count:unknown.length,whole_document_evidence_retained:true,whole_document_evidence_reviewed:false,unassigned_sources_not_asserted_inside_or_outside_parent:true,computed_style_verified:false,effectiveness_verified:false,native_authenticity_independently_reviewed:false,semantic_completeness_verified:false,quality_passed:false,authority:'NONE'});
  const evidence=immutableCopy({schema:'adverse-selected-parent-and-unassigned-native-evidence-v1',source_kind:KIND,epoch_sha256:epoch.sha256,envelope_sha256:envelope.sha256,raw_sha256:envelope.raw.sha256,normalized_sha256:envelope.normalized.sha256,selected_parent:rawParentContext.selected_parent,segments,runs,selected_path_ids:[...selected.paths],paths:trace.paths,sources:trace.sources,source_parent_associations:associations,unresolved:trace.unresolved,unmapped:envelope.unmapped,unmapped_normalized:envelope.unmapped_normalized,collector_issues:envelope.collector_issues,native_scope_summary:summary,all_trace_sources_and_paths_preserved:true,decoded_run_scope_may_extend_parent:true,unassigned_whole_document_evidence_reviewed:false,source_word_truncation:false,authority:'NONE'});
  return{evidence,rawParentContext,nativeScopeSummary:summary};
}

/** Authenticated in-memory transformation only. ROOT owns fresh guard, bounded
 * no-follow reads, receipts and output accounting. This function mints no
 * permit. computePilotEpoch reads only its existing explicit SOURCE CODE and
 * parser-dependency closure; no corpus/model payload is opened here. */
export async function prepareComparisonSource(loaded){
  const binding=CASES.find(b=>b.audit_id===loaded?.row?.audit_id);check(binding,'COMPARISON_FIXED_CASE');const fixed=pins(binding);
  check(loaded&&Buffer.isBuffer(loaded.rawBytes)&&loaded.rawBytes.length===fixed.raw_bytes&&loaded.rawBytes.length<=LIMITS.raw_bytes,'ADVERSE_FIXED_RAW_BYTES');
  const rawBytes=Buffer.from(loaded.rawBytes),raw=rawBytes.toString('utf8');
  check(Buffer.from(raw,'utf8').equals(rawBytes)&&sha(rawBytes)===fixed.raw_sha256,'ADVERSE_EXACT_UTF8_RAW');
  // Detach all caller metadata before the first await; no later mutation can
  // alter extraction parameters, the baseline or the selected case identity.
  const{row,record,currentCache,normalizedText,sourceProof}=immutableCopy({row:loaded.row,record:loaded.record,currentCache:loaded.currentCache,normalizedText:loaded.normalizedText,sourceProof:loaded.sourceProof});
  check(digest(row)===fixed.row_sha256&&row.audit_id===fixed.audit_id&&row.contract_id===fixed.contract_id&&row.development_row===true&&row.focal_kind==='ACTUAL_UNIT'&&row.focal_id===fixed.focal_id&&row.parent_id===fixed.parent_id&&row.source_sha256===fixed.source_sha256,'ADVERSE_FIXED_DEVELOPMENT_ROW');
  check(record.id===fixed.contract_id&&record.format==='html'&&record.path===row.raw_path&&digest(record)===digest(currentCache.contract)&&currentCache.raw_sha256===fixed.raw_sha256&&currentCache.status==='accepted','ADVERSE_CURRENT_CONTRACT');
  check(typeof normalizedText==='string'&&normalizedText===currentCache.normalized_text&&Buffer.byteLength(normalizedText)===fixed.normalized_bytes&&normalizedText.length<=LIMITS.decoded_characters&&sha(normalizedText)===fixed.normalized_sha256&&currentCache.normalized_sha256===fixed.normalized_sha256,'ADVERSE_NORMALIZED_BINDING');
  check(sealed(sourceProof)&&sourceProof.sha256===fixed.source_sha256&&digest(sourceProof)===digest(currentCache.source)&&sourceProof.parameters?.selection_authority==='PROVISIONAL_PER_CONTRACT_ONLY_GLOBAL_ADMISSION_SEPARATE'&&typeof sourceProof.parameters.selection_seed==='string'&&sourceProof.runtime?.node===process.version&&sourceProof.runtime?.platform===process.platform&&sourceProof.runtime?.architecture===process.arch,'ADVERSE_CURRENT_PROOF');
  const extractionOptions=sourceProof.parameters.extraction;
  check(extractionOptions&&Number.isSafeInteger(extractionOptions.maxPerContract)&&extractionOptions.maxPerContract>0,'ADVERSE_CURRENT_SELECTION_PARAMETERS');
  const selectionOptions=immutableCopy({seed:sourceProof.parameters.selection_seed,maxPerContract:extractionOptions.maxPerContract,maxUnits:Number.MAX_SAFE_INTEGER});
  const epoch=await computePilotEpoch({extractionOptions,selectionOptions});
  verifyCurrentProof(sourceProof,epoch,{control:false});
  const oldFile=name=>sourceProof.files.find(f=>f.path===name)?.sha256;
  check(currentCache.native_source_decorations?.sha256===fixed.old_envelope_sha256&&row.native_reference_sha256===fixed.old_native_reference_sha256,'ADVERSE_OLD_NATIVE_IDENTITY');
  nativeReferences(currentCache,{tracer:oldFile('source-decoration.mjs'),collector:oldFile('sections.mjs'),policy:'NATIVE_SOURCE_DECORATION_COLLECTOR_ORIGIN_V4',raw});
  frozenGeometry(currentCache,row,fixed);
  const{extractSections,selectUnits}=await import('../sections.prototype.mjs');
  const fresh=extractSections({...record,content:raw},{...extractionOptions,nativeDecorationIdentity:{tracerSourceSHA256:epoch.tracer_source_sha256,collectorSourceSHA256:epoch.collector_source_sha256}});
  const coreDelta=stableCoreDifferences(currentCache,fresh),selectionDelta=stableSelectionDifferences(selectUnits(currentCache.units,selectionOptions),selectUnits(fresh.units,selectionOptions));
  check(coreDelta.length===0&&selectionDelta.length===0,'ADVERSE_NON_NATIVE_BRIDGE_DIFFERENCE');
  check(fresh.normalized_text===normalizedText&&fresh.normalized_sha256===fixed.normalized_sha256,'ADVERSE_REBUILT_NORMALIZED');
  const envelope=fresh.native_source_decorations;
  verifyNativeDecorationEnvelope(envelope,{raw,normalizedText,expectedTracerSourceSHA256:epoch.tracer_source_sha256,expectedCollectorSourceSHA256:epoch.collector_source_sha256});
  nativeReferences(fresh,{tracer:epoch.tracer_source_sha256,collector:epoch.collector_source_sha256,policy:envelope.policy,raw});
  const{unit,parent}=frozenGeometry(fresh,row,fixed);
  check(parent.end-parent.start<=LIMITS.selected_characters,'ADVERSE_COMPLETE_SELECTED_BOUND');
  const descriptor=immutableCopy({schema:'fixed-case-source-only-adverse-comparison-descriptor-v1',source_kind:KIND,status:'PROTOTYPE_SOURCE_PREPARATION_NOT_REVIEW',audit_id:row.audit_id,contract_id:row.contract_id,focal_kind:'ACTUAL_UNIT',parent_anchor:false,focal:{id:unit.id,start:unit.start,end:unit.end,sha256:unit.sha256},parent:{id:parent.id,start:parent.start,end:parent.end,sha256:parent.sha256},focal_equals_parent_range:unit.start===parent.start&&unit.end===parent.end,focal_equals_parent_id:false,duplicate_arm_inputs_require_disclosure:true,duplicate_arm_inputs_disclosed:unit.start===parent.start&&unit.end===parent.end,duplicate_forms_are_not_independent_evidence:true,current_source_sha256:sourceProof.sha256,epoch_sha256:epoch.sha256,tracer_source_sha256:epoch.tracer_source_sha256,collector_source_sha256:epoch.collector_source_sha256,old_native_envelope_sha256:fixed.old_envelope_sha256,new_native_envelope_sha256:envelope.sha256,raw_sha256:sha(rawBytes),normalized_sha256:sha(normalizedText),non_native_fields_equal:true,selection_equal:true,normalized_literal_equal:true,allowed_native_delta:['native envelope','native references','parameters.native_decoration_policy'],new_native_evidence_is_not_old_storage_equivalence:true,limits:LIMITS,remaining_limits:{raw_bytes:LIMITS.raw_bytes-rawBytes.length,normalized_characters:LIMITS.decoded_characters-normalizedText.length,selected_parent_characters:LIMITS.selected_characters-(parent.end-parent.start),declared_combined_decoded_input_bytes:fixed.declared_combined_decoded_input_bytes,combined_decoded_input_bytes:LIMITS.combined_decoded_input_bytes-fixed.declared_combined_decoded_input_bytes,input_reference_ledger_enforced_by_root_read_gate:true},source_words_truncated:false,tokenizer_calls:0,token_count:null,window_planning:false,model_inference:false,computed_style_verified:false,effectiveness_verified:false,native_authenticity_independently_reviewed:false,whole_document_reviewed:false,source_quality_passed:false,coding_complete:false,adopted:false,actual_source_open_authority:false,authority:'NONE'});
  function finite(name,scope){
    const form=deriveFiniteNine({normalizedText,envelope,start:scope.start,end:scope.end,evidence:{source_kind:KIND,descriptor_sha256:digest(descriptor),epoch_sha256:epoch.sha256,form:name},qualification:{status:'EXPLORATORY_SOURCE_PREPARATION_NOT_REVIEW',authority:'NONE'}}),encoded=form.encodeWindow({start:scope.start,end:scope.end,includeEndZeroWidth:true});
    check(decodeModelText(encoded.text)===scope.text&&encoded.source_range.sha256===scope.sha256,'ADVERSE_FINITE_LITERAL_ROUNDTRIP');
    return immutableCopy({binding:form.binding,features:form.features,external_segments:form.externalSegments,encoded,serialization_scope:'FULL_SELECTED_RANGE_NOT_TOKEN_WINDOWS',tokenizer_calls:0,token_count:null,window_planning:false,model_inference:false,authority:'NONE'});
  }
  const parentFinite=finite('FULL_SELECTED_PARENT',parent),focalFinite=finite('ACTUAL_UNIT_FOCAL_ONLY_ABLATION',unit),evidence=parentEvidence(envelope,parent,raw,epoch),normalizedBytes=Buffer.from(normalizedText,'utf8'),nativeBytes=Buffer.from(JSON.stringify(envelope),'utf8');
  const data={descriptor,parentLiteral:parent.text,focalLiteral:unit.text,parent_text:parent.text,focal_text:unit.text,finite9_parent:parentFinite.encoded.text,finite9_focal:focalFinite.encoded.text,parentFinite,focalFinite,parentEvidence:evidence.evidence,rawParentContext:evidence.rawParentContext,nativeScopeSummary:evidence.nativeScopeSummary};
  // Full evidence is retained or the whole preparation fails. ROOT additionally
  // accounts actual serialized/gzip documents and aggregate output before write.
  const projectedBytes=rawBytes.length+normalizedBytes.length+nativeBytes.length+Buffer.byteLength(JSON.stringify(data));
  check(projectedBytes<=LIMITS.uncompressed_output_bytes,'ADVERSE_UNABRIDGED_OUTPUT_BOUND');
  return Object.freeze({...data,epoch,rawBytes,normalizedBytes,nativeBytes,outputBudget:immutableCopy({projected_uncompressed_bytes:projectedBytes,remaining_uncompressed_bytes:LIMITS.uncompressed_output_bytes-projectedBytes,compressed_bytes_not_measured:true,compressed_limit_bytes:LIMITS.compressed_output_bytes,root_final_serialization_accounting_required:true}),full_native_envelope_retained:true,whole_document_reviewed:false,actual_source_open_authority:false,authority:'NONE'});
}
