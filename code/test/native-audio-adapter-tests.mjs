// SPDX-License-Identifier: AGPL-3.0-only
// Native transport state tests with synthetic bytes. Hardware/DSP are separate checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeAudioPlatform, NativeAudioCapture, nativeAudioDiagnosticRows} from '../../web/src/audio-platform.js';
const PIN = 'a'.repeat(64), ID = '12345678-1234-4234-8234-1234567890ab';
const request = {session_id: 'b'.repeat(64), duration_secs: 4};
const round = index => ({session_id: request.session_id, index, nonce: String(index + 1).repeat(64), type: 'round'});
// Android org.json escapes forward slashes, including those in Base64 strings.
const androidJson = value => JSON.stringify(value).replaceAll('/', '\\/');
function signedPcm() {
  const bytes = Buffer.alloc(192000), samples = [-1, -2, -1, -1, 0, 1, -3, -1];
  for (let index = 0; index < 96000; index++) bytes.writeInt16LE(samples[index % samples.length], index * 2);
  return bytes;
}
async function receiveNativeChunks(p, capture) {
  const received = [];
  capture.round(round(0), async (index, bytes) => {
    received.push({index, bytes});
    if (index === 0) capture.round(round(1));
  });
  await capture.polling;
  assert.deepEqual(p.failures.map(error => error.message), []);
  assert.deepEqual(received.map(chunk => chunk.index), [0, 1]);
  return received;
}
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
  return {calls, failures, bridge, create(captureRequest = request) { capture = new NativeAudioCapture(nativeAudioPlatform(), captureRequest, error => failures.push(error)); return capture; }};
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

test('Android-escaped signed PCM bytes complete both native transport rounds', async t => {
  const chunks = [Buffer.alloc(192000), signedPcm()];
  const p = setup(t), rawChunk = p.bridge.chunk;
  p.bridge.chunk = (id, index) => {
    const reply = {...JSON.parse(rawChunk(id, index)), pcm_base64: chunks[index].toString('base64')};
    const encoded = androidJson(reply);
    if (index === 1) assert.ok(encoded.length > 300000, 'the second segment must reproduce the Android JSON expansion');
    return encoded;
  };
  const capture = p.create(); await capture.open();
  const received = await receiveNativeChunks(p, capture);
  for (const {index, bytes} of received) assert.deepEqual(Buffer.from(bytes), chunks[index]);
  const receipt = {type: 'nonverba-audio-receipt', request, transcript: {rounds: [0, 1]}};
  assert.deepEqual([...await capture.finalize(receipt)], [1, 2, 3, 4]);
  assert.deepEqual(p.calls.filter(([name]) => name === 'round').map(call => call[2].index), [0, 1]);
  assert.equal(p.calls.some(([name]) => name === 'cancel'), false);
});

test('Android-escaped final WAV transport accepts bounded synthetic bytes', async t => {
  // Transport only: this buffer is not a signed WAV or a measurement acceptance fixture.
  const wav = Buffer.alloc(5 * 1024 * 1024, 0xff), wavBase64 = wav.toString('base64');
  const p = setup(t), rawStatus = p.bridge.status;
  p.bridge.status = () => {
    const reply = JSON.parse(rawStatus());
    if (reply.state === 'complete') reply.result.wav_base64 = wavBase64;
    const encoded = androidJson(reply);
    if (reply.state === 'complete') assert.ok(encoded.length > Math.ceil(8 * 1024 * 1024 / 3) * 4 + 64 * 1024);
    return encoded;
  };
  const capture = p.create(); await capture.open(); await receiveNativeChunks(p, capture);
  const received = await capture.finalize({type: 'nonverba-audio-receipt', request, transcript: {rounds: [0, 1]}});
  assert.deepEqual(Buffer.from(received), wav);
  assert.equal(p.failures.length, 0);
});

for (const [label, chunk, message] of [
  ['decoded PCM exceeds its fixed byte count', {pcm_base64: Buffer.alloc(192004).toString('base64')}, /Invalid location proof encoding/],
  ['escaped JSON exceeds its bounded envelope', {pcm_base64: Buffer.alloc(192000, 0xff).toString('base64'), padding: 'x'.repeat(64 * 1024)}, /Invalid native microphone response/],
  ['segment belongs to another attempt', {session_id: '12345678-1234-4234-8234-1234567890ac'}, /another session or position/],
  ['segment belongs to another position', {index: 1}, /another session or position/]
]) {
  test(`escaped native PCM refusal: ${label}`, async t => {
    const p = setup(t, {chunk}), rawChunk = p.bridge.chunk;
    p.bridge.chunk = (id, index) => androidJson(JSON.parse(rawChunk(id, index)));
    const capture = p.create(); await capture.open();
    let delivered = 0; capture.round(round(0), () => { delivered++; }); await capture.polling;
    assert.equal(delivered, 0); assert.equal(p.failures.length, 1); assert.match(p.failures[0].message, message);
    assert.deepEqual(p.calls.at(-1), ['cancel', ID]); assert.equal(p.calls.some(([name]) => name === 'finalize'), false);
  });
}

