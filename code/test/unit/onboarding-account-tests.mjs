// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServiceAccountAdapter, loginIdentifier, passwordStrength} from '../../../web/apps/non-verba/src/onboarding-account.js';
import {ACCOUNT_TERMS_CONTENT_JSON,ACCOUNT_TERMS_CONTENT_SHA256} from '../../../web/apps/non-verba/src/account-terms.js';
import {IDENTITY_INTAKE_NOTICE,IDENTITY_INTAKE_NOTICE_TEXT,IDENTITY_INTAKE_NOTICE_SHA256} from '../../../web/apps/non-verba/src/identity-intake-notice.js';
import {recoveryCodesText,createRecoveryExport} from '../../../web/apps/non-verba/src/recovery-export.js';
import {createAccountTransport} from '../../../web/apps/non-verba/src/account-transport.js';

const issuer = 'http://127.0.0.1:8080/dev-oidc', client = 'nonverba-dev-apk';
const redirect = 'http://127.0.0.1:8080/dev-callback', email = 'participant@example.invalid';
const password = 'moss7!Q2', confirmation = Buffer.alloc(32, 1).toString('base64url');
const entryConfirmation = 'A1B2C3D4';
const reply = (value, status = 200, headers = {}) => ({status, headers, body: typeof value === 'string' ? value : JSON.stringify(value)});
const rejection = (operation, code) => assert.rejects(operation, error => error instanceof Error && error.code === code);
const tick = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(predicate) { for (let attempt = 0; attempt < 2000; attempt++) { if (predicate()) return; await tick(); } assert.fail('Synthetic request gate was not reached.'); }
function gate() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return {promise, resolve}; }
const ACCOUNT_TERMS = JSON.parse(ACCOUNT_TERMS_CONTENT_JSON);
const termsReceipt = {...ACCOUNT_TERMS,content_sha256:ACCOUNT_TERMS_CONTENT_SHA256};
const acceptedTerms = Object.fromEntries(['id','version','content_sha256'].map(key=>[key,termsReceipt[key]]));
const metadata = {email,password,username:'synthetic_participant',roles:['R','O'],terms:acceptedTerms,deliberate:true};
function recoveryBatch(values) {
  assert.ok(Array.isArray(values) && values.length===8 && new Set(values).size===8,'Exactly eight independent recovery codes are required.');
  for (const value of values) {
    assert.match(value,/^[A-Za-z0-9_-]{43}$/); const bytes=Buffer.from(value,'base64url');
    assert.equal(bytes.length,32); assert.equal(bytes.toString('base64url'),value);
  }
  return [...values];
}
const exportCodes = () => Array.from({length:8},(_,index)=>Buffer.alloc(32,index+1).toString('base64url'));
const identityNoticeText = IDENTITY_INTAKE_NOTICE_TEXT;
const identityNoticeFixture = (overrides = {}) => ({notice_id:'identity-intake',version:IDENTITY_INTAKE_NOTICE.version,
  sha256:createHash('sha256').update(identityNoticeText).digest('hex'),text:identityNoticeText,
  available:true,level:1,max_image_bytes:2097152,media_type:'image/jpeg',...overrides});
const identityBody = (current,notice) => ({operation_id:'identity:'+Buffer.alloc(32,19).toString('base64url'),level:1,
  expected:{account_id:current.account_id,principal_id:current.principal_id,session_id:current.current_session_id,recovery_generation:current.recovery_generation},
  details:{document_type:'passport',full_name:'Synthetic Person',birth_city:'Test City',nationality:'Test Nationality',age:30},
  document_front:{media_type:'image/jpeg',base64:'c3ludGhldGlj'},face_front:{media_type:'image/jpeg',base64:'c3ludGhldGlj'},
  notice:{notice_id:notice.notice_id,version:notice.version,sha256:notice.sha256,acknowledged:true}});
const pendingIdentityReceipt = (operationId = 'identity:'+Buffer.alloc(32,19).toString('base64url')) => ({
  submission_id:'identity:test',operation_id:operationId,status:'received',identity_verification:'pending',level:1,created_at:1});
const identityStatusFixture = (owner, receipt = null) => ({account_id:owner.account_id,principal_id:owner.principal_id,
  recovery_generation:owner.recovery_generation,current_session_id:owner.current_session_id,
  level_1:{status:receipt ? 'received' : 'not_submitted',receipt}});
function assertIdentityPrerequisites(snapshot, status) {
  assert.equal(snapshot.identity_status.status,status);
  assert.equal(snapshot.identity_verification,'pending','Submission state never awards verification.');
  assert.equal(snapshot.identity_status.prerequisites.requests.allowed,false);
  assert.equal(snapshot.identity_status.prerequisites.operations.allowed,false);
  assert.equal(snapshot.identity_status.submitted_level,status === 'awaiting_approval' ? 1 : null);
}

test('identity status reads authenticated owner-bound submission state rather than interpreting generic pending as received', async () => {
  const f = await fixture(), adapter = createServiceAccountAdapter({request:f.request});
  assertIdentityPrerequisites(adapter.snapshot(),'signed_out');
  await adapter.signIn({email,password});
  assertIdentityPrerequisites(adapter.snapshot(),'unverified');
  const current = await adapter.getAccount();
  assert.equal(current.identity_verification,'pending');
  assertIdentityPrerequisites(adapter.snapshot(),'unverified');
  const reads = f.calls.filter(call=>call.path === '/v1/account/identity/status');
  assert.ok(reads.length >= 1);
  for (const read of reads) {
    assert.equal(read.method,'GET'); assert.ok(read.headers.authorization.startsWith('Bearer '));
    assert.equal(read.body,undefined);
    assert.equal(f.calls[f.calls.indexOf(read)-1].path,'/v1/account/context');
  }
});

test('fresh authenticated identity status restores saved submission while logout discards its presentation authority', async () => {
  const received = pendingIdentityReceipt();
  const f = await fixture({identityStatus:(_value,{context})=>identityStatusFixture(context,received)});
  const adapter = createServiceAccountAdapter({request:f.request});
  await adapter.signIn({email,password}); assertIdentityPrerequisites(adapter.snapshot(),'awaiting_approval');
  assert.equal(adapter.snapshot().identity_status.prerequisites.requests.status,'awaiting_approval');
  assert.equal(adapter.snapshot().identity_status.prerequisites.operations.status,'awaiting_prerequisite');
  await adapter.signOut(); assertIdentityPrerequisites(adapter.snapshot(),'signed_out');
  const fresh = createServiceAccountAdapter({request:f.request});
  assertIdentityPrerequisites(fresh.snapshot(),'signed_out');
  await fresh.signIn({email,password}); assertIdentityPrerequisites(fresh.snapshot(),'awaiting_approval');
  const text = JSON.stringify(fresh.snapshot());
  for (const privateValue of ['identity:test',received.operation_id,'access-token-','Synthetic Person']) assert.equal(text.includes(privateValue),false);
});

test('unavailable, malformed and mismatched identity status cannot create awaiting or approved authority', async () => {
  const received = pendingIdentityReceipt();
  const mutations = [
    value=>({...value,extra:true}), value=>({...value,account_id:'account:other'}),
    value=>({...value,principal_id:'principal:other'}), value=>({...value,recovery_generation:1}),
    value=>({...value,current_session_id:'session:other'}), value=>({...value,level_1:{status:'received',receipt:null}}),
    value=>({...value,level_1:{status:'not_submitted',receipt:received}}),
    value=>({...value,level_1:{status:'received',receipt:{...received,identity_verification:'verified'}}}),
    value=>({...value,level_1:{status:'received',receipt:{...received,level:2}}}),
    value=>({...value,level_1:{status:'received',receipt:{...received,full_name:'Synthetic Person'}}}),
    value=>({...value,level_1:{status:'received',receipt:{...received,operation_id:'invalid/operation'}}}),
    value=>({...value,level_1:{status:'approved',receipt:received}}),
    () => { throw new Error('Synthetic unavailable status'); }
  ];
  for (const identityStatus of mutations) {
    const f = await fixture({identityStatus}), adapter = createServiceAccountAdapter({request:f.request});
    await adapter.signIn({email,password});
    assert.equal(adapter.snapshot().state,'signed_in'); assertIdentityPrerequisites(adapter.snapshot(),'unknown');
  }
});

test('authenticated custody accepts the published opaque operation identifier without inferring client generator format', async () => {
  const received=pendingIdentityReceipt('other-client:synthetic-operation');
  const f=await fixture({identityStatus:(_value,{context})=>identityStatusFixture(context,received)});
  const adapter=createServiceAccountAdapter({request:f.request});await adapter.signIn({email,password});
  assertIdentityPrerequisites(adapter.snapshot(),'awaiting_approval');
  assert.equal(adapter.snapshot().genuine_authentication,false);
});

test('an authenticated identity-status denial clears signed-in state and every pending prerequisite', async () => {
  let denied = false;
  const f = await fixture({identityStatus:(_value,{context})=>identityStatusFixture(context,pendingIdentityReceipt()),
    intercept:input=>denied && input.path === '/v1/account/identity/status' ? reply({error:'invalid_authorization'},401) : null});
  const adapter = createServiceAccountAdapter({request:f.request}); await adapter.signIn({email,password});
  assertIdentityPrerequisites(adapter.snapshot(),'awaiting_approval'); denied = true;
  await rejection(adapter.getAccount(),'invalid_authorization');
  assert.equal(adapter.snapshot().state,'signed_out'); assertIdentityPrerequisites(adapter.snapshot(),'signed_out');
});

test('direct identity POST and original-operation receipt update awaiting state without approval or form echoes', async () => {
  const f = await fixture({intercept:(input,{body})=> {
    if (input.path === '/v1/account/identity/notice') return reply(identityNoticeFixture());
    if (input.path === '/v1/account/identity/submissions') return reply(pendingIdentityReceipt(body.operation_id));
    if (input.path.startsWith('/v1/account/identity/operations/')) return reply(pendingIdentityReceipt(input.path.split('/').at(-1)));
  }});
  const adapter = createServiceAccountAdapter({request:f.request}); await adapter.signIn({email,password});
  const notice = await adapter.getIdentityNotice(), current = await adapter.getAccount(), body = identityBody(current,notice);
  await adapter.submitIdentity(body); assertIdentityPrerequisites(adapter.snapshot(),'awaiting_approval');
  await adapter.getAccount(); assertIdentityPrerequisites(adapter.snapshot(),'unverified');
  await adapter.identitySubmissionStatus(body.operation_id); assertIdentityPrerequisites(adapter.snapshot(),'awaiting_approval');
  assert.equal(JSON.stringify(adapter.snapshot()).includes('Synthetic Person'),false);
});

test('a delayed not-submitted status cannot overwrite a newer accepted identity POST receipt', async () => {
  const held = gate(); let holdNext = false, entered = false;
  const f = await fixture({identityStatus:async value=> {
    if (holdNext) { holdNext = false; entered = true; await held.promise; } return value;
  },intercept:(input,{body})=> {
    if (input.path === '/v1/account/identity/notice') return reply(identityNoticeFixture());
    if (input.path === '/v1/account/identity/submissions') return reply(pendingIdentityReceipt(body.operation_id));
  }});
  const adapter = createServiceAccountAdapter({request:f.request}); await adapter.signIn({email,password});
  const notice = await adapter.getIdentityNotice(), current = await adapter.getAccount();
  holdNext = true; const olderRead = adapter.getAccount(); await waitFor(()=>entered);
  await adapter.submitIdentity(identityBody(current,notice)); assertIdentityPrerequisites(adapter.snapshot(),'awaiting_approval');
  held.resolve(); await olderRead; assertIdentityPrerequisites(adapter.snapshot(),'awaiting_approval');
});

test('a late saved-status response cannot restore presentation after a new account, recovery generation or session', async () => {
  for (const replacement of [{account_id:'account:replacement',principal_id:'principal:replacement'},
    {recovery_generation:1},{current_session_id:'session:replacement'}]) {
    const held = gate(); let holdNext = false, entered = false, saved = true;
    const binding = {account_id:'account:test',principal_id:'principal:test',recovery_generation:0,current_session_id:'session:test'};
    const f = await fixture({claims:{get sub(){return binding.principal_id;},get sid(){return binding.current_session_id;}},
      context:value=>({...value,...binding,identity:{...value.identity,subject:binding.principal_id},
        session:{...value.session,session_id:binding.current_session_id}}),
      identityStatus:async (_value,{context})=> {
        const response = identityStatusFixture(context,saved ? pendingIdentityReceipt() : null);
        if (holdNext) { holdNext = false; entered = true; await held.promise; } return response;
      }});
    const adapter = createServiceAccountAdapter({request:f.request}); await adapter.signIn({email,password});
    assertIdentityPrerequisites(adapter.snapshot(),'awaiting_approval');
    holdNext = true; const pending = adapter.getAccount(), refused = rejection(pending,'stale_operation'); await waitFor(()=>entered);
    adapter.discardSession(); Object.assign(binding,replacement); saved = false;
    await adapter.signIn({email,password}); assertIdentityPrerequisites(adapter.snapshot(),'unverified');
    held.resolve(); await refused; assertIdentityPrerequisites(adapter.snapshot(),'unverified');
  }
});

test('a superseded generation status read cannot demote a newer authenticated context and saved receipt', async () => {
  const held = gate(); let generation = 0, holdNext = false, entered = false;
  const f = await fixture({context:value=>({...value,recovery_generation:generation}),
    identityStatus:async (_value,{context})=> {
      const response = identityStatusFixture(context,context.recovery_generation === 1 ? pendingIdentityReceipt() : null);
      if (holdNext) { holdNext = false; entered = true; await held.promise; } return response;
    }});
  const adapter = createServiceAccountAdapter({request:f.request}); await adapter.signIn({email,password});
  holdNext = true; const older = adapter.getAccount();
  const refused = assert.rejects(older,error=>['stale_operation','account_changed'].includes(error.code));
  await waitFor(()=>entered); generation = 1;
  await adapter.getAccount(); assertIdentityPrerequisites(adapter.snapshot(),'awaiting_approval');
  held.resolve(); await refused;
  assert.equal(adapter.snapshot().state,'signed_in'); assert.equal(adapter.snapshot().recovery_generation,1);
  assertIdentityPrerequisites(adapter.snapshot(),'awaiting_approval');
});

test('cancelled status reads leave checking promptly without clearing a newer received revision', async () => {
  for (const cancellation of ['abort','entry_reset']) for (const newerReceipt of [false,true]) {
    const held = gate(), controller = new AbortController(), changes = [];
    let holdNext = false, entered = false;
    const f = await fixture({identityStatus:async value=> {
      if (holdNext) { holdNext = false; entered = true; await held.promise; } return value;
    },intercept:(input,{body})=> {
      if (input.path === '/v1/account/identity/notice') return reply(identityNoticeFixture());
      if (input.path === '/v1/account/identity/submissions') return reply(pendingIdentityReceipt(body.operation_id));
    }});
    const adapter = createServiceAccountAdapter({request:f.request,onChange:value=>changes.push(value)});
    await adapter.signIn({email,password});
    const notice = await adapter.getIdentityNotice(), owner = await adapter.getAccount();
    holdNext = true;
    const pending = adapter.getAccount({signal:controller.signal});
    const refused = rejection(pending,cancellation === 'abort' ? 'operation_aborted' : 'stale_operation');
    await waitFor(()=>entered); assertIdentityPrerequisites(adapter.snapshot(),'checking');
    if (newerReceipt) {
      await adapter.submitIdentity(identityBody(owner,notice)); assertIdentityPrerequisites(adapter.snapshot(),'awaiting_approval');
    }
    if (cancellation === 'abort') controller.abort(); else adapter.resetEntry();
    held.resolve(); await refused;
    assert.equal(adapter.snapshot().state,'signed_in');
    const expected = newerReceipt ? 'awaiting_approval' : 'unknown';
    assertIdentityPrerequisites(adapter.snapshot(),expected);
    // The cancellation outcome must reach subscribers as well as snapshot().
    assertIdentityPrerequisites(changes.at(-1),expected);
  }
});

