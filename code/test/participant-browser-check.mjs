// SPDX-License-Identifier: AGPL-3.0-only
// Exact participant assets in Chromium, with intercepted bundled requests only.
// This checks the shell, not Android WebView or participant service acceptance.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {collectParticipantAssets} from '../tools/participant-assets.mjs';

assert.equal(process.platform, 'linux', 'Run only in the managed Debian container.');
assert.equal(process.env.NONVERBA_CONTAINER, '1', 'Use the managed container launcher.');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/nonverba-tools/browser-tests/browsers';
const {chromium} = await import(pathToFileURL(resolve(process.env.NONVERBA_PLAYWRIGHT_PATH ||
  '/opt/nonverba-tools/browser-tests/node_modules/playwright', 'index.mjs')).href);
const assets = await collectParticipantAssets();
const origin = 'https://appassets.androidplatform.net';
const errors = [], unexpected = [];
const output = resolve('artifacts/qa/participant-browser-' + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, {recursive:true});
const browser = await chromium.launch({headless:true, args:['--no-sandbox']});
try {
  const context = await browser.newContext({viewport:{width:390, height:844}, reducedMotion:'reduce'});
  await context.route('**/*', async route => {
    const url = new URL(route.request().url()), key = url.pathname.replace(/^\/assets\//, '');
    if (url.origin !== origin || url.search || url.hash || !key.startsWith('participant/') || !assets.has(key)) {
      unexpected.push(url.href); await route.abort(); return;
    }
    const type = key.endsWith('.html') ? 'text/html' : key.endsWith('.css') ? 'text/css' :
      key.endsWith('.js') ? 'text/javascript' : 'image/svg+xml';
    await route.fulfill({body:assets.get(key), contentType:type, headers:{'Cache-Control':'no-store'}});
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/assets/participant/index.html');
  await page.locator('#requester-choice[aria-pressed="true"]').waitFor();
  assert.equal(await page.locator('.brand img').evaluate(image => image.complete && image.naturalWidth > 0), true);
  await page.locator('#operator-choice').click();
  assert.equal(await page.locator('#operator-choice').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#requester-choice').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#role-detail-title').textContent(), 'Know what you are agreeing to.');
  await page.locator('#requester-choice').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#requester-choice').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#role-detail-title').textContent(), 'Make the work clear.');
  assert.match(await page.locator('#preview-title').locator('..').textContent(), /not available in this preview/);
  assert.equal(await page.evaluate(() => ['NativeVault','NativeLocation','NativeCamera','NativeAudio'].some(key => key in window)), false);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  await page.screenshot({path:output + '/phone.png', fullPage:true});
  for (const width of [320, 390, 900, 1280]) {
    await page.setViewportSize({width, height:900});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Horizontal overflow at ' + width);
    const box = await page.locator('#operator-choice').boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, 'Role target must remain usable.');
  }
  await page.screenshot({path:output + '/desktop.png', fullPage:true});
  await page.locator('#operator-choice').click();
  await page.reload();
  assert.equal(await page.locator('#requester-choice').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#operator-choice').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  await context.close();
  const result = {passed:true, scope:'Bundled participant-shell browser checks only', checks:[
    'original brand mark loads', 'mouse and keyboard role choice', 'explicit unavailable service notice',
    'no injected native bridge or persisted role', '320/390/900/1280 width layout', 'reload resets preview choice',
    'no unexpected resource requests or JavaScript errors'], screenshots:output,
    android_device_tested:false, services_connected:false};
  await writeFile(output + '/result.json', JSON.stringify(result, null, 2) + '\n', {flag:'wx'});
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
