// SPDX-License-Identifier: AGPL-3.0-only
// Real Rust/WASM crypto and software JPEGs; injected transport and in-memory
// requester seam. This does not claim physical capture, browser RTC or IndexedDB.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CameraSession, CAMERA_CONTEXT, authenticateCameraSession, verifyCameraSessionBundle, readCameraOffer} from '../../web/src/camera-session.js';
import {loadShippedCore} from '../tools/image-requester-session.mjs';
const {core} = await loadShippedCore(), operator = core.create_identity(), pin = JSON.parse(operator).fingerprint;
const jpeg = new Uint8Array(await readFile(new URL('../artifacts/qa/native-camera-synthetic.jpg', import.meta.url)));
const now = () => Math.floor(Date.now()/1000), empty = new Uint8Array(), json = JSON.stringify;
const engine = {call:async (name,...args) => core[name](...args), json:async (name,...args) => JSON.parse(await core[name](...args))};
const hints = {requester:'Synthetic requester',task:'Synthetic camera task',assurance:'browser-or-android'};
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check) { for(let n=0;n<200;n++){if(check())return;await tick();}throw new Error('Expected session state not reached.'); }
function memoryRequester(identity=core.create_identity()) {
  const pub=JSON.parse(core.live_requester_identity(identity)).pin.sha256;
  const state={accepted:0,received:0,closed:0};
  return {state,identity:async()=>pub,close:()=>state.closed++,accept:async(_,guard=()=>true)=>{assert.equal(guard(),true);state.accepted++;return {test_memory_only:true};},
    start:async(factory,{contextJson,send})=>{
      state.context=contextJson; state.spec=await factory(engine,now());
      state.original=core.create_evidence_session_request(json(state.spec),identity,now());
      state.payload=JSON.parse(core.validate_evidence_session_request(state.original,pub,json(state.spec.operator_pins),now()));
      state.wall=Date.now(); state.mono=performance.now();
      await send({sessionId:state.payload.session_id,envelope:state.original,request:state.spec.evidence});
      return {sessionId:state.payload.session_id};
    },
    receive:async(id,{primary})=>{
      state.received++; state.arrival=Date.now(); assert.equal(id,state.payload.session_id);
      const timing={sent_at_ms:state.wall,received_at_ms:state.arrival,elapsed_ms:Math.round(performance.now()-state.mono)};
      const receipt=await core.seal_evidence_session_receipt(state.original,primary,empty,'',json(timing),identity,pub,state.context,now());
      const report=JSON.parse(await core.verify_evidence_session_receipt(receipt,state.original,primary,empty,'',pub,state.context,now()));
      assert.equal(report.verified,true); return {receipt,report};
    }};
}
function fakePeer(callbacks) {
  return {callbacks,sent:[],closed:false,description:async type=>({type,sdp:'m=application 1 UDP/DTLS/SCTP webrtc-datachannel'}),answer:async()=>{},
    send(value){if(this.closed)throw new Error('closed');this.sent.push(structuredClone(value));this.other?.callbacks.onMessage(structuredClone(value));},
    async sendArtifact(bytes){if(this.closed)throw new Error('closed');assert.equal(this.other.callbacks.authorizeArtifact(),true);this.other.callbacks.onArtifact(bytes.slice());},
    close(){this.closed=true;}};
}
async function setup(t, options={}) {
  const memory=memoryRequester(), failures=[], completed=[];
  const requester=new CameraSession({role:'requester',engine,operatorPin:pin,hints:options.hints||hints,requesterFactory:options.requesterFactory|| (async()=>memory),
    peerFactory:fakePeer,onFailure:e=>failures.push(e),onComplete:r=>completed.push(r)});
  const offer=await requester.offer();await options.beforeAnswer?.(requester,offer);
  const collect=async({challenge,signal})=>{
    if(options.collect)return options.collect({challenge,signal});
    const at=Date.now(), bytes=await core.seal_image(jpeg,json(challenge),options.operator||operator,Math.floor(at/1000),
      json({latitude:0,longitude:0,accuracy_m:5,altitude_m:null,altitude_accuracy_m:null,timestamp_ms:at,source:'device-geolocation'}));
    return {bytes,fingerprint:pin};
  };
  const op=new CameraSession({role:'operator',engine,operatorPin:pin,requesterPin:offer.requester_pin,hints:offer.hints,pairingId:offer.pairing_id,
    collect,getOperatorPin:async()=>options.actualPin||pin,peerFactory:fakePeer,onFailure:e=>failures.push(e),onComplete:r=>completed.push(r)});
  t.after(()=>{requester.fail(new Error('Test cleanup'));op.fail(new Error('Test cleanup'));});
  requester.peer.other=op.peer;op.peer.other=requester.peer;
  const answer=await op.join(offer);await requester.answer(answer);
  requester.peer.callbacks.onConnected();op.peer.callbacks.onConnected();
  return {requester,op,memory,offer,failures,completed,arm:async()=>{await op.arm();await until(()=>requester.remoteArmed);}};
}
test('pairing does not issue a challenge; explicit operator consent is required before fresh request',async t=>{
  const s=await setup(t);assert.equal(s.memory.state.spec,undefined);await assert.rejects(s.requester.start(),/allow/);
  await s.arm();assert.equal(s.memory.state.spec,undefined);await s.requester.start();await until(()=>s.completed.length===2);
  assert.equal(s.memory.state.received,1);assert.equal(s.memory.state.accepted,0);
  const result=s.requester.result();assert.equal(result.report.verified,true);assert.equal(result.report.fresh_action_eligible,true);
  assert.equal(result.report.appraisal.verification.checks.c2pa_integrity,true);
  assert.equal(result.report.independent_requester_proven,false);assert.equal(result.report.physical_measurement_authenticity_proven,false);
  assert.equal(result.bundle.original_request,s.memory.state.original);assert.deepEqual(result.bytes,s.op.result().bytes);
  await s.requester.accept();assert.equal(s.memory.state.accepted,1);await assert.rejects(s.op.accept(),/Only retained/);
});
test('native-correlated policy refuses software evidence without changing the agreed profile',async t=>{
  const s=await setup(t,{hints:{...hints,assurance:'native-correlated'}});await s.arm();await s.requester.start();await until(()=>s.failures.length);
  assert.equal(s.memory.state.received,0);assert.equal(s.completed.length,0);assert.match(s.failures[0].message,/policy/);
});
test('a different valid signing key does not receive a requester receipt',async t=>{
  const s=await setup(t,{operator:core.create_identity()});await s.arm();await s.requester.start();await until(()=>s.failures.length);
  assert.equal(s.memory.state.received,0);assert.equal(s.completed.length,0);
});
test('real signed wrapper requires independently expected requester/operator, task and policy',async t=>{
  const s=await setup(t,{collect:()=>new Promise(()=>{})});await s.arm();await s.requester.start();await until(()=>s.op.phase==='capturing');
  const original=s.memory.state.original;
  for(const args of [['f'.repeat(64),pin,hints],[s.offer.requester_pin,'f'.repeat(64),hints],[s.offer.requester_pin,pin,{...hints,task:'substitution'}],
    [s.offer.requester_pin,pin,{...hints,assurance:'native-correlated'}]])await assert.rejects(authenticateCameraSession(engine,original,...args));
  const old=Date.now;try{Date.now=()=>old()+6000;await assert.rejects(authenticateCameraSession(engine,original,s.offer.requester_pin,pin,hints));}finally{Date.now=old;}
});
test('wrapper authenticated at dispatch remains retained while human shutter waits beyond five seconds',async t=>{
  let release;const s=await setup(t,{collect:({challenge})=>new Promise(resolve=>{release=async()=>{
    const at=Date.now(),bytes=await core.seal_image(jpeg,json(challenge),operator,Math.floor(at/1000),json({latitude:0,longitude:0,accuracy_m:5,altitude_m:null,altitude_accuracy_m:null,timestamp_ms:at,source:'device-geolocation'}));resolve({bytes,fingerprint:pin});};})});
  await s.arm();await s.requester.start();await until(()=>release);const old=Date.now;
  // Advance both retained transport clocks by the same duration without sleeping.
  try{Date.now=()=>old()+7000;s.memory.state.mono-=7000;await release();await until(()=>s.completed.length===2);assert.equal(s.completed[0].report.verified,true);}finally{Date.now=old;}
});
test('complete JPEG arrival enters requester before UI completion; exported copies cannot mutate retained originals',async t=>{
  const s=await setup(t);await s.arm();await s.requester.start();await until(()=>s.completed.length===2);
  assert.equal(s.memory.state.received,1);const first=s.requester.result();first.bytes[0]^=1;first.bundle.original_request='{}';first.report.verified=false;
  const next=s.requester.result();assert.equal(next.bytes[0],255);assert.equal(next.report.verified,true);assert.equal(next.bundle.original_request,s.memory.state.original);
  const okay=await verifyCameraSessionBundle(engine,next.bundle,next.bytes,s.offer.requester_pin,pin);assert.equal(okay.verified,true);
  const wrong=await verifyCameraSessionBundle(engine,{...next.bundle,operator_pin:'f'.repeat(64)},next.bytes,s.offer.requester_pin,pin);assert.equal(wrong.verified,false);
  const forged=await verifyCameraSessionBundle(engine,next.bundle,next.bytes,s.offer.requester_pin,'f'.repeat(64));assert.equal(forged.fresh_action_eligible,false);
  await assert.rejects(verifyCameraSessionBundle(engine,{...next.bundle,context_json:'{}'},next.bytes,s.offer.requester_pin,pin));
});
test('disconnect during acquisition aborts signal and late camera completion cannot send bytes',async t=>{
  let resolve,signal;const s=await setup(t,{collect:value=>{signal=value.signal;return new Promise(r=>resolve=r);}});await s.arm();await s.requester.start();await until(()=>resolve);
  s.op.peer.callbacks.onFailure(new Error('Disconnected'));assert.equal(signal.aborted,true);resolve({bytes:new Uint8Array([1]),fingerprint:pin});await tick();await tick();
  assert.equal(s.memory.state.received,0);assert.equal(s.completed.length,0);await assert.rejects(s.requester.accept());
});
test('early, repeated or foreign control fails closed and cannot arm or allocate JPEG',async t=>{
  for(const control of [{type:'request',envelope:'{}'},{type:'armed'},{type:'receipt',receipt:'{}'},{type:'unknown'}]){
    const s=await setup(t);s.op.peer.callbacks.onMessage({...control,pairing_id:s.offer.pairing_id});await until(()=>s.op.closed);assert.equal(s.memory.state.received,0);
  }
  const s=await setup(t);assert.equal(s.requester.peer.callbacks.authorizeArtifact(),false);s.requester.peer.callbacks.onMessage({type:'armed',pairing_id:'f'.repeat(64)});await until(()=>s.requester.closed);
});
test('duplicate request during acquisition cancels instead of reusing camera nonce',async t=>{
  let calls=0;const s=await setup(t,{collect:()=>{calls++;return new Promise(()=>{});}});await s.arm();await s.requester.start();await until(()=>calls);
  s.op.peer.callbacks.onMessage({type:'request',pairing_id:s.offer.pairing_id,envelope:s.memory.state.original});await until(()=>s.op.closed);assert.equal(calls,1);
});
test('cancelled asynchronous requester initialization closes late instance and cannot issue an offer',async()=>{
  let resolve;const memory=memoryRequester(),session=new CameraSession({role:'requester',engine,operatorPin:pin,hints,peerFactory:fakePeer,requesterFactory:()=>new Promise(r=>resolve=r)});
  const offer=session.offer();session.fail(new Error('cancel'));resolve(memory);await assert.rejects(offer,/active/);assert.equal(memory.state.closed,1);assert.equal(memory.state.spec,undefined);
});
test('pairing schema rejects extra keys and oversized text; answer must match fixed identities',async t=>{
  const s=await setup(t);assert.equal(readCameraOffer(json(s.offer)).requester_pin,s.offer.requester_pin);
  assert.throws(()=>readCameraOffer(json({...s.offer,policy:{}})));assert.throws(()=>readCameraOffer(' '.repeat(120001)));
  await assert.rejects(s.requester.answer({version:1,type:'nonverba-camera-answer',pairing_id:s.offer.pairing_id,requester_pin:'f'.repeat(64),operator_pin:pin,description:{}}));
});

