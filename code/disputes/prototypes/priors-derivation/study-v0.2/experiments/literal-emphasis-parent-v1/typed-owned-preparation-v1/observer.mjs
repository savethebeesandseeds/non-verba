// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE: an external parent of the two SOURCE_FREE actors, never actual data authority.
import {LIMITS,check,fail,canonical,immutable,sameIdentity,checkedConfiguration,errorCode} from './configuration.mjs';
import {NODE_FLAGS,observe,operation,processIdentity,readRef,readJSON,readSmall,tree,writeExclusive,noLinks} from './frame-runtime.mjs';
import {trackExternalSupervisor,registerExternalActor,waitExternalExit,verifyExternalPhaseA,verifyExternalPhaseB,externalRegisteredActors} from './checkpoint.mjs';
import {createLineageEvidenceRecorder} from '../typed-source-preparation-v1/lineage-evidence.mjs';

export function packet(config,ref,kind,payload){return{schema:'typed-owned-ipc-v1',epoch_id:config.epoch_id,nonce:config.nonce,phase:config.phase,configuration_sha256:ref.sha256,source_epoch_sha256:config.source_epoch_ref.sha256,kind,payload};}
export function checkedPacket(message,config,ref){check(message&&Object.getPrototypeOf(message)===Object.prototype&&Object.keys(message).sort().join('|')==='configuration_sha256|epoch_id|kind|nonce|payload|phase|schema|source_epoch_sha256'&&Buffer.byteLength(JSON.stringify(message))<=16384,'TYPED_OBSERVER_PACKET');const head=packet(config,ref,message.kind,message.payload);check(Object.keys(head).every(k=>k==='payload'||message[k]===head[k]),'TYPED_OBSERVER_PACKET_BINDING');return message;}
export function checkedProgress(payload,previous){check(payload&&Number.isSafeInteger(payload.total_calls)&&Number.isSafeInteger(payload.windows)&&payload.total_calls>=previous.total_calls&&payload.windows>=previous.windows&&payload.total_calls+LIMITS.failed_counter_calls<=LIMITS.total_calls&&payload.windows<=payload.total_calls,'TYPED_OBSERVER_PROGRESS');return{total_calls:payload.total_calls,windows:payload.windows};}
function safeCode(error){return errorCode(error,'TYPED_OBSERVER_UNKNOWN');}
function rss(caps,identity){const first=observe(caps,identity.pid);check(first.state==='LIVE'&&sameIdentity(first,identity),'TYPED_OBSERVER_RSS_BIRTH');const text=readSmall(caps,'/proc/'+identity.pid+'/stat',8192).toString('utf8'),end=text.lastIndexOf(') '),fields=text.slice(end+2).trim().split(/\s+/u);check(end>0&&fields[19]===identity.start_ticks&&Number(fields[2])===identity.group&&/^[0-9]+$/u.test(fields[21]),'TYPED_OBSERVER_RSS_STAT');const bytes=Number(fields[21])*4096,again=observe(caps,identity.pid);check(Number.isSafeInteger(bytes)&&bytes>=0&&again.state==='LIVE'&&sameIdentity(first,again),'TYPED_OBSERVER_RSS_CHANGED');return bytes;}
const FAILED_PREFIX_LOGS=Object.freeze({capture_bytes:1108,journal_rows:1790,journal_bytes:651445});
export function leaseForRegisteredActor(lease,actor,generation){return Boolean(actor&&lease?.held===false&&lease.generation===generation&&Array.isArray(lease.actors)&&lease.actors.some(a=>sameIdentity(a,actor)));}
function globalFiles(caps,root){const pending=[root];let capture_bytes=FAILED_PREFIX_LOGS.capture_bytes,journal_rows=FAILED_PREFIX_LOGS.journal_rows,journal_bytes=FAILED_PREFIX_LOGS.journal_bytes;while(pending.length){const file=pending.pop(),s=caps.fs.lstatSync(file);check(!s.isSymbolicLink(),'TYPED_OBSERVER_TREE_LINK');if(s.isDirectory()){for(const n of caps.fs.readdirSync(file))pending.push(file+'/'+n);}else{check(s.isFile(),'TYPED_OBSERVER_TREE_KIND');if(file.endsWith('.private.log'))capture_bytes+=s.size;if(file.endsWith('.journal.ndjson')){journal_bytes+=s.size;check(journal_bytes<=LIMITS.journal_bytes,'TYPED_OBSERVER_JOURNAL_BYTES');const b=readSmall(caps,file,LIMITS.journal_bytes);let from=0;for(let at=0;at<b.length;at++)if(b[at]===10){check(at-from+1<=LIMITS.journal_row_bytes,'TYPED_OBSERVER_JOURNAL_ROW');journal_rows++;from=at+1;}check(from===b.length,'TYPED_OBSERVER_JOURNAL_PARTIAL');}}}check(capture_bytes<=LIMITS.capture_bytes&&journal_rows<=LIMITS.journal_rows,'TYPED_OBSERVER_GLOBAL_LOG_BOUND');return{capture_bytes,journal_rows,journal_bytes};}

