// SPDX-License-Identifier: AGPL-3.0-only
// B162-only prospective transport policy; pure exports, no source IO.
export const R='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
export const S='/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2';
export const D=R+'/coding/open-coding-b/current-v6/compact-reading-successor-v1/run-v1';
export const SOURCE='82a3dab1396336edccf77f27a7800cccddff67ca928e919e824a663e1d563601';
export const CASE='coding-0162',CONTRACT='contract-2ceea482509979367764',PARENT={start:4650,end:146131,total:141481};
export const PACKET={path:R+'/audits/049d0f4fe07080f7e7f0/coding.json',sha256:'51143feeddcc5f35be66a62748642adb1af7442ffea7134e640816f68f2943e2',bytes:1643742};
export const PROFILE=Object.freeze({response_bytes:2097152,presentation_bytes:4194304,review_bytes:1048576,review_utf16:1048576,nodes:100000,depth:64});
export const T='/tmp/nonverba-coding-b-native-presentation-v3-2m-v1-controls-20261019-a1';
export const PURE={presentation:{path:T+'/presentation.mjs',sha256:'60028847cac707940a4565efc439ecbab6fd7c1ab3e0551594f2580c0c2a1b88',bytes:8282},validator:{path:T+'/response-validation.mjs',sha256:'017aa1bb343facf7cb93f59764376a342aee8c1a688cb7d6db5dcd8626aafa14',bytes:20652}};
export const READER={path:S+'/lib/audit-reader.mjs',sha256:'a00d1a3203be40dbc5b6497dd938031c3461ad6954f98651da95275034c2b3c9',bytes:13693};
export const STORE={path:S+'/lib/store.mjs',sha256:'2a1ecd6da273cff3be44202958cb46e3e1b0c754bed485b54347adee4e49eee3',bytes:24187};
export const RETAINED={range:[8000,28000],response:{path:R+'/coding/open-coding-b/current-v6/successor-v2/requests/r000002/response.json',sha256:'7d12be89773ba91e67801a3d0d729a24679cbd4056a5405fc08faedffb90acc7',bytes:1454153}};
export const SHADOW_ROOT=R+'/qa/B-0162-retained-r000002-V3-2m-shadow-20261019-v1';
export function check(v,c){if(!v)throw Object.assign(Error(c),{code:c});}
export function n(v){check(Number.isSafeInteger(v)&&v>=0,'INTEGER');return v;}
export function add(a,b){return n(n(a)+n(b));}
export const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const caseID=i=>'coding-'+String(i).padStart(4,'0');
export function finiteCurrent(completed){check(Number.isSafeInteger(completed)&&completed>=0&&completed<=1,'CASE_COUNT');return completed===0?'coding-0162':null;}
export function fresh(g){check(g.full_fresh100===true&&g.fresh_sections===100&&g.fresh_contract_count===29&&Array.isArray(g.fresh_contract_ids)&&g.fresh_contract_ids.length===29&&new Set(g.fresh_contract_ids).size===29&&g.fresh_contract_ids.every(x=>/^contract-[a-f0-9]{20}$/u.test(x)),'FULL_FRESH_GUARD');return new Set(g.fresh_contract_ids);}
export function packetRows(p,g){const f=fresh(g);check(p.purpose==='coding'&&Array.isArray(p.rows)&&p.rows.length===500&&p.rows.every((r,i)=>r.audit_id===caseID(i+1)&&!f.has(r.contract_id)),'FIXED500_FRESH_EXCLUSION');return p.rows;}
export function boundary(t,p){return Number.isSafeInteger(p)&&p>=0&&p<=t.length&&!(p&&p<t.length&&/[\uD800-\uDBFF]/u.test(t[p-1])&&/[\uDC00-\uDFFF]/u.test(t[p]));}
export function nextRange(text,start,cap){check(boundary(text,start)&&start<text.length&&[20000,7000].includes(cap),'NEXT_RANGE');let end=Math.min(text.length,start+cap);if(!boundary(text,end))end--;check(end>start,'EMPTY_CODEPOINT_RANGE');return [start,end];}
export function coverage(ranges,start,end){let at=start;for(const [s,e]of ranges){check(s===at&&e>s&&e<=end,'COVERAGE_GAP_OR_OVERLAP');at=e;}return at;}
export function budget(used,limits,reserve={}){check(reserve&&typeof reserve==='object'&&Object.keys(reserve).every(k=>['visible','capture','artifact'].includes(k)),'RESERVE_KEYS');for(const k of ['visible','capture','artifact'])check(add(n(used[k]),Object.hasOwn(reserve,k)?n(reserve[k]):0)<=n(limits[k]),'CAP_'+k);return used;}
export function ledgerAccounting(prior,append){
 check(typeof prior==='string'&&typeof append==='function','LEDGER_INPUT');let capture=65536,visible=65536;
 const validate=e=>{check(e&&same(Object.keys(e).sort(),['capture','visible','why'])&&typeof e.why==='string'&&e.why.length<=128,'LEDGER_EVENT');n(e.capture);n(e.visible);return e;};
 for(const line of prior.trim()?prior.trim().split('\n'):[]){const e=validate(JSON.parse(line));capture=add(capture,e.capture);visible=add(visible,e.visible);}
 return {event(c=0,v=0,why='metadata'){const e=validate({capture:c,visible:v,why}),nc=add(capture,c),nv=add(visible,v);append(JSON.stringify(e)+'\n');capture=nc;visible=nv;},totals(){return {capture,visible};}};
}
export function observed(a,p,utf16){check(a.pageSHA===p.sha256&&a.outputSHA===p.sha256&&a.outputBytes===p.bytes&&a.outputUTF16===utf16&&n(a.wholeToolOutputUTF16)>=utf16&&a.wholeToolOutputUTF16<=9000,'OUTPUT_BINDING');check(a.nativeExitCode===0&&a.untruncated===true&&a.reviewerObservedPage===true&&a.outerToolResponseObservedComplete===true&&a.outerTruncationMarkerObserved===false&&a.forwardedStdoutExactPrepared===true,'ACTUAL_OUTER_OBSERVATION');for(const k of ['outerBudget','nestedBudget'])check(Number.isSafeInteger(a[k])&&a[k]>=p.bytes+2048,'TOOL_BUDGET');check(typeof a.externalChunkRef==='string'&&/^[A-Za-z0-9._:-]{1,128}$/u.test(a.externalChunkRef)&&a.externalToolCallRef==='exec_command:'+a.externalChunkRef,'EXTERNAL_TOOL_JOIN');}

