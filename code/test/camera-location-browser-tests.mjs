// SPDX-License-Identifier: AGPL-3.0-only
// Real WASM/C2PA/COSE composition with explicitly synthetic camera/GPS input.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.NONVERBA_PLAYWRIGHT_PATH||'playwright');
const out=resolve(dirname(fileURLToPath(import.meta.url)),'../artifacts/qa');
const base=process.env.NONVERBA_TEST_URL||'http://127.0.0.1:4173';
await mkdir(out,{recursive:true});
const width=640,height=480,frame=Buffer.alloc(width*height*3/2,128);
for(let y=0;y<height;y++)for(let x=0;x<width;x++)frame[y*width+x]=Math.round(80+100*y/height+18*Math.sin(x/27)+16*Math.cos(y/37));
const fixture=resolve(out,'camera-location-synthetic.y4m');
await writeFile(fixture,Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\nFRAME\n`),frame]));
const browser=await chromium.launch({headless:true,...(process.env.NONVERBA_BROWSER_EXECUTABLE?{executablePath:process.env.NONVERBA_BROWSER_EXECUTABLE}:{channel:'msedge'}),
  args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-video-capture=${fixture}`]});
const geo={latitude:47.4979,longitude:19.0402,accuracy:12};
const context=await browser.newContext({acceptDownloads:true,permissions:['camera','geolocation'],geolocation:geo,viewport:{width:1440,height:1000}});
await context.addInitScript(()=>{
  const qa={emulationUpdating:false,emulationResetErrors:0};window.__cameraLocationQa=qa;
  for(const method of ['watchPosition','getCurrentPosition']){
    const original=navigator.geolocation[method].bind(navigator.geolocation);
    navigator.geolocation[method]=(success,failure,options)=>original(success,error=>{
      // Chromium disconnects its synthetic provider briefly while refreshing
      // a CDP override. This exception exists only in the synthetic QA harness.
      if(qa.emulationUpdating&&error.code===2&&error.message===''){qa.emulationResetErrors++;return;}
      failure?.(error);
    },options);
  }
});
const page=await context.newPage();page.setDefaultTimeout(90000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const results=[],element=id=>page.locator(`#${id}`);
async function check(name,fn){const start=Date.now();await fn();results.push({name,status:'passed',milliseconds:Date.now()-start});console.log(`PASS ${name}`);}
async function action(id){if(id==='start-camera')await context.setGeolocation(geo);await element(id).click();await page.waitForFunction(id=>!document.getElementById(id).hasAttribute('aria-busy'),id);}
async function view(name){await page.locator(`[data-view="${name}"]`).click();}
async function issue(mode='trace'){
  await view('requester');await element('requester-name').fill('Synthetic composition QA');
  await element('request-task').fill('Synthetic location and camera fixture, not real-world evidence');
  const details=element('camera-location-mode').locator('xpath=ancestor::details[1]');
  if(!await details.evaluate(element=>element.open))await details.locator(':scope > summary').click();
  await element('camera-location-mode').selectOption(mode);await element('request-ttl').selectOption('900');
  await action('create-challenge');return JSON.parse(await element('created-challenge').inputValue());
}
async function save(id,name){const event=page.waitForEvent('download');await action(id);const file=await event,target=resolve(out,name);await file.saveAs(target);return target;}
let request,photoPin,locationPin,jpeg,proof;
async function verify({image=jpeg,sidecar=proof,original=request,photo=photoPin,location=locationPin}={}){
  await view('verify');await element('verify-file').setInputFiles(image);
  await element('verify-location-proof').setInputFiles(sidecar||[]);
  await element('verify-challenge').fill(JSON.stringify(original));await element('verify-device').fill(photo);
  await element('verify-location-key').fill(location);await action('verify-evidence');
  if(await element('verify-result').isVisible())return JSON.parse(await element('report-json').textContent());
  return {verified:false,error:await element('notice').textContent()};
}
// Browser test providers are stationary. Ask the real browser permission/API
// plumbing to deliver fresh timestamps; no verification or crypto is replaced.
let stopped=false,pumping=false;
let polling=Promise.resolve();
async function pump(){while(!stopped){
  if(!pumping){await new Promise(resolve=>setTimeout(resolve,100));continue;}
  await page.evaluate(()=>{if(window.__cameraLocationQa)window.__cameraLocationQa.emulationUpdating=true;});
  await context.setGeolocation(geo);
  await new Promise(resolve=>setTimeout(resolve,100));
  await page.evaluate(()=>{if(window.__cameraLocationQa)window.__cameraLocationQa.emulationUpdating=false;});
  await new Promise(resolve=>setTimeout(resolve,600));
}}
try{
  await page.goto(base);await page.waitForFunction(()=>document.getElementById('runtime').textContent.includes('Local engine ready'));
  polling=pump();
  await check('explicit browser-compatible camera request contains independent location policy and context',async()=>{
    await view('requester');assert.equal(await element('camera-location-mode').inputValue(),'raw');
    request=await issue();assert.equal(request.type,'nonverba-camera-location-request');
    assert.equal(request.location_request.context.purpose,'camera');assert.equal(request.location_request.policy.duration_ms,10000);
    await writeFile(resolve(out,'camera-location-request.json'),JSON.stringify(request,null,2));
    await action('use-challenge');photoPin=(await element('device-id').textContent()).trim();locationPin=(await element('camera-location-key-id').textContent()).trim();
    assert.match(photoPin,/^[a-f0-9]{64}$/);assert.match(locationPin,/^[a-f0-9]{64}$/);assert.notEqual(photoPin,locationPin);
  });
  await check('camera exports final C2PA JPEG and matching independently signed COSE proof',async()=>{
    await action('start-camera');await page.waitForFunction(()=>document.getElementById('camera').videoWidth>0);
    pumping=true;try{await action('capture');}finally{pumping=false;}
    assert.equal(await element('download-bar').isVisible(),true,await element('notice').textContent());
    assert.equal(await element('download-location-proof').isVisible(),true);
    jpeg=await save('download-evidence','camera-location-signed-synthetic.jpg');proof=await save('download-location-proof','camera-location-proof.json');
    const value=await verify();assert.equal(value.verified,true,JSON.stringify(value));assert.equal(value.capture.version,3);assert.equal(value.checks.location_proof_valid,true);
    const location=value.location_proof;assert.equal(location.verified,true);assert.equal(location.hardware_attested,false);assert.equal(location.location_authenticity_proven,false);
    assert.equal(location.evidence.asset.kind,'image/jpeg');assert.equal(location.evidence.trace.request.context.purpose,'camera');
    assert.equal(value.capture.location.latitude,location.selected_location.latitude);
    await writeFile(resolve(out,'camera-location-report.json'),JSON.stringify(value,null,2));
    await writeFile(resolve(out,'camera-location-public-keys.json'),JSON.stringify({photo:photoPin,location:locationPin},null,2));
    await page.screenshot({path:resolve(out,'camera-location-verified-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    await page.screenshot({path:resolve(out,'camera-location-verified-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
  });
  await check('required sidecar cannot be omitted or bypassed with legacy challenge',async()=>{
    assert.equal((await verify({sidecar:null})).verified,false);
    const value=await verify({sidecar:null,original:request.location_request.challenge});assert.equal(value.verified,false);assert.equal(value.checks.location_proof_valid,false);
  });
  await check('both photo and location signer pins are independently required',async()=>{
    assert.equal((await verify({location:'0'.repeat(64)})).verified,false);assert.equal((await verify({photo:'0'.repeat(64)})).verified,false);
  });
  await check('exact final JPEG binding rejects a changed file',async()=>{
    const changed=resolve(out,'camera-location-changed.jpg');await writeFile(changed,Buffer.concat([await readFile(jpeg),Buffer.from('changed synthetic file')]));
    const value=await verify({image:changed});assert.equal(value.verified,false);assert.equal(value.location_proof.checks.asset_binding,false);
  });
  await check('requester policy changes invalidate composition',async()=>{
    const changed=structuredClone(request);changed.location_request.policy.max_accuracy_m=90;
    assert.equal((await verify({original:changed})).verified,false);
  });
  await check('native GNSS policy cannot downgrade to browser collection',async()=>{
    await issue('native');await action('use-challenge');assert.match(await element('notice').textContent(),/Android native/i);
    assert.equal(await element('start-camera').isDisabled(),true);
  });
  await check('navigation cancels collection before either signing reservation',async()=>{
    const cancelled=await issue();await action('use-challenge');await action('start-camera');await page.waitForFunction(()=>document.getElementById('camera').videoWidth>0);
    pumping=true;await element('capture').click();await page.waitForFunction(()=>document.getElementById('location-status').textContent.includes('Collecting'));
    await view('verify');await page.waitForFunction(()=>!document.getElementById('capture').hasAttribute('aria-busy'));
    pumping=false;
    assert.equal(await page.evaluate(async id=>{const {read}=await import('./storage.js');return !!(await read('captures',id)||await read('captures',`location:${id}`));},cancelled.location_request.challenge.id),false);
    await view('operator');assert.equal(await element('download-bar').isVisible(),false);
  });
  await check('composition introduces no uncaught browser errors',async()=>assert.deepEqual(errors,[]));
  const emulation_reset_errors_filtered=await page.evaluate(()=>window.__cameraLocationQa.emulationResetErrors);
  await writeFile(resolve(out,'camera-location-browser-results.json'),JSON.stringify({fixture:'Synthetic camera and GPS; not physical device validation',emulation_reset_errors_filtered,results},null,2));
}finally{stopped=true;await polling;await browser.close();}
