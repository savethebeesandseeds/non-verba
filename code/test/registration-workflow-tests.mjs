// SPDX-License-Identifier: AGPL-3.0-only
// Orchestration tests with injected policy replies, independent of DOM/storage.
// Rust and compiled-WASM browser checks test the actual registration policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {RegistrationWorkflow, emptyRegistrationDraft} from '../../web/src/registration-workflow.js';

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; }
const flags = {simulation: true, account_created: false, authenticated: false, identity_verified: false,
  certifications_verified: false, publication_performed: false, data_transmitted: false, sensors_requested: false};
function report(overrides = {}) {
  return {...flags, valid_draft: true, review_current: true, ready_for_local_prepare: true,
    prepared: false, errors: [], reason: 'fixture_policy_reply', record: null, ...overrides};
}
function fixture(policy) {
  const calls = [], snapshots = [];
  const engine = {async json(method, json) {
    const input = JSON.parse(json); calls.push({method, input});
    return policy ? policy(method, input) : report();
  }};
  const workflow = new RegistrationWorkflow({engine, onChange: value => snapshots.push(value)});
  return {workflow, calls, snapshots};
}

test('both roles begin with optional sensitive details empty and every sharing preference off', () => {
  for (const role of ['operator', 'requester']) {
    const draft = emptyRegistrationDraft(role);
    assert.equal(draft.role, role); assert.equal(draft.revision, 0);
    assert.equal(draft.personal.display_name, ''); assert.equal(draft.personal.contact_email, '');
    assert.equal(draft.accommodations.note, ''); assert.equal(draft.accommodations.share_with_task_counterparty, false);
    assert.deepEqual(draft.certifications, []);
    assert.deepEqual(draft.sharing, {publish_display_name: false, publish_organization: false});
    assert.deepEqual(draft.acknowledgments, {private_data_handling: false, self_reported_certifications: false});
  }
});

test('reading snapshots or draft values cannot mutate the workflow behind its revision boundary', () => {
  const f = fixture(), snapshot = f.workflow.snapshot(), draft = f.workflow.draft;
  snapshot.draft.personal.display_name = 'snapshot mutation'; draft.personal.contact_email = 'draft mutation';
  assert.equal(f.workflow.draft.personal.display_name, ''); assert.equal(f.workflow.draft.personal.contact_email, '');
  assert.equal(f.workflow.draft.revision, 0);
});

test('assessment forwards structured private details and exact policy errors without client validation', async () => {
  const errors = [{field: 'personal.contact_email', code: 'invalid_email', message: 'Fixture policy rejected this email.'}];
  const f = fixture(() => report({valid_draft: false, ready_for_local_prepare: false, review_current: false, errors}));
  f.workflow.setField('personal', 'display_name', 'Synthetic Person');
  f.workflow.setField('personal', 'contact_email', 'not-an-email');
  f.workflow.setField('accommodations', 'note', 'Optional access support');
  const result = await f.workflow.assess();
  assert.deepEqual(result.errors, errors);
  assert.equal(f.calls[0].method, 'registration_assess');
  assert.equal(f.calls[0].input.draft.personal.contact_email, 'not-an-email');
  assert.equal(f.calls[0].input.draft.accommodations.note, 'Optional access support');
  assert.equal(f.calls[0].input.reviewed_revision, null); assert.equal(f.calls[0].input.deliberate, false);
  assert.equal(f.workflow.reviewedRevision, null);
});

test('review binds the current draft revision only after the core confirms its validity', async () => {
  const f = fixture(); f.workflow.setField('personal', 'display_name', 'Synthetic Person');
  const result = await f.workflow.review();
  assert.equal(result.valid_draft, true);
  assert.equal(f.calls[0].input.reviewed_revision, 1);
  assert.equal(f.calls[0].input.deliberate, false);
  assert.equal(f.workflow.reviewedRevision, 1);
  const rejected = fixture(() => report({valid_draft: false, review_current: false, ready_for_local_prepare: false}));
  await rejected.workflow.review(); assert.equal(rejected.workflow.reviewedRevision, null);
});

test('preparation is a separate deliberate call and preserves all no-account/no-verification flags', async () => {
  const record = {role: 'operator', revision: 1, public_candidate: {display_name: null, organization: null}};
  const f = fixture(method => method === 'registration_prepare' ? report({prepared: true, record}) : report());
  f.workflow.setField('personal', 'display_name', 'Synthetic Person'); await f.workflow.review();
  const result = await f.workflow.prepare({deliberate: true});
  assert.equal(f.calls.at(-1).method, 'registration_prepare');
  assert.equal(f.calls.at(-1).input.deliberate, true); assert.equal(f.calls.at(-1).input.reviewed_revision, 1);
  assert.equal(f.workflow.snapshot().preparation.prepared, true);
  for (const key of Object.keys(flags).filter(key => key !== 'simulation')) assert.equal(result[key], false);
});

