// SPDX-License-Identifier: AGPL-3.0-only
// Real shipped Rust/WASM enrollment verification. Native coordination uses an
// explicitly synthetic bridge and private test certificates; no phone claim.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'artifacts/qa');
const base = process.env.NONVERBA_TEST_URL || 'http://127.0.0.1:4174';
const fixtures = JSON.parse(await readFile(process.env.NONVERBA_ENROLLMENT_FIXTURE || resolve(out, 'trust-synthetic-fixtures.json'), 'utf8'));
assert.equal(fixtures.synthetic, true);
assert.equal(fixtures.physical_device_tested, false);
await mkdir(out, {recursive:true});
const browser = await chromium.launch({headless:true, channel:'msedge'});
const results = [], errors = [], pages = [];

async function context(native = false) {
  const c = await browser.newContext({acceptDownloads:true, viewport:{width:1440, height:1000}});
  await c.addInitScript(({native, fixtures}) => {
    Date.now = () => fixtures.location_enrollment.now * 1000;
    window.__enrollmentQa = {calls:[], mode:'complete', delayVerification:0};
    const originalPost = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...rest) {
      if (message.method === 'verify_key_enrollment' && window.__enrollmentQa.delayVerification) {
        setTimeout(() => originalPost.call(this, message, ...rest), window.__enrollmentQa.delayVerification);
      } else originalPost.call(this, message, ...rest);
    };
    if (!native) return;
    let next = 0, current;
    const records = {location:[], media:[]}, legacy = {location:'11'.repeat(32), media:'22'.repeat(32)};
    const selected = Object.fromEntries(Object.keys(legacy).map(purpose => [purpose, {key_profile:'legacy', fingerprint:legacy[purpose]}]));
    const reply = value => JSON.stringify(value);
    window.NativeKeyEnrollment = {
      capabilities() {
        return reply({ok:true, available:true, version:1, hardware_attested:false, purposes:Object.fromEntries(Object.keys(legacy).map(purpose => [purpose, {
          purpose, ...selected[purpose], legacy_fingerprint:legacy[purpose], enrollment_state:records[purpose].length ? 'ready' : 'absent',
          enrollment_fingerprint:records[purpose].find(value => value.fingerprint === selected[purpose].fingerprint)?.fingerprint || records[purpose][0]?.fingerprint || null,
          enrollments:records[purpose].map(({fingerprint, challenge_b64, spki_sha256}) => ({fingerprint, challenge_b64, spki_sha256})),
          enrollment_capacity:32, enrollment_slots_used:records[purpose].length
        }]))});
      },
      begin(purpose, challenge) {
        current = {ok:true, session_id:`synthetic-enrollment-${++next}`, purpose, challenge, state:'preparing'};
        window.__enrollmentQa.calls.push(['begin', purpose, challenge]);
        return reply(current);
      },
      status(id) {
        window.__enrollmentQa.calls.push(['status', id]);
        if (!current || id !== current.session_id) return reply({ok:false, error:'Unknown synthetic session'});
        if (window.__enrollmentQa.mode === 'hold' || current.state === 'cancelled') return reply(current);
        const fixture = fixtures[`${current.purpose}_enrollment`];
        // New generation pins below are intentionally synthetic coordination
        // values, never submitted to the certificate verifier as valid evidence.
        const existing = records[current.purpose].find(value => value.challenge_b64 === current.challenge);
        const pin = records[current.purpose].length ? (records[current.purpose].length + 2).toString(16).padStart(2,'0').repeat(32) : fixture.response.fingerprint;
        const result = existing ? {...existing} : {...fixture.response, challenge_b64:current.challenge, fingerprint:pin};
        if (window.__enrollmentQa.mode === 'wrong-result') result.challenge_b64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
        if (window.__enrollmentQa.mode !== 'wrong-result' && !existing) records[current.purpose].push(result);
        return reply({...current, state:'ready', result});
      },
      cancel(id) {
        window.__enrollmentQa.calls.push(['cancel', id]);
        if (current?.session_id === id) current.state = 'cancelled';
        return reply({ok:true});
      },
      exportEnrollmentForKey(purpose, pin) {
        window.__enrollmentQa.calls.push(['export', purpose, pin]);
        return reply(records[purpose].find(value => value.fingerprint === pin) || {ok:false, error:'No synthetic enrollment for this pin'});
      },
      selectProfile(purpose, key_profile, fingerprint) {
        window.__enrollmentQa.calls.push(['select', purpose, key_profile, fingerprint]);
        const exact = key_profile === 'legacy' ? legacy[purpose] : records[purpose].find(value => value.fingerprint === fingerprint)?.fingerprint;
        if (fingerprint !== exact) return reply({ok:false, error:'Key pin differs from selected credential'});
        if (window.__enrollmentQa.mode === 'select-mismatch') return reply({ok:true, purpose, key_profile, fingerprint:'00'.repeat(32)});
        selected[purpose] = {key_profile, fingerprint};
        return reply({ok:true, purpose, key_profile, fingerprint});
      }
    };
  }, {native, fixtures});
  const page = await c.newPage();
  pages.push(page);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/key-enrollment.html`);
  await page.waitForFunction(() => !document.getElementById('enrollment-create').disabled, undefined, {timeout:60000});
  return page;
}
async function action(page, id) {
  await page.locator(`#${id}`).click();
  await page.waitForFunction(id => !document.getElementById(id).disabled, id, {timeout:65000});
}
async function tab(page, name) { await page.locator(`[data-enrollment-view="${name}"]`).click(); }
async function download(page, id, filename) {
  const event = page.waitForEvent('download');
  await page.locator(`#${id}`).click();
  const item = await event;
  await item.saveAs(resolve(out, filename));
  return JSON.parse(await readFile(resolve(out, filename), 'utf8'));
}
async function check(name, work) {
  const start = performance.now();
  try { await work(); results.push({name, passed:true, ms:Math.round(performance.now()-start)}); console.log(`PASS ${name}`); }
  catch (error) {
    results.push({name, passed:false, error:String(error)});
    for (let i=0; i<pages.length; i++) await pages[i].screenshot({path:resolve(out, `key-enrollment-failure-${i}.png`), fullPage:true});
    throw error;
  }
}
async function fillVerification(page, fixture) {
  await tab(page, 'verify');
  if (!await page.locator('#enrollment-policy').isVisible()) await page.locator('details').filter({has:page.locator('#enrollment-policy')}).locator('summary').click();
  for (const [id, value] of Object.entries({'enrollment-verify-request':fixture.request, 'enrollment-response':fixture.response, 'enrollment-policy':fixture.policy, 'enrollment-trust':fixture.trust})) {
    await page.locator(`#${id}`).fill(JSON.stringify(value));
  }
  await page.locator('#enrollment-arrival').fill(String(fixture.arrival));
}
function requestHash(request) {
  const times = Buffer.alloc(16);
  times.writeBigUInt64BE(BigInt(request.issued_at)); times.writeBigUInt64BE(BigInt(request.expires_at), 8);
  return createHash('sha256').update('nonverba-key-enrollment-request-v1\0').update(request.purpose).update(Buffer.from([0])).update(times).update(Buffer.from(request.nonce_b64, 'base64')).digest('base64');
}

