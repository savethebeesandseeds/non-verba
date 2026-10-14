// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { digest, sha256, stableId } from '../../lib/common.mjs';
import { ORIGIN, contractURLs } from '../../lib/acquire.mjs';
import { verifyAcquisition } from '../../lib/analyze.mjs';
import { STUDY_BASE, appendLedger, assertUnlinked, directoryBytes, hashFile, openDatabase, readJSON, readLedger, readRows, sqlQuote, studyPath, validateStudyRoot, writeJSON, writeRows } from './store.mjs';

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const safeInteger = (value, minimum, maximum, name) => { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`); return value; };
const selectionSchema = { id:'VARCHAR',doc_key:'VARCHAR',cik:'VARCHAR',cohort:'VARCHAR',label:'VARCHAR',year:'INTEGER',format:'VARCHAR',source_url:'VARCHAR',corpus_url:'VARCHAR',sampling_stratum:'VARCHAR',cohort_rank:'INTEGER',study_rank:'INTEGER',discovery_rank:'INTEGER',calibration:'BOOLEAN',sealed:'BOOLEAN',metadata:'JSON' };
async function toolSource(){const files=[];for(const name of ['acquisition.mjs','store.mjs'])files.push({path:`study-v0.2/lib/${name}`,sha256:sha256(await readFile(new URL(name,import.meta.url)))});return {files,sha256:digest(files),base_revision:process.env.NONVERBA_SOURCE_REVISION??null,snapshot_sha256:process.env.NONVERBA_SOURCE_SNAPSHOT_SHA256??null,source_dirty:process.env.NONVERBA_SOURCE_DIRTY??null};}
function validateDownloadEvent(row,event,recipe){if(event.id!==row.id||event.cohort!==row.cohort||event.url!==row.corpus_url||event.raw_path!==`raw/${row.id}.${row.format==='text'?'txt':'html'}`||!/^[a-f0-9]{64}$/.test(event.sha256)||!Number.isSafeInteger(event.bytes)||event.bytes<1||event.bytes>recipe.limits.contractBytes)throw new Error('Download ledger source lineage mismatch');}

function validateRecipe(recipe) {
  digest(recipe);
  if (typeof recipe.seed !== 'string' || !recipe.seed || !Array.isArray(recipe.cohorts) || !recipe.cohorts.length || recipe.cohorts.length > 8) throw new Error('Study requires an explicit seed and cohort recipe');
  safeInteger(recipe.maxPerFiler, 1, 20, 'filer cap');
  const ids = new Set();
  for (const cohort of recipe.cohorts) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(cohort.id) || ids.has(cohort.id) || !Array.isArray(cohort.labels) || !cohort.labels.length || cohort.labels.some(label => typeof label !== 'string' || !label)) throw new Error('Invalid explicit cohort labels/id');
    ids.add(cohort.id); safeInteger(cohort.target, 1, 30_000, 'cohort target');
    safeInteger(cohort.minYear, 1900, 2100, 'cohort minimum year'); safeInteger(cohort.maxYear, cohort.minYear, 2100, 'cohort maximum year');
  }
  for (const [key, ceiling] of [['contractBytes',4*1024**2],['rawBytes',8*1024**3],['totalBytes',24*1024**3]]) safeInteger(recipe.limits?.[key], 1, ceiling, key);
  safeInteger(recipe.limits.requestIntervalMs, 1000, 60_000, 'request interval');
  if(recipe.excludedFlags && (!Array.isArray(recipe.excludedFlags)||recipe.excludedFlags.some(flag=>!['amend','restate','joinder','termination'].includes(flag))))throw new Error('Unsupported metadata exclusion flag');
}

/** Metadata-only deterministic allocation; shortages block freezing/acquisition. */
export function selectCohorts(candidateRows, recipe, { seenFilers = new Set() } = {}) {
  validateRecipe(recipe);
  const pools = new Map(); const eligibility = new Map(); const capacities = new Map();
  for (const cohort of recipe.cohorts) {
    const rows = (candidateRows[cohort.id] ?? []).filter(row => !(cohort.sealed || ['confirmation','temporal'].includes(cohort.id)) || !seenFilers.has(String(row.cik)));
    const byFiler = new Map(); const unique = new Set();
    for (const row of rows) {
      contractURLs(row.doc_key);
      if (unique.has(row.doc_key)) continue; unique.add(row.doc_key);
      const cik = String(row.cik ?? row.doc_key.split('/')[0]);
      if (!byFiler.has(cik)) byFiler.set(cik, []);
      byFiler.get(cik).push({...row,cik});
      if (!eligibility.has(cik)) eligibility.set(cik, new Set()); eligibility.get(cik).add(cohort.id);
    }
    const capacity = [...byFiler.values()].reduce((sum, rows) => sum + Math.min(recipe.maxPerFiler, rows.length), 0);
    capacities.set(cohort.id, capacity); pools.set(cohort.id, byFiler);
  }
  const order = [...recipe.cohorts].sort((a,b) => b.target/Math.max(1,capacities.get(b.id))-a.target/Math.max(1,capacities.get(a.id)) || a.id.localeCompare(b.id));
  const owner = new Map(); const selected = new Map(); const feasibility = [];
  for (const cohort of order) {
    const strata = new Map(); const chosen = []; const counts = new Map(); const keys = new Set();
    for (const rows of pools.get(cohort.id).values()) for (const row of rows) {
      const stratum = `${row.label}:${Math.floor(Number(row.year)/10)*10}`;
      const cost = [...eligibility.get(row.cik)].filter(id => id !== cohort.id && !selected.has(id)).reduce((sum,id)=>sum+(recipe.cohorts.find(c=>c.id===id).target/Math.max(1,capacities.get(id))),0);
      if (!strata.has(stratum)) strata.set(stratum, []);
      strata.get(stratum).push({ row, cost, rank:digest([recipe.seed,cohort.id,row.doc_key]) });
    }
    const buckets = [...strata].sort((a,b)=>a[0].localeCompare(b[0])).map(([id,rows])=>({id,rows:rows.sort((a,b)=>a.cost-b.cost||a.rank.localeCompare(b.rank)),position:0}));
    let progress = true;
    while (chosen.length < cohort.target && progress) {
      progress = false;
      for (const bucket of buckets) {
        if (chosen.length === cohort.target) break;
        while (bucket.position < bucket.rows.length) {
          const row = bucket.rows[bucket.position++].row;
          if (keys.has(row.doc_key) || (owner.has(row.cik) && owner.get(row.cik)!==cohort.id) || (counts.get(row.cik)??0)>=recipe.maxPerFiler) continue;
          owner.set(row.cik,cohort.id); counts.set(row.cik,(counts.get(row.cik)??0)+1); keys.add(row.doc_key);
          const urls = contractURLs(row.doc_key);
          chosen.push({ id:stableId('contract',row.doc_key),doc_key:row.doc_key,cik:row.cik,cohort:cohort.id,label:row.label,year:Number(row.year),format:row.content_type==='text/plain'?'text':'html',source_url:urls.original,corpus_url:urls.corpus,sampling_stratum:bucket.id,cohort_rank:chosen.length+1,sealed:Boolean(cohort.sealed),metadata:row });
          progress = true; break;
        }
      }
    }
    selected.set(cohort.id, chosen);
    feasibility.push({cohort:cohort.id,target:cohort.target,eligible_filers:pools.get(cohort.id).size,filer_capped_upper_bound:capacities.get(cohort.id),selected:chosen.length,shortfall:cohort.target-chosen.length,strata:buckets.map(bucket=>({id:bucket.id,candidates:bucket.rows.length,selected:chosen.filter(row=>row.sampling_stratum===bucket.id).length}))});
  }
  const discovery = recipe.cohorts.filter(cohort=>cohort.id.startsWith('discovery-')).map(cohort=>({cohort,rows:selected.get(cohort.id),position:0}));
  const ordered = [];
  while (discovery.some(bucket=>bucket.position<bucket.rows.length)) {
    const bucket = discovery.filter(bucket=>bucket.position<bucket.rows.length).sort((a,b)=>a.position/a.cohort.target-b.position/b.cohort.target||a.cohort.id.localeCompare(b.cohort.id))[0];
    ordered.push({...bucket.rows[bucket.position++],discovery_rank:ordered.length+1});
  }
  for (const cohort of recipe.cohorts.filter(cohort=>!cohort.id.startsWith('discovery-'))) ordered.push(...selected.get(cohort.id).map(row=>({...row,discovery_rank:null})));
  const calibrationCount = recipe.calibration?.contracts ?? 1000;
  const records = ordered.map((row,index)=>({...row,study_rank:index+1,calibration:row.discovery_rank!==null&&row.discovery_rank<=calibrationCount}));
  return {status:feasibility.some(row=>row.shortfall)?'CENSUS_REQUIRES_RECIPE_REVISION':'READY',records,feasibility,allocation_order:order.map(row=>row.id),method:'Metadata-only; scarce-cohort-first deterministic allocation; label/decade round robin; globally disjoint filers; no replacement or source-meaning inspection',limitation:'A greedy allocation shortage is not proof that every possible filer allocation is infeasible; per-cohort capped upper bounds are separately reported.'};
}

export async function initStudy(runDir, recipe, { sourceRun = recipe.sourceRun } = {}) {
  const root = validateStudyRoot(runDir); validateRecipe(recipe);
  await assertUnlinked(STUDY_BASE,{missing:true}); await mkdir(STUDY_BASE,{recursive:true}); await assertUnlinked(STUDY_BASE);
  try { const existing=await readJSON(root,'study.json');if(existing.recipe_digest!==digest(recipe))throw new Error('Existing study recipe differs; use a new named selection attempt');await verifyStudy(root);return existing; } catch(error) { if(error.code!=='ENOENT')throw error; }
  await mkdir(root); await writeJSON(root,'recipe.json',recipe);
  if(typeof sourceRun!=='string'||!resolve(sourceRun).startsWith('/opt/nonverba-build/priors-derivation/')||resolve(sourceRun).startsWith(`${STUDY_BASE}/`))throw new Error('Expected exact retained v0.1 corpus source run');
  await assertUnlinked(sourceRun);
  const {acquisition}=await verifyAcquisition(sourceRun);
  const sourceRecords=[];
  for(const record of acquisition.source_records) {
    if(!['sources/corpus-home.html','sources/codebook.md','sources/corpus-manifest.json','sources/index.parquet'].includes(record.path))continue;
    const original=resolve(sourceRun,record.path);await assertUnlinked(original);
    const target=await studyPath(root,record.path,{missing:true});await mkdir(dirname(target),{recursive:true});await copyFile(original,target,constants.COPYFILE_EXCL);
    const measured=await hashFile(target);if(measured.sha256!==record.sha256)throw new Error('Cached MCC source copy differs from v0.1 acquisition digest');
    sourceRecords.push({...record,...measured});
  }
  if(sourceRecords.length!==4)throw new Error('Retained v0.1 run does not contain the exact four MCC source artifacts');
  const pilotSample=JSON.parse(await readFile(resolve(sourceRun,'sample.json'),'utf8'));
  const seenFilers=new Set((pilotSample.selected??acquisition.records).map(row=>String(row.cik??row.doc_key.split('/')[0])));
  const metadata=await studyPath(root,'sources/index.parquet');const db=await openDatabase();let census,candidates={};
  try {
    const table=`read_parquet(${sqlQuote(metadata)})`;
    const schema=(await db.connection.runAndReadAll(`DESCRIBE SELECT * FROM ${table}`)).getRowObjectsJS();
    const names=schema.map(row=>row.column_name);const required=['doc_key','year','label','content_type','amend','joinder','termination'];
    if(required.some(name=>!names.includes(name)))throw new Error('Cached corpus metadata schema does not support the declared recipe');
    const total=(await db.connection.runAndReadAll(`SELECT count(*)::INTEGER AS records,min(year)::INTEGER AS min_year,max(year)::INTEGER AS max_year,count(DISTINCT split_part(doc_key,'/',1))::INTEGER AS filers FROM ${table}`)).getRowObjectsJS()[0];
    const populations=(await db.connection.runAndReadAll(`SELECT coalesce(label,'na') AS label,year::INTEGER AS year,content_type,count(*)::INTEGER AS records,count(DISTINCT split_part(doc_key,'/',1))::INTEGER AS filers FROM ${table} GROUP BY 1,2,3 ORDER BY 1,2,3`)).getRowObjectsJS();
    const flagNames=['amend','restate','joinder','termination'].filter(name=>names.includes(name));
    const flags=(await db.connection.runAndReadAll(`SELECT ${flagNames.join(',')},count(*)::INTEGER AS records FROM ${table} GROUP BY ${flagNames.map((_,index)=>index+1).join(',')} ORDER BY ${flagNames.map((_,index)=>index+1).join(',')}`)).getRowObjectsJS();
    census={schema_version:2,source_records:sourceRecords,schema,total,populations,flags,all_available_metadata:true,labels_are_unverified:true,pilot_seen_filers:[...seenFilers].sort(),recipe_bounds:recipe.cohorts,exclusions:recipe.excludedFlags??[],formats:['text/html','text/plain'],warnings:['Machine labels and flags are unverified metadata. Flags do not establish source completeness or legal equivalence.','Incomplete exhibits, amendments and noncontract controls remain eligible unless explicitly excluded in this frozen recipe.']};
    await writeJSON(root,'census.json',census);
    for(const cohort of recipe.cohorts) {
      const eligible=`year BETWEEN ${cohort.minYear} AND ${cohort.maxYear} AND coalesce(label,'na') IN (${cohort.labels.map(sqlQuote).join(',')}) AND content_type IN ('text/html','text/plain')${(recipe.excludedFlags??[]).map(flag=>` AND NOT coalesce(${flag},false)`).join('')}`;
      const columns=['doc_key','year','label','content_type',...['quarter','company_name','form_type','date_filed','amend','restate','joinder','termination'].filter(name=>names.includes(name))];
      const projected=columns.map(name=>name==='date_filed'?`CAST(${name} AS VARCHAR) AS ${name}`:name==='label'?`coalesce(label,'na') AS label`:name==='year'?`year::INTEGER AS year`:name).join(',');
      const query=`WITH ranked AS (SELECT ${projected},split_part(doc_key,'/',1) AS cik,row_number() OVER (PARTITION BY split_part(doc_key,'/',1),coalesce(label,'na'),year // 10 ORDER BY sha256(${sqlQuote(recipe.seed+':'+cohort.id+':')}||doc_key),doc_key) AS candidate_rank FROM ${table} WHERE ${eligible}) SELECT * EXCLUDE(candidate_rank) FROM ranked WHERE candidate_rank <= ${recipe.maxPerFiler}`;
      const count=(await db.connection.runAndReadAll(`SELECT count(*)::INTEGER AS records FROM (${query})`)).getRowObjectsJS()[0].records;
      if(count>400_000)throw new Error('Metadata candidate pool exceeds bounded calibration implementation; retain census and revise candidate strategy');
      candidates[cohort.id]=(await db.connection.runAndReadAll(query)).getRowObjectsJS();
    }
  }finally{db.close();}
  const selection=selectCohorts(candidates,recipe,{seenFilers});
  await writeJSON(root,'feasibility.json',{status:selection.status,cohorts:selection.feasibility,allocation_order:selection.allocation_order,method:selection.method,limitation:selection.limitation});
  let shard=null;
  if(selection.status==='READY')shard=await writeRows(root,'selection.parquet',selection.records,{schema:selectionSchema,totalBytes:recipe.limits.totalBytes});
  const study={schema_version:2,status:selection.status,name:recipe.name,authority:'NONE',adopted_catalog:false,execution_attested:false,tool_source:await toolSource(),recipe_digest:digest(recipe),recipe_file:await hashFile(await studyPath(root,'recipe.json')),sources:sourceRecords,corpus_version:acquisition.corpus_version,source_run:sourceRun,census_file:await hashFile(await studyPath(root,'census.json')),feasibility_file:await hashFile(await studyPath(root,'feasibility.json')),selection:shard,selected:shard?.rows??0,cohorts:selection.feasibility,calibration_contracts:selection.records.filter(row=>row.calibration).length,source_inspection:'No raw study contracts fetched or interpreted during metadata selection',created_at:new Date().toISOString()};
  await writeJSON(root,'study.json',study);return study;
}

