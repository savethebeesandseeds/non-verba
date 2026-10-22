// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {SyntheticEnrollmentWorkflow, createSyntheticEnrollmentStore, ENROLLMENT_GUIDANCE,
  SYNTHETIC_ENROLLMENT_MEDIA} from '../fixtures/identity/synthetic-enrollment-workflow.js';

function memory() {
  const values = new Map();
  return {values, getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
}
const account = (overrides = {}) => ({account_id: 'account-a', principal_id: 'principal-a',
  confirmed: true, roles: ['R', 'O'], recovery_generation: 0, current_session_id: 'session-a', session_active: true, ...overrides});
function setup({storage = memory(), current = account(), wrapStore = value => value} = {}) {
  let active = current;
  const store = wrapStore(createSyntheticEnrollmentStore(storage));
  const workflow = new SyntheticEnrollmentWorkflow({getAccount: async () => active, store});
  return {workflow, storage, store, setAccount: value => { active = value; }};
}
async function reviewed(workflow, role = 'operator') {
  await workflow.begin(role);
  await workflow.setConsent({processing: true, retention: true});
  await workflow.select('document_front', 'document_a');
  await workflow.select('face_front', 'face_a');
  return workflow.review({deliberate: true});
}
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return {promise, resolve}; }

test('a pending operation, role flag or historical receipt cannot bootstrap an account', async () => {
  for (const current of [null, {role: 'operator', identityReady: true}, account({confirmed: false}),
    account({session_active: false}), account({current_session_id: null})]) {
    const f = setup({current});
    await assert.rejects(f.workflow.begin('operator'));
    assert.equal(f.workflow.snapshot().blocker.code, 'account_unavailable');
    assert.equal(f.workflow.snapshot().binding, null);
  }
});

test('initial unbound accounts need no device key; declared R/O roles and safe generations are preserved', async () => {
  for (const role of ['requester', 'operator']) {
    const f = setup({current: account({device_id: null, key_id: null, role: null, recovery_generation: Number.MAX_SAFE_INTEGER})});
    const state = await f.workflow.begin(role);
    assert.equal(state.binding.role, role);
    assert.equal(state.binding.recovery_generation, Number.MAX_SAFE_INTEGER);
  }
  await assert.rejects(setup({current: account({roles: ['R']})}).workflow.begin('operator'));
  for (const value of [-1, Number.MAX_SAFE_INTEGER + 1, '9223372036854775807', 0.25]) {
    await assert.rejects(setup({current: account({recovery_generation: value})}).workflow.begin('requester'));
  }
});

test('processing and retention are independent, and arbitrary real-media payloads are refused', async () => {
  const {workflow: w, storage} = setup(); await w.begin('requester');
  await assert.rejects(w.select('face_front', 'face_a'), /Processing consent/);
  await w.setConsent({processing: true, retention: false});
  await w.select('document_front', 'document_a'); await w.select('face_front', 'face_a');
  await assert.rejects(w.review({deliberate: true}), /consent choices/);
  await assert.rejects(w.select('face_front', {synthetic: true, data_url: 'real-file-bytes'}), /bundled synthetic/);
  await assert.rejects(w.select('document_front', 'face_a'), /Wrong synthetic/);
  assert.equal(storage.values.size, 0);
});

test('both roles review/retain only fixed selected illustrations with no assurance or authority claim', async () => {
  for (const role of ['operator', 'requester']) {
    const f = setup(); await reviewed(f.workflow, role);
    await assert.rejects(f.workflow.retain(), /deliberate/);
    const state = await f.workflow.retain({deliberate: true});
    assert.equal(state.status, 'retained'); assert.equal(state.items.length, 2);
    assert.ok(f.workflow.preview('document_front').startsWith('data:image/svg+xml'));
    assert.ok(!JSON.stringify(state).includes('data:image'));
    assert.equal(state.movement_check, 'not_performed'); assert.equal(state.liveness, 'not_evaluated');
    assert.equal(state.verification.status, 'pending'); assert.equal(state.verification.decision, null);
    for (const key of ['identity_verified', 'genuine_authentication', 'signing_authority', 'work_resumed', 'sensors_requested']) assert.equal(state[key], false);
  }
  assert.deepEqual(ENROLLMENT_GUIDANCE, ['up', 'down', 'left', 'right', 'front']);
  assert.equal(SYNTHETIC_ENROLLMENT_MEDIA.length, 4);
});

