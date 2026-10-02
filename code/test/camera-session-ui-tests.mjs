// SPDX-License-Identifier: AGPL-3.0-only
// DOM/event test double: validates UI policy/lifecycle wiring, not real layout,
// Android picker behavior, native sensors, browser WebRTC or IndexedDB.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {cameraContextHash} from '../../web/src/camera-session.js';
import {readLocationProofEnvelope} from '../../web/src/location-platform.js';
import {installCameraSessionUI,CameraPairingImport} from '../../web/src/camera-session-ui.js';
const html=await readFile(new URL('../../web/src/index.html',import.meta.url),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]), pin='a'.repeat(64),requesterPin='b'.repeat(64),pairing='c'.repeat(64),locationPin='e'.repeat(64);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
// Web Crypto runs outside this event loop. Counting setImmediate callbacks can
// exhaust in milliseconds while its worker is still queued in concurrent suites.
// This is only a test observation bound; production session deadlines are untouched.
async function until(check){
  const deadline=performance.now()+5000;
  do{if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}while(performance.now()<deadline);
  assert.ok(check(),'UI did not settle within the 5-second test observation window.');
}
class Element extends EventTarget{checked=false;_value='';get value(){return this._value;}set value(value){this._value=String(value).replace(/\r\n?/g,'\n');}textContent='';_disabled=false;get disabled(){return this._disabled;}set disabled(value){this._disabled=!!value;}hidden=false;files=[];}
function setup(t,options={}){
  const elements=new Map(ids.map(id=>[id,new Element()])),doc=new EventTarget(),win=new EventTarget();
  doc.hidden=false;doc.getElementById=id=>{assert.ok(elements.has(id),`UI element exists: ${id}`);return elements.get(id);};
  const oldDoc=globalThis.document,oldWin=globalThis.window,oldNative=globalThis.NativeVault;
  globalThis.document=doc;globalThis.window=win;if(options.native)globalThis.NativeVault={};else delete globalThis.NativeVault;
  const sessions=[],saved=[],calls=[];
  class Session{
    constructor(spec){Object.assign(this,spec);this.phase='pairing';this.connected=false;this.remoteArmed=false;this.cancelled=false;sessions.push(this);}
    async offer(){if(options.offer)return options.offer(this);return {version:this.hints.location_profile?2:1,type:'nonverba-camera-offer',pairing_id:pairing,requester_pin:requesterPin,operator_pin:pin,...(this.hints.location_profile?{operator_location_pin:this.operatorLocationPin}:{}),hints:this.hints,description:{}};}
    async join(){calls.push('join');return {type:'answer'};}
    async answer(){this.connected=true;this.phase='connected';this.onState({phase:'connected'});}
    async arm(){calls.push('arm');this.phase='armed';this.onState({phase:'armed'});}
    async start(){calls.push('start');this.phase='awaiting-image';this.onState({phase:this.phase});}
    prepareAnswerImport(){calls.push('prepare-import');}
    cancel(){this.cancelled=true;this.phase='failed';}
    fail(error){this.phase='failed';this.onFailure(error);}
    async accept(guard){calls.push('accept');assert.equal(guard(),true);if(options.accept)return options.accept(guard);return {acceptance_recorded:true};}
  }
  const $=id=>doc.getElementById(id);
  $('camera-live-role').value='requester';$('camera-live-assurance').value='native-correlated';$('camera-live-requester').value='Requester';$('camera-live-task').value='Photograph the task';$('camera-live-operator-pin').value=pin;
  $('camera-live-location-profile').value='metadata';$('camera-live-location-pin').value=locationPin;$('camera-live-context').value='{"version":1}';$('camera-live-operator-context').value='{"version":1}';
  const ui=installCameraSessionUI({engine:{},getLocationPin:options.getLocationPin||(async()=>locationPin),getOperatorPin:options.getOperatorPin||(async()=>pin),collect:()=>{},saveArtifact:async(...args)=>saved.push(args),nativeAvailable:()=>!!options.native,preparePermissions:options.preparePermissions||(async()=>calls.push('preflight')),checkPermissions:options.checkPermissions||(()=>{}),root:doc,Session,nativePairing:options.nativePairing,
    checkLocationProfile:options.checkLocationProfile||(profile=>{if(profile!=='browser-or-native'&&!options.native)throw new Error('Native location unavailable in UI fixture');})});
  t.after(()=>{ui.cancel('Test cleanup');globalThis.document=oldDoc;globalThis.window=oldWin;if(oldNative===undefined)delete globalThis.NativeVault;else globalThis.NativeVault=oldNative;});
  return {$,ui,doc,win,sessions,saved,calls,click:id=>$(id).dispatchEvent(new Event('click')),
    event:(name,detail)=>{const event=new Event(name);Object.defineProperty(event,'detail',{value:detail});win.dispatchEvent(event);},
    offer:()=>JSON.stringify({version:1,type:'nonverba-camera-offer',pairing_id:pairing,requester_pin:requesterPin,operator_pin:pin,hints:{requester:'Requester',task:'Photograph the task',assurance:options.assurance||'native-correlated'},description:{}})};
}
test('every live UI id is unique and pairing/consent cannot automatically issue or accept',async t=>{
  assert.equal(new Set(ids).size,ids.length);const s=setup(t);s.click('camera-live-create');await until(()=>!!s.$('camera-live-offer-out').value);
  assert.equal(s.calls.includes('start'),false);assert.equal(s.$('camera-live-start').disabled,true);assert.equal(s.$('camera-live-requester').disabled,true);
  s.$('camera-live-answer-in').value='{}';s.click('camera-live-connect');await until(()=>s.sessions[0].connected);await tick();assert.equal(s.$('camera-live-start').disabled,true);
  s.sessions[0].remoteArmed=true;s.sessions[0].onState({phase:'connected'});s.click('camera-live-start');await until(()=>s.calls.includes('start'));assert.equal(s.calls.includes('accept'),false);
});
test('operator checks trusted requester pin and native capability before creating a session',async t=>{
  const s=setup(t);s.$('camera-live-role').value='operator';s.$('camera-live-role').dispatchEvent(new Event('change'));
  s.$('camera-live-offer-in').value=s.offer();s.$('camera-live-requester-pin').value='d'.repeat(64);s.click('camera-live-join');await until(()=>s.$('camera-live-status').textContent.includes('trusted channel'));
  assert.equal(s.sessions.length,0);s.$('camera-live-requester-pin').value=requesterPin;s.click('camera-live-join');await until(()=>s.$('camera-live-status').textContent.includes('Android native'));assert.equal(s.sessions.length,0);
});
test('operator displays agreed task before explicit arm and never starts sensor during joining',async t=>{
  const s=setup(t,{native:true});s.$('camera-live-role').value='operator';s.$('camera-live-role').dispatchEvent(new Event('change'));s.$('camera-live-offer-in').value=s.offer();s.$('camera-live-requester-pin').value=requesterPin;
  s.click('camera-live-join');await until(()=>!!s.$('camera-live-answer-out').value);assert.match(s.$('camera-live-agreed').textContent,/Photograph the task/);assert.deepEqual(s.calls,['preflight','join']);
  s.sessions[0].phase='connected';s.sessions[0].onState({phase:'connected'});s.click('camera-live-arm');await until(()=>s.calls.includes('arm'));assert.equal(s.calls.includes('start'),false);
});
test('cancel while asynchronous offer is pending cannot publish the late offer',async t=>{
  let release;const s=setup(t,{offer:()=>new Promise(r=>release=r)});s.click('camera-live-create');await until(()=>release);s.click('camera-live-cancel');release({requester_pin:requesterPin});await tick();await tick();
  assert.equal(s.sessions[0].cancelled,true);assert.equal(s.$('camera-live-offer-out').value,'');assert.equal(s.ui.active,false);
});
test('complete result exports exact files and acceptance remains an explicit live requester action',async t=>{
  const s=setup(t);s.click('camera-live-create');await until(()=>s.sessions.length&&s.$('camera-live-offer-out').value);
  const result={role:'requester',sessionId:pairing,bytes:new Uint8Array([255,216,255,217]),bundle:{original_request:'retained',receipt:'signed'},report:{verified:true,fresh_action_eligible:true}};
  s.sessions[0].phase='complete';s.sessions[0].onComplete(result);assert.equal(s.calls.includes('accept'),false);
  assert.equal(s.$('camera-live-session-id').value,pairing);
  s.click('camera-live-save-photo');await until(()=>s.saved.length===1);assert.deepEqual(s.saved[0][2],result.bytes);
  s.click('camera-live-save-bundle');await until(()=>s.saved.length===2);assert.equal(JSON.parse(s.saved[1][2]).original_request,'retained');
  s.click('camera-live-accept');await until(()=>s.calls.includes('accept'));assert.equal(s.$('camera-live-accept').disabled,true);
});
test('hidden page and actual pagehide cancel active session and disable stale acceptance',async t=>{
  const s=setup(t);s.click('camera-live-create');await until(()=>s.$('camera-live-offer-out').value);s.doc.hidden=true;s.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(s.sessions[0].cancelled,true);assert.equal(s.ui.active,false);assert.equal(s.$('camera-live-accept').disabled,true);
});
test('only an explicitly clicked native pre-challenge answer picker survives its own pause; pagehide always cancels',async t=>{
  const s=setup(t,{native:true});s.click('camera-live-create');await until(()=>s.$('camera-live-offer-out').value);
  s.click('camera-live-answer-file');s.event('nonverba:file-picker',{active:true});s.doc.hidden=true;s.doc.dispatchEvent(new Event('visibilitychange'));s.event('nonverba:pause');
  assert.equal(s.ui.active,true);assert.equal(s.sessions[0].cancelled,false);assert.equal(s.calls.includes('prepare-import'),true);
  s.doc.hidden=false;s.event('nonverba:file-picker',{active:false});s.$('camera-live-answer-file').files=[{size:2,text:async()=>'{}'}];s.$('camera-live-answer-file').dispatchEvent(new Event('change'));await until(()=>s.$('camera-live-answer-in').value==='{}');
  s.click('camera-live-answer-file');s.event('nonverba:file-picker',{active:true});s.event('pagehide');assert.equal(s.sessions[0].cancelled,true);
});
test('native pause without matching picker intent or active acquisition cancels instead of resuming',async t=>{
  const s=setup(t,{native:true});s.click('camera-live-create');await until(()=>s.$('camera-live-offer-out').value);s.event('nonverba:file-picker',{active:true});s.event('nonverba:pause');assert.equal(s.ui.active,false);
});
test('picker exception is bounded, needs native confirmation and never applies after challenge dispatch',async()=>{
  const original=Date.now;let wall=1000;Date.now=()=>wall;let cancelled=0;
  const session={role:'requester',phase:'pairing',connected:false,prepareAnswerImport(){}};
  const picker=new CameraPairingImport({current:()=>session,cancel:()=>cancelled++,native:()=>true,hidden:()=>false});
  try{picker.begin();assert.equal(picker.permitsPause(),false);picker.nativeEvent(true);assert.equal(picker.permitsPause(),true);
    session.phase='awaiting-image';assert.equal(picker.permitsPause(),false);session.phase='pairing';wall+=60001;assert.equal(picker.permitsPause(),false);await assert.rejects(picker.foreground(),/cancelled/);assert.equal(cancelled,0);
  }finally{picker.clear();Date.now=original;}
});

