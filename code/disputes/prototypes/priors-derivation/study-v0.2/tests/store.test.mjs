// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fsPromises,{mkdir,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {dirname,join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {digest,sha256} from '../../lib/common.mjs';
import {STUDY_BASE,appendLedger,directoryBytes,readJSON,readLedger,readRows,studyPath,validateStudyRoot,writeJSON,writeRows,writeExtractionCache,MAX_EXTRACTION_CACHE_ENCODED_BYTES,MAX_EXTRACTION_CACHE_DECODED_BYTES} from '../lib/store.mjs';
import {atomicJSON} from '../lib/workflow.mjs';

async function fixture(t){const root=join(STUDY_BASE,`test-store-${randomUUID()}`);validateStudyRoot(root);await mkdir(root,{recursive:true});t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function collect(iterator){const rows=[];for await(const row of iterator)rows.push(row);return rows;}

async function compressedFixture(root,value={nested:{native:{marks:['u','strike'],unknown_style:'arbitrary complete literal fixture'},origins:[{start:2,end:9}],empty:[]}}){
  const name=`extraction-cache/${randomUUID()}.json.gz`,stored=await writeExtractionCache(root,name,value),receipt={...stored.artifact,storage:stored.storage,result_sha256:digest(value)};
  await writeJSON(root,name+'.manifest.json',receipt);return {name,stored,receipt,value};
}
async function arbitraryCompressed(root,plain,{encoded=gzipSync(plain),...override}={}){
  const name=`extraction-cache/${randomUUID()}.json.gz`;await mkdir(join(root,'extraction-cache'),{recursive:true});await writeFile(join(root,name),encoded);
  const receipt={path:name,bytes:encoded.length,sha256:sha256(encoded),result_sha256:digest({}),storage:{schema:'lossless-gzip-extraction-cache-v1',encoding:'gzip',serializer:'UTF8_JSON_STRINGIFY_PRETTY_2_FINAL_LF_V1',decoded_bytes:plain.length,decoded_sha256:sha256(plain)},...override};
  await writeJSON(root,name+'.manifest.json',receipt);return {name,receipt};
}

test('new gzip caches preserve exact full former JSON bytes and both independent byte bindings',async t=>{
  const root=await fixture(t),f=await compressedFixture(root),original=Buffer.from(JSON.stringify(f.value,null,2)+'\n'),encoded=await readFile(join(root,f.name));
  assert.deepEqual(gunzipSync(encoded),original);assert.equal(f.stored.storage.decoded_sha256,sha256(original));assert.equal(f.stored.storage.decoded_bytes,original.length);assert.equal(f.stored.artifact.sha256,sha256(encoded));
  assert.deepEqual(await readJSON(root,f.name),f.value);await writeJSON(root,'legacy.json',f.value);assert.deepEqual(await readJSON(root,'legacy.json'),f.value);
  const again=await writeExtractionCache(root,f.name,f.value,{remainingBytes:0});assert.equal(again.resumed,true);assert.equal(again.added_bytes,0);assert.deepEqual(again.artifact,f.stored.artifact);
  await assert.rejects(writeExtractionCache(root,f.name,{different:true}),/binding|differs/);assert.deepEqual(await readJSON(root,f.name),f.value);
});

test('gzip cache bounds refuse metadata before touching an absent encoded payload',async t=>{
  const root=await fixture(t),name='extraction-cache/absent.json.gz',base={path:name,bytes:32,sha256:'a'.repeat(64),result_sha256:digest({}),storage:{schema:'lossless-gzip-extraction-cache-v1',encoding:'gzip',serializer:'UTF8_JSON_STRINGIFY_PRETTY_2_FINAL_LF_V1',decoded_bytes:3,decoded_sha256:'b'.repeat(64)}};
  for(const [id,change,bound]of [['encoded',r=>{r.bytes=MAX_EXTRACTION_CACHE_ENCODED_BYTES+1;},1024],['decoded',r=>{r.storage.decoded_bytes=MAX_EXTRACTION_CACHE_DECODED_BYTES+1;},128*1024**2],['caller',r=>{r.storage.decoded_bytes=200;},100]]){
    const ref=structuredClone(base);change(ref);ref.path=`extraction-cache/${id}.json.gz`;await writeJSON(root,ref.path+'.manifest.json',ref);await assert.rejects(readJSON(root,ref.path,{maxBytes:bound}),/receipt binding or decoded bound/);
  }
  const oversized='extraction-cache/oversized-sidecar.json.gz';await mkdir(join(root,'extraction-cache'),{recursive:true});await writeFile(join(root,oversized+'.manifest.json'),' '.repeat(65537));await assert.rejects(readJSON(root,oversized),/file exceeds its bound/);
  await assert.rejects(readJSON(root,name,{maxBytes:NaN}),/positive byte bound/);await assert.rejects(readJSON(root,'unrelated.json.gz'),/Only explicit extraction caches/);
});

test('compressed caches reject expansion bombs, truncated/CRC-invalid gzip and malformed UTF8/JSON',async t=>{
  const root=await fixture(t),bomb=Buffer.alloc(1024*1024,97),bombReceipt={schema:'lossless-gzip-extraction-cache-v1',encoding:'gzip',serializer:'UTF8_JSON_STRINGIFY_PRETTY_2_FINAL_LF_V1',decoded_bytes:32,decoded_sha256:sha256(bomb)};
  const b=await arbitraryCompressed(root,bomb,{storage:bombReceipt});await assert.rejects(readJSON(root,b.name),/larger than|buffer|length|size/i);
  const good=Buffer.from('{}\n'),compressed=gzipSync(good),crc=Buffer.from(compressed);crc[crc.length-5]^=1;
  for(const encoded of [compressed.subarray(0,compressed.length-4),crc,Buffer.from('not gzip')]){const f=await arbitraryCompressed(root,good,{encoded});await assert.rejects(readJSON(root,f.name));}
  for(const plain of [Buffer.from([123,34,120,34,58,34,255,34,125,10]),Buffer.from('{"x":'),Buffer.from('{"x":1,"x":2}\n'),Buffer.from('{ }\n'),Buffer.from('{}\ntrailing')]){const f=await arbitraryCompressed(root,plain);await assert.rejects(readJSON(root,f.name));}
});

test('every gzip encoded/decoded/content binding is enforced without trusting a plausible sidecar',async t=>{
  const root=await fixture(t);for(const mutate of [r=>r.sha256='f'.repeat(64),r=>r.bytes++,r=>r.storage.decoded_sha256='f'.repeat(64),r=>r.storage.decoded_bytes++,r=>r.result_sha256='f'.repeat(64),r=>r.storage.serializer='LOSSY_UNKNOWN',r=>r.path='extraction-cache/other.json.gz']){
    const f=await compressedFixture(root);mutate(f.receipt);await writeFile(join(root,f.name+'.manifest.json'),JSON.stringify(f.receipt));await assert.rejects(readJSON(root,f.name));
  }
});

test('encoded stat bounds and nonregular files reject before reading or allocating the declared payload',async t=>{
  const root=await fixture(t),f=await compressedFixture(root),handle=await fsPromises.open(join(root,f.name),'r+');await handle.truncate(MAX_EXTRACTION_CACHE_ENCODED_BYTES+1);await handle.close();await assert.rejects(readJSON(root,f.name),/file exceeds its bound/);
  const directory=await compressedFixture(root);await rm(join(root,directory.name));await mkdir(join(root,directory.name));await assert.rejects(readJSON(root,directory.name),/file exceeds its bound/);
  await assert.rejects(writeExtractionCache(root,'extraction-cache/decoded-too-large.json.gz',{metadata:'x'.repeat(MAX_EXTRACTION_CACHE_DECODED_BYTES)}),/explicit decoded bound/);
});

test('gzip cache files, receipts and parents refuse symlinks while immutable races retain one exact artifact',async t=>{
  const root=await fixture(t);for(const component of ['payload','sidecar']){const f=await compressedFixture(root),target=component==='payload'?f.name:f.name+'.manifest.json',saved=join(root,'saved-'+randomUUID());await writeFile(saved,await readFile(join(root,target)));await rm(join(root,target));await symlink(saved,join(root,target));await assert.rejects(readJSON(root,f.name),/Linked/);}
  await mkdir(join(root,'owned-target'));await symlink(join(root,'owned-target'),join(root,'extraction-cache','linked'));await assert.rejects(writeExtractionCache(root,'extraction-cache/linked/test.json.gz',{}),/Linked/);
  const name='extraction-cache/race.json.gz',outcomes=await Promise.all([writeExtractionCache(root,name,{same:true}),writeExtractionCache(root,name,{same:true})]);assert.equal(outcomes.filter(r=>!r.resumed).length,1);assert.deepEqual(outcomes[0].artifact,outcomes[1].artifact);
  const missing='extraction-cache/budget.json.gz';await assert.rejects(writeExtractionCache(root,missing,{body:'retained'},{remainingBytes:0}),/remaining study storage budget/);await assert.rejects(readFile(join(root,missing)),{code:'ENOENT'});
});

test('bounded gzip FileHandle reads reject a real length change after stat without unbounded allocation',async t=>{
  const root=await fixture(t),f=await compressedFixture(root),originalOpen=fsPromises.open;let grew=false;
  t.mock.method(fsPromises,'open',async(path,...args)=>{const handle=await originalOpen(path,...args);if(path===join(root,f.name)){const originalStat=handle.stat.bind(handle);handle.stat=async()=>{const info=await originalStat();if(!grew){grew=true;await writeFile(path,Buffer.concat([await readFile(path),Buffer.from('extra')]));}return info;};}return handle;});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  await assert.rejects(readJSON(root,f.name),/changed length during bounded read/);assert.equal(grew,true);
});

test('typed Parquet shards round-trip payloads in stable bounded pages',async t=>{
  const root=await fixture(t);const rows=Array.from({length:13},(_,i)=>({id:`row-${i}`,contract_id:'synthetic-contract',cohort:'discovery-broad',kind:'synthetic',payload:JSON.stringify({value:i,nested:[true,'literal <script> text']})}));
  const schema={id:'VARCHAR',contract_id:'VARCHAR',cohort:'VARCHAR',kind:'VARCHAR',payload:'VARCHAR'};
  const shard=await writeRows(root,'data/rows.parquet',rows,{schema});assert.equal(shard.rows,13);assert.ok(shard.bytes>0);assert.equal(shard.sha256.length,64);
  assert.deepEqual(await collect(readRows(root,shard.path,{batchSize:3})),rows);
  await assert.rejects(writeRows(root,shard.path,rows,{schema}),/immutable/);
});

test('JSON columns preserve variable metadata and explicit empty schemas remain readable',async t=>{
  const root=await fixture(t);const rows=[{id:'a',metadata:{flag:true,count:2}},{id:'b',metadata:{flag:null,notes:['declared synthetic']}}];
  await writeRows(root,'metadata.parquet',rows,{schema:{id:'VARCHAR',metadata:'JSON'}});
  assert.deepEqual(await collect(readRows(root,'metadata.parquet')),rows);
  await writeRows(root,'empty.parquet',[],{schema:{id:'VARCHAR'}});
  assert.deepEqual(await collect(readRows(root,'empty.parquet')),[]);
});

test('storage rejects traversal, linked parents, invalid schema and oversized shards',async t=>{
  const root=await fixture(t);await assert.rejects(studyPath(root,'../escape'),/relative child/);
  await symlink('/tmp',join(root,'linked'));await assert.rejects(studyPath(root,'linked/escape.json',{missing:true}),/Linked/);
  await assert.rejects(writeRows(root,'bad.parquet',[{id:'a'}],{schema:{id:'VARCHAR); DROP TABLE x'}}),/SQL type/);
  // Remove only this test's own link so the quota walker can inspect its other data.
  await rm(join(root,'linked'));
  await assert.rejects(writeRows(root,'bounded.parquet',[{id:'a'},{id:'b'}],{schema:{id:'VARCHAR'},maxRows:1}),/budget exceeded/);
});

test('append-only ledger preserves ordered events and detects modified event bytes',async t=>{
  const root=await fixture(t);await appendLedger(root,{kind:'synthetic-start',id:'a'});const second=await appendLedger(root,{kind:'synthetic-finish',id:'a'});
  assert.deepEqual((await collect(readLedger(root))).map(row=>row.kind),['synthetic-start','synthetic-finish']);
  const path=join(root,second.path);const value=JSON.parse(await readFile(path,'utf8'));value.kind='invented-finish';await writeFile(path,JSON.stringify(value));
  await assert.rejects(collect(readLedger(root)),/digest mismatch/);
});

test('competing writers cannot replace the same committed Parquet shard',async t=>{
  const root=await fixture(t);const schema={id:'VARCHAR'};
  const outcomes=await Promise.allSettled([writeRows(root,'shared.parquet',[{id:'left'}],{schema}),writeRows(root,'shared.parquet',[{id:'right'}],{schema})]);
  assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);assert.equal(outcomes.filter(row=>row.status==='rejected').length,1);
  const saved=await collect(readRows(root,'shared.parquet'));assert.equal(saved.length,1);assert.ok(['left','right'].includes(saved[0].id));
});

