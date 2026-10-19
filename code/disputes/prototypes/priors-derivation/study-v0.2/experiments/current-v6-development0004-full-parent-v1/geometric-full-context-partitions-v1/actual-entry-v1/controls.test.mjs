// SPDX-License-Identifier: AGPL-3.0-only
// Fictional accounting controls only. Importing this inactive driver reads no data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ROOT_ACTIVATED,CARRY,CAPS,LIMITS,validateCarry,callMeter} from './run-one-case.mjs';
const closed=()=>({schema:'ROOT-complete-normalized-context-0055-closed-cumulative-carry-v1',status:'CLOSED_PLANNING_POOL_EXHAUSTED_PRESERVE_HELD_OUTCOMES',carry:{...CARRY},original_caps:{...CAPS},no_remaining_planning_calls:true,no_cap_reset:true,no_unused_time_or_output_reservation_refund:true,source_quality_gate_pass:false,holds_cleared:0});
test('inactive driver accepts only the unchanged exhausted carry',()=>{
 assert.equal(ROOT_ACTIVATED,false); assert.equal(validateCarry(closed()),true);
 for(const key of ['no_remaining_planning_calls','no_cap_reset','no_unused_time_or_output_reservation_refund']){const x=closed();x[key]=false;assert.throws(()=>validateCarry(x));}
 const x=closed();x.carry.planning--;assert.throws(()=>validateCarry(x));
});
test('separate feasibility budget charges thrown calls and rejects the next model call',()=>{
 const m=callMeter(),f=m.counter('planning',0,()=>{throw Error('fictional');});
 assert.throws(()=>f('x'));assert.equal(m.state().planning,1);
 const rest=m.counter('planning',0,()=>1);for(let i=1;i<1664;i++)rest('x');
 assert.throws(()=>rest('x'));assert.equal(m.state().models[0].planning,1664);
 const other=m.counter('planning',1,()=>1);for(let i=0;i<1664;i++)other('x');
 assert.throws(()=>other('x'));assert.equal(m.state().planning,3328);
 assert.equal(CARRY.planning,40000);assert.equal(LIMITS.planning,3328);
});
test('fresh recount quotas stay separate and guard refusal performs no callback',()=>{
 const m=callMeter();let calls=0;
 const denied=m.counter('recount',0,()=>calls++,()=>{throw Error('fictional guard');});
 assert.throws(()=>denied('x'));assert.equal(calls,0);assert.equal(m.state().recount,0);
 for(const i of [0,1]){const f=m.counter('recount',i,()=>++calls);for(let j=0;j<416;j++)f('x');assert.throws(()=>f('x'));}
 assert.equal(calls,832);assert.equal(m.state().recount,832);
});
