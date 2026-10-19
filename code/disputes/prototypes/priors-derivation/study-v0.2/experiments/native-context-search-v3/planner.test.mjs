// SPDX-License-Identifier: AGPL-3.0-only
// SOURCE_FREE PROTOTYPE controls: authored literals / fictional synchronous costs.
// No corpus IO, model assets, tokenizer authority, or execution evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {nativeEmbeddingWindows,NATIVE_WINDOW_LIMITS} from '../../lib/embedding.mjs';
import {traceNativeDecoration,bindNativeDecoration} from '../../lib/source-decoration.mjs';
import {NATIVE_COLLECTOR_POLICY} from '../../lib/sections.mjs';
import {createNativeSourceContext,createNativeRepresentation,nativeRepresentationWindow,NAVIGATION_SCOPE} from '../../lib/representation.mjs';
import {planNativeContextNodeSearchV3,nativeContextSearchWindowsV3,POLICY,LIMITS} from './planner.mjs';
const H=v=>createHash('sha256').update(v).digest('hex');

// O(source length + actual probes). Geometry-only encoding is a fictional test
// protocol, deliberately distinct from the exact native-encoder tests below.
function geometric(text,cost){
  const offsets=[0];for(const c of text)offsets.push(offsets.at(-1)+c.length);
  const point=new Map(offsets.map((n,i)=>[n,i])),calls=[],encodes=[];
  const encode=(a,b)=>{assert.ok(point.has(a)&&point.has(b)&&b>a,'Unicode-safe nonempty source range');encodes.push([a,b]);return{text:JSON.stringify([a,b]),exact_fixture_range:[a,b]};};
  const countTokens=s=>{const[a,b]=JSON.parse(s);calls.push([a,b]);return cost(point.get(a),point.get(b));};
  return {text,encode,countTokens,offsets,calls,encodes};
}
function partition(f,out){
  let end=0;for(const w of out.windows){assert.equal(w.source_utf16_start,end);assert.ok(w.source_utf16_end>end&&w.tokens>0&&w.tokens<=8);assert.equal(w.weight_unit,'new_source_codepoints');assert.equal(w.weight,w.source_character_end-w.source_character_start);assert.ok(w.weight>0);assert.equal(w.source_utf16_start,f.offsets[w.source_character_start]);assert.equal(w.source_utf16_end,f.offsets[w.source_character_end]);end=w.source_utf16_end;}
  assert.equal(end,f.text.length);assert.equal(out.windows.reduce((n,w)=>n+w.weight,0),f.offsets.length-1);assert.equal(out.work.tokenizer_calls,f.calls.length);assert.equal(out.work.encode_probes,f.encodes.length);assert.ok(out.work.final_recounts>=out.windows.length);assert.ok(out.work.encode_probes<=LIMITS.maxEncodeProbes);assert.ok(out.work.search_edges<=LIMITS.maxEncodeProbes);
}
function nativeFixture(raw,{dropZeroWidth=false}={}){
  const trace=traceNativeDecoration(raw),mapped=trace.runs.map(r=>dropZeroWidth?r.decoded_text.replace(/[\u200B\uFEFF]/gu,''):r.decoded_text),normalizedText=mapped.join('');let at=0;
  const envelope=bindNativeDecoration(trace,{raw,normalizedText,tracerSourceSHA256:'a'.repeat(64),collectorSourceSHA256:'b'.repeat(64),collectorSegments:trace.runs.map((r,i)=>{const start=at;at+=mapped[i].length;return{normalized_start:start,normalized_end:at,sources:[{run_id:r.id,decoded_start:0,decoded_end:r.decoded_text.length}],normalization:mapped[i]===r.decoded_text?'EXACT_DECODED':'EXTRACTOR_NFC_FILTER_WHITESPACE_V1'};})});
  const parent={id:'SOURCE_FREE_PARENT',contract_id:'SOURCE_FREE_CONTRACT',cohort:'discovery-broad',start:0,end:normalizedText.length,sha256:H(normalizedText)},unit={...parent,id:'SOURCE_FREE_UNIT',parent_section_id:parent.id,text:normalizedText,source_navigation:{nearest_anchor:null,within_unit:[],scope:NAVIGATION_SCOPE,governing_hierarchy_verified:false},native_source_decorations_ref:{envelope_sha256:envelope.sha256,raw_sha256:envelope.raw.sha256,normalized_sha256:envelope.normalized.sha256,tracer_source_sha256:envelope.tracer_source_sha256,collector_source_sha256:envelope.collector_source_sha256,policy:envelope.policy,collector_policy:NATIVE_COLLECTOR_POLICY,start:0,end:normalizedText.length,mapping_status:envelope.mapping_status,input_eligibility:envelope.input_eligibility,projection_required:true}};
  const context=createNativeSourceContext({raw,normalizedText,envelope,expectedTracerSourceSHA256:'a'.repeat(64),expectedCollectorSourceSHA256:'b'.repeat(64)});return {text:normalizedText,representation:createNativeRepresentation(unit,{context,parent})};
}

