// SPDX-License-Identifier: AGPL-3.0-only
// Real pinned model metadata/packaging tests; run only in the managed container.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CACHE_PATH, inspectOnnx, inlineExternalData, retargetYuNet320,
  assertGraphContract, verifyModelCache } from '../tools/prepare-face-model.mjs';
import { MOBILE_FACE_SPEC } from '../../web/src/face-model-spec.js';

const lock = JSON.parse(await readFile(new URL('../models/mobilefacenet/model-lock.json', import.meta.url), 'utf8'));
const read = (file) => readFile(`${CACHE_PATH}/${file}`);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('selected real cache and browser descriptors match the pinned source profile', async () => {
  assert.deepEqual(lock.profile, MOBILE_FACE_SPEC);
  const result = await verifyModelCache(CACHE_PATH, lock);
  assert.equal(result.checkpointSha256, MOBILE_FACE_SPEC.checkpoint_sha256);
  assert.equal(result.encoderSha256, MOBILE_FACE_SPEC.artifact_sha256);
  for (const asset of [...Object.values(lock.browser_assets), ...lock.browser_notices]) {
    const entry = lock.files.find((item) => item.file === asset.cache_file);
    assert.ok(entry);
    assert.equal(entry.bytes, asset.bytes);
    assert.equal(entry.sha256, asset.sha256);
    assert.ok(!asset.file.includes('/'));
  }
});

test('publisher external encoder packs deterministically without altering its interface', async () => {
  const source = await read('publisher/mobile_facenet.onnx');
  const weights = await read('publisher/mobile_facenet.data');
  assert.throws(() => inspectOnnx(source), /External ONNX/);
  const packed = inlineExternalData(source, weights);
  assert.equal(sha(packed), lock.encoder.sha256);
  assert.deepEqual(packed, await read(lock.encoder.file));
  assertGraphContract(inspectOnnx(packed), lock.encoder.graph);
  assert.deepEqual(inspectOnnx(source, { allowExternal: true }).operations, inspectOnnx(packed).operations);
  assert.throws(() => inlineExternalData(source, weights, 'unselected.data'), /Unexpected external tensor source/);
  assert.throws(() => inlineExternalData(source, weights.subarray(0, 1)), /outside pinned data/);
});

test('original fixed640 detector retargets only to the pinned320 interface', async () => {
  const source = await read('face_detection_yunet_2023mar.onnx');
  const converted = retargetYuNet320(source);
  assert.equal(sha(converted), lock.detector.sha256);
  assert.deepEqual(converted, await read(lock.detector.file));
  assertGraphContract(inspectOnnx(converted), lock.detector.graph);
  assert.deepEqual(inspectOnnx(source).operations, inspectOnnx(converted).operations);
  assert.equal(inspectOnnx(source).initializerCount, inspectOnnx(converted).initializerCount);
  assert.throws(() => retargetYuNet320(converted), /Unexpected original YuNet interface/);
});
