// SPDX-License-Identifier: AGPL-3.0-only
// New UI preset selections exercised through actual controller request factories
// and shipped Rust/WASM. Peer and requester transport are doubles; no sensors,
// IndexedDB acceptance, recording, acoustic output or physical assurance tested.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadShippedCore} from '../tools/image-requester-session.mjs';
import {newRequestPreset, requestPresetSummary, installRequestPresetSummary} from '../../web/src/request-presets.js';
import {locationPolicy} from '../../web/src/location-policy.js';
import {createCameraRequest, splitCameraRequest} from '../../web/src/camera-location.js';

globalThis.document = Object.assign(new EventTarget(), {hidden:false});
globalThis.window = Object.assign(new EventTarget(), {crypto:globalThis.crypto});
// These modules open browser stores when imported. Our injected requester never
// uses them; an inert pending open deliberately catches accidental store usage.
globalThis.indexedDB = {open() { return {}; }};
const {CameraSession, cameraContextHash, CAMERA_CONTEXT, authenticateCameraSession, cameraHints, readCameraOffer} = await import('../../web/src/camera-session.js');
const {LiveLocationSession, authenticateLocationSession, readLiveOffer} = await import('../../web/src/live-location-session.js');
const {locationContextHash, LOCATION_CONTEXT, locationSessionHints} = await import('../../web/src/location-session-policy.js');
const {AudioEvidenceSession, audioHints} = await import('../../web/src/audio-session.js');
const {core} = await loadShippedCore();
const requester = core.create_identity(), media = core.create_identity(), location = core.create_identity();
const requesterPin = JSON.parse(core.live_requester_identity(requester)).pin.sha256;
const mediaPin = JSON.parse(media).fingerprint, locationPin = JSON.parse(core.live_requester_identity(location)).pin.sha256;
const engine = {call:async (name,...args) => core[name](...args), json:async (name,...args) => JSON.parse(await core[name](...args))};
const now = () => Math.floor(Date.now()/1000), words = {requester:'Synthetic default requester',task:'Synthetic preset only'};
const peer = () => ({description:async type => ({type,sdp:'synthetic transport only'}),sent:[],
  send(message) { this.sent.push(structuredClone(message)); }, close() { this.closed=true; }});
function requesterDouble() {
  return {payloads:[],identity:async () => requesterPin,close() {},
    async start(factory, {send}) {
      const spec = await factory(engine, now());
      const envelope = await engine.call('create_evidence_session_request',JSON.stringify(spec),requester,now());
      const payload = await engine.json('validate_evidence_session_request',envelope,requesterPin,JSON.stringify(spec.operator_pins),now());
      this.payloads.push(payload);
      await send({sessionId:payload.session_id,envelope,request:payload.spec.evidence});
      return {sessionId:payload.session_id,requesterPin};
    }
  };
}
const noTrustClaims = policy => {
  assert.equal(policy.hardware_attestation_required,false);
  assert.equal(policy.independent_position_required,false);
  assert.equal(Object.hasOwn(policy,'physical_measurement_authenticity_proven'),false);
  assert.equal(Object.hasOwn(policy,'acceptance_recorded'),false);
};
function requiredRaw(policy, durationMs = 2000) {
  assert.equal(policy.profile,'native-required');assert.equal(policy.required_provider,'gnss');
  assert.equal(policy.duration_ms,durationMs);assert.equal(policy.raw_gnss.mode,'required');
  assert.equal(policy.min_samples,3);
  assert.equal(policy.raw_gnss.min_satellites,4);assert.equal(policy.raw_gnss.min_epochs,3);
  assert.equal(policy.raw_gnss.max_elapsed_realtime_uncertainty_ns,100000000);
}

