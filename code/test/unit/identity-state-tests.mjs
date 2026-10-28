// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdentityState,identityBinding,identityPrerequisites,sameIdentityBinding,transitionIdentityState as transition}
  from '../../../web/apps/non-verba/src/identity-state.js';

assert.equal(process.env.NONVERBA_CONTAINER,'1','Use the managed container launcher.');
const context = (overrides = {}) => ({account_id:'account-a',principal_id:'principal-a',recovery_generation:0,
  current_session_id:'session-a',confirmed:true,session_active:true,identity_verification:'pending',
  session:{session_id:'session-a'},...overrides});
const receipt = (overrides = {}) => ({submission_id:'submission-a',operation_id:'identity:'+'a'.repeat(43),status:'received',
  identity_verification:'pending',level:1,created_at:1792742400,...overrides});
const signedIn = value => transition(createIdentityState(),{type:'account',context:value || context()});
function latest(state, result) {
  state = transition(state,{type:'begin'});
  return transition(state,{type:'resolved',request:state.request,receipt:result});
}
function locked(state) {
  const prerequisites = identityPrerequisites(state);
  assert.equal(prerequisites.requests.allowed,false);
  assert.equal(prerequisites.operations.allowed,false);
  return prerequisites;
}

test('generic pending contact context, roles, device proof and capture claims never mean a saved identity submission', () => {
  assert.equal(createIdentityState().status,'signed_out'); locked(createIdentityState());
  const authenticated = signedIn(context({roles:['R','O'],device_status:'approved',identity_verified:true}));
  assert.equal(authenticated.status,'checking'); assert.equal(authenticated.receipt,null); locked(authenticated);
  for (const type of ['draft','reviewed','submitted','verified','level_one_approved','level_two_approved']) {
    assert.equal(transition(authenticated,{type,receipt:receipt()}),authenticated);
  }
  const none = latest(authenticated,null);
  assert.equal(none.status,'unverified'); assert.equal(locked(none).requests.pendingLevel,null);
});

test('an exact authenticated Level 1 pending receipt shows waiting, with Level 2 still awaiting its prerequisite', () => {
  const waiting = latest(signedIn(),receipt());
  assert.equal(waiting.status,'awaiting_approval');
  const prerequisites = locked(waiting);
  assert.deepEqual([prerequisites.requests.status,prerequisites.requests.requiredLevel,prerequisites.requests.pendingLevel],
    ['awaiting_approval',1,1]);
  assert.deepEqual([prerequisites.operations.status,prerequisites.operations.requiredLevel,prerequisites.operations.pendingLevel],
    ['awaiting_prerequisite',2,1]);
  assert.match(prerequisites.operations.reason,/Level 1 identity before Level 2 identity/);
  assert.equal(transition(waiting,{type:'account',context:context()}),waiting,'Unrelated same-session context refresh retains the receipt.');
});

test('status restores through a fresh authenticated read after logout, reload and a new login session', () => {
  let state = latest(signedIn(),receipt());
  state = transition(state,{type:'signed_out'});
  assert.equal(state.binding,null); assert.equal(state.receipt,null); locked(state);
  const fresh = context({current_session_id:'session-new',session:{session_id:'session-new'}});
  state = transition(createIdentityState(),{type:'account',context:fresh});
  assert.equal(state.status,'checking'); assert.equal(state.receipt,null);
  state = latest(state,receipt());
  assert.equal(state.status,'awaiting_approval');
  assert.equal(state.binding.current_session_id,'session-new'); locked(state);
});

test('published opaque custody operation identifiers remain exact without imposing this client generator format', () => {
  const stored=receipt({operation_id:'other-client:synthetic-operation'}), state=latest(signedIn(),stored);
  assert.equal(state.status,'awaiting_approval');assert.equal(state.receipt.operation_id,stored.operation_id);locked(state);
});

