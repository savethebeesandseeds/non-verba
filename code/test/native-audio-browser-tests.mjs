// SPDX-License-Identifier: AGPL-3.0-only
// Real JNI C2PA signatures over deliberately synthetic microphone samples.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../artifacts/qa');
const request = JSON.parse(await readFile(resolve(out, 'native-audio-synthetic-request.json'), 'utf8'));
const transcript = JSON.parse(await readFile(resolve(out, 'native-audio-synthetic-transcript.json'), 'utf8'));
const wav = await readFile(resolve(out, 'native-audio-synthetic.wav'));
const pin = (await readFile(resolve(out, 'native-audio-synthetic-key.txt'), 'utf8')).trim();
const browser = await chromium.launch({headless: true, channel: 'msedge'});
try {
  const page = await browser.newPage();
  await page.goto(`${process.env.NONVERBA_TEST_URL || 'http://127.0.0.1:4174'}/audio.html`);
  const result = await page.evaluate(async ({request, transcript, wav, pin}) => {
    const {createCoreClient} = await import('./core-client.js');
    const core = createCoreClient(), bytes = Uint8Array.from(atob(wav), c => c.charCodeAt(0));
    const verify = (req = request, receipt = transcript, key = pin, input = bytes) =>
      core.json('verify_audio', input, JSON.stringify(req), JSON.stringify(receipt), key, 1800000007);
    const valid = await verify();
    const wrongKey = await verify(request, transcript, '0'.repeat(64));
    const changedReceipt = structuredClone(transcript); changedReceipt.rounds[0].pcm_sha256 = 'f'.repeat(64);
    const tampered = bytes.slice(); tampered[Math.floor(tampered.length / 2)] ^= 1;
    const policy = {version: 1, native_acquisition_required: true, raw_gnss_required: false,
      correlated_camera_clock_required: false, hardware_attestation_required: false, independent_position_required: false};
    const appraise = value => core.json('appraise_audio', bytes, JSON.stringify(request), JSON.stringify(transcript), pin, JSON.stringify(value), 1800000007);
    return {valid, wrongKey, changedReceipt: await verify(request, changedReceipt), tampered: await verify(request, transcript, pin, tampered),
      appraisal: await appraise(policy), unsupported: await appraise({...policy, hardware_attestation_required: true})};
  }, {request, transcript, wav: wav.toString('base64'), pin});
  assert.equal(result.valid.verified, true, JSON.stringify(result.valid.errors));
  assert.equal(result.valid.checks.native_audio_metadata_valid, true);
  assert.equal(result.valid.native_audio.backend, 'android-aaudio');
  assert.equal(result.valid.hardware_attested, false);
  assert.equal(result.valid.physical_freshness_proven, false);
  assert.equal(result.wrongKey.verified, false);
  assert.equal(result.changedReceipt.verified, false);
  assert.equal(result.tampered.verified, false);
  assert.equal(result.appraisal.policy_satisfied, true);
  assert.equal(result.appraisal.local_replay_checked, false);
  assert.equal(result.unsupported.evidence_verified, true);
  assert.equal(result.unsupported.policy_satisfied, false);
  await writeFile(resolve(out, 'native-audio-browser-results.json'), JSON.stringify({synthetic_audio: true,
    physical_device_tested: false, crypto_mocked: false, tests_passed: 6, result}, null, 2));
  console.log('PASS six JNI-to-WASM native audio/appraisal cases (synthetic audio, real C2PA signature)');
} finally { await browser.close(); }
