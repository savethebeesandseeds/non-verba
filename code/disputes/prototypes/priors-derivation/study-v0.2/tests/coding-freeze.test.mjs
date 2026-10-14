// SPDX-License-Identifier: AGPL-3.0-only
// DECLARED_SYNTHETIC: generated 500-case fixtures exercise guards, never reviews.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest,sha256} from '../../lib/common.mjs';
import {STUDY_BASE,validateStudyRoot,writeJSON,writeRows,hashFile} from '../lib/store.mjs';
import {auditPurpose} from '../lib/audit.mjs';
import {verifyOpenCodingStudy,verifyCandidateFreeze,assertReserveAccess,acquireEvaluation,extractEvaluation} from '../lib/evaluation.mjs';
import {syntheticFrozenFixture,registerSyntheticSourceIssue} from './helpers/quality-fixture.mjs';

const classification='DECLARED_SYNTHETIC';
const flags={kind:'AGENT',human:false,authority:'NONE',supplied_priors:false,machine_labels_exposed:false,other_coding_exposed:false};
async function fixture(t,{changePacket,changeReview,changeReconciliation,prior=false,changePrior,changePriorPacket,priorDifferentOccurrence=false}={}){
  const run=join(STUDY_BASE,`test-coding-freeze-${randomUUID()}`);validateStudyRoot(run);await mkdir(run,{recursive:true});
  t.after(async()=>{validateStudyRoot(run);await rm(run,{recursive:true,force:true});});
  const recipe={seed:'declared-synthetic-coding',maxPerFiler:2,cohorts:[{id:'discovery-broad',target:2,labels:['services'],minYear:2000,maxYear:2021}],limits:{contractBytes:4*1024**2,rawBytes:8*1024**3,totalBytes:24*1024**3,requestIntervalMs:1000}};
  const seed=`${recipe.seed}:audit-v1`,ids=[];for(let n=0;ids.length<2;n++){const id=`synthetic-coding-${n}`;if(auditPurpose(id,{seed})==='coding')ids.push(id);}
  await writeJSON(run,'recipe.json',recipe);await writeJSON(run,'census.json',{classification});await writeJSON(run,'feasibility.json',{classification});
  const selection=await writeRows(run,'selection.parquet',ids.map(id=>({id,cohort:'discovery-broad',sealed:false,calibration:true})),{schema:{id:'VARCHAR',cohort:'VARCHAR',sealed:'BOOLEAN',calibration:'BOOLEAN'}});
  const binding=async path=>({path,...await hashFile(join(run,path))});
  const recipeFile=await hashFile(join(run,'recipe.json'));
  await writeJSON(run,'study.json',{classification,status:'READY',recipe_digest:digest(recipe),recipe_file:recipeFile,sources:[],census_file:await hashFile(join(run,'census.json')),feasibility_file:await hashFile(join(run,'feasibility.json')),selection});
  const methodBody={classification,parameters:{synthetic_version:1},files:[]},method={...methodBody,sha256:digest(methodBody)};
  const records=[],cache=[],packetRows=[],lengths=new Map();
  await mkdir(join(run,'raw'));await mkdir(join(run,'normalized'));
  for(const [index,id]of ids.entries()){
    const rejected=index===1,parts=rejected?['Synthetic image-only retained metadata.']:Array.from({length:499},(_,i)=>`Synthetic section ${i+1}: a party 🧭 performs only if its declared condition holds.`);
    if(!rejected&&priorDifferentOccurrence)parts[1]=parts[0];const normalized=parts.join('\n\n');
    const raw=rejected?`<p>${normalized}</p><img src="unavailable-synthetic-image.gif">`:`<main>${normalized}</main>`,rawPath=`raw/${id}.txt`;
    await writeFile(join(run,rawPath),raw);lengths.set(id,raw.length);
    let offset=0;const parents=parts.map((text,i)=>{const row={id:`${id}:parent:${i}`,contract_id:id,start:offset,end:offset+text.length,text,sha256:sha256(text)};offset=row.end+2;return row;});
    const result={classification,source:method,status:rejected?'rejected':'accepted',contract:{id,cohort:'discovery-broad',sealed:false,path:rawPath},raw_sha256:sha256(raw),normalized_text:normalized,normalized_sha256:sha256(normalized),sections:rejected?[]:parents};
    const cached=await writeJSON(run,`extraction-cache/${id}.json`,result);cache.push({id,...cached,source_sha256:method.sha256,result_sha256:digest(result)});
    const normalizedPath=rejected?null:`normalized/${id}.txt`;if(normalizedPath)await writeFile(join(run,normalizedPath),normalized);
    records.push({id,cohort:'discovery-broad',status:result.status,raw_sha256:result.raw_sha256,...(normalizedPath?{normalized_path:normalizedPath,normalized_sha256:result.normalized_sha256}:{})});
    for(const [i,parent]of parents.entries()){const {text,...reference}=parent;packetRows.push({audit_id:`coding-${String(packetRows.length+1).padStart(4,'0')}`,contract_id:id,parent:{...reference,cache_pointer:rejected?'/normalized_text':`/sections/${i}`},lineage:{cache_path:cached.path,cache_sha256:cached.sha256,raw_path:rawPath,raw_sha256:result.raw_sha256,normalized_path:normalizedPath,normalized_sha256:result.normalized_sha256}});}
  }
  const extraction=await writeJSON(run,'processing/calibration.json',{classification,scope:'calibration-1000',source:method,contract_records:records,cache});
  const sourceBody={seed,extraction_source:method,input_manifest:extraction,input_recipe:recipeFile},packet={classification,purpose:'coding',target:500,count:500,shortage:0,source:{...sourceBody,sha256:digest(sourceBody)},rows:packetRows};
  if(changePacket)changePacket(packet);
  const packetBinding=await writeJSON(run,'audits/coding.json',packet),reviewers=[];
  const makeRow=(row,index)=>({audit_id:row.audit_id,contract_id:row.contract_id,source_sha256:row.parent.sha256,raw_sha256:row.lineage.raw_sha256,status:'FINAL_READING',outcome:index===499?'UNCLEAR':'QUALIFIED',unread:false,partial:false,provisional:false,unresolved_material_loss:false,reading:index===499?'ORIGINAL_MARKUP_ONLY':'FULL_PARENT_AND_RELEVANT_SOURCE',source_scope:index===499?'UNAVAILABLE_OPERATIVE_BODY_RETAINED_MARKUP_ONLY':'RETAINED_PARENT_AND_RELEVANT_RAW_CONTEXT',operative_body_available:index!==499,...(index===499?{image_pixels_read:false,ocr_performed:false}:{}),read_extent:{complete_parent:true,parent_offset_basis:'UTF16_RELATIVE_TO_PARENT',raw_offset_basis:'UTF16_IN_DECODED_RAW_TEXT',parent_ranges:[[0,row.parent.end-row.parent.start]],raw_ranges:[[0,lengths.get(row.contract_id)]]},consideration:index===499?'Declared synthetic unclear outcome: the image body is unavailable; only retained metadata and complete markup were inspected.':'Declared synthetic authored consideration used only to exercise complete-source coding guards.',reading_provenance:{mode:'ACTUAL_CURRENT_SOURCE_READING'}});
  for(const id of ['synthetic-coder-a','synthetic-coder-b']){
    const actual={classification,...flags,reviewer_id:id,status:'OPEN_CODING_COMPLETE',reviewed:500,unread:0,packet:structuredClone(packetBinding),extraction_source_sha256:method.sha256,technical_hold_awareness:true,judgments:packetRows.map(makeRow)};
    if(prior&&id.endsWith('-a')){
      const priorSource=packetRows[priorDifferentOccurrence?1:0],priorPacket={...structuredClone(packet),rows:[structuredClone(priorSource)],target:1,count:1};if(changePriorPacket)changePriorPacket(priorPacket);
      const priorPacketBinding=await writeJSON(run,'audits/prior-coding.json',priorPacket);
      const previous={classification,...flags,reviewer_id:id,status:'OPEN_CODING_PARTIAL',reviewed:1,unread:499,packet:priorPacketBinding,judgments:[makeRow(priorSource,0)]};if(changePrior)changePrior(previous);
      const previousBinding=await writeJSON(run,'readings/prior-a.json',previous);
      actual.judgments[0].reading_provenance={mode:'VERIFIED_PRIOR_ACTUAL_EQUIVALENCE',prior_reading:{artifact:previousBinding,audit_id:priorSource.audit_id}};
    }
    if(changeReview)changeReview(actual,id);
    const artifact=await writeJSON(run,`readings/${id}.json`,actual);reviewers.push({...artifact,id,...flags,reviewed:500,unread:0});
  }
  const reviewerInputs=reviewers.map(({id,path,sha256,bytes})=>({id,path,sha256,bytes}));
  const reconciliation={classification,status:'OPEN_CODING_RECONCILIATION_COMPLETE',kind:'AGENT',human:false,authority:'NONE',reconciler_id:'synthetic-reconciler',independent_codings_completed_before_reconciliation:true,reviewer_inputs:reviewerInputs,packet:structuredClone(packetBinding),extraction_source_sha256:method.sha256,rows:packetRows.map(row=>({audit_id:row.audit_id,source_sha256:row.parent.sha256,status:'FINAL_RECONCILIATION',unresolved_material_loss:false,reason:'Declared synthetic reconciliation retains the complete source case, including any unclear outcome.'}))};if(changeReconciliation)changeReconciliation(reconciliation);
  const reconciliationBinding=await writeJSON(run,'readings/reconciliation.json',reconciliation);
  const coding={classification,status:'TWO_OPEN_CODINGS_RECONCILED',human:false,authority:'NONE',extraction_source_sha256:method.sha256,packet:packetBinding,reviewers,reconciliation:reconciliationBinding};
  return {run,coding,method,packetRows,verify:()=>verifyOpenCodingStudy(run,coding,{extractionSourceSHA:method.sha256})};
}

