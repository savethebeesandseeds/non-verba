// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE. Existing native-change API; machine evidence and three UNREAD outputs.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const RUN='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
export const SNAPSHOT='/tmp/nonverba-unified-source/56eea515cb6d472c90152f36e27693ab/code';
const LIB=SNAPSHOT+'/disputes/prototypes/priors-derivation/study-v0.2/lib/';
export const QA='qa/native-change-current194-machine-preparation-20261018-v1';
const Q=RUN+'/'+QA;
export const SOURCE='194e51d54ddb39cb1ab67981af463c542531f2da0eebf98039aa47f130464f22';
export const CID='contract-129f8dcc32ad546ab6b6';
export const PINS={
  epoch:{path:'qa/current-method-freeze-20261018/source-epoch.json',sha256:'3729deec1e922ab716440ba075b444a49e74d81bdd688778b837429a4b7190cd',bytes:6380},
  fresh_guard:{path:'qa/literal-emphasis-actualA-metadata-engineering-20261017-bound80-v8/execution/complete-fresh-guard.json',sha256:'0a578b37ff01716daf9c4d68b8d446b5e79e2ffc36b22f55dd38e5f4428f2996',bytes:12856},
  boundary_roster:{path:'qa/current194-five-boundary-source-only-qualification-20261018-v1/result.json',sha256:'8a313225751e2d52274f79c793822e6dec2c8b62d8ecf6ea4fb695749b5340c8',bytes:6936},
  manifest:{path:'processing/194e51d54ddb39cb/calibration-1000-cea0eeae0bf69647/extraction-manifest.json',sha256:'8f1fc4f801192e24ffb065e83abb8fee4140f8c01b6a6a74a38f99fde5fb53b0',bytes:5179014},
  issue:{path:'source-issues/observed/issue-64f380e2905f0af04ea743dc80e980fde64aaf6fd857f0ab2929c2560938c1e2.json',sha256:'b5371c00eac40f7c94df961af1229b423c663a324086a1e4955a8c008619acac',bytes:10626},
  second_model_manifest:{path:'comparison-model.json',sha256:'a53b0d7e1bb1e1ba69606861b6b55f2584eea929f162bd850a831367c680cd04',bytes:2595},
  raw:{path:'raw/contract-129f8dcc32ad546ab6b6.html',sha256:'213c97b997ab19cfb03daf609db80338ab2be471a5570d825cd5e06e78cb0cea',bytes:1243514},
  cache:{path:'extraction-cache/194e51d54ddb39cb/contract-129f8dcc32ad546ab6b6.json.gz',sha256:'cc83237ac08f42ba9f04d4f6b83cf6122757c4d648e74e90bd1e4d3a70a13de7',bytes:717790},
  native:{path:'native-decorations/194e51d54ddb39cb/contract-129f8dcc32ad546ab6b6.json.gz',sha256:'280dbb15a0b5e48220a43a65aeac3f7c3f0fd956e8a5aa4d95131c81a6985eb9',bytes:1826535},
  normalized:{path:'normalized/194e51d54ddb39cb/contract-129f8dcc32ad546ab6b6.txt',sha256:'ff185baf26bb6517990d683258a1dfab1ded2063b59c02fb88bbe7e0edc92062'}
};
export const ANCHOR={id:CID+':section:215519-514935:335af34a7c33',start:215519,end:514935,sha256:'335af34a7c333e7e7d452680f57be92f60ba892c35c5c85b2289df540659d279'};
export const OBSERVED_ISSUE_ROSTER=[
  {issue:PINS.issue,contract_id:CID,audit_id:'coding-0099',classification:'MATERIAL_NATIVE_CHANGE_MARKUP'},
  {issue:{path:'source-issues/observed/issue-67532c9d78500cf20cd6892e9f8d289af92ded6f97631957e0b33c5a30def7dc.json',sha256:'a8597893af300fc0c5eb0deff1eb14453d08b2411da60bd1682daac56ced997d',bytes:1584},contract_id:'contract-c77a5e4c4a467c2e8ff2',audit_id:'coding-0133',classification:'MATERIAL_BOUNDARY'},
  {issue:{path:'source-issues/observed/issue-a40585b2897a9f6e5eb93e0fef26b92623d87319ea793b77b0ec8b3a4eb396e9.json',sha256:'d9c0bc7c54695cd66a2bbfab21a1680b52579ce7004ffb71805e4b4694627526',bytes:3093},contract_id:'contract-cc26fc55f8a1f7ad9def',audit_id:'development-0013',classification:'MATERIAL_BOUNDARY'},
  {issue:{path:'source-issues/observed/issue-a8d129f17bd43aff0b60b211ebf4fad0e27f7dd5762ce2ee1182d178de79cd8d.json',sha256:'adcf9920850767cecb4fb43b603d8e5a097cbb37d3f436efc5d5f6468dd6f8d7',bytes:2071},contract_id:'contract-f1ada4c1a04d7c8d92d8',audit_id:'technical-attachment-reference-list-0096',classification:'MATERIAL_BOUNDARY'},
  {issue:{path:'source-issues/observed/issue-e07ac0b1bd20983f262ec846734b848aa202c501489abacc9bd5b93b830da7bc.json',sha256:'894cf357950d7c16ae2f4e3740ed436b8f94e50f03f2959cfc51d907ddbd102e',bytes:2514},contract_id:'contract-c07dc12c0ca8cbffea62',audit_id:'coding-0010',classification:'MATERIAL_BOUNDARY'},
  {issue:{path:'source-issues/observed/issue-e88a40a6b9f6372054cd4aadae6176ab102736dfd973b656d4efe4834b8d7006.json',sha256:'5cf17676957e3f5fc852443cfea7e0e7321592fb64c7397f185e5a7d042aae39',bytes:1695},contract_id:'contract-45ac30084126ee880e85',audit_id:'development-0129',classification:'MATERIAL_BOUNDARY'}
];
export const CODE_BINDINGS=[
  {path:'source-issues.mjs',sha256:'4d793126a6c2ba23fe906ace1b3c22f9b2d253056867a4c06e82a078b5e8bff4',bytes:63758},
  {path:'representation-issues.mjs',sha256:'b59db67b6274f67d89899effae58b082a0cba28dc48ba27007e1d639ea2316de',bytes:14063},
  {path:'representation-replay.mjs',sha256:'c71f1357e8717f15694da2d8e33ec1edeac2f88df14859c7709d353f7c23fb5b',bytes:40604},
  {path:'source-decoration.mjs',sha256:'a857d39a2da390175a1f817b4d2704ed1adbacff84ba6a27fefff7aee70f77fd',bytes:56630},
  {path:'native-decoration-store.mjs',sha256:'fa63dffb20973086e456072a5749680aeb99f9f96e32da0bf92fc3f35358f86b',bytes:7519},
  {path:'sections.mjs',sha256:'06375de4af1cccb3f56778db459760d1cdffe14eed6b5842565167c629f90f2a',bytes:137636},
  {path:'representation.mjs',sha256:'b35d8fd3c118d2da489eefd71796d9936596c73997172c5706112ef6ffb39ee6',bytes:14161},
  {path:'embedding.mjs',sha256:'d9629fd6df2e5250ad2e4efcab57dbc8f35c0bb559b4479aee25d586527d5340',bytes:39043},
  {path:'analysis.mjs',sha256:'0c72a9f5541aa49e7de3e2b76d576addb262332710492bd71fe97b7b7b87aa77',bytes:20837},
  {path:'sensitivity.mjs',sha256:'9ff0a597df0ddffb8c5d3e77b6430e17816ece658cf1eb104471d59b081b5a07',bytes:67378},
  {path:'store.mjs',sha256:'2a1ecd6da273cff3be44202958cb46e3e1b0c754bed485b54347adee4e49eee3',bytes:24187},
  {path:'../../lib/common.mjs',sha256:'b9a9f91448ec88fe6676bd07aaa4a77f14d03844244a3670d4cb27a41ca7545d',bytes:2387}
];
export const LIMITS={elapsed_ms:300000,node_heap_mb:1024,sampled_rss_bytes:2147483648,qa_bytes:16777216,metadata_reserve_bytes:65536,source_copy_bytes:65536,read_output_bytes:1048576,api_invocations:1,plans:8,max_tokenizer_callbacks_per_plan:20000,max_tokenizer_callbacks_reserved:160000};
const H=b=>createHash('sha256').update(b).digest('hex');
const C=v=>Array.isArray(v)?'['+v.map(C).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+C(v[k])).join(',')+'}':JSON.stringify(v);
const D=v=>H(C(v)),same=(a,b)=>C(a)===C(b),integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
const check=(ok,code='NATIVE194_BINDING')=>{if(!ok)throw Object.assign(Error(code),{code});};
const safe=e=>{const c=Object.getOwnPropertyDescriptor(e??{},'code')?.value;return typeof c==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/u.test(c)?c:'NATIVE194_PREPARATION_HELD';};
let origin=null,last=null,admitted=false,apiStarted=false,stage='ADMISSION',admissionRef=null,proposalRef=null,samples=0,peakRSS=0,peakHeap=0,maxGap=0,sticky=null;
const elapsed=()=>origin===null?0:Number(process.hrtime.bigint()-origin)/1e6;
function checkpoint(){
  if(origin===null)return;
  const now=process.hrtime.bigint(),m=process.memoryUsage();samples++;if(last!==null)maxGap=Math.max(maxGap,Number(now-last)/1e6);last=now;peakRSS=Math.max(peakRSS,m.rss);peakHeap=Math.max(peakHeap,m.heapUsed);
  if(elapsed()>LIMITS.elapsed_ms)sticky='NATIVE194_DEADLINE';if(m.rss>LIMITS.sampled_rss_bytes||m.heapUsed>LIMITS.node_heap_mb*1024**2)sticky='NATIVE194_MEMORY';if(sticky)check(false,sticky);
}
function stat(p){check(path.resolve(p)===p,'NATIVE194_PATH');let at='/';for(const x of p.split('/').filter(Boolean)){at=path.join(at,x);const s=fs.lstatSync(at);check(!s.isSymbolicLink()&&(at===p||s.isDirectory()),'NATIVE194_LINK');}return fs.lstatSync(p);}
function resolve(p){if(p.startsWith('/'))return p;check(!p.split('/').includes('..'),'NATIVE194_PATH');const full=path.resolve(RUN,p);check(full.startsWith(RUN+'/'),'NATIVE194_PATH');return full;}
function read(ref,max=16*1024**2){
  checkpoint();check(ref&&typeof ref.path==='string'&&/^[a-f0-9]{64}$/u.test(ref.sha256)&&integer(ref.bytes,1,max),'NATIVE194_REFERENCE');const p=resolve(ref.path);stat(p);const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{const before=fs.fstatSync(fd);check(before.isFile()&&before.nlink===1&&before.size===ref.bytes,'NATIVE194_FILE');const b=Buffer.alloc(before.size);let n=0;while(n<b.length){checkpoint();const count=fs.readSync(fd,b,n,Math.min(65536,b.length-n),n);check(count>0,'NATIVE194_SHORT_READ');n+=count;}const after=fs.fstatSync(fd);check(after.dev===before.dev&&after.ino===before.ino&&after.size===before.size&&after.mode===before.mode&&after.nlink===1&&H(b)===ref.sha256,'NATIVE194_PIN');checkpoint();return b;}finally{fs.closeSync(fd);}
}
const text=b=>{const t=new TextDecoder('utf-8',{fatal:true}).decode(b);check(Buffer.from(t).equals(b),'NATIVE194_UTF8');return t;};
const json=ref=>JSON.parse(text(read(ref)));
function size(p=Q){let n=stat(p).size;for(const f of fs.readdirSync(p,{withFileTypes:true})){const next=p+'/'+f.name,s=stat(next);if(s.isDirectory())n+=size(next);else{check(s.isFile()&&s.nlink===1,'NATIVE194_OUTPUT_TYPE');n+=s.size;}}return n;}
function put(name,value,{held=false,readOutput=false}={}){
  if(!held)checkpoint();check(/^[a-z0-9][a-z0-9.-]*$/u.test(name),'NATIVE194_OUTPUT_NAME');const b=Buffer.from(JSON.stringify(value,null,2)+'\n');check(b.length<=(readOutput?LIMITS.read_output_bytes:LIMITS.qa_bytes-LIMITS.metadata_reserve_bytes),'NATIVE194_ARTIFACT_BOUND');check(size()+b.length+LIMITS.metadata_reserve_bytes<=LIMITS.qa_bytes,'NATIVE194_QA_BOUND');
  const p=Q+'/'+name,fd=fs.openSync(p,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(!held)checkpoint();return{path:QA+'/'+name,sha256:H(b),bytes:b.length};
}
function freshGuard(){const g=json(PINS.fresh_guard),{projection_sha256,...body}=g;check(g.schema==='stored-reader-complete-fresh100-guard-v1'&&D(body)===projection_sha256&&g.rows.length===100&&g.contract_ids.length===29&&new Set(g.rows.map(r=>r.audit_id)).size===100&&new Set(g.rows.map(r=>r.contract_id)).size===29&&same([...new Set(g.rows.map(r=>r.contract_id))].sort(),[...g.contract_ids].sort())&&!g.contract_ids.includes(CID),'NATIVE194_FRESH_GUARD');return g;}
function registryPreflight(guard){
  const result=json(PINS.boundary_roster);check(result.source_sha256===SOURCE&&Array.isArray(result.rows)&&same(result.rows.map(row=>({issue:row.issue_ref,contract_id:row.contract_id})),OBSERVED_ISSUE_ROSTER.slice(1).map(row=>({issue:row.issue,contract_id:row.contract_id}))),'NATIVE194_BOUNDARY_ROSTER');
  const dir=RUN+'/source-issues/observed';stat(dir);const files=fs.readdirSync(dir,{withFileTypes:true});check(files.every(f=>f.isFile())&&same(files.map(f=>f.name).sort(),OBSERVED_ISSUE_ROSTER.map(row=>path.basename(row.issue.path))),'NATIVE194_REGISTRY_MEMBERSHIP');
  for(const row of OBSERVED_ISSUE_ROSTER){check(!guard.contract_ids.includes(row.contract_id),'NATIVE194_REGISTRY_PROTECTED_CID');const issue=json(row.issue);check(issue.contract_id===row.contract_id&&issue.audit_id===row.audit_id&&issue.classification===row.classification,'NATIVE194_REGISTRY_IDENTITY');}
}
// Metadata/source arithmetic only: no new encode or tokenizer call and no repair of V5.
function qualifyWindows(machine,normalizedText){
  const rows=[];
  for(const arm of machine.input_readiness.arms)for(const unit of arm.units){
    checkpoint();const representation=unit.input.native_representation,parts=representation?.parts,body=unit.body_range;
    check(parts?.length===1&&parts[0].kind==='source'&&integer(body?.start,0,normalizedText.length-1)&&integer(body.end,body.start+1,normalizedText.length),'NATIVE194_WINDOW_REPRESENTATION');
    const part=parts[0],source=normalizedText.slice(body.start,body.end),windows=unit.input.windows,words=Array.from(source.matchAll(/\S+/gu)),points=Array.from(source),offsets=[0];for(const point of points)offsets.push(offsets.at(-1)+point.length);const boundaries=new Set(offsets);
    check(part.start===0&&part.end===source.length&&part.normalized_start===body.start&&part.normalized_end===body.end&&part.source_sha256===H(source)&&representation.source_text_sha256===H(source)&&Array.isArray(windows)&&integer(windows.length,1,8192),'NATIVE194_WINDOW_REPRESENTATION');
    let previousStart=-1,previousEnd=0,previousMeasureEnd=0,weightSum=0,weightUnit=null;
    for(const window of windows){
      const start=window.representation_start,end=window.representation_end;
      check(integer(start,0,source.length-1)&&integer(end,start+1,source.length)&&boundaries.has(start)&&boundaries.has(end)&&start>previousStart&&end>previousEnd&&start<=previousEnd&&window.source_utf16_start===start&&window.source_utf16_end===end&&integer(window.tokens,1,256)&&integer(window.weight,1,source.length),'NATIVE194_WINDOW_PROGRESS_OR_WEIGHT');
      check(window.source_ranges?.length===1,'NATIVE194_WINDOW_SOURCE_RANGE');const range=window.source_ranges[0];check(range.role===part.role&&range.start===body.start+start&&range.end===body.start+end&&range.source_sha256===H(source.slice(start,end))&&range.encoded_sha256===window.sha256&&/^[a-f0-9]{64}$/u.test(range.projection_sha256),'NATIVE194_WINDOW_SOURCE_RANGE');
      let measureStart,measureEnd,total;
      if(window.weight_unit==='new_source_words'){
        measureStart=window.word_start;measureEnd=window.word_end;total=words.length;
        check(window.segmentation==='native_complete_words_before_encoding'&&integer(measureStart,0,total-1)&&integer(measureEnd,measureStart+1,total)&&start===(measureStart===0?0:words[measureStart].index)&&end===(measureEnd===total?source.length:words[measureEnd].index),'NATIVE194_WINDOW_WORD_BOUNDS');
      }else{
        measureStart=window.source_character_start;measureEnd=window.source_character_end;total=points.length;
        check(window.weight_unit==='new_source_codepoints'&&['native_cjk_codepoint_boundaries_before_encoding','native_all_language_nonoverlapping_codepoint_boundaries_v1','native_all_language_exhaustive_codepoint_partition_v1'].includes(window.segmentation)&&integer(measureStart,0,total-1)&&integer(measureEnd,measureStart+1,total)&&offsets[measureStart]===start&&offsets[measureEnd]===end,'NATIVE194_WINDOW_CODEPOINT_BOUNDS');
      }
      check((weightUnit===null||weightUnit===window.weight_unit)&&window.weight===measureEnd-Math.max(measureStart,previousMeasureEnd),'NATIVE194_WINDOW_EXACT_WEIGHT');
      weightUnit=window.weight_unit;weightSum+=window.weight;previousMeasureEnd=measureEnd;previousStart=start;previousEnd=end;
    }
    const total=weightUnit==='new_source_words'?words.length:points.length;check(previousEnd===source.length&&previousMeasureEnd===total&&weightSum===total,'NATIVE194_WINDOW_TERMINAL_COVERAGE');rows.push({arm:arm.id,occurrence_id:unit.occurrence_id,windows:windows.length,weight_unit:weightUnit,total_positive_unique_weight:weightSum,source_characters:source.length,strict_progress:true,source_coverage_complete:true});
  }
  check(rows.length===8,'NATIVE194_WINDOW_PLAN_COUNT');return{schema:'native-change-current194-window-qualification-v1',status:'STRICT_SOURCE_WEIGHT_PROGRESS_COVERAGE_PASSED',rows,frozen_v5_modified:false,extra_tokenizer_calls:0,model_inference:false,source_quality_gate_pass:false,authority:'NONE'};
}
const pinEquals=(actual,expected)=>actual?.path===expected.path&&actual.sha256===expected.sha256&&(expected.bytes===undefined||actual.bytes===expected.bytes);
const scope={governing_parent_fully_read:false,whole_original_document_read:false,effectiveness_conditions_verified:false,clean_operative_version_derived:false,human:false,authority:'NONE'};
const observations=()=>({samples,peak_self_rss_bytes:peakRSS,peak_heap_used_bytes:peakHeap,maximum_checkpoint_gap_ms:maxGap,checkpoints_only:true,continuous_resource_guarantee:false});

async function main(){
  check(process.platform==='linux'&&process.env.NONVERBA_CONTAINER==='1'&&process.argv.length===5,'ROOT_NATIVE194_ADMISSION_REQUIRED');check(same(process.execArgv,['--max-old-space-size=1024','--disable-proto=throw']),'NATIVE194_FLAGS');check(['LD_PRELOAD','LD_AUDIT','NODE_OPTIONS','NODE_PATH','BASH_ENV','ENV'].every(k=>!process.env[k]),'NATIVE194_ENV');
  admissionRef={path:process.argv[2],sha256:process.argv[3],bytes:Number(process.argv[4])};check(admissionRef.path===Q+'/admission.json','ROOT_NATIVE194_ADMISSION_REQUIRED');const a=json(admissionRef);
  check(a.schema==='ROOT_NATIVE_CHANGE_CURRENT194_MACHINE_PREPARATION_ADMISSION_V1'&&a.status==='ADMITTED_NATIVE0099_MACHINE_ONLY'&&a.source_snapshot===SNAPSHOT&&a.source_sha256===SOURCE&&same(a.input_refs,PINS)&&same(a.observed_issue_roster,OBSERVED_ISSUE_ROSTER)&&same(a.limits,LIMITS)&&a.api_invocations===1&&a.tokenizer_callbacks_reserved===160000&&a.separate_from_two_case_experimental_phase===true&&a.actual_reading===false&&a.actual_review_created===false&&a.resolution_called===false&&a.model_inference===false&&a.network_access===false&&a.quality_gate_pass===false&&a.authority==='NONE'&&integer(a.external_timeout_ms,1,LIMITS.elapsed_ms),'NATIVE194_ADMISSION');
  check(a.self_ref?.path===Q+'/prepare.mjs'&&fileURLToPath(import.meta.url)===a.self_ref.path&&a.self_ref.bytes<=LIMITS.source_copy_bytes,'NATIVE194_SELF');read(a.self_ref,LIMITS.source_copy_bytes);
  check(a.proposal_ref?.path===Q+'/proposal.json'&&a.clock_ref?.path===Q+'/clock.json','NATIVE194_CONTROL_PATH');proposalRef=a.proposal_ref;const proposal=json(proposalRef),clock=json(a.clock_ref);
  check(proposal.schema==='current194-native-change-machine-preparation-proposal-v1'&&proposal.status==='PROPOSED_ROOT_REVIEW_REQUIRED'&&proposal.execution_authority==='MACHINE_ONLY_NO_ACTUAL_REVIEW_OR_RESOLUTION'&&same(proposal.worker_ref,a.self_ref)&&same(proposal.input_refs,PINS)&&same(proposal.observed_issue_roster,OBSERVED_ISSUE_ROSTER)&&same(proposal.code_bindings,CODE_BINDINGS)&&same(proposal.limits,LIMITS)&&proposal.source_snapshot===SNAPSHOT&&proposal.source_sha256===SOURCE,'NATIVE194_PROPOSAL');
  check(clock.schema==='native-change-current194-machine-clock-v1'&&typeof clock.origin_ns==='string'&&/^\d+$/u.test(clock.origin_ns),'NATIVE194_CLOCK');origin=BigInt(clock.origin_ns);last=origin;check(process.hrtime.bigint()>=origin,'NATIVE194_CLOCK_FUTURE');admitted=true;checkpoint();check(size()+LIMITS.metadata_reserve_bytes<=LIMITS.qa_bytes,'NATIVE194_QA_BOUND');
  check(same(fs.readdirSync(Q).sort(),['admission.json','clock.json','prepare.mjs','proposal.json']),'NATIVE194_FRESH_QA');
  stage='FROZEN_SOURCE_AND_PROTECTED_FRESH_GUARD';for(const ref of CODE_BINDINGS)read({...ref,path:path.resolve(LIB,ref.path)},256*1024);
  const epoch=json(PINS.epoch),manifest=json(PINS.manifest);check(epoch.snapshot_code===SNAPSHOT&&epoch.source?.sha256===SOURCE&&same(epoch.source,manifest.source)&&same(epoch.source.runtime,{node:process.version,platform:process.platform,architecture:process.arch}),'NATIVE194_SOURCE');const{sha256:seal,...sourceBody}=manifest.source;check(D(sourceBody)===seal,'NATIVE194_SOURCE_SEAL');
  registryPreflight(freshGuard()); // Exact six metadata identities and protected29 exclusion before any raw/cache/native access.
  const records=manifest.contract_records.filter(r=>r.id===CID),caches=manifest.cache.filter(r=>r.id===CID);check(records.length===1&&caches.length===1,'NATIVE194_CASE_METADATA');const record=records[0],cacheRef=caches[0];check(record.status==='accepted'&&pinEquals(cacheRef,PINS.cache)&&cacheRef.source_sha256===SOURCE&&cacheRef.raw_sha256===PINS.raw.sha256&&record.raw_sha256===PINS.raw.sha256&&record.normalized_path===PINS.normalized.path&&record.normalized_sha256===PINS.normalized.sha256&&pinEquals(record.native_source_decorations?.artifact,PINS.native),'NATIVE194_LINEAGE');
  stage='EXISTING_API_ONE_CALL_RESERVED';const issue=json(PINS.issue);read(PINS.second_model_manifest);check(issue.audit_id==='coding-0099'&&issue.contract_id===CID&&issue.classification==='MATERIAL_NATIVE_CHANGE_MARKUP'&&issue.status==='UNRESOLVED'&&same({id:issue.parent?.id,start:issue.parent?.start,end:issue.parent?.end,sha256:issue.parent?.sha256},ANCHOR)&&pinEquals(issue.raw,PINS.raw),'NATIVE194_ISSUE');
  globalThis.fetch=()=>check(false,'NATIVE194_NETWORK_FORBIDDEN');
  const {prepareNativeChangeReplayEvidence}=await import(pathToFileURL(LIB+'source-issues.mjs').href);
  const {readJSON,studyPath,hashFile}=await import(pathToFileURL(LIB+'store.mjs').href);
  const {loadNativeDecoration}=await import(pathToFileURL(LIB+'native-decoration-store.mjs').href);
  const {createNativeDecorationView}=await import(pathToFileURL(LIB+'source-decoration.mjs').href);
  checkpoint();registryPreflight(freshGuard());const reservation=put('api-call-reservation.json',{schema:'native-change-current194-one-api-reservation-v1',admission_ref:admissionRef,api:'prepareNativeChangeReplayEvidence',api_invocations_reserved:1,tokenizer_callbacks_reserved:160000,basis:{plans:8,per_plan_cap:20000,encode_probe_cap_per_plan:20000,final_recounts_included:true},measured_callback_count_available:false,unused_counter_reservations_refunded:false,separate_from_two_case_experimental_phase:true,model_inference:false,actual_reading:false,authority:'NONE'});apiStarted=true;
  const machine=await prepareNativeChangeReplayEvidence(RUN,{issuePath:PINS.issue.path,issueSHA:PINS.issue.sha256,extraction_manifest:PINS.manifest,parent:ANCHOR,raw:PINS.raw,second_model_manifest:PINS.second_model_manifest});
  checkpoint();check(machine.binding.extraction_source_sha256===SOURCE&&pinEquals(machine.binding.cache,PINS.cache)&&pinEquals(machine.binding.raw,PINS.raw)&&pinEquals(machine.binding.normalized,PINS.normalized)&&same(machine.binding.observed_issues,OBSERVED_ISSUE_ROSTER.map(row=>row.issue))&&machine.binding.observed_issues_sha256===D(OBSERVED_ISSUE_ROSTER.map(row=>row.issue))&&machine.mechanical_verification.occurrences.length===2&&same(machine.input_readiness.arms.map(arm=>arm.id),['baseline-heading-unit','baseline-parent-context','second-model-heading-unit','lexical-heading-unit'])&&machine.input_readiness.arms.every(arm=>arm.units.length===2)&&machine.input_readiness.model_inference===false,'NATIVE194_MACHINE_BINDING');
  const binding=put('binding.json',machine.binding),mechanical=put('mechanical-verification.json',machine.mechanical_verification),readiness=put('input-readiness.json',machine.input_readiness);
  stage='EXACT_THREE_UNREAD_OUTPUTS';const currentCache=await readJSON(RUN,machine.binding.cache.path);checkpoint();const rawPath=await studyPath(RUN,PINS.raw.path),normalPath=await studyPath(RUN,PINS.normalized.path);const rawActual=await hashFile(rawPath),normalActual=await hashFile(normalPath);check(rawActual.sha256===PINS.raw.sha256&&rawActual.bytes===PINS.raw.bytes&&normalActual.sha256===PINS.normalized.sha256,'NATIVE194_SOURCE_STRINGS');
  const rawText=fs.readFileSync(rawPath,'utf8'),normalizedText=fs.readFileSync(normalPath,'utf8');check(H(rawText)===PINS.raw.sha256&&H(normalizedText)===PINS.normalized.sha256,'NATIVE194_SOURCE_STRINGS');checkpoint();
  stage='STRICT_FROZEN_WINDOW_QUALIFICATION';const qualification=put('native-window-qualification.json',qualifyWindows(machine,normalizedText));stage='EXACT_THREE_UNREAD_OUTPUTS';
  check(pinEquals(currentCache.native_source_decorations?.artifact,PINS.native)&&same(currentCache.native_source_decorations,record.native_source_decorations),'NATIVE194_NATIVE_REFERENCE');const envelope=await loadNativeDecoration(RUN,currentCache.native_source_decorations);checkpoint();check(envelope.sha256===machine.binding.envelope_sha256,'NATIVE194_ENVELOPE');const view=createNativeDecorationView(envelope,{raw:rawText,normalizedText}),readerSHA=machine.binding.method.find(file=>file.path==='source-issues.mjs')?.sha256;check(readerSHA===CODE_BINDINGS[0].sha256,'NATIVE194_READER_SOURCE');
  const selections=[...machine.mechanical_verification.occurrences.map(row=>({id:row.id,raw:row.raw_context,normalized:row.normalized_context})),{id:'instruction-context',raw:machine.mechanical_verification.instruction_context}],outputs=[];
  check(same(selections.map(x=>x.id),['adjusted-libo-rate-floor','libor-quoted-rate-floor','instruction-context']),'NATIVE194_OUTPUT_IDS');
  for(const selected of selections){checkpoint();const rawRange={start:selected.raw.start,end:selected.raw.end},normalRange=selected.normalized?{start:selected.normalized.start,end:selected.normalized.end}:null,projection=normalRange?view.project({...normalRange,includeEndZeroWidth:true}):null;
    const output={schema:'native-change-actual-read-output-v1',id:selected.id,cache_ref:machine.binding.cache,envelope_sha256:envelope.sha256,reader_source_sha256:readerSHA,actual_reading:false,raw:{path:PINS.raw.path,sha256:PINS.raw.sha256,range:rawRange,text:rawText.slice(rawRange.start,rawRange.end)},...(normalRange?{normalized:{path:PINS.normalized.path,sha256:PINS.normalized.sha256,range:normalRange,text:normalizedText.slice(normalRange.start,normalRange.end)},projection:{range:projection.range,sha256:D(projection),value:projection}}:{})};
    const reference=put('read-output-'+selected.id+'.json',output,{readOutput:true});outputs.push({id:selected.id,reference,raw_range:rawRange,normalized_range:normalRange,projection_sha256:projection?D(projection):null,projection_annotations:projection?.annotations.length??0,actual_reading:false});
  }
  stage='MACHINE_ONLY_PACKAGE';const value={schema:'native6-machine-only-evidence-package-v1',status:'MACHINE_EVIDENCE_READY_ACTUAL_REVIEW_NOT_RUN',issue:PINS.issue,source_snapshot:SNAPSHOT,extraction_manifest:PINS.manifest,extraction_source_sha256:SOURCE,runner:a.self_ref,proposal:proposalRef,admission_ref:admissionRef,api_reservation_ref:reservation,native_window_qualification:qualification,reference_anchor:{original:{...ANCHOR,scope:'REFERENCE_ONLY'},current:{...ANCHOR,scope:'REFERENCE_ONLY'},actual_reading:false},binding,mechanical_verification:mechanical,input_readiness:readiness,read_outputs:outputs,tokenizer_callbacks_reserved:160000,measured_callback_count_available:false,total_input_read_bytes_measured:false,hard_total_input_read_bound_claimed:false,finite_input_validation:'Existing API validates each source/cache/native/model artifact and recomputes raw-source extraction; registry authentication and full model-asset hashing also read named files.',resources:observations(),elapsed_ms:elapsed(),qa_bytes_before_package:size(),actual_reading:false,actual_review_created:false,resolution_called:false,native6_hold:'UNCHANGED_AWAITING_NEW_ACTUAL_BOUNDED_NATIVE_CHANGE_REVIEW',model_inference:false,fitting:false,fresh_opened:false,source_quality_gate_pass:false,...scope,execution_attested:false};
  const packageRef=put('package.json',value),printed=JSON.stringify({status:value.status,package_ref:packageRef,mechanical_verification:mechanical,input_readiness:readiness,counts:{occurrences:2,plans:8,windows:machine.input_readiness.arms.reduce((n,arm)=>n+arm.units.reduce((m,unit)=>m+unit.input.windows.length,0),0),unread_outputs:3},tokenizer_callbacks_reserved:160000,measured_callback_count_available:false,elapsed_ms:elapsed(),resource_observations:observations(),qa_bytes:size(),strict_window_qualification_passed:true,actual_reading:false,actual_review_created:false,resolution_called:false,model_inference:false,source_quality_gate_pass:false});check(Buffer.byteLength(printed)<=4096,'NATIVE194_CONSOLE_BOUND');console.log(printed);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{let held=null;if(admitted)try{held=put('held.json',{schema:'native-change-current194-machine-held-v1',status:'HELD_PRESERVED_NO_REVIEW_OR_RESOLUTION',stage,code:safe(error),admission_ref:admissionRef,api_started:apiStarted,tokenizer_callbacks_reserved:apiStarted?160000:0,measured_callback_count_available:false,unused_counter_reservations_refunded:false,partial_artifacts_preserved:true,resources:observations(),elapsed_ms:elapsed(),actual_reading:false,actual_review_created:false,resolution_called:false,model_inference:false,source_quality_gate_pass:false,...scope},{held:true});}catch{}console.error(JSON.stringify({status:'HELD_PRESERVED_NO_REVIEW_OR_RESOLUTION',stage,code:safe(error),held_ref:held,api_started:apiStarted,tokenizer_callbacks_reserved:apiStarted?160000:0,actual_reading:false,actual_review_created:false,resolution_called:false,source_quality_gate_pass:false}));process.exitCode=77;});
