// SPDX-License-Identifier: AGPL-3.0-only
// Small fictional /tmp controls only. No corpus, RUN walk, model or tokenizer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CAPACITY_BINDINGS,EXECUTION_LIMITS as L,EXECUTION_RESERVATION as R,assessExecutionSample,createExecutionBook,digest,parseProcessObservation,sha,validateExecutionConfig} from './pilot-execution-control.mjs';
import {ACTUAL_EXECUTION_ENABLED,ownedIdentityMatches,readProcessInfo,supervisePilotFixture} from './pilot-execution-guardian.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),study='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
const ids=n=>Array.from({length:n},(_,i)=>'SYNTHETIC_AUDIT_'+String(i).padStart(4,'0'));
const fakeRef=path=>({path,sha256:'a'.repeat(64),bytes:1});
function pureConfig(phase='METADATA_SELECTION_ONLY'){
  const expected=ids(phase==='METADATA_SELECTION_ONLY'?200:69),root='/tmp/literal-emphasis-next-PURE';
  return {schema:'literal-emphasis-exact69-guardian-config-v1',mode:'SOURCE_FREE_FIXTURE',phase,root,source_epoch_sha256:'a'.repeat(64),runtime:{...fakeRef('/synthetic/node'),version:'v22.23.3',platform:'linux',architecture:'x64',flags:[]},closure:[fakeRef('/synthetic/worker.mjs')],worker:fakeRef('/synthetic/worker.mjs'),bindings:{development:fakeRef('development.json'),fresh:fakeRef('fresh.json'),manifest:fakeRef('manifest.json')},mandatory_audit_ids:expected.slice(0,45),selected_freeze_ref:phase==='PREPARE_SELECTED69'?fakeRef('selected.json'):null,metadata_projection_ref:phase==='PREPARE_SELECTED69'?fakeRef('projection.json'):null,expected_ids:expected,stream_ids:phase==='PREPARE_SELECTED69'?expected.slice(0,4).map(id=>id+':'+'b'.repeat(64)+':focal'):[],allowed_writes:[{case_id:'SYNTHETIC_STAGE',path:'projection.json',kind:'metadata'}],capacity:{helper:CAPACITY_BINDINGS.helper,policy:CAPACITY_BINDINGS.policy,fixture_policy:{study_root:root,exceptions:[{},{}]}},limits:{...L},actual_authorization:null};
}
test('actual mode, changed caps, protected IDs, source without frozen selection and extra fields reject',()=>{
  assert.equal(ACTUAL_EXECUTION_ENABLED,false);
  for(const change of [c=>c.mode='ACTUAL',c=>c.limits.private_capture_bytes++,c=>c.expected_ids[0]='development-0045',c=>c.extra=true,c=>c.actual_authorization={self_sealed:true}]){const c=pureConfig();change(c);assert.throws(()=>validateExecutionConfig(c));}
  const source=pureConfig('PREPARE_SELECTED69');source.selected_freeze_ref=null;assert.throws(()=>validateExecutionConfig(source),{code:'PILOT_SEPARATE_FROZEN_SELECTION_REQUIRED'});
});
test('physical reservation floor differs from growth baseline; unknown/shrunk counters and hard caps reject',()=>{
  const sample={study_bytes:R.run_at_reservation,pilot_bytes:0,capture_bytes:0,aggregate_rss_bytes:1,elapsed_ms:0,total_calls:0};assert.equal(assessExecutionSample(sample),true);
  assert.throws(()=>assessExecutionSample({...sample,study_bytes:R.baseline}),{code:'PILOT_RUN_SHRANK_REQUIRES_REVIEW'});
  assert.throws(()=>assessExecutionSample({...sample,study_bytes:NaN}));
  assert.equal(assessExecutionSample({...sample,study_bytes:R.baseline+R.hard}),true);assert.throws(()=>assessExecutionSample({...sample,study_bytes:R.baseline+R.hard+1}));
  assert.throws(()=>assessExecutionSample({...sample,study_bytes:R.baseline+R.soft+1},{admission:true}));
  for(const [key,cap]of [['pilot_bytes',L.pilot_new_run_bytes],['capture_bytes',L.private_capture_bytes],['aggregate_rss_bytes',L.aggregate_supervisor_and_worker_rss_bytes],['elapsed_ms',L.elapsed_ms],['total_calls',L.global_tokenizer_calls]])assert.throws(()=>assessExecutionSample({...sample,[key]:cap+1}));
});
test('global/per-stream counters are monotone, every call attributed, metadata has no tokenizer streams',()=>{
  const c=pureConfig('PREPARE_SELECTED69'),book=createExecutionBook(c);let total=0;
  for(const stream_id of c.stream_ids.slice(0,3))for(let count=32;count<=20000;count+=32){total+=32;book.progress({type:'PROGRESS',case_id:stream_id.split(':')[0],stream_id,total_calls:total,stream_calls:count,completed_windows:Math.floor(count/32)});}
  assert.equal(book.totalCalls,60000);assert.throws(()=>book.progress({type:'PROGRESS',case_id:c.expected_ids[3],stream_id:c.stream_ids[3],total_calls:60001,stream_calls:1,completed_windows:1}));
  const fresh=createExecutionBook(c),row={type:'PROGRESS',case_id:c.expected_ids[0],stream_id:c.stream_ids[0],total_calls:1,stream_calls:1,completed_windows:1};fresh.progress(row);assert.throws(()=>fresh.progress({...row,total_calls:2,stream_calls:0}));assert.throws(()=>fresh.progress({...row,total_calls:35,stream_calls:35}));assert.throws(()=>fresh.progress({...row,total_calls:2,stream_calls:2,completed_windows:8193}));
  assert.throws(()=>createExecutionBook(pureConfig()).progress(row),{code:'PILOT_STREAM_SCOPE'});
});
test('write reservations reject retries, undeclared paths, decoded overflow and successful prefixes',()=>{
  const c=pureConfig(),book=createExecutionBook(c),request={type:'WRITE_REQUEST',request_id:'r1',case_id:'SYNTHETIC_STAGE',path:'projection.json',kind:'metadata',encoded_bytes:100,decoded_bytes:100};book.request(request);assert.throws(()=>book.request(request));
  assert.throws(()=>book.done({type:'DONE',status:'COMPLETE',total_calls:0,completed_ids:c.expected_ids,failed_ids:[],remaining_ids:[],output_refs:[]}));
  const b=createExecutionBook(c);assert.throws(()=>b.request({...request,path:'../outside.json'}));assert.throws(()=>b.request({...request,encoded_bytes:8388609,decoded_bytes:8388609}));
  assert.throws(()=>createExecutionBook(c).done({type:'DONE',status:'COMPLETE',total_calls:0,completed_ids:c.expected_ids,failed_ids:[],remaining_ids:[],output_refs:[]}),{code:'PILOT_MISSING_DECLARED_OUTPUT'});
  assert.throws(()=>createExecutionBook(c).done({type:'DONE',status:'HELD',total_calls:0,completed_ids:[],failed_ids:[],remaining_ids:c.expected_ids.slice(1),output_refs:[]}),{code:'PILOT_ORIGINAL_DENOMINATOR'});
});
test('ownership requires exact PID and birth; never trusts stale/reused identity',()=>{
  const record={pid:1,start_ticks:'123',group:1};assert.equal(ownedIdentityMatches(record,{...record}),true);assert.equal(ownedIdentityMatches(record,{...record,start_ticks:'124'}),false);assert.equal(ownedIdentityMatches(record,{...record,pid:2}),false);assert.equal(ownedIdentityMatches(record,null),false);
});

