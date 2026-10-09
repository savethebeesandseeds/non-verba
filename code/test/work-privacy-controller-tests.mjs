// SPDX-License-Identifier: AGPL-3.0-only
// Platform orchestration tests with an injected policy service. Rust's own
// tests and compiled-WASM integration tests exercise the actual policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {WorkPrivacyController} from '../../web/src/work-privacy-controller.js';

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; }
function fixture(options = {}) {
  const state = {now: 2000000000, calls: [], timers: new Map(), saved: []};
  let timer = 0;
  const engine = {async json(method, json) {
    const input = JSON.parse(json); state.calls.push({method, input});
    if (options.policy) return options.policy(method, input);
    if (method === 'work_privacy_transition') return {accepted: true,
      state: {...input.state, state: options.nextState ?? 'hold', revision: input.state.revision + 1, updated_at: input.now_secs},
      simulation: true, revoke_operations: true};
    return {allowed_for_simulation: true, simulation: true, account_wide_protection: false,
      notification_disposition: 'normal', profile_visible: true, unconfirmed_devices: []};
  }};
  const clock = {seconds: () => state.now,
    setTimeout(callback, delay) { const id = ++timer; state.timers.set(id, {callback, delay}); return id; },
    clearTimeout(id) { state.timers.delete(id); }};
  const controller = new WorkPrivacyController({engine, clock,
    state: {account_id: 'account', state: 'available', revision: 4, updated_at: state.now},
    persist: value => state.saved.push(value)});
  return {controller, state, engine, clock};
}
function resource(options = {}) {
  const state = {stopped: false, closes: []};
  return {state, async close(reason) {
    state.closes.push(reason);
    if (options.closing) await options.closing.promise;
    if (options.fail?.()) throw new Error('fixture cleanup failure');
    state.stopped = true; return true;
  }, stopped: () => state.stopped};
}
const startOptions = {deviceId: 'this-device', sensor: 'camera', purpose: 'work', explicitConsent: true};

test('every acquisition delegates exact purpose and scoped authority to the injected Rust boundary', async () => {
  const f = fixture();
  for (const purpose of ['work', 'preview', 'diagnostics', 'calibration']) {
    const r = resource(); const handle = await f.controller.startSensor({...startOptions, purpose}, () => r);
    const input = f.state.calls.at(-1).input;
    assert.equal(input.authority.purpose, purpose);
    assert.deepEqual(input.authority.sensors, ['camera']);
    assert.equal(input.authority.explicit_consent, true);
    assert.equal(input.auth_camera, null);
    await handle.close();
  }
  const r = resource(); await f.controller.startSensor({...startOptions, purpose: 'authentication', deliberate: true}, () => r);
  assert.equal(f.state.calls.at(-1).input.authority, null);
  assert.equal(f.state.calls.at(-1).input.auth_camera.device_id, 'this-device');
  await f.controller.close();
});

test('denied policy cannot reach a platform resource factory', async () => {
  const f = fixture({policy: async () => ({allowed_for_simulation: false, reason: 'core blocked acquisition'})});
  let opens = 0;
  await assert.rejects(f.controller.startSensor(startOptions, () => { opens++; return resource(); }), /core blocked/);
  assert.equal(opens, 0);
  assert.equal(f.controller.snapshot().devices[0].operation_count, 0);
});

test('stop fences callbacks immediately and reports pending until physical cleanup confirms', async () => {
  const f = fixture(), closing = deferred(), r = resource({closing});
  const handle = await f.controller.startSensor(startOptions, () => r);
  const change = f.controller.transition('hold');
  assert.equal(handle.current(), false);
  await change;
  assert.equal(f.controller.state.state, 'hold');
  assert.equal(f.controller.snapshot().devices[0].status, 'pending');
  assert.equal(f.controller.snapshot().devices[0].revision, 4);
  closing.resolve(); await f.controller.stopDevice('this-device');
  assert.equal(f.controller.snapshot().devices[0].status, 'stopped');
  assert.equal(f.controller.snapshot().devices[0].revision, 5);
});

test('late resource acquisition stays tracked and failed cleanup never acknowledges shutdown', async () => {
  const f = fixture(), acquisition = deferred(), r = resource({fail: () => true});
  const starting = f.controller.startSensor(startOptions, () => acquisition.promise);
  await tick();
  const stopping = f.controller.stopOperation('this-device', 'inspection-1');
  assert.equal(f.controller.snapshot().devices[0].operation_count, 1);
  acquisition.resolve(r);
  await assert.rejects(starting, /cancelled/); assert.equal(await stopping, false);
  const device = f.controller.snapshot().devices[0];
  assert.equal(device.status, 'failed'); assert.equal(device.operation_count, 1);
  assert.match(device.operations[0].cleanup_error, /cleanup failure/);
});

