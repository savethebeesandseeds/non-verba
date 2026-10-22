// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {mkdtemp, mkdir, writeFile, readFile, rm, utimes, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {parseZip, entryBytes, parseElf, exportedJni, crc32, parseCargoDepInfo, cargoFreshnessInputs, cargoFreshness, developerAndroidSourceInputs} from '../../tools/build/verify-android-package.mjs';

assert.equal(process.platform, 'linux', 'Run tests only inside non-verba-dev.');
assert.equal(process.env.NONVERBA_CONTAINER, '1', 'Run tests only inside non-verba-dev.');

test('developer package freshness includes shared native tool sources and excludes participant-only code', () => {
  const files = new Map(['app/src/main/Host.kt', 'shared/src/main/Tool.kt',
    'participant/src/main/Participant.kt', 'app/build.gradle.kts', 'gradle.properties', 'local.properties']
    .map(name => [name, '/fixture/' + name]));
  assert.deepEqual(developerAndroidSourceInputs(files).map(([name]) => name),
    ['app/src/main/Host.kt', 'shared/src/main/Tool.kt', 'app/build.gradle.kts', 'gradle.properties']);
});

function zip(entries, comment = '') {
  const locals=[], centrals=[];
  let offset=0;
  for(const input of entries) {
    const name=Buffer.from(input.name), data=Buffer.from(input.data||''), compressed=input.deflate?deflateRawSync(data):data;
    const local=Buffer.alloc(30), central=Buffer.alloc(46), extra=Buffer.alloc(input.extra||0);
    const checksum=crc32(data), method=input.deflate?8:0;
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4);
    local.writeUInt16LE(method,8); local.writeUInt32LE(checksum,14);
    local.writeUInt32LE(compressed.length,18); local.writeUInt32LE(data.length,22);
    local.writeUInt16LE(name.length,26); local.writeUInt16LE(extra.length,28);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6);
    central.writeUInt16LE(method,10); central.writeUInt32LE(checksum,16);
    central.writeUInt32LE(compressed.length,20); central.writeUInt32LE(data.length,24);
    central.writeUInt16LE(name.length,28); central.writeUInt32LE(offset,42);
    const part=Buffer.concat([local,name,extra,compressed]);
    locals.push(part); centrals.push(Buffer.concat([central,name])); offset+=part.length;
  }
  const directory=Buffer.concat(centrals), end=Buffer.alloc(22), trailer=Buffer.from(comment);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16); end.writeUInt16LE(trailer.length,20);
  return Buffer.concat([...locals,directory,end,trailer]);
}
function central(bytes) { return bytes.readUInt32LE(bytes.length-22+16); }
const elf = (machine='AArch64', align='0x4000', offset='0x000040', address='0x004040') =>
  'Class: ELF64\nMachine: '+machine+'\n  LOAD '+offset+' '+address+' 0x004040 0x000080 0x000080 R E '+align+'\n';

