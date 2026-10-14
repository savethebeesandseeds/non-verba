// SPDX-License-Identifier: AGPL-3.0-only
// Priors Derivation Prototype: geometric hypothesis discovery, not adopted priors.

const VERSION = 'nv-priors-derivation-discovery-prototype-v1';
const EPSILON = 1e-12;
const STOP_WORDS = new Set(`a an and are as at be been being but by can contract contracts agreement agreements clause clauses company companies shall may must will would could should for from has have had if in into is it its of on or other parties party that the their them there these they this those to under upon was were which who with without any all each such including herein thereof pursuant section sections date days year years`.split(' '));

function ensure(condition, message) {
  if (!condition) throw new TypeError(`DISCOVERY_INPUT: ${message}`);
}

function integer(value, minimum, maximum, name) {
  ensure(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    `${name} must be an integer in ${minimum}..${maximum}`);
  return value;
}

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function derivedSeed(seed, k, repeat) {
  return (seed ^ Math.imul(k, 0x9e3779b1) ^ Math.imul(repeat + 1, 0x85ebca6b)) >>> 0;
}

function dot(left, right) {
  let sum = 0;
  for (let index = 0; index < left.length; index++) sum += left[index] * right[index];
  return Math.max(-1, Math.min(1, sum));
}

function normalize(vector) {
  // Scale before taking the norm so finite huge or tiny coordinates remain usable.
  const scale = vector.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
  if (scale === 0) return null;
  const scaled = vector.map(value => value / scale);
  const norm = Math.sqrt(scaled.reduce((sum, value) => sum + value * value, 0));
  return scaled.map(value => value / norm);
}

function orientation(vector) {
  return vector.map(value => Math.round(value / EPSILON) * EPSILON).join(',');
}