test('new bare camera default produces a Rust-validated raw GNSS request while explicit reduced modes remain distinct',async () => {
  const preset=newRequestPreset('camera');
  const envelope=await createCameraRequest(engine,words.requester,words.task,now(),300,preset.mode,preset.duration_ms);
  requiredRaw(envelope.location_request.policy);assert.equal(envelope.location_request.context.camera_timing,'concurrent');
  assert.equal(splitCameraRequest(JSON.stringify(envelope)).locationRequest.policy.raw_gnss.mode,'required');
  for(const mode of ['trace','native','metadata']){
    const selected=newRequestPreset('camera',{mode});
    assert.equal(selected.duration_ms,10000);
    const reduced=await createCameraRequest(engine,words.requester,words.task,now(),300,selected.mode,selected.duration_ms);
    const parts=splitCameraRequest(JSON.stringify(reduced));
    if(mode==='metadata')assert.equal(parts.locationRequest,null);
    else {assert.equal(parts.locationRequest.policy.raw_gnss,undefined);assert.equal(parts.locationRequest.policy.required_provider,mode==='native'?'gnss':'any');}
  }
});

test('live camera default offer freezes native correlated camera and raw GPS then signs the same strict policy only after consent',async () => {
  const transport=requesterDouble(),hints={...words,...newRequestPreset('live-camera'),context_sha256:await cameraContextHash(CAMERA_CONTEXT)};
  const session=new CameraSession({role:'requester',engine,operatorPin:mediaPin,operatorLocationPin:locationPin,hints,
    requesterFactory:async()=>transport,peerFactory:peer});
  try {
    const offer=await session.offer();assert.equal(offer.version,2);assert.equal(offer.hints.assurance,'native-correlated');
    assert.equal(offer.hints.location_profile,'raw-gnss');assert.equal(offer.hints.duration_ms,2000);assert.equal(transport.payloads.length,0);
    assert.deepEqual(readCameraOffer(JSON.stringify(offer)).hints,offer.hints);
    await assert.rejects(session.start(),/operator to allow/);assert.equal(transport.payloads.length,0);
    session.phase='connected';session.connected=true;session.remoteArmed=true;await session.start();
    const payload=transport.payloads[0];assert.equal(payload.spec.evidence.type,'camera-location');requiredRaw(payload.spec.evidence.request.policy);
    assert.equal(payload.spec.policy.native_acquisition_required,true);assert.equal(payload.spec.policy.correlated_camera_clock_required,true);
    assert.equal(payload.spec.policy.raw_gnss_required,true);noTrustClaims(payload.spec.policy);
  } finally { session.cancel('Synthetic preset test complete'); }
});

test('explicit version-one image-only camera agreement is not upgraded by the new presets',async () => {
  const transport=requesterDouble(),hints={...words,assurance:'browser-or-android'};
  const session=new CameraSession({role:'requester',engine,operatorPin:mediaPin,hints,requesterFactory:async()=>transport,peerFactory:peer});
  try {
    const offer=await session.offer();assert.equal(offer.version,1);assert.equal(Object.hasOwn(offer.hints,'location_profile'),false);
    session.phase='connected';session.connected=true;session.remoteArmed=true;await session.start();
    const payload=transport.payloads[0];assert.equal(payload.spec.evidence.type,'image');
    assert.equal(payload.spec.operator_pins.location_spki_sha256,null);assert.equal(payload.spec.policy.raw_gnss_required,false);
    assert.equal(payload.spec.policy.native_acquisition_required,false);noTrustClaims(payload.spec.policy);
  } finally { session.cancel('Synthetic reduced preset test complete'); }
});

test('standalone and live location defaults require raw observations without changing the older low-level default',async () => {
  assert.equal(locationPolicy().profile,'browser-or-native');assert.equal(locationPolicy().raw_gnss,undefined);
  const selected=newRequestPreset('location');
  assert.equal(locationPolicy('raw-gnss').duration_ms,10000);
  const standalone=await engine.json('create_location_request',words.requester,words.task,now(),900,JSON.stringify(locationPolicy(selected.profile,selected.duration_ms)),'null');
  requiredRaw(standalone.policy);
  const transport=requesterDouble(),hints={...words,...selected,demo:false,context_sha256:await locationContextHash(LOCATION_CONTEXT)};
  const session=new LiveLocationSession({role:'requester',engine,operatorPin:locationPin,hints,requesterFactory:async()=>transport,peerFactory:peer});
  try {
    const offer=await session.offer();assert.equal(offer.hints.duration_ms,2000);assert.equal(transport.payloads.length,0);
    assert.deepEqual(readLiveOffer(JSON.stringify(offer)).hints,offer.hints);
    session.phase='connected';session.connected=true;session.remoteArmed=true;await session.start();
    const payload=transport.payloads[0];requiredRaw(payload.spec.evidence.request.policy);
    assert.equal(payload.spec.policy.native_acquisition_required,true);assert.equal(payload.spec.policy.raw_gnss_required,true);noTrustClaims(payload.spec.policy);
  } finally { session.cancel('Synthetic location preset test complete'); }
});

