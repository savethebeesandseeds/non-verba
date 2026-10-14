// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdir,writeFile,rm} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
import {sha256} from '../../lib/common.mjs';import {STUDY_BASE,hashFile,writeJSON,validateStudyRoot} from '../lib/store.mjs';import {readAuditSource,locateAuditRaw} from '../lib/audit-reader.mjs';
test('coding source reader cannot expose nested inferred labels and verifies exact slices',async t=>{
  const run=`${STUDY_BASE}/reader-test-${randomUUID()}`;await mkdir(run,{recursive:true});const text='1. Delivery\nThe Operator shall deliver unless the Requester changes the specification.';
  validateStudyRoot(run);t.after(async()=>{validateStudyRoot(run);await rm(run,{recursive:true,force:true});});
  await writeFile(`${run}/normalized.txt`,text);await writeFile(`${run}/raw.html`,`<p>${text}</p>`);const cache={normalized_text:text,sections:[{id:'parent',heading:'PRIVATE_MACHINE_HEADING',heading_path:['PRIVATE_MACHINE_HEADING'],units:[{function_tags:['PRIVATE_FUNCTION_TAG_FIXTURE']}]}]};await writeJSON(run,'cache.json',cache);
  const row={id:'unit',audit_id:'coding-0001',contract_id:'synthetic',parent:{id:'parent',start:0,end:text.length,sha256:sha256(text),normalized_path:'normalized.txt'},lineage:{raw_path:'raw.html',raw_sha256:(await hashFile(`${run}/raw.html`)).sha256,normalized_path:'normalized.txt',normalized_sha256:sha256(text),cache_path:'cache.json',cache_sha256:(await hashFile(`${run}/cache.json`)).sha256,source_url:'https://example.invalid/synthetic'}};
  await writeJSON(run,'coding.json',{purpose:'coding',rows:[row]});const result=await readAuditSource(run,'coding.json','coding-0001',{limit:20});assert.equal(result.text,text.slice(0,20));assert.equal(result.range.next_offset,20);assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);
  assert.equal(result.source_scope,'EXTRACTED_FLAT_SPAN');assert.equal(result.semantic_completeness,'UNVERIFIED_REQUIRES_ORIGINAL_SOURCE_READING');
  await assert.rejects(readAuditSource(run,'coding.json','coding-0001',{showProposedHeading:true}),/forbids/);await assert.rejects(readAuditSource(run,'coding.json','coding-0001',{offset:text.length+1}),/beyond/);
});

// DECLARED_SYNTHETIC snippets; a locator result never counts as a reading.
async function locatorFixture(t,{text='The Operator shall deliver.',raw}={}){
  const run=`${STUDY_BASE}/reader-test-${randomUUID()}`;validateStudyRoot(run);await mkdir(run,{recursive:true});t.after(async()=>{validateStudyRoot(run);await rm(run,{recursive:true,force:true});});raw=raw??`<p>${text}</p>`;
  await writeFile(`${run}/normalized.txt`,text);await writeFile(`${run}/raw.html`,raw);await writeJSON(run,'cache.json',{normalized_text:text,sections:[{id:'parent',heading:'PRIVATE_MACHINE_HEADING',units:[{function_tags:['PRIVATE_FUNCTION_TAG_FIXTURE']}]}]});
  const row={id:'unit',audit_id:'coding-0001',contract_id:'synthetic',parent:{id:'parent',start:0,end:text.length,sha256:sha256(text),normalized_path:'normalized.txt'},lineage:{raw_path:'raw.html',raw_sha256:sha256(raw),normalized_path:'normalized.txt',normalized_sha256:sha256(text),cache_path:'cache.json',cache_sha256:(await hashFile(`${run}/cache.json`)).sha256},PRIVATE_METADATA:{function_tags:['PRIVATE_ROW_TAG']}};
  await writeJSON(run,'coding.json',{purpose:'coding',PRIVATE_PACKET_LABEL:'PRIVATE_PACKET_LABEL',rows:[row]});return {run,text,raw};
}
function exactSlices(result,raw){for(const match of result.matches){assert.equal(match.text,raw.slice(match.range.start,match.range.end));assert.ok(match.range.start>=0&&match.range.end<=raw.length);assert.ok(match.match.start<match.match.end);}}

