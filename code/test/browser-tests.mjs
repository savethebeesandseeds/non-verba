// SPDX-License-Identifier: AGPL-3.0-only
// Real Chromium + compiled Rust/WASM end-to-end checks. No crypto is mocked.
// Install Playwright locally, or set NONVERBA_PLAYWRIGHT_PATH to its package.
// Run the local server, then from code/: node test/browser-tests.mjs
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.NONVERBA_PLAYWRIGHT_PATH||'playwright');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(root,'artifacts/qa');
const base=process.env.NONVERBA_TEST_URL||'http://127.0.0.1:4173';
await mkdir(out,{recursive:true});

// A textured, reproducible camera feed exercises the actual browser camera and
// JPEG pipeline. This fixture is explicitly synthetic, never evidence of a scene.
const width=640,height=480;
const yuv=Buffer.alloc(width*height*3/2,128);
let random=0x12345678;
for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  random^=random<<13;random^=random>>>17;random^=random<<5;
  const texture=(random>>>0)%13-6;
  yuv[y*width+x]=Math.max(16,Math.min(235,60+120*y/height+18*Math.sin(x/27)+16*Math.cos(y/37)+texture));
}
const cameraFixture=resolve(out,'synthetic-camera.y4m');
await writeFile(cameraFixture,Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\nFRAME\n`),yuv]));
const args=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-video-capture=${cameraFixture}`];
let browser;
if(process.env.NONVERBA_BROWSER_EXECUTABLE){browser=await chromium.launch({headless:true,executablePath:process.env.NONVERBA_BROWSER_EXECUTABLE,args});}
else{
  let last;
  for(const channel of ['msedge','chrome',undefined]){
    try{browser=await chromium.launch({headless:true,...(channel?{channel}:{}),args});break;}
    catch(error){last=error;}
  }
  if(!browser)throw last;
}
const geolocation={latitude:47.4979,longitude:19.0402,accuracy:12};
const context=await browser.newContext({acceptDownloads:true,permissions:['camera','geolocation'],geolocation,viewport:{width:1440,height:1000}});
// Only pause delivery of real requests/results to reproduce asynchronous races.
// Returned core values, media tracks, signatures and verification are untouched.
await context.addInitScript(()=>{
  const qa={nextCore:null,coreHeld:false,cameraHeld:false,pauseCamera:false,cameraCalls:0,sealCalls:0,tracks:[],coreRelease:null,cameraRelease:null,geoHeld:false,pauseGeo:false,staleGeo:false,geoError:null,geoCalls:0,geoRelease:null,geoOptions:null};
  window.__nonverbaQa=qa;
  const post=Worker.prototype.postMessage;
  Worker.prototype.postMessage=function(message,...rest){
    if(message?.method==='seal_image')qa.sealCalls++;
    if(message?.method===qa.nextCore){
      qa.nextCore=null;qa.coreHeld=true;
      qa.coreRelease=()=>{qa.coreHeld=false;qa.coreRelease=null;post.call(this,message,...rest);};
      return;
    }
    return post.call(this,message,...rest);
  };
  if(navigator.mediaDevices){
    const acquire=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async constraints=>{
      qa.cameraCalls++;
      const stream=await acquire(constraints);qa.tracks.push(...stream.getTracks());
      if(qa.pauseCamera){qa.pauseCamera=false;qa.cameraHeld=true;await new Promise(resolve=>{qa.cameraRelease=()=>{qa.cameraHeld=false;qa.cameraRelease=null;resolve();};});}
      return stream;
    };
  }
  if(navigator.geolocation){
    const locate=navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition=(success,failure,options)=>{
      qa.geoCalls++;qa.geoOptions=options;
      // Test platform failures/stale sensor output, never core verification.
      if(qa.geoError){const code=qa.geoError;qa.geoError=null;queueMicrotask(()=>failure({code,message:'Synthetic geolocation provider failure'}));return;}
      locate(position=>{
        const sample=qa.staleGeo?{coords:position.coords,timestamp:Date.now()-120_000}:position;qa.staleGeo=false;
        if(qa.pauseGeo){qa.pauseGeo=false;qa.geoHeld=true;qa.geoRelease=()=>{qa.geoHeld=false;qa.geoRelease=null;success(sample);};}
        else success(sample);
      },failure,options);
    };
  }
});
const page=await context.newPage();
page.setDefaultTimeout(90_000);
const pageErrors=[];
page.on('pageerror',error=>pageErrors.push(error.message));
const results=[];
const locator=id=>page.locator(`#${id}`);
async function check(name,fn){const start=Date.now();await fn();const entry={name,status:'passed',milliseconds:Date.now()-start};results.push(entry);console.log(`PASS ${name}`);}
async function action(id){if(id==='start-camera'||id==='capture')await context.setGeolocation(geolocation);await locator(id).click();await page.waitForFunction(id=>!document.getElementById(id).hasAttribute('aria-busy'),id);}
async function view(name){await page.locator(`[data-view="${name}"]`).click();}
async function reducedMetadata(){
  const details=locator('camera-location-mode').locator('xpath=ancestor::details[1]');
  if(!await details.evaluate(element=>element.open))await details.locator(':scope > summary').click();
  await locator('camera-location-mode').selectOption('metadata');
}
async function report(){return JSON.parse(await locator('report-json').textContent());}
async function download(id,name){const ready=page.waitForEvent('download');await action(id);const file=await ready;const target=resolve(out,name);await file.saveAs(target);return target;}
async function waitTracksStopped(){await page.waitForFunction(()=>window.__nonverbaQa.tracks.every(track=>track.readyState==='ended'));}
async function load(challenge){await view('operator');await locator('operator-challenge').fill(JSON.stringify(challenge));await action('load-challenge');assert.equal(await locator('challenge-task').textContent(),challenge.task);}
async function verify(file,challenge,pin){await view('verify');await locator('verify-file').setInputFiles(file);await locator('verify-challenge').fill(JSON.stringify(challenge));await locator('verify-device').fill(pin);await action('verify-evidence');assert.equal(await locator('verify-result').isVisible(),true,await locator('notice').textContent());return report();}
async function assertNotCaptured(challenge){assert.equal(await page.evaluate(async id=>{const storage=await import('./storage.js');return (await storage.read('captures',id))??null;},challenge.id),null);assert.equal(await locator('download-bar').isVisible(),false);assert.equal(await page.evaluate(()=>window.__nonverbaQa.sealCalls),0,'Location failure must not call the signer');}
async function pauseCamera(){await page.evaluate(()=>window.dispatchEvent(new Event('nonverba:pause')));await waitTracksStopped();}
async function withDeniedLocation(operation){
  // clearPermissions() also revokes camera permission and ends its live track.
  // Target this context's location permission alone to exercise capture refusal.
  const session=await context.newCDPSession(page);
  try{
    const {targetInfo}=await session.send('Target.getTargetInfo');
    assert.ok(targetInfo.browserContextId,'The permission override must target this isolated browser context');
    await session.send('Browser.setPermission',{permission:{name:'geolocation'},setting:'denied',origin:base,browserContextId:targetInfo.browserContextId});
    // Chromium clears this session's override when the CDP session detaches.
    await operation();
  }finally{await session.detach();await context.grantPermissions(['camera','geolocation']);}
}

