// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PINNED_MODEL, embeddingWindows, nativeEmbeddingWindows, prepareEmbeddingInput, createPinnedTokenCounter, planWindowBatches, normalizeFloat32, embeddingCacheKey, createBatchEmbedder, embeddingWindowPolicy, NATIVE_WINDOW_LIMITS, NATIVE_WINDOW_PLANNER_POLICY } from '../lib/embedding.mjs';
import {traceNativeDecoration,bindNativeDecoration} from '../lib/source-decoration.mjs';
import {NATIVE_COLLECTOR_POLICY} from '../lib/sections.mjs';
import {createNativeSourceContext,createNativeRepresentation,nativeRepresentationWindow,modelInputIdentity,NAVIGATION_SCOPE} from '../lib/representation.mjs';

const wordTokens = text => (text.match(/\S+/gu) || []).length + 2;
function mockRuntime() {
  const calls = [];
  return { calls, model: { synthetic_runtime_id: 'positive-axis-window-fixture', execution_attested: false }, tokenCount: wordTokens,
    extractBatch: async texts => { calls.push(texts); return texts.map(text => text.startsWith('alpha') ? [1, 0] : [0, 1]); }, dispose: async () => {} };
}
async function cacheFixture(t) { const directory = await mkdtemp(path.join(os.tmpdir(), 'priors-embedding-test-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }
const norm = vector => Math.sqrt([...vector].reduce((sum, value) => sum + value ** 2, 0));

function nativeFixture(raw,{dropZeroWidth=false}={}) {
  const sha=value=>createHash('sha256').update(value).digest('hex'),trace=traceNativeDecoration(raw),mapped=trace.runs.map(run=>dropZeroWidth?run.decoded_text.replace(/[\u200B\uFEFF]/gu,''):run.decoded_text),normalizedText=mapped.join('');let offset=0;
  const envelope=bindNativeDecoration(trace,{raw,normalizedText,tracerSourceSHA256:'a'.repeat(64),collectorSourceSHA256:'b'.repeat(64),collectorSegments:trace.runs.map((run,index)=>{const start=offset;offset+=mapped[index].length;return {normalized_start:start,normalized_end:offset,sources:[{run_id:run.id,decoded_start:0,decoded_end:run.decoded_text.length}],normalization:mapped[index]===run.decoded_text?'EXACT_DECODED':'EXTRACTOR_NFC_FILTER_WHITESPACE_V1'};})});
  const parent={id:'synthetic-parent',contract_id:'synthetic-contract',cohort:'discovery-broad',start:0,end:normalizedText.length,sha256:sha(normalizedText)};
  const unit={id:'synthetic-unit',parent_section_id:parent.id,contract_id:parent.contract_id,cohort:parent.cohort,start:0,end:normalizedText.length,text:normalizedText,sha256:sha(normalizedText),source_navigation:{nearest_anchor:null,within_unit:[],scope:NAVIGATION_SCOPE,governing_hierarchy_verified:false},native_source_decorations_ref:{envelope_sha256:envelope.sha256,raw_sha256:envelope.raw.sha256,normalized_sha256:envelope.normalized.sha256,tracer_source_sha256:envelope.tracer_source_sha256,collector_source_sha256:envelope.collector_source_sha256,policy:envelope.policy,collector_policy:NATIVE_COLLECTOR_POLICY,start:0,end:normalizedText.length,mapping_status:envelope.mapping_status,input_eligibility:envelope.input_eligibility,projection_required:true}};
  const context=createNativeSourceContext({raw,normalizedText,envelope,expectedTracerSourceSHA256:'a'.repeat(64),expectedCollectorSourceSHA256:'b'.repeat(64)});
  unit.native_input=createNativeRepresentation(unit,{context,parent});return {unit,raw,trace,envelope,normalizedText,parent,context};
}

// These tiny synthetic counters declare exact range costs, not tokenizer evidence.
function rangeCounter(f,cost) {
  const offsets=[0];for(const point of f.normalizedText)offsets.push(offsets.at(-1)+point.length);
  const counts=new Map();for(let left=0;left<offsets.length-1;left++)for(let right=left+1;right<offsets.length;right++){
    const start=offsets[left],end=offsets[right],encoded=nativeRepresentationWindow(f.unit.native_input,{start,end}).text,tokens=cost(f.normalizedText.slice(start,end));
    if(counts.has(encoded))assert.equal(counts.get(encoded),tokens,'Fixture costs must agree for identical encoded inputs');counts.set(encoded,tokens);
  }
  const calls=[];return Object.assign(input=>{assert.ok(counts.has(input),'Only complete unchanged native range encodings may reach this counter');calls.push(input);return counts.get(input);},{calls});
}
function assertExactPartition(f,windows) {
  let cursor=0;for(const window of windows){assert.equal(window.source_utf16_start,cursor);cursor=window.source_utf16_end;
    const encoded=nativeRepresentationWindow(f.unit.native_input,{start:window.source_utf16_start,end:window.source_utf16_end});for(const[key,value]of Object.entries(encoded))assert.deepEqual(window[key],value);
    assert.ok(window.tokens<=256);assert.ok(window.source_utf16_end>window.source_utf16_start);
  }
  assert.equal(cursor,f.normalizedText.length);assert.equal(windows.map(w=>f.normalizedText.slice(w.source_utf16_start,w.source_utf16_end)).join(''),f.normalizedText);
  assert.equal(windows.reduce((n,w)=>n+w.weight,0),Array.from(f.normalizedText).length);
}

test('measured complete-word windows cover every word and weight new words once', () => {
  const words = Array.from({ length: 17 }, (_, index) => `word${index}`);
  const windows = embeddingWindows(words.join('\n '), wordTokens, { maxTokens: 8, overlapWords: 2 });
  const covered = new Set();
  for (const window of windows) {
    assert.ok(window.tokens <= 8); assert.equal(window.tokens, wordTokens(window.text));
    for (let index = window.word_start; index < window.word_end; index++) covered.add(index);
    assert.equal(window.text, words.slice(window.word_start, window.word_end).join(' '));
    assert.ok(window.weight > 0);
  }
  assert.equal(covered.size, words.length); assert.equal(windows.reduce((sum, window) => sum + window.weight, 0), words.length);
  assert.throws(() => embeddingWindows('x'.repeat(300), text => text.length + 2), /complete source word exceeds/);
  assert.throws(() => embeddingWindows('   ', wordTokens), /contain text/);
});

test('bucketed batches bound padded tokens and preserve every measured window', () => {
  const windows = [3, 8, 4, 6, 5].map((tokens, index) => ({ tokens, text: `window-${index}` }));
  const batches = planWindowBatches(windows, { tokenBudget: 12, maxBatchWindows: 4, bucketWidth: 8 });
  for (const batch of batches) { assert.ok(batch.padded_tokens <= 12); assert.ok(batch.actual_input_tokens <= batch.padded_tokens); assert.ok(batch.windows.length <= 4); }
  assert.deepEqual(batches.flatMap(batch => batch.windows.map(window => window.original_index)).sort((a, b) => a - b), [0, 1, 2, 3, 4]);
  assert.ok(batches.length >= 3, 'Adding unpadded counts alone would violate the padded model-call budget.');
  assert.throws(() => planWindowBatches([{ tokens: 20 }], { tokenBudget: 8 }), /cannot hold/);
});
test('overlong CJK segments preserve every literal codepoint and UTF16 offset without tail truncation',()=>{
  const text='甲乙丙丁𠀀'.repeat(65);const count=value=>Array.from(value).length+2;
  const windows=embeddingWindows(text,count,{maxTokens:256,overlapWords:16});const covered=new Set();
  for(const window of windows){assert.equal(window.text,text.slice(window.source_utf16_start,window.source_utf16_end));assert.ok(window.tokens<=256);assert.equal(window.weight_unit,'new_source_codepoints');for(let i=window.source_character_start;i<window.source_character_end;i++)covered.add(i);}
  assert.equal(covered.size,Array.from(text).length);assert.equal(windows.reduce((sum,w)=>sum+w.weight,0),Array.from(text).length);
});

test('native windows recount annotation overhead, retain whole words and cover all source gaps',()=>{
  const f=nativeFixture('<p>first words <strike>alpha beta gamma delta epsilon zeta eta theta</strike> last words</p>');
  const count=text=>Array.from(text).length+2,windows=nativeEmbeddingWindows(f.unit.native_input,count,{maxTokens:128,overlapWords:0}),covered=new Set();
  assert.ok(windows.length>1);
  for(const window of windows){assert.equal(window.tokens,count(window.text));assert.ok(window.tokens<=128);assert.ok(window.weight>0);assert.equal((window.text.match(/\[NATIVE_SOURCE_MARKS_UNVERIFIED /gu)??[]).length,(window.text.match(/\[\/NATIVE_SOURCE_MARKS_UNVERIFIED\]/gu)??[]).length);for(let i=window.source_utf16_start;i<window.source_utf16_end;i++)covered.add(i);}
  assert.equal(covered.size,f.normalizedText.length);assert.equal(windows.reduce((n,w)=>n+w.weight,0),f.normalizedText.split(/\s+/u).length);
  for(const window of windows.filter(w=>w.source_ranges.some(r=>r.start<59&&r.end>12)))assert.match(window.text,/"tag":"strike"/);
  assert.equal(windows.at(-1).source_ranges.at(-1).include_end_zero_width,true);
  assert.ok(windows.slice(0,-1).every(w=>w.source_ranges.at(-1).include_end_zero_width===false));
});

test('nested native marks and repeated identical text stay associated with actual source ranges',()=>{
  const f=nativeFixture('<p>same <strike><u>same same same same same same same same</u></strike> same</p>');
  const windows=nativeEmbeddingWindows(f.unit.native_input,text=>Array.from(text).length+2,{maxTokens:128,overlapWords:1});
  assert.ok(windows.length>1);for(const window of windows){const source=window.source_ranges[0];if(source.start<44&&source.end>5){assert.match(window.text,/"tag":"strike"/);assert.match(window.text,/"tag":"u"/);}assert.equal(window.envelope_sha256,f.envelope.sha256);assert.ok(source.projection_sha256.match(/^[a-f0-9]{64}$/u));}
  assert.notEqual(windows[0].source_ranges[0].projection_sha256,windows.at(-1).source_ranges[0].projection_sha256);
});

test('external navigation cannot inflate windows while in-span caption annotations count toward the token limit',()=>{
  const f=nativeFixture('<p><strike>Title</strike> gap <u>alpha beta gamma delta epsilon zeta</u></p>'),start=10,sha=value=>createHash('sha256').update(value).digest('hex');
  const heading={label:'Title',start:0,end:5,parts:[{text:'Title',start:0,end:5}],scope:NAVIGATION_SCOPE,governing_hierarchy_verified:false};
  const unit={...f.unit,start,text:f.normalizedText.slice(start),sha256:sha(f.normalizedText.slice(start)),source_navigation:{nearest_anchor:heading,within_unit:[],scope:NAVIGATION_SCOPE,governing_hierarchy_verified:false},native_source_decorations_ref:{...f.unit.native_source_decorations_ref,start}};
  const representation=createNativeRepresentation(unit,{context:f.context,parent:f.parent}),count=value=>Array.from(value).length+2,windows=nativeEmbeddingWindows(representation,count,{maxTokens:128,overlapWords:0});
  const unknown={...unit,source_navigation:{...unit.source_navigation,nearest_anchor:null}},withoutNavigation=nativeEmbeddingWindows(createNativeRepresentation(unknown,{context:f.context,parent:f.parent}),count,{maxTokens:128,overlapWords:0});
  assert.deepEqual(windows,withoutNavigation,'External navigation metadata must not alter encoded windows, token counts or source provenance');
  assert.equal(representation.text,unit.text);assert.equal(windows.length,1);assert.doesNotMatch(windows[0].text,/Title|"tag":"strike"/);assert.match(windows[0].text,/"tag":"u"/);
  assert.deepEqual(windows.flatMap(window=>window.source_ranges.map(range=>[range.start,range.end,range.role])),[[start,unit.end,'unit_body']]);
  const full=createNativeRepresentation({...f.unit,source_navigation:unit.source_navigation},{context:f.context,parent:f.parent}),fullWindows=nativeEmbeddingWindows(full,count,{maxTokens:128,overlapWords:0});
  assert.equal(embeddingWindows(f.normalizedText,count,{maxTokens:128,overlapWords:0}).length,1);assert.ok(fullWindows.length>1,'Native annotation overhead must split a source span that fits without annotations');
  assert.equal((full.text.match(/Title/gu)||[]).length,1,'An in-span caption remains once as actual source text');assert.ok(fullWindows.some(window=>window.text.includes('"tag":"strike"')));assert.ok(fullWindows.some(window=>window.text.includes('"tag":"u"')));
  for(const window of [...windows,...fullWindows]){assert.equal(window.tokens,count(window.text));assert.ok(window.tokens<=128);assert.equal(window.source_ranges.length,1);assert.equal(window.source_ranges[0].role,'unit_body');}
  assert.equal(fullWindows.map(window=>f.normalizedText.slice(window.source_ranges[0].start,window.source_ranges[0].end)).join(''),f.normalizedText,'Nonoverlapping windows cover the complete exact selected source span');
});

test('native CJK fallback uses codepoint-safe source windows and repeats complete mark metadata',()=>{
  const f=nativeFixture('<p><u>'+'甲乙丙丁𠀀'.repeat(65)+'</u></p>'),count=text=>Array.from(text).length+2;
  const windows=nativeEmbeddingWindows(f.unit.native_input,count,{maxTokens:128,overlapWords:3}),covered=new Set();
  for(const window of windows){assert.ok(window.tokens<=128);assert.equal(window.weight_unit,'new_source_codepoints');assert.match(window.text,/"tag":"u"/);for(let i=window.source_character_start;i<window.source_character_end;i++)covered.add(i);}
  assert.equal(covered.size,Array.from(f.normalizedText).length);assert.equal(windows.reduce((n,w)=>n+w.weight,0),covered.size);
});

test('native metadata too large for one source word fails retained without an inference call',async()=>{
  const f=nativeFixture('<p><u style="text-decoration:'+'unknown '.repeat(100)+'">safe</u></p>'),runtime=mockRuntime();runtime.tokenCount=text=>Array.from(text).length+2;
  const retained=error=>error.code==='NATIVE_WINDOW_TOKEN_OVERFLOW'&&error.reason==='EXHAUSTIVE_MEASURED_NO_PARTITION'&&error.retained_failure===true&&error.partial_stream_accepted===false;
  assert.throws(()=>nativeEmbeddingWindows(f.unit.native_input,runtime.tokenCount,{maxTokens:256}),retained);
  const embedder=await createBatchEmbedder({dimensions:2},{runtime});await assert.rejects(embedder.embedUnits([f.unit]),retained);assert.equal(runtime.calls.length,0);await embedder.dispose();
});

test('native v6 splits a 296-token Latin word without changing native encoding or counting overlap twice',()=>{
  const f=nativeFixture('<u>HEADING</u>'),counter=rangeCounter(f,literal=>literal===f.normalizedText?296:16+Array.from(literal).length*16),windows=nativeEmbeddingWindows(f.unit.native_input,counter);
  assert.ok(windows.length>1);assertExactPartition(f,windows);assert.ok(windows.every(w=>w.weight_unit==='new_source_codepoints'));assert.ok(windows.every(w=>w.text.includes('"tag":"u"')));
  const work=windows[0].native_planner_work;assert.equal(work.maximum_measured_tokens,296);assert.ok(work.over_limit_probes>0);assert.equal(work.tokenizer_calls,counter.calls.length);assert.ok(work.tokenizer_calls>windows.length);assert.equal(work.final_recounts,windows.length);
});

test('native v6 distinguishes measured atom overflow, encoding bounds and bounded search exhaustion',()=>{
  const atom=nativeFixture('<u>Q</u>'),count=rangeCounter(atom,()=>296);
  assert.throws(()=>nativeEmbeddingWindows(atom.unit.native_input,count),error=>error.code==='NATIVE_WINDOW_TOKEN_OVERFLOW'&&error.reason==='EXHAUSTIVE_MEASURED_NO_PARTITION'&&error.work.maximum_measured_tokens===296&&error.work.tokenizer_calls===count.calls.length);
  let calls=0;assert.throws(()=>nativeEmbeddingWindows(atom.unit.native_input,()=>{calls++;return 1;},{limits:{maxEncodedCharacters:1}}),error=>error.code==='NATIVE_WINDOW_ENCODING_BOUND'&&error.reason==='UNMEASURED_ENCODING_BOUND'&&error.work.encoding_bound_probes>0&&error.work.tokenizer_calls===0);assert.equal(calls,0);
  const f=nativeFixture('<u>ABCD</u>');for(const[key,reason]of [['maxEncodeProbes','ENCODE_PROBES'],['maxTokenizerCalls','TOKENIZER_CALLS']]){
    const counter=rangeCounter(f,()=>296);assert.throws(()=>nativeEmbeddingWindows(f.unit.native_input,counter,{limits:{[key]:2}}),error=>error.code==='NATIVE_WINDOW_SEARCH_BOUND'&&error.reason===reason&&error.work[key==='maxEncodeProbes'?'encode_probes':'tokenizer_calls']===2&&error.retained_failure&&error.partial_stream_accepted===false);
  }
  assert.throws(()=>nativeEmbeddingWindows(f.unit.native_input,()=>1,{limits:{maxSourceCharacters:3}}),error=>error.code==='NATIVE_WINDOW_SEARCH_BOUND'&&error.reason==='SOURCE_CHARACTERS'&&error.work.tokenizer_calls===0);
  assert.throws(()=>nativeEmbeddingWindows(f.unit.native_input,()=>1,{limits:{maxTokenizerCalls:NATIVE_WINDOW_LIMITS.maxTokenizerCalls+1}}),/maxTokenizerCalls/);assert.throws(()=>nativeEmbeddingWindows(f.unit.native_input,()=>1,{limits:{unknown:1}}),/Unknown native planner limit/);
});

test('native v6 can recover from a whole-input projection bound using smaller full-native ranges',()=>{
  const f=nativeFixture('<u>'+'x'.repeat(25000)+'</u>');assert.throws(()=>nativeRepresentationWindow(f.unit.native_input),error=>error.code==='NATIVE_DECORATION_PROJECTION_BOUND');
  let calls=0;const windows=nativeEmbeddingWindows(f.unit.native_input,()=>{calls++;return 1;});assert.ok(windows.length>1);assertExactPartition(f,windows);
  assert.ok(windows.every(w=>w.text.includes('"tag":"u"')));assert.ok(windows[0].native_planner_work.encoding_bound_probes>0);assert.equal(windows[0].native_planner_work.tokenizer_calls,calls);
});

test('native v6 bounded DAG finds nonmonotone prefixes and backtracks past a greedy dead suffix',()=>{
  for(const[text,cost,expected]of [
    ['ABCD',literal=>literal==='ABC'?250:literal==='D'?1:296,['ABC','D']],
    ['ABCDE',literal=>literal==='ABCD'?250:literal==='AB'?200:literal==='CDE'?250:296,['AB','CDE']]
  ]){
    const f=nativeFixture('<u>'+text+'</u>'),counter=rangeCounter(f,cost),windows=nativeEmbeddingWindows(f.unit.native_input,counter);assertExactPartition(f,windows);
    assert.deepEqual(windows.map(w=>text.slice(w.source_utf16_start,w.source_utf16_end)),expected);assert.ok(windows.every(w=>w.segmentation==='native_all_language_exhaustive_codepoint_partition_v1'));assert.ok(windows[0].native_planner_work.search_edges>0);assert.equal(windows[0].native_planner_work.tokenizer_calls,counter.calls.length);
  }
  const f=nativeFixture('<u>ABCD</u>'),counter=rangeCounter(f,literal=>literal==='ABC'?250:literal==='D'?1:296);assert.throws(()=>nativeEmbeddingWindows(f.unit.native_input,counter,{limits:{maxWindows:1}}),error=>error.code==='NATIVE_WINDOW_SEARCH_BOUND'&&error.reason==='WINDOW_COUNT'&&error.work.tokenizer_calls===counter.calls.length);
  const dead=nativeFixture('<u>ABCDE</u>'),spent=rangeCounter(dead,literal=>['A','AB'].includes(literal)?1:296);assert.throws(()=>nativeEmbeddingWindows(dead.unit.native_input,spent),error=>error.code==='NATIVE_WINDOW_TOKEN_OVERFLOW'&&error.work.fast_windows_completed===1&&error.work.final_recounts===1&&error.work.search_edges>0&&error.work.tokenizer_calls===spent.calls.length&&error.partial_stream_accepted===false);
});

test('native v6 Unicode partition retains intermediate and terminal zero-event ownership',()=>{
  const f=nativeFixture('<u>😀</u><u>\u200B</u><b>A</b><u>\u200B</u>',{dropZeroWidth:true}),counter=rangeCounter(f,literal=>Array.from(literal).length===1?1:296),windows=nativeEmbeddingWindows(f.unit.native_input,counter);
  assertExactPartition(f,windows);assert.deepEqual(windows.map(w=>[w.source_utf16_start,w.source_utf16_end]),[[0,2],[2,3]]);assert.equal(windows[0].source_ranges[0].include_end_zero_width,false);assert.equal(windows[1].source_ranges[0].include_end_zero_width,true);
  assert.equal(windows.reduce((n,w)=>n+(w.text.match(/"tag":"u"/gu)??[]).length,0),(nativeRepresentationWindow(f.unit.native_input).text.match(/"tag":"u"/gu)??[]).length);
});

test('native v6 retains failed counter work and unchanged successful word/CJK fast serialization and costs',()=>{
  const f=nativeFixture('<u>A</u>');assert.throws(()=>nativeEmbeddingWindows(f.unit.native_input,()=>{throw Object.assign(new Error('synthetic'),{code:'SYNTHETIC_COUNTER'});}),error=>error.code==='NATIVE_WINDOW_TOKENIZER_FAILURE'&&error.cause_code==='SYNTHETIC_COUNTER'&&error.work.tokenizer_calls===1);
  assert.throws(()=>nativeEmbeddingWindows(f.unit.native_input,()=>0),error=>error.code==='NATIVE_WINDOW_TOKENIZER_FAILURE'&&error.reason==='INVALID_COUNT'&&error.work.tokenizer_calls===1);
  let wordCalls=0;const plain=nativeFixture('<p>one two three four five six seven eight nine ten</p>'),text=plain.normalizedText,windows=nativeEmbeddingWindows(plain.unit.native_input,value=>{wordCalls++;return wordTokens(value);},{maxTokens:8,overlapWords:2});
  const expected=[[0,6,0,text.indexOf('seven'),6],[4,10,text.indexOf('five'),text.length,4]].map(([start,end,left,right,weight])=>({...nativeRepresentationWindow(plain.unit.native_input,{start:left,end:right}),tokens:8,word_start:start,word_end:end,source_utf16_start:left,source_utf16_end:right,weight,weight_unit:'new_source_words',segmentation:'native_complete_words_before_encoding'}));assert.deepEqual(windows,expected);
  assert.equal(wordCalls,9,'The unaffected word fast path keeps its prior probe/final-count cost');assert.ok(windows.every(w=>w.native_planner_work===undefined));
  const cjk=nativeFixture('<u>甲乙丙丁𠀀</u>'),counter=rangeCounter(cjk,literal=>Array.from(literal).length*80),characterWindows=nativeEmbeddingWindows(cjk.unit.native_input,counter,{overlapWords:1});
  assert.deepEqual(characterWindows,[[0,3,0,3,3],[2,5,2,6,2]].map(([start,end,left,right,weight])=>({...nativeRepresentationWindow(cjk.unit.native_input,{start:left,end:right}),tokens:240,source_character_start:start,source_character_end:end,source_utf16_start:left,source_utf16_end:right,weight,weight_unit:'new_source_codepoints',segmentation:'native_cjk_codepoint_boundaries_before_encoding'})));
  assert.equal(counter.calls.length,7,'The unaffected CJK fast path keeps its prior probe/final-count cost');assert.ok(characterWindows.every(w=>w.native_planner_work===undefined));
  const policy=embeddingWindowPolicy({max_tokens:256,overlap_words:16});assert.equal(policy.version,'complete-source-ranges-native-window-encoding-v6');assert.equal(policy.native_window_planner,'FULL_NATIVE_WORD_FAST_PATH_THEN_BOUNDED_ALL_LANGUAGE_CODEPOINT_PARTITION_V6');assert.equal(policy.native_window_planner,NATIVE_WINDOW_PLANNER_POLICY);assert.equal(policy.native_repaired_fallback_overlap,0);assert.deepEqual(policy.native_planner_limits,NATIVE_WINDOW_LIMITS);
  assert.equal(prepareEmbeddingInput(plain.unit,wordTokens,{maxTokens:8,overlapWords:2}).policy.native_window_planner,NATIVE_WINDOW_PLANNER_POLICY);
});

// Authored range costs reproduce equal/receding overlap ends without a tokenizer.
// Capacity four repeats the previous end (zero new weight); two recedes behind it.
function nonextendingNativeFixture(kind,secondCapacity=4){
  if(kind==='WORD')return {f:nativeFixture('<u>wa wb wc wd we wf wg wh</u>'),cost:literal=>{const words=literal.trim().split(/\s+/u);return words[0]==='wa'?(words.length<=5?8:9):words[0]==='wb'?(words.length<=secondCapacity?8:9):8;}};
  const literal='甲乙丙丁戊己庚辛';return {f:nativeFixture('<u>'+literal+'</u>'),cost:value=>{const points=Array.from(value),start=literal.indexOf(points[0]);return start===0?(points.length<=5?8:9):start===1?(points.length<=secondCapacity?8:9):8;}};
}
function checkProgressRepair(kind,secondCapacity){
  const {f,cost}=nonextendingNativeFixture(kind,secondCapacity),counter=rangeCounter(f,cost),windows=nativeEmbeddingWindows(f.unit.native_input,counter,{maxTokens:8,overlapWords:16});
  assertExactPartition(f,windows);let previousEnd=0;for(const w of windows){assert.ok(w.source_utf16_end>previousEnd&&w.weight>0&&w.tokens<=8);previousEnd=w.source_utf16_end;}
  const work=windows[0].native_planner_work;assert.ok(work.fast_windows_completed>=1);assert.ok(work.final_recounts>windows.length,'Discarded fast-path final counts remain charged');assert.equal(work.tokenizer_calls,counter.calls.length);assert.ok(work.over_limit_probes>0);
  assert.ok(windows.every(w=>w.segmentation===(kind==='WORD'?'native_all_language_nonoverlapping_codepoint_boundaries_v1':'native_all_language_exhaustive_codepoint_partition_v1')));assert.equal(work.search_edges>0,kind==='CJK');
}

test('native v6 discards repeated and receding WORD overlap ends before whole-source bounded fallback',()=>{
  for(const capacity of [4,2])checkProgressRepair('WORD',capacity);
});

test('native v6 discards repeated and receding CJK overlap ends before the bounded exhaustive partition',()=>{
  for(const capacity of [4,2])checkProgressRepair('CJK',capacity);
});

test('native v6 progress repairs retain discarded work and whole-stream failures under unchanged probe/call caps',()=>{
  for(const kind of ['WORD','CJK'])for(const[key,reason]of [['maxEncodeProbes','ENCODE_PROBES'],['maxTokenizerCalls','TOKENIZER_CALLS']]){
    const {f,cost}=nonextendingNativeFixture(kind),counter=rangeCounter(f,cost);
    assert.throws(()=>nativeEmbeddingWindows(f.unit.native_input,counter,{maxTokens:8,overlapWords:16,limits:{[key]:12}}),error=>error.code==='NATIVE_WINDOW_SEARCH_BOUND'&&error.reason===reason&&error.retained_failure===true&&error.partial_stream_accepted===false&&error.work.fast_windows_completed>=1&&error.work.final_recounts>=1&&error.work.tokenizer_calls===counter.calls.length&&error.work[key==='maxEncodeProbes'?'encode_probes':'tokenizer_calls']===12);
  }
});

test('zero-output native origins at intermediate and terminal boundaries each have an explicit owner',()=>{
  const f=nativeFixture('<p>alpha <u>\u200B</u>beta gamma<u>\u200B</u></p>',{dropZeroWidth:true});
  const windows=nativeEmbeddingWindows(f.unit.native_input,wordTokens,{maxTokens:8,overlapWords:0});
  assert.ok(windows.length>1);assert.equal(windows.reduce((n,w)=>n+(w.text.match(/"tag":"u"/gu)??[]).length,0),2);
  assert.equal(windows.at(-1).source_ranges[0].include_end_zero_width,true);assert.ok(windows.slice(0,-1).every(window=>window.source_ranges[0].include_end_zero_width===false));
  assert.equal(windows.map(window=>f.normalizedText.slice(window.source_utf16_start,window.source_utf16_end)).join(''),f.normalizedText);
});

test('native cache identity cannot reuse plain or differently originated text and current refs cannot downgrade',async t=>{
  const cacheDir=await cacheFixture(t),runtime=mockRuntime(),embedder=await createBatchEmbedder({dimensions:2,cache_dir:cacheDir,max_tokens:128},{runtime});
  const f=nativeFixture('<p>same <strike>same</strike></p>'),plain=await embedder.embedUnits([{id:'legacy',text:f.normalizedText}]),native=await embedder.embedUnits([f.unit]);
  assert.notEqual(plain.inputs[0].input_sha256,native.inputs[0].input_sha256);assert.equal(plain.inputs[0].native_evidence_status,'LEGACY_NATIVE_EVIDENCE_UNAVAILABLE');assert.equal(native.inputs[0].native_evidence_status,'BOUND_NATIVE_SOURCE_EVIDENCE');
  assert.ok(runtime.calls.flat().some(text=>text.includes('"tag":"strike"')));
  const calls=runtime.calls.length,resumed=await embedder.embedUnits([f.unit]);assert.equal(resumed.cache_stats.hits,1);assert.equal(runtime.calls.length,calls);
  const other=nativeFixture('<p><strike>same</strike> same</p>');assert.equal(other.normalizedText,f.normalizedText);assert.notEqual(modelInputIdentity(other.unit).input_sha256,modelInputIdentity(f.unit).input_sha256);
  await embedder.embedUnits([other.unit]);assert.ok(runtime.calls.length>calls);
  const downgraded={...f.unit};delete downgraded.native_input;await assert.rejects(embedder.embedUnits([downgraded]),/plain fallback forbidden/);await embedder.dispose();
});

test('production pinned-tokenizer readiness and inference use identical synthetic source windows and references',async()=>{
  const counter=await createPinnedTokenCounter();
  assert.equal(counter.model.verification_status,'VERIFIED_EXISTING_PINNED_ARTIFACTS');assert.equal(counter.model.downloads_attempted,0);
  assert.equal(counter.model.files.find(file=>file.path==='tokenizer.json').sha256,'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0');
  assert.equal(counter.policy.verified_file_set_sha256,counter.model.verified_file_set_sha256);assert.equal(counter.policy.onnx_session_created,false);assert.equal(counter.policy.model_inference,false);assert.equal(counter.tokenCount('hello world'),4);
  const f=nativeFixture('<p><strike>'+Array.from({length:90},(_,i)=>'word'+i).join(' ')+'</strike> <u>same same</u></p>');
  const prepared=prepareEmbeddingInput(f.unit,counter.tokenCount,{maxTokens:128,overlapWords:2});
  assert.ok(prepared.windows.length>1);assert.equal(prepared.input.input_sha256,modelInputIdentity(f.unit).input_sha256);
  for(const window of prepared.windows){assert.equal(window.tokens,counter.tokenCount(window.text));assert.ok(window.tokens<=128);assert.equal(window.envelope_sha256,f.envelope.sha256);assert.ok(window.window_annotations_self_contained);}
  const calls=[],runtime={model:{synthetic_runtime_id:'pinned-tokenizer-synthetic-vectors-only'},tokenCount:counter.tokenCount,extractBatch:async texts=>{calls.push(...texts);return texts.map(()=>[1,1]);}};
  const embedder=await createBatchEmbedder({dimensions:2,max_tokens:128,overlap_words:2},{runtime});
  try{const result=await embedder.embedUnits([f.unit]);assert.deepEqual(result.inputs[0].windows,prepared.input.windows);assert.equal(result.inputs[0].input_sha256,prepared.input.input_sha256);assert.equal(new Set(calls).size,new Set(prepared.windows.map(window=>window.text)).size);assert.deepEqual(new Set(calls),new Set(prepared.windows.map(window=>window.text)));}finally{await embedder.dispose();}
  await assert.rejects(createPinnedTokenCounter({max_tokens:257}),/max_tokens/);await assert.rejects(createPinnedTokenCounter({revision:'f'.repeat(40)}),/exact existing MiniLM/);
});

test('production pinned-tokenizer readiness repairs a synthetic 296-token Latin compound without inference',async()=>{
  const pinned=await createPinnedTokenCounter();assert.equal(pinned.policy_sha256,'728bb65a00c45e8b6a4e1cdb1e5f8a69d5946234deb8bef089b61261dc8f541d');assert.equal(pinned.policy.onnx_session_created,false);assert.equal(pinned.policy.model_inference,false);assert.equal(pinned.model.downloads_attempted,0);
  // One whitespace-delimited source word; its explicit hyphens are tokenizer boundaries.
  const f=nativeFixture('<u>'+'alpha-'.repeat(129)+'alpha!</u>');assert.equal(f.normalizedText.length,780);assert.equal((f.normalizedText.match(/\S+/gu)??[]).length,1);
  let calls=0;const count=text=>{assert.ok(calls<96,'Synthetic integration counter work is bounded');calls++;return pinned.tokenCount(text);};assert.equal(count(nativeRepresentationWindow(f.unit.native_input).text),296);
  const before=calls,windows=nativeEmbeddingWindows(f.unit.native_input,count,{limits:{maxEncodeProbes:64,maxTokenizerCalls:64,maxWindows:8}}),plannerCalls=calls-before;assertExactPartition(f,windows);
  assert.deepEqual(windows.map(w=>[w.source_utf16_start,w.source_utf16_end,w.tokens]),[[0,660,256],[660,780,76]]);assert.ok(windows.every(w=>w.segmentation==='native_all_language_nonoverlapping_codepoint_boundaries_v1'));
  const work=windows[0].native_planner_work;assert.equal(work.tokenizer_calls,plannerCalls);assert.equal(work.maximum_measured_tokens,296);assert.ok(work.over_limit_probes>0);assert.equal(work.final_recounts,2);assert.ok(work.tokenizer_calls<=64);
  for(const window of windows)assert.equal(count(window.text),window.tokens);assert.equal(calls,1+plannerCalls+windows.length);
});

test('cross-unit batching aggregates weighted windows and returns original ordered Float32 units', async () => {
  const runtime = mockRuntime(); const embedder = await createBatchEmbedder({ dimensions: 2, max_tokens: 8, overlap_words: 2, token_budget: 24, max_batch_windows: 3 }, { runtime });
  const units = [{ id: 'long', text: 'alpha b c d e f g h i j' }, { id: 'short', text: 'beta only' }, { id: 'repeat', text: 'alpha b c d e f g h i j' }];
  const progress = []; const result = await embedder.embedUnits(units, { onBatch: info => { progress.push(info); } });
  assert.deepEqual(result.unit_ids, ['long', 'short', 'repeat']); assert.equal(result.packed_vectors.length, 6);
  assert.ok(result.vectors.every(vector => vector instanceof Float32Array && Math.abs(norm(vector) - 1) < 1e-6));
  const expected = normalizeFloat32([0.6, 0.4]); assert.ok(Math.abs(result.vectors[0][0] - expected[0]) < 1e-6); assert.ok(Math.abs(result.vectors[0][1] - expected[1]) < 1e-6);
  assert.deepEqual([...result.vectors[1]], [0, 1]); assert.deepEqual([...result.vectors[2]], [...result.vectors[0]]); assert.notEqual(result.vectors[0], result.vectors[2]);
  assert.equal(result.cache_stats.repeated_inputs_reused, 1); assert.equal(result.cache_stats.unique_inputs_embedded, 2);
  assert.ok(progress.every(info => info.padded_tokens <= 24)); assert.equal(result.inputs[0].windows.reduce((sum, window) => sum + window.weight, 0), 10);
  assert.ok(runtime.calls.some(texts => texts.includes('beta only') && texts.some(text => text.startsWith('alpha'))), 'A model call should batch windows from different source units.');
  assert.equal(result.provenance.synthetic_runtime, true); assert.equal(result.provenance.model.execution_attested, false);
  await embedder.dispose(); await assert.rejects(embedder.embedUnits(units), /disposed/);
});

test('per-input atomic manifests verify resume, ordering, policy identity and corruption', async t => {
  const cacheDir = await cacheFixture(t); const runtime = mockRuntime();
  const config = { dimensions: 2, cache_dir: cacheDir, max_tokens: 8, overlap_words: 2 };
  const first = await createBatchEmbedder(config, { runtime });
  const original = await first.embedUnits([{ id: 'a', text: 'alpha beta' }, { id: 'b', text: 'other text' }]);
  assert.equal(original.cache_stats.entries_written, 2); runtime.calls.length = 0;
  const second = await createBatchEmbedder(config, { runtime });
  const resumed = await second.embedUnits([{ id: 'new-b', text: 'other text' }, { id: 'new-a', text: 'alpha beta' }]);
  assert.equal(resumed.cache_stats.hits, 2); assert.equal(runtime.calls.length, 0); assert.deepEqual(resumed.unit_ids, ['new-b', 'new-a']);
  assert.deepEqual([...resumed.vectors[0]], [...original.vectors[1]]);
  const changedPolicy = await createBatchEmbedder({ ...config, overlap_words: 1 }, { runtime });
  assert.notEqual(changedPolicy.window_policy_sha256, first.window_policy_sha256);
  const changed = await changedPolicy.embedUnits([{ id: 'changed', text: 'alpha beta' }]); assert.equal(changed.cache_stats.hits, 0);
  const key = original.inputs[0].cache_key; const file = path.join(cacheDir, key.slice(0, 2), `${key}.json`);
  const entry = JSON.parse(await readFile(file, 'utf8')); entry.vector_base64 = Buffer.alloc(8).toString('base64'); const corrupt = JSON.stringify(entry); await writeFile(file, corrupt);
  await assert.rejects(second.embedUnits([{ id: 'corrupt', text: 'alpha beta' }]), /identity or integrity mismatch/);
  assert.equal(await readFile(file, 'utf8'), corrupt, 'Corruption must be preserved and reported, not overwritten.');
  for (const bucket of await readdir(cacheDir)) assert.ok((await readdir(path.join(cacheDir, bucket))).every(name => !name.includes('.tmp-')));
  await first.dispose(); await second.dispose(); await changedPolicy.dispose();
});

test('aborted chunks retain completed cache entries and resume only remaining inputs', async t => {
  const cacheDir = await cacheFixture(t); const runtime = mockRuntime();
  const embedder = await createBatchEmbedder({ dimensions: 2, cache_dir: cacheDir, max_batch_windows: 1 }, { runtime });
  const units = [{ id: 'a', text: 'alpha first' }, { id: 'b', text: 'beta second' }]; const controller = new AbortController();
  await assert.rejects(embedder.embedUnits(units, { signal: controller.signal, onBatch: () => controller.abort(new Error('synthetic interruption')) }), /synthetic interruption/);
  assert.equal(runtime.calls.length, 1);
  const resumed = await embedder.embedUnits(units); assert.equal(resumed.cache_stats.hits, 1); assert.equal(runtime.calls.length, 2); assert.equal(resumed.vectors.length, 2);
  await embedder.dispose();
});

test('bounds, model identity and invalid runtime values fail explicitly', async () => {
  const runtime = mockRuntime(); const embedder = await createBatchEmbedder({ dimensions: 2 }, { runtime });
  await assert.rejects(embedder.embedUnits(Array.from({ length: 501 }, (_, index) => ({ id: `u-${index}`, text: 'synthetic' }))), /at most 500/);
  await assert.rejects(embedder.embedUnits([{ id: 'same', text: 'one' }, { id: 'same', text: 'two' }]), /unique nonempty/);
  runtime.extractBatch = async texts => texts.map(() => [NaN, 1]); await assert.rejects(embedder.embedUnits([{ id: 'bad', text: 'synthetic' }]), /Non-finite/);
  const h = createHash('sha256').update('synthetic').digest('hex');
  assert.notEqual(embeddingCacheKey(h, PINNED_MODEL.revision, 'a'.repeat(64)), embeddingCacheKey(h, PINNED_MODEL.revision, 'b'.repeat(64)));
  await assert.rejects(createBatchEmbedder({ dimensions: 2, cache_dir: '/etc/should-not-be-created' }, { runtime }), /managed study\/cache namespace/);
  await embedder.dispose();
});

test('existing pinned MiniLM tokenizer and CPU model smoke, explicit opt-in', { skip: process.env.NONVERBA_EMBEDDING_SMOKE !== '1' ? 'Set NONVERBA_EMBEDDING_SMOKE=1 inside the managed container to verify existing model inference; no downloads.' : false }, async () => {
  const embedder = await createBatchEmbedder({ token_budget: 1024, max_batch_windows: 4 });
  try {
    const native=nativeFixture('<p><strike>earlier rate</strike> <u>replacement rate</u> applies unless notified.</p>');
    const result = await embedder.embedUnits([{ id: 'short', text: 'The parties shall give written notice before changing the agreed task.' }, { id: 'long', text: Array.from({ length: 400 }, (_, index) => `obligation${index}`).join(' ') },native.unit]);
    assert.equal(result.dimensions, 384); assert.equal(result.vectors.length, 3); assert.ok(result.inputs[1].windows.length > 1);
    for (const input of result.inputs) for (const window of input.windows) assert.ok(window.tokens <= 256);
    assert.equal(result.inputs[1].windows.reduce((sum, window) => sum + window.weight, 0), 400);
    assert.equal(result.inputs[2].native_evidence_status,'BOUND_NATIVE_SOURCE_EVIDENCE');assert.equal(result.inputs[2].input_sha256,modelInputIdentity(native.unit).input_sha256);assert.ok(result.inputs[2].windows.some(window=>window.source_ranges.some(range=>range.encoded_annotation_groups>=2)));
    assert.equal(result.provenance.model.downloads_attempted, 0); assert.equal(result.provenance.model.execution_attested, false); assert.equal(result.provenance.model.verification_status, 'VERIFIED_EXISTING_PINNED_ARTIFACTS');
  } finally { await embedder.dispose(); }
});
