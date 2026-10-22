// SPDX-License-Identifier: AGPL-3.0-only
// Exact bundled account UI against intercepted HTTP protocol fixtures. Signed
// OIDC test tokens and Chromium's synthetic camera prove client behavior, not a
// deployed service, mailbox, real-person identity, liveness or Android acceptance.
import assert from 'node:assert/strict';
import {createHash, createPublicKey, generateKeyPairSync, sign, verify} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launchBrowser} from './harness.mjs';
import {collectParticipantAssets, PARTICIPANT_SHELL_BUDGET, PARTICIPANT_SHELL_SOURCES} from '../../tools/build/participant-assets.mjs';
import {ACCOUNT_TERMS_CONTENT_JSON,ACCOUNT_TERMS_CONTENT_SHA256} from '../../../web/apps/non-verba/src/account-terms.js';

assert.equal(process.platform, 'linux', 'Run only in managed Debian.');
assert.equal(process.env.NONVERBA_CONTAINER, '1', 'Use the managed launcher.');
const assets = await collectParticipantAssets();
const origin = 'http://127.0.0.1:4173';
const entry = origin + '/assets/participant/index.html';
const EMAIL = 'participant@example.invalid', PASSWORD = 'moss7!Q2';
const CONFIGURED_EMAIL = 'browser-confirmation@example.org';
const NEW_PASSWORD = 'fern8?R4';
const CODE = Buffer.alloc(32, 43).toString('base64url');
const ENTRY_CODE = 'A1B2C3D4';
const protectedWorkspaceViews = ['requester','requester/review','requester/agreement','requester/progress','requester/result',
  'operations/new','operations/review','operator/offer','operator/review','operator/agreement','operator/progress','operator/result'];
const workspaceDestination = name => name.startsWith('requester') ? 'requests' : 'operations';
const ACCOUNT_TERMS = JSON.parse(ACCOUNT_TERMS_CONTENT_JSON), TERMS_DIGEST = ACCOUNT_TERMS_CONTENT_SHA256;
const ACCEPTED_TERMS = {id:ACCOUNT_TERMS.id,version:ACCOUNT_TERMS.version,content_sha256:TERMS_DIGEST};
const ISSUER = 'http://127.0.0.1:8080/dev-oidc', CLIENT = 'nonverba-dev-apk';
const CALLBACK = 'http://127.0.0.1:8080/dev-callback';
const checks = [], errors = [], unexpected = [], screenshots = [];
const sensitive = new Set([EMAIL, CONFIGURED_EMAIL, PASSWORD, NEW_PASSWORD, CODE, ENTRY_CODE]);
const output = resolve('artifacts/qa/participant-onboarding-' + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, {recursive:true});
const browser = await launchBrowser({headless:true, args:['--no-sandbox',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']});
let context, page, recoveryDownloadChecked=false;
const progress=message=>process.stderr.write('[participant-onboarding] '+message+'\n');
async function bounded(promise,label,milliseconds=30000) {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('Timed out waiting for '+label+'.')),milliseconds);timer.unref();
  })]); } finally { clearTimeout(timer); }
}
function trackRequestCompletion(request) {
  let finished,failed;
  const close=()=>{page.off('requestfinished',finished);page.off('requestfailed',failed);};
  const settled=new Promise(resolve=>{
    finished=value=>{if(value===request){close();resolve('finished');}};
    failed=value=>{if(value===request){close();resolve('failed');}};
    page.on('requestfinished',finished);page.on('requestfailed',failed);
  });
  return {wait:()=>bounded(settled,'the captured delayed Devices request to finish or fail'),close};
}
function recoveryBatch(values) {
  assert.ok(Array.isArray(values) && values.length===8 && new Set(values).size===8,'Eight independent recovery codes are required.');
  for (const value of values) {
    assert.match(value,/^[A-Za-z0-9_-]{43}$/); const bytes=Buffer.from(value,'base64url');
    assert.equal(bytes.length,32); assert.equal(bytes.toString('base64url'),value);
  }
  return [...values];
}

function serviceFixture() {
  const {privateKey, publicKey} = generateKeyPairSync('ec', {namedCurve:'P-256'});
  const jwk = {...publicKey.export({format:'jwk'}), kid:'browser-fixture-es256', alg:'ES256', use:'sig'};
  const flows = new Map(), credentials = new Map(), consumedRefresh = new Set(), deletions = new Map(), entries = new Map();
  const journal = [], entryStarts = [], inventorySecrets = new Set();
  const signinChallenges = new Map(), signinDevices = new Map(), signinProofs = [];
  let unregisteredSessionIds = [];
  let count = 0, generation = 0, password = PASSWORD, recoveryCodes = [];
  let enrollment = null, recovery = null, confirmed = false, mode = 'normal', enabled = true, gate = null;
  let email = EMAIL, emailDelivery = 'mock';
  let apiProbe = 'available', serviceProbe = 'ready', keysProbe = 'empty';
  let identityGeneration = 0, freshIdentityRequired = false;
  const identity = () => ({account_id:'account-browser-fixture' + (identityGeneration ? '-' + identityGeneration : ''),
    principal_id:'principal-browser-fixture' + (identityGeneration ? '-' + identityGeneration : '')});
  const opaque = () => Buffer.alloc(32, ++count).toString('base64url');
  const response = (status, body, headers = {}) => ({status, headers:{'cache-control':'no-store', ...headers},
    body:typeof body === 'string' ? body : JSON.stringify(body)});
  const pending = scope => response(202, {status:'pending', scope});
  const receipt = () => ({...identity(),
    login_name:'opaque-login-browser', roles:['R','O'], confirmed:true, recovery_generation:generation});
  const json = request => { assert.equal(typeof request.body, 'string', 'JSON transport body is a string.'); return JSON.parse(request.body); };
  const marker = value => { if (typeof value === 'string' && value) sensitive.add(value); };
  function token(flow, session) {
    const now = Math.floor(Date.now() / 1000);
    const encode = data => Buffer.from(JSON.stringify(data)).toString('base64url');
    const text = encode({alg:'ES256',typ:'JWT',kid:jwk.kid}) + '.' + encode({iss:ISSUER,aud:CLIENT,
      sub:identity().principal_id,sid:session,iat:now,exp:now+300,kind:'id',
      nonce:mode === 'wrong-nonce' ? opaque() : flow.nonce,jti:opaque()});
    const value = text + '.' + sign('sha256',Buffer.from(text),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
    marker(value); return value;
  }
  function accountContext(credential) {
    const now = Math.floor(Date.now()/1000);
    return {...receipt(),email,username:mode==='username-context-mismatch' ? 'different_fixture' : enrollment?.username ?? 'browser_fixture',display_name:'Browser fixture participant',confirmed_at:now-100,
      identity:{issuer:ISSUER,subject:identity().principal_id},work_state:{state:'clocked_out',revision:0,updated_at:now-100},
      current_session_id:credential.session,session_active:true,session:{session_id:credential.session,
        created_at:now-10,expires_at:now+3600,access_expires_at:now+300,device_bound:false,
        device_id:null,key_id:null,role:null,public_key_sec1_b64:null,can_control_work:false},
      identity_assurance:'local_synthetic_contact_confirmation',identity_verification:'pending',
      ...(mode === 'forged-workspace-claims' ? {identity_verified:true,identity_level:'advanced',
        capabilities:{requests:true,operations:true},readiness:{requests:true,operations:true}} : {}),
      development_only:true,scope:'local_synthetic_account_context'};
  }
  async function request(request) {
    assert.ok(request && ['GET','POST','DELETE'].includes(request.method), 'Known transport method.');
    const url = new URL(request.path, 'http://127.0.0.1:8080');
    assert.equal(url.origin,'http://127.0.0.1:8080', 'The fixture accepts only the pinned service.');
    journal.push({method:request.method,path:url.pathname});
    if (gate && gate.path === url.pathname) {
      const current = gate; gate = null; current.enter(); await current.wait;
    }
    if (url.pathname.startsWith('/v1/account/signin-devices') || url.pathname === '/v1/account/sessions/revoke') {
      const credential = credentials.get((request.headers?.authorization || request.headers?.Authorization || '').replace(/^Bearer /,''));
      if (!credential || credential.revoked || credential.generation !== generation || credential.account_id !== identity().account_id)
        return response(401,{error:'invalid_authorization'});
      const time = Math.floor(Date.now()/1000), current = credential.session;
      if (url.pathname.endsWith('/challenge')) {
        const body = json(request); assert.equal(body.platform,'browser');
        const challenge = {challenge_id:Buffer.alloc(32,++count).toString('base64url'),account_id:identity().account_id,
          current_session_id:current,recovery_generation:generation,platform:'browser',issued_at:time,expires_at:time+120,
          challenge_b64:Buffer.alloc(32,count % 255).toString('base64')};
        marker(challenge.challenge_id); marker(challenge.challenge_b64);
        signinChallenges.set(challenge.challenge_id,challenge); return response(200,challenge);
      }
      if (url.pathname.endsWith('/prove')) {
        const body = json(request), challenge = signinChallenges.get(body.challenge_id); assert.ok(challenge);
        assert.equal(challenge.current_session_id,current); assert.equal(body.attestation_chain,null);
        const spki = Buffer.from(body.public_spki_der_b64,'base64');
        const key = createPublicKey({key:spki,format:'der',type:'spki'});
        const transcript = 'NONVERBA:SIGNIN_DEVICE:v1\n'+['challenge_id','account_id','current_session_id','recovery_generation',
          'platform','issued_at','expires_at','challenge_b64'].map(field=>challenge[field]).join('\n')+'\n';
        assert.equal(verify('sha256',Buffer.from(transcript),{key,dsaEncoding:'ieee-p1363'},Buffer.from(body.signature_b64,'base64')),true);
        signinChallenges.delete(body.challenge_id);
        const hash = createHash('sha256').update(spki).digest('hex'), id = 'signin-device-'+hash;
        signinProofs.push({key_spki_sha256:hash,session_id:current,account_id:challenge.account_id,
          recovery_generation:challenge.recovery_generation});
        for (const value of [body.public_spki_der_b64,body.signature_b64,hash,id]) marker(value);
        const item = signinDevices.get(id) ?? {device_id:id,account_id:identity().account_id,platform:'browser',name:'Browser session',
          key_spki_sha256:hash,first_seen:time,last_seen:time,attestation:{status:'unverified',reason:'browser_not_attested',state_scope:'at-key-generation'},sessions:[]};
        item.last_seen = time;
        if (!item.sessions.some(s=>s.session_id===current)) item.sessions.push({session_id:current,created_at:time,expires_at:time+3600,last_seen:time});
        signinDevices.set(id,item);
        return response(200,{...item,current_session_id:current,possession_proven:true});
      }
      if (url.pathname.endsWith('/revoke')) {
        const body = json(request); assert.equal(body.deliberate,true);
        for (const row of credentials.values()) if (row.session === body.session_id) row.revoked = true;
        return response(200,{kind:'session_revoke',account_id:identity().account_id,session_id:body.session_id,status:'revoked',revoked_at:time});
      }
      const valid = session => [...credentials.values()].some(c=>c.session===session && !c.revoked && c.generation===generation && c.account_id===identity().account_id);
      const devices = [...signinDevices.values()].filter(d=>d.account_id===identity().account_id).map(({account_id,...d})=>{
        const sessions = d.sessions.filter(s=>valid(s.session_id)).map(s=>({...s,current:s.session_id===current}));
        return {...d,sessions,active_sessions:sessions.length,current:sessions.some(s=>s.current),sessions_has_more:false};
      });
      const registered = new Set(devices.flatMap(device=>device.sessions.map(session=>session.session_id)));
      const unregistered = [...new Set([...credentials.values()].filter(c=>valid(c.session) && !registered.has(c.session)).map(c=>c.session))]
        .map(session_id=>({session_id,created_at:time-120,expires_at:time+3600,current:session_id===current}));
      unregisteredSessionIds=unregistered.map(session=>session.session_id);
      return response(200,{account_id:identity().account_id,current_session_id:current,devices,has_more:false,limit:256,
        unregistered_sessions:unregistered,unregistered_sessions_has_more:false});
    }
    if (!enabled && ['/dev-oidc/.well-known/openid-configuration','/readyz'].includes(url.pathname)) {
      return response(503,{error:'unavailable'});
    }
    if (request.method === 'GET' && url.pathname === '/v1/accounts/capabilities') return response(200,
      {email_delivery:emailDelivery,real_email_enabled:emailDelivery === 'smtp',development_only:true});
    if (request.method === 'GET' && url.pathname === '/v1/accounts/terms') return mode === 'terms-unavailable'
      ? response(503,{error:'unavailable'}) : response(200,{terms:ACCOUNT_TERMS,content_sha256:TERMS_DIGEST});
    if (request.method === 'POST' && url.pathname === '/v1/accounts/mock-mail') {
      const body = json(request), operation = body.purpose === 'entry' ? entries.get(body.operation_id)
        : body.purpose === 'enrollment' ? enrollment : body.purpose === 'recovery' ? recovery : null;
      assert.deepEqual(Object.keys(body).sort(),['operation_id','operation_secret','purpose']);
      if (emailDelivery !== 'mock' || !/\.(invalid|test)$/.test(operation?.email || email) || !operation
        || body.purpose === 'entry' && operation.username && (!confirmed || operation.username !== enrollment?.username)
        || body.operation_id !== operation.operation_id || body.operation_secret !== operation.operation_secret
        || body.purpose === 'recovery' && !recovery.allowed) return response(401,{error:'invalid_mock_mail'});
      return response(200,{development_only:true,delivery:'mock',confirmation_code:body.purpose === 'entry' ? ENTRY_CODE : CODE});
    }
    if (request.method === 'POST' && url.pathname === '/v1/accounts/entry/start') {
      const body = json(request);
      const selector = Object.hasOwn(body,'username') ? 'username' : 'email';
      assert.deepEqual(Object.keys(body).sort(),['operation_id','operation_secret',selector].sort());
      assert.match(body.operation_id,/^entry:[A-Za-z0-9_-]{43}$/);
      assert.match(body.operation_secret,/^[A-Za-z0-9_-]{43}$/);
      assert.equal(typeof body[selector],'string');
      if (selector === 'username') assert.match(body.username,/^[a-z][a-z0-9_]{2,29}$/);
      marker(body[selector]); marker(body.operation_secret);
      const previous = entries.get(body.operation_id);
      if (previous) assert.deepEqual(body,Object.fromEntries(Object.keys(body).map(key=>[key,previous[key]])),'Entry retries retain the exact private selector and proof.');
      entryStarts.push(structuredClone(body)); entries.set(body.operation_id,body);
      return pending('account_email_entry');
    }
    if (request.method === 'POST' && url.pathname === '/v1/accounts/entry/confirm') {
      const body = json(request), operation = entries.get(body.operation_id);
      assert.deepEqual(Object.keys(body).sort(),['confirmation_token','operation_id','operation_secret']);
      if (!operation || operation.operation_secret !== body.operation_secret) return response(404,{error:'operation_not_found'});
      if (mode === 'entry-expired') return response(410,{error:'confirmation_expired'});
      if (body.confirmation_token !== ENTRY_CODE) return response(401,{error:'invalid_confirmation'});
      if (operation.username) {
        if (!confirmed || operation.username !== enrollment?.username) return response(401,{error:'invalid_confirmation'});
        if (mode === 'username-proof-enrollment') return response(200,{next_step:'enrollment',email,username:operation.username});
        if (mode === 'username-proof-mixed') return response(200,{next_step:'password',email,username:operation.username,account_id:identity().account_id});
        operation.next_step = 'password'; operation.confirmed = true;
        return response(200,{next_step:'password',email,username:operation.username});
      }
      operation.next_step = confirmed && operation.email === email ? 'password' : 'enrollment';
      operation.confirmed = true; return response(200,{next_step:operation.next_step});
    }
    if (request.method === 'GET' && url.pathname === '/readyz') {
      const ready = serviceProbe === 'ready';
      return response(ready ? 200 : 503,{status:ready ? 'ready' : 'unavailable',database_select_1:ready,
        object_store_tcp_reachable:true,object_store_authenticated_hash_read:true,migrations_current:true,
        scope:'Synthetic browser readiness fixture'});
    }
    if (request.method === 'GET' && url.pathname === '/dev-oidc/.well-known/openid-configuration') return apiProbe === 'unavailable'
      ? response(503,{error:'unavailable'}) : response(200,
      {issuer:ISSUER,authorization_endpoint:ISSUER+'/authorize',token_endpoint:ISSUER+'/token',jwks_uri:ISSUER+'/jwks',
        response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],
        subject_types_supported:['public'],id_token_signing_alg_values_supported:['ES256'],code_challenge_methods_supported:['S256'],
        token_endpoint_auth_methods_supported:['none'],development_only:true});
    if (request.method === 'GET' && url.pathname === '/dev-oidc/jwks') return response(200,{keys:[jwk]});
    if (request.method === 'GET' && url.pathname === '/dev-oidc/authorize') {
      const parameters = url.searchParams;
      assert.equal(parameters.get('client_id'),CLIENT); assert.equal(parameters.get('redirect_uri'),CALLBACK);
      assert.equal(parameters.get('response_type'),'code'); assert.equal(parameters.get('code_challenge_method'),'S256');
      for (const key of ['state','nonce','code_challenge']) assert.ok(/^[A-Za-z0-9_-]{43}$/.test(parameters.get(key)),
        'Authorization uses canonical random state, nonce and S256 challenge.');
      assert.equal(parameters.has('password'),false); assert.equal(parameters.has('email'),false);
      const flow = {state:parameters.get('state'),nonce:parameters.get('nonce'),challenge:parameters.get('code_challenge'),
        authorization:opaque(),csrf:opaque(),code:opaque(),used:false};
      marker(flow.state); marker(flow.nonce); marker(flow.authorization); marker(flow.csrf); marker(flow.code);
      flows.set(request.flow_id,flow);
      return response(200, '<!doctype html><form method="post"><input type="hidden" name="authorization_id" value="'
        + flow.authorization + '"><input type="hidden" name="csrf" value="' + flow.csrf + '"></form>', {'content-type':'text/html'});
    }
    if (request.method === 'POST' && url.pathname === '/dev-oidc/authorize') {
      const form = new URLSearchParams(request.body), flow = flows.get(request.flow_id);
      assert.ok(flow, 'Credential submission belongs to an existing authorization flow.');
      assert.ok(form.get('authorization_id') === flow.authorization && form.get('csrf') === flow.csrf,
        'Credential submission echoes the one-use authorization/CSRF values.');
      assert.equal(form.has('username'),false); assert.equal(form.has('login_name'),false);
      const selector=form.has('account_username') ? 'account_username' : 'email';
      assert.deepEqual([...form.keys()].sort(),['authorization_id','csrf','password',selector].sort(),'Exactly one public email or account username credential selector.');
      const selected=selector==='email' ? form.get(selector)===email : form.get(selector)===enrollment?.username;
      if (selector==='account_username') assert.match(form.get(selector),/^[a-z][a-z0-9_]{2,29}$/);
      if (!confirmed || !selected || form.get('password') !== password || mode === 'credential-denial') {
        return response(401,{error:'invalid_credentials'});
      }
      const state = mode === 'wrong-state' ? opaque() : flow.state;
      return response(303,'', {location:CALLBACK+'?code='+flow.code+'&state='+state});
    }
    if (request.method === 'POST' && url.pathname === '/dev-oidc/token') {
      const form = new URLSearchParams(request.body);
      const flow = [...flows.values()].find(value=>value.code===form.get('code'));
      assert.equal(form.has('password'),false); assert.equal(form.has('email'),false);
      assert.equal(form.get('client_id'),CLIENT);
      const grant = form.get('grant_type');
      let session;
      if (grant === 'authorization_code') {
        assert.ok(flow && !flow.used && form.get('code') === flow.code, 'Authorization code is exact and single use.');
        assert.equal(form.get('redirect_uri'),CALLBACK);
        const verifier = form.get('code_verifier'); marker(verifier);
        assert.ok(/^[A-Za-z0-9_-]{43,128}$/.test(verifier),'PKCE verifier has the required format.');
        assert.equal(createHash('sha256').update(verifier).digest('base64url'),flow.challenge,'Actual S256 verifier matches its challenge.');
        flow.used = true; session = 'fixture-session-'+(++count);
      } else {
        assert.equal(grant,'refresh_token');
        const refreshToken = form.get('refresh_token'), previous = credentials.get(refreshToken);
        if (!previous || previous.revoked) return response(401,{error:'invalid_grant'});
        if (consumedRefresh.has(refreshToken)) {
          for (const credential of credentials.values()) if (credential.session === previous.session) credential.revoked = true;
          return response(401,{error:'invalid_grant'});
        }
        consumedRefresh.add(refreshToken);
        session = previous.session;
      }
      const access = 'fixture-access-'+opaque(), refresh = 'fixture-refresh-'+opaque(); marker(access); marker(refresh);
      const credential = {session,generation,...identity(),revoked:false}; credentials.set(access,credential);credentials.set(refresh,credential);
      marker(session);
      return response(200,{access_token:access,refresh_token:refresh,...(flow ? {id_token:token(flow,session)} : {}),
        token_type:'Bearer',expires_in:300,device_bound:false,development_only:true});
    }
    if (request.method === 'GET' && url.pathname === '/v1/account/context') {
      const authorization = request.headers?.Authorization || request.headers?.authorization || '';
      const credential = credentials.get(authorization.replace(/^Bearer /,''));
      if (!credential || credential.revoked || credential.generation !== generation || credential.account_id !== identity().account_id
        || credential.principal_id !== identity().principal_id || mode === 'context-denial') return response(401,{error:'unauthorized'});
      if (mode === 'unsafe-counter') return response(409,{error:'account_context_counter_out_of_range'});
      return response(200,accountContext(credential));
    }
    if (request.method === 'GET' && url.pathname === '/v1/account/devices') {
      const bearer = (request.headers?.Authorization || request.headers?.authorization || '').replace(/^Bearer /,'');
      const credential = credentials.get(bearer);
      if (!credential || credential.revoked || credential.generation !== generation || credential.account_id !== identity().account_id
        || credential.principal_id !== identity().principal_id) return response(401,{error:'unauthorized'});
      if (keysProbe === 'unavailable') return response(503,{error:'unavailable'});
      const now = Math.floor(Date.now()/1000), x = Buffer.from(jwk.x,'base64url'), y = Buffer.from(jwk.y,'base64url');
      const bytes = Buffer.concat([Buffer.from([2+(y.at(-1)&1)]),x]);
      const publicKey = bytes.toString('base64url'), fingerprint = createHash('sha256').update(bytes).digest('hex');
      const device = 'private-browser-device', keyId = 'private-browser-key', requestId = 'private-browser-key-request';
      for (const value of [device,keyId,requestId,publicKey,fingerprint,identity().account_id,identity().principal_id]) {
        marker(value); inventorySecrets.add(value);
      }
      const binding = {role:'R',key_id:keyId,public_key_sec1_b64:publicKey};
      const inventory = {...identity(),recovery_generation:generation,keys:[],requests:[],
        keys_has_more:false,requests_has_more:keysProbe === 'incomplete',limit:256,development_only:true};
      delete inventory.principal_id;
      if (keysProbe === 'pending') inventory.requests.push({request_id:requestId,device_id:device,key:binding,
        fingerprint_sha256:fingerprint,recovery_generation:generation,status:'pending_approval',created_at:now-100,
        expires_at:now+3600,proved_at:now-50,approved_at:null,revoked_at:null});
      if (['active','revoked'].includes(keysProbe)) inventory.keys.push({device_id:device,...binding,fingerprint_sha256:fingerprint,
        approved_at:now-100,revoked_at:keysProbe === 'revoked' ? now-50 : null,active:keysProbe === 'active'});
      if (keysProbe === 'malformed') inventory.recovery_generation = generation+1;
      return response(200,inventory);
    }
    if (request.method === 'POST' && url.pathname === '/v1/accounts/enrollments') {
      const body = json(request);
      assert.ok(body.email === email && body.password === PASSWORD, 'Enrollment carries only the entered fixture credentials.');
      assert.match(body.username,/^[a-z][a-z0-9_]{2,29}$/); assert.equal(body.display_name,body.username);
      assert.deepEqual(body.terms,ACCEPTED_TERMS);
      const proof = entries.get(body.entry_proof?.operation_id);
      assert.ok(proof?.confirmed && proof.next_step === 'enrollment' && proof.email === body.email);
      assert.equal(proof.operation_secret,body.entry_proof.operation_secret);
      assert.deepEqual(body.roles,['O','R']); assert.equal(body.revision,1);assert.equal(body.reviewed_revision,1);assert.equal(body.deliberate,true);
      const reviewed = {email:body.email,username:body.username,display_name:body.username,roles:body.roles,
        revision:body.revision,reviewed_revision:body.reviewed_revision,terms:body.terms};
      assert.equal(body.registration_sha256,createHash('sha256').update(JSON.stringify(reviewed)).digest('hex'));
      if (mode === 'terms-change-on-submit') { mode='terms-unavailable'; return response(409,{error:'account_terms_changed'}); }
      if (mode === 'username-unavailable') return response(409,{error:'username_unavailable'});
      marker(body.operation_secret); enrollment = body; confirmed = false;
      return pending('local_synthetic_account_enrollment');
    }
    if (request.method === 'POST' && url.pathname === '/v1/accounts/enrollments/status') {
      const body = json(request); assert.ok(enrollment && body.operation_id === enrollment.operation_id
        && body.operation_secret === enrollment.operation_secret,'Enrollment lookup retains its original operation.');
      return response(200,{state:'pending',receipt:null,scope:'local_synthetic_account_enrollment'});
    }
    if (request.method === 'POST' && url.pathname === '/v1/accounts/enrollments/confirm') {
      const body = json(request); assert.ok(enrollment && body.operation_id === enrollment.operation_id
        && body.operation_secret === enrollment.operation_secret,'Confirmation uses the original enrollment operation.');
      assert.equal(body.deliberate,true);
      if (body.confirmation_token !== CODE) return response(401,{error:'invalid_confirmation'});
      assert.equal(Object.hasOwn(body,'recovery_code'),false);
      recoveryCodes = recoveryBatch(body.recovery_codes); recoveryCodes.forEach(marker);
      if (freshIdentityRequired) { identityGeneration++; generation = 0; freshIdentityRequired = false; }
      password = enrollment.password; confirmed = true; return response(200,receipt());
    }
    if (request.method === 'POST' && url.pathname === '/v1/account/deletion') {
      const body = json(request);
      assert.deepEqual(Object.keys(body).sort(),['confirm_email','deliberate','operation_id','operation_secret','password']);
      assert.equal(body.deliberate,true);
      const bearer = (request.headers?.Authorization || request.headers?.authorization || '').replace(/^Bearer /,'');
      const credential = credentials.get(bearer);
      if (!credential || credential.revoked || !confirmed || credential.account_id !== identity().account_id) return response(401,{error:'invalid_authorization'});
      if (mode === 'deletion-session-expired') {
        for (const token of credentials.values()) if (token.session === credential.session) token.revoked = true;
        return response(401,{error:'invalid_authorization'});
      }
      if (body.confirm_email !== email || body.password !== password) return response(403,{error:'account_deletion_refused'});
      assert.equal(deletions.has(body.operation_id),false,'Unknown deletion outcomes are resolved by status, never a blind mutation retry.');
      marker(body.operation_secret);
      const deletion = {state:'deleted',receipt:{operation_id:body.operation_id,...identity(),
        deleted_at:Math.floor(Date.now()/1000),development_only:true,email_reusable:true,
        retention:'historical_records_and_backups_preserved'}};
      deletions.set(body.operation_id,{secret:body.operation_secret,result:deletion});
      confirmed = false; freshIdentityRequired = true; recoveryCodes = [];
      for (const token of credentials.values()) if (token.account_id === credential.account_id) token.revoked = true;
      return mode === 'deletion-response-lost' ? response(503,{error:'unavailable'}) : response(200,deletion);
    }
    if (request.method === 'POST' && url.pathname === '/v1/account/deletion/status') {
      const body = json(request);
      assert.deepEqual(Object.keys(body).sort(),['operation_id','operation_secret']);
      assert.equal(Object.keys(request.headers ?? {}).some(key=>key.toLowerCase()==='authorization'),false,
        'Deletion status uses the retained operation secret, not the now-revoked session.');
      const operation = deletions.get(body.operation_id);
      if (!operation || operation.secret !== body.operation_secret || mode === 'deletion-status-unknown') return response(404,{error:'deletion_not_found'});
      return response(200,operation.result);
    }
    if (request.method === 'DELETE' && url.pathname === '/v1/auth/session') {
      if (mode === 'signout-unknown') return response(503,{error:'unavailable'});
      const bearer = (request.headers?.Authorization || request.headers?.authorization || '').replace(/^Bearer /,'');
      const current = credentials.get(bearer);
      for (const credential of credentials.values()) if (credential.session === current?.session) credential.revoked = true;
      return response(200,{revoked:true,scope:'local_synthetic_session_signout',development_only:true});
    }
    if (request.method === 'POST' && url.pathname === '/v1/accounts/recovery/start') {
      const body = json(request); marker(body.operation_secret);
      recovery = {...body,allowed:confirmed && body.email === email && recoveryCodes.includes(body.recovery_code)};
      return pending('local_synthetic_account_recovery');
    }
    if (request.method === 'POST' && url.pathname === '/v1/accounts/recovery/status') {
      const body = json(request); assert.ok(recovery && body.operation_id === recovery.operation_id
        && body.operation_secret === recovery.operation_secret,'Recovery lookup retains its original operation.');
      return response(200,{state:'pending',receipt:null,scope:'local_synthetic_account_recovery'});
    }
    if (request.method === 'POST' && url.pathname === '/v1/accounts/recovery/finish') {
      const body = json(request); assert.ok(recovery && body.operation_id === recovery.operation_id
        && body.operation_secret === recovery.operation_secret,'Recovery finish retains its original operation.');
      assert.equal(body.deliberate,true);
      if (recovery.finishBody) { assert.deepEqual(body,recovery.finishBody); return response(200,receipt()); }
      if (!recovery.allowed || body.confirmation_token !== CODE) return response(401,{error:'invalid_recovery'});
      if (!recoveryCodes.includes(recovery.recovery_code)) return response(409,{error:'recovery_factor_consumed'});
      assert.ok(body.new_password === NEW_PASSWORD,'Recovery rotates to the explicitly entered fixture password.');
      assert.equal(Object.hasOwn(body,'new_recovery_code'),false);
      const nextCodes = recoveryBatch(body.new_recovery_codes);
      assert.ok(nextCodes.every(code=>!recoveryCodes.includes(code)),'Recovery replaces the complete previous set.');
      recovery.finishBody=structuredClone(body); recoveryCodes=nextCodes; recoveryCodes.forEach(marker); password=NEW_PASSWORD; generation++;
      for (const credential of credentials.values()) credential.revoked = true;
      return response(200,receipt());
    }
    throw new Error('Unexpected fixture endpoint '+request.method+' '+url.pathname);
  }
  return {request,journal,get entryStarts(){return entryStarts.map(value=>structuredClone(value));},get enabled(){return enabled;},set enabled(value){enabled=value;},
    set realEmail(value){emailDelivery=value ? 'smtp' : 'disabled';},set delivery(value){emailDelivery=value;},set email(value){email=value;},
    newContact(value){email=value;confirmed=false;},
    get recoveryCodes(){return [...recoveryCodes];},get password(){return password;},get enrollmentUsername(){return enrollment?.username;},set mode(value){mode=value;},
    get identity(){return identity();},
    get inventorySecrets(){return [...inventorySecrets];},
    get signinProofs(){return signinProofs.map(value=>({...value}));},
    get unregisteredSessionIds(){return [...unregisteredSessionIds];},
    addUnregisteredSession() {
      const session = 'fixture-unregistered-session-'+(++count), access = 'fixture-unregistered-access-'+opaque();
      marker(session); marker(access);
      credentials.set(access,{session,generation,...identity(),revoked:false}); return session;
    },
    set probes(value) { apiProbe=value.api ?? 'available'; serviceProbe=value.service ?? 'ready'; keysProbe=value.keys ?? 'empty'; },
    delay(path) {
      assert.equal(gate,null,'A new fixture delay cannot replace an unobserved request gate.');
      let enter,release; const entered = new Promise(resolve => {enter=resolve;});
      const held={path,enter,wait:new Promise(resolve=>{release=resolve;})}; gate=held;
      return {get entered(){return bounded(entered,'the fixture request gate '+path);},release(){if(gate===held)gate=null;release();}};
    }};
}
const service = serviceFixture();

