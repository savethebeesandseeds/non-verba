// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE. In-memory replay only; ROOT owns all source/custody IO and permits.
import {extractSections as baselineExtract} from '../sections.prototype.mjs';
import {extractSections as frozenV2Extract} from '../list-governor-boundary-v2/sections.prototype.mjs';
import {probeExtractSections,LIST_GOVERNOR_BOUNDARY_POLICY} from '../boundary-activation-probe-v1/sections.prototype.mjs';
import {verifyBoundaryProbe,projectBoundaryProbe} from '../boundary-activation-probe-v1/probe.mjs';
import {sha,digest} from '../finite-codec.mjs';
import {immutableCopy} from '../immutable-state.mjs';
import {verifyNativeDecorationEnvelope} from '../source-decoration.prototype.mjs';
import {stableCoreDifferences} from '../typed-owned-preparation-v1/comparison.mjs';
import {RUN,SOURCE,LIMITS,COMPARISON_CASES as CASES,COMPARISON_ROWS as ROWS,COMPARISON_REFS,CACHE_RESULT_SHA256S} from '../source-only-adverse-comparison-v1/fixed-cases.mjs';
export const REPLAY_METHODS=immutableCopy({tracer_sha256:'803a661ac8880d1f43bdf99f2a8303402cd3c9ecdd0e16981b10e8fc2fda4d02',baseline_collector_sha256:'96bfc4a6baab4e31efa0b7f7a21ea2bed158983adc6ff8556d3ac5d6769142cd',frozen_v2_collector_sha256:'28487f588b98d5836e4c1fa9f98fd61159c81113b40e4320d5abed108c436ee4',variant_collector_sha256:'bfcfe2b48b8d8e505490b160e1c94130cac1efd0653d034dfcd7e1fb076585a8',variant_policy:LIST_GOVERNOR_BOUNDARY_POLICY});
const EXPECTED_V2_SUMMARIES=immutableCopy([{path:RUN+'/qa/literal-emphasis-parent-v1-boundary-source-replay-v2/outputs/development-0055/summary.json',sha256:'95c4d2534f91095ebb4648b7114d5cdc2edd500174209e9d646343cfb39a7044',bytes:5172},{path:RUN+'/qa/literal-emphasis-parent-v1-boundary-source-replay-v2/outputs/development-0047/summary.json',sha256:'b35bff1d16eacdc06cb8d8d08595b5e334f76e95685e6ada647f4bd33c170c88',bytes:5180}]);
const KIND='ACTUAL_EXPLORATORY_SOURCE_ONLY',Q12=RUN+'/qa/literal-emphasis-parent-v1-source-only-adverse-comparison-v1';
const check=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});},same=(a,b)=>digest(a)===digest(b),J=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const sealed=v=>{const{sha256,...body}=v??{};return hash(sha256)&&digest(body)===sha256;};
function text(bytes){const value=bytes.toString('utf8');check(Buffer.from(value).equals(bytes),'REPLAY_EXACT_UTF8');return value;}
function interval(value,start,end){check(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&end>start&&end<=value.length,'REPLAY_INTERVAL');}
function nativeInvariant(e){const{sha256,collector_source_sha256,...body}=e;return digest(body);}
function unknowns(e){return digest({unmapped:e.unmapped,unmapped_normalized:e.unmapped_normalized,ambiguous_segments:e.ambiguous_segments,joint_whitespace_segments:e.joint_whitespace_segments,blocking_ambiguous_segments:e.blocking_ambiguous_segments,collector_issues:e.collector_issues,trace_unresolved:e.trace.unresolved,parser_errors:e.trace.parser_errors});}
function geometry(result){return digest({sections:result.sections.map(s=>({id:s.id,start:s.start,end:s.end,sha256:s.sha256})),units:result.units.map(u=>({id:u.id,parent_section_id:u.parent_section_id,start:u.start,end:u.end,sha256:u.sha256}))});}
function coverage(rows,scope,normalized){
  const spans=rows.map(r=>({start:Math.max(r.start,scope.start),end:Math.min(r.end,scope.end)})).filter(r=>r.end>r.start).sort((a,b)=>a.start-b.start||a.end-b.end),merged=[];
  for(const span of spans){const last=merged.at(-1);if(last&&span.start<=last.end)last.end=Math.max(last.end,span.end);else merged.push({...span});}
  let at=scope.start,covered=0,uncovered=0,nonwhite=0;const gaps=[];
  for(const span of[...merged,{start:scope.end,end:scope.end}]){if(span.start>at){const value=normalized.slice(at,span.start);gaps.push({start:at,end:span.start,sha256:sha(value)});uncovered+=value.length;nonwhite+=value.replace(/\s/gu,'').length;}covered+=span.end-span.start;at=Math.max(at,span.end);}
  return{covered_utf16:covered,uncovered_utf16:uncovered,uncovered_non_whitespace_utf16:nonwhite,intersecting_parent_count:spans.length,containing_parent_count:rows.filter(r=>r.start<=scope.start&&r.end>=scope.end).length,merged_intervals:merged,gaps};
}

