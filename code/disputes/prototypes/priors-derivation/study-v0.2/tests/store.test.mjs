// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {STUDY_BASE,appendLedger,readLedger,readRows,studyPath,validateStudyRoot,writeRows} from '../lib/store.mjs';

async function fixture(t){const root=join(STUDY_BASE,`test-store-${randomUUID()}`);validateStudyRoot(root);await mkdir(root,{recursive:true});t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function collect(iterator){const rows=[];for await(const row of iterator)rows.push(row);return rows;}

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
