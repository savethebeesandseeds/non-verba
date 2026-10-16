// SPDX-License-Identifier: AGPL-3.0-only
// DECLARED_SYNTHETIC: these declarations test guards, never establish real reading.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {digest,sha256} from '../../lib/common.mjs';
import {STUDY_BASE,validateStudyRoot,writeJSON,readJSON} from '../lib/store.mjs';
import {recordObservedRepresentationIssue,assertNoUnresolvedRepresentationIssues,verifyHistoricalRepresentationDisplay} from '../lib/representation-issues.mjs';
import {assertNoUnresolvedSourceIssues} from '../lib/source-issues.mjs';

async function fixture(t,mutate=()=>{}){
  const root=join(STUDY_BASE,`test-representation-issues-${randomUUID()}`);validateStudyRoot(root);await mkdir(root,{recursive:true});
  t.after(async()=>{validateStudyRoot(root);await rm(root,{recursive:true,force:true});});
  const sourceBody={data_classification:'DECLARED_SYNTHETIC'},source={...sourceBody,sha256:digest(sourceBody)};
  const audit_id='development-0041',simple=await writeJSON(root,'fixture/simple.json',{data_classification:'DECLARED_SYNTHETIC'});
  const extraction_manifest=await writeJSON(root,'fixture/extraction.json',{source}),packet=await writeJSON(root,'fixture/packet.json',{source:{extraction_source:source},rows:[{audit_id,contract_id:'synthetic-contract'}]});
  const projection={id:'projection-synthetic',projection:{data_classification:'DECLARED_SYNTHETIC'},projection_sha256:digest({data_classification:'DECLARED_SYNTHETIC'})},projectionRef=await writeJSON(root,'fixture/projection.json',projection);
  const bundleValue={schema:'v13-native-current-model-sourceparts-machine-bundle-v1',audit_id,contract_id:'synthetic-contract',extraction_source_sha256:source.sha256,actual_reading:false,projections:[projection]},bundle=await writeJSON(root,'fixture/bundle.json',bundleValue),lossless_display=await writeJSON(root,'fixture/display.json',{schema:'lossless-recursive-shared-object-dictionary-v1',dictionary:{},value:bundleValue});
  const pageText=await readFile(join(root,lossless_display.path),'utf8'),page={index:0,start:0,end:pageText.length,characters:pageText.length,...lossless_display};
  const header=JSON.stringify({audit_id,page:0,pages:1,display_start:0,display_end:page.end,reviewer:'synthetic-agent'})+'\n',response=header+pageText;
  const emission=await writeJSON(root,'fixture/emission.json',{schema:'v13-source-page-emission-v1',status:'HELPER_EMITTED_PAGE_REQUIRES_ACTUAL_TOOL_OUTPUT_AND_REVIEWER_DECLARATION',audit_id,reviewer:'synthetic-agent',page,actual_tool_result_observed_by_helper:false,actual_reading:false,response_text:response,response_sha256:sha256(response),response_characters:response.length});
  const prepared_page_index=await writeJSON(root,'fixture/index.json',{schema:'v13-prepared-page-index-v1',status:'MACHINE_PREPARED_NOT_TOOL_DISPLAYED',audit_id,actual_reading:false,bundle,bundle_canonical_sha256:digest(bundleValue),lossless_display,lossless_dictionary:{verified:true,entries:0,roundtrip_sha256:digest(bundleValue)},required_projection_artifacts:[{id:projection.id,...projectionRef,projection_sha256:projection.projection_sha256}],pages:[page]}),strict_checker=simple;
  const row={audit_id,reviewer_id:'synthetic-agent',actual_reading_declared:true,open_material_representation_concern:true,unresolved_material_loss:true,production_model_heading_association_adequate:false,computed_style_verified:false,effectiveness_verified:false,semantic_completeness_verified:false,model_execution_performed:false,new_whole_parent_body_read:false,reason:'Declared synthetic unrelated earlier numbered prose was promoted to a model heading.',uncertainty:'Declared synthetic partial component evidence does not claim any full-parent or legal adequacy.',prepared_page_index,page_reads:[{page:0,tool_response_observed_and_read:true,tool_call_reference:'DECLARED_SYNTHETIC_OUTPUT',emission}]};
  const review={schema:'v13-actual-native-and-model-sourceparts-review-v1',status:'ACTUAL_CURRENT_COMPONENT_REVIEW',authority:'NONE',human:false,reviewer:{id:'synthetic-agent',kind:'AGENT',actual_reading_declared:true},expected_audit_ids:[audit_id],rows:[row],extraction_source_sha256:source.sha256,policy:simple,extraction_manifest,packet,preparation_freeze:simple,strict_checker};
  const strict={schema:'v13-native-component-checker-result-v1',status:'BLOCKED',expected_cases:1,rows:[{audit_id,pages:1,status:'BLOCKED_UNRESOLVED_MATERIAL_LOSS'}],source_quality_gate_pass:false,exact_path_sha_bytes_bindings_verified:true,actual_reading_not_machine_inferred:true,strict_checker};
  mutate({review,row,strict});
  const actual_review=await writeJSON(root,'fixture/review.json',review),strict_result=await writeJSON(root,'fixture/strict.json',strict);
  return {root,source,review,actual_review,strict_result,options:{actual_review,strict_result,audit_id,finding:'Declared synthetic partial model representation concern, without full-parent assertions.'}};
}

