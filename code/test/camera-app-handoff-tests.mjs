// SPDX-License-Identifier: AGPL-3.0-only
// Actual app.js handlers and CameraCaptureHandoff. Imports/Worker/DOM/storage and
// acquisition/crypto are test doubles: this exercises orchestration, not sensors,
// signatures, WebRTC, physical Android lifecycle or browser implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,Script} from 'node:vm';
import {CameraCaptureHandoff,sameCaptureRequest} from '../../web/src/camera-session-capture.js';
import {splitCameraRequest,CAMERA_LOCATION_REQUEST} from '../../web/src/camera-location.js';
import {locationPolicy,locationTimingSummary,locationSealingSummary} from '../../web/src/location-policy.js';
import {newRequestPreset,installRequestPresetSummary} from '../../web/src/request-presets.js';
import {createCoreClient} from '../../web/src/core-client.js';
if(process.platform!=='linux'||process.env.NONVERBA_CONTAINER!=='1')throw new Error('Run inside non-verba-dev.');
const appUrl=new URL('../../web/src/app.js',import.meta.url);
const source=await readFile(appUrl,'utf8'),html=await readFile(new URL('../../web/src/index.html',import.meta.url),'utf8');
// Only module linkage is replaced. Execute the complete, unexported page handlers.
const body=source.replace(/^import .*;\r?$/gm,'').replaceAll('import.meta.url',JSON.stringify(appUrl.href));
const mediaPin='a'.repeat(64),locationPin='b'.repeat(64),replacementPin='c'.repeat(64);
const jpeg=new Uint8Array([255,216,17,18,255,217]),proof=new Uint8Array([1,2,3]);
const location={latitude:1,longitude:2,accuracy_m:10,timestamp_ms:Date.now(),source:'device-geolocation'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function until(check,detail=()=>'' ){for(let n=0;n<150;n++){if(check())return;await tick();}throw new Error('App did not settle: '+detail());}
class Element extends EventTarget{
  value='';textContent='';disabled=false;hidden=false;files=[];lastChild={textContent:''};attrs=new Map();
  classList={toggle(){},add(){},remove(){}};videoWidth=640;videoHeight=480;
  setAttribute(name,value){this.attrs.set(name,value);}removeAttribute(name){this.attrs.delete(name);}hasAttribute(name){return this.attrs.has(name);}
  replaceChildren(){}append(){}scrollIntoView(){}play(){return Promise.resolve();}
  click(){this.dispatchEvent(new Event('click'));}
}
async function harness(t,{native=true,beginGate,finalizeGate,verifyGate,nativeGate,concurrentGate}={}){
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  const elements=new Map(ids.map(id=>[id,Object.assign(new Element(),{id})]));
  const $=id=>{assert.ok(elements.has(id),id);return elements.get(id);};
  $('view-requester').hidden=true;$('view-verify').hidden=true;
  for(const id of ['capture-preview','download-bar','download-location-proof','loaded-challenge','camera-location-key'])$(id).hidden=true;
  const state={native,locationNative:native,key:locationPin,mediaKey:mediaPin,calls:[],reserved:[],begin:[],finalize:[],cancelled:0,shutter:deferred(),beginGate,finalizeGate,verifyGate,nativeGate,concurrentGate,concurrent:[],concurrentCancelled:0};
  const document=Object.assign(new EventTarget(),{hidden:false,getElementById:$,
    querySelectorAll:selector=>selector==='.view'?['view-requester','view-operator','view-verify'].map($):[],
    createElement:tag=>tag==='canvas'?{getContext:()=>({drawImage(){state.calls.push('frame');}}),toBlob:callback=>callback(new Blob([jpeg]))}:new Element()});
  const window=Object.assign(new EventTarget(),{innerWidth:1000});
  const track=Object.assign(new EventTarget(),{stop(){state.calls.push('stop-track');}});
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  const storedIdentity=JSON.stringify({fingerprint:mediaPin});
  function message(target,data){target.onmessage?.({data});const event=new Event('message');Object.defineProperty(event,'data',{value:data});target.dispatchEvent(event);}
  class Worker extends EventTarget{
    constructor(){super();setImmediate(()=>message(this,{ready:true}));}
    postMessage({id,method,args}){state.calls.push(method);Promise.resolve().then(async()=>{
      if(['validate_challenge','validate_location_request','validate_location'].includes(method))return args[0];
      if(['seal_image','seal_image_with_location_request'].includes(method))return jpeg.slice();
      if(['verify_image','verify_image_with_location_proof'].includes(method)){
        const gate=state.verifyGate;if(gate)await gate.promise;
        return JSON.stringify({verified:true,checks:{native_camera_metadata_valid:true},capture:{location}});
      }
      throw new Error('Unexpected core method: '+method);
    }).then(value=>message(this,{id,value}),error=>message(this,{id,error:String(error)}));}
  }
  const dependencies={
    createCoreClient:()=>createCoreClient({Worker}),
    read:async()=>undefined,write:async()=>{},values:async()=>[],reserveCapture:async id=>state.reserved.push(id),
    loadIdentity:async()=>storedIdentity,saveIdentity:async()=>{},retainCameraEvidence:()=>assert.fail('No requester acceptance during acquisition'),
    freshLocation:async()=>location,locationSummary:()=> 'Synthetic location',locationTimingSummary,locationSealingSummary,
    beginLocationCollection:async options=>{state.begin.push(options);const gate=state.beginGate;if(gate)await gate.promise;
      return {selected:location,request:structuredClone(options.request),cancel(){state.cancelled++;}};},
    startConcurrentLocationCollection:async options=>{
      state.calls.push('begin-concurrent-location');state.concurrent.push(options);
      const collection={selected:location,request:structuredClone(options.request),cancel(){state.cancelled++;}};
      let cancelled=false,rejectCancelled;
      const cancellation=new Promise((_,reject)=>{rejectCancelled=reject;});
      const cancel=()=>{if(cancelled)return;cancelled=true;state.concurrentCancelled++;rejectCancelled(new DOMException('Location collection cancelled.','AbortError'));};
      options.signal.addEventListener('abort',cancel,{once:true});
      const ready=Promise.race([concurrentGate?concurrentGate.promise:Promise.resolve(),cancellation]).then(()=>collection);
      ready.finally(()=>options.signal.removeEventListener('abort',cancel)).catch(()=>{});
      if(options.signal.aborted)cancel();
      return {ready,cancel,async selectForCamera(){
        if(cancelled||options.signal.aborted)throw new DOMException('Location collection cancelled.','AbortError');
        state.calls.push('select-concurrent-location');return location;
      }};
    },
    finalizeLocationProof:async options=>{state.finalize.push(options);const gate=state.finalizeGate;if(gate)await gate.promise;return proof.slice();},
    getLocationIdentity:async()=>({fingerprint:state.key}),locationPlatform:()=>({native:state.locationNative,capabilities:{fine_permission:true}}),
    splitCameraRequest,CAMERA_LOCATION_REQUEST,createCameraRequest:()=>assert.fail('No new challenge may be made while loading'),
    encodeLocationProof:()=>'',readLocationProof:()=>assert.fail('No proof import while acquiring'),
    nativeCameraPlatform:()=>state.native?{fingerprint:state.mediaKey,capabilities:{camera_permission:true}}:null,
    collectNativeCamera:async options=>{
      state.nativeOptions=options;const gate=state.nativeGate;
      state.calls.push('open-native-camera');options.onProgress('preview');await state.shutter.promise;
      options.onProgress('awaiting-location');await options.acquireLocation();
      state.calls.push('native-exposure');options.onProgress('capturing');options.onProgress('sealing');
      if(gate)await gate.promise;
      options.onProgress('complete');return {bytes:jpeg.slice(),fingerprint:mediaPin};
    },
    CameraCaptureHandoff,sameCaptureRequest,
    installCameraSessionUI:options=>{state.ui=options;return {cancel(){}};},prepareCameraPermissions:async()=>{},
    installRetainedEvidenceUI:()=>({clear(){},dispose(){}}),
    installCameraQualityUI:()=>{},
    newRequestPreset,installRequestPresetSummary,
  };
  const context=createContext({...dependencies,document,window,Worker,Uint8Array,ArrayBuffer,Blob,URL,DOMException,AbortController,
    structuredClone,TextEncoder,Date,Promise,console,setTimeout,clearTimeout,setInterval:()=>1,
    navigator:{mediaDevices:{getUserMedia:async options=>{assert.equal(options.audio,false);state.calls.push('open-browser-camera');return stream;}}}});
  new Script(body,{filename:appUrl.pathname}).runInContext(context);
  await until(()=>$('runtime').lastChild.textContent==='Local engine ready');
  const action=async id=>{$(id).click();await until(()=>!$(id).hasAttribute('aria-busy'),()=>$('notice').textContent);};
  t.after(()=>{state.shutter.resolve();beginGate?.resolve();finalizeGate?.resolve();verifyGate?.resolve();nativeGate?.resolve();concurrentGate?.resolve();});
  return {state,$,document,window,action,async open(){if(!native)return action('start-camera');
    const previous=state.nativeOptions;$('start-camera').click();await until(()=>state.nativeOptions&&state.nativeOptions!==previous,()=>$('notice').textContent);},
    async shutter(){if(native){state.shutter.resolve();await until(()=>!$('start-camera').hasAttribute('aria-busy'),()=>$('notice').textContent);}else await action('capture');}};
}
function spec({native=true,composed=true,profile=native?'native-gnss':'browser-or-native',concurrent=false}={}){
  const now=Math.floor(Date.now()/1000),challenge={version:1,id:'d'.repeat(64),requester:'Synthetic requester',task:'Synthetic capture',nonce:'synthetic',issued_at:now,expires_at:now+300};
  const request=composed?{version:1,type:'nonverba-location-request',challenge:structuredClone(challenge),policy:locationPolicy(profile),context:{session_id:challenge.id,purpose:'camera'}}:null;
  if(concurrent)request.context.camera_timing='concurrent';
  const controller=new AbortController();
  return {challenge,locationRequest:request,operatorPin:mediaPin,operatorLocationPin:composed?locationPin:null,
    policy:{native_acquisition_required:native},signal:controller.signal,controller};
}
async function loadLive(h,input){const pending=h.state.ui.collect(input);await until(()=>h.$('notice').textContent.startsWith('Authenticated live'),()=>h.$('notice').textContent);await tick();return {pending};}

for(const native of [true,false]){
  const platform=native?'native':'browser';
  test(`${platform} actual handlers retain both keys and request, collect only on shutter and return both exact artifacts`,async t=>{
    const h=await harness(t,{native}),input=spec({native});assert.equal(await h.state.ui.getOperatorPin(),mediaPin);assert.equal(await h.state.ui.getLocationPin(),locationPin);
    const {pending}=await loadLive(h,input);assert.deepEqual(JSON.parse(h.$('operator-challenge').value),{version:1,type:CAMERA_LOCATION_REQUEST,location_request:input.locationRequest});
    assert.equal(h.$('challenge-location-timing').hidden,false);assert.equal(h.$('challenge-location-timing').textContent,locationTimingSummary(input.locationRequest.policy));
    await h.open();assert.equal(h.state.begin.length,0);assert.equal(h.state.finalize.length,0);
    await h.shutter();const result=await pending;
    assert.deepEqual(result.bytes,jpeg);assert.deepEqual(result.locationProof,proof);assert.deepEqual(result.locationRequest,input.locationRequest);
    assert.equal(result.fingerprint,mediaPin);assert.equal(result.locationFingerprint,locationPin);
    assert.deepEqual(structuredClone(h.state.begin[0].request),input.locationRequest);assert.deepEqual(h.state.finalize[0].mediaBytes,jpeg);
    assert.equal(h.state.calls.filter(x=>x==='verify_image_with_location_proof').length,1);assert.equal(h.$('download-location-proof').hidden,false);assert.equal(h.state.cancelled,1);
  });

  test(`${platform} actual handlers preserve image-only live capture without starting the location proof collector`,async t=>{
    const h=await harness(t,{native}),input=spec({native,composed:false}),{pending}=await loadLive(h,input);
    assert.equal(h.$('challenge-location-timing').hidden,true);
    await h.open();await h.shutter();assert.deepEqual(await pending,{bytes:jpeg,fingerprint:mediaPin});
    assert.equal(h.state.begin.length,0);assert.equal(h.state.finalize.length,0);assert.equal(h.$('download-location-proof').hidden,true);
  });

  for(const stage of ['before collection','during collection','during finalization'])test(`${platform} location key replacement ${stage} rejects the pair`,async t=>{
    const beginGate=stage==='during collection'?deferred():null,finalizeGate=stage==='during finalization'?deferred():null;
    const h=await harness(t,{native,beginGate,finalizeGate}),input=spec({native}),{pending}=await loadLive(h,input),failure=assert.rejects(pending,/identity changed/);
    await h.open();if(stage==='before collection')h.state.key=replacementPin;
    const capture=h.shutter();
    if(beginGate){await until(()=>h.state.begin.length===1);h.state.key=replacementPin;beginGate.resolve();}
    if(finalizeGate){await until(()=>h.state.finalize.length===1);h.state.key=replacementPin;finalizeGate.resolve();}
    await capture;await failure;assert.equal(h.$('download-bar').hidden,true);assert.equal(h.state.calls.includes('verify_image_with_location_proof'),false);
    if(stage==='before collection')assert.equal(h.state.begin.length,0);
    if(stage==='during collection')assert.equal(h.state.finalize.length,0);
  });

  for(const stage of ['collection','finalization','verification'])test(`${platform} cancellation during ${stage} discards a late result and keeps exports hidden`,async t=>{
    const gate=deferred(),h=await harness(t,{native,beginGate:stage==='collection'?gate:null,finalizeGate:stage==='finalization'?gate:null,verifyGate:stage==='verification'?gate:null});
    const input=spec({native}),{pending}=await loadLive(h,input),failure=assert.rejects(pending,/cancelled/);await h.open();const capture=h.shutter();
    await until(()=>stage==='collection'?h.state.begin.length:stage==='finalization'?h.state.finalize.length:h.state.calls.includes('verify_image_with_location_proof'));
    input.controller.abort();await failure;gate.resolve();await capture;
    assert.equal(h.$('download-bar').hidden,true);assert.equal(h.$('capture-preview').hidden,true);assert.equal(h.state.cancelled,1);
  });

  test(`${platform} standalone composed capture still produces both exports without a live handoff`,async t=>{
    const h=await harness(t,{native}),input=spec({native});h.$('operator-challenge').value=JSON.stringify({version:1,type:CAMERA_LOCATION_REQUEST,location_request:input.locationRequest});
    await h.action('load-challenge');await h.open();await h.shutter();assert.equal(h.$('download-bar').hidden,false);assert.equal(h.$('download-location-proof').hidden,false);
    assert.equal(h.state.begin.length,1);assert.equal(h.state.finalize.length,1);
  });
}

for(const profile of ['native-required','native-gnss','raw-gnss'])test(`${profile} request cannot downgrade to browser location even with a native camera`,async t=>{
  const h=await harness(t),input=spec({profile});h.state.locationNative=false;
  await assert.rejects(h.state.ui.collect(input),/Android native location collector/);assert.equal(h.state.begin.length,0);assert.equal(h.state.nativeOptions,undefined);
});

test('native location bridge disappearing after preparation fails before proof collection',async t=>{
  const h=await harness(t),input=spec({profile:'raw-gnss'}),{pending}=await loadLive(h,input),failure=assert.rejects(pending,/Android native location collector/);
  await h.open();h.state.locationNative=false;await h.shutter();await failure;assert.equal(h.state.begin.length,0);assert.equal(h.$('download-bar').hidden,true);
});

test('wrong location key at live preparation rejects before any camera or collector starts',async t=>{
  const h=await harness(t),input=spec();input.operatorLocationPin=replacementPin;
  await assert.rejects(h.state.ui.collect(input),/identity changed while loading/);assert.equal(h.state.begin.length,0);assert.equal(h.state.nativeOptions,undefined);
});

for(const stage of ['before collection','during finalization'])test(`native camera key replacement ${stage} rejects before success`,async t=>{
  const finalizeGate=stage==='during finalization'?deferred():null,h=await harness(t,{finalizeGate});
  const input=spec(),{pending}=await loadLive(h,input),failure=assert.rejects(pending,/camera signing identity changed/);await h.open();
  if(stage==='before collection')h.state.mediaKey=replacementPin;
  const capture=h.shutter();if(finalizeGate){await until(()=>h.state.finalize.length===1);h.state.mediaKey=replacementPin;finalizeGate.resolve();}
  await capture;await failure;assert.equal(h.$('download-bar').hidden,true);if(stage==='before collection')assert.equal(h.state.begin.length,0);
});

for(const native of [true,false])test(`${native?'native':'browser'} actual foreground-loss handler aborts finalization and discards its late result`,async t=>{
  const finalizeGate=deferred(),h=await harness(t,{native,finalizeGate}),input=spec({native}),{pending}=await loadLive(h,input);
  const failure=assert.rejects(pending,/cancelled|changed/);await h.open();const capture=h.shutter();await until(()=>h.state.finalize.length===1);
  h.document.hidden=true;h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.state.finalize[0].signal.aborted,true);finalizeGate.resolve();await capture;await failure;
  assert.equal(h.$('download-bar').hidden,true);assert.equal(h.state.cancelled,1);
});