for (const [label, mutate, message] of [
  ['decoded WAV exceeds the existing eight MiB cap', reply => reply.result.wav_base64 = 'A'.repeat(Math.ceil(8 * 1024 * 1024 / 3) * 4 + 4), /Invalid location proof encoding/],
  ['native signing key changed', reply => reply.key_fingerprint = 'd'.repeat(64), /identity changed/],
  ['result signing key changed', reply => reply.result.fingerprint = 'd'.repeat(64), /Unexpected native microphone evidence origin/],
  ['result evidence origin changed', reply => reply.result.media_origin = 'web-audio-pcm', /Unexpected native microphone evidence origin/]
]) {
  test(`escaped native WAV refusal: ${label}`, async t => {
    const p = setup(t), rawStatus = p.bridge.status;
    p.bridge.status = () => {
      const reply = JSON.parse(rawStatus()); if (reply.state === 'complete') mutate(reply);
      return androidJson(reply);
    };
    const capture = p.create(); await capture.open(); await receiveNativeChunks(p, capture);
    await assert.rejects(capture.finalize({type: 'nonverba-audio-receipt', request, transcript: {rounds: [0, 1]}}), message);
  });
}

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

function diagnostics() {
  const format = {sample_rate: 48000, channels: 1, encoding: 'pcm-i16', android_encoding: 2, channel_mask: 16, channel_index_mask: 0};
  const stream = {device_id: 17, device_type: 'built-in-mic', sample_rate: 48000, channels: 1, format: 'pcm-f32',
    sharing_mode: 'shared', performance_mode: 'none', frames_per_burst: 192, buffer_capacity_frames: 4096};
  return {version: 1, type: 'nonverba-native-audio-diagnostics', signed: false, successful_measurement: false,
    session_id: ID, request_session_id: request.session_id, key_fingerprint: PIN, stopped_state: 'pilot', stopping_phase: 'pilot-recording',
    error: 'Android client format differs from the required capture format', terminal_elapsed_ms: 2134,
    retained_frames_last_observed: 32000, pilot_probe_enqueued: true, pilot_verified: false, challenge_count: 0,
    android_recording_configuration_last_observed: {input_session_id: 21, observed_monotonic_ns: '4567890123', device_id: 17, built_in: true, client_silenced: false,
      client_source: 9, source: 9, client_format: format, device_format: {...format, sample_rate: 44100, channels: 2, channel_mask: 12}, client_effect_count: 0, effect_count: 0},
    aaudio_requested: {input: {sample_rate: 48000, channels: 1, format: 'pcm-f32', performance_mode: 'none'},
      output: {sample_rate: 48000, channels: 1, format: 'pcm-f32', performance_mode: 'low-latency'}},
    aaudio_actual_last_observed: {input: stream, output: {...stream, device_id: 18, device_type: 'built-in-speaker', performance_mode: 'low-latency'},
      input_session_id: 21, captured_frames: 32000, timestamps_ready: true, observed_monotonic_ns: '4567890000', stream_phase: 'pilot-recording'}, diagnostic_errors: []};
}
const terminal = (diagnostic = diagnostics(), overrides = {}) => ({ok: false, state: 'error', error: 'Original native refusal',
  session_id: ID, key_fingerprint: PIN, diagnostics: diagnostic, ...overrides});
function assessment(reason = 'not_detected') {
  const detected = reason !== 'not_detected';
  return {version: 1, type: 'nonverba-native-audio-pilot-assessment', signal_algorithm: 'org.nonverba.audio-fsk.v1',
    sample_count: 96000, maximum_start_offset_samples: 38400, passed: reason === 'passed', reason,
    detection: {detected, score: detected ? 0.95 : 0.4, matched_symbols: detected ? 62 : 31, symbol_count: 64,
      offset_samples: reason === 'detected_late' ? 41000 : 960, sample_rate: 48000, rms: 0.01, in_band_ratio: detected ? 0.05 : 0.001}};
}
function pilotTiming() {
  return {input_session_id: 21, observed_monotonic_ns: '4500000000', captured_frames: 96000,
    record_requested_monotonic_ns: '2000000000', record_start_stream_frame: '0', first_input_callback_monotonic_ns: '2020000000',
    last_input_callback_monotonic_ns: '4020000000', completed_output_probe: {index: 0, output_start_stream_frame: '1200',
      output_end_stream_frame: '38064', output_first_callback_monotonic_ns: '2030000000', input_frame_at_output_start: 960}};
}
function roundAssessment(reasons = ['passed', 'not_detected']) {
  const rounds = reasons.map((reason, index) => ({index, start_sample: index * 96000, sample_count: 96000,
    passed: reason === 'passed', reason, detection: assessment(reason).detection}));
  return {version: 1, type: 'nonverba-native-audio-round-assessment', signal_algorithm: 'org.nonverba.audio-fsk.v1',
    sample_format: 'pcm16', maximum_start_offset_samples: 38400, passed: rounds.every(round => round.passed), rounds};
}
function roundDiagnostics(reasons) {
  const evaluated = roundAssessment(reasons);
  return {...diagnostics(), stopped_state: 'sealing', stopping_phase: 'recording-ready', pilot_verified: true,
    retained_frames_last_observed: evaluated.rounds.length * 96000, challenge_count: evaluated.rounds.length, round_assessment: evaluated};
}

