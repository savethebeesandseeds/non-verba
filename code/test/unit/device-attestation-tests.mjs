// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createDeviceAttestationTool} from '../../../web/shared/identity/device-attestation.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const reject = (promise, code) => assert.rejects(promise, error => error.code === code);
const b64 = value => Buffer.from(value).toString('base64');
const now = 1792663258;
const fields = ['challenge_id', 'account_id', 'current_session_id', 'recovery_generation',
  'platform', 'issued_at', 'expires_at', 'challenge_b64'];
function challenge(platform = 'browser', change = {}) {
  return {challenge_id: Buffer.alloc(32, 7).toString('base64url'), account_id: 'account:test',
    current_session_id: 'session:test', recovery_generation: 0, platform, issued_at: now,
    expires_at: now + 120, challenge_b64: b64(Buffer.alloc(32, 9)), ...change};
}
function fixture({native = false, crypto = webcrypto} = {}) {
  const events = new Map(), timers = new Map(), sent = [];
  let nextTimer = 0, seconds = now;
  const scope = {crypto, Date: {now: () => seconds * 1000},
    addEventListener: (name, listener) => events.set(name, listener),
    removeEventListener: (name, listener) => { if (events.get(name) === listener) events.delete(name); },
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: id => timers.delete(id)};
  if (native) scope.NonverbaLoginDevice = {postMessage: text => sent.push(JSON.parse(text))};
  const tool = createDeviceAttestationTool({scope});
  return {tool, scope, sent, events, timers, advance: value => { seconds += value; },
    respond: value => scope.NonverbaLoginDevice.onmessage({data: JSON.stringify(value)})};
}
async function nativeProof() {
  const key = await webcrypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign', 'verify']);
  return {public_spki_der_b64: b64(await webcrypto.subtle.exportKey('spki', key.publicKey)),
    signature_b64: b64(Buffer.alloc(64, 3)), attestation_chain: null, platform: 'android', name: 'Synthetic Android'};
}

test('standalone browser tool signs the fixed original challenge with a nonextractable document key', async t => {
  const generated = [];
  const subtle = new Proxy(webcrypto.subtle, {get(target, property) {
    if (property === 'generateKey') return async (...args) => { const pair = await target.generateKey(...args); generated.push(pair); return pair; };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  }});
  const f = fixture({crypto: {randomUUID: () => webcrypto.randomUUID(), subtle}}); t.after(() => f.tool.close());
  assert.deepEqual(await f.tool.capabilities(), {version: 1, purpose: 'signin-device', available: true,
    platform: 'browser', name: 'Browser session', key_storage: 'document-memory', hardware_attestation: 'unsupported'});
  const original = challenge(), result = await f.tool.prove(original);
  assert.equal(result.attestation_chain, null);
  assert.equal(generated.length, 1); assert.equal(generated[0].privateKey.extractable, false);
  const key = await webcrypto.subtle.importKey('spki', Buffer.from(result.public_spki_der_b64, 'base64'),
    {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
  const transcript = value => new TextEncoder().encode('NONVERBA:SIGNIN_DEVICE:v1\n' + fields.map(name => value[name]).join('\n') + '\n');
  assert.equal(await webcrypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, key,
    Buffer.from(result.signature_b64, 'base64'), transcript(original)), true);
  assert.equal(await webcrypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, key,
    Buffer.from(result.signature_b64, 'base64'), transcript({...original, current_session_id: 'session:other'})), false);
  const again = await f.tool.prove(challenge('browser', {challenge_id: Buffer.alloc(32, 8).toString('base64url')}));
  assert.equal(again.public_spki_der_b64, result.public_spki_der_b64);
  const other = await f.tool.prove(challenge('browser', {account_id: 'account:other'}));
  assert.notEqual(other.public_spki_der_b64, result.public_spki_der_b64);
});