function syntheticStat({pid=123,ppid='1',group='123',birth='456',rss='7',comm='SYNTHETIC (worker) name'}={}){const fields=Array(50).fill('0');fields[0]='S';fields[1]=ppid;fields[2]=group;fields[19]=birth;fields[21]=rss;return pid+' ('+comm+') '+fields.join(' ')+'\n';}
test('proc parser requires complete numeric identity, RSS and children; malformed evidence is unknown',()=>{
  const valid=syntheticStat();assert.deepEqual(parseProcessObservation(123,valid,'124 125 \n'),{pid:123,ppid:1,group:123,start_ticks:'456',rss:28672,children:[124,125]});
  for(const bad of [syntheticStat({pid:124}),valid.split(' ').slice(0,-2).join(' '),syntheticStat({birth:'0'}),syntheticStat({birth:'NaN'}),syntheticStat({group:'-1'}),syntheticStat({rss:'-1'}),syntheticStat({rss:'9007199254740991'}),valid.replace(') S ',') ? ')])assert.throws(()=>parseProcessObservation(123,bad,''),{code:'PILOT_PROCESS_OBSERVATION_UNKNOWN'});
  for(const bad of ['124 NaN','0','124 124','01'])assert.throws(()=>parseProcessObservation(123,valid,bad),{code:'PILOT_PROCESS_OBSERVATION_UNKNOWN'});
});
test('proc I/O distinguishes confirmed disappearance from denied, failed or inconsistent observations',()=>{
  const error=code=>Object.assign(new Error('SYNTHETIC_PROC_FAILURE'),{code}),stat=syntheticStat();
  for(const code of ['ENOENT','ESRCH'])assert.equal(readProcessInfo(123,{io:{readFileSync(){throw error(code);}}}),null);
  for(const code of ['EACCES','EIO','EPERM'])assert.throws(()=>readProcessInfo(123,{io:{readFileSync(){throw error(code);}}}),{code:'PILOT_PROCESS_OBSERVATION_UNKNOWN',syscall_code:code});
  for(const code of ['EACCES','EIO'])assert.throws(()=>readProcessInfo(123,{io:{readFileSync(file){if(file.endsWith('/stat'))return stat;throw error(code);}}}),{code:'PILOT_PROCESS_OBSERVATION_UNKNOWN',observation_reason:'CHILDREN_READ_FAILED'});
  assert.throws(()=>readProcessInfo(123,{io:{readFileSync(file){if(file.endsWith('/stat'))return stat;throw error('ENOENT');}}}),{code:'PILOT_PROCESS_OBSERVATION_UNKNOWN',observation_reason:'CHILDREN_MISSING_BUT_PROCESS_STAT_PRESENT'});
  let reads=0;assert.equal(readProcessInfo(123,{io:{readFileSync(){if(++reads===1)return stat;throw error('ENOENT');}}}),null);
  assert.throws(()=>readProcessInfo(123,{io:{readFileSync(){return '123 (SYNTHETIC) S 1';}}}),{code:'PILOT_PROCESS_OBSERVATION_UNKNOWN'});
});
test('caller policy mutation cannot change admitted IDs, output paths or stream scope',()=>{
  const c=pureConfig(),book=createExecutionBook(c);c.expected_ids[0]='SYNTHETIC_SUBSTITUTED';c.allowed_writes[0].path='changed.json';
  assert.doesNotThrow(()=>book.request({type:'WRITE_REQUEST',request_id:'detached',case_id:'SYNTHETIC_STAGE',path:'projection.json',kind:'metadata',encoded_bytes:2,decoded_bytes:2}));
  const source=pureConfig('PREPARE_SELECTED69'),counter=createExecutionBook(source);source.stream_ids.push('SYNTHETIC_OTHER:'+('b'.repeat(64))+':focal');assert.throws(()=>counter.progress({type:'PROGRESS',case_id:'SYNTHETIC_OTHER',stream_id:source.stream_ids.at(-1),total_calls:1,stream_calls:1,completed_windows:1}));
});

