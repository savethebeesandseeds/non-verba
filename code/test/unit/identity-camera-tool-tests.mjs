// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createIdentityCameraTool} from '../../../web/shared/identity/identity-camera-tool.js';
import {identityCaptureBase64,identityCaptureKey,snapshotIdentityCaptureRequest,
  canonicalIdentityCapturePayload,verifyIdentityCaptureProof} from '../../../web/shared/identity/identity-capture-proof.js';
const context = {account_id:'account:test',principal_id:'principal:test',current_session_id:'session:test',recovery_generation:2};
const b64 = bytes => Buffer.from(bytes).toString('base64');
const token = byte => Buffer.alloc(32,byte).toString('base64url');
const hash = async bytes => Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex');
const rejects = (promise,code) => assert.rejects(promise,error=>error.code===code);
const jpeg = () => new Blob([new Uint8Array([255,216,255,192,0,11,8,1,224,2,128,1,1,17,0,255,217])],{type:'image/jpeg'});
async function key() {
  const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
  const spki=b64(await webcrypto.subtle.exportKey('spki',pair.publicKey));
  return {pair,spki,hash:(await identityCaptureKey(spki,webcrypto)).hash};
}
function request(pin,source='browser-camera',kind='document_front') {
  const now=Date.now();
  return {version:1,purpose:'identity-capture',challenge_id:token(1),nonce:token(2),...context,kind,source,
    public_spki_sha256:pin,issued_at_ms:now,capture_expires_at_ms:now+120000,submit_expires_at_ms:now+900000};
}
const acquisition = () => ({version:1,timestamp_source:'realtime',request_elapsed_realtime_ns:'100',
  image_received_elapsed_realtime_ns:'200',result_received_elapsed_realtime_ns:'190',sensor_timestamp_ns:'150',
  image_timestamp_ns:'150',zsl_requested_disabled:true,test_pattern_requested_disabled:true,
  zsl_result_enabled:false,test_pattern_result_mode:0});
async function proofFixture({source='browser-camera',kind='document_front'}={}) {
  const signing=await key(),original=request(signing.hash,source,kind),blob=jpeg();
  const descriptor={media_type:'image/jpeg',byte_length:blob.size,width:640,height:480,sha256:await hash(await blob.arrayBuffer())};
  const payload={request:original,image_sha256:descriptor.sha256,image_bytes:blob.size,width:640,height:480,
    captured_at_ms:original.issued_at_ms,lens_facing:kind==='face_front' ? 'front':'back',
    acquisition:source==='native-camera2' ? acquisition():null};
  const sign=async value=>({payload:value,public_spki_der_b64:signing.spki,
    signature_b64:b64(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},signing.pair.privateKey,canonicalIdentityCapturePayload(value)))});
  return {signing,original,blob,descriptor,payload,sign,proof:await sign(payload),
    options:{context,kind,descriptor,crypto:webcrypto}};
}