test('the closed purpose profile rejects arbitrary signing, malformed fields, expiry and cross-platform inputs', async t => {
  const f = fixture(); t.after(() => f.tool.close());
  const invalid = [null, {}, {...challenge(), arbitrary_bytes: 'payload'}, {...challenge(), account_id: ''},
    {...challenge(), current_session_id: 'bad\ncontext'}, {...challenge(), challenge_id: 'not-a-random-token'},
    {...challenge(), challenge_b64: b64(Buffer.alloc(31))}, {...challenge(), recovery_generation: -1},
    {...challenge(), recovery_generation: 1.1}, {...challenge(), expires_at: now},
    {...challenge(), expires_at: now + 121}, {...challenge(), issued_at: now + 31, expires_at: now + 120}, challenge('android')];
  for (const value of invalid) await reject(f.tool.prove(value), 'attestation_invalid');
  assert.equal(f.timers.size, 0);
});

test('browser proof freezes original input before asynchronous generation', async t => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const subtle = new Proxy(webcrypto.subtle, {get(target, property) {
    if (property === 'generateKey') return async (...args) => { await held; return target.generateKey(...args); };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  }});
  const f = fixture({crypto: {randomUUID: () => webcrypto.randomUUID(), subtle}}); t.after(() => f.tool.close());
  const input = challenge(), original = {...input}, pending = f.tool.prove(input);
  input.account_id = 'account:injected'; input.challenge_b64 = b64(Buffer.alloc(32, 12));
  await tick(); release();
  const result = await pending, key = await webcrypto.subtle.importKey('spki', Buffer.from(result.public_spki_der_b64, 'base64'),
    {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
  assert.equal(await webcrypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, key,
    Buffer.from(result.signature_b64, 'base64'), new TextEncoder().encode('NONVERBA:SIGNIN_DEVICE:v1\n' + fields.map(name => original[name]).join('\n') + '\n')), true);
});

test('native capability discovery distinguishes availability from verified hardware', async t => {
  const f = fixture({native: true}); t.after(() => f.tool.close());
  const result = f.tool.capabilities(); await tick();
  assert.equal(f.sent[0].config, true);
  f.respond({id: f.sent[0].id, capabilities: {available: true, platform: 'android', version: 1, name: 'Synthetic Android'}});
  assert.deepEqual(await result, {version: 1, purpose: 'signin-device', available: true, platform: 'android',
    name: 'Synthetic Android', key_storage: 'android-keystore', hardware_attestation: 'unverified'});
});

test('native proof shape rejects forged assurance, wrong platforms, excessive chains and malformed encodings', async t => {
  const f = fixture({native: true}), proof = await nativeProof(); t.after(() => f.tool.close());
  const cases = [null, {...proof, hardware_attested: true}, {...proof, platform: 'browser'}, {...proof, name: 'hidden\nlabel'},
    {...proof, signature_b64: b64(Buffer.alloc(63))}, {...proof, public_spki_der_b64: 'invalid'},
    {...proof, attestation_chain: {version: 1, certificates_der_b64: [b64(Buffer.alloc(1))]}},
    {...proof, attestation_chain: {version: 1, certificates_der_b64: [b64(Buffer.alloc(2)), b64(Buffer.alloc(2))]}},
    {...proof, attestation_chain: {version: 1, certificates_der_b64: Array.from({length: 4}, (_, i) => b64(Buffer.alloc(32 * 1024, i)))}}];
  for (const value of cases) {
    const pending = f.tool.prove(challenge('android')); await tick();
    f.respond({id: f.sent.at(-1).id, proof: value}); await reject(pending, 'attestation_invalid_response');
  }
  const pending = f.tool.prove(challenge('android')); await tick(); f.respond({id: f.sent.at(-1).id, proof});
  assert.deepEqual(await pending, proof);
});

