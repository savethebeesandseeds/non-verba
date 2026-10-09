// SPDX-License-Identifier: AGPL-3.0-only
// Fake policy replies isolate lifecycle/resource orchestration. Actual policy
// behavior is tested in Rust and the compiled-WASM browser integration suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {AuthenticationWorkflow} from '../../web/src/authentication-workflow.js';
import {WorkPrivacyController} from '../../web/src/work-privacy-controller.js';
import {SyntheticAuthenticationCapture, BrowserAuthenticationCamera} from '../../web/src/authentication-camera.js';

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; }
const context = {account_id: 'account', principal_id: 'person', device_id: 'this-device', session_id: 'session', task_id: null};
function fixture(options = {}) {
  const state = {now: 2000000000, calls: [], timers: new Map(), adapters: []}; let timer = 0;
  const clock = {seconds: () => state.now,
    setTimeout(callback, delay) { const id = ++timer; state.timers.set(id, {callback, delay}); return id; },
    clearTimeout(id) { state.timers.delete(id); }};
  const engine = {async json(method, json) {
    const input = JSON.parse(json); state.calls.push({method, input});
    const scripted = await options.policy?.(method, input);
    if (scripted) return scripted;
    if (method === 'authentication_create') return {accepted: true, authenticated: false,
      result: {operation_id: input.operation_id, context: input.context, mode: input.mode, policy_id: input.policy_id,
        reuse_scope: input.reuse_scope, issued_at: input.now_secs, completed_at: null, expires_at: input.expires_at,
        status: 'requirement_presented', simulation: true}};
    if (method === 'authentication_transition') {
      const status = options.nextStatus?.(input) ?? {
        start: input.result.mode === 'operator' ? 'capture_active' : 'validation_pending',
        capture_complete: 'capture_complete_validation_unimplemented', simulate_success: 'simulated_success',
        cancel: 'cancelled', expire: 'expired', fail: 'failed',
      }[input.action];
      return {accepted: true, authenticated: false, close_capture: input.action !== 'start',
        result: {...input.result, status, simulation: true, completed_at: input.action === 'simulate_success' ? input.now_secs : input.result.completed_at}};
    }
    if (method === 'authentication_assess') return {authenticated: false, satisfied_for_simulation: false, reason: 'injected assessment'};
    if (method === 'work_privacy_transition') return {accepted: true,
      state: {...input.state, state: 'hold', revision: input.state.revision + 1, updated_at: input.now_secs}};
    return {allowed_for_simulation: true, simulation: true};
  }};
  const privacy = new WorkPrivacyController({engine, clock, state: {account_id: 'account', state: 'hold', revision: 3, updated_at: state.now}});
  const workflow = new AuthenticationWorkflow({engine, privacy, clock,
    captureFactory: options.captureFactory ?? (() => { const adapter = new SyntheticAuthenticationCapture(); state.adapters.push(adapter); return adapter; })});
  return {workflow, privacy, state, clock, engine};
}
function present(f, mode = 'operator') { return f.workflow.present({context, mode, policyId: `fixture-${mode}`}); }

test('presenting a requirement opens no sensor; capture completion leaves identity unvalidated and work stopped', async () => {
  const f = fixture(); await present(f);
  assert.deepEqual(f.state.calls.map(call => call.method), ['authentication_create']);
  assert.equal(f.state.adapters.length, 0);
  await f.workflow.start({deliberate: true});
  const acquisition = f.state.calls.find(call => call.method === 'work_privacy_assess').input;
  assert.equal(acquisition.sensor, 'camera'); assert.equal(acquisition.purpose, 'authentication');
  assert.equal(acquisition.authority, null); assert.equal(acquisition.auth_camera.deliberate, true);
  await f.workflow.completeCapture();
  assert.equal(f.workflow.result.status, 'capture_complete_validation_unimplemented');
  assert.equal(f.state.adapters[0].stopped(), true);
  assert.equal(f.privacy.state.state, 'hold');
  await f.workflow.simulateSuccess();
  assert.equal(f.workflow.result.simulation, true);
  assert.equal(f.workflow.result.status, 'simulated_success');
  assert.equal(f.privacy.state.state, 'hold');
  await f.privacy.close();
});

test('Requester mode enters its configurable pending step without facial capture or sensor permission', async () => {
  const f = fixture(); await present(f, 'requester'); await f.workflow.start({deliberate: true});
  assert.equal(f.workflow.result.status, 'validation_pending');
  assert.equal(f.state.adapters.length, 0);
  assert.equal(f.state.calls.some(call => call.method === 'work_privacy_assess'), false);
  assert.equal(f.privacy.state.state, 'hold');
  await f.workflow.cancel();
});

