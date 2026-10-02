// SPDX-License-Identifier: AGPL-3.0-only
// Actual shipped Rust/WASM, AgentRequester and durable-storage code. In-memory
// IndexedDB/transport and synthetic clocks/location only: no physical sensor claim.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadShippedCore} from '../tools/image-requester-session.mjs';
const databases=new Map();
function database(){
  const db={stores:new Map(),beforeAcceptanceRead:null,objectStoreNames:{contains:name=>db.stores.has(name)},
    createObjectStore(name){db.stores.set(name,new Map());},close(){},
    transaction(names,mode='readonly'){
      names=Array.isArray(names)?names:[names];const working=new Map(names.map(name=>[name,structuredClone(db.stores.get(name))]));
      const tx={pending:0,aborted:false,ended:false,reads:0,abort(){if(this.ended)return;this.aborted=true;this.ended=true;setImmediate(()=>this.onabort?.());},
        objectStore(name){return {get:key=>operation(()=>structuredClone(working.get(name).get(key)),true),
          add:(value,key)=>operation(()=>{if(working.get(name).has(key))throw new Error('ConstraintError');working.get(name).set(key,structuredClone(value));}),
          put:(value,key)=>operation(()=>working.get(name).set(key,structuredClone(value)))};}};
      function operation(body,read=false){const request={};tx.pending++;setImmediate(()=>{
        if(tx.aborted)return;
        try{request.result=body();if(read&&mode==='readwrite'&&names.includes('accepted')&&++tx.reads===2)db.beforeAcceptanceRead?.();request.onsuccess?.();}
        catch(error){tx.error=error;tx.abort();}
        finally{tx.pending--;if(tx.pending===0&&!tx.aborted){tx.ended=true;if(mode==='readwrite')for(const [name,value]of working)db.stores.set(name,value);tx.oncomplete?.();}}
      });return request;}return tx;
    }};
  return db;
}
globalThis.indexedDB={open(name){let db=databases.get(name),fresh=!db;if(!db){db=database();databases.set(name,db);}const request={result:db};setImmediate(()=>{if(fresh)request.onupgradeneeded?.();request.onsuccess?.();});return request;}};
globalThis.document=new EventTarget();document.hidden=false;globalThis.window=new EventTarget();window.crypto=globalThis.crypto;
let clock=2000000000500;const realNow=Date.now,realPerformance=globalThis.performance;Date.now=()=>clock;
Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>clock-1900000000000}});
process.once('exit',()=>{Date.now=realNow;Object.defineProperty(globalThis,'performance',{configurable:true,value:realPerformance});});
const {core}=await loadShippedCore();
const {CameraSession,readCameraOffer,authenticateCameraSession,verifyCameraSessionBundle,CAMERA_CONTEXT,cameraContext,cameraContextHash,cameraHints,cameraPolicy}=await import('../../web/src/camera-session.js');
const {locationPolicy}=await import('../../web/src/location-policy.js');
const {AgentRequester}=await import('../../web/src/agent-requester.js');
const storage=await import('../../web/src/agent-evidence-storage.js');
const template=JSON.parse(await readFile(new URL('../crates/nonverba-core/src/location_proof/raw_gnss_fixture.json',import.meta.url),'utf8'));
const jpeg=new Uint8Array(await readFile(new URL('../artifacts/qa/native-camera-synthetic.jpg',import.meta.url)));
const media=core.create_identity(),location=core.create_identity(),mediaPin=JSON.parse(media).fingerprint,
  locationPin=JSON.parse(core.live_requester_identity(location)).pin.sha256;
const json=JSON.stringify,now=()=>Math.floor(clock/1000),calls=[];
const engine={call:async(name,...args)=>{calls.push(name);return core[name](...args);},json:async(name,...args)=>{calls.push(name);return JSON.parse(await core[name](...args));}};
const baseHints={requester:'Synthetic requester',task:'Synthetic camera and location protocol',assurance:'browser-or-android',location_profile:'browser-or-native',
  hardware_attestation_required:false,independent_position_required:false,context_sha256:await cameraContextHash(CAMERA_CONTEXT)};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let n=0;n<400;n++){if(check())return;await tick();}throw new Error('Expected state not reached.');}
