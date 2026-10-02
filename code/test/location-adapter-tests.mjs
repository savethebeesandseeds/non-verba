// SPDX-License-Identifier: AGPL-3.0-only
// Platform-boundary regressions. Fake clocks/providers test state transitions;
// real Rust/WASM signature and policy checks run in location-browser-tests.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {beginLocationCollection, finalizeLocationProof, startConcurrentLocationCollection} from '../../web/src/location-capture.js';
import {locationPlatform, locationProofEnvelope, readLocationProofEnvelope, rawGnssDiagnosticSummary, satelliteStatusDiagnosticSummary, rawGnssFieldDiagnosticSummary} from '../../web/src/location-platform.js';
import {locationPolicy, locationTimingSummary, locationSealingSummary} from '../../web/src/location-policy.js';
import {createCameraRequest} from '../../web/src/camera-location.js';

const BASE = 1800000000000;
const request = {version: 1, type: 'nonverba-location-request', challenge: {id: 'a'.repeat(64), issued_at: BASE / 1000, expires_at: BASE / 1000 + 900},
  policy: {profile: 'browser-or-native', required_provider: 'any', duration_ms: 10000, min_samples: 3, max_accuracy_m: 100,
    max_fix_age_ms: 5000, max_delivery_delay_ms: 3000, max_speed_mps: 100}, context: null};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function platform(t, native) {
  let tick = 0, nextTimer = 0;
  const timers = new Map(), state = {watch: null, polling: [], clears: 0, calls: [], traces: [], signs: 0};
  const geo = {
    watchPosition(success, failure, options) { state.watch = {success, failure, options}; return 17; },
    clearWatch(id) { assert.equal(id, 17); state.clears++; },
    getCurrentPosition(success, failure, options) { state.polling.push({success, failure, options}); }
  };
  const replacements = {navigator: {geolocation: geo}, performance: {now: () => tick}, NativeLocation: native,
    setTimeout: (callback, ms) => { const id = ++nextTimer; timers.set(id, {callback, ms, interval: false}); return id; },
    setInterval: (callback, ms) => { const id = ++nextTimer; timers.set(id, {callback, ms, interval: true}); return id; },
    clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id)};
  const originals = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
  const realNow = Date.now; Date.now = () => BASE + tick;
  t.after(() => { Date.now = realNow; for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; });
  const engine = {
    async json(name, value) {
      state.calls.push(name);
      if (name === 'validate_location_request') return JSON.parse(value);
      if (name === 'validate_location_trace') { const trace = JSON.parse(value); state.traces.push(trace); return trace; }
      if (name === 'location_asset') return {kind: 'image/jpeg', sha256: 'f'.repeat(64)};
      throw new Error(`Unexpected JSON method: ${name}`);
    },
    async call(name) { assert.equal(name, 'seal_location_proof'); state.signs++; return new Uint8Array([0xd2, 1, 2]); }
  };
  function emit(at, extra = {}) {
    tick = at;
    state.watch.success({timestamp: BASE + at, coords: {latitude: 47.4979, longitude: 19.0402, accuracy: 10, altitude: null, altitudeAccuracy: null, ...extra.coords}, ...extra});
  }
  function fire(ms, interval = false) {
    const timer = [...timers.values()].find(value => value.ms === ms && value.interval === interval);
    assert.ok(timer, `Missing ${ms} ms timer`); timer.callback();
  }
  return {state, engine, emit, fire, timers, setTime: value => { tick = value; }};
}

test('stationary fresh measurements form a window and finalize once', async t => {
  const p = platform(t), work = beginLocationCollection({engine: p.engine, request}); await flush();
  assert.deepEqual(p.state.watch.options, {enableHighAccuracy: true, maximumAge: 0, timeout: 15000});
  p.emit(0); p.emit(5000); p.emit(10000); const collection = await work;
  assert.equal(p.state.clears, 1); assert.equal(collection.selected.latitude, 47.4979); assert.ok(Object.isFrozen(collection.selected));
  assert.equal(p.state.traces[0].samples.length, 3); assert.equal(p.state.traces[0].uncertainty_semantics, 'w3c-95-percent');
  assert.ok(p.state.traces[0].samples.every(sample => sample.mock === null && sample.fix_elapsed_ms === null));
  const proof = await finalizeLocationProof({engine: p.engine, collection, identity: '{}'});
  assert.deepEqual([...proof], [0xd2, 1, 2]); assert.equal(p.state.signs, 1);
  await assert.rejects(finalizeLocationProof({engine: p.engine, collection, identity: '{}'}), /already finalized/);
  assert.equal(p.timers.size, 0);
});

test('duplicate, stale and inaccurate fixes cannot create a proof', async t => {
  const p = platform(t), controller = new AbortController();
  const work = beginLocationCollection({engine: p.engine, request, signal: controller.signal}); const rejected = assert.rejects(work, /cancelled/); await flush();
  p.emit(0); p.emit(5000, {timestamp: BASE}); p.emit(7000, {coords: {latitude: 47, longitude: 19, accuracy: 1000}}); p.emit(10000, {timestamp: BASE + 1000});
  assert.equal(p.state.traces.length, 0); assert.equal(p.state.signs, 0);
  controller.abort(); await rejected; assert.equal(p.state.clears, 1); assert.equal(p.timers.size, 0);
});

test('polling requests fresh stationary fixes with at most one provider call pending', async t => {
  const p = platform(t), controller = new AbortController();
  const work = beginLocationCollection({engine: p.engine, request, signal: controller.signal}); const rejected = assert.rejects(work, /cancelled/); await flush();
  p.fire(1000, true); p.fire(1000, true); assert.equal(p.state.polling.length, 1);
  p.setTime(1000); p.state.polling[0].success({timestamp: BASE + 1000, coords: {latitude: 47, longitude: 19, accuracy: 10}});
  p.fire(1000, true); assert.equal(p.state.polling.length, 2); assert.equal(p.state.polling[1].options.maximumAge, 0);
  controller.abort(); await rejected;
  p.state.polling[1].success({timestamp: BASE + 12000, coords: {latitude: 47, longitude: 19, accuracy: 10}});
  assert.equal(p.state.traces.length, 0); assert.equal(p.state.signs, 0);
});

test('permission denial clears watchers and does not sign', async t => {
  const p = platform(t), work = beginLocationCollection({engine: p.engine, request}); const rejected = assert.rejects(work, /permission was denied/); await flush();
  p.state.watch.failure({code: 1}); await rejected; assert.equal(p.state.clears, 1); assert.equal(p.state.signs, 0); assert.equal(p.timers.size, 0);
});

