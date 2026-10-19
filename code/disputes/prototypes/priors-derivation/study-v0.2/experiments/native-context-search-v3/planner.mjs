// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED. No IO, models, policy-limit increases, or runtime adoption.
import {nativeRepresentationWindow} from '../../lib/representation.mjs';

export const LIMITS=Object.freeze({maxEncodeProbes:20000,maxTokenizerCalls:20000,maxWindows:8192,maxSourceCharacters:2097152,maxEncodedCharacters:262144});
export const POLICY=Object.freeze({name:'EXPERIMENTAL_NATIVE_CONTEXT_EXACT_EDGE_HINTED_UNICODE_DAG_V3_UNADOPTED',base_planner:'FULL_NATIVE_WORD_FAST_PATH_THEN_BOUNDED_ALL_LANGUAGE_CODEPOINT_PARTITION_V6',base_source_sha256:'51caa5f501b2211702f91c121090f35017f5e2299ea0fb1720341a400b0de0be',declared_node_bridge_source_sha256:'adaa87258e92d269ef6d1c242d019ed971e81845e0795a62d4da8aa72f6ef516',successful_fast_paths:'UNCHANGED_WINDOWS_AND_COUNTER_SEQUENCE',repair:'EXACT_RANGE_SUCCESS_CACHE_THEN_NEARBY_UNICODE_HINTS_THEN_ALL_REMAINING_DESCENDING_ENDPOINTS',cache:'NUMERIC_SUCCESS_GEOMETRY_ONLY; AT_MOST_ONE_RECORD_PER_MEASURED_SUCCESS',shifted_ranges:'HINTS_ONLY; FRESH_ENCODING_AND_COUNT_REQUIRED',recent_span_hints:8,nearby_deltas:Object.freeze([0,-1,1,-2,2]),fallback_weights:'EXACT_NONOVERLAPPING_SOURCE_CODEPOINTS',final_counts:'FRESH_REAL_COUNTER_CALL_FOR_EVERY_RETURNED_WINDOW',feasibility:'UNKNOWN_ON_ANY_RESOURCE_BOUND; OVERFLOW_ONLY_AFTER_EXHAUSTIVE_MEASURED_REACHABLE_DAG',authority:'NONE'});

function integer(n,a,b,name){if(!Number.isSafeInteger(n)||n<a||n>b)throw new TypeError(`${name} must be an integer in ${a}..${b}`);}
function options({maxTokens=256,overlapWords=16,limits={}}={}){
  integer(maxTokens,8,256,'maxTokens');integer(overlapWords,0,128,'overlapWords');
  if(!limits||typeof limits!=='object'||Array.isArray(limits)||Object.keys(limits).some(k=>!Object.hasOwn(LIMITS,k)))throw new Error('Unknown native planner limit');
  const budget={...LIMITS,...limits};for(const[k,n]of Object.entries(budget))integer(n,1,LIMITS[k],k);
  return {maxTokens,overlapWords,budget};
}

/** Trusted exact encoder callback, not an encoder/reader/counter authority.
 * A declared-node caller must first authenticate its complete declaration, native
 * view, source range and counter policy, as the existing V2 node bridge does.
 * Every probe calls this same encoder; only exact successful range geometry can
 * be reused before the final independently encoded/counted output pass. */
