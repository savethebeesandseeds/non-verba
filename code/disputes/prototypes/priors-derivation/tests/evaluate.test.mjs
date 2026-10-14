// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateCandidates, evaluateCandidateReview } from '../lib/evaluate.mjs';

const probes = JSON.parse(await readFile(new URL('../fixtures/meaning-probes.json', import.meta.url), 'utf8'));
const clauses = [
  { id: 'clause-a', contract_id: 'contract-a', text: 'The parties shall promptly give notice of a defect and consider a bounded opportunity to correct the agreed work.', duplicate_family: 'family-a' },
  { id: 'clause-b', contract_id: 'contract-b', text: 'Any proposed correction shall remain within the original agreed scope and requires reasonable access to the work area.', duplicate_family: 'family-b' },
  { id: 'clause-holdout', contract_id: 'contract-holdout', text: 'A reported defect can be reviewed with the opportunity for a practical correction before ending the arrangement.', duplicate_family: 'family-holdout' },
];
const clusters = [{ id: 'cluster-notice', member_ids: ['clause-a', 'clause-b'] }, { id: 'cluster-other', member_ids: [] }];
const context = { clauses, clusters };
const candidate = (id = 'candidate-notice') => ({
  id, name: 'Notice and bounded correction', status: 'AGENT_DRAFT_REQUIRES_OWNER_REVIEW',
  declaration: 'When a relevant defect is reported, a practical opportunity to discuss a bounded correction should be considered.',
  contrast: { higher: 'Give a relevant, feasible correction opportunity more attention when comparing available paths.', lower: 'Give that opportunity less attention while retaining exact requirements, evidence and protected rights.' },
  scope: ['procedure', 'remedy'], boundaries: ['This does not establish that a proposed correction will succeed or require indefinite unpaid work.'],
  nearest_confusions: [{ name: 'Reasonable effort', difference: 'Work already performed and a proposed opportunity for later correction answer different questions.' }],
  support: [{ clause_id: 'clause-a', cluster_id: 'cluster-notice', reason: 'The clause pairs defect notice with consideration of a bounded opportunity to correct the work.', excerpt: 'promptly give notice of a defect' }],
  counterexamples: ['A proposal to repaint an entire home exceeds a one-wall scope unless a new agreement is made.'],
  domain_limits: ['Corporate notice deadlines and legal remedies do not transfer automatically into small service assignments.'],
});

test('complete agent drafts pass structure without acquiring semantic validity or adoption', () => {
  const result = validateCandidates([candidate()], context);
  assert.equal(result.valid, true);
  assert.equal(result.status, 'STRUCTURALLY_COMPLETE_DRAFTS');
  assert.equal(result.semantic_meaning_validated, false);
  assert.equal(result.adopted_catalog, false);
  assert.equal(result.authority, 'NONE');
  assert.equal(result.candidate_checks[0].resolved_support[0].partition, 'fit');
  assert.equal(result.candidate_checks[0].resolved_support[0].excerpt_checked, true);
});

test('unknown, duplicate and falsely assigned support IDs are rejected independently', () => {
  const cases = [
    [({ support }) => { support[0].clause_id = 'unknown'; }, 'UNKNOWN_SUPPORT_CLAUSE'],
    [({ support }) => { support[0].cluster_id = 'unknown'; }, 'UNKNOWN_SUPPORT_CLUSTER'],
    [({ support }) => { support[0].cluster_id = 'cluster-other'; }, 'SUPPORT_OUTSIDE_CLUSTER'],
    [({ support }) => { support.push(structuredClone(support[0])); }, 'DUPLICATE_SUPPORT_ID'],
    [({ nearest_confusions }) => { nearest_confusions[0].candidate_id = 'unknown'; }, 'UNKNOWN_CONFUSION_CANDIDATE'],
    [(value) => { value.counterexamples = [{ clause_id: 'unknown', reason: 'This claimed counterexample lacks a retained source record.' }]; }, 'UNKNOWN_COUNTEREXAMPLE_CLAUSE'],
  ];
  for (const [mutate, code] of cases) {
    const value = candidate(); mutate(value);
    const result = validateCandidates([value], context);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.code === code), code);
  }
  assert.ok(validateCandidates([candidate(), candidate()], context).errors.some((error) => error.code === 'DUPLICATE_CANDIDATE_ID'));
});

test('generic reasons and invented excerpts cannot become grounded support by possessing valid IDs', () => {
  const generic = candidate(); generic.support[0].reason = 'Relevant.';
  assert.ok(validateCandidates([generic], context).errors.some((error) => error.code === 'GROUNDED_REASON_REQUIRED'));
  const invented = candidate(); invented.support[0].excerpt = 'The Operator is automatically entitled to full payment.';
  assert.ok(validateCandidates([invented], context).errors.some((error) => error.code === 'EXCERPT_NOT_IN_SOURCE'));
});