test('reuse assessment passes account, caller, mode, scope, freshness and simulation marker intact', async () => {
  const f = fixture(); await present(f, 'requester'); await f.workflow.start({deliberate: true}); await f.workflow.simulateSuccess();
  const requirement = {mode: 'operator', policy_id: 'different-policy', reuse_scope: 'task', max_age_secs: 5,
    fresh_after_secs: f.state.now + 1, allow_simulated: false};
  const taskContext = {...context, task_id: 'task-b'};
  const result = await f.workflow.assess({context: taskContext, requirement});
  const input = f.state.calls.at(-1).input;
  assert.deepEqual(input.context, taskContext); assert.deepEqual(input.requirement, requirement);
  assert.equal(input.result.simulation, true);
  assert.equal(result.authenticated, false);
  assert.equal(f.privacy.state.state, 'hold');
});

test('cancel during asynchronous camera open fences late completion and closes its registered resource', async () => {
  const opening = deferred(), state = {closed: false};
  const f = fixture({captureFactory: () => ({open: () => opening.promise,
    close: async () => { state.closed = true; return true; }, stopped: () => state.closed})});
  await present(f);
  const starting = f.workflow.start({deliberate: true}); await tick();
  await f.workflow.cancel(); opening.resolve();
  await assert.rejects(starting, /cancelled/);
  assert.equal(f.workflow.result.status, 'cancelled'); assert.equal(state.closed, true);
  assert.equal(f.privacy.snapshot().devices[0].operation_count, 0);
  assert.equal(f.privacy.state.state, 'hold');
});

test('new hold during image encoding cannot publish media or undo the newer work state', async () => {
  const encoding = deferred(), state = {closed: false};
  const f = fixture({captureFactory: () => ({async open() {}, capture: () => encoding.promise,
    async close() { state.closed = true; return true; }, stopped: () => state.closed})});
  await present(f); await f.workflow.start({deliberate: true});
  const capturing = f.workflow.completeCapture();
  await f.privacy.transition('hold'); await tick();
  encoding.resolve({kind: 'browser-photo', blob: new Blob(['fixture']), simulation: true});
  await assert.rejects(capturing, /cancelled/);
  assert.equal(f.workflow.media, null); assert.equal(f.workflow.result.status, 'cancelled');
  assert.equal(f.privacy.state.revision, 4); assert.equal(state.closed, true);
});

test('expired active authentication revokes an already open resource and drops later capture', async () => {
  const f = fixture(); await present(f); await f.workflow.start({deliberate: true, leaseSecs: 2});
  f.state.now += 2; await f.privacy.expireAuthorities(); await tick();
  assert.equal(f.state.adapters[0].stopped(), true);
  assert.equal(f.workflow.result.status, 'expired');
  await assert.rejects(f.workflow.completeCapture(), /No active/);
});

test('a cancelled pending transition cannot acquire a camera or replace the terminal result', async () => {
  const startReply = deferred();
  const f = fixture({policy: async (method, input) => {
    if (method === 'authentication_transition' && input.action === 'start') return startReply.promise;
  }});
  await present(f); const starting = f.workflow.start({deliberate: true}); await tick();
  const cancelling = f.workflow.cancel();
  startReply.resolve({accepted: true, result: {...f.workflow.result, status: 'capture_active'}});
  await assert.rejects(starting, /newer privacy/); await cancelling;
  assert.equal(f.workflow.result.status, 'cancelled'); assert.equal(f.state.adapters.length, 0);
});

test('terminal transitions serialize ahead of a following simulated verdict', async () => {
  const cancelReply = deferred();
  const f = fixture({policy: async (method, input) => {
    if (method === 'authentication_transition' && input.action === 'cancel') return cancelReply.promise;
    if (method === 'authentication_transition' && input.action === 'simulate_success' && input.result.status === 'cancelled')
      return {accepted: false, result: input.result, reason: 'terminal result'};
  }});
  await present(f, 'requester'); await f.workflow.start({deliberate: true});
  const cancelled = f.workflow.cancel(); const simulating = f.workflow.simulateSuccess();
  await tick(); cancelReply.resolve({accepted: true, result: {...f.workflow.result, status: 'cancelled'}});
  await cancelled; await assert.rejects(simulating, /terminal/);
  assert.equal(f.workflow.result.status, 'cancelled');
});

test('re-presenting after a rejected terminal cancel still starts a new independent check', async () => {
  const f = fixture({policy: async (method, input) => {
    if (method === 'authentication_transition' && input.action === 'cancel' && input.result.status === 'cancelled')
      return {accepted: false, close_capture: true, result: input.result, reason: 'terminal_result_cannot_resume'};
  }});
  await present(f); await f.workflow.cancel();
  await present(f, 'requester');
  assert.equal(f.workflow.result.mode, 'requester');
  assert.equal(f.workflow.result.status, 'requirement_presented');
});

