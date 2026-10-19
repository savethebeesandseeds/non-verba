// SPDX-License-Identifier: AGPL-3.0-only
import {readFile,writeFile,mkdir,link,unlink} from 'node:fs/promises';
import {dirname,relative,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {sha256,digest,readJSON,requireContainer} from '../../lib/common.mjs';
import {STUDY_BASE,assertUnlinked,writeRows,readRows,readLedger,hashFile,studyPath,validateStudyRoot,directoryBytes,readJSON as readStudyJSON,writeExtractionCache,validateExtractionAccountingPolicy,extractionAccountingProvenance} from './store.mjs';
import {readAcquired,verifyStudy} from './acquisition.mjs';
import {extractSections,selectUnits,NATIVE_COLLECTOR_POLICY} from './sections.mjs';
import {storeNativeDecoration,loadNativeDecoration} from './native-decoration-store.mjs';

const sourceRoot=dirname(fileURLToPath(import.meta.url));
const schema={id:'VARCHAR',contract_id:'VARCHAR',cohort:'VARCHAR',kind:'VARCHAR',payload:'VARCHAR'};
const discovery=new Set(['discovery-broad','discovery-relevant']);

function managedArtifact(path){
  const absolute=resolve(path);if(!absolute.startsWith(`${STUDY_BASE}/`))throw new Error('Workflow artifact requires its managed study root');
  const run=resolve(STUDY_BASE,absolute.slice(STUDY_BASE.length+1).split('/')[0]);validateStudyRoot(run);
  return {run,name:relative(run,absolute)};
}

function storageBudget(budget,bytes){if(budget&&(!Number.isSafeInteger(budget.used)||!Number.isSafeInteger(budget.limit)||budget.used<0||budget.limit<budget.used||budget.used+bytes>budget.limit))throw new Error('Extraction exceeds remaining study storage budget');}

export async function atomicJSON(path,value,{budget}={}){
  digest(value);const {run,name}=managedArtifact(path);path=await studyPath(run,name,{missing:true});
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
  try{const old=await readFile(path);if(sha256(old)!==sha256(bytes))throw new Error(`Immutable artifact already differs: ${path}`);return {path,bytes:old.length,sha256:sha256(old),resumed:true};}catch(error){if(error.code!=='ENOENT')throw error;}
  storageBudget(budget,bytes.length*2);
  await mkdir(dirname(path),{recursive:true});await assertUnlinked(dirname(path));const partial=`${path}.${randomUUID()}.partial`;
  await writeFile(partial,bytes,{flag:'wx'});
  let resumed=false;
  try{await link(partial,path);}catch(error){if(error.code!=='EEXIST')throw error;const old=await readFile(path);if(sha256(old)!==sha256(bytes))throw new Error(`Immutable concurrent artifact differs: ${path}`);resumed=true;}finally{await unlink(partial).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  if(budget&&!resumed)budget.used+=bytes.length;
  return {path,bytes:bytes.length,sha256:sha256(bytes),resumed};
}

async function stageIdentity(recipe){
  const names=['sections.mjs','source-decoration.mjs','native-decoration-store.mjs','source-issues.mjs','representation-issues.mjs','representation-replay.mjs','audit-reader.mjs','representation.mjs','embedding.mjs','analysis.mjs','sensitivity.mjs','workflow.mjs','store.mjs','acquisition.mjs','../comparison-recipe.json','../../lib/common.mjs','../../lib/acquire.mjs','../../lib/analyze.mjs','../../lib/extract.mjs','../../lib/embed.mjs','../../lib/discover.mjs','../../package.json','../../package-lock.json'];
  const files=[];for(const name of names)files.push({path:name,sha256:sha256(await readFile(resolve(sourceRoot,name)))});
  const identity={parameters:{extraction:recipe.extraction,native_input_profile:{baseline_embedding:recipe.embedding??null},selection_seed:recipe.seed,selection_authority:'PROVISIONAL_PER_CONTRACT_ONLY_GLOBAL_ADMISSION_SEPARATE'},files,runtime:{node:process.version,platform:process.platform,architecture:process.arch}};
  return {...identity,sha256:digest(identity)};
}
export {stageIdentity as extractionSourceIdentity};

async function stableShard(runDir,path,rows,{accountingPolicy,totalBytes}={}){
  const records_sha256=digest(rows),sidecar=`${path}.manifest.json`;
  try{
    const old=await readJSON(await studyPath(runDir,sidecar));const actual=await hashFile(await studyPath(runDir,path));
    if(old.path!==path||old.rows!==rows.length||old.records_sha256!==records_sha256||old.sha256!==actual.sha256||old.bytes!==actual.bytes||digest(old.schema)!==digest(schema))throw new Error('Resume shard differs from retained source rows');return old;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  let artifact;
  try{const actual=await hashFile(await studyPath(runDir,path));const retained=[];for await(const row of readRows(runDir,path))retained.push(row);if(digest(retained)!==records_sha256)throw new Error('Orphan committed shard differs from retry rows');artifact={path,rows:retained.length,...actual,schema,execution_attested:false};}
  catch(error){if(error.code!=='ENOENT')throw error;artifact=await writeRows(runDir,path,rows,{schema,accountingPolicy,totalBytes});}
  const manifest={...artifact,records_sha256};await atomicJSON(await studyPath(runDir,sidecar,{missing:true}),manifest);return manifest;
}

async function validateCache(result,record,source,{runDir,content}){
  if(result.contract?.id!==record.id||result.contract?.cohort!==record.cohort||result.raw_sha256!==record.acquisition.sha256||result.source?.sha256!==source.sha256||sha256(result.normalized_text)!==result.normalized_sha256)throw new Error('Cached extraction source identity differs');
  const parents=new Map();
  const check=row=>{if(!Number.isSafeInteger(row.start)||!Number.isSafeInteger(row.end)||row.start<0||row.end<row.start||result.normalized_text.slice(row.start,row.end)!==row.text||sha256(row.text)!==row.sha256||row.contract_id!==record.id)throw new Error('Cached extraction normalized offset/hash mismatch');};
  for(const parent of result.sections){check(parent);if(parents.has(parent.id))throw new Error('Duplicate cached section');parents.set(parent.id,parent);}
  const ids=new Set();for(const unit of result.units){check(unit);const parent=parents.get(unit.parent_section_id);if(ids.has(unit.id)||!parent||unit.start<parent.start||unit.end>parent.end)throw new Error('Cached unit parent lineage differs');ids.add(unit.id);}
  const envelope=await loadNativeDecoration(runDir,result.native_source_decorations);
  const {verifyNativeDecorationEnvelope}=await import('./source-decoration.mjs');
  verifyNativeDecorationEnvelope(envelope,{raw:content,normalizedText:result.normalized_text});
  const identity=nativeIdentity(source);
  if(envelope.tracer_source_sha256!==identity.tracerSourceSHA256||envelope.collector_source_sha256!==identity.collectorSourceSHA256||envelope.raw.sha256!==sha256(content)||envelope.normalized.sha256!==result.normalized_sha256)throw new Error('Cached native source method binding differs');
  for(const row of [...result.sections,...result.units,...result.sections.flatMap(parent=>parent.units??[])]){
    const ref=row.native_source_decorations_ref;
    if(!ref||ref.envelope_sha256!==envelope.sha256||ref.raw_sha256!==envelope.raw.sha256||ref.normalized_sha256!==envelope.normalized.sha256||ref.tracer_source_sha256!==identity.tracerSourceSHA256||ref.collector_source_sha256!==identity.collectorSourceSHA256||ref.policy!==envelope.policy||ref.collector_policy!==NATIVE_COLLECTOR_POLICY||ref.projection_required!==true||ref.mapping_status!==envelope.mapping_status||ref.input_eligibility!==envelope.input_eligibility||ref.start!==row.start||ref.end!==row.end)throw new Error('Cached native unit source reference differs');
  }
}

function nativeIdentity(source){const file=name=>source.files.find(row=>row.path===name)?.sha256;return {tracerSourceSHA256:file('source-decoration.mjs'),collectorSourceSHA256:file('sections.mjs')};}

async function cachedExtraction(runDir,record,recipe,source,budget){
  const name=`extraction-cache/${source.sha256.slice(0,16)}/${record.id}.json.gz`,sidecar=`${name}.manifest.json`,path=await studyPath(runDir,name,{missing:true});
  const rawBytes=await readFile(record.raw_path);if(sha256(rawBytes)!==record.acquisition.sha256)throw new Error('Native retained raw source binding differs');const content=rawBytes.toString('utf8');
  let result,receipt;
  try{result=await readStudyJSON(runDir,name,{maxBytes:64*1024**2});receipt=await readJSON(await studyPath(runDir,sidecar));const actual=await hashFile(path);if(receipt.id!==record.id||receipt.raw_sha256!==record.acquisition.sha256||receipt.source_sha256!==source.sha256||receipt.sha256!==actual.sha256||receipt.bytes!==actual.bytes||receipt.result_sha256!==digest(result))throw new Error('Cached extraction receipt digest differs');}
  catch(error){
    if(error.code!=='ENOENT')throw error;
    const fresh={...extractSections({...record,content},{...recipe.extraction,nativeDecorationIdentity:nativeIdentity(source)}),raw_sha256:record.acquisition.sha256,source};
    const native=await storeNativeDecoration(runDir,`native-decorations/${source.sha256.slice(0,16)}/${record.id}.json.gz`,fresh.native_source_decorations,{remainingBytes:budget.limit-budget.used});
    budget.used+=native.added_bytes;fresh.native_source_decorations=native.reference;
    if(result&&digest(result)!==digest(fresh))throw new Error('Orphan cached extraction differs from verified raw-source replay');
    result=result??fresh;const stored=await writeExtractionCache(runDir,name,result,{remainingBytes:budget.limit-budget.used});budget.used+=stored.added_bytes;
    receipt={id:record.id,...stored.artifact,storage:stored.storage,raw_sha256:record.acquisition.sha256,source_sha256:source.sha256,result_sha256:digest(result)};
    await atomicJSON(await studyPath(runDir,sidecar,{missing:true}),receipt,{budget});
  }
  await validateCache(result,record,source,{runDir,content});return {result,receipt};
}

async function normalizedArtifact(runDir,name,text,budget){
  const path=await studyPath(runDir,name,{missing:true}),bytes=Buffer.from(text);
  try{const actual=await hashFile(path);if(actual.sha256!==sha256(bytes)||actual.bytes!==bytes.length)throw new Error('Normalized source changed');return actual;}catch(error){if(error.code!=='ENOENT')throw error;}
  storageBudget(budget,bytes.length*2);
  await mkdir(dirname(path),{recursive:true});await assertUnlinked(dirname(path));const partial=`${path}.${randomUUID()}.partial`;await writeFile(partial,bytes,{flag:'wx'});let resumed=false;
  try{await link(partial,path);}catch(error){if(error.code!=='EEXIST')throw error;const actual=await hashFile(path);if(actual.sha256!==sha256(bytes)||actual.bytes!==bytes.length)throw new Error('Concurrent normalized source differs');resumed=true;}finally{await unlink(partial).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  if(budget&&!resumed)budget.used+=bytes.length;
  return hashFile(path);
}

export async function extractStudy(runDir,{limit=1000,calibrationOnly=true,log=console.log,accountingPolicy}={}){
  requireContainer();if(!Number.isSafeInteger(limit)||limit<1||limit>10_000||typeof calibrationOnly!=='boolean')throw new Error('Invalid explicit extraction scope');
  accountingPolicy=validateExtractionAccountingPolicy(accountingPolicy);const storage_accounting=extractionAccountingProvenance(accountingPolicy);
  const {recipe,study}=await verifyStudy(runDir);if(study.status!=='READY')throw new Error('Extraction requires frozen ready cohort membership');
  const source=await stageIdentity(recipe),eligible=[],budget={used:await directoryBytes(validateStudyRoot(runDir),{accountingPolicy}),limit:recipe.limits.totalBytes};storageBudget(budget,0);
  for await(const row of readRows(runDir,study.selection.path))if(discovery.has(row.cohort)&&(!calibrationOnly||row.calibration)&&eligible.length<limit)eligible.push(row);
  const wanted=new Set(eligible.map(row=>row.id)),available=new Map();
  for await(const record of readAcquired(runDir,{cohorts:recipe.cohorts.filter(cohort=>discovery.has(cohort.id)).map(cohort=>cohort.id),calibrationOnly,contractIds:[...wanted]}))available.set(record.id,record);
  const failures=new Map();for await(const event of readLedger(runDir))if(event.kind==='download-failed'&&wanted.has(event.id))failures.set(event.id,event.error);
  const inputSnapshot={selection_sha256:study.selection.sha256,recipe_sha256:study.recipe_file.sha256,eligible_ids:eligible.map(row=>row.id),available:eligible.filter(row=>available.has(row.id)).map(row=>({id:row.id,cohort:row.cohort,raw_sha256:available.get(row.id).acquisition.sha256})),missing:eligible.filter(row=>!available.has(row.id)).map(row=>({id:row.id,cohort:row.cohort,reason:'NO_COMMITTED_RAW_SOURCE_IN_DECLARED_PREFIX',acquisition_status:failures.has(row.id)?'TERMINAL_DOWNLOAD_FAILURE':'PENDING_OR_UNATTEMPTED',acquisition_failure:failures.get(row.id)??null}))};
  const input_sha256=digest(inputSnapshot),scope=`${calibrationOnly?'calibration':'discovery'}-${limit}`,prefix=`processing/${source.sha256.slice(0,16)}/${scope}-${input_sha256.slice(0,16)}`;
  const manifestName=`${prefix}/extraction-manifest.json`,finalPath=await studyPath(runDir,manifestName,{missing:true});
  const units=[],parents=[],exclusions=[],contracts=[],cache=[];let count=0,rejected=0,shardNumber=0;const shards={units:[],sections:[],exclusions:[]};
  const flush=async()=>{if(!units.length&&!parents.length&&!exclusions.length)return;const tag=String(shardNumber++).padStart(5,'0');for(const [kind,rows] of [['units',units],['sections',parents],['exclusions',exclusions]])if(rows.length)shards[kind].push(await stableShard(runDir,`${prefix}/${kind}-${tag}.parquet`,rows.splice(0),{accountingPolicy,totalBytes:recipe.limits.totalBytes}));budget.used=await directoryBytes(validateStudyRoot(runDir),{accountingPolicy});storageBudget(budget,0);};
  for(const member of eligible){
    const record=available.get(member.id);if(!record)continue;count++;
    const {result,receipt}=await cachedExtraction(runDir,record,recipe,source,budget);cache.push(receipt);
    const common={id:record.id,cohort:record.cohort,status:result.status,source_url:record.source_url,raw_sha256:record.acquisition.sha256,extraction_excluded:result.excluded,warnings:result.warnings,native_source_decorations:result.native_source_decorations};
    if(result.status!=='accepted'){rejected++;contracts.push(common);continue;}
    const selected=selectUnits(result.units,{seed:recipe.seed,maxPerContract:recipe.extraction.maxPerContract,maxUnits:Number.MAX_SAFE_INTEGER});
    const normalizedPath=`normalized/${source.sha256.slice(0,16)}/${record.id}.txt`;await normalizedArtifact(runDir,normalizedPath,result.normalized_text,budget);
    contracts.push({...common,normalized_path:normalizedPath,normalized_sha256:result.normalized_sha256,sections:result.sections.length,selected_units:selected.selected.length,excluded_units:selected.excluded.length,coverage:selected.coverage,selection_parameters:selected.parameters,selection_is_provisional:true});
    for(const section of result.sections){const parent={...section};delete parent.units;parents.push({id:section.id,contract_id:record.id,cohort:record.cohort,kind:section.kind??'unknown',payload:JSON.stringify({...parent,normalized_path:normalizedPath})});}
    for(const unit of selected.selected)units.push({id:unit.id,contract_id:record.id,cohort:record.cohort,kind:unit.kind??'unknown',payload:JSON.stringify({...unit,cohort:record.cohort,source_url:record.source_url,normalized_path:normalizedPath})});
    for(const item of selected.excluded)exclusions.push({id:item.id,contract_id:record.id,cohort:record.cohort,kind:item.kind??'unknown',payload:JSON.stringify({...item,selection_is_provisional:true})});
    if(units.length>=5000||parents.length>=5000||exclusions.length>=5000)await flush();
    if(count%100===0)log(`Extracted ${count} contracts; ${rejected} rejected; ${contracts.reduce((n,row)=>n+(row.selected_units??0),0)} provisional units`);
  }
  await flush();
  const terminalFailures=inputSnapshot.missing.filter(row=>row.acquisition_status==='TERMINAL_DOWNLOAD_FAILURE').length,pending=inputSnapshot.missing.length-terminalFailures;
  const terminalSelectionStatus={declared_prefix:eligible.length,raw_committed:available.size,raw_processed:count,terminal_download_failures:terminalFailures,pending_or_unattempted:pending};
  const manifest={schema_version:2,status:'EXTRACTION_RESEARCH_ONLY',scope,source,storage_accounting,input_snapshot:inputSnapshot,input_sha256,requested_contracts:limit,eligible_prefix_contracts:eligible.length,input_complete:inputSnapshot.missing.length===0,raw_coverage_complete:inputSnapshot.missing.length===0,selected_prefix_terminal_complete:pending===0&&count===available.size,terminal_selection_status:terminalSelectionStatus,missing_contracts:inputSnapshot.missing,contracts:count,accepted:count-rejected,rejected,selected_units:contracts.reduce((n,row)=>n+(row.selected_units??0),0),sections:contracts.reduce((n,row)=>n+(row.sections??0),0),excluded_units:contracts.reduce((n,row)=>n+(row.excluded_units??0),0),selection_authority:'PROVISIONAL_PER_CONTRACT_ONLY_GLOBAL_ADMISSION_SEPARATE',contract_records:contracts,shards,cache,authority:'NONE',adopted_catalog:false};
  await atomicJSON(finalPath,manifest,{budget});return {...manifest,manifest_path:manifestName};
}

export async function* readUnits(runDir,manifest){
  for(const shard of manifest.shards.units){const actual=await hashFile(await studyPath(runDir,shard.path));if(actual.sha256!==shard.sha256||actual.bytes!==shard.bytes)throw new Error('Retained unit shard changed');for await(const row of readRows(runDir,shard.path)){const value=JSON.parse(row.payload);if(value.id!==row.id||value.contract_id!==row.contract_id||value.cohort!==row.cohort||!discovery.has(row.cohort))throw new Error('Retained unit row source lineage differs');yield value;}}
}

export async function makeAuditPacket(runDir,manifest,{count=1000}={}){
  if(!Number.isSafeInteger(count)||count<1||count>2000)throw new Error('Invalid bounded audit count');
  const {buildAuditPackets}=await import('./audit.mjs');const development=Math.floor(count*.2),fresh_representation=Math.floor(count*.1),coding=Math.floor(count*.5),negative=count-development-fresh_representation-coding;
  const result=await buildAuditPackets(runDir,manifest,{counts:{development,fresh_representation,coding,negative}});
  return {...result,path:result.manifest_path,count:Object.values(result.packets).reduce((sum,packet)=>sum+packet.count,0)};
}
