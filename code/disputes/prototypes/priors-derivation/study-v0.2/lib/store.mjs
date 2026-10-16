// SPDX-License-Identifier: AGPL-3.0-only
// Bounded, immutable study artifacts. A local hash is not execution attestation.
import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { link, lstat, mkdir, open, readdir, readFile, stat, unlink } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { digest, sha256, requireContainer } from '../../lib/common.mjs';

export const STUDY_BASE = '/opt/nonverba-build/priors-derivation/study-v0.2';
export const EXTRACTION_CACHE_STORAGE_POLICY = 'lossless-gzip-extraction-cache-v1';
export const MAX_EXTRACTION_CACHE_ENCODED_BYTES = 64 * 1024 ** 2;
export const MAX_EXTRACTION_CACHE_DECODED_BYTES = 64 * 1024 ** 2;
const MAX_CACHE_RECEIPT_BYTES = 64 * 1024;
const CACHE_SERIALIZER = 'UTF8_JSON_STRINGIFY_PRETTY_2_FINAL_LF_V1';
const compressCache = promisify(gzip), decompressCache = promisify(gunzip);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const compressedCache = name => typeof name === 'string' && name.startsWith('extraction-cache/') && name.endsWith('.json.gz');
const MAX_SHARD_BYTES = 128 * 1024 * 1024;
const MAX_SHARD_ROWS = 50_000;
const SQL_TYPES = /^(?:VARCHAR|BOOLEAN|INTEGER|BIGINT|DOUBLE|FLOAT|JSON|TIMESTAMP|DATE)(?:\[\d*\])?$/;
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const identifier = value => `"${value.replaceAll('"', '""')}"`;
const ledgerTimes = new Map();
const TRANSFER_UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const JSON_TRANSFER = new RegExp(`\\.${TRANSFER_UUID}\\.partial$`);
const ROW_TRANSFER = new RegExp(`^rows-${TRANSFER_UUID}\\.(?:ndjson|parquet)$`);
const RAW_TRANSFER = new RegExp(`-${TRANSFER_UUID}\\.partial$`);

function isTransferArtifact(path) {
  const name = basename(path), parent = basename(dirname(path));
  return JSON_TRANSFER.test(name) || parent === 'partials' && ROW_TRANSFER.test(name) || parent === 'raw-partials' && RAW_TRANSFER.test(name);
}

export function validateStudyRoot(value) {
  requireContainer();
  const path = resolve(value);
  if (dirname(path) !== STUDY_BASE || !/^[a-z0-9][a-z0-9_-]{0,95}$/.test(relative(STUDY_BASE, path))) throw new Error('Use one explicit named run below the managed study-v0.2 data root');
  return path;
}

export async function assertUnlinked(path, { missing = false } = {}) {
  const absolute = resolve(path); let current = '/';
  for (const component of absolute.split('/').filter(Boolean)) {
    current = resolve(current, component);
    let info;
    try { info = await lstat(current); } catch (error) { if (missing && error.code === 'ENOENT') return absolute; throw error; }
    if (info.isSymbolicLink()) throw new Error(`Linked study path refused: ${current}`);
    if (current !== absolute && !info.isDirectory()) throw new Error(`Study parent is not a directory: ${current}`);
  }
  return absolute;
}

export async function studyPath(runDir, name, { missing = false, transfer = false } = {}) {
  const root = validateStudyRoot(runDir);
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Study artifact requires a literal relative child path');
  const path = resolve(root, name);
  if (!path.startsWith(`${root}/`)) throw new Error('Study artifact escaped its run');
  if (transfer === true && !isTransferArtifact(path)) throw new Error('Transfer mode requires a canonical transfer filename');
  if (isTransferArtifact(path) && transfer !== true) throw new Error('Committed study artifact cannot use a reserved transfer filename');
  return assertUnlinked(path, { missing });
}

export async function hashFile(path) {
  await assertUnlinked(path);
  if (!(await stat(path)).isFile()) throw new Error('Hash input must be a regular unlinked file');
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path)) { bytes += chunk.length; hash.update(chunk); }
  return { sha256: hash.digest('hex'), bytes };
}

