// SPDX-License-Identifier: AGPL-3.0-only
// Read-only, keyset-paginated review of actual admitted source and primary assignments.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {digest} from '../../lib/common.mjs';
import { validateStudyRoot, studyPath, hashFile, openDatabase, readJSON, sqlQuote } from './store.mjs';
import {sourceNavigationLabel,verifySourceNavigation} from './representation.mjs';
import {verifyCalibrationGate} from './quality.mjs';
import {assertNoUnresolvedSourceIssues} from './source-issues.mjs';
import {loadNativeDecoration} from './native-decoration-store.mjs';
import {createNativeDecorationView} from './source-decoration.mjs';

const uiRoot = new URL('../review/', import.meta.url);
const allowedCohorts = new Set(['discovery-broad', 'discovery-relevant']);
const sha = value => createHash('sha256').update(value).digest('hex');
const idText = (value, label) => { if (typeof value !== 'string' || !value || value.length > 1024) throw new RequestError(`${label} must be a bounded nonempty identifier.`); return value; };
const integer = (value, min, max, label) => { const number = Number(value); if (!Number.isSafeInteger(number) || number < min || number > max) throw new RequestError(`${label} must be an integer in ${min}..${max}.`); return number; };
class RequestError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const json = value => typeof value === 'string' ? JSON.parse(value) : value;
const number = value => typeof value === 'bigint' ? Number(value) : value;

export function sourceUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function localReviewCsp() { return "default-src 'none'; script-src 'self'; style-src 'self'; style-src-elem 'self' 'unsafe-inline'; style-src-attr 'none'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'"; }