export async function verifyStudy(runDir) {
  const study=await readJSON(runDir,'study.json');const recipe=await readJSON(runDir,'recipe.json');validateRecipe(recipe);
  if(digest(recipe)!==study.recipe_digest||(await hashFile(await studyPath(runDir,'recipe.json'))).sha256!==study.recipe_file.sha256)throw new Error('Frozen study recipe changed');
  for(const source of study.sources)if((await hashFile(await studyPath(runDir,source.path))).sha256!==source.sha256)throw new Error(`Frozen MCC source changed: ${source.path}`);
  for(const [name,record] of [['census.json',study.census_file],['feasibility.json',study.feasibility_file]])if((await hashFile(await studyPath(runDir,name))).sha256!==record.sha256)throw new Error(`Frozen study metadata changed: ${name}`);
  if(study.selection&&(await hashFile(await studyPath(runDir,study.selection.path))).sha256!==study.selection.sha256)throw new Error('Frozen cohort membership changed');
  return {study,recipe};
}

export function retryAfterMilliseconds(value, now=Date.now()) {
  if(!value)return 60_000;
  if(/^\d+(?:\.\d+)?$/.test(value)){const delay=Math.ceil(Number(value)*1000);return Number.isSafeInteger(delay)?Math.max(1000,delay):24*60*60*1000;}
  const date=Date.parse(value);return Number.isFinite(date)?Math.max(1000,date-now):60_000;
}

