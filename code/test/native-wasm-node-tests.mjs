// SPDX-License-Identifier: AGPL-3.0-only
// Linux JVM -> Rust JNI signatures -> the shipped web-target WASM verifier.
// Synthetic inputs only: no browser UI, microphone playback, Android/USB,
// physical sensor acquisition, or hardware-backed key attestation is exercised.
// Run: code/dev.ps1 -Action Exec -Command @('node', 'test/native-wasm-node-tests.mjs')
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') {
  throw new Error('Run this harness inside the managed non-verba-dev container.');
}
const codeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = resolve(codeRoot, '../web/dist');
const out = resolve(codeRoot, 'artifacts/qa');
const inputs = {
  wasm: resolve(webRoot, 'pkg/nonverba_core_bg.wasm'),
  wasm_glue: resolve(webRoot, 'pkg/nonverba_core.js'),
  location_platform: resolve(webRoot, 'location-platform.js'),
  camera_request: resolve(out, 'native-camera-synthetic-request.json'),
  camera_image: resolve(out, 'native-camera-synthetic.jpg'),
  camera_pin: resolve(out, 'native-camera-synthetic-key.txt'),
  audio_request: resolve(out, 'native-audio-synthetic-request.json'),
  audio_transcript: resolve(out, 'native-audio-synthetic-transcript.json'),
  audio_wav: resolve(out, 'native-audio-synthetic.wav'),
  audio_pin: resolve(out, 'native-audio-synthetic-key.txt'),
  gnss_trace: resolve(codeRoot, 'crates/nonverba-core/src/location_proof/raw_gnss_fixture.json'),
  gnss_envelope: resolve(out, 'raw-gnss-synthetic-proof.json'),
  gnss_pin: resolve(out, 'raw-gnss-synthetic-key.txt'),
};
const data = Object.fromEntries(await Promise.all(Object.entries(inputs).map(async ([name, path]) =>
  [name, await readFile(path)])));
const core = await import(pathToFileURL(inputs.wasm_glue).href);
// Supply exact bytes, so initialization neither fetches a URL nor depends on a server.
await core.default({module_or_path: new Uint8Array(data.wasm)});
const {readLocationProofEnvelope} = await import(pathToFileURL(inputs.location_platform).href);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = name => JSON.parse(data[name].toString('utf8'));
const pin = name => data[name].toString('utf8').trim();
const jsonCall = async (method, ...args) => JSON.parse(await core[method](...args));
const badPin = '0'.repeat(64);
const cases = [];
async function check(name, operation, validate) {
  let result;
  try {
    result = await operation();
    validate(result);
    cases.push({name, passed: true, result});
    console.log(`PASS ${name}`);
  } catch (error) {
    cases.push({name, passed: false, result, error: String(error?.stack || error)});
    console.error(`FAIL ${name}: ${error?.message || error}`);
  }
}
const rejected = value => assert.equal(value.verified, false);
const verified = value => assert.equal(value.verified, true, JSON.stringify(value.errors));

const cameraRequest = json('camera_request');
const image = new Uint8Array(data.camera_image);
const cameraPin = pin('camera_pin');
const verifyCamera = (request = cameraRequest, key = cameraPin, bytes = image) =>
  jsonCall('verify_image', bytes, JSON.stringify(request), key, 1800000002);
await check('camera: real JNI C2PA signature and exact native metadata', () => verifyCamera(), value => {
  verified(value);
  assert.equal(value.checks.native_camera_metadata_valid, true);
  assert.equal(value.checks.location_metadata_valid, true);
  assert.equal(value.native_camera.sensor_timestamp_ns, '9007199254741013');
  assert.equal(value.native_camera.sealed_at_unix_ms, 1800000001000);
  assert.equal(value.hardware_attested, false);
  assert.equal(value.camera_freshness_proven, false);
});
await check('camera: wrong pinned signer is rejected', () => verifyCamera(cameraRequest, badPin), rejected);
await check('camera: original request substitution is rejected', () =>
  verifyCamera({...cameraRequest, task: 'A different requested measurement'}), rejected);
const changedImage = image.slice();
changedImage[Math.floor(changedImage.length / 2)] ^= 1;
await check('camera: tampered JPEG is rejected', () => verifyCamera(cameraRequest, cameraPin, changedImage), rejected);

const audioRequest = json('audio_request');
const transcript = json('audio_transcript');
const wav = new Uint8Array(data.audio_wav);
const audioPin = pin('audio_pin');
const verifyAudio = (request = audioRequest, receipt = transcript, key = audioPin, bytes = wav) =>
  jsonCall('verify_audio', bytes, JSON.stringify(request), JSON.stringify(receipt), key, 1800000007);
