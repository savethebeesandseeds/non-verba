// SPDX-License-Identifier: AGPL-3.0-only
// Reuse a previously delivered JPEG through the shipped UI and real Rust/WASM.
// Native expected measurements are inputs; this driver does not verify the
// JPEG's signature, calibrate thresholds, or operate a physical sensor.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile, stat, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';

const [imagePath, expectedJsonPath, outputJsonPath] = process.argv.slice(2);
for (const [name, value] of Object.entries({imagePath, expectedJsonPath, outputJsonPath})) {
  assert.ok(typeof value === 'string' && path.isAbsolute(value), `${name} must be an absolute Linux path`);
}
assert.equal(process.argv.length, 5, 'Supply imagePath, expectedJsonPath and outputJsonPath only');
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const base = 'http://127.0.0.1:4173';
let browser, server, failure, expected, observedImageHash, byteLength;
const checks = [], errors = [];
async function check(name, operation) {
  await operation();
  checks.push({name, passed: true});
  console.log(`PASS ${name}`);
}
async function stopOwnedServer(signal, timeoutMs) {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return true;
  return new Promise((resolve, reject) => {
    let timer;
    const finish = value => {clearTimeout(timer); server.removeListener('exit', exited); server.removeListener('error', failed); resolve(value);};
    const exited = () => finish(true);
    const failed = error => {clearTimeout(timer); server.removeListener('exit', exited); server.removeListener('error', failed); reject(error);};
    server.once('exit', exited);
    server.once('error', failed);
    timer = setTimeout(() => finish(false), timeoutMs);
    try {server.kill(signal);} catch (error) {failed(error);}
  });
}

