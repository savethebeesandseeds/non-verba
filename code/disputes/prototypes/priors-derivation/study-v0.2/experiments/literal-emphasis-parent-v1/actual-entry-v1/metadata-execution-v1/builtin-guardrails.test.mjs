// SPDX-License-Identifier: AGPL-3.0-only
// All observations below use fictional in-memory IO. No real tree/proc call.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CAPACITY_SOURCE_PINS,ORIGINAL_CAPACITY_POLICY as policy,ORIGINAL_CAPACITY_LIMITS as limits,validateOriginalCapacityPolicy,measureBoundedTree,measurePrivateTree,assessCapacity} from './builtin-capacity.mjs';
import {parseProcessBytes,observeProcess,collectOwnedTree,verifiedSignalPlan} from './builtin-process.mjs';

const error=code=>Object.assign(Error(code),{code});
const stat=(type,{size=10,dev=1,ino=1,mode=type==='DIRECTORY'?16877:type==='SYMLINK'?41471:33152}={})=>({size,dev,ino,mode,isFile:()=>type==='FILE',isDirectory:()=>type==='DIRECTORY',isSymbolicLink:()=>type==='SYMLINK'});
function fakeTree(root,{original=false}={}){
  const nodes=new Map(),calls=[];let inode=100;
  const put=(file,type='FILE',extra={})=>{let parent=path.dirname(file);if(parent!==file&&!nodes.has(parent))put(parent,'DIRECTORY');nodes.set(file,{type,...stat(type,{ino:inode++,...extra}),...extra});return file;};
  put('/','DIRECTORY');put(root,'DIRECTORY');
  if(original)for(const e of policy.exceptions){put(e.literal_target,e.target.type,{size:e.target.bytes,mode:e.target.mode,dev:e.target.dev,ino:e.target.ino});put(policy.study_root+'/'+e.path,'SYMLINK',{size:e.bytes,mode:e.mode,literal:e.literal_target});}
  const io={
    lstatSync(file){calls.push(['lstat',file]);const s=nodes.get(file);if(!s)throw error('ENOENT');if(s.throw)throw error(s.throw);return {...s};},
    readdirSync(file){calls.push(['readdir',file]);return [...nodes].filter(([p])=>p!==file&&path.dirname(p)===file).map(([p,s])=>({name:path.basename(p),isFile:()=>s.type==='FILE',isDirectory:()=>s.type==='DIRECTORY',isSymbolicLink:()=>s.type==='SYMLINK'}));},
    readlinkSync(file){calls.push(['readlink',file]);return nodes.get(file).literal;}
  };
  return {nodes,calls,io,put,expected:()=>[...nodes].filter(([p])=>p===root||p.startsWith(root+'/')).reduce((n,[,s])=>n+s.size,0)};
}
const whole=tree=>measureBoundedTree(policy.study_root,policy,{io:tree.io,now:()=>0,deadline_ms:100});
const privateMeasure=(tree,options={})=>measurePrivateTree('/tmp/fiction-capacity',{io:tree.io,now:()=>0,deadline_ms:100,max_bytes:100000,...options});

