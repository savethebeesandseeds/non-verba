// SPDX-License-Identifier: AGPL-3.0-only
// Silent Debian tests: actual shipped Rust/WASM audio/location signatures and
// receipt verification, actual requester wrappers/stores, Node IDB/Worker doubles.
// This is not a browser IndexedDB, microphone, GPS or physical lifecycle claim.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadShippedCore} from '../tools/image-requester-session.mjs';
const {core}=await loadShippedCore(),clone=structuredClone,databases=new Map();
let beforeAcceptanceRead=null,afterVerification=null;
function database(){return {stores:new Map(),createObjectStore(name){this.stores.set(name,new Map());},close(){},transaction(names,mode='readonly'){
  names=Array.isArray(names)?names:[names];const db=this,working=new Map(names.map(name=>[name,clone(db.stores.get(name))]));
  const tx={pending:0,aborted:false,ended:false,reads:0,abort(){if(this.ended)return;this.aborted=true;this.ended=true;setImmediate(()=>this.onabort?.());},objectStore(name){
    return {get:key=>operation(()=>clone(working.get(name).get(key)),true),
      add:(value,key)=>operation(()=>{if(working.get(name).has(key))throw new Error('ConstraintError');working.get(name).set(key,clone(value));}),
      put:(value,key)=>operation(()=>working.get(name).set(key,clone(value)))};}};
  function operation(body,read=false){const req={};tx.pending++;setImmediate(()=>{if(tx.aborted)return;try{
    req.result=body();if(read&&mode==='readwrite'&&names.includes('accepted')&&++tx.reads===2)beforeAcceptanceRead?.();req.onsuccess?.();
  }catch(error){tx.error=error;tx.abort();}finally{tx.pending--;if(tx.pending===0&&!tx.aborted){tx.ended=true;if(mode==='readwrite')for(const[name,value]of working)db.stores.set(name,value);tx.oncomplete?.();}}});return req;}
  return tx;
}};}
globalThis.indexedDB={open(name){let fresh=false;if(!databases.has(name)){databases.set(name,database());fresh=true;}const request={result:databases.get(name)};
  setImmediate(()=>{if(fresh)request.onupgradeneeded?.();request.onsuccess?.();});return request;}};
globalThis.document=Object.assign(new EventTarget(),{hidden:false});globalThis.window=Object.assign(new EventTarget(),{crypto:globalThis.crypto});
async function invoke(method,args){const value=await core[method](...args);if(method==='verify_evidence_session_receipt'||method==='verify_live_session_receipt')await afterVerification?.(method);return value;}
globalThis.Worker=class{constructor(){setImmediate(()=>this.onmessage?.({data:{ready:true}}));}postMessage({id,method,args}){invoke(method,args).then(value=>this.onmessage?.({data:{id,value}}),error=>this.onmessage?.({data:{id,error:String(error)}}));}};
const engine={call:(name,...args)=>invoke(name,args),json:async(name,...args)=>JSON.parse(await invoke(name,args))};
const {AudioEvidenceSession}=await import('../../web/src/audio-session.js');
const live=await import('../../web/src/live-session-storage.js');
const {locationPolicy}=await import('../../web/src/location-policy.js');
const template=JSON.parse(await readFile(new URL('../crates/nonverba-core/src/location_proof/raw_gnss_fixture.json',import.meta.url),'utf8'));
const operator=core.create_identity(),mediaPin=JSON.parse(operator).fingerprint,
  locationPin=JSON.parse(core.live_requester_identity(operator)).pin.sha256;