function fakePeer(callbacks){
  return {callbacks,sent:[],closed:false,description:async type=>({type,sdp:'m=application 1 UDP/DTLS/SCTP webrtc-datachannel'}),answer:async()=>{},
    send(value){if(this.closed)throw new Error('closed');this.sent.push(structuredClone(value));this.other?.callbacks.onMessage(structuredClone(value));},
    async sendArtifacts({primary,secondary}){if(this.closed)throw new Error('closed');assert.equal(callbacks.mode,'camera-location-v2');
      assert.equal(this.other.callbacks.authorizeArtifacts({primaryBytes:primary.length,secondaryBytes:secondary.length}),true);
      this.afterJPEG?.();await this.beforeProof?.();if(this.closed)return;
      this.other.callbacks.onArtifacts({primary:primary.slice(),secondary:secondary.slice()});this.afterArrival?.();},
    close(){this.closed=true;}};
}
async function artifacts(request,{mediaIdentity=media,locationIdentity=location,otherMedia=false}={}){
  const trace=structuredClone(template),delta=request.challenge.issued_at*1000-2000000000000;
  trace.request=structuredClone(request);trace.started_at_ms+=delta;trace.ended_at_ms+=delta;
  delete trace.raw_gnss;trace.profile='software-browser';trace.permission_precision='browser';trace.uncertainty_semantics='w3c-95-percent';
  for(const sample of trace.samples){sample.fix_timestamp_ms+=delta;sample.provider='browser-geolocation';sample.fix_elapsed_ms=null;sample.mock=null;}
  clock=request.challenge.issued_at*1000+12000;
  const last=trace.samples.at(-1),fix=json({latitude:last.latitude,longitude:last.longitude,accuracy_m:last.accuracy_m,altitude_m:last.altitude_m,
    altitude_accuracy_m:last.altitude_accuracy_m,timestamp_ms:last.fix_timestamp_ms,source:'device-geolocation'});
  const bytes=await core.seal_image_with_location_request(jpeg,json(request.challenge),mediaIdentity,now(),fix,json(request));
  const bound=otherMedia?await core.seal_image_with_location_request(jpeg,json(request.challenge),mediaIdentity,now(),fix,json(request)):bytes;
  const proof=core.seal_location_proof(json(trace),locationIdentity,core.location_asset(bound),now());
  return {bytes,locationProof:proof,fingerprint:mediaPin,locationFingerprint:locationPin,locationRequest:structuredClone(request)};
}
async function setup(t,options={}){
  clock+=100000;document.hidden=false;
  const failures=[],completed=[],states=[],clients=[],hints={...baseHints,...options.hints};
  const requesterFactory=async eng=>{const client=new AgentRequester(eng),receive=client.receive.bind(client);client.arrivals=[];
    client.receive=(...args)=>{client.arrivals.push(clock);return receive(...args);};clients.push(client);return client;};
  const contextJson=options.contextJson||CAMERA_CONTEXT;
  const requester=new CameraSession({role:'requester',engine:options.engine||engine,operatorPin:mediaPin,operatorLocationPin:locationPin,hints,contextJson,
    requesterFactory,peerFactory:fakePeer,onFailure:e=>failures.push(e),onComplete:r=>completed.push(r),
    onState:value=>{states.push(value.phase);options.onRequesterState?.(value,requester);}});
  const offer=await requester.offer();
  const op=new CameraSession({role:'operator',engine,requesterPin:offer.requester_pin,operatorPin:mediaPin,operatorLocationPin:locationPin,hints,contextJson,pairingId:offer.pairing_id,
    getOperatorPin:options.getOperatorPin|| (async()=>mediaPin),getLocationPin:options.getLocationPin|| (async()=>locationPin),
    collect:options.collect|| (async({locationRequest})=>artifacts(locationRequest,options.artifacts)),
    peerFactory:fakePeer,onFailure:e=>failures.push(e),onComplete:r=>completed.push(r)});
  t.after(()=>{requester.cancel('Test cleanup');op.cancel('Test cleanup');for(const client of clients)client.close();});
  requester.peer.other=op.peer;op.peer.other=requester.peer;
  const answer=await op.join(offer);await requester.answer(answer);requester.peer.callbacks.onConnected();op.peer.callbacks.onConnected();
  return {requester,op,offer,failures,completed,states,clients,arm:async()=>{await op.arm();await until(()=>requester.remoteArmed);}};
}
async function complete(t,options={}){
  const s=await setup(t,options);await s.arm();await s.requester.start();await until(()=>s.completed.length===2||s.failures.length);
  assert.equal(s.failures.length,0,s.failures.map(String).join('; '));assert.equal(s.completed.length,2);return s;
}
const verify=(s,r=s.requester.result(),opts={})=>verifyCameraSessionBundle(engine,r.bundle,r.bytes,s.offer.requester_pin,mediaPin,
  {locationProof:r.locationProof,operatorLocationPin:locationPin,contextJson:r.bundle.context_json,...opts});

