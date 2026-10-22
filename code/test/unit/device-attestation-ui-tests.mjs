// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDeveloperAttestationToken, createDeveloperAttestationSession,
  createDeveloperAttestationLifecycle, saveDeveloperAttestationRecord} from '../../../web/apps/non-verba-dev/src/keys/device-attestation-ui.js';

const time = 1792663258, scope = '0123456789abcdef0123456789abcdef';
const id = Buffer.alloc(32, 3).toString('base64url'), random = Buffer.alloc(32, 7).toString('base64url');
const token = 'NVAT1.' + scope + '.' + time + '.' + id + '.' + random;
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(platform = 'android') {
  let requests = 0, cancels = 0, signal, release;
  const held = new Promise(resolve => { release = resolve; });
  const tool = {platform, async prove(request, options) { requests++; signal = options.signal; await held; return {platform, name: 'Synthetic device',
    public_spki_der_b64: Buffer.alloc(91, 1).toString('base64'), signature_b64: Buffer.alloc(64, 2).toString('base64'), attestation_chain: null}; }, cancel() { cancels++; }};
  const states = [], session = createDeveloperAttestationSession(tool, {clock: () => time, onChange: state => states.push(state)});
  return {session, states, release, get requests() { return requests; }, get cancels() { return cancels; }, get signal() { return signal; }};
}

test('compact host token reconstructs the exact closed profile without renewing its time', () => {
  assert.ok(token.length <= 200);
  assert.deepEqual(parseDeveloperAttestationToken(token, {platform: 'android', nowSeconds: time + 10}), {
    challenge_id: id, account_id: 'dev-tool:attestation:' + scope, current_session_id: 'dev-tool-session:' + id,
    recovery_generation: 0, platform: 'android', issued_at: time, expires_at: time + 120,
    challenge_b64: Buffer.alloc(32, 7).toString('base64')});
});

test('token parser rejects malformed, oversized, noncanonical and out-of-window requests', () => {
  for (const value of [null, '', token + ' ', ' ' + token, token.replace('NVAT1', 'NVAT2'), token.replace(scope, scope.toUpperCase()),
    token.replace('.' + time + '.', '.0' + time + '.'), token.replace(id, id.slice(0, -1)), token.replace(id, 'A'.repeat(42) + 'B'),
    'x'.repeat(201), token.replace('.' + time + '.', '.9007199254740991.')]) {
    assert.throws(() => parseDeveloperAttestationToken(value, {platform: 'android', nowSeconds: time}));
  }
  assert.throws(() => parseDeveloperAttestationToken(token, {platform: 'android', nowSeconds: time + 120}));
  assert.throws(() => parseDeveloperAttestationToken(token, {platform: 'android', nowSeconds: time - 31}));
  assert.throws(() => parseDeveloperAttestationToken(token, {platform: 'other', nowSeconds: time}));
});

test('loading a request performs no proof operation and browser proving is explicitly unavailable', async () => {
  const f = fixture('browser'); f.session.load(token);
  assert.equal(f.requests, 0); assert.equal(f.session.snapshot().request.platform, 'browser');
  await assert.rejects(f.session.prove(), /requires the developer Android app/); assert.equal(f.requests, 0);
});

test('proof export retains the exact original and never asserts local hardware attestation', async () => {
  const f = fixture(), original = f.session.load(token), pending = f.session.prove(); await tick();
  assert.equal(f.requests, 1); assert.equal(f.session.snapshot().busy, true);
  f.release(); const result = await pending;
  assert.deepEqual(Object.keys(result).sort(), ['hardware_attested', 'proof', 'purpose', 'request', 'type', 'version']);
  assert.equal(result.request, original); assert.equal(result.type, 'nonverba-device-attestation-proof');
  assert.equal(result.hardware_attested, false); assert.equal(result.purpose, 'signin-device');
  assert.equal(f.session.snapshot().busy, false);
});

