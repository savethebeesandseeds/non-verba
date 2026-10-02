// SPDX-License-Identifier: AGPL-3.0-only
// JVM-generated synthetic image + production JNI signer -> shipped WASM verifier.
// This checks cross-runtime compatibility, not Camera2 or Keystore hardware.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../artifacts/qa');
const challenge = JSON.parse(await readFile(resolve(out, 'native-camera-synthetic-request.json'), 'utf8'));
const image = await readFile(resolve(out, 'native-camera-synthetic.jpg'));
const pin = (await readFile(resolve(out, 'native-camera-synthetic-key.txt'), 'utf8')).trim();
const browser = await chromium.launch({headless: true, channel: 'msedge'});
try {
  const page = await browser.newPage();
  await page.goto(`${process.env.NONVERBA_TEST_URL || 'http://127.0.0.1:4174'}/index.html`);
  const result = await page.evaluate(async ({challenge, image, pin}) => {
    const {createCoreClient} = await import('./core-client.js');
    const core = createCoreClient(), bytes = Uint8Array.from(atob(image), c => c.charCodeAt(0));
    const verify = (request = challenge, key = pin, input = bytes) => core.json('verify_image', input, JSON.stringify(request), key, 1800000002);
    const valid = await verify();
    const wrongKey = await verify(challenge, '0'.repeat(64));
    const changedRequest = await verify({...challenge, task: 'A different requested measurement'});
    const tampered = bytes.slice(); tampered[Math.floor(tampered.length / 2)] ^= 1;
    return {valid, wrongKey, changedRequest, tampered: await verify(challenge, pin, tampered)};
  }, {challenge, image: image.toString('base64'), pin});
  assert.equal(result.valid.verified, true, JSON.stringify(result.valid.errors));
  assert.equal(result.valid.checks.native_camera_metadata_valid, true);
  assert.equal(result.valid.checks.location_metadata_valid, true);
  assert.equal(result.valid.native_camera.sensor_timestamp_ns, '9007199254741013');
  assert.equal(result.valid.native_camera.sealed_at_unix_ms, 1800000001000);
  assert.equal(result.valid.hardware_attested, false);
  assert.equal(result.valid.camera_freshness_proven, false);
  assert.equal(result.wrongKey.verified, false);
  assert.equal(result.changedRequest.verified, false);
  assert.equal(result.tampered.verified, false);
  await writeFile(resolve(out, 'native-camera-browser-results.json'), JSON.stringify({synthetic_image: true,
    physical_device_tested: false, crypto_mocked: false, tests_passed: 4, result}, null, 2));
  console.log('PASS four JNI-to-WASM native camera cases (synthetic capture, real C2PA signature)');
} finally { await browser.close(); }