test('explicit composed pins and consent precede fresh request; both real artifacts retained and accepted exactly once',async t=>{
  const before=calls.filter(x=>x==='create_location_request').length,s=await setup(t);
  assert.equal(calls.filter(x=>x==='create_location_request').length,before);assert.equal(s.offer.version,2);assert.equal(s.offer.operator_location_pin,locationPin);
  assert.equal(readCameraOffer(json(s.offer)).version,2);await assert.rejects(s.requester.start(),/allow/);await s.arm();
  assert.equal(calls.filter(x=>x==='create_location_request').length,before);await s.requester.start();await until(()=>s.completed.length===2||s.failures.length);
  assert.equal(s.failures.length,0,s.failures.map(String).join('; '));const r=s.requester.result(),saved=await storage.readEvidenceSession(r.sessionId);
  assert.equal(r.report.verified,true);assert.equal(r.report.fresh_action_eligible,true);assert.equal(r.report.independent_requester_proven,false);
  assert.equal(r.report.physical_measurement_authenticity_proven,false);assert.deepEqual(saved.outcome.primary,r.bytes);assert.deepEqual(saved.outcome.secondary,r.locationProof);
  assert.equal(r.report.request.spec.evidence.type,'camera-location');assert.equal(r.bundle.version,2);assert.equal(saved.task.context_json,CAMERA_CONTEXT);
  assert.deepEqual(r.locationProof,s.op.result().locationProof);assert.equal(s.requester.closed,true);await s.requester.accept();await assert.rejects(s.requester.accept(),/ConstraintError/);
});

test('JPEG alone produces no arrival; complete proof observes arrival synchronously before UI and preserves originals',async t=>{
  let release;const s=await setup(t);s.op.peer.beforeProof=()=>new Promise(r=>release=r);let seen=false;
  s.op.peer.afterJPEG=()=>{assert.equal(s.clients[0].arrivals.length,0);assert.equal(s.requester.phase,'awaiting-image');};
  s.op.peer.afterArrival=()=>{assert.equal(s.clients[0].arrivals.length,1);assert.equal(s.requester.phase,'verifying');seen=true;};
  await s.arm();await s.requester.start();await until(()=>release);assert.equal(s.clients[0].arrivals.length,0);clock+=3000;release();await until(()=>s.completed.length===2);
  const r=s.requester.result();assert.equal(seen,true);assert.equal(r.report.receipt.timing.received_at_ms,s.clients[0].arrivals[0]);
  r.bytes[0]^=1;r.locationProof[0]^=1;r.bundle.context_json='{}';assert.equal((await verify(s)).verified,true);
});

test('missing, truncated, swapped, wrong-binding and changed image artifacts cannot yield a receipt',async t=>{
  for(const change of ['missing','truncated','proof-signature','image','wrong-binding','request','location-pin','media-key','location-key']){
    const s=await setup(t,{collect:async({locationRequest})=>{const r=await artifacts(locationRequest,{
      ...(change==='media-key'?{mediaIdentity:core.create_identity()}:{}),...(change==='location-key'?{locationIdentity:core.create_identity()}:{}),otherMedia:change==='wrong-binding'});
      if(change==='missing')delete r.locationProof;
      if(change==='truncated')r.locationProof=r.locationProof.slice(0,10);
      if(change==='proof-signature')r.locationProof[r.locationProof.length-1]^=1;
      if(change==='image')r.bytes[100]^=1;
      if(change==='request')r.locationRequest.policy.duration_ms+=1;
      if(change==='location-pin')r.locationFingerprint='f'.repeat(64);
      return r;}});
    await s.arm();await s.requester.start();await until(()=>s.failures.length||s.completed.length);assert.equal(s.completed.length,0,change);assert.equal(s.clients[0].arrivals.length,0,change);
  }
});

test('bundle verification requires independently retained both pins, exact context and exact second artifact',async t=>{
  const s=await complete(t),r=s.requester.result();assert.equal((await verify(s)).verified,true);
  for(const options of [{operatorLocationPin:'f'.repeat(64)},{locationProof:r.locationProof.slice(0,10)}])assert.equal((await verify(s,r,options)).verified,false);
  await assert.rejects(verify(s,r,{locationProof:undefined}));await assert.rejects(verify(s,r,{contextJson:'{ "version":1}'}));
  const wrong=await verifyCameraSessionBundle(engine,r.bundle,r.bytes,s.offer.requester_pin,'f'.repeat(64),{locationProof:r.locationProof,operatorLocationPin:locationPin});assert.equal(wrong.verified,false);
  await assert.rejects(verifyCameraSessionBundle(engine,{...r.bundle,version:1},r.bytes,s.offer.requester_pin,mediaPin));
});

