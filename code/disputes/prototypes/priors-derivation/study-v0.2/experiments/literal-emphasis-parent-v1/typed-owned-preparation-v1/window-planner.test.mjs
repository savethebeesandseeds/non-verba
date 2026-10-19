// SPDX-License-Identifier: AGPL-3.0-only
// Internally authored literal/counter fixtures. No actual sources or tokenizers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePrototypeWindows as original} from '../window-planner.mjs';
import {prepareTypedWindows,DEFAULT_BUDGET} from './window-planner.mjs';
import {sha,digest,featureAtom,decodeModelText} from '../finite-codec.mjs';
const POLICY=sha('SYNTHETIC_COUNTER_POLICY'),STREAM='SYNTHETIC_CASE:'+POLICY+':focal';
function input(text,zero_events=[],encode=literal=>literal){
  return{normalizedText:text,start:0,end:text.length,features:{zero_events},binding:{source_range:{start:0,end:text.length,sha256:sha(text)}},encodeWindow({start,end,includeEndZeroWidth}){
    const literal=text.slice(start,end),encoded=encode(literal),zeros=zero_events.filter(z=>z.position>=start&&(z.position<end||includeEndZeroWidth&&z.position===end));
    return{text:encoded,sha256:sha(encoded),source_range:{start,end,sha256:sha(literal)},zero_events:zeros,include_end_zero_width:includeEndZeroWidth};
  }};
}
function counter(events=[]){return{policy_sha256:POLICY,tokenCount(text){const tokens=Array.from(text).length+2;events.push({kind:'COUNT',sha256:sha(text),tokens});return tokens;}};}
const portable=result=>{const copy=structuredClone(result);delete copy.work.peak_sampled_rss_bytes;return copy;};
const budget={maxTokens:8,maxProbeCharacters:8};

