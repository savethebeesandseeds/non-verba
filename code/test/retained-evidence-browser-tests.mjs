// SPDX-License-Identifier: AGPL-3.0-only
// Actual Chromium/IndexedDB and Rust/WASM with synthetic signed pixels/location.
// No camera, microphone, geolocation, WebRTC, USB, or physical clock claims.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Run inside non-verba-dev.');
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'artifacts/qa/retained-evidence-browser-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid);
await mkdir(output);
const template = JSON.parse(await readFile(resolve(root, 'crates/nonverba-core/src/location_proof/raw_gnss_fixture.json'), 'utf8'));
const base = 'http://127.0.0.1:4173';
const epoch = 2_000_000_000_000;
const results = [], errors = [];
let server, browser, context;
let serverOutput = '';

async function check(name, run) {
  const start = Date.now();
  try { await run(); results.push({name, passed:true, duration_ms:Date.now() - start}); console.log('PASS ' + name); }
  catch (error) { results.push({name, passed:false, error:String(error.stack || error)}); throw error; }
}

try {
  // Own one bounded preview process and stop exactly that child in finally.
  server = spawn(process.execPath, ['tools/serve.mjs'], {cwd:root,
    env:{...process.env, NONVERBA_BIND:'127.0.0.1', NONVERBA_PORT:'4173'}, stdio:['ignore','pipe','pipe']});
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preview did not start within ten seconds.')), 10000);
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error('Preview exited: ' + code)); });
    server.stdout.on('data', data => { serverOutput += data; if (serverOutput.includes('Non-verba camera:')) { clearTimeout(timer); resolve(); } });
    server.stderr.on('data', data => { serverOutput += data; });
  });
  browser = await chromium.launch({headless:true, args:['--mute-audio'],
    ...(process.env.NONVERBA_BROWSER_EXECUTABLE ? {executablePath:process.env.NONVERBA_BROWSER_EXECUTABLE} : {})});
  context = await browser.newContext({viewport:{width:1280, height:1000}});
  await context.addInitScript(({epoch}) => {
    // Explicit fixture clocks reset from the test URL on reload. Never shipped.
    window.__retainedClock = Number(new URL(location.href).searchParams.get('fixtureClock')) || epoch;
    Date.now = () => window.__retainedClock;
    Object.defineProperty(performance, 'now', {value:() => window.__retainedClock - epoch + 10000});
    window.__retainedSensors = 0;
    const forbidden = () => { window.__retainedSensors++; throw new Error('Sensor access is forbidden in retained-evidence testing.'); };
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = forbidden;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition = forbidden;
      navigator.geolocation.watchPosition = forbidden;
    }
    const post = Worker.prototype.postMessage;
    window.__retainedHeld = false;
    Worker.prototype.postMessage = function(message, ...rest) {
      if (window.__retainedHoldNext && message?.method === 'verify_evidence_session_receipt') {
        window.__retainedHoldNext = false; window.__retainedHeld = true;
        window.__retainedRelease = () => { window.__retainedHeld = false; post.call(this, message, ...rest); };
        return;
      }
      post.call(this, message, ...rest);
    };
  }, {epoch});
  let page = await context.newPage();
  const observe = page => { page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message)); };
  observe(page);
  async function open(at = epoch + 13000) {
    await page.goto(`${base}/?fixtureClock=${at}`);
    await page.locator('#retained-evidence-panel > summary').click();
    await page.waitForFunction(() => document.getElementById('runtime')?.textContent.includes('ready'));
  }
  async function load(id, expected = 'Retained verification finished') {
    await page.locator('#retained-evidence-id').fill(id);
    await page.locator('#retained-evidence-load').click();
    await page.waitForFunction(text => document.getElementById('retained-evidence-status').textContent.includes(text), expected);
  }
  const acceptedRecord = id => page.evaluate(async id => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('nonverba-agent-evidence-v1', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('accepted'), request = tx.objectStore('accepted').get(`session:${id}`);
        tx.oncomplete = () => resolve(request.result || null); tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, id);
  await open(epoch);
  const fixtures = await page.evaluate(async ({template, epoch}) => {
    const {createCoreClient} = await import('./core-client.js');
    const {AgentRequester} = await import('./agent-requester.js');
    const engine = createCoreClient(); await engine.ready;
    const media = await engine.call('create_identity'), locationKey = await engine.call('create_identity');
    const mediaPin = JSON.parse(media).fingerprint;
    const locationPin = (await engine.json('live_requester_identity', locationKey)).pin.sha256;
    const canvas = new OffscreenCanvas(640, 480), ctx = canvas.getContext('2d');
    for (let y = 0; y < 480; y += 8) for (let x = 0; x < 640; x += 8) {
      ctx.fillStyle = `rgb(${48 + x / 4 % 160},${48 + y / 3 % 160},${64 + (x + y) / 5 % 128})`;
      ctx.fillRect(x, y, 8, 8);
    }
    const jpeg = new Uint8Array(await (await canvas.convertToBlob({type:'image/jpeg', quality:0.95})).arrayBuffer());
    const fixtures = {};
    for (const label of ['image', 'camera-location', 'cancel', 'expired']) {
      const kind = label === 'camera-location' ? label : 'image';
      window.__retainedClock = epoch;
      const client = new AgentRequester(engine);
      try {
        let request, trace;
        const started = await client.start(async (_, at) => {
          const challenge = await engine.json('create_challenge', 'Synthetic requester', 'Retained evidence regression only', at, 900);
          trace = structuredClone(template); delete trace.raw_gnss; delete trace.request.policy.raw_gnss;
          trace.request.challenge = challenge; trace.request.context = {session_id:'retained-browser-fixture', purpose:'camera'};
          trace.request.policy.profile = 'browser-or-native'; trace.request.policy.required_provider = 'any';
          trace.profile = 'software-browser'; trace.permission_precision = 'browser'; trace.uncertainty_semantics = 'w3c-95-percent';
          for (const sample of trace.samples) { sample.provider = 'browser-geolocation'; sample.fix_elapsed_ms = null; sample.mock = null; }
          request = kind === 'image' ? challenge : trace.request;
          return {version:1, evidence:{type:kind, request},
            operator_pins:{media_certificate_sha256:mediaPin, location_spki_sha256:kind === 'image' ? null : locationPin},
            policy:{version:1, native_acquisition_required:false, raw_gnss_required:false, correlated_camera_clock_required:false,
              hardware_attestation_required:false, independent_position_required:false},
            delivery:{max_response_ms:90000, max_receipt_age_ms:60000}};
        }, {send:async () => {}});
        window.__retainedClock = epoch + 12000;
        const last = trace.samples.at(-1);
        const fix = JSON.stringify({latitude:last.latitude, longitude:last.longitude, accuracy_m:last.accuracy_m,
          altitude_m:last.altitude_m, altitude_accuracy_m:last.altitude_accuracy_m, timestamp_ms:last.fix_timestamp_ms, source:'device-geolocation'});
        const args = [jpeg, JSON.stringify(kind === 'image' ? request : request.challenge), media, (epoch + 12000) / 1000, fix];
        const primary = kind === 'image' ? await engine.call('seal_image', ...args)
          : await engine.call('seal_image_with_location_request', ...args, JSON.stringify(request));
        let secondary = new Uint8Array();
        if (kind !== 'image') secondary = await engine.call('seal_location_proof', JSON.stringify(trace), locationKey,
          await engine.call('location_asset', primary), (epoch + 12000) / 1000);
        if (typeof secondary === 'string') secondary = new TextEncoder().encode(secondary);
        const result = await client.receive(started.sessionId, {primary, secondary});
        if (result.report.verified !== true) throw new Error('Synthetic fixture failed real verification.');
        fixtures[label] = started.sessionId;
      } finally { client.close(); }
    }
    return fixtures;
  }, {template, epoch});

  await check('Reload restores original bytes and current requester identity without capture', async () => {
    await open(); await load(fixtures.image);
    assert.match(await page.locator('#retained-evidence-acceptance').textContent(), /No acceptance recorded/);
    assert.match(await page.locator('#retained-evidence-verification').textContent(), /receipt verified/);
    assert.equal(await acceptedRecord(fixtures.image), null);
  });
  let firstAcceptance;
  await check('Explicit acceptance commits once in actual IndexedDB', async () => {
    await page.locator('#retained-evidence-accept').click();
    await page.waitForFunction(() => document.getElementById('retained-evidence-status').textContent.includes('accepted once'));
    firstAcceptance = await acceptedRecord(fixtures.image);
    assert.equal(firstAcceptance.acceptance_recorded, true);
  });
  await check('New page restores acceptance and rejects a second commit', async () => {
    assert.equal(await page.evaluate(() => window.__retainedSensors), 0);
    await page.close(); page = await context.newPage(); observe(page); await open(); await load(fixtures.image);
    assert.match(await page.locator('#retained-evidence-acceptance').textContent(), /Already accepted/);
    await page.locator('#retained-evidence-accept').click();
    await page.waitForFunction(() => document.getElementById('retained-evidence-status').textContent.includes('Acceptance rejected'));
    assert.deepEqual(await acceptedRecord(fixtures.image), firstAcceptance);
  });
  await check('Composed JPEG and separate location proof reopen and accept together', async () => {
    await load(fixtures['camera-location']);
    const report = JSON.parse(await page.locator('#retained-evidence-report').textContent());
    assert.equal(report.request.spec.evidence.type, 'camera-location');
    assert.equal(report.appraisal.evidence_verified, true);
    assert.notEqual(report.request.spec.operator_pins.location_spki_sha256, report.request.spec.operator_pins.media_certificate_sha256);
    await page.locator('#retained-evidence-accept').click();
    await page.waitForFunction(() => document.getElementById('retained-evidence-status').textContent.includes('accepted once'));
    assert.equal((await acceptedRecord(fixtures['camera-location'])).acceptance_recorded, true);
  });
  await check('Cancel during real worker verification prevents acceptance commit', async () => {
    await load(fixtures.cancel);
    await page.evaluate(() => { window.__retainedHoldNext = true; });
    await page.locator('#retained-evidence-accept').click();
    await page.waitForFunction(() => window.__retainedHeld);
    await page.locator('#retained-evidence-clear').click();
    await page.evaluate(() => window.__retainedRelease());
    // A subsequent real verification completes behind the held worker request.
    await load(fixtures.cancel);
    assert.equal(await acceptedRecord(fixtures.cancel), null);
  });
  await check('Missing records fail without making a new request', async () => {
    await load('0'.repeat(64), 'Could not load retained evidence');
    assert.equal(await page.locator('#retained-evidence-accept').isDisabled(), true);
  });
  await check('Expired evidence stays verifiable but cannot acquire fresh acceptance', async () => {
    await open(epoch + 901000); await load(fixtures.expired);
    assert.match(await page.locator('#retained-evidence-freshness').textContent(), /not eligible/);
    assert.match(await page.locator('#retained-evidence-verification').textContent(), /receipt verified/);
    await page.locator('#retained-evidence-accept').click();
    await page.waitForFunction(() => document.getElementById('retained-evidence-status').textContent.includes('Acceptance rejected'));
    assert.equal(await acceptedRecord(fixtures.expired), null);
    await load(fixtures.image);
    assert.match(await page.locator('#retained-evidence-acceptance').textContent(), /Already accepted/);
    assert.match(await page.locator('#retained-evidence-freshness').textContent(), /not eligible/);
    assert.deepEqual(await acceptedRecord(fixtures.image), firstAcceptance);
  });
  await check('Desktop and narrow layout fit; no sensor access or uncaught error', async () => {
    await page.locator('#retained-evidence-panel').scrollIntoViewIfNeeded();
    await page.screenshot({path:resolve(output, 'desktop.png'), fullPage:true});
    await page.setViewportSize({width:390, height:844});
    await page.screenshot({path:resolve(output, 'mobile.png'), fullPage:true});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.evaluate(() => window.__retainedSensors), 0);
    assert.deepEqual(errors, []);
  });
} catch (error) {
  console.error(error.stack || error); process.exitCode = 1;
} finally {
  await context?.close(); await browser?.close();
  if (server && server.exitCode === null) {
    const exited = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM'); await exited;
  }
  await writeFile(resolve(output, 'server.log'), serverOutput, {flag:'wx'});
  await writeFile(resolve(output, 'results.json'), JSON.stringify({
    type:'nonverba-retained-evidence-browser-validation', version:1,
    passed:process.exitCode !== 1 && results.length === 8, results, page_errors:errors,
    scope:'Actual Chromium, IndexedDB, reload and shipped Rust/WASM; synthetic signed image/location fixtures and controlled fixture clocks; no sensors, phone, WebRTC or physical freshness.',
    server_stopped:true, browser_closed:true,
  }, null, 2) + '\n', {flag:'wx'});
  console.log('Browser evidence: ' + output);
}
