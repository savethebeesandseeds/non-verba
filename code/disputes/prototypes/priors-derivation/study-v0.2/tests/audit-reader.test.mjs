// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdir,writeFile,rm} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
import {sha256,digest} from '../../lib/common.mjs';import {STUDY_BASE,hashFile,writeJSON,validateStudyRoot,writeExtractionCache} from '../lib/store.mjs';import {readAuditSource,locateAuditRaw} from '../lib/audit-reader.mjs';
import {extractSections} from '../lib/sections.mjs';
import {traceNativeDecoration,bindNativeDecoration} from '../lib/source-decoration.mjs';
import {storeNativeDecoration} from '../lib/native-decoration-store.mjs';

// DECLARED_SYNTHETIC source; navigation does not judge its contractual meaning.
async function navigationFixture(t,{legacy=false}={}){
  const run=`${STUDY_BASE}/reader-test-${randomUUID()}`;validateStudyRoot(run);await mkdir(run,{recursive:true});t.after(async()=>{validateStudyRoot(run);await rm(run,{recursive:true,force:true});});
  const raw='1. Duties. The Operator shall perform the agreed work (unless notified.\n\n2. Notice. The Requester shall notify in writing.\n\n3. Payment. The Requester shall pay10units within30days, except that a disputed charge is withheld.';
  const cache=extractSections({id:'navigation-reader-synthetic',source_url:'https://example.invalid/synthetic',content:raw,format:'text'},{maxChunkWords:20});
  const parent=cache.sections[0],unit=parent.units[1];
  if(legacy)delete parent.source_navigation_anchors;
  else for(const anchor of parent.source_navigation_anchors){anchor.PRIVATE_NESTED_FIELD='PRIVATE_NAVIGATION_FIELD';anchor.source_evidence.PRIVATE_INFERRED_LABEL='PRIVATE_FUNCTION_LABEL';}
  cache.PRIVATE_MACHINE_TAG='PRIVATE_MACHINE_TAG';unit.function_tags=['PRIVATE_FUNCTION_TAG'];
  await writeFile(`${run}/normalized.txt`,cache.normalized_text);await writeFile(`${run}/raw.txt`,raw);await writeJSON(run,'cache.json',cache);
  const row={id:unit.id,audit_id:'development-0001',contract_id:cache.contract.id,excerpt:{start:unit.start,end:unit.end},parent:{id:parent.id,start:parent.start,end:parent.end,sha256:parent.sha256,normalized_path:'normalized.txt'},lineage:{raw_path:'raw.txt',raw_sha256:sha256(raw),normalized_path:'normalized.txt',normalized_sha256:cache.normalized_sha256,cache_path:'cache.json',cache_sha256:(await hashFile(`${run}/cache.json`)).sha256,source_url:'https://example.invalid/synthetic'}};
  await writeJSON(run,'development.json',{purpose:'development',rows:[row]});await writeJSON(run,'coding.json',{purpose:'coding',rows:[{...row,audit_id:'coding-0001'}]});return {run,cache,parent,unit,row};
}

test('requested focal literal navigation is separately projected from a stale broad parent heading',async t=>{
  const {run,cache,unit}=await navigationFixture(t);
  const result=await readAuditSource(run,'development.json','development-0001',{offset:0,limit:20,showProposedHeading:true});
  assert.equal(result.proposed_heading.text,'1. Duties.');assert.equal(result.source_navigation.nearest_anchor.label,'3. Payment.');
  assert.equal(result.source_navigation.governing_hierarchy_verified,false);assert.equal(result.source_navigation.scope,'LITERAL_SOURCE_NAVIGATION_ONLY');
  assert.deepEqual(result.source_navigation.range,{start:unit.start,end:unit.end,offset_basis:'UTF16_IN_NORMALIZED_TEXT'});
  assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);
  for(const anchor of result.source_navigation.within_unit)for(const part of anchor.parts)assert.equal(cache.normalized_text.slice(part.start,part.end),part.text);
  const raw=await readAuditSource(run,'development.json','development-0001',{source:'raw',limit:20,showProposedHeading:true});assert.deepEqual(raw.source_navigation,result.source_navigation);
});

test('compressed cache reader retains native projections, literal navigation and rejected-source fallback',async t=>{
  const f=await navigationFixture(t),before=await readAuditSource(f.run,'development.json','development-0001',{limit:200,showProposedHeading:true,nativeDecorations:'all'}),name='extraction-cache/navigation-reader-synthetic.json.gz',stored=await writeExtractionCache(f.run,name,f.cache);
  await writeJSON(f.run,name+'.manifest.json',{...stored.artifact,storage:stored.storage,result_sha256:digest(f.cache)});const row={...f.row,lineage:{...f.row.lineage,cache_path:name,cache_sha256:stored.artifact.sha256}};await writeJSON(f.run,'compressed.json',{purpose:'development',rows:[row]});
  const after=await readAuditSource(f.run,'compressed.json',row.audit_id,{limit:200,showProposedHeading:true,nativeDecorations:'all'});assert.equal(after.text,before.text);assert.deepEqual(after.source_navigation,before.source_navigation);assert.deepEqual(after.native_source_decorations,before.native_source_decorations);assert.equal(JSON.stringify(after).includes('PRIVATE_'),false);
  const rejected={...row,parent:{...row.parent,normalized_path:null},lineage:{...row.lineage,normalized_path:null}};await writeJSON(f.run,'compressed-rejected.json',{purpose:'source_integrity',rows:[rejected]});const fallback=await readAuditSource(f.run,'compressed-rejected.json',row.audit_id,{limit:200,nativeDecorations:'none'});assert.equal(fallback.text,before.text);
});