for (const [code, message] of [[2, /provider is unavailable/], [3, /provider timed out/]]) {
  test(`provider error ${code} clears watchers and does not sign`, async t => {
    const p = platform(t), work = beginLocationCollection({engine: p.engine, request});
    const rejected = assert.rejects(work, message); await flush();
    p.emit(0); p.state.watch.failure({code, message: ''}); await rejected;
    assert.equal(p.state.clears, 1); assert.equal(p.state.signs, 0); assert.equal(p.timers.size, 0);
  });
}

test('bounded collection fails without enough distinct measurements', async t => {
  const p = platform(t), work = beginLocationCollection({engine: p.engine, request}); const rejected = assert.rejects(work, /complete location window/); await flush();
  p.emit(0); p.fire(60000); await rejected; assert.equal(p.state.clears, 1); assert.equal(p.state.signs, 0);
});

test('aborting a prepared window prevents media hashing and signing', async t => {
  const p = platform(t), controller = new AbortController();
  const work = beginLocationCollection({engine: p.engine, request, signal: controller.signal}); await flush(); p.emit(0); p.emit(5000); p.emit(10000);
  const collection = await work; controller.abort();
  await assert.rejects(finalizeLocationProof({engine: p.engine, collection, identity: '{}', mediaBytes: new Uint8Array([1])}), /cancelled/);
  assert.ok(!p.state.calls.includes('location_asset')); assert.equal(p.state.signs, 0);
});

test('cancellation during Rust request validation never opens the provider', async t => {
  const p = platform(t), controller = new AbortController(); let resolveValidation;
  p.engine.json = () => new Promise(resolve => { resolveValidation = resolve; });
  const work = beginLocationCollection({engine: p.engine, request, signal: controller.signal});
  controller.abort(); await assert.rejects(work, /cancelled/);
  resolveValidation(request); await flush(); assert.equal(p.state.watch, null); assert.equal(p.state.signs, 0);
});

test('native-required requests never open browser geolocation', async t => {
  const p = platform(t);
  await assert.rejects(beginLocationCollection({engine: p.engine, request: {...request, policy: {...request.policy, profile: 'native-required'}}}), /requires native Android/);
  assert.equal(p.state.watch, null); assert.equal(p.state.signs, 0);
});

test('raw GNSS never opens browser geolocation, even if a caller weakens the outer profile', async t => {
  const p = platform(t);
  const policy = {...request.policy, raw_gnss: locationPolicy('raw-gnss').raw_gnss};
  await assert.rejects(beginLocationCollection({engine: p.engine, request: {...request, policy}}), /requires native Android/);
  assert.equal(p.state.watch, null); assert.equal(p.state.signs, 0);
});

test('camera raw GNSS composition carries the same mandatory standalone policy', async () => {
  let requested;
  const engine = {async json(method, ...args) {
    if (method === 'create_location_request') {
      requested = JSON.parse(args[4]);
      return {...request, policy: requested};
    }
    assert.equal(method, 'validate_location_request');
    return JSON.parse(args[0]);
  }};
  const combined = await createCameraRequest(engine, 'requester', 'task', BASE / 1000, 900, 'raw');
  assert.deepEqual(requested, locationPolicy('raw-gnss'));
  assert.equal(combined.location_request.policy.profile, 'native-required');
  assert.equal(combined.location_request.policy.required_provider, 'gnss');
  assert.equal(combined.location_request.context.purpose, 'camera');
  assert.equal(combined.location_request.context.session_id, request.challenge.id);
  assert.equal(locationPolicy().raw_gnss, undefined);
});

test('a failed native bridge never falls back to the browser', async t => {
  const p = platform(t, {capabilities: () => JSON.stringify({available: false, version: 1})});
  assert.throws(locationPlatform, /unavailable/);
  await assert.rejects(beginLocationCollection({engine: p.engine, request}), /unavailable/);
  assert.equal(p.state.watch, null);
});

test('native finalization accepts only its opaque prepared session and exact media bytes', async t => {
  let nativeState = 'ready', finalized = null, cancelled = 0;
  const selected = {latitude: 47, longitude: 19, accuracy_m: 10, altitude_m: null, altitude_accuracy_m: null, timestamp_ms: BASE + 10000, source: 'device-geolocation'};
  const native = {capabilities: () => JSON.stringify({available: true, version: 1, key_fingerprint: 'c'.repeat(64)}),
    begin: () => JSON.stringify({ok: true, session_id: 'native-session', state: 'collecting'}),
    status: () => JSON.stringify({ok: true, session_id: 'native-session', state: nativeState, selected, result: {proof_base64: '0gEC'}}),
    finalize: (session, bytes) => { finalized = {session, bytes}; nativeState = 'complete'; return JSON.stringify({ok: true, state: 'finalizing'}); },
    cancel: () => { cancelled++; return JSON.stringify({ok: true}); }};
  const p = platform(t, native), collection = await beginLocationCollection({engine: p.engine, request});
  assert.equal(p.state.watch, null); assert.equal(collection.profile, 'native-android');
  const proof = await finalizeLocationProof({engine: p.engine, collection, mediaBytes: new Uint8Array([0xff, 0xd8, 0xff])});
  assert.equal(finalized.session, 'native-session'); assert.equal(finalized.bytes, '/9j/'); assert.deepEqual([...proof], [0xd2, 1, 2]);
  assert.equal(p.state.signs, 0); assert.equal(cancelled, 0);
});

test('a prepared native window remains cancellable while the camera signs its JPEG', async t => {
  let cancelled = 0;
  const native = {capabilities: () => JSON.stringify({available: true, version: 1, key_fingerprint: 'c'.repeat(64)}),
    begin: () => JSON.stringify({ok: true, session_id: 'native-session', state: 'collecting'}),
    status: () => JSON.stringify({ok: true, session_id: 'native-session', state: 'ready', selected: {latitude: 47, longitude: 19}}),
    cancel: () => { cancelled++; return JSON.stringify({ok: true}); }};
  const p = platform(t, native), controller = new AbortController();
  const collection = await beginLocationCollection({engine: p.engine, request, signal: controller.signal});
  controller.abort(); assert.equal(cancelled, 1);
  await assert.rejects(finalizeLocationProof({engine: p.engine, collection, mediaBytes: new Uint8Array([1])}), /cancelled/);
  assert.equal(p.state.signs, 0);
});