test('identity proof signs exact final bytes and a distinct recursive canonical purpose domain',async()=>{
  const f=await proofFixture(),proof=await verifyIdentityCaptureProof(f.proof,f.options);
  assert.equal(proof.payload.request.purpose,'identity-capture'); assert.equal(Object.isFrozen(proof.payload.request),true);
  assert.equal(f.signing.pair.privateKey.extractable,false);
  assert.equal(new TextDecoder().decode(canonicalIdentityCapturePayload({z:2,a:{c:3,b:1}})),
    'NONVERBA:IDENTITY_CAPTURE:v1\n{"a":{"b":1,"c":3},"z":2}');
  await rejects(verifyIdentityCaptureProof(f.proof,{...f.options,descriptor:{...f.descriptor,sha256:'f'.repeat(64)}}),'identity_capture_image_mismatch');
  const changed=structuredClone(f.proof); changed.payload.image_bytes++;
  await rejects(verifyIdentityCaptureProof(changed,f.options),'identity_capture_image_mismatch');
  const signature=structuredClone(f.proof); signature.signature_b64=b64(Buffer.alloc(64));
  await rejects(verifyIdentityCaptureProof(signature,f.options),'identity_capture_signature_invalid');
});
test('Rust-generated browser/native golden proofs match WebCrypto and exact canonical signing bytes',async()=>{
  const golden=JSON.parse(await readFile(new URL('../fixtures/identity-capture-v1.json',import.meta.url),'utf8'));
  const bytes=Buffer.from(golden.jpeg_base64,'base64');assert.equal(golden.synthetic_only,true);
  for(const entry of golden.cases) {
    const payload=entry.proof.payload,original=entry.original;
    const signing=canonicalIdentityCapturePayload(payload);
    assert.equal(b64(signing),entry.signing_bytes_base64);assert.equal(await hash(signing),entry.signing_sha256);
    assert.deepEqual(payload.request,original);
    const expected=Object.fromEntries(['account_id','principal_id','current_session_id','recovery_generation'].map(name=>[name,original[name]]));
    const descriptor={media_type:'image/jpeg',byte_length:bytes.length,width:8,height:8,sha256:await hash(bytes)};
    const verified=await verifyIdentityCaptureProof(entry.proof,{context:expected,kind:original.kind,descriptor,
      now:entry.verifier_time_ms,crypto:webcrypto});
    assert.equal(verified.payload.request.source,entry.source);
  }
});
test('actual synthetic Kotlin/JCA native signature verifies independently with WebCrypto',async()=>{
  const fixture=JSON.parse(await readFile(new URL('../fixtures/identity-capture-jca-v1.json',import.meta.url),'utf8'));
  assert.equal(fixture.type,'synthetic-jca-identity-capture');assert.equal(fixture.hardware_attested,false);
  const bytes=Buffer.from(fixture.image_base64,'base64'),original=fixture.proof.payload.request;
  const expected=Object.fromEntries(['account_id','principal_id','current_session_id','recovery_generation'].map(name=>[name,original[name]]));
  const descriptor={media_type:'image/jpeg',byte_length:bytes.length,width:320,height:240,sha256:await hash(bytes)};
  const proof=await verifyIdentityCaptureProof(fixture.proof,{context:expected,kind:original.kind,descriptor,
    now:fixture.now_ms,crypto:webcrypto});
  assert.equal(proof.payload.request.source,'native-camera2');
});
test('request is closed, source/context/key bound and bounded to exact capture/submission windows',async()=>{
  const f=await proofFixture(),options={context,kind:'document_front',source:'browser-camera',keyHash:f.signing.hash};
  for(const change of [{image_sha256:'0'.repeat(64)},{account_id:'x'.repeat(129)},{current_session_id:'session:other'},
    {recovery_generation:3},{purpose:'signin-device'},{capture_expires_at_ms:f.original.issued_at_ms+120001}]) {
    assert.throws(()=>snapshotIdentityCaptureRequest({...f.original,...change},options),error=>error.code==='identity_capture_request_invalid');
  }
  assert.throws(()=>snapshotIdentityCaptureRequest(f.original,{...options,now:f.original.capture_expires_at_ms}),error=>error.code==='identity_capture_expired');
  await rejects(verifyIdentityCaptureProof(f.proof,{...f.options,now:f.original.submit_expires_at_ms}),'identity_capture_expired');
  const another=await key(),wrong={...f.proof,public_spki_der_b64:another.spki};
  await rejects(verifyIdentityCaptureProof(wrong,f.options),'identity_capture_key_mismatch');
});
test('native proof requires the selected lens and bounded matching Camera2 observations',async()=>{
  const f=await proofFixture({source:'native-camera2',kind:'face_front'});
  await verifyIdentityCaptureProof(f.proof,f.options);
  for(const change of [{lens_facing:'back'},{lens_facing:'unknown'},{acquisition:null},
    {acquisition:{...acquisition(),zsl_result_enabled:true}},
    {acquisition:{...acquisition(),image_timestamp_ns:'151'}},
    {acquisition:{...acquisition(),image_received_elapsed_realtime_ns:'15000000101'}},
    {acquisition:{...acquisition(),result_received_elapsed_realtime_ns:'15000000101'}},
    {acquisition:{...acquisition(),sensor_timestamp_ns:'9223372036854775808'}},
    {acquisition:{...acquisition(),gps:'not permitted'}}]) {
    await rejects(verifyIdentityCaptureProof(await f.sign({...f.payload,...change}),f.options),'identity_capture_acquisition_invalid');
  }
  await rejects(verifyIdentityCaptureProof(await f.sign({...f.payload,width:1281}),f.options),'identity_capture_proof_invalid');
  const document=await proofFixture();
  await rejects(verifyIdentityCaptureProof(await document.sign({...document.payload,width:2401}),document.options),'identity_capture_proof_invalid');
});
test('browser proof never accepts native observations, invented hardware assurance or mutable caller input',async()=>{
  const f=await proofFixture();
  await rejects(verifyIdentityCaptureProof(await f.sign({...f.payload,acquisition:acquisition()}),f.options),'identity_capture_acquisition_invalid');
  await rejects(verifyIdentityCaptureProof({...f.proof,hardware_attested:true},f.options),'identity_capture_proof_invalid');
  const supplied=structuredClone(f.proof),pending=verifyIdentityCaptureProof(supplied,f.options);
  supplied.payload.request.recovery_generation=99;
  assert.equal((await pending).payload.request.recovery_generation,2);
});

