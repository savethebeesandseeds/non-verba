// SPDX-License-Identifier: AGPL-3.0-only
// Declared synthetic metadata/files and injected responses; no public downloads.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {copyFile,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {sha256} from '../../lib/common.mjs';
import {STUDY_BASE,appendLedger,readRows,validateStudyRoot,writeRows} from '../lib/store.mjs';
import {acquireStudy,initStudy,readAcquired,retryAfterMilliseconds,selectCohorts} from '../lib/acquisition.mjs';

function recipe(){return {schema_version:2,name:'Declared synthetic acquisition fixture',seed:'synthetic-study',maxPerFiler:2,cohorts:[{id:'discovery-broad',target:2,labels:['services','lease'],minYear:2000,maxYear:2021},{id:'discovery-relevant',target:2,labels:['services'],minYear:2000,maxYear:2021},{id:'confirmation',target:2,labels:['services','lease'],minYear:2000,maxYear:2021,sealed:true},{id:'temporal',target:2,labels:['services','lease'],minYear:2022,maxYear:2026,sealed:true}],limits:{contractBytes:4*1024**2,rawBytes:8*1024**3,totalBytes:24*1024**3,requestIntervalMs:1000},calibration:{contracts:4}};}
const metadata=Array.from({length:48},(_,i)=>({doc_key:`${Math.floor(i/2)+1}/000000000000000001/doc${i}.htm`,year:i<24?2011:2023,label:i%4<2?'services':'lease',content_type:'text/html',amend:i%3===0,restate:false,joinder:false,termination:false}));
async function collect(iterator){const rows=[];for await(const row of iterator)rows.push(row);return rows;}
async function fixture(t,{contractBytes,calibrationContracts}={}){
  const id=randomUUID();const root=join(STUDY_BASE,`test-acquisition-${id}`),metadataRoot=join(STUDY_BASE,`test-metadata-${id}`),source=`/opt/nonverba-build/priors-derivation/v02-source-test-${id}`;
  validateStudyRoot(root);validateStudyRoot(metadataRoot);await mkdir(metadataRoot,{recursive:true});await mkdir(join(source,'sources'),{recursive:true});
  t.after(async()=>{await rm(root,{recursive:true,force:true});await rm(metadataRoot,{recursive:true,force:true});await rm(source,{recursive:true,force:true});});
  const schema={doc_key:'VARCHAR',year:'INTEGER',label:'VARCHAR',content_type:'VARCHAR',amend:'BOOLEAN',restate:'BOOLEAN',joinder:'BOOLEAN',termination:'BOOLEAN'};
  await writeRows(metadataRoot,'index.parquet',metadata,{schema});await copyFile(join(metadataRoot,'index.parquet'),join(source,'sources/index.parquet'));
  for(const [name,value] of [['corpus-home.html','Declared synthetic homepage'],['codebook.md','Declared synthetic codebook'],['corpus-manifest.json',JSON.stringify({version:'declared-synthetic'})]])await writeFile(join(source,'sources',name),value);
  const source_records=[];for(const name of ['corpus-home.html','codebook.md','corpus-manifest.json','index.parquet'])source_records.push({path:`sources/${name}`,sha256:sha256(await readFile(join(source,'sources',name)))});
  const sample=JSON.stringify({selected:[{doc_key:metadata[0].doc_key,cik:'1'}]});await writeFile(join(source,'sample.json'),sample);
  await writeFile(join(source,'acquisition.json'),JSON.stringify({corpus_version:'DECLARED_SYNTHETIC',source_records,sample_sha256:sha256(sample),records:[]}));
  const plan=recipe();if(contractBytes)plan.limits.contractBytes=contractBytes;if(calibrationContracts)plan.calibration.contracts=calibrationContracts;const study=await initStudy(root,plan,{sourceRun:source});assert.equal(study.status,'READY');assert.equal(study.selected,8);
  return {root,source,plan,study};
}

test('metadata selection is reproducible, filer-disjoint and excludes seen filers from reserves',()=>{
  const plan=recipe();const pools=Object.fromEntries(plan.cohorts.map(cohort=>[cohort.id,metadata.filter(row=>row.year>=cohort.minYear&&row.year<=cohort.maxYear&&cohort.labels.includes(row.label)).map(row=>({...row,cik:row.doc_key.split('/')[0]}))]));
  const a=selectCohorts(pools,plan,{seenFilers:new Set(['1'])});const b=selectCohorts(Object.fromEntries(Object.entries(pools).map(([id,rows])=>[id,[...rows].reverse()])),plan,{seenFilers:new Set(['1'])});
  assert.deepEqual(a,b);assert.equal(a.status,'READY');assert.equal(a.records.length,8);
  const owners=new Map();for(const row of a.records){if(owners.has(row.cik))assert.equal(owners.get(row.cik),row.cohort);owners.set(row.cik,row.cohort);if(row.sealed)assert.notEqual(row.cik,'1');}
  assert.equal(a.records.filter(row=>row.calibration).length,4);
  assert.equal(selectCohorts({},plan).status,'CENSUS_REQUIRES_RECIPE_REVISION');
});

