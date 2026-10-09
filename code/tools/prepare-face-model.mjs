// SPDX-License-Identifier: AGPL-3.0-only
// Dependency preparation only; run inside the documented managed Linux container.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, realpath, stat, open, link, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CACHE_PATH = '/opt/nonverba-tools/models/mobilefacenet/foamliu-a6cc9032-qaihub-v0.64.0-ort1.23.2';
const lockPath = fileURLToPath(new URL('../models/mobilefacenet/model-lock.json', import.meta.url));

// A deliberately small read-only ONNX metadata reader. It does not execute a model.
function fields(bytes) {
  const result = [];
  let offset = 0;
  const varint = () => {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (offset >= bytes.length) throw new Error('Truncated ONNX protobuf');
      const byte = bytes[offset++];
      value |= BigInt(byte & 127) << shift;
      if (!(byte & 128)) {
        return value > BigInt(Number.MAX_SAFE_INTEGER) ? value : Number(value);
      }
    }
    throw new Error('Invalid ONNX varint');
  };
  while (offset < bytes.length) {
    const tag = varint();
    if (typeof tag !== 'number') throw new Error('Oversized ONNX field tag');
    const number = Math.floor(tag / 8);
    const wire = tag % 8;
    if (!number) throw new Error('Invalid ONNX field');
    let value;
    if (wire === 0) value = varint();
    else if (wire === 2) {
      const length = varint();
      if (typeof length !== 'number' || length > bytes.length - offset) throw new Error('Truncated ONNX field');
      value = bytes.subarray(offset, offset + length);
      offset += length;
    } else if (wire === 1 || wire === 5) {
      const length = wire === 1 ? 8 : 4;
      if (length > bytes.length - offset) throw new Error('Truncated ONNX fixed field');
      value = bytes.subarray(offset, offset + length);
      offset += length;
    } else throw new Error('Unsupported ONNX protobuf wire type');
    result.push({ number, wire, value });
  }
  return result;
}
const one = (items, number) => items.find((item) => item.number === number)?.value;
const repeated = (items, number) => items.filter((item) => item.number === number).map((item) => item.value);
const utf8 = (value) => value === undefined ? '' : Buffer.from(value).toString('utf8');

function tensorInfo(bytes) {
  const info = fields(bytes);
  const tensor = one(fields(one(info, 2) ?? Buffer.alloc(0)), 1);
  if (!tensor) throw new Error('Expected tensor ONNX input/output');
  const type = fields(tensor);
  const shape = fields(one(type, 2) ?? Buffer.alloc(0));
  return {
    name: utf8(one(info, 1)),
    elementType: one(type, 1),
    shape: repeated(shape, 1).map((dim) => {
      const parts = fields(dim);
      return one(parts, 1) ?? utf8(one(parts, 2));
    }),
  };
}

export function inspectOnnx(bytes, { allowExternal = false } = {}) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 16 * 1024 * 1024) {
    throw new Error('Unexpected ONNX size');
  }
  const model = fields(bytes);
  const graphBytes = one(model, 7);
  if (!graphBytes) throw new Error('ONNX graph missing');
  const graph = fields(graphBytes);
  for (const initializer of repeated(graph, 5)) {
    const tensor = fields(initializer);
    if (repeated(tensor, 13).length || one(tensor, 14) === 1) {
      if (!allowExternal) throw new Error('External ONNX weights are not permitted');
    }
  }
  const operations = {};
  for (const node of repeated(graph, 1)) {
    const type = utf8(one(fields(node), 4));
    operations[type] = (operations[type] ?? 0) + 1;
  }
  return {
    irVersion: one(model, 1),
    opsets: repeated(model, 8).map((item) => {
      const parts = fields(item);
      return { domain: utf8(one(parts, 1)), version: one(parts, 2) };
    }),
    inputs: repeated(graph, 11).map(tensorInfo),
    outputs: repeated(graph, 12).map(tensorInfo),
    operations,
    initializerCount: repeated(graph, 5).length,
  };
}

function encodeVarint(value) {
  let remaining = BigInt(value);
  const bytes = [];
  do {
    let byte = Number(remaining & 127n);
    remaining >>= 7n;
    if (remaining) byte |= 128;
    bytes.push(byte);
  } while (remaining);
  return Buffer.from(bytes);
}

function encodeFields(items) {
  return Buffer.concat(items.map(({ number, wire, value }) => {
    const tag = encodeVarint(number * 8 + wire);
    if (wire === 0) return Buffer.concat([tag, encodeVarint(value)]);
    if (wire === 2) return Buffer.concat([tag, encodeVarint(value.length), value]);
    return Buffer.concat([tag, value]);
  }));
}

