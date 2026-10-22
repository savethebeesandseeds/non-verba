// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rename, symlink, link, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {crc32, parseZip} from '../../tools/build/verify-android-package.mjs';
import {collectParticipantAssets, inspectParticipantStage, assertSameParticipantAssets,
  PARTICIPANT_SHELL_SOURCES, PARTICIPANT_SHELL_BUDGET, PARTICIPANT_IMAGE_BUDGET, PARTICIPANT_STAGE} from '../../tools/build/participant-assets.mjs';
import {participantIdentityPreviews, prepareParticipantIdentity} from '../../tools/build/prepare-participant-identity.mjs';
import {participantSourceContract, verifyParticipantBadging, verifyParticipantPermissions,
  verifyParticipantSignature, verifyParticipantArchive, PARTICIPANT_APK_BUDGET} from '../../tools/build/verify-participant-package.mjs';
import {createParticipantServer} from '../../tools/preview/serve-participant.mjs';

assert.equal(process.platform, 'linux', 'Run only inside non-verba-dev.');
assert.equal(process.env.NONVERBA_CONTAINER, '1', 'Run only inside non-verba-dev.');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nonverba-participant-package-'));
  // This uniquely created test fixture is the only tree this test removes.
  t.after(() => rm(root, {recursive:true}));
  for (const [name, source] of Object.entries(PARTICIPANT_SHELL_SOURCES)) {
    await mkdir(dirname(join(root, source)), {recursive:true});
    await writeFile(join(root, source), Buffer.from('fixture bytes: ' + name));
  }
  await mkdir(join(root, 'LICENSES'));
  await writeFile(join(root, 'LICENSE'), 'project license\n');
  await writeFile(join(root, 'LICENSES/dependency.txt'), 'dependency license\n');
  return root;
}
async function stageFixture(root, assets) {
  const stage = join(root, 'stage');
  await mkdir(stage);
  for (const [name, bytes] of assets) {
    await mkdir(dirname(join(stage, name)), {recursive:true});
    await writeFile(join(stage, name), bytes);
  }
  return stage;
}
function archive(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [path, payload] of entries) {
    const name = Buffer.from(path), bytes = Buffer.from(payload), header = Buffer.alloc(30), directory = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc32(bytes), 14);
    header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc32(bytes), 16); directory.writeUInt32LE(bytes.length, 20);
    directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    const part = Buffer.concat([header, name, bytes]);
    local.push(part); central.push(Buffer.concat([directory, name])); offset += part.length;
  }
  const records = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(records.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, records, end]);
}
function packageEntries(assets) {
  return [['classes.dex', Buffer.from('synthetic DEX-like payload; not an installable APK')],
    ...[...assets].map(([name, bytes]) => ['assets/' + name, bytes])];
}
function verifyEntries(entries, assets) {
  const bytes = archive(entries);
  return verifyParticipantArchive(bytes, parseZip(bytes), assets);
}

async function preview(t) {
  const server = await createParticipantServer();
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return 'http://127.0.0.1:' + server.address().port;
}

test('participant browser responses and package inspector share exact canonical asset bytes', async t => {
  const origin = await preview(t), assets = await collectParticipantAssets(), served = new Map();
  for (const [name, expected] of assets) {
    const response = await fetch(origin + '/' + name);
    assert.equal(response.status, 200, name);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, expected, 'Browser diverged from the APK source: ' + name);
    served.set(name, bytes);
  }
  verifyEntries(packageEntries(served), assets);
  assert.equal((await fetch(origin + '/web/apps/non-verba/src/index.html')).status, 404);
  assert.equal((await fetch(origin + '/participant/participant.js', {method:'POST'})).status, 405);
});