test('identity intake verifies exact notice bytes and fails closed on unavailable or altered notices',async () => {
  assert.equal(createHash('sha256').update(identityNoticeText).digest('hex'),IDENTITY_INTAKE_NOTICE_SHA256);
  const otherText = identityNoticeText+'\n';
  for (const fields of [{sha256:'a'.repeat(64)},{version:IDENTITY_INTAKE_NOTICE.version+1},{media_type:'image/png'},{max_image_bytes:9999},
    {text:otherText,sha256:createHash('sha256').update(otherText).digest('hex')}]) {
    const f = await fixture({intercept:input=>input.path === '/v1/account/identity/notice' ? reply(identityNoticeFixture(fields)) : null});
    const adapter = createServiceAccountAdapter({request:f.request});await adapter.signIn({email,password});
    await assert.rejects(adapter.getIdentityNotice());
  }
  const f = await fixture({intercept:input=>input.path === '/v1/account/identity/notice' ? reply(identityNoticeFixture({available:false})) : null});
  const adapter = createServiceAccountAdapter({request:f.request});await adapter.signIn({email,password});
  const notice = await adapter.getIdentityNotice(), current = await adapter.getAccount();
  assert.equal(notice.available,false);
  await rejection(adapter.submitIdentity(identityBody(current,notice)),'identity_notice_required');
  assert.equal(f.calls.filter(call=>call.path === '/v1/account/identity/submissions').length,0);
});

test('a closed Level 1 intake refusal is definite and does not become an unknown outcome', async () => {
  const f = await fixture({intercept:input => input.path === '/v1/account/identity/capture-challenges' || input.path === '/v1/account/identity/submissions'
    ? reply({error:input.path.endsWith('/submissions') ? 'identity_intake_busy' : 'identity_intake_unavailable'},503)
    : input.path === '/v1/account/identity/notice' ? reply(identityNoticeFixture()) : null});
  const adapter = createServiceAccountAdapter({request:f.request});
  await adapter.signIn({email,password});
  const current = await adapter.getAccount();
  const challenge = {expected:{account_id:current.account_id,principal_id:current.principal_id,session_id:current.current_session_id,recovery_generation:current.recovery_generation},
    kind:'document_front',source:'browser-camera',public_spki_der_b64:'AAAA'};
  await assert.rejects(adapter.issueIdentityCaptureChallenge(challenge), error => error.code === 'identity_intake_unavailable'
    && error.message === 'Level 1 identity is not open for this account.');
  assert.equal(adapter.snapshot().state,'signed_in');
  const notice = await adapter.getIdentityNotice();
  await assert.rejects(adapter.submitIdentity(identityBody(current,notice)), error => error.code === 'identity_intake_busy'
    && error.definitely_not_submitted === true && error.message === 'Photo intake is busy. Wait a moment and try again.');
  assert.equal(adapter.snapshot().state,'signed_in');
  assert.equal(adapter.snapshot().identity_verification,'pending');
});

test('identity intake binds writes to the current owner and only accepts a pending receipt without sensitive echoes',async () => {
  let invalid = false;
  const f = await fixture({intercept:(input,{body})=> {
    if (input.path === '/v1/account/identity/notice') return reply(identityNoticeFixture());
    if (input.path === '/v1/account/identity/submissions') return reply({submission_id:'identity:test',operation_id:body.operation_id,
      status:'received',identity_verification:invalid ? 'verified' : 'pending',level:1,created_at:1});
    if (input.path.startsWith('/v1/account/identity/operations/')) return reply({error:'identity_operation_not_found'},404);
  }});
  const adapter = createServiceAccountAdapter({request:f.request});await adapter.signIn({email,password});
  const notice = await adapter.getIdentityNotice(), current = await adapter.getAccount(), body = identityBody(current,notice);
  await rejection(adapter.submitIdentity({...body,expected:{...body.expected,recovery_generation:1}}),'account_changed');
  await rejection(adapter.submitIdentity({...body,notice:{...body.notice,sha256:'b'.repeat(64)}}),'identity_notice_required');
  assert.equal(f.calls.filter(call=>call.path === '/v1/account/identity/submissions').length,0);
  const received = await adapter.submitIdentity(body);assert.equal(received.identity_verification,'pending');
  assert.equal(adapter.snapshot().identity_verification,'pending');
  assert.equal(await adapter.identitySubmissionStatus(body.operation_id),null);
  invalid = true;await rejection(adapter.submitIdentity(body),'service_response_invalid');
  assert.ok(f.calls.filter(call=>call.path.includes('/v1/account/identity/')).every(call=>call.headers.authorization?.startsWith('Bearer ')));
  assert.ok(!JSON.stringify(adapter.snapshot()).includes('Synthetic Person'));
});

test('identity intake late receipts remain fenced after cancellation',async () => {
  const held = gate();let entered = false;
  const f = await fixture({intercept:async(input,{body})=> {
    if (input.path === '/v1/account/identity/notice') return reply(identityNoticeFixture());
    if (input.path === '/v1/account/identity/submissions') {
      entered = true;await held.promise;return reply({submission_id:'identity:test',operation_id:body.operation_id,
        status:'received',identity_verification:'pending',level:1,created_at:1});
    }
  }});
  const adapter = createServiceAccountAdapter({request:f.request});await adapter.signIn({email,password});
  const notice = await adapter.getIdentityNotice(), current = await adapter.getAccount();
  const pending = adapter.submitIdentity(identityBody(current,notice)), refused = rejection(pending,'stale_operation');
  await waitFor(()=>entered);adapter.cancel();held.resolve();await refused;
  assert.equal(adapter.snapshot().identity_verification,'pending');
});

test('leaving Account entry fences prior work but intake refreshes the exact notice under the unchanged owner',async () => {
  let reads = 0, writes = 0, available = true;
  const f = await fixture({intercept:(input,{body})=> {
    if (input.path === '/v1/account/identity/notice') { reads++;return reply(identityNoticeFixture({available})); }
    if (input.path === '/v1/account/identity/submissions') { writes++;return reply({submission_id:'identity:test',operation_id:body.operation_id,
      status:'received',identity_verification:'pending',level:1,created_at:1}); }
  }});
  const adapter = createServiceAccountAdapter({request:f.request});await adapter.signIn({email,password});
  const notice = await adapter.getIdentityNotice(), current = await adapter.getAccount(), body = identityBody(current,notice);
  adapter.resetEntry(); assert.equal(adapter.snapshot().state,'signed_in');
  const before = reads, result = await adapter.submitIdentity(body);
  assert.equal(reads,before+1);assert.equal(writes,1);assert.equal(result.identity_verification,'pending');
  available = false;
  await assert.rejects(adapter.submitIdentity(body),error=>error.code === 'identity_notice_required' && error.definitely_not_submitted === true);
  assert.equal(writes,1,'Changed availability is checked before any second write.');
});
function nativeExportFixture(t) {
  const sent=[], host=new EventTarget(), native={postMessage:text=>sent.push(JSON.parse(text))};
  Object.assign(host,{crypto,nonverbaRecoveryExport:native});
  const exporter=createRecoveryExport({host,document:{}}); t.after(()=>exporter.cancel());
  return {sent,host,exporter,reply(value){native.onmessage({data:typeof value==='string' ? value : JSON.stringify(value)});},
    raw(data){native.onmessage({data});}};
}

test('recovery text exports eight canonical independent codes in the exact two-column format', () => {
  const codes=recoveryBatch(exportCodes()), rows=Array.from({length:4},(_,index)=>codes[index*2]+'  '+codes[index*2+1]).join('\n');
  assert.equal(recoveryCodesText(codes),'Non-verba recovery codes\n\n'+rows
    +'\n\nKeep these codes private. Each code can be used once.\nA successful recovery replaces this set.\n');
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const alias=codes[0].slice(0,-1)+alphabet[alphabet.indexOf(codes[0].at(-1))+1];
  assert.deepEqual(Buffer.from(alias,'base64url'),Buffer.from(codes[0],'base64url'),'The refused alias decodes to the same bytes but has noncanonical trailing bits.');
  for (const invalid of [null,codes.slice(0,7),[...codes,codes[0]],[codes[0],codes[0],...codes.slice(2)],
    [alias,...codes.slice(1)],[codes[0]+'=',...codes.slice(1)],['x'.repeat(42),...codes.slice(1)]])
    assert.throws(()=>recoveryCodesText(invalid),/Recovery codes are unavailable/);
});

test('native recovery export accepts only correlated saved, cancelled and failed outcomes', async t => {
  const f=nativeExportFixture(t), codes=exportCodes();
  for (const status of ['saved','cancelled','failed']) {
    let settled=false;
    const pending=f.exporter.save(codes); pending.then(()=>{settled=true;},()=>{settled=true;});
    const request=f.sent.at(-1); assert.deepEqual(Object.keys(request).sort(),['content','id']);
    assert.equal(request.content,recoveryCodesText(codes));
    assert.match(request.id,/^[0-9a-f-]{36}$/);
    for (const invalid of [{id:crypto.randomUUID(),status:'saved'},{id:request.id,status:'started'},
      {id:request.id,status:'saved',extra:true},{id:request.id},null,[],false,'{"id":']) {
      f.reply(invalid); await tick(); assert.equal(settled,false,'Malformed or unrelated native replies do not settle an export.');
    }
    f.raw({id:request.id,status:'saved'}); f.raw('x'.repeat(257)); await tick(); assert.equal(settled,false);
    const expected=status==='failed' ? assert.rejects(pending,/Download could not start/) : null;
    f.reply({id:request.id,status});
    if (expected) await expected; else assert.equal(await pending,status);
  }
});

test('an APK without the recovery-export bridge refuses an unsupported Blob download', async t => {
  const touched=[], host=new EventTarget();
  Object.assign(host,{location:{origin:'https://appassets.androidplatform.net'},crypto,
    Blob:class {constructor(){touched.push('Blob');}},URL:{
      createObjectURL(){touched.push('createObjectURL');return 'blob:unsupported';},
      revokeObjectURL(){touched.push('revokeObjectURL');}}});
  const document={createElement(){touched.push('createElement');return {click(){touched.push('click');},remove(){}};},
    body:{append(){touched.push('append');}}};
  const exporter=createRecoveryExport({document,host}); t.after(()=>exporter.cancel());
  await assert.rejects(exporter.save(exportCodes()),/Download could not start/);
  assert.deepEqual(touched,[],'The missing APK bridge fails before creating a Blob, link or object URL.');
});

test('native export abort and cancellation send exact cancellation messages and fence late prior replies', async t => {
  const f=nativeExportFixture(t), codes=exportCodes(), aborted=new AbortController(); aborted.abort();
  assert.equal(await f.exporter.save(codes,{signal:aborted.signal}),'cancelled'); assert.equal(f.sent.length,0);
  const controller=new AbortController(), first=f.exporter.save(codes,{signal:controller.signal}), firstId=f.sent.at(-1).id;
  controller.abort(); assert.equal(await first,'cancelled'); assert.deepEqual(f.sent.at(-1),{id:firstId,cancel:true});
  const count=f.sent.length; controller.abort(); f.exporter.cancel(); assert.equal(f.sent.length,count);
  let settled=false;
  const second=f.exporter.save(codes); second.then(()=>{settled=true;},()=>{settled=true;});
  const secondId=f.sent.at(-1).id; assert.notEqual(secondId,firstId);
  await assert.rejects(f.exporter.save(codes),/Download could not start/);
  f.reply({id:firstId,status:'saved'}); await tick(); assert.equal(settled,false,'A late prior export cannot resolve the new request.');
  f.exporter.cancel(); assert.equal(await second,'cancelled'); assert.deepEqual(f.sent.at(-1),{id:secondId,cancel:true});
  const third=f.exporter.save(codes), thirdId=f.sent.at(-1).id;
  f.reply({id:secondId,status:'saved'}); f.reply({id:thirdId,status:'saved'}); assert.equal(await third,'saved');
  const leaving=f.exporter.save(codes), leavingId=f.sent.at(-1).id;
  f.host.dispatchEvent(new Event('pagehide')); assert.equal(await leaving,'cancelled'); assert.deepEqual(f.sent.at(-1),{id:leavingId,cancel:true});
});

async function reviewedCreate(adapter,f,input = metadata) {
  if (!['pending','unknown'].includes(adapter.snapshot().operation_state)) {
    f.nextEntry('enrollment'); await adapter.startEntry({email:input.email}); await adapter.confirmEntry({code:entryConfirmation});
  }
  return adapter.create(input);
}

async function signinDeviceFixture({badChallenge = false, failProof = false, forgedVerdict = false} = {}) {
  const pair = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
  const spki = Buffer.from(await crypto.subtle.exportKey('spki',pair.publicKey));
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256',spki)).toString('hex');
  let challenge, proved = false;
  const attestation = {status:forgedVerdict ? 'verified' : 'unverified',reason:'browser_not_attested',state_scope:'at-key-generation'};
  const f = await fixture({intercept:async (input,{body}) => {
    if (!input.path.startsWith('/v1/account/signin-devices') && input.path !== '/v1/account/sessions/revoke') return;
    assert.match(input.headers.authorization,/^Bearer access-token-/);
    const time = Math.floor(Date.now()/1000);
    if (input.path.endsWith('/challenge')) {
      assert.deepEqual(Object.keys(body).sort(),['name','operation_id','platform']);
      challenge = {challenge_id:'challenge:test',account_id:badChallenge ? 'other:account' : 'account:test',
        current_session_id:'session:test',recovery_generation:0,platform:'browser',issued_at:time,expires_at:time+120,
        challenge_b64:Buffer.alloc(32,19).toString('base64')}; return reply(challenge);
    }
    if (input.path.endsWith('/prove')) {
      assert.deepEqual(Object.keys(body).sort(),['attestation_chain','challenge_id','public_spki_der_b64','signature_b64']);
      assert.equal(body.attestation_chain,null); proved = true;
      if (failProof) return reply({error:'device_refused'},403);
      return reply({account_id:'account:test',current_session_id:'session:test',device_id:'device:test',platform:'browser',
        name:'Browser session',key_spki_sha256:hash,possession_proven:true,attestation});
    }
    if (input.path.endsWith('/revoke')) return reply({account_id:'account:test',session_id:body.session_id,
      kind:'session_revoke',status:'revoked',revoked_at:time});
    return reply({account_id:'account:test',current_session_id:'session:test',limit:256,has_more:false,
      unregistered_sessions:[],unregistered_sessions_has_more:false,devices:[{device_id:'device:test',platform:'browser',name:'Browser session',
        key_spki_sha256:hash,first_seen:time,last_seen:time,current:true,active_sessions:1,attestation,
        sessions:[{session_id:'session:test',created_at:time,expires_at:time+3600,last_seen:time,current:true}],sessions_has_more:false}]});
  }});
  const device = {platform:'browser',name:'Browser session',async prove(value) {
    assert.deepEqual(value,challenge); assert.notEqual(value,challenge);
    const signature = await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(JSON.stringify(value)));
    return {public_spki_der_b64:spki.toString('base64'),signature_b64:Buffer.from(signature).toString('base64'),attestation_chain:null};
  }};
  return {...f,device,get proved(){return proved;}};
}

