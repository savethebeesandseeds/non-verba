// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic review data only. Use the existing managed-container browser; never install a browser here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createReviewServer } from '../serve.mjs';

const hostile = '<img src="https://untrusted.invalid/tracker" onerror="window.__corpusExecuted = true"><script>window.__corpusExecuted = true</script>';
const fixtureReport = {
  schema_version: 1,
  title: 'Synthetic contextual discovery pilot',
  run_id: 'synthetic-browser-qa',
  status: 'RESEARCH_ONLY',
  generated_at: '2026-10-13T00:00:00Z',
  summary: { contracts: 2, clauses: 2, caveat: 'Synthetic content; no corpus download.' },
  provenance: { dataset: 'Synthetic browser fixture', seed: 491, source_sha256: 'synthetic-not-a-real-contract-hash' },
  method: { algorithm: 'Synthetic contextual grouping', holdout_affects_centroids: false },
  license: 'Synthetic test content only.',
  findings: ['Synthetic finding: notice and cure suggest a question worth testing.'],
  next_steps: ['Test the interpretation with a human reviewer.'],
  limitations: ['Synthetic limitation: two fabricated clauses cannot establish first priors.'],
  evaluation: { scenario_count: 2, result: 'SYNTHETIC_AGENT_DRAFT' },
  contracts: [
    { id: 'contract-notice', title: 'Synthetic Notice Agreement', type: 'services', source_url: 'https://example.com/synthetic-contract' },
    { id: 'contract-hostile', title: hostile, type: 'synthetic hostile input', source_url: 'javascript:window.__corpusExecuted=true' },
  ],
  clauses: [
    { id: 'clause-notice', contract_id: 'contract-notice', text: 'The receiving party must give notice and allow ten days to cure a defect.', heading: '7. Notice and cure', context_before: 'Before: each party must identify its authorized representative.', context_after: 'After: an unresolved defect may be escalated by either party.', start: 82, end: 172 },
    { id: 'clause-hostile', contract_id: 'contract-hostile', text: hostile, heading: 'Synthetic malicious markup', context_before: 'The markup is untrusted source text.', context_after: 'It must remain literal text.', source_url: 'javascript:window.__corpusExecuted=true' },
  ],
  clusters: [
    { id: 'family-notice', name: 'Notice and opportunity to cure', member_ids: ['clause-notice', 'clause-hostile'], representative_ids: ['clause-notice'], top_terms: ['notice', 'cure', 'defect'], size: 2, distinct_contracts: 2, average_similarity: 0.52, outlier_ids: ['clause-hostile'] },
  ],
  candidates: [
    { id: 'candidate-notice', name: 'Opportunity to respond', declaration: 'I favor a meaningful opportunity to respond before an unresolved defect ends cooperation.', contrast: { higher: 'Give notice and allow a reasonable response.', lower: 'Resolve the defect promptly with fewer cure opportunities.' }, boundaries: ['An opportunity to cure cannot require endless delay.'], nearest_confusions: ['Response opportunity differs from forgiving every defect.'], support: [{ clause_id: 'clause-notice', cluster_id: 'family-notice', reason: 'The synthetic clause requires a stated opportunity to cure.' }], counterexamples: [{ clause_id: 'clause-hostile', reason: 'This hostile synthetic text supplies no normative support.' }], status: 'agent_draft' },
    { id: 'candidate-speed', name: 'Responsiveness', declaration: 'I favor timely attention to an emerging problem.', contrast: { higher: 'Respond promptly.', lower: 'Allow flexibility in response time.' }, boundaries: [], nearest_confusions: [], support: [], counterexamples: [] },
    { id: 'candidate-hostile', name: hostile, declaration: hostile, boundaries: [hostile], nearest_confusions: [null], support: [null], counterexamples: [null] },
  ],
};
fixtureReport.candidates[0].scope=['procedure','remedy'];
fixtureReport.candidates[0].domain_limits=['Synthetic corporate deadlines are not universal small-task rules.'];
fixtureReport.candidates[0].support[0].context_limit='The complete synthetic clause is needed to understand the clock.';
fixtureReport.evaluation.synthetic_probes={pairs:[{id:'pair-notice',focus:'A bounded correction can favor either role',assignment_contract:{task:'Install two marked brackets.',acceptance:'Both brackets are secure and level.'},situations:[{id:'situation-notice-a',declarer_role:'Requester',potential_beneficiary:'declarer',established_facts:['One bracket is visibly off level.'],disputed_claims:['The Operator disputes the practicality of correction.'],unknowns:['The correction has not been attempted.']},{id:'situation-notice-b',declarer_role:'Requester',potential_beneficiary:'counterparty',established_facts:['The Operator offered two bounded correction visits.'],disputed_claims:['The Requester says only their preferred response should matter.'],unknowns:['The proposed correction has not been tested.']}]}]};
fixtureReport.evaluation.semantic_review={status:'AGENT_DESK_REVIEW_COMPLETED',human_evaluation:'NOT_RUN',reviews:[{candidate_id:'candidate-notice',probe_pair_id:'pair-notice',relevance:'DIRECT',reason:'Notice creates an opportunity, not proof that correction succeeds.',role_consistency:'The same meaning can take a counterparty proposal seriously.',confusions_or_limit:'Neither declared emphasis creates consent or unlimited rework.',situations:['situation-notice-a','situation-notice-b'].map(situation_id=>({situation_id,higher_emphasis:'Give the bounded proposal more attention among permitted responses.',lower_emphasis:'Give the proposal less additional emphasis while retaining duties.',evidence_limits:'The untested correction remains uncertain.',scope_guardrail:'Do not expand the agreed task or require unauthorized access.'}))}]};

