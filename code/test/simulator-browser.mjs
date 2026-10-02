// SPDX-License-Identifier: AGPL-3.0-only
// Real browser integration of the standalone page, local server and Rust/WASM.
// Reuses an installed browser/Playwright; installs nothing and serves only local assets.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createSimulatorServer } from '../tools/serve-simulator.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const artifacts = resolve(dirname(fileURLToPath(import.meta.url)), '../artifacts/qa');
const previewScript = fileURLToPath(new URL('../tools/serve-simulator.mjs', import.meta.url));
for (const [environment, expectedError] of [
  [{ NONVERBA_BIND: '192.0.2.1' }, 'NONVERBA_BIND must be'],
  [{ NONVERBA_BIND: '0.0.0.0', NONVERBA_CONTAINER: '0' }, 'allowed only inside'],
]) {
  const rejected = spawnSync(process.execPath, [previewScript], {
    env: { ...process.env, NONVERBA_UNION_PORT: '0', ...environment },
    encoding: 'utf8', timeout: 5_000,
  });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, new RegExp(expectedError));
}
const server = createSimulatorServer();
let browser;
try {
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const production = await fetch(`${base}/web/simulator/union.html`);
  assert.equal(production.status, 200);
  assert.equal(production.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(production.headers.get('cache-control'), 'no-store');
  const productionHtml = await production.text();
  assert.ok(!productionHtml.includes("'unsafe-inline'"));
  assert.ok(productionHtml.includes("style-src-attr 'none'"));
  const configResponse = await fetch(`${base}/web/simulator/union.config.json`);
  assert.equal(configResponse.status, 200);
  assert.ok(configResponse.headers.get('content-type').startsWith('application/json'));
  const defaultConfig = await configResponse.json();
  const review = await fetch(`${base}/web/simulator/union-review.html`);
  const reviewHtml = await review.text();
  assert.equal(review.status, 200);
  assert.equal(review.headers.get('x-robots-tag'), 'noindex');
  assert.ok(reviewHtml.includes("style-src-elem 'self' 'unsafe-inline'"));
  assert.ok(reviewHtml.includes("script-src 'self' 'wasm-unsafe-eval'"));
  assert.ok(reviewHtml.includes("style-src-attr 'none'"));
  assert.equal((await fetch(`${base}/code/Cargo.lock`)).status, 404);
  assert.equal((await fetch(`${base}/web/simulator/union.html`, { method: 'POST' })).status, 405);
  const head = await fetch(`${base}/web/simulator/union.html`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(base, { redirect: 'manual' })).headers.get('location'), '/web/site/index.html');

  let browserChannel;
  if (process.env.NONVERBA_BROWSER_EXECUTABLE) {
    browser = await chromium.launch({ headless: true, timeout: 20_000,
      executablePath: process.env.NONVERBA_BROWSER_EXECUTABLE });
    browserChannel = 'configured executable';
  } else {
    let lastError;
    for (const channel of ['msedge', 'chrome', undefined]) {
      try {
        browser = await chromium.launch({ headless: true, timeout: 20_000, ...(channel ? { channel } : {}) });
        browserChannel = channel || 'playwright chromium';
        break;
      } catch (error) { lastError = error; }
    }
    if (!browser) throw lastError;
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors = [];
  const externalRequests = [];
  let wasmFetches = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /Content Security Policy|Refused to/.test(message.text())) errors.push(message.text());
  });
  page.on('request', request => {
    if (request.url().endsWith('.wasm')) wasmFetches += 1;
    if (!request.url().startsWith(base)) externalRequests.push(request.url());
  });
  const state = async () => JSON.parse(await page.locator('#audit-json').textContent()).current;
  const edit = async (selector, value) => {
    await page.locator(selector).fill(String(value));
    await page.locator(selector).dispatchEvent('change');
  };
  const day = async value => {
    await page.locator('#day-offset').fill(String(value));
    await page.locator('#day-offset').dispatchEvent('input');
  };
  await page.goto(`${base}/web/simulator/union.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.getElementById('runtime').textContent === 'Local engine ready');
  assert.equal((await state()).terms.minimumPriceMinor, 18_750);
  assert.equal(await page.locator('#votes-body tr').count(), 3);
  assert.ok(await page.locator('#collective-price').textContent().then(text => text.includes('187.50')));
  assert.ok(wasmFetches > 0, 'The page must fetch and execute the actual WASM module');

  await edit('#rate-ana', 1000);
  let view = await state();
  assert.equal(view.terms.minimumPriceMinor, 18_750, 'Editing R must not rewrite history');
  assert.equal(view.quotes.ana.minimumPriceMinor, 50_000);
  assert.equal(view.votes.find(vote => vote.operatorId === 'ana').rateMinorPerHour, 30_000);
  await page.locator('#complete-task').click();
  view = await state();
  assert.equal(view.votes.length, 4);
  assert.equal(view.votes.at(-1).rateMinorPerHour, 100_000);
  assert.equal(view.votes.at(-1).priceMinor, 50_000);
  await page.locator('#task-select').selectOption('audio-inspection');
  view = await state();
  assert.equal(view.votes.length, 3);
  assert.equal(view.terms.minimumPriceMinor, 7500);
  assert.equal(await page.locator('#rate-ana').inputValue(), '1000.00');
  await page.locator('#task-select').selectOption('site-photo');
  assert.equal((await state()).votes.length, 4);
  await day(30);
  view = await state();
  assert.equal(view.terms.support, 'baseline-fallback');
  assert.equal(view.terms.activeVotes, 0);
  assert.equal(view.terms.minimumPriceMinor, 15_000);
  assert.equal(await page.locator('#votes-body tr.expired').count(), 4);

  await page.locator('#reset-demo').click();
  await edit('#offer-price', 1);
  await page.locator('#accept-offer').click();
  assert.equal((await state()).acceptance, null);
  assert.ok(await page.locator('#notice').getAttribute('class').then(value => value.includes('error')));
  await edit('#offer-price', 300);
  await page.locator('#accept-offer').click();
  const accepted = (await state()).acceptance;
  assert.equal(accepted.priceMinor, 30_000);
  assert.equal(accepted.expectedSeconds, 1800);
  assert.ok(await page.locator('#accept-offer').isDisabled());
  await edit('#approved-minutes', 45);
  await page.locator('#settle-task').click();
  assert.equal((await state()).settlement, 45_000);
  await edit('#rate-ana', 900);
  await edit('#requested-minutes', 0);
  await day(40);
  assert.deepEqual((await state()).acceptance, accepted);
  assert.equal((await state()).settlement, 45_000);
  await page.locator('#task-select').selectOption('audio-inspection');
  await page.locator('#task-select').selectOption('site-photo');
  assert.equal((await state()).settlement, 45_000);
  assert.equal(await page.locator('#approved-minutes').inputValue(), '45', 'Displayed time must match stored payment');
  await edit('#approved-minutes', 15);
  await page.locator('#settle-task').click();
  assert.equal((await state()).settlement, 30_000, 'Faster work must not cut the agreed price');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-snapshot').click();
  const download = await downloadPromise;
  const snapshot = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(snapshot.simulation, true);
  assert.equal(snapshot.current.settlement, 30_000);
  assert.equal(snapshot.current.taskId, 'site-photo');

  await page.locator('#reset-demo').click();
  await page.locator('#notice').evaluate(element => element.hidden = true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: resolve(artifacts, 'union-desktop.png'), fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `Page overflows at ${width}px`);
    await page.screenshot({ path: resolve(artifacts, `union-mobile-${width}.png`), fullPage: true });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, [], 'Simulator must make no external requests');

  // Configure from visible controls, with no source-file edits. A draft must
  // never mutate the active records, even if validation or an import fails.
  const editor = await context.newPage();
  await editor.goto(`${base}/web/simulator/union.html`);
  await editor.waitForFunction(() => document.getElementById('runtime').textContent === 'Local engine ready');
  const editorState = async () => JSON.parse(await editor.locator('#audit-json').textContent());
  const setupField = async path => {
    const field = editor.locator(`[data-setup-path="${path}"]`);
    for (const details of await editor.locator('#setup-editor details').filter({ has: field }).all()) {
      if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
    }
    return field;
  };
  assert.ok(await editor.locator('#setup-currency').isVisible(), 'Currency setup must be visible without opening a panel');
  await editor.locator('#accept-offer').click();
  const priorSetup = await editorState();
  await editor.locator('#setup-currency').selectOption('JPY');
  assert.deepEqual(await editorState(), priorSetup, 'Editing currency must not relabel existing records');
  assert.equal(await (await setupField('operators.ana.rateMinorPerHour')).inputValue(), '300');
  await editor.locator('#setup-apply').click();
  let applied = await editorState();
  assert.equal(applied.configuration.currency, 'JPY');
  assert.equal(applied.current.operators[0].rateMinorPerHour, 300, 'Setup preserves human numeric amounts, not old minor-unit integers');
  assert.equal(applied.current.terms.minimumPriceMinor, 188);
  assert.equal(applied.current.acceptance, null);
  await editor.locator('#setup-apply').click();
  assert.equal(await editor.locator('#task-select option').count(), 2);
  assert.equal(await editor.locator('#quote-operator option').count(), 3);

  const configurationDownload = editor.waitForEvent('download');
  await editor.locator('#setup-export').click();
  const configurationFile = await configurationDownload;
  const savedSetup = JSON.parse(await readFile(await configurationFile.path(), 'utf8'));
  assert.equal(savedSetup.currency, 'JPY');
  assert.equal(savedSetup.operators[0].rateMinorPerHour, 300);
  assert.equal(savedSetup.simulation, undefined, 'Configuration export must be reusable as configuration, not a snapshot');

  await editor.locator('#complete-task').click();
  const beforeInvalidSetup = await editorState();
  await editor.locator('#setup-currency').selectOption('KWD');
  await (await setupField('operators.ana.rateMinorPerHour')).fill('300.125');
  await editor.locator('#setup-currency').selectOption('JPY');
  await editor.locator('#setup-apply').click();
  assert.deepEqual(await editorState(), beforeInvalidSetup, 'Invalid precision must preserve the entire active simulation');
  assert.ok((await editor.locator('#setup-status').textContent()).length > 0);
  await editor.locator('#setup-discard').click();
  assert.equal(await editor.locator('#setup-currency').inputValue(), 'JPY');
  assert.equal(await (await setupField('operators.ana.rateMinorPerHour')).inputValue(), '300');

  await editor.locator('#setup-import').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await editor.waitForFunction(() => document.getElementById('setup-status').classList.contains('error'));
  assert.deepEqual(await editorState(), beforeInvalidSetup);
  const importedSetup = structuredClone(defaultConfig);
  importedSetup.currency = 'KWD';
  importedSetup.operators = [{ operatorId: 'zoe', name: 'Zoe', rateMinorPerHour: 300_000 }];
  importedSetup.tasks = [{ taskId: 'walk', taskVersion: '1', name: 'Walk-through', baselinePriceMinor: 60_000, baselineMinutes: 10 }];
  importedSetup.policy.minimumOperators = 1;
  importedSetup.policy.minimumEffectiveVotes = 1;
  importedSetup.clock.seedVoteAgeDays = 0;
  await editor.locator('#setup-import').setInputFiles({ name: 'union.config.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(importedSetup)) });
  await editor.waitForFunction(() => document.getElementById('setup-currency').value === 'KWD');
  assert.deepEqual(await editorState(), beforeInvalidSetup, 'Import must load a draft without replacing live records');
  await editor.locator('#setup-apply').click();
  applied = await editorState();
  assert.equal(applied.configuration.currency, 'KWD');
  assert.equal(applied.current.taskId, 'walk');
  assert.equal(applied.current.operators[0].operatorId, 'zoe');
  assert.equal(await editor.locator('#task-select option').count(), 1);
  assert.equal(await editor.locator('#quote-operator option').count(), 1);
  await editor.locator('#reset-demo').click();
  assert.equal((await editorState()).configuration.currency, 'KWD');
  await editor.reload();
  await editor.waitForFunction(() => document.getElementById('runtime').textContent === 'Local engine ready');
  assert.equal((await editorState()).configuration.currency, defaultConfig.currency, 'Reload uses the source configuration; setup is not silently persisted');
  await editor.locator('#setup-currency').selectOption('JPY');
  await setupField('operators.ana.name');
  while (await editor.locator('[data-setup-remove="operator"]').count()) {
    await editor.locator('[data-setup-remove="operator"]').first().click();
  }
  await editor.locator('#setup-add-operator').click();
  assert.equal(await editor.locator('#setup-operators [data-field="rateMinorPerHour"]').inputValue(), '300',
    'Adding after clearing rows must preserve human amount in the new currency');
  await editor.locator('#setup-operators [data-field="name"]').fill('Alex');
  await setupField('tasks.site-photo.name');
  while (await editor.locator('[data-setup-remove="task"]').count()) {
    await editor.locator('[data-setup-remove="task"]').first().click();
  }
  await editor.locator('#setup-add-task').click();
  assert.equal(await editor.locator('#setup-tasks [data-field="baselinePriceMinor"]').inputValue(), '120');
  await editor.locator('#setup-tasks [data-field="name"]').fill('Field check');
  await editor.setViewportSize({ width: 320, height: 844 });
  assert.ok(await editor.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Expanded setup rows must fit a narrow mobile viewport');
  await editor.evaluate(() => window.scrollTo(0, 0));
  await editor.screenshot({ path: resolve(artifacts, 'union-setup-mobile.png'), fullPage: true });
  await editor.locator('#setup-apply').click();
  applied = await editorState();
  assert.equal(applied.current.operators.length, 1);
  assert.equal(applied.current.operators[0].name, 'Alex');
  assert.equal(applied.current.operators[0].rateMinorPerHour, 300);
  assert.equal(applied.current.tasks.length, 1);
  assert.equal(applied.current.taskName, 'Field check');
  assert.equal(applied.current.policy.baselinePriceMinor, 120);
  await editor.close();

  // Override only the served configuration: the same unmodified HTML, UI,
  // model and WASM must handle different currencies and entirely new tasks.
  for (const scenario of [
    { code: 'JPY', locale: 'ja-JP', scale: 1, digits: 0, rate: '301', offer: '400', payment: 600 },
    { code: 'KWD', locale: 'en-GB', scale: 1000, digits: 3, rate: '301.123', offer: '400.123', payment: 600185 },
    { code: 'EUR', locale: 'de-DE', scale: 100, digits: 2, rate: '301.23', offer: '400.12', payment: 60018 },
  ]) {
    const configured = structuredClone(defaultConfig);
    configured.currency = scenario.code;
    configured.locale = scenario.locale;
    configured.clock.timelineDays = 20;
    configured.policy.minimumOperators = 2;
    configured.policy.minimumEffectiveVotes = 1;
    configured.policy.demandSensitivityBps = 1000;
    configured.policy.maxDemandPremiumBps = 2000;
    configured.operators = [
      { operatorId: 'dara', name: 'Dara', rateMinorPerHour: 300 * scenario.scale },
      { operatorId: 'eli', name: 'Eli', rateMinorPerHour: 320 * scenario.scale },
    ];
    configured.tasks = [{ taskId: 'custom-task', taskVersion: '2', name: 'Configured task',
      baselinePriceMinor: 120 * scenario.scale, baselineMinutes: 30 }];
    configured.limits.rateMinorPerHour = 1000 * scenario.scale;
    configured.limits.baselinePriceMinor = 2000 * scenario.scale;
    configured.limits.workMinutes = 120;
    configured.limits.demandMinutes = 500;
    configured.limits.decayDays = 90;
    const currencyPage = await context.newPage();
    await currencyPage.route('**/web/simulator/union.config.json', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(configured),
    }));
    await currencyPage.goto(`${base}/web/simulator/union.html`);
    await currencyPage.waitForFunction(() => document.getElementById('runtime').textContent === 'Local engine ready');
    const current = async () => JSON.parse(await currencyPage.locator('#audit-json').textContent()).current;
    const change = async (selector, value) => {
      await currencyPage.locator(selector).fill(value);
      await currencyPage.locator(selector).dispatchEvent('change');
    };
    assert.equal(await currencyPage.locator('#task-select option').count(), 1);
    assert.equal(await currencyPage.locator('#task-select').inputValue(), 'custom-task');
    assert.equal(await currencyPage.locator('#operators-body tr').count(), 2);
    assert.equal(await currencyPage.locator('#day-offset').getAttribute('max'), '20');
    assert.equal(await currencyPage.locator('#worked-minutes').getAttribute('max'), '120');
    assert.equal(await currencyPage.locator('#requested-minutes').getAttribute('max'), '500');
    assert.equal(await currencyPage.locator('#decay-days').getAttribute('max'), '90');
    assert.equal(await currencyPage.locator('#minimum-operators').textContent(), '2');
    assert.equal(await currencyPage.locator('#minimum-effective-votes').textContent(), '1');
    assert.ok((await currencyPage.locator('#demand-formula').textContent()).includes('min(20%, 10%'));
    assert.equal(await currencyPage.locator('#rate-dara').getAttribute('step'), String(1 / scenario.scale));
    assert.equal(await currencyPage.locator('#baseline-price').inputValue(), (120).toFixed(scenario.digits));
    assert.ok((await currencyPage.locator('#collective-price').textContent()).includes(scenario.code));
    assert.ok((await currencyPage.locator('#rate-dara').getAttribute('aria-label')).includes(scenario.code));
    assert.ok((await currencyPage.locator('[data-currency]').allTextContents()).every(text => text === scenario.code));
    const before = await current();
    await change('#rate-dara', `1.${'0'.repeat(scenario.digits)}1`);
    assert.equal((await current()).operators[0].rateMinorPerHour, before.operators[0].rateMinorPerHour,
      `${scenario.code} must reject extra decimal precision`);
    await change('#rate-dara', scenario.rate);
    const expectedRate = Number(scenario.rate.replace('.', ''));
    assert.equal((await current()).operators[0].rateMinorPerHour, expectedRate);
    await currencyPage.locator('#complete-task').click();
    assert.equal((await current()).votes.at(-1).rateMinorPerHour, expectedRate);
    assert.equal((await current()).votes.at(-1).scope.currency, scenario.code);
    await change('#offer-price', scenario.offer);
    await currencyPage.locator('#accept-offer').click();
    assert.equal((await current()).acceptance.scope.currency, scenario.code);
    assert.equal((await current()).acceptance.priceMinor, Number(scenario.offer.replace('.', '')));
    await change('#approved-minutes', '45');
    await currencyPage.locator('#settle-task').click();
    assert.equal((await current()).settlement, scenario.payment);
    const exported = JSON.parse(await currencyPage.locator('#audit-json').textContent());
    assert.equal(exported.configuration.currency, scenario.code);
    assert.equal(exported.units.currencyDecimals, scenario.digits);
    await currencyPage.locator('#reset-demo').click();
    assert.equal((await current()).scope.currency, scenario.code);
    assert.equal((await current()).acceptance, null);
    assert.equal(await currencyPage.locator('#task-select').inputValue(), 'custom-task');
    if (scenario.code === 'KWD') {
      await currencyPage.setViewportSize({ width: 320, height: 844 });
      await currencyPage.evaluate(() => window.scrollTo(0, 0));
      assert.ok(await currencyPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await currencyPage.screenshot({ path: resolve(artifacts, 'union-kwd-mobile.png'), fullPage: true });
    }
    await currencyPage.close();
  }

  for (const response of [
    { status: 404, contentType: 'text/plain', body: 'Missing configuration' },
    { status: 200, contentType: 'application/json', body: '{"currency":' },
    { status: 200, contentType: 'application/json', body: JSON.stringify({ ...defaultConfig, currency: 'ZZZ' }) },
  ]) {
    const invalid = await context.newPage();
    await invalid.route('**/web/simulator/union.config.json', route => route.fulfill(response));
    await invalid.goto(`${base}/web/simulator/union.html`);
    await invalid.waitForFunction(() => document.getElementById('runtime').textContent === 'Local engine unavailable');
    assert.ok(await invalid.locator('#complete-task').isDisabled(), 'Invalid configuration must not activate defaults');
    assert.equal(await invalid.locator('#collective-price').textContent(), '—');
    await invalid.close();
  }

  const failed = await context.newPage();
  await failed.route('**/*.wasm', route => route.abort());
  await failed.goto(`${base}/web/simulator/union.html`);
  await failed.waitForFunction(() => document.getElementById('runtime').textContent === 'Local engine unavailable');
  assert.ok(await failed.locator('#complete-task').isDisabled(), 'No JS pricing fallback may run when WASM fails');
  await context.close();
  console.log(JSON.stringify({ status: 'passed', browserChannel, wasmFetches,
    scenarios: ['real WASM', 'personal R', 'completion votes', 'task isolation', 'decay and baseline',
      'low offer rejected', 'locked terms', 'approved overrun', 'no faster-work pay cut', 'JSON export',
      'desktop and mobile layout', 'local requests only', 'unavailable WASM', 'server allowlist and CSP',
      'configured tasks, Operators, policies and limits', 'JPY/EUR/KWD precision and payment',
      'visible setup, draft isolation, apply/discard, currency precision, configuration import/export',
      'missing or invalid configuration rejected'],
    screenshots: artifacts }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server.listening) await new Promise(done => { server.close(done); server.closeAllConnections(); });
}
