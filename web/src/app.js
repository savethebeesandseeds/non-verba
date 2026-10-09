// SPDX-License-Identifier: AGPL-3.0-only
import {read,write,values,reserveCapture,loadIdentity,saveIdentity} from './storage.js';
import {retainCameraEvidence} from './camera-acceptance.js';
import {freshLocation,locationSummary} from './location.js';
import {locationTimingSummary,locationSealingSummary} from './location-policy.js';
import {beginLocationCollection,finalizeLocationProof,startConcurrentLocationCollection} from './location-capture.js';
import {getLocationIdentity,locationPlatform} from './location-platform.js';
import {splitCameraRequest,createCameraRequest,encodeLocationProof,readLocationProof,CAMERA_LOCATION_REQUEST} from './camera-location.js';
import {nativeCameraPlatform,collectNativeCamera} from './camera-platform.js';
import {CameraCaptureHandoff,sameCaptureRequest} from './camera-session-capture.js';
import {installCameraSessionUI} from './camera-session-ui.js';
import {installRetainedEvidenceUI} from './retained-evidence-ui.js';
import {installCameraQualityUI} from './camera-quality.js';
import {prepareCameraPermissions} from './camera-session-preflight.js';
import {newRequestPreset, installRequestPresetSummary} from './request-presets.js';
import {createCoreClient} from './core-client.js';
const $=id=>document.getElementById(id);
const now=()=>Math.floor(Date.now()/1000);
const locationEngine=createCoreClient();
let stream=null, activeChallenge=null, identity=null, evidence=null, previewUrl=null, verification=null, verifiedFile=null, issued=null;
let cameraGeneration=0, cameraPending=false, captureRevision=0, verificationRevision=0;
let locationRequest=null;
let activeLocationPolicy=null, activeLocationFingerprint=null, locationProofAbort=null, issuedEnvelope=null;
let nativeCaptureAbort=null, cameraFingerprint=null, nativeCameraState=null;
let retainedVerification=null, preparedCameraLocation=null;
let cameraSessionUI=null;
const liveCameraCapture=new CameraCaptureHandoff({
  prepare:async({challenge,locationRequest,policy,operatorPin,operatorLocationPin,signal})=>{
    if(signal.aborted)throw new Error('Live camera session cancelled.');
    if(policy.native_acquisition_required&&!nativeCameraPlatform())throw new Error('The agreed policy requires the Android camera.');
    const envelope=locationRequest?{version:1,type:CAMERA_LOCATION_REQUEST,location_request:locationRequest}:challenge;
    show('operator');$('operator-challenge').value=challengeText(envelope);await loadOperatorChallenge();
    if(signal.aborted||!activeChallenge||!sameCaptureRequest(activeChallenge,challenge)||!sameCaptureRequest(activeLocationPolicy,locationRequest??null)||cameraFingerprint!==operatorPin||activeLocationFingerprint!==(operatorLocationPin??null))throw new Error('The live camera request or identity changed while loading.');
    notify(locationRequest?'Authenticated live camera and location request loaded. Open the camera and use its shutter; the JPEG and matching location proof will return together.':'Authenticated live camera request loaded. Enable location, open the camera and use its shutter; the complete JPEG will return to the requester.');
  },
  stop:()=>{stopCamera();resetEvidence();activeChallenge=null;activeLocationPolicy=null;activeLocationFingerprint=null;$('loaded-challenge').hidden=true;$('start-camera').disabled=true;},
  lock:locked=>{for(const id of ['operator-challenge','import-challenge','load-challenge'])$(id).disabled=locked;}
});
const engineReady=locationEngine.ready.then(()=>{$('runtime').lastChild.textContent='Local engine ready';});
const core=locationEngine.call, jsonCore=locationEngine.json;
installCameraQualityUI({engine:locationEngine,saveArtifact});
function notify(message,type=''){const n=$('notice');n.textContent=message;n.className=`notice ${type}`;n.hidden=false;}
function errorMessage(error){return String(error?.message||error);}
const actionRuns=new WeakMap();
function action(id,handler){
  $(id).addEventListener('click',async()=>{
    const button=$(id);if(button.disabled)return;
    const run={},cameraAction=['start-camera','capture'].includes(id);
    let revision=captureRevision;
    actionRuns.set(button,run);
    if(id!=='load-challenge')$('notice').hidden=true;
    button.disabled=true;button.setAttribute('aria-busy','true');
    try{
      const operation=handler();revision=captureRevision;await operation;
    }catch(error){
      if(cameraAction&&revision!==captureRevision)return;
      if(cameraAction)liveCameraCapture.fail(error);
      if(error?.name!=='AbortError')notify(errorMessage(error),'error');
    }finally{
      // A replaced capture may settle while the same button starts a newer one.
      if(actionRuns.get(button)===run){
        actionRuns.delete(button);button.removeAttribute('aria-busy');button.disabled=false;
        if(id==='capture')button.disabled=!stream||!activeChallenge||!!evidence;
        if(id==='start-camera')button.disabled=cameraPending||!!stream||!activeChallenge||activeChallenge.expires_at<=now();
        if(id==='accept-evidence')button.disabled=!verification?.acceptance_eligible||!!verification?.accepted;
      }
    }
  });
}
function show(view){$('notice').hidden=true;if(view!=='operator')stopCamera();for(const section of document.querySelectorAll('.view'))section.hidden=section.id!==`view-${view}`;for(const tab of document.querySelectorAll('[data-view]')){if(tab.dataset.view===view)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');}if(view==='requester')renderHistory().catch(error=>notify(errorMessage(error),'error'));}
for(const tab of document.querySelectorAll('[data-view]'))tab.addEventListener('click',()=>{cameraSessionUI?.cancel('Camera workflow changed.');show(tab.dataset.view);});
function nativeCaptureStopped(cancelled,composed){
  $('capture-state').textContent=cancelled?'CAPTURE CANCELLED':'CAPTURE STOPPED';
  $('pipeline-status').textContent='No verified photo is ready to save.';
  $('location-status').textContent=composed?'Location proof not completed':'Location capture stopped';
  $('capture-location-details').textContent=composed
    ?'This attempt did not produce a verified photo and location proof. Load a fresh challenge to try again.'
    :'This attempt did not produce a verified photo. Load a fresh challenge to try again.';
}
function stopCamera(preserveProof=false){
  const nativeWasActive=!!nativeCaptureAbort,composed=!!activeLocationPolicy;
  cameraGeneration++;cameraPending=false;nativeCaptureAbort?.abort();nativeCaptureAbort=null;nativeCameraState=null;
  locationRequest?.abort();locationRequest=null;
  if(preserveProof!==true){locationProofAbort?.abort();locationProofAbort=null;preparedCameraLocation?.cancel();preparedCameraLocation=null;}
  if(stream){stream.getTracks().forEach(track=>track.stop());stream=null;}
  $('camera').srcObject=null;$('camera').hidden=true;$('capture').disabled=true;
  if(!evidence){$('camera-placeholder').hidden=false;$('location-status').textContent='Location required for capture';$('capture-location-details').textContent='A fresh device location will be embedded in the photo.';}
  if(nativeWasActive){
    liveCameraCapture.fail(new DOMException('Native capture cancelled.','AbortError'));
    if(!evidence)nativeCaptureStopped(true,composed);
  }
}
document.addEventListener('visibilitychange',()=>{if(document.hidden&&!(nativeCaptureAbort&&nativeCameraState==='requesting-permission'))stopCamera();});
window.addEventListener('nonverba:pause',stopCamera);
window.addEventListener('pagehide',stopCamera);
function resetEvidence(){captureRevision++;evidence=null;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;$('capture-preview').hidden=true;$('download-bar').hidden=true;$('camera-placeholder').hidden=false;$('camera-tag').textContent='LIVE CAPTURE ONLY';}
async function ensureIdentity(){
  const native=nativeCameraPlatform();
  if(native){cameraFingerprint=native.fingerprint;$('device-id').textContent=cameraFingerprint;$('export-device').disabled=false;return null;}
  if(identity)return identity;
  // Web Locks prevent two tabs from replacing a newly generated identity.
  const provision=async()=>{let stored=await loadIdentity();if(!stored){stored=await core('create_identity');await saveIdentity(stored);}return stored;};
  identity=navigator.locks?await navigator.locks.request('nonverba-signing-identity',provision):await provision();
  const parsed=JSON.parse(identity);cameraFingerprint=parsed.fingerprint;$('device-id').textContent=cameraFingerprint;$('export-device').disabled=false;return identity;
}
async function saveArtifact(name,mime,bytes){
  if(typeof bytes==='string')bytes=new TextEncoder().encode(bytes);
  if(window.NativeVault){let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));if(!window.NativeVault.saveArtifact(name,mime,btoa(binary)))throw new Error('Android could not export the file.');return;}
  const url=URL.createObjectURL(new Blob([bytes],{type:mime}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function challengeText(challenge){return JSON.stringify(challenge,null,2);}
async function captureLocation(challenge,generation){
  locationRequest?.abort();const request=new AbortController();locationRequest=request;
  $('location-status').textContent='Acquiring fresh location…';$('capture-location-details').textContent='Allow location access. High accuracy requested.';
  try{
    const location=await freshLocation(request.signal);
    if(generation!==cameraGeneration||document.hidden||$('view-operator').hidden)throw new DOMException('Location request cancelled.','AbortError');
    const validated=await jsonCore('validate_location',JSON.stringify(location),challenge,now());
    if(generation!==cameraGeneration||document.hidden||$('view-operator').hidden)throw new DOMException('Location request cancelled.','AbortError');
    $('location-status').textContent='Location ready';$('capture-location-details').textContent=locationSummary(validated);
    return validated;
  }catch(error){if(generation===cameraGeneration){$('location-status').textContent='Location unavailable';$('capture-location-details').textContent='Capture requires a fresh location fix. Retry after enabling location access.';}throw error;}
  finally{if(locationRequest===request)locationRequest=null;}
}
async function loadOperatorChallenge(){
  stopCamera();resetEvidence();activeChallenge=null;activeLocationPolicy=null;activeLocationFingerprint=null;$('start-camera').disabled=true;
  const revision=captureRevision,summary=$('loaded-challenge'),locationKeyPanel=$('camera-location-key'),notice=$('notice');
  // Rechecking an already loaded request must not collapse the mobile panel.
  // Its stale contents remain invisible and unusable until validation commits.
  summary.classList.toggle('is-revalidating',!summary.hidden);
  locationKeyPanel.classList.toggle('is-revalidating',!locationKeyPanel.hidden);
  notice.classList.toggle('is-revalidating',!notice.hidden);
  try{
    const request=splitCameraRequest($('operator-challenge').value);
    const challenge=await jsonCore('validate_challenge',challengeText(request.challenge),now());
    const policy=request.locationRequest?await jsonCore('validate_location_request',JSON.stringify(request.locationRequest),now()):null;
    if(policy&&(policy.policy.profile==='native-required'||policy.policy.required_provider==='gnss'||policy.policy.raw_gnss)&&!locationPlatform().native)throw new Error('This camera request requires the Android native location collector.');
    if(await read('captures',challenge.id))throw new Error('This challenge was already used for capture on this device. Request a fresh challenge.');
    await ensureIdentity();
    const locationKey=policy?await getLocationIdentity({engine:locationEngine,identity}):null;
    if(revision!==captureRevision)return;activeChallenge=challenge;activeLocationPolicy=policy;activeLocationFingerprint=locationKey?.fingerprint??null;
    locationKeyPanel.hidden=!locationKey;
    if(locationKey)$('camera-location-key-id').textContent=locationKey.fingerprint;
    $('challenge-task').textContent=challenge.task;$('challenge-requester').textContent=challenge.requester;
    $('challenge-location-timing').hidden=!policy;$('challenge-location-timing').textContent=policy?locationTimingSummary(policy.policy):'';
    summary.hidden=false;$('capture-state').textContent='CHALLENGE LOADED';$('pipeline-status').textContent='Ready to open camera';updateCountdown();
    notify(policy?'Request loaded. Capture will collect a location trace, then export the photo and its matching proof.':'Challenge loaded. Open your camera, then capture within the request window.');
  }catch(error){if(revision===captureRevision)throw error;}
  finally{
    if(revision===captureRevision){
      summary.classList.remove('is-revalidating');locationKeyPanel.classList.remove('is-revalidating');notice.classList.remove('is-revalidating');
      if(!activeChallenge){summary.hidden=true;locationKeyPanel.hidden=true;}
    }
  }
}
function checkCameraIdentity(expected) {
  const native=nativeCameraPlatform();
  const actual=native?native.fingerprint:identity?JSON.parse(identity).fingerprint:null;
  if(actual!==expected)throw new Error('The selected camera signing identity changed. Load a fresh request.');
}

async function selectedLocationKey(request) {
  if(!request)return null;
  const platform=locationPlatform();
  if((request.policy.profile==='native-required'||request.policy.required_provider==='gnss'||request.policy.raw_gnss)&&!platform.native)throw new Error('This camera request requires the Android native location collector.');
  const key=await getLocationIdentity({engine:locationEngine,identity});
  if(!sameCaptureRequest(request,activeLocationPolicy)||key.fingerprint!==activeLocationFingerprint)throw new Error('The selected location request or signing identity changed. Load a fresh request.');
  return key;
}

action('load-challenge',()=>{cameraSessionUI?.cancel('A standalone camera challenge was loaded.');return loadOperatorChallenge();});
$('operator-challenge').addEventListener('input',()=>cameraSessionUI?.cancel('The camera challenge changed.'));
async function importText(input,target){const file=input.files?.[0];if(!file)return;if(file.size>16384)throw new Error('Challenge files must be under 16 KB.');$(target).value=await file.text();}
$('import-challenge').addEventListener('change',()=>{cameraSessionUI?.cancel('A standalone camera challenge was imported.');return importText($('import-challenge'),'operator-challenge').then(loadOperatorChallenge).catch(error=>notify(errorMessage(error),'error'));});
$('verify-challenge-file').addEventListener('change',()=>importText($('verify-challenge-file'),'verify-challenge').then(invalidateVerification).catch(error=>notify(errorMessage(error),'error')));
action('start-camera',async()=>{
  if(!activeChallenge)throw new Error('Load a fresh challenge first.');
  if(!nativeCameraPlatform()&&!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access requires HTTPS or localhost and a current browser.');
  const initialNative=nativeCameraPlatform();
  if(initialNative&&activeLocationPolicy?.context?.camera_timing==='concurrent'&&(initialNative.capabilities.camera_permission!==true||locationPlatform().capabilities.fine_permission!==true)){
    const challenge=activeChallenge,revision=captureRevision;
    await prepareCameraPermissions({checkPermissions:checkLiveCameraPermissions});
    if(challenge!==activeChallenge||revision!==captureRevision||document.hidden||$('view-operator').hidden)return;
  }
  stopCamera();resetEvidence();
  const generation=cameraGeneration;cameraPending=true;
  try{await core('validate_challenge',challengeText(activeChallenge),now());}catch(error){if(generation===cameraGeneration)cameraPending=false;throw error;}
  if(activeChallenge&&await read('captures',activeChallenge.id)){if(generation===cameraGeneration)cameraPending=false;throw new Error('This challenge was already used. Load a fresh requester challenge.');}
  if(generation!==cameraGeneration||document.hidden||$('view-operator').hidden)return;
  // Resolve location permission before opening the camera: Android permission
  // overlays may pause the Activity and deliberately stop live video tracks.
  try{
    const platform=activeLocationPolicy?locationPlatform():null;
    if(activeLocationPolicy?.context?.camera_timing!=='concurrent'||(platform?.native&&platform.capabilities.fine_permission!==true))await captureLocation(challengeText(activeChallenge),generation);
    if(platform?.native&&locationPlatform().capabilities.fine_permission!==true)throw new Error('This location proof requires precise Android location. Enable precise location in Android app permissions before opening the camera.');
  }catch(error){if(generation===cameraGeneration)cameraPending=false;throw error;}
  if(generation!==cameraGeneration||document.hidden||$('view-operator').hidden||!activeChallenge||activeChallenge.expires_at<=now())return;
  const native=nativeCameraPlatform();
  if(native){try{await captureWithNativeCamera(native,generation);}finally{if(generation===cameraGeneration)cameraPending=false;}return;}
  if(activeLocationPolicy?.context?.camera_timing==='concurrent'){
    try{
    const abort=new AbortController();locationProofAbort=abort;
    await selectedLocationKey(activeLocationPolicy);
    const collecting=await startConcurrentLocationCollection({engine:locationEngine,request:activeLocationPolicy,signal:abort.signal,onProgress:progress=>{
      if(generation===cameraGeneration&&!abort.signal.aborted)$('capture-location-details').textContent=String(progress.sample_count||0)+' GPS observations; frame your photo while collection continues.';
    }});
    preparedCameraLocation=collecting;
    collecting.ready.catch(error=>{if(preparedCameraLocation===collecting&&!abort.signal.aborted){stopCamera();liveCameraCapture.fail(error);nativeCaptureStopped(false,true);notify(errorMessage(error),'error');}});
    }catch(error){if(generation===cameraGeneration)stopCamera();throw error;}
  }
  let acquired;
  try{acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1600},height:{ideal:1200}}});}catch(error){if(generation===cameraGeneration)stopCamera();throw new Error(error.name==='NotAllowedError'?'Camera permission was denied. Allow camera access in your browser or Android settings, then try again.':`Camera unavailable: ${error.message}`);}
  if(generation!==cameraGeneration||document.hidden||$('view-operator').hidden||!activeChallenge||activeChallenge.expires_at<=now()){acquired.getTracks().forEach(track=>track.stop());return;}
  stream=acquired;cameraPending=false;
  const video=$('camera');video.srcObject=stream;video.hidden=false;
  try{await video.play();}catch(error){acquired.getTracks().forEach(track=>track.stop());if(generation===cameraGeneration)stopCamera();throw error;}
  if(generation!==cameraGeneration||document.hidden){acquired.getTracks().forEach(track=>track.stop());return;}
  $('camera-placeholder').hidden=true;$('capture').disabled=false;$('capture-state').textContent='CAMERA LIVE';$('pipeline-status').textContent='Ready for a fresh capture';
  if(window.innerWidth<=650)$('viewfinder').scrollIntoView({block:'start'});
  for(const track of stream.getVideoTracks())track.addEventListener('ended',stopCamera,{once:true});
});
async function captureWithNativeCamera(platform,generation){
  const challenge=activeChallenge, requestedLocation=activeLocationPolicy, revision=captureRevision, mediaFingerprint=cameraFingerprint;
  const abort=new AbortController();nativeCaptureAbort=abort;locationProofAbort=abort;
  nativeCameraState='requesting-permission';
  let collection,concurrent,locationFailure,collectingLocation=false,nativeProgressActive=true;
  const ownsAttempt=()=>nativeCaptureAbort===abort&&generation===cameraGeneration&&revision===captureRevision&&!evidence;
  const current=()=>{if(!ownsAttempt()||abort.signal.aborted||document.hidden||$('view-operator').hidden)throw new DOMException('Native capture cancelled.','AbortError');checkCameraIdentity(mediaFingerprint);};
  const progressLabels={
    'requesting-permission':['CAMERA STARTING','Allow camera access to continue.'],
    opening:['CAMERA STARTING','Opening the camera…'],
    preview:['CAMERA READY','Use the shutter in the Android camera preview'],
    'awaiting-location':['PREPARING PHOTO','Waiting for a fresh GPS fix; remaining measurements can finish after the photo…'],
    capturing:['CAPTURING','Taking photo…'],
    sealing:['SIGNING','Adding watermark and Content Credentials…'],
    complete:['CHECKING CAPTURE','Checking signed photo…']
  };
  try{
    current();
    if(requestedLocation?.context?.camera_timing==='concurrent'){
      await selectedLocationKey(requestedLocation);current();
      concurrent=await startConcurrentLocationCollection({engine:locationEngine,request:requestedLocation,signal:abort.signal,onProgress:progress=>{
        if(ownsAttempt()&&!abort.signal.aborted)$('capture-location-details').textContent=String(progress.sample_count||0)+' GPS observations; collection continues alongside the photo.';
      }});
      concurrent.ready.catch(error=>{if(ownsAttempt()&&!abort.signal.aborted){locationFailure=error;abort.abort();}});
    }
    const result=await collectNativeCamera({platform,challenge,locationRequest:requestedLocation,signal:abort.signal,
      onProgress:state=>{
        if(!nativeProgressActive||!ownsAttempt()||abort.signal.aborted)return;
        nativeCameraState=state;
        const labels=progressLabels[state];if(!labels)return;
        $('capture-state').textContent=labels[0];$('pipeline-status').textContent=labels[1];
      },
      acquireLocation:async()=>{
        current();await core('validate_challenge',challengeText(challenge),now());current();
        if(requestedLocation&&!concurrent){
          await selectedLocationKey(requestedLocation);current();
          $('location-status').textContent='Collecting location evidence…';
          collectingLocation=true;
          try{
            collection=await beginLocationCollection({engine:locationEngine,request:requestedLocation,signal:abort.signal,onProgress:progress=>{
              if(collectingLocation&&ownsAttempt()&&!abort.signal.aborted)$('capture-location-details').textContent=`${progress.sample_count||0} observations · keep the Android preview open.`;
            }});
          }finally{collectingLocation=false;}
          current();
          $('location-status').textContent='Location evidence collected';
          $('capture-location-details').textContent='Location samples collected. Preparing the photo.';
        }
        const location=concurrent?await concurrent.selectForCamera():collection?collection.selected:await captureLocation(challengeText(challenge),generation);
        current();await reserveCapture(challenge.id,{captured_at:now(),kind:'native-camera'});current();
        return location;
      }});
    nativeProgressActive=false;current();
    if(concurrent){
      $('capture-state').textContent='PHOTO TAKEN';$('pipeline-status').textContent='Finishing GPS measurements and signing. You can lower the phone; keep Non-verba open.';
      collection=await concurrent.ready;current();
    }
    let locationProof=null,locationKey=null;
    if(collection){
      $('capture-state').textContent='SIGNING LOCATION';$('pipeline-status').textContent='Signing location proof…';
      $('location-status').textContent='Signing location proof…';$('capture-location-details').textContent='Linking the location record to this photo.';
      await reserveCapture(`location:${challenge.id}`,{kind:'camera-location',at:now()});current();
      locationKey=await selectedLocationKey(requestedLocation);current();
      locationProof=await finalizeLocationProof({engine:locationEngine,collection,identity,mediaBytes:result.bytes,signal:abort.signal});
      current();await selectedLocationKey(requestedLocation);current();
      $('location-status').textContent='Location proof signed';$('capture-location-details').textContent='Checking the photo and its location proof together.';
    }
    current();$('capture-state').textContent='CHECKING CAPTURE';
    $('pipeline-status').textContent=locationProof?'Checking photo and location proof…':'Checking signed photo…';
    const checked=locationProof
      ?await jsonCore('verify_image_with_location_proof',result.bytes,locationProof,JSON.stringify(requestedLocation),result.fingerprint,locationKey.fingerprint,now())
      :await jsonCore('verify_image',result.bytes,challengeText(challenge),result.fingerprint,now());
    if(!checked.verified||checked.checks.native_camera_metadata_valid!==true)throw new Error(`Native capture failed local verification: ${(checked.errors||[]).join('; ')}`);
    current();showCapturedEvidence(result.bytes,challenge,checked,locationProof,result.fingerprint,locationKey?.fingerprint,requestedLocation);
  }catch(error){
    // Only this attempt may report its failure or terminate the current handoff.
    if(ownsAttempt()){
      if(locationFailure)error=locationFailure;
      const cancelled=!locationFailure&&(abort.signal.aborted||error?.name==='AbortError');
      liveCameraCapture.fail(error);
      nativeCaptureStopped(cancelled,!!requestedLocation);
      if(!cancelled)notify(errorMessage(error),'error');
    }
  }finally{
    nativeProgressActive=false;collectingLocation=false;
    concurrent?.cancel();collection?.cancel();
    if(nativeCaptureAbort===abort){nativeCaptureAbort=null;nativeCameraState=null;}
    if(locationProofAbort===abort)locationProofAbort=null;
  }
}

