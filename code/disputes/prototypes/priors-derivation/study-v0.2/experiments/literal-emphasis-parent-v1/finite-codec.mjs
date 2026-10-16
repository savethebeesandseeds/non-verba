// SPDX-License-Identifier: AGPL-3.0-only
// NEW prospective QA core: information-reduced model features; authentication is owned by adapter.
import {createHash} from 'node:crypto';
import {immutableCopy} from './immutable-state.mjs';
export const POLICY='PROTOTYPE_UNADOPTED_INFORMATION_REDUCED_LITERAL_EMPHASIS_9_V1';
export const TAGS=Object.freeze(['strike','s','del','ins','u','b','strong','i','em']);
export const CSS=512,JOINT=1024,ZERO=2048,LAYOUT=4096;
export const policy=immutableCopy({schema:'qa-finite-native-feature-policy-v1',policy:POLICY,status:'INFORMATION_REDUCED_NOT_LOSSLESS_MODEL_INPUT',authority:'NONE',adopted:false,prospective_qa_only:true,tags:TAGS,unavailable_tag_features:['font'],flags:['CSS_UNKNOWN','JOINT_ORIGIN_ATTRIBUTION_UNKNOWN','ZERO_EVENT','NORMALIZED_LAYOUT_SOURCE_UNKNOWN'],normalization_gaps:'ONLY_FROZEN_COLLECTOR_WHITESPACE_OR_LITERAL_PIPE_GAPS; LITERAL_PRESERVED; NO_NATIVE_NEUTRAL_OR_MARK_ORIGIN_ASSERTION; EXACT_GAP_RANGES_AND_HASHES_EXTERNAL',joint:'NO_NATIVE_TAG_ASSIGNMENT_TO_JOINT_OUTPUT; CSS_PRESENCE_ONLY_UNKNOWN; EXACT_FULL_ORDERED_ORIGINS_EXTERNAL',same_path_joint:'ALSO_JOINT_UNKNOWN; NO_SURVIVING_CHARACTER_ORIGIN_ASSIGNED',duplicates:'SET_UNION_MODEL_FEATURES_ONLY; MERGE_ADJACENT_EQUAL_MASKS_EXCEPT_OWNED_ZERO_BARRIERS; ALL_ORDER_AND_MULTIPLICITY_EXTERNAL',zero:'SET_UNION_PRESENCE_AT_OWNED_BOUNDARY; NONLOCALIZED_FILTER_EVENTS_AT_GROUP_START_AS_NEW_MODEL_CHOICE; EXACT_EVENTS_EXTERNAL',escaping:'BACKSLASH_DOUBLED_AND_LITERAL_LEFT_BRACKET_BACKSLASH_ESCAPED; STRICT_REVERSIBLE_GRAMMAR',serialization:'[NF optional-fixed-tag-and-flag-names]escaped-literal[/NF]; unmarked literals escaped without wrapper; zero marker has empty literal',windows:'COMPLETE_SOURCE_WORD_BOUNDARIES_THEN_ALL_LANGUAGE_CODEPOINT_FALLBACK; NONOVERLAPPING; ACTUAL_TOKENIZER_RECOUNT; NO_ENCODED_TRUNCATION',max_tokens:256,maximum_windows:8192,semantic_equivalence:false,computed_style_verified:false,effectiveness_verified:false,whole_parent_or_raw_reading_claim:false});
export const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
export const sha=v=>createHash('sha256').update(v).digest('hex');
export const digest=v=>sha(canonical(v));
function fail(message){throw Object.assign(new Error(message),{code:'QA_FINITE_FEATURE_INVARIANT'});}
function point(text,n){return !(n>0&&n<text.length&&/[\uD800-\uDBFF]/u.test(text[n-1])&&/[\uDC00-\uDFFF]/u.test(text[n]));}
function range(text,start,end,empty=false){if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start+(empty?0:1)||end>text.length||!point(text,start)||!point(text,end))fail('Invalid exact codepoint-safe source range');}
function validMask(mask){return Number.isSafeInteger(mask)&&((mask>=0&&mask<4096&&(!(mask&JOINT)||!(mask&511)))||mask===LAYOUT);}
const names=mask=>[...TAGS.filter((_,i)=>mask&(1<<i)),...(mask&CSS?['CSS_UNKNOWN']:[]),...(mask&JOINT?['JOINT_ORIGIN_ATTRIBUTION_UNKNOWN']:[]),...(mask&ZERO?['ZERO_EVENT']:[]),...(mask&LAYOUT?['NORMALIZED_LAYOUT_SOURCE_UNKNOWN']:[])];
const escape=text=>text.replaceAll('\\','\\\\').replaceAll('[','\\[');
export function featureAtom(text,mask){if(!validMask(mask)||typeof text!=='string'||mask===LAYOUT&&!/^[\s|]*$/u.test(text))fail('Invalid finite feature mask or nonseparator layout literal');return mask?'[NF '+names(mask).join(' ')+']'+escape(text)+'[/NF]':escape(text);}
export function decodeModelText(text){
  let result='',i=0,open=false,activeMask=0;
  while(i<text.length){
    if(text[i]==='\\'){const next=text[i+1];if(next!=='\\'&&next!=='[')fail('Invalid model escape');if(activeMask===LAYOUT)fail('Nonseparator literal in layout wrapper');result+=next;i+=2;continue;}
    if(text.startsWith('[NF ',i)){if(open)fail('Nested feature wrappers');const end=text.indexOf(']',i);if(end<0)fail('Unclosed feature wrapper');const fields=text.slice(i+4,end).split(' '),all=[...TAGS,'CSS_UNKNOWN','JOINT_ORIGIN_ATTRIBUTION_UNKNOWN','ZERO_EVENT','NORMALIZED_LAYOUT_SOURCE_UNKNOWN'];if(fields.some(f=>!all.includes(f))||new Set(fields).size!==fields.length)fail('Unknown finite feature');let mask=0;for(const f of fields){const at=TAGS.indexOf(f);mask|=at>=0?1<<at:f==='CSS_UNKNOWN'?CSS:f==='JOINT_ORIGIN_ATTRIBUTION_UNKNOWN'?JOINT:f==='NORMALIZED_LAYOUT_SOURCE_UNKNOWN'?LAYOUT:ZERO;}if(!validMask(mask)||names(mask).join(' ')!==fields.join(' '))fail('Noncanonical finite feature');open=true;activeMask=mask;i=end+1;continue;}
    if(text.startsWith('[/NF]',i)){if(!open)fail('Unexpected feature close');open=false;activeMask=0;i+=5;continue;}
    if(text[i]==='[')fail('Unescaped model marker collision');if(activeMask===LAYOUT&&!/[\s|]/u.test(text[i]))fail('Nonseparator literal in layout wrapper');result+=text[i++];
  }
  if(open)fail('Unclosed model feature');return result;
}

