// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic acquired bodies, real extraction and immutable Parquet checkpoints.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest,sha256} from '../../lib/common.mjs';
import {contractURLs} from '../../lib/acquire.mjs';
import {STUDY_BASE,appendLedger,hashFile,readJSON,readRows,validateStudyRoot,writeJSON,writeRows} from '../lib/store.mjs';
import {extractStudy,readUnits,extractionSourceIdentity} from '../lib/workflow.mjs';
import {loadNativeDecoration} from '../lib/native-decoration-store.mjs';

async function collect(iterator){const rows=[];for await(const row of iterator)rows.push(row);return rows;}
test('native model-window settings and the comparison recipe bind separate extraction namespaces',async()=>{
  const recipe={seed:'DECLARED_SYNTHETIC',extraction:{maxUnitWords:60},embedding:{model:'DECLARED_SYNTHETIC',max_tokens:256}};
  const first=await extractionSourceIdentity(recipe),changed=await extractionSourceIdentity({...recipe,embedding:{...recipe.embedding,max_tokens:128}});
  assert.notEqual(first.sha256,changed.sha256);assert.deepEqual(first.parameters.native_input_profile,{baseline_embedding:recipe.embedding});
  const comparison=first.files.find(file=>file.path==='../comparison-recipe.json');assert.equal(comparison.sha256,sha256(await readFile(new URL('../comparison-recipe.json',import.meta.url))));
});
async function fixture(t,{pending=false,allDiscoveryCalibration=false}={}){
  const root=join(STUDY_BASE,`test-workflow-${randomUUID()}`);validateStudyRoot(root);await mkdir(root,{recursive:true});t.after(()=>rm(root,{recursive:true,force:true}));
  const recipe={seed:'synthetic-workflow',maxPerFiler:2,cohorts:[{id:'discovery-broad',target:3,labels:['services'],minYear:2000,maxYear:2021},{id:'confirmation',target:1,labels:['services'],minYear:2000,maxYear:2021,sealed:true}],limits:{contractBytes:4*1024**2,rawBytes:8*1024**3,totalBytes:24*1024**3,requestIntervalMs:1000},extraction:{maxUnitWords:60,contextWords:20,maxPerContract:2,maxUnits:1}};
  const members=Array.from({length:4},(_,i)=>{const urls=contractURLs(`${i+1}/000000000000000001/doc${i}.htm`);return {id:`synthetic-${i}`,cohort:i===3?'confirmation':'discovery-broad',format:'html',calibration:i<2||allDiscoveryCalibration&&i===2,source_url:urls.original,corpus_url:urls.corpus,metadata:{amend:false}};});
  await writeJSON(root,'recipe.json',recipe);const selection=await writeRows(root,'selection.parquet',members,{schema:{id:'VARCHAR',cohort:'VARCHAR',format:'VARCHAR',calibration:'BOOLEAN',source_url:'VARCHAR',corpus_url:'VARCHAR',metadata:'JSON'}});
  await writeJSON(root,'census.json',{data_classification:'DECLARED_SYNTHETIC'});await writeJSON(root,'feasibility.json',{data_classification:'DECLARED_SYNTHETIC'});
  await writeJSON(root,'study.json',{status:'READY',selected:4,recipe_digest:digest(recipe),recipe_file:await hashFile(join(root,'recipe.json')),sources:[],census_file:await hashFile(join(root,'census.json')),feasibility_file:await hashFile(join(root,'feasibility.json')),selection});
  const commit=async index=>{const row=members[index];const raw=`<h1>ARTICLE I</h1><h2>1. Performance</h2><p>The Operator shall perform the work using the agreed equipment 📷. ${Array.from({length:320},(_,i)=>`word${i}`).join(' ')} Unless the Requester gives safe access, an unsafe alternative is not required.</p><h2>2. Notices</h2><p>Written notice shall identify the problem and permit discussion of a correction without adding unauthorized work.</p><p hidden>Retained original hidden content.</p><script>globalThis.workflowFixtureExecuted=true</script>`;
    const rawPath=`raw/${row.id}.html`;await mkdir(join(root,'raw'),{recursive:true});await writeFile(join(root,rawPath),raw);
    await appendLedger(root,{kind:'download-committed',id:row.id,cohort:row.cohort,raw_path:rawPath,sha256:sha256(raw),bytes:Buffer.byteLength(raw),url:row.corpus_url,http_status:200,content_type:'text/html',fetched_at:'2026-10-13T00:00:00.000Z',attempt:1});};
  for(let i=0;i<4;i++)if(!(pending&&i===1))await commit(i);
  return {root,members,commit};
}

