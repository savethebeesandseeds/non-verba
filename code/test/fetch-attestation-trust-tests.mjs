// SPDX-License-Identifier: AGPL-3.0-only
// Deterministic collector-boundary checks; no network, Android, or key enrollment.
import assert from 'node:assert/strict';
import {X509Certificate} from 'node:crypto';
import {mkdtemp, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {test} from 'node:test';
import {buildSnapshot, cacheBudget, fetchPublicJson, KNOWN_PINS, MAX_BYTES,
  validateFreshness, validateRevocation, validateRoots, writeSnapshot} from '../tools/fetch-attestation-trust.mjs';
if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Run these tests inside non-verba-dev.');
const roots = JSON.parse(await readFile(new URL('../crates/nonverba-core/src/android_attestation/google-roots-2026.json', import.meta.url), 'utf8'));
const rootResponse = {data: roots, remaining: 3600};
const statusResponse = {data: {entries: {abc: {status: 'REVOKED'}}}, remaining: 300};
const started = 1_800_000_000_000;

test('known public RSA and P384 roots produce the original two SPKI pins', () => {
  assert.deepEqual([...validateRoots(roots)].sort(), [...KNOWN_PINS].sort());
});
test('empty, excessive, malformed, and duplicate root sets reject', () => {
  for (const value of [[], {}, Array(9).fill(roots[0]), [1], ['not a certificate'], [roots[0], roots[0]]]) {
    assert.throws(() => validateRoots(value));
  }
});
test('new root key requires an explicit verifier update', () => {
  const cert = new X509Certificate(roots[0]);
  const spki = cert.publicKey.export({type: 'spki', format: 'der'});
  const der = Buffer.from(cert.raw);
  const offset = der.indexOf(spki);
  assert.ok(offset >= 0);
  der[offset + spki.length - 12] ^= 1;
  const pem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64')}\n-----END CERTIFICATE-----`;
  assert.throws(() => validateRoots([pem]), /explicit verifier update/);
});
test('freshness is bounded to whole seconds from 1 to 3600', () => {
  assert.equal(validateFreshness(1), 1);
  assert.equal(validateFreshness(3600), 3600);
  for (const value of [0, -1, 3601, 1.5, NaN, Infinity, '300']) assert.throws(() => validateFreshness(value));
});
test('cache lifetime subtracts Age and respects requested bound and default', () => {
  assert.equal(cacheBudget({'cache-control': 'public, max-age=600', age: '30'}, 3600), 570);
  assert.equal(cacheBudget({'cache-control': 'public, max-age=7200', age: '30'}, 3600), 3600);
  assert.equal(cacheBudget({'cache-control': 'MAX-AGE="600"', age: '30'}, 60), 60);
  assert.equal(cacheBudget({}, 3600), 300);
});
test('expired, malformed, and ambiguous cache headers fail closed', () => {
  for (const headers of [
    {age: '300'}, {'cache-control': 'max-age=0'}, {'cache-control': 'max-age=20', age: '20'},
    {'cache-control': 'max-age=20', age: '21'}, {age: '-1'}, {age: '0.5'},
    {age: '9007199254740992'}, {'cache-control': 'max-age=oops'},
    {'cache-control': 'max-age=20, max-age=40'}, {'cache-control': 'max-age="20'},
  ]) assert.throws(() => cacheBudget(headers, 3600));
});
test('revocation allows canonical revoked/suspended serials and preserves optional fields', () => {
  const entries = {abc: {status: 'REVOKED', reason: 'KEY_COMPROMISE'}, f: {status: 'SUSPENDED', expires: '2030-01-01'}};
  assert.equal(validateRevocation({entries}), entries);
  assert.deepEqual(validateRevocation({entries: {}}), {});
});
test('revocation rejects invalid shape, serial, status, and excessive lists', () => {
  for (const value of [{}, {entries: []}, {entries: null}, {entries: {'0abc': {status: 'REVOKED'}}},
    {entries: {ABC: {status: 'REVOKED'}}}, {entries: {abc: {status: 'GOOD'}}},
    {entries: {abc: null}}, {entries: {['f'.repeat(41)]: {status: 'REVOKED'}}}]) {
    assert.throws(() => validateRevocation(value));
  }
  const entries = Object.fromEntries(Array.from({length: 50001}, (_, i) => [(i + 1).toString(16), {status: 'REVOKED'}]));
  assert.throws(() => validateRevocation({entries}));
});
test('snapshot uses fetch start and shorter endpoint cache lifetime', () => {
  const value = buildSnapshot(rootResponse, statusResponse, started, started + 2000, 2000);
  assert.deepEqual(Object.keys(value), ['version', 'profile', 'root_spki_sha256', 'revocation']);
  assert.equal(value.revocation.fetched_at, started / 1000);
  assert.equal(value.revocation.valid_until, started / 1000 + 300);
  assert.equal(value.profile, 'google-hardware-attestation');
});
test('snapshot rejects stale response, backward wall clock, and both overall time bounds', () => {
  assert.throws(() => buildSnapshot(rootResponse, {...statusResponse, remaining: 2}, started, started + 2000, 2000));
  assert.throws(() => buildSnapshot(rootResponse, statusResponse, started, started - 1, 10));
  assert.throws(() => buildSnapshot(rootResponse, statusResponse, started, started + 61_000, 59_000));
  assert.throws(() => buildSnapshot(rootResponse, statusResponse, started, started + 59_000, 61_000));
});
test('only the exact two public HTTPS endpoints are accepted', async () => {
  for (const url of ['http://android.googleapis.com/attestation/root',
    'https://android.googleapis.com/attestation/root?phone=anything', 'https://example.com/']) {
    await assert.rejects(fetchPublicJson(url, 3600), /Unrecognized public trust endpoint/);
  }
});
test('snapshot and audit metadata are separate and existing snapshot cannot be replaced', async () => {
  const dir = await mkdtemp(resolve(process.env.CARGO_TARGET_DIR, 'trust-fetch-test-'));
  const output = resolve(dir, 'snapshot.json');
  const trust = buildSnapshot(rootResponse, statusResponse, started, started + 1000, 1000);
  const result = await writeSnapshot(output, trust, {type: 'synthetic-collector-test'});
  const before = await readFile(output, 'utf8');
  assert.deepEqual(JSON.parse(before), trust);
  assert.equal(JSON.parse(await readFile(result.metadata_path, 'utf8')).snapshot_sha256, result.sha256);
  await assert.rejects(writeSnapshot(output, trust, {}), {code: 'EEXIST'});
  assert.equal(await readFile(output, 'utf8'), before);
});
test('serialized trust input remains within the Rust verifier limit', async () => {
  await assert.rejects(writeSnapshot('/unused/snapshot.json', {oversized: 'x'.repeat(MAX_BYTES)}, {}), /verifier input limit/);
});