test('sign-in registers a separate device, validates owner inventory and revokes the current session', async () => {
  const f = await signinDeviceFixture(), adapter = createServiceAccountAdapter({request:f.request,device:f.device});
  await adapter.signIn({email,password}); assert.equal(f.proved,true); assert.equal(adapter.snapshot().device_status,'unverified');
  const context = await adapter.getAccount(); assert.equal(context.session.device_bound,false);
  const devices = await adapter.devices(); assert.equal(devices.devices[0].sessions[0].current,true);
  const text = JSON.stringify(adapter.snapshot()); assert.equal(text.includes('device:test'),false); assert.equal(text.includes('access-token'),false);
  assert.deepEqual(await adapter.revokeSession('session:test'),{ok:true,current:true}); assert.equal(adapter.snapshot().state,'signed_out');
});

test('wrong-account challenges and refused device proof never become trusted attestation', async () => {
  for (const options of [{badChallenge:true},{failProof:true}]) {
    const f = await signinDeviceFixture(options), adapter = createServiceAccountAdapter({request:f.request,device:f.device});
    await adapter.signIn({email,password}); assert.equal(adapter.snapshot().device_status,'unavailable');
    assert.equal(adapter.snapshot().state,'signed_in'); assert.equal(f.proved,!options.badChallenge);
  }
});

test('cancelling during native proof cannot restore a sign-in or submit a stale proof', async () => {
  const f = await signinDeviceFixture(), held = gate(); let entered = false, signal;
  const adapter = createServiceAccountAdapter({request:f.request,device:{...f.device,async prove(_value,options){
    entered = true; signal = options.signal; await held.promise; return f.device.prove(_value);
  }}});
  const pending = adapter.signIn({email,password}), refused = rejection(pending,'stale_operation');
  await waitFor(()=>entered); adapter.cancel(); assert.equal(signal.aborted,true); held.resolve(); await refused;
  assert.equal(f.proved,false); assert.equal(adapter.snapshot().state,'signed_out');
});

test('browser hardware claims are rejected in both proof receipts and inventory', async () => {
  const f = await signinDeviceFixture({forgedVerdict:true}), adapter = createServiceAccountAdapter({request:f.request,device:f.device});
  await adapter.signIn({email,password}); assert.equal(adapter.snapshot().device_status,'unavailable');
  await rejection(adapter.devices(),'service_response_invalid');
});

test('a concurrent authority denial fences a delayed successful device receipt', async () => {
  const f = await signinDeviceFixture(), held = gate(); let entered = false, denied = false;
  const adapter = createServiceAccountAdapter({device:f.device,request:async input=>{
    if (denied && (input.path === '/v1/account/context' || input.path === '/dev-oidc/token')) return reply({error:'invalid_authorization'},401);
    const value = await f.request(input);
    if (input.path.endsWith('/signin-devices/prove')) {entered = true; await held.promise;}
    return value;
  }});
  const pending = adapter.signIn({email,password}), refused = rejection(pending,'account_changed');
  await waitFor(()=>entered); denied = true; await rejection(adapter.getAccount(),'invalid_authorization');
  held.resolve(); await refused; assert.equal(adapter.snapshot().state,'signed_out');
  assert.equal(adapter.snapshot().device_status,'unregistered');
});

async function fixture(options = {}) {
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const jwk = {...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'test-key', alg: 'ES256', use: 'sig'};
  const prefix = 2 + (Buffer.from(jwk.y,'base64url').at(-1) & 1), materials = [];
  for (const sign of [prefix,prefix ^ 1]) {
    const bytes = Buffer.concat([Buffer.from([sign]),Buffer.from(jwk.x,'base64url')]);
    materials.push({public_key_sec1_b64:bytes.toString('base64url'),fingerprint_sha256:Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex')});
  }
  const calls = [], flows = new Map(), operations = new Map(), access = new Set();
  let serial = 0, generation = 0, storedPassword = options.password ?? password, refreshCalls = 0, contextCalls = 0;
  let shortAccess = options.shortAccess ?? false, currentSession = 'session:test', accountDeleted = false, accountVersion = 0;
  let nextEntryStep = null;
  let availableRecoveryCodes = new Set([confirmation]);
  const deletions = new Map();
  const accountReceipt = () => ({account_id: accountVersion ? `account:test-${accountVersion}` : 'account:test',
    principal_id:accountVersion ? `principal:test-${accountVersion}` : 'principal:test', login_name: 'login:test', roles: ['O', 'R'], confirmed: true, recovery_generation: generation});
  const accountContext = () => {
    const time = Math.floor(Date.now() / 1000);
    const value = {...accountReceipt(), email:options.email ?? email, ...(options.username ? {username:options.username} : {}), display_name: 'Synthetic participant', confirmed_at: time - 20,
      identity: {issuer, subject: accountReceipt().principal_id}, work_state: {state: 'clocked_out', revision: 0, updated_at: time - 20},
      current_session_id: currentSession, session_active: true,
      session: {session_id: currentSession, created_at: time - 10, expires_at: time + 86400,
        access_expires_at: time + (shortAccess ? 1 : 300), device_bound: false, device_id: null, key_id: null,
        role: null, public_key_sec1_b64: null, can_control_work: true},
      identity_assurance: 'local_synthetic_contact_confirmation', identity_verification: 'pending', development_only: true,
      scope: 'current local synthetic account; no identity verification or work grant'};
    return options.context ? options.context(value,{materials}) : value;
  };
  async function signedToken(flow) {
    const time = Math.floor(Date.now() / 1000);
    const claims = {iss: issuer, aud: client, sub: accountReceipt().principal_id, sid: currentSession,
      iat: time, exp: time + 300, jti: `jwt:${++serial}`, kind: 'id', nonce: flow.nonce, ...(options.claims ?? {})};
    const header = {alg: 'ES256', typ: 'JWT', kid: 'test-key', ...(options.header ?? {})};
    const message = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
    const signature = new Uint8Array(await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, pair.privateKey, new TextEncoder().encode(message)));
    if (options.badSignature) signature[0] ^= 1;
    return `${message}.${Buffer.from(signature).toString('base64url')}`;
  }
  async function request(input) {
    calls.push(input);
    const url = new URL(input.path, 'http://127.0.0.1:8080'), path = url.pathname;
    const form = input.headers?.['content-type'] === 'application/x-www-form-urlencoded' ? Object.fromEntries(new URLSearchParams(input.body)) : null;
    const body = input.body && !form ? JSON.parse(input.body) : null;
    if (options.intercept) { const result = await options.intercept(input, {body, form}); if (result) return result; }
    if (path.endsWith('/.well-known/openid-configuration')) return reply({issuer, authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, development_only: true,
      code_challenge_methods_supported: ['S256'], response_types_supported: ['code'], token_endpoint_auth_methods_supported: ['none'], ...(options.discovery ?? {})});
    if (path === '/v1/accounts/capabilities') return reply(options.capabilities ?? {email_delivery:'disabled',real_email_enabled:false,development_only:true});
    if (path === '/v1/accounts/terms') return reply({terms:ACCOUNT_TERMS,content_sha256:termsReceipt.content_sha256});
    if (path === '/readyz') return reply({status:'ready',database_select_1:true,object_store_tcp_reachable:true,
      object_store_authenticated_hash_read:true,migrations_current:true,scope:'Synthetic readiness fixture only'});
    if (path === '/v1/account/devices') {
      assert.ok(access.has(input.headers.authorization?.replace('Bearer ','')));
      const value = {account_id:accountReceipt().account_id,recovery_generation:generation,keys:[],requests:[],
        keys_has_more:false,requests_has_more:false,limit:256,development_only:true};
      return reply(options.inventory ? await options.inventory(value,{materials,now:Math.floor(Date.now()/1000)}) : value);
    }
    if (path === '/dev-oidc/jwks') return reply({keys: [jwk]});
    if (path === '/dev-oidc/authorize' && input.method === 'GET') {
      assert.equal(url.searchParams.get('client_id'), client); assert.equal(url.searchParams.get('redirect_uri'), redirect);
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      const flow = Object.fromEntries(url.searchParams); flow.authorization_id = Buffer.alloc(32, 2).toString('base64url'); flow.csrf = Buffer.alloc(32, 3).toString('base64url');
      flows.set(input.flow_id, flow);
      return reply(`<form><input type="hidden" name="authorization_id" value="${flow.authorization_id}"><input type="hidden" name="csrf" value="${flow.csrf}"></form>`);
    }
    if (path === '/dev-oidc/authorize') {
      const flow = flows.get(input.flow_id); assert.ok(flow);
      assert.equal(form.authorization_id, flow.authorization_id); assert.equal(form.csrf, flow.csrf);
      assert.equal(Object.hasOwn(form,'email') !== Object.hasOwn(form,'account_username'),true);
      assert.equal(Object.hasOwn(form, 'username'), false);
      if (accountDeleted || form.password !== storedPassword
        || (Object.hasOwn(form,'email') ? form.email !== (options.email ?? email) : form.account_username !== (options.username ?? metadata.username)))
        return reply({error: 'invalid_authorization', development_only: true}, 401);
      const query = new URLSearchParams({code: confirmation, state: flow.state});
      return reply('', 303, {location: options.redirect ? options.redirect(`${redirect}?${query}`) : `${redirect}?${query}`});
    }
    if (path === '/dev-oidc/token') {
      assert.equal(form.client_id, client);
      if (form.grant_type === 'refresh_token') { refreshCalls++; shortAccess = false;
        if (options.failRefresh) throw new Error('private transport marker');
      } else {
        assert.equal(form.grant_type, 'authorization_code'); assert.equal(form.redirect_uri, redirect);
        assert.equal(form.code, confirmation);
        const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(form.code_verifier))).toString('base64url');
        assert.equal(challenge, [...flows.values()].at(-1).code_challenge);
      }
      const token = `access-token-${++serial}`, refresh = `refresh-token-${serial}-synthetic`; access.add(token);
      return reply({access_token: token, refresh_token: refresh, expires_in: 300, token_type: 'Bearer', device_bound: false,
        development_only: true, ...(form.grant_type === 'authorization_code' ? {id_token: await signedToken([...flows.values()].at(-1))} : {})});
    }
    if (path === '/v1/account/context') {
      contextCalls++; if (!access.has(input.headers.authorization?.replace('Bearer ', ''))) return reply({error: 'invalid_authorization'}, 401);
      return reply(accountContext());
    }
    if (path === '/v1/account/identity/status') {
      assert.equal(input.method,'GET');
      if (!access.has(input.headers.authorization?.replace('Bearer ',''))) return reply({error:'invalid_authorization'},401);
      const context = accountContext(), value = identityStatusFixture(context);
      return reply(options.identityStatus ? await options.identityStatus(value,{context}) : value);
    }
    if (path === '/v1/auth/session') { assert.equal(input.method, 'DELETE'); access.clear(); return reply({revoked: true, development_only: true, scope: 'current session'}); }
    if (path === '/v1/account/deletion') {
      assert.ok(access.has(input.headers.authorization?.replace('Bearer ','')));
      assert.deepEqual(Object.keys(body).sort(),['confirm_email','deliberate','operation_id','operation_secret','password']);
      if (body.password !== storedPassword || body.confirm_email !== (options.email ?? email) || body.deliberate !== true)
        return reply({error:'account_deletion_refused'},403);
      const value = {state:'deleted',receipt:{operation_id:body.operation_id,account_id:accountReceipt().account_id,
        principal_id:accountReceipt().principal_id,deleted_at:Math.floor(Date.now()/1000),development_only:true,
        email_reusable:true,retention:'historical_records_and_backups_preserved'}};
      deletions.set(body.operation_id,{secret:body.operation_secret,value}); access.clear(); availableRecoveryCodes.clear(); accountDeleted = true; return reply(value);
    }
    if (path === '/v1/account/deletion/status') {
      assert.equal(input.headers.authorization,undefined);
      const found = deletions.get(body.operation_id);
      return found?.secret === body.operation_secret ? reply(found.value) : reply({error:'account_operation_not_found'},404);
    }
    if (path === '/v1/accounts/presence') {
      assert.equal(input.headers?.authorization, undefined);
      const emailSelector = Object.hasOwn(body, 'email');
      assert.equal(emailSelector !== Object.hasOwn(body, 'username'), true);
      assert.deepEqual(Object.keys(body).sort(), [emailSelector ? 'email' : 'username']);
      const exists = !accountDeleted && (emailSelector
        ? body.email === (options.email ?? email)
        : body.username === (options.username ?? metadata.username));
      return reply({exists, development_only: true});
    }
    if (path === '/v1/accounts/entry/start') {
      const selector = Object.hasOwn(body,'username') ? 'username' : 'email';
      assert.deepEqual(Object.keys(body).sort(),['operation_id','operation_secret',selector].sort());
      if (selector === 'username') assert.match(body.username,/^[a-z][a-z0-9_]{2,29}$/);
      assert.match(body.operation_id,/^entry:[A-Za-z0-9_-]{43}$/);
      assert.equal(input.headers.authorization,undefined);
      const previous = operations.get(body.operation_id);
      if (previous) assert.deepEqual(body,previous.start);
      else operations.set(body.operation_id,{start:body,state:'pending'});
      return reply({status:'pending',scope:'account_email_entry'},202);
    }
    if (path === '/v1/accounts/entry/confirm') {
      assert.deepEqual(Object.keys(body).sort(),['confirmation_token','operation_id','operation_secret']);
      const operation = operations.get(body.operation_id); assert.ok(operation);
      assert.equal(body.operation_secret,operation.start.operation_secret);
      if (body.confirmation_token !== entryConfirmation) return reply({error:'account_operation_not_found'},404);
      if (Object.hasOwn(operation.start,'username')) {
        if (operation.start.username !== (options.username ?? metadata.username)) return reply({error:'account_operation_not_found'},404);
        operation.state = 'confirmed'; operation.nextStep = 'password';
        return reply({next_step:'password',email:options.email ?? email,username:operation.start.username});
      }
      operation.state = 'confirmed'; const step = nextEntryStep ?? options.entryStep ?? 'password'; nextEntryStep = null;
      operation.nextStep = step; return reply({next_step:step});
    }
    if (path === '/v1/accounts/enrollments') {
      const entry = operations.get(body.entry_proof?.operation_id);
      assert.ok(entry && entry.state === 'confirmed' && entry.nextStep === 'enrollment');
      assert.equal(entry.start.email,body.email); assert.equal(entry.start.operation_secret,body.entry_proof.operation_secret);
      assert.equal(body.display_name,body.username); assert.deepEqual(body.roles,['O','R']); assert.deepEqual(body.terms,acceptedTerms);
      const metadata = {email:body.email,username:body.username,display_name:body.username,roles:body.roles,
        revision:body.revision,reviewed_revision:body.reviewed_revision,terms:body.terms};
      assert.equal(body.registration_sha256,createHash('sha256').update(JSON.stringify(metadata)).digest('hex'));
      const previous = operations.get(body.operation_id);
      if (previous) assert.deepEqual(body, previous.start);
      else operations.set(body.operation_id, {start: body, state: 'pending', receipt: null});
      return reply({status: 'pending', scope: 'local_synthetic_account_enrollment'}, 202);
    }
    if (path === '/v1/accounts/enrollments/confirm') {
      const operation = operations.get(body.operation_id); assert.ok(operation); assert.equal(body.operation_secret, operation.start.operation_secret);
      const codes = recoveryBatch(body.recovery_codes); assert.equal(Object.hasOwn(body,'recovery_code'),false);
      if (operation.confirmBody) { assert.deepEqual(body,operation.confirmBody); return reply(operation.receipt); }
      if (accountDeleted) { accountVersion++; currentSession = `session:recreated-${accountVersion}`; generation = 0; storedPassword = operation.start.password; accountDeleted = false; }
      assert.equal(body.confirmation_token, confirmation); operation.state = 'confirmed'; operation.receipt = accountReceipt();
      operation.confirmBody = structuredClone(body); operation.recoveryCodes = codes; availableRecoveryCodes = new Set(codes); return reply(operation.receipt);
    }
    if (path === '/v1/accounts/mock-mail') {
      const operation = operations.get(body.operation_id);
      assert.ok(operation); assert.equal(body.operation_secret,operation.start.operation_secret);
      assert.ok(['entry','enrollment','recovery'].includes(body.purpose));
      if (body.purpose === 'entry' && Object.hasOwn(operation.start,'username')
        && operation.start.username !== (options.username ?? metadata.username)) return reply({error:'account_operation_not_found'},404);
      return reply({development_only:true,delivery:'mock',confirmation_code:body.purpose === 'entry' ? entryConfirmation : confirmation});
    }
    if (path.endsWith('/status')) { const operation = operations.get(body.operation_id); assert.ok(operation);
      return reply({state: operation.state, receipt: operation.receipt, scope: 'private historical operation receipt'}); }
    if (path === '/v1/accounts/recovery/start') {
      operations.set(body.operation_id,{start:body,state:'pending',receipt:null,allowed:availableRecoveryCodes.has(body.recovery_code)});
      return reply({status: 'pending', scope: 'local_synthetic_account_recovery'}, 202);
    }
    if (path === '/v1/accounts/recovery/finish') {
      const operation = operations.get(body.operation_id); assert.ok(operation); assert.equal(body.confirmation_token, confirmation);
      const codes = recoveryBatch(body.new_recovery_codes); assert.equal(Object.hasOwn(body,'new_recovery_code'),false);
      if (operation.finishBody) { assert.deepEqual(body,operation.finishBody); return reply(operation.receipt); }
      if (!operation.allowed || !availableRecoveryCodes.has(operation.start.recovery_code)) return reply({error:'recovery_factor_consumed'},409);
      generation++; storedPassword = body.new_password; access.clear(); operation.state = 'recovered'; operation.receipt = accountReceipt();
      operation.finishBody = structuredClone(body); operation.recoveryCodes = codes; availableRecoveryCodes = new Set(codes);
      currentSession = `session:recovered-${generation}`; return reply(operation.receipt);
    }
    throw new Error(`Unhandled synthetic path ${path}`);
  }
  return {request,calls,operations,accountReceipt,nextEntry(value){nextEntryStep=value;},get recoveryCodes(){return [...availableRecoveryCodes];},
    get refreshCalls(){return refreshCalls;},get contextCalls(){return contextCalls;}};
}

