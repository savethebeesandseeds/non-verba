// SPDX-License-Identifier: AGPL-3.0-only
// Explicit local-development transport, not a general HTTP proxy or a token store.
import {request as httpRequest} from 'node:http';

const ORIGIN = 'http://127.0.0.1:4173';
const UPSTREAM = 'http://127.0.0.1:8080';
const CLIENT = 'nonverba-dev-apk';
const CALLBACK = UPSTREAM + '/dev-callback';
const REQUEST_LIMIT = 16 * 1024, RESPONSE_LIMIT = 64 * 1024;
const DEVICES = '/v1/account/signin-devices', PROVE = DEVICES + '/prove';
const IDENTITY = '/v1/account/identity', IDENTITY_SUBMIT = IDENTITY + '/submissions', IDENTITY_CHALLENGE = IDENTITY + '/capture-challenges', IDENTITY_LIMIT = 6 * 1024 * 1024;
const identityOperation = path => new RegExp('^' + IDENTITY + '/operations/identity:[A-Za-z0-9_-]{43}$').test(path);
const REVIEWER = '/v1/identity/reviewer', REVIEW_ID = '[A-Za-z0-9._:-]{1,128}';
const reviewerCase = path => new RegExp('^' + REVIEWER + '/cases/' + REVIEW_ID + '$').test(path);
const reviewerPhoto = path => new RegExp('^' + REVIEWER + '/cases/' + REVIEW_ID + '/photos/(document_front|face_front)$').test(path);
const reviewerDecision = path => new RegExp('^' + REVIEWER + '/cases/' + REVIEW_ID + '/decisions$').test(path);
const reviewerOperation = path => new RegExp('^' + REVIEWER + '/cases/' + REVIEW_ID + '/operations/' + REVIEW_ID + '$').test(path);
const reviewRead = path => [REVIEWER + '/context', REVIEWER + '/cases', IDENTITY + '/review/status'].includes(path)
  || reviewerCase(path) || reviewerPhoto(path) || reviewerOperation(path);
const REVIEW_DETAIL_LIMIT = 256 * 1024, REVIEW_PHOTO_LIMIT = 3 * 1024 * 1024;
const responseLimit = input => reviewerPhoto(input.path) ? REVIEW_PHOTO_LIMIT
  : input.path === DEVICES || reviewerCase(input.path) ? REVIEW_DETAIL_LIMIT : RESPONSE_LIMIT;
// Base64 photo JSON needs bounded framing/escaping, not a sixfold media budget.
// Case histories retain the existing device envelope's Unicode escape allowance.
const serializedResponseLimit = input => reviewerPhoto(input.path) ? REVIEW_PHOTO_LIMIT + REQUEST_LIMIT
  : input.path === DEVICES || reviewerCase(input.path) ? REVIEW_DETAIL_LIMIT * 6 + 2048 : RESPONSE_LIMIT;
const FLOW_LIFETIME = 5 * 60 * 1000, MAX_FLOWS = 64;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const flowId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
  && Buffer.from(value, 'base64url').length === 32 && Buffer.from(value, 'base64url').toString('base64url') === value;
const opaque = /^[A-Za-z0-9._~-]{16,256}$/;
const jsonPaths = new Set(['/v1/accounts/enrollments', '/v1/accounts/enrollments/status',
  '/v1/accounts/enrollments/confirm', '/v1/accounts/recovery/start',
  '/v1/accounts/recovery/status', '/v1/accounts/recovery/finish', '/v1/accounts/mock-mail',
  '/v1/accounts/entry/start', '/v1/accounts/entry/confirm', '/v1/accounts/presence',
  '/v1/account/deletion', '/v1/account/deletion/status', DEVICES + '/challenge', PROVE, '/v1/account/sessions/revoke', IDENTITY_SUBMIT, IDENTITY_CHALLENGE]);
const discovery = '/dev-oidc/.well-known/openid-configuration';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const insist = (condition, message = 'account_transport_invalid') => { if (!condition) throw new Error(message); };
const keys = (value, allowed, required = []) => object(value)
  && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key));

function form(text, allowed, required) {
  const fields = new URLSearchParams(text), result = Object.fromEntries(fields);
  insist([...fields].length === Object.keys(result).length && keys(result, allowed, required));
  return result;
}

