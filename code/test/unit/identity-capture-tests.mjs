// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {canonicalIdentityCapturePayload} from '../../../web/shared/identity/identity-capture-proof.js';
import {IdentityCaptureWorkflow, inspectIdentityImage, IDENTITY_CAPTURE_GUIDANCE,
  IDENTITY_CAPTURE_LIMITS} from '../../../web/shared/identity/identity-capture.js';

// Deliberately incomplete encoded fixtures isolate header, byte and workflow
// checks. The injected decoder supplies dimensions; Chromium integration owns
// successful decoding of actual generated images and physical capture remains
// a separate platform check.
function png(width = 640, height = 480) {
  const bytes = new Uint8Array(33); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  const data = new DataView(bytes.buffer); data.setUint32(16, width); data.setUint32(20, height);
  bytes[24] = 8; bytes[25] = 2; return new Blob([bytes], {type: 'image/png'});
}
function jpeg(width = 640, height = 480) {
  return new Blob([new Uint8Array([255, 216, 255, 192, 0, 11, 8, height >> 8, height & 255,
    width >> 8, width & 255, 1, 1, 17, 0, 255, 217])], {type: 'image/jpeg'});
}
const currentAccount = (overrides = {}) => ({account_id: 'account:a', principal_id: 'principal:a',
  current_session_id: 'session:a', session_active: true, confirmed: true, roles: ['R', 'O'], recovery_generation: 0, ...overrides});
function gate() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return {resolve, promise}; }
function setup({account = currentAccount(), inspectImage = async () => ({width: 640, height: 480}),
  prepareImage,submitIdentity,identitySubmissionStatus} = {}) {
  let current = account, serial = 0;
  const created = [], revoked = [], expected = [];
  const workflow = new IdentityCaptureWorkflow({getAccount: async options => {
    expected.push(structuredClone(options.expected));
    if (current instanceof Error) throw current;
    return current;
  }, inspectImage,prepareImage,submitIdentity,identitySubmissionStatus,
  createObjectURL: blob => { assert.ok(blob instanceof Blob); const url = `blob:isolated-${++serial}`; created.push(url); return url; },
  revokeObjectURL: url => revoked.push(url)});
  return {workflow, created, revoked, expected, setAccount: value => { current = value; }};
}
const deliberateFile = {source: 'file', deliberate: true};
async function begin(workflow, role = 'requester') {
  await workflow.begin(role); await workflow.setProcessingConsent(true);
}
const details = {document_type:'passport',full_name:'Synthetic Person',birth_city:'Test City',nationality:'Test Nationality',age:30};
async function ready(workflow) {
  await begin(workflow); workflow.setDetails(details); await workflow.select('document_front', png(), deliberateFile);
  for (const step of IDENTITY_CAPTURE_GUIDANCE) await workflow.setGuidance(step);
  await workflow.select('face_front', png(), deliberateFile);
}
const refuses = (promise, code) => assert.rejects(promise, error => error.code === code);

test('actual capture requires current confirmed account, declared role, active session and safe generation', async () => {
  for (const account of [null, currentAccount({confirmed: false}), currentAccount({session_active: false}),
    currentAccount({current_session_id: ''}), currentAccount({recovery_generation: -1}),
    currentAccount({recovery_generation: Number.MAX_SAFE_INTEGER + 1}), currentAccount({roles: ['O']})]) {
    const f = setup({account}); await refuses(f.workflow.begin('requester'), 'account_required');
    assert.equal(f.workflow.snapshot().binding, null); assert.equal(f.workflow.snapshot().blocker.code, 'account_unavailable');
  }
  for (const role of ['requester', 'operator']) {
    const f = setup({account: currentAccount({recovery_generation: Number.MAX_SAFE_INTEGER})});
    await begin(f.workflow, role); assert.equal(f.workflow.snapshot().binding.role, role);
  }
});

test('PNG/JPEG signature, byte limit and encoded pixel bounds precede expensive decoding', async () => {
  let decodes = 0;
  const decoder = async () => { decodes++; return {width: 640, height: 480}; };
  for (const blob of [new Blob(['<svg/>'], {type: 'image/svg+xml'}), new Blob(['not a photo'], {type: 'image/jpeg'}),
    new Blob([await png().arrayBuffer()], {type: 'image/jpeg'}), png(0, 640), png(8193, 1), png(5000, 5000),
    new Blob([new Uint8Array(IDENTITY_CAPTURE_LIMITS.maxBytes + 1)], {type: 'image/png'})]) {
    await assert.rejects(inspectIdentityImage(blob, {decodeImage: decoder}));
  }
  assert.equal(decodes, 0);
  assert.equal((await inspectIdentityImage(png(), {decodeImage: decoder})).media_type, 'image/png');
  assert.equal((await inspectIdentityImage(jpeg(), {decodeImage: decoder})).media_type, 'image/jpeg');
  assert.equal(decodes, 2);
});

