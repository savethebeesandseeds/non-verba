// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / SOURCE_FREE. A, external A readback, B_PREPARE stop, B, pending own-exit readback.
import {pathToFileURL} from 'node:url';
import {LIMITS,ROOT_PATTERN,check,fail,hash,canonical,immutable,checkedRef,sealConfiguration,exact} from './configuration.mjs';
import {NODE_FLAGS,observe,operation,processIdentity,readJSON,readRef,noLinks,tree,writeExclusive} from './frame-runtime.mjs';
import {createFixtureBlueprint,metadataStageA,sourceStageB} from './fixtures.mjs';
import {observePhase,resourceController} from './observer.mjs';

export const RUN='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
const INFRA=RUN+'/qa/v15-current874-component-preparation-20261016/historical-component-inventory-v1/historical154-metadata-gzip-recovery-v1/';
export const CAPACITY_REFS=Object.freeze({helper:{path:INFRA+'run-capacity-helper-v3.mjs',sha256:'2a7b5a7c21ce70666d71508892d55fc932da3968e98dc4da5fe598d668580b6e',bytes:7103},policy:{path:INFRA+'run-capacity-policy-v3.json',sha256:'0768b25042d2454c030d08ae8a390baa7bc075a73cbf20234aa5caabfdc22cdc',bytes:2285}});
const RUNTIME={path:'/opt/nonverba-tools/node/bin/node',sha256:'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48',bytes:124827920};
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export function validateRunPlan(value){
  const p=immutable(value);exact(p,['schema','source_kind','root','epoch_id','runtime_ref','node_flags','source_refs','source_epoch_ref','orchestration_ref','supervisor_ref','worker_ref','frame_runtime_ref','driver_ref','capacity_helper_ref','capacity_policy_ref','admission_ref','initial_cost','actual_authority','authority']);
  check(p.schema==='ROOT_SOURCE_FREE_TYPED_OWNED_RUN_PLAN_V1'&&p.source_kind==='SOURCE_FREE_FIXTURE'&&ROOT_PATTERN.test(p.root)&&/^[A-Za-z0-9_-]{1,80}$/u.test(p.epoch_id)&&p.actual_authority===false&&p.authority==='NONE','TYPED_RUN_SOURCE_FREE_ONLY');
  check(canonical(p.runtime_ref)===canonical(RUNTIME)&&canonical(p.node_flags)===canonical(NODE_FLAGS)&&canonical(p.capacity_helper_ref)===canonical(CAPACITY_REFS.helper)&&canonical(p.capacity_policy_ref)===canonical(CAPACITY_REFS.policy),'TYPED_RUN_FIXED_INFRASTRUCTURE');
  check(Array.isArray(p.source_refs)&&p.source_refs.length>0&&p.source_refs.length<=256&&new Set(p.source_refs.map(r=>r.path)).size===p.source_refs.length,'TYPED_RUN_SOURCE_SET');
  for(const ref of p.source_refs){checkedRef(ref,{max:262144});check(/^(?:\/tmp\/nonverba-unified-source\/[a-f0-9]{32}\/code\/|\/opt\/nonverba-tools\/priors-derivation-0\.1\/node_modules\/(?:parse5|entities)\/)/u.test(ref.path),'TYPED_RUN_SNAPSHOT');}
  for(const key of['orchestration_ref','supervisor_ref','worker_ref','frame_runtime_ref','driver_ref'])check(p.source_refs.some(r=>canonical(r)===canonical(p[key])),'TYPED_RUN_ENTRY_PIN');
  checkedRef(p.source_epoch_ref,{prefix:p.root,max:262144});check(p.source_epoch_ref.path===p.root+'/control/source-epoch.json','TYPED_RUN_EPOCH_PATH');
  checkedRef(p.admission_ref,{max:262144});check(p.admission_ref.path===RUN+'/qa/literal-emphasis-parent-v1-typed-owned-preparation-v1/ROOT-source-free-admission-v4.json','TYPED_RUN_ADMISSION_PATH');
  exact(p.initial_cost,['active_elapsed_ms','admitted_output_bytes']);check(Number.isSafeInteger(p.initial_cost.active_elapsed_ms)&&p.initial_cost.active_elapsed_ms>=LIMITS.failed_active_carry_ms&&p.initial_cost.active_elapsed_ms<LIMITS.active_ms&&p.initial_cost.admitted_output_bytes===LIMITS.retained_preparation_bytes+LIMITS.failed_execution_prefix_bytes,'TYPED_RUN_NO_COST_RESET');
  return p;
}
export function phaseInputs(manifest){
  const refs=manifest.input_refs.map(r=>r.stored_ref);
  if(manifest.phase==='B'){for(const entry of manifest.source_entries)refs.push(entry.cache_ref,entry.receipt_ref,entry.raw_ref,entry.normalized_ref,entry.native_artifact_ref);for(const model of manifest.model_bindings.models)refs.push(...model.files);}
  const unique=new Map();for(const r of refs){const old=unique.get(r.path);check(!old||canonical(old)===canonical(r),'TYPED_RUN_INPUT_COLLISION');unique.set(r.path,r);}return[...unique.values()];
}
function refOf(caps,file,max=8388608,{allowEmpty=false}={}){const stat=noLinks(caps,file);check(stat.isFile()&&(allowEmpty?stat.size>=0:stat.size>0)&&stat.size<=max,'TYPED_RUN_OUTPUT_STAT');const fd=caps.fs.openSync(file,caps.constants.O_RDONLY|caps.constants.O_NOFOLLOW|caps.constants.O_NONBLOCK);let bytes;try{const before=caps.fs.fstatSync(fd);check(before.dev===stat.dev&&before.ino===stat.ino&&before.size===stat.size,'TYPED_RUN_OUTPUT_IDENTITY');bytes=Buffer.alloc(stat.size);let at=0;while(at<bytes.length){const n=caps.fs.readSync(fd,bytes,at,bytes.length-at,at);check(n>0,'TYPED_RUN_OUTPUT_SHORT');at+=n;}const after=caps.fs.fstatSync(fd);check(caps.fs.readSync(fd,Buffer.alloc(1),0,1,at)===0&&before.dev===after.dev&&before.ino===after.ino&&before.size===after.size,'TYPED_RUN_OUTPUT_CHANGED');}finally{caps.fs.closeSync(fd);}return{path:file,bytes:bytes.length,sha256:hash(bytes)};}
function journalWriter(caps,root,phase){let rows=0,bytes=0;const file=root+'/observer/'+phase+'.journal.ndjson',fd=caps.fs.openSync(file,caps.constants.O_CREAT|caps.constants.O_EXCL|caps.constants.O_WRONLY|caps.constants.O_NOFOLLOW,0o600);return{write(lease){const row=Buffer.from(JSON.stringify({index:rows,phase,kind:'ROOT_RESOURCE_LEASE',generation:lease.generation,actors:lease.actors,unadmitted_resource_candidates:lease.unadmitted_resource_candidates,rss_started_ms:lease.rss_started_ms,capacity_started_ms:lease.capacity_started_ms,sample:lease.sample})+'\n');check(row.length<=LIMITS.journal_row_bytes&&rows+1<=LIMITS.journal_rows&&bytes+row.length<=LIMITS.journal_bytes&&tree(caps,root).bytes+row.length<=LIMITS.additional_bytes,'TYPED_RUN_JOURNAL_BOUND');caps.fs.writeFileSync(fd,row);caps.fs.fsyncSync(fd);rows++;bytes+=row.length;},close(){caps.fs.closeSync(fd);return refOf(caps,file,LIMITS.journal_bytes,{allowEmpty:true});}};}

