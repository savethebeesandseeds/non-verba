// SPDX-License-Identifier: AGPL-3.0-only
// SOURCE_FREE controls: evaluate only two exact reviewed helper snippets.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const PIN={sha256:'bb3c7c8e51d028653c4beacb9fd18cdfc439c8d8291a39cdf4d2535170a318cd',bytes:24906};
const file=fileURLToPath(new URL('./calibration-runner-v2.mjs',import.meta.url));
const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
let bytes;try{const before=fs.fstatSync(fd);assert.ok(before.isFile()&&before.nlink===1&&before.size===PIN.bytes);bytes=Buffer.alloc(before.size);let n=0;while(n<bytes.length){const count=fs.readSync(fd,bytes,n,bytes.length-n,n);assert.ok(count>0);n+=count;}const after=fs.fstatSync(fd);assert.equal(after.dev,before.dev);assert.equal(after.ino,before.ino);assert.equal(after.size,before.size);}finally{fs.closeSync(fd);}
assert.equal(createHash('sha256').update(bytes).digest('hex'),PIN.sha256);
const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
function snippet(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a&&source.indexOf(start,a+start.length)===-1);return source.slice(a,b).trim();}
const observationCode=snippet('function observeRSS(row)','const CHILD=');
const retryCode=snippet('const sampleOwnedTree=()=>','\nconst signal=');
const evaluate=(code,bindings)=>vm.runInContext(code,vm.createContext(bindings,{codeGeneration:{strings:false,wasm:false}}),{timeout:1000});
const birth={pid:42,start_ticks:'17',state:'R'};
function observer(replies,status,{error=null}={}){
  let reads=0,stats=0;const queue=[...replies];
  const fn=evaluate('('+observationCode+')',{stat:pid=>{assert.equal(pid,42);stats++;assert.ok(queue.length>0);return queue.shift();},fs:{readFileSync:(p,encoding)=>{assert.equal(p,'/proc/42/status');assert.equal(encoding,'utf8');reads++;if(error)throw Object.assign(Error('SYNTHETIC'),{code:error});return status;}}});
  return{value:fn(birth),reads,stats};
}
function retryFixture(outcomes,reobserved,{deferred=false}={}){
  let calls=0,release=null;const delays=[],journal=[],queue=[...outcomes];
  const bindings={sample:()=>{calls++;assert.ok(queue.length>0);const next=queue.shift();if(next)throw Object.assign(Error('SYNTHETIC'),{code:next,rss_observation:{pid:42,start_ticks:'17'}});},delay:ms=>{delays.push(ms);return deferred?new Promise(resolve=>{release=resolve;}):Promise.resolve();},stat:pid=>{assert.equal(pid,42);return reobserved;},appendObservation:row=>journal.push(row),elapsed:()=>0};
  const fixture=evaluate('(function(){let sampleFlight=null,rssRetryCount=0,rssUnknownSamples=0;'+retryCode+';return{run:sampleOwnedTree,state:()=>({rssRetryCount,rssUnknownSamples})};})()',bindings);
  return{run:fixture.run,state:fixture.state,calls:()=>calls,delays,journal,release:()=>{assert.ok(release);release();}};
}
let passed=0;
async function test(name,body){await body();passed++;}
await test('missing VmRSS plus confirmed absence is retired',()=>{const r=observer([birth,null],'Name:\tsynthetic\n');assert.equal(r.value.status,'CONFIRMED_ABSENT');assert.equal(r.value.rss_bytes,0);assert.equal(r.reads,1);});
await test('missing VmRSS on the same live birth stays unknown',()=>{const r=observer([birth,birth],'Name:\tsynthetic\n');assert.equal(r.value.status,'UNKNOWN_LIVE_RSS');assert.equal(r.value.rss_bytes,null);assert.equal(r.value.status_read_error,'VMRSS_MISSING');});
await test('missing status with a still-live birth stays unknown',()=>{const r=observer([birth,birth],null,{error:'ENOENT'});assert.equal(r.value.status,'UNKNOWN_LIVE_RSS');assert.equal(r.value.rss_bytes,null);});
await test('positive live RSS remains positive',()=>{const r=observer([birth,birth],'VmRSS:\t321 kB\n');assert.equal(r.value.status,'LIVE_RSS_OBSERVED');assert.equal(r.value.rss_bytes,321*1024);});
await test('replaced and terminal births require no status read',()=>{for(const row of [{...birth,start_ticks:'99'},{...birth,state:'Z'},{...birth,state:'X'}]){const r=observer([row],null);assert.equal(r.value.rss_bytes,0);assert.equal(r.reads,0);assert.ok(r.value.status.startsWith('CONFIRMED_'));}});
await test('exit handoff retry retains its confirmation',async()=>{const r=retryFixture(['RUNNER_RSS_UNKNOWN',null],null);await r.run();assert.equal(r.calls(),2);assert.deepEqual(r.delays,[25]);assert.equal(r.journal.length,1);assert.equal(r.journal[0].confirmed_exit,true);assert.equal(r.journal[0].unknown_live_rss_not_promoted_to_zero,true);});
await test('live RSS recovery does not invent an exit',async()=>{const r=retryFixture(['RUNNER_RSS_UNKNOWN',null],birth);await r.run();assert.equal(r.calls(),2);assert.equal(r.journal[0].confirmed_exit,false);});
await test('four unknown live observations stop at the retry bound',async()=>{const r=retryFixture(Array(4).fill('RUNNER_RSS_UNKNOWN'),birth);await assert.rejects(r.run(),error=>error.code==='RUNNER_RSS_UNKNOWN');assert.equal(r.calls(),4);assert.deepEqual(r.delays,[25,25,25]);assert.equal(r.state().rssUnknownSamples,4);assert.equal(r.state().rssRetryCount,3);assert.equal(r.journal.length,3);assert.ok(r.journal.every((row,index)=>row.retry===index+1&&row.confirmed_exit===false&&row.unknown_live_rss_not_promoted_to_zero===true));});
await test('a non-RSS cap failure is not retried',async()=>{const r=retryFixture(['RUNNER_SAMPLED_RESOURCE_LIMIT'],birth);await assert.rejects(r.run(),error=>error.code==='RUNNER_SAMPLED_RESOURCE_LIMIT');assert.equal(r.calls(),1);assert.equal(r.delays.length,0);assert.equal(r.journal.length,0);});
await test('overlapping callers share the same pending sample',async()=>{const r=retryFixture(['RUNNER_RSS_UNKNOWN',null],birth,{deferred:true}),first=r.run(),second=r.run();assert.equal(first,second);r.release();await Promise.all([first,second]);assert.equal(r.calls(),2);assert.equal(r.delays.length,1);});
console.log(JSON.stringify({schema:'current-v6-rss-source-free-controls-result-v1',passed,failed:0,reviewed_worker:PIN,helper_snippets_evaluated:2,main_or_child_evaluated:false,proc_read:false,corpus_read:false,process_spawned:false,counter_calls:0,authority:'NONE'}));
