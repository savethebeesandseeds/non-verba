// SPDX-License-Identifier: AGPL-3.0-only
// DECLARED_SYNTHETIC: these fixtures exercise binding, never actual source review.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest,sha256} from '../../lib/common.mjs';
import {STUDY_BASE,validateStudyRoot,writeJSON,readJSON,hashFile,writeExtractionCache} from '../lib/store.mjs';
import {registerObservedSourceIssue,resolveObservedSourceIssue,assertNoUnresolvedSourceIssues,prepareNativeChangeReplayEvidence} from '../lib/source-issues.mjs';
import {extractSections} from '../lib/sections.mjs';
import {storeNativeDecoration} from '../lib/native-decoration-store.mjs';
import {createNativeDecorationView} from '../lib/source-decoration.mjs';

const governor='Landlord shall perform the following tenant improvements:';
const list='1. Replace the lighting after the tenant approves the proposed layout.';
const cost='The allowance is $100,000 and the tenant must repay an overage within thirty days.';
const unreadContext='Earlier operative context remains unread for this partial-neighbor fixture.';
const raw=`DECLARED SYNTHETIC\n\n${unreadContext}\n\n${governor}\n\n${list}\n\n${cost}\nEND SYNTHETIC`;
const contractId='synthetic-boundary-contract';
async function rewrite(root,path,value){await writeFile(join(root,path),`${JSON.stringify(value,null,2)}\n`);}

