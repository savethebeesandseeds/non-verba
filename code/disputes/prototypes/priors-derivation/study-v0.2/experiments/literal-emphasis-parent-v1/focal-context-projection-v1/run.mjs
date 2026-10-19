// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE: fixed exposed source-context projection; no collector, model or quality changes.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {fileURLToPath,pathToFileURL} from 'node:url';

const R='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
const Q=R+'/qa/literal-emphasis-parent-v1-focal-context-projection-v1-retry2';
const POLICY={path:Q+'/ROOT-context-policy.json',sha256:'aed5d3e7bc01c4296a599e11e303c99898e903b5f6a3c5fe8a8bd58a22487fba',bytes:22980};
const NODE={path:'/opt/nonverba-tools/node/bin/node',sha256:'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48',bytes:124827920};
const FLAGS=['--max-old-space-size=256','--disable-proto=throw','--experimental-vm-modules'];
const H=b=>createHash('sha256').update(b).digest('hex');
const J=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const C=v=>Array.isArray(v)?'['+v.map(C).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+C(v[k])).join(',')+'}':JSON.stringify(v);
const check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});};
const same=(a,b)=>C(a)===C(b);
const exactText=b=>{const s=b.toString('utf8');check(Buffer.from(s).equals(b),'CONTEXT_UTF8');return s;};