let wall=2000000000000;const realNow=Date.now;Date.now=()=>wall;
Object.defineProperty(performance,'now',{configurable:true,value:()=>wall-1900000000000});
process.once('exit',()=>{Date.now=realNow;});
const now=()=>Math.floor(wall/1000),json=JSON.stringify;
async function fixture(kind){
  wall+=1000000;const start=wall,owner={current:true,revision:0};let operation,normalClose,report;
  if(kind==='audio'){
    const audio=new AudioEvidenceSession(engine,mediaPin,{requester:'Synthetic requester',task:'Silent synthetic acceptance fixture',duration_secs:4,assurance:'browser-or-android'});
    await audio.identity();await audio.start(()=>{});const request=audio.request,requestJson=json(request),pcm=new Float32Array(192000),rounds=[];
    for(let index=0;index<2;index++){
      const round=JSON.parse(core.create_audio_round(requestJson,index,start/1000+index*2));
      pcm.set(core.audio_probe(request.session_id,index,round.nonce),index*96000+4800);
      rounds.push({index,nonce:round.nonce,issued_elapsed_ms:index*2010,received_elapsed_ms:index*2010+2000,
        pcm_sha256:core.hash_audio_pcm(pcm.slice(index*96000,(index+1)*96000)),start_sample:index*96000,sample_count:96000});
    }
    const transcript={version:1,session_id:request.session_id,started_at:start/1000,completed_at:start/1000+4,total_samples:192000,rounds};
    audio.retainTranscript({version:1,type:'nonverba-audio-receipt',request,transcript});wall=start+5000;
    const wav=await core.seal_audio(pcm,operator,requestJson,json(transcript),now());report=(await audio.receive(wav)).report;
    operation=guard=>audio.accept(guard);normalClose=()=>audio.close();
  }else{
    const identity=await live.loadRequesterIdentity(engine),requesterPin=JSON.parse(core.live_requester_identity(identity)).pin.sha256;
    const trace=clone(template),delta=start-2000000000000;delete trace.raw_gnss;trace.request.policy=locationPolicy('browser-or-native');
    trace.request.challenge=JSON.parse(core.create_challenge('Synthetic requester','Synthetic location acceptance fixture',now(),900));
    trace.profile='software-browser';trace.permission_precision='browser';trace.uncertainty_semantics='w3c-95-percent';
    trace.started_at_ms+=delta;trace.ended_at_ms+=delta;
    for(const sample of trace.samples){sample.fix_timestamp_ms+=delta;sample.fix_elapsed_ms=null;sample.provider='browser-geolocation';sample.mock=null;}
    const pinJson=json({type:'operator-location-spki-sha256',sha256:locationPin}),original=core.create_live_session_request(json(trace.request),identity,pinJson,now(),90000);
    const payload=JSON.parse(core.validate_live_session_request(original,requesterPin,pinJson,now()));wall=start+12000;
    const proof=core.seal_location_proof(json(trace),operator,'null',now()),bytes=typeof proof==='string'?new TextEncoder().encode(proof):proof;
    const receipt=core.seal_live_session_receipt(original,bytes,json({sent_at_ms:start,received_at_ms:wall,elapsed_ms:12000}),identity,requesterPin,now());
    report=JSON.parse(core.verify_live_session_receipt(receipt,original,bytes,requesterPin,pinJson,now()));
    await live.reserveLiveSession(payload.session_id,trace.request.challenge.id,{request:original,requester_pin:requesterPin,operator_pin:locationPin,demo:false,created_at_ms:start});
    await live.retainLiveOutcome(payload.session_id,{state:'complete',request:original,receipt,proof:bytes,report,challenge_id:trace.request.challenge.id,expires_at_ms:trace.request.challenge.expires_at*1000});
    operation=guard=>live.acceptLiveSession(payload.session_id,guard);normalClose=()=>{owner.transportClosed=true;};
  }
  assert.equal(report.verified,true);assert.equal(report.fresh_action_eligible,true);
  const dbName=kind==='audio'?'nonverba-agent-evidence-v1':'nonverba-live-sessions-v1';
  const accepted=()=>databases.get(dbName).stores.get('accepted').size;
  return {owner,operation,normalClose,accepted,guard:(revision=owner.revision)=>()=>owner.current&&owner.revision===revision&&!document.hidden};
}
for(const kind of ['audio','location']){
  test(`${kind}: normal completed transport closure preserves real reverified acceptance and replay fails`,async()=>{
    const f=await fixture(kind),before=f.accepted();f.normalClose();await f.operation(f.guard());assert.equal(f.accepted(),before+2);
    await assert.rejects(f.operation(f.guard()));assert.equal(f.accepted(),before+2);
  });
  test(`${kind}: original no-guard API remains compatible and current guard is optional`,async()=>{
    const f=await fixture(kind),before=f.accepted();await f.operation();assert.equal(f.accepted(),before+2);
  });
  test(`${kind}: cancel, replacement and pagehide during actual signature verification prevent commit`,async()=>{
    for(const change of ['cancel','new-session','pagehide']){
      const f=await fixture(kind),before=f.accepted();let release,entered;const gate=new Promise(r=>release=r),signal=new Promise(r=>entered=r);
      afterVerification=async()=>{entered();await gate;};const pending=f.operation(f.guard());await signal;
      if(change==='cancel')f.owner.revision++;else if(change==='new-session')f.owner.current=false;else document.hidden=true;
      release();try{await assert.rejects(pending);assert.equal(f.accepted(),before);}finally{afterVerification=null;document.hidden=false;}
    }
  });
  test(`${kind}: cancel, replacement and pagehide immediately before atomic adds leave both acceptance keys absent`,async()=>{
    for(const change of ['cancel','new-session','pagehide']){
      const f=await fixture(kind),before=f.accepted();beforeAcceptanceRead=()=>{if(change==='cancel')f.owner.revision++;else if(change==='new-session')f.owner.current=false;else document.hidden=true;};
      try{await assert.rejects(f.operation(f.guard()));assert.equal(f.accepted(),before);}finally{beforeAcceptanceRead=null;document.hidden=false;}
    }
  });
  test(`${kind}: stale, non-function, asynchronous and throwing guards never authorize a write`,async()=>{
    const f=await fixture(kind),before=f.accepted();for(const guard of [()=>false,null,async()=>true,()=>{throw new Error('guard failed');}])await assert.rejects(async()=>f.operation(guard));assert.equal(f.accepted(),before);
  });
}

