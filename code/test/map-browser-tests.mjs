// SPDX-License-Identifier: AGPL-3.0-only
// Real Chromium against the map source entry. Tiles are tiny synthetic PNGs;
// these checks never contact a provider or acquire physical sensor positions.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';

if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Run map browser checks inside non-verba-dev.');
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/src');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const tileRequests = [], held = [];
const mime = {html: 'text/html', js: 'application/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png'};
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    if (/^\/qa-(?:tiles|held)\/\d+\/\d+\/\d+\.png$/.test(path)) {
      tileRequests.push({path, headers: request.headers});
      const send = () => { if (!response.destroyed) response.writeHead(200, {'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600'}).end(png); };
      if (path.startsWith('/qa-held/')) held.push(send); else send();
      return;
    }
    if (!/^\/[a-zA-Z0-9_-]+\.(html|js|css|json|svg|png)$/.test(path)) { response.writeHead(404).end(); return; }
    const body = await readFile(resolve(root, '.' + path));
    // Match the existing preview server's default. Only the explicit OSM image
    // source may choose a Referer policy that identifies the browser preview.
    response.writeHead(200, {'Content-Type': mime[path.split('.').at(-1)], 'Cache-Control': 'no-cache', 'Referrer-Policy': 'no-referrer'}).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(ready => server.listen(0, '127.0.0.1', ready));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const checks = [], errors = [];
