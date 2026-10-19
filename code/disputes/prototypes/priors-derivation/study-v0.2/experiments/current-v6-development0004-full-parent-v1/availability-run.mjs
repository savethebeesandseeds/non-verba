// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE: one prospective availability experiment; no source-quality verdict.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual as equal} from 'node:util';

export const ROOT_ACTIVATED=false;
const RUN='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
const QA=RUN+'/qa/current-v6-development0004-full-parent-availability-20261018-v1';
const LIB='/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2/lib';
const INDEX={path:RUN+'/qa/current-v6-development-component-batch-0001-0005-20261018-v1/development-0004/page-index.json',sha256:'512a06f9c0dd08a57e56031fb1a27005c1368196eb4826c894d0b21cb0482db7',bytes:9603};
const LIMITS={elapsed_ms:300000,node_heap_mb:768,sampled_RSS_bytes:1073741824,explicit_read_bytes:33554432,decoded_bytes:67108864,QA_bytes:8388608,source_copy_bytes:131072,encoded_bytes:4194304};
const WITNESS='waived or consented to by the Holder',RAW_SCOPE={start:109180,end:112850};
const H=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const D=v=>H(canonical(v)),ok=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});};
// Native annotation JSON is metadata. A literal occurrence there cannot prove
// that the source words survived into the encoded source-text payload.
export function encodedSourceLiteralOccurrence(encodedText,sourceText,literal){
  if(!literal||!sourceText.includes(literal)||/\n\[(?:NATIVE_SOURCE_MARKS_UNVERIFIED|JOINT_NORMALIZATION_UNVERIFIED) /u.test(sourceText))return -1;
  const metadata=[...encodedText.matchAll(/\n\[(?:NATIVE_SOURCE_MARKS_UNVERIFIED|JOINT_NORMALIZATION_UNVERIFIED) [^\n]*\]\n/gu)].map(m=>[m.index,m.index+m[0].length]);
  for(let at=encodedText.indexOf(literal);at>=0;at=encodedText.indexOf(literal,at+1))if(!metadata.some(([start,end])=>at<end&&at+literal.length>start))return at;
  return -1;
}
const started=process.hrtime.bigint(),ledger=[],buffers=new Map();let readBytes=0,decoded=0,written=0,stage='ADMISSION';
function guard(){ok(Number(process.hrtime.bigint()-started)/1e6<=LIMITS.elapsed_ms,'TRIAL_TIME');ok(process.memoryUsage().rss<=LIMITS.sampled_RSS_bytes,'TRIAL_RSS');}
function safe(p){ok(path.resolve(p)===p&&!p.split('/').includes('..'),'TRIAL_PATH');let x='/';for(const k of p.split('/').filter(Boolean)){x=path.join(x,k);const s=fs.lstatSync(x);ok(!s.isSymbolicLink(),'TRIAL_SYMLINK');}return fs.lstatSync(p);}
function read(r,max=16777216){guard();const p=r.path.startsWith('/')?r.path:RUN+'/'+r.path;ok((p.startsWith(RUN+'/')||p.startsWith(LIB+'/'))&&Number.isSafeInteger(r.bytes)&&r.bytes>0&&r.bytes<=max&&/^[a-f0-9]{64}$/.test(r.sha256),'TRIAL_REF');if(buffers.has(p)){const x=buffers.get(p);ok(x.ref.sha256===r.sha256&&x.ref.bytes===r.bytes,'TRIAL_CONFLICT');return x.b;}const s=safe(p);ok(s.isFile()&&s.nlink===1&&s.size===r.bytes&&readBytes+r.bytes<=LIMITS.explicit_read_bytes,'TRIAL_READ_BOUND');const b=fs.readFileSync(p,{flag:fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW});readBytes+=b.length;ok(b.length===r.bytes&&H(b)===r.sha256,'TRIAL_PIN');ledger.push({...r,path:p});buffers.set(p,{ref:r,b});guard();return b;}
const text=b=>new TextDecoder('utf-8',{fatal:true}).decode(b),json=r=>JSON.parse(text(read(r)));
function unzip(r,size,sha){ok(Number.isSafeInteger(size)&&size>0&&decoded+size<=LIMITS.decoded_bytes,'TRIAL_DECODE_BOUND');const b=gunzipSync(read(r),{maxOutputLength:size});decoded+=b.length;ok(b.length===size&&H(b)===sha,'TRIAL_DECODE_PIN');return JSON.parse(text(b));}
function put(name,v){const b=Buffer.from(JSON.stringify(v,null,2)+'\n');ok(written+b.length+65536<=LIMITS.QA_bytes,'TRIAL_QA_BOUND');fs.writeFileSync(QA+'/'+name,b,{flag:'wx',mode:0o600});written+=b.length;return{path:QA+'/'+name,sha256:H(b),bytes:b.length};}

async function main(){
  ok(ROOT_ACTIVATED&&process.platform==='linux'&&process.env.NONVERBA_CONTAINER==='1'&&process.argv.length===5,'TRIAL_INACTIVE_OR_ENV');
  ok(equal(process.execArgv,['--max-old-space-size=768','--disable-proto=throw'])&&['LD_PRELOAD','LD_AUDIT','NODE_OPTIONS','NODE_PATH','BASH_ENV','ENV'].every(k=>!process.env[k]),'TRIAL_ENV');
  const admissionRef={path:process.argv[2],sha256:process.argv[3],bytes:Number(process.argv[4])};ok(admissionRef.path===QA+'/admission.json','TRIAL_ADMISSION_PATH');const a=json(admissionRef);
  ok(a.schema==='ROOT-development0004-full-parent-availability-admission-v1'&&equal(a.limits,LIMITS)&&a.source_text_display===false&&a.model_execution===false&&a.tokenizer_calls===0&&a.quality_gate_pass===false&&a.authority==='NONE','TRIAL_ADMISSION');
  ok(a.worker_ref.path===QA+'/availability-run.mjs'&&a.trial_module_ref.path===QA+'/representation.mjs'&&a.proposal_ref.path===QA+'/availability-proposal.json','TRIAL_MODULE_PATH');
  read(a.worker_ref,65536);read(a.trial_module_ref,65536);read({path:LIB+'/representation.mjs',sha256:'b35d8fd3c118d2da489eefd71796d9936596c73997172c5706112ef6ffb39ee6',bytes:14161},65536);
  const proposal=json(a.proposal_ref);ok(proposal.schema==='development0004-full-parent-availability-proposal-v1'&&proposal.ROOT_ACTIVATED===false&&equal(proposal.limits,LIMITS)&&proposal.predeclared_witness.literal===WITNESS&&equal(proposal.predeclared_witness.previously_read_raw_scope,[RAW_SCOPE.start,RAW_SCOPE.end]),'TRIAL_PROPOSAL');
  ok(a.worker_ref.bytes+a.trial_module_ref.bytes+a.proposal_ref.bytes+admissionRef.bytes+8192<=LIMITS.source_copy_bytes,'TRIAL_SOURCECOPY');
  ok(equal(fs.readdirSync(QA).sort(),['admission.json','availability-proposal.json','availability-run.mjs','representation.mjs']),'TRIAL_FRESH_QA');written=Math.max(safe(QA).size,8192);for(const name of fs.readdirSync(QA))written+=safe(QA+'/'+name).size;ok(written+65536<=LIMITS.QA_bytes,'TRIAL_INITIAL_QA_BOUND');
  globalThis.fetch=()=>{throw Error('TRIAL_NETWORK_FORBIDDEN');};stage='PINNED_EXISTING_COMPONENT_INPUTS';
  const index=json(INDEX),bundle=json(index.bundle);ok(index.audit_id==='development-0004'&&bundle.audit_id===index.audit_id&&bundle.contract_id==='contract-327cc1e738fcb8a98106'&&bundle.extraction_source_sha256==='82a3dab1396336edccf77f27a7800cccddff67ca928e919e824a663e1d563601'&&D(bundle)===index.bundle_canonical_sha256,'TRIAL_CASE');
  const cr=bundle.current_cache,cb=read(cr),cacheBytes=cb[0]===31&&cb[1]===139?gunzipSync(cb,{maxOutputLength:LIMITS.decoded_bytes-decoded}):cb;
  decoded+=cacheBytes.length;const cache=JSON.parse(text(cacheBytes));ok(decoded<=LIMITS.decoded_bytes&&D(cache)===cr.result_sha256&&cache.contract.id===bundle.contract_id,'TRIAL_CACHE');
  const normalized=text(read(bundle.entire_normalized)),raw=text(read(bundle.raw)),nr=bundle.persisted_native_reference;
  ok(normalized===cache.normalized_text&&H(normalized)===cache.normalized_sha256&&H(raw)===cache.raw_sha256,'TRIAL_SOURCES');
  const envelope=unzip(nr.artifact,nr.uncompressed_bytes,nr.uncompressed_sha256),tc=bundle.current_tracer_collector;
  ok(envelope.sha256===nr.envelope_sha256,'TRIAL_ENVELOPE');
  for(const [name,sha] of [['source-decoration.mjs',tc.tracer_source_sha256],['sections.mjs',tc.collector_source_sha256]])read({path:LIB+'/'+name,sha256:sha,bytes:safe(LIB+'/'+name).size});
  const trial=await import(pathToFileURL(a.trial_module_ref.path).href),baseline=await import(pathToFileURL(LIB+'/representation.mjs').href);
  const original=cache.units.find(u=>u.id===bundle.focal.id),parentOriginal=cache.sections.find(p=>p.id===bundle.parent.id);ok(original&&parentOriginal,'TRIAL_UNIT');
  const unit={...original,cohort:original.cohort??cache.contract.cohort},parent={...parentOriginal,cohort:parentOriginal.cohort??cache.contract.cohort};
  ok(unit.start===57284&&unit.end===59026&&parent.start===54521&&parent.end===63634&&parent.sha256===bundle.parent.sha256,'TRIAL_GEOMETRY');
  const args={raw,normalizedText:normalized,envelope,expectedTracerSourceSHA256:tc.tracer_source_sha256,expectedCollectorSourceSHA256:tc.collector_source_sha256};
  const context=trial.createNativeSourceContext(args),baselineContext=baseline.createNativeSourceContext(args),old=baseline.createNativeRepresentation(unit,{context:baselineContext,parent}),ordinary=trial.createNativeRepresentation(unit,{context,parent});
  ok(equal(old,ordinary),'TRIAL_DEFAULT_CHANGED');const oldWindow=baseline.nativeRepresentationWindow(old),ordinaryWindow=trial.nativeRepresentationWindow(ordinary);ok(equal(oldWindow,ordinaryWindow),'TRIAL_DEFAULT_ENCODING_CHANGED');
  const oldArms=bundle.model_source_parts,baselineArm=oldArms.find(x=>x.arm==='baseline'),contextArm=oldArms.find(x=>x.arm==='parent-context');ok(baselineArm?.source_text===old.text&&baselineArm.input_sha256===old.input_sha256&&contextArm,'TRIAL_PRIOR_ARM');
  stage='FULL_AUTHENTICATED_PARENT_ENCODING';const rep=trial.createNativeRepresentation(unit,{context,parent,contextScope:trial.FULL_STORED_PARENT_TRIAL,trialAuditId:'development-0004'}),encoded=trial.nativeRepresentationWindow(rep);
  ok(rep.text===normalized.slice(parent.start,parent.end)&&rep.text.length===9113&&rep.descriptor.policy===trial.FULL_STORED_PARENT_POLICY&&Buffer.byteLength(encoded.text)<=LIMITS.encoded_bytes,'TRIAL_FULL_PARENT');
  const at=rep.text.indexOf(WITNESS);ok(at>=0&&rep.text.indexOf(WITNESS,at+1)<0,'TRIAL_WITNESS_UNIQUE');const witness={start:parent.start+at,end:parent.start+at+WITNESS.length};
  const runs=new Map(envelope.trace.runs.map(r=>[r.id,r])),origins=envelope.segments.filter(s=>s.start<witness.end&&s.end>witness.start).flatMap(s=>s.sources.map(p=>runs.get(p.run_id)?.raw));
  ok(origins.length>0&&origins.every(r=>r&&r.start>=RAW_SCOPE.start&&r.end<=RAW_SCOPE.end),'TRIAL_PREVIOUSLY_EXPOSED_WITNESS_ORIGIN');
  const encodedWitnessOffset=encodedSourceLiteralOccurrence(encoded.text,rep.text,WITNESS);
  ok(!baselineArm.source_text.includes(WITNESS)&&!contextArm.source_text.includes(WITNESS)&&encodedWitnessOffset>=0,'TRIAL_WITNESS_AVAILABILITY');
  const artifact=put('full-parent-encoded.json',{schema:'development0004-full-parent-encoded-artifact-v1',prototype:true,authority:'NONE',representation:rep,encoded,actual_source_reading:false,model_execution:false,semantic_completeness_verified:false,quality_gate_pass:false});
  const result={schema:'development0004-full-parent-availability-result-v1',status:'QUALIFIER_AVAILABLE_IN_FULL_PARENT_NATIVE_INPUT',prototype:true,authority:'NONE',audit_id:'development-0004',contract_id:bundle.contract_id,parent:{start:parent.start,end:parent.end,sha256:parent.sha256},unit:{start:unit.start,end:unit.end,sha256:unit.sha256},witness:{...witness,sha256:H(WITNESS),previously_exposed_raw_scope:RAW_SCOPE,origin_ranges:origins,encoded_source_payload_offset:encodedWitnessOffset,annotation_metadata_occurrences_excluded:true},baseline_unchanged:true,default_native_encoding_unchanged:true,baseline_witness_present:false,sixty_word_context_witness_present:false,full_parent_witness_present:true,native_encoded_witness_present:true,parent_characters:rep.text.length,encoded_UTF16:encoded.text.length,encoded_bytes:Buffer.byteLength(encoded.text),trial_input_sha256:rep.input_sha256,artifact,inputs:ledger,resources:{explicit_read_bytes:readBytes,decoded_bytes:decoded,elapsed_ms:Number(process.hrtime.bigint()-started)/1e6},actual_full_parent_reading:false,actual_tokenized_windows:false,tokenizer_calls:0,model_execution:false,semantic_completeness_verified:false,governing_hierarchy_verified:false,outside_parent_context_verified:false,inherited_context_holds_cleared:0,source_quality_gate_pass:false,current200_complete:false,first_priors_adopted:false};guard();const resultRef=put('result.json',result);console.log(JSON.stringify({status:result.status,result_ref:resultRef,witness:result.witness,parent_characters:rep.text.length,encoded_bytes:result.encoded_bytes,baseline_unchanged:true,quality_gate_pass:false}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{let held=null;try{held=put('held.json',{status:'HELD',stage,code:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:'TRIAL_REPRESENTATION_OR_IO_FAILURE',explicit_read_bytes:readBytes,decoded_bytes:decoded,source_text_displayed:false,quality_gate_pass:false,authority:'NONE'});}catch{}console.error(JSON.stringify({status:'HELD',stage,code:e.code??'TRIAL_REPRESENTATION_OR_IO_FAILURE',held_ref:held,quality_gate_pass:false}));process.exitCode=77;});