test('ZIP reads stored and deflated payloads and exact 16KiB native data offset',()=>{
  const name='lib/arm64-v8a/libnonverba_android.so';
  const bytes=zip([{name,data:'native',extra:16384-30-Buffer.byteLength(name)},
    {name:'assets/web/index.html',data:'test '.repeat(100),deflate:true}],'archive comment');
  const records=parseZip(bytes);
  assert.equal(records.get(name).data_offset,16384);
  assert.equal(records.get(name).compression_method,0);
  assert.equal(entryBytes(bytes,records.get(name)).toString(),'native');
  assert.equal(entryBytes(bytes,records.get('assets/web/index.html')).toString(),'test '.repeat(100));
});
test('ZIP permits an APK signing block between local entries and central directory',()=>{
  const bytes=zip([{name:'classes.dex',data:'dex'}]), at=central(bytes), block=Buffer.alloc(64,0xab);
  const changed=Buffer.concat([bytes.subarray(0,at),block,bytes.subarray(at)]);
  changed.writeUInt32LE(at+block.length,changed.length-22+16);
  const record=parseZip(changed).get('classes.dex');
  assert.equal(entryBytes(changed,record).toString(),'dex');
});
test('ZIP rejects duplicate and unsafe entries, including case-varied local review page',()=>{
  assert.throws(()=>parseZip(zip([{name:'a'},{name:'a'}])),/Duplicate/);
  for(const name of ['../a','a/../b','/a','a\\b','a/./b','a//b','a\0b','C:/a','assets/web/Review.HTML']) {
    assert.throws(()=>parseZip(zip([{name}])),/Unsafe|review/);
  }
});
test('ZIP rejects local filename substitution even with an unchanged central directory',()=>{
  const bytes=zip([{name:'same',data:'x'}]); bytes[30]=0x78;
  assert.throws(()=>parseZip(bytes),/name or bounds mismatch/);
});
test('ZIP rejects encrypted and unknown compression methods',()=>{
  for(const [localAt,centralAt,value] of [[6,8,1],[8,10,99]]) {
    const bytes=zip([{name:'a'}]), at=central(bytes);
    bytes.writeUInt16LE(value,localAt); bytes.writeUInt16LE(value,at+centralAt);
    assert.throws(()=>parseZip(bytes),/encrypted\/compressed/);
  }
});
test('ZIP rejects truncated, multidisk, ZIP64 and inconsistent directory bounds',()=>{
  assert.throws(()=>parseZip(Buffer.alloc(21)),/size/);
  for(const mutate of [
    bytes=>bytes.writeUInt16LE(1,bytes.length-22+4),
    bytes=>bytes.writeUInt32LE(0xffffffff,bytes.length-22+16),
    bytes=>bytes.writeUInt16LE(2,bytes.length-22+10),
    bytes=>bytes.writeUInt32LE(1,bytes.length-22+12),
  ]) {
    const bytes=zip([{name:'a'}]); mutate(bytes);
    assert.throws(()=>parseZip(bytes),/ZIP64|bounds/);
  }
});
test('ZIP rejects overlapping storage and oversized expansion before extraction',()=>{
  const nested=zip([{name:'b',data:'y'}]), nestedLocal=nested.subarray(0,central(nested));
  const bytes=zip([{name:'a',data:nestedLocal},{name:'b',data:'y'}]), at=central(bytes), second=at+47;
  // A valid local header for b is nested inside a's stored payload. Both names,
  // sizes and CRCs are valid; only overlapping storage must reject it.
  bytes.writeUInt32LE(31,second+42);
  assert.throws(()=>parseZip(bytes),/Overlapping/);
  const huge=zip([{name:'a',data:'x'}]), hugeAt=central(huge);
  huge.writeUInt32LE(128*1024*1024+1,hugeAt+24);
  assert.throws(()=>parseZip(huge),/entry bounds/);
});
test('ZIP payload damage and deflate corruption cannot survive extraction',()=>{
  const stored=zip([{name:'a',data:'retained'}]), record=parseZip(stored).get('a');
  stored[record.data_offset]^=1;
  assert.throws(()=>entryBytes(stored,record),/CRC/);
  const compressed=zip([{name:'a',data:'z'.repeat(100),deflate:true}]), compressedRecord=parseZip(compressed).get('a');
  compressed[compressedRecord.data_offset]=0xff;
  assert.throws(()=>entryBytes(compressed,compressedRecord));
});
test('ELF checks both actual architectures and every LOAD segment',()=>{
  assert.equal(parseElf(elf(),'arm64-v8a')[0].alignment,'16384');
  assert.equal(parseElf(elf('Advanced Micro Devices X86-64'),'x86_64').length,1);
  assert.throws(()=>parseElf(elf(),'x86_64'),/architecture/);
  assert.throws(()=>parseElf(elf().replace('ELF64','ELF32'),'arm64-v8a'),/ELF64/);
  assert.throws(()=>parseElf('Class: ELF64\nMachine: AArch64','arm64-v8a'),/No ELF/);
  assert.throws(()=>parseElf(elf()+'\nLOAD unreadable','arm64-v8a'),/Unrecognized/);
});
test('ELF rejects 4KiB, non-power-of-two and incongruent LOAD alignment',()=>{
  for(const value of [elf('AArch64','0x1000'),elf('AArch64','0x6000'),elf('AArch64','0x4000','0x80')]) {
    assert.throws(()=>parseElf(value,'arm64-v8a'),/16KiB/);
  }
});
test('JNI verification accepts only defined global functions, never imports or local names',()=>{
  const prefix='Java_org_nonverba_camera_NativeAudioDevice_';
  const text='  1: 000000ff 24 FUNC GLOBAL DEFAULT 12 '+prefix+'open\n'
    +'  2: 00000000 0 FUNC GLOBAL DEFAULT UND '+prefix+'close\n'
    +'  3: 000000ff 24 FUNC LOCAL DEFAULT 12 '+prefix+'play\n'
    +'  4: 000000ff 24 OBJECT GLOBAL DEFAULT 12 '+prefix+'record\n';
  assert.deepEqual([...exportedJni(text)],[prefix+'open']);
});

