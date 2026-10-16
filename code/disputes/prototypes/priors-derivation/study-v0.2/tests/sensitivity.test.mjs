// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile, readdir, rm, stat,utimes} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest, sha256} from '../../lib/common.mjs';
import {STUDY_BASE, writeRows, writeJSON, readJSON,readRows,hashFile} from '../lib/store.mjs';
import {createBatchEmbedder,createPinnedTokenCounter} from '../lib/embedding.mjs';
import {runSensitivity, verifiedParentRepresentation, lexicalFeatures, lexicalVector,prepareSensitivityInput,sensitivityLexicalInput,verifyFullSensitivityGate,createSensitivitySourceGuard} from '../lib/sensitivity.mjs';
import {modelInputIdentity} from '../lib/representation.mjs';
import {createStudyNativeInputLoader} from '../lib/analysis.mjs';
import {traceNativeDecoration,bindNativeDecoration,NATIVE_DECORATION_POLICY} from '../lib/source-decoration.mjs';
import {NATIVE_COLLECTOR_POLICY} from '../lib/sections.mjs';
import {storeNativeDecoration} from '../lib/native-decoration-store.mjs';
import {extractionSourceIdentity} from '../lib/workflow.mjs';
import {sealQualityGate} from '../lib/quality.mjs';
import {qualityFixture,registerSyntheticSourceIssue} from './helpers/quality-fixture.mjs';
import {resolveObservedSourceIssue} from '../lib/source-issues.mjs';

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

