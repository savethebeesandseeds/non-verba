// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {enrollmentPlatform, enrollmentCapabilities, exportEnrollment, selectEnrollmentProfile, NativeEnrollmentSession} from '../../web/src/key-enrollment-platform.js';
const pin = 'ab'.repeat(32), request = {purpose:'location',challenge_b64:'original-requester-challenge'};
const result = () => ({version:1,type:'nonverba-key-enrollment',purpose:'location',key_profile:'attested',hardware_attested:false,fingerprint:pin,spki_sha256:pin,challenge_b64:request.challenge_b64});
function fixture() {
  const calls = [];
  const bridge = {capabilities:() => JSON.stringify({version:1,available:true,purposes:{}}),
    begin:(purpose,challenge) => { calls.push(['begin',purpose,challenge]); return JSON.stringify({session_id:'one',purpose,state:'preparing'}); },
    status:id => JSON.stringify({session_id:id,purpose:'location',state:'ready',result:result()}),
    cancel:id => {calls.push(['cancel',id]);return '{}';},
    exportEnrollmentForKey:() => JSON.stringify(result()),
    selectProfile:(purpose,key_profile,fingerprint) => JSON.stringify({ok:true,purpose,key_profile,fingerprint})};
  return {bridge,calls};
}
test('enrollment availability needs the complete native bridge; no software fallback', () => {
  assert.equal(enrollmentPlatform({}),null); const {bridge}=fixture(); assert.equal(enrollmentPlatform({NativeKeyEnrollment:bridge}),bridge);
  delete bridge.cancel; assert.equal(enrollmentPlatform({NativeKeyEnrollment:bridge}),null);
});
test('native errors and unsupported capabilities fail', () => {
  const {bridge}=fixture(); bridge.capabilities=()=>'{"ok":false,"error":"identity mismatch"}';
  assert.throws(()=>enrollmentCapabilities(bridge),/identity mismatch/);
  bridge.capabilities=()=>'{"version":2,"available":true,"purposes":{}}'; assert.throws(()=>enrollmentCapabilities(bridge),/Unsupported/);
});
test('session freezes original purpose and challenge while awaiting native completion', async () => {
  const {bridge,calls}=fixture(), mutable={...request};
  const session=new NativeEnrollmentSession(bridge,{wait:async()=>{mutable.challenge_b64='substituted';}});
  assert.equal((await session.run(mutable)).fingerprint,pin); assert.deepEqual(calls,[['begin','location',request.challenge_b64]]);
  await assert.rejects(session.run(request),/already used/);
});
test('changed native session IDs cancel before delivering a key',async()=>{
  const {bridge,calls}=fixture(); bridge.status=()=>JSON.stringify({session_id:'other',purpose:'location',state:'ready',result:result()});
  await assert.rejects(new NativeEnrollmentSession(bridge,{wait:async()=>{}}).run(request),/session changed/);
  assert.deepEqual(calls.at(-1),['cancel','one']);
});
test('substituted challenge, purpose, identity or local hardware verdict is refused',async()=>{
  for(const change of [{challenge_b64:'other'},{purpose:'media'},{fingerprint:'invalid'},{hardware_attested:true}]){
    const {bridge}=fixture(); bridge.status=()=>JSON.stringify({session_id:'one',purpose:'location',state:'ready',result:{...result(),...change}});
    await assert.rejects(new NativeEnrollmentSession(bridge,{wait:async()=>{}}).run(request),/original request/);
  }
});
test('cancellation during native key creation prevents result delivery',async()=>{
  const {bridge,calls}=fixture(); let session;
  session=new NativeEnrollmentSession(bridge,{wait:async()=>session.cancel()});
  await assert.rejects(session.run(request),/cancelled/); assert.ok(calls.some(c=>c[0]==='cancel'));
});
test('elapsed timeout and backwards clock cancel the native operation',async()=>{
  for(const changed of [65001,-1]){
    const {bridge,calls}=fixture(); let elapsed=0;
    const session=new NativeEnrollmentSession(bridge,{clock:()=>elapsed,wait:async()=>{elapsed=changed;}});
    await assert.rejects(session.run(request),/time limit/); assert.deepEqual(calls.at(-1),['cancel','one']);
  }
});
test('unexpected native state and oversize responses fail',async()=>{
  const {bridge}=fixture(); bridge.status=()=>JSON.stringify({session_id:'one',purpose:'location',state:'capturing'});
  await assert.rejects(new NativeEnrollmentSession(bridge,{wait:async()=>{}}).run(request),/did not complete/);
  bridge.exportEnrollmentForKey=()=> ' '.repeat(301*1024); assert.throws(()=>exportEnrollment(bridge,'location',pin),/Invalid/);
});
test('saved enrollment export keeps its exact identity and purpose',()=>{
  const {bridge}=fixture(); assert.equal(exportEnrollment(bridge,'location',pin).fingerprint,pin);
  assert.throws(()=>exportEnrollment(bridge,'media',pin),/original request/);
  assert.throws(()=>exportEnrollment(bridge,'location','cd'.repeat(32)),/changed identity/);
  assert.throws(()=>exportEnrollment(bridge,'location',''),/exact enrolled/);
});
test('identity selection requires exact expected pin, purpose and profile',()=>{
  const {bridge}=fixture(); assert.equal(selectEnrollmentProfile(bridge,'location','attested',pin).fingerprint,pin);
  assert.throws(()=>selectEnrollmentProfile(bridge,'location','attested',''),/available/);
  bridge.selectProfile=()=>JSON.stringify({ok:true,purpose:'location',key_profile:'legacy',fingerprint:pin});
  assert.throws(()=>selectEnrollmentProfile(bridge,'location','attested',pin),/did not match/);
});
