// SPDX-License-Identifier: AGPL-3.0-only
// Actual rendered forms + shipped Rust/WASM. No physical/synthetic sensor acquisition.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Run inside non-verba-dev.');
const require = createRequire(import.meta.url), {chromium} = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'artifacts/qa/complete-defaults-browser-' + new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(out, {recursive:true});
const base = 'http://127.0.0.1:4173', results = [], errors = [];
let server, browser, context, page, serverLog = '';
async function check(name, run) {
  const at = Date.now();
  try { await run(); results.push({name,passed:true,elapsed_ms:Date.now()-at}); console.log('PASS ' + name); }
  catch (error) { results.push({name,passed:false,error:String(error.stack || error)}); if (page) await page.screenshot({path:resolve(out,'failure.png'),fullPage:true}).catch(()=>{}); throw error; }
}
async function open(path) {
  if (context) {
    assert.equal(await page.evaluate(()=>window.__completeQa.sensorCalls), 0);
    await context.close();
  }
  context = await browser.newContext({viewport:{width:1080,height:900},acceptDownloads:true});
  await context.addInitScript(() => {
    window.__completeQa = {sensorCalls:0,methods:[]};
    const forbidden = () => { window.__completeQa.sensorCalls++; throw new Error('Sensors and sound forbidden in this test.'); };
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = forbidden;
    if (navigator.geolocation) for (const method of ['getCurrentPosition','watchPosition']) navigator.geolocation[method] = forbidden;
    window.AudioContext = window.webkitAudioContext = class { constructor() { forbidden(); } };
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message,...args) { window.__completeQa.methods.push(message?.method); return post.call(this,message,...args); };
  });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base + path);
}
const field = id => page.locator('#' + id);
async function act(id) { await field(id).click(); await page.waitForFunction(id=>!document.getElementById(id).hasAttribute('aria-busy'),id); }
async function hiddenDetails(id, value) {
  assert.equal(await field(id).inputValue(),value);
  assert.equal(await field(id).isVisible(),false);
  assert.equal(await field(id).evaluate(element=>{const details=element.closest('details');return !!details && !details.open;}),true);
}
async function expand(id) { const details=field(id).locator('xpath=ancestor::details[1]'); await details.locator(':scope > summary').click(); }
async function save(name, value) { await writeFile(resolve(out,name),JSON.stringify(value,null,2)+'\n'); }
function raw(policy) {
  assert.equal(policy.profile,'native-required'); assert.equal(policy.required_provider,'gnss');
  assert.equal(policy.duration_ms,2000); assert.equal(policy.raw_gnss.mode,'required');
  assert.equal(policy.raw_gnss.max_elapsed_realtime_uncertainty_ns,100000000);
}
async function noDispatch() { const methods=await page.evaluate(()=>window.__completeQa.methods); assert.ok(!methods.includes('create_evidence_session_request')); }
try {
  server=spawn(process.execPath,['tools/serve.mjs'],{cwd:root,env:{...process.env,NONVERBA_BIND:'127.0.0.1',NONVERBA_PORT:'4173'},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Preview timeout')),10000);
    server.once('error',error=>{clearTimeout(timer);reject(error);}); server.once('exit',code=>{clearTimeout(timer);reject(new Error('Preview exited '+code));});
    server.stdout.on('data',data=>{serverLog+=data;if(serverLog.includes('Non-verba camera:')){clearTimeout(timer);resolve();}});
    server.stderr.on('data',data=>{serverLog+=data;});});
  browser=await chromium.launch({headless:true,args:['--mute-audio'],...(process.env.NONVERBA_BROWSER_EXECUTABLE?{executablePath:process.env.NONVERBA_BROWSER_EXECUTABLE}:{})});
  await open('/');
  await page.waitForFunction(()=>document.getElementById('runtime').textContent.includes('ready'));
  await page.locator('[data-view="requester"]').click();
  let cameraRequest;
  await check('untouched camera form creates concurrent native raw-GPS request; reduced choices start closed',async()=>{
    await hiddenDetails('camera-location-mode','raw');
    await field('requester-name').fill('Complete package QA'); await field('request-task').fill('Inspect complete defaults without sensors');
    await act('create-challenge'); cameraRequest=JSON.parse(await field('created-challenge').inputValue());
    raw(cameraRequest.location_request.policy); assert.equal(cameraRequest.location_request.context.camera_timing,'concurrent');
    await save('camera-original-request.json',cameraRequest);
    await page.screenshot({path:resolve(out,'camera-default.png'),fullPage:true});
  });
  await check('browser operator rejects default native/raw camera request without opening sensors',async()=>{
    await act('use-challenge'); assert.match(await field('notice').textContent(),/Android native location collector/);
    assert.equal(await page.evaluate(()=>window.__completeQa.sensorCalls),0);
  });
  await check('explicit reduced camera choice remains available and does not reinterpret saved full request',async()=>{
    await page.locator('[data-view="requester"]').click(); await expand('camera-location-mode');
    await field('camera-location-mode').selectOption('metadata'); await act('create-challenge');
    const reduced=JSON.parse(await field('created-challenge').inputValue()); assert.ok(!reduced.policy); assert.ok(reduced.nonce);
    raw(cameraRequest.location_request.policy); await save('camera-reduced-request.json',reduced);
  });
  await open('/location.html'); await page.waitForFunction(()=>!document.getElementById('location-create-request').disabled);
  let locationRequest;
  await check('untouched standalone location creates raw-required proof without camera or audio',async()=>{
    await hiddenDetails('location-profile','raw-gnss'); await field('location-requester-name').fill('Complete package QA');
    await field('location-task').fill('Inspect location defaults'); await act('location-create-request');
    locationRequest=JSON.parse(await field('location-created-request').inputValue()); raw(locationRequest.policy);
    assert.ok(locationRequest.context == null); await save('location-original-request.json',locationRequest);
    await page.setViewportSize({width:390,height:844}); await page.screenshot({path:resolve(out,'location-mobile-default.png'),fullPage:true});
  });
  await check('unsupported browser cannot substitute ordinary coordinates for default location',async()=>{
    await act('location-use-request'); await act('location-collect');
    assert.match(await field('location-notice').textContent(),/requires native Android/);
    assert.equal(await field('location-save-proof').isEnabled(),false);
    assert.equal(await page.evaluate(()=>window.__completeQa.sensorCalls),0);
  });
  await check('reduced location is explicit; imported complete request retains raw requirement',async()=>{
    await page.locator('[data-location-view="requester"]').click(); await expand('location-profile');
    await field('location-profile').selectOption('browser-or-native'); await act('location-create-request');
    const reduced=JSON.parse(await field('location-created-request').inputValue()); assert.equal(reduced.policy.profile,'browser-or-native'); assert.ok(!reduced.policy.raw_gnss);
    await page.locator('[data-location-view="operator"]').click(); await field('location-request-input').fill(JSON.stringify(locationRequest)); await act('location-load-request');
    raw(JSON.parse(await field('location-request-input').inputValue()).policy);
  });
  await open('/'); await page.waitForFunction(()=>document.getElementById('runtime').textContent.includes('ready'));
  await field('camera-live-panel').locator(':scope > summary').click();
  await check('live camera default pairs for native correlated camera plus raw GPS without issuing a challenge',async()=>{
    await hiddenDetails('camera-live-assurance','native-correlated'); await hiddenDetails('camera-live-location-profile','raw-gnss');
    assert.equal(await field('camera-live-location-pin').isVisible(),true);
    await field('camera-live-requester').fill('Complete package QA'); await field('camera-live-task').fill('Inspect complete camera offer');
    await field('camera-live-operator-pin').fill('a'.repeat(64)); await field('camera-live-location-pin').fill('b'.repeat(64));
    await act('camera-live-create'); await page.waitForFunction(()=>document.getElementById('camera-live-offer-out').value.length>0);
    const offer=JSON.parse(await field('camera-live-offer-out').inputValue()); assert.equal(offer.version,2);
    assert.equal(offer.hints.assurance,'native-correlated'); assert.equal(offer.hints.location_profile,'raw-gnss'); assert.equal(offer.hints.duration_ms,2000);
    assert.equal(offer.hints.hardware_attestation_required,false); assert.equal(offer.hints.independent_position_required,false);
    assert.equal(await field('camera-live-start').isEnabled(),false); await noDispatch(); await save('camera-default-offer.json',offer);
    await act('camera-live-cancel');
  });
  await open('/live-location.html'); await page.waitForFunction(()=>!document.getElementById('live-create-offer').disabled);
  await check('live location default selects raw data without claiming external verification',async()=>{
    await hiddenDetails('live-profile','raw-gnss'); await field('live-requester-name').fill('Complete package QA'); await field('live-task').fill('Inspect complete location offer');
    await field('live-operator-pin').fill((await field('live-operator-key').textContent()).trim()); await act('live-create-offer');
    const offer=JSON.parse(await field('live-offer-output').inputValue()); assert.equal(offer.hints.profile,'raw-gnss'); assert.equal(offer.hints.duration_ms,2000);
    assert.equal(offer.hints.hardware_attestation_required,false); assert.equal(offer.hints.independent_position_required,false); assert.equal(offer.hints.demo,false);
    await noDispatch(); await save('location-default-offer.json',offer); await act('live-cancel');
    await field('live-offer-input').fill(JSON.stringify(offer)); await field('live-requester-pin').fill(offer.requester_pin); await act('live-join');
    assert.match(await field('live-notice').textContent(),/Android native location collector/);
    assert.equal(await field('live-arm').isEnabled(),false); await noDispatch();
  });
  await open('/audio.html'); await page.waitForFunction(()=>document.getElementById('audio-runtime').textContent.toLowerCase().includes('ready'));
  await check('audio defaults to monitored ten seconds; offer preparation records and plays nothing',async()=>{
    await hiddenDetails('audio-assurance','android-monitored'); assert.equal(await field('audio-duration').inputValue(),'10');
    await field('audio-requester-name').fill('Complete package QA'); await field('audio-task').fill('Inspect policy only - no recording'); await field('audio-operator-pin').fill('a'.repeat(64));
    await act('audio-create'); const offer=JSON.parse(await field('audio-offer').inputValue());
    assert.equal(offer.hints.assurance,'android-monitored'); assert.equal(offer.hints.duration_secs,10); assert.equal(await field('audio-start').isEnabled(),false);
    await noDispatch(); await save('audio-default-offer.json',offer); await act('audio-cancel');
    await page.setViewportSize({width:390,height:844}); await page.screenshot({path:resolve(out,'audio-mobile-default.png'),fullPage:true});
    await page.locator('[data-audio-view="operator"]').click();
    await field('audio-offer-input').fill(JSON.stringify(offer)); await field('audio-requester-pin').fill(offer.requester_pin); await act('audio-join');
    assert.match(await field('audio-notice').textContent(),/requires Android monitored recording/);
    assert.equal(await field('audio-arm').isEnabled(),false); await noDispatch();
    assert.equal(await page.evaluate(()=>window.__completeQa.sensorCalls),0);
  });
  assert.deepEqual(errors,[]);
} catch (error) { console.error(error); process.exitCode=1; }
finally {
  await context?.close(); await browser?.close();
  if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}
  await writeFile(resolve(out,'server.log'),serverLog);
  await save('summary.json',{passed:!process.exitCode,results,page_errors:errors,sensor_acquisition:false,audio_playback:false,physical_device_test:false});
  console.log('Evidence: '+out);
}