test('proof envelope roundtrip rejects malformed and noncanonical base64', () => {
  const bytes = new Uint8Array([0xd2, 0x84, 0x01]);
  assert.deepEqual(readLocationProofEnvelope(JSON.stringify(locationProofEnvelope(bytes))), bytes);
  assert.throws(() => readLocationProofEnvelope(JSON.stringify({version: 1, type: 'nonverba-location-proof', proof_base64: 'YQ='})), /encoding/);
  assert.throws(() => readLocationProofEnvelope(JSON.stringify({version: 1, type: 'nonverba-location-proof', proof_base64: 'YR=='})), /Noncanonical/);
});


// Native diagnostics are unsigned UI hints, not evidence or an alternative
// validation path. Fixtures include deliberately private/extraneous fields.
function diagnosticBridge(snapshot, events = []) {
  return {
    capabilities: () => JSON.stringify({available: true, version: 1, key_fingerprint: 'c'.repeat(64)}),
    begin: () => JSON.stringify({ok: true, session_id: 'diagnostic-session', state: 'collecting'}),
    status: () => JSON.stringify({session_id: 'diagnostic-session', ...snapshot}),
    cancel: () => { events.push('cancel'); return JSON.stringify({ok: true}); }
  };
}

for (const state of ['error', 'cancelled']) {
  test(`native ${state} delivers bounded unsigned diagnostics before rejection and cleanup`, async t => {
    const events = [], updates = [];
    const native = diagnosticBridge({ok: false, state, error: 'Native acquisition stopped.',
      selected_provider: 'gps', failure_stage: 'collecting', elapsed_ms: 60000, span_ms: 1200,
      eligible_samples: 2, rejected_samples: 7, raw_gnss_epochs: 3, raw_gnss_rejected_epochs: 4,
      raw_gnss_checks: {ready: false, error_codes: ['RAW_GNSS_COVERAGE', 'RAW_GNSS_COVERAGE', 'private-value'],
        location: {latitude: 47}, key_fingerprint: 'private-key'},
      selected: {latitude: 47, longitude: 19}, key_fingerprint: 'private-key',
      trace: {samples: [{latitude: 47}]}, result: {proof_base64: 'private-proof'}}, events);
    const p = platform(t, native);
    await assert.rejects(beginLocationCollection({engine: p.engine, request, onProgress(value) {
      updates.push(value); events.push(value.state);
    }}), /Native acquisition stopped/);
    assert.ok(events.indexOf(state) < events.indexOf('cancel'));
    assert.deepEqual(updates.at(-1), {source: 'native-android', unsigned: true, state,
      elapsed_ms: 60000, span_ms: 1200, sample_count: 2, rejected_samples: 7,
      selected_provider: 'gps', failure_stage: 'collecting',
      raw_gnss: {epoch_count: 3, rejected_epoch_count: 4, evaluated_epoch_count: null, min_qualifying_satellites: null, collection_action: null, ready: false, error_codes: ['RAW_GNSS_COVERAGE']}});
    assert.doesNotMatch(JSON.stringify(updates), /private|latitude|longitude|proof_base64|key_fingerprint/);
    assert.equal(p.state.watch, null); assert.equal(p.state.signs, 0);
  });
}

test('native elapsed waiting time never supplies missing or zero observation coverage', async t => {
  const updates = [];
  let snapshot = {ok: false, state: 'error', error: 'Timed out', elapsed_ms: 60000,
    eligible_samples: 0, rejected_samples: 0, selected_provider: 'gps', failure_stage: 'collecting'};
  const native = diagnosticBridge(snapshot);
  native.status = () => JSON.stringify({session_id: 'diagnostic-session', ...snapshot});
  const p = platform(t, native);
  await assert.rejects(beginLocationCollection({engine: p.engine, request, onProgress: value => updates.push(value)}), /Timed out/);
  assert.equal(updates.at(-1).span_ms, null); assert.equal(updates.at(-1).elapsed_ms, 60000);
  snapshot = {...snapshot, span_ms: 0};
  await assert.rejects(beginLocationCollection({engine: p.engine, request, onProgress: value => updates.push(value)}), /Timed out/);
  assert.equal(updates.at(-1).span_ms, 0);
});

test('malformed native diagnostics cannot leak arbitrary text or expand the UI subset', async t => {
  const updates = [];
  const native = diagnosticBridge({ok: false, state: 'error', error: 'Stopped',
    elapsed_ms: Number.MAX_SAFE_INTEGER + 1, span_ms: -1, eligible_samples: 129,
    rejected_samples: 'private-count', selected_provider: 'private-provider', failure_stage: 'private-stage',
    raw_gnss_epochs: 65, raw_gnss_rejected_epochs: -1, raw_gnss_checks: {ready: 'true', epoch_count: 65, min_qualifying_satellites: 129, collection_action: 'private-action',
      error_codes: Array.from({length: 1000}, () => 'RAW_GNSS_COVERAGE')}});
  const p = platform(t, native);
  await assert.rejects(beginLocationCollection({engine: p.engine, request, onProgress: value => updates.push(value)}), /Stopped/);
  const last = updates.at(-1);
  for (const key of ['elapsed_ms', 'span_ms', 'sample_count', 'rejected_samples', 'selected_provider', 'failure_stage']) assert.equal(last[key], null);
  assert.deepEqual(last.raw_gnss, {epoch_count: null, rejected_epoch_count: null, evaluated_epoch_count: null, min_qualifying_satellites: null, collection_action: null, ready: null, error_codes: ['RAW_GNSS_COVERAGE']});
  assert.doesNotMatch(JSON.stringify(last), /private/);
});

test('a foreign native session cannot replace current acquisition diagnostics', async t => {
  const updates = [];
  const native = diagnosticBridge({ok: false, session_id: 'other-session', state: 'error', error: 'Other failure', span_ms: 1234});
  const p = platform(t, native);
  await assert.rejects(beginLocationCollection({engine: p.engine, request, onProgress: value => updates.push(value)}), /session changed/);
  assert.equal(updates.length, 1); // Only the accepted begin response was reported.
  assert.equal(updates[0].state, 'collecting'); assert.equal(updates[0].span_ms, null);
});

