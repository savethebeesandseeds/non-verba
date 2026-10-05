// SPDX-License-Identifier: AGPL-3.0-only
// Injected-engine transport/state tests. These do not assess physical cameras.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CameraQualityAnalysis, MAX_CAMERA_QUALITY_BYTES, cameraQualityRegion,
  cameraQualityRegionSummary, installCameraQualityUI} from '../../web/src/camera-quality.js';

const PROFILE = {version: 1, type: 'nonverba-camera-quality-profile',
  metric_profile: 'jpeg-rgb8-zune-tenengrad-v1', subject_region: null};
const REGION = {id: 'full_frame', bounds: {x: 0, y: 0, width: 64, height: 48},
  exposure: {sample_count: 3072, near_black_count: 0, near_white_count: 3072},
  sharpness: [{scale: 1, assessment: 'insufficient-texture'}]};
const report = (marker = 'a', byteLength = 4) => ({version: 1, type: 'nonverba-camera-quality-report',
  guidance_only: true, satisfies_successful_measurement: false, authenticity_proven: false,
  image_sha256: marker.repeat(64), analysis_profile_sha256: 'b'.repeat(64), profile: structuredClone(PROFILE),
  image: {byte_length: byteLength, oriented_width: 64, oriented_height: 48},
  regions: [structuredClone(REGION)], guidance: ['subject-region-not-selected', 'insufficient-texture']});
const file = marker => ({size: 4, name: 'synthetic-transport.jpg',
  arrayBuffer: async () => new Uint8Array([marker, 2, 3, 4]).buffer});
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject}; }
const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
function fixture(operation = async () => report()) {
  const calls = [], states = [], saves = [];
  const engine = {async json(method, ...args) {
    calls.push([method, ...args]);
    if (method === 'camera_quality_profile') return structuredClone(PROFILE);
    if (method === 'analyze_camera_quality') return operation(...args);
    throw new Error('Unexpected core operation');
  }};
  const analysis = new CameraQualityAnalysis({engine, onState: state => states.push(state)});
  const save = async (...args) => {saves.push(args);};
  return {calls, states, saves, engine, analysis, save};
}

test('analysis sends exact bytes and a separate oriented-pixel profile only to the quality engine', async () => {
  const f = fixture(), region = {x: 2, y: 3, width: 20, height: 15};
  const result = await f.analysis.analyze(file(1), region);
  assert.deepEqual(f.calls.map(call => call[0]), ['camera_quality_profile', 'analyze_camera_quality']);
  assert.deepEqual([...f.calls[1][1]], [1, 2, 3, 4]);
  assert.deepEqual(JSON.parse(f.calls[1][2]), {...PROFILE, subject_region: region});
  assert.equal(result.guidance_only, true);
  assert.equal(result.satisfies_successful_measurement, false);
  assert.equal(result.authenticity_proven, false);
  await f.analysis.save(f.save);
  assert.deepEqual(f.saves, [['nonverba-camera-quality-aaaaaaaaaaaa.json', 'application/json', JSON.stringify(report(), null, 2)]]);
  assert.equal(f.analysis.phase, 'ready');
});

test('missing, empty, invalid and oversized files fail before reading bytes or invoking the engine', async () => {
  for (const size of [0, -1, NaN, Infinity, '4', MAX_CAMERA_QUALITY_BYTES + 1]) {
    const f = fixture(); let read = 0;
    await assert.rejects(f.analysis.analyze({size, arrayBuffer: () => {read++; return new ArrayBuffer(4);}}), /32 MiB/);
    assert.equal(read, 0); assert.equal(f.calls.length, 0);
    assert.equal(f.analysis.report, null); assert.equal(f.analysis.phase, 'error');
    await assert.rejects(f.analysis.save(f.save), /Analyze/);
  }
  await assert.rejects(fixture().analysis.analyze(null), /Choose a JPEG/);
});

test('the exact byte limit reaches reading, without allocating a large fixture', async () => {
  const f = fixture(); let read = 0;
  await assert.rejects(f.analysis.analyze({size: MAX_CAMERA_QUALITY_BYTES, arrayBuffer: async () => {read++; throw new Error('bounded read checkpoint');}}), /bounded read checkpoint/);
  assert.equal(read, 1); assert.deepEqual(f.calls.map(call => call[0]), ['camera_quality_profile']);
});

test('subject regions require only the four whole oriented-pixel coordinates', async () => {
  assert.equal(cameraQualityRegion(null), null);
  const valid = {x: 0, y: 3, width: 4, height: 5};
  assert.deepEqual(cameraQualityRegion(valid), valid);
  for (const region of [{...valid, x: -1}, {...valid, y: 0.5}, {...valid, width: 0},
    {...valid, height: '5'}, {...valid, x: 8193}, {...valid, unrelated: true}, {}, []]) {
    const f = fixture();
    await assert.rejects(f.analysis.analyze(file(1), region), /whole pixel/);
    assert.equal(f.calls.length, 0);
  }
});