async function cargoFixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'nonverba-cargo-freshness-'));
  t.after(() => rm(temporary, {recursive:true, force:true}));
  const source = join(temporary, 'snapshot/code'), target = join(temporary, 'target');
  const before = new Date('2026-01-01T00:00:00Z'), built = new Date('2026-01-01T00:01:00Z'), after = new Date('2026-01-01T00:02:00Z');
  const put = async (relative, text = 'synthetic fixture', time = before) => {
    const path = join(source, relative); await mkdir(dirname(path), {recursive:true});
    await writeFile(path, text); await utimes(path, time, time); return path;
  };
  await put('Cargo.toml', '[workspace]\nmembers = ["crates/nonverba-core", "crates/nonverba-android"]\n');
  await put('Cargo.lock');
  for (const name of ['nonverba-core', 'nonverba-android']) {
    await put('crates/' + name + '/Cargo.toml', '[package]\nname = "' + name + '"\nversion = "0.1.0"\n\n[lib]\ncrate-type = ["cdylib"]\n');
  }
  const core = await put('crates/nonverba-core/src/lib.rs');
  const module = await put('crates/nonverba-core/src/nested/module.rs');
  const included = await put('crates/nonverba-core/src/embedded.json');
  const native = await put('crates/nonverba-android/src/lib.rs');
  const wasm = join(target, 'wasm32-unknown-unknown/release/nonverba_core.wasm');
  const android = join(target, 'aarch64-linux-android/release/libnonverba_android.so');
  for (const [artifact, dependencies] of [[wasm, [core, module, included]], [android, [native, core, module, included]]]) {
    await mkdir(dirname(artifact), {recursive:true}); await writeFile(artifact, 'synthetic compiled output');
    await utimes(artifact, built, built);
    await writeFile(artifact.replace(/\.(wasm|so)$/, '.d'), artifact + ': ' + dependencies.join(' ') + '\n');
  }
  const check = async artifact => {
    const report = {freshness_checks:[], current_build_gaps:[]};
    await cargoFreshness(artifact, 'synthetic artifact', report, source); return report;
  };
  return {source, wasm, android, core, module, included, native, put, check, before, after};
}

test('Cargo dep-info accepts exact target dependencies and bounded Make filename escapes', () => {
  const source = '/tmp/snapshot/code', artifact = '/target/nonverba_core.wasm', library = source + '/crates/nonverba-core/src/lib.rs';
  const escaped = source + '/crates/nonverba-core/src/name\\ with\\#hash$$.json';
  assert.deepEqual(parseCargoDepInfo(artifact + ': ' + library + ' ' + escaped + '\n', artifact, source),
    [library, source + '/crates/nonverba-core/src/name with#hash$.json']);
});

test('Cargo dep-info refuses malformed rules, foreign snapshots and undeclared library dependencies', () => {
  const source = '/tmp/snapshot/code', artifact = '/target/nonverba_core.wasm', library = source + '/crates/nonverba-core/src/lib.rs';
  for (const text of ['', '/target/wrong.wasm: ' + library, artifact + ': ', artifact + ': ' + library + '\nextra: rule',
    artifact + ': ' + library + ' ' + library, artifact + ': ' + library + ' relative.rs',
    artifact + ': ' + library.replace('/snapshot/', '/old-snapshot/'),
    artifact + ': ' + library + ' ' + source + '/crates/nonverba-android/src/lib.rs',
    artifact + ': ' + library + ' ' + source + '/crates/nonverba-core/src/../escape.rs',
    artifact + ': ' + library + ' ' + library + '\\q', artifact + ': ' + library + ' $(VARIABLE)',
    artifact + ': ' + library + ' # ignored dependency', artifact + ': ' + library + '\0']) {
    assert.throws(() => parseCargoDepInfo(text, artifact, source), /Cargo dep-info/, text);
  }
});

