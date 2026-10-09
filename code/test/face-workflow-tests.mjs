// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {OperatorFaceWorkflow} from '../../web/src/operator-face-workflow.js';
import {MOBILE_FACE_SPEC} from '../../web/src/face-model-spec.js';
import {alignSingleFace, decodeYuNet, normalizeFaceFeature, FACE_TEMPLATE_112} from '../../web/src/face-alignment.js';
import {MobileFaceModel} from '../../web/src/mobile-face-model.js';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const vector = () => [1, ...Array(127).fill(0)];
const context = {account_id: 'synthetic-account', principal_id: 'synthetic-person', device_id: 'this-device', session_id: 'session', task_id: null};
function fixture({extract, policy, write} = {}) {
  let reference = null, calls = 0, modelCalls = 0;
  const privacy = {revision: 0, device() { return {state: {revision: this.revision}}; }};
  const auth = {epoch: 0, clock: {seconds: () => 10}, privacy, faceReport: null,
    result: {mode: 'operator', context, operation_id: 'face-1', status: 'capture_active', expires_at: 300},
    capture: {handle: {authorization: {revision: 0}}}, media: null,
    async completeCapture() { this.capture = null; this.result.status = 'capture_complete_validation_unimplemented'; this.media = {pixels: {data: new Uint8Array(4)}, simulation: true}; },
    clearMedia() { this.media = null; }, clearFaceReport() { this.faceReport = null; },
    setFaceReport(report) { this.faceReport = report; },
    async cancel() { this.epoch++; this.capture = null; this.media = null; this.faceReport = null; this.result.status = 'cancelled'; }};
  const model = {spec: MOBILE_FACE_SPEC, async extract(...args) { modelCalls++; return extract ? extract(...args) : {embedding: vector(), quality: 'accepted', simulation: true}; }, close() { this.closed = true; }};
  const engine = {async json(method, json) {
    calls++; const input = JSON.parse(json);
    if (policy) return policy(method, input);
    const safe = {status: input.reference ? 'match' : 'enrollment_missing', embedding_match: input.reference ? true : null,
      authenticated: false, operator_presence_verified: false, identity_verified: false, liveness: 'unresolved', trusted_capture: 'unresolved',
      binding: {...context, operation_id: input.operation_id}, simulation: true, work_authority_granted: false};
    if (method === 'face_identity_enroll') return {...safe, status: 'enrolled', reference: {reference_id: input.reference_id,
      ...context, enrolled_device_id: context.device_id, enrollment_operation_id: input.operation_id, enrolled_at: 10,
      model: MOBILE_FACE_SPEC, embedding: input.embedding, simulation: true}};
    return safe;
  }};
  const store = {async read() { return reference ? structuredClone(reference) : null; }, async referenceId() { return reference?.reference_id ?? null; },
    async write(value, options) { if (write) await write(value, options); if (!options.current()) throw new Error('cancelled'); reference = structuredClone(value); },
    async delete() { reference = null; }, async close() { this.closed = true; }};
  const flow = new OperatorFaceWorkflow({engine, authentication: auth, model, referenceStore: store, context});
  return {flow, auth, model, store, privacy, calls: () => calls, modelCalls: () => modelCalls,
    setReference: value => { reference = value; }};
}
async function enroll(f) {
  await f.flow.completeCapture();
  await f.flow.enroll({deliberate: true, retentionConsent: true, reviewed: true});
}
test('Requester context is rejected before any face inference or retention', async () => {
  const f = fixture(); f.auth.result.mode = 'requester';
  await assert.rejects(f.flow.completeCapture(), /Requesters/);
  assert.equal(f.modelCalls(), 0); assert.equal(f.calls(), 0);
});
test('synthetic capture without image pixels cannot produce enrollment features', async () => {
  const f = fixture(); f.auth.completeCapture = async function () { this.capture = null; this.media = {kind: 'synthetic', blob: null}; };
  await assert.rejects(f.flow.completeCapture(), /Synthetic capture/);
  assert.equal(f.flow.status, 'capture_quality_failure'); assert.equal(f.modelCalls(), 0);
});
test('model unavailable fails visibly and discards transient camera pixels', async () => {
  const f = fixture({extract: () => { throw Object.assign(new Error('model unavailable'), {code: 'model_unavailable'}); }});
  await assert.rejects(f.flow.completeCapture(), /unavailable/);
  assert.equal(f.flow.status, 'model_unavailable'); assert.equal(f.auth.media, null); assert.equal(f.flow.features, null);
});
test('inference finishing after cancellation cannot restore features or clear newer media', async () => {
  const pending = deferred(), f = fixture({extract: () => pending.promise});
  const operation = f.flow.completeCapture();
  await new Promise(resolve => setImmediate(resolve)); await f.flow.cancel();
  const newerMedia = {blob: 'new private image'}; f.auth.media = newerMedia;
  const values = vector(); pending.resolve({embedding: values, quality: 'accepted'});
  assert.deepEqual(await operation, {stale: true}); assert.equal(f.auth.media, newerMedia);
  assert.ok(values.every(value => value === 0)); assert.equal(f.flow.features, null);
});
test('a newer privacy stop invalidates completed inference without issuing authority', async () => {
  const pending = deferred(), f = fixture({extract: () => pending.promise});
  const operation = f.flow.completeCapture(); await new Promise(resolve => setImmediate(resolve)); f.privacy.revision++;
  pending.resolve({embedding: vector(), quality: 'accepted'});
  assert.deepEqual(await operation, {stale: true}); assert.equal(f.flow.status, 'cancelled'); assert.equal(f.auth.faceReport, null);
});
test('retention requires distinct deliberate consent and review, and lifecycle cleanup preserves the saved reference', async () => {
  const f = fixture(); await f.flow.completeCapture();
  await assert.rejects(f.flow.enroll({deliberate: true, retentionConsent: true}), /Review/);
  assert.equal(await f.store.read(), null);
  await f.flow.enroll({deliberate: true, retentionConsent: true, reviewed: true});
  assert.equal(f.flow.snapshot().reference_summary.identity_verified, false);
  assert.equal(JSON.stringify(f.flow.snapshot()).includes('embedding'), false);
  await f.flow.close(); assert.ok(await f.store.read()); assert.equal(f.model.closed, true); assert.equal(f.store.closed, true);
});
test('cancellation before reference commit aborts retention rather than saving a late result', async () => {
  const pending = deferred(), f = fixture({write: async (_value, options) => {
    await pending.promise; assert.equal(options.signal.aborted, true);
  }});
  await f.flow.completeCapture(); const saving = f.flow.enroll({deliberate: true, retentionConsent: true, reviewed: true});
  await new Promise(resolve => setImmediate(resolve)); await f.flow.cancel(); pending.resolve();
  assert.deepEqual(await saving, {stale: true}); assert.equal(await f.store.read(), null);
});
test('missing references and embedding matches never become genuine authentication', async () => {
  const f = fixture(); await f.flow.completeCapture(); await f.flow.compare({threshold: 0.8});
  assert.equal(f.flow.status, 'enrollment_missing'); assert.equal(f.flow.snapshot().authenticated, false);
  await f.flow.enroll({deliberate: true, retentionConsent: true, reviewed: true});
  f.auth.result.status = 'capture_active'; f.auth.capture = {handle: {authorization: {revision: 0}}};
  await f.flow.completeCapture(); await f.flow.compare({threshold: 0.8});
  assert.equal(f.flow.comparison.embedding_match, true); assert.equal(f.flow.comparison.authenticated, false);
  assert.equal(f.flow.comparison.liveness, 'unresolved'); assert.equal(f.flow.snapshot().work_authority_granted, false);
});
test('replacement while comparison is pending invalidates the older reference verdict', async () => {
  const pending = deferred(); let compare;
  const f = fixture(); await enroll(f);
  f.auth.result.status = 'capture_active'; f.auth.capture = {handle: {authorization: {revision: 0}}}; await f.flow.completeCapture();
  const original = f.flow.engine.json; f.flow.engine.json = (method, input) => method === 'face_identity_assess' ? pending.promise : original(method, input);
  compare = f.flow.compare({threshold: 0.8}); await new Promise(resolve => setImmediate(resolve));
  const changed = await f.store.read(); changed.reference_id = 'replacement'; f.setReference(changed);
  pending.resolve({status: 'match', embedding_match: true}); await compare;
  assert.equal(f.flow.status, 'reference_changed'); assert.equal(f.flow.comparison, null); assert.equal(f.auth.faceReport, null);
});

