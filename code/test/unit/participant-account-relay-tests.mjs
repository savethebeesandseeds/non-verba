// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer, request as httpRequest} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createParticipantAccountRelay, validateAccountTransport} from '../../tools/preview/participant-account-relay.mjs';

assert.equal(process.platform, 'linux', 'Run only inside non-verba-dev.');
assert.equal(process.env.NONVERBA_CONTAINER, '1', 'Run only inside non-verba-dev.');

const origin = 'http://127.0.0.1:4173', callback = 'http://127.0.0.1:8080/dev-callback';
const factor = n => Buffer.alloc(32, n).toString('base64url');
const clearCookie = 'nv_dev_oidc=; Path=/dev-oidc; HttpOnly; SameSite=Lax; Max-Age=0';
const cookie = n => `nv_dev_oidc=${factor(n)}; Path=/dev-oidc; HttpOnly; SameSite=Lax; Max-Age=300`;
const wire = request => ({id:randomUUID(), request});
const discovery = () => ({method:'GET', path:'/dev-oidc/.well-known/openid-configuration'});
function authorize(flow = factor(1)) {
  const query = new URLSearchParams({response_type:'code', client_id:'nonverba-dev-apk', redirect_uri:callback,
    scope:'openid', state:factor(2), nonce:factor(3), code_challenge:factor(4), code_challenge_method:'S256'});
  return {method:'GET', path:`/dev-oidc/authorize?${query}`, flow_id:flow};
}
function signin(flow = factor(1)) {
  return {method:'POST', path:'/dev-oidc/authorize', flow_id:flow,
    headers:{'content-type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({
      authorization_id:factor(5), csrf:factor(6), email:'relay-fixture@example.invalid', password:'synthetic fixture password'
    }).toString()};
}
const json = path => ({method:'POST', path, headers:{'content-type':'application/json'}, body:'{}'});
const upstream = (body = '{}', status = 200, headers = {'content-type':'application/json'}) => ({status,headers,body});
const authorizationPage = n => upstream('<form>synthetic page</form>', 200,
  {'content-type':'text/html', 'set-cookie':[cookie(n)]});
const accepted = () => upstream('', 303, {'set-cookie':[clearCookie], location:`${callback}?${new URLSearchParams({code:factor(7),state:factor(2)})}`});

test('device proof is a closed authenticated path with its own attestation budget', async t => {
  const headers = {'content-type':'application/json',authorization:'Bearer owned-session'};
  const challenge = {method:'POST',path:'/v1/account/signin-devices/challenge',headers,
    body:JSON.stringify({operation_id:'signin-device:'+factor(10),platform:'android',name:'Android device'})};
  assert.equal(validateAccountTransport(wire(challenge)).path,challenge.path);
  const proof = {method:'POST',path:'/v1/account/signin-devices/prove',headers,body:JSON.stringify({challenge_id:'challenge:test',
    public_spki_der_b64:Buffer.alloc(91).toString('base64'),signature_b64:Buffer.alloc(64).toString('base64'),
    attestation_chain:{version:1,certificates_der_b64:[Buffer.alloc(16384).toString('base64'),Buffer.alloc(16384).toString('base64')]}})};
  assert.ok(Buffer.byteLength(proof.body)>16*1024); validateAccountTransport(wire(proof));
  for (const value of [{...proof,headers:{'content-type':'application/json'}},
    {...proof,path:'/v1/accounts/enrollments'}, {...proof,path:'/v1/account/signin-devices/prove?other=true'},
    {...proof,body:JSON.stringify({...JSON.parse(proof.body),expected_policy:{trusted:true}})}])
    assert.throws(()=>validateAccountTransport(wire(value)));
  const send = await relay(t,{exchange:async ()=>upstream()});
  assert.equal((await send(wire(proof))).value.response.status,200);
});