test('decoder failure or dimension disagreement refuses image; rotated JPEG is explicit', async () => {
  await refuses(inspectIdentityImage(png(), {decodeImage: async () => ({width: 1, height: 1})}), 'image_dimensions_mismatch');
  await refuses(inspectIdentityImage(png(), {decodeImage: async () => ({width: 480, height: 640})}), 'image_dimensions_mismatch');
  await refuses(inspectIdentityImage(png(), {decodeImage: async () => ({width: 640.5, height: 480})}), 'image_dimensions');
  await refuses(inspectIdentityImage(png(), {decodeImage: async () => { throw new Error('unsupported'); }}), 'image_decode_failed');
  const rotated = await inspectIdentityImage(jpeg(), {decodeImage: async () => ({width: 480, height: 640})});
  assert.equal(rotated.width, 480); assert.equal(rotated.height, 640); assert.match(rotated.sha256, /^[a-f0-9]{64}$/);
});

test('deliberate capture entry enables preparation; deliberate source and confirmed camera stop are required', async () => {
  const {workflow: w, created} = setup(); await w.begin('requester');
  await w.validate();
  await w.setProcessingConsent(false);
  await refuses(w.validate(), 'processing_consent_required');
  await refuses(w.select('document_front', png(), deliberateFile), 'processing_consent_required');
  await w.setProcessingConsent(true); await w.validate();
  await assert.rejects(w.select('document_front', png(), {source: 'file'}));
  await refuses(w.select('document_front', png(), {source: 'camera', deliberate: true}), 'camera_not_stopped');
  await refuses(w.select('document_front', png(), {source: 'camera', deliberate: true, cleanup: 'unknown'}), 'camera_not_stopped');
  await w.select('document_front', jpeg(), {source: 'camera', deliberate: true, cleanup: 'stopped'});
  assert.equal(w.snapshot().items[0].source, 'camera'); assert.equal(created.length, 1);
});

test('ordered face guidance or explicit accessibility skip enables a frontal image without assurance', async () => {
  for (const skip of [false, true]) {
    const {workflow: w} = setup(); await begin(w);
    await refuses(w.select('face_front', png(), deliberateFile), 'guidance_required');
    await refuses(w.setGuidance('front'), 'guidance_order');
    if (skip) await w.setGuidance('skipped');
    else for (const step of IDENTITY_CAPTURE_GUIDANCE) await w.setGuidance(step);
    await w.select('face_front', png(), deliberateFile);
    const state = w.snapshot(); assert.equal(state.guidance.complete, !skip); assert.equal(state.guidance.skipped, skip);
    assert.equal(state.movement_check, 'not_performed'); assert.equal(state.liveness, 'not_evaluated');
    assert.equal(state.identity_verified, false); assert.equal(state.verification.decision, null);
  }
});

test('review binds the exact image revision and every successful edit invalidates it', async () => {
  const {workflow: w} = setup(); await ready(w);
  await refuses(w.review(), 'review_required'); await w.review({deliberate: true});
  const first = w.snapshot(); assert.equal(first.status, 'reviewed'); assert.equal(first.reviewed_revision, first.revision);
  await w.select('document_front', jpeg(), deliberateFile);
  assert.equal(w.snapshot().status, 'ready'); assert.equal(w.snapshot().reviewed_revision, null);
  assert.ok(w.snapshot().revision > first.revision);
  await w.review({deliberate: true}); await w.remove('document_front');
  assert.equal(w.snapshot().status, 'incomplete'); assert.equal(w.snapshot().reviewed_revision, null);
  await refuses(w.review({deliberate: true}), 'review_required');
});