test('pending camera cleanup refuses a simulated verdict and a newer hold drops late media', async () => {
  const cleanup = deferred(); let closed = false;
  const f = fixture({captureFactory: () => ({async open() {}, async capture() { return {kind: 'synthetic', blob: null}; },
    close: async () => { await cleanup.promise; closed = true; return true; }, stopped: () => closed})});
  await present(f); await f.workflow.start({deliberate: true});
  const finishing = f.workflow.completeCapture(); await tick();
  assert.equal(f.workflow.result.status, 'capture_complete_validation_unimplemented');
  await assert.rejects(f.workflow.simulateSuccess(), /cleanup/);
  await f.privacy.transition('hold');
  cleanup.resolve(); await assert.rejects(finishing, /newer privacy/);
  assert.equal(f.workflow.media, null);
});

test('a slower older requirement replacement cannot overwrite the newer mode', async () => {
  const cleanup = deferred(); let closed = false;
  const f = fixture({captureFactory: () => ({async open() {}, close: async () => { await cleanup.promise; closed = true; return true; }, stopped: () => closed})});
  await present(f); await f.workflow.start({deliberate: true});
  const older = f.workflow.present({context, mode: 'operator', policyId: 'older'});
  await tick();
  await f.workflow.present({context, mode: 'requester', policyId: 'newer'});
  cleanup.resolve(); await assert.rejects(older, /replaced/);
  assert.equal(f.workflow.result.mode, 'requester'); assert.equal(f.workflow.result.policy_id, 'newer');
});

function cameraFixture(options = {}) {
  const calls = [], listeners = new Map();
  const track = {readyState: 'live', stop() { calls.push('stop'); this.readyState = 'ended'; },
    addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); }};
  const stream = {getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => []};
  const video = {videoWidth: 320, videoHeight: 240, srcObject: null,
    async play() { calls.push('play'); }, pause() { calls.push('pause'); }};
  const canvas = {width: 0, height: 0, getContext: () => ({drawImage() { calls.push('draw'); }}),
    toBlob(callback, type) { calls.push(type); callback(new Blob(['local-photo'], {type})); }};
  const camera = new BrowserAuthenticationCamera({video, canvasFactory: () => canvas, nativeContext: () => false,
    mediaDevices: {async getUserMedia(value) { calls.push(value); return options.permission ? options.permission.promise : stream; }}});
  const abort = new AbortController();
  return {camera, calls, stream, video, canvas, track, listeners, abort,
    open: interrupted => camera.open({current: () => !abort.signal.aborted, signal: abort.signal, onInterrupted: interrupted})};
}

test('optional camera requests video only; capture re-encodes locally and releases resources', async () => {
  const f = cameraFixture(); await f.open();
  assert.equal(f.calls[0].audio, false); assert.equal(f.calls[0].video.facingMode.ideal, 'user');
  const media = await f.camera.capture();
  assert.equal(media.kind, 'browser-photo'); assert.equal(media.simulation, true); assert.equal(media.blob.type, 'image/jpeg');
  assert.equal(f.canvas.width, 0); assert.equal(f.canvas.height, 0);
  assert.equal(await f.camera.close(), true);
  assert.equal(f.video.srcObject, null); assert.equal(f.track.readyState, 'ended');
});

test('camera cancellation before permission finishes stops every late stream without showing it', async () => {
  const permission = deferred(), f = cameraFixture({permission}), opening = f.open();
  f.abort.abort(); const closing = f.camera.close(); permission.resolve(f.stream);
  await assert.rejects(opening, /cancelled/); assert.equal(await closing, true);
  assert.equal(f.video.srcObject, null); assert.equal(f.calls.includes('play'), false);
  assert.equal(f.track.readyState, 'ended');
});

test('an ended camera track cannot produce a fresh image and interrupts the workflow', async () => {
  const f = cameraFixture(); let interrupted = false; await f.open(() => { interrupted = true; });
  f.track.readyState = 'ended';
  await assert.rejects(f.camera.capture(), /track ended/);
  f.listeners.get('ended')(); await tick();
  assert.equal(interrupted, true); assert.equal(f.video.srcObject, null);
});

test('native developer context refuses browser camera access before requesting permissions', async () => {
  let requests = 0;
  const camera = new BrowserAuthenticationCamera({nativeContext: () => true,
    mediaDevices: {async getUserMedia() { requests++; }}, video: {}});
  await assert.rejects(camera.open({current: () => true, signal: new AbortController().signal}), /native developer/);
  assert.equal(requests, 0);
});

