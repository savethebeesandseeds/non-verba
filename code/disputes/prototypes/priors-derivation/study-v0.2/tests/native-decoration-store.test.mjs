// SPDX-License-Identifier: AGPL-3.0-only
// DECLARED_SYNTHETIC: lossless evidence storage, corruption and budget checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,rm,readFile,writeFile,symlink} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {digest,sha256} from '../../lib/common.mjs';
import {STUDY_BASE} from '../lib/store.mjs';
import {traceNativeDecoration,bindNativeDecoration} from '../lib/source-decoration.mjs';
import {storeNativeDecoration,loadNativeDecoration,MAX_NATIVE_ENVELOPE_BYTES} from '../lib/native-decoration-store.mjs';

function fixture(){const raw='<p><strike>prior</strike><u>later</u></p>',normalizedText='priorlater',trace=traceNativeDecoration(raw);let end=0;return bindNativeDecoration(trace,{raw,normalizedText,tracerSourceSHA256:'a'.repeat(64),collectorSourceSHA256:'b'.repeat(64),collectorSegments:trace.runs.map(run=>{const start=end;end+=run.decoded_text.length;return {normalized_start:start,normalized_end:end,sources:[{run_id:run.id,decoded_start:0,decoded_end:run.decoded_text.length}],normalization:'EXACT_DECODED'};})});}
async function root(t){const value=STUDY_BASE+'/test-native-store-'+randomUUID();await mkdir(value,{recursive:true});t.after(()=>rm(value,{recursive:true,force:true}));return value;}
function reseal(value){const {sha256:ignored,...body}=value;return {...body,sha256:digest(body)};}

test('full native evidence roundtrips exactly once with independently bound compressed and JSON bytes',async t=>{
  const run=await root(t),envelope=fixture(),name='native/synthetic.json.gz';
  const first=await storeNativeDecoration(run,name,envelope),again=await storeNativeDecoration(run,name,envelope);
  assert.equal(first.resumed,false);assert.equal(again.resumed,true);assert.equal(again.added_bytes,0);assert.deepEqual(again.reference,first.reference);
  assert.deepEqual(await loadNativeDecoration(run,first.reference),envelope);assert.deepEqual(await loadNativeDecoration(run,envelope),envelope);
  const packed=await readFile(run+'/'+name);assert.equal(sha256(packed),first.reference.artifact.sha256);assert.equal(first.reference.uncompressed_bytes,Buffer.byteLength(JSON.stringify(envelope)));assert.equal(Object.hasOwn(first.reference,'trace'),false);
  assert.equal(envelope.trace.sources.length,2);assert.ok(JSON.stringify(first.reference).length<2048);
});

test('immutable and concurrent native writers reuse identical bytes and refuse changed evidence',async t=>{
  const run=await root(t),envelope=fixture(),name='native/concurrent.json.gz';
  const [a,b]=await Promise.all([storeNativeDecoration(run,name,envelope),storeNativeDecoration(run,name,envelope)]);assert.deepEqual(a.reference,b.reference);
  const changed=reseal({...envelope,note:'different evidence'});await assert.rejects(storeNativeDecoration(run,name,changed),/already differs/);
  assert.deepEqual(await loadNativeDecoration(run,a.reference),envelope);
});

test('compressed corruption, reference tampering and cross-source relabeling cannot load',async t=>{
  const run=await root(t),{reference}=await storeNativeDecoration(run,'native/corrupt.json.gz',fixture());
  await assert.rejects(loadNativeDecoration(run,{...reference,normalized_sha256:'c'.repeat(64)}),/reference digest/);
  await assert.rejects(loadNativeDecoration(run,reseal({...reference,normalized_sha256:'c'.repeat(64)})),/source binding/);
  await assert.rejects(loadNativeDecoration(run,reseal({...reference,envelope_sha256:'d'.repeat(64)})),/source binding/);
  const path=run+'/'+reference.artifact.path,bytes=await readFile(path);bytes[bytes.length-9]^=1;await writeFile(path,bytes);
  await assert.rejects(loadNativeDecoration(run,reference),/compressed digest/);
});

test('output-bound verification rejects a compressed expansion before accepting JSON evidence',async t=>{
  const run=await root(t),{reference}=await storeNativeDecoration(run,'native/expansion.json.gz',fixture()),expanded=gzipSync(Buffer.from('x'.repeat(20000)));
  await writeFile(run+'/'+reference.artifact.path,expanded);
  const forged=reseal({...reference,uncompressed_bytes:100,artifact:{...reference.artifact,bytes:expanded.length,sha256:sha256(expanded)}});
  await assert.rejects(loadNativeDecoration(run,forged),error=>/buffer|length|size|large/i.test(error.message));
  await assert.rejects(loadNativeDecoration(run,reseal({...reference,uncompressed_bytes:MAX_NATIVE_ENVELOPE_BYTES+1})),/bound differs/);
});

test('storage budgets, source seals and linked destinations fail without replacing data',async t=>{
  const run=await root(t),envelope=fixture();
  await assert.rejects(storeNativeDecoration(run,'native/too-small.json.gz',envelope,{remainingBytes:1}),/remaining study storage budget/);
  await assert.rejects(storeNativeDecoration(run,'native/invalid.json.gz',{...envelope,policy:'changed'}),/digest differs/);
  const good=await storeNativeDecoration(run,'native/kept.json.gz',envelope);await symlink(run+'/native/kept.json.gz',run+'/native/link.json.gz');
  await assert.rejects(storeNativeDecoration(run,'native/link.json.gz',envelope),/Linked study path/);
  await assert.rejects(loadNativeDecoration(run,reseal({...good.reference,artifact:{...good.reference.artifact,path:'native/link.json.gz'}})),/Linked study path/);
  assert.deepEqual(await loadNativeDecoration(run,good.reference),envelope);
});

test('missing method identities remain explicit unbound evidence through lossless storage',async t=>{
  const run=await root(t),raw='<u>pending</u>',normalizedText='pending',trace=traceNativeDecoration(raw),envelope=bindNativeDecoration(trace,{raw,normalizedText,collectorSegments:[{normalized_start:0,normalized_end:7,sources:[{run_id:trace.runs[0].id,decoded_start:0,decoded_end:7}],normalization:'EXACT_DECODED'}]});
  const {reference}=await storeNativeDecoration(run,'native/unbound.json.gz',envelope);assert.equal(reference.tracer_source_sha256,null);assert.equal(reference.collector_source_sha256,null);assert.equal(reference.method_identity_status,'UNBOUND_MISSING_CURRENT_METHOD_IDENTITIES');assert.notEqual(reference.mapping_status,'EXACT_COLLECTOR_ORIGIN');assert.deepEqual(await loadNativeDecoration(run,reference),envelope);
  const forged=reseal({...reference,mapping_status:'EXACT_COLLECTOR_ORIGIN'});await assert.rejects(loadNativeDecoration(run,forged),/method scope/);
});