const WORKER=behavior=>`
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const behavior=${JSON.stringify(behavior)},hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const fields=fs.readFileSync('/proc/'+process.pid+'/stat','utf8').split(') ')[1].split(' '),birth=fields[19];
process.stdout.write('SYNTHETIC_BOOT_CAPTURE\\n');
if(behavior==='EARLY'){process.send({type:'PROGRESS'});setInterval(()=>{},1000);}
else{
  if(behavior==='OVERFLOW'){process.stdout.write(Buffer.alloc(262144+8192,88));setInterval(()=>{},1000);}
  process.send({type:'HELLO',schema:'pilot-owned-worker-hello-v1',pid:process.pid,start_ticks:birth});
  let cfg,bytes,reference,request;
  process.on('message',m=>{
    if(m.type==='REGISTERED'){if(m.pid!==process.pid||m.start_ticks!==birth)throw Error('SYNTHETIC_BAD_REGISTRY');process.send({type:'READY',registry_sha256:m.registry_sha256});}
    else if(m.type==='INIT'){
      const original=fs.readFileSync(process.argv[2]);if(hash(original)!==process.argv[3]||original.length!==Number(process.argv[4]))throw Error('SYNTHETIC_CONFIG_HASH');cfg=JSON.parse(original);
      bytes=Buffer.from(JSON.stringify({schema:'DECLARED_SYNTHETIC_OUTPUT',worker_pid:process.pid,actual_reading:false,source_quality_passed:false,authority:'NONE'},null,2)+'\\n');
      reference={path:'projection.json',sha256:hash(bytes),bytes:bytes.length};request={type:'WRITE_REQUEST',request_id:'r1',case_id:'SYNTHETIC_STAGE',path:reference.path,kind:'metadata',encoded_bytes:bytes.length,decoded_bytes:bytes.length};
      if(behavior!=='OVERFLOW')process.send(request);
    }else if(m.type==='WRITE_GRANTED'){
      const out=path.join(cfg.root,reference.path),fd=fs.openSync(out,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);if(behavior==='TAMPER')fs.appendFileSync(out,'X');
      process.send({type:'WRITE_COMMITTED',request_id:'r1',ref:reference,decoded_sha256:hash(bytes),decoded_bytes:bytes.length});
    }else if(m.type==='WRITE_VERIFIED'){
      const out=path.join(cfg.root,reference.path);
      if(behavior==='LATE_APPEND')fs.appendFileSync(out,'X');
      if(behavior==='LATE_REPLACE')fs.writeFileSync(out,Buffer.from(bytes.toString().replace('DECLARED_SYNTHETIC_OUTPUT','CHANGED_SYNTHETIC_OUTPUT!')));
      if(behavior==='LATE_DELETE')fs.unlinkSync(out);
      process.send({type:'DONE',status:'COMPLETE',total_calls:0,completed_ids:cfg.expected_ids,failed_ids:[],remaining_ids:[],output_refs:[{...reference,decoded_sha256:hash(bytes),decoded_bytes:bytes.length}]},()=>process.disconnect());
    }
  });
}
`;
function fileRef(file){const b=fs.readFileSync(file);return {path:file,sha256:sha(b),bytes:b.length};}
function fixture(behavior='SUCCESS'){
  const root=fs.mkdtempSync('/tmp/literal-emphasis-next-');fs.mkdirSync(root+'/target-directory');fs.writeFileSync(root+'/target-file','SYNTHETIC');fs.symlinkSync(root+'/target-directory',root+'/known-directory-link');fs.symlinkSync(root+'/target-file',root+'/known-file-link');
  const original=JSON.parse(fs.readFileSync(study+'/'+CAPACITY_BINDINGS.policy.path)),policy=structuredClone(original);policy.study_root=root;policy.exceptions=['known-directory-link','known-file-link'].map(name=>{const f=root+'/'+name,s=fs.lstatSync(f),literal=fs.readlinkSync(f),t=fs.lstatSync(literal);return {path:name,type:'SYMLINK',mode:s.mode,bytes:s.size,literal_target:literal,link_text_sha256:sha(Buffer.from(literal)),target:{path:path.basename(literal),type:t.isFile()?'FILE':'DIRECTORY',mode:t.mode,bytes:t.size,dev:t.dev,ino:t.ino}};});
  fs.writeFileSync(root+'/worker.mjs',WORKER(behavior));const cfg=pureConfig();cfg.root=root;cfg.worker=fileRef(root+'/worker.mjs');cfg.closure=[cfg.worker,fileRef(here+'/pilot-execution-guardian.mjs'),fileRef(here+'/pilot-execution-control.mjs')];
  cfg.runtime={path:process.execPath,sha256:'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48',bytes:124827920,version:process.version,platform:process.platform,architecture:process.arch,flags:[]};
  cfg.capacity.fixture_policy=policy;
  for(const key of ['development','fresh','manifest']){fs.writeFileSync(root+'/'+key+'.json',JSON.stringify({schema:'SYNTHETIC_METADATA_ONLY'}));cfg.bindings[key]={...fileRef(root+'/'+key+'.json'),path:key+'.json'};}
  fs.writeFileSync(root+'/configuration.json',JSON.stringify(cfg,null,2)+'\n');return {root,config:cfg,ref:fileRef(root+'/configuration.json')};
}
test('real fixture handshake captures before HELLO, rehashes writes, verifies termination and preserves original200',async()=>{
  const f=fixture(),pending=supervisePilotFixture(f.ref);f.ref.path='/opt/DO_NOT_OPEN_AFTER_ADMISSION';const {result,receipt}=await pending;assert.equal(result.status,'SOURCE_FREE_FIXTURE_COMPLETE_NOT_ACTUAL_AUTHORIZATION');assert.equal(result.original_denominator,200);assert.deepEqual(result.completed_ids,f.config.expected_ids);assert.deepEqual(result.remaining_ids,[]);assert.equal(result.owned_absence_verified,true);assert.equal(result.terminal_samples.length,3);assert.equal(result.private_capture_complete,true);assert.equal(result.private_capture_stored_bytes,result.private_capture_observed_bytes);assert.ok(fs.readFileSync(f.root+'/guardian/worker.stdout.private.log','utf8').includes('SYNTHETIC_BOOT_CAPTURE'));assert.equal(sha(fs.readFileSync(f.root+'/'+receipt.path)),receipt.sha256);assert.equal(result.source_quality_passed,false);assert.equal(result.actual_execution_enabled,false);assert.match(result.capacity_scope,/VIRTUAL/);
});