async function fixture(t,{reserve=false,missingParent=false,wrongParentHash=false,native=false}={}) {
  await mkdir(STUDY_BASE,{recursive:true}); const run = path.join(STUDY_BASE,`sensitivity-test-${randomUUID()}`); await mkdir(run);
  t.after(async()=>{assert.equal(path.dirname(run),STUDY_BASE); assert.match(path.basename(run),/^sensitivity-test-[a-f0-9-]+$/); await rm(run,{recursive:true,force:true});});
  const comparison = JSON.parse(await readFile(path.resolve(directory,'../comparison-recipe.json'),'utf8'));
  const recipe = JSON.parse(await readFile(path.resolve(directory,'../recipe.json'),'utf8'));
  await writeJSON(run,'comparison-plan.json',comparison); await writeJSON(run,'recipe.json',recipe);
  await writeJSON(run,'comparison-model.json',{...comparison.secondModel,status:'DECLARED_SYNTHETIC_TEST_MODEL',directory:'/synthetic/no-execution',files:[],execution_attested:false});
  const units = []; const parents = []; const records = [];const caches=[];const source=native?await extractionSourceIdentity(recipe):{sha256:sha256('declared synthetic extraction source')}; const sourceHash = source.sha256;
  for (let c=0;c<6;c++) {
    const contract = `contract-${c}`; const cohort = c%2?'discovery-relevant':'discovery-broad'; const parentId = `parent-${c}`;
    const pieces = Array.from({length:3},(_,i)=>`Party ${c} ${['delivers the specified item','preserves the notice record','performs the quality inspection'][i]} unless the stated exception for item ${i} applies.`);
    const before = 'This synthetic parent contains context that changes the representation without changing its unit facts.';
    const normalized = `${before}\n${pieces.join('\n')}`; const normalizedPath = `normalized/${contract}.txt`;
    await mkdir(path.join(run,'normalized'),{recursive:true}); await writeFile(path.join(run,normalizedPath),normalized);
    records.push({id:contract,normalized_path:normalizedPath,normalized_sha256:sha256(normalized),raw_sha256:sha256(`synthetic raw ${normalized}`)});
    const parent={id:parentId,contract_id:contract,cohort,start:0,end:normalized.length,sha256:wrongParentHash&&c===5?'a'.repeat(64):sha256(normalized)};
    if (!missingParent || c!==5) parents.push({id:parentId,contract_id:contract,cohort,kind:'operative',payload:JSON.stringify(parent)});
    let envelope=null,ref=null,rawPath=null,raw=null;const cachedUnits=[];
    if(native){
      raw='<u>'+normalized.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</u>';await mkdir(path.join(run,'raw'),{recursive:true});rawPath=path.join(run,'raw',`${contract}.html`);await writeFile(rawPath,raw);
      const trace=traceNativeDecoration(raw),run0=trace.runs[0];envelope=bindNativeDecoration(trace,{raw,normalizedText:normalized,tracerSourceSHA256:source.files.find(f=>f.path==='source-decoration.mjs').sha256,collectorSourceSHA256:source.files.find(f=>f.path==='sections.mjs').sha256,collectorSegments:[{normalized_start:0,normalized_end:normalized.length,sources:[{run_id:run0.id,decoded_start:0,decoded_end:normalized.length}],normalization:'EXACT_DECODED'}]});
      ref=(await storeNativeDecoration(run,`native/${contract}.json.gz`,envelope)).reference;records.at(-1).raw_sha256=sha256(raw);records.at(-1).native_source_decorations=ref;records.at(-1).status='accepted';
    }
    for (let i=0;i<pieces.length;i++) {
      const text = pieces[i]; const start = normalized.indexOf(text); const id = `unit-${c}-${i}`;
      const unitCohort = reserve&&c===5&&i===2?'confirmation':cohort;
      const unit = {id,contract_id:contract,cohort:unitCohort,kind:'operative',heading_path:['Synthetic contract',`Duties ${c}`],text,start,end:start+text.length,sha256:sha256(text),family_id:`family-${id}`,parent_section_id:parentId,normalized_path:normalizedPath,source_url:`https://example.com/synthetic/${contract}`};
      if(envelope){unit.source_navigation={scope:'LITERAL_SOURCE_NAVIGATION_ONLY',governing_hierarchy_verified:false,nearest_anchor:{label:before,start:0,end:before.length,parts:[{text:before,start:0,end:before.length}],scope:'LITERAL_SOURCE_NAVIGATION_ONLY',governing_hierarchy_verified:false},within_unit:[]};unit.native_source_decorations_ref={envelope_sha256:envelope.sha256,raw_sha256:envelope.raw.sha256,normalized_sha256:envelope.normalized.sha256,tracer_source_sha256:envelope.tracer_source_sha256,collector_source_sha256:envelope.collector_source_sha256,policy:NATIVE_DECORATION_POLICY,collector_policy:NATIVE_COLLECTOR_POLICY,start:unit.start,end:unit.end,mapping_status:envelope.mapping_status,input_eligibility:envelope.input_eligibility,projection_required:true};cachedUnits.push(unit);}
      units.push({id,contract_id:contract,cohort:unitCohort,kind:'operative',payload:JSON.stringify(unit)});
    }
    if(envelope){const cache=await writeJSON(run,`cache/${contract}.json`,{contract:{id:contract,cohort,raw_path:rawPath,path:`raw/${contract}.html`,acquisition:{sha256:sha256(raw),bytes:Buffer.byteLength(raw)}},raw_sha256:sha256(raw),source,normalized_text:normalized,normalized_sha256:sha256(normalized),native_source_decorations:ref,sections:[{...parent,units:cachedUnits}],units:cachedUnits});caches.push({id:contract,...cache});}
  }
  const shards = [await writeRows(run,'admission/units-0.parquet',units.slice(0,9),{schema}),await writeRows(run,'admission/units-1.parquet',units.slice(9),{schema})];
  const sections = [await writeRows(run,'extraction/sections.parquet',parents,{schema})];
  const extractionBody={schema_version:2,source,contract_records:records,cache:caches,authority:'NONE'},extraction = await writeJSON(run,'extraction/manifest.json',extractionBody);
  const admission = {schema_version:2,status:'DECLARED_SYNTHETIC_TEST_ADMISSION',authority:'NONE',adopted_catalog:false,gates:{reserve_accessed:false},
    counts:{representatives:units.length,contracts_admitted:records.length},shards:{units:shards},input:{sections_shards:sections,extraction_manifest_path:extraction.path,extraction_manifest_sha256:native?digest(extractionBody):extraction.sha256,extraction_source_sha256:sourceHash,...(native?{extraction_manifest_file:extraction}:{})}};
  return {run,admission,units,records,sourceHash,comparison};
}

