// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED. Fixed0047 forward reading; old reader mains stay closed.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const R='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
const Q=R+'/qa/literal-emphasis-parent-v1-focal-context-review-v1';
const POLICY={path:Q+'/ROOT-review-policy-v2.json',sha256:'0c73083a159d9f711895fbaa95d8b3f14cca80e0e0fde62e57e19f3c99d038d2',bytes:10546};
const ID={audit_id:'development-0047',contract_id:'contract-c11bca9418c0ce310898',case_id:'2c91b95ff2d1024bd9afdb1d25e0d6deebb7e75639002a8daf0ff14a6d7cd568'};
const SOURCE='874c6b505ae5fc09fd3d92d46c64cd5474abf90fe574537c5e101b4fcaac6afa';
const NODE={path:'/opt/nonverba-tools/node/bin/node',sha256:'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48',bytes:124827920};
const FLAGS=['--max-old-space-size=256','--disable-proto=throw','--experimental-vm-modules'];
const BUILTINS=['node:crypto','node:fs','node:path','node:url','node:zlib'];
const DOCS=['focal_text','raw_full','finite9_parent'];
const SELF=fileURLToPath(import.meta.url),H=b=>createHash('sha256').update(b).digest('hex');
const C=v=>Array.isArray(v)?'['+v.map(C).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+C(v[k])).join(',')+'}':JSON.stringify(v);
const same=(a,b)=>C(a)===C(b),check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});};
const int=(v,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const J=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const text=b=>{const s=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);check(Buffer.from(s).equals(b),'REVIEW_UTF8');return s;};
const now=process.hrtime.bigint.bind(process.hrtime);
const rowKeys=['schema','index','admission_sha256','epoch_sha256','document','full_sha256','full_utf16_length','page_index','start_utf16','end_utf16','has_more','page_body_sha256','reply_sha256','reply_utf16_units','reply_utf8_bytes','visible_before','visible_after','previous_row_sha256'];

function noLinks(file,directory=false){
 check(typeof file==='string'&&path.posix.isAbsolute(file)&&path.posix.normalize(file)===file&&!file.includes('\0'),'REVIEW_PATH');
 let at='/';for(const part of file.split('/').filter(Boolean)){at=path.posix.join(at,part);const s=fs.lstatSync(at);check(!s.isSymbolicLink()&&((at!==file||directory)?s.isDirectory():s.isFile()),'REVIEW_LINK_KIND');}return fs.lstatSync(file);
}
function ref(r,max=262144,empty=false){check(r&&Object.keys(r).sort().join('|')==='bytes|path|sha256'&&sha(r.sha256)&&int(r.bytes,empty?0:1,max),'REVIEW_REF');noLinks(r.path);return r;}
const plain=r=>({path:r.path,sha256:r.sha256,bytes:r.bytes});
function read(r,max=262144,empty=false,opaque=false){
 ref(r,max,empty);const s=noLinks(r.path);check(s.size===r.bytes&&s.nlink===1,'REVIEW_FILE_IDENTITY');
 const fd=fs.openSync(r.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const a=fs.fstatSync(fd);check(a.isFile()&&a.dev===s.dev&&a.ino===s.ino&&a.size===s.size,'REVIEW_OPEN_IDENTITY');
  const hash=createHash('sha256'),b=Buffer.alloc(opaque?Math.min(1048576,Math.max(1,r.bytes)):r.bytes);let at=0;
  while(at<r.bytes){const n=fs.readSync(fd,b,opaque?0:at,Math.min(opaque?b.length:r.bytes-at,r.bytes-at),at);check(n>0,'REVIEW_SHORT_READ');hash.update(b.subarray(opaque?0:at,(opaque?0:at)+n));at+=n;}
  const z=fs.fstatSync(fd),p=noLinks(r.path);check(fs.readSync(fd,Buffer.alloc(1),0,1,at)===0&&z.dev===a.dev&&z.ino===a.ino&&z.size===a.size&&z.mtimeMs===a.mtimeMs&&z.ctimeMs===a.ctimeMs&&p.dev===a.dev&&p.ino===a.ino&&hash.digest('hex')===r.sha256,'REVIEW_FILE_HASH');return opaque?null:b;
 }finally{fs.closeSync(fd);}
}
function json(r,max){const b=read(r,max),v=JSON.parse(text(b));check(J(v).equals(b),'REVIEW_JSON_ENCODING');return v;}
function procText(file){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const b=Buffer.alloc(4097),n=fs.readSync(fd,b,0,b.length,0);check(n<=4096,'REVIEW_PROC_BOUND');return text(b.subarray(0,n));}finally{fs.closeSync(fd);}}
function openSession(){try{fs.lstatSync(Q+'/READING-CLOSED.json');check(false,'REVIEW_SESSION_CLOSED');}catch(e){if(e.code!=='ENOENT')throw e;}}
function identity(v){return v&&same({audit_id:v.audit_id,contract_id:v.contract_id,case_id:v.case_id},ID);}

