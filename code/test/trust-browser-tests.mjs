// SPDX-License-Identifier: AGPL-3.0-only
// Public-only synthetic enrollment fixtures and signed sensor records -> real WASM.
// No private fixture keys, browser geolocation mocking, or physical-device claims.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../artifacts/qa');
const fixtureText = await readFile(resolve(out, 'trust-synthetic-fixtures.json'), 'utf8');
const fixture = JSON.parse(fixtureText);
assert.equal(fixture.synthetic, true);
assert.equal(fixture.physical_device_tested, false);
assert.doesNotMatch(fixtureText, /PRIVATE KEY|private_key|pkcs8/);
const browser = await chromium.launch({headless: true, channel: 'msedge'});
try {
  const page = await browser.newPage();
  await page.goto(`${process.env.NONVERBA_TEST_URL || 'http://127.0.0.1:4174'}/index.html`);
  const result = await page.evaluate(async f => {
    const {createCoreClient} = await import('./core-client.js');
    const core = createCoreClient();
    const clone = structuredClone;
    const bytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const caught = async operation => {
      try { return {rejected: false, value: await operation()}; }
      catch (error) { return {rejected: true, message: String(error)}; }
    };
    const enroll = (e, request = e.request, policy = e.policy, trust = e.trust, arrival = e.arrival) =>
      core.json('verify_key_enrollment', JSON.stringify(e.response), JSON.stringify(request),
        JSON.stringify(policy), JSON.stringify(trust), arrival, e.now);
    const l = f.location_enrollment, m = f.media_enrollment;
    const context = e => ({version: 1, key_attestation: e.context});
    const loc = (ctx, policy = f.agent_policy, artifact = f.location) =>
      core.json('appraise_location_with_context', bytes(artifact.proof_b64), JSON.stringify(artifact.request),
        artifact.pin, 'null', JSON.stringify(policy), JSON.stringify(ctx), artifact.now);
    const media = ctx => core.json('appraise_image_with_context', bytes(f.image.jpeg_b64),
      JSON.stringify(f.image.request), f.image.pin, JSON.stringify(f.agent_policy), JSON.stringify(ctx), f.image.now);
    const badRequest = clone(l.request); badRequest.purpose = 'media';
    const wrongResponse = clone(l); wrongResponse.response.challenge_b64 = btoa('x'.repeat(32));
    const revoked = clone(l.trust); revoked.revocation.entries['2'] = {status: 'REVOKED'};
    const google = clone(l.trust); google.profile = 'google-hardware-attestation';
    const stale = clone(l.trust); stale.revocation.valid_until = l.now;
    const hardwarePolicy = {...f.agent_policy, hardware_attestation_required: true};
    const wrongContext = context(m);
    const forgedContext = {...context(l), key_attested: true};
    const positionPolicy = {...f.agent_policy, native_acquisition_required: true,
      raw_gnss_required: true, independent_position_required: true};
    const positionContext = {version: 1, position: {
      navigation_json: f.position.navigation_json, policy: f.position.policy,
    }};
    const positionArtifact = {proof_b64: f.position.proof_b64, request: f.position.original_request,
      pin: f.position.expected_pin, now: f.position.now_secs};
    const alteredNavigation = clone(positionContext); alteredNavigation.position.navigation_json += ' ';
    const changedTask = clone(f.location); changedTask.request.challenge.task = 'An unrelated task';
    return {
      locationEnrollment: await enroll(l), mediaEnrollment: await enroll(m),
      wrongChallenge: await caught(() => enroll(wrongResponse)),
      changedPurpose: await caught(() => enroll(l, badRequest)),
      lateArrival: await caught(() => enroll(l, l.request, l.policy, l.trust, l.request.expires_at)),
      revoked: await caught(() => enroll(l, l.request, l.policy, revoked)),
      stale: await caught(() => enroll(l, l.request, l.policy, stale)),
      fakeGoogle: await caught(() => enroll(l, l.request, l.policy, google)),
      location: await loc(context(l)), image: await media(context(m)),
      wrongLocationSigner: await caught(() => loc(wrongContext)),
      wrongMediaSigner: await caught(() => media(context(l))),
      forgedReport: await caught(() => loc(forgedContext)),
      hardwareRequired: await loc(context(l), hardwarePolicy),
      changedTask: await loc(context(l), hardwarePolicy, changedTask),
      position: await loc(positionContext, positionPolicy, positionArtifact),
      navigationChanged: await loc(alteredNavigation, positionPolicy, positionArtifact),
    };
  }, fixture);
  for (const name of ['locationEnrollment', 'mediaEnrollment']) {
    assert.equal(result[name].verified, true, name);
    assert.equal(result[name].key_enrollment_attested, false, name);
    assert.equal(result[name].possession_proven, false, name);
  }
  for (const name of ['wrongChallenge', 'changedPurpose', 'lateArrival', 'revoked', 'stale', 'fakeGoogle',
    'wrongLocationSigner', 'wrongMediaSigner', 'forgedReport']) assert.equal(result[name].rejected, true, name);
  for (const name of ['location', 'image']) {
    assert.equal(result[name].evidence_verified, true, name);
    assert.equal(result[name].additional_evidence.signing_key.artifact_key_bound, true, name);
    assert.equal(result[name].additional_evidence.signing_key.possession_proven, true, name);
    assert.equal(result[name].additional_evidence.key_attested, false, name);
    assert.equal(result[name].physical_measurement_authenticity_proven, false, name);
  }
  assert.equal(result.hardwareRequired.evidence_verified, true);
  assert.equal(result.hardwareRequired.policy_satisfied, false);
  assert.deepEqual(result.hardwareRequired.missing_requirements, ['remote_hardware_attestation']);
  assert.equal(result.changedTask.evidence_verified, false);
  assert.equal(result.changedTask.additional_evidence.signing_key.possession_proven, false);
  assert.equal(result.position.policy_satisfied, true, JSON.stringify(result.position.additional_evidence.position));
  assert.equal(result.position.additional_evidence.position_verified, true);
  assert.equal(result.position.physical_measurement_authenticity_proven, false);
  assert.equal(result.navigationChanged.policy_satisfied, false);
  assert.equal(result.navigationChanged.additional_evidence.position_verified, false);
  await writeFile(resolve(out, 'trust-browser-results.json'), JSON.stringify({
    synthetic: true, physical_device_tested: false, crypto_mocked: false,
    fixture_sha256: createHash('sha256').update(fixtureText).digest('hex'),
    actual_google_device_chain_tested: false, tests_passed: 17, result,
  }, null, 2));
  console.log('PASS 17 WASM enrollment, actual-signer attestation binding and position policy cases (synthetic records)');
} finally { await browser.close(); }
