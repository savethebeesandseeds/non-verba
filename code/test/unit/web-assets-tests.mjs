// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectWebAssets, loadWebAssetCatalog, assertAndroidWebAssets} from '../../tools/build/web-assets.mjs';

assert.equal(process.platform, 'linux', 'Run tests only inside non-verba-dev.');
assert.equal(process.env.NONVERBA_CONTAINER, '1', 'Run tests only inside non-verba-dev.');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nonverba-web-assets-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const sources = new Map([
    ['apps/non-verba-dev/src/camera/index.html', '<!-- <script src="./not-a-dependency.js"></script> -->\n<link href="../common/style.css"><script type="module" src="./app.js"></script><a data-browser-inspection hidden href="../../../../inspections/map/map.html"><span>Map</span></a><a href="#local">Local</a><a href="https://example.test">External</a>'],
    ['apps/non-verba-dev/src/common/style.css', '/* url(./not-a-dependency.png) */\nbody { color: black; content: "url(./ordinary-text.png)"; }'],
    ['apps/non-verba-dev/src/camera/app.js', `import {client} from '../../../../shared/runtime/client.js';
export {audio} from '../../../../shared/audio/capture.js';
export * from '../../../../shared/runtime/extra.js';
const lazy = () => import('../../../../shared/runtime/lazy.js');
const worker = new URL('../../../../shared/runtime/worker.js', import.meta.url);
const opaque = "import './ordinary-string.js'";
const sample = /import\\('regex-decoy.js'\\)/;
const template = \`new URL('../template-decoy.js', import.meta.url)\`;
const nested = \`outer \${true ? \`import '../nested-template-decoy.js'\` : ''}\`;
const interpolated = \`loaded \${import('../../../../shared/runtime/lazy.js')}\`;
// import '../comment-decoy.js';
/* new URL('../block-comment.js', import.meta.url) */
`],
    ['shared/runtime/client.js', 'export const client = true;'],
    ['shared/runtime/worker.js', "import init from './pkg/nonverba_core.js';"],
    ['shared/runtime/extra.js', 'export const extra = true;'],
    ['shared/runtime/lazy.js', 'export default true;'],
    ['shared/audio/capture.js', "export const audio = new URL('./worklet.js?version=1#processor', import.meta.url);"],
    ['shared/audio/worklet.js', 'globalThis.registerProcessor?.("audio", class {});'],
    ['inspections/map/map.html', '<link href="../../apps/non-verba-dev/src/common/style.css"><script src="./map-ui.js"></script><a href="../../apps/non-verba-dev/src/camera/index.html">Tools</a>'],
    ['inspections/map/map-ui.js', "import {geometry} from '../../shared/map/geometry.js'; import {face} from '../../shared/identity/face.js';"],
    ['shared/map/geometry.js', 'export const geometry = [];'],
    ['shared/identity/face.js', "export const face = new URL('./face-model/', import.meta.url);"],
  ]);
  const assets = [...sources].map(([source]) => ({source, output:source.split('/').at(-1)}));
  const catalog = {version:1, sourceRoots:['apps/non-verba-dev/src', 'shared', 'inspections'], assets,
    entries:{browser:['index.html', 'map.html'], android:['index.html']}};
  const put = async (relative, text) => {
    await mkdir(dirname(join(root, relative)), {recursive:true});
    await writeFile(join(root, relative), text);
  };
  for (const [source, text] of sources) await put(source, text);
  await put('assets.json', JSON.stringify(catalog));
  return {root, sources, catalog, put};
}

test('catalog builds complete flat closures and rewrites only actual local URL edges', async t => {
  const f = await fixture(t), browser = await collectWebAssets(f.root);
  assert.equal(browser.size, f.sources.size);
  const app = browser.get('app.js').toString();
  for (const output of ['client.js', 'capture.js', 'extra.js', 'lazy.js', 'worker.js'])
    assert.ok(app.includes("'./" + output + "'"), output);
  for (const decoy of ['ordinary-string.js', 'regex-decoy.js', 'template-decoy.js', 'nested-template-decoy.js', 'comment-decoy.js', 'block-comment.js'])
    assert.ok(app.includes(decoy), decoy);
  assert.ok(app.includes('"import \'./ordinary-string.js\'"'));
  assert.ok(browser.get('index.html').toString().includes('href="./map.html"'));
  assert.ok(browser.get('index.html').toString().includes('src="./app.js"'));
  assert.ok(browser.get('index.html').toString().includes('src="./not-a-dependency.js"'));
  assert.ok(browser.get('capture.js').toString().includes("'./worklet.js?version=1#processor'"));
  assert.ok(browser.get('worker.js').toString().includes("'./pkg/nonverba_core.js'"));
  assert.ok(browser.get('face.js').toString().includes("'./face-model/'"));
});

