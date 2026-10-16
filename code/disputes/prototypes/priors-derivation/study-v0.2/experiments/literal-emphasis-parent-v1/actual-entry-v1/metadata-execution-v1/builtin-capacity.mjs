// SPDX-License-Identifier: AGPL-3.0-only
// Source preparation. Importing this builtin-only module performs no IO.
import capacityFS from 'node:fs';
import capacityPath from 'node:path';
import {createHash as capacityCreateHash} from 'node:crypto';

const capacityFail=code=>{throw Object.assign(Error(code),{code});};
const capacityFreeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))capacityFreeze(child);Object.freeze(value);}return value;};
const capacityHash=value=>capacityCreateHash('sha256').update(value).digest('hex');
export const CAPACITY_SOURCE_PINS=capacityFreeze({helper:{path:'qa/v15-current874-component-preparation-20261016/historical-component-inventory-v1/historical154-metadata-gzip-recovery-v1/run-capacity-helper-v3.mjs',sha256:'2a7b5a7c21ce70666d71508892d55fc932da3968e98dc4da5fe598d668580b6e',bytes:7103},policy:{path:'qa/v15-current874-component-preparation-20261016/historical-component-inventory-v1/historical154-metadata-gzip-recovery-v1/run-capacity-policy-v3.json',sha256:'0768b25042d2454c030d08ae8a390baa7bc075a73cbf20234aa5caabfdc22cdc',bytes:2285}});
export const ORIGINAL_CAPACITY_LIMITS=Object.freeze({floor:12330904043,baseline:12330245718,soft:335544320,hard:536870912,total:25769803776});
export const ORIGINAL_CAPACITY_POLICY=capacityFreeze({
  schema:'current874-exact-fixture-no-follow-capacity-policy-v3',
  study_root:'/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000',
  accounting:'SUM_EVERY_LSTAT_DIRECTORY_ENTRY_SIZE_NO_HARDLINK_DEDUP_NO_LINK_TRAVERSAL',
  unknown_nonregular:'REJECT',
  exceptions:[{
    path:'qa/v15-current874-component-preparation-20261016/historical-component-inventory-v1/historical154-metadata-gzip-recovery-v1/synthetic-codec-fixture/linked-directory',
    type:'SYMLINK',mode:41471,bytes:231,
    literal_target:'/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000/qa/v15-current874-component-preparation-20261016/historical-component-inventory-v1/historical154-metadata-gzip-recovery-v1/synthetic-codec-fixture/symlink-target',
    link_text_sha256:'823ce72aaff7a3cd6ffe38df2481bc467beadc23a07ddee447694fbd94ff0ea2',
    target:{path:'qa/v15-current874-component-preparation-20261016/historical-component-inventory-v1/historical154-metadata-gzip-recovery-v1/synthetic-codec-fixture/symlink-target',type:'DIRECTORY',mode:16877,bytes:4096,dev:2096,ino:1959070}
  },{
    path:'qa/v15-current874-component-preparation-20261016/historical-component-inventory-v1/historical154-metadata-gzip-recovery-v1/synthetic-codec-fixture/linked-file.json.gz',
    type:'SYMLINK',mode:41471,bytes:239,
    literal_target:'/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000/qa/v15-current874-component-preparation-20261016/historical-component-inventory-v1/historical154-metadata-gzip-recovery-v1/synthetic-codec-fixture/cases/declared.json.gz',
    link_text_sha256:'12fc79bdaeec6235d392d771449648249c74a9dd84f5090eb1190a84a048d8b3',
    target:{path:'qa/v15-current874-component-preparation-20261016/historical-component-inventory-v1/historical154-metadata-gzip-recovery-v1/synthetic-codec-fixture/cases/declared.json.gz',type:'FILE',mode:33152,bytes:318,dev:2096,ino:1959069}
  }],
  vanished_transfer_policy:'ORIGINAL_STORE_UUIDV4_REGULAR_DIRENT_ENOENT_ONLY_V1'
});

function capacityCanonical(value){
  let nodes=0;
  function visit(v,depth){
    if(++nodes>10000||depth>64)capacityFail('RUN_CAPACITY_POLICY_BOUND');
    if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
    if(Array.isArray(v)){if(Object.keys(v).length!==v.length)capacityFail('RUN_CAPACITY_POLICY_DATA');return '['+Array.from({length:v.length},(_,i)=>{if(!Object.hasOwn(v,i))capacityFail('RUN_CAPACITY_POLICY_DATA');return visit(v[i],depth+1);}).join(',')+']';}
    if(v&&Object.getPrototypeOf(v)===Object.prototype){const descriptors=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(v).length!==Object.keys(v).length||Object.values(descriptors).some(d=>!Object.hasOwn(d,'value')||!d.enumerable))capacityFail('RUN_CAPACITY_POLICY_DATA');return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+visit(v[k],depth+1)).join(',')+'}';}
    capacityFail('RUN_CAPACITY_POLICY_DATA');
  }
  return visit(value,0);
}
const capacityOriginalCanonical=capacityCanonical(ORIGINAL_CAPACITY_POLICY);
export function validateOriginalCapacityPolicy(policy){if(capacityCanonical(policy)!==capacityOriginalCanonical)capacityFail('RUN_CAPACITY_ORIGINAL_POLICY_REQUIRED');return true;}

