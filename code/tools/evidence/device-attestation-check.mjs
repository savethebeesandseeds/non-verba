#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Independent requester and public-evidence checker. Run the CLI only in managed Debian.
import {createHash, createPublicKey, randomBytes, verify as verifySignature} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat, open} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const REQUEST_FIELDS = ['challenge_id', 'account_id', 'current_session_id', 'recovery_generation',
  'platform', 'issued_at', 'expires_at', 'challenge_b64'];
const POLICY_FIELDS = ['version', 'max_enrollment_age_secs', 'package_name', 'min_version_code',
  'signing_certificate_sha256', 'minimum_security_level', 'minimum_os_version', 'minimum_os_patch_level',
  'minimum_vendor_patch_level', 'minimum_boot_patch_level'];
const HASH = /^[a-f0-9]{64}$/;
const SCOPE = /^dev-tool:attestation:([a-f0-9]{32})$/;
const LIMITS = {request: 4096, proof: 256 * 1024, policy: 16 * 1024, trust: 2 * 1024 * 1024};
const codeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const insist = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = value => createHash('sha256').update(value).digest('hex');
const safeTime = value => Number.isSafeInteger(value) && value > 0;

function only(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && Object.keys(value).every(key => fields.includes(key));
}
function bytes(value, maximum, exact) {
  insist(typeof value === 'string' && value.length > 0 && value.length <= Math.ceil(maximum / 3) * 4
    && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value), 'Invalid canonical base64 evidence.');
  const result = Buffer.from(value, 'base64');
  insist(result.length > 0 && result.length <= maximum && (exact === undefined || result.length === exact)
    && result.toString('base64') === value, 'Invalid canonical base64 evidence.');
  return result;
}
function random32(value) {
  insist(typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value), 'Invalid canonical random token.');
  const result = Buffer.from(value, 'base64url');
  insist(result.length === 32 && result.toString('base64url') === value, 'Invalid canonical random token.');
  return result;
}

export function validateDeviceAttestationRequest(value) {
  insist(only(value, REQUEST_FIELDS), 'Invalid closed attestation request.');
  const result = Object.fromEntries(REQUEST_FIELDS.map(key => [key, value[key]]));
  random32(result.challenge_id);
  bytes(result.challenge_b64, 32, 32);
  insist(typeof result.account_id === 'string' && SCOPE.test(result.account_id)
    && result.current_session_id === 'dev-tool-session:' + result.challenge_id
    && result.recovery_generation === 0 && result.platform === 'android'
    && safeTime(result.issued_at) && result.issued_at <= Number.MAX_SAFE_INTEGER - 120
    && result.expires_at === result.issued_at + 120, 'Invalid developer attestation request context.');
  return Object.freeze(result);
}

export function createDeviceAttestationRequest({scope, nowSeconds = Math.floor(Date.now() / 1000), random = randomBytes} = {}) {
  insist(safeTime(nowSeconds) && nowSeconds <= Number.MAX_SAFE_INTEGER - 120, 'Invalid requester clock.');
  const draw = () => {
    const result = Buffer.from(random(32));
    insist(result.length === 32, 'Requester randomness must contain exactly 32 bytes.');
    return result;
  };
  if (scope === undefined) scope = draw().subarray(0, 16).toString('hex');
  insist(typeof scope === 'string' && /^[a-f0-9]{32}$/.test(scope), 'Scope must be 32 lowercase hexadecimal characters.');
  const id = draw().toString('base64url'), nonce = draw();
  const request = validateDeviceAttestationRequest({challenge_id: id, account_id: 'dev-tool:attestation:' + scope,
    current_session_id: 'dev-tool-session:' + id, recovery_generation: 0, platform: 'android',
    issued_at: nowSeconds, expires_at: nowSeconds + 120, challenge_b64: nonce.toString('base64')});
  return Object.freeze({scope, token: `NVAT1.${scope}.${nowSeconds}.${id}.${nonce.toString('base64url')}`, request});
}