/** Derivation only. This function does not authenticate actual corpus evidence. */
export function deriveFiniteNine({normalizedText,envelope,evidence,qualification,start,end}){
  const {sha256:seal,...envelopeBody}=envelope;if(digest(envelopeBody)!==seal||envelope.normalized.sha256!==sha(normalizedText))fail('Finite source envelope/normalized binding changed');if(!['EXACT_SOURCE_EVIDENCE','COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE'].includes(envelope.input_eligibility)||envelope.unmapped_normalized?.length)fail('Unresolved source envelope cannot supply finite features');const trace=envelope.trace;
  range(normalizedText,start,end);const paths=new Map(trace.paths.map(p=>[p.id,p])),sources=new Map(trace.sources.map(s=>[s.id,s])),runs=new Map(trace.runs.map(r=>[r.id,r])),memo=new Map();
  const pathMask=id=>{if(!id)return 0;if(memo.has(id))return memo.get(id);const seen=new Set();let cursor=id,mask=0;while(cursor){if(seen.has(cursor))fail('Circular source native path');seen.add(cursor);const p=paths.get(cursor),s=p&&sources.get(p.source_id);if(!s)fail('Missing source native path');const tag=TAGS.indexOf(s.native_tag);if(tag>=0)mask|=1<<tag;if(s.style_attribute)mask|=CSS;cursor=p.parent_id;}memo.set(id,mask);return mask;};
  const spans=[],externalSegments=[],normalizationGaps=[],zero=new Map();let covered=0,previous=-1;
  const appendSpan=(low,high,mask)=>{const prior=spans.at(-1);if(prior&&prior.end===low&&prior.mask===mask)prior.end=high;else spans.push({start:low,end:high,mask});};
  const addLayoutGap=(low,high)=>{const literal=normalizedText.slice(low,high);range(normalizedText,low,high);if(!/^[\s|]+$/u.test(literal))fail('Nonseparator normalized source gap remains blocked');const gap={start:low,end:high,sha256:sha(literal),status:'NORMALIZED_LAYOUT_SOURCE_UNKNOWN',native_mark_attribution:'UNKNOWN_NOT_NATIVE_NEUTRAL'};normalizationGaps.push(gap);externalSegments.push({kind:'NORMALIZED_LAYOUT_SOURCE_UNKNOWN',...gap});appendSpan(low,high,LAYOUT);covered+=high-low;};
  for(const segment of envelope.segments){
    if(segment.start<previous)fail('External native segments out of order');previous=segment.start;
    let mask=0;for(const origin of segment.sources){const run=runs.get(origin.run_id);if(!run)fail('Missing exact source origin');mask|=pathMask(run.path_id);}
    if(segment.joint_source_attribution||segment.mapping==='COMPLETE_JOINT_WHITESPACE_SOURCE_EVIDENCE')mask=(mask&CSS)|JOINT;
    if(segment.start===segment.end){if(segment.start>=start&&segment.start<=end)zero.set(segment.start,(zero.get(segment.start)??0)|mask|ZERO);continue;}
    const low=Math.max(start,segment.start),high=Math.min(end,segment.end);if(high<=low)continue;range(normalizedText,low,high);if(low<start+covered)fail('Source feature spans overlap');if(low>start+covered)addLayoutGap(start+covered,low);covered+=high-low;
    externalSegments.push({kind:'BOUND_ORIGINAL_SOURCE_SEGMENT',start:low,end:high,mapping:segment.mapping,external_segment_sha256:digest(segment)});appendSpan(low,high,mask);
    if(segment.filtered_source_events?.length)zero.set(low,(zero.get(low)??0)|mask|ZERO);
  }
  if(covered<end-start)addLayoutGap(start+covered,end);if(covered!==end-start)fail('Incomplete exact source coverage');
  const features={spans,normalization_gaps:normalizationGaps,zero_events:[...zero].sort((a,b)=>a[0]-b[0]).map(([position,mask])=>({position,mask}))},binding={policy:POLICY,policy_sha256:digest(policy),evidence,raw_sha256:envelope.raw.sha256,normalized_sha256:sha(normalizedText),envelope_sha256:envelope.sha256,tracer_source_sha256:envelope.tracer_source_sha256,collector_source_sha256:envelope.collector_source_sha256,source_range:{start,end,sha256:sha(normalizedText.slice(start,end))},feature_sha256:digest(features),normalized_layout_source_unknown:true,normalization_gaps_sha256:digest(normalizationGaps),external_segment_links_sha256:digest(externalSegments),qualification,status:'INFORMATION_REDUCED_NOT_LOSSLESS_MODEL_INPUT',navigation_prefixes:false};
  // Encoding closes only over a detached, recursively immutable snapshot.
  // Public diagnostics are a separate copy, never the encoder's own arrays.
  const privateState=immutableCopy({binding,features,externalSegments});
  const privateSpans=privateState.features.spans,privateZeroEvents=privateState.features.zero_events;
  const privateZero=Object.freeze(Object.fromEntries(privateZeroEvents.map(event=>[event.position,event.mask])));
  const inputSHA=digest(privateState.binding),publicState=immutableCopy(privateState);
  function encodeWindow({start:low=start,end:high=end,includeEndZeroWidth=false}={}){
    range(normalizedText,low,high);if(low<start||high>end||includeEndZeroWidth&&high!==end)fail('Window exceeds exact selected source span or terminal ownership');
    const cuts=new Set([low,high]);for(const s of privateSpans)if(s.end>low&&s.start<high){cuts.add(Math.max(low,s.start));cuts.add(Math.min(high,s.end));}for(const {position} of privateZeroEvents)if(position>=low&&position<=high)cuts.add(position);
    const ordered=[...cuts].sort((a,b)=>a-b),parts=[],owned=[];let at=0;
    for(let i=0;i<ordered.length;i++){const a=ordered[i],b=ordered[i+1];if(Object.hasOwn(privateZero,a)&&(a<high||includeEndZeroWidth)){parts.push(featureAtom('',privateZero[a]));owned.push({position:a,mask:privateZero[a]});}if(b===undefined)continue;while(privateSpans[at]?.end<=a)at++;const span=privateSpans[at];if(!span||span.start>a||span.end<b)fail('Feature range missing');parts.push(featureAtom(normalizedText.slice(a,b),span.mask));}
    const text=parts.join(''),literal=normalizedText.slice(low,high);if(decodeModelText(text)!==literal)fail('Exact literal source roundtrip differs');
    return immutableCopy({text,sha256:sha(text),source_range:{start:low,end:high,sha256:sha(literal)},zero_events:owned,include_end_zero_width:includeEndZeroWidth,feature_sha256:privateState.binding.feature_sha256,input_sha256:inputSHA,status:privateState.binding.status,source_literal_roundtrip:true,external_evidence:privateState.binding.evidence});
  }
  return Object.freeze({...publicState,normalizedText,start,end,encodeWindow:Object.freeze(encodeWindow)});
}
