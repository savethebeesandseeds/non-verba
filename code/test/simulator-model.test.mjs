import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimulation } from '../simulator/model.mjs';

const DAY = 86_400;

function customConfig() {
  const config = JSON.parse(JSON.stringify(createSimulation().config));
  config.locale = 'en-US';
  config.currency = 'USD';
  config.clock = { startsAt: '2027-01-15T09:30:00Z', timelineDays: 14, seedVoteAgeDays: 2 };
  config.scope = { jurisdiction: 'US', region: 'Test district', counterpartyId: 'fictional-client' };
  config.policy = {
    validityDays: 60, decayDays: 7, minimumOperators: 2, minimumEffectiveVotes: 1,
    demandSensitivityBps: 1_000, maxDemandPremiumBps: 2_000,
    demandMaxAgeSeconds: 20, quoteLifetimeSeconds: 30,
  };
  config.demand = { requestedMinutes: 120, availableMinutes: 60, windowMinutes: 15 };
  config.limits = {
    rateMinorPerHour: 20_000, baselinePriceMinor: 10_000,
    workMinutes: 120, demandMinutes: 1_000, decayDays: 90,
  };
  config.operators = [
    { operatorId: 'dex', name: 'Dex', rateMinorPerHour: 6_000 },
    { operatorId: 'ella', name: 'Ella', rateMinorPerHour: 9_000 },
  ];
  config.tasks = [
    { taskId: 'record-review', taskVersion: '2', name: 'Record review', baselinePriceMinor: 1_000, baselineMinutes: 20 },
    { taskId: 'visit', taskVersion: '3', name: 'Site visit', baselinePriceMinor: 1_500, baselineMinutes: 10 },
  ];
  return config;
}

test('seeded scenario uses the Rust evaluator for collective and personal quotes', () => {
  const view = createSimulation().view();
  assert.equal(view.taskId, 'site-photo');
  assert.equal(view.votes.length, 3);
  assert.equal(view.terms.support, 'sufficient');
  assert.equal(view.terms.medianPriceMinor, 15_000);
  assert.equal(view.terms.expectedSeconds, 1_800);
  assert.equal(view.terms.premiumBps, 2_500);
  assert.equal(view.terms.minimumPriceMinor, 18_750);
  assert.equal(view.quotes.ana.minimumPriceMinor, 18_750);
  assert.equal(view.terms.demandStatus, 'verified');
});

test('personal R is general but prior performance votes remain immutable', () => {
  const simulation = createSimulation();
  const original = simulation.view();
  const changed = simulation.updateOperator('ana', 50_000);
  assert.deepEqual(changed.votes, original.votes);
  assert.equal(changed.quotes.ana.minimumPriceMinor, 25_000);
  assert.equal(changed.terms.minimumPriceMinor, original.terms.minimumPriceMinor);
  const otherTask = simulation.setTask('audio-inspection');
  assert.equal(otherTask.operators.find(person => person.operatorId === 'ana').rateMinorPerHour, 50_000);
  assert.equal(otherTask.votes.find(vote => vote.operatorId === 'ana').rateMinorPerHour, 30_000);
});

test('each repeat completion is one distinct vote with current personal R and worked time', () => {
  const simulation = createSimulation();
  simulation.updateOperator('ana', 40_000);
  simulation.complete('ana', 900);
  const view = simulation.complete('ana', 1_800);
  assert.equal(view.votes.length, 5);
  assert.equal(new Set(view.votes.map(vote => vote.completionId)).size, 5);
  assert.equal(new Set(view.votes.map(vote => vote.assignmentId)).size, 5);
  assert.equal(view.terms.activeVotes, 5);
  assert.equal(view.terms.activeOperators, 3);
  assert.equal(view.votes.at(-2).priceMinor, 10_000);
  assert.equal(view.votes.at(-1).priceMinor, 20_000);
  assert.equal(view.votes.at(-1).completedAt, view.now);
});

test('task policy, demand, completion and acceptance state are isolated', () => {
  const simulation = createSimulation();
  simulation.updatePolicy({ baselinePriceMinor: 20_000 });
  simulation.updateDemand({ requestedSeconds: 0 });
  simulation.complete('ana', 900);
  const photo = simulation.accept('ana', 20_000);
  const audio = simulation.setTask('audio-inspection');
  assert.equal(audio.policy.baselinePriceMinor, 6_000);
  assert.equal(audio.policy.version, 1);
  assert.equal(audio.demand.requestedSeconds, 14_400);
  assert.equal(audio.votes.length, 3);
  assert.equal(audio.acceptance, null);
  assert.notDeepEqual(audio.scope, photo.scope);
  assert.deepEqual(simulation.setTask('site-photo'), photo);
});

