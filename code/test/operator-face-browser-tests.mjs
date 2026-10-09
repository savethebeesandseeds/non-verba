// SPDX-License-Identifier: AGPL-3.0-only
// Actual selected model/runtime + Rust/WASM + local-reference/UI integration.
// All encoder inputs and camera streams here are synthetic, never real people.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Run face checks inside non-verba-dev.');
const require = createRequire(import.meta.url), {chromium} = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const mime = {html: 'text/html', js: 'application/javascript', mjs: 'application/javascript', css: 'text/css', json: 'application/json', wasm: 'application/wasm', onnx: 'application/octet-stream'};
const server = createServer(async (request, response) => {
  try {
    const route = new URL(request.url, 'http://127.0.0.1').pathname;
    if (!/^\/[a-z0-9-]+\.(html|js|css)$/.test(route)
      && !/^\/pkg\/nonverba_core(_bg)?\.(js|wasm)$/.test(route)
      && !/^\/face-model\/[a-zA-Z0-9_.-]+\.(onnx|mjs|wasm|json)$/.test(route)) { response.writeHead(404).end(); return; }
    const bytes = await readFile(resolve(root, '.' + route));
    response.writeHead(200, {'Content-Type': mime[route.split('.').at(-1)] || 'application/octet-stream'}).end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(ready => server.listen(0, '127.0.0.1', ready));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const checks = [];
const check = async (name, body) => { await body(); checks.push(name); console.log('PASS ' + name); };
try {
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  await context.addInitScript(() => {
    window.__faceQA = {camera: 0, location: 0, tracks: [], constraints: [], storage: 0};
    if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {value: async constraints => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
      const paint = canvas.getContext('2d'); paint.fillStyle = '#677a5f'; paint.fillRect(0, 0, canvas.width, canvas.height);
      const stream = canvas.captureStream(10); window.__faceQA.camera++; window.__faceQA.constraints.push(constraints);
      window.__faceQA.tracks.push(...stream.getTracks()); return stream;
    }});
    if (navigator.geolocation) Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {value: () => {
      window.__faceQA.location++; throw new Error('Face pipeline requested location');
    }});
    if (indexedDB) {
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = (...args) => { window.__faceQA.storage++; return open(...args); };
    }
  });
  const page = await context.newPage(), errors = [], requests = [];
  page.on('pageerror', error => errors.push(String(error))); page.on('request', request => requests.push(request.url()));
  await page.goto(base + '/registration.html');
  await page.waitForFunction(() => document.getElementById('runtime').textContent.includes('ready'));

  await check('real pinned CPU encoder produces 128D unit features; detector rejects a blank synthetic image', async () => {
    const outcome = await page.evaluate(async () => {
      const {createMobileFaceModel} = await import('./mobile-face-model.js');
      const model = createMobileFaceModel();
      try {
        const crop = new Float32Array(3 * 112 * 112);
        for (let index = 0; index < crop.length; index++) crop[index] = (index % 113) / 112;
        const first = await model.encodeAligned(crop), second = await model.encodeAligned(crop);
        window.__faceFeatureFixture = first;
        let rejection;
        try { await model.extract({pixels: {width: 320, height: 320, data: new Uint8ClampedArray(320 * 320 * 4)}, simulation: true}); }
        catch (error) { rejection = {code: error.code, message: error.message}; }
        return {length: first.length, norm: first.reduce((sum, value) => sum + value * value, 0),
          same: first.every((value, index) => Math.abs(value - second[index]) < 1e-7), rejection, spec: model.spec};
      } finally { await model.close(); }
    });
    assert.equal(outcome.length, 128); assert.ok(Math.abs(outcome.norm - 1) < 1e-6); assert.equal(outcome.same, true);
    assert.equal(outcome.rejection.code, 'capture_quality_failure'); assert.match(outcome.rejection.message, /No usable face/);
    assert.equal(outcome.spec.runtime, 'onnxruntime-web-1.23.2-wasm-cpu-single-thread');
  });
  await check('missing or altered model manifests fail closed before inference', async () => {
    const report = await page.evaluate(async () => {
      const {createMobileFaceModel} = await import('./mobile-face-model.js');
      const missing = createMobileFaceModel({fetch: async () => new Response('', {status: 404})});
      const substituted = createMobileFaceModel({fetch: async () => new Response('{"profile":{}}')});
      const results = [];
      for (const model of [missing, substituted]) { try { await model.ready(); results.push('accepted'); }
        catch (error) { results.push(error.code); } finally { await model.close(); } }
      return results;
    });
    assert.deepEqual(report, ['model_unavailable', 'model_unavailable']);
  });
  await check('real Rust enrollment explicitly retains an encrypted synthetic continuity reference without an image', async () => {
    const outcome = await page.evaluate(async () => {
      const {createCoreClient} = await import('./core-client.js');
      const {MOBILE_FACE_SPEC} = await import('./face-model-spec.js');
      const {createLocalFaceReferenceStore} = await import('./face-reference-store.js');
      const engine = createCoreClient(), store = createLocalFaceReferenceStore(); await engine.ready;
      const context = {account_id: 'synthetic-account', principal_id: 'synthetic-person', device_id: 'this-device', session_id: 'fixture-session', task_id: null};
      try {
        // Fixture features exercise plumbing; this is not a detected human face.
        const report = await engine.json('face_identity_enroll', JSON.stringify({now_secs: Math.floor(Date.now() / 1000),
          mode: 'operator', context, operation_id: 'fixture-enrollment', reference_id: 'synthetic-reference-1', model: MOBILE_FACE_SPEC,
          embedding: window.__faceFeatureFixture, quality: 'accepted', model_available: true, deliberate: true, consent: true, simulation: true}));
        await store.write(report.reference, {consent: true});
        const restored = await store.read(context);
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('nonverba-operator-face-references-v1', 1);
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        const row = await new Promise(resolve => {
          const request = db.transaction('references').objectStore('references').get(JSON.stringify(['operator', context.account_id, context.principal_id]));
          request.onsuccess = () => resolve(request.result);
        }); db.close();
        return {status: report.status, authenticated: report.authenticated, identity_verified: report.identity_verified,
          restored: restored.reference_id, encrypted: row.ciphertext instanceof ArrayBuffer, keyExtractable: row.key.extractable,
          storedFields: Object.keys(row), dimension: restored.embedding.length};
      } finally { engine.close(); await store.close(); }
    });
    assert.equal(outcome.status, 'enrolled'); assert.equal(outcome.authenticated, false); assert.equal(outcome.identity_verified, false);
    assert.equal(outcome.restored, 'synthetic-reference-1'); assert.equal(outcome.encrypted, true); assert.equal(outcome.keyExtractable, false);
    assert.deepEqual(outcome.storedFields.sort(), ['ciphertext', 'iv', 'key', 'reference_id']); assert.equal(outcome.dimension, 128);
  });
  await check('compiled face matching separates cosine outcomes from live presence and missing enrollment', async () => {
    const report = await page.evaluate(async () => {
      const {createCoreClient} = await import('./core-client.js');
      const {MOBILE_FACE_SPEC} = await import('./face-model-spec.js');
      const {createLocalFaceReferenceStore} = await import('./face-reference-store.js');
      const engine = createCoreClient(), store = createLocalFaceReferenceStore(); await engine.ready;
      const context = {account_id: 'synthetic-account', principal_id: 'synthetic-person', device_id: 'this-device', session_id: 'fixture-session', task_id: null};
      try {
        const reference = await store.read(context), input = {now_secs: Math.floor(Date.now() / 1000), mode: 'operator', context,
          operation_id: 'fixture-fresh-comparison', model: MOBILE_FACE_SPEC, embedding: window.__faceFeatureFixture,
          quality: 'accepted', model_available: true, reference, threshold: 0.8, simulation: true};
        const assess = changes => engine.json('face_identity_assess', JSON.stringify({...input, ...changes}));
        return {match: await assess({}), nonmatch: await assess({embedding: window.__faceFeatureFixture.map(value => -value)}),
          missing: await assess({reference: null}), threshold: await assess({threshold: null}),
          requester: await assess({mode: 'requester', reference: null, model: null, embedding: null, model_available: false})};
      } finally { engine.close(); await store.close(); }
    });
    assert.equal(report.match.embedding_match, true); assert.equal(report.nonmatch.embedding_match, false);
    assert.equal(report.missing.status, 'enrollment_missing'); assert.equal(report.threshold.status, 'threshold_unconfigured');
    assert.equal(report.requester.status, 'not_required'); assert.equal(report.requester.model, null);
    for (const result of Object.values(report)) {
      assert.equal(result.authenticated, false); assert.equal(result.identity_verified, false); assert.equal(result.work_authority_granted, false);
      assert.equal(result.operator_presence_verified, false); assert.equal(result.reference, undefined);
    }
  });
  async function next(target = page) {
    const before = await target.locator('#registration-step').innerText(); await target.locator('#registration-next').click();
    await target.waitForFunction(value => document.getElementById('registration-step').textContent !== value, before);
  }
  await check('Operator registration includes the reference step and private review; real detector failures do not enroll', async () => {
    await page.locator('#registration-display-name').fill('Synthetic Operator');
    await page.locator('#registration-contact-email').fill('operator@example.test');
    await next(); await next(); await next();
    await page.locator('#registration-private-ack').check(); await next();
    await page.waitForFunction(() => document.getElementById('registration-face-reference').textContent.includes('synthetic-reference-1'));
    assert.match(await page.locator('#registration-step').innerText(), /5 OF 6/);
    await page.locator('#registration-face-consent').check();
    await page.locator('#registration-face-capture-kind').selectOption('browser-photo');
    await page.locator('#registration-face-start').click();
    await page.waitForFunction(() => !document.getElementById('registration-face-capture').disabled);
    await page.locator('#registration-face-capture').click();
    await page.waitForFunction(() => document.getElementById('registration-face-status').textContent.includes('No usable face'));
    assert.equal(await page.locator('#registration-face-enroll').isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__faceQA.tracks.every(track => track.readyState === 'ended')), true);
    assert.equal(await page.evaluate(() => window.__faceQA.constraints.every(value => value.audio === false)), true);
    await next(); await page.locator('#registration-review').click();
    await page.waitForFunction(() => !document.getElementById('registration-prepare').disabled);
    await page.locator('#registration-prepare').click();
    await page.waitForFunction(() => document.getElementById('registration-result').textContent.includes('prepared'));
    assert.match(await page.locator('#registration-review-content').innerText(), /continuity|unverified/i);
  });
  await check('Operator auth closes its camera on quality failure and remains on hold', async () => {
    await page.goto(base + '/authentication-privacy.html');
    await page.waitForFunction(() => document.getElementById('runtime').textContent.includes('ready'));
    await page.locator('#auth-capture-kind').selectOption('browser-photo'); await page.locator('#auth-present').click();
    await page.locator('#auth-start').click(); await page.waitForFunction(() => !document.getElementById('auth-capture').disabled);
    await page.locator('#auth-capture').click();
    await page.waitForFunction(() => document.getElementById('auth-face-status').textContent.includes('No usable face'));
    assert.match(await page.locator('#privacy-state').innerText(), /On hold/);
    assert.equal(await page.evaluate(() => window.__faceQA.tracks.every(track => track.readyState === 'ended')), true);
    assert.equal(await page.locator('#auth-face-compare').isDisabled(), true);
  });
  await check('Requesters use neither face assets, camera nor reference storage in either pipeline', async () => {
    const requester = await context.newPage(), traffic = [];
    requester.on('request', request => traffic.push(request.url()));
    requester.on('pageerror', error => errors.push(String(error)));
    await requester.goto(base + '/registration.html');
    await requester.waitForFunction(() => document.getElementById('runtime').textContent.includes('ready'));
    await requester.locator('#registration-role').selectOption('requester');
    await requester.locator('#registration-display-name').fill('Synthetic Requester');
    await requester.locator('#registration-contact-email').fill('requester@example.test');
    for (let step = 0; step < 3; step++) await next(requester);
    await requester.locator('#registration-private-ack').check(); await next(requester);
    await requester.waitForFunction(() => document.getElementById('registration-step').textContent.includes('5 OF 5'));
    assert.equal(await requester.locator('#registration-face-step').isVisible(), false);
    await requester.locator('#registration-review').click(); await requester.waitForFunction(() => !document.getElementById('registration-prepare').disabled);
    await requester.locator('#registration-prepare').click(); await requester.waitForFunction(() => document.getElementById('registration-result').textContent.includes('prepared'));
    assert.equal(await requester.evaluate(() => window.__faceQA.camera + window.__faceQA.storage), 0);
    await requester.goto(base + '/authentication-privacy.html'); await requester.waitForFunction(() => document.getElementById('runtime').textContent.includes('ready'));
    await requester.locator('#auth-mode').selectOption('requester'); await requester.locator('#auth-present').click(); await requester.locator('#auth-start').click();
    await requester.waitForFunction(() => document.getElementById('auth-status').textContent.includes('Requester step pending'));
    assert.equal(await requester.locator('#auth-face-panel').isVisible(), false);
    assert.equal(await requester.evaluate(() => window.__faceQA.camera + window.__faceQA.storage), 0);
    assert.ok(!traffic.some(url => url.includes('/face-model/'))); await requester.close();
  });
  await check('reference deletion uses exact current ID and permits explicit recovery from unreadable ciphertext', async () => {
    const report = await page.evaluate(async () => {
      const {createLocalFaceReferenceStore} = await import('./face-reference-store.js');
      const store = createLocalFaceReferenceStore(), context = {account_id: 'synthetic-account', principal_id: 'synthetic-person'};
      try {
        let prevented = false;
        try { await store.delete(context, {deliberate: true, expectedReferenceId: null}); } catch { prevented = true; }
        const id = await store.referenceId(context);
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('nonverba-operator-face-references-v1', 1);
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
          const transaction = db.transaction('references', 'readwrite'), rows = transaction.objectStore('references');
          const key = JSON.stringify(['operator', context.account_id, context.principal_id]), request = rows.get(key);
          request.onsuccess = () => rows.put({...request.result, ciphertext: new ArrayBuffer(8)}, key);
          transaction.oncomplete = resolve; transaction.onerror = transaction.onabort = () => reject(transaction.error);
        }); db.close();
        let unreadable = false;
        try { await store.read(context); } catch (error) { unreadable = /unreadable/.test(error.message); }
        const recoverableId = await store.referenceId(context);
        await store.delete(context, {deliberate: true, expectedReferenceId: id});
        return {prevented, unreadable, recoverableId, remaining: await store.read(context)};
      } finally { await store.close(); }
    });
    assert.equal(report.prevented, true); assert.equal(report.unreadable, true);
    assert.equal(report.recoverableId, 'synthetic-reference-1'); assert.equal(report.remaining, null);
  });
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.evaluate(() => window.__faceQA.location), 0);
  const external = requests.filter(url => !url.startsWith(base + '/') && !url.startsWith('blob:' + base + '/'));
  assert.deepEqual(errors, []); assert.deepEqual(external, [], 'Face inspection made an external request');
  console.log(JSON.stringify({passed: true, checks: checks.length, physical_sensors_used: false,
    genuine_presence_verified: false, threshold_calibrated: false, phone_performance_measured: false}));
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
