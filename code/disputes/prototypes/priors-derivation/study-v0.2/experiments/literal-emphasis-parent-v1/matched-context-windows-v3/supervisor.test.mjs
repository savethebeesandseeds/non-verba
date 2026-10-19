// SPDX-License-Identifier: AGPL-3.0-only
// SOURCE_FREE. Pure fake process/time/capacity controls; no spawning or IO.
import test from 'node:test';import assert from 'node:assert/strict';
import {Q,POLICY_REF} from './io.mjs';
import {validateActorLaunch,makeLiveLease,verifyCapacitySample,collectOwnedProcesses,verifyProcessAbsence,statusRSS,verifyRSSObservation,validatePrepareReceipt,CHILD_ENV} from './supervisor.mjs';
import {capacityPacket,capacityLifecycle} from './capacity-worker.mjs';
import {verifyLease} from './execution-guard.mjs';
const ref=path=>({path,sha256:'a'.repeat(64),bytes:100}),supervisor={pid:10,start_ticks:'11',group:8},actor={pid:20,start_ticks:'22',group:20},epoch=ref(Q+'/ROOT-source-epoch.json'),admission=ref(Q+'/ROOT-window-admission.json');
const expected={role:'prepare',admission_ref:admission,source_epoch_ref:epoch,boot_id:'SYNTHETIC_BOOT',supervisor,phase_origin_ns:'1000000000'};
function launch(role='prepare'){return{schema:'matched-window-actor-launch-v1',role,nonce:'1'.repeat(32),source_epoch_ref:epoch,policy_ref:POLICY_REF,admission_ref:admission,phase_origin_ns:'1000000000',source_origin_ns:'1000000000',boot_id:'SYNTHETIC_BOOT',supervisor,prior_counter_receipt_ref:role==='checker'?ref(Q+'/prepare-terminal.json'):null,prior_process_close_ref:role==='checker'?ref(Q+'/execution/prepare-process-closed.json'):null};}
const leaseArgs={role:'prepare',nonce:'1'.repeat(32),source_epoch_ref:epoch,boot_id:'SYNTHETIC_BOOT',phase_origin_ns:'1000000000',supervisor,actor,observed_ns:'2000000000',aggregate_rss_bytes:400000000};
const fails=(fn,code)=>assert.throws(fn,{code});

test('SOURCE_FREE launch binds one common phase, fixed policy, exact actor roles and independent prior close',()=>{
 assert.equal(validateActorLaunch(launch(),expected),true);assert.equal(validateActorLaunch(launch('capacity'),{...expected,role:'capacity'}),true);assert.equal(validateActorLaunch(launch('checker'),{...expected,role:'checker'}),true);
 for(const change of[l=>l.source_origin_ns='2000000000',l=>l.phase_origin_ns='2000000000']){const l=launch();change(l);assert.throws(()=>validateActorLaunch(l,expected));}
 const wrong=launch('checker');wrong.prior_process_close_ref=null;fails(()=>validateActorLaunch(wrong,{...expected,role:'checker'}),'CENSUS_LAUNCH_PRIOR');
 const old=launch();old.prior_counter_receipt_ref=ref(Q+'/prepare-terminal.json');fails(()=>validateActorLaunch(old,expected),'CENSUS_LAUNCH_PRIOR');
 fails(()=>validateActorLaunch({...launch(),nonce:'1'.repeat(64)},expected),'CENSUS_LAUNCH_BINDING');
 assert.deepEqual(CHILD_ENV,{NONVERBA_CONTAINER:'1',PATH:'/usr/bin:/bin',LANG:'C.UTF-8',TZ:'UTC',HOME:'/root'});assert.equal(Object.hasOwn(CHILD_ENV,'NODE_OPTIONS'),false);
});