test('Android accepts one plain participant document and exactly the shared runtime assets', async () => {
  const host = await readFile(new URL('../../android/participant/src/main/kotlin/org/nonverba/participant/ParticipantActivity.kt', import.meta.url), 'utf8');
  assert.doesNotMatch(host, /DOCUMENT_FRAGMENTS|allowDocumentFragment/,
    'Native navigation must not reintroduce a fragment routing exception.');
  assert.match(host, /return !request\.isForMainFrame \|\| !isBundled\(request\.url, setOf\(DOCUMENT_PATH\)\)/,
    'Document navigation must use the same closed bundled-URL guard as resources.');
  const guard = /private fun isBundled\([^\n]*\): Boolean =([\s\S]*?)\n\s*\/\//.exec(host)?.[1];
  assert.ok(guard, 'Missing native bundled-URL guard.');
  for (const restriction of [/uri\.scheme == "https"/, /uri\.host == APP_HOST/,
    /\(uri\.port == -1 \|\| uri\.port == 443\)/, /uri\.userInfo == null/,
    /uri\.query == null/, /uri\.fragment == null/, /uri\.encodedPath == uri\.path/,
    /uri\.path in paths/]) {
    assert.match(guard, restriction, 'Bundled URLs must retain every origin/path/query/fragment restriction.');
  }
  assert.doesNotMatch(guard.replace(/\(uri\.port == -1 \|\| uri\.port == 443\)/, ''), /\|\|/,
    'Queries and fragments must not acquire an alternative accepted branch.');
  assert.match(host, /webView\.loadUrl\("https:\/\/\$APP_HOST\$DOCUMENT_PATH"\)/,
    'Initial loading must use the plain bundled document URL.');
  const assetBlock = /private val ASSET_PATHS = setOf\(([\s\S]*?)\)/.exec(host);
  const documentPath = /private const val DOCUMENT_PATH = "([^"]+)"/.exec(host)?.[1];
  assert.ok(assetBlock && documentPath && /\bDOCUMENT_PATH\b/.test(assetBlock[1]), 'Missing Android document/asset allowlist.');
  assert.equal(documentPath, '/assets/participant/index.html', 'App views must not become document URL paths.');
  const paths = [documentPath, ...[...assetBlock[1].matchAll(/"([^"]+)"/g)].map(match => match[1])];
  assert.equal(new Set(paths).size, paths.length, 'Android assets must not repeat.');
  assert.deepEqual(paths.sort(), Object.keys(PARTICIPANT_SHELL_SOURCES).map(name => '/assets/' + name).sort(),
    'Browser preview and Android must load the same reviewed runtime assets.');
  const gradle = await readFile(new URL('../../android/participant/build.gradle.kts', import.meta.url), 'utf8');
  assert.equal(PARTICIPANT_STAGE, '/opt/nonverba-build/android/participant/build/generated/participant-capture-assets-v1');
  assert.equal((gradle.match(/generated\/participant-capture-assets-v1/g) || []).length, 2,
    'Gradle must consume and inspect only the new capture stage; older illustration outputs stay intact.');
  assert.doesNotMatch(gradle, /generated\/participant-assets["\/]/);
  const required = /val required = setOf\(([\s\S]*?)\)/.exec(gradle)?.[1];
  assert.ok(required, 'Missing Gradle participant runtime closure.');
  assert.deepEqual([...required.matchAll(/"([^"]+)"/g)].map(match => match[1]).sort(),
    Object.keys(PARTICIPANT_SHELL_SOURCES).sort(), 'Gradle must inspect the same exact runtime closure.');
  assert.match(host, /domStorageEnabled = false/, 'Real identity capture and account credentials stay out of DOM storage.');
  for (const restriction of [/blockNetworkLoads = true/, /allowFileAccess = false/,
    /allowContentAccess = false/, /setGeolocationEnabled\(false\)/]) assert.match(host, restriction);
});

test('synthetic identity previews remain source fixtures outside the real capture runtime', async () => {
  const prepared = await prepareParticipantIdentity('--check');
  const previews = participantIdentityPreviews();
  const assets = await collectParticipantAssets();
  assert.equal(prepared.outputs.length, 4);
  assert.equal(previews.size, 4);
  for (const [source, expected] of previews) {
    assert.ok(expected.length <= PARTICIPANT_IMAGE_BUDGET);
    const asset = Object.entries(PARTICIPANT_SHELL_SOURCES).find(([, value]) => value === source);
    assert.equal(asset, undefined, 'Synthetic previews must not enter the real capture runtime.');
    assert.equal([...assets.keys()].some(name => name.endsWith(source.split('/').at(-1))), false);
  }
});

test('native enrollment camera is exact-origin, camera-only and stopped on lifecycle loss', async () => {
  const base = new URL('../../android/participant/', import.meta.url);
  const [manifest, host] = await Promise.all([
    readFile(new URL('src/main/AndroidManifest.xml', base), 'utf8'),
    readFile(new URL('src/main/kotlin/org/nonverba/participant/ParticipantActivity.kt', base), 'utf8')]);
  assert.match(manifest, /<uses-permission android:name="android\.permission\.CAMERA"\s*\/>/);
  assert.equal((manifest.match(/<uses-permission /g) || []).length, 1);
  assert.match(manifest, /android:name="android\.hardware\.camera\.any" android:required="false"/);
  assert.match(host, /request\.resources\.size != 1 \|\| request\.resources\[0\] != PermissionRequest\.RESOURCE_VIDEO_CAPTURE/);
  assert.match(host, /!foregroundDocument\(\) \|\| !isCameraOrigin\(request\.origin\)/);
  assert.match(host, /requestPermissions\(arrayOf\(Manifest\.permission\.CAMERA\), CAMERA_PERMISSION\)/);
  assert.match(host, /request\.grant\(arrayOf\(PermissionRequest\.RESOURCE_VIDEO_CAPTURE\)\)/);
  assert.match(host, /webView\.url == "https:\/\/\$APP_HOST\$DOCUMENT_PATH"/);
  assert.match(host, /private fun foregroundDocument\(\) = resumed && visible/);
  assert.match(host, /uri\.fragment == null && uri\.path in setOf\("", "\/"\)/);
  for (const lifecycle of ['onStop','onDestroy']) {
    assert.match(host, new RegExp('override fun '+lifecycle+'\\(\\)[\\s\\S]{0,130}stopEnrollmentCamera\\(\\)'));
  }
  assert.match(host, /if \(!cameraPermissionInFlight\) stopEnrollmentCamera\(\)/);
  assert.match(host, /nonverba:camera-stop/);
  assert.match(host, /v\.srcObject\.getTracks\(\)\.forEach\(t=>t\.stop\(\)\)/);
  assert.match(host, /camera=\(self\), microphone=\(\), geolocation=\(\)/);
  assert.doesNotMatch(host, /RESOURCE_AUDIO_CAPTURE|RECORD_AUDIO|READ_EXTERNAL_STORAGE|ACTION_IMAGE_CAPTURE|NativeCamera/);
});

test('account networking is debug-only, fixed loopback and keeps WebView resource access blocked', async () => {
  const base = new URL('../../android/participant/', import.meta.url);
  const [main, debug, network, host, transport] = await Promise.all([
    readFile(new URL('src/main/AndroidManifest.xml', base), 'utf8'),
    readFile(new URL('src/debug/AndroidManifest.xml', base), 'utf8'),
    readFile(new URL('src/debug/res/xml/account_network_security_config.xml', base), 'utf8'),
    readFile(new URL('src/main/kotlin/org/nonverba/participant/ParticipantActivity.kt', base), 'utf8'),
    readFile(new URL('src/main/kotlin/org/nonverba/participant/AccountTransport.kt', base), 'utf8')]);
  assert.doesNotMatch(main, /android\.permission\.INTERNET|networkSecurityConfig/);
  assert.match(main, /usesCleartextTraffic="false"/);
  assert.equal((debug.match(/<uses-permission /g) || []).length, 1);
  assert.match(debug, /android\.permission\.INTERNET/);
  assert.match(network, /base-config cleartextTrafficPermitted="false"/);
  assert.match(network, /<domain includeSubdomains="false">127\.0\.0\.1<\/domain>/);
  assert.equal((network.match(/<domain /g) || []).length, 1);
  assert.match(host, /if \(WebViewFeature\.isFeatureSupported\(WebViewFeature\.WEB_MESSAGE_LISTENER\)\) \{\s*if \(BuildConfig\.DEBUG\) accountTransport = AccountTransport\(/);
  assert.match(host, /blockNetworkLoads = true/);
  assert.match(host, /setAcceptCookie\(false\)/);
  assert.match(transport, /!isMainFrame \|\| sourceOrigin\.toString\(\) != ASSET_ORIGIN \|\| view\.url != documentUrl/);
  assert.match(transport, /127\.0\.0\.1:4173/);
  assert.match(transport, /"GET" -> path in setOf\("\/v1\/accounts\/capabilities"/);
  assert.match(transport, /"DELETE" -> path == "\/v1\/auth\/session"/);
  assert.match(transport, /"\/v1\/accounts\/mock-mail"/);
  const nativePostPaths = /"POST" -> path in setOf\(([\s\S]*?)\)\n\s*"DELETE"/.exec(transport)?.[1];
  assert.ok(nativePostPaths, 'Native account transport must retain a closed POST path set.');
  for (const path of ['/v1/account/deletion', '/v1/account/deletion/status']) {
    assert.equal([...nativePostPaths.matchAll(/"([^"]+)"/g)].filter(match => match[1] === path).length, 1,
      'Account deletion and its operation-secret status must each have one exact native POST entry.');
  }
  const nativeGetPaths = /"GET" -> path in setOf\(([\s\S]*?)\)/.exec(transport)?.[1];
  assert.doesNotMatch(nativeGetPaths || '', /deletion/, 'Deletion must not be reachable through native GET.');
  for (const path of ['/readyz','/v1/account/devices']) {
    assert.equal([...nativeGetPaths.matchAll(/"([^"]+)"/g)].filter(match=>match[1] === path).length,1,
      'Live status must use one exact read-only native GET entry.');
    assert.equal([...nativePostPaths.matchAll(/"([^"]+)"/g)].some(match=>match[1] === path),false);
  }
  assert.match(transport, /instanceFollowRedirects = false/);
  assert.doesNotMatch(transport, /addJavascriptInterface|CookieManager|SharedPreferences|Log\./);
});

test('recovery text export uses a scoped message bridge and an explicit system save picker', async () => {
  const base = new URL('../../android/participant/', import.meta.url);
  const [host, bridge, policy, manifest] = await Promise.all([
    readFile(new URL('src/main/kotlin/org/nonverba/participant/ParticipantActivity.kt',base),'utf8'),
    readFile(new URL('src/main/kotlin/org/nonverba/participant/RecoveryCodeExport.kt',base),'utf8'),
    readFile(new URL('src/main/kotlin/org/nonverba/participant/RecoveryExportSession.kt',base),'utf8'),
    readFile(new URL('src/main/AndroidManifest.xml',base),'utf8')]);
  assert.match(bridge,/WebViewCompat\.addWebMessageListener\(webView, BRIDGE, setOf\(ORIGIN\)\)/);
  assert.match(bridge,/closed \|\| !isMainFrame/);
  assert.match(bridge,/if \(!foreground \|\| !foregroundDocument\(\)\)/);
  assert.ok(bridge.indexOf('request.only("id", "cancel")') < bridge.indexOf('if (!foreground || !foregroundDocument())'),
    'Revocation remains available while the owned save picker has paused its document.');
  assert.match(bridge,/sourceOrigin\.toString\(\) != ORIGIN \|\| view\.url != documentUrl/);
  assert.match(bridge,/Intent\.ACTION_CREATE_DOCUMENT/);
  assert.match(bridge,/type = "text\/plain"/);
  assert.match(bridge,/putExtra\(Intent\.EXTRA_TITLE, RecoveryExportSession\.FILENAME\)/);
  assert.match(bridge,/uri\?\.scheme != "content"/);
  assert.match(bridge,/contentResolver\.openOutputStream\(uri, "wt"\)/);
  assert.ok(bridge.indexOf('openOutputStream(uri, "wt")') < bridge.indexOf('session.copyBytes(operation.ticket)'),
    'A provider blocked during open must not retain a detached worker plaintext copy.');
  const finishBody = bridge.slice(bridge.indexOf('private fun finish('),bridge.indexOf('private fun closeLater('));
  assert.ok(finishBody.indexOf('session.finish(operation.ticket)') < finishBody.indexOf('closeLater'),
    'Revocation zeroes the lease and tracked worker bytes before scheduling provider close.');
  assert.doesNotMatch(finishBody,/\.close\(\)/,'Lifecycle revocation must not wait for provider close on the UI thread.');
  assert.match(bridge,/if \(saved && active\(\) && foregroundDocument\(\)\) "saved" else "failed"/);
  assert.match(bridge,/operation\.generation != documentGeneration/);
  assert.match(policy,/LIFETIME_MS = 120_000L/);
  assert.match(policy,/codes\.size != 8 \|\| codes\.toSet\(\)\.size != 8/);
  for (const lifecycle of ['resume','pause','stop','documentChanged','close']) {
    assert.match(host,new RegExp(`recoveryExport\\?\\.${lifecycle}\\(\\)`));
  }
  assert.match(host,/recoveryExport\?\.activityResult\(requestCode, resultCode, data\)/);
  assert.doesNotMatch(bridge,/addJavascriptInterface|DownloadManager|SharedPreferences|Log\.|takePersistableUriPermission|FileOutputStream/);
  assert.doesNotMatch(manifest,/READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE/);
});

test('local participant review changes only policy/indexing metadata and cannot enter the APK', async t => {
  const origin = await preview(t), assets = await collectParticipantAssets();
  const response = await fetch(origin + '/participant/review.html');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Security-Policy'), null, 'A cumulative header must not override the review meta policy.');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  const review = await response.text();
  assert.match(review, /style-src-elem 'self' 'unsafe-inline'; style-src-attr 'none';/);
  assert.match(review, /script-src 'self';/);
  assert.match(review, /img-src 'self' blob:;/);
  assert.match(review, /media-src 'self' blob:;/);
  assert.equal(response.headers.get('Permissions-Policy'), 'camera=(self), microphone=(), geolocation=()');
  assert.doesNotMatch(review, /(?:img|script|connect)-src[^;]*data:/,
    'Real capture previews must not permit data URLs or generic remote content.');
  const normalized = review.replace('\n  <meta name="robots" content="noindex,nofollow">', '')
    .replace(" style-src-elem 'self' 'unsafe-inline'; style-src-attr 'none';", '');
  assert.equal(normalized, assets.get('participant/index.html').toString('utf8'),
    'Review must not change product markup, scripts or styles.');
  assert.equal(assets.has('participant/review.html'), false);
  const injected = packageEntries(assets).map(([name, bytes]) =>
    [name, name === 'assets/participant/index.html' ? Buffer.from(review) : bytes]);
  assert.throws(() => verifyEntries(injected, assets), /differ/);
  assert.throws(() => verifyEntries([...packageEntries(assets), ['assets/participant/review.html', Buffer.from(review)]], assets),
    /Local review entry present in APK/);
});

test('participant collection has exact shell bytes and notices without developer runtime assets', async t => {
  const root = await fixture(t), assets = await collectParticipantAssets(root, {});
  assert.deepEqual([...assets.keys()].filter(name => name.startsWith('participant/')), Object.keys(PARTICIPANT_SHELL_SOURCES));
  assert.equal(assets.size, Object.keys(PARTICIPANT_SHELL_SOURCES).length + 3);
  for (const [name, source] of Object.entries(PARTICIPANT_SHELL_SOURCES)) assert.deepEqual(assets.get(name), await readFile(join(root, source)));
  assert.equal(assets.get('nonverba-license/LICENSES/dependency.txt').toString(), 'dependency license\n');
  assert.match(assets.get('nonverba-license/SOURCE.txt').toString(), /unspecified development build/);
  assertSameParticipantAssets(assets, await collectParticipantAssets(root, {}));
  assets.set('participant/index.html', Buffer.from('different'));
  assert.throws(() => assertSameParticipantAssets(assets, new Map()), /changed during packaging/);
});

test('participant closure refuses an extra source page rather than packaging it', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'web/apps/non-verba/src/sensor-inspection.html'), 'developer');
  await assert.rejects(collectParticipantAssets(root, {}), /source file set differs/);
});

test('participant closure excludes identity source fixtures and retains the per-image bound', async t => {
  const extra = await fixture(t);
  await mkdir(join(extra, 'web/apps/non-verba/assets/identity'), {recursive:true});
  await writeFile(join(extra, 'web/apps/non-verba/assets/identity/another-person.svg'), 'unreviewed');
  const collected = await collectParticipantAssets(extra, {});
  assert.equal([...collected.keys()].some(name => /another-person|document-a|face-a/.test(name)), false);
  const oversized = await fixture(t);
  await writeFile(join(oversized, 'web/site/branding/sprout.svg'), Buffer.alloc(PARTICIPANT_IMAGE_BUDGET + 1));
  await assert.rejects(collectParticipantAssets(oversized, {}), /bounded unlinked regular participant file/);
});

test('shell budget totals all reviewed sources and does not count required license text', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'LICENSE'), Buffer.alloc(PARTICIPANT_SHELL_BUDGET + 1, 0x78));
  assert.ok((await collectParticipantAssets(root, {})).get('nonverba-license/LICENSE.txt').length > PARTICIPANT_SHELL_BUDGET);
  await writeFile(join(root, 'web/apps/non-verba/src/participant.css'), Buffer.alloc(PARTICIPANT_SHELL_BUDGET / 2 + 1, 0x78));
  await writeFile(join(root, 'web/apps/non-verba/src/participant.js'), Buffer.alloc(PARTICIPANT_SHELL_BUDGET / 2 + 1, 0x78));
  await assert.rejects(collectParticipantAssets(root, {}), /296KiB account-client budget/);
});

