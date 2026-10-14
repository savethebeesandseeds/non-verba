// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { discover, compareAssignments } from '../lib/discover.mjs';

const clauses = Array.from({ length: 8 }, (_, index) => ({ id: `unit-${index}`, contract_id: `contract-${index}`,
  heading: index < 4 ? 'Performance' : 'Remediation',
  text: index < 4 ? 'The delivered benefit and agreed performance.' : 'A reasonable opportunity to correct the deficiency.' }));
const vectors = [[1, 0], [1, 0.03], [1, -0.03], [1, 0.01], [0, 1], [0.03, 1], [-0.03, 1], [0.01, 1]];
const settings = { kValues: [2], seed: 42, repeats: 3 };

test('spherical geometry groups separated directions, records diagnostics and repeats', () => {
  const result = discover(clauses, vectors, settings);
  assert.equal(result.status, 'HYPOTHESES_GENERATED');
  assert.equal(result.runs.length, 3);
  for (const run of result.runs) {
    assert.equal(run.effective_k, 2);
    assert.equal(run.converged, true);
    const groups = run.clusters.map(cluster => cluster.member_ids).sort((left, right) => left[0].localeCompare(right[0]));
    assert.deepEqual(groups, [clauses.slice(0, 4).map(clause => clause.id), clauses.slice(4).map(clause => clause.id)]);
    assert.ok(run.metrics.silhouette.value > 0.99);
    assert.ok(run.metrics.average_similarity > 0.99);
    assert.equal(run.metrics.outlier_count, 0);
  }
  assert.equal(result.stability.within_setting[0].average_adjusted_rand, 1);
});

test('seeded replay and clause/vector pair permutation preserve output', () => {
  const first = discover(clauses, vectors, settings);
  assert.deepEqual(discover(clauses, vectors, settings), first);
  assert.deepEqual(discover([...clauses].reverse(), [...vectors].reverse(), settings), first);
  assert.equal(first.parameters.algorithm, 'seeded_spherical_k_means');
  assert.ok(first.limitations.some(text => text.includes('not fairness')) || first.limitations.some(text => text.includes('frequency is not fairness')));
});

test('direction deduplication and discovery ignore positive vector scale across settings', () => {
  const multiSetting = { ...settings, kValues: [2, 4] };
  const baseline = discover(clauses, vectors, multiSetting);
  const scaled = discover(clauses, vectors.map((vector, index) => vector.map(value => value * 2 ** index)), multiSetting);
  assert.deepEqual(scaled, baseline);
});

test('partition comparisons ignore cluster names and distinguish conflicting partitions', () => {
  const a = ['a', 'b', 'c', 'd'].map((clause_id, index) => ({ clause_id, cluster_id: index < 2 ? 'first' : 'second' }));
  const same = a.map(item => ({ ...item, cluster_id: item.cluster_id === 'first' ? 'renamed-B' : 'renamed-A' })).reverse();
  assert.equal(compareAssignments(a, same).adjusted_rand, 1);
  assert.equal(compareAssignments(a, same).coassignment_agreement, 1);
  const crossed = a.map((item, index) => ({ ...item, cluster_id: index % 2 }));
  assert.ok(Math.abs(compareAssignments(a, crossed).adjusted_rand + 0.5) < 1e-12);
  assert.equal(compareAssignments(a, crossed).coassignment_agreement, 1 / 3);
  assert.equal(compareAssignments(a, a.slice(0, 1)).pair_count, 0);
  assert.equal(compareAssignments(a, a.slice(0, 1)).adjusted_rand, null);
});

test('requested k is preserved while identical directions and zero vectors expose low signal', () => {
  const sample = clauses.slice(0, 4);
  const result = discover(sample, [[1, 0], [2, 0], [0, 0], [1e-300, 0]], { kValues: [8, 12, 16], repeats: 1 });
  assert.equal(result.status, 'LOW_SIGNAL');
  assert.deepEqual(result.excluded_ids, ['unit-2']);
  assert.equal(result.parameters.unique_fit_directions, 1);
  assert.deepEqual(result.runs.map(run => [run.requested_k, run.effective_k]), [[8, 1], [12, 1], [16, 1]]);
  assert.ok(result.runs.every(run => run.metrics.silhouette.value === null));
  assert.ok(result.runs.every(run => run.warnings.includes('LOW_SIGNAL_FEWER_THAN_TWO_FIT_DIRECTIONS')));
});

test('empty and all-zero inputs retain honest no-signal status and requested settings', () => {
  const empty = discover([], [], { kValues: [3], repeats: 1 });
  assert.equal(empty.status, 'EMPTY_INPUT');
  assert.equal(empty.runs[0].effective_k, 0);
  assert.deepEqual(empty.runs[0].clusters, []);
  const zero = discover(clauses.slice(0, 1), [[0, 0]], { kValues: [3], repeats: 1 });
  assert.equal(zero.status, 'NO_FIT_SIGNAL');
  assert.equal(zero.runs[0].metrics.average_similarity, null);
});