export async function directoryBytes(path) {
  await assertUnlinked(path);
  let bytes = 0;
  for (const item of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, item.name);
    if (item.isSymbolicLink()) throw new Error(`Linked study artifact refused: ${child}`);
    if (item.isDirectory()) bytes += await directoryBytes(child);
    else if (item.isFile()) {
      let info;
      try { info = await lstat(child); } catch (error) {
        // Successful writers unlink only their own transfer files after commit.
        // A live quota scan may have enumerated one just before that unlink.
        if (error.code === 'ENOENT' && isTransferArtifact(child)) continue;
        throw error;
      }
      if (info.isSymbolicLink()) throw new Error(`Linked study artifact refused: ${child}`);
      if (!info.isFile()) throw new Error('Study artifact type changed during storage accounting');
      bytes += info.size;
    }
    else throw new Error('Unsupported study artifact type');
  }
  return bytes;
}

export async function writeJSON(runDir, name, value) {
  digest(value); // Reject nonfinite values and non-JSON objects before writing.
  const path = await studyPath(runDir, name, { missing: true });
  await mkdir(dirname(path), { recursive: true }); await assertUnlinked(dirname(path));
  const partial = `${path}.${randomUUID()}.partial`;
  const file = await open(partial, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
  await link(partial, path); // Atomic exclusive commit; never replace a prior artifact.
  await unlink(partial);
  return { path: name, ...await hashFile(path) };
}

// Read at most the declared bounded length plus one sentinel byte. FileHandle
// reads prevent a file growing after stat from causing an unbounded readFile.
async function boundedBytes(runDir, name, maxBytes, expectedBytes) {
  const path = await studyPath(runDir, name), file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size < 1 || info.size > maxBytes || expectedBytes !== undefined && info.size !== expectedBytes) throw new Error('Extraction cache file exceeds its bound or byte binding');
    const bytes = Buffer.alloc(info.size + 1); let used = 0;
    while (used < bytes.length) {
      const result = await file.read(bytes, used, bytes.length - used, used);
      if (!result.bytesRead) break;
      used += result.bytesRead;
    }
    if (used !== info.size) throw new Error('Extraction cache file changed length during bounded read');
    return bytes.subarray(0, used);
  } finally { await file.close(); }
}

/** New extraction epochs retain the exact former JSON serialization, compressed.
 * Neither this writer nor a retry replaces an existing cache or old JSON epoch.
 * The workflow commits the returned storage metadata in its immutable receipt.
 */
export async function writeExtractionCache(runDir, name, value, { remainingBytes = Number.MAX_SAFE_INTEGER } = {}) {
  if (!compressedCache(name) || !Number.isSafeInteger(remainingBytes) || remainingBytes < 0) throw new Error('Explicit compressed extraction cache path/budget required');
  const path = await studyPath(runDir, name, { missing: true }); digest(value);
  const plain = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  if (plain.length > MAX_EXTRACTION_CACHE_DECODED_BYTES) throw new Error('Extraction cache exceeds explicit decoded bound');
  const bytes = await compressCache(plain, { level: 6 });
  if (bytes.length > MAX_EXTRACTION_CACHE_ENCODED_BYTES) throw new Error('Extraction cache exceeds explicit encoded bound');
  const expected = sha256(bytes); let resumed = false;
  const same = async () => { const old = await boundedBytes(runDir, name, MAX_EXTRACTION_CACHE_ENCODED_BYTES, bytes.length); if (sha256(old) !== expected) throw new Error('Immutable compressed extraction cache differs'); };
  try { await same(); resumed = true; }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (bytes.length * 2 > remainingBytes) throw new Error('Extraction cache exceeds remaining study storage budget');
    await mkdir(dirname(path), { recursive: true }); await assertUnlinked(dirname(path));
    const partial = `${path}.${randomUUID()}.partial`, file = await open(partial, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    try { await link(partial, path); }
    catch (commitError) { if (commitError.code !== 'EEXIST') throw commitError; await same(); resumed = true; }
    await unlink(partial); // Only this successful writer's own transfer.
  }
  return { artifact: { path: name, sha256: expected, bytes: bytes.length }, storage: { schema: EXTRACTION_CACHE_STORAGE_POLICY, encoding: 'gzip', serializer: CACHE_SERIALIZER, decoded_bytes: plain.length, decoded_sha256: sha256(plain) }, resumed, added_bytes: resumed ? 0 : bytes.length };
}