await check('audio: real JNI C2PA signature and monitored native metadata', () => verifyAudio(), value => {
  verified(value);
  assert.equal(value.checks.native_audio_metadata_valid, true);
  assert.equal(value.native_audio.backend, 'android-aaudio');
  const config = value.native_audio.recording_configuration;
  assert.equal(config.observation_count, 6);
  assert.deepEqual(config.observation_monotonic_ns,
    ['1500000000', '2500000000', '3500000000', '4500000000', '5500000000', '6010000000']);
  assert.equal(value.hardware_attested, false);
  assert.equal(value.physical_freshness_proven, false);
});
await check('audio: wrong pinned signer is rejected', () => verifyAudio(audioRequest, transcript, badPin), rejected);
await check('audio: original request substitution is rejected', () =>
  verifyAudio({...audioRequest, task: 'A different requested sound'}), rejected);
const changedTranscript = structuredClone(transcript);
changedTranscript.rounds[0].pcm_sha256 = 'f'.repeat(64);
await check('audio: original transcript substitution is rejected', () => verifyAudio(audioRequest, changedTranscript), rejected);
const changedWav = wav.slice();
changedWav[Math.floor(changedWav.length / 2)] ^= 1;
await check('audio: tampered WAV is rejected', () => verifyAudio(audioRequest, transcript, audioPin, changedWav), rejected);
const policy = {version: 1, native_acquisition_required: true, raw_gnss_required: false,
  correlated_camera_clock_required: false, hardware_attestation_required: false, independent_position_required: false};
const appraiseAudio = value => jsonCall('appraise_audio', wav, JSON.stringify(audioRequest),
  JSON.stringify(transcript), audioPin, JSON.stringify(value), 1800000007);
await check('audio: verified native metadata satisfies the v1 acquisition policy', () => appraiseAudio(policy), value => {
  assert.equal(value.evidence_verified, true);
  assert.equal(value.policy_satisfied, true);
  assert.equal(value.local_replay_checked, false);
});
await check('audio: synthetic key cannot satisfy hardware attestation policy', () =>
  appraiseAudio({...policy, hardware_attestation_required: true}), value => {
  assert.equal(value.evidence_verified, true);
  assert.equal(value.policy_satisfied, false);
});
await check('audio: verified observations satisfy the explicit v2 monitoring policy', () =>
  appraiseAudio({...policy, version: 2, audio_recording_monitoring_required: true}), value => {
  assert.equal(value.evidence_verified, true);
  assert.equal(value.policy_satisfied, true);
  assert.equal(value.local_replay_checked, false);
});

const trace = json('gnss_trace');
const proof = readLocationProofEnvelope(data.gnss_envelope.toString('utf8'));
const gnssPin = pin('gnss_pin');
const verifyGnss = (request = trace.request, bytes = proof, key = gnssPin) =>
  jsonCall('verify_location_proof', bytes, JSON.stringify(request), key, 'null', trace.ended_at_ms / 1000);
await check('GNSS: real JNI COSE signature retains raw satellite observations', () => verifyGnss(), value => {
  verified(value);
  assert.equal(value.raw_gnss.ready, true);
  assert.equal(value.raw_gnss.epoch_count, 11);
  assert.equal(value.raw_gnss.min_qualifying_satellites, 4);
  for (const field of ['satellite_authentication_verified', 'independent_position_recomputed', 'collection_attested']) {
    assert.equal(value.raw_gnss[field], false);
  }
});
await check('GNSS: wrong pinned signer is rejected', () => verifyGnss(trace.request, proof, badPin), value => {
  rejected(value);
  assert.equal(value.checks.device_match, false);
});
const downgradedRequest = structuredClone(trace.request);
delete downgradedRequest.policy.raw_gnss;
await check('GNSS: original raw-satellite policy cannot be downgraded', () => verifyGnss(downgradedRequest), value => {
  rejected(value);
  assert.equal(value.checks.request_match, false);
});
const changedProof = proof.slice();
changedProof[changedProof.length - 1] ^= 1;
await check('GNSS: tampered COSE proof is rejected', () => verifyGnss(trace.request, changedProof), value => {
  rejected(value);
  assert.equal(value.checks.signature_integrity, false);
});

const completedAt = new Date().toISOString();
const report = {
  version: 1, type: 'nonverba-native-wasm-node-test-report', completed_at: completedAt,
  runtime: {node: process.version, platform: process.platform, managed_container: true},
  scope: {synthetic_camera: true, synthetic_audio: true, synthetic_receiver: true,
    crypto_mocked: false, browser_tested: false, physical_device_tested: false,
    sensor_acquisition_tested: false, hardware_key_tested: false, sound_emitted: false},
  input_sha256: Object.fromEntries(Object.entries(data).map(([name, bytes]) => [name, sha256(bytes)])),
  tests_passed: cases.filter(value => value.passed).length,
  tests_failed: cases.filter(value => !value.passed).length,
  cases,
};
await mkdir(out, {recursive: true});
const reportPath = resolve(out, `native-wasm-node-results-${completedAt.replace(/[:.]/g, '-')}-${process.pid}.json`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {flag: 'wx'});
console.log(`${report.tests_passed}/${cases.length} synthetic JNI-to-WASM checks passed. Report: ${reportPath}`);
if (report.tests_failed) process.exitCode = 1;