export function anchor(a){check(a.schema==='root-own-b162-JSON8000-anchor-v1'&&a.audit_id===CASE&&same(a.parent_range,[0,8000])&&a.old_JSON_pages===77&&a.direct_actual_ACKs_verified===true&&a.no_transfer_of_ROOT_reading===true&&a.blanket_historical_161_qualification===false&&a.original_denominator_preserved===true&&a.authority==='NONE','OLD_OWN_SCOPE_ANCHOR');check(Array.isArray(a.immutable_refs)&&a.immutable_refs.length>=77&&a.immutable_refs.length<=512,'ANCHOR_PIN_SET');return a;}
export function carryBasis(v,a){check(v.schema==='root-open-coding-b162-cumulative-carry-v1'&&v.reviewer_id==='open-coding-b'&&v.source_sha256===SOURCE&&same(v.carry,a.carry)&&v.all_current_B_and_shadow_costs_included===true&&v.old_phases_closed===true&&v.no_refunds===true&&v.old_64MiB_compliance_claimed===false&&v.authority==='NONE','EXTERNAL_CARRY_BASIS');return v;}
export function admission(a){
 check(a.schema==='root-open-coding-b162-compact-reading-successor-v1'&&a.active===true&&a.reviewer_id==='open-coding-b'&&a.source_sha256===SOURCE&&a.root===D&&a.authority==='NONE','INACTIVE');
 check(a.start_case===162&&a.stop_case===162&&same(a.old_scope,[0,8000])&&a.old_JSON_pages===77&&a.blanket_historical_161_qualification===false&&a.old_phases_closed===true&&a.no_carry_refund===true&&a.old_64MiB_compliance_claimed===false,'CLOSED_SCOPE');
 for(const k of ['visible','capture','artifact','source_copy'])n(a.carry[k]);check(Number.isFinite(a.carry.elapsed_ms)&&a.carry.elapsed_ms>=0,'CARRY_TIME');
 check(same(a.profile,PROFILE)&&a.parent_cap===20000&&a.raw_cap===7000&&a.page_utf16===6000&&a.whole_tool_utf16===9000,'READING_PROFILE');
 for(const[k,v]of Object.entries({visible:16777216,capture:1073741824,artifact:134217728}))check(n(a.limits[k])>0&&a.limits[k]<=v,'NEW_PHASE_LIMIT');
 check(/^[1-9][0-9]{0,24}$/u.test(a.clock.origin_ns)&&/^[1-9][0-9]{0,24}$/u.test(a.clock.deadline_ns)&&BigInt(a.clock.deadline_ns)>BigInt(a.clock.origin_ns)&&BigInt(a.clock.deadline_ns)-BigInt(a.clock.origin_ns)<=5400000000000n,'MONOTONIC_PHASE');
 check(a.watchdog_ms===60000&&a.heap_mib===512&&a.rss_bytes===1073741824&&a.external_capture_meter===true&&a.source_copy_floor===65536,'PROCESS_GUARDS');
 check(same(a.retained_response_ref,RETAINED.response)&&a.shadow_root_machine_pass_attested===true&&a.shadow_actual_reading_transferred===false,'RETAINED_SHADOW_ADMISSION');
 for(const k of ['shadow_result_ref','shadow_observation_ref','shadow_presentation_ref','shadow_view_ref'])check(a[k]&&a[k].path.startsWith(SHADOW_ROOT+'/')&&/^[a-f0-9]{64}$/u.test(a[k].sha256)&&n(a[k].bytes)>0,'EXTERNAL_SHADOW_PIN');
 check(Array.isArray(a.predecessor_locks)&&a.predecessor_locks.length>0&&a.predecessor_locks.length<=8&&new Set(a.predecessor_locks).size===a.predecessor_locks.length&&a.predecessor_locks.every(p=>typeof p==='string'&&p.startsWith(R+'/coding/open-coding-b/')&&!p.startsWith(D+'/')),'OWN_PREDECESSOR_LOCKS');
}