function policySnapshot(value) {
  insist(only(value, POLICY_FIELDS) && value.version === 1 && value.package_name === 'org.nonverba.camera'
    && Number.isSafeInteger(value.min_version_code) && value.min_version_code >= 1
    && Number.isSafeInteger(value.max_enrollment_age_secs) && value.max_enrollment_age_secs >= 1
    && value.max_enrollment_age_secs <= 2_592_000
    && ['trusted-environment', 'strongbox'].includes(value.minimum_security_level)
    && Array.isArray(value.signing_certificate_sha256) && value.signing_certificate_sha256.length >= 1
    && value.signing_certificate_sha256.length <= 8
    && value.signing_certificate_sha256.every(hash => typeof hash === 'string' && HASH.test(hash))
    && new Set(value.signing_certificate_sha256).size === value.signing_certificate_sha256.length
    && ['minimum_os_version', 'minimum_os_patch_level', 'minimum_vendor_patch_level', 'minimum_boot_patch_level']
      .every(field => Number.isSafeInteger(value[field]) && value[field] >= 0 && value[field] <= 99_999_999),
  'Supply an explicit independent developer-app verifier policy.');
  return Object.freeze({...value, signing_certificate_sha256: Object.freeze([...value.signing_certificate_sha256])});
}
function sameRequest(left, right) { return REQUEST_FIELDS.every(field => left[field] === right[field]); }
function arrival(request, received, now) {
  insist(safeTime(received) && received >= request.issued_at && received < request.expires_at
    && received <= now, 'Observed response arrival is outside its original request window.');
}
function proofSnapshot(envelope, original) {
  insist(only(envelope, ['type', 'version', 'purpose', 'request', 'proof', 'hardware_attested'])
    && envelope.type === 'nonverba-device-attestation-proof' && envelope.version === 1
    && envelope.purpose === 'signin-device' && envelope.hardware_attested === false,
  'Invalid closed public proof envelope.');
  insist(sameRequest(validateDeviceAttestationRequest(envelope.request), original), 'Proof envelope changed the independent original request.');
  const proof = envelope.proof;
  insist(only(proof, ['public_spki_der_b64', 'signature_b64', 'attestation_chain', 'platform', 'name'])
    && proof.platform === 'android' && typeof proof.name === 'string' && proof.name.length >= 1 && proof.name.length <= 80
    && proof.name.trim() === proof.name
    && Buffer.byteLength(proof.name) >= 1 && Buffer.byteLength(proof.name) <= 80
    && !/[\p{Cc}\p{Cf}]/u.test(proof.name), 'Invalid closed native proof.');
  const spki = bytes(proof.public_spki_der_b64, 128), signature = bytes(proof.signature_b64, 64, 64);
  let chain = null;
  if (proof.attestation_chain !== null) {
    const input = proof.attestation_chain;
    insist(only(input, ['version', 'certificates_der_b64']) && input.version === 1
      && Array.isArray(input.certificates_der_b64) && input.certificates_der_b64.length >= 2
      && input.certificates_der_b64.length <= 8, 'Invalid bounded attestation chain.');
    let total = 0;
    const certificates = input.certificates_der_b64.map(value => {
      total += bytes(value, 32 * 1024).length;
      insist(total <= 96 * 1024, 'Attestation chain exceeds its aggregate bound.');
      return value;
    });
    insist(new Set(certificates).size === certificates.length, 'Duplicate attestation certificates.');
    chain = {version: 1, certificates_der_b64: certificates};
  }
  return {spki, signature, chain};
}