export function validateAccountTransport(wire) {
  insist(keys(wire, ['id', 'request'], ['id', 'request']) && typeof wire.id === 'string' && uuid.test(wire.id));
  const input = wire.request;
  insist(keys(input, ['method', 'path', 'body', 'headers', 'flow_id'], ['method', 'path']));
  insist(typeof input.path === 'string' && input.path.startsWith('/') && !/[\\#\x00-\x20\x7f]/.test(input.path)
    && !input.path.split('?', 1)[0].includes('%') && !input.path.startsWith('//')
    && !input.path.split('?', 1)[0].split('/').some(part => part === '..' || part === '.'));
  insist(input.body === undefined || typeof input.body === 'string');
  insist(input.headers === undefined || object(input.headers));
  const headers = {}, names = new Set();
  for (const [name, value] of Object.entries(input.headers || {})) {
    const lower = name.toLowerCase();
    insist(['authorization', 'content-type'].includes(lower) && !names.has(lower)
      && typeof value === 'string' && !/[\r\n]/.test(value));
    names.add(lower); headers[lower === 'authorization' ? 'Authorization' : 'Content-Type'] = value;
  }
  const url = new URL(input.path, UPSTREAM), path = url.pathname;
  insist(url.origin === UPSTREAM && !url.username && !url.password && !url.hash);
  const auth = path === '/dev-oidc/authorize';
  const authenticated = path === '/v1/account/context' || path === '/v1/account/devices' || path === '/v1/auth/session' || path === '/v1/account/deletion'
    || [DEVICES, DEVICES + '/challenge', PROVE, '/v1/account/sessions/revoke', IDENTITY + '/notice', IDENTITY + '/status', IDENTITY_SUBMIT, IDENTITY_CHALLENGE].includes(path)
    || identityOperation(path) || reviewRead(path) || reviewerDecision(path);
  if (authenticated) insist(/^Bearer [A-Za-z0-9._~-]{1,8192}$/.test(headers.Authorization || ''));
  else insist(headers.Authorization === undefined);
  if (auth) insist(flowId(input.flow_id));
  else insist(input.flow_id === undefined);
  const request = {method:input.method, path:input.path, body:input.body, headers, flow_id:input.flow_id};
  if (input.method === 'GET') {
    insist(input.body === undefined && headers['Content-Type'] === undefined);
    if (auth) {
      const query = form(url.search.slice(1), ['response_type','client_id','redirect_uri','scope','state','nonce','code_challenge','code_challenge_method'],
        ['response_type','client_id','redirect_uri','scope','state','nonce','code_challenge','code_challenge_method']);
      insist(query.response_type === 'code' && query.client_id === CLIENT && query.redirect_uri === CALLBACK
        && query.scope === 'openid' && opaque.test(query.state) && opaque.test(query.nonce)
        && /^[A-Za-z0-9_-]{43}$/.test(query.code_challenge) && query.code_challenge_method === 'S256');
    } else insist(!url.search && (!reviewRead(path) || input.path === path)
      && ([discovery, '/dev-oidc/jwks', '/v1/accounts/capabilities', '/v1/accounts/terms', '/readyz', '/v1/account/context', '/v1/account/devices', DEVICES, IDENTITY + '/notice', IDENTITY + '/status'].includes(path) || identityOperation(path) || reviewRead(path)));
  } else if (input.method === 'DELETE') {
    insist(path === '/v1/auth/session' && !url.search && input.body === undefined && headers['Content-Type'] === undefined);
  } else if (input.method === 'POST') {
    insist(!url.search && typeof input.body === 'string' && Buffer.byteLength(input.body) <= (path === IDENTITY_SUBMIT ? IDENTITY_LIMIT : path === PROVE ? 192 * 1024 : REQUEST_LIMIT));
    if (jsonPaths.has(path) || reviewerDecision(path)) {
      insist(headers['Content-Type'] === 'application/json');
      const body = JSON.parse(input.body); insist(object(body));
      if (reviewerDecision(path)) {
        const fields = ['operation_id','submission_sha256','receipt_sha256','expected_revision','action','reason'];
        insist(input.path === path && keys(body,fields,fields)
          && typeof body.operation_id === 'string' && new RegExp('^' + REVIEW_ID + '$').test(body.operation_id) && !['.','..'].includes(body.operation_id)
          && typeof body.submission_sha256 === 'string' && /^[a-f0-9]{64}$/.test(body.submission_sha256)
          && typeof body.receipt_sha256 === 'string' && /^[a-f0-9]{64}$/.test(body.receipt_sha256)
          && Number.isSafeInteger(body.expected_revision) && body.expected_revision >= 0
          && ['approved','rejected','needs_correction'].includes(body.action)
          && typeof body.reason === 'string' && body.reason === body.reason.trim()
          && [...body.reason].length >= 1 && [...body.reason].length <= 500 && !/[\p{Cc}\p{Cs}]/u.test(body.reason));
      }
      if (path === IDENTITY_CHALLENGE) {
        const context = ['account_id','principal_id','session_id','recovery_generation'];
        insist(keys(body,['expected','kind','source','public_spki_der_b64'],['expected','kind','source','public_spki_der_b64'])
          && keys(body.expected,context,context)
          && context.slice(0,3).every(k => typeof body.expected[k] === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(body.expected[k]))
          && Number.isSafeInteger(body.expected.recovery_generation) && body.expected.recovery_generation >= 0
          && ['document_front','face_front'].includes(body.kind) && ['native-camera2','browser-camera'].includes(body.source)
          && typeof body.public_spki_der_b64 === 'string' && body.public_spki_der_b64.length > 0 && body.public_spki_der_b64.length <= 172
          && /^[A-Za-z0-9+/]+={0,2}$/.test(body.public_spki_der_b64)
          && Buffer.from(body.public_spki_der_b64,'base64').length <= 128
          && Buffer.from(body.public_spki_der_b64,'base64').toString('base64') === body.public_spki_der_b64);
      }
      if (path === IDENTITY_SUBMIT) {
        const fields = ['operation_id','level','expected','details','document_front','face_front','notice'];
        const details = ['document_type','full_name','birth_city','nationality','age'];
        const text = (value,max) => typeof value === 'string' && value.trim().length > 0 && [...value].length <= max && !/[\x00-\x1f\x7f]/.test(value);
        // The service owns protocol and signature verification. This transport
        // accepts only the bounded detached envelope, never arbitrary destinations.
        const proof = value => keys(value,['payload','public_spki_der_b64','signature_b64'],['payload','public_spki_der_b64','signature_b64'])
          && object(value.payload) && Buffer.byteLength(JSON.stringify(value)) <= 16 * 1024
          && typeof value.public_spki_der_b64 === 'string' && value.public_spki_der_b64.length <= 172
          && typeof value.signature_b64 === 'string' && value.signature_b64.length === 88;
        const image = value => keys(value,['media_type','base64','capture_proof'],['media_type','base64']) && value.media_type === 'image/jpeg'
          && typeof value.base64 === 'string' && value.base64.length <= 2796204 && value.base64.length > 0
          && /^[A-Za-z0-9+/]+={0,2}$/.test(value.base64) && Buffer.from(value.base64,'base64').toString('base64') === value.base64
          && Buffer.from(value.base64,'base64').length <= 2 * 1024 * 1024
          && (!Object.hasOwn(value,'capture_proof') || proof(value.capture_proof));
        insist(keys(body,fields,fields) && /^identity:[A-Za-z0-9_-]{43}$/.test(body.operation_id || '') && flowId(body.operation_id.slice(9))
          && body.level === 1 && keys(body.expected,['account_id','principal_id','session_id','recovery_generation'],['account_id','principal_id','session_id','recovery_generation'])
          && ['account_id','principal_id','session_id'].every(k => text(body.expected[k],128))
          && Number.isSafeInteger(body.expected.recovery_generation) && body.expected.recovery_generation >= 0
          && keys(body.details,details,details) && ['passport','national_id','driving_licence','residence_permit'].includes(body.details.document_type)
          && text(body.details.full_name,200) && text(body.details.birth_city,120) && text(body.details.nationality,120)
          && Number.isInteger(body.details.age) && body.details.age >= 1 && body.details.age <= 130
          && image(body.document_front) && image(body.face_front)
          && keys(body.notice,['notice_id','version','sha256','acknowledged'],['notice_id','version','sha256','acknowledged'])
          && body.notice.notice_id === 'identity-intake' && [1,2,3].includes(body.notice.version) && /^[0-9a-f]{64}$/.test(body.notice.sha256 || '') && body.notice.acknowledged === true);
      }
      if (path === DEVICES + '/challenge') {
        insist(keys(body,['operation_id','platform','name'],['operation_id','platform','name'])
          && /^signin-device:[A-Za-z0-9_-]{43}$/.test(body.operation_id || '') && flowId(body.operation_id.slice(14))
          && ['android','browser'].includes(body.platform) && typeof body.name === 'string'
          && body.name.length > 0 && body.name.length <= 120 && !/[\x00-\x1f\x7f]/.test(body.name));
      }
      if (path === PROVE) {
        insist(keys(body,['challenge_id','public_spki_der_b64','signature_b64','attestation_chain'],['challenge_id','public_spki_der_b64','signature_b64','attestation_chain'])
          && typeof body.challenge_id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(body.challenge_id)
          && typeof body.public_spki_der_b64 === 'string' && body.public_spki_der_b64.length <= 256
          && typeof body.signature_b64 === 'string' && body.signature_b64.length === 88
          && (body.attestation_chain === null || (keys(body.attestation_chain,['version','certificates_der_b64'],['version','certificates_der_b64'])
            && body.attestation_chain.version === 1 && Array.isArray(body.attestation_chain.certificates_der_b64)
            && body.attestation_chain.certificates_der_b64.length >= 2 && body.attestation_chain.certificates_der_b64.length <= 8
            && body.attestation_chain.certificates_der_b64.every(c => typeof c === 'string' && c.length <= 43692))));
      }
      if (path === '/v1/account/sessions/revoke') insist(keys(body,['operation_id','session_id','deliberate'],['operation_id','session_id','deliberate'])
        && typeof body.operation_id === 'string' && /^revoke:[A-Za-z0-9_-]{43}$/.test(body.operation_id)
        && typeof body.session_id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(body.session_id) && body.deliberate === true);
      if (path === '/v1/accounts/presence') {
        insist(keys(body, ['email', 'username']) && Object.hasOwn(body, 'email') !== Object.hasOwn(body, 'username'));
        if (Object.hasOwn(body, 'email')) insist(typeof body.email === 'string' && body.email.length > 0 && body.email.length <= 254
          && !/[\x00-\x20\x7f-\uffff]/.test(body.email));
        else insist(typeof body.username === 'string' && /^[a-z][a-z0-9_]{2,29}$/.test(body.username));
      }
      if (path.startsWith('/v1/accounts/entry/')) {
        const starting = path === '/v1/accounts/entry/start';
        const fields = starting ? ['operation_id','operation_secret','email','username'] : ['operation_id','operation_secret','confirmation_token'];
        insist(keys(body,fields,starting ? ['operation_id','operation_secret'] : fields) && /^entry:[A-Za-z0-9_-]{43}$/.test(body.operation_id || '')
          && flowId(body.operation_id.slice(6)) && flowId(body.operation_secret));
        if (starting) {
          insist(Object.hasOwn(body,'email') !== Object.hasOwn(body,'username'));
          if (Object.hasOwn(body,'email')) insist(typeof body.email === 'string' && body.email.length > 0 && body.email.length <= 254
            && !/[\x00-\x20\x7f-\uffff]/.test(body.email));
          else insist(typeof body.username === 'string' && /^[a-z][a-z0-9_]{2,29}$/.test(body.username));
        }
        else insist(typeof body.confirmation_token === 'string' && /^[0-9a-f]{8}$/i.test(body.confirmation_token));
      }
      if (path.startsWith('/v1/account/deletion')) {
        const deleting = path === '/v1/account/deletion';
        const fields = deleting ? ['operation_id','operation_secret','password','confirm_email','deliberate'] : ['operation_id','operation_secret'];
        insist(keys(body,fields,fields) && /^delete:[A-Za-z0-9_-]{43}$/.test(body.operation_id || '') && flowId(body.operation_secret));
        if (deleting) insist(typeof body.password === 'string' && Buffer.byteLength(body.password) >= 16 && Buffer.byteLength(body.password) <= 1024
          && typeof body.confirm_email === 'string' && body.confirm_email.length <= 254 && body.deliberate === true);
      }
    } else {
      insist(headers['Content-Type'] === 'application/x-www-form-urlencoded');
      if (auth) {
        const body = form(input.body, ['authorization_id','csrf','email','account_username','username','password'], ['authorization_id','csrf','password']);
        insist(opaque.test(body.authorization_id) && opaque.test(body.csrf) && body.password.length <= 1024
          && ['email','account_username','username'].filter(key=>Object.hasOwn(body,key)).length === 1);
        if (Object.hasOwn(body,'account_username')) insist(/^[a-z][a-z0-9_]{2,29}$/.test(body.account_username));
      } else {
        insist(path === '/dev-oidc/token');
        const body = form(input.body, ['grant_type','client_id','code','redirect_uri','code_verifier','refresh_token'], ['grant_type','client_id']);
        insist(body.client_id === CLIENT);
        if (body.grant_type === 'authorization_code') insist(Object.keys(body).length === 5
          && typeof body.code === 'string' && body.code.length <= 128 && body.redirect_uri === CALLBACK
          && /^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier || ''));
        else insist(body.grant_type === 'refresh_token' && Object.keys(body).length === 3
          && typeof body.refresh_token === 'string' && body.refresh_token.length <= 128);
      }
    }
  } else insist(false);
  return request;
}