/** Pure facts helper shared with SOURCE_FREE controls. It cannot authenticate
 * a packet or authorize source IO. Inputs are real collector results, not
 * invented source geometry. It returns no source words or heading labels. */
export function measureReplayInvariants({result,expectedNative,raw,normalizedText,collectorSHA256,originalFocal,originalParent}){
  check([REPLAY_METHODS.baseline_collector_sha256,REPLAY_METHODS.frozen_v2_collector_sha256,REPLAY_METHODS.variant_collector_sha256].includes(collectorSHA256),'REPLAY_METHOD_IDENTITY');
  check(result?.status==='accepted'&&result.normalized_text===normalizedText&&result.normalized_sha256===sha(normalizedText)&&Array.isArray(result.sections)&&Array.isArray(result.units),'REPLAY_NORMALIZED_LITERAL');
  const e=result.native_source_decorations;
  verifyNativeDecorationEnvelope(expectedNative,{raw,normalizedText,expectedTracerSourceSHA256:REPLAY_METHODS.tracer_sha256,expectedCollectorSourceSHA256:REPLAY_METHODS.baseline_collector_sha256});
  verifyNativeDecorationEnvelope(e,{raw,normalizedText,expectedTracerSourceSHA256:REPLAY_METHODS.tracer_sha256,expectedCollectorSourceSHA256:collectorSHA256});
  check(nativeInvariant(e)===nativeInvariant(expectedNative),'REPLAY_NATIVE_ORIGIN_OR_UNKNOWN_DIFFERENCE');
  for(const row of[...result.sections,...result.units,...result.sections.flatMap(s=>s.units??[])])check(same(row.native_source_decorations_ref,{envelope_sha256:e.sha256,raw_sha256:e.raw.sha256,normalized_sha256:e.normalized.sha256,tracer_source_sha256:e.tracer_source_sha256,collector_source_sha256:e.collector_source_sha256,policy:e.policy,collector_policy:'EXTRACTOR_EMITTED_ORIGIN_ROPES_V3',start:row.start,end:row.end,mapping_status:e.mapping_status,input_eligibility:e.input_eligibility,projection_required:true}),'REPLAY_SCOPED_NATIVE_REFERENCE');
  const baseline=collectorSHA256===REPLAY_METHODS.baseline_collector_sha256;
  if(baseline)check(same(e,expectedNative),'REPLAY_BASELINE_NATIVE_DIFFERENCE');
  const sectionIDs=new Set(),unitIDs=new Set();
  for(const section of result.sections){interval(normalizedText,section.start,section.end);check(typeof section.id==='string'&&!sectionIDs.has(section.id)&&Number.isSafeInteger(section.word_count)&&section.word_count>=0&&Array.isArray(section.units)&&section.text===normalizedText.slice(section.start,section.end)&&sha(section.text)===section.sha256,'REPLAY_SECTION_GEOMETRY');sectionIDs.add(section.id);}
  for(const unit of result.units){interval(normalizedText,unit.start,unit.end);const parent=result.sections.find(s=>s.id===unit.parent_section_id);check(typeof unit.id==='string'&&!unitIDs.has(unit.id)&&Number.isSafeInteger(unit.word_count)&&unit.word_count>=0&&parent&&parent.start<=unit.start&&unit.end<=parent.end&&unit.text===normalizedText.slice(unit.start,unit.end)&&sha(unit.text)===unit.sha256,'REPLAY_UNIT_GEOMETRY');unitIDs.add(unit.id);}
  for(const scope of[originalFocal,originalParent]){interval(normalizedText,scope.start,scope.end);check(sha(normalizedText.slice(scope.start,scope.end))===scope.sha256,'REPLAY_ORIGINAL_LITERAL_BINDING');}
  const oldFocal=result.units.find(u=>u.id===originalFocal.id),oldParent=result.sections.find(s=>s.id===originalParent.id),exact=(row,scope)=>Boolean(row&&row.start===scope.start&&row.end===scope.end&&row.sha256===scope.sha256);
  if(baseline)check(exact(oldFocal,originalFocal)&&exact(oldParent,originalParent)&&oldFocal.parent_section_id===oldParent.id,'REPLAY_BASELINE_ORIGINAL_GEOMETRY');
  const overlaps=result.sections.filter(s=>s.end>originalParent.start&&s.start<originalParent.end).map(s=>({id_sha256:sha(s.id),start:s.start,end:s.end,sha256:s.sha256,word_count:s.word_count,unit_count:s.units.length,intersection_start:Math.max(s.start,originalParent.start),intersection_end:Math.min(s.end,originalParent.end),contains_original_focal:s.start<=originalFocal.start&&s.end>=originalFocal.end}));
  const closures=result.warnings.filter(w=>w.code==='PROTOTYPE_EMPHASIZED_NUMERIC_PEER_CLOSURE_HYPOTHESIS');
  for(const warning of closures)check(Number.isSafeInteger(warning.count)&&warning.count>=0&&warning.boundary_verified===false&&warning.semantic_completeness_verified===false,'REPLAY_CLOSURE_HYPOTHESIS');
  return immutableCopy({collector_sha256:collectorSHA256,native_envelope_sha256:e.sha256,native_invariant_sha256:nativeInvariant(e),trace_sha256:e.trace.sha256,segments_sha256:digest(e.segments),unknowns_sha256:unknowns(e),section_count:result.sections.length,unit_count:result.units.length,geometry_sha256:geometry(result),original_focal_id_sha256:sha(originalFocal.id),original_parent_id_sha256:sha(originalParent.id),original_focal_identity_present:exact(oldFocal,originalFocal),original_parent_identity_present:exact(oldParent,originalParent),current_parent_overlaps:overlaps,focal_coverage:coverage(result.sections,originalFocal,normalizedText),closure_hypothesis_count:closures.reduce((n,w)=>n+w.count,0),frame_hypothesis_count:result.sections.reduce((n,s)=>n+s.governor_frames.filter(f=>f.closure==='NEXT_EMPHASIZED_NUMERIC_PEER_HYPOTHESIS_NOT_SEMANTIC_CLOSURE').length,0),selection_recomputed:false,quality_gate_pass:false,authority:'NONE'});
}