test('participant inputs reject file links, hardlinks, missing files and linked parent directories', async t => {
  for (const kind of ['symlink', 'hardlink', 'missing', 'parent']) {
    const root = await fixture(t), source = join(root, 'web/apps/non-verba/src/index.html');
    if (kind === 'parent') {
      await rename(join(root, 'web/apps/non-verba/src'), join(root, 'original-src'));
      await symlink(join(root, 'original-src'), join(root, 'web/apps/non-verba/src'));
    } else {
      await rename(source, join(root, 'original-index.html'));
      if (kind === 'symlink') await symlink(join(root, 'original-index.html'), source);
      if (kind === 'hardlink') {
        await link(join(root, 'original-index.html'), source);
      }
    }
    await assert.rejects(collectParticipantAssets(root, {}), /unlinked|file set|ENOENT/);
  }
});

test('stage inspection enforces exact closure and current bytes while permitting preflight of known stale files', async t => {
  const root = await fixture(t), assets = await collectParticipantAssets(root, {}), stage = await stageFixture(root, assets);
  assertSameParticipantAssets(assets, await inspectParticipantStage(stage, assets));
  await writeFile(join(stage, 'participant/index.html'), 'previous shell');
  await assert.rejects(inspectParticipantStage(stage, assets), /staged bytes differ/);
  const before = await inspectParticipantStage(stage, assets, {allowMissing:true, compareBytes:false});
  assert.equal(before.get('participant/index.html').toString(), 'previous shell');
  await writeFile(join(stage, 'participant/developer.html'), 'preserved');
  await assert.rejects(inspectParticipantStage(stage, assets, {allowMissing:true, compareBytes:false}), /Unexpected participant stage output/);
  assert.equal(await readFile(join(stage, 'participant/developer.html'), 'utf8'), 'preserved');
});

