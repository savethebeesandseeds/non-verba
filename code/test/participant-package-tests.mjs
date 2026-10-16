// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rename, symlink, link, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {crc32, parseZip} from '../tools/verify-android-package.mjs';
import {collectParticipantAssets, inspectParticipantStage, assertSameParticipantAssets,
  PARTICIPANT_SHELL_SOURCES, PARTICIPANT_SHELL_BUDGET} from '../tools/participant-assets.mjs';
import {participantSourceContract, verifyParticipantBadging, verifyParticipantPermissions,
  verifyParticipantSignature, verifyParticipantArchive, PARTICIPANT_APK_BUDGET} from '../tools/verify-participant-package.mjs';

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

test('participant collection has exact shell bytes and notices without developer runtime assets', async t => {
  const root = await fixture(t), assets = await collectParticipantAssets(root, {});
  assert.deepEqual([...assets.keys()].filter(name => name.startsWith('participant/')), Object.keys(PARTICIPANT_SHELL_SOURCES));
  assert.equal(assets.size, 7);
  for (const [name, source] of Object.entries(PARTICIPANT_SHELL_SOURCES)) assert.deepEqual(assets.get(name), await readFile(join(root, source)));
  assert.equal(assets.get('nonverba-license/LICENSES/dependency.txt').toString(), 'dependency license\n');
  assert.match(assets.get('nonverba-license/SOURCE.txt').toString(), /unspecified development build/);
  assertSameParticipantAssets(assets, await collectParticipantAssets(root, {}));
  assets.set('participant/index.html', Buffer.from('different'));
  assert.throws(() => assertSameParticipantAssets(assets, new Map()), /changed during packaging/);
});

test('participant closure refuses an extra source page rather than packaging it', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'web/participant/src/sensor-inspection.html'), 'developer');
  await assert.rejects(collectParticipantAssets(root, {}), /source file set differs/);
});

test('shell budget totals all four sources and does not count required license text', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'LICENSE'), Buffer.alloc(PARTICIPANT_SHELL_BUDGET + 1, 0x78));
  assert.ok((await collectParticipantAssets(root, {})).get('nonverba-license/LICENSE.txt').length > PARTICIPANT_SHELL_BUDGET);
  await writeFile(join(root, 'web/participant/src/participant.css'), Buffer.alloc(40000, 0x78));
  await writeFile(join(root, 'web/participant/src/participant.js'), Buffer.alloc(30000, 0x78));
  await assert.rejects(collectParticipantAssets(root, {}), /64KiB budget/);
});

test('participant inputs reject file links, hardlinks, missing files and linked parent directories', async t => {
  for (const kind of ['symlink', 'hardlink', 'missing', 'parent']) {
    const root = await fixture(t), source = join(root, 'web/participant/src/index.html');
    if (kind === 'parent') {
      await rename(join(root, 'web/participant/src'), join(root, 'original-src'));
      await symlink(join(root, 'original-src'), join(root, 'web/participant/src'));
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

test('compiled permission checks reject extra permissions, missing or ambiguous names, nested declarations and summary disagreement', () => {
  for (const name of ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO', 'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.MANAGE_EXTERNAL_STORAGE', 'android.permission.INTERNET',
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
