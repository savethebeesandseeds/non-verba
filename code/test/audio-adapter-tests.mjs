// SPDX-License-Identifier: AGPL-3.0-only
// Run from code/: node --test test/audio-adapter-tests.mjs
// Regression tests for cancellation and untrusted transport input. These fake
// platform boundaries exercise the production adapters without audio hardware,
// network connections, WASM, or sleeps long enough to hide dangling promises.
import assert from 'node:assert/strict';
import test from 'node:test';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {AudioCapture} from '../../web/src/audio-capture.js';
import {AudioPeer} from '../../web/src/audio-peer.js';

function overrideGlobals(values) {
  const originals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
  return () => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
}

function capturePlatform(t, {pendingResume = false, pendingPermission = false, pendingModule = false, pendingPrime = false,
  resumeError, permissionError, moduleError, connectionError, disconnectError, closeError, settings = {}} = {}) {
  const state = {permissionCalls: 0, moduleCalls: 0, nodes: [], playback: [], buffers: [], controls: [], failures: [], contexts: [], streams: [], pendingPermission};
  function microphone() {
    const track = new EventTarget();
    track.readyState = 'live'; track.muted = false; track.stops = 0;
    track.getSettings = () => ({sampleRate: 48000, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false, ...settings});
    track.stop = () => { track.stops++; track.readyState = 'ended'; };
    const stream = {getAudioTracks: () => [track], getTracks: () => [track]};
    state.streams.push({track, stream}); return {track, stream};
  }
  const {track, stream} = microphone();
  class Context extends EventTarget {
    constructor() {
      super(); this.sampleRate = 48000; this.currentTime = 0; this.state = 'suspended'; this.destination = {}; state.contexts.push(this);
      this.audioWorklet = {addModule: async () => {
        state.moduleCalls++;
        if (moduleError) throw moduleError;
        if (pendingModule) return new Promise((resolve, reject) => { state.module = resolve; state.rejectModule = reject; });
      }};
    }
    resume() {
      if (resumeError) return Promise.reject(resumeError);
      if (pendingResume) return new Promise((resolve, reject) => { state.resume = resolve; state.rejectResume = reject; });
      this.state = 'running'; return Promise.resolve();
    }
    close() { this.state = 'closed'; if (closeError) throw closeError; return Promise.resolve(); }
    createMediaStreamSource() { return {connect() { if (connectionError) throw connectionError; }, disconnect() { if (disconnectError) throw disconnectError; }}; }
    createBuffer(channels, length, sampleRate) {
      const buffer = {channels, length, sampleRate, copyToChannel(samples, channel) { this.samples = samples.slice(); this.channel = channel; }};
      state.buffers.push(buffer); return buffer;
    }
    createBufferSource() {
      const source = {stops: 0, disconnects: 0, connect(destination) { this.destination = destination; },
        start(time) { this.startTime = time; }, stop() { this.stops++; }, disconnect() { this.disconnects++; },
        finish() { this.ended = true; this.onended?.(); }};
      state.playback.push(source); return source;
    }
  }
  class Worklet {
    constructor() { this.port = {postMessage: message => {
      state.controls.push(message);
      if (message.type === 'prime' && !pendingPrime) queueMicrotask(() => this.emit({type: 'ready'}));
    }}; state.nodes.push(this); }
    connect() {}
    disconnect() { if (disconnectError) throw disconnectError; }
    emit(message) { this.port.onmessage({data: message}); }
  }
  const restore = overrideGlobals({AudioContext: Context, AudioWorkletNode: Worklet,
    navigator: {mediaDevices: {getUserMedia: async () => {
      state.permissionCalls++;
      if (permissionError) throw permissionError;
      const result = state.permissionCalls === 1 ? stream : microphone().stream;
      if (state.pendingPermission) return new Promise((resolve, reject) => { state.permission = () => resolve(result); state.rejectPermission = reject; });
      return result;
    }}}});
  const capture = new AudioCapture(error => state.failures.push(error));
  t.after(() => { capture.close(); restore(); });
  return {capture, state, track};
}

