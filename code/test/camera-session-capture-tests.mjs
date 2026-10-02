// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic handoff lifecycle tests only: no camera, permission, UI or network.
import assert from 'node:assert/strict';
import test from 'node:test';
import {setImmediate as turn} from 'node:timers/promises';
import {CameraCaptureHandoff} from '../../web/src/camera-session-capture.js';
if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Run inside non-verba-dev.');
const PIN = 'a'.repeat(64);
const challenge = (id = '1'.repeat(64)) => ({version:1, id, requester:'Requester', task:'Current task',
  nonce:'synthetic-nonce', issued_at:2000000000, expires_at:2000000300});
const policy = () => ({version:1, native_acquisition_required:true, raw_gnss_required:false,
  correlated_camera_clock_required:true, hardware_attestation_required:false, independent_position_required:false});
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; }
function harness(t, prepare = async () => {}) {
  const state = {locks:[], prepared:[], stops:0};
  const handoff = new CameraCaptureHandoff({prepare:spec => { state.prepared.push(spec); return prepare(spec); },
    stop:() => { state.stops++; }, lock:value => state.locks.push(value)});
  t.after(() => handoff.fail(new Error('Test cleanup')));
  return {handoff, state};
}
function spec(request = challenge(), controller = new AbortController()) {
  return {challenge:request, policy:policy(), operatorPin:PIN, signal:controller.signal, controller};
}
function completion(request = challenge(), changes = {}) {
  return {bytes:new Uint8Array([255,216,255,217]), challenge:request, fingerprint:PIN, locationProof:null, ...changes};
}

test('preparation alone cannot resolve capture; exact manual completion returns an independent byte copy', {timeout:1000}, async t => {
  const {handoff, state} = harness(t), input = spec(); let settled = false;
  const pending = handoff.collect(input); pending.then(() => { settled = true; });
  assert.equal(handoff.pending, true); assert.deepEqual(state.locks, [true]);
  await turn(); assert.equal(settled, false); assert.equal(state.prepared.length, 1);
  assert.deepEqual(state.prepared[0].challenge, input.challenge); assert.deepEqual(state.prepared[0].policy, input.policy);
  assert.equal(state.prepared[0].operatorPin, PIN); assert.equal(state.prepared[0].signal, input.signal);
  const result = completion(); assert.equal(handoff.complete(result), true);
  const received = await pending; assert.deepEqual(received, {bytes:result.bytes, fingerprint:PIN});
  result.bytes.fill(0); assert.deepEqual([...received.bytes], [255,216,255,217]);
  assert.equal(handoff.pending, false); assert.deepEqual(state.locks, [true,false]); assert.equal(state.stops, 0);
  input.controller.abort(); assert.equal(state.stops, 0, 'Completed capture detaches its abort listener');
  assert.equal(handoff.complete(completion()), false);
});

test('caller and preparation mutations cannot replace the retained original challenge or policy', async t => {
  const {handoff, state} = harness(t, async prepared => {
    prepared.challenge.task = 'Preparation mutation'; prepared.policy.native_acquisition_required = false;
  });
  const input = spec(), original = structuredClone(input.challenge), expectedPolicy = structuredClone(input.policy);
  const pending = handoff.collect(input); input.challenge.task = 'Caller mutation'; input.policy.correlated_camera_clock_required = false;
  await turn(); assert.equal(state.prepared[0].policy.correlated_camera_clock_required, expectedPolicy.correlated_camera_clock_required);
  assert.equal(handoff.complete(completion(original)), true); await pending;
});