/** Callers assert independent original/arrival/trust provenance; input JSON cannot authenticate transport. */
export async function verifyDeviceAttestation({request, envelope, enrollmentRequest, receivedAt, enrollmentReceivedAt,
  policy, trustJson, nowSeconds = Math.floor(Date.now() / 1000), expectedSpki, verifyKeyAttestation} = {}) {
  insist(safeTime(nowSeconds), 'Invalid independent verifier clock.');
  const original = validateDeviceAttestationRequest(request), enrollment = validateDeviceAttestationRequest(enrollmentRequest);
  insist(enrollment.account_id === original.account_id && enrollment.issued_at <= original.issued_at,
    'Original enrollment must use the same synthetic scope and precede this proof.');
  arrival(original, receivedAt, nowSeconds);
  arrival(enrollment, enrollmentReceivedAt, nowSeconds);
  const selectedPolicy = policySnapshot(policy), evidence = proofSnapshot(envelope, original);
  insist(typeof trustJson === 'string' && trustJson.length > 0 && trustJson.length <= LIMITS.trust
    && Buffer.byteLength(trustJson) <= LIMITS.trust,
    'Invalid bounded verifier-owned trust input.');
  JSON.parse(trustJson);
  const key = createPublicKey({key: evidence.spki, type: 'spki', format: 'der'});
  insist(key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1'
    && key.export({type: 'spki', format: 'der'}).equals(evidence.spki), 'Proof key must be canonical P-256 SPKI.');
  const pin = sha256(evidence.spki);
  insist(expectedSpki === undefined || (typeof expectedSpki === 'string' && HASH.test(expectedSpki) && expectedSpki === pin),
    'Proof key does not match the independently retained SPKI pin.');
  const transcript = Buffer.from('NONVERBA:SIGNIN_DEVICE:v1\n' + REQUEST_FIELDS.map(field => original[field]).join('\n') + '\n', 'utf8');
  insist(verifySignature('sha256', transcript, {key, dsaEncoding: 'ieee-p1363'}, evidence.signature), 'Fresh possession signature verification failed.');
  const report = {
    type: 'nonverba-device-attestation-check', version: 1, purpose: 'signin-device', checked_at: nowSeconds,
    scope: SCOPE.exec(original.account_id)[1], key_spki_sha256: pin, independently_pinned_key: expectedSpki !== undefined,
    possession_proven: true, fresh_response_received_at: receivedAt,
    original_request_provenance: 'caller-supplied-independent-original',
    arrival_provenance: 'caller-observed-external-arrival',
    enrollment_context: {challenge_b64: enrollment.challenge_b64, challenge_issued_at: enrollment.issued_at,
      challenge_expires_at: enrollment.expires_at, response_received_at: enrollmentReceivedAt},
    enrollment_context_refreshed: false, state_scope: 'at-key-generation',
    trust_material_transport_authenticated: false, trust_provenance: 'caller-supplied-independent-snapshot',
    generation_verifier_result: null, generation_verifier_error: null, generation_attestation_verified: false,
    task_acceptance_committed: false, current_device_state_proven: false, live_presence_proven: false,
    physical_sensor_origin_proven: false
  };
  if (!evidence.chain) {
    report.generation_verifier_error = 'attestation_chain_not_provided';
    return report;
  }
  insist(typeof verifyKeyAttestation === 'function', 'Actual shared attestation verifier is required.');
  const {version: _version, ...expectations} = selectedPolicy;
  const expected = {version: 1, ...expectations, ...report.enrollment_context, expected_spki_sha256: pin};
  try {
    const output = await verifyKeyAttestation(JSON.stringify(evidence.chain), JSON.stringify(expected), trustJson, nowSeconds);
    insist(typeof output === 'string' && Buffer.byteLength(output) <= 128 * 1024, 'Invalid bounded shared-verifier result.');
    const result = JSON.parse(output);
    insist(result && typeof result === 'object' && !Array.isArray(result), 'Invalid shared-verifier result.');
    report.generation_verifier_result = result;
    report.generation_attestation_verified = result.key_enrollment_attested === true;
  } catch (error) {
    const value = String(error);
    report.generation_verifier_error = value.slice(0, 4096);
    if (value.length > 4096) report.generation_verifier_error_truncated = true;
  }
  return report;
}

async function unlinked(path, leafDirectory) {
  let current = resolve(path), leaf = true;
  while (true) {
    const info = await lstat(current);
    insist(!info.isSymbolicLink() && (leaf && !leafDirectory ? info.isFile() : info.isDirectory()), 'Linked or unexpected input/output path.');
    const parent = dirname(current);
    if (parent === current) break;
    current = parent; leaf = false;
  }
}
export async function readBoundedJson(path, maximum) {
  insist(typeof path === 'string' && path.length > 0 && path.length <= 4096, 'Invalid bounded file path.');
  path = resolve(path);
  await unlinked(path, false);
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await file.stat();
    insist(before.isFile() && before.size > 0 && before.size <= maximum, 'Input file exceeds its bound.');
    const buffer = Buffer.alloc(maximum + 1);
    let count = 0;
    while (count < buffer.length) {
      const {bytesRead} = await file.read(buffer, count, buffer.length - count, count);
      if (!bytesRead) break;
      count += bytesRead;
    }
    const after = await file.stat();
    insist(count > 0 && count <= maximum && before.size === count && after.size === count
      && before.mtimeMs === after.mtimeMs, 'Input file changed while reading.');
    const content = buffer.subarray(0, count), text = new TextDecoder('utf-8', {fatal: true}).decode(content);
    return {path, text, value: JSON.parse(text), sha256: sha256(content), bytes: count};
  } finally { await file.close(); }
}
export async function writeExclusiveJson(path, value) {
  insist(typeof path === 'string' && path.length > 0 && path.length <= 4096, 'Invalid output path.');
  path = resolve(path);
  await unlinked(dirname(path), true);
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  insist(bytes.length <= 512 * 1024, 'Output exceeds its public report bound.');
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  return path;
}

