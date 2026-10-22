// SPDX-License-Identifier: AGPL-3.0-only
// Platform transport owns cookies. Credentials/tokens stay out of storage,
// snapshots, app URLs and diagnostics; operation receipts never grant a login.
import {ACCOUNT_TERMS_CONTENT_JSON, ACCOUNT_TERMS_CONTENT_SHA256} from './account-terms.js';
const ISSUER = 'http://127.0.0.1:8080/dev-oidc';
const CLIENT = 'nonverba-dev-apk', REDIRECT = 'http://127.0.0.1:8080/dev-callback';
const encode = value => new TextEncoder().encode(value);
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const check = (condition, code = 'service_response_invalid', message = 'The account service returned an unsupported response.') => {
  if (!condition) fail(code, message);
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const safe = value => Number.isSafeInteger(value) && value >= 0;
const now = () => Math.floor(Date.now() / 1000);
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
function unb64(value, length = null) {
  check(typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value));
  let bytes;
  try { bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)), character => character.charCodeAt(0)); }
  catch { fail('service_response_invalid', 'The account service returned invalid encoded data.'); }
  check(b64(bytes) === value && (length === null || bytes.length === length)); return bytes;
}
const random = () => b64(globalThis.crypto.getRandomValues(new Uint8Array(32)));
function newRecoveryCodes() {
  const codes = Array.from({length:8},random);
  check(new Set(codes).size === 8,'recovery_codes_invalid','Recovery codes could not be generated.');
  return codes;
}
const sha = async value => new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', encode(value)));
const rolesValid = roles => Array.isArray(roles) && roles.length > 0 && roles.length <= 2
  && new Set(roles).size === roles.length && roles.every(role => role === 'R' || role === 'O');
function localEmail(value, realEmail = false) {
  const hint = realEmail ? 'Enter a valid email address.' : 'Email delivery is not configured. Use a synthetic .invalid or .test contact.';
  check(typeof value === 'string', 'email_invalid', hint);
  const email = value.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, '').replace(/[A-Z]/g, character => character.toLowerCase()), parts = email.split('@');
  check(email.length <= 254 && /^[\x00-\x7f]+$/.test(email) && parts.length === 2
    && parts[0].length > 0 && parts[0].length <= 64 && !parts[0].startsWith('.') && !parts[0].endsWith('.')
    && !parts[0].includes('..') && /^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+$/.test(parts[0])
    && parts[1].includes('.') && (realEmail || parts[1].endsWith('.invalid') || parts[1].endsWith('.test'))
    && parts[1].split('.').every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)),
  'email_invalid', hint);
  return email;
}
export function loginIdentifier(value) {
  const hint = 'Enter your email or username.';
  check(typeof value === 'string','identifier_invalid',hint);
  const text = value.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g,'').replace(/[A-Z]/g,character=>character.toLowerCase());
  if (text.includes('@') && !text.startsWith('@')) return {email:localEmail(text,true)};
  const username = text.startsWith('@') ? text.slice(1) : text;
  check(/^[a-z][a-z0-9_]{2,29}$/.test(username),'identifier_invalid',hint);
  return {username};
}
function passwordValid(value) {
  check(typeof value === 'string' && encode(value).length >= 8 && encode(value).length <= 1024,
    'password_invalid', 'Enter your password.');
}
// Local guidance, not an entropy estimate. New-password rules match the server;
// existing passwords retain the separate legacy sign-in validation above.
const COMMON_PASSWORDS = ['password','password123','password1234','password123456','password123456789',
  'qwerty','qwerty123','qwertyuiop','123456','123456789','1234567890','letmein','welcome','welcome123',
  'admin','administrator','iloveyou','changeme','correcthorsebatterystaple'];
const simplePassword = value => value.replace(/[^A-Za-z0-9]/g,'').toLowerCase();
function repeatingPassword(chars) {
  for (let width=1;width<=Math.min(4,Math.floor(chars.length/2));width++)
    if (chars.length % width === 0 && chars.every((c,index)=>c===chars[index % width])) return true;
  return false;
}
function tokenPassword(value,token) {
  if (token.length < 3 || value.length < token.length) return false;
  if (value.startsWith(token) && /^\d{0,10}$/.test(value.slice(token.length))) return true;
  return value.length % token.length === 0 && token.repeat(value.length/token.length) === value;
}
function sequencePassword(value) {
  return value.length >= 4 && ['abcdefghijklmnopqrstuvwxyz','0123456789','qwertyuiop','asdfghjkl','zxcvbnm'].some(seed =>
    [seed,[...seed].reverse().join('')].some(direction => [...direction].some((_,start) =>
      [...value].every((c,index)=>c===direction[(start+index)%direction.length]))));
}
export function passwordStrength(value, {username = '',email = ''} = {}) {
  let level = 0, message = 'Use at least 8 characters. Try a few unrelated words.';
  if (typeof value === 'string' && value.length) {
    const chars = [...value], simple = simplePassword(value);
    const folded = [...value.replace(/[A-Z]/g,c=>c.toLowerCase())];
    const repeated = repeatingPassword(folded) || simple.length > 0 && repeatingPassword([...simple]);
    const sequence = sequencePassword(simple);
    const common = COMMON_PASSWORDS.some(token=>tokenPassword(simple,token));
    const accountBased = [simplePassword(username),simplePassword(email.split('@')[0])].some(token=>tokenPassword(simple,token));
    const weak = chars.length < 8 || encode(value).length > 1024 || repeated || sequence || common || accountBased;
    level = weak ? 1 : chars.length >= 32 ? 5 : chars.length >= 24 ? 4 : chars.length >= 20 ? 3 : 2;
    message = !weak ? '' : chars.length < 8 ? 'Use at least 8 characters. Try a few unrelated words.'
      : encode(value).length > 1024 ? 'Use a shorter passphrase.'
      : accountBased ? 'Avoid your username or email. Try a few unrelated words.'
      : common ? 'Avoid common passwords. Try a few unrelated words.'
      : repeated ? 'Avoid repeated characters or patterns. Try a few unrelated words.'
      : 'Avoid letter, number or keyboard sequences. Try a few unrelated words.';
  }
  return {level,acceptable:level>=2,message};
}
function usernameValue(value) {
  check(typeof value === 'string','username_invalid','Use a username with 3–30 letters, numbers or underscores.');
  const username = value.trim().replace(/[A-Z]/g,c=>c.toLowerCase());
  check(/^[a-z][a-z0-9_]{2,29}$/.test(username),'username_invalid','Use 3–30 letters, numbers or underscores, starting with a letter.');
  return username;
}
function termsContent(value) {
  check(exact(value,['id','version','status','title','sections']) && identifier(value.id) && identifier(value.version)
    && value.status === 'draft' && typeof value.title === 'string' && value.title.length <= 160
    && Array.isArray(value.sections) && value.sections.length > 0 && value.sections.length <= 24);
  const sections = value.sections.map(section => {
    check(exact(section,['title','paragraphs']) && typeof section.title === 'string' && section.title.length <= 160
      && Array.isArray(section.paragraphs) && section.paragraphs.length > 0 && section.paragraphs.length <= 16
      && section.paragraphs.every(p=>typeof p === 'string' && p.length > 0 && p.length <= 4000));
    return {paragraphs:[...section.paragraphs],title:section.title};
  });
  return {id:value.id,sections,status:value.status,title:value.title,version:value.version};
}
function factor(value) {
  check(typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value), 'confirmation_invalid', 'Enter the complete local confirmation or recovery code.');
  try { unb64(value, 32); } catch { fail('confirmation_invalid', 'Enter a canonical 32-byte local confirmation or recovery code.'); } return value;
}
function entryCode(value) {
  check(typeof value === 'string' && /^[0-9a-f]{8}$/i.test(value),'confirmation_invalid','Enter all 8 email code characters.');
  return value.toUpperCase();
}
function json(response, maximum = 65536) {
  check(object(response) && Number.isInteger(response.status) && typeof response.body === 'string' && encode(response.body).length <= maximum);
  try { const value = JSON.parse(response.body); check(object(value)); return value; }
  catch { fail('service_response_invalid', 'The account service returned invalid JSON.'); }
}
const SERVER_ERRORS = new Set(['invalid_authorization', 'enrollment_operation_retry_differs', 'confirmation_retry_differs',
  'enrollment_unavailable', 'account_operation_not_found', 'account_operation_expired', 'account_status_rate_limited',
  'recovery_retry_differs', 'recovery_unavailable', 'recovery_factor_consumed', 'recovery_generation_exhausted',
  'work_revision_exhausted', 'account_context_counter_out_of_range', 'fresh_recovery_code_required', 'previously_consumed_recovery_code_forbidden',
  'account_deletion_refused','account_deletion_operation_retry_differs','account_deletion_rate_limited']);