function syntheticFactories(f,counter,{tokenCount=null}={}) {
  const make = async(config,second=false)=>{
    const folders = await readdir(path.join(f.run,'sensitivity'));
    let freeze = null;
    for (const folder of folders) {const record = await readJSON(f.run,`sensitivity/${folder}/pre-inference-freeze.json`); if (record.identity.admission_sha256===digest(f.admission)) freeze=record;}
    assert.ok(freeze,'Current admission must have its pre-inference freeze before constructing a runtime');
    assert.equal(freeze.status,'FROZEN_BEFORE_INFERENCE'); const selection = await readJSON(f.run,freeze.selection.path);
    assert.equal(selection.selected_units,18); assert.equal(selection.target_shortage,29982); counter.constructed++;
    const runtime = {model:{repository:config.repository,revision:config.revision,dimensions:384,synthetic_runtime_id:`sensitivity-fixture-${second?'second':'baseline'}`,status:'DECLARED_SYNTHETIC_TEST_ONLY'},
      tokenCount:tokenCount??(text=>(text.match(/\S+/gu)||[]).length+2),
      extractBatch:async texts=>{counter.calls++; return texts.map(text=>{const vector = new Array(384).fill(0); const bytes = Buffer.from(sha256(text),'hex'); for(let i=0;i<16;i++) vector[(i*23+(second?7:0))%384]=(bytes[i]-127)/128; return vector;});},dispose:async()=>{counter.disposed++;}};
    return createBatchEmbedder(config,{runtime,log:()=>{}});
  };
  return {log:()=>{},createBaselineEmbedder:config=>make(config),createSecondEmbedder:config=>make(config,true)};
}

test('all four native arms retain authenticated descriptors and encode lexical marks with bounded source memory',{skip:!container},async t=>{
  const f=await fixture(t,{native:true}),counter={calls:0,constructed:0,disposed:0},options=syntheticFactories(f,counter),result=await runSensitivity(f.run,f.admission,options);
  assert.equal(result.status,'DECLARED_SYNTHETIC_COMPARISON_COMPLETED');assert.equal(result.actual_units,18);assert.equal(result.arms.length,4);assert.match(result.identity.policy.native_memory,/one current source unit/);
  assert.deepEqual(result.arms.map(arm=>arm.representation),['unit-source-span','verified-parent-context-source-span','unit-source-span','unit-source-span']);assert.match(result.identity.policy.arm_identifiers,/compatibility identifiers/);
  const inputs=await readJSON(f.run,result.inputs.path);assert.match(inputs.status,/NATIVE_DESCRIPTORS_FROZEN/);
  for(const arm of result.arms){const manifest=await readJSON(f.run,arm.manifest.path);for(const item of manifest.shards){const batch=await readJSON(f.run,item.path);assert.equal(batch.new_units,batch.rows);assert.ok(batch.inputs.every(input=>input.native_evidence_status==='BOUND_NATIVE_SOURCE_EVIDENCE'));if(arm.model==='lexical'){assert.ok(batch.inputs.every(input=>input.windows.length>0&&input.encoded_sha256&&input.tokenizer_policy_sha256));}else{assert.ok(batch.inputs.every(input=>input.native_representation?.envelope_sha256&&input.windows.every(w=>w.tokens<=256)));}}}
  const firstShard=inputs.shards[0];let first;for await(const row of readRows(f.run,firstShard.path)){first=JSON.parse(row.payload);break;}
  assert.equal(first.primary,first.source_text);assert.equal(first.native.primary.descriptor.parts.length,1);assert.equal(first.native.contextual.descriptor.parts.length,1);assert.equal(first.native.primary.descriptor.parts[0].role,'unit_body');assert.equal(first.native.contextual.descriptor.parts[0].role,'verified_parent_context');assert.ok(first.native.source_unit.source_navigation.nearest_anchor,'Navigation remains retained metadata');
  const prepare=createStudyNativeInputLoader(f.run,f.admission),tokenCounter=await createPinnedTokenCounter(),actual=sensitivityLexicalInput(await prepareSensitivityInput(first,{representation:'unit-source-span'},prepare),tokenCounter);
  assert.ok(!actual.text.includes('This synthetic parent contains context'),'Native lexical input must not inject the remote prose caption');
  await assert.rejects(prepareSensitivityInput(first,{representation:'heading-plus-unit'},prepare),/current contiguous source-span/);
  assert.match(actual.text,/NATIVE_SOURCE_MARKS_UNVERIFIED/);assert.ok(actual.windows.some(window=>window.source_ranges.some(range=>range.encoded_annotation_groups>0)));
  const calls=counter.calls;assert.deepEqual(await runSensitivity(f.run,f.admission,options),result);assert.equal(counter.calls,calls);
});

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