test('Cargo freshness ignores uncompiled examples, tests and unrelated workspace crates', async t => {
  const f = await cargoFixture(t);
  for (const name of ['crates/nonverba-core/examples/verify_camera_set.rs', 'crates/nonverba-core/tests/integration.rs',
    'crates/nonverba-core/src/cfg_test_only.rs', 'crates/nonverba-cooperation/src/lib.rs', 'crates/nonverba-cooperation/Cargo.toml']) {
    await f.put(name, 'new uncompiled input', f.after);
  }
  assert.deepEqual((await f.check(f.wasm)).current_build_gaps, []);
  assert.deepEqual((await f.check(f.android)).current_build_gaps, []);
  await utimes(f.native, f.after, f.after);
  assert.deepEqual((await f.check(f.wasm)).current_build_gaps, [], 'Android-only input does not stale WASM');
  assert.equal((await f.check(f.android)).current_build_gaps.length, 1, 'Android input still stales JNI');
});

test('actual Rust modules and included non-Rust bytes still stale both library outputs', async t => {
  const f = await cargoFixture(t);
  for (const input of [f.module, f.included]) {
    await utimes(input, f.after, f.after);
    for (const artifact of [f.wasm, f.android]) {
      const report = await f.check(artifact);
      assert.equal(report.current_build_gaps.length, 1);
      assert.equal(report.freshness_checks[0].newest_input.path, input);
      assert.equal(report.freshness_checks[0].newest_input.dependency_info, artifact.replace(/\.(wasm|so)$/, '.d'));
    }
    await utimes(input, f.before, f.before);
  }
});

test('Cargo metadata, toolchain, local configuration and build scripts remain freshness inputs', async t => {
  const f = await cargoFixture(t);
  for (const name of ['Cargo.toml', 'Cargo.lock', 'crates/nonverba-core/Cargo.toml', 'rust-toolchain.toml',
    '.cargo/config.toml', 'crates/nonverba-core/build.rs']) {
    const path = join(f.source, name);
    if (name.endsWith('Cargo.toml') || name === 'Cargo.lock') await utimes(path, f.after, f.after);
    else await f.put(name, 'changed build input', f.after);
    assert.equal((await f.check(f.wasm)).current_build_gaps.length, 1, name);
    await utimes(path, f.before, f.before);
  }
  await f.put('crates/nonverba-core/Cargo.toml', '[package]\nname="nonverba-core"\nbuild = "scripts/custom.rs"\n', f.before);
  const custom = await f.put('crates/nonverba-core/scripts/custom.rs', 'custom build script', f.after);
  assert.equal((await f.check(f.wasm)).freshness_checks[0].newest_input.path, custom);
  await f.put('crates/nonverba-android/Cargo.toml', '[package]\nname="nonverba-android"\n', f.after);
  assert((await cargoFreshnessInputs(f.android, f.source)).paths.includes(join(f.source, 'crates/nonverba-android/Cargo.toml')));
  assert(!(await cargoFreshnessInputs(f.wasm, f.source)).paths.includes(join(f.source, 'crates/nonverba-android/Cargo.toml')));
});

test('Cargo freshness fails closed on missing/stale dep-info, missing inputs and linked files', async t => {
  const f = await cargoFixture(t), dependencyInfo = f.wasm.replace(/\.wasm$/, '.d');
  const original = await readFile(dependencyInfo, 'utf8');
  await rm(dependencyInfo); await assert.rejects(f.check(f.wasm), /ENOENT/);
  await writeFile(dependencyInfo, original.replaceAll(f.source, f.source.replace('/snapshot/', '/old-snapshot/')));
  await assert.rejects(f.check(f.wasm), /outside this snapshot/);
  await writeFile(dependencyInfo, original); await rm(f.included);
  await assert.rejects(f.check(f.wasm), /ENOENT/);
  await symlink(f.module, f.included); await assert.rejects(f.check(f.wasm), /non-linked/);
  await rm(f.included); await f.put('crates/nonverba-core/src/embedded.json');
  await symlink('/missing-config', join(f.source, 'rust-toolchain'));
  await assert.rejects(f.check(f.wasm), /non-linked/);
});
