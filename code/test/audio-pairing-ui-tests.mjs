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
class Element extends EventTarget{value='';textContent='';disabled=false;hidden=false;files=[];children=[];attrs=new Map();classList={toggle(){}};pause(){}load(){}setAttribute(k,v){this.attrs.set(k,v);}removeAttribute(k){this.attrs.delete(k);}hasAttribute(k){return this.attrs.has(k);}replaceChildren(...children){this.children=children;}append(...children){this.children.push(...children);}remove(){}click(){this.dispatchEvent(new Event('click'));}}
const html=await readFile(new URL('../../web/src/audio.html',import.meta.url),'utf8'),elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
const document=globalThis.document=Object.assign(new EventTarget(),{hidden:false,getElementById:id=>{assert.ok(elements.has(id),id);return elements.get(id);},querySelectorAll:()=>[],createElement:()=>new Element()});
const window=globalThis.window=Object.assign(new EventTarget(),{crypto:globalThis.crypto,NativeVault:{}});globalThis.NativeVault=window.NativeVault;
globalThis.AudioContext=class{constructor(){assert.fail('No audio device may be opened in pairing tests.');}};
globalThis.Worker=class{constructor(){setImmediate(()=>this.onmessage?.({data:{ready:true}}));}postMessage({id,method,args}){calls.push(method);Promise.resolve().then(()=>core[method](...args)).then(value=>this.onmessage?.({data:{id,value}}),error=>this.onmessage?.({data:{id,error:String(error)}}));}};
const peers=[];const SDP='v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n';
globalThis.RTCPeerConnection=class extends EventTarget{constructor(){super();this.iceGatheringState='complete';peers.push(this);}createDataChannel(label){return this.channel=Object.assign(new EventTarget(),{label,ordered:true,maxRetransmits:null,maxPacketLifeTime:null,readyState:'open',bufferedAmount:0,sent:[],send(value){this.sent.push(JSON.parse(value));},close(){this.readyState='closed';}});}async createOffer(){return {type:'offer',sdp:SDP};}async setLocalDescription(value){this.localDescription={toJSON:()=>value};}async setRemoteDescription(value){this.remote=value;}close(){this.closed=true;}};
const $=id=>elements.get(id),tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){const deadline=performance.now()+5000;do{if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}while(performance.now()<deadline);throw new Error('Audio UI did not settle: '+$('audio-status').textContent+' / '+$('audio-notice').textContent);}
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

