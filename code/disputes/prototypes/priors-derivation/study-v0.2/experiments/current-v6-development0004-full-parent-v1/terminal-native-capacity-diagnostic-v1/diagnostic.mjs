// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED. Fixed terminal contrasts, never a window search.
import {createHash} from 'node:crypto';
const H=s=>createHash('sha256').update(s).digest('hex');
const check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});};
export const POLICY=Object.freeze({name:'TERMINAL_NATIVE_CAPACITY_DIAGNOSTIC_V1_UNADOPTED',probes:4,counts_per_model:8,model_limit:256,search:false,candidate_adoption:false});
export function fixedTerminalRanges(text){
 check(typeof text==='string'&&text.isWellFormed()&&text.length>0&&text.length<=1000,'TERMINAL_SOURCE_BOUND');
 const end=text.length,last=end-(text.codePointAt(end-2)>0xffff?2:1);
 return [{id:'whole_node',start:0,end,includeEndZeroWidth:true},{id:'last_codepoint_with_terminal',start:last,end,includeEndZeroWidth:true},{id:'last_codepoint_without_terminal',start:last,end,includeEndZeroWidth:false},{id:'terminal_zero_output',start:end,end,includeEndZeroWidth:true}];
}
export function diagnoseTerminal({text,encode,countTokens}){
 check(typeof encode==='function'&&typeof countTokens==='function','TERMINAL_CALLBACKS');
 const rows=[];let calls=0;
 for(const range of fixedTerminalRanges(text)){
  const value=encode({...range});
  check(value&&typeof value.text==='string'&&value.text.length<=262144&&typeof value.source==='string'&&value.source===text.slice(range.start,range.end),'TERMINAL_SOURCE_INVERSE');
  check(typeof value.original_native_sha256==='string'&&/^[a-f0-9]{64}$/u.test(value.original_native_sha256),'TERMINAL_NATIVE_BINDING');
  const count=()=>{check(++calls<=8,'TERMINAL_CALL_LIMIT');const n=countTokens(value.text);check(Number.isSafeInteger(n)&&n>0,'TERMINAL_COUNT');return n;},tokens=count(),recount=count();
  check(tokens===recount,'TERMINAL_RECOUNT_CHANGED');
  rows.push({...range,source_sha256:H(value.source),source_UTF16:value.source.length,encoded_sha256:H(value.text),encoded_UTF8_bytes:Buffer.byteLength(value.text),original_native_sha256:value.original_native_sha256,tokens,recount,within_256:tokens<=256});
 }
 return {schema:'terminal-native-capacity-diagnostic-v1',policy:POLICY,rows,counter_calls:calls,terminal_toggle_is_diagnostic_only:true,monotonic_token_cost_assumed:false,minimum_capacity_proved:false,whole_partition_feasibility_proved:false,source_text_displayed:false,actual_reading:false,model_inference:false,quality_gate_pass:false,authority:'NONE'};
}