function interceptEnumeration(t,action){
  const original=fsPromises.readdir;
  t.mock.method(fsPromises,'readdir',async(path,options)=>{const entries=await original(path,options);await action(path,entries);return entries;});
  syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
}

test('a quota scan tolerates an actual atomic workflow commit during enumeration',async t=>{
  const root=await fixture(t),destination=join(root,'checkpoint.json');
  await writeFile(join(root,'retained.txt'),'retained');
  let transfer,releaseWrite,started;
  const ready=new Promise(resolve=>{started=resolve;});
  const release=new Promise(resolve=>{releaseWrite=resolve;});
  const original=fsPromises.writeFile;
  t.mock.method(fsPromises,'writeFile',async(path,...options)=>{
    const result=await original(path,...options);
    if(typeof path==='string'&&path.startsWith(`${destination}.`)){transfer=path;started();await release;}
    return result;
  });
  syncBuiltinESMExports();
  t.after(()=>{releaseWrite();t.mock.restoreAll();syncBuiltinESMExports();});
  const writer=atomicJSON(destination,{declared:'synthetic'});
  await ready;
  let committed=false;
  interceptEnumeration(t,async directory=>{
    if(directory===root&&!committed){committed=true;releaseWrite();await writer;}
  });
  assert.equal(await directoryBytes(root),Buffer.byteLength('retained'));
  assert.equal(committed,true);
  assert.equal(JSON.parse(await readFile(destination,'utf8')).declared,'synthetic');
  await assert.rejects(readFile(transfer),{code:'ENOENT'});
});

