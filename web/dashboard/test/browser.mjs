// SPDX-License-Identifier: AGPL-3.0-only
// Real Chromium opens an isolated file and drills down from Hero to Goal.
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderStandalone } from '../build-standalone.mjs';
import { filterHeroes, flattenMilestones, summarize, validateProject } from '../model.js';

if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Run dashboard browser checks inside non-verba-dev.');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const dashboard = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapshotRoot = resolve(dashboard, '../..');
const screenshotDirectory = process.env.NONVERBA_DASHBOARD_SCREENSHOTS ? resolve(process.env.NONVERBA_DASHBOARD_SCREENSHOTS) : null;
if (screenshotDirectory && !screenshotDirectory.startsWith(snapshotRoot + sep)) throw new Error('Dashboard screenshots must stay inside this source snapshot.');
const manifest = JSON.parse(await readFile(resolve(dashboard, 'manifest.json'), 'utf8'));
const heroes = await Promise.all(manifest.heroes.map(async ({ file }) => JSON.parse(await readFile(resolve(dashboard, file), 'utf8'))));
validateProject(manifest, heroes);
const record = { manifest, heroes }, summary = summarize(heroes), rows = flattenMilestones(heroes);
const records = new Map(rows.map((row) => [row.milestone.id, row]));
const labels = { proposed: 'Proposed', ready: 'Ready', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };
const first = rows[0];
const isolatedDirectory = await mkdtemp(join(tmpdir(), 'nonverba-dashboard-file-'));
const isolatedFile = join(isolatedDirectory, 'dashboard.html'), disposableFiles = [isolatedFile];
await copyFile(resolve(dashboard, 'index.html'), isolatedFile);
let browser;
const check = async (label, action) => { await action(); console.log('PASS ' + label); };

async function fixture(name, value) {
  const file = join(isolatedDirectory, name + '.html');
  await writeFile(file, await renderStandalone(value));
  disposableFiles.push(file);
  return file;
}

async function decodedArtwork(page) {
  const images = await page.locator('img').evaluateAll(async (images) => Promise.all(images.map(async (image) => {
    await image.decode();
    return { source: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight };
  })));
  assert.ok(images.length > 0, 'Brand and Hero artwork should be present.');
  assert.ok(images.every(({ source, width, height }) => source?.startsWith('data:image/') && width > 0 && height > 0), 'Every image must decode from its embedded data URI.');
}

async function capture(page, name) {
  if (!screenshotDirectory) return;
  await decodedArtwork(page);
  await mkdir(screenshotDirectory, { recursive: true });
  const actual = await realpath(screenshotDirectory);
  if (!actual.startsWith((await realpath(snapshotRoot)) + sep)) throw new Error('Screenshot destination resolves outside this source snapshot.');
  await page.screenshot({ path: join(screenshotDirectory, name + '.png'), fullPage: false, animations: 'disabled' });
}

async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
}

async function progressMatches(locator, done, total) {
  const value = await locator.evaluate((element) => ({ value: element.value, max: element.max, label: element.getAttribute('aria-label') }));
  assert.equal(value.value, done);
  assert.equal(value.max, Math.max(total, 1));
  assert.ok(value.label?.trim(), 'Progress needs an accessible count label.');
}

async function recordedRollupLabel(locator, milestones) {
  const expected = milestones.length === 0 ? 'No milestones' : milestones.every((milestone) => milestone.status === 'done') ? 'Recorded complete' : null;
  if (!expected) return;
  assert.equal(await locator.textContent(), expected, 'Rollups must describe the recorded milestone scope.');
  assert.ok((await locator.getAttribute('aria-label')).includes(expected));
}

async function overview(page, expectedHeroes = heroes) {
  assert.equal(await page.locator('#project-overview').isVisible(), true);
  assert.equal(await page.locator('#workspace').isVisible(), false);
  assert.equal(await page.locator('.hero-card, .goal-card, .milestone').count(), 0, 'The project overview must not render detailed records.');
  assert.equal(await page.locator('.hero-tile').count(), expectedHeroes.length);
}

async function selectHero(page, hero) {
  if (await page.locator('#project-overview').isVisible()) await page.locator(`.hero-tile[data-hero-id="${hero.id}"]`).click();
  else await page.locator(`.nav-button[data-hero-id="${hero.id}"]`).click();
  assert.equal(await page.locator('#workspace').isVisible(), true);
  assert.equal(await page.locator('#project-overview').isVisible(), false);
  assert.equal(await page.locator('#project-intro').isVisible(), false);
  assert.equal(await page.locator('.hero-card').count(), 1);
  assert.equal(await page.locator(`#hero-title-${hero.id}`).textContent(), hero.title);
  assert.equal(await page.locator('.goal-tile').count(), hero.goals.length);
  assert.equal(await page.locator('.goal-card, .milestone').count(), 0, 'Selecting a Hero must wait for explicit Goal selection.');
  assert.equal(await page.locator('.goal-selection-empty').isVisible(), true);
  assert.equal(await page.locator('#detail-toolbar').isVisible(), false);
  assert.equal(await page.locator('#search').inputValue(), '');
  assert.equal(await page.locator('#status-filter').inputValue(), 'all');
  await recordedRollupLabel(page.locator(`#hero-${hero.id} .hero-heading > .status-badge`), hero.goals.flatMap((goal) => goal.milestones));
  await progressMatches(page.locator(`#hero-${hero.id} .hero-progress`), summarize([hero]).done, summarize([hero]).total);
  for (const goal of hero.goals) {
    const tile = page.locator(`.goal-tile[data-goal-id="${goal.id}"]`);
    const done = goal.milestones.filter((milestone) => milestone.status === 'done').length;
    await recordedRollupLabel(tile.locator('.goal-tile-top > .status-badge'), goal.milestones);
    assert.equal(await tile.locator('.goal-tile-count').innerText(), `${done} of ${goal.milestones.length} milestones done`);
    await progressMatches(tile.locator('.goal-tile-progress'), done, goal.milestones.length);
    const ringFill = Number.parseFloat(await tile.locator('.goal-ring-fill').getAttribute('stroke-dasharray'));
    assert.ok(Math.abs(ringFill - (goal.milestones.length ? done / goal.milestones.length * 100 : 0)) < 0.0001);
    const dots = await tile.locator('.goal-state-dot').evaluateAll((elements) => elements.map((element) => ({ title: element.title, status: [...element.classList].find((value) => value.startsWith('status-')).slice(7) })));
    assert.deepEqual(dots, goal.milestones.map((milestone) => ({ title: `${milestone.title} · ${labels[milestone.status]}`, status: milestone.status })));
  }
}

