// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED. Only tiny /tmp SOURCE_FREE_FIXTURE execution is enabled.
import fs from 'node:fs';
import path from 'node:path';
import {fork} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gunzipSync,gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {CAPACITY_BINDINGS,EXECUTION_LIMITS as LIMITS,EXECUTION_RESERVATION as RESERVATION,IPC_MAX_BYTES,assessExecutionSample,canonical,createExecutionBook,digest,exact,fail,fixtureRoot,integer,parseProcessObservation,reference,relative,same,sha,validateExecutionConfig} from './control.mjs';
import {assertOwnedBootstrapProof,monotonicActiveMs} from './bootstrap.mjs';
import {admitFictionalPhase,admitActualExecution} from './admission.mjs';
import {createFictionalResourceJournal} from './resource-journal.mjs';
import {verifyPhaseCheckpoint} from './checkpoint.mjs';

const STUDY='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
export const ACTUAL_EXECUTION_ENABLED=false;
const SELF=fileURLToPath(import.meta.url),CONTROL=fileURLToPath(new URL('./control.mjs',import.meta.url));
const SAMPLE_MS=250,CAPACITY_MS=1000,HANDSHAKE_MS=5000,TERM_GRACE_MS=1000,KILL_JOIN_MS=2000,RECEIPT_RESERVE=131072;

function unlinked(file,{missing=false}={}){
  if(typeof file!=='string'||!path.isAbsolute(file)||path.resolve(file)!==file)fail('PILOT_FILE_PATH');let at='/';const parts=file.split('/').filter(Boolean);
  for(let i=0;i<parts.length;i++){at=path.join(at,parts[i]);let stat;try{stat=fs.lstatSync(at);}catch(error){if(missing&&error.code==='ENOENT'&&i===parts.length-1)return file;throw error;}if(stat.isSymbolicLink()||i<parts.length-1&&!stat.isDirectory())fail('PILOT_LINKED_PATH');}return file;
}
function boundFile(ref,{maxBytes=268435456,bytes=false}={}){
  reference(ref,{absolute:true,maxBytes});const fd=fs.openSync(unlinked(ref.path),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size!==ref.bytes)fail('PILOT_FILE_LENGTH');const chunks=[],buffer=Buffer.alloc(65536);let at=0;
    // Hash bounded chunks without collecting executable/runtime bytes.
    const hashState=createHash('sha256');
    while(at<ref.bytes){const n=fs.readSync(fd,buffer,0,Math.min(buffer.length,ref.bytes-at),at);if(!n)fail('PILOT_FILE_TRUNCATED');at+=n;hashState.update(buffer.subarray(0,n));if(bytes)chunks.push(Buffer.from(buffer.subarray(0,n)));}
    if(fs.readSync(fd,buffer,0,1,at)||fs.fstatSync(fd).size!==ref.bytes||hashState.digest('hex')!==ref.sha256)fail('PILOT_FILE_INTEGRITY');return bytes?Buffer.concat(chunks):null;
  }finally{fs.closeSync(fd);}
}
function boundJSON(ref,maxBytes=8388608){const bytes=boundFile(ref,{maxBytes,bytes:true});try{return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));}catch{fail('PILOT_JSON_INVALID');}}
function under(root,name){relative(name);return path.join(root,name);}
function outputReference(root,name){const file=unlinked(under(root,name)),stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>LIMITS.per_case_compressed_artifact_bytes)fail('PILOT_OUTPUT_FILE_BOUND');const bytes=fs.readFileSync(file);return {path:name,sha256:sha(bytes),bytes:bytes.length};}
export function readProcessInfo(pid,{io=fs}={}){
  integer(pid,1);const statPath='/proc/'+pid+'/stat',childrenPath='/proc/'+pid+'/task/'+pid+'/children',gone=e=>['ENOENT','ESRCH'].includes(e?.code);
  const unknown=(reason,e)=>{throw Object.assign(new Error('Unknown owned process observation'),{code:'PILOT_PROCESS_OBSERVATION_UNKNOWN',observation_reason:reason,pid,syscall_code:/^[A-Z0-9_]{1,32}$/u.test(e?.code??'')?e.code:null});};
  let stat,children;try{stat=io.readFileSync(statPath,'utf8');}catch(e){if(gone(e))return null;unknown('STAT_READ_FAILED',e);}
  parseProcessObservation(pid,stat,''); // Never erase an already-invalid stat as a later disappearance.
  try{children=io.readFileSync(childrenPath,'utf8');}catch(e){if(!gone(e))unknown('CHILDREN_READ_FAILED',e);try{io.readFileSync(statPath,'utf8');}catch(confirm){if(gone(confirm))return null;unknown('DISAPPEARANCE_CONFIRMATION_FAILED',confirm);}unknown('CHILDREN_MISSING_BUT_PROCESS_STAT_PRESENT',e);}
  return parseProcessObservation(pid,stat,children);
}
export function ownedIdentityMatches(record,current){const valid=r=>r&&Number.isSafeInteger(r.pid)&&r.pid>0&&/^\d+$/u.test(r.start_ticks??'')&&Number.isSafeInteger(Number(r.start_ticks))&&Number(r.start_ticks)>0;return Boolean(valid(record)&&valid(current)&&record.pid===current.pid&&record.start_ticks===current.start_ticks);}
/** Pure bounded race used by the fixed guardian; injected scheduling exists
 * only for small fake-clock controls, never for an actual entry. */
