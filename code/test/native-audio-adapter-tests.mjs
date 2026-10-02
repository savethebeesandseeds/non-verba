// SPDX-License-Identifier: AGPL-3.0-only
// Native transport state tests with synthetic bytes. Hardware/DSP are separate checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeAudioPlatform, NativeAudioCapture} from '../../web/src/audio-platform.js';
const PIN = 'a'.repeat(64), ID = 'native-audio';
const request = {session_id: 'b'.repeat(64), duration_secs: 4};
const round = index => ({session_id: request.session_id, index, nonce: String(index + 1).repeat(64), type: 'round'});
function setup(t, extra = {}) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'NativeAudio');
  const calls = [], rounds = [], failures = []; let state = 'ready';
  const bridge = {
    capabilities: () => JSON.stringify({available: true, version: 1, key_fingerprint: PIN}),
    begin: text => { calls.push(['begin', JSON.parse(text)]); return JSON.stringify({session_id: ID}); },
    status: () => JSON.stringify({ok: true, session_id: ID, key_fingerprint: PIN, state, pilot_verified: true,
      result: {fingerprint: PIN, media_origin: 'native-aaudio-pcm', wav_base64: 'AQIDBA=='}, ...extra.status}),
    round: (id, text) => { calls.push(['round', id, JSON.parse(text)]); rounds.push(JSON.parse(text)); state = 'recording'; return JSON.stringify({session_id: ID}); },
    chunk: (id, index) => JSON.stringify({session_id: id, index, pending: index >= rounds.length,
      pcm_base64: Buffer.alloc(192000).toString('base64'), pcm_sha256: 'c'.repeat(64), sample_count: 96000, ...extra.chunk}),
    finalize: (id, text) => { calls.push(['finalize', id, JSON.parse(text)]); state = 'complete'; return JSON.stringify({session_id: ID}); },
    cancel: id => { calls.push(['cancel', id]); }
  };
  Object.assign(bridge, extra.bridge);
  Object.defineProperty(globalThis, 'NativeAudio', {value: bridge, configurable: true});
  let capture;
  t.after(() => { capture?.close(); original ? Object.defineProperty(globalThis, 'NativeAudio', original) : delete globalThis.NativeAudio; });
  return {calls, failures, bridge, create() { capture = new NativeAudioCapture(nativeAudioPlatform(), request, error => failures.push(error)); return capture; }};
}

test('native microphone exports owned PCM and takes only challenges and a final receipt', async t => {
  const p = setup(t), capture = p.create(); await capture.open();
  let completed;
  const complete = new Promise(resolve => { completed = resolve; });
  capture.round(round(0), async (index, bytes) => {
    assert.equal(bytes.length, 192000);
    if (index === 0) capture.round(round(1)); else completed();
  });
  await complete;
  const receipt = {type: 'nonverba-audio-receipt', request, transcript: {rounds: [0, 1]}};
  assert.deepEqual([...await capture.finalize(receipt)], [1, 2, 3, 4]);
  assert.equal(p.failures.length, 0);
  assert.deepEqual(p.calls.filter(([name]) => name === 'round').map(call => call[2]), [0, 1].map(index => { const {type, ...value} = round(index); return value; }));
  assert.deepEqual(p.calls.at(-1), ['finalize', ID, receipt]);
  assert.equal(typeof capture.play, 'undefined');
});

test('native microphone bridge cannot silently fall back when unavailable', t => {
  setup(t, {bridge: {capabilities: () => JSON.stringify({available: false, version: 1, key_fingerprint: PIN})}});
  assert.throws(nativeAudioPlatform, /requires a supported Android/);
  assert.equal(nativeAudioPlatform(false).fingerprint, PIN, 'requester and verification roles still obtain the public identity');
});

for (const [label, status, message] of [
  ['failed pilot', {pilot_verified: false}, /test did not pass/],
  ['changed key', {key_fingerprint: 'd'.repeat(64)}, /identity changed/],
  ['changed session', {session_id: 'other'}, /identity changed/]
]) {
  test(`${label} prevents arming and closes the native session`, async t => {
    const p = setup(t, {status}), capture = p.create();
    await assert.rejects(capture.open(), message);
    assert.deepEqual(p.calls.at(-1), ['cancel', ID]);
  });
}

test('out-of-order challenges and premature finalization are rejected', async t => {
  const p = setup(t), capture = p.create(); await capture.open();
  assert.throws(() => capture.round(round(1)), /unexpected challenge/);
  await assert.rejects(capture.finalize({}), /incomplete/);
  assert.equal(p.calls.length, 1);
});

test('incomplete native PCM causes failure without handing bytes to the requester', async t => {
  const p = setup(t, {chunk: {pcm_base64: 'AQIDBA=='}}), capture = p.create(); await capture.open();
  let sent = 0; capture.round(round(0), () => { sent++; });
  await capture.polling;
  assert.equal(sent, 0); assert.equal(p.failures.length, 1);
  assert.match(p.failures[0].message, /Incomplete/);
  assert.deepEqual(p.calls.at(-1), ['cancel', ID]);
});

test('closing during native permission setup cancels pending work', async t => {
  const p = setup(t, {status: {state: 'requesting-permission'}}), capture = p.create();
  const work = capture.open(); const rejected = assert.rejects(work, {name: 'AbortError'});
  capture.close(); await rejected;
  assert.equal(p.calls.filter(([name]) => name === 'cancel').length, 1);
  assert.throws(() => capture.round(round(0)), {name: 'AbortError'});
});
