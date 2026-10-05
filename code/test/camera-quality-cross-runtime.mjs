// SPDX-License-Identifier: AGPL-3.0-only
// Compare complete measured results and errors from the identical JPEG/profile.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const directory = path.resolve(process.argv[2]);
const modulePath = path.resolve(process.argv[3] || '../web/dist/pkg/nonverba_core.js');
const corpus = JSON.parse(await readFile(path.join(directory, 'native.json'), 'utf8'));
const core = await import(pathToFileURL(modulePath));
await core.default({module_or_path: await readFile(path.join(path.dirname(modulePath), 'nonverba_core_bg.wasm'))});
assert.deepEqual(JSON.parse(core.camera_quality_profile()), corpus.default_profile);
const checks = [];
let failure;
try {
  for (const item of corpus.cases) {
    const bytes = new Uint8Array(await readFile(path.join(directory, item.file)));
    const shouldReject = ['outside-roi', 'unknown-profile-field', 'unsupported-profile', 'malformed-jpeg'].includes(item.name);
    assert.equal(Object.hasOwn(item.outcome, 'error'), shouldReject,
      `Native fixture did not meet its intended measured/rejected outcome: ${item.name}`);
    let outcome;
    try { outcome = {report: JSON.parse(core.analyze_camera_quality(bytes, JSON.stringify(item.profile)))}; }
    catch (error) { outcome = {error: String(error?.message || error)}; }
    assert.deepEqual(outcome, item.outcome, `Exact native/WASM quality disagreement: ${item.name}`);
    if (outcome.report) {
      assert.equal(outcome.report.guidance_only, true);
      assert.equal(outcome.report.satisfies_successful_measurement, false);
      assert.equal(outcome.report.authenticity_proven, false);
    }
    checks.push({name: item.name, passed: true, outcome: outcome.error ? 'rejected' : 'measured'});
  }
  const signed = corpus.signed_fixture;
  const delivered = new Uint8Array(await readFile(path.join(directory, signed.file)));
  const integrity = JSON.parse(await core.verify_image(delivered, signed.challenge_json, signed.pin, signed.verification_time));
  assert.equal(integrity.verified, true, JSON.stringify(integrity.errors));
  const quality = corpus.cases.find(item => item.name === 'delivered-c2pa-jpeg').outcome.report;
  let substituted = false;
  try {
    const result = JSON.parse(await core.verify_image(new TextEncoder().encode(JSON.stringify(quality)), signed.challenge_json, signed.pin, signed.verification_time));
    substituted = result.verified === true;
  } catch {}
  assert.equal(substituted, false, 'Unsigned quality JSON must not pass as a signed photo');
  checks.push({name: 'existing C2PA integrity and quality-artifact substitution separation', passed: true, outcome: 'verified-and-separated'});
} catch (error) { failure = String(error?.stack || error); }
const report = {type: 'nonverba-camera-quality-native-wasm-comparison', checked_at_utc: new Date().toISOString(),
  scope: 'Exact whole-report and error equality on synthetic fixtures; no numeric tolerances, phone, signing or acceptance',
  passed: !failure, checks, ...(failure ? {error: failure} : {})};
const output = path.join(directory, `wasm-parity-${Date.now()}.json`);
await writeFile(output, JSON.stringify(report, null, 2), {flag: 'wx'});
console.log(`${checks.length} exact native/WASM quality cases ${failure ? 'completed before failure' : 'passed'}; ${output}`);
if (failure) throw new Error(failure);