test('Android strips marked inspection links and excludes their entire module/resource closure', async t => {
  const f = await fixture(t), android = await collectWebAssets(f.root, {target:'android'});
  for (const output of ['map.html', 'map-ui.js', 'geometry.js', 'face.js']) assert.equal(android.has(output), false, output);
  for (const output of ['index.html', 'app.js', 'worker.js', 'capture.js', 'worklet.js', 'lazy.js', 'style.css']) assert.ok(android.has(output), output);
  const html = android.get('index.html').toString();
  assert.ok(!html.includes('data-browser-inspection'));
  assert.ok(!html.includes('<span>Map</span>'));
  assert.ok(html.includes('href="#local"'));
  assert.ok(html.includes('href="https://example.test"'));
});

test('uncataloged source, missing source, missing dependency and unreachable registration fail closed', async t => {
  const f = await fixture(t);
  await f.put('shared/unknown.js', 'export default true;');
  await assert.rejects(collectWebAssets(f.root), /Unregistered web source files.*unknown.js/);
  await rm(join(f.root, 'shared/unknown.js'));
  await rm(join(f.root, 'shared/runtime/client.js'));
  await assert.rejects(collectWebAssets(f.root), /Missing cataloged web source files.*client.js/);
  await f.put('shared/runtime/client.js', "import '../missing.js';");
  await assert.rejects(collectWebAssets(f.root), /Unregistered asset dependency.*missing.js/);
  await f.put('shared/runtime/client.js', 'export default true;');
  f.catalog.assets.push({source:'shared/orphan.js', output:'orphan.js'});
  await f.put('shared/orphan.js', 'export default true;');
  await f.put('assets.json', JSON.stringify(f.catalog));
  await assert.rejects(collectWebAssets(f.root), /Unreachable cataloged web assets.*orphan.js/);
});

test('shared modules and developer runtime cannot depend on inspection applications', async t => {
  const f = await fixture(t);
  await f.put('shared/runtime/client.js', "import '../../inspections/map/map-ui.js';");
  await assert.rejects(collectWebAssets(f.root), /Shared web module depends on an application or inspection/);
  await f.put('shared/runtime/client.js', 'export default true;');
  await f.put('apps/non-verba-dev/src/camera/app.js', "import '../../../../inspections/map/map-ui.js';");
  await assert.rejects(collectWebAssets(f.root), /Developer runtime depends on a browser inspection/);
});

test('an unmarked inspection link cannot expand the Android document set', async t => {
  const f = await fixture(t);
  await f.put('apps/non-verba-dev/src/camera/index.html', f.sources.get('apps/non-verba-dev/src/camera/index.html').replace('data-browser-inspection', 'data-unmarked'));
  await assert.rejects(collectWebAssets(f.root, {target:'android'}), /undeclared document reached Android build.*map.html/);
});

test('catalog rejects duplicate output names and source escape paths', async t => {
  const f = await fixture(t);
  f.catalog.assets[1].output = f.catalog.assets[0].output;
  await f.put('assets.json', JSON.stringify(f.catalog));
  await assert.rejects(loadWebAssetCatalog(f.root), /Invalid or duplicate web asset/);
  f.catalog.assets[1].output = 'style.css';
  f.catalog.assets[0].source = '../escape.html';
  await f.put('assets.json', JSON.stringify(f.catalog));
  await assert.rejects(loadWebAssetCatalog(f.root), /Invalid or duplicate web asset/);
});

test('Android output assertion refuses extra assets, missing WASM and changed compiled bytes', async t => {
  const f = await fixture(t), expected = await collectWebAssets(f.root, {target:'android'});
  const actual = new Map([...expected, ['pkg/nonverba_core.js', Buffer.from('generated glue')], ['pkg/nonverba_core_bg.wasm', Buffer.from([0,97,115,109])]]);
  assert.doesNotThrow(() => assertAndroidWebAssets(actual, expected));
  actual.set('map-country-data.js', Buffer.from('browser only'));
  assert.throws(() => assertAndroidWebAssets(actual, expected), /Unexpected Android web assets/);
  actual.delete('map-country-data.js'); actual.delete('pkg/nonverba_core_bg.wasm');
  assert.throws(() => assertAndroidWebAssets(actual, expected), /Missing generated Android web asset/);
  actual.set('pkg/nonverba_core_bg.wasm', Buffer.from([0,97,115,109])); actual.set('index.html', Buffer.from('stale page'));
  assert.throws(() => assertAndroidWebAssets(actual, expected), /differs from current compiled source.*index.html/);
});

