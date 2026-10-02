// SPDX-License-Identifier: AGPL-3.0-only
// Real Rust/WASM, C2PA/COSE and IndexedDB. Media and clocks are deliberately
// synthetic: this validates requester coordination, never physical sensors.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'artifacts/qa');
const base = process.env.NONVERBA_TEST_URL || 'http://127.0.0.1:4174';
const template = JSON.parse(await readFile(resolve(root, 'crates/nonverba-core/src/location_proof/raw_gnss_fixture.json'), 'utf8'));
await mkdir(out, {recursive:true});
const browser = await chromium.launch({headless:true, channel:'msedge'});
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(120000);
const results = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
async function check(name, body) {
  const start = Date.now(); await body();
  results.push({name, status:'passed', milliseconds:Date.now() - start});
  console.log(`PASS ${name}`);
}
try {
  await page.goto(`${base}/key-enrollment.html`);
  await page.evaluate(async template => {
    const {createCoreClient} = await import('./core-client.js');
    const {AgentRequester} = await import('./agent-requester.js');
    const storage = await import('./agent-evidence-storage.js');
    const engine = createCoreClient(); await engine.ready;
    const qa = window.__evidenceQa = {engine, storage, AgentRequester, items:[], clock:2_000_000_000_000, serial:0};
    Date.now = () => qa.clock;
    Object.defineProperty(performance, 'now', {value:() => qa.clock - 1_900_000_000_000});
    const operator = await engine.call('create_identity');
    const mediaPin = JSON.parse(operator).fingerprint;
    const locationPin = (await engine.json('live_requester_identity', operator)).pin.sha256;
    qa.fail = async operation => { try { await operation(); return false; } catch { return true; } };
    qa.hold = method => {
      let release, entered;
      const signal = new Promise(resolve => { entered = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      let used = false;
      const calls = [];
      return {signal, release, calls, engine:{
        ready:engine.ready,
        call:async (name, ...args) => {
          calls.push(name);
          if (name === method && !used) { used = true; entered(); await gate; }
          return engine.call(name, ...args);
        },
        json:async (name, ...args) => {
          calls.push(name);
          const value = await engine.json(name, ...args);
          if (name === method && !used) { used = true; entered(); await gate; }
          return value;
        }
      }};
    };
    qa.mutate = async (sessionId, storeName, mutation) => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('nonverba-agent-evidence-v1', 1);
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite'), store = tx.objectStore(storeName), r = store.get(sessionId);
        r.onsuccess = () => store.put(mutation(r.result), sessionId);
        tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error);
      }); db.close();
    };
    const jpeg = async () => {
      const canvas = new OffscreenCanvas(640, 480), ctx = canvas.getContext('2d'), pixels = ctx.createImageData(640, 480);
      for (let y = 0; y < 480; y++) for (let x = 0; x < 640; x++) {
        const i = (y * 640 + x) * 4;
        pixels.data.set([48 + Math.floor(x / 4) % 160, 48 + Math.floor(y / 3) % 160, 64 + Math.floor((x + y) / 5) % 128, 255], i);
      }
      ctx.putImageData(pixels, 0, 0);
      return new Uint8Array(await (await canvas.convertToBlob({type:'image/jpeg', quality:0.95})).arrayBuffer());
    };
    qa.begin = async (kind, options = {}) => {
      qa.clock = 2_000_000_000_000 + (++qa.serial) * 1_000_000;
      const started = qa.clock, client = new AgentRequester(options.engine || engine);
      const item = {client, kind, started};
      const factory = async (_, at) => {
        const trace = structuredClone(template), delta = started - 2_000_000_000_000;
        delete trace.raw_gnss; delete trace.request.policy.raw_gnss;
        trace.profile = 'software-browser'; trace.permission_precision = 'browser'; trace.uncertainty_semantics = 'w3c-95-percent';
        trace.started_at_ms += delta; trace.ended_at_ms += delta;
        trace.request.policy.profile = 'browser-or-native'; trace.request.policy.required_provider = 'any';
        trace.request.demo = !!options.demo;
        trace.request.context = kind === 'camera-location' ? {session_id:`synthetic-${qa.serial}`, purpose:'camera'} : null;
        for (const sample of trace.samples) {
          sample.provider = 'browser-geolocation'; sample.fix_timestamp_ms += delta; sample.fix_elapsed_ms = null; sample.mock = null;
        }
        trace.request.challenge = await engine.json('create_challenge', 'Synthetic independent requester', 'Synthetic requester acceptance fixture', at, 900);
        let request = kind === 'image' ? trace.request.challenge : trace.request;
        if (kind === 'audio') {
          request = await engine.json('create_audio_request', 'Synthetic requester', 'Synthetic audio fixture', at, 900, 4);
          request.demo = !!options.demo;
        }
        item.trace = trace; item.request = request;
        return item.spec = {version:1, evidence:{type:kind, request},
          operator_pins:{media_certificate_sha256:kind === 'location' ? null : mediaPin, location_spki_sha256:['location','camera-location'].includes(kind) ? locationPin : null},
          policy:{version:1, native_acquisition_required:false, raw_gnss_required:false, correlated_camera_clock_required:false, hardware_attestation_required:false, independent_position_required:false},
          delivery:{max_response_ms:90000, max_receipt_age_ms:60000}};
      };
      item.factory = factory;
      const config = {send:message => { item.sent = message; }};
      if (options.contextJson !== undefined) config.contextJson = options.contextJson;
      item.startedInfo = await client.start(factory, config); item.id = item.startedInfo.sessionId;
      qa.items.push(item); return item;
    };
    qa.artifacts = async item => {
      qa.clock = item.started + 12000;
      const at = qa.clock / 1000, request = JSON.stringify(item.request);
      let primary, secondary = new Uint8Array();
      if (item.kind === 'location') {
        primary = await engine.call('seal_location_proof', JSON.stringify(item.trace), operator, 'null', at);
      } else if (item.kind === 'audio') {
        const pcm = new Float32Array(192000), rounds = [];
        for (let index = 0; index < 2; index++) {
          const round = await engine.json('create_audio_round', request, index, item.started / 1000 + index * 2);
          const probe = await engine.call('audio_probe', item.request.session_id, index, round.nonce);
          pcm.set(probe, index * 96000 + 4800);
          rounds.push({index, nonce:round.nonce, issued_elapsed_ms:index * 2010, received_elapsed_ms:index * 2010 + 2000,
            pcm_sha256:await engine.call('hash_audio_pcm', pcm.slice(index * 96000, (index + 1) * 96000)), start_sample:index * 96000, sample_count:96000});
        }
        item.transcript = JSON.stringify({version:1, session_id:item.request.session_id, started_at:item.started / 1000,
          completed_at:item.started / 1000 + 4, total_samples:192000, rounds});
        primary = await engine.call('seal_audio', pcm, operator, request, item.transcript, item.started / 1000 + 5);
      } else {
        const last = item.trace.samples.at(-1);
        const location = JSON.stringify({latitude:last.latitude, longitude:last.longitude, accuracy_m:last.accuracy_m,
          altitude_m:last.altitude_m, altitude_accuracy_m:last.altitude_accuracy_m, timestamp_ms:last.fix_timestamp_ms, source:'device-geolocation'});
        primary = item.kind === 'camera-location'
          ? await engine.call('seal_image_with_location_request', await jpeg(), JSON.stringify(item.request.challenge), operator, at, location, request)
          : await engine.call('seal_image', await jpeg(), request, operator, at, location);
        if (item.kind === 'camera-location') secondary = await engine.call('seal_location_proof', JSON.stringify(item.trace), operator,
          await engine.call('location_asset', primary), at);
      }
      if (typeof primary === 'string') primary = new TextEncoder().encode(primary);
      return item.artifacts = {primary, secondary};
    };
    qa.complete = async (kind, options = {}) => {
      const item = await qa.begin(kind, options); await qa.artifacts(item);
      if (kind === 'audio') item.client.retainAudioTranscript(item.id, item.transcript);
      try { item.result = await item.client.receive(item.id, item.artifacts); }
      catch (error) {
        const methods = {image:'appraise_image_with_context', location:'appraise_location_with_context', 'camera-location':'appraise_camera_location_with_context', audio:'appraise_audio_with_context'};
        const args = [item.artifacts.primary];
        if (kind === 'camera-location') args.push(item.artifacts.secondary);
        args.push(JSON.stringify(item.request));
        if (kind === 'audio') args.push(item.transcript);
        args.push(kind === 'location' ? locationPin : mediaPin);
        if (kind === 'location') args.push('null');
        if (kind === 'camera-location') args.push(locationPin);
        args.push(JSON.stringify(item.spec.policy), '{"version":1}', qa.clock / 1000);
        const diagnostic = await engine.json(methods[kind], ...args);
        throw new Error(`${kind}: ${error.message}; actual appraisal: ${JSON.stringify(diagnostic)}`);
      }
      return item;
    };
  }, template);

  await check('real requester identity and default context complete all four synthetic sensor variants', async () => {
    const values = await page.evaluate(async () => {
      const q = window.__evidenceQa, reports = [];
      for (const kind of ['image','location','camera-location','audio']) {
        const item = await q.complete(kind), stored = await q.storage.readEvidenceSession(item.id);
        const accepted = await item.client.accept(item.id);
        reports.push({kind, report:item.result.report, accepted, state:stored.task.state, context:stored.task.context_json,
          transcriptRetained:stored.outcome.audio_transcript_json === (item.transcript || ''), pin:item.startedInfo.requesterPin});
        item.client.close();
      }
      return reports;
    });
    for (const value of values) {
      assert.match(value.pin, /^[0-9a-f]{64}$/); assert.equal(value.context, '{"version":1}');
      assert.equal(value.report.verified, true, JSON.stringify(value.report)); assert.equal(value.report.fresh_action_eligible, true);
      assert.equal(value.report.physical_measurement_authenticity_proven, false); assert.equal(value.report.independent_requester_proven, false);
      assert.equal(value.accepted.local_replay_checked, true); assert.equal(value.accepted.global_replay_checked, false);
      assert.equal(value.transcriptRetained, true); assert.equal(value.state, 'complete');
    }
  });
  await check('atomic concurrent acceptance has one winner and repeated delivery cannot replace its evidence', async () => {
    const result = await page.evaluate(async () => {
      const q = window.__evidenceQa, item = await q.complete('image');
      const accepted = await Promise.allSettled([item.client.accept(item.id), item.client.accept(item.id)]);
      return {statuses:accepted.map(x => x.status), replay:await q.fail(() => item.client.accept(item.id)),
        duplicateDelivery:await q.fail(() => item.client.receive(item.id, item.artifacts))};
    });
    assert.deepEqual(result.statuses.sort(), ['fulfilled','rejected']); assert.equal(result.replay, true); assert.equal(result.duplicateDelivery, true);
  });
  await check('request and sensor nonce reservations are durable and cannot be reused', async () => {
    const result = await page.evaluate(async () => {
      const q = window.__evidenceQa, item = await q.begin('image');
      const task = (await q.storage.readEvidenceSession(item.id)).task;
      await item.client.cancel(item.id);
      return {same:await q.fail(() => q.storage.reserveEvidenceSession(task)),
        nonce:await q.fail(() => q.storage.reserveEvidenceSession({...task, session_id:'ab'.repeat(32)})),
        receive:await q.fail(() => item.client.receive(item.id, {primary:new Uint8Array()}))};
    });
    assert.deepEqual(result, {same:true, nonce:true, receive:true});
  });
  await check('cancellation while transport dispatch is pending cannot return a successful start', async () => {
    const result = await page.evaluate(async () => {
      const q = window.__evidenceQa, source = await q.begin('image'); await source.client.cancel(source.id);
      const client = new q.AgentRequester(q.engine);
      let release, entered, id;
      const gate = new Promise(resolve => { release = resolve; }), signal = new Promise(resolve => { entered = resolve; });
      const pending = client.start(source.factory, {send:message => { id = message.sessionId; entered(); return gate; }});
      await signal; await client.cancel(id); release();
      return {rejected:await q.fail(() => pending), state:(await q.storage.readEvidenceSession(id)).task.state};
    });
    assert.deepEqual(result, {rejected:true, state:'abandoned'});
  });
  await check('requester transcript must precede WAV arrival and cannot be replaced', async () => {
    const result = await page.evaluate(async () => {
      const q = window.__evidenceQa, missing = await q.begin('audio'); await q.artifacts(missing);
      const rejected = await q.fail(() => missing.client.receive(missing.id, missing.artifacts));
      const late = await q.fail(() => missing.client.retainAudioTranscript(missing.id, missing.transcript));
      const valid = await q.begin('audio');
      valid.client.retainAudioTranscript(valid.id, 'requester-owned-original');
      const replacement = await q.fail(() => valid.client.retainAudioTranscript(valid.id, 'operator-replacement'));
      await valid.client.cancel(valid.id); return {rejected, late, replacement};
    });
    assert.deepEqual(result, {rejected:true, late:true, replacement:true});
  });
  await check('substituted artifacts, requester context and original authority fail real verification', async () => {
    const result = await page.evaluate(async () => {
      const q = window.__evidenceQa, failures = [];
      for (const mutation of ['artifact','context','original']) {
        const item = await q.complete('image');
        if (mutation === 'artifact') await q.mutate(item.id, 'outcomes', record => { record.primary[record.primary.length - 1] ^= 1; return record; });
        if (mutation === 'context') await q.mutate(item.id, 'tasks', record => ({...record, context_json:'{"version":1,"position":null}'}));
        if (mutation === 'original') await q.mutate(item.id, 'tasks', record => ({...record, original_request:'{"version":1}'}));
        failures.push(await q.fail(() => item.client.accept(item.id)));
      }
      return failures;
    });
    assert.deepEqual(result, [true,true,true]);
  });
  await check('acceptance rechecks bytes atomically after asynchronous cryptographic verification', async () => {
    const result = await page.evaluate(async () => {
      const q = window.__evidenceQa, item = await q.complete('image'), held = q.hold('verify_evidence_session_receipt');
      const pending = q.storage.acceptEvidenceSession(held.engine, item.id, item.startedInfo.requesterPin);
      await held.signal;
      await q.mutate(item.id, 'outcomes', record => { record.primary[0] ^= 1; return record; });
      held.release(); return q.fail(() => pending);
    });
    assert.equal(result, true);
  });
  await check('received byte snapshots survive caller mutation during asynchronous sealing', async () => {
    const result = await page.evaluate(async () => {
      const q = window.__evidenceQa, held = q.hold('seal_evidence_session_receipt');
      const item = await q.begin('image', {engine:held.engine}); await q.artifacts(item);
      const first = item.artifacts.primary[0], pending = item.client.receive(item.id, item.artifacts);
      await held.signal; item.artifacts.primary.fill(0); held.release();
      const sealed = await pending, stored = await q.storage.readEvidenceSession(item.id);
      return {verified:sealed.report.verified, retained:stored.outcome.primary[0] === first && first !== 0,
        independentlyReverified:(await item.client.verify(item.id)).verified};
    });
    assert.deepEqual(result, {verified:true, retained:true, independentlyReverified:true});
  });
  await check('expiry during verification and stale receipt prevent atomic acceptance', async () => {
    const result = await page.evaluate(async () => {
      const q = window.__evidenceQa, item = await q.complete('image'), held = q.hold('verify_evidence_session_receipt');
      const pending = q.storage.acceptEvidenceSession(held.engine, item.id, item.startedInfo.requesterPin);
      await held.signal; q.clock += 61000; held.release();
      const crossing = await q.fail(() => pending);
      const historical = await item.client.verify(item.id);
      const retry = await q.fail(() => item.client.accept(item.id));
      q.clock = item.started + 900000;
      return {crossing, historical:historical.verified, eligible:historical.fresh_action_eligible,
        retry, expired:await q.fail(() => item.client.accept(item.id))};
    });
    assert.deepEqual(result, {crossing:true, historical:true, eligible:false, retry:true, expired:true});
  });
  await check('trust-context verification cannot cross a clock second without full re-verification', async () => {
    const result = await page.evaluate(async () => {
      const q = window.__evidenceQa, item = await q.complete('image'), held = q.hold('verify_evidence_session_receipt');
      const pending = q.storage.acceptEvidenceSession(held.engine, item.id, item.startedInfo.requesterPin);
      await held.signal; q.clock += 1000; held.release();
      const accepted = await pending;
      const retries = held.calls.filter(name => name === 'verify_evidence_session_receipt').length;
      const unstable = await q.complete('image'); let attempts = 0;
      const advancing = {json:async (...args) => { const result = await q.engine.json(...args); attempts++; q.clock += 1000; return result; }};
      return {accepted:accepted.acceptance_recorded, retries,
        unstableRejected:await q.fail(() => q.storage.acceptEvidenceSession(advancing, unstable.id, unstable.startedInfo.requesterPin)), attempts};
    });
    assert.deepEqual(result, {accepted:true, retries:2, unstableRejected:true, attempts:3});
  });
  await check('cancellation during verification and requester shutdown cannot publish or accept', async () => {
    const result = await page.evaluate(async () => {
      const q = window.__evidenceQa, held = q.hold('seal_evidence_session_receipt');
      const item = await q.begin('image', {engine:held.engine}); await q.artifacts(item);
      const pending = item.client.receive(item.id, item.artifacts);
      await held.signal; await item.client.cancel(item.id); held.release();
      const cancelled = await q.fail(() => pending), stored = await q.storage.readEvidenceSession(item.id);
      const stopped = await q.begin('image'); stopped.client.close();
      return {cancelled, state:stored.task.state, absent:stored.outcome === undefined,
        receive:await q.fail(() => stopped.client.receive(stopped.id, {primary:new Uint8Array()})),
        accept:await q.fail(() => item.client.accept(item.id))};
    });
    assert.deepEqual(result, {cancelled:true, state:'abandoned', absent:true, receive:true, accept:true});
  });
  await check('deadline, suspended page and demo evidence cannot become fresh accepted actions', async () => {
    const result = await page.evaluate(async () => {
      const q = window.__evidenceQa, late = await q.begin('image'); await q.artifacts(late); q.clock = late.started + 90001;
      const deadline = await q.fail(() => late.client.receive(late.id, late.artifacts));
      const demo = await q.complete('location', {demo:true});
      const demoRejected = await q.fail(() => demo.client.accept(demo.id));
      const hidden = await q.begin('image');
      Object.defineProperty(document, 'hidden', {configurable:true, value:true}); document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'hidden', {configurable:true, value:false});
      return {deadline, demoVerified:demo.result.report.verified, demo:demo.result.report.demo, demoRejected,
        suspended:await q.fail(() => hidden.client.receive(hidden.id, {primary:new Uint8Array()}))};
    });
    assert.deepEqual(result, {deadline:true, demoVerified:true, demo:true, demoRejected:true, suspended:true});
  });
  assert.deepEqual(errors, []);
} finally {
  await writeFile(resolve(out, 'evidence-session-browser-results.json'), JSON.stringify({synthetic_media:true, synthetic_clocks:true,
    physical_device_tested:false, real_rust_wasm:true, real_indexeddb:true, results, page_errors:errors}, null, 2));
  await browser.close();
}
console.log(`Evidence requester browser: ${results.length} groups passed`);
