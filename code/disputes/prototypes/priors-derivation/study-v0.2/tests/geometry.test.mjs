// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBalancedReservoir, fitMiniBatch, assignVectors, assignBatches, evaluationDigest, comparePartitions, exactSmallComparator, PREDECLARED_GEOMETRY_SCHEDULE } from '../lib/geometry.mjs';

const rowsFor = count => Array.from({ length: count }, (_, index) => ({ id: `unit-${index}`, contract_id: `contract-${index}`, family_id: `family-${index}`, partition: 'fit', text: 'Synthetic geometry unit.' }));
const magnitude = vector => Math.sqrt([...vector].reduce((sum, value) => sum + value ** 2, 0));
const groupedCounts = (rows, key) => { const counts = new Map(); for (const row of rows) counts.set(row[key], (counts.get(row[key]) || 0) + 1); return [...counts.values()]; };

test('fit-only reservoir is bounded, contract/family capped and reproducible for its ordered stream', () => {
  const make = () => createBalancedReservoir({ capacity: 16, perContract: 3, perFamily: 2, dimensions: 2, seed: 11 });
  const left = make(); const right = make();
  for (let index = 0; index < 200; index++) {
    const row = { id: `source-${index}`, contract_id: `contract-${index % 9}`, family_id: `duplicate-${index % 15}`, partition: 'fit' };
    const vector = [1, index % 7 / 10]; left.add(row, vector); right.add(row, vector);
    assert.ok(left.size() <= 16);
  }
  assert.equal(left.add({ id: 'heldout', contract_id: 'heldout-contract', family_id: 'heldout-family', partition: 'holdout' }, [-1, 0]), false);
  const a = left.snapshot(); const b = right.snapshot();
  assert.ok(a.rows.length <= 16 && a.rows.length > 0); assert.ok(groupedCounts(a.rows, 'contract_id').every(count => count <= 3)); assert.ok(groupedCounts(a.rows, 'family_id').every(count => count <= 2));
  assert.ok(a.rows.every(row => row.partition === 'fit')); assert.deepEqual(a.rows, b.rows); assert.deepEqual([...a.vectors], [...b.vectors]);
  assert.equal(a.statistics.skipped_partition, 1); assert.equal(a.statistics.ordered_unit_ids_sha256, evaluationDigest(a.rows));
  assert.ok(a.statistics.evicted > 0, 'The indexed bounded heap should support repeated replacement without growth.');
});

test('reservoir streaming packs vectors without dropping dimensions or admitting heldout rows', () => {
  const reservoir = createBalancedReservoir({ capacity: 4, perContract: 2, perFamily: 1, dimensions: 2 });
  const rows = [{ id: 'a', contract_id: 'c1', family_id: 'f1', partition: 'fit' }, { id: 'b', contract_id: 'c2', family_id: 'f2', partition: 'fit' }, { id: 'h', contract_id: 'c3', family_id: 'f3', partition: 'holdout' }];
  assert.equal(reservoir.addBatch(rows, Float32Array.from([3, 4, 0, 2, -1, 0])), 2);
  const result = reservoir.snapshot(); assert.equal(result.rows.length, 2); assert.equal(result.vectors.length, 4);
  for (let index = 0; index < 2; index++) assert.ok(Math.abs(magnitude(result.vectors.subarray(index * 2, (index + 1) * 2)) - 1) < 1e-6);
  assert.throws(() => reservoir.add(result.rows[0], [1, 0]), /Duplicate retained/);
});

test('spherical minibatches retain separated directions and replay exactly in the same runtime', () => {
  const rows = rowsFor(6); const vectors = [[1, 0.01], [1, -0.02], [0.99, 0.1], [-1, 0.01], [-1, -0.03], [-0.99, 0.05]];
  const options = { k: 2, seed: 19, batchSize: 6, iterations: 40 }; const left = fitMiniBatch(rows, vectors, options); const right = fitMiniBatch(rows, vectors, options);
  assert.equal(left.effective_k, 2); assert.equal(left.labels[0], left.labels[1]); assert.equal(left.labels[1], left.labels[2]); assert.equal(left.labels[3], left.labels[4]); assert.equal(left.labels[4], left.labels[5]); assert.notEqual(left.labels[0], left.labels[3]);
  assert.deepEqual([...left.centroids], [...right.centroids]); assert.deepEqual([...left.labels], [...right.labels]); assert.ok(left.centers.every(center => Math.abs(magnitude(center) - 1) < 1e-6));
  assert.equal(left.method.stopping_rule, 'fixed predeclared budget; no convergence claim'); assert.equal(left.method.ordered_training_units_sha256, evaluationDigest(rows));
  assert.equal(left.counts.reduce((sum, count) => sum + count, 0), rows.length);
});