test('a different challenge field, signer, byte representation or composed proof abandons capture', async t => {
  const cases = [
    ['task', {challenge:{...challenge(), task:'Different task'}}],
    ['nonce', {challenge:{...challenge(), nonce:'different'}}],
    ['extra challenge field', {challenge:{...challenge(), extra:true}}],
    ['missing challenge field', {challenge:{version:1, id:challenge().id}}],
    ['key', {fingerprint:'b'.repeat(64)}],
    ['array buffer', {bytes:new ArrayBuffer(4)}],
    ['array', {bytes:[255,216,255,217]}],
    ['composed proof', {locationProof:{version:1, cose_b64:'unrelated'}}],
    ['encoded composed proof', {locationProof:'signed-location-proof'}],
  ];
  for (const [label, change] of cases) await t.test(label, async sub => {
    const {handoff, state} = harness(sub), pending = handoff.collect(spec());
    const failed = assert.rejects(pending, /challenge or signing identity changed/); await turn();
    assert.equal(handoff.complete(completion(challenge(), change)), false); await failed;
    assert.equal(handoff.pending, false); assert.deepEqual(state.locks, [true,false]); assert.equal(state.stops, 1);
    assert.equal(handoff.complete(completion()), false); assert.equal(state.stops, 1);
  });
});

test('completion before preparation is ready cannot use the pending challenge', async t => {
  const gate = deferred(), {handoff, state} = harness(t, () => gate.promise);
  const pending = handoff.collect(spec()), failed = assert.rejects(pending, /changed/);
  await turn(); assert.equal(state.prepared.length, 1);
  assert.equal(handoff.complete(completion()), false); await failed; gate.resolve(); await turn();
  assert.equal(handoff.pending, false); assert.equal(handoff.complete(completion()), false);
  assert.equal(state.stops, 1); assert.deepEqual(state.locks, [true,false]);
});

test('already-aborted collection never locks or prepares the camera', async t => {
  const {handoff, state} = harness(t), input = spec(); input.controller.abort();
  await assert.rejects(handoff.collect(input), /cancelled/); await turn();
  assert.equal(handoff.pending, false); assert.deepEqual(state.locks, []); assert.deepEqual(state.prepared, []); assert.equal(state.stops, 0);
});

test('abort before the preparation microtask rejects immediately and never prepares', async t => {
  const {handoff, state} = harness(t), input = spec();
  const pending = handoff.collect(input), failed = assert.rejects(pending, /cancelled/);
  input.controller.abort(); await failed; await turn();
  assert.equal(handoff.pending, false); assert.deepEqual(state.prepared, []); assert.equal(state.stops, 1);
  assert.deepEqual(state.locks, [true,false]);
});

test('abort during preparation rejects; late preparation cannot resurrect the capture', async t => {
  const gate = deferred(), {handoff, state} = harness(t, () => gate.promise), input = spec();
  const pending = handoff.collect(input), failed = assert.rejects(pending, /cancelled/); await turn();
  input.controller.abort(); await failed; assert.equal(handoff.pending, false); gate.resolve(); await turn();
  assert.equal(handoff.complete(completion()), false); assert.equal(state.stops, 1); assert.deepEqual(state.locks, [true,false]);
});

test('abort after readiness rejects and prevents any subsequent completion', async t => {
  const {handoff, state} = harness(t), input = spec();
  const pending = handoff.collect(input), failed = assert.rejects(pending, /cancelled/); await turn();
  input.controller.abort(); await failed; assert.equal(handoff.complete(completion()), false);
  assert.equal(handoff.pending, false); assert.equal(state.stops, 1); assert.deepEqual(state.locks, [true,false]);
});

test('duplicate collection cannot replace the first pending request', async t => {
  const {handoff, state} = harness(t), input = spec(), pending = handoff.collect(input);
  await assert.rejects(handoff.collect(spec(challenge('2'.repeat(64)))), /already pending/); await turn();
  assert.equal(state.prepared.length, 1); assert.deepEqual(state.prepared[0].challenge, input.challenge);
  assert.equal(handoff.complete(completion(input.challenge)), true); await pending;
  assert.deepEqual(state.locks, [true,false]); assert.equal(state.stops, 0);
});