test('SOURCE_FREE successful WORD and CJK fast paths retain exact native encodings and callback sequence',()=>{
  const cases=[
    [nativeFixture('<p>first words <strike>alpha beta gamma delta epsilon zeta eta theta</strike> last words</p>'),{maxTokens:128,overlapWords:0}],
    [nativeFixture('<u>'+'甲乙丙丁𠀀'.repeat(65)+'</u>'),{maxTokens:128,overlapWords:3}]
  ];
  for(const[f,opts]of cases){const oldCalls=[],newCalls=[],cost=s=>Array.from(s).length+2,old=nativeEmbeddingWindows(f.representation,s=>{oldCalls.push(s);return cost(s);},opts),out=nativeContextSearchWindowsV3(f.representation,s=>{newCalls.push(s);return cost(s);},opts);assert.deepEqual(out.windows,old);assert.deepEqual(newCalls,oldCalls);assert.equal(out.work.tokenizer_calls,newCalls.length);assert.equal(out.work.search_edges,0);assert.ok(out.windows.length>1);}
  assert.deepEqual(LIMITS,NATIVE_WINDOW_LIMITS);assert.equal(POLICY.authority,'NONE');
});

test('SOURCE_FREE long nonmonotone source uses exact successes then nearby endpoints, without quadratic fixture generation',()=>{
  const length=12000,f=geometric('x'.repeat(length),(a,b)=>a===0?(b<=32?8:9):b-a===3||b===length&&b-a<=3?8:9),out=planNativeContextNodeSearchV3(f,{maxTokens:8,overlapWords:0,limits:{maxEncodeProbes:8192,maxTokenizerCalls:8192}});
  partition(f,out);assert.equal(out.work.fast_windows_completed,1);assert.ok(out.work.search_edges>0);assert.equal(out.work.final_recounts,out.windows.length+1,'Discarded fast recount remains charged');assert.ok(out.work.encode_probes<8192);assert.ok(out.windows.every(w=>w.segmentation==='experimental_native_hinted_exhaustive_codepoint_partition_v3'));assert.equal(f.calls.filter(([a,b])=>a===0&&b===32).length,3,'Exact fast success reused only for search; final window is recounted');
});

test('SOURCE_FREE shifted start is freshly encoded/counted and dead greedy suffix is backtracked',()=>{
  const allowed=new Set(['0:4','0:3','3:8']),f=geometric('ABCDEFGH',(a,b)=>allowed.has(`${a}:${b}`)?8:9),out=planNativeContextNodeSearchV3(f,{maxTokens:8,overlapWords:0});
  partition(f,out);assert.deepEqual(out.windows.map(w=>w.exact_fixture_range),[[0,3],[3,8]]);assert.equal(out.work.fast_windows_completed,1);assert.equal(out.work.final_recounts,3);assert.ok(f.calls.some(([a,b])=>a===4&&b===8),'Shifted endpoint is not authorized by the measured 0:4 success');for(let b=5;b<=8;b++)assert.ok(f.calls.some(([a,z])=>a===4&&z===b),'A dead suffix requires all possible outgoing endpoints');
});

test('SOURCE_FREE overlapping WORD successes remain exact ranges when the repaired partition changes starts',()=>{
  const text='wa wb wc wd we wf wg wh',length=text.length,f=geometric(text,(a,b)=>a===0?(b<=15?8:9):a===3?(b<=9?8:9):a>=15&&(b-a===3||b===length&&b-a<=3)?8:9),out=planNativeContextNodeSearchV3(f,{maxTokens:8,overlapWords:16});
  partition(f,out);assert.equal(out.work.fast_windows_completed,2,'Discarded WORD and character fast windows are both charged');assert.equal(out.work.final_recounts,out.windows.length+2);assert.deepEqual(out.windows.map(w=>w.exact_fixture_range),[[0,15],[15,18],[18,21],[21,23]]);assert.ok(f.calls.some(([a,b])=>a===3&&b===9),'Original overlapping WORD success was measured');assert.ok(f.calls.some(([a,b])=>a===15&&b===21),'Shifted six-character hint requires a new count and is rejected');assert.equal(f.calls.filter(([a,b])=>a===0&&b===15).length,5,'Two fast-path probe/recount pairs plus one final returned recount; search reuse is exact');
});

