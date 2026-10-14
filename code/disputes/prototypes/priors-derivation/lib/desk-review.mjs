// SPDX-License-Identifier: AGPL-3.0-only
// Checks the coverage of explicitly authored judgments; it never generates them.
export function validateDeskReview(notes, candidates, probes) {
  const errors=[];const text=value=>typeof value==='string'&&value.trim().length>0;
  const candidateIds=new Set(candidates.map(candidate=>candidate.id));
  const pairs=new Map(probes.pairs.map(pair=>[pair.id,pair]));
  if(notes?.status!=='AGENT_DESK_REVIEW_COMPLETED'||notes.human_evaluation!=='NOT_RUN'||notes.data_classification!=='DECLARED_SYNTHETIC'||!text(notes.reviewer)||!Array.isArray(notes.limitations)||!notes.limitations.length)errors.push('Declare the agent reviewer, synthetic classification, limitations and unperformed human evaluation.');
  const seen=new Set();const reviews=Array.isArray(notes?.reviews)?notes.reviews:[];
  if(!Array.isArray(notes?.reviews))errors.push('Authored pair reviews are required.');
  for(const [index,review] of reviews.entries()) {
    if(!review||typeof review!=='object'){errors.push(`Pair review ${index} must be an object.`);continue;}
    const key=JSON.stringify([review.candidate_id,review.probe_pair_id]);const pair=pairs.get(review.probe_pair_id);
    if(!candidateIds.has(review.candidate_id)||!pair||seen.has(key))errors.push(`Unknown or repeated candidate/probe reference at review ${index}.`);
    seen.add(key);
    if(!['DIRECT','INDIRECT','OUT_OF_SCOPE'].includes(review.relevance)||!['reason','role_consistency','confusions_or_limit'].every(field=>text(review[field])))errors.push(`Explain relevance, paired meaning and limitations at review ${index}.`);
    const expected=new Set(pair?.situations.map(situation=>situation.id)??[]);const actual=new Set();
    for(const situation of Array.isArray(review.situations)?review.situations:[]) {
      if(!situation||typeof situation!=='object'){errors.push(`Situation at review ${index} must be an object.`);continue;}
      if(!expected.has(situation.situation_id)||actual.has(situation.situation_id))errors.push(`Unknown or repeated situation at review ${index}.`);
      actual.add(situation.situation_id);
      if(!['higher_emphasis','lower_emphasis','evidence_limits','scope_guardrail'].every(field=>text(situation[field])))errors.push(`Retain both emphasis readings, evidence limits and scope guardrail at review ${index}.`);
    }
    if(actual.size!==2||[...expected].some(id=>!actual.has(id)))errors.push(`Both paired situations must be addressed at review ${index}.`);
  }
  for(const candidate of candidates)for(const pair of probes.pairs)if(!seen.has(JSON.stringify([candidate.id,pair.id])))errors.push(`Missing pair review: ${candidate.id} / ${pair.id}.`);
  return {valid:!errors.length,status:errors.length?'INCOMPLETE_AGENT_DESK_REVIEW':'AUTHORED_AGENT_PAIR_REVIEWS_RETAINED',candidate_count:candidates.length,pair_count:probes.pairs.length,recorded_pair_reviews:reviews.length,recorded_situation_readings:reviews.reduce((count,review)=>count+(Array.isArray(review?.situations)?review.situations.length:0),0),human_evaluation:'NOT_RUN',semantic_meaning_validated:false,source_entailment_validated:false,limitation:'This checks authored judgment coverage and references. The agent judgments remain contestable; no participant study, fairness score or adoption is established.',errors};
}