function shuffled(values, seed) {
  const result = [...values];
  const random = randomGenerator(seed);
  for (let index = result.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function initialize(rows, k, seed) {
  const random = randomGenerator(seed);
  const first = Math.floor(random() * rows.length);
  const chosen = new Set([rows[first].direction]);
  const centers = [rows[first].vector];
  const nearest = rows.map(row => Math.max(0, 1 - dot(row.vector, centers[0])));
  while (centers.length < k) {
    const weights = rows.map((row, index) => chosen.has(row.direction) ? 0 : nearest[index] ** 2);
    const total = weights.reduce((sum, value) => sum + value, 0);
    let picked = -1;
    if (total > EPSILON ** 2) {
      let target = random() * total;
      for (let index = 0; index < weights.length; index++) {
        target -= weights[index];
        if (weights[index] > 0 && target <= 0) { picked = index; break; }
      }
    }
    if (picked < 0) picked = rows.findIndex(row => !chosen.has(row.direction));
    if (picked < 0) break;
    chosen.add(rows[picked].direction);
    centers.push(rows[picked].vector);
    for (let index = 0; index < rows.length; index++) {
      nearest[index] = Math.min(nearest[index], Math.max(0, 1 - dot(rows[index].vector, centers.at(-1))));
    }
  }
  return centers.map(center => [...center]);
}

function nearestCenter(vector, centers) {
  let label = 0;
  let similarity = -Infinity;
  for (let index = 0; index < centers.length; index++) {
    const candidate = dot(vector, centers[index]);
    if (candidate > similarity + EPSILON) { label = index; similarity = candidate; }
  }
  return { label, similarity };
}

function fit(rows, k, seed, maxIterations) {
  if (!rows.length) return { centers: [], labels: [], iterations: 0, converged: true, warnings: [] };
  let centers = initialize(rows, k, seed);
  let previous = null;
  let labels = [];
  const warnings = new Set();
  let converged = false;
  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    labels = rows.map(row => nearestCenter(row.vector, centers).label);
    const groups = centers.map(() => []);
    labels.forEach((label, index) => groups[label].push(index));
    // Identical or coincident centers can legitimately collapse. Drop empty centers
    // and disclose the effective count rather than inventing empty semantic families.
    if (groups.some(group => !group.length)) {
      warnings.add('EMPTY_CLUSTERS_REMOVED');
      centers = centers.filter((_, index) => groups[index].length);
      previous = null;
      continue;
    }
    const next = groups.map(group => {
      const total = new Array(rows[0].vector.length).fill(0);
      for (const member of group) {
        for (let dimension = 0; dimension < total.length; dimension++) total[dimension] += rows[member].vector[dimension];
      }
      const center = normalize(total);
      if (center) return center;
      warnings.add('ZERO_MEAN_CLUSTER_USES_MEMBER_DIRECTION');
      return [...rows[group[0]].vector];
    });
    const unchanged = previous && labels.every((label, index) => label === previous[index]);
    const movement = centers.reduce((maximum, center, index) => Math.max(maximum, 1 - dot(center, next[index])), 0);
    centers = next;
    if (unchanged || movement <= EPSILON) { converged = true; iterations++; break; }
    previous = labels;
  }
  // Reassign to retained final centers, including when an iteration cap is reached.
  labels = rows.map(row => nearestCenter(row.vector, centers).label);
  const used = new Set(labels);
  if (used.size !== centers.length) {
    warnings.add('EMPTY_CLUSTERS_REMOVED');
    const oldLabels = [...used].sort((left, right) => left - right);
    const remap = new Map(oldLabels.map((label, index) => [label, index]));
    centers = oldLabels.map(label => centers[label]);
    labels = labels.map(label => remap.get(label));
  }
  return { centers, labels, iterations, converged, warnings: [...warnings].sort() };
}

function chooseTwo(value) { return value * (value - 1) / 2; }

/** Label-invariant partition agreement over shared clause IDs. */
export function compareAssignments(left, right) {
  const toMap = values => {
    ensure(Array.isArray(values), 'comparison assignments must be arrays');
    const map = new Map();
    for (const value of values) {
      ensure(value && typeof value.clause_id === 'string' && value.cluster_id != null,
        'comparison assignment requires clause_id and cluster_id');
      ensure(!map.has(value.clause_id), 'duplicate comparison clause_id');
      map.set(value.clause_id, String(value.cluster_id));
    }
    return map;
  };
  const a = toMap(left);
  const b = toMap(right);
  const ids = [...a.keys()].filter(id => b.has(id)).sort();
  const rowCounts = new Map();
  const columnCounts = new Map();
  const cells = new Map();
  for (const id of ids) {
    const row = a.get(id);
    const column = b.get(id);
    rowCounts.set(row, (rowCounts.get(row) ?? 0) + 1);
    columnCounts.set(column, (columnCounts.get(column) ?? 0) + 1);
    const key = JSON.stringify([row, column]);
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  const pairs = chooseTwo(ids.length);
  const sumPairs = counts => [...counts.values()].reduce((sum, count) => sum + chooseTwo(count), 0);
  const sameBoth = sumPairs(cells);
  const sameLeft = sumPairs(rowCounts);
  const sameRight = sumPairs(columnCounts);
  const expected = pairs ? sameLeft * sameRight / pairs : 0;
  const denominator = (sameLeft + sameRight) / 2 - expected;
  const adjustedRand = !pairs ? null : Math.abs(denominator) <= EPSILON ? 1 : (sameBoth - expected) / denominator;
  const agreement = !pairs ? null : (pairs - sameLeft - sameRight + 2 * sameBoth) / pairs;
  return {
    common_ids: ids,
    common_count: ids.length,
    pair_count: pairs,
    status: pairs ? 'COMPARED' : 'INSUFFICIENT_SHARED_PAIRS',
    adjusted_rand: adjustedRand,
    coassignment_agreement: agreement,
    same_pair_counts: { left: sameLeft, right: sameRight, both: sameBoth },
  };
}

function topTerms(rows, maximum = 12) {
  const terms = new Map();
  for (const row of rows) {
    // Count each term once per source contract to limit repeated boilerplate's
    // lexical influence; these terms describe text and do not name a principle.
    const tokens = new Set(`${row.clause.heading ?? ''} ${row.clause.text}`.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []);
    for (const token of tokens) {
      if (STOP_WORDS.has(token)) continue;
      if (!terms.has(token)) terms.set(token, new Set());
      terms.get(token).add(row.clause.contract_id);
    }
  }
  return [...terms.entries()].sort((left, right) => right[1].size - left[1].size || left[0].localeCompare(right[0], 'en'))
    .slice(0, maximum).map(([term, contracts]) => ({ term, distinct_contracts: contracts.size }));
}

function representatives(rows, center, maximum) {
  const ranked = [...rows].sort((left, right) => dot(right.vector, center) - dot(left.vector, center)
    || left.clause.id.localeCompare(right.clause.id, 'en'));
  const selected = [];
  const contracts = new Set();
  for (const row of ranked) {
    if (!contracts.has(row.clause.contract_id)) {
      selected.push(row.clause.id);
      contracts.add(row.clause.contract_id);
      if (selected.length === maximum) return selected;
    }
  }
  for (const row of ranked) {
    if (!selected.includes(row.clause.id)) selected.push(row.clause.id);
    if (selected.length === maximum) break;
  }
  return selected;
}

function silhouette(rows, labels, k, seed, maximum) {
  if (rows.length < 2 || k < 2) return { value: null, sample_size: rows.length, total_fit_size: rows.length, method: 'not_defined_for_fewer_than_two_clusters' };
  let sample = shuffled(rows.map((_, index) => index), seed).slice(0, maximum);
  sample.sort((left, right) => left - right);
  const groups = new Map();
  for (const index of sample) {
    if (!groups.has(labels[index])) groups.set(labels[index], []);
    groups.get(labels[index]).push(index);
  }
  if (groups.size < 2) return { value: null, sample_size: sample.length, total_fit_size: rows.length, method: 'seeded_cosine_subset', warning: 'SUBSET_HAS_FEWER_THAN_TWO_CLUSTERS' };
  let total = 0;
  for (const index of sample) {
    const own = groups.get(labels[index]);
    if (own.length < 2) continue; // Standard singleton silhouette is zero.
    const a = own.filter(other => other !== index).reduce((sum, other) => sum + 1 - dot(rows[index].vector, rows[other].vector), 0) / (own.length - 1);
    let b = Infinity;
    for (const [label, members] of groups) {
      if (label === labels[index]) continue;
      const distance = members.reduce((sum, other) => sum + 1 - dot(rows[index].vector, rows[other].vector), 0) / members.length;
      b = Math.min(b, distance);
    }
    total += Math.max(a, b) > EPSILON ? (b - a) / Math.max(a, b) : 0;
  }
  return { value: total / sample.length, sample_size: sample.length, total_fit_size: rows.length,
    method: sample.length === rows.length ? 'full_cosine_silhouette' : 'seeded_cosine_subset',
    represented_clusters: groups.size, singleton_value: 0 };
}

function average(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

/**
 * Fit repeatable spherical k-means hypotheses to contextual clauses.
 * embeddings[i] belongs to clauses[i]. Optional fitIds excludes all other clauses
 * from every centroid, representative, lexical term and fit-quality calculation.
 */
export function discover(clauses, embeddings, options = {}) {
  ensure(Array.isArray(clauses) && Array.isArray(embeddings), 'clauses and embeddings must be arrays');
  ensure(clauses.length === embeddings.length, 'clauses and embeddings must align');
  ensure(options && typeof options === 'object' && !Array.isArray(options), 'options must be an object');
  const kValues = options.kValues ?? [8, 12, 16];
  ensure(Array.isArray(kValues) && kValues.length > 0 && kValues.length <= 16, 'kValues requires 1..16 settings');
  for (const value of kValues) integer(value, 1, 256, 'k');
  ensure(new Set(kValues).size === kValues.length, 'kValues must be distinct');
  const seed = integer(options.seed ?? 20261013, 0, 0xffffffff, 'seed');
  const repeats = integer(options.repeats ?? 3, 1, 8, 'repeats');
  const maxIterations = integer(options.maxIterations ?? 100, 1, 1000, 'maxIterations');
  const sampleSize = integer(options.silhouetteSampleSize ?? 96, 2, 256, 'silhouetteSampleSize');
  const representativeCount = integer(options.representativeCount ?? 5, 1, 20, 'representativeCount');
  const outlierThreshold = options.outlierThreshold ?? 0.35;
  ensure(Number.isFinite(outlierThreshold) && outlierThreshold >= -1 && outlierThreshold <= 1,
    'outlierThreshold must be finite in -1..1');
  const ids = new Set();
  let dimensions = null;
  const rows = Array.from(clauses).map((clause, index) => {
    ensure(clause && typeof clause.id === 'string' && clause.id.trim() && !ids.has(clause.id),
      'clause ids must be nonempty and distinct');
    ids.add(clause.id);
    ensure(typeof clause.contract_id === 'string' && clause.contract_id.trim(), 'clause contract_id must be nonempty');
    ensure(typeof clause.text === 'string' && clause.text.trim(), 'clause text must be nonempty');
    ensure(clause.heading == null || typeof clause.heading === 'string', 'clause heading must be text');
    ensure(clause.duplicate_family == null || typeof clause.duplicate_family === 'string', 'duplicate_family must be text');
    const vector = embeddings[index];
    ensure(Array.isArray(vector) && vector.length > 0 && Array.from(vector).every(Number.isFinite),
      'embeddings require nonempty arrays of finite numbers');
    if (dimensions == null) dimensions = vector.length;
    ensure(vector.length === dimensions, 'embedding dimensions must match');
    const normalized = normalize(vector);
    // This key is reused across settings and repeats; constructing it in the
    // k-means++ loop would repeatedly stringify every embedding coordinate.
    return { clause, vector: normalized, direction: normalized ? orientation(normalized) : null };
  }).sort((left, right) => left.clause.id.localeCompare(right.clause.id, 'en'));
  let fitIds = null;
  if (options.fitIds != null) {
    ensure(Array.isArray(options.fitIds), 'fitIds must be an array');
    fitIds = new Set(options.fitIds);
    ensure(fitIds.size === options.fitIds.length && options.fitIds.every(id => typeof id === 'string' && ids.has(id)),
      'fitIds must contain distinct known clause ids');
  }
  const fitRows = rows.filter(row => row.vector && (!fitIds || fitIds.has(row.clause.id)));
  const holdoutRows = rows.filter(row => row.vector && fitIds && !fitIds.has(row.clause.id));
  const excluded = rows.filter(row => !row.vector).map(row => ({ clause_id: row.clause.id, reason: 'ZERO_NORM_EMBEDDING' }));
  const uniqueDirections = new Set(fitRows.map(row => row.direction)).size;
  const fitContracts = new Set(fitRows.map(row => row.clause.contract_id));
  const fitFamilies = new Set(fitRows.map(row => row.clause.duplicate_family).filter(Boolean));
  const overlap = holdoutRows.filter(row => fitContracts.has(row.clause.contract_id)
    || row.clause.duplicate_family && fitFamilies.has(row.clause.duplicate_family)).map(row => row.clause.id);
  const runs = [];
  for (const requestedK of kValues) {
    for (let repeat = 0; repeat < repeats; repeat++) {
      const runSeed = derivedSeed(seed, requestedK, repeat);
      const fitted = fit(fitRows, Math.min(requestedK, uniqueDirections), runSeed, maxIterations);
      const id = `k${requestedK}-r${repeat + 1}`;
      const clusters = fitted.centers.map((center, label) => {
        const members = fitRows.filter((_, index) => fitted.labels[index] === label);
        return {
          id: `${id}-c${label + 1}`,
          member_ids: members.map(row => row.clause.id),
          representative_ids: representatives(members, center, representativeCount),
          top_terms: topTerms(members),
          size: members.length,
          distinct_contracts: new Set(members.map(row => row.clause.contract_id)).size,
          average_similarity: average(members.map(row => dot(row.vector, center))),
          outlier_ids: members.filter(row => dot(row.vector, center) < outlierThreshold).map(row => row.clause.id),
          centroid: center,
        };
      });
      const assignments = fitRows.map((row, index) => ({ clause_id: row.clause.id,
        cluster_id: clusters[fitted.labels[index]].id, partition: 'fit',
        similarity: dot(row.vector, fitted.centers[fitted.labels[index]]) }));
      const support = clusters.map(cluster => ({ cluster_id: cluster.id, member_ids: [],
        size: 0, distinct_contracts: 0, average_similarity: null, outlier_ids: [] }));
      if (fitted.centers.length) {
        const heldGroups = fitted.centers.map(() => []);
        for (const row of holdoutRows) {
          const nearest = nearestCenter(row.vector, fitted.centers);
          assignments.push({ clause_id: row.clause.id, cluster_id: clusters[nearest.label].id,
            partition: 'holdout', similarity: nearest.similarity });
          heldGroups[nearest.label].push(row);
        }
        heldGroups.forEach((members, label) => {
          support[label].member_ids = members.map(row => row.clause.id);
          support[label].size = members.length;
          support[label].distinct_contracts = new Set(members.map(row => row.clause.contract_id)).size;
          support[label].average_similarity = average(members.map(row => dot(row.vector, fitted.centers[label])));
          support[label].outlier_ids = members.filter(row => dot(row.vector, fitted.centers[label]) < outlierThreshold).map(row => row.clause.id);
        });
      }
      const warnings = [...fitted.warnings];
      if (clusters.length !== requestedK) warnings.push('REQUESTED_K_REDUCED_TO_SUPPORTED_DIRECTIONS_OR_NONEMPTY_CLUSTERS');
      if (uniqueDirections < 2) warnings.push('LOW_SIGNAL_FEWER_THAN_TWO_FIT_DIRECTIONS');
      if (!fitted.converged) warnings.push('ITERATION_LIMIT_REACHED');
      if (overlap.length) warnings.push('HOLDOUT_CONTRACT_OR_DUPLICATE_FAMILY_OVERLAPS_FIT');
      runs.push({ id, requested_k: requestedK, effective_k: clusters.length, repeat: repeat + 1,
        seed: runSeed, iterations: fitted.iterations, converged: fitted.converged, clusters,
        assignments, holdout_support: support,
        metrics: { average_similarity: average(assignments.filter(item => item.partition === 'fit').map(item => item.similarity)),
          outlier_count: clusters.reduce((sum, cluster) => sum + cluster.outlier_ids.length, 0),
          silhouette: silhouette(fitRows, fitted.labels, clusters.length, seed, sampleSize) },
        warnings: [...new Set(warnings)].sort() });
    }
  }
  const comparisons = [];
  for (let left = 0; left < runs.length; left++) {
    for (let right = left + 1; right < runs.length; right++) {
      const comparison = compareAssignments(runs[left].assignments.filter(item => item.partition === 'fit'),
        runs[right].assignments.filter(item => item.partition === 'fit'));
      comparisons.push({ left_run_id: runs[left].id, right_run_id: runs[right].id,
        same_requested_k: runs[left].requested_k === runs[right].requested_k, ...comparison });
    }
  }
  return {
    version: VERSION,
    status: !clauses.length ? 'EMPTY_INPUT' : !fitRows.length ? 'NO_FIT_SIGNAL' : uniqueDirections < 2 ? 'LOW_SIGNAL' : 'HYPOTHESES_GENERATED',
    parameters: { algorithm: 'seeded_spherical_k_means', distance: 'cosine', initialization: 'k_means_plus_plus_squared_cosine_distance',
      k_values: [...kValues], seed, repeats, max_iterations: maxIterations, embedding_dimensions: dimensions,
      input_vectors: clauses.length, normalized_vectors: rows.length - excluded.length,
      fit_vectors: fitRows.length, unique_fit_directions: uniqueDirections, direction_rounding: EPSILON,
      convergence_tolerance: EPSILON, silhouette_sample_size: sampleSize, representative_count: representativeCount,
      outlier_similarity_threshold: outlierThreshold, lexical_terms: 'ascii_terms_ranked_by_distinct_fit_contract_count',
      holdout_affects_centroids: false, holdout_overlap_ids: overlap },
    fit_ids: fitRows.map(row => row.clause.id),
    holdout_ids: holdoutRows.map(row => row.clause.id),
    excluded_ids: excluded.map(item => item.clause_id), excluded,
    runs, comparisons,
    stability: { within_setting: kValues.map(k => {
      const entries = comparisons.filter(item => item.same_requested_k && runs.find(run => run.id === item.left_run_id).requested_k === k);
      return { requested_k: k, comparisons: entries.length, average_adjusted_rand: average(entries.map(item => item.adjusted_rand)),
        minimum_adjusted_rand: entries.some(item => Number.isFinite(item.adjusted_rand))
          ? Math.min(...entries.map(item => item.adjusted_rand).filter(Number.isFinite)) : null,
        average_coassignment_agreement: average(entries.map(item => item.coassignment_agreement)) };
    }), interpretation: 'Partition repeatability is a geometric diagnostic, not semantic validity or fairness.' },
    limitations: [
      'Clusters propose hypotheses; they do not select, adopt or replace the signed priors catalog.',
      'Embedding provenance, suitability and exact clause context must be supplied and reviewed separately.',
      'Lexical top terms describe recurring words, not normative principles, validated cluster names or candidate priors.',
      'Contract repetition, corporate sampling and bargaining power can shape the geometry; frequency is not fairness.',
      'Holdout assignment measures geometric support only; contract-family overlap is disclosed and weakens independence.',
      'Cosine silhouette on a seeded subset can differ from full-corpus silhouette; singleton samples count as zero.',
      'Outlier thresholds and k settings are experimental technical parameters, not calibrated acceptance criteria.',
      'Real-valued arithmetic can vary slightly across runtimes; seeds and retained vectors permit bounded replay.',
    ],
  };
}