test('service discovery pins the local issuer and refuses malformed contacts before any request', async () => {
  const f = await fixture(), adapter = createServiceAccountAdapter({request: f.request});
  for (const badEmail of ['x@invalid', 'a..b@example.invalid', '\u212A@example.invalid'])
    await rejection(adapter.signIn({email: badEmail, password}), 'email_invalid');
  await rejection(adapter.create({...metadata, deliberate: false}), 'deliberate_required');
  assert.equal(f.calls.length, 0); await adapter.configure(); assert.equal(adapter.snapshot().configured, true);
  const other = await fixture({discovery: {issuer: 'https://attacker.invalid'}});
  const invalid = createServiceAccountAdapter({request: other.request});
  await rejection(invalid.configure(), 'service_response_invalid'); assert.equal(invalid.snapshot().configured, false);
});

test('ordinary email or username continuation distinguishes a missing account without revealing its contact', async () => {
  const f = await fixture({username:metadata.username}), changes = [];
  const adapter = createServiceAccountAdapter({request:f.request,onChange:value=>changes.push(value)});
  const offline = createServiceAccountAdapter({request:async ()=>{ throw new Error('offline'); }});
  const local = await offline.beginSignIn({identifier:email});
  assert.equal(local.configured,false);
  assert.deepEqual(local.entry,{mode:'sign_in',step:'password',identifier:email,email,username:null});
  await adapter.configure();
  for (const [input,selector,step] of [[' Participant@Example.Invalid ',{identifier:email,email,username:null},'password'],
    ['unknown@example.invalid',{identifier:'unknown@example.invalid',email:'unknown@example.invalid',username:null},'missing'],
    [' @SYNTHETIC_PARTICIPANT ',{identifier:'@synthetic_participant',email:null,username:metadata.username},'password'],
    ['unknown_person',{identifier:'@unknown_person',email:null,username:'unknown_person'},'missing']]) {
    const value = await adapter.beginSignIn({identifier:input});
    assert.deepEqual(value.entry,{mode:'sign_in',step,...selector});
    assert.equal(value.state,'signed_out'); assert.equal(value.email,null); assert.equal(value.username,null);
    assert.equal(JSON.stringify(value).includes('participant@example.invalid') && selector.email !== email, false);
    await rejection(adapter.confirmEntry({code:entryConfirmation}),'operation_required');
  }
  const presence = f.calls.filter(row=>row.path === '/v1/accounts/presence');
  assert.equal(presence.length,4);
  assert.deepEqual(presence.map(row=>JSON.parse(row.body)),[
    {email},{email:'unknown@example.invalid'},{username:metadata.username},{username:'unknown_person'}]);
  for (const identifier of ['', '@ab', '@@alice', 'alice-name', 'Kalice', null])
    await rejection(adapter.beginSignIn({identifier}), 'identifier_invalid');
  await adapter.beginSignIn({identifier:email});
  await rejection(adapter.signIn({identifier:email,password:'incorrect-fixture-password'}),'invalid_authorization');
  assert.equal(adapter.snapshot().state,'signed_out');
  assert.equal(adapter.snapshot().email,null);
  assert.equal(f.calls.some(row=>row.path.includes('/entry/') || row.path.includes('mock-mail') || row.path.includes('/enrollments')),false);
  assert.equal(changes.some(value=>value.confirmed || value.state === 'signed_in'),false);
});

test('public username password authentication reveals its contact only after matching authenticated context', async () => {
  const f = await fixture({username:metadata.username}), changes = [];
  const adapter = createServiceAccountAdapter({request:f.request,onChange:value=>changes.push(value)});
  await adapter.beginSignIn({identifier:' @SYNTHETIC_PARTICIPANT '});
  assert.equal(JSON.stringify(changes).includes(email),false);
  await adapter.signIn({identifier:adapter.snapshot().entry.identifier,password});
  assert.equal(adapter.snapshot().state,'signed_in'); assert.equal(adapter.snapshot().email,email);
  assert.equal(adapter.snapshot().username,metadata.username); assert.equal(adapter.snapshot().entry,null);
  const credentials = f.calls.find(row=>row.path === '/dev-oidc/authorize' && row.method === 'POST');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(credentials.body)),{
    authorization_id:Buffer.alloc(32,2).toString('base64url'),csrf:Buffer.alloc(32,3).toString('base64url'),
    account_username:metadata.username,password});
  assert.equal(f.calls.some(row=>row.path.includes('/entry/') || row.path.includes('mock-mail')),false);
  await rejection(adapter.signIn({identifier:metadata.username,email,password}),'identifier_invalid');
  await rejection(adapter.beginSignIn({identifier:metadata.username}), 'account_active');
  for (const context of [value=>value, value=>({...value,username:'other_account'})]) {
    const bad = await fixture({context}), refused = createServiceAccountAdapter({request:bad.request});
    await rejection(refused.signIn({identifier:metadata.username,password}),'account_changed');
    assert.notEqual(refused.snapshot().state,'signed_in'); assert.equal(refused.snapshot().email,null);
    assert.equal(bad.calls.some(row=>row.path.includes('/signin-devices')),false);
  }
});

test('local password continuation replaces email proof and fences a late superseded login', async () => {
  const f = await fixture({entryStep:'enrollment'}), hold = gate(); let waiting;
  const adapter = createServiceAccountAdapter({request:async input=>{
    const result = await f.request(input);
    if (input.path.startsWith('/dev-oidc/authorize?')) { waiting = input; await hold.promise; }
    return result;
  }});
  await adapter.startEntry({email}); await adapter.confirmEntry({code:entryConfirmation});
  await adapter.beginSignIn({identifier:email});
  await rejection(adapter.create(metadata),'email_entry_required');
  const pending = adapter.signIn({identifier:email,password}), refused = rejection(pending,'stale_operation');
  await waitFor(()=>waiting);
  const replaced = adapter.beginSignIn({identifier:'@other_account'}); hold.resolve(); await refused; await replaced;
  assert.equal(waiting.signal.aborted,true);
  assert.deepEqual(adapter.snapshot().entry,{mode:'sign_in',step:'missing',identifier:'@other_account',email:null,username:'other_account'});
  assert.equal(adapter.snapshot().email,null); assert.equal(adapter.snapshot().state,'signed_out');
});

test('email entry stays uniform until owned hex code confirmation and grants no account authority', async () => {
  for (const next of ['password','enrollment']) {
    const f = await fixture({entryStep:next,capabilities:{email_delivery:'mock',real_email_enabled:false,development_only:true}});
    const changes = [], adapter = createServiceAccountAdapter({request:f.request,onChange:value=>changes.push(value)});
    await adapter.startEntry({identifier:' Participant@Example.Invalid '});
    assert.deepEqual(adapter.snapshot().entry,{mode:'signup',email,step:'code'});
    assert.equal(adapter.snapshot().state,'signed_out'); assert.equal(adapter.snapshot().confirmed,false);
    assert.equal(adapter.snapshot().operation,null); assert.equal(adapter.snapshot().email,null);
    const first = JSON.parse(f.calls.find(input=>input.path === '/v1/accounts/entry/start').body);
    await adapter.startEntry({email});
    const second = JSON.parse(f.calls.filter(input=>input.path === '/v1/accounts/entry/start').at(-1).body);
    assert.deepEqual(second,first,'A retry retains the same private operation, without creating a new challenge.');
    assert.equal(await adapter.mockMail(),entryConfirmation);
    assert.equal(JSON.parse(f.calls.at(-1).body).purpose,'entry');
    assert.deepEqual(adapter.snapshot().entry,{mode:'signup',email,step:'code'});
    await adapter.confirmEntry({code:entryConfirmation.toLowerCase()});
    assert.deepEqual(adapter.snapshot().entry,{mode:'signup',email,step:next});
    await rejection(adapter.getAccount(),'account_required');
    await rejection(adapter.mockMail(),'mock_mail_unavailable');
    for (const marker of [first.operation_id,first.operation_secret,entryConfirmation,password,'access-token-'])
      assert.equal(JSON.stringify(changes).includes(marker),false,'Snapshots never expose private entry material or auth tokens.');
    assert.equal(f.calls.some(input=>input.path.startsWith('/dev-oidc/authorize') || input.path === '/v1/accounts/enrollments'),false);
    adapter.resetEntry(); assert.equal(adapter.snapshot().entry,null);
  }
});

test('username entry normalizes one selector, retries exact proofs and resolves email only before password PKCE sign-in', async () => {
  assert.deepEqual(loginIdentifier('  @ALICE_7\t'),{username:'alice_7'});
  assert.deepEqual(loginIdentifier('Alice_7'),{username:'alice_7'});
  assert.deepEqual(loginIdentifier('  Participant@Example.Invalid  '),{email});
  assert.deepEqual(loginIdentifier('@A'+'b'.repeat(29)),{username:'a'+'b'.repeat(29)},'Thirty canonical username characters are accepted.');
  const f = await fixture({capabilities:{email_delivery:'mock',real_email_enabled:false,development_only:true}}), changes = [];
  let loseProof = true;
  const adapter = createServiceAccountAdapter({onChange:value=>changes.push(value),request:async input=>{
    const value = await f.request(input);
    if (input.path === '/v1/accounts/entry/confirm' && loseProof) { loseProof = false; throw new Error('Lost synthetic proof response'); }
    return value;
  }});
  await adapter.startEntry({identifier:'  @SYNTHETIC_PARTICIPANT  '});
  const pending = {mode:'signup',email:null,username:metadata.username,step:'code'};
  assert.deepEqual(adapter.snapshot().entry,pending); assert.equal(adapter.snapshot().email,null);
  assert.equal(adapter.snapshot().state,'signed_out'); await rejection(adapter.getAccount(),'account_required');
  const start = f.calls.find(row=>row.path === '/v1/accounts/entry/start');
  assert.deepEqual(Object.keys(JSON.parse(start.body)).sort(),['operation_id','operation_secret','username']);
  assert.equal(JSON.parse(start.body).username,metadata.username);
  await adapter.startEntry({identifier:'synthetic_participant'});
  assert.equal(f.calls.filter(row=>row.path === start.path).at(-1).body,start.body,'A normalized retry reuses exact private challenge bytes.');
  assert.equal(JSON.stringify(changes).includes(email),false,'The linked contact is absent from pre-proof snapshots.');
  assert.equal(await adapter.mockMail(),entryConfirmation);
  await rejection(adapter.confirmEntry({code:entryConfirmation}),'transport_unavailable');
  assert.deepEqual(adapter.snapshot().entry,pending);
  await adapter.confirmEntry({code:entryConfirmation.toLowerCase()});
  const proofs = f.calls.filter(row=>row.path === '/v1/accounts/entry/confirm');
  assert.equal(proofs[0].body,proofs[1].body,'Lost proof replies retry the exact operation, secret and normalized code.');
  assert.deepEqual(adapter.snapshot().entry,{mode:'signup',email,username:metadata.username,step:'password'});
  assert.equal(adapter.snapshot().state,'signed_out'); await rejection(adapter.getAccount(),'account_required');
  assert.equal(f.calls.some(row=>row.path.startsWith('/dev-oidc/authorize') || row.path === '/v1/accounts/enrollments'),false);
  await adapter.signIn({email:adapter.snapshot().entry.email,password});
  assert.equal(adapter.snapshot().state,'signed_in'); assert.equal(adapter.snapshot().entry,null);
  const credential = f.calls.find(row=>row.path === '/dev-oidc/authorize' && row.method === 'POST');
  assert.deepEqual(Object.keys(Object.fromEntries(new URLSearchParams(credential.body))).sort(),['authorization_id','csrf','email','password']);
  assert.equal(new URLSearchParams(credential.body).get('email'),email);
  assert.ok(f.calls.some(row=>row.path === '/dev-oidc/token'),'The existing verifier checks the actual S256 exchange.');
  const privateStart = JSON.parse(start.body);
  for (const marker of [privateStart.operation_id,privateStart.operation_secret,entryConfirmation,password,'access-token-'])
    assert.equal(JSON.stringify(changes).includes(marker),false,'Snapshots omit entry proof and authentication secrets.');
});