test('cancellation revokes the exact operation and a delayed proof cannot become the selected export', async () => {
  const f = fixture(); f.session.load(token); const pending = f.session.prove(); await tick();
  f.session.cancel(); assert.equal(f.signal.aborted, true); assert.equal(f.cancels, 1);
  f.release(); assert.equal(await pending, null); assert.equal(f.session.snapshot().proof, null);
  assert.match(f.session.snapshot().message, /cancelled/);
});

test('editing or replacing the request invalidates earlier proof selection and preserves scope semantics', async () => {
  const f = fixture(); f.session.load(token); const pending = f.session.prove(); await tick();
  f.session.reset(); assert.equal(f.signal.aborted, true); assert.equal(f.session.snapshot().request, null);
  const later = f.session.load(token.replace(id, Buffer.alloc(32, 4).toString('base64url')));
  f.release(); assert.equal(await pending, null); assert.equal(f.session.snapshot().proof, null);
  assert.equal(later.account_id, 'dev-tool:attestation:' + scope);
  assert.equal(later.issued_at, time); assert.equal(later.expires_at, time + 120);
});

test('invalid loads cannot leave an earlier request or proof actionable', () => {
  const f = fixture(); f.session.load(token); assert.throws(() => f.session.load('invalid'));
  assert.equal(f.session.snapshot().request, null); assert.equal(f.session.snapshot().proof, null);
});

test('restoring a cached developer page replaces the closed tool without automatic proof or request renewal', async () => {
  let created = 0, calls = 0;
  const lifecycle = createDeveloperAttestationLifecycle({createTool() {
    const generation = ++created; let closed = false;
    return {platform: 'android', close() { closed = true; }, cancel() {}, status: () => ({state: closed ? 'closed' : 'idle'}),
      async prove(request) { if (closed) throw new Error('Closed tool used.'); calls++; return {generation}; }};
  }});
  const session = createDeveloperAttestationSession(lifecycle.tool, {clock: () => time});
  const request = session.load(token), initial = await session.prove();
  assert.equal(initial.proof.generation, 1); assert.equal(calls, 1);
  lifecycle.close(); assert.equal(lifecycle.restore(), true);
  assert.equal(created, 2); assert.equal(calls, 1); assert.equal(session.snapshot().request, request);
  assert.equal(lifecycle.restore(), false); assert.equal(created, 2);
  const next = await session.prove(); assert.equal(next.proof.generation, 2); assert.equal(calls, 2);
  assert.equal(next.request.issued_at, time); assert.equal(next.request.expires_at, time + 120);
});

test('native exports preserve exact JSON, fixed UUID filenames and request/proof byte bounds', async () => {
  const calls = [], uuid = '12345678-1234-4123-8123-123456789abc';
  const scope = {crypto: {randomUUID: () => uuid}, NativeVault: {saveArtifact(...args) { calls.push(args); return true; }}};
  const request = parseDeveloperAttestationToken(token, {platform: 'android', nowSeconds: time});
  await saveDeveloperAttestationRecord('request', request, scope);
  assert.equal(calls[0][0], 'nonverba-device-attestation-request-' + uuid + '.json');
  assert.equal(calls[0][1], 'application/json'); assert.deepEqual(JSON.parse(Buffer.from(calls[0][2], 'base64').toString()), request);
  const proof = {type: 'nonverba-device-attestation-proof', version: 1, purpose: 'signin-device', request,
    proof: {attestation_chain: null}, hardware_attested: false};
  await saveDeveloperAttestationRecord('proof', proof, scope);
  assert.equal(calls[1][0], 'nonverba-device-attestation-proof-' + uuid + '.json');
  assert.deepEqual(JSON.parse(Buffer.from(calls[1][2], 'base64').toString()), proof);
  await assert.rejects(saveDeveloperAttestationRecord('request', 'x'.repeat(4096), scope), /export limit/);
  await assert.rejects(saveDeveloperAttestationRecord('proof', 'x'.repeat(192 * 1024), scope), /export limit/);
  assert.equal(calls.length, 2);
});