async function readCompressedExtractionCache(runDir, name, maxBytes) {
  const sidecar = await boundedBytes(runDir, `${name}.manifest.json`, MAX_CACHE_RECEIPT_BYTES);
  const receipt = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(sidecar)), storage = receipt.storage;
  if (receipt.path !== name || !hex(receipt.sha256) || !hex(receipt.result_sha256) || !Number.isSafeInteger(receipt.bytes) || receipt.bytes < 1 || receipt.bytes > MAX_EXTRACTION_CACHE_ENCODED_BYTES || storage?.schema !== EXTRACTION_CACHE_STORAGE_POLICY || storage.encoding !== 'gzip' || storage.serializer !== CACHE_SERIALIZER || !Number.isSafeInteger(storage.decoded_bytes) || storage.decoded_bytes < 1 || storage.decoded_bytes > MAX_EXTRACTION_CACHE_DECODED_BYTES || storage.decoded_bytes > maxBytes || !hex(storage.decoded_sha256)) throw new Error('Extraction cache receipt binding or decoded bound differs');
  const bytes = await boundedBytes(runDir, name, MAX_EXTRACTION_CACHE_ENCODED_BYTES, receipt.bytes);
  if (sha256(bytes) !== receipt.sha256) throw new Error('Extraction cache encoded digest differs');
  const plain = await decompressCache(bytes, { maxOutputLength: storage.decoded_bytes });
  if (plain.length !== storage.decoded_bytes || sha256(plain) !== storage.decoded_sha256) throw new Error('Extraction cache decoded byte binding differs');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(plain), value = JSON.parse(text);
  if (JSON.stringify(value, null, 2) + '\n' !== text || digest(value) !== receipt.result_sha256) throw new Error('Extraction cache complete JSON serialization/content digest differs');
  return value;
}

export async function readJSON(runDir, name, { maxBytes = 16 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Study JSON read requires an explicit positive byte bound');
  if (compressedCache(name)) return readCompressedExtractionCache(runDir, name, Math.min(maxBytes, MAX_EXTRACTION_CACHE_DECODED_BYTES));
  if (typeof name === 'string' && name.endsWith('.gz')) throw new Error('Only explicit extraction caches use the study JSON gzip reader');
  const path = await studyPath(runDir, name);
  if ((await stat(path)).size > maxBytes) throw new Error('Study JSON artifact exceeds its explicit read bound');
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function openDatabase({ memory = '512MB' } = {}) {
  requireContainer();
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const database = await DuckDBInstance.create(':memory:', { threads: '1', memory_limit: memory, preserve_insertion_order: 'true' });
  const connection = await database.connect();
  return { connection, close() { connection.closeSync(); database.closeSync(); } };
}

function checkedSchema(schema) {
  if (!schema || Object.getPrototypeOf(schema) !== Object.prototype || !Object.keys(schema).length) throw new Error('Parquet schema must be a nonempty name:type object');
  for (const [name, type] of Object.entries(schema)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) || name === '__study_row_number' || typeof type !== 'string' || !SQL_TYPES.test(type)) throw new Error('Unsupported Parquet column name or SQL type');
  }
  return schema;
}