test('exact same-method calibration coding and truthful fully read unavailable-body UNCLEAR cases pass',async t=>{const f=await fixture(t);assert.equal((await f.verify()).reconciled,500);});
test('strictly bound prior actual full reading can be reused without claiming a new reading',async t=>{const f=await fixture(t,{prior:true});assert.equal((await f.verify()).reviewed_per_reviewer,500);});

for(const [name,change]of [
  ['a missing parent hash',row=>{delete row.source_sha256;}],
  ['a false parent hash',row=>{row.source_sha256='0'.repeat(64);}],
  ['a false raw hash',row=>{row.raw_sha256='0'.repeat(64);}],
  ['a partial parent range',row=>{row.read_extent.parent_ranges=[[0,5]];}],
  ['a gap between parent ranges',row=>{const length=row.read_extent.parent_ranges[0][1];row.read_extent.parent_ranges=[[0,5],[6,length]];}],
  ['an out-of-bounds raw range',row=>{row.read_extent.raw_ranges=[[0,99999999]];}],
  ['missing raw reading ranges',row=>{row.read_extent.raw_ranges=[];}],
  ['byte ranges masquerading as character ranges',row=>{row.read_extent.raw_offset_basis='BYTES';}],
  ['a provisional outcome',row=>{row.provisional=true;}],
  ['a partial reading',row=>{row.partial=true;}],
  ['an unread case',row=>{row.unread=true;}],
  ['a material source hold',row=>{row.unresolved_material_loss=true;}],
  ['an unsupported reading mode',row=>{row.reading='EXCERPT_ONLY';}],
  ['a missing authored consideration',row=>{row.consideration=null;}],
  ['unknown reading provenance',row=>{row.reading_provenance={mode:'HASH_MATCH_ONLY'};}],
])test(`a complete-looking review cannot hide ${name}`,async t=>{const f=await fixture(t,{changeReview:actual=>change(actual.judgments[0])});await assert.rejects(f.verify());});