function guard(policy){
 const g=json(policy.guard_ref,32768),{projection_sha256,...body}=g;
 check(g.schema==='stored-reader-complete-fresh100-guard-v1'&&g.source_epoch_sha256==='48372b760ebbf6a06ccb488642201335c944dc2ff1b7f65a7a18269e158a0464'&&sha(projection_sha256)&&H(C(body))===projection_sha256&&Array.isArray(g.rows)&&g.rows.length===100&&Array.isArray(g.contract_ids)&&g.contract_ids.length===29,'REVIEW_FULL_GUARD');
 const audits=new Set(),ids=new Set();for(const r of g.rows){check(r&&Object.keys(r).sort().join('|')==='audit_id|contract_id'&&typeof r.audit_id==='string'&&r.audit_id.length>0&&r.audit_id.length<=256&&typeof r.contract_id==='string'&&r.contract_id.length>0&&r.contract_id.length<=256&&!audits.has(r.audit_id),'REVIEW_GUARD_ROW');audits.add(r.audit_id);ids.add(r.contract_id);}
 check(ids.size===29&&same([...ids].sort(),g.contract_ids)&&!ids.has(ID.contract_id)&&g.fresh_packet_ref?.sha256===policy.original_fresh_ref.sha256&&g.fresh_packet_ref.bytes===policy.original_fresh_ref.bytes&&R+'/'+g.fresh_packet_ref.path===policy.original_fresh_ref.path,'REVIEW_PROTECTED_CID');return g;
}
function oldGraph(p){
 const r=p.prior_Q12,oldPolicy=json(r.policy_ref),completion=json(r.completion_ref),admission=json(r.admission_ref),epoch=json(r.source_epoch_ref),pending=json(r.pending_ref),manifest=json(r.manifest_ref),descriptor=json(r.descriptor_ref),closed=json(r.reading_closed_ref),carry=json(p.prior_Q17_closed_ref);
 read(r.reading_journal_ref,16777216,false,true);
 const oldCase=completion.cases?.find(c=>c.audit_id===ID.audit_id),pendingCase=pending.manifest_refs?.find(c=>c.audit_id===ID.audit_id),binding=oldPolicy.source_metadata_bindings?.find(c=>c.audit_id===ID.audit_id);
 check(completion.schema==='two-case-source-only-completion-v1'&&completion.status==='COMPLETE_SOURCE_ONLY_PREPARATION_NOT_QUALITY'&&completion.original_actor_absent===true&&completion.quality_gate_pass===false&&same(completion.admission_ref,r.admission_ref)&&same(completion.source_epoch_ref,r.source_epoch_ref)&&same(completion.pending_ref,r.pending_ref)&&same(completion.metadata_guard_ref,p.guard_ref)&&identity(oldCase)&&same(oldCase.manifest_ref,r.manifest_ref),'REVIEW_Q12_COMPLETION');
 check(admission.schema==='ROOT_TWO_CASE_SOURCE_ONLY_ADMISSION_V1'&&admission.status==='ADMITTED_PREPARATION_AND_BOUNDED_EXPLORATORY_PAGES'&&same(admission.policy_ref,r.policy_ref)&&same(admission.source_epoch_ref,r.source_epoch_ref)&&same(admission.source_refs,epoch.source_refs)&&admission.model_access===false&&admission.quality_gate_pass===false,'REVIEW_Q12_ADMISSION');
 check(pending.schema==='two-case-source-only-exit-pending-v1'&&pending.status==='PENDING_EXTERNAL_ROOT_EXIT_READBACK'&&same(pending.admission_ref,r.admission_ref)&&same(pending.source_epoch_ref,r.source_epoch_ref)&&identity(pendingCase)&&same(pendingCase.manifest_ref,r.manifest_ref),'REVIEW_Q12_PENDING');
 check(closed.schema==='ROOT-two-case-source-only-reading-close-v1'&&closed.status==='EXPLORATORY_SOURCE_READINGS_RECORDED_NO_FURTHER_PUBLICATION'&&closed.source_preparation_and_viewing_clock_closed===true&&same(closed.preparation_proof_ref,r.completion_ref)&&same(closed.reader_journal_ref,r.reading_journal_ref)&&closed.viewed_pages===34&&closed.visible_reply_bytes===199714&&closed.case0047_original_HTML_and_parent_finite_unread===true&&closed.quality_gate_pass===false&&closed.authority==='NONE','REVIEW_Q12_CLOSED');
 check(manifest.schema==='exploratory-source-only-output-manifest-v1'&&identity(manifest)&&same(manifest.admission_ref,r.admission_ref)&&same(manifest.source_epoch_ref,r.source_epoch_ref)&&same(manifest.metadata_guard_ref,p.guard_ref)&&same(manifest.descriptor_ref,r.descriptor_ref),'REVIEW_Q12_MANIFEST');
 check(binding&&identity(binding)&&same(binding.metadata_inputs.guard,p.guard_ref)&&same(binding.current_manifest_ref,p.original_current_manifest_ref)&&same(binding.fresh_ref,p.original_fresh_ref)&&binding.current_source_sha256===SOURCE,'REVIEW_Q12_ORIGINAL_SOURCE');
 check(descriptor.schema==='fixed-case-source-only-adverse-comparison-descriptor-v1'&&descriptor.audit_id===ID.audit_id&&descriptor.contract_id===ID.contract_id&&descriptor.current_source_sha256===SOURCE&&descriptor.focal_kind==='ACTUAL_UNIT'&&descriptor.focal_equals_parent_range===false&&descriptor.focal.start===38881&&descriptor.focal.end===40677&&descriptor.parent.start===5397&&descriptor.parent.end===49138&&descriptor.non_native_fields_equal===true&&descriptor.selection_equal===true&&descriptor.normalized_literal_equal===true&&descriptor.source_words_truncated===false&&descriptor.source_quality_passed===false&&descriptor.actual_source_open_authority===false&&descriptor.authority==='NONE','REVIEW_Q12_DESCRIPTOR');
 check(same(p.ordered_documents.map(d=>d.name),DOCS)&&p.ordered_documents.length===3,'REVIEW_DOCUMENT_ORDER');for(const d of p.ordered_documents){const v=d.ref;check(v&&Object.keys(v).sort().join('|')==='bytes|decoded_bytes|decoded_sha256|encoding|path|sha256'&&same(v,manifest.documents[d.name])&&v.encoding==='identity'&&v.bytes===v.decoded_bytes&&v.sha256===v.decoded_sha256&&int(v.bytes,1,33554432)&&v.path===r.manifest_ref.path.slice(0,-'manifest.json'.length)+d.name+'.txt','REVIEW_DOCUMENT_BINDING');}
 check(p.ordered_documents[0].ref.bytes===1796&&p.ordered_documents[0].ref.sha256===descriptor.focal.sha256&&p.ordered_documents[1].ref.bytes===111801&&p.ordered_documents[1].ref.sha256===descriptor.raw_sha256&&p.ordered_documents[2].ref.bytes===66219,'REVIEW_FIXED_DOCUMENTS');
 check(carry.schema==='ROOT-focal-context-clock-closed-v1'&&carry.source_context_clock_closed===true&&carry.source_context_active_ms_charged===998290&&carry.charged_pilot_bytes===389448731&&carry.cumulative_private_and_metadata_capture_bytes===543445&&carry.cumulative_journal_rows===3762&&carry.cumulative_journal_bytes===1379113&&carry.unused_reservations_not_refunded===true&&carry.quality_gate_pass===false&&carry.authority==='NONE'&&same(carry.completion_ref,p.prior_context_completion_ref)&&same(carry.execution_ref,p.prior_context_execution_ref)&&same(p.prior_context_closed_ref,p.prior_Q17_closed_ref),'REVIEW_Q17_CARRY');
 read(p.original_current_manifest_ref,8388608,false,true);read(p.original_fresh_ref,8388608,false,true);return manifest;
}

