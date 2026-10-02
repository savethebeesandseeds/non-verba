// SPDX-License-Identifier: AGPL-3.0-only
import {CameraSession, readCameraOffer, cameraHints, cameraContext, cameraContextHash, CAMERA_CONTEXT, MAX_CAMERA_CONTEXT} from './camera-session.js';
import {encodeLocationProof} from './camera-location.js';
import {PairingFileImport as CameraPairingImport} from './pairing-import.js';
import {newRequestPreset, installRequestPresetSummary} from './request-presets.js';
import {requireLocationProfileReadiness} from './location-profile-readiness.js';
export {PairingFileImport as CameraPairingImport} from './pairing-import.js';
const text = value => JSON.stringify(value, null, 2);
const pin = value => value.trim().toLowerCase();
const errorText = error => String(error?.message || error);
const phaseText = {pairing:'Exchange pairing files. No fresh challenge exists yet.', connecting:'Connecting directly; keep both screens open.', connected:'Connected. The operator must allow the displayed task.',
  armed:'Task allowed. Waiting for the requester to issue a fresh challenge.', preparing:'Creating and reserving the fresh request…',
  'awaiting-image':'Challenge sent. Waiting for the complete signed JPEG (180 seconds).', 'awaiting-artifacts':'Challenge sent. Waiting for both the signed JPEG and matching location proof (180 seconds).', authenticating:'Checking the signed requester wrapper…',
  capturing:'Authenticated request loaded below. Enable location, open the camera, then use its shutter.',
  'awaiting-receipt':'Exact evidence sent. Waiting for the requester’s verified receipt.', verifying:'Complete evidence received. Verifying and sealing the requester receipt…',
  complete:'Exact evidence and requester receipt verified. Acceptance is a separate action.', failed:'Session stopped. Pair again for a new challenge.'};
/** UI only. CameraSession and the unchanged Rust/AgentRequester paths retain
 * authority and perform verification; no DOM text is an acceptance verdict. */
