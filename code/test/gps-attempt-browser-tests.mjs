// SPDX-License-Identifier: AGPL-3.0-only
// Real Chromium and production worker/WASM; synthetic JNI report and read-only native mock.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.NONVERBA_PLAYWRIGHT_PATH);
const cross=process.argv[2], out=`${cross}/browser-${Date.now()}`;
await mkdir(out);
const fixture=JSON.parse(await readFile((await readFile(`${cross}/current-wasm-result.txt`,'utf8')).trim(),'utf8')).positive;
const original=await readFile(`${cross}/original.json`,'utf8');
const pin=(await readFile(`${cross}/jni-key.txt`,'utf8')).trim();
const reportBase64=JSON.parse(await readFile(`${cross}/jni-report.json`,'utf8')).report_base64;
const envelope={version:1,type:'nonverba-gps-attempt-export',attempt_id:fixture.report.snapshot.attempt_id,
status:'signed',original_request_json:original,native_snapshot_json:null,report_base64:reportBase64,error:null};
const results=[];let server,browser,context,serverText='';
try {
  server=spawn(process.execPath,['tools/serve.mjs'],{env:{...process.env,NONVERBA_BIND:'127.0.0.1',NONVERBA_PORT:'4173'},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Preview timeout')),10000);
    server.once('error',reject);server.stdout.on('data',d=>{serverText+=d;if(serverText.includes('Non-verba camera:')){clearTimeout(t);resolve();}});server.stderr.on('data',d=>serverText+=d);});
  browser=await chromium.launch({headless:true,args:['--mute-audio']});
  context=await browser.newContext({viewport:{width:1280,height:1000},acceptDownloads:true});
  await context.addInitScript(({envelope,pin,spki})=>{
    window.__sensorCalls=0;const forbidden=()=>{window.__sensorCalls++;throw Error('No sensors permitted in this harness');};
    if(navigator.geolocation){navigator.geolocation.getCurrentPosition=forbidden;navigator.geolocation.watchPosition=forbidden;}
    if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=forbidden;
    const retry={...envelope,attempt_id:'22222222-2222-4222-8222-222222222222',status:'unsigned-signing-failed',report_base64:null,native_snapshot_json:'{}',error:'Key unavailable'};
    window.__attempts=[envelope];window.__retry=retry;window.__exports=[];
    window.NativeVault={saveArtifact:(name,mime,base64)=>{window.__exports.push({name,mime,text:atob(base64)});return true;}};
    window.NativeLocation={capabilities:()=>JSON.stringify({available:true,key_fingerprint:pin,public_key_spki_b64:spki,raw_gnss_api_available:true}),
      listAttempts:()=>JSON.stringify({ok:true,attempt_ids:window.__attempts.map(a=>a.attempt_id),capacity:32}),readAttempt:id=>JSON.stringify(window.__attempts.find(a=>a.attempt_id===id)),begin:forbidden};
  },{envelope,pin,spki:fixture.report.public_spki_der_b64});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:4173/location.html');
  await page.locator('#gps-attempt-panel > summary').click();
  await page.locator('#gps-attempt-refresh').click();
  await page.waitForFunction(()=>document.querySelector('#gps-attempt-id').options.length===1);
  results.push({name:'read-only retained lookup',passed:true});
  await page.locator('#gps-attempt-save').click();
  await page.waitForFunction(()=>window.__exports.length===2);
  const saved=await page.evaluate(()=>window.__exports);
  assert.equal(saved[0].name,`nonverba-gps-attempt-${envelope.attempt_id}.json`);
  assert.deepEqual(JSON.parse(saved[0].text),envelope);
  assert.equal(saved[1].text,original);
  results.push({name:'explicit save exports exact retained record and native request',passed:true});
  await page.evaluate(()=>window.__attempts.push(window.__retry));
  await page.locator('#gps-attempt-refresh').click();
  await page.waitForFunction(()=>document.querySelector('#gps-attempt-id').options.length===2);
  await page.locator('#gps-attempt-save-all').click();
  await page.waitForFunction(()=>window.__exports.length===6);
  const all=await page.evaluate(()=>window.__exports);
  assert.equal(all[2].text,saved[0].text);
  assert.equal(JSON.parse(all[4].text).status,'unsigned-signing-failed');
  assert.equal(all[5].text,original);
  results.push({name:'save all retains first report across retry and preserves unsigned failure',passed:true});
  await page.locator('#gps-attempt-file').setInputFiles({name:'attempt.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(envelope))});
  await page.locator('#gps-attempt-original').setInputFiles(`${cross}/original.json`);
  await page.locator('#gps-attempt-key').fill(pin);
  await page.locator('#gps-attempt-verify').click();
  await page.waitForFunction(()=>document.querySelector('#gps-attempt-status').textContent.startsWith('GPS failure report verified.'));
  assert.equal(JSON.parse(await page.locator('#gps-attempt-result').textContent()).successful_acceptance_eligible,false);
  results.push({name:'real worker verification keeps successful acceptance unavailable',passed:true});
  await page.locator('#gps-attempt-key').fill('0'.repeat(64));await page.locator('#gps-attempt-verify').click();
  await page.waitForFunction(()=>document.querySelector('#gps-attempt-status').textContent.includes('verification failed'));
  results.push({name:'wrong independently supplied key rejected',passed:true});
  await page.locator('#gps-attempt-file').setInputFiles({name:'unsigned.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...envelope,status:'unsigned-signing-failed',report_base64:null,native_snapshot_json:'{}',error:'Key unavailable'}))});
  await page.locator('#gps-attempt-verify').click();
  await page.waitForFunction(()=>document.querySelector('#gps-attempt-status').textContent.includes('No signed GPS report'));
  results.push({name:'unsigned signing failure shown as absent report',passed:true});
  await page.screenshot({path:`${out}/desktop.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`${out}/mobile.png`,fullPage:true});
  assert.equal(await page.evaluate(()=>window.__sensorCalls),0);assert.deepEqual(errors,[]);
  results.push({name:'desktop/mobile layout, zero sensor calls, zero uncaught errors',passed:true});
} catch(e) {results.push({name:'harness',passed:false,error:String(e.stack||e)});process.exitCode=1;}
finally {
  await context?.close();await browser?.close();
  if(server && server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}
  await writeFile(`${out}/server.log`,serverText);
  await writeFile(`${out}/results.json`,JSON.stringify({scope:'Synthetic JNI report; real Chromium/WASM. No physical sensors or phone Keystore.',results},null,2));
  console.log(JSON.stringify({output:out,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length}));
}