test('external failure rejects once, stops once and releases its abort listener', async t => {
  const {handoff, state} = harness(t), input = spec(), error = new Error('Camera permission lost');
  const pending = handoff.collect(input), failed = assert.rejects(pending, e => e === error); await turn();
  handoff.fail(error); await failed; handoff.fail(new Error('Repeated failure')); input.controller.abort();
  assert.equal(handoff.pending, false); assert.equal(state.stops, 1); assert.deepEqual(state.locks, [true,false]);
  assert.equal(handoff.complete(completion()), false);
});

test('synchronous and asynchronous preparation failures reject the manual handoff', async t => {
  for (const mode of ['throw','reject']) await t.test(mode, async sub => {
    const reason = new Error('Preparation failed');
    const {handoff, state} = harness(sub, () => { if (mode === 'throw') throw reason; return Promise.reject(reason); });
    await assert.rejects(handoff.collect(spec()), error => error === reason);
    assert.equal(handoff.pending, false); assert.equal(state.stops, 1); assert.deepEqual(state.locks, [true,false]);
  });
});

test('late preparation success or failure cannot mark a replacement capture ready or reject it', async t => {
  for (const late of ['resolve','reject']) await t.test(late, async sub => {
    const firstGate = deferred(), secondGate = deferred(); let calls = 0;
    const {handoff, state} = harness(sub, () => (++calls === 1 ? firstGate.promise : secondGate.promise));
    const first = spec(), firstPending = handoff.collect(first), firstFailed = assert.rejects(firstPending, /cancelled/);
    await turn(); first.controller.abort(); await firstFailed;
    const second = spec(challenge('2'.repeat(64))), secondPending = handoff.collect(second);
    let settled = false; secondPending.then(() => { settled = true; }, () => { settled = true; }); await turn();
    firstGate[late](late === 'reject' ? new Error('Late failure') : undefined); await turn();
    assert.equal(handoff.pending, true); assert.equal(settled, false); assert.equal(state.stops, 1);
    secondGate.resolve(); await turn(); assert.equal(settled, false, 'Preparation must still wait for the manual shutter result');
    assert.equal(handoff.complete(completion(second.challenge)), true); await secondPending;
    assert.deepEqual(state.locks, [true,false,true,false]); assert.equal(state.stops, 1);
  });
});

const LOCATION_PIN = 'c'.repeat(64);
function composedSpec() {
  const input = spec();
  input.locationRequest = {version:1, type:'nonverba-location-request', challenge:structuredClone(input.challenge),
    policy:{profile:'native-required', required_provider:'gnss', duration_ms:10000, min_samples:3,
      raw_gnss:{version:1, mode:'required', min_epochs:3}}, context:{purpose:'camera', session_id:input.challenge.id}};
  input.operatorLocationPin = LOCATION_PIN;
  return input;
}
function composedCompletion(input, changes = {}) {
  return completion(structuredClone(input.challenge), {locationProof:new Uint8Array([9,8,7]),
    locationRequest:structuredClone(input.locationRequest), locationFingerprint:LOCATION_PIN, ...changes});
}

test('composed handoff retains the full request and both keys, then returns separate immutable artifacts', async t => {
  const {handoff, state}=harness(t), input=composedSpec(), original=structuredClone(input.locationRequest);
  const pending=handoff.collect(input); input.locationRequest.policy.duration_ms=1; input.operatorLocationPin='d'.repeat(64);
  await turn(); assert.deepEqual(state.prepared[0].locationRequest,original); assert.equal(state.prepared[0].operatorLocationPin,LOCATION_PIN);
  state.prepared[0].locationRequest.policy.raw_gnss.mode='optional';
  const result=composedCompletion({...input,locationRequest:original});
  assert.equal(handoff.complete(result),true); const received=await pending;
  assert.deepEqual(received.locationRequest,original);assert.equal(received.locationFingerprint,LOCATION_PIN);
  result.bytes.fill(0);result.locationProof.fill(0);result.locationRequest.context.session_id='changed';
  assert.deepEqual([...received.bytes],[255,216,255,217]);assert.deepEqual([...received.locationProof],[9,8,7]);
  assert.equal(received.locationRequest.context.session_id,original.context.session_id);
});