async function fixture(t,sourceRaw=raw){
  const raw=sourceRaw;
  const root=join(STUDY_BASE,`test-source-issues-${randomUUID()}`);validateStudyRoot(root);await mkdir(root,{recursive:true});
  t.after(async()=>{validateStudyRoot(root);await rm(root,{recursive:true,force:true});});
  await mkdir(join(root,'raw'));await writeFile(join(root,'raw/contract.txt'),raw);
  async function extraction(version,{repaired=true,split=false,parentVersion=version,outsideText='',extendParent=false,withFocal=false,focalStart=0}={}){
    const body={data_classification:'DECLARED_SYNTHETIC',version},source={...body,sha256:digest(body)};
    const metadata='DECLARED SYNTHETIC',baseText=split?`${metadata}\n\n${unreadContext}\n\n${governor}\n\n${list}\n\n${cost}`:repaired?`${governor}\n\n${list}\n\n${cost}`:governor,text=baseText+outsideText;
    const span=(tag,start,end)=>({id:`synthetic-parent-${parentVersion}-${tag}`,contract_id:contractId,start,end,text:text.slice(start,end),sha256:sha256(text.slice(start,end))});
    const parent=split?span('anchor',0,metadata.length):span('whole',0,extendParent?text.length:baseText.length);
    if(withFocal)parent.units=[{id:'synthetic-focal-unit',parent_section_id:parent.id,start:focalStart,end:parent.end,text:text.slice(focalStart,parent.end),sha256:sha256(text.slice(focalStart,parent.end))}];
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

test('source-issue current replay accepts a hash-bound gzip cache with all unchanged source fields',async t=>{
  const f=await fixture(t),issue=await f.register(),next=await f.extraction('new-gzip'),name='extraction-cache/new-gzip.json.gz';next.cached.DECLARED_SYNTHETIC_LARGE_COMPLETE_METADATA='x'.repeat(17*1024**2);const stored=await writeExtractionCache(f.root,name,next.cached),receipt={id:contractId,...stored.artifact,storage:stored.storage,source_sha256:next.source.sha256,result_sha256:digest(next.cached)};assert.ok(stored.storage.decoded_bytes>16*1024**2);await writeJSON(f.root,name+'.manifest.json',receipt);
  const manifest=await readJSON(f.root,next.manifest.path);manifest.cache=[receipt];next.manifest=await writeJSON(f.root,'extraction/new-gzip-compressed.json',manifest);next.cache=stored.artifact;
  const replay=await f.replay(issue,next);assert.equal((await resolveObservedSourceIssue(f.root,replay.options)).source_sha256,next.source.sha256);assert.equal((await assertNoUnresolvedSourceIssues(f.root,next.source.sha256)).resolved,1);
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

const inlinePolicy='LEXICAL_INLINE_HTML_V1';
const fontLetters=value=>[...value].map(char=>/\s/u.test(char)?'&nbsp;':`<FONT title="a > b">${char}</FONT>`).join('');
const lexicalRaw=(governorMarkup=fontLetters(governor),listMarkup=list.replace('lighting','<KBD><STRIKE>lighting</STRIKE></KBD>'),costMarkup=cost)=>`<html><body><P>${governorMarkup}</P><HR/><P>${listMarkup}</P><P>${costMarkup}</P></body></html>`;
async function lexicalFixture(t,sourceRaw=lexicalRaw()){
  const f=await fixture(t,sourceRaw);f.evidence.raw_literal_matching_policy=inlinePolicy;
  await rewrite(f.root,f.evidenceRef.path,f.evidence);
  const registerCurrent=async()=>registerObservedSourceIssue(f.root,{evidencePath:f.evidenceRef.path,evidenceSHA:(await hashFile(join(f.root,f.evidenceRef.path))).sha256});
  async function lexicalReplay(issue,target){
    const replay=await f.replay(issue,target);replay.value.raw_literal_matching_policy=inlinePolicy;await rewrite(f.root,replay.reference.path,replay.value);replay.options.replaySHA=(await hashFile(join(f.root,replay.reference.path))).sha256;return replay;
  }
  return {...f,sourceRaw,registerCurrent,lexicalReplay};
}

test('explicit inline policy registers literal FONT/KBD/STRIKE text and requires an authored exact-source replay',async t=>{
  const f=await lexicalFixture(t),issue=await f.registerCurrent(),body=await readJSON(f.root,issue.path);
  assert.equal(body.raw_literal_matching_policy,inlinePolicy);assert.deepEqual(body.required_preserved_literals,[governor,list,cost]);
  const next=await f.extraction('inline-repaired');await assert.rejects(assertNoUnresolvedSourceIssues(f.root,next.source.sha256),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
  const replay=await f.lexicalReplay(issue,next);await resolveObservedSourceIssue(f.root,replay.options);assert.equal((await assertNoUnresolvedSourceIssues(f.root,next.source.sha256)).resolved,1);
  await assert.rejects(assertNoUnresolvedSourceIssues(f.root,f.old.source.sha256),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
  const third=await f.extraction('inline-third');await assert.rejects(assertNoUnresolvedSourceIssues(f.root,third.source.sha256),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
  assert.equal((await readJSON(f.root,issue.path)).status,'UNRESOLVED');
});

test('legacy evidence retains its exact issue body and never opts into formatted raw matching',async t=>{
  const f=await fixture(t),issue=await f.register(),retained=await readJSON(f.root,issue.path),{issue_id,...body}=retained;
  const expected={schema:'observed-source-issue-v1',status:'UNRESOLVED',classification:'MATERIAL_BOUNDARY',extraction_source_sha256:f.old.source.sha256,evidence:f.evidenceRef,packet:body.packet,extraction_manifest:f.old.manifest,audit_id:'coding-0010',contract_id:contractId,parent:{id:f.old.parent.id,start:0,end:governor.length,sha256:sha256(governor)},raw:{path:'raw/contract.txt',sha256:sha256(raw),bytes:Buffer.byteLength(raw)},required_preserved_literals:[governor,list,cost],authority:'NONE',execution_attested:false};
  assert.deepEqual(body,expected);assert.equal(issue_id,`issue-${digest(expected)}`);assert.equal(Object.hasOwn(body,'raw_literal_matching_policy'),false);
  const formatted=await fixture(t,lexicalRaw());await assert.rejects(formatted.register(),/raw reading ranges/);
});

for(const [name,governorMarkup] of [
  ['an attribute-only phrase',`<FONT title="${governor}">No operative source phrase here.</FONT>`],
  ['comment-only text',`<!-- ${governor} -->`],
  ['script-only text',`<script>${governor}</script>`],
  ['style-only text',`<STYLE>${governor}</STYLE>`],
  ['inert template text',`<template>${governor}</template>`],
  ['nested inert template text',`<template><template>Unrelated inner text.</template>${governor}</template>`],
  ['an inert closing label inside script text',`<template><script>const label="</template>";</script>${governor}</template>`],
  ['a changed visible letter',fontLetters(governor.replace('Landlord','Landlard'))],
  ['an inserted visible word',governor.replace('shall','shall surprisingly')],
  ['changed case',fontLetters(governor.toLowerCase())],
  ['a structural word join',governor.replace('Landlord','Land<HR/>lord')],
  ['an unsupported inline word join',governor.replace('Landlord','Land<widget>lord</widget>')],
  ['a comment word join',governor.replace('Landlord','Land<!-- omitted -->lord')],
  ['a malformed inline attribute',`<FONT bad==value>${governor}</FONT>`],
  ['an unterminated quoted tag',`<FONT title="unclosed>${governor}`],
  ['an unclosed inline element',`<FONT>${governor}`],
  ['mismatched inline closures',`<FONT>${governor}</KBD>`],
])test(`inline policy refuses ${name}`,async t=>{
  const f=await lexicalFixture(t,lexicalRaw(governorMarkup));await assert.rejects(f.registerCurrent(),/raw reading ranges/);
});

test('complete literals cannot be assembled from disjoint or adjacent actual raw outputs',async t=>{
  for(const adjacent of [false,true]){
    const sourceRaw=lexicalRaw(governor),f=await lexicalFixture(t,sourceRaw),cut=sourceRaw.indexOf('shall')+2;
    f.evidence.raw.actual_read_ranges=[[0,cut],[cut+(adjacent?0:1),sourceRaw.length]];await rewrite(f.root,f.evidenceRef.path,f.evidence);
    await assert.rejects(f.registerCurrent(),/raw reading ranges/);
  }
});

test('a read range beginning inside an attribute or inert element cannot expose hidden literal text',async t=>{
  for(const wrapper of [`<FONT title="${governor}">Hidden attribute.</FONT>`,`<script>${governor}</script>`]){
    const sourceRaw=lexicalRaw(wrapper),f=await lexicalFixture(t,sourceRaw),start=sourceRaw.indexOf(governor);
    f.evidence.raw.actual_read_ranges=[[start,sourceRaw.length]];await rewrite(f.root,f.evidenceRef.path,f.evidence);
    await assert.rejects(f.registerCurrent(),/raw reading ranges/);
  }
});

test('unsupported policies and a fabricated complete diagnostic-parent read cannot register',async t=>{
  const f=await lexicalFixture(t);f.evidence.raw_literal_matching_policy='STRIP_ALL_HTML';await rewrite(f.root,f.evidenceRef.path,f.evidence);await assert.rejects(f.registerCurrent(),/Unsupported explicit/);
  f.evidence.raw_literal_matching_policy=inlinePolicy;f.evidence.parent.actual_read_ranges=[[0,governor.length-1]];await rewrite(f.root,f.evidenceRef.path,f.evidence);await assert.rejects(f.registerCurrent(),/complete parent reading/);
});

for(const [name,mutate,pattern] of [
  ['a missing policy',value=>{delete value.raw_literal_matching_policy;},/policy differs/],
  ['an unsupported policy',value=>{value.raw_literal_matching_policy='STRIP_ALL_HTML';},/Unsupported explicit/],
  ['an incomplete repaired parent',value=>{value.parent.actual_read_ranges=[[0,5]];},/complete parent reading/],
  ['a raw interval missing the literals',value=>{value.raw.actual_read_ranges=[[0,30]];},/raw reading ranges/],
  ['SHA-only prior-reading metadata',value=>{delete value.parent.actual_read_ranges;delete value.raw.actual_read_ranges;value.prior_reading={source_sha256:'0'.repeat(64),claimed_complete:true};},/bounded reading ranges/],
])test(`inline replay with ${name} cannot clear the hold`,async t=>{
  const f=await lexicalFixture(t),issue=await f.registerCurrent(),target=await f.extraction('inline-failed-replay'),replay=await f.lexicalReplay(issue,target);mutate(replay.value);await rewrite(f.root,replay.reference.path,replay.value);replay.options.replaySHA=(await hashFile(join(f.root,replay.reference.path))).sha256;
  await assert.rejects(resolveObservedSourceIssue(f.root,replay.options),pattern);await assert.rejects(assertNoUnresolvedSourceIssues(f.root,target.source.sha256),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
});

test('a replay cannot widen a legacy issue into inline HTML matching',async t=>{
  const f=await fixture(t),issue=await f.register(),target=await f.extraction('legacy-no-widening'),replay=await f.replay(issue,target);replay.value.raw_literal_matching_policy=inlinePolicy;await rewrite(f.root,replay.reference.path,replay.value);replay.options.replaySHA=(await hashFile(join(f.root,replay.reference.path))).sha256;
  await assert.rejects(resolveObservedSourceIssue(f.root,replay.options),/policy differs/);
});

const omittedWrappers=[
  ...['SVG','CANVAS','IFRAME','OBJECT','EMBED'].map(tag=>[tag,value=>`<${tag} data-title="a > b">${value}</${tag}>`]),
  ['hidden inline',value=>`<FONT hidden>${value}</FONT>`],
  ['hidden=false is still present',value=>`<KBD hidden="false">${value}</KBD>`],
  ['hidden ancestor',value=>`<div hidden><FONT>${value}</FONT></div>`],
  ['aria-hidden=true',value=>`<STRIKE aria-hidden="true">${value}</STRIKE>`],
  ['decoded aria-hidden=true',value=>`<FONT aria-hidden="tr&#117;e">${value}</FONT>`],
  ['display:none',value=>`<KBD style="display:none">${value}</KBD>`],
  ['visibility:hidden',value=>`<STRIKE style="color:red; visibility : hidden !important;">${value}</STRIKE>`],
  ['decoded display:none',value=>`<FONT style="display&#58;none">${value}</FONT>`],
  ['hidden mixed-case attribute name',value=>`<FONT HiDdEn="">${value}</FONT>`],
];
for(const [name,wrap] of omittedWrappers)test(`inline policy excludes the entire ${name} subtree at every actual read start`,async t=>{
  for(const variant of ['complete_document','inside_omitted_subtree','unread_visible_duplicate']){
    const prefix=variant==='unread_visible_duplicate'?`<P>${governor}</P>`:'',sourceRaw=prefix+lexicalRaw(wrap(governor)),f=await lexicalFixture(t,sourceRaw);
    if(variant!=='complete_document'){
      const start=sourceRaw.indexOf(governor,prefix.length);f.evidence.raw.actual_read_ranges=[[start,sourceRaw.length]];await rewrite(f.root,f.evidenceRef.path,f.evidence);
    }
    await assert.rejects(f.registerCurrent(),/raw reading ranges/);
  }
});

test('an excluded duplicate does not hide an actually read visible literal or interpret KBD/STRIKE',async t=>{
  const sourceRaw=lexicalRaw(`<FONT hidden>${governor}</FONT><KBD><STRIKE>${governor}</STRIKE></KBD>`),f=await lexicalFixture(t,sourceRaw),issue=await f.registerCurrent();assert.equal(issue.status,'UNRESOLVED');
});

test('only the extractor exact attribute exclusion rules apply; class or other CSS claims are not rendered',async t=>{
  for(const attrs of ['aria-hidden="TRUE"','aria-hidden="false"','style="display:noneish;visibility:hiddenish"','class="hidden"','style="opacity:0;display:block"']){
    const f=await lexicalFixture(t,lexicalRaw(`<KBD ${attrs}><STRIKE>${governor}</STRIKE></KBD>`));assert.equal((await f.registerCurrent()).status,'UNRESOLVED');
  }
});

const qualifiedMode='QUALIFIED_SOURCE_ONLY_PRIOR_ACTUAL_READING';
const carriedLimits=()=>({scope:'PRIOR_ACTUAL_PARENT_AND_DECLARED_RAW_RANGES_ONLY',heading_reviewed:false,navigation_reviewed:false,whole_cache_read:false,new_body_read:false,notes:'Declared synthetic source-only equivalence; prior contextual limitations remain binding.'});
async function qualificationFixture(t,{inline=false,withFocal=false,targetOptions={}}={}){
  const f=inline?await lexicalFixture(t):await fixture(t),issue=inline?await f.registerCurrent():await f.register();
  const prior=await f.extraction('qualified-prior',{withFocal}),actual=inline?await f.lexicalReplay(issue,prior):await f.replay(issue,prior);
  actual.value.epistemic_limits=['Declared synthetic original actual parent and specified raw ranges only; navigation and surrounding unknown facts remain unreviewed.'];
  if(withFocal){const unit=prior.parent.units[0];actual.value.focal={id:unit.id,start:unit.start,end:unit.end,sha256:unit.sha256};}
  await rewrite(f.root,actual.reference.path,actual.value);actual.reference={path:actual.reference.path,...await hashFile(join(f.root,actual.reference.path))};actual.options.replaySHA=actual.reference.sha256;
  const target=await f.extraction('qualified-nav-only',{parentVersion:'qualified-prior',withFocal,...targetOptions}),next=inline?await f.lexicalReplay(issue,target):await f.replay(issue,target);
  next.value.review_mode=qualifiedMode;next.value.newly_read_current_version=false;next.value.prior_actual_replay=actual.reference;next.value.contextual_limits=carriedLimits();
  if(withFocal){const unit=target.parent.units[0];next.value.focal={id:unit.id,start:unit.start,end:unit.end,sha256:unit.sha256};}
  async function bindNext(){await rewrite(f.root,next.reference.path,next.value);next.reference={path:next.reference.path,...await hashFile(join(f.root,next.reference.path))};next.options.replaySHA=next.reference.sha256;return next.options;}
  await bindNext();return {...f,issue,prior,actual,target,next,bindNext};
}

test('source-only prior qualification preserves actual origins and limits and never clears a hold automatically',async t=>{
  const f=await qualificationFixture(t,{inline:true,withFocal:true});await assert.rejects(assertNoUnresolvedSourceIssues(f.root,f.target.source.sha256),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
  const resolution=await resolveObservedSourceIssue(f.root,f.next.options),record=await readJSON(f.root,resolution.path),q=record.qualification;
  assert.equal(q.review_mode,qualifiedMode);assert.equal(q.newly_read_current_version,false);assert.deepEqual(q.prior_actual_replay,f.actual.reference);assert.equal(q.prior_reason_and_contextual_limits.reason,f.actual.value.reason);assert.deepEqual(q.prior_reason_and_contextual_limits.epistemic_limits,f.actual.value.epistemic_limits);assert.deepEqual(q.contextual_limits,carriedLimits());assert.deepEqual(q.actual_parent_read_ranges,f.actual.value.parent.actual_read_ranges);assert.deepEqual(q.actual_raw_read_ranges,f.actual.value.raw.actual_read_ranges);assert.deepEqual(q.focal,f.actual.value.focal);
  assert.equal((await assertNoUnresolvedSourceIssues(f.root,f.target.source.sha256)).resolved,1);assert.equal((await readJSON(f.root,f.issue.path)).status,'UNRESOLVED');
  const another=await f.extraction('another-nav-only',{parentVersion:'qualified-prior',withFocal:true});await assert.rejects(assertNoUnresolvedSourceIssues(f.root,another.source.sha256),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
});

for(const [name,options] of [
  ['changed parent identity',{parentVersion:'different-parent'}],
  ['changed complete normalized source outside the identical parent',{outsideText:'\nUNREAD SYNTHETIC ADDITION OUTSIDE THE DECLARED PARENT'}],
  ['changed declared focal',{withFocal:true,focalStart:1}],
])test(`qualification refuses ${name}`,async t=>{
  const f=await qualificationFixture(t,{withFocal:!!options.withFocal,targetOptions:options});await assert.rejects(resolveObservedSourceIssue(f.root,f.next.options),/not exactly equivalent|declared focal differs/);await assert.rejects(assertNoUnresolvedSourceIssues(f.root,f.target.source.sha256),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
});

for(const [name,mutate,pattern] of [
  ['missing prior origin',f=>{delete f.next.value.prior_actual_replay;},/bound prior actual replay/],
  ['SHA-only origin',f=>{f.next.value.prior_actual_replay={sha256:f.actual.reference.sha256};},/bound prior actual replay/],
  ['tampered origin SHA',f=>{f.next.value.prior_actual_replay={...f.actual.reference,sha256:'0'.repeat(64)};},/artifact bytes differ/],
  ['tampered origin byte count',f=>{f.next.value.prior_actual_replay={...f.actual.reference,bytes:f.actual.reference.bytes+1};},/artifact bytes differ/],
  ['self-referential origin',f=>{f.next.value.prior_actual_replay={...f.actual.reference,path:f.next.reference.path};},/Distinct bound prior/],
  ['new actual reading misstatement',f=>{f.next.value.newly_read_current_version=true;},/no-new-reading/],
  ['missing contextual limits',f=>{delete f.next.value.contextual_limits;},/contextual limits/],
  ['heading scope upgrade',f=>{f.next.value.contextual_limits.heading_reviewed=true;},/contextual limits/],
  ['whole-cache scope upgrade',f=>{f.next.value.contextual_limits.whole_cache_read=true;},/contextual limits/],
  ['changed carried parent ranges',f=>{const n=f.next.value.parent.end-f.next.value.parent.start;f.next.value.parent.actual_read_ranges=[[0,10],[10,n]];},/exact prior actual reading intervals/],
  ['changed carried raw ranges',f=>{f.next.value.raw.actual_read_ranges=[[0,10],[10,raw.length]];},/exact prior actual reading intervals/],
  ['undeclared source focal',f=>{f.next.value.focal={id:'invented',start:0,end:20,sha256:sha256('invented')};},/focal source binding/],
  ['widened matching policy',f=>{f.next.value.raw_literal_matching_policy=inlinePolicy;},/matching policy differs/],
])test(`source-only qualification rejects ${name}`,async t=>{
  const f=await qualificationFixture(t);mutate(f);await assert.rejects(resolveObservedSourceIssue(f.root,await f.bindNext()),pattern);
});

test('a chained qualification or non-actual prior receipt cannot become an actual reading origin',async t=>{
  for(const kind of ['qualification','prior_claim','partial_read']){
    const f=await qualificationFixture(t);
    if(kind==='qualification'){f.actual.value.review_mode=qualifiedMode;f.actual.value.newly_read_current_version=false;f.actual.value.prior_actual_replay=f.actual.reference;}
    else if(kind==='prior_claim')f.actual.value.prior_reading={sha256:f.actual.reference.sha256,claimed_complete:true};
    else f.actual.value.parent.actual_read_ranges=[[0,5]];
    await rewrite(f.root,f.actual.reference.path,f.actual.value);f.next.value.prior_actual_replay={path:f.actual.reference.path,...await hashFile(join(f.root,f.actual.reference.path))};await assert.rejects(resolveObservedSourceIssue(f.root,await f.bindNext()),/original actual replay|complete parent reading/);
  }
});

test('a changed or expanded repaired parent requires new actual reading instead of prior qualification',async t=>{
  const f=await qualificationFixture(t);const changed=await f.extraction('expanded-source',{outsideText:'\nADDITIONAL DECLARED SYNTHETIC CONTEXT',extendParent:true,parentVersion:'qualified-prior'});
  const next=await f.replay(f.issue,changed);next.value={...next.value,review_mode:qualifiedMode,newly_read_current_version:false,prior_actual_replay:f.actual.reference,contextual_limits:carriedLimits()};await rewrite(f.root,next.reference.path,next.value);next.options.replaySHA=(await hashFile(join(f.root,next.reference.path))).sha256;
  await assert.rejects(resolveObservedSourceIssue(f.root,next.options),/not exactly equivalent/);
});

test('a changed original raw source or altered qualification resolution remains fail closed',async t=>{
  const f=await qualificationFixture(t),resolution=await resolveObservedSourceIssue(f.root,f.next.options),record=await readJSON(f.root,resolution.path);record.qualification.contextual_limits.heading_reviewed=true;await rewrite(f.root,resolution.path,record);await assert.rejects(assertNoUnresolvedSourceIssues(f.root,f.target.source.sha256),/qualification differs/);
  await writeFile(join(f.root,'raw/contract.txt'),raw+' CHANGED');await assert.rejects(resolveObservedSourceIssue(f.root,f.next.options),/raw source bytes differ/);
});

for(const [name,declarations,pattern] of [
  ['an absent qualification mode with explicit no-new-reading',{newly_read_current_version:false},/No-new-reading declaration requires/],
  ['an actual mode contradicted by no-new-reading',{review_mode:'NEW_ACTUAL_CURRENT_VERSION_READING',newly_read_current_version:false},/No-new-reading declaration requires/],
  ['an unknown equivalence mode without an origin',{review_mode:'EXACT_PRIOR_SOURCE_EQUIVALENCE'},/Unsupported explicit.*review mode/],
  ['an unknown equivalence mode with no-new-reading',{review_mode:'EXACT_PRIOR_SOURCE_EQUIVALENCE',newly_read_current_version:false},/Unsupported explicit.*review mode/],
  ['a null explicit mode',{review_mode:null},/Unsupported explicit.*review mode/],
  ['a nonboolean false declaration',{newly_read_current_version:'false'},/declaration must be boolean/],
  ['supported qualification mode without actual origin',{review_mode:qualifiedMode,newly_read_current_version:false},/Distinct bound prior actual replay/],
])test(`a copied full-reading replay cannot clear a hold with ${name}`,async t=>{
  const f=await fixture(t),issue=await f.register(),target=await f.extraction('declaration-bypass-fixed'),replay=await f.replay(issue,target);Object.assign(replay.value,declarations);await rewrite(f.root,replay.reference.path,replay.value);replay.options.replaySHA=(await hashFile(join(f.root,replay.reference.path))).sha256;
  await assert.rejects(resolveObservedSourceIssue(f.root,replay.options),pattern);await assert.rejects(assertNoUnresolvedSourceIssues(f.root,target.source.sha256),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
});

test('legacy absent actual declarations and supported explicit new-actual declarations remain valid',async t=>{
  for(const declarations of [{},{newly_read_current_version:true},{review_mode:'NEW_ACTUAL_CURRENT_VERSION_READING',newly_read_current_version:true}]){
    const f=await fixture(t),issue=await f.register(),target=await f.extraction('actual-declaration-preserved'),replay=await f.replay(issue,target);Object.assign(replay.value,declarations);await rewrite(f.root,replay.reference.path,replay.value);replay.options.replaySHA=(await hashFile(join(f.root,replay.reference.path))).sha256;
    assert.equal((await resolveObservedSourceIssue(f.root,replay.options)).status,'RESOLVED_FOR_EXACT_SOURCE');
  }
});

async function nativeFixture(t){
  const instruction='DECLARED SYNTHETIC: native struck and underlined text is retained as marked. Any change requires a later signed notice; effectiveness is not determined here.';
  const markup='<strike>1.00</strike><u>0.75</u>',anchors=['First synthetic quoted rate','Second synthetic quoted rate'];
  const rawContexts=anchors.map(anchor=>`<P>${anchor} is ${markup}% in this fictional sample.</P>`),normalizedContexts=anchors.map(anchor=>`${anchor} is 1.000.75% in this fictional sample.`);
  const sourceRaw=`<html><body><H2>Declared synthetic rate terms</H2><P>${instruction}</P>\n${rawContexts.join('\n')}\n<P>Unrelated sampled reference, not a governing completeness claim.</P></body></html>`;
  const f=await fixture(t,sourceRaw),prefix='UNREAD SYNTHETIC GOVERNING CONTEXT. '.repeat(80),affectedText=prefix+'\n'+normalizedContexts.join('\n')+'\nUNREAD FOLLOWING CONTEXT.',sampledText='Unrelated sampled reference, not a governing completeness claim.',text=affectedText+'\n\n'+sampledText;
  const body={data_classification:'DECLARED_SYNTHETIC',version:'native-flat'},source={...body,sha256:digest(body)};
  const parent=(id,start,end)=>({id,contract_id:contractId,start,end,text:text.slice(start,end),sha256:sha256(text.slice(start,end))});
  const affected=parent('synthetic-affected-parent',0,affectedText.length),sampled=parent('synthetic-sampled-parent',affectedText.length+2,text.length);
  const unit={id:'synthetic-sampled-unit',parent_section_id:sampled.id,start:sampled.start,end:sampled.end,text:sampled.text,sha256:sampled.sha256};sampled.units=[unit];
  const cacheValue={data_classification:'DECLARED_SYNTHETIC',contract:{id:contractId,path:'raw/contract.txt'},source,raw_sha256:sha256(sourceRaw),normalized_text:text,normalized_sha256:sha256(text),sections:[affected,sampled]};
  const cache=await writeJSON(f.root,'cache/native-flat.json',cacheValue);await writeFile(join(f.root,'normalized/native-flat.txt'),text);const normalizedRef={path:'normalized/native-flat.txt',...await hashFile(join(f.root,'normalized/native-flat.txt'))};
  const manifest=await writeJSON(f.root,'extraction/native-flat.json',{source,contract_records:[{id:contractId,status:'accepted',raw_sha256:sha256(sourceRaw),normalized_path:normalizedRef.path,normalized_sha256:normalizedRef.sha256}],cache:[{id:contractId,...cache,source_sha256:source.sha256,result_sha256:digest(cacheValue)}]});
  const packetSource={extraction_source:source,input_manifest:manifest},packet=await writeJSON(f.root,'audit/native-flat.json',{source:{...packetSource,sha256:digest(packetSource)},purpose:'coding',rows:[{id:unit.id,audit_id:'coding-0099',contract_id:contractId,parent:sampled,lineage:{cache_path:cache.path,cache_sha256:cache.sha256,raw_path:'raw/contract.txt',raw_sha256:sha256(sourceRaw)}}]});
  const snippet=(value,start,end)=>({start,end,text:value.slice(start,end),sha256:sha256(value.slice(start,end))});
  const rawRanges=rawContexts.map(value=>{const start=sourceRaw.indexOf(value);return [start,start+value.length];}),normRanges=normalizedContexts.map(value=>{const start=text.indexOf(value);return [start,start+value.length];});
  const instructionStart=sourceRaw.indexOf(instruction),evidence={schema:'native-change-markup-finding-v1',status:'FAILED_PARTIAL_SOURCE_REVIEW',finding:'Declared synthetic native markup distinctions flatten into adjacent text; only the bounded source contexts were read.',reviewer_kind:'DECLARED_SYNTHETIC',authority:'NONE',human:false,adopted:false,material_loss_observed:true,unresolved_material_loss:true,packet,audit_id:'coding-0099',contract_id:contractId,extraction_source_sha256:source.sha256,extraction_manifest:manifest,cache,sampled_parent:{id:sampled.id,start:sampled.start,end:sampled.end,sha256:sampled.sha256,scope:'REFERENCE_ONLY'},sampled_focal:{id:unit.id,start:unit.start,end:unit.end,sha256:unit.sha256,scope:'REFERENCE_ONLY'},sampled_parent_fully_read:false,governing_parent_fully_read:false,whole_original_document_read:false,effectiveness_conditions_verified:false,clean_operative_version_derived:false,raw:{path:'raw/contract.txt',sha256:sha256(sourceRaw),bytes:Buffer.byteLength(sourceRaw),actual_read_ranges:[[instructionStart,instructionStart+instruction.length],...rawRanges],source_instruction_and_effectiveness_context:snippet(sourceRaw,instructionStart,instructionStart+instruction.length)},normalized:{...normalizedRef,actual_read_ranges:normRanges},occurrences:anchors.map((anchor,index)=>{const rawStart=sourceRaw.indexOf(markup,rawRanges[index][0]),normStart=text.indexOf('1.000.75',normRanges[index][0]);return {id:'native-'+index,context_anchor:anchor,raw_occurrence:snippet(sourceRaw,rawStart,rawStart+markup.length),raw_context:snippet(sourceRaw,...rawRanges[index]),normalized_occurrence:snippet(text,normStart,normStart+8),normalized_context:snippet(text,...normRanges[index]),affected_parent_reference:{id:affected.id,start:affected.start,end:affected.end,sha256:affected.sha256}};})};
  const support=await writeJSON(f.root,'findings/native-technical-origin.json',{classification:'DECLARED_SYNTHETIC',scope:'Bounded technical observation only'});evidence.supporting_technical_artifacts=[support];
  const ref=await writeJSON(f.root,'findings/native-change.json',evidence);
  async function registerNative(){return registerObservedSourceIssue(f.root,{evidencePath:ref.path,evidenceSHA:(await hashFile(join(f.root,ref.path))).sha256});}
  return {...f,nativeSource:source,sourceRaw,text,affected,sampled,nativeEvidence:evidence,nativeRef:ref,registerNative,rawRanges,normRanges,snippet};
}

test('native-change registration preserves two independently read occurrences and honest partial scope without a boundary classification',async t=>{
  const f=await nativeFixture(t),issue=await f.registerNative(),again=await f.registerNative(),receipt=await readJSON(f.root,issue.path);assert.equal(again.sha256,issue.sha256);assert.equal(again.resumed,true);
  assert.equal(receipt.classification,'MATERIAL_NATIVE_CHANGE_MARKUP');assert.equal(Object.hasOwn(receipt,'required_preserved_literals'),false);assert.equal(receipt.native_change_evidence.observed_reading_scope.governing_parent_fully_read,false);assert.equal(receipt.native_change_evidence.sampled_parent.scope,'REFERENCE_ONLY');assert.equal(receipt.native_change_evidence.occurrences.length,2);
  for(const occurrence of receipt.native_change_evidence.occurrences){assert.deepEqual(occurrence.native_style_spans.map(mark=>[mark.native_element,mark.literal_text]),[['STRIKE','1.00'],['U','0.75']]);assert(occurrence.normalized_occurrence.end<f.sampled.start);assert.equal(occurrence.affected_parent_reference.end-occurrence.affected_parent_reference.start,f.affected.end);}
  assert.equal(receipt.native_change_evidence.source_instruction_and_effectiveness_context.text,f.nativeEvidence.raw.source_instruction_and_effectiveness_context.text);
  await assert.rejects(assertNoUnresolvedSourceIssues(f.root,f.nativeSource.sha256),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);const unrelated=await f.extraction('native-unrelated-new-source');await assert.rejects(assertNoUnresolvedSourceIssues(f.root,unrelated.source.sha256),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
});

for(const [name,mutate] of [
  ['first duplicate outside the actual raw interval',f=>{f.nativeEvidence.raw.actual_read_ranges=f.nativeEvidence.raw.actual_read_ranges.filter((_,index)=>index!==1);}],
  ['a normalized metadata-only check with no actual reading',f=>{f.nativeEvidence.normalized.actual_read_ranges=[];}],
  ['an incorrect normalized duplicate coordinate',f=>{f.nativeEvidence.occurrences[1].normalized_occurrence=f.nativeEvidence.occurrences[0].normalized_occurrence;}],
  ['a duplicated raw coordinate',f=>{f.nativeEvidence.occurrences[1].raw_occurrence=f.nativeEvidence.occurrences[0].raw_occurrence;}],
  ['an unread instruction/effectiveness context',f=>{f.nativeEvidence.raw.actual_read_ranges=f.nativeEvidence.raw.actual_read_ranges.slice(1);}],
  ['a changed snippet hash',f=>{f.nativeEvidence.occurrences[0].raw_occurrence.sha256='0'.repeat(64);}],
  ['a changed normalized artifact SHA',f=>{f.nativeEvidence.normalized.sha256='0'.repeat(64);}],
  ['a changed cache binding',f=>{f.nativeEvidence.cache.sha256='0'.repeat(64);}],
  ['another affected parent',f=>{f.nativeEvidence.occurrences[0].affected_parent_reference=f.nativeEvidence.sampled_parent;}],
  ['a false full governing-parent claim',f=>{f.nativeEvidence.governing_parent_fully_read=true;}],
  ['a derived clean operative version',f=>{f.nativeEvidence.clean_operative_version_derived=true;}],
  ['verified effectiveness',f=>{f.nativeEvidence.effectiveness_conditions_verified=true;}],
  ['a sampled span promoted from reference-only',f=>{f.nativeEvidence.sampled_parent.scope='GOVERNING_PARENT';}],
  ['a false literal context association',f=>{f.nativeEvidence.occurrences[1].context_anchor=f.nativeEvidence.occurrences[0].context_anchor;}],
  ['a changed supporting technical artifact',f=>{f.nativeEvidence.supporting_technical_artifacts[0].bytes++;}],
])test(`native-change finding refuses ${name}`,async t=>{
  const f=await nativeFixture(t);mutate(f);await rewrite(f.root,f.nativeRef.path,f.nativeEvidence);await assert.rejects(f.registerNative());
});

test('native instruction/occurrence snippets cannot be assembled across adjacent actual output intervals',async t=>{
  const f=await nativeFixture(t),range=f.nativeEvidence.raw.actual_read_ranges[1],cut=Math.floor((range[0]+range[1])/2);f.nativeEvidence.raw.actual_read_ranges.splice(1,1,[range[0],cut],[cut,range[1]]);await rewrite(f.root,f.nativeRef.path,f.nativeEvidence);await assert.rejects(f.registerNative(),/fit one actual reading interval/);
});

test('every native resolution path remains closed, including ordinary boundary, literal-only, qualification and invented dedicated replays',async t=>{
  const f=await nativeFixture(t),issue=await f.registerNative(),target=await f.extraction('native-closed-resolution');
  for(const kind of ['ordinary','literal-only','qualification','invented-native-replay']){
    const value={schema:kind==='invented-native-replay'?'native-change-issue-replay-v1':'source-issue-replay-v1',issue:{path:issue.path,sha256:issue.sha256},extraction_manifest:target.manifest,contract_id:contractId,parent:{...target.parent,actual_read_ranges:[[0,target.parent.end]]},raw:{path:'raw/contract.txt',sha256:sha256(f.sourceRaw),actual_read_ranges:[[0,f.sourceRaw.length]]},reviewer:'Declared synthetic author',reading:'FULL_PARENT_AND_RELEVANT_SOURCE',repair_adequate:true,unresolved_material_loss:false,material_loss_observed:false,reason:'Declared synthetic claim that retaining both plain numeric values alone repairs the markup loss.',authority:'NONE',...(kind==='qualification'?{review_mode:qualifiedMode,newly_read_current_version:false,prior_actual_replay:{path:'missing-origin.json',sha256:'0'.repeat(64),bytes:1}}:{}),...(kind==='literal-only'?{required_preserved_literals:['1.00','0.75']}:{}),...(kind==='invented-native-replay'?{native_annotations:{claimed:true}}:{})};
    const replay=await writeJSON(f.root,'replays/native-'+kind+'.json',value);await assert.rejects(resolveObservedSourceIssue(f.root,{issuePath:issue.path,issueSHA:issue.sha256,replayPath:replay.path,replaySHA:replay.sha256}),/NATIVE_CHANGE_RESOLUTION_NOT_SUPPORTED/);
  }
  await assert.rejects(assertNoUnresolvedSourceIssues(f.root,target.source.sha256),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
});

// These are newly authored DECLARED_SYNTHETIC readings. The only external
// inputs are the already pinned local tokenizer artifacts, never a corpus text.
async function nativeReplayFixture(t){
  const f=await nativeFixture(t),issue=await f.registerNative();
  const recipe=JSON.parse(await readFile(new URL('../recipe.json',import.meta.url),'utf8'));recipe.extraction.maxUnitWords=40;
  await writeJSON(f.root,'recipe.json',recipe);
  const names=['source-decoration.mjs','sections.mjs'],files=[];for(const path of names)files.push({path,sha256:sha256(await readFile(new URL(`../lib/${path}`,import.meta.url)))});
  files.push({path:'../comparison-recipe.json',sha256:sha256(await readFile(new URL('../comparison-recipe.json',import.meta.url)))});
  const body={data_classification:'DECLARED_SYNTHETIC',parameters:{extraction:recipe.extraction,native_input_profile:{baseline_embedding:recipe.embedding}},files},source={...body,sha256:digest(body)};
  const record={id:contractId,path:'raw/contract.txt',cohort:'discovery-broad',format:'html',acquisition:{sha256:sha256(f.sourceRaw),bytes:Buffer.byteLength(f.sourceRaw)}};
  const fresh=extractSections({...record,content:f.sourceRaw},{...recipe.extraction,nativeDecorationIdentity:{tracerSourceSHA256:files[0].sha256,collectorSourceSHA256:files[1].sha256}});
  assert.equal(fresh.status,'accepted');assert.equal(fresh.native_source_decorations.mapping_status,'EXACT_COLLECTOR_ORIGIN');
  const envelope=fresh.native_source_decorations,native=await storeNativeDecoration(f.root,'native/current.json.gz',envelope);
  const cached={...fresh,native_source_decorations:native.reference,raw_sha256:sha256(f.sourceRaw),source},cache=await writeJSON(f.root,'cache/current-native.json',cached);
  await writeFile(join(f.root,'normalized/current-native.txt'),fresh.normalized_text);const normalized={path:'normalized/current-native.txt',...await hashFile(join(f.root,'normalized/current-native.txt'))};
  const manifest=await writeJSON(f.root,'extraction/current-native.json',{source,contract_records:[{id:contractId,status:'accepted',raw_sha256:sha256(f.sourceRaw),normalized_path:normalized.path,normalized_sha256:normalized.sha256,native_source_decorations:native.reference}],cache:[{id:contractId,...cache,source_sha256:source.sha256,result_sha256:digest(cached)}]});
  const modelPath=process.env.NONVERBA_TEST_SECOND_MODEL_MANIFEST??`${STUDY_BASE}/20261013-study-15000/comparison-model.json`,modelBytes=await readFile(modelPath);
  assert.equal(sha256(modelBytes),'a53b0d7e1bb1e1ba69606861b6b55f2584eea929f162bd850a831367c680cd04');
  const second_model_manifest=await writeJSON(f.root,'models/second.json',JSON.parse(modelBytes));
  const parent=fresh.sections.find(parent=>parent.start<=fresh.units[0].start&&parent.end>=fresh.units[0].end);
  const parentRef={id:parent.id,start:parent.start,end:parent.end,sha256:parent.sha256},rawRef={path:'raw/contract.txt',...await hashFile(join(f.root,'raw/contract.txt'))};
  const options={issuePath:issue.path,issueSHA:issue.sha256,extraction_manifest:manifest,parent:parentRef,raw:rawRef,second_model_manifest};
  const machine=await prepareNativeChangeReplayEvidence(f.root,options),mechanical=await writeJSON(f.root,'replays/native-mechanical.json',machine.mechanical_verification),readiness=await writeJSON(f.root,'replays/native-readiness.json',machine.input_readiness);
  const scope={governing_parent_fully_read:false,whole_original_document_read:false,effectiveness_conditions_verified:false,clean_operative_version_derived:false,human:false,authority:'NONE'},view=createNativeDecorationView(envelope,{raw:f.sourceRaw,normalizedText:fresh.normalized_text});
  const read_outputs=[];
  for(const occurrence of [...machine.mechanical_verification.occurrences,{id:'instruction-context',raw_context:machine.mechanical_verification.instruction_context}]){
    const rawRange=occurrence.raw_context,range=occurrence.normalized_context,projection=range?view.project({start:range.start,end:range.end,includeEndZeroWidth:true}):null;
    const output={schema:'native-change-actual-read-output-v1',id:occurrence.id,cache_ref:machine.binding.cache,envelope_sha256:envelope.sha256,reader_source_sha256:machine.binding.method.find(file=>file.path==='source-issues.mjs').sha256,actual_reading:false,raw:{path:rawRef.path,sha256:rawRef.sha256,range:{start:rawRange.start,end:rawRange.end},text:f.sourceRaw.slice(rawRange.start,rawRange.end)},...(range?{normalized:{path:normalized.path,sha256:normalized.sha256,range:{start:range.start,end:range.end},text:fresh.normalized_text.slice(range.start,range.end)},projection:{range:projection.range,sha256:digest(projection),value:projection}}:{})};
    read_outputs.push(await writeJSON(f.root,`replays/read-${occurrence.id}.json`,output));
  }
  const readRef=id=>read_outputs.find(ref=>ref.path===`replays/read-${id}.json`),instruction=machine.mechanical_verification.instruction_context;
  const review={schema:'native-change-actual-bounded-review-v1',review_mode:'NEW_ACTUAL_BOUNDED_NATIVE_CHANGE_REVIEW',newly_read_current_version:true,binding:machine.binding,reviewer:'Declared synthetic fixture author',mechanical_verification:mechanical,input_readiness:readiness,repair_adequate:true,unresolved_material_loss:false,material_loss_observed:false,reason:'Declared synthetic bounded reading retains literal native tag distinctions and their separate source occurrences.',remaining_unknowns:'No whole governing parent, operative version, legal effect or effectiveness conditions have been verified.',...scope,read_outputs,read_outputs_actually_displayed_and_read:true,instruction_read_output:readRef('instruction-context'),raw_actual_read_ranges:[[instruction.start,instruction.end]],occurrences:machine.mechanical_verification.occurrences.map(row=>({id:row.id,raw_occurrence:row.raw_occurrence,normalized_occurrence:row.normalized_occurrence,normalized_context:row.normalized_context,projection:row.projection,read_output:readRef(row.id),raw_actual_read_ranges:[[row.raw_context.start,row.raw_context.end]],normalized_actual_read_ranges:[[row.normalized_context.start,row.normalized_context.end]],projection_actual_read_ranges:[[row.normalized_context.start,row.normalized_context.end]],adequate:true,reason:'Both literal native tags and values retain distinct raw origins in the displayed bounded source projection.',remaining_unknowns:'Governing hierarchy and effectiveness of these literal changes remain unverified outside this bounded reading.'}))};
  const actual=await writeJSON(f.root,'replays/native-actual.json',review);
  const replay={schema:'native-change-issue-replay-v1',review_mode:review.review_mode,newly_read_current_version:true,issue:{path:issue.path,sha256:issue.sha256},contract_id:contractId,extraction_manifest:manifest,parent:parentRef,raw:rawRef,second_model_manifest,binding:machine.binding,reviewer:review.reviewer,mechanical_verification:mechanical,input_readiness:readiness,actual_review:actual,repair_adequate:true,unresolved_material_loss:false,material_loss_observed:false,...scope};
  const replayRef=await writeJSON(f.root,'replays/native-dedicated.json',replay);
  async function resolve(){return resolveObservedSourceIssue(f.root,{issuePath:issue.path,issueSHA:issue.sha256,replayPath:replayRef.path,replaySHA:(await hashFile(join(f.root,replayRef.path))).sha256});}
  async function changeArtifact(key,value){await rewrite(f.root,replay[key].path,value);replay[key]={path:replay[key].path,...await hashFile(join(f.root,replay[key].path))};await rewrite(f.root,replayRef.path,replay);}
  return {...f,issue,fresh,cached,envelope,source,cache,manifest,normalized,options,machine,review,replay,replayRef,resolve,changeArtifact};
}

test('dedicated native replay recomputes exact raw origins and all four production tokenizer window plans, then retains bounded review scope',async t=>{
  const f=await nativeReplayFixture(t);assert.deepEqual(f.machine.input_readiness.arms.map(arm=>arm.id),['baseline-heading-unit','baseline-parent-context','second-model-heading-unit','lexical-heading-unit']);
  const [first,second]=f.machine.mechanical_verification.occurrences;assert.notEqual(first.marks[0].runs[0].raw.start,second.marks[0].runs[0].raw.start);assert.notEqual(first.normalized_occurrence.start,second.normalized_occurrence.start);
  for(const arm of f.machine.input_readiness.arms)for(const unit of arm.units){assert.equal(unit.input.native_evidence_status,'BOUND_NATIVE_SOURCE_EVIDENCE');assert(unit.input.windows.every(window=>window.tokens<=256&&window.source_ranges.length));assert.equal(unit.input.native_representation.parts.some(part=>part.role==='literal_heading_part'),unit.heading_status==='LITERAL_SOURCE_PARTS_INCLUDED');assert(unit.input.windows.some(window=>window.source_ranges.some(range=>range.role===unit.body_role)));}
  const result=await f.resolve();assert.equal(result.source_sha256,f.source.sha256);const held=await assertNoUnresolvedSourceIssues(f.root,f.source.sha256);assert.equal(held.resolved,1);const receipt=await readJSON(f.root,result.path);assert.equal(receipt.native.newly_read_current_version,true);assert.equal(receipt.native.governing_parent_fully_read,false);assert.equal(receipt.native.whole_original_document_read,false);
  const changed=structuredClone(f.review);changed.occurrences[1].adequate=false;await rewrite(f.root,f.replay.actual_review.path,changed);await assert.rejects(assertNoUnresolvedSourceIssues(f.root,f.source.sha256),/artifact bytes differ|binding changed|binding differs/i);
});

test('native dedicated replay rejects rehashed incomplete arms, inflated token counts, false reading claims and qualification bypass',async t=>{
  const f=await nativeReplayFixture(t),original=structuredClone(f.replay),actual=structuredClone(f.review),ready=structuredClone(f.machine.input_readiness);
  for(const [name,mutate]of [
    ['missing arm',value=>value.arms.pop()],
    ['plain-only arm',value=>{value.arms[3].units[0].input.native_evidence_status='LEGACY_NATIVE_EVIDENCE_UNAVAILABLE';}],
    ['token overflow',value=>{value.arms[0].units[0].input.windows[0].tokens=257;}],
    ['dropped marked source role',value=>{value.arms[1].units[0].input.windows[0].source_ranges=[];}],
  ]){await t.test(name,async()=>{const value=structuredClone(ready);mutate(value);await f.changeArtifact('input_readiness',value);await assert.rejects(f.resolve(),/readiness artifact differs/);});}
  await rewrite(f.root,original.input_readiness.path,ready);Object.assign(f.replay,structuredClone(original));
  for(const [name,mutate]of [
    ['unread second occurrence',value=>{value.occurrences[1].normalized_actual_read_ranges=[];}],
    ['unread instruction',value=>{value.raw_actual_read_ranges=[];}],
    ['machine output promoted to actual reading',value=>{value.read_outputs_actually_displayed_and_read=false;}],
    ['missing displayed output',value=>{value.read_outputs.pop();}],
    ['whole document claim',value=>{value.whole_original_document_read=true;}],
    ['false effectiveness',value=>{value.effectiveness_conditions_verified=true;}],
    ['duplicate occurrence association',value=>{value.occurrences[1]=structuredClone(value.occurrences[0]);}],
  ]){await t.test(name,async()=>{const value=structuredClone(actual);mutate(value);await f.changeArtifact('actual_review',value);await assert.rejects(f.resolve());});}
  await rewrite(f.root,original.actual_review.path,actual);Object.assign(f.replay,structuredClone(original));
  f.replay.review_mode=qualifiedMode;f.replay.newly_read_current_version=false;f.replay.prior_actual_replay={path:'invented.json',sha256:'0'.repeat(64),bytes:1};await rewrite(f.root,f.replayRef.path,f.replay);await assert.rejects(f.resolve(),/NATIVE_CHANGE_RESOLUTION_NOT_SUPPORTED/);
  await assert.rejects(assertNoUnresolvedSourceIssues(f.root,f.source.sha256),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
});

test('native evidence rebuild rejects consistently resealed forged envelopes, duplicate-origin swaps, stale methods and gzip tampering',async t=>{
  const f=await nativeReplayFixture(t),manifest=await readJSON(f.root,f.manifest.path);
  const seal=value=>{const {sha256:ignored,...body}=value;return {...body,sha256:digest(body)};};
  for(const [name,mutate]of [
    ['forged literal source tag',value=>{value.trace.sources.find(mark=>mark.native_tag==='strike').native_tag='u';}],
    ['missing native mark',value=>{value.trace.sources.find(mark=>mark.native_tag==='strike').native_tag=null;}],
    ['swapped duplicate text origins',value=>{const marked=value.segments.filter(segment=>segment.sources.some(origin=>value.trace.runs.find(run=>run.id===origin.run_id)?.decoded_text==='1.00'));assert.equal(marked.length,2);[marked[0].sources,marked[1].sources]=[marked[1].sources,marked[0].sources];}],
  ]){await t.test(name,async()=>{const forged=structuredClone(f.envelope);mutate(forged);forged.trace=seal(forged.trace);const native=await storeNativeDecoration(f.root,`native/forged-${name.replace(/ /gu,'-')}.json.gz`,seal(forged));
    const cache={...f.cached,native_source_decorations:native.reference};await rewrite(f.root,f.cache.path,cache);const cacheRef={path:f.cache.path,...await hashFile(join(f.root,f.cache.path))},next=structuredClone(manifest);next.contract_records[0].native_source_decorations=native.reference;next.cache[0]={...next.cache[0],...cacheRef,result_sha256:digest(cache)};await rewrite(f.root,f.manifest.path,next);
    const options={...f.options,extraction_manifest:{path:f.manifest.path,...await hashFile(join(f.root,f.manifest.path))}};
    await assert.rejects(prepareNativeChangeReplayEvidence(f.root,options),/independently recomputed raw-source extraction/);
  });}
  await rewrite(f.root,f.cache.path,f.cached);await rewrite(f.root,f.manifest.path,manifest);
  const stale=structuredClone(f.cached);stale.source.files[0].sha256='0'.repeat(64);const {sha256:ignored,...sourceBody}=stale.source;stale.source.sha256=digest(sourceBody);await rewrite(f.root,f.cache.path,stale);
  const staleManifest=structuredClone(manifest);staleManifest.source=stale.source;staleManifest.cache[0]={...staleManifest.cache[0],...await hashFile(join(f.root,f.cache.path)),source_sha256:stale.source.sha256,result_sha256:digest(stale)};await rewrite(f.root,f.manifest.path,staleManifest);
  await assert.rejects(prepareNativeChangeReplayEvidence(f.root,{...f.options,extraction_manifest:{path:f.manifest.path,...await hashFile(join(f.root,f.manifest.path))}}),/method identity differs/);
  await rewrite(f.root,f.cache.path,f.cached);await rewrite(f.root,f.manifest.path,manifest);
  const gzipPath=join(f.root,f.cached.native_source_decorations.artifact.path),bytes=await readFile(gzipPath);bytes[Math.floor(bytes.length/2)]^=1;await writeFile(gzipPath,bytes);
  await assert.rejects(prepareNativeChangeReplayEvidence(f.root,f.options),/compressed digest differs/);
});

test('native actual reading cannot be replaced by a rehashed fabricated displayed projection',async t=>{
  const f=await nativeReplayFixture(t),ref=f.review.read_outputs[0],output=await readJSON(f.root,ref.path);output.projection.value.annotations[0].marks[0].native_tag='ins';await rewrite(f.root,ref.path,output);
  const changed={path:ref.path,...await hashFile(join(f.root,ref.path))};f.review.read_outputs[0]=changed;f.review.occurrences[0].read_output=changed;await f.changeArtifact('actual_review',f.review);
  await assert.rejects(f.resolve(),/displayed projection output differs/);
});

test('native input readiness cannot change model-window settings inside an old extraction namespace',async t=>{
  const f=await nativeReplayFixture(t),recipe=await readJSON(f.root,'recipe.json');
  recipe.embedding.overlap_words=(recipe.embedding.overlap_words??16)+1;await rewrite(f.root,'recipe.json',recipe);
  await assert.rejects(prepareNativeChangeReplayEvidence(f.root,f.options),/baseline model-input profile/);
});

test('native registry snapshots survive unrelated appended findings while each additional issue still holds the global gate',async t=>{
  const f=await nativeReplayFixture(t),resolution=await f.resolve();
  const laterEvidence=await writeJSON(f.root,'findings/another-native.json',{...f.nativeEvidence,finding:'Another declared synthetic bounded native observation independently requires its own actual review receipt.'});
  const later=await registerObservedSourceIssue(f.root,{evidencePath:laterEvidence.path,evidenceSHA:laterEvidence.sha256});
  assert.notEqual(later.path,f.issue.path);
  const retained=await prepareNativeChangeReplayEvidence(f.root,{...f.options,registrySnapshot:f.machine.binding.observed_issues});assert.deepEqual(retained.binding,f.machine.binding);
  await assert.rejects(assertNoUnresolvedSourceIssues(f.root,f.source.sha256),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);
  assert.equal((await readJSON(f.root,resolution.path)).native.binding.observed_issues.length,1);
  await assert.rejects(f.resolve(),/replay binding differs/);
});