const capacityUUID='[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const capacityJSONTransfer=new RegExp('\\.'+capacityUUID+'\\.partial$');
const capacityRowTransfer=new RegExp('^rows-'+capacityUUID+'\\.(?:ndjson|parquet)$');
const capacityRawTransfer=new RegExp('-'+capacityUUID+'\\.partial$');
function capacityTransfer(file){const name=capacityPath.basename(file),parent=capacityPath.basename(capacityPath.dirname(file));return capacityJSONTransfer.test(name)||parent==='partials'&&capacityRowTransfer.test(name)||parent==='raw-partials'&&capacityRawTransfer.test(name);}
const capacityIdentity=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode;

// The clock bounds traversal work; it cannot cancel a blocking kernel syscall.
// io/now injection exists for declared controls. Production supplies fixed fs.
function capacityWalk(root,{io,now,deadline_ms,max_bytes,original}){
  if(typeof root!=='string'||!capacityPath.isAbsolute(root)||capacityPath.resolve(root)!==root||root==='/'||typeof now!=='function'||!Number.isFinite(deadline_ms)||deadline_ms<0||!Number.isSafeInteger(max_bytes)||max_bytes<0)capacityFail('RUN_CAPACITY_BOUND_INVALID');
  const policy=ORIGINAL_CAPACITY_POLICY;
  if(original&&root!==policy.study_root&&!root.startsWith(policy.study_root+'/'))capacityFail('RUN_CAPACITY_ROOT_INVALID');
  let previous=-Infinity,steps=0,entriesSeen=0,bytes=0,linkBytes=0,vanished=0;
  const counts={files:0,directories:0,fixture_links:0},observed=[];
  const tick=()=>{const t=now();if(!Number.isFinite(t)||t<0||t<previous)capacityFail('RUN_CAPACITY_CLOCK_UNKNOWN');previous=t;if(t>deadline_ms)capacityFail('RUN_CAPACITY_DEADLINE');if(++steps>10000000)capacityFail('RUN_CAPACITY_STEP_BOUND');};
  const call=(method,...args)=>{tick();if(!io||typeof io[method]!=='function')capacityFail('RUN_CAPACITY_IO_INVALID');try{return io[method](...args);}finally{tick();}};
  const add=n=>{if(!Number.isSafeInteger(n)||n<0||!Number.isSafeInteger(bytes+n))capacityFail('RUN_CAPACITY_SIZE_INVALID');bytes+=n;if(bytes>max_bytes)capacityFail('RUN_CAPACITY_TREE_BYTES_BOUND');};
  const noLinkedAncestors=target=>{let at='/';for(const part of target.split('/').filter(Boolean)){at=capacityPath.join(at,part);const s=call('lstatSync',at);if(!s.isDirectory()||s.isSymbolicLink())capacityFail('RUN_CAPACITY_LINKED_OR_NON_DIRECTORY_PARENT');}return call('lstatSync',target);};
  noLinkedAncestors(root);
  const allowed=new Map(original?policy.exceptions.map(e=>[capacityPath.resolve(policy.study_root,e.path),e]):[]);
  const checkTarget=e=>{const target=capacityPath.resolve(policy.study_root,e.target.path);noLinkedAncestors(capacityPath.dirname(target));const s=call('lstatSync',target);if(s.isSymbolicLink()||!capacityIdentity(s,e.target)||s.size!==e.target.bytes||(e.target.type==='FILE'?!s.isFile():!s.isDirectory()))capacityFail('RUN_CAPACITY_FIXTURE_TARGET_CHANGED');};
  const stack=[{file:root,enumeratedType:null,allowVanished:false}];
  while(stack.length){
    tick();const {file,enumeratedType,allowVanished}=stack.pop();let s;
    try{s=call('lstatSync',file);}catch(error){if(original&&error.code==='ENOENT'&&allowVanished&&capacityTransfer(file)){vanished++;continue;}throw error;}
    if(s.isSymbolicLink()){
      const e=allowed.get(file);if(!e)capacityFail('RUN_CAPACITY_UNKNOWN_NONREGULAR');
      const literal=call('readlinkSync',file),again=call('lstatSync',file);
      if(!capacityIdentity(s,again)||s.mode!==e.mode||s.size!==e.bytes||literal!==e.literal_target||capacityHash(Buffer.from(literal))!==e.link_text_sha256)capacityFail('RUN_CAPACITY_FIXTURE_LINK_CHANGED');
      checkTarget(e);add(s.size);linkBytes+=s.size;counts.fixture_links++;observed.push(e.path);continue;
    }
    if(!s.isFile()&&!s.isDirectory())capacityFail('RUN_CAPACITY_UNKNOWN_NONREGULAR');
    if(enumeratedType&&enumeratedType!==(s.isFile()?'FILE':'DIRECTORY'))capacityFail('RUN_CAPACITY_ENTRY_TYPE_CHANGED');
    add(s.size);
    if(s.isFile()){counts.files++;continue;}
    counts.directories++;const entries=call('readdirSync',file,{withFileTypes:true});
    if(!Array.isArray(entries)||entries.some(e=>typeof e.name!=='string'||!e.name||e.name==='.'||e.name==='..'||e.name.includes('/')||e.name.includes('\0')||Buffer.byteLength(e.name)>255||!['isFile','isDirectory','isSymbolicLink'].every(k=>typeof e[k]==='function'))||new Set(entries.map(e=>e.name)).size!==entries.length)capacityFail('RUN_CAPACITY_DIRECTORY_ENTRIES_INVALID');
    entriesSeen+=entries.length;if(!Number.isSafeInteger(entriesSeen)||entriesSeen>1000000)capacityFail('RUN_CAPACITY_ENTRY_BOUND');
    if(!capacityIdentity(s,call('lstatSync',file)))capacityFail('RUN_CAPACITY_DIRECTORY_IDENTITY_CHANGED');
    for(let i=entries.length-1;i>=0;i--){tick();const entry=entries[i],child=capacityPath.join(file,entry.name);let type;
      if(entry.isSymbolicLink())type='SYMLINK';else if(entry.isFile())type='FILE';else if(entry.isDirectory())type='DIRECTORY';else capacityFail('RUN_CAPACITY_UNKNOWN_NONREGULAR');
      stack.push({file:child,enumeratedType:type,allowVanished:original&&type==='FILE'&&capacityTransfer(child)});
    }
  }
  observed.sort();const expected=original?policy.exceptions.filter(e=>{const p=capacityPath.resolve(policy.study_root,e.path);return p===root||p.startsWith(root+'/');}).map(e=>e.path).sort():[];
  if(capacityCanonical(observed)!==capacityCanonical(expected))capacityFail('RUN_CAPACITY_EXPECTED_FIXTURE_MISSING');
  const result=capacityFreeze({schema:original?'current874-no-follow-capacity-result-v1':'private-output-no-follow-capacity-result-v1',bytes,counts,fixture_link_bytes:linkBytes,vanished_validated_regular_transfer_count:vanished,vanished_transfer_policy:original?policy.vanished_transfer_policy:'NONE',exact_fixture_exceptions_observed:observed,accounting:policy.accounting,unknown_nonregular_rejected:true,link_targets_traversed:false,hardlinks_counted_per_entry:true,concurrent_snapshot_claim:false});
  tick();return result;
}

export function measureBoundedTree(root,policy,{io=capacityFS,now=()=>performance.now(),deadline_ms}={}){
  validateOriginalCapacityPolicy(policy);return capacityWalk(root,{io,now,deadline_ms,max_bytes:Number.MAX_SAFE_INTEGER,original:true});
}
export function measurePrivateTree(root,{io=capacityFS,now=()=>performance.now(),deadline_ms,max_bytes}={}){
  return capacityWalk(root,{io,now,deadline_ms,max_bytes,original:false});
}
export function assessCapacity(bytes,{admission=false}={}){
  if(!Number.isSafeInteger(bytes)||bytes<0||typeof admission!=='boolean')capacityFail('RUN_CAPACITY_SAMPLE_INVALID');
  const limits=ORIGINAL_CAPACITY_LIMITS;if(bytes<limits.floor)capacityFail('RUN_CAPACITY_ORIGINAL_FLOOR');
  const growth=bytes-limits.baseline,limit=admission?limits.soft:limits.hard;
  if(bytes>limits.total||growth>limit)capacityFail('RUN_CAPACITY_SHARED_OR_STUDY_LIMIT');
  return Object.freeze({within_capacity_limits:true,bytes,growth_bytes:growth,admission});
}