/** Single-flight resource walks. The registry is reacquired after each await;
 * an actor registered during a walk cannot inherit an older RSS sample. */
export function resourceController(caps,config,{capacityProbe,originNs,initialCarry=LIMITS.failed_active_carry_ms,onSample=()=>{}}){
  check(typeof capacityProbe==='function'&&typeof originNs==='string'&&/^[0-9]{1,32}$/u.test(originNs)&&Number.isSafeInteger(initialCarry)&&initialCarry>=LIMITS.failed_active_carry_ms&&initialCarry<=LIMITS.active_ms,'TYPED_OBSERVER_RESOURCE_CONFIGURATION');
  let generation=0,held=null,inflight=null,lastLease=null,progress={total_calls:0,windows:0};
  const actors=new Map(),retired=new Map();let resourceGroup=null;
  const hold=code=>{held??=code;};
  const add=(role,identity)=>{check(!held&&!actors.has(role)&&['SUPERVISOR','WORKER'].includes(role),'TYPED_OBSERVER_REGISTER_ONCE');actors.set(role,immutable(identity));generation++;};
  const note=payload=>{progress=checkedProgress(payload,progress);};
  const retire=identity=>{for(const[role,birth]of actors)if(sameIdentity(birth,identity)){retired.set(role,birth);actors.delete(role);generation++;}};
  async function sample(){
    if(inflight)return inflight;
    inflight=(async()=>{try{
      for(let attempt=0;attempt<4;attempt++){
        if(held)fail(held);if(caps.stopCode?.())fail(caps.stopCode());
        const capacity_started_ms=caps.now(),capacity=await capacityProbe();
        check(capacity&&Number.isSafeInteger(capacity.bytes)&&capacity.bytes>=LIMITS.RUN_floor&&capacity.bytes-LIMITS.growth_baseline<=LIMITS.growth_hard,'TYPED_OBSERVER_SHARED_CAPACITY');
        // No await follows this registry read. Registration during the walk is included.
        const currentGeneration=generation,currentActors=[...actors.values()],rss_started_ms=caps.now();
        let rss_bytes=rss(caps,config.observer),changed=false;
        for(const actor of currentActors){const observed=observe(caps,actor.pid);if(observed.state==='ABSENT'||observed.state==='ZOMBIE'){retire(actor);changed=true;continue;}rss_bytes+=rss(caps,actor);}
        if(changed||currentGeneration!==generation)continue;
        const unadmitted_resource_candidates=[];
        if(resourceGroup){
          const names=caps.fs.readdirSync('/proc');check(names.length<=8192,'TYPED_OBSERVER_PROC_BOUND');let members=0;
          for(const name of names){if(!/^[0-9]+$/u.test(name))continue;const v=observe(caps,Number(name));check(v.state!=='UNKNOWN','TYPED_OBSERVER_GROUP_UNKNOWN');if(v.state==='ABSENT'||v.group!==resourceGroup.group)continue;check(++members<=2&&(sameIdentity(v,resourceGroup)||v.ppid===resourceGroup.pid),'TYPED_OBSERVER_UNEXPECTED_GROUP_MEMBER');if(v.state==='LIVE'&&!currentActors.some(a=>sameIdentity(a,v))){const birth=processIdentity(v);rss_bytes+=rss(caps,birth);unadmitted_resource_candidates.push(birth);}}
        }
        const owned=tree(caps,config.root),logs=globalFiles(caps,config.root),now=caps.now();
        const elapsed_ms=initialCarry+Number((caps.nowNs()-BigInt(originNs)+999999n)/1000000n);
        const pilot_bytes=Math.max(config.prior_cost.admitted_output_bytes,LIMITS.retained_preparation_bytes+LIMITS.failed_execution_prefix_bytes+owned.bytes);
        check(now-capacity_started_ms<=LIMITS.capacity_age_ms&&now-rss_started_ms<=LIMITS.rss_age_ms,'TYPED_OBSERVER_RESOURCE_STALE');
        check(rss_bytes<=LIMITS.rss_bytes&&elapsed_ms<=LIMITS.active_ms&&pilot_bytes<=LIMITS.pilot_bytes,'TYPED_OBSERVER_RESOURCE_BOUND');
        lastLease=immutable({held:false,generation,actors:currentActors,unadmitted_resource_candidates,observer:config.observer,rss_started_ms,capacity_started_ms,sample:{rss_bytes,study_bytes:capacity.bytes,shared_growth_bytes:capacity.bytes-LIMITS.growth_baseline,pilot_bytes,capture_bytes:logs.capture_bytes,elapsed_ms,total_calls:LIMITS.failed_counter_calls+progress.total_calls}});
        check(onSample(lastLease)===undefined,'TYPED_OBSERVER_SAMPLE_WRITER');
        const afterLogs=globalFiles(caps,config.root),afterTree=tree(caps,config.root);
        const afterPilot=Math.max(config.prior_cost.admitted_output_bytes,LIMITS.retained_preparation_bytes+LIMITS.failed_execution_prefix_bytes+afterTree.bytes);
        check(afterPilot<=LIMITS.pilot_bytes,'TYPED_OBSERVER_POSTWRITE_BYTES');
        check(caps.now()-rss_started_ms<=LIMITS.rss_age_ms&&caps.now()-capacity_started_ms<=LIMITS.capacity_age_ms,'TYPED_OBSERVER_POSTWRITE_STALE');
        lastLease=immutable({...lastLease,sample:{...lastLease.sample,pilot_bytes:afterPilot,capture_bytes:afterLogs.capture_bytes}});
        return lastLease;
      }
      fail('TYPED_OBSERVER_REGISTRY_UNSTABLE');
    }catch(error){hold(safeCode(error));throw error;}})();
    try{return await inflight;}finally{inflight=null;}
  }
  return Object.freeze({sample,add,note,hold,retire,setResourceGroup(identity){check(!resourceGroup&&identity.pid===identity.group&&identity.group!==config.observer.group,'TYPED_OBSERVER_RESOURCE_GROUP');resourceGroup=immutable(identity);},generation:()=>generation,actors:()=>[...actors.values()],held:()=>held,last:()=>lastLease,progress:()=>({...progress}),retired:()=>[...retired.values()]});
}