async function jobLock(runDir) {
  const path=await studyPath(runDir,'acquisition.lock',{missing:true});
  try {const old=JSON.parse(await readFile(path,'utf8'));try{process.kill(old.pid,0);throw new Error('An acquisition writer is already running');}catch(error){if(error.code!=='ESRCH')throw error;}const stale=await studyPath(runDir,`locks/stale-${randomUUID()}.json`,{missing:true});await mkdir(dirname(stale),{recursive:true});await link(path,stale);await unlink(path);}catch(error){if(error.code!=='ENOENT')throw error;}
  const token=randomUUID();await writeJSON(runDir,'acquisition.lock',{pid:process.pid,token});
  return async()=>{const value=JSON.parse(await readFile(path,'utf8'));if(value.token!==token)throw new Error('Acquisition lock identity changed');await unlink(path);};
}

/** One request in flight, durable document checkpoints, no failed-selection replacement. */
export async function acquireStudy(runDir,{limit=1000,cohorts=['discovery-broad','discovery-relevant'],fetcher=fetch,wait=sleep,now=Date.now,log=console.log}={}) {
  const {study,recipe}=await verifyStudy(runDir);if(study.status!=='READY')throw new Error('Census requires explicit recipe revision before any study download');
  safeInteger(limit,1,study.selected,'acquisition prefix');if(!Array.isArray(cohorts)||!cohorts.length||cohorts.some(id=>!recipe.cohorts.some(cohort=>cohort.id===id)))throw new Error('Unsupported acquisition cohorts');
  if(cohorts.some(id=>recipe.cohorts.find(cohort=>cohort.id===id)?.sealed)){const {assertReserveAccess}=await import('./evaluation.mjs');await assertReserveAccess(runDir,cohorts);}
  const selected=[];for await(const row of readRows(runDir,study.selection.path))if(cohorts.includes(row.cohort)&&selected.length<limit)selected.push(row);
  if(selected.some(row=>row.cohort.startsWith('discovery-')&&row.calibration!==true)){const {verifyCalibrationGate}=await import('./quality.mjs');await verifyCalibrationGate(runDir,{recipe});}
  const release=await jobLock(runDir);
  try {
    const committed=new Map(),ready=new Map(),failed=new Map();let pause=null,lastRequest=0;
    for await(const event of readLedger(runDir)) {if(event.kind==='download-committed')committed.set(event.id,event);if(event.kind==='download-ready')ready.set(event.id,event);if(event.kind==='download-failed')failed.set(event.id,event);if(event.kind==='throttle-pause')pause=event;if(event.kind==='request-started')lastRequest=Math.max(lastRequest,event.started_ms);}
    if(pause&&pause.next_eligible_ms>now())return {status:'PAUSED_THROTTLE',next_eligible_ms:pause.next_eligible_ms,selected:selected.length,acquired:committed.size};
    let used=await directoryBytes(validateStudyRoot(runDir));let rawUsed=0;
    for(const name of ['raw','raw-partials']) {const path=await studyPath(runDir,name,{missing:true});try{rawUsed+=await directoryBytes(path);}catch(error){if(error.code!=='ENOENT')throw error;}}
    const writeEvent=async event=>{if(used+Buffer.byteLength(JSON.stringify(event))+2048>recipe.limits.totalBytes)throw new Error('STUDY_BYTE_BUDGET');const entry=await appendLedger(runDir,event);used+=(await hashFile(await studyPath(runDir,entry.path))).bytes;return entry;};
    await writeEvent({kind:'acquisition-session',tool_source:await toolSource(),cohorts,limit,execution_attested:false});
    for(const row of selected) {
      if(committed.has(row.id)) {const event=committed.get(row.id);validateDownloadEvent(row,event,recipe);const actual=await hashFile(await studyPath(runDir,event.raw_path));if(actual.sha256!==event.sha256||actual.bytes!==event.bytes)throw new Error(`Committed raw source changed: ${row.id}`);continue;}
      if(failed.has(row.id))continue;
      if(ready.has(row.id)) {
        const event=ready.get(row.id);validateDownloadEvent(row,event,recipe);const destination=await studyPath(runDir,event.raw_path,{missing:true});
        let actual;try{actual=await hashFile(destination);}catch(error){if(error.code!=='ENOENT')throw error;const partial=await studyPath(runDir,event.partial_path);actual=await hashFile(partial);if(actual.sha256!==event.sha256||actual.bytes!==event.bytes)throw new Error('Interrupted ready artifact changed');await link(partial,destination);await unlink(partial);}
        if(actual.sha256!==event.sha256||actual.bytes!==event.bytes)throw new Error('Recovered raw artifact changed');
        const {entry_sha256,path,recorded_at,schema_version,...body}=event;
        const recovered=await writeEvent({...body,kind:'download-committed',recovered:true});
        committed.set(row.id,recovered);continue;
      }
      const urls=contractURLs(row.doc_key);if(urls.corpus!==row.corpus_url||new URL(urls.corpus).origin!==ORIGIN)throw new Error('Frozen corpus source URL mismatch');
      let terminalError=null;
      for(let attempt=1;attempt<=3;attempt++) {
        const delay=Math.max(0,lastRequest+recipe.limits.requestIntervalMs-now());if(delay)await wait(delay);
        lastRequest=now();const partialName=`raw-partials/${row.id}-${randomUUID()}.partial`;const partial=await studyPath(runDir,partialName,{missing:true});await mkdir(dirname(partial),{recursive:true});
        await writeEvent({kind:'request-started',id:row.id,cohort:row.cohort,url:urls.corpus,attempt,started_ms:lastRequest,partial_path:partialName});
        const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),60_000);let file=null,bytes=0,readyCommitted=false;const hash=createHash('sha256');
        try {
          const response=await fetcher(urls.corpus,{redirect:'error',signal:controller.signal,headers:{'User-Agent':'Nonverba-Priors-Derivation-Research/0.2'}});
          if(response.status===429||response.status===503&&response.headers.get('retry-after')) {
            await response.body?.cancel();const next=now()+retryAfterMilliseconds(response.headers.get('retry-after'),now());await writeEvent({kind:'throttle-pause',id:row.id,http_status:response.status,next_eligible_ms:next,retry_after:response.headers.get('retry-after')});return {status:'PAUSED_THROTTLE',next_eligible_ms:next,selected:selected.length,acquired:selected.filter(row=>committed.has(row.id)).length};
          }
          if(!response.ok){await response.body?.cancel();throw new Error(`HTTP_${response.status}`);}
          if(!response.body)throw new Error('Missing corpus response body');
          const declared=Number(response.headers.get('content-length'));if(declared>recipe.limits.contractBytes){await response.body.cancel();throw new Error('CONTRACT_BYTE_LIMIT');}
          file=await open(partial,'wx',0o600);
          for await(const chunk of response.body) {
            if(bytes+chunk.byteLength>recipe.limits.contractBytes){controller.abort();throw new Error('CONTRACT_BYTE_LIMIT');}
            if(rawUsed+chunk.byteLength>recipe.limits.rawBytes||used+chunk.byteLength+64*1024>recipe.limits.totalBytes){controller.abort();throw new Error('STUDY_BYTE_BUDGET');}
            await file.writeFile(chunk);bytes+=chunk.byteLength;rawUsed+=chunk.byteLength;used+=chunk.byteLength;hash.update(chunk);
          }
          if(!bytes)throw new Error('EMPTY_CORPUS_RESPONSE');await file.sync();await file.close();file=null;
          const rawPath=`raw/${row.id}.${row.format==='text'?'txt':'html'}`;const destination=await studyPath(runDir,rawPath,{missing:true});await mkdir(dirname(destination),{recursive:true});
          const event={kind:'download-ready',id:row.id,cohort:row.cohort,raw_path:rawPath,partial_path:partialName,sha256:hash.digest('hex'),bytes,url:urls.corpus,http_status:response.status,content_type:response.headers.get('content-type'),etag:response.headers.get('etag'),fetched_at:new Date(now()).toISOString(),attempt};
          const retained=await hashFile(partial);if(retained.sha256!==event.sha256||retained.bytes!==event.bytes)throw new Error('Completed partial differs from streamed content digest');
          await writeEvent(event);readyCommitted=true;await link(partial,destination);await unlink(partial);
          const committedEvent=await writeEvent({...event,kind:'download-committed'});committed.set(row.id,committedEvent);terminalError=null;log(`Acquired ${selected.filter(row=>committed.has(row.id)).length}/${selected.length}: ${row.id}`);break;
        }catch(error){controller.abort();if(readyCommitted)throw error;terminalError=error;await writeEvent({kind:'attempt-failed',id:row.id,cohort:row.cohort,attempt,error:error.message,partial_path:bytes?partialName:null,partial_bytes:bytes});if(/HTTP_4\d\d|BYTE_|BUDGET|EMPTY_/.test(error.message))break;if(attempt<3)await wait(1000*2**attempt);}
        finally {clearTimeout(timer);if(file)await file.close();}
      }
      if(terminalError){const event=await writeEvent({kind:'download-failed',id:row.id,cohort:row.cohort,error:terminalError.message,replacements:'none'});failed.set(row.id,event);if(/BUDGET/.test(terminalError.message))return {status:'PAUSED_STORAGE_BUDGET',selected:selected.length,acquired:selected.filter(row=>committed.has(row.id)).length,failures:selected.filter(row=>failed.has(row.id)).length};}
    }
    return {status:'ACQUISITION_PREFIX_COMPLETE',selected:selected.length,acquired:selected.filter(row=>committed.has(row.id)).length,failures:selected.filter(row=>failed.has(row.id)).length,raw_bytes:rawUsed,replacements:'none'};
  }finally{await release();}
}