for (const reason of ['not_detected', 'detected_late', 'passed']) {
  test(`unsigned evidence-round metrics preserve ${reason} without granting a successful artifact`, async t => {
    const diagnostic = roundDiagnostics(['passed', reason]), later = roundDiagnostics(['passed', 'passed']);
    const p = setup(t, {status: terminal(diagnostic), bridge: {cancel: () => JSON.stringify(terminal(later))}}), capture = p.create();
    await assert.rejects(capture.open(), error => {
      assert.equal(error.message, 'Original native refusal'); assert.deepEqual(error.nativeDiagnostics.round_assessment, diagnostic.round_assessment);
      error.nativeDiagnostics.round_assessment.rounds[1].detection.score = 0; return true;
    });
    const retained = capture.diagnostics(); assert.deepEqual(retained, diagnostic);
    const exported = JSON.parse(JSON.stringify(retained)); assert.deepEqual(exported, diagnostic);
    exported.round_assessment.rounds[1].detection.offset_samples = 0;
    assert.deepEqual(capture.diagnostics(), diagnostic, 'exported copies and a later cancellation cannot mutate frozen metrics');
    const rows = nativeAudioDiagnosticRows(capture.diagnostics()), joined = rows.join('\n');
    assert.ok(rows.every(row => row.length <= 512));
    assert.match(joined, new RegExp(`all round checks passed: ${reason === 'passed' ? 'yes' : 'no'}`));
    assert.match(joined, new RegExp(`Evidence round 2/2: ${reason}; detected`));
    assert.match(joined, /canonical PCM16/); assert.match(joined, /matched symbols/); assert.match(joined, /best candidate offset/);
    assert.match(joined, /RMS 0.01; in-band energy ratio/); assert.match(joined, /This is not a completed measurement/);
    assert.equal(retained.signed, false); assert.equal(retained.successful_measurement, false);
    await assert.rejects(capture.finalize({}), {name: 'AbortError'});
    assert.equal(p.calls.some(([name]) => ['round', 'finalize'].includes(name)), false);
  });
}

test('evidence-round diagnostics stay bound and exportable after a fresh retry owns different metrics', async t => {
  const original = roundDiagnostics(), p = setup(t, {status: terminal(original)}), first = p.create();
  await assert.rejects(first.open(), /Original native refusal/);
  const saved = JSON.parse(JSON.stringify(first.diagnostics()));
  const next = {...roundDiagnostics(['passed', 'passed']), session_id: '12345678-1234-4234-8234-1234567890ac', request_session_id: 'c'.repeat(64)};
  p.bridge.begin = text => { assert.equal(JSON.parse(text).session_id, next.request_session_id); return JSON.stringify({session_id: next.session_id}); };
  p.bridge.status = () => JSON.stringify(terminal(next, {session_id: next.session_id}));
  p.bridge.cancel = () => JSON.stringify(terminal(next, {session_id: next.session_id, state: 'cancelled'}));
  const second = p.create({...request, session_id: next.request_session_id}); await assert.rejects(second.open(), /Original native refusal/);
  assert.deepEqual(second.diagnostics(), next); assert.deepEqual(first.diagnostics(), original); assert.deepEqual(saved, original);
  assert.notEqual(saved.request_session_id, second.diagnostics().request_session_id);
});

for (const value of [undefined, null]) {
  test(`legacy evidence-round assessment (${value === null ? 'null' : 'missing'}) stays unavailable`, async t => {
    const diagnostic = diagnostics(); if (value === null) diagnostic.round_assessment = null;
    const p = setup(t, {status: terminal(diagnostic)}), capture = p.create(); await assert.rejects(capture.open(), /Original native refusal/);
    assert.deepEqual(capture.diagnostics(), diagnostic);
    assert.ok(nativeAudioDiagnosticRows(capture.diagnostics()).includes('Evidence-round assessment: unavailable; no per-round detector metrics were retained.'));
  });
}