test('retake and consent edits invalidate exact review; reset/cancel never silently deletes retained data', async () => {
  const {workflow: w, storage} = setup(); await reviewed(w);
  await w.retain({deliberate: true}); const saved = [...storage.values.values()];
  await w.select('face_front', 'face_b');
  assert.equal(w.snapshot().reviewed_revision, null);
  await assert.rejects(w.retain({deliberate: true}));
  await w.review({deliberate: true});
  await w.setConsent({processing: true, retention: false});
  await assert.rejects(w.review({deliberate: true}));
  const cancelled = w.cancel();
  assert.equal(cancelled.status, 'cancelled'); assert.deepEqual(cancelled.items, []);
  assert.equal(cancelled.reviewed_revision, null); assert.deepEqual([...storage.values.values()], saved);
});

test('reopening retained selections revalidates authority and requires a fresh review', async () => {
  const storage = memory(), first = setup({storage}); await reviewed(first.workflow);
  await first.workflow.retain({deliberate: true});
  const second = setup({storage}); const state = await second.workflow.restore('operator');
  assert.equal(state.items.length, 2); assert.equal(state.status, 'incomplete');
  assert.equal(state.reviewed_revision, null);
  await assert.rejects(second.workflow.submit({deliberate: true}));
  await second.workflow.review({deliberate: true}); await second.workflow.retain({deliberate: true});
  assert.equal((await second.workflow.submit({deliberate: true})).status, 'submitted');
  assert.equal((await second.workflow.refreshStatus()).status, 'pending');
});

test('account, role and recovery namespaces prevent another context reading saved selections', async () => {
  const storage = memory(), first = setup({storage}); await reviewed(first.workflow);
  await first.workflow.retain({deliberate: true});
  const foreign = setup({storage, current: account({account_id: 'account-b', principal_id: 'principal-b'})});
  assert.deepEqual((await foreign.workflow.restore('operator')).items, []);
  assert.deepEqual((await setup({storage}).workflow.restore('requester')).items, []);
  assert.deepEqual((await setup({storage, current: account({recovery_generation: 1})}).workflow.restore('operator')).items, []);
});

test('switching account, session, recovery generation or signing out invalidates live review', async () => {
  for (const replacement of [account({account_id: 'account-b'}), account({current_session_id: 'session-b'}),
    account({recovery_generation: 1}), null]) {
    const f = setup(); await reviewed(f.workflow); f.setAccount(replacement);
    await assert.rejects(f.workflow.retain({deliberate: true}));
    const state = f.workflow.snapshot();
    assert.equal(state.binding, null); assert.deepEqual(state.items, []); assert.equal(state.reviewed_revision, null);
    assert.equal(f.storage.values.size, 0);
    await assert.rejects(f.workflow.select('face_front', 'face_b'), /Begin enrollment/);
  }
});

test('cancel fences a delayed account response without opening a sensor or retaining anything', async () => {
  const gate = deferred(), storage = memory();
  const w = new SyntheticEnrollmentWorkflow({getAccount: () => gate.promise, store: createSyntheticEnrollmentStore(storage)});
  const opening = w.begin('operator'); w.cancel(); gate.resolve(account());
  await assert.rejects(opening, /Stale/);
  assert.equal(w.snapshot().status, 'cancelled'); assert.equal(w.snapshot().binding, null);
  assert.equal(storage.values.size, 0);
});

test('a lost response stays unknown and resolves by original receipt lookup after reopening', async () => {
  const f = setup({wrapStore: store => ({...store, async submit(record, options) {
    await store.submit(record, options); throw new Error('Lost response after commit.');
  }})});
  await reviewed(f.workflow); await f.workflow.retain({deliberate: true});
  await assert.rejects(f.workflow.submit({deliberate: true}), /Lost response/);
  assert.equal(f.workflow.snapshot().status, 'submission_unknown');
  await assert.rejects(f.workflow.select('face_front', 'face_b'), /Resolve the original/);
  const second = setup({storage: f.storage});
  assert.equal((await second.workflow.restore('operator')).status, 'submission_unknown');
  const resolved = await second.workflow.refreshStatus();
  assert.equal(resolved.status, 'pending'); assert.equal(resolved.receipt.custody, 'synthetic_local_fixture');
  assert.equal(resolved.verification.decision, null);
});

test('late submission after cancellation cannot overwrite unknown status; original lookup resolves it', async () => {
  const started = deferred(), finish = deferred();
  const f = setup({wrapStore: store => ({...store, async submit(record) {
    const receipt = await store.submit(record); started.resolve(); await finish.promise; return receipt;
  }})});
  await reviewed(f.workflow); await f.workflow.retain({deliberate: true});
  const submitting = f.workflow.submit({deliberate: true}); await started.promise;
  f.workflow.cancel(); finish.resolve();
  await assert.rejects(submitting, /Stale/); assert.equal(f.workflow.snapshot().status, 'submission_unknown');
  assert.equal((await f.workflow.refreshStatus()).status, 'pending');
});

