// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED: two fixed matched context preparations, no model or tokenizer access.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {fileURLToPath,pathToFileURL} from 'node:url';

const R='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
const Q=R+'/qa/literal-emphasis-parent-v1-matched-context-arms-v1';
const POLICY={path:Q+'/ROOT-matched-policy.json',sha256:'2dbb1e5f041cb71a64fcc7dd32f71073b09f1c1d2343f14910d360ea0adf463c',bytes:28611};
const NODE={path:'/opt/nonverba-tools/node/bin/node',sha256:'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48',bytes:124827920};
const FLAGS=['--max-old-space-size=256','--disable-proto=throw','--experimental-vm-modules'];
const H=b=>createHash('sha256').update(b).digest('hex');
const J=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const C=v=>Array.isArray(v)?'['+v.map(C).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+C(v[k])).join(',')+'}':JSON.stringify(v);
const check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});};
const same=(a,b)=>C(a)===C(b);
const exactText=b=>{const s=b.toString('utf8');check(Buffer.from(s).equals(b),'MATCHED_UTF8');return s;};

async function main(){
  const origin=process.hrtime.bigint(),now=process.hrtime.bigint.bind(process.hrtime);
  const io=Object.freeze(Object.fromEntries(Object.getOwnPropertyNames(fs).filter(k=>typeof fs[k]==='function').map(k=>[k,fs[k].bind(fs)])));
  const constants=Object.freeze({...fs.constants}),memory=process.memoryUsage.bind(process),pid=process.pid;
  const argv=[...process.argv],env={...process.env},entry=fileURLToPath(import.meta.url);
  const [admissionPath,admissionSHA,admissionSize,...extra]=argv.slice(2);
  check(!extra.length&&admissionPath===Q+'/ROOT-matched-admission.json'&&/^[a-f0-9]{64}$/u.test(admissionSHA??'')&&/^[1-9][0-9]{0,5}$/u.test(admissionSize??''),'MATCHED_ARGUMENTS');
  function noLinks(file,directory=false){check(path.posix.isAbsolute(file)&&path.posix.normalize(file)===file,'MATCHED_PATH');let at='/';for(const n of file.split('/').filter(Boolean)){at=path.posix.join(at,n);const s=io.lstatSync(at);check(!s.isSymbolicLink()&&((at!==file||directory)?s.isDirectory():s.isFile()),'MATCHED_LINK_KIND');}const out=io.lstatSync(file);check(directory||out.nlink===1,'MATCHED_HARDLINK');return out;}
  function read(ref,max=8388608){check(ref&&Object.keys(ref).sort().join('|')==='bytes|path|sha256'&&Number.isSafeInteger(ref.bytes)&&ref.bytes>=0&&ref.bytes<=max&&/^[a-f0-9]{64}$/u.test(ref.sha256),'MATCHED_REF');const s=noLinks(ref.path);check(s.size===ref.bytes,'MATCHED_REF_SIZE');const fd=io.openSync(ref.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const before=io.fstatSync(fd);check(before.dev===s.dev&&before.ino===s.ino&&before.size===s.size&&before.nlink===1,'MATCHED_FD');const b=Buffer.alloc(ref.bytes);let at=0;while(at<b.length){const n=io.readSync(fd,b,at,b.length-at,at);check(n>0,'MATCHED_SHORT');at+=n;}const after=io.fstatSync(fd);check(io.readSync(fd,Buffer.alloc(1),0,1,at)===0&&before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&after.nlink===1&&H(b)===ref.sha256,'MATCHED_REF_HASH');return b;}finally{io.closeSync(fd);}}
  function json(ref,max){const b=read(ref,max),v=JSON.parse(exactText(b));check(J(v).equals(b),'MATCHED_JSON');return v;}
  function tree(){let bytes=0,entries=0;const todo=[Q];while(todo.length){const p=todo.pop(),s=io.lstatSync(p);check(!s.isSymbolicLink()&&++entries<=2048,'MATCHED_TREE');bytes+=s.size;if(s.isDirectory())for(const n of io.readdirSync(p))todo.push(p+'/'+n);else check(s.isFile()&&s.nlink===1,'MATCHED_TREE_KIND');}return{bytes,entries};}
  noLinks(Q,true);io.mkdirSync(Q+'/captures',{mode:0o700});
  function capture(fd,name){const file=Q+'/captures/'+name+'.private.log',opened=io.openSync(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600),before=io.fstatSync(opened);io.closeSync(fd);const bound=io.openSync(file,constants.O_WRONLY|constants.O_NOFOLLOW),after=io.fstatSync(bound);io.closeSync(opened);check(bound===fd&&before.dev===after.dev&&before.ino===after.ino&&io.readlinkSync('/proc/'+pid+'/fd/'+fd)===file,'MATCHED_CAPTURE');return{path:file,dev:before.dev,ino:before.ino};}
  const captures=[capture(1,'stdout'),capture(2,'stderr')];
  const journalPath=Q+'/preparation.journal.ndjson',journalFD=io.openSync(journalPath,constants.O_CREAT|constants.O_EXCL|constants.O_APPEND|constants.O_WRONLY|constants.O_NOFOLLOW,0o600),journalStat=io.fstatSync(journalFD);
  let held=null,policy,measure,capacityPolicy,lastCapacity=null,journalRows=0,journalBytes=0,metadataBytes=0,decoded=0,sourceOpened=false,currentAudit=null; const manifest_refs=[];
  process.on('SIGTERM',()=>held??='MATCHED_SIGTERM');process.on('SIGINT',()=>held??='MATCHED_SIGINT');
  const elapsed=()=>1573333+Number((now()-origin+999999n)/1000000n);
  function boundary(final=false){check(!held||final,'MATCHED_STOP');const owned=tree(),rss=memory().rss,captureBytes=842024+captures.reduce((n,r)=>n+io.lstatSync(r.path).size,0);check(elapsed()<=2173333&&rss<=1073741824&&owned.bytes<=16777216&&440229847+owned.bytes<=469762048&&captureBytes<=1048576,'MATCHED_RESOURCE');return{elapsed_ms:elapsed(),rss_bytes:rss,owned_bytes:owned.bytes,charged_pilot_bytes:440229847+owned.bytes,capture_bytes:captureBytes};}
  function put(relative,value,max=8388608,final=false){if(sourceOpened&&!final)check(lastCapacity&&Number(now())/1e6-lastCapacity.at_ms<=1000,'MATCHED_CAPACITY_STALE');const b=Buffer.isBuffer(value)?value:J(value);check(relative.split('/').every(n=>n&&n!=='.'&&n!=='..')&&!relative.startsWith('/')&&b.length<=max,'MATCHED_WRITE');const before=boundary(final);check(before.owned_bytes+b.length+8192<=16777216,'MATCHED_WRITE_BOUND');let parent=Q;for(const n of relative.split('/').slice(0,-1)){parent+='/'+n;if(!io.existsSync(parent))io.mkdirSync(parent,{mode:0o700});noLinks(parent,true);}const p=Q+'/'+relative;if(sourceOpened&&!final)check(lastCapacity&&Number(now())/1e6-lastCapacity.at_ms<=1000,'MATCHED_CAPACITY_STALE');const fd=io.openSync(p,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{io.writeFileSync(fd,b);io.fsyncSync(fd);}finally{io.closeSync(fd);}const ref={path:p,sha256:H(b),bytes:b.length};read(ref,max);boundary(final);return ref;}
  function note(event){const b=Buffer.from(JSON.stringify({index:journalRows,event})+'\n');check(b.length<=1024&&3795+journalRows+1<=16384&&1404547+journalBytes+b.length<=16777216,'MATCHED_JOURNAL');check(tree().bytes+b.length<=16777216,'MATCHED_JOURNAL_BOUND');const s=noLinks(journalPath),opened=io.fstatSync(journalFD);check(s.dev===journalStat.dev&&s.ino===journalStat.ino&&opened.dev===s.dev&&opened.ino===s.ino&&s.size===journalBytes&&opened.size===journalBytes,'MATCHED_JOURNAL_IDENTITY');check(io.writeSync(journalFD,b)===b.length,'MATCHED_JOURNAL_SHORT');io.fsyncSync(journalFD);journalRows++;journalBytes+=b.length;check(io.fstatSync(journalFD).size===journalBytes&&noLinks(journalPath).ino===journalStat.ino,'MATCHED_JOURNAL_COMMIT');boundary();}
  function metadata(ref,parse=true){check(metadataBytes+ref.bytes<=33554432,'MATCHED_METADATA_BOUND');const b=read(ref);metadataBytes+=b.length;return parse?{bytes:b,value:JSON.parse(exactText(b))}:{bytes:b};}
  async function capacity(){const started=Number(now())/1e6,result=await measure(R,capacityPolicy,{io});check(result.bytes>=12330904043&&result.bytes<=25769803776&&result.bytes-12330245718<=536870912&&Number(now())/1e6-started<=1000,'MATCHED_SHARED_CAPACITY');lastCapacity={bytes:result.bytes,at_ms:Number(now())/1e6};boundary();return lastCapacity;}
  const permits=new WeakMap();
  function payload(permit,ref,max=8388608){check(lastCapacity&&Number(now())/1e6-lastCapacity.at_ms<=1000,'MATCHED_CAPACITY_STALE');const p=permits.get(permit);check(p&&['contract-5e4763782d47aca7d67c','contract-c11bca9418c0ce310898'].includes(p.contract_id)&&!p.protected.has(p.contract_id)&&p.refs.some(r=>same(r,ref)),'MATCHED_PRIVATE_PAYLOAD_PERMIT');const renewed=metadata(p.guard_ref).value,{projection_sha256,...body}=renewed,ids=new Set(renewed.rows.map(r=>r.contract_id));check(same(renewed,p.guard)&&H(C(body))===projection_sha256&&renewed.rows.length===100&&new Set(renewed.rows.map(r=>r.audit_id)).size===100&&ids.size===29&&!ids.has(p.contract_id),'MATCHED_RECHECKED_FRESH_GUARD');boundary();check(lastCapacity&&Number(now())/1e6-lastCapacity.at_ms<=1000,'MATCHED_CAPACITY_STALE');const b=read(ref,max);sourceOpened=true;note({kind:'EXACT_PAYLOAD_READ',path:ref.path,sha256:ref.sha256,bytes:ref.bytes});return b;}
  function charge(n){check(Number.isSafeInteger(n)&&n>0&&n<=33554432-decoded,'MATCHED_INPUT_DECODED_BOUND');decoded+=n;}
  function unzip(bytes,size,hash){check(size<=33554432-decoded,'MATCHED_INPUT_DECODED_BOUND');const b=gunzipSync(bytes,{maxOutputLength:size});check(b.length===size&&H(b)===hash,'MATCHED_INPUT_DECODED_HASH');charge(b.length);boundary();return b;}
  try{
    check(process.platform==='linux'&&process.arch==='x64'&&process.version==='v22.23.3'&&env.NONVERBA_CONTAINER==='1'&&same(process.execArgv,FLAGS)&&process.execPath===NODE.path,'MATCHED_RUNTIME');for(const k of['LD_PRELOAD','LD_AUDIT','NODE_OPTIONS','BASH_ENV','ENV'])check(env[k]===undefined,'MATCHED_INJECTED_ENV');
    const ns=noLinks(NODE.path);check(ns.size===NODE.bytes,'MATCHED_NODE_SIZE');const nh=createHash('sha256'),nfd=io.openSync(NODE.path,constants.O_RDONLY|constants.O_NOFOLLOW),block=Buffer.alloc(1048576);try{let at=0;while(at<NODE.bytes){const n=io.readSync(nfd,block,0,Math.min(block.length,NODE.bytes-at),at);check(n>0,'MATCHED_NODE_SHORT');nh.update(block.subarray(0,n));at+=n;}check(io.readSync(nfd,Buffer.alloc(1),0,1,at)===0&&io.fstatSync(nfd).size===NODE.bytes&&nh.digest('hex')===NODE.sha256,'MATCHED_NODE_HASH');}finally{io.closeSync(nfd);}
    policy=json(POLICY);
    check(policy.schema==='ROOT_MATCHED_CONTEXT_ARMS_POLICY_V1'&&policy.base_charged_bytes===440229847&&policy.prior_charged_bytes===389898199&&policy.new_source_copy_reservation_bytes===33554432&&policy.post_result_source_copy_reservation_bytes===16777216&&policy.initial_source_active_ms===1573333&&policy.initial_capture_bytes===842024&&policy.cumulative_source_active_ms_cap===2173333&&policy.prior_snapshot_reservation_already_used===true&&policy.all_historical_caps_unchanged===true&&policy.unused_reservations_not_refunded===true,'MATCHED_CARRY_POLICY');
    const admissionRef={path:admissionPath,sha256:admissionSHA,bytes:Number(admissionSize)},a=json(admissionRef),bindings=policy.source_metadata_bindings;
    const identities=bindings.map(b=>({audit_id:b.audit_id,contract_id:b.contract_id,case_id:b.case_id}));
    check(a.schema==='ROOT_MATCHED_CONTEXT_ADMISSION_V1'&&a.status==='ADMITTED_TWO_FIXED_SOURCE_ONLY_MATCHED_CONTEXT_PREPARATIONS'&&a.root===Q&&same(a.policy_ref,POLICY)&&same(a.cases,identities)&&a.model_access===false&&a.tokenizer_access===false&&a.quality_gate_pass===false,'MATCHED_ADMISSION');
    const epoch=json(a.source_epoch_ref);check(epoch.schema==='matched-context-source-epoch-v1'&&same(epoch.runtime_ref,NODE)&&same(epoch.node_flags,FLAGS)&&same(a.runtime_ref,NODE)&&same(a.node_flags,FLAGS)&&epoch.source_refs.length<=256&&same(a.source_refs,epoch.source_refs)&&epoch.source_refs.some(r=>r.path===entry&&same(r,a.run_entry_ref)),'MATCHED_SOURCE_EPOCH');
    for(const r of epoch.source_refs){check(/^(?:\/tmp\/nonverba-unified-source\/[a-f0-9]{32}\/code\/|\/opt\/nonverba-tools\/priors-derivation-0\.1\/node_modules\/(?:parse5|entities)\/)/u.test(r.path),'MATCHED_SOURCE_SCOPE');read(r,262144);}
    for(const key of['custody_entry_ref','arms_entry_ref','checker_entry_ref'])check(epoch.source_refs.some(r=>same(r,a[key])),'MATCHED_ENTRY_PIN');
    read(a.capacity_helper_ref,262144);capacityPolicy=json(a.capacity_policy_ref);({measureRunCapacity:measure}=await import(pathToFileURL(a.capacity_helper_ref.path).href));await capacity();
    const context={
      policy:metadata(policy.context_policy_ref).value,completion:metadata(policy.context_completion_ref).value,
      admission:metadata(policy.context_admission_ref).value,epoch:metadata(policy.context_source_epoch_ref).value,
      pending:metadata(policy.context_pending_ref).value,manifest:metadata(policy.context_manifest_ref).value,
      closed:metadata(policy.context_closed_ref).value,terminal:metadata(policy.context_terminal_ref).value,
      followup:metadata(policy.context_followup_ref).value,summaries:policy.projection_inputs.map(b=>metadata(b.summary_ref).value)
    };
    check(Array.isArray(context.epoch.source_refs)&&context.epoch.source_refs.length<=256,'MATCHED_PRIOR_SOURCE_COUNT');for(const r of context.epoch.source_refs)read(r,262144);
    const review={closed:metadata(policy.review_closed_ref).value,terminal:metadata(policy.review_terminal_ref).value,declaration:metadata(policy.review_declaration_ref).value,observations:metadata(policy.review_observations_ref).value,audit:metadata(policy.review_metadata_audit_ref).value,final_copy:metadata(policy.prior_final_copy_ref).value};
    const guard=metadata(policy.guard_ref).value,baseline_summaries=policy.baseline_inputs.map(b=>metadata(b.summary_ref).value);
    metadata(bindings[0].current_manifest_ref,false);metadata(bindings[0].fresh_ref,false);
    const {validateMatchedInputCustody,verifyMatchedInputPair}=await import(pathToFileURL(a.custody_entry_ref.path).href),custody=validateMatchedInputCustody({policy,context,review,baseline_summaries,guard});
    check(same(custody.guard,guard)&&same(custody.cases.map(c=>c.row.audit_id),['development-0055','development-0047']),'MATCHED_FIXED_CASES');
    const {buildMatchedContextArms,verifyMatchedContextArms,summarizeMatchedContextArms}=await import(pathToFileURL(a.arms_entry_ref.path).href),limits=policy.arm_limits,protectedIDs=new Set(guard.rows.map(r=>r.contract_id));
    const plainRef=r=>({path:r.path,bytes:r.bytes,sha256:r.sha256});
    for(const [index,c] of custody.cases.entries()){
      const b=c.binding;decoded=0;currentAudit=b.audit_id;
      check(policy.baseline_inputs.some(x=>x.case_id===b.case_id&&same(x.baseline_ref,c.baseline_ref))&&policy.projection_inputs.some(x=>x.case_id===b.case_id&&same(x.projection_ref,c.projection_ref)),'MATCHED_INPUT_ALLOWLIST');
      const permit=Object.freeze({});permits.set(permit,{contract_id:b.contract_id,protected:protectedIDs,refs:[plainRef(c.baseline_ref),plainRef(c.projection_ref)],guard_ref:policy.guard_ref,guard});
      note({kind:'FIXED_MATCHED_CASE_ADMITTED',audit_id:b.audit_id,contract_id:b.contract_id,case_id:b.case_id,arm_limits:limits});
      await capacity();const plain=unzip(payload(permit,plainRef(c.baseline_ref)),c.baseline_ref.decoded_bytes,c.baseline_ref.decoded_sha256),input=JSON.parse(exactText(plain));
      check(Buffer.from(JSON.stringify(input)).equals(plain),'MATCHED_BASELINE_COMPACT_JSON');
      await capacity();const projected=unzip(payload(permit,plainRef(c.projection_ref)),c.projection_ref.decoded_bytes,c.projection_ref.decoded_sha256),projection=JSON.parse(exactText(projected));
      check(J(projection).equals(projected),'MATCHED_PROJECTION_PRETTY_JSON');
      verifyMatchedInputPair({policy,slot:c,baseline:input,projection,baseline_summary:baseline_summaries[index],projection_summary:context.summaries[index]});
      const inputHash=H(Buffer.from(JSON.stringify(input))),projectionHash=H(J(projection));
      await capacity();const result=buildMatchedContextArms({extraction:input.extraction,focal_id:c.row.focal_id,projection:projection.projection,limits});boundary();
      check(result&&result.artifact&&result.metadata&&H(Buffer.from(JSON.stringify(input)))===inputHash&&H(J(projection))===projectionHash,'MATCHED_INPUT_MUTATION');
      verifyMatchedContextArms({artifact:result.artifact,extraction:input.extraction,focal_id:c.row.focal_id,projection:projection.projection,limits});check(same(result.metadata,summarizeMatchedContextArms(result.artifact)),'MATCHED_SUMMARY_BINDING');
      const wrapper={schema:'fixed-source-matched-context-result-v1',audit_id:b.audit_id,contract_id:b.contract_id,case_id:b.case_id,baseline_ref:c.baseline_ref,projection_ref:c.projection_ref,context_completion_ref:policy.context_completion_ref,review_closed_ref:policy.review_closed_ref,source_epoch_ref:a.source_epoch_ref,policy_ref:POLICY,arms:result.artifact,quality_gate_pass:false,authority:'NONE'},output=J(wrapper);
      const summary={schema:'fixed-source-matched-context-summary-v1',audit_number:Number(b.audit_id.slice(-4)),case_id:b.case_id,baseline_ref_sha256:c.baseline_ref.sha256,projection_ref_sha256:c.projection_ref.sha256,source_sha256:policy.source_sha256,matched:result.metadata,input_decoded_bytes:decoded,output_arms_decoded_bytes:output.length,quality_gate_pass:false,authority:'NONE'},summaryBytes=J(summary);
      check(output.length+summaryBytes.length+262144<=33554432&&summaryBytes.length<=65536,'MATCHED_OUTPUT_DECODED_BOUND');const encoded=gzipSync(output,{level:6});check(encoded.length<=8388608,'MATCHED_OUTPUT_ENCODED_BOUND');
      await capacity();const arms_ref={...put('outputs/'+b.audit_id+'/arms.json.gz',encoded),encoding:'gzip',decoded_bytes:output.length,decoded_sha256:H(output)},summary_ref=put('outputs/'+b.audit_id+'/summary.json',summaryBytes,65536);
      manifest_refs.push({audit_id:b.audit_id,contract_id:b.contract_id,case_id:b.case_id,baseline_ref:c.baseline_ref,projection_ref:c.projection_ref,arms_ref,summary_ref,input_decoded_bytes:decoded,output_decoded_bytes:output.length+summaryBytes.length});
      await capacity();note({kind:'FIXED_MATCHED_CASE_COMPLETE',audit_id:b.audit_id,input_decoded_bytes:decoded,output_decoded_bytes:output.length+summaryBytes.length});
    }
    await capacity();const manifestRef=put('outputs/manifest.json',{schema:'matched-context-output-manifest-v1',status:'PREPARED_MATCHED_CONTEXT_ARMS_PENDING_EXTERNAL_EXIT',admission_ref:admissionRef,source_epoch_ref:a.source_epoch_ref,guard_ref:policy.guard_ref,cases:manifest_refs,failed_available:policy.failed_available,manual_reader_opening:false,model_access:false,tokenizer_access:false,quality_gate_pass:false,authority:'NONE'},262144);
    for(const c of manifest_refs)check(c.output_decoded_bytes+manifestRef.bytes<=33554432,'MATCHED_FINAL_OUTPUT_BOUND');
    const stat=io.readFileSync('/proc/'+pid+'/stat','utf8'),fields=stat.slice(stat.lastIndexOf(') ')+2).trim().split(/\s+/u),actor={pid,start_ticks:fields[19],group:Number(fields[2])},boot=io.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
    await capacity();put('exit-pending.json',{schema:'matched-context-exit-pending-v1',status:'PENDING_EXTERNAL_ROOT_EXIT_READBACK',actor,boot_id:boot,origin_ns:String(origin),initial_active_carry_ms:1573333,manifest_ref:manifestRef,admission_ref:admissionRef,guard_ref:policy.guard_ref,source_epoch_ref:a.source_epoch_ref,input_decoded_bytes_by_case:manifest_refs.map(c=>({audit_id:c.audit_id,bytes:c.input_decoded_bytes})),captures,resource_sample:boundary(),shared_capacity:lastCapacity,metadata_bytes:metadataBytes,manual_reader_opening:false,quality_gate_pass:false,own_exit_claimed:false},262144);
    boundary();process.exitCode=0;
  }catch(error){const code=held??(typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/u.test(error.code)?error.code:'MATCHED_HELD');try{put('HELD.json',{schema:'matched-context-held-v1',status:'HELD',code,source_payloads_opened:sourceOpened,current_audit_id:currentAudit,completed_cases:manifest_refs,partial_current_decoded_input_bytes:decoded,origin_ns:String(origin),initial_active_carry_ms:1573333,resource_sample:boundary(true),quality_gate_pass:false},65536,true);}catch{}try{io.writeSync(2,JSON.stringify({status:'HELD',code,source_payloads_opened:sourceOpened})+'\n');}catch{}process.exitCode=77;}finally{io.closeSync(journalFD);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