test('snapshots and notifications never include image bytes, URLs, file names or account adapter secrets', async () => {
  const f = setup({account: currentAccount({email: 'private@example.invalid', password: 'private-password', access_token: 'private-token'})});
  await ready(f.workflow); await f.workflow.review({deliberate: true});
  const snapshot = f.workflow.snapshot(), json = JSON.stringify(snapshot);
  assert.ok(snapshot.items.every(item => item.sha256 && item.byte_length && item.width && item.height));
  for (const secret of ['blob:', 'data:', 'private@example.invalid', 'private-password', 'private-token', 'session:a']) assert.ok(!json.includes(secret));
  assert.equal(snapshot.custody, 'transient_memory_only'); assert.equal(snapshot.retained, false); assert.equal(snapshot.submitted, false);
  assert.equal(snapshot.consent.retention, false); assert.ok(f.workflow.preview('document_front').startsWith('blob:'));
  snapshot.items[0].width = 7; assert.equal(f.workflow.snapshot().items[0].width, 640);
});

test('replacing/removing images, withdrawing consent and cancellation revoke only owned object URLs', async () => {
  const f = setup(); await ready(f.workflow);
  const document = f.workflow.preview('document_front'), face = f.workflow.preview('face_front');
  await f.workflow.select('document_front', jpeg(), deliberateFile); assert.deepEqual(f.revoked, [document]);
  await f.workflow.remove('face_front'); assert.deepEqual(f.revoked, [document, face]);
  await f.workflow.setProcessingConsent(false); assert.equal(f.workflow.preview('document_front'), null);
  assert.deepEqual(f.revoked, [document, face, f.created[2]]); assert.equal(f.workflow.snapshot().items.length, 0);
  f.workflow.cancel(); f.workflow.release(); assert.equal(f.revoked.length, 3); assert.equal(f.workflow.snapshot().status, 'cancelled');
});

test('exact account/principal/session/generation or role changes clear captured material before camera validation', async () => {
  for (const changed of [{account_id: 'account:b'}, {principal_id: 'principal:b'}, {current_session_id: 'session:b'},
    {recovery_generation: 1}, {roles: ['O']}, {session_active: false}]) {
    const f = setup(); await ready(f.workflow); f.setAccount(currentAccount(changed));
    await assert.rejects(f.workflow.validate());
    assert.equal(f.workflow.snapshot().binding, null); assert.equal(f.workflow.snapshot().items.length, 0);
    assert.equal(f.revoked.length, 2); assert.equal(f.workflow.snapshot().consent.processing, false);
    assert.deepEqual(f.expected[1], {account_id: 'account:a', principal_id: 'principal:a', role: 'requester', recovery_generation: 0, current_session_id: 'session:a'});
  }
});

test('account service failure clears local authority and media without claiming remote deletion', async () => {
  const f = setup(); await ready(f.workflow); f.setAccount(new Error('offline'));
  await assert.rejects(f.workflow.review({deliberate: true}), /offline/);
  const state = f.workflow.snapshot(); assert.equal(state.blocker.code, 'account_unavailable');
  assert.equal(state.status, 'incomplete'); assert.equal(state.binding, null); assert.equal(f.revoked.length, 2);
  assert.equal(state.retained, false); assert.equal(state.submitted, false);
});

test('cancel during image decode fences late pixels and cannot recreate a preview URL', async () => {
  const decoding = gate(), entered = gate();
  const f = setup({inspectImage: async () => { entered.resolve(); await decoding.promise; return {width: 640, height: 480}; }});
  await begin(f.workflow); const selecting = f.workflow.select('document_front', png(), deliberateFile);
  await entered.promise; f.workflow.cancel(); decoding.resolve(); await refuses(selecting, 'capture_cancelled');
  assert.equal(f.workflow.snapshot().status, 'cancelled'); assert.equal(f.workflow.snapshot().items.length, 0); assert.equal(f.created.length, 0);
});

test('a changed account while decoding clears previous images and refuses the late selection', async () => {
  const decoding = gate(), entered = gate(); let delay = false;
  const f = setup({inspectImage: async () => { if (delay) { entered.resolve(); await decoding.promise; } return {width: 640, height: 480}; }});
  await ready(f.workflow); delay = true;
  const selecting = f.workflow.select('document_front', jpeg(), deliberateFile); await entered.promise;
  f.setAccount(currentAccount({recovery_generation: 1})); decoding.resolve(); await refuses(selecting, 'account_changed');
  assert.equal(f.created.length, 2); assert.equal(f.revoked.length, 2); assert.equal(f.workflow.snapshot().binding, null);
});

