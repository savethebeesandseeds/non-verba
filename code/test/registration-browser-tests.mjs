// SPDX-License-Identifier: AGPL-3.0-only
// Real compiled Rust policy, Worker boundary and guided registration UI.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') {
  throw new Error('Run registration browser checks inside non-verba-dev.');
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
    response.writeHead(200, {'Content-Type': mime[route.split('.').at(-1)]});
    response.end(await readFile(resolve(root, '.' + route)));
  } catch { response.writeHead(404).end(); }
});
await new Promise(ready => server.listen(0, '127.0.0.1', ready));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const passed = [];
async function check(name, body) { await body(); passed.push(name); console.log(`PASS ${name}`); }
try {
  browser = await chromium.launch({headless: true,
    ...(process.env.NONVERBA_BROWSER_EXECUTABLE ? {executablePath: process.env.NONVERBA_BROWSER_EXECUTABLE} : {})});
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  await context.addInitScript(() => {
    window.__registrationTest = {sensors: 0, storage: 0, referenceStorage: 0, holdNext: null, replies: []};
    // Delay selected replies from a real Worker to exercise UI reset races.
    const ActualWorker = window.Worker;
    window.Worker = class {
      constructor(...args) {
        this.actual = new ActualWorker(...args); this.heldIds = new Set();
        this.actual.onmessage = event => {
          const deliver = () => this.onmessage?.(event);
          if (this.heldIds.delete(event.data.id)) window.__registrationTest.replies.push(deliver);
          else deliver();
        };
        this.actual.onerror = event => this.onerror?.(event);
        this.actual.onmessageerror = event => this.onmessageerror?.(event);
      }
      postMessage(message) {
        if (message.method === window.__registrationTest.holdNext) {
          this.heldIds.add(message.id); window.__registrationTest.holdNext = null;
        }
        this.actual.postMessage(message);
      }
      terminate() { this.actual.terminate(); }
    };
    const sensor = () => { window.__registrationTest.sensors++; throw new Error('Registration opened a sensor'); };
    if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {value: sensor});
    if (navigator.geolocation) {
      Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {value: sensor});
      Object.defineProperty(navigator.geolocation, 'watchPosition', {value: sensor});
    }
    const stored = () => { window.__registrationTest.storage++; throw new Error('Registration used personal browser storage'); };
    for (const method of ['setItem', 'getItem', 'removeItem', 'clear']) Storage.prototype[method] = stored;
    const open = indexedDB.open.bind(indexedDB);
    Object.defineProperty(indexedDB, 'open', {value: (name, ...args) => {
      if (name !== 'nonverba-operator-face-references-v1') return stored();
      window.__registrationTest.referenceStorage++;
      return open(name, ...args);
    }});
  });
  const page = await context.newPage(), errors = [], requests = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => requests.push(request.url()));
  await page.goto(base + '/registration.html');
  await page.waitForFunction(() => document.getElementById('runtime').textContent.includes('ready'));

  await check('compiled Rust validates both roles and never issues account or verification claims', async () => {
    const report = await page.evaluate(async () => {
      const {createCoreClient} = await import('./core-client.js');
      const engine = createCoreClient(); await engine.ready;
      try {
        const draft = {role: 'operator', revision: 1,
          personal: {display_name: 'Synthetic Participant', contact_email: 'person@example.test', legal_name: '', organization: ''},
          accommodations: {note: '', share_with_task_counterparty: false}, certifications: [],
          acknowledgments: {private_data_handling: true, self_reported_certifications: false},
          sharing: {publish_display_name: false, publish_organization: false}};
        const input = {draft, reviewed_revision: 1, deliberate: true};
        const assess = changes => engine.json('registration_assess', JSON.stringify({...input, ...changes}));
        const prepare = changes => engine.json('registration_prepare', JSON.stringify({...input, ...changes}));
        return {
          operator: await prepare({}), requester: await prepare({draft: {...draft, role: 'requester'}}),
          malformedEmail: await assess({draft: {...draft, personal: {...draft.personal, contact_email: 'no-mailbox'}}}),
          noAcknowledgment: await assess({draft: {...draft, acknowledgments: {...draft.acknowledgments, private_data_handling: false}}}),
          staleReview: await prepare({reviewed_revision: 0}), notDeliberate: await prepare({deliberate: false}),
        };
      } finally { engine.close(); }
    });
    for (const result of Object.values(report)) {
      for (const flag of ['account_created', 'authenticated', 'identity_verified', 'certifications_verified', 'publication_performed']) {
        assert.equal(result[flag], false, flag);
      }
    }
    assert.equal(report.operator.prepared, true);
    assert.equal(report.requester.prepared, true);
    assert.equal(report.malformedEmail.ready_for_local_prepare, false);
    assert.equal(report.noAcknowledgment.ready_for_local_prepare, false);
    assert.equal(report.staleReview.prepared, false);
    assert.equal(report.notDeliberate.prepared, false);
  });

  await check('a default public candidate excludes private and sensitive fields', async () => {
    const result = await page.evaluate(async () => {
      const {createCoreClient} = await import('./core-client.js');
      const engine = createCoreClient(); await engine.ready;
      try {
        const draft = {role: 'operator', revision: 2,
          personal: {display_name: 'Synthetic Operator', contact_email: 'private@example.test', legal_name: 'Private Legal Name', organization: 'Synthetic Studio'},
          accommodations: {note: 'Private access support', share_with_task_counterparty: true},
          certifications: [{title: 'Synthetic credential', issuer: 'Synthetic issuer', reference: 'PRIVATE-REFERENCE',
            issued_on: '2024-01-01', expires_on: '2027-01-01', share_with_task_counterparty: true}],
          acknowledgments: {private_data_handling: true, self_reported_certifications: true},
          sharing: {publish_display_name: true, publish_organization: false}};
        return await engine.json('registration_prepare', JSON.stringify({draft, reviewed_revision: 2, deliberate: true}));
      } finally { engine.close(); }
    });
    assert.equal(result.prepared, true);
    const candidate = JSON.stringify(result.record.public_candidate);
    assert.match(candidate, /Synthetic Operator/);
    for (const secret of ['private@example.test', 'Private Legal Name', 'Private access support', 'PRIVATE-REFERENCE', 'Synthetic Studio']) {
      assert.ok(!candidate.includes(secret), secret);
    }
    assert.equal(result.certifications_verified, false);
  });

  await check('compiled Worker rejects imported claims of verified identity or certification', async () => {
    const rejected = await page.evaluate(async () => {
      const {createCoreClient} = await import('./core-client.js');
      const engine = createCoreClient(); await engine.ready;
      try {
        const draft = {role: 'requester', revision: 0,
          personal: {display_name: 'Synthetic Requester', contact_email: 'requester@example.test'}};
        const forged = [
          {...draft, identity_verified: true},
          {...draft, certifications: [{title: 'Synthetic credential', verification: 'verified'}]},
          {...draft, role: 'administrator'},
        ];
        const results = [];
        for (const value of forged) {
          try {
            await engine.json('registration_prepare', JSON.stringify({draft: value, reviewed_revision: 0, deliberate: true}));
            results.push(false);
          } catch { results.push(true); }
        }
        return results;
      } finally { engine.close(); }
    });
    assert.deepEqual(rejected, [true, true, true]);
  });

  // Guided form scenarios follow the same real Worker policy.
  async function next() {
    const before = await page.locator('#registration-step').innerText();
    await page.locator('#registration-next').click();
    await page.waitForFunction(prior => document.getElementById('registration-step').textContent !== prior, before);
  }
  async function basic(role) {
    await page.locator('#registration-role').selectOption(role);
    await page.locator('#registration-display-name').fill(role === 'operator' ? 'Synthetic Operator' : 'Synthetic Requester');
    await page.locator('#registration-contact-email').fill(`${role}@example.test`);
    await next();
  }
  async function reviewAndPrepare() {
    await page.locator('#registration-review').click();
    await page.waitForFunction(() => !document.getElementById('registration-prepare').disabled);
    await page.locator('#registration-prepare').click();
    await page.waitForFunction(() => document.getElementById('registration-result').textContent.includes('prepared'));
  }
  await check('the guided form blocks missing personal details and exposes field errors', async () => {
    await page.locator('#registration-next').click();
    await page.waitForFunction(() => !document.getElementById('registration-errors-panel').hidden);
    assert.match(await page.locator('#registration-step').innerText(), /1 OF 6/);
    assert.equal(await page.locator('#registration-display-name').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('#registration-contact-email').getAttribute('aria-invalid'), 'true');
  });
  await check('Requester can skip disability and certifications and prepare a private local record', async () => {
    await basic('requester'); await next(); await next();
    assert.equal(await page.locator('#registration-publish-name').isChecked(), false);
    assert.equal(await page.locator('#registration-publish-organization').isChecked(), false);
    await page.locator('#registration-private-ack').check(); await next();
    await reviewAndPrepare();
    assert.match(await page.locator('#registration-result').innerText(), /account|identity/i);
    assert.equal(await page.locator('#registration-face-step').isVisible(), false);
    assert.equal(await page.evaluate(() => window.__registrationTest.referenceStorage), 0);
    assert.ok(!requests.some(url => url.includes('/face-model/')));
  });

  await check('Operator review uses a separately retained reference and safely shows private optional details', async () => {
    // Synthetic features exercise the registration/reference contract; they are
    // not a detected human face or evidence of presence. The face browser suite
    // separately exercises the pinned encoder, detector and camera-quality path.
    const enrollment = await page.evaluate(async () => {
      const {createCoreClient} = await import('./core-client.js');
      const {MOBILE_FACE_SPEC} = await import('./face-model-spec.js');
      const {createLocalFaceReferenceStore} = await import('./face-reference-store.js');
      const engine = createCoreClient(), store = createLocalFaceReferenceStore(); await engine.ready;
      try {
        const context = {account_id: 'synthetic-account', principal_id: 'synthetic-person', device_id: 'this-device',
          session_id: 'synthetic-registration-session', task_id: null};
        const reference = await engine.json('face_identity_enroll', JSON.stringify({mode: 'operator', context,
          now_secs: Math.floor(Date.now() / 1000), operation_id: 'registration-fixture-enrollment',
          reference_id: 'registration-synthetic-reference', model: MOBILE_FACE_SPEC,
          embedding: Array.from({length: 128}, (_, index) => index === 0 ? 1 : 0), quality: 'accepted',
          model_available: true, deliberate: true, consent: true, simulation: true}));
        await store.write(reference.reference, {consent: true});
        return {status: reference.status, authenticated: reference.authenticated, identity_verified: reference.identity_verified};
      } finally { engine.close(); await store.close(); }
    });
    assert.equal(enrollment.status, 'enrolled'); assert.equal(enrollment.authenticated, false);
    assert.equal(enrollment.identity_verified, false);
    await page.locator('#registration-reset').click(); await basic('operator');
    const note = '<img src=x onerror="window.__registrationXss=true"> Step-free access helps.';
    await page.locator('#registration-access-note').fill(note);
    assert.equal(await page.locator('#registration-access-share').isChecked(), false);
    await next(); await page.locator('#registration-add-certification').click();
    await page.locator('[id$="-title"]').fill('Synthetic safety qualification');
    await page.locator('[id$="-issuer"]').fill('Synthetic issuer');
    await page.locator('input[id^="certification-"][id$="-reference"]').fill('LOCAL-TEST-REFERENCE');
    await page.locator('[id$="-issued"]').fill('2024-02-29');
    await page.locator('[id$="-expires"]').fill('2027-02-28');
    await next(); await page.locator('#registration-private-ack').check();
    await page.locator('#registration-certifications-ack').check();
    await next();
    assert.match(await page.locator('#registration-step').innerText(), /5 OF 6/);
    await page.waitForFunction(() => document.getElementById('registration-face-reference').textContent.includes('registration-synthetic-reference'));
    assert.equal(await page.evaluate(() => window.__registrationTest.sensors), 0);
    await next(); await reviewAndPrepare();
    assert.ok((await page.locator('#registration-review-content').innerText()).includes(note));
    assert.match(await page.locator('#registration-review-content').innerText(), /self.reported|unverified/i);
    assert.match(await page.locator('#registration-review-content').innerText(), /continuity reference only/i);
    assert.equal(await page.evaluate(() => window.__registrationXss === true), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({width: 390, height: 844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  });

  await check('editing a reviewed record requires another review', async () => {
    // Operator review follows privacy choices and face enrollment.
    await page.locator('#registration-back').click();
    await page.locator('#registration-back').click();
    await page.locator('#registration-publish-name').check(); await next();
    await next();
    assert.equal(await page.locator('#registration-prepare').isDisabled(), true);
    assert.ok(!(await page.locator('#registration-result').innerText()).includes('Local registration prepared'));
    await reviewAndPrepare();
  });

  await check('a discarded pending action cannot unlock or overwrite a newer action', async () => {
    await page.locator('#registration-reset').click();
    await page.locator('#registration-display-name').fill('Old draft');
    await page.locator('#registration-contact-email').fill('old@example.test');
    await page.evaluate(() => { window.__registrationTest.holdNext = 'registration_assess'; });
    await page.locator('#registration-next').click();
    await page.waitForFunction(() => window.__registrationTest.replies.length === 1);
    await page.locator('#registration-reset').click();
    await page.locator('#registration-display-name').fill('New draft');
    await page.locator('#registration-contact-email').fill('new@example.test');
    await page.evaluate(() => { window.__registrationTest.holdNext = 'registration_assess'; });
    await page.locator('#registration-next').click();
    await page.waitForFunction(() => window.__registrationTest.replies.length === 2);
    await page.evaluate(async () => {
      window.__registrationTest.replies.shift()();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    assert.equal(await page.locator('#registration-next').isDisabled(), true);
    assert.equal(await page.locator('#registration-display-name').inputValue(), 'New draft');
    assert.match(await page.locator('#registration-step').innerText(), /1 OF 6/);
    await page.evaluate(() => window.__registrationTest.replies.shift()());
    await page.waitForFunction(() => document.getElementById('registration-step').textContent.includes('2 OF 6'));
  });

  await check('leaving the page discards the draft and returning permits a new workflow', async () => {
    await page.goto('about:blank'); await page.goBack();
    await page.waitForFunction(() => document.getElementById('runtime')?.textContent.includes('ready'));
    assert.equal(await page.locator('#registration-display-name').inputValue(), '');
    assert.equal(await page.locator('#registration-contact-email').inputValue(), '');
    assert.equal(await page.locator('#registration-access-note').inputValue(), '');
    assert.equal(await page.locator('#registration-result').innerText(), '');
    await basic('requester');
  });

  await check('reload discards personal data, result and sharing preferences', async () => {
    await page.reload();
    await page.waitForFunction(() => document.getElementById('runtime').textContent.includes('ready'));
    assert.equal(await page.locator('#registration-display-name').inputValue(), '');
    assert.equal(await page.locator('#registration-contact-email').inputValue(), '');
    assert.equal(await page.locator('#registration-access-note').inputValue(), '');
    assert.equal(await page.locator('#registration-publish-name').isChecked(), false);
    assert.equal(await page.locator('#registration-prepare').isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__registrationTest.sensors), 0);
    assert.equal(await page.evaluate(() => window.__registrationTest.storage), 0);
    assert.equal(await page.evaluate(() => window.__registrationTest.referenceStorage), 0);
  });

  await check('discarding form details leaves deliberate reference retention separate from exact-ID deletion', async () => {
    const result = await page.evaluate(async () => {
      const {createLocalFaceReferenceStore} = await import('./face-reference-store.js');
      const store = createLocalFaceReferenceStore(), context = {account_id: 'synthetic-account', principal_id: 'synthetic-person'};
      try {
        const retained = await store.referenceId(context);
        await store.delete(context, {deliberate: true, expectedReferenceId: 'registration-synthetic-reference'});
        return {retained, remaining: await store.read(context)};
      } finally { await store.close(); }
    });
    assert.equal(result.retained, 'registration-synthetic-reference'); assert.equal(result.remaining, null);
  });

  await check('registration remains browser inspection and has no horizontal overflow on mobile', async () => {
    await page.setViewportSize({width: 390, height: 844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const native = await context.newPage();
    await native.addInitScript(() => { window.NativeVault = {}; });
    await native.goto(base + '/registration.html');
    await native.waitForFunction(() => document.getElementById('runtime').textContent.includes('Browser'));
    assert.equal(await native.locator('#registration-next').isDisabled(), true);
    await native.close();
  });

  assert.deepEqual(errors, []);
  assert.ok(requests.every(url => url.startsWith(base + '/')), 'Registration made an external request');
  console.log(JSON.stringify({passed: true, checks: passed.length, account_backend_implemented: false,
    identity_verification_implemented: false, personal_draft_persisted: false,
    synthetic_reference_retention_exercised: true, sensors_used: false}));
} finally {
  await browser?.close();
  await new Promise(closed => server.close(closed));
}