for (const immediate of [false, true]) {
  test(`native signing failure retains finalizing diagnostics (${immediate ? 'immediate' : 'polled'})`, async t => {
    const updates = [], events = [];
    let snapshot = {ok: true, state: 'ready', selected: {latitude: 47, longitude: 19},
      elapsed_ms: 15000, span_ms: 10000, eligible_samples: 3, rejected_samples: 1,
      selected_provider: 'gps', failure_stage: null};
    const native = diagnosticBridge(snapshot, events);
    native.status = () => JSON.stringify({session_id: 'diagnostic-session', ...snapshot});
    native.finalize = () => {
      snapshot = {...snapshot, ok: false, state: 'error', failure_stage: 'finalizing', error: 'Signing failed'};
      return JSON.stringify(immediate ? {session_id: 'diagnostic-session', ...snapshot} : {ok: true, state: 'finalizing'});
    };
    const p = platform(t, native);
    const collection = await beginLocationCollection({engine: p.engine, request, onProgress: value => updates.push(value)});
    assert.equal(updates.at(-1).state, 'ready'); assert.equal(updates.at(-1).span_ms, 10000);
    await assert.rejects(finalizeLocationProof({engine: p.engine, collection, onProgress(value) {
      updates.push(value); events.push('progress');
    }}), /Signing failed/);
    assert.equal(updates.at(-1).failure_stage, 'finalizing'); assert.equal(updates.at(-1).span_ms, 10000);
    assert.ok(events.indexOf('progress') < events.indexOf('cancel'));
    assert.equal(p.state.watch, null); assert.equal(p.state.signs, 0);
  });
}

test('a failing initial diagnostic callback cancels the native session it opened', async t => {
  const events = [];
  const native = diagnosticBridge({}, events);
  native.status = () => { throw new Error('A failed callback must not poll'); };
  const p = platform(t, native);
  await assert.rejects(beginLocationCollection({engine: p.engine, request,
    onProgress() { throw new Error('Diagnostic display failed'); }}), /Diagnostic display failed/);
  assert.ok(events.includes('cancel'));
  assert.equal(p.state.watch, null); assert.equal(p.state.signs, 0);
});

test('an immediate native begin failure retains its session diagnostics', async t => {
  const updates = [];
  const native = diagnosticBridge({});
  native.begin = () => JSON.stringify({ok: false, session_id: 'diagnostic-session', state: 'error',
    failure_stage: 'requesting-permission', error: 'Permission denied', elapsed_ms: 500, span_ms: 0,
    eligible_samples: 0, rejected_samples: 0, selected_provider: null});
  native.status = () => { throw new Error('A failed begin must not poll'); };
  const p = platform(t, native);
  await assert.rejects(beginLocationCollection({engine: p.engine, request, onProgress: value => updates.push(value)}), /Permission denied/);
  assert.equal(updates.length, 1); assert.equal(updates[0].failure_stage, 'requesting-permission');
  assert.equal(updates[0].selected_provider, null); assert.equal(updates[0].span_ms, 0);
  assert.equal(p.state.watch, null);
});


test('raw diagnostic registration and pre-filter callbacks survive a failed session without becoming evidence', async t => {
  const updates = [];
  const diagnostic = {unsigned: true, registration: 'registered', registration_api: 'androidx-compat-handler',
    receiver_status: null, receiver_status_code: null, callback_count: 0, last_callback_elapsed_ms: null,
    cadence_skipped: 0, warmup_reasons: {}, os_has_measurements: null, os_hardware_year: 2020, os_hardware_model: 'Receiver model'};
  const p = platform(t, diagnosticBridge({ok: false, state: 'error', error: 'Timed out',
    raw_gnss_epochs: 0, raw_gnss_rejected_epochs: 0, raw_gnss_diagnostics: diagnostic}));
  await assert.rejects(beginLocationCollection({engine: p.engine, request, onProgress: value => updates.push(value)}), /Timed out/);
  assert.deepEqual(updates.at(-1).raw_gnss.diagnostics, diagnostic);
  const summary = rawGnssDiagnosticSummary(diagnostic);
  assert.match(summary, /Registration registered via androidx-compat-handler; receiver status unobserved; raw callbacks 0/);
  assert.match(summary, /Unverified OS reports: measurement capability unknown/);
  assert.doesNotMatch(summary, /unsupported|no signal|authentic/);
  assert.equal(p.state.signs, 0); assert.equal(p.state.watch, null);
});

test('raw diagnostics preserve false capability and observed status, not inferred support from callback counts', async t => {
  const updates = [];
  const diagnostic = {unsigned: true, registration: 'registered', registration_api: 'api31-full-tracking',
    receiver_status: 'ready', receiver_status_code: 1, callback_count: 9, last_callback_elapsed_ms: 12000,
    cadence_skipped: 1, warmup_reasons: {'missing-full-bias': 2, 'missing-elapsed-uncertainty': 2, 'empty-signals': 1},
    os_has_measurements: false, os_hardware_year: 0, os_hardware_model: 'GNSS version 1'};
  const p = platform(t, diagnosticBridge({ok: false, state: 'error', error: 'Stopped', raw_gnss_diagnostics: diagnostic}));
  await assert.rejects(beginLocationCollection({engine: p.engine, request, onProgress: value => updates.push(value)}), /Stopped/);
  assert.deepEqual(updates.at(-1).raw_gnss.diagnostics, diagnostic);
  const summary = rawGnssDiagnosticSummary(diagnostic);
  assert.match(summary, /raw callbacks 9, last 12.0 s after start; cadence skips 1/);
  assert.match(summary, /Warmup reasons \(may overlap\)/);
  assert.match(summary, /measurement capability reported no; hardware year pre-2016\/unspecified/);
});

test('raw diagnostic sanitization bounds fields and admits only named warmup counters', async t => {
  const updates = [];
  const p = platform(t, diagnosticBridge({ok: false, state: 'error', error: 'Stopped', raw_gnss_diagnostics: {
    unsigned: true, registration: 'private-value', registration_api: 'private-value', receiver_status: 'private-value',
    receiver_status_code: 2147483648, callback_count: 1000001, last_callback_elapsed_ms: -1, cadence_skipped: '4',
    warmup_reasons: {'missing-full-bias': 2, 'empty-signals': 1000001, 'private-value': 3},
    os_has_measurements: 'true', os_hardware_year: 2015, os_hardware_model: 'private\nvalue',
    latitude: 47, trace: 'private-value'}}));
  await assert.rejects(beginLocationCollection({engine: p.engine, request, onProgress: value => updates.push(value)}), /Stopped/);
  const diagnostic = updates.at(-1).raw_gnss.diagnostics;
  assert.deepEqual(diagnostic, {unsigned: true, registration: null, registration_api: null,
    receiver_status: null, receiver_status_code: null, callback_count: null, last_callback_elapsed_ms: null,
    cadence_skipped: null, warmup_reasons: {'missing-full-bias': 2}, os_has_measurements: null,
    os_hardware_year: null, os_hardware_model: null});
  assert.doesNotMatch(JSON.stringify(updates), /private|latitude|trace/);
  assert.equal(rawGnssDiagnosticSummary({...diagnostic, unsigned: false}), '');
  assert.equal(rawGnssDiagnosticSummary(null), '');
});

