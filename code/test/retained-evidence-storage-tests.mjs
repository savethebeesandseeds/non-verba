// SPDX-License-Identifier: AGPL-3.0-only
// Real shipped Rust/WASM over synthetic camera bytes/clocks, with a Node
// IndexedDB transaction double. Browser persistence is covered separately.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {loadShippedCore} from '../tools/image-requester-session.mjs';

const databases = new Map();
function database() {
  return {stores: new Map(), createObjectStore(name) { this.stores.set(name, new Map()); }, close() {},
    transaction(names, mode = 'readonly') {
      names = Array.isArray(names) ? names : [names];
      const working = new Map(names.map(name => [name, structuredClone(this.stores.get(name))]));
      const db = this, tx = {pending: 0, ended: false,
        abort() { if (this.ended) return; this.ended = true; setImmediate(() => this.onabort?.()); },
        objectStore(name) { return {
          get: key => operation(() => structuredClone(working.get(name).get(key))),
          add: (value, key) => operation(() => {
            if (working.get(name).has(key)) throw new Error('ConstraintError');
            working.get(name).set(key, structuredClone(value));
          }),
          put: (value, key) => operation(() => working.get(name).set(key, structuredClone(value)))
        }; }
      };
      function operation(body) {
        const request = {}; tx.pending++;
        setImmediate(() => {
          if (tx.ended) return;
          try { request.result = body(); request.onsuccess?.(); }
          catch (error) { tx.error = error; tx.abort(); }
          finally {
            tx.pending--;
            if (tx.pending === 0 && !tx.ended) {
              tx.ended = true;
              if (mode === 'readwrite') for (const [name, value] of working) db.stores.set(name, value);
              tx.oncomplete?.();
            }
          }
        });
        return request;
      }
      return tx;
    }
  };
}
globalThis.indexedDB = {open(name) {
  const first = !databases.has(name);
  if (first) databases.set(name, database());
  const request = {result: databases.get(name)};
  setImmediate(() => { if (first) request.onupgradeneeded?.(); request.onsuccess?.(); });
  return request;
}};
globalThis.crypto ??= webcrypto;
globalThis.document = Object.assign(new EventTarget(), {hidden: false});
globalThis.window = Object.assign(new EventTarget(), {crypto: globalThis.crypto});
const storage = await import('../../web/src/agent-evidence-storage.js');
const {AgentRequester} = await import('../../web/src/agent-requester.js');
const {core} = await loadShippedCore();
const operator = core.create_identity(), requester = core.create_identity();
const mediaPin = JSON.parse(operator).fingerprint;
const requesterPin = JSON.parse(core.live_requester_identity(requester)).pin.sha256;
const engine = {
  call: async (name, ...args) => name === 'create_identity' ? requester : core[name](...args),
  json: async (name, ...args) => JSON.parse(await core[name](...args))
};
const jpeg = new Uint8Array(await readFile(new URL('../artifacts/qa/native-camera-synthetic.jpg', import.meta.url)));
let wall = 1800000000500;
const originalNow = Date.now; Date.now = () => wall;
process.once('exit', () => { Date.now = originalNow; });
const now = () => Math.floor(wall / 1000);
const records = name => databases.get('nonverba-agent-evidence-v1').stores.get(name);
async function fixture() {
  wall += 10000;
  const challenge = JSON.parse(core.create_challenge('Synthetic requester', 'Retained receipt test', now(), 300));
  const spec = {version: 1, evidence: {type: 'image', request: challenge},
    operator_pins: {media_certificate_sha256: mediaPin, location_spki_sha256: null},
    policy: {version: 1, native_acquisition_required: false, raw_gnss_required: false,
      correlated_camera_clock_required: false, hardware_attestation_required: false, independent_position_required: false},
    delivery: {max_response_ms: 180000, max_receipt_age_ms: 60000}};
  const original = core.create_evidence_session_request(JSON.stringify(spec), requester, now());
  const request = JSON.parse(core.validate_evidence_session_request(original, requesterPin, JSON.stringify(spec.operator_pins), now()));
  const primary = await core.seal_image(jpeg, JSON.stringify(challenge), operator, now(), JSON.stringify({latitude: 0, longitude: 0,
    accuracy_m: 5, altitude_m: null, altitude_accuracy_m: null, timestamp_ms: wall, source: 'device-geolocation'}));
  const timing = {sent_at_ms: wall, received_at_ms: wall + 100, elapsed_ms: 100}; wall += 100;
  const secondary = new Uint8Array(), context = '{"version":1}';
  const receipt = await core.seal_evidence_session_receipt(original, primary, secondary, '', JSON.stringify(timing), requester, requesterPin, context, now());
  await storage.reserveEvidenceSession({session_id: request.session_id, sensor_nonce: request.sensor_nonce,
    original_request: original, requester_pin: requesterPin, context_json: context});
  await storage.retainEvidenceOutcome(request.session_id, original, {primary, secondary, audio_transcript_json: '', receipt});
  return request.session_id;
}

test('retained inspection rejects missing, incomplete, abandoned and different-requester records', async () => {
  const client = new AgentRequester(engine);
  try {
    await assert.rejects(client.inspectRetained('00'.repeat(32)), /No completed evidence/);
    const id = await fixture(), original = structuredClone(records('tasks').get(id));
    for (const patch of [{state: 'awaiting'}, {state: 'abandoned'}, {requester_pin: 'ab'.repeat(32)}]) {
      records('tasks').set(id, {...original, ...patch});
      await assert.rejects(client.inspectRetained(id), /No completed evidence/);
    }
    records('tasks').set(id, original); records('outcomes').delete(id);
    await assert.rejects(client.inspectRetained(id), /No completed evidence/);
  } finally { client.close(); }
});