test('cached-source census retains observed flags and completed acquisition resumes without requests',async t=>{
  const {root}=await fixture(t);const census=JSON.parse(await readFile(join(root,'census.json'),'utf8'));
  assert.equal(census.total.records,48);assert.equal(census.all_available_metadata,true);assert.deepEqual(census.exclusions,[]);assert.ok(census.flags.some(row=>row.amend));
  let clock=100_000,calls=0;const waits=[];const options={limit:2,fetcher:async()=>{calls++;return new Response('Declared synthetic contract content.',{headers:{'content-type':'text/html'}});},now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;},log:()=>{}};
  const result=await acquireStudy(root,options);assert.equal(result.acquired,2);assert.equal(calls,2);assert.ok(waits.every(ms=>ms>=1000));
  const again=await acquireStudy(root,options);assert.equal(again.acquired,2);assert.equal(calls,2);
  const records=await collect(readAcquired(root,{calibrationOnly:true}));assert.equal(records.length,2);
  await writeFile(records[0].raw_path,'Changed retained raw content');
  await assert.rejects(acquireStudy(root,options),/Committed raw source changed/);
});

test('Retry-After pauses acquisition durably and prevents premature resumed requests',async t=>{
  const {root}=await fixture(t);let clock=100_000,calls=0;
  const options={limit:1,fetcher:async()=>{calls++;return new Response('Declared synthetic throttle',{status:429,headers:{'retry-after':'120'}});},now:()=>clock,wait:async ms=>{clock+=ms;},log:()=>{}};
  const result=await acquireStudy(root,options);assert.equal(result.status,'PAUSED_THROTTLE');assert.equal(result.next_eligible_ms,220_000);
  assert.equal((await acquireStudy(root,options)).status,'PAUSED_THROTTLE');assert.equal(calls,1);
  assert.equal(retryAfterMilliseconds('2',0),2000);assert.equal(retryAfterMilliseconds('Thu, 01 Jan 1970 00:00:10 GMT',0),10_000);
});

test('failed frozen selections stay failures and are not replaced on resume',async t=>{
  const {root}=await fixture(t);let calls=0;
  const options={limit:1,fetcher:async()=>{calls++;return new Response('Declared synthetic missing response',{status:404});},now:()=>100_000,wait:async()=>{},log:()=>{}};
  const first=await acquireStudy(root,options);assert.equal(first.failures,1);assert.equal(first.acquired,0);
  const again=await acquireStudy(root,options);assert.equal(again.failures,1);assert.equal(calls,1);
});

test('both durable-ready interruption boundaries recover without a second download',async t=>{
  for(const phase of ['partial','raw'])await t.test(phase,async child=>{
    const {root}=await fixture(child);const row=(await collect(readRows(root,'selection.parquet')))[0];
    const body='Declared synthetic recovered source.';const rawPath=`raw/${row.id}.html`,partialPath=`raw-partials/${row.id}-${randomUUID()}.partial`;
    await mkdir(join(root,'raw'),{recursive:true});await mkdir(join(root,'raw-partials'),{recursive:true});
    await writeFile(join(root,phase==='raw'?rawPath:partialPath),body);
    await appendLedger(root,{kind:'download-ready',id:row.id,cohort:row.cohort,raw_path:rawPath,partial_path:partialPath,sha256:sha256(body),bytes:Buffer.byteLength(body),url:row.corpus_url,http_status:200,content_type:'text/html',fetched_at:new Date(100_000).toISOString(),attempt:1});
    const result=await acquireStudy(root,{limit:1,fetcher:async()=>{throw new Error('Recovery must not issue another request');},now:()=>100_000,wait:async()=>{},log:()=>{}});
    assert.equal(result.acquired,1);assert.equal((await collect(readAcquired(root)))[0].acquisition.sha256,sha256(body));
  });
});

test('one oversized streamed document is a retained failure rather than a run-budget pause',async t=>{
  const {root}=await fixture(t,{contractBytes:16});let calls=0,clock=100_000;
  const result=await acquireStudy(root,{limit:2,fetcher:async()=>new Response(++calls===1?'This response is deliberately too large.':'small'),now:()=>clock,wait:async ms=>{clock+=ms;},log:()=>{}});
  assert.equal(result.status,'ACQUISITION_PREFIX_COMPLETE');assert.equal(result.failures,1);assert.equal(result.acquired,1);assert.equal(calls,2);
});

test('changed cached corpus source blocks resumed acquisition before a request',async t=>{
  const {root}=await fixture(t);await writeFile(join(root,'sources/codebook.md'),'Changed retained codebook bytes');
  await assert.rejects(acquireStudy(root,{limit:1,fetcher:async()=>{throw new Error('A changed source must not fetch');}}),/Frozen MCC source changed/);
});

test('even a small cohort-specific prefix cannot open noncalibration contracts before the source gate passes',async t=>{const {root}=await fixture(t,{calibrationContracts:1});let calls=0;await assert.rejects(acquireStudy(root,{limit:4,fetcher:async()=>{calls++;return new Response('Never requested');}}),/CALIBRATION_GATE_NOT_PASSED/);assert.equal(calls,0);const {study}=await import('../lib/acquisition.mjs').then(async module=>module.verifyStudy(root));const selected=await collect(readRows(root,study.selection.path));const outside=selected.find(row=>row.cohort.startsWith('discovery-')&&!row.calibration);await assert.rejects(acquireStudy(root,{limit:2,cohorts:[outside.cohort],fetcher:async()=>{calls++;return new Response('Never requested');}}),/CALIBRATION_GATE_NOT_PASSED/);assert.equal(calls,0);});