test('exact-stage reuse returns manifest_path and retains every provisional exclusion with real parents',async t=>{
  const {root}=await fixture(t,{allDiscoveryCalibration:true});const options={limit:3,calibrationOnly:false,log:()=>{}};
  const first=await extractStudy(root,options),again=await extractStudy(root,options);assert.deepEqual(again,first);assert.ok(first.manifest_path.endsWith('/extraction-manifest.json'));
  assert.equal(first.storage_accounting.method,'STRICT_UNLINKED_FILE_ENTRY_BYTES_V1');assert.equal(first.storage_accounting.policy_ref,null);assert.equal(first.storage_accounting.link_targets_traversed,false);
  assert.equal(first.contracts,3);assert.equal(first.selection_authority,'PROVISIONAL_PER_CONTRACT_ONLY_GLOBAL_ADMISSION_SEPARATE');assert.ok(first.selected_units>1,'Global budget belongs to admission, not per-contract extraction');
  assert.equal(globalThis.workflowFixtureExecuted,undefined);
  const admitted=await collect(readUnits(root,first)),excluded=[];for(const shard of first.shards.exclusions)for await(const row of readRows(root,shard.path))excluded.push(JSON.parse(row.payload));
  assert.equal(excluded.length,first.excluded_units);assert.ok(excluded.some(row=>row.reason==='explicit_per_contract_unit_bound'));
  const represented=new Set([...admitted,...excluded].map(row=>row.id));
  for(const receipt of first.cache){const cached=await readJSON(root,receipt.path,{maxBytes:64*1024**2});assert.ok(cached.units.every(unit=>represented.has(unit.id)));assert.ok(cached.excluded.some(row=>row.reason==='hidden_html_excluded'));
    assert.ok(receipt.path.endsWith('.json.gz'));assert.equal(receipt.storage.schema,'lossless-gzip-extraction-cache-v1');assert.equal(receipt.storage.decoded_sha256,sha256(Buffer.from(JSON.stringify(cached,null,2)+'\n')));assert.equal(receipt.storage.decoded_bytes,Buffer.byteLength(JSON.stringify(cached,null,2)+'\n'));await assert.rejects(readFile(join(root,receipt.path.slice(0,-3))),{code:'ENOENT'});
    for(const unit of admitted.filter(row=>row.contract_id===receipt.id)){const parent=cached.sections.find(row=>row.id===unit.parent_section_id);assert.ok(parent);assert.ok(unit.start>=parent.start&&unit.end<=parent.end);assert.equal(cached.normalized_text.slice(unit.start,unit.end),unit.text);assert.equal(sha256(unit.text),unit.sha256);}
  }
});

test('a partial calibration checkpoint cannot freeze later acquired records or include noncalibration/reserve bodies',async t=>{
  const {root,commit}=await fixture(t,{pending:true});const options={limit:3,calibrationOnly:true,log:()=>{}};
  const early=await extractStudy(root,options);assert.equal(early.contracts,1);assert.equal(early.input_complete,false);assert.equal(early.missing_contracts[0].id,'synthetic-1');const old=await hashFile(join(root,early.manifest_path));
  await commit(1);const complete=await extractStudy(root,options);assert.equal(complete.contracts,2);assert.equal(complete.input_complete,true);assert.notEqual(complete.manifest_path,early.manifest_path);assert.deepEqual(await hashFile(join(root,early.manifest_path)),old);
  assert.ok(complete.contract_records.every(row=>['synthetic-0','synthetic-1'].includes(row.id)));
  await assert.rejects(extractStudy(root,{limit:3,calibrationOnly:false,log:()=>{}}),/CALIBRATION_GATE_NOT_PASSED/);
  const bounded=await extractStudy(root,{limit:1,calibrationOnly:false,log:()=>{}});assert.equal(bounded.contracts,1);assert.equal(bounded.contract_records[0].id,'synthetic-0');
});

test('final manifest presence cannot bypass changed cached or normalized source checks',async t=>{
  const {root}=await fixture(t);const options={limit:1,calibrationOnly:true,log:()=>{}};const manifest=await extractStudy(root,options);
  const cachePath=join(root,manifest.cache[0].path),cache=await readJSON(root,manifest.cache[0].path);cache.normalized_text+=' Invented cached interpretation.';await writeFile(cachePath,JSON.stringify(cache));
  await assert.rejects(extractStudy(root,options),/cache.*binding|cache.*digest/i);
});