export function waitForOwnedClose(closePromise,stopPromise,{timeout_ms,schedule=setTimeout,cancel=clearTimeout}={}){
  integer(timeout_ms,0,LIMITS.elapsed_ms);return new Promise(resolve=>{let settled=false,timer=null;const finish=value=>{if(settled)return;settled=true;if(timer!==null)cancel(timer);resolve(Object.freeze(value));};timer=schedule(()=>finish({kind:'TIMEOUT',code:'PILOT_MAIN_WAIT_BOUND'}),timeout_ms);if(settled)cancel(timer);Promise.resolve(closePromise).then(value=>finish({kind:'CLOSED',value}),()=>finish({kind:'CLOSE_ERROR',code:'PILOT_WORKER_CLOSE_OBSERVATION_FAILED'}));Promise.resolve(stopPromise).then(code=>finish({kind:'STOPPED',code:typeof code==='string'?code:'PILOT_STOPPED_UNKNOWN'}),()=>finish({kind:'STOPPED',code:'PILOT_STOP_OBSERVATION_FAILED'}));});
}
function exclusiveJSON(root,name,value){const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');if(bytes.length>RECEIPT_RESERVE)fail('PILOT_RECEIPT_BOUND');const file=unlinked(under(root,name),{missing:true}),fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return {path:name,sha256:sha(bytes),bytes:bytes.length};}
function artifactBytes(root,request,message){
  reference(message.ref,{maxBytes:LIMITS.per_case_compressed_artifact_bytes});if(message.ref.path!==request.path||message.ref.bytes!==request.encoded_bytes||message.decoded_bytes!==request.decoded_bytes)fail('PILOT_WRITE_COMMIT_BINDING');
  const encoded=boundFile({...message.ref,path:under(root,message.ref.path)},{maxBytes:LIMITS.per_case_compressed_artifact_bytes,bytes:true});let decoded=encoded;
  if(['case','failure'].includes(request.kind)){try{decoded=gunzipSync(encoded,{maxOutputLength:request.decoded_bytes});}catch{fail('PILOT_ARTIFACT_DECODE_CAP');}if(!gzipSync(decoded,{level:6}).equals(encoded))fail('PILOT_ARTIFACT_GZIP_POLICY');}
  if(decoded.length!==request.decoded_bytes||sha(decoded)!==message.decoded_sha256)fail('PILOT_ARTIFACT_DECODE_BINDING');let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(decoded);}catch{fail('PILOT_ARTIFACT_UTF8');}
  if(request.kind==='page'){if(decoded.length>LIMITS.page_capture_bytes||text.length>LIMITS.single_reader_response_characters)fail('PILOT_PAGE_BOUND');}
  else{let value;try{value=JSON.parse(text);}catch{fail('PILOT_ARTIFACT_JSON');}if(JSON.stringify(value,null,2)+'\n'!==text)fail('PILOT_ARTIFACT_SERIALIZATION');for(const key of ['actual_reading','manual_source_reading','source_quality_passed','quality_gate_pass','inference','model_inference','adopted','guard_activation'])if(Object.hasOwn(value,key)&&value[key]!==false)fail('PILOT_ARTIFACT_NO_QUALIFICATION');if(Object.hasOwn(value,'authority')&&value.authority!=='NONE')fail('PILOT_ARTIFACT_NO_QUALIFICATION');}
}

/** No configuration/file boolean enables actual execution. A future actual
 * revision needs independent code/config/source-phase review and ROOT approval.
 * Fixture capacity is explicitly virtual, never an actual study observation. */