// Packaging transformation only: preserve the graph and copy each declared external
// tensor range verbatim into raw_data. No retraining, quantization or math changes.
export function inlineExternalData(modelBytes, dataBytes, location = 'mobile_facenet.data') {
  const integer = (value, fallback) => {
    if (value === undefined) return fallback;
    if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Invalid external tensor range');
    const result = Number(value);
    if (!Number.isSafeInteger(result)) throw new Error('Oversized external tensor range');
    return result;
  };
  const tensor = (bytes) => {
    const parts = fields(bytes);
    const external = repeated(parts, 13);
    if (!external.length && one(parts, 14) !== 1) return bytes;
    const entries = new Map();
    for (const item of external) {
      const pair = fields(item);
      const key = utf8(one(pair, 1));
      if (entries.has(key)) throw new Error('Duplicate external tensor key');
      entries.set(key, utf8(one(pair, 2)));
    }
    if (entries.get('location') !== location || one(parts, 9) !== undefined || one(parts, 14) !== 1) {
      throw new Error('Unexpected external tensor source');
    }
    const offset = integer(entries.get('offset'), 0);
    const length = integer(entries.get('length'), dataBytes.length - offset);
    if (offset > dataBytes.length || length < 0 || length > dataBytes.length - offset) {
      throw new Error('External tensor range outside pinned data');
    }
    return encodeFields([...parts.filter((part) => part.number !== 13 && part.number !== 14),
      { number: 9, wire: 2, value: dataBytes.subarray(offset, offset + length) }]);
  };
  const attribute = (bytes) => encodeFields(fields(bytes).map((part) => {
    if (part.number === 5 || part.number === 10) return { ...part, value: tensor(part.value) };
    if (part.number === 6 || part.number === 11) return { ...part, value: graph(part.value) };
    return part;
  }));
  const node = (bytes) => encodeFields(fields(bytes).map((part) => part.number === 5 ?
    { ...part, value: attribute(part.value) } : part));
  const graph = (bytes) => encodeFields(fields(bytes).map((part) => {
    if (part.number === 5) return { ...part, value: tensor(part.value) };
    if (part.number === 1) return { ...part, value: node(part.value) };
    return part;
  }));
  const output = encodeFields(fields(modelBytes).map((part) => part.number === 7 ?
    { ...part, value: graph(part.value) } : part));
  inspectOnnx(output);
  return output;
}

function replaceShape(infoBytes, dimensions) {
  return encodeFields(fields(infoBytes).map((part) => part.number === 2 ? {
    ...part, value: encodeFields(fields(part.value).map((type) => type.number === 1 ? {
      ...type, value: encodeFields(fields(type.value).map((tensor) => tensor.number === 2 ? {
        ...tensor, value: encodeFields(dimensions.map((value) => ({ number: 1, wire: 2,
          value: encodeFields([{ number: 1, wire: 0, value }]) }))),
      } : tensor)),
    } : type)),
  } : part));
}

// YuNet's convolution/reshape graph supports other image sizes. Its published
// 2023mar value annotations are fixed at 640. Retarget only annotations to 320,
// discarding derived internal annotations so ORT infers them from the same graph.
export function retargetYuNet320(bytes) {
  const source = inspectOnnx(bytes);
  if (JSON.stringify(source.inputs) !== JSON.stringify([
    { name: 'input', elementType: 1, shape: [1, 3, 640, 640] },
  ]) || source.outputs.length !== 12) throw new Error('Unexpected original YuNet interface');
  const shapes = new Map();
  for (const output of source.outputs) {
    const match = /^(cls|obj|bbox|kps)_(8|16|32)$/.exec(output.name);
    if (!match || output.elementType !== 1 || shapes.has(output.name)) throw new Error('Unexpected YuNet output');
    const channels = { cls: 1, obj: 1, bbox: 4, kps: 10 }[match[1]];
    const stride = Number(match[2]);
    if (JSON.stringify(output.shape) !== JSON.stringify([1, (640 / stride) ** 2, channels])) {
      throw new Error('Unexpected original YuNet output shape');
    }
    shapes.set(output.name, [1, (320 / stride) ** 2, channels]);
  }
  return encodeFields(fields(bytes).map((part) => part.number === 7 ? { ...part,
    value: encodeFields(fields(part.value).filter((item) => item.number !== 13).map((item) => {
      if (item.number === 11) return { ...item, value: replaceShape(item.value, [1, 3, 320, 320]) };
      if (item.number === 12) return { ...item,
        value: replaceShape(item.value, shapes.get(tensorInfo(item.value).name)) };
      return item;
    })),
  } : part));
}

export function assertGraphContract(actual, expected) {
  for (const key of ['inputs', 'outputs', 'opsets']) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) {
      throw new Error(`Pinned ONNX ${key} contract mismatch`);
    }
  }
}