test('cancellation during AudioContext.resume never requests microphone permission', {timeout: 1000}, async t => {
  const {capture, state} = capturePlatform(t, {pendingResume: true});
  const opening = capture.open();
  const rejected = assert.rejects(opening, /cancelled/i);
  capture.close();
  await rejected;
  assert.equal(state.contexts[0].state, 'closed');
  assert.equal(state.permissionCalls, 0);
  state.resume(); await nextTurn();
  assert.equal(state.permissionCalls, 0);
  assert.equal(capture.ready, false);
});

test('cancellation settles a pending permission request and stops every late granted track', {timeout: 1000}, async t => {
  const {capture, state, track} = capturePlatform(t, {pendingPermission: true});
  const extraTrack = {stops: 0, stop() { this.stops++; }};
  state.streams[0].stream.getTracks = () => [track, extraTrack];
  const opening = capture.open(); await nextTurn();
  assert.equal(state.permissionCalls, 1);
  const rejected = assert.rejects(opening, /cancelled/i);
  capture.close(); await rejected;
  assert.equal(state.contexts[0].state, 'closed');
  assert.equal(state.moduleCalls, 0);
  state.permission(); await nextTurn();
  assert.equal(track.readyState, 'ended');
  assert.equal(track.stops, 1);
  assert.equal(extraTrack.stops, 1);
  assert.equal(state.nodes.length, 0);
  assert.equal(capture.ready, false);
  assert.deepEqual(state.failures, []);
});

test('cancellation settles a pending worklet module and rejects its late readiness', {timeout: 1000}, async t => {
  const {capture, state, track} = capturePlatform(t, {pendingModule: true});
  const opening = capture.open(); await nextTurn();
  assert.equal(state.moduleCalls, 1);
  const rejected = assert.rejects(opening, /cancelled/i);
  capture.close(); await rejected;
  assert.equal(track.readyState, 'ended');
  assert.equal(state.contexts[0].state, 'closed');
  state.module(); await nextTurn();
  assert.equal(state.nodes.length, 0);
  assert.equal(capture.ready, false);
  assert.deepEqual(state.controls, []);
});

test('late setup rejections are handled after immediate cancellation', {timeout: 1000}, async t => {
  for (const [option, rejection] of [['pendingResume', 'rejectResume'], ['pendingPermission', 'rejectPermission'], ['pendingModule', 'rejectModule']]) {
    await t.test(option, async sub => {
      const {capture, state} = capturePlatform(sub, {[option]: true});
      const opening = capture.open(); await nextTurn();
      const rejected = assert.rejects(opening, /cancelled/i);
      capture.close(); await rejected;
      state[rejection](new Error('Late platform rejection')); await nextTurn();
      assert.equal(capture.ready, false);
      assert.equal(state.contexts[0].state, 'closed');
      assert.deepEqual(state.failures, []);
    });
  }
});

test('repeated open cannot replace a pending or ready microphone owner', {timeout: 1000}, async t => {
  await t.test('pending setup', async sub => {
    const {capture, state} = capturePlatform(sub, {pendingResume: true});
    const opening = capture.open();
    await assert.rejects(capture.open(), /already started/);
    assert.equal(state.contexts.length, 1);
    const rejected = assert.rejects(opening, /cancelled/i);
    capture.close(); await rejected;
  });
  await t.test('ready capture', async sub => {
    const {capture, state, track} = capturePlatform(sub);
    await capture.open();
    await assert.rejects(capture.open(), /already started/);
    assert.equal(capture.ready, true);
    assert.equal(state.permissionCalls, 1);
    assert.equal(state.contexts.length, 1);
    assert.equal(state.nodes.length, 1);
    assert.equal(track.readyState, 'live');
  });
});