async function nativeItem(f,index=0){
  const unit=JSON.parse(f.units[index].payload),normalized=await readFile(path.join(f.run,unit.normalized_path),'utf8'),cache=await readJSON(f.run,`cache/${unit.contract_id}.json`),parent=cache.sections[0],representation=verifiedParentRepresentation(unit,parent,normalized),prepare=createStudyNativeInputLoader(f.run,f.admission);
  const primary=await prepare(unit),contextual=await prepare(unit,{bodyRange:{start:representation.provenance.context_start,end:representation.provenance.context_end}});
  return {row:{id:unit.id,contract_id:unit.contract_id,cohort:unit.cohort,family_id:unit.family_id,partition:'fit'},primary:representation.primary,contextual:representation.contextual,provenance:representation.provenance,native:{source_unit:unit,primary:{descriptor:primary.native_input.descriptor,input_sha256:modelInputIdentity(primary).input_sha256},contextual:{descriptor:contextual.native_input.descriptor,input_sha256:modelInputIdentity(contextual).input_sha256}}};
}

test('genuine native units cannot be swapped, relabelled or assigned a foreign family before preparation',{skip:!container},async t=>{
  const f=await fixture(t,{native:true}),a=await nativeItem(f,0),b=await nativeItem(f,3),definition={representation:'unit-source-span'};let calls=0;
  const prepare=async unit=>{calls++;return createStudyNativeInputLoader(f.run,f.admission)(unit);};
  await assert.rejects(prepareSensitivityInput({...a,native:b.native},definition,prepare),/outer\/source identity/);assert.equal(calls,0);
  await assert.rejects(prepareSensitivityInput({...a,native:{...a.native,source_unit:{...a.native.source_unit,family_id:'foreign-family'}}},definition,prepare),/outer\/source identity/);assert.equal(calls,0);
  const genuineB=await createStudyNativeInputLoader(f.run,f.admission)(b.native.source_unit);
  await assert.rejects(prepareSensitivityInput(a,definition,async()=>genuineB),/prepared identity/);
});

test('native inference output must keep its actual unit identity before any forced manifest label',{skip:!container},async t=>{
  const f=await fixture(t,{native:true}),counter={calls:0,constructed:0,disposed:0},pinned=await createPinnedTokenCounter(),options=syntheticFactories(f,counter,{tokenCount:pinned.tokenCount}),normal=options.createBaselineEmbedder;
  options.createBaselineEmbedder=async config=>{const engine=await normal(config),embed=engine.embedUnits;return {...engine,embedUnits:async units=>{const result=await embed(units);result.inputs[0].unit_id='foreign-output-unit';return result;}};};
  await assert.rejects(runSensitivity(f.run,f.admission,options),/Native comparison model provenance/);assert.equal(counter.calls,1);assert.equal(counter.disposed,1);
});

test('native vector-cache hits rederive status, descriptors and windows with the pinned tokenizer before inference',{skip:!container},async t=>{
  const f=await fixture(t,{native:true}),counter={calls:0,constructed:0,disposed:0},pinned=await createPinnedTokenCounter(),options=syntheticFactories(f,counter,{tokenCount:pinned.tokenCount}),first=await runSensitivity(f.run,f.admission,options),calls=counter.calls;
  const arm=await readJSON(f.run,first.arms[0].manifest.path),batch=await readJSON(f.run,arm.shards[0].path),target=batch.inputs[0].input_sha256;let cachePath,original;
  for(const name of await readdir(path.join(f.run,arm.vector_cache))){if(!/^chunk-[a-f0-9]{64}\.json$/u.test(name))continue;const file=path.join(f.run,arm.vector_cache,name),value=JSON.parse(await readFile(file,'utf8'));if(value.inputs.some(input=>input.input_sha256===target)){cachePath=file;original=await readFile(file,'utf8');break;}}
  assert.ok(cachePath);
  for(const [label,mutate]of [['status',m=>{m.native_evidence_status='LEGACY_NATIVE_EVIDENCE_UNAVAILABLE';}],['descriptor',m=>{m.native_representation.envelope_sha256='0'.repeat(64);}],['window',m=>{m.windows[0].source_ranges[0].projection_sha256='0'.repeat(64);}],['old-prefix-policy',m=>{m.native_representation.policy='COMPLETE_SOURCE_PARTS_EXPLICIT_JOINT_WHITESPACE_AND_LITERAL_SEPARATORS_PER_MODEL_WINDOW_V2';}]]){
    const value=JSON.parse(original),metadata=value.inputs.find(input=>input.input_sha256===target).metadata;mutate(metadata);await writeFile(cachePath,JSON.stringify(value));f.admission={...f.admission,checkpoint:'cache-tamper-'+label};
    await assert.rejects(runSensitivity(f.run,f.admission,options),/Native comparison model provenance/);assert.equal(counter.calls,calls,'No new inference may follow invalid cached native evidence');await writeFile(cachePath,original);
  }
});

