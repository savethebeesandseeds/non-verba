// SPDX-License-Identifier: AGPL-3.0-only
// Fetch requester/verifier-owned public Android trust data. No enrollment or
// private data is sent. A snapshot is neither a signed revocation statement nor
// a device/sensor verdict. Existing files are never replaced.
import {createHash, randomBytes, X509Certificate} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {request as httpsRequest} from 'node:https';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const ROOTS_URL = 'https://android.googleapis.com/attestation/root';
export const STATUS_URL = 'https://android.googleapis.com/attestation/status';
export const MAX_BYTES = 2 * 1024 * 1024;
export const KNOWN_PINS = Object.freeze([
  'feb2ea7551ee316ed4bb443c8293b884dbfdea40b603ee3e4f4a897e4580fbae',
  '3ee44512a1af2beb39c889490c60ea3f82e43f5d5a5532f5ab9419f676cd07ec',
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function requireContainer() {
  if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') {
    throw new Error('Run this tool through code/dev.ps1 inside non-verba-dev.');
  }
}
export function validateFreshness(value) {
  if (!Number.isInteger(value) || value < 1 || value > 3600) throw new Error('Freshness must be an integer from 1 to 3600 seconds.');
  return value;
}
export function cacheBudget(headers, freshnessSeconds) {
  validateFreshness(freshnessSeconds);
  const ageText = headers.age ?? '0';
  if (typeof ageText !== 'string' || !/^\d+$/.test(ageText)) throw new Error('Invalid trust endpoint Age header.');
  const age = Number(ageText);
  if (!Number.isSafeInteger(age)) throw new Error('Invalid trust endpoint Age header.');
  const control = headers['cache-control'] ?? '';
  if (typeof control !== 'string') throw new Error('Invalid trust endpoint Cache-Control header.');
  const maxAgeParts = control.split(',').map(value => value.trim()).filter(value => /^max-age(?:\s*=|$)/i.test(value));
  if (maxAgeParts.length > 1) throw new Error('Ambiguous trust endpoint max-age.');
  let maxAge = 300;
  if (maxAgeParts.length) {
    const match = /^max-age\s*=\s*(?:"(\d+)"|(\d+))$/i.exec(maxAgeParts[0]);
    if (!match) throw new Error('Invalid trust endpoint max-age.');
    maxAge = Number(match[1] ?? match[2]);
    if (!Number.isSafeInteger(maxAge)) throw new Error('Invalid trust endpoint max-age.');
  }
  const remaining = Math.min(freshnessSeconds, maxAge - age);
  if (remaining <= 0) throw new Error('The trust endpoint returned expired cache data.');
  return remaining;
}

export async function fetchPublicJson(url, freshnessSeconds) {
  requireContainer();
  validateFreshness(freshnessSeconds);
  if (url !== ROOTS_URL && url !== STATUS_URL) throw new Error('Unrecognized public trust endpoint.');
  const started = Date.now();
  const startMonotonic = performance.now();
  return new Promise((resolveFetch, rejectFetch) => {
    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectFetch(error); else resolveFetch(value);
    };
    const request = httpsRequest(url, {method: 'GET', rejectUnauthorized: true, maxHeaderSize: 16 * 1024,
      headers: {'Cache-Control': 'no-cache', 'Accept': 'application/json', 'Accept-Encoding': 'identity'}}, response => {
      response.on('error', error => finish(error));
      response.on('aborted', () => finish(new Error('Trust endpoint response was truncated.')));
      // https.request never follows redirects; even another Google URL must fail.
      if (response.statusCode !== 200) {
        request.destroy(new Error(`Trust endpoint did not return HTTP200: ${url} (${response.statusCode})`));
        return;
      }
      try {
        const length = response.headers['content-length'];
        if (length !== undefined && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > MAX_BYTES)) {
          throw new Error('Trust data exceeds its size limit or has an invalid Content-Length.');
        }
        const encoding = response.headers['content-encoding'];
        if (encoding !== undefined && encoding !== 'identity') throw new Error('Unexpected trust endpoint content encoding.');
        const remaining = cacheBudget(response.headers, freshnessSeconds);
        const chunks = [];
        let bytes = 0;
        response.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) { request.destroy(new Error('Trust data exceeds its size limit.')); return; }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (settled) return;
          try {
            if (!response.complete) throw new Error('Trust endpoint response was truncated.');
            const body = Buffer.concat(chunks);
            const text = new TextDecoder('utf-8', {fatal: true}).decode(body);
            const data = JSON.parse(text);
            finish(null, {data, remaining, metadata: {
              url, http_status: response.statusCode, started_at: new Date(started).toISOString(),
              received_at: new Date().toISOString(), duration_ms: Math.ceil(performance.now() - startMonotonic),
              bytes: body.length, sha256: hash(body), headers: {
                date: response.headers.date ?? null, age: response.headers.age ?? null,
                cache_control: response.headers['cache-control'] ?? null,
                content_type: response.headers['content-type'] ?? null,
              }, cache_remaining_seconds: remaining,
            }});
          } catch (error) { finish(error); }
        });
      } catch (error) { request.destroy(error); }
    });
    request.on('error', error => finish(error));
    // Total request time, including DNS/TLS, headers, and the full body.
    timer = setTimeout(() => request.destroy(new Error('Trust endpoint exceeded its 20-second timeout.')), 20_000);
    request.end();
  });
}

