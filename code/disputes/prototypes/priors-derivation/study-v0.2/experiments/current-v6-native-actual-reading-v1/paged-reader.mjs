// SPDX-License-Identifier: AGPL-3.0-only
// INACTIVE SOURCE. Run only after ROOT independently reviews and admits this exact file.
import {readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,relative,dirname,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {requireContainer} from 'file:///tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/lib/common.mjs';

const SHA=/^[a-f0-9]{64}$/u;
const LIMITS=Object.freeze({heap:536870912,rss:1073741824,phase_ms:1800000,visible_bytes:524288,capture_bytes:2097152,new_artifact_bytes:8388608,source_copy_bytes:65536,page_ms:60000,page_utf16:7000,response_utf16:7500});
const PACKAGE={path:'qa/native-change-current-v6-machine-preparation-20261018-v1/package.json',sha256:'f07500fe500b400ddf8cc9e83e59846baecb36cba60c88c6187c246374430b47',bytes:6556};
const OUTPUTS=Object.freeze([
  {id:'adjusted-libo-rate-floor',path:'qa/native-change-current-v6-machine-preparation-20261018-v1/read-output-adjusted-libo-rate-floor.json',sha256:'3146f0dbc6f6875ae610734fd60c42de2c1bfce7c348cafa654e21dd74c28776',bytes:106573,compact_utf16:64016,compact_bytes:64024,pages:10},
  {id:'libor-quoted-rate-floor',path:'qa/native-change-current-v6-machine-preparation-20261018-v1/read-output-libor-quoted-rate-floor.json',sha256:'9007b408507d79cb6ca38566af1be82a40a6a3d02d1b38d0656cd26abaae65bd',bytes:142079,compact_utf16:84914,compact_bytes:84922,pages:13},
  {id:'instruction-context',path:'qa/native-change-current-v6-machine-preparation-20261018-v1/read-output-instruction-context.json',sha256:'d53c8e8035d06e9f3ba475b039c28a92178b7456eedcb6284e557942cbe2b612',bytes:1614,compact_utf16:1515,compact_bytes:1515,pages:1}
]);
const STATE='qa/native-change-current-v6-actual-reading-20261018-v1';
const TOTAL=24,START_RESPONSE='STARTED native0 forward-only bounded paging; no actual review or adequacy judgment.\n';
const SCOPE={governing_parent_fully_read:false,whole_original_document_read:false,effectiveness_conditions_verified:false,clean_operative_version_derived:false,human:false,authority:'NONE',actual_review:false};
const sha=value=>createHash('sha256').update(value).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value)+'\n');
const need=(condition,message)=>{if(!condition)throw new Error(message);};
const uptime=()=>{const value=Number(readFileSync('/proc/uptime','utf8').split(' ')[0])*1000;need(Number.isFinite(value),'Unusable monotonic uptime');return value;};
const boot=()=>readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
const started=process.platform==='linux'?uptime():0;
let stateRoot,session;

