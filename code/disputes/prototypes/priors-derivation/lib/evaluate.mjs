// SPDX-License-Identifier: AGPL-3.0-only
// Structural admission and an explicit human-review schedule, not a prior solver.
const DRAFT_STATUS = 'AGENT_DRAFT_REQUIRES_OWNER_REVIEW';
const SCOPES = new Set(['interpretation', 'shortfall', 'remedy', 'procedure']);
const normalize = (value) => typeof value === 'string' ? value.normalize('NFC').replace(/\s+/gu, ' ').trim() : '';
const isText = (value) => typeof value === 'string' && normalize(value).length > 0;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const wordCount = (value) => normalize(value).split(' ').filter(Boolean).length;
const unique = (values) => [...new Set(values)];
const list = (value) => Array.isArray(value) ? value : [];

function addError(errors, code, path, message) { errors.push({ code, path, message }); }

function textList(value, path, errors, { optional = false } = {}) {
  if (optional && value == null) return;
  if (!Array.isArray(value) || value.length === 0) { addError(errors, 'REQUIRED_TEXT_LIST', path, 'Supply a nonempty list of explicit research statements.'); return; }
  value.forEach((item, index) => { if (!isText(item)) addError(errors, 'REQUIRED_TEXT', `${path}[${index}]`, 'Statement must be nonempty text.'); });
}

function indexContext(values, name, errors) {
  const result = new Map();
  if (!Array.isArray(values)) { addError(errors, 'CONTEXT_ARRAY_REQUIRED', name, `${name} must be an array of exact source records.`); return result; }
  values.forEach((value, index) => {
    const path = `${name}[${index}]`;
    if (!isObject(value) || !isText(value.id)) { addError(errors, 'CONTEXT_ID_REQUIRED', path, 'Record requires a nonempty id.'); return; }
    if (result.has(value.id)) { addError(errors, 'DUPLICATE_CONTEXT_ID', `${path}.id`, `Repeated ${name} id ${value.id}.`); return; }
    result.set(value.id, value);
    if (name === 'clauses' && !isText(value.text)) addError(errors, 'CLAUSE_TEXT_REQUIRED', `${path}.text`, 'A citation needs its exact extracted clause text.');
  });
  return result;
}

function membershipIndex(clusters, assignments, clauseMap, errors) {
  const result = new Map();
  const add = (clusterId, ids, partition, path) => {
    if (ids == null) return;
    if (!Array.isArray(ids)) { addError(errors, 'MEMBERSHIP_ARRAY_REQUIRED', path, 'Cluster membership must be a list of known clause ids.'); return; }
    const seen = new Set();
    for (const [index, id] of ids.entries()) {
      if (!isText(id) || !clauseMap.has(id)) { addError(errors, 'UNKNOWN_CLUSTER_MEMBER', `${path}[${index}]`, `Unknown clause id ${String(id)} in cluster ${clusterId}.`); continue; }
      if (seen.has(id)) addError(errors, 'DUPLICATE_CLUSTER_MEMBER', `${path}[${index}]`, `Repeated clause id ${id} in membership list.`);
      seen.add(id);
      const key = JSON.stringify([clusterId, id]);
      if (result.has(key) && result.get(key) !== partition) addError(errors, 'MEMBERSHIP_PARTITION_CONFLICT', path, `${id} is described as both fit and holdout in cluster ${clusterId}.`);
      else result.set(key, partition);
    }
  };
  for (const [id, cluster] of clusters) {
    add(id, cluster.member_ids, 'fit', `clusters.${id}.member_ids`);
    add(id, cluster.holdout_member_ids, 'holdout', `clusters.${id}.holdout_member_ids`);
    if (isObject(cluster.holdout_support)) add(id, cluster.holdout_support.member_ids, 'holdout', `clusters.${id}.holdout_support.member_ids`);
  }
  if (!Array.isArray(assignments)) { addError(errors, 'ASSIGNMENTS_ARRAY_REQUIRED', 'assignments', 'Optional assignments must be an array.'); return result; }
  const seenAssignments = new Set();
  assignments.forEach((assignment, index) => {
    const path = `assignments[${index}]`;
    if (!isObject(assignment) || !clauseMap.has(assignment.clause_id) || !clusters.has(assignment.cluster_id)) { addError(errors, 'UNKNOWN_ASSIGNMENT_REFERENCE', path, 'Assignment must identify an existing clause and cited cluster.'); return; }
    if (!['fit', 'holdout'].includes(assignment.partition)) { addError(errors, 'ASSIGNMENT_PARTITION_REQUIRED', `${path}.partition`, 'Assignment partition must be fit or holdout.'); return; }
    const key = JSON.stringify([assignment.cluster_id, assignment.clause_id]);
    if (seenAssignments.has(key)) addError(errors, 'DUPLICATE_ASSIGNMENT', path, 'Repeated clause/cluster assignment.');
    seenAssignments.add(key);
    if (result.has(key) && result.get(key) !== assignment.partition) addError(errors, 'MEMBERSHIP_PARTITION_CONFLICT', path, 'Assignment conflicts with the cluster membership partition.');
    else result.set(key, assignment.partition);
  });
  return result;
}