/** Write one exclusive bounded typed Parquet shard, retaining failed partials. */
export async function writeRows(runDir, name, rows, { schema, maxRows = MAX_SHARD_ROWS, maxBytes = MAX_SHARD_BYTES, totalBytes = 24 * 1024 ** 3 } = {}) {
  if (!name.endsWith('.parquet')) throw new Error('Columnar shard requires a .parquet suffix');
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > MAX_SHARD_ROWS || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_SHARD_BYTES) throw new Error('Invalid bounded shard limits');
  const destination = await studyPath(runDir, name, { missing: true });
  try { await lstat(destination); throw new Error('Existing study shard is immutable'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(dirname(destination), { recursive: true }); await assertUnlinked(dirname(destination));
  const temporary = await studyPath(runDir, `partials/rows-${randomUUID()}.ndjson`, { missing: true, transfer: true });
  await mkdir(dirname(temporary), { recursive: true });
  let count = 0; let inputBytes = 0; let inferred = schema ? checkedSchema(schema) : null;
  const used = await directoryBytes(validateStudyRoot(runDir));
  const input = await open(temporary, 'wx', 0o600);
  try {
    for await (const row of rows) {
      if (!row || Object.getPrototypeOf(row) !== Object.prototype) throw new Error('Parquet rows must be JSON objects');
      if (!inferred) inferred = checkedSchema(Object.fromEntries(Object.keys(row).map(key => [key, 'JSON'])));
      if (Object.keys(row).some(key => !Object.hasOwn(inferred, key))) throw new Error('Row contains a column outside its frozen Parquet schema');
      digest(row);
      const normalized = Object.fromEntries(Object.keys(inferred).map(key => [key, row[key] ?? null]));
      const line = `${JSON.stringify({ __study_row_number: count, ...normalized })}\n`;
      count++; inputBytes += Buffer.byteLength(line);
      if (count > maxRows || inputBytes > maxBytes || used + inputBytes * 2 > totalBytes) throw new Error('Study shard row/byte/storage budget exceeded');
      await input.writeFile(line);
    }
    await input.sync();
  } finally { await input.close(); }
  if (!inferred) throw new Error('An empty shard requires an explicit schema');
  const output = await studyPath(runDir, `partials/rows-${randomUUID()}.parquet`, { missing: true, transfer: true });
  const db = await openDatabase();
  try {
    const types = { __study_row_number: 'BIGINT', ...inferred };
    const columns = `{${Object.entries(types).map(([key, value]) => `${quote(key)}:${quote(value)}`).join(',')}}`;
    const source = count ? `read_json(${quote(temporary)},format='newline_delimited',columns=${columns},maximum_object_size=${maxBytes})` : `(SELECT ${Object.entries(types).map(([key, type]) => `NULL::${type} AS ${identifier(key)}`).join(',')} WHERE false)`;
    await db.connection.run(`COPY (SELECT * FROM ${source}) TO ${quote(output)} (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 2048)`);
  } finally { db.close(); }
  const details = await hashFile(output);
  if (details.bytes > maxBytes || await directoryBytes(validateStudyRoot(runDir)) > totalBytes) throw new Error('Columnar artifact exceeds study storage budget');
  // A destination is never intentionally replaced; callers use one writer per shard.
  try { await lstat(destination); throw new Error('Existing study shard is immutable'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await link(output, destination);
  await unlink(output); await unlink(temporary); // Only this call's successful transfer files.
  return { path: name, rows: count, ...details, schema: inferred, execution_attested: false };
}

/** Stable bounded pages; no whole-corpus JavaScript materialization. */
export async function* readRows(runDir, name, { batchSize = 1000 } = {}) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) throw new Error('Invalid Parquet read batch size');
  const path = await studyPath(runDir, name); const db = await openDatabase();
  try {
    for (let offset = 0; ; offset += batchSize) {
      const result = await db.connection.runAndReadAll(`SELECT to_json(r) AS encoded FROM read_parquet(${quote(path)}) r ORDER BY __study_row_number LIMIT ${batchSize} OFFSET ${offset}`);
      const rows = result.getRowObjectsJS();
      for (const row of rows) { const value = typeof row.encoded === 'string' ? JSON.parse(row.encoded) : row.encoded; delete value.__study_row_number; yield value; }
      if (rows.length < batchSize) break;
    }
  } finally { db.close(); }
}

/** Immutable event files form an append-only ledger, including failed attempts. */
export async function appendLedger(runDir, event, { ledger = 'acquisition' } = {}) {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(ledger) || !event || Object.getPrototypeOf(event) !== Object.prototype || Object.hasOwn(event, 'entry_sha256')) throw new Error('Invalid ledger event');
  const entry = { ...event, recorded_at: new Date().toISOString(), schema_version: 2 };
  entry.entry_sha256 = digest(entry);
  const key = `${validateStudyRoot(runDir)}/${ledger}`;
  if (!ledgerTimes.has(key)) {
    const directory = await studyPath(runDir, `ledger/${ledger}`, { missing: true });
    let files = []; try { files = await readdir(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    ledgerTimes.set(key, files.reduce((maximum,name)=>/^\d{16}-/.test(name)?Math.max(maximum,Number(name.slice(0,16))):maximum,0));
  }
  const ordinal = Math.max(Date.now(), ledgerTimes.get(key) + 1); ledgerTimes.set(key, ordinal);
  const name = `ledger/${ledger}/${ordinal.toString().padStart(16, '0')}-${randomUUID()}.json`;
  await writeJSON(runDir, name, entry);
  return { path: name, ...entry };
}

export async function* readLedger(runDir, { ledger = 'acquisition' } = {}) {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(ledger)) throw new Error('Invalid ledger name');
  const directory = await studyPath(runDir, `ledger/${ledger}`, { missing: true });
  let files; try { files = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const name of files.sort()) {
    if (name.endsWith('.partial')) continue; // Uncommitted event bytes remain retained.
    if (!/^\d{16}-[a-f0-9-]{36}\.json$/.test(name)) throw new Error('Unsupported ledger entry filename');
    const entry = await readJSON(runDir, `ledger/${ledger}/${name}`, { maxBytes: 1024 * 1024 });
    const { entry_sha256, ...body } = entry;
    if (entry_sha256 !== digest(body)) throw new Error('Ledger event digest mismatch');
    yield { path: `ledger/${ledger}/${name}`, ...entry };
  }
}

export const sqlQuote = quote;
