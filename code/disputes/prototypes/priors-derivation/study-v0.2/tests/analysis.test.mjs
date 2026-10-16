// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {readJSON,sha256,digest} from '../../lib/common.mjs';
import {STUDY_BASE,writeRows,hashFile,writeJSON,writeExtractionCache} from '../lib/store.mjs';
import {embedStudy,readEmbeddingBatches,discoverStudy,verifyGeometry,createStudyNativeInputLoader} from '../lib/analysis.mjs';
import {extractSections} from '../lib/sections.mjs';
import {storeNativeDecoration} from '../lib/native-decoration-store.mjs';
import {createBatchEmbedder} from '../lib/embedding.mjs';
import {modelInputIdentity} from '../lib/representation.mjs';
async function fixture(cohort='discovery-broad') {
  const run=`${STUDY_BASE}/analysis-test-${randomUUID()}`;await mkdir(run,{recursive:true});
  const recipe={embedding:{dimensions:3,tokenBudget:8192},geometry:{reservoirSize:40,seed:20261013,evaluationSize:12,kValues:[2,3],repeats:2,batchSize:8,iterations:3,primaryK:2,primaryRepeat:1}};
  await writeFile(`${run}/recipe.json`,JSON.stringify(recipe));
  const units=Array.from({length:16},(_,i)=>({id:`unit-${i}`,contract_id:`contract-${i%8}`,cohort,family_id:`family-${i}`,heading_path:['Performance'],text:`Party ${i} must deliver the specified item unless excused.`}));
  const shard=await writeRows(run,'units.parquet',units.map(unit=>({id:unit.id,payload:JSON.stringify(unit)})),{schema:{id:'VARCHAR',payload:'VARCHAR'}});
  return {run,units,admission:{schema_version:2,shards:{units:[shard]}}};
}
function syntheticRuntime(counter) {return async()=>({model:{status:'SYNTHETIC_TEST_ONLY'},window_policy:{status:'SYNTHETIC_TEST_ONLY'},dispose:async()=>{},embedUnits:async units=>{counter.calls++;const vectors=Float32Array.from(units.flatMap((unit,i)=>[1,(i%3)+1,(i%5)+1]));return {packed_vectors:vectors,dimensions:3,inputs:units.map(unit=>({input_sha256:sha256(unit.contextual_text??unit.embedding_text)})),provenance:{status:'SYNTHETIC_TEST_ONLY'}};}});}
test('retained chunk and schedule verify on resume; corrupt vector bytes cannot silently resume',async()=>{
  const f=await fixture();const counter={calls:0};const options={createEmbedder:syntheticRuntime(counter),log:()=>{}};
  const embedded=await embedStudy(f.run,f.admission,options);assert.equal(embedded.rows,16);assert.equal(counter.calls,1);
  const resumed=await embedStudy(f.run,f.admission,options);assert.deepEqual(resumed,embedded);assert.equal(counter.calls,1);
  const geometric=await discoverStudy(f.run,embedded,{log:()=>{}});assert.equal(geometric.runs.length,4);assert.equal(geometric.comparisons.length,6);assert.equal((await verifyGeometry(f.run,geometric)).rows,16);
  assert.deepEqual(await discoverStudy(f.run,embedded,{log:()=>{}}),geometric);
  const vectorPath=`${f.run}/${embedded.shards[0].vectors.path}`;const bytes=await readFile(vectorPath);bytes[0]^=1;await writeFile(vectorPath,bytes);
  await assert.rejects(embedStudy(f.run,f.admission,options),/binding changed/);assert.equal(counter.calls,1);
});
test('reserve rows cannot enter embeddings and omitted shards fail total checks',async()=>{
  const reserve=await fixture('confirmation');await assert.rejects(embedStudy(reserve.run,reserve.admission,{createEmbedder:syntheticRuntime({calls:0}),log:()=>{}}),/Reserve unit/);
  const f=await fixture();const embedded=await embedStudy(f.run,f.admission,{createEmbedder:syntheticRuntime({calls:0}),log:()=>{}});
  await assert.rejects(async()=>{for await(const ignored of readEmbeddingBatches(f.run,{...embedded,shards:[]})){}},/omits rows/);
  const shard=await readJSON(`${f.run}/${embedded.shards[0].path}`);shard.units[1].id=shard.units[0].id;const bytes=Buffer.from(JSON.stringify(shard));await writeFile(`${f.run}/${embedded.shards[0].path}`,bytes);
  const rebound={...embedded,shards:[{...embedded.shards[0],sha256:sha256(bytes)}]};
  await assert.rejects(async()=>{for await(const ignored of readEmbeddingBatches(f.run,rebound)){}},/ordered identities/);
});
test('cumulative admission checkpoints reuse verified chunked input cache',async()=>{
  const f=await fixture();const counter={calls:0};const options={createEmbedder:syntheticRuntime(counter),log:()=>{}};
  const first=await embedStudy(f.run,f.admission,options);assert.equal(counter.calls,1);
  const second=await embedStudy(f.run,{...f.admission,checkpoint:'next'},options);assert.equal(counter.calls,1);assert.notEqual(first.manifest_path,second.manifest_path);
  const batch=await readJSON(`${f.run}/${second.shards[0].path}`);assert.equal(batch.provenance.cache_hits,16);assert.equal(batch.provenance.new_units,0);
});