async function loadVerifier() {
  const modulePath = resolve(codeRoot, '../web/dist-android/pkg/nonverba_core.js');
  const wasmPath = resolve(codeRoot, '../web/dist-android/pkg/nonverba_core_bg.wasm');
  await unlinked(modulePath, false); await unlinked(wasmPath, false);
  const wasmFile = await open(wasmPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let wasm;
  try {
    const info = await wasmFile.stat();
    insist(info.isFile() && info.size > 0 && info.size <= 64 * 1024 * 1024, 'Invalid compiled WASM module bound.');
    wasm = await wasmFile.readFile();
    insist(wasm.length === info.size, 'Compiled WASM changed while loading.');
  } finally { await wasmFile.close(); }
  const core = await import(pathToFileURL(modulePath).href);
  await core.default({module_or_path: wasm});
  insist(typeof core.verify_key_attestation === 'function', 'Compiled shared attestation verifier is missing.');
  return {verify: core.verify_key_attestation, wasm_sha256: sha256(wasm)};
}
function parseOptions(args, permitted, required) {
  const options = {};
  while (args.length) {
    const name = args.shift();
    insist(permitted.includes(name) && args.length > 0 && !Object.hasOwn(options, name), 'Invalid or duplicate command option.');
    const value = args.shift();
    insist(typeof value === 'string' && value.length > 0 && !value.startsWith('--'), 'Command option needs a value.');
    options[name] = value;
  }
  insist(required.every(name => Object.hasOwn(options, name)), 'Missing required command option.');
  return options;
}
export async function main(args = process.argv.slice(2)) {
  insist(process.platform === 'linux' && process.env.NONVERBA_CONTAINER === '1', 'Run this CLI inside the managed non-verba-dev container.');
  const [command, ...values] = args;
  if (command === 'create-request') {
    const options = parseOptions(values, ['--output', '--scope'], ['--output']);
    const created = createDeviceAttestationRequest({scope: options['--scope']});
    const path = await writeExclusiveJson(options['--output'], created.request);
    return {type: 'nonverba-independent-device-attestation-request', request: path, scope: created.scope, token: created.token,
      issued_at: created.request.issued_at, expires_at: created.request.expires_at};
  }
  insist(command === 'verify', 'Use create-request or verify.');
  const required = ['--request', '--proof', '--received-at', '--enrollment-request', '--enrollment-received-at', '--policy', '--trust', '--output'];
  const options = parseOptions(values, [...required, '--expected-spki'], required);
  const inputs = {};
  for (const [name, maximum] of [['request', LIMITS.request], ['proof', LIMITS.proof], ['enrollment-request', LIMITS.request],
    ['policy', LIMITS.policy], ['trust', LIMITS.trust]]) inputs[name] = await readBoundedJson(options['--' + name], maximum);
  for (const name of ['--received-at', '--enrollment-received-at'])
    insist(/^[1-9][0-9]{0,15}$/.test(options[name]) && safeTime(Number(options[name])), 'Invalid observed arrival timestamp.');
  // Missing/invalid build inputs are configuration failures, not a policy refusal.
  const compiled = await loadVerifier();
  const report = await verifyDeviceAttestation({request: inputs.request.value, envelope: inputs.proof.value,
    enrollmentRequest: inputs['enrollment-request'].value, receivedAt: Number(options['--received-at']),
    enrollmentReceivedAt: Number(options['--enrollment-received-at']), policy: inputs.policy.value, trustJson: inputs.trust.text,
    expectedSpki: options['--expected-spki'], verifyKeyAttestation: compiled.verify});
  report.inputs = Object.fromEntries(Object.entries(inputs).map(([name, record]) => [name,
    {path: record.path, bytes: record.bytes, sha256: record.sha256}]));
  report.wasm_sha256 = compiled.wasm_sha256;
  const path = await writeExclusiveJson(options['--output'], report);
  return {report: path, possession_proven: report.possession_proven,
    generation_attestation_verified: report.generation_attestation_verified, generation_verifier_error: report.generation_verifier_error,
    trust_material_transport_authenticated: false, task_acceptance_committed: false};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => console.log(JSON.stringify(result, null, 2)), error => {
    console.error(error?.message || String(error)); process.exitCode = 1;
  });
}
