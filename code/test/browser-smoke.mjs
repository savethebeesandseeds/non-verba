// Exercise the real compiled Rust/WASM in Chromium and a module Web Worker.
// Supply Playwright via an existing install or NONVERBA_PLAYWRIGHT_PATH; this
// tool installs nothing and uses only an ephemeral, allowlisted localhost server.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = '/pkg/nonverba_cooperation_bg.wasm';
const csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'";

// This exact fixture runs in both browser realms. Only admission adapters are
// simulated: all preparation, validation, voting and money run through WASM.
async function runFixture() {
  const { priceForTime, prepareVote, evaluateTask, quoteTask } =
    await import('/protocol/cooperation.mjs');
  function check(condition, message) {
    if (!condition) throw new Error(message);
  }
  const now = 10_000;
  const scope = {
    agreementId: 'synthetic-agreement', taskId: 'synthetic-task', taskVersion: '1',
    jurisdiction: 'NO', region: 'synthetic-region',
    counterpartyId: 'synthetic-requester', currency: 'NOK',
  };
  const policy = {
    policyId: 'synthetic-policy', version: 1, scope,
    validFrom: 0, validUntil: now + 1_000,
    baselinePriceMinor: 100, baselineSeconds: 600,
    decayWindowSeconds: 1_000, minimumOperators: 1, minimumEffectiveVotes: 1,
    demandSensitivityBps: 0, maxDemandPremiumBps: 0,
    demandMaxAgeSeconds: 100, quoteLifetimeSeconds: 300,
  };
  const operator = {
    operatorId: 'synthetic-operator', currency: 'NOK', rateMinorPerHour: 3_600,
  };
  const vote = prepareVote({
    completion: {
      scope, completionId: 'synthetic-completion', assignmentId: 'synthetic-assignment',
      operatorId: operator.operatorId, completedAt: now, workedSeconds: 120,
    },
    operator,
  });
  check(priceForTime(3_601, 1) === 2, 'WASM money rounding failed');
  check(vote.priceMinor === 120, 'WASM vote preparation failed');
  check(Object.isFrozen(vote) && Object.isFrozen(vote.scope), 'Vote must be frozen');

  const verified = [];
  const SIMULATED_ADMISSION = {
    verifyPolicy(record, asOf) {
      check(record.policyId === policy.policyId && asOf === now, 'Wrong policy verification input');
      check(Object.isFrozen(record.scope), 'Policy verification input must be frozen');
      verified.push('policy');
      return true;
    },
    verifyBallotSet(records, agreement, asOf) {
      check(records.length === 1 && records[0].completionId === vote.completionId,
        'Wrong ballot verification input');
      check(agreement.policyId === policy.policyId && asOf === now, 'Wrong ballot scope');
      check(Object.isFrozen(records) && Object.isFrozen(records[0]), 'Ballots must be frozen');
      verified.push('ballots');
      return true;
    },
    verifyVote(record, agreement) {
      check(record.completionId === vote.completionId && agreement.policyId === policy.policyId,
        'Wrong vote verification input');
      verified.push('vote');
      return true;
    },
  };
  const input = { policy, votes: [vote], asOf: now };
  const terms = evaluateTask(input, SIMULATED_ADMISSION);
  check(verified.join(',') === 'policy,ballots,vote', 'Admission checks were skipped or reordered');
  check(terms.minimumPriceMinor === 120 && terms.expectedSeconds === 120,
    'WASM aggregation failed');
  check(terms.weightNumerator === '1000' && terms.weightDenominator === '1000',
    'Exact vote weights were not preserved');
  const quote = quoteTask({
    terms, operator: { ...operator, rateMinorPerHour: 7_200 }, at: now,
  });
  check(quote.minimumPriceMinor === 240, 'Personal hourly setting did not raise the quote');
  let rejected = false;
  try {
    evaluateTask(input, { ...SIMULATED_ADMISSION, verifyVote: () => false });
  } catch (error) {
    rejected = /verifyVote/.test(String(error));
  }
  check(rejected, 'A denied vote adapter released a result');
  return {
    realm: typeof document === 'undefined' ? 'module-worker' : 'browser',
    roundedPriceMinor: 2, votePriceMinor: vote.priceMinor,
    minimumPriceMinor: terms.minimumPriceMinor, personalQuoteMinor: quote.minimumPriceMinor,
    deniedAdapterRejected: rejected,
  };
}

