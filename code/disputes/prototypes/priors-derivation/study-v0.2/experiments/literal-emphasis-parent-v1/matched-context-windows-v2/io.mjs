// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE: fixed-path IO for the isolated window census. No service import here.
import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';import{gunzipSync,gzipSync}from'node:zlib';
export const R='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
export const Q=R+'/qa/literal-emphasis-parent-v1-matched-context-windows-v2';
export const POLICY_REF=Object.freeze({path:Q+'/ROOT-window-policy.json',sha256:'40f2fe45f0ac2654d8e94bd8c2b6d42d0b89aa4050bd0d054a6ceed96227d0c1',bytes:34751});
export const NODE=Object.freeze({path:'/opt/nonverba-tools/node/bin/node',sha256:'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48',bytes:124827920});
export const FLAGS=Object.freeze(['--max-old-space-size=256','--disable-proto=throw','--experimental-vm-modules']);
export const io=Object.freeze(Object.fromEntries(Object.getOwnPropertyNames(fs).filter(k=>typeof fs[k]==='function').map(k=>[k,fs[k].bind(fs)])));
export const FILE_FLAGS=Object.freeze({...fs.constants});
const K=FILE_FLAGS;
export const H=b=>createHash('sha256').update(b).digest('hex'),J=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
export const C=v=>Array.isArray(v)?'['+v.map(C).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+C(v[k])).join(',')+'}':JSON.stringify(v);
export const digest=v=>H(C(v)),same=(a,b)=>C(a)===C(b),check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});};
export const plainRef=r=>({path:r.path,sha256:r.sha256,bytes:r.bytes});
export function noLinks(file,directory=false){
 check(typeof file==='string'&&path.posix.isAbsolute(file)&&path.posix.normalize(file)===file&&!file.includes('\0'),'CENSUS_PATH');let at='/';
 for(const n of file.split('/').filter(Boolean)){at=path.posix.join(at,n);const s=io.lstatSync(at);check(!s.isSymbolicLink()&&(at!==file||directory?s.isDirectory():s.isFile()&&s.nlink===1),'CENSUS_LINK_KIND');}return io.lstatSync(file);
}
export function read(r,max=262144,empty=false){
 check(r&&Object.keys(r).sort().join('|')==='bytes|path|sha256'&&Number.isSafeInteger(r.bytes)&&r.bytes>=(empty?0:1)&&r.bytes<=max&&/^[a-f0-9]{64}$/u.test(r.sha256),'CENSUS_REF');
 const s=noLinks(r.path);check(s.size===r.bytes,'CENSUS_REF_SIZE');const fd=io.openSync(r.path,K.O_RDONLY|K.O_NOFOLLOW|K.O_NONBLOCK);
 try{const a=io.fstatSync(fd);check(a.dev===s.dev&&a.ino===s.ino&&a.size===s.size&&a.nlink===1,'CENSUS_FD');const b=Buffer.alloc(r.bytes);let at=0;while(at<b.length){const n=io.readSync(fd,b,at,b.length-at,at);check(n>0,'CENSUS_SHORT');at+=n;}const z=io.fstatSync(fd);check(io.readSync(fd,Buffer.alloc(1),0,1,at)===0&&z.dev===a.dev&&z.ino===a.ino&&z.size===a.size&&z.nlink===1&&H(b)===r.sha256,'CENSUS_FILE_HASH');return b;}finally{io.closeSync(fd);}
}
export function observed(file,max=262144,empty=false){const s=noLinks(file);check(s.size<=max&&(empty||s.size>0),'CENSUS_OBSERVED_BOUND');const fd=io.openSync(file,K.O_RDONLY|K.O_NOFOLLOW|K.O_NONBLOCK);try{const a=io.fstatSync(fd);check(a.dev===s.dev&&a.ino===s.ino&&a.size===s.size&&a.nlink===1,'CENSUS_OBSERVED_FD');const b=Buffer.alloc(s.size);let at=0;while(at<b.length){const n=io.readSync(fd,b,at,b.length-at,at);check(n>0,'CENSUS_OBSERVED_SHORT');at+=n;}const z=io.fstatSync(fd);check(io.readSync(fd,Buffer.alloc(1),0,1,at)===0&&z.dev===a.dev&&z.ino===a.ino&&z.size===a.size&&z.nlink===1,'CENSUS_OBSERVED_CHANGED');return{path:file,bytes:b.length,sha256:H(b)};}finally{io.closeSync(fd);}}
export function json(r,max=262144,compact=false){const b=read(r,max),text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b),v=JSON.parse(text);check((compact?Buffer.from(JSON.stringify(v)+'\n'):J(v)).equals(b),'CENSUS_JSON_SERIALIZATION');return v;}
export function mkdir(relative){check(relative.split('/').every(n=>n&&n!=='.'&&n!=='..')&&!relative.startsWith('/'),'CENSUS_DIRECTORY');let at=Q;for(const n of relative.split('/')){at+='/'+n;if(!io.existsSync(at))io.mkdirSync(at,{mode:0o700});noLinks(at,true);}}
export function tree(){let bytes=0,entries=0,captures=973096;const todo=[Q];while(todo.length){const file=todo.pop(),s=io.lstatSync(file);check(!s.isSymbolicLink()&&++entries<=4096,'CENSUS_TREE');bytes+=s.size;if(s.isDirectory())for(const n of io.readdirSync(file))todo.push(file+'/'+n);else{check(s.isFile()&&s.nlink===1,'CENSUS_TREE_KIND');if(file.endsWith('.private.log'))captures+=s.size;}}return{bytes,entries,captures};}
export function put(relative,value,max=8388608){
 check(relative.split('/').every(n=>n&&n!=='.'&&n!=='..')&&!relative.startsWith('/'),'CENSUS_WRITE_PATH');const b=Buffer.isBuffer(value)?value:J(value);check(b.length<=max&&tree().bytes+b.length+8192<=16777216,'CENSUS_WRITE_BOUND');
 const parts=relative.split('/');if(parts.length>1)mkdir(parts.slice(0,-1).join('/'));const file=Q+'/'+relative,fd=io.openSync(file,K.O_CREAT|K.O_EXCL|K.O_WRONLY|K.O_NOFOLLOW,0o600);
 try{io.writeFileSync(fd,b);io.fsyncSync(fd);}finally{io.closeSync(fd);}const r={path:file,bytes:b.length,sha256:H(b)};read(r,max,b.length===0);return r;
}
export function appendJournal(fd,stat,state,event,prior={rows:3809,bytes:1408234}){
 const b=Buffer.from(JSON.stringify({index:state.rows,event})+'\n');check(b.length<=1024&&prior.rows+state.rows+1<=16384&&prior.bytes+state.bytes+b.length<=16777216&&tree().bytes+b.length+4096<=16777216,'CENSUS_JOURNAL_BOUND');
 const s=io.fstatSync(fd);check(s.dev===stat.dev&&s.ino===stat.ino&&s.size===state.bytes&&s.nlink===1,'CENSUS_JOURNAL_IDENTITY');check(io.writeSync(fd,b)===b.length,'CENSUS_JOURNAL_SHORT');io.fsyncSync(fd);state.rows++;state.bytes+=b.length;
}
export function newJournal(name){const file=Q+'/'+name,fd=io.openSync(file,K.O_CREAT|K.O_EXCL|K.O_APPEND|K.O_WRONLY|K.O_NOFOLLOW,0o600);return{fd,stat:io.fstatSync(fd),state:{rows:0,bytes:0},file};}
export function largeHash(r,boundary=()=>{}){
 noLinks(r.path);const fd=io.openSync(r.path,K.O_RDONLY|K.O_NOFOLLOW|K.O_NONBLOCK),b=Buffer.alloc(65536),h=createHash('sha256');
 try{const s=io.fstatSync(fd);check(s.size===r.bytes&&s.nlink===1,'CENSUS_LARGE_SIZE');let at=0;while(at<r.bytes){boundary();const n=io.readSync(fd,b,0,Math.min(b.length,r.bytes-at),at);check(n>0,'CENSUS_LARGE_SHORT');h.update(b.subarray(0,n));at+=n;}const z=io.fstatSync(fd);check(io.readSync(fd,b,0,1,at)===0&&z.size===s.size&&z.dev===s.dev&&z.ino===s.ino&&z.nlink===1&&h.digest('hex')===r.sha256,'CENSUS_LARGE_HASH');}finally{io.closeSync(fd);}
}
export function runtime(){check(process.platform==='linux'&&process.arch==='x64'&&process.version==='v22.23.3'&&process.execPath===NODE.path&&process.env.NONVERBA_CONTAINER==='1'&&same(process.execArgv,FLAGS),'CENSUS_RUNTIME');for(const k of['LD_PRELOAD','LD_AUDIT','NODE_OPTIONS','NODE_PATH','BASH_ENV','ENV'])check(process.env[k]===undefined,'CENSUS_INJECTED_ENV');largeHash(NODE);}
export function sourceRefs(refs){check(Array.isArray(refs)&&refs.length>0&&refs.length<=256&&new Set(refs.map(r=>r.path)).size===refs.length,'CENSUS_SOURCE_COUNT');for(const r of refs){check(/^(?:\/tmp\/nonverba-unified-source\/[a-f0-9]{32}\/code\/|\/opt\/nonverba-tools\/priors-derivation-0\.1\/node_modules\/(?:parse5|entities)\/)/u.test(r.path),'CENSUS_SOURCE_SCOPE');read(r);}}
export function freshGuard(p,cid){const g=json(p.guard_ref,32768),{projection_sha256,...body}=g,ids=[...new Set(g.rows?.map(r=>r.contract_id))].sort();check(g.schema==='stored-reader-complete-fresh100-guard-v1'&&digest(body)===projection_sha256&&g.rows.length===100&&new Set(g.rows.map(r=>r.audit_id)).size===100&&ids.length===29&&same(ids,g.contract_ids)&&!ids.includes(cid)&&p.source_metadata_bindings.every(b=>!ids.includes(b.contract_id)),'CENSUS_FRESH_GUARD');return g;}
export function readArms(r,p,cid,boundary){check(p.arms_inputs.some(x=>same(x.arms_ref,r)),'CENSUS_ARMS_ALLOWLIST');freshGuard(p,cid);boundary();check(r.encoding==='gzip'&&r.decoded_bytes<=33554432,'CENSUS_ARMS_BOUND');const b=gunzipSync(read(plainRef(r),8388608),{maxOutputLength:r.decoded_bytes});check(b.length===r.decoded_bytes&&H(b)===r.decoded_sha256,'CENSUS_ARMS_DECODED_HASH');const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));check(J(v).equals(b),'CENSUS_ARMS_PRETTY');boundary();return{bytes:b,value:v};}
export function gzipOutput(value){const b=J(value);check(b.length<=33554432,'CENSUS_OUTPUT_DECODED_BOUND');const encoded=gzipSync(b,{level:6});check(encoded.length<=8388608,'CENSUS_OUTPUT_ENCODED_BOUND');return{plain:b,encoded};}