async function check(name, action) { progress('START '+name); await action(); checks.push(name); progress('PASS '+name); }
async function stableUrl() { assert.equal(page.url(), entry, 'Account, media and view state must not enter the URL.'); }
async function view(name, {focused = true} = {}) {
  await page.waitForFunction(expected => history.state?.view === expected
    && document.querySelector('.screen:not([hidden])')?.dataset.view === expected, name);
  if (name !== 'services/api') {
    assert.equal(await page.locator('#api-key-options').evaluate(element=>element.hidden),true,'Route changes reset the key-options disclosure.');
    assert.equal(await page.locator('#api-key-add').getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('#api-key-value').inputValue(),'');
    assert.equal(await page.locator('#api-key-result').evaluate(element=>element.hidden),true);
    for (const id of ['name','permissions','expiry']) assert.equal(await page.locator('#api-key-'+id).inputValue(),'');
  }
  if (name !== 'home') {
    if (name === 'services/docs') assert.equal(await page.locator('#api-documentation-screen').evaluate(element=>element.hidden),false);
    else if (['requests','operations','operator','operator/work'].includes(name)) await page.locator('.screen:not([hidden])[data-view="'+name+'"]').waitFor({state:'visible'});
    else await page.locator(name==='services/api' ? '#api-access-screen' : '[data-onboarding-view="' + name + '"]').waitFor({state:'visible'});
    if (focused) await page.waitForFunction(() => document.activeElement?.id === 'view-title');
    const back=page.locator('#view-navigation button#view-back.back');
    assert.equal(await back.count(),1); assert.equal(await page.locator('#view-back').count(),1);
    assert.equal(await back.getAttribute('type'),'button');
    assert.equal(await page.locator('#view-navigation').getByRole('button',{name:'Back',exact:true}).count(),1);
    assert.equal(await back.isVisible(),true);
  }
  await idle();
  if (name.startsWith('account/')) assert.equal(await page.locator('#onboarding-notice').isVisible(),false,'Account pages omit identity and developer notices.');
}
async function current() { return page.evaluate(() => history.state.view); }
async function screenshot(name) {
  await page.screenshot({path:output + '/' + name + '.png', fullPage:true,
    mask:[page.locator('[data-secret],input[type="password"],.code-slots,#sign-in-preview-code')]}); screenshots.push(name + '.png');
}
async function openSettings() {
  await page.locator('#options-toggle').click();
  await page.locator('#options-panel').waitFor({state:'visible'}); await stableUrl();
}
async function settingsChecked() {
  await page.waitForFunction(() => document.querySelector('.service-status-list').getAttribute('aria-busy') === 'false');
  await stableUrl();
}
async function settingsAccess(signedIn) {
  await workspaceLocked(signedIn ? 'Signed-in account' : 'Signed-out account');
  for (const id of ['configure-api-access','settings-budgets']) {
    assert.equal(await page.locator('#'+id).count(),1);
    assert.equal(await page.locator('#'+id).evaluate(element=>element.hidden),!signedIn,'Settings access follows current signed-in authority: '+id);
    if (await page.locator('#options-panel').isVisible()) assert.equal(await page.locator('#'+id).isVisible(),signedIn);
  }
  assert.equal(await page.locator('#account-key-label,#account-key-detail,[data-status-source="settings-keys"],[data-status-node="keys"]').count(),0);
  assert.equal(await page.locator('#account-setup-link').getAttribute('data-navigate'),'account/sign-in');
  assert.equal((await page.locator('#account-link-label').textContent()).trim(),signedIn ? 'Account' : 'Sign in');
  assert.equal(await page.locator('#options-panel #account-page-actions,#options-panel .account-actions').count(),0);
  for (const id of ['account-devices-link','account-session-continue','account-sign-out','account-delete-link','account-discard-session']) {
    assert.equal(await page.locator('#'+id).count(),1);
    assert.equal(await page.locator('#options-panel #'+id).count(),0,'Account actions do not remain in Settings.');
    assert.equal(await page.locator('#account-page-actions #'+id).count(),1);
  }
  assert.equal(await page.locator('#account-detail-identity').count(),0,'Identity setup belongs to its action rather than a duplicate Account detail row.');
  if (!signedIn) for (const id of ['account-detail-email','account-detail-username'])
    assert.equal(await page.locator('#'+id).textContent(),'','Losing account authority clears ordinary account details too.');
  if (!signedIn) assert.equal(await page.locator('#account-identity-warning').evaluate(node=>node.hidden),true);
}
async function workspaceLocked(label) {
  const result=await page.evaluate(()=>['new-request','list-new-request','new-operation','list-new-operation'].map(id=>{
    const button=document.getElementById(id), advanced=id.includes('operation');
    const hint=advanced ? 'new-operation-prerequisite' : 'new-request-prerequisite';
    return {id,disabled:button.disabled,aria:button.getAttribute('aria-disabled'),
      described:button.getAttribute('aria-describedby')?.split(/\s+/).includes(hint),text:document.getElementById(hint)?.textContent};
  }));
  for (const item of result) {
    assert.equal(item.disabled,true,label+' cannot enable '+item.id+'.'); assert.equal(item.aria,'true'); assert.equal(item.described,true);
    assert.match(item.text,item.id.includes('operation') ? /advanced identity verification/i : /identity verification/i);
  }
}
async function statusKinds(selector) {
  return page.locator(selector).evaluate(host => host.hidden ? [] :
    [...new Set([...host.querySelectorAll('[data-status-kind]')].map(marker=>marker.dataset.statusKind))].sort());
}
async function restoreViewFixture(name,expected=name) {
  if (await current() === name) return view(name,{focused:false});
  const previous=await current();
  await page.evaluate(next=>{
    const index=history.state.index, previous=history.state.view;
    history.pushState({nonverbaPreview:true,index:index+1,view:next},'',location.pathname);
    history.pushState({nonverbaPreview:true,index:index+2,view:previous},'',location.pathname);
  },name);
  await page.goBack(); await view(expected,{focused:expected!==previous});
}
async function gateway() {
  // The capture gateway remains reachable through legacy same-document history;
  // the public Settings entry now goes directly to Sign in.
  await restoreViewFixture('identity/setup');
}
async function accountEntry() {
  const previous=await current();
  await openSettings(); await settingsChecked();
  await page.locator('#account-setup-link').click();
  await page.locator('#options-panel').waitFor({state:'hidden'}); await view('account/sign-in',{focused:previous !== 'account/sign-in'});
}
async function signInPage(signedIn=false, expectedEmail=EMAIL) {
  const panel=page.locator('[data-onboarding-view="account/sign-in"]');
  assert.equal(await page.locator('#view-title').textContent(),signedIn ? 'Account' : 'Sign in');
  assert.equal(await page.locator('#view-eyebrow').isVisible(),false); assert.equal(await page.locator('#view-description').isVisible(),false);
  assert.equal(await page.locator('#onboarding-notice').isVisible(),false);
  assert.equal(await page.locator('#account-email-form').isVisible(),!signedIn);
  assert.equal(await page.locator('#account-email-confirm-form').isVisible(),false);
  assert.equal(await page.locator('#account-sign-in-form').isVisible(),false);
  assert.equal(await page.locator('#sign-in-recover').isVisible(),false);
  assert.equal(await panel.locator('[data-navigate="account/create"]').count(),0);
  assert.equal(await page.locator('#account-session-entry').isVisible(),signedIn);
  assert.doesNotMatch(await panel.innerText(),signedIn ? /local development|scope|principal|fingerprint|attestation|create (?:an? )?account|sign.?up|Google|Apple/i
    : /identity|verif|local development|sign.?up|Google|Apple/i);
  assert.deepEqual(await page.locator('#account-email-form label').allTextContents(),['Email or username']);
  assert.equal(await page.locator('#sign-in-email').getAttribute('type'),'text');
  assert.equal(await page.locator('#sign-in-email').getAttribute('inputmode'),'text');
  assert.equal(await page.locator('#sign-in-email').getAttribute('maxlength'),'254');
  assert.equal((await page.locator('#account-email-submit').textContent()).trim(),'Continue');
  assert.equal(await page.locator('#sign-in-create-account').isVisible(),!signedIn);
  assert.equal((await page.locator('#sign-in-create-account').textContent()).trim(),'Create account');
  assert.equal(await page.locator('#account-session-other').count(),0);
  if (signedIn) {
    assert.equal((await page.locator('#account-session-continue').textContent()).trim(),'Identity verification');
    const warning=page.locator('#account-identity-warning');
    assert.equal(await warning.isVisible(),true,'Pending identity is shown beside its setup action.');
    assert.equal(await warning.getAttribute('aria-hidden'),'true');
    assert.equal(await page.locator('#account-session-continue #account-identity-warning').count(),1);
    assert.equal(await panel.getByRole('button',{name:'Identity verification',exact:true}).count(),1);
    assert.equal(await warning.locator('use').getAttribute('href'),'#warning');
    assert.ok((await page.locator('#account-session-continue').getAttribute('aria-describedby')).split(/\s+/).includes('account-identity-needed'));
    assert.equal(await page.locator('#account-identity-needed').textContent(),'Identity verification is required.');
    assert.equal(await panel.locator('dl.account-profile').getAttribute('aria-label'),'Account details');
    assert.deepEqual(await panel.locator('dl.account-profile dt').allTextContents(),['Email','Username']);
    assert.deepEqual((await panel.locator('#account-page-actions button:visible').allTextContents()).map(text=>text.trim()),['Devices','Identity verification','Sign out','Delete account']);
    assert.equal(await page.locator('#account-detail-email').textContent(),expectedEmail);
    assert.equal(await page.locator('#account-detail-username').textContent(),'@'+service.enrollmentUsername);
    for (const id of ['account-detail-email','account-detail-username']) {
      const detail=page.locator('#'+id);
      assert.equal(await detail.evaluate(node=>node.tagName),'DD');
      assert.notEqual(await detail.evaluate(node=>getComputedStyle(node).userSelect),'none','Ordinary account details remain selectable.');
      assert.equal(await detail.evaluate(node=>{
        const range=document.createRange();range.selectNodeContents(node);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
        const matched=selection.toString()===node.textContent;selection.removeAllRanges();return matched;
      }),true);
    }
    assert.equal(await panel.locator('#account-session-entry input,#account-session-entry textarea,#account-session-entry button').count(),0,
      'Account details show labelled text without credentials or duplicate actions.');
    for (const id of ['account-devices-link','account-sign-out','account-delete-link']) {
      const action=page.locator('#'+id);
      assert.equal(await action.locator('svg').count(),1,'Account actions use the local icon system.');
      assert.equal(await action.locator('svg').getAttribute('aria-hidden'),'true','Action icons preserve the plain accessible label.');
      assert.equal(await action.locator('svg use').evaluate(use=>{
        const href=use.getAttribute('href');return Boolean(href?.startsWith('#') && document.getElementById(href.slice(1)));
      }),true);
    }
    const deleteColor=await page.locator('#account-delete-link').evaluate(button=>getComputedStyle(button).color.match(/\d+(?:\.\d+)?/g)?.map(Number));
    assert.ok(deleteColor && deleteColor[0]>deleteColor[1] && deleteColor[0]>deleteColor[2],'Delete account is visually distinct in red.');
    const geometry=await page.locator('#account-page-actions').evaluate(group=>{
      const buttons=[...group.querySelectorAll('button')].filter(button=>!button.hidden),bounds=group.getBoundingClientRect();
      const rects=buttons.map(button=>button.getBoundingClientRect());
      return {count:buttons.length,stacked:rects.every((rect,index)=>!index || rect.top>=rects[index-1].bottom-1),
        fits:buttons.every((button,index)=>rects[index].left>=bounds.left-1 && rects[index].right<=bounds.right+1 && button.scrollWidth<=button.clientWidth+1),
        targets:rects.every(rect=>rect.height>=44),compact:rects.at(-1).bottom-rects[0].top<=rects.reduce((sum,rect)=>sum+rect.height,0)+8};
    });
    assert.deepEqual(geometry,{count:4,stacked:true,fits:true,targets:true,compact:true},'Account actions use compact separate rows and usable targets.');
    await workspaceLocked('Account details with Pending identity');
  }
}
async function initialSignInPage() {
  for (let attempt=0;attempt<4;attempt++) {
    if (await current()==='account/sign-in' && await page.locator('#account-email-form').isVisible()
      && await page.locator('#sign-in-create-account').isVisible()) return signInPage();
    await page.locator('#view-back').click(); await idle();
  }
  assert.fail('Back did not restore the normal sign-in identifier step.');
}
async function submitForm(id) {
  await page.locator('#' + id + ' button[type="submit"]').click(); await stableUrl();
}
async function idle() {
  await page.waitForFunction(() => document.getElementById('onboarding-screen').getAttribute('aria-busy') === 'false');
  await stableUrl();
}
async function alertShown(pattern) {
  await idle();
  await page.locator('#onboarding-message').waitFor({state:'visible'});
  assert.match(await page.locator('#onboarding-message').innerText(), pattern);
  assert.equal(await page.locator('#onboarding-message').getAttribute('role'), 'alert');
  await stableUrl();
}
async function noSensitiveSideEffects() {
  const state = await page.evaluate(() => ({calls:window.__onboardingForbidden,
    bridges:['NativeVault','NativeLocation','NativeCamera','NativeAudio','NativeEnrollment','NonverbaAccount'].filter(key => key in window),
    cookies:document.cookie, sessionStorage:sessionStorage.length,
    fileInputs:document.querySelectorAll('input[type="file"]').length}));
  assert.deepEqual(state, {calls:[], bridges:[], cookies:'', sessionStorage:0, fileInputs:1});
  const historyState = await page.evaluate(() => JSON.stringify(history.state));
  for (const secret of sensitive) assert.equal(historyState.includes(secret),false,
    'History state carries views only, never credentials, factors, PKCE state or session proof.');
  await stableUrl();
}
async function retained() {
  const entries = await page.evaluate(() => Object.entries(localStorage));
  assert.deepEqual(entries, [], 'Credentials, selected image bytes, image URLs and account authority stay out of local storage.');
  await noSensitiveSideEffects(); return entries;
}
async function layout(label) {
  const state = await page.evaluate(() => {
    const panel = document.querySelector('[data-onboarding-view]:not([hidden])');
    return {viewport:document.documentElement.scrollWidth <= innerWidth + 1,
      panel:panel.scrollWidth <= panel.clientWidth + 1,
      labelled:[...panel.querySelectorAll('input:not([type="hidden"]),select,textarea')].every(input => input.labels?.length > 0)};
  });
  assert.deepEqual(state, {viewport:true, panel:true, labelled:true}, 'Readable, labelled onboarding: ' + label);
  for (const element of await page.locator('[data-onboarding-view]:visible button:visible').all()) {
    const bounds = await element.boundingBox();
    assert.ok(bounds && bounds.height >= 44, 'Onboarding buttons need usable targets: ' + label);
  }
  await stableUrl();
}
async function compactCentered(label) {
  const widths = await page.evaluate(() => {
    const workspace = document.getElementById('workspace').getBoundingClientRect();
    const heading = document.querySelector('.workspace-heading').getBoundingClientRect();
    const content = document.querySelector('.screen:not([hidden])').getBoundingClientRect();
    return {width:workspace.width,center:(workspace.left+workspace.right)/2,viewport:innerWidth/2,
      headingLeft:heading.left,contentLeft:content.left,headingWidth:heading.width,contentWidth:content.width};
  });
  assert.ok(widths.width<=440.5 && Math.abs(widths.center-widths.viewport)<=1,label+' fits a centered 440px column.');
  assert.ok(Math.abs(widths.headingLeft-widths.contentLeft)<=1 && Math.abs(widths.headingWidth-widths.contentWidth)<=1,
    label+' aligns Back, heading and form to the same column.');
}
async function signOut() {
  await accountEntry(); await page.locator('#account-sign-out').click();
  await view('account/sign-in', {focused:false});
  await idle();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'sign-in-email','Confirmed sign-out focuses the email or username field.');
  assert.equal(await page.locator('#enrollment-begin').isDisabled(), true);
  await settingsAccess(false);
  for (const role of ['requests','operations']) {
    assert.equal(await page.locator('#'+role+'-setup-link').evaluate(element=>element.hidden),true,
      'Signing out removes identity setup prompts until another account is authenticated.');
  }
}
async function fillSignIn(email = EMAIL, password = service.password) {
  await emailEntry(email);
  await page.locator('#sign-in-password').fill(password);
}
async function previewEntryCode({copyChecks=false}={}) {
  assert.equal(await page.locator('#sign-in-email-preview').isVisible(),true);
  if (!await page.locator('#sign-in-email-preview').evaluate(node=>node.open)) await page.locator('#sign-in-email-preview summary').click();
  await page.waitForFunction(()=>document.getElementById('sign-in-preview-code').textContent.length === 8);
  await idle();
  assert.equal(await page.locator('#sign-in-preview-code').textContent(),ENTRY_CODE);
  assert.equal(await page.locator('#sign-in-email-code').inputValue(),'','Opening the preview does not enter or confirm a code.');
  if (copyChecks) {
    await page.locator('#sign-in-preview-copy').click();
    await page.waitForFunction(()=>document.getElementById('sign-in-copy-status').textContent==='Copied.');
    assert.equal(await page.evaluate(()=>window.__copiedEmailCode),ENTRY_CODE);
    assert.equal(await page.locator('#sign-in-email-code').inputValue(),'','Copy never enters or confirms the code.');
    await page.evaluate(()=>{window.__clipboardRefuse=true;}); await page.locator('#sign-in-preview-copy').click();
    await page.waitForFunction(()=>/Copy unavailable/.test(document.getElementById('sign-in-copy-status').textContent));
    assert.equal(await page.locator('#sign-in-copy-fallback').inputValue(),ENTRY_CODE);
    assert.equal(await page.locator('#sign-in-email-code').inputValue(),'');
    await page.evaluate(()=>{window.__clipboardRefuse=false;window.__copiedEmailCode=null;});
  }
  await page.locator('#sign-in-preview-use').click(); await idle();
  assert.equal(await page.locator('#sign-in-email-preview').evaluate(node=>node.open),false);
  assert.equal(await page.locator('#sign-in-email-code').inputValue(),ENTRY_CODE);
}
async function emailEntry(identifier=EMAIL, expected='password', capture=false) {
  if (!await page.locator('#account-email-form').isVisible()) {
    await page.locator('#view-back').click(); await idle();
  }
  if (expected==='enrollment') {
    if (await page.locator('#sign-in-create-account').isVisible()) {
      await page.locator('#sign-in-create-account').click(); await idle();
    }
    assert.deepEqual(await page.locator('#account-email-form label').allTextContents(),['Email']);
    assert.equal(await page.locator('#sign-in-email').getAttribute('type'),'email');
    assert.equal(await page.locator('#sign-in-email').getAttribute('inputmode'),'email');
  }
  const beforeContinuation=service.journal.length;
  const beforeEntry=service.journal.filter(item=>['/v1/accounts/entry/start','/v1/accounts/entry/confirm','/v1/accounts/mock-mail','/dev-oidc/authorize'].includes(item.path)).length;
  await page.locator('#sign-in-email').fill(identifier); await submitForm('account-email-form'); await idle();
  if (expected==='enrollment') {
    await page.locator('#account-email-confirm-form').waitFor({state:'visible'});
    assert.equal(await page.locator('#account-sign-in-form').isVisible(),false,'Explicit signup still requires email ownership proof.');
    assert.equal(await page.locator('#sign-in-recover').isVisible(),false);
    assert.equal((await page.locator('#sign-in-selected-email').textContent()).trim(),identifier);
    assert.equal(await page.locator('#view-title').textContent(),'Confirm email');
    assert.match(await page.locator('#view-description').textContent(),/confirm|code|create.*account/i);
    assert.equal(await page.locator('#sign-in-change-email,#sign-in-test-code').count(),0);
    if (capture) { await layout('320px / 200% signup confirmation code'); await screenshot('email-code-large-text'); }
    await previewEntryCode();
    assert.equal(await page.locator('#account-sign-in-form').isVisible(),false,'Retrieving a mock signup code grants no password authority.');
    await submitForm('account-email-confirm-form'); await view('account/create');
    assert.equal(await page.locator('#account-email').inputValue(),identifier);
    assert.equal(await page.locator('#account-email').evaluate(element=>element.readOnly),true,'The verified signup email stays bound to enrollment.');
  } else {
    await page.locator('#account-sign-in-form').waitFor({state:'visible'});
    assert.equal(service.journal.length,beforeContinuation,'Identifier continuation makes no service request.');
    assert.equal(service.journal.filter(item=>['/v1/accounts/entry/start','/v1/accounts/entry/confirm','/v1/accounts/mock-mail','/dev-oidc/authorize'].includes(item.path)).length,beforeEntry,
      'Continuing a sign-in identifier is local: no account lookup, mail or authorization request.');
    assert.equal(await page.locator('#account-email-form').isVisible(),false);
    assert.equal(await page.locator('#account-email-confirm-form').isVisible(),false);
    assert.equal(await page.locator('#sign-in-email-preview').isVisible(),false);
    assert.equal(await page.locator('#sign-in-recover').isVisible(),true);
    assert.equal((await page.locator('#sign-in-recover').textContent()).trim(),'Forgot password');
    assert.equal(await page.locator('#view-title').textContent(),'Sign in');
    assert.doesNotMatch(await page.locator('#view-description').textContent(),/account found|existing account|code|confirm.*email/i);
    assert.deepEqual(await page.locator('#account-sign-in-form label').allTextContents(),['Password']);
    const normalized=identifier.trim().toLowerCase();
    const shown=normalized.includes('@') && !normalized.startsWith('@') ? normalized : '@'+normalized.replace(/^@/,'');
    assert.equal((await page.locator('#sign-in-selected-email').textContent()).trim(),shown);
    if (capture) { await layout('320px / 200% password'); await screenshot('password-sign-in-large-text'); }
  }
  await retained();
}async function agreeToAccountTerms() {
  const agreed = await page.locator('#account-create-reviewed').isChecked();
  await page.locator('#account-create-reviewed').click(); await view('account/terms');
  assert.equal(await page.locator('#account-create-reviewed').isChecked(),agreed,'Opening review does not itself change consent.');
  await page.waitForFunction(()=>!document.getElementById('account-terms-accept').disabled);
  if (await page.locator('#account-terms-accept').isChecked()) {
    await page.locator('#view-back').click(); await view('account/create');
  } else {
    await page.locator('#account-terms-accept').check(); await view('account/create');
  }
  assert.equal(await page.locator('#account-create-reviewed').isChecked(),true,'Only the end-of-terms agreement enables signup consent.');
}
async function signIn() {
  await accountEntry();
  if (await page.locator('#account-session-entry').isVisible()) { await page.locator('#account-sign-out').click(); await idle(); }
  await signInPage();
  await fillSignIn();
  await submitForm('account-sign-in-form'); await view('home');
  await idle();
  assert.equal(await page.locator('#sign-in-password').inputValue(),'');
  assert.equal(await page.locator('#enrollment-begin').isDisabled(), false);
  await settingsAccess(true);
}
async function ready() {
  await view('account/ready', {focused:false});
  await settingsAccess(false);
  const expected=recoveryBatch(service.recoveryCodes), cells=page.locator('#recovery-code-grid textarea.recovery-code-cell');
  assert.equal(await page.locator('#account-recovery-key,#recovery-code-ack').count(),0);
  assert.equal(await cells.count(),8);
  assert.equal(await cells.evaluateAll(inputs=>inputs.every(input=>input.readOnly && input.hasAttribute('data-secret')
    && (input.labels?.length || input.getAttribute('aria-label')))),true);
  assert.deepEqual(await cells.evaluateAll(inputs=>inputs.map(input=>input.getAttribute('aria-label')
    || [...input.labels].map(label=>label.textContent.trim()).join(' '))),Array.from({length:8},(_,index)=>'Recovery code '+(index+1)));
  assert.equal(await cells.evaluateAll(inputs=>inputs.every(input=>input.value==='')),true,'Codes enter the visible controls only after explicit reveal.');
  assert.equal(await page.locator('#account-ready-sign-in').isDisabled(),false,'Continue needs no saved-code or download acknowledgement.');
  assert.equal(await page.locator('#download-recovery-codes').isDisabled(),false,'Download is available before revealing the codes.');
  assert.doesNotMatch(await page.locator('[data-onboarding-view="account/ready"]').innerText(),/signing in is a separate step/i);
  const exerciseDownload=!recoveryDownloadChecked;
  if (exerciseDownload) {
    await page.evaluate(()=>{window.__refuseRecoveryDownload=true;});
    await page.locator('#download-recovery-codes').click();
    await page.waitForFunction(()=>/unavailable|could not|failed|copy/i.test(document.getElementById('recovery-download-status').textContent));
    assert.doesNotMatch(await page.locator('#recovery-download-status').textContent(),/saved|download started/i);
    assert.equal(await page.locator('#account-ready-sign-in').isDisabled(),false,'A refused download never blocks Continue.');
    await page.evaluate(()=>{window.__refuseRecoveryDownload=false;});
  }
  assert.equal((await page.locator('#show-recovery-code').textContent()).trim(),'Show recovery codes');
  await page.locator('#show-recovery-code').click();
  assert.ok((await cells.evaluateAll(inputs=>inputs.map(input=>input.value))).every((value,index)=>value===expected[index]),
    'The eight raw recovery codes remain independent, in their original order.');
  const grid=await cells.evaluateAll(inputs=>({
    columns:new Set(inputs.map(input=>Math.round(input.getBoundingClientRect().left))).size,
    rows:new Set(inputs.map(input=>Math.round(input.getBoundingClientRect().top))).size}));
  assert.deepEqual(grid,{columns:2,rows:4});
  await page.locator('#show-recovery-code').click();
  assert.ok((await cells.evaluateAll(inputs=>inputs.map(input=>input.value))).every((value,index)=>value===expected[index]),
    'Showing codes again does not consume or regenerate the retained set.');
  if (exerciseDownload) {
    const downloading=page.waitForEvent('download'); await page.locator('#download-recovery-codes').click();
    const download=await downloading; assert.equal(download.suggestedFilename(),'non-verba-recovery-codes.txt');
    assert.equal(await download.failure(),null);
    const stream=await download.createReadStream(); assert.ok(stream); const chunks=[];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const text=Buffer.concat(chunks).toString('utf8'), codes=text.match(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g) || [];
    assert.ok(codes.length===8 && codes.every((code,index)=>code===expected[index]),'The plaintext download contains exactly the eight original raw codes.');
    const rows=Array.from({length:4},(_,index)=>expected[index*2]+'  '+expected[index*2+1]).join('\n');
    assert.ok(text==='Non-verba recovery codes\n\n'+rows+'\n\nKeep these codes private. Each code can be used once.\nA successful recovery replaces this set.\n',
      'The plaintext export keeps the complete two-column, four-row single-use recovery-code format.');
    await download.delete();
    await page.waitForFunction(()=>document.getElementById('recovery-download-status').textContent.trim()==='Download started.');
    assert.doesNotMatch(await page.locator('#recovery-download-status').textContent(),/saved|acknowledged|verified/i);
    assert.equal(await page.locator('#account-ready-sign-in').isDisabled(),false);
    await page.waitForFunction(()=>window.__captureURLs.size===0);
    const viewport=page.viewportSize(); await page.setViewportSize({width:711,height:871});
    try {
      await page.evaluate(()=>{window.scrollTo(0,0);return new Promise(resolve=>requestAnimationFrame(resolve));});
      await page.screenshot({path:output+'/recovery-codes-grid.png',fullPage:true,
        mask:[page.locator('[data-secret]:not(.recovery-code-cell),input[type="password"],.code-slots,#sign-in-preview-code')]});
      screenshots.push('recovery-codes-grid.png');
    } finally { if (viewport) await page.setViewportSize(viewport); }
    recoveryDownloadChecked=true;
  }
  await page.locator('#account-ready-sign-in').click(); await view('account/sign-in');
  assert.equal(await cells.evaluateAll(inputs=>inputs.every(input=>input.value==='')),true,'Leaving Ready clears every revealed recovery code.');
  if (exerciseDownload) {
    await page.goBack(); await idle();
    assert.equal(await cells.evaluateAll(inputs=>inputs.every(input=>input.value==='')),true,'History cannot restore a cleared recovery-code set.');
    if (await current()==='account/ready') assert.equal(await page.locator('#show-recovery-code').isDisabled(),true);
    await page.goForward(); await view('account/sign-in');
  }
  await retained();
}
async function useMockMail(target, deliberate) {
  const before = service.journal.filter(item=>item.path==='/v1/accounts/mock-mail').length;
  await page.locator('#account-mock-email').click(); await idle();
  await page.locator('#mock-mailbox').waitFor({state:'visible'});
  assert.equal(await page.locator('#mock-confirmation-code').evaluate(input=>input.readOnly),true);
  assert.equal(await page.locator('#mock-confirmation-code').inputValue(),CODE);
  assert.equal(await page.locator(target).inputValue(),'','Opening mock mail does not silently fill the actual confirmation input.');
  assert.equal(await page.locator(deliberate).isChecked(),false,'Mock mail does not confirm the account or recovery itself.');
  await page.locator('#mock-use-code').click(); await idle();
  assert.equal(await page.locator(target).inputValue(),CODE);
  assert.equal(await page.locator(deliberate).isChecked(),false,'Using a mock code still needs separate deliberate confirmation.');
  assert.equal(service.journal.filter(item=>item.path==='/v1/accounts/mock-mail').length,before+1);
  await retained();
}
async function deletionEntry() {
  await accountEntry(); await page.locator('#account-delete-link').click();
  await view('account/delete');
  assert.equal(await page.locator('#delete-password').inputValue(),'');
  assert.equal(await page.locator('#delete-deliberate').isChecked(),false);
  assert.equal(await page.locator('#account-delete-submit').isDisabled(),true);
}
async function deletionFields(email = EMAIL, password = service.password) {
  await page.locator('#delete-confirm-email').fill(email); await page.locator('#delete-password').fill(password);
  await page.locator('#delete-deliberate').check();
}
async function recreateDeletedAccount(previous) {
  await page.locator('#account-deleted').waitFor({state:'visible'});
  assert.equal(await page.locator('#enrollment-begin').isDisabled(),true,'A deletion receipt cannot restore a signed-in session.');
  await settingsAccess(false);
  await page.locator('#account-deleted [data-navigate="account/create"]').click(); await view('account/sign-in');
  const before = service.journal.filter(item=>item.path === '/dev-oidc/authorize').length;
  await emailEntry(EMAIL,'enrollment');
  assert.equal(service.journal.filter(item=>item.path === '/dev-oidc/authorize').length,before,
    'The deleted contact routes to new enrollment without offering credentials for its old account.');
  await page.locator('#account-username').fill('fresh_'+service.identity.account_id.replace(/[^a-z0-9]/g,'').slice(-16));
  assert.equal(await page.locator('#account-email').inputValue(),EMAIL); await page.locator('#account-password').fill(PASSWORD);
  await agreeToAccountTerms(); await submitForm('account-create-form'); await view('account/confirm');
  await useMockMail('#account-confirm-code','#account-confirm-deliberate');
  await page.locator('#account-confirm-deliberate').check(); await submitForm('account-confirm-form'); await ready();
  assert.notEqual(service.identity.account_id,previous.account_id,'The reused email receives a new account identity.');
  assert.notEqual(service.identity.principal_id,previous.principal_id,'The reused email cannot resurrect the deleted principal.');
  await fillSignIn(); await submitForm('account-sign-in-form'); await view('home'); await idle();
  assert.equal(await page.locator('#enrollment-begin').isDisabled(),false);
  await settingsAccess(true);
  await retained();
}
async function begin(role = 'operator') {
  await gateway(); await page.locator('#enrollment-role').selectOption(role);
  await page.locator('#enrollment-begin').click();
  await page.waitForFunction(() => ['identity/document','identity/review','identity/status'].includes(history.state?.view));
  await view(await current());
}
async function guidance() {
  const directions = ['up','down','left','right','front'];
  const selectedURLs = await page.evaluate(() => window.__captureURLs.size);
  for (const direction of directions) {
    assert.equal(await page.locator('#face-guide').getAttribute('data-direction'), direction);
    assert.equal(await page.locator('#camera-shutter').isDisabled(), true,
      'No frontal still is accepted before the deliberate guidance sequence finishes.');
    await page.locator('#guidance-next').click(); await idle();
    assert.equal(await page.locator('#selected-face').getAttribute('src'),null);
    assert.equal(await page.evaluate(() => window.__captureURLs.size),selectedURLs,
      'Guidance advances without retaining movement frames.');
  }
  assert.equal(await page.locator('#guidance-next').isDisabled(),true);
  assert.equal(await page.locator('#face-guide').getAttribute('data-direction'),'front');
  assert.match(await page.locator('#guidance-position').innerText(),/guidance complete.*movement and liveness not checked/i);
  assert.match(await page.locator('[data-onboarding-view="identity/face"]').innerText(),/movement and liveness are not checked/i);
}
async function cameraStopped({released = false} = {}) {
  await page.waitForFunction(() => window.__captureTracks.every(track => track.readyState === 'ended')
    && document.getElementById('enrollment-video').srcObject === null);
  assert.equal(await page.locator('#camera-stage').isVisible(),false);
  if (released) assert.equal(await page.evaluate(() => window.__captureURLs.size),0,
    'Every selected or decoder-owned object URL is revoked after discard.');
}
async function startCamera(kind) {
  await page.locator(kind === 'document_front' ? '#document-camera-start' : '#face-camera-start').click();
  await page.locator('#camera-stage').waitFor({state:'visible'});
  await page.waitForFunction(() => {
    const video = document.getElementById('enrollment-video');
    return video.videoWidth >= 160 && video.videoHeight >= 160 && video.readyState >= 2;
  });
  await idle();
  assert.equal(await page.locator('#camera-stage').getAttribute('data-kind'),kind);
  assert.equal(await page.evaluate(() => window.__captureTracks.filter(track=>track.readyState==='live').length),1);
}
async function takePhoto(kind) {
  await page.waitForFunction(() => !document.getElementById('camera-shutter').disabled);
  await page.locator('#camera-shutter').click();
  const id = kind === 'document_front' ? '#selected-document' : '#selected-face';
  await page.waitForFunction(selector => {
    const image = document.querySelector(selector);
    return image.complete && image.naturalWidth > 0 && image.getAttribute('src')?.startsWith('blob:');
  },id);
  await idle(); await cameraStopped();
  assert.match(await page.locator(id).getAttribute('src'),/^blob:/);
  const dimensions = await page.locator(id).evaluate(image=>({width:image.naturalWidth,height:image.naturalHeight}));
  assert.ok(Math.max(dimensions.width, dimensions.height) <= (kind === 'document_front' ? 1600 : 960));
  await retained();
}
async function capturePair({skip = false} = {}) {
  await view('identity/document',{focused:false});
  await page.locator('#enrollment-processing').check(); await idle();
  await startCamera('document_front'); await takePhoto('document_front');
  await page.locator('#document-next').click(); await view('identity/face');
  await startCamera('face_front');
  if (skip) { await page.locator('#guidance-skip').click(); await idle(); }
  else await guidance();
  await takePhoto('face_front');
  await page.locator('#face-next').click(); await view('identity/review');
}
async function reviewAndFinish() {
  await page.locator('#enrollment-review').click(); await idle();
  await page.waitForFunction(() => !document.getElementById('enrollment-finish').disabled);
  await page.locator('#enrollment-finish').click(); await view('identity/status');
  await workspaceLocked('Reviewed local document and face photos');
}
async function lateCameraBack() {
  await begin('operator'); await view('identity/document');
  await page.locator('#enrollment-processing').check(); await idle();
  await page.evaluate(() => { window.__delayNextCapture = true; });
  await page.locator('#document-camera-start').click();
  await page.waitForFunction(() => window.__cameraPermissionPending === true);
  try { await page.goBack(); await page.waitForFunction(() => history.state?.view === 'identity/setup'); }
  finally { await page.evaluate(() => window.__releaseCameraPermission?.()); }
  await view('identity/setup',{focused:false}); await cameraStopped();
  assert.equal(await current(),'identity/setup','A late permission result must not navigate over Back.');
  assert.equal(await page.locator('#selected-document').getAttribute('src'),null);
  assert.equal(await page.locator('#onboarding-message').isVisible(),false,
    'A cancelled camera result must not replace focus with an old error.');
  await stableUrl();
}