test('a refused preparation is never converted into a locally prepared result', async () => {
  const f = fixture(() => report({prepared: false, ready_for_local_prepare: false, reason: 'review_required'}));
  const result = await f.workflow.prepare();
  assert.equal(f.calls[0].input.deliberate, false); assert.equal(f.calls[0].input.reviewed_revision, null);
  assert.equal(result.reason, 'review_required'); assert.equal(f.workflow.preparation, null);
});

test('role and privacy edits invalidate review and erase a previously prepared record', async () => {
  for (const edit of [workflow => workflow.setRole('requester'),
    workflow => workflow.setField('sharing', 'publish_display_name', true),
    workflow => workflow.setField('accommodations', 'note', 'Changed access support')]) {
    const f = fixture(method => method === 'registration_prepare' ? report({prepared: true, record: {private_details: 'fixture'}}) : report());
    await f.workflow.review(); await f.workflow.prepare({deliberate: true});
    edit(f.workflow);
    assert.equal(f.workflow.draft.revision, 1); assert.equal(f.workflow.reviewedRevision, null);
    assert.equal(f.workflow.assessment, null); assert.equal(f.workflow.preparation, null);
  }
});

test('reset clears all private details, optional sharing, rows, review and prepared output', async () => {
  const f = fixture(method => method === 'registration_prepare' ? report({prepared: true, record: {private_details: 'PRIVATE-SECRET'}}) : report());
  f.workflow.setField('personal', 'contact_email', 'private@example.test');
  f.workflow.setField('accommodations', 'note', 'PRIVATE-SECRET');
  f.workflow.setField('accommodations', 'share_with_task_counterparty', true);
  const index = f.workflow.addCertification(); f.workflow.setCertification(index, 'title', 'PRIVATE-SECRET');
  await f.workflow.review(); await f.workflow.prepare({deliberate: true}); f.workflow.reset();
  assert.deepEqual(f.workflow.draft, emptyRegistrationDraft());
  assert.equal(f.workflow.reviewedRevision, null); assert.equal(f.workflow.preparation, null);
  assert.equal(JSON.stringify(f.workflow.snapshot()).includes('PRIVATE-SECRET'), false);
  assert.equal(JSON.stringify(f.workflow.snapshot()).includes('private@example.test'), false);
});

test('late assessment after an edit cannot restore stale field errors or review authority', async () => {
  const pending = deferred(), f = fixture(() => pending.promise);
  const assessing = f.workflow.review(); f.workflow.setField('personal', 'display_name', 'new draft');
  pending.resolve(report());
  assert.deepEqual(await assessing, {stale: true});
  assert.equal(f.workflow.reviewedRevision, null); assert.equal(f.workflow.assessment, null);
});

test('reset fences a pending preparation even if the worker later returns private data', async () => {
  const pending = deferred(), f = fixture(method => method === 'registration_prepare' ? pending.promise : report());
  f.workflow.setField('accommodations', 'note', 'old private note'); await f.workflow.review();
  const preparing = f.workflow.prepare({deliberate: true}); f.workflow.reset();
  pending.resolve(report({prepared: true, record: {private_details: 'old private note'}}));
  assert.deepEqual(await preparing, {stale: true});
  assert.equal(f.workflow.preparation, null); assert.equal(f.workflow.draft.accommodations.note, '');
});

test('late rejected replies after reset or edit are discarded as stale failures', async () => {
  for (const change of [workflow => workflow.reset(), workflow => workflow.setRole('requester')]) {
    const pending = deferred(), f = fixture(() => pending.promise), assessing = f.workflow.assess();
    change(f.workflow); pending.reject(new Error('old failed worker request'));
    assert.deepEqual(await assessing, {stale: true}); assert.equal(f.workflow.assessment, null);
  }
});

test('the latest of concurrent policy replies owns current assessment and older replies cannot overwrite it', async () => {
  const first = deferred(), second = deferred(); let count = 0;
  const f = fixture(() => ++count === 1 ? first.promise : second.promise);
  const older = f.workflow.assess(), newer = f.workflow.review();
  second.resolve(report({reason: 'latest_review'})); await newer;
  first.resolve(report({valid_draft: false, ready_for_local_prepare: false, reason: 'older_error'}));
  assert.deepEqual(await older, {stale: true});
  assert.equal(f.workflow.assessment.reason, 'latest_review'); assert.equal(f.workflow.reviewedRevision, 0);
});