test('complete signed sensor policy, context purpose/session and both identities are authenticated before collection',async t=>{
  const s=await setup(t,{collect:()=>new Promise(()=>{})});await s.arm();await s.requester.start();await until(()=>s.op.phase==='capturing');
  const original=s.requester.makeBundle().original_request;
  for(const [requesterPin,operatorPin,hints,options]of[
    ['f'.repeat(64),mediaPin,baseHints,{operatorLocationPin:locationPin}],
    [s.offer.requester_pin,'f'.repeat(64),baseHints,{operatorLocationPin:locationPin}],
    [s.offer.requester_pin,mediaPin,baseHints,{operatorLocationPin:'f'.repeat(64)}],
    [s.offer.requester_pin,mediaPin,{...baseHints,location_profile:'native-gnss'},{operatorLocationPin:locationPin}],
    [s.offer.requester_pin,mediaPin,{...baseHints,task:'substitution'},{operatorLocationPin:locationPin}],
    [s.offer.requester_pin,mediaPin,baseHints,{operatorLocationPin:locationPin,contextJson:'{ "version":1}'}]
  ])await assert.rejects(authenticateCameraSession(engine,original,requesterPin,operatorPin,hints,options));
  const identity=core.create_identity(),requesterPin=JSON.parse(core.live_requester_identity(identity)).pin.sha256;
  const payload=JSON.parse(core.validate_evidence_session_request(original,s.offer.requester_pin,json({media_certificate_sha256:mediaPin,location_spki_sha256:locationPin}),now()));
  for(const change of ['provider','duration','session','delivery','policy']){
    const spec=structuredClone(payload.spec);
    if(change==='provider')spec.evidence.request.policy.required_provider='gnss';
    if(change==='duration')spec.evidence.request.policy.duration_ms=11000;
    if(change==='session')spec.evidence.request.context.session_id='a'.repeat(64);
    if(change==='delivery')spec.delivery.max_receipt_age_ms=61000;
    if(change==='policy')spec.policy.hardware_attestation_required=true;
    const changed=core.create_evidence_session_request(json(spec),identity,now());
    await assert.rejects(authenticateCameraSession(engine,changed,requesterPin,mediaPin,baseHints,{operatorLocationPin:locationPin}),/differs/);
  }
});

test('native location and raw requirements do not downgrade to a valid software camera/location pair',async t=>{
  for(const profile of ['native-required','native-gnss','raw-gnss']){
    const s=await setup(t,{hints:{location_profile:profile},collect:async({locationRequest})=>{
      const weakened=structuredClone(locationRequest);weakened.policy=locationPolicy('browser-or-native');
      const r=await artifacts(weakened);r.locationRequest=locationRequest;return r;
    }});await s.arm();await s.requester.start();await until(()=>s.failures.length);assert.equal(s.clients[0].arrivals.length,0);assert.equal(s.completed.length,0);
  }
});

test('explicit context is bounded, preserves exact bytes and requires both attestation contexts and raw profile for strict policy',async()=>{
  assert.throws(()=>cameraContext('x'.repeat(4*1024*1024+1)),/limit/);assert.throws(()=>cameraContext('{"version":1,"report":{}}'),/Unsupported/);
  assert.throws(()=>cameraHints({...baseHints,independent_position_required:true}),/raw/);
  for(const hints of [{...baseHints,hardware_attestation_required:true},{...baseHints,location_profile:'raw-gnss',independent_position_required:true}])
    assert.throws(()=>new CameraSession({role:'requester',engine,operatorPin:mediaPin,operatorLocationPin:locationPin,hints,peerFactory:fakePeer}),/context/);
  const session=new CameraSession({role:'requester',engine,operatorPin:mediaPin,operatorLocationPin:locationPin,hints:{...baseHints,context_sha256:'f'.repeat(64)},peerFactory:fakePeer});
  try{await assert.rejects(session.offer(),/commitment/);}finally{session.cancel();}
});

test('fresh receipt age, delayed proof delivery and sealing deadline are enforced by actual requester and Rust',async t=>{
  const s=await complete(t);clock+=61000;assert.equal((await verify(s)).fresh_action_eligible,false);await assert.rejects(s.requester.accept());
  const late=await setup(t);late.op.peer.beforeProof=()=>{clock+=180001;};await late.arm();await late.requester.start();await until(()=>late.failures.length);assert.equal(late.completed.length,0);
  const slow={...engine,call:async(name,...args)=>{if(name==='seal_evidence_session_receipt'){clock+=31000;args[args.length-1]=now();}return engine.call(name,...args);}};
  const seal=await setup(t,{engine:slow});await seal.arm();await seal.requester.start();await until(()=>seal.failures.length);assert.equal(seal.completed.length,0);
});

