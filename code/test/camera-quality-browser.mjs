// SPDX-License-Identifier: AGPL-3.0-only
// Real compiled Rust/WASM and shipped UI on synthetic files; no physical sensors.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const directory = path.resolve(process.argv[2]);
const corpus = JSON.parse(await readFile(path.join(directory, 'native.json'), 'utf8'));
const fixture = name => {
  const item = corpus.cases.find(value => value.name === name);
  assert.ok(item, `Missing synthetic quality case: ${name}`);
  return item;
};
const base = 'http://127.0.0.1:4173';
let browser, server, failure;
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
  // Own this test server and close only its process in finally.
  server = spawn(process.execPath, ['tools/serve.mjs'], {
    env: {...process.env, NONVERBA_BIND: '127.0.0.1', NONVERBA_PORT: '4173'}, stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Quality UI server did not become ready')), 15_000);
    server.once('error', error => {clearTimeout(timer); reject(error);});
    server.once('exit', code => {clearTimeout(timer); reject(new Error(`Quality UI server exited ${code}`));});
    server.stderr.on('data', data => errors.push(`server: ${data}`));
    server.stdout.on('data', data => {if (String(data).includes(base)) {clearTimeout(timer); resolve();}});
  });
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({acceptDownloads: true, viewport: {width: 1365, height: 1000}});
  await context.addInitScript(() => {
    const qa = {hold: false, held: false, release: null, completed: 0, sensorCalls: 0, methods: []};
    window.__qualityQa = qa;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...rest) {
      qa.methods.push(message.method);
      if (message.method === 'analyze_camera_quality') {
        const listener = event => {
          if (event.data?.id === message.id) {qa.completed++; this.removeEventListener('message', listener);}
        };
        this.addEventListener('message', listener);
        if (qa.hold) {
          qa.hold = false; qa.held = true;
          qa.release = () => {qa.held = false; qa.release = null; post.call(this, message, ...rest);};
          return;
        }
      }
      return post.call(this, message, ...rest);
    };
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {qa.sensorCalls++; throw new Error('Physical capture is prohibited in quality tests');};
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition = () => {qa.sensorCalls++; throw new Error('Location is prohibited in quality tests');};
      navigator.geolocation.watchPosition = () => {qa.sensorCalls++; throw new Error('Location is prohibited in quality tests');};
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => document.getElementById('runtime').textContent.includes('Local engine ready'));
  await page.locator('[data-view="verify"]').first().click();
  const readReport = async () => JSON.parse(await page.locator('#camera-quality-record').textContent());
  async function analyze(name) {
    await page.locator('#verify-file').setInputFiles(path.join(directory, fixture(name).file));
    await page.locator('#camera-quality-analyze').click();
    await page.waitForFunction(() => !document.getElementById('camera-quality-save').disabled);
    return readReport();
  }
  await check('unsigned JPEG analysis uses real Rust Worker without verification authority', async () => {
    const measured = await analyze('uniform-gray');
    assert.deepEqual(measured, fixture('uniform-gray').outcome.report);
    assert.match(await page.locator('#camera-quality-regions').textContent(), /Insufficient texture/);
    assert.equal(await page.locator('#accept-evidence').isDisabled(), true);
    assert.equal(await page.locator('#verify-result').isVisible(), false);
  });
  await check('unsigned guidance export keeps the exact Rust image/profile-bound report', async () => {
    const ready = page.waitForEvent('download');
    await page.locator('#camera-quality-save').click();
    const download = await ready;
    const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.deepEqual(exported, fixture('uniform-gray').outcome.report);
    assert.equal(exported.satisfies_successful_measurement, false);
  });
  await check('subject-region changes invalidate old guidance and isolate the flat subject', async () => {
    await page.locator('#verify-file').setInputFiles(path.join(directory, fixture('flat-subject-textured-background').file));
    assert.equal(await page.locator('#camera-quality-save').isDisabled(), true);
    const details = page.locator('#camera-quality-use-region').locator('xpath=ancestor::details[1]');
    await details.locator(':scope > summary').click();
    await page.locator('#camera-quality-use-region').selectOption('subject');
    for (const [axis, value] of Object.entries(fixture('flat-subject-textured-background').profile.subject_region)) {
      await page.locator(`#camera-quality-region-${axis}`).fill(String(value));
    }
    await page.locator('#camera-quality-analyze').click();
    await page.waitForFunction(() => !document.getElementById('camera-quality-save').disabled);
    assert.deepEqual(await readReport(), fixture('flat-subject-textured-background').outcome.report);
    assert.match(await page.locator('#camera-quality-regions').textContent(), /Selected subject region.*Insufficient texture/s);
    await page.locator('#camera-quality-region-width').fill('9000');
    assert.equal(await page.locator('#camera-quality-save').isDisabled(), true);
    await page.locator('#camera-quality-analyze').click();
    await page.waitForFunction(() => !document.getElementById('camera-quality-analyze').disabled);
    assert.equal(await page.locator('#camera-quality-result').isVisible(), false);
  });
  await check('stale real Worker response cannot republish guidance for a replaced file', async () => {
    await page.locator('#camera-quality-use-region').selectOption('full');
    await page.locator('#verify-file').setInputFiles(path.join(directory, fixture('uniform-gray').file));
    const expectedCompleted = await page.evaluate(() => {window.__qualityQa.hold = true; return window.__qualityQa.completed + 1;});
    await page.locator('#camera-quality-analyze').click();
    await page.waitForFunction(() => window.__qualityQa.held);
    await page.locator('#verify-file').setInputFiles(path.join(directory, fixture('uniform-white').file));
    await page.evaluate(() => window.__qualityQa.release());
    await page.waitForFunction(count => window.__qualityQa.completed >= count, expectedCompleted);
    assert.equal(await page.locator('#camera-quality-save').isDisabled(), true);
    assert.equal(await page.locator('#camera-quality-result').isVisible(), false);
    assert.deepEqual(await analyze('uniform-white'), fixture('uniform-white').outcome.report);
  });
  await check('malformed JPEG clears guidance without enabling evidence acceptance', async () => {
    await page.locator('#verify-file').setInputFiles(path.join(directory, fixture('malformed-jpeg').file));
    await page.locator('#camera-quality-analyze').click();
    await page.waitForFunction(() => !document.getElementById('camera-quality-analyze').disabled);
    assert.equal(await page.locator('#camera-quality-result').isVisible(), false);
    assert.equal(await page.locator('#camera-quality-save').isDisabled(), true);
    assert.equal(await page.locator('#accept-evidence').isDisabled(), true);
  });
  await check('analysis never activates camera microphone GPS or a signing operation', async () => {
    const qa = await page.evaluate(() => ({sensorCalls: window.__qualityQa.sensorCalls, methods: window.__qualityQa.methods}));
    assert.equal(qa.sensorCalls, 0);
    assert.equal(qa.methods.some(method => /^(seal_|verify_|create_audio|create_location)/.test(method)), false);
    assert.deepEqual(errors, []);
  });
} catch (error) {failure = String(error?.stack || error);}
finally {
  // Startup failure may yield an unspawned child or a signal-terminated child
  // with exitCode=null. Neither has an exit event left to wait for.
  try {if (browser) await browser.close();}
  catch (error) {errors.push(`browser cleanup: ${error}`); failure ||= String(error?.stack || error);}
  try {
    if (!await stopOwnedServer('SIGTERM', 5000) && !await stopOwnedServer('SIGKILL', 5000)) {
      throw new Error('The owned quality UI server did not stop after SIGKILL');
    }
  } catch (error) {errors.push(`server cleanup: ${error}`); failure ||= String(error?.stack || error);}
}
const output = path.join(directory, `browser-checks-${Date.now()}.json`);
await writeFile(output, JSON.stringify({type: 'nonverba-camera-quality-browser-checks',
  checked_at_utc: new Date().toISOString(), scope: 'Synthetic files, actual Chromium UI and Rust/WASM Worker; no phone or physical sensor',
  passed: !failure, checks, errors, ...(failure ? {error: failure} : {})}, null, 2), {flag: 'wx'});
console.log(`${checks.length} browser quality checks ${failure ? 'completed before failure' : 'passed'}; ${output}`);
if (failure) throw new Error(failure);
