// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE. Pure stored-metadata/decoded-artifact checks; no IO or permits.
import {sha,digest} from '../finite-codec.mjs';
import {immutableCopy} from '../immutable-state.mjs';
import {verifyNativeDecorationEnvelope} from '../source-decoration.prototype.mjs';
import {SOURCE,RUN,COMPARISON_CASES as CASES,COMPARISON_ROWS as ROWS,FAILED_AVAILABLE} from '../source-only-adverse-comparison-v1/fixed-cases.mjs';
const POLICY='c312b885f548b6c27d3a82f361fbb5642fc50562868c534d1c9e962b15f42230';
const Q15=RUN+'/qa/literal-emphasis-parent-v1-boundary-activation-probe-v1';
const Q16=RUN+'/qa/literal-emphasis-parent-v1-focal-context-projection-v1-retry2';
const METHODS=Object.freeze({tracer_sha256:'803a661ac8880d1f43bdf99f2a8303402cd3c9ecdd0e16981b10e8fc2fda4d02',baseline_collector_sha256:'96bfc4a6baab4e31efa0b7f7a21ea2bed158983adc6ff8556d3ac5d6769142cd'});
const SUMMARY_REFS=Object.freeze([{path:Q15+'/outputs/development-0055/summary.json',sha256:'107b96fc2014ade3aa31796040f4a7c0de444e6b8b844037655a36052036325a',bytes:6110},{path:Q15+'/outputs/development-0047/summary.json',sha256:'ca30d866f1ebba3f89b6c662b3208ac52960f0df447996b3578271970d66a9bd',bytes:6088}]);
const NODE={path:'/opt/nonverba-tools/node/bin/node',sha256:'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48',bytes:124827920};
const FLAGS=['--max-old-space-size=256','--disable-proto=throw','--experimental-vm-modules'];
const check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});},same=(a,b)=>digest(a)===digest(b),J=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v),integer=(v,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const ids=c=>({audit_id:c.audit_id,contract_id:c.contract_id,case_id:c.case_id});
const focal=r=>({id:r.focal_id,start:r.focal_start,end:r.focal_end,sha256:r.focal_sha256});
const scope=r=>({start:r.start,end:r.end,sha256:r.sha256});
function ref(r,max=262144){check(r&&Object.keys(r).sort().join('|')==='bytes|path|sha256'&&typeof r.path==='string'&&r.path.startsWith('/')&&hash(r.sha256)&&integer(r.bytes,1,max),'CONTEXT_INPUT_REF');}
function pinned(value,r,max=262144){ref(r,max);check(value&&typeof value==='object','CONTEXT_INPUT_METADATA');const b=J(value);check(b.length===r.bytes&&sha(b)===r.sha256,'CONTEXT_INPUT_METADATA_PIN');}
function sealed(v){const{sha256,...body}=v??{};return hash(sha256)&&digest(body)===sha256;}
function artifactRef(r,root,audit){check(r&&Object.keys(r).sort().join('|')==='bytes|decoded_bytes|decoded_sha256|encoding|path|sha256'&&r.path===root+'/outputs/'+audit+'/baseline.json.gz'&&r.encoding==='gzip'&&integer(r.bytes,1,8388608)&&integer(r.decoded_bytes,1,33554432)&&hash(r.sha256)&&hash(r.decoded_sha256),'CONTEXT_INPUT_BASELINE_REF');}
function guardCheck(guard,bindings){
  check(guard?.schema==='stored-reader-complete-fresh100-guard-v1'&&Array.isArray(guard.rows)&&guard.rows.length===100&&new Set(guard.rows.map(r=>r.audit_id)).size===100,'CONTEXT_INPUT_FRESH100');
  const{projection_sha256,...body}=guard,protectedIDs=[...new Set(guard.rows.map(r=>r.contract_id))].sort();
  check(hash(projection_sha256)&&digest(body)===projection_sha256&&protectedIDs.length===29&&same(protectedIDs,guard.contract_ids),'CONTEXT_INPUT_FRESH_SEAL');
  check(bindings.every(b=>!protectedIDs.includes(b.contract_id)),'CONTEXT_INPUT_PROTECTED_CID');
}

const HISTORICAL_FAILURE_KEYS=['original_order_rank','audit_id','contract_id','case_kind','focal_kind','focal','parent','duplicate','cache_decoded','native_decoded','raw_bytes','normalized_bytes','combined_input_decoded','encoded_cache','encoded_native','protected_CID','prospective_status','excess_decoded_bytes','replacement_allowed'].sort().join('|');
function sharedTypedFailure(r){return{audit_id:r.audit_id,contract_id:r.contract_id,ordered_index:r.ordered_index,case_kind:r.case_kind,focal_kind:r.focal_kind,status:r.status,cache_decoded_bytes:r.cache_decoded_bytes,native_decoded_bytes:r.native_decoded_bytes,raw_bytes:r.raw_bytes,normalized_bytes:r.normalized_bytes,declared_combined_decoded_input_bytes:r.declared_combined_decoded_input_bytes,decoded_limit_bytes:r.decoded_limit_bytes,excess_decoded_bytes:r.excess_decoded_bytes,replacement_allowed:r.replacement_allowed};}
function sharedHistoricalFailure(r){
  check(r&&Object.keys(r).sort().join('|')===HISTORICAL_FAILURE_KEYS&&integer(r.original_order_rank,1)&&['cache_decoded','native_decoded','raw_bytes','normalized_bytes','combined_input_decoded','encoded_cache','encoded_native','excess_decoded_bytes'].every(k=>integer(r[k],1)),'CONTEXT_INPUT_FAILED_AVAILABLE_SCHEMA');
  check(r.cache_decoded+r.native_decoded+r.raw_bytes+r.normalized_bytes===r.combined_input_decoded&&r.combined_input_decoded>r.excess_decoded_bytes&&r.replacement_allowed===false&&r.duplicate===false&&r.protected_CID===false,'CONTEXT_INPUT_FAILED_AVAILABLE_FACTS');
  // One-way fact projection only. Missing typed case/row IDs and source-read
  // flags are not invented. The full historical record, including geometry and
  // encoded sizes, remains pinned by policy and exact prior-manifest equality.
  return{audit_id:r.audit_id,contract_id:r.contract_id,ordered_index:r.original_order_rank-1,case_kind:r.case_kind,focal_kind:r.focal_kind,status:r.prospective_status,cache_decoded_bytes:r.cache_decoded,native_decoded_bytes:r.native_decoded,raw_bytes:r.raw_bytes,normalized_bytes:r.normalized_bytes,declared_combined_decoded_input_bytes:r.combined_input_decoded,decoded_limit_bytes:r.combined_input_decoded-r.excess_decoded_bytes,excess_decoded_bytes:r.excess_decoded_bytes,replacement_allowed:r.replacement_allowed};
}

/** Pure scope check exposed for SOURCE_FREE policy-shape regressions. A true
 * result does not authenticate policy bytes or grant IO; the actual route also
 * requires its fixed canonical pin and every stored metadata binding. */
export function checkContextPolicyScope(p){
  check(p?.QA_root===Q16&&same(p.source_metadata_bindings,CASES)&&p.manual_reader_opening===false&&p.model_access===false&&p.tokenizer_access===false&&p.quality_gate_pass===false&&p.authority==='NONE','CONTEXT_INPUT_POLICY_SCOPE');
  check(Array.isArray(p.failed_available)&&p.failed_available.length===FAILED_AVAILABLE.length,'CONTEXT_INPUT_FAILED_AVAILABLE_SCHEMA');
  check(same(p.failed_available.map(sharedHistoricalFailure),FAILED_AVAILABLE.map(sharedTypedFailure)),'CONTEXT_INPUT_FAILED_AVAILABLE_FACTS');
  return true;
}

/** Lower-level join checker for trusted, bounded parsed JSON and SOURCE_FREE
 * controls. It does not authenticate stored bytes or authorize any read. The
 * actual entry must call validateContextInputCustody, never this helper alone. */
export function checkContextCustodyMetadata({policy:p,completion:c,admission:a,epoch:e,pending:n,manifest:m,closed,terminal,summaries,guard}){
  const bindings=p?.source_metadata_bindings;
  check(Array.isArray(bindings)&&bindings.length===2&&bindings[0].audit_id==='development-0055'&&bindings[1].audit_id==='development-0047'&&new Set(bindings.map(b=>b.contract_id)).size===2,'CONTEXT_INPUT_FIXED_ORDER');
  check(Array.isArray(p.baseline_inputs)&&p.baseline_inputs.length===2&&p.source_sha256===SOURCE&&same(p.methods,METHODS),'CONTEXT_INPUT_SOURCE_METHODS');
  guardCheck(guard,bindings);
  check(c?.schema==='boundary-source-replay-completion-v1'&&c.status==='COMPLETE_BOUNDARY_SOURCE_REPLAY_NOT_QUALITY'&&c.original_actor_absent===true&&c.all_replay_artifacts_rehashed===true&&c.baseline_prior_native_identity_verified===true&&c.activation_probes_verified===true&&c.observational_V2_core_equal===true&&c.observational_V2_native_equal===true&&c.quality_gate_pass===false&&c.source_quality_passed===false&&c.model_access===false&&c.tokenizer_access===false&&c.authority==='NONE','CONTEXT_INPUT_COMPLETION');
  check(same(c.admission_ref,p.prior_admission_ref)&&same(c.pending_ref,p.prior_pending_ref)&&same(c.manifest_ref,p.prior_manifest_ref)&&same(c.source_epoch_ref,p.prior_source_epoch_ref)&&same(c.metadata_guard_ref,p.guard_ref),'CONTEXT_INPUT_COMPLETION_REFS');
  check(a?.schema==='ROOT_BOUNDARY_SOURCE_REPLAY_ADMISSION_V1'&&a.status==='ADMITTED_EXACT_TWO_CASE_SOURCE_ONLY_REPLAY'&&a.root===Q15&&same(a.source_epoch_ref,p.prior_source_epoch_ref)&&same(a.policy_ref,c.policy_ref)&&same(a.cases,bindings.map(ids))&&a.model_access===false&&a.tokenizer_access===false&&a.quality_gate_pass===false,'CONTEXT_INPUT_ADMISSION');
  check(e?.schema==='boundary-source-replay-source-epoch-v1'&&e.authority==='NONE'&&same(e.runtime_ref,NODE)&&same(e.node_flags,FLAGS)&&same(e.runtime_ref,a.runtime_ref)&&same(e.node_flags,a.node_flags)&&Array.isArray(e.source_refs)&&e.source_refs.length>0&&e.source_refs.length<=256&&same(e.source_refs,a.source_refs)&&new Set(e.source_refs.map(r=>r.path)).size===e.source_refs.length,'CONTEXT_INPUT_SOURCE_EPOCH');
  for(const r of e.source_refs){ref(r);check(/^(?:\/tmp\/nonverba-unified-source\/[a-f0-9]{32}\/code\/|\/opt\/nonverba-tools\/priors-derivation-0\.1\/node_modules\/(?:parse5|entities)\/)/u.test(r.path),'CONTEXT_INPUT_SOURCE_SCOPE');}
  for(const key of ['run_entry_ref','guard_entry_ref','custody_entry_ref','kernel_entry_ref','checker_entry_ref','probe_helper_ref'])check(e.source_refs.some(r=>same(r,a[key])),'CONTEXT_INPUT_ENTRY_SOURCE_REF');
  check(n?.schema==='boundary-source-replay-exit-pending-v1'&&n.status==='PENDING_EXTERNAL_ROOT_EXIT_READBACK'&&n.own_exit_claimed===false&&same(n.actor,c.original_actor)&&n.boot_id===c.boot_id&&n.origin_ns===c.origin_ns&&n.initial_active_carry_ms===c.initial_active_carry_ms&&same(n.admission_ref,p.prior_admission_ref)&&same(n.source_epoch_ref,p.prior_source_epoch_ref)&&same(n.manifest_ref,p.prior_manifest_ref)&&same(n.metadata_guard_ref,p.guard_ref),'CONTEXT_INPUT_PENDING');
  check(m?.schema==='boundary-source-replay-output-manifest-v1'&&m.status==='SOURCE_ONLY_REPLAY_PREPARED_PENDING_EXTERNAL_ROOT_EXIT'&&same(m.admission_ref,p.prior_admission_ref)&&same(m.source_epoch_ref,p.prior_source_epoch_ref)&&same(m.metadata_guard_ref,p.guard_ref)&&m.semantic_review_complete===false&&m.quality_gate_pass===false&&m.model_access===false&&same(m.failed_available,p.failed_available),'CONTEXT_INPUT_MANIFEST');
  check(Array.isArray(c.cases)&&c.cases.length===2&&Array.isArray(m.cases)&&m.cases.length===2&&Array.isArray(summaries)&&summaries.length===2,'CONTEXT_INPUT_CASE_COUNT');
  const cases=bindings.map((binding,i)=>{
    const slot=p.baseline_inputs[i],caseResult=c.cases[i],output=m.cases[i],summary=summaries[i],audit=Number(binding.audit_id.slice(-4));
    check(slot.audit_number===audit&&slot.case_id===binding.case_id&&caseResult.audit_number===audit&&caseResult.case_id===binding.case_id&&same(ids(output),ids(binding)),'CONTEXT_INPUT_CASE_JOIN');
    artifactRef(slot.baseline_ref,Q15,binding.audit_id);ref(slot.summary_ref,65536);check(slot.summary_ref.path===Q15+'/outputs/'+binding.audit_id+'/summary.json','CONTEXT_INPUT_SUMMARY_PATH');
    check(same(slot.baseline_ref,caseResult.baseline_ref)&&same(slot.baseline_ref,output.baseline_ref)&&same(slot.summary_ref,caseResult.summary_ref)&&same(slot.summary_ref,output.summary_ref),'CONTEXT_INPUT_OUTPUT_REFS');
    check(summary?.schema==='boundary-source-replay-summary-v1'&&summary.case_id===binding.case_id&&summary.audit_number===audit&&summary.comparison_sequence_index===i&&summary.current_source_sha256===SOURCE&&summary.raw_sha256===binding.source_refs.raw.sha256&&summary.normalized_sha256===binding.source_refs.normalized.sha256&&summary.baseline_core_bridge_equal===true&&summary.baseline_native_exact_prior_bytes===true&&summary.quality_gate_pass===false&&summary.authority==='NONE'&&summary.baseline?.collector_sha256===METHODS.baseline_collector_sha256&&summary.baseline.artifact_sha256===slot.baseline_ref.decoded_sha256&&summary.baseline.artifact_bytes===slot.baseline_ref.decoded_bytes,'CONTEXT_INPUT_SUMMARY');
    return{binding,row:ROWS[i],baseline_ref:slot.baseline_ref,summary_ref:slot.summary_ref,summary};
  });
  check(closed?.schema==='ROOT-boundary-source-replay-clock-closed-v1'&&closed.source_replay_clock_closed===true&&same(closed.completion_ref,p.prior_completion_ref)&&closed.source_replay_active_ms_charged===p.prior_source_active_ms&&closed.charged_pilot_bytes===p.prior_charged_bytes&&closed.cumulative_private_and_metadata_capture_bytes===p.prior_capture_bytes&&closed.cumulative_journal_rows===p.prior_journal_rows&&closed.cumulative_journal_bytes===p.prior_journal_bytes&&closed.unused_reservations_not_refunded===true&&closed.quality_gate_pass===false,'CONTEXT_INPUT_CLOSED_CARRY');
  check(terminal?.schema==='ROOT-boundary-probe-terminal-followup-v1'&&same(terminal.clock_close_ref,p.prior_closed_ref)&&terminal.charged_pilot_bytes===p.prior_charged_bytes&&terminal.source_active_ms_closed===p.prior_source_active_ms&&terminal.quality_gate_pass===false&&terminal.goal_complete===false&&terminal.authority==='NONE','CONTEXT_INPUT_TERMINAL');
  return immutableCopy({cases,guard,failed_available:p.failed_available,prior_refs:{completion:p.prior_completion_ref,admission:p.prior_admission_ref,epoch:p.prior_source_epoch_ref,pending:p.prior_pending_ref,manifest:p.prior_manifest_ref,closed:p.prior_closed_ref,terminal:p.prior_terminal_ref},authority:'NONE',actual_io_authority:false});
}

/** Exact actual metadata route. No caller flag, fixture option or capability. */
export function validateContextInputCustody(args){
  check(args?.policy&&digest(args.policy)===POLICY,'CONTEXT_INPUT_PINNED_POLICY');const p=args.policy;
  checkContextPolicyScope(p);
  for(const[key,refKey]of [['completion','prior_completion_ref'],['admission','prior_admission_ref'],['epoch','prior_source_epoch_ref'],['pending','prior_pending_ref'],['manifest','prior_manifest_ref'],['closed','prior_closed_ref'],['terminal','prior_terminal_ref'],['guard','guard_ref']])pinned(args[key],p[refKey]);
  check(Array.isArray(args.summaries)&&args.summaries.length===2,'CONTEXT_INPUT_SUMMARIES');args.summaries.forEach((s,i)=>pinned(s,p.baseline_inputs[i].summary_ref,65536));
  return checkContextCustodyMetadata(args);
}

const geometry=e=>digest({sections:e.sections.map(s=>({id:s.id,start:s.start,end:s.end,sha256:s.sha256})),units:e.units.map(u=>({id:u.id,parent_section_id:u.parent_section_id,start:u.start,end:u.end,sha256:u.sha256}))});
const invariant=e=>{const{sha256,collector_source_sha256,...body}=e;return digest(body);};
const unknowns=e=>digest({unmapped:e.unmapped,unmapped_normalized:e.unmapped_normalized,ambiguous_segments:e.ambiguous_segments,joint_whitespace_segments:e.joint_whitespace_segments,blocking_ambiguous_segments:e.blocking_ambiguous_segments,collector_issues:e.collector_issues,trace_unresolved:e.trace.unresolved,parser_errors:e.trace.parser_errors});
function literal(text,r){check(integer(r?.start)&&integer(r.end,r.start+1,text.length)&&typeof r.text==='string'&&r.text===text.slice(r.start,r.end)&&sha(r.text)===r.sha256,'CONTEXT_BASELINE_LITERAL');}

/** Structural SOURCE_FREE helper. It verifies supplied bytes' internal native
 * bindings, not fixed-case custody. Its true result is never an IO permit. */
export function checkBaselineArtifact({artifact:a,binding:b,row,summary:s}){
  const e=a?.extraction;
  check(a?.schema==='boundary-source-replay-artifact-v1'&&a.source_kind==='ACTUAL_EXPLORATORY_SOURCE_ONLY'&&a.method_kind==='BASELINE_NINE_TAG'&&same(ids(a),ids(b))&&a.current_source_sha256===b.current_source_sha256&&a.selection_recomputed===false&&a.source_words_truncated===false&&a.quality_gate_pass===false&&a.authority==='NONE'&&!Object.hasOwn(a,'activation_probe'),'CONTEXT_BASELINE_HEADER');
  check(e?.status==='accepted'&&same(a.record,e.contract)&&a.record.id===b.contract_id&&a.record.path===row.raw_path&&a.record.format==='html'&&typeof a.raw_full==='string'&&sha(a.raw_full)===b.source_refs.raw.sha256&&Buffer.byteLength(a.raw_full)===b.source_refs.raw.bytes&&typeof e.normalized_text==='string'&&sha(e.normalized_text)===b.source_refs.normalized.sha256&&Buffer.byteLength(e.normalized_text)===b.source_refs.normalized.bytes&&e.normalized_sha256===b.source_refs.normalized.sha256,'CONTEXT_BASELINE_SOURCE');
  check(sealed(a.source_proof)&&a.source_proof.sha256===b.current_source_sha256&&same(a.method,{tracer_sha256:METHODS.tracer_sha256,collector_sha256:METHODS.baseline_collector_sha256,boundary_policy:null}),'CONTEXT_BASELINE_METHOD');
  check(same(a.original_focal,focal(row))&&same(a.original_parent,b.parent)&&Array.isArray(e.sections)&&Array.isArray(e.units)&&new Set(e.sections.map(r=>r.id)).size===e.sections.length&&new Set(e.units.map(r=>r.id)).size===e.units.length,'CONTEXT_BASELINE_IDENTITY');
  const normalized=e.normalized_text,parents=new Map(e.sections.map(r=>[r.id,r])),units=new Map(e.units.map(r=>[r.id,r]));
  for(const parent of e.sections){literal(normalized,parent);check(Array.isArray(parent.units)&&Array.isArray(parent.governor_frames)&&same(parent.units,e.units.filter(u=>u.parent_section_id===parent.id)),'CONTEXT_BASELINE_PARENT_UNITS');}
  for(const unit of e.units){literal(normalized,unit);const parent=parents.get(unit.parent_section_id);check(parent&&parent.start<=unit.start&&unit.end<=parent.end,'CONTEXT_BASELINE_UNIT_PARENT');}
  const unit=units.get(row.focal_id),parent=parents.get(b.parent.id);
  check(unit&&parent&&same(scope(unit),scope(b.focal))&&same(scope(parent),scope(b.parent))&&unit.parent_section_id===parent.id,'CONTEXT_BASELINE_FIXED_GEOMETRY');
  const native=e.native_source_decorations;
  verifyNativeDecorationEnvelope(native,{raw:a.raw_full,normalizedText:normalized,expectedTracerSourceSHA256:METHODS.tracer_sha256,expectedCollectorSourceSHA256:METHODS.baseline_collector_sha256});
  for(const r of [...e.sections,...e.units])check(same(r.native_source_decorations_ref,{envelope_sha256:native.sha256,raw_sha256:native.raw.sha256,normalized_sha256:native.normalized.sha256,tracer_source_sha256:native.tracer_source_sha256,collector_source_sha256:native.collector_source_sha256,policy:native.policy,collector_policy:'EXTRACTOR_EMITTED_ORIGIN_ROPES_V3',start:r.start,end:r.end,mapping_status:native.mapping_status,input_eligibility:native.input_eligibility,projection_required:true}),'CONTEXT_BASELINE_NATIVE_REF');
  const f=s?.baseline;
  check(s?.case_id===b.case_id&&s.current_source_sha256===b.current_source_sha256&&s.raw_sha256===b.source_refs.raw.sha256&&s.normalized_sha256===b.source_refs.normalized.sha256&&digest(a.custody)===s.custody_sha256&&f?.collector_sha256===METHODS.baseline_collector_sha256&&f.native_envelope_sha256===native.sha256&&f.native_invariant_sha256===invariant(native)&&f.trace_sha256===native.trace.sha256&&f.segments_sha256===digest(native.segments)&&f.unknowns_sha256===unknowns(native)&&f.geometry_sha256===geometry(e)&&f.section_count===e.sections.length&&f.unit_count===e.units.length&&f.original_focal_id_sha256===sha(unit.id)&&f.original_parent_id_sha256===sha(parent.id)&&f.original_focal_identity_present===true&&f.original_parent_identity_present===true&&f.selection_recomputed===false&&f.quality_gate_pass===false&&f.authority==='NONE','CONTEXT_BASELINE_SUMMARY_FACTS');
  const bytes=Buffer.from(JSON.stringify(a));check(bytes.length<=33554432&&bytes.length===f.artifact_bytes&&sha(bytes)===f.artifact_sha256,'CONTEXT_BASELINE_DECODED_PIN');
  return true;
}

/** Strict fixed-case decoded-baseline route, called only after ROOT has hashed
 * the encoded artifact from validateContextInputCustody's allowlist. */
export function verifyBaselineArtifact(args){
  const i=CASES.findIndex(b=>same(b,args?.binding));check(i>=0&&same(args.row,ROWS[i])&&args.binding.current_source_sha256===SOURCE,'CONTEXT_BASELINE_FIXED_CASE');
  pinned(args.summary,SUMMARY_REFS[i],65536);
  return checkBaselineArtifact(args);
}
