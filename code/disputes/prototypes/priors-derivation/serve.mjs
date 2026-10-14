import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const assetDir = fileURLToPath(new URL('./review/', import.meta.url));
const maxReportBytes = 25 * 1024 * 1024;
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/review.html', ['index.html', 'text/html; charset=utf-8']],
  ['/review.css', ['review.css', 'text/css; charset=utf-8']],
  ['/review.mjs', ['review.mjs', 'text/javascript; charset=utf-8']],
]);

export function reviewContentSecurityPolicy({ localSelector = false } = {}) {
  return [
    "default-src 'none'", "script-src 'self'", "style-src 'self'",
    localSelector ? "style-src-elem 'self' 'unsafe-inline'" : "style-src-elem 'self'",
    "style-src-attr 'none'", "connect-src 'self'", "img-src 'self'",
    "font-src 'none'", "base-uri 'none'", "form-action 'none'",
    "frame-ancestors 'none'", "object-src 'none'",
  ].join('; ');
}

async function loadReport(runDir) {
  if (runDir == null) return null;
  if (!path.isAbsolute(runDir)) throw new Error('--run must be an absolute path to a completed run directory.');
  const resolvedRun = await realpath(runDir);
  if (!(await stat(resolvedRun)).isDirectory()) throw new Error('--run must identify a directory.');
  const reportPath = await realpath(path.join(resolvedRun, 'report.json'));
  if (path.dirname(reportPath) !== resolvedRun) throw new Error('report.json must resolve directly inside the selected run directory.');
  const reportInfo = await stat(reportPath);
  if (!reportInfo.isFile() || reportInfo.size > maxReportBytes) throw new Error('report.json must be a regular file no larger than 25 MiB.');
  const bytes = await readFile(reportPath);
  if (bytes.length > maxReportBytes) throw new Error('report.json exceeds the 25 MiB review limit.');
  let report;
  try { report = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('report.json is not valid JSON.'); }
  if (!report || typeof report !== 'object' || Array.isArray(report) || report.schema_version !== 1) {
    throw new Error('report.json must be an object with schema_version: 1.');
  }
  for (const key of ['candidates', 'clusters', 'clauses', 'contracts']) {
    if (report[key] != null && !Array.isArray(report[key])) throw new Error(`report.json ${key} must be an array.`);
  }
  return bytes;
}

/** Read-only, explicit-route review server. It never serves a run directory or writes review choices. */
export async function createReviewServer({ runDir = null } = {}) {
  const reportBytes = await loadReport(runDir);
  const assetBytes = new Map(await Promise.all([...assets].map(async ([route, [name, type]]) =>
    [route, { bytes: await readFile(path.join(assetDir, name)), type }])));
  return http.createServer((req, res) => {
    // Compare the original target, so URL normalization cannot turn traversal into an allowed route.
    const route = (req.url || '').split('?', 1)[0];
    const localSelector = route === '/review.html';
    res.setHeader('Content-Security-Policy', reviewContentSecurityPolicy({ localSelector }));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('This prototype is read-only.');
      return;
    }
    const asset = route === '/report.json'
      ? (reportBytes ? { bytes: reportBytes, type: 'application/json; charset=utf-8' } : null)
      : assetBytes.get(route);
    if (!asset) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : 'No review artifact at this route.');
      return;
    }
    res.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': asset.bytes.length });
    res.end(req.method === 'HEAD' ? undefined : asset.bytes);
  });
}

function parseArgs(argv) {
  const options = { host: '127.0.0.1', port: 4173, runDir: null };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return null;
    if (arg.startsWith('--run=')) options.runDir = arg.slice(6);
    else if (arg.startsWith('--host=')) options.host = arg.slice(7);
    else if (arg.startsWith('--port=')) options.port = Number(arg.slice(7));
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.host || !Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error('Specify a host and an integer port from 1 to 65535.');
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options) {
      process.stdout.write('Priors Derivation Lab — research prototype\nUsage: node serve.mjs [--run=/absolute/completed/run] [--host=127.0.0.1] [--port=4173]\nThe selected run exposes report.json only. Open /review.html for local Codex element review.\n');
    } else {
      const server = await createReviewServer(options);
      server.on('error', (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
      server.listen(options.port, options.host, () => {
        process.stdout.write(`Priors Derivation Lab — PROTOTYPE / RESEARCH ONLY\nListening on http://${options.host}:${options.port}\n${options.runDir ? 'Completed report loaded.' : 'No run selected; import a local report in the browser.'}\n`);
      });
      for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
