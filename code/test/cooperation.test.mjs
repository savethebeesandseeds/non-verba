import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateTask,
  prepareAcceptance,
  prepareVote,
  priceForTime,
  quoteTask,
  settlementMinimum,
} from '../protocol/cooperation.mjs';

const NOW = 10_000;
const SCOPE = Object.freeze({
  agreementId: 'agreement-1',
  taskId: 'photograph',
  taskVersion: '1',
  jurisdiction: 'NO',
  region: 'oslo',
  counterpartyId: 'requester-1',
  currency: 'NOK',
});

// Synthetic fixtures are trusted ONLY inside these tests. Production adapters
// must verify authorization, eligibility, signatures, and ballot completeness.
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
    policyId: 'policy-1', version: 1, scope: { ...SCOPE },
    validFrom: 0, validUntil: NOW + 10_000,
    baselinePriceMinor: 100, baselineSeconds: 600,
    decayWindowSeconds: 1_000,
    minimumOperators: 1, minimumEffectiveVotes: 1,
    demandSensitivityBps: 2_000, maxDemandPremiumBps: 5_000,
    demandMaxAgeSeconds: 100, quoteLifetimeSeconds: 300,
    ...overrides,
  };
}

function operator(overrides = {}) {
  return { operatorId: 'alice', currency: 'NOK', rateMinorPerHour: 3_600, ...overrides };
}

function vote(id, overrides = {}) {
  const { rateMinorPerHour = 3_600, ...completionOverrides } = overrides;
  const completion = {
    scope: { ...SCOPE }, completionId: `completion-${id}`,
    assignmentId: `assignment-${id}`, operatorId: `operator-${id}`,
    completedAt: NOW, workedSeconds: 300, ...completionOverrides,
  };
  return prepareVote({
    completion,
    operator: operator({
      operatorId: completion.operatorId,
      currency: completion.scope.currency,
      rateMinorPerHour,
    }),
  });
}

function demand(overrides = {}) {
  return {
    scope: { ...SCOPE }, measuredAt: NOW, windowSeconds: 60,
    requestedSeconds: 200, availableSeconds: 100, ...overrides,
  };
}

function evaluate(overrides = {}, adapter = TRUST_FIXTURES) {
  return evaluateTask({ policy: policy(), votes: [], asOf: NOW, ...overrides }, adapter);
}

function acceptance(overrides = {}) {
  return prepareAcceptance({
    assignmentId: 'accepted-assignment', terms: evaluate(),
    operator: operator(), priceMinor: 601, at: NOW, ...overrides,
  });
}

test('money uses exact integer arithmetic and rounds fractional minor units upwards', () => {
  for (const [rate, seconds, expected] of [
    [1, 1, 1], [3_600, 1, 1], [3_601, 1, 2],
    [300, 1_800, 150], [101, 1_800, 51],
    [Number.MAX_SAFE_INTEGER, 3_600, Number.MAX_SAFE_INTEGER],
  ]) {
    assert.equal(priceForTime(rate, seconds), expected);
  }
  assert.throws(() => priceForTime(Number.MAX_SAFE_INTEGER, 3_601), /integer range/);
  for (const invalid of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => priceForTime(invalid, 1), /safe integer/);
    assert.throws(() => priceForTime(1, invalid), /safe integer/);
  }
});

test('a vote retains an immutable rate, time, price, and scope snapshot', () => {
  const person = operator();
  const completion = {
    scope: { ...SCOPE }, completionId: 'completion', assignmentId: 'assignment',
    operatorId: person.operatorId, completedAt: NOW, workedSeconds: 300,
  };
  const prepared = prepareVote({ completion, operator: person });
  person.rateMinorPerHour = 7_200;
  completion.workedSeconds = 900;
  completion.scope.taskVersion = '2';
  assert.equal(prepared.rateMinorPerHour, 3_600);
  assert.equal(prepared.workedSeconds, 300);
  assert.equal(prepared.priceMinor, 300);
  assert.equal(prepared.scope.taskVersion, '1');
  assert.ok(Object.isFrozen(prepared));
  assert.ok(Object.isFrozen(prepared.scope));
  assert.throws(() => { prepared.rateMinorPerHour = 1; }, TypeError);
  assert.equal(evaluate({ votes: [prepared] }).minimumPriceMinor, 300);
});

test('vote preparation binds the person and currency to the completion', () => {
  const completion = { ...vote('a') };
  assert.throws(() => prepareVote({ completion, operator: operator() }), /another operator/);
  assert.throws(() => prepareVote({
    completion, operator: operator({ operatorId: completion.operatorId, currency: 'EUR' }),
  }), /currency/);
});

