// SPDX-License-Identifier: AGPL-3.0-only
// Real shipped WASM signatures/receipts plus explicit boundary clocks; no phone or audio.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {syntheticCameraJpeg} from './fixtures/synthetic-camera.mjs';
import {mkdtemp, readFile, writeFile, readdir, symlink, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {PassThrough, Writable} from 'node:stream';
import {ImageRequesterSession, DEFAULT_POLICY, LIMITS, loadShippedCore, readBounded,
  parseOptions, writeJsonLine, attachCommands} from '../tools/image-requester-session.mjs';
if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Run inside non-verba-dev.');
const shipped = await loadShippedCore(), core = shipped.core;
const operator = core.create_identity(), pin = JSON.parse(operator).fingerprint;
const softwarePolicy = JSON.stringify({...JSON.parse(DEFAULT_POLICY), native_acquisition_required:false,
  correlated_camera_clock_required:false});
const jpeg = await syntheticCameraJpeg();
const parent = await mkdtemp(resolve(process.env.CARGO_TARGET_DIR, 'image-requester-tests-'));
let serial = 0;
async function setup(options = {}) {
  let wall = 1_800_000_000_500, mono = 1000;
  const events = [], outputDir = resolve(parent, `session-${++serial}`);
  const clock = () => ({wall, mono});
  const advance = (ms, wallMs = ms) => { mono += ms; wall += wallMs; };
  const session = new ImageRequesterSession({...shipped, operatorPin:pin, requester:'Synthetic requester',
    task:'Synthetic signed protocol test', outputDir, policyJson:softwarePolicy, clock,
    emit:async value => { events.push(value); await options.onEmit?.(value, advance); }, ...options});
  await session.initialize();
  return {session, outputDir, events, clock, advance,
    dispatch:() => session.command({command:'dispatch'}),
    request:() => JSON.parse(events.find(x => x.type === 'dispatch').challenge_json),
    artifact:async (changes = {}) => {
      const request = changes.request || JSON.parse(events.find(x => x.type === 'dispatch').challenge_json);
      const at = Math.floor(wall / 1000);
      return core.seal_image(jpeg, JSON.stringify(request), changes.operator || operator, at,
        JSON.stringify({latitude:0, longitude:0, accuracy_m:5, altitude_m:null, altitude_accuracy_m:null,
          timestamp_ms:wall, source:'device-geolocation'}));
    },
    receive:async bytes => {
      const path = resolve(parent, `returned-${++serial}.jpg`);
      await writeFile(path, bytes, {flag:'wx'});
      return session.command({command:'receive', path});
    }};
}
function turn() { return new Promise(resolve => setImmediate(resolve)); }

test('real signed C2PA image -> exact requester receipt, preserved context and no private key or acceptance', async () => {
  const s = await setup({contextJson:'{ "version" : 1 }\n'});
  assert.equal(s.session.phase, 'ready');
  assert.equal(s.events[0].challenge_created, false);
  assert.equal((await readdir(s.outputDir)).includes('challenge.json'), false);
  await s.dispatch(); s.advance(1500);
  await s.receive(await s.artifact());
  assert.equal(await s.session.done, 0);
  const report = JSON.parse(await readFile(resolve(s.outputDir, 'verification.json')));
  assert.equal(report.verified, true); assert.equal(report.fresh_action_eligible, true);
  assert.equal(report.checks.key_roles_separated, true);
  assert.equal(report.appraisal.verification.checks.c2pa_integrity, true);
  const arrival = JSON.parse(await readFile(resolve(s.outputDir, 'arrival.json')));
  assert.equal(arrival.timing.elapsed_ms, 1500);
  assert.equal(arrival.timing.received_at_ms, s.clock().wall);
  assert.equal(await readFile(resolve(s.outputDir, 'context.json'), 'utf8'), '{ "version" : 1 }\n');
  const result = JSON.parse(await readFile(resolve(s.outputDir, 'result.json')));
  for (const key of ['acceptance_recorded','local_replay_checked','global_replay_checked','requester_clock_trusted',
    'independent_requester_proven','physical_measurement_authenticity_proven','private_identity_persisted','resumable']) assert.equal(result[key], false);
  for (const file of (await readdir(s.outputDir)).filter(x => x.endsWith('.json'))) {
    assert.doesNotMatch(await readFile(resolve(s.outputDir, file), 'utf8'), /private_key_pkcs8_b64|BEGIN PRIVATE KEY/);
  }
  const original = await readFile(resolve(s.outputDir, 'request.json'), 'utf8');
  const receipt = await readFile(resolve(s.outputDir, 'receipt.json'), 'utf8');
  const image = new Uint8Array(await readFile(resolve(s.outputDir, 'image.jpg')));
  const pub = JSON.parse(await readFile(resolve(s.outputDir, 'requester-public.json'))).pin.sha256;
  const changedContext = JSON.parse(await core.verify_evidence_session_receipt(receipt, original, image, new Uint8Array(), '',
    pub, '{"version":1}', Math.floor(s.clock().wall / 1000)));
  assert.equal(changedContext.verified, false);
});

test('default native and correlated-clock policy rejects genuinely signed software JPEG', async () => {
  const s = await setup({policyJson:DEFAULT_POLICY}); await s.dispatch(); s.advance(1500);
  await assert.rejects(s.receive(await s.artifact()), /EVIDENCE_POLICY/);
  assert.equal(await s.session.done, 1);
  assert.equal((await readdir(s.outputDir)).includes('receipt.json'), false);
});

test('wrong signing key and changed signed task cannot receive a requester receipt', async () => {
  for (const kind of ['key', 'task']) {
    const s = await setup(); await s.dispatch(); s.advance(1500);
    const changes = kind === 'key' ? {operator:core.create_identity()} : {request:{...s.request(), task:'Substituted task'}};
    await assert.rejects(s.receive(await s.artifact(changes)), /EVIDENCE_SENSOR_VERIFICATION/);
    assert.equal(await s.session.done, 1);
  }
});

test('C2PA detects a single entropy-byte alteration before a receipt can be issued', async () => {
  const s = await setup(); await s.dispatch(); s.advance(1500);
  const original = await s.artifact(), changed = original.slice();
  let at = 2;
  while (at < changed.length) {
    assert.equal(changed[at], 255);
    const marker = changed[at + 1], length = changed[at + 2] * 256 + changed[at + 3];
    if (marker === 218) { at += 2 + length; break; }
    at += 2 + length;
  }
  while (changed[at] >= 254 || changed[at - 1] === 255) at++;
  changed[at] ^= 1;
  const report = JSON.parse(await core.verify_image(changed, JSON.stringify(s.request()), pin, Math.floor(s.clock().wall / 1000)));
  assert.equal(report.checks.c2pa_integrity, false);
  await assert.rejects(s.receive(changed), /EVIDENCE_SENSOR_VERIFICATION/);
});

test('policy/context shape validation occurs before fresh challenge generation', async () => {
  for (const value of [
    {policyJson:'{"version":1}'},
    {policyJson:JSON.stringify({...JSON.parse(softwarePolicy), version:2})},
    {policyJson:JSON.stringify({...JSON.parse(softwarePolicy), surplus:true})},
    {contextJson:'{"version":1,"report":{"verified":true}}'},
    {contextJson:'{"version":2}'},
  ]) {
    let generated = 0;
    await assert.rejects(setup({...value, core:{...core, create_challenge:() => { generated++; throw new Error('Must not generate'); }}}));
    assert.equal(generated, 0);
  }
});

test('original/policy/context files are immutable authority after dispatch', async () => {
  for (const file of ['request.json','policy.json','context.json']) {
    const s = await setup(); await s.dispatch(); s.advance(1500);
    await writeFile(resolve(s.outputDir, file), '{}');
    await assert.rejects(s.receive(await s.artifact()), /Retained authority/);
  }
});

test('existing output directories cannot resume or gain failure files', async () => {
  const outputDir = resolve(parent, `existing-${++serial}`); await mkdir(outputDir);
  await writeFile(resolve(outputDir, 'sentinel'), 'unchanged');
  const session = new ImageRequesterSession({...shipped, operatorPin:pin, requester:'Test', task:'Test', outputDir,
    emit:async () => {}});
  await assert.rejects(session.initialize(), /EEXIST/);
  await session.fail(new Error('Expected initialization failure'));
  assert.deepEqual(await readdir(outputDir), ['sentinel']);
});

test('early/repeated receive and repeated dispatch fail closed without replacing the request', async () => {
  const early = await setup();
  await assert.rejects(early.session.command({command:'receive', path:'/unused'}), /unavailable/);
  assert.equal(await early.session.done, 1);
  const repeated = await setup(); await repeated.dispatch();
  const original = await readFile(resolve(repeated.outputDir, 'request.json'), 'utf8');
  await assert.rejects(repeated.dispatch(), /unavailable/);
  assert.equal(await readFile(resolve(repeated.outputDir, 'request.json'), 'utf8'), original);
});

test('receive during stdout handoff and a second simultaneous receive abandon the session', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const s = await setup({onEmit:async event => { if (event.type === 'dispatch') await gate; }});
  const dispatching = s.dispatch();
  while (s.session.phase !== 'dispatching') await turn();
  await assert.rejects(s.session.command({command:'receive', path:'/unused'}), /unavailable/);
  release(); await assert.rejects(dispatching, /unavailable/);
  assert.equal(s.events.some(x => x.type === 'dispatched'), false);
  const duplicate = await setup(); await duplicate.dispatch(); duplicate.advance(1500);
  const path = resolve(parent, `duplicate-${++serial}.jpg`);
  await writeFile(path, await duplicate.artifact());
  const first = duplicate.session.command({command:'receive', path});
  const second = duplicate.session.command({command:'receive', path});
  const results = await Promise.allSettled([first, second]);
  assert.deepEqual(results.map(x => x.status), ['rejected', 'rejected']);
  assert.equal(await duplicate.session.done, 1);
});

