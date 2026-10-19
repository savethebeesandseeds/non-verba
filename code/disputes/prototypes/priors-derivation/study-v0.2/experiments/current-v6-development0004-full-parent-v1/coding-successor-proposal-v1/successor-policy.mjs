// SPDX-License-Identifier: AGPL-3.0-only
// Pure prospective controls. No IO, source reading, semantic qualification or gate conversion.
export const BUILTINR='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
const R=BUILTINR;
export const SOURCE='82a3dab1396336edccf77f27a7800cccddff67ca928e919e824a663e1d563601';
export const PACKET=Object.freeze({path:'audits/049d0f4fe07080f7e7f0/coding.json',sha256:'51143feeddcc5f35be66a62748642adb1af7442ffea7134e640816f68f2943e2',bytes:1643742});
export const LIMITS=Object.freeze({new_source_copy_bytes:65536,predecessor_source_copy_bytes:131072,phase_ms:5400000,tool_ms:60000,visible_bytes:16777216,capture_bytes:67108864,artifact_bytes:134217728,page_utf16:8500,rss_bytes:1073741824});
const IDS=Object.freeze({'open-coding-a':{dir:'open-coding-a',run:'run-v1',final:102,cursor:103},open_coding_clean_b:{dir:'open-coding-b',run:'run-v2',final:161,cursor:162}});
const CARRY=['visible_bytes','capture_bytes','artifact_bytes','semantic_final_cases','fixed_case_cursor','unusable_source_cases','elapsed_ms'];
const CONTROL={per_tool_watchdog_60s_confirmed:true,external_capture_meter_confirmed:true,global_registry_reexecution:false,other_coder_access:false,fresh_or_reserve_access:false,source_quality_gate_pass:false,formal500_gate_satisfied:false};
const fail=code=>{throw Object.assign(Error(code),{code});},ok=(v,c)=>{if(!v)fail(c);};
function object(v){ok(v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v)),'POLICY_OBJECT');for(const d of Object.values(Object.getOwnPropertyDescriptors(v)))ok(Object.hasOwn(d,'value'),'POLICY_ACCESSOR');return v;}
function keys(v,names){object(v);ok(Reflect.ownKeys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k)),'POLICY_KEYS');}
function exact(v,expected){keys(v,Object.keys(expected));for(const k of Object.keys(expected))ok(v[k]===expected[k],'POLICY_VALUE');}
function number(v,max=Number.MAX_SAFE_INTEGER){ok(Number.isSafeInteger(v)&&v>=0&&v<=max,'POLICY_INTEGER');return v;}
function sum(a,b){number(a);number(b);return number(a+b);}
function absolute(p){ok(typeof p==='string'&&p.startsWith('/')&&p.split('/').slice(1).every(x=>/^[A-Za-z0-9._-]+$/u.test(x)&&x!=='.'&&x!=='..'),'POLICY_PATH');return p;}
function ref(v,expectedPath){keys(v,['path','sha256','bytes']);absolute(v.path);ok(!expectedPath||v.path===expectedPath,'POLICY_REF_PATH');ok(typeof v.sha256==='string'&&/^[a-f0-9]{64}$/u.test(v.sha256)&&number(v.bytes,LIMITS.artifact_bytes)>0,'POLICY_REF');return v;}
function refs(v,max=64){ok(Array.isArray(v)&&v.length<=max,'POLICY_REFS');const paths=new Set();for(const r of v){ref(r);ok(!paths.has(r.path),'POLICY_DUPLICATE_REF');paths.add(r.path);}return v;}
function carry(v){keys(v,CARRY);for(const k of CARRY)number(v[k]);for(const k of ['visible_bytes','capture_bytes','artifact_bytes'])number(v[k],LIMITS[k]);number(v.semantic_final_cases,500);number(v.unusable_source_cases,1);ok(v.fixed_case_cursor===v.semantic_final_cases+v.unusable_source_cases+1&&v.fixed_case_cursor<=501,'POLICY_CURSOR');number(v.elapsed_ms,2*LIMITS.phase_ms);return v;}
function ns(v){ok(typeof v==='string'&&/^[1-9][0-9]{0,24}$/u.test(v),'POLICY_NS');return BigInt(v);}