test('permission warmup precedes pairing and survives its own overlay without creating a challenge',async t=>{
  let release,signal;const s=setup(t,{native:true,preparePermissions:value=>{signal=value;return new Promise(r=>release=r);}});
  s.$('camera-live-role').value='operator';s.$('camera-live-role').dispatchEvent(new Event('change'));s.$('camera-live-offer-in').value=s.offer();s.$('camera-live-requester-pin').value=requesterPin;s.click('camera-live-join');await until(()=>release);
  assert.equal(s.sessions.length,0);s.doc.hidden=true;s.doc.dispatchEvent(new Event('visibilitychange'));s.event('nonverba:pause');assert.equal(signal.aborted,false);
  s.doc.hidden=false;release();await until(()=>s.sessions.length===1);assert.equal(s.calls.includes('start'),false);
});
test('actual pagehide cancels permission warmup and its late result cannot create a pairing',async t=>{
  let release,signal;const s=setup(t,{native:true,preparePermissions:value=>{signal=value;return new Promise(r=>release=r);}});
  s.$('camera-live-role').value='operator';s.$('camera-live-role').dispatchEvent(new Event('change'));s.$('camera-live-offer-in').value=s.offer();s.$('camera-live-requester-pin').value=requesterPin;s.click('camera-live-join');await until(()=>release);
  s.event('pagehide');assert.equal(signal.aborted,true);release();await tick();await tick();assert.equal(s.sessions.length,0);
});
test('permission denial or revocation fails before pairing or explicit arm',async t=>{
  const s=setup(t,{native:true,preparePermissions:async()=>{throw new Error('Permission denied');}});
  s.$('camera-live-role').value='operator';s.$('camera-live-role').dispatchEvent(new Event('change'));s.$('camera-live-offer-in').value=s.offer();s.$('camera-live-requester-pin').value=requesterPin;s.click('camera-live-join');await until(()=>s.$('camera-live-status').textContent==='Permission denied');assert.equal(s.sessions.length,0);
});

