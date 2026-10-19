// SPDX-License-Identifier: AGPL-3.0-only
// SOURCE_ONLY / DECLARED_FICTIONAL controls. No study IO or actual phase.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const root=path.dirname(fileURLToPath(import.meta.url));
const pins=[{"name":"reader.mjs","bytes":13714,"sha256":"406ff2f7c00135c8cc3e06a7fdcc11fa87901a54f9aa22b52c9d8875ccfe4adb"},{"name":"review-core.mjs","bytes":6200,"sha256":"ceccff9ff931f0166e570d90dd325e8d804f25b1ab2568294d58ad859b5db4da"},{"name":"base-core.mjs","bytes":14099,"sha256":"96cf6c62800fbcb745ab3727efdcd1e26e59c3f08739e82b0012979ac28401b6"},{"name":"review-controls.test.mjs","bytes":5916,"sha256":"bb265edf2bd1b5f9a166ebfb3b9faf0622440e925b08a1f2a3400112dcf08a1c"}];
const H=b=>createHash('sha256').update(b).digest('hex');
const check=(v,c)=>{if(!v)throw Error(c);};
check(process.platform==='linux'&&process.env.NONVERBA_CONTAINER==='1'&&process.execPath==='/opt/nonverba-tools/node/bin/node','MANAGED_ENV');
check(JSON.stringify(process.execArgv)===JSON.stringify(['--max-old-space-size=512','--disable-proto=throw']),'NODE_LIMITS');
check(['NODE_OPTIONS','NODE_PATH','NODE_COMPILE_CACHE','LD_PRELOAD','LD_AUDIT','BASH_ENV','ENV'].every(k=>!process.env[k]),'SANITIZED_ENV');
for(const p of pins){const name=path.join(root,p.name),st=fs.lstatSync(name);check(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1&&st.size===p.bytes,'SOURCE_KIND');check(H(fs.readFileSync(name))===p.sha256,'SOURCE_PIN');}
const start=process.hrtime.bigint(),stdout=[],stderr=[];
let captured=0,peakSelf=0,peakChild=0,peakCombined=0,samples=0,resourceFailure=null;
const child=spawn(process.execPath,['--max-old-space-size=512','--disable-proto=throw','--test',path.join(root,'review-controls.test.mjs')],{cwd:root,env:{...process.env},stdio:['ignore','pipe','pipe']});
const rss=pid=>{try{const s=fs.readFileSync('/proc/'+pid+'/status','utf8'),m=s.match(/^VmRSS:\s+(\d+) kB$/m);return m?Number(m[1])*1024:0;}catch(e){if(e.code==='ENOENT'||e.code==='ESRCH')return 0;throw e;}};
const sample=()=>{const a=rss(process.pid),b=rss(child.pid);samples++;peakSelf=Math.max(peakSelf,a);peakChild=Math.max(peakChild,b);peakCombined=Math.max(peakCombined,a+b);if(a+b>1073741824){resourceFailure='SAMPLED_RSS_LIMIT';child.kill('SIGKILL');}};
for(const [stream,list] of [[child.stdout,stdout],[child.stderr,stderr]])stream.on('data',b=>{captured+=b.length;if(captured>262144){resourceFailure='CAPTURE_LIMIT';child.kill('SIGKILL');return;}list.push(b);});
sample();
const timer=setInterval(sample,5),deadline=setTimeout(()=>{resourceFailure='INNER_25S_WATCHDOG';child.kill('SIGKILL');},25000);
let spawnError=null;child.on('error',e=>{spawnError=e.code??'SPAWN_ERROR';});
const result=await new Promise(resolve=>child.on('close',(code,signal)=>resolve({code,signal})));
clearInterval(timer);clearTimeout(deadline);sample();
const out=Buffer.concat(stdout),err=Buffer.concat(stderr),tap=out.toString('utf8');
const write=(name,b)=>{const dest=path.join(root,name);fs.writeFileSync(dest,b,{flag:'wx',mode:0o600});return {path:dest,sha256:H(b),bytes:b.length};};
const outRef=write('controls.stdout.txt',out),errRef=write('controls.stderr.txt',err);
const elapsed=Number(process.hrtime.bigint()-start)/1e6;
const pass=result.code===0&&result.signal===null&&!resourceFailure&&!spawnError&&/^# tests 8$/m.test(tap)&&/^# pass 8$/m.test(tap)&&/^# fail 0$/m.test(tap)&&elapsed<=30000;
const receipt={schema:'operative0055-v2-fictional-controls-executed-v1',status:pass?'PASS':'FAILED_PRESERVE',source_only:true,reviewer:'/root/operative_context_reader_v1',actual_Q_created:false,actual_clock_started:false,actual_source_payload_opened:false,previous_actual_reading_transferred:false,fictional_tests_expected:8,fictional_tests_passed:pass?8:null,source_refs:pins.map(p=>({...p,path:path.join(root,p.name)})),native_child_exit_code:result.code,native_child_signal:result.signal,spawn_error:spawnError,resource_failure:resourceFailure,external_watchdog_ms:30000,inner_watchdog_ms:25000,node_heap_cap_bytes:536870912,combined_sampled_rss_limit_bytes:1073741824,elapsed_ms:elapsed,rss_samples:samples,peak_supervisor_rss_bytes:peakSelf,peak_direct_child_rss_bytes:peakChild,peak_combined_sampled_rss_bytes:peakCombined,continuous_OS_containment_claim:false,captured_bytes:captured,capture_cap_bytes:262144,stdout_ref:outRef,stderr_ref:errRef,old_source_reservation_bytes:131072,new_source_reservation_bytes:262144,no_refunds:true,quality_gate_pass:false,materiality_holds_cleared:0,authority:'NONE'};
const receiptRef=write('controls-receipt.json',Buffer.from(JSON.stringify(receipt,null,2)+'\n'));
process.stdout.write(JSON.stringify({receipt_ref:receiptRef,status:receipt.status,native_child_exit_code:result.code,elapsed_ms:elapsed,peak_combined_sampled_rss_bytes:peakCombined,fictional_tests_passed:receipt.fictional_tests_passed,captured_bytes:captured})+'\n');
process.exitCode=pass?0:1;