function satelliteDiagnostic(overrides = {}) {
  return {unsigned: true, registration: 'registered', registration_api: 'androidx-compat-handler',
    active: false, callback_count: 3, last_callback_elapsed_ms: 8000, unreadable_callbacks: 0, cleanup_failed: false,
    satellite_count: 4, used_in_fix_count: 2, cn0_sample_count: 3, invalid_cn0_count: 1,
    cn0_min_dbhz: 10, cn0_mean_dbhz: 20, cn0_max_dbhz: 30, constellation_counts: {gps: 3, galileo: 1}, ...overrides};
}

test('satellite status is retained on raw failure, separate from the raw evidence counters', async t => {
  const updates = [], diagnostic = satelliteDiagnostic();
  const p = platform(t, diagnosticBridge({ok: false, state: 'error', error: 'Timed out', elapsed_ms: 10000,
    raw_gnss_epochs: 0, raw_gnss_rejected_epochs: 0, gnss_status_diagnostics: diagnostic}));
  await assert.rejects(beginLocationCollection({engine: p.engine, request, onProgress: value => updates.push(value)}), /Timed out/);
  assert.deepEqual(updates.at(-1).gnss_status, diagnostic);
  assert.equal(updates.at(-1).raw_gnss.epoch_count, 0);
  const summary = satelliteStatusDiagnosticSummary(diagnostic, updates.at(-1).elapsed_ms);
  assert.match(summary, /seen 4, used in latest fix 2/);
  assert.match(summary, /10.0\/20.0\/30.0 dB-Hz min\/mean\/max \(3 valid, 1 invalid\)/);
  assert.match(summary, /Received 2.0 s before snapshot; collection stopped/);
  assert.doesNotMatch(summary, /supported|no signal|authentic|proof valid/);
  assert.equal(p.state.signs, 0); assert.equal(p.state.watch, null);
});

test('optional status registration failure does not reject an otherwise ready native collection', async t => {
  const updates = [];
  const p = platform(t, diagnosticBridge({ok: true, state: 'ready', selected: {latitude: 47, longitude: 19},
    gnss_status_diagnostics: satelliteDiagnostic({registration: 'exception', callback_count: 0,
      last_callback_elapsed_ms: null, satellite_count: null, used_in_fix_count: null, cn0_sample_count: null,
      invalid_cn0_count: null, cn0_min_dbhz: null, cn0_mean_dbhz: null, cn0_max_dbhz: null, constellation_counts: {}})}));
  const collection = await beginLocationCollection({engine: p.engine, request, onProgress: value => updates.push(value)});
  assert.equal(collection.selected.latitude, 47);
  assert.equal(updates.at(-1).gnss_status.registration, 'exception');
  assert.equal(updates.at(-1).gnss_status.satellite_count, null);
  assert.equal(p.state.watch, null);
});

test('satellite fields require bounded coherent counts and cannot leak arbitrary metadata', async t => {
  const updates = [];
  const p = platform(t, diagnosticBridge({ok: false, state: 'error', error: 'Stopped', gnss_status_diagnostics: {
    ...satelliteDiagnostic(), registration: 'private-registration', registration_api: 'private-api', active: 'true',
    callback_count: 1000001, last_callback_elapsed_ms: Number.MAX_SAFE_INTEGER + 1, unreadable_callbacks: -1,
    cleanup_failed: 'true', satellite_count: 257, used_in_fix_count: 999, cn0_sample_count: -1,
    invalid_cn0_count: 257, cn0_min_dbhz: -1, cn0_mean_dbhz: 100, cn0_max_dbhz: 'private-number',
    constellation_counts: {'private-label': 1}, latitude: 47, trace: 'private-value'}}));
  await assert.rejects(beginLocationCollection({engine: p.engine, request, onProgress: value => updates.push(value)}), /Stopped/);
  assert.deepEqual(updates.at(-1).gnss_status, {unsigned: true, registration: null, registration_api: null, active: null,
    callback_count: null, last_callback_elapsed_ms: null, unreadable_callbacks: null, cleanup_failed: null,
    satellite_count: null, used_in_fix_count: null, cn0_sample_count: null, invalid_cn0_count: null,
    cn0_min_dbhz: null, cn0_mean_dbhz: null, cn0_max_dbhz: null, constellation_counts: {}});
  assert.doesNotMatch(JSON.stringify(updates), /private|latitude|trace/);
});

test('satellite summaries distinguish absent callbacks, observed zero satellites and malformed C/N0', () => {
  const absent = satelliteStatusDiagnosticSummary(satelliteDiagnostic({callback_count: 0}), 10000);
  assert.match(absent, /callbacks 0; seen unknown, used in latest fix unknown/);
  assert.match(absent, /Received unknown age/);
  const empty = satelliteStatusDiagnosticSummary(satelliteDiagnostic({satellite_count: 0, used_in_fix_count: 0,
    cn0_sample_count: 0, invalid_cn0_count: 0, cn0_min_dbhz: null, cn0_mean_dbhz: null,
    cn0_max_dbhz: null, constellation_counts: {}}), 10000);
  assert.match(empty, /seen 0, used in latest fix 0; C\/N0 unavailable \(0 valid, 0 invalid\)/);
  for (const changes of [{cn0_min_dbhz: 50}, {cn0_sample_count: 4}, {cn0_mean_dbhz: NaN}, {cn0_max_dbhz: Infinity}]) {
    assert.match(satelliteStatusDiagnosticSummary(satelliteDiagnostic(changes), 10000), /C\/N0 unavailable/);
  }
  assert.match(satelliteStatusDiagnosticSummary(satelliteDiagnostic(), 7999), /Received unknown age/);
  assert.doesNotMatch(satelliteStatusDiagnosticSummary(satelliteDiagnostic({constellation_counts: {gps: 4, galileo: 1}}), 10000), /gps 4/);
  assert.equal(satelliteStatusDiagnosticSummary(satelliteDiagnostic({unsigned: false}), 10000), '');
  assert.equal(satelliteStatusDiagnosticSummary(null, 10000), '');
});

test('satellite status summary fits the bounded phone diagnostic field', () => {
  const summary = satelliteStatusDiagnosticSummary(satelliteDiagnostic({registration: 'not-attempted', active: null,
    callback_count: 1000000, unreadable_callbacks: 1000000, cleanup_failed: true,
    satellite_count: 256, used_in_fix_count: 256, cn0_sample_count: 256, invalid_cn0_count: 0,
    cn0_min_dbhz: 63, cn0_mean_dbhz: 63, cn0_max_dbhz: 63,
    constellation_counts: {gps: 32, sbas: 32, glonass: 32, qzss: 32, beidou: 32, galileo: 32, irnss: 32, unknown: 32}}), Number.MAX_SAFE_INTEGER);
  assert.ok(summary.length <= 512, `Summary must remain readable without truncation (${summary.length})`);
});