test('revoked native permission blocks operator arm after a successful preflight',async t=>{
  const s=setup(t,{native:true,checkPermissions:()=>{throw new Error('Camera permission revoked');}});
  s.$('camera-live-role').value='operator';s.$('camera-live-role').dispatchEvent(new Event('change'));s.$('camera-live-offer-in').value=s.offer();s.$('camera-live-requester-pin').value=requesterPin;s.click('camera-live-join');await until(()=>s.$('camera-live-answer-out').value);
  s.sessions[0].phase='connected';s.sessions[0].onState({phase:'connected'});s.click('camera-live-arm');await until(()=>s.$('camera-live-status').textContent==='Camera permission revoked');assert.equal(s.calls.includes('arm'),false);
});

// The Session double exposes the same synchronous guard used by the shared
// storage transaction. Other suites exercise real WASM and storage operations.
test('explicit cancel remains available during delayed acceptance and blocks its commit guard',async t=>{
  let finishVerification,commitCount=0,checkedAtCommit=false;
  const s=setup(t,{accept:async guard=>{
    await new Promise(resolve=>finishVerification=resolve);
    checkedAtCommit=true;
    if(!guard())throw new Error('Camera acceptance context changed before commit.');
    commitCount++;return {acceptance_recorded:true};
  }});
  s.click('camera-live-create');await until(()=>!!s.$('camera-live-offer-out').value);
  const result={role:'requester',sessionId:pairing,bytes:new Uint8Array([255,216,255,217]),bundle:{original_request:'retained',receipt:'signed'},report:{verified:true,fresh_action_eligible:true}};
  const owner=s.sessions[0];owner.phase='complete';owner.onComplete(result);
  s.click('camera-live-accept');await until(()=>!!finishVerification);
  assert.equal(s.$('camera-live-cancel').disabled,false,'a user can stop acceptance while verification is pending');
  s.click('camera-live-cancel');assert.equal(owner.cancelled,true);assert.equal(s.ui.active,false);
  finishVerification();await until(()=>checkedAtCommit);await tick();
  assert.equal(commitCount,0);assert.equal(result.accepted,undefined);
  assert.equal(s.$('camera-live-result').hidden,true);assert.equal(s.$('camera-live-accept').disabled,true);
  assert.match(s.$('camera-live-status').textContent,/context changed before commit/);
});

