#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Inspect an existing DEBUG participant APK. Never build, sign, install, invoke
// ADB, change a package or replace a retained report.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash, randomBytes} from 'node:crypto';
import {access, mkdir, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseZip, entryBytes} from './verify-android-package.mjs';
import {PARTICIPANT_STAGE, collectParticipantAssets, inspectParticipantStage, readBoundedParticipantFile,
  assertSameParticipantAssets, assertParticipantAssetNames, PARTICIPANT_SHELL_BUDGET} from './participant-assets.mjs';

const execute = promisify(execFile), codeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const insist = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const PARTICIPANT_APK_BUDGET = 8 * 1024 * 1024;
const applicationId = 'org.nonverba.participant';
// The identity profile shares the reviewed acquisition controller, never the
// developer host, JNI signer or other developer sensors. Keep this set closed.
const SHARED_CAMERA_CLASSES = new Set(['NativeCameraEngine','NativeCameraProfile','NativeCameraIdentity',
  'NativeCameraLabels','NativeCameraLensPolicy','NativeCameraWorkQueue','NativeCameraTiming',
  'NativeSessionGuards','NativeLifecycleCleanup','NativeMainThreadRead']);

function sharedCameraClassesOnly(bytes) {
  for (const match of bytes.toString('latin1').matchAll(/org[/.]nonverba[/.]camera(?:[/.]([A-Za-z0-9_$/.]+))?/g)) {
    if (!match[1] || /[/.]/.test(match[1]) || !SHARED_CAMERA_CLASSES.has(match[1].split('$',1)[0])) return false;
  }
  return true;
}

export function participantSourceContract(gradle) {
  const string = field => new RegExp('\\b' + field + '\\s*=\\s*"([^"\\r\\n]+)"').exec(gradle)?.[1];
  const integer = field => Number(new RegExp('\\b' + field + '\\s*=\\s*(\\d+)\\b').exec(gradle)?.[1]);
  const contract = {application_id:string('applicationId'), version_code:integer('versionCode'),
    version_name:string('versionName'), min_sdk:integer('minSdk'), target_sdk:integer('targetSdk')};
  insist(contract.application_id === applicationId && string('namespace') === applicationId,
    'Participant source application ID/namespace differs.');
  insist(contract.version_code === 1 && contract.version_name === '0.7.0' && contract.min_sdk === 26
    && contract.target_sdk === 36, 'Participant initial source version/API contract differs.');
  return contract;
}

export function verifyParticipantBadging(text, expected) {
  const matches = [...text.matchAll(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/gm)];
  insist(matches.length === 1, 'Missing or ambiguous APK package metadata.');
  const [, name, code, version] = matches[0];
  insist(name === expected.application_id && Number(code) === expected.version_code && version === expected.version_name,
    'Participant APK package/version differs from current source.');
  insist(new RegExp("^sdkVersion:'" + expected.min_sdk + "'\\r?$", 'm').test(text)
    && new RegExp("^targetSdkVersion:'" + expected.target_sdk + "'\\r?$", 'm').test(text), 'Participant minimum/target API differs.');
  insist(!/^native-code:/m.test(text), 'Participant shell unexpectedly declares native code.');
  insist(/^launchable-activity: name='org\.nonverba\.participant\.ParticipantActivity'/m.test(text), 'Participant launcher activity differs.');
  return {application_id:name, version_code:Number(code), version_name:version, min_sdk:expected.min_sdk, target_sdk:expected.target_sdk};
}