/** Bounded SOURCE_FREE comparison helper, not source authentication or IO
 * authority. The caller additionally validates both complete native envelopes
 * through measureReplayInvariants before accepting an actual replay. */
export function measureProbeObservation({frozenV2,diagnostic,probe}){
  verifyBoundaryProbe(probe);
  check(frozenV2?.status==='accepted'&&diagnostic?.status==='accepted','REPLAY_PROBE_EXTRACTION_STATUS');
  check(stableCoreDifferences(frozenV2,diagnostic).length===0,'REPLAY_PROBE_V2_CORE_DIFFERENCE');
  const a=frozenV2.native_source_decorations,b=diagnostic.native_source_decorations;
  check(sealed(a)&&sealed(b)&&a.collector_source_sha256===REPLAY_METHODS.frozen_v2_collector_sha256&&b.collector_source_sha256===REPLAY_METHODS.variant_collector_sha256&&nativeInvariant(a)===nativeInvariant(b),'REPLAY_PROBE_V2_NATIVE_DIFFERENCE');
  check(geometry(frozenV2)===geometry(diagnostic),'REPLAY_PROBE_V2_GEOMETRY_DIFFERENCE');
  const projection=projectBoundaryProbe(probe);
  check(J(projection).length<=65536,'REPLAY_PROBE_SUMMARY_BOUND');
  return immutableCopy(projection);
}