const setComposed=(s,profile='browser-or-native',context='{ "version": 1 }\n')=>{
  s.$('camera-live-location-profile').value=profile;s.$('camera-live-context').value=context;
  s.$('camera-live-location-profile').dispatchEvent(new Event('change'));
  return context;
};
async function composedOffer(s,{context='{ "version": 1 }\n',profile='browser-or-native',location=locationPin}={}){
  const offer=JSON.parse(s.offer());offer.version=2;offer.operator_location_pin=location;
  Object.assign(offer.hints,{location_profile:profile,hardware_attestation_required:false,independent_position_required:false,context_sha256:await cameraContextHash(context)});
  s.$('camera-live-role').value='operator';s.$('camera-live-role').dispatchEvent(new Event('change'));
  s.$('camera-live-offer-in').value=JSON.stringify(offer);s.$('camera-live-requester-pin').value=requesterPin;s.$('camera-live-operator-context').value=context;
  return offer;
}
const contextFile=value=>{const bytes=new TextEncoder().encode(value);return {size:bytes.length,arrayBuffer:async()=>bytes.buffer};};
function selectFile(s,id,file){s.$(id).files=[file];s.$(id).dispatchEvent(new Event('change'));}

test('composed requester retains the exact independent context, separate pin and explicit profile without starting capture',async t=>{
  const s=setup(t),context=setComposed(s,'raw-gnss');s.$('camera-live-hardware').checked=true;s.$('camera-live-position').checked=true;
  assert.equal(s.$('camera-live-composed-options').hidden,false);s.click('camera-live-create');await until(()=>!!s.$('camera-live-offer-out').value);
  const owner=s.sessions[0],offer=JSON.parse(s.$('camera-live-offer-out').value);
  assert.equal(owner.operatorLocationPin,locationPin);assert.equal(owner.contextJson,context);assert.equal(offer.version,2);
  assert.equal(owner.hints.context_sha256,await cameraContextHash(context));assert.equal(owner.hints.location_profile,'raw-gnss');
  assert.equal(owner.hints.hardware_attestation_required,true);assert.equal(owner.hints.independent_position_required,true);
  assert.deepEqual(s.calls,[]);assert.equal(s.$('camera-live-context').disabled,true);assert.equal(s.$('camera-live-context-file').disabled,true);
});

test('independent position cannot silently change a non-raw location profile',async t=>{
  const s=setup(t);setComposed(s);s.$('camera-live-position').checked=true;s.click('camera-live-create');
  await until(()=>s.$('camera-live-status').textContent.includes('raw'));assert.equal(s.sessions.length,0);assert.deepEqual(s.calls,[]);
  assert.equal(s.$('camera-live-location-profile').value,'browser-or-native');
});

test('image-only UI preserves three hint fields and does not load or export a location identity',async t=>{
  let locationReads=0;const s=setup(t,{getLocationPin:async()=>{locationReads++;return locationPin;}});
  assert.equal(s.$('camera-live-composed-options').hidden,true);s.click('camera-live-create');await until(()=>!!s.$('camera-live-offer-out').value);
  assert.deepEqual(Object.keys(s.sessions[0].hints).sort(),['assurance','requester','task']);assert.equal(s.sessions[0].operatorLocationPin,null);
  assert.equal(locationReads,0);assert.equal(s.$('camera-live-save-location').hidden,true);
});

test('reading the separate public location ID starts no pairing or permission preparation',async t=>{
  const s=setup(t);s.click('camera-live-location-identity');await until(()=>s.$('camera-live-own-location-pin').textContent===locationPin);
  assert.equal(s.sessions.length,0);assert.deepEqual(s.calls,[]);
});