test('actual audio requester factory defaults to ten seconds and monitored native acquisition without invoking audio',async () => {
  for(const selections of [{},{assurance:'browser-or-android',duration_secs:4}]){
    const hints=audioHints({...words,...newRequestPreset('audio',selections)}),transport=requesterDouble();
    const session=new AudioEvidenceSession(engine,mediaPin,hints);
    session.requester.close();session.requester=transport;
    try {
      await session.start(async()=>{});const payload=transport.payloads[0],complete=selections.assurance===undefined;
      assert.equal(payload.spec.evidence.request.duration_secs,complete?10:4);
      assert.equal(payload.spec.policy.native_acquisition_required,complete);assert.equal(payload.spec.policy.audio_recording_monitoring_required,complete);
      assert.equal(payload.spec.policy.raw_gnss_required,false);noTrustClaims(payload.spec.policy);
    } finally { session.close(); }
  }
});

test('signed demo constructors and imported explicit requests retain their original reduced semantics',async () => {
  const locationDemo=await engine.json('create_location_demo_request',now());
  assert.equal(locationDemo.demo,true);assert.equal(locationDemo.policy.profile,'browser-or-native');assert.equal(locationDemo.policy.raw_gnss,undefined);
  const audioDemo=await engine.json('create_audio_demo_request',now());assert.equal(audioDemo.demo,true);assert.equal(audioDemo.duration_secs,4);
  const original=await engine.json('create_location_request',words.requester,words.task,now(),900,JSON.stringify(locationPolicy('browser-or-native')),'null');
  const saved=JSON.stringify(original);newRequestPreset('location');
  const validated=await engine.json('validate_location_request',saved,now());assert.deepEqual(validated,original);assert.equal(JSON.stringify(original),saved);
  for(const duration_ms of [10000,15000]){
    const raw=await engine.json('create_location_request',words.requester,words.task,now(),900,JSON.stringify(locationPolicy('raw-gnss',duration_ms)),'null');
    const before=JSON.stringify(raw);newRequestPreset('location');
    assert.deepEqual(await engine.json('validate_location_request',before,now()),raw);assert.equal(JSON.stringify(raw),before);
    const preset=newRequestPreset('camera',{duration_ms});
    const camera=await createCameraRequest(engine,words.requester,words.task,now(),300,preset.mode,preset.duration_ms);
    requiredRaw(camera.location_request.policy,duration_ms);
  }
  const legacy=await createCameraRequest(engine,words.requester,words.task,now(),300,'raw');
  requiredRaw(legacy.location_request.policy,10000);
});

