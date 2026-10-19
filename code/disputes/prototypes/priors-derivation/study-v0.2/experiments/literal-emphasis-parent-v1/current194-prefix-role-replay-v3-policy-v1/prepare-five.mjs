// SPDX-License-Identifier: AGPL-3.0-only
// Metadata-only preparation and sizing. ROOT reviews this file before execution.
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFileSync,lstatSync,readdirSync,mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

const R='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
const Q=R+'/qa/current194-prefix-role-five-preparations-20261018-v1';
const BASE=R+'/representation-issues/replay-preparations';
const NODE='/opt/nonverba-tools/node/bin/node',FLAGS=['--max-old-space-size=512','--disable-proto=throw'];
const SELF=fileURLToPath(import.meta.url),REVIEWER='reader0170_current194';
const SOURCE='194e51d54ddb39cb1ab67981af463c542531f2da0eebf98039aa47f130464f22';
const MODE='NEW_CURRENT_NATIVE_ACTUAL_READING_REQUIRED';
const PROTOCOL='EXACT_UNCHANGED_SOURCE_PREFIX_ROLE_REPLAY_V3_CURRENT_NATIVE_ONLY';
const RSS_LIMIT=1073741824,ARTIFACT_LIMIT=33554432,CHILD_MS=60000,REPORT_LIMIT=32768;
const UNSAFE=['LD_PRELOAD','LD_AUDIT','NODE_OPTIONS','NODE_PATH','BASH_ENV','ENV'];
const ref=(path,sha256,bytes)=>({path,sha256,bytes});
const PINS={
  policy:ref('representation-issues/replay-policies/'+SOURCE+'.json','603f05a34b2a8a35971d23ddff0610818e6cdecc4aa7c00fe9af23046bf89584',7408),
  assignments:ref('representation-issues/replay-assignments/194-all6-reader0170-v2.json','9908343f2c4104ac2f0f8b34cf7e6cf10b246c5ad136fda2d499a2f57cc97d4e',1980),
  manifest:ref('processing/194e51d54ddb39cb/calibration-1000-cea0eeae0bf69647/extraction-manifest.json','8f1fc4f801192e24ffb065e83abb8fee4140f8c01b6a6a74a38f99fde5fb53b0',5179014),
  guard:ref('qa/literal-emphasis-actualA-metadata-engineering-20261017-bound80-v8/execution/complete-fresh-guard.json','0a578b37ff01716daf9c4d68b8d446b5e79e2ffc36b22f55dd38e5f4428f2996',12856),
  module:ref('/tmp/nonverba-unified-source/56eea515cb6d472c90152f36e27693ab/code/disputes/prototypes/priors-derivation/study-v0.2/lib/representation-replay.mjs','c71f1357e8717f15694da2d8e33ec1edeac2f88df14859c7709d353f7c23fb5b',40604),
};
const CASES=[
  ['development-0030','contract-ba649809577cfcf4d8d0','evaluation_engineer'],
  ['development-0141','contract-b992a11190f15c49c1af','v13_review_documentation'],
  ['development-0119','contract-b9bc71a764b8f5d200d4','v13_review_documentation'],
  ['development-0133','contract-7d7c188ef6139063550d','v13_review_documentation'],
  ['development-0019','contract-296044bf71b4482e7c9f','evaluation_engineer'],
];
const check=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{safeCode:code});};
const same=(a,b,code)=>check(isDeepStrictEqual(a,b),code);
const H=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>JSON.stringify(value&&typeof value==='object'?(Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))]))):value);
const plain=r=>({path:r.path,sha256:r.sha256,bytes:r.bytes});
function absolute(path){const p=path.startsWith('/')?path:resolve(R,path);check(p===R||p.startsWith(R+'/')||p===PINS.module.path,'PATH_OUTSIDE_SCOPE');return p;}
function noLinks(path){let p=resolve(path);for(;;){check(!lstatSync(p).isSymbolicLink(),'SYMLINK_REJECTED');if(dirname(p)===p)break;p=dirname(p);}}
function read(r,json=true){check(typeof r.path==='string'&&/^[a-f0-9]{64}$/u.test(r.sha256)&&Number.isSafeInteger(r.bytes)&&r.bytes>0&&r.bytes<=ARTIFACT_LIMIT,'REF_INVALID');const p=absolute(r.path);noLinks(p);check(lstatSync(p).isFile(),'REGULAR_FILE_REQUIRED');const b=readFileSync(p);check(b.length===r.bytes&&H(b)===r.sha256,'REF_BINDING_FAILED');return json?JSON.parse(b.toString('utf8')):b;}
function fileRef(path){const b=readFileSync(path);return ref(path,H(b),b.length);}
function put(name,value){const p=Q+'/'+name,b=Buffer.from(JSON.stringify(value,null,2)+'\n'),fd=openSync(p,'wx',0o600);try{writeFileSync(fd,b);fsyncSync(fd);}finally{closeSync(fd);}return ref(p,H(b),b.length);}
function runtime(){check(process.platform==='linux'&&process.env.NONVERBA_CONTAINER==='1'&&process.execPath===NODE,'CONTAINER_RUNTIME_REQUIRED');same(process.execArgv,FLAGS,'NODE_FLAGS_DIFFER');check(UNSAFE.every(k=>!Object.hasOwn(process.env,k)),'UNSANITIZED_ENVIRONMENT');const rss=process.memoryUsage().rss;check(rss<=RSS_LIMIT,'RSS_LIMIT');return rss;}
function bindings(){
  runtime();read(PINS.module,false);const p=read(PINS.policy),a=read(PINS.assignments);read(PINS.manifest,false);const g=read(PINS.guard),{projection_sha256,...body}=g;
  check(p.protocol===PROTOCOL&&p.native_disposition===MODE&&p.extraction_source_sha256===SOURCE,'POLICY_IDENTITY');same(p.reviewer_assignments,PINS.assignments,'ASSIGNMENT_PIN');same(p.extraction_manifest,PINS.manifest,'MANIFEST_PIN');same(p.limits,{response_characters:7500,page_characters:7000,reason_min_characters:40},'POLICY_LIMITS');
  const ids=[...new Set(g.rows?.map(x=>x.contract_id))].sort();check(g.schema==='stored-reader-complete-fresh100-guard-v1'&&H(canonical(body))===projection_sha256&&g.rows.length===100&&new Set(g.rows.map(x=>x.audit_id)).size===100&&ids.length===29,'FRESH_GUARD');same(ids,g.contract_ids,'FRESH_GUARD_IDS');
  // The API authenticates the entire representation registry. Exclude all six
  // CIDs before it can follow any historical evidence reference, including 0041.
  const prefix=p.all_seven_registered_issue_roster?.filter(x=>x.workflow==='PREFIX_ROLE_INJECTION_ONLY'),frozen=p.observed_issues_at_freeze;
  check(prefix?.length===6&&frozen?.length===6,'COMPLETE_PREFIX_ROSTER');same(prefix.map(x=>x.audit_id).sort(),[...CASES.map(x=>x[0]),'development-0041'].sort(),'PREFIX_AUDIT_SET');
  const frozenRefs=frozen.map(plain).sort((x,y)=>x.path.localeCompare(y.path));same(prefix.map(x=>plain(x.issue)).sort((x,y)=>x.path.localeCompare(y.path)),frozenRefs,'FROZEN_REGISTRY_REFS');check(H(canonical(frozenRefs))===p.observed_registry_sha256_at_freeze,'FROZEN_REGISTRY_DIGEST');
  const registry=R+'/representation-issues/observed';noLinks(registry);const entries=readdirSync(registry,{withFileTypes:true});check(entries.length===6&&entries.every(x=>x.isFile()&&/^issue-[a-f0-9]{64}\.json$/u.test(x.name)),'REGISTRY_MEMBERSHIP');same(entries.map(x=>'representation-issues/observed/'+x.name).sort(),frozenRefs.map(x=>x.path).sort(),'REGISTRY_MEMBERSHIP');
  for(const row of prefix){check(!ids.includes(row.contract_id),'REGISTRY_PROTECTED_CONTRACT');const issue=read(row.issue);check(issue.schema==='observed-partial-representation-issue-v1'&&issue.contract_id===row.contract_id&&issue.evidence?.audit_id===row.audit_id,'REGISTRY_ISSUE_BINDING');}
  check(a.assignments?.length===6&&a.aliases?.some(x=>x.alias===REVIEWER&&x.canonical===REVIEWER),'CANONICAL_ASSIGNMENTS');
  return CASES.map(([audit_id,contract_id,original])=>{const rows=p.all_seven_registered_issue_roster?.filter(x=>x.audit_id===audit_id),assigned=a.assignments.filter(x=>x.audit_id===audit_id);check(rows?.length===1&&rows[0].contract_id===contract_id&&rows[0].workflow==='PREFIX_ROLE_INJECTION_ONLY'&&!ids.includes(contract_id),'FIXED_CASE_ROSTER');check(assigned.length===1&&assigned[0].reviewer_id===REVIEWER&&original!==REVIEWER,'INDEPENDENT_ASSIGNMENT');same(assigned[0].original_reader_ids,[original],'ORIGINAL_READER_BINDING');read(rows[0].issue);return {audit_id,issue:plain(rows[0].issue)};});
}
function treeBytes(path){if(!existsSync(path))return 0;const s=lstatSync(path);check(!s.isSymbolicLink(),'ARTIFACT_SYMLINK');if(s.isFile())return s.size;check(s.isDirectory(),'ARTIFACT_TYPE');return s.size+readdirSync(path).reduce((n,x)=>n+treeBytes(join(path,x)),0);}
function directories(){if(!existsSync(BASE))return [];noLinks(BASE);return readdirSync(BASE,{withFileTypes:true}).map(e=>{check(e.isDirectory()&&/^[a-f0-9]{64}$/u.test(e.name),'PREPARATION_NAMESPACE');return e.name;});}