test('setup failures preserve their original rejection and close owned resources', {timeout: 1000}, async t => {
  for (const [option, microphoneOwned] of [['resumeError', false], ['permissionError', false], ['moduleError', true]]) {
    await t.test(option, async sub => {
      const error = new Error(`Original ${option}`);
      const {capture, state, track} = capturePlatform(sub, {[option]: error});
      await assert.rejects(capture.open(), actual => actual === error);
      assert.equal(capture.closed, true);
      assert.equal(state.contexts[0].state, 'closed');
      assert.equal(track.stops, microphoneOwned ? 1 : 0);
      assert.equal(state.nodes.length, 0);
      await assert.rejects(capture.open(), /cancelled/i);
      assert.equal(state.contexts.length, 1);
    });
  }
  await t.test('unconfirmed microphone profile', async sub => {
    const {capture, state, track} = capturePlatform(sub, {settings: {echoCancellation: true}});
    await assert.rejects(capture.open(), /cannot confirm/);
    assert.equal(track.readyState, 'ended');
    assert.equal(track.stops, 1);
    assert.equal(state.contexts[0].state, 'closed');
    assert.equal(state.moduleCalls, 0);
  });
});

test('a fresh adapter can recover while an old permission response is still pending', {timeout: 1000}, async t => {
  const {capture, state, track} = capturePlatform(t, {pendingPermission: true});
  const opening = capture.open(); await nextTurn();
  const rejected = assert.rejects(opening, /cancelled/i);
  capture.close(); await rejected;
  const latePermission = state.permission;
  state.pendingPermission = false;
  const retry = new AudioCapture(error => state.failures.push(error));
  t.after(() => retry.close());
  await retry.open();
  const freshTrack = state.streams[1].track;
  assert.equal(retry.ready, true);
  assert.equal(freshTrack.readyState, 'live');
  latePermission(); await nextTurn();
  assert.equal(track.readyState, 'ended');
  assert.equal(freshTrack.readyState, 'live');
  assert.equal(retry.ready, true);
  assert.equal(state.nodes.length, 1);
  assert.deepEqual(state.failures, []);
});

test('throwing node teardown cannot replace a setup error or prevent track and context cleanup', {timeout: 1000}, async t => {
  const original = new Error('Original source connection failure');
  const {capture, state, track} = capturePlatform(t, {connectionError: original, disconnectError: new Error('Disconnect failure'), closeError: new Error('Synchronous context close failure')});
  await assert.rejects(capture.open(), error => error === original);
  assert.equal(state.nodes.length, 1);
  assert.equal(track.readyState, 'ended');
  assert.equal(track.stops, 1);
  assert.equal(state.contexts[0].state, 'closed');
  assert.equal(capture.closed, true);
  assert.doesNotThrow(() => capture.close());
});

test('a late stream disposal error is handled after cancellation', {timeout: 1000}, async t => {
  const {capture, state} = capturePlatform(t, {pendingPermission: true});
  state.streams[0].stream.getTracks = () => { throw new Error('Late getTracks failure'); };
  const opening = capture.open(); await nextTurn();
  const rejected = assert.rejects(opening, /cancelled/i);
  capture.close(); await rejected;
  state.permission(); await nextTurn();
  assert.equal(capture.ready, false);
  assert.equal(state.contexts[0].state, 'closed');
  assert.deepEqual(state.failures, []);
});

test('cancellation before the first audio quantum rejects start and completion', {timeout: 1000}, async t => {
  const {capture, track} = capturePlatform(t);
  await capture.open();
  const starting = capture.record(1, () => assert.fail('Cancelled capture delivered a chunk'));
  const startRejected = assert.rejects(starting, /cancelled/i);
  const doneRejected = assert.rejects(capture.finished, /cancelled/i);
  capture.close();
  await Promise.all([startRejected, doneRejected]);
  assert.equal(track.readyState, 'ended');
});

test('pending input priming cannot record and cancellation settles setup without late readiness', {timeout: 1000}, async t => {
  const {capture, state, track} = capturePlatform(t, {pendingPrime: true});
  const opening = capture.open();
  await nextTurn();
  assert.equal(state.controls[0].type, 'prime');
  await assert.rejects(capture.record(1, () => assert.fail('Unprimed capture delivered PCM')), /not ready/i);
  const rejected = assert.rejects(opening, /cancelled/i);
  capture.close(); await rejected;
  state.nodes[0].emit({type: 'ready'});
  assert.equal(capture.ready, false);
  assert.equal(track.readyState, 'ended');
  assert(!state.controls.some(message => message.type === 'start'));
});

