// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile, readdir, rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest, sha256} from '../../lib/common.mjs';
import {STUDY_BASE, writeRows, writeJSON, readJSON} from '../lib/store.mjs';
import {createBatchEmbedder} from '../lib/embedding.mjs';
import {runSensitivity, verifiedParentRepresentation, lexicalFeatures, lexicalVector} from '../lib/sensitivity.mjs';

const container = process.platform==='linux' && process.env.NONVERBA_CONTAINER==='1';
const directory = path.dirname(fileURLToPath(import.meta.url));
const schema = {id:'VARCHAR',contract_id:'VARCHAR',cohort:'VARCHAR',kind:'VARCHAR',payload:'VARCHAR'};

test('context uses at most 60 complete neighboring words inside the actual verified parent',()=>{
  const outside = 'FOREIGN_PARENT_DO_NOT_INCLUDE ';
  const before = Array.from({length:45},(_,i)=>`before${i}`).join(' ');
  const unitText = 'The contractor must retain the specified exception.';
  const after = Array.from({length:40},(_,i)=>`after${i}`).join(' ');
  const parentText = `${before} ${unitText} ${after}`; const normalized = `${outside}${parentText} FOREIGN_AFTER`;
  const unit = {id:'unit',contract_id:'contract',cohort:'discovery-broad',parent_section_id:'parent',heading_path:['Duties'],text:unitText,sha256:sha256(unitText),start:outside.length+before.length+1,end:outside.length+before.length+1+unitText.length};
  const parent = {id:'parent',contract_id:'contract',cohort:'discovery-broad',start:outside.length,end:outside.length+parentText.length,sha256:sha256(parentText)};
  const result = verifiedParentRepresentation(unit,parent,normalized);
  assert.equal(result.primary,`Duties\n${unitText}`); assert.ok(result.contextual.includes(unitText)); assert.equal(result.provenance.before_words,30); assert.equal(result.provenance.after_words,30);
  assert.match(result.contextual,/before15 /); assert.match(result.contextual,/after29$/); assert.doesNotMatch(result.contextual,/FOREIGN|before14 |after30/);
  assert.throws(()=>verifiedParentRepresentation(unit,{...parent,sha256:'a'.repeat(64)},normalized),/Parent text\/hash/);
  assert.throws(()=>verifiedParentRepresentation(unit,{...parent,contract_id:'other'},normalized),/identity\/cohort/);
  assert.throws(()=>verifiedParentRepresentation({...unit,text:'Changed'},parent,normalized),/Unit text\/hash/);
  assert.throws(()=>verifiedParentRepresentation(unit,{...parent,start:unit.start+1},normalized),/does not contain/);
});

test('unused context capacity is redistributed without crossing parent bounds',()=>{
  const text = 'before Alpha must deliver. '+Array.from({length:70},(_,i)=>`word${i}`).join(' ');
  const unitText = 'Alpha must deliver.'; const start = text.indexOf(unitText);
  const unit = {id:'u',contract_id:'c',cohort:'discovery-relevant',parent_section_id:'p',text:unitText,start,end:start+unitText.length,sha256:sha256(unitText)};
  const parent = {id:'p',contract_id:'c',cohort:unit.cohort,start:0,end:text.length,sha256:sha256(text)};
  const result = verifiedParentRepresentation(unit,parent,text); assert.equal(result.provenance.before_words,1); assert.equal(result.provenance.after_words,59); assert.match(result.contextual,/word58$/); assert.doesNotMatch(result.contextual,/word59/);
});

test('lexical control preserves word/bigram signed TF, lowercase equivalence and normalized source signal',()=>{
  const upper = lexicalFeatures('DELIVER quality quality item'); const lower = lexicalFeatures('deliver quality quality item');
  assert.deepEqual(upper.tf,lower.tf); assert.equal(lower.tokens,4); assert.equal(lower.features,6); assert.ok(lower.present.size<=6);
  assert.notDeepEqual(lexicalFeatures('quality deliver').tf,lexicalFeatures('deliver quality').tf);
  const model = {dimensions:2048,idf:Array.from({length:2048},()=>1)}; const vector = lexicalVector('deliver quality quality item',model);
  assert.ok(vector instanceof Float32Array); assert.ok(Math.abs(Math.sqrt(vector.reduce((sum,n)=>sum+n*n,0))-1)<1e-6);
  assert.throws(()=>lexicalVector('! x ?',model),/no nonzero source signal/); assert.throws(()=>lexicalFeatures('a',{dimensions:1024}),/policy is fixed/);
});