test('legacy raw live agreements keep ten seconds while explicit short and longer durations are signed and authenticated exactly',async () => {
  for(const kind of ['location','camera'])for(const duration of [undefined,2000,10000,15000]){
    const at=now(),camera=kind==='camera';
    const base={...words,hardware_attestation_required:false,independent_position_required:false,
      context_sha256:camera?await cameraContextHash(CAMERA_CONTEXT):await locationContextHash(LOCATION_CONTEXT)};
    const hints=camera?{...base,assurance:'native-correlated',location_profile:'raw-gnss'}:{...base,profile:'raw-gnss',demo:false};
    if(duration!==undefined)hints.duration_ms=duration;
    const expected=duration??10000;
    const request=await engine.json('create_location_request',words.requester,words.task,at,300,JSON.stringify(locationPolicy('raw-gnss',expected)),'null');
    if(camera)request.context={session_id:request.challenge.id,purpose:'camera',camera_timing:'concurrent'};
    const spec={version:1,evidence:{type:camera?'camera-location':'location',request},
      operator_pins:{media_certificate_sha256:camera?mediaPin:null,location_spki_sha256:locationPin},
      policy:{version:1,native_acquisition_required:true,raw_gnss_required:true,correlated_camera_clock_required:camera,
        hardware_attestation_required:false,independent_position_required:false},
      delivery:{max_response_ms:camera?180000:90000,max_receipt_age_ms:60000}};
    const original=await engine.call('create_evidence_session_request',JSON.stringify(spec),requester,at);
    const authenticate=agreement=>camera?authenticateCameraSession(engine,original,requesterPin,mediaPin,agreement,
      {operatorLocationPin:locationPin,contextJson:CAMERA_CONTEXT}):authenticateLocationSession(engine,original,requesterPin,locationPin,agreement);
    const payload=await authenticate(hints);requiredRaw(payload.spec.evidence.request.policy,expected);
    const parsed=camera?cameraHints(hints):locationSessionHints(hints);
    assert.equal(Object.hasOwn(parsed,'duration_ms'),duration!==undefined,'Legacy hint shape remains unchanged');
    await assert.rejects(authenticate({...hints,duration_ms:expected===2000?10000:2000}),/differs/);
    if(duration===2000){const without={...hints};delete without.duration_ms;await assert.rejects(authenticate(without),/differs/);}
  }
});

test('raw duration must be explicit and bounded; invalid hints and short nonraw requests do not fall back',async () => {
  const base={...words,hardware_attestation_required:false,independent_position_required:false,
    context_sha256:await locationContextHash(LOCATION_CONTEXT)};
  for(const duration_ms of [null,undefined,'2000',1999,15001,2000.5]){
    assert.throws(()=>locationSessionHints({...base,profile:'raw-gnss',demo:false,duration_ms}),/duration/);
    assert.throws(()=>cameraHints({...base,assurance:'native-correlated',location_profile:'raw-gnss',duration_ms}),/duration/);
  }
  for(const profile of ['browser-or-native','native-required','native-gnss']){
    assert.equal(newRequestPreset('location',{profile}).duration_ms,10000);
    assert.throws(()=>locationPolicy(profile,2000),/duration/);
  }
  assert.equal(newRequestPreset('location',{duration_ms:15000}).duration_ms,15000);
});

test('empty, invalid and best-effort selections are not silently replaced with supported defaults',() => {
  for(const profile of ['',null,'best-effort'])assert.throws(()=>locationPolicy(newRequestPreset('location',{profile}).profile),/Unknown location/);
  for(const assurance of ['',null,'best-effort'])assert.throws(()=>audioHints({...words,...newRequestPreset('audio',{assurance})}),/assurance policy/);
  assert.throws(()=>newRequestPreset('__proto__'),/Unknown/);assert.throws(()=>newRequestPreset('camera',{best_effort:true}),/Unknown/);
  assert.equal(newRequestPreset('location',{profile:'browser-or-native'}).profile,'browser-or-native');
  assert.equal(newRequestPreset('location').profile,'raw-gnss');
});

test('visible summaries follow explicit reduced-profile changes without rewriting the selected value or making trust claims',() => {
  const selector=Object.assign(new EventTarget(),{value:'raw-gnss'}),summary={textContent:''};
  const root={getElementById:id=>id==='profile'?selector:summary};
  installRequestPresetSummary(root,'location','summary',['profile'],()=>({profile:selector.value}));
  assert.match(summary.textContent,/2-second.*raw satellite observations required/);assert.match(summary.textContent,/Hardware attestation not required/);
  selector.value='browser-or-native';selector.dispatchEvent(new Event('change'));
  assert.match(summary.textContent,/10-second.*browser or Android allowed/);assert.doesNotMatch(summary.textContent,/raw satellite observations required/);
  assert.equal(selector.value,'browser-or-native');assert.match(requestPresetSummary('audio'),/10 seconds.*monitored/);
});