test('cancel during proof transfer, collection or receipt verification prevents late success',async t=>{
  for(const stage of ['collection','transfer','verification']){
    let release,entered;const gate=new Promise(r=>release=r),entry=new Promise(r=>entered=r);
    const held={...engine,call:async(name,...args)=>{if(stage==='verification'&&name==='seal_evidence_session_receipt'){entered();await gate;}return engine.call(name,...args);}};
    const s=await setup(t,{engine:held,collect:async({locationRequest,signal})=>{if(stage==='collection'){entered();await gate;assert.equal(signal.aborted,true);}return artifacts(locationRequest);}});
    if(stage==='transfer')s.op.peer.beforeProof=async()=>{entered();await gate;};
    await s.arm();await s.requester.start();await entry;s.requester.cancel();await until(()=>s.op.closed);release();await tick();await tick();
    assert.equal(s.completed.length,0,stage);await assert.rejects(s.requester.accept());
  }
});

test('both selected operator keys are checked again after the collector returns',async t=>{
  for(const key of ['media','location']){
    let changed=false;const s=await setup(t,{getOperatorPin:async()=>changed&&key==='media'?'f'.repeat(64):mediaPin,
      getLocationPin:async()=>changed&&key==='location'?'f'.repeat(64):locationPin,
      collect:async({locationRequest})=>{const r=await artifacts(locationRequest);changed=true;return r;}});
    await s.arm();await s.requester.start();await until(()=>s.failures.length);assert.equal(s.clients[0].arrivals.length,0);assert.equal(s.completed.length,0);
  }
});

test('cancellation inside complete callback and acceptance transaction prevents late completion or commit',async t=>{
  const s=await setup(t,{onRequesterState:(value,owner)=>{if(value.phase==='complete')owner.cancel('Cancelled before callback');}});
  await s.arm();await s.requester.start();await until(()=>s.requester.closed);assert.equal(s.completed.length,0);await assert.rejects(s.requester.accept());
  const a=await complete(t),db=databases.get('nonverba-agent-evidence-v1'),before=db.stores.get('accepted').size;let current=true;
  db.beforeAcceptanceRead=()=>{current=false;};try{await assert.rejects(a.requester.accept(()=>current),/context changed/);assert.equal(db.stores.get('accepted').size,before);}finally{db.beforeAcceptanceRead=null;}
});

test('composed pairing rejects version or pin substitution and bare image authorization',async t=>{
  const s=await setup(t);assert.equal(s.requester.peer.callbacks.authorizeArtifact(),false);
  assert.equal(s.requester.peer.callbacks.authorizeArtifacts({primaryBytes:10,secondaryBytes:10}),false);
  assert.throws(()=>readCameraOffer(json({...s.offer,version:1})));assert.throws(()=>readCameraOffer(json({...s.offer,operator_location_pin:undefined})));
  assert.throws(()=>readCameraOffer(json({...s.offer,hints:{requester:'x',task:'y',assurance:'browser-or-android'}})));
});


test('Buffer-backed callback inputs are copied by actual requester before asynchronous sealing and by the controller before exposure',async t=>{
  let release,entered,receivedPrimary,receivedSecondary;
  const gate=new Promise(r=>release=r),entry=new Promise(r=>entered=r);
  const held={...engine,call:async(name,...args)=>{if(name==='seal_evidence_session_receipt'){entered();await gate;}return engine.call(name,...args);}};
  const s=await setup(t,{engine:held});
  s.op.peer.sendArtifacts=async({primary,secondary})=>{
    receivedPrimary=Buffer.from(primary);receivedSecondary=Buffer.from(secondary);
    assert.equal(s.requester.peer.callbacks.authorizeArtifacts({primaryBytes:primary.length,secondaryBytes:secondary.length}),true);
    s.requester.peer.callbacks.onArtifacts({primary:receivedPrimary,secondary:receivedSecondary});
  };
  await s.arm();await s.requester.start();await entry;receivedPrimary.fill(0);receivedSecondary.fill(0);release();
  await until(()=>s.completed.length===2||s.failures.length);assert.equal(s.failures.length,0,s.failures.map(String).join('; '));assert.equal(s.completed.length,2);
  assert.equal((await verify(s)).verified,true);const r=s.requester.result(),stored=await storage.readEvidenceSession(r.sessionId);
  assert.deepEqual(stored.outcome.primary,r.bytes);assert.deepEqual(stored.outcome.secondary,r.locationProof);
});