async function capture(page, name) {
  if (!process.env.NONVERBA_MAP_SCREENSHOT_DIR) return;
  const directory = resolve(process.env.NONVERBA_MAP_SCREENSHOT_DIR);
  await mkdir(directory, {recursive: true});
  await page.screenshot({path: join(directory, name + '.png'), fullPage: true});
}
const check = async (name, body) => { await body(); checks.push(name); console.log('PASS ' + name); };
const settle = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
const eventually = async (condition, description) => {
  const deadline = Date.now() + 10_000;
  while (!condition()) { if (Date.now() >= deadline) throw new Error(description); await new Promise(done => setTimeout(done, 20)); }
};
async function instrument(context) {
  await context.addInitScript(() => {
    window.__mapQa = {sensors: 0, violations: []};
    document.addEventListener('securitypolicyviolation', event => window.__mapQa.violations.push({directive: event.violatedDirective, blocked: event.blockedURI}));
    for (const name of ['getCurrentPosition', 'watchPosition']) if (navigator.geolocation) {
      Object.defineProperty(navigator.geolocation, name, {value: () => { window.__mapQa.sensors++; throw new Error('Map view acquired a sensor'); }});
    }
    if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: () => { window.__mapQa.sensors++; throw new Error('Map view acquired media'); },
    });
  });
}
async function load(page) {
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(base + '/map.html');
  await page.waitForFunction(() => document.getElementById('map-canvas')?.width > 1 && document.getElementById('map-status')?.textContent.trim());
  await settle(page);
}
try {
  browser = await chromium.launch({headless: true, ...(process.env.NONVERBA_BROWSER_EXECUTABLE ? {executablePath: process.env.NONVERBA_BROWSER_EXECUTABLE} : {})});
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  await instrument(context);
  const osmRequests = [];
  await context.route('https://tile.openstreetmap.org/**', async route => {
    osmRequests.push({url: route.request().url(), headers: await route.request().allHeaders()});
    await route.fulfill({status: 200, contentType: 'image/png', headers: {'Cache-Control': 'public, max-age=3600'}, body: png});
  });
  const page = await context.newPage(), requests = [];
  page.on('request', request => requests.push(request.url()));
  const $ = id => page.locator('#' + id);
  await load(page);

  await check('Norway outline opens locally with no provider request or sensor acquisition', async () => {
    assert.equal(await $('map-role').inputValue(), 'requester');
    assert.equal(await $('map-country-no').isChecked(), true);
    assert.equal(await $('map-country-no').isDisabled(), true);
    assert.equal(await $('map-osm').isChecked(), false);
    assert.ok(requests.some(url => url.endsWith('/map-country-data.js')));
    assert.equal(requests.some(url => /\.wasm(?:$|\?)/.test(url)), false, 'The reusable map must not boot the evidence runtime');
    assert.deepEqual(requests.filter(url => new URL(url).origin !== base), []);
    assert.equal(await page.evaluate(() => window.__mapQa.sensors), 0);
    const drawing = await $('map-canvas').evaluate(canvas => {
      const values = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let changed = 0; for (let offset = 0; offset < values.length; offset += 4) if (values[offset] !== 232 || values[offset + 1] !== 234 || values[offset + 2] !== 226) changed++;
      return changed;
    });
    assert.ok(drawing > 100, 'The initial country path did not paint');
  });

  await check('sample overlays are explicitly synthetic and enabled-country revocation clears their list', async () => {
    await $('map-demo').click(); await settle(page);
    assert.match(await $('map-positions').innerText(), /synthetic|sample|demo/i);
    assert.match(await $('map-positions').innerText(), /accuracy|\bm\b|metre/i);
    await capture(page, 'desktop');
    assert.equal(await $('map-route-note').isVisible(), true);
    await $('map-role').selectOption('operator'); await $('map-country-no').uncheck(); await settle(page);
    assert.match(await $('map-status').innerText(), /no supported countries enabled/i);
    assert.equal(await $('map-positions').innerText(), 'No positions supplied.');
    assert.equal(await $('map-route-note').isVisible(), false);
    await $('map-country-no').check(); await settle(page);
    assert.doesNotMatch(await $('map-status').innerText(), /no supported countries enabled/i);
    await $('map-demo').click(); await settle(page);
    assert.match(await $('map-positions').innerText(), /synthetic|sample|demo/i);
    await $('map-country-no').uncheck(); await $('map-role').selectOption('requester'); await settle(page);
    assert.equal(await $('map-country-no').isChecked(), false);
    assert.equal(await $('map-country-no').isDisabled(), true);
    assert.doesNotMatch(await $('map-status').innerText(), /no supported countries enabled/i,
      'Requesters must retain all active deployments independently of operator grants');
  });

  await check('zoom, pointer pan and keyboard navigation remain usable without a tile provider', async () => {
    await $('map-fit').click(); await settle(page);
    const before = await $('map-canvas').evaluate(canvas => canvas.toDataURL());
    await $('map-zoom-in').click(); await settle(page);
    const zoomed = await $('map-canvas').evaluate(canvas => canvas.toDataURL()); assert.notEqual(zoomed, before);
    const bounds = await $('map-canvas').boundingBox(); assert.ok(bounds);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 90, bounds.y + bounds.height / 2 + 40, {steps: 4}); await page.mouse.up();
    await settle(page);
    assert.notEqual(await $('map-canvas').evaluate(canvas => canvas.toDataURL()), zoomed);
    await $('map-canvas').focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('-'); await page.keyboard.press('Home'); await settle(page);
    assert.equal(await $('map-canvas').evaluate(canvas => canvas.toDataURL()), before);
    assert.equal(await $('map-canvas').evaluate(canvas => canvas.classList.contains('map-dragging')), false);
    assert.deepEqual(requests.filter(url => new URL(url).origin !== base), []);
  });

  await check('OSM preview requires an explicit click, requests only intersecting tiles and shows provider attribution', async () => {
    await $('map-osm').check();
    await eventually(() => osmRequests.length > 0, 'Enabling the preview did not request a tile');
    await page.waitForFunction(() => document.getElementById('map-status').textContent.includes('streets and shared overlays'));
    assert.match(await $('map-attribution').innerText(), /OpenStreetMap/);
    assert.equal(await $('map-attribution').getAttribute('href'), 'https://www.openstreetmap.org/copyright');
    for (const request of osmRequests) {
      const url = new URL(request.url);
      assert.equal(url.origin, 'https://tile.openstreetmap.org');
      assert.match(url.pathname, /^\/\d+\/\d+\/\d+\.png$/); assert.equal(url.search, ''); assert.equal(url.hash, '');
      assert.equal(request.headers.referer, base + '/', 'The browser preview must preserve an identifying Referer');
    }
    assert.equal(await page.evaluate(async urls => {
      const {INITIAL_MAP_CATALOG} = await import('./map-policy.js');
      const {tileIntersectsGeometry} = await import('./map-geometry.js');
      return urls.every(url => {
        const [z, x, y] = new URL(url).pathname.slice(1).replace('.png', '').split('/').map(Number);
        return INITIAL_MAP_CATALOG.some(country => country.active && tileIntersectsGeometry({x, y, z}, country.geometry));
      });
    }, osmRequests.map(request => request.url)), true);
    assert.deepEqual(requests.filter(url => new URL(url).origin !== base && new URL(url).origin !== 'https://tile.openstreetmap.org'), []);
    await $('map-osm').uncheck(); await settle(page);
    const afterDisable = osmRequests.length;
    await $('map-zoom-in').click(); await $('map-zoom-out').click(); await $('map-fit').click(); await settle(page);
    assert.equal(osmRequests.length, afterDisable);
  });

  await check('mobile layout remains bounded and strict page CSP has no violations', async () => {
    await page.setViewportSize({width: 390, height: 844}); await settle(page);
    await $('map-demo').click(); await settle(page); await capture(page, 'mobile');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.ok((await $('map-canvas').boundingBox()).width <= 390);
    assert.equal(await page.evaluate(() => window.__mapQa.sensors), 0);
    assert.deepEqual(await page.evaluate(() => window.__mapQa.violations), []);
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    assert.match(csp, /script-src\s+'self'/); assert.doesNotMatch(csp.match(/script-src[^;]*/)?.[0] ?? '', /unsafe-inline|unsafe-eval/);
  });
  await context.close();

  // This context deliberately has no Playwright routes: Chromium's actual HTTP
  // cache is exercised against the local fixture server's Cache-Control header.
  const cacheContext = await browser.newContext({viewport: {width: 1280, height: 900}});
  await instrument(cacheContext);
  const cachePage = await cacheContext.newPage(); await load(cachePage);
  await cachePage.evaluate(async () => {
    const {MapController} = await import('./map-controller.js'), {createMapView} = await import('./map-view.js');
    const {createSameOriginTileSource} = await import('./map-tiles.js');
    const original = document.getElementById('map-canvas'), canvas = original.cloneNode(false); original.replaceWith(canvas);
    const controller = new MapController({role: 'requester'}), statuses = [];
    const source = createSameOriginTileSource({baseUrl: '/qa-tiles/', origin: location.origin, attribution: 'Synthetic fixture tiles'});
    const view = createMapView({canvas, controller, onStatus: value => statuses.push(value)});
    window.__mapFixture = {controller, view, source, statuses}; controller.setTileSource(source);
  });

  await check('curated tile URLs reuse memory and HTTP cache without cache-busting', async () => {
    await cachePage.waitForFunction(() => window.__mapFixture.statuses.at(-1)?.state === 'ready' && window.__mapFixture.statuses.at(-1)?.loaded > 0);
    const first = tileRequests.filter(request => request.path.startsWith('/qa-tiles/')).length; assert.ok(first > 0);
    await cachePage.evaluate(() => { const f = window.__mapFixture; f.view.fit(); f.controller.refresh(); }); await settle(cachePage);
    assert.equal(tileRequests.filter(request => request.path.startsWith('/qa-tiles/')).length, first);
    await cachePage.evaluate(() => window.__mapFixture.controller.setTileSource(null)); await settle(cachePage);
    await cachePage.evaluate(() => { const f = window.__mapFixture; f.controller.setTileSource(f.source); });
    await cachePage.waitForFunction(() => window.__mapFixture.statuses.at(-1)?.state === 'ready' && window.__mapFixture.statuses.at(-1)?.loaded > 0);
    assert.equal(tileRequests.filter(request => request.path.startsWith('/qa-tiles/')).length, first,
      'Epoch changes must still respect fresh HTTP cache entries');
  });

  await check('country rendering unions overlapping polygons with mixed winding and preserves a true uncovered hole', async () => {
    await cachePage.evaluate(async () => {
      const {MapController} = await import('./map-controller.js'), {createMapView} = await import('./map-view.js');
      const {createSameOriginTileSource} = await import('./map-tiles.js');
      const ring = (west, south, east, north) => [[west, south], [east, south], [east, north], [west, north], [west, south]];
      const geometry = {type: 'MultiPolygon', coordinates: [
        [ring(0, 0, 4, 4), ring(1, 1, 1.5, 1.5)], [ring(2, 0, 6, 4).reverse()],
      ]};
      const controller = new MapController({role: 'requester', catalog: [{code: 'NO', name: 'Synthetic overlapping coverage', active: true, draw_boundary: false, geometry}]});
      const original = document.getElementById('map-canvas'), canvas = original.cloneNode(false);
      canvas.id = 'map-union-fixture'; original.parentElement.append(canvas);
      const statuses = [], view = createMapView({canvas, controller, onStatus: value => statuses.push(value)});
      controller.setTileSource(createSameOriginTileSource({baseUrl: '/qa-tiles/', origin: location.origin, attribution: 'Synthetic fixture tiles'}));
      if (!view.focus({latitude: 2, longitude: 3}, 6)) throw new Error('Could not focus synthetic overlap');
      window.__mapUnionFixture = {canvas, controller, view, statuses};
    });
    await cachePage.waitForFunction(() => window.__mapUnionFixture.statuses.at(-1)?.state === 'ready' && window.__mapUnionFixture.statuses.at(-1)?.loaded > 0);
    const pixels = await cachePage.evaluate(async () => {
      const {project} = await import('./map-geometry.js'), f = window.__mapUnionFixture;
      const center = project({latitude: 2, longitude: 3}, 6), bounds = f.canvas.getBoundingClientRect();
      const ratio = f.canvas.width / bounds.width;
      const read = point => {
        const projected = project(point, 6);
        const x = Math.floor((projected.x - center.x + bounds.width / 2) * ratio);
        const y = Math.floor((projected.y - center.y + bounds.height / 2) * ratio);
        if (x < 0 || y < 0 || x >= f.canvas.width || y >= f.canvas.height) throw new Error('Synthetic pixel sample lies outside the canvas');
        return Array.from(f.canvas.getContext('2d').getImageData(x, y, 1, 1).data).slice(0, 3);
      };
      return {overlap: read({latitude: 2, longitude: 3}), hole: read({latitude: 1.2, longitude: 1.2}), outside: read({latitude: -2, longitude: 3})};
    });
    assert.notDeepEqual(pixels.overlap, [232, 234, 226], 'Overlapping supported polygons must paint their union');
    assert.deepEqual(pixels.hole, [232, 234, 226], 'A true uncovered hole must retain the map background');
    assert.deepEqual(pixels.outside, [232, 234, 226], 'Unsupported space must retain the map background');
    await cachePage.evaluate(() => { const f = window.__mapUnionFixture; f.view.destroy(); f.canvas.remove(); delete window.__mapUnionFixture; });
  });

  await check('disabled sources and destroyed views fence held tile results and queued downloads', async () => {
    await cachePage.evaluate(async () => {
      const {createSameOriginTileSource} = await import('./map-tiles.js');
      const f = window.__mapFixture;
      f.controller.setTileSource(createSameOriginTileSource({baseUrl: '/qa-held/', origin: location.origin, attribution: 'Held synthetic fixture tiles'}));
    });
    await eventually(() => held.length > 0, 'A held fixture tile was not requested');
    await cachePage.evaluate(() => window.__mapFixture.controller.setTileSource(null)); await settle(cachePage);
    const count = tileRequests.filter(request => request.path.startsWith('/qa-held/')).length;
    for (const release of held.splice(0)) release(); await settle(cachePage);
    await cachePage.evaluate(() => { const f = window.__mapFixture; f.view.zoomIn(); f.controller.refresh(); }); await settle(cachePage);
    assert.equal(tileRequests.filter(request => request.path.startsWith('/qa-held/')).length, count);
    assert.equal(await cachePage.evaluate(() => window.__mapFixture.statuses.at(-1).state), 'outline');
    await cachePage.evaluate(async () => {
      const {createSameOriginTileSource} = await import('./map-tiles.js'); const f = window.__mapFixture;
      f.controller.setTileSource(createSameOriginTileSource({baseUrl: '/qa-held/', origin: location.origin, attribution: 'Held synthetic fixture tiles'}));
    });
    await eventually(() => held.length > 0, 'The second held fixture tile was not requested');
    await cachePage.evaluate(() => { const f = window.__mapFixture; f.view.destroy(); f.view.destroy(); window.__mapFixture.closedStatusCount = f.statuses.length; });
    await settle(cachePage);
    const destroyedCount = tileRequests.filter(request => request.path.startsWith('/qa-held/')).length;
    for (const release of held.splice(0)) release(); await settle(cachePage);
    await cachePage.evaluate(() => { const f = window.__mapFixture; f.view.zoomIn(); f.view.fit(); f.controller.setAccess({role: 'operator', enabledCountries: []}); }); await settle(cachePage);
    assert.equal(tileRequests.filter(request => request.path.startsWith('/qa-held/')).length, destroyedCount);
    assert.equal(await cachePage.evaluate(() => window.__mapFixture.statuses.length === window.__mapFixture.closedStatusCount), true);
    assert.deepEqual(await cachePage.evaluate(() => window.__mapQa.violations), []);
  });
  await cacheContext.close(); assert.deepEqual(errors, []);
  console.log(JSON.stringify({passed: true, checks: checks.length, tiles: 'synthetic PNGs', physical_sensors_used: false, provider_network_used: false}));
} finally {
  for (const release of held.splice(0)) release();
  await browser?.close(); await new Promise(done => server.close(done));
}
