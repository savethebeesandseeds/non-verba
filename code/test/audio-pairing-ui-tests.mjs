// SPDX-License-Identifier: AGPL-3.0-only
// Actual audio page handlers + real Rust/WASM requester crypto. Browser DOM,
// Worker, RTC and IndexedDB are bounded test doubles; no microphone/playback.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadShippedCore} from '../tools/image-requester-session.mjs';
const {core}=await loadShippedCore(),databases=new Map(),clone=structuredClone,calls=[];
function db(){return {stores:new Map(),get objectStoreNames(){return {contains:name=>this.stores.has(name)};},createObjectStore(name){this.stores.set(name,new Map());},close(){},transaction(names,mode='readonly'){
  names=Array.isArray(names)?names:[names];const owner=this,stores=new Map(names.map(n=>[n,clone(owner.stores.get(n))]));
  const tx={pending:0,aborted:false,ended:false,abort(){if(this.ended)return;this.aborted=true;this.ended=true;setImmediate(()=>this.onabort?.());},objectStore(name){return {
    get:key=>op(()=>clone(stores.get(name).get(key))),getAll:()=>op(()=>clone([...stores.get(name).values()])),
    put:(value,key)=>op(()=>stores.get(name).set(key,clone(value))),add:(value,key)=>op(()=>{if(stores.get(name).has(key))throw new Error('ConstraintError');stores.get(name).set(key,clone(value));})};}};
  function op(body){const request={};tx.pending++;setImmediate(()=>{if(tx.aborted)return;try{request.result=body();request.onsuccess?.();}catch(error){tx.error=error;tx.abort();}finally{tx.pending--;if(!tx.pending&&!tx.aborted){tx.ended=true;if(mode==='readwrite')for(const[n,v]of stores)owner.stores.set(n,v);tx.oncomplete?.();}}});return request;}return tx;
}};}
globalThis.indexedDB={open(name){let fresh=false;if(!databases.has(name)){databases.set(name,db());fresh=true;}const r={result:databases.get(name)};setImmediate(()=>{if(fresh)r.onupgradeneeded?.();r.onsuccess?.();});return r;}};
class Element extends EventTarget{value='';textContent='';disabled=false;hidden=false;files=[];attrs=new Map();classList={toggle(){}};pause(){}load(){}setAttribute(k,v){this.attrs.set(k,v);}removeAttribute(k){this.attrs.delete(k);}hasAttribute(k){return this.attrs.has(k);}replaceChildren(){}append(){}remove(){}click(){this.dispatchEvent(new Event('click'));}}
const html=await readFile(new URL('../../web/src/audio.html',import.meta.url),'utf8'),elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
const document=globalThis.document=Object.assign(new EventTarget(),{hidden:false,getElementById:id=>{assert.ok(elements.has(id),id);return elements.get(id);},querySelectorAll:()=>[],createElement:()=>new Element()});
const window=globalThis.window=Object.assign(new EventTarget(),{crypto:globalThis.crypto,NativeVault:{}});globalThis.NativeVault=window.NativeVault;
globalThis.AudioContext=class{constructor(){assert.fail('No audio device may be opened in pairing tests.');}};
globalThis.Worker=class{constructor(){setImmediate(()=>this.onmessage?.({data:{ready:true}}));}postMessage({id,method,args}){calls.push(method);Promise.resolve().then(()=>core[method](...args)).then(value=>this.onmessage?.({data:{id,value}}),error=>this.onmessage?.({data:{id,error:String(error)}}));}};
const peers=[];const SDP='v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n';
globalThis.RTCPeerConnection=class extends EventTarget{constructor(){super();this.iceGatheringState='complete';peers.push(this);}createDataChannel(label){return this.channel=Object.assign(new EventTarget(),{label,ordered:true,maxRetransmits:null,maxPacketLifeTime:null,readyState:'open',bufferedAmount:0,sent:[],send(value){this.sent.push(JSON.parse(value));},close(){this.readyState='closed';}});}async createOffer(){return {type:'offer',sdp:SDP};}async setLocalDescription(value){this.localDescription={toJSON:()=>value};}async setRemoteDescription(value){this.remote=value;}close(){this.closed=true;}};
const $=id=>elements.get(id),tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let n=0;n<300;n++){if(check())return;await tick();}throw new Error('Audio UI did not settle: '+$('audio-status').textContent+' / '+$('audio-notice').textContent);}
function nativeEvent(active){const event=new Event('nonverba:file-picker');Object.defineProperty(event,'detail',{value:{active}});window.dispatchEvent(event);}
async function action(id){$(id).click();await until(()=>!$(id).hasAttribute('aria-busy'));}
const mediaPin=JSON.parse(core.create_identity()).fingerprint;
await import('../../web/src/audio-ui.js');await until(()=>$('audio-runtime').textContent==='LOCAL ENGINE READY');
async function offer(){document.hidden=false;$('audio-requester-name').value='Synthetic requester';$('audio-task').value='Silent actual handler fixture';$('audio-duration').value='4';$('audio-assurance').value='browser-or-android';$('audio-operator-pin').value=mediaPin;
  await action('audio-create');assert.equal($('audio-answer-file').disabled,false);return JSON.parse($('audio-offer').value);}