test('every committed output is reverified after owned join; late append, same-length replacement and deletion hold',async()=>{
  for(const behavior of ['LATE_APPEND','LATE_REPLACE','LATE_DELETE']){
    const f=fixture(behavior),{result}=await supervisePilotFixture(f.ref);assert.match(result.status,/HELD/);assert.equal(result.stop_code,'PILOT_TERMINAL_OUTPUT_CHANGED');assert.equal(result.all_committed_outputs_reverified_after_owned_join,false);assert.equal(result.verified_output_refs.length,1);assert.equal(result.final_output_readback.length,1);const row=result.final_output_readback[0];assert.equal(row.status,'HELD_FINAL_READBACK_FAILED');assert.deepEqual(row.ref,result.verified_output_refs[0]);assert.equal(result.pending_writes,0);assert.equal(result.owned_absence_verified,true);assert.deepEqual(result.completed_ids,f.config.expected_ids);assert.equal(result.original_denominator,200);
    if(behavior==='LATE_DELETE')assert.equal(row.observed_file.status,'MISSING');else{assert.equal(row.observed_file.status,'PRESENT_REGULAR_FILE');const current=fs.readFileSync(f.root+'/projection.json');assert.notEqual(sha(current),row.ref.sha256);assert.equal(current.length,row.ref.bytes+(behavior==='LATE_APPEND'?1:0));}
  }
});