test('audio answer import recreates its pre-challenge requester with the same real stored public key',async()=>{
  let challenges=0;const counted={...engine,json:async(name,...args)=>{if(name==='create_audio_request')challenges++;return engine.json(name,...args);}};
  const audio=new AudioEvidenceSession(counted,mediaPin,{requester:'Synthetic requester',task:'Silent pairing import',duration_secs:4,assurance:'browser-or-android'});
  const originalPin=await audio.identity(),prior=audio.requester;audio.prepareAnswerImport();assert.equal(audio.requester,null);assert.equal(challenges,0);
  document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('nonverba:pause'));document.hidden=false;
  await audio.start(()=>{});assert.notEqual(audio.requester,prior);assert.equal(audio.requesterPin,originalPin);assert.equal(challenges,1);
  const payload=JSON.parse(core.validate_evidence_session_request(audio.originalRequest,originalPin,json({media_certificate_sha256:mediaPin,location_spki_sha256:null}),now()));assert.equal(payload.spec.evidence.type,'audio');
  await audio.requester.cancel(audio.id);audio.close();
});
test('audio answer import rejects a substituted requester identity before generating a challenge',async()=>{
  let challenges=0;const counted={...engine,json:async(name,...args)=>{if(name==='create_audio_request')challenges++;return engine.json(name,...args);}};
  const audio=new AudioEvidenceSession(counted,mediaPin,{requester:'Synthetic requester',task:'Silent identity change',duration_secs:4,assurance:'browser-or-android'});
  await audio.identity();audio.prepareAnswerImport();const otherPin=JSON.parse(core.live_requester_identity(core.create_identity())).pin.sha256;
  audio.requester={identity:async()=>otherPin,close(){}};await assert.rejects(audio.start(()=>{}),/identity changed/);assert.equal(challenges,0);audio.close();
});
test('cancel during pre-challenge requester recreation cannot dispatch a late challenge',async()=>{
  let hold=false,release,entered,challenges=0;const gate=new Promise(r=>release=r),signal=new Promise(r=>entered=r);
  const held={...engine,json:async(name,...args)=>{if(name==='create_audio_request')challenges++;const result=await engine.json(name,...args);if(hold&&name==='live_requester_identity'){entered();await gate;}return result;}};
  const audio=new AudioEvidenceSession(held,mediaPin,{requester:'Synthetic requester',task:'Silent cancelled import',duration_secs:4,assurance:'browser-or-android'});
  await audio.identity();audio.prepareAnswerImport();hold=true;const pending=audio.start(()=>assert.fail('No dispatch'));await signal;audio.close();release();await assert.rejects(pending,/cancelled/);assert.equal(challenges,0);
});
test('answer import cannot close or recreate an already dispatched audio challenge',async()=>{
  const audio=new AudioEvidenceSession(engine,mediaPin,{requester:'Synthetic requester',task:'Silent active request',duration_secs:4,assurance:'browser-or-android'});
  await audio.identity();await audio.start(()=>{});const held=audio.requester;assert.throws(()=>audio.prepareAnswerImport(),/pre-challenge/);assert.equal(audio.requester,held);
  await audio.requester.cancel(audio.id);audio.close();
});
