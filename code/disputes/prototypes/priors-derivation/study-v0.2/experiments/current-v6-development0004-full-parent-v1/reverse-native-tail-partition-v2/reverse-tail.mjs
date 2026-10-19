// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED. Pure suffix-first measured heuristic; no runtime authority.
import{createHash}from'node:crypto';
const H=s=>createHash('sha256').update(s).digest('hex'),J=JSON.stringify,hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/u.test(s);
const check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});},freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export const POLICY=freeze({name:'REVERSE_NATIVE_TAIL_PARTITION_V1_PROTOTYPE_UNADOPTED',max_tokens:256,max_probes:4096,max_windows:512,max_source_UTF16:1000,max_encoded_UTF16:262144,max_output_bytes:2097152,search:'SUFFIX_FIRST_BINARY_HEURISTIC_WITH_EXPLICIT_SINGLE_CODEPOINT_FALLBACK',nonmonotonic_cost:true,maximality_proved:false,impossibility_proved:false,partial_whole_candidate_adoption:false,terminal_ownership:'HALF_OPEN_EXCEPT_ORIGINAL_NODE_END'});
const safe=e=>/^[A-Z][A-Z0-9_]{0,79}$/u.test(e?.code??'')?e.code:'REVERSE_CALLBACK_HELD';
function setup(x){const source=x?.text;check(typeof source==='string'&&source.isWellFormed()&&source.length>0&&source.length<=1000,'REVERSE_SOURCE');check(typeof x.encode==='function'&&typeof x.countTokens==='function'&&hash(x.encoder_identity_sha256)&&hash(x.tokenizer_identity_sha256),'REVERSE_CALLBACK_BINDING');check(x.limits===undefined||(x.limits&&typeof x.limits==='object'&&!Array.isArray(x.limits)),'REVERSE_LIMITS');const l={max_probes:4096,max_windows:512,max_output_bytes:2097152,...x.limits};check(Object.keys(l).length===3&&Object.entries(l).every(([k,v])=>Number.isSafeInteger(v)&&v>0&&v<=POLICY[k])&&l.max_output_bytes>=4096,'REVERSE_LIMITS');const points=[0];let at=0;for(const c of source){at+=c.length;points.push(at);}return{source,l,points,binding:{source_sha256:H(source),source_UTF16:source.length,encoder_identity_sha256:x.encoder_identity_sha256,tokenizer_identity_sha256:x.tokenizer_identity_sha256}};}
function result(body){const json=J(body);check(Buffer.byteLength(json)+80<=body.limits.max_output_bytes,'REVERSE_RESULT_BOUND');return freeze({...body,sha256:H(json)});}
function newBody(p){return{schema:'reverse-native-tail-proposal-v1',policy:POLICY,limits:p.l,binding:p.binding,status:'HELD',code:null,counts:{encode_attempts:0,tokenizer_attempts:0,accepted_windows:0},attempts:[],windows:[],exact_disjoint_full_source_union:false,planning_direction:'SUFFIX_FIRST',minimum_or_maximal_capacity_proved:false,independent_recount_required:true,source_authenticity_claimed:false,counter_identity_is_external_claim_only:true,actual_reading:false,candidate_adopted:false,quality_gate_pass:false,model_inference:false,authority:'NONE'};}
function probe(x,b,source,start,end){
 check(b.counts.encode_attempts<b.limits.max_probes&&b.counts.tokenizer_attempts<b.limits.max_probes,'REVERSE_PROBE_LIMIT');b.counts.encode_attempts++;
 const r={start,end,includeEndZeroWidth:end===source.length},value=x.encode({...r});
 check(value&&typeof value.text==='string'&&value.text.isWellFormed()&&value.text.length<=262144&&value.source===source.slice(start,end)&&hash(value.original_native_sha256),'REVERSE_EXACT_SOURCE_ENCODING');
 b.counts.tokenizer_attempts++;const tokens=x.countTokens(value.text);check(Number.isSafeInteger(tokens)&&tokens>0,'REVERSE_TOKEN_COUNT');
 const row={...r,source_sha256:H(value.source),encoded_sha256:H(value.text),original_native_sha256:value.original_native_sha256,encoded_UTF16:value.text.length,tokens,fits:tokens<=256};
 check(Buffer.byteLength(J(b))+Buffer.byteLength(J(row))+2048<=b.limits.max_output_bytes,'REVERSE_OUTPUT_LIMIT');b.attempts.push(row);return row;
}
export function proposeReverseNativeTail(x){
 const p=setup(x),b=newBody(p);let tail=p.points.length-1;
 try{while(tail>0){check(b.windows.length<b.limits.max_windows,'REVERSE_WINDOW_LIMIT');let best=probe(x,b,p.source,0,p.points[tail]);
   if(!best.fits){best=null;let low=1,high=tail-1;while(low<=high){const n=Math.floor((low+high)/2),r=probe(x,b,p.source,p.points[tail-n],p.points[tail]);if(r.fits){best=r;low=n+1;}else high=n-1;}
    if(!best){const one=probe(x,b,p.source,p.points[tail-1],p.points[tail]);check(one.fits,'REVERSE_SINGLE_CODEPOINT_NOT_FITTING_OBSERVED');best=one;}}
   const fresh=probe(x,b,p.source,best.start,best.end);check(J(fresh)===J(best)&&fresh.fits,'REVERSE_FRESH_MEASUREMENT_CHANGED');
   const accepted={...fresh,fresh_reencode_and_count:true};check(Buffer.byteLength(J(b))+Buffer.byteLength(J(accepted))+2048<=b.limits.max_output_bytes,'REVERSE_OUTPUT_LIMIT');b.windows.push(accepted);b.counts.accepted_windows++;tail=p.points.indexOf(best.start);check(tail>=0,'REVERSE_BOUNDARY');
  }
  b.windows.sort((a,z)=>a.start-z.start);let end=0;for(const w of b.windows){check(w.start===end&&w.end>w.start&&w.source_sha256===H(p.source.slice(w.start,w.end)),'REVERSE_UNION');end=w.end;}check(end===p.source.length,'REVERSE_UNION');b.status='COMPLETE_PROPOSED_PENDING_INDEPENDENT_RECOUNT';b.exact_disjoint_full_source_union=true;
 }catch(e){b.code=safe(e);b.partial_suffix_ranges_retained_without_adoption=true;}
 return result(b);
}
export function recountReverseNativeTail(x,proposal){
 const p=setup(x),{sha256,...original}=proposal??{};check(hash(sha256)&&H(J(original))===sha256&&proposal.status==='COMPLETE_PROPOSED_PENDING_INDEPENDENT_RECOUNT'&&proposal.exact_disjoint_full_source_union===true&&J(proposal.binding)===J(p.binding)&&J(proposal.policy)===J(POLICY),'REVERSE_RECOUNT_BINDING');
 check(proposal.windows.length<=p.l.max_windows,'REVERSE_WINDOW_LIMIT');const b=newBody(p);b.schema='reverse-native-tail-recount-v1';b.proposal_sha256=sha256;
 try{let end=0;for(const w of proposal.windows){check(w.start===end&&w.end>w.start&&p.points.includes(w.start)&&p.points.includes(w.end),'REVERSE_RECOUNT_UNION');const fresh=probe(x,b,p.source,w.start,w.end),{fresh_reencode_and_count,...prior}=w;check(fresh_reencode_and_count===true&&J(fresh)===J(prior)&&fresh.fits,'REVERSE_INDEPENDENT_RECOUNT_CHANGED');end=w.end;}check(end===p.source.length,'REVERSE_RECOUNT_UNION');b.status='COMPLETE_FRESH_RECOUNT_NO_ADOPTION';b.exact_disjoint_full_source_union=true;
 }catch(e){b.code=safe(e);}b.independent_execution_not_proved_by_pure_API=true;return result(b);
}
