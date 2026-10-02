// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {parseZip, entryBytes, parseElf, exportedJni, crc32} from '../tools/verify-android-package.mjs';

assert.equal(process.platform, 'linux', 'Run tests only inside non-verba-dev.');
assert.equal(process.env.NONVERBA_CONTAINER, '1', 'Run tests only inside non-verba-dev.');

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
