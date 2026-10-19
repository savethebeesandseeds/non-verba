// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED. Pure bounded literal candidates, not legal closure.
import {createHash} from 'node:crypto';
import {selectAutomaticContext,POLICY_SHA256 as BASE_POLICY} from '../../literal-emphasis-parent-v1/automatic-context-selector-v1/selector.mjs';
export const BASE_SOURCE=Object.freeze({path:'experiments/literal-emphasis-parent-v1/automatic-context-selector-v1/selector.mjs',sha256:'682553360f2668797b08309ded8a14242a549c6e71765aa4217b14007a860b53',bytes:14877});
export const LIMITS=Object.freeze({added_ranges:8,added_characters:16384,definition_terms:128,definition_candidates_per_term:4,paragraphs:2048,hops:2,demands:64,output_bytes:262144});
export const POLICY=Object.freeze({name:'BOUNDED_LITERAL_DEPENDENCY_CANDIDATES_V1_UNADOPTED',base_source:BASE_SOURCE,base_policy_sha256:BASE_POLICY,original_focal:'UNCHANGED',heading_tail:'EXCLUDE_ONLY_CAPTION_AND_WHITESPACE_ONLY_TRAILING_TOUCH_FROM_DEPENDENCY_SEED',temporal:'SOURCE_BODY_PREDICATES_NOT_CAPTION_NAMES',definitions:'DOUBLE_QUOTED_FORWARD_DEFINITION_OR_PARENTHETICAL_ALIAS; EXACT_CASE_SOURCE_USES',operative_specification:'TERM_USE_PLUS_TO_BE_PROVIDED_PERFORMED_SUPPLIED_DELIVERED_BODY_PREDICATE',broad_exceptions:'ALWAYS_UNCLOSED_WHEN_OBSERVED',explicit_references_in_new_candidates:'REPORTED_NOT_RECURSIVELY_EXPANDED',semantic_closure_verified:false});
const H=s=>createHash('sha256').update(s).digest('hex'),C=v=>Array.isArray(v)?'['+v.map(C).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+C(v[k])).join(',')+'}':JSON.stringify(v),D=v=>H(C(v));
export const POLICY_SHA256=D(POLICY);
const check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});},int=(v,a,b)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
function options(x){check(x&&Object.getPrototypeOf(x)===Object.prototype,'DEPENDENCY_OPTIONS');const o={...LIMITS};for(const k of Reflect.ownKeys(x)){const d=Object.getOwnPropertyDescriptor(x,k);check(typeof k==='string'&&Object.hasOwn(o,k)&&Object.hasOwn(d,'value')&&int(d.value,1,LIMITS[k]),'DEPENDENCY_OPTIONS');o[k]=d.value;}return o;}
const overlap=(a,b)=>a.start<b.end&&a.end>b.start;
const key=r=>r.start+':'+r.end+':'+r.sha256;
const wordUse=(s,t)=>{let at=-1;while((at=s.indexOf(t,at+1))>=0){const before=at?s[at-1]:'',after=s[at+t.length]??'';if(!/[\p{L}\p{N}_]/u.test(before)&&!/[\p{L}\p{N}_]/u.test(after))return true;}return false;};

/** Caller authenticates the complete normalized source and metadata before a
 * separately admitted actual run. No case IDs, clause numbers, defined-term
 * catalog, witness labels, IO, counters, model or reader are accepted here. */