test('successful transport close preserves acceptance; explicit cancel invalidates the final commit guard',async t=>{
  const s=await setup(t);await s.arm();await s.requester.start();await until(()=>s.completed.length===2);
  assert.equal(s.requester.closed,true);await s.requester.accept();assert.equal(s.memory.state.accepted,1);
  s.requester.cancel('User cancelled completed session');await assert.rejects(s.requester.accept());assert.equal(s.memory.state.accepted,1);
});
test('pre-challenge answer import recreates requester before generation while retaining the identical public pin',async t=>{
  const key=core.create_identity(),instances=[];const s=await setup(t,{requesterFactory:async()=>{const value=memoryRequester(key);instances.push(value);return value;},beforeAnswer:r=>r.prepareAnswerImport()});
  assert.equal(instances.length,1);assert.equal(instances[0].state.closed,1);assert.equal(instances[0].state.spec,undefined);
  await s.arm();await s.requester.start();await until(()=>s.completed.length===2);assert.equal(instances.length,2);assert.equal(instances[1].state.received,1);
  assert.equal(s.requester.result().bundle.requester_pin,s.offer.requester_pin);
});
test('identity substitution while returning from answer import cannot generate any fresh request',async t=>{
  const instances=[];const s=await setup(t,{requesterFactory:async()=>{const value=memoryRequester();instances.push(value);return value;},beforeAnswer:r=>r.prepareAnswerImport()});
  await s.arm();await assert.rejects(s.requester.start(),/identity changed/);assert.equal(instances.length,2);assert.equal(instances[1].state.spec,undefined);assert.equal(s.completed.length,0);
});
test('direct join rejects wrong domain/version even when caller skips offer parser',async()=>{
  const session=new CameraSession({role:'operator',engine,requesterPin:'b'.repeat(64),operatorPin:pin,hints,pairingId:'c'.repeat(64),getOperatorPin:async()=>pin,collect:()=>{},peerFactory:fakePeer});
  try{await assert.rejects(session.join({version:2,type:'nonverba-audio-offer',pairing_id:'c'.repeat(64),requester_pin:'b'.repeat(64),operator_pin:pin,hints,description:{}}),/Invalid camera pairing/);}finally{session.cancel();}
});