function journalBytes(fd){const s=fs.fstatSync(fd);check(s.isFile()&&s.nlink===1&&s.uid===process.getuid()&&(s.mode&0o077)===0&&s.size<=1048576,'REVIEW_JOURNAL_FILE');const b=Buffer.alloc(s.size);let at=0;while(at<b.length){const n=fs.readSync(fd,b,at,b.length-at,at);check(n>0,'REVIEW_JOURNAL_SHORT');at+=n;}check(fs.fstatSync(fd).size===s.size,'REVIEW_JOURNAL_CHANGED');return b;}
function journalRows(bytes,a,p){
 const rows=[],state=new Map();let from=0,previous=null,visible=0;
 for(let at=0;at<bytes.length;at++)if(bytes[at]===10){const line=bytes.subarray(from,at+1);check(line.length<=1024&&3762+rows.length+1<=16384,'REVIEW_JOURNAL_ROW_BOUND');const r=JSON.parse(text(line)),d=p.ordered_documents.find(d=>d.name===r.document),old=state.get(r.document);
  check(Buffer.from(JSON.stringify(r)+'\n').equals(line)&&Object.keys(r).sort().join('|')===[...rowKeys].sort().join('|')&&r.schema==='focal-context-review-row-v1'&&r.index===rows.length+1&&r.admission_sha256===a.ref.sha256&&r.epoch_sha256===a.value.source_epoch_ref.sha256&&d&&r.full_sha256===d.ref.sha256&&r.previous_row_sha256===previous,'REVIEW_JOURNAL_CHAIN');
  check(!old?.complete&&int(r.full_utf16_length,1,33554432)&&int(r.page_index,1,4524)&&r.page_index===(old?.page_index??0)+1&&r.start_utf16===(old?.end??0)&&int(r.end_utf16,r.start_utf16+1,r.full_utf16_length)&&r.end_utf16-r.start_utf16<=6000&&typeof r.has_more==='boolean'&&r.has_more===(r.end_utf16<r.full_utf16_length)&&(!old||old.length===r.full_utf16_length)&&sha(r.page_body_sha256)&&sha(r.reply_sha256)&&int(r.reply_utf16_units,1,7500)&&int(r.reply_utf8_bytes,1,65536)&&r.visible_before===visible&&r.visible_after===visible+r.reply_utf8_bytes,'REVIEW_JOURNAL_CURSOR');
  check(DOCS.slice(0,DOCS.indexOf(r.document)).every(d=>state.get(d)?.complete===true),'REVIEW_DOCUMENT_FORWARD_ORDER');visible=r.visible_after;state.set(r.document,{end:r.end_utf16,page_index:r.page_index,length:r.full_utf16_length,complete:!r.has_more});rows.push(r);previous=H(line);from=at+1;
 }
 check(from===bytes.length,'REVIEW_JOURNAL_PARTIAL');return{rows,state,visible,previous};
}
function inventory(a,p){
 let bytes=0,entries=0,privateBytes=0,rows=3762,journalTotal=1379113,visible=0;const todo=[Q];
 while(todo.length){const f=todo.pop(),s=fs.lstatSync(f);check(!s.isSymbolicLink()&&++entries<=2048,'REVIEW_TREE_BOUND');bytes+=s.size;if(s.isDirectory()){for(const n of fs.readdirSync(f))todo.push(f+'/'+n);}else{check(s.isFile()&&s.nlink===1,'REVIEW_TREE_KIND');if(f.endsWith('.private.log'))privateBytes+=s.size;if(f.endsWith('.journal.ndjson')){check((journalTotal+=s.size)<=16777216,'REVIEW_JOURNAL_BYTES');const fd=fs.openSync(f,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);let b;try{b=journalBytes(fd);}finally{fs.closeSync(fd);}if(f===Q+'/reading.journal.ndjson'){const j=journalRows(b,a,p);visible=j.visible;rows+=j.rows.length;}else{let from=0;for(let i=0;i<b.length;i++)if(b[i]===10){check(i-from+1<=1024,'REVIEW_OTHER_JOURNAL_ROW');rows++;from=i+1;}check(from===b.length,'REVIEW_OTHER_JOURNAL_PARTIAL');}}}}
 check(bytes<=1048576&&389448731+bytes+visible+65536<=402653184&&543445+privateBytes+visible+65536<=1048576&&rows<=16384&&journalTotal<=16777216,'REVIEW_CUMULATIVE_BOUND');return{bytes,entries,private_bytes:privateBytes,rows,journal_bytes:journalTotal,visible_bytes:visible};
}
function policyChecks(p){
 check(p.schema==='ROOT_FOCAL_CONTEXT_REVIEW_POLICY_V1'&&p.QA_root===Q&&identity(p)&&p.source_sha256===SOURCE&&p.new_full_source_snapshot===false&&p.old_readers_remain_permanently_closed===true&&p.reviewer==='context_reader_0047'&&p.reviewer_is_agent_not_participant===true&&p.model_access===false&&p.tokenizer_access===false&&p.formal_coding_authority===false&&p.quality_gate_pass===false&&p.materiality_hold_clearance===false&&p.first_priors_decided===false&&p.authority==='NONE','REVIEW_POLICY_SCOPE');
 const expected={physical_QA_bytes:1048576,combined_cap_bytes:402653184,base_charged_bytes:389448731,initial_active_carry_ms:998290,cumulative_active_ms_cap:2798290,initial_capture_carry_bytes:543445,capture_total_bytes:1048576,initial_journal_rows:3762,initial_journal_bytes:1379113,journal_rows_cap:16384,journal_bytes_cap:16777216,journal_row_bytes:1024,page_utf16_limit:7500,page_utf8_limit:65536,page_source_utf16_limit:6000,document_decoded_limit:33554432,metadata_limit:262144,heap_MiB:256,RSS_bytes:1073741824,terminal_metadata_reservation_bytes:65536,terminal_physical_reservation_bytes:32768};
 check(Object.entries(expected).every(([k,v])=>p[k]===v)&&same(p.runtime_ref,NODE)&&same(p.node_flags,FLAGS),'REVIEW_POLICY_LIMITS');
}
async function initialize(admissionRef){
 openSession();ref(admissionRef);check(admissionRef.path===Q+'/ROOT-review-admission.json','REVIEW_ADMISSION_PATH');
 const p=json(POLICY);policyChecks(p);const a={ref:admissionRef,value:json(admissionRef)},v=a.value;
 check(v.schema==='ROOT_FOCAL_CONTEXT_REVIEW_ADMISSION_V1'&&v.status==='ADMITTED_FIXED0047_FORWARD_SOURCE_ONLY_REVIEW'&&v.root===Q&&same(v.policy_ref,POLICY)&&v.reviewer==='context_reader_0047'&&v.authority==='NONE'&&v.model_access===false&&v.tokenizer_access===false&&v.formal_coding_authority===false&&v.quality_gate_pass===false&&same(v.manual_review_scope,DOCS)&&same(v.select_page_ref,p.select_page_ref)&&same(v.capacity_helper_ref,p.capacity_helper_ref)&&same(v.capacity_policy_ref,p.capacity_policy_ref)&&same(v.runtime_ref,NODE)&&same(v.node_flags,FLAGS),'REVIEW_ADMISSION');
 check(v.clock_ref?.path===Q+'/clock.json'&&v.source_epoch_ref?.path===Q+'/ROOT-source-epoch.json'&&v.self_entry_ref?.path===Q+'/read.mjs'&&SELF===v.self_entry_ref.path,'REVIEW_NEW_SOURCE_PATHS');
 const clock=json(v.clock_ref),epoch=json(v.source_epoch_ref);
 check(clock.schema==='focal-context-review-clock-v1'&&clock.initial_active_carry_ms===998290&&clock.own_reading_claim===false&&same(clock.policy_ref,POLICY)&&typeof clock.origin_ns==='string'&&/^[0-9]{1,32}$/u.test(clock.origin_ns)&&clock.boot_id===procText('/proc/sys/kernel/random/boot_id').trim(),'REVIEW_CLOCK');
 check(epoch.schema==='focal-context-review-source-epoch-v1'&&same(epoch.runtime_ref,NODE)&&same(epoch.node_flags,FLAGS)&&same(epoch.source_refs,[v.self_entry_ref,v.select_page_ref,v.capacity_helper_ref])&&same([...epoch.builtins].sort(),BUILTINS),'REVIEW_SOURCE_EPOCH');
 check(process.platform==='linux'&&process.arch==='x64'&&process.version==='v22.23.3'&&process.env.NONVERBA_CONTAINER==='1'&&process.execPath===NODE.path&&same(process.execArgv,FLAGS),'REVIEW_RUNTIME');for(const k of['LD_PRELOAD','LD_AUDIT','NODE_OPTIONS','BASH_ENV','ENV'])check(process.env[k]===undefined,'REVIEW_INJECTED_ENV');
 const boundary=(reserve=0,extraVisible=0)=>{openSession();const n=now();check(n>=BigInt(clock.origin_ns)&&998290+Number((n-BigInt(clock.origin_ns)+999999n)/1000000n)<=2798290&&process.memoryUsage().rss<=1073741824,'REVIEW_ACTIVE_RSS');const b=inventory(a,p);check(b.bytes+reserve+32768<=1048576&&389448731+b.bytes+reserve+b.visible_bytes+extraVisible+65536<=402653184&&543445+b.private_bytes+b.visible_bytes+extraVisible+65536<=1048576,'REVIEW_PENDING_BOUND');return b;};
 boundary();read(NODE,NODE.bytes,false,true);for(const r of epoch.source_refs)read(r,262144);oldGraph(p);guard(p);boundary();
 const cp=json(v.capacity_policy_ref),{measureRunCapacity}=await import(pathToFileURL(v.capacity_helper_ref.path).href);let lastCapacity=null;
 const capacity=async()=>{const start=now(),m=await measureRunCapacity(R,cp,{io:fs}),end=now();check(end>=start&&end-start<=1000000000n&&int(m.bytes)&&m.bytes>=p.whole_RUN_floor&&m.bytes<=p.whole_RUN_cap&&m.bytes-p.growth_baseline<=p.growth_hard,'REVIEW_RUN_CAPACITY');lastCapacity={bytes:m.bytes,at_ns:end};boundary();return m.bytes;};
 const fresh=()=>{check(lastCapacity&&now()-lastCapacity.at_ns<=1000000000n,'REVIEW_CAPACITY_STALE');return boundary();};
 await capacity();const {selectPage}=await import(pathToFileURL(v.select_page_ref.path).href);check(typeof selectPage==='function','REVIEW_SELECT_PAGE_EXPORT');fresh();return{p,a,clock,epoch,boundary,capacity,fresh,selectPage};
}

