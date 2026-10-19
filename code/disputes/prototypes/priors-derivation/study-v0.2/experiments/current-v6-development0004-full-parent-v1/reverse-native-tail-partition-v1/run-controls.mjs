// SPDX-License-Identifier: AGPL-3.0-only
// Managed-container supervisor for declared fictional controls only.
import fs from'node:fs';import{createHash}from'node:crypto';import{spawn}from'node:child_process';import{performance}from'node:perf_hooks';
const start=performance.now(),hash=b=>createHash('sha256').update(b).digest('hex'),spec=JSON.parse(fs.readFileSync(0,'utf8'));
if(spec.root!=='/tmp/nonverba-reverse-native-tail-partition-v1-controls-20261019-a1')throw Error('FICTIONAL_ROOT');
fs.mkdirSync(spec.root);for(const f of spec.files){if(!/^[A-Za-z0-9.-]+$/u.test(f.name))throw Error('NAME');const b=Buffer.from(f.base64,'base64');if(b.length!==f.bytes||hash(b)!==f.sha256)throw Error('PIN');fs.writeFileSync(spec.root+'/'+f.name,b,{flag:'wx'});}
const child=spawn(process.execPath,['--max-old-space-size=512','--disable-proto=throw','--test',spec.root+'/controls.test.mjs'],{cwd:spec.root,stdio:['ignore','pipe','pipe']});
let out=Buffer.alloc(0),err=Buffer.alloc(0),held=null,peak=process.memoryUsage().rss,closed=false;const stop=c=>{held??=c;if(!closed)child.kill('SIGKILL');};
for(const[name,stream]of[['out',child.stdout],['err',child.stderr]])stream.on('data',b=>{if(out.length+err.length+b.length>131072){stop('CAPTURE');return;}if(name==='out')out=Buffer.concat([out,b]);else err=Buffer.concat([err,b]);});
const sample=()=>{let rss=process.memoryUsage().rss;try{const t=fs.readFileSync('/proc/'+child.pid+'/status','utf8'),m=/^VmRSS:\s+(\d+) kB$/mu.exec(t);if(!m)throw Error('RSS_UNKNOWN');rss+=Number(m[1])*1024;}catch(e){if(!closed&&e.code!=='ENOENT'&&e.code!=='ESRCH')stop('PROCESS_UNKNOWN');}peak=Math.max(peak,rss);if(rss>1073741824)stop('RSS');if(performance.now()-start>30000)stop('TIME');};
const timer=setInterval(sample,50),deadline=setTimeout(()=>stop('TIME'),30000);sample();
const result=await new Promise(resolve=>{child.once('error',e=>{stop('SPAWN');resolve({code:null,signal:null,error:e.code});});child.once('close',(code,signal)=>{closed=true;resolve({code,signal});});});clearInterval(timer);clearTimeout(deadline);sample();
const elapsed=performance.now()-start,receipt={schema:'fictional-reverse-tail-controls-v1',root:spec.root,source_refs:spec.files.map(({base64,...r})=>r),runtime:process.version,child_args:['--max-old-space-size=512','--disable-proto=throw','--test'],limits:{active_ms:30000,sampled_aggregate_rss_bytes:1073741824,capture_bytes:131072},elapsed_ms:elapsed,sampled_peak_aggregate_rss_bytes:peak,continuous_rss_claim:false,...result,held,actual_source_reads:0,tokenizer_calls:0,model_calls:0,actual_runtime_admitted:false,authority:'NONE'};
if(elapsed>30000)receipt.held??='TIME';fs.writeFileSync(spec.root+'/controls.tap',out,{flag:'wx'});fs.writeFileSync(spec.root+'/controls.stderr.log',err,{flag:'wx'});const body=JSON.stringify(receipt)+'\n';fs.writeFileSync(spec.root+'/control-receipt.json',body,{flag:'wx'});
process.stdout.write(JSON.stringify({receipt,tap_base64:out.toString('base64'),stderr_base64:err.toString('base64'),receipt_ref:{path:spec.root+'/control-receipt.json',sha256:hash(body),bytes:Buffer.byteLength(body)}})+'\n');
process.exitCode=receipt.code===0&&!receipt.held?0:2;