function compiledParticipantPermissions(xml, {debug = true} = {}) {
  insist(typeof xml === 'string' && xml.trim(), 'Compiled participant manifest is required for permission protection checks.');
  const stack = [], elements = [], roots = [];
  for (const line of xml.split(/\r?\n/)) {
    if (!line.trim() || /^\s*N:/.test(line)) continue;
    const element = /^( *)E:\s+([^\s(]+)(?:\s+\(line=\d+\))?\s*$/.exec(line);
    if (element) {
      const depth = element[1].length;
      while (stack.length && stack.at(-1).depth >= depth) stack.pop();
      const item = {name:element[2], depth, parent:stack.at(-1), attributes:new Map()};
      if (!item.parent) roots.push(item);
      elements.push(item); stack.push(item);
      continue;
    }
    const attribute = /^( *)A:\s+([^\s=(]+)(?:\((0x[\da-f]+)\))?=(.*)$/i.exec(line);
    insist(attribute, 'Unrecognized compiled participant manifest output: ' + line);
    while (stack.length && stack.at(-1).depth >= attribute[1].length) stack.pop();
    const item = stack.at(-1);
    insist(item && !item.attributes.has(attribute[2]), 'Missing element or duplicate compiled manifest attribute: ' + attribute[2]);
    item.attributes.set(attribute[2], {id:attribute[3], value:attribute[4]});
  }
  insist(roots.length === 1 && roots[0].name === 'manifest' && elements.filter(item => item.name === 'manifest').length === 1,
    'Missing or ambiguous compiled participant manifest root.');
  function string(attribute, label, id) {
    const match = /^"([^"\\\x00-\x1f]+)"(?:\s+\(Raw: "([^"\\\x00-\x1f]+)"\))?$/.exec(attribute?.value || '');
    insist(match && (!id || Number(attribute.id) === id) && (match[2] === undefined || match[2] === match[1]),
      'Missing or ambiguous compiled participant ' + label + '.');
    return match[1];
  }
  insist(string(roots[0].attributes.get('package'), 'manifest package') === applicationId, 'Compiled participant manifest package differs.');
  const requested = [], declared = [], allowed = applicationId + '.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION';
  for (const item of elements) {
    if (!/^(?:permission|uses-permission)/.test(item.name)) continue;
    insist(item.parent === roots[0] && /^(?:permission|uses-permission(?:-sdk-\d+)?)$/.test(item.name),
      'Unexpected or nested compiled participant permission element: ' + item.name);
    const name = string(item.attributes.get('android:name'), 'permission name', 0x01010003);
    insist(name === allowed || (item.name !== 'permission' && (name === 'android.permission.CAMERA'
      || debug && name === 'android.permission.INTERNET')),
      'Participant shell requests or declares unexpected permission: ' + name);
    if (item.name === 'permission') {
      const protection = item.attributes.get('android:protectionLevel');
      insist(Number(protection?.id) === 0x01010009 && /^\(type 0x1[01]\)(?:0x0*2|2)$/i.test(protection?.value || ''),
        'Participant receiver permission must declare typed signature protection.');
    }
    const entries = item.name === 'permission' ? declared : requested;
    insist(!entries.includes(name), 'Duplicate compiled participant permission: ' + name);
    entries.push(name);
  }
  insist(!requested.includes(allowed) || declared.includes(allowed), 'Participant receiver permission lacks its own signature-protected declaration.');
  return {requested, declared};
}

export function verifyParticipantPermissions(text, compiledManifest, {debug = true} = {}) {
  const allowed = applicationId + '.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION', permissions = [], declarations = [];
  let packageCount = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.startsWith('package:')) {
      insist(line === 'package: ' + applicationId && ++packageCount === 1, 'Missing or ambiguous participant permission package metadata.');
      continue;
    }
    const match = /^(uses-permission(?:-sdk-\d+)?|permission):\s+(?:name='([^']+)'(?:\s+protectionLevel='([^']+)')?|([\w.]+))\s*$/.exec(line);
    insist(match, 'Unrecognized participant permission output: ' + line);
    const name = match[2] || match[4];
    insist(name === allowed || (match[1] !== 'permission' && (name === 'android.permission.CAMERA'
      || debug && name === 'android.permission.INTERNET')),
      'Participant shell requests or declares unexpected permission: ' + name);
    if (match[1] === 'permission' && match[3] !== undefined) {
      const protection = match[3];
      insist(protection === 'signature' || /^(?:0x[\da-f]+|\d+)$/i.test(protection || '') && Number(protection) === 2,
        'Participant receiver permission must declare signature protection.');
    }
    const entries = match[1] === 'permission' ? declarations : permissions;
    insist(!entries.includes(name), 'Duplicate participant permission: ' + name);
    entries.push(name);
  }
  insist(packageCount === 1, 'Missing or ambiguous participant permission package metadata.');
  insist(!permissions.includes(allowed) || declarations.includes(allowed), 'Participant receiver permission lacks its own signature-protected declaration.');
  const compiled = compiledParticipantPermissions(compiledManifest, {debug});
  insist(JSON.stringify(permissions) === JSON.stringify(compiled.requested) && JSON.stringify(declarations) === JSON.stringify(compiled.declared),
    'Participant permission summary differs from compiled manifest.');
  return {requested:permissions, declared:declarations};
}