test('held-out clauses cannot alter fitted geometry, vocabulary or representatives', () => {
  const fitIds = clauses.slice(0, 4).map(clause => clause.id);
  const base = discover(clauses.slice(0, 4), vectors.slice(0, 4), { kValues: [2], repeats: 1, seed: 7 });
  const extended = discover(clauses, vectors, { kValues: [2], repeats: 1, seed: 7, fitIds });
  assert.deepEqual(extended.runs[0].clusters, base.runs[0].clusters);
  assert.deepEqual(extended.runs[0].metrics, base.runs[0].metrics);
  assert.equal(extended.holdout_ids.length, 4);
  assert.equal(extended.runs[0].assignments.filter(item => item.partition === 'holdout').length, 4);
  assert.ok(extended.runs[0].clusters.every(cluster => cluster.member_ids.every(id => fitIds.includes(id))));
  assert.equal(extended.parameters.holdout_affects_centroids, false);
});

test('contract-family holdout leakage is disclosed and representatives prefer different contracts', () => {
  const sample = clauses.slice(0, 4).map((clause, index) => ({ ...clause,
    contract_id: index < 2 ? 'same-contract' : `contract-${index}`,
    duplicate_family: index === 3 ? 'common-family' : index === 0 ? 'common-family' : undefined }));
  const fitted = discover(sample, [[1, 0], [1, 0], [1, 0], [1, 0]], { kValues: [1], repeats: 1, representativeCount: 3 });
  assert.deepEqual(fitted.runs[0].clusters[0].representative_ids, ['unit-0', 'unit-2', 'unit-3']);
  const holdout = discover(sample, [[1, 0], [1, 0], [1, 0], [1, 0]], { kValues: [1], repeats: 1, fitIds: ['unit-0', 'unit-2'] });
  assert.deepEqual(holdout.parameters.holdout_overlap_ids, ['unit-1', 'unit-3']);
  assert.ok(holdout.runs[0].warnings.includes('HOLDOUT_CONTRACT_OR_DUPLICATE_FAMILY_OVERLAPS_FIT'));
});

test('singleton clusters and opposing directions produce finite retained metrics', () => {
  const result = discover(clauses.slice(0, 3), [[1, 0], [-1, 0], [0, 1]], { kValues: [1, 3, 8], repeats: 1 });
  assert.deepEqual(result.runs.map(run => run.effective_k), [1, 3, 3]);
  assert.equal(result.runs[1].metrics.silhouette.value, 0);
  assert.ok(result.runs.every(run => Number.isFinite(run.metrics.average_similarity)));
  const antipodal = discover(clauses.slice(0, 2), [[1, 0], [-1, 0]], { kValues: [1], repeats: 1 });
  assert.ok(antipodal.runs[0].warnings.includes('ZERO_MEAN_CLUSTER_USES_MEMBER_DIRECTION'));
  assert.equal(antipodal.runs[0].clusters[0].average_similarity, 0);
});

test('sampled cosine silhouette is bounded and identifies its approximation', () => {
  const result = discover(clauses, vectors, { ...settings, repeats: 1, silhouetteSampleSize: 4 });
  const metric = result.runs[0].metrics.silhouette;
  assert.equal(metric.sample_size, 4);
  assert.equal(metric.total_fit_size, 8);
  assert.equal(metric.method, 'seeded_cosine_subset');
  assert.ok(metric.value == null || metric.value >= -1 && metric.value <= 1);
});

test('invalid alignment, dimensions, nonfinite numbers and settings reject explicitly', () => {
  const cases = [
    () => discover(clauses, vectors.slice(1)),
    () => discover(clauses.slice(0, 2), [[1, 0], [1]]),
    () => discover(clauses.slice(0, 1), [[Infinity, 0]]),
    () => discover(clauses.slice(0, 1), [[NaN, 0]]),
    () => discover(clauses.slice(0, 1), [new Array(2)]),
    () => discover(clauses.slice(0, 1), [[]]),
    () => discover(clauses, vectors, { kValues: [0] }),
    () => discover(clauses, vectors, { kValues: [2, 2] }),
    () => discover(clauses, vectors, { repeats: 0 }),
    () => discover(clauses, vectors, { maxIterations: 0 }),
    () => discover(clauses, vectors, { seed: -1 }),
    () => discover(clauses, vectors, { fitIds: ['unknown'] }),
    () => discover(clauses, vectors, { fitIds: ['unit-0', 'unit-0'] }),
    () => discover(clauses, vectors, { outlierThreshold: 2 }),
    () => discover([clauses[0], clauses[0]], [[1, 0], [0, 1]]),
  ];
  for (const run of cases) assert.throws(run, /DISCOVERY_INPUT/);
});