for(const [kind,transfer]of [
  ['JSON',`checkpoint.json.${randomUUID()}.partial`],
  ['row input',`partials/rows-${randomUUID()}.ndjson`],
  ['Parquet',`partials/rows-${randomUUID()}.parquet`],
  ['raw source',`raw-partials/synthetic-source-${randomUUID()}.partial`]
])test(`storage accounting tolerates a committed ${kind} transfer removed after enumeration`,async t=>{
  const root=await fixture(t),temporary=join(root,transfer),committed=join(root,'committed.json');
  await mkdir(dirname(temporary),{recursive:true});await writeFile(temporary,'declared synthetic transfer');await writeFile(committed,'retained');
  let removed=false;interceptEnumeration(t,async directory=>{if(directory===dirname(temporary)&&!removed){await rm(temporary);removed=true;}});
  assert.equal(await directoryBytes(root),Buffer.byteLength('retained'));assert.equal(removed,true);
  assert.equal(await readFile(committed,'utf8'),'retained');
});

test('storage accounting reports a permanent artifact removed after enumeration',async t=>{
  const root=await fixture(t),committed=join(root,'committed.parquet');await writeFile(committed,'declared synthetic committed bytes');
  interceptEnumeration(t,async directory=>{if(directory===root)await rm(committed);});
  await assert.rejects(directoryBytes(root),{code:'ENOENT'});
});