test('maximum fifteen evidence rounds remain bounded and do not infer current frames from a prior pilot observation', async t => {
  const diagnostic = roundDiagnostics(Array(15).fill('passed'));
  assert.ok(new TextEncoder().encode(JSON.stringify(diagnostic.round_assessment)).length <= 8192);
  assert.ok(new TextEncoder().encode(JSON.stringify(diagnostic)).length <= 16 * 1024);
  assert.equal(diagnostic.aaudio_actual_last_observed.captured_frames, 32000, 'this cached observation belongs to the prior pilot');
  const p = setup(t, {status: terminal(diagnostic)}), capture = p.create({...request, duration_secs: 30});
  await assert.rejects(capture.open(), /Original native refusal/); assert.deepEqual(capture.diagnostics(), diagnostic);
  assert.match(nativeAudioDiagnosticRows(capture.diagnostics()).join('\n'), /Evidence round 15\/15: passed/);
});

test('unavailable retained-frame observation does not fabricate or reject otherwise owned evidence-round metrics', async t => {
  const diagnostic = {...roundDiagnostics(), retained_frames_last_observed: null};
  const p = setup(t, {status: terminal(diagnostic)}), capture = p.create(); await assert.rejects(capture.open(), /Original native refusal/);
  assert.deepEqual(capture.diagnostics(), diagnostic);
});

for (const [label, mutate] of [
  ['another sample format', value => value.round_assessment.sample_format = 'pcm-f32'],
  ['changed start policy', value => value.round_assessment.maximum_start_offset_samples = 38401],
  ['no assessed rounds', value => value.round_assessment.rounds = []],
  ['more than fifteen rounds', value => Object.assign(value, roundDiagnostics(Array(16).fill('passed')))],
  ['mismatched challenge count', value => value.challenge_count = 1],
  ['assessment outside retained frames', value => value.retained_frames_last_observed = 191999],
  ['repeated round index', value => value.round_assessment.rounds[1].index = 0],
  ['noncontiguous segment', value => value.round_assessment.rounds[1].start_sample = 96001],
  ['incomplete segment', value => value.round_assessment.rounds[1].sample_count = 95999],
  ['unavailable metrics claimed as assessed', value => value.round_assessment.rounds[1].detection = null],
  ['out-of-range detector score', value => value.round_assessment.rounds[1].detection.score = 1.1],
  ['nonfinite RMS', value => value.round_assessment.rounds[1].detection.rms = Infinity],
  ['impossible match count', value => value.round_assessment.rounds[1].detection.matched_symbols = 65],
  ['impossible best offset', value => value.round_assessment.rounds[1].detection.offset_samples = 59137],
  ['wrong detector sample profile', value => value.round_assessment.rounds[1].detection.sample_rate = 44100],
  ['contradictory round reason', value => value.round_assessment.rounds[1].reason = 'passed'],
  ['contradictory round result', value => value.round_assessment.rounds[0].passed = false],
  ['incorrect aggregate result', value => value.round_assessment.passed = true],
  ['extra nonce in a round', value => value.round_assessment.rounds[0].nonce = 'd'.repeat(64)],
  ['extra reporting key in the subset', value => value.round_assessment.key_fingerprint = PIN],
  ['oversized subset', value => value.round_assessment.padding = 'x'.repeat(8192)],
  ['oversized outer record', value => { value.error = '\u0001'.repeat(400); value.diagnostic_errors = Array(8).fill('\u0001'.repeat(400)); }]
]) {
  test(`malformed evidence-round assessment (${label}) never changes the original refusal`, async t => {
    const diagnostic = roundDiagnostics(); mutate(diagnostic);
    const p = setup(t, {status: terminal(diagnostic)}), capture = p.create();
    await assert.rejects(capture.open(), error => { assert.equal(error.message, 'Original native refusal'); assert.equal(error.nativeDiagnostics, undefined); return true; });
    assert.equal(capture.diagnostics(), null); assert.equal(p.calls.some(([name]) => ['round', 'finalize'].includes(name)), false);
  });
}

test('evidence-round metrics require the original outer attempt, request and reporting key', async t => {
  for (const [key, value] of [['session_id', '12345678-1234-4234-8234-1234567890ac'], ['request_session_id', 'c'.repeat(64)], ['key_fingerprint', 'd'.repeat(64)]]) {
    await t.test(key, async t => {
      const p = setup(t, {status: terminal({...roundDiagnostics(), [key]: value})}), capture = p.create();
      await assert.rejects(capture.open(), error => error.message === 'Original native refusal' && error.nativeDiagnostics === undefined);
      assert.equal(capture.diagnostics(), null);
    });
  }
});

