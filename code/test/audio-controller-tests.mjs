// SPDX-License-Identifier: AGPL-3.0-only
// The controller runs without a DOM. Clocks, transport and lifecycle are injected;
// round generation, PCM commitments and signed-WAV verification use real Rust.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {AudioSession} from '../../web/src/audio-controller.js';
import {loadShippedCore} from '../tools/image-requester-session.mjs';

const {core} = await loadShippedCore();
const base = 2000000000, pin = 'a'.repeat(64), requesterPin = 'b'.repeat(64), pairingId = 'c'.repeat(64);
const json = JSON.stringify;
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; }
function fixture(options = {}) {
  const request = JSON.parse(core.create_audio_request('Synthetic requester', 'Synthetic controller fixture', base, 900, 4));
  const state = {mono: 0, hidden: false, current: true, timers: new Map(), sent: [], receipts: [], failures: [], events: [], calls: []};
  let timerId = 0;
  const engine = {
    async call(method, ...args) { state.calls.push(method); return core[method](...args); },
    async json(method, ...args) { return JSON.parse(await this.call(method, ...args)); },
  };
  const evidence = {
    async identity() { return requesterPin; },
    async start(send) { await send({request: {request}, envelope: 'original-envelope'}); },
    retainTranscript(receipt) { state.transcript = receipt; },
    receive(bytes) { state.events.push('arrival'); state.arrivedBytes = bytes; return options.receiving?.promise ?? Promise.resolve({receipt: 'signed-final-receipt', report: {verified: true}}); },
    bundle() { return {type: 'nonverba-audio-session-evidence'}; },
    async accept(guard) { if (!guard()) throw new Error('Acceptance cancelled'); return {accepted: true}; },
    close() { state.evidenceClosed = true; }, prepareAnswerImport() {},
  };
  const peer = {send(message) { state.sent.push(message); }, close() { state.peerClosed = true; },
    async description(type) { return {type}; }, async answer() {}, async sendArtifact() {}, async sendChunk() {}};
  let callbacks;
  const clock = {seconds: () => base + Math.floor(state.mono / 1000), monotonic: () => state.mono,
    setTimeout(callback, delay) { const id = ++timerId; state.timers.set(id, {callback, delay}); return id; },
    clearTimeout(id) { state.timers.delete(id); }};
  const controller = new AudioSession({role: options.role ?? 'requester', demo: options.demo ?? false,
    request: options.role === 'operator' ? request : null, pin, requesterPin, pairingId,
    hints: {requester: request.requester, task: request.task, duration_secs: 4, assurance: 'browser-or-android'},
    engine, identity: () => json({fingerprint: pin}), nativePlatform: () => null,
    captureFactory: () => options.capture, nativeCaptureFactory: () => options.capture,
    peerFactory: value => { callbacks = value; return peer; },
    demoPeerFactory: value => { callbacks = value; state.demoFactory = true; return peer; },
    evidenceFactory: () => { state.evidenceFactory = true; return evidence; },
    persistence: {readCapture: async () => null, reserveCapture: async () => {},
      retainReceipt: async receipt => { state.receipts.push(receipt); }},
    authenticate: async () => ({spec: {evidence: {request}, policy: {native_acquisition_required: false}}}),
    verifyFinalReceipt: async () => ({verified: true}), clock,
    lifecycle: {hidden: () => state.hidden, current: () => state.current},
    onState: ({phase}) => { state.events.push(phase); }, onFailure: error => state.failures.push(error),
    onReceipt: receipt => { state.latestReceipt = receipt; }, onComplete: result => { state.completed = result; },
    ...options.overrides,
  });
  return {controller, state, request, engine, evidence, peer, get callbacks() { return callbacks; }};
}
async function recording(f) {
  f.callbacks.onConnected(); await f.controller.queue;
  f.callbacks.onMessage({type: 'ready', fingerprint: pin}); await f.controller.queue;
  await f.controller.start(); assert.equal(f.controller.phase, 'recording');
}
function segment(f, index) {
  const round = f.state.sent.find(message => message.type === 'round' && message.index === index);
  const pcm = new Float32Array(96000); pcm.set(core.audio_probe(f.request.session_id, index, round.nonce), 4800);
  return {pcm, bytes: core.encode_audio_pcm(pcm)};
}
async function deliver(f, index, at) {
  f.state.mono = at; assert.equal(f.callbacks.authorizeChunk(index), true);
  const result = segment(f, index); f.callbacks.onChunk(index, result.bytes); await f.controller.queue; return result;
}

