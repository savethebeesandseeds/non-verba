/**
 * Host boundary only. Rust/WASM owns validation, voting and monetary arithmetic.
 * A Rust plan is provisional: all requested verification callbacks must succeed
 * before any public API below returns its result. See docs/COOPERATION_PROTOCOL.md.
 */
import init, { cooperation_plan } from '../pkg/nonverba_cooperation.js';

if (typeof process !== 'undefined' && process.versions?.node) {
  const { readFile } = await import('node:fs/promises');
  const bytes = await readFile(new URL('../pkg/nonverba_cooperation_bg.wasm', import.meta.url));
  await init({ module_or_path: bytes });
} else {
  // --target web bindings fetch the adjacent WASM in browsers and Web Workers.
  await init();
}

const verificationMethods = new Set([
  'verifyPolicy', 'verifyBallotSet', 'verifyVote', 'verifyDemand',
  'verifyAcceptance', 'verifyWorkingTime',
]);

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function encode(input) {
  // JSON normally changes NaN/Infinity to null and can carry rounded unsafe inputs.
  // Reject them at the transport boundary; Rust validates the domain constraints.
  return JSON.stringify(input, (_key, value) => {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      throw new Error('Numeric protocol fields must be safe integers');
    }
    return value;
  });
}

function execute(operation, input, adapter) {
  let plan;
  let snapshot;
  try {
    const encoded = encode(input);
    snapshot = freeze(JSON.parse(encoded));
    plan = freeze(JSON.parse(cooperation_plan(operation, encoded)));
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
  for (const { method, paths } of plan.checks) {
    if (!verificationMethods.has(method) || typeof adapter?.[method] !== 'function') {
      throw new Error(`Missing trusted adapter: ${method}`);
    }
    // Paths keep full proof records intact without repeating a large policy for
    // every vote in the WASM result. Missing optional demand resolves to null.
    const args = paths.map(path => path.reduce((record, key) => record?.[key], snapshot) ?? null);
    if (adapter[method](...args) !== true) {
      throw new Error(`${method} must synchronously return true after verification`);
    }
  }
  return plan.value;
}

export function priceForTime(rateMinorPerHour, seconds) {
  return execute('priceForTime', { rateMinorPerHour, seconds });
}

export function prepareVote(input) {
  return execute('prepareVote', input);
}

export function evaluateTask(input, adapter) {
  return execute('evaluateTask', input, adapter);
}

export function quoteTask(input) {
  return execute('quoteTask', input);
}

export function prepareAcceptance(input) {
  return execute('prepareAcceptance', input);
}

export function settlementMinimum(input, adapter) {
  return execute('settlementMinimum', input, adapter);
}
