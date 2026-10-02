// SPDX-License-Identifier: AGPL-3.0-only
// Real WebRTC + shipped Rust/WASM + persistent requester ledger. Geolocation is
// an explicitly synthetic Chromium fixture, not physical GNSS/Android validation.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.NONVERBA_PLAYWRIGHT_PATH||'playwright');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=resolve(root,'artifacts/qa'),base=process.env.NONVERBA_TEST_URL||'http://127.0.0.1:4174';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']}),results=[],errors=[];
const position={latitude:47.4979,longitude:19.0402,accuracy:12};
async function context(){const c=await browser.newContext({acceptDownloads:true,permissions:['geolocation'],geolocation:position,viewport:{width:1440,height:1000}});
  await c.addInitScript(()=>{
    window.__liveQa={challengeCalls:0,wrapperCalls:0,providerUpdating:false};const original=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(message,...rest){if(message.method==='create_location_request')window.__liveQa.challengeCalls++;if(message.method==='create_evidence_session_request')window.__liveQa.wrapperCalls++;return original.call(this,message,...rest);};
    for(const name of ['watchPosition','getCurrentPosition']){const fn=navigator.geolocation[name].bind(navigator.geolocation);navigator.geolocation[name]=(success,failure,options)=>fn(success,error=>{
      if(window.__liveQa.providerUpdating&&error.code===2&&error.message==='')return;failure?.(error);
    },options);}
  });return c;}