/**
 * Admit complete draft cards and real source references. This checks structure,
 * membership and optional excerpt bytes; it does not verify a normative argument.
 */
export function validateCandidates(candidates, { clauses = [], clusters = [], assignments = [] } = {}) {
  const errors = [];
  const clauseMap = indexContext(clauses, 'clauses', errors);
  const clusterMap = indexContext(clusters, 'clusters', errors);
  const membership = membershipIndex(clusterMap, assignments, clauseMap, errors);
  const input = Array.isArray(candidates) ? candidates : [];
  if (!Array.isArray(candidates)) addError(errors, 'CANDIDATES_ARRAY_REQUIRED', 'candidates', 'Candidate cards must be an array.');
  const candidateIds = new Set();
  input.forEach((candidate, index) => {
    if (isObject(candidate) && isText(candidate.id)) {
      if (candidateIds.has(candidate.id)) addError(errors, 'DUPLICATE_CANDIDATE_ID', `candidates[${index}].id`, `Repeated candidate id ${candidate.id}.`);
      candidateIds.add(candidate.id);
    }
  });
  const checks = [];
  input.forEach((candidate, index) => {
    const path = `candidates[${index}]`;
    const errorStart = errors.length;
    if (!isObject(candidate)) { addError(errors, 'CANDIDATE_OBJECT_REQUIRED', path, 'Candidate must be an explicit draft card.'); checks.push({ id: null, index, structurally_complete: false }); return; }
    for (const field of ['id', 'name', 'declaration']) if (!isText(candidate[field])) addError(errors, 'REQUIRED_TEXT', `${path}.${field}`, `${field} must be nonempty text.`);
    if (candidate.status !== DRAFT_STATUS) addError(errors, 'DRAFT_STATUS_REQUIRED', `${path}.status`, `Candidate status must be ${DRAFT_STATUS}; structural admission cannot adopt a catalog.`);
    const scope = typeof candidate.scope === 'string' ? [candidate.scope] : candidate.scope;
    if (!Array.isArray(scope) || !scope.length || scope.some((value) => !SCOPES.has(value)) || new Set(scope).size !== scope.length) addError(errors, 'EXPLICIT_SCOPE_REQUIRED', `${path}.scope`, 'Declare one or more distinct scopes from interpretation, shortfall, remedy and procedure.');
    if (!isObject(candidate.contrast) || !isText(candidate.contrast.higher) || !isText(candidate.contrast.lower)) addError(errors, 'CONTRAST_REQUIRED', `${path}.contrast`, 'State what higher and lower emphasis would mean with the same facts.');
    else if (normalize(candidate.contrast.higher) === normalize(candidate.contrast.lower)) addError(errors, 'IDENTICAL_CONTRAST', `${path}.contrast`, 'Higher and lower emphasis cannot be identical statements.');
    textList(candidate.boundaries, `${path}.boundaries`, errors);
    textList(candidate.domain_limits, `${path}.domain_limits`, errors);
    if (!Array.isArray(candidate.nearest_confusions) || !candidate.nearest_confusions.length) addError(errors, 'CONFUSIONS_REQUIRED', `${path}.nearest_confusions`, 'Identify at least one neighboring idea and a distinction to investigate.');
    else candidate.nearest_confusions.forEach((confusion, confusionIndex) => {
      const confusionPath = `${path}.nearest_confusions[${confusionIndex}]`;
      if (isText(confusion)) return;
      if (!isObject(confusion) || !isText(confusion.difference)) { addError(errors, 'CONFUSION_DIFFERENCE_REQUIRED', confusionPath, 'A neighboring-idea object needs a nonempty difference statement.'); return; }
      if (confusion.candidate_id != null && (!candidateIds.has(confusion.candidate_id) || confusion.candidate_id === candidate.id)) addError(errors, 'UNKNOWN_CONFUSION_CANDIDATE', `${confusionPath}.candidate_id`, 'Reference another known candidate, or use a descriptive conceptual name.');
      if (!isText(confusion.name) && confusion.candidate_id == null) addError(errors, 'CONFUSION_ID_REQUIRED', confusionPath, 'Name the neighboring idea or identify another candidate.');
    });
    const seenSupport = new Set();
    const resolvedSupport = [];
    if (!Array.isArray(candidate.support) || !candidate.support.length) addError(errors, 'SUPPORT_REQUIRED', `${path}.support`, 'Cite at least one source clause and explain its relationship to the hypothesis.');
    else candidate.support.forEach((support, supportIndex) => {
      const supportPath = `${path}.support[${supportIndex}]`;
      if (!isObject(support)) { addError(errors, 'SUPPORT_OBJECT_REQUIRED', supportPath, 'Support requires clause_id, cluster_id and a grounded explanatory reason.'); return; }
      const key = JSON.stringify([support.cluster_id, support.clause_id]);
      if (seenSupport.has(support.clause_id)) addError(errors, 'DUPLICATE_SUPPORT_ID', supportPath, 'A source clause must not be counted twice in one candidate, including citations through different clustering runs.');
      seenSupport.add(support.clause_id);
      const clause = clauseMap.get(support.clause_id);
      if (!clause) addError(errors, 'UNKNOWN_SUPPORT_CLAUSE', `${supportPath}.clause_id`, `Unknown clause ${String(support.clause_id)}.`);
      if (!clusterMap.has(support.cluster_id)) addError(errors, 'UNKNOWN_SUPPORT_CLUSTER', `${supportPath}.cluster_id`, `Unknown cluster ${String(support.cluster_id)}.`);
      const partition = membership.get(key);
      if (clause && clusterMap.has(support.cluster_id) && !partition) addError(errors, 'SUPPORT_OUTSIDE_CLUSTER', supportPath, 'Cited clause is not in the cited cluster fit or explicitly supplied holdout assignment.');
      if (support.partition != null && support.partition !== partition) addError(errors, 'SUPPORT_PARTITION_MISMATCH', `${supportPath}.partition`, 'Declared support partition must match retained cluster membership.');
      if (!isText(support.reason) || wordCount(support.reason) < 8) addError(errors, 'GROUNDED_REASON_REQUIRED', `${supportPath}.reason`, 'Supply an explanatory reason of at least eight words tied to this exact source; a label alone is insufficient.');
      if (support.excerpt != null && (!isText(support.excerpt) || !clause || !normalize(clause.text).includes(normalize(support.excerpt)))) addError(errors, 'EXCERPT_NOT_IN_SOURCE', `${supportPath}.excerpt`, 'Optional excerpt must occur in the normalized cited clause text.');
      if (clause && partition) resolvedSupport.push({ clause_id: clause.id, cluster_id: support.cluster_id, partition, contract_id: clause.contract_id, duplicate_family: clause.duplicate_family ?? clause.family_id ?? null, excerpt_checked: support.excerpt != null });
    });
    if (!Array.isArray(candidate.counterexamples) || !candidate.counterexamples.length) addError(errors, 'COUNTEREXAMPLES_REQUIRED', `${path}.counterexamples`, 'Include an explicit challenge, irrelevant situation or limit of the proposed meaning.');
    else candidate.counterexamples.forEach((counterexample, counterIndex) => {
      const counterPath = `${path}.counterexamples[${counterIndex}]`;
      if (isText(counterexample)) return;
      if (!isObject(counterexample) || !isText(counterexample.reason ?? counterexample.challenge)) { addError(errors, 'COUNTEREXAMPLE_REASON_REQUIRED', counterPath, 'A counterexample object needs a reason or challenge statement.'); return; }
      if (counterexample.clause_id != null && !clauseMap.has(counterexample.clause_id)) addError(errors, 'UNKNOWN_COUNTEREXAMPLE_CLAUSE', `${counterPath}.clause_id`, 'Counterexample references an unknown source clause.');
      if (counterexample.cluster_id != null && !clusterMap.has(counterexample.cluster_id)) addError(errors, 'UNKNOWN_COUNTEREXAMPLE_CLUSTER', `${counterPath}.cluster_id`, 'Counterexample references an unknown cluster.');
      if (counterexample.clause_id != null && counterexample.cluster_id != null && clauseMap.has(counterexample.clause_id) && clusterMap.has(counterexample.cluster_id) && !membership.has(JSON.stringify([counterexample.cluster_id, counterexample.clause_id]))) addError(errors, 'COUNTEREXAMPLE_OUTSIDE_CLUSTER', counterPath, 'Counterexample clause is not in its declared cluster.');
    });
    checks.push({ id: candidate.id ?? null, index, structurally_complete: errors.length === errorStart && !errors.some((error) => error.path === `${path}.id`), status: DRAFT_STATUS, scope: Array.isArray(scope) ? scope : [], resolved_support: resolvedSupport, source_check: 'KNOWN_IDS_MEMBERSHIP_AND_OPTIONAL_EXCERPTS_ONLY', semantic_meaning_validated: false });
  });
  if (errors.some((error) => !error.path.startsWith('candidates['))) for (const check of checks) check.structurally_complete = false;
  return { valid: errors.length === 0, status: errors.length ? 'INVALID_DRAFT_STRUCTURE' : input.length ? 'STRUCTURALLY_COMPLETE_DRAFTS' : 'NO_CANDIDATES_SUBMITTED', candidate_status: DRAFT_STATUS, candidate_count: input.length, structurally_complete_count: checks.filter((check) => check.structurally_complete).length, candidate_checks: checks, errors, authority: 'NONE', adopted_catalog: false, semantic_meaning_validated: false, limitation: 'Admission checks that required research statements and real source references are present. It does not establish truthful reasons, appropriate scope, fairness, useful priors or equivalent interpretations.' };
}