function showCapturedEvidence(signed,challenge,check,locationProof,fingerprint,locationFingerprint,requestedLocation){
  // Reject a replaced handoff before presenting either artifact as a success.
  if(liveCameraCapture.pending&&!liveCameraCapture.complete({bytes:signed,challenge,fingerprint,locationProof,locationFingerprint,locationRequest:requestedLocation}))throw new Error('The live camera request or signing identity changed.');
  evidence={bytes:signed,challenge,report:check,locationProof};
  if(previewUrl)URL.revokeObjectURL(previewUrl);
  previewUrl=URL.createObjectURL(new Blob([signed],{type:'image/jpeg'}));$('capture-preview').src=previewUrl;$('capture-preview').hidden=false;$('camera-placeholder').hidden=true;$('camera-tag').textContent='SIGNED / C2PA';$('capture-state').textContent='CAPTURE SIGNED';$('pipeline-status').textContent='Watermarked. Signed. Locally checked.';$('download-bar').hidden=false;
  $('location-status').textContent='GPS metadata signed';$('capture-location-details').textContent=locationSummary(check.capture.location);
  $('download-location-proof').hidden=!locationProof;
  notify(locationProof?'Photo and location proof verified together. Save both files; the proof is bound to this exact JPEG.':'Your signed photo is ready. Save the original JPEG to preserve its Content Credentials.');
}