async function fixture(t,{reserve=false,missingParent=false,wrongParentHash=false}={}) {
  await mkdir(STUDY_BASE,{recursive:true}); const run = path.join(STUDY_BASE,`sensitivity-test-${randomUUID()}`); await mkdir(run);
  t.after(async()=>{assert.equal(path.dirname(run),STUDY_BASE); assert.match(path.basename(run),/^sensitivity-test-[a-f0-9-]+$/); await rm(run,{recursive:true,force:true});});
  const comparison = JSON.parse(await readFile(path.resolve(directory,'../comparison-recipe.json'),'utf8'));
  const recipe = JSON.parse(await readFile(path.resolve(directory,'../recipe.json'),'utf8'));
  await writeJSON(run,'comparison-plan.json',comparison); await writeJSON(run,'recipe.json',recipe);
  await writeJSON(run,'comparison-model.json',{...comparison.secondModel,status:'DECLARED_SYNTHETIC_TEST_MODEL',directory:'/synthetic/no-execution',files:[],execution_attested:false});
  const units = []; const parents = []; const records = []; const sourceHash = sha256('declared synthetic extraction source');
  for (let c=0;c<6;c++) {
    const contract = `contract-${c}`; const cohort = c%2?'discovery-relevant':'discovery-broad'; const parentId = `parent-${c}`;
    const pieces = Array.from({length:3},(_,i)=>`Party ${c} ${['delivers the specified item','preserves the notice record','performs the quality inspection'][i]} unless the stated exception for item ${i} applies.`);
    const before = 'This synthetic parent contains context that changes the representation without changing its unit facts.';
    const normalized = `${before}\n${pieces.join('\n')}`; const normalizedPath = `normalized/${contract}.txt`;
    await mkdir(path.join(run,'normalized'),{recursive:true}); await writeFile(path.join(run,normalizedPath),normalized);
    records.push({id:contract,normalized_path:normalizedPath,normalized_sha256:sha256(normalized),raw_sha256:sha256(`synthetic raw ${normalized}`)});
    if (!missingParent || c!==5) parents.push({id:parentId,contract_id:contract,cohort,kind:'operative',payload:JSON.stringify({id:parentId,contract_id:contract,cohort,start:0,end:normalized.length,sha256:wrongParentHash&&c===5?'a'.repeat(64):sha256(normalized)})});
    for (let i=0;i<pieces.length;i++) {
      const text = pieces[i]; const start = normalized.indexOf(text); const id = `unit-${c}-${i}`;
      const unitCohort = reserve&&c===5&&i===2?'confirmation':cohort;
      const unit = {id,contract_id:contract,cohort:unitCohort,kind:'operative',heading_path:['Synthetic contract',`Duties ${c}`],text,start,end:start+text.length,sha256:sha256(text),family_id:`family-${id}`,parent_section_id:parentId,normalized_path:normalizedPath,source_url:`https://example.com/synthetic/${contract}`};
      units.push({id,contract_id:contract,cohort:unitCohort,kind:'operative',payload:JSON.stringify(unit)});
    }
  }
  const shards = [await writeRows(run,'admission/units-0.parquet',units.slice(0,9),{schema}),await writeRows(run,'admission/units-1.parquet',units.slice(9),{schema})];
  const sections = [await writeRows(run,'extraction/sections.parquet',parents,{schema})];
  const extraction = await writeJSON(run,'extraction/manifest.json',{schema_version:2,source:{sha256:sourceHash},contract_records:records,authority:'NONE'});
  const admission = {schema_version:2,status:'DECLARED_SYNTHETIC_TEST_ADMISSION',authority:'NONE',adopted_catalog:false,gates:{reserve_accessed:false},
    counts:{representatives:units.length,contracts_admitted:records.length},shards:{units:shards},input:{sections_shards:sections,extraction_manifest_path:extraction.path,extraction_manifest_sha256:extraction.sha256,extraction_source_sha256:sourceHash}};
  return {run,admission,units,records,sourceHash,comparison};
}