async function nativeFixture(t) {
  const signing=await key(),sent=[],waiters=[],events=new Map(),issued=[];
  const scope={crypto:webcrypto,document:{hidden:false,addEventListener(){},removeEventListener(){}},
    addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:(name)=>events.delete(name),
    NativeIdentityCamera:{postMessage:text=>{
      const message=JSON.parse(text); sent.push(message);
      const index=waiters.findIndex(waiter=>waiter.op===message.op);
      if(index>=0) waiters.splice(index,1)[0].resolve(message);
    }}};
  const fixture={signing,scope,sent,events,issued,
    next:op=>{const found=sent.find(message=>message.op===op && !message.taken);if(found){found.taken=true;return Promise.resolve(found);}
      return new Promise(resolve=>waiters.push({op,resolve:message=>{message.taken=true;resolve(message);}}));},
    respond:value=>scope.NativeIdentityCamera.onmessage({data:JSON.stringify(value)})};
  fixture.tool=createIdentityCameraTool({scope,video:{},issueChallenge:async body=>{
    assert.deepEqual(Object.keys(body).sort(),['expected','kind','source','public_spki_der_b64'].sort());
    assert.equal(body.source,'native-camera2');
    const original=request((await identityCaptureKey(body.public_spki_der_b64,webcrypto)).hash,'native-camera2',body.kind);
    issued.push(original);return original;
  },inspectPhoto:async blob=>({media_type:blob.type,byte_length:blob.size,width:640,height:480,sha256:await hash(await blob.arrayBuffer())})});
  t.after(()=>fixture.tool.dispose());
  fixture.start=async(kind='document_front')=>{
    const pending=fixture.tool.start(kind,{context}),keyRequest=await fixture.next('key');
    fixture.respond({id:keyRequest.id,key:{public_spki_der_b64:signing.spki,public_spki_sha256:signing.hash}});
    const start=await fixture.next('start'); fixture.respond({id:start.id,session_id:'capture:session'}); await pending;
    return issued.at(-1);
  };
  return fixture;
}
test('native result preserves exact JPEG bytes and proof while waiting for the native manual shutter', {timeout:5000},async t=>{
  const f=await nativeFixture(t),original=await f.start(),blob=jpeg(),bytes=new Uint8Array(await blob.arrayBuffer());
  assert.equal(f.sent.some(message=>message.op==='result'),false,'Starting does not collect a photo result.');
  const pending=f.tool.capture(),result=await f.next('result');
  await rejects(f.tool.capture(),'identity_capture_unavailable');
  const payload={request:Object.fromEntries(Object.entries(original).reverse()),image_sha256:await hash(bytes),image_bytes:bytes.length,
    width:640,height:480,captured_at_ms:original.issued_at_ms,lens_facing:'back',acquisition:acquisition()};
  const proof={payload,public_spki_der_b64:f.signing.spki,signature_b64:b64(await webcrypto.subtle.sign(
    {name:'ECDSA',hash:'SHA-256'},f.signing.pair.privateKey,canonicalIdentityCapturePayload(payload)))};
  f.respond({id:result.id,result:{image_base64:identityCaptureBase64(bytes),proof,cleanup:'confirmed'}});
  const received=await pending;
  assert.deepEqual(new Uint8Array(await received.blob.arrayBuffer()),bytes);
  assert.equal(received.cleanup,'stopped'); assert.deepEqual(received.captureProof,proof);
});
test('native cancellation revokes the exact pending request and fences late publication', {timeout:5000},async t=>{
  const f=await nativeFixture(t),pending=f.tool.start('face_front',{context});
  const refused=rejects(pending,'capture_cancelled'),request=await f.next('key'); f.tool.stop(); await refused;
  assert.ok(f.sent.some(message=>message.cancel===request.id));
  f.respond({id:request.id,key:{public_spki_der_b64:f.signing.spki,public_spki_sha256:f.signing.hash}});
  assert.equal(f.sent.some(message=>message.op==='start'),false);
});
test('an advertised but unusable native bridge never falls back to browser acquisition',()=>{
  let calls=0;
  assert.throws(()=>createIdentityCameraTool({scope:{NativeIdentityCamera:{},crypto:webcrypto},video:{},
    issueChallenge:async()=>{},mediaDevices:{getUserMedia(){calls++;}}}),error=>error.code==='identity_capture_unavailable');
  assert.equal(calls,0);
});