test('storage accounting does not treat an arbitrary partials child as a transfer',async t=>{
  const root=await fixture(t),directory=join(root,'partials'),committed=join(directory,'retained-record.json');await mkdir(directory);await writeFile(committed,'retained');
  interceptEnumeration(t,async current=>{if(current===directory)await rm(committed);});
  await assert.rejects(directoryBytes(root),{code:'ENOENT'});
});

test('storage accounting rejects a file replaced by a symlink after enumeration',async t=>{
  const root=await fixture(t),child=join(root,'artifact.json');await writeFile(child,'retained');
  interceptEnumeration(t,async directory=>{if(directory===root){await rm(child);await symlink('/etc/hostname',child);}});
  await assert.rejects(directoryBytes(root),/Linked study artifact refused/);
});

test('storage accounting preserves non-ENOENT failures on transfer files',async t=>{
  const root=await fixture(t),temporary=join(root,`checkpoint.json.${randomUUID()}.partial`);await writeFile(temporary,'retained transfer');
  const original=fsPromises.lstat;
  t.mock.method(fsPromises,'lstat',async(path,...options)=>{if(path===temporary)throw Object.assign(new Error('declared synthetic denied access'),{code:'EACCES'});return original(path,...options);});
  syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  await assert.rejects(directoryBytes(root),{code:'EACCES'});
  assert.equal(await readFile(temporary,'utf8'),'retained transfer');
});

test('committed JSON and Parquet destinations cannot impersonate removable transfers',async t=>{
  const root=await fixture(t);
  await assert.rejects(studyPath(root,'committed.json',{missing:true,transfer:true}),/canonical transfer filename/);
  for(const name of [
    `checkpoint.json.${randomUUID()}.partial`,
    `partials/rows-${randomUUID()}.ndjson`,
    `partials/rows-${randomUUID()}.parquet`,
    `raw-partials/synthetic-source-${randomUUID()}.partial`
  ]){
    await assert.rejects(studyPath(root,name,{missing:true}),/reserved transfer filename/);
    await assert.rejects(writeJSON(root,name,{declared:'synthetic'}),/reserved transfer filename/);
    await assert.rejects(readFile(join(root,name)),{code:'ENOENT'});
  }
  const name=`partials/rows-${randomUUID()}.parquet`;
  await assert.rejects(writeRows(root,name,[{id:'synthetic'}],{schema:{id:'VARCHAR'}}),/reserved transfer filename/);
  await assert.rejects(readFile(join(root,name)),{code:'ENOENT'});
  assert.equal(await directoryBytes(root),0);
});
