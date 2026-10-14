// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {readJSON,sha256} from '../../lib/common.mjs';
import {STUDY_BASE,writeRows} from '../lib/store.mjs';
import {embedStudy,readEmbeddingBatches,discoverStudy,verifyGeometry} from '../lib/analysis.mjs';
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
