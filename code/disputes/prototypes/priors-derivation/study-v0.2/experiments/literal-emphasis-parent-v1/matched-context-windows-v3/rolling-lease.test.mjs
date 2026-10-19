// SPDX-License-Identifier: AGPL-3.0-only
// SOURCE_FREE. Fake descriptors and pure quota controls; no actual IO/counters.
import test from 'node:test';import assert from 'node:assert/strict';
import {readRollingLease,LEASE_DIRECTORY} from './rolling-lease.mjs';
import {verifyLease} from './execution-guard.mjs';
import {validateHistoricalCounters,reserveWithHistory,verifyReceiptCarry,counterCarryFields} from './worker.mjs';
const constants={O_RDONLY:0,O_NOFOLLOW:131072,O_NONBLOCK:2048},J=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const actor={pid:20,start_ticks:'22',group:20},supervisor={pid:10,start_ticks:'11',group:8};
const expected={nonce:'1'.repeat(32),role:'prepare',source_epoch_sha256:'a'.repeat(64),boot_id:'SYNTHETIC_BOOT',phase_origin_ns:'1000000000',actor,supervisor};
function lease(){return{schema:'matched-context-window-live-lease-v1',status:'LIVE_WITHIN_FIXED_RESOURCE_LIMITS',...expected,observed_ns:'2000000000',deadline_ns:'3000000000',observations_known:true,aggregate_rss_bytes:400000000};}
function fake(options={}){
 const bytes=options.bytes??J(lease()),state={opens:0,closes:0,stats:0,reads:0,parent_checks:[],path_lstats:0},base={dev:1,ino:2,size:bytes.length,nlink:1,isFile:()=>true},before={...base,...options.before},after={...base,...options.after};
 const io={lstatSync(){state.path_lstats++;assert.fail('rolling file pathname must never be lstat-checked');},openSync(file,flags){state.opens++;assert.equal(file,LEASE_DIRECTORY+'/current-lease.json');assert.equal(flags,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);if(options.open_error)throw Object.assign(Error('synthetic'),{code:options.open_error});return 7;},fstatSync(fd){assert.equal(fd,7);return state.stats++===0?before:after;},readSync(fd,b,offset,length,position){assert.equal(fd,7);state.reads++;if(options.short&&position>0)return 0;if(position>=bytes.length){if(options.extra_eof){b[offset]=120;return 1;}return 0;}const n=Math.min(length,options.chunk??length,bytes.length-position);bytes.copy(b,offset,position,position+n);return n;},closeSync(fd){assert.equal(fd,7);state.closes++;}};
 const noLinks=(file,directory)=>{state.parent_checks.push({file,directory});assert.equal(file,LEASE_DIRECTORY);assert.equal(directory,true);if(options.parent_error)throw Object.assign(Error('synthetic'),{code:options.parent_error});};
 return{io,constants,noLinks,state};
}
const fails=(fn,code)=>assert.throws(fn,{code});

test('SOURCE_FREE rolling rename/unlink retains one old FD without file-path lstat or identity substitution',()=>{
 for(const nlink of[0,1]){const f=fake({before:{nlink},after:{nlink:0},chunk:7}),value=readRollingLease(f);assert.deepEqual(value,lease());assert.equal(verifyLease(value,expected,2500000000n),true);assert.equal(f.state.opens,1);assert.equal(f.state.closes,1);assert.equal(f.state.path_lstats,0);assert.deepEqual(f.state.parent_checks,[{file:LEASE_DIRECTORY,directory:true}]);}
 // A newly published lease may be newer than the clock sampled before open.
 // Verification uses the time after the single FD has been fully consumed.
 const beforeOpen=1999999999n,published=readRollingLease(fake()),afterRead=2000000001n;fails(()=>verifyLease(published,expected,beforeOpen),'CENSUS_LEASE_STALE');assert.equal(verifyLease(published,expected,afterRead),true);
});

test('SOURCE_FREE held old descriptor remains subject to exact nonce, birth and original freshness',()=>{
 const value=readRollingLease(fake({after:{nlink:0}}));fails(()=>verifyLease(value,expected,3000000001n),'CENSUS_LEASE_STALE');fails(()=>verifyLease({...value,nonce:'2'.repeat(32)},expected,2500000000n),'CENSUS_LEASE_IDENTITY');fails(()=>verifyLease({...value,actor:{...actor,start_ticks:'23'}},expected,2500000000n),'CENSUS_LEASE_ACTOR');fails(()=>verifyLease({...value,phase_origin_ns:'2000000000'},expected,2500000000n),'CENSUS_LEASE_IDENTITY');
});

test('SOURCE_FREE parent symlink, file nofollow failure, hardlink and nonregular descriptors remain rejected',()=>{
 const parent=fake({parent_error:'CENSUS_LINK_KIND'});fails(()=>readRollingLease(parent),'CENSUS_LINK_KIND');assert.equal(parent.state.opens,0);
 const symlink=fake({open_error:'ELOOP'});fails(()=>readRollingLease(symlink),'ELOOP');assert.equal(symlink.state.closes,0);
 for(const options of[{before:{nlink:2}},{before:{nlink:-1}},{before:{isFile:()=>false}},{after:{nlink:2}},{after:{nlink:-1}},{after:{isFile:()=>false}}]){const f=fake(options);assert.throws(()=>readRollingLease(f));assert.equal(f.state.closes,1);}
});

