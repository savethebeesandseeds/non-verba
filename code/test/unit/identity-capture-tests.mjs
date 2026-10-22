// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {IdentityCaptureWorkflow, inspectIdentityImage, IDENTITY_CAPTURE_GUIDANCE,
  IDENTITY_CAPTURE_LIMITS} from '../../../web/shared/identity/identity-capture.js';

// Deliberately incomplete encoded fixtures isolate header, byte and workflow
// checks. The injected decoder supplies dimensions; Chromium integration owns
// successful decoding of actual generated images and physical capture remains
// a separate platform check.
function png(width = 640, height = 480) {
  const bytes = new Uint8Array(33); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  const data = new DataView(bytes.buffer); data.setUint32(16, width); data.setUint32(20, height);
  bytes[24] = 8; bytes[25] = 2; return new Blob([bytes], {type: 'image/png'});
}
function jpeg(width = 640, height = 480) {
  return new Blob([new Uint8Array([255, 216, 255, 192, 0, 11, 8, height >> 8, height & 255,
    width >> 8, width & 255, 1, 1, 17, 0, 255, 217])], {type: 'image/jpeg'});
}
const currentAccount = (overrides = {}) => ({account_id: 'account:a', principal_id: 'principal:a',
  current_session_id: 'session:a', session_active: true, confirmed: true, roles: ['R', 'O'], recovery_generation: 0, ...overrides});
function gate() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return {resolve, promise}; }
function setup({account = currentAccount(), inspectImage = async () => ({width: 640, height: 480})} = {}) {
  let current = account, serial = 0;
  const created = [], revoked = [], expected = [];
  const workflow = new IdentityCaptureWorkflow({getAccount: async options => {
    expected.push(structuredClone(options.expected));
    if (current instanceof Error) throw current;
    return current;
  }, inspectImage,
  createObjectURL: blob => { assert.ok(blob instanceof Blob); const url = `blob:isolated-${++serial}`; created.push(url); return url; },
  revokeObjectURL: url => revoked.push(url)});
  return {workflow, created, revoked, expected, setAccount: value => { current = value; }};
}
const deliberateFile = {source: 'file', deliberate: true};
async function begin(workflow, role = 'requester') {
  await workflow.begin(role); await workflow.setProcessingConsent(true);
}
async function ready(workflow) {
  await begin(workflow); await workflow.select('document_front', png(), deliberateFile);
  for (const step of IDENTITY_CAPTURE_GUIDANCE) await workflow.setGuidance(step);
  await workflow.select('face_front', png(), deliberateFile);
}
const refuses = (promise, code) => assert.rejects(promise, error => error.code === code);

test('actual capture requires current confirmed account, declared role, active session and safe generation', async () => {
  for (const account of [null, currentAccount({confirmed: false}), currentAccount({session_active: false}),
    currentAccount({current_session_id: ''}), currentAccount({recovery_generation: -1}),
    currentAccount({recovery_generation: Number.MAX_SAFE_INTEGER + 1}), currentAccount({roles: ['O']})]) {
    const f = setup({account}); await refuses(f.workflow.begin('requester'), 'account_required');
    assert.equal(f.workflow.snapshot().binding, null); assert.equal(f.workflow.snapshot().blocker.code, 'account_unavailable');
  }
  for (const role of ['requester', 'operator']) {
    const f = setup({account: currentAccount({recovery_generation: Number.MAX_SAFE_INTEGER})});
    await begin(f.workflow, role); assert.equal(f.workflow.snapshot().binding.role, role);
  }
});

test('PNG/JPEG signature, byte limit and encoded pixel bounds precede expensive decoding', async () => {
  let decodes = 0;
  const decoder = async () => { decodes++; return {width: 640, height: 480}; };
  for (const blob of [new Blob(['<svg/>'], {type: 'image/svg+xml'}), new Blob(['not a photo'], {type: 'image/jpeg'}),
    new Blob([await png().arrayBuffer()], {type: 'image/jpeg'}), png(0, 640), png(8193, 1), png(5000, 5000),
    new Blob([new Uint8Array(IDENTITY_CAPTURE_LIMITS.maxBytes + 1)], {type: 'image/png'})]) {
    await assert.rejects(inspectIdentityImage(blob, {decodeImage: decoder}));
  }
  assert.equal(decodes, 0);
  assert.equal((await inspectIdentityImage(png(), {decodeImage: decoder})).media_type, 'image/png');
  assert.equal((await inspectIdentityImage(jpeg(), {decodeImage: decoder})).media_type, 'image/jpeg');
  assert.equal(decodes, 2);
});

