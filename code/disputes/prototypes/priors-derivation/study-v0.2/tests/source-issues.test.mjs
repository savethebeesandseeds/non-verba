// SPDX-License-Identifier: AGPL-3.0-only
// DECLARED_SYNTHETIC: these fixtures exercise binding, never actual source review.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest,sha256} from '../../lib/common.mjs';
import {STUDY_BASE,validateStudyRoot,writeJSON,readJSON,hashFile} from '../lib/store.mjs';
import {registerObservedSourceIssue,resolveObservedSourceIssue,assertNoUnresolvedSourceIssues} from '../lib/source-issues.mjs';

const governor='Landlord shall perform the following tenant improvements:';
const list='1. Replace the lighting after the tenant approves the proposed layout.';
const cost='The allowance is $100,000 and the tenant must repay an overage within thirty days.';
const unreadContext='Earlier operative context remains unread for this partial-neighbor fixture.';
const raw=`DECLARED SYNTHETIC\n\n${unreadContext}\n\n${governor}\n\n${list}\n\n${cost}\nEND SYNTHETIC`;
const contractId='synthetic-boundary-contract';
async function rewrite(root,path,value){await writeFile(join(root,path),`${JSON.stringify(value,null,2)}\n`);}

async function fixture(t){
  const root=join(STUDY_BASE,`test-source-issues-${randomUUID()}`);validateStudyRoot(root);await mkdir(root,{recursive:true});
  t.after(async()=>{validateStudyRoot(root);await rm(root,{recursive:true,force:true});});
  await mkdir(join(root,'raw'));await writeFile(join(root,'raw/contract.txt'),raw);
  async function extraction(version,{repaired=true,split=false}={}){
    const body={data_classification:'DECLARED_SYNTHETIC',version},source={...body,sha256:digest(body)};
    const metadata='DECLARED SYNTHETIC',text=split?`${metadata}\n\n${unreadContext}\n\n${governor}\n\n${list}\n\n${cost}`:repaired?`${governor}\n\n${list}\n\n${cost}`:governor;
    const span=(tag,start,end)=>({id:`synthetic-parent-${version}-${tag}`,contract_id:contractId,start,end,text:text.slice(start,end),sha256:sha256(text.slice(start,end))});
    const parent=split?span('anchor',0,metadata.length):span('whole',0,text.length);
    const boundary=text.indexOf(list)-2;
    const parents=split?[parent,span('governor',metadata.length+2,boundary),span('qualification',boundary+2,text.length)]:[parent];
    const cached={data_classification:'DECLARED_SYNTHETIC',contract:{id:contractId,path:'raw/contract.txt'},source,raw_sha256:sha256(raw),normalized_text:text,normalized_sha256:sha256(text),sections:parents};
    const cache=await writeJSON(root,`cache/${version}.json`,cached);
    await mkdir(join(root,'normalized'),{recursive:true});const normalizedPath=`normalized/${version}.txt`;await writeFile(join(root,normalizedPath),text);
    const value={source,contract_records:[{id:contractId,status:'accepted',raw_sha256:sha256(raw),normalized_path:normalizedPath,normalized_sha256:sha256(text)}],cache:[{id:contractId,...cache,source_sha256:source.sha256,result_sha256:digest(cached)}]};
    const manifest=await writeJSON(root,`extraction/${version}.json`,value);
    return {source,parent,parents,manifest,cache,cached,text};
  }
  const old=await extraction('old',{repaired:false});
  const packetBody={extraction_source:old.source,input_manifest:old.manifest},packetSource={...packetBody,sha256:digest(packetBody)};
  const packet=await writeJSON(root,'audit/coding.json',{source:packetSource,purpose:'coding',rows:[{audit_id:'coding-0010',contract_id:contractId,parent:old.parent,lineage:{cache_path:old.cache.path,cache_sha256:old.cache.sha256,raw_path:'raw/contract.txt',raw_sha256:sha256(raw)}}]});
  const evidence={schema:'literal-source-boundary-finding-v1',packet,audit_id:'coding-0010',contract_id:contractId,parent:{normalized_start:0,normalized_end:governor.length,characters:governor.length,sha256:sha256(governor),actual_read_ranges:[[0,governor.length]]},raw:{path:'raw/contract.txt',sha256:sha256(raw),actual_read_ranges:[[0,raw.length]]},finding:'Declared synthetic complete parent omits its introduced list and associated cost condition.',literal_governor:governor,literal_list_examples:[list],literal_cost_examples:[cost],reviewer_kind:'DECLARED_SYNTHETIC',authority:'NONE'};
  const evidenceRef=await writeJSON(root,'findings/failure.json',evidence);
  async function register(){return registerObservedSourceIssue(root,{evidencePath:evidenceRef.path,evidenceSHA:evidenceRef.sha256});}
  async function replay(issue,target){
    const {id,start,end,sha256:parentSHA}=target.parent;
    const value={schema:'source-issue-replay-v1',issue:{path:issue.path,sha256:issue.sha256},extraction_manifest:target.manifest,contract_id:contractId,parent:{id,start,end,sha256:parentSHA,actual_read_ranges:[[0,end-start]]},raw:{path:'raw/contract.txt',sha256:sha256(raw),actual_read_ranges:[[0,raw.length]]},reviewer:'Declared synthetic fixture author',reading:'FULL_PARENT_AND_RELEVANT_SOURCE',repair_adequate:true,unresolved_material_loss:false,material_loss_observed:false,reason:'Declared synthetic repaired parent retains the literal governor, work and allowance qualification.',authority:'NONE'};
    const reference=await writeJSON(root,`replays/${target.source.sha256}.json`,value);
    return {value,reference,options:{issuePath:issue.path,issueSHA:issue.sha256,replayPath:reference.path,replaySHA:reference.sha256}};
  }
  return {root,old,extraction,evidence,evidenceRef,register,replay};
}

