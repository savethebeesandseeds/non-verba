// SPDX-License-Identifier: AGPL-3.0-only
// DECLARED_SYNTHETIC: all source readings and judgments are executable fixtures.
// Shared terminal 1000-ID source gate; no public source or real reserve is opened.
import {randomUUID} from 'node:crypto';
import {mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,sha256} from '../../../lib/common.mjs';
import {contractURLs} from '../../../lib/acquire.mjs';
import {STUDY_BASE,hashFile,readJSON,validateStudyRoot,writeJSON,writeRows} from '../../lib/store.mjs';
import {extractionSourceIdentity} from '../../lib/workflow.mjs';
import {sealQualityGate} from '../../lib/quality.mjs';
import {auditPurpose} from '../../lib/audit.mjs';
import {evaluationMethodBindings} from '../../lib/evaluation.mjs';
import {registerObservedSourceIssue} from '../../lib/source-issues.mjs';
const classification='DECLARED_SYNTHETIC';
export const qualityOptions={extractionPath:'processing/calibration.json',packetPath:'audits/fresh_representation.json',reviewPath:'reviews/fresh.json',developmentReviewPath:'reviews/development.json',integrityReviewPath:'reviews/integrity.json'};
const options=qualityOptions;

export async function qualityFixture(t,{mutate,includeReserved=false}={}){
  const root=join(STUDY_BASE,`test-quality-integration-${randomUUID()}`);validateStudyRoot(root);await mkdir(root,{recursive:true});
  t.after(async()=>{validateStudyRoot(root);await rm(root,{recursive:true,force:true});});
  const recipe={schema_version:2,name:'Declared synthetic expansion gate integration',seed:'synthetic-quality-integration',maxPerFiler:2,
    cohorts:[{id:'discovery-relevant',target:1000,labels:['services'],minYear:2000,maxYear:2021},{id:'discovery-broad',target:1,labels:['services'],minYear:2000,maxYear:2021}],
    limits:{contractBytes:4*1024**2,rawBytes:8*1024**3,totalBytes:24*1024**3,requestIntervalMs:1000},
    calibration:{contracts:1000,representationAudit:300,adequacyTarget:.95},extraction:{maxUnitWords:60,contextWords:20,maxPerContract:2,maxUnits:300000}};
  const auditSeed=`${recipe.seed}:audit-v1`;let nextIdentity=0;
  const members=Array.from({length:1001},(_,index)=>{const desired=index>=2&&index<202?'development':index>=300&&index<400||index===900?'fresh_representation':null;let id;if(index===1000)id='synthetic-cal-1000';else do{id=`synthetic-generated-${String(nextIdentity++).padStart(5,'0')}`;}while(desired&&auditPurpose(id,{seed:auditSeed})!==desired);const doc_key=`${index+1}/000000000000000001/synthetic${index}.htm`,urls=contractURLs(doc_key);return {id,doc_key,cohort:index<1000?'discovery-relevant':'discovery-broad',format:'html',calibration:index<1000,source_url:urls.original,corpus_url:urls.corpus,metadata:{data_classification:classification}};});
  if(includeReserved){
    recipe.cohorts.push({id:'confirmation',target:2,labels:['services'],minYear:2000,maxYear:2021,sealed:true},{id:'temporal',target:1,labels:['services'],minYear:2022,maxYear:2026,sealed:true});
    for(const [index,id]of ['synthetic-eval-1','synthetic-eval-2','synthetic-later'].entries()){
      const doc_key=`${2000+index}/000000000000000001/synthetic-reserved-${index}.htm`,urls=contractURLs(doc_key);
      members.push({id,doc_key,cohort:index<2?'confirmation':'temporal',format:'html',calibration:false,source_url:urls.original,corpus_url:urls.corpus,metadata:{data_classification:classification,sealed:true}});
    }
  }
  await writeJSON(root,'recipe.json',recipe);
  const selection=await writeRows(root,'selection.parquet',members,{schema:{id:'VARCHAR',doc_key:'VARCHAR',cohort:'VARCHAR',format:'VARCHAR',calibration:'BOOLEAN',source_url:'VARCHAR',corpus_url:'VARCHAR',metadata:'JSON'}});
  await writeJSON(root,'census.json',{data_classification:classification,records:members.length});await writeJSON(root,'feasibility.json',{data_classification:classification,status:'READY'});
  await writeJSON(root,'study.json',{status:'READY',selected:members.length,recipe_digest:digest(recipe),recipe_file:await hashFile(join(root,'recipe.json')),sources:[],census_file:await hashFile(join(root,'census.json')),feasibility_file:await hashFile(join(root,'feasibility.json')),selection});
  const source=await extractionSourceIdentity(recipe),records=[],cache=[],parents=new Map();
  await mkdir(join(root,'raw'));await mkdir(join(root,'normalized'));
  for(const [index,row] of members.slice(0,994).entries()){
    const text=index<2?'Declared synthetic exhibit image reference only.':`Declared synthetic contract ${row.id}. The supplier shall perform the agreed service after the customer provides safe access. Unless the agreed condition is satisfied, additional work requires a separately authorized agreement.`;
    const rawPath=`raw/${row.id}.html`,raw=index<2?`<p>${text}</p><img src="synthetic-unavailable-image.gif">`:`<h2>1. Synthetic performance</h2><p>${text}</p>`;await writeFile(join(root,rawPath),raw);
    const parent={id:`${row.id}:parent`,contract_id:row.id,start:0,end:text.length,text,sha256:sha256(text)};
    const result={data_classification:classification,contract:{...row,path:rawPath},source,status:index<2?'rejected':'accepted',normalized_text:text,normalized_sha256:sha256(text),raw_sha256:sha256(raw),sections:index<2?[]:[parent],units:[],excluded:[],warnings:[]};
    const path=`extraction-cache/${row.id}.json`,artifact=await writeJSON(root,path,result);cache.push({id:row.id,...artifact,raw_sha256:result.raw_sha256,source_sha256:source.sha256,result_sha256:digest(result)});
    const normalizedPath=`normalized/${row.id}.txt`;if(index>=2)await writeFile(join(root,normalizedPath),text);
    records.push({id:row.id,cohort:row.cohort,status:result.status,raw_sha256:result.raw_sha256,...(index>=2?{normalized_path:normalizedPath,normalized_sha256:sha256(text)}:{})});
    parents.set(row.id,index<2?{...parent,id:`${row.id}:normalized-document`}:parent);
  }
  const missing=members.slice(994,1000).map(row=>({id:row.id,cohort:row.cohort,acquisition_status:'TERMINAL_DOWNLOAD_FAILURE',acquisition_failure:'CONTRACT_BYTE_LIMIT'}));
  const extraction={schema_version:2,data_classification:classification,status:'EXTRACTION_RESEARCH_ONLY',authority:'NONE',adopted_catalog:false,scope:'calibration-1000',source,
    requested_contracts:1000,eligible_prefix_contracts:1000,selected_prefix_terminal_complete:true,contracts:994,accepted:992,rejected:2,contract_records:records,missing_contracts:missing,cache,
    input_snapshot:{selection_sha256:selection.sha256,recipe_sha256:(await hashFile(join(root,'recipe.json'))).sha256,eligible_ids:members.slice(0,1000).map(row=>row.id),available:records.map(row=>({id:row.id,cohort:row.cohort,raw_sha256:row.raw_sha256})),missing},
    terminal_selection_status:{declared_prefix:1000,raw_committed:994,raw_processed:994,terminal_download_failures:6,pending_or_unattempted:0}};
  extraction.input_sha256=digest(extraction.input_snapshot);
  const exposure={data_classification:classification,source_exposed_contract_ids:[members[900].id]};await writeJSON(root,'reviews/prior-exposure.json',exposure);
  const protocol={status:'PREDECLARED_FRESH_REPAIR_AUDIT',data_classification:classification,fresh_scope:'ACCEPTED_RECONSTRUCTABLE_SOURCE',rejection_controls:'ALL_REJECTED_SOURCES',excluded_contract_ids:exposure.source_exposed_contract_ids,exposure_records:[{path:'reviews/prior-exposure.json',...await hashFile(join(root,'reviews/prior-exposure.json'))}]};
  await writeJSON(root,'audits/protocol.json',protocol);
  const auditRow=(row,purpose,index)=>{const {text,...parent}=parents.get(row.id),receipt=cache.find(value=>value.id===row.id);parent.cache_pointer=records.find(value=>value.id===row.id).status==='rejected'?'/normalized_text':'/sections/0';return {audit_id:`${purpose}-${index}`,contract_id:row.id,parent,lineage:{cache_path:receipt.path,cache_sha256:receipt.sha256,raw_path:`raw/${row.id}.html`,raw_sha256:receipt.raw_sha256,normalized_path:records.find(value=>value.id===row.id).normalized_path??null,normalized_sha256:sha256(text),cohort:row.cohort}};};
  const freshRows=members.slice(300,400).map((row,index)=>auditRow(row,'fresh_representation',index));
  const devRows=members.slice(2,202).map((row,index)=>auditRow(row,'development',index));
  const integrityRows=members.slice(0,2).map((row,index)=>auditRow(row,'source_integrity',index));
  const data={root,recipe,members,source,extraction,protocol,freshRows,devRows,integrityRows,auditRow};if(mutate)await mutate(data);
  await writeJSON(root,options.extractionPath,extraction);
  const packetSource={seed:auditSeed,extraction_source:source,input_manifest:{path:options.extractionPath,...await hashFile(join(root,options.extractionPath))},input_recipe:await hashFile(join(root,'recipe.json')),protocol:{path:'audits/protocol.json',...await hashFile(join(root,'audits/protocol.json'))},unique_fresh_parent_sections:true};packetSource.sha256=digest(packetSource);
  const packet=(purpose,rows)=>({schema_version:2,data_classification:classification,status:'AUDIT_NOT_RUN',authority:'NONE',purpose,source:packetSource,target:rows.length,count:rows.length,rows});
  await writeJSON(root,options.packetPath,packet('fresh_representation',freshRows));await writeJSON(root,'audits/development.json',packet('development',devRows));await writeJSON(root,'audits/source_integrity.json',packet('source_integrity',integrityRows));
  const review=async(purpose,rows,packetPath)=>({data_classification:classification,status:'REVIEWED',purpose,reviewer:'Synthetic fixture author; never an actual review',extraction_source_sha256:source.sha256,packet_path:packetPath,packet_sha256:(await hashFile(join(root,packetPath))).sha256,judgments:rows.map(row=>({audit_id:row.audit_id,context_adequate:true,heading_adequate:true,material_loss_observed:false,unresolved_material_loss:false,reading:purpose==='source_integrity'?'ORIGINAL_MARKUP_AND_RETAINED_TEXT':'FULL_PARENT_AND_SOURCE',reason:'Declared synthetic source preservation judgment used only to exercise the gate.',...(purpose==='source_integrity'?{exclusion_supported:true}:{})}))});
  await writeJSON(root,options.reviewPath,await review('fresh_representation',freshRows,options.packetPath));await writeJSON(root,options.developmentReviewPath,await review('development',devRows,'audits/development.json'));await writeJSON(root,options.integrityReviewPath,await review('source_integrity',integrityRows,'audits/source_integrity.json'));
  return {...data,options};
}

