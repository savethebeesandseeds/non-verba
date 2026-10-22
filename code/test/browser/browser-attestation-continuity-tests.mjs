// SPDX-License-Identifier: AGPL-3.0-only
// Real IndexedDB/WebCrypto through the canonical participant module closure.
// Synthetic accounts only; browser continuity supplies no hardware verdict.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash, createPublicKey, verify} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {collectParticipantAssets} from '../../tools/build/participant-assets.mjs';
import {launchBrowser} from './harness.mjs';

assert.equal(process.platform, 'linux', 'Run inside managed Debian.');
assert.equal(process.env.NONVERBA_CONTAINER, '1');
const assets = await collectParticipantAssets();
const toolPath = '/participant/identity/device-attestation.js';
const storePath = '/participant/identity/browser-attestation-keys.js';
for (const path of [toolPath, storePath]) assert(assets.has(path.slice(1)), 'Missing canonical participant module: ' + path);
const output = resolve(process.env.NONVERBA_BROWSER_ATTESTATION_QA_DIR ||
  'artifacts/qa/browser-attestation-continuity-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid);
await mkdir(output, {recursive: true});
const checks = [], errors = [], unexpected = [], dialogs = [], served = new Set();
const servers = [], contexts = [];
const csp = "default-src 'none'; script-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'";
for (let index = 0; index < 2; index++) {
  const server = createServer((request, response) => {
    // Exact URL lookup; the fixture never exposes a workspace directory tree.
    const bytes = request.method === 'GET' && request.url === '/continuity.html'
      ? Buffer.from('<!doctype html><meta charset="utf-8"><title>Browser continuity fixture</title>')
      : request.method === 'GET' && [toolPath, storePath].includes(request.url)
        ? assets.get(request.url.slice(1)) : null;
    if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    if (!bytes) unexpected.push('server:' + request.method + ':' + request.url);
    else served.add(request.url);
    response.writeHead(bytes ? 200 : 404, {'content-type': request.url?.endsWith('.js')
      ? 'text/javascript' : 'text/html', 'cache-control': 'no-store', 'content-security-policy': csp});
    response.end(bytes || 'Not found');
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  servers.push(server);
}
const origins = servers.map(server => 'http://127.0.0.1:' + server.address().port);
const browser = await launchBrowser({headless: true, args: ['--no-sandbox']});
const fields = ['challenge_id', 'account_id', 'current_session_id', 'recovery_generation',
  'platform', 'issued_at', 'expires_at', 'challenge_b64'];
function verifies(result, changes = {}) {
  const challenge = {...result.challenge, ...changes};
  const transcript = 'NONVERBA:SIGNIN_DEVICE:v1\n' + fields.map(name => challenge[name]).join('\n') + '\n';
  assert.equal(result.proof.platform, 'browser');
  assert.equal(result.proof.attestation_chain, null);
  return verify('sha256', Buffer.from(transcript), {key: createPublicKey({
    key: Buffer.from(result.proof.public_spki_der_b64, 'base64'), format: 'der', type: 'spki'}),
  dsaEncoding: 'ieee-p1363'}, Buffer.from(result.proof.signature_b64, 'base64'));
}
async function check(name, run) {
  let timer;
  try {
    await Promise.race([run(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Browser check exceeded 35 seconds: ' + name)), 35000);
    })]);
    checks.push(name); console.log('PASS ' + name);
  } finally { clearTimeout(timer); }
}
async function newContext() {
  const context = await browser.newContext(); contexts.push(context);
  await context.addInitScript(() => {
    const calls = window.continuityForbiddenCalls = [];
    const deny = name => () => { calls.push(name); throw new Error('Forbidden browser continuity capability: ' + name); };
    for (const name of ['userAgent', 'userAgentData', 'platform', 'hardwareConcurrency', 'deviceMemory', 'language', 'languages']) {
      Object.defineProperty(navigator, name, {configurable: true, get: deny('fingerprint.' + name)});
    }
    for (const [object, methods, prefix] of [
      [navigator.credentials, ['get', 'create'], 'credentials'],
      [navigator.permissions, ['query'], 'permissions'],
      [navigator.storage, ['persist'], 'storage'],
      [navigator.mediaDevices, ['getUserMedia', 'getDisplayMedia', 'enumerateDevices'], 'media'],
      [navigator.geolocation, ['getCurrentPosition', 'watchPosition'], 'geolocation'],
      [navigator.usb, ['requestDevice'], 'usb'], [navigator.bluetooth, ['requestDevice'], 'bluetooth']
    ]) if (object) for (const method of methods) Object.defineProperty(object, method,
      {configurable: true, value: deny(prefix + '.' + method)});
    window.fetch = deny('network.fetch');
    XMLHttpRequest.prototype.open = deny('network.xhr');
    window.WebSocket = deny('network.websocket');
    navigator.sendBeacon = deny('network.beacon');
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!origins.includes(url.origin) || !['/continuity.html', toolPath, storePath, '/favicon.ico'].includes(url.pathname)
        || url.search || route.request().method() !== 'GET') {
      unexpected.push('browser:' + route.request().method() + ':' + route.request().url());
      await route.abort(); return;
    }
    await route.continue();
  });
  return context;
}
async function initialize(page) {
  await page.evaluate(async ({toolPath, storePath}) => {
    const {createDeviceAttestationTool} = await import(toolPath);
    const {createBrowserAttestationKeys} = await import(storePath);
    const b64 = value => btoa(String.fromCharCode(...new Uint8Array(value)));
    const random = () => crypto.getRandomValues(new Uint8Array(32));
    const fixture = window.continuity = {tools: [], stores: [], now: Math.floor(Date.now() / 1000), published: 0};
    fixture.challenge = (account = 'continuity:account', generation = 0) => ({
      challenge_id: b64(random()).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
      account_id: account, current_session_id: 'continuity-session:' + crypto.randomUUID(),
      recovery_generation: generation, platform: 'browser', issued_at: fixture.now,
      expires_at: fixture.now + 120, challenge_b64: b64(random())
    });
    fixture.scope = (overrides = {}) => ({crypto, indexedDB, Date: {now: () => fixture.now * 1000},
      setTimeout: setTimeout.bind(window), clearTimeout: clearTimeout.bind(window),
      addEventListener: addEventListener.bind(window), removeEventListener: removeEventListener.bind(window), ...overrides});
    fixture.tool = overrides => {
      const tool = createDeviceAttestationTool({scope: fixture.scope(overrides)}); fixture.tools.push(tool); return tool;
    };
    fixture.prove = async (account, generation = 0, overrides) => {
      const tool = fixture.tool(overrides), challenge = fixture.challenge(account, generation);
      try {
        const proof = await tool.prove(challenge), capabilities = await tool.capabilities();
        return {challenge, proof, capabilities};
      } finally { tool.close(); }
    };
    fixture.pair = async account => {
      const store = createBrowserAttestationKeys(fixture.scope()); fixture.stores.push(store);
      try {
        const pair = await store.get(fixture.challenge(account), {ensure() {}, onCancel() { return () => {}; }});
        let privateExportRejected = false;
        try { await crypto.subtle.exportKey('pkcs8', pair.privateKey); } catch (error) { privateExportRejected = error.name === 'InvalidAccessError'; }
        return {private_type: pair.privateKey.type, private_extractable: pair.privateKey.extractable,
          private_usages: pair.privateKey.usages, private_algorithm: pair.privateKey.algorithm,
          public_type: pair.publicKey.type, public_usages: pair.publicKey.usages, privateExportRejected,
          spki: b64(await crypto.subtle.exportKey('spki', pair.publicKey))};
      } finally { store.close(); }
    };
    fixture.database = () => new Promise((resolve, reject) => {
      const request = indexedDB.open('nonverba-device-attestation-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('keys');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    fixture.row = async (account, update) => {
      const db = await fixture.database();
      try { return await new Promise((resolve, reject) => {
        const transaction = db.transaction('keys', update ? 'readwrite' : 'readonly');
        const store = transaction.objectStore('keys'), key = 'signin-device:' + account;
        const request = store.get(key); let row;
        request.onsuccess = () => { row = request.result; if (update) store.put(update(row), key); };
        transaction.oncomplete = () => resolve(row); transaction.onabort = transaction.onerror = () => reject(transaction.error);
      }); } finally { db.close(); }
    };
    fixture.delay = () => {
      let release, entered;
      fixture.entered = new Promise(resolve => { entered = resolve; });
      const held = new Promise(resolve => { release = resolve; });
      const subtle = new Proxy(crypto.subtle, {get(target, name) {
        if (name === 'sign') return async (...args) => { entered(); await held; return target.sign(...args); };
        const value = Reflect.get(target, name); return typeof value === 'function' ? value.bind(target) : value;
      }});
      fixture.release = release;
      return {crypto: {randomUUID: crypto.randomUUID.bind(crypto), getRandomValues: crypto.getRandomValues.bind(crypto), subtle}};
    };
  }, {toolPath, storePath});
}
async function newPage(context, origin = origins[0]) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await page.goto(origin + '/continuity.html'); await initialize(page); return page;
}

try {
  const context = await newContext(), page = await newPage(context);
  let first;
  await check('real IndexedDB reuses a nonextractable account key across tool close and document reload', async () => {
    first = await page.evaluate(() => continuity.prove('continuity:account'));
    assert.equal(verifies(first), true);
    assert.equal(first.capabilities.key_storage, 'origin-indexeddb');
    assert.equal(first.capabilities.hardware_attestation, 'unsupported');
    const pair = await page.evaluate(() => continuity.pair('continuity:account'));
    assert.deepEqual(pair.private_usages, ['sign']); assert.deepEqual(pair.public_usages, ['verify']);
    assert.deepEqual(pair.private_algorithm, {name: 'ECDSA', namedCurve: 'P-256'});
    assert.equal(pair.private_type, 'private'); assert.equal(pair.public_type, 'public');
    assert.equal(pair.private_extractable, false); assert.equal(pair.privateExportRejected, true);
    assert.equal(pair.spki, first.proof.public_spki_der_b64);
    await page.reload(); await initialize(page);
    const fresh = await page.evaluate(() => continuity.prove('continuity:account'));
    assert.equal(fresh.proof.public_spki_der_b64, first.proof.public_spki_der_b64);
    assert.notEqual(fresh.challenge.challenge_id, first.challenge.challenge_id);
    assert.notEqual(fresh.challenge.challenge_b64, first.challenge.challenge_b64);
    assert.equal(verifies(fresh), true);
    assert.equal(verifies(fresh, {current_session_id: first.challenge.current_session_id}), false);
  });
  await check('account and origin isolate keys while recovery remains bound to each fresh proof', async () => {
    const recovered = await page.evaluate(() => continuity.prove('continuity:account', 1));
    assert.equal(recovered.proof.public_spki_der_b64, first.proof.public_spki_der_b64);
    assert.equal(verifies(recovered), true); assert.equal(verifies(recovered, {recovery_generation: 0}), false);
    assert.equal(verifies(first, {recovery_generation: 1}), false);
    const other = await page.evaluate(() => continuity.prove('continuity:other-account'));
    assert.notEqual(other.proof.public_spki_der_b64, first.proof.public_spki_der_b64);
    const otherOrigin = await newPage(context, origins[1]);
    const isolated = await otherOrigin.evaluate(() => continuity.prove('continuity:account'));
    assert.notEqual(isolated.proof.public_spki_der_b64, first.proof.public_spki_der_b64);
    assert.equal(verifies(isolated), true);
  });
  await check('concurrent real tabs settle on one durable first-use winner', async () => {
    const secondPage = await newPage(context);
    const proofs = await Promise.all([page, secondPage].map(tab => tab.evaluate(() => continuity.prove('continuity:concurrent'))));
    assert.equal(proofs[0].proof.public_spki_der_b64, proofs[1].proof.public_spki_der_b64);
    for (const result of proofs) assert.equal(verifies(result), true);
    await secondPage.reload(); await initialize(secondPage);
    const later = await secondPage.evaluate(() => continuity.prove('continuity:concurrent'));
    assert.equal(later.proof.public_spki_der_b64, proofs[0].proof.public_spki_der_b64);
    assert.equal(verifies(later), true);
  });
  await check('32 real account records retain the first key and concurrent last-slot admission never evicts or falls back', async () => {
    const capacityContext = await newContext(), left = await newPage(capacityContext), right = await newPage(capacityContext);
    const firstRetained = await left.evaluate(async () => {
      let first;
      for (let index = 0; index < 31; index++) {
        const result = await continuity.prove('continuity:capacity-' + index);
        if (index === 0) first = result;
      }
      return first;
    });
    assert.equal(verifies(firstRetained), true);
    const contenders = await Promise.all([left, right].map((tab, index) => tab.evaluate(async index => {
      const account = 'continuity:last-slot-' + index;
      try { return {account, accepted: true, result: await continuity.prove(account)}; }
      catch (error) { return {account, accepted: false, code: error.code}; }
    }, index)));
    const winners = contenders.filter(result => result.accepted), refused = contenders.filter(result => !result.accepted);
    assert.equal(winners.length, 1); assert.equal(refused.length, 1);
    assert.equal(refused[0].code, 'attestation_store_full');
    assert.equal(winners[0].result.capabilities.key_storage, 'origin-indexeddb');
    assert.equal(verifies(winners[0].result), true);
    const state = await left.evaluate(async loser => {
      let code = null, published = false;
      try { await continuity.prove('continuity:capacity-overflow'); published = true; }
      catch (error) { code = error.code; }
      const first = await continuity.prove('continuity:capacity-0');
      const loserAbsent = await continuity.row(loser) === undefined;
      const overflowAbsent = await continuity.row('continuity:capacity-overflow') === undefined;
      const db = await continuity.database();
      try {
        const count = await new Promise((resolve, reject) => {
          const transaction = db.transaction('keys', 'readonly'), request = transaction.objectStore('keys').count();
          transaction.oncomplete = () => resolve(request.result);
          transaction.onabort = transaction.onerror = () => reject(transaction.error);
        });
        return {count, code, published, loserAbsent, overflowAbsent, first};
      } finally { db.close(); }
    }, refused[0].account);
    assert.equal(state.count, 32); assert.equal(state.code, 'attestation_store_full');
    assert.equal(state.published, false); assert.equal(state.loserAbsent, true); assert.equal(state.overflowAbsent, true);
    assert.equal(state.first.proof.public_spki_der_b64, firstRetained.proof.public_spki_der_b64);
    assert.equal(state.first.capabilities.key_storage, 'origin-indexeddb');
    assert.equal(verifies(state.first), true);
  });
  await check('malformed and mismatched retained rows refuse without replacing their evidence', async () => {
    for (const kind of ['malformed', 'mismatched']) {
      const result = await page.evaluate(async kind => {
        const account = 'continuity:corrupt-' + kind;
        await continuity.prove(account);
        const original = await continuity.row(account);
        const wrong = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign', 'verify']);
        await continuity.row(account, row => kind === 'malformed' ? {...row, version: 999}
          : {...row, public_key: wrong.publicKey});
        const before = await continuity.row(account);
        let code = null;
        try { await continuity.prove(account); } catch (error) { code = error.code; }
        const after = await continuity.row(account);
        const exportPublic = async row => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('spki', row.public_key))));
        return {code, version_before: before.version, version_after: after.version,
          fields_before: Object.keys(before), fields_after: Object.keys(after),
          public_unchanged: await exportPublic(before) === await exportPublic(after),
          original_present: !!original.private_key};
      }, kind);
      assert.equal(result.code, 'attestation_record_invalid'); assert.equal(result.original_present, true);
      assert.equal(result.version_after, result.version_before); assert.deepEqual(result.fields_after, result.fields_before);
      assert.equal(result.public_unchanged, true);
    }
  });
  for (const mode of ['missing', 'failed-open', 'failed-write', 'blocked']) {
    await check(mode + ' storage falls back honestly to one document-memory identity', async () => {
      const isolatedContext = await newContext(), tab = await newPage(isolatedContext);
      const result = await tab.evaluate(async mode => {
        let overrides, restore = () => {}, blocker, deleted;
        if (mode === 'missing') overrides = {indexedDB: undefined};
        if (mode === 'failed-open') overrides = {indexedDB: {open() { throw new DOMException('Synthetic denied storage', 'SecurityError'); }}};
        if (mode === 'failed-write') {
          const methods = ['put', 'add'], saved = methods.map(name => IDBObjectStore.prototype[name]);
          for (const name of methods) IDBObjectStore.prototype[name] = function () { throw new DOMException('Synthetic full storage', 'QuotaExceededError'); };
          restore = () => methods.forEach((name, index) => { IDBObjectStore.prototype[name] = saved[index]; });
        }
        if (mode === 'blocked') {
          blocker = await continuity.database(); blocker.onversionchange = () => {};
          deleted = new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase('nonverba-device-attestation-v1');
            request.onblocked = resolve; request.onerror = () => reject(request.error);
          });
          await deleted; // This fixture's own held connection blocks the following real open.
        }
        const tool = continuity.tool(overrides);
        try {
          const original = continuity.challenge('continuity:fallback'), first = await tool.prove(original);
          const next = continuity.challenge('continuity:fallback'), second = await tool.prove(next);
          return {first: {challenge: original, proof: first}, second: {challenge: next, proof: second},
            capabilities: await tool.capabilities()};
        } finally { tool.close(); restore(); blocker?.close(); }
      }, mode);
      assert.equal(result.capabilities.key_storage, 'document-memory');
      assert.equal(result.capabilities.hardware_attestation, 'unsupported');
      assert.equal(result.first.proof.public_spki_der_b64, result.second.proof.public_spki_der_b64);
      assert.equal(verifies(result.first), true); assert.equal(verifies(result.second), true);
    });
  }
  for (const action of ['cancel', 'expire', 'close']) {
    await check(action + ' fences a delayed real cryptographic result', async () => {
      await page.evaluate(async action => {
        const account = 'continuity:late-' + action;
        await continuity.prove(account);
        const tool = continuity.tool(continuity.delay());
        continuity.delayedTool = tool;
        continuity.delayedResult = tool.prove(continuity.challenge(account)).then(proof => {
          continuity.published++; return {ok: true, proof};
        }, error => ({ok: false, code: error.code}));
        await continuity.entered;
      }, action);
      const result = await page.evaluate(async action => {
        if (action === 'cancel') continuity.delayedTool.cancel();
        if (action === 'close') continuity.delayedTool.close();
        if (action === 'expire') continuity.now += 121;
        continuity.release();
        const result = await continuity.delayedResult;
        await new Promise(resolve => setTimeout(resolve, 20));
        continuity.delayedTool.close();
        return {...result, published: continuity.published};
      }, action);
      assert.equal(result.ok, false); assert.equal(result.published, 0);
      assert.equal(result.code, action === 'expire' ? 'attestation_invalid' : 'attestation_cancelled');
    });
  }
  await check('continuity uses only declared modules and no prompt, permission, fingerprint or network APIs', async () => {
    for (const context of contexts) for (const page of context.pages()) {
      assert.deepEqual(await page.evaluate(() => window.continuityForbiddenCalls), []);
    }
    assert.deepEqual(dialogs, []); assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    assert(served.has(toolPath)); assert(served.has(storePath));
  });
  const result = {type: 'nonverba-browser-attestation-continuity-validation', version: 1, passed: true,
    managed_linux: true, browser: browser.version(), checks, physical_hardware_tested: false,
    hardware_attestation_verified: false, live_account_operated: false,
    canonical_module_sha256: Object.fromEntries([toolPath, storePath].map(path => [path,
      createHash('sha256').update(assets.get(path.slice(1))).digest('hex')])),
    external_requests: unexpected, forbidden_browser_calls: [], dialogs};
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({...result, output}));
} catch (error) {
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({passed: false, checks, errors,
    unexpected, dialogs, error: String(error.stack || error), physical_hardware_tested: false}, null, 2) + '\n', {flag: 'wx'});
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
  for (const server of servers) await new Promise(done => { server.close(done); server.closeAllConnections(); });
}