function regular(path){
  need(isAbsolute(path),'Absolute path required');
  let current=path;
  for(;;){const stat=lstatSync(current);need(!stat.isSymbolicLink(),'Linked path forbidden');const parent=dirname(current);if(parent===current)break;current=parent;}
  need(lstatSync(path).isFile(),'Regular file required');
  return path;
}
function inside(root,path){
  need(typeof path==='string'&&!isAbsolute(path),'Literal relative path required');
  const full=resolve(root,path),tail=relative(root,full);need(tail&&!tail.startsWith('..')&&!isAbsolute(tail),'Path escaped run root');
  return full;
}
function readExact(root,ref){
  need(SHA.test(ref.sha256)&&Number.isSafeInteger(ref.bytes)&&ref.bytes>0,'Exact byte pin required');
  const path=regular(inside(root,ref.path));need(lstatSync(path).size===ref.bytes,'Pinned byte count differs');
  const bytes=readFileSync(path);need(bytes.length===ref.bytes&&sha(bytes)===ref.sha256,'Pinned input differs');return bytes;
}
function artifactSize(){
  let total=lstatSync(stateRoot).size;
  const names=readdirSync(stateRoot);need(names.length<=128,'Unexpected artifact count');
  for(const name of names){need(/^(?:session\.json|ABORTED\.json|emission-\d{2}\.(?:json|txt)|ack-\d{2}\.json)$/u.test(name),'Unexpected state artifact');const stat=lstatSync(join(stateRoot,name));need(stat.isFile()&&!stat.isSymbolicLink(),'Non-regular state artifact');total+=stat.size;}
  return total;
}
function guard(){
  const now=uptime(),memory=process.memoryUsage();
  need(memory.heapUsed<=LIMITS.heap&&memory.rss<=LIMITS.rss,'Sampled memory cap exceeded');
  need(now>=started&&now-started<=LIMITS.page_ms,'Per-invocation page time exceeded');
  if(session){need(boot()===session.boot_id&&now>=session.started_uptime_ms&&now-session.started_uptime_ms<=LIMITS.phase_ms,'Phase deadline or boot identity differs');}
  if(stateRoot)need(artifactSize()<=LIMITS.new_artifact_bytes,'New artifact cap exceeded');
  return now;
}
function writeExclusive(name,value){
  const bytes=Buffer.isBuffer(value)?value:encode(value);guard();
  need(artifactSize()+bytes.length+65536<=LIMITS.new_artifact_bytes,'New artifact cap reserve exceeded');
  writeFileSync(join(stateRoot,name),bytes,{flag:'wx',mode:0o600});guard();
  return {path:join(STATE,name),sha256:sha(bytes),bytes:bytes.length};
}
function readState(name){return JSON.parse(readFileSync(regular(join(stateRoot,name)),'utf8'));}
function pagePlan(runRoot){
  readExact(runRoot,PACKAGE);const pages=[];
  for(const ref of OUTPUTS){
    guard();const original=readExact(runRoot,ref),value=JSON.parse(original.toString('utf8'));
    need(value.schema==='native-change-actual-read-output-v1'&&value.actual_reading===false&&value.id===ref.id,'Output identity or no-reading declaration differs');
    // No replacer, selection, field removal, projection filter, or truncation.
    const compact=JSON.stringify(value);
    need(compact.length===ref.compact_utf16&&Buffer.byteLength(compact)===ref.compact_bytes,'Lossless compact length differs');
    const pieces=[];
    for(let from=0;from<compact.length;){let to=Math.min(from+LIMITS.page_utf16,compact.length);if(to<compact.length&&/[\uD800-\uDBFF]/u.test(compact[to-1])&&/[\uDC00-\uDFFF]/u.test(compact[to]))to--;pieces.push({from,to,text:compact.slice(from,to)});from=to;}
    need(pieces.length===ref.pages&&pieces.map(part=>part.text).join('')===compact,'Incomplete compact pagination');
    for(let index=0;index<pieces.length;index++)pages.push({...pieces[index],output:ref,page:index+1,pages:pieces.length,compact_sha256:sha(compact)});
  }
  need(pages.length===TOTAL,'Global page count differs');guard();return pages;
}
function responseFor(page,index){
  const header=JSON.stringify({schema:'native-v6-lossless-page-v1',global:index,total:TOTAL,id:page.output.id,page:page.page,pages:page.pages,utf16:[page.from,page.to],original_sha256:page.output.sha256,compact_sha256:page.compact_sha256,payload_sha256:sha(page.text)});
  const response=header+'\n'+page.text+'\n';
  need(page.text.length<=LIMITS.page_utf16&&response.length<=LIMITS.response_utf16,'Visible page bound exceeded');return response;
}
function ledger(pages){
  const names=new Set(readdirSync(stateRoot));need(!names.has('ABORTED.json'),'Phase already aborted; retry/reset forbidden');
  let visible=Buffer.byteLength(START_RESPONSE),capture=visible,acknowledged=0,pending=null;
  for(let index=1;index<=TOTAL;index++){
    const key=String(index).padStart(2,'0'),emissionName=`emission-${key}.json`,textName=`emission-${key}.txt`,ackName=`ack-${key}.json`;
    const emitted=names.has(emissionName),textExists=names.has(textName),acked=names.has(ackName);
    need(emitted===textExists&&(!acked||emitted),'Partial immutable emission or orphan ACK; no retry');
    if(!emitted){need(![...names].some(name=>/^(?:emission|ack)-\d{2}\./u.test(name)&&Number(name.slice(name.indexOf('-')+1,name.indexOf('.')))>index),'Forward index gap');break;}
    need(!pending&&index===acknowledged+1,'Emission order differs');
    const emission=readState(emissionName),response=responseFor(pages[index-1],index),textBytes=readFileSync(regular(join(stateRoot,textName)));
    need(textBytes.equals(Buffer.from(response))&&emission.global===index&&emission.response_sha256===sha(textBytes)&&emission.response_bytes===textBytes.length,'Retained emission differs');
    visible+=textBytes.length;capture+=textBytes.length;
    if(!acked){pending=emission;continue;}
    const ack=readState(ackName),receipt=`ACK native0 ${index}/${TOTAL}; transport only.\n`;
    need(ack.global===index&&ack.reader==='native0'&&ack.displayed_and_read===true&&typeof ack.observed_tool_chunk_id==='string'&&ack.observed_tool_chunk_id.length>0&&ack.response_sha256===emission.response_sha256&&ack.acknowledged_uptime_ms>=emission.emitted_uptime_ms,'Observed native0 ACK differs');
    visible+=Buffer.byteLength(receipt);capture+=Buffer.byteLength(receipt);acknowledged=index;
  }
  need(visible<=LIMITS.visible_bytes&&capture<=LIMITS.capture_bytes,'Capture/visible cap exceeded');
  return {visible,capture,acknowledged,pending};
}
function output(response,counts){
  const bytes=Buffer.byteLength(response);need(counts.visible+bytes<=LIMITS.visible_bytes&&counts.capture+bytes<=LIMITS.capture_bytes,'Capture/visible budget exhausted');guard();process.stdout.write(response);
}