try {
  const requester = await context(), operator = await context(true);
  let request;
  await check('requester creates secure distinct purpose/time-bound originals in real WASM', async () => {
    await action(requester, 'enrollment-create');
    const first = JSON.parse(await requester.locator('#enrollment-created').inputValue());
    await action(requester, 'enrollment-create');
    request = JSON.parse(await requester.locator('#enrollment-created').inputValue());
    assert.equal(request.purpose, 'location'); assert.equal(request.expires_at-request.issued_at, 600);
    assert.notEqual(first.nonce_b64, request.nonce_b64); assert.notEqual(first.challenge_b64, request.challenge_b64);
    for (const value of [first, request]) { assert.equal(Buffer.from(value.nonce_b64, 'base64').length, 32); assert.equal(value.challenge_b64, requestHash(value)); }
    assert.deepEqual(await download(requester, 'enrollment-save-request', 'key-enrollment-original-ui.json'), request);
    await requester.screenshot({path:resolve(out,'key-enrollment-requester-desktop.png'), fullPage:true});
    await action(requester, 'enrollment-use-request');
    assert.deepEqual(JSON.parse(await requester.locator('#enrollment-operator-request').inputValue()), request);
    assert.equal(await requester.locator('#enrollment-begin').isDisabled(), true);
    assert.match(await requester.locator('#enrollment-native-note').textContent(), /requires the Android app/);
  });
  await check('operator sends exact validated request and does not automatically select new key', async () => {
    await tab(operator, 'operator'); await operator.locator('#enrollment-operator-request').fill(JSON.stringify(request));
    await action(operator, 'enrollment-begin');
    assert.match(await operator.locator('#enrollment-progress').textContent(), /response ready/);
    assert.match(await operator.locator('#enrollment-selected').textContent(), /Selected: legacy/);
    assert.deepEqual((await operator.evaluate(() => window.__enrollmentQa.calls)).find(c => c[0] === 'begin'), ['begin','location',request.challenge_b64]);
    const exported = await download(operator, 'enrollment-export', 'key-enrollment-synthetic-native-response.json');
    assert.equal(exported.challenge_b64, request.challenge_b64); assert.equal(exported.hardware_attested, false);
    assert.equal(exported.fingerprint, fixtures.location_enrollment.response.fingerprint);
    await operator.locator('#enrollment-profile').selectOption('attested');
    await operator.evaluate(() => { window.__enrollmentQa.mode = 'select-mismatch'; });
    await action(operator, 'enrollment-select');
    assert.match(await operator.locator('#enrollment-notice').textContent(), /did not match/);
    assert.match(await operator.locator('#enrollment-selected').textContent(), /Selected: legacy/);
    await operator.evaluate(() => { window.__enrollmentQa.mode = 'complete'; });
    await action(operator, 'enrollment-select');
    assert.match(await operator.locator('#enrollment-selected').textContent(), /Selected: attested/);
    assert.deepEqual(await download(operator, 'enrollment-export-existing', 'key-enrollment-saved-native-response.json'), exported);
    await operator.screenshot({path:resolve(out,'key-enrollment-operator-desktop.png'), fullPage:true});
  });
  await check('renewed generations preserve exact old-key exports and require explicit selection', async () => {
    const originalPin = fixtures.location_enrollment.response.fingerprint;
    await tab(operator, 'requester'); await action(operator, 'enrollment-create');
    const renewedRequest = JSON.parse(await operator.locator('#enrollment-created').inputValue());
    assert.notEqual(renewedRequest.challenge_b64, request.challenge_b64);
    await action(operator, 'enrollment-use-request'); await action(operator, 'enrollment-begin');
    const pins = await operator.locator('#enrollment-key option').evaluateAll(options => options.map(option => option.value));
    assert.equal(pins.length, 2); assert.ok(pins.includes(originalPin));
    assert.match(await operator.locator('#enrollment-selected').textContent(), new RegExp(originalPin));
    const renewedPin = pins.find(pin => pin !== originalPin);
    await operator.locator('#enrollment-key').selectOption(renewedPin);
    const renewed = await download(operator, 'enrollment-export-existing', 'key-enrollment-renewed-synthetic-response.json');
    assert.equal(renewed.fingerprint, renewedPin); assert.equal(renewed.challenge_b64, renewedRequest.challenge_b64);
    await action(operator, 'enrollment-select');
    assert.match(await operator.locator('#enrollment-selected').textContent(), new RegExp(renewedPin));
    await operator.locator('#enrollment-key').selectOption(originalPin);
    const retained = await download(operator, 'enrollment-export-existing', 'key-enrollment-retained-synthetic-response.json');
    assert.equal(retained.fingerprint, originalPin); assert.equal(retained.challenge_b64, request.challenge_b64);
    await action(operator, 'enrollment-select');
    assert.match(await operator.locator('#enrollment-selected').textContent(), new RegExp(originalPin));
    await operator.locator('#enrollment-operator-request').fill(JSON.stringify(request));
  });
  await check('modified purpose/time challenge is rejected before native creation', async () => {
    const count = (await operator.evaluate(() => window.__enrollmentQa.calls)).filter(c => c[0] === 'begin').length;
    await operator.locator('#enrollment-operator-request').fill(JSON.stringify({...request, purpose:'media'}));
    await action(operator, 'enrollment-begin');
    assert.match(await operator.locator('#enrollment-notice').textContent(), /Invalid key enrollment request/);
    assert.equal((await operator.evaluate(() => window.__enrollmentQa.calls)).filter(c => c[0] === 'begin').length, count);
    await operator.locator('#enrollment-operator-request').fill(JSON.stringify(request));
  });
  await check('cancel, Android pause and tab changes revoke pending enrollment delivery', async () => {
    await operator.evaluate(() => { window.__enrollmentQa.mode = 'hold'; });
    for (const kind of ['button','pause','tab']) {
      await tab(operator, 'operator');
      await operator.locator('#enrollment-begin').click();
      await operator.waitForFunction(() => !document.getElementById('enrollment-cancel').disabled);
      if (kind === 'button') await operator.locator('#enrollment-cancel').click();
      if (kind === 'pause') await operator.evaluate(() => window.dispatchEvent(new Event('nonverba:pause')));
      if (kind === 'tab') await tab(operator, 'requester');
      await operator.waitForFunction(() => !document.getElementById('enrollment-begin').disabled);
      assert.equal(await operator.locator('#enrollment-export').isDisabled(), true);
      assert.ok((await operator.evaluate(() => window.__enrollmentQa.calls)).some(c => c[0] === 'cancel'));
    }
    await tab(operator, 'operator');
    await operator.evaluate(() => { window.__enrollmentQa.mode = 'wrong-result'; });
    await action(operator, 'enrollment-begin');
    assert.match(await operator.locator('#enrollment-notice').textContent(), /original request/);
    assert.doesNotMatch(await operator.locator('#enrollment-progress').textContent(), /Creating the separate Android key/);
    assert.equal(await operator.locator('#enrollment-export').isDisabled(), true);
  });
  await check('real WASM verifies location and media private test chains without claiming hardware trust', async () => {
    for (const purpose of ['location','media']) {
      const fixture = fixtures[`${purpose}_enrollment`];
      await fillVerification(requester, fixture); await action(requester, 'enrollment-verify-button');
      assert.equal(await requester.locator('#enrollment-verdict').textContent(), 'Test chain checked. Hardware trust not established.');
      const report = JSON.parse(await requester.locator('#enrollment-report').textContent());
      assert.equal(report.verified, true); assert.equal(report.key_enrollment_attested, false);
      assert.equal(report.possession_proven, false); assert.equal(report.sensor_origin_proven, false);
      assert.equal(report.fingerprint, fixture.response.fingerprint);
      assert.deepEqual(await download(requester, 'enrollment-save-report', `key-enrollment-${purpose}-verification.json`), report);
    }
    await requester.screenshot({path:resolve(out,'key-enrollment-verifier-desktop.png'), fullPage:true});
  });
  await check('new original and changed arrival clear stale verified verdict and key ID', async () => {
    await tab(requester, 'requester'); await action(requester, 'enrollment-create'); await tab(requester, 'verify');
    assert.equal(await requester.locator('#enrollment-save-report').isDisabled(), true);
    assert.equal(await requester.locator('#enrollment-verified-pin').textContent(), '');
    assert.doesNotMatch(await requester.locator('#enrollment-verdict').textContent(), /checked\. Hardware|verified\./);
    await fillVerification(requester, fixtures.location_enrollment); await action(requester, 'enrollment-verify-button');
    await requester.locator('#enrollment-mark-arrival').click();
    assert.equal(await requester.locator('#enrollment-save-report').isDisabled(), true);
    assert.equal(await requester.locator('#enrollment-verified-pin').textContent(), '');
    assert.doesNotMatch(await requester.locator('#enrollment-verdict').textContent(), /checked\. Hardware|verified\./);
  });
  await check('independent verification rejects wrong original, bad key pin, invalid trust and late arrival', async () => {
    for (const fault of ['original','pin','trust','arrival']) {
      await fillVerification(requester, fixtures.location_enrollment);
      if (fault === 'original') await requester.locator('#enrollment-verify-request').fill(JSON.stringify(fixtures.media_enrollment.request));
      if (fault === 'pin') await requester.locator('#enrollment-response').fill(JSON.stringify({...fixtures.location_enrollment.response, fingerprint:'00'.repeat(32)}));
      if (fault === 'trust') await requester.locator('#enrollment-trust').fill('{}');
      if (fault === 'arrival') await requester.locator('#enrollment-arrival').fill(String(fixtures.location_enrollment.request.expires_at));
      await action(requester, 'enrollment-verify-button');
      assert.equal(await requester.locator('#enrollment-verdict').textContent(), 'Enrollment verification failed.', fault);
      assert.equal(await requester.locator('#enrollment-save-report').isDisabled(), true, fault);
      assert.equal(await requester.locator('#enrollment-verified-pin').textContent(), '', fault);
    }
  });
  await check('response import records requester arrival and in-flight verification cannot publish across edits', async () => {
    await fillVerification(requester, fixtures.location_enrollment);
    await requester.locator('#enrollment-arrival').fill('1');
    await requester.locator('#enrollment-response-file').setInputFiles({name:'synthetic-response.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(fixtures.location_enrollment.response))});
    await requester.waitForFunction(now => document.getElementById('enrollment-arrival').value === String(now), fixtures.location_enrollment.now);
    await requester.evaluate(() => { window.__enrollmentQa.delayVerification = 300; });
    await requester.locator('#enrollment-verify-button').click();
    await requester.waitForFunction(() => document.getElementById('enrollment-verdict').textContent === 'Checking enrollment…');
    await requester.locator('#enrollment-arrival').fill('1');
    await requester.waitForFunction(() => !document.getElementById('enrollment-verify-button').disabled);
    assert.equal(await requester.locator('#enrollment-save-report').isDisabled(), true);
    assert.equal(await requester.locator('#enrollment-verdict').textContent(), 'Inputs changed. Verify again.');
    assert.equal(await requester.locator('#enrollment-verified-pin').textContent(), '');
    await requester.evaluate(() => { window.__enrollmentQa.delayVerification = 0; });
  });
  await check('desktop and mobile workflows fit the viewport', async () => {
    for (const page of [requester, operator]) {
      await page.setViewportSize({width:390,height:844});
      for (const name of ['requester','operator','verify']) {
        await tab(page, name);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${page === requester ? 'browser' : 'native fixture'} ${name}`);
      }
    }
    await fillVerification(requester, fixtures.location_enrollment); await action(requester, 'enrollment-verify-button');
    await requester.screenshot({path:resolve(out,'key-enrollment-verifier-mobile.png'), fullPage:true});
    await tab(operator, 'operator'); await operator.screenshot({path:resolve(out,'key-enrollment-operator-mobile.png'), fullPage:true});
  });
  assert.deepEqual(errors, []);
} finally {
  await writeFile(resolve(out,'key-enrollment-browser-tests.json'), JSON.stringify({fixture:'Synthetic Android bridge coordination and private test certificate chains; real Rust/WASM; no physical device, production root, or hardware trust claim', results, pageErrors:errors}, null, 2));
  await browser.close();
}