async function relay(t, options = {}) {
  const handler = createParticipantAccountRelay({enabled:true, ...options});
  const server = createServer((request, response) => {
    handler(request, response).then(handled => {
      if (!handled) { response.writeHead(404); response.end(); }
    }).catch(() => { response.writeHead(500); response.end(); });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return (value, options = {}) => new Promise((resolve, reject) => {
    const body = options.raw ?? JSON.stringify(value);
    const request = httpRequest({hostname:'127.0.0.1', port:server.address().port,
      path:options.path ?? '/account-api/transport', method:options.method ?? 'POST', headers:{
        Host:'127.0.0.1:4173', Origin:origin, 'X-Nonverba-Account':'1', 'Content-Type':'application/json',
        ...(body === undefined ? {} : {'Content-Length':Buffer.byteLength(body)}), ...options.headers}}, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({status:response.statusCode, headers:response.headers, text, value:text ? JSON.parse(text) : null});
      });
    });
    request.on('error', reject); request.end(body);
  });
}
const refused = result => {
  assert.equal(result.status, 200);
  assert.equal(result.value.response.status, 502);
  assert.equal(result.value.response.body, '{"error":"account_transport_refused"}');
};

test('account entry allows one canonical email or username selector with exact operation binding', () => {
  const binding = {operation_id:'entry:'+factor(12),operation_secret:factor(13)};
  const start = {method:'POST',path:'/v1/accounts/entry/start',headers:{'content-type':'application/json'},
    body:JSON.stringify({...binding,email:'person@example.invalid'})};
  const confirm = {...start,path:'/v1/accounts/entry/confirm',body:JSON.stringify({...binding,confirmation_token:'A1B2C3D4'})};
  assert.equal(validateAccountTransport(wire(start)).path,start.path);
  const username = {...start,body:JSON.stringify({...binding,username:'person_12'})};
  assert.equal(validateAccountTransport(wire(username)).body,username.body);
  assert.equal(validateAccountTransport(wire(confirm)).path,confirm.path);
  for (const input of [{...start,headers:{...start.headers,authorization:'Bearer unexpected'}},
    {...start,body:JSON.stringify({...binding,email:'person@example.invalid',username:'person_12'})},
    {...start,body:JSON.stringify(binding)},
    {...start,body:JSON.stringify({...binding,username:null})},
    ...['@person','PERSON','12person','person-name','ab','a'.repeat(31)].map(username=>({...start,body:JSON.stringify({...binding,username})})),
    {...start,body:JSON.stringify({...binding,email:'person@example.invalid',account_id:'caller-selected'})},
    {...confirm,body:JSON.stringify({...binding,confirmation_token:'A1B2C3D4',next_step:'enrollment'})},
    {...start,body:JSON.stringify({...binding,email:'person@example.invalid',operation_id:'enroll:'+factor(12)})},
    {...start,body:JSON.stringify({...binding,email:'person@example.invalid',operation_secret:'x'.repeat(43)})},
    {...confirm,body:JSON.stringify({...binding,confirmation_token:'x'.repeat(43)})},
    {...start,body:JSON.stringify({...binding,email:'person@example.invalid\r\nInjected'})},
    {...start,path:'/v1/accounts/entry/start?email=person@example.invalid'},
    {...start,method:'GET',body:undefined}, {...confirm,method:'DELETE'},
    {...start,path:'/v1/accounts/entry/lookup'}]) assert.throws(()=>validateAccountTransport(wire(input)));
});

test('account terms expose one unauthenticated read without caller-selected versions or credentials', async t => {
  const terms = {method:'GET',path:'/v1/accounts/terms'};
  assert.equal(validateAccountTransport(wire(terms)).path,terms.path);
  for (const input of [{...terms,method:'POST',body:'{}'}, {...terms,body:''},
    {...terms,path:'/v1/accounts/terms?version=previous'}, {...terms,flow_id:factor(1)},
    {...terms,headers:{authorization:'Bearer unexpected'}}, {...terms,headers:{'content-type':'application/json'}}])
    assert.throws(()=>validateAccountTransport(wire(input)));
  const observed = [], send = await relay(t,{exchange:async request=>{observed.push(request);return upstream('{"terms":{},"content_sha256":"fixture"}');}});
  assert.equal((await send(wire(terms))).value.response.status,200);
  assert.equal(observed.length,1); assert.equal(observed[0].path,terms.path);
});

