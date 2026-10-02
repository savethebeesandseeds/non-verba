// SPDX-License-Identifier: AGPL-3.0-only
// Read-only Android acceptance preflight. No install, launch, permission changes,
// sensor collection, identity creation, data clearing or explicit ADB-server
// start/kill/restart commands. A normal ADB client may auto-start its host server.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const execute = promisify(execFile);
const codeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const properties = ['ro.product.manufacturer', 'ro.product.model', 'ro.build.version.sdk',
  'ro.build.version.release', 'ro.build.version.security_patch', 'ro.product.cpu.abilist',
  'ro.kernel.qemu', 'ro.boot.qemu'];
const knownFeatures = ['android.hardware.camera.any', 'android.hardware.camera',
  'android.hardware.microphone', 'android.hardware.location.gps', 'android.hardware.strongbox_keystore'];
const serialPattern = /^[A-Za-z0-9_.:\[\]-]{1,160}$/;

export function parseDevices(output) {
  const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.shift() !== 'List of devices attached') throw new Error('ADB did not return a recognized device inventory.');
  const devices = lines.map(line => {
    const match = /^(\S+)\s+(device|unauthorized|offline|recovery|sideload|bootloader)(?:\s|$)/.exec(line);
    if (!match || !serialPattern.test(match[1])) throw new Error('Unrecognized ADB device entry; select and inspect the device manually.');
    return {serial:match[1], state:match[2]};
  });
  if (new Set(devices.map(device => device.serial)).size !== devices.length) throw new Error('ADB inventory contains duplicate device identities.');
  return devices;
}

export async function inspectDevice({run, expected, serial}) {
  if (!/^[0-9a-f]{64}$/.test(expected.sha256) || !Number.isSafeInteger(expected.versionCode) || expected.versionCode < 1
      || !/^\d+\.\d+\.\d+$/.test(expected.version)) throw new Error('Invalid expected release identity.');
  if (serial !== undefined && !serialPattern.test(serial)) throw new Error('Invalid ADB serial.');
  const report = {version:1, type:'nonverba-device-preflight', checked_at:new Date().toISOString(),
    status:'not-ready', ready_for_manual_acceptance:false, sensor_tests_run:false,
    physical_sensor_authenticity_proven:false, attestation_verified:false,
    expected_release:expected, inventory:[], observations:null, blockers:[], limitations:[
      'ADB properties and feature declarations are local device claims, not attestation.',
      'Preflight does not establish raw GNSS availability, Camera2 timing, acoustic support or sensor accuracy.',
      'Physical acceptance requires the original requests, actual captured artifacts and independent verification.',
    ]};
  const devices = parseDevices(await run(['devices', '-l']));
  report.inventory = devices.map(device => ({serial_sha256:hash(device.serial), state:device.state}));
  if (!devices.length) { report.status='no-device'; report.blockers.push('Connect and authorize a test Android phone.'); return report; }
  if (serial === undefined && devices.length !== 1) {
    report.status='selection-required'; report.blockers.push('More than one ADB target is listed; select one explicitly with --serial.'); return report;
  }
  const selected = serial === undefined ? devices[0] : devices.find(device => device.serial === serial);
  if (!selected) { report.status='selected-device-missing'; report.blockers.push('The explicitly selected ADB target is not connected.'); return report; }
  report.selected_serial_sha256 = hash(selected.serial);
  if (selected.state !== 'device') {
    report.status=`device-${selected.state}`; report.blockers.push('The selected device is not in an authorized Android ADB state.'); return report;
  }
  const shell = (...args) => run(['-s', selected.serial, 'shell', ...args]);
  const values = {};
  for (const property of properties) {
    const value = (await shell('getprop', property)).trim();
    if (value.length > 256 || /[\r\n\0]/.test(value)) throw new Error(`Unrecognized Android property: ${property}`);
    values[property] = value;
  }
  const featureText = await shell('pm', 'list', 'features');
  const featureLines = new Set(featureText.split(/\r?\n/).map(line => line.trim()));
  featureLines.delete('');
  if (!featureLines.size || [...featureLines].some(line => !/^feature:[A-Za-z0-9_.=+-]+$/.test(line))) throw new Error('Android did not return a recognized feature inventory.');
  const features = Object.fromEntries(knownFeatures.map(feature => [feature, [...featureLines].some(line => line === `feature:${feature}` || line.startsWith(`feature:${feature}=`))]));
  const api = /^\d+$/.test(values['ro.build.version.sdk']) ? Number(values['ro.build.version.sdk']) : null;
  const androidUser = (await shell('am', 'get-current-user')).trim();
  if (!/^\d{1,6}$/.test(androidUser)) throw new Error('Android did not identify its foreground user.');
  const abis = values['ro.product.cpu.abilist'].split(',').filter(Boolean);
  const emulator = selected.serial.startsWith('emulator-') || values['ro.kernel.qemu'] === '1' || values['ro.boot.qemu'] === '1';
  report.observations = {properties:values, features, api_level:api, abis, android_user_id:Number(androidUser), emulator_reported:emulator,
    reported_installed_apk_sha256:null, expected_apk_bytes_match:false,
    profiles:{camera_prerequisites:false, raw_gnss_prerequisites:false, monitored_audio_prerequisites:false}};
  if (emulator) report.blockers.push('An emulator cannot complete physical sensor acceptance.');
  if (api === null || api < 26 || api > 1000) report.blockers.push('A supported Android API level (26+) was not reported.');
  if (!abis.some(abi => ['arm64-v8a','x86_64'].includes(abi))) report.blockers.push('The device does not report an ABI packaged in this APK.');
  const packagePaths = (await shell('pm', 'path', '--user', androidUser, 'org.nonverba.camera')).trim();
  if (!packagePaths) report.blockers.push('The Non-verba package is not installed for the current Android user.');
  else {
    // This release is one universal APK. Never interpolate an unchecked device
    // path into adb shell, and do not silently inspect a different split package.
    const match = /^package:(\/data\/app\/[A-Za-z0-9_~+./=-]+\/base\.apk)$/.exec(packagePaths);
    if (!match || match[1].includes('/../')) report.blockers.push('The installed package path is unsupported or contains multiple APKs.');
    else {
      const digest = (await shell('sha256sum', match[1])).trim();
      const sum = /^([0-9a-fA-F]{64})\s+([^\r\n]+)$/.exec(digest);
      if (!sum || sum[2] !== match[1]) report.blockers.push('Android did not return a recognizable installed-APK SHA-256.');
      else {
        report.observations.reported_installed_apk_sha256 = sum[1].toLowerCase();
        report.observations.expected_apk_bytes_match = sum[1].toLowerCase() === expected.sha256;
        if (!report.observations.expected_apk_bytes_match) report.blockers.push('The installed APK bytes differ from the selected local release.');
      }
    }
  }
  const sameUser = (await shell('am', 'get-current-user')).trim() === androidUser;
  if (!sameUser) report.blockers.push('The foreground Android user changed during preflight; rerun for the intended user.');
  const supported = sameUser && !emulator && api !== null && api >= 26 && api <= 1000
    && abis.some(abi => ['arm64-v8a','x86_64'].includes(abi)) && report.observations.expected_apk_bytes_match;
  report.observations.profiles = {
    camera_prerequisites:supported && (features['android.hardware.camera.any'] || features['android.hardware.camera']),
    raw_gnss_prerequisites:supported && api >= 29 && features['android.hardware.location.gps'],
    monitored_audio_prerequisites:supported && api >= 29 && features['android.hardware.microphone'],
  };
  report.ready_for_manual_acceptance = report.blockers.length === 0;
  report.status = report.ready_for_manual_acceptance ? 'ready-for-manual-acceptance' : 'not-ready';
  return report;
}