test('old votes lose effective support and expire while the baseline remains protected', () => {
  const simulation = createSimulation();
  const reduced = simulation.setDay(10);
  assert.equal(reduced.terms.activeVotes, 3);
  assert.equal(reduced.terms.support, 'baseline-fallback');
  assert.equal(reduced.terms.minimumPriceMinor, 15_000);
  const expired = simulation.setDay(29);
  assert.equal(expired.votes.length, 3);
  assert.equal(expired.terms.activeVotes, 0);
  assert.equal(expired.terms.minimumPriceMinor, 15_000);
  assert.equal(expired.policy.decayWindowSeconds, 30 * DAY);
  assert.equal(simulation.setDay(60).terms.support, 'baseline-fallback');
});

test('time scrubbing excludes future completions without deleting them', () => {
  const simulation = createSimulation();
  simulation.setDay(20);
  const future = simulation.complete('ana', 600).votes.at(-1);
  assert.equal(simulation.setDay(0).votes.length, 3);
  const restored = simulation.setDay(20);
  assert.equal(restored.votes.length, 4);
  assert.deepEqual(restored.votes.at(-1), future);
  assert.equal(restored.demand.measuredAt, restored.now);
});

test('accepted terms and settlement remain locked across policy, R, demand and date changes', () => {
  const simulation = createSimulation();
  const original = simulation.accept('ana', 20_000).acceptance;
  simulation.updatePolicy({ baselinePriceMinor: 50_000, baselineSeconds: 3_600 });
  simulation.updateOperator('ana', 100_000);
  simulation.updateDemand({ availableSeconds: 0 });
  simulation.setDay(60);
  const settled = simulation.settle(2_700);
  assert.deepEqual(settled.acceptance, original);
  assert.equal(settled.acceptance.rateMinorPerHour, 30_000);
  assert.equal(settled.acceptance.terms.policyVersion, 1);
  assert.equal(settled.settlement, 30_000);
  assert.equal(simulation.settle(900).settlement, 20_000);
});

test('acceptance is hidden before its date and cannot be settled or silently replaced', () => {
  const simulation = createSimulation();
  simulation.setDay(5);
  const accepted = simulation.accept('ana', 20_000).acceptance;
  simulation.settle(1_800);
  const earlier = simulation.setDay(0);
  assert.equal(earlier.acceptance, null);
  assert.equal(earlier.settlement, null);
  assert.throws(() => simulation.settle(1_800), /Accept an assignment/);
  assert.throws(() => simulation.accept('ben', 20_000), /already has a simulated acceptance/);
  const restored = simulation.setDay(5);
  assert.deepEqual(restored.acceptance, accepted);
  assert.equal(restored.settlement, 20_000);
});

test('maximum rate, work time and demand can produce an acceptable quote above the baseline cap', () => {
  const simulation = createSimulation();
  simulation.updatePolicy({ baselinePriceMinor: 100_000_000, baselineSeconds: DAY });
  simulation.updateDemand({ requestedSeconds: 1, availableSeconds: 0 });
  for (const id of ['ana', 'ben', 'cleo']) {
    simulation.updateOperator(id, 100_000_000);
    simulation.complete(id, DAY);
  }
  const quoted = simulation.view();
  assert.equal(quoted.terms.expectedSeconds, DAY);
  assert.equal(quoted.terms.minimumPriceMinor, 3_600_000_000);
  assert.equal(quoted.quotes.ana.minimumPriceMinor, 3_600_000_000);
  const before = simulation.exportSnapshot();
  assert.throws(() => simulation.accept('ana', 3_600_000_001), /Accepted price/);
  assert.deepEqual(simulation.exportSnapshot(), before);
  const accepted = simulation.accept('ana', quoted.quotes.ana.minimumPriceMinor);
  assert.equal(accepted.acceptance.priceMinor, 3_600_000_000);
  assert.equal(simulation.settle(DAY).settlement, 3_600_000_000);
});