test('a newer selection fences an older decode without losing the current selected image', async () => {
  const decoding = gate(), entered = gate(); let calls = 0;
  const f = setup({inspectImage: async () => { if (++calls === 1) { entered.resolve(); await decoding.promise; } return {width: 640, height: 480}; }});
  await begin(f.workflow); const old = f.workflow.select('document_front', png(), deliberateFile); await entered.promise;
  await f.workflow.select('document_front', jpeg(), deliberateFile); decoding.resolve(); await refuses(old, 'capture_cancelled');
  assert.equal(f.workflow.snapshot().items[0].media_type, 'image/jpeg'); assert.equal(f.created.length, 1); assert.equal(f.revoked.length, 0);
});

test('resetting guidance discards the old frontal photo and prevents a stale reviewed face from continuing', async () => {
  const f = setup(); await ready(f.workflow); await f.workflow.review({deliberate: true}); const face = f.workflow.preview('face_front');
  f.workflow.resetGuidance(); assert.equal(f.workflow.preview('face_front'), null); assert.deepEqual(f.revoked, [face]);
  assert.equal(f.workflow.snapshot().guidance.index, 0); assert.equal(f.workflow.snapshot().reviewed_revision, null);
  await refuses(f.workflow.select('face_front', png(), deliberateFile), 'guidance_required');
});

test('identity details are validated, excluded from snapshots and edits invalidate a completed review', async () => {
  const f = setup(); await ready(f.workflow); await f.workflow.review({deliberate:true});
  const reviewed = f.workflow.snapshot().reviewed_revision;
  assert.equal(f.workflow.snapshot().details_complete,true);
  assert.ok(!JSON.stringify(f.workflow.snapshot()).includes('Synthetic Person'));
  const reviewedDetails = f.workflow.reviewDetails(); assert.deepEqual(reviewedDetails,details);
  reviewedDetails.full_name = 'Changed display copy'; assert.equal(f.workflow.reviewDetails().full_name,details.full_name);
  for (const change of [{age:0},{age:131},{age:2.2},{birth_city:''},{full_name:'\nBad'},{document_type:'other'}]) {
    f.workflow.setDetails({...details,...change}); assert.equal(f.workflow.snapshot().details_complete,false);
    await refuses(f.workflow.review({deliberate:true}),'review_required');
    f.workflow.setDetails(details);
  }
  f.workflow.setDetails({...details,age:31}); assert.equal(f.workflow.snapshot().reviewed_revision,null);
  assert.ok(f.workflow.snapshot().revision > reviewed);
});

const notice = {notice_id:'identity-intake',version:1,sha256:'a'.repeat(64),available:true};
function receipt(operation_id) { return {submission_id:'identity-submission:synthetic',operation_id,status:'received',identity_verification:'pending',level:1,created_at:1}; }
async function submissionReady(workflow) {
  await ready(workflow);
  await workflow.select('document_front',jpeg(),deliberateFile);
  await workflow.select('face_front',jpeg(),deliberateFile);
  await workflow.review({deliberate:true});
  await workflow.acceptNotice(notice,{deliberate:true});
}
test('explicit intake binds canonical details, both exact photos, notice and current account without granting verification',async () => {
  let sent;
  const f = setup({submitIdentity:async(body,options) => {
    sent = {body,options}; return receipt(body.operation_id);
  }});
  await submissionReady(f.workflow);
  await refuses(f.workflow.submit(notice),'identity_review_required');
  await refuses(f.workflow.submit({...notice,sha256:'broken'},{deliberate:true}),'identity_review_required');
  await f.workflow.submit(notice,{deliberate:true});
  assert.deepEqual(sent.body.details,details);
  assert.deepEqual(sent.body.expected,{account_id:'account:a',principal_id:'principal:a',session_id:'session:a',recovery_generation:0});
  assert.deepEqual(sent.body.notice,{notice_id:notice.notice_id,version:notice.version,sha256:notice.sha256,acknowledged:true});
  assert.match(sent.body.operation_id,/^identity:[A-Za-z0-9_-]{43}$/);
  assert.equal(sent.body.document_front.base64,Buffer.from(await jpeg().arrayBuffer()).toString('base64'));
  const state = f.workflow.snapshot(); assert.equal(state.submitted,true); assert.equal(state.retained,true);
  assert.equal(state.custody,'private_service_retained'); assert.equal(state.identity_verified,false);
  assert.equal(state.verification.status,'pending'); assert.equal(state.items.length,0); assert.equal(f.revoked.length,4);
});

