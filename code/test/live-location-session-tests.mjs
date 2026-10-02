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
const {LiveLocationSession,readLiveOffer,authenticateLocationSession,verifyLocationSessionBundle,verifyHistoricalLocationReceipt}=await import('../../web/src/live-location-session.js');
const {LOCATION_CONTEXT,locationContextHash,locationEvidencePolicy,locationSessionHints,locationContext}=await import('../../web/src/location-session-policy.js');
const {AgentRequester}=await import('../../web/src/agent-requester.js');
const storage=await import('../../web/src/agent-evidence-storage.js');
const template=JSON.parse(await readFile(new URL('../crates/nonverba-core/src/location_proof/raw_gnss_fixture.json',import.meta.url),'utf8'));
const operator=core.create_identity(),pin=JSON.parse(core.live_requester_identity(operator)).pin.sha256;
const json=JSON.stringify,now=()=>Math.floor(clock/1000),empty=new Uint8Array(),calls=[];
const engine={call:async(name,...args)=>{calls.push(name);return core[name](...args);},json:async(name,...args)=>{calls.push(name);return JSON.parse(await core[name](...args));}};
const baseHints={requester:'Synthetic requester',task:'Synthetic shared location protocol',profile:'browser-or-native',
  hardware_attestation_required:false,independent_position_required:false,demo:false,context_sha256:await locationContextHash(LOCATION_CONTEXT)};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let n=0;n<400;n++){if(check())return;await tick();}throw new Error('Expected state not reached.');}
