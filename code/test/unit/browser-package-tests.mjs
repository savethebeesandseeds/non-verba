// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {makeArchive,verifyArchive,safeName,releaseReadme,assertBrowserWebAssets} from '../../tools/build/package-web.mjs';
import {GENERATED_CORE_ASSETS} from '../../tools/build/web-assets.mjs';
import {createHash} from 'node:crypto';
import {parseZip} from '../../tools/build/verify-android-package.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const payloads=()=>new Map([['README.txt',Buffer.from('Retained warning text')],['web/dist/pkg/core.wasm',Buffer.from([0,97,115,109])]]);
const expected=p=>new Map([...p].map(([n,b])=>[n,{bytes:b.length,sha256:sha(b)}]));
test('archive roundtrip checks names, sizes, payloads and deterministic metadata',()=>{
 const p=payloads(),a=makeArchive(p);
 assert.deepEqual(makeArchive(new Map([...p].reverse())),a);
 assert.equal(verifyArchive(a,expected(p)).length,2);
 const central=a.readUInt32LE(a.length-6);
 assert.equal(a.readUInt16LE(central+4),0x314);
 assert.equal(a.readUInt32LE(central+38),(0o100644*65536)>>>0);
});
test('changed expected payload, omitted and unexpected entries reject',()=>{
 const p=payloads(),archive=makeArchive(p),altered=payloads();altered.set('README.txt',Buffer.from('changed'));
 assert.throws(()=>verifyArchive(archive,expected(altered)),/differs from expected bytes/);
 p.delete('README.txt');assert.throws(()=>verifyArchive(archive,expected(p)),/file set/);
 p.set('extra',Buffer.from('x'));assert.throws(()=>verifyArchive(archive,expected(p)),/file set/);
});
test('unsafe and local review names cannot enter exports',()=>{
 for(const n of ['web/dist/review.html','web/dist/Review.HTML','../escape','a/../b','a\\b','/absolute','a//b','C:/absolute','a/','a\0b',''])
  assert.throws(()=>safeName(n));
});
test('archive reader independently rejects injected review names',()=>{
 const p=new Map([['web/dist/viewer.html',Buffer.from('x')]]),a=makeArchive(p);
 const corrupted=Buffer.from(a.toString('latin1').replaceAll('viewer.html','review.html'),'latin1');
 assert.throws(()=>verifyArchive(corrupted,expected(p)),/review entry/i);
});
test('duplicate central names are rejected before payload comparison',()=>{
 const p=new Map([['a.txt',Buffer.from('a')],['b.txt',Buffer.from('b')]]),a=makeArchive(p);
 const corrupted=Buffer.from(a.toString('latin1').replaceAll('b.txt','a.txt'),'latin1');
 assert.throws(()=>verifyArchive(corrupted,expected(p)),/Duplicate/);
});
test('compressed payload corruption and local/central disagreement reject',()=>{
 const p=payloads(),a=makeArchive(p),first=[...parseZip(a).values()][0];
 const bad=Buffer.from(a);bad[first.data_offset]^=0xff;
 assert.throws(()=>verifyArchive(bad,expected(p)));
 const mismatch=Buffer.from(a);mismatch.writeUInt32LE(99,14);
 assert.throws(()=>verifyArchive(mismatch,expected(p)),/CRC mismatch/);
});
test('encrypted archive and mismatched names reject',()=>{
 const p=payloads(),a=makeArchive(p),central=a.readUInt32LE(a.length-6);
 const encrypted=Buffer.from(a);encrypted.writeUInt16LE(0x801,central+8);
 assert.throws(()=>verifyArchive(encrypted,expected(p)),/encrypted/);
 const renamed=Buffer.from(a);renamed[30]^=1;
 assert.throws(()=>verifyArchive(renamed,expected(p)),/name or bounds mismatch/);
});
test('truncated files and empty packages reject',()=>{
 const p=payloads(),a=makeArchive(p);
 assert.throws(()=>makeArchive(new Map()),/count/);
 assert.throws(()=>verifyArchive(a.subarray(0,a.length-1),expected(p)));
});
const templatePath=fileURLToPath(new URL('../../tools/build/release-readme.txt',import.meta.url));
test('the plain release template retains evidence-trust and physical-test warnings',async()=>{
 const source=(await readFile(templatePath,'utf8')).replace(/\r\n/g,'\n'),text=releaseReadme(source,'0.7.0').toString();
 assert.ok(text.startsWith('Non-verba camera, audio and location 0.7.0 - development preview\n'));
 for(const warning of ['Pixel watermarks are recovery hints, not authentication.','imported verification does not accept evidence.','Real phone validation remains required.','does not attest camera hardware or scene freshness.'])assert.ok(text.includes(warning),warning);
 assert.ok(!text.includes('{{VERSION}}'));
});
test('changed README grammar and version injection fail',async()=>{
 const source=(await readFile(templatePath,'utf8')).replace(/\r\n/g,'\n');
 assert.throws(()=>releaseReadme(source.replace('development preview','new title'),'0.7.0'));
 assert.throws(()=>releaseReadme(source,'0.7.0; command'));
});

