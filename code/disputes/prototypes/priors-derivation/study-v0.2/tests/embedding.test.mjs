// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PINNED_MODEL, embeddingWindows, planWindowBatches, normalizeFloat32, embeddingCacheKey, createBatchEmbedder } from '../lib/embedding.mjs';

const wordTokens = text => (text.match(/\S+/gu) || []).length + 2;
function mockRuntime() {
  const calls = [];
  return { calls, model: { synthetic_runtime_id: 'positive-axis-window-fixture', execution_attested: false }, tokenCount: wordTokens,
    extractBatch: async texts => { calls.push(texts); return texts.map(text => text.startsWith('alpha') ? [1, 0] : [0, 1]); }, dispose: async () => {} };
}
async function cacheFixture(t) { const directory = await mkdtemp(path.join(os.tmpdir(), 'priors-embedding-test-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }
const norm = vector => Math.sqrt([...vector].reduce((sum, value) => sum + value ** 2, 0));

test('measured complete-word windows cover every word and weight new words once', () => {
  const words = Array.from({ length: 17 }, (_, index) => `word${index}`);
  const windows = embeddingWindows(words.join('\n '), wordTokens, { maxTokens: 8, overlapWords: 2 });
  const covered = new Set();
  for (const window of windows) {
    assert.ok(window.tokens <= 8); assert.equal(window.tokens, wordTokens(window.text));
    for (let index = window.word_start; index < window.word_end; index++) covered.add(index);
    assert.equal(window.text, words.slice(window.word_start, window.word_end).join(' '));
    assert.ok(window.weight > 0);
  }
  assert.equal(covered.size, words.length); assert.equal(windows.reduce((sum, window) => sum + window.weight, 0), words.length);
  assert.throws(() => embeddingWindows('x'.repeat(300), text => text.length + 2), /complete source word exceeds/);
  assert.throws(() => embeddingWindows('   ', wordTokens), /contain text/);
});

test('bucketed batches bound padded tokens and preserve every measured window', () => {
  const windows = [3, 8, 4, 6, 5].map((tokens, index) => ({ tokens, text: `window-${index}` }));
  const batches = planWindowBatches(windows, { tokenBudget: 12, maxBatchWindows: 4, bucketWidth: 8 });
  for (const batch of batches) { assert.ok(batch.padded_tokens <= 12); assert.ok(batch.actual_input_tokens <= batch.padded_tokens); assert.ok(batch.windows.length <= 4); }
  assert.deepEqual(batches.flatMap(batch => batch.windows.map(window => window.original_index)).sort((a, b) => a - b), [0, 1, 2, 3, 4]);
  assert.ok(batches.length >= 3, 'Adding unpadded counts alone would violate the padded model-call budget.');
  assert.throws(() => planWindowBatches([{ tokens: 20 }], { tokenBudget: 8 }), /cannot hold/);
});
test('overlong CJK segments preserve every literal codepoint and UTF16 offset without tail truncation',()=>{
  const text='甲乙丙丁𠀀'.repeat(65);const count=value=>Array.from(value).length+2;
  const windows=embeddingWindows(text,count,{maxTokens:256,overlapWords:16});const covered=new Set();
  for(const window of windows){assert.equal(window.text,text.slice(window.source_utf16_start,window.source_utf16_end));assert.ok(window.tokens<=256);assert.equal(window.weight_unit,'new_source_codepoints');for(let i=window.source_character_start;i<window.source_character_end;i++)covered.add(i);}
  assert.equal(covered.size,Array.from(text).length);assert.equal(windows.reduce((sum,w)=>sum+w.weight,0),Array.from(text).length);
});

test('cross-unit batching aggregates weighted windows and returns original ordered Float32 units', async () => {
  const runtime = mockRuntime(); const embedder = await createBatchEmbedder({ dimensions: 2, max_tokens: 8, overlap_words: 2, token_budget: 24, max_batch_windows: 3 }, { runtime });
  const units = [{ id: 'long', text: 'alpha b c d e f g h i j' }, { id: 'short', text: 'beta only' }, { id: 'repeat', text: 'alpha b c d e f g h i j' }];
  const progress = []; const result = await embedder.embedUnits(units, { onBatch: info => { progress.push(info); } });
  assert.deepEqual(result.unit_ids, ['long', 'short', 'repeat']); assert.equal(result.packed_vectors.length, 6);
  assert.ok(result.vectors.every(vector => vector instanceof Float32Array && Math.abs(norm(vector) - 1) < 1e-6));
  const expected = normalizeFloat32([0.6, 0.4]); assert.ok(Math.abs(result.vectors[0][0] - expected[0]) < 1e-6); assert.ok(Math.abs(result.vectors[0][1] - expected[1]) < 1e-6);
  assert.deepEqual([...result.vectors[1]], [0, 1]); assert.deepEqual([...result.vectors[2]], [...result.vectors[0]]); assert.notEqual(result.vectors[0], result.vectors[2]);
  assert.equal(result.cache_stats.repeated_inputs_reused, 1); assert.equal(result.cache_stats.unique_inputs_embedded, 2);
  assert.ok(progress.every(info => info.padded_tokens <= 24)); assert.equal(result.inputs[0].windows.reduce((sum, window) => sum + window.weight, 0), 10);
  assert.ok(runtime.calls.some(texts => texts.includes('beta only') && texts.some(text => text.startsWith('alpha'))), 'A model call should batch windows from different source units.');
  assert.equal(result.provenance.synthetic_runtime, true); assert.equal(result.provenance.model.execution_attested, false);
  await embedder.dispose(); await assert.rejects(embedder.embedUnits(units), /disposed/);
});

test('per-input atomic manifests verify resume, ordering, policy identity and corruption', async t => {
  const cacheDir = await cacheFixture(t); const runtime = mockRuntime();
  const config = { dimensions: 2, cache_dir: cacheDir, max_tokens: 8, overlap_words: 2 };
  const first = await createBatchEmbedder(config, { runtime });
  const original = await first.embedUnits([{ id: 'a', text: 'alpha beta' }, { id: 'b', text: 'other text' }]);
  assert.equal(original.cache_stats.entries_written, 2); runtime.calls.length = 0;
  const second = await createBatchEmbedder(config, { runtime });
  const resumed = await second.embedUnits([{ id: 'new-b', text: 'other text' }, { id: 'new-a', text: 'alpha beta' }]);
  assert.equal(resumed.cache_stats.hits, 2); assert.equal(runtime.calls.length, 0); assert.deepEqual(resumed.unit_ids, ['new-b', 'new-a']);
  assert.deepEqual([...resumed.vectors[0]], [...original.vectors[1]]);
  const changedPolicy = await createBatchEmbedder({ ...config, overlap_words: 1 }, { runtime });
  assert.notEqual(changedPolicy.window_policy_sha256, first.window_policy_sha256);
  const changed = await changedPolicy.embedUnits([{ id: 'changed', text: 'alpha beta' }]); assert.equal(changed.cache_stats.hits, 0);
  const key = original.inputs[0].cache_key; const file = path.join(cacheDir, key.slice(0, 2), `${key}.json`);
  const entry = JSON.parse(await readFile(file, 'utf8')); entry.vector_base64 = Buffer.alloc(8).toString('base64'); const corrupt = JSON.stringify(entry); await writeFile(file, corrupt);
  await assert.rejects(second.embedUnits([{ id: 'corrupt', text: 'alpha beta' }]), /identity or integrity mismatch/);
  assert.equal(await readFile(file, 'utf8'), corrupt, 'Corruption must be preserved and reported, not overwritten.');
  for (const bucket of await readdir(cacheDir)) assert.ok((await readdir(path.join(cacheDir, bucket))).every(name => !name.includes('.tmp-')));
  await first.dispose(); await second.dispose(); await changedPolicy.dispose();
});

test('aborted chunks retain completed cache entries and resume only remaining inputs', async t => {
  const cacheDir = await cacheFixture(t); const runtime = mockRuntime();
  const embedder = await createBatchEmbedder({ dimensions: 2, cache_dir: cacheDir, max_batch_windows: 1 }, { runtime });
  const units = [{ id: 'a', text: 'alpha first' }, { id: 'b', text: 'beta second' }]; const controller = new AbortController();
  await assert.rejects(embedder.embedUnits(units, { signal: controller.signal, onBatch: () => controller.abort(new Error('synthetic interruption')) }), /synthetic interruption/);
  assert.equal(runtime.calls.length, 1);
  const resumed = await embedder.embedUnits(units); assert.equal(resumed.cache_stats.hits, 1); assert.equal(runtime.calls.length, 2); assert.equal(resumed.vectors.length, 2);
  await embedder.dispose();
});

test('bounds, model identity and invalid runtime values fail explicitly', async () => {
  const runtime = mockRuntime(); const embedder = await createBatchEmbedder({ dimensions: 2 }, { runtime });
  await assert.rejects(embedder.embedUnits(Array.from({ length: 501 }, (_, index) => ({ id: `u-${index}`, text: 'synthetic' }))), /at most 500/);
  await assert.rejects(embedder.embedUnits([{ id: 'same', text: 'one' }, { id: 'same', text: 'two' }]), /unique nonempty/);
  runtime.extractBatch = async texts => texts.map(() => [NaN, 1]); await assert.rejects(embedder.embedUnits([{ id: 'bad', text: 'synthetic' }]), /Non-finite/);
  const h = createHash('sha256').update('synthetic').digest('hex');
  assert.notEqual(embeddingCacheKey(h, PINNED_MODEL.revision, 'a'.repeat(64)), embeddingCacheKey(h, PINNED_MODEL.revision, 'b'.repeat(64)));
  await assert.rejects(createBatchEmbedder({ dimensions: 2, cache_dir: '/etc/should-not-be-created' }, { runtime }), /managed study\/cache namespace/);
  await embedder.dispose();
});

test('existing pinned MiniLM tokenizer and CPU model smoke, explicit opt-in', { skip: process.env.NONVERBA_EMBEDDING_SMOKE !== '1' ? 'Set NONVERBA_EMBEDDING_SMOKE=1 inside the managed container to verify existing model inference; no downloads.' : false }, async () => {
  const embedder = await createBatchEmbedder({ token_budget: 1024, max_batch_windows: 4 });
  try {
    const result = await embedder.embedUnits([{ id: 'short', text: 'The parties shall give written notice before changing the agreed task.' }, { id: 'long', text: Array.from({ length: 400 }, (_, index) => `obligation${index}`).join(' ') }]);
    assert.equal(result.dimensions, 384); assert.equal(result.vectors.length, 2); assert.ok(result.inputs[1].windows.length > 1);
    for (const input of result.inputs) for (const window of input.windows) assert.ok(window.tokens <= 256);
    assert.equal(result.inputs[1].windows.reduce((sum, window) => sum + window.weight, 0), 400);
    assert.equal(result.provenance.model.downloads_attempted, 0); assert.equal(result.provenance.model.execution_attested, false); assert.equal(result.provenance.model.verification_status, 'VERIFIED_EXISTING_PINNED_ARTIFACTS');
  } finally { await embedder.dispose(); }
});