test('cleanup attempts every track even when one stop fails, retaining unconfirmed state', async () => {
  const f = cameraFixture(); await f.open();
  let stopped = false;
  f.stream.getTracks = () => [{readyState: 'live', stop() { throw new Error('track failed'); }},
    {readyState: stopped ? 'ended' : 'live', stop() { stopped = true; }}];
  await assert.rejects(f.camera.close(), /shutdown failed/);
  assert.equal(stopped, true); assert.equal(f.camera.stopped(), false); assert.equal(f.video.srcObject, null);
});

test('Operator face reports keep the captured operation/epoch binding and are forwarded separately to policy', async () => {
  const f = fixture(); await present(f);
  const report = {status: 'match', embedding_match: true, reference_id: 'fixture-reference',
    binding: {account_id: 'account', principal_id: 'person', device_id: 'this-device', operation_id: f.workflow.result.operation_id},
    authenticated: false, liveness: 'unresolved', trusted_capture: 'unresolved', simulation: true};
  const operationId = f.workflow.result.operation_id, epoch = f.workflow.epoch;
  assert.deepEqual(f.workflow.setFaceReport(report, {operationId, epoch}), {attached: true});
  const requirement = {mode: 'operator', policy_id: 'fixture-operator', reuse_scope: 'account', max_age_secs: 300,
    fresh_after_secs: null, allow_simulated: true, face_required: true, face_reference_id: 'fixture-reference'};
  await f.workflow.assess({context, requirement});
  assert.deepEqual(f.state.calls.at(-1).input.face_report, report);
  assert.equal(f.state.calls.at(-1).input.requirement.face_reference_id, 'fixture-reference');
  report.status = 'mutated caller object';
  assert.equal(f.workflow.faceReport.status, 'match');
  f.workflow.clearFaceReport(); assert.equal(f.workflow.snapshot().face_report, null);
});

test('cancellation fences a late face comparison and cannot reopen an authentication result', async () => {
  const f = fixture(); await present(f);
  const binding = {operationId: f.workflow.result.operation_id, epoch: f.workflow.epoch};
  await f.workflow.cancel();
  assert.deepEqual(f.workflow.setFaceReport({status: 'match', simulation: true}, binding), {stale: true});
  assert.equal(f.workflow.faceReport, null); assert.equal(f.workflow.result.status, 'cancelled');
});

test('Requester authentication never accepts or forwards a face report', async () => {
  const f = fixture(); await present(f, 'requester'); await f.workflow.start({deliberate: true});
  assert.throws(() => f.workflow.setFaceReport({status: 'match'}, {operationId: f.workflow.result.operation_id, epoch: f.workflow.epoch}), /Requester/);
  await f.workflow.assess({context, requirement: {mode: 'requester', policy_id: 'fixture-requester', reuse_scope: 'account',
    max_age_secs: 300, fresh_after_secs: null, allow_simulated: true, face_required: false, face_reference_id: null}});
  assert.equal(Object.hasOwn(f.state.calls.at(-1).input, 'face_report'), false);
  assert.equal(f.state.calls.some(call => call.method.startsWith('face_identity')), false);
});

test('cancellation while assessing rejects the late authentication verdict', async () => {
  const pending = deferred(), f = fixture({policy: method => method === 'authentication_assess' ? pending.promise : null});
  await present(f, 'requester');
  const assessment = f.workflow.assess({context, requirement: {mode: 'requester'}});
  await tick(); await f.workflow.cancel();
  pending.resolve({authenticated: false, satisfied_for_simulation: true});
  await assert.rejects(assessment, /assessment was replaced/);
});

test('changing the retained reference during assessment rejects its older face verdict', async () => {
  let referenceId = 'original';
  const f = fixture({policy: method => {
    if (method === 'authentication_assess') { referenceId = 'replacement'; return {authenticated: false, satisfied_for_simulation: true}; }
  }});
  await present(f);
  f.workflow.faceReferenceIdProvider = async () => referenceId;
  await assert.rejects(f.workflow.assess({context, requirement: {mode: 'operator', face_required: true,
    face_reference_id: 'original'}}), /face reference changed/);
});

test('Requester assessment never reads the face reference provider', async () => {
  const f = fixture(); await present(f, 'requester'); let reads = 0;
  f.workflow.faceReferenceIdProvider = async () => { reads++; throw new Error('must not read'); };
  await f.workflow.assess({context, requirement: {mode: 'requester', face_required: false}});
  assert.equal(reads, 0);
});
