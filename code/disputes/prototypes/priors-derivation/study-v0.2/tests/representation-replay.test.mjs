// SPDX-License-Identifier: AGPL-3.0-only
// DECLARED_SYNTHETIC. Test declarations never establish actual corpus reading.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {digest,sha256} from '../../lib/common.mjs';
import {STUDY_BASE,validateStudyRoot,writeJSON,readJSON,hashFile,studyPath,writeExtractionCache} from '../lib/store.mjs';
import {extractSections} from '../lib/sections.mjs';
import {createNativeDecorationView} from '../lib/source-decoration.mjs';
import {extractionSourceIdentity} from '../lib/workflow.mjs';
import {verifiedParentRepresentation} from '../lib/sensitivity.mjs';
import {recordObservedRepresentationIssue,assertNoUnresolvedRepresentationIssues} from '../lib/representation-issues.mjs';
import {REPRESENTATION_REPLAY_PROTOCOL,prepareRepresentationReplay,emitRepresentationReplayPage,verifyRepresentationReplay,recordRepresentationReplayResolution,compareCompleteNativeEvidence} from '../lib/representation-replay.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const seal=body=>({...body,sha256:digest(body)});
async function fixture(t,{currentMutation=()=>{},assignmentMutation=()=>{},oldEnvelopeMutation=()=>{},collectorChange=false,proofMutation=()=>{},historicalBundleMutation=()=>{},historicalIndexMutation=()=>{},unrelatedHistoricalPage=false,compressedCaches=false}={}){
  const run=join(STUDY_BASE,`test-representation-replay-${randomUUID()}`);validateStudyRoot(run);await mkdir(run,{recursive:true});
  t.after(async()=>{validateStudyRoot(run);await rm(run,{recursive:true,force:true});});
  const put=(path,value)=>writeJSON(run,path,value),bytes=async(path,text)=>{const full=await studyPath(run,path,{missing:true});await mkdir(join(full,'..'),{recursive:true});await writeFile(full,text,{flag:'wx'});return {path,...await hashFile(full)};};
  const source=await extractionSourceIdentity({extraction:{minWords:1,maxUnitWords:20,contextWords:60,maxContentChars:4096,maxPerContract:40,maxUnits:100},embedding:null,seed:'DECLARED_SYNTHETIC_CURRENT'}),files=source.files;
  const {sha256:sourceSeal,...sourceBody}=source,oldSource=seal({...sourceBody,files:collectorChange?files.map(f=>f.path==='sections.mjs'?{...f,sha256:'c'.repeat(64)}:f):files,parameters:{...source.parameters,selection_seed:'DECLARED_SYNTHETIC_HISTORICAL'}});
  const raw='<p><u style="text-decoration: underline; unknown-fixture: retained">Alpha</u> Beta '+Array.from({length:35},(_,i)=>'fixtureword'+i).join(' ')+' 📦</p>',rawRef=await bytes('raw/synthetic.html',raw),contract={id:'synthetic-contract',cohort:'discovery-broad',format:'html',path:rawRef.path,acquisition:{sha256:rawRef.sha256,bytes:rawRef.bytes}};
  const extracted=extractSections({...contract,content:raw},{...source.parameters.extraction,nativeDecorationIdentity:{tracerSourceSHA256:files.find(f=>f.path==='source-decoration.mjs').sha256,collectorSourceSHA256:files.find(f=>f.path==='sections.mjs').sha256}}),envelope=extracted.native_source_decorations,normalized=extracted.normalized_text,normalizedRef=await bytes('normalized/synthetic.txt',normalized),parent={...extracted.sections[0],cohort:contract.cohort},units=extracted.units.map(u=>({...u,cohort:contract.cohort}));
  assert.equal(extracted.status,'accepted');assert.ok(units.length>=2);
  let oldEnvelope=clone(envelope);if(collectorChange)oldEnvelope.collector_source_sha256='c'.repeat(64);oldEnvelopeMutation(oldEnvelope);if(oldEnvelope.sha256!==digest(Object.fromEntries(Object.entries(oldEnvelope).filter(([k])=>k!=='sha256')))){const {sha256:ignored,...body}=oldEnvelope;oldEnvelope=seal(body);}
  const cacheBody={...extracted,raw_sha256:rawRef.sha256};
  const oldCache={...clone(cacheBody),source:oldSource,native_source_decorations:oldEnvelope},currentCache={...clone(cacheBody),source};if(collectorChange){function update(value){if(!value||typeof value!=='object')return;if(value.native_source_decorations_ref){value.native_source_decorations_ref.envelope_sha256=oldEnvelope.sha256;value.native_source_decorations_ref.collector_source_sha256=oldEnvelope.collector_source_sha256;}for(const child of Object.values(value))update(child);}update(oldCache);}currentMutation(currentCache);
  const cachePut=async(version,value)=>{if(!compressedCaches)return put(`fixture/${version}-cache.json`,value);const name=`extraction-cache/${version}.json.gz`,stored=await writeExtractionCache(run,name,value);await put(name+'.manifest.json',{...stored.artifact,storage:stored.storage,result_sha256:digest(value)});return {...stored.artifact,storage:stored.storage};};
  const oldCacheRef=await cachePut('old',oldCache),currentCacheRef=await cachePut('current',currentCache);
  const manifest=(s,c,ref)=>({source:s,cache:[{id:contract.id,...ref,result_sha256:digest(c)}],contract_records:[{id:contract.id,status:'accepted',raw_sha256:c.raw_sha256,normalized_sha256:c.normalized_sha256,normalized_path:normalizedRef.path,native_source_decorations:c.native_source_decorations}]});
  const oldManifest=await put('fixture/old-manifest.json',manifest(oldSource,oldCache,oldCacheRef)),currentManifest=await put('fixture/current-manifest.json',manifest(source,currentCache,currentCacheRef)),simple=await put('fixture/simple.json',{data_classification:'DECLARED_SYNTHETIC'}),audit_id='development-synthetic-prefix';
  const ranges=[];for(const unit of units){const context=verifiedParentRepresentation(unit,parent,normalized);for(const range of [unit,{start:context.provenance.context_start,end:context.provenance.context_end}])ranges.push({start:range.start,end:range.end,include_end_zero_width:true,purpose:'AUTHORITATIVE_PRODUCTION_MODEL_SOURCE_PART'});}
  const nativeProjection=createNativeDecorationView(oldEnvelope,{raw,normalizedText:normalized}).projectRelevant({start:0,end:normalized.length,includeEndZeroWidth:true}),projection={id:'synthetic-projection',start:0,end:normalized.length,include_end_zero_width:true,projection_sha256:digest(nativeProjection),projection:nativeProjection};
  const packetRow={audit_id,contract_id:contract.id,id:'synthetic-complete-parent',parent:{id:parent.id,start:parent.start,end:parent.end,sha256:parent.sha256},excerpt:{start:0,end:normalized.length,sha256:sha256(normalized),text:normalized},lineage:{cohort:contract.cohort,cache_path:oldCacheRef.path,cache_sha256:oldCacheRef.sha256}};
  const bundle={schema:'v13-native-current-model-sourceparts-machine-bundle-v1',actual_reading:false,audit_id,contract_id:contract.id,source_id:packetRow.id,extraction_source_sha256:oldSource.sha256,current_cache:oldCacheRef,raw:rawRef,entire_normalized:normalizedRef,parent:packetRow.parent,focal:{id:packetRow.id,...packetRow.excerpt},applicability:{selected_units:units.map(({id,start,end,sha256})=>({id,start,end,sha256}))},required_projection_ranges:ranges,projections:[projection]};historicalBundleMutation(bundle);
  const bundleRef=await put('fixture/original-bundle.json',bundle),compact=JSON.stringify({schema:'lossless-recursive-shared-object-dictionary-v1',dictionary:{},value:bundle}),lossless_display=await bytes('fixture/original-display.json',compact),pages=[],page_reads=[],reviewer='original-agent';
  const historicalPageText=unrelatedHistoricalPage?JSON.stringify({data_classification:'DECLARED_SYNTHETIC_UNRELATED_METADATA'}):compact;
  for(let start=0;start<historicalPageText.length;){let end=Math.min(historicalPageText.length,start+6000);if(end<historicalPageText.length&&/[\uD800-\uDBFF]/u.test(historicalPageText[end-1])&&/[\uDC00-\uDFFF]/u.test(historicalPageText[end]))end--;const pageText=historicalPageText.slice(start,end),index=pages.length,page={index,start,end,characters:pageText.length,...await bytes(`fixture/original-page-${index}.txt`,pageText)};pages.push(page);start=end;}
  for(const page of pages){const pageText=await readFile(await studyPath(run,page.path),'utf8'),header=JSON.stringify({audit_id,page:page.index,pages:pages.length,display_start:page.start,display_end:page.end,reviewer})+'\n',response=header+pageText,emission=await put(`fixture/original-emission-${page.index}.json`,{schema:'v13-source-page-emission-v1',status:'HELPER_EMITTED_PAGE_REQUIRES_ACTUAL_TOOL_OUTPUT_AND_REVIEWER_DECLARATION',audit_id,reviewer,page,actual_tool_result_observed_by_helper:false,actual_reading:false,response_text:response,response_sha256:sha256(response),response_characters:response.length});page_reads.push({page:page.index,tool_response_observed_and_read:true,tool_call_reference:'DECLARED_SYNTHETIC_ORIGINAL_OUTPUT_'+page.index,emission});}
  const required_projection_artifacts=[];for(const p of bundle.projections??[])required_projection_artifacts.push({id:p.id,...await put('fixture/original-projection-'+required_projection_artifacts.length+'.json',p),projection_sha256:p.projection_sha256});
  const indexValue={schema:'v13-prepared-page-index-v1',status:'MACHINE_PREPARED_NOT_TOOL_DISPLAYED',audit_id,actual_reading:false,bundle:bundleRef,bundle_canonical_sha256:digest(bundle),lossless_display,lossless_dictionary:{verified:true,entries:0,roundtrip_sha256:digest(bundle)},required_projection_artifacts,pages};historicalIndexMutation(indexValue);
  const pageIndex=await put('fixture/original-page-index.json',indexValue),packet=await put('fixture/packet.json',{source:{extraction_source:oldSource},rows:[packetRow]}),row={audit_id,reviewer_id:reviewer,actual_reading_declared:true,open_material_representation_concern:true,unresolved_material_loss:true,production_model_heading_association_adequate:false,computed_style_verified:false,effectiveness_verified:false,semantic_completeness_verified:false,model_execution_performed:false,new_whole_parent_body_read:false,reason:'Declared synthetic preceding category was promoted as an unrelated model source prefix.',uncertainty:'Declared synthetic evidence is partial and does not establish a governing heading or source quality.',prepared_page_index:pageIndex,page_reads};
  const actual_review=await put('fixture/original-review.json',{schema:'v13-actual-native-and-model-sourceparts-review-v1',status:'BLOCKED',authority:'NONE',human:false,reviewer:{id:reviewer,kind:'AGENT',actual_reading_declared:true},expected_audit_ids:[audit_id],rows:[row],extraction_source_sha256:oldSource.sha256,policy:simple,extraction_manifest:oldManifest,packet,preparation_freeze:simple,strict_checker:simple});
  const strict_result=await put('fixture/original-strict.json',{schema:'v13-native-component-checker-result-v1',status:'BLOCKED',expected_cases:1,rows:[{audit_id,pages:pages.length,status:'BLOCKED_UNRESOLVED_MATERIAL_LOSS'}],source_quality_gate_pass:false,exact_path_sha_bytes_bindings_verified:true,actual_reading_not_machine_inferred:true,strict_checker:simple});
  const issue=await recordObservedRepresentationIssue(run,{actual_review,strict_result,audit_id,finding:'Declared synthetic adverse prefix/role issue; no whole-parent adequacy claim.'});delete issue.resumed;
  const exactProtocolBytes=await readFile(new URL('./fixtures/representation-replay-protocol-v3.json',import.meta.url));assert.equal(exactProtocolBytes.length,6296);assert.equal(sha256(exactProtocolBytes),'b707a03d75d2278b8ee361b061cc4b0d2ecb03a84933ad4f792dab4bfba6fd84');
  const protocol_ref=await put('fixture/protocol.json',JSON.parse(exactProtocolBytes)),assignments={schema:'representation-replay-reviewer-assignments-v1',authority:'TASK_OWNER_ASSIGNMENT',human:false,aliases:[{alias:'original-agent',canonical:'original-agent'},{alias:'/root/original-agent',canonical:'original-agent'},{alias:'independent-agent',canonical:'independent-agent'}],assignments:[{audit_id,reviewer_id:'independent-agent',original_reader_ids:['original-agent']}]};assignmentMutation(assignments);
  const reviewer_assignments=await put('fixture/assignments.json',assignments);let navigation_delta,navigation_delta_proof;
  if(collectorChange){
    const parent_checker=await put('fixture/synthetic-parent-checker.json',{data_classification:'DECLARED_SYNTHETIC'}),child_checker=await put('fixture/synthetic-child-checker.json',{data_classification:'DECLARED_SYNTHETIC'}),configuration=await put('fixture/delta-configuration.json',{schema:'v14-mechanical-navigation-only-delta-predeclaration-v1',contracts:1,old_manifest:oldManifest,old_source:oldSource,current_source:source,old_native_identity:{tracerSourceSHA256:oldEnvelope.tracer_source_sha256,collectorSourceSHA256:oldEnvelope.collector_source_sha256},current_native_identity:{tracerSourceSHA256:envelope.tracer_source_sha256,collectorSourceSHA256:envelope.collector_source_sha256},parent_checker,child_checker});
    const pair={old:'d'.repeat(64),current:'d'.repeat(64)},ledgerRow={schema:'v14-navigation-body-native-contract-delta-v1',index:0,contract_id:contract.id,cache:oldCacheRef,pass:true,status:'EXACT_NONNAVIGATION_AND_NATIVE_EVIDENCE_EQUAL',actual_source_reading:false,normalized_equal:true,body_and_legacy_geometry_equal:true,complete_native_source_evidence_equal:true,complete_provisional_selection_equal:true,status_values_equal:true,native_binding:{tracer_unchanged:true,trace_unchanged:true},body_projection_sha256:pair,native_evidence_sha256:pair,selection_projection_sha256:pair};
    const summary={schema:'v14-mechanical-navigation-only-delta-summary-v1',status:'ALL994_NONNAVIGATION_AND_NATIVE_EVIDENCE_EXACT',actual_reading:false,failure:null,unmatched_differences:0,configuration,old_source_sha256:oldSource.sha256,current_source_sha256:source.sha256,expected_contracts:1,verified_contracts:1};proofMutation({summary,ledgerRow});const contract_ledger=await bytes('fixture/contracts.ndjson',JSON.stringify(ledgerRow)+'\n'),summaryRef=await put('fixture/delta-summary.json',{...summary,contract_ledger});
    const readback=await put('fixture/delta-readback.json',{schema:'v14-navigation-delta-readback-v1',summary:summaryRef,ledger:contract_ledger,rows:1,pass_rows:1,all994:true,summary_count_match:true,source_and_checker_bindings_reverified:true,no_actual_reading_or_issue_clearance:true}),independent_verification=await put('fixture/delta-independent.json',{schema:'v14-independent-final-mechanical-delta-verification-v1',status:'VERIFIED_FULL994_PASS',actual_reading:false,issue_clearance:false,quality_gate_pass:false,summary:summaryRef,readback,ledger:contract_ledger,configuration,checks:{full_pass_status:true,rows994:true}});
    navigation_delta_proof={summary:summaryRef,readback,independent_verification};navigation_delta={configuration,parent_checker,child_checker,final_proof:navigation_delta_proof};
  }
  const policy=await put(`representation-issues/replay-policies/${source.sha256}.json`,{schema:'partial-representation-replay-policy-v1',protocol:REPRESENTATION_REPLAY_PROTOCOL,extraction_source_sha256:source.sha256,authority:'TASK_OWNER_ASSIGNMENT',human:false,protocol_ref,reviewer_assignments,limits:{response_characters:7500,page_characters:6000,reason_min_characters:40},...(navigation_delta?{navigation_delta}:{})});
  return {run,source,oldSource,envelope,oldEnvelope,issue,policy,currentCache,currentCacheRef,currentManifest,put,input:{issue,extraction_manifest:currentManifest,policy,native_disposition:'NEW_CURRENT_NATIVE_ACTUAL_READING_REQUIRED',...(navigation_delta_proof?{navigation_delta_proof}:{})}};
}