test('certificate rows retain structure and private sharing defaults; callers cannot insert verified claims', () => {
  const f = fixture(), first = f.workflow.addCertification(), second = f.workflow.addCertification();
  f.workflow.setCertification(first, 'title', 'Synthetic qualification');
  f.workflow.setCertification(second, 'reference', 'Optional reference');
  assert.equal(f.workflow.draft.certifications[first].share_with_task_counterparty, false);
  assert.throws(() => f.workflow.setCertification(first, 'verification', 'verified'), /Unknown certification field/);
  assert.throws(() => f.workflow.setField('personal', 'identity_verified', true), /Unknown registration field/);
  f.workflow.removeCertification(first);
  assert.equal(f.workflow.draft.certifications.length, 1);
  assert.equal(f.workflow.draft.certifications[0].reference, 'Optional reference');
  assert.equal(f.calls.length, 0);
});

test('current engine failures remain visible failures and cannot fabricate prepared records', async () => {
  const f = fixture(() => Promise.reject(new Error('current policy unavailable')));
  await assert.rejects(f.workflow.prepare({deliberate: true}), /policy unavailable/);
  assert.equal(f.workflow.preparation, null); assert.equal(f.workflow.reviewedRevision, null);
});

// Explicit fake policy fixtures: these values are not selected-model features.
const fixtureModel = {id: 'fixture-only-encoder', version: 'fixture-v1', dimensions: 128};
const fixturePolicy = {required: true, account_id: 'synthetic-account', principal_id: 'synthetic-person', model: fixtureModel};
const fixtureReference = {reference_id: 'private-fixture-reference', account_id: 'synthetic-account', principal_id: 'synthetic-person',
  enrolled_device_id: 'this-device', enrollment_operation_id: 'fixture-enrollment', enrolled_at: 2000000000,
  model: fixtureModel, embedding: Array.from({length: 128}, (_, index) => index === 0 ? 1 : 0), simulation: true};

test('selected Operator enrollment is passed to Rust separately and snapshots contain no biometric vector', async () => {
  const f = fixture(); f.workflow.setFacePolicy(fixturePolicy); f.workflow.setFaceReference(fixtureReference);
  await f.workflow.review();
  assert.deepEqual(f.calls.at(-1).input.face_policy, fixturePolicy);
  assert.deepEqual(f.calls.at(-1).input.face_reference, fixtureReference);
  assert.equal(Object.hasOwn(f.calls.at(-1).input.draft, 'face_reference'), false);
  const summary = f.workflow.snapshot().face_enrollment;
  assert.equal(summary.reference_id, fixtureReference.reference_id); assert.equal(summary.enrollment_continuity_only, true);
  assert.equal(Object.hasOwn(summary, 'embedding'), false);
  assert.equal(JSON.stringify(f.workflow.snapshot()).includes('"embedding"'), false);
});

test('switching to Requester clears all selected face inputs and forbids new face policy or enrollment', async () => {
  const f = fixture(); f.workflow.setFacePolicy(fixturePolicy); f.workflow.setFaceReference(fixtureReference);
  f.workflow.setRole('requester');
  assert.equal(f.workflow.snapshot().face_policy, null); assert.equal(f.workflow.snapshot().face_enrollment, null);
  assert.throws(() => f.workflow.setFacePolicy(fixturePolicy), /Requester/);
  assert.throws(() => f.workflow.setFaceReference(fixtureReference), /Requester/);
  await f.workflow.prepare({deliberate: true});
  assert.equal(Object.hasOwn(f.calls.at(-1).input, 'face_policy'), false);
  assert.equal(Object.hasOwn(f.calls.at(-1).input, 'face_reference'), false);
});

test('reference replacement or deletion invalidates exact review and erases prepared registration output', async () => {
  const f = fixture(method => method === 'registration_prepare' ? report({prepared: true, record: {private_details: 'fixture'}}) : report());
  f.workflow.setFacePolicy(fixturePolicy); f.workflow.setFaceReference(fixtureReference);
  await f.workflow.review(); await f.workflow.prepare({deliberate: true});
  const revision = f.workflow.draft.revision;
  f.workflow.setFaceReference({...fixtureReference, reference_id: 'replacement-reference'});
  assert.equal(f.workflow.draft.revision, revision + 1); assert.equal(f.workflow.reviewedRevision, null); assert.equal(f.workflow.preparation, null);
  f.workflow.setFaceReference(null);
  assert.equal(f.workflow.snapshot().face_enrollment, null);
  f.workflow.reset(); assert.equal(f.workflow.snapshot().face_policy, null);
});