test('abort cancels the exact native request, ignores late results and allows a fresh operation', async t => {
  const f = fixture({native: true}), proof = await nativeProof(); t.after(() => f.tool.close());
  const controller = new AbortController(), pending = f.tool.prove(challenge('android'), {signal: controller.signal});
  const refused = reject(pending, 'attestation_cancelled'); await tick();
  const request = f.sent[0]; controller.abort(); await refused;
  assert.equal(f.sent[1].cancel, request.id); assert.notEqual(f.sent[1].id, request.id);
  assert.equal(f.tool.status().state, 'idle'); assert.equal(f.timers.size, 0);
  const next = f.tool.prove(challenge('android')); await tick();
  f.respond({id: request.id, proof: {...proof, name: 'Stale result'}});
  f.respond({id: f.sent.at(-1).id, proof}); assert.equal((await next).name, proof.name);
});

test('timeout requests native cancellation and cannot publish its late result', async t => {
  const f = fixture({native: true}); t.after(() => f.tool.close());
  const pending = f.tool.prove(challenge('android')), refused = reject(pending, 'attestation_timeout'); await tick();
  const request = f.sent[0]; [...f.timers.values()][0](); await refused;
  assert.equal(f.sent.at(-1).cancel, request.id); assert.equal(f.timers.size, 0);
  f.respond({id: request.id, proof: await nativeProof()}); assert.equal(f.tool.status().state, 'idle');
});

test('concurrent calls are refused without creating a second native operation', async t => {
  const f = fixture({native: true}); t.after(() => f.tool.close());
  const pending = f.tool.prove(challenge('android')); await tick();
  await reject(f.tool.prove(challenge('android')), 'attestation_busy');
  await reject(f.tool.capabilities(), 'attestation_busy'); assert.equal(f.sent.length, 1);
  const refused = reject(pending, 'attestation_cancelled'); f.tool.cancel(); await refused;
});

test('pagehide permanently closes the tool, revokes pending work and releases its bridge lease', async () => {
  const f = fixture({native: true}), pending = f.tool.prove(challenge('android'));
  const refused = reject(pending, 'attestation_cancelled'); await tick();
  assert.throws(() => createDeviceAttestationTool({scope: f.scope}), error => error.code === 'attestation_busy');
  f.events.get('pagehide')(); await refused; assert.equal(f.sent.at(-1).cancel, f.sent[0].id);
  assert.equal(f.tool.status().state, 'closed'); assert.equal(f.events.size, 0);
  await reject(f.tool.prove(challenge('android')), 'attestation_closed');
  await reject(f.tool.describe(), 'attestation_closed');
  const replacement = createDeviceAttestationTool({scope: f.scope}); replacement.close();
});

test('browser cancellation during key generation cannot publish or retain the abandoned new key', async t => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let generated = 0;
  const subtle = new Proxy(webcrypto.subtle, {get(target, property) {
    if (property === 'generateKey') return async (...args) => { generated++; if (generated === 1) await held; return target.generateKey(...args); };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  }});
  const f = fixture({crypto: {randomUUID: () => webcrypto.randomUUID(), subtle}}); t.after(() => f.tool.close());
  const pending = f.tool.prove(challenge()), refused = reject(pending, 'attestation_cancelled'); await tick();
  f.tool.cancel(); await refused; release(); await tick();
  await f.tool.prove(challenge()); assert.equal(generated, 2);
});

test('browser expiry during key generation cannot retain an abandoned document key', async t => {
  let release, generated = 0;
  const held = new Promise(resolve => { release = resolve; });
  const subtle = new Proxy(webcrypto.subtle, {get(target, property) {
    if (property === 'generateKey') return async (...args) => { generated++; if (generated === 1) await held; return target.generateKey(...args); };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  }});
  const f = fixture({crypto: {randomUUID: () => webcrypto.randomUUID(), subtle}}); t.after(() => f.tool.close());
  const pending = f.tool.prove(challenge()), refused = reject(pending, 'attestation_invalid');
  await tick(); f.advance(121); release(); await refused;
  f.advance(-121); await f.tool.prove(challenge()); assert.equal(generated, 2);
});