async function actual(f,preparation,{reviewMutation=()=>{},emissionMutation=()=>{}}={}){
  const p=await readJSON(f.run,preparation.path),payload=await readJSON(f.run,p.payload.path),page_reads=[];
  for(let i=0;i<p.pages.length;i++){const shown=await emitRepresentationReplayPage(f.run,preparation,i,p.reviewer_id);let emission=shown.emission;const e=await readJSON(f.run,emission.path);emissionMutation(e,i);if(digest(e)!==digest(await readJSON(f.run,emission.path)))emission=await f.put(`fixture/mutated-emission-${i}.json`,e);page_reads.push({page:i,tool_response_observed_and_read:true,tool_call_reference:`DECLARED_SYNTHETIC_CURRENT_OUTPUT_${i}`,emission});}
  const review={schema:'partial-representation-independent-actual-review-v1',status:'AUTHORED_ACTUAL_PREFIX_ROLE_REPLAY_REVIEW',protocol:REPRESENTATION_REPLAY_PROTOCOL,preparation,authority:'NONE',human:false,reviewer_id:p.reviewer_id,actual_reading_declared:true,prefix_role_defect_absent:true,unresolved_prefix_role_concern:false,scope:'PREFIX_ROLE_INJECTION_ONLY',claims:payload.limits,reason:'Declared synthetic current inputs retain exactly their contiguous source spans without promoting a preceding caption.',uncertainty:'Declared synthetic partial review does not establish context sufficiency, native readiness, source quality or legal meaning.',input_judgments:payload.representations.map(rep=>({unit_id:rep.unit_id,arm:rep.arm,input_sha256:rep.input_sha256,source_text_sha256:sha256(rep.text),prefix_role_defect_absent:true,reason:`Declared synthetic ${rep.unit_id} ${rep.arm} contains only its bound contiguous source input.`,uncertainty:'Declared synthetic prefix-only review leaves context adequacy and all other quality questions open.'})),page_reads,current_input_and_native_fragments_actually_read:true,complete_current_required_native_and_raw_components_actually_read:true,complete_current_native_envelope_actually_read:false,complete_retained_raw_characters_actually_read:payload.expected_actual_raw_exposure.covers_complete_retained_raw_characters,raw_exposure:payload.expected_actual_raw_exposure,native_source_only_qualification:'NEW_CURRENT_REQUIRED_COMPONENTS_ACTUAL_REVIEW'};reviewMutation(review);return f.put(`fixture/current-review-${randomUUID()}.json`,review);
}