/** The actual pinned metadata route; never reads a document or publishes a page. */
export async function preflight(admissionRef){
 const s=await initialize(admissionRef),shared=await s.capacity(),b=s.fresh();
 return Object.freeze({schema:'focal-context-review-metadata-preflight-v1',status:'PASS_METADATA_ONLY_NO_PAYLOAD',policy_ref:POLICY,admission_ref:admissionRef,source_epoch_ref:s.a.value.source_epoch_ref,clock_ref:s.a.value.clock_ref,audit_id:ID.audit_id,contract_id:ID.contract_id,document_count:3,ordered_document_ref_sha256s:s.p.ordered_documents.map(d=>d.ref.sha256),guard_ref:s.p.guard_ref,protected_rows:100,protected_contracts:29,case_excluded_from_protected_CIDs:true,prior_closed_graph_authenticated:true,shared_RUN_bytes:shared,initial_active_carry_ms:998290,cumulative_active_ms_cap:2798290,base_charged_bytes:389448731,resource_inventory:b,actual_metadata_only:true,document_payloads_opened:false,actual_source_exposed_to_model:false,quality_gate_pass:false,authority:'NONE'});
}

export async function main(args){
 check(Array.isArray(args)&&args.length===4&&args[0]===Q+'/ROOT-review-admission.json'&&sha(args[1])&&/^[1-9][0-9]{0,5}$/u.test(args[2]??'')&&DOCS.includes(args[3]),'REVIEW_ARGUMENTS');
 const s=await initialize({path:args[0],sha256:args[1],bytes:Number(args[2])}),{p,a,boundary,capacity,fresh,selectPage}=s;
 boundary(4096);const lockPath=Q+'/reader.lock',lock=fs.openSync(lockPath,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600),lockStat=fs.fstatSync(lock);let fd=null;
 try{
  const lockBytes=Buffer.from(String(process.pid)+'\n');check(fs.writeSync(lock,lockBytes)===lockBytes.length,'REVIEW_LOCK_WRITE');fs.fsyncSync(lock);
  const journal=Q+'/reading.journal.ndjson';try{noLinks(journal);}catch(e){if(e.code!=='ENOENT')throw e;}boundary(4096);fd=fs.openSync(journal,fs.constants.O_RDWR|fs.constants.O_APPEND|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK,0o600);
  const journalBirth=fs.fstatSync(fd),original=journalBytes(fd),cursor=journalRows(original,a,p),name=args[3],old=cursor.state.get(name);
  check(!old?.complete&&DOCS.slice(0,DOCS.indexOf(name)).every(d=>cursor.state.get(d)?.complete===true),'REVIEW_FORWARD_ONLY');
  const loaded=new Map();let decoded=0;
  for(const d of p.ordered_documents.slice(0,DOCS.indexOf(name)+1)){
   await capacity();openSession();guard(p);fresh();const b=read(plain(d.ref),33554432);decoded+=b.length;check(decoded<=33554432&&b.length===d.ref.decoded_bytes&&H(b)===d.ref.decoded_sha256,'REVIEW_DOCUMENT_BOUND');const literal=text(b);check(literal.length>0,'REVIEW_EMPTY_DOCUMENT');loaded.set(d.name,literal);boundary();
  }
  // Authenticate every committed page, including the prior document's terminal row.
  for(const r of cursor.rows){const literal=loaded.get(r.document);check(typeof literal==='string','REVIEW_REPLAY_DOCUMENT');const page=selectPage(literal,r.start_utf16,{audit_id:ID.audit_id,document:r.document,page_index:r.page_index,full_sha256:r.full_sha256}),b=page.body;check(r.full_utf16_length===literal.length&&r.end_utf16===b.range.end_utf16&&r.has_more===b.has_more&&r.page_body_sha256===b.page_body_sha256&&r.reply_sha256===H(Buffer.from(page.serialized))&&r.reply_utf16_units===page.serialized.length&&r.reply_utf8_bytes===Buffer.byteLength(page.serialized),'REVIEW_STRICT_PAGE_REPLAY');}
  const literal=loaded.get(name),d=p.ordered_documents.find(d=>d.name===name),page=selectPage(literal,old?.end??0,{audit_id:ID.audit_id,document:name,page_index:(old?.page_index??0)+1,full_sha256:d.ref.sha256}),b=page.body,replyBytes=Buffer.byteLength(page.serialized);
  check(identity(b)&&b.document===name&&page.serialized.length<=7500&&replyBytes<=65536&&replyBytes>0,'REVIEW_PAGE_BOUND');
  const row={schema:'focal-context-review-row-v1',index:cursor.rows.length+1,admission_sha256:a.ref.sha256,epoch_sha256:a.value.source_epoch_ref.sha256,document:name,full_sha256:d.ref.sha256,full_utf16_length:literal.length,page_index:b.page_index,start_utf16:b.range.start_utf16,end_utf16:b.range.end_utf16,has_more:b.has_more,page_body_sha256:b.page_body_sha256,reply_sha256:H(Buffer.from(page.serialized)),reply_utf16_units:page.serialized.length,reply_utf8_bytes:replyBytes,visible_before:cursor.visible,visible_after:cursor.visible+replyBytes,previous_row_sha256:cursor.previous},line=Buffer.from(JSON.stringify(row)+'\n');
  check(line.length<=1024,'REVIEW_PRECHARGE_ROW_BOUND');await capacity();guard(p);const before=fresh();check(before.visible_bytes===cursor.visible&&before.rows+1<=16384&&before.journal_bytes+line.length<=16777216,'REVIEW_PRECHARGE_LEDGER');boundary(line.length,replyBytes);check(journalBytes(fd).equals(original),'REVIEW_CONCURRENT_READER');
  const pathStat=noLinks(journal);check(pathStat.dev===journalBirth.dev&&pathStat.ino===journalBirth.ino&&pathStat.size===original.length,'REVIEW_JOURNAL_REPLACED');openSession();check(fs.writeSync(fd,line)===line.length,'REVIEW_PRECHARGE_SHORT');fs.fsyncSync(fd);
  const committed=journalBytes(fd);check(committed.equals(Buffer.concat([original,line])),'REVIEW_CONCURRENT_COMMIT');journalRows(committed,a,p);const after=noLinks(journal);check(after.dev===journalBirth.dev&&after.ino===journalBirth.ino,'REVIEW_COMMIT_REPLACED');
  // Failed delivery is charged and never replayed/refunded. Nothing writes on rejection.
  fresh();openSession();process.stdout.on('error',()=>{});await new Promise((resolve,reject)=>process.stdout.write(page.serialized,error=>error?reject(error):resolve()));
 }finally{
  if(fd!==null)fs.closeSync(fd);fs.closeSync(lock);const at=noLinks(lockPath);check(at.dev===lockStat.dev&&at.ino===lockStat.ino,'REVIEW_LOCK_REPLACED');fs.unlinkSync(lockPath);
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===SELF)main(process.argv.slice(2)).catch(()=>{process.exitCode=77;});
