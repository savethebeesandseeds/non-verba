// SPDX-License-Identifier: AGPL-3.0-only
// Geometric Full-Context Partitions — PROTOTYPE / UNADOPTED. Pure APIs only.
import{createHash}from'node:crypto';
import{createDeclaredContextSet,declaredContextSourceIdentity}from'/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2/experiments/literal-emphasis-parent-v1/declared-context-set-v1/context-set.mjs';
import{createNativeDecorationView}from'/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code/disputes/prototypes/priors-derivation/study-v0.2/lib/source-decoration.mjs';
import{prepareDeclaredNativeNodes,verifyDeclaredNativeNodes,SUBSET_POLICY_SHA256}from'/tmp/nonverba-automatic-context-native-windows-v1-controls-20261019-a2/native-nodes-dictionary.mjs';
import{decodeNativeDictionaryWindow,reconstructDictionaryWindowSource}from'/tmp/nonverba-automatic-context-native-windows-v1-controls-20261019-a2/window-dictionary.mjs';
const H=x=>createHash('sha256').update(x).digest('hex'),C=v=>Array.isArray(v)?'['+v.map(C).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+C(v[k])).join(',')+'}':JSON.stringify(v),D=v=>H(C(v));
const check=(v,c='GEOMETRIC_CONTEXT_BINDING')=>{if(!v)throw Object.assign(Error(c),{code:c});};
function frozen(v){if(v&&typeof v==='object'){for(const x of Object.values(v))frozen(x);Object.freeze(v);}return v;}
export const POLICY=frozen({name:'GEOMETRIC_FULL_NORMALIZED_CONTEXT_PARTITIONS_V1_UNADOPTED',max_UTF16:1000,boundary:'MOVE_END_BACK_ONE_IF_BETWEEN_A_SURROGATE_PAIR',max_nodes:32,source_union:'ORDERED_ADJACENT_DISJOINT_EXACT_FULL_NORMALIZED_TEXT',headings_or_labels_added_to_model_text:false,node_terminal_policy:'EXISTING_INCLUDE_END_ZERO_WIDTH_AT_EACH_NODE_END; NEXT_NODE_START_REPEATS_SEAM_ORIGINS',native_subset_policy_sha256:SUBSET_POLICY_SHA256});
export const POLICY_SHA256=D(POLICY);
export const BUDGET=frozen({planning_total:3328,planning_per_model:1664,planning_per_node:64,windows_per_node:16,recount_total:832,recount_per_model:416,recount_per_node:16});
export const CLOSED_OLD_POOL=frozen({status:'CLOSED_NO_RESET_NO_REFUNDS',planning:40000,recount:158,elapsed_ms:565387.035676,output_bytes:22627984,original_caps_compliance_restored:false});
const flags=frozen({prototype:true,adopted:false,authority:'NONE',actual_allocation_admitted:false,original_pool_regained_compliance:false,source_authenticity_claimed:false,actual_reading:false,per_input_condition_binding_verified:false,semantic_completeness_verified:false,original_HTML_render_resource_style_completeness:false,quality_gate_pass:false,model_inference:false,pooling_performed:false,global_unique_event_weights_claimed:false,geometry_only_speed_causality_claimed:false});
export function partitionNormalizedText(text){
 check(typeof text==='string'&&text.length>0&&text.length<=32000,'GEOMETRIC_SOURCE_BOUND');
 for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);if(c>=0xD800&&c<=0xDBFF){const d=text.charCodeAt(++i);check(d>=0xDC00&&d<=0xDFFF,'GEOMETRIC_UNICODE');}else check(c<0xDC00||c>0xDFFF,'GEOMETRIC_UNICODE');}
 const ranges=[];let start=0;
 while(start<text.length){check(ranges.length<POLICY.max_nodes,'GEOMETRIC_NODE_BOUND');let end=Math.min(start+1000,text.length);if(end<text.length&&/[\uD800-\uDBFF]/u.test(text[end-1])&&/[\uDC00-\uDFFF]/u.test(text[end]))end--;check(end>start);ranges.push({id:'geometric_'+String(ranges.length).padStart(3,'0'),start,end,sha256:H(text.slice(start,end))});start=end;}
 return frozen({schema:'geometric-full-normalized-text-ranges-v1',policy:POLICY,policy_sha256:D(POLICY),normalized_sha256:H(text),normalized_UTF16:text.length,ranges,exact_adjacent_disjoint_union:true,geometry_sha256:D(ranges)});
}
const origins=p=>p.annotations.flatMap(a=>a.origins);
const originKey=o=>D({run_id:o.run_id,raw:o.raw,decoded_start:o.decoded_start,decoded_end:o.decoded_end,decoded_sha256:o.decoded_sha256});
function setup(x){
 const recipe=structuredClone(x.recipe),ref=structuredClone(x.recipe_ref);
 check(recipe?.schema==='geometric-full-context-recipe-v1'&&typeof x.recipe_document==='string'&&H(x.recipe_document)===ref?.sha256&&Buffer.byteLength(x.recipe_document)===ref.bytes&&C(JSON.parse(x.recipe_document))===C(recipe),'GEOMETRIC_RECIPE_REF');
 check(recipe.policy_sha256===D(POLICY)&&recipe.source_sha256===x.source.source_sha256&&recipe.normalized_sha256===H(x.normalizedText)&&recipe.normalized_UTF16===x.normalizedText.length&&C(recipe.original_focal)===C(x.focal)&&recipe.semantic_completeness_verified===false,'GEOMETRIC_RECIPE');
 const geometry=partitionNormalizedText(x.normalizedText),identity=declaredContextSourceIdentity(x.source),node=(id,range,role)=>({id,range,declared_role:role,annotation_ref:{...ref},source_identity_sha256:identity});
 const declaration={source:x.source,focal:node('authentic_unplanned_focal',x.focal,'FOCAL'),attachments:geometry.ranges.map(r=>node(r.id,{start:r.start,end:r.end,sha256:r.sha256},'GEOMETRIC_FULL_CONTEXT_PART'))};
 const contextSet=createDeclaredContextSet({...declaration,normalized_text:x.normalizedText}).artifact;
 const view=createNativeDecorationView(x.envelope,{raw:x.raw,normalizedText:x.normalizedText,expectedTracerSourceSHA256:x.methodPins.tracer_source_sha256,expectedCollectorSourceSHA256:x.methodPins.collector_source_sha256});
 const seams=geometry.ranges.slice(1).map((r,i)=>{const p=view.projectRelevant({start:r.start,end:r.start,includeEndZeroWidth:true}),keys=[...new Set(origins(p).map(originKey))];return{position:r.start,left_node:geometry.ranges[i].id,right_node:r.id,zero_projection_sha256:D(p),zero_projection_annotation_groups:p.annotations.length,zero_projection_origin_records:origins(p).length,zero_projection_distinct_origin_keys:keys,expected_terminal_plus_next_start_appearances_if_complete:2};});
 const binding={policy:POLICY,recipe_ref:ref,epoch_ref:recipe.epoch_ref,source:x.source,original_focal:x.focal,geometry_sha256:geometry.geometry_sha256,geometry_ranges:geometry.ranges,envelope_sha256:x.envelope.sha256,raw_sha256:H(x.raw),method_pins:x.methodPins,budget:BUDGET};
 const args={contextSet,declaration,raw:x.raw,normalizedText:x.normalizedText,envelope:x.envelope,methodPins:x.methodPins,planned_node_ids:geometry.ranges.map(r=>r.id),limits:{maxTokens:256,overlapWords:16,total_counter_requests:1664,output_bytes:2097152,planner:{maxEncodeProbes:64,maxTokenizerCalls:64,maxWindows:16,maxSourceCharacters:1000}}};
 return{geometry,seams,binding:structuredClone(binding),args,view};
}
const KEYS=['text','representation_start','representation_end','source_ranges','input_policy','mapping_status','input_eligibility','envelope_sha256','window_annotations_self_contained','computed_style_verified','effectiveness_verified','sha256','empty_native_dictionary'];
function evidence(x,p,a){
 const counts=p.seams.map(s=>new Map(s.zero_projection_distinct_origin_keys.map(k=>[k,0]))),windows=[];
 for(const n of a.nodes)for(let i=0;i<n.windows.length;i++){
  const w=n.windows[i],e=Object.fromEntries(KEYS.map(k=>[k,w[k]])),native=decodeNativeDictionaryWindow(e),start=n.declaration.range.start+w.source_utf16_start,end=n.declaration.range.start+w.source_utf16_end,projection=p.view.projectRelevant({start,end,includeEndZeroWidth:w.source_ranges[0].include_end_zero_width});
  check(reconstructDictionaryWindowSource(e)===x.normalizedText.slice(start,end)&&D(projection)===w.source_ranges[0].projection_sha256,'GEOMETRIC_INVERSE_PROJECTION');
  const seen=new Set(origins(projection).map(originKey));p.seams.forEach((s,j)=>{if(start<=s.position&&end>=s.position)for(const k of counts[j].keys())if(seen.has(k))counts[j].set(k,counts[j].get(k)+1);});
  windows.push({node_id:n.declaration.id,index:i,start,end,source_sha256:H(x.normalizedText.slice(start,end)),encoded_sha256:w.sha256,original_native_sha256:native.sha256,original_native_object_sha256:w.empty_native_dictionary.original_window_sha256,include_end_zero_width:w.source_ranges[0].include_end_zero_width});
 }
 const complete=a.nodes.every(n=>n.status==='COMPLETE'),seams=p.seams.map((s,j)=>({...s,observed_final_window_appearances:[...counts[j]].map(([origin_sha256,appearances])=>({origin_sha256,appearances}))}));
 if(complete)for(const s of seams)check(s.observed_final_window_appearances.every(o=>o.appearances===2),'GEOMETRIC_SEAM_OWNERSHIP');
 return{windows,seams,source_union_complete:complete,seam_counts_are_source_projection_origin_occurrences:true,global_unique_event_weights_claimed:false,within_node_overlap_may_repeat_other_evidence:true};
}
const allocations=new WeakMap();
export function createProposedAllocation(){const token=frozen({proposed:true,admitted:false,authority:'NONE'});allocations.set(token,{planning:0,recount:0,models:[{planning:0,recount:0,prepare_attempted:false,recount_attempted:false,nodes:{}},{planning:0,recount:0,prepare_attempted:false,recount_attempted:false,nodes:{}}],candidate_identity:null});return token;}
export function allocationSnapshot(token){check(allocations.has(token),'GEOMETRIC_ALLOCATION');return frozen(structuredClone(allocations.get(token)));}
function state(token,index){check(allocations.has(token)&&Number.isSafeInteger(index)&&index>=0&&index<2,'GEOMETRIC_ALLOCATION');return allocations.get(token);}
function gate(s,index,node,kind,fn){const m=s.models[index],r=m.nodes[node]??={planning:0,recount:0};check(s[kind]<(kind==='planning'?3328:832)&&m[kind]<(kind==='planning'?1664:416)&&r[kind]<(kind==='planning'?64:16),'GEOMETRIC_COUNTER_QUOTA');s[kind]++;m[kind]++;r[kind]++;return fn();}
export function prepareGeometricCandidate(x,{allocation,model_index}){
 const s=state(allocation,model_index),m=s.models[model_index];check(!m.prepare_attempted,'GEOMETRIC_NO_RETRY');m.prepare_attempted=true;
 const p=setup(x),id=D(p.binding);check(s.candidate_identity===null||s.candidate_identity===id,'GEOMETRIC_MODEL_GEOMETRY_CHANGED');s.candidate_identity=id;
 const counter=x.counter;check(counter?.policy_sha256===D(counter.policy)&&typeof counter.tokenCount==='function','GEOMETRIC_COUNTER_POLICY');
 // Existing core invokes this callback without node identity. Its fixed64/node
 // planner bound supplies per-node planning; model/global gates remain shared.
 const wrapped={policy:counter.policy,policy_sha256:counter.policy_sha256,tokenCount:text=>{check(s.planning<3328&&m.planning<1664,'GEOMETRIC_COUNTER_QUOTA');s.planning++;m.planning++;return counter.tokenCount(text);}};
 const n=prepareDeclaredNativeNodes({...p.args,counter:wrapped}),result={schema:'geometric-full-context-candidate-v1',...flags,status:n.artifact.status==='COMPLETE_UNADOPTED_NODE_PLANS'?'COMPLETE_GEOMETRY_WINDOWS_NOT_ADEQUACY':'HELD_NO_PARTIAL_CANDIDATE_ADOPTION',model_index,input_binding:p.binding,input_sha256:id,geometry:p.geometry,native_artifact:n.artifact,evidence:evidence(x,p,n.artifact),allocation_snapshot:allocationSnapshot(allocation),closed_old_pool:CLOSED_OLD_POOL};
 // Core work includes a denied callback attempt; shared/model planning fields
 // above count only actual supplied-counter invocations, including thrown calls.
 for(const node of n.artifact.nodes)m.nodes[node.declaration.id]={planner_counter_attempts:node.work.tokenizer_calls,recount:0};result.allocation_snapshot=allocationSnapshot(allocation);return frozen(result);
}
export function verifyGeometricCandidate({artifact,...x}){const p=setup(x),keys=['schema',...Object.keys(flags),'status','model_index','input_binding','input_sha256','geometry','native_artifact','evidence','allocation_snapshot','closed_old_pool'];check(C(Object.keys(artifact).sort())===C(keys.sort()));check(artifact.schema==='geometric-full-context-candidate-v1'&&[0,1].includes(artifact.model_index)&&artifact.input_sha256===D(p.binding)&&C(artifact.input_binding)===C(p.binding)&&C(artifact.geometry)===C(p.geometry)&&C(artifact.closed_old_pool)===C(CLOSED_OLD_POOL));for(const[k,v]of Object.entries(flags))check(artifact[k]===v);verifyDeclaredNativeNodes({artifact:artifact.native_artifact,...p.args,counter_policy:x.counter_policy});check(C(artifact.evidence)===C(evidence(x,p,artifact.native_artifact)));check(artifact.status===(artifact.native_artifact.nodes.every(n=>n.status==='COMPLETE')?'COMPLETE_GEOMETRY_WINDOWS_NOT_ADEQUACY':'HELD_NO_PARTIAL_CANDIDATE_ADOPTION'));return true;}
export function recountGeometricCandidate({artifact,counter,...x},{allocation,model_index}){
 const s=state(allocation,model_index),m=s.models[model_index];check(m.prepare_attempted&&!m.recount_attempted&&artifact.model_index===model_index&&s.candidate_identity===artifact.input_sha256,'GEOMETRIC_RECOUNT_BINDING');m.recount_attempted=true;
 check(counter.policy_sha256===D(counter.policy)&&C(counter.policy)===C(artifact.native_artifact.counter_policy),'GEOMETRIC_COUNTER_POLICY');verifyGeometricCandidate({artifact,...x,counter_policy:counter.policy});
 const rows=[];for(const n of artifact.native_artifact.nodes)for(let i=0;i<n.windows.length;i++){const w=n.windows[i],tokens=gate(s,model_index,n.declaration.id,'recount',()=>counter.tokenCount(w.text));check(Number.isSafeInteger(tokens)&&tokens>0&&tokens<=256&&tokens===w.tokens,'GEOMETRIC_FINAL_COUNT');rows.push({node_id:n.declaration.id,index:i,encoded_sha256:w.sha256,tokens});}
 return frozen({schema:'geometric-full-context-fresh-recount-v1',...flags,status:artifact.status==='COMPLETE_GEOMETRY_WINDOWS_NOT_ADEQUACY'?'MATCHED_WHOLE_CANDIDATE_WINDOWS_NOT_ADEQUACY':'HELD_NO_PARTIAL_CANDIDATE_ADOPTION',requests:rows.length,rows,input_sha256:artifact.input_sha256,allocation_snapshot:allocationSnapshot(allocation),closed_old_pool:CLOSED_OLD_POOL});
}