test('composed operator consent displays both signing IDs and precise location requirements',async t=>{
  const s=setup(t,{native:true}),offer=await composedOffer(s,{profile:'raw-gnss'});
  s.click('camera-live-join');await until(()=>!!s.$('camera-live-answer-out').value);
  assert.equal(s.sessions[0].operatorLocationPin,locationPin);assert.equal(s.sessions[0].contextJson,s.$('camera-live-operator-context').value);
  for(const part of [pin,locationPin,'raw satellite measurements required','Both signer attestations required: no','Independent position recomputation required: no',offer.hints.context_sha256])assert.ok(s.$('camera-live-agreed').textContent.includes(part),part);
  assert.deepEqual(s.calls,['preflight','join']);assert.equal(s.$('camera-live-arm').disabled,true);
  s.sessions[0].phase='connected';s.sessions[0].onState({phase:'connected'});s.click('camera-live-arm');await until(()=>s.calls.includes('arm'));assert.equal(s.calls.includes('start'),false);
});

test('operator context whitespace substitution fails before permissions or a session exist',async t=>{
  const s=setup(t,{native:true});await composedOffer(s);s.$('camera-live-operator-context').value='{"version":1}';s.click('camera-live-join');
  await until(()=>s.$('camera-live-status').textContent.includes('does not match'));assert.equal(s.sessions.length,0);assert.deepEqual(s.calls,[]);
});

test('a different location key rejects composed pairing before permission preparation',async t=>{
  const s=setup(t,{native:true});await composedOffer(s,{location:'f'.repeat(64)});s.click('camera-live-join');
  await until(()=>s.$('camera-live-status').textContent.includes('different location signing ID'));assert.equal(s.sessions.length,0);assert.deepEqual(s.calls,[]);
});

test('location key replacement during permission preparation cannot publish an answer',async t=>{
  let reads=0;const s=setup(t,{native:true,getLocationPin:async()=>++reads===1?locationPin:'f'.repeat(64)});await composedOffer(s);s.click('camera-live-join');
  await until(()=>s.$('camera-live-status').textContent.includes('location identity changed'));assert.equal(s.sessions.length,0);assert.deepEqual(s.calls,['preflight']);assert.equal(s.$('camera-live-answer-out').value,'');
});

test('an operator context edit during an asynchronous identity read prevents permission warmup even without an input event',async t=>{
  let finish;const s=setup(t,{native:true,getOperatorPin:()=>new Promise(resolve=>finish=resolve)});await composedOffer(s);s.click('camera-live-join');await until(()=>finish);
  s.$('camera-live-operator-context').value='{"version":1}';finish(pin);await until(()=>s.$('camera-live-status').textContent.includes('inputs changed'));
  assert.equal(s.sessions.length,0);assert.deepEqual(s.calls,[]);
});

test('a requester context edit while its digest is pending cannot create a stale pairing',async t=>{
  const s=setup(t);setComposed(s);s.click('camera-live-create');s.$('camera-live-context').value='{"version":1}';s.$('camera-live-context').dispatchEvent(new Event('input'));
  await until(()=>!s.$('camera-live-create').disabled);assert.equal(s.sessions.length,0);assert.equal(s.$('camera-live-offer-out').value,'');
});

test('composed result exports the original proof envelope and preserves exact requester context in the bundle',async t=>{
  const s=setup(t),context=setComposed(s);s.click('camera-live-create');await until(()=>!!s.$('camera-live-offer-out').value);
  const result={role:'requester',sessionId:pairing,bytes:new Uint8Array([255,216,255,217]),locationProof:new Uint8Array([1,2,3,4]),bundle:{version:2,context_json:context},report:{verified:true,fresh_action_eligible:true}};
  s.sessions[0].phase='complete';s.sessions[0].onComplete(result);assert.equal(s.$('camera-live-save-location').hidden,false);
  s.click('camera-live-save-location');await until(()=>s.saved.length===1);assert.deepEqual(readLocationProofEnvelope(s.saved[0][2]),result.locationProof);assert.match(s.saved[0][0],/-location.json$/);
  s.click('camera-live-save-bundle');await until(()=>s.saved.length===2);assert.equal(JSON.parse(s.saved[1][2]).context_json,context);assert.equal(s.calls.includes('accept'),false);
});

test('context import preserves exact valid UTF-8 whitespace and blocks pairing until complete',async t=>{
  const s=setup(t),value='{ "version": 1 }\n';let finish;const file=contextFile(value);file.arrayBuffer=()=>new Promise(resolve=>finish=resolve);
  selectFile(s,'camera-live-context-file',file);assert.equal(s.$('camera-live-create').disabled,true);s.click('camera-live-create');assert.equal(s.sessions.length,0);
  finish(new TextEncoder().encode(value).buffer);await until(()=>!s.$('camera-live-create').disabled);assert.equal(s.$('camera-live-context').value,value);
});