test('SOURCE_FREE hinted repair keeps astral UTF16 coordinates and unique codepoint weights',()=>{
  const length=96,f=geometric('🙂'.repeat(length),(a,b)=>a===0?(b<=32?8:9):b-a===3||b===length&&b-a<=3?8:9),out=planNativeContextNodeSearchV3(f,{maxTokens:8,overlapWords:0});
  partition(f,out);assert.ok(out.windows.every(w=>w.source_utf16_end===w.source_character_end*2));assert.equal(out.windows.reduce((n,w)=>n+w.weight,0),length);
});

test('SOURCE_FREE overflow requires complete measured reachable DAG, not a failed binary or hint probe',()=>{
  const f=geometric('ABC',(a,b)=>a===0&&b===1?8:9);let caught;
  try{planNativeContextNodeSearchV3(f,{maxTokens:8,overlapWords:0});}catch(e){caught=e;}
  assert.equal(caught?.code,'NATIVE_WINDOW_TOKEN_OVERFLOW');assert.equal(caught.reason,'EXHAUSTIVE_MEASURED_NO_PARTITION');assert.equal(caught.partial_stream_accepted,false);assert.ok(caught.work.fast_windows_completed>0);for(const pair of [[0,1],[0,2],[0,3],[1,2],[1,3]])assert.ok(f.calls.some(([a,b])=>a===pair[0]&&b===pair[1]));assert.equal(caught.work.tokenizer_calls,f.calls.length);
});

test('SOURCE_FREE probe, tokenizer, source and window caps retain failure and complete spent work',()=>{
  for(const[key,reason]of [['maxEncodeProbes','ENCODE_PROBES'],['maxTokenizerCalls','TOKENIZER_CALLS']]){const f=geometric('ABCDEFGH',()=>9);assert.throws(()=>planNativeContextNodeSearchV3(f,{maxTokens:8,limits:{[key]:2}}),e=>e.code==='NATIVE_WINDOW_SEARCH_BOUND'&&e.reason===reason&&e.partial_stream_accepted===false&&e.work[key==='maxEncodeProbes'?'encode_probes':'tokenizer_calls']===2&&e.work.tokenizer_calls===f.calls.length);}
  const f=geometric('ABCDEFGH',(a,b)=>b-a===1?8:9);assert.throws(()=>planNativeContextNodeSearchV3(f,{maxTokens:8,overlapWords:0,limits:{maxWindows:1}}),e=>e.code==='NATIVE_WINDOW_SEARCH_BOUND'&&e.reason==='WINDOW_COUNT'&&e.partial_stream_accepted===false&&e.work.final_recounts>0);
  assert.throws(()=>planNativeContextNodeSearchV3(geometric('ABCD',()=>1),{limits:{maxSourceCharacters:3}}),e=>e.code==='NATIVE_WINDOW_SEARCH_BOUND'&&e.reason==='SOURCE_CHARACTERS'&&e.work.tokenizer_calls===0);
  assert.throws(()=>planNativeContextNodeSearchV3(geometric('AB',()=>1),{limits:{maxEncodeProbes:LIMITS.maxEncodeProbes+1}}),/maxEncodeProbes/);assert.throws(()=>planNativeContextNodeSearchV3(geometric('AB',()=>1),{limits:{extra:1}}),/Unknown native planner limit/);
});