test('unknown usernames and invalid or mixed username proof replies never disclose a contact or select signup', async () => {
  const invalid = await fixture(), empty = createServiceAccountAdapter({request:invalid.request});
  for (const identifier of ['', '@ab', '@@alice', '1alice', 'alice-bob', 'a'.repeat(31), '\u212Aalice', 'alice@', 'a b c'])
    await assert.rejects(empty.startEntry({identifier}));
  for (const value of [null,42,{},[]]) await rejection(empty.startEntry({identifier:value}),'identifier_invalid');
  await rejection(empty.startEntry({identifier:metadata.username,email}),'identifier_invalid');
  assert.equal(invalid.calls.length,0,'Invalid selectors fail before discovery or entry requests.');
  const f = await fixture({capabilities:{email_delivery:'mock',real_email_enabled:false,development_only:true}});
  const adapter = createServiceAccountAdapter({request:f.request}); await adapter.startEntry({identifier:'@unknown_participant'});
  const pending = {mode:'signup',email:null,username:'unknown_participant',step:'code'};
  assert.deepEqual(adapter.snapshot().entry,pending); assert.equal(adapter.snapshot().email,null);
  await rejection(adapter.mockMail(),'account_operation_not_found');
  await rejection(adapter.confirmEntry({code:entryConfirmation}),'account_operation_not_found');
  assert.deepEqual(adapter.snapshot().entry,pending); assert.equal(adapter.snapshot().state,'signed_out');
  assert.equal(f.calls.some(row=>row.path === '/v1/accounts/enrollments' || row.path.startsWith('/dev-oidc/authorize')),false);
  for (const value of [{next_step:'password'}, {next_step:'enrollment'},
    {next_step:'enrollment',email,username:metadata.username}, {next_step:'password',email},
    {next_step:'password',email,username:'other_participant'}, {next_step:'password',email,username:'@synthetic_participant'},
    {next_step:'password',email:'not-an-email',username:metadata.username},
    {next_step:'password',email,username:metadata.username,account_id:'private'},
    {next_step:'password',email,username:metadata.username,next:'enrollment'}]) {
    const bad = await fixture({intercept:input=>input.path === '/v1/accounts/entry/confirm' ? reply(value) : null});
    const account = createServiceAccountAdapter({request:bad.request}); await account.startEntry({identifier:metadata.username});
    await rejection(account.confirmEntry({code:entryConfirmation}),'service_response_invalid');
    assert.deepEqual(account.snapshot().entry,{mode:'signup',email:null,username:metadata.username,step:'code'});
    assert.equal(account.snapshot().email,null); assert.equal(account.snapshot().state,'signed_out');
  }
  const mixed = await fixture({intercept:input=>input.path === '/v1/accounts/entry/confirm'
    ? reply({next_step:'password',email,username:metadata.username}) : null});
  const emailOnly = createServiceAccountAdapter({request:mixed.request}); await emailOnly.startEntry({email});
  await rejection(emailOnly.confirmEntry({code:entryConfirmation}),'service_response_invalid');
  assert.deepEqual(emailOnly.snapshot().entry,{mode:'signup',email,step:'code'},'The legacy email response remains its exact separate shape.');
});

test('entry validation and refused or malformed proofs never select a new or existing account', async () => {
  const invalid = await fixture(), empty = createServiceAccountAdapter({request:invalid.request});
  await rejection(empty.startEntry({email:'not-an-email'}),'email_invalid'); assert.equal(invalid.calls.length,0);
  await rejection(empty.confirmEntry({code:entryConfirmation}),'operation_required');
  await rejection(empty.startEntry({email:'real@nonverba-fixture.net'}),'contact_preview_only');
  assert.equal(invalid.calls.some(input=>input.path === '/v1/accounts/entry/start'),false);
  for (const value of [{next_step:'unknown'}, {next_step:'enrollment',account_id:'private'}, {existing:true}]) {
    const f = await fixture({intercept:input=>input.path === '/v1/accounts/entry/confirm' ? reply(value) : null});
    const adapter = createServiceAccountAdapter({request:f.request}); await adapter.startEntry({email});
    await rejection(adapter.confirmEntry({code:entryConfirmation}),'service_response_invalid');
    assert.deepEqual(adapter.snapshot().entry,{mode:'signup',email,step:'code'}); assert.equal(adapter.snapshot().state,'signed_out');
  }
  const f = await fixture(), adapter = createServiceAccountAdapter({request:f.request}); await adapter.startEntry({email});
  const before = f.calls.length;
  for (const code of ['', '1234567', '123456789', 'A1B2C3G4', confirmation]) await rejection(adapter.confirmEntry({code}),'confirmation_invalid');
  assert.equal(f.calls.length,before,'Malformed hex codes never reach the service.');
  await rejection(adapter.confirmEntry({code:'DEADBEEF'}),'account_operation_not_found');
  assert.deepEqual(adapter.snapshot().entry,{mode:'signup',email,step:'code'});
  await adapter.confirmEntry({code:entryConfirmation}); assert.equal(adapter.snapshot().entry.step,'password');
});

test('entry cancellation and edited selectors fence late start, proof and mock inbox replies', async () => {
  for (const selector of [{email},{identifier:'@synthetic_participant'}])
  for (const target of ['/v1/accounts/entry/start','/v1/accounts/entry/confirm','/v1/accounts/mock-mail']) {
    const hold = gate(); let waiting;
    const f = await fixture({capabilities:{email_delivery:'mock',real_email_enabled:false,development_only:true}});
    const adapter = createServiceAccountAdapter({request:async input=>{
      const result = await f.request(input); if (input.path === target) { waiting = input; await hold.promise; } return result;
    }});
    if (target !== '/v1/accounts/entry/start') await adapter.startEntry(selector);
    const pending = target === '/v1/accounts/entry/start' ? adapter.startEntry(selector)
      : target.endsWith('/confirm') ? adapter.confirmEntry({code:entryConfirmation}) : adapter.mockMail();
    const refused = rejection(pending,'stale_operation'); await waitFor(()=>waiting);
    adapter.resetEntry(); assert.equal(waiting.signal.aborted,true); hold.resolve(); await refused;
    assert.equal(adapter.snapshot().entry,null); assert.equal(adapter.snapshot().state,'signed_out');
  }
  const f = await fixture(), adapter = createServiceAccountAdapter({request:f.request});
  await adapter.startEntry({email}); const original = JSON.parse(f.calls.at(-1).body);
  await adapter.startEntry({email:'other@example.invalid'}); const changed = JSON.parse(f.calls.at(-1).body);
  assert.notEqual(changed.operation_id,original.operation_id); assert.notEqual(changed.operation_secret,original.operation_secret);
  assert.deepEqual(adapter.snapshot().entry,{mode:'signup',email:'other@example.invalid',step:'code'});
  await adapter.startEntry({identifier:'@SYNTHETIC_PARTICIPANT'}); const byUsername = JSON.parse(f.calls.at(-1).body);
  assert.notEqual(byUsername.operation_id,changed.operation_id); assert.notEqual(byUsername.operation_secret,changed.operation_secret);
  assert.deepEqual(adapter.snapshot().entry,{mode:'signup',email:null,username:metadata.username,step:'code'});
  await adapter.startEntry({email}); const byEmail = JSON.parse(f.calls.at(-1).body);
  assert.notEqual(byEmail.operation_id,byUsername.operation_id); assert.notEqual(byEmail.operation_secret,byUsername.operation_secret);
  adapter.cancel(); assert.equal(adapter.snapshot().entry,null);
});

test('entry reset preserves a current session while successful password authentication clears the entry', async () => {
  const f = await fixture(), adapter = createServiceAccountAdapter({request:f.request});
  await adapter.startEntry({email}); await adapter.confirmEntry({code:entryConfirmation});
  await rejection(adapter.signIn({email,password:'incorrect-fixture-password'}),'invalid_authorization');
  assert.deepEqual(adapter.snapshot().entry,{mode:'signup',email,step:'password'});
  await adapter.signIn({email,password}); assert.equal(adapter.snapshot().entry,null);
  adapter.resetEntry(); assert.equal(adapter.snapshot().state,'signed_in'); await adapter.getAccount();
  await rejection(adapter.startEntry({email}),'account_active'); assert.equal(adapter.snapshot().state,'signed_in');
  await adapter.signOut(); assert.equal(adapter.snapshot().entry,null);
});

function statusInventory(value,{materials,now}) {
  return {...value,keys:[
    {device_id:'device:status-active',key_id:'key:status-active',role:'R',...materials[0],approved_at:now-20,revoked_at:null,active:true},
    {device_id:'device:status-revoked',key_id:'key:status-revoked',role:'R',...materials[1],approved_at:now-30,revoked_at:now-10,active:false}
  ],requests:[{request_id:'request:status-pending',device_id:'device:status-pending',
    key:{role:'R',key_id:'key:status-pending',public_key_sec1_b64:materials[0].public_key_sec1_b64},
    fingerprint_sha256:materials[0].fingerprint_sha256,recovery_generation:value.recovery_generation,status:'pending_approval',
    created_at:now-10,expires_at:now+590,proved_at:now-5,approved_at:null,revoked_at:null}]};
}

test('live feedback probes fresh API and readiness instead of treating cached configuration as health', async () => {
  let online = true;
  const f = await fixture({intercept:input=>{
    if (!online && ['/readyz','/dev-oidc/.well-known/openid-configuration'].includes(input.path)) throw new Error('private backend diagnostic');
    return null;
  }}), changes = [], adapter = createServiceAccountAdapter({request:f.request,onChange:value=>changes.push(value)});
  assert.deepEqual(adapter.snapshot().feedback,{api:'unknown',service:'unknown',keys:'signin_required',
    active_keys:null,pending_keys:null,revoked_keys:null,current_key_bound:null});
  await adapter.configure(); assert.equal(adapter.snapshot().feedback.api,'unknown');
  await adapter.checkStatus();
  assert.equal(adapter.snapshot().feedback.api,'available'); assert.equal(adapter.snapshot().feedback.service,'ready');
  assert.ok(changes.some(value=>value.feedback.api === 'checking' && value.feedback.service === 'checking'));
  online = false; await adapter.checkStatus();
  assert.equal(adapter.snapshot().configured,true); assert.equal(adapter.snapshot().feedback.api,'unavailable');
  assert.equal(adapter.snapshot().feedback.service,'unavailable');
  online = true; await adapter.checkStatus(); assert.equal(adapter.snapshot().feedback.service,'ready');
  assert.equal(f.calls.filter(value=>value.path === '/readyz').length,3);
  assert.equal(f.calls.some(value=>value.path === '/v1/account/devices'),false);
  assert.equal(f.calls.every(value=>value.method === 'GET'),true);
  assert.equal(JSON.stringify(changes).includes('private backend diagnostic'),false);
});

test('quiet health checks retain displayed feedback until unavailable or recovered results complete', async () => {
  let held = null, entered = 0, online = true;
  const f = await fixture(), changes = [], adapter = createServiceAccountAdapter({request:async input=>{
    if (held && ['/readyz','/dev-oidc/.well-known/openid-configuration'].includes(input.path)) {
      entered++; await held.promise;
      if (!online) throw new Error('Synthetic offline result');
    }
    return f.request(input);
  },onChange:value=>changes.push(value)});
  await adapter.checkStatus();
  for (const available of [false,true]) {
    online = available; held = gate(); entered = 0;
    const previous = adapter.snapshot().feedback, before = changes.length;
    const pending = adapter.checkStatus({quiet:true}); await waitFor(()=>entered === 2);
    assert.deepEqual(adapter.snapshot().feedback,previous);
    assert.equal(changes.length,before,'A quiet probe does not publish a pending state.');
    held.resolve(); await pending;
    assert.equal(adapter.snapshot().feedback.api,available ? 'available' : 'unavailable');
    assert.equal(adapter.snapshot().feedback.service,available ? 'ready' : 'unavailable');
    assert.equal(adapter.snapshot().feedback.keys,'signin_required');
  }
});

test('quiet key checks keep prior counts while pending, then clear failures and accept fresh inventory', async () => {
  let held = null, entered = false, refused = false;
  const f = await fixture({inventory:statusInventory}), changes = [], adapter = createServiceAccountAdapter({request:async input=>{
    const response = await f.request(input);
    if (held && input.path === '/v1/account/devices') {
      entered = true; await held.promise;
      if (refused) return reply({error:'unavailable'},503);
    }
    return response;
  },onChange:value=>changes.push(value)});
  await adapter.signIn({email,password}); await adapter.checkStatus();
  for (const fail of [true,false]) {
    refused = fail; held = gate(); entered = false;
    const previous = adapter.snapshot().feedback, before = changes.length;
    const pending = adapter.checkStatus({quiet:true}); await waitFor(()=>entered);
    assert.deepEqual(adapter.snapshot().feedback,previous);
    assert.ok(changes.slice(before).every(value=>JSON.stringify(value.feedback) === JSON.stringify(previous)),
      'Context reads during quiet refresh must not replace the displayed key summary.');
    held.resolve(); await pending;
    assert.equal(adapter.snapshot().state,'signed_in');
    assert.deepEqual(adapter.snapshot().feedback,{api:'available',service:'ready',keys:fail ? 'unknown' : 'known',
      active_keys:fail ? null : 1,pending_keys:fail ? null : 1,revoked_keys:fail ? null : 1,current_key_bound:fail ? null : false});
  }
});

test('service readiness feedback rejects malformed or inconsistent health reports without inventing readiness', async () => {
  for (const response of [reply({status:'ready'}),reply({status:'ready',database_select_1:false,
    object_store_tcp_reachable:true,object_store_authenticated_hash_read:true,migrations_current:true,scope:'fixture'}),
    reply({status:'unavailable',database_select_1:false,object_store_tcp_reachable:false,
      object_store_authenticated_hash_read:false,migrations_current:true,scope:'fixture'},503)]) {
    const f = await fixture({intercept:input=>input.path === '/readyz' ? response : null});
    const adapter = createServiceAccountAdapter({request:f.request}); await adapter.checkStatus();
    assert.equal(adapter.snapshot().feedback.api,'available'); assert.equal(adapter.snapshot().feedback.service,'unavailable');
    assert.equal(adapter.snapshot().state,'signed_out');
  }
});