async function child(audit_id){
  const rss_before=runtime(),row=bindings().find(x=>x.audit_id===audit_id);check(row,'CHILD_NOT_ASSIGNED');
  const {prepareRepresentationReplay}=await import(pathToFileURL(PINS.module.path).href);
  const preparation_ref=await prepareRepresentationReplay(R,{issue:row.issue,extraction_manifest:PINS.manifest,policy:PINS.policy,native_disposition:MODE});
  const p=read(preparation_ref);check(p.audit_id===audit_id&&p.reviewer_id===REVIEWER&&p.actual_reading===false&&p.extraction_source_sha256===SOURCE,'PREPARATION_IDENTITY');same(p.policy,PINS.policy,'PREPARATION_POLICY');same(p.reviewer_assignments,PINS.assignments,'PREPARATION_ASSIGNMENT');same(p.extraction_manifest,PINS.manifest,'PREPARATION_MANIFEST');
  let visible_utf8_bytes=0,compact_characters=0,max_response_characters=0,max_response_utf8_bytes=0;
  for(const [i,page]of p.pages.entries()){
    const value=read(page);check(page.index===i&&page.start===compact_characters&&page.end===page.start+page.characters&&typeof value.text==='string'&&value.text.length===page.characters&&page.characters<=7000,'PAGE_GEOMETRY');
    // Exact existing header serialization; neither the emitter nor a display is invoked.
    const response=JSON.stringify({audit_id:p.audit_id,page:page.index,pages:p.pages.length,display_start:page.start,display_end:page.end,reviewer:REVIEWER})+'\n'+value.text;
    check(response.length<=7500,'RESPONSE_BOUND');const n=Buffer.byteLength(response);visible_utf8_bytes+=n;compact_characters+=page.characters;max_response_characters=Math.max(max_response_characters,response.length);max_response_utf8_bytes=Math.max(max_response_utf8_bytes,n);
  }
  check(p.pages.length>0,'EMPTY_PREPARATION');const rss_after=runtime();
  return {audit_id,status:'PREPARED_NOT_READ',preparation_ref:plain(preparation_ref),page_count:p.pages.length,compact_characters,visible_utf8_bytes,max_response_characters,max_response_utf8_bytes,rss_before,rss_after};
}