test('test account deletion requires bearer and exact reviewed body while status uses only its operation secret', () => {
  const binding = {operation_id:'delete:'+factor(12),operation_secret:factor(13)};
  const deleting = {method:'POST',path:'/v1/account/deletion',headers:{'content-type':'application/json',authorization:'Bearer current-test-token'},
    body:JSON.stringify({...binding,password:'current-fixture-password',confirm_email:'person@example.invalid',deliberate:true})};
  assert.equal(validateAccountTransport(wire(deleting)).path,deleting.path);
  const status = {method:'POST',path:'/v1/account/deletion/status',headers:{'content-type':'application/json'},body:JSON.stringify(binding)};
  assert.equal(validateAccountTransport(wire(status)).path,status.path);
  for (const request of [{...deleting,headers:{'content-type':'application/json'}},
    {...status,headers:{...status.headers,authorization:'Bearer should-not-be-here'}},
    {...deleting,body:JSON.stringify({...binding,password:'current-fixture-password',confirm_email:'person@example.invalid',deliberate:false})},
    {...status,body:JSON.stringify({...binding,account_id:'caller-chosen-account'})},
    {...status,path:'/v1/account/deletion/status?operation=caller'},
    {...status,method:'GET',body:undefined}, {...deleting,method:'DELETE'}]) {
    assert.throws(()=>validateAccountTransport(wire(request)));
  }
});

test('actual client encoded authorize query and lowercase headers fit the closed contract', () => {
  assert.match(authorize().path, /redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A8080%2Fdev-callback/);
  assert.equal(validateAccountTransport(wire(authorize())).path, authorize().path);
  assert.equal(validateAccountTransport(wire(signin())).headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(validateAccountTransport(wire({method:'GET', path:'/v1/account/context',
    headers:{authorization:'Bearer synthetic.token'}})).headers.Authorization, 'Bearer synthetic.token');
  assert.equal(validateAccountTransport(wire(json('/v1/accounts/enrollments'))).headers['Content-Type'], 'application/json');
  const token = {method:'POST', path:'/dev-oidc/token', headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'authorization_code',client_id:'nonverba-dev-apk',code:factor(7),
      redirect_uri:callback,code_verifier:factor(8)}).toString()};
  assert.equal(validateAccountTransport(wire(token)).path, '/dev-oidc/token');
  token.body = new URLSearchParams({grant_type:'refresh_token',client_id:'nonverba-dev-apk',refresh_token:factor(9)}).toString();
  assert.equal(validateAccountTransport(wire(token)).path, '/dev-oidc/token');
});

test('password authorize accepts exactly one public username, email or legacy selector without opening lookup paths', () => {
  const template = signin(), original = Object.fromEntries(new URLSearchParams(template.body));
  const {email,...required} = original;
  for (const selector of [{email},{account_username:'person_12'},{username:'opaque:legacy'}]) {
    const request = {...template,body:new URLSearchParams({...required,...selector}).toString()};
    assert.equal(validateAccountTransport(wire(request)).body,request.body);
  }
  for (const selector of [{},{email,account_username:'person_12'},{username:'opaque:legacy',account_username:'person_12'},
    {email,username:'opaque:legacy'},{email,username:'opaque:legacy',account_username:'person_12'},
    ...['@person','PERSON','ab','1person','person-name','person@example.test','a'.repeat(31)].map(account_username=>({account_username}))]) {
    const request = {...template,body:new URLSearchParams({...required,...selector}).toString()};
    assert.throws(()=>validateAccountTransport(wire(request)));
  }
  for (const path of ['/v1/accounts/lookup','/v1/accounts/username','/dev-oidc/username?value=person_12'])
    assert.throws(()=>validateAccountTransport(wire({method:'GET',path})));
});

