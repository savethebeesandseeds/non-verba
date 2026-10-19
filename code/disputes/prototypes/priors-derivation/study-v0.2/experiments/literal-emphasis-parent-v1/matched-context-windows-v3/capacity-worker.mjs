// SPDX-License-Identifier: AGPL-3.0-only
// Fixed metadata-only auxiliary. Never opens contract/model/tokenizer payloads.
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Q,R,POLICY_REF,NODE,FLAGS,io,json,read,same,check,runtime,sourceRefs} from './io.mjs';
import {actorIdentity,observeProcess,procText,validateActorLaunch} from './supervisor.mjs';
const now=process.hrtime.bigint.bind(process.hrtime),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const safeCode=e=>{try{const d=Object.getOwnPropertyDescriptor(e,'code');return d&&Object.hasOwn(d,'value')&&typeof d.value==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/u.test(d.value)?d.value:'CENSUS_CAPACITY_WORKER_FAILURE';}catch{return'CENSUS_CAPACITY_WORKER_FAILURE';}};
export function capacityLifecycle({nonce,source_epoch_sha256}){let stopped=false,local=false,held=false;return Object.freeze({receive(m){if(m?.schema==='matched-window-capacity-stop-v1'&&Object.keys(m).sort().join('|')==='nonce|schema|source_epoch_sha256'&&m.nonce===nonce&&m.source_epoch_sha256===source_epoch_sha256)stopped=true;else{held=true;stopped=true;}},beginDisconnect(){check(stopped&&!held,'CENSUS_CAPACITY_UNEXPECTED_DISCONNECT');local=true;},disconnected(){if(!stopped||!local)held=true;stopped=true;},signal(){held=true;stopped=true;},stopped:()=>stopped,held:()=>held});}
export function capacityPacket({result,started_ns,observed_ns,launch,actor}){
 check(result&&Number.isSafeInteger(result.bytes)&&result.bytes>0&&typeof started_ns==='bigint'&&typeof observed_ns==='bigint'&&observed_ns>=started_ns&&observed_ns-started_ns<=1000000000n,'CENSUS_CAPACITY_SCAN_BOUND');
 return Object.freeze({schema:'matched-window-capacity-sample-v1',nonce:launch.nonce,source_epoch_sha256:launch.source_epoch_ref.sha256,boot_id:launch.boot_id,phase_origin_ns:launch.phase_origin_ns,supervisor:Object.freeze({...launch.supervisor}),actor:Object.freeze({...actor}),observed_ns:String(observed_ns),scan_elapsed_ms:Math.ceil(Number(observed_ns-started_ns)/1e6),bytes:result.bytes});
}
async function send(packet){check(process.connected&&typeof process.send==='function','CENSUS_CAPACITY_PARENT_CHANNEL');await new Promise((resolve,reject)=>{process.send(packet,error=>error?reject(error):resolve());});}
export async function runCapacityWorker({admission_ref,launch_ref}={}){
 let launch=null;
 try{
  check(admission_ref?.path===Q+'/ROOT-window-admission.json'&&launch_ref?.path===Q+'/execution/capacity-launch.json','CENSUS_CAPACITY_ENTRY');const a=json(admission_ref),p=json(POLICY_REF);launch=json(launch_ref,8192);const actor=actorIdentity(observeProcess(process.pid)),parent=observeProcess(process.ppid),boot_id=procText('/proc/sys/kernel/random/boot_id',128).trim();
  check(a.schema==='ROOT_MATCHED_CONTEXT_WINDOWS_ADMISSION_V1'&&a.status==='ADMITTED_FIXED_32_STREAM_TOKENIZER_ONLY_CENSUS'&&a.root===Q&&a.historical_phase_elapsed_ms===14985&&a.current_attempt_phase_ms_cap===165015&&a.cumulative_phase_ms_cap===180000&&same(a.policy_ref,POLICY_REF)&&same(a.runtime_ref,NODE)&&same(a.node_flags,FLAGS),'CENSUS_CAPACITY_ADMISSION');validateActorLaunch(launch,{role:'capacity',admission_ref,source_epoch_ref:a.source_epoch_ref,boot_id,supervisor:actorIdentity(parent)});check(actor.group===actor.pid&&parent.pid===launch.supervisor.pid&&actor.pid!==parent.pid,'CENSUS_CAPACITY_OWNED_BIRTH');
  runtime();const e=json(a.source_epoch_ref);check(e.schema==='matched-context-windows-source-epoch-v1'&&same(e.source_refs,a.source_refs)&&same(e.runtime_ref,NODE)&&same(e.node_flags,FLAGS)&&a.source_refs.some(r=>same(r,a.capacity_worker_entry_ref))&&a.capacity_worker_entry_ref.path===fileURLToPath(import.meta.url),'CENSUS_CAPACITY_SOURCE_EPOCH');sourceRefs(a.source_refs);
  check(same(a.capacity_helper_ref,p.capacity_helper_ref)&&same(a.capacity_policy_ref,p.capacity_policy_ref),'CENSUS_CAPACITY_REFS');read(p.capacity_helper_ref);const cp=json(p.capacity_policy_ref),{measureRunCapacity}=await import(pathToFileURL(p.capacity_helper_ref.path).href);check(typeof measureRunCapacity==='function','CENSUS_CAPACITY_HELPER_API');
  const lifecycle=capacityLifecycle({nonce:launch.nonce,source_epoch_sha256:a.source_epoch_ref.sha256});process.on('message',m=>{lifecycle.receive(m);if(lifecycle.held())process.exitCode=77;});process.on('disconnect',()=>{lifecycle.disconnected();if(lifecycle.held())process.exitCode=77;});process.on('SIGTERM',()=>{lifecycle.signal();process.exitCode=77;});process.on('SIGINT',()=>{lifecycle.signal();process.exitCode=77;});
  async function sample(){const started=now();check(started>=BigInt(launch.phase_origin_ns)&&started-BigInt(launch.phase_origin_ns)<=BigInt(a.current_attempt_phase_ms_cap)*1000000n,'CENSUS_CAPACITY_PHASE_CLOCK');const result=await measureRunCapacity(R,cp,{io});const at=now(),packet=capacityPacket({result,started_ns:started,observed_ns:at,launch,actor});check(result.bytes>=p.whole_RUN_floor&&result.bytes<=p.whole_RUN_cap&&result.bytes-p.growth_baseline<=p.growth_hard,'CENSUS_CAPACITY_RUN_BOUND');await send(packet);}
  do{await sample();if(!lifecycle.stopped())await sleep(300);}while(!lifecycle.stopped()&&!lifecycle.held());
  // A final fresh scan precedes graceful normal STOP/IPC shutdown.
  if(!lifecycle.held())await sample();if(process.connected){if(!lifecycle.held())lifecycle.beginDisconnect();process.disconnect();}return lifecycle.held()?77:0;
 }catch(e){try{if(launch&&process.connected)await send({schema:'matched-window-capacity-held-v1',nonce:launch.nonce,source_epoch_sha256:launch.source_epoch_ref.sha256,code:safeCode(e)});}catch{}if(process.connected)process.disconnect();return 77;}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const[ap,ah,ab,lp,lh,lb,...extra]=process.argv.slice(2),valid=(h,b)=>/^[a-f0-9]{64}$/u.test(h??'')&&/^[1-9][0-9]{0,5}$/u.test(b??'');if(extra.length||ap!==Q+'/ROOT-window-admission.json'||lp!==Q+'/execution/capacity-launch.json'||!valid(ah,ab)||!valid(lh,lb))process.exitCode=77;
 else runCapacityWorker({admission_ref:{path:ap,sha256:ah,bytes:Number(ab)},launch_ref:{path:lp,sha256:lh,bytes:Number(lb)}}).then(n=>{process.exitCode=n;}).catch(()=>{process.exitCode=77;});
}