async function checkedShards(runDir, values, label) {
  if (!Array.isArray(values) || !values.length || values.length > 10000) throw new Error(`${label} requires an explicit bounded list of source shards.`);
  const paths = []; const seen = new Set();
  for (const value of values) {
    if (!value || typeof value.path !== 'string' || !value.path.endsWith('.parquet') || !/^[a-f0-9]{64}$/.test(value.sha256 || '') || seen.has(value.path)) throw new Error(`${label} shard identity is absent or repeated.`);
    seen.add(value.path); const path = await studyPath(runDir, value.path); const actual = await hashFile(path);
    if (actual.sha256 !== value.sha256) throw new Error(`${label} source shard hash mismatch.`); paths.push(path);
  }
  return paths;
}
const parquet = paths => `read_parquet([${paths.map(sqlQuote).join(',')}],union_by_name=true)`;
function limitedRecord(value, depth = 0) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)} [truncated metadata string]` : value;
  if (depth > 4) return '[Nested metadata omitted from summary; inspect the run artifacts.]';
  if (Array.isArray(value)) return value.length > 32 ? { count: value.length, bounded_preview: value.slice(0, 16).map(item => limitedRecord(item, depth + 1)), summary_truncated: true } : value.map(item => limitedRecord(item, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 64).map(([key, item]) => [key, limitedRecord(item, depth + 1)]));
}
const scalarMetadata=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value??{},key)&&["string","number","boolean"].includes(typeof value[key])).map(key=>[key,limitedRecord(value[key])]));
function navigationMetadata(value) {
  if (!value) return null;
  const anchor = item => item ? {
    ...scalarMetadata(item,['id','label','start','end','kind','parent_boundary_suppressed','suppression_reason']),governing_hierarchy_verified:false,scope:'LITERAL_SOURCE_NAVIGATION_ONLY',
    parts:limitedRecord((item.parts??[]).map(part=>scalarMetadata(part,['text','start','end']))),
    source_evidence:scalarMetadata(item.source_evidence,['source_kind','html_level','literal_typed_marker','source_layout_caption']),
    ambiguity:scalarMetadata(item.ambiguity,['source_continuation','source_sentence_continuation','source_quote_context','within_introduced_list_frame','source_list_item','table_layout','source_delimiter_open','introduced_quote'])
  } : null;
  return {...scalarMetadata(value,['status']),scope:'LITERAL_SOURCE_NAVIGATION_ONLY',governing_hierarchy_verified:false,nearest_anchor:anchor(value.nearest_anchor),within_unit:(value.within_unit??[]).slice(0,32).map(anchor),within_unit_total:value.within_unit?.length??0,within_unit_truncated:(value.within_unit?.length??0)>32};
}
function pagination(params, filters) {
  const limit = integer(params.get('limit') || 20, 1, 50, 'limit'); const filterHash = sha(JSON.stringify(filters)); const token = params.get('cursor'); let after = null;
  if (token) {
    if (token.length > 4096 || !/^[a-zA-Z0-9_-]+$/.test(token)) throw new RequestError('Invalid review cursor.');
    let cursor; try { cursor = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')); } catch { throw new RequestError('Invalid review cursor.'); }
    if (cursor.version !== 1 || cursor.filter_sha256 !== filterHash) throw new RequestError('Cursor does not belong to these filters.'); after = idText(cursor.after, 'cursor after');
  }
  return { limit, after, tokenFor: id => Buffer.from(JSON.stringify({ version: 1, after: id, filter_sha256: filterHash })).toString('base64url') };
}
function requestFilters(params) {
  const query = params.get('q') || ''; if (query.length > 120) throw new RequestError('Search is limited to 120 characters.');
  const cohort = params.get('cohort') || null; if (cohort && !allowedCohorts.has(cohort)) throw new RequestError('Only admitted discovery cohorts are reviewable.');
  const contract = params.get('contract') || null; if (contract) idText(contract, 'contract');
  const cluster = params.get('cluster') || null; if (cluster) idText(cluster, 'cluster');
  return { query, cohort, contract, cluster };
}

/** Returns an unbound server for focused tests; the convenience API below binds only when called. */
export async function createStudyReviewServer(runDirectory, { admission, geometry, log = () => {} } = {}) {
  const runDir = validateStudyRoot(runDirectory);
  if (!admission || !geometry || admission.authority !== 'NONE' || admission.adopted_catalog === true || geometry.authority !== 'NONE' || geometry.adopted_catalog === true) throw new Error('Review requires explicit research-only admission and geometry manifests.');
  const units = await checkedShards(runDir, admission.shards?.units || admission.shards, 'Admitted representative');
  const assignments = await checkedShards(runDir, geometry.assignment_shards, 'Primary assignment');
  const sectionDescriptors = admission.input?.sections_shards || [];
  const sections = sectionDescriptors.length ? await checkedShards(runDir, sectionDescriptors, 'Parent section') : null;
  const db = await openDatabase({ memory: '512MB' }); let queue = Promise.resolve(); let closed = false;
  const query = sql => { const result = queue.then(async () => { if (closed) throw new Error('Review database is closed.'); return (await db.connection.runAndReadAll(sql)).getRowObjectsJS(); }); queue = result.catch(() => {}); return result; };
  let extraction = null;
  try {
    await db.connection.run(`CREATE VIEW admitted AS SELECT * FROM ${parquet(units)}`);
    await db.connection.run(`CREATE VIEW assigned AS SELECT * FROM ${parquet(assignments)}`);
    if (sections) await db.connection.run(`CREATE VIEW sections AS SELECT * FROM ${parquet(sections)}`);
    const unsafe = await query("SELECT count(*) AS n FROM admitted WHERE cohort IS NULL OR cohort NOT IN ('discovery-broad','discovery-relevant')");
    if (number(unsafe[0].n)) throw new Error('Reserve or unknown-cohort records appeared in discovery admission; review refused.');
    const payloadBoundary = await query("SELECT count(*) AS n FROM admitted WHERE json_extract_string(payload,'$.cohort') IS NULL OR json_extract_string(payload,'$.cohort')!=cohort OR json_extract_string(payload,'$.id') IS NULL OR json_extract_string(payload,'$.id')!=id OR json_extract_string(payload,'$.contract_id') IS NULL OR json_extract_string(payload,'$.contract_id')!=contract_id");
    if (number(payloadBoundary[0].n)) throw new Error('Discovery source payload identity or cohort differs from its admitted row.');
    const duplicates = await query('SELECT count(*)-count(DISTINCT id) AS n FROM admitted');
    const assignedDuplicates = await query('SELECT count(*)-count(DISTINCT id) AS n FROM assigned');
    if (number(duplicates[0].n) || number(assignedDuplicates[0].n)) throw new Error('Repeated unit identities make source/assignment lineage ambiguous.');
    const mixedContracts = await query('SELECT contract_id FROM admitted GROUP BY contract_id HAVING count(DISTINCT cohort)>1 LIMIT 1');
    if (mixedContracts.length) throw new Error('One contract appears in more than one discovery cohort; lineage requires clarification.');
    const assignmentBoundary = await query("SELECT count(*) AS n FROM assigned a LEFT JOIN admitted u ON u.id=a.id WHERE u.id IS NULL OR json_extract_string(a.payload,'$.partition') IS NULL OR json_extract_string(a.payload,'$.partition')!='fit' OR json_extract_string(a.payload,'$.unit_id') IS NULL OR json_extract_string(a.payload,'$.unit_id')!=a.id");
    if (number(assignmentBoundary[0].n)) throw new Error('Primary assignment references a reserve, non-admitted or mismatched unit.');
    if (admission.input?.extraction_manifest_path) {
      const path = await studyPath(runDir, admission.input.extraction_manifest_path);
      extraction = await readJSON(runDir, admission.input.extraction_manifest_path);
      const file=await hashFile(path),{manifest_path,...body}=extraction;
      const binding=admission.input.extraction_manifest_file;
      if(binding&&(binding.sha256!==file.sha256||binding.bytes!==file.bytes))throw new Error('Extraction manifest byte hash mismatch.');
      // Early v0.2 manifests used this field for a canonical JSON digest. Both
      // encodings verify content; newer manifests also bind exact file bytes.
      if(admission.input.extraction_manifest_sha256&&admission.input.extraction_manifest_sha256!==file.sha256&&admission.input.extraction_manifest_sha256!==digest(body))throw new Error('Extraction manifest hash mismatch.');
    }
  } catch (error) { closed = true; db.close(); throw error; }
  try {
  const totals = (await query('SELECT count(*) AS representatives,count(DISTINCT u.contract_id) AS contracts,count(a.id) AS assigned FROM admitted u LEFT JOIN assigned a ON a.id=u.id'))[0];
  const cohortCounts = await query('SELECT cohort,count(*) AS representatives,count(DISTINCT contract_id) AS contracts FROM admitted GROUP BY cohort ORDER BY cohort');
  const primaryRun = geometry.runs?.find(run => run.id === geometry.primary);
  let representationGate={status:'NOT_PASSED_CALIBRATION_IN_PROGRESS',authority:'NONE'};
  const extractionSource=admission.input?.extraction_source_sha256;
  async function currentRepresentationGate() {
    const checked_at=new Date().toISOString();let historical=null;
    if (!/^[a-f0-9]{64}$/.test(extractionSource||'')) return {status:'NOT_PASSED_CALIBRATION_IN_PROGRESS',checked_at,authority:'NONE'};
    const gatePath=`quality-gates/${extractionSource}/gate.json`;
    try {
      try {historical=await readJSON(runDir,gatePath);} catch(error) {if(error.code!=='ENOENT')throw error;}
      await assertNoUnresolvedSourceIssues(runDir,extractionSource);
      if (!historical) return {status:'NOT_PASSED_CALIBRATION_IN_PROGRESS',historical_status:null,checked_at,authority:'NONE'};
      const verified=await verifyCalibrationGate(runDir);
      if (verified.source_sha256!==extractionSource) throw new Error('The current source gate belongs to a different extraction method than this historical view');
      return {...verified,fresh_audit:limitedRecord(historical.fresh_audit),historical_status:historical.status,checked_at,authority:'NONE'};
    } catch(error) {
      return {status:'CURRENT_SOURCE_GATE_NOT_PASSED',historical_status:historical?.status??null,path:historical?gatePath:null,reason:limitedRecord(error.message),checked_at,authority:'NONE'};
    }
  }
  const summary = {
    schema_version: 2, title: 'Priors Derivation Lab — Study 0.2', status: 'PROTOTYPE_RESEARCH_ONLY', authority: 'NONE', adopted_catalog: false,
    run_id: basename(runDir), primary_run: geometry.primary || null,
    data_attribution: { dataset: 'Stanford Material Contract Corpus', source: 'https://mcc.law.stanford.edu/', license: 'CC-BY-NC-SA-4.0', citation: 'Adelson, Peter, and Nyarko, Julian. The Material Contract Corpus. arXiv:2504.02864 (2025).', handling: 'Local noncommercial research; corpus-derived data remains separate from the AGPL prototype source.' },
    counts: { admitted_representatives: number(totals.representatives), represented_contracts: number(totals.contracts), primary_assignments: number(totals.assigned), primary_clusters: primaryRun?.effective_k ?? null },
    cohorts: cohortCounts.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, number(value)]))),
    admission: { status: admission.status, counts: limitedRecord(admission.counts), parameters: limitedRecord(admission.source?.parameters), gates: limitedRecord(admission.gates), memory: limitedRecord(admission.memory), source: limitedRecord(admission.source), input: { extraction_manifest_path: admission.input?.extraction_manifest_path || null, extraction_manifest_sha256: admission.input?.extraction_manifest_sha256 || null, sections_shards: sections?.length || 0 }, repetition: limitedRecord(admission.repetition || admission.repetition_stats || admission.audit?.summary) },
    geometry: { status: geometry.status, primary: geometry.primary, runs: limitedRecord(geometry.runs), reservoir: limitedRecord(geometry.reservoir), identity: limitedRecord(geometry.identity), comparisons: limitedRecord(geometry.comparisons), evaluation: { sha256: geometry.evaluation?.sha256 || null, units: geometry.evaluation?.unit_ids?.length || null }, execution_attested: geometry.execution_attested === true },
    gates: { representation:representationGate, source_identity: 'LISTED_SHARDS_HASH_VERIFIED', assignment_coverage: number(totals.assigned) === number(totals.representatives) ? 'ADMITTED_REPRESENTATIVES_ASSIGNED' : 'INCOMPLETE_PRIMARY_ASSIGNMENT', reserve: 'RESERVE_NOT_EXPOSED_OR_USED_BY_THIS_VIEW', semantic_meaning: 'NOT_VALIDATED_BY_GEOMETRY', human_evaluation: 'NOT_ESTABLISHED_BY_THIS_VIEW', first_priors: 'UNRESOLVED_NOT_SELECTED', study_completion: 'READ_ACTUAL_COUNTS_AND_RUN_GATES; THIS_VIEW_DOES_NOT_CERTIFY_TARGET_COMPLETION' },
    limitations: ['Source evidence and geometric proximity remain distinct from inferred normative meanings.', 'Only actual admitted representatives and their primary assignments appear; variants, exclusions and reserve counts remain separate research artifacts.', 'Geometric similarity and assignment counts do not establish conceptual validity, fairness or candidate importance.', 'The page is bounded; counts are computed from selected source shards, not guessed from the requested study size.', ...(Array.isArray(admission.limitations) ? admission.limitations : [])].slice(0, 32),
  };
  const assetMap = new Map();
  for (const [route, file, type] of [['/', 'index.html', 'text/html; charset=utf-8'], ['/review.html', 'index.html', 'text/html; charset=utf-8'], ['/review.css', 'review.css', 'text/css; charset=utf-8'], ['/review.mjs', 'review.mjs', 'text/javascript; charset=utf-8']]) assetMap.set(route, { bytes: await readFile(fileURLToPath(new URL(file, uiRoot))), type });
  function decodedUnit(row,{completeNavigation=false}={}) {
    const unit = json(row.payload);
    if (!unit || unit.id !== row.id || unit.contract_id !== row.contract_id || unit.cohort !== row.cohort || !allowedCohorts.has(unit.cohort)) throw new Error('Source payload identity or discovery boundary differs from its admitted row.');
    const assignment = row.assignment_payload ? json(row.assignment_payload) : null;
    if (assignment && (assignment.unit_id !== unit.id || assignment.partition !== 'fit')) throw new Error('Primary assignment identity or partition differs from admitted discovery.');
    if (typeof unit.text !== 'string' || unit.text.length > 128000) throw new Error('Admitted source unit exceeds its explicit review text bound.');
    if (unit.sha256 && sha(unit.text) !== unit.sha256) throw new Error('Admitted unit text differs from its retained digest.');
    sourceNavigationLabel(unit);
    const fields = ['id','contract_id','cohort','kind','classification_reason','parent_section_id','start','end','text','heading','heading_path','sha256','word_count','context_before','context_after','normalized_path','family_id','duplicate_family','family_representative_id','representative_id','template_blocking_id','chunk_index','chunk_count','function_tags','warnings'];
    const source = Object.fromEntries(fields.filter(key => unit[key] != null).map(key => [key, unit[key]]));
    if (unit.source_navigation) source.source_navigation=completeNavigation?unit.source_navigation:navigationMetadata(unit.source_navigation);
    source.native_source_evidence=unit.native_source_decorations_ref?{status:'BOUND_NATIVE_SOURCE_EVIDENCE_AVAILABLE_IN_CONTEXT',mapping_status:unit.native_source_decorations_ref.mapping_status,envelope_sha256:unit.native_source_decorations_ref.envelope_sha256,computed_style_verified:false,effectiveness_verified:false}:{status:'UNAVAILABLE_IN_LEGACY_REPRESENTATION',computed_style_verified:false,effectiveness_verified:false};
    const assignmentFields = ['unit_id','contract_id','family_id','partition','label','cluster_id','similarity','second_similarity','margin','outlier'];
    const safeAssignment = assignment ? Object.fromEntries(assignmentFields.filter(key => assignment[key] != null).map(key => [key, assignment[key]])) : null;
    return { ...source, source_url: sourceUrl(unit.source_url), assignment: safeAssignment, evidence_classification: 'RAW_ADMITTED_SOURCE_TEXT', inferred_prior_meaning: null };
  }
  async function findUnit(id,{completeNavigation=false}={}) {
    const rows = await query(`SELECT u.id,u.contract_id,u.cohort,u.kind,u.payload,a.payload AS assignment_payload FROM admitted u LEFT JOIN assigned a ON a.id=u.id WHERE u.id=${sqlQuote(id)} LIMIT 2`);
    if (!rows.length) throw new RequestError('No admitted discovery evidence has this identifier.', 404); return decodedUnit(rows[0],{completeNavigation});
  }
  async function unitsPage(params) {
    const filters = requestFilters(params); const page = pagination(params, filters); const predicates = [];
    if (page.after) predicates.push(`u.id>${sqlQuote(page.after)}`);
    if (filters.query) predicates.push(`strpos(lower(u.payload),lower(${sqlQuote(filters.query)}))>0`);
    if (filters.cohort) predicates.push(`u.cohort=${sqlQuote(filters.cohort)}`);
    if (filters.contract) predicates.push(`u.contract_id=${sqlQuote(filters.contract)}`);
    if (filters.cluster) predicates.push(`a.cluster=${sqlQuote(filters.cluster)}`);
    const rows = await query(`SELECT u.id,u.contract_id,u.cohort,u.kind,u.payload,a.payload AS assignment_payload FROM admitted u LEFT JOIN assigned a ON a.id=u.id ${predicates.length ? `WHERE ${predicates.join(' AND ')}` : ''} ORDER BY u.id LIMIT ${page.limit + 1}`);
    const more = rows.length > page.limit; const selected = rows.slice(0, page.limit); const items = selected.map(decodedUnit);
    return { items, page_size: page.limit, returned: items.length, next_cursor: more ? page.tokenFor(selected.at(-1).id) : null, filters, authority: 'NONE' };
  }
  async function contractsPage(params) {
    const filters = requestFilters(params); const page = pagination(params, { query: filters.query, cohort: filters.cohort, contract: filters.contract, kind: 'contracts' }); const predicates = [];
    if (page.after) predicates.push(`u.contract_id>${sqlQuote(page.after)}`);
    if (filters.query) predicates.push(`strpos(lower(u.contract_id),lower(${sqlQuote(filters.query)}))>0`);
    if (filters.cohort) predicates.push(`u.cohort=${sqlQuote(filters.cohort)}`);
    if (filters.contract) predicates.push(`u.contract_id=${sqlQuote(filters.contract)}`);
    const rows = await query(`SELECT u.contract_id AS id,u.cohort,count(*) AS representatives,any_value(json_extract_string(u.payload,'$.source_url')) AS source_url FROM admitted u ${predicates.length ? `WHERE ${predicates.join(' AND ')}` : ''} GROUP BY u.contract_id,u.cohort ORDER BY u.contract_id LIMIT ${page.limit + 1}`);
    const more = rows.length > page.limit; const items = rows.slice(0, page.limit).map(row => ({ ...row, representatives: number(row.representatives), source_url: sourceUrl(row.source_url) }));
    return { items, returned: items.length, next_cursor: more ? page.tokenFor(items.at(-1).id) : null, authority: 'NONE' };
  }
  async function clustersPage(params) {
    const page = pagination(params, { kind: 'clusters', primary: geometry.primary }); const after = page.after ? `WHERE a.cluster>${sqlQuote(page.after)}` : '';
    const rows = await query(`SELECT a.cluster AS id,count(*) AS representatives,count(DISTINCT u.contract_id) AS contracts,avg(CAST(json_extract(a.payload,'$.similarity') AS DOUBLE)) AS mean_cosine_similarity FROM assigned a JOIN admitted u ON u.id=a.id ${after} GROUP BY a.cluster ORDER BY a.cluster LIMIT ${page.limit + 1}`);
    const more = rows.length > page.limit; const items = rows.slice(0, page.limit).map(row => ({ ...row, representatives: number(row.representatives), contracts: number(row.contracts), classification: 'GEOMETRIC_GROUP; NO_PRIOR_MEANING_ASSIGNED' }));
    return { items, returned: items.length, next_cursor: more ? page.tokenFor(items.at(-1).id) : null, primary_run: geometry.primary, authority: 'NONE' };
  }
  async function nativeContext(unit,text){
    const receipt=extraction?.cache?.find(item=>item.id===unit.contract_id);
    const unavailable=({start,end})=>({status:'UNAVAILABLE_IN_LEGACY_REPRESENTATION',range:{start,end},computed_style_verified:false,effectiveness_verified:false});
    if(!receipt)return unavailable;
    const path=await studyPath(runDir,receipt.path),actual=await hashFile(path);if(actual.sha256!==receipt.sha256||actual.bytes!==receipt.bytes)throw new Error('Native review cache receipt differs');
    const cache=await readJSON(runDir,receipt.path,{maxBytes:64*1024**2});
    if(!cache.native_source_decorations)return unavailable;
    if(cache.contract?.id!==unit.contract_id||cache.normalized_sha256!==sha(text)||cache.normalized_text!==text)throw new Error('Native review contract binding differs');
    if(typeof cache.contract.raw_path!=='string')throw new Error('Native review raw-source path unavailable');
    const rawPath=await studyPath(runDir,relative(runDir,cache.contract.raw_path)),rawBytes=await readFile(rawPath);if(sha(rawBytes)!==cache.raw_sha256)throw new Error('Native review raw-source bytes differ');
    const envelope=await loadNativeDecoration(runDir,cache.native_source_decorations),ref=unit.native_source_evidence;
    if(ref?.envelope_sha256!==envelope.sha256)throw new Error('Admitted native review reference differs');
    const view=createNativeDecorationView(envelope,{raw:rawBytes.toString('utf8'),normalizedText:text});
    return ({start,end,allStyles,terminal})=>(allStyles?view.project:view.projectRelevant)({start,end,maxRuns:2048,maxCharacters:100000,maxOrigins:16384,includeEndZeroWidth:terminal});
  }
  async function context(params) {
    const unit = await findUnit(idText(params.get('unit'), 'unit'),{completeNavigation:true}); const maximum = integer(params.get('max_chars') || 12000, 1000, 20000, 'max_chars');
    let parent = null;
    if (sections && unit.parent_section_id) { const rows = await query(`SELECT payload FROM sections WHERE id=${sqlQuote(unit.parent_section_id)} LIMIT 2`); if (rows.length > 1) throw new Error('Parent section identity is repeated.'); if (rows.length) parent = json(rows[0].payload); }
    if (parent && parent.contract_id !== unit.contract_id) throw new Error('Parent section belongs to a different contract.');
    const parentMetadata = parent ? Object.fromEntries(['id','contract_id','start','end','heading','heading_path','kind','classification_reason','sha256','warnings','completeness','governor_frames'].filter(key => parent[key] != null).map(key => [key, limitedRecord(parent[key])])) : null;
    const sourcePath = unit.normalized_path || parent?.normalized_path;
    if (!sourcePath) return { unit_id: unit.id, contract_id: unit.contract_id, source_url: unit.source_url, parent: parentMetadata, representation_gate:await currentRepresentationGate(), context_before: unit.context_before || '', context_after: unit.context_after || '', excerpt: null, context_status: 'RECORDED_NEIGHBORS_ONLY; NORMALIZED_PARENT_UNAVAILABLE' };
    const path = await studyPath(runDir, sourcePath); if ((await stat(path)).size > 8 * 1024 * 1024) throw new Error('Normalized contract exceeds the explicit review context bound.');
    const text = await readFile(path, 'utf8');
    if (!Number.isSafeInteger(unit.start) || !Number.isSafeInteger(unit.end) || unit.start < 0 || unit.end > text.length || text.slice(unit.start, unit.end) !== unit.text) throw new Error('Admitted unit does not match its exact normalized source offsets.');
    const record = extraction?.contract_records?.find(item => item.id === unit.contract_id); const normalizedHash = sha(Buffer.from(text));
    verifySourceNavigation(unit,text);
    if (record?.normalized_sha256 && record.normalized_sha256 !== normalizedHash) throw new Error('Normalized contract digest differs from extraction provenance.');
    const startBound = parent && Number.isSafeInteger(parent.start) ? parent.start : Math.max(0, unit.start - 3000); const endBound = parent && Number.isSafeInteger(parent.end) ? parent.end : Math.min(text.length, unit.end + 3000);
    if (startBound < 0 || endBound > text.length || startBound > unit.start || endBound < unit.end) throw new Error('Parent context bounds do not contain the admitted unit.');
    if (parent?.sha256 && sha(text.slice(startBound, endBound)) !== parent.sha256) throw new Error('Parent section digest differs from its normalized source span.');
    const start = params.has('start') ? integer(params.get('start'), startBound, endBound, 'start') : Math.max(startBound, Math.min(unit.start, endBound - maximum)); let end = Math.min(endBound, start + maximum);
    const splitsPoint=offset=>offset>0&&offset<text.length&&/[\uD800-\uDBFF]/u.test(text[offset-1])&&/[\uDC00-\uDFFF]/u.test(text[offset]);if(splitsPoint(start))throw new RequestError('Source page starts inside a Unicode codepoint.');if(splitsPoint(end))end--;
    const allStyles=params.get('native_styles')==='all';if(params.has('native_styles')&&!['all','relevant'].includes(params.get('native_styles')))throw new RequestError('Native source style mode must be relevant or all.');
    const projectNative=await nativeContext(unit,text);let nativeSource,reduced=false;
    for(;;){try{nativeSource=projectNative({start,end,allStyles,terminal:end===endBound});break;}catch(error){if(!error.message.includes('Native decoration projection exceeds explicit bound')||end-start<=2)throw error;end=start+Math.max(1,Math.floor((end-start)/2));if(splitsPoint(end))end--;if(end<=start)throw error;reduced=true;}}
    return { unit_id: unit.id, contract_id: unit.contract_id, parent_section_id: unit.parent_section_id || null, source_url: unit.source_url, raw_source_sha256: record?.raw_sha256 || null, normalized_source_sha256: normalizedHash, normalized_hash_bound_to_extraction: !!record?.normalized_sha256, offsets: 'Normalized JavaScript UTF-16 string offsets, not raw source byte offsets', parent: parentMetadata, source_navigation:navigationMetadata(unit.source_navigation), representation_gate:await currentRepresentationGate(), context_before: unit.context_before || '', context_after: unit.context_after || '',
      native_source_decorations:nativeSource,
      excerpt: { text: text.slice(start, end), start, end, parent_start: startBound, parent_end: endBound, complete_parent: !!parent && start === startBound && end === endBound, truncated: start > startBound || end < endBound, next_start: end < endBound ? end : null,requested_max_characters:maximum,page_reduced_for_native_evidence:reduced }, context_status: parent ? 'VERIFIED_UNIT_WITH_RETAINED_PARENT_BOUNDS' : 'VERIFIED_UNIT_WITH_BOUNDED_NEIGHBORS; PARENT_NOT_FOUND' };
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', localReviewCsp()); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const respond = (code, value, type = 'application/json; charset=utf-8') => { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)); res.writeHead(code, { 'Content-Type': type, 'Content-Length': bytes.length }); res.end(req.method === 'HEAD' ? undefined : bytes); };
    try {
      if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); respond(405, { error: 'This research review is read-only.' }); return; }
      const target = (req.url || '').split('?', 1)[0]; const asset = assetMap.get(target); if (asset) { respond(200, asset.bytes, asset.type); return; }
      if (!['/api/summary', '/api/units', '/api/unit', '/api/context', '/api/contracts', '/api/clusters'].includes(target)) throw new RequestError('No review artifact at this route.', 404);
      const params = new URL(req.url, 'http://127.0.0.1').searchParams;
      if (target === '/api/summary') respond(200, {...summary,gates:{...summary.gates,representation:await currentRepresentationGate()}});
      else if (target === '/api/units') respond(200, await unitsPage(params));
      else if (target === '/api/unit') respond(200, await findUnit(idText(params.get('id'), 'id')));
      else if (target === '/api/context') respond(200, await context(params));
      else if (target === '/api/contracts') respond(200, await contractsPage(params));
      else respond(200, await clustersPage(params));
    } catch (error) { if (!(error instanceof RequestError)) log(`Review validation failure: ${error.message}`); respond(error.status || 500, { error: error instanceof RequestError ? error.message : 'Requested evidence failed validation; the local run is preserved.' }); }
  });
  server.once('close', () => { queue.finally(() => { if (!closed) { closed = true; db.close(); } }); });
  server.reviewSummary = summary;
  return server;
  } catch (error) { if (!closed) { closed = true; db.close(); } throw error; }
}

export async function serveStudy(runDir, { admission, geometry, host = '127.0.0.1', port = 4173, log = console.log } = {}) {
  if (typeof host !== 'string' || !host || !Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('Specify a host and valid port; production review defaults to loopback 4173.');
  const server = await createStudyReviewServer(runDir, { admission, geometry, log });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); }); }
  catch (error) { server.emit('close'); throw error; }
  const address = server.address(); log(`Priors Derivation Lab — Study 0.2 / PROTOTYPE / RESEARCH ONLY at ${host}:${address.port}`);
  return { server, address, summary: server.reviewSummary, url: `http://${host}:${address.port}/review.html`, close: () => new Promise(resolve => server.close(resolve)) };
}