test('unsupported default profile stops before file loading and is not replaced by a JS metric implementation', async () => {
  const f = fixture(); let read = 0;
  f.engine.json = async () => ({...PROFILE, version: 2});
  await assert.rejects(f.analysis.analyze({size: 4, arrayBuffer: async () => {read++; return new ArrayBuffer(4);}}), /profile/);
  assert.equal(read, 0); assert.equal(f.analysis.report, null);
});

test('changing inputs while file loading prevents obsolete bytes from reaching analysis', async () => {
  const f = fixture(), oldRead = deferred();
  const old = f.analysis.analyze({size: 4, arrayBuffer: () => oldRead.promise});
  await flush();
  f.analysis.reset();
  await f.analysis.analyze(file(9));
  oldRead.resolve(new Uint8Array([1, 2, 3, 4]).buffer);
  assert.equal(await old, null);
  assert.equal(f.calls.filter(call => call[0] === 'analyze_camera_quality').length, 1);
  assert.equal(f.calls.at(-1)[1][0], 9);
  assert.equal(f.analysis.phase, 'ready');
});

test('obsolete engine results cannot replace a newer file or subject-region result', async () => {
  const oldResult = deferred(), f = fixture(bytes => bytes[0] === 1 ? oldResult.promise : report('c'));
  const old = f.analysis.analyze(file(1)); await flush();
  f.analysis.reset();
  await f.analysis.analyze(file(9), {x: 0, y: 0, width: 10, height: 10});
  oldResult.resolve(report('a'));
  assert.equal(await old, null);
  assert.equal(f.analysis.report.image_sha256, 'c'.repeat(64));
  assert.equal(f.states.at(-1).phase, 'ready');
});

test('obsolete loading or engine failures are suppressed after an input change', async () => {
  for (const stage of ['read', 'engine']) {
    const hold = deferred(), f = fixture(() => hold.promise);
    const old = f.analysis.analyze(stage === 'read' ? {size: 4, arrayBuffer: () => hold.promise} : file(1));
    await flush(); f.analysis.reset('New inputs selected.');
    hold.reject(new Error('obsolete failure'));
    assert.equal(await old, null);
    assert.equal(f.analysis.phase, 'idle'); assert.equal(f.states.at(-1).detail, 'New inputs selected.');
    assert.equal(f.analysis.report, null);
  }
});

test('current decoding errors and incomplete reads clear the previous downloadable result', async () => {
  const f = fixture(); await f.analysis.analyze(file(1));
  f.engine.json = async method => method === 'camera_quality_profile' ? PROFILE : Promise.reject(new Error('Malformed JPEG'));
  await assert.rejects(f.analysis.analyze(file(2)), /Malformed JPEG/);
  assert.equal(f.analysis.report, null); assert.equal(f.analysis.phase, 'error');
  await assert.rejects(f.analysis.save(f.save), /Analyze/);
  const incomplete = fixture();
  await assert.rejects(incomplete.analysis.analyze({size: 4, arrayBuffer: async () => new ArrayBuffer(3)}), /completely/);
  assert.equal(incomplete.calls.length, 1);
});

test('incorrect artifact types, acceptance claims and malformed engine results fail closed', async () => {
  for (const value of [null, {...report(), type: 'nonverba-verification'}, {...report(), version: 2},
    {...report(), satisfies_successful_measurement: true}, {...report(), authenticity_proven: true},
    {...report(), guidance_only: false}, {...report(), image_sha256: 'bad'},
    {...report(), analysis_profile_sha256: 'bad'}, {...report(), image: {byte_length: 5}},
    {...report(), regions: null}, {...report(), guidance: null}]) {
    const f = fixture(() => value);
    await assert.rejects(f.analysis.analyze(file(1)), /unsupported image quality report/);
    assert.equal(f.analysis.report, null); await assert.rejects(f.analysis.save(f.save), /Analyze/);
  }
});

test('external report mutation cannot rewrite the saved core record', async () => {
  const f = fixture(); const result = await f.analysis.analyze(file(1));
  result.image_sha256 = 'c'.repeat(64);
  f.analysis.report.profile.subject_region = {x: 1};
  await f.analysis.save(f.save);
  assert.deepEqual(JSON.parse(f.saves[0][2]), report());
});

