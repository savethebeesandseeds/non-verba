// SPDX-License-Identifier: AGPL-3.0-only
// Pure diagnostic ledger. It confers no source IO or branch authenticity.
import {createHash} from 'node:crypto';
export const PROBE_LIMITS=Object.freeze({schema_version:1,max_bytes:262144,max_records:1024,max_summary_bytes:65536});
const fail=code=>{throw Object.assign(Error(code),{code});};
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const integer=n=>Number.isSafeInteger(n)&&n>=-67108864&&n<=67108864;
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const size=v=>Buffer.byteLength(JSON.stringify(v,null,2)+'\n','utf8');
const fields=new Set(['stage','reason_mask','block_sha256','block_utf16','block_index','input_block_index','number','admitted_number','governing_number','expected_number','frame_index','literal_sha256','title_sha256','literal_utf16','title_utf16','common_prefix_utf16','following_codepoint','raw_start','raw_end','caption_kind','item_scheme','literal_item_prefix','first_item_sha256']);
function data(value){
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('PROBE_EVENT');
  const out={};
  for(const[key,d]of Object.entries(Object.getOwnPropertyDescriptors(value))){
    if(!fields.has(key)||!Object.hasOwn(d,'value'))fail('PROBE_EVENT');
    const v=d.value;if(v!==null&&(key.endsWith('_sha256')?!hash(v):key==='literal_item_prefix'?typeof v!=='boolean':!integer(v)))fail('PROBE_EVENT');out[key]=v;
  }
  if(!Number.isInteger(out.stage)||out.stage<1||out.stage>4||!Number.isInteger(out.reason_mask)||out.reason_mask<0||out.reason_mask>65535)fail('PROBE_EVENT');
  if(!hash(out.block_sha256)||!Number.isSafeInteger(out.block_utf16)||out.block_utf16<0)fail('PROBE_EVENT');
  if((out.raw_start==null)!==(out.raw_end==null)||out.raw_start!=null&&(out.raw_start<0||out.raw_end<out.raw_start))fail('PROBE_EVENT');
  if(out.following_codepoint!=null&&(out.following_codepoint<0||out.following_codepoint>1114111))fail('PROBE_EVENT');
  return out;
}
function frozen(value){if(value&&typeof value==='object'){for(const v of Object.values(value))frozen(v);Object.freeze(value);}return value;}
/** Stage1 annotation; stage2 peer eligibility; stage3 ordinary frame creation;
 * stage4 peer decision. Reason bit meanings are documented beside the copy. */
export function createBoundaryProbe(){
  const counts=new Map(),records=[];let reserved=1024,total=0,poison=null,closed=false;
  const bound=()=>{if(closed)fail('PROBE_CLOSED');if(poison)fail(poison);};
  function count(stage,mask){
    bound();if(!Number.isInteger(stage)||stage<1||stage>4||!Number.isInteger(mask)||mask<0||mask>65535){poison='PROBE_EVENT';fail(poison);}
    const key=stage+':'+mask;if(!counts.has(key)){reserved+=48;if(reserved>PROBE_LIMITS.max_bytes){poison='PROBE_BOUND';fail(poison);}}
    if(total===Number.MAX_SAFE_INTEGER){poison='PROBE_BOUND';fail(poison);}counts.set(key,(counts.get(key)??0)+1);total++;
  }
  function record(value){
    bound();if(records.length>=PROBE_LIMITS.max_records){poison='PROBE_BOUND';fail(poison);}let event;try{event=data(value);}catch(error){poison='PROBE_EVENT';throw error;}
    const bytes=size(event)+96;
    if(reserved+bytes>PROBE_LIMITS.max_bytes){poison='PROBE_BOUND';fail(poison);}reserved+=bytes;
    count(event.stage,event.reason_mask);records.push({...event,ordinal:records.length});
  }
  function finish(){
    bound();const body={schema_version:1,event_count:total,counters:Object.fromEntries([...counts].sort((a,b)=>a[0].localeCompare(b[0]))),caption_records:records,truncated:false};
    const value={...body,sha256:sha(body)};if(size(value)>PROBE_LIMITS.max_bytes){poison='PROBE_BOUND';fail(poison);}closed=true;return frozen(value);
  }
  return Object.freeze({count,record,finish});
}
/** Validates the bounded numerical/hash output, never its actual provenance. */
export function verifyBoundaryProbe(value){
  if(!value||Object.keys(value).sort().join(',')!=='caption_records,counters,event_count,schema_version,sha256,truncated'||value.schema_version!==1||value.truncated!==false||!hash(value.sha256)||!Number.isSafeInteger(value.event_count)||value.event_count<0||!Array.isArray(value.caption_records))fail('PROBE_SHAPE');
  if(!value.counters||typeof value.counters!=='object'||Array.isArray(value.counters)||value.caption_records.length>PROBE_LIMITS.max_records)fail('PROBE_SHAPE');
  let count=0;for(const[k,v]of Object.entries(value.counters)){if(!/^[1-4]:\d{1,5}$/u.test(k)||Number(k.split(':')[1])>65535||!Number.isSafeInteger(v)||v<1)fail('PROBE_SHAPE');count+=v;}
  if(count!==value.event_count)fail('PROBE_SHAPE');
  const seen=new Map();for(const[r,i]of value.caption_records.map((r,i)=>[r,i])){const{ordinal,...body}=r;if(ordinal!==i)fail('PROBE_SHAPE');data(body);const k=body.stage+':'+body.reason_mask;seen.set(k,(seen.get(k)??0)+1);}
  for(const[k,n]of seen)if(!(value.counters[k]>=n))fail('PROBE_SHAPE');
  const{sha256,...body}=value;if(sha(body)!==sha256||size(value)>PROBE_LIMITS.max_bytes)fail('PROBE_SHAPE');return true;
}
export function projectBoundaryProbe(value){
  verifyBoundaryProbe(value);
  const projection={schema_version:1,sha256:value.sha256,event_count:value.event_count,counters:{...value.counters},caption_record_count:value.caption_records.length,caption_records_sha256:sha(value.caption_records),decoded_bytes:size(value),truncated:false};
  if(size(projection)>PROBE_LIMITS.max_summary_bytes)fail('PROBE_BOUND');return frozen(projection);
}
