// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic retained source/caches, with genuine section extraction and Parquet.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest,sha256} from '../../lib/common.mjs';
import {STUDY_BASE,hashFile,readJSON,readRows,studyPath,validateStudyRoot,writeJSON,writeRows,writeExtractionCache} from '../lib/store.mjs';
import {extractSections} from '../lib/sections.mjs';
import {auditPurpose,buildAuditPackets} from '../lib/audit.mjs';

const seed='declared-synthetic-audit';
const purposes=['development','fresh_representation','coding','negative'];
const counts={development:4,fresh_representation:3,coding:6,negative:4};

function fixtureIds(){const ids=Object.fromEntries(purposes.map(purpose=>[purpose,[]]));for(let i=0;purposes.some(purpose=>ids[purpose].length<2);i++){const id=`synthetic-contract-${i}`;const purpose=auditPurpose(id,{seed});if(ids[purpose].length<2)ids[purpose].push(id);}return Object.values(ids).flat();}
async function fixture(t,{compressed=false}={}){
  const root=join(STUDY_BASE,`test-audit-${randomUUID()}`);validateStudyRoot(root);await mkdir(root,{recursive:true});t.after(()=>rm(root,{recursive:true,force:true}));
  const ids=fixtureIds();const recipe={seed:'synthetic-study',name:'Declared synthetic audit fixture',maxPerFiler:2,cohorts:[{id:'discovery-broad',target:ids.length,labels:['services'],minYear:2000,maxYear:2021}],limits:{contractBytes:4*1024**2,rawBytes:8*1024**3,totalBytes:24*1024**3,requestIntervalMs:1000},extraction:{maxChunkWords:100,maxPerContract:1,maxUnits:1000}};
  await writeJSON(root,'recipe.json',recipe);const members=ids.map(id=>({id,cohort:'discovery-broad'}));const selection=await writeRows(root,'selection.parquet',members,{schema:{id:'VARCHAR',cohort:'VARCHAR'}});
  await writeJSON(root,'census.json',{data_classification:'DECLARED_SYNTHETIC'});await writeJSON(root,'feasibility.json',{data_classification:'DECLARED_SYNTHETIC'});
  await writeJSON(root,'study.json',{status:'READY',recipe_digest:digest(recipe),recipe_file:await hashFile(join(root,'recipe.json')),sources:[],census_file:await hashFile(join(root,'census.json')),feasibility_file:await hashFile(join(root,'feasibility.json')),selection,selected:ids.length});
  const source={parameters:recipe.extraction,sha256:digest({data_classification:'DECLARED_SYNTHETIC_SECTION_SOURCE'})};const cache=[],contracts=[],admitted=[];
  await mkdir(join(root,'raw'));await mkdir(join(root,'normalized'));await mkdir(join(root,'cache'));
  for(const id of ids){
    const raw=`<h1>ARTICLE I WORK</h1><h2>1. Performance</h2><p>The Operator shall perform the agreed work. ${Array.from({length:680},(_,i)=>`word${i}`).join(' ')} Except that no unsafe extra work is required unless the parties agree.</p><h2>2. Notice</h2><p>Written notice shall identify the observed problem and permit discussion of a practical correction without extending the agreed scope.</p><h2>3. Contents</h2><p>TABLE OF CONTENTS</p><p hidden>Omitted hidden source text.</p><script>globalThis.auditFixtureExecuted=true</script>`;
    const rawPath=`raw/${id}.html`;await writeFile(join(root,rawPath),raw);
    const result=extractSections({id,cohort:'discovery-broad',path:rawPath,format:'html',source_url:'https://example.invalid/declared-synthetic-source',metadata:{amend:true},content:raw},recipe.extraction);
    const saved={...result,raw_sha256:sha256(raw),source};const cachePath=compressed?`extraction-cache/${id}.json.gz`:`cache/${id}.json`;let storage;if(compressed){const stored=await writeExtractionCache(root,cachePath,saved);storage=stored.storage;await writeJSON(root,cachePath+'.manifest.json',{...stored.artifact,storage,result_sha256:digest(saved)});}else await writeJSON(root,cachePath,saved);
    const normalizedPath=`normalized/${id}.txt`;await writeFile(join(root,normalizedPath),saved.normalized_text);
    cache.push({id,path:cachePath,...await hashFile(join(root,cachePath)),...(storage?{storage}:{})});contracts.push({id,cohort:'discovery-broad',status:saved.status,raw_sha256:sha256(raw),normalized_path:normalizedPath,normalized_sha256:saved.normalized_sha256});
    const unit=saved.units.find(unit=>unit.kind!=='structural_noise');admitted.push({id:unit.id,contract_id:id,cohort:'discovery-broad',kind:unit.kind,payload:JSON.stringify(unit)});
  }
  const shard=await writeRows(root,'admitted.parquet',admitted,{schema:{id:'VARCHAR',contract_id:'VARCHAR',cohort:'VARCHAR',kind:'VARCHAR',payload:'VARCHAR'}});
  const manifest={schema_version:2,status:'EXTRACTION_RESEARCH_ONLY',authority:'NONE',adopted_catalog:false,source,contracts:ids.length,selected_units:admitted.length,cache,contract_records:contracts,shards:{units:[shard],sections:[]}};
  await writeJSON(root,'extraction-manifest.json',manifest);return {root,manifest:{...manifest,manifest_path:'extraction-manifest.json'}};
}

