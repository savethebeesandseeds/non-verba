// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE. Pure custody checks over bounded parsed metadata/decoded inputs.
// No reads, permits, collectors, arms builders or semantic decisions.
import {sha,digest} from '../finite-codec.mjs';
import {immutableCopy} from '../immutable-state.mjs';
import {SOURCE,RUN,COMPARISON_CASES as CASES,COMPARISON_ROWS as ROWS} from '../source-only-adverse-comparison-v1/fixed-cases.mjs';
import {checkContextPolicyScope,checkBaselineArtifact,verifyBaselineArtifact} from '../focal-context-projection-v1/input-custody.mjs';
import {verifyFocalContext,summarizeFocalContext,CONTEXT_LIMITS} from '../focal-context-projection-v1/projection.mjs';

const POLICY_SHA256='a76239236388c624c097df5c1a4a7611d6b2c5a4ace45c7268e3031208183916';
const CONTEXT_POLICY_SHA256='c312b885f548b6c27d3a82f361fbb5642fc50562868c534d1c9e962b15f42230';
const Q15=RUN+'/qa/literal-emphasis-parent-v1-boundary-activation-probe-v1';
const Q17=RUN+'/qa/literal-emphasis-parent-v1-focal-context-projection-v1-retry2';
const Q18=RUN+'/qa/literal-emphasis-parent-v1-focal-context-review-v1';
const Q19=RUN+'/qa/literal-emphasis-parent-v1-matched-context-arms-v1';
const PRIOR_COMPLETION_REF={path:Q15+'/ROOT-replay-completion.json',sha256:'4893e1f952c4b4e55292c0fa8e5c5c9def3754b052a428d41ec4384fa71e982c',bytes:10110};
const NODE={path:'/opt/nonverba-tools/node/bin/node',sha256:'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48',bytes:124827920};
const FLAGS=['--max-old-space-size=256','--disable-proto=throw','--experimental-vm-modules'];
const J=v=>Buffer.from(JSON.stringify(v,null,2)+'\n'),same=(a,b)=>a===undefined||b===undefined?a===b:digest(a)===digest(b);
const check=(v,code)=>{if(!v)throw Object.assign(Error(code),{code});};
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v),int=(v,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const ids=b=>({audit_id:b.audit_id,contract_id:b.contract_id,case_id:b.case_id});
const ROOTS={context:Q17,review:Q18};
const CONTEXT_REFS={policy:'context_policy_ref',completion:'context_completion_ref',admission:'context_admission_ref',epoch:'context_source_epoch_ref',pending:'context_pending_ref',manifest:'context_manifest_ref',closed:'context_closed_ref',terminal:'context_terminal_ref',followup:'context_followup_ref'};
const REVIEW_REFS={closed:'review_closed_ref',terminal:'review_terminal_ref',declaration:'review_declaration_ref',observations:'review_observations_ref',audit:'review_metadata_audit_ref',final_copy:'prior_final_copy_ref'};
function ref(r,max=262144){check(r&&Object.keys(r).sort().join('|')==='bytes|path|sha256'&&typeof r.path==='string'&&r.path.startsWith('/')&&hash(r.sha256)&&int(r.bytes,1,max),'MATCHED_INPUT_REF');}
function pinned(value,r,max=262144,compact=false){ref(r,max);const b=compact?Buffer.from(JSON.stringify(value)+'\n'):J(value);check(b.length===r.bytes&&sha(b)===r.sha256,'MATCHED_INPUT_METADATA_PIN');}
function artifactRef(r,path){check(r&&Object.keys(r).sort().join('|')==='bytes|decoded_bytes|decoded_sha256|encoding|path|sha256'&&r.path===path&&r.encoding==='gzip'&&int(r.bytes,1,8388608)&&int(r.decoded_bytes,1,33554432)&&hash(r.sha256)&&hash(r.decoded_sha256),'MATCHED_INPUT_ARTIFACT_REF');}
function guardCheck(g){
  check(g?.schema==='stored-reader-complete-fresh100-guard-v1'&&Array.isArray(g.rows)&&g.rows.length===100&&new Set(g.rows.map(r=>r.audit_id)).size===100,'MATCHED_INPUT_FRESH100');
  const{projection_sha256,...body}=g,cids=[...new Set(g.rows.map(r=>r.contract_id))].sort();
  check(hash(projection_sha256)&&digest(body)===projection_sha256&&cids.length===29&&same(cids,g.contract_ids)&&CASES.every(b=>!cids.includes(b.contract_id)),'MATCHED_INPUT_GUARD');
}
function closedAuthority(v){check(v?.quality_gate_pass===false&&v.authority==='NONE','MATCHED_INPUT_AUTHORITY');}
function contextJoin(p,x){
  const{policy:old,completion:c,admission:a,epoch:e,pending:n,manifest:m,closed,terminal,followup,summaries}=x;
  checkContextPolicyScope(old);check(same(p.source_metadata_bindings,old.source_metadata_bindings)&&same(p.failed_available,old.failed_available)&&same(p.baseline_inputs,old.baseline_inputs)&&same(p.guard_ref,old.guard_ref)&&same(old.prior_completion_ref,PRIOR_COMPLETION_REF),'MATCHED_INPUT_CONTEXT_POLICY');
  check(c?.schema==='focal-context-completion-v1'&&c.status==='COMPLETE_FOCAL_CONTEXT_PROJECTION_NOT_QUALITY'&&c.original_actor_absent===true&&c.original_inherited_group_absence_claimed===false&&c.all_baseline_inputs_and_outputs_rehashed===true&&c.existing_frame_projection_validated===true&&c.failed_available0048_not_replaced===true&&c.failed_attempt_retained===true,'MATCHED_INPUT_CONTEXT_COMPLETION');
  for(const[key,r]of Object.entries({admission_ref:p.context_admission_ref,policy_ref:p.context_policy_ref,pending_ref:p.context_pending_ref,manifest_ref:p.context_manifest_ref,source_epoch_ref:p.context_source_epoch_ref,guard_ref:p.guard_ref,prior_completion_ref:old.prior_completion_ref,prior_closed_ref:old.prior_closed_ref}))check(same(c[key],r),'MATCHED_INPUT_CONTEXT_COMPLETION_REF');
  for(const k of['collector_rerun','selection_recomputed','native_projection_performed','context_adequacy_claimed','governance_verified','semantic_completeness_verified','formal_coding_authority','manual_reader_opening','model_access','tokenizer_access','first_priors_decided'])check(c[k]===false,'MATCHED_INPUT_CONTEXT_CLOSED_FLAG');closedAuthority(c);
  check(a?.schema==='ROOT_FOCAL_CONTEXT_ADMISSION_V1'&&a.status==='ADMITTED_TWO_FIXED_SOURCE_ONLY_CONTEXT_PROJECTIONS'&&a.root===Q17&&same(a.policy_ref,p.context_policy_ref)&&same(a.source_epoch_ref,p.context_source_epoch_ref)&&same(a.cases,CASES.map(ids))&&a.model_access===false&&a.tokenizer_access===false&&a.quality_gate_pass===false,'MATCHED_INPUT_CONTEXT_ADMISSION');
  check(e?.schema==='focal-context-source-epoch-v1'&&e.authority==='NONE'&&same(e.runtime_ref,NODE)&&same(e.node_flags,FLAGS)&&same(e.runtime_ref,a.runtime_ref)&&same(e.node_flags,a.node_flags)&&Array.isArray(e.source_refs)&&e.source_refs.length>0&&e.source_refs.length<=256&&same(e.source_refs,a.source_refs)&&new Set(e.source_refs.map(r=>r.path)).size===e.source_refs.length,'MATCHED_INPUT_CONTEXT_EPOCH');
  for(const r of e.source_refs){ref(r);check(/^(?:\/tmp\/nonverba-unified-source\/[a-f0-9]{32}\/code\/|\/opt\/nonverba-tools\/priors-derivation-0\.1\/node_modules\/(?:parse5|entities)\/)/u.test(r.path),'MATCHED_INPUT_SOURCE_SCOPE');}
  for(const k of['run_entry_ref','custody_entry_ref','projection_entry_ref','checker_entry_ref'])check(e.source_refs.some(r=>same(r,a[k])),'MATCHED_INPUT_SOURCE_MEMBERSHIP');
  check(n?.schema==='focal-context-exit-pending-v1'&&n.status==='PENDING_EXTERNAL_ROOT_EXIT_READBACK'&&n.own_exit_claimed===false&&same(n.actor,c.original_actor)&&n.boot_id===c.boot_id&&n.origin_ns===c.origin_ns&&n.initial_active_carry_ms===c.initial_active_carry_ms,'MATCHED_INPUT_CONTEXT_ACTOR');
  for(const v of[n,m])for(const[k,r]of Object.entries({admission_ref:p.context_admission_ref,manifest_ref:p.context_manifest_ref,source_epoch_ref:p.context_source_epoch_ref,guard_ref:p.guard_ref})){if(v===m&&k==='manifest_ref')continue;check(same(v[k],r),'MATCHED_INPUT_CONTEXT_LINK');}
  check(m?.schema==='focal-context-output-manifest-v1'&&m.status==='PREPARED_CONTEXT_PROJECTIONS_PENDING_EXTERNAL_EXIT'&&same(m.failed_available,old.failed_available)&&m.manual_reader_opening===false&&m.model_access===false,'MATCHED_INPUT_CONTEXT_MANIFEST');closedAuthority(m);
  check(Array.isArray(c.cases)&&c.cases.length===2&&Array.isArray(m.cases)&&m.cases.length===2&&Array.isArray(summaries)&&summaries.length===2&&Array.isArray(p.projection_inputs)&&p.projection_inputs.length===2,'MATCHED_INPUT_CASE_COUNT');
  const cases=CASES.map((binding,i)=>{
    const b=p.baseline_inputs[i],slot=p.projection_inputs[i],cc=c.cases[i],mc=m.cases[i],s=summaries[i],audit=Number(binding.audit_id.slice(-4));
    check(b.audit_number===audit&&b.case_id===binding.case_id&&slot.audit_number===audit&&slot.case_id===binding.case_id&&cc.audit_number===audit&&cc.case_id===binding.case_id&&same(ids(mc),ids(binding)),'MATCHED_INPUT_CASE_ORDER');
    artifactRef(b.baseline_ref,Q15+'/outputs/'+binding.audit_id+'/baseline.json.gz');artifactRef(slot.projection_ref,Q17+'/outputs/'+binding.audit_id+'/projection.json.gz');ref(b.summary_ref,65536);ref(slot.summary_ref,65536);
    check(b.summary_ref.path===Q15+'/outputs/'+binding.audit_id+'/summary.json'&&slot.summary_ref.path===Q17+'/outputs/'+binding.audit_id+'/summary.json'&&b.baseline_ref.decoded_bytes+slot.projection_ref.decoded_bytes<=33554432,'MATCHED_INPUT_CASE_BOUNDS');
    for(const v of[cc,mc])check(same(v.baseline_ref,b.baseline_ref)&&same(v.projection_ref,slot.projection_ref)&&same(v.summary_ref,slot.summary_ref)&&v.input_decoded_bytes===b.baseline_ref.decoded_bytes&&v.output_decoded_bytes===slot.projection_ref.decoded_bytes+slot.summary_ref.bytes,'MATCHED_INPUT_CASE_REFS');
    check(s?.schema==='fixed-source-focal-context-summary-v1'&&s.audit_number===audit&&s.case_id===binding.case_id&&s.baseline_ref_sha256===b.baseline_ref.sha256&&s.source_sha256===SOURCE&&s.input_decoded_bytes===b.baseline_ref.decoded_bytes&&s.output_projection_decoded_bytes===slot.projection_ref.decoded_bytes&&same(s.context,cc.context),'MATCHED_INPUT_CONTEXT_SUMMARY');closedAuthority(s);
    check(s.context.context_adequate===null&&s.context.governance_verified===false&&s.context.semantic_completeness_verified===false&&s.context.quality_gate_pass===false&&s.context.authority==='NONE','MATCHED_INPUT_NO_CONTEXT_CLAIM');
    return{binding,row:ROWS[i],baseline_ref:b.baseline_ref,projection_ref:slot.projection_ref,summary_ref:slot.summary_ref,baseline_summary_ref:b.summary_ref};
  });
  check(closed?.schema==='ROOT-focal-context-clock-closed-v1'&&closed.source_context_clock_closed===true&&same(closed.completion_ref,p.context_completion_ref)&&same(closed.execution_ref,p.context_terminal_ref)&&closed.source_context_active_ms_charged===998290&&closed.charged_pilot_bytes===389448731&&closed.cumulative_private_and_metadata_capture_bytes===543445&&closed.cumulative_journal_rows===3762&&closed.cumulative_journal_bytes===1379113&&closed.unused_reservations_not_refunded===true&&closed.failed_available0048_not_replaced===true,'MATCHED_INPUT_CONTEXT_CLOSED');closedAuthority(closed);
  check(terminal?.schema==='ROOT-focal-context-execution-v1'&&same(terminal.admission_ref,p.context_admission_ref)&&terminal.run_exit===0&&terminal.checker_exit===0&&terminal.run_signal===null&&terminal.checker_signal===null&&terminal.run_error===null&&terminal.checker_error===null&&same(terminal.checker_receipt?.proof,p.context_completion_ref)&&terminal.quality_gate_pass===false,'MATCHED_INPUT_CONTEXT_TERMINAL');
  check(followup?.schema==='ROOT-focal-context-terminal-followup-v1'&&followup.status==='SOURCE_CONTEXT_CLOCK_CLOSED_DASHBOARD_REFRESH_CONFIRMED'&&same(followup.clock_close_ref,p.context_closed_ref)&&same(followup.later_review_clock_close_ref,p.review_closed_ref)&&followup.charged_pilot_bytes===389448731&&followup.source_active_ms_closed===998290&&followup.goal_complete===false,'MATCHED_INPUT_CONTEXT_FOLLOWUP');closedAuthority(followup);
  return cases;
}
function reviewJoin(p,{closed:c,terminal,declaration:d,observations:o,audit,final_copy:copy}){
  check(c?.schema==='ROOT-focal-context-review-reading-closed-v1'&&c.status==='EXPLORATORY_AGENT_READING_DECLARED_NO_FURTHER_PUBLICATION'&&c.source_clock_closed===true&&same(c.agent_declaration_ref,p.review_declaration_ref)&&same(c.agent_observations_ref,p.review_observations_ref)&&c.audit_id===CASES[1].audit_id&&c.agent_actual_reading_declared===true&&c.ROOT_complete_source_documents_read===false&&c.ROOT_independent_attestation_of_reading===false,'MATCHED_INPUT_REVIEW_CLOSED');
  for(const v of[d,o]){check(same(ids(v),ids(CASES[1]))&&v.source_sha256===SOURCE&&v.reviewer===c.reviewer&&same(v.admission_ref,c.admission_ref)&&same(v.source_epoch_ref,c.source_epoch_ref)&&v.agent_exploratory_only===true&&v.formal_coding_authority===false&&v.all_three_documents_actually_read===true,'MATCHED_INPUT_REVIEW_DECLARATION');closedAuthority(v);}
  check(d.schema==='focal-context-review-agent-declaration-v1'&&o.schema==='focal-context-review-agent-observations-v1'&&d.page_count===33&&d.nonzero_native_exits===0&&d.no_reread_or_skipped_page===true&&d.one_source_page_per_tool_call===true&&Array.isArray(d.pages)&&d.pages.length===33&&new Set(d.pages.map(r=>r.chunk_id)).size===33&&d.pages.every(r=>typeof r.chunk_id==='string'&&r.chunk_id.length>0&&r.native_exit===0),'MATCHED_INPUT_REVIEW_PAGES');
  const specs=[['focal_text',1,1796],['raw_full',21,111801],['finite9_parent',11,65870]];
  check(Array.isArray(d.documents)&&d.documents.length===3&&Array.isArray(c.documents)&&c.documents.length===3,'MATCHED_INPUT_REVIEW_DOCUMENTS');let at=0;
  for(let i=0;i<3;i++){const[name,n,end]=specs[i],doc=d.documents[i],cc=c.documents[i];check(doc.name===name&&doc.page_count===n&&doc.complete_reading_declared===true&&doc.start_utf16===0&&doc.end_utf16===end&&doc.full_document_utf16_length===end&&doc.terminal_has_more===false&&cc.name===name&&cc.complete===true&&cc.end===end&&cc.length===end&&cc.page_index===n&&doc.full_document_sha256===cc.ref.decoded_sha256,'MATCHED_INPUT_REVIEW_DOCUMENT');let start=0;for(let k=1;k<=n;k++){const r=d.pages[at++];check(r.document===name&&r.page_index===k&&r.start_utf16===start&&int(r.end_utf16,start+1,end)&&hash(r.page_body_sha256),'MATCHED_INPUT_REVIEW_RANGE');start=r.end_utf16;}check(start===end,'MATCHED_INPUT_REVIEW_TERMINAL_RANGE');}
  check(c.viewed_pages===33&&c.distinct_tool_chunks===33&&c.visible_reply_bytes===233043&&c.source_active_ms_charged===p.initial_source_active_ms&&c.charged_pilot_bytes===p.prior_charged_bytes&&c.cumulative_capture_bytes===p.initial_capture_bytes&&c.cumulative_journal_rows===p.initial_journal_rows&&c.cumulative_journal_bytes===p.initial_journal_bytes&&c.unused_reservations_not_refunded===true&&c.fresh_protected_rows===100&&c.fresh_protected_CIDs===29&&c.case0048_failure_retained===true&&c.materiality_holds_cleared===0,'MATCHED_INPUT_REVIEW_CARRY');closedAuthority(c);
  check(terminal?.schema==='ROOT-focal-context-review-terminal-followup-v1'&&terminal.status==='SOURCE_REVIEW_CLOCK_CLOSED_DASHBOARD_REFRESH_CONFIRMED_NO_FURTHER_PUBLICATION'&&same(terminal.clock_close_ref,p.review_closed_ref)&&same(terminal.prior_projection_terminal_ref,p.context_followup_ref)&&terminal.source_active_ms_closed===p.initial_source_active_ms&&terminal.charged_pilot_bytes===p.prior_charged_bytes&&terminal.cumulative_capture_bytes===p.initial_capture_bytes&&terminal.cumulative_journal_rows===p.initial_journal_rows&&terminal.cumulative_journal_bytes===p.initial_journal_bytes&&terminal.formal_coding_changed===false&&terminal.materiality_holds_cleared===0&&terminal.goal_complete===false,'MATCHED_INPUT_REVIEW_TERMINAL');closedAuthority(terminal);
  const v=audit?.verified;check(audit?.schema==='ROOT-focal-context-review-independent-metadata-audit-v1'&&audit.status==='PASS_FINITE_METADATA_ONLY'&&Array.isArray(audit.refs)&&[p.review_closed_ref,c.reading_journal_ref,p.review_declaration_ref,p.review_observations_ref].every(r=>audit.refs.some(s=>same(r,s)))&&v?.unique_page_chunks===33&&same(v.coverage_pages,[1,21,11])&&v.all_ranges_contiguous===true&&v.all_terminal===true&&v.all_declared_native_exits===0&&v.all_supplied_receipts_match===true&&v.visible_reply_bytes===233043&&v.charged_pilot_bytes===p.prior_charged_bytes&&v.source_active_ms_charged===p.initial_source_active_ms&&audit.source_documents_opened===false&&audit.semantic_quality_judged===false&&audit.independent_reading_attestation===false&&audit.materiality_holds_cleared===0&&audit.goal_complete===false,'MATCHED_INPUT_REVIEW_AUDIT');closedAuthority(audit);
  check(copy?.schema==='ROOT-context-post-result-source-copy-cost-v1'&&copy.reserved_bytes===16777216&&int(copy.bytes,1,copy.reserved_bytes)&&copy.reservation_first_charged_in_preserved_failed_Q16===true&&copy.carried_through_Q17_and_Q18===true&&copy.reservation_used_once_for_this_dashboard_refresh===true&&copy.unused_reservation_not_refunded===true&&same(terminal.post_result_copy_ref,p.prior_final_copy_ref),'MATCHED_INPUT_PRIOR_COPY');
}

/** SOURCE_FREE structural controls only. The strict actual route below also
 * authenticates both policy identities. A successful check grants no IO. */
export function checkMatchedInputMetadata({policy:p,context,review,baseline_summaries,guard}={}){
  check(p?.QA_root===Q19&&same(p.source_metadata_bindings,CASES)&&p.source_sha256===SOURCE&&p.manual_reader_opening===false&&p.model_access===false&&p.tokenizer_access===false&&p.quality_gate_pass===false&&p.authority==='NONE','MATCHED_INPUT_POLICY_SCOPE');
  check(p.initial_source_active_ms===1573333&&p.prior_charged_bytes===389898199&&p.initial_capture_bytes===842024&&p.initial_journal_rows===3795&&p.initial_journal_bytes===1404547,'MATCHED_INPUT_POLICY_CARRY');
  check(p.new_source_copy_reservation_bytes===33554432&&p.post_result_source_copy_reservation_bytes===16777216&&p.base_charged_bytes===440229847&&p.base_charged_bytes===p.prior_charged_bytes+p.new_source_copy_reservation_bytes+p.post_result_source_copy_reservation_bytes&&p.combined_prospective_cap===469762048&&p.prior_snapshot_reservation_already_used===true&&p.all_historical_caps_unchanged===true&&p.unused_reservations_not_refunded===true,'MATCHED_INPUT_POLICY_RESERVES');
  for(const[group,map]of[[context,CONTEXT_REFS],[review,REVIEW_REFS]])for(const[k,rk]of Object.entries(map)){ref(p[rk]);check(p[rk].path.startsWith(ROOTS[group===context?'context':'review']+'/'),'MATCHED_INPUT_METADATA_SCOPE');pinned(group?.[k],p[rk],262144,group===review&&k==='observations');}
  pinned(guard,p.guard_ref);guardCheck(guard);check(Array.isArray(baseline_summaries)&&baseline_summaries.length===2&&Array.isArray(context.summaries)&&context.summaries.length===2,'MATCHED_INPUT_SUMMARIES');
  check(Array.isArray(p.baseline_inputs)&&p.baseline_inputs.length===2&&Array.isArray(p.projection_inputs)&&p.projection_inputs.length===2,'MATCHED_INPUT_SLOTS');
  check(same(p.baseline_summary_refs,p.baseline_inputs.map(s=>s.summary_ref))&&same(p.context_summary_refs,p.projection_inputs.map(s=>s.summary_ref)),'MATCHED_INPUT_SUMMARY_REF_LISTS');
  baseline_summaries.forEach((s,i)=>pinned(s,p.baseline_inputs[i].summary_ref,65536));context.summaries.forEach((s,i)=>pinned(s,p.projection_inputs[i].summary_ref,65536));
  const cases=contextJoin(p,context);reviewJoin(p,review);
  return immutableCopy({cases,guard,failed_available:p.failed_available,prior_context_refs:Object.fromEntries(Object.entries(CONTEXT_REFS).map(([k,v])=>[k,p[v]])),prior_review_refs:Object.fromEntries(Object.entries(REVIEW_REFS).map(([k,v])=>[k,p[v]])),authority:'NONE',actual_io_authority:false,semantic_review_adopted:false});
}
export function validateMatchedInputCustody(args){
  check(args?.policy&&digest(args.policy)===POLICY_SHA256,'MATCHED_INPUT_PINNED_POLICY');
  check(args.context?.policy&&digest(args.context.policy)===CONTEXT_POLICY_SHA256,'MATCHED_INPUT_PINNED_CONTEXT_POLICY');
  return checkMatchedInputMetadata(args);
}

/** Structural decoded-pair controls. Strict actual use must call the next
 * export; neither route opens encoded refs or grants payload-read authority. */
export function checkMatchedInputPair({policy:p,slot,baseline:b,projection:w,baseline_summary,projection_summary:s}={}){
  checkBaselineArtifact({artifact:b,binding:slot.binding,row:slot.row,summary:baseline_summary});
  const baselineBytes=Buffer.from(JSON.stringify(b)),wrapperBytes=J(w);
  check(baselineBytes.length===slot.baseline_ref.decoded_bytes&&sha(baselineBytes)===slot.baseline_ref.decoded_sha256&&wrapperBytes.length===slot.projection_ref.decoded_bytes&&sha(wrapperBytes)===slot.projection_ref.decoded_sha256&&baselineBytes.length+wrapperBytes.length<=33554432,'MATCHED_INPUT_DECODED_PAIR_PIN');
  const header={schema:'fixed-source-focal-context-result-v1',...ids(slot.binding),baseline_ref:slot.baseline_ref,prior_completion_ref:PRIOR_COMPLETION_REF,source_epoch_ref:p.context_source_epoch_ref,policy_ref:p.context_policy_ref,projection:w.projection,quality_gate_pass:false,authority:'NONE'};
  check(same(w,header),'MATCHED_INPUT_PROJECTION_WRAPPER');
  verifyFocalContext({artifact:w.projection,extraction:b.extraction,focal_id:slot.row.focal_id,limits:CONTEXT_LIMITS});
  const metadata=summarizeFocalContext(w.projection),summary={schema:'fixed-source-focal-context-summary-v1',audit_number:Number(slot.binding.audit_id.slice(-4)),case_id:slot.binding.case_id,baseline_ref_sha256:slot.baseline_ref.sha256,source_sha256:SOURCE,context:metadata,input_decoded_bytes:baselineBytes.length,output_projection_decoded_bytes:wrapperBytes.length,quality_gate_pass:false,authority:'NONE'};
  check(same(s,summary),'MATCHED_INPUT_PROJECTION_SUMMARY');pinned(s,slot.summary_ref,65536);
  return true;
}
export function verifyMatchedInputPair(args){
  check(args?.policy&&digest(args.policy)===POLICY_SHA256,'MATCHED_INPUT_PINNED_POLICY');
  const i=CASES.findIndex(b=>same(b,args.slot?.binding));check(i>=0&&same(args.slot.row,ROWS[i]),'MATCHED_INPUT_FIXED_CASE');
  const p=args.policy,slot=args.slot;check(same(slot.baseline_ref,p.baseline_inputs[i].baseline_ref)&&same(slot.projection_ref,p.projection_inputs[i].projection_ref)&&same(slot.summary_ref,p.projection_inputs[i].summary_ref)&&same(slot.baseline_summary_ref,p.baseline_inputs[i].summary_ref),'MATCHED_INPUT_ALLOWLIST_SLOT');
  verifyBaselineArtifact({artifact:args.baseline,binding:slot.binding,row:slot.row,summary:args.baseline_summary});
  return checkMatchedInputPair(args);
}