test('under-floor acceptance and invalid mutations leave the entire scenario unchanged', () => {
  const simulation = createSimulation();
  const before = simulation.exportSnapshot();
  const actions = [
    () => simulation.accept('ana', 1),
    () => simulation.complete('ana', 0),
    () => simulation.complete('unknown', 100),
    () => simulation.updateOperator('ana', Infinity),
    () => simulation.updateOperator('unknown', 100),
    () => simulation.updatePolicy({ baselinePriceMinor: 20_000, baselineSeconds: -1 }),
    () => simulation.updatePolicy({ minimumOperators: 1 }),
    () => simulation.updateDemand({ requestedSeconds: 1, availableSeconds: -1 }),
    () => simulation.setTask('toString'),
    () => simulation.setDay(61),
    () => simulation.setDay(0.5),
    () => simulation.settle(1_800),
  ];
  for (const action of actions) {
    assert.throws(action);
    assert.deepEqual(simulation.exportSnapshot(), before);
  }
});

test('snapshots cannot mutate the model and export labels fictional assumptions', () => {
  const simulation = createSimulation();
  const view = simulation.view();
  assert.throws(() => { view.policy.baselinePriceMinor = 1; }, TypeError);
  assert.throws(() => { view.operators[0].rateMinorPerHour = 1; }, TypeError);
  assert.throws(() => view.votes.pop(), TypeError);
  const exported = JSON.parse(JSON.stringify(simulation.exportSnapshot()));
  assert.equal(exported.simulation, true);
  assert.equal(exported.current.terms.minimumPriceMinor, 18_750);
  assert.ok(exported.assumptions.some(text => text.includes('unsigned')));
  assert.ok(exported.assumptions.some(text => text.includes('legal eligibility')));
});

test('reset clears all task histories and settings reproducibly', () => {
  const simulation = createSimulation();
  const original = simulation.exportSnapshot();
  simulation.complete('ana', 100);
  simulation.accept('ana', 20_000);
  simulation.settle(2_700);
  simulation.setTask('audio-inspection');
  simulation.updateOperator('ben', 60_000);
  simulation.updatePolicy({ baselineSeconds: 900 });
  simulation.setDay(50);
  simulation.reset();
  assert.deepEqual(simulation.exportSnapshot(), original);
});

test('custom configuration controls tasks, operators, scope, clock, policy and demand', () => {
  const config = customConfig();
  const simulation = createSimulation(config);
  const view = simulation.view();
  assert.equal(view.taskId, 'record-review');
  assert.equal(view.taskName, 'Record review');
  assert.equal(view.scope.taskVersion, '2');
  assert.equal(view.scope.jurisdiction, 'US');
  assert.equal(view.scope.region, 'Test district');
  assert.equal(view.scope.counterpartyId, 'fictional-client');
  assert.equal(view.scope.currency, 'USD');
  assert.equal(view.now, Date.parse(config.clock.startsAt) / 1_000);
  assert.equal(view.votes[0].completedAt, view.now - 2 * DAY);
  assert.deepEqual(view.operators.map(operator => operator.operatorId), ['dex', 'ella']);
  assert.ok(view.operators.every(operator => operator.currency === 'USD'));
  assert.equal(view.policy.validUntil, view.now + 60 * DAY);
  assert.equal(view.policy.decayWindowSeconds, 7 * DAY);
  assert.equal(view.policy.minimumOperators, 2);
  assert.equal(view.policy.minimumEffectiveVotes, 1);
  assert.equal(view.policy.demandSensitivityBps, 1_000);
  assert.equal(view.policy.maxDemandPremiumBps, 2_000);
  assert.equal(view.policy.demandMaxAgeSeconds, 20);
  assert.equal(view.policy.quoteLifetimeSeconds, 30);
  assert.equal(view.demand.requestedSeconds, 7_200);
  assert.equal(view.demand.availableSeconds, 3_600);
  assert.equal(view.demand.windowSeconds, 900);
  assert.equal(view.terms.minimumPriceMinor, 3_300);
  assert.equal(view.terms.expectedSeconds, 1_200);
  assert.equal(view.terms.validUntil, view.now + 20);
  const otherTask = simulation.setTask('visit');
  assert.equal(otherTask.scope.taskVersion, '3');
  assert.equal(otherTask.policy.baselinePriceMinor, 1_500);
  assert.equal(otherTask.policy.baselineSeconds, 600);
  assert.equal(otherTask.votes.length, 2);
  assert.equal(simulation.setDay(14).now, view.now + 14 * DAY);
});