test('weights affect cumulative direction, while unsupported k and zero vectors are disclosed', () => {
  const rows = rowsFor(2); const vectors = [[1, 0], [0, 1]];
  const unweighted = fitMiniBatch(rows, vectors, { k: 1, seed: 7, iterations: 100, batchSize: 2 });
  const weighted = fitMiniBatch(rows, vectors, { k: 1, seed: 7, iterations: 100, batchSize: 2, weights: [10, 1] });
  assert.ok(weighted.centroids[0] > unweighted.centroids[0]); assert.ok(weighted.centroids[0] > 0.95); assert.equal(weighted.method.weighted_updates, true);
  assert.equal(unweighted.method.weights_sha256, null); assert.match(weighted.method.weights_sha256, /^[a-f0-9]{64}$/); assert.equal(weighted.method.normalized_training_vectors_sha256, unweighted.method.normalized_training_vectors_sha256);
  const identical = fitMiniBatch(rowsFor(3), [[1, 0], [1, 0], [1, 0]], { k: 3, iterations: 3 });
  assert.equal(identical.effective_k, 1); assert.ok(identical.warnings.some(warning => warning.startsWith('REQUESTED_K_REDUCED')));
  assert.throws(() => fitMiniBatch(rows, [[0, 0], [1, 0]], { k: 1 }), /zero norm/);
  assert.throws(() => fitMiniBatch(rows, vectors, { k: 1, weights: [1, -1] }), /finite, positive/);
  assert.throws(() => fitMiniBatch(rows, vectors, { k: 1, weights: [1] }), /align/);
  const huge = fitMiniBatch(rows, [[1e300, 1e300], [1e-300, 1e-300]], { k: 1, iterations: 2 }); assert.ok(Math.abs(magnitude(huge.centroids) - 1) < 1e-6);
});

test('heldout assignment cannot influence centroids and streamed rows keep identity/partition', async () => {
  const rows = rowsFor(4); const model = fitMiniBatch(rows, [[1, 0], [0.9, 0.1], [-1, 0], [-0.9, -0.1]], { k: 2, seed: 3, iterations: 10 });
  const saved = [...model.centroids]; const heldout = [{ id: 'h1', contract_id: 'new-contract', partition: 'holdout' }, { id: 'h2', contract_id: 'newer-contract', partition: 'holdout' }];
  assert.throws(() => fitMiniBatch(heldout, [[1, 0], [-1, 0]], { k: 1 }), /cannot influence/);
  const assigned = assignVectors(heldout, [[1, 0], [-1, 0]], model, { clusterPrefix: 'test' });
  assert.notEqual(assigned[0].label, assigned[1].label); assert.ok(assigned.every(row => row.partition === 'holdout' && row.unit_id.startsWith('h') && row.similarity > 0.9)); assert.deepEqual([...model.centroids], saved);
  async function* source() { yield { rows: heldout.slice(0, 1), vectors: Float32Array.from([1, 0]) }; yield { rows: heldout.slice(1), vectors: Float32Array.from([-1, 0]) }; }
  const streamed = []; for await (const batch of assignBatches(source(), model, { clusterPrefix: 'test' })) streamed.push(...batch.assignments);
  assert.deepEqual(streamed, assigned);
});

test('label-invariant comparison binds the ordered common digest without enumerating pairs', () => {
  const digest = evaluationDigest(rowsFor(6)); const left = { evaluation_sha256: digest, labels: Uint32Array.from([0, 0, 0, 1, 1, 1]) }; const renamed = { evaluation_sha256: digest, labels: Uint32Array.from([9, 9, 9, 4, 4, 4]) };
  const exact = comparePartitions(left, renamed); assert.equal(exact.adjusted_rand, 1); assert.equal(exact.coassignment_agreement, 1); assert.equal(exact.common_count, 6); assert.equal(exact.pair_count, 15); assert.equal(exact.common_ids, undefined);
  const mixed = comparePartitions(left, { evaluation_sha256: digest, labels: Uint32Array.from([0, 1, 0, 1, 0, 1]) }); assert.ok(mixed.adjusted_rand < 0.5);
  assert.throws(() => comparePartitions(left, { ...renamed, evaluation_sha256: evaluationDigest([...rowsFor(6)].reverse()) }), /same ordered/);
  assert.throws(() => evaluationDigest(['same', 'same']), /unique ordered/);
});

test('bounded exact comparator preserves v0.1 behavior and predeclared schedule is explicit', () => {
  const rows = rowsFor(4); const result = exactSmallComparator(rows, [[1, 0], [0.9, 0.1], [-1, 0], [-0.9, -0.1]], { kValues: [2], repeats: 1, seed: 7, silhouetteSampleSize: 4 });
  assert.equal(result.subset_count, 4); assert.equal(result.result.runs.length, 1); assert.equal(result.result.runs[0].effective_k, 2);
  assert.equal(result.evaluation_sha256, evaluationDigest(rows));
  assert.throws(() => exactSmallComparator(rows, [[1, 0], [1, 0], [-1, 0], [-1, 0]], { maximumRows: 3 }), /explicitly bounded/);
  assert.deepEqual(PREDECLARED_GEOMETRY_SCHEDULE.k_values, [32, 64, 128, 256]); assert.equal(PREDECLARED_GEOMETRY_SCHEDULE.seeds.length, 5);
});