test('raw field failures survive a terminal native snapshot without private values or signing', async t => {
  const updates = [], fields = [
    {field: 'clock.bias_uncertainty_ns', reason: 'policy-range', count: 1},
    {field: 'measurement.code_type', reason: 'invalid-code', count: 12}
  ];
  const native = diagnosticBridge({ok: false, state: 'error', error: 'Raw GNSS policy failed',
    raw_gnss_epochs: 1, raw_gnss_rejected_epochs: 0,
    raw_gnss_checks: {ready: false, error_codes: ['RAW_GNSS_CLOCK_FIELDS', 'RAW_GNSS_MEASUREMENT_FIELDS'],
      field_diagnostics: fields.map(field => ({...field, value: 'private-value', latitude: 47}))}});
  const p = platform(t, native);
  await assert.rejects(beginLocationCollection({engine: p.engine, request, onProgress: value => updates.push(value)}), /Raw GNSS policy failed/);
  assert.deepEqual(updates.at(-1).raw_gnss.field_diagnostics, fields);
  assert.equal(updates.at(-1).raw_gnss.ready, false);
  assert.equal(p.state.signs, 0);
  assert.doesNotMatch(JSON.stringify(updates), /private|latitude|longitude/);
  assert.match(rawGnssFieldDiagnosticSummary(fields, 'clock'), /bias_uncertainty_ns \(policy-range\) ×1/);
  assert.match(rawGnssFieldDiagnosticSummary(fields, 'measurement'), /code_type \(invalid-code\) ×12/);
});

test('raw field diagnostics only accept bounded known field and reason combinations', async t => {
  const updates = [], valid = {field: 'measurement.signal_identity', reason: 'duplicate-signal', count: 8192};
  const native = diagnosticBridge({ok: false, state: 'error', error: 'Stopped', raw_gnss_checks: {
    ready: false, field_diagnostics: [valid, {...valid, count: 2}, null, [],
      {field: 'private-latitude', reason: 'out-of-range', count: 1},
      {field: ['clock.time_ns'], reason: 'invalid-integer', count: 1},
      {field: 'clock.time_ns', reason: ['invalid-integer'], count: 1},
      {field: 'clock.time_ns', reason: 'private-reason', count: 1},
      {field: 'clock.time_ns', reason: 'out-of-range', count: 1},
      {field: 'clock.time_ns', reason: 'invalid-integer', count: 65},
      {field: 'clock.anchor_elapsed_realtime_ns', reason: 'invalid-integer', count: 2},
      {...valid, field: 'measurement.code_type', reason: 'invalid-code', count: 8193},
      {...valid, count: 0}, {...valid, count: -1}, {...valid, count: 1.5}, {...valid, count: '1'}]}});
  const p = platform(t, native);
  await assert.rejects(beginLocationCollection({engine: p.engine, request, onProgress: value => updates.push(value)}), /Stopped/);
  assert.deepEqual(updates.at(-1).raw_gnss.field_diagnostics, [valid]);
  assert.doesNotMatch(JSON.stringify(updates), /private|latitude/);
});

test('raw field summaries stay within the phone reader limit and declare omitted fields', () => {
  const fields = ['received_sv_time_ns', 'received_sv_time_uncertainty_ns', 'time_offset_ns',
    'cn0_dbhz', 'pseudorange_rate_mps', 'pseudorange_rate_uncertainty_mps', 'carrier_frequency_hz',
    'accumulated_delta_range_m', 'accumulated_delta_range_uncertainty_m', 'automatic_gain_control_db']
    .map(field => ({field: `measurement.${field}`, reason: 'out-of-range', count: 8192}));
  const summary = rawGnssFieldDiagnosticSummary(fields, 'measurement');
  assert.ok(summary.length <= 480, summary);
  assert.match(summary, /Unsigned raw measurement field notes/);
  assert.match(summary, /\+\d+ more fields$/);
  assert.equal(rawGnssFieldDiagnosticSummary(fields, 'private'), '');
  assert.equal(rawGnssFieldDiagnosticSummary(null, 'clock'), '');
  assert.equal(rawGnssFieldDiagnosticSummary(Array(49).fill(fields[0]), 'measurement'), '');
});

for (const checks of [null, true, 'invalid', []]) {
  test(`malformed raw checks cannot crash optional diagnostic rendering: ${JSON.stringify(checks)}`, async t => {
    const updates = [], p = platform(t, diagnosticBridge({ok: false, state: 'error', error: 'Stopped', raw_gnss_checks: checks}));
    await assert.rejects(beginLocationCollection({engine: p.engine, request, onProgress: value => updates.push(value)}), /Stopped/);
    assert.equal(updates.at(-1).raw_gnss.ready, null);
    assert.equal(updates.at(-1).raw_gnss.field_diagnostics, undefined);
    assert.equal(p.state.signs, 0);
  });
}


test('refined raw reasons retain multiple categories per field with legacy compatibility', async t => {
  const updates = [], fields = [
    ...['negative', 'nonfinite', 'above-policy', 'policy-range'].map(reason => ({field: 'clock.bias_uncertainty_ns', reason, count: 1})),
    ...['empty', 'overlong', 'invalid-characters', 'invalid-code'].map(reason => ({field: 'measurement.code_type', reason, count: 2}))
  ];
  const native = diagnosticBridge({ok: false, state: 'error', error: 'Stopped', raw_gnss_checks: {ready: false,
    field_diagnostics: [...fields, {...fields[0], count: 2},
      {field: 'clock.bias_uncertainty_ns', reason: 'empty', count: 1},
      {field: 'measurement.code_type', reason: 'above-policy', count: 1}]}});
  const p = platform(t, native);
  await assert.rejects(beginLocationCollection({engine: p.engine, request, onProgress: value => updates.push(value)}), /Stopped/);
  assert.deepEqual(updates.at(-1).raw_gnss.field_diagnostics, fields);
  const clock = rawGnssFieldDiagnosticSummary(fields, 'clock'), measurement = rawGnssFieldDiagnosticSummary(fields, 'measurement');
  for (const reason of ['negative', 'nonfinite', 'above-policy']) assert.ok(clock.includes(reason));
  for (const reason of ['empty', 'overlong', 'invalid-characters']) assert.ok(measurement.includes(reason));
  assert.ok(clock.length <= 480 && measurement.length <= 480);
});