const modelLock=await readFile(new URL('../../models/mobilefacenet/model-lock.json',import.meta.url));
const pinnedModel=JSON.parse(modelLock);
const metadata=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
function browserOutputFixture({model=false}={}){
 const source=new Map([['index.html',Buffer.from('<script src="./app.js"></script>')],['app.js',Buffer.from('export default true;')]]);
 const actual=new Map([...source].map(([name,bytes])=>[name,metadata(bytes)]));
 for(const name of GENERATED_CORE_ASSETS)actual.set(name,metadata(Buffer.from('synthetic '+name)));
 if(model){
  actual.set('face-model/model-lock.json',metadata(modelLock));
  for(const asset of [...Object.values(pinnedModel.browser_assets),...pinnedModel.browser_notices])
   actual.set('face-model/'+asset.file,{bytes:asset.bytes,sha256:asset.sha256});
 }
 return {source,actual};
}

test('browser output closure accepts an absent model or the complete pinned asset and notice declarations',()=>{
 for(const model of [false,true]){
  const f=browserOutputFixture({model});
  assert.doesNotThrow(()=>assertBrowserWebAssets(f.actual,f.source,modelLock));
 }
});

test('browser output closure rejects extra root and nested files independently of extension',()=>{
 for(const name of ['unexpected.txt','old/map.json','old/app.js','pkg/other.json','face-model/extra.json']){
  const f=browserOutputFixture({model:true});f.actual.set(name,metadata(Buffer.from('unreviewed')));
  assert.throws(()=>assertBrowserWebAssets(f.actual,f.source,modelLock),/Unexpected browser output assets/);
 }
});

test('browser output closure rejects every incomplete pinned model tree',()=>{
 const complete=browserOutputFixture({model:true});
 for(const name of [...complete.actual.keys()].filter(name=>name.startsWith('face-model/'))){
  const partial=new Map(complete.actual);partial.delete(name);
  assert.throws(()=>assertBrowserWebAssets(partial,complete.source,modelLock),/Incomplete pinned face-model output/);
 }
 const f=browserOutputFixture();f.actual.set('face-model/model-lock.json',metadata(modelLock));
 assert.throws(()=>assertBrowserWebAssets(f.actual,f.source,modelLock),/Incomplete pinned face-model output/);
});

test('browser output closure rejects altered model, runtime, notices and staged lock metadata',()=>{
 const complete=browserOutputFixture({model:true});
 for(const name of [...complete.actual.keys()].filter(name=>name.startsWith('face-model/'))){
  const changed=new Map(complete.actual);changed.set(name,{...changed.get(name),sha256:'0'.repeat(64)});
  assert.throws(()=>assertBrowserWebAssets(changed,complete.source,modelLock),/differs from current pinned source/);
  const resized=new Map(complete.actual);resized.set(name,{...resized.get(name),bytes:resized.get(name).bytes+1});
  assert.throws(()=>assertBrowserWebAssets(resized,complete.source,modelLock),/differs from current pinned source/);
 }
});

test('browser output closure requires the pinned source lock, current source bytes and all core outputs',()=>{
 const f=browserOutputFixture();
 assert.throws(()=>assertBrowserWebAssets(f.actual,f.source,Buffer.concat([modelLock,Buffer.from('\n')])),/source lock is not pinned/);
 const changed=new Map(f.actual);changed.set('app.js',metadata(Buffer.from('stale source')));
 assert.throws(()=>assertBrowserWebAssets(changed,f.source,modelLock),/differs from current pinned source.*app.js/);
 for(const name of GENERATED_CORE_ASSETS){
  const missing=new Map(f.actual);missing.delete(name);
  assert.throws(()=>assertBrowserWebAssets(missing,f.source,modelLock),/Missing browser output assets/);
 }
});