export async function registerSyntheticSourceIssue(data){
  const {root,members}=data,originalPacket=await readJSON(root,options.packetPath),row=data.auditRow(members[500],'coding',1);
  await writeJSON(root,'audits/other-pool.json',{data_classification:classification,purpose:'coding',source:originalPacket.source,rows:[row]});
  const text=await readFile(join(root,row.lineage.normalized_path),'utf8'),raw=await readFile(join(root,row.lineage.raw_path),'utf8');
  const evidence={schema:'literal-source-boundary-finding-v1',data_classification:classification,packet:{path:'audits/other-pool.json',...await hashFile(join(root,'audits/other-pool.json'))},audit_id:row.audit_id,contract_id:row.contract_id,parent:{normalized_start:row.parent.start,normalized_end:row.parent.end,characters:text.length,sha256:row.parent.sha256,actual_read_ranges:[[0,text.length]]},raw:{path:row.lineage.raw_path,sha256:row.lineage.raw_sha256,actual_read_ranges:[[0,raw.length]]},finding:'Declared synthetic known source loss from another audit pool, exercising the global hold.',literal_governor:text,literal_list_examples:['1. Synthetic performance'],literal_cost_examples:[],reviewer_kind:classification,authority:'NONE'};
  const observed=await writeJSON(root,'reviews/other-pool-failure.json',evidence);
  return registerObservedSourceIssue(root,{evidencePath:observed.path,evidenceSHA:observed.sha256});
}