test('default clock preserves the platform timer receiver during pairing and disposal', async () => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let scheduled = 0; const cleared = [];
  globalThis.setTimeout = function () {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    scheduled++; return scheduled;
  };
  globalThis.clearTimeout = function (id) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    cleared.push(id);
  };
  try {
    const f = fixture({overrides: {clock: undefined}});
    await f.controller.answer({version: 2, type: 'nonverba-audio-answer', pairing_id: pairingId,
      requester_pin: requesterPin, operator_pin: pin, description: {type: 'answer'}});
    f.controller.close();
    assert.equal(scheduled, 1); assert.ok(cleared.includes(1)); assert.deepEqual(f.controller.cleanupErrors, []);
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
});

test('headless controller issues successors only after PCM commitment; its transcript verifies in a real signed WAV', async t => {
  assert.equal(typeof globalThis.document, 'undefined');
  const f = fixture(); t.after(() => f.controller.close()); await recording(f);
  assert.equal(f.state.sent.filter(message => message.type === 'round').length, 1);
  const first = await deliver(f, 0, 2000);
  assert.equal(f.state.sent.filter(message => message.type === 'round').length, 2);
  const second = await deliver(f, 1, 4000);
  assert.equal(f.controller.phase, 'awaiting-wav');
  assert.equal(f.state.receipts.length, 1); assert.equal(f.state.transcript, f.state.latestReceipt);
  const transcript = f.state.latestReceipt.transcript;
  assert.deepEqual(transcript.rounds.map(round => [round.issued_elapsed_ms, round.received_elapsed_ms]), [[0, 2000], [2000, 4000]]);
  const pcm = new Float32Array(192000); pcm.set(first.pcm); pcm.set(second.pcm, 96000);
  const identity = core.create_identity(), fingerprint = JSON.parse(identity).fingerprint;
  const wav = await core.seal_audio(pcm, identity, json(f.request), json(transcript), base + 4);
  const report = JSON.parse(await core.verify_audio(wav, json(f.request), json(transcript), fingerprint, base + 4));
  assert.equal(report.verified, true, json(report.errors));
});

test('chunk arrival time is captured before queued work, while the next nonce waits for decoding and hashing', async t => {
  const f = fixture(); t.after(() => f.controller.close()); await recording(f);
  const waiting = deferred(), call = f.engine.call.bind(f.engine);
  f.engine.call = async (method, ...args) => method === 'decode_audio_pcm' ? waiting.promise : call(method, ...args);
  f.state.mono = 2000; assert.equal(f.callbacks.authorizeChunk(0), true);
  const first = segment(f, 0); f.callbacks.onChunk(0, first.bytes); await tick();
  f.state.mono = 2200;
  assert.equal(f.state.sent.filter(message => message.type === 'round').length, 1);
  assert.equal(f.callbacks.authorizeChunk(0), false);
  waiting.resolve(core.decode_audio_pcm(first.bytes)); await f.controller.queue;
  assert.equal(f.controller.rounds[0].received_elapsed_ms, 2000);
  assert.equal(f.controller.pendingRound.issued_elapsed_ms, 2200);
});

test('late, early, repeated and out-of-order segments cannot advance the challenge sequence', async t => {
  for (const at of [100, 3001]) {
    const f = fixture(); t.after(() => f.controller.close()); await recording(f);
    assert.equal(f.callbacks.authorizeChunk(1), false);
    await deliver(f, 0, at); assert.equal(f.controller.phase, 'failed');
    assert.equal(f.state.receipts.length, 0); assert.equal(f.state.sent.filter(message => message.type === 'round').length, 1);
  }
  const f = fixture(); t.after(() => f.controller.close()); await recording(f); await deliver(f, 0, 2000);
  assert.equal(f.callbacks.authorizeChunk(0), false); assert.equal(f.callbacks.authorizeChunk(2), false);
});

test('suspension during asynchronous hashing prevents a successor challenge or retained transcript', async t => {
  const f = fixture(); t.after(() => f.controller.close()); await recording(f);
  const waiting = deferred(), call = f.engine.call.bind(f.engine);
  f.engine.call = async (method, ...args) => method === 'hash_audio_pcm' ? waiting.promise : call(method, ...args);
  f.state.mono = 2000; assert.equal(f.callbacks.authorizeChunk(0), true);
  f.callbacks.onChunk(0, segment(f, 0).bytes); await tick(); f.controller.suspend();
  waiting.resolve('d'.repeat(64)); await f.controller.queue;
  assert.equal(f.controller.phase, 'failed'); assert.equal(f.state.receipts.length, 0);
  assert.equal(f.state.sent.filter(message => message.type === 'round').length, 1);
  assert.equal(f.state.peerClosed, true); assert.equal(f.state.evidenceClosed, true); assert.equal(f.state.timers.size, 0);
});