try{
  requireContainer();need(process.platform==='linux','Managed Linux container required');
  need(process.execArgv.includes('--max-old-space-size=512'),'Pinned 512 MiB Node old-space limit required');
  const [action,runArg,admissionArg,admissionSHA,...args]=process.argv.slice(2);
  need(['start','next','ack'].includes(action)&&runArg&&admissionArg&&SHA.test(admissionSHA??''),'Expected action run-root admission-path admission-sha [ACK arguments]');
  const runRoot=realpathSync(runArg);need(isAbsolute(runArg)&&runRoot===resolve(runArg),'Exact unlinked run root required');
  regular(fileURLToPath(import.meta.url));const source=readFileSync(fileURLToPath(import.meta.url));need(source.length<=LIMITS.source_copy_bytes,'Helper source-copy cap exceeded');
  const admissionPath=regular(inside(runRoot,admissionArg)),admissionBytes=readFileSync(admissionPath);need(sha(admissionBytes)===admissionSHA,'Admission bytes differ');
  const admission=JSON.parse(admissionBytes.toString('utf8'));
  need(admission.schema==='native-v6-actual-reading-admission-v1'&&admission.approved===true&&admission.reader==='native0'&&admission.helper_sha256===sha(source)&&admission.source_copy_bytes===source.length&&admission.state_path===STATE&&JSON.stringify(admission.package)===JSON.stringify(PACKAGE)&&JSON.stringify(admission.outputs)===JSON.stringify(OUTPUTS)&&JSON.stringify(admission.limits)===JSON.stringify(LIMITS),'Independent ROOT admission or exact pins differ');
  stateRoot=inside(runRoot,STATE);
  if(action==='start'){
    need(args.length===0,'Unexpected start arguments');mkdirSync(stateRoot,{mode:0o700});
    session={schema:'native-v6-forward-reading-session-v1',admission:{path:admissionArg,sha256:admissionSHA,bytes:admissionBytes.length},helper_sha256:sha(source),source_copy_bytes:source.length,started_uptime_ms:started,boot_id:boot(),reader:'native0',limits:LIMITS,package:PACKAGE,outputs:OUTPUTS,...SCOPE};
    writeExclusive('session.json',session);pagePlan(runRoot);output(START_RESPONSE,{visible:0,capture:0});
  }else{
    regular(join(stateRoot,'session.json'));session=readState('session.json');
    need(session.admission.sha256===admissionSHA&&session.admission.path===admissionArg&&session.helper_sha256===sha(source)&&session.reader==='native0'&&JSON.stringify(session.limits)===JSON.stringify(LIMITS),'Immutable session differs');
    guard();const pages=pagePlan(runRoot),counts=ledger(pages);
    if(action==='next'){
      need(args.length===0&&!counts.pending&&counts.acknowledged<TOTAL,'Prior page requires observed native0 ACK, or reading is complete');
      const index=counts.acknowledged+1,key=String(index).padStart(2,'0'),response=responseFor(pages[index-1],index),bytes=Buffer.from(response);
      need(counts.visible+bytes.length<=LIMITS.visible_bytes&&counts.capture+bytes.length<=LIMITS.capture_bytes,'Capture/visible budget exhausted');
      const text=writeExclusive(`emission-${key}.txt`,bytes);
      writeExclusive(`emission-${key}.json`,{schema:'native-v6-immutable-page-emission-v1',global:index,total:TOTAL,output:pages[index-1].output,utf16:[pages[index-1].from,pages[index-1].to],response_sha256:sha(bytes),response_bytes:bytes.length,text,emitted_uptime_ms:guard(),...SCOPE});
      output(response,counts);
    }else{
      const [reader,indexString,chunk,responseSHA,affirmation]=args,index=Number(indexString),pending=counts.pending;
      need(args.length===5&&reader==='native0'&&Number.isSafeInteger(index)&&pending?.global===index&&typeof chunk==='string'&&/^[A-Za-z0-9._:-]{1,160}$/u.test(chunk)&&SHA.test(responseSHA??'')&&responseSHA===pending.response_sha256&&affirmation==='DISPLAYED_AND_READ_BY_NATIVE0','Only native0 may ACK its actually observed exact tool chunk');
      const now=guard();need(now>=pending.emitted_uptime_ms,'ACK monotonic time preceded emission; retry forbidden');
      const response=`ACK native0 ${index}/${TOTAL}; transport only.\n`;
      writeExclusive(`ack-${String(index).padStart(2,'0')}.json`,{schema:'native-v6-observed-tool-chunk-ack-v1',global:index,reader,observed_tool_chunk_id:chunk,response_sha256:responseSHA,displayed_and_read:true,acknowledged_uptime_ms:now,...SCOPE});
      output(response,counts);
    }
  }
}catch(error){
  // A partial write or any rejected operation is terminal. Never re-emit/reset.
  if(stateRoot){try{writeFileSync(join(stateRoot,'ABORTED.json'),encode({schema:'native-v6-reading-aborted-v1',reason:String(error.message).slice(0,240),retry:false,clock_reset:false,...SCOPE}),{flag:'wx',mode:0o600});}catch{}}
  process.stderr.write('ABORTED bounded reading transport; preserve state and return to ROOT.\n');process.exitCode=1;
}