test('stage closure refuses linked output and unexpected empty directories', async t => {
  for (const kind of ['file-link', 'directory-link', 'empty-directory']) {
    const root = await fixture(t), assets = await collectParticipantAssets(root, {}), stage = await stageFixture(root, assets);
    if (kind === 'file-link') {
      const name = join(stage, 'participant/index.html');
      await rename(name, join(root, 'staged-index.html'));
      await symlink(join(root, 'staged-index.html'), name);
    } else if (kind === 'directory-link') {
      await rename(join(stage, 'participant'), join(root, 'staged-participant'));
      await symlink(join(root, 'staged-participant'), join(stage, 'participant'));
    } else await mkdir(join(stage, 'unexpected-empty'));
    await assert.rejects(inspectParticipantStage(stage, assets), /Linked participant stage|Unexpected participant stage directory/);
  }
});

const expectedContract = {application_id:'org.nonverba.participant', version_code:1, version_name:'0.7.0', min_sdk:26, target_sdk:36};
const gradleFixture = 'namespace = "org.nonverba.participant"\napplicationId = "org.nonverba.participant"\nversionCode = 1\nversionName = "0.7.0"\nminSdk = 26\ntargetSdk = 36\n';
const badgingFixture = "package: name='org.nonverba.participant' versionCode='1' versionName='0.7.0' platformBuildVersionName='16'\nsdkVersion:'26'\ntargetSdkVersion:'36'\nlaunchable-activity: name='org.nonverba.participant.ParticipantActivity' label='Non-verba' icon=''\n";