test('exact unchanged source + independent actual declarations resolves only the new epoch and keeps the original adverse issue',async t=>{
  const f=await fixture(t),preparation=await prepareRepresentationReplay(f.run,f.input),again=await prepareRepresentationReplay(f.run,f.input);assert.deepEqual(again,preparation);
  await assert.rejects(assertNoUnresolvedRepresentationIssues(f.run,f.source.sha256),/UNRESOLVED/);
  const actual_review=await actual(f,preparation),verified=await verifyRepresentationReplay(f.run,{preparation,actual_review});assert.equal(verified.status,'VERIFIED_EXACT_SOURCE_PREFIX_ROLE_ONLY');
  const resolution=await recordRepresentationReplayResolution(f.run,{preparation,actual_review}),resumed=await recordRepresentationReplayResolution(f.run,{preparation,actual_review});assert.deepEqual(resumed,resolution);
  const gate=await assertNoUnresolvedRepresentationIssues(f.run,f.source.sha256);assert.equal(gate.observed,1);assert.equal(gate.resolved,1);assert.deepEqual(gate.issues,[{issue:f.issue,resolution,replay:preparation}]);
  assert.equal((await readJSON(f.run,f.issue.path)).status,'UNRESOLVED');await assert.rejects(assertNoUnresolvedRepresentationIssues(f.run,f.oldSource.sha256),/UNRESOLVED/);await assert.rejects(assertNoUnresolvedRepresentationIssues(f.run,'b'.repeat(64)),/UNRESOLVED/);
});

