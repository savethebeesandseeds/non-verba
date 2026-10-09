// SPDX-License-Identifier: AGPL-3.0-only
// Browser integration using real WebRTC, AudioWorklet, Rust/WASM and C2PA.
// The ONLY acoustic path here is an explicitly synthetic Web Audio loopback.
// A null audio output sink isolates rendering from the host's physical drivers.
// This tests software integration, not microphones, speakers, ultrasonic device
// support, trusted sensor origin, or physical freshness. No crypto is mocked.
// NONVERBA_PLAYWRIGHT_PATH may point to an installed Playwright package.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.NONVERBA_PLAYWRIGHT_PATH||'playwright');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(process.env.NONVERBA_AUDIO_QA_DIR||resolve(root,'artifacts/qa'));
const base=process.env.NONVERBA_TEST_URL||'http://127.0.0.1:4174';
// Useful when diagnosing a browser/driver failure in the independent live path.
// This skips baseline checks; it never relaxes the recorder or verifier.
const demoOnly=process.env.NONVERBA_AUDIO_DEMO_ONLY==='1';
const checkFilter=process.env.NONVERBA_AUDIO_CHECK_FILTER?new RegExp(process.env.NONVERBA_AUDIO_CHECK_FILTER):null;
const resultsPath=resolve(out,demoOnly?'audio-demo-browser-results.json':'audio-browser-results.json');
await mkdir(out,{recursive:true});
const args=['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding'];
let browser;
if(process.env.NONVERBA_BROWSER_EXECUTABLE)browser=await chromium.launch({headless:true,args,executablePath:process.env.NONVERBA_BROWSER_EXECUTABLE});
else{
  let failure;
  for(const channel of ['msedge','chrome',undefined]){
    try{browser=await chromium.launch({headless:true,args,...(channel?{channel}:{})});break;}catch(error){failure=error;}
  }
  if(!browser)throw failure;
}
const contexts=[];
async function device(){
  const context=await browser.newContext({acceptDownloads:true,permissions:['microphone'],viewport:{width:1440,height:1000}});
  contexts.push(context);
  await context.addInitScript(()=>{
    const qa={contexts:[],tracks:[],loopback:true,denyMicrophone:false,holdPermission:false,permissionHeld:0,settingsOverrides:{},played:0,calls:{},timings:[],workletEvents:[],destinations:new WeakMap(),closures:new WeakMap()};
    window.__audioQa=qa;
    const OriginalContext=window.AudioContext;
    window.AudioContext=class extends OriginalContext{
      // A null sink avoids depending on the host's physical Windows output
      // device and prevents the synthetic >20 kHz fixture from being audible.
      constructor(options){super({...options,sinkId:{type:'none'}});qa.contexts.push(this);}
      close(){
        // Observe production teardown; the harness must never close a live
        // context itself or conceal a missing production cleanup call.
        const pending=super.close(),closure={settled:false,error:null};qa.closures.set(this,closure);
        pending.then(()=>{closure.settled=true;},error=>{closure.settled=true;closure.error=String(error);});
        return pending;
      }
    };
    const microphone=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async constraints=>{
      if(!constraints.audio)return microphone(constraints);
      if(qa.denyMicrophone)throw new DOMException('Synthetic permission denial','NotAllowedError');
      if(qa.holdPermission){qa.permissionHeld++;return new Promise(resolve=>{qa.releasePermission=resolve;});}
      const context=qa.contexts.at(-1);if(!context)throw new Error('Expected the production AudioContext before microphone acquisition');
      const destination=context.createMediaStreamDestination();destination.channelCount=1;destination.channelCountMode='explicit';
      qa.destinations.set(context,destination);
      // Continuous low-level external fixture audio keeps the virtual microphone
      // active and remains in the final PCM alongside the nonce-derived cues.
      const ambient=context.createOscillator(),gain=context.createGain();ambient.frequency.value=220;gain.gain.value=0.006;
      ambient.connect(gain);gain.connect(destination);ambient.start();
      for(const track of destination.stream.getAudioTracks()){
        const original=track.getSettings.bind(track);
        track.getSettings=()=>({...original(),sampleRate:48000,channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false,...qa.settingsOverrides});
        qa.tracks.push(track);
      }
      // Unlike a physical getUserMedia promise, our newly created virtual source
      // has not waited for hardware input to begin. Give it real render quanta.
      await new Promise(resolve=>setTimeout(resolve,100));
      return destination.stream;
    };
    const connect=AudioBufferSourceNode.prototype.connect;
    AudioBufferSourceNode.prototype.connect=function(destination,...args){
      if(destination===this.context.destination){
        qa.played++;
        const microphone=qa.destinations.get(this.context);
        if(qa.loopback&&microphone)connect.call(this,microphone);
      }
      return connect.call(this,destination,...args);
    };
    // Observe timing/method names only. Never retain worker argument payloads:
    // seal_audio arguments contain the temporary signing identity's private key.
    const OriginalWorker=window.Worker;
    window.Worker=class extends OriginalWorker{
      constructor(...args){super(...args);this.qaPending=new Map();this.addEventListener('message',event=>{const {data}=event,pending=this.qaPending.get(data.id);if(pending){this.qaPending.delete(data.id);qa.timings.push({method:pending.method,milliseconds:performance.now()-pending.start,error:!!data.error});if(pending.method==='seal_audio'&&qa.holdSealResponse&&!data.error){event.stopImmediatePropagation();qa.sealHeld=true;qa.releaseSeal=()=>{qa.sealHeld=false;qa.holdSealResponse=false;delete qa.releaseSeal;this.dispatchEvent(new MessageEvent('message',{data}));};}}});}
      postMessage(message,...args){qa.calls[message.method]=(qa.calls[message.method]||0)+1;this.qaPending.set(message.id,{method:message.method,start:performance.now()});return super.postMessage(message,...args);}
    };
    const OriginalWorkletNode=window.AudioWorkletNode;
    window.AudioWorkletNode=class extends OriginalWorkletNode{
      constructor(...args){super(...args);this.port.addEventListener('message',({data})=>qa.workletEvents.push({type:data.type,frame:data.frame,expected_frame:data.expected_frame,input_samples:data.input_samples,channels:data.channels,index:data.index,message:data.message,samples:data.samples?.length??data.samples}));}
    };
  });
  const page=await context.newPage();page.setDefaultTimeout(60_000);
  return page;
}
const requester=await device(),operator=await device();
const errors=[];
for(const [role,page]of [['requester',requester],['operator',operator]])page.on('pageerror',error=>errors.push(`${role}: ${error.message}`));
const results=[];
let pin,requesterPin,signed,receipt,request,sessionBundle,acceptedSessionId,acceptedRows;
async function check(name,fn){if(checkFilter&&!checkFilter.test(name))return;const start=Date.now();await fn();results.push({name,status:'passed',milliseconds:Date.now()-start});console.log(`PASS ${name}`);}
const el=(page,id)=>page.locator(`#${id}`);
async function action(page,id){await el(page,id).click();await page.waitForFunction(id=>!document.getElementById(id).hasAttribute('aria-busy'),id);}
async function view(page,name){await page.locator(`[data-audio-view="${name}"]`).click();}
async function download(page,id,name,expectedName){const ready=page.waitForEvent('download');await action(page,id);const file=await ready;if(expectedName)assert.match(file.suggestedFilename(),expectedName);const target=resolve(out,name);await file.saveAs(target);return target;}
async function assertStopped(page){
  await page.waitForFunction(()=>{
    const qa=window.__audioQa;
    return qa.tracks.every(track=>track.readyState==='ended')&&qa.contexts.every(context=>{
      const closure=qa.closures.get(context);return closure?.settled&&(context.state==='closed'||closure.error);
    });
  },undefined,{timeout:5000});
  const states=await page.evaluate(()=>window.__audioQa.contexts.map(context=>({state:context.state,...window.__audioQa.closures.get(context)})));
  assert.ok(states.every(context=>context.state==='closed'&&context.settled&&context.error===null),`Synthetic audio teardown failed: ${JSON.stringify(states)}`);
}
async function heldSignature(page){
  await page.waitForFunction(()=>window.__audioQa.sealHeld||document.getElementById('audio-status').textContent.includes('Session stopped'),undefined,{timeout:30_000});
  assert.equal(await page.evaluate(()=>window.__audioQa.sealHeld===true),true,`Capture stopped before the held signature: ${await el(page,'audio-notice').textContent()}`);
}
async function liveReceiptIds(page){
  return page.evaluate(async()=>{
    const keys=async(name,store)=>{
      const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(name);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      try{return await new Promise((resolve,reject)=>{const request=db.transaction(store).objectStore(store).getAllKeys();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}
    };
    return {audio:await keys('nonverba-audio-receipts-v1','receipts'),camera:await keys('nonverba-camera-v1','requests')};
  });
}
async function pair(task,{invalidAnswer=false,wrongRequester=false,assurance='browser-or-android',expectReady=true}={}){
  await view(requester,'requester');await view(operator,'operator');
  // A prior failed/done flow must release its real rendering resources before
  // another fresh AudioContext is created. Track.stop alone is insufficient.
  await Promise.all([assertStopped(requester),assertStopped(operator)]);
  const details=el(requester,'audio-assurance').locator('xpath=ancestor::details[1]');
  if(!await details.evaluate(element=>element.open))await details.locator(':scope > summary').click();
  await el(requester,'audio-requester-name').fill('Synthetic audio QA');await el(requester,'audio-task').fill(task);await el(requester,'audio-duration').selectOption('4');await el(requester,'audio-operator-pin').fill(pin);
  await el(requester,'audio-assurance').selectOption(assurance);
  const requestsBefore=await requester.evaluate(()=>window.__audioQa.calls.create_audio_request||0);
  await action(requester,'audio-create');const offer=await el(requester,'audio-offer').inputValue();assert.ok(offer,await el(requester,'audio-notice').textContent());
  const pairing=JSON.parse(offer);assert.equal(pairing.version,2);assert.equal(pairing.hints.duration_secs,4);assert.equal(pairing.request,undefined);assert.equal(pairing.challenge,undefined);
  assert.equal(await requester.evaluate(()=>window.__audioQa.calls.create_audio_request||0),requestsBefore,'Pairing must not disclose the sensor challenge');
  requesterPin=(await el(requester,'audio-requester-id').textContent()).trim();assert.equal(pairing.requester_pin,requesterPin);assert.match(requesterPin,/^[0-9a-f]{64}$/);
  await el(operator,'audio-offer-input').fill(offer);
  if(wrongRequester){const tracks=await operator.evaluate(()=>window.__audioQa.tracks.length);await el(operator,'audio-requester-pin').fill('0'.repeat(64));await action(operator,'audio-join');assert.match(await el(operator,'audio-notice').textContent(),/requester.*trusted channel/i);assert.equal(await operator.evaluate(()=>window.__audioQa.tracks.length),tracks);}
  await el(operator,'audio-requester-pin').fill(requesterPin);await action(operator,'audio-join');const answer=await el(operator,'audio-answer').inputValue();assert.ok(answer,await el(operator,'audio-notice').textContent());
  if(invalidAnswer){const wrong={...JSON.parse(answer),pairing_id:'0'.repeat(64)};await el(requester,'audio-answer-input').fill(JSON.stringify(wrong));await action(requester,'audio-connect');assert.match(await el(requester,'audio-notice').textContent(),/different pairing/i);}
  await el(requester,'audio-answer-input').fill(answer);await action(requester,'audio-connect');
  if(expectReady)await pageReady(operator,'audio-arm');
}
async function pageReady(page,id){await page.waitForFunction(id=>!document.getElementById(id).disabled||document.getElementById('audio-status').textContent.includes('Session stopped'),id);assert.equal(await el(page,id).isDisabled(),false,await el(page,'audio-notice').textContent());}
async function verify(file,original,expectedPin){
  await view(requester,'verify');await el(requester,'audio-verify-file').setInputFiles(file);await el(requester,'audio-original').fill(JSON.stringify(original));await el(requester,'audio-verify-pin').fill(expectedPin);await action(requester,'audio-verify-button');
  const text=await el(requester,'audio-report-json').textContent();assert.ok(text,await el(requester,'audio-notice').textContent());return JSON.parse(text);
}
function wavData(bytes){
  assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');
  for(let offset=12;offset+8<=bytes.length;){const size=bytes.readUInt32LE(offset+4),start=offset+8;if(bytes.toString('ascii',offset,offset+4)==='data')return {start,size};offset=start+size+(size&1);}
  throw new Error('WAV lacks a PCM data chunk');
}
try{
  await Promise.all([requester.goto(`${base}/audio.html`),operator.goto(`${base}/audio.html`)]);
  for(const page of [requester,operator]){
    await page.waitForFunction(()=>document.getElementById('audio-runtime').textContent==='LOCAL ENGINE READY');
    await page.waitForFunction(()=>/^[0-9a-f]{64}$/.test(document.getElementById('audio-device-id').textContent));
    assert.equal(await page.evaluate(()=>document.hidden),false,'Both synthetic devices must remain foreground/visible');
  }
  pin=(await el(operator,'audio-device-id').textContent()).trim();
  assert.notEqual(pin,(await el(requester,'audio-device-id').textContent()).trim(),'Contexts must have distinct local device keys');
  await requester.screenshot({path:resolve(out,'audio-requester-desktop.png'),fullPage:true});
  await requester.setViewportSize({width:390,height:844});await requester.screenshot({path:resolve(out,'audio-requester-mobile.png'),fullPage:true});
  assert.equal(await requester.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,'Requester layout overflow');await requester.setViewportSize({width:1440,height:1000});
  if(!demoOnly){
  await check('real WebRTC pairing withholds challenges and rejects unrelated requester and answer identities',async()=>{await pair('Synthetic loopback and 220 Hz fixture — not physical evidence',{invalidAnswer:true,wrongRequester:true});});
  await check('real AudioWorklet pilot captures and detects the synthetic speaker path',async()=>{
    await action(operator,'audio-arm');await pageReady(requester,'audio-start');assert.match(await el(operator,'audio-status').textContent(),/Speaker test passed/i);
    assert.equal(await operator.evaluate(()=>window.__audioQa.played),1);
    assert.equal(await operator.evaluate(()=>window.__audioQa.calls.detect_audio_probe),1);
  });
  await check('two fresh challenges record continuously and produce signed WAV plus requester receipt',async()=>{
    await operator.evaluate(()=>{window.__audioQa.holdSealResponse=true;});
    await action(requester,'audio-start');await heldSignature(operator);
    assert.equal(await el(operator,'audio-result').isVisible(),false);assert.equal(await el(requester,'audio-session-result').isVisible(),false);assert.equal(await el(requester,'audio-accept').isDisabled(),true);
    assert.match(await el(requester,'audio-status').textContent(),/waiting for the complete signed WAV/i);
    await operator.evaluate(()=>window.__audioQa.releaseSeal());await el(operator,'audio-result').waitFor({state:'visible',timeout:30_000});await el(requester,'audio-session-result').waitFor({state:'visible'});
    await pageReady(requester,'audio-save-transcript');signed=await download(operator,'audio-save-wav','audio-signed-synthetic.wav');const receiptPath=await download(requester,'audio-save-transcript','audio-requester-receipt.json');receipt=JSON.parse(await readFile(receiptPath,'utf8'));
    request=receipt.request;assert.equal(request.duration_secs,4);assert.equal(request.sample_rate,48000);
    assert.equal(receipt.transcript.total_samples,192000);assert.equal(receipt.transcript.rounds.length,2);assert.notEqual(receipt.transcript.rounds[0].nonce,receipt.transcript.rounds[1].nonce);
    assert.ok(receipt.transcript.rounds[1].issued_elapsed_ms>=receipt.transcript.rounds[0].received_elapsed_ms,'Successor must be issued after prior bytes arrived');
    const bytes=await readFile(signed);assert.equal(wavData(bytes).size,384000);assert.equal(await operator.evaluate(()=>window.__audioQa.played),3);await assertStopped(operator);
    await download(operator,'audio-save-device','audio-public-device-id.json');await operator.screenshot({path:resolve(out,'audio-signed-desktop.png'),fullPage:true});
  });
  await check('requester retains the exact signed WAV and verifies its final arrival before one-time acceptance',async()=>{
    const received=await download(requester,'audio-save-received-wav','audio-received-synthetic.wav');assert.deepEqual(await readFile(received),await readFile(signed));
    const bundlePath=await download(requester,'audio-save-session','audio-session-evidence.json');sessionBundle=JSON.parse(await readFile(bundlePath,'utf8'));
    assert.equal(sessionBundle.type,'nonverba-audio-session-evidence');assert.equal(sessionBundle.requester_pin,requesterPin);assert.equal(sessionBundle.operator_pin,pin);assert.deepEqual(sessionBundle.audio_receipt,receipt);
    const result=JSON.parse(await el(requester,'audio-session-report').textContent());assert.equal(result.verified,true,JSON.stringify(result));assert.equal(result.fresh_action_eligible,true);assert.equal(result.request.spec.policy.version,2);assert.equal(result.request.spec.policy.audio_recording_monitoring_required,false);
    assert.equal(await el(requester,'audio-accept').isDisabled(),false);await action(requester,'audio-accept');assert.match(await el(requester,'audio-session-verdict').textContent(),/Accepted once/);assert.equal(await el(requester,'audio-accept').isDisabled(),true);
    const accepted=await requester.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('nonverba-agent-evidence-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise((resolve,reject)=>{const r=db.transaction('accepted').objectStore('accepted').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}});
    acceptedSessionId=result.request.session_id;acceptedRows=accepted;
    assert.equal(accepted.length,2,'The transaction reserves both session and sensor challenge');assert.deepEqual(accepted[0],accepted[1]);await requester.screenshot({path:resolve(out,'audio-final-receipt-desktop.png'),fullPage:true});
  });
  await check('exported final audio evidence requires independently supplied pins and exact retained artifact context',async()=>{
    await view(requester,'verify');await el(requester,'audio-verify-requester-pin').fill(requesterPin);
    const result=await verify(signed,sessionBundle,pin);assert.equal(result.verified,true,JSON.stringify(result));assert.equal(result.checks.expected_operator_match,true);assert.equal(result.acceptance_recorded,false);
    const wrongOperator=await verify(signed,sessionBundle,'0'.repeat(64));assert.equal(wrongOperator.verified,false);assert.equal(wrongOperator.checks.expected_operator_match,false);
    await el(requester,'audio-verify-requester-pin').fill('0'.repeat(64));const wrongRequester=await verify(signed,sessionBundle,pin);assert.equal(wrongRequester.verified,false);await el(requester,'audio-verify-requester-pin').fill(requesterPin);
    const changed=structuredClone(sessionBundle);changed.audio_receipt.transcript.rounds[0].nonce='0'.repeat(64);assert.equal((await verify(signed,changed,pin)).verified,false);
    const altered=await readFile(signed);altered[wavData(altered).start+2000]^=1;const alteredPath=resolve(out,'audio-final-tampered.wav');await writeFile(alteredPath,altered);assert.equal((await verify(alteredPath,sessionBundle,pin)).verified,false);
  });
  await check('completed signed WAV can be downloaded again without changing its bytes',async()=>{
    assert.equal(await el(operator,'audio-save-wav').isDisabled(),false);const repeated=await download(operator,'audio-save-wav','audio-signed-repeat.wav');assert.deepEqual(await readFile(repeated),await readFile(signed));
  });
  await check('real WASM verifier confirms signature, live receipt, PCM binding and acoustic codes',async()=>{
    const result=await verify(signed,receipt,pin);assert.equal(result.verified,true,JSON.stringify(result));assert.ok(Object.values(result.checks).every(Boolean));assert.equal(result.detections.length,2);
    for(const field of ['hardware_attested','sensor_origin_proven','acoustic_path_proven','physical_freshness_proven','clock_trusted'])assert.equal(result[field],false);
    await download(requester,'audio-save-report','audio-verification.json');await requester.screenshot({path:resolve(out,'audio-verified-desktop.png'),fullPage:true});
    await requester.setViewportSize({width:390,height:844});await requester.screenshot({path:resolve(out,'audio-verified-mobile.png'),fullPage:true});assert.equal(await requester.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,'Verification layout overflow');await requester.setViewportSize({width:1440,height:1000});
  });
  await check('a changed PCM byte fails C2PA and requester sample binding',async()=>{
    const bytes=await readFile(signed),data=wavData(bytes);bytes[data.start+1000]^=1;const path=resolve(out,'audio-tampered-synthetic.wav');await writeFile(path,bytes);
    const result=await verify(path,receipt,pin);assert.equal(result.verified,false);assert.equal(result.checks.c2pa_integrity,false);assert.equal(result.checks.recording_binding,false);
  });
  await check('wrong operator pin and substituted nonce fail verification',async()=>{
    const wrongPin=await verify(signed,receipt,'0'.repeat(64));assert.equal(wrongPin.verified,false);assert.equal(wrongPin.checks.device_match,false);
    const changed=structuredClone(receipt);changed.transcript.rounds[0].nonce='0'.repeat(64);const wrongNonce=await verify(signed,changed,pin);assert.equal(wrongNonce.verified,false);assert.equal(wrongNonce.checks.transcript_match,false);assert.equal(wrongNonce.checks.signal_detected,false);
  });
  await check('retained audio acceptance survives requester reload and refuses replay without new capture',async()=>{
    assert.match(acceptedSessionId,/^[0-9a-f]{64}$/);assert.equal(acceptedRows.length,2);
    const originalBytes=await readFile(signed),originalHash=createHash('sha256').update(originalBytes).digest('hex');
    await requester.reload();await requester.waitForFunction(()=>document.getElementById('audio-runtime').textContent==='LOCAL ENGINE READY');
    const reopened=await requester.evaluate(async id=>{
      const {createCoreClient}=await import('./core-client.js'),{AgentRequester}=await import('./agent-requester.js');
      const {readEvidenceSession}=await import('./agent-evidence-storage.js');
      const engine=createCoreClient();await engine.ready;
      const client=new AgentRequester(engine),hex=bytes=>[...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
      try{
        const requesterPin=await client.identity(),inspection=await client.inspectRetained(id),stored=await readEvidenceSession(id);
        const wavHash=hex(await crypto.subtle.digest('SHA-256',stored.outcome.primary));
        let replayError=null,deliveryError=null,observedAcceptanceAdds=0;
        const nativeAcceptanceErrors=[],originalAdd=IDBObjectStore.prototype.add;
        const expectedAcceptanceKeys=new Set([`session:${id}`,`challenge:${stored.task.sensor_nonce}`]);
        // Observe genuine duplicate-key errors before they bubble. The storage
        // API may reject generically before transaction.error is populated.
        // Keep request values/default error handling entirely unchanged.
        try{
          IDBObjectStore.prototype.add=function(...args){
            const request=Reflect.apply(originalAdd,this,args);
            if(this.transaction.db.name==='nonverba-agent-evidence-v1'&&this.name==='accepted'&&expectedAcceptanceKeys.has(args[1])){
              const observed=observedAcceptanceAdds++;
              if(observed<2)request.addEventListener('error',()=>{
                if(nativeAcceptanceErrors.length<2)nativeAcceptanceErrors.push({key:typeof args[1]==='string'&&args[1].length<=80?args[1]:'[unsupported]',
                  name:request.error?.name??null,message:request.error?.message?.slice(0,256)??null});
              });
            }
            return request;
          };
          try{await client.accept(id);}catch(error){replayError={name:error.name,message:error.message};}
        }finally{IDBObjectStore.prototype.add=originalAdd;}
        // A new controller may inspect completed evidence but cannot revive the
        // old live transport or accept another artifact delivery after reload.
        try{await client.receive(id,{primary:stored.outcome.primary});}catch(error){deliveryError={name:error.name,message:error.message};}
        const after=await readEvidenceSession(id);
        const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('nonverba-agent-evidence-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
        let allAccepted;
        try{allAccepted=await new Promise((resolve,reject)=>{const request=db.transaction('accepted').objectStore('accepted').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}
        return {requesterPin,inspection,original_request:stored.task.original_request,context_json:stored.task.context_json,
          sensor_nonce:stored.task.sensor_nonce,task_state:stored.task.state,receipt:stored.outcome.receipt,transcript_json:stored.outcome.audio_transcript_json,
          wav_sha256:wavHash,wav_bytes:stored.outcome.primary.length,acceptance:stored.acceptance,challenge_acceptance:stored.challengeAcceptance,
          after_acceptance:after.acceptance,after_challenge_acceptance:after.challengeAcceptance,after_task_state:after.task.state,
          all_accepted_rows:allAccepted,
          after_wav_sha256:hex(await crypto.subtle.digest('SHA-256',after.outcome.primary)),replay_error:replayError,delivery_error:deliveryError,
          native_acceptance_errors:nativeAcceptanceErrors,observed_acceptance_adds:observedAcceptanceAdds,
          audio_contexts:window.__audioQa.contexts.length,microphone_tracks:window.__audioQa.tracks.length,playbacks:window.__audioQa.played,
          worker_calls:{...window.__audioQa.calls}};
      }finally{client.close();}
    },acceptedSessionId);
    // Preserve the actual reload verdict even if age or replay checks refuse.
    await writeFile(resolve(out,'audio-retained-reload-verification.json'),JSON.stringify(reopened,null,2));
    assert.equal(reopened.requesterPin,requesterPin);
    assert.equal(reopened.original_request,sessionBundle.original_request);assert.equal(reopened.receipt,sessionBundle.receipt);
    assert.equal(reopened.transcript_json,JSON.stringify(sessionBundle.audio_receipt.transcript));assert.equal(reopened.context_json,sessionBundle.context_json);
    assert.equal(reopened.sensor_nonce,receipt.request.session_id);assert.equal(reopened.task_state,'complete');assert.equal(reopened.after_task_state,'complete');
    assert.equal(reopened.wav_sha256,originalHash);assert.equal(reopened.after_wav_sha256,originalHash);assert.equal(reopened.wav_bytes,originalBytes.length);
    assert.equal(reopened.inspection.report.verified,true,JSON.stringify(reopened.inspection.report));
    assert.equal(reopened.inspection.report.fresh_action_eligible,true,'A stale receipt cannot demonstrate fresh duplicate-key rejection');
    assert.equal(reopened.inspection.report.request.session_id,acceptedSessionId);assert.equal(reopened.inspection.report.request.spec.evidence.type,'audio');
    assert.equal(reopened.inspection.report.request.requester_pin.sha256,requesterPin);
    assert.equal(reopened.inspection.report.request.spec.operator_pins.media_certificate_sha256,pin);
    // Keep the signed verifier verdict separate from the local acceptance ledger.
    assert.equal(reopened.inspection.report.acceptance_recorded,false);assert.equal(reopened.inspection.report.global_replay_checked,false);
    assert.deepEqual(reopened.inspection.acceptance,acceptedRows[0]);assert.deepEqual(reopened.acceptance,acceptedRows[0]);
    assert.deepEqual(reopened.challenge_acceptance,acceptedRows[1]);assert.deepEqual(reopened.after_acceptance,acceptedRows[0]);
    assert.deepEqual(reopened.after_challenge_acceptance,acceptedRows[1]);
    assert.deepEqual(reopened.all_accepted_rows,acceptedRows);
    assert(reopened.replay_error,'Repeated acceptance must refuse rather than replace the original rows');
    assert.equal(reopened.observed_acceptance_adds,2);
    const duplicateKeys=[`session:${acceptedSessionId}`,`challenge:${receipt.request.session_id}`];
    assert(reopened.native_acceptance_errors.some(error=>error.name==='ConstraintError'&&duplicateKeys.includes(error.key)),
      'Still-fresh replay must reach the actual IndexedDB unique-key guard');
    assert.match(reopened.delivery_error?.message||'',/Unexpected or repeated evidence delivery/);
    assert.equal(reopened.audio_contexts,0);assert.equal(reopened.microphone_tracks,0);assert.equal(reopened.playbacks,0);
    assert(reopened.worker_calls.verify_evidence_session_receipt>=2,'Inspection and attempted acceptance must re-run the actual Rust verifier');
    for(const method of ['create_audio_request','create_evidence_session_request','create_audio_round','audio_probe','seal_audio','seal_evidence_session_receipt'])assert.equal(reopened.worker_calls[method]||0,0,method);
  });
  await check('cancellation during recording closes microphone and produces no new WAV or receipt',async()=>{
    await pair('Synthetic cancellation test');await action(operator,'audio-arm');await pageReady(requester,'audio-start');const before=await operator.evaluate(()=>window.__audioQa.calls.seal_audio||0);
    await action(requester,'audio-start');await operator.waitForFunction(()=>document.getElementById('audio-status').textContent.includes('Recording continuously'));await action(operator,'audio-cancel');
    await requester.waitForFunction(()=>document.getElementById('audio-status').textContent.includes('Session stopped'));await assertStopped(operator);assert.equal(await el(operator,'audio-result').isVisible(),false);assert.equal(await el(requester,'audio-save-transcript').isDisabled(),true);assert.equal(await operator.evaluate(()=>window.__audioQa.calls.seal_audio||0),before);
  });
  await check('cancellation after retained PCM rejects a late sealed WAV and leaves acceptance unchanged',async()=>{
    await pair('Synthetic cancellation while the final signature response is held');
    const acceptedRows=()=>requester.evaluate(async()=>{
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('nonverba-agent-evidence-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      try{return await new Promise((resolve,reject)=>{const r=db.transaction('accepted').objectStore('accepted').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}
    });
    const acceptedBefore=await acceptedRows();
    await action(operator,'audio-arm');await pageReady(requester,'audio-start');
    await operator.evaluate(()=>{window.__audioQa.holdSealResponse=true;});
    await action(requester,'audio-start');await heldSignature(operator);
    assert.match(await el(requester,'audio-status').textContent(),/waiting for the complete signed WAV/i);
    assert.equal(await el(requester,'audio-save-transcript').isDisabled(),false,'The requester has retained the preceding PCM transcript');
    await action(operator,'audio-cancel');
    await requester.waitForFunction(()=>document.getElementById('audio-status').textContent.includes('Session stopped'));
    // Deliver the genuine completed Rust signature only after both UIs have
    // cancelled. A render turn lets the awaiting production handler resume.
    await operator.evaluate(async()=>{window.__audioQa.releaseSeal();await new Promise(resolve=>requestAnimationFrame(resolve));});
    for(const page of [requester,operator]){
      assert.equal(await el(page,'audio-result').isVisible(),false);
      assert.equal(await el(page,'audio-session-result').isVisible(),false);
      for(const id of ['audio-save-wav','audio-save-transcript','audio-save-session','audio-save-received-wav','audio-accept'])assert.equal(await el(page,id).isDisabled(),true,`${id} must stay disabled after cancellation`);
      assert.equal(await el(page,'audio-session-report').textContent(),'');
    }
    await assertStopped(operator);assert.deepEqual(await acceptedRows(),acceptedBefore,'A late signature must not add an accepted session or sensor challenge');
  });
  await check('microphone processing changes during capture abort without signing',async()=>{
    await pair('Synthetic mid-capture processing settings change');await action(operator,'audio-arm');await pageReady(requester,'audio-start');const before=await operator.evaluate(()=>window.__audioQa.calls.seal_audio||0);
    await action(requester,'audio-start');await operator.waitForFunction(()=>document.getElementById('audio-status').textContent.includes('Recording continuously'));
    await operator.evaluate(()=>{window.__audioQa.settingsOverrides={echoCancellation:true};});await operator.waitForFunction(()=>document.getElementById('audio-status').textContent.includes('Session stopped'));
    assert.equal(await el(operator,'audio-result').isVisible(),false);assert.equal(await operator.evaluate(()=>window.__audioQa.calls.seal_audio||0),before);await assertStopped(operator);await operator.evaluate(()=>{window.__audioQa.settingsOverrides={};});
  });
  await check('a missing synthetic acoustic path fails calibration before signing',async()=>{
    await pair('Synthetic disconnected speaker test');await operator.evaluate(()=>{window.__audioQa.loopback=false;});const before=await operator.evaluate(()=>window.__audioQa.calls.seal_audio||0);await action(operator,'audio-arm');
    assert.match(await el(operator,'audio-notice').textContent(),/not recovered|not support/i);assert.equal(await el(operator,'audio-result').isVisible(),false);assert.equal(await operator.evaluate(()=>window.__audioQa.calls.seal_audio||0),before);await assertStopped(operator);await operator.evaluate(()=>{window.__audioQa.loopback=true;});
  });
  await check('microphone permission failure produces no signed evidence',async()=>{
    await pair('Synthetic microphone denial test');await operator.evaluate(()=>{window.__audioQa.denyMicrophone=true;});const before=await operator.evaluate(()=>window.__audioQa.calls.seal_audio||0);await action(operator,'audio-arm');
    assert.match(await el(operator,'audio-notice').textContent(),/denial|denied|permission/i);assert.equal(await el(operator,'audio-result').isVisible(),false);assert.equal(await operator.evaluate(()=>window.__audioQa.calls.seal_audio||0),before);await assertStopped(operator);
  });
  await check('a required monitored Android policy fails before browser microphone acquisition',async()=>{
    const tracks=await operator.evaluate(()=>window.__audioQa.tracks.length);await pair('Require native monitored microphone',{assurance:'android-monitored',expectReady:false});
    await operator.waitForFunction(()=>document.getElementById('audio-status').textContent.includes('Session stopped'));assert.match(await el(operator,'audio-notice').textContent(),/requires Android monitored recording/i);assert.equal(await operator.evaluate(()=>window.__audioQa.tracks.length),tracks);assert.equal(await el(operator,'audio-arm').isDisabled(),true);assert.equal(await el(requester,'audio-accept').isDisabled(),true);
  });
  }
  let demoSigned,demoReceipt,demoAutoReport,liveBeforeDemo=await liveReceiptIds(operator);
  await operator.evaluate(()=>{window.__audioQa.denyMicrophone=false;});
  await check('local demo needs no operator ID or pairing and exports signed demo evidence',async()=>{
    await view(operator,'requester');await el(operator,'audio-operator-pin').fill('');
    await view(operator,'verify');await el(operator,'audio-verify-pin').fill('');
    const identities=await operator.evaluate(()=>window.__audioQa.calls.create_identity||0);
    liveBeforeDemo=await liveReceiptIds(operator);
    await action(operator,'audio-demo');assert.equal(await el(operator,'audio-operator').isVisible(),true);assert.match(await el(operator,'audio-arm').textContent(),/start demo/i);
    await action(operator,'audio-arm');await el(operator,'audio-result').waitFor({state:'visible',timeout:30_000});
    assert.match(await el(operator,'audio-result-title').textContent(),/demo/i);
    assert.match(await el(operator,'audio-result-description').textContent(),/same device|demo evidence/i);
    demoAutoReport=JSON.parse(await el(operator,'audio-report-json').textContent());
    assert.equal(demoAutoReport.verified,true,JSON.stringify(demoAutoReport));assert.equal(demoAutoReport.demo,true);assert.equal(demoAutoReport.independent_requester_proven,false);
    assert.equal(demoAutoReport.device_fingerprint,pin);assert.equal(demoAutoReport.capture.request.demo,true);
    assert.match(demoAutoReport.capture.request.task,/DEMO ONLY.*No independent requester/);
    assert.equal(await el(operator,'audio-operator-pin').inputValue(),'');assert.equal(await el(operator,'audio-verify-pin').inputValue(),'');
    assert.equal(await operator.evaluate(()=>window.__audioQa.calls.create_identity||0),identities,'Demo must reuse this installation identity');
    demoSigned=await download(operator,'audio-save-wav','audio-demo-signed-synthetic.wav',/^nonverba-demo-audio-.*\.wav$/);
    const receiptPath=await download(operator,'audio-save-demo-receipt','audio-demo-receipt.json',/^nonverba-demo-receipt-.*\.json$/);demoReceipt=JSON.parse(await readFile(receiptPath,'utf8'));
    assert.equal(demoReceipt.type,'nonverba-audio-demo-receipt');assert.equal(demoReceipt.request.demo,true);assert.equal(demoReceipt.transcript.total_samples,192000);
    assert.equal(wavData(await readFile(demoSigned)).size,384000);assert.notEqual(demoReceipt.transcript.rounds[0].nonce,demoReceipt.transcript.rounds[1].nonce);
    assert.ok(demoReceipt.transcript.rounds[1].issued_elapsed_ms>=demoReceipt.transcript.rounds[0].received_elapsed_ms);
    const repeated=await download(operator,'audio-save-wav','audio-demo-signed-repeat-download.wav',/^nonverba-demo-audio-/);assert.deepEqual(await readFile(repeated),await readFile(demoSigned));
    // The demo intentionally hides operator-ID controls. Retain only the public
    // fingerprint already exposed by verification, never the signing identity.
    await writeFile(resolve(out,'audio-demo-public-device-id.json'),JSON.stringify({fingerprint:demoAutoReport.device_fingerprint},null,2));await writeFile(resolve(out,'audio-demo-verification.json'),JSON.stringify(demoAutoReport,null,2));
    assert.deepEqual(await liveReceiptIds(operator),liveBeforeDemo,'Demo must not enter live or camera requester history');await assertStopped(operator);
    await operator.screenshot({path:resolve(out,'audio-demo-desktop.png'),fullPage:true});
    await operator.setViewportSize({width:390,height:844});await operator.screenshot({path:resolve(out,'audio-demo-mobile.png'),fullPage:true});assert.equal(await operator.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,'Demo layout overflow');await operator.setViewportSize({width:1440,height:1000});
  });
  await check('a repeated local demo ignores invalid ID fields and creates fresh challenges',async()=>{
    await view(operator,'requester');await el(operator,'audio-operator-pin').fill('not-an-operator-id');
    await view(operator,'verify');await el(operator,'audio-verify-pin').fill('not-a-verification-pin');
    await action(operator,'audio-demo');await action(operator,'audio-arm');await el(operator,'audio-result').waitFor({state:'visible',timeout:30_000});
    const result=JSON.parse(await el(operator,'audio-report-json').textContent());assert.equal(result.verified,true);assert.equal(result.demo,true);assert.equal(result.device_fingerprint,pin);
    assert.notEqual(result.capture.request.session_id,demoReceipt.request.session_id);assert.notEqual(result.capture.transcript.rounds[0].nonce,demoReceipt.transcript.rounds[0].nonce);
    assert.equal(await el(operator,'audio-operator-pin').inputValue(),'not-an-operator-id');assert.equal(await el(operator,'audio-verify-pin').inputValue(),'not-a-verification-pin');
    assert.deepEqual(await liveReceiptIds(operator),liveBeforeDemo);await assertStopped(operator);
  });
  await check('demo verification stays labelled and a rewrapped receipt cannot upgrade it',async()=>{
    // A filtered run may use a previously generated public synthetic artifact.
    // Never create or import a signing key merely to verify that recording.
    demoSigned??=resolve(out,'audio-demo-signed-synthetic.wav');
    demoReceipt??=JSON.parse(await readFile(resolve(out,'audio-demo-receipt.json'),'utf8'));
    const demoPin=demoAutoReport?.device_fingerprint??JSON.parse(await readFile(resolve(out,'audio-demo-public-device-id.json'),'utf8')).fingerprint;
    const result=await verify(demoSigned,demoReceipt,demoPin);assert.equal(result.verified,true);assert.equal(result.demo,true);assert.equal(result.independent_requester_proven,false);
    assert.match(await el(requester,'audio-verdict').textContent(),/local demo/i);assert.match(await el(requester,'audio-verification-note').textContent(),/no independent requester/i);
    const rewrapped=structuredClone(demoReceipt);rewrapped.type='nonverba-audio-receipt';
    await el(requester,'audio-original').fill(JSON.stringify(rewrapped));await action(requester,'audio-verify-button');
    assert.equal(await el(requester,'audio-report-json').textContent(),'');assert.match(await el(requester,'audio-notice').textContent(),/clearly labelled|original requester receipt/i);
    delete rewrapped.request.demo;
    const stripped=await verify(demoSigned,rewrapped,demoPin);assert.equal(stripped.verified,false);assert.equal(stripped.checks.request_match,false);assert.equal(stripped.demo,true,'Signed demo marker survives a stripped receipt');
    assert.match(await el(requester,'audio-verdict').textContent(),/local demo.*not pass/i);
  });
  await check('stopping or leaving demo calibration closes capture without a late WAV',async()=>{
    for(const stop of ['cancel','leave']){
      await action(operator,'audio-demo');const eventCount=await operator.evaluate(()=>window.__audioQa.workletEvents.length);
      await el(operator,'audio-arm').click();await operator.waitForFunction(count=>window.__audioQa.workletEvents.slice(count).some(event=>event.type==='started'),eventCount);
      const before=await operator.evaluate(()=>window.__audioQa.calls.seal_audio||0);
      if(stop==='cancel')await action(operator,'audio-cancel');else await view(operator,'verify');
      await operator.waitForFunction(()=>!document.getElementById('audio-arm').hasAttribute('aria-busy'));
      await operator.waitForFunction(()=>document.getElementById('audio-status').textContent.includes('Session stopped'));await assertStopped(operator);
      assert.equal(await el(operator,'audio-result').isVisible(),false);assert.equal(await el(operator,'audio-save-demo-receipt').isDisabled(),true);assert.equal(await operator.evaluate(()=>window.__audioQa.calls.seal_audio||0),before);
    }
    assert.deepEqual(await liveReceiptIds(operator),liveBeforeDemo);
  });
  await check('cancelling pending permission enables a fresh demo without releasing the old prompt',async()=>{
    await action(operator,'audio-demo');
    const before=await operator.evaluate(()=>window.__audioQa.calls.seal_audio||0);
    await operator.evaluate(()=>{window.__audioQa.holdPermission=true;});
    await el(operator,'audio-arm').click();
    await operator.waitForFunction(()=>window.__audioQa.permissionHeld===1);
    await action(operator,'audio-cancel');
    await operator.waitForFunction(()=>!document.getElementById('audio-arm').hasAttribute('aria-busy'));
    await assertStopped(operator);
    await operator.evaluate(()=>{window.__audioQa.holdPermission=false;});
    await action(operator,'audio-demo');
    assert.equal(await el(operator,'audio-arm').isDisabled(),false,'Old pending permission must not keep the new arm button busy');
    const eventCount=await operator.evaluate(()=>window.__audioQa.workletEvents.length);
    await el(operator,'audio-arm').click();
    await operator.waitForFunction(count=>window.__audioQa.workletEvents.slice(count).some(event=>event.type==='started'),eventCount);
    assert.equal(await operator.evaluate(()=>typeof window.__audioQa.releasePermission),'function','The old permission promise remains unresolved throughout fresh setup');
    await action(operator,'audio-cancel');
    await operator.waitForFunction(()=>!document.getElementById('audio-arm').hasAttribute('aria-busy'));
    await assertStopped(operator);
    assert.equal(await operator.evaluate(()=>window.__audioQa.calls.seal_audio||0),before);
    assert.equal(await el(operator,'audio-result').isVisible(),false);
    assert.equal(await el(operator,'audio-save-demo-receipt').isDisabled(),true);
    assert.deepEqual(await liveReceiptIds(operator),liveBeforeDemo);
    assert.deepEqual(errors,[]);
  });
  await check('demo microphone denial cannot create evidence',async()=>{
    await action(operator,'audio-demo');await operator.evaluate(()=>{window.__audioQa.denyMicrophone=true;});
    const before=await operator.evaluate(()=>window.__audioQa.calls.seal_audio||0);
    try{await action(operator,'audio-arm');assert.match(await el(operator,'audio-notice').textContent(),/denial|denied|permission/i);assert.equal(await el(operator,'audio-result').isVisible(),false);assert.equal(await operator.evaluate(()=>window.__audioQa.calls.seal_audio||0),before);await assertStopped(operator);}finally{await operator.evaluate(()=>{window.__audioQa.denyMicrophone=false;});}
  });
  await check('demo without an acoustic path fails calibration without synthetic fallback',async()=>{
    await action(operator,'audio-demo');await operator.evaluate(()=>{window.__audioQa.loopback=false;});
    const before=await operator.evaluate(()=>window.__audioQa.calls.seal_audio||0);
    try{await action(operator,'audio-arm');assert.match(await el(operator,'audio-notice').textContent(),/not recovered|not support/i);assert.equal(await el(operator,'audio-result').isVisible(),false);assert.equal(await operator.evaluate(()=>window.__audioQa.calls.seal_audio||0),before);await assertStopped(operator);}finally{await operator.evaluate(()=>{window.__audioQa.loopback=true;});}
    assert.deepEqual(await liveReceiptIds(operator),liveBeforeDemo);
  });
  await check('no uncaught browser errors',async()=>assert.deepEqual(errors,[]));
  const timings=await operator.evaluate(()=>window.__audioQa.timings);
  await writeFile(resultsPath,JSON.stringify({url:base,browser:browser.version(),demo_only:demoOnly,check_filter:checkFilter?.source??null,synthetic_acoustic_loopback:true,null_audio_output_sink:true,physical_device_tested:false,results,operator_worker_timings:timings},null,2));
  console.log(`All ${results.length} audio browser checks passed. Synthetic artifacts: ${out}`);
}catch(error){
  console.error(`FAIL ${error.stack||error}`);
  const states={};for(const [role,page]of [['requester',requester],['operator',operator]]){states[role]=await page.evaluate(()=>({status:document.getElementById('audio-status')?.textContent,notice:document.getElementById('audio-notice')?.textContent,hidden:document.hidden,calls:window.__audioQa?.calls,workletEvents:window.__audioQa?.workletEvents,audioContexts:window.__audioQa?.contexts.map(context=>({state:context.state,...window.__audioQa.closures.get(context)}))})).catch(()=>null);await page.screenshot({path:resolve(out,`audio-${role}-failure.png`),fullPage:true}).catch(()=>{});}
  console.error(JSON.stringify(states));await writeFile(resultsPath,JSON.stringify({url:base,browser:browser.version(),demo_only:demoOnly,check_filter:checkFilter?.source??null,synthetic_acoustic_loopback:true,physical_device_tested:false,results,error:String(error),errors,states},null,2));process.exitCode=1;
}finally{await Promise.all(contexts.map(context=>context.close()));await browser.close();}