test('receipt reverification failure or stale eligibility cannot complete the session', async () => {
  for (const field of ['verified', 'fresh_action_eligible']) {
    const s = await setup({core:{...core, verify_evidence_session_receipt:async (...args) => {
      const result = JSON.parse(await core.verify_evidence_session_receipt(...args));
      assert.equal(result.verified, true); // Real verification ran before delayed/downgraded output.
      return JSON.stringify({...result, [field]:false});
    }}});
    await s.dispatch(); s.advance(1500);
    await assert.rejects(s.receive(await s.artifact()), /did not reverify/);
    assert.equal(await s.session.done, 1);
  }
});

test('stdout failure and delayed completion never declare successful dispatch', async () => {
  for (const delayed of [false, true]) {
    const s = await setup({onEmit:async (event, advance) => {
      if (event.type === 'dispatch') { if (delayed) advance(5001); else throw new Error('Broken stdout'); }
    }});
    await assert.rejects(s.dispatch(), delayed ? /deadline/ : /Broken stdout/);
    assert.equal(await s.session.done, 1);
    assert.equal(s.events.some(x => x.type === 'dispatched'), false);
  }
});

test('response deadlines and wall clock jumps reject instead of substituting supplied times', async () => {
  for (const [mono, wall] of [[180001,180001], [1500,4000], [1500,-1]]) {
    const s = await setup(); await s.dispatch();
    const bytes = await s.artifact(); s.advance(mono, wall);
    await assert.rejects(s.receive(bytes), /deadline|agreement/);
  }
  const s = await setup();
  await assert.rejects(s.session.command({command:'dispatch', sent_at_ms:123}), /Unexpected command fields/);
});

