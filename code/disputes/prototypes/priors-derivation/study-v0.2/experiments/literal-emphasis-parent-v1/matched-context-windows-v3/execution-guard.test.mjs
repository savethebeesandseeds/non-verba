// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';import assert from'node:assert/strict';
import{resourceDecision,verifyLease,reserveCounterBatch,parseProcStat,ownedProcessSet,validActorNonce}from'./execution-guard.mjs';
const fails=(fn,code)=>assert.throws(fn,{code});
test('SOURCE_FREE resource decisions include parent+worker aggregate, old carries and fresh shared capacity',()=>{
 const p={initial_source_active_ms:1591717,initial_capture_bytes:907560,tokenizer_phase_ms_cap:180000,cumulative_source_active_ms_cap:2791717,limits:{aggregate_RSS_bytes:1073741824,QA_bytes:16777216},base_charged_bytes:491418798,combined_prospective_cap:536870912,capture_total_bytes:2097152,whole_RUN_floor:12562479970,whole_RUN_cap:25769803776,growth_baseline:12330245718,growth_hard:536870912};
 const s={phase_elapsed_ms:180000,source_elapsed_ms:1771717,aggregate_rss_bytes:1073741824,qa_bytes:16777216,capture_bytes:2097152,whole_RUN_bytes:12562479970,capacity_age_ms:1000,observations_known:true};
 assert.equal(resourceDecision(s,p),true);for(const[k,v,code]of[['aggregate_rss_bytes',1073741825,'CENSUS_AGGREGATE_RSS'],['phase_elapsed_ms',180001,'CENSUS_PHASE_CLOCK'],['source_elapsed_ms',0,'CENSUS_PHASE_CLOCK'],['capture_bytes',0,'CENSUS_CAPTURE_BOUND'],['capacity_age_ms',1001,'CENSUS_SHARED_CAPACITY'],['observations_known',false,'CENSUS_UNKNOWN_PROCESS_OBSERVATION'],['whole_RUN_bytes',12562479969,'CENSUS_SHARED_CAPACITY'],['capture_bytes',2097153,'CENSUS_CAPTURE_BOUND']])fails(()=>resourceDecision({...s,[k]:v},p),code);
});
test('SOURCE_FREE live lease rejects stale, wrong role, birth or a restarted phase',()=>{
 assert.equal(validActorNonce('a'.repeat(32)),true);assert.equal(validActorNonce('a'.repeat(64)),false);assert.equal(validActorNonce('g'.repeat(32)),false);
 const actor={pid:20,start_ticks:'42',group:20},supervisor={pid:10,start_ticks:'12',group:8},e={nonce:'nonce',role:'prepare',source_epoch_sha256:'a'.repeat(64),boot_id:'boot',phase_origin_ns:'1000000000',actor,supervisor};
 const l={schema:'matched-context-window-live-lease-v1',status:'LIVE_WITHIN_FIXED_RESOURCE_LIMITS',...e,observed_ns:'2000000000',deadline_ns:'3000000000',observations_known:true,aggregate_rss_bytes:400000000};
 assert.equal(verifyLease(l,e,2500000000n),true);fails(()=>verifyLease(l,e,3000000001n),'CENSUS_LEASE_STALE');fails(()=>verifyLease({...l,role:'checker'},e,2500000000n),'CENSUS_LEASE_IDENTITY');fails(()=>verifyLease({...l,actor:{...actor,start_ticks:'43'}},e,2500000000n),'CENSUS_LEASE_ACTOR');fails(()=>verifyLease({...l,phase_origin_ns:'2000000000'},e,2500000000n),'CENSUS_LEASE_IDENTITY');
});
test('SOURCE_FREE reservations charge before call, span actors and never refill a spent stream',()=>{
 assert.deepEqual(reserveCounterBatch({global:59968,stream:19968}),{reserved:32,global_after:60000,stream_after:20000});fails(()=>reserveCounterBatch({global:60000,stream:0}),'CENSUS_COUNTER_CALL_BOUND');fails(()=>reserveCounterBatch({global:32,stream:20000}),'CENSUS_COUNTER_CALL_BOUND');
 assert.equal(reserveCounterBatch({global:7,stream:3,globalLimit:10,streamLimit:20}).reserved,3);fails(()=>reserveCounterBatch({global:0,stream:0,globalLimit:60001}),'CENSUS_COUNTER_LEDGER');
});
test('SOURCE_FREE process parser handles parentheses and detects birth replacement, groups and reparented known actors',()=>{
 const fields=['S','10','20',...Array(16).fill('0'),'42','0','0'];const stat=parseProcStat('20 (name) with) parens) '+fields.join(' '));assert.equal(stat.start_ticks,'42');
 const root={pid:20,ppid:10,group:20,start_ticks:'42'},child={pid:21,ppid:20,group:21,start_ticks:'43'},grand={pid:22,ppid:21,group:22,start_ticks:'44'},unrelated={pid:30,ppid:1,group:30,start_ticks:'99'};
 assert.deepEqual(ownedProcessSet([root,child,grand,unrelated],root).map(r=>r.pid),[20,21,22]);assert.equal(ownedProcessSet([{...child,ppid:1}],root,[child]).length,1);fails(()=>ownedProcessSet([{...root,start_ticks:'99'}],root),'CENSUS_ACTOR_BIRTH_CHANGED');fails(()=>ownedProcessSet([root,root],root),'CENSUS_DUPLICATE_PROCESS');fails(()=>ownedProcessSet([{...child,ppid:1,group:20}],root),'CENSUS_UNKNOWN_ORIGINAL_GROUP_MEMBER');
});