test('all-passed evidence-round diagnostics in a successful status cannot supply a completed recording', async t => {
  const p = setup(t, {status: {diagnostics: roundDiagnostics(['passed', 'passed'])}}), capture = p.create(); await capture.open();
  assert.equal(capture.diagnostics(), null); await assert.rejects(capture.finalize({}), /incomplete/);
  assert.equal(p.calls.some(([name]) => name === 'finalize'), false);
});

test('native refusal retains bounded unsigned diagnostics without changing the original error or frozen values', async t => {
  const original = diagnostics(), p = setup(t, {status: terminal(original), bridge: {cancel: () => JSON.stringify(terminal({...original, terminal_elapsed_ms: 9999}))}});
  const capture = p.create();
  await assert.rejects(capture.open(), error => {
    assert.equal(error.message, 'Original native refusal'); assert.deepEqual(error.nativeDiagnostics, original);
    error.nativeDiagnostics.terminal_elapsed_ms = 1;
    return true;
  });
  const retained = capture.diagnostics(); assert.deepEqual(retained, original); retained.aaudio_actual_last_observed.input.sample_rate = 1;
  assert.deepEqual(capture.diagnostics(), original, 'callers cannot mutate the retained record');
  assert.equal(capture.closed, true); assert.equal(p.calls.some(([name]) => ['round', 'finalize'].includes(name)), false);
});

test('a terminal begin response retains diagnostics before any status or challenge call', async t => {
  const p = setup(t, {bridge: {begin: () => JSON.stringify(terminal()), status: () => assert.fail('Terminal begin must not poll.')}}), capture = p.create();
  await assert.rejects(capture.open(), error => error.message === 'Original native refusal' && error.nativeDiagnostics.session_id === ID);
  assert.deepEqual(capture.diagnostics(), diagnostics()); assert.deepEqual(p.calls, [['cancel', ID]]);
});

test('failure before native session creation keeps its refusal and cannot retain or cancel another attempt', async t => {
  const p = setup(t, {bridge: {begin: () => JSON.stringify({ok: false, error: 'Native queue refused setup', diagnostics: diagnostics()})}}), capture = p.create();
  await assert.rejects(capture.open(), /Native queue refused setup/);
  assert.equal(capture.diagnostics(), null); assert.deepEqual(p.calls, []);
});

test('owned diagnostic construction failure stays separate from the native refusal and unavailable record', async t => {
  const p = setup(t, {status: terminal(undefined, {diagnostics: undefined, diagnostics_error: 'Diagnostic snapshot could not be constructed'})}), capture = p.create();
  await assert.rejects(capture.open(), error => {
    assert.equal(error.message, 'Original native refusal'); assert.equal(error.nativeDiagnostics, undefined);
    assert.equal(error.nativeDiagnosticsError, 'Diagnostic snapshot could not be constructed'); return true;
  });
  assert.equal(capture.diagnostics(), null); assert.equal(capture.diagnosticsError(), 'Diagnostic snapshot could not be constructed');
});

for (const [label, mutate] of [
  ['another native attempt', value => value.session_id = '12345678-1234-4234-8234-1234567890ac'],
  ['another request', value => value.request_session_id = 'c'.repeat(64)],
  ['another key', value => value.key_fingerprint = 'd'.repeat(64)],
  ['claimed signature', value => value.signed = true],
  ['claimed successful measurement', value => value.successful_measurement = true],
  ['another artifact', value => value.type = 'nonverba-audio-receipt'],
  ['unexpected data', value => value.pcm_base64 = 'AQIDBA=='],
  ['invalid configuration', value => value.android_recording_configuration_last_observed.client_format.android_encoding = '2'],
  ['missing last-observed marker', value => delete value.aaudio_actual_last_observed.observed_monotonic_ns],
  ['too many diagnostic errors', value => value.diagnostic_errors = Array(9).fill('Unavailable')],
  ['oversized encoded record', value => { value.error = '\u0001'.repeat(400); value.diagnostic_errors = Array(8).fill('\u0001'.repeat(400)); }]
]) {
  test(`invalid diagnostics (${label}) never replace the native refusal or become evidence`, async t => {
    const diagnostic = diagnostics(); mutate(diagnostic);
    const p = setup(t, {status: terminal(diagnostic)}), capture = p.create();
    await assert.rejects(capture.open(), error => { assert.equal(error.message, 'Original native refusal'); assert.equal(error.nativeDiagnostics, undefined); return true; });
    assert.equal(capture.diagnostics(), null); assert.deepEqual(p.calls.at(-1), ['cancel', ID]);
  });
}