test('foreign accounts, changed principals, session changes and recovery rotations fence delayed observations', () => {
  let pending = transition(signedIn(),{type:'begin'});
  const request = structuredClone(pending.request), oldBinding = identityBinding(context());
  for (const changed of [context({account_id:'account-b'}),context({principal_id:'principal-b'}),
    context({recovery_generation:1}),context({current_session_id:'session-b',session:{session_id:'session-b'}})]) {
    const current = transition(pending,{type:'account',context:changed});
    assert.equal(current.status,'checking'); assert.equal(current.receipt,null);
    assert.equal(transition(current,{type:'resolved',request,receipt:receipt()}),current);
    assert.equal(transition(current,{type:'received',binding:oldBinding,receipt:receipt()}),current);
    locked(current);
  }
});

test('out-of-order status reads and old missing results cannot overwrite a later read or direct storage receipt', () => {
  let state = transition(signedIn(),{type:'begin'}), first = state.request;
  state = transition(state,{type:'begin'}); const second = state.request;
  assert.equal(transition(state,{type:'resolved',request:first,receipt:null}),state);
  state = transition(state,{type:'resolved',request:second,receipt:receipt()});
  assert.equal(transition(state,{type:'failed',request:first}),state);
  assert.equal(state.status,'awaiting_approval');
  state = transition(state,{type:'begin'}); const olderRead = state.request;
  state = transition(state,{type:'received',binding:identityBinding(context()),receipt:receipt({submission_id:'submission-b'})});
  assert.equal(state.receipt.submission_id,'submission-b');
  assert.equal(transition(state,{type:'resolved',request:olderRead,receipt:null}),state); locked(state);
});

test('failed status reads and lost or revoked account context clear waiting and require fresh proof', () => {
  let state = transition(latest(signedIn(),receipt()),{type:'begin'});
  assert.equal(state.status,'checking'); assert.equal(state.receipt,null);
  state = transition(state,{type:'failed',request:state.request});
  assert.equal(state.status,'unknown'); assert.equal(state.receipt,null); locked(state);
  state = latest(state,receipt()); assert.equal(state.status,'awaiting_approval');
  for (const invalid of [context({confirmed:false}),context({session_active:false}),
    context({session:{session_id:'different'}}),context({recovery_generation:-1}),context({identity_verification:'verified'})]) {
    const unknown = transition(state,{type:'account',context:invalid});
    assert.equal(unknown.status,'unknown'); assert.equal(unknown.binding,null); assert.equal(unknown.receipt,null); locked(unknown);
  }
  const unknown = transition(state,{type:'unknown'});
  assert.equal(transition(unknown,{type:'received',binding:identityBinding(context()),receipt:receipt()}),unknown);
});

test('unsupported approvals, Level 2, partial receipts and unknown summary data remain unknown rather than verified', () => {
  for (const invalid of [undefined,{},receipt({level:2}),receipt({status:'approved'}),receipt({identity_verification:'verified'}),
    receipt({created_at:-1}),receipt({level_one_verified:true}),receipt({submission_id:'not an identifier'}),
    ...['','a'.repeat(129),'identity:'+'+'.repeat(43),
      'another/'+'a'.repeat(43),17].map(operation_id=>receipt({operation_id}))]) {
    const unknown = latest(signedIn(),invalid);
    assert.equal(unknown.status,'unknown'); assert.equal(unknown.receipt,null); locked(unknown);
    const direct = transition(signedIn(),{type:'received',binding:identityBinding(context()),receipt:invalid});
    assert.equal(direct.status,'unknown'); assert.equal(direct.receipt,null); locked(direct);
  }
});

test('binding and receipt observations are immutable copies without personal fields or credentials', () => {
  const account = context({email:'private@example.invalid',access_token:'secret',roles:['R','O']});
  const inputReceipt = receipt();
  let state = signedIn(account);
  state = transition(state,{type:'received',binding:identityBinding(account),receipt:inputReceipt});
  account.account_id = 'changed'; inputReceipt.submission_id = 'changed';
  assert.equal(state.binding.account_id,'account-a'); assert.equal(state.receipt.submission_id,'submission-a');
  assert.equal(sameIdentityBinding(state.binding,identityBinding(context())),true);
  assert.deepEqual(Object.keys(state.binding),['account_id','principal_id','recovery_generation','current_session_id']);
  assert.doesNotMatch(JSON.stringify(state),/private@example|secret|access_token/);
  assert.ok(Object.isFrozen(state) && Object.isFrozen(state.binding) && Object.isFrozen(state.receipt));
});