function metadataRef(ref,path,max=262144){check(ref&&ref.path===path&&hash(ref.sha256)&&Number.isSafeInteger(ref.bytes)&&ref.bytes>0&&ref.bytes<=max,'REPLAY_CUSTODY_REF');}
function documentRef(ref,path,bytes,encoding){
  metadataRef(ref,path,8388608);check(ref.encoding===encoding&&Number.isSafeInteger(ref.decoded_bytes)&&ref.decoded_bytes>0&&ref.decoded_bytes<=33554432&&hash(ref.decoded_sha256)&&ref.decoded_bytes===bytes.length&&ref.decoded_sha256===sha(bytes),'REPLAY_CUSTODY_DOCUMENT');
  if(encoding==='identity')check(ref.bytes===bytes.length&&ref.sha256===sha(bytes),'REPLAY_IDENTITY_DOCUMENT');
}
function guardedMetadata(binding,row,sourceProof,freshGuard){
  const expected=CASES.find(c=>c.audit_id===row?.audit_id);check(expected&&same(binding,expected)&&digest(row)===binding.row_canonical_sha256&&row.focal_kind==='ACTUAL_UNIT','REPLAY_FIXED_CASE');
  check(sealed(sourceProof)&&sourceProof.sha256===SOURCE&&sourceProof.runtime?.node===process.version&&sourceProof.runtime?.platform===process.platform&&sourceProof.runtime?.architecture===process.arch&&sourceProof.parameters?.selection_authority==='PROVISIONAL_PER_CONTRACT_ONLY_GLOBAL_ADMISSION_SEPARATE','REPLAY_CURRENT_SOURCE');
  const bytes=J(freshGuard),{projection_sha256,...body}=freshGuard??{},ids=[...new Set(freshGuard?.rows?.map(r=>r.contract_id))].sort();
  check(bytes.length===COMPARISON_REFS.metadata_inputs.guard.bytes&&sha(bytes)===COMPARISON_REFS.metadata_inputs.guard.sha256&&digest(body)===projection_sha256&&freshGuard.schema==='stored-reader-complete-fresh100-guard-v1'&&freshGuard.rows.length===100&&new Set(freshGuard.rows.map(r=>r.audit_id)).size===100&&ids.length===29&&same(ids,freshGuard.contract_ids)&&!ids.includes(binding.contract_id),'REPLAY_COMPLETE_FRESH_GUARD');
}

/** No IO or permit minting. ROOT must authenticate the completion/manifest
 * graph and every encoded document before passing decoded buffers here. ROOT
 * also verifies these fixed module hashes in its private source epoch before
 * import. Custody refs by themselves never confer that authority. */