test('notice agreement is deliberate and binds the exact reviewed package revision and notice digest',async () => {
  const f = setup({submitIdentity:async body => receipt(body.operation_id)});
  await ready(f.workflow);
  await refuses(f.workflow.acceptNotice(notice,{deliberate:true}),'identity_notice_required');
  await f.workflow.review({deliberate:true});
  await refuses(f.workflow.acceptNotice(notice),'identity_notice_required');
  assert.equal(f.workflow.snapshot().notice_accepted,false);
  await f.workflow.acceptNotice(notice,{deliberate:true});assert.equal(f.workflow.snapshot().notice_accepted,true);
  f.workflow.clearNoticeAcceptance();assert.equal(f.workflow.snapshot().notice_accepted,false);
  await f.workflow.acceptNotice(notice,{deliberate:true});
  f.workflow.setDetails({...details,age:31});assert.equal(f.workflow.snapshot().notice_accepted,false);
  await f.workflow.review({deliberate:true});
  await refuses(f.workflow.submit(notice,{deliberate:true}),'identity_review_required');
  await f.workflow.acceptNotice(notice,{deliberate:true});
  await refuses(f.workflow.submit({...notice,sha256:'b'.repeat(64)},{deliberate:true}),'identity_review_required');
});

test('unknown submission locks edits and checks the original receipt without another write',async () => {
  let writes = 0, reads = 0, op;
  const f = setup({submitIdentity:async body => { writes++;op=body.operation_id;throw new Error('response lost'); },
    identitySubmissionStatus:async id => { reads++;assert.equal(id,op);return reads === 1 ? null : receipt(id); }});
  await submissionReady(f.workflow);
  await assert.rejects(f.workflow.submit(notice,{deliberate:true}),/response lost/);
  assert.equal(f.workflow.snapshot().status,'outcome_unknown'); assert.equal(f.workflow.snapshot().retained,null);
  assert.equal(f.workflow.snapshot().custody,'submission_unconfirmed');
  assert.throws(() => f.workflow.setDetails({...details,age:31}),error=>error.code === 'identity_submission_pending');
  await refuses(f.workflow.select('document_front',jpeg(),deliberateFile),'identity_submission_pending');
  await refuses(f.workflow.submit(notice,{deliberate:true}),'identity_submission_pending');
  await f.workflow.checkSubmission();assert.equal(f.workflow.snapshot().status,'outcome_unknown');
  await f.workflow.checkSubmission();assert.equal(f.workflow.snapshot().submitted,true);
  assert.equal(writes,1);assert.equal(reads,2);
});

test('definite pre-write notice failure preserves the reviewed package without inventing an unknown remote outcome',async () => {
  let allowed = false, writes = 0;
  const f = setup({submitIdentity:async body => {
    if (!allowed) { const error = new Error('Notice unavailable');error.definitely_not_submitted = true;throw error; }
    writes++;return receipt(body.operation_id);
  }});
  await submissionReady(f.workflow);const revision = f.workflow.snapshot().revision;
  await assert.rejects(f.workflow.submit(notice,{deliberate:true}),/Notice unavailable/);
  assert.equal(f.workflow.snapshot().status,'reviewed');assert.equal(f.workflow.snapshot().submission,null);
  assert.equal(f.workflow.snapshot().retained,false);assert.equal(f.workflow.snapshot().revision,revision);
  assert.equal(writes,0);allowed = true;
  await f.workflow.submit(notice,{deliberate:true});assert.equal(writes,1);assert.equal(f.workflow.snapshot().submitted,true);
});

test('late upload acknowledgements cannot restore state after cancellation or account change',async () => {
  const pending = gate(),entered = gate();
  const f = setup({submitIdentity:async body => {entered.resolve();await pending.promise;return receipt(body.operation_id);}});
  await submissionReady(f.workflow);
  const submitting = f.workflow.submit(notice,{deliberate:true});await entered.promise;
  f.workflow.cancel();pending.resolve();await refuses(submitting,'capture_cancelled');
  assert.equal(f.workflow.snapshot().status,'cancelled');assert.equal(f.workflow.snapshot().retained,false);
  assert.equal(f.workflow.snapshot().binding,null);assert.equal(f.workflow.snapshot().items.length,0);
});