test('decoder failure or dimension disagreement refuses image; rotated JPEG is explicit', async () => {
  await refuses(inspectIdentityImage(png(), {decodeImage: async () => ({width: 1, height: 1})}), 'image_dimensions_mismatch');
  await refuses(inspectIdentityImage(png(), {decodeImage: async () => ({width: 480, height: 640})}), 'image_dimensions_mismatch');
  await refuses(inspectIdentityImage(png(), {decodeImage: async () => ({width: 640.5, height: 480})}), 'image_dimensions');
  await refuses(inspectIdentityImage(png(), {decodeImage: async () => { throw new Error('unsupported'); }}), 'image_decode_failed');
  const rotated = await inspectIdentityImage(jpeg(), {decodeImage: async () => ({width: 480, height: 640})});
  assert.equal(rotated.width, 480); assert.equal(rotated.height, 640); assert.match(rotated.sha256, /^[a-f0-9]{64}$/);
});

test('explicit processing, source action and successful camera stop precede acquisition review', async () => {
  const {workflow: w, created} = setup(); await w.begin('requester');
  await refuses(w.validate(), 'processing_consent_required');
  await refuses(w.select('document_front', png(), deliberateFile), 'processing_consent_required');
  await w.setProcessingConsent(true); await w.validate();
  await assert.rejects(w.select('document_front', png(), {source: 'file'}));
  await refuses(w.select('document_front', png(), {source: 'camera', deliberate: true}), 'camera_not_stopped');
  await refuses(w.select('document_front', png(), {source: 'camera', deliberate: true, cleanup: 'unknown'}), 'camera_not_stopped');
  await w.select('document_front', jpeg(), {source: 'camera', deliberate: true, cleanup: 'stopped'});
  assert.equal(w.snapshot().items[0].source, 'camera'); assert.equal(created.length, 1);
});

test('ordered face guidance or explicit accessibility skip enables a frontal image without assurance', async () => {
  for (const skip of [false, true]) {
    const {workflow: w} = setup(); await begin(w);
    await refuses(w.select('face_front', png(), deliberateFile), 'guidance_required');
    await refuses(w.setGuidance('front'), 'guidance_order');
    if (skip) await w.setGuidance('skipped');
    else for (const step of IDENTITY_CAPTURE_GUIDANCE) await w.setGuidance(step);
    await w.select('face_front', png(), deliberateFile);
    const state = w.snapshot(); assert.equal(state.guidance.complete, !skip); assert.equal(state.guidance.skipped, skip);
    assert.equal(state.movement_check, 'not_performed'); assert.equal(state.liveness, 'not_evaluated');
    assert.equal(state.identity_verified, false); assert.equal(state.verification.decision, null);
  }
});

test('review binds the exact image revision and every successful edit invalidates it', async () => {
  const {workflow: w} = setup(); await ready(w);
  await refuses(w.review(), 'review_required'); await w.review({deliberate: true});
  const first = w.snapshot(); assert.equal(first.status, 'reviewed'); assert.equal(first.reviewed_revision, first.revision);
  await w.select('document_front', jpeg(), deliberateFile);
  assert.equal(w.snapshot().status, 'ready'); assert.equal(w.snapshot().reviewed_revision, null);
  assert.ok(w.snapshot().revision > first.revision);
  await w.review({deliberate: true}); await w.remove('document_front');
  assert.equal(w.snapshot().status, 'incomplete'); assert.equal(w.snapshot().reviewed_revision, null);
  await refuses(w.review({deliberate: true}), 'review_required');
});

test('snapshots and notifications never include image bytes, URLs, file names or account adapter secrets', async () => {
  const f = setup({account: currentAccount({email: 'private@example.invalid', password: 'private-password', access_token: 'private-token'})});
  await ready(f.workflow); await f.workflow.review({deliberate: true});
  const snapshot = f.workflow.snapshot(), json = JSON.stringify(snapshot);
  assert.ok(snapshot.items.every(item => item.sha256 && item.byte_length && item.width && item.height));
  for (const secret of ['blob:', 'data:', 'private@example.invalid', 'private-password', 'private-token', 'session:a']) assert.ok(!json.includes(secret));
  assert.equal(snapshot.custody, 'transient_memory_only'); assert.equal(snapshot.retained, false); assert.equal(snapshot.submitted, false);
  assert.equal(snapshot.consent.retention, false); assert.ok(f.workflow.preview('document_front').startsWith('blob:'));
  snapshot.items[0].width = 7; assert.equal(f.workflow.snapshot().items[0].width, 640);
});