test('SOURCE_FREE lease never restarts the shared 180-second phase or extends the one-second sample',()=>{
 const lease=makeLiveLease(leaseArgs),e={...leaseArgs,source_epoch_sha256:epoch.sha256};assert.equal(lease.deadline_ns,'3000000000');assert.equal(verifyLease(lease,e,2500000000n),true);
 const last=makeLiveLease({...leaseArgs,observed_ns:'180900000000'});assert.equal(last.deadline_ns,'181000000000');assert.equal(verifyLease(last,e,180950000000n),true);
 const carried=makeLiveLease({...leaseArgs,observed_ns:'165900000000',historical_phase_elapsed_ms:14985});assert.equal(carried.deadline_ns,'166015000000');assert.equal(verifyLease(carried,e,166000000000n),true);
 fails(()=>makeLiveLease({...leaseArgs,observed_ns:'166015000001',historical_phase_elapsed_ms:14985}),'CENSUS_LEASE_STALE');fails(()=>makeLiveLease({...leaseArgs,historical_phase_elapsed_ms:180000}),'CENSUS_HISTORICAL_PHASE');
 fails(()=>verifyLease(lease,e,3000000001n),'CENSUS_LEASE_STALE');fails(()=>makeLiveLease({...leaseArgs,observed_ns:'181000000001'}),'CENSUS_LEASE_STALE');
 fails(()=>verifyLease({...lease,actor:{...actor,start_ticks:'99'}},e,2500000000n),'CENSUS_LEASE_ACTOR');
});

test('SOURCE_FREE capacity IPC is birth/nonce/phase-bound, metadata-only and fresh without renewing clocks',()=>{
 const l=launch('capacity'),packet=capacityPacket({result:{bytes:123456789},started_ns:2000000000n,observed_ns:2250000000n,launch:l,actor}),e={nonce:l.nonce,source_epoch_sha256:epoch.sha256,boot_id:l.boot_id,phase_origin_ns:l.phase_origin_ns,supervisor,actor};
 assert.equal(packet.scan_elapsed_ms,250);assert.equal(verifyCapacitySample(packet,e,3000000000n),true);fails(()=>verifyCapacitySample(packet,e,3250000001n),'CENSUS_CAPACITY_STALE');
 fails(()=>verifyCapacitySample({...packet,actor:{...actor,start_ticks:'replacement'}},e,2500000000n),'CENSUS_CAPACITY_IDENTITY');fails(()=>verifyCapacitySample({...packet,source_words:'SYNTHETIC_FORBIDDEN'},e,2500000000n),'CENSUS_CAPACITY_IDENTITY');fails(()=>verifyCapacitySample({...packet,phase_origin_ns:'2000000000'},e,2500000000n),'CENSUS_CAPACITY_IDENTITY');
 fails(()=>capacityPacket({result:{bytes:1},started_ns:2000000000n,observed_ns:3000000001n,launch:l,actor}),'CENSUS_CAPACITY_SCAN_BOUND');
 const stop={schema:'matched-window-capacity-stop-v1',nonce:l.nonce,source_epoch_sha256:epoch.sha256},life=capacityLifecycle({nonce:l.nonce,source_epoch_sha256:epoch.sha256});life.receive(stop);assert.equal(life.stopped(),true);life.beginDisconnect();life.disconnected();assert.equal(life.held(),false);
 const lost=capacityLifecycle({nonce:l.nonce,source_epoch_sha256:epoch.sha256});lost.disconnected();assert.equal(lost.held(),true);const wrong=capacityLifecycle({nonce:l.nonce,source_epoch_sha256:epoch.sha256});wrong.receive({...stop,nonce:'2'.repeat(32)});assert.equal(wrong.held(),true);fails(()=>wrong.beginDisconnect(),'CENSUS_CAPACITY_UNEXPECTED_DISCONNECT');
});

test('SOURCE_FREE process sample includes parent, capacity actor, tokenizer actor and observed descendants only',()=>{
 const own={...supervisor,ppid:0},capacity={pid:30,ppid:10,group:30,start_ticks:'33'},child={...actor,ppid:10},desc={pid:21,ppid:20,group:21,start_ticks:'23'},stranger={pid:100,ppid:0,group:100,start_ticks:'101'};
 const selected=collectOwnedProcesses([own,capacity,child,desc,stranger],supervisor,[{actor:capacity},{actor:child}]);assert.deepEqual(selected.map(r=>r.pid),[10,30,20,21]);assert.equal(selected.some(r=>r.pid===100),false);
 const reparented={...desc,ppid:1};assert.deepEqual(collectOwnedProcesses([own,reparented],supervisor,[{actor:child,known_births:[desc]}]).map(r=>r.pid),[10,21]);
 fails(()=>collectOwnedProcesses([{...own,start_ticks:'reused'}],supervisor,[]),'CENSUS_SUPERVISOR_BIRTH');
});