async function selectedGoal(page, hero, goal) {
  assert.equal(await page.locator('.hero-card').count(), 1);
  assert.equal(await page.locator(`#hero-${hero.id}`).count(), 1);
  assert.equal(await page.locator('.goal-card').count(), 1);
  assert.equal(await page.locator(`#goal-title-${goal.id}`).textContent(), goal.title);
  await recordedRollupLabel(page.locator(`#goal-${goal.id} .goal-heading-actions > .status-badge`), goal.milestones);
  assert.equal(await page.locator('.goal-selection-empty').isVisible(), false);
  const query = await page.locator('#search').inputValue(), status = await page.locator('#status-filter').inputValue();
  const projection = filterHeroes([hero], { query, status });
  const visible = projection[0]?.goals.find(({ id }) => id === goal.id)?.milestones || [];
  assert.equal(await page.locator('#detail-toolbar').isVisible(), visible.length > 0);
  assert.equal(await page.locator('.goal-tile').count(), hero.goals.length, 'The Hero grid must retain all original Goal choices.');
  for (const original of hero.goals) {
    const tile = page.locator(`.goal-tile[data-goal-id="${original.id}"]`);
    const done = original.milestones.filter((milestone) => milestone.status === 'done').length;
    assert.equal(await tile.locator('.goal-tile-count').innerText(), `${done} of ${original.milestones.length} milestones done`);
    if (query.trim() || status !== 'all') {
      const count = projection[0]?.goals.find(({ id }) => id === original.id)?.milestones.length || 0;
      assert.equal(await tile.locator('.goal-tile-match').innerText(), `${count} matching milestones`);
    }
  }
  assert.deepEqual(await page.locator('.milestone').evaluateAll((details) => details.map((element) => element.id)), visible.map(({ id }) => 'item-' + id));
  assert.equal(await page.locator(`.goal-tile[data-goal-id="${goal.id}"]`).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator(`#goal-${goal.id} .goal-number`).textContent(), String(hero.goals.indexOf(goal) + 1).padStart(2, '0'));
  const expectedStates = ['done', 'in_progress', 'blocked', 'ready', 'proposed'].flatMap((status) => {
    const count = goal.milestones.filter((milestone) => milestone.status === status).length;
    return count ? [`${count} ${labels[status].toLowerCase()}`] : [];
  });
  assert.deepEqual(await page.locator(`#goal-${goal.id} .goal-state-count`).allTextContents(), expectedStates);
  await progressMatches(page.locator(`#goal-${goal.id} .goal-progress`), goal.milestones.filter((milestone) => milestone.status === 'done').length, goal.milestones.length);
  for (const milestone of visible) {
    assert.equal(await page.locator(`#item-${milestone.id} .milestone-step`).textContent(), 'Milestone ' + String(goal.milestones.indexOf(milestone) + 1).padStart(2, '0'));
    assert.equal(await page.locator(`#item-${milestone.id} > summary > .status-badge`).textContent(), labels[milestone.status], 'Individual milestones retain their actual state label.');
  }
}

async function selectGoal(page, hero, goal) {
  await page.locator(`.goal-tile[data-goal-id="${goal.id}"]`).click();
  await selectedGoal(page, hero, goal);
}

async function expandedMilestoneCapture(page, milestone, name, focusHeader = false) {
  const row = page.locator(`#item-${milestone.id}`);
  if (!await row.evaluate((element) => element.open)) await row.locator(':scope > summary').click();
  await milestoneHeader(page, milestone, true);
  if (milestone.acceptance?.length) assert.deepEqual(await row.locator('.criteria-list .criterion-copy').allTextContents(), milestone.acceptance);
  if (milestone.evidence?.length) assert.equal(await row.locator('.evidence-link').first().isVisible(), true);
  const acceptanceColors = await renderedColors(row.locator('.field-acceptance'));
  const evidenceColors = await renderedColors(row.locator('.field-evidence'));
  assert.notEqual(acceptanceColors.background, evidenceColors.background, 'Criteria and evidence need distinct field backgrounds.');
  await readableText(row.locator('.field-heading h5, .field-count, .criterion-number, .criterion-copy, .evidence-content > span, .field-empty'));
  await row.locator(focusHeader ? ':scope > summary' : '.milestone-fields').evaluate((element, focusHeader) => element.scrollIntoView({ block: focusHeader ? 'start' : 'center', behavior: 'auto' }), focusHeader);
  for (const selector of ['.field-acceptance', '.field-evidence']) {
    const bounds = await row.locator(selector).boundingBox();
    assert.ok(bounds && bounds.y < page.viewportSize().height && bounds.y + bounds.height > 0, 'Expanded fields should intersect the viewport.');
  }
  await noOverflow(page);
  await capture(page, name);
}

async function incidentCapture(page, dimensions) {
  if (!screenshotDirectory) return;
  const target = records.get('incidents-notice-materiality');
  if (!target) return;
  await selectHero(page, target.hero);
  await selectGoal(page, target.hero, target.goal);
  await expandedMilestoneCapture(page, target.milestone, 'incidents-milestone-expanded-' + dimensions, true);
}