export function selectDependencyContext(input,lowerLimits={}){
 const o=options(lowerLimits),initial=selectAutomaticContext(input);
 check(initial.schema==='automatic-literal-context-selection-v1','DEPENDENCY_BASE_NOT_USABLE');
 const s=input.normalizedText,focal={...initial.focal},range=(start,end)=>({start,end,sha256:H(s.slice(start,end))}),issues=[],demands=[],added=[],byRange=new Map();
 const issue=(code,data={})=>{const x={code,...data};if(!issues.some(v=>C(v)===C(x)))issues.push(x);};
 const demand=x=>{if(demands.length>=o.demands){issue('DEPENDENCY_DEMAND_BOUND');return false;}demands.push(x);return true;};
 // A trailing title still stays in the original focal input. Its body is not
 // made a dependency merely because that title was touched by the focal tail.
 let seedEnd=focal.end;const excluded=[];
 for(const cap of [...initial.caption_candidates].sort((a,b)=>b.caption_start-a.caption_start)){
  if(cap.caption_start<focal.start||cap.caption_start>=seedEnd)continue;
  const after=s.slice(Math.min(seedEnd,cap.caption_end),seedEnd);
  if(after.trim()!=='')break;
  excluded.push({anchor_id:cap.anchor_id,caption_range:range(cap.caption_start,cap.caption_end),focal_touch:range(cap.caption_start,seedEnd),reason:'CAPTION_ONLY_TAIL_NOT_A_DEPENDENCY_SEED',original_focal_retained:true});seedEnd=cap.caption_start;
 }
 check(seedEnd>focal.start&&s.slice(focal.start,seedEnd).trim().length>0,'DEPENDENCY_EMPTY_SUBSTANTIVE_SEED');
 const seed=range(focal.start,seedEnd),base=excluded.length?selectAutomaticContext({...input,focal:seed}):initial;
 check(base.schema==='automatic-literal-context-selection-v1','DEPENDENCY_BASE_NOT_USABLE');
 const required=[{id:'focal',range:seed,depth:0,provenance:'FOCAL_REQUIRED'},...base.attachments.map(a=>({id:a.id,range:a.range,depth:0,provenance:'BASE_FOCAL_OR_REFERENCE_REQUIRED'}))];
 const roots=new Set(required.map(x=>key(x.range))),queue=[...required],visited=new Set();let addedCharacters=0;
 function add(r,kind,from,depth,evidence){
  const k=key(r);if(roots.has(k))return true;
  if(byRange.has(k)){const a=byRange.get(k);a.reasons.push({kind,from,evidence});return true;}
  if(depth>o.hops){issue('DEPENDENCY_HOP_BOUND',{kind,from,target:r});return false;}
  if(added.length>=o.added_ranges||addedCharacters+r.end-r.start>o.added_characters){issue('DEPENDENCY_ATTACHMENT_BOUND',{kind,from,target:r});return false;}
  const a={id:'dependency_'+added.length,range:r,depth,reasons:[{kind,from,evidence}],provenance:'TRANSITIVE_FROM_FOCAL_REQUIRED_CONTEXT',boundary_verified:false,governing_hierarchy_verified:false};added.push(a);byRange.set(k,a);addedCharacters+=r.end-r.start;queue.push(a);return true;
 }
 // Paragraphs are literal blank-line blocks. No new DOM/section authority is
 // invented for definitions outside the supplied numeric-caption intervals.
 const blocks=[];let from=0;
 for(const m of s.matchAll(/\n[ \t]*\n/gu)){if(s.slice(from,m.index).trim())blocks.push(range(from,m.index));from=m.index+m[0].length;}
 if(s.slice(from).trim())blocks.push(range(from,s.length));
 check(blocks.length<=o.paragraphs,'DEPENDENCY_PARAGRAPH_BOUND');
 const definitions=new Map();
 for(const b of blocks){const text=s.slice(b.start,b.end);for(const m of text.matchAll(/["“]([A-Z][A-Za-z0-9]*(?:[ -][A-Za-z0-9]+){0,5})["”]/gu)){
  if(m[1].length>64)continue;const before=text.slice(0,m.index),after=text.slice(m.index+m[0].length),forward=/^\s+(?:means|shall\s+mean|refers\s+to|includes)\b/iu.test(after),open=before.lastIndexOf('('),alias=open>=0&&before.lastIndexOf(')')<open&&m.index-open<=256&&/^\s*(?:[,;][^()\n]{0,256})?\)/u.test(after);
  if(!forward&&!alias)continue;
  if(!definitions.has(m[1])&&definitions.size>=o.definition_terms){issue('DEFINITION_INDEX_BOUND');continue;}
  const list=definitions.get(m[1])??[];if(!list.some(x=>key(x.range)===key(b)))list.push({range:b,quote:range(b.start+m.index,b.start+m.index+m[0].length),form:forward?'FORWARD_DEFINITION':'PARENTHETICAL_ALIAS'});definitions.set(m[1],list);
 }}
 const temporal=base.caption_candidates.map(c=>({range:c.interval,body:s.slice(c.caption_end,c.interval.end)}));
 const durationCandidates=temporal.filter(c=>/\bterm\b[^.!?\n]{0,180}\b(?:shall|will)\b[^.!?\n]{0,80}\b(?:commence|begin|start)\b/iu.test(c.body)&&/\b(?:end|expire|terminate|anniversary|duration)\b/iu.test(c.body));
 const terminationCandidates=temporal.filter(c=>/\b(?:agreement|contract|engagement)\b/iu.test(c.body)&&/\b(?:shall|will|may)\s+(?:also\s+)?(?:be\s+)?(?:terminate[ds]?|end(?:ed)?)\b/iu.test(c.body));
 const temporalSeen=new Set(),specificationsSeen=new Set();
 function temporalDemand(kind,candidates,q){
  if(temporalSeen.has(kind))return;temporalSeen.add(kind);if(!demand({kind,from:q.id,status:candidates.length?'SOURCE_BODY_CANDIDATES':'MISSING_SOURCE_BODY_CANDIDATE',candidates:candidates.map(c=>c.range)}))return;
  if(!candidates.length){issue('MISSING_TEMPORAL_BODY_CANDIDATE',{kind,from:q.id});return;}
  if(candidates.length>1)issue('MULTIPLE_TEMPORAL_BODY_CANDIDATES',{kind,count:candidates.length});
  for(const c of candidates)add(c.range,kind,q.id,q.depth+1,{body_predicate:true,caption_name_used:false,semantic_governor_verified:false});
 }
 for(let i=0;i<queue.length;i++){
  const q=queue[i],k=key(q.range);if(visited.has(k))continue;visited.add(k);const text=s.slice(q.range.start,q.range.end);
  if(/\b(?:except|unless|as)[^.;\n]{0,80}\botherwise\s+provided\b|\bsubject\s+to\s+(?:the\s+)?other\s+provisions\b/iu.test(text))issue('BROAD_EXCEPTION_SCOPE_UNCLOSED',{from:q.id,range:q.range});
  const during=/\b(?:during|throughout)\s+(?:the\s+)?term\b|\bwhile\s+(?:this|the)\s+(?:agreement|contract)\s+is\s+in\s+effect\b/iu.test(text),onEnd=/\b(?:upon|after|before|on|following)\s+(?:the\s+)?(?:termination|expiration)\b|\bearlier\s+terminated\b/iu.test(text);
  if(during)temporalDemand('DURATION_GOVERNOR',durationCandidates,q);
  if(during||onEnd)temporalDemand('TERMINATION_GOVERNOR',terminationCandidates,q);
  for(const[term,list]of definitions)if(wordUse(text,term)){
   // A quoted alias need not contain its operative specification. Look for a
   // narrow independent BODY predicate, including lower-case use of the term;
   // the similarly named caption itself is never sufficient evidence.
   if(!specificationsSeen.has(term)){
    specificationsSeen.add(term);const candidates=temporal.filter(c=>wordUse(c.body.toLowerCase(),term.toLowerCase())&&/\bto\s+be\s+(?:provided|performed|supplied|delivered)\b[^.!?\n]{0,240}\b(?:are|shall\s+be|will\s+be)\b/iu.test(c.body));
    if(candidates.length>1)issue('MULTIPLE_OPERATIVE_TERM_SPECIFICATIONS',{term_sha256:H(term),count:candidates.length});
    if(candidates.length&&demand({kind:'OPERATIVE_TERM_SPECIFICATION',from:q.id,term_sha256:H(term),candidate_count:candidates.length}))for(const c of candidates)add(c.range,'OPERATIVE_TERM_SPECIFICATION',q.id,q.depth+1,{term_sha256:H(term),body_predicate:true,caption_name_used:false,semantic_specification_verified:false});
   }
   if(list.length===1&&[...required,...added].some(v=>v.range.start<=list[0].range.start&&v.range.end>=list[0].range.end))continue;
   if(!demand({kind:'REFERENCED_LITERAL_DEFINITION',from:q.id,term_sha256:H(term),candidate_count:list.length}))continue;
   if(list.length>o.definition_candidates_per_term){issue('DEFINITION_CANDIDATE_BOUND',{term_sha256:H(term)});continue;}
   if(list.length!==1){issue('AMBIGUOUS_LITERAL_DEFINITION',{from:q.id,term_sha256:H(term),candidate_count:list.length});continue;}
   const d=list[0];add(d.range,'REFERENCED_LITERAL_DEFINITION',q.id,q.depth+1,{term_sha256:H(term),definition_quote:d.quote,form:d.form,semantic_definition_verified:false});
  }
  if(q.id.startsWith('dependency_')&&/\b(?:Sections?|Paragraphs?|Articles?|Clauses?)\s+(?:\d|[IVXLCDM])|§/u.test(text))issue('NEW_DEPENDENCY_EXPLICIT_REFERENCES_UNEXPANDED',{from:q.id,range:q.range});
 }
 const result={schema:'automatic-bounded-dependency-context-candidates-v1',prototype:true,adopted:false,status:issues.length||base.issues.length?'HELD_UNCLOSED_DEPENDENCIES':'BOUNDED_LITERAL_CANDIDATES_NOT_ADEQUACY',policy:POLICY,policy_sha256:POLICY_SHA256,source:base.source,focal,dependency_seed:seed,caption_only_tail_exclusions:excluded,base_selection:base,required_context_provenance:required,added_dependencies:added,added_characters:addedCharacters,demands,issues,limits:o,broad_exception_closure_verified:false,definition_grammar_exhaustive:false,temporal_grammar_exhaustive:false,source_custody_authenticated:false,governing_hierarchy_verified:false,semantic_completeness_verified:false,model_or_counter_called:false,source_text_or_caption_literals_emitted:false,quality_gate_pass:false,authority:'NONE'};
 check(Buffer.byteLength(JSON.stringify(result))<=o.output_bytes,'DEPENDENCY_OUTPUT_BOUND');return freeze(result);
}