function answer(value){return JSON.stringify({version:2,type:'nonverba-audio-answer',pairing_id:value.pairing_id,requester_pin:value.requester_pin,operator_pin:value.operator_pin,description:{type:'answer',sdp:SDP}});}
function beginPicker(){ $('audio-answer-file').click();nativeEvent(true);document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('nonverba:pause'));}
function endPicker(value){document.hidden=false;nativeEvent(false);$('audio-answer-file').files=[{size:value.length,text:async()=>value}];$('audio-answer-file').dispatchEvent(new Event('change'));}
function cleanup(){document.hidden=false;window.dispatchEvent(new Event('pagehide'));}

test('actual Android-style answer-file handlers preserve pairing, recreate same requester and dispatch only after connection',async t=>{
  t.after(cleanup);const before=calls.filter(x=>x==='create_audio_request').length,value=await offer();beginPicker();assert.equal($('audio-connect').disabled,false);
  assert.equal(calls.filter(x=>x==='create_audio_request').length,before);const response=answer(value);endPicker(response);await until(()=>$('audio-answer-input').value===response);
  await action('audio-connect');const peer=peers.at(-1);assert.equal(peer.remote.type,'answer');peer.channel.onopen();await until(()=>peer.channel.sent.some(x=>x.type==='session-request'));
  const envelope=peer.channel.sent.find(x=>x.type==='session-request').envelope;const payload=JSON.parse(core.validate_evidence_session_request(envelope,value.requester_pin,JSON.stringify({media_certificate_sha256:mediaPin,location_spki_sha256:null}),Math.floor(Date.now()/1000)));
  assert.equal(payload.spec.evidence.type,'audio');assert.equal(payload.requester_pin.sha256,value.requester_pin);assert.equal(calls.filter(x=>x==='create_audio_request').length,before+1);
});
test('actual pagehide during the own picker cancels and rejects its late answer',async t=>{
  t.after(cleanup);const value=await offer();$('audio-answer-input').value='retained-before-picker';beginPicker();window.dispatchEvent(new Event('pagehide'));
  endPicker(answer(value));await tick();await tick();assert.equal($('audio-answer-input').value,'retained-before-picker');assert.equal($('audio-connect').disabled,true);
});
test('native pause without clicked import intent still fails pairing',async t=>{
  t.after(cleanup);await offer();nativeEvent(true);window.dispatchEvent(new Event('nonverba:pause'));assert.equal($('audio-connect').disabled,true);assert.match($('audio-status').textContent,/Session stopped/);
});
test('file-picker signal cannot preserve a dispatched challenge or enable a second answer import',async t=>{
  t.after(cleanup);const value=await offer();$('audio-answer-input').value=answer(value);await action('audio-connect');const peer=peers.at(-1);peer.channel.onopen();await until(()=>peer.channel.sent.some(x=>x.type==='session-request'));
  assert.equal($('audio-answer-file').disabled,true);nativeEvent(true);window.dispatchEvent(new Event('nonverba:pause'));assert.match($('audio-status').textContent,/Session stopped/);assert.equal($('audio-connect').disabled,true);
});

test('monitored audio offer fails before pairing or challenge when native capture is absent',async t=>{
  t.after(cleanup);cleanup();const beforePeers=peers.length,beforeRequests=calls.filter(method=>method==='create_audio_request').length;
  const requesterPin=JSON.parse(core.live_requester_identity(core.create_identity())).pin.sha256;
  $('audio-requester-pin').value=requesterPin;
  $('audio-offer-input').value=JSON.stringify({version:2,type:'nonverba-audio-offer',pairing_id:'a'.repeat(64),requester_pin:requesterPin,
    operator_pin:mediaPin,hints:{requester:'Synthetic requester',task:'No audio may start',duration_secs:10,assurance:'android-monitored'},description:{type:'offer',sdp:SDP}});
  await action('audio-join');assert.match($('audio-notice').textContent,/requires Android monitored recording/);
  assert.equal(peers.length,beforePeers);assert.equal(calls.filter(method=>method==='create_audio_request').length,beforeRequests);
});
