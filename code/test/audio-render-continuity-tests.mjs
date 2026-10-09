// SPDX-License-Identifier: AGPL-3.0-only
// Explicit, bounded Chromium characterization of the production recorder's
// render-frame guard. Synthetic input and a null sink: no physical audio I/O,
// WASM, signing, WAV/receipt, screenshots, or acceptance claims.
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const code = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const capture = await readFile(resolve(code, '../web/src/audio-capture.js'));
const recorder = await readFile(resolve(code, '../web/src/audio-worklet.js'));
const reportPath = resolve(process.env.NONVERBA_AUDIO_RENDER_REPORT || resolve(code, 'artifacts/qa/audio-render-continuity.json'));
// Reproduce the exact retained 6 October quantum sequence deterministically.
// It must retain the first whole chunk, reject the duplicated frame, and never
// emit a second completed chunk or repair/discard the offending samples.
const quantumMessages = [], scope = {sampleRate: 48000, currentFrame: 0, Float32Array,
  AudioWorkletProcessor: class { constructor() { this.port = {postMessage: data => quantumMessages.push(data)}; } },
  registerProcessor: (name, type) => { if (name === 'nonverba-recorder') scope.Type = type; }};
runInNewContext(recorder.toString(), scope);
const processor = new scope.Type(), quantum = frame => {
  scope.currentFrame = frame;
  const output = new Float32Array(128).fill(1);
  processor.process([[new Float32Array(128)]], [[output]]);
  assert(output.every(sample => sample === 0));
};
processor.port.onmessage({data: {type: 'prime'}});
for (let frame = 0; frame < 12032; frame += 128) quantum(frame);
processor.port.onmessage({data: {type: 'start', chunks: 2}});
for (let frame = 114560; frame <= 249600; frame += 128) quantum(frame);
quantum(249600);
const duplicate = quantumMessages.at(-1);
assert.equal(duplicate.type, 'error');
assert.equal(duplicate.frame, 249600); assert.equal(duplicate.expected_frame, 249728);
assert.equal(duplicate.input_samples, 128); assert.equal(duplicate.channels, 1);
for (let frame = 249728; frame < 320000; frame += 128) quantum(frame);
assert.equal(quantumMessages.filter(message => message.type === 'chunk').length, 1);
assert(!quantumMessages.some(message => message.type === 'done'));
console.log('PASS exact repeated-frame regression: retained first chunk, refused completion');
const server = http.createServer((req, res) => {
  const body = req.url === '/audio-capture.js' ? capture : req.url === '/audio-worklet.js' ? recorder : req.url === '/' ? '<!doctype html><title>Silent render continuity fixture</title>' : null;
  res.writeHead(body ? 200 : 404, {'Content-Type': req.url?.endsWith('.js') ? 'text/javascript' : 'text/html', 'Cache-Control': 'no-store'});
  res.end(body);
});
await new Promise((ready, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', ready); });
let browser;
const results = [];
let runError = null;
let productionRefusals = 0;
try {
  browser = await chromium.launch({headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
    ...(process.env.NONVERBA_BROWSER_EXECUTABLE ? {executablePath: process.env.NONVERBA_BROWSER_EXECUTABLE} : {})});
  for (const mode of ['steady-graph', 'production-playback', 'production-playback-repeat-1', 'production-playback-repeat-2', 'graph-mutation-stress']) {
    if (productionRefusals >= 2) {
      results.push({mode, skipped: 'Two production playback attempts refused; diagnose before further runtime retries.'});
      continue;
    }
    const context = await browser.newContext();
    const page = await context.newPage();
    const uncaught = [];
    page.on('pageerror', error => uncaught.push(String(error)));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const result = await page.evaluate(async mode => {
        const productionPlayback = mode.startsWith('production-playback');
        const events = [], failures = [], contexts = [], tracks = [], destinations = new WeakMap(), closures = new WeakMap();
        const OriginalContext = window.AudioContext, OriginalWorklet = window.AudioWorkletNode;
        window.AudioContext = class extends OriginalContext {
          constructor(options) { super({...options, sinkId: {type: 'none'}}); contexts.push(this); }
          close() {
            const pending = super.close(), observation = {settled: false, error: null}; closures.set(this, observation);
            pending.then(() => { observation.settled = true; }, error => { observation.settled = true; observation.error = String(error); });
            return pending;
          }
        };
        window.AudioWorkletNode = class extends OriginalWorklet {
          constructor(...args) {
            super(...args);
            this.port.addEventListener('message', ({data}) => events.push({type: data.type, frame: data.frame, expected_frame: data.expected_frame,
              input_samples: data.input_samples, channels: data.channels, index: data.index, samples: data.samples?.length ?? data.samples, message: data.message}));
          }
        };
        navigator.mediaDevices.getUserMedia = async () => {
          const context = contexts.at(-1), destination = context.createMediaStreamDestination();
          destination.channelCount = 1; destination.channelCountMode = 'explicit'; destinations.set(context, destination);
          const ambient = context.createOscillator(), gain = context.createGain();
          ambient.frequency.value = 220; gain.gain.value = 0.006; ambient.connect(gain); gain.connect(destination); ambient.start();
          for (const track of destination.stream.getAudioTracks()) {
            const original = track.getSettings.bind(track);
            track.getSettings = () => ({...original(), sampleRate: 48000, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false});
            tracks.push(track);
          }
          await new Promise(resolve => setTimeout(resolve, 100));
          return destination.stream;
        };
        const connect = AudioBufferSourceNode.prototype.connect;
        AudioBufferSourceNode.prototype.connect = function(destination, ...args) {
          if (destination === this.context.destination) connect.call(this, destinations.get(this.context));
          return connect.call(this, destination, ...args);
        };
        const {AudioCapture} = await import('/audio-capture.js');
        let recording, stressTimer, timeout, stressNodes = 0, recordedSamples = 0;
        const signal = Float32Array.from({length: 36864}, (_, index) => 0.05 * Math.sin(2 * Math.PI * 20250 * index / 48000));
        recording = new AudioCapture(error => { failures.push(String(error)); recording.close(); });
        let completionError = null;
        try {
          await recording.open();
          await recording.record(2, (_index, samples) => {
            recordedSamples += samples.length;
            if (productionPlayback && recordedSamples === 96000) recording.play(signal);
          });
          if (productionPlayback) recording.play(signal);
          if (mode === 'graph-mutation-stress') {
            const context = recording.context, buffer = context.createBuffer(1, 128, 48000);
            // Deliberately excessive main-thread graph edits exercise graph-lock
            // contention. They are not a simulation of normal requester load.
            stressTimer = setInterval(() => {
              for (let n = 0; n < 200 && !recording.closed; n++) {
                const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); source.start(); source.disconnect(); stressNodes++;
              }
            }, 20);
          }
          await Promise.race([recording.finished, new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Bounded fixture deadline exceeded')), 6500); })]);
        } catch (error) { completionError = String(error); }
        finally {
          clearInterval(stressTimer); clearTimeout(timeout); recording.close();
          // Observe production-owned teardown; do not repair a missing close.
          for (let n = 0; n < 100 && contexts.some(context => !closures.get(context)?.settled); n++) await new Promise(resolve => setTimeout(resolve, 10));
        }
        return {mode, events, failures, completion_error: completionError, recorded_samples: recordedSamples, stress_nodes: stressNodes,
          contexts_closed: contexts.every(context => context.state === 'closed' && closures.get(context)?.settled && closures.get(context)?.error === null),
          tracks_ended: tracks.every(track => track.readyState === 'ended')};
      }, mode);
      results.push({...result, uncaught});
      assert.equal(result.contexts_closed, true, `${mode}: context teardown`);
      assert.equal(result.tracks_ended, true, `${mode}: stream teardown`);
      assert.deepEqual(uncaught, []);
      const interrupted = result.events.find(event => event.type === 'error');
      if (interrupted) {
        if (mode.startsWith('production-playback')) productionRefusals++;
        assert.match(interrupted.message, /interrupted/);
        assert(!result.events.some(event => event.type === 'done'), 'Interrupted input must never complete');
        assert(result.completion_error, 'Interrupted completion remains rejected');
        console.log(`OBSERVED ${mode}: refused frame ${interrupted.frame}, expected ${interrupted.expected_frame}`);
      } else {
        assert.equal(result.completion_error, null, `${mode}: ${result.completion_error}`);
        assert.equal(result.recorded_samples, 192000);
        assert.equal(result.events.at(-1).type, 'done');
        console.log(`OBSERVED ${mode}: 192000 consecutive samples completed`);
      }
    } finally { await context.close(); }
  }
} catch (error) { runError = String(error); throw error; }
finally {
  try {
    await mkdir(dirname(reportPath), {recursive: true});
    await writeFile(reportPath, JSON.stringify({browser: browser?.version() ?? null, synthetic_input: true, null_audio_output_sink: true, physical_device_tested: false,
      exact_repeated_frame_regression: 'passed', purpose: 'Characterization only: a completed synthetic recording is not a signed artifact or physical acceptance.', results, run_error: runError}, null, 2));
  } finally {
    try { await browser?.close(); }
    finally { await new Promise(resolve => server.close(resolve)); }
  }
}