test('partial representation findings survive a new epoch and enter the existing global source gate',async t=>{
  const f=await fixture(t),empty=await assertNoUnresolvedRepresentationIssues(f.root,f.source.sha256);assert.equal(empty.observed,0);assert.equal(empty.resolved,0);assert.deepEqual(empty.issues,[]);
  const first=await recordObservedRepresentationIssue(f.root,f.options),again=await recordObservedRepresentationIssue(f.root,f.options);
  assert.equal(first.sha256,again.sha256);assert.equal(again.resumed,true);
  const issue=await readJSON(f.root,first.path);assert.equal(issue.reading_scope,'DECLARED_ACTUAL_COMPONENT_OUTPUTS_ONLY');assert.equal(issue.whole_parent_adequacy_claimed,false);
  await assert.rejects(assertNoUnresolvedSourceIssues(f.root,f.source.sha256),/UNRESOLVED_OBSERVED_REPRESENTATION_ISSUE: 1/);
  await assert.rejects(assertNoUnresolvedSourceIssues(f.root,'b'.repeat(64)),/UNRESOLVED_OBSERVED_REPRESENTATION_ISSUE: 1/);
});

for(const [name,mutate]of [
  ['no actual declaration',({row})=>{row.actual_reading_declared=false;}],
  ['neutralized concern',({row})=>{row.open_material_representation_concern=false;}],
  ['neutralized unresolved flag',({row})=>{row.unresolved_material_loss=false;}],
  ['unestablished heading association',({row})=>{row.production_model_heading_association_adequate=true;}],
  ['invented full parent reading',({row})=>{row.new_whole_parent_body_read=true;}],
  ['incomplete component pages',({row})=>{row.page_reads=[];}],
  ['emission mistaken for reading',({row})=>{row.page_reads[0].tool_response_observed_and_read=false;}],
  ['unbound checker success',({strict})=>{strict.status='PASS';}],
  ['cross-case result',({strict})=>{strict.rows[0].audit_id='development-0042';}],
  ['unknown review schema',({review})=>{review.schema='untrusted-review';}]
])test(`registration rejects ${name}`,async t=>{const f=await fixture(t,mutate);await assert.rejects(recordObservedRepresentationIssue(f.root,f.options));});

test('post-registration byte changes cannot leave a passing guard',async t=>{
  const f=await fixture(t);await recordObservedRepresentationIssue(f.root,f.options);
  await writeFile(join(f.root,f.actual_review.path),JSON.stringify({...f.review,rows:[]}));
  await assert.rejects(assertNoUnresolvedSourceIssues(f.root,f.source.sha256),/artifact binding differs/);
});

test('an edited issue cannot claim resolution or a broader reading scope',async t=>{
  const f=await fixture(t),ref=await recordObservedRepresentationIssue(f.root,f.options),value=await readJSON(f.root,ref.path);
  await writeFile(join(f.root,ref.path),JSON.stringify({...value,status:'RESOLVED'}));
  await assert.rejects(assertNoUnresolvedSourceIssues(f.root,f.source.sha256),/issue identity differs/);
});

for(const [name,mutate]of [
  ['display',index=>{index.lossless_display={path:'fixture/absent-oversize-display.json',sha256:'a'.repeat(64),bytes:128*1024**2+1};}],
  ['page',index=>{index.pages[0]={...index.pages[0],path:'fixture/absent-oversize-page.txt',sha256:'a'.repeat(64),bytes:128*1024+1};}]
])test(`historical ${name} cap rejects before hashing or reading its absent path`,async t=>{
  const f=await fixture(t),index=await readJSON(f.root,f.review.rows[0].prepared_page_index.path);mutate(index);const ref=await writeJSON(f.root,`fixture/oversize-${name}-index.json`,index);
  // The paths deliberately do not exist. Reaching path lookup/hash/read would
  // produce ENOENT instead of this resource-bound error.
  await assert.rejects(verifyHistoricalRepresentationDisplay(f.root,ref),error=>error.code!=='ENOENT'&&/Exact bounded representation issue/.test(error.message));
});