test('a failed repeat comparison clears the previous visible and attached face verdict', async () => {
  const f = fixture(); await enroll(f);
  f.auth.result.status = 'capture_active'; f.auth.capture = {handle: {authorization: {revision: 0}}};
  await f.flow.completeCapture(); await f.flow.compare({threshold: 0.8});
  assert.equal(f.flow.comparison.embedding_match, true); assert.ok(f.auth.faceReport);
  f.store.read = async () => { throw new Error('unreadable reference'); };
  await assert.rejects(f.flow.compare({threshold: 0.8}), /unreadable/);
  assert.equal(f.flow.comparison, null); assert.equal(f.auth.faceReport, null);
});

test('replacement does not silently adopt an enrollment changed after capture review', async () => {
  const f = fixture(); await enroll(f);
  f.auth.result.status = 'capture_active'; f.auth.capture = {handle: {authorization: {revision: 0}}};
  await f.flow.completeCapture();
  const changed = await f.store.read(); changed.reference_id = 'changed-after-review'; f.setReference(changed);
  await assert.rejects(f.flow.enroll({deliberate: true, replace: true, retentionConsent: true, reviewed: true}), /changed after capture review/);
  assert.equal((await f.store.read()).reference_id, 'changed-after-review'); assert.equal(f.flow.features, null);
});