function syntheticFactories(f,counter) {
  const make = async(config,second=false)=>{
    const folders = await readdir(path.join(f.run,'sensitivity'));
    let freeze = null;
    for (const folder of folders) {const record = await readJSON(f.run,`sensitivity/${folder}/pre-inference-freeze.json`); if (record.identity.admission_sha256===digest(f.admission)) freeze=record;}
    assert.ok(freeze,'Current admission must have its pre-inference freeze before constructing a runtime');
    assert.equal(freeze.status,'FROZEN_BEFORE_INFERENCE'); const selection = await readJSON(f.run,freeze.selection.path);
    assert.equal(selection.selected_units,18); assert.equal(selection.target_shortage,29982); counter.constructed++;
    const runtime = {model:{repository:config.repository,revision:config.revision,dimensions:384,synthetic_runtime_id:`sensitivity-fixture-${second?'second':'baseline'}`,status:'DECLARED_SYNTHETIC_TEST_ONLY'},
      tokenCount:text=>(text.match(/\S+/gu)||[]).length+2,
      extractBatch:async texts=>{counter.calls++; return texts.map(text=>{const vector = new Array(384).fill(0); const bytes = Buffer.from(sha256(text),'hex'); for(let i=0;i<16;i++) vector[(i*23+(second?7:0))%384]=(bytes[i]-127)/128; return vector;});},dispose:async()=>{counter.disposed++;}};
    return createBatchEmbedder(config,{runtime,log:()=>{}});
  };
  return {log:()=>{},createBaselineEmbedder:config=>make(config),createSecondEmbedder:config=>make(config,true)};
}

test('real Parquet synthetic integration freezes same identities, four arms and source provenance before inference; resume verifies', {skip:!container},async t=>{
  const f = await fixture(t); const counter = {calls:0,constructed:0,disposed:0}; const options = syntheticFactories(f,counter);
  const result = await runSensitivity(f.run,f.admission,options);
  assert.equal(result.status,'DECLARED_SYNTHETIC_COMPARISON_COMPLETED'); assert.equal(result.actual_units,18); assert.equal(result.unit_target,30000); assert.equal(result.target_shortage,29982); assert.equal(result.target_reached,false);
  assert.equal(result.semantic_validity_established,false); assert.equal(result.authority,'NONE'); assert.equal(result.participant_evaluation,'NOT_RUN'); assert.equal(result.reserve_accessed,false); assert.equal(result.quality_gate.status,'NOT_AVAILABLE_PRE_GATE_ENGINEERING_ONLY');
  assert.equal(result.arms.length,4); assert.equal(result.comparisons.length,6); assert.equal(counter.constructed,3); assert.equal(counter.disposed,3); assert.ok(counter.calls>0);
  assert.ok(result.arms.every(arm=>arm.rows===18&&arm.evaluation_sha256===result.common_evaluation_sha256)); assert.equal(new Set(result.arms.map(arm=>arm.training_sha256)).size,1); assert.equal(new Set(result.arms.map(arm=>arm.ordered_units_sha256)).size,1); assert.equal(result.arms.at(-1).dimensions,2048);
  const selection = await readJSON(f.run,result.selection.path); assert.equal(selection.selected_contracts,6); assert.equal(new Set(selection.unit_ids).size,18); assert.equal(selection.training.unit_ids.length,18); assert.equal(selection.exact.unit_ids.length,18);
  assert.equal(new Set(selection.rows.slice(0,6).map(row=>row.contract_id)).size,6);
  const exact = await readJSON(f.run,result.exact_small_comparator.path); assert.equal(exact.subset_count,18); assert.equal(exact.requested_k,64); assert.equal(exact.comparison.common_count,18);
  const inputs = await readJSON(f.run,result.inputs.path); assert.equal(inputs.verified_parent_coverage,1); assert.equal(inputs.rows,18); assert.equal(inputs.source_bindings.length,7);
  const lexical = await readJSON(f.run,result.lexical_model.path); assert.equal(lexical.documents,18); assert.equal(lexical.idf.length,2048); assert.equal(lexical.training_sha256,selection.training.sha256);
  const baseline = await readJSON(f.run,result.arms[0].manifest.path); const contextual = await readJSON(f.run,result.arms[1].manifest.path);
  const baseChunk = await readJSON(f.run,baseline.shards[0].path); const contextChunk = await readJSON(f.run,contextual.shards[0].path); assert.deepEqual(baseChunk.unit_ids,contextChunk.unit_ids); assert.notEqual(baseChunk.input_sha256,contextChunk.input_sha256);
  const calls = counter.calls; assert.deepEqual(await runSensitivity(f.run,f.admission,options),result); assert.equal(counter.calls,calls); assert.equal(counter.constructed,3);
  const vectorFile = path.join(f.run,baseline.shards[0].vectors.path); const bytes = await readFile(vectorFile); bytes[0]^=1; await writeFile(vectorFile,bytes);
  await assert.rejects(runSensitivity(f.run,f.admission,options),/binding changed/); assert.equal(counter.calls,calls);
});

