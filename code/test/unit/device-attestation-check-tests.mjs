// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
import {mkdtemp, readFile, rm, symlink, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDeviceAttestationRequest, validateDeviceAttestationRequest, verifyDeviceAttestation,
  readBoundedJson, writeExclusiveJson} from '../../tools/evidence/device-attestation-check.mjs';

const now = 1_792_663_258;
const fields = ['challenge_id', 'account_id', 'current_session_id', 'recovery_generation', 'platform', 'issued_at', 'expires_at', 'challenge_b64'];
const scope = 'a'.repeat(32);
const transcript = request => Buffer.from('NONVERBA:SIGNIN_DEVICE:v1\n' + fields.map(field => request[field]).join('\n') + '\n');
const policy = () => ({version: 1, max_enrollment_age_secs: 2_592_000, package_name: 'org.nonverba.camera', min_version_code: 9,
  signing_certificate_sha256: ['a'.repeat(64)], minimum_security_level: 'trusted-environment', minimum_os_version: 80000,
  minimum_os_patch_level: 202610, minimum_vendor_patch_level: 20261001, minimum_boot_patch_level: 20261001});
function fixture({chain = true} = {}) {
  const key = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
  const request = createDeviceAttestationRequest({scope, nowSeconds: now}).request;
  const spki = key.publicKey.export({type: 'spki', format: 'der'});
  const envelope = {type: 'nonverba-device-attestation-proof', version: 1, purpose: 'signin-device', request: {...request},
    hardware_attested: false, proof: {public_spki_der_b64: spki.toString('base64'),
      signature_b64: sign('sha256', transcript(request), {key: key.privateKey, dsaEncoding: 'ieee-p1363'}).toString('base64'),
      attestation_chain: chain ? {version: 1, certificates_der_b64: ['AQ==', 'Ag==']} : null,
      platform: 'android', name: 'Synthetic developer test'}};
  const options = {request, envelope, enrollmentRequest: request, receivedAt: now + 1, enrollmentReceivedAt: now + 1,
    policy: policy(), trustJson: '{"version":1,"profile":"private-test"}', nowSeconds: now + 2,
    verifyKeyAttestation: () => JSON.stringify({key_enrollment_attested: false, trust_profile: 'private-test', verified: true})};
  return {key, request, envelope, spki, options};
}

test('independent request creation writes a canonical closed context and compact host token', () => {
  let draw = 0;
  const result = createDeviceAttestationRequest({scope, nowSeconds: now, random: length => Buffer.alloc(length, ++draw)});
  assert.equal(result.token, `NVAT1.${scope}.${now}.${Buffer.alloc(32, 1).toString('base64url')}.${Buffer.alloc(32, 2).toString('base64url')}`);
  assert.equal(result.request.account_id, 'dev-tool:attestation:' + scope);
  assert.equal(result.request.current_session_id, 'dev-tool-session:' + result.request.challenge_id);
  assert.equal(result.request.expires_at, now + 120); assert.equal(result.request.platform, 'android');
  assert.equal(Object.keys(result.request).length, 8); assert(Object.isFrozen(result.request)); assert(result.token.length <= 200);
  assert.match(createDeviceAttestationRequest({nowSeconds: now}).scope, /^[a-f0-9]{32}$/);
  assert.throws(() => createDeviceAttestationRequest({scope: 'A'.repeat(32), nowSeconds: now}));
  assert.throws(() => createDeviceAttestationRequest({scope, nowSeconds: now, random: () => Buffer.alloc(31)}));
});

test('real P-256 possession is independent of a synthetic chain verdict and trust provenance', async () => {
  const f = fixture(), report = await verifyDeviceAttestation(f.options);
  assert.equal(report.possession_proven, true);
  assert.equal(report.key_spki_sha256, createHash('sha256').update(f.spki).digest('hex'));
  assert.equal(report.generation_verifier_result.key_enrollment_attested, false);
  assert.equal(report.generation_attestation_verified, false);
  assert.equal(report.trust_material_transport_authenticated, false);
  assert.equal(report.task_acceptance_committed, false);
  assert.equal(report.current_device_state_proven, false);
  assert.equal(report.live_presence_proven, false);
  assert.equal(report.physical_sensor_origin_proven, false);
  assert.equal(report.independently_pinned_key, false);
  const pinned = await verifyDeviceAttestation({...f.options, expectedSpki: report.key_spki_sha256});
  assert.equal(pinned.independently_pinned_key, true);
  await assert.rejects(verifyDeviceAttestation({...f.options, expectedSpki: 'b'.repeat(64)}), /SPKI pin/);
});

