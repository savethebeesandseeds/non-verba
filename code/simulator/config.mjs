// SPDX-License-Identifier: AGPL-3.0-only
/** Simulator configuration and exact currency presentation. No protocol calculations live here. */
const MAX = Number.MAX_SAFE_INTEGER;
const MAX_BIG = BigInt(MAX);
const DAY = 86_400;
const MAX_VOTES = 100_000; // Rust protocol snapshot limit.
const MAX_DATE_SECONDS = 8_640_000_000_000n;
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

function integer(value, path, minimum = 0, maximum = MAX) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${path} must be a whole number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function text(value, path, maximum = 200) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > maximum) {
    throw new Error(`${path} must be nonempty text without surrounding spaces (maximum ${maximum} characters).`);
  }
  return value;
}

function object(value, path, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`${path} must be an object.`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (!keys.includes(key)) throw new Error(`${path}.${String(key)} is not a supported setting.`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key} is required.`);
  }
}

function list(value, path) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_VOTES) {
    throw new Error(`${path} must contain between 1 and ${MAX_VOTES} entries.`);
  }
  if (Reflect.ownKeys(value).length !== value.length + 1) {
    throw new Error(`${path} must be a dense array without extra properties.`);
  }
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) throw new Error(`${path}[${index}] is required.`);
  }
}

function identifier(value, path) {
  text(value, path, 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
    || ['__proto__', 'prototype', 'constructor'].includes(value)) {
    throw new Error(`${path} must be a simple, non-reserved identifier (letters, digits, dots, underscores or hyphens).`);
  }
}

function currencyAndLocale(currency, locale) {
  if (typeof currency !== 'string' || !CURRENCIES.has(currency)) {
    throw new Error('config.currency must be a recognised uppercase currency code, such as NOK, JPY or KWD.');
  }
  text(locale, 'config.locale');
  try {
    if (!Intl.NumberFormat.supportedLocalesOf([locale]).length) throw new Error('Unsupported locale');
    return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'code' });
  } catch {
    throw new Error('config.locale must be a supported language tag, such as en-GB or nb-NO.');
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function safeBig(value, path) {
  if (value < 0n || value > MAX_BIG) throw new Error(`${path} exceeds the supported safe-integer range.`);
  return Number(value);
}

function ceilDiv(numerator, denominator) { return (numerator + denominator - 1n) / denominator; }

/** Maximum offer allowed by the controls, including the largest possible demand premium. */
export function maximumOfferMinor(config) {
  const rate = BigInt(integer(config.limits.rateMinorPerHour, 'config.limits.rateMinorPerHour', 1));
  const work = BigInt(integer(config.limits.workMinutes, 'config.limits.workMinutes', 1));
  const baseline = BigInt(integer(config.limits.baselinePriceMinor, 'config.limits.baselinePriceMinor', 1));
  const premium = BigInt(integer(config.policy.maxDemandPremiumBps, 'config.policy.maxDemandPremiumBps', 0, 10_000));
  const taskPrice = ceilDiv(rate * work, 60n);
  const base = baseline > taskPrice ? baseline : taskPrice;
  const offer = ceilDiv(base * (10_000n + premium), 10_000n);
  safeBig(offer, 'config.limits maximum offer');
  // The model's public API accepts seconds, so an accepted expected time can
  // be one second even though the page's controls use whole minutes.
  safeBig(offer * work * 60n, 'config.limits worst-case settlement');
  return Number(offer);
}

/** Validate every field, then return a detached, recursively immutable configuration. */
export function validateConfig(raw) {
  object(raw, 'config', ['version', 'locale', 'currency', 'clock', 'scope', 'policy', 'demand', 'limits', 'operators', 'tasks']);
  integer(raw.version, 'config.version', 1, 1);
  currencyAndLocale(raw.currency, raw.locale);
  object(raw.clock, 'config.clock', ['startsAt', 'timelineDays', 'seedVoteAgeDays']);
  object(raw.scope, 'config.scope', ['jurisdiction', 'region', 'counterpartyId']);
  object(raw.policy, 'config.policy', ['validityDays', 'decayDays', 'minimumOperators', 'minimumEffectiveVotes', 'demandSensitivityBps', 'maxDemandPremiumBps', 'demandMaxAgeSeconds', 'quoteLifetimeSeconds']);
  object(raw.demand, 'config.demand', ['requestedMinutes', 'availableMinutes', 'windowMinutes']);
  object(raw.limits, 'config.limits', ['rateMinorPerHour', 'baselinePriceMinor', 'workMinutes', 'demandMinutes', 'decayDays']);

  for (const [key, value] of Object.entries(raw.scope)) text(value, `config.scope.${key}`);
  text(raw.clock.startsAt, 'config.clock.startsAt');
  const startMs = Date.parse(raw.clock.startsAt);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(raw.clock.startsAt)
    || !Number.isFinite(startMs) || startMs < 0
    || new Date(startMs).toISOString().replace('.000Z', 'Z') !== raw.clock.startsAt) {
    throw new Error('config.clock.startsAt must be a valid UTC timestamp at or after 1970, with whole seconds (YYYY-MM-DDTHH:mm:ssZ).');
  }
  const maxDays = Math.floor(MAX / DAY);
  integer(raw.clock.timelineDays, 'config.clock.timelineDays', 1, maxDays);
  integer(raw.clock.seedVoteAgeDays, 'config.clock.seedVoteAgeDays', 0, maxDays);
  integer(raw.policy.validityDays, 'config.policy.validityDays', 1, maxDays);
  if (raw.policy.validityDays <= raw.clock.timelineDays) {
    throw new Error('config.policy.validityDays must be greater than config.clock.timelineDays.');
  }

  integer(raw.limits.rateMinorPerHour, 'config.limits.rateMinorPerHour', 1);
  integer(raw.limits.baselinePriceMinor, 'config.limits.baselinePriceMinor', 1);
  integer(raw.limits.workMinutes, 'config.limits.workMinutes', 1, Math.floor(MAX / 60));
  integer(raw.limits.demandMinutes, 'config.limits.demandMinutes', 1, Math.floor(MAX / 60));
  integer(raw.limits.decayDays, 'config.limits.decayDays', 1, maxDays);
  integer(raw.policy.decayDays, 'config.policy.decayDays', 1, raw.limits.decayDays);
  integer(raw.policy.minimumOperators, 'config.policy.minimumOperators', 1, MAX_VOTES);
  integer(raw.policy.minimumEffectiveVotes, 'config.policy.minimumEffectiveVotes', 1, MAX_VOTES);
  integer(raw.policy.demandSensitivityBps, 'config.policy.demandSensitivityBps');
  integer(raw.policy.maxDemandPremiumBps, 'config.policy.maxDemandPremiumBps', 0, 10_000);
  integer(raw.policy.demandMaxAgeSeconds, 'config.policy.demandMaxAgeSeconds', 1);
  integer(raw.policy.quoteLifetimeSeconds, 'config.policy.quoteLifetimeSeconds', 1);
  integer(raw.demand.requestedMinutes, 'config.demand.requestedMinutes', 0, raw.limits.demandMinutes);
  integer(raw.demand.availableMinutes, 'config.demand.availableMinutes', 0, raw.limits.demandMinutes);
  integer(raw.demand.windowMinutes, 'config.demand.windowMinutes', 1, Math.floor(MAX / 60));

  const start = BigInt(startMs / 1_000);
  const seededAt = start - BigInt(raw.clock.seedVoteAgeDays) * BigInt(DAY);
  if (seededAt < 0n) throw new Error('config.clock.seedVoteAgeDays would place a seeded vote before 1970.');
  const end = start + BigInt(raw.policy.validityDays) * BigInt(DAY);
  const lastNow = start + BigInt(raw.clock.timelineDays) * BigInt(DAY);
  const lastQuote = lastNow + BigInt(raw.policy.quoteLifetimeSeconds);
  safeBig(lastNow + BigInt(raw.policy.demandMaxAgeSeconds), 'config.policy.demandMaxAgeSeconds expiry');
  if (end > MAX_DATE_SECONDS || lastQuote > MAX_DATE_SECONDS) {
    throw new Error('config.clock and config.policy timestamps exceed the supported date range.');
  }

  list(raw.operators, 'config.operators');
  const operators = new Set();
  raw.operators.forEach((operator, index) => {
    const path = `config.operators[${index}]`;
    object(operator, path, ['operatorId', 'name', 'rateMinorPerHour']);
    identifier(operator.operatorId, `${path}.operatorId`);
    text(operator.name, `${path}.name`);
    integer(operator.rateMinorPerHour, `${path}.rateMinorPerHour`, 1, raw.limits.rateMinorPerHour);
    if (operators.has(operator.operatorId)) throw new Error(`${path}.operatorId must be unique.`);
    operators.add(operator.operatorId);
  });
  list(raw.tasks, 'config.tasks');
  const tasks = new Set();
  raw.tasks.forEach((task, index) => {
    const path = `config.tasks[${index}]`;
    object(task, path, ['taskId', 'taskVersion', 'name', 'baselinePriceMinor', 'baselineMinutes']);
    identifier(task.taskId, `${path}.taskId`);
    text(task.taskVersion, `${path}.taskVersion`);
    text(task.name, `${path}.name`);
    integer(task.baselinePriceMinor, `${path}.baselinePriceMinor`, 1, raw.limits.baselinePriceMinor);
    integer(task.baselineMinutes, `${path}.baselineMinutes`, 1, raw.limits.workMinutes);
    if (tasks.has(task.taskId)) throw new Error(`${path}.taskId must be unique.`);
    tasks.add(task.taskId);
  });
  maximumOfferMinor(raw);
  return deepFreeze(JSON.parse(JSON.stringify(raw)));
}

/** Read the same JSON from a Node file URL or an HTTP-served browser page. */
export async function loadConfig(url = new URL('../../web/union.config.json', import.meta.url)) {
  const location = url instanceof URL ? url : new URL(url, import.meta.url);
  let source;
  try {
    if (location.protocol === 'file:' && typeof process !== 'undefined' && process.versions?.node) {
      const { readFile } = await import('node:fs/promises');
      source = await readFile(location, 'utf8');
    } else {
      const response = await fetch(location, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      source = await response.text();
    }
  } catch (error) {
    throw new Error(`Cannot load simulator configuration: ${error.message}`, { cause: error });
  }
  let raw;
  try { raw = JSON.parse(source); }
  catch (error) { throw new Error(`Simulator configuration is not valid JSON: ${error.message}`, { cause: error }); }
  return validateConfig(raw);
}

/**
 * Keep minor-unit integers exact throughout presentation and HTML number input.
 * Number inputs use ASCII decimal notation, independently of the display locale.
 */
export function createMoney({ currency, locale }) {
  const defaults = currencyAndLocale(currency, locale).resolvedOptions();
  const digits = defaults.maximumFractionDigits;
  const scale = 10 ** digits;
  const scaleBig = BigInt(scale);
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency', currency, currencyDisplay: 'code',
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
  const digitFormatter = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 0 });
  const numeral = Array.from({ length: 10 }, (_, digit) => digitFormatter.formatToParts(digit)
    .filter(part => part.type === 'integer').map(part => part.value).join(''));
  const fractionOf = minor => (minor % scaleBig).toString().padStart(digits, '0');
  const inputOf = exact => `${exact / scaleBig}${digits ? `.${fractionOf(exact)}` : ''}`;

  return Object.freeze({
    code: currency, digits, scale, step: digits ? `0.${'0'.repeat(digits - 1)}1` : '1',
    format(minor) {
      const exact = BigInt(integer(minor, 'Money amount'));
      const fraction = fractionOf(exact).replace(/\d/g, digit => numeral[Number(digit)]);
      return formatter.formatToParts(exact / scaleBig)
        .map(part => part.type === 'fraction' ? fraction : part.value).join('');
    },
    toInput(minor) {
      const exact = BigInt(integer(minor, 'Money amount'));
      return inputOf(exact);
    },
    parseInput(value, maximum = MAX) {
      integer(maximum, 'Maximum money amount');
      if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) {
        throw new Error(`Enter ${currency} as an unsigned decimal amount without grouping or exponent notation.`);
      }
      const [whole, fraction = ''] = value.split('.');
      if (fraction.length > digits) {
        throw new Error(`${currency} permits at most ${digits} decimal places; the amount is not rounded.`);
      }
      const exactDigits = `${whole}${fraction.padEnd(digits, '0')}`.replace(/^0+(?=\d)/, '');
      if (exactDigits.length > String(MAX).length || BigInt(exactDigits) > BigInt(maximum)) {
        throw new Error(`${currency} amount exceeds the maximum of ${inputOf(BigInt(maximum))}.`);
      }
      return Number(BigInt(exactDigits));
    },
  });
}