async function identityCapture(page, dimensions) {
  if (!screenshotDirectory) return;
  const target = records.get('identity-registration-prototype');
  assert.ok(target, 'The annotated registration milestone should remain in the authored record.');
  await selectHero(page, target.hero);
  await selectGoal(page, target.hero, target.goal);
  const row = page.locator(`#item-${target.milestone.id}`);
  if (await row.evaluate((element) => element.open)) await row.locator(':scope > summary').click();
  await milestoneHeader(page, target.milestone, false);
  await row.locator(':scope > summary').evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'auto' }));
  await noOverflow(page);
  await capture(page, 'identity-milestone-closed-' + dimensions);
  await expandedMilestoneCapture(page, target.milestone, 'identity-milestone-expanded-' + dimensions, true);
}

async function renderedColors(locator) {
  return locator.evaluate((element) => {
    const parse = (value) => {
      const values = value.match(/[\d.]+/g).map(Number);
      return [...values.slice(0, 3), values.length === 4 ? values[3] : 1];
    };
    const layers = [];
    for (let current = element; current; current = current.parentElement) layers.push(parse(getComputedStyle(current).backgroundColor));
    let background = [255, 255, 255];
    for (const layer of layers.reverse()) background = background.map((channel, index) => layer[index] * layer[3] + channel * (1 - layer[3]));
    return { foreground: getComputedStyle(element).color, background: `rgb(${background.join(', ')})` };
  });
}

async function readableText(locator) {
  for (const element of await locator.all()) {
    const { foreground, background } = await renderedColors(element);
    assert.ok(textContrast(foreground, background) >= 4.5, `Text '${(await element.textContent()).trim()}' needs at least 4.5:1 contrast against its rendered background.`);
  }
}

async function milestoneHeader(page, milestone, expanded) {
  const row = page.locator(`#item-${milestone.id}`), header = row.locator(':scope > summary.milestone-header');
  assert.equal(await header.count(), 1);
  assert.equal(await row.locator('.milestone-body .milestone-description').count(), 0, 'Description belongs once in the summary header.');
  const preview = header.locator('.milestone-preview');
  if (milestone.description) {
    assert.equal(await preview.count(), 1);
    assert.equal(await preview.textContent(), milestone.description);
    assert.equal(await preview.isVisible(), true, 'The description should remain visible when a milestone opens.');
    assert.equal(await preview.locator('img, script').count(), 0, 'Description markup must remain literal text.');
    const metrics = await preview.evaluate((element) => {
      const style = getComputedStyle(element);
      return { clamp: style.webkitLineClamp, overflow: style.overflow, height: element.clientHeight, fullHeight: element.scrollHeight, lineHeight: Number.parseFloat(style.lineHeight) };
    });
    if (expanded) {
      assert.notEqual(metrics.clamp, '2');
      assert.equal(metrics.overflow, 'visible');
      assert.ok(metrics.height + 1 >= metrics.fullHeight, 'Opening a milestone should show its full description without clipping.');
    } else {
      assert.equal(metrics.clamp, '2');
      assert.ok(metrics.height <= metrics.lineHeight * 2 + 1, 'Closed descriptions should use at most two visible lines.');
    }
  } else assert.equal(await preview.count(), 0);
  const blockedLabel = header.locator('.milestone-context-label');
  assert.equal(await blockedLabel.count(), milestone.status === 'blocked' ? 1 : 0);
  if (milestone.status === 'blocked') {
    assert.equal(await blockedLabel.textContent(), 'Why this is blocked');
    assert.equal(await blockedLabel.evaluate((element) => Boolean(element.compareDocumentPosition(element.parentElement.querySelector('.milestone-preview')) & Node.DOCUMENT_POSITION_FOLLOWING)), true, 'The blocked reason label should precede its description.');
  }
  await readableText(header.locator('.milestone-step, .milestone-title, .milestone-preview, .milestone-context-label, .milestone-quick-meta'));
}