test('complete WAV arrival reaches requester evidence before any rendering callback', async t => {
  const receiving = deferred(), f = fixture({receiving}); t.after(() => f.controller.close());
  await recording(f); await deliver(f, 0, 2000); await deliver(f, 1, 4000);
  f.state.events = []; assert.equal(f.callbacks.authorizeArtifact(), true);
  const bytes = new Uint8Array([1, 2, 3]); f.callbacks.onArtifact(bytes);
  assert.deepEqual(f.state.events, ['arrival', 'verifying-wav']); assert.equal(f.state.arrivedBytes, bytes);
  receiving.resolve({receipt: 'signed-final-receipt', report: {verified: true}}); await tick();
  assert.equal(f.controller.phase, 'done'); assert.equal(f.state.completed.bytes, bytes);
  await f.controller.accept(() => true); assert.equal(f.controller.accepted.accepted, true);
});

test('cancellation during final evidence verification cannot surface completion or send a final receipt', async t => {
  const receiving = deferred(), f = fixture({receiving}); t.after(() => f.controller.close());
  await recording(f); await deliver(f, 0, 2000); await deliver(f, 1, 4000);
  assert.equal(f.callbacks.authorizeArtifact(), true); f.callbacks.onArtifact(new Uint8Array([1]));
  f.controller.suspend(); receiving.resolve({receipt: 'signed-final-receipt', report: {verified: true}}); await tick();
  assert.equal(f.controller.phase, 'failed'); assert.equal(f.state.completed, undefined);
  assert.equal(f.state.sent.some(message => message.type === 'final-receipt'), false);
});

test('demo factory cannot create requester evidence or enter fresh acceptance', async t => {
  const f = fixture({role: 'operator', demo: true}); t.after(() => f.controller.close());
  assert.equal(f.state.demoFactory, true); assert.equal(f.state.evidenceFactory, undefined); assert.equal(f.controller.evidence, undefined);
  await assert.rejects(f.controller.accept(() => true), /Only completed requester/);
  f.callbacks.onMessage({type: 'session-request', pairing_id: pairingId}); await f.controller.queue;
  assert.match(f.state.failures[0].message, /Unexpected or replayed/);
});

test('native pause always closes an active controller; permission-dialog exception belongs to the visibility adapter', async t => {
  const f = fixture({role: 'operator'}); t.after(() => f.controller.close());
  let closed = 0; f.controller.phase = 'testing'; f.controller.nativeCapture = true;
  f.controller.capture = {permissionPending: () => true, close() { closed++; }};
  f.controller.suspend(); assert.equal(f.controller.phase, 'failed'); assert.equal(closed, 1);
});

test('failure revokes authority and attempts every release even when timers, capture and transport throw', () => {
  const f = fixture(), released = [], original = new Error('Original acoustic failure');
  const release = (name, throws = true) => () => {
    assert.equal(f.controller.cancelled, true); assert.equal(f.controller.isCurrent(), false);
    released.push(name); if (throws) throw new Error(name + ' close failed');
  };
  f.controller.clock.clearTimeout = release('timer');
  f.controller.capture = {close: release('capture')};
  f.peer.close = release('peer'); f.evidence.close = release('evidence');
  f.controller.fail(original);
  assert.deepEqual(released, ['timer', 'timer', 'capture', 'peer', 'evidence']);
  assert.equal(f.controller.phase, 'failed'); assert.deepEqual(f.state.failures, [original]);
  assert.equal(f.state.events.at(-1), 'failed'); assert.equal(f.controller.cleanupErrors.length, 5);
  assert.equal(f.state.completed, undefined); assert.equal(f.controller.finalBundle, null);
  f.controller.close(); f.controller.fail(new Error('Secondary failure'));
  assert.deepEqual(released, ['timer', 'timer', 'capture', 'peer', 'evidence']); assert.deepEqual(f.state.failures, [original]);
});

test('transport release failure after verified completion preserves explicit requester acceptance', async t => {
  const f = fixture(); t.after(() => f.controller.close());
  await recording(f); await deliver(f, 0, 2000); await deliver(f, 1, 4000);
  assert.equal(f.callbacks.authorizeArtifact(), true); f.callbacks.onArtifact(new Uint8Array([1])); await tick();
  f.peer.close = () => { throw new Error('Completed transport release failed'); };
  f.callbacks.onFailure(new Error('Transport disconnected after completion'));
  assert.equal(f.controller.phase, 'done'); assert.equal(f.controller.cancelled, false); assert.equal(f.state.failures.length, 0);
  assert.equal(f.controller.cleanupErrors[0].resource, 'completed peer');
  await f.controller.accept(() => true); assert.equal(f.controller.accepted.accepted, true);
});
