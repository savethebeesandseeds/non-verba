// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE: a separately admitted successor, never a reset of an old pager.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {validateAdmission, sourceCopyTotals, validateUnusableDisposition} from './successor-policy.mjs';

export const ROOT_ACTIVATED = false;
const R='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
const S='/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2';
const SOURCE='82a3dab1396336edccf77f27a7800cccddff67ca928e919e824a663e1d563601';
const PACKET={path:'audits/049d0f4fe07080f7e7f0/coding.json',sha256:'51143feeddcc5f35be66a62748642adb1af7442ffea7134e640816f68f2943e2',bytes:1643742};
const VERIFY={path:'qa/current-v6-combined-registry-verification-20261018-v1/verification.json',sha256:'4ca8e30f837c958a4c3e7a189b90e17cc890953ebc67ca55ca02b777fef7a3d5',bytes:11877};
const NATIVE={path:'qa/current-v6-combined-registry-verification-20261018-v1/ROOT-native-process-observation.json',sha256:'83519cf0c7587953f4dbdca7534882b2503583e7289d4df41d0c53f0f34136d4',bytes:1346};
const PREFLIGHT={path:'qa/current-v6-coding-fixed500-metadata-preflight-20261018-v1/result.json',sha256:'88354c0633c9f6be5be78f87973770c3bb93c31f5756b02201d656154889a2b3',bytes:2787};
const FROZEN_READER={path:S+'/lib/audit-reader.mjs',sha256:'a00d1a3203be40dbc5b6497dd938031c3461ad6954f98651da95275034c2b3c9',bytes:13693};
const B=R+'/coding/open-coding-b/current-v6/run-v2';
const B_READER={path:B+'/audit-reader-subdivided.mjs',sha256:'8a69da8b944184c0b1be436e152c10291450940858a5cdfb4d1a7ab6f0b67b49',bytes:14573};
const B_PARTITIONS={path:B+'/native-projection-partitions.mjs',sha256:'b040efedce424b9f06ad2769e9372a0d5a2f21fe9a52c6b0887646612925a142',bytes:4865};
const DECORATOR={path:S+'/lib/source-decoration.mjs',sha256:'a857d39a2da390175a1f817b4d2704ed1adbacff84ba6a27fefff7aee70f77fd',bytes:56630};
const A=R+'/coding/open-coding-a/current-v6/run-v1';
const TECHNICAL={path:A+'/technical-extraction-0103-status.json',sha256:'f7fe9044a73b9ed70bf5fbc89e4da7e9c74efe92fc0baf387062acd676eee575',bytes:1394};
const SCOPE={path:A+'/source-input-scope-0103-images.json',sha256:'6594ee9715e1557389837c77a296a7c5fd18c205ca1d46cd5379c07a08ed7c76',bytes:4592};
const SELF=fileURLToPath(import.meta.url), D=path.dirname(SELF);
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=c=>{throw Object.assign(Error(c),{code:c});};
const check=(v,c)=>{if(!v)fail(c);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const encode=v=>Buffer.from(JSON.stringify(v)+'\n');
const n5=n=>String(n).padStart(5,'0');
const caseId=n=>'coding-'+String(n).padStart(4,'0');

// Also used by source-free controls: no mutating path may enter a predecessor.
export function ownedWritePath(root,target){
  check(typeof root==='string'&&path.isAbsolute(root)&&path.resolve(root)===root,'SUCCESSOR_WRITE_ROOT');
  check(typeof target==='string'&&path.resolve(target)===target&&target.startsWith(root+path.sep),'SUCCESSOR_OWN_WRITE_ONLY');
  return target;
}
export function validateRequestInterval(m){
  check(Number.isSafeInteger(m.offset)&&m.offset>=0&&Number.isSafeInteger(m.limit)&&m.limit>0&&m.limit<=20000&&m.range&&Number.isSafeInteger(m.range.total_characters)&&m.range.total_characters>=m.offset&&m.range.offset===m.offset&&m.range.end===Math.min(m.offset+m.limit,m.range.total_characters),'SUCCESSOR_REQUEST_INTERVAL');
  return true;
}
export function joinedPageState({oldEmitted,oldAcknowledged,newEmitted,newAcknowledged}){
  const arrays=[oldEmitted,oldAcknowledged,newEmitted,newAcknowledged],total=oldEmitted?.length;
  check(Number.isSafeInteger(total)&&total>0&&arrays.every(a=>Array.isArray(a)&&a.length===total&&a.every(v=>typeof v==='boolean')),'SUCCESSOR_PAGE_STATE');
  const emitted=[],acknowledged=[];
  for(let i=0;i<total;i++){
    check(!(oldEmitted[i]&&newEmitted[i])&&!(oldAcknowledged[i]&&newAcknowledged[i])&&(!oldAcknowledged[i]||oldEmitted[i]),'SUCCESSOR_OLD_TRANSITION_IMMUTABLE');
    emitted.push(oldEmitted[i]||newEmitted[i]);acknowledged.push(oldAcknowledged[i]||newAcknowledged[i]);
    check(!acknowledged[i]||emitted[i],'SUCCESSOR_ACK_WITHOUT_EMISSION');
    if(i>0&&emitted[i])check(acknowledged[i-1],'SUCCESSOR_PAGE_GAP');
  }
  return {emitted,acknowledged};
}
export function validateObservedPage(args,pageRef,pageUTF16){
  check(args.outputSHA===pageRef.sha256&&args.outputBytes===pageRef.bytes&&args.outputUTF16===pageUTF16&&Number.isSafeInteger(args.wholeToolOutputUTF16)&&args.wholeToolOutputUTF16>=pageUTF16&&args.wholeToolOutputUTF16<=9000&&args.outerToolResponseObservedComplete===true&&args.outerTruncationMarkerObserved===false&&args.forwardedStdoutExactPrepared===true,'SUCCESSOR_WHOLE_TOOL_OBSERVATION');
  return true;
}
function regular(p,{directory=false}={}){
  check(path.isAbsolute(p)&&path.resolve(p)===p,'SUCCESSOR_ABSOLUTE_PATH');
  let at=path.parse(p).root;
  for(const name of p.slice(at.length).split(path.sep).filter(Boolean)){at=path.join(at,name);check(!fs.lstatSync(at).isSymbolicLink(),'SUCCESSOR_SYMLINK');}
  const st=fs.lstatSync(p);check(directory?st.isDirectory():st.isFile()&&st.nlink===1,'SUCCESSOR_REGULAR_PATH');return st;
}
function bytes(p,max=134217728){const st=regular(p);check(st.size<=max,'SUCCESSOR_FILE_BOUND');const b=fs.readFileSync(p,{flag:fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW});check(b.length===st.size,'SUCCESSOR_SIZE_CHANGED');return b;}
function bound(ref,max=134217728){
  check(ref&&typeof ref.path==='string'&&/^[a-f0-9]{64}$/.test(ref.sha256)&&Number.isSafeInteger(ref.bytes)&&ref.bytes>0&&ref.bytes<=max,'SUCCESSOR_EXACT_REF');
  const p=path.isAbsolute(ref.path)?ref.path:path.resolve(R,ref.path);
  check(p.startsWith(R+'/')||p.startsWith(S+'/'),'SUCCESSOR_READ_SCOPE');
  const b=bytes(p,max);check(b.length===ref.bytes&&H(b)===ref.sha256,'SUCCESSOR_PIN');return b;
}
const json=ref=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bound(ref,262144)));
const read=p=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes(p,262144)));
function reference(p){const b=bytes(p,262144);return {path:p,sha256:H(b),bytes:b.length};}
function put(p,v){ownedWritePath(D,p);regular(path.dirname(p),{directory:true});const b=Buffer.isBuffer(v)?v:encode(v);fs.writeFileSync(p,b,{flag:'wx',mode:0o600});return {path:p,sha256:H(b),bytes:b.length};}
function mkdir(p){ownedWritePath(D,p);regular(path.dirname(p),{directory:true});fs.mkdirSync(p,{mode:0o700});}
function names(p,max=20000){regular(p,{directory:true});const a=fs.readdirSync(p);check(a.length<=max,'SUCCESSOR_ENTRY_BOUND');return a.sort();}
function sourceCopyBytes(){let total=Math.max(regular(D,{directory:true}).size,8192);for(const n of names(D)){if(/\.(?:mjs|cjs)$/.test(n)||n==='phase-admission.json')total+=regular(D+'/'+n).size;}return total;}
function lockState(a){return a.predecessor.permanent_locks.map(p=>{const st=regular(p,{directory:true});return [p,st.dev,st.ino,st.size,st.mode,st.mtimeMs,st.ctimeMs];});}
function active(admissionRef){
  check(ROOT_ACTIVATED&&process.platform==='linux'&&process.env.NONVERBA_CONTAINER==='1','SUCCESSOR_INACTIVE');
  check(process.execArgv.includes('--max-old-space-size=512')&&process.execArgv.includes('--disable-proto=throw')&&['LD_PRELOAD','LD_AUDIT','NODE_OPTIONS','NODE_PATH','BASH_ENV','ENV'].every(k=>!process.env[k]),'SUCCESSOR_ENV');
  check(admissionRef?.path===D+'/phase-admission.json','SUCCESSOR_ADMISSION_PATH');const a=json(admissionRef);
  validateAdmission(a,{selfPath:SELF,measuredSourceCopyBytes:sourceCopyBytes(),nowNS:process.hrtime.bigint(),nowWallMS:Date.now()});
  bound(a.helper_ref,65536);bound(a.policy_module_ref,65536);const old=json(a.predecessor.admission_ref);bound(a.predecessor.pager_ref,65536);
  check(a.helper_ref.path===SELF&&a.policy_module_ref.path===D+'/successor-policy.mjs','SUCCESSOR_MODULE_PATH');
  check(old.status==='ADMITTED'&&old.admitted_by==='ROOT'&&old.reviewer_id===a.reviewer_id&&old.source_sha256===SOURCE&&old.authority==='NONE'&&same(old.helper,a.predecessor.pager_ref)&&Date.parse(old.expires_at)===a.predecessor.expired_deadline_wall_ms&&old.limits.phase_ms===a.predecessor.original_phase_ms,'SUCCESSOR_EXACT_EXPIRED_PREDECESSOR');
  check(Date.now()>=Date.parse(old.expires_at),'SUCCESSOR_PREDECESSOR_NOT_EXPIRED');
  check(process.resourceUsage().maxRSS*1024<=a.limits.rss_bytes,'SUCCESSOR_RSS');lockState(a);return a;
}
function registryGuard(a){
  bound(PACKET);bound(NATIVE,65536);bound(PREFLIGHT,65536);bound(FROZEN_READER,65536);
  if(a.reviewer_id==='open_coding_clean_b'){bound(B_READER,65536);bound(B_PARTITIONS,65536);bound(DECORATOR,65536);}
  const v=json(VERIFY);check(v.result.source_sha256===SOURCE&&v.result.observed===6&&v.result.resolved===6&&v.result.representation_issues.observed===6&&v.result.representation_issues.resolved===6&&v.source_quality_gate_pass===false,'SUCCESSOR_VERIFIED_REGISTRY');
  for(const [kind,rows]of [['source-issues',v.result.issues],['representation-issues',v.result.representation_issues.issues]]){
    for(const row of rows)for(const k of ['issue','resolution','replay'])bound(row[k]);
    for(const [location,key]of [['observed','issue'],['resolutions/'+SOURCE,'resolution']])check(same(names(R+'/'+kind+'/'+location),rows.map(r=>path.basename(r[key].path)).sort()),'SUCCESSOR_REGISTRY_ROSTER_CHANGED');
  }
}
function request(ref,inherited,a){
  const m=json(ref),dir=path.dirname(path.isAbsolute(ref.path)?ref.path:R+'/'+ref.path);
  check(m.schema==='prepared-source-response-v1'&&/^r[0-9]{6}$/.test(m.request_id)&&m.source_sha256===SOURCE&&same(m.packet,PACKET)&&['raw','parent'].includes(m.source)&&Array.isArray(m.pages)&&m.pages.length>0&&m.pages.length<=10000&&m.actual_reading===false,'SUCCESSOR_REQUEST_METADATA');
  validateRequestInterval(m);
  if(inherited)check(m.audit_id===caseId(a.carry.fixed_case_cursor)&&dir===a.predecessor.root+'/requests/'+m.request_id,'SUCCESSOR_INHERITED_CURRENT_CASE_ONLY');
  else check(dir===D+'/requests/'+m.request_id,'SUCCESSOR_NEW_REQUEST_PATH');
  for(const p of m.pages)check(p.path===dir+'/page-'+n5(m.pages.indexOf(p)+1)+'.json'&&Number.isSafeInteger(p.bytes)&&p.bytes>0,'SUCCESSOR_PAGE_PATH');
  return {id:m.request_id,dir,manifest:m,manifest_ref:ref,inherited};
}
function requests(a){
  const rows=a.pending_manifest_refs.map(r=>request(r,true,a));
  for(const n of names(D+'/requests')){check(/^r[0-9]{6}$/.test(n),'SUCCESSOR_REQUEST_NAME');rows.push(request(reference(D+'/requests/'+n+'/manifest.json'),false,a));}
  rows.sort((x,y)=>x.id.localeCompare(y.id));check(new Set(rows.map(r=>r.id)).size===rows.length,'SUCCESSOR_DUPLICATE_REQUEST');return rows;
}
function transitionDir(r){return r.inherited?D+'/retained-transitions/'+r.id:r.dir;}
function statePath(r,kind,page){const own=transitionDir(r)+'/'+kind+'-'+n5(page)+'.json';if(fs.existsSync(own))return own;return r.inherited?r.dir+'/'+kind+'-'+n5(page)+'.json':own;}
function pageState(r,a){
  const emitted=[],acknowledged=[],refs=[],oldEmitted=[],oldAcknowledged=[],newEmitted=[],newAcknowledged=[];
  for(let i=0;i<r.manifest.pages.length;i++){
    const p=r.manifest.pages[i],ep=statePath(r,'emitted',i+1),ap=statePath(r,'ack',i+1),e=fs.existsSync(ep),k=fs.existsSync(ap);check(!k||e,'SUCCESSOR_ACK_WITHOUT_EMISSION');
    if(e){const v=read(ep);check(same(v.page_ref,p)&&v.reviewer_id===a.reviewer_id,'SUCCESSOR_EMISSION_METADATA');refs.push(reference(ep));}
    if(k){const v=read(ap);check(same(v.page_ref,p)&&v.reviewer_id===a.reviewer_id&&v.observed_by_reviewer===true&&v.human===false&&v.authority==='NONE','SUCCESSOR_ACK_METADATA');refs.push(reference(ap));}
    emitted.push(e);acknowledged.push(k);
    oldEmitted.push(r.inherited&&fs.existsSync(r.dir+'/emitted-'+n5(i+1)+'.json'));oldAcknowledged.push(r.inherited&&fs.existsSync(r.dir+'/ack-'+n5(i+1)+'.json'));
    newEmitted.push(fs.existsSync(transitionDir(r)+'/emitted-'+n5(i+1)+'.json'));newAcknowledged.push(fs.existsSync(transitionDir(r)+'/ack-'+n5(i+1)+'.json'));
  }
  const joined=joinedPageState({oldEmitted,oldAcknowledged,newEmitted,newAcknowledged});check(same(joined.emitted,emitted)&&same(joined.acknowledged,acknowledged),'SUCCESSOR_TRANSITION_JOIN');
  return {emitted,acknowledged,refs};
}
const allAcknowledged=(r,a)=>pageState(r,a).acknowledged.every(Boolean);
function terminals(a){
  const out=[];
  for(const [folder,kind]of [['case-completions','READING_COMPLETE'],['dispositions','UNUSABLE_SOURCE_UNCODED']])for(const n of names(D+'/'+folder)){
    check(/^coding-[0-9]{4}\.json$/.test(n),'SUCCESSOR_TERMINAL_NAME');const v=read(D+'/'+folder+'/'+n);check(v.audit_id+'.json'===n&&v.reviewer_id===a.reviewer_id&&v.authority==='NONE','SUCCESSOR_TERMINAL_METADATA');
    if(kind==='UNUSABLE_SOURCE_UNCODED')check(v.status===kind&&v.final_reading===false&&v.meaningful_coding===false&&v.replacement===false,'SUCCESSOR_UNUSABLE_TERMINAL');
    out.push({audit_id:v.audit_id,kind});
  }
  out.sort((x,y)=>x.audit_id.localeCompare(y.audit_id));for(let i=0;i<out.length;i++)check(out[i].audit_id===caseId(a.carry.fixed_case_cursor+i),'SUCCESSOR_TERMINAL_ORDER');
  check(a.carry.fixed_case_cursor+out.length<=501,'SUCCESSOR_FIXED500');return out;
}
function current(a){const n=a.carry.fixed_case_cursor+terminals(a).length;return n<=500?caseId(n):null;}
function accounting(a,rows,reserve={visible:0,capture:0,artifact:0}){
  for(const k of ['visible','capture','artifact'])check(Number.isSafeInteger(reserve[k])&&reserve[k]>=0,'SUCCESSOR_RESERVATION');
  let fileBytes=0,directoryBytes=0,entries=0;function walk(p){check(++entries<=200000,'SUCCESSOR_OWNED_TREE_BOUND');const st=fs.lstatSync(p);check(!st.isSymbolicLink(),'SUCCESSOR_OWNED_SYMLINK');if(st.isDirectory()){directoryBytes+=st.size;for(const n of fs.readdirSync(p))walk(p+'/'+n);}else{check(st.isFile()&&st.nlink===1,'SUCCESSOR_OWNED_FILE');fileBytes+=st.size;}}walk(D);
  let visible=a.carry.visible_bytes,capture=a.carry.capture_bytes+fileBytes;
  for(const r of rows){const states=pageState(r,a);for(let i=0;i<states.emitted.length;i++)if(states.emitted[i]&&(!r.inherited||statePath(r,'emitted',i+1).startsWith(D+'/'))){visible+=r.manifest.pages[i].bytes;capture+=r.manifest.pages[i].bytes;}}
  const artifact=a.carry.artifact_bytes+fileBytes+directoryBytes;
  for(const [k,v]of Object.entries({visible,capture,artifact}))check(Number.isSafeInteger(v)&&v+reserve[k]<=a.limits[k+'_bytes'],'SUCCESSOR_CUMULATIVE_'+k.toUpperCase());
  return {visible_bytes:visible,capture_bytes:capture,artifact_bytes:artifact,new_file_bytes:fileBytes,new_directory_bytes:directoryBytes,source_copy:sourceCopyTotals(a),predecessor_elapsed_floor_ms:a.carry.elapsed_ms,successor_elapsed_ms:Number(process.hrtime.bigint()-BigInt(a.phase.origin_ns))/1e6};
}
function coverage(rows,source,start,end){const spans=rows.filter(r=>r.manifest.source===source).map(r=>[r.manifest.range.offset,r.manifest.range.end]).sort((a,b)=>a[0]-b[0]);let at=start;for(const [s,e]of spans){if(s>at)break;if(e>at)at=e;if(at>=end)return true;}return false;}
function completeCoverage(rows,a){
  check(rows.length&&rows.every(r=>allAcknowledged(r,a)),'SUCCESSOR_UNREAD_RESPONSE');const parent=rows.filter(r=>r.manifest.source==='parent'),raw=rows.filter(r=>r.manifest.source==='raw');
  const full=rs=>rs.length>0&&rs.every(r=>r.manifest.range.total_characters===rs[0].manifest.range.total_characters)&&coverage(rows,rs[0].manifest.source,0,rs[0].manifest.range.total_characters);
  return {parent:full(parent),raw:full(raw)};
}
function endCheck(a,admissionRef,start,locks){check(process.hrtime.bigint()-start<=BigInt(a.limits.tool_ms)*1000000n,'SUCCESSOR_TOOL_DEADLINE');active(admissionRef);check(same(locks,lockState(a)),'SUCCESSOR_PREDECESSOR_LOCK_CHANGED');}