test('exact operation replay returns its receipt and changed bytes conflict instead of overwriting it', async () => {
  const f = setup(); await reviewed(f.workflow); await f.workflow.retain({deliberate: true});
  const record = await f.store.load(f.workflow.snapshot().binding);
  const original = await f.store.submit(record); assert.deepEqual(await f.store.submit(record), original);
  const envelope = JSON.parse(record.envelope_json); envelope.items[1] = SYNTHETIC_ENROLLMENT_MEDIA.find(item => item.fixture_id === 'face_b');
  const json = JSON.stringify(envelope), bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  const hash = Buffer.from(bytes).toString('hex');
  await assert.rejects(f.store.submit({...record, envelope_json: json, sha256: hash}), /Invalid synthetic receipt/);
  assert.deepEqual(await f.store.lookup(record), original);
});

test('stored notice/media tampering and fabricated verification receipts fail closed', async () => {
  const f = setup(); await reviewed(f.workflow); await f.workflow.retain({deliberate: true});
  const [key, text] = [...f.storage.values.entries()][0], record = JSON.parse(text);
  const envelope = JSON.parse(record.envelope_json); envelope.notice.text = 'Replaced notice'; record.envelope_json = JSON.stringify(envelope);
  f.storage.setItem(key, JSON.stringify(record));
  await assert.rejects(setup({storage: f.storage}).workflow.restore('operator'), /changed enrollment/);
  const fake = setup({wrapStore: store => ({...store, async submit(value, options) {
    return {...await store.submit(value, options), verification: 'verified', decision: 'approved'};
  }})});
  await reviewed(fake.workflow); await fake.workflow.retain({deliberate: true});
  await assert.rejects(fake.workflow.submit({deliberate: true}), /no verification decision/);
  assert.equal(fake.workflow.snapshot().identity_verified, false);
});

test('delete has an honest failure path and removes retained fixtures without claiming receipt erasure', async () => {
  let refuse = true;
  const f = setup({wrapStore: store => ({...store, async remove(binding, options) {
    if (refuse) throw new Error('Storage unavailable.'); return store.remove(binding, options);
  }})});
  await reviewed(f.workflow); await f.workflow.retain({deliberate: true}); await f.workflow.submit({deliberate: true});
  const receipt = f.workflow.snapshot().receipt;
  await assert.rejects(f.workflow.deleteRetained({deliberate: true}), /Storage unavailable/);
  refuse = false; await f.workflow.deleteRetained({deliberate: true});
  assert.deepEqual((await setup({storage: f.storage}).workflow.restore('operator')).items, []);
  assert.equal(f.storage.values.size, 1); assert.ok([...f.storage.values.values()][0].includes(receipt.sha256));
  assert.ok(![...f.storage.values.values()][0].includes('data:image'));
});

test('arbitrary account-adapter secrets and snapshot mutations never enter retained data', async () => {
  const f = setup({current: account({password: 'DO-NOT-STORE', access_token: 'DO-NOT-STORE', email: 'DO-NOT-STORE'})});
  const state = await reviewed(f.workflow); state.binding.account_id = 'mutation'; state.notice.text = 'mutation';
  await f.workflow.retain({deliberate: true});
  const text = [...f.storage.values.values()].join('');
  assert.ok(!text.includes('DO-NOT-STORE')); assert.ok(!text.includes('mutation'));
});

test('a stale retained view cannot overwrite or delete a newer selected revision', async () => {
  const first = setup(); await reviewed(first.workflow); await first.workflow.retain({deliberate: true});
  const stale = setup({storage: first.storage}); await stale.workflow.restore('operator');
  await first.workflow.select('face_front', 'face_b'); await first.workflow.review({deliberate: true});
  await first.workflow.retain({deliberate: true});
  await assert.rejects(stale.workflow.deleteRetained({deliberate: true}), /changed/);
  await stale.workflow.review({deliberate: true});
  await assert.rejects(stale.workflow.retain({deliberate: true}), /changed/);
});

test('account switching while a submission response is delayed cannot grant the new account the old receipt', async () => {
  const started = deferred(), finish = deferred();
  const f = setup({wrapStore: store => ({...store, async submit(record) {
    const receipt = await store.submit(record); started.resolve(); await finish.promise; return receipt;
  }})});
  await reviewed(f.workflow); await f.workflow.retain({deliberate: true});
  const submitting = f.workflow.submit({deliberate: true}); await started.promise;
  f.setAccount(account({account_id: 'account-b', principal_id: 'principal-b'})); finish.resolve();
  await assert.rejects(submitting, /changed/);
  assert.equal(f.workflow.snapshot().binding, null); assert.equal(f.workflow.snapshot().receipt, null);
  const original = setup({storage: f.storage}); await original.workflow.restore('operator');
  assert.equal((await original.workflow.refreshStatus()).status, 'pending');
});