test('orphan gzip cache resumes only through exact retained raw-source replay and never rewrites encoded bytes',async t=>{
  const {root}=await fixture(t),options={limit:1,calibrationOnly:true,log:()=>{}},initial=await extractStudy(root,options),cache=initial.cache[0],before=await hashFile(join(root,cache.path));
  await rm(join(root,cache.path+'.manifest.json'));await rm(join(root,initial.manifest_path));
  assert.deepEqual(await extractStudy(root,options),initial);assert.deepEqual(await hashFile(join(root,cache.path)),before);
  await rm(join(root,cache.path+'.manifest.json'));const changed=await readFile(join(root,cache.path));changed[changed.length-5]^=1;await writeFile(join(root,cache.path),changed);
  await assert.rejects(extractStudy(root,options),/Immutable compressed extraction cache differs/);assert.deepEqual(await readFile(join(root,cache.path)),changed);
});

test('committed shard without sidecar resumes from exact expected rows without rewriting its bytes',async t=>{
  const {root}=await fixture(t);const options={limit:2,calibrationOnly:true,log:()=>{}};const initial=await extractStudy(root,options),shard=initial.shards.units[0];const original=await hashFile(join(root,shard.path));
  // Only this test's disposable checkpoint files; retain and reuse committed data.
  await rm(join(root,initial.manifest_path));await rm(join(root,`${shard.path}.manifest.json`));
  const resumed=await extractStudy(root,options);assert.deepEqual(resumed,initial);assert.deepEqual(await hashFile(join(root,shard.path)),original);
});

test('terminal acquisition failure completes the declared prefix while preserving missing raw coverage',async t=>{
  const {root}=await fixture(t,{pending:true});await appendLedger(root,{kind:'download-failed',id:'synthetic-1',cohort:'discovery-broad',error:'CONTRACT_BYTE_LIMIT',replacements:'none'});
  const result=await extractStudy(root,{limit:2,calibrationOnly:true,log:()=>{}});
  assert.equal(result.selected_prefix_terminal_complete,true);assert.equal(result.raw_coverage_complete,false);assert.equal(result.input_complete,false);
  assert.deepEqual(result.terminal_selection_status,{declared_prefix:2,raw_committed:1,raw_processed:1,terminal_download_failures:1,pending_or_unattempted:0});
  assert.equal(result.missing_contracts[0].acquisition_failure,'CONTRACT_BYTE_LIMIT');assert.equal(result.contracts,1);
});
test('different cumulative checkpoints may share immutable normalized sources without a commit race',async t=>{
  const {root}=await fixture(t);const [first,second]=await Promise.all([extractStudy(root,{limit:1,calibrationOnly:true,log:()=>{}}),extractStudy(root,{limit:2,calibrationOnly:true,log:()=>{}})]);
  assert.equal(first.contracts,1);assert.equal(second.contracts,2);assert.notEqual(first.manifest_path,second.manifest_path);
  assert.equal(first.contract_records[0].normalized_sha256,second.contract_records[0].normalized_sha256);
});

test('current extraction retains one lossless native envelope with exact method and unit references',async t=>{
  const {root}=await fixture(t),manifest=await extractStudy(root,{limit:1,calibrationOnly:true,log:()=>{}}),cached=await readJSON(root,manifest.cache[0].path,{maxBytes:64*1024**2});
  const ref=cached.native_source_decorations;assert.equal(ref.schema,'native-source-decoration-reference-v1');assert.equal(Object.hasOwn(ref,'trace'),false);
  const envelope=await loadNativeDecoration(root,ref);assert.equal(envelope.raw.sha256,cached.raw_sha256);assert.equal(envelope.normalized.sha256,cached.normalized_sha256);
  assert.equal(envelope.tracer_source_sha256,manifest.source.files.find(f=>f.path==='source-decoration.mjs').sha256);assert.equal(envelope.collector_source_sha256,manifest.source.files.find(f=>f.path==='sections.mjs').sha256);
  assert.deepEqual(manifest.contract_records[0].native_source_decorations,ref);
  for(const unit of cached.units){assert.equal(unit.native_source_decorations_ref.envelope_sha256,envelope.sha256);assert.equal(unit.native_source_decorations_ref.start,unit.start);assert.equal(unit.native_source_decorations_ref.end,unit.end);assert.equal(Object.hasOwn(unit,'native_source_decorations'),false);}
  const path=join(root,ref.artifact.path),bytes=await readFile(path);bytes[bytes.length-10]^=1;await writeFile(path,bytes);
  await assert.rejects(extractStudy(root,{limit:1,calibrationOnly:true,log:()=>{}}),/Native sidecar compressed digest differs/);
});