export async function fileDigest(path, algorithm = 'sha256') {
  const digest = createHash(algorithm);
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

function relativePath(name) {
  if (typeof name !== 'string' || !name || isAbsolute(name) || name.includes('\\') ||
      name.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Unsafe artifact path');
  }
  return name;
}

async function artifactPath(cache, name) {
  relativePath(name);
  const path = join(cache, name);
  await mkdir(dirname(path), { recursive: true });
  const parent = await realpath(dirname(path));
  if (parent !== cache && !parent.startsWith(`${cache}${sep}`)) throw new Error('Artifact leaves cache');
  if (existsSync(path)) {
    const actual = await realpath(path);
    if (actual !== path) throw new Error('Linked artifact refused');
  }
  return path;
}

async function verifyFile(path, entry) {
  const info = await stat(path);
  if (!info.isFile() || info.size !== entry.bytes) throw new Error(`Pinned size mismatch: ${entry.file}`);
  if (await fileDigest(path) !== entry.sha256) throw new Error(`Pinned digest mismatch: ${entry.file}`);
  if (entry.sha512 && await fileDigest(path, 'sha512') !== entry.sha512) {
    throw new Error(`Pinned npm integrity mismatch: ${entry.file}`);
  }
}

async function childToFile(command, args, path, maxBytes) {
  const output = await open(path, 'wx');
  let total = 0;
  let stderr = '';
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const completion = new Promise((fulfill, reject) => {
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? fulfill() : reject(new Error(`${command} failed: ${stderr.trim()}`)));
  });
  // Observe early spawn failures while stdout is still being consumed.
  completion.catch(() => {});
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-3000); });
  try {
    for await (const chunk of child.stdout) {
      total += chunk.length;
      if (total > maxBytes) { child.kill(); throw new Error('Artifact exceeds pinned size'); }
      await output.write(chunk);
    }
    await completion;
  } catch (error) {
    child.kill();
    await completion.catch(() => {});
    throw error;
  } finally { await output.close(); }
}

async function prepareEntry(cache, entry, byName) {
  const target = await artifactPath(cache, entry.file);
  if (existsSync(target)) { await verifyFile(target, entry); return; }
  const temporary = `${target}.partial-${process.pid}`;
  try {
    if (entry.url) {
      if (new URL(entry.url).protocol !== 'https:') throw new Error('HTTPS source required');
      await childToFile('curl', ['--fail', '--silent', '--show-error', '--location', '--proto', '=https',
        '--proto-redir', '=https', '--tlsv1.2', '--connect-timeout', '10', '--max-time', '180',
        '--max-filesize', String(entry.bytes), entry.url], temporary, entry.bytes);
    } else if (entry.retargetFrom) {
      const source = byName.get(entry.retargetFrom);
      if (!source) throw new Error('Pinned original detector missing');
      const sourcePath = await artifactPath(cache, source.file);
      await verifyFile(sourcePath, source);
      await writeFile(temporary, retargetYuNet320(await readFile(sourcePath)), { flag: 'wx' });
    } else if (entry.inlineFrom) {
      const graph = byName.get(entry.inlineFrom.graph);
      const data = byName.get(entry.inlineFrom.data);
      if (!graph || !data) throw new Error('Pinned external model files missing');
      const graphPath = await artifactPath(cache, graph.file);
      const dataPath = await artifactPath(cache, data.file);
      await verifyFile(graphPath, graph);
      await verifyFile(dataPath, data);
      const result = inlineExternalData(await readFile(graphPath), await readFile(dataPath));
      await writeFile(temporary, result, { flag: 'wx' });
    } else {
      const archive = byName.get(entry.archive);
      if (!archive) throw new Error('Pinned source archive missing');
      const archivePath = await artifactPath(cache, archive.file);
      await verifyFile(archivePath, archive);
      relativePath(entry.member);
      const command = entry.archive.endsWith('.tgz') ? 'tar' : 'unzip';
      const args = command === 'tar' ? ['-xOf', archivePath, entry.member] : ['-p', archivePath, entry.member];
      await childToFile(command, args, temporary, entry.bytes);
    }
    await verifyFile(temporary, entry);
    // Exclusive publication: concurrent runs and unknown existing files are never overwritten.
    await link(temporary, target);
  } finally {
    if (existsSync(temporary)) await unlink(temporary);
  }
}

export async function verifyModelCache(cache, manifest) {
  for (const entry of manifest.files) await verifyFile(await artifactPath(cache, entry.file), entry);
  for (const model of [manifest.encoder, manifest.detector]) {
    const graph = inspectOnnx(await readFile(await artifactPath(cache, model.file)));
    assertGraphContract(graph, model.graph);
  }
  return { modelId: manifest.model_id, checkpointSha256: manifest.checkpoint.sha256,
    encoderSha256: manifest.encoder.sha256, cache, fileCount: manifest.files.length };
}

async function main() {
  if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1' || !existsSync('/.dockerenv')) {
    throw new Error('Run in the documented managed Linux container');
  }
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--download', '--verify'].includes(arg))) {
    throw new Error('Usage: node tools/prepare-face-model.mjs [--download|--verify]');
  }
  await mkdir(CACHE_PATH, { recursive: true });
  const cache = await realpath(CACHE_PATH);
  if (cache !== CACHE_PATH) throw new Error('Linked cache refused');
  const manifest = JSON.parse(await readFile(lockPath, 'utf8'));
  if (manifest.cache_path !== CACHE_PATH) throw new Error('Unexpected pinned cache');
  if (args.includes('--download')) {
    const byName = new Map(manifest.files.map((entry) => [entry.file, entry]));
    for (const entry of manifest.files) await prepareEntry(cache, entry, byName);
  }
  console.log(JSON.stringify(await verifyModelCache(cache, manifest), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
