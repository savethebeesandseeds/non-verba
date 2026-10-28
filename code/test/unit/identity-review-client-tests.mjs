// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {workflowAccess} from '../../../web/apps/non-verba/src/participant.js';
import {IDENTITY_INTAKE_NOTICE as notice} from '../../../web/apps/non-verba/src/identity-intake-notice.js';

assert.equal(process.platform,'linux','Run only in the managed Debian container.');
assert.equal(process.env.NONVERBA_CONTAINER,'1','Use the managed container launcher.');
// Keep the packaged runtime alias intact. Resolve its two exact imports in RAM
// for Node; read the existing shared verifier rather than maintaining a copy.
const clientUrl = new URL('../../../web/apps/non-verba/src/identity-review-client.js',import.meta.url);
let source = await readFile(clientUrl,'utf8');
for (const [name,url] of [
  ['./identity-intake-notice.js',new URL('../../../web/apps/non-verba/src/identity-intake-notice.js',import.meta.url)],
  ['./identity/identity-capture-proof.js',new URL('../../../web/shared/identity/identity-capture-proof.js',import.meta.url)]
]) {
  assert.equal(source.split("'"+name+"'").length,2,'Resolve only the existing exact module import.');
  source = source.replace("'"+name+"'",JSON.stringify(url.href));
}
const {createIdentityReviewClient,validateReviewPermission,validateReviewList,validateReviewCase,
  validateReviewDecision,validateSubjectReview,validateReviewPhoto} = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const captureFixture = JSON.parse(await readFile(new URL('../fixtures/identity-capture-v1.json',import.meta.url),'utf8'));