test('live feedback exposes only exact readiness and authenticated device reads', async t => {
  const readiness = {method:'GET',path:'/readyz'};
  const inventory = {method:'GET',path:'/v1/account/devices',headers:{authorization:'Bearer owned-session'}};
  assert.equal(validateAccountTransport(wire(readiness)).path,'/readyz');
  assert.equal(validateAccountTransport(wire(inventory)).headers.Authorization,'Bearer owned-session');
  for (const request of [{...readiness,headers:{authorization:'Bearer unexpected'}},
    {...inventory,headers:{}}, {...inventory,path:'/v1/account/devices?account_id=other'},
    {...readiness,path:'/readyz?full=true'}, {...inventory,method:'POST',body:'{}'},
    {...readiness,method:'DELETE'}, {...inventory,body:''}, {...inventory,flow_id:factor(1)},
    {...inventory,headers:{...inventory.headers,'content-type':'application/json'}}]) {
    assert.throws(()=>validateAccountTransport(wire(request)));
  }
  const observed = [], send = await relay(t,{exchange:async input=>{
    observed.push(input); return upstream('{"status":"unavailable"}',503);
  }});
  for (const input of [readiness,inventory]) {
    const result = await send(wire(input));
    assert.equal(result.value.response.status,503,'Readiness failure is returned without broadening upstream access.');
  }
  assert.deepEqual(observed.map(input=>input.path),['/readyz','/v1/account/devices']);
  assert.equal(observed[0].headers.Authorization,undefined);
  assert.equal(observed[1].headers.Authorization,'Bearer owned-session');
});

test('default disabled config and explicit origin boundary cause no upstream calls', async t => {
  let calls = 0;
  const disabled = await relay(t, {enabled:false, exchange:async () => { calls++; return upstream(); }});
  assert.deepEqual((await disabled(undefined, {path:'/account-api/config',method:'GET'})).value,
    {enabled:false,development_only:true});
  assert.equal((await disabled(wire(discovery()))).status, 404);
  const send = await relay(t, {exchange:async () => { calls++; return upstream(); }});
  for (const headers of [{Host:'localhost:4173'}, {Origin:'http://localhost:4173'}, {Origin:''},
    {'X-Nonverba-Account':''}, {'Content-Type':'text/plain'}, {'Sec-Fetch-Site':'cross-site'}]) {
    const result = await send(wire(discovery()), {headers});
    assert.equal(result.status, 403);
    assert.equal(result.headers['access-control-allow-origin'], undefined);
    assert.equal(result.headers['cache-control'], 'no-store');
  }
  assert.equal((await send(undefined, {path:'/account-api/config',method:'GET',headers:{Host:'example.invalid:4173'}})).status,403);
  assert.equal(calls, 0);
});

test('rejects arbitrary egress, paths, duplicate fields, headers and methods before dispatch', async t => {
  let calls = 0;
  const send = await relay(t, {exchange:async () => { calls++; return upstream(); }});
  const invalid = [
    {...discovery(), path:'http://example.invalid/'}, {...discovery(), path:'//example.invalid/'},
    {...discovery(), path:'/dev-oidc/../v1/account/context'}, {...discovery(), path:'/dev-oidc/%2e%2e/jwks'},
    {...discovery(), path:'/dev-oidc/jwks#state'}, {...discovery(), path:'/dev-oidc/jwks?extra=1'},
    {...discovery(), method:'PUT'}, {...discovery(), headers:{Cookie:'nv_dev_oidc=untrusted'}},
    {...discovery(), headers:{Host:'example.invalid'}}, {...discovery(), headers:{Authorization:'Bearer unexpected'}},
    {...json('/v1/accounts/enrollments'), headers:{'content-type':'application/json','Content-Type':'application/json'}},
    {...json('/v1/accounts/enrollments'), headers:{'content-type':'application/json\r\nHost: bad'}},
    {...json('/v1/accounts/enrollments'), body:'[]'}, json('/v1/admin/accounts'),
    {...authorize(), path:authorize().path+'&state=duplicate'},
    {...authorize(), flow_id:'x'.repeat(43)}, {...signin(), body:signin().body+'&extra=value'},
    {method:'DELETE',path:'/v1/auth/session'}, {method:'GET',path:'/v1/account/context'},
    {...json('/v1/accounts/enrollments'), flow_id:factor(1)}
  ];
  for (const request of invalid) refused(await send(wire(request)));
  assert.equal(calls,0);
});