export function installCameraSessionUI({engine, getOperatorPin, getLocationPin, collect, saveArtifact, nativeAvailable, preparePermissions, checkPermissions = () => {},
  root = document, Session = CameraSession, nativePairing = globalThis.NativeCameraPairing,
  checkLocationProfile = requireLocationProfileReadiness}) {
  const $ = id => root.getElementById(id);
  let session = null, generation = 0, result = null, working = false, accepting = false, preflight=null, authority=null;
  const imports=new Map(), importedContexts=new Map();
  // Textarea values normalize CRLF. Keep imported UTF-8 bytes independently,
  // using them only while the displayed value remains unchanged.
  const exactInput=id=>{const held=importedContexts.get(id);return held&&held.displayed===$(id).value?held.exact:$(id).value;};
  const picker=new CameraPairingImport({current:()=>session,cancel:reason=>cancel(reason)});
  const inputs = ['camera-live-requester','camera-live-task','camera-live-assurance','camera-live-operator-pin','camera-live-requester-pin',
    'camera-live-location-profile','camera-live-location-pin','camera-live-hardware','camera-live-position','camera-live-context','camera-live-operator-context','camera-live-usb-token'];
  const snapshotIds=[...inputs,'camera-live-role','camera-live-offer-in'];
  const snapshot=()=>Object.fromEntries(snapshotIds.map(id=>[id,{value:$(id).value,checked:$(id).checked,exact:exactInput(id)}]));
  const unchanged=held=>held&&snapshotIds.every(id=>$(id).value===held[id].value&&$(id).checked===held[id].checked&&exactInput(id)===held[id].exact);
  const status = value => { $('camera-live-status').textContent = value; };
  const requesterPreset=()=>newRequestPreset('live-camera',{assurance:$('camera-live-assurance').value,
    location_profile:$('camera-live-location-profile').value,hardware_attestation_required:!!$('camera-live-hardware').checked,
    independent_position_required:!!$('camera-live-position').checked});
  function render() {
    const phase=session?.phase, busy=working||accepting||imports.size>0;
    for(const id of ['camera-live-create','camera-live-join','camera-live-identity','camera-live-location-identity'])$(id).disabled=busy||!!session;
    $('camera-live-connect').disabled=busy||session?.role!=='requester'||phase!=='pairing';
    $('camera-live-arm').disabled=busy||session?.role!=='operator'||phase!=='connected';
    $('camera-live-start').disabled=busy||session?.role!=='requester'||phase!=='connected'||!session.remoteArmed;
    $('camera-live-cancel').disabled=!session&&!working&&!imports.size;
    $('camera-live-accept').disabled=busy||!result||result.role!=='requester'||result.accepted||!result.report.fresh_action_eligible;
    $('camera-live-save-photo').disabled=!result||busy;$('camera-live-save-bundle').disabled=!result||busy;
    $('camera-live-save-location').disabled=!result?.locationProof||busy;$('camera-live-save-location').hidden=!result?.locationProof;
    $('camera-live-save-offer').disabled=busy||!$('camera-live-offer-out').value;
    $('camera-live-save-answer').disabled=busy||!$('camera-live-answer-out').value;
    for(const id of inputs)$(id).disabled=!!session||busy;
    for(const id of ['camera-live-context-file','camera-live-operator-context-file'])$(id).disabled=!!session||busy;
    $('camera-live-composed-options').hidden=$('camera-live-location-profile').value==='metadata';
    $('camera-live-role').disabled=!!session||busy;
    $('camera-live-offer-in').disabled=!!session||busy;$('camera-live-offer-file').disabled=!!session||busy;
    const usbAvailable=typeof nativePairing?.readOffer==='function';
    $('camera-live-usb-offer-panel').hidden=!usbAvailable;
    $('camera-live-usb-load').disabled=!usbAvailable||busy||!!session||$('camera-live-role').value!=='operator'
      ||$('camera-live-offer-in').value!==''||!/^[a-f0-9]{32}$/.test($('camera-live-usb-token').value);
    $('camera-live-answer-in').disabled=busy||session?.role!=='requester'||phase!=='pairing';
    $('camera-live-answer-file').disabled=$('camera-live-answer-in').disabled;
  }
  function cancel(reason='Camera session cancelled.') {
    preflight?.abort();preflight=null;picker.clear();imports.clear();generation++; const old=session;session=null;result=null;authority=null;
    old?.cancel(reason);$('camera-live-offer-out').value='';$('camera-live-answer-out').value='';$('camera-live-session-id').value='';$('camera-live-result').hidden=true;status(reason);render();
  }
  const callbacks = (token,held) => ({onState:value=>{if(token!==generation)return;if(!unchanged(held)){cancel('Camera session inputs changed. Pair again.');return;}const phase=value.phase==='awaiting-image'&&session?.hints.location_profile?'awaiting-artifacts':value.phase;status(value.detail||phaseText[phase]||phase);render();},
    onFailure:error=>{if(token!==generation)return;status(errorText(error));render();},
    onComplete:value=>{if(token!==generation)return;if(!unchanged(held)){cancel('Camera session inputs changed. Pair again.');return;}result=value;$('camera-live-result').hidden=false;
      $('camera-live-session-id').value=value.sessionId;$('camera-live-report').textContent=text(value.report);status(phaseText.complete);render();}});
  async function act(button, action) {
    if($(button).disabled)return;working=true;render();
    try{await action();}catch(error){session?.fail(error);status(errorText(error));}finally{working=false;render();}
  }
  function click(id, action) { $(id).addEventListener('click',()=>act(id,action)); }
  function current(token,held) { if(token!==generation||document.hidden||(held&&!unchanged(held)))throw new Error('Camera pairing inputs changed or pairing was cancelled.'); }
  click('camera-live-identity',async()=>{const token=generation,value=await getOperatorPin();current(token);$('camera-live-own-pin').textContent=value;});
  click('camera-live-location-identity',async()=>{
    if(typeof getLocationPin!=='function')throw new Error('The separate location identity is unavailable.');
    const token=generation,value=await getLocationPin();current(token);$('camera-live-own-location-pin').textContent=value;
  });
  click('camera-live-create',async()=>{
    const token=++generation,held=snapshot();result=null;$('camera-live-result').hidden=true;
    const preset=requesterPreset(),agreed={requester:held['camera-live-requester'].value,task:held['camera-live-task'].value,assurance:preset.assurance};
    let contextJson=CAMERA_CONTEXT,operatorLocationPin=null;
    if(held['camera-live-location-profile'].value!=='metadata'){
      contextJson=cameraContext(held['camera-live-context'].exact);operatorLocationPin=pin(held['camera-live-location-pin'].value);
      Object.assign(agreed,{location_profile:preset.location_profile,duration_ms:preset.duration_ms,hardware_attestation_required:preset.hardware_attestation_required,
        independent_position_required:preset.independent_position_required,context_sha256:await cameraContextHash(contextJson)});current(token,held);
    }
    const hints=cameraHints(agreed);authority=held;
    session=new Session({role:'requester',engine,operatorPin:pin(held['camera-live-operator-pin'].value),operatorLocationPin,contextJson,hints,...callbacks(token,held)});
    const offer=await session.offer();current(token,held);
    $('camera-live-own-requester-pin').textContent=offer.requester_pin;$('camera-live-offer-out').value=text(offer);
    status('Share the offer and your requester ID through the intended channels. The operator will return an answer. No challenge has been issued.');
  });
  click('camera-live-connect',async()=>{
    const token=generation,source=$('camera-live-answer-in').value;if(source.length>120000)throw new Error('Pairing answer exceeds its limit.');
    picker.clear();await session.answer(JSON.parse(source));current(token,authority);status('Connecting directly. No relay is configured; keep both screens open.');
  });
  click('camera-live-usb-load',async()=>{
    const token=generation,held=snapshot(),transfer=held['camera-live-usb-token'].value;
    current(token,held);
    if(typeof nativePairing?.readOffer!=='function'||session||imports.size||accepting||held['camera-live-role'].value!=='operator'
      ||held['camera-live-offer-in'].value!==''||!/^[a-f0-9]{32}$/.test(transfer))throw new Error('An empty offer field and a valid staged USB offer token are required before pairing.');
    status('Reading the staged USB pairing offer… No sensor or pairing session starts.');
    const value=await nativePairing.readOffer(transfer);
    current(token,held);
    if(value===null)throw new Error(typeof nativePairing.lastError==='function'?(nativePairing.lastError()||'The staged USB pairing offer could not be read.'):'The staged USB pairing offer could not be read.');
    if(typeof value!=='string'||!value.length||new TextEncoder().encode(value).length>120000)throw new Error('The staged USB pairing offer must be nonempty UTF-8 JSON no larger than 120 KB.');
    readCameraOffer(value);
    $('camera-live-offer-in').value=value;
    importedContexts.set('camera-live-offer-in',{exact:value,displayed:$('camera-live-offer-in').value});
    status('Staged USB offer loaded. Independently enter the requester ID, then prepare permissions and create an answer. No pairing or capture has started.');
  });
  click('camera-live-join',async()=>{
    const token=++generation,held=snapshot(),offer=readCameraOffer(held['camera-live-offer-in'].exact),known=pin(held['camera-live-requester-pin'].value),combined=offer.version===2;
    if(offer.requester_pin!==known)throw new Error('The offer does not match the requester ID received through your trusted channel.');
    if(offer.hints.assurance==='native-correlated'&&!nativeAvailable())throw new Error('This task requires the Android native camera and correlated capture clock.');
    if(combined)checkLocationProfile(offer.hints.location_profile);
    const contextJson=combined?cameraContext(held['camera-live-operator-context'].exact):CAMERA_CONTEXT;
    if(combined&&await cameraContextHash(contextJson)!==offer.hints.context_sha256)throw new Error('The independently loaded verifier context does not match this composed offer.');current(token,held);
    const actual=await getOperatorPin();current(token,held);
    if(actual!==offer.operator_pin)throw new Error('This offer was addressed to a different camera signing ID.');
    let locationPin=null;
    if(combined){
      if(typeof getLocationPin!=='function')throw new Error('The separate location identity is unavailable.');
      locationPin=await getLocationPin();current(token,held);
      if(locationPin!==offer.operator_location_pin)throw new Error('This offer was addressed to a different location signing ID.');
    }
    $('camera-live-own-pin').textContent=actual;if(combined)$('camera-live-own-location-pin').textContent=locationPin;
    if(typeof preparePermissions!=='function')throw new Error('Camera permission preparation is unavailable.');
    status('Preparing permissions: the camera opens briefly without recording sound. Its frames and the location fix are discarded.');
    const permission=new AbortController();preflight=permission;
    try{await preparePermissions(permission.signal);current(token,held);}finally{if(preflight===permission)preflight=null;}
    if(await getOperatorPin()!==actual)throw new Error('The camera identity changed during permission preparation.');current(token,held);
    if(combined&&await getLocationPin()!==locationPin)throw new Error('The location identity changed during permission preparation.');current(token,held);
    authority=held;
    session=new Session({role:'operator',engine,requesterPin:known,operatorPin:actual,operatorLocationPin:locationPin,contextJson,hints:offer.hints,pairingId:offer.pairing_id,
      collect,getOperatorPin,getLocationPin,...callbacks(token,held)});
    const answer=await session.join(offer);current(token,held);$('camera-live-answer-out').value=text(answer);
    const duration=(offer.hints.duration_ms ?? 10000)/1000;
    const profiles={'browser-or-native':`${duration}-second location proof; browser or Android observations allowed`,'native-required':`${duration}-second Android native location proof`,
      'native-gnss':`${duration}-second Android GNSS location proof`,'raw-gnss':`${duration}-second Android GNSS proof with raw satellite measurements required`};
    $('camera-live-agreed').textContent=`Requester: ${session.hints.requester}. Task: ${session.hints.task}. Required camera: ${session.hints.assurance}. Camera ID: ${actual}. `+
      (combined?`Separate location proof: ${profiles[offer.hints.location_profile]}. Location ID: ${locationPin}. Both signer attestations required: ${offer.hints.hardware_attestation_required?'yes':'no'}. Independent position recomputation required: ${offer.hints.independent_position_required?'yes':'no'}. Verifier context SHA-256: ${offer.hints.context_sha256}.`:'Photo with GPS metadata only; no separate location proof requested.');
    status('Return the answer. After connection, read the task and explicitly allow it before the requester issues a challenge.');
  });
  click('camera-live-arm',async()=>{const token=generation,owner=session;if(owner.hints.location_profile)checkLocationProfile(owner.hints.location_profile);await checkPermissions();current(token,authority);return owner.arm();});
  click('camera-live-start',()=>{current(generation,authority);return session.start();});
  $('camera-live-cancel').addEventListener('click',()=>cancel());
  $('camera-live-role').addEventListener('change',()=>{
    cancel('Choose your role, then pair before issuing a challenge.');
    $('camera-live-requester-panel').hidden=$('camera-live-role').value!=='requester';
    $('camera-live-operator-panel').hidden=$('camera-live-role').value!=='operator';
  });
  for(const id of [...inputs,'camera-live-offer-in'])for(const event of ['input','change'])$(id).addEventListener(event,()=>{
    importedContexts.delete(id);if(session||working||imports.size)cancel('Camera session inputs changed. Pair again.');else generation++;render();
  });
  $('camera-live-answer-file').addEventListener('click',()=>picker.begin());
  $('camera-live-answer-file').addEventListener('cancel',()=>picker.clear());
  window.addEventListener('nonverba:file-picker',event=>picker.nativeEvent(event.detail?.active));
  // Imports retain exact input bytes and one selected-file generation. A late
  // read cannot replace manual edits, newer selections, or a pairing configuration.
  for(const [input,target,context] of [['camera-live-offer-file','camera-live-offer-in',false],['camera-live-answer-file','camera-live-answer-in',false],
    ['camera-live-context-file','camera-live-context',true],['camera-live-operator-context-file','camera-live-operator-context',true]]){
    $(input).addEventListener('change',async()=>{
      if(session&&input!=='camera-live-answer-file')return;
      const token=generation,held=snapshot(),file=$(input).files?.[0],previous=$(target).value,job={};imports.set(input,job);render();
      const latest=()=>imports.get(input)===job;
      try{
        if(!file)return;const limit=context?MAX_CAMERA_CONTEXT:120000;
        if(!Number.isSafeInteger(file.size)||file.size<1||file.size>limit)throw new Error(context?'Choose a verifier context JSON file no larger than 4 MiB.':'Pairing file exceeds 120 KB.');
        let value;
        if(context){const bytes=await file.arrayBuffer();if(bytes.byteLength>limit)throw new Error('Verifier context exceeds its byte limit.');value=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
        else value=await file.text();
        if(input==='camera-live-answer-file')await picker.foreground();
        current(token,held);
        if(!latest()||$(input).files?.[0]!==file||$(target).value!==previous)throw new Error('Camera file import was replaced or edited.');
        if(new TextEncoder().encode(value).length>limit)throw new Error('Camera file exceeds its byte limit.');
        $(target).value=context?cameraContext(value):value;
        if(context||target==='camera-live-offer-in')importedContexts.set(target,{exact:value,displayed:$(target).value});
        if(input==='camera-live-answer-file')picker.clear();
      }catch(error){if(latest()){if(input==='camera-live-answer-file')picker.clear();status(errorText(error));}}
      finally{if(latest()){imports.delete(input);$(input).value='';render();}}
    });
  }
  click('camera-live-save-offer',()=>saveArtifact('nonverba-camera-offer.json','application/json',$('camera-live-offer-out').value));
  click('camera-live-save-answer',()=>saveArtifact('nonverba-camera-answer.json','application/json',$('camera-live-answer-out').value));
  click('camera-live-save-photo',()=>saveArtifact(`nonverba-camera-live-${result.sessionId.slice(0,12)}.jpg`,'image/jpeg',result.bytes));
  click('camera-live-save-location',()=>saveArtifact(`nonverba-camera-live-${result.sessionId.slice(0,12)}-location.json`,'application/json',encodeLocationProof(result.locationProof)));
  click('camera-live-save-bundle',()=>saveArtifact(`nonverba-camera-live-${result.sessionId.slice(0,12)}.json`,'application/json',text(result.bundle)));
  $('camera-live-accept').addEventListener('click',async()=>{
    if($('camera-live-accept').disabled||document.hidden)return;accepting=true;const owner=session,token=generation,held=authority;render();
    try{const accepted=await owner.accept(()=>owner===session&&token===generation&&!document.hidden&&unchanged(held));if(owner!==session||token!==generation||!unchanged(held))throw new Error('Camera session changed during acceptance.');
      result.accepted=accepted;status('Evidence reverified and accepted once in this browser origin’s durable ledger. No global acceptance or physical truth is claimed.');
    }catch(error){status(errorText(error));}finally{accepting=false;render();}
  });
  function suspend(reason){if((session&&!picker.permitsPause())||(!session&&(imports.size||(working&&!preflight))))cancel(reason);}
  document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend('Camera session stopped because this page was hidden.');});
  window.addEventListener('pagehide',()=>{if(session||preflight||working||imports.size)cancel('Camera session stopped because this page was left.');});
  window.addEventListener('nonverba:pause',()=>suspend('Camera session stopped because Android paused this screen.'));
  installRequestPresetSummary(root,'live-camera','camera-live-preset-summary',
    ['camera-live-assurance','camera-live-location-profile','camera-live-hardware','camera-live-position'],requesterPreset);
  render();return {cancel, get active(){return !!session;}};
}