test('source and APK metadata agree on the separate participant package and initial API/version contract', () => {
  assert.deepEqual(participantSourceContract(gradleFixture), expectedContract);
  assert.deepEqual(verifyParticipantBadging(badgingFixture, expectedContract), expectedContract);
  for (const changed of [gradleFixture.replace('applicationId = "org.nonverba.participant"', 'applicationId = "org.nonverba.camera"'),
    gradleFixture.replace('versionCode = 1', 'versionCode = 2'), gradleFixture.replace('minSdk = 26', 'minSdk = 25')]) {
    assert.throws(() => participantSourceContract(changed), /differs/);
  }
  for (const changed of [badgingFixture.replace("name='org.nonverba.participant'", "name='org.nonverba.camera'"),
    badgingFixture.replace("versionName='0.7.0'", "versionName='0.6.0'"), badgingFixture.replace("sdkVersion:'26'", "sdkVersion:'25'"),
    badgingFixture + "native-code: 'arm64-v8a'\n", badgingFixture.replace('ParticipantActivity', 'DeveloperActivity')]) {
    assert.throws(() => verifyParticipantBadging(changed, expectedContract), /differs|native code/);
  }
});

const receiverPermission = 'org.nonverba.participant.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION';
const permissionPackage = 'package: org.nonverba.participant\n';
const permissionSummary = permissionPackage + 'permission: ' + receiverPermission + "\nuses-permission: name='" + receiverPermission + "'\n";
const manifestRoot = 'N: android=http://schemas.android.com/apk/res/android\n  E: manifest (line=2)\n'
  + '    A: package="org.nonverba.participant" (Raw: "org.nonverba.participant")\n';