test('every performance has equal initial weight, including repeat performances by one person', () => {
  const low = vote('a', { operatorId: 'alice', workedSeconds: 300 });
  const repeated = vote('b', { operatorId: 'alice', workedSeconds: 300 });
  const high = vote('c', { operatorId: 'bob', workedSeconds: 900 });
  const sharedPolicy = policy({ minimumOperators: 2, minimumEffectiveVotes: 2 });
  assert.equal(evaluate({ policy: sharedPolicy, votes: [low, high] }).medianPriceMinor, 900);
  const result = evaluate({ policy: sharedPolicy, votes: [low, repeated, high] });
  assert.equal(result.medianPriceMinor, 300);
  assert.equal(result.expectedSeconds, 300);
  assert.equal(result.activeVotes, 3);
  assert.equal(result.activeOperators, 2);
  assert.equal(result.weightNumerator, '3000');
  assert.equal(result.weightDenominator, '1000');
});

for (const [age, expectedMedian, expectedWeight] of [
  [400, 900, '2200'],
  [500, 900, '2000'], // Exact half-weight tie chooses the higher value.
  [501, 300, '1998'],
]) {
  test(`linear decay at age ${age} produces the exact weighted median`, () => {
    const votes = [
      vote('fresh', { workedSeconds: 300 }),
      vote('old-1', { workedSeconds: 900, completedAt: NOW - age }),
      vote('old-2', { workedSeconds: 900, completedAt: NOW - age }),
    ];
    for (const ordering of [votes, [...votes].reverse(), [votes[1], votes[0], votes[2]]]) {
      const result = evaluate({ votes: ordering });
      assert.equal(result.medianPriceMinor, expectedMedian);
      assert.equal(result.expectedSeconds, expectedMedian);
      assert.equal(result.weightNumerator, expectedWeight);
    }
  });
}

test('price and time are independent weighted medians', () => {
  const result = evaluate({ votes: [
    vote('a', { rateMinorPerHour: 36_000, workedSeconds: 60 }),
    vote('b', { workedSeconds: 300 }),
    vote('c', { workedSeconds: 400 }),
  ] });
  assert.equal(result.medianPriceMinor, 400);
  assert.equal(result.expectedSeconds, 300);
});

test('votes expire at the decay boundary and have positive weight immediately before it', () => {
  const almostExpired = evaluate({ votes: [vote('a', { completedAt: NOW - 999 })] });
  assert.equal(almostExpired.activeVotes, 1);
  assert.equal(almostExpired.weightNumerator, '1');
  const expired = evaluate({ votes: [vote('a', { completedAt: NOW - 1_000 })] });
  assert.equal(expired.activeVotes, 0);
  assert.equal(expired.activeOperators, 0);
  assert.equal(expired.weightNumerator, '0');
  assert.equal(expired.support, 'baseline-fallback');
});

test('future completions and both duplicate identifiers are rejected', () => {
  assert.throws(() => evaluate({ votes: [vote('future', { completedAt: NOW + 1 })] }), /future/);
  assert.throws(() => evaluate({ votes: [vote('a'), vote('b', { completionId: 'completion-a' })] }), /Duplicate completionId/);
  assert.throws(() => evaluate({ votes: [
    vote('a'), vote('b', { assignmentId: 'assignment-a', operatorId: 'operator-a' }),
  ] }), /same operator performance/);
  // Different people can legitimately perform the same assignment.
  assert.equal(evaluate({ votes: [vote('a'), vote('b', { assignmentId: 'assignment-a' })] }).activeVotes, 2);
});

for (const key of Object.keys(SCOPE)) {
  test(`ballots and demand cannot cross the ${key} boundary`, () => {
    const changed = { ...SCOPE, [key]: key === 'currency' ? 'EUR' : 'different' };
    assert.throws(() => evaluate({ votes: [vote('a', { scope: changed })] }), /scope does not match/);
    assert.throws(() => evaluate({ demand: demand({ scope: changed }) }), /scope does not match/);
  });
}

test('signed vote price must match its rate and time', () => {
  assert.throws(() => evaluate({ votes: [{ ...vote('a'), priceMinor: 301 }] }), /signed rate and time/);
});

test('unknown scope fields are rejected instead of silently ignored', () => {
  assert.throws(() => evaluate({
    policy: policy({ scope: { ...SCOPE, hiddenClassification: 'different' } }),
  }), /scope|Scope/);
});