async function main(){
  const origin=process.hrtime.bigint(),now=process.hrtime.bigint.bind(process.hrtime);
  const io=Object.freeze(Object.fromEntries(Object.getOwnPropertyNames(fs).filter(k=>typeof fs[k]==='function').map(k=>[k,fs[k].bind(fs)])));
  const constants=Object.freeze({...fs.constants}),memory=process.memoryUsage.bind(process),pid=process.pid;
  const argv=[...process.argv],env={...process.env},entry=fileURLToPath(import.meta.url);
  const [admissionPath,admissionSHA,admissionSize,...extra]=argv.slice(2);
  check(!extra.length&&admissionPath===Q+'/ROOT-context-admission.json'&&/^[a-f0-9]{64}$/u.test(admissionSHA??'')&&/^[1-9][0-9]{0,5}$/u.test(admissionSize??''),'CONTEXT_ARGUMENTS');
  function noLinks(file,directory=false){check(path.posix.isAbsolute(file)&&path.posix.normalize(file)===file,'CONTEXT_PATH');let at='/';for(const n of file.split('/').filter(Boolean)){at=path.posix.join(at,n);const s=io.lstatSync(at);check(!s.isSymbolicLink()&&((at!==file||directory)?s.isDirectory():s.isFile()),'CONTEXT_LINK_KIND');}return io.lstatSync(file);}
  function read(ref,max=8388608){check(ref&&Object.keys(ref).sort().join('|')==='bytes|path|sha256'&&Number.isSafeInteger(ref.bytes)&&ref.bytes>=0&&ref.bytes<=max&&/^[a-f0-9]{64}$/u.test(ref.sha256),'CONTEXT_REF');const s=noLinks(ref.path);check(s.size===ref.bytes,'CONTEXT_REF_SIZE');const fd=io.openSync(ref.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const before=io.fstatSync(fd);check(before.dev===s.dev&&before.ino===s.ino&&before.size===s.size,'CONTEXT_FD');const b=Buffer.alloc(ref.bytes);let at=0;while(at<b.length){const n=io.readSync(fd,b,at,b.length-at,at);check(n>0,'CONTEXT_SHORT');at+=n;}const after=io.fstatSync(fd);check(io.readSync(fd,Buffer.alloc(1),0,1,at)===0&&before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&H(b)===ref.sha256,'CONTEXT_REF_HASH');return b;}finally{io.closeSync(fd);}}
  function json(ref,max){const b=read(ref,max),v=JSON.parse(exactText(b));check(J(v).equals(b),'CONTEXT_JSON');return v;}
  function tree(){let bytes=0,entries=0;const todo=[Q];while(todo.length){const p=todo.pop(),s=io.lstatSync(p);check(!s.isSymbolicLink()&&++entries<=2048,'CONTEXT_TREE');bytes+=s.size;if(s.isDirectory())for(const n of io.readdirSync(p))todo.push(p+'/'+n);else check(s.isFile(),'CONTEXT_TREE_KIND');}return{bytes,entries};}
  noLinks(Q,true);io.mkdirSync(Q+'/captures',{mode:0o700});
  function capture(fd,name){const file=Q+'/captures/'+name+'.private.log',opened=io.openSync(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600),before=io.fstatSync(opened);io.closeSync(fd);const bound=io.openSync(file,constants.O_WRONLY|constants.O_NOFOLLOW),after=io.fstatSync(bound);io.closeSync(opened);check(bound===fd&&before.dev===after.dev&&before.ino===after.ino&&io.readlinkSync('/proc/'+pid+'/fd/'+fd)===file,'CONTEXT_CAPTURE');return{path:file,dev:before.dev,ino:before.ino};}
  const captures=[capture(1,'stdout'),capture(2,'stderr')];
  const journalPath=Q+'/preparation.journal.ndjson',journalFD=io.openSync(journalPath,constants.O_CREAT|constants.O_EXCL|constants.O_APPEND|constants.O_WRONLY|constants.O_NOFOLLOW,0o600),journalStat=io.fstatSync(journalFD);
  let held=null,policy,measure,capacityPolicy,lastCapacity=null,journalRows=0,journalBytes=0,metadataBytes=0,decoded=0,sourceOpened=false,currentAudit=null; const manifest_refs=[];
  process.on('SIGTERM',()=>held??='CONTEXT_SIGTERM');process.on('SIGINT',()=>held??='CONTEXT_SIGINT');
  const elapsed=()=>982654+Number((now()-origin+999999n)/1000000n);
  function boundary(){check(!held,'CONTEXT_STOP');const owned=tree(),rss=memory().rss,captureBytes=477909+captures.reduce((n,r)=>n+io.lstatSync(r.path).size,0);check(elapsed()<=1582654&&rss<=1073741824&&owned.bytes<=16777216&&389027117+owned.bytes<=402653184&&captureBytes<=1048576,'CONTEXT_RESOURCE');return{elapsed_ms:elapsed(),rss_bytes:rss,owned_bytes:owned.bytes,charged_pilot_bytes:389027117+owned.bytes,capture_bytes:captureBytes};}
  function put(relative,value,max=8388608){const b=Buffer.isBuffer(value)?value:J(value);check(relative.split('/').every(n=>n&&n!=='.'&&n!=='..')&&!relative.startsWith('/')&&b.length<=max,'CONTEXT_WRITE');const before=boundary();check(before.owned_bytes+b.length+8192<=16777216,'CONTEXT_WRITE_BOUND');let parent=Q;for(const n of relative.split('/').slice(0,-1)){parent+='/'+n;if(!io.existsSync(parent))io.mkdirSync(parent,{mode:0o700});noLinks(parent,true);}const p=Q+'/'+relative,fd=io.openSync(p,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{io.writeFileSync(fd,b);io.fsyncSync(fd);}finally{io.closeSync(fd);}const ref={path:p,sha256:H(b),bytes:b.length};read(ref,max);boundary();return ref;}
  function note(event){const b=Buffer.from(JSON.stringify({index:journalRows,event})+'\n');check(b.length<=1024&&3756+journalRows+1<=16384&&1377643+journalBytes+b.length<=16777216,'CONTEXT_JOURNAL');check(tree().bytes+b.length<=16777216,'CONTEXT_JOURNAL_BOUND');const s=noLinks(journalPath),opened=io.fstatSync(journalFD);check(s.dev===journalStat.dev&&s.ino===journalStat.ino&&opened.dev===s.dev&&opened.ino===s.ino&&s.size===journalBytes&&opened.size===journalBytes,'CONTEXT_JOURNAL_IDENTITY');check(io.writeSync(journalFD,b)===b.length,'CONTEXT_JOURNAL_SHORT');io.fsyncSync(journalFD);journalRows++;journalBytes+=b.length;check(io.fstatSync(journalFD).size===journalBytes&&noLinks(journalPath).ino===journalStat.ino,'CONTEXT_JOURNAL_COMMIT');boundary();}
  function metadata(ref,parse=true){check(metadataBytes+ref.bytes<=33554432,'CONTEXT_METADATA_BOUND');const b=read(ref);metadataBytes+=b.length;return parse?{bytes:b,value:JSON.parse(exactText(b))}:{bytes:b};}
  async function capacity(){const started=Number(now())/1e6,result=await measure(R,capacityPolicy,{io});check(result.bytes>=12330904043&&result.bytes<=25769803776&&result.bytes-12330245718<=536870912&&Number(now())/1e6-started<=1000,'CONTEXT_SHARED_CAPACITY');lastCapacity={bytes:result.bytes,at_ms:Number(now())/1e6};boundary();return lastCapacity;}
  const permits=new WeakMap();
  function payload(permit,ref,max=8388608){const p=permits.get(permit);check(p&&['contract-5e4763782d47aca7d67c','contract-c11bca9418c0ce310898'].includes(p.contract_id)&&!p.protected.has(p.contract_id)&&p.refs.some(r=>same(r,ref)),'CONTEXT_PRIVATE_PAYLOAD_PERMIT');const renewed=metadata(p.guard_ref).value,{projection_sha256,...body}=renewed,ids=new Set(renewed.rows.map(r=>r.contract_id));check(same(renewed,p.guard)&&H(C(body))===projection_sha256&&renewed.rows.length===100&&new Set(renewed.rows.map(r=>r.audit_id)).size===100&&ids.size===29&&!ids.has(p.contract_id),'CONTEXT_RECHECKED_FRESH_GUARD');boundary();const b=read(ref,max);sourceOpened=true;note({kind:'EXACT_PAYLOAD_READ',path:ref.path,sha256:ref.sha256,bytes:ref.bytes});return b;}
  function charge(n){check(Number.isSafeInteger(n)&&n>0&&n<=33554432-decoded,'CONTEXT_INPUT_DECODED_BOUND');decoded+=n;}
  function unzip(bytes,size,hash){check(size<=33554432-decoded,'CONTEXT_INPUT_DECODED_BOUND');const b=gunzipSync(bytes,{maxOutputLength:size});check(b.length===size&&H(b)===hash,'CONTEXT_INPUT_DECODED_HASH');charge(b.length);boundary();return b;}
  try{
    check(process.platform==='linux'&&process.arch==='x64'&&process.version==='v22.23.3'&&env.NONVERBA_CONTAINER==='1'&&same(process.execArgv,FLAGS)&&process.execPath===NODE.path,'CONTEXT_RUNTIME');for(const k of['LD_PRELOAD','LD_AUDIT','NODE_OPTIONS','BASH_ENV','ENV'])check(env[k]===undefined,'CONTEXT_INJECTED_ENV');
    const ns=noLinks(NODE.path);check(ns.size===NODE.bytes,'CONTEXT_NODE_SIZE');const nh=createHash('sha256'),nfd=io.openSync(NODE.path,constants.O_RDONLY|constants.O_NOFOLLOW),block=Buffer.alloc(1048576);try{let at=0;while(at<NODE.bytes){const n=io.readSync(nfd,block,0,Math.min(block.length,NODE.bytes-at),at);check(n>0,'CONTEXT_NODE_SHORT');nh.update(block.subarray(0,n));at+=n;}check(io.readSync(nfd,Buffer.alloc(1),0,1,at)===0&&io.fstatSync(nfd).size===NODE.bytes&&nh.digest('hex')===NODE.sha256,'CONTEXT_NODE_HASH');}finally{io.closeSync(nfd);}
    policy=json(POLICY);const failed=json(policy.failed_attempt_closed_ref),failedExecution=json(policy.failed_attempt_execution_ref),failedHeld=json(policy.failed_attempt_held_ref);
    check(failed.source_context_clock_closed===true&&failed.source_context_active_ms_charged===982654&&failed.charged_pilot_bytes===372249901&&failed.cumulative_private_and_metadata_capture_bytes===477909&&failed.cumulative_journal_rows===3756&&failed.cumulative_journal_bytes===1377643&&same(failed.execution_ref,policy.failed_attempt_execution_ref)&&same(failed.held_ref,policy.failed_attempt_held_ref)&&failed.payload_reads===0&&failed.decoded_input_bytes===0&&failed.quality_gate_pass===false&&failedExecution.run_exit===77&&failedExecution.checker_exit===null&&failedHeld.code==='CONTEXT_INPUT_POLICY_SCOPE'&&failedHeld.source_payloads_opened===false,'CONTEXT_FAILED_ATTEMPT_CARRY');
    check(policy.base_charged_bytes===389027117&&policy.prior_attempt_charged_bytes===372249901&&policy.new_source_copy_reservation_bytes===16777216&&policy.initial_source_active_carry_ms===982654&&policy.initial_capture_carry_bytes===477909&&policy.cumulative_source_active_ms_cap===1582654&&policy.post_result_source_copy_reservation_carried_from_failed_Q16===true,'CONTEXT_RETRY_CARRY_POLICY');
    const admissionRef={path:admissionPath,sha256:admissionSHA,bytes:Number(admissionSize)},a=json(admissionRef),bindings=policy.source_metadata_bindings;
    const identities=bindings.map(b=>({audit_id:b.audit_id,contract_id:b.contract_id,case_id:b.case_id}));
    check(a.schema==='ROOT_FOCAL_CONTEXT_ADMISSION_V1'&&a.status==='ADMITTED_TWO_FIXED_SOURCE_ONLY_CONTEXT_PROJECTIONS'&&a.root===Q&&same(a.policy_ref,POLICY)&&same(a.cases,identities)&&a.model_access===false&&a.quality_gate_pass===false,'CONTEXT_ADMISSION');
    const epoch=json(a.source_epoch_ref);check(epoch.schema==='focal-context-source-epoch-v1'&&same(epoch.runtime_ref,NODE)&&same(epoch.node_flags,FLAGS)&&same(a.runtime_ref,NODE)&&same(a.node_flags,FLAGS)&&epoch.source_refs.length<=256&&same(a.source_refs,epoch.source_refs)&&epoch.source_refs.some(r=>r.path===entry&&same(r,a.run_entry_ref)),'CONTEXT_SOURCE_EPOCH');
    for(const r of epoch.source_refs){check(/^(?:\/tmp\/nonverba-unified-source\/[a-f0-9]{32}\/code\/|\/opt\/nonverba-tools\/priors-derivation-0\.1\/node_modules\/(?:parse5|entities)\/)/u.test(r.path),'CONTEXT_SOURCE_SCOPE');read(r,262144);}
    for(const key of['custody_entry_ref','projection_entry_ref','checker_entry_ref'])check(epoch.source_refs.some(r=>same(r,a[key])),'CONTEXT_ENTRY_PIN');
    read(a.capacity_helper_ref,262144);capacityPolicy=json(a.capacity_policy_ref);({measureRunCapacity:measure}=await import(pathToFileURL(a.capacity_helper_ref.path).href));await capacity();
    const completion=metadata(policy.prior_completion_ref).value,priorAdmission=metadata(policy.prior_admission_ref).value,priorEpoch=metadata(policy.prior_source_epoch_ref).value,pending=metadata(policy.prior_pending_ref).value,manifest=metadata(policy.prior_manifest_ref).value,closed=metadata(policy.prior_closed_ref).value,terminal=metadata(policy.prior_terminal_ref).value;
    check(Array.isArray(priorEpoch.source_refs)&&priorEpoch.source_refs.length<=256,'CONTEXT_PRIOR_SOURCE_COUNT');for(const r of priorEpoch.source_refs)read(r,262144);
    const guard=metadata(policy.guard_ref).value,summaries=policy.baseline_inputs.map(b=>metadata(b.summary_ref).value);
    metadata(bindings[0].current_manifest_ref,false);metadata(bindings[0].fresh_ref,false);
    const {validateContextInputCustody,verifyBaselineArtifact}=await import(pathToFileURL(a.custody_entry_ref.path).href),custody=validateContextInputCustody({policy,completion,admission:priorAdmission,epoch:priorEpoch,pending,manifest,closed,terminal,summaries,guard});
    check(same(custody.guard,guard)&&same(custody.cases.map(c=>c.row.audit_id),['development-0055','development-0047']),'CONTEXT_FIXED_CASES');
    const {projectFocalContext,verifyFocalContext,summarizeFocalContext}=await import(pathToFileURL(a.projection_entry_ref.path).href),limits={context_payload_bytes:262144,max_context_spans:32},protectedIDs=new Set(guard.rows.map(r=>r.contract_id));
    const plainRef=r=>({path:r.path,bytes:r.bytes,sha256:r.sha256});
    for(const c of custody.cases){
      const b=c.binding;decoded=0;currentAudit=b.audit_id;
      check(policy.baseline_inputs.some(x=>x.case_id===b.case_id&&same(x.baseline_ref,c.baseline_ref)),'CONTEXT_BASELINE_ALLOWLIST');
      const permit=Object.freeze({});permits.set(permit,{contract_id:b.contract_id,protected:protectedIDs,refs:[plainRef(c.baseline_ref)],guard_ref:policy.guard_ref,guard});
      note({kind:'FIXED_CONTEXT_CASE_ADMITTED',audit_id:b.audit_id,contract_id:b.contract_id,case_id:b.case_id,context_payload_bytes:limits.context_payload_bytes,max_context_spans:limits.max_context_spans});
      const plain=unzip(payload(permit,plainRef(c.baseline_ref)),c.baseline_ref.decoded_bytes,c.baseline_ref.decoded_sha256),input=JSON.parse(exactText(plain));
      check(Buffer.from(JSON.stringify(input)).equals(plain),'CONTEXT_BASELINE_COMPACT_JSON');
      verifyBaselineArtifact({artifact:input,binding:b,row:c.row,summary:c.summary});
      const inputHash=H(Buffer.from(JSON.stringify(input)));
      await capacity();const result=projectFocalContext({extraction:input.extraction,focal_id:c.row.focal_id,limits});boundary();
      check(result&&result.artifact&&result.metadata&&H(Buffer.from(JSON.stringify(input)))===inputHash,'CONTEXT_INPUT_MUTATION');
      verifyFocalContext({artifact:result.artifact,extraction:input.extraction,focal_id:c.row.focal_id,limits});check(same(result.metadata,summarizeFocalContext(result.artifact)),'CONTEXT_SUMMARY_BINDING');
      const wrapper={schema:'fixed-source-focal-context-result-v1',audit_id:b.audit_id,contract_id:b.contract_id,case_id:b.case_id,baseline_ref:c.baseline_ref,prior_completion_ref:policy.prior_completion_ref,source_epoch_ref:a.source_epoch_ref,policy_ref:POLICY,projection:result.artifact,quality_gate_pass:false,authority:'NONE'},output=J(wrapper);
      const summary={schema:'fixed-source-focal-context-summary-v1',audit_number:Number(b.audit_id.slice(-4)),case_id:b.case_id,baseline_ref_sha256:c.baseline_ref.sha256,source_sha256:policy.source_sha256,context:result.metadata,input_decoded_bytes:decoded,output_projection_decoded_bytes:output.length,quality_gate_pass:false,authority:'NONE'},summaryBytes=J(summary);
      check(output.length+summaryBytes.length+262144<=33554432&&summaryBytes.length<=65536,'CONTEXT_OUTPUT_DECODED_BOUND');const encoded=gzipSync(output,{level:6});check(encoded.length<=8388608,'CONTEXT_OUTPUT_ENCODED_BOUND');
      const projection_ref={...put('outputs/'+b.audit_id+'/projection.json.gz',encoded),encoding:'gzip',decoded_bytes:output.length,decoded_sha256:H(output)},summary_ref=put('outputs/'+b.audit_id+'/summary.json',summaryBytes,65536);
      manifest_refs.push({audit_id:b.audit_id,contract_id:b.contract_id,case_id:b.case_id,baseline_ref:c.baseline_ref,projection_ref,summary_ref,input_decoded_bytes:decoded,output_decoded_bytes:output.length+summaryBytes.length});
      await capacity();note({kind:'FIXED_CONTEXT_CASE_COMPLETE',audit_id:b.audit_id,input_decoded_bytes:decoded,output_decoded_bytes:output.length+summaryBytes.length});
    }
    const manifestRef=put('outputs/manifest.json',{schema:'focal-context-output-manifest-v1',status:'PREPARED_CONTEXT_PROJECTIONS_PENDING_EXTERNAL_EXIT',admission_ref:admissionRef,source_epoch_ref:a.source_epoch_ref,guard_ref:policy.guard_ref,cases:manifest_refs,failed_available:policy.failed_available,manual_reader_opening:false,model_access:false,quality_gate_pass:false,authority:'NONE'},262144);
    for(const c of manifest_refs)check(c.output_decoded_bytes+manifestRef.bytes<=33554432,'CONTEXT_FINAL_OUTPUT_BOUND');
    const stat=io.readFileSync('/proc/'+pid+'/stat','utf8'),fields=stat.slice(stat.lastIndexOf(') ')+2).trim().split(/\s+/u),actor={pid,start_ticks:fields[19],group:Number(fields[2])},boot=io.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
    put('exit-pending.json',{schema:'focal-context-exit-pending-v1',status:'PENDING_EXTERNAL_ROOT_EXIT_READBACK',actor,boot_id:boot,origin_ns:String(origin),initial_active_carry_ms:982654,manifest_ref:manifestRef,admission_ref:admissionRef,guard_ref:policy.guard_ref,source_epoch_ref:a.source_epoch_ref,input_decoded_bytes_by_case:manifest_refs.map(c=>({audit_id:c.audit_id,bytes:c.input_decoded_bytes})),captures,resource_sample:boundary(),shared_capacity:lastCapacity,metadata_bytes:metadataBytes,manual_reader_opening:false,quality_gate_pass:false,own_exit_claimed:false},262144);
    boundary();process.exitCode=0;
  }catch(error){const code=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/u.test(error.code)?error.code:'CONTEXT_HELD';try{put('HELD.json',{schema:'focal-context-held-v1',status:'HELD',code,source_payloads_opened:sourceOpened,current_audit_id:currentAudit,completed_cases:manifest_refs,partial_current_decoded_input_bytes:decoded,origin_ns:String(origin),initial_active_carry_ms:982654,resource_sample:boundary(),quality_gate_pass:false},65536);}catch{}try{io.writeSync(2,JSON.stringify({status:'HELD',code,source_payloads_opened:sourceOpened})+'\n');}catch{}process.exitCode=77;}finally{io.closeSync(journalFD);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();