export async function syntheticFrozenFixture(t){
  // Control-only freeze with a real passed synthetic source gate. It is not a
  // full-study candidate-freeze result and claims none of the research outcomes.
  const quality=await qualityFixture(t,{includeReserved:true}),{root:run,recipe}=quality;
  const gate=await sealQualityGate(run,options),study=await readJSON(run,'study.json');
  const {files,rules}=await evaluationMethodBindings(),here=dirname(fileURLToPath(import.meta.url));
  const catalogPath='../../../../src/binding.rs',catalog={path:catalogPath,...await hashFile(resolve(here,'../../lib',catalogPath))};
  const allocation=JSON.parse(await readFile(resolve(here,'../../main-unit-budget.json'),'utf8'));await writeJSON(run,'main-unit-budget.json',allocation);
  const allocationBinding={path:'main-unit-budget.json',...await hashFile(join(run,'main-unit-budget.json'))};
  await writeJSON(run,'synthetic-input.json',{data_classification:classification});const input={path:'synthetic-input.json',...await hashFile(join(run,'synthetic-input.json'))};
  const inputs=Object.fromEntries(['candidates','discovery','admission','embeddings','geometry','sensitivity','quality_gate','coding','probes','negative','novelty'].map(key=>[key,input]));
  inputs.discovery={path:options.extractionPath,...await hashFile(join(run,options.extractionPath))};inputs.quality_gate={path:gate.manifest_path,...await hashFile(join(run,gate.manifest_path))};
  await writeJSON(run,'synthetic-primary.json',{data_classification:classification,centroids:[1,...Array(383).fill(0)],dimensions:384,effective_k:1});
  const primary_centroids={path:'synthetic-primary.json',...await hashFile(join(run,'synthetic-primary.json'))};
  const resolution={candidate_history:[{id:'synthetic-retired-framing',disposition:'UNRESOLVED',reason:'Synthetic control retains an unresolved consideration rather than silently omitting it.'}],empty_card_resolution:{status:'UNRESOLVED_NO_CANDIDATES',reason:'Synthetic control declares no candidate meanings have been established.'}};
  const body={schema_version:2,status:'CANDIDATE_MEANINGS_AND_EVALUATION_FROZEN',data_classification:classification,authority:'NONE',adopted_catalog:false,identity:{recipe_digest:study.recipe_digest,selection:study.selection,allocation:allocationBinding},inputs,protocols:{novelty:input},methods:files,catalog,cards:[],...resolution,rules,seed:'SYNTHETIC_TEST_ONLY',main_unit_ceiling:recipe.extraction.maxUnits,discovery_limit:200000,discovery_units:1,unit_budgets:{confirmation:60000,temporal:40000},query_vectors:null,primary_centroids};
  const freeze={...body,freeze_sha256:digest(body)};await writeJSON(run,'evaluation/candidate-freeze.json',freeze);
  return {run,freeze,quality};
}