async function main() {
  const args = process.argv.slice(2), options = {};
  while (args.length) {
    const option = args.shift();
    if (!['--serial','--adb'].includes(option) || !args.length || options[option] !== undefined) throw new Error('Usage: node tools/device-preflight.mjs [--serial ID] [--adb PATH]');
    options[option] = args.shift();
  }
  const version = JSON.parse(await readFile(resolve(codeRoot, 'package.json'), 'utf8')).version;
  const gradle = await readFile(resolve(codeRoot, 'android/app/build.gradle.kts'), 'utf8');
  const versionCode = Number(/\bversionCode\s*=\s*(\d+)/.exec(gradle)?.[1]);
  const filename = `nonverba-camera-${version}-debug.apk`, apk = resolve(codeRoot, 'dist', filename);
  const ledger = (await readFile(resolve(codeRoot, 'dist/SHA256SUMS.txt'), 'utf8')).split(/\r?\n/)
    .map(line => /^([0-9a-f]{64})  (.+)$/.exec(line)).filter(entry => entry?.[2] === filename);
  if (ledger.length !== 1 || ledger[0][1] !== hash(await readFile(apk))) throw new Error('The selected local APK does not match its recorded release checksum.');
  const expected = {version, versionCode, sha256:ledger[0][1]};
  if(process.platform!=='linux'||process.env.NONVERBA_CONTAINER!=='1')throw new Error('Run device preflight through code/dev.ps1 inside non-verba-dev.');
  const adb = resolve(options['--adb'] || resolve(process.env.ANDROID_HOME || '/opt/nonverba-tools/android-sdk', 'platform-tools/adb'));
  const reportPath = resolve(codeRoot, 'artifacts/device-acceptance', `preflight-${new Date().toISOString().replace(/[:.]/g,'-')}-${process.pid}.json`);
  let report;
  try {
    report = await inspectDevice({expected, serial:options['--serial'], run:async args => {
      const result = await execute(adb, args, {encoding:'utf8', timeout:10000, maxBuffer:512*1024, windowsHide:true});
      return result.stdout;
    }});
  } catch (error) {
    // Fail visibly, never turn an unavailable query into a successful profile.
    report = {version:1, type:'nonverba-device-preflight', checked_at:new Date().toISOString(),
      status:'query-failed', ready_for_manual_acceptance:false, sensor_tests_run:false,
      physical_sensor_authenticity_proven:false, attestation_verified:false, expected_release:expected,
      error:String(error.message)};
  }
  await mkdir(dirname(reportPath), {recursive:true});
  await writeFile(reportPath, `${JSON.stringify(report,null,2)}\n`, {flag:'wx'});
  console.log(JSON.stringify({status:report.status, ready_for_manual_acceptance:report.ready_for_manual_acceptance,
    sensor_tests_run:false, report:reportPath}, null, 2));
  process.exitCode = report.ready_for_manual_acceptance ? 0 : 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode=1; });
}