for (const [name, requirements, votes] of [
  ['no ballots', {}, []],
  ['not enough distinct operators', { minimumOperators: 2 }, [vote('a'), vote('b', { operatorId: 'operator-a' })]],
  ['not enough effective votes', { minimumEffectiveVotes: 2 }, [vote('a')]],
  ['decayed support below quorum', { minimumEffectiveVotes: 2 }, [vote('a', { completedAt: NOW - 1 }), vote('b')]],
]) {
  test(`${name} falls back for both price and time`, () => {
    const result = evaluate({ policy: policy(requirements), votes });
    assert.equal(result.support, 'baseline-fallback');
    assert.equal(result.medianPriceMinor, null);
    assert.equal(result.basePriceMinor, 100);
    assert.equal(result.expectedSeconds, 600);
  });
}

test('quorum is inclusive and the agreed baseline protects against lower price votes', () => {
  const result = evaluate({
    policy: policy({ minimumOperators: 2, minimumEffectiveVotes: 2 }),
    votes: [vote('a', { workedSeconds: 50 }), vote('b', { workedSeconds: 50 })],
  });
  assert.equal(result.support, 'sufficient');
  assert.equal(result.medianPriceMinor, 50);
  assert.equal(result.minimumPriceMinor, 100);
  assert.equal(result.expectedSeconds, 50);
});

for (const [name, snapshot, configuration, premium, status] of [
  ['missing', null, {}, 0, 'missing'],
  ['stale at boundary', demand({ measuredAt: NOW - 100 }), {}, 0, 'stale'],
  ['balanced', demand({ requestedSeconds: 100 }), {}, 0, 'verified'],
  ['excess capacity', demand({ requestedSeconds: 20 }), {}, 0, 'verified'],
  ['ordinary shortage', demand(), {}, 2_000, 'verified'],
  ['capped shortage', demand({ requestedSeconds: 1_000 }), {}, 5_000, 'verified'],
  ['no demand and no capacity', demand({ requestedSeconds: 0, availableSeconds: 0 }), {}, 0, 'verified'],
  ['zero capacity', demand({ requestedSeconds: 1, availableSeconds: 0 }), {}, 5_000, 'verified'],
  ['zero sensitivity', demand(), { demandSensitivityBps: 0 }, 0, 'verified'],
  ['zero sensitivity and zero capacity', demand({ availableSeconds: 0 }), { demandSensitivityBps: 0 }, 0, 'verified'],
  ['zero premium cap', demand({ availableSeconds: 0 }), { maxDemandPremiumBps: 0 }, 0, 'verified'],
]) {
  test(`demand handling: ${name}`, () => {
    const result = evaluate({ policy: policy(configuration), demand: snapshot });
    assert.equal(result.premiumBps, premium);
    assert.equal(result.demandStatus, status);
    assert.equal(result.minimumPriceMinor, 100 + premium / 100);
    assert.equal(result.support, 'baseline-fallback');
  });
}

test('demand premium money is rounded upwards and overflow is rejected', () => {
  const result = evaluate({
    policy: policy({ baselinePriceMinor: 101 }),
    demand: demand({ requestedSeconds: 3, availableSeconds: 2 }),
  });
  assert.equal(result.premiumBps, 1_000);
  assert.equal(result.minimumPriceMinor, 112);
  assert.throws(() => evaluate({
    policy: policy({ baselinePriceMinor: Number.MAX_SAFE_INTEGER }), demand: demand(),
  }), /integer range/);
});

test('policy, quote lifetime, and demand freshness each constrain expiry', () => {
  assert.equal(evaluate().validUntil, NOW + 300);
  assert.equal(evaluate({ policy: policy({ validUntil: NOW + 5 }) }).validUntil, NOW + 5);
  assert.equal(evaluate({ demand: demand() }).validUntil, NOW + 100);
  assert.equal(evaluate({ demand: demand({ measuredAt: NOW - 99 }) }).validUntil, NOW + 1);
  assert.equal(evaluate({ demand: demand({ measuredAt: NOW - 100 }) }).validUntil, NOW + 300);
  assert.throws(() => evaluate({ demand: demand({ measuredAt: NOW + 1 }) }), /future/);
  assert.throws(() => evaluate({ asOf: NOW + 10_000 }), /not active/);
  assert.throws(() => evaluate({ policy: policy({ validFrom: NOW + 1 }) }), /not active/);
});