test('partial native model resume rechecks actual windows before reusing an intact vector file',{skip:!container},async t=>{
  const f=await fixture(t,{native:true}),counter={calls:0,constructed:0,disposed:0},pinned=await createPinnedTokenCounter(),options=syntheticFactories(f,counter,{tokenCount:pinned.tokenCount}),interrupted={...options,createSecondEmbedder:async()=>{throw new Error('declared synthetic stop before second model');}};
  await assert.rejects(runSensitivity(f.run,f.admission,interrupted),/declared synthetic stop/);const calls=counter.calls;
  const prefix=(await readdir(path.join(f.run,'sensitivity')))[0],file=path.join(f.run,'sensitivity',prefix,'baseline-heading-unit/batch-000000.json'),retained=JSON.parse(await readFile(file,'utf8')),vectorBefore=await hashFile(path.join(f.run,retained.vectors.path));
  retained.inputs[0].windows[0].sha256='0'.repeat(64);await writeFile(file,JSON.stringify(retained));
  await assert.rejects(runSensitivity(f.run,f.admission,options),/Native comparison model provenance/);assert.equal(counter.calls,calls);assert.deepEqual(await hashFile(path.join(f.run,retained.vectors.path)),vectorBefore);
});

test('partial lexical resume rechecks encoded window proof with its real pinned baseline tokenizer',{skip:!container},async t=>{
  const f=await fixture(t,{native:true}),counter={calls:0,constructed:0,disposed:0},pinned=await createPinnedTokenCounter(),normal=syntheticFactories(f,counter,{tokenCount:pinned.tokenCount}),interrupted={...normal,log:message=>{if(message.startsWith('Sensitivity lexical-heading-unit:'))throw new Error('declared synthetic stop after lexical batch');}};
  await assert.rejects(runSensitivity(f.run,f.admission,interrupted),/declared synthetic stop after lexical/);const calls=counter.calls,prefix=(await readdir(path.join(f.run,'sensitivity')))[0],file=path.join(f.run,'sensitivity',prefix,'lexical-heading-unit/batch-000000.json'),retained=JSON.parse(await readFile(file,'utf8'));
  retained.inputs[0].encoded_sha256='0'.repeat(64);await writeFile(file,JSON.stringify(retained));
  await assert.rejects(runSensitivity(f.run,f.admission,normal),/Native lexical provenance/);assert.equal(counter.calls,calls);
});