for(const [name,change]of [
  ['incomplete retained raw markup',row=>{row.read_extent.raw_ranges=[[0,10]];}],
  ['an asserted image-pixel reading',row=>{row.image_pixels_read=true;}],
  ['an asserted OCR result',row=>{row.ocr_performed=true;}],
  ['a qualified operative-body outcome',row=>{row.outcome='QUALIFIED';}],
  ['a nonexistent operative body presented as available',row=>{row.operative_body_available=true;}],
])test(`markup-only unclear readings reject ${name}`,async t=>{const f=await fixture(t,{changeReview:actual=>change(actual.judgments[499])});await assert.rejects(f.verify());});

for(const [name,change]of [
  ['500 rows with one duplicate source case',actual=>{actual.judgments[499]=actual.judgments[0];}],
  ['only 499 authored source cases',actual=>{actual.judgments.pop();}],
  ['an unconfirmed machine-label exposure declaration',actual=>{delete actual.machine_labels_exposed;}],
  ['a primed reviewer',actual=>{actual.other_coding_exposed=true;}],
  ['a human-evidence claim',actual=>{actual.human=true;}],
  ['a different packet hash',actual=>{actual.packet.sha256='0'.repeat(64);}],
  ['a different extraction method',actual=>{actual.extraction_source_sha256='0'.repeat(64);}],
])test(`completion counters do not override ${name}`,async t=>{const f=await fixture(t,{changeReview:actual=>change(actual)});await assert.rejects(f.verify());});

test('a changed underlying raw file invalidates otherwise complete source readings',async t=>{const f=await fixture(t);await writeFile(join(f.run,f.packetRows[0].lineage.raw_path),'Changed declared synthetic source.');await assert.rejects(f.verify());});
test('a packet from another source method cannot be relabeled as passed discovery',async t=>{const f=await fixture(t,{changePacket:packet=>{const {sha256:unused,...body}=packet.source;body.extraction_source={...body.extraction_source,sha256:'0'.repeat(64)};packet.source={...body,sha256:digest(body)};}});await assert.rejects(f.verify());});
test('another input extraction cannot replace the packet-bound source manifest',async t=>{const f=await fixture(t,{changePacket:packet=>{const {sha256:unused,...body}=packet.source;body.input_manifest.sha256='0'.repeat(64);packet.source={...body,sha256:digest(body)};}});await assert.rejects(f.verify());});
test('a valid text substring cannot masquerade as an actual extracted parent',async t=>{const f=await fixture(t,{changePacket:packet=>{packet.rows[0].parent.id='invented-source-parent';}});await assert.rejects(f.verify());});
test('a coding row cannot substitute another cache receipt',async t=>{const f=await fixture(t,{changePacket:packet=>{packet.rows[0].lineage.cache_sha256='0'.repeat(64);}});await assert.rejects(f.verify());});

