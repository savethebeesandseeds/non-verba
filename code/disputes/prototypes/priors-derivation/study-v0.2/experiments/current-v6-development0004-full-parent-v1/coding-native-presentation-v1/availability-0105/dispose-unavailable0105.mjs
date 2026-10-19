// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE: exact prospective operational endpoint; no semantic disposition.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
export const ROOT_ACTIVATED=false;
export const Q='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000/coding/open-coding-a/current-v6/successor-v1';
const SOURCE='82a3dab1396336edccf77f27a7800cccddff67ca928e919e824a663e1d563601';
const ref=(name,sha256,bytes)=>({path:Q+'/'+name,sha256,bytes});
export const FIXED={
  phase:ref('phase-admission.json','a58d22747eab904857d316302745c7d05808a16e393133d461bd36bfa6fee8d1',3469),
  helper:ref('successor-pager.mjs','95604e403a02eb6b9cd386f4e6582c3d7a00a88c7a51376bf04e77f03fd560de',25298),
  scope:ref('source-input-scope-0105-images.json','7a91ce6fd14c451b7a132111f0e81cd5032aa419a8a2669c7ab8a81f4bf1569b',7558),
  checkpoint:ref('checkpoint-0105-original-input-hold-v1.json','91dfdfc660590aa11ba8b0589a59cda13ccf82c7c8fb4c72f0685588fbfd535b',4410),
  partial:ref('readings/coding-0105.partial-context-hold.json','6856dabeb701554c16b8797d00d723ef868513d030b4abfaaa5214c2a74c63c2',66623),
  manifests:[ref('requests/r000020/manifest.json','5661fe90646f7bbc38884c9afd31b0b2c959db637cd80203adafd5b2b0f2e215',16076),ref('requests/r000021/manifest.json','3a8cbbb87fb15145c2d2c89d0fdd7610fadd9d5339058d8ca1c1a107fb82dc41',1449)],
  responses:[ref('requests/r000020/response.json','b30dbbffcbe18a5f9065d128c486fd22ca4f105fcd5c3dd339aa80b02b9af95a',457844),ref('requests/r000021/response.json','081984cde3a1e07e163880aa70821fa5b99f9475ab75fd4f866a5dd1d511200b',13630)]
};
const PACKET={path:'audits/049d0f4fe07080f7e7f0/coding.json',sha256:'51143feeddcc5f35be66a62748642adb1af7442ffea7134e640816f68f2943e2',bytes:1643742};
const SELF=fileURLToPath(import.meta.url),H=b=>crypto.createHash('sha256').update(b).digest('hex');
const check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const n5=n=>String(n).padStart(5,'0');
const validRef=r=>r&&typeof r.path==='string'&&/^[a-f0-9]{64}$/.test(r.sha256)&&Number.isSafeInteger(r.bytes)&&r.bytes>0;
export function validateExtension(e,{selfPath=Q+'/dispose-unavailable0105.mjs',measuredBytes}={}){
  check(e.schema==='exact-0105-unavailable-endpoint-admission-v1'&&e.status==='ADMITTED'&&e.admitted_by==='ROOT'&&e.audit_id==='coding-0105'&&e.reviewer_id==='open-coding-a'&&e.authority==='NONE'&&e.human===false&&e.adopted===false,'ENDPOINT_ADMISSION');
  check(e.source_sha256===SOURCE&&same(e.packet_ref,PACKET)&&same(e.phase_ref,FIXED.phase)&&same(e.active_helper_ref,FIXED.helper),'ENDPOINT_PHASE_BINDING');
  check(validRef(e.module_ref)&&e.module_ref.path===selfPath&&e.module_ref.bytes<=15000,'ENDPOINT_MODULE');
  check(e.inherits_existing_phase_clock===true&&e.clock_reset===false&&e.carry_refund_bytes===0&&e.new_source_API_calls===0&&e.meaningful_coding===false&&e.final_reading===false&&e.replacement===false&&e.formal500_gate_satisfied===false&&e.source_quality_gate_pass===false,'ENDPOINT_LIMITED_AUTHORITY');
  check(Number.isSafeInteger(measuredBytes)&&measuredBytes<=65536&&e.existing_source_copy_charge_bytes===65536&&e.measured_full_source_copy_bytes===measuredBytes,'ENDPOINT_SOURCE_COPY');
  return true;
}
export function validateScope(s,c){
  check(s.schema==='own-observed-original-input-scope-v1'&&s.audit_id==='coding-0105'&&s.reviewer_id==='open-coding-a'&&s.authority==='NONE'&&s.human===false&&s.adopted===false&&same(s.successor_admission,FIXED.phase),'ENDPOINT_SCOPE_ID');
  check(s.source_url==='https://www.sec.gov/Archives/edgar/data/1300734/000149315221014169/ex10-2.htm'&&same(s.raw_binding,{sha256:'84bccbdd471821567f19b8fb7040b18001b33592d79759f717f2fd5bee063ea1',bytes:12095})&&same(s.parent_binding,{sha256:'7f16a4a8ff4b7295fa048d988b9c5f76b90801203877d408cc1dd522acdac3b4',bytes:5004}),'ENDPOINT_SOURCE_BINDING');
  check(s.complete_admitted_parent_native_projection===true&&s.complete_retained_original_HTML_text===true&&s.original_visual_input_complete===false&&s.potential_required_original_image_inputs===15&&s.inline_text_fallback_for_images_observed===false&&s.new_fetches===0&&s.new_image_API_calls===0&&s.scope_derived_from_actual_own_reading===true&&s.cache_extraction_status_not_inspected_here===true&&s.no_unseen_pixel_content_inference===true&&s.current_case_partial===true,'ENDPOINT_SCOPE_LIMITS');
  check(s.relationship_to_selected_text==='SAME_RETAINED_ORIGINAL_DOCUMENT_BODY; IMAGE_NODES_HAVE_NO_TEXTUAL_NORMALIZED_EXTENT','ENDPOINT_RESOURCE_RELATION');
  const starts=[359,1148,1937,2726,3515,4304,5093,5882,6671,7460,8250,9040,9830,10620,11410];
  check(Array.isArray(s.images)&&s.images.length===15&&s.images.every((x,i)=>x.raw_utf16_start===starts[i]&&x.raw_utf16_end===starts[i]+69&&x.src==='ex10-2_'+String(i+1).padStart(3,'0')+'.jpg'&&x.resolved_url===new URL(x.src,s.source_url).href&&x.alt===''&&x.title===null&&x.inside_original_BODY===true&&x.pixels_read===false&&x.OCR_read===false&&x.fetch_performed===false),'ENDPOINT_EXACT_RESOURCE_ROSTER');
  check(c.schema==='own-metadata-original-input-hold-checkpoint-v1'&&c.current_case==='coding-0105'&&c.reviewer_id==='open-coding-a'&&c.authority==='NONE'&&c.human===false&&c.adopted===false&&c.case0105_terminal===false&&c.case0105_semantic_coding_added===false&&c.current_case_original_HTML_complete===true&&c.current_case_parent_native_projection_complete===true&&c.current_case_actual_parent_native_pages===61&&c.current_case_actual_fullraw_pages===2&&c.current_case_actual_page_ACKs===63&&c.referenced_image_inputs_unread===15&&c.images_fetched===0&&c.pixels_read===false&&c.OCR_performed===false&&same(c.case0105_partial_reading,FIXED.partial)&&same(c.case0105_input_scope,FIXED.scope)&&same(c.successor_admission,FIXED.phase)&&same(c.raw_manifest,FIXED.manifests[1])&&c.formal500_gate_satisfied===false&&c.source_quality_gate_pass===false,'ENDPOINT_OWN_CHECKPOINT');
  return true;
}
export function validateManifest(m,i){
  const id=i===0?'r000020':'r000021',total=i===0?34:12095,count=i===0?61:2;
  check((i===0||i===1)&&m.schema==='prepared-source-response-v1'&&m.request_id===id&&m.audit_id==='coding-0105'&&m.source===(i===0?'parent':'raw')&&m.offset===0&&m.limit===(i===0?1000:20000)&&m.range.offset===0&&m.range.end===total&&m.range.total_characters===total&&m.range.complete_source_in_this_slice===true&&m.range.next_offset===null&&m.actual_reading===false&&m.all_source_json_retained===true&&m.authority==='NONE'&&m.source_sha256===SOURCE&&same(m.packet,PACKET)&&same(m.response,FIXED.responses[i]),'ENDPOINT_EXACT_MANIFEST');
  check(Array.isArray(m.pages)&&m.pages.length===count&&m.pages.every((p,j)=>validRef(p)&&p.path===Q+'/requests/'+id+'/page-'+n5(j+1)+'.json'&&p.bytes<=65536),'ENDPOINT_PREPARED_PAGE_ROSTER');return true;
}
export function validatePair(m,index,e,a,emissionRef){
  const p=m.pages[index],o=a.external_tool_observation;
  check(e.schema==='immutable-source-page-emission-v1'&&e.reviewer_id==='open-coding-a'&&same(e.page_ref,p)&&same(e.response,m.response)&&e.actual_reading===false&&e.authority==='NONE'&&same(e.successor_admission,FIXED.phase),'ENDPOINT_EMISSION');
  check(a.schema==='separate-observed-source-page-ack-v1'&&a.reviewer_id==='open-coding-a'&&a.kind==='AGENT'&&a.human===false&&a.authority==='NONE'&&a.adopted===false&&a.observed_by_reviewer===true&&same(a.page_ref,p)&&same(a.emission,emissionRef)&&same(a.successor_admission,FIXED.phase),'ENDPOINT_ACK_JOIN');
  check(o&&typeof o.external_tool_call_ref==='string'&&o.external_tool_call_ref.length>0&&typeof o.external_chunk_ref==='string'&&o.external_chunk_ref.length>0&&o.native_exit_code===0&&o.untruncated===true&&o.reviewer_observed_page===true&&Number.isSafeInteger(a.whole_tool_output_utf16)&&a.whole_tool_output_utf16>0&&a.whole_tool_output_utf16<=9000&&a.outer_tool_response_observed_complete===true&&a.outer_truncation_marker_observed===false&&a.forwarded_stdout_exact_prepared===true,'ENDPOINT_ACTUAL_TOOL_PROOF');return true;
}
export function validateStatus(s,after=false){
  check(s.current_case===(after?'coding-0106':'coding-0105')&&s.predecessor_semantic_final_cases===102&&s.new_reading_complete_cases===1&&s.new_semantic_final_cases_inferred===0&&s.unusable_source_cases===(after?2:1)&&s.formal500_gate_satisfied===false&&s.source_quality_gate_pass===false&&s.authority==='NONE','ENDPOINT_CURRENT_STATE');
  const rows=s.requests.filter(x=>x.audit_id==='coding-0105');check(rows.length===2&&rows.every((r,i)=>r.request_id===(i===0?'r000020':'r000021')&&r.pages===(i===0?61:2)&&r.acknowledged_pages===r.pages),'ENDPOINT_ACK_COUNTS');return true;
}
export function validateProofRoster(proofs){
  const paths=[];for(const [id,n]of [['r000020',61],['r000021',2]])for(let j=1;j<=n;j++)for(const kind of ['emitted','ack'])paths.push(Q+'/requests/'+id+'/'+kind+'-'+n5(j)+'.json');
  check(Array.isArray(proofs)&&proofs.length===126&&proofs.every((r,i)=>validRef(r)&&r.path===paths[i])&&new Set(proofs.map(r=>r.path)).size===126,'ENDPOINT_EXACT_PROOF_ROSTER');return true;
}
function bytes(p,max=262144){
  check(p.startsWith(Q+'/')&&path.resolve(p)===p,'ENDPOINT_PATH');let at='/';for(const n of p.slice(1).split('/')){at=path.join(at,n);check(!fs.lstatSync(at).isSymbolicLink(),'ENDPOINT_SYMLINK');}
  const st=fs.lstatSync(p);check(st.isFile()&&st.nlink===1&&st.size>0&&st.size<=max,'ENDPOINT_FILE');const b=fs.readFileSync(p,{flag:fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW});check(b.length===st.size,'ENDPOINT_SIZE');return b;
}
function bound(r){check(validRef(r),'ENDPOINT_REF');const b=bytes(r.path);check(b.length===r.bytes&&H(b)===r.sha256,'ENDPOINT_PIN');return b;}
const json=r=>JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bound(r)));
function reference(p){const b=bytes(p);return {path:p,sha256:H(b),bytes:b.length};}
function sourceBytes(extensionPath){let n=Math.max(fs.lstatSync(Q).size,8192);const names=fs.readdirSync(Q);check(names.length<=2000,'ENDPOINT_TOP_BOUND');for(const name of names)if(/\.(?:mjs|cjs)$/.test(name)||name==='phase-admission.json'||Q+'/'+name===extensionPath){const p=Q+'/'+name;bytes(p);n+=fs.lstatSync(p).size;}return n;}
export async function disposeUnavailable0105(extensionRef){
  check(ROOT_ACTIVATED&&SELF===Q+'/dispose-unavailable0105.mjs'&&process.platform==='linux'&&process.env.NONVERBA_CONTAINER==='1','ENDPOINT_INACTIVE');
  const start=process.hrtime.bigint();check(extensionRef?.path===Q+'/unavailable-0105-admission.json','ENDPOINT_ADMISSION_PATH');const ext=json(extensionRef);
  validateExtension(ext,{selfPath:SELF,measuredBytes:sourceBytes(extensionRef.path)});bound(ext.module_ref);bound(FIXED.helper);bound(FIXED.phase);
  const {invoke}=await import(pathToFileURL(FIXED.helper.path).href);validateStatus(await invoke(FIXED.phase,{action:'status'}));
  const lock=Q+'/operation-lock';fs.mkdirSync(lock,{mode:0o700}); // Any failure retains this lock; prior locks are never removed.
  const preserved=[Q+'/dispositions/coding-0103.json',Q+'/case-completions/coding-0104.json'].map(reference);
  const scope=json(FIXED.scope),checkpoint=json(FIXED.checkpoint);validateScope(scope,checkpoint);bound(FIXED.partial); // Opaque bytes/hash only: never parse private authored content.
  const proofs=[];
  for(let i=0;i<2;i++){const m=json(FIXED.manifests[i]);validateManifest(m,i);for(let j=0;j<m.pages.length;j++){
    const d=Q+'/requests/'+m.request_id+'/',er=reference(d+'emitted-'+n5(j+1)+'.json'),ar=reference(d+'ack-'+n5(j+1)+'.json');
    validatePair(m,j,json(er),json(ar),er);proofs.push(er,ar);
  }}
  validateProofRoster(proofs);
  const evidence=[FIXED.phase,extensionRef,ext.module_ref,FIXED.scope,FIXED.checkpoint,FIXED.partial,...FIXED.manifests,...proofs];check(evidence.length===134&&evidence.length<=160,'ENDPOINT_EVIDENCE_ROSTER');
  validateStatus(await invoke(FIXED.phase,{action:'status'}));for(const r of preserved)bound(r);
  check(process.hrtime.bigint()-start<=60000000000n,'ENDPOINT_TOOL_DEADLINE');
  const value={schema:'exact-0105-operational-unavailable-disposition-v1',audit_id:'coding-0105',reviewer_id:'open-coding-a',status:'UNUSABLE_SOURCE_UNCODED',authority:'NONE',human:false,adopted:false,meaningful_coding:false,final_reading:false,replacement:false,formal500_gate_satisfied:false,source_quality_gate_pass:false,reason:'UNREVIEWED_POTENTIALLY_REQUIRED_ORIGINAL_BODY_VISUAL_INPUTS; OPERATIVE_IMAGE_CONTENT_UNKNOWN',complete_admitted_parent_native_projection:true,complete_retained_original_HTML_text:true,original_visual_input_complete:false,unreviewed_BODY_image_inputs:15,actual_acknowledged_pages:63,extraction_status_claim:'NONE',semantic_exclusion_claim:false,pixel_or_OCR_content_inferred:false,denominator:500,selection_unchanged:true,retained_partial:FIXED.partial,successor_admission:FIXED.phase,endpoint_extension:extensionRef,evidence_refs:evidence,preserved_operational_refs:preserved,clock_reset:false,carry_refund_bytes:0};
  const out=Buffer.from(JSON.stringify(value)+'\n');check(out.length<=65536,'ENDPOINT_OUTPUT_BOUND');const p=Q+'/dispositions/coding-0105.json';fs.writeFileSync(p,out,{flag:'wx',mode:0o600});
  const after=await invoke(FIXED.phase,{action:'status'});validateStatus(after,true);for(const r of preserved)bound(r);check(process.hrtime.bigint()-start<=60000000000n,'ENDPOINT_TOOL_DEADLINE');fs.rmdirSync(lock);
  return {disposition:{path:p,sha256:H(out),bytes:out.length},next_case:after.current_case,formal500_gate_satisfied:false,meaningful_coding:false,final_reading:false,authority:'NONE'};
}