test('completed native resume rederives model and lexical windows even after a consistent receipt-chain rewrite',{skip:!container},async t=>{
  const f=await fixture(t,{native:true}),counter={calls:0,constructed:0,disposed:0},pinned=await createPinnedTokenCounter(),options=syntheticFactories(f,counter,{tokenCount:pinned.tokenCount}),first=await runSensitivity(f.run,f.admission,options),calls=counter.calls;
  for(const armIndex of [0,3]){
    const finalPath=path.join(f.run,first.manifest_path),finalOriginal=await readFile(finalPath,'utf8'),final=JSON.parse(finalOriginal),armRef=final.arms[armIndex].manifest,armPath=path.join(f.run,armRef.path),armOriginal=await readFile(armPath,'utf8'),arm=JSON.parse(armOriginal),batchPath=path.join(f.run,arm.shards[0].path),batchOriginal=await readFile(batchPath,'utf8'),batch=JSON.parse(batchOriginal);
    if(armIndex===0)batch.inputs[0].windows[0].source_ranges[0].projection_sha256='0'.repeat(64);else batch.inputs[0].encoded_sha256='0'.repeat(64);
    await writeFile(batchPath,JSON.stringify(batch));arm.shards[0]={...arm.shards[0],...await hashFile(batchPath)};await writeFile(armPath,JSON.stringify(arm));const updated={...armRef,...await hashFile(armPath)};final.arms[armIndex].manifest=updated;final.artifact_bindings=final.artifact_bindings.map(ref=>ref?.path===armRef.path?updated:ref);const {manifest_sha256:ignored,...body}=final;await writeFile(finalPath,JSON.stringify({...body,manifest_sha256:digest(body)}));
    await assert.rejects(runSensitivity(f.run,f.admission,options),armIndex===0?/Native comparison model provenance/:/Native lexical provenance/);assert.equal(counter.calls,calls,'Completed verification must not perform another extract call');
    await writeFile(batchPath,batchOriginal);await writeFile(armPath,armOriginal);await writeFile(finalPath,finalOriginal);
  }
  assert.deepEqual(await runSensitivity(f.run,f.admission,options),first);assert.equal(counter.calls,calls);
});

test('completed resume binds its outer arm and lexical references even when artifact_bindings remain intact',{skip:!container},async t=>{
  const f=await fixture(t),counter={calls:0,constructed:0,disposed:0},options=syntheticFactories(f,counter),first=await runSensitivity(f.run,f.admission,options),calls=counter.calls,finalPath=path.join(f.run,first.manifest_path),original=await readFile(finalPath,'utf8');
  for(const key of ['arm','lexical']){
    const final=JSON.parse(original);if(key==='arm')final.arms[0].manifest.sha256='0'.repeat(64);else final.lexical_model.sha256='0'.repeat(64);
    const {manifest_sha256:ignored,...body}=final;await writeFile(finalPath,JSON.stringify({...body,manifest_sha256:digest(body)}));
    await assert.rejects(runSensitivity(f.run,f.admission,options),/binding changed/);assert.equal(counter.calls,calls);assert.equal(counter.constructed,3);await writeFile(finalPath,original);
  }
});

test('a fabricated stored passing gate cannot satisfy the real full-target authoritative guard',{skip:!container},async t=>{
  const f=await fixture(t,{native:true});await writeJSON(f.run,`quality-gates/${f.sourceHash}/gate.json`,{status:'CALIBRATION_GATE_PASSED',authority:'NONE',extraction_source_sha256:f.sourceHash});let constructed=0;
  await assert.rejects(async()=>{await verifyFullSensitivityGate(f.run,f.admission);constructed++;},/CALIBRATION_GATE_NOT_PASSED/);assert.equal(constructed,0);
});

async function realSyntheticGuardFixture(t){const f=await qualityFixture(t);await sealQualityGate(f.root,f.options);return {...f,admission:{input:{extraction_source_sha256:f.source.sha256}}};}

test('factory and between-unit source issues stop the next call and a held partial resume',{skip:!container},async t=>{
  const f=await realSyntheticGuardFixture(t),guard=await createSensitivitySourceGuard(f.root,f.admission,{fullTarget:true});assert.equal(guard.scope,'AUTHORITATIVE_FULL_TARGET_CHECKPOINTS');let calls=0;
  // One legitimate synthetic unit call precedes the independently registered
  // synthetic finding. The next call is never reached, including after resume.
  await guard.beforeInference();calls++;await registerSyntheticSourceIssue(f);
  await assert.rejects(async()=>{await guard.beforeInference();calls++;},/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);assert.equal(calls,1);
  await assert.rejects(async()=>{const resumed=await createSensitivitySourceGuard(f.root,f.admission,{fullTarget:true});await resumed.beforeInference();calls++;},/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);assert.equal(calls,1);
  const engineering=await createSensitivitySourceGuard(f.root,f.admission,{fullTarget:false});assert.equal(engineering.scope,'PARTIAL_PRE_GATE_ENGINEERING_ONLY');await engineering.beforeInference();
  const other=await realSyntheticGuardFixture(t),beforeFactory=await createSensitivitySourceGuard(other.root,other.admission,{fullTarget:true}),factory=async()=>{await registerSyntheticSourceIssue(other);return {infer:()=>{calls++;}};},engine=await factory();
  await assert.rejects(async()=>{await beforeFactory.checkpoint();engine.infer();},/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);assert.equal(calls,1);
});