export async function observePhase(caps,configuration,configRef,options){
  const config=checkedConfiguration(configuration);check(readJSON(caps,configRef).sha256===config.sha256,'TYPED_OBSERVER_CONFIG');
  const lineage=createLineageEvidenceRecorder();
  const phases=config.root+'/phases';try{caps.fs.mkdirSync(phases,{mode:0o700});}catch(error){check(errorCode(error)==='EEXIST','TYPED_OBSERVER_PHASE_PARENT');}noLinks(caps,phases,{directory:true});caps.fs.mkdirSync(phases+'/'+config.phase,{mode:0o700});noLinks(caps,phases+'/'+config.phase,{directory:true});
  for(const ref of config.source_refs)readRef(caps,ref,262144);
  check(sameIdentity(observe(caps,caps.pid),config.observer)&&operation(caps,caps.pid).argv_sha256===config.observer_operation_sha256,'TYPED_OBSERVER_SELF');
  const resources=resourceController(caps,config,options),captureDir=config.root+'/captures';try{caps.fs.mkdirSync(captureDir,{mode:0o700});}catch(e){check(e.code==='EEXIST','TYPED_OBSERVER_CAPTURE_DIR');}
  noLinks(caps,captureDir,{directory:true});
  const captureFiles=['stdout','stderr'].map(name=>captureDir+'/'+config.phase+'.supervisor.'+name+'.private.log');
  const fds=captureFiles.map(file=>caps.fs.openSync(file,caps.constants.O_CREAT|caps.constants.O_EXCL|caps.constants.O_WRONLY|caps.constants.O_NOFOLLOW,0o600));
  let child,witness,closed=false,held=null,timer=null,serial=Promise.resolve(),stopTimer=null,periodicPending=null;
  const stopPeriodic=async()=>{if(timer!==null){caps.clearInterval(timer);timer=null;}if(periodicPending)await periodicPending;};
  const cleanupTimers=[],signalFacts=[];
  function signalKnown(signal){
    if(closed||!witness)return;
    const records=externalRegisteredActors(witness);
    for(const role of['WORKER','SUPERVISOR']){
      const record=records.find(r=>r.role===role);if(!record)continue;
      const a=observe(caps,record.actor.pid),parent=observe(caps,record.parent.pid);
      if(a.state==='ABSENT'||a.state==='ZOMBIE')continue;
      if(a.state!=='LIVE'||parent.state!=='LIVE'||!sameIdentity(a,record.actor)||!sameIdentity(parent,record.parent)||a.ppid!==parent.pid)continue;
      // A parent is never terminated while another member of its group remains.
      if(role==='SUPERVISOR'){
        let alone=true;const names=caps.fs.readdirSync('/proc');if(names.length>8192)continue;
        for(const name of names){if(!/^[0-9]+$/u.test(name))continue;const v=observe(caps,Number(name));if(v.state==='UNKNOWN'||v.state!=='ABSENT'&&v.group===a.group&&v.pid!==a.pid){alone=false;break;}}
        if(!alone)continue;
      }
      const again=observe(caps,a.pid),pp=observe(caps,parent.pid);
      if(again.state!=='LIVE'||pp.state!=='LIVE'||!sameIdentity(again,a)||!sameIdentity(pp,parent)||again.ppid!==parent.pid)continue;
      try{caps.kill(a.pid,signal);signalFacts.push({actor:record.actor,parent:record.parent,signal,at_ms:caps.now(),request_returned:true,absence_not_inferred:true});}catch(error){signalFacts.push({actor:record.actor,signal,at_ms:caps.now(),code:safeCode(error),absence_not_inferred:true});}
    }
  }
  const safeSignal=signal=>{try{signalKnown(signal);}catch(error){signalFacts.push({signal,at_ms:caps.now(),code:safeCode(error),request_returned:false,absence_not_inferred:true});}};
  const stop=code=>{const safe=typeof code==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/u.test(code)?code:'TYPED_OBSERVER_STOP';const first=held===null;held??=safe;resources.hold(held);if(first&&child?.connected)try{child.send(packet(config,configRef,'STOP',{code:held}),()=>{});}catch{}if(first&&child){cleanupTimers.push(caps.setTimeout(()=>safeSignal('SIGTERM'),1000),caps.setTimeout(()=>safeSignal('SIGKILL'),2000));}};
  try{
    await resources.sample();
    child=caps.fork(config.supervisor_ref.path,['--typed-owned',configRef.path,configRef.sha256,String(configRef.bytes)],{execPath:config.runtime_ref.path,execArgv:NODE_FLAGS,detached:true,stdio:['ignore',fds[0],fds[1],'ipc'],env:{NONVERBA_CONTAINER:'1',PATH:'/usr/bin:/bin',LANG:'C.UTF-8',TZ:'UTC'}});
    child.on('error',error=>stop(safeCode(error)));
    witness=trackExternalSupervisor(caps,child,config,configRef);
    const supervisor=processIdentity(observe(caps,child.pid));resources.setResourceGroup(supervisor);
    child.once('close',()=>{closed=true;});

    const guardedSend=(kind,payload)=>{if(!child.connected){stop('TYPED_OBSERVER_IPC_CLOSED');return false;}try{child.send(packet(config,configRef,kind,payload),error=>{if(error)stop(safeCode(error));});return true;}catch(error){stop(safeCode(error));return false;}};
    const transmit=lease=>{if(!held&&child.connected&&leaseForRegisteredActor(lease,supervisor,resources.generation()))guardedSend('RESOURCE_LEASE',lease);};
    child.on('message',message=>{serial=serial.then(async()=>{
      const m=checkedPacket(message,config,configRef);
      if(m.kind==='HELLO'||m.kind==='WORKER_CANDIDATE'){
        const role=m.kind==='HELLO'?'SUPERVISOR':'WORKER';
        check(m.payload?.role===role,'TYPED_OBSERVER_ROLE');
        const diagnostic=v=>v?.state==='ABSENT'?null:v?.state==='UNKNOWN'?'UNKNOWN':v;
        registerExternalActor(caps,witness,m.payload,{
          onLineageObservation({candidate,expectedParent,observedParent}){
            lineage.capture(diagnostic(candidate),expectedParent,diagnostic(observedParent),Math.floor(caps.now()-Number(BigInt(config.phase_start_ns))/1e6),held);
          },
          onHeldLineage(){lineage.markHeldLineage();}
        });
        resources.add(role,m.payload.actor);
        const lease=await resources.sample();
        check(leaseForRegisteredActor(lease,m.payload.actor,resources.generation()),'TYPED_OBSERVER_REGISTRY_RACE');
        guardedSend('ROOT_REGISTER_ACK',{role,actor:m.payload.actor,parent:m.payload.parent,generation:lease.generation,lease});
        return;
      }
      if(m.kind==='PROGRESS'){resources.note(m.payload);return;}
      if(m.kind==='HELD'){stop(m.payload?.code??'TYPED_SUPERVISOR_HELD');return;}
      if(m.kind==='PHASE_TERMINAL'){check(m.payload?.terminal_ref?.path===config.root+'/phases/'+config.phase+'/terminal.json','TYPED_OBSERVER_TERMINAL_PACKET');return;}
      fail('TYPED_OBSERVER_PACKET_KIND');
    }).catch(error=>stop(safeCode(error)));});
    timer=caps.setInterval(()=>{if(periodicPending)return;periodicPending=(async()=>{try{transmit(await resources.sample());}catch(error){stop(safeCode(error));}finally{periodicPending=null;}})();},100);
    const remaining=Math.max(1,Number(BigInt(config.deadline_ns))/1e6-caps.now());
    stopTimer=caps.setTimeout(()=>stop('TYPED_OBSERVER_DEADLINE'),remaining);
    const exit=await waitExternalExit(witness);
    await serial;
    await stopPeriodic();
    if(stopTimer!==null){caps.clearTimeout(stopTimer);stopTimer=null;}
    if(held||resources.held())fail(held??resources.held());
    check(closed&&exit,'TYPED_OBSERVER_PHASE_HELD');
    const terminalRef=options.refOf(config.root+'/phases/'+config.phase+'/terminal.json');
    const verified=config.phase==='A'?verifyExternalPhaseA(caps,config,configRef,witness,terminalRef):verifyExternalPhaseB(caps,config,configRef,witness,terminalRef);
    await resources.sample();
    return{...verified,terminal_ref:terminalRef,resource_lease:resources.last(),source_kind:'SOURCE_FREE_FIXTURE',actual_authority:false,authority:'NONE'};
  }catch(error){stop(safeCode(error));if(witness&&!closed)try{await waitExternalExit(witness);}catch(joinError){signalFacts.push({join_unproven:true,code:safeCode(joinError),at_ms:caps.now(),absence_not_inferred:true});}throw error;}
  finally{await stopPeriodic();for(const id of cleanupTimers)caps.clearTimeout(id);try{writeExclusive(caps,config.root,'control/phase-'+config.phase+'.lineage-evidence.json',Buffer.from(JSON.stringify(lineage.read(),null,2)+'\n'),16384);if(signalFacts.length)writeExclusive(caps,config.root,'control/phase-'+config.phase+'.signal-events.json',Buffer.from(JSON.stringify({source_kind:'SOURCE_FREE_FIXTURE',facts:signalFacts,authority:'NONE'},null,2)+'\n'),16384);}catch{}if(stopTimer!==null)caps.clearTimeout(stopTimer);for(const fd of fds)try{caps.fs.closeSync(fd);}catch{}if(child?.connected&&closed)child.disconnect();}
}
export function actualObserver(){fail('TYPED_OBSERVER_ACTUAL_CLOSED');}