test('input priming has a three-second deadline and closes its track on timeout', {timeout: 1000}, async t => {
  const {capture, state, track} = capturePlatform(t, {pendingPrime: true});
  let timer;
  const restore = overrideGlobals({setTimeout: (fn, milliseconds) => { timer = {fn, milliseconds}; return timer; }, clearTimeout: () => {}});
  t.after(restore);
  const opening = capture.open();
  await nextTurn();
  assert.equal(timer.milliseconds, 3000);
  const rejected = assert.rejects(opening, /did not stabilize/i);
  timer.fn(); await rejected;
  assert.equal(capture.closed, true);
  assert.equal(track.readyState, 'ended');
  assert(!state.controls.some(message => message.type === 'start'));
});

test('cancellation after start settles the pilot and is safe for callback-only sessions', {timeout: 1000}, async t => {
  const {capture, state, track} = capturePlatform(t);
  await capture.open();
  let delivered = 0;
  const starting = capture.record(2, () => { delivered++; });
  state.nodes[0].emit({type: 'started', frame: 128});
  await starting;
  const finished = capture.finished;
  capture.close();
  // Real recording sessions do not await finished. Give Node an event-loop turn
  // to detect an unhandled rejection before explicitly checking its rejection.
  await nextTurn();
  await assert.rejects(finished, /cancelled/i);
  state.nodes[0].emit({type: 'chunk', index: 0, samples: new Float32Array(96000)});
  state.nodes[0].emit({type: 'done'});
  assert.equal(delivered, 0);
  assert.equal(track.readyState, 'ended');
});

test('finished speaker probes stay attached until capture closes and then every source is released', {timeout: 1000}, async t => {
  const {capture, state, track} = capturePlatform(t);
  await capture.open();
  const signal = new Float32Array(36864).fill(0.05);
  const starting = capture.record(2, () => {});
  state.nodes[0].emit({type: 'started', frame: 128}); await starting;
  capture.play(signal); state.playback[0].finish();
  capture.play(signal); state.playback[1].finish();
  assert.equal(capture.recording, true);
  assert.equal(capture.sources.size, 2);
  for (const source of state.playback) {
    assert.equal(source.destination, state.contexts[0].destination);
    assert.equal(source.disconnects, 0, 'An ended probe must not mutate the recording graph');
    assert.equal(source.stops, 0);
    assert.equal(source.startTime, 0.025);
    assert.equal(source.buffer.sampleRate, 48000);
    assert.equal(source.buffer.length, 36864);
  }
  capture.close(); await assert.rejects(capture.finished, /cancelled/i);
  assert.equal(track.readyState, 'ended'); assert.equal(state.contexts[0].state, 'closed');
  assert.equal(capture.sources.size, 0);
  for (const source of state.playback) {
    assert.equal(source.stops, 1); assert.equal(source.disconnects, 1);
    source.finish(); assert.equal(source.disconnects, 1, 'Late completion cannot reconnect or mutate closed capture');
  }
  capture.close();
  assert(state.playback.every(source => source.stops === 1 && source.disconnects === 1));
});

test('retained playback is bounded to one pilot and fifteen supported probes before allocating more audio', {timeout: 1000}, async t => {
  const {capture, state} = capturePlatform(t);
  await capture.open();
  for (const length of [0, 36863, 36865]) assert.throws(() => capture.play(new Float32Array(length)), /supported audio session profile/);
  assert.equal(state.buffers.length, 0); assert.equal(state.playback.length, 0);
  for (let index = 0; index < 16; index++) { capture.play(new Float32Array(36864)); state.playback[index].finish(); }
  assert.equal(capture.sources.size, 16);
  assert.throws(() => capture.play(new Float32Array(36864)), /supported audio session profile/);
  assert.equal(state.buffers.length, 16); assert.equal(state.playback.length, 16);
  capture.close();
  assert.equal(capture.sources.size, 0);
  assert(state.playback.every(source => source.stops === 1 && source.disconnects === 1));
});

