// SPDX-License-Identifier: AGPL-3.0-only
// One inactive tokenization-only diagnostic; no inference, source display or quality verdict.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual as equal} from 'node:util';
import {createNativeSourceContext,createNativeRepresentation,FULL_STORED_PARENT_TRIAL} from './representation.mjs';
import {nativeEmbeddingWindows} from './tokenization-planner.mjs';
export const ROOT_ACTIVATED=false;
export const LIMITS=Object.freeze({elapsed_ms:300000,node_heap_MiB:768,RSS_bytes:1073741824,explicit_read_bytes:67108864,model_hash_read_bytes:268435456,decoded_bytes:67108864,QA_bytes:8388608,setup_bytes:131072,stdout_bytes:16384,planner_encode_probes:2000,planner_tokenizer_calls:2000,windows:512,independent_recounts:512});
const R='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000',Q=R+'/qa/current-v6-development0004-full-parent-tokenization-20261018-v1',LIB='/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2/lib';
const INDEX={path:R+'/qa/current-v6-development-component-batch-0001-0005-20261018-v1/development-0004/page-index.json',sha256:'512a06f9c0dd08a57e56031fb1a27005c1368196eb4826c894d0b21cb0482db7',bytes:9603};
const AVAILABILITY={path:R+'/qa/current-v6-development0004-full-parent-availability-20261018-v1/result.json',sha256:'c308d859a6a46bab97084cd172f32ae9fa76afacb7b68e1cf93a57a43d5a17e8',bytes:6715};
const EMBEDDING={path:LIB+'/embedding.mjs',sha256:'51caa5f501b2211702f91c121090f35017f5e2299ea0fb1720341a400b0de0be',bytes:39109};
const MODEL='/opt/nonverba-tools/priors-derivation-0.1/models/Xenova/all-MiniLM-L6-v2/751bff37182d3f1213fa05d7196b954e230abad9';
const ASSETS=[['config.json',650],['tokenizer.json',711661],['tokenizer_config.json',366],['special_tokens_map.json',125],['onnx/model.onnx',90387606],['README.md',1767]];
const COUNTER_POLICY='728bb65a00c45e8b6a4e1cdb1e5f8a69d5946234deb8bef089b61261dc8f541d';
const WITNESS={start:56665,end:56701},FIRST_WORD={start:57284,end:57291};
const H=b=>createHash('sha256').update(b).digest('hex'),C=v=>Array.isArray(v)?'['+v.map(C).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+C(v[k])).join(',')+'}':JSON.stringify(v),D=v=>H(C(v));
const ok=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});},safeCode=e=>/^[A-Z][A-Z0-9_]{0,95}$/u.test(e?.code??'')?e.code:'TOKENIZATION_HELD';
export function windowLiteralCoverage(range,witness=WITNESS,firstWord=FIRST_WORD){
 const valid=x=>x&&Number.isSafeInteger(x.start)&&Number.isSafeInteger(x.end)&&x.start>=0&&x.end>x.start;
 ok(valid(range)&&valid(witness)&&valid(firstWord),'TOKENIZATION_COVERAGE_RANGE');
 const qualifier=range.start<=witness.start&&range.end>=witness.end,point=range.start<=firstWord.start&&range.end>firstWord.start,word=range.start<=firstWord.start&&range.end>=firstWord.end;
 return {full_qualifier:qualifier,covenant_start_point:point,whole_first_selected_word:word,qualifier_and_start_point:qualifier&&point,qualifier_and_whole_first_word:qualifier&&word};
}
export function completeSourceCoverage(ranges,parent){
 ok(Array.isArray(ranges)&&ranges.length>0,'TOKENIZATION_EMPTY_WINDOWS');let end=parent.start;
 for(const r of [...ranges].sort((a,b)=>a.start-b.start||a.end-b.end)){ok(Number.isSafeInteger(r.start)&&Number.isSafeInteger(r.end)&&r.start>=parent.start&&r.end<=parent.end&&r.end>r.start&&r.start<=end,'TOKENIZATION_COVERAGE_GAP');end=Math.max(end,r.end);}
 ok(end===parent.end,'TOKENIZATION_COVERAGE_TAIL');return true;
}
const started=process.hrtime.bigint(),inputs=[],cacheBuffers=new Map();let readBytes=0,decodedBytes=0,modelHashReserved=0,stage='ADMISSION',peakRSS=0,samples=0,sticky=null,admitted=false,planningCalls=0,recountCalls=0,plannerWork=null;
function sample(){samples++;peakRSS=Math.max(peakRSS,process.memoryUsage().rss);if(peakRSS>LIMITS.RSS_bytes)sticky='TOKENIZATION_RSS';if(Number(process.hrtime.bigint()-started)/1e6>LIMITS.elapsed_ms)sticky='TOKENIZATION_TIME';}
function guard(){sample();if(sticky)throw Object.assign(Error(sticky),{code:sticky});}
function stat(p){ok(path.resolve(p)===p,'TOKENIZATION_PATH');let at='/';for(const part of p.split('/').filter(Boolean)){at=path.join(at,part);const s=fs.lstatSync(at);ok(!s.isSymbolicLink()&&(at===p||s.isDirectory()),'TOKENIZATION_LINK');}return fs.lstatSync(p);}
function read(r,max=16777216){guard();const p=r.path?.startsWith('/')?r.path:R+'/'+r.path;ok((p.startsWith(R+'/')||p.startsWith(LIB+'/'))&&Number.isSafeInteger(r.bytes)&&r.bytes>0&&r.bytes<=max&&/^[a-f0-9]{64}$/u.test(r.sha256),'TOKENIZATION_REF');const prior=cacheBuffers.get(p);if(prior){ok(prior.ref.sha256===r.sha256&&prior.ref.bytes===r.bytes,'TOKENIZATION_REF_CONFLICT');return prior.b;}const s=stat(p);ok(s.isFile()&&s.nlink===1&&s.size===r.bytes&&readBytes+r.bytes<=LIMITS.explicit_read_bytes,'TOKENIZATION_READ_BOUND');const b=fs.readFileSync(p,{flag:fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW});readBytes+=b.length;ok(b.length===r.bytes&&H(b)===r.sha256,'TOKENIZATION_PIN');inputs.push({...r,path:p});cacheBuffers.set(p,{ref:r,b});guard();return b;}
const text=b=>new TextDecoder('utf-8',{fatal:true}).decode(b),json=r=>JSON.parse(text(read(r)));
function decoded(b,max){ok(decodedBytes+max<=LIMITS.decoded_bytes,'TOKENIZATION_DECODE_RESERVE');const out=gunzipSync(b,{maxOutputLength:max});decodedBytes+=out.length;return out;}
function qaBytes(p=Q){const s=stat(p);let n=s.size;if(s.isDirectory())for(const name of fs.readdirSync(p))n+=qaBytes(p+'/'+name);else ok(s.isFile()&&s.nlink===1,'TOKENIZATION_QA_ENTRY');return n;}
function put(name,value){ok(/^[a-z][a-z0-9-]*\.json$/u.test(name),'TOKENIZATION_OUTPUT_PATH');const b=Buffer.from(JSON.stringify(value,null,2)+'\n');ok(qaBytes()+b.length+65536<=LIMITS.QA_bytes,'TOKENIZATION_QA_BOUND');fs.writeFileSync(Q+'/'+name,b,{flag:'wx',mode:0o600});return{path:Q+'/'+name,sha256:H(b),bytes:b.length};}
function resources(){return{elapsed_ms:Number(process.hrtime.bigint()-started)/1e6,explicit_read_bytes:readBytes,decoded_bytes:decodedBytes,model_hash_read_bytes_reserved:modelHashReserved,model_provisioning_bytes_reserved:modelHashReserved?2575:0,planner_tokenizer_calls:planningCalls,independent_recounts:recountCalls,encode_probes_exact:plannerWork?.encode_probes??null,encode_probes_reservation:2000,planner_work:plannerWork,sampled_peak_RSS_bytes:peakRSS,RSS_samples:samples,runtime_internal_IO_not_metered:true};}
async function main(){
 ok(ROOT_ACTIVATED&&process.platform==='linux'&&process.env.NONVERBA_CONTAINER==='1'&&process.argv.length===5,'TOKENIZATION_INACTIVE_OR_ENV');
 ok(equal(process.execArgv,['--max-old-space-size=768','--disable-proto=throw'])&&['LD_PRELOAD','LD_AUDIT','NODE_OPTIONS','NODE_PATH','NODE_COMPILE_CACHE','BASH_ENV','ENV'].every(k=>!process.env[k]),'TOKENIZATION_ENV');
 const admissionRef={path:process.argv[2],sha256:process.argv[3],bytes:Number(process.argv[4])};ok(admissionRef.path===Q+'/admission.json','TOKENIZATION_ADMISSION_PATH');const a=json(admissionRef);
 ok(a.schema==='ROOT-development0004-full-parent-tokenization-admission-v1'&&equal(a.limits,LIMITS)&&a.source_sha256==='82a3dab1396336edccf77f27a7800cccddff67ca928e919e824a663e1d563601'&&a.model_inference===false&&a.source_text_display===false&&a.quality_gate_pass===false&&a.authority==='NONE','TOKENIZATION_ADMISSION');
 const names=['admission.json','representation.mjs','tokenization-planner.mjs','tokenization-proposal.json','tokenization-run.mjs'];ok(equal(fs.readdirSync(Q).sort(),names.sort()),'TOKENIZATION_FRESH_NAMESPACE');
 ok(qaBytes()<=LIMITS.setup_bytes,'TOKENIZATION_SETUP_BOUND');
 for(const [field,name]of [['worker_ref','tokenization-run.mjs'],['representation_ref','representation.mjs'],['planner_ref','tokenization-planner.mjs'],['proposal_ref','tokenization-proposal.json']]){ok(a[field]?.path===Q+'/'+name,'TOKENIZATION_RUNTIME_PATH');read(a[field],131072);}
 const proposal=json(a.proposal_ref);ok(proposal.schema==='development0004-full-parent-tokenization-proposal-v1'&&proposal.ROOT_ACTIVATED===false&&equal(proposal.limits,LIMITS),'TOKENIZATION_PROPOSAL');
 admitted=true;fs.writeFileSync(Q+'/operation-lock',JSON.stringify({admission_ref:admissionRef,started_ns:String(started),permanent:true}),{flag:'wx',mode:0o600});
 const timer=setInterval(sample,25);timer.unref();globalThis.fetch=()=>{throw Object.assign(Error('TOKENIZATION_NETWORK_FORBIDDEN'),{code:'TOKENIZATION_NETWORK_FORBIDDEN'});};
 try{
  stage='PINNED_EXISTING_SOURCE_INPUTS';const prior=json(AVAILABILITY),index=json(INDEX),bundle=json(index.bundle);
  ok(prior.status==='QUALIFIER_AVAILABLE_IN_FULL_PARENT_NATIVE_INPUT'&&prior.witness.start===WITNESS.start&&prior.witness.end===WITNESS.end&&(prior.quality_gate_pass??false)===false&&prior.source_quality_gate_pass===false,'TOKENIZATION_PRIOR');
  ok(index.audit_id==='development-0004'&&bundle.audit_id===index.audit_id&&bundle.contract_id==='contract-327cc1e738fcb8a98106'&&bundle.extraction_source_sha256==='82a3dab1396336edccf77f27a7800cccddff67ca928e919e824a663e1d563601'&&D(bundle)===index.bundle_canonical_sha256,'TOKENIZATION_CASE');
  const cb=read(bundle.current_cache),plain=cb[0]===31&&cb[1]===139?decoded(cb,LIMITS.decoded_bytes-decodedBytes):cb;
  if(plain===cb){ok(decodedBytes+plain.length<=LIMITS.decoded_bytes,'TOKENIZATION_DECODE_BOUND');decodedBytes+=plain.length;}
  const cache=JSON.parse(text(plain));ok(D(cache)===bundle.current_cache.result_sha256&&cache.contract.id===bundle.contract_id,'TOKENIZATION_CACHE');
  const normalized=text(read(bundle.entire_normalized)),raw=text(read(bundle.raw));decodedBytes+=Buffer.byteLength(normalized)+Buffer.byteLength(raw);ok(decodedBytes<=LIMITS.decoded_bytes&&cache.normalized_text===normalized&&cache.normalized_sha256===H(normalized)&&cache.raw_sha256===H(raw),'TOKENIZATION_SOURCE');
  const nr=bundle.persisted_native_reference;ok(Number.isSafeInteger(nr.uncompressed_bytes)&&nr.uncompressed_bytes>0,'TOKENIZATION_NATIVE_SIZE');const eb=decoded(read(nr.artifact),nr.uncompressed_bytes);ok(eb.length===nr.uncompressed_bytes&&H(eb)===nr.uncompressed_sha256,'TOKENIZATION_NATIVE_PIN');const envelope=JSON.parse(text(eb));ok(envelope.sha256===nr.envelope_sha256,'TOKENIZATION_NATIVE_ENVELOPE');
  const tc=bundle.current_tracer_collector;for(const[name,sha]of [['source-decoration.mjs',tc.tracer_source_sha256],['sections.mjs',tc.collector_source_sha256]])read({path:LIB+'/'+name,sha256:sha,bytes:stat(LIB+'/'+name).size});
  const u=cache.units.find(x=>x.id===bundle.focal.id),p=cache.sections.find(x=>x.id===bundle.parent.id);ok(u&&p,'TOKENIZATION_GEOMETRY');const unit={...u,cohort:u.cohort??cache.contract.cohort},parent={...p,cohort:p.cohort??cache.contract.cohort};
  ok(unit.start===57284&&unit.end===59026&&parent.start===54521&&parent.end===63634&&parent.sha256===prior.parent.sha256&&unit.sha256===prior.unit.sha256,'TOKENIZATION_EXACT_GEOMETRY');
  const context=createNativeSourceContext({raw,normalizedText:normalized,envelope,expectedTracerSourceSHA256:tc.tracer_source_sha256,expectedCollectorSourceSHA256:tc.collector_source_sha256});
  const rep=createNativeRepresentation(unit,{context,parent,contextScope:FULL_STORED_PARENT_TRIAL,trialAuditId:'development-0004'});
  ok(rep.input_sha256===prior.trial_input_sha256&&H(rep.text.slice(2144,2180))===prior.witness.sha256&&unit.text.match(/^\S+/u)?.[0]==='Without','TOKENIZATION_RECIPE_WITNESS');
  stage='EXISTING_PINNED_TOKENIZER_ONLY';read(EMBEDDING,65536);const runtime=await import(pathToFileURL(EMBEDDING.path).href);ok(String(runtime.nativeEmbeddingWindows)===String(nativeEmbeddingWindows),'TOKENIZATION_PLANNER_IDENTITY');
  modelHashReserved=ASSETS.reduce((n,[name,size])=>{const s=stat(MODEL+'/'+name);ok(s.isFile()&&s.nlink===1&&s.size===size,'TOKENIZATION_MODEL_SIZE');return n+size;},0);ok(modelHashReserved+2575<=LIMITS.model_hash_read_bytes,'TOKENIZATION_MODEL_HASH_BOUND');guard();
  const counter=await runtime.createPinnedTokenCounter();guard();ok(counter.policy_sha256===COUNTER_POLICY&&counter.policy.onnx_session_created===false&&counter.policy.model_inference===false&&counter.policy.downloads_attempted===0&&counter.model.files.reduce((n,f)=>n+f.bytes,0)===modelHashReserved,'TOKENIZATION_COUNTER_POLICY');
  stage='V6_NATIVE_WINDOWS';const counted=s=>{guard();ok(planningCalls<LIMITS.planner_tokenizer_calls,'TOKENIZATION_PLANNING_QUOTA');planningCalls++;try{return counter.tokenCount(s);}finally{guard();}};
  let windows;try{windows=nativeEmbeddingWindows(rep,counted,{maxTokens:256,overlapWords:16,limits:{maxEncodeProbes:2000,maxTokenizerCalls:2000,maxWindows:512,maxSourceCharacters:9113}});}catch(e){plannerWork=e.work??null;throw e;}
  plannerWork=windows[0]?.native_planner_work??null;ok(windows.length>0&&windows.length<=512,'TOKENIZATION_WINDOWS_BOUND');
  const metadata=windows.map((w,i)=>{guard();ok(recountCalls<LIMITS.independent_recounts,'TOKENIZATION_RECOUNT_QUOTA');recountCalls++;const n=counter.tokenCount(w.text);guard();ok(n===w.tokens&&n<=256&&H(w.text)===w.sha256&&w.source_ranges.length===1,'TOKENIZATION_RECOUNT_MISMATCH');const range=w.source_ranges[0];ok(range.start===parent.start+w.source_utf16_start&&range.end===parent.start+w.source_utf16_end,'TOKENIZATION_WINDOW_RANGE');return{index:i,tokens:n,encoded_sha256:w.sha256,encoded_bytes:Buffer.byteLength(w.text),source_utf16_start:w.source_utf16_start,source_utf16_end:w.source_utf16_end,source_range:range,segmentation:w.segmentation,weight:w.weight,weight_unit:w.weight_unit,literal_coverage:windowLiteralCoverage(range)};});
  completeSourceCoverage(metadata.map(m=>m.source_range),parent);
  const windowsRef=put('windows-metadata.json',{schema:'development0004-full-parent-v6-tokenized-window-metadata-v1',parent:{id:parent.id,start:parent.start,end:parent.end,sha256:parent.sha256},unit:{id:unit.id,start:unit.start,end:unit.end,sha256:unit.sha256},input_sha256:rep.input_sha256,counter_policy_sha256:counter.policy_sha256,qualifier_span:WITNESS,first_selected_word_span:FIRST_WORD,windows:metadata,independent_recounts_complete:true,source_text_displayed:false,model_inference:false,quality_gate_pass:false,authority:'NONE'});
  const word=metadata.filter(m=>m.literal_coverage.qualifier_and_whole_first_word).map(m=>m.index),point=metadata.filter(m=>m.literal_coverage.qualifier_and_start_point).map(m=>m.index);
  const result={schema:'development0004-full-parent-tokenization-result-v1',status:'COMPLETE_PINNED_V6_TOKENIZATION_DIAGNOSTIC',audit_id:'development-0004',parent_range:{start:parent.start,end:parent.end},input_sha256:rep.input_sha256,windows_ref:windowsRef,accepted_windows:windows.length,all_windows_tokens_at_most:256,complete_parent_source_coverage:true,independent_recounts_complete:true,qualifier_span:WITNESS,first_selected_word_span:FIRST_WORD,primary_literal_qualifier_and_whole_first_word_windows:word,secondary_literal_qualifier_and_start_point_windows:point,literal_copresence_only:true,full_covenant_coverage_verified:false,semantic_condition_binding_verified:false,source_text_displayed:false,model_inference:false,actual_full_parent_reading:false,quality_gate_pass:false,materiality_holds_cleared:0,authority:'NONE',resources:resources(),counter_policy:counter.policy,counter_policy_sha256:counter.policy_sha256,inputs};
  const resultRef=put('result.json',result);guard();const stdout=JSON.stringify({status:result.status,result_ref:resultRef,accepted_windows:windows.length,primary_copresence_windows:word,secondary_copresence_windows:point,resources:resources(),quality_gate_pass:false});ok(Buffer.byteLength(stdout)<=LIMITS.stdout_bytes,'TOKENIZATION_STDOUT_BOUND');console.log(stdout);
 }finally{clearInterval(timer);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{let held=null;try{if(admitted)held=put('held.json',{status:'HELD',stage,code:safeCode(e),resources:resources(),retained_failure:true,partial_stream_accepted:false,source_text_displayed:false,model_inference:false,quality_gate_pass:false,authority:'NONE'});}catch{}console.error(JSON.stringify({status:'HELD',stage,code:safeCode(e),held_ref:held,resources:resources(),quality_gate_pass:false}));process.exitCode=77;});

