// SPDX-License-Identifier: AGPL-3.0-only
// Preview the same closed asset set as the participant APK; no build required.
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectParticipantAssets} from '../build/participant-assets.mjs';
import {createParticipantAccountRelay} from './participant-account-relay.mjs';

if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') {
  throw new Error('Run the participant preview in the managed Debian container.');
}

function reviewHtml(html) {
  const policies = html.match(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/g) || [];
  const policy = policies[0];
  if (policies.length !== 1 || !policy.includes("style-src 'self';")
      || !policy.includes("script-src 'self';") || /style-src-(?:elem|attr)/.test(policy)
      || /'unsafe-(?:inline|eval)'/.test(policy) || !html.includes('<head>')) {
    throw new Error('Participant review requires the expected strict source policy.');
  }
  return html.replace(policy, policy.replace("style-src 'self';",
    "style-src 'self'; style-src-elem 'self' 'unsafe-inline'; style-src-attr 'none';"))
    .replace('<head>', '<head>\n  <meta name="robots" content="noindex,nofollow">');
}

export async function createParticipantServer({accountRelay} = {}) {
  const assets = await collectParticipantAssets();
  const relay = accountRelay || createParticipantAccountRelay();
  // This in-memory route is never an APK asset or a release export.
  assets.set('participant/review.html', Buffer.from(reviewHtml(assets.get('participant/index.html').toString('utf8'))));
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    if (await relay(request, response)) return;
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      response.writeHead(status, {'Content-Type':type, 'Content-Length':Buffer.byteLength(body)});
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      return send(405, 'Method not allowed\n');
    }
    const pathname = (request.url || '').split('?', 1)[0];
    if (pathname === '/') {
      response.setHeader('Location', '/participant/review.html');
      return send(302, '');
    }
    const name = pathname.startsWith('/') ? pathname.slice(1) : '';
    const bytes = assets.get(name);
    if (!bytes) return send(404, 'Not found\n');
    if (name === 'participant/review.html') response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const type = name.endsWith('.html') ? 'text/html; charset=utf-8'
      : name.endsWith('.css') ? 'text/css; charset=utf-8'
      : name.endsWith('.js') ? 'text/javascript; charset=utf-8'
      : name.endsWith('.svg') ? 'image/svg+xml'
      : name.endsWith('.webp') ? 'image/webp' : 'text/plain; charset=utf-8';
    send(200, bytes, type);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.NONVERBA_BIND || '127.0.0.1';
  const port = process.env.NONVERBA_PORT || '4173';
  if (!['127.0.0.1', '0.0.0.0'].includes(host) || port !== '4173') {
    throw new Error('Use the documented participant preview binding on port 4173.');
  }
  const server = await createParticipantServer();
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(Number(port), host, accept);
  });
  console.log('Non-verba participant review: http://127.0.0.1:4173/participant/review.html');
  process.once('SIGINT', () => server.close());
  process.once('SIGTERM', () => server.close());
}
