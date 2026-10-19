// SPDX-License-Identifier: AGPL-3.0-only
// SOURCE-ONLY proposal; all exports are pure.
import {validateCapsule,makePermit as genericPermit,validateCachedPage} from './cached-guard.mjs';
export const R='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
export const S='/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2';
export const D=R+'/coding/open-coding-a/current-v6/reading-efficient-successor-v1/run-v1';
export const SOURCE='82a3dab1396336edccf77f27a7800cccddff67ca928e919e824a663e1d563601';
export const PACKET={path:R+'/audits/049d0f4fe07080f7e7f0/coding.json',sha256:'51143feeddcc5f35be66a62748642adb1af7442ffea7134e640816f68f2943e2',bytes:1643742};
export const CASE={audit_id:'coding-0106',source_id:'contract-b0b2c524b83beb9babbd:section:54-46469:e4736e595570:unit:44075-45267:17cae4b7874b',contract_id:'contract-b0b2c524b83beb9babbd'};
export const METHOD={path:R+'/qa/projection-bound-subdivision-root-metadata-preflight-20261019-v1/result.json',sha256:'ebb4523f29830c4ee5e00b3fa1bd06f81048920fa3942b4f15152b28cbc358a6',bytes:27870};
export const CLOSE={path:R+'/coding/open-coding-a/current-v6/reading-successor-v1/run-v1/phase-close-v1.json',sha256:'549301cb87cc6f92deb13464c24bac8039a8e088346f16d707651b6012873849',bytes:2150};
export const ORIGINAL_BASE={visible:6700000,capture:66000000,artifact:38000000};
export const PROFILE=Object.freeze({response_bytes:1048576,presentation_bytes:4194304,review_bytes:1048576,review_utf16:1048576,nodes:100000,depth:64});
const O=R+'/coding/open-coding-a/current-v6/overlay-0106-v1';
export const PURE={presentation:{path:O+'/presentation.mjs',sha256:'f55c7c44543c414e0ab9bffb806594ea003789fe2f3869e0ca89aa6f5ff6cabe',bytes:8270},validator:{path:O+'/response-validation.mjs',sha256:'e65a336c0e9d78a03b54192d42ca0a45d1f16a3a0faaba65bf29f75c8dcb8cca',bytes:20640}};
export const READER={path:S+'/lib/audit-reader.mjs',sha256:'a00d1a3203be40dbc5b6497dd938031c3461ad6954f98651da95275034c2b3c9',bytes:13693};
export const STORE={path:S+'/lib/store.mjs',sha256:'2a1ecd6da273cff3be44202958cb46e3e1b0c754bed485b54347adee4e49eee3',bytes:24187};
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
export function poolUsage(carry,used){const cumulative={visible:add(carry.visible,used.visible),capture:add(carry.capture,used.capture),artifact:add(carry.artifact,used.artifact),source_copy:add(carry.source_copy,65536)},original_phase={visible:n(cumulative.visible-ORIGINAL_BASE.visible),capture:n(cumulative.capture-ORIGINAL_BASE.capture),artifact:n(cumulative.artifact-ORIGINAL_BASE.artifact)};return {cumulative,original_phase};}
export function ledgerAccounting(prior,append){
 check(typeof prior==='string'&&typeof append==='function','LEDGER_INPUT');let capture=65536,visible=65536;
 const validate=e=>{check(e&&same(Object.keys(e).sort(),['capture','visible','why'])&&typeof e.why==='string'&&e.why.length<=128,'LEDGER_EVENT');n(e.capture);n(e.visible);return e;};
 for(const line of prior.trim()?prior.trim().split('\n'):[]){const e=validate(JSON.parse(line));capture=add(capture,e.capture);visible=add(visible,e.visible);}
 return {event(c=0,v=0,why='metadata'){const e=validate({capture:c,visible:v,why}),nc=add(capture,c),nv=add(visible,v);append(JSON.stringify(e)+'\n');capture=nc;visible=nv;},totals(){return {capture,visible};}};
}
export const CACHE_IDENTITY={capsule_schema:'root-a106-cached-page-capsule-v1',reviewer_id:'open-coding-a',case_binding:CASE,source_epoch:SOURCE,packet_ref:PACKET,method_epoch_ref:METHOD,phase_close_ref:CLOSE};
export const capsule=(a,g)=>validateCapsule(a,g,CACHE_IDENTITY);
export const makePermit=(a,m,mr)=>genericPermit(a,m,mr,CACHE_IDENTITY);
export const cachedPage=(a,g,m,mr,p,ep,page)=>validateCachedPage(a,g,m,mr,p,ep,page,CACHE_IDENTITY);export function observed(a,p,utf16){check(a.pageSHA===p.sha256&&a.outputSHA===p.sha256&&a.outputBytes===p.bytes&&a.outputUTF16===utf16&&n(a.wholeToolOutputUTF16)>=utf16&&a.wholeToolOutputUTF16<=9000,'OUTPUT_BINDING');check(a.nativeExitCode===0&&a.untruncated===true&&a.reviewerObservedPage===true&&a.outerToolResponseObservedComplete===true&&a.outerTruncationMarkerObserved===false&&a.forwardedStdoutExactPrepared===true,'ACTUAL_OUTER_OBSERVATION');for(const k of ['outerBudget','nestedBudget'])check(Number.isSafeInteger(a[k])&&a[k]>=p.bytes+2048,'TOOL_BUDGET');check(typeof a.externalChunkRef==='string'&&/^[A-Za-z0-9._:-]{1,128}$/u.test(a.externalChunkRef)&&a.externalToolCallRef==='exec_command:'+a.externalChunkRef,'EXTERNAL_TOOL_JOIN');}
export function admission(a){
 check(a.schema==='root-open-coding-a-efficient-reading-successor-v1'&&a.active===true&&a.reviewer_id==='open-coding-a'&&a.source_sha256===SOURCE&&a.root===D&&a.authority==='NONE','INACTIVE');
 check(a.start_case===106&&a.stop_case===106&&same(a.old_scope,[0,42000])&&a.old_JSON_pages===22&&a.old_V3_pages===37&&a.continuation_V3_pages===63&&a.total_actual_pages===122&&a.historical_canonical_rows===103&&a.historical_102_qualified===false&&a.old_phases_closed===true&&a.no_carry_refund===true,'CLOSED_SCOPE');
 for(const[k,v]of Object.entries({visible:7428289,capture:921307155,artifact:53828946,source_copy:1572864}))check(n(a.carry[k])>=v,'CARRY_FLOOR');
 check(same(a.profile,PROFILE)&&a.parent_cap===500&&a.raw_cap===7000&&a.page_utf16===6000&&a.whole_tool_utf16===9000,'READING_PROFILE');
 for(const[k,v]of Object.entries({visible:16777216,capture:1073741824,artifact:134217728}))check(n(a.limits[k])>0&&a.limits[k]<=v,'NEW_PHASE_LIMIT');
 check(/^[1-9][0-9]{0,24}$/u.test(a.clock.origin_ns)&&/^[1-9][0-9]{0,24}$/u.test(a.clock.deadline_ns)&&BigInt(a.clock.deadline_ns)>BigInt(a.clock.origin_ns)&&BigInt(a.clock.deadline_ns)-BigInt(a.clock.origin_ns)<=5400000000000n,'MONOTONIC_PHASE');
 check(a.clock.origin_ns==='23116162167217'&&a.clock.deadline_ns==='28516162167217','ORIGINAL_CLOCK');
 check(a.watchdog_ms===60000&&a.heap_mib===512&&a.rss_bytes===1073741824&&a.external_capture_meter===true&&a.source_copy_floor===65536,'PROCESS_GUARDS');
}
