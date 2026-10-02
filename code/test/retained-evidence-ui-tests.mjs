// SPDX-License-Identifier: AGPL-3.0-only
// DOM/event doubles cover UI state and cancellation guards. Real storage,
// signatures, browser reload and layout are exercised by the browser suite.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// The production requester opens its vault on import. This UI-only harness
// injects Requester below; any attempt to use real storage would stay pending.
globalThis.indexedDB = {open: () => ({})};
const {installRetainedEvidenceUI} = await import('../../web/src/retained-evidence-ui.js');

const html = await readFile(new URL('../../web/src/index.html', import.meta.url), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const id = 'a'.repeat(64), otherId = 'b'.repeat(64);
const report = {verified: true, fresh_action_eligible: true, demo: false, request: {session_id: id}};
const accepted = {session_id: id, accepted_at_ms: 1234, acceptance_recorded: true, global_replay_checked: false};
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check) {
  for (let attempts = 0; attempts < 100; attempts++) { if (check()) return; await tick(); }
  assert.ok(check(), 'UI operation did not settle');
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return {promise, resolve, reject};
}
class Element extends EventTarget { value = ''; textContent = ''; disabled = false; hidden = false; }
function setup(t, options = {}) {
  const root = new EventTarget(), host = new EventTarget(), elements = new Map(ids.map(name => [name, new Element()]));
  const $ = name => { assert.ok(elements.has(name), `UI element exists: ${name}`); return elements.get(name); };
  root.getElementById = $; root.hidden = false;
  const requesters = [], calls = [];
  class Requester {
    constructor(engine) { assert.equal(engine, options.engine); this.closed = false; requesters.push(this); }
    async inspectRetained(sessionId) {
      calls.push(['inspect', sessionId]);
      return options.inspect ? options.inspect(sessionId, this) : {report: structuredClone(report), acceptance: null};
    }
    async accept(sessionId, guard) {
      calls.push(['accept', sessionId]);
      assert.equal(guard(), true);
      return options.accept ? options.accept(sessionId, guard, this) : structuredClone(accepted);
    }
    close() { this.closed = true; }
  }
  const ui = installRetainedEvidenceUI({engine: options.engine, root, host, Requester});
  t.after(() => ui.dispose());
  const click = name => $(name).dispatchEvent(new Event('click'));
  const input = (value, event = 'input') => { $('retained-evidence-id').value = value; if (event) $('retained-evidence-id').dispatchEvent(new Event(event)); };
  const load = async (value = id) => { input(value); click('retained-evidence-load'); await until(() => !$('retained-evidence-load').disabled); };
  return {$, root, host, ui, requesters, calls, input, click, load};
}

