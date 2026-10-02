// SPDX-License-Identifier: AGPL-3.0-only
// Verifies host-JNI-produced synthetic GNSS evidence with the shipped WASM core.
// No real satellites, Android receiver or hardware key are exercised here.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'artifacts/qa');
const trace = JSON.parse(await readFile(resolve(root, 'crates/nonverba-core/src/location_proof/raw_gnss_fixture.json'), 'utf8'));
const envelope = JSON.parse(await readFile(resolve(out, 'raw-gnss-synthetic-proof.json'), 'utf8'));
const pin = (await readFile(resolve(out, 'raw-gnss-synthetic-key.txt'), 'utf8')).trim();
const browser = await chromium.launch({headless: true, channel: 'msedge'});
const page = await browser.newPage();
try {
  await page.goto(`${process.env.NONVERBA_TEST_URL || 'http://127.0.0.1:4174'}/location.html`);
  const result = await page.evaluate(async ({trace, envelope, pin}) => {
    const {createCoreClient} = await import('./core-client.js');
    const {readLocationProofEnvelope} = await import('./location-platform.js');
    const core = createCoreClient();
    const bytes = readLocationProofEnvelope(JSON.stringify(envelope));
    const verify = (request, input = bytes, key = pin) => core.json('verify_location_proof', input,
      JSON.stringify(request), key, 'null', trace.ended_at_ms / 1000);
    const valid = await verify(trace.request);
    const wrongKey = await verify(trace.request, bytes, '0'.repeat(64));
    const changed = structuredClone(trace.request); delete changed.policy.raw_gnss;
    const downgraded = await verify(changed);
    const tampered = bytes.slice(); tampered[tampered.length - 1] ^= 1;
    return {valid, wrongKey, downgraded, tampered: await verify(trace.request, tampered)};
  }, {trace, envelope, pin});
  assert.equal(result.valid.verified, true, JSON.stringify(result.valid.errors));
  assert.equal(result.valid.raw_gnss.ready, true);
  assert.equal(result.valid.raw_gnss.epoch_count, 11);
  assert.equal(result.valid.raw_gnss.min_qualifying_satellites, 4);
  for (const field of ['satellite_authentication_verified', 'independent_position_recomputed', 'collection_attested']) {
    assert.equal(result.valid.raw_gnss[field], false);
  }
  assert.equal(result.wrongKey.verified, false); assert.equal(result.wrongKey.checks.device_match, false);
  assert.equal(result.downgraded.verified, false); assert.equal(result.downgraded.checks.request_match, false);
  assert.equal(result.tampered.verified, false); assert.equal(result.tampered.checks.signature_integrity, false);
  await writeFile(resolve(out, 'raw-gnss-browser-results.json'), JSON.stringify({synthetic_receiver: true,
    physical_device_tested: false, crypto_mocked: false, tests_passed: 4, result}, null, 2));
  console.log('PASS four JNI-to-WASM raw GNSS verification cases (synthetic receiver, real signatures)');
} finally { await browser.close(); }
