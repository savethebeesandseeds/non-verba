// SPDX-License-Identifier: AGPL-3.0-only
let summary = null; let view = 'evidence'; let cursor = null; let nextCursor = null; let history = []; let filters = {}; let requestNumber = 0;
const $ = id => document.getElementById(id);
const text = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
function el(tag, className = '', value = null) { const node = document.createElement(tag); if (className) node.className = className; if (value != null) node.textContent = text(value); return node; }
function add(parent, ...children) { parent.append(...children.filter(Boolean)); return parent; }
function button(label, action) { const node = el('button', '', label); node.type = 'button'; node.addEventListener('click', action); return node; }
function source(value) { try { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return el('span', 'source', 'Source link unavailable'); const link = el('a', 'source', 'Original contract ↗'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link; } catch { return el('span', 'source', 'Source link unavailable'); } }
function status(value, error = false) { $('status').textContent = value; $('status').classList.toggle('error', error); }
async function api(path, params = {}) { const url = new URL(path, location.origin); for (const [key, value] of Object.entries(params)) if (value != null && value !== '') url.searchParams.set(key, value); const response = await fetch(url, { cache: 'no-store' }); const result = await response.json(); if (!response.ok) throw new Error(result.error || `Review request failed (${response.status}).`); return result; }
function heading(title, description) { return add(el('div', 'view-heading'), el('h2', '', title), el('p', '', description)); }
function facts(record) { return add(el('dl', 'facts'), ...Object.entries(record || {}).map(([key, value]) => add(el('div', 'facts-row'), el('dt', '', key.replaceAll('_', ' ')), add(el('dd'), typeof value === 'object' ? el('pre', '', value) : el('span', '', value))))); }
function panel(title, ...children) { return add(el('section', 'panel'), el('h3', '', title), ...children); }
function empty(description) { return add(el('div', 'empty'), el('h2', '', 'No admitted evidence on this page'), el('p', '', description)); }
function browseEvidence(nextFilters) { view = 'evidence'; filters = nextFilters; cursor = null; history = []; updateTabs(); load(); }

async function contextFor(unit, slot, start = null) {
  slot.replaceChildren(el('p', '', 'Verifying admitted source and parent context…'));
  try {
    const result = await api('/api/context', { unit: unit.id, start });
    slot.replaceChildren(el('h3', '', result.excerpt?.complete_parent ? 'Complete retained parent section' : 'Bounded source context'));
    add(slot, el('p', '', result.context_status));
    if (result.excerpt) {
      add(slot, el('p', '', `Normalized offsets ${result.excerpt.start}–${result.excerpt.end}. ${result.excerpt.complete_parent ? 'The entire retained parent is shown.' : 'This is an excerpt; another condition or exception may lie outside it.'}`), el('pre', '', result.excerpt.text));
      if (result.excerpt.next_start != null) add(slot, button('Next parent-context page', () => contextFor(unit, slot, result.excerpt.next_start)));
      if (result.excerpt.start > result.excerpt.parent_start) add(slot, button('Start of retained parent', () => contextFor(unit, slot, result.excerpt.parent_start)));
    } else add(slot, el('pre', '', `${result.context_before || ''}\n\n[Selected unit appears above]\n\n${result.context_after || ''}`));
    add(slot, facts({ parent_section_id: result.parent_section_id || unit.parent_section_id, normalized_source_sha256: result.normalized_source_sha256 || 'Not available', bound_to_extraction_hash: result.normalized_hash_bound_to_extraction || false, raw_source_sha256: result.raw_source_sha256 || 'Not available', offset_convention: result.offsets || 'Recorded neighbors only' }));
  } catch (error) { slot.replaceChildren(el('p', 'unresolved', error.message)); }
}
function unitCard(unit) {
  const card = el('article', 'card'); const contextSlot = el('section', 'context hidden');
  add(card, add(el('div', 'card-header'), el('p', 'identifier', unit.id), source(unit.source_url)), el('p', 'heading', (unit.heading_path || []).join(' › ') || unit.heading || 'No verified heading recorded'),
    add(el('div', 'chips'), ...[unit.cohort, `Extraction kind: ${unit.kind || 'unknown'}`, unit.assignment?.cluster_id || 'Primary assignment missing'].map(value => el('span', 'chip', value))), el('blockquote', 'clause', unit.text));
  add(card, el('p', 'evidence-note', 'RAW SOURCE EVIDENCE · A geometric assignment supplies no inferred prior meaning.'));
  if (unit.function_tags?.length) add(card, el('p', 'evidence-note', `Sampling categories: ${unit.function_tags.join(', ')}. These are lexical categories, not discovered priors.`));
  if (unit.warnings?.length) add(card, el('p', 'evidence-note', unit.warnings.map(item => typeof item === 'object' ? item.message || item.code : item).join(' ')));
  add(card, add(el('div', 'card-actions'), button('Inspect parent & source context', () => { contextSlot.classList.remove('hidden'); contextFor(unit, contextSlot); }), button('This contract', () => browseEvidence({ contract: unit.contract_id })), unit.assignment?.cluster_id ? button('This geometric group', () => browseEvidence({ cluster: unit.assignment.cluster_id })) : null), contextSlot);
  const details = add(el('details'), el('summary', '', 'Unit provenance & geometry'));
  add(details, facts({ contract_id: unit.contract_id, parent_section_id: unit.parent_section_id, unit_sha256: unit.sha256, family_id: unit.family_id, template_blocking_id: unit.template_blocking_id, word_count: unit.word_count, assignment: unit.assignment })); add(card, details); return card;
}
function methodView() {
  const left = el('div'); const right = el('div');
  add(left, panel('Admission & source provenance', facts(summary.admission)), panel('Geometry & reproducibility', facts(summary.geometry)), panel('Corpus attribution & handling', facts(summary.data_attribution)));
  add(right, panel('Unresolved gates', ...Object.entries(summary.gates).map(([name, value]) => add(el('div', 'gate'), el('strong', '', name.replaceAll('_', ' ')), el('p', '', value)))),
    panel('Interpretation boundary', el('p', '', 'This study has not selected a catalog or established that geometric groups express independent values. A raw obligation, an exception and a negotiated allocation can share vocabulary without sharing a normative meaning.')),
    panel('Limits retained', add(el('ul'), ...summary.limitations.map(value => el('li', '', value)))));
  return add(el('section'), heading('Provenance & gates', 'Hash identity, actual coverage and stated limits support inspection. They do not independently attest execution or establish human understanding.'), add(el('div', 'method-grid'), left, right));
}
function updateTabs() {
  for (const tab of document.querySelectorAll('[data-view]')) { const selected = tab.dataset.view === view; tab.classList.toggle('active', selected); if (selected) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current'); }
  $('toolbar').classList.toggle('hidden', !['evidence', 'contracts'].includes(view)); $('pager').classList.toggle('hidden', view === 'method');
  document.querySelector('label[for="search"]').textContent = view === 'contracts' ? 'Search contract identifiers' : 'Search admitted source'; $('search').placeholder = view === 'contracts' ? 'Exact or partial contract identifier…' : 'Text, heading or source metadata…';
  $('filter-note').textContent = filters.cluster ? `Geometric group: ${filters.cluster}` : filters.contract ? `Contract: ${filters.contract}` : '';
}
async function load() {
  const serial = ++requestNumber; updateTabs(); $('previous').disabled = true; $('next').disabled = true;
  if (view === 'method') { $('content').replaceChildren(methodView()); status(`Run ${summary.run_id} · authority NONE · no catalog adopted.`); return; }
  status('Loading one bounded page of retained evidence…');
  try {
    const endpoint = { evidence: '/api/units', contracts: '/api/contracts', clusters: '/api/clusters' }[view];
    const result = await api(endpoint, { ...filters, cursor, limit: 20 }); if (serial !== requestNumber) return;
    nextCursor = result.next_cursor; const container = el('section');
    if (view === 'evidence') {
      add(container, heading('Source evidence', 'Read contractual language in its retained context before proposing a candidate meaning. Only actual admitted representatives appear here.'), result.items.length ? add(el('div', 'cards'), ...result.items.map(unitCard)) : empty('Change the search or filters. No absent evidence has been substituted.'));
    } else if (view === 'clusters') {
      add(container, heading('Discovery clusters', 'These are geometric groups in the predeclared primary run. Names or principles have not been inferred by this view.'), add(el('div', 'compact-grid'), ...result.items.map(cluster => add(el('article', 'card'), el('h3', '', cluster.id), el('p', '', `${cluster.representatives} admitted representatives · ${cluster.contracts} contracts`), el('p', '', `Mean cosine similarity: ${Number(cluster.mean_cosine_similarity).toFixed(3)}. This is a geometric diagnostic.`), button('Inspect source members', () => browseEvidence({ cluster: cluster.id }))))));
    } else {
      add(container, heading('Represented contracts', 'A contract appears only when it contains an admitted representative. Original sources and exact unit context remain traceable.'), add(el('div', 'compact-grid'), ...result.items.map(contract => add(el('article', 'card'), el('h3', '', contract.id), el('p', '', `${contract.representatives} representatives · ${contract.cohort}`), source(contract.source_url), button('Inspect admitted units', () => browseEvidence({ contract: contract.id }))))));
    }
    $('content').replaceChildren(container); $('previous').disabled = history.length === 0; $('next').disabled = !nextCursor; $('page-note').textContent = `Page ${history.length + 1} · ${result.returned} records · bounded to 20 per request`;
    status(`Run ${summary.run_id} · primary ${summary.primary_run || 'unavailable'} · source evidence remains distinct from candidate interpretation.`);
  } catch (error) { if (serial === requestNumber) { $('content').replaceChildren(empty('The selected evidence request failed validation.')); status(error.message, true); } }
}
async function initialize() {
  for (const tab of document.querySelectorAll('[data-view]')) tab.addEventListener('click', () => { view = tab.dataset.view; filters = {}; cursor = null; history = []; $('search').value = ''; $('cohort').value = ''; load(); });
  const apply = () => { filters = { query: $('search').value, cohort: $('cohort').value }; filters.q = filters.query; delete filters.query; cursor = null; history = []; load(); };
  $('apply').addEventListener('click', apply); $('search').addEventListener('keydown', event => { if (event.key === 'Enter') apply(); });
  $('reset').addEventListener('click', () => { $('search').value = ''; $('cohort').value = ''; filters = {}; cursor = null; history = []; load(); });
  $('next').addEventListener('click', () => { if (!nextCursor) return; history.push(cursor); cursor = nextCursor; load(); });
  $('previous').addEventListener('click', () => { if (!history.length) return; cursor = history.pop(); load(); });
  try {
    summary = await api('/api/summary');$('representation-gate').textContent=summary.gates?.representation?.status==='CALIBRATION_GATE_PASSED'?'Representation calibration passed for this source version. Candidate meanings and participant findings remain separate gates.':'Engineering calibration: representation audit has not passed. These counts do not certify study completion.'; $('metrics').replaceChildren(...[['Admitted representatives', summary.counts.admitted_representatives], ['Represented contracts', summary.counts.represented_contracts], ['Primary assignments', summary.counts.primary_assignments], ['Discovery clusters', summary.counts.primary_clusters]].map(([name, value]) => add(el('div', 'metric'), el('div', 'value', value == null ? '—' : Number(value).toLocaleString()), el('p', 'metric-label', name)))); await load();
  } catch (error) { status(error.message, true); $('content').replaceChildren(empty('This view needs explicit admission and primary-geometry manifests from the selected run.')); }
}
initialize();