test('valid IDs require explicit inspection, with no requester or acceptance on install or edit', async t => {
  assert.equal(new Set(ids).size, ids.length);
  const s = setup(t);
  assert.equal(s.requesters.length, 0);
  for (const value of ['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), ` ${id}`, 'g'.repeat(64)]) {
    s.input(value); s.click('retained-evidence-load'); assert.equal(s.requesters.length, 0);
    assert.equal(s.$('retained-evidence-load').disabled, true);
  }
  s.input(id); assert.equal(s.requesters.length, 0); assert.equal(s.$('retained-evidence-accept').disabled, true);
  s.click('retained-evidence-load'); await until(() => !s.$('retained-evidence-result').hidden);
  assert.deepEqual(s.calls, [['inspect', id]]);
  assert.match(s.$('retained-evidence-freshness').textContent, /last check: eligible/);
  assert.match(s.$('retained-evidence-acceptance').textContent, /No acceptance recorded/);
  assert.equal(s.$('retained-evidence-acceptance-details').hidden, true);
});

test('pending inspection blocks duplicate actions but leaves cancellation and editing available', async t => {
  const wait = deferred(), s = setup(t, {inspect: () => wait.promise});
  s.input(id); s.click('retained-evidence-load'); s.click('retained-evidence-load');
  assert.equal(s.calls.length, 1); assert.equal(s.$('retained-evidence-clear').disabled, false);
  assert.equal(s.$('retained-evidence-id').disabled, false); assert.equal(s.$('retained-evidence-accept').disabled, true);
  s.click('retained-evidence-clear'); wait.resolve({report, acceptance: accepted}); await tick();
  assert.equal(s.requesters[0].closed, true); assert.equal(s.$('retained-evidence-id').value, '');
  assert.equal(s.$('retained-evidence-result').hidden, true); assert.equal(s.$('retained-evidence-report').textContent, '');
  assert.match(s.$('retained-evidence-status').textContent, /cancelled and cleared/);
});

test('an input edit discards late inspection and cannot overwrite a newer lookup', async t => {
  const wait = deferred(), s = setup(t, {inspect: sessionId => sessionId === id ? wait.promise : {report: {...report, request: {session_id: otherId}}, acceptance: null}});
  s.input(id); s.click('retained-evidence-load'); await s.load(otherId);
  assert.equal(s.requesters[0].closed, true); assert.equal(s.requesters.length, 2);
  wait.resolve({report, acceptance: accepted}); await tick();
  assert.equal(JSON.parse(s.$('retained-evidence-report').textContent).request.session_id, otherId);
  assert.match(s.$('retained-evidence-acceptance').textContent, /No acceptance recorded/);
  assert.equal(s.$('retained-evidence-load').disabled, false);
});

test('even an input replacement without an event prevents publishing inspection results', async t => {
  const wait = deferred(), s = setup(t, {inspect: () => wait.promise});
  s.input(id); s.click('retained-evidence-load'); s.input(otherId, null);
  wait.resolve({report, acceptance: accepted}); await tick();
  assert.equal(s.$('retained-evidence-result').hidden, true); assert.equal(s.requesters[0].closed, true);
  assert.match(s.$('retained-evidence-status').textContent, /lookup changed/);
});

test('explicit acceptance uses retained authority and keeps the retry available', async t => {
  let count = 0;
  const s = setup(t, {accept: async () => { if (++count > 1) throw new Error('This evidence was already accepted.'); return accepted; }});
  await s.load(); assert.equal(s.calls.filter(([kind]) => kind === 'accept').length, 0);
  s.click('retained-evidence-accept'); await until(() => /accepted once/.test(s.$('retained-evidence-status').textContent));
  assert.deepEqual(s.calls, [['inspect', id], ['accept', id]]);
  assert.match(s.$('retained-evidence-acceptance').textContent, /Already accepted/);
  assert.equal(JSON.parse(s.$('retained-evidence-report').textContent).verified, true);
  assert.equal(s.$('retained-evidence-accept').disabled, false);
  s.click('retained-evidence-accept'); await until(() => /Acceptance rejected/.test(s.$('retained-evidence-status').textContent));
  assert.equal(count, 2); assert.match(s.$('retained-evidence-status').textContent, /already accepted/);
  assert.deepEqual(JSON.parse(s.$('retained-evidence-acceptance-record').textContent), accepted);
});

test('fresh UI after reload must inspect again and separates durable acceptance from freshness and signature validity', async t => {
  let ledger = null;
  const options = {inspect: () => ({report: {...report, fresh_action_eligible: false}, acceptance: ledger}),
    accept: () => { throw new Error('Evidence does not satisfy this fresh action policy.'); }};
  const before = setup(t, options); await before.load(); before.ui.dispose(); ledger = accepted;
  const after = setup(t, options);
  assert.equal(after.requesters.length, 0); assert.equal(after.$('retained-evidence-result').hidden, true);
  await after.load();
  assert.match(after.$('retained-evidence-verification').textContent, /receipt verified/);
  assert.match(after.$('retained-evidence-freshness').textContent, /not eligible/);
  assert.match(after.$('retained-evidence-acceptance').textContent, /Already accepted/);
  assert.equal(after.$('retained-evidence-accept').disabled, false);
  after.click('retained-evidence-accept'); await until(() => /Acceptance rejected/.test(after.$('retained-evidence-status').textContent));
  assert.match(after.$('retained-evidence-status').textContent, /fresh action policy/);
});

test('missing completed evidence or mismatched requester identity leaves no report or accept authority', async t => {
  let unavailable = false;
  const s = setup(t, {inspect: () => { if (unavailable) throw new Error('No completed evidence for this independently known requester.'); return {report, acceptance: null}; }});
  await s.load(); unavailable = true; await s.load(otherId);
  assert.equal(s.$('retained-evidence-result').hidden, true); assert.equal(s.$('retained-evidence-accept').disabled, true);
  assert.equal(s.$('retained-evidence-report').textContent, '');
  assert.match(s.$('retained-evidence-status').textContent, /No completed evidence/);
});

test('failed verification can display a prior local acceptance without enabling a fresh action', async t => {
  const s = setup(t, {inspect: () => ({report: {...report, verified: false, fresh_action_eligible: false, errors: ['retained bytes changed']}, acceptance: accepted})});
  await s.load(); s.click('retained-evidence-accept');
  assert.match(s.$('retained-evidence-verification').textContent, /did not pass/);
  assert.match(s.$('retained-evidence-acceptance').textContent, /Already accepted/);
  assert.equal(s.calls.length, 1); assert.equal(s.$('retained-evidence-accept').disabled, true);
});

for (const event of ['clear', 'input', 'silent-input', 'pagehide', 'hidden', 'nonverba:pause']) {
  test(`${event} during acceptance closes the requester and invalidates the atomic commit guard`, async t => {
    const wait = deferred(); let commits = 0, guardPassed;
    const s = setup(t, {accept: async (_sessionId, guard) => {
      await wait.promise; guardPassed = guard();
      if (!guardPassed) throw new Error('The evidence acceptance context changed.');
      commits++; return accepted;
    }});
    await s.load(); s.click('retained-evidence-accept'); s.click('retained-evidence-accept');
    assert.equal(s.calls.filter(([kind]) => kind === 'accept').length, 1);
    assert.equal(s.$('retained-evidence-clear').disabled, false);
    if (event === 'clear') s.click('retained-evidence-clear');
    else if (event === 'input') s.input(otherId);
    else if (event === 'silent-input') s.input(otherId, null);
    else if (event === 'hidden') { s.root.hidden = true; s.root.dispatchEvent(new Event('visibilitychange')); }
    else s.host.dispatchEvent(new Event(event));
    wait.resolve(); await until(() => guardPassed !== undefined); await tick();
    assert.equal(guardPassed, false); assert.equal(commits, 0); assert.equal(s.requesters[0].closed, true);
    assert.equal(s.$('retained-evidence-result').hidden, true); assert.equal(s.$('retained-evidence-accept').disabled, true);
    assert.equal(s.$('retained-evidence-acceptance-record').textContent, '');
    s.root.hidden = false; s.root.dispatchEvent(new Event('visibilitychange')); await s.load();
    assert.equal(s.requesters.length, 2); assert.equal(s.requesters[1].closed, false);
  });
}

test('late acceptance failure after cancellation cannot replace the newer inspection status', async t => {
  const wait = deferred(), s = setup(t, {accept: () => wait.promise});
  await s.load(); s.click('retained-evidence-accept'); await s.load(otherId);
  const currentStatus = s.$('retained-evidence-status').textContent;
  wait.reject(new Error('Old acceptance failed.')); await tick();
  assert.equal(s.$('retained-evidence-status').textContent, currentStatus);
  assert.equal(s.$('retained-evidence-load').disabled, false); assert.equal(s.$('retained-evidence-accept').disabled, false);
});

test('page suspension during inspection discards the late result and fresh action recreates the requester', async t => {
  const wait = deferred(); let first = true;
  const s = setup(t, {inspect: () => { if (first) { first = false; return wait.promise; } return {report, acceptance: null}; }});
  s.input(id); s.click('retained-evidence-load'); s.root.hidden = true; s.root.dispatchEvent(new Event('visibilitychange'));
  wait.resolve({report, acceptance: accepted}); await tick();
  assert.equal(s.requesters[0].closed, true); assert.equal(s.$('retained-evidence-result').hidden, true);
  s.root.hidden = false; s.root.dispatchEvent(new Event('visibilitychange')); await s.load();
  assert.equal(s.requesters.length, 2); assert.match(s.$('retained-evidence-acceptance').textContent, /No acceptance recorded/);
});