test('sealing delayed beyond thirty seconds is rejected even when WASM signed the receipt', async () => {
  let advance;
  const s = await setup({core:{...core, seal_evidence_session_receipt:async (...args) => {
    const receipt = await core.seal_evidence_session_receipt(...args); advance(30001); return receipt;
  }}});
  advance = s.advance;
  await s.dispatch(); s.advance(1500);
  await assert.rejects(s.receive(await s.artifact()), /deadline|agreement/);
  assert.equal(await s.session.done, 1);
});

test('failed final stdout completion settles failure rather than hanging after verification', async () => {
  const s = await setup({onEmit:async event => { if (event.type === 'complete') throw new Error('Final stdout failed'); }});
  await s.dispatch(); s.advance(1500);
  await assert.rejects(s.receive(await s.artifact()), /Final stdout failed/);
  assert.equal(await s.session.done, 1);
  assert.equal(JSON.parse(await readFile(resolve(s.outputDir, 'verification.json'))).verified, true);
});

test('cancellation while preflight is pending cannot regenerate a key or publish ready', async () => {
  let release, generated = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const events = [], session = new ImageRequesterSession({...shipped, operatorPin:pin, requester:'Test', task:'Test',
    outputDir:resolve(parent, `cancel-init-${++serial}`), emit:async e => events.push(e),
    core:{...core, appraise_image_with_context:async (...args) => { await gate; return core.appraise_image_with_context(...args); },
      create_identity:() => { generated++; return core.create_identity(); }}});
  const initializing = session.initialize(); await turn();
  await session.fail(new Error('Cancelled before preflight returned')); release();
  await assert.rejects(initializing, /unavailable/);
  assert.equal(generated, 0); assert.equal(events.length, 0); assert.equal(await session.done, 1);
});

test('invalid requester clock still settles failure without inventing a timestamp', async () => {
  let broken = false;
  const s = await setup({clock:() => broken ? {wall:NaN, mono:NaN} : {wall:1800000000500, mono:1000}});
  broken = true;
  await assert.rejects(s.dispatch(), /Invalid requester clock/);
  assert.equal(await s.session.done, 1);
  const failure = JSON.parse(await readFile(resolve(s.outputDir, 'failure.json')));
  assert.equal(failure.observed_at_ms, null);
});