test('new complete current native/raw reading is separate from exact historical source-only reuse',async t=>{
  const f=await fixture(t),preparation=await prepareRepresentationReplay(f.run,{...f.input,native_disposition:'NEW_CURRENT_NATIVE_ACTUAL_READING_REQUIRED'}),actual_review=await actual(f,preparation);assert.equal((await verifyRepresentationReplay(f.run,{preparation,actual_review})).status,'VERIFIED_EXACT_SOURCE_PREFIX_ROLE_ONLY');
});

test('exact prefix replay reconstructs full old/current gzip caches without changing source/native qualification rules',async t=>{
  const f=await fixture(t,{compressedCaches:true}),preparation=await prepareRepresentationReplay(f.run,f.input),actual_review=await actual(f,preparation);assert.equal((await verifyRepresentationReplay(f.run,{preparation,actual_review})).status,'VERIFIED_EXACT_SOURCE_PREFIX_ROLE_ONLY');
});

for(const [name,currentMutation]of [
  ['changed entire normalized text',c=>{c.normalized_text+=' ';c.normalized_sha256=sha256(c.normalized_text);}],
  ['changed raw binding',c=>{c.raw_sha256='b'.repeat(64);}],
  ['changed parent ID',c=>{c.sections[0].id='other-parent';}],
  ['changed parent bounds',c=>{c.sections[0].end--;}],
  ['changed unit ID',c=>{c.units[0].id='other-unit';}],
  ['changed unit bounds',c=>{c.units[0].start++;}],
  ['changed unit literal',c=>{c.units[0].text='Other';}],
  ['changed current extraction payload',c=>{c.warnings.push('DECLARED_SYNTHETIC_INVENTED');}],
  ['dropped affected selected unit',c=>{c.units.pop();}],
  ['reordered affected selected units',c=>{c.units.reverse();}],
  ['reserve cohort',c=>{c.contract.cohort='reserve';}]
])test(`preparation rejects ${name}`,async t=>{const f=await fixture(t,{currentMutation});await assert.rejects(prepareRepresentationReplay(f.run,f.input));});