const workerSource = `(${runFixture.toString()})().then(
  value => postMessage({ ok: true, value }),
  error => postMessage({ ok: false, error: String(error?.stack || error) }),
);`;
const assets = new Map([
  ['/', { type: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><title>Non-verba WASM smoke</title>' }],
  ['/smoke-worker.mjs', { type: 'text/javascript; charset=utf-8', body: workerSource }],
]);
for (const [path, type] of [
  ['/protocol/cooperation.mjs', 'text/javascript; charset=utf-8'],
  ['/pkg/nonverba_cooperation.js', 'text/javascript; charset=utf-8'],
  [wasmPath, 'application/wasm'],
]) {
  assets.set(path, { type, body: await readFile(resolve(root, path.slice(1))) });
}
assert.equal(assets.get(wasmPath).body.subarray(0, 4).toString('hex'), '0061736d',
  'Build the real WASM package before running the browser smoke test');

let wasmFetches = 0;
const server = createServer((request, response) => {
  // Exact URL lookup prevents traversal and serves no workspace directory tree.
  const asset = request.method === 'GET' ? assets.get(request.url) : undefined;
  response.setHeader('Content-Security-Policy', csp);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (!asset) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  if (request.url === wasmPath) wasmFetches += 1;
  response.writeHead(200, { 'Content-Type': asset.type });
  response.end(asset.body);
});

async function bounded(promise, label, milliseconds = 20_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

let browser;
let context;
let browserChannel;
try {
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  if (process.env.NONVERBA_BROWSER_EXECUTABLE) {
    browser = await chromium.launch({
      headless: true, timeout: 20_000, executablePath: process.env.NONVERBA_BROWSER_EXECUTABLE,
    });
    browserChannel = 'configured executable';
  } else {
    let lastError;
    for (const channel of ['msedge', 'chrome', undefined]) {
      try {
        browser = await chromium.launch({ headless: true, timeout: 20_000, ...(channel ? { channel } : {}) });
        browserChannel = channel || 'playwright chromium';
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!browser) throw lastError;
  }
  context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'load', timeout: 20_000 });
  const main = await bounded(page.evaluate(runFixture), 'Browser WASM smoke');
  const worker = await bounded(page.evaluate(() => new Promise((accept, reject) => {
    const worker = new Worker('/smoke-worker.mjs', { type: 'module' });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Module Worker smoke timed out'));
    }, 15_000);
    worker.onmessage = ({ data }) => {
      clearTimeout(timer);
      worker.terminate();
      if (data.ok) accept(data.value);
      else reject(new Error(data.error));
    };
    worker.onerror = event => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(event.message || 'Module Worker failed'));
    };
  })), 'Module Worker WASM smoke');
  assert.equal(main.realm, 'browser');
  assert.equal(worker.realm, 'module-worker');
  assert.deepEqual({ ...worker, realm: 'browser' }, main, 'Browser and Worker results differ');
  assert.deepEqual(errors, [], 'Browser raised unexpected runtime errors');
  assert.ok(wasmFetches >= 2, `Expected real WASM fetches in both realms; received ${wasmFetches}`);
  console.log(JSON.stringify({ status: 'passed', browserChannel, wasmFetches, main, worker }, null, 2));
} finally {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (server.listening) {
    await new Promise(resolveClosed => {
      server.close(resolveClosed);
      server.closeAllConnections();
    });
  }
}
