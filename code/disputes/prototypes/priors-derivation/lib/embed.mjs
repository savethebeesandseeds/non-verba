// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { sha256, digest, writeJSON, requireContainer, regularFile } from './common.mjs';

const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model.onnx', 'README.md'];

export function normalizeVector(vector) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Invalid embedding norm');
  return vector.map(value => value / norm);
}

// Split on whitespace boundaries and measure actual tokenizer input, including specials.
// Every original word enters a window whose measured size is within model capacity.
export function embeddingWindows(text, countTokens, maxTokens = 256, overlapWords = 16) {
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 8) throw new Error('Invalid token limit');
  const words = text.match(/\S+/gu) ?? []; const windows = []; let start = 0; let previousEnd = 0;
  while (start < words.length) {
    let low = start + 1; let high = words.length; let end = start;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2); const count = countTokens(words.slice(start, middle).join(' '));
      if (count <= maxTokens) { end = middle; low = middle + 1; } else high = middle - 1;
    }
    if (end === start) throw new Error('A single word exceeds the embedding token limit; retain as failed rather than truncate');
    const input = words.slice(start, end).join(' ');
    const tokens = countTokens(input);
    windows.push({ text: input, tokens, word_start: start, word_end: end, weight: end - Math.max(start, previousEnd), sha256: sha256(input) });
    previousEnd = end;
    if (end === words.length) break;
    start = Math.max(start + 1, end - Math.min(overlapWords, end - start - 1));
  }
  return windows;
}

export async function provisionModel(config, { log = console.log } = {}) {
  requireContainer();
  const base = '/opt/nonverba-tools/priors-derivation-0.1/models';
  const directory = resolve(base, config.repository, config.revision);
  if (!directory.startsWith(`${base}/`) || !/^[a-f0-9]{40}$/.test(config.revision)) throw new Error('Model must use an exact allowed revision');
  await mkdir(directory, { recursive: true });
  const infoURL = `https://huggingface.co/api/models/${config.repository}/revision/${config.revision}?blobs=true`;
  const response = await fetch(infoURL, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Model metadata HTTP_${response.status}`);
  const info = await response.json();
  if (info.sha !== config.revision || info.cardData?.license !== 'apache-2.0') throw new Error('Model revision/license metadata changed');
  const files = []; let downloadedBytes = 0;
  for (const name of MODEL_FILES) {
    const metadata = info.siblings.find(file => file.rfilename === name);
    if (!metadata) throw new Error(`Pinned model lacks required file ${name}`);
    const path = resolve(directory, name); await mkdir(dirname(path), { recursive: true });
    let existing = false;
    try { await regularFile(path); existing = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!existing) {
      log(`Provisioning pinned embedding artifact ${name}`);
      const r = await fetch(`https://huggingface.co/${config.repository}/resolve/${config.revision}/${name}`, { signal: AbortSignal.timeout(180000) });
      if (!r.ok) throw new Error(`Model artifact HTTP_${r.status}: ${name}`);
      const chunks = []; let bytes = 0;
      for await (const chunk of r.body) { bytes += chunk.byteLength; if (bytes > 128 * 1024 * 1024) throw new Error('Embedding model artifact exceeds prototype size limit'); chunks.push(Buffer.from(chunk)); }
      const buffer = Buffer.concat(chunks);
      if (metadata.size && buffer.length !== metadata.size) throw new Error(`Pinned artifact size mismatch: ${name}`);
      if (metadata.lfs?.sha256 && sha256(buffer) !== metadata.lfs.sha256) throw new Error(`Pinned LFS digest mismatch: ${name}`);
      await writeFile(path, buffer, { flag: 'wx' }); downloadedBytes += buffer.length;
    }
    const bytes = await readFile(path); const hash = sha256(bytes);
    if (metadata.size && bytes.length !== metadata.size || metadata.lfs?.sha256 && hash !== metadata.lfs.sha256) throw new Error(`Retained model artifact does not match revision: ${name}`);
    if (!metadata.lfs && metadata.blobId) {
      const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (blob !== metadata.blobId) throw new Error(`Pinned Git blob digest mismatch: ${name}`);
    }
    files.push({ path: name, sha256: hash, bytes: bytes.length, upstream_blob_id: metadata.blobId ?? null, upstream_lfs_sha256: metadata.lfs?.sha256 ?? null });
  }
  const manifest = { schema_version: 1, ...config, directory, files, file_set_sha256: digest(files), downloaded_bytes: downloadedBytes, metadata_url: infoURL, observed_at: new Date().toISOString(), execution_attested: false };
  const manifestPath = resolve(directory, 'provisioning.json');
  try { await stat(manifestPath); } catch (error) { if (error.code !== 'ENOENT') throw error; await writeJSON(manifestPath, manifest); }
  return manifest;
}

export async function createEmbedder(config, { log = console.log } = {}) {
  const model = await provisionModel(config, { log });
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false; env.allowLocalModels = true;
  env.useFSCache = false; env.useBrowserCache = false; env.useCustomCache = false;
  env.cacheDir = '/opt/nonverba-tools/priors-derivation-0.1/cache';
  const extractor = await pipeline('feature-extraction', model.directory, { device: 'cpu', dtype: config.dtype, session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } });
  if (Number.isFinite(extractor.tokenizer.model_max_length) && config.max_tokens > extractor.tokenizer.model_max_length) throw new Error('Declared embedding token window exceeds tokenizer context');
  const tokenCount = text => extractor.tokenizer.encode(text).length;
  const embed = async (texts, { onVector = async () => {} } = {}) => {
    const vectors = []; const inputs = [];
    for (let i = 0; i < texts.length; i++) {
      const windows = embeddingWindows(texts[i], tokenCount, config.max_tokens);
      const tensor = await extractor(windows.map(window => window.text), { pooling: config.pooling, normalize: true });
      const matrix = tensor.tolist();
      if (matrix.length !== windows.length || matrix.some(vector => vector.length !== config.dimensions || vector.some(value => !Number.isFinite(value)))) throw new Error('Embedding output dimensions/values do not match declared model');
      const totalWeight = windows.reduce((sum, window) => sum + window.weight, 0);
      const mean = new Array(config.dimensions).fill(0);
      for (let w = 0; w < windows.length; w++) for (let d = 0; d < mean.length; d++) mean[d] += matrix[w][d] * windows[w].weight / totalWeight;
      vectors.push(normalizeVector(mean)); inputs.push({ input_sha256: sha256(texts[i]), windows });
      await onVector({ index: i, vector: vectors.at(-1), input: inputs.at(-1) });
      if ((i + 1) % 100 === 0 || i + 1 === texts.length) log(`Embedded ${i + 1}/${texts.length} contextual units`);
    }
    return { vectors, inputs };
  };
  return { model, embed, dispose: () => extractor.dispose(), tokenCount };
}