test('registration is immutable and derives source; even an unrelated new version remains held',async t=>{
  const f=await fixture(t);const before=await assertNoUnresolvedSourceIssues(f.root,f.old.source.sha256);assert.equal(before.observed,0);
  const issue=await f.register(),again=await f.register();assert.equal(issue.source_sha256,f.old.source.sha256);assert.equal(issue.sha256,again.sha256);assert.equal(again.resumed,true);
  await assert.rejects(assertNoUnresolvedSourceIssues(f.root,f.old.source.sha256),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
  const next=await f.extraction('new');await assert.rejects(assertNoUnresolvedSourceIssues(f.root,next.source.sha256),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
});

test('only a complete authored replay resolves the issue for its exact repaired source version',async t=>{
  const f=await fixture(t),issue=await f.register(),next=await f.extraction('new'),replay=await f.replay(issue,next);
  const resolution=await resolveObservedSourceIssue(f.root,replay.options);assert.equal(resolution.source_sha256,next.source.sha256);
  const report=await assertNoUnresolvedSourceIssues(f.root,next.source.sha256);assert.equal(report.resolved,1);assert.equal(report.issues.length,1);
  await assert.rejects(assertNoUnresolvedSourceIssues(f.root,f.old.source.sha256),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
  const third=await f.extraction('third');await assert.rejects(assertNoUnresolvedSourceIssues(f.root,third.source.sha256),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
  assert.equal((await readJSON(f.root,issue.path)).status,'UNRESOLVED','Original receipt is preserved');
});

test('changed evidence bytes and a falsely rebound contract cannot register',async t=>{
  const f=await fixture(t);await assert.rejects(registerObservedSourceIssue(f.root,{evidencePath:f.evidenceRef.path,evidenceSHA:'0'.repeat(64)}),/artifact bytes differ/);
  f.evidence.contract_id='other-contract';await rewrite(f.root,f.evidenceRef.path,f.evidence);const actual=await hashFile(join(f.root,f.evidenceRef.path));
  await assert.rejects(registerObservedSourceIssue(f.root,{evidencePath:f.evidenceRef.path,evidenceSHA:actual.sha256}),/audit identity or contract differs/);
});

test('altered cache, source identity or raw bytes cannot support registration',async t=>{
  const f=await fixture(t);await writeFile(join(f.root,'raw/contract.txt'),`${raw} CHANGED`);await assert.rejects(f.register(),/raw source bytes differ/);
});

for(const [name,mutate,pattern] of [
  ['partial parent reading',replay=>{replay.parent.actual_read_ranges=[[0,5]];},/complete parent reading/],
  ['an unresolved judgment',replay=>{replay.unresolved_material_loss=true;},/authored complete source-issue replay/],
  ['unread associated raw context',replay=>{replay.raw.actual_read_ranges=[[0,30]];},/raw reading ranges/],
  ['a different original raw path',replay=>{replay.raw.path='raw/other.txt';},/original issue raw source/],
])test(`a replay with ${name} cannot resolve the global hold`,async t=>{
  const f=await fixture(t),issue=await f.register(),next=await f.extraction('new'),replay=await f.replay(issue,next);mutate(replay.value);await rewrite(f.root,replay.reference.path,replay.value);
  replay.options.replaySHA=(await hashFile(join(f.root,replay.reference.path))).sha256;
  await assert.rejects(resolveObservedSourceIssue(f.root,replay.options),pattern);await assert.rejects(assertNoUnresolvedSourceIssues(f.root,next.source.sha256),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
});

test('a new source identity with the same detached parent is not a repair',async t=>{
  const f=await fixture(t),issue=await f.register(),next=await f.extraction('still-broken',{repaired:false}),replay=await f.replay(issue,next);
  await assert.rejects(resolveObservedSourceIssue(f.root,replay.options),/still omits evidenced/);
});

test('post-resolution replay tampering invalidates a previously clear hold',async t=>{
  const f=await fixture(t),issue=await f.register(),next=await f.extraction('new'),replay=await f.replay(issue,next);await resolveObservedSourceIssue(f.root,replay.options);
  replay.value.reason+=' Altered after the immutable resolution.';await rewrite(f.root,replay.reference.path,replay.value);
  await assert.rejects(assertNoUnresolvedSourceIssues(f.root,next.source.sha256),/artifact bytes differ/);
});

async function neighborFixture(t){
  const f=await fixture(t),split=await f.extraction('neighbor',{split:true}),packetBody={extraction_source:split.source,input_manifest:split.manifest};
  const packet=await writeJSON(f.root,'audit/neighbor.json',{source:{...packetBody,sha256:digest(packetBody)},purpose:'development',rows:[{audit_id:'development-0013',contract_id:contractId,parent:split.parent,lineage:{cache_path:split.cache.path,cache_sha256:split.cache.sha256,raw_path:'raw/contract.txt',raw_sha256:sha256(raw)}}]});
  const start=split.text.indexOf(governor),rawStart=raw.indexOf(governor),snippet=(text,start,end)=>({start,end,sha256:sha256(text.slice(start,end)),text:text.slice(start,end)});
  const evidence={schema:'literal-source-neighbor-boundary-finding-v1',status:'FAILED_PARTIAL_SOURCE_REVIEW',finding:'Declared synthetic sampled metadata led to an actual partial reading of a falsely divided neighboring governor and qualification.',reviewer_kind:'DECLARED_SYNTHETIC',authority:'NONE',extraction_source_sha256:split.source.sha256,packet,audit_id:'development-0013',contract_id:contractId,sampled_parent:{...split.parent,actual_read_ranges:[[0,split.parent.end]],scope:'METADATA_ANCHOR_ONLY_NOT_AFFECTED_OPERATIVE_PARENT'},affected_parents:split.parents.slice(1),affected_parent_actual_normalized_read_ranges:[[start,split.text.length]],affected_governing_parent_fully_read:false,cache:split.cache,normalized:{path:'normalized/neighbor.txt',sha256:sha256(split.text),actual_read_ranges:[[0,split.parent.end],[start,split.text.length]],actual_read_snippet:snippet(split.text,start,split.text.length)},raw:{path:'raw/contract.txt',sha256:sha256(raw),actual_read_ranges:[[0,split.parent.end],[rawStart,raw.length]],actual_read_snippet:snippet(raw,rawStart,raw.length)},literal_governor:governor,literal_detached_qualification:`${list} ${cost}`,material_loss_observed:true,unresolved_material_loss:true,scope:'Actual partial readings only; the complete affected governing parent is unread.'};
  const reference=await writeJSON(f.root,'findings/neighbor.json',evidence);
  const registerNeighbor=async()=>registerObservedSourceIssue(f.root,{evidencePath:reference.path,evidenceSHA:(await hashFile(join(f.root,reference.path))).sha256});
  return {...f,split,evidence,reference,registerNeighbor};
}

test('a partial neighbor finding retains its honest scope and requires a full repaired-parent replay',async t=>{
  const f=await neighborFixture(t),issue=await f.registerNeighbor(),receipt=await readJSON(f.root,issue.path);
  assert.equal(receipt.observed_reading_scope.mode,'PARTIAL_NEIGHBOR_SOURCE');assert.equal(receipt.observed_reading_scope.affected_governing_parent_fully_read,false);
  assert.notEqual(receipt.parent.id,receipt.sampled_parent.id);assert.equal(receipt.affected_parents.length,2);
  const repaired=await f.extraction('neighbor-repaired'),replay=await f.replay(issue,repaired);await assert.rejects(assertNoUnresolvedSourceIssues(f.root,repaired.source.sha256),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
  await resolveObservedSourceIssue(f.root,replay.options);assert.equal((await assertNoUnresolvedSourceIssues(f.root,repaired.source.sha256)).resolved,1);
});

for(const [name,mutate] of [
  ['another cache',e=>{e.cache.path='cache/old.json';}],
  ['a wrong affected-parent hash',e=>{e.affected_parents[0].sha256='0'.repeat(64);}],
  ['the sampled anchor masquerading as an affected governor',e=>{e.affected_parents[0]=e.sampled_parent;}],
  ['a wrong snippet hash',e=>{e.normalized.actual_read_snippet.sha256='0'.repeat(64);}],
  ['a normalized snippet outside actual read ranges',e=>{e.affected_parent_actual_normalized_read_ranges=[[e.normalized.actual_read_snippet.start+1,e.normalized.actual_read_snippet.end]];}],
  ['raw evidence outside actual read ranges',e=>{e.raw.actual_read_ranges=[[0,10]];}],
  ['a fabricated full governing-parent reading claim',e=>{e.affected_governing_parent_fully_read=true;}],
  ['another contract',e=>{e.contract_id='unrelated-contract';}],
])test(`partial neighbor evidence cannot register with ${name}`,async t=>{
  const f=await neighborFixture(t);mutate(f.evidence);await rewrite(f.root,f.reference.path,f.evidence);await assert.rejects(f.registerNeighbor());
});

test('every issue needs its own resolution for the exact new source, across old full and new partial findings',async t=>{
  const f=await neighborFixture(t),full=await f.register(),partial=await f.registerNeighbor(),target=await f.extraction('all-repaired');
  const first=await f.replay(full,target);await resolveObservedSourceIssue(f.root,first.options);
  await assert.rejects(assertNoUnresolvedSourceIssues(f.root,target.source.sha256),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
  const value={...first.value,issue:{path:partial.path,sha256:partial.sha256}},reference=await writeJSON(f.root,'replays/second-issue.json',value);
  await resolveObservedSourceIssue(f.root,{issuePath:partial.path,issueSHA:partial.sha256,replayPath:reference.path,replaySHA:reference.sha256});
  const cleared=await assertNoUnresolvedSourceIssues(f.root,target.source.sha256);assert.equal(cleared.observed,2);assert.equal(cleared.resolved,2);
});
