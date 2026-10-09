// SPDX-License-Identifier: AGPL-3.0-only
// Compiled Rust/WASM + isolated inspection UI. Media/devices are synthetic.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') {
  throw new Error('Run authentication/privacy browser checks inside non-verba-dev.');
}
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const mime = {html: 'text/html', js: 'application/javascript', css: 'text/css', wasm: 'application/wasm'};
const server = createServer(async (request, response) => {
  try {
    const route = new URL(request.url, 'http://127.0.0.1').pathname;
    if (!/^\/[a-z0-9-]+\.(html|js|css)$/.test(route) &&
        !/^\/pkg\/nonverba_core(_bg)?\.(js|wasm)$/.test(route)) {
      response.writeHead(404).end(); return;
    }
    const bytes = await readFile(resolve(root, '.' + route));
    response.writeHead(200, {'Content-Type': mime[route.split('.').at(-1)]});
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const passed = [];
async function check(name, body) {
  await body(); passed.push(name); console.log(`PASS ${name}`);
}
try {
  browser = await chromium.launch({headless: true,
    ...(process.env.NONVERBA_BROWSER_EXECUTABLE ? {executablePath: process.env.NONVERBA_BROWSER_EXECUTABLE} : {})});
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  await context.addInitScript(() => {
    // An actual MediaStream with canvas pixels exercises disposal without hardware.
    window.__privacyTest = {cameraCalls: 0, locationCalls: 0, referenceStorage: 0, constraints: [], tracks: []};
    if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {value: async constraints => {
      const qa = window.__privacyTest;
      qa.cameraCalls++; qa.constraints.push(constraints);
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
      const paint = canvas.getContext('2d'); paint.fillStyle = '#52725f'; paint.fillRect(0, 0, 320, 240);
      paint.fillStyle = '#fff'; paint.fillText('SYNTHETIC AUTHENTICATION CAMERA', 10, 120);
      const stream = canvas.captureStream(10); qa.tracks.push(...stream.getTracks()); return stream;
    }});
    if (navigator.geolocation) Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {value: () => {
      window.__privacyTest.locationCalls++; throw new Error('Authentication may not request location');
    }});
    if (indexedDB) {
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = (...args) => { window.__privacyTest.referenceStorage++; return open(...args); };
    }
  });
  const page = await context.newPage(), errors = [], requests = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => requests.push(request.url()));
  await page.goto(base + '/authentication-privacy.html');

  await check('real Rust/WASM denies work on hold and permits only a bounded authentication camera', async () => {
    const report = await page.evaluate(async () => {
      const {createCoreClient} = await import('./core-client.js');
      const engine = createCoreClient(); await engine.ready;
      try {
        const state = {account_id: 'lab-account', state: 'hold', revision: 3, updated_at: 990};
        const input = {now_secs: 1000, account_id: 'lab-account', device_id: 'device-a',
          operation_id: 'auth-1', sensor: 'camera', purpose: 'work', state, authority: null, auth_camera: null};
        const assess = changes => engine.json('work_privacy_assess', JSON.stringify({...input, ...changes}));
        const exception = {account_id: 'lab-account', device_id: 'device-a', operation_id: 'auth-1',
          revision: 3, issued_at: 999, expires_at: 1030, deliberate: true, status: 'active'};
        return {
          held: await assess({}),
          camera: await assess({purpose: 'authentication', auth_camera: exception}),
          microphone: await assess({purpose: 'authentication', sensor: 'microphone', auth_camera: exception}),
          anotherDevice: await assess({purpose: 'authentication', device_id: 'device-b', auth_camera: exception}),
          expired: await assess({now_secs: 1030, purpose: 'authentication', auth_camera: exception}),
          stale: await assess({purpose: 'authentication', state: {...state, revision: 4}, auth_camera: exception}),
          unknown: await assess({state: null}),
        };
      } finally { engine.close(); }
    });
    assert.equal(report.camera.allowed_for_simulation, true);
    for (const name of ['held', 'microphone', 'anotherDevice', 'expired', 'stale', 'unknown']) {
      assert.equal(report[name].allowed_for_simulation, false, name);
      assert.equal(report[name].account_wide_protection, false);
      assert.equal(report[name].profile_visible, true);
    }
    assert.equal(report.held.notification_disposition, 'normal');
  });

  await check('real Rust/WASM reuses permitted simulation results and rejects fresh, cross-account and fabricated genuine results', async () => {
    const report = await page.evaluate(async () => {
      const {createCoreClient} = await import('./core-client.js');
      const engine = createCoreClient(); await engine.ready;
      try {
        const context = {account_id: 'lab-account', principal_id: 'lab-person', device_id: 'device-a',
          session_id: 'session-a', task_id: 'task-a'};
        const requirement = {mode: 'operator', policy_id: 'lab-policy', reuse_scope: 'account',
          max_age_secs: 300, fresh_after_secs: null, allow_simulated: true};
        const result = {operation_id: 'auth-1', context, mode: 'operator', policy_id: 'lab-policy',
          reuse_scope: 'account', issued_at: 990, completed_at: 999, expires_at: 1100,
          status: 'simulated_success', simulation: true};
        const input = {now_secs: 1000, context, requirement, result};
        const assess = changes => engine.json('authentication_assess', JSON.stringify({...input, ...changes}));
        return {
          reuse: await assess({context: {...context, task_id: 'task-b'}}),
          fresh: await assess({requirement: {...requirement, fresh_after_secs: 1000}}),
          anotherAccount: await assess({context: {...context, account_id: 'other-account'}}),
          realRequirement: await assess({requirement: {...requirement, allow_simulated: false}}),
          forged: await assess({result: {...result, status: 'validated_success', simulation: false}}),
          captureOnly: await assess({result: {...result, status: 'capture_complete_validation_unimplemented', simulation: false}}),
        };
      } finally { engine.close(); }
    });
    assert.equal(report.reuse.satisfied_for_simulation, true);
    for (const [name, verdict] of Object.entries(report)) {
      assert.equal(verdict.authenticated, false, name);
      if (name !== 'reuse') assert.equal(verdict.satisfied_for_simulation, false, name);
    }
  });

  await check('a stale clock-in command cannot override a newer account-wide stop', async () => {
    const result = await page.evaluate(async () => {
      const {createCoreClient} = await import('./core-client.js');
      const engine = createCoreClient(); await engine.ready;
      try {
        const state = {account_id: 'lab-account', state: 'clocked_out', revision: 4, updated_at: 1000};
        return await engine.json('work_privacy_transition', JSON.stringify({now_secs: 1001, state,
          command: {account_id: 'lab-account', action: 'clock_in', expected_revision: 3,
            authorized_controller: true, deliberate: true}}));
      } finally { engine.close(); }
    });
    assert.equal(result.accepted, false); assert.equal(result.state.state, 'clocked_out');
    assert.equal(result.notification_disposition, 'silent');
  });

  await page.waitForFunction(() => document.getElementById('runtime').textContent.includes('Rust policy ready'));
  await check('synthetic Operator capture cannot supply face features or satisfy the selected Operator policy', async () => {
    await page.locator('#auth-present').click();
    await page.locator('#auth-start').click();
    await page.waitForFunction(() => !document.getElementById('auth-capture').disabled);
    await page.locator('#auth-capture').click();
    await page.waitForFunction(() => document.getElementById('auth-face-status').textContent.includes('Synthetic capture has no real face image'));
    assert.equal(await page.locator('#auth-face-compare').isDisabled(), true);
    assert.equal(await page.locator('#auth-photo-preview').getAttribute('src'), null);
    assert.match(await page.locator('#auth-status').innerText(), /liveness and trusted capture unresolved/i);
    assert.match(await page.locator('#privacy-state').innerText(), /On hold/);
    await page.getByText('Inspect reuse, freshness and simulated results', {exact: true}).click();
    await page.locator('#auth-simulate').click();
    await page.waitForFunction(() => document.getElementById('auth-status').textContent.includes('Simulated success only'));
    await page.locator('#auth-context').selectOption('task-b');
    await page.locator('#auth-check').click();
    await page.waitForFunction(() => document.getElementById('auth-assessment').textContent.includes('Requirement not satisfied'));
    assert.match(await page.locator('#auth-assessment').innerText(), /face_enrollment_missing/);
    assert.match(await page.locator('#auth-assessment').innerText(), /Authenticated person: false/);
  });

  await check('Requester authentication has its own pending steps and requires no Operator camera', async () => {
    const storage = await page.evaluate(() => window.__privacyTest.referenceStorage);
    const faceRequests = requests.filter(url => url.includes('/face-model/')).length;
    await page.locator('#auth-mode').selectOption('requester');
    await page.locator('#auth-present').click();
    await page.locator('#auth-start').click();
    await page.waitForFunction(() => document.getElementById('auth-status').textContent.includes('Requester step pending'));
    assert.equal(await page.locator('#auth-capture').isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__privacyTest.cameraCalls), 0);
    assert.equal(await page.locator('#auth-face-panel').isVisible(), false);
    await page.locator('#auth-simulate').click();
    await page.waitForFunction(() => document.getElementById('auth-status').textContent.includes('Simulated success only'));
    await page.locator('#auth-context').selectOption('task-b');
    await page.locator('#auth-check').click();
    await page.waitForFunction(() => document.getElementById('auth-assessment').textContent.includes('Requirement satisfied for simulation only'));
    assert.match(await page.locator('#auth-assessment').innerText(), /Authenticated person: false/);
    await page.locator('#auth-allow-simulation').uncheck();
    await page.locator('#auth-check').click();
    await page.waitForFunction(() => document.getElementById('auth-assessment').textContent.includes('Requirement not satisfied'));
    await page.locator('#auth-allow-simulation').check();
    assert.equal(await page.evaluate(() => window.__privacyTest.referenceStorage), storage);
    assert.equal(requests.filter(url => url.includes('/face-model/')).length, faceRequests);
    await page.locator('#auth-cancel').click();
  });

  await check('linked device simulation stops local work but truthfully leaves a disconnected device unconfirmed', async () => {
    await page.getByText('Exercise enforcement and failure handling', {exact: true}).click();
    await page.locator('#privacy-clock-in').click();
    await page.waitForFunction(() => document.getElementById('privacy-state').textContent.includes('available'));
    await page.locator('#privacy-start-local').click();
    await page.locator('#privacy-start-remote').click();
    await page.waitForFunction(() => [...document.querySelectorAll('#privacy-devices li strong')]
      .every(node => node.textContent.includes('active')));
    await page.locator('#privacy-disconnect').click();
    await page.locator('#privacy-hold').click();
    await page.waitForFunction(() => document.getElementById('privacy-status').textContent.includes('Shutdown unconfirmed'));
    assert.match(await page.locator('#privacy-devices').innerText(), /this-device · stopped/);
    assert.match(await page.locator('#privacy-devices').innerText(), /second-device · unreachable/);
    await page.locator('#privacy-expire').click();
    assert.match(await page.locator('#privacy-status').innerText(), /Shutdown unconfirmed/);
    await page.locator('#privacy-reconnect').click();
    await page.waitForFunction(() => document.getElementById('privacy-status').textContent.includes('Shutdown confirmed for the simulated devices'));
    await page.locator('#privacy-notify').click();
    await page.waitForFunction(() => document.getElementById('privacy-notifications').textContent.includes('Notification 1 delivered'));
    assert.match(await page.locator('#privacy-notifications').innerText(), /normal/);
    await page.locator('#privacy-clock-out').click();
    await page.waitForFunction(() => document.getElementById('privacy-state').textContent.includes('Clocked out'));
    await page.locator('#privacy-notify').click();
    await page.waitForFunction(() => document.getElementById('privacy-notifications').textContent.includes('Notification 2 delivered'));
    assert.match(await page.locator('#privacy-notifications').innerText(), /silent/);
    await page.locator('#privacy-stale-resume').click();
    await page.waitForFunction(() => document.getElementById('inspection-notice').textContent.includes('Stale resume rejected'));
    assert.match(await page.locator('#inspection-notice').innerText(), /Stale resume rejected/);
    assert.match(await page.locator('#privacy-state').innerText(), /Clocked out/);
  });

  await check('explicit camera-only capture fails closed without the model bundle and disposes media and tracks', async () => {
    await page.locator('#auth-mode').selectOption('operator');
    await page.locator('#auth-capture-kind').selectOption('browser-photo');
    assert.equal(await page.locator('#auth-camera-disclosure').isVisible(), true);
    await page.locator('#auth-present').click();
    assert.equal(await page.evaluate(() => window.__privacyTest.cameraCalls), 0);
    await page.locator('#auth-start').click();
    await page.waitForFunction(() => document.getElementById('auth-camera-video').videoWidth > 0 &&
      !document.getElementById('auth-capture').disabled);
    const constraints = await page.evaluate(() => window.__privacyTest.constraints);
    assert.equal(constraints.length, 1); assert.equal(constraints[0].audio, false);
    assert.equal(await page.evaluate(() => window.__privacyTest.locationCalls), 0);
    await page.locator('#auth-capture').click();
    // This policy regression server deliberately omits face-model assets. The
    // separate operator-face suite runs the real pinned detector/encoder bundle.
    await page.waitForFunction(() => document.getElementById('auth-face-status').textContent.includes('pinned face model bundle is unavailable'));
    await page.waitForFunction(() => document.getElementById('auth-photo-preview').hidden && !document.getElementById('auth-photo-preview').hasAttribute('src'));
    assert.equal(await page.evaluate(() => window.__privacyTest.tracks.every(track => track.readyState === 'ended')), true);
    assert.equal(await page.locator('#auth-face-compare').isDisabled(), true);
    assert.match(await page.locator('#auth-status').innerText(), /liveness and trusted capture unresolved/i);
    await page.locator('#auth-cancel').click();
    assert.equal(await page.locator('#auth-photo-preview').isVisible(), false);
    assert.equal(await page.locator('#auth-photo-preview').getAttribute('src'), null);
    assert.match(await page.locator('#privacy-state').innerText(), /Clocked out/);
  });

  await check('switching a presented Operator requirement to Requester cannot open a hidden camera', async () => {
    await page.locator('#auth-present').click();
    await page.waitForFunction(() => !document.getElementById('auth-start').disabled);
    const calls = await page.evaluate(() => window.__privacyTest.cameraCalls);
    await page.locator('#auth-mode').selectOption('requester');
    assert.equal(await page.locator('#auth-start').isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__privacyTest.cameraCalls), calls);
    await page.locator('#auth-present').click();
    await page.locator('#auth-start').click();
    await page.waitForFunction(() => document.getElementById('auth-status').textContent.includes('Requester step pending'));
    assert.equal(await page.evaluate(() => window.__privacyTest.cameraCalls), calls);
    await page.locator('#auth-cancel').click();
  });

  await check('Hold, Clock out and Sign out revoke an active authentication camera without resuming work', async () => {
    await page.locator('#auth-mode').selectOption('operator');
    for (const [action, label] of [['hold', 'On hold'], ['clock-out', 'Clocked out'], ['sign-out', 'Signed out']]) {
      await page.locator('#auth-present').click(); await page.locator('#auth-start').click();
      await page.waitForFunction(() => document.getElementById('auth-camera-video').videoWidth > 0 && !document.getElementById('auth-capture').disabled);
      await page.locator(`#privacy-${action}`).click();
      await page.waitForFunction(expected => document.getElementById('privacy-state').textContent.includes(expected), label);
      await page.waitForFunction(() => window.__privacyTest.tracks.every(track => track.readyState === 'ended'));
      await page.waitForFunction(() => document.getElementById('auth-status').textContent.includes('cancelled'));
      assert.match(await page.locator('#auth-status').innerText(), /cancelled|revoked/i);
      assert.equal(await page.locator('#auth-photo-preview').getAttribute('src'), null);
      assert.equal(await page.locator('#auth-face-compare').isDisabled(), true);
    }
    assert.equal(await page.evaluate(() => window.__privacyTest.constraints.every(value => value.audio === false)), true);
    assert.equal(await page.evaluate(() => window.__privacyTest.locationCalls), 0);
  });

  await check('lifecycle pause ends the camera exception and requires a new deliberate start', async () => {
    await page.locator('#auth-present').click(); await page.locator('#auth-start').click();
    await page.waitForFunction(() => document.getElementById('auth-camera-video').videoWidth > 0 && !document.getElementById('auth-capture').disabled);
    await page.evaluate(() => window.dispatchEvent(new Event('nonverba:pause')));
    await page.waitForFunction(() => window.__privacyTest.tracks.every(track => track.readyState === 'ended'));
    await page.waitForFunction(() => document.getElementById('auth-status').textContent.includes('cancelled'));
    assert.equal(await page.locator('#auth-start').isDisabled(), true);
    assert.equal(await page.locator('#auth-photo-preview').getAttribute('src'), null);
    assert.match(await page.locator('#privacy-state').innerText(), /Signed out/);
    await page.locator('#privacy-clock-out').click();
    await page.waitForFunction(() => document.getElementById('privacy-state').textContent.includes('Clocked out'));
  });

  await check('a stopped work state survives reload without resurrecting sensor operations', async () => {
    await page.reload();
    await page.waitForFunction(() => document.getElementById('runtime').textContent.includes('Rust policy ready'));
    assert.match(await page.locator('#privacy-state').innerText(), /Clocked out/);
    assert.equal(await page.evaluate(() => window.__privacyTest.cameraCalls), 0);
    assert.match(await page.locator('#auth-status').innerText(), /Present a requirement/);
    assert.equal(await page.locator('#auth-photo-preview').getAttribute('src'), null);
    assert.match(await page.locator('#privacy-devices').innerText(), /Registered resources: 0/);
    await page.locator('#privacy-clock-in').click();
    await page.waitForFunction(() => document.getElementById('privacy-state').textContent.includes('available'));
    assert.equal(await page.evaluate(() => window.__privacyTest.cameraCalls), 0);
    assert.match(await page.locator('#privacy-devices').innerText(), /Registered resources: 0/);
    await page.locator('#privacy-clock-out').click();
    await page.waitForFunction(() => document.getElementById('privacy-state').textContent.includes('Clocked out'));
  });

  // No physical getUserMedia call occurred: the optional adapter used canvas pixels.
  assert.equal(await page.evaluate(() => window.__privacyTest.cameraCalls), 0);
  assert.equal(await page.evaluate(() => window.__privacyTest.locationCalls), 0);
  assert.equal(await page.locator('h1').count(), 1);
  assert.match(await page.locator('body').innerText(), /simulation|synthetic/i);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

  await check('browser inspection navigation is available in browser tools and omitted from a native app context', async () => {
    const tools = await context.newPage();
    await tools.goto(base + '/index.html');
    await tools.locator('[data-browser-inspection][href="./authentication-privacy.html"]').waitFor({state: 'visible'});
    await tools.close();
    const native = await context.newPage();
    await native.addInitScript(() => { window.NativeVault = {}; });
    await native.goto(base + '/index.html');
    await native.waitForFunction(() => !document.querySelector('[data-browser-inspection]'));
    await native.close();
  });
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

  assert.deepEqual(errors, []);
  assert.ok(requests.every(url => url.startsWith(base + '/') || url.startsWith('blob:' + base + '/')),
    'Inspection made an external request');
  console.log(JSON.stringify({passed: true, checks: passed.length, physical_sensors_used: false,
    genuine_presence_verified: false, account_backend_implemented: false,
    face_model_bundle_unavailable_in_this_harness: true}));
} finally {
  await browser?.close();
  await new Promise(resolveClosed => server.close(resolveClosed));
}
