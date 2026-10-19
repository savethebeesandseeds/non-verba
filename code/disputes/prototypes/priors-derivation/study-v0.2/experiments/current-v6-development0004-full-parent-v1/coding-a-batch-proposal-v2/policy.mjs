// SPDX-License-Identifier: AGPL-3.0-only
// Inactive batch configuration and pure local accounting; no filesystem IO.
export const R='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
export const S='/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2';
export const D=R+'/coding/open-coding-a/current-v6/reading-batch-0107-0126-v1/run-v1';
export const SOURCE='82a3dab1396336edccf77f27a7800cccddff67ca928e919e824a663e1d563601';
export const PACKET={path:R+'/audits/049d0f4fe07080f7e7f0/coding.json',sha256:'51143feeddcc5f35be66a62748642adb1af7442ffea7134e640816f68f2943e2',bytes:1643742};
export const MANIFEST={path:R+'/processing/82a3dab1396336ed/calibration-1000-cea0eeae0bf69647/extraction-manifest.json',sha256:'7726139476a239ded60b75a25ec033d51569f53556020739ae28c86835ad7b13',bytes:5179014};
export const CLOSED_CARRY_FLOOR=Object.freeze({visible:9181754,capture:1111680397,artifact:58025883,source_copy:1638400});
export const PROFILE=Object.freeze({response_bytes:2097152,presentation_bytes:4194304,review_bytes:1048576,review_utf16:1048576,nodes:100000,depth:64});
const N=R+'/qa/shared-coding-native-source-reader-v1-20261019';
export const READER={path:N+'/audit-reader-subdivided.mjs',sha256:'8a69da8b944184c0b1be436e152c10291450940858a5cdfb4d1a7ab6f0b67b49',bytes:14573};
export const PARTITIONS={path:N+'/native-projection-partitions.mjs',sha256:'b040efedce424b9f06ad2769e9372a0d5a2f21fe9a52c6b0887646612925a142',bytes:4865};
export const PURE={presentation:{path:'/tmp/nonverba-coding-b-partitioned-native-presentation-v1-controls-20261019-a2/presentation.mjs',sha256:'3b83414d9e7a547676254741c36642aeaafe501b971e784ff6fa1a6d1fd3b4ef',bytes:11606},single:{path:'/tmp/nonverba-coding-b-native-presentation-v3-2m-v1-controls-20261019-a1/presentation.mjs',sha256:'60028847cac707940a4565efc439ecbab6fd7c1ab3e0551594f2580c0c2a1b88',bytes:8282},validator:{path:'/tmp/nonverba-coding-b-native-presentation-v3-2m-v1-controls-20261019-a1/response-validation.mjs',sha256:'017aa1bb343facf7cb93f59764376a342aee8c1a688cb7d6db5dcd8626aafa14',bytes:20652}};
export const SHARED_SOURCE_PATHS=['lib/common.mjs','lib/acquire.mjs','lib/analyze.mjs','lib/extract.mjs','lib/embed.mjs','lib/discover.mjs','package.json','package-lock.json'].map(x=>S.slice(0,-'study-v0.2'.length)+x);
export const EXTRA_PATHS=Object.values(PURE).map(r=>r.path);
export const STORE={path:S+'/lib/store.mjs',sha256:'2a1ecd6da273cff3be44202958cb46e3e1b0c754bed485b54347adee4e49eee3',bytes:24187};
export const PROTOCOL_PINS=[{name:'policy.mjs',sha256:'6f68770783834aa632b9518f0108c290ebd93ad8ee2fce40db9a502317154f79',bytes:15834},{name:'cached-adapter.mjs',sha256:'38b8d63fb42248d2cd2a813402803bd85acc75a7d3cef3ec92ee6c0d021d10cb',bytes:4344},{name:'cached-guard.mjs',sha256:'9d7ab5a0c17c9ec4de2d660edbf2a9295712fa83d29d5b57e1071954a06cbf49',bytes:2217}];
export const PRESENTER={kind:'PARTITIONED_NATIVE_V1',module_ref:PURE.presentation,profile:PROFILE,parent_cap:5000,raw_cap:7000,page_utf16:6000,whole_tool_utf16:9000};
export function check(v,c){if(!v)throw Object.assign(Error(c),{code:c});}
export function n(v){check(Number.isSafeInteger(v)&&v>=0,'INTEGER');return v;}
export function add(a,b){return n(n(a)+n(b));}
export const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const caseID=i=>'coding-'+String(i).padStart(4,'0');

