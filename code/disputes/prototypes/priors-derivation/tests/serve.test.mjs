import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createReviewServer, reviewContentSecurityPolicy } from '../serve.mjs';
import { normalizeReport, safeSourceUrl, buildReviewExport } from '../review/review.mjs';

const report = { schema_version: 1, title: 'Synthetic server test', candidates: [], clusters: [], clauses: [], contracts: [] };

async function fixture(t, body = report) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'priors-review-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'report.json'), typeof body === 'string' ? body : JSON.stringify(body));
  await writeFile(path.join(dir, 'private-contract.txt'), 'This must not be served.');
  return dir;
}
async function running(t, options) {
  const server = await createReviewServer(options);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return server.address().port;
}
function request(port, target, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: target, method }, (res) => {
      const chunks = []; res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject); req.end();
  });
}

test('explicit assets and selected report are read-only with strict default CSP', async (t) => {
  const dir = await fixture(t); const port = await running(t, { runDir: dir });
  for (const [target, type] of [['/', 'text/html'], ['/review.css', 'text/css'], ['/review.mjs', 'text/javascript'], ['/report.json', 'application/json']]) {
    const response = await request(port, target); assert.equal(response.status, 200); assert.ok(response.headers['content-type'].startsWith(type));
    assert.match(response.headers['content-security-policy'], /script-src 'self';/);
    assert.match(response.headers['content-security-policy'], /style-src-attr 'none'/);
    assert.doesNotMatch(response.headers['content-security-policy'], /unsafe-inline/);
    assert.equal(response.headers['x-content-type-options'], 'nosniff'); assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.deepEqual(JSON.parse((await request(port, '/report.json')).body), report);
  await writeFile(path.join(dir, 'report.json'), JSON.stringify({ ...report, title: 'Changed after startup' }));
  assert.deepEqual(JSON.parse((await request(port, '/report.json')).body), report, 'The selected run snapshot stays fixed until the server is restarted.');
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    const response = await request(port, '/report.json', method); assert.equal(response.status, 405); assert.equal(response.headers.allow, 'GET, HEAD');
  }
  const head = await request(port, '/report.json', 'HEAD'); assert.equal(head.status, 200); assert.equal(head.body, ''); assert.ok(Number(head.headers['content-length']) > 0);
});

test('traversal, directories, arbitrary artifacts and origin-shaped paths are unavailable', async (t) => {
  const dir = await fixture(t); const port = await running(t, { runDir: dir });
  for (const target of ['/private-contract.txt', '/report.json/..', '/review/', '/../report.json', '/%2e%2e/report.json', '/review/../report.json', '/%72eport.json', '//example.com/report.json', '/report.json%00', '/report.json#fragment']) {
    assert.equal((await request(port, target)).status, 404, target);
  }
  assert.equal((await request(port, '/report.json?view=1')).status, 200);
});

test('only the dedicated noindex local review entry permits inline style elements', async (t) => {
  const port = await running(t, {}); const response = await request(port, '/review.html');
  assert.equal(response.status, 200); assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow');
  assert.match(response.body, /name="robots" content="noindex, nofollow"/);
  assert.match(response.headers['content-security-policy'], /style-src-elem 'self' 'unsafe-inline'/);
  assert.match(response.headers['content-security-policy'], /style-src-attr 'none'/);
  assert.match(response.headers['content-security-policy'], /script-src 'self';/);
  assert.doesNotMatch(response.headers['content-security-policy'], /script-src[^;]*unsafe-inline/);
  assert.equal((await request(port, '/report.json')).status, 404);
  assert.doesNotMatch(reviewContentSecurityPolicy(), /unsafe-inline/);
});

test('invalid schema and malformed report data fail before server startup', async (t) => {
  const invalidJson = await fixture(t, '{broken');
  await assert.rejects(createReviewServer({ runDir: invalidJson }), /not valid JSON/);
  const invalidSchema = await fixture(t, { schema_version: 2 });
  await assert.rejects(createReviewServer({ runDir: invalidSchema }), /schema_version: 1/);
  const wrongArrays = await fixture(t, { ...report, candidates: 'wrong' });
  await assert.rejects(createReviewServer({ runDir: wrongArrays }), /candidates must be an array/);
  await assert.rejects(createReviewServer({ runDir: 'relative-run' }), /absolute path/);
});

test('report symlinks cannot expose a file outside the chosen run directory', async (t) => {
  const root = await fixture(t); const run = path.join(root, 'run'); await mkdir(run);
  await symlink(path.join(root, 'report.json'), path.join(run, 'report.json'));
  await assert.rejects(createReviewServer({ runDir: run }), /directly inside/);
});

test('report normalization and local review export preserve research boundaries', () => {
  const normalized = normalizeReport({ ...report, candidates: [{ id: 'p1', name: '<script>bad()</script>' }] });
  assert.equal(normalized.candidates[0].name, '<script>bad()</script>');
  assert.throws(() => normalizeReport({ ...report, clauses: [{ id: 'duplicate' }, { id: 'duplicate' }] }), /duplicate identifiers/);
  assert.throws(() => normalizeReport({ ...report, clauses: ['wrong'] }), /must be an object/);
  assert.throws(() => normalizeReport({ ...report, candidates: {} }), /must be an array/);
  const result = buildReviewExport(normalized, new Map([['p1', { decision: 'revise', notes: '<b>literal note</b>' }]]), new Date('2026-10-13T00:00:00Z'));
  assert.equal(result.prototype, true); assert.match(result.adoption_status, /No priors are adopted/);
  assert.equal(result.decisions[0].notes, '<b>literal note</b>'); assert.equal(result.exported_at, '2026-10-13T00:00:00.000Z');
});

test('external evidence links allow only HTTP(S) without URL credentials', () => {
  assert.equal(safeSourceUrl('https://example.com/contract?q=1'), 'https://example.com/contract?q=1');
  for (const value of ['javascript:alert(1)', 'data:text/html,bad', 'file:///private/report', '//example.com/path', 'https://user:pass@example.com', null, {}]) assert.equal(safeSourceUrl(value), null);
});