function reportAssignments(report) {
  if (report.assignments != null) return report.assignments;
  if (report.cluster_assignments != null) return report.cluster_assignments;
  const known = new Set(list(report.clusters).filter(isObject).map((cluster) => cluster.id));
  return list(report.discovery?.runs).filter(isObject).flatMap((run) => list(run.assignments)).filter((assignment) => isObject(assignment) && known.has(assignment.cluster_id));
}

function inspectProbes(probes) {
  const errors = [];
  if (!isObject(probes) || probes.data_classification !== 'DECLARED_SYNTHETIC' || !Array.isArray(probes.pairs)) return { valid: false, errors: [{ code: 'SYNTHETIC_PROBE_PACKET_REQUIRED', path: 'probes', message: 'Require an explicitly synthetic packet with a pairs array.' }], pairs: [] };
  const pairIds = new Set();
  const situationIds = new Set();
  probes.pairs.forEach((pair, index) => {
    const path = `probes.pairs[${index}]`;
    if (!isObject(pair) || !isText(pair.id) || pairIds.has(pair.id)) { addError(errors, 'PROBE_PAIR_ID_REQUIRED', path, 'Probe pair needs a distinct nonempty id.'); return; }
    pairIds.add(pair.id);
    if (!isObject(pair.assignment_contract) || !isText(pair.assignment_contract.task) || !isText(pair.assignment_contract.acceptance)) addError(errors, 'SHARED_ASSIGNMENT_TERMS_REQUIRED', `${path}.assignment_contract`, 'Pair must retain shared task and acceptance terms.');
    if (!Array.isArray(pair.situations) || pair.situations.length !== 2) { addError(errors, 'PROBE_PAIR_SIZE', `${path}.situations`, 'A comparison pair needs two explicitly constructed situations.'); return; }
    const beneficiaries = new Set();
    const roles = new Set();
    pair.situations.forEach((situation, situationIndex) => {
      const situationPath = `${path}.situations[${situationIndex}]`;
      if (!isObject(situation) || !isText(situation.id) || situationIds.has(situation.id)) { addError(errors, 'PROBE_SITUATION_ID_REQUIRED', situationPath, 'Situation needs a distinct nonempty id.'); return; }
      situationIds.add(situation.id);
      if (!['Requester', 'Operator'].includes(situation.declarer_role)) addError(errors, 'PROBE_ROLE_REQUIRED', `${situationPath}.declarer_role`, 'Identify the hypothetical declaring party as Requester or Operator.');
      else roles.add(situation.declarer_role);
      if (!['declarer', 'counterparty'].includes(situation.potential_beneficiary)) addError(errors, 'PROBE_BENEFICIARY_REQUIRED', `${situationPath}.potential_beneficiary`, 'Identify a possible beneficiary as a hypothesis for review.');
      else beneficiaries.add(situation.potential_beneficiary);
      textList(situation.established_facts, `${situationPath}.established_facts`, errors);
      textList(situation.disputed_claims, `${situationPath}.disputed_claims`, errors);
      if (!Array.isArray(situation.unknowns) || situation.unknowns.some((value) => !isText(value))) addError(errors, 'PROBE_UNKNOWNS_REQUIRED', `${situationPath}.unknowns`, 'State unknowns explicitly, using an empty array when none are constructed.');
      if (!isText(situation.possible_invocation)) addError(errors, 'PROBE_INVOCATION_REQUIRED', `${situationPath}.possible_invocation`, 'Explain the possible argument to investigate without specifying an outcome.');
    });
    if (roles.size !== 1) addError(errors, 'PROBE_DECLARER_ROLE_CHANGED', `${path}.situations`, 'Keep the declaring role the same within the paired comparison.');
    if (beneficiaries.size !== 2) addError(errors, 'PROBE_COMMITMENT_CONTRAST_REQUIRED', `${path}.situations`, 'Retain one possible declarer-benefiting and one possible counterparty-benefiting invocation.');
  });
  return { valid: !errors.length, errors, pairs: probes.pairs };
}