for(const [name,assignmentMutation]of [
  ['same canonical original reader',a=>{a.assignments[0].reviewer_id='original-agent';}],
  ['same original under another alias',a=>{a.assignments[0].reviewer_id='/root/original-agent';}],
  ['unknown assigned alias',a=>{a.assignments[0].reviewer_id='unknown';}],
  ['missing original canonical reader',a=>{a.assignments[0].original_reader_ids=[];}],
  ['ambiguous alias',a=>{a.aliases.push({alias:'independent-agent',canonical:'original-agent'});}],
  ['duplicate assignment',a=>{a.assignments.push(clone(a.assignments[0]));}]
])test(`preparation rejects ${name}`,async t=>{const f=await fixture(t,{assignmentMutation});await assert.rejects(prepareRepresentationReplay(f.run,f.input));});

for(const [name,reviewMutation]of [
  ['machine mistaken for reading',r=>{r.actual_reading_declared=false;}],
  ['adverse prefix judgment',r=>{r.prefix_role_defect_absent=false;}],
  ['still unresolved',r=>{r.unresolved_prefix_role_concern=true;}],
  ['generic reason',r=>{r.reason='Pass';}],
  ['missing input judgment',r=>{r.input_judgments.pop();}],
  ['reordered input judgment',r=>{r.input_judgments.reverse();}],
  ['unrelated input judgment',r=>{r.input_judgments[0].input_sha256='c'.repeat(64);}],
  ['missing page',r=>{r.page_reads.pop();}],
  ['reordered page',r=>{r.page_reads.reverse();r.page_reads[0].page=-1;}],
  ['page not actually observed',r=>{r.page_reads[0].tool_response_observed_and_read=false;}],
  ['missing actual tool reference',r=>{r.page_reads[0].tool_call_reference='';}],
  ['wrong reviewer',r=>{r.reviewer_id='original-agent';}],
  ['invented parent adequacy',r=>{r.claims.whole_parent_adequacy_established=true;}],
  ['invented fresh pass',r=>{r.claims.fresh_audit_pass=true;}],
  ['invented model inference',r=>{r.claims.model_inference_performed=true;}],
  ['reuse labeled new native reading',r=>{r.native_evidence_actually_read=true;}]
  ,['incorrect complete raw exposure',r=>{r.complete_retained_raw_characters_actually_read=!r.complete_retained_raw_characters_actually_read;}]
  ,['invented whole native envelope reading',r=>{r.complete_current_native_envelope_actually_read=true;}]
  ,['required current native reading omitted',r=>{r.complete_current_required_native_and_raw_components_actually_read=false;}]
  ,['incomplete raw exposure union',r=>{r.raw_exposure.intervals=[];}]
  ,['current input reading omitted',r=>{r.current_input_and_native_fragments_actually_read=false;}]
])test(`verification rejects ${name}`,async t=>{const f=await fixture(t),preparation=await prepareRepresentationReplay(f.run,f.input),actual_review=await actual(f,preparation,{reviewMutation});await assert.rejects(verifyRepresentationReplay(f.run,{preparation,actual_review}));});