test('native capabilities and proofs never access browser persistence', async t => {
  const f = fixture({native: true}); t.after(() => f.tool.close());
  Object.defineProperty(f.scope, 'indexedDB', {get() { throw new Error('Native path accessed browser storage.'); }});
  const discovery = f.tool.capabilities(); await tick();
  f.respond({id: f.sent.at(-1).id, capabilities: {available: true, platform: 'android', version: 1, name: 'Synthetic Android'}});
  assert.equal((await discovery).key_storage, 'android-keystore');
  const pending = f.tool.prove(challenge('android')); await tick();
  f.respond({id: f.sent.at(-1).id, proof: await nativeProof()}); assert.equal((await pending).platform, 'android');
});

test('cancelling a pending storage open does not cancel an immediate fresh browser proof', async t => {
  const f = fixture(); t.after(() => f.tool.close());
  let opens = 0, lateClosed = 0;
  const delayed = {};
  f.scope.indexedDB = {open() {
    if (++opens === 1) return delayed;
    throw new DOMException('Synthetic blocked browser storage.', 'SecurityError');
  }};
  const first = f.tool.capabilities(), cancelled = reject(first, 'attestation_cancelled');
  await tick(); f.tool.cancel();
  // Start before awaiting the old promise: its cleanup must not own this retry.
  const retry = f.tool.prove(challenge());
  await cancelled;
  assert.equal((await retry).platform, 'browser');
  assert.equal(opens, 2);
  assert.equal((await f.tool.capabilities()).key_storage, 'document-memory');
  delayed.result = {close() { lateClosed++; }};
  delayed.onsuccess();
  assert.equal(lateClosed, 1, 'The revoked operation closes a connection that arrives after its retry.');
  assert.equal(f.timers.size, 0);
});

test('expired native results are refused against the frozen original window', async t => {
  const f = fixture({native: true}); t.after(() => f.tool.close());
  const pending = f.tool.prove(challenge('android')); await tick(); f.advance(121);
  f.respond({id: f.sent[0].id, proof: await nativeProof()}); await reject(pending, 'attestation_invalid');
});

test('native failures expose only bounded tool codes and malformed envelopes are refused', async t => {
  const f = fixture({native: true}); t.after(() => f.tool.close());
  for (const [input, expected] of [['attestation_store_full', 'attestation_store_full'],
    ['login_device_busy', 'attestation_busy'], ['secret platform details', 'attestation_unavailable']]) {
    const pending = f.tool.prove(challenge('android')); await tick(); f.respond({id: f.sent.at(-1).id, error: input});
    await reject(pending, expected);
  }
  const pending = f.tool.prove(challenge('android')); await tick();
  f.respond({id: f.sent.at(-1).id, proof: await nativeProof(), error: 'attestation_unavailable'});
  await reject(pending, 'attestation_invalid_response');
  assert.equal(f.sent.at(-1).cancel, f.sent.at(-2).id, 'A refused native result revokes its original operation.');
});

test('native dispatch uses the exact challenge snapshot taken before prove returns', async t => {
  const f = fixture({native: true}); t.after(() => f.tool.close());
  const input = challenge('android'), original = {...input}, pending = f.tool.prove(input);
  input.account_id = 'account:injected'; input.current_session_id = 'session:injected';
  await tick(); assert.deepEqual(f.sent[0].challenge, original);
  f.respond({id: f.sent[0].id, proof: await nativeProof()}); await pending;
});

test('malformed native transport data revokes the exact in-flight operation', async t => {
  const f = fixture({native: true}); t.after(() => f.tool.close());
  const pending = f.tool.prove(challenge('android')), refused = reject(pending, 'attestation_invalid_response');
  await tick(); const request = f.sent[0];
  f.scope.NonverbaLoginDevice.onmessage({data: '{broken JSON'}); await refused;
  assert.equal(f.sent.at(-1).cancel, request.id); assert.equal(f.timers.size, 0);
});