test('SOURCE_FREE encoding bounds remain unknown feasibility and invalid counter/encoder output is retained failed',()=>{
  let calls=0;assert.throws(()=>planNativeContextNodeSearchV3({text:'A',encode:()=>{throw Object.assign(new Error('fixture'),{code:'NATIVE_DECORATION_PROJECTION_BOUND'});},countTokens:()=>{calls++;return 1;}},{maxTokens:8}),e=>e.code==='NATIVE_WINDOW_ENCODING_BOUND'&&e.reason==='UNMEASURED_ENCODING_BOUND'&&e.work.encoding_bound_probes>0&&e.work.tokenizer_calls===0);assert.equal(calls,0);
  assert.throws(()=>planNativeContextNodeSearchV3({text:'A',encode:()=>({text:'123'}),countTokens:()=>{calls++;return 1;}},{maxTokens:8,limits:{maxEncodedCharacters:1}}),e=>e.code==='NATIVE_WINDOW_ENCODING_BOUND'&&e.work.tokenizer_calls===0);assert.equal(calls,0);
  for(const n of [0,-1,1.5,NaN,Infinity])assert.throws(()=>planNativeContextNodeSearchV3({text:'A',encode:()=>({text:'A'}),countTokens:()=>n}),e=>e.code==='NATIVE_WINDOW_TOKENIZER_FAILURE'&&e.reason==='INVALID_COUNT'&&e.work.tokenizer_calls===1);
  assert.throws(()=>planNativeContextNodeSearchV3({text:'A',encode:()=>({missing:'text'}),countTokens:()=>assert.fail('Bad encoder must not reach counter')}),e=>e.code==='NATIVE_WINDOW_ENCODING_FAILURE'&&e.work.tokenizer_calls===0);
  assert.throws(()=>planNativeContextNodeSearchV3({text:'A',encode:()=>{throw null;},countTokens:()=>assert.fail('Thrown encoder must not reach counter')}),e=>e.code==='NATIVE_WINDOW_ENCODING_FAILURE'&&e.work.encode_probes===1&&e.work.tokenizer_calls===0);
  assert.throws(()=>planNativeContextNodeSearchV3({text:'A',encode:()=>{throw{get code(){assert.fail('Thrown error getters must not be read');}};},countTokens:()=>assert.fail('Thrown encoder must not reach counter')}),e=>e.code==='NATIVE_WINDOW_ENCODING_FAILURE'&&e.work.encode_probes===1&&e.work.tokenizer_calls===0);
  assert.throws(()=>planNativeContextNodeSearchV3({text:'A',encode:()=>({text:'A'}),countTokens:()=>{throw null;}}),e=>e.code==='NATIVE_WINDOW_TOKENIZER_FAILURE'&&e.work.encode_probes===1&&e.work.tokenizer_calls===1);
});

test('SOURCE_FREE final recount can reject a previously measured success; partial stream is never accepted',()=>{
  let calls=0;assert.throws(()=>planNativeContextNodeSearchV3({text:'A',encode:()=>({text:'A'}),countTokens:()=>++calls===1?8:9},{maxTokens:8}),e=>e.code==='NATIVE_WINDOW_TOKENIZER_FAILURE'&&e.reason==='FINAL_COUNT_CHANGED'&&e.partial_stream_accepted===false&&e.work.final_recounts===1&&e.work.tokenizer_calls===2);
  assert.equal(calls,2);
});

test('SOURCE_FREE repaired real-native encodings preserve all marks and terminal zero-width source events',()=>{
  const f=nativeFixture('<u>A🙂BCDEFGH</u><u>\u200B</u>',{dropZeroWidth:true}),offsets=[0];for(const p of f.text)offsets.push(offsets.at(-1)+p.length);
  // Only ten codepoints: finite tiny range table, never the long-fixture strategy.
  const costs=new Map();for(let a=0;a<offsets.length-1;a++)for(let b=a+1;b<offsets.length;b++){const s=nativeRepresentationWindow(f.representation,{start:offsets[a],end:offsets[b]}).text,n=a===0?(b<=4?8:9):b-a===4||b===offsets.length-1&&b-a<=4?8:9;assert.ok(!costs.has(s)||costs.get(s)===n);costs.set(s,n);}
  const out=nativeContextSearchWindowsV3(f.representation,s=>{assert.ok(costs.has(s));return costs.get(s);},{maxTokens:8,overlapWords:0});
  let end=0;for(const w of out.windows){assert.equal(w.source_utf16_start,end);end=w.source_utf16_end;const exact=nativeRepresentationWindow(f.representation,{start:w.source_utf16_start,end:w.source_utf16_end});for(const[k,v]of Object.entries(exact))assert.deepEqual(w[k],v);assert.match(w.text,/NATIVE_SOURCE_MARKS_UNVERIFIED/);assert.match(w.text,/"tag":"u"/);assert.ok(w.weight>0);}
  assert.equal(end,f.text.length);assert.equal(out.windows.reduce((n,w)=>n+w.weight,0),offsets.length-1);assert.ok(out.work.search_edges>0,'Fixture must enter the changed fallback');assert.equal(out.windows.at(-1).source_ranges[0].include_end_zero_width,true);assert.ok(out.windows.slice(0,-1).every(w=>!w.source_ranges[0].include_end_zero_width));
});