async function loadStandalone(h,input=spec()){
  h.$('operator-challenge').value=JSON.stringify(input.locationRequest
    ?{version:1,type:CAMERA_LOCATION_REQUEST,location_request:input.locationRequest}:input.challenge);
  await h.action('load-challenge');
}
function captureView(h){
  return Object.fromEntries(['capture-state','pipeline-status','location-status','capture-location-details','notice']
    .map(id=>[id,h.$(id).textContent]));
}

test('native phases distinguish collection, photo signing, location signing and verification; late progress cannot regress them',async t=>{
  const beginGate=deferred(),nativeGate=deferred(),finalizeGate=deferred(),verifyGate=deferred();
  const h=await harness(t,{beginGate,nativeGate,finalizeGate,verifyGate});
  await loadStandalone(h);await h.open();
  assert.equal(h.$('pipeline-status').textContent,'Use the shutter in the Android camera preview');
  const capture=h.shutter();await until(()=>h.state.begin.length===1);
  assert.equal(h.$('location-status').textContent,'Collecting location evidence…');
  h.state.begin[0].onProgress({sample_count:3});assert.match(h.$('capture-location-details').textContent,/3 observations/);
  beginGate.resolve();await until(()=>h.$('capture-state').textContent==='SIGNING');
  assert.equal(h.$('pipeline-status').textContent,'Adding watermark and Content Credentials…');
  assert.equal(h.$('location-status').textContent,'Location evidence collected');
  nativeGate.resolve();await until(()=>h.state.finalize.length===1);
  assert.equal(h.$('pipeline-status').textContent,'Signing location proof…');
  assert.equal(h.$('location-status').textContent,'Signing location proof…');
  const finalizing=captureView(h);
  h.state.nativeOptions.onProgress('complete');h.state.begin[0].onProgress({sample_count:99});
  assert.deepEqual(captureView(h),finalizing);
  finalizeGate.resolve();await until(()=>h.state.calls.includes('verify_image_with_location_proof'));
  assert.equal(h.$('pipeline-status').textContent,'Checking photo and location proof…');
  assert.equal(h.$('location-status').textContent,'Location proof signed');
  verifyGate.resolve();await capture;
  const completed=captureView(h);assert.equal(completed['capture-state'],'CAPTURE SIGNED');
  h.state.nativeOptions.onProgress('sealing');h.state.begin[0].onProgress({sample_count:100});
  assert.deepEqual(captureView(h),completed);assert.equal(h.$('download-bar').hidden,false);
});