const receiverManifest = manifestRoot + '    E: permission (line=11)\n'
  + '      A: android:name(0x01010003)="' + receiverPermission + '" (Raw: "' + receiverPermission + '")\n'
  + '      A: android:protectionLevel(0x01010009)=(type 0x11)0x2\n'
  + '    E: uses-permission (line=15)\n'
  + '      A: android:name(0x01010003)="' + receiverPermission + '" (Raw: "' + receiverPermission + '")\n'
  + '    E: application (line=18)\n      A: android:label(0x01010001)="Non-verba" (Raw: "Non-verba")\n'
  + '      E: activity (line=20)\n        A: android:name(0x01010003)="org.nonverba.participant.ParticipantActivity"\n';

test('real aapt permission summary is cross-checked against typed signature protection in the compiled manifest', () => {
  assert.deepEqual(verifyParticipantPermissions(permissionPackage, manifestRoot), {requested:[], declared:[]});
  assert.deepEqual(verifyParticipantPermissions(permissionSummary, receiverManifest),
    {requested:[receiverPermission], declared:[receiverPermission]});
  const legacySummary = permissionSummary.replace('permission: ' + receiverPermission,
    "permission: name='" + receiverPermission + "' protectionLevel='0x00000002'");
  assert.deepEqual(verifyParticipantPermissions(legacySummary, receiverManifest),
    {requested:[receiverPermission], declared:[receiverPermission]});
  assert.throws(() => verifyParticipantPermissions(permissionSummary), /Compiled participant manifest is required/);
  for (const value of ['(type 0x11)0x0', '(type 0x11)0x1', '(type 0x11)0x12', '(type 0x03)0x2', '"signature"']) {
    assert.throws(() => verifyParticipantPermissions(permissionSummary, receiverManifest.replace('(type 0x11)0x2', value)), /typed signature protection/);
  }
  assert.throws(() => verifyParticipantPermissions(permissionSummary,
    receiverManifest.replace(/^.*android:protectionLevel.*\n/m, '')), /typed signature protection/);
  assert.throws(() => verifyParticipantPermissions(permissionSummary,
    receiverManifest.replace('android:protectionLevel(0x01010009)', 'android:protectionLevel(0x01010003)')), /typed signature protection/);
});