export function validateRoots(roots) {
  if (!Array.isArray(roots) || roots.length < 1 || roots.length > 8) throw new Error('Unexpected published root set.');
  const pins = [];
  for (const pem of roots) {
    if (typeof pem !== 'string') throw new Error('Invalid published root certificate.');
    const key = new X509Certificate(pem).publicKey;
    if (!['rsa', 'ec'].includes(key.asymmetricKeyType)) throw new Error('Unsupported published root algorithm.');
    const pin = hash(key.export({type: 'spki', format: 'der'}));
    if (!KNOWN_PINS.includes(pin)) throw new Error('A new attestation root requires an explicit verifier update.');
    if (pins.includes(pin)) throw new Error('Duplicate published root key.');
    pins.push(pin);
  }
  return pins;
}
export function validateRevocation(status) {
  if (!object(status) || !Object.hasOwn(status, 'entries') || !object(status.entries) || Object.keys(status.entries).length > 50000) {
    throw new Error('Invalid revocation list.');
  }
  for (const [serial, entry] of Object.entries(status.entries)) {
    if (!/^[1-9a-f][0-9a-f]{0,39}$/.test(serial) || !object(entry) || !['REVOKED', 'SUSPENDED'].includes(entry.status)) {
      throw new Error('Unexpected revocation entry; no trust snapshot was issued.');
    }
  }
  return status.entries;
}
export function buildSnapshot(roots, status, startedMs, finishedMs, elapsedMs) {
  const rootPins = validateRoots(roots.data);
  const entries = validateRevocation(status.data);
  const snapshotTime = Math.floor(startedMs / 1000);
  const fetched = Math.floor(finishedMs / 1000);
  if (![startedMs, finishedMs, elapsedMs].every(Number.isFinite) || finishedMs < startedMs || elapsedMs < 0 ||
      fetched - snapshotTime > 60 || elapsedMs > 60_000) throw new Error('Trust retrieval exceeded its time budget or the clock moved backwards.');
  const remaining = Math.min(roots.remaining, status.remaining);
  if (!Number.isInteger(remaining) || remaining < 1 || remaining > 3600 || snapshotTime + remaining <= fetched) {
    throw new Error('Trust data expired during retrieval.');
  }
  return {version: 1, profile: 'google-hardware-attestation', root_spki_sha256: rootPins,
    revocation: {fetched_at: snapshotTime, valid_until: snapshotTime + remaining, entries}};
}
export async function writeSnapshot(outputPath, trust, metadata) {
  const path = resolve(outputPath);
  const bytes = Buffer.from(`${JSON.stringify(trust, null, 2)}\n`);
  if (bytes.length > MAX_BYTES) throw new Error('Serialized trust snapshot exceeds the verifier input limit.');
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, bytes, {flag: 'wx'});
  const metadataPath = `${path}.metadata.json`;
  const sha256 = hash(bytes);
  await writeFile(metadataPath, `${JSON.stringify({...metadata, snapshot_sha256: sha256}, null, 2)}\n`, {flag: 'wx'});
  return {path, metadata_path: metadataPath, roots: trust.root_spki_sha256.length,
    revoked_entries: Object.keys(trust.revocation.entries).length,
    fetched_at: trust.revocation.fetched_at, valid_until: trust.revocation.valid_until, sha256};
}
function parseArgs(args) {
  const result = {freshness: 3600};
  const seen = new Set();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!['--output', '--freshness-seconds'].includes(flag) || !args[i + 1] || seen.has(flag)) {
      throw new Error('Usage: node tools/fetch-attestation-trust.mjs [--output PATH] [--freshness-seconds 1..3600]');
    }
    seen.add(flag);
    if (flag === '--output') result.output = args[i + 1];
    else {
      if (!/^\d+$/.test(args[i + 1])) throw new Error('Freshness must be an integer from 1 to 3600 seconds.');
      result.freshness = validateFreshness(Number(args[i + 1]));
    }
  }
  return result;
}
async function main() {
  requireContainer();
  const options = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const monotonicStart = performance.now();
  const roots = await fetchPublicJson(ROOTS_URL, options.freshness);
  validateRoots(roots.data); // Unknown anchors fail before fetching any further data.
  const status = await fetchPublicJson(STATUS_URL, options.freshness);
  const finished = Date.now();
  const elapsed = performance.now() - monotonicStart;
  const trust = buildSnapshot(roots, status, started, finished, elapsed);
  const stamp = new Date(started).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const output = options.output ?? resolve(dirname(fileURLToPath(import.meta.url)),
    `../artifacts/trust/android-trust-${stamp}-${randomBytes(4).toString('hex')}.json`);
  const result = await writeSnapshot(output, trust, {
    version: 1, type: 'nonverba-public-attestation-trust-fetch', managed_container: true,
    started_at: new Date(started).toISOString(), completed_at: new Date(finished).toISOString(),
    duration_ms: Math.ceil(elapsed), requested_freshness_seconds: options.freshness,
    endpoints: [roots.metadata, status.metadata], redirects_followed: false,
    private_data_transmitted: false, device_enrollment_verified: false,
    trust_snapshot_is_signed_revocation_statement: false,
    transport: 'Node HTTPS with default TLS certificate/hostname validation',
  });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error?.message || error); process.exitCode = 1; });
}
