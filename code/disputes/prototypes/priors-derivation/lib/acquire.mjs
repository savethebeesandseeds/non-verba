// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sha256, digest, stableId, writeJSON, within, requireContainer } from './common.mjs';

export const ORIGIN = 'https://mcc.law.stanford.edu';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function contractURLs(key) {
  if (typeof key !== 'string' || !/^\d+\/\d{18}\/[A-Za-z0-9_.-]+$/.test(key)) throw new Error('Unsupported corpus document key');
  if (['.', '..'].includes(key.split('/').at(-1))) throw new Error('Unsupported corpus document key');
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  return { corpus: `${ORIGIN}/data/${encoded}`, original: `https://www.sec.gov/Archives/edgar/data/${encoded}` };
}

export async function boundedFetch(url, { maxBytes, fetcher = fetch, retries = 2 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('A positive byte limit is required');
  const parsed = new URL(url);
  if (parsed.origin !== ORIGIN || parsed.username || parsed.password) throw new Error('Corpus downloads must use the verified HTTPS corpus origin');
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetcher(url, { redirect: 'error', signal: controller.signal, headers: { 'User-Agent': 'Nonverba-Priors-Derivation-Research/0.1' } });
      if ([429, 502, 503, 504].includes(response.status) && attempt < retries) {
        await response.body?.cancel(); await sleep(1000 * 2 ** attempt); continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP_${response.status}: ${url}`); }
      const length = Number(response.headers.get('content-length'));
      if (length > maxBytes) { await response.body?.cancel(); throw new Error(`BYTE_LIMIT: declared ${length} > ${maxBytes}`); }
      const parts = []; let bytes = 0;
      if (!response.body) throw new Error('Missing response body');
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > maxBytes) { controller.abort(); throw new Error(`BYTE_LIMIT: response exceeded ${maxBytes}`); }
        parts.push(Buffer.from(chunk));
      }
      const content = Buffer.concat(parts);
      return { content, bytes, sha256: sha256(content), content_type: response.headers.get('content-type'), etag: response.headers.get('etag'), fetched_at: new Date().toISOString(), url, attempts: attempt + 1 };
    } catch (error) {
      if (attempt >= retries || /BYTE_LIMIT|HTTP_4\d\d/.test(error.message)) throw error;
      await sleep(1000 * 2 ** attempt);
    } finally { clearTimeout(timeout); }
  }
}

// Seeded ordering within type and chronological strata; labels remain unverified metadata.
export function selectSample(rows, recipe, count = 100) {
  const strata = recipe.strata;
  if (!Number.isSafeInteger(count) || count < 1 || count > recipe.limits.max_contracts) throw new Error('Sample size outside prototype limits');
  const selected = []; const used = new Map(); const keys = new Set(); const plan = [];
  const total = strata.reduce((sum, s) => sum + s.count, 0);
  const quotas = strata.map(s => Math.floor(count * s.count / total));
  for (let left = count - quotas.reduce((a, b) => a + b, 0), i = 0; left > 0; left--, i++) quotas[i % quotas.length]++;
  const bins = [{ id: '2000-2009', min: 2000, max: 2009 }, { id: '2010-2019', min: 2010, max: 2019 }, { id: '2020-2025', min: 2020, max: 2025 }];
  for (let s = 0; s < strata.length; s++) {
    const label = strata[s].label; const target = quotas[s];
    const pools = bins.map(bin => rows.filter(row => row.label === label && Number(row.year) >= bin.min && Number(row.year) <= bin.max)
      .sort((a, b) => digest([recipe.seed, a.doc_key]).localeCompare(digest([recipe.seed, b.doc_key]))));
    const positions = bins.map(() => 0); let received = 0;
    // Round robin avoids allowing one era to supply the entire stratum.
    let progressed = true;
    while (received < target && progressed) {
      progressed = false;
      for (let b = 0; b < bins.length && received < target; b++) {
        while (positions[b] < pools[b].length) {
          const row = pools[b][positions[b]++]; const cik = String(row.cik ?? row.doc_key.split('/')[0]);
          if (keys.has(row.doc_key) || (used.get(cik) ?? 0) >= recipe.max_per_filer) continue;
          contractURLs(row.doc_key);
          keys.add(row.doc_key); used.set(cik, (used.get(cik) ?? 0) + 1); received++; progressed = true;
          selected.push({ ...row, cik, sampling_stratum: `${label}:${bins[b].id}`, selection_rank: received, id: stableId('contract', row.doc_key) });
          break;
        }
      }
    }
    plan.push({ label, requested: target, selected: received, shortfall: target - received });
  }
  return { selected, plan, method: 'seeded SHA-256 ordering; round-robin contract-type/era strata; global filer cap; no keyword filter', shortfall: count - selected.length };
}

function quote(value) { return `'${String(value).replaceAll("'", "''")}'`; }

export async function acquire(runDir, config, { count = 100, log = console.log } = {}) {
  requireContainer();
  runDir = resolve(runDir);
  if (!runDir.startsWith('/opt/nonverba-build/priors-derivation/')) throw new Error('Pilot outputs must stay in the existing managed prototype build area');
  await mkdir(runDir); // Existing runs are immutable; never reset or silently resume one.
  await mkdir(within(runDir, 'raw')); await mkdir(within(runDir, 'sources'));
  const sourceRecords = [];
  const save = async (url, name, maxBytes) => {
    const record = await boundedFetch(url, { maxBytes });
    const path = within(runDir, `sources/${name}`); await writeFile(path, record.content, { flag: 'wx' });
    const { content, ...info } = record; sourceRecords.push({ ...info, path: `sources/${name}` }); return record;
  };
  await writeJSON(within(runDir, 'config.json'), config);
  log('Acquiring source description, license and pinned corpus manifest');
  const homepage = await save(`${ORIGIN}/`, 'corpus-home.html', 1024 * 1024);
  const codebook = await save(`${ORIGIN}${config.corpus.codebook_path}`, 'codebook.md', 1024 * 1024);
  if (!homepage.content.toString('utf8').includes('creativecommons.org/licenses/by-nc-sa/4.0') || !codebook.content.toString('utf8').includes('CC BY-NC-SA 4.0')) throw new Error('Corpus license description changed; preserve source and review before downloading data');
  const manifestRecord = await save(`${ORIGIN}${config.corpus.manifest_path}`, 'corpus-manifest.json', 1024 * 1024);
  const manifest = JSON.parse(manifestRecord.content.toString('utf8'));
  if (!/^[A-Za-z0-9_-]+$/.test(manifest.version)) throw new Error('Unsupported corpus release identifier');
  const metadataURL = `${ORIGIN}/index/v=${encodeURIComponent(manifest.version)}/index.parquet`;
  log(`Acquiring bounded metadata index for ${manifest.version}`);
  const metadata = await save(metadataURL, 'index.parquet', config.sampling.limits.metadata_bytes);
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const instance = await DuckDBInstance.create(':memory:', { threads: '2', memory_limit: '512MB' });
  const connection = await instance.connect();
  let rows, populations;
  try {
    const metadataPath = quote(within(runDir, 'sources/index.parquet'));
    const description = await connection.runAndReadAll(`DESCRIBE SELECT * FROM read_parquet(${metadataPath})`);
    const columns = description.getRowObjectsJS().map(row => row.column_name);
    await writeJSON(within(runDir, 'sources/metadata-schema.json'), columns);
    const required = ['doc_key', 'year', 'quarter', 'label', 'content_type', 'company_name', 'form_type', 'date_filed', 'restate', ...config.sampling.exclude_flags];
    if (required.some(name => !columns.includes(name))) throw new Error('Corpus metadata schema changed; refuse guessed mappings');
    const eligible = `year BETWEEN 2000 AND 2025 AND label IN (${config.sampling.strata.map(s => quote(s.label)).join(',')}) AND content_type IN (${config.sampling.formats.map(quote).join(',')}) AND ${config.sampling.exclude_flags.map(flag => `NOT coalesce(${flag}, false)`).join(' AND ')}`;
    const populationReader = await connection.runAndReadAll(`SELECT label, (year // 10) * 10 AS decade, count(*)::INTEGER AS count FROM read_parquet(${metadataPath}) WHERE ${eligible} GROUP BY 1,2 ORDER BY 1,2`);
    populations = populationReader.getRowObjectsJS();
    // A generous deterministic candidate pool per type/era, never a full corpus-text download.
    const poolReader = await connection.runAndReadAll(`WITH eligible AS (SELECT doc_key, year::INTEGER AS year, quarter, CAST(date_filed AS VARCHAR) AS date_filed, company_name, form_type, label, content_type, amend, restate, joinder, termination, row_number() OVER (PARTITION BY label, year // 10 ORDER BY sha256(${quote(config.sampling.seed)} || doc_key)) AS sample_rank FROM read_parquet(${metadataPath}) WHERE ${eligible}) SELECT * EXCLUDE(sample_rank) FROM eligible WHERE sample_rank <= ${Math.max(200, count * 8)} ORDER BY label,year,doc_key`);
    rows = poolReader.getRowObjectsJS();
  } finally { connection.closeSync(); instance.closeSync(); }
  const sampling = selectSample(rows, config.sampling, count);
  await writeJSON(within(runDir, 'sample.json'), { schema_version: 1, corpus_version: manifest.version, metadata_sha256: metadata.sha256, seed: config.sampling.seed, populations, ...sampling });
  const records = []; const failures = []; let totalBytes = 0;
  for (const row of sampling.selected) {
    const urls = contractURLs(row.doc_key);
    try {
      const record = await boundedFetch(urls.corpus, { maxBytes: Math.min(config.sampling.limits.contract_bytes, config.sampling.limits.total_contract_bytes - totalBytes) });
      const path = `raw/${row.id}.${row.content_type === 'text/plain' ? 'txt' : 'html'}`;
      await writeFile(within(runDir, path), record.content, { flag: 'wx' }); totalBytes += record.bytes;
      const { content, ...info } = record;
      records.push({ ...row, source_url: urls.original, corpus_url: urls.corpus, format: row.content_type === 'text/plain' ? 'text' : 'html', path, acquisition: info });
      log(`Downloaded ${records.length}/${sampling.selected.length}: ${row.id} (${record.bytes} bytes)`);
    } catch (error) {
      failures.push({ id: row.id, doc_key: row.doc_key, url: urls.corpus, stage: 'acquisition', error: error.message, at: new Date().toISOString() });
      log(`Retained acquisition failure for ${row.id}: ${error.message}`);
    }
    await sleep(150);
  }
  const acquisition = { schema_version: 1, status: records.length ? 'ACQUIRED' : 'NO_CONTRACTS_ACQUIRED', acquired_at: new Date().toISOString(), corpus: config.corpus, corpus_version: manifest.version, corpus_generated_at: manifest.generated_at, source_records: sourceRecords, config_sha256: sha256(await readFile(within(runDir, 'config.json'))), sample_sha256: sha256(await readFile(within(runDir, 'sample.json'))), records, failures, bytes: totalBytes, sample_shortfall: sampling.shortfall, replacements: 'none; failed selections remain failures', limits: config.sampling.limits };
  await writeJSON(within(runDir, 'acquisition.json'), acquisition);
  await writeFile(within(runDir, 'DATA_NOTICE.txt'), `${config.corpus.citation}\n${ORIGIN}\nCorpus data and derived research outputs: CC BY-NC-SA 4.0.\nhttps://creativecommons.org/licenses/by-nc-sa/4.0/\nLocal noncommercial research prototype. No commercial permission is claimed.\nOriginal SEC contract authors may retain rights in their material.\nPrototype source is separately AGPL-3.0-only; its license does not relicense corpus data or model weights.\n`, { flag: 'wx' });
  return acquisition;
}