export async function runOwnedStudy(rawPlan,planRef,caps){
  const plan=validateRunPlan(rawPlan),originNs=caps.entry_started_ns,initialCarry=plan.initial_cost.active_elapsed_ms;
  check(caps.capturedBeforeProjectImports===true&&caps.captureDescriptors.length===2,'TYPED_RUN_CAPTURE_REQUIRED');
  const self=observe(caps,caps.pid);check(self.state==='LIVE','TYPED_RUN_SELF_UNKNOWN');const observer=processIdentity(self),op=operation(caps,caps.pid);check(op.state==='LIVE','TYPED_RUN_SELF_OPERATION');
  const epoch=readJSON(caps,plan.source_epoch_ref);check(canonical(epoch)===canonical({schema:'typed-owned-source-epoch-v1',source_kind:'SOURCE_FREE_FIXTURE',source_refs:plan.source_refs,runtime_ref:plan.runtime_ref,node_flags:NODE_FLAGS,authority:'NONE'}),'TYPED_RUN_SOURCE_EPOCH');
  const admission=readJSON(caps,plan.admission_ref);check(admission.schema==='ROOT_TYPED_OWNED_SOURCE_FREE_ADMISSION_V1'&&admission.status==='ADMITTED_SOURCE_FREE_ONLY'&&admission.root===plan.root&&canonical(admission.source_epoch_ref)===canonical(plan.source_epoch_ref)&&admission.preparation_reserved_bytes===LIMITS.retained_preparation_bytes&&admission.failed_execution_prefix_bytes===LIMITS.failed_execution_prefix_bytes&&admission.additional_output_ceiling===LIMITS.additional_bytes&&admission.actual_authority===false&&admission.authority==='NONE','TYPED_RUN_ROOT_ADMISSION');
  readRef(caps,plan.capacity_helper_ref,262144);const capacityPolicy=readJSON(caps,plan.capacity_policy_ref);
  const {measureRunCapacity}=await import(pathToFileURL(plan.capacity_helper_ref.path).href);
  const capacityProbe=()=>measureRunCapacity(RUN,capacityPolicy,{io:caps.fs});
  const elapsed=()=>initialCarry+Number((caps.nowNs()-BigInt(originNs)+999999n)/1000000n);
  const cost=()=>{const owned=tree(caps,plan.root);check(elapsed()<=LIMITS.active_ms,'TYPED_RUN_ACTIVE_BOUND');return{active_elapsed_ms:elapsed(),admitted_output_bytes:Math.max(plan.initial_cost.admitted_output_bytes,LIMITS.retained_preparation_bytes+LIMITS.failed_execution_prefix_bytes+owned.bytes)};};
  const journals=[],prepJournal=journalWriter(caps,plan.root,'PREPARE');
  const preparation=resourceController(caps,{root:plan.root,observer,prior_cost:plan.initial_cost},{capacityProbe,originNs,initialCarry,onSample:l=>prepJournal.write(l)});
  const materialize=async stage=>{for(let i=0;i<stage.entries.length;i++){if(i%16===0)await preparation.sample();const entry=stage.entries[i];check(entry.relative.startsWith('fixture/'),'TYPED_RUN_FIXTURE_RELATIVE');writeExclusive(caps,plan.root,entry.relative,entry.bytes);}await preparation.sample();return refOf(caps,plan.root+'/fixture/manifest.'+stage.manifest.phase+'.json',262144);};
  const hardDeadline=BigInt(originNs)+BigInt(LIMITS.active_ms-initialCarry)*1000000n;
  // Five seconds of the original allowance remain available for bounded joins/readback.
  const workDeadline=hardDeadline-BigInt(LIMITS.join_ms)*1000000n;
  const phaseConfig=(phase,stage,manifestRef,Aref=null)=>{const prior=cost(),start=caps.nowNs();check(start<workDeadline,'TYPED_RUN_NO_WORK_TIME');return sealConfiguration({schema:'typed-owned-phase-config-v1',source_kind:'SOURCE_FREE_FIXTURE',phase,root:plan.root,epoch_id:plan.epoch_id,nonce:hash(planRef.sha256+phase+String(start)),runtime_ref:plan.runtime_ref,source_epoch_ref:plan.source_epoch_ref,source_refs:plan.source_refs,supervisor_ref:plan.supervisor_ref,worker_ref:plan.worker_ref,frame_runtime_ref:plan.frame_runtime_ref,driver_ref:plan.driver_ref,fixture_manifest_ref:manifestRef,input_refs:phaseInputs(stage.manifest),expected_ids:stage.manifest.expected_ids,expected_case_ids:stage.manifest.expected_case_ids,metadata_source_sha256:stage.manifest.metadata_source_sha256,guard_sha256:stage.manifest.guard_sha256,prior_cost:prior,phase_start_ns:String(start),deadline_ns:String(workDeadline),observer,observer_operation_sha256:op.argv_sha256,observer_capture_refs:caps.captureDescriptors,limits:LIMITS,A_external_checkpoint_ref:Aref});};
  let result;
  try{
    await preparation.sample();
    const blueprint=await createFixtureBlueprint({root:plan.root,epoch_id:plan.epoch_id,onBoundary:()=>preparation.sample()});
    const stageA=metadataStageA(blueprint,plan.root),manifestA=await materialize(stageA),configA=phaseConfig('A',stageA,manifestA),configARef=writeExclusive(caps,plan.root,'control/phase-A.config.json',json(configA),262144);
    const journalA=journalWriter(caps,plan.root,'A');let A;
    try{A=await observePhase(caps,configA,configARef,{capacityProbe,originNs,initialCarry,onSample:l=>journalA.write(l),refOf:file=>refOf(caps,file,262144)});}finally{journals.push(journalA.close());}
    const externalA=readJSON(caps,A.checkpoint_ref),rosterRef=externalA.typed_roster_ref;readRef(caps,rosterRef,262144);
    // A durable stop point exists before any B source/model file is materialized.
    const stopRef=writeExclusive(caps,plan.root,'control/B_PREPARE.stop.json',json({schema:'typed-owned-B-PREPARE-stop-v1',status:'A_EXIT_READBACK_ISSUED_B_SOURCE_NOT_MATERIALIZED',source_kind:'SOURCE_FREE_FIXTURE',external_A_checkpoint_ref:A.checkpoint_ref,typed_roster_ref:rosterRef,cumulative_cost:cost(),actual_authority:false,authority:'NONE'}),262144);
    const stageB=sourceStageB(blueprint,plan.root,A.token,rosterRef),manifestB=await materialize(stageB),configB=phaseConfig('B',stageB,manifestB,A.checkpoint_ref),configBRef=writeExclusive(caps,plan.root,'control/phase-B.config.json',json(configB),262144);
    const journalB=journalWriter(caps,plan.root,'B');let B;
    try{B=await observePhase(caps,configB,configBRef,{capacityProbe,originNs,initialCarry,onSample:l=>journalB.write(l),refOf:file=>refOf(caps,file,262144)});}finally{journals.push(journalB.close());}
    await preparation.sample();
    const proofB=readJSON(caps,B.proof_ref),indexRef=proofB.output_refs.find(r=>r.path===plan.root+'/phases/B/outputs/typed-case-index.json');check(indexRef,'TYPED_RUN_TYPED_INDEX_MISSING');const index=readJSON(caps,indexRef);check(index.status==='COMPLETE_SOURCE_FREE_PREPARATION_ONLY'&&index.counts?.terminal===69&&index.counts.prepared_available===67&&index.counts.failed_available===0&&index.counts.unavailable_controls===2,'TYPED_RUN_FULL_PREPARATION_REQUIRED');
    result={schema:'typed-owned-root-run-terminal-v1',status:'COMPLETE_PENDING_ROOT_PROCESS_EXIT_READBACK',source_kind:'SOURCE_FREE_FIXTURE',plan_ref:planRef,source_epoch_ref:plan.source_epoch_ref,observer,root_capture_before_project_imports:true,A_external_checkpoint_ref:A.checkpoint_ref,B_PREPARE_stop_ref:stopRef,B_external_proof_ref:B.proof_ref,typed_case_index_ref:indexRef,protocol_cases:69,prepared_available:67,unavailable_controls:2,prospective_streams:268,cumulative_cost_sample:cost(),original_RUN_floor:LIMITS.RUN_floor,original_growth_baseline:LIMITS.growth_baseline,root_own_exit_claimed:false,actual_authority:false,quality_gate_pass:false,source_qualification:false,authority:'NONE'};
  }finally{journals.push(prepJournal.close());}
  for(const ref of journals)readRef(caps,ref,LIMITS.journal_bytes,{allowEmpty:true});
  const terminalRef=writeExclusive(caps,plan.root,'observer/run-terminal.json',json({...result,resource_journal_refs:journals}),262144);
  readJSON(caps,terminalRef);const after=cost(),last=preparation.last();check(last&&caps.now()-last.rss_started_ms<=LIMITS.rss_age_ms&&caps.now()-last.capacity_started_ms<=LIMITS.capacity_age_ms,'TYPED_RUN_FINAL_RESOURCE_STALE');check(after.admitted_output_bytes<=LIMITS.pilot_bytes&&caps.nowNs()<=hardDeadline,'TYPED_RUN_FINAL_COST');
  writeExclusive(caps,plan.root,'observer/exit-pending.json',json({schema:'typed-owned-root-exit-pending-v1',status:'PENDING_EXTERNAL_ROOT_PROCESS_EXIT_READBACK',terminal_ref:terminalRef,observer,origin_ns:originNs,initial_cost:plan.initial_cost,final_sample_before_own_exit:after,hard_deadline_ns:String(hardDeadline),source_kind:'SOURCE_FREE_FIXTURE',actual_authority:false,authority:'NONE'}),262144);
  return immutable(result);
}
export function actualRun(){fail('TYPED_RUN_ACTUAL_CLOSED');}