for(const [name,emissionMutation]of [
  ['wrong emitted reviewer',e=>{e.reviewer_id='original-agent';}],
  ['different header or source string',e=>{e.response_text='invented';}],
  ['wrong emission SHA',e=>{e.response_sha256='a'.repeat(64);}],
  ['helper asserts actual reading',e=>{e.actual_reading=true;}],
  ['different emitted page',e=>{e.page.index++;}]
])test(`verification rejects ${name}`,async t=>{const f=await fixture(t),preparation=await prepareRepresentationReplay(f.run,f.input),actual_review=await actual(f,preparation,{emissionMutation});await assert.rejects(verifyRepresentationReplay(f.run,{preparation,actual_review}));});

test('every native content field and policy participates in complete comparison',async t=>{
  const f=await fixture(t),copy=clone(f.envelope);assert.equal(compareCompleteNativeEvidence(copy,f.envelope).equal,true);
  for(const mutate of [e=>{e.trace.sources[0].tag='other';},e=>{e.trace.sources[0].style_attribute.decoded_value+='x';},e=>{e.segments.reverse();},e=>{e.policy+='other';},e=>{e.trace.runs[0].decoded_text+='x';},e=>{e.trace.raw.sha256='a'.repeat(64);},e=>{e.trace.sources[0].element_scope.end++;},e=>{e.trace.sources[0].extra_unmarked_origin={id:'unmarked'};}]){const changed=clone(f.envelope);mutate(changed);const {sha256:ignored,...body}=changed;assert.throws(()=>compareCompleteNativeEvidence(f.envelope,seal(body),{allowCollectorIdentityChange:true}));}
  const {sha256:ignored,...body}=copy;body.collector_source_sha256='c'.repeat(64);const differentIdentity=seal(body);assert.throws(()=>compareCompleteNativeEvidence(f.envelope,differentIdentity));assert.deepEqual(compareCompleteNativeEvidence(f.envelope,differentIdentity,{allowCollectorIdentityChange:true}).excluded_json_pointers,['/sha256','/collector_source_sha256']);
});

