// SPDX-License-Identifier: AGPL-3.0-only
// Bounded connectivity observation only. Never arms or issues a sensor challenge.
// --self-test connects two isolated Linux pages; --self-test-invalid-answer
// checks signaling rejection. Default waits for a saved phone answer.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {readFile, mkdir, writeFile, stat} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Run inside non-verba-dev.');
const args = process.argv.slice(2);
if (args.some(arg => !['--self-test','--self-test-invalid-answer'].includes(arg)) || args.length > 1) throw new Error('Only one documented self-test option is accepted.');
const selfTest = args.length === 1, invalidAnswer = args.includes('--self-test-invalid-answer');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const output = resolve(root, `artifacts/${selfTest ? 'qa' : 'device-acceptance'}/camera-pairing-preflight-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
await mkdir(output);
const pinSource = 'artifacts/device-acceptance/requester-camera-20260930-seventh/configuration.json';
const pin = JSON.parse(await readFile(resolve(root, pinSource), 'utf8')).operator_pin;
assert.match(pin, /^[a-f0-9]{64}$/);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let stopped = false, server, browser, context, page, operator, serverLog = '';
const result = {type:'nonverba-camera-pairing-preflight', version:1, status:'starting', self_test:selfTest, invalid_answer_test:invalidAnswer,
  sensor_challenge_created:false, operator_armed:false, sensor_evidence_verified:false,
  scope:'Signaling and data-channel connectivity only; no sensor evidence, capture freshness, authenticated physical truth or requester independence is established.'};
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { stopped = true; });
try {
  server = spawn(process.execPath, ['tools/serve.mjs'], {cwd:root, env:{...process.env, NONVERBA_BIND:'127.0.0.1', NONVERBA_PORT:'4173'}, stdio:['ignore','pipe','pipe']});
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preview startup timed out.')), 10000);
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error('Preview exited: ' + code)); });
    server.stdout.on('data', value => { serverLog += value; if (serverLog.includes('Non-verba camera:')) { clearTimeout(timer); resolve(); } });
    server.stderr.on('data', value => { serverLog += value; });
  });
  browser = await chromium.launch({headless:true, args:['--mute-audio']});
  context = await browser.newContext();
  await context.addInitScript(() => {
    window.__pairingSensorCalls = 0; window.__pairingChallenges = 0; window.__pairingPCs = []; window.__pairingChannels = [];
    const forbidden = () => { window.__pairingSensorCalls++; throw new Error('No sensors in requester connectivity preflight.'); };
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = forbidden;
    if (navigator.geolocation) { navigator.geolocation.getCurrentPosition = forbidden; navigator.geolocation.watchPosition = forbidden; }
    const PC = RTCPeerConnection;
    window.RTCPeerConnection = class extends PC {
      constructor(...args) { super(...args); this.__pairingRemoteState = 'not-attempted'; window.__pairingPCs.push(this); this.addEventListener('datachannel', event => window.__pairingChannels.push(event.channel)); }
      createDataChannel(...args) { const channel = super.createDataChannel(...args); window.__pairingChannels.push(channel); return channel; }
      async setRemoteDescription(...args) {
        this.__pairingRemoteState = 'pending';
        try { const value = await super.setRemoteDescription(...args); this.__pairingRemoteState = 'accepted'; return value; }
        catch (error) { this.__pairingRemoteState = 'rejected'; this.__pairingRemoteError = String(error); throw error; }
      }
    };
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...rest) {
      if (['create_challenge','create_location_request','create_evidence_session_request','create_audio_request'].includes(message?.method)) {
        window.__pairingChallenges++; throw new Error('Challenge creation is forbidden in connectivity preflight.');
      }
      return post.call(this, message, ...rest);
    };
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4173');
  await page.locator('#camera-live-panel > summary').click();
  await page.locator('#camera-live-requester').fill('Computer connectivity preflight');
  await page.locator('#camera-live-task').fill('Connection check only. Do not allow or capture a photo.');
  await page.locator('#camera-live-operator-pin').fill(pin);
  await page.locator('#camera-live-create').click();
  await page.waitForFunction(() => document.getElementById('camera-live-offer-out').value.length > 0);
  const offerText = await page.locator('#camera-live-offer-out').inputValue(), offer = JSON.parse(offerText);
  await writeFile(resolve(output, 'offer.json'), offerText, {flag:'wx'});
  Object.assign(result, {pairing_id:offer.pairing_id, requester_pin:offer.requester_pin, operator_pin:pin,
    operator_pin_source:pinSource, offer_sha256:digest(offerText), offer_bytes:Buffer.byteLength(offerText)});
  await writeFile(resolve(output, 'ready.json'), JSON.stringify({...result, status:'waiting-for-answer', answer_path:resolve(output, 'answer.json'),
    stop_path:resolve(output, 'STOP'), maximum_wait_seconds:selfTest ? 30 : 480}, null, 2), {flag:'wx'});
  console.log(JSON.stringify({ready:true, directory:output, requester_pin:offer.requester_pin, pairing_id:offer.pairing_id}));
  let answerText;
  if (selfTest) {
    operator = await context.newPage();
    await operator.goto('http://127.0.0.1:4173');
    answerText = await operator.evaluate(async offer => {
      const {CameraSession} = await import('./camera-session.js');
      window.__operator = new CameraSession({role:'operator', engine:{}, requesterPin:offer.requester_pin,
        operatorPin:offer.operator_pin, pairingId:offer.pairing_id, hints:offer.hints,
        getOperatorPin:async () => offer.operator_pin, collect:async () => { throw new Error('No capture in preflight.'); }});
      return JSON.stringify(await window.__operator.join(offer));
    }, offer);
    if (invalidAnswer) answerText = JSON.stringify({...JSON.parse(answerText), pairing_id:'0'.repeat(64)});
    await writeFile(resolve(output, 'answer.json'), answerText, {flag:'wx'});
  } else {
    const deadline = Date.now() + 480000;
    while (!answerText) {
      if (stopped || await stat(resolve(output, 'STOP')).then(() => true, () => false)) throw new Error('Preflight cancelled before answer.');
      if (Date.now() >= deadline) throw new Error('No answer within the bounded pre-challenge wait.');
      const info = await stat(resolve(output, 'answer.json')).catch(() => null);
      if (info) {
        if (!info.isFile() || info.size < 1 || info.size > 120000) throw new Error('Invalid bounded answer file.');
        answerText = await readFile(resolve(output, 'answer.json'), 'utf8');
        if (Buffer.byteLength(answerText) > 120000) throw new Error('Answer grew beyond its limit.');
      } else await pause(250);
    }
  }
  result.answer_sha256 = digest(answerText);
  await page.locator('#camera-live-answer-in').fill(answerText);
  await page.locator('#camera-live-connect').click();
  const deadline = Date.now() + 25000;
  while (!await page.evaluate(() => window.__pairingPCs.some(pc => pc.connectionState === 'connected') && window.__pairingChannels.some(channel => channel.readyState === 'open'))) {
    if (stopped || Date.now() >= deadline) break;
    if (await page.evaluate(() => ['closed','failed'].includes(window.__pairingPCs.at(-1)?.connectionState) || window.__pairingPCs.at(-1)?.__pairingRemoteState === 'rejected')) break;
    await pause(100);
  }
  result.connection = await page.evaluate(async () => {
    const pc = window.__pairingPCs.at(-1), stats = pc ? [...(await pc.getStats()).values()] : [];
    return {connection_state:pc?.connectionState, ice_state:pc?.iceConnectionState, channel_states:window.__pairingChannels.map(channel => channel.readyState),
      remote_description_state:pc?.__pairingRemoteState, remote_description_error:pc?.__pairingRemoteError,
      stats:stats.filter(value => ['candidate-pair','local-candidate','remote-candidate','transport','data-channel'].includes(value.type)),
      sensor_calls:window.__pairingSensorCalls, challenge_calls:window.__pairingChallenges,
      status:document.getElementById('camera-live-status').textContent,
      issue_challenge_disabled:document.getElementById('camera-live-start').disabled};
  });
  assert.equal(result.connection.sensor_calls, 0); assert.equal(result.connection.challenge_calls, 0);
  assert.equal(result.connection.issue_challenge_disabled, true); assert.deepEqual(errors, []);
  result.status = result.connection.remote_description_state !== 'accepted' ? 'signaling-rejected'
    : result.connection.connection_state === 'connected' && result.connection.channel_states.includes('open') ? 'connected-without-challenge' : 'no-direct-route-observed';
  await page.screenshot({path:resolve(output, 'requester.png'), fullPage:true});
  if (selfTest) assert.equal(result.status, invalidAnswer ? 'signaling-rejected' : 'connected-without-challenge');
} catch (error) {
  result.status = 'failed-or-cancelled'; result.error = String(error.stack || error); process.exitCode = 1;
} finally {
  if (page && !page.isClosed()) await page.locator('#camera-live-cancel').click({timeout:2000}).catch(() => {});
  if (operator && !operator.isClosed()) await operator.evaluate(() => window.__operator?.cancel()).catch(() => {});
  await context?.close(); await browser?.close();
  if (server && server.exitCode === null) { const done = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await done; }
  result.closed_at_utc = new Date().toISOString(); result.browser_closed = true; result.preview_stopped = true;
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2), {flag:'wx'});
  await writeFile(resolve(output, 'server.log'), serverLog, {flag:'wx'});
  console.log(JSON.stringify({status:result.status, directory:output, error:result.error}));
}