test('key feedback summarizes only current server inventory and keeps unbound login separate from approved account keys', async () => {
  const f = await fixture({inventory:statusInventory}), changes = [], adapter = createServiceAccountAdapter({request:f.request,onChange:value=>changes.push(value)});
  await adapter.signIn({email,password}); await adapter.checkStatus();
  assert.deepEqual(adapter.snapshot().feedback,{api:'available',service:'ready',keys:'known',active_keys:1,pending_keys:1,revoked_keys:1,current_key_bound:false});
  const serialized = JSON.stringify(changes), inventory = JSON.parse((await f.request({method:'GET',path:'/v1/account/devices',
    headers:{authorization:f.calls.find(value=>value.path === '/v1/account/devices').headers.authorization}})).body);
  for (const marker of [inventory.keys[0].key_id,inventory.keys[0].device_id,inventory.keys[0].public_key_sec1_b64,
    inventory.keys[0].fingerprint_sha256,inventory.requests[0].request_id]) assert.equal(serialized.includes(marker),false);
  const external = adapter.snapshot(); external.feedback.active_keys = 100;
  assert.equal(adapter.snapshot().feedback.active_keys,1,'Feedback snapshots cannot mutate internal summaries.');
  await adapter.signOut(); assert.equal(adapter.snapshot().feedback.keys,'signin_required');
  assert.equal(adapter.snapshot().feedback.active_keys,null); assert.equal(adapter.snapshot().feedback.current_key_bound,null);
});

test('a bound current credential requires its active mapping and truncated inventory remains incomplete', async () => {
  const boundContext = (value,{materials})=>({...value,session:{...value.session,device_bound:true,
    device_id:'device:status-active',key_id:'key:status-active',role:'R',public_key_sec1_b64:materials[0].public_key_sec1_b64}});
  const f = await fixture({inventory:statusInventory,context:boundContext}), adapter = createServiceAccountAdapter({request:f.request});
  await adapter.signIn({email,password}); await adapter.checkStatus();
  assert.equal(adapter.snapshot().feedback.current_key_bound,true); assert.equal(adapter.snapshot().feedback.keys,'known');
  for (const flag of ['keys_has_more','requests_has_more']) {
    const truncated = await fixture({context:boundContext,inventory:(value,platform)=>({...statusInventory(value,platform),[flag]:true})});
    const limited = createServiceAccountAdapter({request:truncated.request}); await limited.signIn({email,password}); await limited.checkStatus();
    assert.equal(limited.snapshot().feedback.keys,'incomplete'); assert.equal(limited.snapshot().feedback.active_keys,null);
    assert.equal(limited.snapshot().feedback.current_key_bound,true);
  }
});

test('foreign, stale, unsafe and malformed inventories stay unknown without changing account authority', async () => {
  const mutations = [value=>({...value,account_id:'account:foreign'}),value=>({...value,recovery_generation:1}),
    value=>({...value,recovery_generation:Number.MAX_SAFE_INTEGER+1}),value=>({...value,limit:257}),
    value=>({...value,keys:[...value.keys,value.keys[0]]}),value=>({...value,keys:[{...value.keys[0],active:false}]}),
    value=>({...value,keys:[{...value.keys[0],fingerprint_sha256:'0'.repeat(64)}]}),
    value=>({...value,requests:[{...value.requests[0],status:'approved',approved_at:null}]}),
    value=>({...value,requests:[{...value.requests[0],recovery_generation:1}]}),value=>({...value,unexpected:'refused'})];
  for (const mutate of mutations) {
    const f = await fixture({inventory:(value,platform)=>mutate(statusInventory(value,platform))});
    const adapter = createServiceAccountAdapter({request:f.request}); await adapter.signIn({email,password}); await adapter.checkStatus();
    assert.equal(adapter.snapshot().feedback.keys,'unknown'); assert.equal(adapter.snapshot().feedback.active_keys,null);
    assert.equal(adapter.snapshot().feedback.current_key_bound,null); assert.equal(adapter.snapshot().state,'signed_in');
  }
});

test('cancellation fences late key feedback while a later check can read the current account', async () => {
  const hold = gate(); let block = true, entered = false;
  const f = await fixture({inventory:statusInventory}), adapter = createServiceAccountAdapter({request:async input=>{
    const response = await f.request(input);
    if (block && input.path === '/v1/account/devices') { entered = true; await hold.promise; }
    return response;
  }});
  await adapter.signIn({email,password}); const pending = adapter.checkStatus(); await waitFor(()=>entered);
  adapter.cancel(); hold.resolve(); await pending;
  assert.equal(adapter.snapshot().state,'signed_out'); assert.equal(adapter.snapshot().feedback.keys,'signin_required');
  assert.equal(adapter.snapshot().feedback.active_keys,null);
  block = false; await adapter.signIn({email,password}); await adapter.checkStatus(); assert.equal(adapter.snapshot().feedback.active_keys,1);
});

test('delayed inventory cannot restore key feedback after a concurrent account context loses authority', async () => {
  for (const quiet of [false,true]) {
    for (const [status,code,state,keys] of [[401,'invalid_authorization','signed_out','signin_required'],
      [503,'transport_unavailable','outcome_unknown','unknown']]) {
      const hold = gate(); let entered = false, denyContext = false;
      const f = await fixture({inventory:statusInventory,intercept:input=>denyContext && input.path === '/v1/account/context'
        ? reply({error:'invalid_authorization'},status) : null});
      const changes = [], adapter = createServiceAccountAdapter({request:async input=>{
        const response = await f.request(input);
        if (input.path === '/v1/account/devices') { entered = true; await hold.promise; }
        return response;
      },onChange:value=>changes.push(value)});
      await adapter.signIn({email,password}); const pending = adapter.checkStatus({quiet}); await waitFor(()=>entered);
      denyContext = true; await rejection(adapter.getAccount(),code);
      const deniedAt = changes.length;
      assert.equal(adapter.snapshot().state,state); assert.equal(adapter.snapshot().feedback.keys,keys);
      hold.resolve(); await pending;
      assert.equal(adapter.snapshot().state,state);
      assert.deepEqual(adapter.snapshot().feedback,{api:'available',service:'ready',keys,
        active_keys:null,pending_keys:null,revoked_keys:null,current_key_bound:null});
      assert.ok(changes.slice(deniedAt).every(value=>value.feedback.keys === keys && value.feedback.active_keys === null),
        'Old inventory must not restore key claims after authoritative context denial or loss.');
    }
  }
});

test('key status denial clears invalid authority and feedback never resubmits an uncertain deletion', async () => {
  const denied = await fixture({intercept:input=>input.path === '/v1/account/devices' ? reply({error:'invalid_authorization'},401) : null});
  const adapter = createServiceAccountAdapter({request:denied.request}); await adapter.signIn({email,password}); await adapter.checkStatus();
  assert.equal(adapter.snapshot().state,'signed_out'); assert.equal(adapter.snapshot().feedback.keys,'signin_required');
  assert.equal(denied.refreshCalls,1);
  const f = await fixture({capabilities:{email_delivery:'mock',real_email_enabled:false,development_only:true}});
  const uncertain = createServiceAccountAdapter({request:async input=>{
    const result = await f.request(input); return input.path === '/v1/account/deletion' ? reply({error:'unavailable'},503) : result;
  }});
  await uncertain.signIn({email,password}); await rejection(uncertain.deleteAccount({password,confirmEmail:email,deliberate:true}),'transport_unavailable');
  const before = f.calls.length; await uncertain.checkStatus();
  assert.equal(uncertain.snapshot().deletion_pending,true); assert.equal(uncertain.snapshot().state,'outcome_unknown');
  assert.deepEqual(f.calls.slice(before).map(value=>value.method),['GET','GET']);
  assert.equal(f.calls.filter(value=>value.path === '/v1/account/deletion').length,1);
});

test('real contact enrollment and recovery require explicit SMTP capability, while test contacts remain local', async () => {
  const f = await fixture(), adapter = createServiceAccountAdapter({request:f.request});
  await rejection(adapter.create({...metadata,email:'real@example.com'}),'email_invalid');
  await rejection(adapter.startRecovery({email:'real@example.com',recoveryCode:confirmation}),'email_invalid');
  assert.equal(f.calls.some(input => input.method === 'POST'),false);
  assert.equal(adapter.snapshot().real_email_enabled,false);
  await reviewedCreate(adapter,f,{...metadata,email:'participant@example.test'});
  assert.equal(adapter.snapshot().state,'pending_confirmation');
  const smtp = await fixture({capabilities:{email_delivery:'smtp',real_email_enabled:true,development_only:true}});
  const connected = createServiceAccountAdapter({request:smtp.request});
  await reviewedCreate(connected,smtp,{...metadata,email:'real@example.com'});
  assert.equal(connected.snapshot().real_email_enabled,true);
  assert.equal(smtp.calls.filter(input => input.path === '/v1/accounts/enrollments').length,1);
});

test('missing, malformed or inconsistent delivery capabilities fail closed without changing login availability', async () => {
  for (const capabilities of [{email_delivery:'smtp',real_email_enabled:true,development_only:false},
    {email_delivery:'disabled',real_email_enabled:true,development_only:true},
    {email_delivery:'smtp',real_email_enabled:true,development_only:true,secret:'refuse'}, {}]) {
    const f = await fixture({capabilities}), adapter = createServiceAccountAdapter({request:f.request});
    await adapter.configure(); assert.equal(adapter.snapshot().real_email_enabled,false);
    await rejection(adapter.create({...metadata,email:'real@example.com'}),'email_invalid');
  }
  const f = await fixture({email:'existing@example.com',intercept:input => input.path === '/v1/accounts/capabilities' ? reply({error:'not_found'},404) : null});
  const adapter = createServiceAccountAdapter({request:f.request});
  await adapter.signIn({email:'existing@example.com',password});
  assert.equal(adapter.snapshot().state,'signed_in'); assert.equal(adapter.snapshot().real_email_enabled,false);
});

test('mock inbox uses only the private pending operation and never grants confirmation or retains its code', async () => {
  const f = await fixture({capabilities:{email_delivery:'mock',real_email_enabled:false,development_only:true}});
  const changes = [], adapter = createServiceAccountAdapter({request:f.request,onChange:value=>changes.push(value)});
  await adapter.configure(); assert.equal(adapter.snapshot().email_delivery,'mock');
  await rejection(adapter.mockMail(),'mock_mail_unavailable');
  await reviewedCreate(adapter,f); const code = await adapter.mockMail();
  assert.equal(code,confirmation); assert.equal(adapter.snapshot().state,'pending_confirmation');
  const mailRequest = f.calls.find(input => input.path === '/v1/accounts/mock-mail');
  assert.deepEqual(Object.keys(JSON.parse(mailRequest.body)).sort(),['operation_id','operation_secret','purpose']);
  assert.equal(JSON.stringify(changes).includes(confirmation),false);
  assert.equal(adapter.snapshot().real_email_enabled,false);
  await adapter.confirm({code,deliberate:true});
  await rejection(adapter.mockMail(),'mock_mail_unavailable');
});

test('mock inbox rejects non-mock responses and late codes after cancellation', async () => {
  for (const value of [{development_only:false,delivery:'mock',confirmation_code:confirmation},
    {development_only:true,delivery:'smtp',confirmation_code:confirmation},
    {development_only:true,delivery:'mock',confirmation_code:'short'},
    {development_only:true,delivery:'mock',confirmation_code:confirmation,extra:'refused'}]) {
    const f = await fixture({capabilities:{email_delivery:'mock',real_email_enabled:false,development_only:true},
      intercept:input=>input.path === '/v1/accounts/mock-mail' ? reply(value) : null});
    const adapter = createServiceAccountAdapter({request:f.request}); await reviewedCreate(adapter,f);
    await assert.rejects(adapter.mockMail()); assert.equal(adapter.snapshot().state,'pending_confirmation');
  }
  const hold = gate(); let entered = false;
  const f = await fixture({capabilities:{email_delivery:'mock',real_email_enabled:false,development_only:true},
    intercept:async input => { if (input.path !== '/v1/accounts/mock-mail') return null;
      entered = true; await hold.promise; return reply({development_only:true,delivery:'mock',confirmation_code:confirmation}); }});
  const adapter = createServiceAccountAdapter({request:f.request}); await reviewedCreate(adapter,f);
  const pending = adapter.mockMail(); const refused = assert.rejects(pending); await waitFor(()=>entered);
  adapter.cancel(); hold.resolve(); await refused;
  assert.equal(adapter.snapshot().recovery_code_available,false);
});

test('test deletion requires reauthentication and deliberate review, revokes local authority and permits fresh identity', async () => {
  const f = await fixture({capabilities:{email_delivery:'mock',real_email_enabled:false,development_only:true}});
  const changes = [], adapter = createServiceAccountAdapter({request:f.request,onChange:value=>changes.push(value)});
  await adapter.signIn({email,password}); const before = await adapter.getAccount();
  await rejection(adapter.deleteAccount({password,confirmEmail:email,deliberate:false}),'deliberate_required');
  await rejection(adapter.deleteAccount({password,confirmEmail:'other@example.invalid',deliberate:true}),'email_confirmation_mismatch');
  assert.equal(f.calls.some(value=>value.path==='/v1/account/deletion'),false);
  await rejection(adapter.deleteAccount({password:'wrong-password-long-enough',confirmEmail:email,deliberate:true}),'account_deletion_refused');
  assert.equal(adapter.snapshot().state,'signed_in');
  await adapter.deleteAccount({password,confirmEmail:email,deliberate:true});
  assert.equal(adapter.snapshot().state,'deleted'); assert.equal(adapter.snapshot().session_outcome,'revoked');
  assert.equal(adapter.snapshot().deletion_pending,false); await rejection(adapter.getAccount(),'account_required');
  await adapter.deletionStatus();
  await assert.rejects(adapter.signIn({email,password}));
  const nextPassword = 'fresh-test-password-after-deletion';
  await reviewedCreate(adapter,f,{...metadata,username:'synthetic_recreated',password:nextPassword}); await adapter.confirm({code:confirmation,deliberate:true});
  recoveryBatch(adapter.recoveryCodes()); adapter.clearRecoveryCodes(); await adapter.signIn({email,password:nextPassword});
  const after = await adapter.getAccount(); assert.notEqual(after.account_id,before.account_id); assert.notEqual(after.principal_id,before.principal_id);
  const snapshots = JSON.stringify(changes), request = JSON.parse(f.calls.find(value=>value.path==='/v1/account/deletion').body);
  for (const secret of [password,nextPassword,request.operation_id,request.operation_secret,'access-token-']) assert.equal(snapshots.includes(secret),false);
});

test('authoritative deletion 401 clears stale local authority without creating an unknown deletion', async () => {
  const f = await fixture({capabilities:{email_delivery:'mock',real_email_enabled:false,development_only:true},
    intercept:input=>input.path === '/v1/account/deletion' ? reply({error:'invalid_authorization'},401) : null});
  const changes = [], adapter = createServiceAccountAdapter({request:f.request,onChange:value=>changes.push(value)});
  await adapter.signIn({email,password});
  await rejection(adapter.deleteAccount({password,confirmEmail:email,deliberate:true}),'invalid_authorization');
  const value = adapter.snapshot();
  assert.equal(value.state,'signed_out'); assert.equal(value.session_outcome,'none');
  assert.equal(value.email,null); assert.deepEqual(value.roles,[]); assert.equal(value.confirmed,false);
  assert.equal(value.operation,null); assert.equal(value.deletion_pending,false);
  assert.equal(changes.at(-1).state,'signed_out','The refusal notification must clear signed-in controls immediately.');
  const contextReads = f.contextCalls;
  await rejection(adapter.getAccount(),'account_required'); assert.equal(f.contextCalls,contextReads);
  await rejection(adapter.deletionStatus(),'operation_required');
  await adapter.signIn({email,password}); assert.equal(adapter.snapshot().state,'signed_in');
});