test('gate replays dependencies rather than trusting a stored favorable result',async t=>{
  const f=await fixture(t),preparation=await prepareRepresentationReplay(f.run,f.input),actual_review=await actual(f,preparation);await recordRepresentationReplayResolution(f.run,{preparation,actual_review});
  const old=await readJSON(f.run,f.policy.path);await writeFile(await studyPath(f.run,f.policy.path),JSON.stringify({...old,authority:'UNKNOWN'}));await assert.rejects(assertNoUnresolvedRepresentationIssues(f.run,f.source.sha256));
});

test('changed requested source and protocol bindings reject old prepared replay',async t=>{
  const f=await fixture(t),preparation=await prepareRepresentationReplay(f.run,f.input),actual_review=await actual(f,preparation);await assert.rejects(verifyRepresentationReplay(f.run,{preparation,actual_review},{extraction_source_sha256:'b'.repeat(64)}));await assert.rejects(verifyRepresentationReplay(f.run,{preparation,actual_review},{protocol_ref:{path:'other',sha256:'b'.repeat(64),bytes:1}}));
});

for(const mode of ['PRIOR_SOURCE_ONLY_REUSED_EXACT','UNKNOWN_MODE'])test(`restrictive V3 rejects ${mode}`,async t=>{const f=await fixture(t);await assert.rejects(prepareRepresentationReplay(f.run,{...f.input,native_disposition:mode}),/rejects historical native reuse/);});

