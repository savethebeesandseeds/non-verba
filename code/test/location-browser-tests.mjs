// SPDX-License-Identifier: AGPL-3.0-only
// Real Chromium geolocation API, Rust/WASM validation and COSE signatures.
// Playwright supplies explicitly synthetic, stationary coordinates. This is not
// physical GPS, Android Keystore, mock-provider detection, or device attestation.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), out = resolve(root, 'artifacts/qa');
const base = process.env.NONVERBA_TEST_URL || 'http://127.0.0.1:4174';
await mkdir(out, {recursive: true});
let browser;
for (const channel of ['msedge', 'chrome', undefined]) {
  try { browser = await chromium.launch({headless: true, ...(channel ? {channel} : {}), args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding']}); break; }
  catch (error) { if (!channel) throw error; }
}
const location = {latitude: 47.4979, longitude: 19.0402, accuracy: 12};
const context = await browser.newContext({acceptDownloads: true, permissions: ['geolocation'], geolocation: location, viewport: {width: 1440, height: 1000}});
await context.addInitScript(() => {
  const qa = {sealCalls: 0, mode: 'normal', duplicateTimestamp: null, held: [], callbacks: 0,
    emulationUpdating: false, emulationResetErrors: 0}; window.__locationQa = qa;
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function(message, ...args) { if (message.method === 'seal_location_proof') qa.sealCalls++; return post.call(this, message, ...args); };
  const geo = navigator.geolocation;
  function wrap(success) { return position => {
    qa.callbacks++;
    if (qa.mode === 'hold') { qa.held.push(() => success(position)); return; }
    let timestamp = position.timestamp, accuracy = position.coords.accuracy;
    if (qa.mode === 'stale') timestamp -= 60000;
    if (qa.mode === 'duplicate') { qa.duplicateTimestamp ??= timestamp; timestamp = qa.duplicateTimestamp; }
    if (qa.mode === 'poor') accuracy = 1000;
    success({timestamp, coords: {latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy,
      altitude: position.coords.altitude, altitudeAccuracy: position.coords.altitudeAccuracy}});
  }; }
  for (const method of ['watchPosition', 'getCurrentPosition']) {
    const original = geo[method].bind(geo);
    geo[method] = (success, failure, options) => original(wrap(success), error => {
      // Chromium briefly disconnects its synthetic provider when CDP refreshes
      // an override. Ignore only this known reset inside the test harness; the
      // production collector still fails closed on real provider errors.
      if (qa.emulationUpdating && error.code === 2 && error.message === '') { qa.emulationResetErrors++; return; }
      failure?.(error);
    }, options);
  }
});
const page = await context.newPage(), errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
const $ = id => page.locator(`#${id}`);
async function check(name, work) {
  const start = Date.now();
  try { await work(); results.push({name, passed: true, ms: Date.now() - start}); console.log(`PASS ${name}`); }
  catch (error) { results.push({name, passed: false, error: String(error)}); await page.screenshot({path: resolve(out, 'location-failure.png'), fullPage: true}); throw error; }
}
async function action(id) { await $(id).click(); await page.waitForFunction(id => !document.getElementById(id).hasAttribute('aria-busy'), id, {timeout: 70000}); }
async function view(name) { await page.locator(`[data-location-view="${name}"]`).click(); }
async function pump(work) {
  let stopped = false;
  const updating = (async () => { while (!stopped) {
    await page.evaluate(() => { window.__locationQa.emulationUpdating = true; });
    await context.setGeolocation(location);
    await new Promise(resolve => setTimeout(resolve, 100));
    await page.evaluate(() => { window.__locationQa.emulationUpdating = false; });
    await new Promise(resolve => setTimeout(resolve, 600));
  } })();
  try { return await work(); } finally { stopped = true; await updating; }
}
async function download(id, file) { const pending = page.waitForEvent('download'); await action(id); const value = await pending; await value.saveAs(resolve(out, file)); return readFile(resolve(out, file)); }
async function newRequest(profile = 'browser-or-native') {
  await view('requester'); await $('location-requester-name').fill('Synthetic location QA'); await $('location-task').fill('Stationary synthetic provider integration test');
  const details = $('location-profile').locator('xpath=ancestor::details[1]');
  if (!await details.evaluate(element => element.open)) await details.locator(':scope > summary').click();
  await $('location-profile').selectOption(profile); await action('location-create-request'); const request = JSON.parse(await $('location-created-request').inputValue());
  await action('location-use-request'); return request;
}
async function verifyProof(file, request, pin) {
  await view('verify'); await $('location-proof-file').setInputFiles(resolve(out, file)); await $('location-verify-request').fill(JSON.stringify(request));
  await $('location-verify-key').fill(pin); await action('location-verify-button'); return JSON.parse(await $('location-report-json').textContent());
}
let demoRequest, firstKey, envelope;
try {
  await page.goto(`${base}/location.html`); await page.waitForFunction(() => !document.getElementById('location-demo').disabled, {timeout: 60000});
  await check('stationary real browser measurements produce a labelled COSE demo', async () => {
    await pump(() => action('location-demo'));
    assert.equal(await $('location-result').isVisible(), true, await $('location-notice').textContent());
    demoRequest = JSON.parse(await $('location-request-input').inputValue()); assert.equal(demoRequest.demo, true);
    firstKey = await $('location-key-id').textContent(); assert.match(firstKey, /^[0-9a-f]{64}$/);
    envelope = JSON.parse((await download('location-save-proof', 'location-demo-proof.json')).toString());
    await writeFile(resolve(out, 'location-demo-request.json'), JSON.stringify(demoRequest, null, 2));
    await writeFile(resolve(out, 'location-public-key.txt'), firstKey);
  });
  await check('local verification exposes lower browser assurance and distinct measurement span', async () => {
    await action('location-inspect-proof'); const report = JSON.parse(await $('location-report-json').textContent());
    assert.equal(report.verified, true); assert.equal(report.demo, true); assert.equal(report.profile, 'software-browser');
    assert.equal(report.location_authenticity_proven, false); assert.equal(report.hardware_attested, false); assert.equal(report.clock_trusted, false);
    const samples = report.evidence.trace.samples; assert.ok(samples.length >= 3);
    assert.ok(samples.at(-1).fix_timestamp_ms - samples[0].fix_timestamp_ms >= 10000);
    assert.ok(samples.every(s => s.latitude === location.latitude && s.longitude === location.longitude && s.mock === null && s.fix_elapsed_ms === null));
    assert.match(await $('location-verification-dimensions').textContent(), /unknown/);
    await download('location-save-report', 'location-demo-verification.json');
    await page.screenshot({path: resolve(out, 'location-desktop.png'), fullPage: true});
  });
  await check('proof downloads remain repeatable and byte-identical', async () => {
    await view('operator'); const repeat = await download('location-save-proof', 'location-demo-proof-repeat.json');
    assert.deepEqual(repeat, await readFile(resolve(out, 'location-demo-proof.json')));
  });
  await check('wrong public location key fails verification', async () => {
    const report = await verifyProof('location-demo-proof.json', demoRequest, '0'.repeat(64)); assert.equal(report.verified, false); assert.equal(report.checks.device_match, false);
  });
  await check('modified requester challenge fails verification', async () => {
    const changed = structuredClone(demoRequest); changed.challenge.task += ' changed';
    const report = await verifyProof('location-demo-proof.json', changed, firstKey); assert.equal(report.verified, false); assert.equal(report.checks.request_match, false);
  });
  await check('tampering the COSE signature fails', async () => {
    const bytes = Buffer.from(envelope.proof_base64, 'base64'); bytes[bytes.length - 1] ^= 1;
    await writeFile(resolve(out, 'location-tampered-proof.json'), JSON.stringify({...envelope, proof_base64: bytes.toString('base64')}));
    const report = await verifyProof('location-tampered-proof.json', demoRequest, firstKey); assert.equal(report.verified, false); assert.equal(report.checks.signature_integrity, false);
  });
  await check('a completed location nonce cannot be collected again in this profile', async () => {
    await view('operator'); await $('location-request-input').fill(JSON.stringify(demoRequest)); await action('location-load-request');
    assert.match(await $('location-notice').textContent(), /already used/); assert.equal(await $('location-collect').isDisabled(), true);
  });
  await check('native-required policy refuses browser fallback', async () => {
    await newRequest('native-required'); const before = await page.evaluate(() => window.__locationQa.sealCalls); await action('location-collect');
    assert.match(await $('location-notice').textContent(), /native Android/); assert.equal(await page.evaluate(() => window.__locationQa.sealCalls), before);
    assert.equal(await $('location-result').isVisible(), false);
  });
  await check('raw satellite policy is retained by Rust and cannot downgrade to browser collection', async () => {
    const request = await newRequest('raw-gnss');
    assert.equal(request.policy.profile, 'native-required');
    assert.equal(request.policy.required_provider, 'gnss');
    assert.equal(request.policy.raw_gnss.mode, 'required');
    const before = await page.evaluate(() => window.__locationQa.sealCalls);
    await action('location-collect');
    assert.match(await $('location-notice').textContent(), /native Android/);
    assert.equal(await page.evaluate(() => window.__locationQa.sealCalls), before);
    assert.equal(await $('location-result').isVisible(), false);
  });
  await check('permission denial signs nothing and leaves nonce unconsumed', async () => {
    const request = await newRequest(); await context.clearPermissions(); await context.grantPermissions([]);
    const before = await page.evaluate(() => window.__locationQa.sealCalls); await action('location-collect');
    assert.match(await $('location-notice').textContent(), /permission.*denied/i); assert.equal(await page.evaluate(() => window.__locationQa.sealCalls), before);
    assert.equal(await page.evaluate(async id => { const {read} = await import('./storage.js'); return (await read('captures', `location:${id}`)) ?? null; }, request.challenge.id), null);
    await context.grantPermissions(['geolocation']);
  });
  for (const mode of ['stale', 'duplicate', 'poor']) await check(`${mode} provider reports cannot satisfy collection`, async () => {
    await newRequest(); await page.evaluate(mode => { window.__locationQa.mode = mode; window.__locationQa.duplicateTimestamp = null; }, mode);
    const before = await page.evaluate(() => window.__locationQa.sealCalls);
    await pump(async () => { await $('location-collect').click(); await page.waitForTimeout(mode === 'duplicate' ? 11500 : 1800); assert.equal(await $('location-result').isVisible(), false); await $('location-cancel').click(); });
    await page.waitForFunction(() => !document.getElementById('location-collect').hasAttribute('aria-busy'));
    assert.equal(await page.evaluate(() => window.__locationQa.sealCalls), before); await page.evaluate(() => { window.__locationQa.mode = 'normal'; });
  });
  await check('navigation cancels collection and ignores held late provider callbacks', async () => {
    await newRequest(); await page.evaluate(() => { window.__locationQa.mode = 'hold'; }); const before = await page.evaluate(() => window.__locationQa.sealCalls);
    await pump(async () => { await $('location-collect').click(); await page.waitForFunction(() => window.__locationQa.held.length > 0); await view('verify'); });
    await page.evaluate(() => { window.__locationQa.mode = 'normal'; for (const callback of window.__locationQa.held.splice(0)) callback(); });
    await page.waitForTimeout(100); assert.equal(await page.evaluate(() => window.__locationQa.sealCalls), before);
  });
  await check('prepared collection binds the exact JPEG and detects missing or replaced media', async () => {
    const result = await pump(() => page.evaluate(async () => {
      const {createCoreClient} = await import('./core-client.js');
      const {beginLocationCollection, finalizeLocationProof} = await import('./location-capture.js');
      const {loadIdentity} = await import('./storage.js');
      const {bytesToBase64, locationProofEnvelope} = await import('./location-platform.js');
      const engine = createCoreClient(), now = () => Math.floor(Date.now() / 1000);
      const request = await engine.json('create_location_demo_request', now());
      const identity = await loadIdentity(), key = await engine.json('location_identity', identity);
      const collection = await beginLocationCollection({engine, request});
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
      const paint = canvas.getContext('2d'); paint.fillStyle = '#557744'; paint.fillRect(0, 0, 64, 64);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      const media = new Uint8Array(await blob.arrayBuffer());
      const proof = await finalizeLocationProof({engine, collection, identity, mediaBytes: media});
      const asset = await engine.json('location_asset', media);
      const valid = await engine.json('verify_location_proof', proof, JSON.stringify(request), key.fingerprint, JSON.stringify(asset), now());
      const missing = await engine.json('verify_location_proof', proof, JSON.stringify(request), key.fingerprint, 'null', now());
      const replaced = await engine.json('verify_location_proof', proof, JSON.stringify(request), key.fingerprint, JSON.stringify({...asset, sha256: '0'.repeat(64)}), now());
      return {request, pin: key.fingerprint, envelope: locationProofEnvelope(proof), media: bytesToBase64(media), valid, missing, replaced};
    }));
    assert.equal(result.valid.verified, true); assert.equal(result.valid.checks.asset_binding, true);
    assert.equal(result.valid.evidence.trace.capture_correlation, 'application-submission-interval');
    assert.equal(result.missing.verified, false); assert.equal(result.missing.checks.asset_binding, false);
    assert.equal(result.replaced.verified, false); assert.equal(result.replaced.checks.asset_binding, false);
    await writeFile(resolve(out, 'location-media-bound-proof.json'), JSON.stringify(result.envelope, null, 2));
    await writeFile(resolve(out, 'location-bound-synthetic.jpg'), Buffer.from(result.media, 'base64'));
    await writeFile(resolve(out, 'location-media-bound-verification.json'), JSON.stringify(result.valid, null, 2));
    await view('verify'); await $('location-bound-media').setInputFiles(resolve(out, 'location-bound-synthetic.jpg'));
    const ui = await verifyProof('location-media-bound-proof.json', result.request, result.pin); assert.equal(ui.verified, true);
    await $('location-bound-media').setInputFiles([]);
  });
  await check('demo repeats with a new nonce and the same location identity', async () => {
    await pump(() => action('location-demo')); assert.equal(await $('location-result').isVisible(), true, await $('location-notice').textContent());
    const next = JSON.parse(await $('location-request-input').inputValue()); assert.notEqual(next.challenge.id, demoRequest.challenge.id);
    assert.equal(await $('location-key-id').textContent(), firstKey);
    await page.setViewportSize({width: 390, height: 844}); await page.screenshot({path: resolve(out, 'location-mobile.png'), fullPage: true});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
  await check('no uncaught browser errors', async () => assert.deepEqual(errors, []));
} finally {
  const emulation_reset_errors_filtered = await page.evaluate(() => window.__locationQa?.emulationResetErrors || 0);
  await writeFile(resolve(out, 'location-browser-results.json'), JSON.stringify({url: base, browser: browser.version(), synthetic_stationary_geolocation: location, emulation_reset_errors_filtered, physical_device_tested: false, crypto_mocked: false, results}, null, 2));
  await browser.close();
}