test('lost deletion result preserves one operation, blocks blind retries and resolves status without a bearer', async () => {
  const f = await fixture({capabilities:{email_delivery:'mock',real_email_enabled:false,development_only:true}});
  let lost = true;
  const adapter = createServiceAccountAdapter({request:async input => { const result = await f.request(input);
    if (input.path === '/v1/account/deletion' && lost) { lost = false; throw new Error('lost after commit'); } return result; }});
  await adapter.signIn({email,password}); await rejection(adapter.deleteAccount({password,confirmEmail:email,deliberate:true}),'transport_unavailable');
  assert.equal(adapter.snapshot().deletion_pending,true); assert.equal(adapter.snapshot().state,'outcome_unknown');
  await rejection(adapter.deleteAccount({password,confirmEmail:email,deliberate:true}),'deletion_unconfirmed');
  await rejection(adapter.create(metadata),'deletion_unconfirmed');
  await rejection(adapter.signIn({email,password}),'deletion_unconfirmed');
  assert.equal(f.calls.filter(value=>value.path==='/v1/account/deletion').length,1);
  await adapter.deletionStatus(); assert.equal(adapter.snapshot().state,'deleted');
  const status = f.calls.find(value=>value.path==='/v1/account/deletion/status'); assert.equal(status.headers.authorization,undefined);
});

test('malformed or mismatched deletion receipts never claim success and cancellation fences late deletion replies', async () => {
  for (const receipt of [{}, {operation_id:'other',account_id:'account:test',principal_id:'principal:test',deleted_at:1,
    development_only:true,email_reusable:true,retention:'historical_records_and_backups_preserved'}]) {
    const f = await fixture({capabilities:{email_delivery:'mock',real_email_enabled:false,development_only:true},
      intercept:input=>input.path==='/v1/account/deletion' ? reply({state:'deleted',receipt}) : null});
    const adapter = createServiceAccountAdapter({request:f.request}); await adapter.signIn({email,password});
    await assert.rejects(adapter.deleteAccount({password,confirmEmail:email,deliberate:true}));
    assert.equal(adapter.snapshot().state,'outcome_unknown'); assert.equal(adapter.snapshot().deletion_pending,true);
  }
  const f = await fixture({capabilities:{email_delivery:'mock',real_email_enabled:false,development_only:true}}), hold = gate(); let entered = false;
  const adapter = createServiceAccountAdapter({request:async input=>{ const result = await f.request(input);
    if (input.path==='/v1/account/deletion') { entered = true; await hold.promise; } return result; }});
  await adapter.signIn({email,password});
  const pending = adapter.deleteAccount({password,confirmEmail:email,deliberate:true}), refused = assert.rejects(pending);
  await waitFor(()=>entered); adapter.cancel(); hold.resolve(); await refused;
  assert.equal(adapter.snapshot().state,'outcome_unknown'); assert.equal(adapter.snapshot().deletion_pending,true);
  await adapter.deletionStatus(); assert.equal(adapter.snapshot().state,'deleted');
});

test('enrollment sends reviewed metadata, preserves exact retries and confirms without granting a session', async () => {
  const f = await fixture(), changes = [], adapter = createServiceAccountAdapter({request: f.request, onChange: value => changes.push(value)});
  await reviewedCreate(adapter,f); await reviewedCreate(adapter,f);
  const starts = f.calls.filter(value => value.path === '/v1/accounts/enrollments').map(value => JSON.parse(value.body));
  assert.deepEqual(starts[0], starts[1]); assert.equal(starts[0].revision, starts[0].reviewed_revision);
  assert.match(starts[0].registration_sha256, /^[a-f0-9]{64}$/); assert.equal(starts[0].operation_secret.length, 43);
  assert.equal(Buffer.from(starts[0].operation_secret, 'base64url').length, 32);
  await rejection(adapter.create({...metadata,username:'changed_review'}), 'operation_changed');
  await rejection(adapter.getAccount(), 'account_required'); await adapter.enrollmentStatus();
  await adapter.confirm({code: confirmation, deliberate: true}); assert.equal(adapter.snapshot().state, 'confirmed');
  await rejection(adapter.getAccount(), 'account_required');
  const recovery = recoveryBatch(adapter.recoveryCodes()), copied = adapter.recoveryCodes();
  assert.deepEqual(copied,recovery); assert.notEqual(copied,recovery); copied[0]='caller-mutation';
  assert.deepEqual(adapter.recoveryCodes(),recovery,'Showing recovery codes does not consume them or expose mutable retained state.');
  assert.equal(adapter.snapshot().recovery_code_available,true);
  adapter.clearRecoveryCodes(); assert.deepEqual(adapter.recoveryCodes(),[]);
  assert.equal(adapter.snapshot().recovery_code_available,false);
  const snapshots = JSON.stringify(changes);
  for (const secret of [password,starts[0].operation_secret,confirmation,...recovery]) assert.equal(snapshots.includes(secret),false);
});

test('a proved email creates the account without a second confirmation message', async () => {
  const f = await fixture({intercept:(input,{body}) => input.path === '/v1/accounts/enrollments'
    ? reply({account_id:'account:test',principal_id:'principal:test',login_name:'login:test',roles:['O','R'],confirmed:true,recovery_generation:0,username:body.username})
    : null});
  const adapter = createServiceAccountAdapter({request:f.request});
  await reviewedCreate(adapter,f);
  assert.equal(adapter.snapshot().state,'confirmed');
  assert.equal(f.calls.some(row => row.path === '/v1/accounts/enrollments/confirm' || row.path === '/v1/accounts/mock-mail'),false);
  const start = JSON.parse(f.calls.find(row => row.path === '/v1/accounts/enrollments').body);
  assert.equal(start.recovery_codes.length,8);
  assert.deepEqual(adapter.recoveryCodes(),start.recovery_codes);
});

test('signup requires confirmed email ownership, exact current terms and both account roles', async () => {
  const f = await fixture(), adapter = createServiceAccountAdapter({request:f.request});
  assert.deepEqual(await adapter.terms(),termsReceipt);
  await rejection(adapter.create(metadata),'email_entry_required');
  f.nextEntry('enrollment'); await adapter.startEntry({email}); await adapter.confirmEntry({code:entryConfirmation});
  await rejection(adapter.create({...metadata,email:'other@example.invalid'}),'email_entry_required');
  await rejection(adapter.create({...metadata,terms:{...acceptedTerms,version:'outdated'}}),'account_terms_changed');
  await rejection(adapter.create({...metadata,roles:['R']}),'account_input_invalid');
  assert.equal(f.calls.some(row=>row.path==='/v1/accounts/enrollments'),false);
  await adapter.create({...metadata,username:'  SYNTHETIC_PARTICIPANT  '});
  const body = JSON.parse(f.calls.find(row=>row.path==='/v1/accounts/enrollments').body);
  assert.equal(body.username,metadata.username); assert.equal(body.display_name,metadata.username);
  assert.deepEqual(body.terms,acceptedTerms); assert.deepEqual(Object.keys(body.entry_proof).sort(),['operation_id','operation_secret']);
  const snapshot = JSON.stringify(adapter.snapshot());
  for (const secret of Object.values(body.entry_proof)) assert.equal(snapshot.includes(secret),false);
});

test('lost confirmation and recovery replies retry the same private eight-code set', async () => {
  const f = await fixture(), changes = []; let loseConfirm=true, loseFinish=true;
  const adapter = createServiceAccountAdapter({onChange:value=>changes.push(value),request:async input=>{
    const response = await f.request(input);
    if (input.path==='/v1/accounts/enrollments/confirm' && loseConfirm) {loseConfirm=false;throw new Error('Lost fixture confirmation reply');}
    if (input.path==='/v1/accounts/recovery/finish' && loseFinish) {loseFinish=false;throw new Error('Lost fixture recovery reply');}
    return response;
  }});
  await reviewedCreate(adapter,f);
  await rejection(adapter.confirm({code:confirmation,deliberate:true}),'transport_unavailable');
  assert.deepEqual(adapter.recoveryCodes(),[]); assert.equal(adapter.snapshot().recovery_code_available,false);
  await adapter.confirm({code:confirmation,deliberate:true});
  const original = recoveryBatch(adapter.recoveryCodes());
  const confirmations = f.calls.filter(row=>row.path==='/v1/accounts/enrollments/confirm').map(row=>JSON.parse(row.body));
  assert.deepEqual(confirmations[0],confirmations[1]); assert.deepEqual(confirmations[0].recovery_codes,original);
  adapter.clearRecoveryCodes(); await adapter.startRecovery({email,recoveryCode:original[5]});
  await rejection(adapter.recover({code:confirmation,newPassword:'fern8?R4',deliberate:true}),'transport_unavailable');
  assert.deepEqual(adapter.recoveryCodes(),[]); assert.equal(adapter.snapshot().recovery_code_available,false);
  await adapter.recover({code:confirmation,newPassword:'fern8?R4',deliberate:true});
  const rotated = recoveryBatch(adapter.recoveryCodes());
  const finishes = f.calls.filter(row=>row.path==='/v1/accounts/recovery/finish').map(row=>JSON.parse(row.body));
  assert.deepEqual(finishes[0],finishes[1]); assert.deepEqual(finishes[0].new_recovery_codes,rotated);
  assert.ok(rotated.every(code=>!original.includes(code)));
  const snapshots = JSON.stringify(changes);
  for (const code of [...original,...rotated]) assert.equal(snapshots.includes(code),false);
});

test('cancellation fences late confirmation and recovery code sets', async () => {
  for (const kind of ['confirmation','recovery']) {
    const f = await fixture(), held=gate(), changes=[]; let path=null, entered=false;
    const adapter = createServiceAccountAdapter({onChange:value=>changes.push(value),request:async input=>{
      const result = await f.request(input); if (input.path===path) {entered=true;await held.promise;} return result;
    }});
    await reviewedCreate(adapter,f);
    if (kind==='recovery') {
      await adapter.confirm({code:confirmation,deliberate:true});
      const original=recoveryBatch(adapter.recoveryCodes()); adapter.clearRecoveryCodes();
      await adapter.startRecovery({email,recoveryCode:original[2]});
    }
    path = kind==='confirmation' ? '/v1/accounts/enrollments/confirm' : '/v1/accounts/recovery/finish';
    const pending = kind==='confirmation' ? adapter.confirm({code:confirmation,deliberate:true})
      : adapter.recover({code:confirmation,newPassword:'fern8?R4',deliberate:true});
    const refused=rejection(pending,'stale_operation'); await waitFor(()=>entered);
    adapter.cancel(); held.resolve(); await refused;
    assert.deepEqual(adapter.recoveryCodes(),[]); assert.equal(adapter.snapshot().recovery_code_available,false);
    const snapshots=JSON.stringify(changes); for (const code of f.recoveryCodes) assert.equal(snapshots.includes(code),false);
  }
  const f=await fixture(), adapter=createServiceAccountAdapter({request:f.request});
  await reviewedCreate(adapter,f); await adapter.confirm({code:confirmation,deliberate:true}); recoveryBatch(adapter.recoveryCodes());
  adapter.cancel(); assert.deepEqual(adapter.recoveryCodes(),[]); assert.equal(adapter.snapshot().recovery_code_available,false,
    'Cancellation also clears a code set already available on Ready.');
});

test('signup rejects changed term text and reports unavailable usernames without enrolling', async () => {
  const altered = structuredClone(ACCOUNT_TERMS); altered.sections[0].paragraphs[0] += ' Changed.';
  const changed = await fixture({intercept:input=>input.path==='/v1/accounts/terms'
    ? reply({terms:altered,content_sha256:createHash('sha256').update(JSON.stringify(altered)).digest('hex')}) : null});
  await rejection(createServiceAccountAdapter({request:changed.request}).terms(),'account_terms_changed');
  let unavailable = true;
  const f = await fixture({intercept:input=>input.path==='/v1/accounts/enrollments' && unavailable ? reply({error:'username_unavailable'},409) : null});
  const adapter = createServiceAccountAdapter({request:f.request});
  await rejection(reviewedCreate(adapter,f),'username_unavailable');
  assert.notEqual(adapter.snapshot().state,'signed_in');
  assert.equal(f.calls.filter(row=>row.path==='/v1/accounts/enrollments').length,1);
  for (const username of ['ab','1participant','participant name','éclair','a'.repeat(31)])
    await rejection(adapter.create({...metadata,username}),'username_invalid');
  assert.equal(f.calls.filter(row=>row.path==='/v1/accounts/enrollments').length,1);
  unavailable = false; await adapter.create({...metadata,username:'available_participant'});
  assert.equal(adapter.snapshot().state,'pending_confirmation');
  assert.equal(f.calls.filter(row=>row.path==='/v1/accounts/entry/start').length,1,'A refused username retains the confirmed email proof.');
  assert.equal(f.calls.filter(row=>row.path==='/v1/accounts/enrollments').length,2);
});

test('five password levels reject common, repeated and account-derived secrets before signup', async () => {
  const levels = [['',0],['short7!',1],[password,2],['深林渡月秋水山',1],['深林渡月秋水山光',2],['🦊🌿🗻🌊⭐🔥🌙🍃',2],
    ['violet meadow 83',2],['violet meadow 837 sun',3],
    ['violet meadow 837 sunlight',4],['violet meadow 837 sunlight river stone',5],
    ['Password1234567890!',1],['correct horse battery staple',1],['😀'.repeat(16),1],
    ['abcdefghijklmnopqrstuvwxyz',1],['synthetic_participant1234',1],['participant12345678',1]];
  for (const [value,level] of levels) {
    const result = passwordStrength(value,{username:metadata.username,email});
    assert.equal(result.level,level,`Unexpected password level for fixture ${levels.findIndex(row=>row[0]===value)}.`);
    assert.equal(result.acceptable,level>=2);
  }
  const hints = Object.fromEntries([
    ['length','moss7!Q'],['common','Password1234567890!'],['sequence','abcdefghijklmnop'],
    ['repetition','xyxyxyxy'],['username','synthetic_participant1234'],['email','participant12345678']
  ].map(([reason,value])=>[reason,passwordStrength(value,{username:metadata.username,email}).message]));
  assert.match(hints.length,/(?:8|eight).*characters|longer/i,'Short passwords need a length hint.');
  assert.match(hints.common,/common|easily guessed/i);
  assert.match(hints.sequence,/sequence|sequential|keyboard/i);
  assert.match(hints.repetition,/repeat/i);
  for (const reason of ['username','email']) {
    assert.match(hints[reason],/username|email|account (?:details|information)/i,'Account-derived passwords need account-details guidance.');
    for (const other of ['length','common','sequence','repetition']) assert.notEqual(hints[reason],hints[other]);
  }
  for (const reason of ['common','sequence','repetition']) assert.notEqual(hints[reason],hints.length,
    'Rejected passwords longer than eight characters need guidance beyond the minimum length.');
  const f = await fixture(), adapter = createServiceAccountAdapter({request:f.request});
  await rejection(adapter.create({...metadata,password:'Password1234567890!'}),'password_strength_required');
  assert.equal(f.calls.length,0);
});

