// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic ADB responses test selection/failure semantics only. They cannot
// satisfy any physical sensor gate, even when the preflight says ready.
import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectDevice, parseDevices} from '../tools/device-preflight.mjs';

const expected = {version:'0.7.0', versionCode:9, sha256:'a'.repeat(64)};
const path = '/data/app/~~fixture/org.nonverba.camera-abc==/base.apk';
function fixture(overrides = {}) {
  const calls = [], outputs = {
    'devices -l':'List of devices attached\nfixture-01 device product:fixture model:Fixture transport_id:1\n',
    'shell getprop ro.product.manufacturer':'Fixture\n', 'shell getprop ro.product.model':'Synthetic\n',
    'shell getprop ro.build.version.sdk':'36\n', 'shell getprop ro.build.version.release':'16\n',
    'shell getprop ro.build.version.security_patch':'2026-09-01\n',
    'shell getprop ro.product.cpu.abilist':'arm64-v8a,armeabi-v7a\n',
    'shell getprop ro.kernel.qemu':'0\n', 'shell getprop ro.boot.qemu':'\n',
    'shell am get-current-user':'10\n',
    'shell pm list features':'feature:android.hardware.camera.any\nfeature:android.hardware.microphone\nfeature:android.hardware.location.gps\n',
    'shell pm path --user 10 org.nonverba.camera':`package:${path}\n`,
    [`shell sha256sum ${path}`]:`${expected.sha256}  ${path}\n`,
    ...overrides,
  };
  return {calls, run:async args => {
    calls.push(args);
    if (args[0] === '-s') { assert.equal(args[1], 'fixture-01'); args=args.slice(2); }
    const command = args.join(' ');
    assert.ok(Object.hasOwn(outputs, command), `Unexpected ADB command: ${command}`);
    if (outputs[command] instanceof Error) throw outputs[command];
    if (Array.isArray(outputs[command])) return outputs[command].shift();
    return outputs[command];
  }};
}
async function inspect(overrides, options = {}) {
  const mock=fixture(overrides), report=await inspectDevice({run:mock.run, expected, ...options});
  assert.equal(report.sensor_tests_run,false);assert.equal(report.attestation_verified,false);
  assert.equal(report.physical_sensor_authenticity_proven,false);
  return {report,calls:mock.calls};
}
test('no phone is incomplete and issues no device shell commands', async () => {
  const {report,calls}=await inspect({'devices -l':'List of devices attached\n\n'});
  assert.equal(report.status,'no-device');assert.equal(report.ready_for_manual_acceptance,false);
  assert.deepEqual(calls,[['devices','-l']]);
});
for (const state of ['unauthorized','offline','recovery','sideload','bootloader']) {
  test(`${state} cannot be queried or treated as a ready phone`,async()=>{
    const {report,calls}=await inspect({'devices -l':`List of devices attached\nfixture-01 ${state}\n`});
    assert.equal(report.status,`device-${state}`);assert.equal(report.ready_for_manual_acceptance,false);
    assert.deepEqual(calls,[['devices','-l']]);
  });
}
test('multiple targets require explicit selection even if only one is authorized',async()=>{
  const outputs={'devices -l':'List of devices attached\nfixture-01 device\nfixture-02 unauthorized\n'};
  const ambiguous=await inspect(outputs);assert.equal(ambiguous.report.status,'selection-required');assert.equal(ambiguous.calls.length,1);
  const selected=await inspect(outputs,{serial:'fixture-01'});assert.equal(selected.report.ready_for_manual_acceptance,true);
  assert.ok(selected.calls.slice(1).every(args=>args[0]==='-s'&&args[1]==='fixture-01'));
  const absent=await inspect(outputs,{serial:'missing'});assert.equal(absent.report.status,'selected-device-missing');assert.equal(absent.calls.length,1);
});
test('matching APK and declared prerequisites permit manual testing without proving any sensor',async()=>{
  const {report}=await inspect();assert.equal(report.status,'ready-for-manual-acceptance');
  assert.equal(report.observations.android_user_id,10);
  assert.deepEqual(report.observations.profiles,{camera_prerequisites:true,raw_gnss_prerequisites:true,monitored_audio_prerequisites:true});
  assert.equal(JSON.stringify(report).includes('fixture-01'),false,'Reports retain a serial digest instead of the raw ID');
});
for (const [label,overrides] of [
  ['emulator',{'shell getprop ro.kernel.qemu':'1\n'}],
  ['unknown API',{'shell getprop ro.build.version.sdk':''}],
  ['unsupported API',{'shell getprop ro.build.version.sdk':'25\n'}],
  ['unsupported ABI',{'shell getprop ro.product.cpu.abilist':'armeabi-v7a\n'}],
  ['absent package',{'shell pm path --user 10 org.nonverba.camera':''}],
  ['different APK',{[`shell sha256sum ${path}`]:`${'b'.repeat(64)}  ${path}\n`}],
  ['changed Android user',{'shell am get-current-user':['10\n','11\n']}],
  ['wrong hashed path',{[`shell sha256sum ${path}`]:`${expected.sha256}  /different/base.apk\n`}],
]) test(`${label} cannot satisfy a current release preflight`,async()=>{
  const {report}=await inspect(overrides);assert.equal(report.ready_for_manual_acceptance,false);
  assert.ok(report.blockers.length);assert.ok(Object.values(report.observations.profiles).every(value=>value===false));
});
test('API28 and missing device features never imply raw GNSS or monitored microphone support',async()=>{
  const older=await inspect({'shell getprop ro.build.version.sdk':'28\n'});
  assert.equal(older.report.observations.profiles.camera_prerequisites,true);
  assert.equal(older.report.observations.profiles.raw_gnss_prerequisites,false);
  assert.equal(older.report.observations.profiles.monitored_audio_prerequisites,false);
  const missing=await inspect({'shell pm list features':'feature:android.hardware.camera.any\n'});
  assert.equal(missing.report.observations.profiles.raw_gnss_prerequisites,false);
  assert.equal(missing.report.observations.profiles.monitored_audio_prerequisites,false);
});
for (const packagePaths of [`package:${path}\npackage:/data/app/fixture/split.apk\n`,
  'package:/data/app/fixture/../other/base.apk', 'package:/data/app/fixture/base.apk;reboot']) {
  test(`unsupported package path never reaches adb shell hashing: ${JSON.stringify(packagePaths)}`,async()=>{
    const {report,calls}=await inspect({'shell pm path --user 10 org.nonverba.camera':packagePaths});
    assert.equal(report.ready_for_manual_acceptance,false);assert.ok(!calls.some(args=>args.includes('sha256sum')));
  });
}
test('malformed inventory, identities and feature output fail rather than produce a ready report',async()=>{
  for (const output of ['error: unknown','List of devices attached\ninvalid;reboot device',
    'List of devices attached\nfixture-01 device\nfixture-01 device']) assert.throws(()=>parseDevices(output));
  await assert.rejects(inspect({}, {serial:'fixture;reboot'}),/Invalid ADB serial/);
  await assert.rejects(inspect({'shell pm list features':'Permission denied'}),/feature inventory/);
  await assert.rejects(inspect({'shell getprop ro.product.model':'model\nextra'}),/property/);
  await assert.rejects(inspect({'shell am get-current-user':'unknown'}),/foreground user/);
});
test('query errors and transport timeouts cannot become successful prerequisite reports',async()=>{
  await assert.rejects(inspect({'shell pm list features':new Error('ADB timeout')}),/ADB timeout/);
  const mock=fixture();await assert.rejects(inspectDevice({run:mock.run,expected:{...expected,sha256:'invalid'}}),/release identity/);
  assert.equal(mock.calls.length,0);
});