test('a throwing playback teardown cannot strand another source or the microphone', {timeout: 1000}, async t => {
  const {capture, state, track} = capturePlatform(t);
  await capture.open(); capture.play(new Float32Array(36864)); capture.play(new Float32Array(36864));
  state.playback[0].stop = () => { throw new Error('Playback stop failed'); };
  state.playback[0].disconnect = () => { throw new Error('Playback disconnect failed'); };
  assert.doesNotThrow(() => capture.close());
  assert.equal(capture.sources.size, 0);
  assert.equal(state.playback[1].stops, 1); assert.equal(state.playback[1].disconnects, 1);
  assert.equal(track.readyState, 'ended'); assert.equal(state.contexts[0].state, 'closed');
});

function peerPlatform(t, authorizeChunk = () => false, {authorizeArtifact = () => false} = {}) {
  class Connection { close() { this.closed = true; } }
  const restore = overrideGlobals({RTCPeerConnection: Connection});
  const state = {failures: [], chunks: [], artifacts: [], messages: [], sent: []};
  let peer;
  peer = new AudioPeer(message => state.messages.push(message), (index, bytes) => state.chunks.push({index, bytes}),
    error => { state.failures.push(error); peer.close(); }, () => {}, authorizeChunk,
    bytes => state.artifacts.push(bytes), authorizeArtifact);
  t.after(() => { peer.close(); restore(); });
  const channel = Object.assign(new EventTarget(), {label: 'nonverba-audio-v1', ordered: true, maxRetransmits: null, maxPacketLifeTime: null,
    readyState: 'open', bufferedAmount: 0, send(value) { state.sent.push(value); },
    close() { this.closed = true; this.readyState = 'closed'; }});
  return {peer, state, channel};
}

test('an invalid unsolicited data channel is closed and reported instead of throwing', t => {
  const {peer, state, channel} = peerPlatform(t, () => false);
  channel.label = 'unsolicited';
  assert.doesNotThrow(() => peer.pc.ondatachannel({channel}));
  assert.equal(channel.closed, true);
  assert.equal(peer.closed, true);
  assert.equal(state.failures.length, 1);
  assert.match(state.failures[0].message, /unsupported/i);
});

const MAX_WAV = 8 * 1024 * 1024;
const ARTIFACT_INDEX = 0xffffffff;
function fragment(index, offset, size, fill = 0) {
  const packet = new ArrayBuffer(size + 8), view = new DataView(packet);
  view.setUint32(0, index, true); view.setUint32(4, offset, true);
  new Uint8Array(packet, 8).fill(fill);
  return packet;
}
function artifactHeader(channel, bytes) { channel.onmessage({data: JSON.stringify({type: 'artifact', bytes})}); }
function failedTransfer({peer, state}) {
  assert.equal(peer.closed, true);
  assert.equal(peer.incoming, null);
  assert.equal(state.artifacts.length, 0);
  assert.equal(state.chunks.length, 0);
  assert.equal(state.failures.length, 1);
}

test('final WAV allocation happens only after explicit application authorization', t => {
  const allocations = [], NativeBytes = Uint8Array;
  let calls = 0;
  const harness = peerPlatform(t, () => false, {authorizeArtifact: () => {
    calls++; assert.equal(allocations.length, 0); assert.equal(harness.peer.incoming, null); return false;
  }});
  const restore = overrideGlobals({Uint8Array: new Proxy(NativeBytes, {
    construct(target, args, newTarget) { allocations.push(args[0]); return Reflect.construct(target, args, newTarget); }
  })});
  t.after(restore);
  harness.peer.pc.ondatachannel({channel: harness.channel});
  artifactHeader(harness.channel, MAX_WAV);
  assert.equal(calls, 1);
  assert.deepEqual(allocations, []);
  failedTransfer(harness);
});

