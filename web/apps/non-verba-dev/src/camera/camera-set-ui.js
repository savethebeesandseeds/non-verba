// SPDX-License-Identifier: AGPL-3.0-only
import {createCoreClient} from '../../../../shared/runtime/core-client.js';
import {freshLocation} from '../../../../shared/location/location.js';
import {cameraSetPlatform,collectCameraSet,MAX_CAMERA_SET_JSON} from '../../../../shared/camera/camera-set-platform.js';
const $=id=>document.getElementById(id), core=createCoreClient();
let platform=null, bundle=null, controller=null, stream=null, identity=null;
let browserRequest=null, inventory=null;
const urls=[];
const now=()=>Math.floor(Date.now()/1000);
const json=value=>JSON.stringify(value,null,2);
const message=error=>String(error?.message||error);
function status(value) { $('status').textContent=typeof value==='string'?value:json(value); }
function active(signal) {if(signal?.aborted)throw new DOMException('Capture cancelled.','AbortError');}
function stop(expected) {
  if(expected && controller !== expected)return;
  controller?.abort();controller=null;browserRequest=null;
  stream?.getTracks().forEach(track=>track.stop());stream=null;$('preview').srcObject=null;$('preview').hidden=true;
  $('browser-shutter').hidden=true;$('capture').disabled=false;$('cancel').disabled=true;
}
function bytes64(bytes) {let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(text);}
async function save(name,value) {
  const bytes=new TextEncoder().encode(typeof value==='string'?value:json(value));
  if(globalThis.NativeVault) {if(bytes.length>32*1024*1024)throw new Error('Android export exceeds its 32 MiB storage bound. Evidence remains available in this page.');
    if(!NativeVault.saveArtifact(name,'application/json',bytes64(bytes)))throw new Error('Device storage refused the export. Evidence remains available in this page.');return;}
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function showBundle(value) {
  bundle=value;$('save-bundle').disabled=false;
  urls.splice(0).forEach(url=>URL.revokeObjectURL(url));$('photos').replaceChildren();
  for(const image of value.images||[]) {
    if(typeof image.jpeg_b64!=='string' || image.jpeg_b64.length>Math.ceil(32*1024*1024/3)*4)throw new Error('Invalid camera-set image size.');
    const bytes=Uint8Array.from(atob(image.jpeg_b64),c=>c.charCodeAt(0)), url=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));urls.push(url);
    const figure=document.createElement('figure'), caption=document.createElement('figcaption'),photo=document.createElement('img');
    caption.textContent=`Camera ${image.camera_id} · verification pending`;photo.alt=`Retrieved camera ${image.camera_id}`;photo.src=url;photo.width=320;
    figure.append(caption,photo);$('photos').append(figure);
  }
}
async function readFile(input,max) {const file=input.files?.[0];if(!file)throw new Error('Select a file.');if(file.size>max)throw new Error('Import exceeds its resource bound.');return file.text();}
function action(id,fn) {$(id).addEventListener('click',()=>Promise.resolve().then(fn).catch(error=>status(message(error))));}
function selectTiming() {
  $('skew-label').hidden=$('timing-mode').value!=='concurrent';
  if(!$('profile').value)return;
  const profile=JSON.parse($('profile').value);
  if(profile.kind!=='front-back')return;
  profile.timing=$('timing-mode').value==='sequential'?{mode:'sequential'}:{mode:'concurrent',max_start_skew_ns:$('max-skew').value};
  $('profile').value=json(profile);
}
for(const id of ['timing-mode','max-skew'])$(id).addEventListener('change',()=>{try {selectTiming();}catch(error){status(message(error));}});
action('discover',async()=>{
  stop();platform=cameraSetPlatform();
  if(platform) {
    inventory=platform.capabilities;$('acquisition').value='native-camera2';
    const front=inventory.cameras.find(c=>c.lens_facing==='front'),back=inventory.cameras.find(c=>c.lens_facing==='back');
    if(front&&back)$('profile').value=json({version:1,kind:'front-back',cameras:[back,front],timing:{mode:'sequential'}});
    else if(inventory.cameras.length===1)$('profile').value=json({version:1,kind:'single-camera',cameras:inventory.cameras,timing:{mode:'single'}});
    $('identity').textContent=`Current media certificate fingerprint: ${inventory.key_fingerprint}`;
  } else {
    const permission=await navigator.mediaDevices.getUserMedia({video:true,audio:false});try {
      inventory={cameras:(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput').map(d=>({camera_id:d.deviceId,lens_facing:'unknown'})),concurrent_sets:null};
    } finally {permission.getTracks().forEach(t=>t.stop());}
    $('acquisition').value='browser';
    if(inventory.cameras.length)$('profile').value=json({version:1,kind:'single-camera',cameras:[inventory.cameras[0]],timing:{mode:'single'}});
    identity=await core.call('create_identity');$('identity').textContent=`Ephemeral browser media fingerprint: ${JSON.parse(identity).fingerprint}. Save any required identity through the existing enrollment flow; this trial page keeps it in memory only.`;
  }
  $('timing-mode').value='sequential';$('timing-mode').disabled=JSON.parse($('profile').value).kind!=='front-back';$('skew-label').hidden=true;
  $('inventory').value=json(inventory);status('Review the selected camera IDs and timing policy before creating the request.');
});
action('create',async()=>{
  $('request').value=await core.call('create_camera_set_request',$('requester').value,$('task').value,$('profile').value,$('acquisition').value,now(),120);
  status('Fresh request created. Retain it and the independently expected key before capture.');
});
action('save-request',()=>save('camera-set-request.json',$('request').value));
$('import-request').addEventListener('change',async()=>{try {stop();$('request').value=await readFile($('import-request'),32*1024);status('Request imported.');}catch(error){status(message(error));}});
$('import-bundle').addEventListener('change',async()=>{try {stop();const text=await readFile($('import-bundle'),MAX_CAMERA_SET_JSON);const value=JSON.parse(text);
  if(value?.type!=='nonverba-camera-set-bundle' || !Array.isArray(value.images) || value.images.length>16)throw new Error('Invalid camera-set transport.');showBundle(value);status('Camera set imported. Verify with the separately retained original and expected key.');}catch(error){status(message(error));}});
action('capture',async()=>{
  stop();const request=await core.json('validate_camera_set_request',$('request').value,now());
  const own=new AbortController();controller=own;$('capture').disabled=true;$('cancel').disabled=false;
  try {
    if(request.acquisition==='native-camera2') {
      platform=cameraSetPlatform();if(!platform)throw new Error('This request requires the Android native collector.');
      // Resolve any first-use location permission overlay before opening cameras.
      await freshLocation(own.signal);active(own.signal);
      const value=await collectCameraSet({platform,request,signal:own.signal,acquireLocation:()=>freshLocation(own.signal),
        onStatus:value=>{const diagnostic={...value,result:value.result?'Signed image set available':undefined};$('diagnostics').textContent=json(diagnostic);status(diagnostic);}});
      active(own.signal);showBundle(value);status('Camera set retrieved. Verify all members and the requested timing before acceptance.');stop(own);
    } else {
      if(globalThis.NativeCameraSet)throw new Error('Use the explicit native-camera2 request on Android.');
      if(!identity)throw new Error('Inspect this device’s cameras to prepare its browser identity.');
      const camera=request.profile.cameras[0];
      const acquired=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:camera.camera_id}},audio:false});
      if(own.signal.aborted){acquired.getTracks().forEach(t=>t.stop());active(own.signal);}stream=acquired;
      const track=stream.getVideoTracks()[0];if(track?.getSettings().deviceId!==camera.camera_id)throw new Error('Browser returned a different camera.');
      $('preview').srcObject=stream;$('preview').hidden=false;await $('preview').play();active(own.signal);
      browserRequest=request;$('browser-shutter').hidden=false;status('Frame the single-camera photo, then press its shutter.');
    }
  } catch(error) {stop(own);throw error;}
});
action('browser-shutter',async()=>{
  const request=browserRequest,own=controller;if(!request||!own)return;$('browser-shutter').disabled=true;
  try {
    const location=await freshLocation(own.signal);active(own.signal);
    const video=$('preview'),canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    if(canvas.width<256||canvas.height<256||canvas.width*canvas.height>16777216)throw new Error('Browser frame dimensions are outside the supported profile.');
    canvas.getContext('2d').drawImage(video,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.95));if(!blob)throw new Error('Browser returned no JPEG.');active(own.signal);
    const attempt=crypto.randomUUID(),camera=request.profile.cameras[0].camera_id;
    const sealed=await core.call('seal_browser_camera_set_member',new Uint8Array(await blob.arrayBuffer()),JSON.stringify(request),attempt,camera,identity,JSON.stringify(location),now());active(own.signal);
    showBundle({version:1,type:'nonverba-camera-set-bundle',request,attempt_id:attempt,images:[{camera_id:camera,jpeg_b64:bytes64(sealed)}]});
    status('Browser single-camera set retrieved. Its software signature does not certify sensor origin.');
  } finally {stop();$('browser-shutter').disabled=false;}
});
action('cancel',()=>{stop();status('Capture cancelled. Any native cleanup status was reported separately.');});
action('save-bundle',async()=>{if(!bundle)throw new Error('No camera set is available.');await save(`camera-set-${bundle.attempt_id}.json`,bundle);status('Exact camera-set file saved locally.');});
action('verify',async()=>{
  if(!bundle)throw new Error('Retrieve or import a camera set first.');
  const result=await core.json('verify_camera_set',JSON.stringify(bundle),$('request').value,$('pin').value.trim(),now());
  const gap=result.exposure_start_span_ns;
  $('verification-summary').textContent=`Verified: ${result.verified}\nTiming mode: ${result.timing_policy.mode}\nTiming assessment: ${result.timing}\nExposure-start span: ${gap===null?'unavailable':`${gap} ns (${Number(BigInt(gap)/1000n)/1000} ms)`}\nMembers: ${result.members.length}\nPhysical simultaneity proven: false`;
  $('report').textContent=json(result);status(result.verified?'Camera-set software verification passed. Physical authenticity and independent receipt remain separate.':'Camera-set verification did not pass. Inspect missing members, signatures and timing.');
});
for(const event of ['pagehide','nonverba:pause'])globalThis.addEventListener(event,()=>stop());
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
core.ready.catch(error=>status(message(error)));