for (const overrides of [{session_id: 'another'}, {key_fingerprint: 'd'.repeat(64)}]) {
  test(`terminal reply identity is checked before diagnostics (${Object.keys(overrides)[0]})`, async t => {
    const p = setup(t, {status: terminal(diagnostics(), overrides)}), capture = p.create();
    await assert.rejects(capture.open(), error => { assert.match(error.message, /identity changed/); assert.equal(error.nativeDiagnostics, undefined); return true; });
    assert.equal(capture.diagnostics(), null);
  });
}

test('closing pending permission setup retains the native cancellation record without changing AbortError', async t => {
  let cancelled = 0;
  const diagnostic = {...diagnostics(), stopped_state: 'requesting-permission', stopping_phase: 'permission',
    retained_frames_last_observed: null, pilot_probe_enqueued: false, android_recording_configuration_last_observed: null, aaudio_actual_last_observed: null};
  const p = setup(t, {status: {state: 'requesting-permission'}, bridge: {cancel: () => { cancelled++; return JSON.stringify(terminal(diagnostic, {state: 'cancelled'})); }}}), capture = p.create();
  const work = capture.open(), rejected = assert.rejects(work, {name: 'AbortError'});
  capture.close(); await rejected; capture.close();
  assert.equal(cancelled, 1); assert.deepEqual(capture.diagnostics(), diagnostic);
  assert.ok(nativeAudioDiagnosticRows(diagnostic).includes('Last-observed retained frames: unavailable'));
});

test('terminal round, chunk and finalization replies all preserve the original diagnostic refusal', async t => {
  await t.test('round', async t => {
    const p = setup(t, {bridge: {round: () => JSON.stringify(terminal())}}), capture = p.create(); await capture.open();
    assert.throws(() => capture.round(round(0)), error => error.message === 'Original native refusal' && !!error.nativeDiagnostics);
    assert.deepEqual(capture.diagnostics(), diagnostics()); assert.equal(capture.nextRound, 0);
  });
  await t.test('chunk', async t => {
    const p = setup(t, {bridge: {chunk: () => JSON.stringify(terminal())}}), capture = p.create(); await capture.open();
    capture.round(round(0), () => assert.fail('Refused PCM must not leave the collector.')); await capture.polling;
    assert.equal(p.failures[0].message, 'Original native refusal'); assert.deepEqual(p.failures[0].nativeDiagnostics, diagnostics());
  });
  await t.test('finalization', async t => {
    const p = setup(t, {bridge: {finalize: () => JSON.stringify(terminal())}}), capture = p.create(); await capture.open();
    capture.nextChunk = capture.nextRound = 2;
    await assert.rejects(capture.finalize({}), error => error.message === 'Original native refusal' && !!error.nativeDiagnostics);
    assert.deepEqual(capture.diagnostics(), diagnostics());
  });
});

test('diagnostics in a successful response are ignored and cannot qualify as a successful recording', async t => {
  const p = setup(t, {status: {diagnostics: diagnostics()}}), capture = p.create(); await capture.open();
  assert.equal(capture.diagnostics(), null); await assert.rejects(capture.finalize({}), /incomplete/);
});

test('diagnostic rows expose requested and actual formats with bounded unsigned last-observed labels', () => {
  const value = diagnostics(); value.error = 'e'.repeat(400); value.diagnostic_errors = ['d'.repeat(400)];
  const rows = nativeAudioDiagnosticRows(value), joined = rows.join('\n');
  assert.ok(rows.every(row => row.length <= 512));
  assert.match(joined, /Unsigned attempt duration: 2134 ms/); assert.match(joined, /Last-observed retained frames: 32000/);
  assert.match(joined, /does not establish playback/); assert.match(joined, /Last-observed Android client format: 48000 Hz, 1 channel\(s\), pcm-i16; Android encoding 2, channel mask 16, index mask 0/);
  assert.match(joined, /Last-observed Android device format: 44100 Hz, 2 channel\(s\)/); assert.match(joined, /Requested AAudio input: 48000 Hz, 1 channel\(s\), pcm-f32, none/);
  assert.match(joined, /Last-observed AAudio output:.*built-in-speaker ID 18/); assert.match(joined, /monotonic ns 4567890000/);
});