test('actual native failure handlers retain and export diagnostics across retry without enabling successful acceptance',async t=>{
  const originalNative=Object.getOwnPropertyDescriptor(globalThis,'NativeAudio'),originalSave=window.NativeVault.saveArtifact;
  t.after(()=>{cleanup();originalNative?Object.defineProperty(globalThis,'NativeAudio',originalNative):delete globalThis.NativeAudio;
    originalSave?window.NativeVault.saveArtifact=originalSave:delete window.NativeVault.saveArtifact;});
  cleanup();document.hidden=false;
  const exports=[];let nativeId,attempt=0,expected,invalid=false,unavailable=false,exportAllowed=true,pilotMode,timingMode,roundMode;
  const beforeRounds=calls.filter(method=>method==='create_audio_round').length;
  const format={sample_rate:48000,channels:1,encoding:'pcm-i16',android_encoding:2,channel_mask:16,channel_index_mask:0};
  const stream={device_id:17,device_type:'built-in-mic',sample_rate:48000,channels:1,format:'pcm-f32',sharing_mode:'shared',
    performance_mode:'none',frames_per_burst:192,buffer_capacity_frames:4096};
  const bridge={capabilities:()=>JSON.stringify({available:true,version:1,key_fingerprint:mediaPin}),begin:text=>{
    nativeId=`12345678-1234-4234-8234-${String(++attempt).padStart(12,'0')}`;
    const request=JSON.parse(text),diagnostic={version:1,type:'nonverba-native-audio-diagnostics',signed:false,successful_measurement:false,
      session_id:nativeId,request_session_id:request.session_id,key_fingerprint:mediaPin,stopped_state:'pilot',stopping_phase:'pilot-recording',
      error:'Android client format differs from the required capture format',terminal_elapsed_ms:2134,retained_frames_last_observed:32000,
      pilot_probe_enqueued:true,pilot_verified:false,challenge_count:0,
      android_recording_configuration_last_observed:{input_session_id:21,observed_monotonic_ns:'4567890123',device_id:17,built_in:true,client_silenced:false,
        client_source:9,source:9,client_format:format,device_format:{...format,sample_rate:44100,channels:2,channel_mask:12},client_effect_count:0,effect_count:0,stream_phase:'pilot-recording'},
      aaudio_requested:{input:{sample_rate:48000,channels:1,format:'pcm-f32',performance_mode:'none'},
        output:{sample_rate:48000,channels:1,format:'pcm-f32',performance_mode:'low-latency'}},
      aaudio_actual_last_observed:{input:stream,output:{...stream,device_id:18,device_type:'built-in-speaker',performance_mode:'low-latency'},
        input_session_id:21,captured_frames:32000,timestamps_ready:true,observed_monotonic_ns:'4567890000',stream_phase:'pilot-recording'},diagnostic_errors:[]};
    if(pilotMode!==undefined){
      const reason=pilotMode==='malformed'?'passed':pilotMode,detected=reason!=='not_detected';
      diagnostic.pilot_assessment=pilotMode===null?null:{version:1,type:'nonverba-native-audio-pilot-assessment',signal_algorithm:'org.nonverba.audio-fsk.v1',
        sample_count:96000,maximum_start_offset_samples:38400,passed:reason==='passed',reason,
        detection:{detected,score:detected?0.95:0.4,matched_symbols:detected?62:31,symbol_count:64,offset_samples:reason==='detected_late'?41000:960,
          sample_rate:48000,rms:0.01,in_band_ratio:detected?0.05:0.001}};
      if(pilotMode==='malformed')diagnostic.pilot_assessment.detection.rms=null;
      diagnostic.pilot_verified=reason==='passed';
    }
    if(timingMode!==undefined){
      diagnostic.pilot_native_timing_last_observed=timingMode===null?null:{input_session_id:21,observed_monotonic_ns:'4500000000',captured_frames:96000,
        record_requested_monotonic_ns:'2000000000',record_start_stream_frame:'0',first_input_callback_monotonic_ns:'2020000000',
        last_input_callback_monotonic_ns:'4020000000',completed_output_probe:{index:0,output_start_stream_frame:'1200',output_end_stream_frame:'38064',
          output_first_callback_monotonic_ns:'2030000000',input_frame_at_output_start:960}};
      if(timingMode==='incomplete')Object.assign(diagnostic.pilot_native_timing_last_observed,{captured_frames:0,last_input_callback_monotonic_ns:null,completed_output_probe:null});
      if(timingMode==='malformed')diagnostic.pilot_native_timing_last_observed.completed_output_probe.output_end_stream_frame='38063';
      if(timingMode==='completed'){
        diagnostic.stopped_state='preparing';diagnostic.stopping_phase='recording-opening';
        Object.assign(diagnostic.aaudio_actual_last_observed,{input_session_id:22,observed_monotonic_ns:'8000000000',captured_frames:0,stream_phase:'recording-opening'});
      }
    }
    const malformedRounds=typeof roundMode==='string'&&roundMode.startsWith('malformed-');
    if(roundMode!==undefined){
      Object.assign(diagnostic,{stopped_state:'sealing',stopping_phase:'recording-ready',terminal_elapsed_ms:7134,
        retained_frames_last_observed:192000,pilot_verified:true,challenge_count:2});
      Object.assign(diagnostic.aaudio_actual_last_observed,{input_session_id:22,observed_monotonic_ns:'8000000000',captured_frames:192000,stream_phase:'recording-ready'});
      if(roundMode!=='absent'){
        const rounds=['passed',malformedRounds?'not_detected':roundMode].map((reason,index)=>{
          const detected=reason!=='not_detected';
          return {index,start_sample:index*96000,sample_count:96000,passed:reason==='passed',reason,
            detection:{detected,score:detected?0.95:0.4,matched_symbols:detected?62:31,symbol_count:64,
              offset_samples:reason==='detected_late'?41000:960,sample_rate:48000,rms:0.01,in_band_ratio:detected?0.05:0.001}};
        });
        diagnostic.round_assessment=roundMode===null?null:{version:1,type:'nonverba-native-audio-round-assessment',signal_algorithm:'org.nonverba.audio-fsk.v1',
          sample_format:'pcm16',maximum_start_offset_samples:38400,passed:rounds.every(round=>round.passed),rounds};
        if(roundMode==='malformed-metric')diagnostic.round_assessment.rounds[1].detection.rms=null;
        if(roundMode==='malformed-reason')diagnostic.round_assessment.rounds[1].reason='passed';
        if(roundMode==='malformed-order')diagnostic.round_assessment.rounds[1].index=0;
      }
    }
    if(invalid)diagnostic.request_session_id='f'.repeat(64);else if(!unavailable&&pilotMode!=='malformed'&&timingMode!=='malformed'&&!malformedRounds)expected=clone(diagnostic);
    return JSON.stringify({ok:false,state:'error',error:'Original format refusal',session_id:nativeId,key_fingerprint:mediaPin,
      diagnostics:unavailable?undefined:diagnostic,diagnostics_error:unavailable?'Diagnostic snapshot could not be constructed':undefined});
  },status:()=>assert.fail('Terminal begin must not poll a microphone.'),round:()=>assert.fail('No challenge may run.'),
    chunk:()=>assert.fail('No PCM may leave the collector.'),finalize:()=>assert.fail('No native signing may run.'),
    cancel:()=>JSON.stringify({ok:false,state:'cancelled',error:'Cancelled',session_id:nativeId,key_fingerprint:mediaPin})};
  Object.defineProperty(globalThis,'NativeAudio',{value:bridge,configurable:true});
  window.NativeVault.saveArtifact=(name,mime,base64)=>{exports.push({name,mime,value:JSON.parse(Buffer.from(base64,'base64').toString('utf8'))});return exportAllowed;};
  await action('audio-demo');assert.equal($('audio-arm').disabled,false);await action('audio-arm');
  assert.equal($('audio-notice').textContent,'Original format refusal');assert.equal($('audio-native-diagnostics').hidden,false);
  const rows=$('audio-native-diagnostic-rows').children.map(row=>row.textContent),joined=rows.join('\n');
  assert.ok(rows.length>10&&rows.every(row=>row.length<=512));assert.match(joined,/Unsigned attempt duration: 2134 ms/);
  assert.match(joined,/Last-observed Android client format: 48000 Hz, 1 channel\(s\), pcm-i16; Android encoding 2, channel mask 16, index mask 0/);
  assert.match(joined,/Last-observed Android device format: 44100 Hz, 2 channel\(s\)/);assert.match(joined,/does not establish playback/);
  assert.match(joined,/Last-observed Android configuration stream phase: pilot-recording/);assert.match(joined,/Pilot assessment: unavailable/);
  const assertNoSuccess=()=>{for(const id of ['audio-save-wav','audio-save-demo-receipt','audio-save-session','audio-accept','audio-save-report'])assert.equal($(id).disabled,true,id);
    assert.equal($('audio-result').hidden,true);assert.equal($('audio-session-result').hidden,true);};
  assertNoSuccess();assert.equal($('audio-save-diagnostics').disabled,false);await action('audio-save-diagnostics');
  assert.deepEqual(exports.at(-1),{name:`nonverba-audio-diagnostics-${nativeId}.json`,mime:'application/json',value:expected});
  exportAllowed=false;await action('audio-save-diagnostics');assert.match($('audio-notice').textContent,/Android could not export/);
  assert.equal($('audio-save-diagnostics').disabled,false);assertNoSuccess();exportAllowed=true;
  await action('audio-demo');assert.equal($('audio-arm').disabled,false);assertNoSuccess();
  assert.deepEqual($('audio-native-diagnostic-rows').children.map(row=>row.textContent),rows);await action('audio-save-diagnostics');assert.deepEqual(exports.at(-1).value,expected);
  invalid=true;await action('audio-arm');assert.equal($('audio-notice').textContent,'Original format refusal');assertNoSuccess();
  assert.deepEqual($('audio-native-diagnostic-rows').children.map(row=>row.textContent),rows,'mismatched diagnostics cannot replace the retained attempt');
  await action('audio-save-diagnostics');assert.deepEqual(exports.at(-1).value,expected);
  invalid=false;unavailable=true;await action('audio-demo');await action('audio-arm');
  assert.equal($('audio-notice').textContent,'Original format refusal');assert.equal($('audio-native-diagnostic-error').hidden,false);
  assert.match($('audio-native-diagnostic-error').textContent,/Diagnostics unavailable for native attempt.*Diagnostic snapshot could not be constructed/);
  assert.ok($('audio-native-diagnostic-error').textContent.length<=512);assertNoSuccess();
  await action('audio-save-diagnostics');assert.deepEqual(exports.at(-1).value,expected,'a missing new diagnostic record keeps only the clearly identified prior record');
  unavailable=false;
  for(const reason of ['not_detected','detected_late','passed',null]){
    pilotMode=reason;await action('audio-demo');await action('audio-arm');assertNoSuccess();
    assert.equal($('audio-notice').textContent,'Original format refusal');
    const currentRows=$('audio-native-diagnostic-rows').children.map(row=>row.textContent),text=currentRows.join('\n');
    assert.ok(currentRows.every(row=>row.length<=512));
    if(reason===null)assert.match(text,/Pilot assessment: unavailable/);
    else {assert.match(text,new RegExp(`Unsigned pilot assessment: ${reason}; acoustic pilot policy passed: ${reason==='passed'?'yes':'no'}`));
      assert.match(text,/This is not a completed measurement/);assert.match(text,/Pilot signal metrics: RMS 0.01/);}
    await action('audio-save-diagnostics');assert.deepEqual(exports.at(-1).value,expected);
  }
  const retainedRows=$('audio-native-diagnostic-rows').children.map(row=>row.textContent);
  pilotMode='malformed';await action('audio-demo');await action('audio-arm');assertNoSuccess();
  assert.equal($('audio-notice').textContent,'Original format refusal');
  assert.deepEqual($('audio-native-diagnostic-rows').children.map(row=>row.textContent),retainedRows,'malformed metrics cannot replace retained diagnostics');
  await action('audio-save-diagnostics');assert.deepEqual(exports.at(-1).value,expected);
  for(const mode of ['completed','incomplete',null]){
    timingMode=mode;pilotMode=mode==='completed'?'passed':null;
    const priorRows=$('audio-native-diagnostic-rows').children.map(row=>row.textContent);
    await action('audio-demo');assert.deepEqual($('audio-native-diagnostic-rows').children.map(row=>row.textContent),priorRows);
    await action('audio-save-diagnostics');assert.deepEqual(exports.at(-1).value,expected,'retry alone cannot relabel retained pilot timing');
    await action('audio-arm');assertNoSuccess();assert.equal($('audio-notice').textContent,'Original format refusal');
    const currentRows=$('audio-native-diagnostic-rows').children.map(row=>row.textContent),text=currentRows.join('\n');
    assert.ok(currentRows.every(row=>row.length<=512));
    if(mode==='completed'){
      assert.match(text,/Pilot native timing last observed: input session 21, monotonic ns 4500000000/);
      assert.match(text,/stream phase recording-opening; input session 22/);assert.match(text,/output callback completion last observed: round 0, output frames 1200 to 38064/);
      assert.match(text,/do not establish hardware presentation or physical sound/);
    }else if(mode==='incomplete'){
      assert.match(text,/captured pilot frames 0/);assert.match(text,/input start stream frame 0/);assert.match(text,/last monotonic ns unavailable/);
      assert.match(text,/completed output callback: unavailable in the last observation/);
    }else assert.match(text,/Pilot native timing: unavailable; enqueueing does not establish output callback completion/);
    await action('audio-save-diagnostics');assert.deepEqual(exports.at(-1).value,expected);assert.equal(exports.at(-1).value.signed,false);assert.equal(exports.at(-1).value.successful_measurement,false);
  }
  const timingRows=$('audio-native-diagnostic-rows').children.map(row=>row.textContent);
  timingMode='malformed';pilotMode=null;await action('audio-demo');await action('audio-arm');assertNoSuccess();
  assert.equal($('audio-notice').textContent,'Original format refusal');assert.deepEqual($('audio-native-diagnostic-rows').children.map(row=>row.textContent),timingRows);
  await action('audio-save-diagnostics');assert.deepEqual(exports.at(-1).value,expected,'impossible callback timing cannot replace a retained report');
  pilotMode=null;timingMode=null;
  for(const mode of ['absent',null,'not_detected','detected_late','passed']){
    roundMode=mode;
    const priorRows=$('audio-native-diagnostic-rows').children.map(row=>row.textContent),priorRecord=clone(expected);
    await action('audio-demo');assertNoSuccess();
    assert.deepEqual($('audio-native-diagnostic-rows').children.map(row=>row.textContent),priorRows);
    await action('audio-save-diagnostics');assert.deepEqual(exports.at(-1),{name:`nonverba-audio-diagnostics-${priorRecord.session_id}.json`,mime:'application/json',value:priorRecord},'retry preserves the exact prior export');
    await action('audio-arm');assertNoSuccess();assert.equal($('audio-notice').textContent,'Original format refusal');
    const currentRows=$('audio-native-diagnostic-rows').children.map(row=>row.textContent),text=currentRows.join('\n');
    assert.ok(currentRows.every(row=>row.length<=512));
    assert.match(text,/Last-observed retained frames: 192000/);assert.match(text,/challenges: 2/);
    if(mode==='absent'||mode===null)assert.match(text,/Evidence-round assessment: unavailable; no per-round detector metrics were retained/);
    else {
      assert.match(text,new RegExp(`all round checks passed: ${mode==='passed'?'yes':'no'}`));
      assert.match(text,/Evidence round 1\/2: passed; detected yes/);assert.match(text,new RegExp(`Evidence round 2/2: ${mode}; detected`));
      assert.match(text,/canonical PCM16/);assert.match(text,/matched symbols/);assert.match(text,/best candidate offset/);
      assert.match(text,/RMS 0.01; in-band energy ratio/);assert.match(text,/This is not a completed measurement/);
    }
    await action('audio-save-diagnostics');assert.deepEqual(exports.at(-1),{name:`nonverba-audio-diagnostics-${nativeId}.json`,mime:'application/json',value:expected});
    assert.equal(exports.at(-1).value.signed,false);assert.equal(exports.at(-1).value.successful_measurement,false);
  }
  const roundRows=$('audio-native-diagnostic-rows').children.map(row=>row.textContent),roundRecord=clone(expected);
  for(const mode of ['malformed-metric','malformed-reason','malformed-order']){
    roundMode=mode;await action('audio-demo');assertNoSuccess();await action('audio-arm');assertNoSuccess();
    assert.equal($('audio-notice').textContent,'Original format refusal');
    assert.deepEqual($('audio-native-diagnostic-rows').children.map(row=>row.textContent),roundRows,'malformed round metrics cannot replace the prior record');
    await action('audio-save-diagnostics');assert.deepEqual(exports.at(-1),{name:`nonverba-audio-diagnostics-${roundRecord.session_id}.json`,mime:'application/json',value:roundRecord});
  }
  assert.equal(calls.filter(method=>method==='create_audio_round').length,beforeRounds,'No real or synthetic sound challenge was started.');
});
