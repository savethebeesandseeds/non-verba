// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import {createPasswordManagerSignIn} from '../../../web/apps/non-verba/src/password-manager-sign-in.js';

const normalizeIdentifier = value => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid identifier.');
  return value.trim().toLowerCase().replace(/^@/, '');
};
function fixture(get, overrides = {}) {
  const calls = [], requests = [];
  const scope = {isSecureContext:true, PasswordCredential:class {},
    navigator:{credentials:{get(options) { requests.push(options); return get(options); }}}, ...overrides};
  const manager = createPasswordManagerSignIn({scope, normalizeIdentifier, signIn:async value => { calls.push(value); }});
  return {manager, calls, requests, scope};
}
const saved = (id = 'participant', password = 'synthetic-only-password') => ({type:'password', id, password});

test('explicit silent matching credential signs in once without requesting a chooser', async () => {
  const {manager,calls,requests} = fixture(() => saved('@Participant'));
  assert.equal(await manager.trySignIn(' participant '),true);
  assert.deepEqual(calls,[{identifier:' participant ',password:'synthetic-only-password'}]);
  assert.equal(requests.length,1);
  assert.equal(requests[0].password,true);
  assert.equal(requests[0].mediation,'silent');
  assert.ok(requests[0].signal instanceof AbortSignal);
});

test('unsupported, insecure and WebAuthn-only environments fall back without a request', async () => {
  for (const overrides of [{isSecureContext:false},{PasswordCredential:undefined},{navigator:{credentials:{}}},{navigator:{}}]) {
    const {manager,calls,requests} = fixture(() => saved(),overrides);
    assert.equal(await manager.trySignIn('participant'),false);
    assert.deepEqual(calls,[]); assert.deepEqual(requests,[]);
  }
});

test('null, rejected, wrong type, invalid and mismatched credentials use the password step', async () => {
  for (const get of [() => null, () => Promise.reject(new Error('Synthetic refusal')),
    () => { throw new Error('Synthetic unavailable'); }, () => ({type:'public-key',id:'participant'}),
    () => saved('another'), () => saved(''), () => saved('participant','short'), () => saved('participant','x'.repeat(1025)),
    () => saved('participant','é'.repeat(513))]) {
    const {manager,calls,requests} = fixture(get);
    assert.equal(await manager.trySignIn('participant'),false); assert.deepEqual(calls,[]);
    assert.equal(requests.length,1,'Fallback never retries with an interactive request.');
    assert.equal(requests[0].mediation,'silent');
  }
});

test('invalid or stale identifiers do not open the password manager', async () => {
  const {manager,calls,requests} = fixture(() => saved());
  assert.equal(await manager.trySignIn(''),false);
  assert.equal(await manager.trySignIn('participant',{isCurrent:() => false}),false);
  assert.deepEqual(calls,[]); assert.deepEqual(requests,[]);
});

test('cancellation aborts promptly and ignores a late silent result', async () => {
  let release;
  const {manager,calls,requests} = fixture(() => new Promise(resolve => { release = resolve; }));
  const result = manager.trySignIn('participant');
  manager.cancel();
  assert.equal(await result,false); assert.equal(requests[0].signal.aborted,true);
  release(saved()); await Promise.resolve(); assert.deepEqual(calls,[]);
});

test('changed view or account fences the silent result before password use', async () => {
  let release, current = true, passwordReads = 0;
  const {manager,calls} = fixture(() => new Promise(resolve => { release = resolve; }));
  const result = manager.trySignIn('participant',{isCurrent:() => current});
  current = false;
  release({type:'password',id:'participant',get password() { passwordReads++; return 'synthetic-only-password'; }});
  assert.equal(await result,false); assert.equal(passwordReads,0); assert.deepEqual(calls,[]);
});

test('a newer attempt invalidates the preceding silent request', async () => {
  let firstRelease, count = 0;
  const {manager,calls} = fixture(() => ++count === 1 ? new Promise(resolve => { firstRelease = resolve; }) : saved());
  const first = manager.trySignIn('participant'), second = manager.trySignIn('participant');
  assert.equal(await first,false); assert.equal(await second,true);
  firstRelease(saved()); await Promise.resolve(); assert.equal(calls.length,1);
});

test('authentication failures propagate without retaining a credential or auto-retrying', async () => {
  const requests = [], expected = new Error('Synthetic generic sign-in refusal');
  const manager = createPasswordManagerSignIn({normalizeIdentifier,
    scope:{isSecureContext:true,PasswordCredential:class {},navigator:{credentials:{get(options) { requests.push(options); return saved(); }}}},
    signIn:async () => { throw expected; }});
  await assert.rejects(manager.trySignIn('participant'),error => error === expected);
  assert.equal(requests.length,1); manager.cancel();
});