const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function assertNoBodyOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert.ok(dimensions.body <= dimensions.viewport + 1, `Body overflow: ${JSON.stringify(dimensions)}`);
  assert.ok(dimensions.document <= dimensions.viewport + 1, `Document overflow: ${JSON.stringify(dimensions)}`);
}

async function assertControlWithinViewport(locator, page) {
  await locator.scrollIntoViewIfNeeded();
  assert.equal(await locator.isVisible(), true);
  const bounds = await locator.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds && bounds.width > 0 && bounds.height > 0, 'A review control has no painted bounds.');
  assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= viewport.width + 1,
    `Control is horizontally outside the viewport: ${JSON.stringify(bounds)}`);
}

test('Chromium reviews synthetic report evidence safely on desktop and mobile', { timeout: 120000 }, async (t) => {
  if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') {
    t.skip('Browser QA must run inside the documented non-verba-dev Linux container (NONVERBA_CONTAINER=1).');
    return;
  }
  const require = createRequire(import.meta.url);
  let chromium;
  const playwrightPath = process.env.NONVERBA_PLAYWRIGHT_PATH || '/opt/nonverba-tools/browser-tests/node_modules/playwright';
  try { ({ chromium } = require(playwrightPath)); }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    t.skip(`Existing Playwright is unavailable at ${playwrightPath}; no installation was attempted.`);
    return;
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.NONVERBA_BROWSER_EXECUTABLE ? { executablePath: process.env.NONVERBA_BROWSER_EXECUTABLE } : {}) });
  } catch (error) {
    if (!/Executable doesn't exist|executable doesn't exist|executable doesn't exist at|Failed to launch chromium because executable/i.test(error.message)) throw error;
    t.skip('The existing Chromium executable is unavailable; no browser installation was attempted.');
    return;
  }
  t.after(() => browser.close());
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'priors-browser-test-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));
  await writeFile(path.join(runDir, 'report.json'), JSON.stringify(fixtureReport));
  const server = await createReviewServer({ runDir });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function makePage(viewport = { width: 1366, height: 900 }, entry = '/') {
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    const errors = []; const externalRequests = [];
    await context.addInitScript(() => {
      window.__corpusExecuted = false;
      window.__reviewCsp = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__reviewCsp.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
      });
    });
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).origin !== base) {
        externalRequests.push(route.request().url()); return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
    const response = await page.goto(base + entry);
    await page.getByRole('status').filter({ hasText: 'Loaded server report.json' }).waitFor();
    await settle(page);
    return { page, context, response, errors, externalRequests };
  }

  await t.test('candidate → family → contextual clause → safe original source lineage', async () => {
    const { page, context, errors, externalRequests } = await makePage();
    try {
      assert.equal(await page.getByRole('heading', { name: 'Priors Derivation Lab', exact: true }).isVisible(), true);
      assert.equal(await page.getByText('PROTOTYPE / RESEARCH ONLY', { exact: true }).isVisible(), true);
      assert.equal(await page.getByText('AGENT DRAFT · NOT ADOPTED', { exact: true }).isVisible(), true);
      const source = page.locator('#evidence-clause-notice').getByRole('link', { name: 'Original contract ↗' });
      assert.equal(await source.getAttribute('href'), 'https://example.com/synthetic-contract');
      assert.equal(await source.getAttribute('rel'), 'noopener noreferrer');
      await page.locator('#evidence-clause-notice').getByText('Context & source record', { exact: true }).click();
      assert.equal(await page.getByText(fixtureReport.clauses[0].context_before, { exact: true }).isVisible(), true);
      assert.equal(await page.getByText(fixtureReport.clauses[0].context_after, { exact: true }).isVisible(), true);
      await page.getByRole('button', { name: 'Family family-notice →', exact: true }).click();
      assert.equal(await page.getByRole('heading', { name: 'Notice and opportunity to cure', exact: true, level: 2 }).isVisible(), true);
      assert.equal(await page.getByRole('heading', { name: 'Low similarity members (1)', exact: true }).isVisible(), true);
      const evidenceIds = await page.locator('[id^="evidence-"]').evaluateAll((nodes) => nodes.map((node) => node.id));
      assert.equal(new Set(evidenceIds).size, evidenceIds.length, 'The same clause must not create duplicate family evidence IDs.');
      const primaryEvidence = page.locator('#evidence-clause-notice');
      assert.equal(await primaryEvidence.getByText(fixtureReport.clauses[0].text, { exact: true }).isVisible(), true);
      assert.equal(await primaryEvidence.getByRole('link', { name: 'Original contract ↗' }).getAttribute('href'), 'https://example.com/synthetic-contract');
      await page.getByRole('button', { name: 'Opportunity to respond →', exact: true }).click();
      assert.equal(await page.getByRole('heading', { name: 'Opportunity to respond', exact: true, level: 2 }).isVisible(), true);
      assert.equal(await page.evaluate(() => window.__corpusExecuted), false);
      assert.deepEqual(externalRequests, []); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  await t.test('search, method and findings expose recorded data without inventing adoption', async () => {
    const { page, context, errors } = await makePage();
    try {
      await page.getByRole('searchbox', { name: 'Search candidates' }).fill('Responsiveness');
      assert.equal(await page.locator('.browse-item').count(), 1);
      assert.equal(await page.getByRole('heading', { name: 'Responsiveness', exact: true, level: 2 }).isVisible(), true);
      await page.getByRole('searchbox', { name: 'Search candidates' }).fill('absent-synthetic-term');
      assert.equal(await page.getByText('No candidate matches this search.', { exact: true }).isVisible(), true);
      await page.getByRole('button', { name: 'Method & provenance', exact: true }).click();
      assert.equal(await page.getByText('Synthetic browser fixture', { exact: true }).isVisible(), true);
      assert.equal(await page.getByText('Synthetic contextual grouping', { exact: true }).isVisible(), true);
      assert.equal(await page.getByText('Synthetic test content only.', { exact: true }).isVisible(), true);
      await page.getByRole('button', { name: 'Findings & limits', exact: true }).click();
      assert.equal(await page.getByText(fixtureReport.findings[0], { exact: true }).isVisible(), true);
      assert.equal(await page.getByText(fixtureReport.limitations[0], { exact: true }).isVisible(), true);
      assert.equal(await page.getByText('SYNTHETIC_AGENT_DRAFT', { exact: true }).isVisible(), true);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  await t.test('authored probe readings expose shared facts and limits on desktop and mobile',async()=>{
    for(const viewport of [{width:1366,height:900},{width:390,height:844}]) {
      const {page,context,errors}=await makePage(viewport);
      try {
        assert.equal(await page.getByText('Research scope: procedure, remedy.',{exact:true}).count(),1);
        assert.equal(await page.getByText(fixtureReport.candidates[0].domain_limits[0],{exact:true}).count(),1);
        assert.equal(await page.getByText(`Source context limit: ${fixtureReport.candidates[0].support[0].context_limit}`,{exact:true}).count(),1);
        await page.locator('.desk-review summary').click();
        assert.equal(await page.getByText('One bracket is visibly off level.',{exact:true}).isVisible(),true);
        assert.equal(await page.getByText('The proposed correction has not been tested.',{exact:true}).isVisible(),true);
        assert.equal(await page.getByText('Requester declaration · possible counterparty benefit',{exact:true}).isVisible(),true);
        assert.equal(await page.getByText('Do not expand the agreed task or require unauthorized access.',{exact:true}).count(),2);
        await assertNoBodyOverflow(page);assert.deepEqual(errors,[]);
      } finally {await context.close();}
    }
  });

  await t.test('local review download stays separate from the report and adopts no prior', async () => {
    const { page, context, errors } = await makePage();
    try {
      assert.equal(await page.getByRole('button', { name: 'Export review', exact: true }).isDisabled(), true);
      await page.getByLabel('Your investigation decision', { exact: true }).selectOption('revise');
      await page.getByLabel('Review notes', { exact: true }).fill('Synthetic reviewer: inspect a narrower boundary. <b>This is literal text.</b>');
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export review', exact: true }).click();
      const download = await downloadPromise;
      const file = await download.path(); assert.ok(file, 'The local review export did not produce a download.');
      const exported = JSON.parse(await readFile(file, 'utf8'));
      assert.equal(exported.artifact_type, 'priors_derivation_local_review'); assert.equal(exported.prototype, true);
      assert.equal(exported.report_reference.run_id, fixtureReport.run_id);
      assert.equal(exported.decisions[0].candidate_id, 'candidate-notice'); assert.equal(exported.decisions[0].decision, 'revise');
      assert.match(exported.decisions[0].notes, /<b>This is literal text\.<\/b>/);
      assert.match(exported.adoption_status, /No priors are adopted/);
      assert.equal(await page.getByText('AGENT DRAFT · NOT ADOPTED', { exact: true }).isVisible(), true);
      assert.deepEqual(await (await context.request.get(base + '/report.json')).json(), fixtureReport);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  await t.test('imported HTML, handlers and javascript source URLs remain inert', async () => {
    const { page, context, errors, externalRequests } = await makePage();
    try {
      const imported = { ...fixtureReport, title: 'Synthetic hostile import', candidates: [fixtureReport.candidates[2]], clusters: [], clauses: [], contracts: [] };
      await page.locator('#report-file').setInputFiles({ name: 'synthetic-hostile-report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
      await page.getByRole('status').filter({ hasText: 'Loaded synthetic-hostile-report.json' }).waitFor();
      assert.equal(await page.locator('.declaration').textContent(), hostile);
      assert.equal(await page.locator('#workspace script, #workspace img').count(), 0);
      assert.equal(await page.evaluate(() => window.__corpusExecuted), false);
      await page.locator('#report-file').setInputFiles({ name: 'synthetic-complete-report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixtureReport)) });
      await page.getByRole('status').filter({ hasText: 'Loaded synthetic-complete-report.json' }).waitFor();
      const hostileEvidence = page.locator('#evidence-clause-hostile');
      assert.equal(await hostileEvidence.getByRole('link').count(), 0);
      assert.equal(await hostileEvidence.getByText('No verified source link', { exact: true }).isVisible(), true);
      assert.equal(await hostileEvidence.locator('blockquote').textContent(), hostile);
      assert.equal(await page.locator('#workspace script, #workspace img').count(), 0);
      assert.equal(await page.evaluate(() => window.__corpusExecuted), false);
      assert.deepEqual(externalRequests, []); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  await t.test('desktop and mobile views contain their controls without body overflow', async () => {
    for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
      const { page, context, errors } = await makePage(viewport);
      try {
        await assertNoBodyOverflow(page);
        await assertControlWithinViewport(page.locator('label[for="report-file"]'), page);
        await assertControlWithinViewport(page.getByRole('button', { name: 'Export review', exact: true }), page);
        await assertControlWithinViewport(page.getByRole('searchbox', { name: 'Search candidates' }), page);
        await assertControlWithinViewport(page.getByLabel('Your investigation decision', { exact: true }), page);
        await assertControlWithinViewport(page.getByLabel('Review notes', { exact: true }), page);
        for (const name of [/^Clause families/, 'Method & provenance', 'Findings & limits']) {
          const tab = page.getByRole('button', { name });
          await tab.click(); await settle(page); await assertNoBodyOverflow(page);
          await assertControlWithinViewport(tab, page);
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  });

  await t.test('strict entry blocks inline styles and scripts; local review permits only style elements', async () => {
    for (const [entry, styleAllowed] of [['/', false], ['/review.html', true]]) {
      const { page, context, response, errors } = await makePage({ width: 1366, height: 900 }, entry);
      try {
        const headers = await response.allHeaders(); const policy = headers['content-security-policy'];
        assert.equal(headers['x-robots-tag'], 'noindex, nofollow');
        assert.match(policy, /script-src 'self';/); assert.match(policy, /style-src-attr 'none'/);
        assert.equal(/style-src-elem 'self' 'unsafe-inline'/.test(policy), styleAllowed);
        await page.evaluate(() => {
          const probe = document.createElement('div'); probe.id = 'csp-style-probe'; probe.textContent = 'Synthetic policy probe';
          document.body.append(probe);
          const style = document.createElement('style'); style.textContent = '#csp-style-probe { color: rgb(1, 2, 3); }'; document.head.append(style);
          const script = document.createElement('script'); script.textContent = 'window.__corpusExecuted = true'; document.head.append(script);
          probe.setAttribute('style', 'background-color: rgb(4, 5, 6)');
        });
        await settle(page);
        const result = await page.evaluate(() => ({
          color: getComputedStyle(document.getElementById('csp-style-probe')).color,
          background: getComputedStyle(document.getElementById('csp-style-probe')).backgroundColor,
          executed: window.__corpusExecuted, violations: window.__reviewCsp,
        }));
        assert.equal(result.color === 'rgb(1, 2, 3)', styleAllowed);
        assert.notEqual(result.background, 'rgb(4, 5, 6)'); assert.equal(result.executed, false);
        assert.ok(result.violations.some((violation) => violation.directive === 'script-src-elem'));
        assert.ok(result.violations.some((violation) => violation.directive === 'style-src-attr'));
        if (!styleAllowed) assert.ok(result.violations.some((violation) => violation.directive === 'style-src-elem'));
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  });
});
