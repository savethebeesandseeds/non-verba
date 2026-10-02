// SPDX-License-Identifier: AGPL-3.0-only
// UI lifecycle test doubles; physical Android window-flag behavior is tested separately.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {installScreenAwakeUI} from '../../web/src/screen-awake.js';

class Element extends EventTarget {
  hidden = true; disabled = false; textContent = ''; attrs = new Map();
  setAttribute(name, value) { this.attrs.set(name, value); }
}
function fixture(t, {bridgePresent = true, enabled = false, active = false} = {}) {
  const root = new EventTarget(), events = new EventTarget();
  const mount = new Element(), button = new Element(), status = new Element(), note = new Element();
  const elements = new Map([['screen-awake', mount], ['screen-awake-toggle', button], ['screen-awake-status', status], ['screen-awake-note', note]]);
  root.getElementById = id => elements.get(id);
  let value = {version: 1, enabled, active}, thrown = false, malformed = null;
  const requests = [], timers = new Map();
  let sequence = 0;
  const bridge = {state() { if (thrown) throw Error('disconnected'); return malformed ?? JSON.stringify(value); },
    setEnabled(next) { requests.push(next); }};
  const ui = installScreenAwakeUI({root, events, bridge: bridgePresent ? bridge : undefined,
    schedule(fn, ms) { assert.equal(ms, 2000); timers.set(++sequence, fn); return sequence; },
    unschedule(id) { timers.delete(id); }});
  t.after(() => ui?.dispose());
  return {ui, root, events, mount, button, status, note, requests, timers, bridge,
    click: () => button.dispatchEvent(new Event('click')),
    confirm(enabled, active) { value = {version: 1, enabled, active}; events.dispatchEvent(new Event('nonverba:screen-awake')); },
    invalid(raw) { malformed = raw; },
    break() { thrown = true; },
    timeout() { const callbacks = [...timers.values()]; timers.clear(); for (const callback of callbacks) callback(); },
  };
}

test('browser pages hide the control and do not request a wake lock', t => {
  const f = fixture(t, {bridgePresent: false});
  assert.equal(f.ui, null); assert.equal(f.mount.hidden, true); assert.deepEqual(f.requests, []);
});

test('mount reads the native state without enabling anything', t => {
  const f = fixture(t);
  assert.equal(f.mount.hidden, false); assert.equal(f.button.disabled, false);
  assert.equal(f.button.attrs.get('aria-pressed'), 'false'); assert.match(f.status.textContent, /^Off/);
  assert.deepEqual(f.requests, []); assert.equal(f.timers.size, 0);
});

test('explicit toggle waits for native acknowledgement and can turn off again', t => {
  const f = fixture(t);
  f.click(); assert.deepEqual(f.requests, [true]); assert.equal(f.button.disabled, true);
  assert.equal(f.button.attrs.get('aria-pressed'), 'false'); assert.match(f.status.textContent, /Updating/);
  f.click(); assert.deepEqual(f.requests, [true]);
  f.confirm(true, true); assert.equal(f.button.disabled, false);
  assert.equal(f.button.attrs.get('aria-pressed'), 'true'); assert.match(f.status.textContent, /^On — screen/);
  assert.equal(f.timers.size, 0);
  f.click(); assert.deepEqual(f.requests, [true, false]); f.confirm(false, false);
  assert.equal(f.button.attrs.get('aria-pressed'), 'false'); assert.match(f.status.textContent, /^Off/);
});

test('stale event cannot confirm a pending change; bounded timeout permits retry', t => {
  const f = fixture(t);
  f.click(); f.confirm(false, false);
  assert.equal(f.button.disabled, true); assert.equal(f.timers.size, 1);
  f.timeout(); assert.equal(f.button.disabled, false); assert.match(f.status.textContent, /did not change/);
  assert.equal(f.button.attrs.get('aria-pressed'), 'false');
  f.click(); assert.deepEqual(f.requests, [true, true]);
});

test('timeout reads a confirmed state when its change event was lost', t => {
  const f = fixture(t);
  f.click(); f.bridge.state = () => JSON.stringify({version: 1, enabled: true, active: true});
  f.timeout(); assert.equal(f.button.disabled, false);
  assert.equal(f.button.attrs.get('aria-pressed'), 'true'); assert.match(f.status.textContent, /^On — screen/);
});

test('foreground lifecycle updates do not toggle preference or touch other handlers', t => {
  const f = fixture(t, {enabled: true, active: true});
  let lifecycleCalls = 0; f.root.addEventListener('visibilitychange', () => lifecycleCalls++);
  f.confirm(true, false); assert.match(f.status.textContent, /waiting.*foreground/);
  assert.equal(f.button.attrs.get('aria-pressed'), 'true');
  f.root.dispatchEvent(new Event('visibilitychange')); assert.equal(lifecycleCalls, 1);
  f.confirm(true, true); assert.match(f.status.textContent, /^On — screen/);
  assert.deepEqual(f.requests, []);
});

test('pagehide clears pending UI waits while pageshow recovers the native preference', t => {
  const f = fixture(t);
  f.click(); f.events.dispatchEvent(new Event('pagehide'));
  assert.equal(f.timers.size, 0); assert.deepEqual(f.requests, [true]);
  f.bridge.state = () => JSON.stringify({version: 1, enabled: true, active: true});
  f.events.dispatchEvent(new Event('pageshow')); assert.equal(f.button.attrs.get('aria-pressed'), 'true');
  assert.equal(f.button.disabled, false); assert.deepEqual(f.requests, [true]);
});