test('a replaced context file cannot overwrite its newer selection when the older read finishes last',async t=>{
  const s=setup(t);let finish;selectFile(s,'camera-live-context-file',{size:20,arrayBuffer:()=>new Promise(resolve=>finish=resolve)});
  const latest='{  "version":1}\n';selectFile(s,'camera-live-context-file',contextFile(latest));await until(()=>s.$('camera-live-context').value===latest);
  finish(new TextEncoder().encode('{"version": 1}').buffer);await tick();await tick();assert.equal(s.$('camera-live-context').value,latest);
});

test('manual context edit without an event prevents an older file read from overwriting it',async t=>{
  const s=setup(t);let finish;selectFile(s,'camera-live-context-file',{size:20,arrayBuffer:()=>new Promise(resolve=>finish=resolve)});
  const manual='{ "version":1 }';s.$('camera-live-context').value=manual;finish(new TextEncoder().encode('{"version": 1}').buffer);
  await until(()=>!s.$('camera-live-create').disabled);assert.equal(s.$('camera-live-context').value,manual);
});

test('leaving during context import discards its late result and permits a fresh configuration',async t=>{
  const s=setup(t);let finish;selectFile(s,'camera-live-context-file',{size:20,arrayBuffer:()=>new Promise(resolve=>finish=resolve)});
  s.event('pagehide');assert.equal(s.$('camera-live-create').disabled,false);finish(new TextEncoder().encode('{"version": 1}').buffer);await tick();await tick();
  assert.equal(s.$('camera-live-context').value,'{"version":1}');assert.equal(s.sessions.length,0);
});

for(const [name,file] of [['oversized',{size:4194305,arrayBuffer:async()=>{throw new Error('must not read oversized input');}}],
  ['invalid UTF-8',{size:2,arrayBuffer:async()=>new Uint8Array([0xc3,0x28]).buffer}],
  ['UTF-8 BOM',{size:16,arrayBuffer:async()=>new Uint8Array([0xef,0xbb,0xbf,...new TextEncoder().encode('{"version":1}')]).buffer}],
  ['unknown context field',contextFile('{"version":1,"injected":true}')]]){
  test(`context import rejects ${name} without substituting verifier inputs`,async t=>{
    const s=setup(t);selectFile(s,'camera-live-context-file',file);await until(()=>!s.$('camera-live-create').disabled);
    assert.equal(s.$('camera-live-context').value,'{"version":1}');assert.notEqual(s.$('camera-live-status').textContent,'');assert.equal(s.sessions.length,0);
  });
}

test('an input snapshot change during acceptance blocks its commit guard without relying on a DOM event',async t=>{
  let finish,commits=0,guardChecked=false;const s=setup(t,{accept:async guard=>{await new Promise(resolve=>finish=resolve);guardChecked=true;if(!guard())throw new Error('Inputs no longer current');commits++;return true;}});
  setComposed(s);s.click('camera-live-create');await until(()=>!!s.$('camera-live-offer-out').value);
  const value={role:'requester',sessionId:pairing,bytes:new Uint8Array([1]),locationProof:new Uint8Array([2]),bundle:{},report:{fresh_action_eligible:true}};
  s.sessions[0].phase='complete';s.sessions[0].onComplete(value);s.click('camera-live-accept');await until(()=>finish);
  s.$('camera-live-context').value='{"version":1}';finish();await until(()=>guardChecked);await tick();assert.equal(commits,0);assert.equal(value.accepted,undefined);
});


test('a composed dispatched phase reports waiting for both artifacts using the controller phase name',async t=>{
  const s=setup(t);setComposed(s);s.click('camera-live-create');await until(()=>!!s.$('camera-live-offer-out').value);
  s.sessions[0].phase='awaiting-image';s.sessions[0].onState({phase:'awaiting-image'});
  assert.match(s.$('camera-live-status').textContent,/both the signed JPEG and matching location proof/);
});

test('requester context import retains original CRLF bytes despite textarea newline normalization',async t=>{
  const s=setup(t);setComposed(s);const original='{\r\n  "version": 1\r\n}\r\n';selectFile(s,'camera-live-context-file',contextFile(original));await until(()=>!s.$('camera-live-create').disabled);
  assert.equal(s.$('camera-live-context').value,original.replace(/\r\n/g,'\n'));s.click('camera-live-create');await until(()=>!!s.$('camera-live-offer-out').value);
  assert.equal(s.sessions[0].contextJson,original);assert.equal(s.sessions[0].hints.context_sha256,await cameraContextHash(original));
});

test('operator imported CRLF context matches the offer by original bytes rather than normalized display text',async t=>{
  const s=setup(t,{native:true}),context='{\r\n"version":1\r\n}';await composedOffer(s,{context});
  selectFile(s,'camera-live-operator-context-file',contextFile(context));await until(()=>!s.$('camera-live-join').disabled);
  s.click('camera-live-join');await until(()=>!!s.$('camera-live-answer-out').value);assert.equal(s.sessions[0].contextJson,context);
});