async function runChild(audit_id,checkpoint){
  const env={...process.env};for(const k of UNSAFE)delete env[k];env.NONVERBA_CONTAINER='1';
  return new Promise(resolveResult=>{
    const childProcess=spawn(NODE,[...FLAGS,SELF,'--child',audit_id],{env,stdio:['ignore','pipe','pipe']});let output='',stdout_bytes=0,stderr_bytes=0,stop=null,peak_rss=0,peak_combined_rss=0,settled=false;
    const terminate=status=>{if(!stop){stop=status;childProcess.kill('SIGKILL');}};
    const timer=setTimeout(()=>terminate('CHILD_TIMEOUT'),CHILD_MS);
    const poll=setInterval(()=>{try{const match=readFileSync('/proc/'+childProcess.pid+'/status','utf8').match(/^VmRSS:\s+(\d+) kB$/mu);if(match){const rss=Number(match[1])*1024;peak_rss=Math.max(peak_rss,rss);peak_combined_rss=Math.max(peak_combined_rss,rss+runtime());if(peak_combined_rss>RSS_LIMIT)terminate('COMBINED_RSS_LIMIT');}checkpoint();}catch(e){if(e.code!=='ENOENT')terminate(e.safeCode??'CHECKPOINT_FAILED');}},200);
    childProcess.stdout.on('data',b=>{stdout_bytes+=b.length;if(stdout_bytes>REPORT_LIMIT)terminate('CHILD_REPORT_LIMIT');else output+=b.toString('utf8');});
    childProcess.stderr.on('data',b=>{stderr_bytes+=b.length;if(stderr_bytes>REPORT_LIMIT)terminate('CHILD_ERROR_LIMIT');});
    const finish=(code,signal)=>{if(settled)return;settled=true;clearTimeout(timer);clearInterval(poll);let report=null;if(!stop&&code===0){try{const v=JSON.parse(output);check(v.audit_id===audit_id&&v.status==='PREPARED_NOT_READ','CHILD_REPORT_INVALID');check(v.preparation_ref?.path?.startsWith('representation-issues/replay-preparations/')&&v.preparation_ref.path.endsWith('/preparation.json'),'CHILD_REF_INVALID');for(const k of ['page_count','compact_characters','visible_utf8_bytes','max_response_characters','max_response_utf8_bytes','rss_before','rss_after'])check(Number.isSafeInteger(v[k])&&v[k]>=0,'CHILD_COUNTS_INVALID');report={audit_id,status:v.status,preparation_ref:plain(v.preparation_ref),...Object.fromEntries(['page_count','compact_characters','visible_utf8_bytes','max_response_characters','max_response_utf8_bytes','rss_before','rss_after'].map(k=>[k,v[k]]))};read(report.preparation_ref);}catch{stop='CHILD_REPORT_INVALID';}}resolveResult({status:stop??(code===0?'PREPARED_NOT_READ':'CHILD_NATIVE_FAILURE'),native_exit_code:code,signal_count:signal?1:0,stdout_bytes,stderr_bytes,peak_rss,peak_combined_rss,report});};
    childProcess.on('error',()=>{stop='CHILD_SPAWN_FAILED';finish(null,null);});childProcess.on('close',finish);
  });
}