export function superviseActualPhase(){admitActualExecution();}
export async function superviseFixturePhase(inputRef,{bootstrapProof}={}){
  const bootstrap=assertOwnedBootstrapProof(bootstrapProof),started=bootstrap.started,elapsed=()=>monotonicActiveMs(bootstrap.started_monotonic_ms);
  if(process.platform!=='linux'||process.env.NONVERBA_CONTAINER!=='1'||process.version!=='v22.23.3')fail('PILOT_MANAGED_PINNED_RUNTIME');
  const configRef=Object.freeze(JSON.parse(canonical(inputRef))); // Before first await.
  reference(configRef,{absolute:true,maxBytes:262144});const root=fixtureRoot(path.dirname(configRef.path));if(configRef.path!==root+'/configuration.json')fail('PILOT_SOURCE_FREE_CONFIG_PATH');
  const config=validateExecutionConfig(boundJSON(configRef,262144));same(config.root,root);
  same(configRef,bootstrap.config_ref);if(bootstrap.root!==root)fail('ACTUAL_BOOTSTRAP_ROOT_BINDING');const epoch=boundJSON({...config.source_epoch_ref,path:under(root,config.source_epoch_ref.path)});const{sha256:epochSHA,...epochBody}=epoch;if(epochSHA!==config.source_epoch_sha256||digest(epochBody)!==epochSHA)fail('ACTUAL_SOURCE_EPOCH_BINDING');
  for(const ref of[config.roster_ref,config.artifact_bindings_ref])boundJSON({...ref,path:under(root,ref.path)});
  if(config.prior_phase_checkpoint_ref)verifyPhaseCheckpoint(boundJSON({...config.prior_phase_checkpoint_ref,path:under(root,config.prior_phase_checkpoint_ref.path)}),{source_epoch_sha256:config.source_epoch_sha256,expected_prior:config.prior_cost});
  if(config.runtime.path!==process.execPath||config.runtime.version!==process.version||config.runtime.platform!==process.platform||config.runtime.architecture!==process.arch)fail('PILOT_PINNED_RUNTIME');boundFile({path:config.runtime.path,sha256:config.runtime.sha256,bytes:config.runtime.bytes});
  for(const ref of config.closure)boundFile(ref);
  const expectedClosure=[...epoch.experiment_files.map(r=>({...r,path:fileURLToPath(new URL('../'+r.path,import.meta.url))})),...epoch.upstream_reference_files.map(r=>({...r,path:path.resolve(path.dirname(epoch.configured_runtime_entries.control_upstream_collector),r.path)})),...epoch.parser_dependency_closure.files,...epoch.parser_dependency_closure.packages,...Object.values(CAPACITY_BINDINGS).filter(r=>r?.path).map(r=>({...r,path:under(STUDY,r.path)}))];
  const expectedPaths=new Set(expectedClosure.map(r=>r.path));if(expectedPaths.size!==expectedClosure.length||config.closure.length!==expectedClosure.length||config.closure.some(r=>!expectedPaths.has(r.path)))fail('ACTUAL_NAMED_CLOSURE_SCOPE');for(const expected of expectedClosure){const supplied=config.closure.find(r=>r.path===expected.path);if(!supplied||supplied.sha256!==expected.sha256||expected.bytes!==undefined&&supplied.bytes!==expected.bytes)fail('ACTUAL_NAMED_CLOSURE_BINDING');}
  for(const file of [SELF,CONTROL])if(!config.closure.some(r=>r.path===file))fail('PILOT_GUARDIAN_NOT_IN_CLOSURE');
  for(const ref of Object.values(config.bindings))boundJSON({...ref,path:under(root,ref.path)});
  if(config.metadata_projection_ref)boundJSON({...config.metadata_projection_ref,path:under(root,config.metadata_projection_ref.path)});
  if(config.selected_freeze_ref){const selection=boundJSON({...config.selected_freeze_ref,path:under(root,config.selected_freeze_ref.path)});if(selection.schema!=='typed-focal-prospective69-freeze-v2'||selection.nominal_denominator!==69||selection.planned_denominator!==69||selection.status!=='ORDERED69_METADATA_FROZEN_NOT_SOURCE_AUTHORIZATION')fail('PILOT_SEPARATE_FROZEN_SELECTION_REQUIRED');same(selection.ordered.map(row=>row.audit_id),config.expected_ids);const {sha256,...body}=selection;if(digest(body)!==sha256)fail('PILOT_FROZEN_SELECTION_BINDING');}
  const helperRef={...CAPACITY_BINDINGS.helper,path:under(STUDY,CAPACITY_BINDINGS.helper.path)},policyRef={...CAPACITY_BINDINGS.policy,path:under(STUDY,CAPACITY_BINDINGS.policy.path)};boundFile(helperRef);const originalPolicy=boundJSON(policyRef);const {validateRunCapacityPolicy,measureRunCapacity}=await import(pathToFileURL(helperRef.path));
  validateRunCapacityPolicy(originalPolicy);validateRunCapacityPolicy(config.capacity.fixture_policy);const fixturePolicy=config.capacity.fixture_policy;
  same({...originalPolicy,study_root:root,exceptions:fixturePolicy.exceptions},fixturePolicy);for(const e of fixturePolicy.exceptions)if(!e.literal_target.startsWith(root+'/'))fail('PILOT_SOURCE_FREE_CAPACITY_POLICY');
  const outDir=unlinked(root+'/guardian',{missing:true});if(fs.existsSync(outDir))fail('PILOT_GUARDIAN_RETRY_FORBIDDEN');fs.mkdirSync(outDir,{mode:0o700});
  const permit=await admitFictionalPhase(root,config.phase),resourceJournal=createFictionalResourceJournal(root,{permit,phase:config.phase,source_epoch_sha256:config.source_epoch_sha256,prior_cost:config.prior_cost,limits:config.resource_journal_limits});
  const book=createExecutionBook(config),tracked=new Map(),signals=[],terminalSamples=[],requests=new Map(),committedRequests=new Map(),processFailures=new Map(),finalOutputs=[];const UNKNOWN=Symbol('UNKNOWN_PROCESS_OBSERVATION');let wakeStop;const stopPromise=new Promise(resolve=>{wakeStop=resolve;});let child=null,childClosed=false,closePromise=null,workerRecord=null,stdoutFD=null,stderrFD=null,timer=null,done=null,stopCode=null,state='NOT_SPAWNED',registry=null,messageChain=Promise.resolve(),capacityAt=0,lastCapacity=null,peakRSS=0,peakCapture=0,peakPilot=0,settleTimer=null,receipt=null,observedCaptureBytes=0,capturedBytes=0,discardedCaptureBytes=0,finalOutputsVerified=false;
  const safeError=e=>({code:/^(?:PILOT_|RUN_CAPACITY_|ACTUAL_)[A-Z0-9_]{1,100}$/u.test(e?.code??'')?e.code:'PILOT_FIXED_FAILURE',message_sha256:sha(String(e?.message??''))});
  function observe(pid,stage){try{return readProcessInfo(pid);}catch(e){const detail={stage,pid,code:'PILOT_PROCESS_OBSERVATION_UNKNOWN',reason:e.observation_reason??'INVALID_PROCESS_DATA',syscall_code:e.syscall_code??null},key=canonical(detail),previous=processFailures.get(key);processFailures.set(key,{...detail,count:(previous?.count??0)+1,first_elapsed_ms:previous?.first_elapsed_ms??elapsed(),last_elapsed_ms:elapsed()});error??=safeError(e);stopCode??='PILOT_PROCESS_OBSERVATION_UNKNOWN';wakeStop(stopCode);return UNKNOWN;}}
  function requiredInfo(pid,stage){const value=observe(pid,stage);if(value===UNKNOWN)fail('PILOT_PROCESS_OBSERVATION_UNKNOWN');return value;}
  function ownership(record,stage){const value=observe(record.pid,stage);return value===UNKNOWN?null:ownedIdentityMatches(record,value);}
  function possiblyLive(stage){return [...tracked.values()].some(record=>ownership(record,stage)!==false);}
  function captureSize(){return observedCaptureBytes+bootstrap.capture.reduce((n,r)=>{const s=fs.fstatSync(r.fd);if(!s.isFile()||s.dev!==r.dev||s.ino!==r.ino)fail('ACTUAL_CAPTURE_FD_IDENTITY');return n+s.size;},0);}
  function capacity(){const value=measureRunCapacity(root,fixturePolicy,{io:fs});lastCapacity=value;capacityAt=performance.now();return value.bytes;}
  function discover(){
    if(!workerRecord)return process.memoryUsage().rss;const pending=[{pid:workerRecord.pid,parent:null}],seen=new Set();let rss=process.memoryUsage().rss;
    while(pending.length){const {pid,parent}=pending.pop();if(seen.has(pid))continue;seen.add(pid);const current=requiredInfo(pid,'DISCOVERY');if(!current)continue;const old=tracked.get(pid);if(old&&!ownedIdentityMatches(old,current))continue;if(!old){if(!parent||current.ppid!==parent.pid||ownership(parent,'DESCENDANT_LINEAGE')!==true)continue;tracked.set(pid,current);stopCode??='PILOT_UNREGISTERED_DESCENDANT';}if(current.group!==workerRecord.group)stopCode??='PILOT_OWNED_GROUP_CHANGED';pending.push(...current.children.map(pid=>({pid,parent:current})));}
    // Include previously observed, now reparented descendants after entry exit.
    for(const record of tracked.values()){const current=requiredInfo(record.pid,'TRACKED_RSS');if(ownedIdentityMatches(record,current))rss+=current.rss;}
    peakRSS=Math.max(peakRSS,rss);return rss;
  }
  function sample({admission=false,extra=0,forceCapacity=false,kind='PERIODIC',case_id=null}={}){
    const rss=discover(),pilot=forceCapacity||performance.now()-capacityAt>=CAPACITY_MS||lastCapacity===null?capacity():lastCapacity.bytes,capture=captureSize();peakPilot=Math.max(peakPilot,pilot);peakCapture=Math.max(peakCapture,capture);
    const row={study_bytes:RESERVATION.run_at_reservation+pilot+extra,pilot_bytes:config.prior_cost.admitted_output_bytes+pilot+extra,capture_bytes:capture,aggregate_rss_bytes:rss,elapsed_ms:config.prior_cost.active_elapsed_ms+elapsed(),total_calls:book.totalCalls};try{assessExecutionSample(row,{admission});resourceJournal.append(kind,row,{admission,case_id});}catch(error){error.sample=row;throw error;}return row;
  }
  function terminalSample(stage){try{const row=sample({forceCapacity:true,extra:RECEIPT_RESERVE,kind:stage});terminalSamples.push({stage,...row,within_limits:true});}catch(e){error??=safeError(e);stopCode??=error.code;terminalSamples.push({stage,...(e.sample??{}),within_limits:false,error_code:safeError(e).code});}}
  function signalOwned(signal){for(const record of tracked.values())if(ownership(record,'SIGNAL_RECHECK')===true){try{process.kill(record.pid,signal);signals.push({pid:record.pid,start_ticks:record.start_ticks,signal});}catch(e){if(e.code!=='ESRCH')stopCode??='PILOT_OWNED_SIGNAL_FAILED';}}}
  function stop(code){stopCode??=code;wakeStop(stopCode);signalOwned('SIGTERM');if(!settleTimer)settleTimer=setTimeout(()=>signalOwned('SIGKILL'),TERM_GRACE_MS).unref();}
  function captureChunk(fd,chunk){
    observedCaptureBytes+=chunk.length;const keep=Math.min(chunk.length,Math.max(0,LIMITS.private_capture_bytes-capturedBytes));
    if(keep){fs.writeSync(fd,chunk,0,keep);capturedBytes+=keep;}discardedCaptureBytes+=chunk.length-keep;
    if(discardedCaptureBytes||captureSize()>LIMITS.private_capture_bytes)stop('PILOT_PRIVATE_CAPTURE_CAP');
  }
  function send(message){if(child?.connected)child.send(message,error=>{if(error&&!done)stop('PILOT_IPC_SEND_FAILED');});else fail('PILOT_IPC_DISCONNECTED');}
  async function onMessage(message){
    if(stopCode)fail(stopCode);
    if(Buffer.byteLength(JSON.stringify(message)??'')>IPC_MAX_BYTES)fail('PILOT_IPC_MESSAGE_BOUND');if(!message||Object.getPrototypeOf(message)!==Object.prototype)fail('PILOT_IPC_FIELDS');
    if(state==='SPAWNED'){exact(message,['type','schema','pid','start_ticks']);if(message.type!=='HELLO'||message.schema!=='pilot-owned-worker-hello-v1'||message.pid!==child.pid||message.start_ticks!==workerRecord?.start_ticks||ownership(workerRecord,'HELLO')!==true)fail('PILOT_WORKER_OWNERSHIP');registry={schema:'pilot-owned-worker-registry-v1',pid:workerRecord.pid,start_ticks:workerRecord.start_ticks,group:workerRecord.group,config_ref:configRef,source_epoch_sha256:config.source_epoch_sha256};state='REGISTERED';sample({admission:true,forceCapacity:true,extra:RECEIPT_RESERVE,kind:'WORKER_REGISTERED'});send({type:'REGISTERED',schema:'pilot-owned-worker-registered-v1',pid:workerRecord.pid,start_ticks:workerRecord.start_ticks,registry_sha256:digest(registry)});return;}
    if(state==='REGISTERED'){exact(message,['type','registry_sha256']);if(message.type!=='READY'||message.registry_sha256!==digest(registry)||ownership(workerRecord,'READY')!==true)fail('PILOT_WORKER_REGISTRY_ACK');sample({admission:true,forceCapacity:true,extra:RECEIPT_RESERVE,kind:'BEFORE_PROJECT_IMPORT'});state='INITIALIZED';send({type:'INIT',schema:'pilot-owned-worker-init-v1',phase:config.phase,config_ref:configRef,registry_sha256:digest(registry),source_epoch_sha256:config.source_epoch_sha256,limits:LIMITS,tokenizer_call_allowance:LIMITS.global_tokenizer_calls});return;}
    if(state!=='INITIALIZED')fail('PILOT_IPC_STATE');
    if(message.type==='PROGRESS'){book.progress(message);sample({kind:'TOKEN_PROGRESS'});return;}
    if(message.type==='WRITE_REQUEST'){if(book.pending)fail('PILOT_ONE_WRITE_AT_A_TIME');const projected=[...book.committed,{path:message.path,sha256:'0'.repeat(64),bytes:message.encoded_bytes,decoded_sha256:'0'.repeat(64),decoded_bytes:message.decoded_bytes}],readbacks=projected.map(ref=>({ref,status:'HELD_FINAL_READBACK_FAILED',error:{code:'PILOT_PROCESS_OBSERVATION_UNKNOWN',message_sha256:'0'.repeat(64)},observed_file:{status:'PRESENT_REGULAR_FILE',bytes:LIMITS.per_case_compressed_artifact_bytes}}));if(Buffer.byteLength(JSON.stringify({expected:config.expected_ids,remaining:config.expected_ids,outputs:projected,readbacks}))+32768>RECEIPT_RESERVE)fail('PILOT_RECEIPT_BOUND');const request=book.request(message);sample({admission:true,forceCapacity:true,extra:message.encoded_bytes+RECEIPT_RESERVE,kind:'BEFORE_WRITE',case_id:message.case_id});if(fs.existsSync(under(root,message.path)))fail('PILOT_WRITE_RETRY_FORBIDDEN');requests.set(message.request_id,request);send({type:'WRITE_GRANTED',request_id:message.request_id});return;}
    if(message.type==='WRITE_COMMITTED'){const request=requests.get(message.request_id);if(!request)fail('PILOT_WRITE_SEQUENCE');artifactBytes(root,request,message);book.commit(message);committedRequests.set(message.ref.path,{request:structuredClone(request),message:structuredClone(message)});requests.delete(message.request_id);sample({admission:true,forceCapacity:true,extra:RECEIPT_RESERVE,kind:'AFTER_WRITE',case_id:request.case_id});send({type:'WRITE_VERIFIED',request_id:message.request_id});return;}
    if(message.type==='DONE'){done=book.done(message);state='DONE';sample({forceCapacity:true,extra:RECEIPT_RESERVE,kind:'WORKER_DONE'});return;}
    fail('PILOT_IPC_MESSAGE_TYPE');
  }
  let closeResult={exit_code:null,signal:null},error=null;
  try{
    sample({admission:true,forceCapacity:true,extra:RECEIPT_RESERVE,kind:'FIRST_BEFORE_SPAWN'});
    stdoutFD=fs.openSync(outDir+'/worker.stdout.private.log','wx',0o600);stderrFD=fs.openSync(outDir+'/worker.stderr.private.log','wx',0o600);
    sample({admission:true,forceCapacity:true,extra:RECEIPT_RESERVE,kind:'AFTER_CAPTURE_BEFORE_SPAWN'});
    child=fork(config.worker.path,[configRef.path,configRef.sha256,String(configRef.bytes)],{execPath:config.runtime.path,execArgv:config.runtime.flags,stdio:['ignore','pipe','pipe','ipc'],detached:true,env:{NONVERBA_CONTAINER:'1',NONVERBA_PILOT_SOURCE_FREE:'1',PATH:process.env.PATH??'/usr/bin:/bin',LANG:'C.UTF-8',TZ:'UTC'}});
    child.stdout.on('data',chunk=>{try{captureChunk(stdoutFD,chunk);}catch(e){error??=safeError(e);stop(error.code);}});child.stderr.on('data',chunk=>{try{captureChunk(stderrFD,chunk);}catch(e){error??=safeError(e);stop(error.code);}});
    closePromise=new Promise(resolve=>{child.once('error',e=>{error??=safeError(e);stop(error.code);});child.once('close',(exit_code,signal)=>{childClosed=true;resolve({exit_code,signal});});});
    workerRecord=requiredInfo(child.pid,'BIRTH');if(workerRecord)tracked.set(workerRecord.pid,workerRecord);if(!workerRecord||workerRecord.group!==child.pid)fail('PILOT_WORKER_BIRTH_UNVERIFIED');state='SPAWNED';
    child.on('message',message=>{messageChain=messageChain.then(()=>onMessage(message)).catch(e=>{error??=safeError(e);stop(error.code);});});
    timer=setInterval(()=>{try{sample({forceCapacity:false});if(!['INITIALIZED','DONE'].includes(state)&&elapsed()>HANDSHAKE_MS)fail('PILOT_REGISTRY_HANDSHAKE_TIMEOUT');if(stopCode)stop(stopCode);}catch(e){error??=safeError(e);stop(error.code);}},SAMPLE_MS);
    const waited=await waitForOwnedClose(closePromise,stopPromise,{timeout_ms:Math.max(0,LIMITS.elapsed_ms-config.prior_cost.active_elapsed_ms-(elapsed()))});if(waited.kind!=='CLOSED'){stop(waited.code);fail(waited.code);}closeResult=waited.value;
    await messageChain;terminalSample('CHILD_CLOSE');
    if(!done)stop('PILOT_MISSING_COMPLETE_TERMINAL');if(closeResult.exit_code!==0||closeResult.signal!==null)stopCode??='PILOT_WORKER_EXIT';
  }catch(e){error??=safeError(e);stop(error.code);}
  finally{
    if(timer)clearInterval(timer);
    if(child&&!workerRecord&&child.exitCode===null){const candidate=observe(child.pid,'FAILED_BIRTH_RECHECK');if(candidate!==UNKNOWN&&candidate?.ppid===process.pid){workerRecord=candidate;tracked.set(candidate.pid,candidate);}}
    if(tracked.size){if(possiblyLive('PRE_TERM_JOIN'))signalOwned('SIGTERM');const until=performance.now()+TERM_GRACE_MS;while(possiblyLive('TERM_JOIN')&&performance.now()<until)await new Promise(resolve=>setTimeout(resolve,10));if(possiblyLive('PRE_KILL_JOIN'))signalOwned('SIGKILL');const joined=performance.now()+KILL_JOIN_MS;while(possiblyLive('KILL_JOIN')&&performance.now()<joined)await new Promise(resolve=>setTimeout(resolve,10));}
    if(closePromise&&!childClosed){const joined=await waitForOwnedClose(closePromise,new Promise(()=>{}),{timeout_ms:KILL_JOIN_MS});if(joined.kind==='CLOSED')closeResult=joined.value;if(!childClosed){stopCode??='PILOT_OWNED_IO_JOIN_INCOMPLETE';child.stdout?.destroy();child.stderr?.destroy();if(child.connected)child.disconnect();child.unref();}}
    if(settleTimer)clearTimeout(settleTimer);
    if(!terminalSamples.some(s=>s.stage==='CHILD_CLOSE'))terminalSample('CHILD_CLOSE_OR_FAILED_START_JOIN');
    terminalSample('BEFORE_CAPTURE_CLOSE');
    const captureBytes=captureSize();for(const fd of [stdoutFD,stderrFD])if(fd!==null)fs.closeSync(fd);stdoutFD=stderrFD=null;
    const captureRefs=[];for(const name of ['guardian/worker.stdout.private.log','guardian/worker.stderr.private.log'])if(fs.existsSync(root+'/'+name))captureRefs.push(outputReference(root,name));
    const remainingLive=[];for(const record of tracked.values()){const state=ownership(record,'FINAL_ABSENCE');if(state!==false)remainingLive.push({pid:record.pid,start_ticks:record.start_ticks,state:state===null?'UNKNOWN':'PRESENT'});}let groupAbsent=child===null;
    if(workerRecord){try{process.kill(-workerRecord.group,0);}catch(e){if(e.code==='ESRCH')groupAbsent=true;else{error??=safeError(e);stopCode??='PILOT_OWNED_GROUP_OBSERVATION_UNKNOWN';const detail={stage:'FINAL_GROUP_ABSENCE',pid:workerRecord.pid,code:'PILOT_PROCESS_OBSERVATION_UNKNOWN',reason:'GROUP_QUERY_FAILED',syscall_code:/^[A-Z0-9_]{1,32}$/u.test(e.code??'')?e.code:null};processFailures.set(canonical(detail),{...detail,count:1,first_elapsed_ms:elapsed(),last_elapsed_ms:elapsed()});}}}
    // Re-open every output only after all known writers and their I/O joined.
    // Original refs stay immutable even when a later readback fails.
    if(!remainingLive.length&&groupAbsent&&(child===null||childClosed)){
      finalOutputsVerified=true;for(const ref of book.committed){const bound=committedRequests.get(ref.path);try{if(!bound)fail('PILOT_TERMINAL_OUTPUT_BINDING');artifactBytes(root,bound.request,bound.message);finalOutputs.push({ref,status:'VERIFIED_AFTER_OWNED_JOIN'});}catch(e){finalOutputsVerified=false;error??=safeError(e);stopCode??='PILOT_TERMINAL_OUTPUT_CHANGED';let observed_file;try{const stat=fs.lstatSync(unlinked(under(root,ref.path)));observed_file={status:stat.isFile()?'PRESENT_REGULAR_FILE':'UNSAFE_NONREGULAR_FILE',bytes:stat.size};}catch(observed){observed_file={status:['ENOENT','ESRCH'].includes(observed.code)?'MISSING':'UNAVAILABLE_OR_UNSAFE',code:/^[A-Z0-9_]{1,100}$/u.test(observed.code??'')?observed.code:'PILOT_FILE_OBSERVATION_UNKNOWN'};}finalOutputs.push({ref,status:'HELD_FINAL_READBACK_FAILED',error:safeError(e),observed_file});}}
    }
    let finalSample=null;
    try{finalSample=sample({forceCapacity:true,extra:RECEIPT_RESERVE,kind:'FINAL_OUTPUT_READBACK'});terminalSamples.push({stage:'AFTER_CAPTURE_HASHING_AND_READBACK',...finalSample,within_limits:true});}catch(e){error??=safeError(e);stopCode??=error.code;terminalSamples.push({stage:'AFTER_CAPTURE_HASHING_AND_READBACK',...(finalSample??{}),within_limits:false,error_code:error.code});}
    let complete=done?.status==='COMPLETE'&&!stopCode&&!error&&!processFailures.size&&!remainingLive.length&&finalOutputsVerified&&childClosed&&groupAbsent&&closeResult.exit_code===0&&closeResult.signal===null&&terminalSamples.length===3&&terminalSamples.every(s=>s.within_limits);
    let journalRef=null;try{journalRef=resourceJournal.finish({success:complete});}catch(e){complete=false;error??=safeError(e);stopCode??=error.code;}
    const result={schema:'literal-emphasis-owned-guardian-fixture-result-v1',status:complete?'SOURCE_FREE_FIXTURE_COMPLETE_NOT_ACTUAL_AUTHORIZATION':'HELD_SOURCE_FREE_FIXTURE_OR_RESOURCE_FAILURE',authority:'NONE',config_ref:configRef,source_epoch_sha256:config.source_epoch_sha256,phase:config.phase,expected_ids:config.expected_ids,original_denominator:config.expected_ids.length,completed_ids:done?.completed_ids??[],failed_ids:done?.failed_ids??[],remaining_ids:done?.remaining_ids??config.expected_ids,stop_code:stopCode,error,worker_exit:closeResult,registry:registry?{...registry,sha256:digest(registry)}:null,owned_identity_records:[...tracked.values()].map(({pid,start_ticks,group})=>({pid,start_ticks,group})),owned_signals:signals,owned_remaining:remainingLive,owned_absence_verified:remainingLive.length===0,capture_established_before_worker_spawn:true,capture_established_before_child_project_imports:true,capture_route:'BOUNDED_PRIVATE_PIPE_RELAY_FILES_OPENED_BEFORE_FORK',private_capture_contents_forwarded:false,private_capture_complete:discardedCaptureBytes===0,private_capture_observed_bytes:observedCaptureBytes,private_capture_stored_bytes:capturedBytes,private_capture_discarded_after_cap_bytes:discardedCaptureBytes,private_capture_refs:captureRefs,tokenizer_calls_reported:book.totalCalls,admitted_encoded_bytes:book.admittedBytes,verified_output_refs:book.committed,pending_writes:book.pending,terminal_samples:terminalSamples,peak_sampled_RSS_bytes:peakRSS,peak_sampled_capture_bytes:peakCapture,peak_sampled_pilot_bytes:peakPilot,capacity_scope:'SYNTHETIC_VIRTUAL_STUDY_ONLY_NOT_ACTUAL_RUN_MEASUREMENT',virtual_study_base_bytes:RESERVATION.run_at_reservation,shared_reservation:RESERVATION,limits:LIMITS,actual_execution_enabled:false,actual_reading:false,source_quality_passed:false,model_inference:false,guard_activation:false,adopted:false};
    result.owned_group_absence_verified=groupAbsent;result.owned_IO_joined=child===null||childClosed;result.process_observation_failures=[...processFailures.values()];result.all_process_observations_known=processFailures.size===0;result.owned_absence_verified=remainingLive.length===0&&groupAbsent&&(child===null||childClosed)&&processFailures.size===0;result.final_output_readback=finalOutputs;result.all_committed_outputs_reverified_after_owned_join=finalOutputsVerified;result.private_capture_complete=discardedCaptureBytes===0&&(child===null||childClosed);
    result.resource_journal=journalRef;result.bootstrap_first_ref={path:'bootstrap/first.json',...(()=>{const b=fs.readFileSync(root+'/bootstrap/first.json');return{sha256:sha(b),bytes:b.length};})()};result.bootstrap_private_capture_refs=bootstrap.capture.map(r=>outputReference(root,path.relative(root,r.path)));result.prior_cost=config.prior_cost;result.cumulative_terminal_upper_sample=finalSample;result.terminal_receipt_bytes_reserved=RECEIPT_RESERVE;result.phase_checkpoint_not_automatically_issued=true;result.future_actual_checkpoint_requires_external_final_bootstrap_exit_and_capture_readback=true;
    result.unverified_candidate_pids=child&&!workerRecord?[child.pid]:[];result.main_wait_bounded=true;result.termination_guaranteed=false;
    receipt=exclusiveJSON(root,'guardian/result.json',result);return {result,receipt};
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===SELF){process.stderr.write('ACTUAL_GUARDIAN_DIRECT_ENTRY_CLOSED_USE_REVIEWED_BOOTSTRAP\n');process.exitCode=2;}