test('SOURCE_FREE unknown group members and reused births hold, never creating guessed signal ownership',()=>{
 const own={...supervisor,ppid:0},escaped={pid:21,ppid:1,group:20,start_ticks:'23'};
 fails(()=>collectOwnedProcesses([own,escaped],supervisor,[{actor}]),'CENSUS_UNKNOWN_ORIGINAL_GROUP_MEMBER');
 fails(()=>collectOwnedProcesses([own,{...actor,ppid:10,start_ticks:'reused'}],supervisor,[{actor}]),'CENSUS_ACTOR_BIRTH_CHANGED');
 fails(()=>verifyProcessAbsence([escaped],actor),'CENSUS_UNKNOWN_ORIGINAL_GROUP_MEMBER');assert.equal(verifyProcessAbsence([],actor,[escaped]),true);
 fails(()=>verifyProcessAbsence([{...escaped,group:21}],actor,[escaped]),'CENSUS_KNOWN_BIRTH_CHANGED');
});

test('SOURCE_FREE closure requires all known births and the original group absent, not just root exit',()=>{
 const escaped={pid:21,ppid:1,group:21,start_ticks:'23'};fails(()=>verifyProcessAbsence([escaped],actor,[escaped]),'CENSUS_OWNED_PROCESS_REMAINS');assert.equal(verifyProcessAbsence([],actor,[escaped]),true);
 const replacement={pid:20,ppid:1,group:20,start_ticks:'new'};fails(()=>verifyProcessAbsence([replacement],actor),'CENSUS_ACTOR_BIRTH_CHANGED');
});

test('SOURCE_FREE RSS is complete typed bytes; missing live readings never count as zero',()=>{
 assert.equal(statusRSS('Name:\tsynthetic\nVmRSS:\t12345 kB\n','S'),12641280);assert.equal(statusRSS('Name:\tsynthetic\n','Z'),0);fails(()=>statusRSS('Name:\tsynthetic\n','S'),'CENSUS_PROCESS_RSS');fails(()=>statusRSS('VmRSS: 1 kB\nVmRSS: 2 kB\n','S'),'CENSUS_PROCESS_RSS');
 assert.equal(verifyRSSObservation({started_ns:200000000n,completed_ns:230000000n,previous_ns:0n,publication_ns:250000000n}),true);fails(()=>verifyRSSObservation({started_ns:200000000n,completed_ns:250000001n,previous_ns:0n}),'CENSUS_RSS_MONITOR_STALE');fails(()=>verifyRSSObservation({started_ns:0n,completed_ns:250000001n}),'CENSUS_RSS_MONITOR_STALE');fails(()=>verifyRSSObservation({started_ns:200000000n,completed_ns:230000000n,publication_ns:450000001n}),'CENSUS_RSS_MONITOR_STALE');
});

test('SOURCE_FREE prepare receipt carries all 32 unrefunded stream reservations for the later actor',()=>{
 const streams=Array.from({length:32},(_,i)=>({stream_id:'CENSUS_'+i.toString(16).padStart(64,'0'),reserved:32,actual:3})),t={schema:'matched-window-prepare-terminal-v1',actor,source_epoch_ref:epoch,admission_ref:admission,phase_origin_ns:expected.phase_origin_ns,source_origin_ns:expected.phase_origin_ns,manifest_ref:ref(Q+'/outputs/manifest.json'),counter_receipt:{journal_ref:ref(Q+'/prepare-counter.journal.ndjson'),reserved_total:1024,actual_total:96,streams},quality_gate_pass:false,authority:'NONE'};
 assert.equal(validatePrepareReceipt(t,{actor,source_epoch_ref:epoch,admission_ref:admission,phase_origin_ns:expected.phase_origin_ns}),true);
 for(const change of[v=>v.counter_receipt.reserved_total=96,v=>v.counter_receipt.streams[0].actual=33,v=>v.counter_receipt.streams.pop(),v=>v.source_origin_ns='2000000000']){const v=structuredClone(t);change(v);assert.throws(()=>validatePrepareReceipt(v,{actor,source_epoch_ref:epoch,admission_ref:admission,phase_origin_ns:expected.phase_origin_ns}));}
});