test('personal R can raise the quote but cannot lower the collective minimum', () => {
  const terms = evaluate();
  const low = quoteTask({ terms, operator: operator({ rateMinorPerHour: 100 }), at: NOW });
  assert.equal(low.personalPriceMinor, 17);
  assert.equal(low.minimumPriceMinor, 100);
  const high = quoteTask({ terms, operator: operator(), at: NOW });
  assert.equal(high.personalPriceMinor, 600);
  assert.equal(high.minimumPriceMinor, 600);
  assert.throws(() => quoteTask({ terms, operator: operator({ currency: 'EUR' }), at: NOW }), /currency/);
});

test('acceptance enforces the personal and collective minimum and permits higher offers', () => {
  assert.throws(() => acceptance({ priceMinor: 599 }), /below the applicable minimum/);
  assert.throws(() => acceptance({ operator: operator({ rateMinorPerHour: 100 }), priceMinor: 99 }), /below the applicable minimum/);
  assert.equal(acceptance({ priceMinor: 600 }).priceMinor, 600);
  assert.equal(acceptance({ priceMinor: 900 }).priceMinor, 900);
  assert.equal(acceptance({ at: NOW + 299 }).acceptedAt, NOW + 299);
  assert.throws(() => acceptance({ at: NOW + 300 }), /not current/);
  assert.throws(() => acceptance({ at: NOW - 1 }), /not current/);
});

test('acceptance locks the price, policy, and personal rate despite later changes or expiry', () => {
  const configuration = policy();
  const person = operator();
  const terms = evaluate({ policy: configuration });
  const accepted = acceptance({ terms, operator: person, at: terms.validUntil - 1 });
  configuration.version = 2;
  configuration.baselinePriceMinor = 10_000;
  person.rateMinorPerHour = 72_000;
  const later = evaluate({ policy: configuration, asOf: terms.validUntil + 1 });
  assert.equal(later.minimumPriceMinor, 10_000);
  assert.equal(accepted.terms.policyVersion, 1);
  assert.equal(accepted.rateMinorPerHour, 3_600);
  assert.ok(Object.isFrozen(accepted.terms.scope));
  assert.throws(() => { accepted.terms.minimumPriceMinor = 1; }, TypeError);
  assert.equal(settlementMinimum({ acceptance: accepted, approvedSeconds: 600 }, TRUST_FIXTURES), 601);
});

test('approved overruns scale the accepted offer, while faster work retains its price', () => {
  const accepted = acceptance();
  for (const [approvedSeconds, expected] of [[300, 601], [600, 601], [601, 603], [900, 902], [1_200, 1_202]]) {
    assert.equal(settlementMinimum({ acceptance: accepted, approvedSeconds }, TRUST_FIXTURES), expected);
  }
  assert.throws(() => settlementMinimum({ acceptance: accepted, approvedSeconds: 0 }, TRUST_FIXTURES), /safe integer/);
  const huge = acceptance({ priceMinor: Number.MAX_SAFE_INTEGER });
  assert.throws(() => settlementMinimum({ acceptance: huge, approvedSeconds: 601 }, TRUST_FIXTURES), /integer range/);
});

test('settlement requires verified acceptance and verified approved working time', () => {
  const input = { acceptance: acceptance(), approvedSeconds: 900 };
  for (const method of ['verifyAcceptance', 'verifyWorkingTime']) {
    assert.throws(() => settlementMinimum(input, { ...TRUST_FIXTURES, [method]: undefined }), new RegExp(method));
    assert.throws(() => settlementMinimum(input, { ...TRUST_FIXTURES, [method]: () => false }), new RegExp(method));
  }
  const calls = [];
  const result = settlementMinimum(input, {
    verifyAcceptance(record) {
      calls.push('acceptance');
      assert.deepEqual(record, input.acceptance);
      assert.ok(Object.isFrozen(record));
      return true;
    },
    verifyWorkingTime(record, approvedSeconds) {
      calls.push('time');
      assert.equal(record.assignmentId, input.acceptance.assignmentId);
      assert.equal(approvedSeconds, 900);
      return true;
    },
  });
  assert.equal(result, 902);
  assert.deepEqual(calls, ['acceptance', 'time']);
});

test('tampered acceptance price, scope, and expected time cannot pass settlement', () => {
  for (const changes of [
    { priceMinor: 1 },
    { scope: { ...SCOPE, taskVersion: '2' } },
    { expectedSeconds: 1 },
  ]) {
    assert.throws(() => settlementMinimum({
      acceptance: { ...acceptance(), ...changes }, approvedSeconds: 600,
    }, TRUST_FIXTURES), /minimum|scope mismatch|time mismatch/);
  }
});