test('a new requester instance re-verifies completed bytes and retains acceptance without reviving the session', async () => {
  const id = await fixture(), first = new AgentRequester(engine);
  const originalTask = structuredClone(records('tasks').get(id));
  const before = await first.inspectRetained(id);
  assert.equal(before.report.verified, true); assert.equal(before.acceptance, null);
  const accepted = await first.accept(id); first.close();
  const reopened = new AgentRequester(engine);
  try {
    const result = await reopened.inspectRetained(id);
    assert.equal(result.report.verified, true); assert.equal(result.report.fresh_action_eligible, true);
    assert.equal(result.report.acceptance_recorded, false); assert.equal(result.report.global_replay_checked, false);
    assert.equal(result.report.physical_measurement_authenticity_proven, false);
    assert.deepEqual(result.acceptance, accepted);
    await assert.rejects(reopened.accept(id), /ConstraintError/);
    await assert.rejects(reopened.receive(id, {primary: new Uint8Array()}), /Unexpected or repeated/);
  } finally { reopened.close(); }
  assert.deepEqual(records('tasks').get(id), originalTask);
});

test('historical inspection preserves local acceptance but never renews freshness', async () => {
  for (const acceptFirst of [false, true]) {
    const id = await fixture(), client = new AgentRequester(engine);
    try {
      const accepted = acceptFirst ? await client.accept(id) : null;
      wall += 301000;
      const result = await client.inspectRetained(id);
      assert.equal(result.report.verified, true); assert.equal(result.report.fresh_action_eligible, false);
      assert.deepEqual(result.acceptance, accepted);
      await assert.rejects(client.accept(id), /fresh action policy/);
    } finally { client.close(); }
  }
});

test('retained verification ignores cached verdicts and detects changed raw artifacts', async () => {
  const id = await fixture(), client = new AgentRequester(engine);
  try {
    const outcome = records('outcomes').get(id);
    outcome.report = {verified: true, fresh_action_eligible: true};
    outcome.primary[outcome.primary.length - 1] ^= 1;
    const result = await client.inspectRetained(id);
    assert.equal(result.report.verified, false); assert.equal(result.acceptance, null);
    await assert.rejects(client.accept(id), /fresh action policy/);
  } finally { client.close(); }
});

test('both local acceptance keys must match the freshly verified session, bindings and original window', async () => {
  const id = await fixture(), client = new AgentRequester(engine);
  try {
    const accepted = await client.accept(id), store = records('accepted');
    const sessionKey = `session:${id}`, challengeKey = `challenge:${accepted.sensor_nonce}`;
    const mutations = [
      value => { value.session_id = 'ab'.repeat(32); },
      value => { value.sensor_nonce = 'ab'.repeat(32); },
      value => { value.primary_binding.sha256 = 'ab'.repeat(32); },
      value => { value.context_binding.bytes++; },
      value => { value.request_binding.sha256 = 'ab'.repeat(32); },
      value => { value.global_replay_checked = true; },
      value => { value.accepted_at_ms += 301000; }
    ];
    for (const mutate of mutations) {
      const bad = structuredClone(accepted); mutate(bad);
      store.set(sessionKey, structuredClone(bad)); store.set(challengeKey, structuredClone(bad));
      await assert.rejects(client.inspectRetained(id), /local acceptance record/);
    }
    store.set(sessionKey, structuredClone(accepted)); store.delete(challengeKey);
    await assert.rejects(client.inspectRetained(id), /local acceptance record/);
    store.set(challengeKey, structuredClone(accepted)); store.delete(sessionKey);
    await assert.rejects(client.inspectRetained(id), /local acceptance record/);
    store.set(sessionKey, structuredClone(accepted));
    records('outcomes').get(id).primary[0] ^= 1;
    await assert.rejects(client.inspectRetained(id), /local acceptance record/);
  } finally { client.close(); }
});

test('closed or hidden requester cannot inspect, including closure during identity or verification', async () => {
  const id = await fixture(), originalTask = structuredClone(records('tasks').get(id));
  const closed = new AgentRequester(engine); closed.close();
  await assert.rejects(closed.inspectRetained(id), /no longer active/);
  const hidden = new AgentRequester(engine); document.hidden = true;
  try { await assert.rejects(hidden.inspectRetained(id), /no longer active/); }
  finally { document.hidden = false; hidden.close(); }
  for (const method of ['live_requester_identity', 'verify_evidence_session_receipt']) {
    let release, entered;
    const gate = new Promise(resolve => { release = resolve; }), signal = new Promise(resolve => { entered = resolve; });
    const held = {...engine, json: async (name, ...args) => {
      const report = await engine.json(name, ...args);
      if (name === method) { entered(); await gate; }
      return report;
    }};
    const client = new AgentRequester(held), pending = client.inspectRetained(id);
    await signal; window.dispatchEvent(new Event('pagehide')); release();
    await assert.rejects(pending, /no longer active/); client.close();
  }
  assert.deepEqual(records('tasks').get(id), originalTask);
});