test('manual input invalidates retained file bytes even when the normalized visible text is unchanged',async t=>{
  const s=setup(t);setComposed(s);const context='{\r\n"version":1\r\n}';selectFile(s,'camera-live-context-file',contextFile(context));await until(()=>!s.$('camera-live-create').disabled);
  s.$('camera-live-context').dispatchEvent(new Event('input'));s.click('camera-live-create');await until(()=>!!s.$('camera-live-offer-out').value);
  assert.equal(s.sessions[0].contextJson,context.replace(/\r\n/g,'\n'));assert.notEqual(s.sessions[0].hints.context_sha256,await cameraContextHash(context));
});

const usbToken='0123456789abcdef0123456789abcdef';
function usbOperator(s,token=usbToken){
  s.$('camera-live-role').value='operator';s.$('camera-live-role').dispatchEvent(new Event('change'));
  s.$('camera-live-usb-token').value=token;s.$('camera-live-usb-token').dispatchEvent(new Event('input'));
}
test('USB offer controls stay hidden without the debug native bridge',async t=>{
  const browser=setup(t);usbOperator(browser);assert.equal(browser.$('camera-live-usb-offer-panel').hidden,true);
  assert.equal(browser.$('camera-live-usb-load').disabled,true);browser.click('camera-live-usb-load');assert.equal(browser.sessions.length,0);
});
test('USB offer controls require exact tokens and an empty field',async t=>{
  let reads=0;const native=setup(t,{native:true,nativePairing:{readOffer:()=>{reads++;return native.offer();}}});
  assert.equal(native.$('camera-live-usb-offer-panel').hidden,false);
  for(const value of ['',usbToken.slice(1),usbToken+'0',usbToken.toUpperCase(),' '+usbToken,'z'.repeat(32)]){
    usbOperator(native,value);assert.equal(native.$('camera-live-usb-load').disabled,true);native.click('camera-live-usb-load');
  }
  usbOperator(native);native.$('camera-live-offer-in').value='existing offer';native.$('camera-live-offer-in').dispatchEvent(new Event('input'));
  assert.equal(native.$('camera-live-usb-load').disabled,true);native.click('camera-live-usb-load');
  assert.equal(reads,0);assert.equal(native.$('camera-live-offer-in').value,'existing offer');
});

test('explicit USB import preserves the offer and independent requester pin without identities, permissions or automatic join',async t=>{
  let reads=0,identities=0,source;
  const s=setup(t,{native:true,nativePairing:{readOffer:token=>{assert.equal(token,usbToken);reads++;return source;}},
    getOperatorPin:async()=>{identities++;return pin;},getLocationPin:async()=>{identities++;return locationPin;}});
  source='\n  '+s.offer()+'\n';usbOperator(s);s.$('camera-live-requester-pin').value='f'.repeat(64);
  s.click('camera-live-usb-load');await until(()=>!s.$('camera-live-offer-in').disabled);
  assert.equal(s.$('camera-live-offer-in').value,source);assert.equal(reads,1);assert.equal(identities,0);
  assert.equal(s.$('camera-live-requester-pin').value,'f'.repeat(64));assert.deepEqual(s.calls,[]);assert.equal(s.sessions.length,0);
  assert.equal(s.$('camera-live-usb-load').disabled,true);assert.match(s.$('camera-live-status').textContent,/No pairing or capture/);
  s.click('camera-live-join');await until(()=>s.$('camera-live-status').textContent.includes('trusted channel'));
  assert.equal(identities,0);assert.deepEqual(s.calls,[]);assert.equal(s.sessions.length,0);
});

test('USB import accepts the byte limit and rejects malformed, wrong-shape and multibyte oversized offers',async t=>{
  let source;const s=setup(t,{native:true,nativePairing:{readOffer:()=>source}});usbOperator(s);
  const invalid=[['malformed','{'],['wrong-shape','{}'],['empty',''],['oversized','x'.repeat(120001)],['not text',{}]];
  const multi=JSON.parse(s.offer());multi.description={sdp:'é'.repeat(60000)};invalid.push(['UTF8 byte overflow',JSON.stringify(multi)]);
  for(const [label,value]of invalid){
    source=value;s.click('camera-live-usb-load');await until(()=>!s.$('camera-live-usb-token').disabled);
    assert.equal(s.$('camera-live-offer-in').value,'',label);assert.equal(s.sessions.length,0,label);assert.deepEqual(s.calls,[],label);
  }
  const exact=JSON.parse(s.offer());exact.description={sdp:''};
  const padding=120000-new TextEncoder().encode(JSON.stringify(exact)).length;exact.description.sdp='x'.repeat(padding);source=JSON.stringify(exact);
  assert.equal(new TextEncoder().encode(source).length,120000);
  s.click('camera-live-usb-load');await until(()=>!s.$('camera-live-usb-token').disabled);
  assert.equal(s.$('camera-live-offer-in').value,source);assert.equal(s.sessions.length,0);
});

