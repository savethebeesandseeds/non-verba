// SPDX-License-Identifier: AGPL-3.0-only
// SOURCE-ONLY proposal; all exports are pure.
import {validateCapsule,makePermit as genericPermit,validateCachedPage} from './cached-guard.mjs';
export const R='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
export const S='/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2';
export const OLD=R+'/coding/open-coding-b/current-v6/compact-0162-v1/run-v1';
export const D=R+'/coding/open-coding-b/current-v6/efficient-0162-v1/run-v1';
export const OLD_SCOPE_END=53000,OLD_ACKS=62;
export const CLOCK=Object.freeze({origin_ns:'26682805011421',deadline_ns:'32082805011421'});
export const SOURCE='82a3dab1396336edccf77f27a7800cccddff67ca928e919e824a663e1d563601';
export const PACKET={path:R+'/audits/049d0f4fe07080f7e7f0/coding.json',sha256:'51143feeddcc5f35be66a62748642adb1af7442ffea7134e640816f68f2943e2',bytes:1643742};
export const CASE={audit_id:'coding-0162',source_id:'contract-2ceea482509979367764:section:4650-146131:e0287522ea48:unit:102172-103130:d7ab94f830f8',contract_id:'contract-2ceea482509979367764'};
export const METHOD={path:R+'/qa/projection-bound-subdivision-root-metadata-preflight-20261019-v1/result.json',sha256:'ebb4523f29830c4ee5e00b3fa1bd06f81048920fa3942b4f15152b28cbc358a6',bytes:27870};
export const PREP=R+'/qa/b162-efficient-reading-ROOT-preparation-20261019-v1';
export const METHOD_PROOF={path:R+'/qa/b162-compact-reading-ROOT-preparation-20261019-v1/ROOT-current-method-proof.json',sha256:'0dc4ed6345df2057ac87eda904336be6672d98a9dc846bde02ed6d4e5383a99c',bytes:6088};
export const PROFILE=Object.freeze({response_bytes:2097152,presentation_bytes:4194304,review_bytes:1048576,review_utf16:1048576,nodes:100000,depth:64});
const O=R+'/coding/open-coding-b/current-v6/run-v2';
export const PURE={presentation:{path:'/tmp/nonverba-coding-b-partitioned-native-presentation-v1-controls-20261019-a2/presentation.mjs',sha256:'3b83414d9e7a547676254741c36642aeaafe501b971e784ff6fa1a6d1fd3b4ef',bytes:11606},single:{path:'/tmp/nonverba-coding-b-native-presentation-v3-2m-v1-controls-20261019-a1/presentation.mjs',sha256:'60028847cac707940a4565efc439ecbab6fd7c1ab3e0551594f2580c0c2a1b88',bytes:8282},validator:{path:'/tmp/nonverba-coding-b-native-presentation-v3-2m-v1-controls-20261019-a1/response-validation.mjs',sha256:'017aa1bb343facf7cb93f59764376a342aee8c1a688cb7d6db5dcd8626aafa14',bytes:20652}};
export const READER={path:O+'/audit-reader-subdivided.mjs',sha256:'8a69da8b944184c0b1be436e152c10291450940858a5cdfb4d1a7ab6f0b67b49',bytes:14573};
export const PARTITIONS={path:O+'/native-projection-partitions.mjs',sha256:'b040efedce424b9f06ad2769e9372a0d5a2f21fe9a52c6b0887646612925a142',bytes:4865};
export const EXTERNAL_SOURCE_PATHS=Object.values(PURE).map(r=>r.path);
export const SHARED_SOURCE_PATHS=['lib/common.mjs','lib/acquire.mjs','lib/analyze.mjs','lib/extract.mjs','lib/embed.mjs','lib/discover.mjs','package.json','package-lock.json'].map(x=>S.slice(0,-'study-v0.2'.length)+x);
export const STORE={path:S+'/lib/store.mjs',sha256:'2a1ecd6da273cff3be44202958cb46e3e1b0c754bed485b54347adee4e49eee3',bytes:24187};
export function check(v,c){if(!v)throw Object.assign(Error(c),{code:c});}
export function n(v){check(Number.isSafeInteger(v)&&v>=0,'INTEGER');return v;}
export function add(a,b){return n(n(a)+n(b));}
export const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const caseID=i=>'coding-'+String(i).padStart(4,'0');
export function finiteCurrent(completed){check(Number.isSafeInteger(completed)&&completed>=0&&completed<=1,'CASE_COUNT');return completed===0?'coding-0162':null;}
export function fresh(g){check(g.full_fresh100===true&&g.fresh_sections===100&&g.fresh_contract_count===29&&Array.isArray(g.fresh_contract_ids)&&g.fresh_contract_ids.length===29&&new Set(g.fresh_contract_ids).size===29&&g.fresh_contract_ids.every(x=>/^contract-[a-f0-9]{20}$/u.test(x)),'FULL_FRESH_GUARD');return new Set(g.fresh_contract_ids);}
export function packetRows(p,g){const f=fresh(g);check(p.purpose==='coding'&&Array.isArray(p.rows)&&p.rows.length===500&&p.rows.every((r,i)=>r.audit_id===caseID(i+1)&&!f.has(r.contract_id)),'FIXED500_FRESH_EXCLUSION');return p.rows;}
export function boundary(t,p){return Number.isSafeInteger(p)&&p>=0&&p<=t.length&&!(p&&p<t.length&&/[\uD800-\uDBFF]/u.test(t[p-1])&&/[\uDC00-\uDFFF]/u.test(t[p]));}
export function nextRange(text,start,cap){check(boundary(text,start)&&start<text.length&&[5000,7000].includes(cap),'NEXT_RANGE');let end=Math.min(text.length,start+cap);if(!boundary(text,end))end--;check(end>start,'EMPTY_CODEPOINT_RANGE');return [start,end];}
export function coverage(ranges,start,end){let at=start;for(const [s,e]of ranges){check(s===at&&e>s&&e<=end,'COVERAGE_GAP_OR_OVERLAP');at=e;}return at;}
export function budget(used,limits,reserve={}){check(reserve&&typeof reserve==='object'&&Object.keys(reserve).every(k=>['visible','capture','artifact'].includes(k)),'RESERVE_KEYS');for(const k of ['visible','capture','artifact'])check(add(n(used[k]),Object.hasOwn(reserve,k)?n(reserve[k]):0)<=n(limits[k]),'CAP_'+k);return used;}
export function poolUsage(carry,used){const cumulative={visible:add(carry.visible,used.visible),capture:add(carry.capture,used.capture),artifact:add(carry.artifact,used.artifact),source_copy:n(carry.source_copy)};return {cumulative,original_phase:cumulative};}
export function ledgerAccounting(prior,append){
 check(typeof prior==='string'&&typeof append==='function','LEDGER_INPUT');let capture=65536,visible=65536;
 const validate=e=>{check(e&&same(Object.keys(e).sort(),['capture','visible','why'])&&typeof e.why==='string'&&e.why.length<=128,'LEDGER_EVENT');n(e.capture);n(e.visible);return e;};
 for(const line of prior.trim()?prior.trim().split('\n'):[]){const e=validate(JSON.parse(line));capture=add(capture,e.capture);visible=add(visible,e.visible);}
 return {event(c=0,v=0,why='metadata'){const e=validate({capture:c,visible:v,why}),nc=add(capture,c),nv=add(visible,v);append(JSON.stringify(e)+'\n');capture=nc;visible=nv;},totals(){return {capture,visible};}};
}
export const CACHE_IDENTITY=Object.freeze({capsule_schema:'root-b162-efficient-cached-page-capsule-v1',reviewer_id:'open_coding_clean_b',case_binding:CASE,source_epoch:SOURCE,packet_ref:PACKET,method_epoch_ref:METHOD});
const identity=a=>({...CACHE_IDENTITY,phase_close_ref:a.phase_close_ref});
export const capsule=(a,g)=>{check(g.owner_namespace==='open-coding-b','CAPSULE_OWNER');return validateCapsule(a,g,identity(a));};
export const makePermit=(a,m,mr)=>genericPermit(a,m,mr,identity(a));
export const cachedPage=(a,g,m,mr,p,ep,page)=>validateCachedPage(a,g,m,mr,p,ep,page,identity(a));
export function observed(a,p,utf16){check(a.pageSHA===p.sha256&&a.outputSHA===p.sha256&&a.outputBytes===p.bytes&&a.outputUTF16===utf16&&n(a.wholeToolOutputUTF16)>=utf16&&a.wholeToolOutputUTF16<=9000,'OUTPUT_BINDING');check(a.nativeExitCode===0&&a.untruncated===true&&a.reviewerObservedPage===true&&a.outerToolResponseObservedComplete===true&&a.outerTruncationMarkerObserved===false&&a.forwardedStdoutExactPrepared===true,'ACTUAL_OUTER_OBSERVATION');for(const k of ['outerBudget','nestedBudget'])check(Number.isSafeInteger(a[k])&&a[k]>=p.bytes+2048,'TOOL_BUDGET');check(typeof a.externalChunkRef==='string'&&/^[A-Za-z0-9._:-]{1,128}$/u.test(a.externalChunkRef)&&a.externalToolCallRef==='exec_command:'+a.externalChunkRef,'EXTERNAL_TOOL_JOIN');}
export function boundedRef(r,root,max=262144){check(r&&typeof r.path==='string'&&r.path.startsWith(root+'/')&&!r.path.includes('/../')&&!r.path.endsWith('/..')&&/^[a-f0-9]{64}$/u.test(r.sha256)&&Number.isSafeInteger(r.bytes)&&r.bytes>0&&r.bytes<=max,'ROOT_REF');return r;}
export function phaseClose(a,v){check(v.schema==='b-compact-phase-final-partial-close-v1'&&v.reviewer_id==='open_coding_clean_b'&&v.owner_namespace==='open-coding-b'&&v.audit_id===CASE.audit_id&&v.source_epoch===SOURCE&&v.no_further_current_helper_calls===true&&same(v.complete_parent_interval,[0,OLD_SCOPE_END])&&v.phase_actual_pages===OLD_ACKS&&v.phase_actual_ACKs===OLD_ACKS&&v.parent_total_characters===141481&&v.remaining_parent_characters===88481&&v.unread_prepared_pages===0&&v.next_parent_offset===OLD_SCOPE_END&&v.prior_preserved_JSON_observations===237&&v.case_final===false&&v.parent_complete===false&&same(v.raw_ranges_read,[])&&v.historical_161_current_qualified===false&&v.clock_reset===false&&v.refund===false&&v.new_clock_admitted===false&&v.actual_reading_inferred===false&&v.semantic_validity_inferred===false&&Array.isArray(v.requests)&&v.requests.length===7&&v.authority==='NONE','CLOSED_COMPACT_PHASE');boundedRef(v.admission_ref,OLD,16384);check(v.admission_ref.path===OLD+'/phase-admission.json','CLOSED_ADMISSION_PATH');return v;}
export function oldAdmissionProof(a,v){check(v.schema==='root-open-coding-b162-compact-reading-v1'&&v.reviewer_id==='open_coding_clean_b'&&v.owner_namespace==='open-coding-b'&&v.root===OLD&&v.start_case===162&&v.stop_case===162&&same(v.clock,CLOCK)&&same(v.profile,PROFILE),'ORIGINAL_PHASE_PROOF');for(const k of ['visible','capture','artifact'])check(n(a.limits[k])<=n(v.limits[k])&&n(a.carry[k])>=n(v.carry[k]),'ORIGINAL_POOL_PRESERVED');return v;}
export function continuousAnchor(a,v){
 check(v.schema==='root-own-b162-continuous-parent-anchor-v1'&&v.reviewer_id==='open_coding_clean_b'&&v.owner_namespace==='open-coding-b'&&same(v.case_binding,CASE)&&v.source_sha256===SOURCE&&v.current_compact_phase_root===OLD&&same(v.parent_range,[0,OLD_SCOPE_END])&&v.parent_total===141481&&v.actual_pages===OLD_ACKS&&v.complete_parent_requests===7&&same(v.pending_page_refs,[])&&same(v.raw_ranges,[])&&same(v.phase_close_ref,a.phase_close_ref)&&same(v.packet_ref,PACKET)&&same(v.original_clock,CLOCK)&&v.original_inverse_verified_before_emission===true&&v.old_JSON237_qualified===false&&v.historical_161_qualified===false&&v.no_transfer_ROOT_reading===true&&v.semantic_validity_inferred===false&&v.source_quality_gate_pass===false&&v.human===false&&v.authority==='NONE','CONTINUOUS_OWN_COMPACT_ANCHOR');
 check(Array.isArray(v.immutable_refs)&&v.immutable_refs.length===133&&new Set(v.immutable_refs.map(r=>r.path)).size===133,'ANCHOR_PIN_SET');let manifests=0,emissions=0,acks=0;
 for(const r of v.immutable_refs){boundedRef(r,OLD);if(r.path===OLD+'/phase-admission.json'||same(r,a.phase_close_ref))continue;const relative=r.path.slice(OLD.length+1);check(/^requests\/r00000[1-7]\/(?:manifest|emitted-[0-9]{6}|ack-[0-9]{6})\.json$/u.test(relative),'ANCHOR_METADATA_ONLY');if(relative.endsWith('/manifest.json'))manifests++;else if(relative.includes('/emitted-'))emissions++;else acks++;}
 check(manifests===7&&emissions===OLD_ACKS&&acks===OLD_ACKS&&v.immutable_refs.some(r=>r.path===OLD+'/phase-admission.json')&&v.immutable_refs.some(r=>same(r,a.phase_close_ref)),'ANCHOR_PROOF_COUNTS');return v;
}
export function carryProof(a,v){check(v.schema==='root-open-coding-b162-efficient-cumulative-carry-v1'&&v.reviewer_id==='open_coding_clean_b'&&v.owner_namespace==='open-coding-b'&&v.source_sha256===SOURCE&&v.no_refunds===true&&v.old_64MiB_compliance_claimed===false&&same(v.phase_close_ref,a.phase_close_ref)&&same(v.old_scope_anchor_ref,a.old_scope_anchor_ref)&&same(v.original_clock,CLOCK),'CARRY_PROOF');for(const k of ['visible','capture','artifact','source_copy'])check(n(a.carry[k])>=n(v.carry[k]),'CARRY_JOIN');return v;}
export function anchoredParentEnd(rows){let at=OLD_SCOPE_END;for(const r of rows){check(r.complete===true&&r.range.total_characters===141481,'PARENT_PENDING_OR_TOTAL');at=coverage([[r.range.offset,r.range.end]],at,141481);}return at;}
export function admission(a){
 check(a.schema==='root-open-coding-b162-efficient-reading-v1'&&a.active===true&&a.reviewer_id==='open_coding_clean_b'&&a.owner_namespace==='open-coding-b'&&a.source_sha256===SOURCE&&a.root===D&&a.authority==='NONE','INACTIVE');
 check(a.start_case===162&&a.stop_case===162&&same(a.old_scope,[0,OLD_SCOPE_END])&&a.old_compact_ACK_pages===OLD_ACKS&&a.old_raw_ACK_pages===0&&a.historical_canonical_rows===161&&a.historical_161_qualified===false&&a.old_JSON237_qualified===false&&a.old_phases_closed===true&&a.no_carry_refund===true,'CLOSED_SCOPE');
 for(const[k,v]of Object.entries({visible:6903076,capture:390449973,artifact:42457892,source_copy:1438322}))check(n(a.carry[k])>=v,'CARRY_FLOOR');
 check(same(a.profile,PROFILE)&&a.parent_cap===5000&&a.raw_cap===7000&&a.page_utf16===6000&&a.whole_tool_utf16===9000,'READING_PROFILE');
 for(const[k,v]of Object.entries({visible:16777216,capture:1073741824,artifact:134217728}))check(n(a.limits[k])>0&&a.limits[k]<=v&&a.carry[k]<a.limits[k],'CUMULATIVE_LIMIT');
 check(same(a.clock,CLOCK),'ORIGINAL_CLOCK');
 check(a.watchdog_ms===60000&&a.heap_mib===512&&a.rss_bytes===1073741824&&a.external_capture_meter===true&&a.source_copy_floor===98304&&a.engineering_source_ceiling===262144,'PROCESS_GUARDS');
 boundedRef(a.phase_close_ref,OLD,16384);boundedRef(a.old_scope_anchor_ref,PREP);boundedRef(a.continuation_carry_ref,PREP,16384);boundedRef(a.case_capsule_ref,PREP,16384);boundedRef(a.guard_ref,R+'/qa');
 check(a.phase_close_ref.path===OLD+'/B-compact-final-partial-close-v1.json'&&a.old_scope_anchor_ref.path===PREP+'/continuous-parent-anchor.json'&&a.continuation_carry_ref.path===PREP+'/continuation-carry.json'&&a.case_capsule_ref.path===PREP+'/cached-page-capsule.json','ROOT_METADATA_PATHS');
}