for (const code of ['username_invalid','username_unavailable','email_entry_required','account_terms_changed','password_strength_required']) SERVER_ERRORS.add(code);
function success(response, status = 200) {
  if ([502, 503, 504].includes(response.status)) fail('transport_unavailable', 'The service outcome is unknown. Check its status before retrying.');
  if (response.status !== status) {
    let code = response.status === 401 ? 'invalid_authorization' : 'service_request_failed';
    try { const value = json(response); if (SERVER_ERRORS.has(value.error)) code = value.error; } catch { /* Never display arbitrary error bodies. */ }
    const signupMessage = {username_invalid:'Choose a valid username.',username_unavailable:'That username is taken. Choose another.',
      email_entry_required:'Confirm this email before creating your account.',account_terms_changed:'The Account Terms changed. Open them again before continuing.',
      password_strength_required:'Use at least 8 characters and avoid common passwords, repeats or account details.'}[code];
    fail(code, signupMessage || (code === 'account_deletion_refused' ? 'The test account could not be deleted. Check its current email and password.' : response.status === 401 ? 'Account access or the supplied confirmation factors were refused.'
      : 'The account service could not complete this request. Check its status before retrying.'));
  }
  return json(response);
}
function receipt(value) {
  check(object(value) && identifier(value.account_id) && identifier(value.principal_id) && identifier(value.login_name)
    && rolesValid(value.roles) && value.confirmed === true && safe(value.recovery_generation)); return value;
}
function context(value) {
  receipt(value);
  check(typeof value.email === 'string' && localEmail(value.email,true) === value.email && typeof value.display_name === 'string'
    && safe(value.confirmed_at) && object(value.identity) && value.identity.issuer === ISSUER && value.identity.subject === value.principal_id
    && object(value.work_state) && ['unknown', 'available', 'hold', 'clocked_out', 'signed_out'].includes(value.work_state.state)
    && safe(value.work_state.revision) && safe(value.work_state.updated_at) && identifier(value.current_session_id)
    && value.session_active === true && object(value.session) && value.session.session_id === value.current_session_id
    && [value.session.created_at, value.session.expires_at, value.session.access_expires_at].every(safe)
    && value.session.expires_at > now() && value.session.access_expires_at > now()
    && value.session.access_expires_at <= value.session.expires_at && typeof value.session.can_control_work === 'boolean'
    && value.identity_assurance === 'local_synthetic_contact_confirmation' && value.identity_verification === 'pending'
    && value.development_only === true && typeof value.scope === 'string');
  const binding = value.session;
  check(binding.device_bound === false
    ? ['device_id', 'key_id', 'role', 'public_key_sec1_b64'].every(key => binding[key] === null)
    : binding.device_bound === true && identifier(binding.device_id) && identifier(binding.key_id)
      && ['R', 'O'].includes(binding.role) && value.roles.includes(binding.role) && typeof binding.public_key_sec1_b64 === 'string');
  if (binding.device_bound) unb64(binding.public_key_sec1_b64, 33);
  return value;
}
function expectedBinding(account, expected) {
  if (expected == null) return;
  const fields = ['account_id', 'principal_id', 'recovery_generation', 'current_session_id'];
  check(object(expected) && Object.keys(expected).every(key => [...fields, 'role'].includes(key))
    && fields.every(key => !Object.hasOwn(expected, key) || expected[key] === account[key])
    && (!Object.hasOwn(expected, 'role') || account.roles.includes(({requester: 'R', operator: 'O'})[expected.role] ?? expected.role)),
  'account_changed', 'Account, session or recovery generation changed; reopen this operation.');
}
function discovery(value) {
  check(value.issuer === ISSUER && value.authorization_endpoint === `${ISSUER}/authorize`
    && value.token_endpoint === `${ISSUER}/token` && value.jwks_uri === `${ISSUER}/jwks`
    && value.development_only === true && value.code_challenge_methods_supported?.includes('S256')
    && value.response_types_supported?.includes('code') && value.token_endpoint_auth_methods_supported?.includes('none'));
  return value;
}
const exact = (value, fields) => object(value) && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value,field));
const nullableTime = value => value === null || safe(value);
async function inventoryFeedback(value, current) {
  check(exact(value,['account_id','recovery_generation','keys','requests','keys_has_more','requests_has_more','limit','development_only'])
    && value.account_id === current.account_id && safe(value.recovery_generation) && value.recovery_generation === current.recovery_generation
    && value.development_only === true && value.limit === 256 && typeof value.keys_has_more === 'boolean' && typeof value.requests_has_more === 'boolean'
    && Array.isArray(value.keys) && value.keys.length <= 256 && Array.isArray(value.requests) && value.requests.length <= 256);
  const seenKeys = new Set(), seenRequests = new Set();
  async function key(binding, fingerprint) {
    check(exact(binding,['role','key_id','public_key_sec1_b64']) && identifier(binding.key_id) && ['R','O'].includes(binding.role)
      && current.roles.includes(binding.role) && typeof fingerprint === 'string' && /^[a-f0-9]{64}$/.test(fingerprint));
    const bytes = unb64(binding.public_key_sec1_b64,33); check(bytes[0] === 2 || bytes[0] === 3);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    check([...hash].map(byte=>byte.toString(16).padStart(2,'0')).join('') === fingerprint);
  }
  for (const item of value.keys) {
    check(exact(item,['device_id','key_id','role','public_key_sec1_b64','fingerprint_sha256','approved_at','revoked_at','active'])
      && identifier(item.device_id) && !seenKeys.has(item.key_id) && safe(item.approved_at) && nullableTime(item.revoked_at)
      && typeof item.active === 'boolean' && item.active === (item.revoked_at === null));
    seenKeys.add(item.key_id);
    await key({role:item.role,key_id:item.key_id,public_key_sec1_b64:item.public_key_sec1_b64},item.fingerprint_sha256);
  }
  for (const item of value.requests) {
    check(exact(item,['request_id','device_id','key','fingerprint_sha256','recovery_generation','status','created_at','expires_at','proved_at','approved_at','revoked_at'])
      && identifier(item.request_id) && !seenRequests.has(item.request_id) && identifier(item.device_id)
      && safe(item.recovery_generation) && item.recovery_generation <= current.recovery_generation
      && ['pending_proof','pending_approval','approved','revoked','expired'].includes(item.status)
      && safe(item.created_at) && safe(item.expires_at) && item.expires_at > item.created_at
      && [item.proved_at,item.approved_at,item.revoked_at].every(nullableTime));
    seenRequests.add(item.request_id); await key(item.key,item.fingerprint_sha256);
    if (item.status.startsWith('pending_')) check(item.recovery_generation === current.recovery_generation
      && item.expires_at > now() && item.approved_at === null && item.revoked_at === null
      && (item.status === 'pending_proof' ? item.proved_at === null : item.proved_at !== null));
    if (item.status === 'approved') check(item.recovery_generation === current.recovery_generation && item.proved_at !== null && item.approved_at !== null && item.revoked_at === null);
    if (item.status === 'revoked') check(item.revoked_at !== null);
    if (item.status === 'expired') check(item.expires_at <= now() && item.approved_at === null && item.revoked_at === null);
  }
  if (value.keys_has_more || value.requests_has_more) return {keys:'incomplete',active_keys:null,pending_keys:null,revoked_keys:null};
  if (current.session.device_bound) check(value.keys.some(item=>item.active && item.key_id === current.session.key_id
    && item.device_id === current.session.device_id && item.role === current.session.role && item.public_key_sec1_b64 === current.session.public_key_sec1_b64));
  return {keys:'known',active_keys:value.keys.filter(item=>item.active).length,
    pending_keys:value.requests.filter(item=>item.status.startsWith('pending_')).length,revoked_keys:value.keys.filter(item=>!item.active).length};
}
function authorizeFields(html) {
  check(typeof html === 'string' && html.length <= 32768);
  const values = {authorization_id: new Set(), csrf: new Set()};
  for (const tag of html.match(/<input\b[^>]*>/gi) ?? []) {
    const attributes = Object.fromEntries([...tag.matchAll(/\b(name|value|type)="([^"]*)"/g)].map(match => [match[1], match[2]]));
    if (Object.hasOwn(values, attributes.name) && attributes.type === 'hidden') values[attributes.name].add(attributes.value);
  }
  check(Object.values(values).every(set => set.size === 1));
  return Object.fromEntries(Object.entries(values).map(([key, set]) => [key, factor([...set][0])]));
}
function tokens(value, initial = false) {
  check(value.token_type === 'Bearer' && value.development_only === true && typeof value.access_token === 'string'
    && value.access_token.length > 0 && value.access_token.length <= 8192 && typeof value.refresh_token === 'string'
    && value.refresh_token.length <= 128 && value.refresh_token.length >= 16 && safe(value.expires_in)
    && value.expires_in > 0 && value.expires_in <= 300 && typeof value.device_bound === 'boolean'
    && (!initial || typeof value.id_token === 'string' && value.id_token.length <= 8192)); return value;
}
async function verifyIdToken(token, jwks, nonce) {
  const pieces = token.split('.'); check(pieces.length === 3);
  const decodeJson = part => { try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(unb64(part))); }
    catch { fail('service_response_invalid', 'The service identity token is invalid.'); } };
  const header = decodeJson(pieces[0]), claims = decodeJson(pieces[1]);
  check(object(header) && header.alg === 'ES256' && header.typ === 'JWT' && identifier(header.kid)
    && object(jwks) && Array.isArray(jwks.keys) && jwks.keys.length > 0 && jwks.keys.length <= 8 && jwks.keys.every(object));
  const keys = jwks.keys.filter(key => key.kid === header.kid); check(keys.length === 1); const key = keys[0];
  check(key.kty === 'EC' && key.crv === 'P-256' && key.use === 'sig' && key.alg === 'ES256');
  unb64(key.x, 32); unb64(key.y, 32); let valid = false;
  try {
    const publicKey = await globalThis.crypto.subtle.importKey('jwk', {kty: 'EC', crv: 'P-256', x: key.x, y: key.y}, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
    valid = await globalThis.crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, publicKey, unb64(pieces[2], 64), encode(`${pieces[0]}.${pieces[1]}`));
  } catch { /* Invalid keys/signatures never establish identity. */ }
  check(valid && object(claims) && claims.iss === ISSUER && claims.aud === CLIENT && claims.kind === 'id'
    && claims.nonce === nonce && identifier(claims.sub) && identifier(claims.sid) && identifier(claims.jti)
    && safe(claims.iat) && safe(claims.exp) && claims.iat <= now() && claims.exp > now()
    && claims.exp > claims.iat && claims.exp - claims.iat <= 300,
  'identity_token_invalid', 'The account service identity token could not be verified.'); return claims;
}