for(const [name,change]of [
  ['another parent hash',previous=>{previous.judgments[0].source_sha256='0'.repeat(64);}],
  ['a partial original reading',previous=>{previous.judgments[0].read_extent.parent_ranges=[[0,5]];}],
  ['an earlier equivalence claim rather than an actual-reading root',previous=>{previous.judgments[0].reading_provenance.mode='VERIFIED_PRIOR_ACTUAL_EQUIVALENCE';}],
  ['another coder identity',previous=>{previous.reviewer_id='different-coder';}],
])test(`prior-source equivalence cannot reuse ${name}`,async t=>{const f=await fixture(t,{prior:true,changePrior:change});await assert.rejects(f.verify());});
test('equivalence rejects an original packet binding a different raw source',async t=>{const f=await fixture(t,{prior:true,changePriorPacket:packet=>{packet.rows[0].lineage.raw_sha256='0'.repeat(64);}});await assert.rejects(f.verify());});
test('equivalence cannot widen original raw ranges without a separate new reading',async t=>{const f=await fixture(t,{prior:true,changePrior:previous=>{previous.judgments[0].read_extent.raw_ranges=[[0,20]];}});await assert.rejects(f.verify(),/exact original parent identity/);});
test('equivalence cannot change the original reading mode',async t=>{const f=await fixture(t,{prior:true,changeReview:(actual,id)=>{if(id.endsWith('-a'))actual.judgments[0].reading='FULL_PARENT_AND_SOURCE';}});await assert.rejects(f.verify(),/exact original parent identity/);});
test('equivalence cannot change original available-body scope into markup-only scope',async t=>{const f=await fixture(t,{prior:true,changeReview:(actual,id)=>{if(id.endsWith('-a'))Object.assign(actual.judgments[0],{reading:'ORIGINAL_MARKUP_ONLY',source_scope:'UNAVAILABLE_OPERATIVE_BODY_RETAINED_MARKUP_ONLY',outcome:'UNCLEAR',operative_body_available:false,image_pixels_read:false,ocr_performed:false});}});await assert.rejects(f.verify(),/exact original parent identity/);});
test('an identical text hash at different source coordinates is not the originally read parent',async t=>{
  const f=await fixture(t,{prior:true,priorDifferentOccurrence:true});await assert.rejects(f.verify(),/exact original parent identity/);
});

for(const [name,change]of [
  ['an omitted source case',value=>{value.rows.pop();}],
  ['duplicate source cases',value=>{value.rows[499]=value.rows[0];}],
  ['an unbound parent hash',value=>{value.rows[0].source_sha256='0'.repeat(64);}],
  ['a missing authored explanation',value=>{value.rows[0].reason='';}],
  ['a different completed reviewer artifact',value=>{value.reviewer_inputs[0].sha256='0'.repeat(64);}],
  ['no separate completion attestation',value=>{value.independent_codings_completed_before_reconciliation=false;}],
])test(`reconciliation cannot seal with ${name}`,async t=>{const f=await fixture(t,{changeReconciliation:change});await assert.rejects(f.verify());});

test('a material source issue observed after a valid freeze blocks every reserve authorization',async t=>{
  const f=await syntheticFrozenFixture(t);assert.equal((await verifyCandidateFreeze(f.run)).freeze.freeze_sha256,f.freeze.freeze_sha256);
  const freezePath=join(f.run,'evaluation/candidate-freeze.json'),before=await hashFile(freezePath);
  await registerSyntheticSourceIssue(f.quality);
  await assert.rejects(verifyCandidateFreeze(f.run),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
  await assert.rejects(assertReserveAccess(f.run,['confirmation']),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
  let requested=0;
  await assert.rejects(acquireEvaluation(f.run,{cohort:'confirmation',fetcher:async()=>{requested++;throw new Error('Synthetic reserve request must not occur');}}),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
  await assert.rejects(extractEvaluation(f.run,{cohort:'temporal'}),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
  assert.equal(requested,0);assert.deepEqual(await hashFile(freezePath),before,'The new hold invalidates authorization without rewriting the immutable freeze');
});
