// SPDX-License-Identifier: AGPL-3.0-only
// Exact attributed IGS navigation text -> production worker -> real Rust/WASM.
// This tests navigation import, not a phone receiver or satellite authentication.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.NONVERBA_PLAYWRIGHT_PATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'artifacts/qa');
const fixturePath = 'crates/nonverba-core/src/location_proof/position/importer/igs-2026270-excerpt.rnx';
const sourceId = 'IGS/BKG 2026 day270 exact-line excerpt; see position/importer/README.md';
const expectedSourceSha256 = '626044960321d5730074f257283b208a8ce8248f138d8084cf32d87d569344e8';
const sha256 = text => createHash('sha256').update(text).digest('hex');
const rinex = await readFile(resolve(root, fixturePath), 'utf8');
assert.equal(sha256(rinex), expectedSourceSha256, 'attributed fixture exact byte pin');
const start = 1790467200, end = 1790467230; // 2026-09-27 00:00:00..00:00:30 UTC
const crlf = rinex.replaceAll('\n', '\r\n');
const version4 = '     4.02' + rinex.slice(9);
await mkdir(out, {recursive: true});

let browser;
for (const channel of ['msedge', 'chrome', undefined]) {
  try { browser = await chromium.launch({headless: true, ...(channel ? {channel} : {})}); break; }
  catch (error) { if (!channel) throw error; }
}
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${process.env.NONVERBA_TEST_URL || 'http://127.0.0.1:4174'}/location.html`);
  const result = await page.evaluate(async input => {
    const {createCoreClient} = await import('./core-client.js');
    const core = createCoreClient();
    let timer;
    try {
      return await Promise.race([(async () => {
        const invoke = (text, pin, begin = input.start, end = input.end) =>
          core.json('import_gps_lnav_rinex', text, input.sourceId, pin, begin, end, 18);
        const caught = async operation => {
          try { return {rejected: false, value: await operation()}; }
          catch (error) { return {rejected: true, message: String(error)}; }
        };
        const imported = await invoke(input.rinex, input.pin);
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(imported.navigation_json));
        const browserNavigationSha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
        return {
          imported, browserNavigationSha256,
          wrongSource: await caught(() => invoke(input.rinex, '0'.repeat(64))),
          changedBytes: await caught(() => invoke(input.crlf, input.pin)),
          crlf: await invoke(input.crlf, input.crlfPin),
          unsupportedVersion: await caught(() => invoke(input.version4, input.version4Pin)),
          invalidWindow: await caught(() => invoke(input.rinex, input.pin, input.end, input.start)),
          outsideWindow: await caught(() => invoke(input.rinex, input.pin, input.start + 86400, input.end + 86400)),
        };
      })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('RINEX WASM integration exceeded 60 seconds')), 60000); })]);
    } finally { clearTimeout(timer); }
  }, {rinex, pin: expectedSourceSha256, sourceId, start, end, crlf, crlfPin: sha256(crlf), version4, version4Pin: sha256(version4)});

  const navigation = JSON.parse(result.imported.navigation_json);
  const report = result.imported.import_report;
  assert.equal(navigation.type, 'nonverba-gps-lnav');
  assert.equal(navigation.source.id, sourceId);
  assert.equal(navigation.source.sha256, expectedSourceSha256);
  assert.equal(report.source_sha256, expectedSourceSha256);
  assert.equal(report.source_bytes, Buffer.byteLength(rinex));
  assert.equal(report.window_start_unix_secs, start);
  assert.equal(report.window_end_unix_secs, end);
  assert.equal(report.gps_utc_offset_s, 18);
  assert.equal(report.records_read, 38);
  assert.equal(report.gps_records_read, 32);
  assert.ok(navigation.ephemerides.length >= 6 && navigation.ephemerides.length <= 128);
  assert.equal(report.selected_ephemerides, navigation.ephemerides.length);
  assert.equal(result.imported.navigation_sha256, result.browserNavigationSha256);
  assert.equal(result.imported.navigation_sha256, sha256(result.imported.navigation_json));
  const gps1 = navigation.ephemerides.find(ephemeris => ephemeris.svid === 1);
  assert.equal(gps1.gps_week, 2438);
  assert.equal(gps1.transmission_tow_s, 604728);
  assert.equal(gps1.ura_m, 2);
  assert.equal(gps1.omega0_rad, -0.622302759076);
  assert.equal(report.navigation_source_authenticated, false);
  assert.equal(report.satellite_authentication_verified, false);
  for (const name of ['wrongSource', 'changedBytes', 'unsupportedVersion', 'invalidWindow', 'outsideWindow']) {
    assert.equal(result[name].rejected, true, `${name}: ${JSON.stringify(result[name])}`);
  }
  assert.match(result.wrongSource.message, /source digest/);
  assert.match(result.changedBytes.message, /source digest/);
  assert.match(result.unsupportedVersion.message, /Only RINEX 3/);
  assert.match(result.invalidWindow.message, /capture window/);
  assert.equal(result.crlf.import_report.source_sha256, sha256(crlf));
  assert.equal(result.crlf.navigation_sha256, sha256(result.crlf.navigation_json));
  assert.notEqual(result.crlf.navigation_sha256, result.imported.navigation_sha256);
  assert.deepEqual(JSON.parse(result.crlf.navigation_json).ephemerides, navigation.ephemerides);
  assert.deepEqual(pageErrors, []);
  await writeFile(resolve(out, 'rinex-browser-results.json'), JSON.stringify({
    tests_passed: 7,
    wasm_mocked: false,
    public_navigation_excerpt: true,
    physical_device_tested: false,
    satellite_authentication_tested: false,
    fixture_path: fixturePath,
    fixture_sha256: expectedSourceSha256,
    independent_window_unix_secs: [start, end],
    result,
  }, null, 2));
  console.log('PASS seven real WASM RINEX import cases (attributed navigation excerpt; no physical sensor claim)');
} finally { await browser.close(); }
