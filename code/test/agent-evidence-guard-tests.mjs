// SPDX-License-Identifier: AGPL-3.0-only
// Node transaction test double + actual shipped Rust/WASM receipts. This exercises
// commit guards, not browser IndexedDB implementation or physical camera hardware.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {syntheticCameraJpeg} from './fixtures/synthetic-camera.mjs';
import {loadShippedCore} from '../tools/image-requester-session.mjs';
const {core}=await loadShippedCore(), clone=structuredClone;
const db={stores:new Map(),beforeAcceptanceRead:null,createObjectStore(name){this.stores.set(name,new Map());},close(){},
  transaction(names,mode='readonly'){
    names=Array.isArray(names)?names:[names];const working=new Map(names.map(name=>[name,clone(this.stores.get(name))]));
    const tx={mode,pending:0,aborted:false,ended:false,reads:0,abort(){if(this.ended)return;this.aborted=true;this.ended=true;setImmediate(()=>this.onabort?.());},
      objectStore(name){return {get:key=>operation(()=>clone(working.get(name).get(key)),true),
        add:(value,key)=>operation(()=>{if(working.get(name).has(key))throw new Error('ConstraintError');working.get(name).set(key,clone(value));}),
        put:(value,key)=>operation(()=>working.get(name).set(key,clone(value)))};}};
    function operation(body,read=false){const request={};tx.pending++;setImmediate(()=>{if(tx.aborted)return;
      try{request.result=body();if(read&&mode==='readwrite'&&names.includes('accepted')&&++tx.reads===2)db.beforeAcceptanceRead?.();request.onsuccess?.();}
      catch(error){tx.error=error;tx.abort();}finally{tx.pending--;if(tx.pending===0&&!tx.aborted){tx.ended=true;if(mode==='readwrite')for(const [name,value]of working)db.stores.set(name,value);tx.oncomplete?.();}}
    });return request;}return tx;
  }};
globalThis.indexedDB={open(){const request={result:db};setImmediate(()=>{request.onupgradeneeded?.();request.onsuccess?.();});return request;}};
const storage=await import('../../web/src/agent-evidence-storage.js');
const operator=core.create_identity(),requester=core.create_identity(),mediaPin=JSON.parse(operator).fingerprint,
  requesterPin=JSON.parse(core.live_requester_identity(requester)).pin.sha256;
const jpeg=await syntheticCameraJpeg();
let wall=1800000000500;const realNow=Date.now;Date.now=()=>wall;
process.once('exit',()=>{Date.now=realNow;});
const now=()=>Math.floor(wall/1000),engine={json:async(name,...args)=>JSON.parse(await core[name](...args))};
async function fixture(){
  wall+=10000;const request=JSON.parse(core.create_challenge('Synthetic requester','Synthetic lifecycle test',now(),300));
  const spec={version:1,evidence:{type:'image',request},operator_pins:{media_certificate_sha256:mediaPin,location_spki_sha256:null},
    policy:{version:1,native_acquisition_required:false,raw_gnss_required:false,correlated_camera_clock_required:false,hardware_attestation_required:false,independent_position_required:false},
    delivery:{max_response_ms:180000,max_receipt_age_ms:60000}};
  const original=core.create_evidence_session_request(JSON.stringify(spec),requester,now());
  const payload=JSON.parse(core.validate_evidence_session_request(original,requesterPin,JSON.stringify(spec.operator_pins),now()));
  const primary=await core.seal_image(jpeg,JSON.stringify(request),operator,now(),JSON.stringify({latitude:0,longitude:0,accuracy_m:5,altitude_m:null,altitude_accuracy_m:null,timestamp_ms:wall,source:'device-geolocation'}));
  const timing={sent_at_ms:wall,received_at_ms:wall+100,elapsed_ms:100};wall+=100;
  const receipt=await core.seal_evidence_session_receipt(original,primary,new Uint8Array(),'',JSON.stringify(timing),requester,requesterPin,'{"version":1}',now());
  await storage.reserveEvidenceSession({session_id:payload.session_id,sensor_nonce:payload.sensor_nonce,original_request:original,requester_pin:requesterPin,context_json:'{"version":1}'});
  await storage.retainEvidenceOutcome(payload.session_id,original,{primary,secondary:new Uint8Array(),audio_transcript_json:'',receipt});
  return payload.session_id;
}
const accepted=()=>db.stores.get('accepted').size;
test('unchanged default accepts a real freshly reverified receipt once and rejects replay',async()=>{
  const id=await fixture(),before=accepted();const result=await storage.acceptEvidenceSession(engine,id,requesterPin);
  assert.equal(result.acceptance_recorded,true);assert.equal(accepted(),before+2);
  await assert.rejects(storage.acceptEvidenceSession(engine,id,requesterPin),/ConstraintError/);assert.equal(accepted(),before+2);
});
test('false, non-function and async guards cannot authorize acceptance',async()=>{
  const id=await fixture(),before=accepted();for(const guard of [()=>false,null,async()=>true])await assert.rejects(storage.acceptEvidenceSession(engine,id,requesterPin,guard),/context changed/);
  assert.equal(accepted(),before);
});
test('cancellation or pagehide while cryptographic verification awaits prevents atomic commit',async()=>{
  for(const reason of ['cancel','pagehide']){
    const id=await fixture(),before=accepted(),abort=new AbortController();let hidden=false,release,entered;
    const gate=new Promise(r=>release=r),signal=new Promise(r=>entered=r);
    const held={json:async(...args)=>{const report=await engine.json(...args);entered();await gate;return report;}};
    const pending=storage.acceptEvidenceSession(held,id,requesterPin,()=>!abort.signal.aborted&&!hidden);
    await signal;if(reason==='cancel')abort.abort();else hidden=true;release();await assert.rejects(pending,/context changed/);assert.equal(accepted(),before);
  }
});
test('cancellation or pagehide immediately before atomic write is checked again, with rollback',async()=>{
  for(const reason of ['cancel','pagehide']){
    const id=await fixture(),before=accepted(),abort=new AbortController();let hidden=false;
    db.beforeAcceptanceRead=()=>{if(reason==='cancel')abort.abort();else hidden=true;};
    try{await assert.rejects(storage.acceptEvidenceSession(engine,id,requesterPin,()=>!abort.signal.aborted&&!hidden),/context changed/);assert.equal(accepted(),before);}
    finally{db.beforeAcceptanceRead=null;}
  }
});
test('throwing commit guard aborts and cannot leave a partial nonce reservation in accepted store',async()=>{
  const id=await fixture(),before=accepted();let final=false;db.beforeAcceptanceRead=()=>{final=true;};
  try{await assert.rejects(storage.acceptEvidenceSession(engine,id,requesterPin,()=>{if(final)throw new Error('Guard failed');return true;}),/Guard failed/);assert.equal(accepted(),before);}
  finally{db.beforeAcceptanceRead=null;}
});
test('expiry during real verification and changed retained bytes still prevent acceptance',async()=>{
  for(const mutation of ['expiry','bytes']){
    const id=await fixture(),before=accepted();const changed={json:async(...args)=>{const report=await engine.json(...args);
      if(mutation==='expiry')wall+=61000;else db.stores.get('outcomes').get(id).primary[0]^=1;return report;}};
    await assert.rejects(storage.acceptEvidenceSession(changed,id,requesterPin));assert.equal(accepted(),before);
  }
});