async function unknownProcFixture(code,{afterExit=false}={}){
  const f=fixture(),original=fs.readFileSync;let injected=0;
  fs.readFileSync=function(file,...args){
    let pid=null;try{pid=JSON.parse(original(f.root+'/projection.json','utf8')).worker_pid;}catch{}
    if(file==='/proc/'+pid+'/stat'){
      if(!afterExit&&injected<2){injected++;throw Object.assign(new Error('SYNTHETIC_UNKNOWN_PROC'),{code});}
      if(afterExit&&injected===0){try{return original(file,...args);}catch(e){if(['ENOENT','ESRCH'].includes(e.code)){injected++;throw Object.assign(new Error('SYNTHETIC_UNKNOWN_TERMINAL_PROC'),{code});}throw e;}}
    }
    return original(file,...args);
  };
  try{return {f,injected:()=>injected,...await supervisePilotFixture(f.ref)};}finally{fs.readFileSync=original;}
}
test('unknown live proc observations cannot silently drop RSS/ownership or authorize unrelated signals',async()=>{
  for(const code of ['EACCES','EIO']){const {f,result,injected}=await unknownProcFixture(code);assert.equal(injected(),2);assert.match(result.status,/HELD/);assert.equal(result.error.code,'PILOT_PROCESS_OBSERVATION_UNKNOWN');assert.equal(result.all_process_observations_known,false);assert.equal(result.owned_absence_verified,false);assert.equal(result.process_observation_failures.filter(r=>r.syscall_code===code).reduce((sum,r)=>sum+r.count,0),2);assert.deepEqual(result.remaining_ids,f.config.expected_ids);assert.ok(result.owned_signals.every(s=>result.owned_identity_records.some(r=>s.pid===r.pid&&s.start_ticks===r.start_ticks)));}
});
test('unknown proc observation after child exit is retained through finally and prevents successful absence claims',async()=>{
  const {result,injected}=await unknownProcFixture('EACCES',{afterExit:true});assert.equal(injected(),1);assert.match(result.status,/HELD/);assert.equal(result.all_process_observations_known,false);assert.equal(result.owned_absence_verified,false);assert.equal(result.owned_IO_joined,true);assert.equal(result.terminal_samples.length,3);assert.ok(result.process_observation_failures.some(row=>row.syscall_code==='EACCES'));assert.equal(result.all_committed_outputs_reverified_after_owned_join,true);
});
test('pre-HELLO event cannot obtain INIT; only exact owned PID is stopped and all original IDs remain',async()=>{
  const f=fixture('EARLY'),{result}=await supervisePilotFixture(f.ref);assert.match(result.status,/HELD/);assert.equal(result.registry,null);assert.equal(result.owned_absence_verified,true);assert.deepEqual(result.remaining_ids,f.config.expected_ids);assert.ok(result.owned_signals.every(s=>s.pid===result.owned_identity_records[0].pid));assert.equal(result.terminal_samples.length,3);
});
test('bounded relay never stores a successful oversized capture prefix',async()=>{
  const f=fixture('OVERFLOW'),{result}=await supervisePilotFixture(f.ref);assert.match(result.status,/HELD/);assert.equal(result.private_capture_complete,false);assert.ok(result.private_capture_discarded_after_cap_bytes>0);assert.ok(result.private_capture_stored_bytes<=L.private_capture_bytes);assert.equal(result.owned_absence_verified,true);assert.deepEqual(result.remaining_ids,f.config.expected_ids);
});
test('real committed artifact tamper is held with pending write and original denominator retained',async()=>{
  const f=fixture('TAMPER'),{result}=await supervisePilotFixture(f.ref);assert.match(result.status,/HELD/);assert.equal(result.pending_writes,1);assert.equal(result.verified_output_refs.length,0);assert.deepEqual(result.remaining_ids,f.config.expected_ids);assert.ok(fs.existsSync(f.root+'/projection.json'));assert.equal(result.owned_absence_verified,true);
});
test('source-free confinement and changed executable reject before worker spawn',async()=>{
  await assert.rejects(()=>supervisePilotFixture({path:'/opt/DO_NOT_OPEN_ACTUAL',sha256:'a'.repeat(64),bytes:1}),{code:'PILOT_SOURCE_FREE_ROOT'});
  const f=fixture();fs.appendFileSync(f.config.worker.path,'\n// SYNTHETIC_TAMPER');await assert.rejects(()=>supervisePilotFixture(f.ref),{code:'PILOT_FILE_LENGTH'});assert.equal(fs.existsSync(f.root+'/guardian'),false);
});
