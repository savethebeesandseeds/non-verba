const maxReportBytes = 25 * 1024 * 1024;
const reviewChoices = new Map();
let activeReport = null;
let activeTab = 'candidates';
let selectedCandidate = null;
let selectedFamily = null;
let searchText = '';
let pendingClause = null;
let loadedName = '';
let reportIndexes = new Map();

const list = (value) => Array.isArray(value) ? value : [];
const object = (value) => value != null && typeof value === 'object' && !Array.isArray(value) ? value : {};
const display = (value) => value == null ? '' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
const label = (value) => String(value).replaceAll('_', ' ');
const entries = (value) => Object.entries(object(value)).filter(([, item]) => item != null);
const pick = (...values) => values.find((value) => value != null && value !== '');
const unique = (values) => [...new Set(list(values).filter((value) => value != null).map(String))];
const describe = (value, keys) => value != null && typeof value === 'object'
  ? pick(...keys.map((key) => value[key]), display(value)) : display(value);

export function safeSourceUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function normalizeReport(input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input) || input.schema_version !== 1) {
    throw new Error('This lab expects a report object with schema_version: 1.');
  }
  const result = { ...input };
  for (const key of ['candidates', 'clusters', 'clauses', 'contracts']) {
    if (input[key] != null && !Array.isArray(input[key])) throw new Error(`${key} must be an array.`);
    result[key] = list(input[key]).map((item, index) => {
      if (item == null || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${key}[${index}] must be an object.`);
      return { ...item, id: display(item.id || `${key}-${index + 1}`) };
    });
    if (result[key].length > 50000) throw new Error(`${key} exceeds the 50,000 record review limit.`);
    if (new Set(result[key].map((item) => item.id)).size !== result[key].length) throw new Error(`${key} contains duplicate identifiers.`);
  }
  result.summary = object(input.summary);
  result.provenance = object(input.provenance);
  return result;
}

export function buildReviewExport(report, choices, now = new Date()) {
  return {
    schema_version: 1,
    artifact_type: 'priors_derivation_local_review',
    prototype: true,
    exported_at: now.toISOString(),
    report_reference: {
      title: report.title || 'Priors Derivation Lab',
      run_id: pick(report.run_id, report.provenance?.run_id) || null,
      candidate_ids: report.candidates.map((candidate) => candidate.id),
    },
    adoption_status: 'No priors are adopted by this review.',
    decisions: [...choices].map(([candidate_id, choice]) => ({ candidate_id, ...choice })),
  };
}

function el(tag, className = '', value = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = display(value);
  return node;
}
function add(parent, ...children) { parent.append(...children.filter(Boolean)); return parent; }
function paragraph(value, className = '') { return el('p', className, value); }
function button(text, onClick, className = '') {
  const node = el('button', className, text); node.type = 'button'; node.addEventListener('click', onClick); return node;
}
function textList(values, emptyText) {
  if (!list(values).length) return paragraph(emptyText, 'muted');
  return add(el('ul'), ...values.map((item) => el('li', '', describe(item, ['description', 'text', 'reason', 'name']))));
}
function emptyState(title, description) { return add(el('section', 'empty'), el('h2', '', title), paragraph(description)); }
function section(title, ...children) { return add(el('section', 'detail-section'), el('h3', '', title), ...children); }
function panel(title, ...children) { return add(el('section', 'panel'), el('h3', '', title), ...children); }
function record(value) {
  const pairs = entries(value);
  if (!pairs.length) return paragraph('No information recorded in this report.', 'muted');
  const rows = pairs.map(([key, item]) => {
    const content = typeof item === 'object' ? el('pre', 'nested-record', display(item)) : el('span', '', item);
    return add(el('div', 'kv-row'), el('dt', '', label(key)), add(el('dd'), content));
  });
  return add(el('dl', 'kv-list'), ...rows);
}
function indexFor(key) { return reportIndexes.get(key); }
function sourceLink(value) {
  const url = safeSourceUrl(value);
  if (!url) return el('span', 'muted', 'No verified source link');
  const link = el('a', 'source-link', 'Original contract ↗');
  link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  return link;
}
function contextBlock(clause) {
  const before = display(pick(clause.context_before, clause.context?.before));
  const after = display(pick(clause.context_after, clause.context?.after));
  const details = add(el('details', 'context'), el('summary', '', 'Context & source record'));
  if (before) add(details, el('h4', '', 'Before'), paragraph(before));
  if (after) add(details, el('h4', '', 'After'), paragraph(after));
  const facts = Object.fromEntries(['contract_id', 'heading', 'section', 'start', 'end', 'char_start', 'char_end', 'source_sha256', 'sha256', 'duplicate_group', 'source_path'].filter((key) => clause[key] != null).map((key) => [key, clause[key]]));
  if (entries(facts).length) add(details, record(facts));
  if (!before && !after) add(details, paragraph('Neighboring text is not recorded for this clause.'));
  return details;
}
function openFamily(id, clauseId = null) {
  selectedFamily = String(id); pendingClause = clauseId == null ? null : String(clauseId);
  activeTab = 'families'; searchText = ''; render();
}
function evidence(clauseId, { reason = null, clusterId = null } = {}) {
  const clause = indexFor('clauses').get(String(clauseId));
  if (!clause) return add(el('article', 'evidence'), paragraph(`Clause ${display(clauseId)} is missing from this report.`, 'muted'));
  const contract = indexFor('contracts').get(String(clause.contract_id));
  const heading = add(el('div', 'evidence-heading'), el('span', 'evidence-label', clause.id), sourceLink(pick(clause.source_url, contract?.source_url, contract?.url)));
  if (clusterId != null) heading.firstChild.append(button(`Family ${clusterId} →`, () => openFamily(clusterId, clause.id)));
  const card = add(el('article', 'evidence'), heading);
  card.id = `evidence-${clause.id.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`;
  add(card, paragraph(pick(contract?.title, contract?.name, clause.contract_id), 'evidence-title'));
  if (clause.heading) add(card, paragraph(clause.heading, 'evidence-title'));
  add(card, el('blockquote', '', pick(clause.text, clause.clause_text, '(Clause text was not recorded.)')));
  if (reason) add(card, paragraph(reason, 'reason'));
  add(card, contextBlock(clause));
  return card;
}
function heading(title, description, { searchLabel = null, update = null } = {}) {
  const result = add(el('div', 'view-heading'), add(el('div'), el('h2', '', title), paragraph(description)));
  if (searchLabel) {
    const input = el('input', 'search'); input.type = 'search'; input.id = 'research-search'; input.placeholder = 'Search names, concepts, evidence…'; input.value = searchText;
    input.addEventListener('input', () => { searchText = input.value; update(); });
    const text = el('label', '', searchLabel); text.htmlFor = input.id;
    add(result, add(el('div', 'search-wrap'), text, input));
  }
  return result;
}
function searchable(item) { return JSON.stringify(item).toLocaleLowerCase().includes(searchText.toLocaleLowerCase()); }

function reviewPanel(candidate) {
  const current = reviewChoices.get(candidate.id) || { decision: 'unreviewed', notes: '' };
  const wrapper = el('div', 'review-panel');
  const selectLabel = el('label', '', 'Your investigation decision'); selectLabel.htmlFor = 'review-decision';
  const select = el('select'); select.id = 'review-decision';
  for (const [value, text] of [['unreviewed', 'Unreviewed'], ['investigate', 'Keep investigating'], ['revise', 'Revise the declaration'], ['split', 'Explore splitting'], ['merge', 'Explore merging'], ['set_aside', 'Set aside for now']]) {
    const option = el('option', '', text); option.value = value; select.append(option);
  }
  select.value = current.decision;
  const notesLabel = el('label', '', 'Review notes'); notesLabel.htmlFor = 'review-notes';
  const notes = el('textarea'); notes.id = 'review-notes'; notes.value = current.notes;
  notes.placeholder = 'What would make this candidate clearer, distinct, or worth testing?';
  const save = () => {
    reviewChoices.set(candidate.id, { decision: select.value, notes: notes.value });
    document.getElementById('export-review').disabled = false;
  };
  select.addEventListener('change', save); notes.addEventListener('input', save);
  return add(wrapper, selectLabel, select, notesLabel, notes, paragraph('These choices are local research notes. Export them before closing or importing another run.'));
}

function deskReviewPanel(candidate) {
  const notes=object(activeReport.evaluation?.semantic_review);
  const reviews=list(notes.reviews).filter(review=>review.candidate_id===candidate.id);
  if(!reviews.length)return null;
  const pairs=new Map(list(activeReport.evaluation?.synthetic_probes?.pairs).map(pair=>[pair.id,pair]));
  const panel=section('Synthetic scenarios — agent desk review',paragraph(`${reviews.length} paired readings retained. These are contestable agent judgments on authored situations; human comprehension and fairness remain untested.`, 'muted'));
  for(const review of reviews) {
    const pair=pairs.get(review.probe_pair_id);const details=el('details','desk-review');
    add(details,el('summary','',`${pair?.focus||review.probe_pair_id} · ${label(review.relevance)}`),paragraph(review.reason),paragraph(`Across roles: ${review.role_consistency}`),paragraph(`Confusion or limit: ${review.confusions_or_limit}`));
    if(pair)add(details,el('h4','','Shared synthetic assignment'),record(pair.assignment_contract));
    for(const reading of list(review.situations)) {
      const situation=list(pair?.situations).find(item=>item.id===reading.situation_id);
      add(details,el('h4','',situation?`${situation.declarer_role} declaration · possible ${situation.potential_beneficiary} benefit`:reading.situation_id));
      if(situation)add(details,el('h4','','Established facts'),textList(situation.established_facts,'No facts recorded.'),el('h4','','Disputed claims'),textList(situation.disputed_claims,'No disputed claims recorded.'),el('h4','','Unknowns'),textList(situation.unknowns,'No unknowns recorded in this constructed situation.'));
      add(details,record({higher_emphasis:reading.higher_emphasis,lower_emphasis:reading.lower_emphasis,evidence_limits:reading.evidence_limits,scope_guardrail:reading.scope_guardrail}));
    }
    add(panel,details);
  }
  return panel;
}

function candidateDetail(candidate) {
  const detail = el('article', 'detail');
  add(detail, add(el('div', 'detail-heading'), add(el('div'), paragraph(candidate.id, 'kicker'), el('h2', '', candidate.name || 'Unnamed candidate')), el('span', 'draft-badge', 'AGENT DRAFT · NOT ADOPTED')));
  add(detail, paragraph(candidate.declaration || 'No declaration recorded.', 'declaration'));
  add(detail,paragraph(`Research scope: ${list(candidate.scope).map(label).join(', ')||'Not specified'}.`,'muted'));
  const contrast = object(candidate.contrast);
  add(detail, add(el('div', 'contrast'),
    add(el('div', 'contrast-cell'), el('h4', '', 'Higher emphasis'), paragraph(pick(contrast.higher, candidate.higher_emphasis, 'Not yet formulated.'))),
    add(el('div', 'contrast-cell lower'), el('h4', '', 'Lower emphasis'), paragraph(pick(contrast.lower, candidate.lower_emphasis, 'Not yet formulated.')))));
  add(detail, section('Boundaries', textList(candidate.boundaries, 'No boundaries have been recorded.')));
  add(detail, section('Nearest confusions', textList(candidate.nearest_confusions, 'No neighboring concepts have been recorded.')));
  const supports = list(candidate.support).filter((item) => item != null).map((item) => typeof item === 'object' ? item : { clause_id: item });
  const supportSection = section('Supporting clauses', paragraph(`${supports.length} cited clauses. Inspect each source in context; a citation is evidence for investigation.`, 'muted'));
  let visible = 8;
  const supportCards = el('div');
  const showSupport = () => { supportCards.replaceChildren(...supports.slice(0, visible).map((item) => {const card=evidence(item.clause_id, { reason: item.reason, clusterId: item.cluster_id });if(item.context_limit)add(card,paragraph(`Source context limit: ${item.context_limit}`,'muted'));return card;})); };
  showSupport(); add(supportSection, supportCards);
  if (supports.length > visible) {
    const more = button('Show all supporting clauses', () => { visible = supports.length; showSupport(); more.remove(); }); add(supportSection, more);
  }
  if (!supports.length) add(supportSection, paragraph('This draft has no source citations in the report.', 'muted'));
  add(detail, supportSection);
  const counterexamples = list(candidate.counterexamples);
  const counterSection = section('Counterexamples & challenges');
  if (!counterexamples.length) add(counterSection, paragraph('No counterexamples recorded. This is an unresolved research gap.', 'muted'));
  for (const item of counterexamples) {
    if (item != null && typeof item === 'object' && item.clause_id) add(counterSection, evidence(item.clause_id, { reason: pick(item.reason, item.challenge), clusterId: item.cluster_id }));
    else add(counterSection, paragraph(describe(item, ['text', 'reason', 'challenge'])));
  }
  add(detail, counterSection);
  add(detail,section('Domain limits',textList(candidate.domain_limits,'No domain limits have been recorded.')));
  const deskPanel=deskReviewPanel(candidate);if(deskPanel)add(detail,deskPanel);
  const extra = Object.fromEntries(['rationale', 'discovery_notes', 'evaluation', 'scenario_checks', 'merge_notes', 'split_notes'].filter((key) => candidate[key] != null).map((key) => [key, candidate[key]]));
  if (entries(extra).length) add(detail, section('Research notes', record(extra)));
  add(detail, section('Local review', reviewPanel(candidate)));
  return detail;
}

function candidatesView() {
  const wrapper = el('section');
  const grid = el('div', 'browse-grid'); const browseList = el('div', 'browse-list'); const detailSlot = el('div');
  const draw = () => {
    const matches = activeReport.candidates.filter(searchable);
    if (!matches.find((candidate) => candidate.id === selectedCandidate)) selectedCandidate = matches[0]?.id || null;
    browseList.replaceChildren(...matches.map((candidate) => {
      const chosen = candidate.id === selectedCandidate;
      const item = button('', () => { selectedCandidate = candidate.id; draw(); }, `browse-item${chosen ? ' selected' : ''}`);
      item.setAttribute('aria-pressed', String(chosen));
      add(item, paragraph(candidate.id, 'item-id'), el('h3', '', candidate.name || 'Unnamed candidate'), paragraph(candidate.declaration || 'Declaration pending.', 'item-summary'), add(el('div', 'item-footer'), el('span', '', `${list(candidate.support).length} source clauses`), el('span', '', 'Agent draft')));
      return item;
    }));
    if (!matches.length) browseList.append(paragraph('No candidate matches this search.', 'muted'));
    const candidate = matches.find((item) => item.id === selectedCandidate);
    detailSlot.replaceChildren(candidate ? candidateDetail(candidate) : emptyState('No candidate selected', 'Change the search to inspect a candidate and its source lineage.'));
  };
  add(wrapper, heading('Candidate priors', 'Inspect the proposed declarations, their boundaries, and the contractual evidence behind them.', { searchLabel: 'Search candidates', update: draw }));
  if (!activeReport.candidates.length) add(wrapper, emptyState('Discovery comes before adoption', 'This run has no candidate cards. Browse clause families and the method to see what has been completed.'));
  else { add(grid, browseList, detailSlot); add(wrapper, grid); draw(); }
  return wrapper;
}

function familyDetail(family) {
  const members = unique(pick(family.member_ids, family.clause_ids, []));
  const representatives = unique(pick(family.representative_ids, family.representatives, [])).filter((id) => members.includes(id) || indexFor('clauses').has(id));
  const detail = el('article', 'detail');
  add(detail, add(el('div', 'detail-heading'), add(el('div'), paragraph(family.id, 'kicker'), el('h2', '', family.name || family.label || 'Exploratory clause family')), el('span', 'draft-badge', 'EXPLORATORY CLUSTER')));
  if (family.description) add(detail, paragraph(family.description));
  add(detail, add(el('div', 'chips'), ...list(family.top_terms).map((term) => el('span', 'chip', describe(term, ['term', 'text'])))));
  const facts = { clauses: pick(family.size, members.length), distinct_contracts: pick(family.distinct_contracts, family.contract_count, 'Not recorded') };
  for (const key of ['average_similarity', 'cohesion', 'silhouette', 'duplicate_ratio', 'outlier', 'setting', 'stability']) if (family[key] != null) facts[key] = family[key];
  if (family.outlier_ids != null) facts.outlier_count = list(family.outlier_ids).length;
  add(detail, record(facts));
  const linked = activeReport.candidates.filter((candidate) => list(candidate.support).some((support) => String(support?.cluster_id) === family.id));
  if (linked.length) add(detail, section('Candidate interpretations', ...linked.map((candidate) => button(`${candidate.name || candidate.id} →`, () => { selectedCandidate = candidate.id; activeTab = 'candidates'; searchText = ''; render(); }))));
  const reps = section('Representative clauses', paragraph('Representatives help you inspect a family. Shared words or embedding proximity do not establish a shared normative principle.', 'muted'));
  if (representatives.length) add(reps, ...representatives.map((id) => evidence(id, {
    reason: list(family.outlier_ids).map(String).includes(id) ? 'This representative is also marked as low similarity in this run.' : null,
  })));
  else add(reps, paragraph('No representatives recorded; member clauses are shown below.', 'muted'));
  add(detail, reps);
  const outliers = unique(family.outlier_ids).filter((id) => !representatives.includes(id));
  const displayedOutliers = outliers.slice(0, 8);
  if (outliers.length) {
    const outlierSection = section(`Low similarity members (${outliers.length})`, paragraph('These clauses challenge the family boundary. The similarity threshold is an experimental setting, not an acceptance rule.', 'muted'));
    add(outlierSection, ...displayedOutliers.map((id) => evidence(id)));
    if (outliers.length > 8) add(outlierSection, paragraph(`${outliers.length - 8} further low similarity members are listed among the remaining members.`, 'muted'));
    add(detail, outlierSection);
  }
  const others = members.filter((id) => !representatives.includes(id) && !displayedOutliers.includes(id));
  if (pendingClause && members.includes(pendingClause) && !representatives.includes(pendingClause)) {
    const index = others.indexOf(pendingClause); if (index >= 0) others.splice(index, 1); others.unshift(pendingClause);
  }
  const memberSection = section(`Other members (${others.length})`); const memberCards = el('div'); let visible = 12;
  const draw = () => memberCards.replaceChildren(...others.slice(0, visible).map((id) => evidence(id)));
  draw(); add(memberSection, memberCards);
  if (others.length > visible) {
    const more = button(`Show more member clauses (${others.length - visible} remaining)`, () => { visible += 12; draw(); more.textContent = `Show more member clauses (${Math.max(0, others.length - visible)} remaining)`; if (visible >= others.length) more.remove(); }); add(memberSection, more);
  }
  if (!others.length) add(memberSection, paragraph('No additional members recorded.', 'muted'));
  add(detail, memberSection);
  return detail;
}

function familiesView() {
  const wrapper = el('section');
  const grid = el('div', 'browse-grid'); const browseList = el('div', 'browse-list'); const detailSlot = el('div');
  const draw = () => {
    const matches = activeReport.clusters.filter(searchable);
    if (!matches.find((family) => family.id === selectedFamily)) selectedFamily = matches[0]?.id || null;
    browseList.replaceChildren(...matches.map((family) => {
      const chosen = family.id === selectedFamily;
      const item = button('', () => { selectedFamily = family.id; pendingClause = null; draw(); }, `browse-item${chosen ? ' selected' : ''}`);
      item.setAttribute('aria-pressed', String(chosen));
      add(item, paragraph(family.id, 'item-id'), el('h3', '', family.name || family.label || 'Exploratory family'), paragraph(list(family.top_terms).map((term) => describe(term, ['term', 'text'])).join(' · '), 'item-summary'), add(el('div', 'item-footer'), el('span', '', `${pick(family.size, list(family.member_ids).length)} clauses`), el('span', '', `${pick(family.distinct_contracts, family.contract_count, '?')} contracts`)));
      return item;
    }));
    if (!matches.length) browseList.append(paragraph('No family matches this search.', 'muted'));
    const family = matches.find((item) => item.id === selectedFamily);
    detailSlot.replaceChildren(family ? familyDetail(family) : emptyState('No family selected', 'Change the search to inspect a conceptual family.'));
  };
  add(wrapper, heading('Clause families', 'Compare representatives and outliers before interpreting a recurring family as a candidate prior.', { searchLabel: 'Search families', update: draw }));
  if (!activeReport.clusters.length) add(wrapper, emptyState('No families in this run', 'The report does not contain clustering results. Method and findings may explain the incomplete stage.'));
  else { add(grid, browseList, detailSlot); add(wrapper, grid); draw(); }
  return wrapper;
}

function contractsTable() {
  const table = el('table', 'small-table');
  const thead = add(el('thead'), add(el('tr'), el('th', '', 'Contract'), el('th', '', 'Type'), el('th', '', 'Source'))); const tbody = el('tbody');
  for (const contract of activeReport.contracts) add(tbody, add(el('tr'), add(el('td'), el('strong', '', contract.id), paragraph(pick(contract.title, contract.name), 'muted')), el('td', '', pick(contract.type, contract.contract_type, contract.category, 'Not recorded')), add(el('td'), sourceLink(pick(contract.source_url, contract.url)))));
  return add(table, thead, tbody);
}
function methodView() {
  const wrapper = add(el('section'), heading('Method & provenance', 'Inspect the sample, exact run settings, and source records. Reproducibility supports investigation; it does not settle the interpretation.'));
  const left = el('div'); const right = el('div');
  add(left, panel('Run record', record(Object.fromEntries(['schema_version', 'title', 'run_id', 'status', 'created_at', 'generated_at'].filter((key) => activeReport[key] != null).map((key) => [key, activeReport[key]])))));
  for (const key of ['method', 'configuration', 'settings', 'sampling', 'discovery', 'stability', 'deduplication']) {
    if (activeReport[key] != null) add(left, panel(label(key), typeof activeReport[key] === 'object' && !Array.isArray(activeReport[key]) ? record(activeReport[key]) : el('pre', 'nested-record', display(activeReport[key]))));
  }
  add(right, panel('Provenance', record(activeReport.provenance)));
  if (activeReport.license != null) add(right, panel('License & attribution', typeof activeReport.license === 'object' ? record(activeReport.license) : paragraph(activeReport.license)));
  if (activeReport.attribution != null) add(right, panel('Attribution', paragraph(activeReport.attribution)));
  add(right, panel('Reading the evidence', paragraph('Each candidate traces to cited clauses. Clause cards include available headings and neighboring text, plus an original source link when it is recorded.'), paragraph('The source link opens only an HTTP or HTTPS address. Raw contract text is displayed as text. The review server exposes the selected report and explicit review assets only.')));
  add(wrapper, add(el('div', 'prose-grid'), left, right));
  if (activeReport.contracts.length) add(wrapper, panel(`Selected contracts (${activeReport.contracts.length})`, contractsTable()));
  return wrapper;
}
function findingsView() {
  const wrapper = add(el('section'), heading('Findings & limits', 'Record what this pilot supports, what remains unclear, and the next experiment that would change our understanding.'));
  const left = el('div'); const right = el('div');
  for (const key of ['findings', 'recommendations', 'next_steps']) {
    if (activeReport[key] == null) continue;
    const values = list(activeReport[key]);
    add(left, panel(label(key), values.length ? add(el('ol', 'finding-list'), ...values.map((item, index) => add(el('li'), el('span', 'number', String(index + 1).padStart(2, '0')), el('span', '', describe(item, ['description', 'text', 'finding']))))) : (typeof activeReport[key] === 'object' ? record(activeReport[key]) : paragraph(activeReport[key]))));
  }
  add(left, panel('Evaluation', activeReport.evaluation != null ? record(activeReport.evaluation) : paragraph('No evaluation results are recorded in this run. Candidate usefulness remains untested.')));
  const limits = list(activeReport.limitations);
  add(right, panel('Recorded limitations', limits.length ? textList(limits, '') : paragraph('No limitations were recorded. This absence is a reporting gap, not evidence that the pilot is unrestricted.')));
  add(right, panel('Interpretation boundary', add(el('div', 'finding'), paragraph('Recurring contractual clauses can suggest considerations worth testing. They do not establish the right first priors or the number of priors.')), paragraph('Contract type, drafting practice, duplicate boilerplate, model choice, and cluster settings can shape the observed families. Use the pilot’s stability and counterexample checks to judge that influence.'), paragraph('Higher and lower emphasis are research contrasts. No weights or payout rules are produced by this review surface.')));
  if (activeReport.summary) add(right, panel('Run summary', record(activeReport.summary)));
  add(wrapper, add(el('div', 'prose-grid'), left, right));
  return wrapper;
}

function renderOverview() {
  const overview = document.getElementById('run-overview');
  const summary = activeReport?.summary || {};
  overview.replaceChildren(add(el('div', 'run-label'), el('strong', '', activeReport?.title || 'Awaiting a completed pilot'), paragraph(activeReport ? `${display(activeReport.status || 'Exploratory run')} · ${loadedName}` : 'Load report.json from a completed run.')),
    ...[['Contracts', activeReport?.contracts.length], ['Selected units', activeReport?.clauses.length], ['Discovery clusters', activeReport?.clusters.length], ['Candidate drafts', activeReport?.candidates.length]].map(([name, value]) => add(el('div', 'metric'), el('div', 'metric-value', value == null ? '—' : value.toLocaleString()), paragraph(name, 'metric-label'))));
  if (summary && summary.contracts != null && activeReport?.contracts.length !== summary.contracts) {
    overview.firstChild.append(paragraph('Counts show inspectable records in this report.'));
  }
  document.getElementById('candidate-count').textContent = String(activeReport?.candidates.length || 0);
  document.getElementById('family-count').textContent = String(activeReport?.clusters.length || 0);
}
function render() {
  for (const tab of document.querySelectorAll('[data-tab]')) {
    const current = tab.dataset.tab === activeTab; tab.classList.toggle('active', current);
    if (current) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  }
  renderOverview();
  const workspace = document.getElementById('workspace');
  if (!activeReport) {
    workspace.replaceChildren(emptyState('A research desk, ready for evidence', 'Start the read-only server with a completed run directory, or use Import report to open a local report.json. The lab will show only records present in that report.'));
    return;
  }
  const views = { candidates: candidatesView, families: familiesView, method: methodView, findings: findingsView };
  workspace.replaceChildren(views[activeTab]());
  if (pendingClause) {
    const id = `evidence-${pendingClause.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`;
    document.getElementById(id)?.scrollIntoView({ block: 'center' }); pendingClause = null;
  }
}
function status(text, error = false) { const node = document.getElementById('load-status'); node.textContent = text; node.classList.toggle('error', error); }
function loadReport(input, name) {
  const report = normalizeReport(input);
  activeReport = report; loadedName = name; selectedCandidate = null; selectedFamily = null; pendingClause = null; searchText = '';
  reportIndexes = new Map(['candidates', 'clusters', 'clauses', 'contracts'].map((key) => [key, new Map(report[key].map((item) => [item.id, item]))]));
  reviewChoices.clear(); document.getElementById('export-review').disabled = true;
  render(); status(`Loaded ${name} · schema 1 · candidate interpretations remain agent drafts.`);
}
async function initialize() {
  for (const tab of document.querySelectorAll('[data-tab]')) tab.addEventListener('click', () => { activeTab = tab.dataset.tab; searchText = ''; pendingClause = null; render(); });
  document.getElementById('report-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.size > maxReportBytes) throw new Error('The report exceeds the 25 MiB review limit.');
      loadReport(JSON.parse(await file.text()), file.name);
    } catch (error) { status(`Import failed: ${error.message}`, true); }
    event.target.value = '';
  });
  document.getElementById('export-review').addEventListener('click', () => {
    if (!activeReport) return;
    const artifact = buildReviewExport(activeReport, reviewChoices);
    const url = URL.createObjectURL(new Blob([JSON.stringify(artifact, null, 2) + '\n'], { type: 'application/json' }));
    const link = el('a'); link.href = url; link.download = 'priors-derivation-local-review.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(`Exported ${reviewChoices.size} local review decisions. No priors have been adopted.`);
  });
  render();
  try {
    const response = await fetch('./report.json', { cache: 'no-store' });
    if (!response.ok) { status('No server report selected. Import a local report.json to begin.'); return; }
    const bytes = await response.text();
    if (new TextEncoder().encode(bytes).length > maxReportBytes) throw new Error('The report exceeds the 25 MiB review limit.');
    loadReport(JSON.parse(bytes), 'server report.json');
  } catch (error) { status(`Server report unavailable. Import a local report.json to begin. ${error.message}`, true); }
}

if (typeof document !== 'undefined') initialize();