test('historical canonical-only extraction binding remains explicitly unavailable for native evidence',async()=>{
  const f=await fixture(),sourceBody={parameters:{declared_synthetic_historical:true}},source={...sourceBody,sha256:digest(sourceBody)},extraction={source,contract_records:[]};
  await writeFile(`${f.run}/old-extraction.json`,JSON.stringify(extraction));
  const admission={...f.admission,input:{extraction_manifest_path:'old-extraction.json',extraction_manifest_sha256:digest(extraction),extraction_source_sha256:source.sha256}};
  const prepared=await createStudyNativeInputLoader(f.run,admission)(f.units[0]);assert.equal(modelInputIdentity(prepared).native_evidence_status,'LEGACY_NATIVE_EVIDENCE_UNAVAILABLE');
});

async function nativeFixture() {
  const run=`${STUDY_BASE}/analysis-test-${randomUUID()}`;await mkdir(`${run}/raw`,{recursive:true});
  const files=[];for(const name of ['source-decoration.mjs','sections.mjs'])files.push({path:name,sha256:sha256(await readFile(new URL('../lib/'+name,import.meta.url)))});
  const sourceBody={files,parameters:{declared_synthetic:true}},source={...sourceBody,sha256:digest(sourceBody)};
  const id='synthetic-native-contract',raw='<p>The assigned worker must preserve <strike>old written terms</strike><u>new written terms</u> while the parties inspect the retained source details together.</p>';
  await writeFile(`${run}/raw/${id}.html`,raw);const raw_sha256=sha256(raw),record={id,cohort:'discovery-broad',format:'html',path:`raw/${id}.html`,acquisition:{sha256:raw_sha256,bytes:Buffer.byteLength(raw)},content:raw};
  const cache={...extractSections(record,{minSectionWords:1,maxChunkWords:40,nativeDecorationIdentity:{tracerSourceSHA256:files[0].sha256,collectorSourceSHA256:files[1].sha256}}),raw_sha256,source};
  assert.equal(cache.status,'accepted');assert.equal(cache.native_source_decorations.mapping_status,'EXACT_COLLECTOR_ORIGIN');assert.ok(cache.units.length);
  const stored=await storeNativeDecoration(run,'native.json.gz',cache.native_source_decorations);cache.native_source_decorations=stored.reference;
  const normalized_path='normalized.txt';await writeFile(`${run}/${normalized_path}`,cache.normalized_text);await writeFile(`${run}/cache.json`,JSON.stringify(cache));
  const extraction={source,contract_records:[{id,cohort:record.cohort,status:'accepted',raw_sha256,normalized_path,normalized_sha256:cache.normalized_sha256,native_source_decorations:stored.reference}],cache:[{id,path:'cache.json',...await hashFile(`${run}/cache.json`)}]};
  await writeFile(`${run}/extraction.json`,JSON.stringify(extraction));await writeFile(`${run}/recipe.json`,JSON.stringify({embedding:{dimensions:3,tokenBudget:1024}}));
  const units=cache.units.map(unit=>({...unit,cohort:record.cohort,normalized_path})),shard=await writeRows(run,'units.parquet',units.map(unit=>({id:unit.id,payload:JSON.stringify(unit)})),{schema:{id:'VARCHAR',payload:'VARCHAR'}});
  const admission={schema_version:2,input:{extraction_manifest_path:'extraction.json',extraction_manifest_sha256:digest(extraction),extraction_source_sha256:source.sha256,extraction_manifest_file:await hashFile(`${run}/extraction.json`)},shards:{units:[shard]}};
  return {run,units,admission,raw,extraction,cache};
}

