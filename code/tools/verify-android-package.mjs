#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Container-only APK inspection. Never builds Cargo/Gradle, signs, installs,
// contacts ADB, replaces an artifact, or changes an existing report.
// Usage (inside dev.sh's environment):
// node tools/verify-android-package.mjs --apk /workspace/code/artifacts/container-builds/<UTC>/nonverba-debug.apk
// Overall passed=true requires package_checks_passed AND current_linux_build_verified.
// Missing Linux Rust/WASM output is a reported gap, never a freshness exemption.
// Each run writes a unique QA report and retained inspection copies only.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash, randomBytes} from 'node:crypto';
import {readFile, writeFile, mkdir, readdir, stat, access} from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectReleaseNotices} from './release-notices.mjs';

const execute = promisify(execFile);
const codeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const insist = (condition, message) => { if (!condition) throw new Error(message); };
const utf8 = new TextDecoder('utf-8', {fatal:true});
const MAX_APK = 512 * 1024 * 1024;
const MAX_ENTRY = 128 * 1024 * 1024;
const crcTable = Array.from({length:256}, (_, index) => {
  let n = index;
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes) {
  let n = 0xffffffff;
  for (const value of bytes) n = crcTable[(n ^ value) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}

// Inspect central and local ZIP records; APK signing blocks may precede the
// central directory. ZIP64, multidisk, encryption, duplicate/unsafe names and
// overlapping entry storage are deliberately unsupported.
export function parseZip(bytes) {
  insist(Buffer.isBuffer(bytes) && bytes.length >= 22 && bytes.length <= MAX_APK, 'Unsupported APK ZIP size.');
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) { end = at; break; }
  }
  insist(end >= 0, 'APK ZIP end record not found.');
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  insist(!bytes.readUInt16LE(end + 4) && !bytes.readUInt16LE(end + 6)
    && bytes.readUInt16LE(end + 8) === count && count > 0 && count <= 10000
    && size !== 0xffffffff && start !== 0xffffffff && start + size === end, 'Unsupported ZIP64, multidisk or central directory bounds.');
  const records = new Map(), ranges = [];
  let at = start, total = 0;
  for (let index = 0; index < count; index++) {
    insist(at + 46 <= end && bytes.readUInt32LE(at) === 0x02014b50, 'Invalid APK central directory.');
    const flags = bytes.readUInt16LE(at + 8), method = bytes.readUInt16LE(at + 10);
    const compressed = bytes.readUInt32LE(at + 20), length = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28), extra = bytes.readUInt16LE(at + 30), comment = bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42), next = at + 46 + nameLength + extra + comment;
    insist(next <= end && nameLength > 0 && !bytes.readUInt16LE(at + 34)
      && compressed !== 0xffffffff && length <= MAX_ENTRY && local !== 0xffffffff, 'Unsupported ZIP entry bounds.');
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength), name = utf8.decode(nameBytes);
    insist(!name.includes('\\') && !name.startsWith('/') && !/[\0-\x1f\x7f]/.test(name)
      && !name.split('/').some(part => part === '..' || part === '.') && !name.includes('//')
      && !/^[A-Za-z]:/.test(name), 'Unsafe APK entry name: ' + name);
    insist(!records.has(name), 'Duplicate APK entry: ' + name);
    insist(basename(name).toLowerCase() !== 'review.html', 'Local review entry present in APK: ' + name);
    insist((flags & 0x41) === 0 && [0, 8].includes(method), 'Unsupported encrypted/compressed APK entry: ' + name);
    insist(local + 30 <= start && bytes.readUInt32LE(local) === 0x04034b50
      && bytes.readUInt16LE(local + 6) === flags && bytes.readUInt16LE(local + 8) === method, 'Invalid APK local header: ' + name);
    const localNameLength = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28);
    const dataOffset = local + 30 + localNameLength + localExtra;
    insist(localNameLength === nameLength && dataOffset <= start
      && bytes.subarray(local + 30, local + 30 + localNameLength).equals(nameBytes)
      && dataOffset + compressed <= start, 'APK local/central name or bounds mismatch: ' + name);
    const crc = bytes.readUInt32LE(at + 16);
    if (!(flags & 8)) insist(bytes.readUInt32LE(local + 14) === crc
      && bytes.readUInt32LE(local + 18) === compressed && bytes.readUInt32LE(local + 22) === length, 'APK local/central sizes or CRC mismatch: ' + name);
    insist(method !== 0 || compressed === length, 'Invalid stored entry size: ' + name);
    total += length;
    insist(total <= 1024 * 1024 * 1024, 'APK expanded size exceeds inspection bound.');
    records.set(name, {name, compression_method:method, data_offset:dataOffset, compressed_bytes:compressed, bytes:length, crc32:crc});
    ranges.push([local, dataOffset + compressed]);
    at = next;
  }
  insist(at === end, 'APK central directory count/size mismatch.');
  ranges.sort((a,b) => a[0] - b[0]);
  for (let index = 1; index < ranges.length; index++) insist(ranges[index][0] >= ranges[index - 1][1], 'Overlapping APK entries.');
  return records;
}
export function entryBytes(apk, record) {
  const compressed = apk.subarray(record.data_offset, record.data_offset + record.compressed_bytes);
  const data = record.compression_method === 0 ? compressed : inflateRawSync(compressed, {maxOutputLength:Math.max(1, record.bytes)});
  insist(data.length === record.bytes && crc32(data) === record.crc32, 'APK entry length/CRC mismatch: ' + record.name);
  return data;
}
export function parseElf(text, abi) {
  insist(/Class:\s+ELF64/.test(text), 'Native library is not ELF64.');
  insist(abi === 'arm64-v8a' ? /Machine:\s+AArch64/.test(text) : abi === 'x86_64' && /Machine:.*[Xx]86-64/.test(text), 'ELF architecture differs from APK ABI.');
  const loads = text.split(/\r?\n/).filter(line => /^\s*LOAD\b/.test(line));
  insist(loads.length > 0, 'No ELF LOAD segments found.');
  return loads.map(line => {
    const fields = /^\s*LOAD\s+(0x[\da-f]+)\s+(0x[\da-f]+)\s+(0x[\da-f]+)\s+(0x[\da-f]+)\s+(0x[\da-f]+)\s+(.+?)\s+(0x[\da-f]+)\s*$/i.exec(line);
    insist(fields, 'Unrecognized ELF LOAD segment.');
    const offset = BigInt(fields[1]), virtual = BigInt(fields[2]), alignment = BigInt(fields[7]);
    insist(alignment >= 16384n && (alignment & (alignment - 1n)) === 0n
      && offset % alignment === virtual % alignment, 'ELF LOAD segment does not support 16KiB pages.');
    return {offset:offset.toString(), virtual_address:virtual.toString(), alignment:alignment.toString()};
  });
}
export function exportedJni(text) {
  return new Set([...text.matchAll(/^\s*\d+:\s+[\da-f]+\s+\d+\s+FUNC\s+GLOBAL\s+DEFAULT\s+(?!UND\b)\S+\s+(Java_org_nonverba_camera_\w+)\s*$/gmi)].map(match => match[1]));
}
async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function fileHash(path) { return sha256(await readFile(path)); }
async function run(executable, args, report) {
  const result = await execute(executable, args, {encoding:'utf8', timeout:60000, maxBuffer:16*1024*1024});
  const text = result.stdout + (result.stderr ? '\n' + result.stderr : '');
  if (report) report.push({executable, arguments:args, output:text.trim()});
  return text;
}
async function files(root, skip = () => false, prefix = '') {
  const result = new Map();
  for (const item of await readdir(join(root, prefix), {withFileTypes:true})) {
    const relative = prefix ? prefix + '/' + item.name : item.name;
    if (skip(relative, item)) continue;
    insist(!item.isSymbolicLink(), 'Symlink unsupported in verification inputs: ' + join(root, relative));
    if (item.isDirectory()) {
      for (const [name, path] of await files(root, skip, relative)) result.set(name, path);
    } else if (item.isFile()) result.set(relative, join(root, relative));
    else throw new Error('Unsupported verification input: ' + relative);
  }
  return result;
}
function sameNames(expected, actual, label) {
  const a = [...expected].sort(), b = [...actual].sort();
  insist(JSON.stringify(a) === JSON.stringify(b), label + ' file set differs: missing=[' + a.filter(x => !b.includes(x)).join(',') + '], extra=[' + b.filter(x => !a.includes(x)).join(',') + ']');
}
async function newest(paths) {
  let latest;
  for (const path of paths) {
    const info = await stat(path);
    if (!latest || info.mtimeMs > latest.modified_ms) latest = {path, modified_ms:info.mtimeMs, modified_utc:info.mtime.toISOString()};
  }
  insist(latest, 'No source inputs for freshness comparison.');
  return latest;
}
async function freshness(path, input, label, report) {
  const info = await stat(path), passed = info.mtimeMs >= input.modified_ms;
  const record = {label, artifact:path, artifact_modified_utc:info.mtime.toISOString(), newest_input:input, passed};
  report.freshness_checks.push(record);
  if (!passed) report.current_build_gaps.push(label + ' is older than current input ' + input.path);
}
async function main() {
  insist(process.platform === 'linux' && process.env.NONVERBA_CONTAINER === '1' && await exists('/.dockerenv'),
    'Run only inside managed non-verba-dev via code/dev.ps1; host execution is prohibited.');
  const options = {}, args = process.argv.slice(2);
  while (args.length) {
    const name = args.shift();
    insist(['--apk', '--baseline-report'].includes(name) && args.length && !options[name],
      'Usage: node tools/verify-android-package.mjs [--apk PATH] [--baseline-report PATH]');
    options[name] = args.shift();
  }
  const buildRoot = '/opt/nonverba-build/android', targetRoot = '/opt/nonverba-build/target';
  const androidRoot = join(codeRoot, 'android'), webRoot = resolve(codeRoot, '../web/dist');
  const toolsRoot = '/opt/nonverba-tools', sdk = join(toolsRoot, 'android-sdk');
  const buildTools = join(sdk, 'build-tools/36.0.0'), ndk = join(sdk, 'ndk/30.0.16248370');
  const llvm = join(ndk, 'toolchains/llvm/prebuilt/linux-x86_64'), java = join(toolsRoot, 'jdk/bin/java');
  const apkPath = resolve(options['--apk'] || join(buildRoot, 'app/build/outputs/apk/debug/app-debug.apk'));
  const baselinePath = resolve(options['--baseline-report'] || join(codeRoot, 'artifacts/qa/android-0.3.0-package-verification.json'));
  const expectedVersion = JSON.parse(await readFile(join(codeRoot, 'package.json'), 'utf8')).version;
  const gradle = await readFile(join(androidRoot, 'app/build.gradle.kts'), 'utf8');
  const expectedCode = Number(/\bversionCode\s*=\s*(\d+)/.exec(gradle)?.[1]);
  insist(/^\d+\.\d+\.\d+$/.test(expectedVersion) && Number.isSafeInteger(expectedCode) && expectedCode > 0
    && /\bversionName\s*=\s*"([^"]+)"/.exec(gradle)?.[1] === expectedVersion, 'Expected source package versions disagree.');
  const runId = 'android-' + expectedVersion + '-linux-package-verification-' + new Date().toISOString().replace(/[:.]/g,'-') + '-' + randomBytes(4).toString('hex');
  const reportPath = join(codeRoot, 'artifacts/qa', runId + '.json'), inspection = join(codeRoot, 'artifacts/qa', runId + '-files');
  await mkdir(inspection, {recursive:true});
  const report = {schema_version:2, checked_at_utc:new Date().toISOString(), passed:false,
    package_checks_passed:false, current_linux_build_verified:false, device_tested:false, sensor_tests_run:false,
    apk:apkPath, expected_version:expectedVersion, expected_version_code:expectedCode, report_path:reportPath,
    inspection_directory:inspection, toolchain:{sdk_build_tools:'36.0.0', ndk:'30.0.16248370', java},
    source_freshness_basis:'Exact comparison against current staged/web/native Linux outputs plus local input modification times. Not reproducible-build or hardware attestation.',
    limitations:['No device, sensor or attestation-chain validation.', 'Source time checks cannot prove build provenance or reproducibility.'],
    assets:[], native_libraries:[], freshness_checks:[], current_build_gaps:[], errors:[], tool_results:[]};
  try {
    insist(/^Pkg\.Revision\s*=\s*36\.0\.0\s*$/m.test(await readFile(join(buildTools,'source.properties'),'utf8')), 'Unexpected build-tools version.');
    insist(/^Pkg\.Revision\s*=\s*30\.0\.16248370\s*$/m.test(await readFile(join(ndk,'source.properties'),'utf8')), 'Unexpected NDK version.');
    insist(/^JAVA_VERSION="17\./m.test(await readFile(join(toolsRoot,'jdk/release'),'utf8')), 'JDK17 is required.');
    const apkInfo = await stat(apkPath);
    insist(apkInfo.size <= MAX_APK, 'APK too large for bounded inspection.');
    const apk = await readFile(apkPath);
    report.bytes = apk.length; report.sha256 = sha256(apk);
    const records = parseZip(apk);
    const signature = await run(java, ['-jar',join(buildTools,'lib/apksigner.jar'),'verify','--verbose','--print-certs',apkPath], report.tool_results);
    insist(/^Number of signers: 1\r?$/m.test(signature), 'Expected one APK signer.');
    const signer = /^Signer #1 certificate SHA-256 digest: ([\da-f]{64})\r?$/mi.exec(signature)?.[1].toLowerCase();
    const baseline = JSON.parse(await readFile(baselinePath,'utf8'));
    insist(signer && /^[\da-f]{64}$/.test(baseline.signing_certificate_sha256), 'Missing valid package signer baseline.');
    insist(signer === baseline.signing_certificate_sha256, 'APK signing identity differs from retained previous release.');
    report.signature_verified = true; report.same_signer_as_previous = true; report.baseline_report = baselinePath;
    report.signing_certificate_sha256 = signer;
    const badging = await run(join(buildTools,'aapt'), ['dump','badging',apkPath], report.tool_results);
    const metadata = /^package: name='org\.nonverba\.camera' versionCode='(\d+)' versionName='([^']+)'/m.exec(badging);
    insist(metadata && Number(metadata[1]) === expectedCode && metadata[2] === expectedVersion, 'APK version/package does not match current source.');
    insist(/^sdkVersion:'26'\r?$/m.test(badging) && /^targetSdkVersion:'36'\r?$/m.test(badging), 'Unexpected minimum/target API.');
    const abis = ['arm64-v8a','x86_64'];
    sameNames(abis, [...(/^native-code:(.+)$/m.exec(badging)?.[1] || '').matchAll(/'([^']+)'/g)].map(m=>m[1]), 'APK ABI');
    report.version = metadata[2]; report.version_code = Number(metadata[1]); report.min_sdk = 26; report.target_sdk = 36;
    await run(join(buildTools,'zipalign'), ['-c','-P','16','-v','4',apkPath], report.tool_results);
    report.zip_16k_alignment = true;

    const web = await files(webRoot, relative => basename(relative).toLowerCase() === 'review.html');
    const stageRoots = [join(androidRoot,'app/src/main/assets/web'), join(buildRoot,'app/src/main/assets/web')];
    const stages = await Promise.all(stageRoots.map(root=>files(root)));
    insist(web.size > 0 && [...web.keys()].some(name=>name.endsWith('.wasm')), 'Shared WASM assets missing.');
    for (let index=0; index<stages.length; index++) sameNames(web.keys(),stages[index].keys(),'Staged web assets '+stageRoots[index]);
    const apkAssets = [...records.values()].filter(item=>item.name.startsWith('assets/web/')&&!item.name.endsWith('/'));
    sameNames(web.keys(),apkAssets.map(item=>item.name.slice(11)),'APK web assets');
    for (const item of apkAssets) {
      const name=item.name.slice(11), digest=sha256(entryBytes(apk,item));
      insist(digest===await fileHash(web.get(name)), 'APK web asset differs from web/dist: '+name);
      for (const staged of stages) insist(digest===await fileHash(staged.get(name)), 'Staged web asset differs: '+name);
      report.assets.push({path:name, bytes:item.bytes, sha256:digest, matches_web_dist:true, matches_both_staging_trees:true});
    }
    report.asset_count=report.assets.length; report.review_entry_excluded=true;
    const notices=await collectReleaseNotices();
    for(const [name,data] of notices) {
      const record=records.get('assets/nonverba-license/'+name);
      insist(record&&sha256(entryBytes(apk,record))===sha256(data),'APK license/source notice differs from current source: '+name);
      for(const assetsRoot of [join(androidRoot,'app/src/main/assets'),join(buildRoot,'app/src/main/assets')]) {
        insist(await fileHash(join(assetsRoot,'nonverba-license',name))===sha256(data),'Staged license/source notice differs: '+name);
      }
    }
    report.license_source_notices_verified=true; report.notice_count=notices.size;
    const webSource=await files(resolve(codeRoot,'../web/src'));
    for(const [name,path] of webSource) if(!name.includes('/')&&/\.(html|css|js)$/.test(name)) {
      if(!web.has(name)||await fileHash(path)!==await fileHash(web.get(name))) report.current_build_gaps.push('web/dist differs from current web/src: '+name);
    }
    const ignored=new Set(['.toolchain','.gradle','.kotlin','.cxx','build']);
    const androidFiles=await files(androidRoot,(relative,item)=>item.isDirectory()&&(ignored.has(item.name)||['app/src/main/assets','app/src/main/jniLibs'].includes(relative)));
    const sourceInputs=[...androidFiles].filter(([name])=>name!=='local.properties' && (name.startsWith('app/src/')||/\.(gradle\.kts|properties)$/.test(name)));
    insist(!sourceInputs.some(([name])=>name.endsWith('.java')), 'Project Java source files found.');
    report.project_java_source_files=0;
    for(const [name,path] of sourceInputs) {
      const staged=join(buildRoot,name);
      if(!await exists(staged)||await fileHash(path)!==await fileHash(staged)) report.current_build_gaps.push('Linux Android staging differs from current source: '+name);
    }
    await freshness(apkPath,await newest([...sourceInputs.map(([,p])=>p),...web.values(),...stages.flatMap(map=>[...map.values()])]),'APK',report);
    const crateFiles=await files(join(codeRoot,'crates'));
    const rustInputs=[join(codeRoot,'Cargo.toml'),join(codeRoot,'Cargo.lock'),...[...crateFiles].filter(([name])=>name.endsWith('.rs')||basename(name)==='Cargo.toml').map(([,path])=>path)];
    const latestRust=await newest(rustInputs);
    const cppFiles=await files(join(androidRoot,'app/src/main/cpp'));
    const latestCpp=await newest(cppFiles.values());
    const rustJni=new Set();
    for(const [name,path] of crateFiles) if(name.startsWith('nonverba-android/src/')&&name.endsWith('.rs')) {
      for(const m of (await readFile(path,'utf8')).matchAll(/\bfn\s+(Java_org_nonverba_camera_\w+)\s*\(/g)) rustJni.add(m[1]);
    }
    const cppJni=new Set();
    for(const [name,path] of cppFiles) if(/\.(cpp|h|hpp)$/.test(name)) {
      for(const m of (await readFile(path,'utf8')).matchAll(/\b(Java_org_nonverba_camera_\w+)\s*\(/g)) cppJni.add(m[1]);
    }
    insist(rustJni.size>0&&cppJni.size>0,'Current JNI source definitions were not found.');
    const libraries=[...records.values()].filter(item=>item.name.startsWith('lib/')&&!item.name.endsWith('/'));
    for(const abi of abis) for(const name of ['libnonverba_android.so','libnonverba_audio.so']) insist(records.has('lib/'+abi+'/'+name),'Missing native library: '+abi+'/'+name);
    for(const item of libraries) {
      const parts=item.name.split('/'), abi=parts[1], name=parts[2];
      insist(parts.length===3 && abis.includes(abi) && ['libnonverba_android.so','libnonverba_audio.so','libc++_shared.so'].includes(name),'Unexpected native entry: '+item.name);
      insist(item.compression_method===0&&item.data_offset%16384===0,'Native library is compressed or not ZIP16K aligned: '+item.name);
      const destination=join(inspection,abi,name);
      await mkdir(dirname(destination),{recursive:true}); await writeFile(destination,entryBytes(apk,item),{flag:'wx'});
      const digest=await fileHash(destination), triple=abi==='arm64-v8a'?'aarch64-linux-android':'x86_64-linux-android';
      const record={path:item.name,bytes:item.bytes,sha256:digest,zip_data_offset:item.data_offset,zip_16k_aligned:true,matches_current_linux_build:false};
      let current;
      if(name==='libnonverba_android.so') {
        const stagedPaths=[join(androidRoot,'app/src/main/jniLibs',abi,name),join(buildRoot,'app/src/main/jniLibs',abi,name)];
        insist(await fileHash(stagedPaths[0])===await fileHash(stagedPaths[1]),'Rust staging trees differ: '+abi);
        record.staged_input=stagedPaths[0]; record.staged_input_sha256=await fileHash(stagedPaths[0]);
        current=join(targetRoot,triple,'release',name);
        if(!await exists(current)) { report.current_build_gaps.push('No current Linux Rust output: '+current); current=null; }
        else insist(await fileHash(current)===record.staged_input_sha256,'Staged Rust differs from current Linux output: '+abi);
      } else if(name==='libnonverba_audio.so') {
        const candidates=[...(await files(join(buildRoot,'app/build/intermediates/cxx/Debug'))).values()].filter(path=>basename(path)===name&&basename(dirname(path))===abi);
        insist(candidates.length>0,'No current Linux AAudio output for '+abi);
        current=(await newest(candidates)).path;
      } else current=join(llvm,'sysroot/usr/lib',triple,name);
      const comparison=current||record.staged_input;
      record.comparison_source=comparison; record.comparison_source_sha256=await fileHash(comparison);
      record.comparison_normalization='none';
      if(digest!==record.comparison_source_sha256) {
        const normalized=join(inspection,abi,'comparison-stripped-'+name);
        await run(join(llvm,'bin/llvm-strip'),['--strip-unneeded','-o',normalized,comparison]);
        insist(digest===await fileHash(normalized),'APK native bytes differ from comparison output, including AGP stripping: '+item.name);
        record.comparison_normalization='llvm-strip --strip-unneeded';
      }
      record.matches_comparison_source=true; record.matches_current_linux_build=!!current;
      if(current&&name!=='libc++_shared.so') await freshness(current,name==='libnonverba_android.so'?latestRust:latestCpp,item.name,report);
      const headers=await run(join(llvm,'bin/llvm-readelf'),['--file-header','--program-headers','--wide',destination]);
      record.load_segments=parseElf(headers,abi); record.elf_16k_aligned=true;
      const required=name==='libnonverba_android.so'?rustJni:name==='libnonverba_audio.so'?cppJni:new Set();
      const symbols=required.size?exportedJni(await run(join(llvm,'bin/llvm-readelf'),['--dyn-syms','--wide',destination])):new Set();
      for(const symbol of required) insist(symbols.has(symbol),'Missing defined current JNI export: '+abi+' '+symbol);
      record.checked_jni_symbols=[...required].sort();
      const dynamic=await run(join(llvm,'bin/llvm-readelf'),['--dynamic','--wide',destination]);
      if(/\(NEEDED\).*\[libc\+\+_shared\.so\]/.test(dynamic)) insist(records.has('lib/'+abi+'/libc++_shared.so'),'C++ runtime missing for '+abi);
      report.native_libraries.push(record);
    }
    // wasm-bindgen is a deterministic packaging step here, not a Cargo build.
    // Regenerate only in this unique inspection directory from an existing Linux
    // output, then compare the generated assets instead of inferring freshness.
    const wasm=join(targetRoot,'wasm32-unknown-unknown/release/nonverba_core.wasm');
    if(await exists(wasm)) {
      const reference=join(inspection,'wasm-reference'); await mkdir(reference);
      await run(join(toolsRoot,'wasm-bindgen/wasm-bindgen'),['--target','web','--out-dir',reference,'--out-name','nonverba_core',wasm]);
      const generated=await files(reference), packaged=[...web.keys()].filter(name=>name.startsWith('pkg/')).map(name=>name.slice(4));
      sameNames(generated.keys(),packaged,'Generated Linux WASM assets');
      for(const [name,path] of generated) insist(await fileHash(path)===await fileHash(web.get('pkg/'+name)),'WASM assets differ from current Linux output: '+name);
      await freshness(wasm,latestRust,'Linux WASM output',report);
      report.wasm_matches_current_linux_output=true;
    } else { report.wasm_matches_current_linux_output=false; report.current_build_gaps.push('No current Linux WASM output: '+wasm); }
    insist(await fileHash(apkPath)===report.sha256,'APK changed during verification; rerun after packaging finishes.');
    report.package_checks_passed=true;
    report.current_linux_build_verified=report.current_build_gaps.length===0;
    report.passed=report.package_checks_passed&&report.current_linux_build_verified;
  } catch(error) { report.errors.push(String(error.message)); }
  await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({passed:report.passed,package_checks_passed:report.package_checks_passed,
    current_linux_build_verified:report.current_linux_build_verified,report:reportPath,apk:apkPath,sha256:report.sha256,
    errors:report.errors,current_build_gaps:report.current_build_gaps},null,2));
  process.exitCode=report.passed?0:1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
