// SPDX-License-Identifier: AGPL-3.0-only
// Concrete fixed-operation preparation. No real path is reachable in this revision.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {findPackageJSON} from 'node:module';
import {admitFictionalPhase,assertFictionalPermit} from '../admission.mjs';
import {readStaticManifest} from '../runtime/io.mjs';
import {validateManifest,validateDescriptor,validateModelManifest,validateOpenedCounters,immutable,equal,exact,integer,json,sha,LIMITS,RESERVATION,fail} from '../runtime/validation.mjs';
import {ACCEPTED_RUNTIME,FIXED_NODE,FUTURE_REQUIREMENTS} from './bindings.mjs';

export const ACTUAL_CONNECTION_ENABLED=false;
export function openActualTokenizerConnection(){fail('RUNTIME_CONNECTION_ACTUAL_CLOSED');}
export function issueActualRuntimeCapability(){fail('RUNTIME_CONNECTION_ACTUAL_CLOSED');}
export const preparationRequirements=()=>immutable({actual_enabled:false,requirements:FUTURE_REQUIREMENTS,real_operation_implemented:true,real_operation_executed:false,guardian_capability_issuer_implemented:false,guardian_receiver_implemented:false,package_route_observed:false,authority:'NONE'});

// No exported mint, setter, numeric proof or callback can populate this map.
// The future guardian-owned mint/IPC receiver requires a separate source review.
const actualCapabilities=new WeakMap();
function actualRecord(capability){const record=actualCapabilities.get(capability);if(!record||record.mode!=='ACTUAL'||record.pid!==process.pid)fail('RUNTIME_OWNED_CAPABILITY_REQUIRED');return record;}

function activeCheck(record){
  integer(record.prior_active_ms,0,LIMITS.elapsed_ms);integer(record.prior_calls,0,LIMITS.global_tokenizer_calls);integer(record.local_calls,0,LIMITS.global_tokenizer_calls);integer(record.prior_admitted_bytes,0,LIMITS.pilot_new_run_bytes);
  if(record.mode==='ACTUAL'&&(record.pid!==process.pid||process.hrtime.bigint()>record.lease_deadline_ns))fail('RUNTIME_GUARDIAN_LEASE_EXPIRED');
  const elapsed=record.prior_active_ms+Number((process.hrtime.bigint()-record.origin_ns+999999n)/1000000n);
  if(elapsed>LIMITS.elapsed_ms||process.memoryUsage().rss>LIMITS.aggregate_supervisor_and_worker_rss_bytes)fail('RUNTIME_INHERITED_RESOURCE_LIMIT');
  // This process RSS check supplements, never replaces, the external aggregate guard.
  if(record.prior_calls+record.local_calls>LIMITS.global_tokenizer_calls)fail('RUNTIME_GLOBAL_CALL_LIMIT');
}
async function boundary(record,stage){
  activeCheck(record);if(record.mode==='FICTIONAL'){record.events.push({kind:'BOUNDARY',stage});return;}
  if(!process.send||!process.connected)fail('RUNTIME_OWNED_GUARDIAN_DISCONNECTED');
  const sequence=++record.boundary_sequence,nonce=record.connection_nonce;
  const ack=await new Promise((resolve,reject)=>{const remaining=LIMITS.elapsed_ms-record.prior_active_ms-Number((process.hrtime.bigint()-record.origin_ns)/1000000n),timer=setTimeout(()=>{cleanup();reject(Object.assign(Error('Runtime boundary timed out'),{code:'RUNTIME_GUARDIAN_BOUNDARY_TIMEOUT'}));},Math.max(0,Math.min(1000,remaining))),cleanup=()=>{clearTimeout(timer);process.off('message',receive);process.off('disconnect',gone);},gone=()=>{cleanup();reject(Object.assign(Error('Owned guardian disconnected'),{code:'RUNTIME_OWNED_GUARDIAN_DISCONNECTED'}));},receive=m=>{if(m?.type!=='RUNTIME_BOUNDARY_ACK'||m.connection_nonce!==nonce||m.sequence!==sequence)return;cleanup();resolve(m);};process.on('message',receive);process.once('disconnect',gone);process.send({type:'RUNTIME_BOUNDARY_REQUEST',connection_nonce:nonce,sequence,stage,source_epoch_sha256:record.source_epoch_sha256,configuration_sha256:record.configuration_sha256,local_calls:record.local_calls},e=>{if(e){cleanup();reject(e);}});});
  if(ack.stage!==stage||ack.source_epoch_sha256!==record.source_epoch_sha256||ack.configuration_sha256!==record.configuration_sha256||ack.status!=='OWNED_RUNTIME_BOUNDARY_WITHIN_ORIGINAL_LIMITS'||ack.all_observations_known!==true||ack.original_limits_sha256!==record.original_limits_sha256||ack.inherited_prior_cost_sha256!==record.inherited_prior_cost_sha256||typeof ack.lease_deadline_ns!=='string'||!/^\d+$/.test(ack.lease_deadline_ns))fail('RUNTIME_GUARDIAN_BOUNDARY_BINDING');
  const deadline=BigInt(ack.lease_deadline_ns);if(deadline<=process.hrtime.bigint()||deadline>record.phase_deadline_ns)fail('RUNTIME_GUARDIAN_LEASE_EXPIRED');record.lease_deadline_ns=deadline;activeCheck(record);
}

