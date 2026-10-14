// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { deduplicateUnits } from '../lib/repetition.mjs';

const paragraph = 'The Operator shall deliver the agreed materials to the Requester within 30 days. The parties acknowledge the original description of the service and retain the relevant records for subsequent review. A practical correction can be discussed using the documented scope, resources, equipment, access, quality standards, preparation, communications, activities, available alternatives, and intended benefit. Every description of a difficulty includes enough context for each participant to understand what occurred during the service. The original task record remains available throughout that discussion together with photographs describing the relevant environment, documented observations, and the expected practical use of the delivered materials.';
const row = (id, text) => ({ id, contract_id: `contract-${id}`, source_url: `https://example.invalid/${id}`, text });

test('exact repetitions retain all records and references with input-order-stable IDs', () => {
  const rows = [row('b', paragraph), row('a', paragraph.replace(/ /g, '  ')), row('independent', 'A short independent provision concerning an unrelated object.')];
  const result = deduplicateUnits(rows);
  assert.equal(result.records.length, 3);
  assert.equal(result.stats.exact_duplicate_count, 1);
  assert.equal(result.families.length, 2);
  const repeated = result.families.find((family) => family.kind === 'exact');
  assert.deepEqual(repeated.members, ['a', 'b']);
  assert.equal(repeated.sources.length, 2);
  const reverse = deduplicateUnits([...rows].reverse());
  const summary = (value) => new Map(value.records.map((record) => [record.id, [record.family_id, record.template_blocking_id, record.duplicate_kind]]));
  assert.deepEqual(summary(result), summary(reverse));
});

test('numeric, modal, role and exception contrasts remain distinct duplicates but can share broader template blocking', () => {
  const rows = [row('base', paragraph), row('amount', paragraph.replace('30 days', '31 days')), row('modal', paragraph.replace('shall deliver', 'may deliver')), row('roles', paragraph.replace('Operator shall deliver the agreed materials to the Requester', 'Requester shall deliver the agreed materials to the Operator')), row('exception', paragraph.replace('within 30 days.', 'within 30 days, unless unsafe.'))];
  const result = deduplicateUnits(rows, { seed: 'contrasts', signatureSize: 64, bands: 32, threshold: 0.8, templateThreshold: 0.65 });
  assert.equal(result.records.length, 5);
  assert.equal(new Set(result.records.map((record) => record.family_id)).size, 5);
  assert.equal(result.records[0].template_blocking_id, result.records[1].template_blocking_id);
  assert.ok(result.near_matches.some((decision) => !decision.protected_tokens_equal && !decision.admitted_near_duplicate));
  assert.ok(result.template_families.some((family) => family.members.length > 1));
});

test('a minor noncritical variant can form a verified near family without dropping the variant', () => {
  const result = deduplicateUnits([row('one', paragraph), row('two', paragraph.replace('relevant environment', 'surrounding environment'))], { signatureSize: 64, bands: 32, threshold: 0.9 });
  assert.equal(result.families.length, 1);
  assert.equal(result.families[0].kind, 'guarded_near');
  assert.equal(result.records[1].duplicate_kind, 'near');
  assert.ok(result.audit.pairs.some((pair) => pair.admitted_near_duplicate && pair.original_jaccard >= 0.9));
});

test('hot buckets have bounded stored members and diagnostics while keeping all variants', () => {
  const rows = Array.from({ length: 22 }, (_, index) => row(`variant-${index}`, paragraph.replace('30 days', `${100 + index} days`)));
  const result = deduplicateUnits(rows, { maxBucketSize: 4, hotBucketAnchors: 2, maxAuditPairs: 5 });
  assert.equal(result.records.length, 22);
  assert.equal(result.families.length, 22);
  assert.equal(result.template_families.length, 1);
  assert.ok(result.audit.hot_buckets.length > 0);
  assert.ok(result.audit.hot_buckets.every((bucket) => bucket.stored_members <= 4 && bucket.anchor_ids.length <= 2));
  assert.ok(result.audit.pairs.length <= 5);
  assert.equal(result.audit.coverage_complete, false);
  assert.ok(result.records.every((record) => record.template_blocking_coarse));
});

test('declared candidate bounds are visible rather than silently claiming exhaustive duplicate coverage', () => {
  const rows = Array.from({ length: 12 }, (_, index) => row(`variant-${index}`, paragraph.replace('30 days', `${200 + index} days`)));
  const result = deduplicateUnits(rows, { maxCandidatePairs: 2 });
  assert.equal(result.stats.candidate_pairs_verified, 2);
  assert.equal(result.stats.candidate_limit_reached, true);
  assert.ok(result.audit.warnings.some((warning) => warning.code === 'CANDIDATE_PAIR_LIMIT'));
  assert.equal(result.records.length, 12);
});

test('invalid IDs and ambiguous operating parameters fail explicitly', () => {
  assert.throws(() => deduplicateUnits([row('same', paragraph), row('same', paragraph)]), /distinct/);
  assert.throws(() => deduplicateUnits([row('one', paragraph)], { signatureSize: 30, bands: 8 }), /divisible/);
  assert.throws(() => deduplicateUnits([row('one', paragraph)], { roleTerms: [''] }), /roleTerms/);
});