test('cumulative comparison checkpoints reuse verified same-input vector cache across all embedding arms', {skip:!container},async t=>{
  const f = await fixture(t); const counter = {calls:0,constructed:0,disposed:0}; const options = syntheticFactories(f,counter);
  const first = await runSensitivity(f.run,f.admission,options); const calls = counter.calls;
  f.admission = {...f.admission,checkpoint:'declared-synthetic-next-checkpoint'};
  const next = await runSensitivity(f.run,f.admission,options); assert.notEqual(next.manifest_path,first.manifest_path); assert.equal(counter.calls,calls);
  for (const arm of next.arms.filter(arm=>arm.model!=='lexical')) {const manifest = await readJSON(f.run,arm.manifest.path); assert.equal(manifest.cache_stats.new_inference_chunks_this_invocation,0); assert.equal(manifest.cache_stats.retained_chunk_cache_hits,18);}
});

test('reserve admission and missing or corrupt parent contexts fail before any inference', {skip:!container},async t=>{
  for (const flags of [{reserve:true},{missingParent:true},{wrongParentHash:true}]) {
    const f = await fixture(t,flags); const counter = {calls:0,constructed:0,disposed:0};
    await assert.rejects(runSensitivity(f.run,f.admission,syntheticFactories(f,counter)),/Reserve|actual retained parent|Parent text\/hash/); assert.equal(counter.calls,0); assert.equal(counter.constructed,0);
  }
});

test('a changed plan and a failing source-specific gate cannot masquerade as a valid calibration comparison', {skip:!container},async t=>{
  const changed = await fixture(t); await writeFile(path.join(changed.run,'comparison-plan.json'),JSON.stringify({...changed.comparison,unitTarget:18})); const counter = {calls:0,constructed:0,disposed:0};
  await assert.rejects(runSensitivity(changed.run,changed.admission,syntheticFactories(changed,counter)),/frozen source recipe/); assert.equal(counter.constructed,0);
  const failed = await fixture(t); await writeJSON(failed.run,`quality-gates/${failed.sourceHash}/gate.json`,{schema_version:2,status:'CALIBRATION_GATE_PASSED',authority:'NONE',extraction_source_sha256:failed.sourceHash,fresh_audit:{target:100,reviewed:100,adequate:94,unresolved_material_losses:0,review_sha256:'a'.repeat(64)},development_audit_review_sha256:'b'.repeat(64)});
  await assert.rejects(runSensitivity(failed.run,failed.admission,syntheticFactories(failed,counter)),/quality gate is incomplete/); assert.equal(counter.calls,0);
});