async function resolveSyntheticIssue(f,issue){
  const observed=await readJSON(f.root,issue.path),old=f.extraction.cache.find(cache=>cache.id===observed.contract_id),cache=await readJSON(f.root,old.path),raw=await readFile(path.join(f.root,observed.raw.path),'utf8'),text='1. Synthetic performance\n\n'+cache.normalized_text,parent={id:observed.contract_id+':repaired-parent',contract_id:observed.contract_id,start:0,end:text.length,text,sha256:sha256(text)};
  const repaired={...cache,normalized_text:text,normalized_sha256:sha256(text),sections:[parent]},reference=await writeJSON(f.root,'synthetic-repaired/cache.json',repaired);await writeFile(path.join(f.root,'synthetic-repaired/normalized.txt'),text);
  const manifest=await writeJSON(f.root,'synthetic-repaired/manifest.json',{source:f.source,contract_records:[{id:observed.contract_id,status:'accepted',raw_sha256:sha256(raw),normalized_path:'synthetic-repaired/normalized.txt',normalized_sha256:sha256(text)}],cache:[{id:observed.contract_id,...reference,source_sha256:f.source.sha256,result_sha256:digest(repaired)}]});
  const replay=await writeJSON(f.root,'synthetic-repaired/replay.json',{schema:'source-issue-replay-v1',data_classification:'DECLARED_SYNTHETIC',issue:{path:issue.path,sha256:issue.sha256},extraction_manifest:manifest,contract_id:observed.contract_id,parent:{id:parent.id,start:0,end:text.length,sha256:parent.sha256,actual_read_ranges:[[0,text.length]]},raw:{path:observed.raw.path,sha256:sha256(raw),actual_read_ranges:[[0,raw.length]]},reviewer:'Declared synthetic regression fixture',reading:'FULL_PARENT_AND_RELEVANT_SOURCE',repair_adequate:true,unresolved_material_loss:false,material_loss_observed:false,reason:'Declared synthetic repaired parent includes its original source title and complete fictional source statement.',authority:'NONE'});
  return resolveObservedSourceIssue(f.root,{issuePath:issue.path,issueSHA:issue.sha256,replayPath:replay.path,replaySHA:replay.sha256});
}

test('gate and resolution content changes trigger full verification even without an mtime check',{skip:!container},async t=>{
  const f=await realSyntheticGuardFixture(t),guard=await createSensitivitySourceGuard(f.root,f.admission,{fullTarget:true}),gatePath=path.join(f.root,`quality-gates/${f.source.sha256}/gate.json`),original=await readFile(gatePath,'utf8');let calls=0;
  const before=await stat(gatePath),gate=JSON.parse(original);gate.status='CALIBRATION_GATE_FAILED';await writeFile(gatePath,JSON.stringify(gate));await utimes(gatePath,before.atime,before.mtime);
  await assert.rejects(async()=>{await guard.beforeInference();calls++;},/CALIBRATION_GATE_NOT_PASSED/);assert.equal(calls,0);await writeFile(gatePath,original);
  const issue=await registerSyntheticSourceIssue(f),resolution=await resolveSyntheticIssue(f,issue);await guard.checkpoint();
  const resumed=await createSensitivitySourceGuard(f.root,f.admission,{fullTarget:true});await resumed.beforeInference();
  const resolutionPath=path.join(f.root,resolution.path),resolutionBytes=await readFile(resolutionPath,'utf8'),resolutionBefore=await stat(resolutionPath),changed=JSON.parse(resolutionBytes);changed.status='CHANGED_SYNTHETIC_CONTROL';await writeFile(resolutionPath,JSON.stringify(changed));await utimes(resolutionPath,resolutionBefore.atime,resolutionBefore.mtime);
  await assert.rejects(async()=>{await guard.beforeInference();calls++;},/resolution scope differs/);assert.equal(calls,0);await writeFile(resolutionPath,resolutionBytes);await guard.checkpoint();
  await rm(resolutionPath);await assert.rejects(async()=>{await guard.beforeInference();calls++;},/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);assert.equal(calls,0);
  await writeFile(resolutionPath,resolutionBytes);await guard.checkpoint();await rm(path.join(f.root,issue.path));await assert.rejects(guard.beforeInference(),/receipt removed/);
});