test('bounded reader rejects empty, oversized, symlink and directory inputs', async () => {
  const file = resolve(parent, `bounded-${++serial}`), link = file + '-link';
  await writeFile(file, '12345'); await symlink(file, link);
  await assert.rejects(readBounded(file, 4), /bounded regular/);
  await assert.rejects(readBounded(link, 8), /Symlink/);
  await assert.rejects(readBounded(parent, 8), /bounded regular/);
  await writeFile(file, ''); await assert.rejects(readBounded(file, 8), /bounded regular/);
});

test('JSONL overflow, invalid JSON, unknown fields and EOF abandon the process session', async () => {
  for (const line of ['x'.repeat(4097), 'not json\n', '{"command":"dispatch","received_at_ms":1}\n', null]) {
    const s = await setup(), input = new PassThrough(), detach = attachCommands(input, s.session);
    if (line === null) input.end(); else input.write(line);
    assert.equal(await s.session.done, 1); detach();
  }
  assert.throws(() => parseOptions(['--received-at','123']), /Unknown/);
});

test('stdout callback/backpressure/error/timeout are observed before promise success', async () => {
  let release;
  const stream = new Writable({write(chunk, encoding, callback) { release = callback; }});
  let finished = false;
  const pending = writeJsonLine(stream, {test:true}).then(() => { finished = true; });
  await turn(); assert.equal(finished, false); release(); await pending;
  const broken = new Writable({write(chunk, encoding, callback) { callback(new Error('Pipe closed')); }});
  await assert.rejects(writeJsonLine(broken, {}), /Pipe closed/); await turn();
  const stalled = new Writable({write() {}});
  await assert.rejects(writeJsonLine(stalled, {}, 10), /bounded write/); stalled.destroy();
});

test('actual CLI JSONL process signs and re-verifies a fresh independent software-fixture return', async () => {
  const outputDir = resolve(parent, `cli-${++serial}`), policyPath = resolve(parent, `policy-${serial}.json`);
  await writeFile(policyPath, softwarePolicy);
  const child = spawn(process.execPath, ['tools/image-requester-session.mjs','--operator-pin',pin,'--requester','CLI fixture requester',
    '--task','Independent CLI fixture','--output-dir',outputDir,'--policy',policyPath], {cwd:resolve(codeRoot()), stdio:['pipe','pipe','pipe']});
  let input = '', stderr = ''; const queued = [], waiters = [];
  child.stderr.on('data', b => { stderr += b; });
  child.stdout.on('data', b => {
    input += b;
    let i;
    while ((i = input.indexOf('\n')) >= 0) {
      const event = JSON.parse(input.slice(0,i)); input = input.slice(i+1);
      if (waiters.length) waiters.shift()(event); else queued.push(event);
    }
  });
  const next = () => queued.length ? Promise.resolve(queued.shift()) : new Promise(resolve => waiters.push(resolve));
  const exit = new Promise(resolve => child.on('close', code => resolve(code)));
  const watchdog = setTimeout(() => {
    child.kill();
    while (waiters.length) waiters.shift()({type:'process-timeout'});
  }, 30000);
  child.on('close', code => { while (waiters.length) waiters.shift()({type:'process-exited', code, stderr}); });
  try {
    assert.equal((await next()).type, 'ready'); child.stdin.write('{"command":"dispatch"}\n');
    const dispatch = await next(); assert.equal(dispatch.type, 'dispatch'); assert.equal((await next()).type, 'dispatched');
    const at = Date.now();
    const bytes = await core.seal_image(jpeg, dispatch.challenge_json, operator, Math.floor(at / 1000),
      JSON.stringify({latitude:0,longitude:0,accuracy_m:5,altitude_m:null,altitude_accuracy_m:null,timestamp_ms:at,source:'device-geolocation'}));
    const path = resolve(parent, `cli-return-${serial}.jpg`); await writeFile(path, bytes);
    child.stdin.write(JSON.stringify({command:'receive',path}) + '\n');
    assert.equal((await next()).type, 'complete'); assert.equal(await exit, 0, stderr);
    const report = JSON.parse(await readFile(resolve(outputDir, 'verification.json')));
    assert.equal(report.verified, true); assert.equal(report.requester_clock_trusted, false);
  } finally { clearTimeout(watchdog); child.kill(); }
});
function codeRoot() { return new URL('../', import.meta.url).pathname; }
