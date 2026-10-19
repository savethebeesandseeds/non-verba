// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / SOURCE_FREE only. Capture entry: builtins precede project imports.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fork,spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const RUN='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
const ROOT_RE=new RegExp('^'+RUN+'/qa/literal-emphasis-parent-v1-typed-owned-source-free-v[0-9]+(?:-a[0-9]+)?$','u');
const entryStarted=process.hrtime.bigint();
const nowNs=process.hrtime.bigint.bind(process.hrtime);
const nativeFS=Object.freeze(Object.fromEntries(Object.getOwnPropertyNames(fs).filter(k=>typeof fs[k]==='function').map(k=>[k,fs[k].bind(fs)])));
const caps={fs:nativeFS,constants:Object.freeze({...fs.constants}),pid:process.pid,ppid:process.ppid,
  now:()=>Number(nowNs())/1e6,nowNs,on:process.on.bind(process),send:process.send?.bind(process),
  connected:()=>process.connected===true,setTimeout,clearTimeout,setInterval,clearInterval,
  fork,spawn,setImmediate,kill:process.kill.bind(process),execPath:process.execPath,execArgv:Object.freeze([...process.execArgv]),
  argv:Object.freeze([...process.argv]),env:Object.freeze({...process.env})};
const fail=code=>{throw Object.assign(Error(code),{code});};
const H=b=>createHash('sha256').update(b).digest('hex');
const [root,planPath,planSHA,planSize,...extra]=caps.argv.slice(2);
if(extra.length||!ROOT_RE.test(root??'')||planPath!==root+'/run-plan.json'||!/^[a-f0-9]{64}$/u.test(planSHA??'')||!/^[1-9][0-9]{0,5}$/u.test(planSize??''))fail('TYPED_ROOT_ENTRY_ARGUMENTS');
let held=null;
const stop=code=>{held??=code;};
caps.on('SIGTERM',()=>stop('TYPED_ROOT_SIGTERM'));
caps.on('SIGINT',()=>stop('TYPED_ROOT_SIGINT'));
caps.stopCode=()=>held;
function noLinks(file,directory=false){let at='/';for(const part of file.split('/').filter(Boolean)){at=path.posix.join(at,part);const s=nativeFS.lstatSync(at);if(s.isSymbolicLink()||(at!==file||directory)&&!s.isDirectory())fail('TYPED_ROOT_LINK_OR_PARENT');}return nativeFS.lstatSync(file);}
function capture(fd,file){noLinks(path.posix.dirname(file),true);const opened=nativeFS.openSync(file,caps.constants.O_CREAT|caps.constants.O_EXCL|caps.constants.O_WRONLY|caps.constants.O_NOFOLLOW,0o600);const before=nativeFS.fstatSync(opened);nativeFS.closeSync(fd);const rebound=nativeFS.openSync(file,caps.constants.O_WRONLY|caps.constants.O_NOFOLLOW);if(rebound!==fd)fail('TYPED_ROOT_CAPTURE_FD');const after=nativeFS.fstatSync(fd);nativeFS.closeSync(opened);const fdIdentity=nativeFS.readlinkSync('/proc/'+caps.pid+'/fd/'+fd);if(after.dev!==before.dev||after.ino!==before.ino||fdIdentity!==file)fail('TYPED_ROOT_CAPTURE_IDENTITY');return Object.freeze({path:file,dev:String(after.dev),ino:String(after.ino),fd_identity:fdIdentity});}
noLinks(root,true);
nativeFS.mkdirSync(root+'/observer',{mode:0o700});
caps.captureDescriptors=Object.freeze([capture(1,root+'/observer/stdout.private.log'),capture(2,root+'/observer/stderr.private.log')]);
caps.capturedBeforeProjectImports=true;
caps.entry_started_ns=String(entryStarted);
function readBound(ref,max=262144){if(!ref||Object.keys(ref).sort().join('|')!=='bytes|path|sha256'||typeof ref.path!=='string'||!path.posix.isAbsolute(ref.path)||path.posix.normalize(ref.path)!==ref.path||!Number.isSafeInteger(ref.bytes)||ref.bytes<0||ref.bytes>max||!/^[a-f0-9]{64}$/u.test(ref.sha256))fail('TYPED_ROOT_REF');const s=noLinks(ref.path);if(!s.isFile()||s.size!==ref.bytes)fail('TYPED_ROOT_REF_SIZE');const fd=nativeFS.openSync(ref.path,caps.constants.O_RDONLY|caps.constants.O_NOFOLLOW|caps.constants.O_NONBLOCK);try{const opened=nativeFS.fstatSync(fd);if(!opened.isFile()||opened.dev!==s.dev||opened.ino!==s.ino||opened.size!==ref.bytes)fail('TYPED_ROOT_REF_IDENTITY');const b=Buffer.alloc(ref.bytes);let n=0;while(n<b.length){const k=nativeFS.readSync(fd,b,n,b.length-n,n);if(!k)fail('TYPED_ROOT_REF_SHORT');n+=k;}if(nativeFS.readSync(fd,Buffer.alloc(1),0,1,n)||nativeFS.fstatSync(fd).size!==n||H(b)!==ref.sha256)fail('TYPED_ROOT_REF_HASH');return b;}finally{nativeFS.closeSync(fd);}}
function verifyRuntime(ref){if(ref?.path!==caps.execPath||ref.sha256!=='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'||ref.bytes!==124827920||process.version!=='v22.23.3'||process.platform!=='linux'||process.arch!=='x64'||nativeFS.readlinkSync('/proc/'+caps.pid+'/exe')!==caps.execPath)fail('TYPED_ROOT_RUNTIME_PIN');const stat=noLinks(ref.path);if(!stat.isFile()||stat.size!==ref.bytes)fail('TYPED_ROOT_RUNTIME_SIZE');const fd=nativeFS.openSync(ref.path,caps.constants.O_RDONLY|caps.constants.O_NOFOLLOW),digest=createHash('sha256'),buffer=Buffer.alloc(1048576);try{const before=nativeFS.fstatSync(fd);let at=0,n;while((n=nativeFS.readSync(fd,buffer,0,buffer.length,at))){digest.update(buffer.subarray(0,n));at+=n;}const after=nativeFS.fstatSync(fd);if(at!==ref.bytes||before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||digest.digest('hex')!==ref.sha256)fail('TYPED_ROOT_RUNTIME_HASH');}finally{nativeFS.closeSync(fd);}}
let finalCode=2;
try{
  const planRef={path:planPath,sha256:planSHA,bytes:Number(planSize)};
  const bytes=readBound(planRef),plan=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));
  if(!Buffer.from(JSON.stringify(plan,null,2)+'\n').equals(bytes)||plan.schema!=='ROOT_SOURCE_FREE_TYPED_OWNED_RUN_PLAN_V1'||plan.source_kind!=='SOURCE_FREE_FIXTURE'||plan.root!==root||plan.actual_authority!==false||plan.authority!=='NONE'||!Array.isArray(plan.source_refs)||!plan.source_refs.length||plan.source_refs.length>256)fail('TYPED_ROOT_PLAN');
  if(JSON.stringify(caps.execArgv)!=='["--max-old-space-size=256","--disable-proto=throw","--experimental-vm-modules"]'||caps.execPath!=='/opt/nonverba-tools/node/bin/node'||plan.runtime_ref?.path!==caps.execPath)fail('TYPED_ROOT_RUNTIME_FLAGS');
  for(const key of['LD_PRELOAD','LD_AUDIT','NODE_OPTIONS','BASH_ENV','ENV'])if(caps.env[key]!==undefined)fail('TYPED_ROOT_INJECTED_ENVIRONMENT');
  verifyRuntime(plan.runtime_ref);
  const seen=new Set();
  for(const ref of plan.source_refs){if(!/^(?:\/tmp\/nonverba-unified-source\/[a-f0-9]{32}\/code\/|\/opt\/nonverba-tools\/priors-derivation-0\.1\/node_modules\/(?:parse5|entities)\/)/u.test(ref.path)||seen.has(ref.path))fail('TYPED_ROOT_SOURCE_SCOPE');seen.add(ref.path);readBound(ref);}
  if(!plan.source_refs.some(r=>r.path===caps.argv[1])||!plan.source_refs.some(r=>JSON.stringify(r)===JSON.stringify(plan.orchestration_ref)))fail('TYPED_ROOT_ENTRY_SOURCE_PIN');
  readBound(plan.source_epoch_ref);readBound(plan.admission_ref);readBound(plan.capacity_helper_ref);readBound(plan.capacity_policy_ref);
  if(held)fail(held);
  const {runOwnedStudy}=await import(pathToFileURL(plan.orchestration_ref.path).href);
  const result=await runOwnedStudy(plan,planRef,Object.freeze(caps));
  finalCode=result?.status==='COMPLETE_PENDING_ROOT_PROCESS_EXIT_READBACK'?0:2;
}catch(error){
  let code='TYPED_ROOT_ENTRY_FAILURE';try{const d=Object.getOwnPropertyDescriptor(error,'code');if(d&&Object.hasOwn(d,'value')&&typeof d.value==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/u.test(d.value))code=d.value;}catch{}
  try{const bytes=Buffer.from(JSON.stringify({schema:'typed-owned-root-entry-held-v1',status:'HELD',code,source_kind:'SOURCE_FREE_FIXTURE',actual_authority:false,authority:'NONE'},null,2)+'\n');const fd=nativeFS.openSync(root+'/observer/entry-held.json',caps.constants.O_CREAT|caps.constants.O_EXCL|caps.constants.O_WRONLY|caps.constants.O_NOFOLLOW,0o600);try{nativeFS.writeFileSync(fd,bytes);nativeFS.fsyncSync(fd);}finally{nativeFS.closeSync(fd);}}catch{}
}
process.exitCode=finalCode;