test('malformed final WAV headers fail before authorizing or allocating', async t => {
  const cases = [
    {type: 'artifact', bytes: 0}, {type: 'artifact', bytes: -1},
    {type: 'artifact', bytes: 1.5}, {type: 'artifact', bytes: '16000'},
    {type: 'artifact', bytes: null}, {type: 'artifact', bytes: MAX_WAV + 1},
    {type: 'artifact', bytes: Number.MAX_SAFE_INTEGER + 1}, {type: 'artifact'},
    {type: 'artifact', bytes: 1, index: ARTIFACT_INDEX},
  ];
  for (const message of cases) await t.test(JSON.stringify(message), sub => {
    let authorized = 0;
    const harness = peerPlatform(sub, () => false, {authorizeArtifact: () => { authorized++; return true; }});
    harness.peer.pc.ondatachannel({channel: harness.channel});
    harness.channel.onmessage({data: JSON.stringify(message)});
    assert.equal(authorized, 0);
    failedTransfer(harness);
  });
});

test('final WAV size boundaries allocate exactly the permitted bytes and close clears them', async t => {
  for (const size of [1, MAX_WAV]) await t.test(String(size), sub => {
    const harness = peerPlatform(sub, () => false, {authorizeArtifact: () => true});
    harness.peer.pc.ondatachannel({channel: harness.channel});
    artifactHeader(harness.channel, size);
    assert.equal(harness.peer.incoming.bytes.length, size);
    assert.equal(harness.peer.incoming.index, ARTIFACT_INDEX);
    assert.equal(harness.state.failures.length, 0);
    harness.peer.close();
    assert.equal(harness.peer.incoming, null);
  });
});

test('final WAV sends and reconstructs exact reserved-index fragments including its short tail', async t => {
  let authorized = 0;
  const harness = peerPlatform(t, () => false, {authorizeArtifact: () => ++authorized === 1});
  const {peer, state, channel} = harness;
  peer.pc.ondatachannel({channel});
  const original = Uint8Array.from({length: 32005}, (_, index) => index % 251);
  await peer.sendArtifact(original);
  assert.deepEqual(JSON.parse(state.sent[0]), {type: 'artifact', bytes: original.length});
  assert.equal(state.sent.length, 4);
  channel.onmessage({data: state.sent[0]});
  for (let index = 1; index < state.sent.length; index++) {
    const packet = state.sent[index], view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
    const offset = (index - 1) * 16000;
    assert.equal(view.getUint32(0, true), ARTIFACT_INDEX);
    assert.equal(view.getUint32(4, true), offset);
    assert.equal(packet.byteLength, Math.min(16000, original.length - offset) + 8);
    channel.onmessage({data: packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength)});
    assert.equal(state.artifacts.length, index === 3 ? 1 : 0);
  }
  assert.equal(authorized, 1);
  assert.equal(peer.incoming, null);
  assert.equal(peer.sending, false);
  assert.equal(state.failures.length, 0);
  assert.equal(state.chunks.length, 0);
  assert.deepEqual(state.artifacts[0], original);
  original.fill(0);
  assert.notDeepEqual(state.artifacts[0], original, 'Retained output must not alias the sender input');
  // Application authorization is consumed before hash/receipt processing. A
  // repeated header cannot allocate another output while that work is pending.
  artifactHeader(channel, 1);
  assert.equal(authorized, 2);
  assert.equal(peer.closed, true);
  assert.equal(peer.incoming, null);
  assert.equal(state.artifacts.length, 1);
  assert.equal(state.failures.length, 1);
});