// Anchored directory handles; exact regular bytes and streaming hashes only.
// Neither this function nor the real backend is exported.
async function realFile(record,expected,{collect=false}={}){
  if(typeof expected.path!=='string'||!path.isAbsolute(expected.path)||path.resolve(expected.path)!==expected.path||/[\0\r\n]/.test(expected.path)||!Number.isSafeInteger(expected.bytes)||expected.bytes<1||expected.bytes>268435456||!/^[a-f0-9]{64}$/.test(expected.sha256))fail('RUNTIME_FIXED_FILE_REF');
  if(collect&&expected.bytes>2097152)fail('RUNTIME_COLLECTION_CAP');await boundary(record,'BEFORE_FILE');const held=[],parts=expected.path.split('/').filter(Boolean),name=parts.pop();let fd;
  try{let parent=fs.openSync('/',fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);held.push(parent);for(const part of parts){parent=fs.openSync('/proc/self/fd/'+parent+'/'+part,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);held.push(parent);}fd=fs.openSync('/proc/self/fd/'+parent+'/'+name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const before=fs.fstatSync(fd);if(!before.isFile()||before.size!==expected.bytes)fail('RUNTIME_FIXED_FILE_SIZE');const h=createHash('sha256'),chunk=Buffer.alloc(65536),pieces=[];let at=0;while(at<before.size){const n=fs.readSync(fd,chunk,0,Math.min(chunk.length,before.size-at),at);if(!n)fail('RUNTIME_FIXED_FILE_TRUNCATED');h.update(chunk.subarray(0,n));if(collect)pieces.push(Buffer.from(chunk.subarray(0,n)));at+=n;await boundary(record,'FILE_CHUNK');}const after=fs.fstatSync(fd);if(!after.isFile()||after.dev!==before.dev||after.ino!==before.ino||after.size!==before.size||fs.readSync(fd,chunk,0,1,at)||h.digest('hex')!==expected.sha256)fail('RUNTIME_FIXED_FILE_INTEGRITY');return collect?Buffer.concat(pieces):null;}finally{if(fd!==undefined)fs.closeSync(fd);for(const p of held.reverse())fs.closeSync(p);}
}
function fixedEnvironment(){
  if(process.execPath!==FIXED_NODE.path||process.version!==FIXED_NODE.version||process.platform!==FIXED_NODE.platform||process.arch!==FIXED_NODE.architecture||process.env.NONVERBA_CONTAINER!=='1'||process.env.NODE_OPTIONS||process.env.NODE_PATH)fail('RUNTIME_FIXED_ENVIRONMENT');equal(process.execArgv,FIXED_NODE.flags);
}
function realBackend(record,manifest){
  return Object.freeze({
    async read(role,expected,collect=false){record.events.push({kind:'VERIFY',role});return realFile(record,expected,{collect});},
    async locate(pkg){
      // The approved LOCATION step is not a general format or transitive resolver.
      await realFile(record,pkg.importer_ref);const descriptor=json(await realFile(record,pkg.descriptor_ref,{collect:true}));validateDescriptor(pkg,descriptor);await realFile(record,pkg.import_entry_ref);if(pkg.require_entry_ref)await realFile(record,pkg.require_entry_ref);await boundary(record,'BEFORE_FIXED_PACKAGE_LOCATION');
      const route=record.package_routes.find(r=>r.specifier===pkg.name&&r.importer_ref.path===pkg.importer_ref.path);if(!route)fail('RUNTIME_EXPLICIT_PACKAGE_ROUTE_REQUIRED');equal(route.importer_ref,pkg.importer_ref);equal(route.descriptor_ref,pkg.descriptor_ref);equal(route.import_entry_ref,pkg.import_entry_ref);if(route.expected_location!==pkg.descriptor_ref.path||route.aliases?.length)fail('RUNTIME_PACKAGE_ROUTE_UNVERIFIED');
      const found=findPackageJSON(pkg.name,pathToFileURL(pkg.importer_ref.path));if(found!==route.expected_location)fail('RUNTIME_FIXED_PACKAGE_LOCATION');
      await realFile(record,pkg.descriptor_ref);await boundary(record,'AFTER_FIXED_PACKAGE_LOCATION');return descriptor;
    },
    async open(){await realFile(record,manifest.service.pinned_entry_ref);await realFile(record,manifest.service.embedding_entry_ref);for(const pkg of manifest.packages)await this.locate(pkg);await boundary(record,'BEFORE_FIXED_SERVICE_IMPORT');const service=await import(pathToFileURL(manifest.service.pinned_entry_ref.path));if(typeof service.openPinnedCounters!=='function')fail('RUNTIME_FIXED_CONSTRUCTOR_EXPORT');await boundary(record,'BEFORE_FIXED_CONSTRUCTOR');return service.openPinnedCounters();}
  });
}
function requireReturnedPair(manifest,value){const metadata=validateOpenedCounters(manifest,value);if(value.counters.some(c=>typeof c.tokenCount!=='function'))fail('RUNTIME_BOTH_CALLABLE_COUNTERS_REQUIRED');return immutable(metadata);}
function meter(record,counters,manifest){
  return Object.freeze({
    count(streamID,text){activeCheck(record);const row=record.streams.get(streamID);if(!record.ready||!row||typeof text!=='string'||text.length>LIMITS.probe_encoded_characters)fail('RUNTIME_BOUND_STREAM_REQUIRED');if(record.prior_calls+record.local_calls>=LIMITS.global_tokenizer_calls)fail('RUNTIME_GLOBAL_CALL_LIMIT');if(row.calls>=LIMITS.per_stream_tokenizer_calls)fail('RUNTIME_STREAM_CALL_LIMIT');record.local_calls++;row.calls++;const count=counters[row.model].tokenCount(text);integer(count,0,Number.MAX_SAFE_INTEGER);row.last_input_sha256=sha(Buffer.from(text));row.last_tokens=count;activeCheck(record);if(record.mode==='ACTUAL'&&record.local_calls%32===0)process.send({type:'RUNTIME_PROGRESS',connection_nonce:record.connection_nonce,source_epoch_sha256:record.source_epoch_sha256,local_calls:record.local_calls,stream_id:streamID,stream_calls:row.calls});return count;},
    window(streamID,{tokens,input_sha256}){activeCheck(record);const row=record.streams.get(streamID);if(!record.ready||!row||!/^[a-f0-9]{64}$/.test(input_sha256??''))fail('RUNTIME_BOUND_STREAM_REQUIRED');integer(tokens,0,256);if(row.windows>=LIMITS.per_stream_windows)fail('RUNTIME_STREAM_WINDOW_LIMIT');if(row.last_input_sha256!==input_sha256||row.last_tokens!==tokens)fail('RUNTIME_FINAL_WINDOW_COUNT_BINDING');row.windows++;},
    metadata:immutable(manifest.models.map(m=>({policy_sha256:m.policy_sha256,file_set_sha256:m.file_set_sha256})))
  });
}
async function operation(record,manifest,backend){
  validateManifest(manifest);for(const [i,r]of manifest.named_code_refs.entries())await backend.read('named-code:'+i,r);
  for(const p of manifest.packages){const descriptor=await backend.locate(p);validateDescriptor(p,descriptor);}
  const recipe=json(await backend.read('recipe',manifest.service.comparison_recipe_ref,true));if(recipe.secondModel?.repository!==manifest.models[1].repository||recipe.secondModel?.revision!==manifest.models[1].revision||recipe.secondModel.device!=='cpu'||recipe.secondModel.dtype!=='fp32'||recipe.secondModel.pooling!=='mean'||recipe.secondModel.max_tokens!==256)fail('RUNTIME_FIXED_RECIPE');
  for(let m=0;m<2;m++){const model=manifest.models[m];validateModelManifest(model,json(await backend.read('model-manifest:'+m,model.manifest_ref,true)));}
  for(let m=0;m<2;m++)for(let f=0;f<6;f++)await backend.read('model-file:'+m+':'+f,manifest.models[m].artifact_refs[f]);
  record.events.push({kind:'BOTH_MANIFESTS_AND_ALL12_BEFORE_FIRST_CONSTRUCTOR'});await boundary(record,'ALL_ARTIFACTS_VERIFIED');const opened=await backend.open();const metadata=requireReturnedPair(manifest,opened);await boundary(record,'BOTH_CALLABLE_IDENTITIES_VERIFIED');record.ready=true;return{metadata,meter:meter(record,opened.counters,manifest)};
}
async function preparedRealOperation(capability){
  const record=actualRecord(capability);fixedEnvironment();await boundary(record,'RUNTIME_PREIMPORT_START');
  for(const r of Object.values(ACCEPTED_RUNTIME))await realFile(record,{...r,path:fileURLToPath(new URL(r.path,import.meta.url))});await realFile(record,FIXED_NODE);
  const manifest=validateManifest(readStaticManifest());return operation(record,manifest,realBackend(record,manifest));
}
// Deliberately no call/export of preparedRealOperation in the CLOSED revision.

const SCENARIOS=new Set(['VALID','LAST_ARTIFACT_TAMPER','MISSING_SECOND_MANIFEST','WRONG_LOCATION','REDUCED_COMPARISON','MISSING_SECOND_CALLABLE','WRONG_POLICY','WRONG_REPOSITORY','GLOBAL_LIMIT','STREAM_LIMIT','WINDOW_LIMIT','ENCODED_PROBE_LIMIT']);
export async function runFictionalConnectionControl(input){
  exact(input,['scenario']);if(!SCENARIOS.has(input.scenario))fail('RUNTIME_FICTIONAL_SCENARIO');const scenario=input.scenario,root=fs.mkdtempSync('/tmp/literal-emphasis-actual-connection-'),permit=await admitFictionalPhase(root,'PREPARE_SELECTED69');assertFictionalPermit(permit,root,{phase:'PREPARE_SELECTED69'});const manifest=readStaticManifest(),rows=new Map();let number=0,constructorCalls=0,fakeCounterCalls=0;
  const add=(role,value)=>{const b=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2)+'\n'),p=root+'/'+number+++'.json';const fd=fs.openSync(p,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,b);}finally{fs.closeSync(fd);}rows.set(role,{path:p,sha256:sha(b),bytes:b.length});};
  for(let i=0;i<manifest.named_code_refs.length;i++)add('named-code:'+i,Buffer.from('SYNTHETIC_CODE_NOT_IMPORTED\n'));add('recipe',{secondModel:{repository:manifest.models[1].repository,revision:manifest.models[1].revision,device:'cpu',dtype:'fp32',pooling:'mean',max_tokens:256}});for(let m=0;m<2;m++){add('model-manifest:'+m,{repository:manifest.models[m].repository,revision:manifest.models[m].revision,directory:manifest.models[m].directory,files:scenario==='REDUCED_COMPARISON'&&m===1?manifest.models[m].verified_files.map(({path,sha256,bytes})=>({path,sha256,bytes})):manifest.models[m].verified_files});for(let f=0;f<6;f++)add('model-file:'+m+':'+f,Buffer.from('SYNTHETIC_ARTIFACT_NOT_MODEL_BYTES\n'));}
  if(scenario==='LAST_ARTIFACT_TAMPER')fs.appendFileSync(rows.get('model-file:1:5').path,'TAMPER');if(scenario==='MISSING_SECOND_MANIFEST')rows.delete('model-manifest:1');const record={mode:'FICTIONAL',origin_ns:process.hrtime.bigint(),prior_active_ms:17,prior_calls:scenario==='GLOBAL_LIMIT'?60000:7,local_calls:0,prior_admitted_bytes:128,events:[],ready:false,streams:new Map(manifest.models.map((m,i)=>['SYNTHETIC_AUDIT_0000:'+m.policy_sha256+':focal',{model:i,calls:scenario==='STREAM_LIMIT'?20000:0,windows:scenario==='WINDOW_LIMIT'?8192:0}]))};
  const backend=Object.freeze({async read(role){record.events.push({kind:'VERIFY',role});const r=rows.get(role);if(!r)fail('RUNTIME_FICTIONAL_FILE_MISSING');const fd=fs.openSync(r.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const s=fs.fstatSync(fd),b=fs.readFileSync(fd);if(!s.isFile()||s.size>2097152||b.length!==r.bytes||sha(b)!==r.sha256)fail('RUNTIME_FICTIONAL_FILE_INTEGRITY');return b;}finally{fs.closeSync(fd);}},async locate(p){record.events.push({kind:'FICTIONAL_LOCATION_NOT_NODE_RESOLUTION',package:p.name});if(scenario==='WRONG_LOCATION')fail('RUNTIME_FIXED_PACKAGE_LOCATION');return Object.fromEntries(Object.entries(p.descriptor_shape).filter(([,v])=>v!==null));},async open(){constructorCalls++;record.events.push({kind:'FICTIONAL_FIXED_CONSTRUCTOR_NOT_REAL_PACKAGE'});const opened={inference:false,counters:manifest.models.map(m=>({model:{repository:m.repository,revision:m.revision,directory:m.directory,files:JSON.parse(JSON.stringify(m.verified_files)),verified_file_set_sha256:m.file_set_sha256},policy:JSON.parse(JSON.stringify(m.policy)),policy_sha256:m.policy_sha256,tokenCount:text=>{fakeCounterCalls++;return Array.from(text).length+2;}}))};if(scenario==='MISSING_SECOND_CALLABLE')delete opened.counters[1].tokenCount;if(scenario==='WRONG_POLICY')opened.counters[1].policy.special_tokens=false;if(scenario==='WRONG_REPOSITORY')opened.counters[1].model.repository='SYNTHETIC_WRONG';return opened;}});
  let status='HELD_FICTIONAL_CONTROL',error=null,metadata=null;try{const result=await operation(record,manifest,backend);metadata=result.metadata;const stream=record.streams.keys().next().value;result.meter.count(stream,scenario==='ENCODED_PROBE_LIMIT'?'x'.repeat(LIMITS.probe_encoded_characters+1):'🧭');result.meter.window(stream,{tokens:3,input_sha256:sha(Buffer.from('🧭'))});status='PASS_FICTIONAL_CONTROL_NOT_ACTUAL_CONNECTION';}catch(e){error=e.code??'RUNTIME_FICTIONAL_FIXED_FAILURE';}
  return immutable({status,error,scenario,root,events:record.events,constructor_calls:constructorCalls,fake_counter_calls:fakeCounterCalls,metadata,prior_active_ms:record.prior_active_ms,prior_calls:record.prior_calls,local_calls:record.local_calls,prior_admitted_bytes:record.prior_admitted_bytes,limits:LIMITS,reservation:RESERVATION,actual_package_resolution:false,actual_package_import_or_evaluation:false,actual_counter_opened:false,real_model_bytes_opened:false,source_tokenization:false,callable_counter_exported:false,authority:'NONE'});
}