test('main analysis hydrates bound synthetic native sources and persists encoded window evidence',async()=>{
  const f=await nativeFixture(),calls=[];
  const createEmbedder=async config=>createBatchEmbedder({...config,max_tokens:256},{runtime:{model:{synthetic_runtime_id:'native-main-source-only-test'},tokenCount:text=>Array.from(text).length+2,extractBatch:async texts=>{calls.push(...texts);return texts.map(()=>[1,2,3]);}}});
  const result=await embedStudy(f.run,f.admission,{createEmbedder,log:()=>{}}),batch=await readJSON(`${f.run}/${result.shards[0].path}`);
  assert.ok(calls.some(text=>text.includes('"tag":"strike"')));assert.ok(calls.some(text=>text.includes('"tag":"u"')));
  for(const input of batch.inputs){assert.equal(input.native_evidence_status,'BOUND_NATIVE_SOURCE_EVIDENCE');assert.ok(input.native_representation);for(const window of input.windows){assert.ok(window.tokens<=256);assert.ok(window.source_ranges.length);assert.ok(window.source_ranges.every(range=>range.projection_sha256));}}
  const count=calls.length;await embedStudy(f.run,{...f.admission,checkpoint:'second'},{createEmbedder,log:()=>{}});assert.equal(calls.length,count);
});

test('native loader rejects missing refs and raw tampering rather than deriving plain inputs',async()=>{
  const f=await nativeFixture(),prepare=createStudyNativeInputLoader(f.run,f.admission),unit=f.units[0];
  const caption='The assigned worker';unit.source_navigation={scope:'LITERAL_SOURCE_NAVIGATION_ONLY',governing_hierarchy_verified:false,nearest_anchor:{label:caption,start:0,end:caption.length,parts:[{text:caption,start:0,end:caption.length}],scope:'LITERAL_SOURCE_NAVIGATION_ONLY',governing_hierarchy_verified:false},within_unit:[]};
  await assert.rejects(createStudyNativeInputLoader('/nonexistent/no-source-access',{} )({...unit,cohort:'confirmation'}),/Reserve unit/);
  await assert.rejects(createStudyNativeInputLoader(f.run,{...f.admission,input:{...f.admission.input,extraction_manifest_file:null}})(unit),/exact admission extraction manifest file binding/);
  const prepared=await prepare(unit);assert.equal(modelInputIdentity(prepared).native_evidence_status,'BOUND_NATIVE_SOURCE_EVIDENCE');
  assert.equal(prepared.native_input.descriptor.parts.length,1);assert.equal(prepared.native_input.text,unit.text);
  await assert.rejects(prepare(unit,{includeHeading:true}),/forbids heading promotion/);
  const missing={...unit};delete missing.native_source_decorations_ref;await assert.rejects(prepare(missing),/plain fallback forbidden/);
  await writeFile(`${f.run}/raw/synthetic-native-contract.html`,f.raw+' ');
  await assert.rejects(createStudyNativeInputLoader(f.run,f.admission)(unit),/raw source byte binding/);
});

test('native model loader hydrates the exact same source and descriptors from a compressed cache without inference',async()=>{
  const f=await nativeFixture(),legacy=await createStudyNativeInputLoader(f.run,f.admission)(f.units[0]),name='extraction-cache/synthetic-native-contract.json.gz',stored=await writeExtractionCache(f.run,name,f.cache);
  const receipt={id:'synthetic-native-contract',...stored.artifact,storage:stored.storage,result_sha256:digest(f.cache)};await writeJSON(f.run,name+'.manifest.json',receipt);const extraction={...f.extraction,cache:[receipt]};await writeJSON(f.run,'compressed-extraction.json',extraction);
  const admission={...f.admission,input:{...f.admission.input,extraction_manifest_path:'compressed-extraction.json',extraction_manifest_sha256:digest(extraction),extraction_manifest_file:await hashFile(`${f.run}/compressed-extraction.json`)}},compressed=await createStudyNativeInputLoader(f.run,admission)(f.units[0]);
  assert.deepEqual(compressed.native_input.descriptor,legacy.native_input.descriptor);assert.equal(compressed.native_input.text,legacy.native_input.text);assert.deepEqual(modelInputIdentity(compressed),modelInputIdentity(legacy));
});

test('native loader cannot accept a resealed admission for changed method or normalized bytes',async()=>{
  const f=await nativeFixture();await writeFile(`${f.run}/normalized.txt`,f.cache.normalized_text+' ');
  await assert.rejects(createStudyNativeInputLoader(f.run,f.admission)(f.units[0]),/normalized source byte binding/);
  await writeFile(`${f.run}/normalized.txt`,f.cache.normalized_text);
  f.extraction.source.files[0].sha256='c'.repeat(64);const {sha256:ignored,...sourceBody}=f.extraction.source;f.extraction.source.sha256=digest(sourceBody);
  await writeFile(`${f.run}/extraction.json`,JSON.stringify(f.extraction));const admission={...f.admission,input:{...f.admission.input,extraction_manifest_sha256:digest(f.extraction),extraction_source_sha256:f.extraction.source.sha256,extraction_manifest_file:await hashFile(`${f.run}/extraction.json`)}};
  await assert.rejects(createStudyNativeInputLoader(f.run,admission)(f.units[0]),/Current native method differs/);
});