for(const stage of ['collection','photo signing','location signing'])for(const live of [false,true]){
  test(`native ${stage} failure leaves truthful terminal labels in ${live?'live':'standalone'} capture`,async t=>{
    const gate=deferred(),h=await harness(t,{
      beginGate:stage==='collection'?gate:null,nativeGate:stage==='photo signing'?gate:null,
      finalizeGate:stage==='location signing'?gate:null
    });
    let failure;
    if(live){const {pending}=await loadLive(h,spec());failure=assert.rejects(pending,/physical diagnostic failure/);}
    else await loadStandalone(h);
    await h.open();const capture=h.shutter();
    await until(()=>stage==='collection'?h.state.begin.length:stage==='photo signing'?h.$('capture-state').textContent==='SIGNING':h.state.finalize.length);
    gate.reject(new Error('physical diagnostic failure: sensor=location; age=5001 ms; limit=5000 ms'));
    await capture;if(failure)await failure;
    assert.equal(h.$('capture-state').textContent,'CAPTURE STOPPED');
    assert.equal(h.$('pipeline-status').textContent,'No verified photo is ready to save.');
    assert.equal(h.$('location-status').textContent,'Location proof not completed');
    assert.match(h.$('capture-location-details').textContent,/did not produce a verified photo and location proof/);
    assert.match(h.$('notice').textContent,/sensor=location; age=5001 ms; limit=5000 ms/);
    assert.equal(h.$('download-bar').hidden,true);assert.equal(h.$('capture-preview').hidden,true);
    const terminal=captureView(h);h.state.nativeOptions.onProgress('sealing');h.state.begin[0]?.onProgress({sample_count:99});
    assert.deepEqual(captureView(h),terminal);
  });
}