for (const reason of ['not_detected', 'detected_late', 'passed']) {
  test(`unsigned pilot metrics retain ${reason} distinctly without completing a measurement`, async t => {
    const diagnostic = {...diagnostics(), pilot_assessment: assessment(reason), pilot_verified: reason === 'passed'};
    diagnostic.android_recording_configuration_last_observed.stream_phase = 'pilot-recording';
    const p = setup(t, {status: terminal(diagnostic)}), capture = p.create();
    await assert.rejects(capture.open(), error => {
      assert.equal(error.message, 'Original native refusal'); assert.deepEqual(error.nativeDiagnostics.pilot_assessment, assessment(reason));
      error.nativeDiagnostics.pilot_assessment.detection.score = 0;
      return true;
    });
    const retained = capture.diagnostics(), rows = nativeAudioDiagnosticRows(retained), joined = rows.join('\n');
    assert.deepEqual(retained, diagnostic); assert.ok(rows.every(row => row.length <= 512));
    assert.match(joined, new RegExp(`Unsigned pilot assessment: ${reason}; acoustic pilot policy passed: ${reason === 'passed' ? 'yes' : 'no'}`));
    assert.match(joined, /This is not a completed measurement/); assert.match(joined, /Last-observed Android configuration stream phase: pilot-recording/);
    assert.match(joined, /matched symbols/); assert.match(joined, /maximum accepted start 38400 samples/); assert.match(joined, /not a probability of authenticity/);
    retained.pilot_assessment.detection.offset_samples = 0; assert.deepEqual(capture.diagnostics(), diagnostic);
    assert.equal(capture.closed, true); await assert.rejects(capture.finalize({}), {name: 'AbortError'});
    assert.equal(p.calls.some(([name]) => ['round', 'finalize'].includes(name)), false);
  });
}

for (const pilot of [undefined, null]) {
  test(`older or unavailable pilot assessment (${pilot === null ? 'null' : 'missing'}) retains the original V1 report`, async t => {
    const diagnostic = diagnostics(); if (pilot === null) diagnostic.pilot_assessment = null;
    const p = setup(t, {status: terminal(diagnostic)}), capture = p.create();
    await assert.rejects(capture.open(), /Original native refusal/); assert.deepEqual(capture.diagnostics(), diagnostic);
    const rows = nativeAudioDiagnosticRows(capture.diagnostics());
    assert.ok(rows.includes('Pilot assessment: unavailable; no detector metrics were retained.'));
    assert.ok(rows.includes('Last-observed Android configuration stream phase: unavailable'));
  });
}

for (const [label, mutate] of [
  ['missing detection', value => value.detection = null],
  ['null metric', value => value.detection.rms = null],
  ['non-finite metric', value => value.detection.score = Infinity],
  ['out-of-range ratio', value => value.detection.in_band_ratio = 1.1],
  ['impossible match count', value => value.detection.matched_symbols = 65],
  ['impossible candidate offset', value => value.detection.offset_samples = 59137],
  ['wrong sample profile', value => value.detection.sample_rate = 44100],
  ['wrong sample count', value => value.sample_count = 95999],
  ['another algorithm', value => value.signal_algorithm = 'org.nonverba.audio-fsk.v2'],
  ['claimed late-policy success', value => { value.detection.offset_samples = 41000; value.reason = 'detected_late'; value.passed = true; }],
  ['contradictory reason', value => value.reason = 'detected_late'],
  ['unbound embedded identity', value => value.request_session_id = 'c'.repeat(64)]
]) {
  test(`malformed pilot assessment (${label}) cannot change the refusal or attach a report`, async t => {
    const pilot = assessment('passed'); mutate(pilot);
    const p = setup(t, {status: terminal({...diagnostics(), pilot_assessment: pilot})}), capture = p.create();
    await assert.rejects(capture.open(), error => { assert.equal(error.message, 'Original native refusal'); assert.equal(error.nativeDiagnostics, undefined); return true; });
    assert.equal(capture.diagnostics(), null);
  });
}

test('pilot assessment is still refused for mismatched outer request/key/attempt identities', async t => {
  for (const [key, value] of [['request_session_id', 'c'.repeat(64)], ['key_fingerprint', 'd'.repeat(64)], ['session_id', '12345678-1234-4234-8234-1234567890ac']]) {
    await t.test(key, async t => {
      const p = setup(t, {status: terminal({...diagnostics(), [key]: value, pilot_assessment: assessment('passed')})}), capture = p.create();
      await assert.rejects(capture.open(), error => error.message === 'Original native refusal' && error.nativeDiagnostics === undefined);
      assert.equal(capture.diagnostics(), null);
    });
  }
});

