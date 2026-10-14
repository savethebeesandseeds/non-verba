// SPDX-License-Identifier: AGPL-3.0-only
// Bounded spherical geometry proposes descriptive groups, never a priors catalog.
import { createHash } from 'node:crypto';
import { endianness } from 'node:os';
import { discover } from '../../lib/discover.mjs';

export const PREDECLARED_GEOMETRY_SCHEDULE = Object.freeze({ k_values: Object.freeze([32, 64, 128, 256]), seeds: Object.freeze([20261013, 20261029, 20261109, 20261123, 20261201]) });
const MAX_ROWS = 50000;
const sha = value => createHash('sha256').update(value).digest('hex');
const idOf = row => row?.id ?? row?.unit_id;
const cmpText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
function integer(value, min, max, name) { if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${name} must be an integer in ${min}..${max}`); return value; }
function rng(seed) { let state = seed >>> 0; return () => { state = (state + 0x6d2b79f5) >>> 0; let value = state; value = Math.imul(value ^ (value >>> 15), value | 1); value ^= value + Math.imul(value ^ (value >>> 7), value | 61); return ((value ^ (value >>> 14)) >>> 0) / 4294967296; }; }
function vectorNorm(vector) {
  let scale = 0; for (const value of vector) { if (!Number.isFinite(value)) throw new TypeError('Geometry vectors must be finite.'); scale = Math.max(scale, Math.abs(value)); }
  if (!scale) throw new TypeError('Geometry vectors cannot have zero norm.');
  let squared = 0; for (const value of vector) squared += (value / scale) ** 2;
  return { scale, norm: Math.sqrt(squared) };
}
function normalized(vector) { const { scale, norm } = vectorNorm(vector); return Float32Array.from(vector, value => value / scale / norm); }

export function evaluationDigest(rows) {
  const hash = createHash('sha256'); const ids = new Set();
  for (const row of rows) { const id = typeof row === 'string' ? row : idOf(row); if (typeof id !== 'string' || !id || ids.has(id)) throw new TypeError('Evaluation digest needs unique ordered unit IDs.'); ids.add(id); hash.update(`${Buffer.byteLength(id)}:${id}\n`); }
  return hash.digest('hex');
}
function packedMatrix(rows, vectors, dimensions, maximumRows = MAX_ROWS) {
  if (!Array.isArray(rows) || rows.length > maximumRows) throw new TypeError(`Geometry accepts at most ${maximumRows} rows in memory.`);
  evaluationDigest(rows);
  const packed = vectors instanceof Float32Array;
  const width = dimensions ?? (packed ? vectors.length / Math.max(1, rows.length) : vectors?.[0]?.length);
  integer(width, 1, 2048, 'dimensions');
  if (packed ? vectors.length !== rows.length * width : !Array.isArray(vectors) || vectors.length !== rows.length) throw new TypeError('Vector matrix does not match rows and dimensions.');
  const output = new Float32Array(rows.length * width);
  for (let row = 0; row < rows.length; row++) {
    const vector = packed ? vectors.subarray(row * width, (row + 1) * width) : vectors[row];
    if (!vector || vector.length !== width) throw new TypeError('Inconsistent vector dimensions.');
    const { scale, norm } = vectorNorm(vector);
    for (let column = 0; column < width; column++) output[row * width + column] = vector[column] / scale / norm;
  }
  return { vectors: output, dimensions: width };
}

/** An indexed max heap keeps constrained priority sampling bounded, including replacements. */
export function createBalancedReservoir({ capacity = 20000, perContract = 20, perFamily = 2, dimensions = 384, seed = 20261013 } = {}) {
  integer(capacity, 1, MAX_ROWS, 'capacity'); integer(perContract, 1, MAX_ROWS, 'perContract'); integer(perFamily, 1, MAX_ROWS, 'perFamily'); integer(dimensions, 1, 2048, 'dimensions'); integer(seed, 0, 0xffffffff, 'seed');
  const heap = []; const contractGroups = new Map(); const familyGroups = new Map(); const retainedIds = new Map();
  const streamHash = createHash('sha256');
  const stats = { considered: 0, eligible_fit: 0, skipped_partition: 0, rejected_priority_or_cap: 0, evicted: 0 };
  const worse = (a, b) => a.priority - b.priority || cmpText(a.id, b.id);
  const swap = (a, b) => { [heap[a], heap[b]] = [heap[b], heap[a]]; heap[a].index = a; heap[b].index = b; };
  const up = index => { while (index > 0) { const parent = (index - 1) >>> 1; if (worse(heap[index], heap[parent]) <= 0) break; swap(index, parent); index = parent; } };
  const down = index => { for (;;) { const left = index * 2 + 1; if (left >= heap.length) return; const right = left + 1; const child = right < heap.length && worse(heap[right], heap[left]) > 0 ? right : left; if (worse(heap[child], heap[index]) <= 0) return; swap(child, index); index = child; } };
  const groupAdd = (map, key, entry) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(entry); };
  const groupDelete = (map, key, entry) => { const group = map.get(key); group.delete(entry); if (!group.size) map.delete(key); };
  const remove = entry => {
    const index = entry.index; const last = heap.pop();
    if (index < heap.length) { heap[index] = last; last.index = index; if (index && worse(last, heap[(index - 1) >>> 1]) > 0) up(index); else down(index); }
    groupDelete(contractGroups, entry.contract, entry); groupDelete(familyGroups, entry.family, entry); retainedIds.delete(entry.id); stats.evicted++;
  };
  const worstGroup = group => { let result = null; for (const entry of group || []) if (!result || worse(entry, result) > 0) result = entry; return result; };
  function add(row, vector) {
    stats.considered++;
    streamHash.update(JSON.stringify([idOf(row) ?? null, row?.partition ?? null, row?.contract_family_id || row?.contract_id || null, row?.unit_family_id || row?.clause_family_id || row?.family_id || null]) + '\n');
    if (row?.partition !== 'fit') { stats.skipped_partition++; return false; }
    const id = idOf(row); const contract = row.contract_family_id || row.contract_id; const family = row.unit_family_id || row.clause_family_id || row.family_id || id;
    if (typeof id !== 'string' || !id || typeof contract !== 'string' || !contract || typeof family !== 'string' || !family) throw new TypeError('Fit reservoir rows need unit, contract/family and unit-family identities.');
    if (retainedIds.has(id)) throw new TypeError('Duplicate retained reservoir unit ID.');
    if (!vector || vector.length !== dimensions) throw new TypeError('Reservoir vector dimensions differ.');
    const entry = { id, row: { ...row, id }, vector: normalized(vector), contract, family, priority: createHash('sha256').update(`${seed}\0${id}`).digest().readUIntBE(0, 6), index: 0 };
    stats.eligible_fit++; const evictions = new Set();
    for (const [map, key, cap] of [[contractGroups, contract, perContract], [familyGroups, family, perFamily]]) {
      if ((map.get(key)?.size || 0) >= cap) { const worst = worstGroup(map.get(key)); if (worse(entry, worst) >= 0) { stats.rejected_priority_or_cap++; return false; } evictions.add(worst); }
    }
    if (!evictions.size && heap.length >= capacity) { if (worse(entry, heap[0]) >= 0) { stats.rejected_priority_or_cap++; return false; } evictions.add(heap[0]); }
    for (const victim of evictions) remove(victim);
    entry.index = heap.length; heap.push(entry); up(entry.index); retainedIds.set(id, entry); groupAdd(contractGroups, contract, entry); groupAdd(familyGroups, family, entry); return true;
  }
  function addBatch(rows, vectors) {
    if (!Array.isArray(rows) || rows.length > 5000) throw new TypeError('Reservoir streaming batches are limited to 5000 rows.');
    if (vectors instanceof Float32Array ? vectors.length !== rows.length * dimensions : !Array.isArray(vectors) || vectors.length !== rows.length) throw new TypeError('Reservoir batch vectors do not align.');
    let accepted = 0; rows.forEach((row, index) => { if (add(row, vectors instanceof Float32Array ? vectors.subarray(index * dimensions, (index + 1) * dimensions) : vectors[index])) accepted++; }); return accepted;
  }
  function snapshot() {
    const entries = [...heap].sort((a, b) => a.priority - b.priority || cmpText(a.id, b.id)); const rows = entries.map(entry => ({ ...entry.row })); const vectors = new Float32Array(rows.length * dimensions);
    entries.forEach((entry, index) => vectors.set(entry.vector, index * dimensions));
    return { rows, vectors, dimensions, statistics: { ...stats, retained: rows.length, contracts: contractGroups.size, unit_families: familyGroups.size, ordered_unit_ids_sha256: evaluationDigest(rows), ordered_considered_identity_stream_sha256: streamHash.copy().digest('hex'), capacity, per_contract_cap: perContract, per_unit_family_cap: perFamily, seed,
      method: 'seeded SHA256 unit priority with bounded global heap and contract-family/unit-family caps; fixed ordered stream; not uniform or guaranteed order invariant under interacting caps', partition: 'fit_only', input_uniqueness: 'Retained duplicate IDs rejected; complete-source uniqueness must be established by the storage ledger.' } };
  }
  return { add, addBatch, snapshot, size: () => heap.length };
}

function cosineAt(matrix, offset, centers, centerOffset, width) { let value = 0; for (let d = 0; d < width; d++) value += matrix[offset + d] * centers[centerOffset + d]; return Math.max(-1, Math.min(1, value)); }
function nearest(matrix, offset, centers, width) {
  const count = centers.length / width; let label = 0; let similarity = -Infinity; let second = -Infinity;
  for (let c = 0; c < count; c++) { const value = cosineAt(matrix, offset, centers, c * width, width); if (value > similarity + 1e-12) { second = similarity; similarity = value; label = c; } else if (value > second) second = value; }
  return { label, similarity, second: count > 1 ? second : null };
}
function sampleIndices(count, size, random) { const selected = new Set(); for (let index = count - size; index < count; index++) { const choice = Math.floor(random() * (index + 1)); selected.add(selected.has(choice) ? index : choice); } return [...selected].sort((a, b) => a - b); }
function directionKey(matrix, index, width) { return sha(Buffer.from(matrix.buffer, matrix.byteOffset + index * width * 4, width * 4)); }
function initialize(matrix, width, count, requestedK, random, sampleMaximum) {
  const sampleSize = Math.min(count, sampleMaximum); const indices = sampleIndices(count, sampleSize, random); const unique = new Map();
  for (const index of indices) { const key = directionKey(matrix, index, width); if (!unique.has(key)) unique.set(key, index); }
  if (unique.size < requestedK) for (let index = 0; index < count && unique.size < requestedK; index++) { const key = directionKey(matrix, index, width); if (!unique.has(key)) unique.set(key, index); }
  const pool = [...unique.values()]; const effective = Math.min(requestedK, pool.length); const chosen = []; const selected = new Set(); const distances = new Float64Array(pool.length).fill(1);
  while (chosen.length < effective) {
    let next;
    if (!chosen.length) next = Math.floor(random() * pool.length);
    else {
      let total = 0; for (let index = 0; index < pool.length; index++) if (!selected.has(index)) total += distances[index] ** 2;
      let target = random() * total;
      for (let index = 0; index < pool.length; index++) if (!selected.has(index)) { target -= distances[index] ** 2; if (target <= 0 && distances[index] > 0) { next = index; break; } }
      if (next == null) next = pool.findIndex((_, index) => !selected.has(index));
    }
    selected.add(next); const row = pool[next]; chosen.push(row);
    for (let index = 0; index < pool.length; index++) distances[index] = Math.min(distances[index], Math.max(0, 1 - cosineAt(matrix, pool[index] * width, matrix, row * width, width)));
  }
  const centers = new Float32Array(effective * width); chosen.forEach((index, c) => centers.set(matrix.subarray(index * width, (index + 1) * width), c * width));
  return { centers, effective, pool_size: pool.length, seeded_sample_size: sampleSize };
}

/** Fixed-budget stochastic minibatches. This is explicitly not full Lloyd k-means. */
export function fitMiniBatch(rows, vectors, { k = 32, seed = 20261013, batchSize = 256, iterations = 200, weights = null, dimensions = null, initializationSampleSize = null, onIteration = null } = {}) {
  if (!rows?.length) throw new TypeError('MiniBatch fitting requires a nonempty bounded fit reservoir.');
  if (rows.some(row => row.partition !== 'fit')) throw new TypeError('Heldout or unspecified-partition rows cannot influence fitted centroids.');
  integer(k, 1, 1024, 'k'); integer(seed, 0, 0xffffffff, 'seed'); integer(batchSize, 1, 8192, 'batchSize'); integer(iterations, 1, 10000, 'iterations');
  const { vectors: matrix, dimensions: width } = packedMatrix(rows, vectors, dimensions); const random = rng(seed);
  const initialMaximum = integer(initializationSampleSize ?? Math.max(512, k * 4), Math.min(k, rows.length), MAX_ROWS, 'initializationSampleSize');
  const initial = initialize(matrix, width, rows.length, Math.min(k, rows.length), random, initialMaximum); let centers = initial.centers; const count = initial.effective;
  let rowWeights = null;
  if (weights != null) { if (weights.length !== rows.length) throw new TypeError('Weights must align with the fit reservoir.'); rowWeights = Float64Array.from(weights); if ([...rowWeights].some(value => !Number.isFinite(value) || value <= 0 || value > 1e9)) throw new TypeError('Fit weights must be finite, positive and bounded.'); }
  const sums = new Float64Array(count * width); const observationWeight = new Float64Array(count); const warnings = new Set();
  if (count < k) warnings.add('REQUESTED_K_REDUCED_TO_AVAILABLE_SAMPLED_OR_FALLBACK_DIRECTIONS');
  let movement = null;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const touched = new Set();
    for (let item = 0; item < Math.min(batchSize, rows.length); item++) {
      const row = Math.floor(random() * rows.length); const assignment = nearest(matrix, row * width, centers, width); const c = assignment.label; const weight = rowWeights?.[row] ?? 1;
      observationWeight[c] += weight; touched.add(c);
      for (let d = 0; d < width; d++) sums[c * width + d] += matrix[row * width + d] * weight;
    }
    movement = 0;
    for (const c of touched) {
      const sum = sums.subarray(c * width, (c + 1) * width);
      if (!sum.some(value => value !== 0)) { warnings.add('ZERO_MEAN_CLUSTER_RETAINS_PREVIOUS_DIRECTION'); continue; }
      const next = normalized(sum); movement = Math.max(movement, 1 - cosineAt(next, 0, centers, c * width, width)); centers.set(next, c * width);
    }
    if (onIteration) onIteration({ iteration: iteration + 1, iterations, last_maximum_cosine_movement: movement, observed_weights: observationWeight.slice() });
  }
  const labels = new Uint32Array(rows.length); const occupancy = new Uint32Array(count);
  for (let row = 0; row < rows.length; row++) { labels[row] = nearest(matrix, row * width, centers, width).label; occupancy[labels[row]]++; }
  const retained = [...occupancy].flatMap((size, c) => size ? [c] : []);
  if (retained.length !== count) {
    warnings.add('EMPTY_FINAL_TRAINING_CLUSTERS_REMOVED'); const remap = new Map(retained.map((c, index) => [c, index])); const next = new Float32Array(retained.length * width);
    retained.forEach((c, index) => next.set(centers.subarray(c * width, (c + 1) * width), index * width)); centers = next;
    for (let row = 0; row < labels.length; row++) labels[row] = remap.get(labels[row]);
  }
  const counts = Uint32Array.from(retained, c => occupancy[c]);
  return { centroids: centers, centers: Array.from({ length: retained.length }, (_, c) => centers.subarray(c * width, (c + 1) * width).slice()), dimensions: width, requested_k: k, effective_k: retained.length, labels, counts,
    status: 'FIXED_MINIBATCH_BUDGET_COMPLETED', warnings: [...warnings].sort(),
    method: { algorithm: 'weighted_spherical_minibatch_cumulative_means_v2', seed, batch_size: Math.min(batchSize, rows.length), iterations, row_sampling: 'seeded uniform draws with replacement from bounded fit-only reservoir', weighted_updates: !!rowWeights, initialization: 'seeded squared-cosine kmeans++ on bounded distinct-direction sample with ordered fallback', initialization_sample_size: initial.seeded_sample_size, initialization_direction_pool: initial.pool_size,
      input_rows: rows.length, ordered_training_units_sha256: evaluationDigest(rows), normalized_training_vectors_sha256: sha(Buffer.from(matrix.buffer, matrix.byteOffset, matrix.byteLength)), training_vector_digest_encoding: `native_${endianness()}_float32`, weights_sha256: rowWeights ? sha(Buffer.from(rowWeights.buffer, rowWeights.byteOffset, rowWeights.byteLength)) : null, weights_digest_encoding: rowWeights ? `native_${endianness()}_float64` : null,
      numeric_storage: 'Float32 normalized input and centroids; Float64 cumulative sums', stopping_rule: 'fixed predeclared budget; no convergence claim', last_maximum_cosine_movement: movement,
      diagnostic_occupancy: 'one final pass over bounded fit reservoir; not over all corpus units', untouched_initial_centroids: [...observationWeight].filter(value => value === 0).length,
      node: process.version, platform: process.platform, arch: process.arch, determinism: 'Same ordered reservoir, options and runtime; seeds are replay aids, not cross-machine bit equality or semantic stability.' } };
}

function centerMatrix(centroids, dimensions) {
  const model = centroids?.centroids ? centroids : null; const value = model ? model.centroids : centroids; const width = dimensions ?? model?.dimensions ?? (Array.isArray(value) ? value[0]?.length : null);
  integer(width, 1, 2048, 'centroid dimensions');
  const rows = Array.from({ length: value instanceof Float32Array ? value.length / width : value?.length || 0 }, (_, index) => ({ id: `centroid-${index}` }));
  if (!rows.length || rows.length > 1024) throw new TypeError('Assignments require 1..1024 centroids.');
  return packedMatrix(rows, value, width, 1024);
}

export function assignVectors(rows, vectors, centroids, { dimensions = null, maximumRows = 5000, clusterPrefix = 'cluster', outlierThreshold = 0.35 } = {}) {
  integer(maximumRows, 1, MAX_ROWS, 'maximumRows'); if (!Number.isFinite(outlierThreshold) || outlierThreshold < -1 || outlierThreshold > 1) throw new TypeError('Invalid outlier threshold.');
  const centers = centerMatrix(centroids, dimensions); const matrix = packedMatrix(rows, vectors, centers.dimensions, maximumRows);
  return rows.map((row, index) => { const found = nearest(matrix.vectors, index * matrix.dimensions, centers.vectors, matrix.dimensions); return { unit_id: idOf(row), clause_id: idOf(row), contract_id: row.contract_id ?? null, family_id: row.unit_family_id || row.family_id || null, partition: row.partition ?? null,
    label: found.label, cluster_id: `${clusterPrefix}-${found.label + 1}`, similarity: found.similarity, second_similarity: found.second, margin: found.second == null ? null : found.similarity - found.second, outlier: found.similarity < outlierThreshold }; });
}

export async function* assignBatches(iterator, centroids, options = {}) {
  for await (const batch of iterator) {
    if (!batch || !Array.isArray(batch.rows) || !batch.vectors) throw new TypeError('Assignment iterator must yield bounded {rows,vectors} batches.');
    yield { rows: batch.rows, assignments: assignVectors(batch.rows, batch.vectors, centroids, options) };
  }
}

/** Contingency arithmetic is O(n + occupied cells), with no pairwise matrix or repeated ID lists. */
export function comparePartitions(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left?.evaluation_sha256 || '') || left.evaluation_sha256 !== right?.evaluation_sha256) throw new TypeError('Partition comparison needs the same ordered common-evaluation digest.');
  if (!left.labels || !right.labels || left.labels.length !== right.labels.length || left.labels.length > MAX_ROWS) throw new TypeError('Partition labels must align with the bounded evaluation set.');
  const rows = new Map(); const columns = new Map(); const cells = new Map();
  for (let index = 0; index < left.labels.length; index++) {
    const a = left.labels[index]; const b = right.labels[index]; integer(a, 0, 0xffffffff, 'left label'); integer(b, 0, 0xffffffff, 'right label');
    rows.set(a, (rows.get(a) || 0) + 1); columns.set(b, (columns.get(b) || 0) + 1); const key = `${a}:${b}`; cells.set(key, (cells.get(key) || 0) + 1);
  }
  const choose2 = count => count * (count - 1) / 2; const pairs = choose2(left.labels.length); const sum = values => [...values.values()].reduce((total, count) => total + choose2(count), 0);
  const a = sum(rows); const b = sum(columns); const both = sum(cells); const expected = pairs ? a * b / pairs : 0; const denominator = (a + b) / 2 - expected;
  return { evaluation_sha256: left.evaluation_sha256, common_count: left.labels.length, pair_count: pairs, adjusted_rand: !pairs ? null : Math.abs(denominator) < 1e-12 ? 1 : (both - expected) / denominator, coassignment_agreement: pairs ? (pairs - a - b + 2 * both) / pairs : null,
    same_pair_counts: { left: a, right: b, both }, status: pairs ? 'COMPARED_COMMON_EVALUATION_SET' : 'INSUFFICIENT_PAIRS', interpretation: 'Geometric agreement only; shared nonmembership can dominate pair agreement.' };
}

export function exactSmallComparator(rows, vectors, { maximumRows = 2000, dimensions = null, ...options } = {}) {
  integer(maximumRows, 1, 2000, 'maximumRows'); if (rows.length > maximumRows) throw new TypeError('Exact v0.1 comparator must receive an explicitly bounded subset.');
  const matrix = packedMatrix(rows, vectors, dimensions, maximumRows);
  return { evaluation_sha256: evaluationDigest(rows), subset_count: rows.length, method: 'unchanged v0.1 full spherical Lloyd comparator on bounded supplied subset', result: discover(rows, rows.map((_, index) => Array.from(matrix.vectors.subarray(index * matrix.dimensions, (index + 1) * matrix.dimensions))), options) };
}