async function participantAsset(f, source = 'shared/identity/device-attestation.js', text = 'export const tool = true;') {
  const asset = {source, output: source.split('/').at(-1), consumer: 'participant'};
  f.catalog.assets.push(asset);
  await f.put(source, text);
  await f.put('assets.json', JSON.stringify(f.catalog));
  return asset;
}

test('explicit participant-only shared assets stay inventoried while excluded from developer closures', async t => {
  const f = await fixture(t);
  await participantAsset(f);
  const browser = await collectWebAssets(f.root), android = await collectWebAssets(f.root, {target: 'android'});
  assert.equal(browser.size, f.sources.size);
  assert.equal(browser.has('device-attestation.js'), false);
  assert.equal(android.has('device-attestation.js'), false);
  await rm(join(f.root, 'shared/identity/device-attestation.js'));
  await assert.rejects(collectWebAssets(f.root), /Missing cataloged web source files.*device-attestation/);
});

test('participant-only classification cannot conceal a source outside the canonical participant package', async t => {
  const f = await fixture(t);
  await participantAsset(f, 'shared/identity/unpackaged.js');
  await assert.rejects(loadWebAssetCatalog(f.root), /source must be shared and explicitly packaged.*unpackaged/);
  const asset = f.catalog.assets.at(-1);
  asset.source = 'shared/identity/device-attestation.js'; asset.output = 'device-attestation.js'; asset.consumer = 'other';
  await f.put('assets.json', JSON.stringify(f.catalog));
  await assert.rejects(loadWebAssetCatalog(f.root), /Invalid participant-only web asset/);
});

test('developer, shared and inspection runtime cannot reach excluded participant-only assets', async t => {
  const f = await fixture(t);
  await participantAsset(f);
  for (const [source, text] of [
    ['apps/non-verba-dev/src/camera/app.js', "import '../../../../shared/identity/device-attestation.js';"],
    ['shared/runtime/client.js', "import '../identity/device-attestation.js';"],
    ['inspections/map/map-ui.js', "import '../../shared/identity/device-attestation.js';"]
  ]) {
    await f.put(source, text);
    await assert.rejects(collectWebAssets(f.root), /Developer or inspection asset depends on a participant-only asset/);
    await f.put(source, f.sources.get(source));
  }
});

test('participant-only dependencies must be explicitly packaged and resolve inside the package', async t => {
  const f = await fixture(t);
  await participantAsset(f, 'shared/identity/device-attestation.js', "import '../runtime/client.js';");
  await assert.rejects(collectWebAssets(f.root), /Participant-only dependency is not packaged.*client.js/);
  await participantAsset(f, 'shared/identity/enrollment-camera.js');
  await f.put('shared/identity/device-attestation.js', "import './enrollment-camera.js';");
  assert.equal((await collectWebAssets(f.root)).has('device-attestation.js'), false);
  await f.put('shared/identity/device-attestation.js', "import './pkg/nonverba_core.js';");
  await assert.rejects(collectWebAssets(f.root), /Participant-only asset depends on a generated developer resource/);
});

test('repository catalog covers every browser source and Android contains only developer dependency closure', async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../web');
  const catalog = await loadWebAssetCatalog(root), browser = await collectWebAssets(root), android = await collectWebAssets(root, {target:'android'});
  assert.equal(browser.size, catalog.assets.filter(asset => asset.consumer !== 'participant').length);
  assert.equal(catalog.entries.browser.length, 10);
  assert.equal(catalog.entries.android.length, 7);
  const excludedSources = catalog.assets.filter(asset => asset.source.startsWith('inspections/') || asset.source.startsWith('shared/map/')
    || asset.source.startsWith('shared/identity/') && !['key-enrollment-platform.js', 'identity-vault.js', 'device-attestation.js', 'browser-attestation-keys.js'].includes(asset.output));
  for (const {output} of excludedSources) assert.equal(android.has(output), false, output);
  for (const entry of catalog.entries.android) assert.ok(android.has(entry), entry);
  assert.ok(android.get('core-worker.js').toString().includes("'./pkg/nonverba_core.js'"));
  assert.ok(android.has('device-attestation.js'));
  assert.ok(android.has('browser-attestation-keys.js'));
  assert.ok(android.has('device-attestation.html'));
  assert.ok(android.size < browser.size);
});