test('presentation keeps texture and data limitations and exposure counts separate from a verdict', () => {
  assert.match(cameraQualityRegionSummary(REGION), /Near-black pixels: 0.00%/);
  assert.match(cameraQualityRegionSummary(REGION), /Near-white pixels: 100.00%/);
  assert.match(cameraQualityRegionSummary(REGION), /Insufficient texture/);
  assert.match(cameraQualityRegionSummary({...REGION, sharpness: [{assessment: 'insufficient-data'}]}), /Insufficient data/);
  const measured = cameraQualityRegionSummary({...REGION, sharpness: [{assessment: 'measured'}]});
  assert.match(measured, /calibrated focus verdict is unavailable/);
  assert.doesNotMatch(measured, /passed|failed|acceptable|hardware fault|operator fault/i);
});

function uiFixture(saveArtifact = async () => {}) {
  const elements = new Map();
  const make = () => ({value: '', checked: false, files: [], hidden: false, disabled: false, textContent: '', children: [], listeners: new Map(),
    addEventListener(type, listener) {this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);},
    async fire(type) {await Promise.all((this.listeners.get(type) || []).map(listener => listener()));},
    replaceChildren(...children) {this.children = children;}, append(child) {this.children.push(child);}});
  for (const id of ['verify-file', 'camera-quality-panel', 'camera-quality-analyze', 'camera-quality-save',
    'camera-quality-result', 'camera-quality-status', 'camera-quality-record', 'camera-quality-regions',
    'camera-quality-dimensions', 'camera-quality-subject-note', 'camera-quality-use-region', 'camera-quality-region-inputs',
    ...['x', 'y', 'width', 'height'].map(axis => 'camera-quality-region-' + axis)]) elements.set(id, make());
  const root = {getElementById: id => elements.get(id), createElement: make};
  const f = fixture();
  const analysis = installCameraQualityUI({root, engine: f.engine, saveArtifact});
  return {...f, analysis, $: id => elements.get(id)};
}

test('UI needs no challenge or key, exposes an independent record and resets on file or region changes', async () => {
  const f = uiFixture();
  assert.equal(f.$('camera-quality-save').disabled, true);
  f.$('verify-file').files = [file(1)]; await f.$('verify-file').fire('change');
  await f.$('camera-quality-analyze').fire('click');
  assert.equal(f.$('camera-quality-save').disabled, false);
  assert.equal(f.$('camera-quality-result').hidden, false);
  assert.match(f.$('camera-quality-subject-note').textContent, /background/);
  f.$('camera-quality-region-x').value = '4'; await f.$('camera-quality-region-x').fire('input');
  assert.equal(f.$('camera-quality-save').disabled, true);
  assert.equal(f.$('camera-quality-result').hidden, true);
  assert.equal(f.$('camera-quality-record').textContent, '');
  assert.equal(f.analysis.report, null);
});

test('invalid ROI clears an older ready UI report without invoking the engine again', async () => {
  const f = uiFixture(); f.$('verify-file').files = [file(1)];
  await f.$('camera-quality-analyze').fire('click');
  f.$('camera-quality-use-region').value = 'subject';
  f.$('camera-quality-region-x').value = '-1';
  await f.$('camera-quality-analyze').fire('click');
  assert.equal(f.calls.length, 2); assert.equal(f.analysis.report, null);
  assert.equal(f.$('camera-quality-save').disabled, true);
  assert.match(f.$('camera-quality-status').textContent, /whole pixel/);
});

test('save errors are reported honestly and permit retry without claiming an exported file', async () => {
  let attempts = 0;
  const f = uiFixture(async () => {attempts++; throw new Error('storage unavailable');});
  f.$('verify-file').files = [file(1)]; await f.$('camera-quality-analyze').fire('click');
  await f.$('camera-quality-save').fire('click');
  assert.equal(attempts, 1); assert.match(f.$('camera-quality-status').textContent, /was not saved: storage unavailable/);
  assert.equal(f.$('camera-quality-save').disabled, false);
  assert.equal(f.analysis.phase, 'ready');
});

test('UI clears stale work and export eligibility while its selected file changes', async () => {
  const f = uiFixture(), hold = deferred();
  f.$('verify-file').files = [{size: 4, arrayBuffer: () => hold.promise}];
  const old = f.$('camera-quality-analyze').fire('click'); await flush();
  assert.equal(f.$('camera-quality-analyze').disabled, true);
  f.$('verify-file').files = [file(9)]; await f.$('verify-file').fire('change');
  assert.equal(f.$('camera-quality-analyze').disabled, false);
  assert.equal(f.$('camera-quality-save').disabled, true);
  hold.resolve(new ArrayBuffer(4)); await old;
  assert.equal(f.analysis.phase, 'idle');
  assert.equal(f.$('camera-quality-result').hidden, true);
});