test('original policy bytes/hash and immutable source pins match retained v3',()=>{
  const bytes=Buffer.from(JSON.stringify(policy,null,2)+'\n');assert.equal(bytes.length,CAPACITY_SOURCE_PINS.policy.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),CAPACITY_SOURCE_PINS.policy.sha256);assert.equal(validateOriginalCapacityPolicy(JSON.parse(bytes)),true);assert(Object.isFrozen(policy.exceptions[0].target));
  const changed=JSON.parse(bytes);changed.exceptions.pop();assert.throws(()=>validateOriginalCapacityPolicy(changed),{code:'RUN_CAPACITY_ORIGINAL_POLICY_REQUIRED'});
});
test('counts directory and regular own bytes, both links470, hardlinks per entry',()=>{
  const t=fakeTree(policy.study_root,{original:true});t.put(policy.study_root+'/one','FILE',{size:40,ino:44});t.put(policy.study_root+'/two','FILE',{size:40,ino:44});const r=whole(t);assert.equal(r.bytes,t.expected());assert.equal(r.fixture_link_bytes,470);assert.equal(r.counts.fixture_links,2);assert.equal(r.exact_fixture_exceptions_observed.length,2);assert.equal(r.link_targets_traversed,false);assert(!t.calls.some(([method,p])=>method==='readdir'&&policy.exceptions.some(e=>p===policy.study_root+'/'+e.path)));
});
test('exact enumerated UUIDv4 regular transfer ENOENT only is ignored',()=>{
  for(const name of ['output.12345678-1234-4234-9234-123456789abc.partial','partials/rows-12345678-1234-4234-9234-123456789abc.parquet','raw-partials/raw-12345678-1234-4234-9234-123456789abc.partial']){
    const t=fakeTree(policy.study_root,{original:true}),file=t.put(policy.study_root+'/'+name,'FILE',{throw:'ENOENT'}),r=whole(t);assert.equal(r.vanished_validated_regular_transfer_count,1);assert.equal(r.bytes,t.expected()-t.nodes.get(file).size);
  }
});
test('last allowed vanished transfer still checks exception deadline and clock',()=>{
  for(const expired of [101,-1]){const t=fakeTree(policy.study_root,{original:true}),file=t.put(policy.study_root+'/last.12345678-1234-4234-9234-123456789abc.partial','FILE'),lstat=t.io.lstatSync;let now=0;t.io.lstatSync=p=>{if(p===file){now=expired;throw error('ENOENT');}return lstat(p);};assert.throws(()=>measureBoundedTree(policy.study_root,policy,{io:t.io,now:()=>now,deadline_ms:100}),{code:expired<0?'RUN_CAPACITY_CLOCK_UNKNOWN':'RUN_CAPACITY_DEADLINE'});}
});
test('ordinary missing/version-wrong/directory/EACCES transfers reject',()=>{
  for(const [name,type,code] of [['ordinary','FILE','ENOENT'],['x.12345678-1234-1234-9234-123456789abc.partial','FILE','ENOENT'],['x.12345678-1234-4234-9234-123456789abc.partial','DIRECTORY','ENOENT'],['x.12345678-1234-4234-9234-123456789abc.partial','FILE','EACCES']]){const t=fakeTree(policy.study_root,{original:true});t.put(policy.study_root+'/'+name,type,{throw:code});assert.throws(()=>whole(t),{code});}
});
test('unknown links/nonregular and mutated known link/target reject',()=>{
  for(const type of ['SYMLINK','SOCKET']){const t=fakeTree(policy.study_root,{original:true});t.put(policy.study_root+'/unknown',type);assert.throws(()=>whole(t),{code:'RUN_CAPACITY_UNKNOWN_NONREGULAR'});}
  const t=fakeTree(policy.study_root,{original:true});t.nodes.get(policy.study_root+'/'+policy.exceptions[0].path).literal+='x';assert.throws(()=>whole(t),{code:'RUN_CAPACITY_FIXTURE_LINK_CHANGED'});
  const u=fakeTree(policy.study_root,{original:true});u.nodes.get(policy.exceptions[1].literal_target).ino++;assert.throws(()=>whole(u),{code:'RUN_CAPACITY_FIXTURE_TARGET_CHANGED'});
});
test('directory identity/type swaps and missing expected fixture reject',()=>{
  const t=fakeTree(policy.study_root,{original:true}),read=t.io.readdirSync;t.io.readdirSync=file=>{const r=read(file);if(file===policy.study_root)t.nodes.get(file).ino++;return r;};assert.throws(()=>whole(t),{code:'RUN_CAPACITY_DIRECTORY_IDENTITY_CHANGED'});
  const u=fakeTree(policy.study_root,{original:true}),file=u.put(policy.study_root+'/swap','FILE'),original=u.io.lstatSync;u.io.lstatSync=p=>p===file?stat('DIRECTORY'):original(p);assert.throws(()=>whole(u),{code:'RUN_CAPACITY_ENTRY_TYPE_CHANGED'});
  const v=fakeTree(policy.study_root,{original:true});v.nodes.delete(policy.study_root+'/'+policy.exceptions[0].path);assert.throws(()=>whole(v),{code:'RUN_CAPACITY_EXPECTED_FIXTURE_MISSING'});
});
test('private output rejects every link/disappearance and enforces own byte bound',()=>{
  const t=fakeTree('/tmp/fiction-capacity');t.put('/tmp/fiction-capacity/a','FILE',{size:50});assert.equal(privateMeasure(t).bytes,t.expected());assert.throws(()=>privateMeasure(t,{max_bytes:t.expected()-1}),{code:'RUN_CAPACITY_TREE_BYTES_BOUND'});
  t.put('/tmp/fiction-capacity/link','SYMLINK');assert.throws(()=>privateMeasure(t),{code:'RUN_CAPACITY_UNKNOWN_NONREGULAR'});t.nodes.delete('/tmp/fiction-capacity/link');t.nodes.get('/tmp/fiction-capacity/a').throw='ENOENT';assert.throws(()=>privateMeasure(t),{code:'ENOENT'});
});
test('deadline, monotonic clock, invalid size and bounds fail closed',()=>{
  const t=fakeTree('/tmp/fiction-capacity');assert.equal(privateMeasure(t,{now:()=>100}).bytes,t.expected());assert.throws(()=>privateMeasure(t,{now:()=>101}),{code:'RUN_CAPACITY_DEADLINE'});assert.throws(()=>privateMeasure(t,{now:()=>-1}),{code:'RUN_CAPACITY_CLOCK_UNKNOWN'});let n=2;assert.throws(()=>privateMeasure(t,{now:()=>n--}),{code:'RUN_CAPACITY_CLOCK_UNKNOWN'});assert.throws(()=>privateMeasure(t,{deadline_ms:NaN}),{code:'RUN_CAPACITY_BOUND_INVALID'});t.nodes.get('/tmp/fiction-capacity').size=NaN;assert.throws(()=>privateMeasure(t),{code:'RUN_CAPACITY_SIZE_INVALID'});
});
test('original floor, baseline, admission soft and shared hard exact boundaries',()=>{
  assert.throws(()=>assessCapacity(limits.floor-1),{code:'RUN_CAPACITY_ORIGINAL_FLOOR'});assert.throws(()=>assessCapacity(limits.baseline),{code:'RUN_CAPACITY_ORIGINAL_FLOOR'});assert.equal(assessCapacity(limits.floor).growth_bytes,658325);assert.equal(assessCapacity(limits.baseline+limits.hard).growth_bytes,limits.hard);assert.throws(()=>assessCapacity(limits.baseline+limits.hard+1),{code:'RUN_CAPACITY_SHARED_OR_STUDY_LIMIT'});assert.equal(assessCapacity(limits.baseline+limits.soft,{admission:true}).growth_bytes,limits.soft);assert.throws(()=>assessCapacity(limits.baseline+limits.soft+1,{admission:true}),{code:'RUN_CAPACITY_SHARED_OR_STUDY_LIMIT'});assert.throws(()=>assessCapacity(limits.total+1),{code:'RUN_CAPACITY_SHARED_OR_STUDY_LIMIT'});
});