test('coding and ordinary source-only projection never expose the navigation cache or inferred labels',async t=>{
  const {run}=await navigationFixture(t);
  for(const packet of ['development.json','coding.json']){const id=packet.startsWith('coding')?'coding-0001':'development-0001';const result=await readAuditSource(run,packet,id,{limit:20});assert.equal(Object.hasOwn(result,'source_navigation'),false);assert.equal(Object.hasOwn(result,'proposed_heading'),false);assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);}
  await assert.rejects(readAuditSource(run,'coding.json','coding-0001',{showProposedHeading:true}),/Coding reader forbids/);
});

test('legacy cache reports navigation unavailable instead of inventing a local title from the broad heading',async t=>{
  const {run}=await navigationFixture(t,{legacy:true});const result=await readAuditSource(run,'development.json','development-0001',{limit:20,showProposedHeading:true});assert.equal(result.proposed_heading.text,'1. Duties.');assert.equal(result.source_navigation.status,'UNKNOWN_SOURCE_NAVIGATION_UNAVAILABLE_IN_CACHE');assert.equal(result.source_navigation.nearest_anchor,null);assert.deepEqual(result.source_navigation.within_unit,[]);
});

test('a hash-bound cache still cannot attach navigation text to different normalized source coordinates',async t=>{
  const {run,cache,row}=await navigationFixture(t);cache.sections[0].source_navigation_anchors[0].parts[0].text='Invented Caption';
  await writeJSON(run,'corrupt-cache.json',cache);await writeJSON(run,'corrupt-packet.json',{purpose:'development',rows:[{...row,lineage:{...row.lineage,cache_path:'corrupt-cache.json',cache_sha256:(await hashFile(`${run}/corrupt-cache.json`)).sha256}}]});
  await assert.rejects(readAuditSource(run,'corrupt-packet.json','development-0001',{limit:20,showProposedHeading:true}),/Literal navigation piece differs/);
});

test('focal navigation cannot escape a hash-bound parent or substitute another unit body',async t=>{
  const {run,cache,row}=await navigationFixture(t);cache.sections[0].units[1].text='Different unit body';
  await writeJSON(run,'corrupt-unit-cache.json',cache);await writeJSON(run,'corrupt-unit-packet.json',{purpose:'development',rows:[{...row,lineage:{...row.lineage,cache_path:'corrupt-unit-cache.json',cache_sha256:(await hashFile(`${run}/corrupt-unit-cache.json`)).sha256}}]});
  await assert.rejects(readAuditSource(run,'corrupt-unit-packet.json','development-0001',{limit:20,showProposedHeading:true}),/Navigation unit binding differs/);
});
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

test('coding source reading projects literal native edits from the exact current window without inferred labels',async t=>{
  const raw='<BODY style="font-size:10pt"><P><STRIKE>2.50</STRIKE><U>1.25</U> per item.</P></BODY>',text='2.501.25 per item.',{run}=await locatorFixture(t,{text,raw});
  const trace=traceNativeDecoration(raw);let end=0;
  const envelope=bindNativeDecoration(trace,{raw,normalizedText:text,tracerSourceSHA256:'a'.repeat(64),collectorSourceSHA256:'b'.repeat(64),collectorSegments:trace.runs.map(r=>{const start=end;end+=r.decoded_text.length;return {normalized_start:start,normalized_end:end,sources:[{run_id:r.id,decoded_start:0,decoded_end:r.decoded_text.length}],normalization:'EXACT_DECODED'};})});
  const {reference}=await storeNativeDecoration(run,'native/synthetic.json.gz',envelope);
  const cache={normalized_text:text,native_source_decorations:reference,PRIVATE_MACHINE_TAG:'PRIVATE_MACHINE_TAG',sections:[{id:'parent',heading:'PRIVATE_MACHINE_HEADING'}]};
  await writeJSON(run,'native-cache.json',cache);
  const row={id:'unit',audit_id:'coding-0001',contract_id:'synthetic',parent:{id:'parent',start:0,end:text.length,sha256:sha256(text),normalized_path:'normalized.txt'},lineage:{raw_path:'raw.html',raw_sha256:sha256(raw),normalized_path:'normalized.txt',normalized_sha256:sha256(text),cache_path:'native-cache.json',cache_sha256:(await hashFile(run+'/native-cache.json')).sha256}};
  await writeJSON(run,'native-coding.json',{purpose:'coding',rows:[row]});
  const result=await readAuditSource(run,'native-coding.json','coding-0001',{offset:4,limit:4});assert.equal(result.text,'1.25');
  const projected=result.native_source_decorations;assert.equal(projected.annotations.length,1);assert.equal(projected.annotations[0].text,'1.25');assert.deepEqual(projected.annotations[0].marks.map(m=>m.native_tag),['u']);assert.equal(projected.effectiveness_verified,false);assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);assert.equal(Object.hasOwn(result,'proposed_heading'),false);
  const all=await readAuditSource(run,'native-coding.json','coding-0001',{offset:4,limit:4,nativeDecorations:'all'});assert.ok(all.native_source_decorations.annotations[0].marks.some(m=>m.tag==='body'));assert.ok(!projected.annotations[0].marks.some(m=>m.tag==='body'));
  const omitted=await readAuditSource(run,'native-coding.json','coding-0001',{offset:4,limit:4,nativeDecorations:'none'});assert.equal(Object.hasOwn(omitted,'native_source_decorations'),false);
});
