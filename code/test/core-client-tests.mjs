// SPDX-License-Identifier: AGPL-3.0-only
// Worker transport and lifecycle only; no WASM, sensors or browser implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoreClient} from '../../web/src/core-client.js';

function fixture() {
  let worker;
  class Worker {
    sent = []; terminated = 0;
    constructor() { worker = this; }
    postMessage(value) { if (this.sendError) throw this.sendError; this.sent.push(value); }
    terminate() { this.terminated++; }
    message(data) { this.onmessage({data}); }
  }
  const client = createCoreClient({Worker});
  return {client, worker};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('concurrent replies are correlated and JSON decoding stays at the boundary', async () => {
  const {client, worker} = fixture();
  const first = client.call('first', 1), second = client.json('second', 2);
  assert.equal(worker.sent.length, 0);
  worker.message({ready: true}); await tick();
  assert.deepEqual(worker.sent.map(({method, args}) => [method, args]), [['first', [1]], ['second', [2]]]);
  worker.message({id: worker.sent[1].id, value: '{"verified":true}'});
  worker.message({id: worker.sent[0].id, value: 'first result'});
  assert.equal(await first, 'first result'); assert.deepEqual(await second, {verified: true});
  client.close();
});

test('startup failure rejects waiting and future calls without dispatch', async () => {
  const {client, worker} = fixture();
  const waiting = assert.rejects(client.call('waiting'), /startup failed/);
  const ready = assert.rejects(client.ready, /startup failed/);
  worker.message({fatal: 'startup failed'});
  await Promise.all([waiting, ready]);
  worker.message({ready: true});
  await assert.rejects(client.call('future'), /startup failed/);
  assert.equal(worker.sent.length, 0); assert.equal(worker.terminated, 1);
});

for (const failure of ['fatal', 'error', 'messageerror']) {
  test(`${failure} after readiness rejects current and future calls`, async () => {
    const {client, worker} = fixture(); worker.message({ready: true}); await client.ready;
    const waiting = assert.rejects(client.call('waiting'), /engine|failed/);
    await tick();
    if (failure === 'fatal') worker.message({fatal: 'engine failed'});
    else worker[`on${failure}`]({});
    await waiting;
    worker.message({id: worker.sent[0].id, value: 'late success'});
    await assert.rejects(client.call('future'), /engine|failed/);
    client.close(); assert.equal(worker.terminated, 1); assert.equal(worker.sent.length, 1);
  });
}

test('individual operation errors leave the worker usable', async () => {
  const {client, worker} = fixture(); worker.message({ready: true});
  const failed = assert.rejects(client.call('invalid'), /invalid request/); await tick();
  worker.message({id: worker.sent[0].id, error: 'invalid request'}); await failed;
  const valid = client.call('valid'); await tick();
  worker.message({id: worker.sent[1].id, value: 42}); assert.equal(await valid, 42);
  assert.equal(worker.terminated, 0); client.close();
});

test('postMessage failure rejects only that call and late replies cannot settle another', async () => {
  const {client, worker} = fixture(); worker.message({ready: true});
  worker.sendError = new DOMException('Cannot clone argument', 'DataCloneError');
  await assert.rejects(client.call('uncloneable'), {name: 'DataCloneError'});
  worker.sendError = null;
  const valid = client.call('valid'); await tick();
  worker.message({id: 1, value: 'reply to failed send'});
  worker.message({id: worker.sent[0].id, value: 'correct'});
  assert.equal(await valid, 'correct'); client.close();
});

test('close is terminal even when readiness resolves before a queued call dispatches', async () => {
  const {client, worker} = fixture();
  const waiting = assert.rejects(client.call('waiting'), /closed/);
  worker.message({ready: true}); client.close(); client.close();
  await waiting; await assert.rejects(client.call('future'), /closed/);
  assert.equal(worker.sent.length, 0); assert.equal(worker.terminated, 1);
});

test('close before readiness settles every waiting operation', async () => {
  const {client, worker} = fixture();
  const ready = assert.rejects(client.ready, /closed/);
  const waiting = assert.rejects(client.call('waiting'), /closed/);
  client.close(); worker.message({ready: true});
  await Promise.all([ready, waiting]); assert.equal(worker.terminated, 1);
});