async function main(){
  const rows=bindings(),rss_before=runtime(),initial=new Set(directories());noLinks(dirname(Q));check(!existsSync(Q),'QA_PATH_CONFLICT');mkdirSync(Q,{mode:0o700});
  const newDirectories=()=>directories().filter(x=>!initial.has(x));
  const used=()=>treeBytes(Q)+newDirectories().reduce((n,x)=>n+treeBytes(BASE+'/'+x),0);
  const checkpoint=()=>{runtime();check(used()<=ARTIFACT_LIMIT-65536,'ARTIFACT_LIMIT');};
  put('preparation-admission.json',{status:'METADATA_PREPARATION_ONLY',source_ref:fileRef(SELF),pins:PINS,audit_ids:CASES.map(x=>x[0]),reviewer_id:REVIEWER,child_timeout_ms:CHILD_MS,node_heap_mib:512,rss_limit_bytes:RSS_LIMIT,new_artifact_limit_bytes:ARTIFACT_LIMIT,actual_reading:false,reading_clock_started:false});
  const outcomes=[];let stopped=false;
  for(const row of rows){
    let outcome;
    if(stopped)outcome={audit_id:row.audit_id,status:'NOT_STARTED_AFTER_STOP'};
    else {const start=Date.now();try{checkpoint();outcome={audit_id:row.audit_id,...await runChild(row.audit_id,checkpoint),elapsed_ms:Date.now()-start,new_artifact_bytes:used()};checkpoint();if(outcome.status==='PREPARED_NOT_READ')check(newDirectories().includes(outcome.report.preparation_ref.path.split('/')[2]),'PREPARATION_ALREADY_EXISTED');}catch(e){outcome={...(outcome??{audit_id:row.audit_id}),status:e.safeCode??'PREPARATION_FAILED',elapsed_ms:Date.now()-start,new_artifact_bytes:used()};}if(outcome.status!=='PREPARED_NOT_READ')stopped=true;}
    const outcome_ref=put(row.audit_id+'-outcome.json',outcome);outcomes.push({audit_id:row.audit_id,status:outcome.status,outcome_ref,...(outcome.report?{preparation_ref:outcome.report.preparation_ref,page_count:outcome.report.page_count,compact_characters:outcome.report.compact_characters,visible_utf8_bytes:outcome.report.visible_utf8_bytes,max_response_characters:outcome.report.max_response_characters,max_response_utf8_bytes:outcome.report.max_response_utf8_bytes}:{})});
    process.stdout.write(JSON.stringify(outcomes.at(-1))+'\n');
  }
  const rss_after=runtime(),summary={status:stopped?'STOPPED_METADATA_ONLY':'FIVE_PREPARED_NOT_READ',outcomes,page_count:outcomes.reduce((n,x)=>n+(x.page_count??0),0),compact_characters:outcomes.reduce((n,x)=>n+(x.compact_characters??0),0),visible_utf8_bytes:outcomes.reduce((n,x)=>n+(x.visible_utf8_bytes??0),0),max_response_characters:Math.max(0,...outcomes.map(x=>x.max_response_characters??0)),new_artifact_bytes:used(),rss_before,rss_after,actual_reading:false,reading_clock_started:false};
  const summary_ref=put('summary.json',summary);check(used()<=ARTIFACT_LIMIT,'ARTIFACT_LIMIT');process.stdout.write(JSON.stringify({status:summary.status,page_count:summary.page_count,compact_characters:summary.compact_characters,visible_utf8_bytes:summary.visible_utf8_bytes,max_response_characters:summary.max_response_characters,new_artifact_bytes:used(),summary_ref})+'\n');if(stopped)process.exitCode=2;
}

try {if(process.argv[2]==='--child'){check(process.argv.length===4,'CHILD_ARGUMENTS');process.stdout.write(JSON.stringify(await child(process.argv[3]))+'\n');}else{check(process.argv.length===2,'PARENT_ARGUMENTS');await main();}}
catch(e){process.stdout.write(JSON.stringify({status:e.safeCode??'PREPARATION_LAUNCHER_FAILED'})+'\n');process.exitCode=2;}
