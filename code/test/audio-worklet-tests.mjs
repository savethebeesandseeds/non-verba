// SPDX-License-Identifier: AGPL-3.0-only
// Deterministic render-quantum tests; browser integration separately exercises
// actual AudioWorklet scheduling and acoustic challenge verification.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source = await readFile(new URL('../../web/src/audio-worklet.js', import.meta.url), 'utf8');
function fixture() {
  const messages = [];
  const scope = {sampleRate: 48000, currentFrame: 0, Float32Array,
    AudioWorkletProcessor: class { constructor() { this.port = {postMessage: data => messages.push(data)}; } },
    registerProcessor: (_name, type) => { scope.Type = type; }};
  runInNewContext(source, scope);
  const recorder = new scope.Type();
  return {messages, scope, send: data => recorder.port.onmessage({data}),
    quantum: (frame, input = [new Float32Array(128)]) => {
      scope.currentFrame = frame;
      const output = new Float32Array(128).fill(1);
      recorder.process([input], [[output]]);
      assert(output.every(value => value === 0), 'Recorder must never feed the reference signal into its output');
    }};
}
function prime(f, start = 0) {
  f.send({type: 'prime'});
  for (let n = 0; n < 94; n++) f.quantum(start + n * 128);
  assert.equal(f.messages.filter(m => m.type === 'ready').length, 1);
  assert(!f.messages.some(m => ['started', 'chunk', 'done'].includes(m.type)));
  return start + 94 * 128;
}

{
  const f = fixture(); f.send({type: 'start', chunks: 1});
  assert.equal(f.messages[0].type, 'error');
  f.quantum(0); assert(!f.messages.some(m => m.type === 'started'));
}
{
  const f = fixture(); f.send({type: 'prime'});
  for (let n = 0; n < 93; n++) f.quantum(n * 128);
  assert.equal(f.messages.length, 0);
  f.quantum(94 * 128); // A gap resets the entire stability interval.
  for (let n = 1; n < 93; n++) f.quantum((94 + n) * 128);
  assert.equal(f.messages.length, 0);
  f.quantum((94 + 93) * 128);
  assert.deepEqual(f.messages.map(m => m.type), ['ready']);
}
{
  const f = fixture(); f.send({type: 'prime'});
  for (let n = 0; n < 93; n++) f.quantum(n * 128);
  f.quantum(93 * 128, []);
  for (let n = 0; n < 93; n++) f.quantum((94 + n) * 128);
  assert.equal(f.messages.length, 0);
  f.quantum(187 * 128);
  assert.equal(f.messages[0].type, 'ready');
}
{
  const f = fixture(), start = prime(f);
  f.send({type: 'start', chunks: 1}); f.quantum(start);
  f.quantum(start + 256); // A gap AFTER recording begins remains fatal.
  assert.equal(f.messages.at(-1).type, 'error');
  assert.match(f.messages.at(-1).message, /interrupted/);
  for (let n = 0; n < 1000; n++) f.quantum(start + 384 + n * 128);
  assert(!f.messages.some(m => m.type === 'chunk'));
}
{
  const f = fixture(), start = prime(f);
  f.send({type: 'start', chunks: 1});
  for (let n = 0; n < 750; n++) f.quantum(start + n * 128);
  assert.deepEqual(f.messages.map(m => m.type), ['ready', 'started', 'chunk', 'done']);
  assert.equal(f.messages[2].samples.length, 96000);
  assert.equal(f.messages[3].samples, 96000);
}
{
  const f = fixture(); f.send({type: 'prime'}); f.quantum(0);
  f.send({type: 'stop'});
  for (let n = 1; n < 100; n++) f.quantum(n * 128);
  assert.equal(f.messages.length, 0);
  f.send({type: 'start', chunks: 1}); assert.equal(f.messages.at(-1).type, 'error');
}
console.log('PASS 6 recorder priming and strict capture-continuity checks');