test('a resumed full guard cannot forget an unresolved receipt removed after its previous failed checkpoint',{skip:!container},async t=>{
  const f=await realSyntheticGuardFixture(t),guard=await createSensitivitySourceGuard(f.root,f.admission,{fullTarget:true}),issue=await registerSyntheticSourceIssue(f);
  await assert.rejects(guard.beforeInference(),/UNRESOLVED_OBSERVED_SOURCE_ISSUE/);await rm(path.join(f.root,issue.path));
  await assert.rejects(createSensitivitySourceGuard(f.root,f.admission,{fullTarget:true}),/receipt removed/);
});

test('the sealed gate seeds historical observed references before a first full guard invocation',{skip:!container},async t=>{
  const f=await qualityFixture(t),issue=await registerSyntheticSourceIssue(f);await resolveSyntheticIssue(f,issue);const gate=await sealQualityGate(f.root,f.options);assert.equal(gate.observed_source_issues.observed,1);
  await rm(path.join(f.root,issue.path));
  await assert.rejects(createSensitivitySourceGuard(f.root,{input:{extraction_source_sha256:f.source.sha256}},{fullTarget:true}),/receipt removed/);
});

test('a new partial representation registry entry stops the next inference and cannot be forgotten on resume',{skip:!container},async t=>{
  const f=await realSyntheticGuardFixture(t),guard=await createSensitivitySourceGuard(f.root,f.admission,{fullTarget:true});let calls=0;
  await guard.beforeInference();
  // An invalid new observed object must still trigger authoritative validation.
  // Its bytes are synthetic; this test declares no actual source reading.
  const ref=await writeJSON(f.root,`representation-issues/observed/issue-${'d'.repeat(64)}.json`,{schema:'DECLARED_SYNTHETIC_INVALID_OBSERVED_OBJECT',authority:'NONE'});
  await assert.rejects(async()=>{await guard.beforeInference();calls++;},/representation issue/i);assert.equal(calls,0);
  await rm(path.join(f.root,ref.path));
  await assert.rejects(guard.beforeInference(),/receipt removed/);
  await assert.rejects(createSensitivitySourceGuard(f.root,f.admission,{fullTarget:true}),/receipt removed/);
});

test('a sealed representation snapshot preserves a missing observed reference before first use',{skip:!container},async t=>{
  const f=await realSyntheticGuardFixture(t),gatePath=path.join(f.root,`quality-gates/${f.source.sha256}/gate.json`),gate=JSON.parse(await readFile(gatePath,'utf8'));
  gate.observed_source_issues.representation_issues={observed:1,resolved:1,issues:[{issue:{path:`representation-issues/observed/issue-${'e'.repeat(64)}.json`,sha256:'f'.repeat(64),bytes:120}}]};
  await writeFile(gatePath,JSON.stringify(gate));
  await assert.rejects(createSensitivitySourceGuard(f.root,f.admission,{fullTarget:true}),/receipt removed/);
});

test('replay assignment control byte changes stop the next inference even when policy and resolution bytes stay fixed',{skip:!container},async t=>{
  const f=await realSyntheticGuardFixture(t),guard=await createSensitivitySourceGuard(f.root,f.admission,{fullTarget:true});
  const protocol=await writeJSON(f.root,'synthetic-controls/protocol.json',{data_classification:'DECLARED_SYNTHETIC'}),assignments=await writeJSON(f.root,'synthetic-controls/assignments.json',{data_classification:'DECLARED_SYNTHETIC'});
  await writeJSON(f.root,`representation-issues/replay-policies/${f.source.sha256}.json`,{schema:'partial-representation-replay-policy-v1',extraction_source_sha256:f.source.sha256,protocol_ref:protocol,reviewer_assignments:assignments,data_classification:'DECLARED_SYNTHETIC'});
  await guard.beforeInference();let calls=0;
  await writeFile(path.join(f.root,assignments.path),JSON.stringify({data_classification:'DECLARED_SYNTHETIC_CHANGED_CONTROL'}));
  await assert.rejects(async()=>{await guard.beforeInference();calls++;},/Replay policy control binding differs/);assert.equal(calls,0);
});