test('custom limits and the derived offer cap govern mutations transactionally', () => {
  const simulation = createSimulation(customConfig());
  const before = simulation.exportSnapshot();
  for (const action of [
    () => simulation.setDay(15),
    () => simulation.updateOperator('dex', 20_001),
    () => simulation.updatePolicy({ baselinePriceMinor: 10_001 }),
    () => simulation.updatePolicy({ baselineSeconds: 7_201 }),
    () => simulation.updatePolicy({ decayWindowSeconds: 90 * DAY + 1 }),
    () => simulation.updateDemand({ requestedSeconds: 60_001 }),
    () => simulation.complete('dex', 7_201),
    () => simulation.accept('dex', 48_001),
  ]) {
    assert.throws(action);
    assert.deepEqual(simulation.exportSnapshot(), before);
  }
  simulation.updatePolicy({ baselinePriceMinor: 10_000, baselineSeconds: 7_200, decayWindowSeconds: 90 * DAY });
  simulation.updateDemand({ requestedSeconds: 60_000, availableSeconds: 0 });
  for (const id of ['dex', 'ella']) {
    simulation.updateOperator(id, 20_000);
    simulation.complete(id, 7_200);
  }
  assert.equal(simulation.view().quotes.dex.minimumPriceMinor, 48_000);
  simulation.accept('dex', 48_000);
  const accepted = simulation.exportSnapshot();
  assert.throws(() => simulation.settle(7_201));
  assert.deepEqual(simulation.exportSnapshot(), accepted);
  assert.equal(simulation.settle(7_200).settlement, 48_000);
});

test('an instance owns its frozen configuration and reset restores that configuration', () => {
  const input = customConfig();
  const simulation = createSimulation(input);
  const initial = simulation.exportSnapshot();
  input.currency = 'EUR';
  input.operators[0].rateMinorPerHour = 1;
  input.tasks[0].baselinePriceMinor = 1;
  input.clock.timelineDays = 1;
  assert.deepEqual(simulation.exportSnapshot(), initial);
  assert.throws(() => { simulation.config.operators[0].rateMinorPerHour = 1; }, TypeError);
  assert.throws(() => { simulation.config.currency = 'EUR'; }, TypeError);
  simulation.updateOperator('dex', 12_000);
  simulation.complete('dex', 900);
  simulation.accept('dex', 4_000);
  simulation.settle(1_800);
  simulation.setTask('visit');
  simulation.updatePolicy({ baselinePriceMinor: 3_000 });
  simulation.setDay(14);
  simulation.reset();
  assert.deepEqual(simulation.exportSnapshot(), initial);
  assert.equal(simulation.config.currency, 'USD');
  assert.equal(simulation.view().operators[0].rateMinorPerHour, 6_000);
});

for (const [currency, digits, rates, baseline, expectedMinimum] of [
  ['JPY', 0, [300, 320, 280], 120, 188],
  ['KWD', 3, [300_000, 320_000, 280_000], 120_000, 187_500],
]) {
  test(`${currency} preserves minor-unit arithmetic through voting, acceptance, settlement and export`, () => {
    const input = JSON.parse(JSON.stringify(createSimulation().config));
    input.currency = currency;
    input.operators.forEach((operator, index) => { operator.rateMinorPerHour = rates[index]; });
    input.tasks[0].baselinePriceMinor = baseline;
    const simulation = createSimulation(input);
    const view = simulation.view();
    assert.equal(view.terms.minimumPriceMinor, expectedMinimum);
    assert.ok(view.votes.every(vote => vote.scope.currency === currency));
    assert.ok(view.operators.every(operator => operator.currency === currency));
    simulation.accept('ana', expectedMinimum);
    const settled = simulation.settle(3_600);
    assert.equal(settled.settlement, expectedMinimum * 2);
    assert.equal(settled.acceptance.scope.currency, currency);
    const exported = JSON.parse(JSON.stringify(simulation.exportSnapshot()));
    assert.equal(exported.configuration.currency, currency);
    assert.equal(exported.units.currency, currency);
    assert.equal(exported.units.currencyDecimals, digits);
    assert.equal(exported.units.money, 'minor currency units');
    assert.equal(exported.units.time, 'seconds');
    assert.ok(exported.assumptions.some(text => text.includes(`${currency} minor units`)));
  });
}