test('camera acquisition is explicit while INTERNET remains debug-only and undeclarable', () => {
  const internetSummary = permissionPackage + "uses-permission: name='android.permission.INTERNET'\n";
  const internetManifest = manifestRoot + '    E: uses-permission (line=8)\n'
    + '      A: android:name(0x01010003)="android.permission.INTERNET" (Raw: "android.permission.INTERNET")\n';
  assert.deepEqual(verifyParticipantPermissions(internetSummary, internetManifest),
    {requested:['android.permission.INTERNET'], declared:[]});
  assert.throws(() => verifyParticipantPermissions(internetSummary, internetManifest, {debug:false}), /unexpected permission/);
  assert.throws(() => verifyParticipantPermissions(internetSummary,
    internetManifest.replace('E: uses-permission', 'E: permission')), /unexpected permission/);
  const cameraSummary = internetSummary.replaceAll('INTERNET', 'CAMERA');
  const cameraManifest = internetManifest.replaceAll('INTERNET', 'CAMERA');
  assert.deepEqual(verifyParticipantPermissions(cameraSummary, cameraManifest, {debug:false}),
    {requested:['android.permission.CAMERA'], declared:[]});
  assert.throws(() => verifyParticipantPermissions(cameraSummary,
    cameraManifest.replace('E: uses-permission', 'E: permission')), /unexpected permission/);
});