test('literal locator tolerates HTML tag, whitespace and nbsp interruptions while returning exact raw markup',async t=>{
  const phrase='The Operator shall deliver (item A+B).',raw='<p>The <span title="a > b">Oper</span>ator&nbsp;shall &#160;de<b>li</b>ver (item A+B).</p>',{run}=await locatorFixture(t,{text:phrase,raw});
  const result=await locateAuditRaw(run,'coding.json','coding-0001',{phrase,before:0,after:0});assert.equal(result.returned_matches,1);assert.equal(result.matches[0].text,raw.slice(3,-4));assert.equal(result.raw.sha256,sha256(raw));assert.equal(result.packet.sha256,(await hashFile(`${run}/coding.json`)).sha256);assert.equal(result.reading_status,'NOT_READ_BY_LOCATOR');assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);exactSlices(result,raw);
});

test('duplicate occurrences report ambiguity and a bounded extra-match lower bound without an operative claim',async t=>{
  const phrase='Notice of termination',raw=`<nav>${phrase}</nav><p>${phrase}</p><h2>${phrase}</h2><p>${phrase}</p>`,{run}=await locatorFixture(t,{text:phrase,raw});
  const result=await locateAuditRaw(run,'coding.json','coding-0001',{phrase,maxMatches:2});assert.equal(result.returned_matches,2);assert.equal(result.match_count_at_least,3);assert.equal(result.more_matches_exist,true);assert.equal(result.ambiguous,true);assert.match(result.operative_match,/table-of-contents.*not automatically operative/);exactSlices(result,raw);
});

test('a phrase outside the extracted span is refused even if it appears in raw source',async t=>{
  const {run}=await locatorFixture(t,{text:'The Operator delivers the equipment.',raw:'<p>The Operator delivers the equipment.</p><p>Unrelated arbitration clause.</p>'});await assert.rejects(locateAuditRaw(run,'coding.json','coding-0001',{phrase:'Unrelated arbitration clause'}),/absent from the hash-verified extracted span/);
});

test('no literal raw match reports shortage without normalizing or substituting visible source words',async t=>{
  const {run}=await locatorFixture(t,{text:'A+B (cost) requires consent.',raw:'<p>AAB (cost) requires consent. A<strong>extra text</strong>+B (cost).</p>'});const result=await locateAuditRaw(run,'coding.json','coding-0001',{phrase:'A+B (cost)'});assert.equal(result.status,'NOT_FOUND');assert.equal(result.returned_matches,0);assert.equal(result.candidate_shortage,3);assert.deepEqual(result.matches,[]);
});

test('corrupted raw and normalized source cannot be used for location',async t=>{
  const {run}=await locatorFixture(t);await writeFile(`${run}/raw.html`,'Changed synthetic raw content.');await assert.rejects(locateAuditRaw(run,'coding.json','coding-0001',{phrase:'The Operator shall deliver'}),/Raw source binding differs/);await assert.rejects(readAuditSource(run,'coding.json','coding-0001',{source:'raw'}),/Raw source binding differs/);
  await writeFile(`${run}/normalized.txt`,'Changed synthetic normalized content.');await assert.rejects(locateAuditRaw(run,'coding.json','coding-0001',{phrase:'The Operator shall deliver'}),/Normalized source binding differs/);
});

test('large escaped context and long inline tags remain bounded exact source slices',async t=>{
  const phrase='Consent is required.',context='"\\\n'.repeat(15000),raw=`${context}<p>Consent <span title="${'x'.repeat(25000)}">is</span> required.</p>${context}`,{run}=await locatorFixture(t,{text:phrase,raw});const result=await locateAuditRaw(run,'coding.json','coding-0001',{phrase,before:20000,after:20000,maxMatches:3});assert.equal(result.returned_matches,1);assert.ok(JSON.stringify(result).length<=20000);assert.equal(result.matches[0].range.complete_match_in_slice,false);assert.equal(result.matches[0].range.requested_context_complete,false);assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);exactSlices(result,raw);
});

test('phrase whitespace normalization is literal, case-sensitive and bounded',async t=>{
  const {run}=await locatorFixture(t,{text:'The Operator\n\tshall deliver.',raw:'<p>The Operator&#xA0;shall deliver.</p>'});const result=await locateAuditRaw(run,'coding.json','coding-0001',{phrase:'The Operator  shall deliver.'});assert.equal(result.returned_matches,1);
  await assert.rejects(locateAuditRaw(run,'coding.json','coding-0001',{phrase:'the Operator shall deliver.'}),/absent/);
  for(const options of [{phrase:'ab'},{phrase:' '.repeat(3)},{phrase:'a'.repeat(201)},{phrase:'The Operator',maxMatches:4},{phrase:'The Operator',before:20001},{phrase:'The Operator',after:-1}])await assert.rejects(locateAuditRaw(run,'coding.json','coding-0001',options),/Literal parent phrase|Explicit bounded/);
});