test('native explicit foreground cancellation stops progress before a delayed collection result',async t=>{
  const beginGate=deferred(),h=await harness(t,{beginGate});
  await loadStandalone(h);await h.open();const capture=h.shutter();await until(()=>h.state.begin.length===1);
  h.window.dispatchEvent(new Event('nonverba:pause'));
  assert.equal(h.$('capture-state').textContent,'CAPTURE CANCELLED');
  assert.equal(h.$('location-status').textContent,'Location proof not completed');
  const terminal=captureView(h);
  h.state.begin[0].onProgress({sample_count:99});h.state.nativeOptions.onProgress('complete');
  beginGate.resolve();await capture;
  assert.deepEqual(captureView(h),terminal);assert.equal(h.$('download-bar').hidden,true);
});

for(const newerStage of ['loaded request','capture in progress','signed result']){
  test(`old native failure cannot overwrite a newer ${newerStage} or clear its busy control`,async t=>{
    const oldGate=deferred(),h=await harness(t,{finalizeGate:oldGate});
    await loadStandalone(h);await h.open();const oldCapture=h.shutter();await until(()=>h.state.finalize.length===1);
    const oldOptions=h.state.nativeOptions,oldProgress=h.state.begin[0].onProgress;
    const replacement=spec();replacement.challenge.id='e'.repeat(64);
    replacement.locationRequest.challenge=structuredClone(replacement.challenge);
    replacement.locationRequest.context.session_id=replacement.challenge.id;
    await loadStandalone(h,replacement);h.state.finalizeGate=null;h.state.shutter=deferred();
    if(newerStage!=='loaded request')await h.open();
    if(newerStage==='signed result')await h.shutter();
    const retained=captureView(h),busy=h.$('start-camera').hasAttribute('aria-busy');
    oldOptions.onProgress('sealing');oldProgress({sample_count:99});
    oldGate.reject(new Error('obsolete native location failure'));
    await until(()=>h.state.cancelled===(newerStage==='signed result'?2:1));
    assert.deepEqual(captureView(h),retained);
    // The newer action alone owns the button's pending state.
    assert.equal(h.$('start-camera').hasAttribute('aria-busy'),newerStage==='loaded request'?false:busy);
    if(newerStage==='capture in progress')await h.shutter();
    await oldCapture;
    assert.equal(h.$('download-bar').hidden,newerStage==='loaded request');
  });
}


