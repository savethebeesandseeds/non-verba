// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareCameraPermissions} from '../../web/src/camera-session-preflight.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('video is stopped before GPS permission/fix, no frame retained, then native flags rechecked',async()=>{
  const calls=[],abort=new AbortController(),stream={getTracks:()=>[{stop:()=>calls.push('stop')}]};
  const result=await prepareCameraPermissions({signal:abort.signal,requestVideo:async()=>{calls.push('video');return stream;},requestLocation:async()=>{calls.push('gps');return {discarded:true};},checkPermissions:()=>calls.push('flags'),hidden:()=>false});
  assert.deepEqual(calls,['video','stop','gps','flags']);assert.equal(result,undefined);
});
test('cancellation while camera permission is pending closes a late returned stream',async()=>{
  let release,stops=0;const abort=new AbortController();const pending=prepareCameraPermissions({signal:abort.signal,requestVideo:()=>new Promise(r=>release=r),requestLocation:()=>assert.fail('GPS cannot start'),hidden:()=>false});
  await tick();abort.abort();await assert.rejects(pending,/cancelled/);release({getTracks:()=>[{stop:()=>stops++}]});await tick();assert.equal(stops,1);
});
test('cancellation propagates to GPS warmup after camera tracks are closed',async()=>{
  let locationSignal,stops=0;const abort=new AbortController();const pending=prepareCameraPermissions({signal:abort.signal,requestVideo:async()=>({getTracks:()=>[{stop:()=>stops++}]}),requestLocation:signal=>{locationSignal=signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled'))));},hidden:()=>false});
  await tick();abort.abort();await assert.rejects(pending,/cancelled/);assert.equal(stops,1);assert.equal(locationSignal.aborted,true);
});
test('already cancelled preflight does not request either sensor',async()=>{
  const abort=new AbortController();abort.abort();await assert.rejects(prepareCameraPermissions({signal:abort.signal,requestVideo:()=>assert.fail('camera'),requestLocation:()=>assert.fail('gps'),hidden:()=>false}),/cancelled/);
});
test('denial, absent precise permission and foreground loss fail before pairing',async()=>{
  await assert.rejects(prepareCameraPermissions({requestVideo:async()=>{throw new Error('denied');},hidden:()=>false}),/denied/);
  for(const kind of ['flags','hidden']){let stops=0;await assert.rejects(prepareCameraPermissions({requestVideo:async()=>({getTracks:()=>[{stop:()=>stops++}]}),requestLocation:async()=>({}),checkPermissions:()=>{if(kind==='flags')throw new Error('precise');},hidden:()=>kind==='hidden'}));assert.equal(stops,1);}
});