try {
  await check('retained original JPEG hash and native expectations cover the full 12-million-pixel image', async () => {
    const source = await stat(imagePath);
    assert.ok(source.isFile() && source.size > 0 && source.size <= 32 * 1024 * 1024, 'Choose a bounded delivered JPEG');
    const bytes = await readFile(imagePath);
    byteLength = bytes.byteLength;
    assert.equal(byteLength, source.size);
    observedImageHash = createHash('sha256').update(bytes).digest('hex');
    expected = JSON.parse(await readFile(expectedJsonPath, 'utf8'));
    assert.equal(observedImageHash, expected.image_sha256, 'Original image bytes changed');
    for (const report of [expected.full_report, expected.subject_report, expected.edge_report]) {
      assert.equal(report.type, 'nonverba-camera-quality-report');
      assert.equal(report.version, 1);
      assert.equal(report.image_sha256, observedImageHash);
      assert.equal(report.image.byte_length, byteLength);
      assert.equal(report.image.oriented_width * report.image.oriented_height, 12_000_000);
      assert.equal(report.guidance_only, true);
      assert.equal(report.satisfies_successful_measurement, false);
      assert.equal(report.authenticity_proven, false);
    }
    assert.equal(expected.full_report.profile.subject_region, null);
    assert.deepEqual(expected.subject_report.profile, expected.subject_profile);
    assert.deepEqual(expected.edge_report.profile, expected.edge_profile);
    assert.deepEqual(expected.subject_profile.subject_region, {x: 1500, y: 2000, width: 1500, height: 2000});
    assert.deepEqual(expected.edge_profile.subject_region, {x: 2999, y: 3999, width: 1, height: 1});
  });

  // Start and terminate only this driver's loopback server. A foreign server
  // occupying the port causes startup failure rather than being reused.
  server = spawn(process.execPath, ['tools/serve.mjs'], {
    env: {...process.env, NONVERBA_BIND: '127.0.0.1', NONVERBA_PORT: '4173'}, stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Delivered quality UI server did not become ready')), 15_000);
    server.once('error', error => {clearTimeout(timer); reject(error);});
    server.once('exit', code => {clearTimeout(timer); reject(new Error(`Delivered quality UI server exited ${code}`));});
    server.stderr.on('data', data => errors.push(`server: ${data}`));
    server.stdout.on('data', data => {if (String(data).includes(base)) {clearTimeout(timer); resolve();}});
  });
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({acceptDownloads: true, viewport: {width: 1365, height: 1000}});
  await context.addInitScript(() => {
    const qa = {sensorCalls: 0, audioCalls: 0, signingCalls: 0, methods: [], exports: []};
    window.__deliveredQualityQa = qa;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...rest) {
      qa.methods.push(message.method);
      return post.call(this, message, ...rest);
    };
    const createObjectURL = URL.createObjectURL;
    URL.createObjectURL = function(blob) {
      qa.exports.push({mime_type: blob.type, byte_length: blob.size});
      return createObjectURL.call(this, blob);
    };
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = async () => {qa.sensorCalls++; throw new Error('Physical capture is prohibited in delivered quality tests');};
      if (navigator.mediaDevices.getDisplayMedia) navigator.mediaDevices.getDisplayMedia = async () => {qa.sensorCalls++; throw new Error('Screen capture is prohibited in delivered quality tests');};
    }
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition = () => {qa.sensorCalls++; throw new Error('Location is prohibited in delivered quality tests');};
      navigator.geolocation.watchPosition = () => {qa.sensorCalls++; throw new Error('Location is prohibited in delivered quality tests');};
    }
    for (const name of ['AudioContext', 'webkitAudioContext']) {
      if (window[name]) window[name] = function() {qa.audioCalls++; throw new Error('Audio processing is prohibited in delivered quality tests');};
    }
    if (crypto.subtle) crypto.subtle.sign = async () => {qa.signingCalls++; throw new Error('Signing is prohibited in delivered quality tests');};
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => document.getElementById('runtime').textContent.includes('Local engine ready'));
  await page.locator('[data-view="verify"]').first().click();
  await page.locator('#verify-file').setInputFiles(imagePath);
  const readReport = async () => JSON.parse(await page.locator('#camera-quality-record').textContent());
  const assertNoAcceptance = async () => {
    assert.equal(await page.locator('#accept-evidence').isDisabled(), true);
    assert.equal(await page.locator('#verify-result').isVisible(), false);
  };
  const assertCleared = async () => {
    assert.equal(await page.locator('#camera-quality-save').isDisabled(), true);
    assert.equal(await page.locator('#camera-quality-result').isVisible(), false);
    assert.equal(await page.locator('#camera-quality-record').textContent(), '');
    await assertNoAcceptance();
  };
  async function analyze(expectedReport) {
    await page.locator('#camera-quality-analyze').click();
    await page.waitForFunction(() => !document.getElementById('camera-quality-save').disabled, null, {timeout: 120_000});
    const measured = await readReport();
    assert.deepEqual(measured, expectedReport, 'Actual Worker metrics differ from native expected metrics');
    await assertNoAcceptance();
    return measured;
  }
  async function saveExact(expectedReport) {
    const displayed = await page.locator('#camera-quality-record').textContent();
    const ready = page.waitForEvent('download');
    await page.locator('#camera-quality-save').click();
    const download = await ready;
    assert.equal(download.suggestedFilename(), `nonverba-camera-quality-${observedImageHash.slice(0, 12)}.json`);
    const exportedBytes = await readFile(await download.path());
    assert.deepEqual(exportedBytes, Buffer.from(displayed, 'utf8'), 'Export bytes differ from the displayed complete quality record');
    const blob = await page.evaluate(() => window.__deliveredQualityQa.exports.at(-1));
    assert.deepEqual(blob, {mime_type: 'application/json', byte_length: exportedBytes.byteLength});
    const text = exportedBytes.toString('utf8');
    assert.deepEqual(JSON.parse(text), expectedReport);
    await assertNoAcceptance();
  }
  async function setRegion(profile) {
    await page.locator('#camera-quality-use-region').selectOption('subject');
    for (const [axis, value] of Object.entries(profile.subject_region)) {
      await page.locator(`#camera-quality-region-${axis}`).fill(String(value));
    }
    await assertCleared();
  }
  function assertBaselineRegionsUnchanged(measured) {
    const baseline = expected.full_report;
    assert.equal(measured.image_sha256, baseline.image_sha256);
    assert.notEqual(measured.analysis_profile_sha256, baseline.analysis_profile_sha256);
    for (const region of baseline.regions) {
      assert.deepEqual(measured.regions.find(item => item.id === region.id), region, `Adding a subject region changed ${region.id}`);
    }
  }
  await check('full delivered JPEG produces exact native metrics through the real Rust/WASM Worker', async () => {
    const measured = await analyze(expected.full_report);
    assert.equal(measured.image.oriented_width, 3000);
    assert.equal(measured.image.oriented_height, 4000);
    assert.equal(await page.locator('#camera-quality-dimensions').textContent(), 'Image resolution: 3000 × 4000 pixels.');
    assert.equal(await page.locator('#verify-challenge').inputValue(), '');
    assert.equal(await page.locator('#verify-device').inputValue(), '');
    const full = measured.regions.find(region => region.id === 'full_frame');
    assert.deepEqual(full.bounds, {x: 0, y: 0, width: 3000, height: 4000});
    assert.equal(full.exposure.sample_count, 12_000_000);
  });
  await check('full-image JSON export preserves the exact unsigned native-expected record', async () => {
    await saveExact(expected.full_report);
  });
  await check('subject profile invalidates old guidance and produces exact native regional metrics', async () => {
    const details = page.locator('#camera-quality-use-region').locator('xpath=ancestor::details[1]');
    await details.locator(':scope > summary').click();
    await setRegion(expected.subject_profile);
    const measured = await analyze(expected.subject_report);
    assert.deepEqual(measured.profile, expected.subject_profile);
    assertBaselineRegionsUnchanged(measured);
    const subject = measured.regions.find(region => region.id === 'subject');
    assert.deepEqual(subject.bounds, expected.subject_profile.subject_region);
    assert.equal(subject.exposure.sample_count, 3_000_000);
    const {id: subjectId, ...subjectMetrics} = subject;
    const {id: gridId, ...gridMetrics} = expected.full_report.regions.find(region => region.id === 'grid_1_1');
    assert.equal(subjectId, 'subject');
    assert.equal(gridId, 'grid_1_1');
    assert.deepEqual(subjectMetrics, gridMetrics, 'Same geometric pixels differ between the explicit subject and fixed grid region');
    assert.match(await page.locator('#camera-quality-regions').textContent(), /Selected subject region/);
  });
  await check('subject-region JSON export preserves exact profile and all native-expected metrics', async () => {
    await saveExact(expected.subject_report);
  });
  await check('bottom-right edge pixel has exact ROI coverage and explicit insufficient-data measurements', async () => {
    await setRegion(expected.edge_profile);
    const measured = await analyze(expected.edge_report);
    assertBaselineRegionsUnchanged(measured);
    assert.notEqual(measured.analysis_profile_sha256, expected.subject_report.analysis_profile_sha256);
    const subject = measured.regions.find(region => region.id === 'subject');
    assert.deepEqual(subject.bounds, {x: measured.image.oriented_width - 1, y: measured.image.oriented_height - 1, width: 1, height: 1});
    assert.equal(subject.exposure.sample_count, 1);
    assert.equal(subject.exposure.histogram.reduce((sum, count) => sum + count, 0), 1);
    assert.deepEqual(subject.sharpness.map(metric => metric.scale), [1, 2, 4]);
    for (const metric of subject.sharpness) {
      assert.equal(metric.sample_count, 0);
      assert.equal(metric.nonzero_gradient_count, 0);
      assert.equal(metric.gradient_squared_sum, 0);
      assert.equal(metric.assessment, 'insufficient-data');
    }
    const line = page.locator('#camera-quality-regions p').filter({hasText: 'Selected subject region'});
    assert.match(await line.textContent(), /Insufficient data to assess sharpness/);
  });
  await check('out-of-bounds region clears the prior report and never enables evidence acceptance', async () => {
    await page.locator('#camera-quality-region-x').fill('3000');
    await assertCleared();
    await page.locator('#camera-quality-analyze').click();
    await page.waitForFunction(() => !document.getElementById('camera-quality-analyze').disabled);
    await assertCleared();
    assert.match(await page.locator('#camera-quality-status').textContent(), /region|outside|bounds/i);
  });
  await check('delivered-file analysis invokes no capture GPS audio signing or evidence verification', async () => {
    const qa = await page.evaluate(() => window.__deliveredQualityQa);
    assert.equal(qa.sensorCalls, 0);
    assert.equal(qa.audioCalls, 0);
    assert.equal(qa.signingCalls, 0);
    assert.ok(qa.methods.length > 0);
    assert.equal(qa.methods.every(method => ['camera_quality_profile', 'analyze_camera_quality'].includes(method)), true);
    assert.equal(qa.methods.filter(method => method === 'analyze_camera_quality').length, 4);
    await assertNoAcceptance();
    assert.deepEqual(errors, []);
  });
  await check('reused original image remains byte-identical after all UI analysis and exports', async () => {
    const after = await readFile(imagePath);
    assert.equal(after.byteLength, byteLength);
    assert.equal(createHash('sha256').update(after).digest('hex'), observedImageHash);
  });
} catch (error) {failure = String(error?.stack || error);}
finally {
  try {if (browser) await browser.close();}
  catch (error) {errors.push(`browser cleanup: ${error}`); failure ||= String(error?.stack || error);}
  try {
    if (!await stopOwnedServer('SIGTERM', 5000) && !await stopOwnedServer('SIGKILL', 5000)) {
      throw new Error('The owned delivered quality UI server did not stop after SIGKILL');
    }
  } catch (error) {errors.push(`server cleanup: ${error}`); failure ||= String(error?.stack || error);}
}
await writeFile(outputJsonPath, JSON.stringify({type: 'nonverba-camera-quality-delivered-browser-checks',
  checked_at_utc: new Date().toISOString(), scope: 'Previously delivered JPEG reused off-device; actual Chromium UI and Rust/WASM Worker; no new capture or calibration',
  signature_checked: false, image_sha256: observedImageHash ?? null, byte_length: byteLength ?? null,
  passed: !failure, checks, errors, ...(failure ? {error: failure} : {})}, null, 2), {flag: 'wx'});
console.log(`${checks.length} delivered browser quality checks ${failure ? 'completed before failure' : 'passed'}; ${outputJsonPath}`);
if (failure) throw new Error(failure);
