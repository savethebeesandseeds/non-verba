// SPDX-License-Identifier: AGPL-3.0-only
// Actual calibration inference/geometry; this is never a semantic validation claim.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {requireContainer,digest,sha256} from '../../lib/common.mjs';
import {validateStudyRoot,readJSON,studyPath,hashFile} from '../lib/store.mjs';
import {atomicJSON} from '../lib/workflow.mjs';
import {embedStudy,discoverStudy,verifyGeometry,readEmbeddingBatches} from '../lib/analysis.mjs';

requireContainer();
const startedWall=Date.now(),startedMonotonic=performance.now(),startedCPU=process.cpuUsage();
const started_at=new Date(startedWall).toISOString();
const source_script={path:'study-v0.2/tools/benchmark-calibration.mjs',sha256:sha256(await readFile(fileURLToPath(import.meta.url)))};
const run=validateStudyRoot(process.argv[2]),admissionPath=process.argv[3];
const admissionBody=await readJSON(run,admissionPath),admission={...admissionBody,manifest_path:admissionPath};
const admissionBinding={path:admissionPath,...await hashFile(await studyPath(run,admissionPath))};
const reportPath=`benchmarks/calibration-${admission.source.sha256.slice(0,20)}.json`;

function timings(){
  const completedWall=Date.now(),cpu=process.cpuUsage(startedCPU);
  return {utc_started_at:started_at,utc_completed_at:new Date(completedWall).toISOString(),utc_wall_elapsed_seconds:(completedWall-startedWall)/1000,monotonic_elapsed_seconds:(performance.now()-startedMonotonic)/1000,process_cpu_user_seconds:cpu.user/1e6,process_cpu_system_seconds:cpu.system/1e6,process_cpu_total_seconds:(cpu.user+cpu.system)/1e6,interpretation:'Current invocation only. Elapsed timers may include scheduling or suspension; UTC may change. Process CPU sums this process threads. No uninterrupted throughput is inferred.'};
}
async function boundManifest(reference){
  if(typeof reference?.path!=='string'||!/^([a-f0-9]{64})$/.test(reference.sha256??''))throw new Error('Benchmark requires exact bound artifact references');
  const actual=await hashFile(await studyPath(run,reference.path));
  if(actual.sha256!==reference.sha256||reference.bytes!==undefined&&actual.bytes!==reference.bytes)throw new Error(`Benchmark artifact binding changed: ${reference.path}`);
  return readJSON(run,reference.path);
}
async function resume(report){
  if(![2,3].includes(report.schema_version)||report.status!=='CALIBRATION_ENGINEERING_BENCHMARK_COMPLETE'||report.authority!=='NONE'||report.adopted_catalog!==false||report.reserve_accessed!==false||report.admission?.path!==admissionPath||report.admission.sha256!==admissionBinding.sha256||report.admission.bytes!==admissionBinding.bytes||digest(report.admission.counts)!==digest(admission.counts))throw new Error('Existing benchmark is not bound to this exact admission');
  const embeddings=await boundManifest(report.embeddings),geometry=await boundManifest(report.geometry);
  if(embeddings.status!=='REAL_CPU_EMBEDDINGS_RESEARCH_ONLY'||geometry.status!=='FIXED_DISCOVERY_SCHEDULE_RETAINED'||embeddings.identity?.admission_sha256!==digest(admissionBody)||geometry.identity?.embeddings_sha256!==digest(embeddings)||embeddings.rows!==report.embeddings.rows||embeddings.dimensions!==report.embeddings.dimensions||geometry.rows!==embeddings.rows||geometry.rows!==report.geometry.rows||geometry.runs?.length!==report.geometry.runs)throw new Error('Benchmark embedding/geometry identity or counts differ');
  for await(const ignored of readEmbeddingBatches(run,embeddings)){void ignored;}
  const verification=await verifyGeometry(run,geometry);
  if(digest(verification)!==digest(report.geometry.verification))throw new Error('Retained benchmark geometry verification differs');
  // All invocation fields are returned outside the immutable historical report.
  return {...report,report_path:reportPath,resumed:true,resume_verification:{status:'VERIFIED',new_inference:false,geometry:verification,source_script,timings:timings()}};
}

let retained=null;
try{retained=await readJSON(run,reportPath);}catch(error){if(error.code!=='ENOENT')throw error;}
if(retained){console.log(JSON.stringify(await resume(retained),null,2));}
else{
  const embeddings=await embedStudy(run,admission),geometry=await discoverStudy(run,embeddings),verified=await verifyGeometry(run,geometry),current=timings();
  const report={schema_version:3,status:'CALIBRATION_ENGINEERING_BENCHMARK_COMPLETE',started_at,completed_at:current.utc_completed_at,elapsed_seconds:current.monotonic_elapsed_seconds,current_invocation_timings:current,source_script,admission:{...admissionBinding,counts:admission.counts},embeddings:{path:embeddings.manifest_path,...await hashFile(await studyPath(run,embeddings.manifest_path)),rows:embeddings.rows,dimensions:embeddings.dimensions,elapsed_seconds:embeddings.elapsed_seconds,retained_manifest_elapsed_seconds:embeddings.elapsed_seconds,elapsed_interpretation:'Original embedding manifest Date.now duration; separate from current invocation timings. Retained cache verification does not constitute new inference. No uninterrupted encoder throughput is inferred.',current_invocation_inference_count:'NOT_SEPARATELY_MEASURED',verified_cache_is_not_new_inference:true},geometry:{path:geometry.manifest_path,...await hashFile(await studyPath(run,geometry.manifest_path)),rows:geometry.rows,runs:geometry.runs.length,verification:verified},authority:'NONE',adopted_catalog:false,reserve_accessed:false,interpretation:'Engineering evidence on the calibration only. Qualitative source gate and candidate meanings are evaluated separately; cluster agreement is not semantic confirmation.',participant_evaluation:'NOT_RUN'};
  await atomicJSON(await studyPath(run,reportPath,{missing:true}),report);console.log(JSON.stringify({...report,report_path:reportPath,resumed:false},null,2));
}