test('replacing/removing images, withdrawing consent and cancellation revoke only owned object URLs', async () => {
  const f = setup(); await ready(f.workflow);
  const document = f.workflow.preview('document_front'), face = f.workflow.preview('face_front');
  await f.workflow.select('document_front', jpeg(), deliberateFile); assert.deepEqual(f.revoked, [document]);
  await f.workflow.remove('face_front'); assert.deepEqual(f.revoked, [document, face]);
  await f.workflow.setProcessingConsent(false); assert.equal(f.workflow.preview('document_front'), null);
  assert.deepEqual(f.revoked, [document, face, f.created[2]]); assert.equal(f.workflow.snapshot().items.length, 0);
  f.workflow.cancel(); f.workflow.release(); assert.equal(f.revoked.length, 3); assert.equal(f.workflow.snapshot().status, 'cancelled');
});

test('exact account/principal/session/generation or role changes clear captured material before camera validation', async () => {
  for (const changed of [{account_id: 'account:b'}, {principal_id: 'principal:b'}, {current_session_id: 'session:b'},
    {recovery_generation: 1}, {roles: ['O']}, {session_active: false}]) {
    const f = setup(); await ready(f.workflow); f.setAccount(currentAccount(changed));
    await assert.rejects(f.workflow.validate());
    assert.equal(f.workflow.snapshot().binding, null); assert.equal(f.workflow.snapshot().items.length, 0);
    assert.equal(f.revoked.length, 2); assert.equal(f.workflow.snapshot().consent.processing, false);
    assert.deepEqual(f.expected[1], {account_id: 'account:a', principal_id: 'principal:a', role: 'requester', recovery_generation: 0, current_session_id: 'session:a'});
  }
});

test('account service failure clears local authority and media without claiming remote deletion', async () => {
  const f = setup(); await ready(f.workflow); f.setAccount(new Error('offline'));
  await assert.rejects(f.workflow.review({deliberate: true}), /offline/);
  const state = f.workflow.snapshot(); assert.equal(state.blocker.code, 'account_unavailable');
  assert.equal(state.status, 'incomplete'); assert.equal(state.binding, null); assert.equal(f.revoked.length, 2);
  assert.equal(state.retained, false); assert.equal(state.submitted, false);
});

test('cancel during image decode fences late pixels and cannot recreate a preview URL', async () => {
  const decoding = gate(), entered = gate();
  const f = setup({inspectImage: async () => { entered.resolve(); await decoding.promise; return {width: 640, height: 480}; }});
  await begin(f.workflow); const selecting = f.workflow.select('document_front', png(), deliberateFile);
  await entered.promise; f.workflow.cancel(); decoding.resolve(); await refuses(selecting, 'capture_cancelled');
  assert.equal(f.workflow.snapshot().status, 'cancelled'); assert.equal(f.workflow.snapshot().items.length, 0); assert.equal(f.created.length, 0);
});

test('a changed account while decoding clears previous images and refuses the late selection', async () => {
  const decoding = gate(), entered = gate(); let delay = false;
  const f = setup({inspectImage: async () => { if (delay) { entered.resolve(); await decoding.promise; } return {width: 640, height: 480}; }});
  await ready(f.workflow); delay = true;
  const selecting = f.workflow.select('document_front', jpeg(), deliberateFile); await entered.promise;
  f.setAccount(currentAccount({recovery_generation: 1})); decoding.resolve(); await refuses(selecting, 'account_changed');
  assert.equal(f.created.length, 2); assert.equal(f.revoked.length, 2); assert.equal(f.workflow.snapshot().binding, null);
});

test('a newer selection fences an older decode without losing the current selected image', async () => {
  const decoding = gate(), entered = gate(); let calls = 0;
  const f = setup({inspectImage: async () => { if (++calls === 1) { entered.resolve(); await decoding.promise; } return {width: 640, height: 480}; }});
  await begin(f.workflow); const old = f.workflow.select('document_front', png(), deliberateFile); await entered.promise;
  await f.workflow.select('document_front', jpeg(), deliberateFile); decoding.resolve(); await refuses(old, 'capture_cancelled');
  assert.equal(f.workflow.snapshot().items[0].media_type, 'image/jpeg'); assert.equal(f.created.length, 1); assert.equal(f.revoked.length, 0);
});

test('resetting guidance discards the old frontal photo and prevents a stale reviewed face from continuing', async () => {
  const f = setup(); await ready(f.workflow); await f.workflow.review({deliberate: true}); const face = f.workflow.preview('face_front');
  f.workflow.resetGuidance(); assert.equal(f.workflow.preview('face_front'), null); assert.deepEqual(f.revoked, [face]);
  assert.equal(f.workflow.snapshot().guidance.index, 0); assert.equal(f.workflow.snapshot().reviewed_revision, null);
  await refuses(f.workflow.select('face_front', png(), deliberateFile), 'guidance_required');
});
