// SPDX-License-Identifier: AGPL-3.0-only
// Developer tool UI with a synthetic native bridge and real browser signatures.
// This is neither Android Keystore nor physical hardware acceptance.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createPublicKey, verify} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {collectWebAssets} from '../../tools/build/web-assets.mjs';
import {launchBrowser} from './harness.mjs';

assert.equal(process.platform, 'linux');
assert.equal(process.env.NONVERBA_CONTAINER, '1');
const assets = await collectWebAssets(new URL('../../../web/', import.meta.url).pathname);
const server = createServer((request, response) => {
  const name = new URL(request.url, 'http://localhost').pathname.slice(1);
  if (name === 'favicon.ico') { response.writeHead(204); response.end(); return; }
  const bytes = assets.get(name);
  if (!bytes) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, {'content-type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', 'cache-control':'no-store'});
  response.end(bytes);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await launchBrowser({headless:true, args:['--no-sandbox']});
const errors = [], checks = [];
const url = `http://127.0.0.1:${server.address().port}/device-attestation.html`;
let context;
try {
  context = await browser.newContext({viewport:{width:390,height:844}});
  let page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.getByText('BROWSER · NATIVE PROOF UNAVAILABLE', {exact:true}).waitFor();
  assert.equal(await page.locator('#attestation-prove').isDisabled(), true);
  checks.push('browser capability stays explicitly unavailable for native proving');
  await context.close();
  context = await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(() => {
    const keys = new Map(), cancelled = new Set();
    const fixture = window.attestationFixture = {saved:[], requests:[], hold:false, pending:null};
    const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
    const finish = async message => {
      let pair = keys.get(message.challenge.account_id);
      if (!pair) { pair = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']); keys.set(message.challenge.account_id,pair); }
      const fields = ['challenge_id','account_id','current_session_id','recovery_generation','platform','issued_at','expires_at','challenge_b64'];
      const bytes = new TextEncoder().encode('NONVERBA:SIGNIN_DEVICE:v1\n' + fields.map(key=>message.challenge[key]).join('\n') + '\n');
      const signature = await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,bytes);
      window.NonverbaLoginDevice.onmessage({data:JSON.stringify({id:message.id,proof:{
        public_spki_der_b64:b64(await crypto.subtle.exportKey('spki',pair.publicKey)),signature_b64:b64(signature),
        attestation_chain:null,platform:'android',name:'Synthetic bridge'}})});
    };
    fixture.release = () => finish(fixture.pending);
    window.NativeVault = {saveArtifact(name,mime,base64) {fixture.saved.push({name,mime,text:atob(base64)}); return true;}};
    window.NonverbaLoginDevice = {postMessage(text) {
      const message = JSON.parse(text); fixture.requests.push(message);
      if (message.config) queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:message.id,capabilities:{available:true,platform:'android',version:1,name:'Synthetic bridge'}})}));
      else if (message.cancel) cancelled.add(message.cancel);
      else if (fixture.hold) fixture.pending = message;
      else finish(message);
    }};
  });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await page.getByText('ANDROID TOOL · UNVERIFIED', {exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>attestationFixture.requests.filter(value=>value.challenge).length),0);
  const token = 'NVAT1.' + '0123456789abcdef0123456789abcdef' + '.' + Math.floor(Date.now()/1000)
    + '.' + Buffer.alloc(32,7).toString('base64url') + '.' + Buffer.alloc(32,9).toString('base64url');
  await page.locator('#attestation-request-token').fill(token);
  await page.locator('#attestation-load-request').click();
  await page.locator('#attestation-save-request').click();
  await page.locator('#attestation-prove').click();
  await page.waitForFunction(()=>!document.getElementById('attestation-save-proof').disabled);
  await page.locator('#attestation-save-proof').click();
  const saved = await page.evaluate(()=>attestationFixture.saved);
  assert.equal(saved.length,2);
  const request = JSON.parse(saved[0].text), envelope = JSON.parse(saved[1].text);
  assert.deepEqual(envelope.request,request); assert.equal(envelope.hardware_attested,false);
  assert.equal(envelope.proof.attestation_chain,null);
  const transcript = 'NONVERBA:SIGNIN_DEVICE:v1\n' + ['challenge_id','account_id','current_session_id','recovery_generation','platform','issued_at','expires_at','challenge_b64'].map(key=>request[key]).join('\n') + '\n';
  assert.equal(verify('sha256',Buffer.from(transcript),{key:createPublicKey({key:Buffer.from(envelope.proof.public_spki_der_b64,'base64'),format:'der',type:'spki'}),dsaEncoding:'ieee-p1363'},Buffer.from(envelope.proof.signature_b64,'base64')),true);
  checks.push('explicit native-profile proof exports exact original context and independently verifies real signature');
  await page.evaluate(()=>{attestationFixture.hold=true;});
  await page.locator('#attestation-prove').click();
  await page.waitForFunction(()=>!document.getElementById('attestation-cancel').disabled);
  await page.locator('#attestation-cancel').click();
  await page.evaluate(()=>attestationFixture.release());
  assert.equal(await page.locator('#attestation-save-proof').isDisabled(),true);
  checks.push('cancellation suppresses late proof publication and export');
  await page.evaluate(()=>{attestationFixture.hold=false; dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})); dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  await page.getByText('ANDROID TOOL · UNVERIFIED', {exact:true}).waitFor();
  await page.locator('#attestation-request-token').fill(token);
  await page.locator('#attestation-load-request').click();
  await page.locator('#attestation-prove').click();
  await page.waitForFunction(()=>!document.getElementById('attestation-save-proof').disabled);
  checks.push('restored developer page uses a fresh active tool');
  assert.deepEqual(errors,[]);
  const output = 'artifacts/qa/device-attestation-browser-' + new Date().toISOString().replace(/[:.]/g,'-');
  await mkdir(output,{recursive:true});
  await page.screenshot({path:output+'/tool.png',fullPage:true});
  const result={passed:true,checks,physical_hardware_tested:false,output};
  await writeFile(output+'/result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result));
} finally {
  await context?.close(); await browser.close();
  await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
}