try {
  context = await browser.newContext({viewport:{width:390, height:844}, reducedMotion:'reduce', permissions:['camera']});
  await context.addInitScript(() => {
    window.__onboardingForbidden = [];
    window.__copiedEmailCode = null; window.__clipboardRefuse = false; window.__clipboardGate = false;
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{
      if (window.__clipboardRefuse) throw new DOMException('Synthetic clipboard refusal','NotAllowedError');
      if (window.__clipboardGate) await new Promise(resolve=>{window.__releaseClipboard=resolve;});
      window.__copiedEmailCode = value;
    }}});
    const note = name => window.__onboardingForbidden.push(name);
    const fetch = window.fetch.bind(window);
    window.fetch = (...args) => {
      const target = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.href);
      const method = args[1]?.method || args[0]?.method || 'GET';
      if (target.origin !== location.origin || target.search || target.hash
        || !(method === 'GET' && target.pathname === '/account-api/config'
          || method === 'POST' && target.pathname === '/account-api/transport')) note('fetch');
      return fetch(...args);
    };
    const xhr = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (...args) { note('XMLHttpRequest'); return xhr.apply(this, args); };
    const openDatabase = indexedDB.open.bind(indexedDB);
    window.__browserKeyStoreOpens = [];
    indexedDB.open = (...args) => {
      if (args.length !== 2 || args[0] !== 'nonverba-device-attestation-v1' || args[1] !== 1) note('indexedDB.open');
      else window.__browserKeyStoreOpens.push(args[0]);
      return openDatabase(...args);
    };
    if (navigator.sendBeacon) {
      const beacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = (...args) => { note('sendBeacon'); return beacon(...args); };
    }
    for (const name of ['WebSocket','EventSource']) {
      const Original = window[name];
      window[name] = new Proxy(Original, {construct(target,args) { note(name); return Reflect.construct(target,args); }});
    }
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (...args) { note('Storage.setItem'); return setItem.apply(this,args); };
    window.__captureTracks = [];
    window.__captureRequests = [];
    window.__captureURLs = new Set();
    const createObjectURL = URL.createObjectURL.bind(URL), revokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      if (window.__refuseRecoveryDownload && blob.type.startsWith('text/plain')) throw new DOMException('Synthetic download refusal','NotAllowedError');
      const url=createObjectURL(blob); window.__captureURLs.add(url); return url;
    };
    URL.revokeObjectURL = url => { window.__captureURLs.delete(url); return revokeObjectURL(url); };
    if (navigator.mediaDevices?.getUserMedia) {
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        if (constraints?.audio !== false || !constraints.video || Object.keys(constraints).some(key=>!['audio','video'].includes(key))) note('non-camera capture');
        window.__captureRequests.push({audio:constraints?.audio,facing:constraints?.video?.facingMode?.ideal});
        const stream = await getUserMedia(constraints);
        window.__captureTracks.push(...stream.getTracks());
        if (window.__delayNextCapture) {
          window.__delayNextCapture = false; window.__cameraPermissionPending = true;
          await new Promise(resolve => { window.__releaseCameraPermission = resolve; });
          window.__cameraPermissionPending = false; delete window.__releaseCameraPermission;
        }
        return stream;
      };
    }
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.protocol === 'blob:') { await route.continue(); return; }
    if (url.origin === origin && !url.search && !url.hash && url.pathname === '/account-api/config' && request.method() === 'GET') {
      await route.fulfill({json:{enabled:service.enabled,development_only:true},headers:{'Cache-Control':'no-store'}}); return;
    }
    if (url.origin === origin && !url.search && !url.hash && url.pathname === '/account-api/transport' && request.method() === 'POST') {
      try {
        const envelope = request.postDataJSON();
        assert.ok(typeof envelope.id === 'string' && envelope.request, 'Relay correlates its structured request.');
        const response = await service.request(envelope.request);
        await route.fulfill({json:{id:envelope.id,response},headers:{'Cache-Control':'no-store'}}).catch(error => {
          if (!request.failure()?.errorText.includes('ERR_ABORTED')) throw error;
        });
      } catch (error) {
        unexpected.push('Account fixture: '+error.message);
        await route.fulfill({status:500,json:{error:'fixture_protocol_failure'}}).catch(() => {});
      }
      return;
    }
    const key = url.pathname.replace(/^\/assets\//, '');
    if (url.origin !== origin || url.search || url.hash || request.method() !== 'GET' || !assets.has(key)) {
      unexpected.push(url.origin+url.pathname); await route.abort(); return;
    }
    const contentType = key.endsWith('.html') ? 'text/html' : key.endsWith('.js') ? 'text/javascript'
      : key.endsWith('.css') ? 'text/css' : key.endsWith('.webp') ? 'image/webp' : 'image/svg+xml';
    await route.fulfill({body:assets.get(key),contentType,headers:{'Cache-Control':'no-store',
      'Permissions-Policy':'camera=(self), microphone=(), geolocation=()'}});
  });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  service.enabled = false;
  await page.goto(entry); await view('home', {focused:false});

  await check('unavailable relay and account-first history guards never mint an account or identity authority', async () => {
    const shellBytes = Object.keys(PARTICIPANT_SHELL_SOURCES).reduce((sum,key) => sum + assets.get(key).length,0);
    assert.ok(shellBytes <= PARTICIPANT_SHELL_BUDGET);
    await accountEntry(); await signInPage();
    assert.equal(await page.locator('#account-email-submit').isDisabled(),false,'A sign-in identifier can continue locally while the relay is unavailable.');
    assert.equal(await page.locator('#sign-in-service-status').isVisible(),true);
    assert.equal(await page.locator('#sign-in-service-status').getAttribute('role'),'status');
    await emailEntry();
    assert.equal(await page.locator('#account-sign-in-submit').isDisabled(),true,'Authentication still requires the unavailable service.');
    await page.locator('#view-back').click(); await idle(); await signInPage();
    await gateway(); await idle();
    await settingsAccess(false);
    assert.equal(await page.locator('#enrollment-begin').isDisabled(),true);
    for (const role of ['requests','operations']) {
      assert.equal(await page.locator('#'+role+'-setup-link').evaluate(element=>element.hidden),true);
      assert.equal(await page.locator('[data-status-source="identity-'+role+'"] [data-status-kind="warning"]').count(),0,
        'Identity setup warnings require an authenticated account.');
    }
    await page.waitForFunction(() => /unavailable|not connected|not configured/i.test(document.getElementById('account-service-status').textContent));
    assert.equal(service.journal.every(item=>item.method === 'GET'
      && ['/dev-oidc/.well-known/openid-configuration','/readyz'].includes(item.path)),true,
    'An unavailable relay may check public readiness, but cannot issue credential or private-account requests.');
    for (const target of ['identity/document','identity/face','identity/review','identity/status']) {
      await page.evaluate(next => {
        const index = history.state.index;
        history.pushState({nonverbaPreview:true,index:index+1,view:next},'',location.pathname);
        history.pushState({nonverbaPreview:true,index:index+2,view:'identity/setup'},'',location.pathname);
      },target);
      await page.goBack(); await view('identity/setup',{focused:false});
      assert.equal(await page.locator('#enrollment-begin').isDisabled(),true);
    }
    assert.deepEqual(await retained(),[]); await layout('unavailable account gateway');
    service.enabled = true;
    await page.reload(); await view('home',{focused:false}); await accountEntry();
    await page.waitForFunction(() => document.getElementById('sign-in-service-status').hidden);
    await signInPage(); assert.equal(await page.locator('#sign-in-service-status').isVisible(),false);
    await page.setViewportSize({width:711,height:871}); await compactCentered('Sign in');
    await screenshot('email-first-sign-in-ready');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('#enrollment-begin').isDisabled(),true);
  });

  await check('explicit signup requires a confirmed email code and binds the owned contact to deliberate enrollment', async () => {
    const starts = () => service.journal.filter(item=>item.path === '/v1/accounts/entry/start').length;
    const authorizations = () => service.journal.filter(item=>item.path === '/dev-oidc/authorize').length;
    const before = starts(), beforeAuth = authorizations();
    await page.locator('#sign-in-email').fill('not-an-email'); await submitForm('account-email-form');
    await alertShown(/valid email or username/i); assert.equal(starts(),before,'An invalid selector stops before a server challenge.');
    await page.locator('#sign-in-create-account').click(); await idle();
    assert.equal(await page.locator('#view-title').textContent(),'Create account');
    assert.equal(starts(),before,'Choosing explicit signup does not send a code before an email is submitted.');
    assert.deepEqual(await page.locator('#account-email-form label').allTextContents(),['Email']);
    await page.locator('#sign-in-email').fill(EMAIL); await submitForm('account-email-form'); await idle();
    await page.locator('#account-email-confirm-form').waitFor({state:'visible'});
    assert.equal(await page.locator('#account-sign-in-form').isVisible(),false);
    assert.equal(await page.locator('#sign-in-recover').isVisible(),false);
    assert.equal((await page.locator('#sign-in-selected-email').textContent()).trim(),EMAIL);
    assert.equal(await page.locator('#view-title').textContent(),'Confirm email');
    assert.match(await page.locator('#view-description').textContent(),/confirm your email/i);
    assert.equal(await page.locator('#sign-in-code-entry input').count(),1,'One accessible input supports paste and password-manager codes.');
    assert.equal(await page.locator('.code-slots > span').count(),8);
    assert.equal(await page.locator('#sign-in-email-code').getAttribute('autocomplete'),'one-time-code');
    await page.locator('#sign-in-email-code').fill('ab12zz');
    assert.equal(await page.locator('#sign-in-email-code').inputValue(),'AB12');
    assert.equal((await page.locator('.code-slots > span').allTextContents()).join(''),'AB12');
    assert.equal(await page.locator('#account-email-confirm-submit').isDisabled(),true);
    await page.evaluate(() => {
      const data = new DataTransfer(); data.setData('text/plain','a1 b2-c3 d4');
      document.getElementById('sign-in-email-code').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
    });
    assert.equal(await page.locator('#sign-in-email-code').inputValue(),ENTRY_CODE,'Formatted paste fills all eight hex slots.');
    await page.locator('#sign-in-email-code').press('End'); await page.keyboard.press('Backspace');
    assert.equal(await page.locator('#sign-in-email-code').inputValue(),ENTRY_CODE.slice(0,-1));
    assert.equal(await page.locator('#account-email-confirm-submit').isDisabled(),true);
    await page.locator('#sign-in-email-code').fill('');
    await page.setViewportSize({width:711,height:871}); await compactCentered('Confirm email');
    await layout('hex code input'); await screenshot('confirm-email-code');
    await page.setViewportSize({width:390,height:844});
    await page.locator('#sign-in-email-code').fill('DEADBEEF');
    await submitForm('account-email-confirm-form'); await alertShown(/code|confirm|continue/i);
    assert.equal(await page.locator('#account-email-confirm-form').isVisible(),true,'An invalid code cannot choose an account branch.');
    assert.equal(await page.locator('#sign-in-email-code').inputValue(),'','Failed proof clears the code control.');
    assert.equal(authorizations(),beforeAuth,'No password authorization runs before the email proof.');
    await previewEntryCode({copyChecks:true});
    assert.equal(await page.locator('#account-email-confirm-form').isVisible(),true);
    assert.equal(await page.locator('#sign-in-email-code').inputValue(),ENTRY_CODE);
    await submitForm('account-email-confirm-form'); await view('account/create');
    assert.equal(await page.locator('#account-email').inputValue(),EMAIL);
    assert.equal(await page.locator('#account-email').evaluate(element=>element.readOnly),true);
    assert.equal(await page.locator('#account-create-reviewed').isChecked(),false);
    assert.equal(service.journal.some(item=>item.path === '/v1/accounts/enrollments'),false,'Selecting a new branch does not create an account.');
    assert.equal(authorizations(),beforeAuth);
    const previousProof=service.entryStarts.at(-1), beforeHistoryService=service.journal.length;
    await retained(); await page.goBack(); await view('account/sign-in',{focused:false});
    assert.equal(await page.locator('#view-title').textContent(),'Create account','Back restores the explicit signup email step across the route change.');
    assert.deepEqual(await page.locator('#account-email-form label').allTextContents(),['Email']);
    assert.equal(await page.locator('#sign-in-email').getAttribute('type'),'email');
    assert.equal(await page.locator('#account-email-form').isVisible(),true);
    assert.equal(await page.locator('#account-email-confirm-form').isVisible(),false);
    assert.equal(await page.locator('#account-sign-in-form').isVisible(),false);
    assert.equal(await page.locator('#sign-in-email-preview').isVisible(),false);
    assert.equal(await page.locator('#sign-in-email-code').inputValue(),'');
    assert.equal(await page.locator('#account-email').inputValue(),'','Leaving the signup form clears its bound email proof.');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'sign-in-email','The restored signup step focuses its email input.');
    assert.equal(service.journal.length,beforeHistoryService,'Back does not send mail or restart an account operation.');
    await page.goForward(); await view('account/sign-in',{focused:false}); await signInPage();
    assert.equal(await page.locator('[data-onboarding-view="account/create"]').isVisible(),false,'Forward cannot revive enrollment with the discarded proof.');
    assert.equal(await page.locator('#account-email').inputValue(),'');
    assert.equal(service.journal.length,beforeHistoryService,'Forward grants no new proof or service mutation.');
    await page.locator('#sign-in-create-account').click(); await idle();
    await page.locator('#sign-in-email').fill(EMAIL); await submitForm('account-email-form'); await idle();
    const restartedProof=service.entryStarts.at(-1);
    assert.notEqual(restartedProof.operation_id,previousProof.operation_id,'Restarted signup creates a fresh private email-proof operation.');
    assert.notEqual(restartedProof.operation_secret,previousProof.operation_secret);
    assert.equal(await page.locator('#sign-in-email-code').inputValue(),'','The fresh challenge requires a newly entered code.');
    await previewEntryCode();
    service.mode = 'entry-expired'; await submitForm('account-email-confirm-form'); await alertShown(/code|confirm|continue/i);
    assert.equal(await page.locator('#account-sign-in-form').isVisible(),false);
    assert.equal(await page.locator('#sign-in-recover').isVisible(),false,'Expired email proof never enables recovery.');
    await page.locator('#view-back').click(); await idle(); await initialSignInPage();
    assert.equal(await page.locator('#sign-in-email-code').inputValue(),'');
    assert.equal(await page.locator('#sign-in-password').inputValue(),'');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'sign-in-email');
    service.mode = 'normal';
    await page.locator('#sign-in-create-account').click(); await idle();
    await page.locator('#sign-in-email').fill(EMAIL); await submitForm('account-email-form'); await idle();
    await previewEntryCode();
    const delayed = service.delay('/v1/accounts/entry/confirm');
    try {
      await submitForm('account-email-confirm-form'); await delayed.entered;
      await page.goBack(); await idle(); await initialSignInPage();
      assert.equal(await page.evaluate(()=>document.activeElement.id),'sign-in-email');
      const maximumBacks=await page.evaluate(()=>history.state.index), beforeBackRequests=service.journal.length;
      assert.ok(Number.isSafeInteger(maximumBacks) && maximumBacks>0,'The cancellation exit has bounded local history to traverse.');
      for (let attempt=0;attempt<maximumBacks && await current()!=='home';attempt++) {
        const previousIndex=await page.evaluate(()=>history.state.index);
        await page.goBack();
        await page.waitForFunction(previous=>history.state.index<previous,previousIndex);
        await idle();
        const nextIndex=await page.evaluate(()=>history.state.index);
        assert.ok(Number.isSafeInteger(nextIndex) && nextIndex>=0 && nextIndex<previousIndex,'Each observed Back step decreases the local history index.');
        assert.equal(service.journal.length,beforeBackRequests,'Back never replays signup, mail or other service requests.');
      }
      assert.equal(await current(),'home','The bounded cancellation exit reaches Home.'); await view('home',{focused:false});
    } finally { delayed.release(); }
    await idle();
    assert.equal(await current(),'home','Late entry confirmation cannot replace navigation or restore its chosen branch.');
    await accountEntry(); await signInPage(); await retained();
  });

  await check('Back clears copy feedback and fences a delayed clipboard result from the previous email step', async () => {
    await page.locator('#sign-in-create-account').click(); await idle();
    await page.locator('#sign-in-email').fill(EMAIL); await submitForm('account-email-form'); await idle();
    await page.locator('#sign-in-email-preview summary').click();
    await page.waitForFunction(()=>document.getElementById('sign-in-preview-code').textContent.length===8);
    await page.evaluate(()=>{window.__clipboardGate=true;}); await page.locator('#sign-in-preview-copy').click();
    await page.waitForFunction(()=>typeof window.__releaseClipboard==='function');
    await page.locator('#view-back').click(); await idle(); await initialSignInPage();
    await page.evaluate(()=>{window.__clipboardGate=false;window.__releaseClipboard();delete window.__releaseClipboard;});
    await idle();
    assert.equal(await page.locator('#sign-in-copy-status').evaluate(element=>element.hidden),true);
    assert.equal(await page.locator('#sign-in-copy-fallback').inputValue(),'');
    assert.equal(await page.locator('#sign-in-preview-code').textContent(),'');
    assert.equal(await page.locator('#sign-in-email-code').inputValue(),'');
    assert.equal(await current(),'account/sign-in'); await retained();
    await page.evaluate(()=>{window.__copiedEmailCode=null;});
  });

  await check('reviewed enrollment, deliberate mock mail confirmation and eight-code display/export precede PKCE sign-in', async () => {
    await emailEntry(EMAIL,'enrollment');
    await page.waitForFunction(()=>!document.getElementById('account-create-reviewed').disabled);
    assert.equal(await page.locator('#account-create-submit').isDisabled(),false,'A ready signup form keeps Create account clickable for clear validation.');
    assert.equal(await page.locator('#account-role-requester,#account-role-operator,.account-roles,#account-display-name').count(),0);
    assert.deepEqual(await page.locator('#account-create-form > .field input').evaluateAll(inputs=>inputs.map(input=>input.id)),
      ['account-email','account-username','account-password'],'The confirmed email precedes the editable account details.');
    const emailPresentation = await page.locator('#account-email').evaluate(input=>({
      readonly:input.readOnly,disabled:input.disabled,background:getComputedStyle(input).backgroundColor,
      editableBackground:getComputedStyle(document.getElementById('account-username')).backgroundColor,
      selectable:getComputedStyle(input).userSelect!=='none'}));
    assert.equal(emailPresentation.readonly,true); assert.equal(emailPresentation.disabled,false);
    assert.equal(emailPresentation.selectable,true);
    assert.notEqual(emailPresentation.background,emailPresentation.editableBackground,'Confirmed email has a muted background distinct from editable fields.');
    assert.equal((await page.locator('label[for="account-username"]').textContent()).trim(),'Username');
    const username = page.locator('#account-username'), usernamePrefix = page.locator('#account-username-prefix');
    assert.equal(await usernamePrefix.count(),1); assert.equal(await usernamePrefix.isVisible(),true);
    assert.equal(await usernamePrefix.textContent(),'@');
    await username.fill(''); await username.focus(); await page.keyboard.type('@browser_fixture');
    assert.equal(await username.inputValue(),'browser_fixture','Typing a leading @ keeps one fixed prefix and a bare username.');
    await username.evaluate(input=>{
      input.value='@pasted_fixture'; input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste',data:'@pasted_fixture'}));
    });
    assert.equal(await username.inputValue(),'pasted_fixture','Pasted leading @ is stripped from the editable value.');
    await username.press('Home'); await username.press('Backspace');
    assert.equal(await username.inputValue(),'pasted_fixture'); assert.equal(await usernamePrefix.textContent(),'@');
    await username.press('Control+A'); await username.press('Backspace');
    assert.equal(await username.inputValue(),''); assert.equal(await usernamePrefix.isVisible(),true,'Editing cannot delete the visible prefix.');
    await username.fill('alice'); await username.press('Home'); await page.keyboard.type('@b');
    assert.equal(await username.inputValue(),'balice','Removing an optional leading @ preserves the caret while editing an existing username.');
    await username.fill('@browser_fixture'); assert.equal(await username.inputValue(),'browser_fixture');
    await page.locator('#account-email').focus(); await page.keyboard.press('Control+A'); await page.keyboard.type(CONFIGURED_EMAIL);
    assert.equal(await page.locator('#account-email').inputValue(),EMAIL,'A confirmed email cannot be edited during signup.');
    await page.locator('#account-password').fill(PASSWORD);
    const beforeReview = service.journal.filter(item=>item.path==='/v1/accounts/enrollments').length;
    for (const activation of ['click','Space','label','submit']) {
      if (activation === 'click') await page.locator('#account-create-reviewed').click();
      else if (activation === 'label') await page.locator('#account-terms-label').click();
      else if (activation === 'submit') await page.locator('#account-create-submit').click();
      else { await page.locator('#account-create-reviewed').focus(); await page.keyboard.press('Space'); }
      await view('account/terms');
      assert.equal(await page.locator('#account-create-reviewed').isChecked(),false,activation+' opens review without consent.');
      assert.equal(await page.locator('#account-terms-accept').isChecked(),false);
      await page.locator('#view-back').click(); await view('account/create');
      assert.equal(await page.locator('#account-create-reviewed').isChecked(),false,'Back without end-of-terms agreement remains unchecked.');
      assert.equal(await username.inputValue(),'browser_fixture');
      assert.equal(await page.locator('#account-password').inputValue(),PASSWORD);
      assert.equal(await page.locator('#account-email').inputValue(),EMAIL);
      assert.equal(service.journal.filter(item=>item.path==='/v1/accounts/enrollments').length,beforeReview);
    }
    assert.equal(await page.locator('#account-password-strength,#account-terms-version').count(),0,
      'Signup omits a visible strength label and standalone terms version.');
    assert.equal(await page.locator('#account-password-hint').getAttribute('aria-live'),'polite','Specific password guidance is announced accessibly.');
    const strengthColors = new Set();
    assert.equal([...PASSWORD].length,8,'The full signup and sign-in journey exercises the new eight-character minimum.');
    assert.equal([...NEW_PASSWORD].length,8,'The recovery journey also sets and signs in with an eight-character password.');
    let lengthHint = '';
    const passwords = [['moss7!Q',1,/(?:8|eight).*characters|longer/i],['深林渡月秋水山',1,/(?:8|eight).*characters|longer/i],
      ['🦊🌿',1,/(?:8|eight).*characters|longer/i],['深林渡月秋水山光',2],[PASSWORD,2],
      ['Password1234567890!',1,/common|easily guessed/i],['abcdefghijklmnop',1,/sequence|sequential|keyboard/i],
      ['xyxyxyxy',1,/repeat/i],['browser_fixture1234',1,/username|account (?:details|information)/i],
      ['participant12345678',1,/email|account (?:details|information)/i],
      ['violet meadow 83',2],['violet meadow 837 sun',3],
      ['violet meadow 837 sunlight',4],['violet meadow 837 sunlight river stone',5]];
    for (const [index,[password,level,hint]] of passwords.entries()) {
      await page.locator('#account-password').fill(password);
      assert.equal(await page.locator('#account-password-meter').getAttribute('aria-valuenow'),String(level));
      assert.equal(await page.locator('#account-password-meter > span').count(),5);
      assert.equal(await page.locator('#account-password-meter > span[data-filled]').count(),level);
      assert.match(await page.locator('#account-password-meter').getAttribute('aria-valuetext'),new RegExp('level '+level+' of 5','i'));
      strengthColors.add(await page.locator('#account-password-meter > span[data-filled]').first()
        .evaluate(element=>getComputedStyle(element).backgroundColor));
      if (index === 0) await agreeToAccountTerms();
      assert.equal(await page.locator('#account-create-reviewed').isChecked(),true,'Password edits retain agreement to the same terms.');
      assert.equal(await page.locator('#account-create-submit').isDisabled(),false);
      if (level < 2) {
        assert.equal(await page.locator('#account-password-hint').isVisible(),true);
        const guidance = await page.locator('#account-password-hint').textContent();
        assert.match(guidance,hint);
        if (index === 0) lengthHint = guidance;
        if ([...password].length>=8) assert.notEqual(guidance,lengthHint,'Beyond-minimum weakness needs guidance about the actual reason.');
        await page.locator('#account-create-submit').click(); await idle();
        assert.equal(await current(),'account/create');
        assert.equal(await page.locator('#account-password').getAttribute('aria-invalid'),'true');
        assert.match(await page.locator('#account-password-hint').textContent(),hint,'Create account preserves the specific password guidance.');
        assert.equal(await page.evaluate(()=>document.activeElement.id),'account-password');
        assert.equal(await page.locator('#account-password').inputValue(),password,'Preflight password feedback preserves the entered draft.');
        assert.equal(await page.locator('#account-create-reviewed').isChecked(),true);
        assert.equal(service.journal.filter(item=>item.path==='/v1/accounts/enrollments').length,beforeReview,'Rejected password policy never submits enrollment.');
      }
    }
    assert.equal(strengthColors.size,5,'Each strength level uses a distinct filled-bar color.');
    await page.locator('#account-password').fill(PASSWORD);
    assert.doesNotMatch(await page.locator('#account-create-form').innerText(),/bytes|I want to|Post requests|Accept operations/);
    assert.equal(await page.locator('#account-create-reviewed').isChecked(),true,'Returning to a valid password retains accepted terms.');
    await page.locator('#account-terms-link').click(); await view('account/terms');
    await page.locator('#account-terms-accept').uncheck();
    await page.locator('#view-back').click(); await view('account/create');
    assert.equal(await page.locator('#account-create-reviewed').isChecked(),false);
    assert.equal(await page.locator('#account-terms-status').isVisible(),false,'Loaded terms need no extra signup status text.');
    assert.equal((await page.locator('#account-terms-link').textContent()).trim(),'account terms');
    await page.locator('#account-terms-link').click(); await view('account/terms');
    assert.equal((await page.locator('#account-terms-document-version').textContent()).trim(),'Draft · Version '+ACCOUNT_TERMS.version);
    assert.deepEqual(await page.locator('#account-terms-document section h2').allTextContents(),ACCOUNT_TERMS.sections.map(section=>section.title));
    assert.deepEqual(await page.locator('#account-terms-document section p').allTextContents(),ACCOUNT_TERMS.sections.flatMap(section=>section.paragraphs));
    assert.equal(await page.locator('#account-create-reviewed').isChecked(),false,'Clicking the inline terms link does not accept terms.');
    const termsAccept = page.locator('#account-terms-accept');
    assert.equal(await termsAccept.isEnabled(),true); assert.equal(await termsAccept.isChecked(),false);
    assert.equal(await termsAccept.evaluate(input=>input.labels?.length>0),true);
    assert.equal((await termsAccept.evaluate(input=>[...input.labels].map(label=>label.textContent).join(' ').trim())),
      'I agree to the account terms.');
    assert.equal(await termsAccept.evaluate(input=>Boolean(document.querySelector('#account-terms-document section:last-child p:last-child')
      .compareDocumentPosition(input)&Node.DOCUMENT_POSITION_FOLLOWING)),true,'Agreement follows the entire terms document.');
    await page.locator('#view-title').focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'account-terms-accept','The full-terms agreement is keyboard reachable.');
    await page.locator('#view-back').click(); await view('account/create');
    assert.equal(await page.locator('#account-create-reviewed').isChecked(),false,'Back without checking does not accept the terms.');
    assert.equal(await page.locator('#account-username').inputValue(),'browser_fixture');
    assert.equal(await page.locator('#account-password').inputValue(),PASSWORD,'Reading terms preserves only this in-memory signup draft.');
    assert.equal(await page.locator('#account-email').inputValue(),EMAIL);
    await page.locator('#account-terms-link').click(); await view('account/terms');
    await page.locator('#view-title').focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'account-terms-accept');
    await page.keyboard.press('Space'); await view('account/create');
    assert.equal(await page.locator('#account-create-reviewed').isChecked(),true,'Explicit agreement returns to signup and synchronizes consent.');
    assert.equal(await page.locator('#account-username').inputValue(),'browser_fixture');
    assert.equal(await page.locator('#account-password').inputValue(),PASSWORD);
    assert.equal(await page.locator('#account-email').inputValue(),EMAIL);
    await page.locator('#account-create-reviewed').click(); await view('account/terms');
    assert.equal(await termsAccept.isChecked(),true,'Previously accepted main consent reopens the checked end agreement.');
    assert.equal(await page.locator('#account-create-reviewed').isChecked(),true,'Opening the inline terms link does not toggle existing consent.');
    await page.locator('#view-title').focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Space');
    await idle(); assert.equal(await current(),'account/terms','Withdrawing agreement leaves the full terms open.');
    assert.equal(await termsAccept.isChecked(),false); assert.equal(await page.locator('#account-create-reviewed').isChecked(),false);
    await page.keyboard.press('Space'); await view('account/create');
    assert.equal(await page.locator('#account-create-reviewed').isChecked(),true);
    assert.equal(await page.locator('#account-password').inputValue(),PASSWORD,'Accepting terms preserves the eight-character password draft.');
    const beforeTermsRefusal = service.journal.filter(item=>item.path==='/v1/accounts/enrollments').length;
    service.mode='terms-change-on-submit';
    await page.locator('#account-create-submit').click(); await alertShown(/terms/i); await idle();
    assert.equal(await current(),'account/create');
    assert.equal(service.journal.filter(item=>item.path==='/v1/accounts/enrollments').length,beforeTermsRefusal+1);
    assert.equal(service.enrollmentUsername,undefined,'A terms refusal never creates an enrollment.');
    assert.equal(await page.locator('#account-create-reviewed').isChecked(),false,'Changed or missing authoritative terms invalidate old agreement.');
    assert.equal(await page.locator('#account-create-reviewed').isDisabled(),true);
    assert.equal(await page.locator('#account-terms-accept').isDisabled(),true);
    assert.equal(await page.locator('#account-create-submit').isDisabled(),true);
    assert.equal(await page.locator('#account-terms-status').isVisible(),true);
    assert.match(await page.locator('#account-terms-status').textContent(),/terms.*unavailable/i);
    service.mode='normal'; await page.locator('#account-terms-retry').click();
    await page.waitForFunction(()=>!document.getElementById('account-create-reviewed').disabled);
    assert.equal(await page.locator('#account-create-reviewed').isChecked(),false,'Reloading current terms still needs a fresh agreement.');
    await page.locator('#account-password').fill(PASSWORD); await agreeToAccountTerms();
    await page.locator('#account-username').fill('browser_reviewed');
    assert.equal(await page.locator('#account-create-reviewed').isChecked(),true,'Username edits retain agreement to the same terms.');
    await page.setViewportSize({width:711,height:871}); await compactCentered('Create account'); await screenshot('centered-create-account');
    await page.setViewportSize({width:390,height:844});
    const previousEnrollments = service.journal.filter(item=>item.path==='/v1/accounts/enrollments').length;
    service.mode='username-unavailable';
    await page.locator('#account-create-submit').click(); await alertShown(/username.*(?:unavailable|taken|choose)|choose.*username/i);
    assert.equal(await current(),'account/create'); assert.equal(await page.locator('#account-password').inputValue(),'');
    assert.equal(await page.locator('#account-create-reviewed').isChecked(),true,'A server username refusal preserves agreement before any details are edited.');
    assert.equal(service.journal.filter(item=>item.path==='/v1/accounts/enrollments').length,previousEnrollments+1);
    service.mode='normal'; await page.locator('#account-username').fill('@browser-available'); await page.locator('#account-password').fill(PASSWORD);
    await agreeToAccountTerms();
    const beforeInvalidUsername = service.journal.filter(item=>item.path==='/v1/accounts/enrollments').length;
    assert.equal(await page.locator('#account-create-submit').isDisabled(),false);
    await page.locator('#account-create-submit').click(); await idle();
    assert.equal(await current(),'account/create');
    assert.equal(await page.locator('#account-username').getAttribute('aria-invalid'),'true');
    assert.equal(await page.locator('#account-username-hint').isVisible(),true);
    assert.match(await page.locator('#account-username-hint').textContent(),/hyphen/i);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'account-username');
    assert.equal(await page.locator('#account-password').inputValue(),PASSWORD);
    assert.equal(await page.locator('#account-create-reviewed').isChecked(),true,'Field validation does not withdraw accepted terms.');
    assert.equal(service.journal.filter(item=>item.path==='/v1/accounts/enrollments').length,beforeInvalidUsername);
    await page.locator('#account-username').fill('@browser_available');
    assert.equal(await page.locator('#account-username').inputValue(),'browser_available');
    assert.equal(await page.locator('#account-create-reviewed').isChecked(),true,'Correcting the username retains the accepted terms.');
    await layout('account enrollment');
    await page.locator('#account-create-submit').click(); await view('account/confirm');
    assert.equal(service.enrollmentUsername,'browser_available','The account API receives the bare canonical username after prefix editing.');
    assert.match(await page.locator('#confirmation-delivery').innerText(),/mock|simulat|test inbox/i);
    assert.equal(await page.locator('#account-password').inputValue(),'');
    assert.equal(service.journal.some(item=>item.path==='/v1/account/context'),false);
    await page.locator('#account-enrollment-status').click(); await idle();
    assert.match(await page.locator('#account-operation-state').innerText(),/pending/i);
    await page.goBack(); await view('account/sign-in'); await page.goForward(); await view('account/confirm');
    await page.locator('#account-confirm-code').fill(Buffer.alloc(32,99).toString('base64url'));
    await page.locator('#account-confirm-deliberate').check(); await submitForm('account-confirm-form');
    await alertShown(/confirm|code|could|invalid/i);
    assert.equal(await page.locator('#account-confirm-code').inputValue(),'');
    await useMockMail('#account-confirm-code','#account-confirm-deliberate');
    await page.locator('#account-confirm-deliberate').check();
    await submitForm('account-confirm-form'); await ready();
    assert.equal(await page.locator('#enrollment-begin').isDisabled(),true,'Confirmed enrollment alone must not sign in.');
    await fillSignIn(); await submitForm('account-sign-in-form'); await view('home'); await idle();
    assert.equal(await page.locator('#sign-in-password').inputValue(),'');
    assert.equal(await page.locator('#enrollment-begin').isDisabled(),false);
    await settingsAccess(true);
    assert.ok(service.journal.some(item=>item.path==='/dev-oidc/token'));
    assert.ok(service.journal.some(item=>item.path==='/v1/account/context'));
    for (const id of ['identity-requests','identity-operations']) assert.equal(await page.locator('[data-status-source="'+id+'"] [data-status-kind="warning"]').count(),1,
      'A confirmed service account still has pending identity verification.');
    for (const id of ['#publish-request','#save-operation','#send-offer']) assert.equal(await page.locator(id).isDisabled(),true);
    await accountEntry(); await signInPage(true);
    await page.setViewportSize({width:711,height:871}); await compactCentered('Account'); await screenshot('account-details');
    await page.setViewportSize({width:390,height:844});
    const beforeContinue=service.journal.filter(item=>item.path==='/v1/account/context').length, reuse=service.delay('/v1/account/context');
    try {
      await page.locator('#account-session-continue').focus(); await page.keyboard.press('Enter'); await reuse.entered;
      assert.equal(await page.locator('#account-session-continue').isDisabled(),true);
      assert.equal(await page.locator('#account-sign-out').isDisabled(),true);
    } finally { reuse.release(); }
    await view('identity/setup');
    assert.equal(service.journal.filter(item=>item.path==='/v1/account/context').length,beforeContinue+1,
      'Identity verification revalidates the current account before opening its separate setup.');
    await accountEntry(); await signInPage(true);
    const beforeOther=service.journal.filter(item=>item.method==='DELETE' && item.path==='/v1/auth/session').length;
    await page.locator('#account-sign-out').focus(); await page.keyboard.press('Enter'); await idle();
    await signInPage(); await settingsAccess(false);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'sign-in-email','Keyboard sign-out returns focus to the identifier field.');
    assert.equal(await page.locator('#sign-in-email').inputValue(),'','Explicit sign-out clears the previous email entry.');
    assert.equal(await page.locator('#sign-in-password').inputValue(),'');
    assert.equal(service.journal.filter(item=>item.method==='DELETE' && item.path==='/v1/auth/session').length,beforeOther+1,
      'The Account sign-out action explicitly revokes the current server session.');
    await fillSignIn(); await submitForm('account-sign-in-form'); await view('home');
    assert.deepEqual(await retained(),[]); await screenshot('fixture-account-signed-in');
  });

  await check('username and email sign-in require only a password and disclose no account or contact before authentication', async () => {
    await signOut(); await signInPage();
    const username=service.enrollmentUsername, shown='@'+username;
    assert.match(username,/^[a-z][a-z0-9_]{2,29}$/);
    const count=path=>service.journal.filter(item=>item.path===path).length;
    const beforeEntry=count('/v1/accounts/entry/start'),beforeProof=count('/v1/accounts/entry/confirm'),
      beforeMail=count('/v1/accounts/mock-mail'),beforeEnroll=count('/v1/accounts/enrollments');
    for (const invalid of ['@ab','@@alice','1alice','alice-bob','a'.repeat(31)]) {
      await page.locator('#sign-in-email').fill(invalid); await submitForm('account-email-form'); await alertShown(/valid email or username/i);
    }
    const privatePasswordStep=async expected=>{
      assert.equal((await page.locator('#sign-in-selected-email').textContent()).trim(),expected);
      assert.equal(await page.locator('#account-sign-in-form').isVisible(),true);
      assert.equal(await page.locator('#account-email-confirm-form').isVisible(),false);
      assert.equal(await page.locator('#sign-in-email-preview').isVisible(),false);
      assert.equal((await page.locator('[data-onboarding-view="account/sign-in"]').innerText()).includes(EMAIL),false,
        'A username password step does not reveal its linked contact.');
      assert.doesNotMatch(await page.locator('#view-description').textContent(),/account found|new account|existing account/i);
      assert.equal(await page.locator('[data-onboarding-view="account/create"]').isVisible(),false);
      await settingsAccess(false); await retained();
    };
    const beforeUnknownAuth=count('/dev-oidc/authorize');
    await fillSignIn('@unknown_fixture'); await privatePasswordStep('@unknown_fixture');
    assert.equal(count('/dev-oidc/authorize'),beforeUnknownAuth,'Continuing an unknown identifier performs no account lookup.');
    await submitForm('account-sign-in-form'); await alertShown(/^Check your email or username and password\.$/);
    const denied=await page.locator('#onboarding-message').textContent(); await privatePasswordStep('@unknown_fixture');
    await fillSignIn('  @'+username.toUpperCase()+'  ','wrong-browser-fixture-password'); await privatePasswordStep(shown);
    await submitForm('account-sign-in-form'); await alertShown(/^Check your email or username and password\.$/);
    assert.equal(await page.locator('#onboarding-message').textContent(),denied,'Existing and unknown usernames have the same credential denial.');
    await privatePasswordStep(shown);
    const beforeDeviceProof=service.signinProofs.length;
    service.mode='username-context-mismatch';
    await fillSignIn(shown); await submitForm('account-sign-in-form'); await alertShown(/^Sign-in unavailable\. Try again\.$/);
    await privatePasswordStep(shown);
    assert.equal(service.signinProofs.length,beforeDeviceProof,'A mismatched authenticated username is rejected before device proof or contact disclosure.');
    service.mode='normal';
    await fillSignIn(username.toUpperCase()); await privatePasswordStep(shown);
    const delayed=service.delay('/dev-oidc/authorize'),contexts=count('/v1/account/context');
    try {
      await submitForm('account-sign-in-form'); await delayed.entered;
      await page.goBack(); await idle(); await signInPage();
      assert.equal(await page.locator('#sign-in-password').inputValue(),'');
    } finally { delayed.release(); }
    await idle(); await signInPage();
    assert.equal(count('/v1/account/context'),contexts,'Cancelled password authentication cannot restore account context.');
    await fillSignIn('  @'+username.toUpperCase()+'  '); await privatePasswordStep(shown);
    await submitForm('account-sign-in-form'); await view('home'); await idle();
    assert.equal(await page.locator('#sign-in-password').inputValue(),'');
    await accountEntry(); await signInPage(true); await workspaceLocked('Authenticated username sign-in');
    assert.equal(count('/v1/accounts/entry/start'),beforeEntry);
    assert.equal(count('/v1/accounts/entry/confirm'),beforeProof);
    assert.equal(count('/v1/accounts/mock-mail'),beforeMail,'Normal sign-in never sends or retrieves a confirmation code.');
    assert.equal(count('/v1/accounts/enrollments'),beforeEnroll,'Unknown usernames never route automatically to signup.');
    await page.locator('#view-back').click(); await view('home'); await retained();
  });
  await check('confirmed signed-in accounts and browser device proof cannot unlock identity-gated requests or operations', async () => {
    await workspaceLocked('Confirmed email, current account and independently registered browser key');
    assert.ok(service.signinProofs.length>0);
    const before=service.journal.length;
    for (const target of protectedWorkspaceViews) {
      await restoreViewFixture(target,workspaceDestination(target));
      assert.equal(await page.locator('.screen:visible form').count(),0,'Pending identity cannot enter '+target+'.');
      await workspaceLocked(target);
    }
    for (const target of ['requester','operations/new','operator/offer']) {
      await page.evaluate(next=>{
        const button=document.createElement('button');button.type='button';button.dataset.navigate=next;
        document.body.append(button);button.click();button.remove();
      },target);
      await view(workspaceDestination(target),{focused:false});
    }
    for (const [kind,values] of [['request',{title:'Refused request',description:'No verified identity.'}],
      ['operation',{title:'Refused operation',description:'No advanced identity.'}],
      ['offer',{message:'Refused offer',price:'10'}]]) {
      const previous=await current();
      await page.evaluate(({kind,values})=>{
        for (const [field,value] of Object.entries(values)) {
          const input=document.getElementById(kind+'-'+field);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));
        }
        document.getElementById(kind+'-form').requestSubmit();
      },{kind,values});
      await view(previous,{focused:false});
      assert.ok((await page.locator('#'+kind+'-form input,#'+kind+'-form textarea').evaluateAll(nodes=>nodes.map(node=>node.value))).every(value=>value===''));
      assert.equal(await page.locator('#request-list-draft').isVisible(),false);
      assert.equal(await page.locator('#operation-list-draft').isVisible(),false);
    }
    assert.equal(service.journal.length,before,'Blocked local workflow input, history and activation issue no service request.');
    await signOut(); service.mode='forged-workspace-claims'; await signIn();
    await workspaceLocked('Unsupported verified flags, capability booleans and readiness claims');
    for (const target of ['requester/review','operations/review','operator/agreement'])
      await restoreViewFixture(target,workspaceDestination(target));
    service.mode='normal'; await retained(); await restoreViewFixture('home');
  });

  await check('signed-in devices show browser possession without hardware claims, refresh safely, and revoke sessions', async () => {
    const inventoryPath = '/v1/account/signin-devices';
    const count = (method,path) => service.journal.filter(item=>item.method===method && item.path===path).length;
    const loaded = () => page.waitForFunction(() => document.querySelector('[data-onboarding-view="account/devices"]').getAttribute('aria-busy') === 'false');
    const openDevices = async () => {
      await accountEntry(); await signInPage(true);
      assert.equal(await page.locator('#account-devices-link').isVisible(),true);
      await page.locator('#account-devices-link').focus(); await page.keyboard.press('Enter');
      await view('account/devices'); await loaded();
    };
    assert.ok(count('POST',inventoryPath+'/challenge') > 0,'Sign-in requests a fresh device challenge.');
    assert.ok(await page.evaluate(() => window.__browserKeyStoreOpens.length > 0),
      'Authenticated sign-in automatically uses only the reviewed browser-key store.');
    assert.equal(count('POST',inventoryPath+'/challenge'),count('POST',inventoryPath+'/prove'),
      'Each successful fixture sign-in sends a browser P-256 proof checked by the service fixture.');
    await openDevices();
    const currentDevice = page.locator('#account-device-list > li').filter({hasText:'This device'});
    assert.equal(await currentDevice.count(),1);
    assert.match(await currentDevice.innerText(),/Browser[\s\S]*Signed in[\s\S]*Last active/);
    assert.match(await currentDevice.innerText(),/No hardware attestation/);
    assert.doesNotMatch(await currentDevice.innerText(),/Hardware verified|online/i);
    const beforeRefresh = count('GET',inventoryPath);
    await page.locator('#account-devices-refresh').focus(); await page.keyboard.press('Enter'); await loaded();
    assert.equal(count('GET',inventoryPath),beforeRefresh+1,'Refresh obtains current owner-scoped device evidence.');
    const addedSession=service.addUnregisteredSession();
    await page.locator('#account-devices-refresh').click(); await loaded();
    const otherSessions = page.locator('#account-device-list > li').filter({hasText:'Other sessions'});
    assert.equal(await otherSessions.count(),1);
    assert.match(await otherSessions.innerText(),/Device details unavailable/);
    const originalSessions=service.unregisteredSessionIds, targetIndex=originalSessions.indexOf(addedSession);
    assert.ok(targetIndex>=0,'The new session is present in the exact fixture inventory order.');
    assert.equal(await otherSessions.getByRole('button',{name:/^Sign out/}).count(),originalSessions.length);
    const targetLabel='Sign out · Other sessions'+(originalSessions.length>1 ? ' · Session '+(targetIndex+1) : '');
    const beforeRevoke = count('POST','/v1/account/sessions/revoke');
    const revocation=page.waitForRequest(request=>request.url().endsWith('/account-api/transport')
      && request.postDataJSON()?.request?.path==='/v1/account/sessions/revoke');
    await otherSessions.getByRole('button',{name:targetLabel,exact:true}).click(); await loaded();
    const revokedBody=JSON.parse((await revocation).postDataJSON().request.body);
    assert.equal(revokedBody.session_id,addedSession,'The selected visible session label revokes the exact newly added session.');
    assert.equal(count('POST','/v1/account/sessions/revoke'),beforeRevoke+1);
    const retainedSessions=originalSessions.filter(id=>id!==addedSession);
    assert.deepEqual(service.unregisteredSessionIds,retainedSessions,'Only the selected session is removed; earlier active sessions remain.');
    assert.equal(await otherSessions.count(),retainedSessions.length ? 1 : 0);
    assert.equal(await otherSessions.getByRole('button',{name:/^Sign out/}).count(),retainedSessions.length);
    await page.setViewportSize({width:711,height:871});
    await screenshot('signed-in-devices');
    await page.setViewportSize({width:320,height:900});
    await page.evaluate(() => { document.documentElement.style.fontSize='200%'; });
    await layout('devices at 320px and 200% text'); await screenshot('signed-in-devices-large-text');
    await page.evaluate(() => { document.documentElement.style.fontSize=''; });
    await page.setViewportSize({width:390,height:844});
    const delay = service.delay(inventoryPath);
    const requested=page.waitForRequest(request=>request.url().endsWith('/account-api/transport')
      && request.postDataJSON()?.request?.method==='GET' && request.postDataJSON().request.path===inventoryPath);
    progress('Devices: refresh gate armed');
    let completion;
    try {
      await page.locator('#account-devices-refresh').click();
      const request=await bounded(requested,'the delayed Devices RPC request');
      completion=trackRequestCompletion(request);
      await delay.entered; progress('Devices: delayed request entered');
      await page.locator('#view-back').click(); await view('account/sign-in'); await signInPage(true);
      progress('Devices: Back restored Account'); delay.release();
      const outcome=await completion.wait(); progress('Devices: delayed request '+outcome);
      if(outcome==='failed') assert.match(request.failure()?.errorText || '',/ERR_ABORTED|cancel/i,'Only deliberate cancellation can discard the pending fixture request.');
      else {
        const response=await bounded(request.response(),'the completed Devices response');
        assert.equal(response?.status(),200);
        const body=await bounded(response.json(),'the completed Devices response body');
        assert.equal(body.response.status,200,'An uncancelled delayed inventory reply remains valid service evidence.');
      }
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
      assert.equal(await current(),'account/sign-in','A late device inventory response cannot replace Back navigation to Account.');
    } finally { delay.release(); completion?.close(); }
    progress('Devices: reopen inventory');
    await openDevices();
    const beforeSignOut = count('DELETE','/v1/auth/session');
    await currentDevice.getByRole('button',{name:/^Sign out this session/}).click();
    await view('account/sign-in',{focused:false}); await signInPage(); await settingsAccess(false);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'sign-in-email','Signing out this device focuses the identifier field.');
    assert.equal(count('DELETE','/v1/auth/session'),beforeSignOut+1,'This-device sign-out revokes its current server session.');
    assert.equal(await page.locator('#account-devices-link').evaluate(element=>element.hidden),true);
    assert.equal(await page.locator('#account-device-list > li').count(),0,'Signing out clears device details from the document.');
    await page.evaluate(() => {
      const index=history.state.index;
      history.pushState({nonverbaPreview:true,index:index+1,view:'account/devices'},'',location.pathname);
      history.pushState({nonverbaPreview:true,index:index+2,view:'account/sign-in'},'',location.pathname);
    });
    await page.goBack(); await view('account/sign-in',{focused:false});
    assert.equal(await current(),'account/sign-in','A signed-out history entry cannot reopen device inventory.');
    await restoreViewFixture('requester/review','requests');
    await restoreViewFixture('operations/review','operations');
    await workspaceLocked('Revoked current session');
    await retained(); await signIn();
  });

  await check('fresh Settings probes distinguish API and server readiness, recover and keep private key diagnostics hidden', async () => {
    await page.clock.install({time:new Date()});
    const source = id => '[data-status-source="settings-'+id+'"]';
    const probeCount = () => service.journal.filter(item=>item.path==='/readyz').length;
    const probesBefore = service.journal.filter(item=>item.path==='/dev-oidc/.well-known/openid-configuration').length;
    await openSettings(); await settingsChecked();
    await settingsAccess(true);
    assert.deepEqual(await statusKinds(source('network')),['success']);
    assert.equal(await page.locator('[data-status-source="settings-network"] use').getAttribute('href'),'#status-success');
    assert.equal(service.journal.filter(item=>item.path==='/dev-oidc/.well-known/openid-configuration').length,probesBefore+1,
      'Opening Settings performs fresh discovery even after successful sign-in.');
    for (const id of ['api','service']) assert.deepEqual(await statusKinds(source(id)),['success']);
    assert.match(await page.locator('#account-api-label').innerText(),/responding/i);
    assert.match(await page.locator('#account-connection-label').innerText(),/services ready/i);
    assert.equal(await page.locator('#configure-api-access').getAttribute('data-navigate'),'services/api');
    assert.equal(await page.locator('#options-panel input,#options-panel details').count(),0,
      'API configuration opens a separate workspace rather than a Settings dropdown.');
    assert.equal(await page.locator('#settings-refresh,#settings-check-state,#account-key-detail').count(),0);
    assert.deepEqual(await statusKinds('[data-status-summary="settings"]'),[],
      'Successful service checks do not invent a removed Device keys warning.');
    const nextCheck = async probes => {
      service.probes = probes;
      const previous = probeCount(), delayed = service.delay('/readyz');
      await page.clock.fastForward(10000);
      await Promise.race([delayed.entered,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Automatic Settings check did not run.')),10000))]);
      delayed.release(); await settingsChecked();
      assert.equal(probeCount(),previous+1,'The next automatic check obtains fresh service evidence.');
      assert.equal(await page.locator('#account-sign-out').evaluate(button=>button.hidden),false,'Probe failure alone must preserve the Account sign-out action.');
      assert.equal(await page.locator('#account-sign-out').isVisible(),false,'Account actions remain outside the open Settings panel.');
      await settingsAccess(true);
      const text = await page.locator('#options-panel').textContent();
      for (const value of service.inventorySecrets) assert.equal(text.includes(value),false,'Settings shows aggregate key status, not private identifiers or public key material.');
      await retained();
    };
    const beforeHalfInterval=probeCount(); await page.clock.fastForward(5000);
    assert.equal(probeCount(),beforeHalfInterval,'Five seconds does not start the ten-second polling cycle.');
    await nextCheck({api:'unavailable',service:'unavailable',keys:'unavailable'});
    assert.deepEqual(await statusKinds(source('api')),['error']);
    assert.deepEqual(await statusKinds(source('service')),['error']);
    assert.deepEqual(await statusKinds('[data-status-summary="settings"]'),['error']);
    assert.deepEqual(await statusKinds('[data-status-summary="dashboard"]'),['warning'],'Settings failures never alter the independent Dashboard root.');
    await nextCheck({keys:'unavailable'});
    assert.deepEqual(await statusKinds(source('api')),['success']);
    assert.deepEqual(await statusKinds(source('service')),['success']);
    assert.deepEqual(await statusKinds('[data-status-summary="settings"]'),[]);
    for (const keys of ['malformed','incomplete','pending','active','revoked']) {
      await nextCheck({keys});
      assert.deepEqual(await statusKinds('[data-status-summary="settings"]'),[],
        'Private key diagnostics have no removed UI row or ancestor status: '+keys);
    }
    service.probes = {};
    const visibleStatus = () => page.evaluate(()=>({
      labels:['account-api-label','account-connection-label'].map(id=>document.getElementById(id).textContent),
      icons:['settings-api','settings-service'].map(id=>[...document.querySelectorAll('[data-status-source="'+id+'"] [data-status-kind]')].map(icon=>icon.dataset.statusKind)),
      summary:[...document.querySelectorAll('[data-status-summary="settings"] [data-status-kind]')].map(icon=>icon.dataset.statusKind)
    }));
    const established=await visibleStatus();
    const establishedNodes=await page.evaluateHandle(()=>[
      ...['account-api-label','account-connection-label'].map(id=>document.getElementById(id).firstChild),
      ...document.querySelectorAll('[data-status-source="settings-api"] [data-status-kind], [data-status-source="settings-service"] [data-status-kind], [data-status-summary="settings"] [data-status-kind]')
    ]);
    const delay = service.delay('/readyz');
    const beforeSlow = probeCount();
    await page.clock.fastForward(10000); await delay.entered;
    assert.equal(await page.locator('.service-status-list').getAttribute('aria-busy'),'true');
    assert.deepEqual(await visibleStatus(),established,'A background read keeps established labels and icons without pending flicker.');
    assert.equal(await establishedNodes.evaluate(nodes=>nodes.every(node=>node?.isConnected)),true,
      'Quiet updates retain the existing text and icon nodes.');
    await page.clock.fastForward(10000);
    assert.equal(probeCount(),beforeSlow+1,'A slow status read never overlaps another polling cycle.');
    assert.deepEqual(await visibleStatus(),established,'Established status remains quiet throughout the delayed read.');
    assert.equal(await establishedNodes.evaluate(nodes=>nodes.every(node=>node?.isConnected)),true);
    delay.release(); await settingsChecked();
    assert.deepEqual(await statusKinds(source('service')),['success']);
    assert.deepEqual(await statusKinds('[data-status-summary="settings"]'),[],'Successful recovery removes old errors and pending markers.');
    assert.equal(await establishedNodes.evaluate(nodes=>nodes.every(node=>node?.isConnected)),true,
      'An unchanged completed result keeps the established presentation nodes.');
    await establishedNodes.dispose();
    await screenshot('fixture-settings-status');
    await page.keyboard.press('Escape'); await page.locator('#options-panel').waitFor({state:'hidden'});
    const beforeClosed = probeCount(); await page.clock.fastForward(15000);
    assert.equal(probeCount(),beforeClosed,'Closing Settings stops automatic checks.');
    await openSettings(); await settingsChecked();
    assert.equal(probeCount(),beforeClosed+1,'Reopening Settings checks immediately.');
    await settingsAccess(true);
    assert.equal(await page.locator('#options-toggle').getAttribute('aria-label'),'Open options');
    await page.evaluate(()=>{
      Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
      Object.defineProperty(document,'hidden',{configurable:true,value:true});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const beforeHidden = probeCount(); await page.clock.fastForward(15000);
    assert.equal(probeCount(),beforeHidden,'A hidden document pauses status checks.');
    await page.evaluate(()=>{delete document.visibilityState; delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));});
    await settingsChecked();
    assert.equal(probeCount(),beforeHidden+1,'Returning to an open Settings panel checks immediately.');
    await page.locator('#configure-api-access').focus(); service.mode='context-denial';
    await page.clock.fastForward(10000); await settingsChecked();
    await settingsAccess(false);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'account-setup-link',
      'Losing account authority moves focus away from the newly hidden API-management entry.');
    await page.keyboard.press('Escape'); await page.locator('#options-panel').waitFor({state:'hidden'});
    service.mode='normal'; await signIn(); await openSettings(); await settingsChecked();
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
    const beforePagehide = probeCount(); await page.clock.fastForward(15000);
    assert.equal(probeCount(),beforePagehide,'Pagehide stops future scheduled checks.');
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
    await settingsChecked();
    assert.equal(probeCount(),beforePagehide+1,'A restored open Settings panel checks immediately on pageshow.');
    assert.equal(await page.locator('#account-sign-out').isVisible(),false,'Pagehide does not retain in-memory account authority.');
    await settingsAccess(false);
    await page.keyboard.press('Escape'); await page.locator('#options-panel').waitFor({state:'hidden'});
    await page.clock.setSystemTime(new Date());
    const proofsBeforeRestoreSignIn = service.journal.filter(item => item.method === 'POST' && item.path === '/v1/account/signin-devices/prove').length;
    await signIn();
    assert.equal(service.journal.filter(item => item.method === 'POST' && item.path === '/v1/account/signin-devices/prove').length,
      proofsBeforeRestoreSignIn + 1, 'Signing in after restored-page lifecycle uses a fresh working attestation tool.');
  });

  await check('generic credential denials, wrong callback state, wrong nonce and denied current context never sign in', async () => {
    await accountEntry(); await signInPage(true);
    const deniedContext=service.delay('/v1/account/context');
    await openSettings(); await deniedContext.entered;
    await page.keyboard.press('Escape'); await page.locator('#options-panel').waitFor({state:'hidden'});
    await view('account/sign-in',{focused:false});
    assert.equal(await page.locator('#account-devices-link').isDisabled(),false,'A background status probe does not make the Account page busy.');
    await page.locator('#account-devices-link').focus();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'account-devices-link');
    await page.evaluate(()=>{
      window.__deniedAccountFocus=[];
      window.__deniedAccountFocusListener=event=>{
        const node=event.target;
        window.__deniedAccountFocus.push({id:node.id,visible:node.getClientRects().length>0 && !node.closest('[hidden]')});
      };
      document.addEventListener('focusin',window.__deniedAccountFocusListener);
    });
    let deniedFocus;
    try {
      service.mode='context-denial'; deniedContext.release();
      await page.waitForFunction(()=>document.getElementById('view-title').textContent==='Sign in'
        && document.getElementById('account-session-entry').hidden);
      await settingsChecked();
    } finally {
      deniedContext.release();
      deniedFocus=await page.evaluate(()=>{
        document.removeEventListener('focusin',window.__deniedAccountFocusListener);
        const events=window.__deniedAccountFocus;delete window.__deniedAccountFocus;delete window.__deniedAccountFocusListener;return events;
      });
    }
    assert.ok(deniedFocus.some(event=>event.id==='view-title' && event.visible),'Losing Devices authority moves focus to the visible account heading.');
    assert.ok(deniedFocus.every(event=>event.visible && event.id!=='account-setup-link'),'Authority loss never focuses the hidden Settings account entry.');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'view-title','Background authority loss keeps focus on the visible Sign in heading.');
    assert.equal(await current(),'account/sign-in','Lost Account authority cannot open identity setup.');
    await signInPage(); await settingsAccess(false); service.mode='normal';
    await fillSignIn(EMAIL,'wrong-browser-fixture-password'); await submitForm('account-sign-in-form');
    await alertShown(/^Check your email or username and password\.$/);
    const generic = await page.locator('#onboarding-message').innerText();
    const noAutomaticSignup=service.journal.filter(item=>item.path==='/v1/accounts/enrollments').length;
    await fillSignIn('unknown@example.invalid'); await submitForm('account-sign-in-form'); await alertShown(/^Check your email or username and password\.$/);
    assert.equal(await page.locator('#onboarding-message').textContent(),generic,'Unknown email credentials use the same generic denial.');
    assert.equal(await page.locator('#enrollment-begin').isDisabled(),true,'Unknown email credentials cannot establish account authority.');
    assert.equal(service.journal.filter(item=>item.path==='/v1/accounts/enrollments').length,noAutomaticSignup,'An unknown sign-in email never chooses signup.');
    await page.goBack(); await view('account/sign-in',{focused:false}); await signInPage();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'sign-in-email','Back from a refused password step returns focus to the identifier.');
    service.mode = 'credential-denial'; await fillSignIn(); await submitForm('account-sign-in-form'); await idle();
    assert.equal(await page.locator('#onboarding-message').innerText(),generic,'Other generic credential denials do not disclose an account state.');
    assert.equal(await page.locator('#enrollment-begin').isDisabled(),true);
    const count = path => service.journal.filter(item=>item.path===path).length;
    let before = count('/dev-oidc/token'); service.mode = 'wrong-state';
    await fillSignIn(); await submitForm('account-sign-in-form'); await alertShown(/^Sign-in unavailable\. Try again\.$/);
    assert.equal(count('/dev-oidc/token'),before,'A mismatched callback state must stop before token exchange.');
    before = count('/v1/account/context'); service.mode = 'wrong-nonce';
    await fillSignIn(); await submitForm('account-sign-in-form'); await alertShown(/^Sign-in unavailable\. Try again\.$/);
    assert.equal(count('/v1/account/context'),before,'An invalid signed ID-token nonce must stop before current context.');
    service.mode = 'context-denial';
    await fillSignIn(); await submitForm('account-sign-in-form'); await alertShown(/^Check your email or username and password\.$/);
    assert.equal(await page.locator('#enrollment-begin').isDisabled(),true,'Tokens alone must not establish current account authority.');
    await settingsAccess(false);
    service.mode = 'unsafe-counter';
    await fillSignIn(); await submitForm('account-sign-in-form'); await alertShown(/^Sign-in unavailable\. Try again\.$/);
    assert.equal(await page.locator('#enrollment-begin').isDisabled(),true,'An out-of-range context counter cannot mint authority.');
    service.mode = 'normal';
    const gate = service.delay('/v1/account/context');
    try {
      await fillSignIn(); await submitForm('account-sign-in-form');
      await Promise.race([gate.entered,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Delayed current-context fixture was not reached.')),10000))]);
      await page.goBack(); await idle(); await signInPage();
      assert.equal(await page.evaluate(()=>document.activeElement.id),'sign-in-email');
      await page.goBack(); await view('home');
    } finally { gate.release(); }
    await idle();
    assert.equal(await page.locator('#enrollment-begin').isDisabled(),true,'A late current-context reply must not restore a session after Back.');
    await settingsAccess(false);
    assert.equal(await page.locator('#onboarding-message').isVisible(),false,'An aborted old sign-in must not replace current focus with its error.');
    await signIn();
    await retained();
  });

  await check('service-bound document scan and guided frontal capture require deliberate consent and exact photo review', async () => {
    const before = await page.evaluate(() => window.__captureRequests.length);
    await begin('operator'); await view('identity/document');
    assert.equal(await page.evaluate(() => window.__captureRequests.length),before,'Entering capture never opens a sensor.');
    assert.equal(await page.locator('#document-next').isDisabled(),true);
    assert.equal(await page.locator('#document-camera-start').isDisabled(),true);
    assert.equal(await page.locator('#document-file').isDisabled(),true);
    await capturePair();
    assert.equal(await page.locator('#enrollment-finish').isDisabled(),true);
    await page.locator('#enrollment-review').click(); await idle();
    assert.equal(await page.locator('#enrollment-finish').isDisabled(),false);
    const oldDocument = await page.locator('#review-document').getAttribute('src');
    await page.locator('#retake-document').click(); await view('identity/document');
    assert.equal(await page.locator('#enrollment-finish').isDisabled(),true);
    assert.equal(await page.locator('#document-next').isDisabled(),true);
    assert.equal(await page.evaluate(url=>window.__captureURLs.has(url),oldDocument),false,'Replacing the document revokes the old preview.');
    await startCamera('document_front'); await takePhoto('document_front');
    await page.locator('#document-next').click(); await view('identity/face');
    await page.locator('#face-next').click(); await view('identity/review');
    await page.locator('#enrollment-review').click(); await idle();
    const oldFace = await page.locator('#review-face').getAttribute('src');
    await page.locator('#retake-face').click(); await view('identity/face');
    assert.equal(await page.locator('#enrollment-finish').isDisabled(),true);
    assert.equal(await page.evaluate(url=>window.__captureURLs.has(url),oldFace),false,'Retaking the face revokes the old still.');
    await startCamera('face_front'); await page.locator('#guidance-skip').click(); await idle();
    assert.match(await page.locator('#guidance-position').innerText(),/guidance skipped.*movement and liveness not checked/i);
    await takePhoto('face_front'); await page.locator('#face-next').click(); await view('identity/review');
    for (const id of ['#review-document','#review-face']) {
      assert.equal(await page.locator(id).evaluate(image=>image.complete && image.naturalWidth>0),true);
      assert.match(await page.locator(id).getAttribute('src'),/^blob:/);
    }
    await layout('camera photo review'); await reviewAndFinish();
    assert.match(await page.locator('[data-onboarding-view="identity/status"]').innerText(),/not submitted|no identity service has received/i);
    assert.match(await page.locator('[data-onboarding-view="identity/status"]').innerText(),/not verified|not checked|guidance only/i);
    await retained(); await screenshot('synthetic-camera-photos-reviewed');
  });

  await check('discard, late permission completion after Back and reload clear photos without restoring account authority', async () => {
    const beforeBrowserReload = service.signinProofs.at(-1);
    assert.ok(beforeBrowserReload,'The current account has an independently verified browser proof.');
    await page.locator('#enrollment-cancel').click(); await view('identity/setup');
    await cameraStopped({released:true});
    for (const id of ['#review-document','#review-face','#selected-document','#selected-face']) assert.equal(await page.locator(id).getAttribute('src'),null);
    await lateCameraBack(); await retained();
    await begin('operator'); await capturePair(); await reviewAndFinish();
    await page.reload(); await view('home',{focused:false}); await gateway(); await idle();
    assert.equal(await page.locator('#enrollment-begin').isDisabled(),true,'Reload cannot restore in-memory service authority.');
    for (const id of ['#review-document','#review-face','#selected-document','#selected-face']) assert.equal(await page.locator(id).getAttribute('src'),null);
    assert.deepEqual(await retained(),[],'Reload leaves no photos, illustrated records or synthetic receipts.');
    await signIn();
    const afterBrowserReload = service.signinProofs.at(-1);
    assert.equal(afterBrowserReload.key_spki_sha256,beforeBrowserReload.key_spki_sha256,
      'Fresh authentication after reload proves the same retained browser-profile key.');
    assert.notEqual(afterBrowserReload.session_id,beforeBrowserReload.session_id,
      'Retaining the browser key does not reuse the prior authenticated session.');
    await begin('operator'); await view('identity/document');
    assert.equal(await page.locator('#enrollment-processing').isChecked(),false);
    assert.equal(await page.locator('#document-next').isDisabled(),true);
    await page.locator('#enrollment-cancel').click(); await view('identity/setup');
  });

  await check('foreground interruption and navigation stop camera tracks; invalid files never become selected photos', async () => {
    await begin('requester'); await view('identity/document');
    await page.locator('#enrollment-processing').check(); await idle(); await startCamera('document_front');
    await page.evaluate(() => window.dispatchEvent(new Event('nonverba:camera-stop')));
    await view('identity/setup',{focused:false}); await cameraStopped({released:true});
    assert.equal(await page.locator('#selected-document').getAttribute('src'),null);
    await begin('requester'); await view('identity/document');
    assert.equal(await page.locator('#enrollment-processing').isChecked(),false,
      'Foreground loss clears the transient capture and processing choice.');
    await page.locator('#enrollment-processing').check(); await idle();
    await page.locator('#document-file').setInputFiles({name:'synthetic-invalid.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')});
    await alertShown(/JPEG|PNG|image/i); assert.equal(await page.locator('#document-file').inputValue(),'');
    assert.equal(await page.locator('#selected-document').getAttribute('src'),null);
    const imageBytes = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 240;
      const drawing = canvas.getContext('2d'); drawing.fillStyle = '#eee8d5'; drawing.fillRect(0,0,400,240);
      drawing.fillStyle = '#243d28'; drawing.fillText('SYNTHETIC DOCUMENT — NOT VALID ID',20,100);
      const image = await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      return Array.from(new Uint8Array(await image.arrayBuffer()));
    });
    const previousCaptures = await page.evaluate(() => window.__captureRequests.length);
    await page.locator('#document-file').setInputFiles({name:'synthetic-document.png',mimeType:'image/png',buffer:Buffer.from(imageBytes)});
    await page.waitForFunction(() => document.getElementById('selected-document').complete
      && document.getElementById('selected-document').getAttribute('src')?.startsWith('blob:'));
    await idle(); assert.equal(await page.locator('#document-file').inputValue(),'');
    assert.equal(await page.evaluate(() => window.__captureRequests.length),previousCaptures,'Deliberate file selection opens no camera.');
    await page.locator('#document-remove').click(); await idle(); await cameraStopped({released:true});
    await startCamera('document_front');
    await page.locator('#navigation-toggle').click(); await page.locator('#navigation-panel').waitFor({state:'visible'});
    assert.equal(await page.locator('#new-request').isDisabled(),true);
    await page.locator('#requests-list-link').click(); await page.locator('#requests-setup-link').click();
    await view('identity/setup');
    await cameraStopped({released:true}); await retained();
    await gateway();
  });
  await check('failed server sign-out remains unconfirmed and two-factor recovery requires fresh login with rotated credentials', async () => {
    service.mode = 'signout-unknown';
    await accountEntry(); await page.locator('#account-sign-out').click();
    await view('account/sign-in',{focused:false});
    await alertShown(/unconfirmed|not confirmed|could not|unknown/i);
    assert.equal(await page.locator('#enrollment-begin').isDisabled(),true);
    await settingsAccess(false);
    await page.locator('#account-page-actions #account-discard-session').waitFor({state:'visible'});
    await page.locator('#account-discard-session').click(); await view('account/sign-in',{focused:false});
    service.mode = 'normal'; await signIn(); await signOut();
    assert.equal(await page.locator('#account-discard-session').isVisible(),false);
    await view('account/sign-in',{focused:false}); await signInPage();
    await emailEntry();
    await page.locator('#sign-in-recover').click(); await view('account/recover');
    await page.locator('#recovery-email').fill(EMAIL); await page.locator('#recovery-code').fill(recoveryBatch(service.recoveryCodes)[3]);
    await submitForm('account-recovery-form'); await idle();
    await page.locator('#account-recovery-finish-form').waitFor({state:'visible'});
    await page.locator('#account-recovery-status').click(); await idle();
    assert.equal(await page.locator('#recovery-code').inputValue(),'');
    await page.locator('#recovery-contact-code').fill(Buffer.alloc(32,99).toString('base64url'));
    await page.locator('#recovery-new-password').fill(NEW_PASSWORD); await page.locator('#recovery-finish-deliberate').check();
    await submitForm('account-recovery-finish-form'); await alertShown(/recovery|confirm|code|invalid|could/i);
    await useMockMail('#recovery-contact-code','#recovery-finish-deliberate');
    await page.locator('#recovery-new-password').fill(NEW_PASSWORD);
    await page.locator('#recovery-finish-deliberate').check(); await submitForm('account-recovery-finish-form'); await ready();
    assert.equal(await page.locator('#enrollment-begin').isDisabled(),true);
    await fillSignIn(EMAIL,PASSWORD); await submitForm('account-sign-in-form'); await alertShown(/^Check your email or username and password\.$/);
    await fillSignIn(); await submitForm('account-sign-in-form'); await view('home'); await idle();
    await retained();
  });

  await check('connected account and capture controls remain labelled, keyboard usable and readable with 200% text', async () => {
    await gateway();
    await page.setViewportSize({width:320,height:900});
    await page.evaluate(() => { document.documentElement.style.fontSize='200%'; });
    await accountEntry(); await signInPage(true); await layout('Account details at 320px / 200%');
    await compactCentered('Account details at 320px / 200%'); await screenshot('account-details-large-text');
    await page.locator('#view-back').click(); await view('identity/setup');
    await openSettings(); await settingsChecked(); await settingsAccess(true);
    await page.locator('#configure-api-access').focus(); await page.keyboard.press('Enter');
    await page.locator('#options-panel').waitFor({state:'hidden'}); await view('services/api');
    const add=page.locator('#api-key-add'), generate=page.locator('#api-key-generate'), options=page.locator('#api-key-options');
    assert.equal(await add.isDisabled(),false); assert.equal(await add.getAttribute('aria-expanded'),'false');
    assert.equal((await add.innerText()).trim(),'+'); assert.equal(await add.getAttribute('aria-label'),'New API key');
    assert.equal(await options.isVisible(),false); assert.equal(await options.evaluate(element=>element.hidden),true);
    const requests=service.journal.length;
    await add.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'api-key-name');
    const settingsLayout = await page.locator('#options-panel').evaluate(panel=>{
      const screen=document.getElementById('api-access-screen'), heading=document.getElementById('view-title');
      return {viewport:document.documentElement.scrollWidth<=innerWidth+1,screen:screen.scrollWidth<=screen.clientWidth+1,
        heading:heading.textContent,eyebrow:document.getElementById('view-eyebrow').textContent,
        headingFits:heading.scrollWidth<=heading.clientWidth+1 && heading.scrollHeight<=heading.clientHeight+1,
        rows:panel.querySelectorAll('.service-status-list > div').length,sections:panel.querySelectorAll('.account-details > div').length,
        papers:screen.querySelectorAll('.paper').length,title:screen.querySelector('#api-key-inventory .card-top h2').textContent.trim(),
        headerButton:screen.querySelectorAll('#api-key-inventory .card-top #api-key-add').length,
        visibleProse:[...screen.querySelectorAll('p,.tag')].filter(element=>element.getClientRects().length>0).length,
        mainIntroHidden:document.getElementById('view-description').hidden,
        previewDescriptions:screen.querySelectorAll('#api-keys-preview').length,
        generateDisabled:document.getElementById('api-key-generate').disabled,
        generateType:document.getElementById('api-key-generate').getAttribute('type'),
        generateAligned:Math.abs(document.getElementById('api-key-generate').getBoundingClientRect().right
          - screen.querySelector('.key-options-grid').getBoundingClientRect().right)<=1.5,
        addControls:document.getElementById('api-key-add').getAttribute('aria-controls'),
        addExpanded:document.getElementById('api-key-add').getAttribute('aria-expanded'),
        optionsHidden:document.getElementById('api-key-options').hidden,
        optionsTag:document.getElementById('api-key-options').tagName,
        optionsSummaries:document.querySelectorAll('#api-key-options details,#api-key-options summary').length,
        optionsGrids:screen.querySelectorAll('#api-key-options .key-options-grid').length,
        namePlaceholder:document.getElementById('api-key-name').getAttribute('placeholder'),
        controls:['api-key-name','api-key-permissions','api-key-expiry'].map(id=>{const control=document.getElementById(id);
          return {disabled:control.disabled,required:control.required,value:control.tagName==='SELECT' ? control.selectedOptions[0].textContent : control.value,
            labelled:control.labels.length>0,label:control.labels[0].textContent.trim()};}),
        headers:[...screen.querySelectorAll('#api-key-inventory thead th')].map(header=>header.textContent.trim()),
        unavailable:screen.querySelector('#api-key-inventory tbody td').textContent.trim(),
        pastedSecretInputs:screen.querySelectorAll('#api-server,#api-key').length};
    });
    assert.deepEqual(settingsLayout,{viewport:true,screen:true,rows:3,sections:3,
      heading:'API and MCP keys',eyebrow:'Developer services',headingFits:true,
      papers:1,title:'Active keys',headerButton:1,visibleProse:0,mainIntroHidden:true,previewDescriptions:0,
      generateDisabled:false,generateType:'submit',generateAligned:true,addControls:'api-key-options',addExpanded:'true',optionsHidden:false,optionsTag:'FORM',optionsSummaries:0,
      optionsGrids:1,namePlaceholder:'Key name',
      controls:[{disabled:false,required:true,value:'',labelled:true,label:'Name'},{disabled:false,required:true,value:'Select',labelled:true,label:'Permissions'},{disabled:false,required:true,value:'Select',labelled:true,label:'Expiration'}],
      headers:['Name','Key prefix','Access','Created','Last used','Actions'],unavailable:'Unavailable',pastedSecretInputs:0},
      'The developer-service workspace preserves its readable heading, native demo form and unknown service inventory at 320px / 200% text.');
    assert.equal((await page.locator('#api-key-inventory tbody td').innerText()).trim(),'Unavailable');
    for (const selector of ['#publish-request','#save-operation','#send-offer']) assert.equal(await page.locator(selector).isDisabled(),true,
      'Opening API key management cannot grant participant or device-key authority.');
    await generate.click();
    assert.equal(await page.locator('#api-key-name').evaluate(element=>element.validity.valueMissing),true);
    assert.equal(await page.locator('[data-demo-key]').count(),0,'Native validation prevents an empty-name demo.');
    const demoName='Connected demo <b>key</b>';
    await page.locator('#api-key-name').fill('Edit this'); await page.locator('#api-key-name').press('Control+A');
    await page.keyboard.type(demoName);
    await page.locator('#api-key-permissions').focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#api-key-permissions').inputValue(),'read');
    await page.locator('#api-key-expiry').selectOption('never');
    await generate.focus(); await page.keyboard.press('Enter');
    const result=page.locator('#api-key-result'), value=page.locator('#api-key-value');
    assert.equal(await options.isVisible(),false); assert.equal(await add.getAttribute('aria-expanded'),'false');
    assert.equal(await result.isVisible(),true); assert.equal(await result.getAttribute('role'),'group');
    assert.equal(await result.getAttribute('aria-label'),'Generated API key');
    assert.match(await result.innerText(),/Demo key/); assert.equal(await value.evaluate(element=>element.readOnly),true);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'api-key-value');
    const full=await value.inputValue(); assert.match(full,/^nv-[a-f0-9]{32}$/);
    assert.equal(await value.isDisabled(),false); assert.equal(await value.evaluate(element=>getComputedStyle(element).userSelect),'text');
    await value.focus(); await value.press('Control+A');
    assert.equal(await value.evaluate(element=>element.selectionStart===0 && element.selectionEnd===element.value.length),true);
    const copy=page.locator('#api-key-copy'), copyStatus=page.locator('#api-key-copy-status');
    assert.equal(await copy.getAttribute('aria-label'),'Copy API key');
    assert.equal(await copyStatus.getAttribute('role'),'status'); assert.equal(await copyStatus.getAttribute('aria-live'),'polite');
    await copy.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.getElementById('api-key-copy-status').textContent==='Copied.');
    assert.ok(await page.evaluate(expected=>window.__copiedEmailCode===expected,full));
    await page.evaluate(()=>{window.__copiedEmailCode=null;window.__clipboardGate=true;}); await copy.click();
    await page.waitForFunction(()=>typeof window.__releaseClipboard==='function');
    assert.equal(await page.locator('#api-key-result-summary').textContent(),'Read only · Never expires');
    const demo=page.locator('[data-demo-key]');
    assert.equal(await demo.count(),1); assert.equal(await demo.getAttribute('title'),'Never expires');
    assert.equal(await demo.locator('td').nth(0).textContent(),demoName+'Demo'); assert.equal(await demo.locator('b').count(),0);
    assert.equal(await demo.locator('td').nth(1).textContent(),full.slice(0,13)+'…');
    assert.equal(await demo.locator('td').nth(2).textContent(),'Read onlyNever expires');
    assert.equal(await demo.locator('td').nth(2).locator('.key-expiry').textContent(),'Never expires'); assert.match(await demo.locator('td').nth(3).textContent(),/\d/);
    assert.equal(await demo.locator('td').nth(4).textContent(),'Never'); assert.equal((await demo.innerText()).includes(full),false);
    assert.equal((await page.evaluate(()=>JSON.stringify(history.state))).includes(full),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'The demo result and masked row fit at 320px / 200% text.');
    assert.equal(service.journal.length,requests,'Demo editing, validation and generation do not contact the service.');
    await page.locator('#view-back').click(); await view('identity/setup');
    await page.evaluate(()=>{window.__clipboardGate=false;window.__releaseClipboard();delete window.__releaseClipboard;});
    assert.equal(await copyStatus.evaluate(element=>element.hidden && element.textContent===''),true,'Navigation fences late clipboard feedback and clears the key result.');
    await page.evaluate(()=>{window.__copiedEmailCode=null;});
    await openSettings(); await settingsChecked(); await page.locator('#configure-api-access').click();
    await page.locator('#options-panel').waitFor({state:'hidden'}); await view('services/api');
    assert.equal(await demo.count(),1,'Only demo metadata survives navigation inside this document.');
    assert.equal(await value.inputValue(),''); assert.equal(await result.evaluate(element=>element.hidden),true);
    const beforeRevoke=service.journal.length;
    await demo.getByRole('button',{name:'Revoke demo key '+demoName,exact:true}).focus(); await page.keyboard.press('Enter');
    assert.equal(await demo.count(),0); assert.equal((await page.locator('#api-key-inventory tbody td').innerText()).trim(),'Unavailable');
    assert.equal(service.journal.length,beforeRevoke,'Revoking a demo row does not call the service.');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'api-key-add');
    const docsLink=page.locator('#api-documentation-link'), beforeDocs=service.journal.length;
    assert.equal(await docsLink.isVisible(),true); assert.equal((await docsLink.innerText()).trim(),'swagger.platform.non-verba.com');
    assert.equal(await docsLink.getAttribute('data-navigate'),'services/docs');
    assert.equal(await docsLink.evaluate(button=>{
      const card=document.getElementById('api-key-inventory').getBoundingClientRect(), bounds=button.getBoundingClientRect(), style=getComputedStyle(button);
      return style.display === 'block' && parseFloat(style.marginTop)>=24 && bounds.top-card.bottom>=23
        && Math.abs((bounds.left+bounds.right-card.left-card.right)/2)<=1.5;
    }),true,'Documentation is centered with at least a 24px gap below the card at 320px / 200% text.');
    await screenshot('api-keys-centered-documentation-large-text');
    await docsLink.focus(); await page.keyboard.press('Enter'); await view('services/docs');
    const documentation=page.locator('#api-documentation-screen');
    assert.equal(await documentation.getAttribute('aria-label'),'API and MCP documentation');
    assert.equal(await documentation.evaluate(element=>element.children.length===0 && !element.textContent.trim()
      && element.scrollWidth<=element.clientWidth+1),true);
    assert.equal(await page.locator('#view-title').textContent(),'swagger.platform.non-verba.com');
    assert.equal(await page.locator('#view-eyebrow').textContent(),'Documentation');
    assert.equal(await page.locator('#view-description').isVisible(),false);
    assert.equal(await page.locator('#view-title').evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'The empty documentation view fits at 320px / 200% text.');
    await page.locator('#view-back').click(); await view('services/api');
    assert.equal(service.journal.length,beforeDocs,'The documentation entry and Back stay local without loading the named host.');
    await retained(); await page.locator('#view-back').click(); await view('identity/setup');
    await signOut(); await emailEntry('large_text@example.invalid','enrollment');
    await layout('320px / 200% create'); await compactCentered('Create account at 320px / 200%');
    await accountEntry(); await signInPage(); await layout('320px / 200% sign-in');
    await emailEntry(EMAIL,'password',true); await layout('320px / 200% password');
    await page.locator('#sign-in-recover').click();
    await view('account/recover'); await layout('320px / 200% recovery');
    const beforeRecoveryBack=service.journal.length;
    await page.goBack(); await view('account/sign-in',{focused:false}); await signInPage();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'sign-in-email','Back from recovery returns focus to the neutral identifier field.');
    for (const id of ['sign-in-password','recovery-code','recovery-contact-code','recovery-new-password'])
      assert.equal(await page.locator('#'+id).inputValue(),'','Back from recovery clears the '+id+' secret.');
    assert.equal(service.journal.length,beforeRecoveryBack,'Back from recovery makes no implicit authentication, proof or mail request.');
    await fillSignIn();
    await page.locator('#account-sign-in-submit').focus(); await page.keyboard.press('Enter'); await view('home'); await idle();
    await gateway(); await layout('320px / 200% gateway'); await begin('requester'); await layout('320px / 200% document');
    await page.locator('#enrollment-processing').focus(); await page.keyboard.press('Space');
    assert.equal(await page.locator('#enrollment-processing').isChecked(),true);
    await idle();
    await capturePair({skip:true}); await layout('320px / 200% review');
    await page.waitForFunction(() => !document.getElementById('enrollment-review').disabled);
    await page.locator('#enrollment-review').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('enrollment-finish').disabled);
    await page.locator('#enrollment-finish').focus(); await page.keyboard.press('Enter'); await view('identity/status');
    await layout('320px / 200% capture status'); await screenshot('synthetic-camera-onboarding-large-text');
    await page.locator('#enrollment-delete').click(); await view('identity/setup',{focused:false}); await cameraStopped({released:true}); await retained();
    await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
    await retained(); assert.deepEqual(errors,[]); assert.deepEqual(unexpected,[]);
  });

  await check('own-account deletion requires matching email, password and fresh review before same-email mock signup receives new identity', async () => {
    const previous = service.identity;
    await begin('requester'); await capturePair(); await reviewAndFinish();
    await deletionEntry(); await cameraStopped({released:true});
    for (const id of ['#review-document','#review-face','#selected-document','#selected-face']) assert.equal(await page.locator(id).getAttribute('src'),null,
      'Entering account deletion closes access to transient identity photos.');
    await deletionFields(); await page.locator('#delete-password').fill('wrong-browser-deletion-password');
    assert.equal(await page.locator('#delete-deliberate').isChecked(),false,'Editing the deletion password invalidates explicit review.');
    assert.equal(await page.locator('#account-delete-submit').isDisabled(),true);
    await page.locator('#account-delete-cancel').click(); await view('identity/setup');
    assert.equal(await page.locator('#delete-password').inputValue(),'');
    assert.equal(await page.locator('#enrollment-begin').isDisabled(),false,'Cancelling deletion preserves the current account session.');
    await deletionEntry(); await deletionFields('different@example.invalid'); await submitForm('account-delete-form');
    await alertShown(/email|password|account|delete|deletion|denied|refused/i);
    assert.deepEqual(service.identity,previous); assert.equal(await page.locator('#delete-password').inputValue(),'');
    assert.equal(await page.locator('#enrollment-begin').isDisabled(),false,'A mismatched typed email cannot delete the account.');
    await deletionFields(EMAIL,'wrong-browser-deletion-password'); await submitForm('account-delete-form');
    await alertShown(/email|password|account|delete|deletion|denied|refused|authorization/i);
    assert.deepEqual(service.identity,previous); assert.equal(await page.locator('#delete-password').inputValue(),'');
    assert.equal(await page.locator('#enrollment-begin').isDisabled(),false,'A wrong password cannot delete or replace the current account.');
    service.mode = 'deletion-session-expired'; await deletionFields(); await submitForm('account-delete-form');
    await alertShown(/account|access|authorization|refused/i);
    assert.equal(await page.locator('#enrollment-begin').isDisabled(),true,'An authoritative deletion 401 clears the expired local session.');
    await settingsAccess(false);
    assert.equal(await page.locator('#account-deletion-pending').isVisible(),false,'An authoritative 401 is a known refusal, not an uncertain deletion.');
    assert.equal(await page.locator('#account-deleted').isVisible(),false);
    assert.deepEqual(service.identity,previous,'A refused deletion cannot replace account identity.');
    service.mode = 'normal'; await signIn(); await deletionEntry();
    await deletionFields(); await submitForm('account-delete-form'); await idle();
    await page.locator('#account-deleted').waitFor({state:'visible'});
    await settingsAccess(false);
    assert.match(await page.locator('#account-deleted').innerText(),/historical|records|backups/i);
    assert.equal(await page.locator('#delete-password').inputValue(),'');
    await cameraStopped({released:true}); await retained(); await screenshot('mock-account-deleted');
    await recreateDeletedAccount(previous);
  });

  await check('lost deletion responses stay unknown until the original secret-bound status resolves and allow fresh signup afterward', async () => {
    const previous = service.identity;
    await deletionEntry(); await deletionFields();
    const before = service.journal.filter(item=>item.path==='/v1/account/deletion').length;
    service.mode = 'deletion-response-lost'; await submitForm('account-delete-form');
    await alertShown(/unknown|unconfirmed|could|status|check/i);
    await settingsAccess(false);
    assert.equal(await page.locator('#account-delete-label').textContent(),'Check account deletion');
    assert.equal(await page.locator('#account-delete-link svg').count(),1,'Pending deletion changes the label without removing its trash icon.');
    assert.equal(await page.locator('#account-delete-link svg use').getAttribute('href'),'#trash');
    await page.locator('#account-delete-status').waitFor({state:'visible'});
    assert.equal(await page.locator('#delete-password').inputValue(),'');
    assert.equal(await page.locator('#account-deleted').isVisible(),false,'A lost response is not a confirmed deletion receipt.');
    assert.ok(!await page.locator('#account-delete-submit').isVisible() || await page.locator('#account-delete-submit').isDisabled(),
      'An uncertain deletion cannot be retried as a fresh mutation.');
    service.mode = 'deletion-status-unknown'; await page.locator('#account-delete-status').click();
    await alertShown(/unknown|unconfirmed|could|status|check|found/i);
    assert.equal(await page.locator('#account-deleted').isVisible(),false,'A missing status is still an unknown outcome.');
    assert.equal(service.journal.filter(item=>item.path==='/v1/account/deletion').length,before+1);
    service.mode = 'normal'; await page.locator('#account-delete-status').click(); await idle();
    await page.locator('#account-deleted').waitFor({state:'visible'});
    assert.equal(service.journal.filter(item=>item.path==='/v1/account/deletion').length,before+1,
      'Status resolution uses the original operation without resubmitting the deletion.');
    await retained(); await recreateDeletedAccount(previous);
  });

  await check('disabled delivery capability keeps normal contacts and mock mailbox unavailable', async () => {
    await signOut(); service.delivery = 'disabled';
    await page.reload(); await view('home',{focused:false}); await gateway();
    await page.waitForFunction(() => document.getElementById('sign-in-service-status').hidden);
    assert.match(await page.locator('#onboarding-notice').textContent(),/not configured|disabled|test contact/i);
    await accountEntry(); await signInPage();
    const beforeEntry = service.journal.filter(item=>item.path === '/v1/accounts/entry/start').length;
    await emailEntry(CONFIGURED_EMAIL);
    assert.equal(service.journal.filter(item=>item.path === '/v1/accounts/entry/start').length,beforeEntry,
      'Existing account sign-in does not require configured mail delivery.');
    await page.locator('#view-back').click(); await idle(); await signInPage();
    await page.locator('#sign-in-create-account').click(); await idle();
    await page.locator('#sign-in-email').fill(CONFIGURED_EMAIL); await submitForm('account-email-form'); await alertShown(/email|available|continue/i);
    assert.equal(service.journal.filter(item=>item.path === '/v1/accounts/entry/start').length,beforeEntry);
    assert.equal(await page.locator('#account-email-confirm-form').isVisible(),false);
    assert.equal(await page.locator('#sign-in-email-preview').isVisible(),false);
    const before = service.journal.filter(item=>item.path==='/v1/accounts/enrollments').length;
    await restoreViewFixture('account/create','account/sign-in');
    await initialSignInPage();
    assert.equal(service.journal.filter(item=>item.path==='/v1/accounts/enrollments').length,before);
    assert.equal(await page.locator('#account-mock-email').isVisible(),false);
    await retained();
  });

  await check('configured SMTP capability accepts an ordinary email and shows pending contact confirmation without claiming delivery', async () => {
    service.realEmail = true; service.newContact(CONFIGURED_EMAIL);
    await page.reload(); await view('home',{focused:false}); await gateway();
    await page.waitForFunction(() => document.getElementById('sign-in-service-status').hidden);
    assert.match(await page.locator('#onboarding-notice').textContent(),/email confirmation is configured/i);
    await accountEntry(); await signInPage();
    await page.locator('#sign-in-create-account').click(); await idle();
    await page.locator('#sign-in-email').fill(CONFIGURED_EMAIL); await submitForm('account-email-form'); await idle();
    await page.locator('#account-email-confirm-form').waitFor({state:'visible'});
    assert.equal(await page.locator('#sign-in-email-code').inputValue(),'','A real-contact email code is never filled by the application.');
    assert.equal(await page.locator('#sign-in-email-preview').isVisible(),false);
    assert.equal(await page.locator('#sign-in-recover').isVisible(),false);
    assert.equal(await page.locator('#account-sign-in-form').isVisible(),false);
    await page.locator('#sign-in-email-code').fill(ENTRY_CODE); await submitForm('account-email-confirm-form'); await view('account/create');
    assert.equal(await page.locator('#account-email').inputValue(),CONFIGURED_EMAIL);
    assert.equal(await page.locator('#account-email').evaluate(element=>element.readOnly),true);
    await page.locator('#account-username').fill('configured_fixture'); await page.locator('#account-password').fill(PASSWORD);
    await page.waitForFunction(()=>!document.getElementById('account-create-reviewed').disabled);
    await agreeToAccountTerms();
    await submitForm('account-create-form'); await view('account/confirm');
    assert.match(await page.locator('#confirmation-delivery').innerText(),/check your email.*app cannot retrieve/i);
    assert.doesNotMatch(await page.locator('#confirmation-delivery').innerText(),/private test inbox/i);
    assert.equal(await page.locator('#account-mock-email').isVisible(),false);
    assert.equal(await page.locator('#enrollment-begin').isDisabled(),true);
    assert.equal(await page.locator('#account-confirm-code').inputValue(),'');
    await retained(); await screenshot('configured-email-capability-pending');
    assert.deepEqual(errors,[]); assert.deepEqual(unexpected,[]);
  });

  const result = {passed:true,scope:'Exact bundled client against intercepted account HTTP, signed OIDC fixtures and synthetic Chromium camera acquisition',checks,
    shellBytes:Object.keys(PARTICIPANT_SHELL_SOURCES).reduce((sum,key)=>sum+assets.get(key).length,0),
    requests:service.journal,screenshots:output,screenshotFiles:screenshots,real_accounts_created:false,
    backend_service_tested:false,mailbox_delivery_tested:false,synthetic_browser_camera_used:true,
    physical_camera_tested:false,real_identity_data_used:false,liveness_evaluated:false,android_device_tested:false};
  await writeFile(output+'/result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result,null,2));
} catch (error) {
  await page?.screenshot({path:output+'/failure.png',fullPage:true,
    mask:[page.locator('[data-secret],input[type="password"],#account-confirm-code,#recovery-contact-code,.code-slots,#sign-in-preview-code')]}).catch(()=>{});
  await writeFile(output+'/result.json',JSON.stringify({passed:false,checks,failure:error.stack || String(error),errors,unexpected,
    screenshots:output,real_accounts_created:false,backend_service_tested:false},null,2)+'\n',{flag:'wx'});
  throw error;
} finally { await context?.close(); await browser.close(); }