test('event details cannot impersonate native enabled state', t => {
  const f = fixture(t), event = new Event('nonverba:screen-awake');
  Object.defineProperty(event, 'detail', {value: {version: 1, enabled: true, active: true}});
  f.events.dispatchEvent(event); assert.equal(f.button.attrs.get('aria-pressed'), 'false');
});

test('malformed or unavailable bridge state never claims the screen is held awake', t => {
  for (const raw of ['{}', 'null', '[]', 'x'.repeat(257),
    JSON.stringify({version: 2, enabled: true, active: true}),
    JSON.stringify({version: 1, enabled: 'true', active: true}),
    JSON.stringify({version: 1, enabled: false, active: true})]) {
    const f = fixture(t); f.invalid(raw); f.ui.refresh();
    assert.equal(f.button.disabled, true); assert.equal(f.button.attrs.get('aria-pressed'), 'false');
    assert.match(f.status.textContent, /unavailable/); assert.deepEqual(f.requests, []);
  }
  const f = fixture(t); f.click(); f.break(); f.timeout();
  assert.equal(f.button.disabled, true); assert.equal(f.timers.size, 0);
  assert.match(f.status.textContent, /unavailable/);
});

test('failed toggle recovers current state and cleanup stops future mutations', t => {
  const f = fixture(t);
  f.bridge.setEnabled = () => { throw Error('not foreground'); };
  f.click(); assert.equal(f.button.disabled, false); assert.equal(f.timers.size, 0);
  assert.match(f.status.textContent, /could not be changed/);
  f.bridge.setEnabled = next => f.requests.push(next); f.click();
  f.ui.dispose(); assert.equal(f.timers.size, 0); f.click();
  f.confirm(true, true); assert.deepEqual(f.requests, [true]);
});

test('every sensor/key route has one opt-in mount with the external module and strict CSP', async () => {
  for (const page of ['index', 'location', 'live-location', 'audio', 'key-enrollment']) {
    const html = await readFile(new URL('../../web/src/' + page + '.html', import.meta.url), 'utf8');
    for (const id of ['screen-awake', 'screen-awake-toggle', 'screen-awake-status', 'screen-awake-note']) {
      assert.equal([...html.matchAll(new RegExp('id="' + id + '"', 'g'))].length, 1, page + ':' + id);
    }
    assert.match(html, /id="screen-awake" class="screen-awake" hidden/);
    assert.match(html, /id="screen-awake-toggle"[^>]*aria-pressed="false"/);
    assert.match(html, /<script type="module" src="\.\/screen-awake\.js"><\/script>/);
    assert.match(html, /style-src 'self'; style-src-attr 'none'/);
    assert.doesNotMatch(html, /'unsafe-inline'/);
  }
});


test('restored native lease displays its deadline without enabling or extending it', t => {
  const f = fixture(t), expires = Date.now() + 7200000;
  f.bridge.state = () => JSON.stringify({version:1, enabled:true, active:true, expires_at_ms:expires, remaining_ms:7200000});
  f.ui.refresh();
  assert.match(f.status.textContent, /On — screen.*Session ends at/);
  assert.ok(f.status.textContent.includes(new Date(expires).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})));
  assert.match(f.note.textContent, /two-hour.*restarts and updates/);
  assert.equal(f.button.attrs.get('aria-pressed'), 'true');
  assert.deepEqual(f.requests, []);
});

test('native expiry clears the lease display and permits a fresh explicit opt-in', t => {
  const f = fixture(t), expires = Date.now() + 1000;
  f.bridge.state = () => JSON.stringify({version:1, enabled:true, active:false, expires_at_ms:expires, remaining_ms:1000});
  f.ui.refresh();
  assert.match(f.status.textContent, /waiting.*Session ends at/);
  f.bridge.state = () => JSON.stringify({version:1, enabled:false, active:false, expires_at_ms:null, remaining_ms:0});
  f.events.dispatchEvent(new Event('nonverba:screen-awake'));
  assert.match(f.status.textContent, /^Off/);
  assert.doesNotMatch(f.status.textContent, /Session ends/);
  assert.equal(f.button.attrs.get('aria-pressed'), 'false');
  f.click();
  assert.deepEqual(f.requests, [true]);
});

test('malformed lease deadlines and durations cannot claim an active screen lease', t => {
  const now = Date.now();
  for (const lease of [
    {expires_at_ms:now+1, remaining_ms:0},
    {expires_at_ms:now+1, remaining_ms:7200001},
    {expires_at_ms:now+1, remaining_ms:-1},
    {expires_at_ms:now+1, remaining_ms:1.5},
    {expires_at_ms:null, remaining_ms:100},
    {expires_at_ms:'tomorrow', remaining_ms:100},
    {expires_at_ms:9000000000000000, remaining_ms:100},
    {expires_at_ms:now+1},
    {remaining_ms:100},
  ]) {
    const f = fixture(t);
    f.invalid(JSON.stringify({version:1, enabled:true, active:true, ...lease}));
    f.ui.refresh();
    assert.equal(f.button.disabled, true);
    assert.equal(f.button.attrs.get('aria-pressed'), 'false');
    assert.match(f.status.textContent, /unavailable/);
  }
  const f = fixture(t);
  f.invalid(JSON.stringify({version:1, enabled:false, active:false, expires_at_ms:now+100, remaining_ms:100}));
  f.ui.refresh();
  assert.match(f.status.textContent, /unavailable/);
});