export function createServiceAccountAdapter({request, device, onChange = () => {}} = {}) {
  check(typeof request === 'function' && typeof onChange === 'function', 'adapter_configuration_invalid', 'An account service transport is required.');
  let configured = false, configurePromise = null, realEmailEnabled = false, emailDelivery = 'disabled', state = 'signed_out', account = null, session = null;
  let epoch = 0, operation = null, entry = null, releasedCodes = null, refreshPromise = null, sessionOutcome = 'none';
  let feedbackPromise = null, feedbackVersion = 0;
  let deviceStatus = 'unregistered';
  const emptyKeys = keys => ({keys,active_keys:null,pending_keys:null,revoked_keys:null,current_key_bound:null});
  let feedback = {api:'unknown',service:'unknown',...emptyKeys('signin_required')};
  let requestAbort = new AbortController(); const inflight = new Set();
  const snapshot = () => ({development_only: true, scope: 'local_synthetic_account_service', configured, real_email_enabled:realEmailEnabled, email_delivery:emailDelivery, state,
    deletion_pending:operation?.kind === 'deletion' && ['pending','unknown'].includes(operation.state),
    email: account?.email ?? operation?.email ?? null, entry:entry ? entry.mode === 'sign_in'
      ? {mode:'sign_in',step:'password',identifier:entry.identifier,email:entry.email,username:entry.username}
      : {mode:'signup',email:entry.email,...(entry.username ? {username:entry.username} : {}),step:entry.step} : null,
    displayName: account?.display_name ?? operation?.display_name ?? null, username:account?.username ?? operation?.username ?? null,
    roles: [...(account?.roles ?? operation?.roles ?? [])], confirmed: account?.confirmed ?? operation?.receipt?.confirmed ?? false,
    recovery_generation: account?.recovery_generation ?? operation?.receipt?.recovery_generation ?? null,
    genuine_authentication: false, identity_verification: 'pending', device_status:deviceStatus, operation: operation?.kind ?? null,
    operation_state: operation?.state ?? null, session_outcome: sessionOutcome, recovery_code_available: releasedCodes !== null, feedback:{...feedback}});
  const notify = () => { const value = snapshot(); onChange(structuredClone(value)); return value; };
  const active = captured => check(captured === epoch, 'stale_operation', 'This account operation was superseded.');
  const currentOwner = owner => state === 'signed_in' && session && account
    && session.principalId === owner.principal_id && session.sessionId === owner.current_session_id
    && ['account_id','principal_id','recovery_generation','current_session_id'].every(field=>account[field] === owner[field])
    && account.roles.length === owner.roles.length && account.roles.every(role=>owner.roles.includes(role))
    && ['device_bound','device_id','key_id','role','public_key_sec1_b64'].every(field=>account.session[field] === owner.session[field]);
  const cancelled = signal => check(!signal?.aborted, 'operation_aborted', 'Account operation cancelled.');
  const fence = () => {
    releasedCodes = null;
    epoch++; feedbackVersion++; feedbackPromise = null;
    if (feedback.api === 'checking') feedback.api = 'unknown';
    if (feedback.service === 'checking') feedback.service = 'unknown';
    if (feedback.keys === 'checking') Object.assign(feedback,emptyKeys(session ? 'unknown' : 'signin_required'));
    requestAbort.abort(); requestAbort = new AbortController(); return epoch;
  };
  const send = async (input, captured = epoch) => {
    cancelled(input.signal); active(captured); let response;
    const controller = new AbortController(), abort = () => controller.abort();
    const signals = [requestAbort.signal, input.signal].filter(Boolean);
    signals.forEach(signal => signal.addEventListener('abort', abort, {once: true}));
    const pending = {method: input.method, path: input.path}; inflight.add(pending);
    try { response = await request({...input, signal: controller.signal}); }
    catch { cancelled(input.signal); active(captured); fail('transport_unavailable', 'The service outcome is unknown. Check its status before retrying.'); }
    finally { inflight.delete(pending); signals.forEach(signal => signal.removeEventListener('abort', abort)); }
    cancelled(input.signal); active(captured);
    check(object(response) && Number.isInteger(response.status) && typeof response.body === 'string'); return response;
  };
  const post = (path, body, captured, signal) => send({method: 'POST', path, headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal}, captured);
  const form = (path, body, captured, flow_id) => send({method: 'POST', path,
    headers: {'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(body).toString(), ...(flow_id ? {flow_id} : {})}, captured);
  const clearSession = outcome => { session = null; account = null; deviceStatus = 'unregistered'; sessionOutcome = outcome; Object.assign(feedback,emptyKeys('signin_required')); };
  const unresolvedDeletion = () => check(!(operation?.kind === 'deletion' && ['pending','unknown'].includes(operation.state)),
    'deletion_unconfirmed', 'Check the original account deletion before starting another account action.');
  function deleted(value) {
    check(object(value) && Object.keys(value).length === 2 && value.state === 'deleted' && object(value.receipt));
    const receipt = value.receipt;
    check(Object.keys(receipt).length === 7 && receipt.operation_id === operation.id
      && receipt.account_id === operation.account_id && receipt.principal_id === operation.principal_id
      && safe(receipt.deleted_at) && receipt.development_only === true && receipt.email_reusable === true
      && receipt.retention === 'historical_records_and_backups_preserved');
    operation.state = 'deleted'; operation.receipt = structuredClone(receipt);
    clearSession('revoked'); releasedCodes = null; state = 'deleted'; return notify();
  }
  const unknown = (error, captured) => {
    if (captured === epoch && ['transport_unavailable', 'operation_aborted'].includes(error.code)) { state = 'outcome_unknown'; notify(); }
    throw error;
  };
  async function configure() {
    if (configured) return snapshot();
    if (!configurePromise) configurePromise = (async () => {
      discovery(success(await send({method: 'GET', path: '/dev-oidc/.well-known/openid-configuration'})));
      // Older local services remain usable for synthetic contacts only. A
      // capability is configuration readiness, never a delivery receipt.
      realEmailEnabled = false;
      emailDelivery = 'disabled';
      try {
        const capability = success(await send({method:'GET',path:'/v1/accounts/capabilities'}));
        check(Object.keys(capability).length === 3 && capability.development_only === true
          && ['disabled','mock','smtp'].includes(capability.email_delivery) && typeof capability.real_email_enabled === 'boolean'
          && capability.real_email_enabled === (capability.email_delivery === 'smtp'));
        realEmailEnabled = capability.real_email_enabled;
        emailDelivery = capability.email_delivery;
      } catch (error) { if (['stale_operation','operation_aborted'].includes(error.code)) throw error; }
      configured = true; return notify();
    })().finally(() => { configurePromise = null; });
    return configurePromise;
  }
  async function accountTerms({signal} = {}, captured = epoch) {
    cancelled(signal); active(captured);
    const value = success(await send({method:'GET',path:'/v1/accounts/terms',signal},captured));
    check(exact(value,['terms','content_sha256']) && /^[0-9a-f]{64}$/.test(value.content_sha256));
    const content = termsContent(value.terms), canonical = JSON.stringify(content);
    const digest = [...await sha(canonical)].map(n=>n.toString(16).padStart(2,'0')).join('');
    active(captured); cancelled(signal);
    check(digest === value.content_sha256 && digest === ACCOUNT_TERMS_CONTENT_SHA256 && canonical === ACCOUNT_TERMS_CONTENT_JSON,
      'account_terms_changed','The Account Terms changed. Update this app before continuing.');
    return {...content,content_sha256:digest};
  }
  async function refresh(captured) {
    active(captured); check(session, 'account_required', 'Sign in to the account service first.');
    if (refreshPromise?.epoch === captured) return refreshPromise.promise;
    const prior = session;
    const pending = (async () => {
      try {
        const value = tokens(success(await form('/dev-oidc/token', {grant_type: 'refresh_token', client_id: CLIENT, refresh_token: prior.refreshToken}, captured)));
        active(captured); session = {...prior, accessToken: value.access_token, refreshToken: value.refresh_token, expiresAt: now() + value.expires_in};
      } catch (error) {
        if (captured === epoch) { clearSession(error.code === 'transport_unavailable' ? 'unknown' : 'none');
          state = error.code === 'transport_unavailable' ? 'outcome_unknown' : 'signed_out'; notify(); }
        throw error;
      }
    })();
    refreshPromise = {epoch: captured, promise: pending};
    try { return await pending; } finally { if (refreshPromise?.promise === pending) refreshPromise = null; }
  }
  async function readAccount({signal, expected, expectedEmail, expectedUsername, quiet = false} = {}, captured = epoch) {
    cancelled(signal); active(captured); check(session, 'account_required', 'Sign in to the account service first.');
    try {
      if (session.expiresAt <= now() + 5) await refresh(captured);
      cancelled(signal); active(captured);
      const read = token => send({method: 'GET', path: '/v1/account/context', headers: {authorization: `Bearer ${token}`}, signal}, captured);
      let sentAccess = session.accessToken, response = await read(sentAccess);
      if (response.status === 401) {
        // A concurrent read may already have rotated this access token. Reuse
        // that completed refresh rather than consuming the next refresh twice.
        check(session, 'account_required', 'Sign in to the account service first.');
        if (sentAccess === session.accessToken) await refresh(captured);
        cancelled(signal); active(captured); sentAccess = session.accessToken; response = await read(sentAccess);
      }
      const value = context(success(response));
      check(value.principal_id === session.principalId && value.current_session_id === session.sessionId
        && (expectedEmail === undefined || value.email === expectedEmail)
        && (expectedUsername === undefined || value.username === expectedUsername), 'account_changed', 'The service returned a different account session.');
      expectedBinding(value, expected); active(captured); cancelled(signal);
      account = structuredClone(value); if (sentAccess === session.accessToken) session.expiresAt = value.session.access_expires_at;
      if (!quiet) {
        feedback.current_key_bound = value.session.device_bound;
        if (feedback.keys === 'signin_required') feedback.keys = 'unknown';
      }
      state = 'signed_in'; sessionOutcome = 'active'; notify(); return structuredClone(value);
    } catch (error) {
      if (captured === epoch && !['operation_aborted', 'stale_operation'].includes(error.code)) {
        if (error.code === 'invalid_authorization') { clearSession('none'); state = 'signed_out'; }
        else { account = null; state = 'outcome_unknown'; sessionOutcome = 'unknown'; Object.assign(feedback,emptyKeys('unknown')); }
        notify();
      }
      throw error;
    }
  }
  const authenticated = (method,path,body,captured = epoch,signal) => send({method,path,
    headers:{authorization:`Bearer ${session.accessToken}`,...(body === undefined ? {} : {'content-type':'application/json'})},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),signal},captured);
  const attestation = (value,platform) => {
    if (!object(value) || value.state_scope !== 'at-key-generation') return false;
    if (value.status === 'unverified') return exact(value,['status','reason','state_scope'])
      && typeof value.reason === 'string' && /^[a-z_]{1,80}$/.test(value.reason);
    return value.status === 'verified' && platform === 'android' && value.reason === 'google_hardware_attestation'
      && ['trusted-environment','strongbox'].includes(value.security_level) && value.device_locked === true
      && value.verified_boot_state === 'verified' && value.package_name === 'org.nonverba.participant'
      && ['generation_challenge_issued_at','enrollment_received_at','verified_at','trust_valid_until',
        'os_version','os_patch_level','vendor_patch_level','boot_patch_level','version_code'].every(field=>safe(value[field]))
      && value.enrollment_received_at >= value.generation_challenge_issued_at
      && value.enrollment_received_at - value.generation_challenge_issued_at <= 120
      && value.verified_at >= value.enrollment_received_at && value.verified_at <= now() + 5
      && value.verified_at - value.enrollment_received_at <= 2592000 && value.trust_valid_until > now()
      && value.version_code > 0;
  };
  async function registerDevice(current,captured) {
    if (!device) return;
    try {
      check(['android','browser'].includes(device.platform) && typeof device.prove === 'function');
      const description = device.describe ? await device.describe({signal:requestAbort.signal}) : device;
      active(captured); check(currentOwner(current),'account_changed','The account session changed during device registration.');
      check(description.platform === device.platform && typeof description.name === 'string' && description.name.length <= 120);
      const value = success(await authenticated('POST','/v1/account/signin-devices/challenge',
        {operation_id:`signin-device:${random()}`,platform:device.platform,name:description.name},captured));
      check(currentOwner(current),'account_changed','The account session changed during device registration.');
      check(value.account_id === current.account_id && value.current_session_id === current.current_session_id
        && value.recovery_generation === current.recovery_generation && value.platform === device.platform
        && identifier(value.challenge_id) && safe(value.issued_at) && safe(value.expires_at)
        && value.issued_at <= now() + 5 && value.expires_at > now() && value.expires_at - value.issued_at <= 120
        && /^[A-Za-z0-9+/]{43}=$/.test(value.challenge_b64));
      check(atob(value.challenge_b64).length === 32 && btoa(atob(value.challenge_b64)) === value.challenge_b64);
      const proof = await device.prove(structuredClone(value),{signal:requestAbort.signal}); active(captured);
      check(currentOwner(current),'account_changed','The account session changed during device registration.');
      check(object(proof) && typeof proof.public_spki_der_b64 === 'string' && proof.public_spki_der_b64.length <= 256
        && typeof proof.signature_b64 === 'string' && proof.signature_b64.length === 88
        && (proof.attestation_chain === null || object(proof.attestation_chain)));
      const result = success(await authenticated('POST','/v1/account/signin-devices/prove',{
        challenge_id:value.challenge_id,public_spki_der_b64:proof.public_spki_der_b64,
        signature_b64:proof.signature_b64,attestation_chain:proof.attestation_chain},captured));
      check(result.account_id === current.account_id && result.current_session_id === current.current_session_id
        && identifier(result.device_id) && result.platform === device.platform && result.possession_proven === true
        && /^[0-9a-f]{64}$/.test(result.key_spki_sha256) && attestation(result.attestation,device.platform));
      const spki = Uint8Array.from(atob(proof.public_spki_der_b64),c => c.charCodeAt(0));
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',spki))].map(n=>n.toString(16).padStart(2,'0')).join('');
      active(captured); check(result.key_spki_sha256 === digest);
      check(currentOwner(current),'account_changed','The account session changed during device registration.');
      deviceStatus = result.attestation.status; notify();
    } catch (error) {
      active(captured);
      check(currentOwner(current),'account_changed','The account session changed during device registration.');
      if (['stale_operation','operation_aborted'].includes(error.code) || requestAbort.signal.aborted) throw error;
      // Authentication remains a server decision. A failed device proof never
      // becomes an attestation verdict; its session remains visible as unknown.
      deviceStatus = 'unavailable'; notify();
    }
  }
  async function status(kind) {
    check(operation?.kind === kind, 'operation_required', 'Start this account operation first.');
    const captured = epoch, value = success(await post(`/v1/accounts/${kind === 'enrollment' ? 'enrollments' : 'recovery'}/status`,
      {operation_id: operation.id, operation_secret: operation.secret}, captured));
    check(['pending', kind === 'enrollment' ? 'confirmed' : 'recovered', 'unavailable', 'expired'].includes(value.state)
      && (value.receipt === null || object(value.receipt)) && typeof value.scope === 'string');
    if (value.receipt !== null) receipt(value.receipt);
    check((['confirmed', 'recovered'].includes(value.state)) === (value.receipt !== null));
    operation.state = value.state; operation.receipt = value.receipt;
    if (value.receipt && operation.nextCodes) { releasedCodes = operation.nextCodes; operation.nextCodes = null; }
    state = value.state === 'confirmed' ? 'confirmed' : value.state === 'recovered' ? 'signed_out'
      : kind === 'enrollment' ? 'pending_confirmation' : 'recovery_pending'; return notify();
  }
  async function checkStatus({quiet = false} = {}) {
    if (feedbackPromise?.epoch === epoch) return feedbackPromise.promise;
    const captured = epoch, version = ++feedbackVersion;
    const current = () => captured === epoch && version === feedbackVersion;
    const signedIn = state === 'signed_in' && !!session && ![...inflight].some(item=>item.method !== 'GET');
    if (!quiet) { feedback = {api:'checking',service:'checking',...emptyKeys(signedIn ? 'checking' : session ? 'unknown' : 'signin_required')}; notify(); }
    const pending = (async () => {
      const probes = await Promise.allSettled([
        (async () => { discovery(success(await send({method:'GET',path:'/dev-oidc/.well-known/openid-configuration'},captured))); return 'available'; })(),
        (async () => {
          const response = await send({method:'GET',path:'/readyz'},captured), value = json(response);
          const flags = ['database_select_1','object_store_tcp_reachable','object_store_authenticated_hash_read','migrations_current'];
          check(exact(value,['status',...flags,'scope']) && ['ready','unavailable'].includes(value.status)
            && flags.every(name=>typeof value[name] === 'boolean') && typeof value.scope === 'string' && value.scope.length <= 512
            && (value.status === 'ready') === flags.every(name=>value[name])
            && response.status === (value.status === 'ready' ? 200 : 503));
          return value.status;
        })()
      ]);
      if (!current()) return snapshot();
      const health = {api:probes[0].status === 'fulfilled' ? probes[0].value : 'unavailable',
        service:probes[1].status === 'fulfilled' ? probes[1].value : 'unavailable'};
      if (!quiet || !signedIn) { Object.assign(feedback,health); notify(); }
      if (!signedIn) return snapshot();
      try {
        const owner = await readAccount({quiet},captured);
        if (!current()) return snapshot();
        check(currentOwner(owner),'account_changed','The account session changed during the key status check.');
        if (!quiet) feedback.current_key_bound = owner.session.device_bound;
        let sentAccess = session.accessToken;
        const read = token => send({method:'GET',path:'/v1/account/devices',headers:{authorization:`Bearer ${token}`}},captured);
        let response = await read(sentAccess);
        if (response.status === 401) {
          if (sentAccess === session?.accessToken) await refresh(captured);
          await readAccount({quiet,expected:{account_id:owner.account_id,principal_id:owner.principal_id,
            recovery_generation:owner.recovery_generation,current_session_id:owner.current_session_id}},captured);
          if (!current()) return snapshot();
          sentAccess = session.accessToken; response = await read(sentAccess);
        }
        const summary = await inventoryFeedback(success(response),owner);
        if (!current()) return snapshot();
        // A concurrent context read can lose authority without changing the
        // operation epoch. Never restore its old inventory after that denial.
        check(currentOwner(owner),'account_changed','The account session changed during the key status check.');
        Object.assign(feedback,summary,{current_key_bound:owner.session.device_bound});
      } catch (error) {
        if (!current()) return snapshot();
        if (error.code === 'invalid_authorization') { clearSession('none'); state = 'signed_out'; }
        else Object.assign(feedback,emptyKeys(session ? 'unknown' : 'signin_required'));
      }
      if (current()) { Object.assign(feedback,health); notify(); } return snapshot();
    })();
    feedbackPromise = {epoch:captured,promise:pending};
    try { return await pending; } finally { if (feedbackPromise?.promise === pending) feedbackPromise = null; }
  }
  return Object.freeze({snapshot, configure, checkStatus,
    beginSignIn({identifier} = {}) {
      unresolvedDeletion();
      const selector = loginIdentifier(identifier);
      check(!session,'account_active','Use the current account or sign out first.');
      fence();
      entry = {mode:'sign_in',step:'password',identifier:selector.email ?? `@${selector.username}`,
        email:selector.email ?? null,username:selector.username ?? null};
      return notify();
    },
    async startEntry({identifier:login,email} = {}) {
      unresolvedDeletion();
      check(login === undefined || email === undefined,'identifier_invalid','Enter one email or username.');
      const selector = login === undefined ? {email:localEmail(email,true)} : loginIdentifier(login);
      const started = epoch; await configure(); active(started);
      if (selector.email !== undefined) selector.email = localEmail(selector.email,realEmailEnabled);
      check(!session,'account_active','Use the current account or sign out first.');
      const captured = fence();
      if (!(entry?.step === 'code' && (selector.username !== undefined
        ? entry.username === selector.username : entry.username === undefined && entry.email === selector.email)))
        entry = {id:`entry:${random()}`,secret:random(),email:selector.email ?? null,...selector,step:'code'};
      const value = success(await post('/v1/accounts/entry/start',
        {operation_id:entry.id,operation_secret:entry.secret,...selector},captured),202);
      check(exact(value,['status','scope']) && value.status === 'pending' && value.scope === 'account_email_entry');
      return notify();
    },
    async confirmEntry({code} = {}) {
      code = entryCode(code); check(entry?.step === 'code','operation_required','Enter your email or username first.');
      const captured = fence(), current = entry;
      const value = success(await post('/v1/accounts/entry/confirm',
        {operation_id:current.id,operation_secret:current.secret,confirmation_token:code},captured));
      if (current.username !== undefined) {
        check(exact(value,['next_step','email','username']) && value.next_step === 'password' && value.username === current.username);
        let email;
        try { email = localEmail(value.email,realEmailEnabled); } catch { check(false); }
        check(email === value.email);
        entry = {...current,email,step:'password'};
      } else {
        check(exact(value,['next_step']) && ['password','enrollment'].includes(value.next_step));
        entry = {...current,step:value.next_step};
      }
      return notify();
    },
    resetEntry() { fence(); entry = null; return notify(); },
    async mockMail() {
      const pending = entry?.step === 'code' ? {...entry,kind:'entry'} : operation;
      check(emailDelivery === 'mock' && pending && (pending.kind === 'entry' || ['enrollment','recovery'].includes(pending.kind)
        && ['pending','unknown'].includes(pending.state)), 'mock_mail_unavailable', 'Mock email is available only for a pending test operation.');
      const captured = epoch;
      const value = success(await post('/v1/accounts/mock-mail', {purpose:pending.kind,operation_id:pending.id,operation_secret:pending.secret},captured));
      check(Object.keys(value).length === 3 && value.development_only === true && value.delivery === 'mock');
      return pending.kind === 'entry' ? entryCode(value.confirmation_code) : factor(value.confirmation_code);
    },
    terms: options => accountTerms(options),
    async create({email, password, username, roles = ['R','O'], terms, deliberate} = {}) {
      unresolvedDeletion();
      check(deliberate === true, 'deliberate_required', 'Read and accept the Account Terms before continuing.');
      email = localEmail(email,true); username = usernameValue(username);
      const strength = passwordStrength(password,{username,email});
      check(strength.acceptable,'password_strength_required',strength.message || 'Choose a less predictable password.');
      check(rolesValid(roles) && roles.length === 2,'account_input_invalid','Both account roles are enabled at signup.');
      const started = epoch; await configure(); active(started); email = localEmail(email,realEmailEnabled);
      const currentTerms = await accountTerms({},started);
      check(exact(terms,['id','version','content_sha256']) && ['id','version','content_sha256'].every(field=>terms[field]===currentTerms[field]),
        'account_terms_changed','Open the current Account Terms and accept them before continuing.');
      const entryProof = entry?.step === 'enrollment' && entry.email === email ? {operation_id:entry.id,operation_secret:entry.secret}
        : operation?.kind === 'enrollment' && ['pending','unknown'].includes(operation.state) && operation.email === email
          ? operation.entryProof : null;
      check(entryProof,'email_entry_required','Confirm this email before creating your account.');
      const captured = fence();
      const acceptedTerms = {id:terms.id,version:terms.version,content_sha256:terms.content_sha256};
      const metadata = {email,username,display_name:username,roles:[...roles].sort(),revision:1,reviewed_revision:1,terms:acceptedTerms};
      const reference = [...await sha(JSON.stringify(metadata))].map(value => value.toString(16).padStart(2, '0')).join(''); active(captured);
      if (operation?.receipt && !(operation.kind === 'enrollment' && operation.reference === reference)) operation = null;
      check(operation === null || operation.kind === 'enrollment' && operation.reference === reference,
        'operation_changed', 'The pending account review changed. Reopen the original operation.');
      operation ??= {...metadata,entryProof:structuredClone(entryProof),kind:'enrollment',id:`enroll:${random()}`,secret:random(),reference,state:'pending',receipt:null,nextCodes:null};
      state = 'pending_confirmation'; notify();
      try {
        const value = success(await post('/v1/accounts/enrollments', {operation_id: operation.id, operation_secret: operation.secret,
          ...metadata,password,entry_proof:operation.entryProof,registration_sha256:reference,deliberate:true}, captured),202);
        check(value.status === 'pending' && value.scope === 'local_synthetic_account_enrollment'); return notify();
      } catch (error) {
        // These closed server errors are pre-insert refusals. Keep the confirmed
        // email so the user can correct a username/password and submit anew.
        if (captured === epoch && ['username_invalid','username_unavailable','email_entry_required','account_terms_changed','password_strength_required'].includes(error.code)) {
          operation = null; state = 'signed_out'; notify(); throw error;
        }
        return unknown(error, captured);
      }
    },
    enrollmentStatus: () => status('enrollment'),
    async confirm({code, deliberate} = {}) {
      check(deliberate === true, 'deliberate_required', 'Confirm this local contact deliberately.'); factor(code);
      check(operation?.kind === 'enrollment', 'operation_required', 'Start account creation first.');
      if (operation.state === 'confirmed') return notify();
      const captured = fence(); operation.nextCodes ??= newRecoveryCodes();
      try {
        const value = receipt(success(await post('/v1/accounts/enrollments/confirm', {operation_id: operation.id,
          operation_secret: operation.secret, confirmation_token: code, recovery_codes: operation.nextCodes, deliberate: true}, captured)));
        operation.receipt = value; operation.state = 'confirmed'; releasedCodes = operation.nextCodes; operation.nextCodes = null;
        state = 'confirmed'; return notify();
      } catch (error) { return unknown(error, captured); }
    },
    async signIn({identifier, email, password} = {}) {
      unresolvedDeletion();
      check(identifier === undefined || email === undefined,'identifier_invalid','Enter one email or username.');
      const selector = identifier === undefined ? {email:localEmail(email,true)} : loginIdentifier(identifier);
      const credential = selector.email === undefined ? {account_username:selector.username} : {email:selector.email};
      passwordValid(password); const started = epoch; await configure(); active(started);
      const captured = fence(); clearSession('none'); state = 'signed_out'; notify();
      const verifier = random(), nonce = random(), requestState = random(), flow_id = random();
      try {
        const query = new URLSearchParams({response_type: 'code', client_id: CLIENT, redirect_uri: REDIRECT,
          scope: 'openid', state: requestState, nonce, code_challenge: b64(await sha(verifier)), code_challenge_method: 'S256'});
        const page = await send({method: 'GET', path: `/dev-oidc/authorize?${query}`, flow_id}, captured);
        check(page.status === 200); const fields = authorizeFields(page.body);
        const authorization = await form('/dev-oidc/authorize', {...fields, ...credential, password}, captured, flow_id);
        if (authorization.status !== 303) success(authorization, 303);
        let callback; try { callback = new URL(authorization.headers?.location); } catch { fail('service_response_invalid', 'Invalid account redirect.'); }
        const pairs = [...callback.searchParams];
        check(`${callback.origin}${callback.pathname}` === REDIRECT && !callback.hash && !callback.username && !callback.password
          && pairs.length === 2 && pairs.filter(([key]) => key === 'state').length === 1 && pairs.filter(([key]) => key === 'code').length === 1
          && callback.searchParams.get('state') === requestState); const code = factor(callback.searchParams.get('code'));
        const value = tokens(success(await form('/dev-oidc/token', {grant_type: 'authorization_code', client_id: CLIENT,
          code, redirect_uri: REDIRECT, code_verifier: verifier}, captured)), true);
        const claims = await verifyIdToken(value.id_token, success(await send({method: 'GET', path: '/dev-oidc/jwks'}, captured)), nonce);
        active(captured); session = {accessToken: value.access_token, refreshToken: value.refresh_token, expiresAt: now() + value.expires_in,
          principalId: claims.sub, sessionId: claims.sid};
        const current = await readAccount({expectedEmail:selector.email,expectedUsername:selector.username}, captured);
        await registerDevice(current,captured); active(captured);
        entry = null; return notify();
      } catch (error) {
        if (captured === epoch) { clearSession(error.code === 'transport_unavailable' ? 'unknown' : 'none');
          state = error.code === 'transport_unavailable' ? 'outcome_unknown' : 'signed_out'; notify(); }
        throw error;
      }
    },
    async signOut() {
      unresolvedDeletion();
      check(session, 'account_required', 'There is no local service session to revoke.'); const captured = fence(); entry = null;
      try {
        if (session.expiresAt <= now() + 5) await refresh(captured);
        const value = success(await send({method: 'DELETE', path: '/v1/auth/session', headers: {authorization: `Bearer ${session.accessToken}`}}, captured));
        check(value.revoked === true && value.development_only === true); clearSession('revoked'); state = 'signed_out'; return notify();
      } catch (error) {
        if (captured === epoch) { clearSession('unknown'); state = 'outcome_unknown'; notify(); } throw error;
      }
    },
    discardSession() { fence(); entry = null; clearSession('local_only'); state = 'signed_out'; return notify(); },
    cancel() {
      const uncertain = [...inflight].some(value => value.method !== 'GET');
      if (uncertain && operation) operation.state = 'unknown';
      fence(); entry = null; clearSession(uncertain ? 'unknown' : 'local_only'); state = uncertain ? 'outcome_unknown' : 'signed_out'; return notify();
    },
    async startRecovery({email, recoveryCode} = {}) {
      unresolvedDeletion();
      factor(recoveryCode); const started = epoch; await configure(); active(started); email = localEmail(email,realEmailEnabled); const captured = fence(); entry = null;
      if (!(operation?.kind === 'recovery' && operation.email === email && state === 'outcome_unknown'))
        operation = {kind: 'recovery', email, id: `recover:${random()}`, secret: random(), state: 'pending', receipt: null, nextCodes: null};
      state = 'recovery_pending'; notify();
      try {
        const value = success(await post('/v1/accounts/recovery/start', {operation_id: operation.id, operation_secret: operation.secret,
          email, recovery_code: recoveryCode}, captured), 202);
        check(value.status === 'pending' && value.scope === 'local_synthetic_account_recovery'); return notify();
      } catch (error) { return unknown(error, captured); }
    },
    recoveryStatus: () => status('recovery'),
    async recover({code, newPassword, deliberate} = {}) {
      check(deliberate === true, 'deliberate_required', 'Confirm this recovery deliberately.'); factor(code);
      const strength = passwordStrength(newPassword,{username:account?.username ?? '',email:operation?.email ?? ''});
      check(strength.acceptable,'password_strength_required',strength.message || 'Choose a less predictable password.');
      check(operation?.kind === 'recovery', 'operation_required', 'Start the local recovery challenge first.');
      if (operation.state === 'recovered') return notify();
      const captured = fence(); operation.nextCodes ??= newRecoveryCodes(); clearSession('unknown');
      try {
        const value = receipt(success(await post('/v1/accounts/recovery/finish', {operation_id: operation.id, operation_secret: operation.secret,
          confirmation_token: code, new_password: newPassword, new_recovery_codes: operation.nextCodes, deliberate: true}, captured)));
        operation.receipt = value; operation.state = 'recovered'; releasedCodes = operation.nextCodes; operation.nextCodes = null;
        clearSession('revoked'); state = 'signed_out'; return notify();
      } catch (error) { return unknown(error, captured); }
    },
    recoveryCodes() { return releasedCodes ? [...releasedCodes] : []; },
    clearRecoveryCodes() { if (releasedCodes) { releasedCodes = null; notify(); } },
    async deleteAccount({password,confirmEmail,deliberate} = {}) {
      check(deliberate === true,'deliberate_required','Review and confirm deletion of this test account.');
      unresolvedDeletion(); passwordValid(password); confirmEmail = localEmail(confirmEmail);
      check(emailDelivery === 'mock','account_deletion_unavailable','Test account deletion is available only with mock email.');
      const started = epoch, current = await readAccount({},started);
      check(confirmEmail === current.email,'email_confirmation_mismatch','Enter the email of your currently signed-in test account.');
      active(started); const captured = fence();
      operation = {kind:'deletion',id:`delete:${random()}`,secret:random(),email:current.email,
        account_id:current.account_id,principal_id:current.principal_id,state:'pending',receipt:null};
      releasedCodes = null; notify(); let definiteFailure = false;
      try {
        const response = await send({method:'POST',path:'/v1/account/deletion',
          headers:{'content-type':'application/json',authorization:`Bearer ${session.accessToken}`},
          body:JSON.stringify({operation_id:operation.id,operation_secret:operation.secret,password,confirm_email:confirmEmail,deliberate:true})},captured);
        if ([400,401,403,404,409,422,429].includes(response.status)) {
          definiteFailure = true; operation = null;
          if (response.status === 401) { clearSession('none'); state = 'signed_out'; }
          notify(); success(response);
        }
        return deleted(success(response));
      } catch (error) {
        if (captured === epoch && !definiteFailure) {
          operation.state = 'unknown'; clearSession('unknown'); state = 'outcome_unknown'; notify();
        }
        throw error;
      }
    },
    async deletionStatus() {
      check(operation?.kind === 'deletion','operation_required','There is no original deletion operation to check.');
      if (operation.state === 'deleted') return notify();
      const captured = epoch;
      return deleted(success(await post('/v1/account/deletion/status',
        {operation_id:operation.id,operation_secret:operation.secret},captured)));
    },
    getAccount: options => readAccount(options),
    async devices({signal} = {}) {
      const captured = epoch, current = await readAccount({signal},captured);
      const response = await authenticated('GET','/v1/account/signin-devices',undefined,captured,signal);
      if (response.status !== 200) success(response);
      const value = json(response,256 * 1024);
      check(value.account_id === current.account_id && value.current_session_id === current.current_session_id
        && Array.isArray(value.devices) && value.devices.length <= 256 && value.limit === 256 && typeof value.has_more === 'boolean');
      const ids = new Set();
      for (const item of value.devices) {
        check(object(item) && identifier(item.device_id) && !ids.has(item.device_id) && ['browser','android'].includes(item.platform)
          && typeof item.name === 'string' && item.name.length <= 120 && /^[0-9a-f]{64}$/.test(item.key_spki_sha256)
          && safe(item.first_seen) && safe(item.last_seen) && typeof item.current === 'boolean' && attestation(item.attestation,item.platform)
          && safe(item.active_sessions) && Array.isArray(item.sessions) && item.sessions.length <= 256
          && typeof item.sessions_has_more === 'boolean');
        ids.add(item.device_id);
        for (const entry of item.sessions) check(object(entry) && identifier(entry.session_id)
          && safe(entry.created_at) && safe(entry.last_seen) && safe(entry.expires_at) && typeof entry.current === 'boolean'
          && entry.current === (entry.session_id === current.current_session_id));
      }
      check(Array.isArray(value.unregistered_sessions) && value.unregistered_sessions.length <= 256
        && typeof value.unregistered_sessions_has_more === 'boolean');
      for (const entry of value.unregistered_sessions) check(object(entry) && identifier(entry.session_id)
        && safe(entry.created_at) && safe(entry.expires_at) && typeof entry.current === 'boolean'
        && entry.current === (entry.session_id === current.current_session_id));
      active(captured); check(currentOwner(current),'account_changed','The account session changed while loading devices.');
      return structuredClone(value);
    },
    async revokeSession(sessionId) {
      check(identifier(sessionId),'session_invalid','Choose a signed-in session.');
      const captured = epoch, current = await readAccount({},captured);
      const value = success(await authenticated('POST','/v1/account/sessions/revoke',
        {operation_id:`revoke:${random()}`,session_id:sessionId,deliberate:true},captured));
      check(value.status === 'revoked' && value.session_id === sessionId && value.account_id === current.account_id
        && value.kind === 'session_revoke' && safe(value.revoked_at));
      check(currentOwner(current),'account_changed','The account session changed during sign-out.');
      const own = sessionId === current.current_session_id;
      if (own) { fence(); clearSession('revoked'); state = 'signed_out'; notify(); }
      return {ok:true,current:own};
    },
  });
}
