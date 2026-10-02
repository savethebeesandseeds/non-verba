// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installGpsWarmupUI} from '../../web/src/gps-warmup.js';

class Element extends EventTarget {
  children = []; attributes = {}; disabled = false;
  append(...children) { this.children.push(...children); }
  after(value) { this.next = value; }
  setAttribute(name, value) { this.attributes[name] = value; }
}
function fixture(t) {
  const anchor = new Element(), events = new EventTarget(), calls = [], timers = new Map();
  let state = {version: 1, unsigned: true, active: false, remaining_ms: 0, reason: 'stopped'}, serial = 0;
  const root = {getElementById: id => id === 'screen-awake' ? anchor : null, createElement: () => new Element()};
  const bridge = {state: () => JSON.stringify(state), prepare: () => calls.push('prepare'), stop: () => calls.push('stop')};
  const ui = installGpsWarmupUI({root, events, bridge, schedule: callback => {timers.set(++serial, callback); return serial;}, unschedule: id => timers.delete(id)});
  const button = anchor.next.children[0], status = anchor.next.children[1].children[0];
  t.after(() => ui.dispose());
  return {ui, events, bridge, calls, timers, button, status,
    click: () => button.dispatchEvent(new Event('click')),
    update(value) { state = value; events.dispatchEvent(new Event('nonverba:gps-warmup')); }};
}
test('browser and absent native bridge do not mount or start GPS', () => {
  assert.equal(installGpsWarmupUI({root:{getElementById:() => new Element()}, bridge:{}}), null);
});
test('rendering reads state only; explicit start/stop waits for native acknowledgement', t => {
  const f = fixture(t); assert.deepEqual(f.calls, []); assert.match(f.status.textContent, /off/);
  f.click(); f.click(); assert.deepEqual(f.calls, ['prepare']); assert.equal(f.button.disabled, true);
  f.update({version:1,unsigned:true,active:true,remaining_ms:299000,reason:'active'});
  assert.match(f.status.textContent, /not a verified fix/); assert.equal(f.button.disabled, false);
  f.click(); assert.deepEqual(f.calls, ['prepare','stop']);
  f.update({version:1,unsigned:true,active:false,remaining_ms:0,reason:'stopped'});
  assert.match(f.status.textContent, /off/); assert.equal(f.timers.size, 0);
});
test('event payload cannot claim readiness and malformed native state disables controls', t => {
  const f = fixture(t), event = new Event('nonverba:gps-warmup');
  Object.defineProperty(event,'detail',{value:{active:true}}); f.events.dispatchEvent(event);
  assert.match(f.status.textContent,/off/);
  for (const value of [null, {}, {version:1,unsigned:true,active:true,remaining_ms:0,reason:'active'},
    {version:1,unsigned:false,active:true,remaining_ms:300000,reason:'active'},
    {version:1,unsigned:true,active:true,remaining_ms:300001,reason:'active'}]) {
    f.update(value); assert.equal(f.button.disabled,true); assert.match(f.status.textContent,/unavailable/);
  }
  assert.deepEqual(f.calls,[]);
});
test('leaving clears pending UI work without cancelling another evidence session', t => {
  const f = fixture(t); f.click(); f.events.dispatchEvent(new Event('pagehide'));
  assert.equal(f.timers.size,0); f.click(); assert.deepEqual(f.calls,['prepare']);
});
test('restored cached page rereads native state and restores working controls', t => {
  const f = fixture(t);
  f.update({version:1,unsigned:true,active:true,remaining_ms:290000,reason:'active'});
  f.events.dispatchEvent(new Event('pagehide'));
  assert.doesNotMatch(f.status.textContent,/warm-up active/); assert.equal(f.button.disabled,true);
  f.update({version:1,unsigned:true,active:false,remaining_ms:0,reason:'expired'});
  f.events.dispatchEvent(new Event('pageshow'));
  assert.match(f.status.textContent,/off \(expired\)/); assert.equal(f.button.disabled,false);
  f.click(); assert.deepEqual(f.calls,['prepare']);
});