export async function* readAcquired(runDir,{cohorts,calibrationOnly=false,contractIds}={}) {
  const {study,recipe}=await verifyStudy(runDir);if(study.status!=='READY')throw new Error('Study selection is not frozen ready');
  cohorts=cohorts??recipe.cohorts.filter(cohort=>!cohort.sealed).map(cohort=>cohort.id);
  if(!Array.isArray(cohorts)||!cohorts.length||cohorts.some(id=>!recipe.cohorts.some(cohort=>cohort.id===id)))throw new Error('Unsupported source-reading cohorts');
  if(cohorts.some(id=>recipe.cohorts.find(cohort=>cohort.id===id)?.sealed)){const {assertReserveAccess}=await import('./evaluation.mjs');await assertReserveAccess(runDir,cohorts);}
  let requested=null;if(contractIds!==undefined){if(!Array.isArray(contractIds)||contractIds.length>15000||contractIds.some(id=>typeof id!=='string'||!id)||new Set(contractIds).size!==contractIds.length)throw new Error('Explicit unique bounded source identities required');requested=new Set(contractIds);}
  const members=[];for await(const row of readRows(runDir,study.selection.path)){if(requested&&!requested.has(row.id))continue;if(requested)requested.delete(row.id);if(!cohorts.includes(row.cohort)||calibrationOnly&&!row.calibration){if(contractIds)throw new Error('Explicit source identity falls outside declared cohort or calibration scope');continue;}members.push(row);}
  if(requested?.size)throw new Error('Explicit source identity is absent from frozen selection');
  const committed=new Map();for await(const event of readLedger(runDir))if(event.kind==='download-committed')committed.set(event.id,event);
  let discoveryExpansionChecked=false;
  for(const row of members) {
    if(!committed.has(row.id))continue;
    if(!discoveryExpansionChecked&&row.cohort.startsWith('discovery-')&&row.calibration!==true){const {verifyCalibrationGate}=await import('./quality.mjs');await verifyCalibrationGate(runDir,{recipe});discoveryExpansionChecked=true;}
    const event=committed.get(row.id);validateDownloadEvent(row,event,recipe);const rawPath=await studyPath(runDir,event.raw_path);const actual=await hashFile(rawPath);
    if(actual.sha256!==event.sha256||actual.bytes!==event.bytes)throw new Error(`Acquired raw source changed: ${row.id}`);
    yield {...row,path:event.raw_path,raw_path:rawPath,acquisition:{sha256:event.sha256,bytes:event.bytes,http_status:event.http_status,content_type:event.content_type,url:event.url,fetched_at:event.fetched_at,attempt:event.attempt}};
  }
}
