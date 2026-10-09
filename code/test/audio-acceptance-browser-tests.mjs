// SPDX-License-Identifier: AGPL-3.0-only
// Real Rust/WASM signatures and browser IndexedDB, with synthetic PCM only.
// Two tabs share one requester ledger. No microphone, playback or fake clock.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.env.NONVERBA_AUDIO_QA_DIR || resolve(root, 'artifacts/qa/audio-acceptance'));
const base = process.env.NONVERBA_TEST_URL || 'http://127.0.0.1:4174';
await mkdir(out, {recursive:true});
const browser = await chromium.launch({headless:true,
  ...(process.env.NONVERBA_BROWSER_EXECUTABLE ? {executablePath:process.env.NONVERBA_BROWSER_EXECUTABLE} : {})});
const context = await browser.newContext();
const pages = [await context.newPage(), await context.newPage()];
const results = [], errors = [], observations = {};
for (const page of pages) {
  page.setDefaultTimeout(30_000);
  page.on('pageerror', error => errors.push(error.message));
}
async function check(name, body) {
  const start = Date.now(); await body();
  results.push({name, status:'passed', milliseconds:Date.now() - start});
  console.log(`PASS ${name}`);
}
async function prepare(page) {
  // This entry loads the Rust engine without starting a sensor workflow.
  await page.goto(`${base}/key-enrollment.html`);
  await page.evaluate(async () => {
    const {createCoreClient} = await import('./core-client.js');
    const {AgentRequester} = await import('./agent-requester.js');
    const storage = await import('./agent-evidence-storage.js');
    const engine = createCoreClient(); await engine.ready;
    const qa = window.__audioAcceptance = {engine, AgentRequester, storage, calls:{}};
    qa.snapshot = async id => {
      const stored = await storage.readEvidenceSession(id), hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('nonverba-agent-evidence-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      let accepted;
      try { accepted = await new Promise((resolve, reject) => {
        const tx = db.transaction('accepted'), store = tx.objectStore('accepted'), keys = store.getAllKeys(), rows = store.getAll();
        tx.oncomplete = () => resolve({keys:keys.result, rows:rows.result}); tx.onerror = tx.onabort = () => reject(tx.error);
      }); } finally { db.close(); }
      return {task:stored.task, receipt:stored.outcome.receipt, transcript_json:stored.outcome.audio_transcript_json,
        wav_sha256:hex(await crypto.subtle.digest('SHA-256', stored.outcome.primary)), wav_bytes:stored.outcome.primary.length,
        acceptance:stored.acceptance ?? null, challenge_acceptance:stored.challengeAcceptance ?? null, accepted};
    };
    qa.stage = async (id, mode = 'gate') => {
      qa.current = true; qa.entered = false; qa.settled = null; qa.verdicts = []; qa.adds = []; qa.nativeErrors = []; qa.commitReads = 0;
      qa.before = await qa.snapshot(id);
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      qa.release = release;
      let held = false;
      const counted = {
        call:(method, ...args) => { qa.calls[method] = (qa.calls[method] || 0) + 1; return engine.call(method, ...args); },
        json:async (method, ...args) => {
          qa.calls[method] = (qa.calls[method] || 0) + 1;
          const value = await engine.json(method, ...args);
          if (method === 'verify_evidence_session_receipt') {
            qa.verdicts.push({verified:value.verified, fresh:value.fresh_action_eligible, session_id:value.request?.session_id});
            if (mode === 'gate' && !held) { held = true; qa.entered = true; await gate; }
          }
          return value;
        },
      };
      const originalAdd = IDBObjectStore.prototype.add, originalGet = IDBObjectStore.prototype.get;
      const watched = store => store.transaction.db.name === 'nonverba-agent-evidence-v1'
        && store.transaction.mode === 'readwrite' && store.transaction.objectStoreNames.contains('accepted');
      IDBObjectStore.prototype.add = function(...args) {
        const request = Reflect.apply(originalAdd, this, args);
        if (watched(this) && this.name === 'accepted') {
          qa.adds.push(args[1]);
          request.addEventListener('error', () => qa.nativeErrors.push({key:args[1], name:request.error?.name ?? null}));
        }
        return request;
      };
      IDBObjectStore.prototype.get = function(...args) {
        const request = Reflect.apply(originalGet, this, args);
        if (mode === 'before-add' && watched(this) && args[0] === id && ['tasks', 'outcomes'].includes(this.name)) {
          // Observe real transaction reads; invalidate before production's
          // second success handler can add either replay key.
          request.addEventListener('success', () => { if (++qa.commitReads === 2) qa.current = false; });
        }
        return request;
      };
      const client = new AgentRequester(counted);
      qa.pending = client.accept(id, () => qa.current && !document.hidden).then(
        value => ({status:'fulfilled', value}), error => ({status:'rejected', name:error.name, message:error.message})
      ).finally(() => {
        client.close(); IDBObjectStore.prototype.add = originalAdd; IDBObjectStore.prototype.get = originalGet;
      }).then(value => { qa.settled = value; return value; });
    };
    qa.result = () => ({settled:qa.settled, verdicts:qa.verdicts, adds:qa.adds, native_errors:qa.nativeErrors, commit_reads:qa.commitReads, calls:qa.calls});
  });
}
const snapshot = page => page.evaluate(id => window.__audioAcceptance.snapshot(id), observations.fixture.session_id);
try {
  await Promise.all(pages.map(prepare));
  await check('fresh synthetic signed audio retains its exact authority and remains unaccepted', async () => {
    observations.fixture = await pages[0].evaluate(async () => {
      const q = window.__audioAcceptance, {AudioEvidenceSession} = await import('./audio-session.js');
      const operator = await q.engine.call('create_identity'), pin = JSON.parse(operator).fingerprint;
      const audio = new AudioEvidenceSession(q.engine, pin, {requester:'Synthetic requester', task:'Two-tab acceptance regression; synthetic PCM', duration_secs:4, assurance:'browser-or-android'});
      try {
        const requesterPin = await audio.identity(); await audio.start(() => {});
        const start = Date.now(), startedAt = Math.floor(start / 1000), requestJson = JSON.stringify(audio.request), pcm = new Float32Array(192000), rounds = [];
        for (let index = 0; index < 2; index++) {
          const round = await q.engine.json('create_audio_round', requestJson, index, startedAt + index * 2);
          pcm.set(await q.engine.call('audio_probe', audio.request.session_id, index, round.nonce), index * 96000 + 4800);
          rounds.push({index, nonce:round.nonce, issued_elapsed_ms:index * 2010, received_elapsed_ms:index * 2010 + 2000,
            pcm_sha256:await q.engine.call('hash_audio_pcm', pcm.slice(index * 96000, (index + 1) * 96000)), start_sample:index * 96000, sample_count:96000});
        }
        const transcript = {version:1, session_id:audio.request.session_id, started_at:startedAt, completed_at:startedAt + 4, total_samples:192000, rounds};
        audio.retainTranscript({version:1, type:'nonverba-audio-receipt', request:audio.request, transcript});
        // Let the real wall/monotonic clocks cover the declared synthetic span.
        await new Promise(resolve => setTimeout(resolve, Math.max(0, start + 5000 - Date.now())));
        const wav = await q.engine.call('seal_audio', pcm, operator, requestJson, JSON.stringify(transcript), Math.floor(Date.now() / 1000));
        const result = await audio.receive(wav);
        return {session_id:audio.id, sensor_nonce:audio.request.session_id, requester_pin:requesterPin, operator_pin:pin,
          verified:result.report.verified, fresh:result.report.fresh_action_eligible, demo:result.report.demo};
      } finally { audio.close(); }
    });
    assert.equal(observations.fixture.verified, true); assert.equal(observations.fixture.fresh, true); assert.equal(observations.fixture.demo, false);
    assert.notEqual(observations.fixture.requester_pin, observations.fixture.operator_pin);
    observations.original = await snapshot(pages[0]);
    assert.equal(observations.original.task.state, 'complete'); assert.equal(observations.original.acceptance, null);
    assert.equal(observations.original.challenge_acceptance, null); assert.equal(observations.original.accepted.rows.length, 0);
    assert.deepEqual(await snapshot(pages[1]), observations.original);
  });
  await check('cancellation after actual Rust verification leaves both acceptance keys absent', async () => {
    await pages[0].evaluate(id => window.__audioAcceptance.stage(id), observations.fixture.session_id);
    await pages[0].waitForFunction(() => window.__audioAcceptance.entered);
    await pages[0].evaluate(() => { const q = window.__audioAcceptance; q.current = false; q.release(); });
    await pages[0].waitForFunction(() => window.__audioAcceptance.settled);
    observations.cancelled = await pages[0].evaluate(() => window.__audioAcceptance.result());
    assert.equal(observations.cancelled.settled.status, 'rejected'); assert.equal(observations.cancelled.verdicts[0].verified, true);
    assert.equal(observations.cancelled.verdicts[0].fresh, true); assert.equal(observations.cancelled.adds.length, 0);
    assert.deepEqual(await snapshot(pages[0]), observations.original);
  });
  await check('cancellation inside a real IndexedDB transaction prevents both atomic adds', async () => {
    await pages[0].evaluate(id => window.__audioAcceptance.stage(id, 'before-add'), observations.fixture.session_id);
    await pages[0].waitForFunction(() => window.__audioAcceptance.settled);
    observations.beforeAdd = await pages[0].evaluate(() => window.__audioAcceptance.result());
    assert.equal(observations.beforeAdd.settled.status, 'rejected'); assert.equal(observations.beforeAdd.commit_reads, 2);
    assert.equal(observations.beforeAdd.verdicts[0].verified, true); assert.equal(observations.beforeAdd.verdicts[0].fresh, true);
    assert.equal(observations.beforeAdd.adds.length, 0); assert.deepEqual(await snapshot(pages[0]), observations.original);
  });
  await check('two requester tabs finish verification before racing first acceptance with exactly one winner', async () => {
    await Promise.all(pages.map(page => page.evaluate(id => window.__audioAcceptance.stage(id), observations.fixture.session_id)));
    await Promise.all(pages.map(page => page.waitForFunction(() => window.__audioAcceptance.entered)));
    for (const page of pages) {
      assert.deepEqual(await snapshot(page), observations.original);
      const verdict = await page.evaluate(() => window.__audioAcceptance.verdicts[0]);
      assert.equal(verdict.verified, true); assert.equal(verdict.fresh, true); assert.equal(verdict.session_id, observations.fixture.session_id);
    }
    await Promise.all(pages.map(page => page.evaluate(() => window.__audioAcceptance.release())));
    await Promise.all(pages.map(page => page.waitForFunction(() => window.__audioAcceptance.settled)));
    observations.race = await Promise.all(pages.map(page => page.evaluate(() => window.__audioAcceptance.result())));
    assert.deepEqual(observations.race.map(x => x.settled.status).sort(), ['fulfilled', 'rejected']);
    const winner = observations.race.find(x => x.settled.status === 'fulfilled'), loser = observations.race.find(x => x.settled.status === 'rejected');
    const keys = [`session:${observations.fixture.session_id}`, `challenge:${observations.fixture.sensor_nonce}`];
    assert.deepEqual(winner.adds, keys); assert.deepEqual(loser.adds, keys);
    assert(loser.native_errors.some(x => x.name === 'ConstraintError' && keys.includes(x.key)), 'The losing fresh attempt must reach IndexedDB uniqueness enforcement');
    observations.accepted = await snapshot(pages[0]);
    assert.deepEqual(observations.accepted.accepted.keys, [...keys].sort()); assert.equal(observations.accepted.accepted.rows.length, 2);
    for (const record of observations.accepted.accepted.rows) assert.deepEqual(record, winner.settled.value);
    assert.deepEqual(observations.accepted.acceptance, winner.settled.value); assert.deepEqual(observations.accepted.challenge_acceptance, winner.settled.value);
    for (const key of ['task', 'receipt', 'transcript_json', 'wav_sha256', 'wav_bytes']) assert.deepEqual(observations.accepted[key], observations.original[key]);
    assert.deepEqual(await snapshot(pages[1]), observations.accepted);
  });
  await check('reload re-verifies the exact audio and duplicate acceptance preserves the winning rows', async () => {
    await Promise.all(pages.map(prepare));
    for (const page of pages) {
      const result = await page.evaluate(async id => {
        const q = window.__audioAcceptance, client = new q.AgentRequester(q.engine);
        try { return await client.inspectRetained(id); } finally { client.close(); }
      }, observations.fixture.session_id);
      assert.equal(result.report.verified, true); assert.deepEqual(result.acceptance, observations.accepted.acceptance);
      assert.equal(result.report.acceptance_recorded, false); assert.equal(result.report.global_replay_checked, false);
      await page.evaluate(id => window.__audioAcceptance.stage(id), observations.fixture.session_id);
      await page.waitForFunction(() => window.__audioAcceptance.entered);
      await page.evaluate(() => window.__audioAcceptance.release());
      await page.waitForFunction(() => window.__audioAcceptance.settled);
      const replay = await page.evaluate(() => window.__audioAcceptance.result());
      assert.equal(replay.settled.status, 'rejected'); assert.equal(replay.verdicts[0].fresh, true);
      assert(replay.native_errors.some(x => x.name === 'ConstraintError'));
      for (const method of ['create_audio_request', 'create_audio_round', 'audio_probe', 'seal_audio', 'seal_evidence_session_receipt']) assert.equal(replay.calls[method] || 0, 0, method);
      assert.deepEqual(await snapshot(page), observations.accepted);
    }
  });
  await check('no uncaught browser errors', async () => assert.deepEqual(errors, []));
} catch (error) {
  observations.failure = String(error.stack || error); console.error(observations.failure); process.exitCode = 1;
} finally {
  await context.close(); await browser.close();
  await writeFile(resolve(out, 'audio-acceptance-browser-results.json'), JSON.stringify({browser:browser.version(),
    synthetic_pcm:true, physical_device_tested:false, crypto_mocked:false, clock_mocked:false, same_origin_requester_tabs:true,
    results, errors, observations, sessions_closed:true}, null, 2));
}