test('pilot callback timing stays frozen and belongs to its original input stream after evidence streams change', async t => {
  const diagnostic = {...diagnostics(), pilot_native_timing_last_observed: pilotTiming(), pilot_assessment: assessment('passed'), pilot_verified: true};
  diagnostic.aaudio_actual_last_observed = {...diagnostic.aaudio_actual_last_observed, input_session_id: 22, observed_monotonic_ns: '8000000000', stream_phase: 'recording-opening', captured_frames: 0};
  const later = structuredClone(diagnostic); later.pilot_native_timing_last_observed.observed_monotonic_ns = '9000000000';
  const p = setup(t, {status: terminal(diagnostic), bridge: {cancel: () => JSON.stringify(terminal(later))}}), capture = p.create();
  await assert.rejects(capture.open(), error => {
    assert.equal(error.message, 'Original native refusal'); assert.deepEqual(error.nativeDiagnostics.pilot_native_timing_last_observed, pilotTiming());
    error.nativeDiagnostics.pilot_native_timing_last_observed.completed_output_probe.output_start_stream_frame = '0'; return true;
  });
  assert.deepEqual(capture.diagnostics(), diagnostic);
  const retained = capture.diagnostics(); retained.pilot_native_timing_last_observed.record_start_stream_frame = '1'; assert.deepEqual(capture.diagnostics(), diagnostic);
  const rows = nativeAudioDiagnosticRows(capture.diagnostics()), joined = rows.join('\n');
  assert.ok(rows.every(row => row.length <= 512)); assert.match(joined, /Pilot native timing last observed: input session 21, monotonic ns 4500000000/);
  assert.match(joined, /stream phase recording-opening; input session 22/); assert.match(joined, /input start stream frame 0/);
  assert.match(joined, /Pilot output callback completion last observed: round 0, output frames 1200 to 38064 \(36864 samples\)/);
  assert.match(joined, /do not establish hardware presentation or physical sound/);
  await assert.rejects(capture.finalize({}), {name: 'AbortError'}); assert.equal(p.calls.some(([name]) => name === 'finalize'), false);
});

for (const timing of [undefined, null]) {
  test(`legacy pilot native timing (${timing === null ? 'null' : 'missing'}) remains unavailable rather than fabricated`, async t => {
    const diagnostic = diagnostics(); if (timing === null) diagnostic.pilot_native_timing_last_observed = null;
    const p = setup(t, {status: terminal(diagnostic)}), capture = p.create(); await assert.rejects(capture.open(), /Original native refusal/);
    assert.deepEqual(capture.diagnostics(), diagnostic); assert.ok(nativeAudioDiagnosticRows(capture.diagnostics()).includes('Pilot native timing: unavailable; enqueueing does not establish output callback completion.'));
  });
}

test('incomplete pilot snapshot preserves partial callback fields and frame zero without claiming output completion', async t => {
  const timing = {...pilotTiming(), captured_frames: 0, record_start_stream_frame: '0', last_input_callback_monotonic_ns: null, completed_output_probe: null};
  const p = setup(t, {status: terminal({...diagnostics(), pilot_native_timing_last_observed: timing})}), capture = p.create();
  await assert.rejects(capture.open(), /Original native refusal/); assert.deepEqual(capture.diagnostics().pilot_native_timing_last_observed, timing);
  const joined = nativeAudioDiagnosticRows(capture.diagnostics()).join('\n');
  assert.match(joined, /captured pilot frames 0/); assert.match(joined, /input start stream frame 0/); assert.match(joined, /last monotonic ns unavailable/);
  assert.match(joined, /completed output callback: unavailable in the last observation/); assert.doesNotMatch(joined, /output callback completion last observed: round/);
});

for (const [label, mutate] of [
  ['zero timestamp instead of null', value => value.record_requested_monotonic_ns = '0'],
  ['negative frame instead of null', value => value.record_start_stream_frame = '-1'],
  ['nondecimal timestamp', value => value.observed_monotonic_ns = '4.5e9'],
  ['overflowing native integer', value => value.completed_output_probe.output_end_stream_frame = '9223372036854775808'],
  ['future callback timestamp', value => value.last_input_callback_monotonic_ns = '4500000001'],
  ['regressed input callback', value => value.last_input_callback_monotonic_ns = '2019999999'],
  ['excess pilot capture', value => value.captured_frames = 96001],
  ['invalid input session', value => value.input_session_id = 0],
  ['another output round', value => value.completed_output_probe.index = 1],
  ['partial output marker', value => value.completed_output_probe.output_end_stream_frame = '38063'],
  ['excess input position', value => value.completed_output_probe.input_frame_at_output_start = 96001],
  ['additional identity claims', value => value.request_session_id = 'c'.repeat(64)]
]) {
  test(`malformed pilot native timing (${label}) does not replace the refusal or become evidence`, async t => {
    const timing = pilotTiming(); mutate(timing);
    const p = setup(t, {status: terminal({...diagnostics(), pilot_native_timing_last_observed: timing})}), capture = p.create();
    await assert.rejects(capture.open(), error => { assert.equal(error.message, 'Original native refusal'); assert.equal(error.nativeDiagnostics, undefined); return true; });
    assert.equal(capture.diagnostics(), null);
  });
}
