// SPDX-License-Identifier: AGPL-3.0-only
// Source template, read literally by build-bootstrap.mjs; never imported.
// Two builtin threads share the observer PID/RSS. A RUN scan cannot occupy the
// independent RSS sampler's event loop. A missed freshness/cadence is a HOLD.
async function monitorMain(){
  Gate.exact(workerData,['mode','registry','generation','policy','deadline','alert_path','literal_args','runtime']);Gate.validateLiteralArguments(workerData.literal_args);
  const mode=workerData.mode;
  if(!['RSS','CAPACITY'].includes(mode)||!parentPort||!Number.isFinite(workerData.deadline)||typeof workerData.alert_path!=='string'||!/^\/opt\/nonverba-build\/priors-derivation\/study-v0\.2\/20261013-study-15000\/qa\/literal-emphasis-actualA-[A-Za-z0-9_-]+\/execution\/observer\/monitor-(rss|capacity)-held\.json$/u.test(workerData.alert_path))Gate.fail('EXECUTOR_MONITOR_DATA');
  Capacity.validateOriginalCapacityPolicy(workerData.policy);
  let records=workerData.registry,generation=workerData.generation,stop=false,lastStart=null,sequence=0,lastBytes=null,ticket=null,lastCollector=null;const candidates=[];
  parentPort.on('message',m=>{try{bounded(m);if(m.type==='STOP'){Gate.exact(m,['type']);stop=true;return;}if(m.type==='EXPECT_CHILD'){Gate.exact(m,['type','parent','deadline_ms','role','entry','argv']);if(mode!=='RSS'||ticket||m.parent.pid!==process.pid||!records.some(r=>r.pid===m.parent.pid&&r.start_ticks===m.parent.start_ticks&&r.group===m.parent.group)||!Number.isFinite(m.deadline_ms)||m.deadline_ms>Math.min(workerData.deadline,mono()+5000)||m.deadline_ms<mono()||m.entry!==EXECUTOR_SELF||!['PARENT','WORKER'].includes(m.role)||!Array.isArray(m.argv)||m.argv.length!==8||m.argv[0]!=='--actor'||m.argv[1]!==m.role||m.argv[2]!=='--session'||!/^[a-f0-9]{48}$/u.test(m.argv[3])||!Gate.same(m.argv.slice(4),workerData.literal_args))Gate.fail('EXECUTOR_SPAWN_TICKET');ticket={parent:m.parent,deadline_ms:m.deadline_ms,role:m.role,entry:m.entry,executable:workerData.runtime.path,argv:m.argv,argv_sha256:Gate.hash(Gate.canonical(m.argv)),generation};parentPort.postMessage({type:'SPAWN_READY',mode,generation});return;}Gate.exact(m,['type','registry','generation']);if(mode!=='RSS'||m.type!=='REGISTRY'||!Array.isArray(m.registry)||!Number.isSafeInteger(m.generation)||m.generation<=generation)Gate.fail('EXECUTOR_MONITOR_REGISTRY');records=mergeRecords(records,m.registry);generation=m.generation;ticket=null;}catch(e){stop=true;report(e);}});
  function report(e){const alert={schema:'metadata-execution-monitor-held-v1',mode,error:safeError(e),generation,recorded_identities:records,candidates,collector_evidence:lastCollector,readback_complete:false,owned_absence_verified:false,authority:'NONE'};try{exclusiveJSON(workerData.alert_path,alert,32768);}catch{try{fs.writeSync(2,'EXECUTOR_MONITOR_DURABLE_REPORT_FAILED\n');}catch{}}parentPort.postMessage(bounded({type:'HELD',mode,error:safeError(e),candidates,collector_evidence:lastCollector}));process.exitCode=2;}
  try{while(!stop){const start=mono();if(start>workerData.deadline)Gate.fail('EXECUTOR_ACTIVE_TIME_BOUND');if(lastStart!==null&&start-lastStart>(mode==='RSS'?250:1000))Gate.fail('EXECUTOR_MONITOR_CADENCE');const gap=lastStart===null?0:start-lastStart;lastStart=start;
    let payload;
    if(mode==='RSS'){
      const r=Process.collectOwnedTree(records,{observe:pid=>Process.observeProcess(pid,{io:fs})});
      lastCollector=Ownership.collectorEvidence(r); // retain BEFORE every HOLD
      if(!lastCollector.complete_projection)Gate.fail('EXECUTOR_COLLECTOR_EVIDENCE_OMITTED');
      if(r.unregistered.length>32)Gate.fail('EXECUTOR_CANDIDATE_BOUND');
      const observations=r.unregistered.map(v=>({...Process.observeProcess(v.pid,{io:fs}),operation:Ownership.observeOperation(v.pid,{io:fs})}));
      for(const v of observations)if(!candidates.some(c=>c.pid===v.pid&&c.start_ticks===v.start_ticks)){if(candidates.length>=32)Gate.fail('EXECUTOR_CANDIDATE_BOUND');candidates.push({pid:v.pid,start_ticks:v.start_ticks??null,group:v.group??null,state:v.state,operation:Ownership.operationEvidence(v.operation),spawn_ticket:ticket});}
      const classification=Registration.registrationSample(r,{ticket,now:mono(),observations,generation});
      if(classification.hold)Gate.fail(classification.code);if(r.aggregate_rss_bytes>Gate.LIMITS.aggregate_rss_bytes)Gate.fail('EXECUTOR_RSS_BOUND');payload={records,registration_pending:classification.registration_pending,pending_candidates:classification.candidates,candidates,collector_evidence:lastCollector,aggregate_rss_bytes:r.aggregate_rss_bytes,known_rss_bytes:r.known_rss_bytes,absence_known:r.absence_known};}
    else{const r=Capacity.measureBoundedTree(Gate.FIXED_RUN,workerData.policy,{io:fs,now:mono,deadline_ms:Math.min(workerData.deadline,start+1000)});Capacity.assessCapacity(r.bytes);if(lastBytes!==null&&r.bytes<lastBytes)Gate.fail('EXECUTOR_RUN_SHRANK');lastBytes=r.bytes;payload={capacity:r};}
    const finished=mono();if(finished-start>(mode==='RSS'?250:1000))Gate.fail('EXECUTOR_MONITOR_CADENCE');parentPort.postMessage(bounded({type:'SAMPLE',mode,sequence:sequence++,generation,started_ms:start,finished_ms:finished,maximum_interval_ms:gap,...payload}));await sleep(Math.max(0,start+(mode==='RSS'?125:500)-mono()));
  }}catch(e){report(e);}
  parentPort.postMessage({type:'STOPPED',mode});parentPort.close();
}