test('explicit held-out assignments supply membership without modifying fitted cluster members', () => {
  const value = candidate(); value.support = [{ clause_id: 'clause-holdout', cluster_id: 'cluster-notice', partition: 'holdout', reason: 'This retained holdout clause describes a practical correction opportunity after a reported defect.' }];
  assert.equal(validateCandidates([value], context).valid, false);
  const assignments = [{ clause_id: 'clause-holdout', cluster_id: 'cluster-notice', partition: 'holdout' }];
  const result = validateCandidates([value], { ...context, assignments });
  assert.equal(result.valid, true);
  assert.equal(result.candidate_checks[0].resolved_support[0].partition, 'holdout');
  assert.deepEqual(clusters[0].member_ids, ['clause-a', 'clause-b']);
  value.support[0].partition = 'fit';
  assert.ok(validateCandidates([value], { ...context, assignments }).errors.some((error) => error.code === 'SUPPORT_PARTITION_MISMATCH'));
});

test('required contrast, scope, challenge, domain and draft status remain explicit', () => {
  const cases = [['boundaries', [], 'REQUIRED_TEXT_LIST'], ['domain_limits', [], 'REQUIRED_TEXT_LIST'], ['counterexamples', [], 'COUNTEREXAMPLES_REQUIRED'], ['scope', ['payment'], 'EXPLICIT_SCOPE_REQUIRED'], ['status', 'ADOPTED', 'DRAFT_STATUS_REQUIRED'], ['contrast', { higher: 'Same statement.', lower: 'Same statement.' }, 'IDENTICAL_CONTRAST']];
  for (const [field, replacement, code] of cases) {
    const value = candidate(); value[field] = replacement;
    const result = validateCandidates([value], context);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.code === code));
  }
  assert.equal(validateCandidates([], context).status, 'NO_CANDIDATES_SUBMITTED');
});

test('evaluation describes overlapping source support and schedules unexecuted interpretation questions', () => {
  const first = candidate('candidate-first');
  const second = candidate('candidate-second');
  second.support.push({ clause_id: 'clause-b', cluster_id: 'cluster-notice', reason: 'This second source explicitly constrains any correction by the original scope and reasonable access.' });
  const result = evaluateCandidateReview([first, second], context, probes);
  assert.equal(result.status, 'STRUCTURAL_REVIEW_READY_HUMAN_EVALUATION_NOT_RUN');
  assert.equal(result.support_diversity[1].distinct_contract_count, 2);
  assert.equal(result.citation_overlap[0].shared_clause_ids[0], 'clause-a');
  assert.equal(result.probe_validation.pair_count, 12);
  assert.equal(result.probe_validation.situation_count, 24);
  assert.equal(result.probe_schedule.length, 24);
  assert.ok(result.probe_schedule.every((entry) => entry.status === 'NOT_RUN' && entry.applicable === null && entry.response === null));
  assert.ok(result.unanswered_human_review_questions.every((entry) => entry.status === 'UNANSWERED' && entry.response === null));
  assert.equal(result.summary.semantic_checks_executed, 0);
  assert.equal(result.semantic_evaluation_status, 'NOT_RUN');
  assert.equal(result.authority, 'NONE');
});

test('synthetic paired situations share concrete terms and keep possible beneficiaries distinct from expected outcomes', () => {
  assert.equal(probes.data_classification, 'DECLARED_SYNTHETIC');
  for (const pair of probes.pairs) {
    assert.ok(pair.assignment_contract.task && pair.assignment_contract.acceptance && pair.assignment_contract.scope);
    assert.equal(pair.situations.length, 2);
    assert.equal(new Set(pair.situations.map((situation) => situation.declarer_role)).size, 1);
    assert.deepEqual(new Set(pair.situations.map((situation) => situation.potential_beneficiary)), new Set(['declarer', 'counterparty']));
    assert.ok(pair.situations.every((situation) => situation.established_facts.length && situation.disputed_claims.length && Array.isArray(situation.unknowns)));
    assert.ok(pair.situations.every((situation) => !Object.hasOwn(situation, 'expected_outcome') && !Object.hasOwn(situation, 'payout')));
  }
  const corrupted = structuredClone(probes); corrupted.pairs[0].situations[1].potential_beneficiary = 'declarer';
  assert.equal(evaluateCandidateReview([candidate()], context, corrupted).status, 'REVIEW_INPUT_INCOMPLETE');
});

test('review-ready label requires a synthetic probe packet rather than treating absent probes as executed evaluation', () => {
  const result = evaluateCandidateReview([candidate()], context, undefined);
  assert.equal(result.status, 'REVIEW_INPUT_INCOMPLETE');
  assert.equal(result.probe_schedule.length, 0);
  assert.equal(result.semantic_evaluation_status, 'NOT_RUN');
});