test('full-cache packets include unselected source and omission cues with exact bounded parent references',async t=>{
  const {root,manifest}=await fixture(t);const result=await buildAuditPackets(root,manifest,{seed,counts});
  assert.equal(result.status,'AUDIT_NOT_RUN');assert.equal(result.no_adequacy_claim,true);assert.equal(globalThis.auditFixtureExecuted,undefined);
  const contractOwners=new Map();let incomplete=false;
  for(const purpose of purposes){const packet=await readJSON(root,result.packets[purpose].path,{maxBytes:64*1024**2});assert.equal(packet.count,counts[purpose]);assert.equal(packet.shortage,0);
    assert.equal(packet.freshness.previous_pilot_or_agent_exposure,'UNKNOWN_NOT_VERIFIED');
    for(const row of packet.rows){assert.equal(auditPurpose(row.contract_id,{seed}),purpose);if(contractOwners.has(row.contract_id))assert.equal(contractOwners.get(row.contract_id),purpose);contractOwners.set(row.contract_id,purpose);
      const cached=await readJSON(root,row.lineage.cache_path);const parent=cached.sections[Number(row.parent.cache_pointer.split('/').at(-1))];
      assert.equal(cached.normalized_text.slice(row.parent.start,row.parent.end),parent.text);assert.equal(row.parent.sha256,sha256(parent.text));assert.equal(row.parent.text,undefined);
      assert.equal(cached.normalized_text.slice(row.excerpt.start,row.excerpt.end),row.excerpt.text);assert.equal(row.excerpt.sha256,sha256(row.excerpt.text));assert.ok(row.excerpt.word_count<=300);assert.ok(row.excerpt.start>=parent.start&&row.excerpt.end<=parent.end);
      if(row.omission_flags.parent_excerpt_incomplete)incomplete=true;assert.equal(row.review.status,'NOT_RUN');
    }
  }
  assert.equal(incomplete,true);const negative=await readJSON(root,result.packets.negative.path);assert.ok(negative.rows.some(row=>row.source_omission_cues.length));assert.ok(negative.universe.categories.unselected_unit>0);
  assert.deepEqual(await buildAuditPackets(root,manifest,{seed,counts}),result);
});

test('full-cache audit packets preserve encoded lineage and complete decoded parent spans for gzip caches',async t=>{
  const {root,manifest}=await fixture(t,{compressed:true}),result=await buildAuditPackets(root,manifest,{seed,counts});
  for(const purpose of purposes){const packet=await readJSON(root,result.packets[purpose].path);assert.equal(packet.count,counts[purpose]);for(const row of packet.rows){assert.ok(row.lineage.cache_path.endsWith('.json.gz'));const cached=await readJSON(root,row.lineage.cache_path);assert.equal(cached.normalized_text.slice(row.excerpt.start,row.excerpt.end),row.excerpt.text);assert.equal((await hashFile(await studyPath(root,row.lineage.cache_path))).sha256,row.lineage.cache_sha256);}}
});

test('coding packet carries no machine function/category/cluster/candidate labels or supplied codebook',async t=>{
  const {root,manifest}=await fixture(t);const result=await buildAuditPackets(root,manifest,{seed,counts});const packet=await readJSON(root,result.packets.coding.path);
  const inspect=value=>{if(!value||typeof value!=='object')return;for(const [key,child] of Object.entries(value)){assert.ok(!['kind','category','classification_reason','function_tags','sampling_cues','cluster_id','candidate_id','codebook'].includes(key),key);inspect(child);}};
  inspect(packet);assert.match(packet.prompt,/own words/);assert.ok(packet.rows.every(row=>row.review.response===null));
});

test('shortages remain attached to their purpose without redistribution or adequacy claims',async t=>{
  const {root,manifest}=await fixture(t);const requested={development:100,fresh_representation:0,coding:0,negative:0};const result=await buildAuditPackets(root,manifest,{seed,counts:requested});
  assert.ok(result.shortages.development>0);for(const purpose of ['fresh_representation','coding','negative'])assert.equal(result.packets[purpose].count,0);assert.equal(result.no_adequacy_claim,true);
});

