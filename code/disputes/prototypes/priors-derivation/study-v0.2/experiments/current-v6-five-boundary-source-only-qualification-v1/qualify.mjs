// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE. Dormant successor of the existing five-boundary qualification.
// The existing verifier, not whole-corpus equality, qualifies five direct readings.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const ROOT_ACTIVATED = true;
export const RUN = '/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
export const SNAPSHOT = '/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code';
export const SOURCE = '82a3dab1396336edccf77f27a7800cccddff67ca928e919e824a663e1d563601';
export const OLD194 = '194e51d54ddb39cb1ab67981af463c542531f2da0eebf98039aa47f130464f22';
export const QA = 'qa/current-v6-five-boundary-source-only-qualification-20261018-v1';
export const MODE = 'QUALIFIED_SOURCE_ONLY_PRIOR_ACTUAL_READING';
const LIB = SNAPSHOT + '/disputes/prototypes/priors-derivation/study-v0.2/lib/';
const Q = RUN + '/' + QA;
export const INPUTS = {
  "epoch": {"path":"qa/current-v6-calibration-refresh-20261018-v1/source-epoch.json","sha256":"1b33359ad35f7e14a1326d7de7748001f204e309bf6f54ddbec2a43178aadc16","bytes":6798},
  "manifest": {"path":"processing/82a3dab1396336ed/calibration-1000-cea0eeae0bf69647/extraction-manifest.json","sha256":"7726139476a239ded60b75a25ec033d51569f53556020739ae28c86835ad7b13","bytes":5179014},
  "comparison": {"path":"qa/current-v6-extraction-equivalence-20261018-v1/comparison/result.json","sha256":"2365f9f9604b2e63fe03c336675038cf7c9682104ec1d63ae71ddeb6c99b1a61","bytes":4357},
  "comparison_attestation": {"path":"qa/current-v6-extraction-equivalence-20261018-v1/ROOT-native-zero-attestation.json","sha256":"6ab57dfafc1c768a826f970d977e3ad977c7a2905d92595e595acb2fe0319acd","bytes":473},
  "fresh_guard": {"path":"qa/literal-emphasis-actualA-metadata-engineering-20261017-bound80-v8/execution/complete-fresh-guard.json","sha256":"0a578b37ff01716daf9c4d68b8d446b5e79e2ffc36b22f55dd38e5f4428f2996","bytes":12856},
  "old_result": {"path":"qa/current194-five-boundary-source-only-qualification-20261018-v1/result.json","sha256":"8a313225751e2d52274f79c793822e6dec2c8b62d8ecf6ea4fb695749b5340c8","bytes":6936},
  "old_worker": {"path":"qa/current194-five-boundary-source-only-qualification-20261018-v1/qualify.mjs","sha256":"1e23c525befb803913b00d5f4daadd2b5ff042aaa6d8755af05355806052289c","bytes":7479},
  "source_issues_module": {"path":"/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2/lib/source-issues.mjs","sha256":"4d793126a6c2ba23fe906ace1b3c22f9b2d253056867a4c06e82a078b5e8bff4","bytes":63758}
};
export const ROSTER = [
  {"issue_id":"67532c9d78500cf20cd6892e9f8d289af92ded6f97631957e0b33c5a30def7dc","contract_id":"contract-c77a5e4c4a467c2e8ff2","audit_id":"coding-0133","issue":{"path":"source-issues/observed/issue-67532c9d78500cf20cd6892e9f8d289af92ded6f97631957e0b33c5a30def7dc.json","sha256":"a8597893af300fc0c5eb0deff1eb14453d08b2411da60bd1682daac56ced997d","bytes":1584},"old_replay":{"path":"qa/current194-five-boundary-source-only-qualification-20261018-v1/replay-issue-67532c9d78500cf20cd6892e9f8d289af92ded6f97631957e0b33c5a30def7dc.json","sha256":"e1c90e0c0001e0dc578bae23b64a283015f3d0b2a58260d7f64979e7fd579f52","bytes":3974},"old_resolution":{"path":"source-issues/resolutions/194e51d54ddb39cb1ab67981af463c542531f2da0eebf98039aa47f130464f22/issue-67532c9d78500cf20cd6892e9f8d289af92ded6f97631957e0b33c5a30def7dc.json","sha256":"8daec548849accde6a0c15b87ee47a1a1dd622a2bd05308fe5073d1878bd65c8","bytes":5077},"direct_actual_root":{"path":"source-issues/replays/fab5530e8af2c39c/root-c133-compound-vesting-tables-v10.json","sha256":"80d449c21788358c34bf65061fae4b4217b9c4bd5c7b3c14ff783eedfb007c63","bytes":3585}},
  {"issue_id":"a40585b2897a9f6e5eb93e0fef26b92623d87319ea793b77b0ec8b3a4eb396e9","contract_id":"contract-cc26fc55f8a1f7ad9def","audit_id":"development-0013","issue":{"path":"source-issues/observed/issue-a40585b2897a9f6e5eb93e0fef26b92623d87319ea793b77b0ec8b3a4eb396e9.json","sha256":"d9c0bc7c54695cd66a2bbfab21a1680b52579ce7004ffb71805e4b4694627526","bytes":3093},"old_replay":{"path":"qa/current194-five-boundary-source-only-qualification-20261018-v1/replay-issue-a40585b2897a9f6e5eb93e0fef26b92623d87319ea793b77b0ec8b3a4eb396e9.json","sha256":"8f76f8be7b3bf29d4690469662d12e4368ae09ea2edcc89e03f65e4a1d91e0ec","bytes":4486},"old_resolution":{"path":"source-issues/resolutions/194e51d54ddb39cb1ab67981af463c542531f2da0eebf98039aa47f130464f22/issue-a40585b2897a9f6e5eb93e0fef26b92623d87319ea793b77b0ec8b3a4eb396e9.json","sha256":"aa67ce33cc1078e160d648770458c6afd4817b1ef20d5e10cac3eff6864756c1","bytes":5293},"direct_actual_root":{"path":"source-issues/replays/author-c13-license-v10.json","sha256":"8c0e2f51102f6de6ebf1554f7c91bfc4209550da80f81b4d34c1af806c6a033a","bytes":5340}},
  {"issue_id":"a8d129f17bd43aff0b60b211ebf4fad0e27f7dd5762ce2ee1182d178de79cd8d","contract_id":"contract-f1ada4c1a04d7c8d92d8","audit_id":"technical-attachment-reference-list-0096","issue":{"path":"source-issues/observed/issue-a8d129f17bd43aff0b60b211ebf4fad0e27f7dd5762ce2ee1182d178de79cd8d.json","sha256":"adcf9920850767cecb4fb43b603d8e5a097cbb37d3f436efc5d5f6468dd6f8d7","bytes":2071},"old_replay":{"path":"qa/current194-five-boundary-source-only-qualification-20261018-v1/replay-issue-a8d129f17bd43aff0b60b211ebf4fad0e27f7dd5762ce2ee1182d178de79cd8d.json","sha256":"711162a2075921b32363849bda74924e2c4208cf378547ccf6d67905c6427397","bytes":3825},"old_resolution":{"path":"source-issues/resolutions/194e51d54ddb39cb1ab67981af463c542531f2da0eebf98039aa47f130464f22/issue-a8d129f17bd43aff0b60b211ebf4fad0e27f7dd5762ce2ee1182d178de79cd8d.json","sha256":"3cfa1e87330e3eb7d602a77017ac41255d9a9964d1e36361000704a37a17fff7","bytes":4775},"direct_actual_root":{"path":"source-issues/replays/bf4edd04ec842a5c/root-attachment-reference-list-v12.json","sha256":"4d1bc1d8926d87d86bd7e2e42818257f5182bd4ab65c1d7fc9a2e39e2945b852","bytes":3272}},
  {"issue_id":"e07ac0b1bd20983f262ec846734b848aa202c501489abacc9bd5b93b830da7bc","contract_id":"contract-c07dc12c0ca8cbffea62","audit_id":"coding-0010","issue":{"path":"source-issues/observed/issue-e07ac0b1bd20983f262ec846734b848aa202c501489abacc9bd5b93b830da7bc.json","sha256":"894cf357950d7c16ae2f4e3740ed436b8f94e50f03f2959cfc51d907ddbd102e","bytes":2514},"old_replay":{"path":"qa/current194-five-boundary-source-only-qualification-20261018-v1/replay-issue-e07ac0b1bd20983f262ec846734b848aa202c501489abacc9bd5b93b830da7bc.json","sha256":"61cb0ea495d909fbd441a7879dcdf600ac682ec8e8a9a1c79dfbfe73b41dfc2f","bytes":3789},"old_resolution":{"path":"source-issues/resolutions/194e51d54ddb39cb1ab67981af463c542531f2da0eebf98039aa47f130464f22/issue-e07ac0b1bd20983f262ec846734b848aa202c501489abacc9bd5b93b830da7bc.json","sha256":"d61105cc69b73a270a661c557bceb961da8385ac1046d602cb4d62cd5b11a9ec","bytes":4209},"direct_actual_root":{"path":"source-issues/replays/fab5530e8af2c39c/root-c07-construction-v10.json","sha256":"7641f5461eedce288c3f0efa03d8374811cd112a771671b608658fd66080f52d","bytes":2736}},
  {"issue_id":"e88a40a6b9f6372054cd4aadae6176ab102736dfd973b656d4efe4834b8d7006","contract_id":"contract-45ac30084126ee880e85","audit_id":"development-0129","issue":{"path":"source-issues/observed/issue-e88a40a6b9f6372054cd4aadae6176ab102736dfd973b656d4efe4834b8d7006.json","sha256":"5cf17676957e3f5fc852443cfea7e0e7321592fb64c7397f185e5a7d042aae39","bytes":1695},"old_replay":{"path":"qa/current194-five-boundary-source-only-qualification-20261018-v1/replay-issue-e88a40a6b9f6372054cd4aadae6176ab102736dfd973b656d4efe4834b8d7006.json","sha256":"99c6f96da357a918e70130998905e9f14a7ac177f5cc076cdfd7f665ff819a50","bytes":3838},"old_resolution":{"path":"source-issues/resolutions/194e51d54ddb39cb1ab67981af463c542531f2da0eebf98039aa47f130464f22/issue-e88a40a6b9f6372054cd4aadae6176ab102736dfd973b656d4efe4834b8d7006.json","sha256":"986c4dcedab7fe5a953a8fb2552196401856c647830537cf0a35b25a17ad070b","bytes":4590},"direct_actual_root":{"path":"source-issues/replays/fab5530e8af2c39c/root-c129-confidentiality-v10.json","sha256":"9d70a4f38a003861131d5dcbefa1264abcbad960a22ee0d8f8a0d5cdc4e620d2","bytes":3110}}
];
export const NATIVE_METADATA_ONLY = {
  "issue":{"path":"source-issues/observed/issue-64f380e2905f0af04ea743dc80e980fde64aaf6fd857f0ab2929c2560938c1e2.json","sha256":"b5371c00eac40f7c94df961af1229b423c663a324086a1e4955a8c008619acac","bytes":10626},
  "contract_id":"contract-129f8dcc32ad546ab6b6","audit_id":"coding-0099","classification":"MATERIAL_NATIVE_CHANGE_MARKUP"
};
export const LIMITS = {
  "elapsed_ms":120000,"node_heap_mb":512,"sampled_rss_bytes":1073741824,
  "qa_bytes":2097152,"assigned_output_bytes":4194304,"artifact_bytes":131072,
  "metadata_reserve_bytes":65536,"api_transient_reserve_bytes":262144,
  "source_copy_bytes":65536,"api_invocations":5,"tokenizer_callbacks":0,"model_inferences":0
};
const H = b => createHash('sha256').update(b).digest('hex');
const C = v => Array.isArray(v) ? '['+v.map(C).join(',')+']' : v && typeof v==='object' ? '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+C(v[k])).join(',')+'}' : JSON.stringify(v);
const D = v => H(C(v)), same = (a,b) => C(a)===C(b);
const integer = (n,a,b) => Number.isSafeInteger(n)&&n>=a&&n<=b;
const check = (ok,code='BOUNDARYV6_BINDING') => { if(!ok) throw Object.assign(Error(code),{code}); };
const safe = e => typeof e?.code==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/u.test(e.code) ? e.code : 'BOUNDARYV6_EXISTING_VERIFIER_REFUSED';
const exact = (a,b) => a?.path===b.path&&a.sha256===b.sha256&&a.bytes===b.bytes;
const absoluteRef = r => ({...r,path:RUN+'/'+r.path});
let origin=null, admitted=false, stage='INACTIVE', sticky=null, samples=0, peakRSS=0, peakHeap=0, completed=[], apiCalls=0;
const elapsed = () => origin===null ? 0 : Number(process.hrtime.bigint()-origin)/1e6;
function checkpoint() {
  if(origin===null) return;
  const m=process.memoryUsage(); samples++; peakRSS=Math.max(peakRSS,m.rss); peakHeap=Math.max(peakHeap,m.heapUsed);
  if(elapsed()>LIMITS.elapsed_ms) sticky='BOUNDARYV6_DEADLINE';
  if(m.rss>LIMITS.sampled_rss_bytes||m.heapUsed>LIMITS.node_heap_mb*1024**2) sticky='BOUNDARYV6_MEMORY';
  check(!sticky,sticky);
}
function stat(p) {
  check(path.resolve(p)===p,'BOUNDARYV6_PATH'); let at='/';
  for(const part of p.split('/').filter(Boolean)) { at=path.join(at,part); const s=fs.lstatSync(at); check(!s.isSymbolicLink()&&(at===p||s.isDirectory()),'BOUNDARYV6_LINK'); }
  return fs.lstatSync(p);
}
function resolve(p) {
  if(p.startsWith('/')) { check(p.startsWith(RUN+'/')||p.startsWith(SNAPSHOT+'/'),'BOUNDARYV6_PATH'); return p; }
  check(!p.split('/').includes('..'),'BOUNDARYV6_PATH'); const target=path.resolve(RUN,p); check(target.startsWith(RUN+'/'),'BOUNDARYV6_PATH'); return target;
}
function read(ref,max=16*1024**2) {
  checkpoint(); check(ref&&typeof ref.path==='string'&&/^[a-f0-9]{64}$/u.test(ref.sha256)&&integer(ref.bytes,1,max),'BOUNDARYV6_REFERENCE');
  const p=resolve(ref.path); stat(p); const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try {
    const before=fs.fstatSync(fd); check(before.isFile()&&before.nlink===1&&before.size===ref.bytes,'BOUNDARYV6_FILE'); const bytes=Buffer.alloc(before.size);
    for(let n=0;n<bytes.length;) { checkpoint(); const count=fs.readSync(fd,bytes,n,Math.min(65536,bytes.length-n),n); check(count>0,'BOUNDARYV6_SHORT_READ'); n+=count; }
    const after=fs.fstatSync(fd); check(after.dev===before.dev&&after.ino===before.ino&&after.size===before.size&&after.mode===before.mode&&after.nlink===1&&H(bytes)===ref.sha256,'BOUNDARYV6_PIN'); checkpoint(); return bytes;
  } finally { fs.closeSync(fd); }
}
const json = ref => JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(read(ref)));
function qaBytes() {
  let bytes=stat(Q).size;
  for(const entry of fs.readdirSync(Q,{withFileTypes:true})) { const s=stat(Q+'/'+entry.name); check(entry.isFile()&&s.isFile()&&s.nlink===1,'BOUNDARYV6_QA_ENTRY'); bytes+=s.size; }
  return bytes;
}
const resolutionPath = row => RUN+'/source-issues/resolutions/'+SOURCE+'/issue-'+row.issue_id+'.json';
function assignedBytes() {
  let bytes=qaBytes(); const dirs=new Set();
  for(const row of ROSTER) {
    const p=resolutionPath(row); let s;
    try { s=stat(p); } catch(e) { if(e.code!=='ENOENT') throw e; }
    if(s) { check(s.isFile()&&s.nlink===1&&s.size<=LIMITS.artifact_bytes,'BOUNDARYV6_RESOLUTION_BOUND'); bytes+=s.size; }
    dirs.add(path.dirname(p));
  }
  for(const dir of dirs) { try { const s=stat(dir); check(s.isDirectory(),'BOUNDARYV6_OUTPUT_DIR'); bytes+=s.size; } catch(e) { if(e.code!=='ENOENT') throw e; } }
  return bytes;
}
function outputGuard(extra=0) {
  check(qaBytes()+extra+LIMITS.metadata_reserve_bytes<=LIMITS.qa_bytes,'BOUNDARYV6_QA_BOUND');
  check(assignedBytes()+extra+LIMITS.api_transient_reserve_bytes+LIMITS.metadata_reserve_bytes<=LIMITS.assigned_output_bytes,'BOUNDARYV6_ASSIGNED_OUTPUT_BOUND');
}
function put(name,value,{held=false}={}) {
  if(!held) checkpoint(); check(/^[a-z0-9][a-z0-9.-]*$/u.test(name),'BOUNDARYV6_OUTPUT_NAME');
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'); check(bytes.length<=LIMITS.artifact_bytes,'BOUNDARYV6_ARTIFACT_BOUND'); outputGuard(bytes.length);
  const fd=fs.openSync(Q+'/'+name,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try { fs.writeFileSync(fd,bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return {path:QA+'/'+name,sha256:H(bytes),bytes:bytes.length};
}
function freshGuard() {
  const g=json(INPUTS.fresh_guard),{projection_sha256,...body}=g;
  check(g.schema==='stored-reader-complete-fresh100-guard-v1'&&D(body)===projection_sha256&&g.rows?.length===100&&g.contract_ids?.length===29&&new Set(g.rows.map(r=>r.audit_id)).size===100&&new Set(g.rows.map(r=>r.contract_id)).size===29&&same([...new Set(g.rows.map(r=>r.contract_id))].sort(),[...g.contract_ids].sort()),'BOUNDARYV6_FRESH_GUARD');
  return g;
}
function registryPreflight() {
  const guard=freshGuard(), roster=[NATIVE_METADATA_ONLY,...ROSTER.map(row=>({issue:row.issue,contract_id:row.contract_id,audit_id:row.audit_id,classification:'MATERIAL_BOUNDARY'}))];
  const dir=RUN+'/source-issues/observed'; stat(dir); const names=fs.readdirSync(dir,{withFileTypes:true});
  // Check names first. Never open an unexpected registry entry to learn its CID.
  check(names.length===6&&names.every(e=>e.isFile())&&same(names.map(e=>e.name).sort(),roster.map(r=>path.basename(r.issue.path)).sort()),'BOUNDARYV6_REGISTRY_MEMBERSHIP');
  for(const row of roster) {
    check(!guard.contract_ids.includes(row.contract_id),'BOUNDARYV6_PROTECTED_CID'); const issue=json(row.issue);
    check(issue.contract_id===row.contract_id&&issue.audit_id===row.audit_id&&issue.classification===row.classification,'BOUNDARYV6_REGISTRY_IDENTITY');
  }
  return guard;
}
function preservedContext(origin) {
  const keys=['reason','epistemic_limits','limits','limitations','scope','contextual_limits','source_availability_limits','review_scope','source_hierarchy_verified','source_quality_gate_passed','adopted','execution_attested'];
  return Object.fromEntries(keys.filter(key=>Object.hasOwn(origin,key)).map(key=>[key,structuredClone(origin[key])]));
}
function plan(row) {
  const old=json(row.old_replay), resolution=json(row.old_resolution), direct=json(row.direct_actual_root);
  check(old.schema==='source-issue-replay-v1'&&old.contract_id===row.contract_id&&old.review_mode===MODE&&old.newly_read_current_version===false&&exact(old.issue,row.issue)&&exact(old.prior_actual_replay,row.direct_actual_root),'BOUNDARYV6_OLD_QUALIFICATION');
  check(resolution.status==='RESOLVED_FOR_EXACT_SOURCE'&&resolution.extraction_source_sha256===OLD194&&exact(resolution.issue,row.issue)&&exact(resolution.replay,row.old_replay)&&resolution.qualification?.review_mode===MODE&&exact(resolution.qualification.prior_actual_replay,row.direct_actual_root),'BOUNDARYV6_OLD_RESOLUTION');
  check(direct.schema==='source-issue-replay-v1'&&direct.contract_id===row.contract_id&&direct.issue?.path===row.issue.path&&direct.issue.sha256===row.issue.sha256&&(direct.issue.bytes===undefined||direct.issue.bytes===row.issue.bytes)&&[undefined,'NEW_ACTUAL_CURRENT_VERSION_READING'].includes(direct.review_mode)&&direct.newly_read_current_version!==false&&['prior_actual_replay','prior_reading','qualification'].every(k=>!Object.hasOwn(direct,k)),'BOUNDARYV6_NOT_DIRECT_ORIGINAL');
  check(same(old.parent,direct.parent)&&same(old.raw,direct.raw)&&same(old.focal??null,direct.focal??null)&&same(old.raw_literal_matching_policy??null,direct.raw_literal_matching_policy??null),'BOUNDARYV6_PRIOR_SCOPE_CHANGED');
  const limits=old.contextual_limits;
  check(limits?.scope==='PRIOR_ACTUAL_PARENT_AND_DECLARED_RAW_RANGES_ONLY'&&['heading_reviewed','navigation_reviewed','whole_cache_read','new_body_read'].every(k=>limits[k]===false),'BOUNDARYV6_PRIOR_CONTEXT_LIMITS');
  const replay=structuredClone(old); delete replay.current194_qualification_basis;
  replay.extraction_manifest=INPUTS.manifest; replay.prior_actual_replay=row.direct_actual_root;
  replay.reviewer='ROOT-current-v6-source-only-prior-actual-qualification';
  replay.reason='Source-only qualification through the existing verifier preserves the direct original actual parent and declared raw reading intervals and all original limitations. No new body, heading, navigation, native-window or whole-cache reading is claimed.';
  replay.current_v6_qualification_basis={mode:'EXISTING_BUILT_IN_PRIOR_ACTUAL_REPLAY_VERIFIER',direct_original_actual_replay:row.direct_actual_root,historical_current194_qualification:row.old_replay,historical_current194_resolution:row.old_resolution,source_epoch:INPUTS.epoch,comparison_metadata:INPUTS.comparison,comparison_is_not_reading_qualification:true,original_contextual_declarations:preservedContext(direct),old_records_unchanged:true};
  replay.authority='NONE'; return {row,replay};
}
const observations = () => ({elapsed_ms:elapsed(),samples,peak_checkpoint_rss:peakRSS,peak_checkpoint_heap:peakHeap,continuous_resource_guarantee:false,physical_total_input_reads_not_metered:true});
async function main() {
  check(ROOT_ACTIVATED,'BOUNDARYV6_INACTIVE_ROOT_REVIEW_REQUIRED'); stage='ADMISSION';
  check(process.platform==='linux'&&process.env.NONVERBA_CONTAINER==='1'&&process.argv.length===5&&same(process.execArgv,['--max-old-space-size=512','--disable-proto=throw']),'BOUNDARYV6_ENVIRONMENT');
  check(['LD_PRELOAD','LD_AUDIT','NODE_OPTIONS','NODE_PATH','BASH_ENV','ENV'].every(k=>!process.env[k]),'BOUNDARYV6_ENVIRONMENT');
  const admissionRef={path:process.argv[2],sha256:process.argv[3],bytes:Number(process.argv[4])}; check(admissionRef.path===Q+'/admission.json','BOUNDARYV6_ADMISSION_PATH');
  const a=json(admissionRef);
  check(a.schema==='ROOT_CURRENT_V6_FIVE_BOUNDARY_SOURCE_ONLY_ADMISSION_V1'&&a.status==='ADMITTED_FIVE_ORDINARY_BOUNDARY_SOURCE_ONLY'&&a.source_sha256===SOURCE&&a.source_snapshot===SNAPSHOT&&same(a.input_refs,INPUTS)&&same(a.roster,ROSTER)&&same(a.native_metadata_only,NATIVE_METADATA_ONLY)&&same(a.limits,LIMITS)&&a.api==='resolveObservedSourceIssue'&&a.api_invocations===5&&a.direct_original_actual_roots_only===true&&a.native0099_api_forbidden===true&&a.new_readings===0&&a.tokenizer_callbacks===0&&a.model_inference===false&&a.quality_gate_pass===false&&a.authority==='NONE'&&integer(a.external_timeout_ms,1,LIMITS.elapsed_ms),'BOUNDARYV6_ADMISSION');
  check(a.worker_ref?.path===Q+'/qualify.mjs'&&a.worker_ref.path===fileURLToPath(import.meta.url)&&a.policy_ref?.path===Q+'/policy.json'&&a.clock_ref?.path===Q+'/clock.json','BOUNDARYV6_CONTROL_PATH'); read(a.worker_ref,LIMITS.source_copy_bytes);
  const policy=json(a.policy_ref),clock=json(a.clock_ref);
  check(policy.schema==='current-v6-five-boundary-source-only-policy-v1'&&policy.status==='ROOT_REVIEWED_SOURCE_ONLY_EXECUTION'&&policy.ROOT_ACTIVATED===true&&exact(policy.worker_ref,a.worker_ref)&&same(policy.input_refs,INPUTS)&&same(policy.roster,ROSTER)&&same(policy.native_metadata_only,NATIVE_METADATA_ONLY)&&same(policy.limits,LIMITS),'BOUNDARYV6_POLICY');
  check(clock.schema==='current-v6-five-boundary-source-only-clock-v1'&&typeof clock.origin_ns==='string'&&/^\d+$/u.test(clock.origin_ns),'BOUNDARYV6_CLOCK'); origin=BigInt(clock.origin_ns); check(process.hrtime.bigint()>=origin,'BOUNDARYV6_CLOCK_FUTURE'); admitted=true; checkpoint();
  check(same(fs.readdirSync(Q).sort(),['admission.json','clock.json','policy.json','qualify.mjs']),'BOUNDARYV6_FRESH_QA');
  check(a.worker_ref.bytes+a.policy_ref.bytes<=LIMITS.source_copy_bytes,'BOUNDARYV6_SOURCE_COPY_BOUND'); outputGuard();
  for(const row of ROSTER) check(!fs.existsSync(resolutionPath(row)),'BOUNDARYV6_RESOLUTION_ALREADY_EXISTS');
  stage='FROZEN_SOURCE_METADATA'; read(INPUTS.old_worker); read(INPUTS.source_issues_module);
  const epoch=json(INPUTS.epoch), manifest=json(INPUTS.manifest),{sha256,...sourceBody}=epoch.source;
  check(epoch.snapshot_code===SNAPSHOT&&sha256===SOURCE&&D(sourceBody)===SOURCE&&same(manifest.source,epoch.source)&&same(epoch.source.runtime,{node:process.version,platform:process.platform,architecture:process.arch})&&epoch.source.files.length===23,'BOUNDARYV6_SOURCE');
  for(const ref of epoch.source.files) {
    const p=path.resolve(LIB,ref.path); check(p.startsWith(SNAPSHOT+'/'),'BOUNDARYV6_SOURCE_PATH'); const s=stat(p); read({path:p,sha256:ref.sha256,bytes:s.size},2*1024**2);
  }
  const comparison=json(INPUTS.comparison),attestation=json(INPUTS.comparison_attestation);
  check(comparison.schema==='current-v6-fixed-994-extraction-equivalence-result-v1'&&comparison.status==='ALL_994_CACHE_CONTENTS_AND_NATIVE_GZIP_BYTES_PRESERVED'&&comparison.completed===994&&exact(comparison.source_epoch_ref,absoluteRef(INPUTS.epoch))&&exact(comparison.new_manifest_ref,absoluteRef(INPUTS.manifest))&&comparison.native_whole_gzip_hashes_and_lengths_equal===true&&comparison.all_other_cache_fields_deep_equal===true&&comparison.model_or_counter_called===false&&comparison.actual_source_reading===false&&comparison.issue_clearance===false&&comparison.fresh_reading_qualified===false,'BOUNDARYV6_COMPARISON');
  check(attestation.schema==='ROOT-fixed-994-comparison-native-attestation-v1'&&attestation.native_exit_code===0&&attestation.completed===994&&exact(attestation.result_ref,absoluteRef(INPUTS.comparison))&&attestation.quality_gate_pass===false&&attestation.authority==='NONE','BOUNDARYV6_COMPARISON_NATIVE_EXIT');
  stage='SIX_METADATA_IDENTITIES_AND_DIRECT_ORIGINS'; registryPreflight();
  const oldResult=json(INPUTS.old_result);
  check(oldResult.source_sha256===OLD194&&oldResult.rows?.length===5&&same(oldResult.rows.map(r=>({issue:r.issue_ref,contract_id:r.contract_id,replay:r.replay_ref,resolution:{path:r.resolution.path,sha256:r.resolution.sha256,bytes:r.resolution.bytes}})),ROSTER.map(r=>({issue:r.issue,contract_id:r.contract_id,replay:r.old_replay,resolution:r.old_resolution}))),'BOUNDARYV6_OLD_RESULT_ROSTER');
  const plans=ROSTER.map(plan); globalThis.fetch=()=>check(false,'BOUNDARYV6_NETWORK_FORBIDDEN');
  const {resolveObservedSourceIssue}=await import(pathToFileURL(LIB+'source-issues.mjs').href);
  stage='FIVE_EXISTING_SOURCE_ONLY_QUALIFICATIONS';
  for(const {row,replay} of plans) {
    checkpoint(); registryPreflight(); outputGuard(2*LIMITS.artifact_bytes);
    check(!fs.existsSync(resolutionPath(row)),'BOUNDARYV6_RESOLUTION_ALREADY_EXISTS');
    const replayRef=put('replay-issue-'+row.issue_id+'.json',replay); apiCalls++;
    const resolution=await resolveObservedSourceIssue(RUN,{issuePath:row.issue.path,issueSHA:row.issue.sha256,replayPath:replayRef.path,replaySHA:replayRef.sha256});
    check(resolution.status==='RESOLVED_FOR_EXACT_SOURCE'&&resolution.source_sha256===SOURCE&&resolution.path===resolutionPath(row).slice(RUN.length+1)&&resolution.resumed===false&&integer(resolution.bytes,1,LIMITS.artifact_bytes),'BOUNDARYV6_RESOLUTION');
    const actual=json({path:resolution.path,sha256:resolution.sha256,bytes:resolution.bytes});
    check(actual.extraction_source_sha256===SOURCE&&exact(actual.issue,row.issue)&&exact(actual.replay,replayRef)&&exact(actual.extraction_manifest,INPUTS.manifest)&&actual.qualification?.review_mode===MODE&&actual.qualification.newly_read_current_version===false&&exact(actual.qualification.prior_actual_replay,row.direct_actual_root)&&same(actual.qualification.actual_parent_read_ranges,replay.parent.actual_read_ranges)&&same(actual.qualification.actual_raw_read_ranges,replay.raw.actual_read_ranges),'BOUNDARYV6_RESOLUTION_READBACK');
    completed.push({issue_ref:row.issue,contract_id:row.contract_id,direct_actual_root:row.direct_actual_root,replay_ref:replayRef,resolution,new_readings:0,qualification_scope:'PRIOR_ACTUAL_PARENT_AND_DECLARED_RAW_RANGES_ONLY'});
    checkpoint(); outputGuard();
  }
  const result=put('result.json',{schema:'ROOT-current-v6-five-boundary-qualification-v1',status:'FIVE_ORDINARY_BOUNDARY_RESOLUTIONS_VERIFIED_AND_RECORDED_CURRENT_V6',source_sha256:SOURCE,source_epoch:INPUTS.epoch,comparison_ref:INPUTS.comparison,rows:completed,api_invocations:apiCalls,new_readings:0,heading_reviewed:false,navigation_reviewed:false,native_windows_qualified:false,whole_cache_read:false,native_change_issue_cleared:false,prefix_role_issues_cleared:false,ten_component_holds_cleared:false,protected_fresh_opened:false,tokenizer_callbacks:0,model_inference:false,quality_gate_pass:false,resource_observations:observations(),authority:'NONE'});
  console.log(JSON.stringify({status:'FIVE_CURRENT_V6_ORDINARY_BOUNDARY_QUALIFICATIONS',result_ref:result,count:completed.length,api_invocations:apiCalls,new_readings:0,tokenizer_callbacks:0,model_inference:false,quality_gate_pass:false,...observations()}));
}
main().catch(error=>{
  let held=null;
  if(admitted) try { held=put('held.json',{schema:'ROOT-current-v6-five-boundary-qualification-held-v1',status:'HELD_PRESERVED_COMPLETED_RESOLUTIONS',stage,code:safe(error),completed,api_invocations:apiCalls,new_readings:0,native_change_issue_cleared:false,tokenizer_callbacks:0,model_inference:false,originals_preserved:true,quality_gate_pass:false,resource_observations:observations(),authority:'NONE'},{held:true}); } catch {}
  console.error(JSON.stringify({status:'HELD',stage,code:safe(error),completed_count:completed.length,api_invocations:apiCalls,held_ref:held,new_readings:0,tokenizer_callbacks:0,model_inference:false,quality_gate_pass:false})); process.exitCode=77;
});