export function prepareBoundaryReplay(loaded){
  check(loaded&&loaded.binding&&CASES.some(c=>same(c,loaded.binding)),'REPLAY_FIXED_BINDING');
  const binding=immutableCopy(loaded.binding),index=CASES.findIndex(c=>c.audit_id===binding.audit_id);
  for(const[key,max]of[['rawBytes',LIMITS.raw_bytes],['normalizedBytes',LIMITS.decoded_characters],['baselineNativeBytes',33554432]])check(Buffer.isBuffer(loaded[key])&&loaded[key].length>0&&loaded[key].length<=max,'REPLAY_BUFFER_BOUND');
  check(binding.cache_storage.decoded_bytes+loaded.rawBytes.length+loaded.normalizedBytes.length+loaded.baselineNativeBytes.length<=33554432,'REPLAY_COMBINED_INPUT_BOUND');
  const rawBytes=Buffer.from(loaded.rawBytes),normalizedBytes=Buffer.from(loaded.normalizedBytes),baselineNativeBytes=Buffer.from(loaded.baselineNativeBytes),raw=text(rawBytes),normalizedText=text(normalizedBytes);
  const{row,record,currentCache,sourceProof,freshGuard,custody}=immutableCopy({row:loaded.row,record:loaded.record,currentCache:loaded.currentCache,sourceProof:loaded.sourceProof,freshGuard:loaded.freshGuard,custody:loaded.custody});
  guardedMetadata(binding,row,sourceProof,freshGuard);
  const cacheBytes=J(currentCache),inputDecodedBytes=cacheBytes.length+rawBytes.length+normalizedBytes.length+baselineNativeBytes.length;
  check(inputDecodedBytes<=33554432&&cacheBytes.length===binding.cache_storage.decoded_bytes&&sha(cacheBytes)===binding.cache_storage.decoded_sha256&&digest(currentCache)===CACHE_RESULT_SHA256S[index],'REPLAY_ORIGINAL_CACHE');
  check(same(record,currentCache.contract)&&record.id===binding.contract_id&&record.path===row.raw_path&&record.format==='html'&&same(sourceProof,currentCache.source)&&currentCache.status==='accepted'&&currentCache.raw_sha256===sha(rawBytes)&&currentCache.normalized_text===normalizedText&&currentCache.normalized_sha256===sha(normalizedBytes)&&sha(rawBytes)===binding.source_refs.raw.sha256&&rawBytes.length===binding.source_refs.raw.bytes&&sha(normalizedBytes)===binding.source_refs.normalized.sha256&&normalizedBytes.length===binding.source_refs.normalized.bytes,'REPLAY_SOURCE_JOIN');
  check(sealed(currentCache.native_source_decorations)&&currentCache.native_source_decorations.sha256===binding.native_reference_sha256&&currentCache.native_source_decorations.envelope_sha256===binding.native_envelope_sha256,'REPLAY_OLD_NATIVE_REFERENCE');
  metadataRef(custody.prior_completion_ref,Q12+'/ROOT-source-only-completion.json');metadataRef(custody.prior_manifest_ref,Q12+'/outputs/'+binding.audit_id+'/manifest.json');metadataRef(custody.prior_descriptor_ref,Q12+'/outputs/'+binding.audit_id+'/descriptor.json');
  documentRef(custody.raw_document_ref,Q12+'/outputs/'+binding.audit_id+'/raw_full.txt',rawBytes,'identity');documentRef(custody.normalized_document_ref,Q12+'/outputs/'+binding.audit_id+'/normalized_full.txt',normalizedBytes,'identity');documentRef(custody.native_document_ref,Q12+'/outputs/'+binding.audit_id+'/new_native.json.gz',baselineNativeBytes,'gzip');
  const storedNative=JSON.parse(text(baselineNativeBytes)),descriptor=custody.descriptor,descriptorBytes=J(descriptor);
  check(descriptorBytes.length===custody.prior_descriptor_ref.bytes&&sha(descriptorBytes)===custody.prior_descriptor_ref.sha256&&descriptor.schema==='fixed-case-source-only-adverse-comparison-descriptor-v1'&&descriptor.source_kind===KIND&&descriptor.audit_id===binding.audit_id&&descriptor.contract_id===binding.contract_id&&descriptor.current_source_sha256===SOURCE&&descriptor.new_native_envelope_sha256===storedNative.sha256&&descriptor.raw_sha256===sha(rawBytes)&&descriptor.normalized_sha256===sha(normalizedBytes)&&same(descriptor.parent,binding.parent)&&same(descriptor.focal,{id:row.focal_id,start:row.focal_start,end:row.focal_end,sha256:row.focal_sha256})&&descriptor.source_quality_passed===false&&descriptor.authority==='NONE','REPLAY_PRIOR_DESCRIPTOR');
  const originalFocal={id:row.focal_id,start:row.focal_start,end:row.focal_end,sha256:row.focal_sha256},originalParent=binding.parent,extractionOptions=sourceProof.parameters.extraction;
  check(extractionOptions&&Number.isSafeInteger(extractionOptions.maxPerContract)&&extractionOptions.maxPerContract>0,'REPLAY_EXTRACTION_OPTIONS');
  const extract=(fn,collector)=>fn({...record,content:raw},{...extractionOptions,nativeDecorationIdentity:{tracerSourceSHA256:REPLAY_METHODS.tracer_sha256,collectorSourceSHA256:collector}});
  const wrap=(result,method_kind,probe)=>({schema:'boundary-source-replay-artifact-v1',source_kind:KIND,audit_id:binding.audit_id,contract_id:binding.contract_id,case_id:binding.case_id,method_kind,current_source_sha256:SOURCE,method:{tracer_sha256:REPLAY_METHODS.tracer_sha256,collector_sha256:method_kind==='BASELINE_NINE_TAG'?REPLAY_METHODS.baseline_collector_sha256:REPLAY_METHODS.variant_collector_sha256,boundary_policy:method_kind==='BASELINE_NINE_TAG'?null:LIST_GOVERNOR_BOUNDARY_POLICY},custody,record,source_proof:sourceProof,original_focal:originalFocal,original_parent:originalParent,raw_full:raw,extraction:result,...(probe?{activation_probe:probe}:{}),selection_recomputed:false,source_words_truncated:false,quality_gate_pass:false,authority:'NONE'});
  let baseline=extract(baselineExtract,REPLAY_METHODS.baseline_collector_sha256);
  check(Buffer.from(JSON.stringify(baseline.native_source_decorations)).equals(baselineNativeBytes),'REPLAY_BASELINE_NATIVE_BYTES');
  check(stableCoreDifferences(currentCache,baseline).length===0,'REPLAY_BASELINE_NON_NATIVE_BRIDGE');
  const baselineFacts=measureReplayInvariants({result:baseline,expectedNative:storedNative,raw,normalizedText,collectorSHA256:REPLAY_METHODS.baseline_collector_sha256,originalFocal,originalParent}),baselineBytes=Buffer.from(JSON.stringify(wrap(baseline,'BASELINE_NINE_TAG')));
  // Drop the full baseline tree before constructing frozen V2 and its observed
  // copy. Retain its serialized artifact, small facts and admitted native input.
  baseline=null;
  let frozenV2=extract(frozenV2Extract,REPLAY_METHODS.frozen_v2_collector_sha256);
  const frozenFacts=measureReplayInvariants({result:frozenV2,expectedNative:storedNative,raw,normalizedText,collectorSHA256:REPLAY_METHODS.frozen_v2_collector_sha256,originalFocal,originalParent});
  const expectedRef=EXPECTED_V2_SUMMARIES[index],expected=custody.expected_frozen_V2_summary,expectedBytes=J(expected);
  check(same(custody.expected_frozen_V2_summary_ref,expectedRef)&&expectedBytes.length===expectedRef.bytes&&sha(expectedBytes)===expectedRef.sha256,'REPLAY_FROZEN_V2_SUMMARY_PIN');
  check(expected.schema==='boundary-source-replay-summary-v1'&&expected.source_kind===KIND&&expected.status==='REPLAY_PREPARATION_NOT_QUALITY'&&expected.case_id===binding.case_id&&expected.audit_number===Number(binding.audit_id.slice(-4))&&expected.current_source_sha256===SOURCE&&expected.quality_gate_pass===false,'REPLAY_FROZEN_V2_SUMMARY_HEADER');
  const{artifact_sha256:priorArtifactSHA,artifact_bytes:priorArtifactBytes,...expectedFacts}=expected.variant;
  check(hash(priorArtifactSHA)&&Number.isSafeInteger(priorArtifactBytes)&&priorArtifactBytes>0&&same(expectedFacts,frozenFacts),'REPLAY_FROZEN_V2_RETAINED_FACTS');
  const{extraction:variant,probe}=extract(probeExtractSections,REPLAY_METHODS.variant_collector_sha256);
  const variantFacts=measureReplayInvariants({result:variant,expectedNative:storedNative,raw,normalizedText,collectorSHA256:REPLAY_METHODS.variant_collector_sha256,originalFocal,originalParent});
  const activation=measureProbeObservation({frozenV2,diagnostic:variant,probe});
  // Observation is now bound. Drop the extra frozen tree before serialization.
  frozenV2=null;
  const variantBytes=Buffer.from(JSON.stringify(wrap(variant,'LIST_GOVERNOR_VARIANT',probe)));
  const summary=immutableCopy({schema:'boundary-source-replay-summary-v1',source_kind:KIND,status:'REPLAY_PREPARATION_NOT_QUALITY',case_id:binding.case_id,audit_number:Number(binding.audit_id.slice(-4)),comparison_sequence_index:index,current_source_sha256:SOURCE,custody_sha256:digest(custody),raw_sha256:sha(rawBytes),normalized_sha256:sha(normalizedBytes),input_decoded_bytes:inputDecodedBytes,baseline:{...baselineFacts,artifact_sha256:sha(baselineBytes),artifact_bytes:baselineBytes.length},variant:{...variantFacts,artifact_sha256:sha(variantBytes),artifact_bytes:variantBytes.length},activation_probe:activation,observational_V2_core_equal:true,observational_V2_native_equal:true,frozen_V2_summary_sha256:expectedRef.sha256,frozen_V2_geometry_sha256:frozenFacts.geometry_sha256,frozen_V2_native_invariant_sha256:frozenFacts.native_invariant_sha256,baseline_core_bridge_equal:true,baseline_native_exact_prior_bytes:true,normalized_literal_preserved:true,native_origins_and_unknowns_preserved:true,variant_geometry_changed:baselineFacts.geometry_sha256!==variantFacts.geometry_sha256,selection_recomputed:false,tokenizer_calls:0,model_access:false,actual_source_open_authority:false,quality_gate_pass:false,authority:'NONE'});
  check(J(summary).length<=65536&&baselineBytes.length+variantBytes.length+J(summary).length<=33554432,'REPLAY_UNABRIDGED_OUTPUT_BOUND');
  return Object.freeze({baselineBytes,variantBytes,summary,inputDecodedBytes});
}