test('audit rejects changed cache bytes and even re-sealed invalid normalized offsets',async t=>{
  const {root,manifest}=await fixture(t);const item=manifest.cache[0];const path=await studyPath(root,item.path);const cache=JSON.parse(await readFile(path,'utf8'));cache.units[0].start++;
  await writeFile(path,JSON.stringify(cache));await assert.rejects(buildAuditPackets(root,manifest,{seed,counts}),/cached extraction digest mismatch/);
  const {manifest_path,...updated}=manifest;updated.cache[0]={...item,...await hashFile(path)};await writeFile(join(root,manifest_path),JSON.stringify(updated));
  await assert.rejects(buildAuditPackets(root,{...updated,manifest_path},{seed,counts}),/normalized offset\/hash mismatch/);
});

test('a sealed or mismatched contract cannot be introduced into the audit universe',async t=>{
  const {root,manifest}=await fixture(t);const {manifest_path,...updated}=manifest;updated.contract_records[0].cohort='confirmation';await writeFile(join(root,manifest_path),JSON.stringify(updated));
  await assert.rejects(buildAuditPackets(root,{...updated,manifest_path},{seed,counts}),/Sealed or mismatched/);
});

test('repair audit excludes declared exposures and rejects while retaining every rejection separately',async t=>{
  const {root,manifest}=await fixture(t);const fresh=manifest.cache.filter(item=>auditPurpose(item.id,{seed})==='fresh_representation');
  const exposed=fresh[0].id,rejected=fresh[1].id;const item=fresh[1],cachePath=await studyPath(root,item.path),cache=await readJSON(root,item.path);cache.status='rejected';cache.units=[];cache.reason='Declared synthetic absent body';await writeFile(cachePath,JSON.stringify(cache));
  const {manifest_path,...updated}=manifest;updated.cache=manifest.cache.map(row=>row.id===rejected?{...row}:row);Object.assign(updated.cache.find(row=>row.id===rejected),await hashFile(cachePath));updated.contract_records.find(row=>row.id===rejected).status='rejected';
  const admitted=[];for await(const row of readRows(root,'admitted.parquet'))if(row.contract_id!==rejected)admitted.push(row);updated.shards.units=[await writeRows(root,'repaired-admitted.parquet',admitted,{schema:{id:'VARCHAR',contract_id:'VARCHAR',cohort:'VARCHAR',kind:'VARCHAR',payload:'VARCHAR'}})];updated.selected_units=admitted.length;await writeFile(join(root,manifest_path),JSON.stringify(updated));
  await writeJSON(root,'exposure.json',{source_exposed_contract_ids:[exposed]});const exposure={path:'exposure.json',...await hashFile(join(root,'exposure.json'))};
  const protocol={status:'PREDECLARED_FRESH_REPAIR_AUDIT',fresh_scope:'ACCEPTED_RECONSTRUCTABLE_SOURCE',rejection_controls:'ALL_REJECTED_SOURCES',excluded_contract_ids:[exposed],exposure_records:[exposure]};await writeJSON(root,'protocol.json',protocol);
  const result=await buildAuditPackets(root,{...updated,manifest_path},{seed,counts,protocolPath:'protocol.json'});assert.equal(result.packets.fresh_representation.count,0);assert.equal(result.shortages.fresh_representation,counts.fresh_representation);assert.equal(result.packets.coding.count,counts.coding);
  const integrity=await readJSON(root,result.packets.source_integrity.path);assert.equal(integrity.count,1);assert.equal(integrity.rows[0].contract_id,rejected);assert.match(integrity.scope,/separate/);
  await writeFile(join(root,'protocol.json'),JSON.stringify({...protocol,excluded_contract_ids:[]}));await assert.rejects(buildAuditPackets(root,{...updated,manifest_path},{seed,counts,protocolPath:'protocol.json'}),/Previously exposed source omitted/);
});

test('fresh repair cases cannot multiply one full parent into independent section observations',async t=>{const {root,manifest}=await fixture(t);await writeJSON(root,'protocol.json',{status:'PREDECLARED_FRESH_REPAIR_AUDIT',fresh_scope:'ACCEPTED_RECONSTRUCTABLE_SOURCE',rejection_controls:'ALL_REJECTED_SOURCES',excluded_contract_ids:[],exposure_records:[]});const result=await buildAuditPackets(root,manifest,{seed,counts:{...counts,fresh_representation:20},protocolPath:'protocol.json'});const packet=await readJSON(root,result.packets.fresh_representation.path);assert.equal(new Set(packet.rows.map(row=>row.parent.id)).size,packet.count);assert.ok(packet.shortage>0);});