test('new location presets expose separate signing allowance without changing freshness or provider delivery', () => {
  for (const profile of ['browser-or-native', 'native-required', 'native-gnss', 'raw-gnss']) {
    const policy = locationPolicy(profile);
    assert.equal(policy.max_finalization_delay_ms, 30000);
    assert.equal(policy.max_fix_age_ms, 5000); assert.equal(policy.max_delivery_delay_ms, 3000);
    assert.match(locationTimingSummary(policy), /sealing within 30 s after collection ends/);
  }
});
test('timing summaries distinguish explicit policy, legacy policy, and missing observations', () => {
  assert.match(locationTimingSummary({...locationPolicy(), max_finalization_delay_ms: 12500}), /sealing within 12.5 s/);
  assert.match(locationTimingSummary(request.policy), /last fix at most 5 s old when sealed/);
  assert.match(locationTimingSummary(undefined), /unknown/);
  assert.match(locationSealingSummary({trace: {ended_at_ms: BASE}, sealed_at_ms: BASE + 7400}), /7.40 s.*not requester arrival/);
  for (const evidence of [undefined, {}, {trace: {ended_at_ms: BASE}, sealed_at_ms: BASE - 1}, {trace: {ended_at_ms: BASE}, sealed_at_ms: null}]) {
    assert.match(locationSealingSummary(evidence), /seal entry: unknown/);
  }
});

const concurrentRequest=()=>({...structuredClone(request),context:{session_id:request.challenge.id,purpose:'camera',camera_timing:'concurrent'}});
test('concurrent browser exposes an early fix then retains later moving observations',async t=>{
  const p=platform(t),session=await startConcurrentLocationCollection({engine:p.engine,request:concurrentRequest()});
  p.emit(0);const selected=await session.selectForCamera();assert.equal(selected.timestamp_ms,BASE);
  let ready=false;session.ready.then(()=>{ready=true;});await flush();assert.equal(ready,false);assert.equal(p.state.clears,0);
  p.emit(5000,{coords:{latitude:47.49791,longitude:19.0402,accuracy:10,altitude:null,altitudeAccuracy:null}});p.emit(10000,{coords:{latitude:47.49792,longitude:19.0402,accuracy:10,altitude:null,altitudeAccuracy:null}});
  const collection=await session.ready;assert.equal(collection.selected.latitude,selected.latitude);
  assert.equal(p.state.traces[0].samples.at(-1).latitude,47.49792);assert.equal(p.state.clears,1);
  await finalizeLocationProof({engine:p.engine,collection,identity:'{}',mediaBytes:new Uint8Array([255,216,255,217])});session.cancel();
  assert.equal(p.state.signs,1);assert.equal(p.timers.size,0);
});
test('a completed GPS duration keeps updating while framing and freezes only after shutter selection',async t=>{
  const p=platform(t),session=await startConcurrentLocationCollection({engine:p.engine,request:concurrentRequest()});
  p.emit(0);p.emit(5000);p.emit(10000);await flush();assert.equal(p.state.clears,0);assert.equal(p.state.traces.length,0);
  p.emit(15000,{coords:{latitude:47.49791,longitude:19.0402,accuracy:10,altitude:null,altitudeAccuracy:null}});const selected=await session.selectForCamera();const collection=await session.ready;
  assert.equal(selected.timestamp_ms,BASE+15000);assert.equal(collection.selected.timestamp_ms,BASE+15000);
  await assert.rejects(session.selectForCamera(),/already selected/);session.cancel();
});
test('a stale preview fix waits for a new observation without waiting for a full window',async t=>{
  const p=platform(t),session=await startConcurrentLocationCollection({engine:p.engine,request:concurrentRequest()});
  p.emit(0);p.setTime(6000);let selected=false;const selection=session.selectForCamera().then(value=>{selected=true;return value;});await flush();assert.equal(selected,false);
  p.emit(6100);assert.equal((await selection).timestamp_ms,BASE+6100);assert.equal(p.state.traces.length,0);
  const rejected=assert.rejects(session.ready,/cancelled/);session.cancel();await rejected;assert.equal(p.state.signs,0);
});
test('cancelling before a first fix rejects both pending selection and remaining trace',async t=>{
  const p=platform(t),session=await startConcurrentLocationCollection({engine:p.engine,request:concurrentRequest()});
  const selection=assert.rejects(session.selectForCamera(),/cancelled/),ready=assert.rejects(session.ready,/cancelled/);session.cancel();await Promise.all([selection,ready]);assert.equal(p.state.clears,1);assert.equal(p.timers.size,0);
});

test('concurrent native bridge selects before ready and preserves the photo fix after later updates',async t=>{
  let state='collecting',last={latitude:47,longitude:19,accuracy_m:10,timestamp_ms:BASE+1000,source:'device-geolocation'},calls=0;
  const native={capabilities:()=>JSON.stringify({available:true,version:1,key_fingerprint:'c'.repeat(64)}),
    begin:()=>JSON.stringify({ok:true,session_id:'overlap',state}),status:()=>JSON.stringify({ok:true,session_id:'overlap',state,selected:last,result:{proof_base64:'0gEC'}}),
    selectForCamera:()=>{calls++;return JSON.stringify({ok:true,session_id:'overlap',state,selected:last,capture_selected:last});},
    cancel:()=>JSON.stringify({ok:true}),finalize:()=>{state='complete';return JSON.stringify({ok:true,session_id:'overlap',state:'finalizing'});}};
  const p=platform(t,native),session=await startConcurrentLocationCollection({engine:p.engine,request:concurrentRequest()});
  const selected=await session.selectForCamera();assert.equal(selected.timestamp_ms,BASE+1000);assert.equal(calls,1);
  last={...last,latitude:47.00001,timestamp_ms:BASE+11000};state='ready';p.fire(250);const collection=await session.ready;
  assert.equal(collection.selected.timestamp_ms,selected.timestamp_ms);assert.equal(p.state.watch,null);
  const proof=await finalizeLocationProof({engine:p.engine,collection,mediaBytes:new Uint8Array([255,216,255,217])});assert.deepEqual([...proof],[0xd2,1,2]);session.cancel();
});
test('native no-fix selection remains cancellable while collection is pending',async t=>{
  const native={capabilities:()=>JSON.stringify({available:true,version:1,key_fingerprint:'c'.repeat(64)}),
    begin:()=>JSON.stringify({ok:true,session_id:'pending',state:'collecting'}),status:()=>JSON.stringify({ok:true,session_id:'pending',state:'collecting'}),
    selectForCamera:()=>JSON.stringify({ok:false,retryable:true,session_id:'pending',error:'Waiting for a fix'}),cancel:()=>JSON.stringify({ok:true})};
  const p=platform(t,native),session=await startConcurrentLocationCollection({engine:p.engine,request:concurrentRequest()});
  const selected=assert.rejects(session.selectForCamera(),/cancelled/),ready=assert.rejects(session.ready,/cancelled/);session.cancel();await Promise.all([selected,ready]);assert.equal(p.state.signs,0);
});