test('deletion requires another deliberate action when the displayed enrollment changes', async () => {
  const f = fixture(); await enroll(f);
  const changed = await f.store.read(); changed.reference_id = 'changed-after-review'; f.setReference(changed);
  await assert.rejects(f.flow.deleteReference({deliberate: true}), /changed after review/);
  assert.equal((await f.store.read()).reference_id, 'changed-after-review');
  assert.equal(f.flow.snapshot().reference_summary.reference_id, 'changed-after-review');
  await f.flow.deleteReference({deliberate: true}); assert.equal(await f.store.read(), null);
});

test('a delayed deletion lookup cannot delete or overwrite a newer face operation', async () => {
  const f = fixture(); await enroll(f); const saved = await f.store.read(), pending = deferred();
  f.store.referenceId = () => pending.promise;
  const deleting = f.flow.deleteReference({deliberate: true}); await new Promise(resolve => setImmediate(resolve));
  f.flow.epoch++; const newer = {reference_id: 'new-operation-summary'}; f.flow.referenceSummary = newer;
  pending.resolve(saved.reference_id);
  assert.deepEqual(await deleting, {stale: true}); assert.equal((await f.store.read()).reference_id, saved.reference_id);
  assert.equal(f.flow.referenceSummary, newer);
});
test('closing releases model and storage even when camera policy cleanup rejects', async () => {
  const f = fixture(); f.auth.cancel = async () => { throw new Error('closed core'); };
  await assert.rejects(f.flow.close(), /closed core/); assert.equal(f.model.closed, true); assert.equal(f.store.closed, true);
});
test('alignment rejects zero or multiple faces and malformed landmarks instead of selecting the largest', () => {
  const pixels = {width: 112, height: 112, data: new Uint8Array(112 * 112 * 4)};
  const face = {width: 80, height: 100, landmarks: FACE_TEMPLATE_112};
  assert.throws(() => alignSingleFace(pixels, []), /No usable/);
  assert.throws(() => alignSingleFace(pixels, [face, {...face, width: 90}]), /Multiple/);
  assert.throws(() => alignSingleFace(pixels, [{...face, landmarks: [[1, 1], [1, 1]]}]), /landmarks/);
  assert.equal(alignSingleFace(pixels, [face]).tensor.length, 3 * 112 * 112);
});
test('feature normalization rejects invalid vectors and produces finite unit features', () => {
  assert.throws(() => normalizeFaceFeature(Array(128).fill(0)), /empty/);
  assert.throws(() => normalizeFaceFeature(Array(128).fill(NaN)), /invalid/);
  const normalized = normalizeFaceFeature(Array(128).fill(1e300));
  assert.ok(Math.abs(normalized.reduce((sum, value) => sum + value * value, 0) - 1) < 1e-12);
});
test('malformed detector output fails capture quality rather than manufacturing landmarks', () => {
  assert.throws(() => decodeYuNet({}), /incompatible/);
});
test('encoder tensor cleanup occurs on runtime failure and incompatible output shape', async () => {
  for (const wrongShape of [false, true]) {
    let inputsDisposed = 0, outputsDisposed = 0;
    const model = new MobileFaceModel({}); model.ready = async () => {};
    model.runtime = {Tensor: class { dispose() { inputsDisposed++; } }};
    model.encoder = {run: async () => { if (!wrongShape) throw new Error('runtime failed');
      return {embeddings: {dims: [1, 128], dispose() { outputsDisposed++; }}}; }};
    await assert.rejects(model.encodeAligned(new Float32Array(3 * 112 * 112)), /failed|incompatible/);
    assert.equal(inputsDisposed, 1); assert.equal(outputsDisposed, wrongShape ? 1 : 0);
  }
});

test('an older cancelled model load cannot clear a newer pending load', async () => {
  const older = deferred(), newer = deferred(), model = new MobileFaceModel({});
  let calls = 0; model.load = () => ++calls === 1 ? older.promise : newer.promise;
  const first = model.ready(); await model.close(); const second = model.ready();
  older.reject(new Error('cancelled old load')); await assert.rejects(first, /cancelled old/);
  assert.equal(model.pending, newer.promise);
  newer.resolve(); await second; assert.equal(calls, 2); await model.close();
});