export function sourceCopyTotals(a){
 const p=a.predecessor;number(p.source_copy_nominal_bytes,LIMITS.predecessor_source_copy_bytes);number(p.source_copy_conservative_bytes,LIMITS.predecessor_source_copy_bytes);ok(p.source_copy_nominal_bytes<=p.source_copy_conservative_bytes,'POLICY_PREDECESSOR_FLOOR');number(a.successor_source_copy_charge_bytes,LIMITS.new_source_copy_bytes);
 return Object.freeze({predecessor_nominal_bytes:p.source_copy_nominal_bytes,predecessor_conservative_bytes:p.source_copy_conservative_bytes,successor_charge_bytes:a.successor_source_copy_charge_bytes,cumulative_conservative_bytes:sum(p.source_copy_conservative_bytes,a.successor_source_copy_charge_bytes)});
}
export function validateAdmission(a,{selfPath,measuredSourceCopyBytes,nowNS,nowWallMS}){
 keys(a,['schema','status','admitted_by','reviewer_id','source_sha256','packet_ref','helper_ref','policy_module_ref','predecessor','carry','phase','limits','root_control','successor_source_copy_charge_bytes','pending_manifest_refs']);
 ok(a.schema==='coding-successor-admission-v1'&&a.status==='ADMITTED'&&a.admitted_by==='ROOT'&&a.source_sha256===SOURCE,'POLICY_ADMISSION');
 ok(typeof a.reviewer_id==='string'&&Object.hasOwn(IDS,a.reviewer_id),'POLICY_REVIEWER');const id=IDS[a.reviewer_id],base=`${R}/coding/${id.dir}/current-v6`,old=`${base}/${id.run}`,next=`${base}/successor-v1`;
 ok(selfPath===next+'/successor-pager.mjs','POLICY_SELF_PATH');ref(a.helper_ref,selfPath);ref(a.policy_module_ref,next+'/successor-policy.mjs');exact(a.packet_ref,PACKET);exact(a.limits,LIMITS);exact(a.root_control,CONTROL);
 const p=a.predecessor;keys(p,['root','admission_ref','pager_ref','expired_deadline_wall_ms','source_copy_nominal_bytes','source_copy_conservative_bytes','original_phase_ms','permanent_locks']);ok(p.root===old&&p.original_phase_ms===LIMITS.phase_ms,'POLICY_PREDECESSOR');ref(p.admission_ref,old+'/phase-admission.json');ref(p.pager_ref,old+'/pager.mjs');number(p.expired_deadline_wall_ms);
 ok(Array.isArray(p.permanent_locks)&&p.permanent_locks.length<=1,'POLICY_LOCKS');const lock=`${base}/run-v1/operation-lock`;ok(p.permanent_locks.every(x=>x===lock)&&new Set(p.permanent_locks).size===p.permanent_locks.length&&(id.dir!=='open-coding-b'||p.permanent_locks.includes(lock)),'POLICY_LOCKS');
 if(id.dir==='open-coding-b')ok(p.source_copy_nominal_bytes===120959&&p.source_copy_conservative_bytes===127602,'POLICY_B_FLOOR');
 const total=sourceCopyTotals(a);number(measuredSourceCopyBytes,LIMITS.new_source_copy_bytes);ok(measuredSourceCopyBytes>0&&measuredSourceCopyBytes>=sum(a.helper_ref.bytes,a.policy_module_ref.bytes)&&a.successor_source_copy_charge_bytes>=measuredSourceCopyBytes&&total.successor_charge_bytes>0,'POLICY_SOURCE_COPY');
 carry(a.carry);ok(a.carry.semantic_final_cases===id.final&&a.carry.fixed_case_cursor===id.cursor&&a.carry.unusable_source_cases===0&&a.carry.elapsed_ms===LIMITS.phase_ms,'POLICY_CARRY_FLOOR');
 keys(a.phase,['origin_ns','deadline_ns','started_wall_ms','deadline_wall_ms']);const origin=ns(a.phase.origin_ns),deadline=ns(a.phase.deadline_ns);number(a.phase.started_wall_ms);number(a.phase.deadline_wall_ms);number(nowWallMS);
 ok(typeof nowNS==='bigint'&&deadline-origin===BigInt(LIMITS.phase_ms)*1000000n&&a.phase.deadline_wall_ms-a.phase.started_wall_ms===LIMITS.phase_ms&&a.phase.started_wall_ms>=p.expired_deadline_wall_ms&&nowNS>=origin&&nowNS<deadline&&nowWallMS>=a.phase.started_wall_ms&&nowWallMS<a.phase.deadline_wall_ms,'POLICY_CLOCK');
 refs(a.pending_manifest_refs);const pending=id.dir==='open-coding-a'?['r000016','r000017']:['r000001'];ok(a.pending_manifest_refs.length===pending.length&&a.pending_manifest_refs.every((r,i)=>r.path===`${old}/requests/${pending[i]}/manifest.json`),'POLICY_PENDING_PATH');return true;
}
export function addCarry(previous,delta){
 carry(previous);keys(delta,CARRY);const result={};for(const k of CARRY)result[k]=sum(previous[k],delta[k]);carry(result);return Object.freeze(result);
}
export function dispositionStats(rows){
 ok(Array.isArray(rows)&&rows.length<=500,'POLICY_ROWS');let semantic=0,unusable=0,partial=0;
 for(let i=0;i<rows.length;i++){const r=rows[i];keys(r,['audit_id','status']);ok(r.audit_id===`coding-${String(i+1).padStart(4,'0')}`,'POLICY_FIXED_ORDER');if(r.status==='SEMANTIC_FINAL')semantic++;else if(r.status==='UNUSABLE_SOURCE_UNCODED'){ok(r.audit_id==='coding-0103','POLICY_UNUSABLE_CASE');unusable++;}else{ok(r.status==='PARTIAL'&&i===rows.length-1,'POLICY_PARTIAL');partial++;}}
 return Object.freeze({fixed_cases:500,semantic_final_cases:semantic,unusable_source_cases:unusable,partial_cases:partial,unopened_cases:500-rows.length,completed_attempts:semantic+unusable,fixed_case_cursor:semantic+unusable+1,formal500_gate_satisfied:false});
}
const AROOT=`${R}/coding/open-coding-a/current-v6/run-v1`;
const EVIDENCE=Object.freeze([
 Object.freeze({path:AROOT+'/technical-extraction-0103-status.json',sha256:'f7fe9044a73b9ed70bf5fbc89e4da7e9c74efe92fc0baf387062acd676eee575',bytes:1394}),
 Object.freeze({path:AROOT+'/source-input-scope-0103-images.json',sha256:'6594ee9715e1557389837c77a296a7c5fd18c205ca1d46cd5379c07a08ed7c76',bytes:4592})
]);
export function validateUnusableDisposition(input){
 keys(input,['auditId','reviewerId','technical','scope','evidenceRefs','ownRawCoverageComplete','ownParentNativeCoverageComplete']);const {auditId,reviewerId,technical,scope,evidenceRefs}=input;
 ok(auditId==='coding-0103'&&reviewerId==='open-coding-a'&&input.ownRawCoverageComplete===true&&input.ownParentNativeCoverageComplete===true,'POLICY_UNUSABLE_OWNER_COVERAGE');
 exact(technical,{extraction_status:'rejected',whole_normalized_characters:32,selected_parent_is_whole_normalized_text:true,extracted_parent_count:0,extracted_flat_unit_count:0,nonempty_normalized_origins_from_HTML_BODY:0,all_nonempty_normalized_origins_in_SGML_filing_headers:true,referenced_image_count:3,image_pixels_read:0,admitted_parent_native_projection_pages_observed_and_ACKed:31,admitted_full_raw_HTML_pages_observed_and_ACKed:1,source_availability_finding_only:true,current_accepted_extraction_defect_claim:false,original_source_quality_complete:false});
 keys(scope,['complete_admitted_text_and_projection','original_visual_input_complete','new_fetches','new_API_calls','case_remains_partial','images']);for(const [k,v]of Object.entries({complete_admitted_text_and_projection:true,original_visual_input_complete:false,new_fetches:0,new_API_calls:0,case_remains_partial:true}))ok(scope[k]===v,'POLICY_UNUSABLE_SCOPE');ok(Array.isArray(scope.images)&&scope.images.length===3,'POLICY_IMAGES');for(const image of scope.images)exact(image,{pixel_content_read:false,OCR_read:false});
 refs(evidenceRefs,128);ok(evidenceRefs.length>=3,'POLICY_UNUSABLE_EVIDENCE');for(let i=0;i<2;i++)exact(evidenceRefs[i],EVIDENCE[i]);
 const groups=new Map();for(const r of evidenceRefs.slice(2)){ok(r.path.startsWith(AROOT+'/requests/'),'POLICY_UNUSABLE_EVIDENCE');const match=/^(r[0-9]{6})\/(manifest\.json|(?:emitted|ack)-[0-9]{5}\.json)$/u.exec(r.path.slice((AROOT+'/requests/').length));ok(match,'POLICY_UNUSABLE_EVIDENCE');if(!groups.has(match[1]))groups.set(match[1],new Set());groups.get(match[1]).add(match[2]);}
 let pages=0;for(const names of groups.values()){ok(names.has('manifest.json'),'POLICY_UNUSABLE_MANIFEST');for(const name of names){if(name==='manifest.json')continue;const emitted=name.startsWith('emitted-');ok(names.has(name.replace(emitted?'emitted-':'ack-',emitted?'ack-':'emitted-')),'POLICY_UNUSABLE_ACK_PAIR');if(emitted)pages++;}}ok(pages===32,'POLICY_UNUSABLE_PAGE_COUNT');
 return Object.freeze({status:'UNUSABLE_SOURCE_UNCODED',audit_id:auditId,reviewer_id:reviewerId,meaningful_coding:false,final_reading:false,replacement:false,formal500_gate_satisfied:false,authority:'NONE',evidence_refs:Object.freeze(evidenceRefs.map(r=>Object.freeze({...r})))});
}