export function verifyParticipantSignature(output, baseline) {
  insist(/^Number of signers: 1\r?$/m.test(output), 'Expected one participant APK signer.');
  insist(/^Signer #1 certificate DN:.*\bCN=Android Debug(?:,|\s*$)/mi.test(output), 'Expected retained Android DEBUG signer; production signing is not verified.');
  const signer = /^Signer #1 certificate SHA-256 digest: ([\da-f]{64})\r?$/mi.exec(output)?.[1].toLowerCase();
  insist(signer && /^[\da-f]{64}$/.test(baseline.signing_certificate_sha256), 'Missing valid retained debug signer baseline.');
  insist(signer === baseline.signing_certificate_sha256, 'Participant debug signer differs from retained baseline.');
  return signer;
}

export function verifyParticipantArchive(apk, records, assets) {
  insist(apk.length <= PARTICIPANT_APK_BUDGET, 'Participant APK exceeds initial 8MiB budget.');
  assertParticipantAssetNames(assets);
  const packaged = new Map(), dex = [];
  const expectedDirectories = new Set(['assets/']);
  for (const name of assets.keys()) {
    let directory = 'assets/' + name;
    while (directory.includes('/')) {
      directory = directory.slice(0, directory.lastIndexOf('/'));
      expectedDirectories.add(directory + '/');
    }
  }
  for (const record of records.values()) {
    const name = record.name;
    insist(!name.startsWith('lib/') && !/\.(?:so|wasm|tflite|onnx|task)$/i.test(name), 'Native library/model/WASM present in participant shell: ' + name);
    if (name.startsWith('assets/')) {
      if (name.endsWith('/')) { insist(expectedDirectories.has(name), 'Unexpected participant APK asset directory: ' + name); continue; }
      const asset = name.slice('assets/'.length);
      insist(assets.has(asset), 'Unexpected participant APK asset: ' + asset);
      const bytes = entryBytes(apk, record);
      insist(bytes.equals(assets.get(asset)), 'Participant APK asset bytes differ from current source/stage: ' + asset);
      packaged.set(asset, {path:asset, bytes:bytes.length, sha256:sha256(bytes)});
    } else if (name.endsWith('.dex')) {
      insist(/^classes(?:[2-9]|[1-9]\d+)?\.dex$/.test(name), 'Unexpected participant DEX location: ' + name);
      const bytes = entryBytes(apk, record);
      insist(sharedCameraClassesOnly(bytes),
        'Developer class prefix present in participant DEX: ' + name);
      dex.push({path:name, bytes:bytes.length, sha256:sha256(bytes)});
    }
  }
  for (const name of assets.keys()) insist(packaged.has(name), 'Missing participant APK asset: ' + name);
  insist(dex.some(record => record.path === 'classes.dex'), 'Participant APK has no primary DEX code.');
  return {assets:[...packaged.values()], dex};
}

async function exists(path) { try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function run(executable, args, results) {
  const result = await execute(executable, args, {encoding:'utf8', timeout:60000, maxBuffer:8 * 1024 * 1024});
  const output = result.stdout + (result.stderr ? '\n' + result.stderr : '');
  results.push({executable, arguments:args, output:output.trim()});
  return output;
}

async function main() {
  insist(process.platform === 'linux' && process.env.NONVERBA_CONTAINER === '1' && await exists('/.dockerenv'),
    'Run only inside managed non-verba-dev; host APK inspection is prohibited.');
  const options = {}, arguments_ = process.argv.slice(2);
  while (arguments_.length) {
    const name = arguments_.shift();
    insist(['--apk', '--baseline-report'].includes(name) && arguments_.length && !options[name],
      'Usage: node tools/build/verify-participant-package.mjs --apk PATH --baseline-report PATH');
    options[name] = arguments_.shift();
  }
  insist(options['--apk'] && options['--baseline-report'], 'Both --apk and --baseline-report are required; no signing baseline is guessed.');
  const apkPath = resolve(options['--apk']), baselinePath = resolve(options['--baseline-report']);
  const buildTools = '/opt/nonverba-tools/android-sdk/build-tools/36.0.0', java = '/opt/nonverba-tools/jdk/bin/java';
  const reportPath = join(codeRoot, 'artifacts/qa', 'participant-debug-package-verification-'
    + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(6).toString('hex') + '.json');
  const report = {schema_version:1, checked_at_utc:new Date().toISOString(), passed:false, package_checks_passed:false,
    apk:apkPath, report_path:reportPath, baseline_report:baselinePath, package_kind:'participant-shell-debug',
    production_signing_verified:false, compiled_source_reproducibility_verified:false,
    device_tested:false, sensor_tests_run:false, service_integration_tested:false, participant_workflows_complete:false,
    limitations:['Exact asset-byte, metadata and retained debug-signer checks do not attest the compiled Kotlin/AndroidX source or reproduce a build.',
      'No physical device, service, consent workflow, collector assurance, update migration or release distribution acceptance.'],
    source_asset_basis:'Current reviewed shared UI/artwork files plus license/source notices, exactly compared with Linux stage and APK.',
    assets:[], dex:[], native_libraries:[], errors:[], tool_results:[]};
  try {
    const properties = (await readBoundedParticipantFile(join(buildTools, 'source.properties'))).toString('utf8');
    insist(/^Pkg\.Revision\s*=\s*36\.0\.0\s*$/m.test(properties), 'Unexpected Android build-tools version.');
    const gradle = (await readBoundedParticipantFile(join(codeRoot, 'android/participant/build.gradle.kts'))).toString('utf8');
    const contract = participantSourceContract(gradle);
    const packageMetadata = JSON.parse((await readBoundedParticipantFile(join(codeRoot, 'package.json'))).toString('utf8'));
    insist(packageMetadata.version === contract.version_name, 'Participant source version disagrees with code/package.json.');
    const assets = await collectParticipantAssets();
    await inspectParticipantStage(PARTICIPANT_STAGE, assets);
    const apk = await readBoundedParticipantFile(apkPath, PARTICIPANT_APK_BUDGET);
    report.bytes = apk.length; report.sha256 = sha256(apk);
    const baseline = JSON.parse((await readBoundedParticipantFile(baselinePath, 16 * 1024 * 1024)).toString('utf8'));
    const signature = await run(java, ['-jar', join(buildTools, 'lib/apksigner.jar'), 'verify', '--verbose', '--print-certs', apkPath], report.tool_results);
    report.signing_certificate_sha256 = verifyParticipantSignature(signature, baseline);
    report.debug_signature_verified = true; report.same_debug_signer_as_baseline = true;
    Object.assign(report, verifyParticipantBadging(await run(join(buildTools, 'aapt'), ['dump', 'badging', apkPath], report.tool_results), contract));
    const permissions = await run(join(buildTools, 'aapt'), ['dump', 'permissions', apkPath], report.tool_results);
    const manifest = await run(join(buildTools, 'aapt'), ['dump', 'xmltree', apkPath, 'AndroidManifest.xml'], report.tool_results);
    report.permissions = verifyParticipantPermissions(permissions, manifest);
    report.compiled_manifest_permissions_verified = true;
    await run(join(buildTools, 'zipalign'), ['-c', '-P', '16', '-v', '4', apkPath], report.tool_results);
    report.zip_alignment_verified = true;
    Object.assign(report, verifyParticipantArchive(apk, parseZip(apk), assets));
    assertSameParticipantAssets(assets, await collectParticipantAssets());
    await inspectParticipantStage(PARTICIPANT_STAGE, assets);
    insist(gradle === (await readBoundedParticipantFile(join(codeRoot, 'android/participant/build.gradle.kts'))).toString('utf8'),
      'Participant source metadata changed during inspection.');
    insist(sha256(await readBoundedParticipantFile(apkPath, PARTICIPANT_APK_BUDGET)) === report.sha256,
      'Participant APK changed during inspection.');
    report.shell_bytes = assertParticipantAssetNames(assets); report.shell_budget_bytes = PARTICIPANT_SHELL_BUDGET;
    report.apk_budget_bytes = PARTICIPANT_APK_BUDGET; report.license_source_notices_verified = true;
    report.developer_class_prefix_excluded = true; report.package_checks_passed = true; report.passed = true;
  } catch (error) { report.errors.push(String(error.message)); }
  await mkdir(dirname(reportPath), {recursive:true});
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', {flag:'wx'});
  console.log(JSON.stringify({passed:report.passed, report:reportPath, apk:apkPath, sha256:report.sha256,
    production_signing_verified:false, device_tested:false, errors:report.errors}, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