test('wrong original, substituted key and modified signature cannot prove possession', async () => {
  const f = fixture();
  await assert.rejects(verifyDeviceAttestation({...f.options,
    request: {...f.request, challenge_b64: Buffer.alloc(32, 11).toString('base64')}}), /independent original/);
  const changed = structuredClone(f.envelope);
  changed.request.challenge_b64 = Buffer.alloc(32, 12).toString('base64');
  await assert.rejects(verifyDeviceAttestation({...f.options, request: changed.request, envelope: changed}), /signature verification/);
  const other = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
  changed.request = {...f.request};
  changed.proof.public_spki_der_b64 = other.publicKey.export({type: 'spki', format: 'der'}).toString('base64');
  await assert.rejects(verifyDeviceAttestation({...f.options, envelope: changed}), /signature verification/);
  const tampered = structuredClone(f.envelope), signature = Buffer.from(tampered.proof.signature_b64, 'base64');
  signature[0] ^= 1; tampered.proof.signature_b64 = signature.toString('base64');
  await assert.rejects(verifyDeviceAttestation({...f.options, envelope: tampered}), /signature verification/);
});

test('fresh possession uses a fresh request but generation verification retains the first enrollment window', async () => {
  const f = fixture(), first = createDeviceAttestationRequest({scope, nowSeconds: now - 1000}).request;
  let captured;
  const report = await verifyDeviceAttestation({...f.options, enrollmentRequest: first, enrollmentReceivedAt: first.issued_at + 9,
    verifyKeyAttestation: (...args) => { captured = args; return '{"key_enrollment_attested":false,"verified":true}'; }});
  const expected = JSON.parse(captured[1]);
  assert.equal(expected.challenge_b64, first.challenge_b64);
  assert.equal(expected.challenge_issued_at, first.issued_at);
  assert.equal(expected.challenge_expires_at, first.expires_at);
  assert.equal(expected.response_received_at, first.issued_at + 9);
  assert.notEqual(expected.challenge_b64, f.request.challenge_b64);
  assert.equal(expected.expected_spki_sha256, report.key_spki_sha256);
  assert.equal(expected.max_enrollment_age_secs, f.options.policy.max_enrollment_age_secs);
  assert.equal(captured[2], f.options.trustJson); assert.equal(captured[3], f.options.nowSeconds);
  assert.equal(report.enrollment_context_refreshed, false);
  assert.equal(report.fresh_response_received_at, now + 1);
  const otherScope = createDeviceAttestationRequest({scope: 'b'.repeat(32), nowSeconds: now - 1000}).request;
  await assert.rejects(verifyDeviceAttestation({...f.options, enrollmentRequest: otherScope}), /same synthetic scope/);
});

test('both externally observed arrivals must fall inside their own immutable original windows', async () => {
  const f = fixture();
  for (const receivedAt of [now - 1, now + 120, now + 3, NaN, -1]) {
    await assert.rejects(verifyDeviceAttestation({...f.options, receivedAt}), /arrival/);
  }
  for (const enrollmentReceivedAt of [now - 1, now + 120, now + 3]) {
    await assert.rejects(verifyDeviceAttestation({...f.options, enrollmentReceivedAt}), /arrival/);
  }
});

