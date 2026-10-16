// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED. Measured source windows only; no model inference.
import {digest,sha,policy as codecPolicy} from './finite-codec.mjs';
export const POLICY='PROTOTYPE_WORDS_THEN_UNICODE_CODEPOINTS_OVERLAP_ZERO_V1_UNADOPTED';
export const DEFAULT_BUDGET=Object.freeze({maxTokens:256,maxSourceCharacters:2097152,maxProbeCharacters:8192,maxEncodedProbeCharacters:262144,maxWindows:8192,maxTokenizerCalls:20000,maxRSSBytes:1073741824});
const fail=(code,message,work)=>{throw Object.assign(new Error(message),{code,retained_failure:true,partial_stream_accepted:false,work:{...work}});};

/** Bounded probes need not find the largest possible window. Every emitted
 * window is independently measured; encoded text is never cut. A resource
 * exhaustion rejects the complete stream and retains a diagnostic. */
export function preparePrototypeWindows(input,counter,options={}){
  if(options===null||typeof options!=='object'||Array.isArray(options)||![Object.prototype,null].includes(Object.getPrototypeOf(options)))throw new Error('Plain explicit prototype budget options required');
  if(Reflect.ownKeys(options).some(key=>typeof key!=='string'||!Object.hasOwn(DEFAULT_BUDGET,key)))throw new Error('Unknown prototype budget option');
  if(Object.values(Object.getOwnPropertyDescriptors(options)).some(property=>!Object.hasOwn(property,'value')||!property.enumerable))throw new Error('Explicit budget data properties required');
  const budget={...DEFAULT_BUDGET,...options};
  for(const [key,value] of Object.entries(budget))if(!Number.isSafeInteger(value)||value<1)throw new Error(`Invalid explicit ${key} budget`);
  if(budget.maxTokens<8||Object.entries(budget).some(([key,value])=>value>DEFAULT_BUDGET[key]))throw new Error('Prototype budget exceeds its predeclared ceiling');
  Object.freeze(budget);
  if(typeof counter?.tokenCount!=='function'||!/^[a-f0-9]{64}$/u.test(counter.policy_sha256??''))throw new Error('Explicit tokenizer policy binding required');
  const text=input.normalizedText.slice(input.start,input.end),work={tokenizer_calls:0,encode_probes:0,maximum_encoded_probe_characters:0,maximum_measured_tokens:0,completed_windows:0,source_characters:text.length,peak_sampled_rss_bytes:process.memoryUsage().rss};
  if(!text.length||text.length>budget.maxSourceCharacters)fail('PROTOTYPE_SOURCE_RESOURCE_BOUND','Selected source interval exceeds its explicit source budget',work);
  const checkRSS=()=>{work.peak_sampled_rss_bytes=Math.max(work.peak_sampled_rss_bytes,process.memoryUsage().rss);if(work.peak_sampled_rss_bytes>budget.maxRSSBytes)fail('PROTOTYPE_RSS_RESOURCE_BOUND','Explicit RSS budget exhausted; no partial input accepted',work);};
  checkRSS();
  const measured=(start,end)=>{
    if(work.encode_probes>=budget.maxTokenizerCalls*2)fail('PROTOTYPE_PROBE_RESOURCE_BOUND','Explicit encode probe budget exhausted',work);work.encode_probes++;
    const encoded=input.encodeWindow({start:input.start+start,end:input.start+end,includeEndZeroWidth:end===text.length});
    work.maximum_encoded_probe_characters=Math.max(work.maximum_encoded_probe_characters,encoded.text.length);
    if(encoded.text.length>budget.maxEncodedProbeCharacters)return {tokens:Infinity};
    if(work.tokenizer_calls>=budget.maxTokenizerCalls)fail('PROTOTYPE_TOKENIZER_WORK_BOUND','Explicit tokenizer call budget exhausted; source retained as failed',work);work.tokenizer_calls++;
    const tokens=counter.tokenCount(encoded.text);if(!Number.isSafeInteger(tokens)||tokens<1)throw new Error('Tokenizer returned invalid count');
    work.maximum_measured_tokens=Math.max(work.maximum_measured_tokens,tokens);if(work.tokenizer_calls%32===0)checkRSS();return {...encoded,tokens};
  };
  const plan=(cuts,segmentation)=>{
    const windows=[];let index=0;
    while(index<cuts.length-1){
      let capLow=index+1,capHigh=cuts.length-1,cap=index;
      while(capLow<=capHigh){const mid=(capLow+capHigh)>>>1;if(cuts[mid]-cuts[index]<=budget.maxProbeCharacters){cap=mid;capLow=mid+1;}else capHigh=mid-1;}
      if(cap===index)return null;
      let low=index+1,high=cap,best=-1;
      while(low<=high){const mid=(low+high)>>>1;if(measured(cuts[index],cuts[mid]).tokens<=budget.maxTokens){best=mid;low=mid+1;}else high=mid-1;}
      if(best<0)return null;
      const window=measured(cuts[index],cuts[best]);if(window.tokens>budget.maxTokens)throw new Error('Final measured window exceeds capacity');
      const literal=text.slice(cuts[index],cuts[best]);
      windows.push({...window,segmentation,tokenizer_policy_sha256:counter.policy_sha256,source_codepoints:Array.from(literal).length,source_utf16_characters:literal.length});
      work.completed_windows=windows.length;if(windows.length>budget.maxWindows)fail('PROTOTYPE_WINDOW_RESOURCE_BOUND','Explicit window count exhausted; source retained as failed',work);
      index=best;
    }
    return windows;
  };
  const words=[...text.matchAll(/\S+/gu)],wordCuts=[0,...words.slice(1).map(match=>match.index),text.length];
  let windows=words.length?plan(wordCuts,'COMPLETE_SOURCE_WORDS'):null;const fallbackUsed=!windows;
  if(!windows){const cuts=[0];for(const point of text)cuts.push(cuts.at(-1)+point.length);windows=plan(cuts,'ALL_LANGUAGE_UNICODE_CODEPOINT_FALLBACK');}
  if(!windows)fail('PROTOTYPE_MINIMUM_CODEPOINT_ENCODING_OVERFLOW','Minimum source codepoint plus complete finite encoding does not fit; retained failed',work);
  let cursor=input.start;for(const window of windows){if(window.source_range.start!==cursor)throw new Error('Source coverage gap');cursor=window.source_range.end;}
  if(cursor!==input.end)throw new Error('Source coverage incomplete');
  const zeros=windows.flatMap(window=>window.zero_events);if(digest(zeros)!==digest(input.features.zero_events))throw new Error('Owned zero events lost or repeated');
  const literal=windows.map(window=>input.normalizedText.slice(window.source_range.start,window.source_range.end)).join('');if(sha(literal)!==input.binding.source_range.sha256)throw new Error('Whole source interval coverage differs');
  checkRSS();return {schema:'prototype-measured-source-windows-v1',status:'PROTOTYPE_UNADOPTED_TOKENIZER_ONLY',authority:'NONE',policy:POLICY,codec_policy_sha256:digest(codecPolicy),input_sha256:digest(input.binding),tokenizer_policy_sha256:counter.policy_sha256,budget,work,windows,fallback_used:fallbackUsed,source_range:input.binding.source_range,zero_event_coverage_sha256:digest(zeros),source_literal_coverage:true,pooling_performed:false,inference:false,adopted:false,overlap:0};
}
