// SPDX-License-Identifier: AGPL-3.0-only
import { appendFile, readFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { args, readJSON, writeJSON, sha256, digest, within, regularFile, requireContainer } from './lib/common.mjs';
import { acquire } from './lib/acquire.mjs';
import { analyze, verifyAcquisition, finalizeManifest, sourceManifest } from './lib/analyze.mjs';
import { discover } from './lib/discover.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const discoveryFiles = ['config.json','sample.json','acquisition.json','extraction.json','embeddings.json','embedding-progress.ndjson','discovery.json','discovery-report.json','DATA_NOTICE.txt'];
const finalFiles = [...discoveryFiles,'discovery-artifacts.json','candidate-review.json','meaning-probes.json','report.json'];
const help = `Priors Derivation Lab 0.1 — PROTOTYPE / RESEARCH ONLY
Run only in the documented managed Debian container.

node cli.mjs acquire --run-dir=/opt/nonverba-build/priors-derivation/NAME [--count=100] [--recipe=/absolute/prototype.json]
node cli.mjs analyze --run-dir=/opt/nonverba-build/priors-derivation/NAME
node cli.mjs complete --run-dir=/opt/nonverba-build/priors-derivation/NAME --review=/absolute/candidate-review.json
node cli.mjs verify --run-dir=/opt/nonverba-build/priors-derivation/NAME [--replay=true]

Acquire freezes a new run. Analyze preserves exact extraction, vectors, fixed discovery attempts and failures.
Complete validates grounded draft-card references and creates the owner review report; it adopts no priors.
Verify checks retained bytes and optionally replays clustering from retained embeddings.
Use node serve.mjs --run=RUN --host=0.0.0.0 --port=4173 inside the existing container to review.
`;

export async function verifyRun(runDir, { replay = false } = {}) {
  const { acquisition, checks } = await verifyAcquisition(runDir);
  const result = { schema_version: 1, status: 'VERIFIED_RETAINED_ARTIFACTS', acquired_sources_checked: checks.length, execution_attested: false, replay: null };
  let manifestName='discovery-artifacts.json';
  try { await access(within(runDir,'artifacts.json')); manifestName='artifacts.json'; } catch(error) { if(error.code!=='ENOENT')throw error; }
  async function checkManifest(name, required) {
    const manifest = await readJSON(within(runDir, name));
    if(!Array.isArray(manifest.files)||digest(manifest.files)!==manifest.files_sha256)throw new Error('Artifact file-set digest mismatch');
    const names=manifest.files.map(file=>file.path);
    if(new Set(names).size!==names.length||digest([...names].sort())!==digest([...required].sort()))throw new Error(`Artifact manifest required file set mismatch: ${name}`);
    for(const file of manifest.files) { await regularFile(within(runDir,file.path));const data=await readFile(within(runDir,file.path));if(data.length!==file.bytes||sha256(data)!==file.sha256)throw new Error(`Artifact digest mismatch: ${file.path}`); }
    return manifest.files.length;
  }
  // A final manifest cannot silently re-seal changed upstream discovery evidence.
  result.discovery_files_checked=await checkManifest('discovery-artifacts.json',discoveryFiles);
  result.files_checked=manifestName==='artifacts.json'?await checkManifest('artifacts.json',finalFiles):result.discovery_files_checked;
  const extraction=await readJSON(within(runDir,'extraction.json'));
  const byId=new Map(extraction.results.map(record=>[record.contract.id,record]));
  for(const clause of extraction.selected_clauses) { const text=byId.get(clause.contract_id)?.normalized_text;if(text?.slice(clause.start,clause.end)!==clause.text||sha256(clause.text)!==clause.sha256)throw new Error(`Clause lineage mismatch: ${clause.id}`); }
  const embeddings=await readJSON(within(runDir,'embeddings.json'));
  for(const file of embeddings.model.files) {const path=within(embeddings.model.directory,file.path);await regularFile(path);if(sha256(await readFile(path))!==file.sha256)throw new Error(`Retained embedding model artifact changed: ${file.path}`); }
  result.model_files_checked=embeddings.model.files.length;
  const clauseMap=new Map(extraction.selected_clauses.map(clause=>[clause.id,clause]));
  if(embeddings.clause_ids.length!==embeddings.vectors.length||embeddings.inputs.length!==embeddings.vectors.length||new Set(embeddings.clause_ids).size!==embeddings.clause_ids.length)throw new Error('Embedding alignment mismatch');
  for(let i=0;i<embeddings.clause_ids.length;i++) {
    const clause=clauseMap.get(embeddings.clause_ids[i]);if(!clause)throw new Error('Embedding has no selected source clause');
    const text=`${clause.heading?`${clause.heading}\n`:''}${clause.text}`;
    if(sha256(text)!==embeddings.inputs[i].input_sha256)throw new Error('Embedding input hash mismatch');
    if(embeddings.vectors[i].length!==embeddings.model.dimensions||embeddings.vectors[i].some(v=>!Number.isFinite(v)))throw new Error('Embedding dimensions or values changed');
    const words=text.match(/\S+/gu)??[];let previousEnd=0;let previousStart=-1;
    if(!embeddings.inputs[i].windows.length)throw new Error('Embedding has no retained input windows');
    for(const w of embeddings.inputs[i].windows) {
      if(!Number.isSafeInteger(w.tokens)||w.tokens<1||w.tokens>embeddings.model.max_tokens||!Number.isSafeInteger(w.word_start)||!Number.isSafeInteger(w.word_end)||w.word_start<=previousStart||w.word_start>previousEnd||w.word_end<w.word_start+1||w.word_end<previousEnd||w.word_end>words.length||w.text!==words.slice(w.word_start,w.word_end).join(' ')||sha256(w.text)!==w.sha256||w.weight!==w.word_end-Math.max(w.word_start,previousEnd))throw new Error('Embedding window admission/hash/coverage mismatch');
      previousEnd=w.word_end;previousStart=w.word_start;
    }
    if(previousEnd!==words.length)throw new Error('Embedding windows omit source words');
  }
  result.clauses_checked=extraction.selected_clauses.length;result.embedding_vectors_checked=embeddings.vectors.length;
  const retained=await readJSON(within(runDir,'discovery.json'));const config=await readJSON(within(runDir,'config.json'));
  if(retained.embeddings_sha256!==sha256(await readFile(within(runDir,'embeddings.json'))))throw new Error('Discovery embedding lineage digest mismatch');
  if(digest(retained.source)!==digest(embeddings.source)||digest(extraction.source)!==digest(embeddings.source))throw new Error('Analysis stage source identity mismatch');
  const discoveryReport=await readJSON(within(runDir,'discovery-report.json'));
  const primary=retained.runs.find(run=>run.requested_k===config.discovery.primary_k&&run.repeat===1)??retained.runs[0];
  const holdoutByCluster=new Map(primary.holdout_support.map(row=>[row.cluster_id,row]));
  const expectedClusters=primary.clusters.map(cluster=>({...cluster,holdout_support:holdoutByCluster.get(cluster.id)??null,holdout_member_ids:primary.assignments.filter(row=>row.partition==='holdout'&&row.cluster_id===cluster.id).map(row=>row.id??row.clause_id)}));
  for(const [name,expected] of [['clauses',extraction.selected_clauses],['contracts',extraction.contracts],['clusters',expectedClusters],['assignments',primary.assignments]]) {
    if(digest(discoveryReport[name])!==digest(expected))throw new Error(`Discovery report lineage mismatch: ${name}`);
  }
  if(discoveryReport.method.primary_run!==primary.id||discoveryReport.authority!=='NONE'||discoveryReport.adopted_catalog!==false)throw new Error('Discovery report method or authority mismatch');
  if(manifestName==='artifacts.json') {
    const finalReport=await readJSON(within(runDir,'report.json'));const review=await readJSON(within(runDir,'candidate-review.json'));
    const candidates=Array.isArray(review)?review:review.candidates;
    const {validateCandidates,evaluateCandidateReview}=await import('./lib/evaluate.mjs');
    const validation=validateCandidates(candidates,{clauses:discoveryReport.clauses,clusters:discoveryReport.clusters,assignments:discoveryReport.assignments});
    if(!validation.valid||digest(finalReport.candidates)!==digest(candidates)||finalReport.summary.candidates!==candidates.length)throw new Error('Final candidate source/reference mismatch');
    if(finalReport.status!=='PROTOTYPE_AGENT_DRAFT_REQUIRES_OWNER_REVIEW')throw new Error('Final report authority/status mismatch');
    const immutableReport=(report)=>{const copy=structuredClone(report);for(const key of ['candidates','evaluation','findings','recommendations','next_steps','status'])delete copy[key];copy.summary.candidates=0;delete copy.provenance.candidate_review;return copy;};
    if(digest(immutableReport(finalReport))!==digest(immutableReport(discoveryReport)))throw new Error('Final report changed immutable discovery evidence');
    if(finalReport.provenance.candidate_review.sha256!==sha256(await readFile(within(runDir,'candidate-review.json'))))throw new Error('Final review input digest mismatch');
    const probes=await readJSON(within(runDir,'meaning-probes.json'));
    const expectedEvaluation=evaluateCandidateReview(candidates,discoveryReport,probes);
    expectedEvaluation.synthetic_probes=probes;
    const retainedEvaluation={...finalReport.evaluation};delete retainedEvaluation.semantic_review;delete retainedEvaluation.agent_desk_review;
    if(digest(retainedEvaluation)!==digest(expectedEvaluation)||digest(finalReport.evaluation.semantic_review)!==digest(Array.isArray(review)?null:review.evaluation_notes??null))throw new Error('Final evaluation differs from retained review and structural checks');
    for(const name of ['findings','recommendations','next_steps'])if(digest(finalReport[name])!==digest(Array.isArray(review)?[]:review[name]??[]))throw new Error(`Final authored review lineage mismatch: ${name}`);
    if(review.evaluation_notes?.status==='AGENT_DESK_REVIEW_COMPLETED') {
      const {validateDeskReview}=await import('./lib/desk-review.mjs');
      const notesCheck=validateDeskReview(review.evaluation_notes,candidates,probes);
      if(!notesCheck.valid||digest(finalReport.evaluation.agent_desk_review)!==digest(notesCheck))throw new Error('Authored agent review coverage/reference mismatch');
    }
    result.candidate_references_checked=candidates.length;
  }
  if(replay) {
    const clauses=embeddings.clause_ids.map(id=>({...clauseMap.get(id),duplicate_family:clauseMap.get(id).family_id}));
    const actual=discover(clauses,embeddings.vectors,{...config.discovery,fitIds:retained.fit_ids});
    const expected={...retained};delete expected.schema_version;delete expected.source;delete expected.embeddings_sha256;
    const same=digest(actual)===digest(expected);
    if(!same)throw new Error('Clustering replay differs from retained discovery');
    result.replay={status:'EXACT_RETAINED_VECTOR_REPLAY',runs:actual.runs.length,sha256:digest(actual),fresh_inference:false};
  }
  result.corpus_version=acquisition.corpus_version;
  return result;
}

export async function complete(runDir, reviewPath) {
  await verifyRun(runDir,{replay:true});
  const report=await readJSON(within(runDir,'discovery-report.json'));const review=await readJSON(reviewPath);
  const candidates=Array.isArray(review)?review:review.candidates;
  const { validateCandidates, evaluateCandidateReview }=await import('./lib/evaluate.mjs');
  const validation=validateCandidates(candidates,report);
  if(!validation.valid)throw new Error(`Candidate review rejected: ${JSON.stringify(validation.errors)}`);
  const probes=await readJSON(resolve(root,'fixtures/meaning-probes.json'));
  report.candidates=candidates;report.summary.candidates=candidates.length;
  report.status='PROTOTYPE_AGENT_DRAFT_REQUIRES_OWNER_REVIEW';
  report.evaluation=evaluateCandidateReview(candidates,report,probes);
  report.evaluation.synthetic_probes=probes;
  report.evaluation.semantic_review=Array.isArray(review)?null:review.evaluation_notes??null;
  if(report.evaluation.semantic_review?.status==='AGENT_DESK_REVIEW_COMPLETED') {
    const {validateDeskReview}=await import('./lib/desk-review.mjs');
    const check=validateDeskReview(report.evaluation.semantic_review,candidates,probes);
    if(!check.valid)throw new Error(`Incomplete authored agent desk review: ${check.errors.join('; ')}`);
    report.evaluation.agent_desk_review=check;
  }
  report.findings=Array.isArray(review)?[]:review.findings??[];
  report.recommendations=Array.isArray(review)?[]:review.recommendations??[];
  report.next_steps=Array.isArray(review)?[]:review.next_steps??[];
  report.provenance.candidate_review={source:'Explicit Codex research interpretation of retained contextual clauses; not participant or human-subject testing',source_input_sha256:sha256(await readFile(reviewPath)),tool_source:await sourceManifest(),completed_at:new Date().toISOString(),status:'AGENT_DRAFT_REQUIRES_OWNER_REVIEW'};
  await writeJSON(within(runDir,'candidate-review.json'),review);
  report.provenance.candidate_review.sha256=sha256(await readFile(within(runDir,'candidate-review.json')));
  await writeJSON(within(runDir,'meaning-probes.json'),probes);
  await writeJSON(within(runDir,'report.json'),report);
  await finalizeManifest(runDir,'artifacts.json',['config.json','sample.json','acquisition.json','extraction.json','embeddings.json','embedding-progress.ndjson','discovery.json','discovery-report.json','discovery-artifacts.json','candidate-review.json','meaning-probes.json','report.json','DATA_NOTICE.txt']);
  return report;
}

async function main(argv) {
  if(!argv.length||argv[0]==='--help'){console.log(help);return;}
  requireContainer();const [command,...rest]=argv;const options=args(rest);
  const allowed={acquire:['run-dir','count','recipe'],analyze:['run-dir'],complete:['run-dir','review'],verify:['run-dir','replay']}[command];
  if(!allowed)throw new Error(`Unknown prototype command: ${command}`);
  if(Object.keys(options).some(key=>!allowed.includes(key)))throw new Error('Unsupported command option');
  const runDir=resolve(options['run-dir']??'');
  if(!options['run-dir']||!runDir.startsWith('/opt/nonverba-build/priors-derivation/'))throw new Error('Use an explicit managed prototype run directory');
  await mkdir('/opt/nonverba-build/priors-derivation',{recursive:true});
  try {
    if(command==='acquire'){const config=await readJSON(options.recipe?resolve(options.recipe):resolve(root,'prototype.json'));const result=await acquire(runDir,config,{count:Number(options.count??100)});console.log(JSON.stringify({status:result.status,records:result.records.length,failures:result.failures.length,run_dir:runDir}));}
    else if(command==='analyze'){const report=await analyze(runDir);console.log(JSON.stringify({status:report.status,summary:report.summary,run_dir:runDir}));}
    else if(command==='complete'){if(!options.review)throw new Error('Complete requires an explicit candidate review file');const report=await complete(runDir,resolve(options.review));console.log(JSON.stringify({status:report.status,summary:report.summary}));}
    else if(command==='verify'){if(options.replay&&options.replay!=='true')throw new Error('--replay accepts only true');console.log(JSON.stringify(await verifyRun(runDir,{replay:options.replay==='true'}),null,2));}
  }catch(error){try{await appendFile(within(runDir,'failures.ndjson'),`${JSON.stringify({command,error:error.message,at:new Date().toISOString()})}\n`);}catch{}throw error;}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