test('cookie jar isolates authorize flows, rewrites Origin only for login and is one use', async t => {
  const observed = [];
  const send = await relay(t, {exchange:async input => {
    observed.push(input);
    return input.method === 'GET' && input.path.startsWith('/dev-oidc/authorize?')
      ? authorizationPage(input.flow_id === factor(1) ? 11 : 12) : accepted();
  }});
  const first = await send(wire(authorize()));
  assert.equal(first.value.response.headers['set-cookie'], undefined);
  assert.equal(first.headers['set-cookie'], undefined);
  await send(wire(authorize(factor(10))));
  const login = await send(wire(signin(factor(10))));
  assert.equal(login.value.response.status,303);
  assert.equal(observed[2].headers.Cookie, 'nv_dev_oidc='+factor(12));
  assert.equal(observed[2].headers.Origin, 'http://127.0.0.1:8080');
  assert.equal(observed[0].headers.Cookie, undefined);
  assert.equal(observed[0].headers.Origin, undefined);
  refused(await send(wire(signin(factor(10)))));
  await send(wire(signin()));
  assert.equal(observed[3].headers.Cookie, 'nv_dev_oidc='+factor(11));
  assert.equal(observed.length,4);
});

test('failed or invalid authorization attempts consume the flow; expired and duplicate flows fail closed', async t => {
  let clock = 0, calls = 0, rejectPost = true;
  const send = await relay(t, {now:() => clock, exchange:async input => {
    calls++;
    if (input.method === 'GET') return authorizationPage(11);
    if (rejectPost) throw new Error('upstream secret must never appear');
    return accepted();
  }});
  await send(wire(authorize()));
  refused(await send(wire(authorize())));
  assert.equal(calls,1);
  refused(await send(wire(signin())));
  refused(await send(wire(signin())));
  assert.equal(calls,2);
  await send(wire(authorize(factor(10))));
  refused(await send(wire({...signin(factor(10)), headers:{'content-type':'wrong'}})));
  rejectPost = false;
  refused(await send(wire(signin(factor(10)))));
  assert.equal(calls,3);
  await send(wire(authorize(factor(13)))); clock += 300000;
  refused(await send(wire(signin(factor(13)))));
  assert.equal(calls,4);
});

test('authorization cookie capacity is bounded and a consumed flow frees its slot', async t => {
  let calls = 0;
  const send = await relay(t,{exchange:async input => {
    calls++; return input.method === 'GET' ? authorizationPage(11) : accepted();
  }});
  for (let n = 0; n < 64; n++) assert.equal((await send(wire(authorize(factor(n))))).value.response.status,200);
  refused(await send(wire(authorize(factor(64))))); assert.equal(calls,64);
  assert.equal((await send(wire(signin(factor(0))))).value.response.status,303);
  assert.equal((await send(wire(authorize(factor(64))))).value.response.status,200);
  assert.equal(calls,66);
});