test('new passwords count Unicode characters while legacy login retains its UTF-8 shape boundary', async () => {
  for (const value of ['moss7!Q','深林渡月秋水山']) {
    const f = await fixture(), adapter = createServiceAccountAdapter({request:f.request});
    assert.equal([...value].length,7);
    await rejection(adapter.create({...metadata,password:value}),'password_strength_required');
    assert.equal(f.calls.length,0,'Seven characters stop before discovery or credentials.');
    if (value === 'moss7!Q') await rejection(adapter.signIn({email,password:value}),'password_invalid');
  }
  for (const value of [password,'深林渡月秋水山光','🦊🌿🗻🌊⭐🔥🌙🍃','深林渡月秋水山','🦊🌿🗻🌊']) {
    assert.ok(new TextEncoder().encode(value).length>=8);
    const f = await fixture({password:value}), adapter = createServiceAccountAdapter({request:f.request});
    await adapter.signIn({email,password:value}); assert.equal(adapter.snapshot().state,'signed_in');
  }
  const unicode = Array.from({length:342},(_,index)=>String.fromCodePoint(0x4e00+index)).join('');
  assert.equal(passwordStrength([...unicode].slice(0,341).join('')).level,5,'1023 UTF-8 bytes remain valid.');
  assert.equal(passwordStrength(unicode).level,1,'1026 UTF-8 bytes exceed the retained maximum.');
  const f = await fixture(), adapter = createServiceAccountAdapter({request:f.request});
  await rejection(adapter.signIn({email,password:unicode}),'password_invalid'); assert.equal(f.calls.length,0);
});

test('email sign-in uses CSRF-bound S256 PKCE, verifies ES256/nonce and reads authoritative context each time', async () => {
  const f = await fixture(), changes = [], adapter = createServiceAccountAdapter({request: f.request, onChange: value => changes.push(value)});
  await adapter.signIn({email: ` ${email.toUpperCase()} `, password});
  assert.equal(adapter.snapshot().state, 'signed_in'); assert.equal(adapter.snapshot().session_outcome, 'active');
  const account = await adapter.getAccount(); await adapter.getAccount({expected: {account_id: account.account_id,
    principal_id: account.principal_id, recovery_generation: 0, current_session_id: account.current_session_id, role: 'operator'}});
  assert.equal(f.contextCalls, 3); assert.equal(account.identity_verification, 'pending');
  await rejection(adapter.getAccount({expected: {...account, current_session_id: 'other'}}), 'account_changed');
  account.roles.length = 0; assert.deepEqual((await adapter.getAccount()).roles, ['O', 'R']);
  const snapshots = JSON.stringify(changes);
  for (const marker of ['access-token-', 'refresh-token-', 'session:test', password, 'code_verifier']) assert.equal(snapshots.includes(marker), false);
  await adapter.signOut(); assert.equal(adapter.snapshot().session_outcome, 'revoked'); await rejection(adapter.getAccount(), 'account_required');
});

test('a stored resume record signs the same account back in after the page is gone', async () => {
  const items = new Map();
  const storage = {getItem:key => items.has(key) ? items.get(key) : null, setItem:(key,value) => items.set(key,String(value)), removeItem:key => items.delete(key)};
  const f = await fixture(), adapter = createServiceAccountAdapter({request:f.request, storage});
  storage.setItem('nonverba-session', '{"a":1}');
  await adapter.restore(); assert.equal(storage.getItem('nonverba-session'), null);
  await adapter.signIn({email, password});
  const saved = storage.getItem('nonverba-session');
  assert.equal(typeof saved, 'string'); assert.equal(saved.includes(password), false); assert.equal(saved.includes(email), false);
  adapter.discardSession(true); assert.equal(adapter.snapshot().state, 'signed_out'); assert.equal(storage.getItem('nonverba-session'), saved);
  const resumed = createServiceAccountAdapter({request:f.request, storage});
  assert.equal(resumed.snapshot().state, 'signed_out');
  await resumed.restore(); assert.equal(resumed.snapshot().state, 'signed_in'); assert.equal(resumed.snapshot().email, email);
  await resumed.signOut(); assert.equal(storage.getItem('nonverba-session'), null);
  const signedOut = createServiceAccountAdapter({request:f.request, storage});
  await signedOut.restore(); assert.equal(signedOut.snapshot().state, 'signed_out');
});

test('redirect/state, token signature/issuer/audience/nonce/expiry and current-session mismatches refuse login', async () => {
  const cases = [{redirect: value => value.replace('127.0.0.1', 'attacker.invalid')},
    {redirect: value => value.replace(/state=[^&]+/, 'state=wrong')}, {redirect: value => `${value}&code=duplicate`},
    {badSignature: true}, {header: {alg: 'HS256'}}, {claims: {iss: 'https://attacker.invalid'}},
    {claims: {aud: 'other-client'}}, {claims: {nonce: 'wrong'}}, {claims: {exp: 1}},
    {context: value => ({...value, principal_id: 'principal:other', identity: {issuer, subject: 'principal:other'}})},
    {context: value => ({...value, recovery_generation: Number.MAX_SAFE_INTEGER + 1})},
    {context: value => ({...value, current_session_id: 'other'})}];
  for (const options of cases) {
    const f = await fixture(options), adapter = createServiceAccountAdapter({request: f.request});
    await assert.rejects(adapter.signIn({email, password})); assert.notEqual(adapter.snapshot().state, 'signed_in');
    await rejection(adapter.getAccount(), 'account_required');
  }
});

test('refresh is single flight and an uncertain rotating refresh is never retried', async () => {
  const f = await fixture({shortAccess: true}), hold = gate(); let refreshing = false;
  const request = async input => { const response = await f.request(input);
    if (input.path === '/dev-oidc/token' && input.body.includes('grant_type=refresh_token')) { refreshing = true; await hold.promise; } return response; };
  const adapter = createServiceAccountAdapter({request}); await adapter.signIn({email, password});
  const first = adapter.getAccount(), second = adapter.getAccount(); await tick(); assert.equal(refreshing, true); assert.equal(f.refreshCalls, 1);
  hold.resolve(); await Promise.all([first, second]); assert.equal(f.refreshCalls, 1);
  const failed = await fixture({shortAccess: true, failRefresh: true});
  const uncertain = createServiceAccountAdapter({request: failed.request}); await uncertain.signIn({email, password});
  await rejection(uncertain.getAccount(), 'transport_unavailable'); assert.equal(uncertain.snapshot().session_outcome, 'unknown');
  await rejection(uncertain.getAccount(), 'account_required'); assert.equal(failed.refreshCalls, 1);
});

test('eight-character signup and two-factor recovery rotate the code and require fresh password sign-in', async () => {
  const f = await fixture(), adapter = createServiceAccountAdapter({request:f.request});
  await reviewedCreate(adapter,f); await adapter.confirm({code:confirmation,deliberate:true});
  const recoveryCodes = recoveryBatch(adapter.recoveryCodes()), recoveryCode = recoveryCodes[3];
  adapter.clearRecoveryCodes(); assert.equal([...password].length,8);
  await adapter.signIn({email,password});
  const original = await adapter.getAccount();
  await rejection(adapter.startRecovery({email}), 'confirmation_invalid');
  await adapter.startRecovery({email,recoveryCode}); await adapter.recoveryStatus();
  const newPassword = 'fern8?R4'; assert.equal([...newPassword].length,8);
  await adapter.recover({code:confirmation,newPassword,deliberate:true});
  assert.equal(adapter.snapshot().state, 'signed_out'); assert.equal(adapter.snapshot().recovery_generation, 1);
  const rotated = recoveryBatch(adapter.recoveryCodes());
  assert.ok(rotated.every(code=>!recoveryCodes.includes(code)),'Successful recovery rotates the entire previous code set.');
  for (const stale of recoveryCodes) {
    const other = createServiceAccountAdapter({request:f.request});
    await other.startRecovery({email,recoveryCode:stale});
    await rejection(other.recover({code:confirmation,newPassword:'lake7!W2',deliberate:true}),'recovery_factor_consumed');
    assert.deepEqual(other.recoveryCodes(),[]); assert.notEqual(other.snapshot().state,'signed_in');
  }
  adapter.clearRecoveryCodes();
  await rejection(adapter.getAccount(),'account_required');
  await rejection(adapter.signIn({email,password}),'invalid_authorization');
  await adapter.signIn({email,password:newPassword});
  const recovered = await adapter.getAccount(); assert.equal(recovered.account_id, original.account_id); assert.equal(recovered.recovery_generation, 1);
  assert.notEqual(recovered.current_session_id, original.current_session_id);
  await rejection(adapter.getAccount({expected: {recovery_generation: 0}}), 'account_changed');
});

test('a delayed denial for old access reuses a concurrently completed refresh', async () => {
  const f = await fixture(), hold = gate(); let trigger = false, held = false, oldAccess;
  const adapter = createServiceAccountAdapter({request: async input => {
    const response = await f.request(input);
    if (input.path === '/v1/account/context') {
      oldAccess ??= input.headers.authorization;
      if (trigger && input.headers.authorization === oldAccess) {
        if (!held) { held = true; await hold.promise; }
        return reply({error: 'invalid_authorization'}, 401);
      }
    }
    return response;
  }});
  await adapter.signIn({email, password}); trigger = true;
  const delayed = adapter.getAccount(); await waitFor(() => held);
  await adapter.getAccount(); assert.equal(f.refreshCalls, 1);
  hold.resolve(); await delayed; assert.equal(f.refreshCalls, 1);
});

test('cancel aborts transport, fences late login and preserves uncertain enrollment operation identity', async () => {
  const f = await fixture(), hold = gate(); let waiting = null;
  const adapter = createServiceAccountAdapter({request: async input => { const response = await f.request(input);
    if (input.path === '/dev-oidc/token') { waiting = input; await hold.promise; } return response; }});
  const signingIn = adapter.signIn({email, password});
  await waitFor(() => waiting); adapter.cancel(); assert.equal(waiting.signal.aborted, true); hold.resolve();
  await rejection(signingIn, 'stale_operation'); assert.notEqual(adapter.snapshot().state, 'signed_in');
  const pending = await fixture(), gateStart = gate(); let enrollmentInput;
  const owner = createServiceAccountAdapter({request: async input => { const response = await pending.request(input);
    if (input.path === '/v1/accounts/enrollments' && !enrollmentInput) { enrollmentInput = input; await gateStart.promise; } return response; }});
  const creating = reviewedCreate(owner,pending); await waitFor(() => enrollmentInput); owner.cancel(); gateStart.resolve();
  await rejection(creating, 'stale_operation'); assert.equal(owner.snapshot().operation_state, 'unknown');
  await owner.create(metadata);
  const bodies = pending.calls.filter(value => value.path === '/v1/accounts/enrollments').map(value => JSON.parse(value.body));
  assert.deepEqual(bodies[0], bodies[1]);
});

test('cancelled context and failed sign-out cannot fabricate revocation or expose raw service errors', async () => {
  const f = await fixture(), hold = gate(); let blockContext = false, pendingRead;
  const adapter = createServiceAccountAdapter({request: async input => {
    if (input.method === 'DELETE') throw new Error('private credential marker');
    const response = await f.request(input); if (blockContext && input.path === '/v1/account/context') { pendingRead = input; await hold.promise; } return response; }});
  await adapter.signIn({email, password}); const abort = new AbortController(); blockContext = true;
  const read = adapter.getAccount({signal: abort.signal}); await waitFor(() => pendingRead); abort.abort(); hold.resolve();
  await rejection(read, 'operation_aborted'); blockContext = false;
  await assert.rejects(adapter.signOut(), error => error.code === 'transport_unavailable' && !error.message.includes('private credential marker'));
  assert.equal(adapter.snapshot().session_outcome, 'unknown'); adapter.discardSession(); assert.equal(adapter.snapshot().session_outcome, 'local_only');
});

test('review gateway keeps credentials private, requires exact actor binding and passes server permission refusal', async () => {
  const f = await fixture({intercept:input=>input.path === '/v1/identity/reviewer/context'
    ? reply({error:'identity_reviewer_required'},403) : null});
  const adapter = createServiceAccountAdapter({request:f.request});
  assert.equal(adapter.reviewOwner(),null);
  await adapter.signIn({email,password});
  const expected = adapter.reviewOwner();
  assert.deepEqual(Object.keys(expected).sort(),['account_id','current_session_id','principal_id','recovery_generation']);
  await rejection(adapter.reviewRequest({method:'GET',path:'/v1/identity/reviewer/context'}),'identity_review_request_invalid');
  for (const path of ['/v1/account/context','/v1/identity/reviewer/cases?account=foreign','/v1/identity/reviewer/cases/case:test/photos/other'])
    await rejection(adapter.reviewRequest({method:'GET',path,expected}),'identity_review_request_invalid');
  const response = await adapter.reviewRequest({method:'GET',path:'/v1/identity/reviewer/context',expected});
  assert.equal(response.status,403); assert.equal(adapter.snapshot().state,'signed_in');
  const sent = f.calls.find(input=>input.path === '/v1/identity/reviewer/context');
  assert.match(sent.headers.authorization,/^Bearer /);
  assert.doesNotMatch(JSON.stringify(expected),/Bearer|access-token|refresh-token/);
});

test('review gateway discards delayed case replies after the reviewer session is forgotten', async () => {
  const held = gate(); let entered = false;
  const f = await fixture({intercept:async input=>{
    if (input.path !== '/v1/identity/reviewer/cases') return null;
    entered = true; await held.promise; return reply({scope:'synthetic-only',cases:[],has_more:false});
  }});
  const adapter = createServiceAccountAdapter({request:f.request});
  await adapter.signIn({email,password});
  const read = adapter.reviewRequest({method:'GET',path:'/v1/identity/reviewer/cases',expected:adapter.reviewOwner()});
  const refused = rejection(read,'stale_operation'); await waitFor(()=>entered);
  adapter.discardSession(); held.resolve(); await refused;
  assert.equal(adapter.reviewOwner(),null);
});

test('native review photo/detail bounds do not widen ordinary account responses', async t => {
  const previous = globalThis.window, sent = [], native = {postMessage:raw=>sent.push(JSON.parse(raw))};
  globalThis.window = {NonverbaAccount:native,addEventListener(){}};
  t.after(()=>{if (previous === undefined) delete globalThis.window; else globalThis.window=previous;});
  const transport = createAccountTransport();
  async function read(path,size,method='GET') {
    const pending = transport.request({method,path});
    const input = sent.at(-1);
    native.onmessage({data:JSON.stringify({id:input.id,response:{status:200,headers:{},body:'x'.repeat(size)}})});
    return pending;
  }
  assert.equal((await read('/v1/identity/reviewer/cases/case:test/photos/document_front',2*1024*1024)).body.length,2*1024*1024);
  assert.equal((await read('/v1/identity/reviewer/cases/case:test',128*1024)).body.length,128*1024);
  for (const path of ['/v1/identity/reviewer/context','/v1/identity/reviewer/cases','/v1/account/identity/review/status'])
    await assert.rejects(read(path,65537));
  await assert.rejects(read('/v1/identity/reviewer/cases/case:test',256*1024+1));
  await assert.rejects(read('/v1/identity/reviewer/cases/case:test/photos/other',128*1024));
});