export function fresh(g){check(g.full_fresh100===true&&g.fresh_sections===100&&g.fresh_contract_count===29&&Array.isArray(g.fresh_contract_ids)&&g.fresh_contract_ids.length===29&&new Set(g.fresh_contract_ids).size===29&&g.fresh_contract_ids.every(x=>/^contract-[a-f0-9]{20}$/u.test(x)),'FULL_FRESH_GUARD');return new Set(g.fresh_contract_ids);}
export function packetRows(p,g){const f=fresh(g);check(p.purpose==='coding'&&Array.isArray(p.rows)&&p.rows.length===500&&p.rows.every((r,i)=>r.audit_id===caseID(i+1)&&!f.has(r.contract_id)),'FIXED500_FRESH_EXCLUSION');return p.rows;}
export function identityProjection(p,m,g){
 const rows=packetRows(p,g),mr=p.source?.input_manifest;check(mr&&mr.path===MANIFEST.path.slice(R.length+1)&&mr.sha256===MANIFEST.sha256&&mr.bytes===MANIFEST.bytes&&m.source?.sha256===SOURCE,'EXTRACTION_MANIFEST_JOIN');
 check(Array.isArray(m.contract_records)&&Array.isArray(m.cache),'MANIFEST_ARRAYS');const records=new Map(),caches=new Map();for(const [list,map]of [[m.contract_records,records],[m.cache,caches]])for(const x of list){check(x&&typeof x.id==='string'&&!map.has(x.id),'MANIFEST_DUPLICATE');map.set(x.id,x);}
 return {purpose:'coding',rows:rows.map(r=>{const rec=records.get(r.contract_id),cache=caches.get(r.contract_id),l=r.lineage;check(rec&&cache&&l&&['accepted','rejected'].includes(rec.status)&&['discovery-broad','discovery-relevant'].includes(rec.cohort)&&rec.cohort===l.cohort&&rec.raw_sha256===l.raw_sha256&&cache.raw_sha256===l.raw_sha256&&cache.path===l.cache_path&&cache.sha256===l.cache_sha256&&cache.source_sha256===SOURCE,'AUTHENTICATED_RECORD_LINEAGE');if(rec.status==='accepted')check(typeof rec.normalized_path==='string'&&rec.normalized_path===l.normalized_path&&rec.normalized_sha256===l.normalized_sha256,'ACCEPTED_NORMALIZED_LINEAGE');return {audit_id:r.audit_id,id:r.id,contract_id:r.contract_id,record:{status:rec.status},parent:r.parent};})};
}
export function boundary(t,p){return Number.isSafeInteger(p)&&p>=0&&p<=t.length&&!(p&&p<t.length&&/[\uD800-\uDBFF]/u.test(t[p-1])&&/[\uDC00-\uDFFF]/u.test(t[p]));}
export function nextRange(text,start,cap){check(boundary(text,start)&&start<text.length&&[5000,7000].includes(cap),'NEXT_RANGE');let end=Math.min(text.length,start+cap);if(!boundary(text,end))end--;check(end>start,'EMPTY_CODEPOINT_RANGE');return [start,end];}
export function coverage(ranges,start,end){let at=start;for(const [s,e]of ranges){check(s===at&&e>s&&e<=end,'COVERAGE_GAP_OR_OVERLAP');at=e;}return at;}
export function budget(used,limits,reserve={}){check(reserve&&typeof reserve==='object'&&Object.keys(reserve).every(k=>['visible','capture','artifact'].includes(k)),'RESERVE_KEYS');for(const k of ['visible','capture','artifact'])check(add(n(used[k]),Object.hasOwn(reserve,k)?n(reserve[k]):0)<=n(limits[k]),'CAP_'+k);return used;}
export function ledgerAccounting(prior,append){
 check(typeof prior==='string'&&typeof append==='function','LEDGER_INPUT');let capture=65536,visible=65536;
 const validate=e=>{check(e&&same(Object.keys(e).sort(),['capture','visible','why'])&&typeof e.why==='string'&&e.why.length<=128,'LEDGER_EVENT');n(e.capture);n(e.visible);return e;};
 for(const line of prior.trim()?prior.trim().split('\n'):[]){const e=validate(JSON.parse(line));capture=add(capture,e.capture);visible=add(visible,e.visible);}
 return {event(c=0,v=0,why='metadata'){const e=validate({capture:c,visible:v,why}),nc=add(capture,c),nv=add(visible,v);append(JSON.stringify(e)+'\n');capture=nc;visible=nv;},totals(){return {capture,visible};}};
}
export function observed(a,p,utf16){check(a.pageSHA===p.sha256&&a.outputSHA===p.sha256&&a.outputBytes===p.bytes&&a.outputUTF16===utf16&&n(a.wholeToolOutputUTF16)>=utf16&&a.wholeToolOutputUTF16<=9000,'OUTPUT_BINDING');check(a.nativeExitCode===0&&a.untruncated===true&&a.reviewerObservedPage===true&&a.outerToolResponseObservedComplete===true&&a.outerTruncationMarkerObserved===false&&a.forwardedStdoutExactPrepared===true,'ACTUAL_OUTER_OBSERVATION');for(const k of ['outerBudget','nestedBudget'])check(Number.isSafeInteger(a[k])&&a[k]>=p.bytes+2048,'TOOL_BUDGET');check(typeof a.externalChunkRef==='string'&&/^[A-Za-z0-9._:-]{1,128}$/u.test(a.externalChunkRef)&&a.externalToolCallRef==='exec_command:'+a.externalChunkRef,'EXTERNAL_TOOL_JOIN');}
export function admission(a,x){
 check(a.schema==='root-open-coding-a-ordered20-batch-runtime-v1'&&a.active===true&&a.reviewer_id==='open-coding-a'&&a.source_sha256===SOURCE&&a.root===D&&a.authority==='NONE','INACTIVE_BATCH');
 check(a.start_case===107&&a.stop_case===126&&a.old_phases_closed===true&&a.no_carry_refund===true&&a.historical_qualification_inferred===false,'FINITE20_SCOPE');
 check(a.allocation_ref.path===D+'/allocation.json'&&x.root===D&&x.reviewer_id==='open-coding-a'&&x.source_epoch===SOURCE&&x.case_limits===null,'GLOBAL_ONLY_ALLOCATION');
 for(const[k,v]of Object.entries(CLOSED_CARRY_FLOOR))check(n(x.carry[k])>=v,'CLOSED_CARRY_FLOOR');
 check(Number.isFinite(x.carry_elapsed_ms)&&x.carry_elapsed_ms>=0,'CARRY_ELAPSED');
 for(const k of ['visible','capture','artifact','source_copy'])check(n(x.phase_limits[k])>0,'FINITE_PHASE_LIMIT');
 check(Number.isSafeInteger(x.source_copy_floor)&&x.source_copy_floor>=65536&&x.source_copy_floor<=262144,'COPY_FLOOR');
 check(/^[1-9][0-9]{0,24}$/u.test(x.clock.origin_ns)&&/^[1-9][0-9]{0,24}$/u.test(x.clock.deadline_ns)&&BigInt(x.clock.deadline_ns)>BigInt(x.clock.origin_ns)&&BigInt(x.clock.deadline_ns)-BigInt(x.clock.origin_ns)<=5400000000000n,'PROSPECTIVE_CLOCK');
 check(x.watchdog_ms===60000&&x.heap_mib===512&&x.rss_bytes===1073741824&&x.external_capture_meter===true,'PROCESS_GUARDS');
 return {...a,clock:x.clock,carry:x.carry,limits:x.phase_limits,source_copy_floor:x.source_copy_floor,rss_bytes:x.rss_bytes};
}