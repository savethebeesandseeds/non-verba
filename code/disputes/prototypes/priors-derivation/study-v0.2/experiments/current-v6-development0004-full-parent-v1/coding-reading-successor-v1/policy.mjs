// SPDX-License-Identifier: AGPL-3.0-only
// SOURCE-ONLY proposal; all exports are pure.
export const R='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
export const S='/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2';
export const D=R+'/coding/open-coding-a/current-v6/reading-successor-v1/run-v1';
export const SOURCE='82a3dab1396336edccf77f27a7800cccddff67ca928e919e824a663e1d563601';
export const PACKET={path:R+'/audits/049d0f4fe07080f7e7f0/coding.json',sha256:'51143feeddcc5f35be66a62748642adb1af7442ffea7134e640816f68f2943e2',bytes:1643742};
export const PROFILE=Object.freeze({response_bytes:1048576,presentation_bytes:4194304,review_bytes:1048576,review_utf16:1048576,nodes:100000,depth:64});
const O=R+'/coding/open-coding-a/current-v6/overlay-0106-v1';
export const PURE={presentation:{path:O+'/presentation.mjs',sha256:'f55c7c44543c414e0ab9bffb806594ea003789fe2f3869e0ca89aa6f5ff6cabe',bytes:8270},validator:{path:O+'/response-validation.mjs',sha256:'e65a336c0e9d78a03b54192d42ca0a45d1f16a3a0faaba65bf29f75c8dcb8cca',bytes:20640}};
export const READER={path:S+'/lib/audit-reader.mjs',sha256:'a00d1a3203be40dbc5b6497dd938031c3461ad6954f98651da95275034c2b3c9',bytes:13693};
export const STORE={path:S+'/lib/store.mjs',sha256:'2a1ecd6da273cff3be44202958cb46e3e1b0c754bed485b54347adee4e49eee3',bytes:24187};
export const RETAINED=[{range:[28000,28500],pretty:{path:R+'/coding/open-coding-a/current-v6/projection-bound-diagnostic-v1/run-v1/attempt-001-response.json',sha256:'0629c30ca7f8af80815a84eadebab2a42c028c0ab94df04d5ddc0fd69e3d800f',bytes:1390066},canonical:{sha256:'08c3a642f7fb99f0a9f7543e287dd0b6e7e0c7eb4fbafea216a850bd7a3f3807',bytes:874224}},{range:[28500,29000],pretty:{path:R+'/coding/open-coding-a/current-v6/projection-bound-diagnostic-v1/run-v1/attempt-002-response.json',sha256:'a58ef15d6f058c2a20f1251d73b9235e266c6ecbf5913045410e97920795795b',bytes:498977},canonical:{sha256:'2c602426d089fcb2565a0d5c6d364fa2df310b677b967fc0d82dbc33903c8e9b',bytes:314340}}];
const SH=R+'/qa/fixed0106-retained-half-presentation-shadow-20261019-v1';
export const SHADOW={result:{path:SH+'/result.json',sha256:'e97f23eccf1b2c59e8473af7a51a34e2bc4c2d04dbe9d48098a7706b980c0f88',bytes:3091},observation:{path:SH+'/ROOT-observation.json',sha256:'7aa0d814e9430294f23161b28a97cfdccb0f1e2427d2a884891c8383d7139402',bytes:389},halves:[{presentation:{path:SH+'/half-0-presentation.json',sha256:'f5f35d8402152e5850b1a700faa454806cd5b2f334f8fff4db98d4f3cacddb41',bytes:1625879},view_path:SH+'/half-0-view.json',view_sha:'f48097cff22011510850af33f1c8d48ed0fa26aa776cce9f3841c9f107f5776b',view_utf16:16879,view_bytes:16879},{presentation:{path:SH+'/half-1-presentation.json',sha256:'b03ee2add1fd5a115863ce3ecdb3b84e39a6b1c193136feff755c9e7081ce704',bytes:592753},view_path:SH+'/half-1-view.json',view_sha:'28bcc431370c4af9137be19587209f13423e56b93ddeeccce37536862fbfc9ce',view_utf16:10237,view_bytes:10237}]};
export function check(v,c){if(!v)throw Object.assign(Error(c),{code:c});}
export function n(v){check(Number.isSafeInteger(v)&&v>=0,'INTEGER');return v;}
export function add(a,b){return n(n(a)+n(b));}
export const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const caseID=i=>'coding-'+String(i).padStart(4,'0');
export function finiteCurrent(completed){check(Number.isSafeInteger(completed)&&completed>=0&&completed<=1,'CASE_COUNT');return completed===0?'coding-0106':null;}
export function fresh(g){check(g.full_fresh100===true&&g.fresh_sections===100&&g.fresh_contract_count===29&&Array.isArray(g.fresh_contract_ids)&&g.fresh_contract_ids.length===29&&new Set(g.fresh_contract_ids).size===29&&g.fresh_contract_ids.every(x=>/^contract-[a-f0-9]{20}$/u.test(x)),'FULL_FRESH_GUARD');return new Set(g.fresh_contract_ids);}
export function packetRows(p,g){const f=fresh(g);check(p.purpose==='coding'&&Array.isArray(p.rows)&&p.rows.length===500&&p.rows.every((r,i)=>r.audit_id===caseID(i+1)&&!f.has(r.contract_id)),'FIXED500_FRESH_EXCLUSION');return p.rows;}
export function boundary(t,p){return Number.isSafeInteger(p)&&p>=0&&p<=t.length&&!(p&&p<t.length&&/[\uD800-\uDBFF]/u.test(t[p-1])&&/[\uDC00-\uDFFF]/u.test(t[p]));}
export function nextRange(text,start,cap){check(boundary(text,start)&&start<text.length&&[500,7000].includes(cap),'NEXT_RANGE');let end=Math.min(text.length,start+cap);if(!boundary(text,end))end--;check(end>start,'EMPTY_CODEPOINT_RANGE');return [start,end];}
export function coverage(ranges,start,end){let at=start;for(const [s,e]of ranges){check(s===at&&e>s&&e<=end,'COVERAGE_GAP_OR_OVERLAP');at=e;}return at;}
export function budget(used,limits,reserve={}){check(reserve&&typeof reserve==='object'&&Object.keys(reserve).every(k=>['visible','capture','artifact'].includes(k)),'RESERVE_KEYS');for(const k of ['visible','capture','artifact'])check(add(n(used[k]),Object.hasOwn(reserve,k)?n(reserve[k]):0)<=n(limits[k]),'CAP_'+k);return used;}
export function ledgerAccounting(prior,append){
 check(typeof prior==='string'&&typeof append==='function','LEDGER_INPUT');let capture=65536,visible=65536;
 const validate=e=>{check(e&&same(Object.keys(e).sort(),['capture','visible','why'])&&typeof e.why==='string'&&e.why.length<=128,'LEDGER_EVENT');n(e.capture);n(e.visible);return e;};
 for(const line of prior.trim()?prior.trim().split('\n'):[]){const e=validate(JSON.parse(line));capture=add(capture,e.capture);visible=add(visible,e.visible);}
 return {event(c=0,v=0,why='metadata'){const e=validate({capture:c,visible:v,why}),nc=add(capture,c),nv=add(visible,v);append(JSON.stringify(e)+'\n');capture=nc;visible=nv;},totals(){return {capture,visible};}};
}
export function observed(a,p,utf16){check(a.pageSHA===p.sha256&&a.outputSHA===p.sha256&&a.outputBytes===p.bytes&&a.outputUTF16===utf16&&n(a.wholeToolOutputUTF16)>=utf16&&a.wholeToolOutputUTF16<=9000,'OUTPUT_BINDING');check(a.nativeExitCode===0&&a.untruncated===true&&a.reviewerObservedPage===true&&a.outerToolResponseObservedComplete===true&&a.outerTruncationMarkerObserved===false&&a.forwardedStdoutExactPrepared===true,'ACTUAL_OUTER_OBSERVATION');for(const k of ['outerBudget','nestedBudget'])check(Number.isSafeInteger(a[k])&&a[k]>=p.bytes+2048,'TOOL_BUDGET');check(typeof a.externalChunkRef==='string'&&/^[A-Za-z0-9._:-]{1,128}$/u.test(a.externalChunkRef)&&a.externalToolCallRef==='exec_command:'+a.externalChunkRef,'EXTERNAL_TOOL_JOIN');}
export function admission(a){
 check(a.schema==='root-open-coding-a-reading-successor-v1'&&a.active===true&&a.reviewer_id==='open-coding-a'&&a.source_sha256===SOURCE&&a.root===D&&a.authority==='NONE','INACTIVE');
 check(a.start_case===106&&a.stop_case===106&&same(a.old_scope,[0,28000])&&a.old_JSON_pages===22&&a.old_V3_pages===37&&a.historical_canonical_rows===103&&a.historical_102_qualified===false&&a.old_phases_closed===true&&a.no_carry_refund===true,'CLOSED_SCOPE');
 for(const[k,v]of Object.entries({visible:6700000,capture:66000000,artifact:38000000,source_copy:1179648}))check(n(a.carry[k])>=v,'CARRY_FLOOR');
 check(same(a.profile,PROFILE)&&a.parent_cap===500&&a.raw_cap===7000&&a.page_utf16===6000&&a.whole_tool_utf16===9000,'READING_PROFILE');
 for(const[k,v]of Object.entries({visible:16777216,capture:1073741824,artifact:134217728}))check(n(a.limits[k])>0&&a.limits[k]<=v,'NEW_PHASE_LIMIT');
 check(/^[1-9][0-9]{0,24}$/u.test(a.clock.origin_ns)&&/^[1-9][0-9]{0,24}$/u.test(a.clock.deadline_ns)&&BigInt(a.clock.deadline_ns)>BigInt(a.clock.origin_ns)&&BigInt(a.clock.deadline_ns)-BigInt(a.clock.origin_ns)<=5400000000000n,'MONOTONIC_PHASE');
 check(a.watchdog_ms===60000&&a.heap_mib===512&&a.rss_bytes===1073741824&&a.external_capture_meter===true&&a.source_copy_floor===65536,'PROCESS_GUARDS');
 check(Array.isArray(a.retained_view_refs)&&a.retained_view_refs.length===2,'RETAINED_VIEWS');for(let i=0;i<2;i++)check(a.retained_view_refs[i].path===SHADOW.halves[i].view_path&&a.retained_view_refs[i].sha256===SHADOW.halves[i].view_sha&&a.retained_view_refs[i].bytes===SHADOW.halves[i].view_bytes,'SHADOW_VIEW_PIN');
 check(a.shadow_observation_ref?.sha256===SHADOW.observation.sha256&&a.shadow_observation_ref.bytes===389&&a.shadow_observation_ref.path===SHADOW.observation.path,'SHADOW_OBSERVATION_PIN');
}