test('normalization is fenced by cancellation before a preview or upload can be created',async () => {
  const pending = gate(),entered = gate();
  const f = setup({prepareImage:async(blob,{signal,kind}) => {assert.equal(kind,'document_front');entered.resolve();await pending.promise;assert.equal(signal.aborted,true);return blob;}});
  await begin(f.workflow);const selecting=f.workflow.select('document_front',png(),deliberateFile);
  await entered.promise;f.workflow.cancel();pending.resolve();await refuses(selecting,'capture_cancelled');
  assert.equal(f.created.length,0);assert.equal(f.workflow.snapshot().items.length,0);
});

async function signedPhoto(issuedAt=Date.now()) {
  const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
  const spki=Buffer.from(await webcrypto.subtle.exportKey('spki',pair.publicKey));
  const blob=jpeg(),bytes=await blob.arrayBuffer();
  const digest=async value=>Buffer.from(await webcrypto.subtle.digest('SHA-256',value)).toString('hex');
  const request={version:1,purpose:'identity-capture',challenge_id:Buffer.alloc(32,21).toString('base64url'),
    nonce:Buffer.alloc(32,22).toString('base64url'),account_id:'account:a',principal_id:'principal:a',
    current_session_id:'session:a',recovery_generation:0,kind:'document_front',source:'browser-camera',
    public_spki_sha256:await digest(spki),issued_at_ms:issuedAt,capture_expires_at_ms:issuedAt+120000,submit_expires_at_ms:issuedAt+900000};
  const payload={request,image_sha256:await digest(bytes),image_bytes:blob.size,width:640,height:480,
    captured_at_ms:issuedAt,lens_facing:'back',acquisition:null};
  const signature=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,canonicalIdentityCapturePayload(payload));
  return {blob,proof:{payload,public_spki_der_b64:spki.toString('base64'),signature_b64:Buffer.from(signature).toString('base64')}};
}
test('verified camera bytes bypass normalization and retain their exact detached proof until deliberate intake',async()=>{
  let prepares=0,sent;
  const f=setup({prepareImage:async blob=>{prepares++;return blob;},submitIdentity:async body=>{sent=body;return receipt(body.operation_id);}});
  await begin(f.workflow);f.workflow.setDetails(details);
  const photo=await signedPhoto(),original=structuredClone(photo.proof);
  const selecting=f.workflow.select('document_front',photo.blob,{source:'camera',deliberate:true,cleanup:'stopped',captureProof:photo.proof});
  photo.proof.payload.request.recovery_generation=99;await selecting;
  assert.equal(prepares,0,'Re-encoding a signed native or browser result would invalidate its byte proof.');
  await f.workflow.setGuidance('skipped');await f.workflow.select('face_front',jpeg(),deliberateFile);
  await f.workflow.review({deliberate:true});await f.workflow.acceptNotice(notice,{deliberate:true});
  assert.equal(JSON.stringify(f.workflow.snapshot()).includes(original.public_spki_der_b64),false);
  await f.workflow.submit(notice,{deliberate:true});
  assert.deepEqual(sent.document_front.capture_proof,original);
  assert.equal(sent.document_front.base64,Buffer.from(await photo.blob.arrayBuffer()).toString('base64'));
  assert.equal(Object.hasOwn(sent.face_front,'capture_proof'),false,'An imported photo acquires no camera claim.');assert.equal(prepares,1);
});
test('an expired retained camera proof blocks intake without sending media or silently dropping the proof',async t=>{
  let writes=0;
  const f=setup({submitIdentity:async body=>{writes++;return receipt(body.operation_id);}}),photo=await signedPhoto();
  await begin(f.workflow);f.workflow.setDetails(details);
  await refuses(f.workflow.select('document_front',photo.blob,{...deliberateFile,captureProof:photo.proof}),'identity_capture_proof_invalid');
  await f.workflow.select('document_front',photo.blob,{source:'camera',deliberate:true,cleanup:'stopped',captureProof:photo.proof});
  await f.workflow.setGuidance('skipped');await f.workflow.select('face_front',jpeg(),deliberateFile);
  await f.workflow.review({deliberate:true});await f.workflow.acceptNotice(notice,{deliberate:true});
  t.mock.method(Date,'now',()=>photo.proof.payload.request.submit_expires_at_ms);
  await refuses(f.workflow.submit(notice,{deliberate:true}),'identity_capture_expired');
  assert.equal(writes,0);assert.equal(f.workflow.snapshot().submission,null);assert.equal(f.workflow.snapshot().status,'reviewed');
});