function textContrast(foreground, background) {
  const luminance = (value) => {
    assert.match(value, /^rgba?\(/);
    const components = value.match(/[\d.]+/g).map(Number);
    assert.ok(components.length === 3 || (components.length === 4 && components[3] === 1), 'Contrast colors must be opaque.');
    const linear = components.slice(0, 3).map((channel) => {
      const srgb = channel / 255;
      return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const first = luminance(foreground), second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

async function session(viewport = { width: 1440, height: 1000 }, file = isolatedFile, options = {}) {
  const context = await browser.newContext({ viewport, ...options }), page = await context.newPage();
  const errors = [], requests = [], violations = [], pageUrl = pathToFileURL(file).href;
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('request', (request) => requests.push(request.url()));
  page.on('console', (message) => {
    if (/content.security.policy|violates.*(?:script-src|style-src|connect-src)|refused to (?:load|execute|apply|connect)/i.test(message.text())) violations.push(message.text());
  });
  await page.goto(pageUrl);
  await page.locator('#dashboard').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#load-error').isVisible(), false);
  assert.equal(await page.locator('#hero-files, #hero-folder, #choose-files, #choose-folder').count(), 0);
  assert.equal(await page.locator('#filter-panel').count(), 1);
  await decodedArtwork(page);
  return { page, context, async clean() {
    await decodedArtwork(page);
    assert.deepEqual(errors, []);
    assert.deepEqual(violations, []);
    assert.deepEqual(requests.filter((url) => url !== pageUrl && !url.startsWith('data:')), [], 'The HTML must not fetch adjacent files or network resources.');
    await context.close();
  } };
}

try {
  browser = await chromium.launch({ headless: true, ...(process.env.NONVERBA_BROWSER_EXECUTABLE ? { executablePath: process.env.NONVERBA_BROWSER_EXECUTABLE } : {}) });

  await check('the isolated file opens a compact overview and requires explicit Hero and Goal selection', async () => {
    const current = await session(), { page } = current;
    assert.deepEqual(await page.evaluate(() => window.NonVerbaDashboardRecord), record);
    await overview(page);
    await progressMatches(page.locator('#project-progress .project-progress-meter'), summary.done, summary.total);
    for (const hero of heroes) {
      const tile = page.locator(`.hero-tile[data-hero-id="${hero.id}"]`), counts = summarize([hero]);
      await recordedRollupLabel(tile.locator('.hero-tile-status'), hero.goals.flatMap((goal) => goal.milestones));
      assert.equal(await tile.locator('.hero-tile-count').innerText(), `${counts.done}/${counts.total}`);
      await progressMatches(tile.locator('.hero-tile-progress'), counts.done, counts.total);
    }
    await noOverflow(page);
    await capture(page, 'desktop-1440x1000');
    for (const [key, status] of [['done', 'done'], ['blocked', 'blocked'], ['in_progress', 'in_progress'], ['ready', 'ready'], ['proposed', 'proposed'], ['total', 'all']]) {
      await page.locator(`#overview-counts .stat-${key}`).click();
      assert.equal(await page.locator('#status-filter').inputValue(), status);
      assert.equal(await page.locator(`#overview-counts .stat-${key}`).getAttribute('aria-pressed'), 'true');
      const matches = filterHeroes(heroes, { status });
      await overview(page, matches);
      const resultText = await page.locator('#project-results').innerText();
      if (status === 'all') assert.ok(resultText.includes(`${heroes.length} Heroes`));
      else assert.equal(resultText, `${matches.length} of ${heroes.length} Heroes · ${summarize(matches).total} matching milestones`);
    }
    const completeHero = heroes.find((hero) => { const counts = summarize([hero]); return counts.total > 0 && counts.done === counts.total; });
    assert.ok(completeHero, 'The retained record should include an evidenced complete milestone scope.');
    await selectHero(page, completeHero);
    await selectGoal(page, completeHero, completeHero.goals.find((goal) => goal.milestones.length > 0));
    assert.ok((await page.locator('.milestone > summary > .status-badge').allTextContents()).every((label) => label === 'Done'));
    await page.locator('.overview-return').click();
    await page.locator('#search').fill(first.hero.title);
    await overview(page, filterHeroes(heroes, { query: first.hero.title }));
    await selectHero(page, first.hero);
    await noOverflow(page);
    await capture(page, 'hero-detail-1440x1000');
    await selectGoal(page, first.hero, first.goal);
    await noOverflow(page);
    await capture(page, 'goal-detail-1440x1000');
    await milestoneHeader(page, first.milestone, false);
    await expandedMilestoneCapture(page, first.milestone, 'milestone-expanded-1440x1000');
    await incidentCapture(page, '1440x1000');
    await identityCapture(page, '1440x1000');
    await page.locator('.goal-clear').click();
    assert.equal(await page.locator('.hero-card').count(), 1);
    assert.equal(await page.locator('.goal-card, .milestone').count(), 0);
    await page.locator('.overview-return').click();
    await overview(page);
    await current.clean();
  });

  await check('Goal choice, filters and collapse retain one context with stable original numbering', async () => {
    const current = await session(), { page } = current;
    const hero = heroes.find((hero) => hero.goals.filter((goal) => goal.milestones.length > 0).length > 1);
    const [firstGoal, secondGoal] = hero.goals.filter((goal) => goal.milestones.length > 0);
    await selectHero(page, hero);
    await selectGoal(page, hero, firstGoal);
    const milestone = firstGoal.milestones.at(-1), row = page.locator(`#item-${milestone.id}`);
    await row.locator(':scope > summary').click();
    await page.locator('#search').fill(milestone.id);
    await selectedGoal(page, hero, firstGoal);
    await page.locator('#reset').click();
    await selectedGoal(page, hero, firstGoal);
    assert.equal(await row.evaluate((element) => element.open), true);
    await row.locator(':scope > summary').click();
    await page.locator('#search').fill(milestone.id);
    await page.locator('#reset').click();
    assert.equal(await row.evaluate((element) => element.open), false);
    await page.locator(`#toggle-${firstGoal.id}`).click();
    assert.equal(await page.locator(`#milestones-${firstGoal.id}`).isVisible(), false);
    await page.locator('#search').fill(milestone.id);
    assert.equal(await page.locator(`#milestones-${firstGoal.id}`).isVisible(), true);
    await page.locator('#reset').click();
    assert.equal(await page.locator(`#milestones-${firstGoal.id}`).isVisible(), false);
    await selectGoal(page, hero, secondGoal);
    assert.equal(await page.locator(`#goal-${firstGoal.id}`).count(), 0);
    await selectGoal(page, hero, firstGoal);
    assert.equal(await page.locator(`#milestones-${firstGoal.id}`).isVisible(), true, 'Explicit Goal selection should reveal its milestones.');
    await page.locator(`#toggle-${firstGoal.id}`).click();
    assert.equal(await page.locator(`#milestones-${firstGoal.id}`).isVisible(), false);
    await page.locator('#expand-all').click();
    assert.equal(await page.locator(`#milestones-${firstGoal.id}`).isVisible(), true);
    assert.equal(await page.locator('.milestone').evaluateAll((details) => details.every((element) => element.open)), true);
    await page.locator('#collapse-all').click();
    assert.equal(await page.locator(`#milestones-${firstGoal.id}`).isVisible(), true);
    assert.equal(await page.locator('.milestone').evaluateAll((details) => details.every((element) => !element.open)), true);
    await page.locator('#search').fill(secondGoal.milestones.at(-1).id);
    await selectedGoal(page, hero, firstGoal);
    assert.equal(await page.locator('.milestone').count(), 0, 'Filtering must retain the selected Goal without opening another Goal.');
    assert.equal(await page.locator('.goal-milestones-empty').isVisible(), true);
    assert.equal(await page.locator(`.goal-tile[data-goal-id="${firstGoal.id}"]`).getAttribute('aria-pressed'), 'true');
    await selectGoal(page, hero, secondGoal);
    const projected = filterHeroes([hero], { query: secondGoal.milestones.at(-1).id })[0].goals.find(({ id }) => id === secondGoal.id);
    assert.ok((await page.locator(`.goal-tile[data-goal-id="${secondGoal.id}"] .goal-tile-match`).innerText()).includes(String(projected.milestones.length)));
    await page.locator('#reset').click();
    await selectedGoal(page, hero, secondGoal);
    await page.locator('.nav-button[data-hero-id="all"]').click();
    await overview(page);
    await current.clean();
  });

  await check('pointer and native keyboard Goal choices preserve the navigator, focus and viewport', async () => {
    const hero = heroes.find((hero) => hero.goals.length > 1);
    assert.ok(hero, 'The project should demonstrate multiple Goal choices.');
    for (const { viewport, reducedMotion } of [
      { viewport: { width: 1440, height: 1000 }, reducedMotion: false },
      { viewport: { width: 1440, height: 1000 }, reducedMotion: true },
      { viewport: { width: 390, height: 844 }, reducedMotion: false },
      { viewport: { width: 390, height: 844 }, reducedMotion: true },
    ]) {
      const current = await session(viewport, isolatedFile, reducedMotion ? { reducedMotion: 'reduce' } : {}), { page } = current;
      await selectHero(page, hero);
      assert.equal(await page.locator('#goal-selection-status').getAttribute('aria-live'), 'polite');
      const panel = await page.locator('#goal-detail').elementHandle();
      let previousCard = null;
      for (const [goal, action] of [[hero.goals[0], 'pointer'], [hero.goals[1], 'Enter'], [hero.goals[0], 'Space']]) {
        const tile = page.locator(`.goal-tile[data-goal-id="${goal.id}"]`);
        await tile.scrollIntoViewIfNeeded();
        if (action !== 'pointer') await tile.focus();
        const originalTile = await tile.elementHandle();
        const before = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
        const boundsBefore = await tile.boundingBox();
        const gridBefore = await page.locator('.goal-grid').evaluate((element) => ({ top: element.scrollTop, left: element.scrollLeft, height: element.clientHeight, contentHeight: element.scrollHeight }));
        if (action === 'pointer') await tile.click();
        else await tile.press(action);
        await selectedGoal(page, hero, goal);
        assert.equal(await originalTile.evaluate((element, id) => element.isConnected && element === document.querySelector(`.goal-tile[data-goal-id="${id}"]`), goal.id), true, 'Goal choice must retain the original navigator button.');
        assert.equal(await originalTile.evaluate((element) => element === document.activeElement), true, 'Focus should stay on the chosen Goal button.');
        assert.equal(await panel.evaluate((element) => element.isConnected && element === document.getElementById('goal-detail')), true);
        if (previousCard) assert.equal(await previousCard.evaluate((element) => element.isConnected), false, 'Switching Goals should replace the prior rich Goal card only.');
        const after = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
        const boundsAfter = await tile.boundingBox();
        const gridAfter = await page.locator('.goal-grid').evaluate((element) => ({ top: element.scrollTop, left: element.scrollLeft, height: element.clientHeight, contentHeight: element.scrollHeight }));
        const diagnostic = JSON.stringify({ viewport, reducedMotion, heroId: hero.id, goalId: goal.id, action, boundsBefore, boundsAfter, documentBefore: before, documentAfter: after, gridBefore, gridAfter });
        assert.ok(Math.abs(after.x - before.x) <= 1 && Math.abs(after.y - before.y) <= 1, 'Goal choice must not jump the document viewport. ' + diagnostic);
        if (viewport.width > 1100) assert.ok(boundsBefore && boundsAfter && Math.abs(boundsAfter.y - boundsBefore.y) <= 4, 'The selected Goal button should remain in its viewport position apart from a small hover effect. ' + diagnostic);
        if (viewport.width < 600) {
          const detailBounds = await page.locator('#goal-detail').boundingBox();
          assert.ok(detailBounds && detailBounds.y >= 0 && detailBounds.y < viewport.height, 'The phone Goal strip should leave the selected panel beginning inside the viewport.');
        }
        assert.equal((await tile.locator('.goal-tile-open').textContent()).trim(), 'Viewing Goal');
        previousCard = await page.locator(`#goal-${goal.id}`).elementHandle();
        await originalTile.dispose();
      }
      const clear = page.locator('.goal-clear');
      await clear.scrollIntoViewIfNeeded();
      const beforeClear = await page.evaluate(() => window.scrollY);
      const selectedTile = await page.locator(`.goal-tile[data-goal-id="${hero.goals[0].id}"]`).elementHandle();
      await clear.click();
      assert.equal(await page.locator('.goal-card, .milestone').count(), 0);
      assert.equal(await panel.evaluate((element) => element.isConnected && element === document.getElementById('goal-detail')), true);
      assert.equal(await selectedTile.evaluate((element) => element.isConnected && element === document.activeElement), true, 'Clearing a Goal should return focus without replacing its button.');
      assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - beforeClear) <= 1, 'Clearing a Goal must not jump the document viewport.');
      if (reducedMotion) {
        assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
        await page.locator(`.goal-tile[data-goal-id="${hero.goals[0].id}"]`).press('Enter');
        const motion = await page.locator('#goal-detail, .goal-detail-content, .goal-card').evaluateAll((elements) => elements.map((element) => {
          const style = getComputedStyle(element);
          return { name: style.animationName, duration: style.animationDuration, transition: style.transitionDuration };
        }));
        assert.ok(motion.every(({ name, duration, transition }) => (name === 'none' || duration.split(',').every((part) => Number.parseFloat(part) <= 0.01)) && transition.split(',').every((part) => Number.parseFloat(part) <= 0.01)), 'Reduced motion should suppress the detail fade.');
      }
      await selectedTile.dispose();
      if (previousCard) await previousCard.dispose();
      await panel.dispose();
      await current.clean();
    }
    const scrollRecord = structuredClone(record), scrollHero = scrollRecord.heroes[0];
    const additionalGoals = Array.from({ length: Math.max(10 - scrollHero.goals.length, 2) }, (_, index) => ({
      id: `dashboard-qa-scroll-goal-${index + 1}`, title: `Navigation Goal ${index + 1}`,
      milestones: Array.from({ length: index === 0 ? 12 : 1 }, (_, milestoneIndex) => ({
        id: `dashboard-qa-scroll-step-${index + 1}-${milestoneIndex + 1}`, title: `Navigation milestone ${milestoneIndex + 1}`, status: 'ready',
      })),
    }));
    scrollHero.goals.push(...additionalGoals);
    const current = await session(undefined, await fixture('bounded-goal-navigation', scrollRecord)), { page } = current;
    await selectHero(page, scrollHero);
    const grid = page.locator('.goal-grid');
    await grid.scrollIntoViewIfNeeded();
    const originalGrid = await grid.elementHandle();
    const metrics = await grid.evaluate((element) => ({ height: element.clientHeight, contentHeight: element.scrollHeight, maxHeight: Number.parseFloat(getComputedStyle(element).maxHeight), overflow: getComputedStyle(element).overflowY }));
    assert.equal(metrics.overflow, 'auto');
    assert.ok(Number.isFinite(metrics.maxHeight) && metrics.height <= metrics.maxHeight + 1 && metrics.height >= 550 && metrics.height <= 650, 'The taller desktop Goal list should remain bounded around 600 pixels at this viewport.');
    assert.ok(metrics.contentHeight > metrics.height + 1, 'Ten Goals should require independent list scrolling.');
    for (const original of scrollHero.goals) {
      const tile = page.locator(`.goal-tile[data-goal-id="${original.id}"]`), title = tile.locator('.goal-tile-title');
      assert.equal(await title.textContent(), original.title);
      const titleSize = await title.evaluate((element) => ({ height: element.clientHeight, fullHeight: element.scrollHeight, width: element.clientWidth, fullWidth: element.scrollWidth }));
      assert.ok(titleSize.fullHeight <= titleSize.height + 1 && titleSize.fullWidth <= titleSize.width + 1, 'Compact Goal buttons must show their whole title without clipping.');
      if (additionalGoals.includes(original)) assert.ok((await tile.boundingBox()).height <= 125, 'Short-title Goal choices should fit in roughly 100-pixel compact buttons.');
    }
    const documentBeforeWheel = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    await grid.hover();
    await page.mouse.wheel(0, 1000);
    await page.waitForFunction((element) => element.scrollTop > 1 && element.scrollTop >= element.scrollHeight - element.clientHeight - 1, originalGrid);
    const documentAfterWheel = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    assert.ok(Math.abs(documentAfterWheel.x - documentBeforeWheel.x) <= 1 && Math.abs(documentAfterWheel.y - documentBeforeWheel.y) <= 1, 'Wheel browsing should scroll only the Goal list.');
    const goal = scrollHero.goals.at(-1), tile = page.locator(`.goal-tile[data-goal-id="${goal.id}"]`);
    const tileBounds = await tile.boundingBox(), gridBounds = await grid.boundingBox();
    assert.ok(tileBounds && gridBounds && tileBounds.y >= gridBounds.y && tileBounds.y + tileBounds.height <= gridBounds.y + gridBounds.height + 1, 'Internal scrolling should reveal the last Goal button.');
    const originalTile = await tile.elementHandle();
    const scrollBeforeChoice = await grid.evaluate((element) => ({ top: element.scrollTop, left: element.scrollLeft }));
    const documentBeforeChoice = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    await selectGoal(page, scrollHero, goal);
    assert.equal(await originalGrid.evaluate((element) => element.isConnected && element === document.querySelector('.goal-grid')), true);
    assert.equal(await originalTile.evaluate((element) => element.isConnected && element === document.activeElement), true, 'Choosing a newly revealed Goal should retain its button and focus.');
    assert.deepEqual(await grid.evaluate((element) => ({ top: element.scrollTop, left: element.scrollLeft })), scrollBeforeChoice);
    const documentAfterChoice = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    assert.ok(Math.abs(documentAfterChoice.x - documentBeforeChoice.x) <= 1 && Math.abs(documentAfterChoice.y - documentBeforeChoice.y) <= 1, 'Choosing a scrolled Goal should not move the document.');
    await page.locator('#search').fill(scrollHero.title);
    assert.deepEqual(await grid.evaluate((element) => ({ top: element.scrollTop, left: element.scrollLeft })), scrollBeforeChoice, 'Filtering the same Hero should preserve its Goal-list offset.');
    await page.locator('#reset').click();
    assert.deepEqual(await grid.evaluate((element) => ({ top: element.scrollTop, left: element.scrollLeft })), scrollBeforeChoice, 'Resetting the same Hero should preserve its Goal-list offset.');
    await selectedGoal(page, scrollHero, goal);
    for (const nextGoal of [additionalGoals[0], additionalGoals.at(-1), additionalGoals[0]]) {
      const choice = page.locator(`.goal-tile[data-goal-id="${nextGoal.id}"]`);
      await choice.scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
      await selectGoal(page, scrollHero, nextGoal);
      const after = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
      assert.ok(Math.abs(after.x - before.x) <= 1 && Math.abs(after.y - before.y) <= 1, 'Switching between long and short Goal details must keep the document viewport stable.');
      assert.equal(await choice.evaluate((element) => element === document.activeElement), true);
    }
    await page.locator('.goal-clear').scrollIntoViewIfNeeded();
    const beforeClear = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    await page.locator('.goal-clear').click();
    const afterClear = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    assert.ok(Math.abs(afterClear.x - beforeClear.x) <= 1 && Math.abs(afterClear.y - beforeClear.y) <= 1, 'Clearing a long Goal detail must not move the document.');
    assert.equal(await page.locator('.goal-card, .milestone').count(), 0);
    assert.equal(await page.locator(`.goal-tile[data-goal-id="${additionalGoals[0].id}"]`).evaluate((element) => element === document.activeElement), true);
    await originalGrid.dispose();
    await originalTile.dispose();
    await current.clean();
  });

  await check('focus and dependency jumps select exactly their actual Hero and Goal and reveal hidden details', async () => {
    const current = await session(), { page } = current;
    const focus = [...rows.filter(({ milestone }) => milestone.status === 'blocked'), ...rows.filter(({ milestone }) => milestone.status === 'in_progress')].slice(0, 4);
    assert.deepEqual(await page.locator('#focus-list .focus-card').evaluateAll((cards) => cards.map((card) => card.dataset.milestoneId)), focus.map(({ milestone }) => milestone.id));
    if (focus.length) {
      const target = focus[0];
      await selectHero(page, target.hero);
      await selectGoal(page, target.hero, target.goal);
      await page.locator(`#toggle-${target.goal.id}`).click();
      await page.locator('.overview-return').click();
      await page.locator(`#focus-list .focus-card[data-milestone-id="${target.milestone.id}"]`).click();
      await selectedGoal(page, target.hero, target.goal);
      assert.equal(await page.locator(`#milestones-${target.goal.id}`).isVisible(), true);
      assert.equal(await page.locator(`#item-${target.milestone.id}`).evaluate((element) => element.open), true);
    }
    const dependent = rows.find(({ milestone, goal }) => milestone.dependsOn?.length && records.get(milestone.dependsOn[0]).goal.id !== goal.id);
    assert.ok(dependent, 'The project should demonstrate a dependency across Goals.');
    const target = records.get(dependent.milestone.dependsOn[0]);
    await selectHero(page, target.hero);
    await selectGoal(page, target.hero, target.goal);
    if (await page.locator(`#milestones-${target.goal.id}`).isVisible()) await page.locator(`#toggle-${target.goal.id}`).click();
    await selectHero(page, dependent.hero);
    await selectGoal(page, dependent.hero, dependent.goal);
    const source = page.locator(`#item-${dependent.milestone.id}`);
    if (!await source.evaluate((element) => element.open)) await source.locator(':scope > summary').click();
    await source.locator(`.dependency-button[data-milestone-id="${target.milestone.id}"]`).click();
    await selectedGoal(page, target.hero, target.goal);
    assert.equal(await page.locator(`#milestones-${target.goal.id}`).isVisible(), true);
    assert.equal(await page.locator(`#item-${target.milestone.id}`).evaluate((element) => element.open), true);
    assert.equal(await page.locator(`#item-${target.milestone.id} > summary`).evaluate((element) => element === document.activeElement), true);
    await current.clean();
  });

  await check('milestone headers and fields preserve literal source text, evidence paths and readable state colors', async () => {
    const value = structuredClone(record), maliciousTitle = '</script><script>window.__dashboardInjected=true</script><img src="x" onerror="window.__dashboardInjected=true">';
    const maliciousCriterion = '<img src="x" onerror="window.__dashboardInjected=true">Keep criterion text literal.';
    const maliciousDescription = '<img src="x" onerror="window.__dashboardInjected=true">Full description remains literal. ' + 'Review the evidence and source context before accepting this milestone. '.repeat(10);
    value.heroes[0].title = maliciousTitle;
    const goal = { id: 'dashboard-qa-goal', title: 'Synthetic status goal', milestones: Object.keys(labels).map((status) => ({
      id: 'dashboard-qa-' + status.replaceAll('_', '-'), title: labels[status] + ' test milestone', status,
      ...(status === 'blocked' ? { description: 'Waiting for a verified dependency. ' + maliciousDescription } : {}),
      ...(status === 'done' ? { description: maliciousDescription, acceptance: [maliciousCriterion], evidence: [{ label: 'Authored fixture source', path: 'web/dashboard/test/browser.mjs' }] } : {}),
    })) };
    value.heroes[0].goals.push(goal);
    const current = await session(undefined, await fixture('states-and-text', value)), { page } = current;
    await selectHero(page, value.heroes[0]);
    assert.equal(await page.locator(`#hero-title-${value.heroes[0].id} img`).count(), 0);
    await selectGoal(page, value.heroes[0], goal);
    const colors = [];
    for (const [status, label] of Object.entries(labels)) {
      const row = page.locator(`#item-dashboard-qa-${status.replaceAll('_', '-')}`);
      assert.equal(await row.locator(':scope > summary > .status-badge').innerText(), label);
      const badgeColors = await row.locator(':scope > summary > .status-badge').evaluate((element) => ({ foreground: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
      assert.ok(textContrast(badgeColors.foreground, badgeColors.background) >= 4.5, `${status} badge text contrast is below 4.5:1.`);
      assert.equal(await row.getAttribute('data-status'), status);
      const stateColor = await page.locator(`#overview-counts .stat-${status} .status-dot`).evaluate((element) => getComputedStyle(element).color);
      const accents = await row.evaluate((element) => {
        const rail = getComputedStyle(element), header = getComputedStyle(element.querySelector(':scope > summary'));
        return { railColor: rail.borderLeftColor, railWidth: Number.parseFloat(rail.borderLeftWidth), headerColor: header.borderTopColor, headerWidth: Number.parseFloat(header.borderTopWidth) };
      });
      assert.equal(accents.railColor, stateColor, `${status} rail must reflect the milestone's actual state.`);
      assert.equal(accents.headerColor, stateColor, `${status} header rule must reflect the milestone's actual state.`);
      assert.ok(accents.railWidth >= 5 && accents.headerWidth >= 2, 'State accents need a visible rail and header rule.');
      colors.push(accents.railColor);
      await milestoneHeader(page, goal.milestones.find((milestone) => milestone.status === status), false);
    }
    assert.equal(new Set(colors).size, 5);
    const blocked = goal.milestones.find((milestone) => milestone.status === 'blocked');
    await page.locator(`#item-${blocked.id} > summary`).click();
    await milestoneHeader(page, blocked, true);
    await page.locator(`#item-${blocked.id} > summary`).click();
    await page.locator('#status-filter').selectOption('done');
    await selectedGoal(page, value.heroes[0], goal);
    const row = page.locator('#item-dashboard-qa-done');
    await row.locator(':scope > summary').click();
    await milestoneHeader(page, goal.milestones.find((milestone) => milestone.status === 'done'), true);
    assert.notEqual((await renderedColors(row.locator('.field-acceptance'))).background, (await renderedColors(row.locator('.field-evidence'))).background);
    await readableText(row.locator('.field-heading h5, .criterion-copy, .evidence-content > span'));
    assert.equal(await row.locator('.criteria-list .criterion-copy').innerText(), maliciousCriterion);
    assert.equal(await row.locator('.criteria-list img, .criteria-list input[type="checkbox"]').count(), 0);
    assert.equal(await page.evaluate(() => Boolean(window.__dashboardInjected)), false);
    const evidence = row.locator('.evidence-link');
    assert.ok((await evidence.innerText()).includes('Authored fixture source'));
    assert.ok((await evidence.locator('.evidence-path').innerText()).includes('browser.mjs'));
    assert.ok((await evidence.getAttribute('title')).includes('web/dashboard/test/browser.mjs'));
    assert.ok((await evidence.getAttribute('href')).includes('web/dashboard/test/browser.mjs'));
    await current.clean();
  });

  await check('reload opens the overview from a regenerated snapshot with fresh source values', async () => {
    const file = await fixture('fresh-snapshot', record), current = await session(undefined, file), { page } = current;
    await selectHero(page, first.hero);
    const updated = structuredClone(record);
    updated.heroes[0].title = 'Regenerated sensor record';
    await writeFile(file, await renderStandalone(updated));
    await Promise.all([page.waitForEvent('load'), page.locator('#refresh').click()]);
    await page.locator('#dashboard').waitFor({ state: 'visible' });
    await overview(page, updated.heroes);
    assert.deepEqual(await page.evaluate(() => window.NonVerbaDashboardRecord), updated);
    assert.equal(await page.locator(`.hero-tile[data-hero-id="${updated.heroes[0].id}"] .hero-tile-title`).textContent(), updated.heroes[0].title);
    await current.clean();
  });

  await check('empty planning Heroes and Goals remain selectable and show an honest empty focus state', async () => {
    for (const emptyGoal of [false, true]) {
      const hero = { ...structuredClone(heroes[0]), goals: emptyGoal ? [{ id: 'dashboard-qa-empty-goal', title: 'Planning goal', milestones: [] }] : [] };
      const value = { manifest: { ...manifest, heroes: [manifest.heroes[0]] }, heroes: [hero] };
      const current = await session(undefined, await fixture(emptyGoal ? 'empty-goal' : 'empty-hero', value)), { page } = current;
      await overview(page, [hero]);
      await recordedRollupLabel(page.locator(`.hero-tile[data-hero-id="${hero.id}"] .hero-tile-status`), []);
      for (const state of ['total', 'done', 'in_progress', 'blocked', 'ready', 'proposed']) assert.equal(await page.locator(`#overview-counts .stat-${state} .stat-value`).textContent(), '0');
      assert.equal(await page.locator('#focus-list .focus-card').count(), 0);
      assert.ok((await page.locator('#focus-list').innerText()).trim().length > 0);
      await progressMatches(page.locator('#project-progress .project-progress-meter'), 0, 0);
      await selectHero(page, hero);
      if (emptyGoal) {
        await selectGoal(page, hero, hero.goals[0]);
        assert.equal(await page.locator('.milestone').count(), 0);
        assert.ok((await page.locator('#milestones-dashboard-qa-empty-goal').innerText()).trim().length > 0);
      }
      await current.clean();
    }
  });

  await check('the project, Hero choices, selected Goal and expanded milestone fit a phone viewport', async () => {
    const current = await session({ width: 390, height: 844 }), { page } = current;
    await overview(page);
    await noOverflow(page);
    await capture(page, 'mobile-390x844');
    await selectHero(page, first.hero);
    await noOverflow(page);
    await capture(page, 'mobile-detail-390x844');
    await selectGoal(page, first.hero, first.goal);
    await noOverflow(page);
    await capture(page, 'goal-detail-390x844');
    await expandedMilestoneCapture(page, first.milestone, 'milestone-expanded-390x844');
    await incidentCapture(page, '390x844');
    await identityCapture(page, '390x844');
    await page.locator('#expand-all').click();
    await noOverflow(page);
    await current.clean();
  });
} finally {
  if (browser) await browser.close();
  for (const file of disposableFiles) await unlink(file);
  await rmdir(isolatedDirectory);
}