test('final WAV requires exact index, offset and fragment lengths', async t => {
  const cases = [
    ['PCM index cannot carry final WAV', () => fragment(0, 0, 16000)],
    ['wrong reserved index', () => fragment(0xfffffffe, 0, 16000)],
    ['initial offset must be zero', () => fragment(ARTIFACT_INDEX, 1, 16000)],
    ['short nonfinal fragment', () => fragment(ARTIFACT_INDEX, 0, 15999)],
    ['oversized fragment', () => fragment(ARTIFACT_INDEX, 0, 16001)],
    ['empty fragment', () => fragment(ARTIFACT_INDEX, 0, 0)],
    ['typed array is not negotiated ArrayBuffer transport', () => new Uint8Array(16008)],
    ['Blob is not negotiated ArrayBuffer transport', () => new Blob(['bad'])],
  ];
  for (const [label, makePacket] of cases) await t.test(label, sub => {
    const harness = peerPlatform(sub, () => false, {authorizeArtifact: () => true});
    harness.peer.pc.ondatachannel({channel: harness.channel});
    artifactHeader(harness.channel, 16001);
    harness.channel.onmessage({data: makePacket()});
    failedTransfer(harness);
  });
  for (const [label, packet] of [
    ['repeated first fragment', fragment(ARTIFACT_INDEX, 0, 16000)],
    ['skipped final byte offset', fragment(ARTIFACT_INDEX, 16001, 1)],
    ['final fragment must fit remaining bytes exactly', fragment(ARTIFACT_INDEX, 16000, 2)],
  ]) await t.test(label, sub => {
    const harness = peerPlatform(sub, () => false, {authorizeArtifact: () => true});
    harness.peer.pc.ondatachannel({channel: harness.channel});
    artifactHeader(harness.channel, 16001);
    harness.channel.onmessage({data: fragment(ARTIFACT_INDEX, 0, 16000)});
    harness.channel.onmessage({data: packet});
    failedTransfer(harness);
  });
});

test('control or second headers cannot interleave an in-progress final WAV', async t => {
  for (const message of [{type: 'artifact', bytes: 1}, {type: 'chunk', index: 0, bytes: 192000}, {type: 'round', index: 1}]) {
    await t.test(message.type, sub => {
      let artifactCalls = 0, chunkCalls = 0;
      const harness = peerPlatform(sub, () => { chunkCalls++; return true; }, {authorizeArtifact: () => { artifactCalls++; return true; }});
      harness.peer.pc.ondatachannel({channel: harness.channel});
      artifactHeader(harness.channel, 16001);
      harness.channel.onmessage({data: fragment(ARTIFACT_INDEX, 0, 16000)});
      harness.channel.onmessage({data: JSON.stringify(message)});
      assert.equal(artifactCalls, 1);
      assert.equal(chunkCalls, 0);
      assert.equal(harness.state.messages.length, 0);
      failedTransfer(harness);
    });
  }
});

test('artifact control and reserved binary index cannot enter an in-progress PCM chunk', async t => {
  for (const data of [JSON.stringify({type: 'artifact', bytes: 1}), fragment(ARTIFACT_INDEX, 0, 16000)]) {
    await t.test(typeof data === 'string' ? 'header' : 'reserved binary', sub => {
      let artifactCalls = 0;
      const harness = peerPlatform(sub, () => true, {authorizeArtifact: () => { artifactCalls++; return true; }});
      harness.peer.pc.ondatachannel({channel: harness.channel});
      harness.channel.onmessage({data: JSON.stringify({type: 'chunk', index: 0, bytes: 192000})});
      harness.channel.onmessage({data});
      assert.equal(artifactCalls, 0);
      failedTransfer(harness);
    });
  }
});

test('malformed/flooded final transport reports one failure and never delivers a partial artifact', async t => {
  for (const [label, data] of [['bad JSON', '{'], ['null control', 'null'], ['oversized control', ' '.repeat(24001)],
    ['unsolicited binary', fragment(ARTIFACT_INDEX, 0, 1)]]) await t.test(label, sub => {
    let authorizations = 0;
    const harness = peerPlatform(sub, () => false, {authorizeArtifact: () => { authorizations++; return true; }});
    harness.peer.pc.ondatachannel({channel: harness.channel});
    harness.channel.onmessage({data});
    for (let i = 0; i < 256; i++) artifactHeader(harness.channel, MAX_WAV);
    assert.equal(authorizations, 0);
    failedTransfer(harness);
  });
  await t.test('control-message budget checked before final artifact authorization', sub => {
    let authorizations = 0;
    const harness = peerPlatform(sub, () => false, {authorizeArtifact: () => { authorizations++; return true; }});
    harness.peer.pc.ondatachannel({channel: harness.channel});
    for (let i = 0; i < 128; i++) harness.channel.onmessage({data: JSON.stringify({type: 'status'})});
    assert.equal(harness.state.messages.length, 128);
    artifactHeader(harness.channel, MAX_WAV);
    assert.equal(authorizations, 0);
    failedTransfer(harness);
  });
});