export function planNativeContextNodeSearchV3({text,encode,countTokens},opts={}){
  const {maxTokens,overlapWords,budget}=options(opts);
  if(typeof encode!=='function'||typeof countTokens!=='function')throw new TypeError('Exact encoder and counter callbacks required');
  const work={encode_probes:0,tokenizer_calls:0,encoding_bound_probes:0,over_limit_probes:0,maximum_measured_tokens:0,fast_windows_completed:0,search_edges:0,final_recounts:0};
  const cause=error=>{try{const d=Object.getOwnPropertyDescriptor(error,'code');return typeof d?.value==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/u.test(d.value)?d.value:null;}catch{return null;}};
  const fail=(code,message,reason,error)=>{throw Object.assign(new Error(message),{code,reason,retained_failure:true,partial_stream_accepted:false,work:{...work}},error?{cause_code:cause(error)}:{});};
  if(typeof text!=='string'||!text.trim())fail('NATIVE_WINDOW_ENCODING_FAILURE','Empty node source retained failed','EMPTY_NODE');
  if(text.length>budget.maxSourceCharacters)fail('NATIVE_WINDOW_SEARCH_BOUND','Native source exceeds the declared planner bound; feasibility remains unknown','SOURCE_CHARACTERS');
  const words=Array.from(text.matchAll(/\S+/gu),match=>({start:match.index,end:match.index+match[0].length,text:match[0]}));
  // At most maxEncodeProbes pairs, never source/encoded strings. A success at
  // (a,b) is NOT a success for (a+1,b), even when the earlier window overlapped.
  const successes=new Map();let successPairs=0,searching=false,spanHints=[];
  let points,offsets;
  const codepoints=()=>{if(!points){points=Array.from(text);offsets=[0];for(const value of points)offsets.push(offsets.at(-1)+value.length);}};
  const pointIndex=utf16=>{let low=0,high=offsets.length-1;while(low<=high){const middle=(low+high)>>>1;if(offsets[middle]===utf16)return middle;if(offsets[middle]<utf16)low=middle+1;else high=middle-1;}fail('NATIVE_WINDOW_ENCODING_FAILURE','Measured boundary is not Unicode-safe','SOURCE_BOUNDARY');};
  const hint=span=>{spanHints=[span,...spanHints.filter(n=>n!==span)].slice(0,POLICY.recent_span_hints);};
  const remember=(start,end)=>{let ends=successes.get(start);if(!ends){ends=new Set();successes.set(start,ends);}if(!ends.has(end)){ends.add(end);successPairs++;if(successPairs>budget.maxEncodeProbes)fail('NATIVE_WINDOW_SEARCH_BOUND','Native numeric success cache exceeded its probe bound','ENCODE_PROBES');}if(searching)hint(pointIndex(end)-pointIndex(start));};
  const measured=(start,end)=>{
    if(work.encode_probes>=budget.maxEncodeProbes)fail('NATIVE_WINDOW_SEARCH_BOUND','Native encode probe budget exhausted; feasibility remains unknown','ENCODE_PROBES');work.encode_probes++;
    let encoded;try{encoded=encode(start,end);if(!encoded||typeof encoded.text!=='string')throw new TypeError('Encoder must return text');}catch(error){if(cause(error)==='NATIVE_DECORATION_PROJECTION_BOUND'){work.encoding_bound_probes++;return{tokens:Infinity,encoding_bound:true};}fail('NATIVE_WINDOW_ENCODING_FAILURE','Native range encoding failed; source retained as failed','ENCODER_FAILURE',error);}
    if(encoded.text.length>budget.maxEncodedCharacters){work.encoding_bound_probes++;return{tokens:Infinity,encoding_bound:true};}
    if(work.tokenizer_calls>=budget.maxTokenizerCalls)fail('NATIVE_WINDOW_SEARCH_BOUND','Native tokenizer call budget exhausted; feasibility remains unknown','TOKENIZER_CALLS');work.tokenizer_calls++;
    let tokens;try{tokens=countTokens(encoded.text);}catch(error){fail('NATIVE_WINDOW_TOKENIZER_FAILURE','Native token counter failed; source retained as failed','COUNTER_FAILURE',error);}if(!Number.isSafeInteger(tokens)||tokens<1)fail('NATIVE_WINDOW_TOKENIZER_FAILURE','Tokenizer returned an invalid count','INVALID_COUNT');work.maximum_measured_tokens=Math.max(work.maximum_measured_tokens,tokens);if(tokens>maxTokens)work.over_limit_probes++;else remember(start,end);return{...encoded,tokens};
  };
  const finalWindow=(start,end)=>{work.final_recounts++;const w=measured(start,end);if(w.encoding_bound)fail('NATIVE_WINDOW_ENCODING_BOUND','Final native range exceeded its encoding bound','FINAL_ENCODING_BOUND');if(w.tokens>maxTokens)fail('NATIVE_WINDOW_TOKENIZER_FAILURE','Final native count changed beyond capacity','FINAL_COUNT_CHANGED');return w;};
  const windowBound=windows=>{if(windows.length>budget.maxWindows)fail('NATIVE_WINDOW_SEARCH_BOUND','Native window budget exhausted; feasibility remains unknown','WINDOW_COUNT');};
  const characterFast=(overlap,segmentation)=>{
    codepoints();const windows=[];let start=0,previousEnd=0;
    while(start<points.length){let low=start+1,high=Math.min(points.length,start+maxTokens*4),end=start;
      while(low<=high){const middle=(low+high)>>>1;if(measured(offsets[start],offsets[middle]).tokens<=maxTokens){end=middle;low=middle+1;}else high=middle-1;}
      if(end===start||end<=previousEnd)return null;const window=finalWindow(offsets[start],offsets[end]);
      windows.push({...window,source_character_start:start,source_character_end:end,source_utf16_start:offsets[start],source_utf16_end:offsets[end],weight:end-Math.max(start,previousEnd),weight_unit:'new_source_codepoints',segmentation});work.fast_windows_completed++;windowBound(windows);
      previousEnd=end;if(end===points.length)break;start=Math.max(start+1,end-Math.min(overlap,end-start-1));
    }return windows;
  };
  const hintedExhaustiveFallback=()=>{
    codepoints();searching=true;
    // Initial span order is finite and derived from the already measured exact
    // successes. Converting offsets changes no geometry or success assertion.
    for(const[a,ends]of successes)for(const b of ends)hint(pointIndex(b)-pointIndex(a));
    const encodingBefore=work.encoding_bound_probes,dead=new Set();let path=null;
    const frame=(start,via)=>{
      const priority=[],seen=new Set(),add=end=>{if(end>start&&end<=points.length&&!seen.has(end)){seen.add(end);priority.push(end);}};
      const exact=successes.get(offsets[start]);if(exact)for(const end of [...exact].sort((a,b)=>b-a))add(pointIndex(end));
      // Shifted geometry is ONLY an ordering hint. The exact-cache lookup below
      // still requires this frame's exact source start and exact endpoint.
      for(const span of spanHints)for(const delta of POLICY.nearby_deltas)add(start+span+delta);
      const basis=spanHints[0]??maxTokens*4;
      for(let span=basis;span>=1;span=Math.floor(span/2))for(const delta of POLICY.nearby_deltas)add(start+span+delta);
      for(let span=basis*2;span<=Math.min(points.length-start,maxTokens*4);span*=2)for(const delta of POLICY.nearby_deltas)add(start+span+delta);
      return {start,via,priority,index:0,next:points.length,seen};
    };
    const stack=[frame(0,null)];
    while(stack.length){const f=stack.at(-1);let end;
      if(f.index<f.priority.length)end=f.priority[f.index++];
      else{while(f.next>f.start&&f.seen.has(f.next))f.next--;if(f.next<=f.start){dead.add(f.start);stack.pop();continue;}end=f.next--;}
      if(work.search_edges>=budget.maxEncodeProbes)fail('NATIVE_WINDOW_SEARCH_BOUND','Native candidate-edge budget exhausted; feasibility remains unknown','SEARCH_EDGES');work.search_edges++;
      if(dead.has(end))continue;
      const cached=successes.get(offsets[f.start])?.has(offsets[end])===true;
      if(!cached&&measured(offsets[f.start],offsets[end]).tokens>maxTokens)continue;
      const edge={start:f.start,end};if(end===points.length){path=[...stack.slice(1).map(x=>x.via),edge];break;}
      if(stack.length>=budget.maxWindows)fail('NATIVE_WINDOW_SEARCH_BOUND','Native partition search reached its window bound; feasibility remains unknown','WINDOW_COUNT');stack.push(frame(end,edge));
    }
    if(!path){if(work.encoding_bound_probes>encodingBefore)fail('NATIVE_WINDOW_ENCODING_BOUND','Complete native candidates exceeded encoding/projection bounds; token feasibility remains unknown','UNMEASURED_ENCODING_BOUND');fail('NATIVE_WINDOW_TOKEN_OVERFLOW','Exhaustively measured native candidates admit no complete source partition; source retained as failed','EXHAUSTIVE_MEASURED_NO_PARTITION');}
    const windows=path.map(edge=>{const window=finalWindow(offsets[edge.start],offsets[edge.end]);return{...window,source_character_start:edge.start,source_character_end:edge.end,source_utf16_start:offsets[edge.start],source_utf16_end:offsets[edge.end],weight:edge.end-edge.start,weight_unit:'new_source_codepoints',segmentation:'experimental_native_hinted_exhaustive_codepoint_partition_v3'};});windowBound(windows);windows[0].native_planner_work={...work};return windows;
  };
  const fallback=cjk=>{const fast=characterFast(cjk?overlapWords:0,cjk?'native_cjk_codepoint_boundaries_before_encoding':'native_all_language_nonoverlapping_codepoint_boundaries_v1');if(!fast)return hintedExhaustiveFallback();if(!cjk)fast[0].native_planner_work={...work};return fast;};
  const run=()=>{
    const windows=[];let start=0,previousEnd=0;
    while(start<words.length){let low=start+1,high=words.length,end=start;
      const left=start===0?0:words[start].start,right=index=>index===words.length?text.length:words[index].start;
      while(low<=high){const middle=(low+high)>>>1;if(measured(left,right(middle)).tokens<=maxTokens){end=middle;low=middle+1;}else high=middle-1;}
      if(end===start)return fallback(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(words[start].text));
      if(end<=previousEnd)return fallback(false);
      const window=finalWindow(left,right(end));windows.push({...window,word_start:start,word_end:end,source_utf16_start:left,source_utf16_end:right(end),weight:end-Math.max(start,previousEnd),weight_unit:'new_source_words',segmentation:'native_complete_words_before_encoding'});work.fast_windows_completed++;windowBound(windows);
      previousEnd=end;if(end===words.length)break;start=Math.max(start+1,end-Math.min(overlapWords,end-start-1));
    }return windows;
  };
  return {windows:run(),work:{...work}};
}

/** Exact existing native encoder, including the original terminal zero-width
 * rule and source/decorations metadata. No prefix, concatenation or text cuts. */
export function nativeContextSearchWindowsV3(representation,countTokens,opts={}){
  return planNativeContextNodeSearchV3({text:representation?.text,encode:(start,end)=>nativeRepresentationWindow(representation,{start,end}),countTokens},opts);
}