test('absent hook preserves complete old output/work/options for words, fallback and zero events',()=>{
  for(const text of['SYNTHETIC tiny','aa bb LONGWORDabcdefgh','🧭α中β abc def']){
    const value=input(text,[{position:0,mask:2048},{position:text.length,mask:2048}]),a=[],b=[];
    assert.deepEqual(portable(prepareTypedWindows(value,counter(a),budget)),portable(original(value,counter(b),budget)));
    assert.deepEqual(a,b);
  }
});
test('strict old budget ceilings remain and hook context is separate from budget options',()=>{
  assert.throws(()=>prepareTypedWindows(input('SYNTHETIC'),counter(),{onFinalWindow(){}}),/Unknown prototype budget option/);
  assert.throws(()=>prepareTypedWindows(input('SYNTHETIC'),counter(),{maxTokens:DEFAULT_BUDGET.maxTokens+1}),/predeclared ceiling/);
  let reads=0;const context={streamID:STREAM};Object.defineProperty(context,'onFinalWindow',{enumerable:true,get(){reads++;return()=>{};}});
  assert.throws(()=>prepareTypedWindows(input('SYNTHETIC'),counter(),{},context),/Exact owned final-window context/);assert.equal(reads,0);
});
test('each hook binds the immediately previous final count and exact encoded identity',()=>{
  const events=[],commits=[],value=input('aa bb cc dd ee');
  const result=prepareTypedWindows(value,counter(events),budget,{streamID:STREAM,onFinalWindow(event){
    const prior=events.at(-1);assert.equal(prior.kind,'COUNT');assert.equal(prior.sha256,event.input_sha256);assert.equal(prior.tokens,event.tokens);
    assert.equal(event.stream_id,STREAM);assert.equal(event.tokenizer_policy_sha256,POLICY);assert.equal(event.window_index,commits.length);
    assert.ok(Object.isFrozen(event));assert.ok(Object.isFrozen(event.source_range));commits.push(event);events.push({kind:'COMMIT'});
  }});
  assert.equal(commits.length,result.windows.length);assert.equal(result.work.final_window_commits,result.windows.length);
  assert.equal(result.work.final_window_recounts,result.windows.length);
  for(let i=0;i<commits.length;i++){assert.equal(commits[i].input_sha256,result.windows[i].sha256);assert.equal(commits[i].tokens,result.windows[i].tokens);}
});
test('late word failure commits only the complete chosen codepoint fallback, never abandoned words',()=>{
  const value=input('aa bb LONGWORDabcdefgh'),baseline=original(value,counter(),budget),events=[],commits=[];
  const result=prepareTypedWindows(value,counter(events),budget,{streamID:STREAM,onFinalWindow(event){commits.push({event,counts:events.filter(e=>e.kind==='COUNT').length});events.push({kind:'COMMIT'});}});
  assert.equal(result.fallback_used,true);assert.ok(result.windows.every(w=>w.segmentation==='ALL_LANGUAGE_UNICODE_CODEPOINT_FALLBACK'));
  assert.equal(commits.length,result.windows.length);assert.equal(commits[0].counts,baseline.work.tokenizer_calls+1);
  assert.equal(result.work.tokenizer_calls,baseline.work.tokenizer_calls+result.windows.length);
  assert.equal(result.work.planned_windows,result.windows.length);
});
test('fresh final tokens are authoritative rather than the earlier planning count',()=>{
  const value=input('aa'),baseline=original(value,counter(),budget);let calls=0;const events=[];
  const c={policy_sha256:POLICY,tokenCount(text){calls++;return Array.from(text).length+2+(calls>baseline.work.tokenizer_calls?1:0);}};
  const result=prepareTypedWindows(value,c,budget,{streamID:STREAM,onFinalWindow:e=>{events.push(e);}});
  assert.equal(baseline.windows[0].tokens,4);assert.equal(events[0].tokens,5);assert.equal(result.windows[0].tokens,5);
  assert.equal(result.work.maximum_measured_tokens,5);assert.equal(calls,baseline.work.tokenizer_calls+1);
});
test('expanded escaped finite wrappers remain whole and bind encoded rather than literal hashes',()=>{
  const text='aa [b] \\ cc',value=input(text,[],literal=>featureAtom(literal,1)),events=[];
  const c={policy_sha256:POLICY,tokenCount(encoded){return Array.from(decodeModelText(encoded)).length+2;}};
  const result=prepareTypedWindows(value,c,budget,{streamID:STREAM,onFinalWindow:e=>{events.push(e);}});
  assert.equal(result.windows.map(w=>decodeModelText(w.text)).join(''),text);
  for(let i=0;i<result.windows.length;i++){const w=result.windows[i];assert.ok(w.text.startsWith('[NF strike]'));assert.ok(w.text.endsWith('[/NF]'));assert.equal(events[i].input_sha256,sha(w.text));assert.notEqual(events[i].input_sha256,w.source_range.sha256);}
});
test('hook rejection retains spent work and earlier bindings only as whole-stream failure diagnostics',()=>{
  let commits=0,error;const value=input('aa bb cc dd ee ff'),baseline=original(value,counter(),budget);
  try{prepareTypedWindows(value,counter(),budget,{streamID:STREAM,onFinalWindow(){if(++commits===2)throw Object.assign(Error('SYNTHETIC_REJECT'),{code:'SYNTHETIC_WINDOW_REJECTED'});}});}catch(e){error=e;}
  assert.equal(error.code,'PROTOTYPE_FINAL_WINDOW_COMMIT_REJECTED');assert.equal(error.cause_code,'SYNTHETIC_WINDOW_REJECTED');
  assert.equal(error.retained_failure,true);assert.equal(error.partial_stream_accepted,false);
  assert.equal(error.work.completed_windows,1);assert.equal(error.work.final_window_commits,1);assert.equal(error.work.final_window_recounts,2);
  assert.equal(error.work.tokenizer_calls,baseline.work.tokenizer_calls+2);
});
test('false or asynchronous hook return is rejected rather than accepted or awaited',()=>{
  for(const returned of[false,Promise.resolve(true)])assert.throws(()=>prepareTypedWindows(input('aa'),counter(),budget,{streamID:STREAM,onFinalWindow(){return returned;}}),e=>e.code==='PROTOTYPE_FINAL_WINDOW_COMMIT_REJECTED'&&e.partial_stream_accepted===false&&e.work.completed_windows===0);
});
test('final recounts receive no extra tokenizer allowance',()=>{
  const value=input('aa bb cc'),baseline=original(value,counter(),budget);let commits=0;
  assert.throws(()=>prepareTypedWindows(value,counter(),{...budget,maxTokenizerCalls:baseline.work.tokenizer_calls},{streamID:STREAM,onFinalWindow(){commits++;}}),e=>e.code==='PROTOTYPE_TOKENIZER_WORK_BOUND'&&e.work.tokenizer_calls===baseline.work.tokenizer_calls&&e.work.completed_windows===0&&e.partial_stream_accepted===false);
  assert.equal(commits,0);
});
test('terminal and internal zero events and Unicode literal coverage remain complete with commitment',()=>{
  const text='🧭α中β abc def',zero=[{position:0,mask:2048},{position:3,mask:2048},{position:text.length,mask:2048}],value=input(text,zero),events=[];
  const result=prepareTypedWindows(value,counter(),budget,{streamID:STREAM,onFinalWindow:e=>{events.push(e);return true;}});
  assert.equal(result.source_literal_coverage,true);assert.equal(result.overlap,0);
  assert.equal(digest(result.windows.flatMap(w=>w.zero_events)),digest(zero));
  assert.equal(result.windows.map(w=>text.slice(w.source_range.start,w.source_range.end)).join(''),text);
  assert.equal(events.at(-1).include_end_zero_width,true);assert.ok(result.windows.every(w=>w.tokens<=8));
});
test('final counter failure retains its attempted call and does not commit a window',()=>{
  const value=input('aa bb'),baseline=original(value,counter(),budget);let calls=0,commits=0;
  const c={policy_sha256:POLICY,tokenCount(text){if(++calls>baseline.work.tokenizer_calls)throw Object.assign(Error('SYNTHETIC_LIMIT'),{code:'SYNTHETIC_COUNTER_LIMIT'});return Array.from(text).length+2;}};
  assert.throws(()=>prepareTypedWindows(value,c,budget,{streamID:STREAM,onFinalWindow(){commits++;}}),e=>e.code==='PROTOTYPE_FINAL_WINDOW_COMMIT_REJECTED'&&e.cause_code==='SYNTHETIC_COUNTER_LIMIT'&&e.work.final_window_recounts===1&&e.work.tokenizer_calls===baseline.work.tokenizer_calls+1&&e.work.completed_windows===0);
  assert.equal(commits,0);
});
