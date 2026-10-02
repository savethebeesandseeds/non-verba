// SPDX-License-Identifier: AGPL-3.0-only
// Tests the browser/native transport boundary, not a physical Camera2 sensor.
import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeCameraPlatform, collectNativeCamera} from '../../web/src/camera-platform.js';

const PIN = 'a'.repeat(64), ID = 'native-session';
function install(t, options = {}) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'NativeCamera');
  const calls = [], states = [...(options.states || ['awaiting-location', 'complete'])];
  const bridge = {
    capabilities: () => JSON.stringify({available: true, version: 1, key_fingerprint: PIN}),
    begin: (...args) => { calls.push(['begin', ...args]); return JSON.stringify({session_id: ID}); },
    status: id => JSON.stringify({ok: true, session_id: id, key_fingerprint: PIN,
      state: states.shift() || 'preview', result: {fingerprint: PIN, media_origin: 'native-camera2-jpeg', image_base64: '/9j/2Q=='}, ...options.status}),
    capture: (...args) => { calls.push(['capture', ...args]); return JSON.stringify({session_id: ID}); },
    cancel: id => { calls.push(['cancel', id]); }
  };
  Object.assign(bridge, options.bridge);
  Object.defineProperty(globalThis, 'NativeCamera', {value: bridge, configurable: true});
  t.after(() => original ? Object.defineProperty(globalThis, 'NativeCamera', original) : delete globalThis.NativeCamera);
  return {calls, bridge, platform: () => nativeCameraPlatform()};
}
const challenge = {id: 'challenge'}, locationRequest = {policy: 'original'}, location = {latitude: 47, longitude: 19};
function collect(platform, extra = {}) {
  return collectNativeCamera({platform, challenge, locationRequest, acquireLocation: async () => location, ...extra});
}

test('native transport sends the original request and GPS only; image comes from native result', async t => {
  const p = install(t); let acquisitions = 0;
  const result = await collect(p.platform(), {acquireLocation: async () => { acquisitions++; return location; }});
  assert.equal(acquisitions, 1); assert.equal(result.fingerprint, PIN);
  assert.deepEqual([...result.bytes], [255, 216, 255, 217]);
  assert.deepEqual(p.calls, [['begin', JSON.stringify(challenge), JSON.stringify(locationRequest)], ['capture', ID, JSON.stringify(location)]]);
});

test('a present but incomplete or unavailable bridge cannot fall back to browser capture', t => {
  const p = install(t, {bridge: {capture: undefined}});
  assert.throws(p.platform, /incomplete/);
  p.bridge.capture = () => '{}'; p.bridge.capabilities = () => JSON.stringify({available: false});
  assert.throws(p.platform, /unavailable/);
});

for (const [name, status] of [['session', {session_id: 'replacement'}], ['key', {key_fingerprint: 'b'.repeat(64)}]]) {
  test(`native ${name} replacement cancels before GPS or capture`, async t => {
    const p = install(t, {status}); let acquisitions = 0;
    await assert.rejects(collect(p.platform(), {acquireLocation: async () => { acquisitions++; return location; }}), /identity changed/);
    assert.equal(acquisitions, 0); assert.deepEqual(p.calls.at(-1), ['cancel', ID]);
  });
}

test('completion before location submission is rejected', async t => {
  const p = install(t, {states: ['complete']});
  await assert.rejects(collect(p.platform()), /unexpected capture result/);
  assert.deepEqual(p.calls.at(-1), ['cancel', ID]);
});

test('duplicate shutter transitions cannot submit GPS twice', async t => {
  const p = install(t, {states: ['awaiting-location', 'awaiting-location']});
  await assert.rejects(collect(p.platform()), /duplicate location/);
  assert.equal(p.calls.filter(([name]) => name === 'capture').length, 1);
  assert.deepEqual(p.calls.at(-1), ['cancel', ID]);
});

test('abort during GPS acquisition never submits a late location', async t => {
  const p = install(t), controller = new AbortController(); let completeLocation;
  const work = collect(p.platform(), {signal: controller.signal, acquireLocation: () => new Promise(resolve => { completeLocation = resolve; })});
  const rejected = assert.rejects(work, {name: 'AbortError'});
  controller.abort(); completeLocation(location); await rejected;
  assert.equal(p.calls.filter(([name]) => name === 'capture').length, 0);
  assert.ok(p.calls.some(([name]) => name === 'cancel'));
});

test('native failure after shutter returns no artifact', async t => {
  const p = install(t, {states: ['awaiting-location', 'error']});
  await assert.rejects(collect(p.platform()), /stopped/);
  assert.deepEqual(p.calls.at(-1), ['cancel', ID]);
});

test('noncanonical image encoding is rejected before returning bytes', async t => {
  const p = install(t, {status: {result: {fingerprint: PIN, media_origin: 'native-camera2-jpeg', image_base64: '/9j/2Q==\n'}}});
  await assert.rejects(collect(p.platform()), /encoding/i);
  assert.deepEqual(p.calls.at(-1), ['cancel', ID]);
});

// Deterministic transport clock; native phase enforcement is tested separately.
function transportClock(t) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  let elapsed = 0;
  Object.defineProperty(globalThis, 'performance', {configurable: true, value: {now: () => elapsed}});
  t.after(() => Object.defineProperty(globalThis, 'performance', original));
  return value => { elapsed = value; };
}
test('a native timeout during GPS is preserved when submitting the selected fix', async t => {
  const p = install(t, {bridge: {capture: () => JSON.stringify({ok: false, error: 'Native camera acquisition timed out'})}});
  await assert.rejects(collect(p.platform()), /acquisition timed out/);
  assert.deepEqual(p.calls.at(-1), ['cancel', ID]);
});
