// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requireLocationProfileReadiness} from '../../web/src/location-profile-readiness.js';

const browser = Object.freeze({profile:'software-browser', native:false});
const native = capabilities => ({profile:'native-android', native:true, capabilities});

test('native and raw profiles reject a browser before collection while the explicit browser profile remains available', () => {
  assert.equal(requireLocationProfileReadiness('browser-or-native', browser), browser);
  for (const profile of ['native-required', 'native-gnss', 'raw-gnss']) {
    assert.throws(() => requireLocationProfileReadiness(profile, browser), /Android native location collector/);
  }
});

test('raw profile requires an explicitly true API capability without reducing the selected profile', () => {
  for (const raw_gnss_api_available of [undefined, null, false, 0, 1, 'true']) {
    const platform = native({raw_gnss_api_available});
    assert.throws(() => requireLocationProfileReadiness('raw-gnss', platform), /Raw GNSS API availability was not confirmed/);
    assert.equal(platform.capabilities.raw_gnss_api_available, raw_gnss_api_available);
  }
  assert.throws(() => requireLocationProfileReadiness('raw-gnss', native()), /Raw GNSS API availability was not confirmed/);
});

test('ordinary native profiles do not inherit raw requirements and a confirmed raw API makes no receiver or permission claim', () => {
  const ordinary = native({raw_gnss_api_available:false});
  for (const profile of ['browser-or-native', 'native-required', 'native-gnss']) {
    assert.equal(requireLocationProfileReadiness(profile, ordinary), ordinary);
  }
  const raw = native({raw_gnss_api_available:true, raw_gnss_receiver_verified:false, fine_permission:false});
  const before = structuredClone(raw);
  assert.equal(requireLocationProfileReadiness('raw-gnss', raw), raw);
  assert.deepEqual(raw, before);
});

test('unknown profiles and unavailable platform descriptions fail instead of selecting a weaker default', () => {
  for (const profile of [undefined, null, '', 'metadata', 'raw', 'future-profile']) {
    assert.throws(() => requireLocationProfileReadiness(profile, browser), /supported location collection profile/);
  }
  for (const platform of [null, {}, {native:'true'}]) {
    assert.throws(() => requireLocationProfileReadiness('browser-or-native', platform), /capabilities are unavailable/);
  }
});

function replaceBridge(t, bridge) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'NativeLocation');
  Object.defineProperty(globalThis, 'NativeLocation', {value:bridge, configurable:true, writable:true});
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'NativeLocation', previous);
    else delete globalThis.NativeLocation;
  });
}

test('default platform path reads only capabilities and never starts a sensor or requests permission', t => {
  let reads = 0, sensorCalls = 0;
  const forbidden = () => { sensorCalls++; throw new Error('Sensor access is forbidden during capability preflight.'); };
  replaceBridge(t, {
    capabilities() { reads++; return JSON.stringify({available:true, version:1, key_fingerprint:'a'.repeat(64),
      raw_gnss_api_available:true, raw_gnss_receiver_verified:false, fine_permission:false}); },
    begin:forbidden, status:forbidden, selectForCamera:forbidden, finalize:forbidden, cancel:forbidden,
    requestPermission:forbidden
  });
  const platform = requireLocationProfileReadiness('raw-gnss');
  assert.equal(platform.native, true);
  assert.equal(reads, 1);
  assert.equal(sensorCalls, 0);
  assert.equal(platform.capabilities.fine_permission, false);
  assert.equal(platform.capabilities.raw_gnss_receiver_verified, false);
});

test('a present but unavailable native bridge never falls back even for the explicit browser-capable profile', t => {
  replaceBridge(t, {capabilities:() => JSON.stringify({available:false, error:'Synthetic native failure'})});
  for (const profile of ['browser-or-native', 'native-required', 'native-gnss', 'raw-gnss']) {
    assert.throws(() => requireLocationProfileReadiness(profile), /Native location collection is unavailable/);
  }
});