test('final WAV sender rejects invalid sizes without writing transport data', async t => {
  const {peer, state, channel} = peerPlatform(t);
  peer.pc.ondatachannel({channel});
  for (const bytes of [new Uint8Array(), new Uint8Array(MAX_WAV + 1), new ArrayBuffer(1), [1]]) {
    await assert.rejects(peer.sendArtifact(bytes), /invalid final wav size/i);
  }
  assert.equal(state.sent.length, 0);
  assert.equal(peer.sending, false);
});

test('backpressured final transfer excludes concurrent binary sends and cancels before another packet', {timeout: 1000}, async t => {
  const {peer, state, channel} = peerPlatform(t);
  peer.pc.ondatachannel({channel});
  channel.bufferedAmount = 256001;
  const timers = new Map(); let sequence = 0;
  const restore = overrideGlobals({setTimeout: (fn, ms) => { const id = ++sequence; timers.set(id, {fn, ms}); return id; }, clearTimeout: id => timers.delete(id)});
  t.after(restore);
  const pending = peer.sendArtifact(new Uint8Array(16001));
  assert.equal(state.sent.length, 1, 'Only the authorized transfer header precedes backpressure');
  assert.equal(peer.sending, true);
  assert.equal([...timers.values()][0].ms, 1500);
  await assert.rejects(peer.sendArtifact(new Uint8Array(1)), /already pending/i);
  await assert.rejects(peer.sendChunk(0, new Uint8Array(192000)), /already pending/i);
  const rejected = assert.rejects(pending, /cancelled/i);
  peer.close(); channel.dispatchEvent(new Event('bufferedamountlow'));
  await rejected;
  assert.equal(state.sent.length, 1);
  assert.equal(peer.sending, false);
  assert.equal(timers.size, 0);
});

test('a duplicate chunk header during assembly fails before a second authorization', t => {
  let authorizations = 0;
  const {peer, state, channel} = peerPlatform(t, () => { authorizations++; return true; });
  peer.pc.ondatachannel({channel});
  const header = JSON.stringify({type: 'chunk', index: 0, bytes: 192000});
  channel.onmessage({data: header});
  channel.onmessage({data: header});
  assert.equal(authorizations, 1);
  assert.equal(peer.closed, true);
  assert.equal(state.chunks.length, 0);
  assert.equal(state.failures.length, 1);
});

test('a completed chunk awaiting application work cannot admit another chunk', t => {
  let authorizations = 0;
  const {peer, state, channel} = peerPlatform(t, () => ++authorizations === 1);
  peer.pc.ondatachannel({channel});
  const header = JSON.stringify({type: 'chunk', index: 0, bytes: 192000});
  channel.onmessage({data: header});
  for (let offset = 0; offset < 192000; offset += 16000) {
    const packet = new ArrayBuffer(16008), view = new DataView(packet);
    view.setUint32(0, 0, true); view.setUint32(4, offset, true);
    channel.onmessage({data: packet});
  }
  assert.equal(state.chunks.length, 1);
  assert.equal(state.chunks[0].bytes.length, 192000);
  // The production UI keeps authorization unavailable until hashing/receipt work
  // finishes. A hostile peer must not bypass that boundary with another header.
  channel.onmessage({data: header});
  for (let attempt = 0; attempt < 20; attempt++) channel.onmessage({data: header});
  assert.equal(authorizations, 2);
  assert.equal(peer.closed, true);
  assert.equal(state.chunks.length, 1);
  assert.equal(state.failures.length, 1);
  assert.match(state.failures[0].message, /excess|unexpected/i);
});