const requesterContext=await context(),operatorContext=await context(),requester=await requesterContext.newPage(),operator=await operatorContext.newPage();
for(const page of [requester,operator])page.on('pageerror',error=>errors.push(error.message));
async function load(page){await page.goto(`${base}/live-location.html`);await page.waitForFunction(()=>!document.getElementById('live-demo').disabled,undefined,{timeout:60000});}
async function action(page,id){await page.locator(`#${id}`).click();await page.waitForFunction(id=>!document.getElementById(id).hasAttribute('aria-busy'),id,{timeout:70000});}
async function check(name,work){const start=Date.now();try{await work();results.push({name,passed:true,ms:Date.now()-start});console.log(`PASS ${name}`);}catch(error){results.push({name,passed:false,error:String(error)});await requester.screenshot({path:resolve(out,'live-location-failure.png'),fullPage:true});throw error;}}
async function pump(c,page,work){let stop=false;const pending=(async()=>{while(!stop){await page.evaluate(()=>window.__liveQa.providerUpdating=true);await c.setGeolocation(position);await new Promise(r=>setTimeout(r,100));await page.evaluate(()=>window.__liveQa.providerUpdating=false);await new Promise(r=>setTimeout(r,650));}})();try{return await work();}finally{stop=true;await pending;}}
async function download(page,id,name){const event=page.waitForEvent('download');await action(page,id);const d=await event;await d.saveAs(resolve(out,name));return readFile(resolve(out,name),'utf8');}
let requesterPin,operatorPin,offer,receipt,original,proofEnvelope,report;
try{
  await Promise.all([load(requester),load(operator)]);
  await check('separate persistent requester and operator keys',async()=>{
    requesterPin=await requester.locator('#live-requester-key').textContent();operatorPin=await operator.locator('#live-operator-key').textContent();
    assert.match(requesterPin,/^[0-9a-f]{64}$/);assert.match(operatorPin,/^[0-9a-f]{64}$/);
    assert.notEqual(requesterPin,await requester.locator('#live-operator-key').textContent());await load(requester);assert.equal(await requester.locator('#live-requester-key').textContent(),requesterPin);
  });
  await check('pairing discloses no sensor nonce or signed acquisition request',async()=>{
    // This existing browser-provider test deliberately chooses the reduced profile.
    await requester.locator('#live-profile').locator('xpath=ancestor::details[1]').locator(':scope > summary').click();
    await requester.locator('#live-profile').selectOption('browser-or-native');
    await requester.locator('#live-requester-name').fill('Synthetic live requester');await requester.locator('#live-task').fill('Synthetic browser measurement integration test');await requester.locator('#live-operator-pin').fill(operatorPin);
    await action(requester,'live-create-offer');offer=JSON.parse(await requester.locator('#live-offer-output').inputValue());
    assert.deepEqual(Object.keys(offer).sort(),['description','hints','operator_pin','pairing_id','requester_pin','type','version']);
    assert.ok(!JSON.stringify(offer).includes('cose_b64'));assert.ok(!('request' in offer));assert.ok(!('challenge' in offer.hints));
    assert.deepEqual(await requester.evaluate(()=>({challenge:window.__liveQa.challengeCalls,wrapper:window.__liveQa.wrapperCalls})),{challenge:0,wrapper:0});
  });
  await check('operator requires independently known requester pin and explicit consent',async()=>{
    await operator.locator('#live-offer-input').fill(JSON.stringify(offer));await operator.locator('#live-requester-pin').fill('0'.repeat(64));await action(operator,'live-join');assert.match(await operator.locator('#live-notice').textContent(),/independently known/);
    await operator.locator('#live-requester-pin').fill(requesterPin);await action(operator,'live-join');await requester.locator('#live-answer-input').fill(await operator.locator('#live-answer-output').inputValue());await action(requester,'live-connect');
    await operator.waitForFunction(()=>!document.getElementById('live-arm').disabled);assert.equal(await requester.locator('#live-start').isDisabled(),true);
    assert.equal(await requester.evaluate(()=>window.__liveQa.challengeCalls),0);await action(operator,'live-arm');await requester.waitForFunction(()=>!document.getElementById('live-start').disabled);
  });
  await check('direct live transfer verifies actual location proof and signs requester arrival',async()=>{
    await pump(operatorContext,operator,async()=>{await action(requester,'live-start');await requester.waitForFunction(()=>document.getElementById('live-verdict').textContent==='Signed requester receipt verified.',undefined,{timeout:70000});});
    report=JSON.parse(await requester.locator('#live-report-json').textContent());assert.equal(report.verified,true);assert.equal(report.appraisal.verification.verified,true);assert.equal(report.demo,false);assert.ok(report.receipt.timing.elapsed_ms>=10000&&report.receipt.timing.elapsed_ms<=90000);
    assert.equal(report.physical_measurement_authenticity_proven,false);assert.equal(report.requester_clock_trusted,false);assert.equal(report.global_replay_checked,false);assert.equal(report.local_replay_checked,false);assert.equal(report.request.spec.delivery.max_receipt_age_ms,60000);
    assert.equal(await requester.evaluate(()=>window.__liveQa.challengeCalls),1);assert.equal(await requester.evaluate(()=>window.__liveQa.wrapperCalls),1);
    await operator.waitForFunction(()=>document.getElementById('live-verdict').textContent==='Signed requester receipt verified.');
    original=await download(requester,'live-save-request','live-original-request.json');receipt=await download(requester,'live-save-receipt','live-receipt.json');proofEnvelope=await download(requester,'live-save-proof','live-location-proof.json');
    await writeFile(resolve(out,'live-location-verification.json'),JSON.stringify(report,null,2));await requester.screenshot({path:resolve(out,'live-location-desktop.png'),fullPage:true});
  });
  await check('independent verifier rejects tampering and wrong pins but preserves historical verification',async()=>{
    const checked=await operator.evaluate(async({original,receipt,proofEnvelope,requesterPin,operatorPin})=>{
      const {createCoreClient}=await import('./core-client.js'),{readLocationProofEnvelope}=await import('./location-platform.js'),core=createCoreClient(),proof=readLocationProofEnvelope(proofEnvelope),at=Math.floor(Date.now()/1000),bundle=JSON.parse(receipt);
      const call=(bytes,rpin=requesterPin,time=at)=>core.json('verify_evidence_session_receipt',bundle.receipt,original,bytes,new Uint8Array(),'',rpin,bundle.context_json,time);
      const changed=proof.slice();changed[changed.length-1]^=1;return {valid:await call(proof),tampered:await call(changed),wrongPin:await call(proof,'0'.repeat(64)),historical:await call(proof,requesterPin,at+2000)};
    },{original,receipt,proofEnvelope,requesterPin,operatorPin});
    assert.equal(checked.valid.verified,true);assert.equal(checked.tampered.verified,false);assert.equal(checked.wrongPin.verified,false);assert.equal(checked.historical.verified,true);assert.equal(checked.historical.fresh_action_eligible,false);
  });
  await check('shared acceptance reruns raw cryptography rather than trusting a saved verdict',async()=>{
    const rejected=await requester.evaluate(async ({sessionId,requesterPin})=>{
      const storage=await import('./agent-evidence-storage.js'),{createCoreClient}=await import('./core-client.js'),engine=createCoreClient();
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('nonverba-agent-evidence-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const original=(await storage.readEvidenceSession(sessionId)).outcome;
      const put=value=>new Promise((resolve,reject)=>{const tx=db.transaction(['outcomes'],'readwrite');tx.objectStore('outcomes').put(value,sessionId);tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error);});
      const changed=structuredClone(original);changed.primary[changed.primary.length-1]^=1;changed.report={verified:true};
      await put(changed);let rejected=false;
      try{await storage.acceptEvidenceSession(engine,sessionId,requesterPin);}catch{rejected=true;}
      finally{await put(original);db.close();}
      return rejected;
    },{sessionId:report.request.session_id,requesterPin});assert.equal(rejected,true);
  });
  await check('requester atomically accepts once and reserves both session and sensor nonce',async()=>{
    const checks=await requester.evaluate(async ({sessionId,requesterPin})=>{
      const store=await import('./agent-evidence-storage.js'),{createCoreClient}=await import('./core-client.js'),engine=createCoreClient();
      const clock=Date.now;let pastRejected=false;try{Date.now=()=>0;await store.acceptEvidenceSession(engine,sessionId,requesterPin);}catch{pastRejected=true;}finally{Date.now=clock;}
      const accepted=await Promise.allSettled([store.acceptEvidenceSession(engine,sessionId,requesterPin),store.acceptEvidenceSession(engine,sessionId,requesterPin)]);
      await store.reserveEvidenceSession({session_id:'a'.repeat(64),sensor_nonce:'b'.repeat(64)});let collision=false;
      try{await store.reserveEvidenceSession({session_id:'c'.repeat(64),sensor_nonce:'b'.repeat(64)});}catch{collision=true;}
      return {success:accepted.filter(v=>v.status==='fulfilled').length,pastRejected,collision,rollback:(await store.readEvidenceSession('c'.repeat(64))).task===undefined};
    },{sessionId:report.request.session_id,requesterPin});assert.deepEqual(checks,{success:1,pastRejected:true,collision:true,rollback:true});
  });
  await check('transport rejects unsolicited, oversized, reordered and interrupted artifacts',async()=>{
    const cases=await requester.evaluate(async()=>{const {LivePeer}=await import('./live-peer.js'),results=[];
      for(const kind of ['unsolicited','oversized','offset','short-fragment','interleaving']){const errors=[];let completed=false;
        const peer=new LivePeer({onMessage(){},onArtifact(){completed=true;},onFailure:e=>errors.push(e.message),onConnected(){},authorizeArtifact:()=>kind!=='unsolicited'});
        const channel={label:'nonverba-live-location-v1',ordered:true,maxRetransmits:null,maxPacketLifeTime:null,close(){}};peer.attach(channel);
        channel.onmessage({data:JSON.stringify({type:'artifact',bytes:kind==='oversized'?2147483647:16001})});
        if(kind==='offset'||kind==='short-fragment'){const packet=new Uint8Array(kind==='offset'?16004:5);new DataView(packet.buffer).setUint32(0,kind==='offset'?1:0,true);channel.onmessage({data:packet.buffer});}
        if(kind==='interleaving')channel.onmessage({data:JSON.stringify({type:'armed',pairing_id:'0'.repeat(64)})});
        peer.close();results.push({kind,errors,completed});
      }return results;});
    for(const fixture of cases){assert.equal(fixture.completed,false,fixture.kind);assert.ok(fixture.errors.length>0,fixture.kind);}
  });
  await check('same-device live demo remains durably marked and ineligible for acceptance',async()=>{
    await load(requester);await pump(requesterContext,requester,async()=>{await action(requester,'live-demo');await requester.waitForFunction(()=>document.getElementById('live-verdict').textContent==='Local demo receipt verified.',undefined,{timeout:70000});});
    const demo=JSON.parse(await requester.locator('#live-report-json').textContent());assert.equal(demo.verified,true);assert.equal(demo.demo,true);assert.equal(demo.receipt.demo,true);assert.equal(demo.fresh_action_eligible,false);assert.equal(await requester.locator('#live-accept').isDisabled(),true);
  });
  await check('mobile layout fits the viewport',async()=>{await requester.setViewportSize({width:390,height:844});assert.equal(await requester.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await requester.screenshot({path:resolve(out,'live-location-mobile.png'),fullPage:true});});
  assert.deepEqual(errors,[]);
}finally{await writeFile(resolve(out,'live-location-browser-tests.json'),JSON.stringify({fixture:'synthetic Chromium geolocation; real WebRTC and Rust crypto',results,pageErrors:errors},null,2));await browser.close();}
