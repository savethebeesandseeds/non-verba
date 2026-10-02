// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  evaluateTask,
  prepareAcceptance,
  prepareVote,
  priceForTime,
  quoteTask,
  settlementMinimum,
} from '../protocol/cooperation.mjs';
import { cooperation_plan } from '../pkg/nonverba_cooperation.js';

const NOW = 10_000;
const SCOPE = Object.freeze({
  agreementId: 'agreement-wasm', taskId: 'photograph', taskVersion: '1',
  jurisdiction: 'NO', region: 'oslo', counterpartyId: 'requester-wasm', currency: 'NOK',
});

// This adapter trusts synthetic test records ONLY. A raw WASM plan is provisional:
// it performs calculations but authenticates no agreement, person, ballot, or time.
const TRUST_FIXTURES = Object.freeze({
  verifyPolicy: () => true,
  verifyBallotSet: () => true,
  verifyVote: () => true,
  verifyDemand: () => true,
  verifyAcceptance: () => true,
  verifyWorkingTime: () => true,
});

function policy(overrides = {}) {
  return {
    policyId: 'policy-wasm', version: 1, scope: { ...SCOPE },
    validFrom: 0, validUntil: NOW + 10_000,
    baselinePriceMinor: 100, baselineSeconds: 600,
    decayWindowSeconds: 1_000, minimumOperators: 1, minimumEffectiveVotes: 1,
    demandSensitivityBps: 2_000, maxDemandPremiumBps: 5_000,
    demandMaxAgeSeconds: 100, quoteLifetimeSeconds: 300,
    ...overrides,
  };
}

function operator(overrides = {}) {
  return { operatorId: 'alice', currency: 'NOK', rateMinorPerHour: 3_600, ...overrides };
}

function vote(id, overrides = {}) {
  const completion = {
    scope: { ...SCOPE }, completionId: `completion-${id}`, assignmentId: `assignment-${id}`,
    operatorId: `operator-${id}`, completedAt: NOW, workedSeconds: 300, ...overrides,
  };
  return prepareVote({ completion, operator: operator({ operatorId: completion.operatorId }) });
}

function rawPlan(operation, input) {
  return JSON.parse(cooperation_plan(operation, JSON.stringify(input)));
}

test('the compiled artifact is WebAssembly with a callable generated Rust export', async () => {
  const binary = await readFile(new URL('../pkg/nonverba_cooperation_bg.wasm', import.meta.url));
  assert.deepEqual([...binary.subarray(0, 8)], [0, 97, 115, 109, 1, 0, 0, 0]);
  const compiled = await WebAssembly.compile(binary);
  assert.ok(WebAssembly.Module.exports(compiled).some(item => item.name === 'cooperation_plan'));
  assert.equal(typeof cooperation_plan, 'function');
  assert.deepEqual(rawPlan('priceForTime', { rateMinorPerHour: 3_601, seconds: 1 }), {
    value: 2, checks: [],
  });
});

test('raw Rust/WASM entry enforces safe integers without JavaScript validation', () => {
  for (const invalid of [0, -1, 0.5, null, true, '3600', Number.MAX_SAFE_INTEGER + 1]) {
    for (const field of ['rateMinorPerHour', 'seconds']) {
      assert.throws(() => rawPlan('priceForTime', {
        rateMinorPerHour: 3_600, seconds: 1, [field]: invalid,
      }));
    }
  }
  // Use literal JSON to ensure the integer is never rounded by JavaScript first.
  assert.throws(() => cooperation_plan('priceForTime', '{"rateMinorPerHour":9007199254740993,"seconds":1}'));
  const exact = rawPlan('priceForTime', { rateMinorPerHour: Number.MAX_SAFE_INTEGER, seconds: 3_600 });
  assert.equal(exact.value, Number.MAX_SAFE_INTEGER);
  assert.equal(priceForTime(Number.MAX_SAFE_INTEGER, 3_600), exact.value);
  assert.throws(() => rawPlan('priceForTime', {
    rateMinorPerHour: Number.MAX_SAFE_INTEGER, seconds: 3_601,
  }), /integer range/);
});

test('a raw evaluation returns required checks and remains provisional until admission', () => {
  const input = { policy: policy(), votes: [vote('a')], asOf: NOW };
  const plan = rawPlan('evaluateTask', input);
  assert.deepEqual(plan.checks.map(check => check.method), [
    'verifyPolicy', 'verifyBallotSet', 'verifyVote', 'verifyDemand',
  ]);
  assert.deepEqual(plan.checks[0].paths, [['policy'], ['asOf']]);
  assert.deepEqual(plan.checks[1].paths, [['votes'], ['policy'], ['asOf']]);
  assert.deepEqual(plan.checks[2].paths, [['votes', 0], ['policy']]);
  assert.deepEqual(plan.checks[3].paths, [['demand'], ['policy'], ['asOf']]);
  assert.throws(() => evaluateTask(input, {}), /Missing trusted adapter/);
  assert.deepEqual(evaluateTask(input, TRUST_FIXTURES), plan.value);
});