action('capture',async()=>{
  if(!stream||!activeChallenge)throw new Error('Open the camera with a valid challenge first.');
  const capturedChallenge=activeChallenge, revision=captureRevision, generation=cameraGeneration, mediaFingerprint=cameraFingerprint;
  const requestedLocation=activeLocationPolicy;
  const concurrent=preparedCameraLocation;
  const abort=concurrent?locationProofAbort:new AbortController();locationProofAbort=abort;
  let collection;
  try{
  const challenge=challengeText(capturedChallenge);await core('validate_challenge',challenge,now());
  if(revision!==captureRevision||generation!==cameraGeneration||!stream||document.hidden)throw new Error('Capture was cancelled because the camera or challenge changed.');
  checkCameraIdentity(mediaFingerprint);
  if(requestedLocation&&!concurrent){
    await selectedLocationKey(requestedLocation);
    if(abort.signal.aborted||revision!==captureRevision||generation!==cameraGeneration)throw new Error('Location collection was cancelled.');
    $('location-status').textContent='Collecting location evidence…';
    collection=await beginLocationCollection({engine:locationEngine,request:requestedLocation,signal:abort.signal,onProgress:progress=>{
      if(abort.signal.aborted)return;
      $('capture-location-details').textContent=`${progress.sample_count||0} observations · keep this screen open while location updates arrive.`;
    }});
  }
  if(concurrent)await selectedLocationKey(requestedLocation);
  const location=concurrent?await concurrent.selectForCamera():collection?collection.selected:await captureLocation(challenge,generation);
  if(revision!==captureRevision||generation!==cameraGeneration||!stream||document.hidden||$('view-operator').hidden)throw new Error('Capture was cancelled while acquiring location.');
  const video=$('camera');if(!video.videoWidth||!video.videoHeight)throw new Error('The camera is still starting. Try again in a moment.');
  const canvas=document.createElement('canvas');const scale=Math.min(1,1600/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
  const context=canvas.getContext('2d',{alpha:false});context.drawImage(video,0,0,canvas.width,canvas.height);
  const captureTime=now();const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Camera image could not be encoded.')),'image/jpeg',0.96));
  if(revision!==captureRevision||generation!==cameraGeneration||document.hidden)throw new Error('The challenge or camera changed before the image was ready.');
  const locationJson=await core('validate_location',JSON.stringify(location),challenge,captureTime);
  if(revision!==captureRevision||generation!==cameraGeneration||document.hidden)throw new Error('Capture was cancelled before signing.');
  stopCamera(true);$('capture-state').textContent='SIGNING';$('pipeline-status').textContent='Adding watermark and Content Credentials…';
  // Reserve before signing so even concurrent tabs cannot reuse a nonce here.
  // A failed signing attempt also needs a fresh challenge, never a silent retry.
  await reserveCapture(capturedChallenge.id,{captured_at:captureTime});
  if(revision!==captureRevision||abort.signal.aborted)throw new Error('Capture changed before signing. Request a fresh challenge.');
  const imageBytes=new Uint8Array(await blob.arrayBuffer());
  checkCameraIdentity(mediaFingerprint);
  const signed=requestedLocation
    ?await core('seal_image_with_location_request',imageBytes,challenge,await ensureIdentity(),captureTime,locationJson,JSON.stringify(requestedLocation))
    :await core('seal_image',imageBytes,challenge,await ensureIdentity(),captureTime,locationJson);
  if(concurrent){
    $('capture-state').textContent='PHOTO TAKEN';$('pipeline-status').textContent='Finishing GPS measurements and signing. You can lower the phone; keep Non-verba open.';
    collection=await concurrent.ready;
  }
  let locationProof=null,locationKey=null;
  if(collection){
    if(revision!==captureRevision||abort.signal.aborted)throw new Error('Capture changed before location signing.');
    await reserveCapture(`location:${capturedChallenge.id}`,{kind:'camera-location',at:now()});
    locationKey=await selectedLocationKey(requestedLocation);
    if(revision!==captureRevision||abort.signal.aborted)throw new Error('Capture changed before location signing.');
    locationProof=await finalizeLocationProof({engine:locationEngine,collection,identity,mediaBytes:signed,signal:abort.signal});
    await selectedLocationKey(requestedLocation);checkCameraIdentity(mediaFingerprint);
    if(revision!==captureRevision||abort.signal.aborted)throw new Error('Capture changed during location signing.');
  }
  // Do not offer bytes until the same verifier used by recipients validates them.
  const check=locationProof
    ?await jsonCore('verify_image_with_location_proof',signed,locationProof,JSON.stringify(requestedLocation),JSON.parse(identity).fingerprint,locationKey.fingerprint,now())
    :await jsonCore('verify_image',signed,challenge,JSON.parse(identity).fingerprint,now());
  if(!check.verified)throw new Error(`Signed capture failed its local integrity check: ${(check.errors||[]).join('; ')}`);
  if(revision!==captureRevision||abort.signal.aborted)throw new Error('The challenge or camera changed while signing. The previous capture was discarded.');
  checkCameraIdentity(mediaFingerprint);
  showCapturedEvidence(signed,capturedChallenge,check,locationProof,JSON.parse(identity).fingerprint,locationKey?.fingerprint,requestedLocation);
  }finally{concurrent?.cancel();collection?.cancel();if(preparedCameraLocation===concurrent)preparedCameraLocation=null;if(locationProofAbort===abort)locationProofAbort=null;}
});
action('download-evidence',async()=>{if(!evidence)throw new Error('Capture a photo first.');await saveArtifact(`nonverba-${evidence.challenge.id.slice(0,12)}.jpg`,'image/jpeg',evidence.bytes);});
action('download-location-proof',async()=>{if(!evidence?.locationProof)throw new Error('No composed location proof is available.');await saveArtifact(`nonverba-location-${evidence.challenge.id.slice(0,12)}.json`,'application/json',encodeLocationProof(evidence.locationProof));});
action('export-device',async()=>{await ensureIdentity();const label=nativeCameraPlatform()?'Non-verba native camera signing identity. This is separate from older software photo/audio keys.':'Non-verba local software signing identity.';await saveArtifact('nonverba-public-device-id.txt','text/plain',`${cameraFingerprint}\n\n${label} Share through a trusted channel.\n`);});
action('create-challenge',async()=>{
  const preset=newRequestPreset('camera',{mode:$('camera-location-mode').value});
  issuedEnvelope=await createCameraRequest(locationEngine,$('requester-name').value.trim(),$('request-task').value.trim(),now(),Number($('request-ttl').value),preset.mode,preset.duration_ms);
  issued=splitCameraRequest(JSON.stringify(issuedEnvelope)).challenge;
  await write('requests',issued.id,{challenge:issued,request:issuedEnvelope,created:Date.now()});$('created-challenge').value=challengeText(issuedEnvelope);$('save-challenge').disabled=false;$('use-challenge').disabled=false;await renderHistory();notify('Fresh request created and stored on this device. Send its complete file to the operator.');
});
action('save-challenge',async()=>{if(!issued)throw new Error('Create a challenge first.');await saveArtifact(`nonverba-challenge-${issued.id.slice(0,12)}.json`,'application/json',challengeText(issuedEnvelope));});
action('use-challenge',async()=>{cameraSessionUI?.cancel('A locally created standalone challenge was selected.');if(!issued)throw new Error('Create a challenge first.');$('operator-challenge').value=challengeText(issuedEnvelope);show('operator');await loadOperatorChallenge();});
async function renderHistory(){
  const history=(await values('requests')).sort((a,b)=>b.created-a.created).slice(0,20);const root=$('request-history');root.replaceChildren();
  if(!history.length){const p=document.createElement('p');p.className='muted';p.textContent='No challenges issued on this device yet.';root.append(p);return;}
  for(const item of history){const c=item.challenge;const row=document.createElement('div');row.className='history-item';const text=document.createElement('div');text.textContent=c.task;const status=document.createElement('span');const accepted=await read('accepted',c.id);status.textContent=`${c.requester} · ${accepted?'Accepted on this device':c.expires_at<now()?'Capture window ended':'Awaiting evidence'}`;text.append(status);const button=document.createElement('button');button.className='secondary';button.textContent='Verify';button.addEventListener('click',()=>{$('verify-challenge').value=challengeText(item.request||c);invalidateVerification();show('verify');});row.append(text,button);root.append(row);}
}
function updateCountdown(){if(verification&&verification.expected_challenge.expires_at<=now()){verification.acceptance_eligible=false;$('accept-evidence').disabled=true;}if(!activeChallenge)return;const remaining=activeChallenge.expires_at-now();$('challenge-countdown').textContent=remaining>0?`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`:'Expired';if(remaining<=0&&!evidence){liveCameraCapture.fail(new Error('The live camera challenge expired.'));stopCamera();$('start-camera').disabled=true;$('capture-state').textContent='CHALLENGE EXPIRED';}else $('start-camera').disabled=!!stream||cameraPending;}
setInterval(updateCountdown,1000);
function invalidateVerification(){verificationRevision++;verification=null;verifiedFile=null;retainedVerification=null;$('verify-result').hidden=true;$('verify-empty').hidden=false;$('accept-evidence').disabled=true;}
$('verify-file').addEventListener('change',()=>{invalidateVerification();$('verify-file-name').textContent=$('verify-file').files?.[0]?.name||'Choose a signed JPEG';});
$('verify-challenge').addEventListener('input',invalidateVerification);$('verify-device').addEventListener('input',invalidateVerification);
$('verify-location-proof').addEventListener('change',invalidateVerification);$('verify-location-key').addEventListener('input',invalidateVerification);
action('verify-evidence',async()=>{
  invalidateVerification();const revision=verificationRevision;const file=$('verify-file').files?.[0];if(!file)throw new Error('Choose the original signed JPEG.');if(file.size>32*1024*1024)throw new Error('The image exceeds the 32 MB verification limit.');
  const expected=$('verify-challenge').value.trim();if(!expected)throw new Error('Provide the original requester challenge.');const pin=$('verify-device').value.trim().toLowerCase();if(!/^[a-f0-9]{64}$/.test(pin))throw new Error('Provide the 64-character public device fingerprint received through a trusted channel.');
  const original=splitCameraRequest(expected);
  const bytes=new Uint8Array(await file.arrayBuffer());
  let proof=null,locationPin=null;
  if(original.locationRequest){
    locationPin=$('verify-location-key').value.trim().toLowerCase();
    if(!/^[a-f0-9]{64}$/.test(locationPin))throw new Error('Provide the separately trusted location capture key ID.');
    proof=await readLocationProof($('verify-location-proof').files?.[0]);
  }
  const retained=await retainCameraEvidence(locationEngine,{jpeg:bytes,proof,originalJson:expected,mediaPin:pin,locationPin,name:file.name});
  const report=await retained.verify();
  if(locationPin)report.expected_location_fingerprint=locationPin;
  const challenge=original.challenge;const accepted=await read('accepted',challenge.id);report.checks.not_previously_accepted=!accepted;report.verified=report.verified&&!accepted;report.accepted=!!accepted;report.requester_ledger='this device only';report.expected_challenge=challenge;report.expected_device_fingerprint=pin;
  report.location_required_for_acceptance=true;
  report.acceptance_eligible=report.verified&&report.capture?.version>=2&&report.checks.location_metadata_valid===true&&now()>=challenge.issued_at&&now()<challenge.expires_at;
  if(revision!==verificationRevision)return;
  verification=report;verifiedFile=retained.file;retainedVerification=retained;renderVerification();
});
const labels={c2pa_integrity:'File integrity & C2PA signature',challenge_match:'Exact requester challenge',device_match:'Expected signing identity',capture_time_in_window:'Claimed time within request window',capture_not_in_future:'Claimed time not in the future',location_proof_valid:'Required location proof & exact photo binding',not_previously_accepted:'Unused in this device’s acceptance ledger'};
function renderVerification(){
  const r=verification;$('verify-empty').hidden=true;$('verify-result').hidden=false;$('result-title').textContent=r.verified?'Integrity & challenge verified':r.accepted?'Challenge already accepted':'Evidence did not pass';
  $('result-summary').textContent=r.verified?'The intact file is signed by the expected key and includes your exact challenge. Capture time is the operator device’s claim.':r.accepted?'This device has already accepted evidence for that request.':(r.errors||[]).join(' ')||'One or more required checks failed. Do not accept this evidence.';
  const reportLabels={...labels};if(r.checks.location_proof_valid==null)delete reportLabels.location_proof_valid;if(r.capture?.version>=2)reportLabels.location_metadata_valid='GPS metadata matches signed capture';if(r.checks.native_camera_metadata_valid!=null)reportLabels.native_camera_metadata_valid='Native camera acquisition metadata is consistent';
  const checks=$('result-checks');checks.replaceChildren();for(const [name,label]of Object.entries(reportLabels)){const ok=r.checks?.[name]===true;const row=document.createElement('div');row.className=`check-row ${ok?'':'failed'}`;const icon=document.createElement('span');icon.className='check-icon';icon.textContent=ok?'✓':'×';const text=document.createElement('div');text.textContent=label;const state=document.createElement('span');state.textContent=ok?'PASS':'FAIL';row.append(icon,text,state);checks.append(row);}
  if(r.watermark?.id){const p=document.createElement('p');p.className='fineprint';p.textContent=`Pixel lookup ID: ${r.watermark.id}. This helps find a retained original; it does not authenticate an edited copy.`;checks.append(p);}
  const location=r.capture?.location;
  const fixDate=location?new Date(location.timestamp_ms):null;
  const fixTime=fixDate&&!Number.isNaN(fixDate.valueOf())?fixDate.toISOString():'unrepresentable device time';
  $('result-location-details').textContent=location&&r.checks.c2pa_integrity&&r.checks.location_metadata_valid===true
    ?`${locationSummary(location)}. Fix: ${fixTime}. Signed device-reported coordinates; physical location is not independently attested.`
    :location?'Location metadata could not be verified. Do not rely on these coordinates.':'No location recorded in this older photo.';
  if(r.location_proof){const proof=r.location_proof;$('result-location-details').textContent+=' '+locationTimingSummary(proof.evidence?.trace?.request?.policy)+' '+locationSealingSummary(proof.evidence);}
  if(r.verified&&!r.acceptance_eligible)$('result-summary').textContent+=r.checks.location_metadata_valid!==true?' Historical integrity verification passed, but fresh acceptance requires signed GPS metadata.':' The request window has closed; historical verification remains available, but fresh acceptance is disabled.';
  $('report-json').textContent=JSON.stringify(r,null,2);$('accept-evidence').disabled=!r.acceptance_eligible||r.accepted;
}
action('accept-evidence',async()=>{
  if(!verification?.verified||!retainedVerification)throw new Error('Verify intact evidence before accepting it.');
  const record=verification,revision=verificationRevision,retained=retainedVerification;
  await retained.accept(()=>revision===verificationRevision&&retained===retainedVerification&&!document.hidden);
  if(revision===verificationRevision){record.accepted=true;record.acceptance_eligible=false;record.checks.not_previously_accepted=false;record.verified=false;renderVerification();}
  notify('Evidence reverified and accepted once on this device. This is a local ledger entry.');
});
action('export-report',async()=>{if(!verification)throw new Error('Verify a photo first.');await saveArtifact('nonverba-verification.json','application/json',JSON.stringify({...verification,file:verifiedFile},null,2));});
engineReady.catch(error=>{$('runtime').classList.add('error');$('runtime').lastChild.textContent='Engine unavailable';notify(errorMessage(error),'error');for(const id of ['load-challenge','start-camera','capture','create-challenge','verify-evidence'])$(id).disabled=true;});

function checkLiveCameraPermissions(){
  const native=nativeCameraPlatform();
  if(native&&(native.capabilities.camera_permission!==true||locationPlatform().capabilities?.fine_permission!==true))throw new Error('Allow camera and precise location permissions before pairing the live camera.');
}
cameraSessionUI=installCameraSessionUI({engine:locationEngine,getOperatorPin:async()=>{await ensureIdentity();return cameraFingerprint;},getLocationPin:async()=>{await ensureIdentity();return (await getLocationIdentity({engine:locationEngine,identity})).fingerprint;},collect:spec=>liveCameraCapture.collect(spec),saveArtifact,nativeAvailable:()=>!!nativeCameraPlatform(),preparePermissions:signal=>{stopCamera();return prepareCameraPermissions({signal,checkPermissions:checkLiveCameraPermissions});},checkPermissions:checkLiveCameraPermissions});
installRetainedEvidenceUI({engine:locationEngine});
installRequestPresetSummary(document,'camera','camera-request-preset-summary',['camera-location-mode'],()=>({mode:$('camera-location-mode').value}));