test('compiled permission checks reject extra permissions, missing or ambiguous names, nested declarations and summary disagreement', () => {
  for (const name of ['android.permission.RECORD_AUDIO', 'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.MANAGE_EXTERNAL_STORAGE',
    'org.nonverba.camera.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION']) {
    assert.throws(() => verifyParticipantPermissions(permissionPackage + "uses-permission: name='" + name + "'\n", receiverManifest), /unexpected permission/);
    assert.throws(() => verifyParticipantPermissions(permissionSummary, receiverManifest.replaceAll(receiverPermission, name)), /unexpected permission/);
  }
  assert.throws(() => verifyParticipantPermissions(permissionPackage + "uses-permission: name='" + receiverPermission + "'\n", receiverManifest), /signature-protected declaration/);
  assert.throws(() => verifyParticipantPermissions(permissionSummary,
    receiverManifest.replace(/^      A: android:name.*\n/m, '')), /permission name/);
  assert.throws(() => verifyParticipantPermissions(permissionSummary,
    receiverManifest.replaceAll('android:name(0x01010003)', 'android:name(0x01010001)')), /permission name/);
  assert.throws(() => verifyParticipantPermissions(permissionSummary,
    receiverManifest.replace('E: permission (line=11)', 'E: application (line=10)\n      E: permission (line=11)')), /nested compiled participant permission/);
  const nestedProtection = receiverManifest.replace('      A: android:protectionLevel',
    '      E: meta-data (line=12)\n        A: android:protectionLevel');
  assert.throws(() => verifyParticipantPermissions(permissionSummary, nestedProtection), /typed signature protection/);
  const duplicateName = receiverManifest.replace('      A: android:protectionLevel',
    '      A: android:name(0x01010003)="' + receiverPermission + '"\n      A: android:protectionLevel');
  assert.throws(() => verifyParticipantPermissions(permissionSummary, duplicateName), /duplicate compiled manifest attribute/);
  assert.throws(() => verifyParticipantPermissions(permissionSummary, receiverManifest.replace('Raw: "' + receiverPermission, 'Raw: "different')), /permission name/);
  assert.throws(() => verifyParticipantPermissions(permissionSummary, receiverManifest.replace('package="org.nonverba.participant"', 'package="other.package"')), /manifest package/);
  assert.throws(() => verifyParticipantPermissions(permissionPackage, receiverManifest), /summary differs/);
  assert.throws(() => verifyParticipantPermissions(permissionSummary, manifestRoot), /summary differs/);
  assert.throws(() => verifyParticipantPermissions(permissionPackage + permissionSummary, receiverManifest), /ambiguous participant permission package/);
  assert.throws(() => verifyParticipantPermissions(permissionSummary.replace('package: org.nonverba.participant', 'package: other.package'), receiverManifest), /permission package metadata/);
  assert.throws(() => verifyParticipantPermissions(permissionPackage + 'unrecognized permission record', receiverManifest), /Unrecognized/);
  assert.throws(() => verifyParticipantPermissions(permissionSummary + "uses-permission: name='" + receiverPermission + "'\n", receiverManifest), /Duplicate/);
});

test('retained signer verification requires both Android Debug identity and exact baseline fingerprint', () => {
  const signer = 'a'.repeat(64), baseline = {signing_certificate_sha256:signer};
  const output = 'Number of signers: 1\nSigner #1 certificate DN: CN=Android Debug, O=Android, C=US\nSigner #1 certificate SHA-256 digest: ' + signer + '\n';
  assert.equal(verifyParticipantSignature(output, baseline), signer);
  assert.throws(() => verifyParticipantSignature(output, {signing_certificate_sha256:'b'.repeat(64)}), /differs/);
  assert.throws(() => verifyParticipantSignature(output.replace('Android Debug', 'Release'), baseline), /DEBUG signer/);
  assert.throws(() => verifyParticipantSignature(output.replace('signers: 1', 'signers: 2'), baseline), /one participant APK signer/);
  assert.throws(() => verifyParticipantSignature(output, {}), /baseline/);
});

test('APK closure checks every shell/notice byte and excludes developer assets, libraries, models and DEX prefixes', async t => {
  const root = await fixture(t), assets = await collectParticipantAssets(root, {}), entries = packageEntries(assets);
  const inspected = verifyEntries(entries, assets);
  assert.equal(inspected.assets.length, assets.size);
  assert.equal(inspected.dex.length, 1);
  assert.throws(() => verifyEntries(entries.slice(0, -1), assets), /Missing participant APK asset/);
  const changed = entries.map(([name, bytes]) => [name, name === 'assets/participant/index.html' ? Buffer.from('other') : bytes]);
  assert.throws(() => verifyEntries(changed, assets), /asset bytes differ/);
  for (const name of ['assets/web/camera.html', 'assets/participant/developer.html', 'assets/nonverba-license/unexpected.txt',
    'lib/arm64-v8a/libnonverba_android.so', 'res/raw/identity.tflite', 'res/raw/core.wasm', 'other/classes.dex']) {
    assert.throws(() => verifyEntries([...entries, [name, Buffer.from('unexpected')]], assets), /Unexpected|present in participant shell/);
  }
  for (const name of ['classes.dex', 'classes2.dex', 'classes10.dex']) {
    const developer = entries.filter(([entry]) => entry !== name);
    developer.push([name, Buffer.from('Lorg/nonverba/camera/NativeAudioDevice;')]);
    assert.throws(() => verifyEntries(developer, assets), /Developer class prefix/);
  }
  assert.throws(() => verifyParticipantArchive(Buffer.alloc(PARTICIPANT_APK_BUDGET + 1), new Map(), assets), /8MiB budget/);
});