test('Rust plans and admission adapters preserve full proof and signature metadata', () => {
  const input = {
    policy: {
      ...policy(),
      authorization: { signatures: [{ keyId: 'policy-key', signature: 'synthetic-policy-signature' }] },
    },
    votes: [{
      ...vote('signed'),
      eligibilityProof: { issuer: 'synthetic-issuer', claims: ['eligible'] },
      signature: 'synthetic-vote-signature',
    }],
    asOf: NOW,
    demand: {
      scope: { ...SCOPE }, measuredAt: NOW, windowSeconds: 60,
      requestedSeconds: 200, availableSeconds: 100,
      evidence: { root: 'synthetic-demand-root', witnesses: ['a', 'b'] },
    },
  };
  const unchanged = structuredClone(input);
  const plan = rawPlan('evaluateTask', input);
  assert.deepEqual(plan.checks[0].paths[0], ['policy']);
  assert.deepEqual(plan.checks[1].paths[0], ['votes']);
  assert.deepEqual(plan.checks[2].paths[0], ['votes', 0]);
  assert.deepEqual(plan.checks[3].paths[0], ['demand']);
  const verified = [];
  const terms = evaluateTask(input, {
    verifyPolicy(received, at) {
      assert.deepEqual(received, input.policy);
      assert.equal(at, NOW);
      assert.ok(Object.isFrozen(received.authorization.signatures));
      verified.push('policy');
      return true;
    },
    verifyBallotSet(received, agreement, at) {
      assert.deepEqual(received, input.votes);
      assert.deepEqual(agreement, input.policy);
      assert.equal(at, NOW);
      assert.ok(Object.isFrozen(received[0].eligibilityProof.claims));
      verified.push('ballots');
      return true;
    },
    verifyVote(received, agreement) {
      assert.deepEqual(received, input.votes[0]);
      assert.deepEqual(agreement, input.policy);
      assert.throws(() => { received.signature = 'changed'; }, TypeError);
      verified.push('vote');
      return true;
    },
    verifyDemand(received, agreement, at) {
      assert.deepEqual(received, input.demand);
      assert.deepEqual(agreement, input.policy);
      assert.equal(at, NOW);
      assert.ok(Object.isFrozen(received.evidence.witnesses));
      verified.push('demand');
      return true;
    },
  });
  assert.deepEqual(verified, ['policy', 'ballots', 'vote', 'demand']);
  assert.deepEqual(terms, plan.value);
  assert.deepEqual(input, unchanged);
});

test('proof metadata survives nested terms in quotes, acceptances, and settlement checks', () => {
  const terms = {
    ...evaluateTask({ policy: policy(), votes: [], asOf: NOW }, TRUST_FIXTURES),
    authentication: { signer: 'synthetic-terms-key', signature: 'synthetic-terms-signature', chain: ['proof-1'] },
  };
  const person = operator();
  const quoted = quoteTask({ terms, operator: person, at: NOW });
  assert.deepEqual(quoted.terms, terms);
  assert.ok(Object.isFrozen(quoted.terms.authentication.chain));
  const prepared = prepareAcceptance({
    assignmentId: 'signed-assignment', terms, operator: person, priceMinor: 601, at: NOW,
  });
  assert.deepEqual(prepared.terms, terms);
  assert.ok(Object.isFrozen(prepared.terms.authentication));
  const signed = {
    ...prepared,
    signatures: { operator: 'synthetic-operator-signature', requester: 'synthetic-requester-signature' },
    timeApproval: { witness: 'synthetic-time-witness', reference: 'approved-time-1' },
  };
  const raw = rawPlan('settlementMinimum', { acceptance: signed, approvedSeconds: 900 });
  assert.deepEqual(raw.checks.map(check => check.method), ['verifyAcceptance', 'verifyWorkingTime']);
  assert.deepEqual(raw.checks[0].paths, [['acceptance']]);
  assert.deepEqual(raw.checks[1].paths, [['acceptance'], ['approvedSeconds']]);
  const settled = settlementMinimum({ acceptance: signed, approvedSeconds: 900 }, {
    verifyAcceptance(received) {
      assert.deepEqual(received, signed);
      assert.ok(Object.isFrozen(received.signatures));
      return true;
    },
    verifyWorkingTime(received, seconds) {
      assert.deepEqual(received, signed);
      assert.equal(seconds, 900);
      assert.ok(Object.isFrozen(received.terms.authentication.chain));
      return true;
    },
  });
  assert.equal(settled, 902);
  assert.equal(raw.value, settled);
  terms.authentication.chain.push('later-change');
  assert.deepEqual(prepared.terms.authentication.chain, ['proof-1']);
});

test('aggregate vote weights exceed JavaScript safe integers without losing precision', () => {
  const input = {
    policy: policy({ decayWindowSeconds: Number.MAX_SAFE_INTEGER, minimumEffectiveVotes: 2 }),
    votes: [
      vote('fresh', { workedSeconds: 300 }),
      vote('older', { workedSeconds: 600, completedAt: NOW - 1 }),
      vote('oldest', { workedSeconds: 900, completedAt: NOW - 2 }),
    ],
    asOf: NOW,
  };
  const raw = rawPlan('evaluateTask', input);
  const admitted = evaluateTask(input, TRUST_FIXTURES);
  assert.deepEqual(admitted, raw.value);
  assert.equal(admitted.weightNumerator, '27021597764222970');
  assert.equal(admitted.weightDenominator, '9007199254740991');
  assert.equal(admitted.support, 'sufficient');
  assert.equal(admitted.medianPriceMinor, 600);
  assert.equal(admitted.expectedSeconds, 600);
});

test('verification plans reference records without duplicating policy proof metadata per vote', () => {
  const proof = 'synthetic-large-policy-proof-'.repeat(4_096);
  const votes = Array.from({ length: 100 }, (_, index) => vote(index));
  const plan = rawPlan('evaluateTask', {
    policy: policy({ authorization: { proof } }), votes, asOf: NOW,
  });
  assert.equal(plan.checks.length, votes.length + 3);
  assert.deepEqual(plan.checks.at(-2), {
    method: 'verifyVote', paths: [['votes', 99], ['policy']],
  });
  const encoded = JSON.stringify(plan);
  assert.ok(!encoded.includes('synthetic-large-policy-proof-'));
  assert.ok(encoded.length < proof.length, 'the complete plan is smaller than one copy of the proof');
});