test('unsigned uncertainty values and last-evaluated trace scope survive rejected startup without signing', async t => {
  const updates = [], field = {field: 'clock.elapsed_realtime_uncertainty_ns', reason: 'above-policy', count: 1,
    reported_max: 250000.5, requested_max: 100000};
  const original = JSON.stringify(request);
  const native = diagnosticBridge({ok: false, state: 'error', error: 'Stopped',
    raw_gnss_epochs: 0, raw_gnss_rejected_epochs: 57,
    raw_gnss_checks: {ready: false, epoch_count: 1, min_qualifying_satellites: 9, collection_action: 'discard-startup',
      error_codes: ['RAW_GNSS_CLOCK_FIELDS'], field_diagnostics: [{...field, latitude: 47, elapsed_realtime_ns: 'private-clock'}]}});
  const p = platform(t, native);
  await assert.rejects(beginLocationCollection({engine: p.engine, request, onProgress: value => updates.push(value)}), /Stopped/);
  const raw = updates.at(-1).raw_gnss;
  assert.equal(raw.epoch_count, 0); assert.equal(raw.evaluated_epoch_count, 1);
  assert.equal(raw.min_qualifying_satellites, 9); assert.equal(raw.collection_action, 'discard-startup');
  assert.equal(raw.ready, false); assert.equal(p.state.signs, 0); assert.equal(JSON.stringify(request), original);
  assert.deepEqual(raw.field_diagnostics, [field]);
  const summary = rawGnssFieldDiagnosticSummary(raw.field_diagnostics, 'clock');
  assert.match(summary, /Unsigned raw clock field notes/);
  assert.match(summary, /max 250000.5 ns, requested ≤100000 ns/);
  assert.doesNotMatch(JSON.stringify(updates), /private|latitude|elapsed_realtime_ns/);
});

test('uncertainty numeric projection rejects hostile values and fields instead of coercing or clipping', () => {
  const field = {field: 'clock.elapsed_realtime_uncertainty_ns', reason: 'above-policy', count: 1, reported_max: 250000, requested_max: 100000};
  for (const invalid of [NaN, Infinity, -Infinity, -1, Number.MAX_SAFE_INTEGER + 1, '250000', null, [], {}]) {
    const text = rawGnssFieldDiagnosticSummary([{...field, reported_max: invalid}], 'clock');
    assert.doesNotMatch(text, /; max /);
  }
  for (const invalid of [NaN, Infinity, -Infinity, -1, 0, 100000001, '100000', null, [], {}]) {
    assert.doesNotMatch(rawGnssFieldDiagnosticSummary([{...field, requested_max: invalid}], 'clock'), /; max /);
  }
  for (const [name, reason] of [['clock.time_ns', 'invalid-integer'], ['clock.bias_ns', 'out-of-range'],
    ['clock.drift_uncertainty_ns_per_second', 'out-of-range'], ['private-field', 'above-policy'],
    ['clock.elapsed_realtime_uncertainty_ns', 'negative']]) {
    assert.doesNotMatch(rawGnssFieldDiagnosticSummary([{...field, field: name, reason}], 'clock'), /; max /);
  }
  assert.doesNotMatch(rawGnssFieldDiagnosticSummary([{...field, reported_max: 100000}], 'clock'), /; max /);
  const aboveBoundary = rawGnssFieldDiagnosticSummary([{...field, reported_max: 100000.0001}], 'clock');
  assert.match(aboveBoundary, /max 100000\.0001 ns, requested ≤100000 ns/);
  const maximum = rawGnssFieldDiagnosticSummary([{...field, reported_max: Number.MAX_SAFE_INTEGER}], 'clock');
  assert.match(maximum, /max 9.007e\+15 ns/);
});

test('separate alignment diagnostics never raise the receiver clock diagnostic limit', () => {
  const field = {field: 'clock.elapsed_realtime_uncertainty_ns', reason: 'above-policy', count: 1,
    reported_max: 20000000, requested_max: 10000000};
  assert.match(rawGnssFieldDiagnosticSummary([field], 'clock'), /max 20000000 ns, requested ≤10000000 ns/);
  assert.match(rawGnssFieldDiagnosticSummary([{...field, reported_max:10000000.0001}], 'clock'), /max 10000000\.0001 ns, requested ≤10000000 ns/);
  for (const name of ['clock.bias_uncertainty_ns', 'clock.time_uncertainty_ns']) {
    assert.doesNotMatch(rawGnssFieldDiagnosticSummary([{...field, field:name}], 'clock'), /; max /);
  }
});

test('raw timing summaries describe explicit alignment policy without upgrading a legacy request', () => {
  const legacy = locationPolicy('raw-gnss');
  assert.equal(legacy.raw_gnss.max_elapsed_realtime_uncertainty_ns, 100000000);
  assert.equal(legacy.raw_gnss.max_time_uncertainty_ns, 100000);
  assert.match(locationTimingSummary(legacy), /Android clock alignment limit 100 ms/);
  delete legacy.raw_gnss.max_elapsed_realtime_uncertainty_ns;
  const before = JSON.stringify(legacy);
  assert.match(locationTimingSummary(legacy), /shared legacy limit 0.1 ms/);
  assert.doesNotMatch(locationTimingSummary(legacy), /alignment limit 10 ms|consumes timing/);
  assert.equal(JSON.stringify(legacy), before);
  const explicit = structuredClone(legacy);
  explicit.raw_gnss.max_elapsed_realtime_uncertainty_ns = 10000000;
  assert.match(locationTimingSummary(explicit), /receiver\/satellite limit 0.1 ms; Android clock alignment limit 10 ms/);
  assert.doesNotMatch(locationTimingSummary(locationPolicy()), /Raw clock uncertainty/);
});

test('all three clock uncertainty maxima fit one bounded diagnostic paragraph', () => {
  const fields = ['clock.bias_uncertainty_ns', 'clock.time_uncertainty_ns', 'clock.elapsed_realtime_uncertainty_ns'].map(field => ({
    field, reason: 'above-policy', count: 64, reported_max: Number.MAX_SAFE_INTEGER, requested_max: 1000000}));
  const summary = rawGnssFieldDiagnosticSummary(fields, 'clock');
  assert.ok(summary.length <= 480);
  for (const field of fields) assert.ok(summary.includes(field.field.slice(6)));
  assert.doesNotMatch(summary, /more fields/);
});
