// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED. Pure forward-ledger checks; never grants IO authority.
import {createHash} from 'node:crypto';
const H=b=>createHash('sha256').update(b).digest('hex');
export const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
export const digest=v=>H(canonical(v));
const eq=(a,b)=>canonical(a)===canonical(b),check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});};
const int=(v,a=0,b=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const keys=['schema','index','binding_sha256','case_id','source_identity_sha256','page_index','start_utf16','end_utf16','has_more','page_body_sha256','reply_sha256','reply_utf16_units','reply_utf8_bytes','visible_before','visible_after','previous_row_sha256'];
export function readForwardJournal({bytes,binding,cases}){
 check(Buffer.isBuffer(bytes)&&bytes.length<=1048576&&Array.isArray(cases)&&cases.length===2&&eq(cases.map(c=>c.identity.case_id),binding.ordered_case_ids),'WITNESS_READER_JOURNAL_ARGUMENT');
 const rows=[],state=new Map();let from=0,previous=null,visible=0;
 for(let at=0;at<bytes.length;at++)if(bytes[at]===10){
  const line=bytes.subarray(from,at+1);check(line.length<=2048&&4452+rows.length+1<=16384,'WITNESS_READER_JOURNAL_BOUND');
  const r=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(line)),i=cases.findIndex(c=>c.identity.case_id===r.case_id),c=cases[i],old=state.get(r.case_id);
  check(Buffer.from(JSON.stringify(r)+'\n').equals(line)&&eq(Object.keys(r).sort(),[...keys].sort())&&r.schema==='governing-witness-page-precharge-v1'&&r.index===rows.length+1&&r.binding_sha256===digest(binding)&&i>=0&&r.source_identity_sha256===digest(c.source)&&r.previous_row_sha256===previous,'WITNESS_READER_JOURNAL_IDENTITY');
  check(cases.slice(0,i).every(k=>state.get(k.identity.case_id)?.complete===true)&&!old?.complete&&r.page_index===(old?.page_index??0)+1&&r.start_utf16===(old?.end??0)&&int(r.end_utf16,r.start_utf16+1,c.source.normalized_utf16_length)&&r.end_utf16-r.start_utf16<=6000&&r.has_more===(r.end_utf16<c.source.normalized_utf16_length)&&sha(r.page_body_sha256)&&sha(r.reply_sha256)&&int(r.reply_utf16_units,1,7500)&&int(r.reply_utf8_bytes,1,65536)&&r.visible_before===visible&&r.visible_after===visible+r.reply_utf8_bytes,'WITNESS_READER_JOURNAL_CURSOR');
  rows.push(r);visible=r.visible_after;previous=H(line);state.set(r.case_id,{end:r.end_utf16,page_index:r.page_index,complete:!r.has_more});from=at+1;
 }
 check(from===bytes.length,'WITNESS_READER_JOURNAL_PARTIAL');return{rows,state,visible,previous};
}
export function checkDeliveryPrefix({rows,deliveries,binding}){
 check(Array.isArray(deliveries)&&deliveries.length===rows.length,'WITNESS_READER_DELIVERY_REQUIRED');const chunks=new Set();
 for(let i=0;i<rows.length;i++){const r=rows[i],d=deliveries[i];check(d&&d.schema==='governing-witness-page-delivery-v1'&&d.index===r.index&&d.binding_sha256===digest(binding)&&d.case_id===r.case_id&&d.source_identity_sha256===r.source_identity_sha256&&d.precharge_row_sha256===H(Buffer.from(JSON.stringify(r)+'\n'))&&d.reply_sha256===r.reply_sha256&&d.reply_utf16_units===r.reply_utf16_units&&d.reply_utf8_bytes===r.reply_utf8_bytes&&d.native_exit===0&&Array.isArray(d.chunk_ids)&&d.chunk_ids.length>0&&d.chunk_ids.length<=16,'WITNESS_READER_DELIVERY_IDENTITY');for(const c of d.chunk_ids){check(typeof c==='string'&&/^[A-Za-z0-9_.:-]{1,256}$/u.test(c)&&!chunks.has(c),'WITNESS_READER_CHUNK_REPLAY');chunks.add(c);}}
 return true;
}
export function pendingBudget({physical,visible,private_bytes=0,reserve=0,extra_visible=0,rows=0,journal_bytes=0}){
 check([physical,visible,private_bytes,reserve,extra_visible,rows,journal_bytes].every(n=>int(n))&&physical+reserve+32768<=16777216&&612082300+physical+reserve+Math.max(0,visible+extra_visible-262144)<=637534208&&1377030+Math.max(262144,visible+private_bytes+extra_visible)<=2097152&&4452+rows<=16384&&1576802+journal_bytes<=16777216,'WITNESS_READER_CUMULATIVE_BOUND');return true;
}