/** Report what is inspectable and what still needs human interpretation. */
export function evaluateCandidateReview(candidates, report = {}, probes) {
  const sourceReport = isObject(report) ? report : {};
  const validation = validateCandidates(candidates, { clauses: sourceReport.clauses ?? [], clusters: sourceReport.clusters ?? [], assignments: reportAssignments(sourceReport) });
  const probeValidation = inspectProbes(probes);
  const input = Array.isArray(candidates) ? candidates.filter(isObject) : [];
  const supportDiversity = validation.candidate_checks.map((check) => {
    const supports = check.resolved_support ?? [];
    const contracts = unique(supports.map((support) => support.contract_id).filter(isText)).sort();
    const families = unique(supports.map((support) => support.duplicate_family).filter(isText)).sort();
    return { candidate_id: check.id, distinct_clause_count: unique(supports.map((support) => support.clause_id)).length, distinct_contract_count: contracts.length, contract_ids: contracts, distinct_duplicate_family_count: families.length, duplicate_family_ids: families, duplicate_family_metadata_missing: supports.filter((support) => !support.duplicate_family).length, fit_support_count: supports.filter((support) => support.partition === 'fit').length, holdout_support_count: supports.filter((support) => support.partition === 'holdout').length, interpretation: 'Observed support diversity only; independent drafting, representativeness and normative suitability are not established.' };
  });
  const overlap = [];
  for (let left = 0; left < input.length; left += 1) {
    for (let right = left + 1; right < input.length; right += 1) {
      const a = new Set(list(input[left].support).filter(isObject).map((support) => support.clause_id).filter(isText));
      const b = new Set(list(input[right].support).filter(isObject).map((support) => support.clause_id).filter(isText));
      const shared = [...a].filter((id) => b.has(id) && isText(id)).sort();
      if (shared.length) overlap.push({ left_candidate_id: input[left].id, right_candidate_id: input[right].id, shared_clause_ids: shared, shared_fraction_of_union: shared.length / new Set([...a, ...b]).size, interpretation: 'Shared citations suggest a distinction to inspect; they do not prove redundant meanings.' });
    }
  }
  const reviewQuestions = input.flatMap((candidate) => [
    ['shared_meaning', 'Can ordinary participants explain this declaration and its higher/lower contrast using the same facts?'],
    ['source_reason', 'Does each cited clause support the explanatory reason in context, or is the claimed connection overstated?'],
    ['domain_transfer', 'Which corporate drafting assumptions fail when this idea is translated to a small assignment?'],
    ['nearest_confusion', 'Does the proposed distinction from neighboring candidates survive a recognizable disagreement?'],
    ['role_commitment', 'Can this same declared principle be honored when its relevant application favors the counterparty?'],
    ['facts_and_scope', 'Does the candidate keep established facts, uncertain claims, exact requirements and protected rights distinct?'],
    ['intended_effect', 'Are interpretation, shortfalls, remedies and procedural treatment separated clearly enough to state the intended scope?'],
  ].map(([topic, question]) => ({ id: `${candidate.id}:review:${topic}`, candidate_id: candidate.id, topic, question, status: 'UNANSWERED', response: null })));
  const schedule = input.flatMap((candidate) => (probeValidation.valid ? probeValidation.pairs : []).map((pair) => ({ candidate_id: candidate.id, probe_pair_id: pair.id, situation_ids: list(pair.situations).filter(isObject).map((situation) => situation.id), status: 'NOT_RUN', applicable: null, scope_metadata_overlap: (typeof candidate.scope === 'string' ? [candidate.scope] : list(candidate.scope)).some((scope) => list(pair.scopes_to_explore).includes(scope)), questions: ['Is this candidate relevant in either constructed situation? Explain irrelevance when appropriate.', 'Holding each situation\'s facts fixed, what distinction could higher rather than lower emphasis express?', 'If the consideration is relevant, does its meaning remain consistent across possible declarer and counterparty benefits?', 'Which source-supported observations, disputed claims and unknowns constrain that interpretation?', 'Would this interpretation silently change the shared scope, require unauthorized work, establish an unknown fact or override a protected right?'], response: null, limitation: 'Scope intersection schedules inspection only. No relevance, model judgment, payout or correct resolution has been computed.' })));
  return { version: 'nv-priors-derivation-human-review-prototype-v1', status: !validation.valid || !probeValidation.valid ? 'REVIEW_INPUT_INCOMPLETE' : input.length ? 'STRUCTURAL_REVIEW_READY_HUMAN_EVALUATION_NOT_RUN' : 'NO_CANDIDATES_SUBMITTED', authority: 'NONE', adopted_catalog: false, semantic_evaluation_status: 'NOT_RUN', structural_validation: validation, probe_validation: { valid: probeValidation.valid, errors: probeValidation.errors, pair_count: probeValidation.pairs.length, situation_count: probeValidation.pairs.reduce((count, pair) => count + list(pair?.situations).length, 0), data_classification: 'DECLARED_SYNTHETIC' }, support_diversity: supportDiversity, citation_overlap: overlap, unanswered_human_review_questions: reviewQuestions, probe_schedule: schedule, summary: { candidate_count: input.length, structurally_complete_count: validation.structurally_complete_count, scheduled_pair_reviews: schedule.length, semantic_checks_executed: 0, answered_human_questions: 0 }, limitations: ['No model, policy interpreter or settlement solver is invoked by this evaluation module.', 'Structural completeness does not establish shared meaning, source entailment, fairness, useful priors or resistance to gaming.', 'The synthetic situations are authored probes, not historical disputes, verified events or outcome ground truth.', 'Support diversity and citation overlap describe the retained sample, not independent evidence or catalog quality.', 'Every declared candidate remains an agent draft requiring owner review; no candidate count or original-five catalog is imposed.'] };
}
