// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE. Import is inactive. Actual CLI requires a separately ROOT-authored,
// externally hash-pinned admission; this file is not an admission or a judgment.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {H,D,same,check,integer,hash,ID,METHOD,LIMITS,CLOSED_POOL_CARRY,RUN,Q,PINS,exactRef,qualifyMetadata,extractWindows,prepareDocuments,paginateDocuments,renderPage,validateObservation,forwardState} from './reader-core.mjs';
const SELF=fileURLToPath(import.meta.url),CORE=fileURLToPath(new URL('./reader-core.mjs',import.meta.url)),STATE=Q+'/reading';
const encode=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const decode=b=>{const s=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);check(Buffer.from(s).equals(b),'READER_UTF8');return s;};
const allowed=/^(?:session\.json|bundle\.json|ABORTED\.json|coverage\.json|(?:operation|result|emission|ack)-[0-9]{3}\.json|emission-[0-9]{3}\.txt)$/u;
const numbered=(kind,n,suffix='json')=>kind+'-'+String(n).padStart(3,'0')+'.'+suffix;
const ns=()=>process.hrtime.bigint(),started=ns();
let phase=null,op=null,readBytes=0,inputAllowance=65536,sourceCharge=0,stateOwned=false,peakRSS=0,peakHeap=0;
function boundary(){
 const now=ns(),m=process.memoryUsage();peakRSS=Math.max(peakRSS,m.rss);peakHeap=Math.max(peakHeap,m.heapUsed);
 check(now>=started&&Number(now-started)/1e6<=LIMITS.operation_ms&&m.rss<=LIMITS.rss_bytes&&m.heapUsed<=LIMITS.heap_bytes,'READER_OPERATION_OR_MEMORY');
 if(phase)check(/^\d{1,30}$/u.test(phase.origin_ns)&&now>=BigInt(phase.origin_ns)&&Number(now-BigInt(phase.origin_ns))/1e6<=LIMITS.phase_ms,'READER_PHASE_DEADLINE');
}
function regular(p,directory=false){
 check(typeof p==='string'&&p.startsWith('/')&&path.posix.normalize(p)===p&&!/[\u0000-\u001f]/u.test(p),'READER_PATH');
 let at='/';for(const name of p.split('/').filter(Boolean)){at=path.posix.join(at,name);const s=fs.lstatSync(at);check(!s.isSymbolicLink()&&(at===p?(directory?s.isDirectory():s.isFile()&&s.nlink===1):s.isDirectory()),'READER_LINK_OR_KIND');}
 return fs.lstatSync(p);
}
function read(ref,max=LIMITS.input_bytes,{pin=true}={}){
 check(ref&&typeof ref.path==='string'&&integer(ref.bytes,1,max)&&(!pin||hash(ref.sha256)),'READER_READ_REF');
 boundary();check(readBytes+ref.bytes<=inputAllowance,'READER_OPERATION_INPUT_RESERVATION');readBytes+=ref.bytes;
 const st=regular(ref.path),fd=fs.openSync(ref.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const a=fs.fstatSync(fd);check(a.dev===st.dev&&a.ino===st.ino&&a.isFile()&&a.nlink===1&&a.size===ref.bytes,'READER_OPEN_IDENTITY');const b=Buffer.alloc(a.size);let at=0;
  while(at<b.length){boundary();const n=fs.readSync(fd,b,at,Math.min(65536,b.length-at),at);check(n>0,'READER_SHORT_READ');at+=n;}
  const z=fs.fstatSync(fd);check(fs.readSync(fd,Buffer.alloc(1),0,1,at)===0&&z.dev===a.dev&&z.ino===a.ino&&z.size===a.size&&z.mtimeMs===a.mtimeMs&&z.nlink===1&&(!pin||H(b)===ref.sha256),'READER_READ_CHANGED');boundary();return b;
 }finally{fs.closeSync(fd);}
}
const json=ref=>JSON.parse(decode(read(ref)));
function ownRead(name,max=262144){check(allowed.test(name),'READER_OWN_NAME');const p=STATE+'/'+name;return read({path:p,bytes:regular(p).size},max,{pin:false});}
const ownJSON=name=>JSON.parse(decode(ownRead(name)));
function names(){const s=regular(STATE,true),list=fs.readdirSync(STATE);check(list.length<=512&&list.every(n=>allowed.test(n)),'READER_OWN_ROSTER');let bytes=s.size;for(const n of list)bytes+=regular(STATE+'/'+n).size;check(bytes+sourceCharge<=LIMITS.artifact_bytes,'READER_ARTIFACT_BOUND');return {list,bytes};}
function put(name,value){
 check(allowed.test(name),'READER_WRITE_NAME');boundary();const b=Buffer.isBuffer(value)?value:encode(value),inv=names();
 check(b.length<=1048576&&inv.bytes+sourceCharge+b.length+32768<=LIMITS.artifact_bytes,'READER_WRITE_RESERVE');
 const p=STATE+'/'+name,fd=fs.openSync(p,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{let at=0;while(at<b.length){const n=fs.writeSync(fd,b,at,b.length-at);check(n>0,'READER_SHORT_WRITE');at+=n;}fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const dir=fs.openSync(STATE,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}boundary();
 return {path:p,sha256:H(b),bytes:b.length};
}
function monotonicBoot(){const p='/proc/sys/kernel/random/boot_id',fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{check(readBytes+128<=inputAllowance,'READER_BOOT_INPUT_RESERVATION');readBytes+=128;const b=Buffer.alloc(128),n=fs.readSync(fd,b,0,b.length,0),s=decode(b.subarray(0,n)).trim();check(/^[a-f0-9-]{36}$/u.test(s),'READER_BOOT_ID');return s;}finally{fs.closeSync(fd);}}
function begin(action,admissionRef){
 const inv=names();check(!inv.list.includes('ABORTED.json')&&!inv.list.includes('coverage.json'),'READER_CLOSED');
 const operations=inv.list.filter(n=>/^operation-[0-9]{3}\.json$/u.test(n)).sort();check(operations.length<LIMITS.max_operations,'READER_OPERATIONS');let charged=0;
 for(let i=0;i<operations.length;i++){
  check(operations[i]===numbered('operation',i+1)&&inv.list.includes(numbered('result',i+1)),'READER_PARTIAL_OPERATION_NO_RETRY');const r=ownJSON(operations[i]);
  check(r.index===i+1&&r.admission_sha256===admissionRef.sha256&&r.reserved_input_bytes===(i===0?LIMITS.start_input_reserve:LIMITS.operation_input_reserve),'READER_OPERATION_LEDGER');charged+=r.reserved_input_bytes;
 }
 const reserved=operations.length===0?LIMITS.start_input_reserve:LIMITS.operation_input_reserve;check(charged+reserved<=LIMITS.input_bytes,'READER_CUMULATIVE_INPUT');inputAllowance=reserved;
 op={index:operations.length+1,action,admission_sha256:admissionRef.sha256,reserved_input_bytes:reserved,cumulative_input_charge:charged+reserved};put(numbered('operation',op.index),op);
}
function finish(action){boundary();put(numbered('result',op.index),{schema:'fixed0055-reader-operation-resource-checkpoint-v1',index:op.index,action,input_bytes_observed:readBytes,input_bytes_charged:op.reserved_input_bytes,cumulative_input_charge:op.cumulative_input_charge,elapsed_operation_ms:Number(ns()-started)/1e6,peak_self_rss_bytes:peakRSS,peak_heap_bytes:peakHeap,checkpoint_samples_only:true,continuous_OS_resource_guarantee:false,actual_reading_inferred:false,authority:'NONE'});}
function validateAdmission(a,ref){
 check(a.schema==='ROOT-fixed0055-automatic-input-source-reading-admission-v1'&&a.status==='ADMITTED_FIXED_0055_SOURCE_READING_ONLY'&&a.admitted_by==='ROOT'&&a.reviewer===ID.reviewer&&same(a.identity,ID)&&a.method_sha256===METHOD&&same(a.input_refs,PINS)&&same(a.limits,LIMITS)&&same(a.closed_tokenizer_pool_carry,CLOSED_POOL_CARRY)&&a.closed_tokenizer_pool_reopened===false&&a.state_path===STATE&&a.payload_source_display_approved===true&&a.context_judgment_requires_complete_own_reading===true&&a.model_access===false&&a.coder_meanings_access===false&&a.other_cases_access===false&&a.native_envelope_access===false&&a.materiality_holds_cleared===0&&a.quality_gate_pass===false&&a.authority==='NONE','READER_ROOT_ADMISSION');
 check(Array.isArray(a.source_refs)&&a.source_refs.length===2&&same(a.source_refs.map(r=>r.path),[SELF,CORE])&&integer(a.source_copy_charge_bytes,1,LIMITS.source_copy_bytes)&&a.source_copy_charge_bytes>=a.source_refs.reduce((n,r)=>n+r.bytes,0),'READER_SOURCE_CLOSURE');
 for(const r of a.source_refs)read(r,LIMITS.source_copy_bytes);sourceCharge=a.source_copy_charge_bytes;return {path:ref.path,sha256:ref.sha256,bytes:ref.bytes};
}
function bundleState(){
 const s=ownJSON('session.json');check(s.schema==='fixed0055-reader-session-v1'&&s.reviewer===ID.reviewer&&same(s.limits,LIMITS)&&same(s.closed_tokenizer_pool_carry,CLOSED_POOL_CARRY),'READER_SESSION');phase=s;check(s.boot_id===monotonicBoot(),'READER_BOOT_CHANGED');boundary();
 const bundle=JSON.parse(decode(read(s.bundle_ref,1048576))),plan=paginateDocuments(bundle.documents);
 check(same(plan.pages,s.pages)&&plan.visible_capture_charge===s.visible_capture_charge&&D(bundle.comparison)===s.comparison_sha256&&s.bundle_ref.path===STATE+'/bundle.json','READER_FROZEN_PAGE_PLAN');return {session:s,bundle,pages:plan.pages};
}
function pageState(pages){
 const inv=names(),emissions=pages.map(p=>inv.list.includes(numbered('emission',p.global))),acks=pages.map(p=>inv.list.includes(numbered('ack',p.global))),state=forwardState(emissions,acks,pages.length),chunks=[];
 for(const p of pages){
  const textName=numbered('emission',p.global,'txt');check(inv.list.includes(textName)===emissions[p.global-1],'READER_PARTIAL_EMISSION');
  if(emissions[p.global-1]){const e=ownJSON(numbered('emission',p.global));check(same(e.page,p)&&e.reader===ID.reviewer&&e.actual_reading===false&&e.retained_response_ref.path===STATE+'/'+textName,'READER_EMISSION');read(e.retained_response_ref,65536);}
  if(acks[p.global-1]){const a=ownJSON(numbered('ack',p.global));check(a.schema==='fixed0055-separate-observed-reading-declaration-v1','READER_ACK_SCHEMA');validateObservation(a.observation,p,chunks);chunks.push(a.observation.chunk_id);}
 }
 return {...state,chunks};
}
export async function main(argv){
 check(process.platform==='linux'&&process.env.NONVERBA_CONTAINER==='1'&&same(process.execArgv,['--max-old-space-size=512','--disable-proto=throw'])&&['NODE_OPTIONS','NODE_PATH','NODE_COMPILE_CACHE','LD_PRELOAD','LD_AUDIT','BASH_ENV','ENV'].every(k=>!process.env[k]),'READER_MANAGED_ENV');
 const[action,admissionPath,admissionSHA,admissionBytes,arg,...extra]=argv;
 check(['start','next','ack','complete'].includes(action)&&admissionPath===Q+'/admission.json'&&hash(admissionSHA)&&integer(Number(admissionBytes),1,16384)&&extra.length===0,'READER_CLI');
 const admissionRef={path:admissionPath,sha256:admissionSHA,bytes:Number(admissionBytes)},a=json(admissionRef);validateAdmission(a,admissionRef);
 if(action==='start'){
  check(arg===undefined,'READER_START_ARGUMENT');regular(Q,true);fs.mkdirSync(STATE,{mode:0o700});stateOwned=true;begin(action,admissionRef);
  phase={origin_ns:started.toString()};const boot_id=monotonicBoot();
  // Metadata qualification and full CID guard precede both plan and original IO.
  const metadata={body:json(PINS.body),epoch:json(PINS.epoch),guard:json(PINS.guard),selection:json(PINS.selection),result:json(PINS.result)};read(PINS.acceptance);
  const binding=qualifyMetadata(metadata),model0=extractWindows(json(PINS.model0),binding,0),model1=extractWindows(json(PINS.model1),binding,1);
  const raw=decode(read(exactRef(binding.raw_ref),131072)),prepared=prepareDocuments(raw,binding,[model0,model1]),planned=paginateDocuments(prepared.documents);
  const bundle_ref=put('bundle.json',{schema:'fixed0055-exact-original-and-input-texts-v1',documents:prepared.documents,comparison:prepared.comparison});
  put('session.json',{schema:'fixed0055-reader-session-v1',admission_ref:admissionRef,reviewer:ID.reviewer,identity:ID,origin_ns:started.toString(),boot_id,limits:LIMITS,closed_tokenizer_pool_carry:CLOSED_POOL_CARRY,bundle_ref,pages:planned.pages,visible_capture_charge:planned.visible_capture_charge,comparison_sha256:D(prepared.comparison),model_texts_exact_equal:prepared.comparison.all15_exact_equal,reading_window_scopes:prepared.comparison.all15_exact_equal?15:30,full_original_range:[0,47662],metadata_only_before_payload:true,actual_reading:false,context_adequate:null,source_quality_gate_pass:false,materiality_holds_cleared:0,authority:'NONE'});
  finish(action);process.stdout.write('STARTED fixed0055 bounded source reading; no judgment.\n');return;
 }
 stateOwned=true;regular(STATE,true);begin(action,admissionRef);const{session,bundle,pages}=bundleState();check(same(session.admission_ref,admissionRef),'READER_SESSION_ADMISSION');const state=pageState(pages);
 if(action==='next'){
  check(arg===undefined&&state.pending===null&&!state.complete,'READER_ACK_REQUIRED_OR_COMPLETE');const p=pages[state.acknowledged],response=renderPage(bundle.documents[p.document_index],p);
  check(H(response)===p.sha256&&Buffer.byteLength(response)===p.bytes&&response.length===p.utf16,'READER_PREPARED_RESPONSE');
  const retained_response_ref=put(numbered('emission',p.global,'txt'),Buffer.from(response));
  put(numbered('emission',p.global),{schema:'fixed0055-source-page-emission-v1',reader:ID.reviewer,page:p,retained_response_ref,actual_reading:false,publication_precharged:true,authority:'NONE'});finish(action);
  await new Promise((resolve,reject)=>process.stdout.write(response,e=>e?reject(e):resolve()));return;
 }
 if(action==='ack'){
  check(typeof arg==='string'&&Buffer.byteLength(arg)<=4096&&state.pending!==null,'READER_ACK_ARGUMENT');const observation=JSON.parse(arg),p=pages[state.pending-1];validateObservation(observation,p,state.chunks);
  put(numbered('ack',p.global),{schema:'fixed0055-separate-observed-reading-declaration-v1',observation,agent_authored_actual_reading_declaration:true,human:false,authority:'NONE',quality_gate_pass:false});finish(action);process.stdout.write('ACK fixed0055 observed page '+p.global+'.\n');return;
 }
 check(arg===undefined&&state.complete&&state.pending===null,'READER_COMPLETE_REQUIRES_ALL_ACKS');
 put('coverage.json',{schema:'fixed0055-own-source-reading-declarations-complete-v1',reviewer:ID.reviewer,identity:ID,admission_ref:admissionRef,bundle_ref:session.bundle_ref,pages:pages.length,all_pages_separately_emitted_and_reader_ACKed:true,complete_original_HTML_range:[0,47662],model_texts_exact_equal:session.model_texts_exact_equal,reading_window_scopes:session.reading_window_scopes,other_model_qualification:session.model_texts_exact_equal?'EXACT_INPUT_TEXT_BYTES_ONLY':'SEPARATE_OWN_READING_REQUIRED_AND_ACKED',machine_validation_is_not_actual_reading:true,context_adequate:null,formal_default_holds_preserved:true,closed_tokenizer_pool_carry:CLOSED_POOL_CARRY,model_inference:false,source_or_native_qualification:false,quality_gate_pass:false,materiality_holds_cleared:0,authority:'NONE'});finish(action);process.stdout.write('COMPLETE own page declarations only; context judgment remains separate.\n');
}
// All partial emissions, charges, locks and failures are retained. No retry,
// re-emission, skip, journal reset, code-generated reading claim or adoption.
if(process.argv[1]&&path.resolve(process.argv[1])===SELF)main(process.argv.slice(2)).catch(()=>{
 if(stateOwned)try{const b=encode({schema:'fixed0055-reading-aborted-v1',preserve_all_partials:true,retry:false,reset:false,actual_reading_inferred:false,authority:'NONE'});fs.writeFileSync(STATE+'/ABORTED.json',b,{flag:'wx',mode:0o600});}catch{}
 process.stderr.write('HELD fixed0055 bounded reading; preserve partial state and return to ROOT.\n');process.exitCode=77;
});