function procBytes(pid,{start='100',ppid=1,group=pid,pages=2,kb=4,children=[]}={}){const f=Array(50).fill('0');f[0]='R';f[1]=String(ppid);f[2]=String(group);f[19]=start;f[21]=String(pages);return {stat:`${pid} (fiction ) (worker) ${f.join(' ')}\n`,status:`Name:\tfiction\nTgid:\t${pid}\nPid:\t${pid}\nPPid:\t${ppid}\nVmRSS:\t${kb} kB\n`,children:children.join(' ')};}
function procIO(pid,bytes,{statSequence,statusValue,childrenValue,closeError}={}){
  let next=10,statAt=0;const fds=new Map(),calls=[];
  const io={
    openSync(file,flags){calls.push({file,flags});let value=file===`/proc/${pid}/stat`?(statSequence?statSequence[Math.min(statAt++,statSequence.length-1)]:bytes.stat):file===`/proc/${pid}/status`?(statusValue??bytes.status):file===`/proc/${pid}/task/${pid}/children`?(childrenValue??bytes.children):error('EACCES');if(value instanceof Error)throw value;const fd=next++;fds.set(fd,{bytes:Buffer.from(value),at:0});return fd;},
    fstatSync(){return {isFile:()=>true};},
    readSync(fd,out,offset,length){const f=fds.get(fd),count=Math.min(length,f.bytes.length-f.at);f.bytes.copy(out,offset,f.at,f.at+count);f.at+=count;return count;},
    closeSync(fd){fds.delete(fd);if(closeError)throw error(closeError);}
  };return {io,calls,fds};
}
const live=(pid,{start=String(pid*10),ppid=1,group=10,rss=100,children=[]}={})=>({state:'LIVE',pid,start_ticks:start,ppid,group,rss_bytes:rss,children});
const gone=pid=>({state:'GONE',pid});
const unknown=pid=>({state:'UNKNOWN',pid});
const registry=[{pid:10,start_ticks:'100',group:10}];