test('strict developer profile and bounded evidence reject malformed material before the certificate verifier', async () => {
  const f = fixture(); let calls = 0;
  const verifyKeyAttestation = () => { calls++; return '{}'; };
  const invalid = [
    {...f.envelope, hardware_attested: true}, {...f.envelope, arbitrary: true},
    {...f.envelope, proof: {...f.envelope.proof, public_spki_der_b64: 'A'.repeat(100_000)}},
    {...f.envelope, proof: {...f.envelope.proof, signature_b64: Buffer.alloc(65).toString('base64')}},
    {...f.envelope, proof: {...f.envelope.proof, name: 'hidden\nname'}},
    {...f.envelope, proof: {...f.envelope.proof, attestation_chain: {version: 1, certificates_der_b64: Array(9).fill('AQ==')}}},
    {...f.envelope, proof: {...f.envelope.proof, attestation_chain: {version: 1, certificates_der_b64: ['AQ==', 'AQ==']}}},
    {...f.envelope, proof: {...f.envelope.proof, attestation_chain: {version: 1,
      certificates_der_b64: [Buffer.alloc(32 * 1024 + 1).toString('base64'), 'AQ==']}}},
    {...f.envelope, proof: {...f.envelope.proof, attestation_chain: {version: 1,
      certificates_der_b64: Array.from({length: 4}, (_, i) => Buffer.alloc(32 * 1024, i).toString('base64'))}}}
  ];
  for (const envelope of invalid) await assert.rejects(verifyDeviceAttestation({...f.options, envelope, verifyKeyAttestation}));
  await assert.rejects(verifyDeviceAttestation({...f.options, policy: {...policy(), package_name: 'org.nonverba.participant'}, verifyKeyAttestation}));
  await assert.rejects(verifyDeviceAttestation({...f.options, policy: {...policy(), trust_refresh_max_age_secs: 600}, verifyKeyAttestation}));
  await assert.rejects(verifyDeviceAttestation({...f.options, trustJson: ' '.repeat(2 * 1024 * 1024 + 1), verifyKeyAttestation}));
  assert.equal(calls, 0);
  for (const change of [{account_id: 'real:account'}, {recovery_generation: 1}, {platform: 'browser'},
    {current_session_id: 'real:session'}, {expires_at: now + 121}, {challenge_b64: 'AA=='}, {challenge_id: f.request.challenge_id + '='}]) {
    assert.throws(() => validateDeviceAttestationRequest({...f.request, ...change}));
  }
});

test('policy rejection preserves the actual verifier error while possession remains separately verified', async () => {
  const f = fixture();
  const report = await verifyDeviceAttestation({...f.options, verifyKeyAttestation: () => { throw new Error('OS patch level below selected minimum'); }});
  assert.equal(report.possession_proven, true); assert.equal(report.generation_attestation_verified, false);
  assert.equal(report.generation_verifier_error, 'Error: OS patch level below selected minimum');
  assert.equal(report.generation_verifier_result, null);
  const noChain = fixture({chain: false});
  const unsupported = await verifyDeviceAttestation({...noChain.options, verifyKeyAttestation: () => assert.fail('missing chain reached verifier')});
  assert.equal(unsupported.possession_proven, true);
  assert.equal(unsupported.generation_verifier_error, 'attestation_chain_not_provided');
});

test('exclusive public output and bounded unlinked input preserve originals and reject linked paths', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'nonverba-attestation-check-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const path = join(directory, 'original.json'), original = createDeviceAttestationRequest({scope, nowSeconds: now}).request;
  await writeExclusiveJson(path, original);
  const record = await readBoundedJson(path, 4096);
  assert.deepEqual(record.value, original); assert.equal(record.sha256, createHash('sha256').update(await readFile(path)).digest('hex'));
  await assert.rejects(writeExclusiveJson(path, {changed: true}), /EEXIST/);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), original);
  await assert.rejects(readBoundedJson(path, 16));
  const linked = join(directory, 'linked.json'); await symlink(path, linked);
  await assert.rejects(readBoundedJson(linked, 4096), /Linked/);
  const target = join(directory, 'target'); await mkdir(target);
  const parentLink = join(directory, 'linked-parent'); await symlink(target, parentLink);
  await assert.rejects(writeExclusiveJson(join(parentLink, 'new.json'), original), /Linked/);
  const invalid = join(directory, 'invalid.json'); await writeFile(invalid, Buffer.from([0xff, 0xfe]));
  await assert.rejects(readBoundedJson(invalid, 4096));
});