// The canonical issuer stays loopback. Only the already verified Docker Desktop
// host route is used for connectivity; neither URL nor host is caller supplied.
function dispatch(input, {signal}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({hostname:'host.docker.internal', port:8080, method:input.method,
      path:input.path, headers:{Host:'127.0.0.1:8080', ...input.headers,
        ...(input.body === undefined ? {} : {'Content-Length':Buffer.byteLength(input.body)})}, signal}, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > responseLimit(input)) { response.destroy(new Error('account_response_too_large')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({status:response.statusCode, headers:response.headers,
        body:Buffer.concat(chunks).toString('utf8')}));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end(input.body);
  });
}

function send(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  const bytes = JSON.stringify(value);
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff', 'Content-Length':Buffer.byteLength(bytes)});
  response.end(bytes);
}

async function readWire(request) {
  const chunks = []; let length = 0;
  for await (const chunk of request) {
    length += chunk.length; insist(length <= IDENTITY_LIMIT + 16 * 1024);
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createParticipantAccountRelay({enabled = process.env.NONVERBA_ACCOUNT_RELAY === 'local',
  exchange = dispatch, now = Date.now, timeoutMs = 7000} = {}) {
  insist(process.env.NONVERBA_ACCOUNT_RELAY === undefined || process.env.NONVERBA_ACCOUNT_RELAY === 'local',
    'Use only NONVERBA_ACCOUNT_RELAY=local for the reviewed development relay.');
  insist(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 7000);
  const flows = new Map();
  let active = 0, windowStart = now(), requests = 0;
  function discardFlow(id) {
    const flow = flows.get(id);
    if (!flow) return;
    clearTimeout(flow.timer); delete flow.cookie; flows.delete(id);
  }
  function prune() { for (const [id, flow] of flows) if (flow.expires <= now()) discardFlow(id); }
  async function exchangeBounded(input) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await exchange(input, {signal:controller.signal}); }
    finally { clearTimeout(timer); }
  }
  return async function handle(request, response) {
    const path = request.url;
    if (!['/account-api/config', '/account-api/transport'].includes(path)) return false;
    if (path === '/account-api/config') {
      if (request.headers.host !== '127.0.0.1:4173') send(response, 403, {error:'account_transport_origin'});
      else if (request.method !== 'GET') send(response, 405, {error:'account_transport_method'});
      else send(response, 200, {enabled, development_only:true});
      return true;
    }
    if (!enabled) { send(response, 404, {error:'account_transport_disabled'}); return true; }
    if (request.method !== 'POST' || request.headers.host !== '127.0.0.1:4173' || request.headers.origin !== ORIGIN
      || request.headers['x-nonverba-account'] !== '1'
      || request.headers['content-type'] !== 'application/json'
      || (request.headers['sec-fetch-site'] && !['same-origin','none'].includes(request.headers['sec-fetch-site']))) {
      send(response, 403, {error:'account_transport_origin'}); return true;
    }
    if (now() - windowStart >= 60_000) { windowStart = now(); requests = 0; }
    if (++requests > 120 || active >= 4) { send(response, 429, {error:'account_transport_busy'}); return true; }
    active++;
    let id, reservation;
    try {
      request.setTimeout?.(3000, () => request.destroy());
      const wire = await readWire(request); id = wire?.id;
      request.setTimeout?.(0);
      prune();
      const authorizationPost = wire?.request?.method === 'POST'
        && typeof wire.request.path === 'string' && wire.request.path.split('?', 1)[0] === '/dev-oidc/authorize';
      const candidate = authorizationPost && flowId(wire.request.flow_id) ? flows.get(wire.request.flow_id) : null;
      const authorizationFlow = candidate ? {cookie:candidate.cookie, expires:candidate.expires} : null;
      if (authorizationPost) discardFlow(wire.request.flow_id);
      const input = validateAccountTransport(wire);
      insist(Buffer.byteLength(JSON.stringify(wire)) <= (input.path === IDENTITY_SUBMIT ? IDENTITY_LIMIT + REQUEST_LIMIT : input.path === PROVE ? 208 * 1024 : REQUEST_LIMIT));
      const auth = input.path.split('?', 1)[0] === '/dev-oidc/authorize';
      if (auth && input.method === 'POST') {
        const flow = authorizationFlow;
        insist(flow && typeof flow.cookie === 'string' && flow.expires > now(), 'account_authorization_flow_expired');
        input.headers.Cookie = 'nv_dev_oidc=' + flow.cookie;
        input.headers.Origin = UPSTREAM;
      }
      let reserved;
      if (auth && input.method === 'GET') {
        insist(flows.size < MAX_FLOWS && !flows.has(input.flow_id), 'account_authorization_busy');
        reserved = {expires:now() + FLOW_LIFETIME};
        flows.set(input.flow_id, reserved);
        // Discard idle cookies at their deadline, independently of later traffic.
        reserved.timer = setTimeout(() => {
          if (flows.get(input.flow_id) === reserved) discardFlow(input.flow_id);
        }, FLOW_LIFETIME);
        reserved.timer.unref();
        reservation = {id:input.flow_id, entry:reserved};
      }
      const upstream = await exchangeBounded(input);
      insist(Number.isInteger(upstream.status) && upstream.status >= 200 && upstream.status <= 599
        && typeof upstream.body === 'string' && Buffer.byteLength(upstream.body) <= responseLimit(input), 'account_response_invalid');
      const cookies = upstream.headers['set-cookie'];
      if (cookies !== undefined) {
        insist(Array.isArray(cookies) && cookies.length === 1, 'account_cookie_invalid');
        if (auth && input.method === 'GET') {
          const match = /^nv_dev_oidc=([A-Za-z0-9_-]{43}); Path=\/dev-oidc; HttpOnly; SameSite=Lax; Max-Age=300$/.exec(cookies[0]);
          insist(match && flowId(match[1]) && flows.get(input.flow_id) === reserved, 'account_cookie_invalid');
          reserved.cookie = match[1];
        } else insist(auth && input.method === 'POST'
          && cookies[0] === 'nv_dev_oidc=; Path=/dev-oidc; HttpOnly; SameSite=Lax; Max-Age=0', 'account_cookie_invalid');
      } else insist(!auth || input.method !== 'GET', 'account_cookie_missing');
      const headers = {};
      const type = upstream.headers['content-type'];
      if (typeof type === 'string') headers['content-type'] = type;
      if (upstream.status >= 300 && upstream.status < 400) {
        insist(auth && input.method === 'POST' && upstream.status === 303, 'account_redirect_refused');
        const target = new URL(upstream.headers.location);
        const query = form(target.search.slice(1), ['code','state'], ['code','state']);
        insist(target.origin === UPSTREAM && target.pathname === '/dev-callback' && !target.hash
          && !target.username && !target.password && /^[A-Za-z0-9_-]{43}$/.test(query.code) && opaque.test(query.state),
        'account_redirect_refused');
        headers.location = target.href;
      }
      const result = {id, response:{status:upstream.status, headers, body:upstream.body}};
      insist(Buffer.byteLength(JSON.stringify(result)) <= serializedResponseLimit(input), 'account_response_too_large');
      send(response, 200, result);
    } catch {
      if (reservation && flows.get(reservation.id) === reservation.entry) discardFlow(reservation.id);
      // Deliberately omit input/upstream exception text: it can contain secrets.
      if (typeof id === 'string' && uuid.test(id)) send(response, 200, {id,
        response:{status:502, headers:{'content-type':'application/json'}, body:'{"error":"account_transport_refused"}'}});
      else send(response, 400, {error:'account_transport_invalid'});
    } finally { active--; }
    return true;
  };
}