for(const native of [true,false]){
  const platform=native?'native':'browser';
  const exposure=native?'native-exposure':'frame';
  test(platform+' concurrent handlers start GPS before preview and expose before the remaining window completes',async t=>{
    const concurrentGate=deferred(),h=await harness(t,{native,concurrentGate}),input=spec({native,concurrent:true});
    const {pending}=await loadLive(h,input);
    await h.open();
    assert.equal(h.state.concurrent.length,1);assert.equal(h.state.begin.length,0);
    assert.deepEqual(structuredClone(h.state.concurrent[0].request),input.locationRequest);
    assert.ok(h.state.calls.indexOf('begin-concurrent-location')<h.state.calls.indexOf(native?'open-native-camera':'open-browser-camera'));
    const capture=h.shutter();
    await until(()=>h.state.calls.includes(exposure));
    await until(()=>h.$('capture-state').textContent==='PHOTO TAKEN',()=>h.$('notice').textContent);
    assert.equal(h.state.finalize.length,0);
    assert.equal(h.$('download-bar').hidden,true);assert.equal(h.$('capture-preview').hidden,true);
    assert.equal(h.state.concurrent[0].signal.aborted,false);
    assert.equal(h.state.calls.filter(value=>value==='select-concurrent-location').length,1);
    concurrentGate.resolve();
    await capture;
    const result=await pending;
    assert.deepEqual(result.bytes,jpeg);assert.deepEqual(result.locationProof,proof);
    assert.deepEqual(result.locationRequest,input.locationRequest);
    assert.equal(result.fingerprint,mediaPin);assert.equal(result.locationFingerprint,locationPin);
    assert.equal(h.state.finalize.length,1);assert.deepEqual(h.state.finalize[0].mediaBytes,jpeg);
    assert.deepEqual(structuredClone(h.state.finalize[0].collection.request),input.locationRequest);
    assert.equal(h.$('download-bar').hidden,false);assert.equal(h.$('download-location-proof').hidden,false);
  });

  for(const stage of ['before photo','after photo'])for(const outcome of ['cancel','failure']){
    test(platform+' concurrent '+outcome+' '+stage+' discards late GPS and exposes neither artifact',async t=>{
      const concurrentGate=deferred(),h=await harness(t,{native,concurrentGate}),input=spec({native,concurrent:true});
      const {pending}=await loadLive(h,input),failure=assert.rejects(pending,/cancelled|changed|concurrent GPS failed/);
      await h.open();
      let capture;
      if(stage==='after photo'){
        capture=h.shutter();
        await until(()=>h.state.calls.includes(exposure));
        await until(()=>h.$('capture-state').textContent==='PHOTO TAKEN',()=>h.$('notice').textContent);
      }
      if(outcome==='cancel')input.controller.abort();
      else concurrentGate.reject(new Error('concurrent GPS failed'));
      if(native&&stage==='before photo')capture=h.shutter();
      await failure;
      assert.equal(h.state.concurrent[0].signal.aborted,true);
      concurrentGate.resolve();
      if(capture)await capture;
      assert.equal(h.state.finalize.length,0);
      assert.equal(h.state.calls.includes('verify_image_with_location_proof'),false);
      assert.equal(h.$('download-bar').hidden,true);assert.equal(h.$('capture-preview').hidden,true);
      assert.equal(h.$('download-location-proof').hidden,true);
      if(stage==='before photo')assert.equal(h.state.calls.includes(exposure),false);
      assert.ok(h.state.concurrentCancelled>=1);
    });
  }
}