test('rejects unexpected cookies and redirects without exposing upstream data or following them', async t => {
  for (const response of [upstream('private detail',200,{'set-cookie':['unexpected=secret']}),
    upstream('private detail',302,{location:'http://example.invalid/'}),
    upstream('private detail',303,{location:callback+'?code='+factor(7)+'&state='+factor(2)})]) {
    const send = await relay(t,{exchange:async () => response});
    const result = await send(wire(discovery())); refused(result);
    assert.equal(result.text.includes('private detail'),false);
    assert.equal(result.value.response.headers.location,undefined);
  }
  for (const cookies of [undefined,[cookie(11),cookie(12)],['nv_dev_oidc='+factor(11)+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=300']]) {
    const send = await relay(t,{exchange:async () => upstream('',200,{'set-cookie':cookies})});
    refused(await send(wire(authorize())));
  }
  const send = await relay(t,{exchange:async input => input.method === 'GET' ? authorizationPage(11)
    : upstream('',303,{'set-cookie':[clearCookie],location:callback+'?code='+factor(7)+'&state='+factor(2)+'&extra=1'})});
  await send(wire(authorize())); refused(await send(wire(signin())));
});

test('only the current request carries its bearer; auth responses are no-store and expose closed headers', async t => {
  const seen = [];
  const send = await relay(t,{exchange:async input => { seen.push(input); return upstream('{}',200,
    {'content-type':'application/json','x-private-diagnostic':'secret','location':'http://example.invalid/'}); }});
  const input = wire({method:'GET',path:'/v1/account/context',headers:{authorization:'Bearer synthetic.token'}});
  const result = await send(input);
  assert.equal(result.value.id,input.id);
  assert.deepEqual(result.value.response.headers,{'content-type':'application/json'});
  assert.equal(result.headers['cache-control'],'no-store');
  await send(wire(discovery()));
  assert.equal(seen[0].headers.Authorization,'Bearer synthetic.token');
  assert.equal(seen[1].headers.Authorization,undefined);
  assert.equal(seen[1].headers.Cookie,undefined);
});

test('enforces request, raw response and serialized response limits', async t => {
  let calls = 0;
  const send = await relay(t,{exchange:async () => { calls++; return upstream('x'.repeat(65537)); }});
  refused(await send(wire(discovery())));
  const escaped = await relay(t,{exchange:async () => upstream('"'.repeat(33000))});
  refused(await escaped(wire(discovery())));
  // The input limit is on the complete UTF-8 wire, not only on a nested body.
  const large = JSON.stringify(wire({...json('/v1/accounts/enrollments'),body:JSON.stringify({text:'x'.repeat(16384)})}));
  try { refused(await send(undefined,{raw:large})); }
  catch (error) { assert.match(error.code ?? '',/^ECONNRESET$/); }
  assert.equal(calls,1);
});

test('bounds concurrency and releases all slots after work completes', async t => {
  const finish = [], started = [];
  let allStarted;
  const ready = new Promise(resolve => { allStarted = resolve; });
  const send = await relay(t,{exchange:input => new Promise(resolve => {
    started.push(input); finish.push(() => resolve(upstream())); if (started.length === 4) allStarted();
  })});
  const pending = Array.from({length:4}, () => send(wire(discovery())));
  await ready;
  assert.equal((await send(wire(discovery()))).status,429);
  finish.forEach(resolve => resolve());
  for (const result of await Promise.all(pending)) assert.equal(result.value.response.status,200);
  assert.equal(started.length,4);
});

test('times out bounded upstream work and enforces the one-minute request budget', async t => {
  let aborted = false;
  const timeout = await relay(t,{timeoutMs:20,exchange:(_input,{signal}) => new Promise((_resolve,reject) => {
    signal.addEventListener('abort',() => { aborted = true; reject(new Error('cancelled')); },{once:true});
  })});
  refused(await timeout(wire(discovery()))); assert.equal(aborted,true);
  let clock = 0, calls = 0;
  const send = await relay(t,{now:() => clock,exchange:async () => { calls++; return upstream(); }});
  for (let n = 0; n < 120; n++) assert.equal((await send(wire(discovery()))).status,200);
  assert.equal((await send(wire(discovery()))).status,429);
  assert.equal(calls,120); clock = 60000;
  assert.equal((await send(wire(discovery()))).status,200); assert.equal(calls,121);
});