// Independent TIFF/EXIF parser: these assertions do not trust C2PA's JSON report.
function exifGps(jpeg){
  let tiff=-1;
  for(let offset=2;offset+4<jpeg.length;){
    assert.equal(jpeg[offset],0xff);const marker=jpeg[offset+1];if(marker===0xda)break;
    const length=jpeg.readUInt16BE(offset+2);
    if(marker===0xe1&&jpeg.subarray(offset+4,offset+10).equals(Buffer.from('Exif\0\0'))){tiff=offset+10;break;}
    offset+=2+length;
  }
  assert.ok(tiff>=0,'Signed JPEG must carry an EXIF APP1 segment');
  const order=jpeg.toString('ascii',tiff,tiff+2);assert.ok(order==='II'||order==='MM');const little=order==='II';
  const u16=at=>little?jpeg.readUInt16LE(at):jpeg.readUInt16BE(at);
  const u32=at=>little?jpeg.readUInt32LE(at):jpeg.readUInt32BE(at);
  assert.equal(u16(tiff+2),42);
  function ifd(offset){
    const tags=new Map();const size={1:1,2:1,3:2,4:4,5:8,7:1,9:4,10:8};
    for(let i=0,count=u16(offset);i<count;i++){
      const at=offset+2+i*12,type=u16(at+2),count=u32(at+4);assert.ok(size[type],`Unsupported EXIF type ${type}`);
      tags.set(u16(at),{type,count,data:size[type]*count<=4?at+8:tiff+u32(at+8)});
    }
    return tags;
  }
  const main=ifd(tiff+u32(tiff+4));assert.ok(main.has(0x8825),'EXIF GPS IFD pointer is required');
  const gps=ifd(tiff+u32(main.get(0x8825).data));
  const text=tag=>{const e=gps.get(tag);assert.ok(e,`Missing GPS tag ${tag}`);return jpeg.toString('ascii',e.data,e.data+e.count).replace(/\0+$/,'');};
  const rational=(tag,index=0)=>{const e=gps.get(tag);assert.ok(e,`Missing GPS rational ${tag}`);assert.equal(e.type,5);const at=e.data+index*8;return u32(at)/u32(at+4);};
  const angle=tag=>rational(tag)+rational(tag,1)/60+rational(tag,2)/3600;
  const [year,month,day]=text(29).split(':').map(Number);
  const timestampMs=Date.UTC(year,month-1,day,rational(7),rational(7,1))+rational(7,2)*1000;
  assert.equal(text(18),'WGS-84');
  return {latitude:angle(2)*(text(1)==='S'?-1:1),longitude:angle(4)*(text(3)==='W'?-1:1),accuracy:rational(31),timestampMs,hasAltitude:gps.has(5)||gps.has(6),latitudeData:gps.get(2).data,little};
}
let challenge,pin,signedPath;
try{
  await page.goto(base);
  await page.waitForFunction(()=>document.getElementById('runtime').textContent.includes('Local engine ready'));
  await page.screenshot({path:resolve(out,'operator-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:resolve(out,'operator-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,'Operator layout overflows a 390-pixel viewport');
  await page.setViewportSize({width:1440,height:1000});
  await check('requester creates a fresh 256-bit challenge',async()=>{
    await view('requester');await locator('requester-name').fill('Synthetic browser QA');await locator('request-task').fill('Synthetic camera fixture: integration test, not real evidence');await locator('request-ttl').selectOption('900');await reducedMetadata();await action('create-challenge');
    challenge=JSON.parse(await locator('created-challenge').inputValue());assert.match(challenge.id,/^[a-f0-9]{64}$/);assert.equal(challenge.expires_at-challenge.issued_at,900);
    await download('save-challenge','sample-challenge.json');await action('use-challenge');pin=(await locator('device-id').textContent()).trim();assert.match(pin,/^[a-f0-9]{64}$/);await download('export-device','sample-public-device-id.txt');
  });
  await check('denied location cannot open camera or consume a challenge',async()=>{
    const before=await page.evaluate(()=>window.__nonverbaQa.cameraCalls);
    await context.clearPermissions();await context.grantPermissions(['camera']);
    assert.equal(await page.evaluate(async()=> (await navigator.permissions.query({name:'geolocation'})).state),'denied');
    await action('start-camera');assert.equal(await page.evaluate(()=>window.__nonverbaQa.cameraCalls),before);await assertNotCaptured(challenge);
    assert.match(await locator('notice').textContent(),/location|permission/i);
    await context.grantPermissions(['camera','geolocation']);
  });
  await check('resetting permissions stops camera without signing or consuming a challenge',async()=>{
    await action('start-camera');await page.waitForFunction(()=>document.getElementById('camera').videoWidth>0);
    await context.clearPermissions();await context.grantPermissions(['camera']);await waitTracksStopped();
    assert.equal(await locator('capture').isDisabled(),true);
    assert.equal(await locator('camera').evaluate(video=>video.srcObject===null),true);
    await assertNotCaptured(challenge);await context.grantPermissions(['camera','geolocation']);
  });
  await check('revoking only location permission before capture prevents signing',async()=>{
    await action('start-camera');await page.waitForFunction(()=>document.getElementById('camera').videoWidth>0);
    await withDeniedLocation(async()=>{
      assert.equal(await page.evaluate(async()=> (await navigator.permissions.query({name:'geolocation'})).state),'denied');
      assert.equal(await page.evaluate(async()=> (await navigator.permissions.query({name:'camera'})).state),'granted');
      assert.equal(await locator('capture').isEnabled(),true,'Location-only revocation must leave a live camera to exercise the capture guard');
      await action('capture');await assertNotCaptured(challenge);
      assert.match(await locator('notice').textContent(),/location|permission/i);
    });
    await pauseCamera();
  });
  await check('unavailable capture location leaves the challenge usable',async()=>{
    await action('start-camera');await page.waitForFunction(()=>document.getElementById('camera').videoWidth>0);
    await page.evaluate(()=>{window.__nonverbaQa.geoError=2;});await action('capture');await assertNotCaptured(challenge);
    assert.match(await locator('notice').textContent(),/location|unavailable/i);await pauseCamera();
  });
  await check('stale capture location cannot produce signed evidence',async()=>{
    await action('start-camera');await page.waitForFunction(()=>document.getElementById('camera').videoWidth>0);
    await page.evaluate(()=>{window.__nonverbaQa.staleGeo=true;});await action('capture');await assertNotCaptured(challenge);
    assert.match(await locator('notice').textContent(),/location|fresh|stale/i);await pauseCamera();
  });
  await check('navigation cancels a pending location before camera acquisition',async()=>{
    const before=await page.evaluate(()=>{window.__nonverbaQa.pauseGeo=true;return window.__nonverbaQa.cameraCalls;});
    await context.setGeolocation(geolocation);await locator('start-camera').click();await page.waitForFunction(()=>window.__nonverbaQa.geoHeld);await view('verify');
    await page.evaluate(()=>window.__nonverbaQa.geoRelease());await page.waitForFunction(()=>!document.getElementById('start-camera').hasAttribute('aria-busy'));
    assert.equal(await page.evaluate(()=>window.__nonverbaQa.cameraCalls),before);await assertNotCaptured(challenge);await view('operator');
  });
  await check('pause cancels capture while a fresh location is pending',async()=>{
    await action('start-camera');await page.waitForFunction(()=>document.getElementById('camera').videoWidth>0);
    await page.evaluate(()=>{window.__nonverbaQa.pauseGeo=true;});await context.setGeolocation(geolocation);await locator('capture').click();await page.waitForFunction(()=>window.__nonverbaQa.geoHeld);
    await pauseCamera();await page.evaluate(()=>window.__nonverbaQa.geoRelease());await page.waitForFunction(()=>!document.getElementById('capture').hasAttribute('aria-busy'));await assertNotCaptured(challenge);
  });
  await check('challenge change cancels pending location without consuming either nonce',async()=>{
    await action('start-camera');await page.waitForFunction(()=>document.getElementById('camera').videoWidth>0);
    await page.evaluate(()=>{window.__nonverbaQa.pauseGeo=true;});await context.setGeolocation(geolocation);await locator('capture').click();await page.waitForFunction(()=>window.__nonverbaQa.geoHeld);
    await view('requester');await locator('request-task').fill('Replacement while a location sample is pending');await action('create-challenge');const replacement=JSON.parse(await locator('created-challenge').inputValue());await action('use-challenge');
    await page.evaluate(()=>window.__nonverbaQa.geoRelease());await page.waitForFunction(()=>!document.getElementById('capture').hasAttribute('aria-busy'));await assertNotCaptured(challenge);await assertNotCaptured(replacement);await load(challenge);
  });
  await check('navigation during validation never starts a camera request',async()=>{
    const before=await page.evaluate(()=>{window.__nonverbaQa.nextCore='validate_challenge';return window.__nonverbaQa.cameraCalls;});
    await locator('start-camera').click();await page.waitForFunction(()=>window.__nonverbaQa.coreHeld);await view('verify');
    await page.evaluate(()=>window.__nonverbaQa.coreRelease());await page.waitForFunction(()=>!document.getElementById('start-camera').hasAttribute('aria-busy'));
    assert.equal(await page.evaluate(()=>window.__nonverbaQa.cameraCalls),before);await view('operator');
  });
  await check('camera remains pending across countdown and stops after navigation',async()=>{
    await page.evaluate(()=>{window.__nonverbaQa.pauseCamera=true;});
    await locator('start-camera').click();await page.waitForFunction(()=>window.__nonverbaQa.cameraHeld);
    // One real countdown tick must not re-enable an in-flight camera request.
    await page.waitForTimeout(1100);assert.equal(await locator('start-camera').isDisabled(),true);
    await view('verify');await page.evaluate(()=>window.__nonverbaQa.cameraRelease());await waitTracksStopped();
    assert.equal(await locator('camera').evaluate(video=>video.srcObject===null),true);
    await page.waitForFunction(()=>!document.getElementById('start-camera').hasAttribute('aria-busy'));
  });
  await check('capture exports a real watermarked C2PA JPEG',async()=>{
    await load(challenge);await action('start-camera');await page.waitForFunction(()=>document.getElementById('camera').videoWidth>0);await action('capture');
    assert.equal(await locator('download-bar').isVisible(),true,await locator('notice').textContent());
    signedPath=await download('download-evidence','sample-signed-synthetic.jpg');const bytes=await readFile(signedPath);assert.equal(bytes[0],0xff);assert.equal(bytes[1],0xd8);assert.ok(bytes.includes(Buffer.from('c2pa')));
    const gps=exifGps(bytes);assert.ok(Math.abs(gps.latitude-geolocation.latitude)<1e-7);assert.ok(Math.abs(gps.longitude-geolocation.longitude)<1e-7);assert.equal(gps.accuracy,geolocation.accuracy);
    assert.equal(gps.hasAltitude,false,'Unavailable altitude must not become a fabricated zero-metre EXIF value');
    const options=await page.evaluate(()=>window.__nonverbaQa.geoOptions);assert.equal(options.maximumAge,0);assert.equal(options.enableHighAccuracy,true);
    assert.match(await locator('capture-location-details').textContent(),/47\.4979/);
    await page.screenshot({path:resolve(out,'operator-signed.png'),fullPage:true});await waitTracksStopped();
  });
  await check('operator cannot reuse an already captured challenge',async()=>{
    const before=await page.evaluate(()=>window.__nonverbaQa.cameraCalls);
    await locator('operator-challenge').fill(JSON.stringify(challenge));await action('load-challenge');
    assert.equal(await locator('loaded-challenge').isVisible(),false);
    assert.match(await locator('notice').textContent(),/already|used|fresh|captured/i);
    assert.equal(await page.evaluate(()=>window.__nonverbaQa.cameraCalls),before);
  });
  await check('correct challenge and pinned signer pass actual WASM verification',async()=>{
    const r=await verify(signedPath,challenge,pin);assert.equal(r.verified,true,JSON.stringify(r));assert.equal(r.acceptance_eligible,true);assert.equal(r.checks.c2pa_integrity,true);assert.equal(r.hardware_attested,false);assert.equal(r.camera_freshness_proven,false);assert.match(r.watermark.id,/^[a-f0-9]{16}$/);
    assert.equal(r.capture.version,2);assert.equal(r.capture.location.latitude,geolocation.latitude);assert.equal(r.capture.location.longitude,geolocation.longitude);assert.equal(r.capture.location.accuracy_m,geolocation.accuracy);assert.equal(r.capture.location.altitude_m,null);assert.equal(r.capture.location.altitude_accuracy_m,null);assert.equal(r.capture.location.source,'device-geolocation');
    assert.ok(Math.abs(exifGps(await readFile(signedPath)).timestampMs-r.capture.location.timestamp_ms)<1,'EXIF UTC fix timestamp must match the signed location');
    assert.equal(r.checks.location_metadata_valid,true);
    assert.ok(Math.abs(r.capture.location.timestamp_ms-r.capture.captured_at*1000)<30_000);assert.match(await locator('result-location-details').textContent(),/47\.4979/);
    await download('export-report','sample-verification.json');await page.screenshot({path:resolve(out,'verification-passed.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(out,'verification-mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,'Verification layout overflows a 390-pixel viewport');await page.setViewportSize({width:1440,height:1000});
  });
  await check('wrong pinned device is rejected',async()=>{
    const r=await verify(signedPath,challenge,'0'.repeat(64));assert.equal(r.verified,false);assert.equal(r.checks.device_match,false);assert.equal(await locator('accept-evidence').isDisabled(),true);
  });
  await check('altered expected request is rejected',async()=>{
    const r=await verify(signedPath,{...challenge,task:'A different task'},pin);assert.equal(r.verified,false);assert.equal(r.checks.challenge_match,false);
  });
  await check('tampered image bytes fail C2PA integrity',async()=>{
    const bytes=await readFile(signedPath);let start=-1;
    // Walk JPEG segments rather than accidentally finding marker-like bytes in
    // a C2PA manifest. Mutate entropy data while leaving the manifest intact.
    for(let offset=2;offset+4<bytes.length;){
      assert.equal(bytes[offset],0xff);const marker=bytes[offset+1];const length=bytes.readUInt16BE(offset+2);
      if(marker===0xda){start=offset+2+length;break;}offset+=2+length;
    }
    assert.ok(start>0);let at=start+32;while(bytes[at]===0xff||bytes[at-1]===0xff)at++;bytes[at]^=1;
    const path=resolve(out,'sample-tampered-synthetic.jpg');await writeFile(path,bytes);const r=await verify(path,challenge,pin);assert.equal(r.verified,false);assert.equal(r.checks.c2pa_integrity,false);
  });
  await check('changing only EXIF GPS breaks C2PA integrity',async()=>{
    const bytes=await readFile(signedPath),gps=exifGps(bytes);const old=gps.little?bytes.readUInt32LE(gps.latitudeData):bytes.readUInt32BE(gps.latitudeData);
    if(gps.little)bytes.writeUInt32LE(old+1,gps.latitudeData);else bytes.writeUInt32BE(old+1,gps.latitudeData);
    assert.notEqual(exifGps(bytes).latitude,gps.latitude);
    const path=resolve(out,'sample-gps-tampered-synthetic.jpg');await writeFile(path,bytes);const r=await verify(path,challenge,pin);assert.equal(r.verified,false);assert.equal(r.checks.c2pa_integrity,false);
  });
  await check('editing verification inputs discards an in-flight result',async()=>{
    await locator('verify-file').setInputFiles(signedPath);await locator('verify-challenge').fill(JSON.stringify(challenge));await locator('verify-device').fill(pin);
    await page.evaluate(()=>{window.__nonverbaQa.nextCore='verify_image';});await locator('verify-evidence').click();await page.waitForFunction(()=>window.__nonverbaQa.coreHeld);
    await locator('verify-device').fill('0'.repeat(64));await page.evaluate(()=>window.__nonverbaQa.coreRelease());await page.waitForFunction(()=>!document.getElementById('verify-evidence').hasAttribute('aria-busy'));
    assert.equal(await locator('verify-result').isVisible(),false);assert.equal(await locator('accept-evidence').isDisabled(),true);
  });
  await check('acceptance rechecks raw evidence and refuses edited authority during verification',async()=>{
    await verify(signedPath,challenge,pin);
    await page.evaluate(()=>{window.__nonverbaQa.nextCore='verify_image';});
    await locator('accept-evidence').click();await page.waitForFunction(()=>window.__nonverbaQa.coreHeld);
    await locator('verify-device').fill('0'.repeat(64));
    await page.evaluate(()=>window.__nonverbaQa.coreRelease());
    await page.waitForFunction(()=>!document.getElementById('accept-evidence').hasAttribute('aria-busy'));
    assert.match(await locator('notice').textContent(),/inputs changed/i);
    assert.equal(await page.evaluate(async id=>(await import('./storage.js')).read('accepted',id),challenge.id),undefined);
  });
  await check('expiry during fresh acceptance verification cannot commit an older positive verdict',async()=>{
    await verify(signedPath,challenge,pin);
    await page.evaluate(()=>{window.__nonverbaQa.nextCore='verify_image';});
    await locator('accept-evidence').click();await page.waitForFunction(()=>window.__nonverbaQa.coreHeld);
    try{
      await page.evaluate(expiry=>{window.__nonverbaQa.realNow=Date.now;Date.now=()=>expiry*1000;window.__nonverbaQa.coreRelease();},challenge.expires_at);
      await page.waitForFunction(()=>!document.getElementById('accept-evidence').hasAttribute('aria-busy'));
      assert.match(await locator('notice').textContent(),/window closed/i);
      assert.equal(await page.evaluate(async id=>(await import('./storage.js')).read('accepted',id),challenge.id),undefined);
    }finally{await page.evaluate(()=>{Date.now=window.__nonverbaQa.realNow;});}
  });
  await check('queued camera acceptance checks expiry after earlier database writers finish',async()=>{
    const checked=await page.evaluate(async()=>{
      const store=await import('./storage.js');
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('nonverba-camera-v1',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      let release=false,entered;
      const started=new Promise(resolve=>{entered=resolve;});
      const tx=db.transaction('accepted','readwrite'),records=tx.objectStore('accepted');
      const keepAlive=()=>{const r=records.get('synthetic-lock');r.onsuccess=()=>{entered();if(!release)keepAlive();};};keepAlive();
      await started;
      const clock=Date.now,at=Math.floor(clock()/1000),id='synthetic-queued-expiry';
      const accepting=store.acceptOnce(id,{sha256:'synthetic'},{issuedAt:at-1,expiresAt:at+2,verifiedAt:at,isCurrent:()=>true});
      const rejected=accepting.then(()=>false,()=>true);
      await Promise.resolve(); // Let acceptance queue behind the live writer.
      try{Date.now=()=>(at+2)*1000;release=true;return {rejected:await rejected,saved:await store.read('accepted',id)};}
      finally{Date.now=clock;db.close();}
    });assert.deepEqual(checked,{rejected:true,saved:undefined});
  });
  await check('acceptance is persisted and replay is refused',async()=>{
    await verify(signedPath,challenge,pin);
    await page.evaluate(()=>{window.__nonverbaQa.nextCore='verify_image';});await locator('accept-evidence').click();await page.waitForFunction(()=>window.__nonverbaQa.coreHeld);
    try{
      await page.evaluate(()=>{const realNow=Date.now;window.__nonverbaQa.realNow=realNow;Date.now=()=>realNow()+2000;window.__nonverbaQa.coreRelease();});
      await page.waitForFunction(()=>!document.getElementById('accept-evidence').hasAttribute('aria-busy'));assert.equal((await report()).accepted,true);assert.equal(await locator('accept-evidence').isDisabled(),true);
    }finally{await page.evaluate(()=>{Date.now=window.__nonverbaQa.realNow;});}
    await page.reload();await page.waitForFunction(()=>document.getElementById('runtime').textContent.includes('Local engine ready'));
    const r=await verify(signedPath,challenge,pin);assert.equal(r.verified,false);assert.equal(r.accepted,true);assert.equal(r.checks.not_previously_accepted,false);assert.equal(await locator('accept-evidence').isDisabled(),true);
  });
  await check('challenge change during signing discards old capture',async()=>{
    await view('requester');await locator('requester-name').fill('Synthetic browser QA');await locator('request-task').fill('Synthetic stale signing capture');await reducedMetadata();await action('create-challenge');await action('use-challenge');
    await action('start-camera');await page.waitForFunction(()=>document.getElementById('camera').videoWidth>0);
    await page.evaluate(()=>{window.__nonverbaQa.nextCore='seal_image';});await locator('capture').click();await page.waitForFunction(()=>window.__nonverbaQa.coreHeld);
    await view('requester');await locator('request-task').fill('Replacement challenge while a capture is signing');await action('create-challenge');
    const changed=JSON.parse(await locator('created-challenge').inputValue());await action('use-challenge');
    await page.evaluate(()=>window.__nonverbaQa.coreRelease());await page.waitForFunction(()=>!document.getElementById('capture').hasAttribute('aria-busy'));
    assert.equal(await locator('download-bar').isVisible(),false);assert.equal(await locator('capture-preview').isVisible(),false);assert.equal(await locator('challenge-task').textContent(),changed.task);
  });
  await check('no uncaught browser errors',async()=>assert.deepEqual(pageErrors,[]));
  await writeFile(resolve(out,'browser-test-results.json'),JSON.stringify({url:base,browser:browser.version(),synthetic_camera:true,synthetic_geolocation:geolocation,results},null,2));
  console.log(`All ${results.length} browser checks passed. Public synthetic artifacts: ${out}`);
}catch(error){
  console.error(`FAIL ${error.stack||error}`);
  await page.screenshot({path:resolve(out,'browser-failure.png'),fullPage:true}).catch(()=>{});
  await writeFile(resolve(out,'browser-test-results.json'),JSON.stringify({url:base,browser:browser.version(),results,error:String(error),pageErrors},null,2));
  process.exitCode=1;
}finally{await context.close();await browser.close();}
