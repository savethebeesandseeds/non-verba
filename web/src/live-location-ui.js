// SPDX-License-Identifier: AGPL-3.0-only
import {createCoreClient} from './core-client.js';
import {LiveLocationSession, readLiveOffer, verifyLocationSessionBundle, verifyHistoricalLocationReceipt} from './live-location-session.js';
import {LOCATION_CONTEXT, MAX_LOCATION_CONTEXT, locationContext, locationContextHash, locationSessionHints, locationEvidencePolicy} from './location-session-policy.js';
import {LOCATION_VERIFIER_FIELDS, retainLocationVerificationInputs, createLocationContextImporter} from './location-verification-inputs.js';
import {loadRequesterIdentity} from './live-session-storage.js';
import {loadIdentity, saveIdentity} from './storage.js';
import {getLocationIdentity, locationPlatform, locationProofEnvelope, readLocationProofEnvelope, MAX_LOCATION_PROOF, bytesToBase64} from './location-platform.js';
import {newRequestPreset, installRequestPresetSummary} from './request-presets.js';
import {requireLocationProfileReadiness} from './location-profile-readiness.js';
const $=id=>document.getElementById(id), engine=createCoreClient(), json=JSON.stringify;
let acceptanceRevision=0, ready=false, requesterKey, operatorIdentity, operatorKey, requester, operator, result;
const busy=new Set(), active=session=>session&&!['complete','failed'].includes(session.phase);
function notice(message,error=false){$('live-notice').hidden=false;$('live-notice').textContent=message;$('live-notice').className='notice '+(error?'error':'');}
function status(message){$('live-status').textContent=message;}
function pin(id){const value=$(id).value.trim().toLowerCase();if(!/^[0-9a-f]{64}$/.test(value))throw new Error('Provide the 64-character key ID through a trusted channel.');return value;}
function update(){
  const running=active(requester)||active(operator), working=busy.size>0;
  for(const id of ['live-demo','live-create-offer','live-join'])$(id).disabled=!ready||running||working;
  $('live-connect').disabled=!ready||working||requester?.phase!=='pairing';
  $('live-start').disabled=!ready||working||requester?.phase!=='connected'||!requester?.remoteArmed;
  $('live-arm').disabled=!ready||working||operator?.phase!=='connected';
  $('live-cancel').disabled=!running&&!working&&!result;
  $('live-verify').disabled=!ready||running||working;
  for(const id of ['live-save-request','live-save-proof','live-save-receipt'])$(id).disabled=!result||working;
  $('live-accept').disabled=working||!result||result.role!=='requester'||!result.report.fresh_action_eligible||result.report.demo||result.accepted;
  for(const id of ['live-requester-name','live-task','live-profile','live-require-attestation','live-require-position','live-context-input','live-context-file',
    'live-operator-context','live-operator-context-file','live-operator-pin','live-requester-pin'])$(id).disabled=running||working;
  for(const id of [...LOCATION_VERIFIER_FIELDS,'live-proof-file','live-verify-context-file'])$(id).disabled=running||working;
  for(const id of busy)$(id).disabled=true;
}
function action(id,run){$(id).addEventListener('click',async()=>{if($(id).disabled)return;busy.add(id);$(id).setAttribute('aria-busy','true');update();try{await run();}catch(error){notice(String(error.message||error),true);}finally{busy.delete(id);$(id).removeAttribute('aria-busy');update();}});}
const labels={pairing:'Pairing directly…',connecting:'Connecting directly…',connected:'Connected. The operator must allow collection.',armed:'Ready for a fresh signed request.',
  preparing:'Creating and reserving a fresh shared request…',authenticating:'Checking the signed requester wrapper…',
  'awaiting-proof':'Requester timer running. Waiting for the complete signed proof.',collecting:'Collecting location measurements…',
  'awaiting-receipt':'Proof sent. Waiting for the signed requester receipt.',verifying:'Complete proof received. Verifying and signing the receipt…',
  complete:'Signed location proof and requester receipt are ready.',failed:'The live session stopped.'};