test('strict proc parsing with parenthesized comm and conservative max RSS',()=>{
  const r=parseProcessBytes(10,procBytes(10,{children:[11,12]}));assert.equal(r.rss_bytes,8192);assert.equal(r.start_ticks,'100');assert.deepEqual(r.children,[11,12]);assert.equal(parseProcessBytes(10,procBytes(10,{kb:20})).rss_bytes,20480);
});
test('malformed stat/status/UTF8/child list and64KiB overflow reject',()=>{
  const b=procBytes(10);for(const patch of [{stat:b.stat.slice(0,35)},{stat:b.stat.replace('100','-100')},{status:b.status.replace('VmRSS:\t4 kB\n','')},{status:b.status+'Pid:\t10\n'},{status:b.status.replace('Pid:\t10','Pid:\t11')},{children:'11 11'},{children:'10'},{children:'-1'},{children:'1'.repeat(65537)},{stat:Buffer.from([255])}])assert.throws(()=>parseProcessBytes(10,{...b,...patch}));
});
test('stable before/after proc observation is LIVE with no leaked descriptors',()=>{
  const f=procIO(10,procBytes(10));const r=observeProcess(10,{io:f.io});assert.equal(r.state,'LIVE');assert.equal(r.rss_bytes,8192);assert.equal(f.fds.size,0);assert(f.calls.every(c=>c.file.startsWith('/proc/10/')));
});
test('only known absence is GONE; permission/malformed/close errors are UNKNOWN',()=>{
  for(const code of ['ENOENT','ESRCH'])assert.equal(observeProcess(10,{io:procIO(10,procBytes(10),{statSequence:[error(code)]}).io}).state,'GONE');
  for(const options of [{statSequence:[error('EACCES')]},{statSequence:['broken']},{closeError:'ENOENT'}])assert.equal(observeProcess(10,{io:procIO(10,procBytes(10),options).io}).state,'UNKNOWN');
});
test('secondary disappearance needs a confirmed absent stat, identity changes unknown',()=>{
  const b=procBytes(10),changed=procBytes(10,{start:'101'});
  assert.equal(observeProcess(10,{io:procIO(10,b,{statusValue:error('ENOENT'),statSequence:[b.stat,b.stat,error('ENOENT')]}).io}).state,'GONE');
  assert.equal(observeProcess(10,{io:procIO(10,b,{statusValue:error('ENOENT')}).io}).state,'UNKNOWN');
  assert.equal(observeProcess(10,{io:procIO(10,b,{statSequence:[b.stat,b.stat,changed.stat]}).io}).state,'UNKNOWN');
  assert.equal(observeProcess(10,{io:procIO(10,b,{childrenValue:error('EACCES')}).io}).state,'UNKNOWN');
});
test('bounded proc read stops at65537 bytes and remains UNKNOWN',()=>{const f=procIO(10,procBytes(10),{statusValue:'x'.repeat(65537)});assert.equal(observeProcess(10,{io:f.io}).state,'UNKNOWN');assert.equal(f.fds.size,0);});
test('tree retains escaped new descendants/RSS before group HOLD, input immutable',()=>{
  const input=Object.freeze([Object.freeze({...registry[0]})]),observe=pid=>pid===10?live(10,{group:99,children:[11]}):live(11,{ppid:10,group:99,rss:200});const r=collectOwnedTree(input,{observe});assert.equal(r.known_rss_bytes,300);assert.equal(r.aggregate_rss_bytes,300);assert.equal(r.records.length,2);assert.equal(r.unregistered.length,1);assert.equal(r.group_changes.length,2);assert.equal(r.hold,true);assert.equal(r.absence_known,false);assert.equal(input.length,1);assert(Object.isFrozen(r.records[1]));
});
test('lineage parent recheck retains its higher observed RSS without double count',()=>{let n=0;const r=collectOwnedTree(registry,{observe:pid=>pid===10?live(pid,{rss:++n===1?100:300,children:[11]}):live(pid,{ppid:10,rss:200})});assert.equal(r.known_rss_bytes,500);assert.equal(r.aggregate_rss_bytes,500);});
test('fresh parent group escape is retained even when child stays in expected group',()=>{let n=0;const r=collectOwnedTree(registry,{observe:pid=>pid===10?live(pid,{group:++n===1?10:99,children:[11]}):live(pid,{ppid:10,group:10,rss:200})});assert.deepEqual(r.group_changes,[{pid:10,start_ticks:'100',expected_group:10,observed_group:99}]);assert.equal(r.known_rss_bytes,300);assert.equal(r.hold,true);assert.equal(r.absence_known,false);});
test('fresh recheck-only child stays an unresolved candidate with null aggregate',()=>{let n=0;const observed=[];const r=collectOwnedTree(registry,{observe:pid=>{observed.push(pid);if(pid===10)return live(pid,{children:++n===1?[11]:[11,12]});assert.equal(pid,11);return live(pid,{ppid:10,rss:200});}});assert.equal(r.records.length,2);assert(r.candidates.some(c=>c.pid===12&&c.reason==='DESCENDANT_DISCOVERED_DURING_RECHECK'));assert(r.unknowns.some(c=>c.pid===12));assert.equal(r.aggregate_rss_bytes,null);assert.equal(r.known_rss_bytes,300);assert.equal(r.absence_known,false);assert(!observed.includes(12));});
test('registered reparented descendants remain tracked after root disappears',()=>{
  const input=[...registry,{pid:11,start_ticks:'110',group:10,parent_pid:10}],r=collectOwnedTree(input,{observe:pid=>pid===10?gone(pid):live(pid,{ppid:1,rss:200})});assert.equal(r.known_rss_bytes,200);assert.equal(r.absence_known,false);assert.equal(r.records.length,2);
});
test('unknown/reuse null aggregate retain subtotal/candidates and cannot prove absence',()=>{
  for(const problem of [unknown(11),live(11,{start:'999',rss:9999})]){const r=collectOwnedTree([...registry,{pid:11,start_ticks:'110',group:10}],{observe:pid=>pid===10?live(pid):problem});assert.equal(r.aggregate_rss_bytes,null);assert.equal(r.known_rss_bytes,100);assert.equal(r.absence_known,false);assert.equal(r.hold,true);assert.equal(r.candidates.length,1);}
});
test('failed descendant lineage and parent recheck remain ambiguous, never adopted',()=>{
  const r=collectOwnedTree(registry,{observe:pid=>pid===10?live(pid,{children:[11]}):live(pid,{ppid:99})});assert.equal(r.records.length,1);assert.equal(r.aggregate_rss_bytes,null);assert.equal(r.absence_known,false);
  let n=0;const s=collectOwnedTree(registry,{observe:pid=>pid===10?(++n===1?live(pid,{children:[11]}):unknown(pid)):live(pid,{ppid:10})});assert.equal(s.records.length,1);assert.equal(s.hold,true);
});
test('all retained identities gone is scoped known absence; malformed observer unknown',()=>{
  const r=collectOwnedTree(registry,{observe:gone});assert.equal(r.absence_known,true);assert.equal(r.group_absence_claim,false);for(const observe of [()=>{throw Error('fiction');},()=>({state:'LIVE',pid:10}),()=>({...live(10),rss_bytes:NaN})]){const s=collectOwnedTree(registry,{observe});assert.equal(s.absence_known,false);assert.equal(s.aggregate_rss_bytes,null);}
});
test('signal proposal contains only positive birth-matched identities, sends nothing',()=>{
  const input=[...registry,{pid:11,start_ticks:'110',group:10},{pid:12,start_ticks:'120',group:10}],r=verifiedSignalPlan(input,{observe:pid=>pid===10?live(pid):pid===11?live(pid,{start:'999'}):unknown(pid)});assert.deepEqual(r.verified,[{pid:10,start_ticks:'100',group:10}]);assert.equal(r.reused.length,1);assert.equal(r.unknowns.length,1);assert.equal(r.hold,true);assert.equal(r.signals_sent,false);assert.equal(r.group_signals_proposed,false);assert.equal(verifiedSignalPlan(registry,{observe:gone}).absence_known,true);
});
