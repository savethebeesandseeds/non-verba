// SPDX-License-Identifier: AGPL-3.0-only
// Exact frozen S6 V6 planner; same-module trial representation binding only.
import {nativeRepresentationWindow} from './representation.mjs';
function integer(value, min, max, name) { if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${name} must be an integer in ${min}..${max}`); return value; }
export const NATIVE_WINDOW_LIMITS=Object.freeze({maxEncodeProbes:20000,maxTokenizerCalls:20000,maxWindows:8192,maxSourceCharacters:2097152,maxEncodedCharacters:262144});
export const NATIVE_WINDOW_PLANNER_POLICY='FULL_NATIVE_WORD_FAST_PATH_THEN_BOUNDED_ALL_LANGUAGE_CODEPOINT_PARTITION_V6';
export function nativeEmbeddingWindows(representation,countTokens,{maxTokens=256,overlapWords=16,limits={}}={}) {
  integer(maxTokens,8,256,'maxTokens');integer(overlapWords,0,128,'overlapWords');
  if(!limits||typeof limits!=='object'||Array.isArray(limits)||Object.keys(limits).some(k=>!Object.hasOwn(NATIVE_WINDOW_LIMITS,k)))throw new Error('Unknown native planner limit');
  const budget={...NATIVE_WINDOW_LIMITS,...limits};for(const[k,n]of Object.entries(budget))integer(n,1,NATIVE_WINDOW_LIMITS[k],k);
  const work={encode_probes:0,tokenizer_calls:0,encoding_bound_probes:0,over_limit_probes:0,maximum_measured_tokens:0,fast_windows_completed:0,search_edges:0,final_recounts:0};
  const cause=error=>{try{const d=Object.getOwnPropertyDescriptor(error,'code');return typeof d?.value==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/u.test(d.value)?d.value:null;}catch{return null;}};
  const fail=(code,message,reason,error)=>{throw Object.assign(new Error(message),{code,reason,retained_failure:true,partial_stream_accepted:false,work:{...work}},error?{cause_code:cause(error)}:{});};
  const text=representation?.text;if(typeof text!=='string'||!text.trim())throw new Error('Native representation must contain source text');
  if(text.length>budget.maxSourceCharacters)fail('NATIVE_WINDOW_SEARCH_BOUND','Native source exceeds the declared planner bound; feasibility remains unknown','SOURCE_CHARACTERS');
  const words=Array.from(text.matchAll(/\S+/gu),match=>({start:match.index,end:match.index+match[0].length,text:match[0]}));
  const measured=(start,end)=>{
    if(work.encode_probes>=budget.maxEncodeProbes)fail('NATIVE_WINDOW_SEARCH_BOUND','Native encode probe budget exhausted; feasibility remains unknown','ENCODE_PROBES');work.encode_probes++;
    let encoded;try{encoded=nativeRepresentationWindow(representation,{start,end});}catch(error){if(error.code==='NATIVE_DECORATION_PROJECTION_BOUND'){work.encoding_bound_probes++;return{tokens:Infinity,encoding_bound:true};}fail('NATIVE_WINDOW_ENCODING_FAILURE','Native range encoding failed; source retained as failed','ENCODER_FAILURE',error);}
    if(encoded.text.length>budget.maxEncodedCharacters){work.encoding_bound_probes++;return{tokens:Infinity,encoding_bound:true};}
    if(work.tokenizer_calls>=budget.maxTokenizerCalls)fail('NATIVE_WINDOW_SEARCH_BOUND','Native tokenizer call budget exhausted; feasibility remains unknown','TOKENIZER_CALLS');work.tokenizer_calls++;
    let tokens;try{tokens=countTokens(encoded.text);}catch(error){fail('NATIVE_WINDOW_TOKENIZER_FAILURE','Native token counter failed; source retained as failed','COUNTER_FAILURE',error);}if(!Number.isSafeInteger(tokens)||tokens<1)fail('NATIVE_WINDOW_TOKENIZER_FAILURE','Tokenizer returned an invalid count','INVALID_COUNT');work.maximum_measured_tokens=Math.max(work.maximum_measured_tokens,tokens);if(tokens>maxTokens)work.over_limit_probes++;return{...encoded,tokens};
  };
  const finalWindow=(start,end)=>{work.final_recounts++;const w=measured(start,end);if(w.encoding_bound)fail('NATIVE_WINDOW_ENCODING_BOUND','Final native range exceeded its encoding bound','FINAL_ENCODING_BOUND');if(w.tokens>maxTokens)fail('NATIVE_WINDOW_TOKENIZER_FAILURE','Final native count changed beyond capacity','FINAL_COUNT_CHANGED');return w;};
  let points,offsets;const codepoints=()=>{if(!points){points=Array.from(text);offsets=[0];for(const value of points)offsets.push(offsets.at(-1)+value.length);}};
  const windowBound=windows=>{if(windows.length>budget.maxWindows)fail('NATIVE_WINDOW_SEARCH_BOUND','Native window budget exhausted; feasibility remains unknown','WINDOW_COUNT');};
  const characterFast=(overlap,segmentation)=>{
    codepoints();
    const windows=[];let start=0,previousEnd=0;
    while(start<points.length){let low=start+1,high=Math.min(points.length,start+maxTokens*4),end=start;
      while(low<=high){const middle=(low+high)>>>1;if(measured(offsets[start],offsets[middle]).tokens<=maxTokens){end=middle;low=middle+1;}else high=middle-1;}
      if(end===start||end<=previousEnd)return null;
      const window=finalWindow(offsets[start],offsets[end]);
      windows.push({...window,source_character_start:start,source_character_end:end,source_utf16_start:offsets[start],source_utf16_end:offsets[end],weight:end-Math.max(start,previousEnd),weight_unit:'new_source_codepoints',segmentation});work.fast_windows_completed++;windowBound(windows);
      previousEnd=end;if(end===points.length)break;start=Math.max(start+1,end-Math.min(overlap,end-start-1));
    }return windows;
  };
  // Fast probes establish measured success only. Their failure does not prove
  // monotone counts: enumerate the Unicode DAG and backtrack past dead suffixes.
  // Repaired partitions tile the source without overlap; each weight is unique
  // source-codepoint coverage, not comparability with the old overlap16 arm.
  const exhaustiveFallback=()=>{
    codepoints();const encodingBefore=work.encoding_bound_probes,dead=new Set(),stack=[{start:0,next:points.length,via:null}];let path=null;
    while(stack.length){const frame=stack.at(-1);if(frame.next<=frame.start){dead.add(frame.start);stack.pop();continue;}if(work.search_edges>=budget.maxEncodeProbes)fail('NATIVE_WINDOW_SEARCH_BOUND','Native candidate-edge budget exhausted; feasibility remains unknown','SEARCH_EDGES');const end=frame.next--;work.search_edges++;if(dead.has(end))continue;const probe=measured(offsets[frame.start],offsets[end]);if(probe.tokens>maxTokens)continue;
      const edge={start:frame.start,end};if(end===points.length){path=[...stack.slice(1).map(f=>f.via),edge];break;}
      if(stack.length>=budget.maxWindows)fail('NATIVE_WINDOW_SEARCH_BOUND','Native partition search reached its window bound; feasibility remains unknown','WINDOW_COUNT');stack.push({start:end,next:points.length,via:edge});
    }
    if(!path){if(work.encoding_bound_probes>encodingBefore)fail('NATIVE_WINDOW_ENCODING_BOUND','Complete native candidates exceeded encoding/projection bounds; token feasibility remains unknown','UNMEASURED_ENCODING_BOUND');fail('NATIVE_WINDOW_TOKEN_OVERFLOW','Exhaustively measured native candidates admit no complete source partition; source retained as failed','EXHAUSTIVE_MEASURED_NO_PARTITION');}
    const windows=path.map(edge=>{const window=finalWindow(offsets[edge.start],offsets[edge.end]);return{...window,source_character_start:edge.start,source_character_end:edge.end,source_utf16_start:offsets[edge.start],source_utf16_end:offsets[edge.end],weight:edge.end-edge.start,weight_unit:'new_source_codepoints',segmentation:'native_all_language_exhaustive_codepoint_partition_v1'};});windowBound(windows);windows[0].native_planner_work={...work};return windows;
  };
  const fallback=cjk=>{const fast=characterFast(cjk?overlapWords:0,cjk?'native_cjk_codepoint_boundaries_before_encoding':'native_all_language_nonoverlapping_codepoint_boundaries_v1');if(!fast)return exhaustiveFallback();if(!cjk)fast[0].native_planner_work={...work};return fast;};
  const windows=[];let start=0,previousEnd=0;
  while(start<words.length){let low=start+1,high=words.length,end=start;
    const left=start===0?0:words[start].start,right=index=>index===words.length?text.length:words[index].start;
    while(low<=high){const middle=(low+high)>>>1;if(measured(left,right(middle)).tokens<=maxTokens){end=middle;low=middle+1;}else high=middle-1;}
    if(end===start)return fallback(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(words[start].text));
    if(end<=previousEnd)return fallback(false);
    const window=finalWindow(left,right(end));
    windows.push({...window,word_start:start,word_end:end,source_utf16_start:left,source_utf16_end:right(end),weight:end-Math.max(start,previousEnd),weight_unit:'new_source_words',segmentation:'native_complete_words_before_encoding'});work.fast_windows_completed++;windowBound(windows);
    previousEnd=end;if(end===words.length)break;start=Math.max(start+1,end-Math.min(overlapWords,end-start-1));
  }
  return windows;
}