test('deleted enrollment fences a late review of the former private reference', async () => {
  const pending = deferred(), f = fixture(() => pending.promise);
  f.workflow.setFacePolicy(fixturePolicy); f.workflow.setFaceReference(fixtureReference);
  const reviewing = f.workflow.review(); f.workflow.setFaceReference(null); pending.resolve(report());
  assert.deepEqual(await reviewing, {stale: true}); assert.equal(f.workflow.reviewedRevision, null);
});

test('selected Operator checks the live store before review and invalidates a cross-tab deletion', async () => {
  let stored = fixtureReference, reads = 0;
  const f = fixture(); f.workflow.faceReferenceProvider = async () => { reads++; return stored; };
  f.workflow.setFacePolicy(fixturePolicy); f.workflow.setFaceReference(fixtureReference);
  await f.workflow.review(); assert.equal(reads, 2);
  stored = null;
  const reviewed = await f.workflow.review();
  assert.deepEqual(reviewed, {stale: true, reference_changed: true});
  assert.equal(f.calls.length, 1); assert.equal(f.workflow.reviewedRevision, null);
  assert.equal(f.workflow.snapshot().face_enrollment, null);
});

test('replacement during Rust preparation discards the reply and requires reviewing the new reference', async () => {
  const entered = deferred(), pending = deferred(); let stored = fixtureReference;
  const f = fixture(method => {
    if (method !== 'registration_prepare') return report();
    entered.resolve(); return pending.promise;
  });
  f.workflow.faceReferenceProvider = async () => structuredClone(stored);
  f.workflow.setFacePolicy(fixturePolicy); f.workflow.setFaceReference(fixtureReference);
  await f.workflow.review();
  const preparing = f.workflow.prepare({deliberate: true}); await entered.promise;
  stored = {...fixtureReference, reference_id: 'replacement-from-another-tab'};
  pending.resolve(report({prepared: true, record: {private_details: 'former-enrollment'}}));
  assert.deepEqual(await preparing, {stale: true, reference_changed: true});
  assert.equal(f.workflow.preparation, null); assert.equal(f.workflow.reviewedRevision, null);
  assert.equal(f.workflow.snapshot().face_enrollment.reference_id, stored.reference_id);
  await f.workflow.review();
  assert.equal(f.calls.at(-1).input.face_reference.reference_id, stored.reference_id);
});

test('a changed model under the same reference ID also invalidates enrollment review', async () => {
  const f = fixture(); f.workflow.setFacePolicy(fixturePolicy); f.workflow.setFaceReference(fixtureReference);
  await f.workflow.review();
  f.workflow.faceReferenceProvider = async () => ({...fixtureReference, model: {...fixtureModel, version: 'replacement-model'}});
  assert.deepEqual(await f.workflow.assess(), {stale: true, reference_changed: true});
  assert.equal(f.workflow.reviewedRevision, null); assert.equal(f.calls.length, 1);
});

test('Requester never reads a face reference provider, including after an Operator role switch', async () => {
  let reads = 0;
  const f = fixture(); f.workflow.faceReferenceProvider = async () => { reads++; throw new Error('must not read biometric data'); };
  f.workflow.setFacePolicy(fixturePolicy); f.workflow.setFaceReference(fixtureReference); f.workflow.setRole('requester');
  await f.workflow.assess(); await f.workflow.review(); await f.workflow.prepare({deliberate: true});
  assert.equal(reads, 0); assert.equal(f.calls.length, 3);
});

test('reset fences a rejected live-store lookup without restoring biometric selection', async () => {
  const pending = deferred(), f = fixture();
  f.workflow.faceReferenceProvider = () => pending.promise;
  f.workflow.setFacePolicy(fixturePolicy); f.workflow.setFaceReference(fixtureReference);
  const reviewing = f.workflow.review(); f.workflow.reset(); pending.reject(new Error('former store failed'));
  assert.deepEqual(await reviewing, {stale: true}); assert.equal(f.calls.length, 0);
  assert.equal(f.workflow.snapshot().face_enrollment, null);
});

test('a current unreadable reference store erases prepared enrollment and fails closed', async () => {
  const f = fixture(method => method === 'registration_prepare' ? report({prepared: true, record: {private_details: 'fixture'}}) : report());
  f.workflow.faceReferenceProvider = async () => fixtureReference;
  f.workflow.setFacePolicy(fixturePolicy); f.workflow.setFaceReference(fixtureReference);
  await f.workflow.review(); await f.workflow.prepare({deliberate: true});
  f.workflow.faceReferenceProvider = async () => { throw new Error('reference store unavailable'); };
  await assert.rejects(f.workflow.assess(), /store unavailable/);
  assert.equal(f.workflow.preparation, null); assert.equal(f.workflow.reviewedRevision, null);
  assert.equal(f.workflow.snapshot().face_enrollment, null);
});
