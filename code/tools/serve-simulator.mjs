// Local, read-only preview of the homepage and union simulator. No directory tree is served.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), '../..');
const assets = new Map([
  ['/web/index.html', ['web/index.html', 'text/html; charset=utf-8']],
  ['/web/index.css', ['web/index.css', 'text/css; charset=utf-8']],
  ['/web/index.js', ['web/index.js', 'text/javascript; charset=utf-8']],
  ['/web/branding/sprout.svg', ['web/branding/sprout.svg', 'image/svg+xml']],
  ['/web/branding/waajacu-favicon.png', ['web/branding/waajacu-favicon.png', 'image/png']],
  ['/web/branding/individual/01-sprout.png', ['web/branding/individual/01-sprout.png', 'image/png']],
  ['/web/union.html', ['web/union.html', 'text/html; charset=utf-8']],
  ['/web/union.css', ['web/union.css', 'text/css; charset=utf-8']],
  ['/web/union.mjs', ['web/union.mjs', 'text/javascript; charset=utf-8']],
  ['/web/setup.mjs', ['web/setup.mjs', 'text/javascript; charset=utf-8']],
  ['/web/union.config.json', ['web/union.config.json', 'application/json; charset=utf-8']],
  ['/code/simulator/config.mjs', ['code/simulator/config.mjs', 'text/javascript; charset=utf-8']],
  ['/code/simulator/model.mjs', ['code/simulator/model.mjs', 'text/javascript; charset=utf-8']],
  ['/code/protocol/cooperation.mjs', ['code/protocol/cooperation.mjs', 'text/javascript; charset=utf-8']],
  ['/code/pkg/nonverba_cooperation.js', ['code/pkg/nonverba_cooperation.js', 'text/javascript; charset=utf-8']],
  ['/code/pkg/nonverba_cooperation_bg.wasm', ['code/pkg/nonverba_cooperation_bg.wasm', 'application/wasm']],
]);
const reviewPages = new Map([
  ['/web/index-review.html', '/web/index.html'],
  ['/web/union-review.html', '/web/union.html'],
]);

function localReviewHtml(html) {
  const metas = html.match(/<meta\b[^>]*\bhttp-equiv\s*=\s*"Content-Security-Policy"[^>]*>/gi) || [];
  if (metas.length !== 1) {
    throw new Error('Local review requires exactly one Content-Security-Policy meta element');
  }
  const meta = metas[0];
  const content = meta.match(/\bcontent\s*=\s*"([^"]*)"/i);
  const marker = "style-src 'self';";
  if (!content || !content[1].includes(marker)) {
    throw new Error(`Local review requires the CSP directive ${marker}`);
  }
  const directives = new Map(content[1].split(';').map(value => value.trim()).filter(Boolean)
    .map(value => {
      const [name, ...sources] = value.split(/\s+/);
      return [name, sources.join(' ')];
    }));
  if (directives.get('style-src-attr') !== "'none'" || directives.has('style-src-elem')) {
    throw new Error('Local review requires style-src-attr none and no existing style-src-elem override');
  }
  if (!directives.has('script-src') || [...directives].some(([name, sources]) =>
    /^script-src(?:-|$)/.test(name) && /'unsafe-(?:inline|eval)'/.test(sources))) {
    throw new Error('Local review requires the existing strict script policy');
  }
  const reviewedMeta = meta.replace(marker,
    "style-src 'self'; style-src-elem 'self' 'unsafe-inline';");
  const reviewed = html.replace(meta, reviewedMeta);
  if (!/<head\b[^>]*>/i.test(reviewed)) {
    throw new Error('Local review requires an HTML head element for its noindex marker');
  }
  return reviewed.replace(/<head\b[^>]*>/i,
    opening => `${opening}\n  <meta name="robots" content="noindex">`);
}

function send(request, response, status, body, type = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(request.method === 'HEAD' ? undefined : body);
}

/** Return an unbound server; callers own listen() and close(). */
export function createSimulatorServer() {
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      send(request, response, 405, 'Method not allowed\n');
      return;
    }

    // Do not decode or resolve user paths. A query does not change the asset.
    const path = (request.url || '').split('?', 1)[0];
    if (path === '/') {
      response.setHeader('Location', '/web/index.html');
      send(request, response, 302, '');
      return;
    }
    const review = reviewPages.has(path);
    const asset = assets.get(review ? reviewPages.get(path) : path);
    if (!asset) {
      send(request, response, 404, 'Not found\n');
      return;
    }
    if (review) response.setHeader('X-Robots-Tag', 'noindex');
    try {
      const bytes = await readFile(resolve(root, asset[0]));
      const body = review ? localReviewHtml(bytes.toString('utf8')) : bytes;
      // The production HTML carries its own CSP. The local review response has
      // only the transformed meta policy, so a second header cannot block it.
      send(request, response, 200, body, asset[1]);
    } catch (error) {
      if (error.code === 'ENOENT') {
        send(request, response, 404, 'Local asset is not available\n');
      } else {
        const message = review && !error.code ? error.message : 'Unable to read local asset';
        send(request, response, 500, `${message}\n`);
      }
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const configuredPort = process.env.NONVERBA_UNION_PORT ?? '4174';
  if (!/^\d+$/.test(configuredPort) || Number(configuredPort) > 65_535) {
    throw new Error('NONVERBA_UNION_PORT must be an integer from 0 to 65535');
  }
  const server = createSimulatorServer();
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(Number(configuredPort), '127.0.0.1', accept);
  });
  console.log(`Homepage: http://127.0.0.1:${server.address().port}/web/index.html`);
  console.log(`Union simulator: http://127.0.0.1:${server.address().port}/web/union.html`);
  const stop = () => server.close();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