test('an unrelated properly emitted historical metadata page cannot stand in for the frozen full display',async t=>{await assert.rejects(fixture(t,{unrelatedHistoricalPage:true}),/Historical actual/);});
test('historical native qualification labels without actual displayed projection payload are rejected',async t=>{await assert.rejects(fixture(t,{historicalBundleMutation:b=>{delete b.projections;}}),/Historical full projection/);});

for(const [name,historicalBundleMutation]of [
  ['a smaller bundle focal',b=>{b.focal.start++;b.focal.text=b.focal.text.slice(1);b.focal.sha256=sha256(b.focal.text);}],
  ['a different bundle source ID',b=>{b.source_id='different-source';}],
  ['a smaller selected bundle scope',b=>{b.applicability.selected_units.pop();}]
])test(`authenticated packet rejects ${name}`,async t=>{const f=await fixture(t,{historicalBundleMutation});await assert.rejects(prepareRepresentationReplay(f.run,f.input));});

test('a current actual review cannot be recycled under a historical mode at verification or gate use',async t=>{
  const f=await fixture(t),preparation=await prepareRepresentationReplay(f.run,f.input),actual_review=await actual(f,preparation),p=await readJSON(f.run,preparation.path);p.native_disposition='PRIOR_SOURCE_ONLY_REUSED_EXACT';const altered=await f.put('fixture/unsupported-preparation.json',p);await assert.rejects(verifyRepresentationReplay(f.run,{preparation:altered,actual_review}),/rejects historical native reuse/);
});

test('appending another immutable observed issue invalidates the old registry replay',async t=>{
  const f=await fixture(t),preparation=await prepareRepresentationReplay(f.run,f.input),actual_review=await actual(f,preparation);await recordRepresentationReplayResolution(f.run,{preparation,actual_review});const issue=await readJSON(f.run,f.issue.path);await recordObservedRepresentationIssue(f.run,{...issue.evidence,finding:'Declared synthetic second adverse issue must remain independently held.'});await assert.rejects(assertNoUnresolvedRepresentationIssues(f.run,f.source.sha256));
});