const clone = value => structuredClone(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const owner = () => ({account_id:'account:reviewer',principal_id:'principal:reviewer',recovery_generation:0,current_session_id:'session:reviewer'});
const receipt = (submissionId = 'submission:one') => ({submission_id:submissionId,operation_id:'identity:'+'a'.repeat(43),
  status:'received',identity_verification:'pending',level:1,created_at:1});
const caseValue = (submissionId = 'submission:one',overrides = {}) => ({scope:'synthetic-only',submission_id:submissionId,
  account_id:'account:subject',receipt:receipt(submissionId),submission_sha256:'a'.repeat(64),receipt_sha256:'b'.repeat(64),
  details:{document_type:'passport',full_name:'Invented Person',birth_city:'Invented City',nationality:'Invented Country',age:30},
  notice:clone(notice),capture:{document_front:null,face_front:null},is_current:true,
  review:{status:'pending',revision:0,decision:null},history:[],history_has_more:false,...overrides});
const item = value => Object.fromEntries(['submission_id','account_id','receipt','submission_sha256','receipt_sha256','review'].map(key=>[key,clone(value[key])]));
const decision = (value,overrides = {}) => ({decision_id:'decision:one',submission_id:value.submission_id,
  submission_sha256:value.submission_sha256,receipt_sha256:value.receipt_sha256,revision:1,
  operation_id:'review:original',reviewer_principal_id:owner().principal_id,action:'approved',reason:'Synthetic fixture is readable.',
  created_at:2,scope:'synthetic-only',policy_id:'identity-review-synthetic-v1',...overrides});
const subject = (value = caseValue(),overrides = {}) => ({...owner(),scope:'synthetic-only',level_1:{status:'pending',receipt:clone(value.receipt),
  submission_sha256:value.submission_sha256,receipt_sha256:value.receipt_sha256,review_revision:0,decision:null,...overrides}});
const photo = (submissionId,kind) => {
  const bytes = Buffer.from(captureFixture.jpeg_base64,'base64');
  return {scope:'synthetic-only',submission_id:submissionId,kind,media_type:'image/jpeg',sha256:digest(bytes),size_bytes:bytes.length,base64:bytes.toString('base64')};
};
const reply = (value,status = 200) => ({status,body:JSON.stringify(value),headers:{'content-type':'application/json'}});
const deferred = () => { let resolve; const promise = new Promise(done=>resolve=done); return {promise,resolve}; };
const rejected = callback => assert.throws(callback,error=>error.code === 'identity_review_response_invalid');
const assessment = source => ({signature_valid:true,exact_image_bound:true,original_request_bound:true,source,hardware_attested:false,
  native_origin_attested:false,browser_origin_attested:false,capture_time_trusted:false,identity_verified:false});
function fixture(intercept = () => undefined) {
  let current = owner(), serial = 0;
  const requests = [], created = [], revoked = [], cases = new Map([['submission:one',caseValue()],['submission:two',caseValue('submission:two')]]), operations = new Map();
  const urls = {createObjectURL(blob) { assert.equal(blob.type,'image/jpeg'); const url = 'blob:synthetic-'+(++serial); created.push(url); return url; },
    revokeObjectURL(url) { revoked.push(url); }};
  const gateway = {owner:()=>current,async request(input) {
    assert.deepEqual(input.expected,current,'Every endpoint is actor-bound.');
    assert.equal(input.signal instanceof AbortSignal,true);
    requests.push({method:input.method,path:input.path,body:clone(input.body),expected:clone(input.expected)});
    const result = await intercept(input,{cases,operations}); if (result !== undefined) return result;
    if (input.path === '/v1/identity/reviewer/context') return reply({scope:'synthetic-only',can_review:true,...current});
    if (input.path === '/v1/identity/reviewer/cases') return reply({scope:'synthetic-only',cases:[...cases.values()].filter(value=>value.is_current && value.review.status === 'pending').map(item),has_more:false});
    if (input.path === '/v1/account/identity/review/status') return reply(subject());
    const match = input.path.match(/^\/v1\/identity\/reviewer\/cases\/([^/]+)(?:\/(photos|decisions|operations)(?:\/(.+))?)?$/);
    assert.ok(match,'Only exact published routes are requested.');
    const value = cases.get(match[1]); if (!value) return reply({error:'identity_review_case_not_found'},404);
    if (match[2] === 'photos') return reply(photo(value.submission_id,match[3]));
    if (match[2] === 'decisions') {
      const stored = decision(value,{...input.body,decision_id:'decision:'+input.body.operation_id,revision:input.body.expected_revision+1});
      delete stored.expected_revision;
      operations.set(input.body.operation_id,stored); value.review = {status:stored.action,revision:stored.revision,decision:clone(stored)};
      value.history.unshift(clone(stored)); return reply(stored);
    }
    if (match[2] === 'operations') return operations.has(match[3]) ? reply(operations.get(match[3])) : reply({error:'identity_review_case_not_found'},404);
    return reply(value);
  }};
  const client = createIdentityReviewClient({gateway,urls,crypto:{subtle:webcrypto.subtle,randomUUID:()=>`00000000-0000-4000-8000-${(++serial).toString(16).padStart(12,'0')}`}});
  return {client,requests,created,revoked,cases,operations,setOwner:value=>{current=value;}};
}

test('reviewer permission and pending list are closed, owner-bound, bounded and deny self-review', () => {
  const context = {scope:'synthetic-only',can_review:true,...owner()};
  assert.equal(validateReviewPermission(context,owner()).can_review,true);
  for (const change of [{can_review:false},{scope:'public'},{current_session_id:'session:other'},{extra:true}]) rejected(()=>validateReviewPermission({...context,...change},owner()));
  const list = {scope:'synthetic-only',cases:[item(caseValue())],has_more:false};
  assert.equal(validateReviewList(list,owner()).cases.length,1);
  for (const changed of [{...list,cases:[item(caseValue('submission:one',{account_id:owner().account_id}))]},
    {...list,cases:[list.cases[0],list.cases[0]]},{...list,cases:Array.from({length:21},(_,i)=>item(caseValue('submission:'+i)))},
    {...list,cases:[{...list.cases[0],email:'not-a-directory@example.invalid'}]}]) rejected(()=>validateReviewList(changed,owner()));
});

test('case notice, history, revision and exact receipt commitments cannot be substituted', async () => {
  const value = caseValue(), stored = decision(value);
  value.review = {status:'approved',revision:1,decision:stored}; value.history = [Object.fromEntries(Object.entries(stored).reverse())];
  assert.equal((await validateReviewCase(value,owner(),value.submission_id,webcrypto)).review.status,'approved');
  for (const mutate of [value=>{value.notice.text+=' ';},value=>{value.notice.version=2;},value=>{value.notice.sha256='c'.repeat(64);},
    value=>{value.receipt.submission_id='submission:other';},value=>{value.review.decision.receipt_sha256='c'.repeat(64);},
    value=>{value.history=[];},value=>{value.history_has_more=true;},value=>{value.details.extra='hidden';},
    value=>{value.history[0].revision=2;}]) {
    const bad = clone(value); mutate(bad); await assert.rejects(validateReviewCase(bad,owner(),bad.submission_id,webcrypto));
  }
});

test('retained browser/native proof records validate exact historical signatures and assessments without a live clock', async () => {
  const originalNow = Date.now;
  try {
    for (const retained of captureFixture.cases) {
      Date.now = () => retained.proof.payload.request.submit_expires_at_ms+1;
      const value = caseValue('submission:retained',{account_id:'account:fixture',capture:{document_front:{proof:clone(retained.proof),assessment:assessment(retained.source)},face_front:null}});
      await validateReviewCase(value,owner(),value.submission_id,webcrypto);
      for (const mutate of [value=>{value.capture.document_front.assessment.identity_verified=true;},
        value=>{value.capture.document_front.assessment.extra=true;},value=>{value.capture.document_front.proof.payload.width++;},
        value=>{value.capture.document_front.proof.payload.request.extra=true;},
        value=>{value.capture.document_front.proof.payload.acquisition={};}]) {
        const bad = clone(value); mutate(bad); await assert.rejects(validateReviewCase(bad,owner(),bad.submission_id,webcrypto));
      }
    }
  } finally { Date.now = originalNow; }
});

test('photos require exact-case canonical JPEG bytes, bounded size, matching digest and retained proof binding', async () => {
  const value = photo('submission:one','document_front'), target = {submission_id:value.submission_id,kind:value.kind};
  assert.equal((await validateReviewPhoto(value,target,webcrypto)).byteLength,value.size_bytes);
  for (const changed of [{...value,submission_id:'submission:other'},{...value,kind:'face_front'},{...value,media_type:'image/png'},
    {...value,sha256:'c'.repeat(64)},{...value,size_bytes:value.size_bytes+1},{...value,size_bytes:2097153},
    {...value,base64:value.base64+'\n'},{...value,base64:'AAAA',size_bytes:3},{...value,extra:true}]) {
    await assert.rejects(validateReviewPhoto(changed,target,webcrypto));
  }
  await assert.rejects(validateReviewPhoto(value,{...target,capture:{proof:{payload:{image_sha256:'c'.repeat(64),image_bytes:value.size_bytes}}}},webcrypto));
});

test('subject outcomes stay owner-bound and omit restricted audit attribution without granting workflows', () => {
  const value = caseValue(), stored = decision(value); delete stored.operation_id; delete stored.reviewer_principal_id;
  for (const status of ['approved','rejected','needs_correction']) {
    const summary = subject(value,{status,review_revision:1,decision:{...stored,action:status}});
    assert.equal(validateSubjectReview(summary,owner()).level_1.status,status);
    for (const route of ['requester','operations/new','operator/offer']) assert.equal(workflowAccess(route,{state:'signed_in',identity_review:summary}).allowed,false);
  }
  for (const changed of [{...subject(),current_session_id:'session:other'},subject(value,{status:'approved',review_revision:1,decision:{...stored,reviewer_principal_id:'principal:leak'}}),
    subject(value,{status:'not_submitted'}),subject(value,{status:'pending',review_revision:1})]) rejected(()=>validateSubjectReview(changed,owner()));
  rejected(()=>validateReviewDecision({...decision(value),identity_verified:true},{target:value}));
});

test('entry fails closed, never loads a queue before permission and safely settles absent owners', async () => {
  for (const status of [401,403,404,503]) {
    const f = fixture(input=>input.path.endsWith('/context') ? reply({error:status === 403 ? 'identity_reviewer_required' : 'identity_review_unavailable'},status) : undefined);
    const state = await f.client.loadCases();
    assert.notEqual(state.permission,'granted'); assert.equal(f.requests.length,1); assert.deepEqual(state.entries,[]);
  }
  const f = fixture(); f.setOwner(null);
  for (const method of ['permission','loadCases','subjectStatus','checkOriginal']) await f.client[method]();
  assert.equal(f.requests.length,0); assert.equal(f.client.snapshot().subject,null);
});

test('only selected-case media is loaded and route departure releases URLs without storing media in snapshots', async () => {
  const f = fixture(); await f.client.loadCases();
  assert.equal(f.requests.some(value=>value.path.includes('/photos/')),false);
  let state = await f.client.selectCase('submission:one');
  assert.equal(state.canDecide,true); assert.equal(state.selected.photos.length,2);
  assert.equal(state.selected.notice.text,notice.text); assert.equal(JSON.stringify(state).includes('base64'),false);
  const first = [...f.created]; await f.client.selectCase('submission:two');
  assert.deepEqual(f.revoked,first); assert.equal(f.client.snapshot().selected.key,'submission:two');
  f.client.clear(); assert.deepEqual(f.revoked,f.created); assert.equal(f.client.snapshot().permission,'granted');
  state = await f.client.loadCases(); assert.equal(state.phase,'ready');
  assert.equal(f.requests.filter(value=>value.path.endsWith('/context')).length,2,'Re-entry refreshes permission.');
});

test('late case/photo reads cannot restore a prior selection or a changed/revoked actor', async () => {
  for (const changeOwner of [false,true]) {
    const held = deferred(), entered = deferred();
    const f = fixture(async input=>{if(input.path.endsWith('/submission:one/photos/document_front')) {entered.resolve();return held.promise;}});
    await f.client.loadCases(); const earlier = f.client.selectCase('submission:one'); await entered.promise;
    if (changeOwner) f.setOwner({...owner(),recovery_generation:1}); else await f.client.selectCase('submission:two');
    held.resolve(reply(photo('submission:one','document_front'))); await earlier;
    const state = f.client.snapshot();
    assert.equal(state.selected?.key ?? null,changeOwner ? null : 'submission:two');
    assert.equal(f.created.length,changeOwner ? 0 : 2);
  }
});

test('decisions require deliberate bounded reasons and bind the exact immutable case/revision before writing', async () => {
  const f = fixture(); await f.client.loadCases(); await f.client.selectCase('submission:one');
  for (const input of [{action:'approved',reason:''},{action:'approved',reason:'x',deliberate:false},
    {action:'verified',reason:'x',deliberate:true},{action:'approved',reason:'x\nY',deliberate:true},
    {action:'approved',reason:'😀'.repeat(501),deliberate:true}]) await f.client.decide(input);
  assert.equal(f.requests.filter(value=>value.method==='POST').length,0);
  const state = await f.client.decide({action:'approved',reason:'  '+'😀'.repeat(500)+'  ',deliberate:true});
  const write = f.requests.find(value=>value.method==='POST');
  assert.deepEqual(Object.keys(write.body).sort(),['operation_id','submission_sha256','receipt_sha256','expected_revision','action','reason'].sort());
  assert.equal(write.body.expected_revision,0); assert.equal(write.body.submission_sha256,'a'.repeat(64));
  assert.equal([...write.body.reason].length,500); assert.equal(state.phase,'saved'); assert.equal(state.canDecide,false);
  assert.equal(state.lastDecision.action,'approved'); assert.equal(state.selected.photos.length,0); assert.deepEqual(f.revoked,f.created);
});

test('unknown decisions retain one exact operation across route exit and only GET its immutable historical result', async () => {
  const f = fixture((input,{cases,operations})=>{
    if (input.method === 'POST') {
      operations.set(input.body.operation_id,decision(cases.get('submission:one'),{operation_id:input.body.operation_id,action:input.body.action,reason:input.body.reason}));
      return Promise.reject(new Error('Synthetic lost reply'));
    }
  });
  await f.client.loadCases(); await f.client.selectCase('submission:one');
  let state = await f.client.decide({action:'needs_correction',reason:'Synthetic image needs correction.',deliberate:true});
  assert.equal(state.phase,'unknown'); assert.equal(state.pendingOperation,true);
  const count = f.requests.length; await f.client.loadCases(); await f.client.selectCase('submission:two');
  assert.equal(f.requests.length,count,'No competing case or replacement write starts while the original is unknown.');
  f.client.clear({preserveOperation:true}); assert.equal(f.client.snapshot().pendingOperation,true);
  f.cases.get('submission:one').is_current=false;
  state = await f.client.checkOriginal();
  assert.equal(f.requests.filter(value=>value.method==='POST').length,1); assert.equal(f.requests.at(-1).method,'GET');
  assert.match(f.requests.at(-1).path,/\/submission:one\/operations\/review:/);
  assert.equal(state.phase,'saved'); assert.equal(state.pendingOperation,false); assert.equal(state.lastDecision.revision,1);
  assert.equal(state.canDecide,false); assert.equal(state.selected.title,'Recorded test decision');
});

test('conflicts require intentional refresh, while unknown lookup failures never infer an unstored decision', async () => {
  for (const status of [404,409,503]) {
    const f = fixture(input=>input.method === 'POST' ? status === 409 ? reply({error:'identity_review_revision_conflict'},409) : Promise.reject(new Error('lost'))
      : input.path.includes('/operations/') ? reply({error:'identity_review_case_not_found'},status) : undefined);
    await f.client.loadCases(); await f.client.selectCase('submission:one');
    let state = await f.client.decide({action:'rejected',reason:'Synthetic package is incomplete.',deliberate:true});
    if (status === 409) { assert.equal(state.phase,'conflict'); assert.equal(state.pendingOperation,false); assert.equal(state.canDecide,false); }
    else { state=await f.client.checkOriginal(); assert.equal(state.phase,'unknown'); assert.equal(state.pendingOperation,true); }
    assert.equal(f.requests.filter(value=>value.method==='POST').length,1);
  }
});

test('subject-only latest-read fences prevent stale summaries and failures from damaging the reviewer case', async () => {
  const held = deferred(), entered = deferred(); let hold = true;
  const f = fixture(async input=>{if(input.path === '/v1/account/identity/review/status' && hold) {hold=false;entered.resolve();return held.promise;}});
  const earlier=f.client.subjectStatus(); await entered.promise;
  await f.client.subjectStatus(); await f.client.loadCases(); await f.client.selectCase('submission:two');
  held.resolve(reply({error:'identity_review_unavailable'},503)); await earlier;
  const state=f.client.snapshot(); assert.equal(state.subject.level_1.status,'pending'); assert.equal(state.selected.key,'submission:two');
  assert.equal(state.selected.photos.length,2); assert.equal(state.canDecide,true); assert.equal(f.revoked.length,0);
});

test('a fresh subject read clears the previous package outcome before its replacement summary arrives', async () => {
  const held=deferred(),entered=deferred(); let delay=false;
  const f=fixture(async input=>{if(delay && input.path === '/v1/account/identity/review/status') {entered.resolve();return held.promise;}});
  await f.client.subjectStatus(); assert.equal(f.client.snapshot().subject.level_1.status,'pending');
  delay=true; const read=f.client.subjectStatus(); await entered.promise;
  assert.equal(f.client.snapshot().subject,null,'A prior package outcome is not displayed as the new package state.');
  held.resolve(reply(subject(caseValue('submission:replacement')))); await read;
  assert.equal(f.client.snapshot().subject.level_1.receipt.submission_id,'submission:replacement');
});

test('ordinary reviewer denial cannot abort or erase an independent own-subject summary', async () => {
  const held=deferred(),entered=deferred(); let signal;
  const f=fixture(async input=>{
    if(input.path === '/v1/account/identity/review/status') {signal=input.signal;entered.resolve();return held.promise;}
    if(input.path.endsWith('/context')) return reply({error:'identity_reviewer_required'},403);
  });
  const pending=f.client.subjectStatus(); await entered.promise; await f.client.permission();
  assert.equal(signal.aborted,false); held.resolve(reply(subject())); await pending;
  const state=f.client.snapshot(); assert.equal(state.permission,'denied'); assert.equal(state.subject.level_1.status,'pending');
});

test('a cleared in-flight decision preserves only its unknown original operation and fences the late acknowledgement', async () => {
  const held=deferred(),entered=deferred();let posted;
  const f=fixture(async input=>{if(input.method === 'POST') {posted=input.body;entered.resolve();return held.promise;}});
  await f.client.loadCases(); await f.client.selectCase('submission:one');
  const pending=f.client.decide({action:'approved',reason:'Synthetic fixture is readable.',deliberate:true});await entered.promise;
  f.client.clear({preserveOperation:true});
  held.resolve(reply(decision(caseValue(),{operation_id:posted.operation_id})));await pending;
  const state=f.client.snapshot();assert.equal(state.phase,'unknown');assert.equal(state.pendingOperation,true);
  assert.equal(state.lastDecision,null);assert.deepEqual(state.selected.photos,[]);assert.deepEqual(state.selected.facts,[]);
  assert.deepEqual(f.revoked,f.created);assert.equal(f.requests.filter(value=>value.method==='POST').length,1);
});

test('permission revocation clears reviewer media and decisions while owner changes also erase own-subject outcomes', async () => {
  let denied=false; const f=fixture(input=>denied && input.path.endsWith('/context') ? reply({error:'identity_reviewer_required'},403) : undefined);
  await f.client.loadCases(); await f.client.selectCase('submission:one'); await f.client.subjectStatus();
  denied=true; await f.client.permission();
  let state=f.client.snapshot(); assert.equal(state.permission,'denied'); assert.equal(state.selected,null); assert.equal(state.subject.level_1.status,'pending');
  assert.deepEqual(f.revoked,f.created); assert.equal(state.canDecide,false);
  f.setOwner({...owner(),current_session_id:'session:new'}); state=f.client.snapshot();
  assert.equal(state.permission,'unknown'); assert.equal(state.pendingOperation,false); assert.equal(state.lastDecision,null);assert.equal(state.subject,null);
});