function fakePeer(callbacks){
  return {callbacks,sent:[],closed:false,description:async type=>({type,sdp:'m=application 1 UDP/DTLS/SCTP webrtc-datachannel'}),answer:async()=>{},
    send(value){if(this.closed)throw new Error('closed');this.sent.push(structuredClone(value));this.other?.callbacks.onMessage(structuredClone(value));},
    async sendArtifact(bytes){if(this.closed)throw new Error('closed');assert.equal(this.other.callbacks.authorizeArtifact(),true);
      this.beforeArrival?.();this.other.callbacks.onArtifact(bytes.slice(),{wall:clock,mono:performance.now()});this.afterArrival?.();},
    close(){this.closed=true;}};
}
function proof(request,{native=false,raw=false,identity=operator}={}){
  const trace=structuredClone(template),delta=request.challenge.issued_at*1000-2000000000000;
  trace.request=structuredClone(request);trace.started_at_ms+=delta;trace.ended_at_ms+=delta;
  for(const sample of trace.samples)sample.fix_timestamp_ms+=delta;
  if(!raw)delete trace.raw_gnss;
  if(!native){trace.profile='software-browser';trace.permission_precision='browser';trace.uncertainty_semantics='w3c-95-percent';
    for(const sample of trace.samples){sample.provider='browser-geolocation';sample.fix_elapsed_ms=null;sample.mock=null;}}
  clock=request.challenge.issued_at*1000+12000;
  return core.seal_location_proof(json(trace),identity,'null',now());
}
async function setup(t,options={}){
  clock+=100000;document.hidden=false;
  const failures=[],completed=[],states=[],clients=[],hints={...baseHints,...options.hints};
  const requesterFactory=options.requesterFactory|| (async eng=>{
    const client=new AgentRequester(eng),receive=client.receive.bind(client);client.arrivals=[];
    client.receive=(...args)=>{client.arrivals.push(clock);return receive(...args);};clients.push(client);return client;
  });
  const requester=new LiveLocationSession({role:'requester',engine:options.engine||engine,operatorPin:pin,hints,contextJson:options.contextJson||LOCATION_CONTEXT,
    requesterFactory,peerFactory:fakePeer,onFailure:e=>failures.push(e),onComplete:r=>completed.push(r),
    onState:value=>{states.push(value.phase);options.onRequesterState?.(value,requester);}});
  const offer=await requester.offer();await options.beforeAnswer?.(requester);
  const op=new LiveLocationSession({role:'operator',engine,requesterPin:offer.requester_pin,operatorPin:pin,hints,pairingId:offer.pairing_id,
    contextJson:options.contextJson||LOCATION_CONTEXT,getOperatorPin:options.getOperatorPin|| (async()=>pin),
    collect:options.collect|| (async({request})=>proof(request,options.proof)),
    peerFactory:fakePeer,onFailure:e=>failures.push(e),onComplete:r=>completed.push(r)});
  t.after(()=>{requester.cancel('Test cleanup');op.cancel('Test cleanup');for(const client of clients)client.close();});
  requester.peer.other=op.peer;op.peer.other=requester.peer;
  const answer=await op.join(offer);await requester.answer(answer);
  requester.peer.callbacks.onConnected();op.peer.callbacks.onConnected();
  return {requester,op,offer,failures,completed,states,clients,arm:async()=>{await op.arm();await until(()=>requester.remoteArmed);}};
}
async function complete(t,options={}){
  const s=await setup(t,options);await s.arm();await s.requester.start();
  await until(()=>s.completed.length===2||s.failures.length);
  assert.equal(s.failures.length,0,s.failures.map(e=>String(e)).join('; '));assert.equal(s.completed.length,2);
  return s;
}
test('pins and explicit consent precede fresh request; actual AgentRequester retains exact proof and shared policy',async t=>{
  const before=calls.filter(x=>x==='create_location_request').length,s=await setup(t);
  assert.equal(calls.filter(x=>x==='create_location_request').length,before);assert.equal(s.offer.version,2);assert.ok(!json(s.offer).includes('cose_b64'));
  await assert.rejects(s.requester.start(),/allow/);await s.arm();assert.equal(calls.filter(x=>x==='create_location_request').length,before);
  await s.requester.start();await until(()=>s.completed.length===2||s.failures.length);assert.equal(s.failures.length,0,s.failures.map(String).join(';'));
  const result=s.requester.result(),saved=await storage.readEvidenceSession(result.sessionId);
  assert.equal(result.report.verified,true);assert.equal(result.report.fresh_action_eligible,true);assert.equal(result.report.independent_requester_proven,false);
  assert.equal(result.report.request.spec.delivery.max_receipt_age_ms,60000);assert.equal(saved.task.original_request,result.bundle.original_request);
  assert.deepEqual(saved.outcome.primary,result.bytes);assert.equal(saved.task.context_json,LOCATION_CONTEXT);assert.equal(saved.task.state,'complete');
  assert.equal(result.report.request.spec.operator_pins.location_spki_sha256,pin);
  assert.equal(result.report.request.spec.operator_pins.media_certificate_sha256,null);
});
test('full COSE callback invokes actual requester immediately before UI verification and retained bytes are independent copies',async t=>{
  const s=await setup(t);let seen=false;
  s.op.peer.afterArrival=()=>{assert.equal(s.clients[0].arrivals.length,1);assert.equal(s.requester.phase,'verifying');seen=true;};
  await s.arm();await s.requester.start();await until(()=>s.completed.length===2);assert.equal(seen,true);
  const result=s.requester.result(),at=s.clients[0].arrivals[0];assert.equal(result.report.receipt.timing.received_at_ms,at);
  result.bytes[0]^=1;result.bundle.original_request='{}';result.report.verified=false;
  assert.equal(s.requester.result().report.verified,true);assert.notEqual(s.requester.result().bundle.original_request,'{}');
  const saved=await storage.readEvidenceSession(result.sessionId);assert.deepEqual(saved.outcome.primary,s.requester.result().bytes);
});
test('local demo is signed in shared request/receipt and cannot be accepted or relabelled by import',async t=>{
  const s=await complete(t,{hints:{demo:true}}),result=s.requester.result();
  assert.equal(result.report.demo,true);assert.equal(result.report.fresh_action_eligible,false);await assert.rejects(s.requester.accept(),/eligible/);
  const imported=await verifyLocationSessionBundle(engine,result.bundle,result.bytes,s.offer.requester_pin,pin);assert.equal(imported.demo,true);assert.equal(imported.fresh_action_eligible,false);
});
test('native and raw profiles map to exact shared requirements without fallback',async t=>{
  for(const profile of ['native-required','native-gnss','raw-gnss']){
    const hints={...baseHints,profile};assert.equal(locationEvidencePolicy(hints).native_acquisition_required,true);
    assert.equal(locationEvidencePolicy(hints).raw_gnss_required,profile==='raw-gnss');
    const s=await setup(t,{hints:{profile},collect:async({request})=>{
      const weakened=structuredClone(request);weakened.policy.profile='browser-or-native';weakened.policy.required_provider='any';delete weakened.policy.raw_gnss;
      return proof(weakened);
    }});
    await s.arm();await s.requester.start();await until(()=>s.failures.length);assert.equal(s.completed.length,0);assert.equal(s.clients[0].arrivals.length,0);
  }
  // Real WASM intentionally cannot manufacture a native source claim. Native-positive fixtures have a separate JNI harness.
  const request=JSON.parse(core.create_location_request(baseHints.requester,baseHints.task,now(),300,json(template.request.policy),'null'));
  assert.throws(()=>proof(request,{native:true,raw:true}),/browser signer/);
});
test('signed policy, native provider, demo or timing substitutions are rejected before collection',async t=>{
  const s=await setup(t),identity=core.create_identity(),requesterPin=JSON.parse(core.live_requester_identity(identity)).pin.sha256;
  for(const change of ['profile','provider','demo','timing','shared']){
    const request=JSON.parse(core.create_location_request(baseHints.requester,baseHints.task,now(),300,json(template.request.policy),'null'));
    const hints={...baseHints,profile:'raw-gnss'};
    const spec={version:1,evidence:{type:'location',request},operator_pins:{media_certificate_sha256:null,location_spki_sha256:pin},
      policy:locationEvidencePolicy(hints),delivery:{max_response_ms:90000,max_receipt_age_ms:60000}};
    if(change==='profile')request.policy.profile='browser-or-native';
    if(change==='provider')request.policy.required_provider='any';
    if(change==='demo')request.demo=true;
    if(change==='timing')spec.delivery.max_receipt_age_ms=61000;
    if(change==='shared')spec.policy.raw_gnss_required=false;
    let original;try{original=core.create_evidence_session_request(json(spec),identity,now());}catch{continue;}
    await assert.rejects(authenticateLocationSession(engine,original,requesterPin,pin,hints),/differs/);
  }
  assert.equal(s.clients[0].arrivals.length,0);
});
test('optional context must be explicit, bounded, pin-matched and frozen; missing strict requirements reject before pairing',async()=>{
  assert.throws(()=>locationContext('x'.repeat(4*1024*1024+1)),/limit/);
  assert.throws(()=>locationContext('{"version":1,"report":{"verified":true}}'),/Unsupported/);
  assert.throws(()=>locationSessionHints({...baseHints,independent_position_required:true}),/raw/);
  for(const hints of [{...baseHints,hardware_attestation_required:true},{...baseHints,profile:'raw-gnss',independent_position_required:true}]){
    assert.throws(()=>new LiveLocationSession({role:'requester',engine,operatorPin:pin,hints,peerFactory:fakePeer}),/context before pairing/);
  }
  const session=new LiveLocationSession({role:'requester',engine,operatorPin:pin,hints:{...baseHints,context_sha256:'f'.repeat(64)},peerFactory:fakePeer});
  try{await assert.rejects(session.offer(),/commitment/);}finally{session.cancel();}
});
test('exact context and original wrapper are mandatory on shared bundle verification; fresh receipt age expires',async t=>{
  const s=await complete(t,{contextJson:'{ "version": 1 }',hints:{context_sha256:await locationContextHash('{ "version": 1 }')}}),r=s.requester.result();
  await assert.rejects(verifyLocationSessionBundle(engine,r.bundle,r.bytes,s.offer.requester_pin,pin),/context/);
  const okay=await verifyLocationSessionBundle(engine,r.bundle,r.bytes,s.offer.requester_pin,pin,'{ "version": 1 }');assert.equal(okay.verified,true);
  const altered=JSON.parse(r.bundle.original_request),cose=Buffer.from(altered.cose_b64,'base64');cose[cose.length-1]^=1;altered.cose_b64=cose.toString('base64');
  const wrong=await verifyLocationSessionBundle(engine,{...r.bundle,original_request:json(altered)},r.bytes,s.offer.requester_pin,pin,'{ "version": 1 }');
  assert.equal(wrong.verified,false);
  clock+=61000;const old=await verifyLocationSessionBundle(engine,r.bundle,r.bytes,s.offer.requester_pin,pin,'{ "version": 1 }');
  assert.equal(old.verified,true);assert.equal(old.fresh_action_eligible,false);await assert.rejects(s.requester.accept());
});
test('successful transport closure preserves acceptance once; explicit cancellation and atomic context guard prevent commit',async t=>{
  const s=await complete(t);assert.equal(s.requester.closed,true);await s.requester.accept();await assert.rejects(s.requester.accept(),/ConstraintError/);
  const next=await complete(t);next.requester.cancel();await assert.rejects(next.requester.accept(),/context changed/);
  const guarded=await complete(t);let current=true;const db=databases.get('nonverba-agent-evidence-v1'),before=db.stores.get('accepted').size;
  db.beforeAcceptanceRead=()=>{current=false;};
  try{await assert.rejects(guarded.requester.accept(()=>current),/context changed/);assert.equal(db.stores.get('accepted').size,before);}
  finally{db.beforeAcceptanceRead=null;}
});
test('cancel during final cryptographic verification cannot publish completion or permit acceptance',async t=>{
  let release,entered;const gate=new Promise(r=>release=r),signal=new Promise(r=>entered=r);
  const held={...engine,call:async(name,...args)=>{if(name==='seal_evidence_session_receipt'){entered();await gate;}return engine.call(name,...args);}};
  const s=await setup(t,{engine:held});await s.arm();await s.requester.start();await signal;s.requester.cancel();release();
  await tick();await tick();assert.equal(s.completed.length,0);await assert.rejects(s.requester.accept());
});
test('synchronous cancellation in complete-state callback suppresses onComplete',async t=>{
  const s=await setup(t,{onRequesterState:(value,owner)=>{if(value.phase==='complete')owner.cancel('Cancelled before callback');}});
  await s.arm();await s.requester.start();await until(()=>s.requester.closed);await tick();assert.equal(s.completed.length,0);await assert.rejects(s.requester.accept());
});
test('disconnect or repeated request while collection awaits aborts and late proof cannot be sent',async t=>{
  for(const reason of ['disconnect','repeat']){
    let resolve,signal,request;const s=await setup(t,{collect:value=>{signal=value.signal;request=value.request;return new Promise(r=>resolve=r);}});
    await s.arm();await s.requester.start();await until(()=>resolve);
    if(reason==='disconnect')s.op.peer.callbacks.onFailure(new Error('Disconnected'));
    else s.op.peer.callbacks.onMessage(s.requester.peer.sent.find(value=>value.type==='request'));
    await until(()=>s.op.closed);assert.equal(signal.aborted,true);resolve(proof(request));await tick();await tick();
    assert.equal(s.clients[0].arrivals.length,0);assert.equal(s.completed.length,0);
  }
});
test('duplicate arm and start while async identity checks await allow only one challenge',async t=>{
  let block=false,release;const gate=new Promise(r=>release=r);
  const s=await setup(t,{getOperatorPin:async()=>{if(block)await gate;return pin;}});block=true;
  const arms=[s.op.arm(),s.op.arm()];release();const armed=await Promise.allSettled(arms);
  assert.equal(armed.filter(x=>x.status==='fulfilled').length,1);await until(()=>s.requester.remoteArmed);
  const before=calls.filter(x=>x==='create_location_request').length;
  const starts=await Promise.allSettled([s.requester.start(),s.requester.start()]);
  assert.equal(starts.filter(x=>x.status==='fulfilled').length,1);await until(()=>s.completed.length===2);
  assert.equal(calls.filter(x=>x==='create_location_request').length,before+1);
});
test('same-pin pre-challenge requester recreation works and suspended acquisition does not resume',async t=>{
  const s=await setup(t,{beforeAnswer:r=>r.prepareAnswerImport()});assert.equal(s.clients.length,1);
  await s.arm();await s.requester.start();await until(()=>s.completed.length===2);assert.equal(s.clients.length,2);
  assert.equal(s.requester.result().bundle.requester_pin,s.offer.requester_pin);
  let resolve;const pending=await setup(t,{collect:()=>new Promise(r=>resolve=r)});await pending.arm();await pending.requester.start();await until(()=>resolve);
  document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));pending.requester.cancel('Page hidden');document.hidden=false;
  resolve(new Uint8Array([1]));await tick();await tick();assert.equal(pending.completed.length,0);await assert.rejects(pending.requester.start(),/active/);
});
test('legacy v1 receipt stays verifiable by explicit historical path, never shared fallback or acceptance',async()=>{
  clock+=100000;const identity=core.create_identity(),requesterPin=JSON.parse(core.live_requester_identity(identity)).pin.sha256,op=json({type:'operator-location-spki-sha256',sha256:pin});
  const request=JSON.parse(core.create_location_request(baseHints.requester,baseHints.task,now(),900,json({...template.request.policy,profile:'browser-or-native',required_provider:'any',raw_gnss:undefined}),'null'));
  const original=core.create_live_session_request(json(request),identity,op,now(),90000),sent=clock,bytes=proof(request);
  const receipt=core.seal_live_session_receipt(original,bytes,json({sent_at_ms:sent,received_at_ms:clock,elapsed_ms:clock-sent}),identity,requesterPin,now());
  const report=await verifyHistoricalLocationReceipt(engine,receipt,original,bytes,requesterPin,pin);assert.equal(report.verified,true);
  const shared=await verifyLocationSessionBundle(engine,{version:1,type:'nonverba-location-session-evidence',requester_pin:requesterPin,operator_pin:pin,original_request:original,receipt,context_json:LOCATION_CONTEXT},bytes,requesterPin,pin);
  assert.equal(shared.verified,false);assert.equal(shared.fresh_action_eligible,false);
  assert.throws(()=>readLiveOffer(json({version:1,type:'nonverba-live-location-offer',pairing_id:'a'.repeat(64),requester_pin:requesterPin,operator_pin:pin,hints:baseHints,description:{}})),/version-2/);
});