test('SOURCE_FREE rolling read checks byte ceiling before reads, short EOF and same-descriptor changes',()=>{
 for(const size of[0,8193,1.5]){const f=fake({before:{size}});fails(()=>readRollingLease(f),'CENSUS_LEASE_FILE');assert.equal(f.state.reads,0);assert.equal(f.state.closes,1);}
 const short=fake({chunk:4,short:true});fails(()=>readRollingLease(short),'CENSUS_LEASE_SHORT');assert.equal(short.state.closes,1);
 for(const after of[{dev:3},{ino:4},{size:J(lease()).length+1}]){const f=fake({after});fails(()=>readRollingLease(f),'CENSUS_LEASE_CHANGED');assert.equal(f.state.closes,1);}
 const extra=fake({extra_eof:true});fails(()=>readRollingLease(extra),'CENSUS_LEASE_CHANGED');assert.equal(extra.state.closes,1);
});

test('SOURCE_FREE rolling bytes require full strict UTF8 and exact published JSON serialization',()=>{
 for(const bytes of[Buffer.from([255]),Buffer.from('{broken'),Buffer.from(JSON.stringify(lease())+'\n'),Buffer.from(J(lease()).toString().replace('  '+String.fromCharCode(34)+'observed_ns','   '+String.fromCharCode(34)+'observed_ns'))]){const f=fake({bytes});assert.throws(()=>readRollingLease(f));assert.equal(f.state.closes,1);}
});

const streamID=i=>'CENSUS_'+i.toString(16).padStart(64,'0');
function historyFixture(){const allowed=new Map(Array.from({length:32},(_,i)=>[streamID(i),{}])),policy={historical_counter_reserved_total:8288,historical_counter_actual_total:7234,historical_counter_reserved_by_stream:Object.fromEntries(Array.from({length:30},(_,i)=>[streamID(i),i===29?284:276]))};return{allowed,policy};}
test('SOURCE_FREE historical 30-stream reservations are exact and never invent per-stream actual counts',()=>{
 const{allowed,policy}=historyFixture(),history=validateHistoricalCounters(policy,allowed);assert.equal(history.reserved_total,8288);assert.equal(history.actual_total,7234);assert.equal(Object.keys(history.reserved_by_stream).length,30);assert.equal(history.reserved_by_stream[streamID(30)],undefined);assert.equal(Object.hasOwn(history,'actual_by_stream'),false);assert.ok(Object.isFrozen(history.reserved_by_stream));
 for(const change of[p=>p.historical_counter_reserved_total=0,p=>p.historical_counter_actual_total=0,p=>p.historical_counter_reserved_by_stream[streamID(0)]++,p=>{p.historical_counter_reserved_by_stream.CENSUS_UNKNOWN=276;delete p.historical_counter_reserved_by_stream[streamID(0)];},p=>p.historical_counter_reserved_by_stream[streamID(30)]=0]){const p=structuredClone(policy);change(p);assert.throws(()=>validateHistoricalCounters(p,allowed));}
 policy.historical_counter_reserved_by_stream[streamID(0)]=1;assert.equal(history.reserved_by_stream[streamID(0)],276);
});

test('SOURCE_FREE shared global and per-stream ceilings include history once and retain unused reservations',()=>{
 assert.equal(reserveWithHistory({history:8288,historical_stream:0,current_global:51711,current_stream:0}).reserved,1);fails(()=>reserveWithHistory({history:8288,historical_stream:0,current_global:51712,current_stream:0}),'CENSUS_COUNTER_CALL_BOUND');
 assert.equal(reserveWithHistory({history:8288,historical_stream:276,current_global:19723,current_stream:19723}).reserved,1);fails(()=>reserveWithHistory({history:8288,historical_stream:276,current_global:19724,current_stream:19724}),'CENSUS_COUNTER_CALL_BOUND');
 const currentPrepare=1024,currentChecker=32,reservation=reserveWithHistory({history:8288,historical_stream:276,current_global:currentPrepare+currentChecker,current_stream:64});assert.equal(reservation.global_after,8288+currentPrepare+currentChecker+32);assert.equal(reservation.stream_after,276+64+32);
 fails(()=>reserveWithHistory({history:8288,historical_stream:8289,current_global:1,current_stream:0}),'CENSUS_HISTORICAL_RESERVATION');
});

test('SOURCE_FREE prepare/checker receipts keep current totals separate from one historical global charge',()=>{
 const{allowed,policy}=historyFixture(),history=validateHistoricalCounters(policy,allowed),prepare=counterCarryFields({history,local_reserved:1024,local_actual:960}),checker=counterCarryFields({history,inherited_reserved:prepare.reserved_total,inherited_actual:prepare.actual_total,local_reserved:32,local_actual:3});
 assert.equal(prepare.reserved_total,1024);assert.equal(prepare.actual_total,960);assert.equal(prepare.cumulative_reserved_total,9312);assert.equal(prepare.cumulative_actual_total,8194);assert.equal(checker.reserved_total,1056);assert.equal(checker.actual_total,963);assert.equal(checker.cumulative_reserved_total,9344);assert.equal(checker.cumulative_actual_total,8197);assert.equal(verifyReceiptCarry(checker,history),true);assert.equal(Object.hasOwn(checker,'historical_actual_by_stream'),false);
 for(const change of[r=>r.historical_reserved_total=0,r=>r.historical_actual_total=0,r=>r.cumulative_reserved_total+=8288,r=>r.cumulative_actual_total+=7234,r=>r.reserved_total+=8288]){const r={...checker};change(r);fails(()=>verifyReceiptCarry(r,history),'CENSUS_COUNTER_CARRY');}
 fails(()=>counterCarryFields({history,local_reserved:51713,local_actual:1}),'CENSUS_COUNTER_CARRY');
});