function state(value){status((labels[value.phase]||value.phase)+(value.detail?' '+value.detail:''));update();}
function failure(error){notice(String(error.message||error),true);update();}
function complete(value){
  if(result?.sessionId===value.sessionId&&result.role==='requester'&&value.role==='operator')return;
  render({...value, request:value.bundle.original_request, receipt:value.bundle.receipt, proof:value.bytes,
    requesterPin:value.bundle.requester_pin, operatorPin:value.bundle.operator_pin});
  notice(value.report.demo?'Local demo complete. Its signed demo marker prevents fresh acceptance.':'The exact location proof and shared requester receipt were verified.');update();
}
function create(role,hints,options={}){
  return new LiveLocationSession({role,engine,requesterPin:options.requesterPin||requesterKey.pin.sha256,
    operatorPin:options.operatorPin||operatorKey.fingerprint,hints,identity:operatorIdentity,
    getOperatorPin:async()=>(await getLocationIdentity({engine,identity:operatorIdentity})).fingerprint,
    onState:state,onComplete:complete,onFailure:failure,...options});
}
function cleanup(){
  acceptanceRevision++;
  for(const session of [requester,operator])session?.cancel('Session cancelled. Use a new request to retry.');
  requester=null;operator=null;
}
function render(value){
  acceptanceRevision++;result=value;const report=value.report;
  $('live-verdict').textContent=report.verified?(report.demo?'Local demo receipt verified.':'Signed requester receipt verified.'):'The receipt did not pass.';
  $('live-summary').textContent=report.verified?'The exact location proof matches the original request and both known keys. The requester reports delivery in '+(report.receipt.timing.elapsed_ms/1000).toFixed(2)+' seconds. '+
    (report.fresh_action_eligible?'Local replay checking is still required before acceptance.':'This result does not authorize fresh acceptance.'):report.errors.join('; ');
  $('live-report-json').textContent=JSON.stringify(report,null,2);
  $('live-original-input').value=value.request;$('live-receipt-input').value=value.bundle?json(value.bundle):value.receipt;
  $('live-verify-requester').value=value.requesterPin;$('live-verify-operator').value=value.operatorPin;
  $('live-verify-format').value=value.historical?'legacy':'shared';
  if(value.role!=='verifier')$('live-verify-context').value=value.bundle.context_json;
  update();
}
async function save(name,value,mime='application/json'){
  const bytes=value instanceof Uint8Array?value:new TextEncoder().encode(typeof value==='string'?value:json(value));
  if(window.NativeVault){if(!window.NativeVault.saveArtifact(name,mime,bytesToBase64(bytes,MAX_LOCATION_CONTEXT*2+65536)))throw new Error('Android could not export the artifact.');}
  else{const url=URL.createObjectURL(new Blob([bytes],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
}
async function agreedHints(demo=false){
  const contextJson=demo?LOCATION_CONTEXT:locationContext($('live-context-input').value);
  const preset=demo?{profile:'browser-or-native',hardware_attestation_required:false,independent_position_required:false}
    :newRequestPreset('location',{profile:$('live-profile').value,hardware_attestation_required:!!$('live-require-attestation').checked,
      independent_position_required:!!$('live-require-position').checked});
  const hints=locationSessionHints({requester:demo?'Local live demo':$('live-requester-name').value.trim(),
    task:demo?'DEMO ONLY: same-device requester receipt and location collection.':$('live-task').value.trim(),
    ...preset,demo,
    context_sha256:await locationContextHash(contextJson)});
  return {hints,contextJson};
}
installRequestPresetSummary(document,'location','live-request-preset-summary',['live-profile','live-require-attestation','live-require-position'],
  ()=>({profile:$('live-profile').value,hardware_attestation_required:!!$('live-require-attestation').checked,independent_position_required:!!$('live-require-position').checked}));
action('live-create-offer',async()=>{
  cleanup();result=null;const revision=acceptanceRevision,{hints,contextJson}=await agreedHints();
  if(revision!==acceptanceRevision||document.hidden)throw new Error('Location pairing was cancelled.');
  requester=create('requester',hints,{operatorPin:pin('live-operator-pin'),contextJson});const held=requester,offer=await held.offer();
  if(requester!==held)throw new Error('Location pairing was cancelled.');
  $('live-offer-output').value=json(offer);status('Send the offer and your requester key ID independently. No sensor challenge has been disclosed.');
});
action('live-join',async()=>{
  cleanup();result=null;const offer=readLiveOffer($('live-offer-input').value),expected=pin('live-requester-pin');
  if(offer.requester_pin!==expected||offer.operator_pin!==operatorKey.fingerprint)throw new Error('The offer does not match the independently known requester and this operator key.');
  requireLocationProfileReadiness(offer.hints.profile);
  operator=create('operator',offer.hints,{requesterPin:expected,pairingId:offer.pairing_id,contextJson:locationContext($('live-operator-context').value)});
  const held=operator,answer=await held.join(offer);if(operator!==held)throw new Error('Location pairing was cancelled.');
  $('live-allowed-task').textContent=offer.hints.task;
  $('live-allowed-policy').textContent=(offer.hints.demo?'DEMO ONLY · ':'')+offer.hints.profile+' · '+((offer.hints.duration_ms ?? 10000)/1000)+' seconds of observations · complete proof within 90 seconds · fresh acceptance within 60 seconds of arrival.'+
    (offer.hints.profile!=='browser-or-native'?' Native Android acquisition required.':' Browser or Android collection allowed.')+
    (offer.hints.profile==='raw-gnss'?' Raw satellite observations required.':'')+
    (offer.hints.hardware_attestation_required?' Hardware signing-key attestation required.':'')+
    (offer.hints.independent_position_required?' Independent position recomputation required.':'');
  $('live-policy-details').textContent=JSON.stringify({policy:locationEvidencePolicy(offer.hints),context_sha256:offer.hints.context_sha256},null,2);
  $('live-answer-output').value=json(answer);status('Return this answer. Once connected, allow the requester to start.');
});
action('live-connect',async()=>{const text=$('live-answer-input').value;if(text.length>120000)throw new Error('Pairing answer is too large.');await requester.answer(JSON.parse(text));});
action('live-arm',async()=>{requireLocationProfileReadiness(operator.hints.profile);return operator.arm();});
action('live-start',async()=>{const held=requester;try{await held.start();}catch(error){held.fail(error);throw error;}});
action('live-demo',async()=>{
  cleanup();result=null;const revision=acceptanceRevision,{hints,contextJson}=await agreedHints(true);
  if(revision!==acceptanceRevision||document.hidden)throw new Error('Local demo cancelled.');
  requester=create('requester',hints,{contextJson});const held=requester,offer=await held.offer();
  if(requester!==held)throw new Error('Local demo cancelled.');
  operator=create('operator',hints,{contextJson,pairingId:offer.pairing_id});const op=operator;
  await held.answer(await op.join(offer));
  const started=performance.now();
  while(!held.connected||!op.connected){held.active();op.active();if(performance.now()-started>20000)throw new Error('Local demo pairing timed out.');await new Promise(resolve=>setTimeout(resolve,50));}
  await op.arm();
  while(!held.remoteArmed){held.active();if(performance.now()-started>21000)throw new Error('Local demo readiness timed out.');await new Promise(resolve=>setTimeout(resolve,20));}
  try{await held.start();}catch(error){held.fail(error);throw error;}
});
action('live-cancel',async()=>{cleanup();result=null;status('Session cancelled. Its reserved request cannot be reused here.');});
action('live-save-request',()=>save('nonverba-live-original-request.json',result.request));
action('live-save-proof',()=>save('nonverba-live-location-proof.json',locationProofEnvelope(result.proof)));
action('live-save-receipt',()=>save(result.historical?'nonverba-live-receipt.json':'nonverba-location-session-evidence.json',result.bundle||result.receipt));
action('live-accept',async()=>{
  const held=result,owner=requester,revision=acceptanceRevision;
  if(!held||held.role!=='requester'||!owner||held.sessionId!==owner.result().sessionId)throw new Error('Only this requester can accept its retained live session.');
  const isCurrent=()=>result===held&&requester===owner&&revision===acceptanceRevision&&!document.hidden;
  await owner.accept(isCurrent);if(!isCurrent())throw new Error('Live-location acceptance was cancelled.');
  held.accepted=true;notice('Accepted once in this requester installation. This is a local ledger entry.');
});
action('live-verify',async()=>{
  acceptanceRevision++;const revision=acceptanceRevision,inputs=retainLocationVerificationInputs(document),file=inputs.proof;
  if(!file||file.size>MAX_LOCATION_PROOF*2)throw new Error('Choose the exact bounded location proof.');
  const request=$('live-original-input').value,receiptInput=$('live-receipt-input').value,rpin=pin('live-verify-requester'),opin=pin('live-verify-operator');
  const contextJson=locationContext($('live-verify-context').value),historical=$('live-verify-format').value==='legacy';
  if(request.length>16000||new TextEncoder().encode(receiptInput).length>MAX_LOCATION_CONTEXT*2+65536)throw new Error('Receipt or original request exceeds its limit.');
  const proof=file.name.endsWith('.cose')?new Uint8Array(await file.arrayBuffer()):readLocationProofEnvelope(await file.text());
  let report,bundle,receipt=receiptInput;
  if(historical)report=await verifyHistoricalLocationReceipt(engine,receipt,request,proof,rpin,opin);
  else{
    const parsed=JSON.parse(receiptInput);
    bundle=parsed.type==='nonverba-location-session-evidence'?parsed:{version:1,type:'nonverba-location-session-evidence',
      requester_pin:rpin,operator_pin:opin,original_request:request,receipt,context_json:contextJson};
    if(bundle.original_request!==request)throw new Error('The bundle must match the independently retained original request exactly.');
    report=await verifyLocationSessionBundle(engine,bundle,proof,rpin,opin,contextJson);receipt=bundle.receipt;
  }
  if(revision!==acceptanceRevision||document.hidden||!inputs.current())throw new Error('Receipt verification inputs changed or verification was cancelled.');
  render({role:'verifier',request,receipt,proof,report,requesterPin:rpin,operatorPin:opin,bundle,historical});
});
function invalidateVerification(){
  acceptanceRevision++;result=null;$('live-verdict').textContent='Verification inputs changed.';
  $('live-summary').textContent='Verify the selected original request, proof, receipt and independent context again.';
  $('live-report-json').textContent='';update();
}
for(const id of [...LOCATION_VERIFIER_FIELDS,'live-proof-file']){
  $(id).addEventListener('input',invalidateVerification);$(id).addEventListener('change',invalidateVerification);
}
for(const [fileId,textId] of [['live-context-file','live-context-input'],['live-operator-context-file','live-operator-context'],['live-verify-context-file','live-verify-context']]){
  const importer=createLocationContextImporter();
  $(fileId).addEventListener('change',async()=>{
    if(textId==='live-verify-context')invalidateVerification();else acceptanceRevision++;
    const revision=acceptanceRevision,file=$(fileId).files?.[0],previous=$(textId).value;
    const job=importer.start(file,()=>revision===acceptanceRevision&&$(fileId).files?.[0]===file&&$(textId).value===previous
      &&!active(requester)&&!active(operator)&&!document.hidden);
    busy.add(fileId);update();
    try{$(textId).value=await job.result;}
    catch(error){if(job.isLatest())notice(String(error.message||error),true);}
    finally{if(job.isLatest()){$(fileId).value='';busy.delete(fileId);update();}}
  });
}
function suspend(){cleanup();result=null;update();}
for(const event of ['pagehide','nonverba:pause'])window.addEventListener(event,suspend);
document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();});
(async()=>{
  try{
    await engine.ready;const requesterIdentity=await loadRequesterIdentity(engine);requesterKey=await engine.json('live_requester_identity',requesterIdentity);
    if(!locationPlatform().native){
      const provision=async()=>{let identity=await loadIdentity();if(!identity){identity=await engine.call('create_identity');await saveIdentity(identity);}return identity;};
      operatorIdentity=navigator.locks?await navigator.locks.request('nonverba-signing-identity',provision):await provision();
    }
    operatorKey=await getLocationIdentity({engine,identity:operatorIdentity});
    $('live-requester-key').textContent=requesterKey.pin.sha256;$('live-operator-key').textContent=operatorKey.fingerprint;
    ready=true;$('live-runtime').textContent='LOCAL RUST ENGINE READY';status('Ready for a local demo or shared requester/operator location session.');update();
  }catch(error){notice(String(error.message||error),true);}
})();