export async function invoke(admissionRef,{action,args={}}={}){
  check(['status','prepare','emit','acknowledge','confirmCase','disposeUnusable'].includes(action),'SUCCESSOR_ACTION');
  const a=active(admissionRef),start=process.hrtime.bigint(),locks=lockState(a);registryGuard(a);
  const legacy=await import(pathToFileURL(a.predecessor.pager_ref.path).href); // Pure existing transport checks only; expired entry points are never called.
  const rows=requests(a);accounting(a,rows,{visible:65536,capture:65536,artifact:131072});
  if(action==='status'){const t=terminals(a);endCheck(a,admissionRef,start,locks);return {current_case:current(a),predecessor_semantic_final_cases:a.carry.semantic_final_cases,new_reading_complete_cases:t.filter(r=>r.kind==='READING_COMPLETE').length,new_semantic_final_cases_inferred:0,unusable_source_cases:t.filter(r=>r.kind==='UNUSABLE_SOURCE_UNCODED').length,requests:rows.map(r=>({request_id:r.id,audit_id:r.manifest.audit_id,pages:r.manifest.pages.length,acknowledged_pages:pageState(r,a).acknowledged.filter(Boolean).length})),accounting:accounting(a,rows),formal500_gate_satisfied:false,source_quality_gate_pass:false,authority:'NONE'};}
  mkdir(D+'/operation-lock'); // Failure keeps the new lock. No predecessor is ever written or unlocked.
  let result;
  if(action==='prepare'){
    const {auditId,source,offset,limit}=args;check(auditId===current(a)&&['raw','parent'].includes(source)&&Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=20000,'SUCCESSOR_ORDERED_REQUEST');
    check(!(a.reviewer_id==='open-coding-a'&&auditId==='coding-0103'),'SUCCESSOR_0103_DISPOSITION_REQUIRED');
    check(rows.every(r=>allAcknowledged(r,a))&&!rows.some(r=>r.manifest.audit_id===auditId&&r.manifest.source===source&&r.manifest.offset===offset&&r.manifest.limit===limit),'SUCCESSOR_PENDING_OR_REPEATED_REQUEST');
    const id='r'+String(Math.max(0,...rows.map(r=>Number(r.id.slice(1))))+1).padStart(6,'0'),d=D+'/requests/'+id;mkdir(d);
    put(d+'/request.json',{audit_id:auditId,source,offset,limit,packet:PACKET,source_sha256:SOURCE,showProposedHeading:false,nativeDecorations:'all',actual_reading:false});
    const reader=a.reviewer_id==='open_coding_clean_b'?B_READER:FROZEN_READER,{readAuditSource}=await import(pathToFileURL(reader.path).href);
    const value=await readAuditSource(R,PACKET.path,auditId,{source,offset,limit,showProposedHeading:false,nativeDecorations:'all'});
    check(value.purpose==='coding'&&value.audit_id===auditId&&value.source===source&&same(value.packet,PACKET)&&!['proposed_heading','source_navigation','source_navigation_anchors'].some(k=>Object.hasOwn(value,k))&&(source!=='parent'||Object.hasOwn(value,'native_source_decorations')),'SUCCESSOR_SOURCE_ONLY_SHAPE');
    const serialized=JSON.stringify(value),response=Buffer.from(serialized),pages=legacy.paginateJSON(serialized,{requestId:id,responseSHA:H(response)}),pageBytes=pages.reduce((n,p)=>n+Buffer.byteLength(p),0);
    accounting(a,rows,{visible:pageBytes,capture:response.length+2*pageBytes+65536,artifact:response.length+pageBytes+131072});endCheck(a,admissionRef,start,locks);
    const responseRef=put(d+'/response.json',response),pageRefs=pages.map((p,i)=>put(d+'/page-'+n5(i+1)+'.json',Buffer.from(p)));
    const manifest=put(d+'/manifest.json',{schema:'prepared-source-response-v1',actual_reading:false,request_id:id,audit_id:auditId,source,offset,limit,range:value.range,source_sha256:SOURCE,packet:PACKET,response:responseRef,pages:pageRefs,capture_bytes:response.length+pageBytes,all_source_json_retained:true,authority:'NONE'});
    result={request_id:id,pages:pages.length,manifest,actual_reading:false};
  }else if(action==='emit'||action==='acknowledge'){
    const r=rows.find(r=>r.id===args.requestId);check(r&&r.manifest.audit_id===current(a),'SUCCESSOR_CURRENT_RETAINED_REQUEST');
    for(const p of rows){if(p===r)break;check(allAcknowledged(p,a),'SUCCESSOR_EARLIER_RESPONSE_UNREAD');}
    const states=pageState(r,a);legacy.forwardPage({action:action==='emit'?'emit':'ack',page:args.page,total:r.manifest.pages.length,...states});
    const pageRef=r.manifest.pages[args.page-1],target=transitionDir(r);if(r.inherited&&!fs.existsSync(target))mkdir(target);
    if(action==='emit'){
      const b=bound(pageRef,65536);check(new TextDecoder('utf8',{fatal:true}).decode(b).length<=a.limits.page_utf16&&a.limits.page_utf16+500<=9000,'SUCCESSOR_VISIBLE_PAGE_UTF16');accounting(a,rows,{visible:b.length,capture:b.length+16384,artifact:32768});endCheck(a,admissionRef,start,locks);
      put(target+'/emitted-'+n5(args.page)+'.json',{schema:'immutable-source-page-emission-v1',reviewer_id:a.reviewer_id,page_ref:pageRef,response:r.manifest.response,actual_reading:false,authority:'NONE',successor_admission:admissionRef});
      await new Promise((resolve,reject)=>process.stdout.write(b,e=>e?reject(e):resolve()));result=undefined;
    }else{
      check(args.pageSHA===pageRef.sha256,'SUCCESSOR_ACK_PAGE_PIN');const observed=legacy.observedToolJoin(args),pageUTF16=new TextDecoder('utf8',{fatal:true}).decode(bound(pageRef,65536)).length;validateObservedPage(args,pageRef,pageUTF16);endCheck(a,admissionRef,start,locks);
      result={ack:put(target+'/ack-'+n5(args.page)+'.json',{schema:'separate-observed-source-page-ack-v1',reviewer_id:a.reviewer_id,kind:'AGENT',human:false,authority:'NONE',adopted:false,observed_by_reviewer:true,external_tool_observation:observed,whole_tool_output_utf16:args.wholeToolOutputUTF16,outer_tool_response_observed_complete:true,outer_truncation_marker_observed:false,forwarded_stdout_exact_prepared:true,page_ref:pageRef,emission:reference(statePath(r,'emitted',args.page)),successor_admission:admissionRef})};
    }
  }else if(action==='confirmCase'){
    check(args.auditId===current(a),'SUCCESSOR_CURRENT_CASE');const own=rows.filter(r=>r.manifest.audit_id===args.auditId),cov=completeCoverage(own,a);
    check(!(a.reviewer_id==='open-coding-a'&&args.auditId==='coding-0103'),'SUCCESSOR_0103_NOT_A_SEMANTIC_FINAL');
    check(cov.parent&&Array.isArray(args.requiredRawRanges)&&args.requiredRawRanges.length>0&&args.requiredRawRanges.every(r=>Array.isArray(r)&&r.length===2&&r.every(Number.isSafeInteger)&&r[0]>=0&&r[1]>r[0]&&coverage(own,'raw',r[0],r[1])),'SUCCESSOR_COMPLETE_AUTHORED_SCOPE');
    check(args.readingRef?.path==='readings/'+args.auditId+'.json','SUCCESSOR_OWN_READING_PATH');const readingRef={...args.readingRef,path:D+'/'+args.readingRef.path},authored=JSON.parse(bound(readingRef,8388608));
    check(authored.audit_id===args.auditId&&authored.reviewer_id===a.reviewer_id&&authored.authority==='NONE'&&authored.human===false&&authored.adopted===false&&authored.partial===false&&authored.relevant_original_context_complete===true&&authored.native_inputs_complete===true,'SUCCESSOR_OWN_AUTHORED_READING');endCheck(a,admissionRef,start,locks);
    result={completion:put(D+'/case-completions/'+args.auditId+'.json',{schema:'own-case-reading-coverage-receipt-v1',audit_id:args.auditId,reviewer_id:a.reviewer_id,human:false,authority:'NONE',adopted:false,reading:readingRef,required_raw_ranges:args.requiredRawRanges,source_responses:own.map(r=>r.manifest_ref),all_emitted_pages_separately_acknowledged:true,successor_admission:admissionRef,scope:'MECHANICAL_COVERAGE_AND_AUTHORED_DECLARATION; NO_SEMANTIC_OR_SOURCE_QUALITY_VALIDATION'})};
  }else if(action==='disposeUnusable'){
    check(args.auditId===current(a)&&a.reviewer_id==='open-coding-a'&&args.auditId==='coding-0103'&&Object.keys(args).length===1,'SUCCESSOR_ONLY_FIXED_0103_DISPOSITION');
    const own=rows.filter(r=>r.manifest.audit_id===args.auditId),cov=completeCoverage(own,a),t=json(TECHNICAL),s=json(SCOPE);
    const technicalKeys=['extraction_status','whole_normalized_characters','selected_parent_is_whole_normalized_text','extracted_parent_count','extracted_flat_unit_count','nonempty_normalized_origins_from_HTML_BODY','all_nonempty_normalized_origins_in_SGML_filing_headers','referenced_image_count','image_pixels_read','admitted_parent_native_projection_pages_observed_and_ACKed','admitted_full_raw_HTML_pages_observed_and_ACKed','source_availability_finding_only','current_accepted_extraction_defect_claim','original_source_quality_complete'];
    const scopeKeys=['complete_admitted_text_and_projection','original_visual_input_complete','new_fetches','new_API_calls','case_remains_partial'];
    const technical=Object.fromEntries(technicalKeys.map(k=>[k,t[k]])),scope={...Object.fromEntries(scopeKeys.map(k=>[k,s[k]])),images:s.images.map(i=>({pixel_content_read:i.pixel_content_read,OCR_read:i.OCR_read}))};
    const evidenceRefs=[TECHNICAL,SCOPE,...own.flatMap(r=>[r.manifest_ref,...pageState(r,a).refs])];
    const disposition=validateUnusableDisposition({auditId:args.auditId,reviewerId:a.reviewer_id,technical,scope,evidenceRefs,ownRawCoverageComplete:cov.raw,ownParentNativeCoverageComplete:cov.parent});endCheck(a,admissionRef,start,locks);
    result={disposition:put(D+'/dispositions/'+args.auditId+'.json',{...disposition,authority:'NONE',human:false,adopted:false,successor_admission:admissionRef,formal500_gate_satisfied:false})};
  }
  endCheck(a,admissionRef,start,locks);accounting(a,requests(a));fs.rmdirSync(ownedWritePath(D,D+'/operation-lock'));
  return result===undefined?undefined:{...result,next_case:current(a),formal500_gate_satisfied:false,source_quality_gate_pass:false,authority:'NONE'};
}
