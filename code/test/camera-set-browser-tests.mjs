// SPDX-License-Identifier: AGPL-3.0-only
// Real production JNI output -> shipped worker/WASM; fake browser camera for UI.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
assert.equal(process.platform,'linux');assert.equal(process.env.NONVERBA_CONTAINER,'1');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/nonverba-tools/browser-tests/browsers';
const {chromium}=await import(pathToFileURL('/opt/nonverba-tools/browser-tests/node_modules/playwright/index.mjs').href);
const root=resolve('../web/dist'),qa=resolve('artifacts/qa');await mkdir(qa,{recursive:true});
const request=JSON.parse(await readFile(resolve(qa,'camera-set-synthetic-request.json'),'utf8'));
const bundle=JSON.parse(await readFile(resolve(qa,'camera-set-synthetic-bundle.json'),'utf8'));
const pin=(await readFile(resolve(qa,'camera-set-synthetic-key.txt'),'utf8')).trim();
const sequentialRequest=JSON.parse(await readFile(resolve(qa,'camera-set-sequential-request.json'),'utf8'));
const sequentialBundle=JSON.parse(await readFile(resolve(qa,'camera-set-sequential-bundle.json'),'utf8'));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const errors=[],cases=[];
try {
  const context=await browser.newContext({permissions:['camera','geolocation'],geolocation:{latitude:47.4979,longitude:19.0402},viewport:{width:1000,height:900}});
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url()),path=resolve(root,'.'+decodeURIComponent(url.pathname));
    if(url.origin!=='https://camera-set.test'||!path.startsWith(root+'/'))return route.abort();
    try {await route.fulfill({body:await readFile(path),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm'})[extname(path)]||'application/octet-stream'});}catch{await route.abort();}
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    Date.now=()=>1800000002000;
    navigator.geolocation.getCurrentPosition=callback=>callback({timestamp:Date.now(),coords:{latitude:47.4979,longitude:19.0402,accuracy:12,altitude:null,altitudeAccuracy:null}});
  });
  await page.goto('https://camera-set.test/camera-set.html');
  const reports=await page.evaluate(async ({bundle,request,pin})=>{
    const {createCoreClient}=await import('./core-client.js'),core=createCoreClient();
    const verify=(value=bundle,original=request,key=pin)=>core.json('verify_camera_set',JSON.stringify(value),JSON.stringify(original),key,1800000002);
    const result={valid:await verify()};
    let changed=structuredClone(bundle);changed.images.pop();result.missing=await verify(changed);
    changed=structuredClone(bundle);changed.images.push(changed.images[0]);result.duplicate=await verify(changed);
    changed=structuredClone(bundle);[changed.images[0].camera_id,changed.images[1].camera_id]=[changed.images[1].camera_id,changed.images[0].camera_id];result.swapped=await verify(changed);
    changed=structuredClone(bundle);const bytes=Uint8Array.from(atob(changed.images[0].jpeg_b64),c=>c.charCodeAt(0));bytes[500]^=1;let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));changed.images[0].jpeg_b64=btoa(text);result.tampered=await verify(changed);
    result.wrongPin=await verify(bundle,request,'0'.repeat(64));
    changed=structuredClone(request);changed.challenge.task='different';result.changedRequest=await verify(bundle,changed);
    core.close();return result;
  },{bundle,request,pin});
  assert.equal(reports.valid.verified,true,JSON.stringify(reports.valid));
  assert.equal(reports.valid.timing,'within-requested-skew');
  for(const [name,value] of Object.entries(reports)) {if(name!=='valid')assert.equal(value.verified,false,name);cases.push(name);}
  reports.sequential=await page.evaluate(async ({bundle,request,pin})=>{
    const {createCoreClient}=await import('./core-client.js'),core=createCoreClient();
    try {return await core.json('verify_camera_set',JSON.stringify(bundle),JSON.stringify(request),pin,1800000002);}finally {core.close();}
  },{bundle:sequentialBundle,request:sequentialRequest,pin});
  assert.equal(reports.sequential.verified,true);
  assert.equal(reports.sequential.timing,'sequential-order-confirmed');
  assert.equal(reports.sequential.exposure_start_span_ns,'1');cases.push('sequential-production-jni-worker-verification');
  // File retrieval and verifier UI use separate request/pin inputs.
  await page.locator('#request').fill(JSON.stringify(request));await page.locator('#pin').fill(pin);
  await page.locator('#import-bundle').setInputFiles({name:'synthetic-set.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});
  await page.locator('#verify').click();await page.waitForFunction(()=>document.querySelector('#report').textContent.includes('"verified": true'));
  assert.equal(await page.locator('#photos img').count(),2);cases.push('native-file-import-and-verifier-ui');
  await page.locator('#request').fill(JSON.stringify(sequentialRequest));
  await page.locator('#import-bundle').setInputFiles({name:'sequential-set.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(sequentialBundle))});
  await page.locator('#verify').click();await page.waitForFunction(()=>document.querySelector('#verification-summary').textContent.includes('sequential-order-confirmed'));
  assert.match(await page.locator('#verification-summary').textContent(),/Exposure-start span: 1 ns/);cases.push('sequential-import-ui-exact-gap');
  await page.evaluate(()=>{globalThis.NativeCameraSet={capabilities:()=>JSON.stringify({available:true,version:1,key_fingerprint:'a'.repeat(64),cameras:[{camera_id:'0',lens_facing:'back'},{camera_id:'1',lens_facing:'front'}],concurrent_sets:[]}),begin(){},capture(){},status(){},cancel(){}};});
  await page.locator('#discover').click();await page.waitForFunction(()=>document.querySelector('#profile').value.includes('sequential'));
  assert.deepEqual(JSON.parse(await page.locator('#profile').inputValue()).cameras.map(c=>c.camera_id),['0','1']);
  await page.locator('#timing-mode').selectOption('concurrent');
  await page.locator('#max-skew').fill('1000000');await page.locator('#max-skew').dispatchEvent('change');
  assert.deepEqual(JSON.parse(await page.locator('#profile').inputValue()).timing,{mode:'concurrent',max_start_skew_ns:'1000000'});
  await page.locator('#timing-mode').selectOption('sequential');
  await page.locator('#request').fill('');
  await page.locator('#create').click();await page.waitForFunction(()=>document.querySelector('#request').value.includes('sequential'));
  assert.deepEqual(JSON.parse(await page.locator('#request').inputValue()).profile.timing,{mode:'sequential'});cases.push('explicit-native-sequential-and-concurrent-profile-controls');
  await page.evaluate(()=>{delete globalThis.NativeCameraSet;});
  await page.locator('#discover').click();await page.waitForFunction(()=>document.querySelector('#profile').value.includes('single-camera'));
  await page.waitForFunction(()=>/[a-f0-9]{64}/.test(document.querySelector('#identity').textContent));
  const browserPin=(await page.locator('#identity').textContent()).match(/[a-f0-9]{64}/)[0];
  await page.locator('#create').click();await page.waitForFunction(()=>document.querySelector('#request').value.includes('"browser"'));
  await page.locator('#capture').click();await page.locator('#browser-shutter').waitFor({state:'visible'});
  await page.locator('#browser-shutter').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Browser single-camera set retrieved'));
  await page.locator('#pin').fill(browserPin);await page.locator('#verify').click();await page.waitForFunction(()=>document.querySelector('#report').textContent.includes('"verified": true')&&document.querySelector('#report').textContent.includes('"not-required"'));
  assert.equal(await page.locator('#photos img').count(),1);cases.push('browser-single-camera-shutter-and-verification');
  await page.screenshot({path:resolve(qa,'camera-set-browser.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  await writeFile(resolve(qa,'camera-set-browser-results.json'),JSON.stringify({passed:true,cases,physical_device_tested:false,android_camera2_exercised:false,synthetic_jni_members:true,browser_camera:'Chromium fake media device',gps:'synthetic fixed coordinates',reports},null,2));
  console.log(`${cases.length} camera-set worker/WASM and browser UI cases passed; no physical device.`);
} finally {await browser.close();}