test('cancel before the acquisition microtask prevents even calling the factory', async () => {
  const f = fixture(); let opens = 0;
  f.controller.onChange = snapshot => {
    const op = snapshot.devices[0].operations[0];
    if (op?.active) void f.controller.stopOperation('this-device', op.operation_id);
  };
  await assert.rejects(f.controller.startSensor(startOptions, () => { opens++; return resource(); }), /revoked|cancelled/);
  assert.equal(opens, 0);
  assert.equal(f.controller.snapshot().devices[0].status, 'stopped');
});

test('lease expiry fences reads even when the timer callback is delayed', async () => {
  const f = fixture(), r = resource(), handle = await f.controller.startSensor({...startOptions, leaseSecs: 3}, () => r);
  f.state.now += 3;
  assert.equal(handle.current(), false);
  assert.equal(r.stopped(), false);
  await f.controller.expireAuthorities();
  assert.equal(r.stopped(), true);
  assert.equal(f.state.timers.size, 0);
});

test('late policy decisions cannot acquire expired or revoked resources', async () => {
  for (const reason of ['expire', 'stop']) {
    const policy = deferred(); let opens = 0;
    const f = fixture({policy: async () => policy.promise});
    const starting = f.controller.startSensor({...startOptions, leaseSecs: 2}, () => { opens++; return resource(); });
    if (reason === 'expire') f.state.now += 2;
    else await f.controller.stopDevice('this-device');
    policy.resolve({allowed_for_simulation: true});
    await assert.rejects(starting, /expired|authority changed/);
    assert.equal(opens, 0);
  }
});

test('concurrent duplicate operation IDs cannot overwrite and leak a resource', async () => {
  const gate = deferred(), f = fixture({policy: async () => gate.promise}); let opens = 0;
  const options = {...startOptions, operationId: 'same-operation'};
  const first = f.controller.startSensor(options, () => { opens++; return resource(); });
  const second = f.controller.startSensor(options, () => { opens++; return resource(); });
  gate.resolve({allowed_for_simulation: true});
  const results = await Promise.allSettled([first, second]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(opens, 1);
  await f.controller.close();
});

test('account stop reaches connected devices and offline expiry remains unconfirmed', async () => {
  const f = fixture(), remote = resource();
  await f.controller.startSensor({...startOptions, deviceId: 'second-device'}, () => remote);
  await f.controller.connect('second-device', false);
  await f.controller.transition('hold');
  assert.equal(remote.stopped(), false);
  f.state.now += 31; await f.controller.expireAuthorities();
  assert.equal(remote.stopped(), true);
  assert.equal(f.controller.snapshot().devices[1].status, 'unreachable');
  await f.controller.summary();
  const devices = f.state.calls.at(-1).input.devices;
  assert.deepEqual(Object.keys(devices[1]).sort(), ['device_id', 'observed_at', 'revision', 'status']);
  assert.equal(devices[1].observed_at, null);
  await f.controller.connect('second-device', true);
  assert.equal(f.controller.snapshot().devices[1].revision, f.controller.state.revision);
});

test('cleanup failure blocks new operations until retry confirms existing resources stopped', async () => {
  let fail = true;
  const f = fixture(), failing = resource({fail: () => fail}), successful = resource();
  await f.controller.startSensor({...startOptions, operationId: 'failure'}, () => failing);
  await f.controller.startSensor({...startOptions, operationId: 'success'}, () => successful);
  await f.controller.stopOperation('this-device', 'failure');
  await f.controller.stopOperation('this-device', 'success');
  assert.equal(f.controller.snapshot().devices[0].status, 'failed');
  await assert.rejects(f.controller.startSensor(startOptions, () => resource()), /cleanup/);
  fail = false; await f.controller.stopDevice('this-device');
  assert.equal(f.controller.snapshot().devices[0].status, 'stopped');
  await f.controller.startSensor(startOptions, () => resource());
  await f.controller.close();
});

test('queued resume followed by stop never admits sensing during the outstanding stop', async () => {
  const gate = deferred(); let transitionCount = 0;
  const f = fixture({policy: async (method, input) => {
    if (method !== 'work_privacy_transition') return {allowed_for_simulation: true};
    if (++transitionCount === 1) await gate.promise;
    return {accepted: true, state: {...input.state, state: transitionCount === 1 ? 'available' : 'hold', revision: input.state.revision + 1}};
  }});
  const resuming = f.controller.transition('clock_in'), stopping = f.controller.transition('hold');
  await assert.rejects(f.controller.startSensor(startOptions, () => resource()), /privacy stop/);
  gate.resolve(); await resuming; await stopping;
  assert.equal(f.controller.state.state, 'hold');
  assert.equal(f.state.saved.length, 2);
});