test('composed handoff rejects incomplete or substituted artifacts and the full original location authority', async t => {
  const cases=[
    ['missing proof',x=>{x.locationProof=null;}],['empty proof',x=>{x.locationProof=new Uint8Array();}],
    ['proof object',x=>{x.locationProof={bytes:[9,8,7]};}],['oversized proof',x=>{x.locationProof=new Uint8Array(2*1024*1024+16*1024+1);}],
    ['empty JPEG',x=>{x.bytes=new Uint8Array();}],['oversized JPEG',x=>{x.bytes=new Uint8Array(32*1024*1024+1);}],
    ['location key',x=>{x.locationFingerprint='d'.repeat(64);}],['media key',x=>{x.fingerprint='d'.repeat(64);}],
    ['missing request',x=>{delete x.locationRequest;}],['location profile',x=>{x.locationRequest.policy.profile='browser-or-native';}],
    ['raw policy',x=>{delete x.locationRequest.policy.raw_gnss;}],['composition context',x=>{x.locationRequest.context.session_id='other';}],
    ['nested extra field',x=>{x.locationRequest.policy.extra=true;}],['challenge nonce',x=>{x.locationRequest.challenge.nonce='other';}],
  ];
  for(const[label,mutate]of cases)await t.test(label,async sub=>{
    const {handoff,state}=harness(sub),input=composedSpec(),pending=handoff.collect(input),failed=assert.rejects(pending,/changed/);
    await turn();const result=composedCompletion(input);mutate(result);assert.equal(handoff.complete(result),false);await failed;
    assert.equal(state.stops,1);assert.equal(handoff.pending,false);
  });
});

test('malformed composed collection authority is refused before preparation or lock',async t=>{
  const cases=[x=>{delete x.operatorLocationPin;},x=>{x.locationRequest.context.purpose='standalone';},
    x=>{x.locationRequest.challenge.id='other';},x=>{x.locationRequest=null;}];
  for(const change of cases){const {handoff,state}=harness(t),input=composedSpec();change(input);
    await assert.rejects(handoff.collect(input),/incomplete/);assert.deepEqual(state.locks,[]);assert.deepEqual(state.prepared,[]);}
});

test('composed cancellation rejects a late pair without success and cannot complete a replacement',async t=>{
  const {handoff,state}=harness(t),input=composedSpec(),pending=handoff.collect(input),failed=assert.rejects(pending,/cancelled/);
  await turn();input.controller.abort();await failed;
  assert.equal(handoff.complete(composedCompletion(input)),false);assert.equal(state.stops,1);
});

test('semantic JSON field reordering preserves authority without weakening full field comparison',async t=>{
  const {handoff}=harness(t),input=composedSpec(),pending=handoff.collect(input);await turn();
  const result=composedCompletion(input);result.locationRequest=Object.fromEntries(Object.entries(result.locationRequest).reverse());
  result.challenge=Object.fromEntries(Object.entries(result.challenge).reverse());
  assert.equal(handoff.complete(result),true);await pending;
});


test('Buffer subclasses cannot alias retained JPEG or location proof after completion',async t=>{
  const {handoff}=harness(t),input=composedSpec(),pending=handoff.collect(input);await turn();
  const result=composedCompletion(input,{bytes:Buffer.from([255,216,255,217]),locationProof:Buffer.from([9,8,7])});
  assert.equal(handoff.complete(result),true);const retained=await pending;result.bytes.fill(0);result.locationProof.fill(0);
  assert.deepEqual([...retained.bytes],[255,216,255,217]);assert.deepEqual([...retained.locationProof],[9,8,7]);
});