test('USB native errors leave all independently entered fields intact',async t=>{
  let throws=false;const s=setup(t,{native:true,nativePairing:{readOffer:()=>{if(throws)throw new Error('Native read stopped');return null;},lastError:()=> 'Staged offer unavailable'}});
  usbOperator(s);s.$('camera-live-requester-pin').value=requesterPin;s.$('camera-live-operator-context').value='{ "version":1 }';
  for(const expected of ['Staged offer unavailable','Native read stopped']){
    s.click('camera-live-usb-load');await until(()=>!s.$('camera-live-usb-token').disabled);
    assert.equal(s.$('camera-live-status').textContent,expected);assert.equal(s.$('camera-live-offer-in').value,'');
    assert.equal(s.$('camera-live-requester-pin').value,requesterPin);assert.equal(s.$('camera-live-operator-context').value,'{ "version":1 }');throws=true;
  }
  assert.deepEqual(s.calls,[]);assert.equal(s.sessions.length,0);
});

for(const interruption of ['manual offer','token edit','cancel','hidden','pagehide','nonverba:pause']){
  test(`USB offer read cannot overwrite state after ${interruption}`,async t=>{
    let release,reads=0;const s=setup(t,{native:true,nativePairing:{readOffer:()=>{reads++;return new Promise(resolve=>release=resolve);}}});
    usbOperator(s);s.click('camera-live-usb-load');await until(()=>release);s.click('camera-live-usb-load');
    assert.equal(reads,1);assert.equal(s.$('camera-live-join').disabled,true);assert.equal(s.$('camera-live-cancel').disabled,false);
    if(interruption==='manual offer')s.$('camera-live-offer-in').value='manual offer retained';
    else if(interruption==='token edit'){s.$('camera-live-usb-token').value='f'.repeat(32);s.$('camera-live-usb-token').dispatchEvent(new Event('input'));}
    else if(interruption==='cancel')s.click('camera-live-cancel');
    else if(interruption==='hidden'){s.doc.hidden=true;s.doc.dispatchEvent(new Event('visibilitychange'));}
    else s.event(interruption);
    release(s.offer());await until(()=>!s.$('camera-live-usb-token').disabled);
    assert.equal(s.$('camera-live-offer-in').value,interruption==='manual offer'?'manual offer retained':'');
    assert.equal(s.sessions.length,0);assert.deepEqual(s.calls,[]);
  });
}

test('USB offer import is blocked during another operation or a live session',async t=>{
  let reads=0,release;const s=setup(t,{native:true,nativePairing:{readOffer:()=>{reads++;return s.offer();}},
    getOperatorPin:()=>new Promise(resolve=>release=resolve)});
  usbOperator(s);s.click('camera-live-identity');await until(()=>release);s.click('camera-live-usb-load');assert.equal(reads,0);
  release(pin);await until(()=>!s.$('camera-live-usb-token').disabled);
  s.$('camera-live-role').value='requester';s.$('camera-live-role').dispatchEvent(new Event('change'));s.click('camera-live-create');await until(()=>!!s.$('camera-live-offer-out').value);
  s.click('camera-live-usb-load');assert.equal(reads,0);assert.equal(s.$('camera-live-offer-in').value,'');
});

test('unsupported composed location capability rejects before camera permission warmup or answer creation',async t=>{
  let checks=0,identityReads=0;const s=setup(t,{native:true,getOperatorPin:async()=>{identityReads++;return pin;},
    checkLocationProfile:profile=>{checks++;assert.equal(profile,'raw-gnss');throw new Error('Raw satellite API unavailable');}});
  await composedOffer(s,{profile:'raw-gnss'});s.click('camera-live-join');await until(()=>s.$('camera-live-status').textContent.includes('Raw satellite API unavailable'));
  assert.equal(checks,1);assert.equal(identityReads,0);assert.equal(s.sessions.length,0);assert.deepEqual(s.calls,[]);
});

test('composed capability is rechecked at explicit arm before permission recheck or consent',async t=>{
  let available=true,checks=0,permissionChecks=0;const s=setup(t,{native:true,
    checkLocationProfile:()=>{checks++;if(!available)throw new Error('Raw satellite API became unavailable');},
    checkPermissions:()=>{permissionChecks++;}});
  await composedOffer(s,{profile:'raw-gnss'});s.click('camera-live-join');await until(()=>!!s.$('camera-live-answer-out').value);
  assert.equal(checks,1);available=false;s.sessions[0].phase='connected';s.sessions[0].onState({phase:'connected'});s.click('camera-live-arm');
  await until(()=>s.$('camera-live-status').textContent.includes('became unavailable'));
  assert.equal(checks,2);assert.equal(permissionChecks,0);assert.equal(s.calls.includes('arm'),false);
});