test('all admission adapters are mandatory and must synchronously return exactly true', () => {
  const input = { votes: [vote('a')], demand: demand() };
  for (const method of ['verifyPolicy', 'verifyBallotSet', 'verifyVote', 'verifyDemand']) {
    assert.throws(() => evaluate(input, { ...TRUST_FIXTURES, [method]: undefined }), new RegExp(method));
    for (const returned of [false, undefined, 1, 'true', Promise.resolve(true)]) {
      assert.throws(() => evaluate(input, { ...TRUST_FIXTURES, [method]: () => returned }), new RegExp(method));
    }
  }
});

test('a claimed verified flag supplies no authority', () => {
  const input = {
    policy: { ...policy(), verified: true },
    votes: [{ ...vote('a'), verified: true }],
    demand: { ...demand(), verified: true },
  };
  assert.throws(() => evaluate(input, null), /Missing trusted adapter: verifyPolicy/);
  assert.throws(() => evaluate(input, { ...TRUST_FIXTURES, verifyVote: () => false }), /verifyVote/);
  assert.throws(() => settlementMinimum({
    acceptance: { ...acceptance(), verified: true }, approvedSeconds: 600,
  }, {}), /Missing trusted adapter: verifyAcceptance/);
});

test('adapters receive the full frozen ballot set including expired votes', () => {
  const votes = [vote('fresh'), vote('expired', { completedAt: NOW - 1_000 })];
  const checked = [];
  const adapter = {
    ...TRUST_FIXTURES,
    verifyPolicy(value, at) {
      assert.equal(value.policyId, 'policy-1');
      assert.equal(at, NOW);
      assert.ok(Object.isFrozen(value.scope));
      return true;
    },
    verifyBallotSet(received, agreement, at) {
      assert.deepEqual(received, votes);
      assert.equal(agreement.policyId, 'policy-1');
      assert.equal(at, NOW);
      assert.ok(Object.isFrozen(received));
      assert.ok(received.every(Object.isFrozen));
      checked.push('full-set');
      return true;
    },
    verifyVote(value, agreement) {
      assert.equal(agreement.policyId, 'policy-1');
      checked.push(value.completionId);
      return true;
    },
  };
  const result = evaluate({ votes }, adapter);
  assert.equal(result.activeVotes, 1);
  assert.deepEqual(checked, ['full-set', 'completion-fresh', 'completion-expired']);
});

test('a completeness verifier can reject an omitted ballot before aggregation', () => {
  const canonical = [vote('a'), vote('b')];
  const adapter = {
    ...TRUST_FIXTURES,
    verifyBallotSet(received) {
      return received.length === canonical.length
        && received.every((item, index) => item.completionId === canonical[index].completionId);
    },
  };
  assert.equal(evaluate({ votes: canonical }, adapter).activeVotes, 2);
  assert.throws(() => evaluate({ votes: canonical.slice(0, 1) }, adapter), /verifyBallotSet/);
});

test('enabled demand requires attested unavailability to prevent hiding a surge', () => {
  for (const verification of [undefined, () => false]) {
    assert.throws(() => evaluate({}, { ...TRUST_FIXTURES, verifyDemand: verification }), /verifyDemand/);
  }
  let calls = 0;
  evaluate({}, {
    ...TRUST_FIXTURES,
    verifyDemand(snapshot, agreement, at) {
      calls += 1;
      assert.equal(snapshot, null);
      assert.equal(agreement.policyId, 'policy-1');
      assert.equal(at, NOW);
      return true;
    },
  });
  assert.equal(calls, 1);
  for (const configuration of [{ demandSensitivityBps: 0 }, { maxDemandPremiumBps: 0 }]) {
    assert.equal(evaluate({ policy: policy(configuration) }, {
      ...TRUST_FIXTURES, verifyDemand: undefined,
    }).premiumBps, 0);
  }
});

test('supplied demand verification includes evaluation time even for stale or disabled demand', () => {
  for (const configuration of [{}, { demandSensitivityBps: 0 }]) {
    for (const measuredAt of [NOW, NOW - 100]) {
      const snapshot = demand({ measuredAt });
      let calls = 0;
      evaluate({ policy: policy(configuration), demand: snapshot }, {
        ...TRUST_FIXTURES,
        verifyDemand(received, agreement, at) {
          calls += 1;
          assert.deepEqual(received, snapshot);
          assert.equal(agreement.policyId, 'policy-1');
          assert.equal(at, NOW);
          return true;
        },
      });
      assert.equal(calls, 1);
    }
  }
});
