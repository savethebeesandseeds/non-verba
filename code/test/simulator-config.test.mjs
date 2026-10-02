// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createMoney, loadConfig, maximumOfferMinor, validateConfig } from '../simulator/config.mjs';

const fixture = JSON.parse(await readFile(new URL('../../web/simulator/union.config.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(fixture);

test('one JSON configuration loads unchanged as a detached, recursively frozen value', async () => {
  const loaded = await loadConfig();
  assert.deepEqual(loaded, fixture);
  const input = copy();
  const configured = validateConfig(input);
  input.operators[0].name = 'Changed outside';
  assert.equal(configured.operators[0].name, 'Ana');
  for (const value of [configured, configured.clock, configured.policy, configured.limits,
    configured.operators, configured.operators[0], configured.tasks, configured.tasks[0]]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.throws(() => { configured.policy.decayDays = 4; }, TypeError);
});

test('configuration rejects missing or unknown settings with a field path', () => {
  for (const section of [null, 'clock', 'scope', 'policy', 'demand', 'limits']) {
    const input = copy();
    const target = section ? input[section] : input;
    target.typo = 1;
    assert.throws(() => validateConfig(input), new RegExp(`config${section ? `\\.${section}` : ''}\\.typo`));
  }
  for (const section of ['operators', 'tasks']) {
    const input = copy();
    input[section][0].extra = true;
    assert.throws(() => validateConfig(input), /\[0\]\.extra/);
  }
  const missing = copy();
  delete missing.policy.decayDays;
  assert.throws(() => validateConfig(missing), /config\.policy\.decayDays is required/);
});

test('configuration rejects ambiguous identities and unusable collections', () => {
  for (const [section, id] of [['operators', 'operatorId'], ['tasks', 'taskId']]) {
    const duplicate = copy();
    duplicate[section][1][id] = duplicate[section][0][id];
    assert.throws(() => validateConfig(duplicate), /must be unique/);
    for (const reserved of ['__proto__', 'constructor', 'prototype', 'has a space']) {
      const input = copy();
      input[section][0][id] = reserved;
      assert.throws(() => validateConfig(input), /identifier/);
    }
    const empty = copy();
    empty[section] = [];
    assert.throws(() => validateConfig(empty), /must contain/);
    const sparse = copy();
    delete sparse[section][0];
    assert.throws(() => validateConfig(sparse), /dense array/);
  }
});

test('configuration preserves intentional quorum failure and zero demand', () => {
  const input = copy();
  input.policy.minimumOperators = input.operators.length + 1;
  input.policy.minimumEffectiveVotes = 100_000;
  input.demand.requestedMinutes = 0;
  input.demand.availableMinutes = 0;
  input.policy.demandSensitivityBps = 0;
  input.policy.maxDemandPremiumBps = 0;
  const result = validateConfig(input);
  assert.equal(result.policy.minimumOperators, 4);
  assert.equal(result.demand.availableMinutes, 0);
});

test('configuration enforces integer units, core policy bounds and configured input limits', () => {
  const cases = [
    ['version', 2], ['policy.minimumOperators', 0], ['policy.minimumOperators', 100_001],
    ['policy.minimumEffectiveVotes', 1.5], ['policy.maxDemandPremiumBps', 10_001],
    ['policy.demandSensitivityBps', -1], ['policy.decayDays', 366],
    ['policy.quoteLifetimeSeconds', 0], ['policy.demandMaxAgeSeconds', 0],
    ['limits.workMinutes', 1.5], ['limits.rateMinorPerHour', Number.MAX_SAFE_INTEGER + 1],
    ['demand.requestedMinutes', 525_601], ['demand.availableMinutes', -1],
    ['demand.windowMinutes', 0], ['tasks.0.baselineMinutes', 1441],
    ['tasks.0.baselinePriceMinor', 100_000_001], ['operators.0.rateMinorPerHour', 0],
  ];
  for (const [path, value] of cases) {
    const input = copy();
    const parts = path.split('.');
    const key = parts.pop();
    parts.reduce((target, part) => target[part], input)[key] = value;
    assert.throws(() => validateConfig(input), /config\./, path);
  }
});

test('configuration rejects invalid, fractional, expired and out-of-range dates', () => {
  for (const startsAt of ['2026-02-30T12:00:00Z', '2026-09-26', '2026-09-26T12:00:00.500Z',
    '1969-12-31T23:59:59Z', 'not a date']) {
    const input = copy();
    input.clock.startsAt = startsAt;
    assert.throws(() => validateConfig(input), /config\.clock\.startsAt/);
  }
  const beforeEpoch = copy();
  beforeEpoch.clock.startsAt = '1970-01-01T00:00:00Z';
  assert.throws(() => validateConfig(beforeEpoch), /seedVoteAgeDays/);
  const expired = copy();
  expired.policy.validityDays = expired.clock.timelineDays;
  assert.throws(() => validateConfig(expired), /validityDays.*timelineDays/);
  const huge = copy();
  huge.policy.validityDays = 100_000_001;
  assert.throws(() => validateConfig(huge), /date range/);
  const unsafeSeconds = copy();
  unsafeSeconds.limits.demandMinutes = Math.floor(Number.MAX_SAFE_INTEGER / 60) + 1;
  assert.throws(() => validateConfig(unsafeSeconds), /limits\.demandMinutes/);
  const unsafeDemandExpiry = copy();
  unsafeDemandExpiry.policy.demandMaxAgeSeconds = Number.MAX_SAFE_INTEGER;
  assert.throws(() => validateConfig(unsafeDemandExpiry), /demandMaxAgeSeconds expiry.*safe-integer/);
});

test('maximum offer uses integer ceiling and protects every reachable quote and settlement', () => {
  assert.equal(maximumOfferMinor(validateConfig(copy())), 3_600_000_000);
  const fractional = copy();
  fractional.limits = { ...fractional.limits, rateMinorPerHour: 61, baselinePriceMinor: 1, workMinutes: 1 };
  fractional.policy.maxDemandPremiumBps = 1;
  assert.equal(maximumOfferMinor(fractional), 3); // ceil(61 / 60) = 2; ceil(2 × 1.0001) = 3.
  const unsafeQuote = copy();
  unsafeQuote.limits.baselinePriceMinor = Number.MAX_SAFE_INTEGER;
  assert.throws(() => validateConfig(unsafeQuote), /maximum offer.*safe-integer/);
  const unsafeSettlement = copy();
  unsafeSettlement.limits.workMinutes = 100_000;
  assert.throws(() => validateConfig(unsafeSettlement), /worst-case settlement.*safe-integer/);
});

test('currency and locale must be recognised rather than silently falling back', () => {
  for (const currency of ['XYZ', 'nok', '', 'NOKK', null]) {
    assert.throws(() => createMoney({ currency, locale: 'en-GB' }), /config\.currency/);
    const input = copy();
    input.currency = currency;
    assert.throws(() => validateConfig(input), /config\.currency/);
  }
  for (const locale of ['', 'not_a_locale', 'zz-ZZ']) {
    assert.throws(() => createMoney({ currency: 'NOK', locale }), /config\.locale/);
  }
});

for (const [currency, digits, scale, step, minor, input, expected] of [
  ['NOK', 2, 100, '0.01', 18_751, '187.51', 'NOK 187.51'],
  ['JPY', 0, 1, '1', 18_751, '18751', 'JPY 18,751'],
  ['KWD', 3, 1000, '0.001', 18_751, '18.751', 'KWD 18.751'],
]) {
  test(`${currency} derives currency precision and round-trips without floating-point amounts`, () => {
    const money = createMoney({ currency, locale: 'en-GB' });
    assert.equal(Object.isFrozen(money), true);
    assert.deepEqual([money.code, money.digits, money.scale, money.step], [currency, digits, scale, step]);
    assert.equal(money.toInput(minor), input);
    assert.equal(money.parseInput(input), minor);
    assert.equal(money.format(minor), expected);
    assert.equal(money.parseInput(money.toInput(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
    assert.equal(money.parseInput(money.toInput(0)), 0);
    assert.throws(() => money.parseInput(digits ? `${input}1` : `${input}.1`), /decimal places/);
  });
}

test('large currency displays preserve the final minor unit exactly', () => {
  assert.equal(createMoney({ currency: 'NOK', locale: 'en-GB' }).format(Number.MAX_SAFE_INTEGER), 'NOK 90,071,992,547,409.91');
  assert.equal(createMoney({ currency: 'KWD', locale: 'en-GB' }).format(Number.MAX_SAFE_INTEGER), 'KWD 9,007,199,254,740.991');
  assert.equal(createMoney({ currency: 'JPY', locale: 'en-GB' }).format(Number.MAX_SAFE_INTEGER), 'JPY 9,007,199,254,740,991');
});

test('display obeys locale separators and numeral systems while input stays ASCII decimal', () => {
  const german = createMoney({ currency: 'NOK', locale: 'de-DE' });
  assert.equal(german.format(123_456), '1.234,56 NOK');
  assert.equal(german.toInput(123_456), '1234.56');
  assert.throws(() => german.parseInput('1234,56'), /unsigned decimal/);
  const arabic = createMoney({ currency: 'KWD', locale: 'ar-KW' });
  const expected = new Intl.NumberFormat('ar-KW', { style: 'currency', currency: 'KWD', currencyDisplay: 'code' }).format(1234.567);
  assert.equal(arabic.format(1_234_567), expected);
  assert.equal(arabic.toInput(1_234_567), '1234.567');
});

test('money inputs reject exponent, grouping, negatives, excess precision and unsafe amounts', () => {
  const { parseInput, toInput, format } = createMoney({ currency: 'NOK', locale: 'en-GB' });
  for (const value of ['1e3', '1,000.00', '-1', '+1', '', ' 1 ', 'NaN', 'Infinity', 10]) {
    assert.throws(() => parseInput(value), /unsigned decimal/);
  }
  for (const value of ['0.001', '1.000']) assert.throws(() => parseInput(value), /decimal places/);
  assert.throws(() => parseInput('100.01', 10_000), /maximum of 100\.00/);
  assert.throws(() => parseInput('90071992547409.92'), /maximum/);
  assert.throws(() => parseInput('9'.repeat(100)), /maximum/);
  assert.equal(parseInput('0001.2'), 120);
  assert.equal(parseInput('0', 0), 0);
  for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => format(invalid), /Money amount/);
    assert.throws(() => toInput(invalid), /Money amount/);
    assert.throws(() => parseInput('1', invalid), /Maximum money amount/);
  }
  assert.throws(() => createMoney({ currency: 'JPY', locale: 'en-GB' }).parseInput('1.0'), /0 decimal places/);
});

test('HTTP loading checks response status and rejects malformed or invalid configuration', async t => {
  const server = createServer((request, response) => {
    if (request.url === '/ok') response.end(JSON.stringify(fixture));
    else if (request.url === '/json') response.end('{');
    else if (request.url === '/invalid') response.end('{}');
    else { response.statusCode = 404; response.end(JSON.stringify(fixture)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await loadConfig(new URL('/ok', base)), fixture);
  await assert.rejects(loadConfig(new URL('/missing', base)), /HTTP 404/);
  await assert.rejects(loadConfig(new URL('/json', base)), /not valid JSON/);
  await assert.rejects(loadConfig(new URL('/invalid', base)), /config\.version is required/);
});
