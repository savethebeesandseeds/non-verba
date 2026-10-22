// SPDX-License-Identifier: AGPL-3.0-only
// Explicit local development acceptance. It creates one retained synthetic
// account. Explicit --mock-mail uses only its operation-bound synthetic inbox;
// otherwise an operator supplies its two private test challenges.
import assert from 'node:assert/strict';
import {mkdir, writeFile, readFile, lstat, unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createServiceAccountAdapter, passwordStrength} from '../../../web/apps/non-verba/src/onboarding-account.js';
import {createDeviceAttestationTool} from '../../../web/shared/identity/device-attestation.js';

assert.equal(process.platform, 'linux');
assert.equal(process.env.NONVERBA_CONTAINER, '1');
assert.match(process.argv[2] || '', /^[a-zA-Z0-9_-]{1,64}$/);
const flags = new Set(process.argv.slice(3));
assert.equal(flags.size,process.argv.length-3);
assert.ok([...flags].every(flag=>['--mock-mail','--delete-recreate','--minimum-password'].includes(flag)));
const useMock = flags.has('--mock-mail'), deleteRecreate = flags.has('--delete-recreate');
const minimumPassword = flags.has('--minimum-password');
assert.ok(!deleteRecreate || useMock,'Deletion acceptance is restricted to this owned mock test account.');
assert.ok(!minimumPassword || useMock,'Minimum-password fixtures require the owned local mock workflow.');
function fixturePassword() {
  if (!minimumPassword) return crypto.randomUUID()+crypto.randomUUID();
  for (let attempt=0;attempt<8;attempt++) {
    const value = Buffer.from(crypto.getRandomValues(new Uint8Array(6))).toString('base64url');
    if (passwordStrength(value).acceptable) return value;
  }
  throw new Error('Could not prepare a non-pattern synthetic eight-character password.');
}
process.umask(0o077);
const output = resolve('artifacts/qa/participant-account-live-' + process.argv[2]);
await mkdir(output, {mode:0o700});
const checks = [];
let operationId, account, loseDeletionReply = false;
const request = async ({signal, ...request}) => {
  if (request.method === 'POST' && ['/v1/accounts/entry/start','/v1/accounts/enrollments','/v1/accounts/recovery/start'].includes(request.path)) {
    operationId = JSON.parse(request.body).operation_id;
  }
  const id = crypto.randomUUID();
  const response = await fetch('http://127.0.0.1:4173/account-api/transport', {
    method:'POST', headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:4173','X-Nonverba-Account':'1'},
    body:JSON.stringify({id,request}), signal:AbortSignal.any([signal || new AbortController().signal,AbortSignal.timeout(12000)]), redirect:'error'
  });
  assert.equal(response.status, 200);
  const value = await response.json(); assert.equal(value.id, id);
  if (request.path === '/v1/account/deletion' && loseDeletionReply) { loseDeletionReply = false; throw new Error('Owned test intentionally lost its committed deletion response.'); }
  return value.response;
};
async function challenge(purpose) {
  if (useMock) {
    assert.equal(account.snapshot().email_delivery,'mock');
    const value = await account.mockMail();
    checks.push(`operation-bound mock ${purpose} email; nothing sent`);
    return value;
  }
  // This transfer file is exclusively created by this invocation's operator.
  // Its token is consumed directly, never printed, reported or shown in a UI.
  await writeFile(output + '/' + purpose + '-request.json', JSON.stringify({purpose,operation_id:operationId}), {flag:'wx',mode:0o600});
  console.log(JSON.stringify({waiting:purpose,operation_id:operationId,private_directory:output}));
  const path = output + '/' + purpose + '-token';
  const deadline = Date.now() + 180000;
  while (true) {
    if (Date.now() > deadline) throw new Error('Private fixture challenge was not supplied; no application bypass attempted.');
    try {
      const info = await lstat(path);
      assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= 128 && (info.mode & 0o077) === 0);
      if (info.size < (purpose === 'entry' ? 8 : 43)) { await delay(250); continue; }
      const value = (await readFile(path,'utf8')).trim();
      assert.match(value,purpose === 'entry' ? /^[0-9a-f]{8}$/i : /^[A-Za-z0-9_-]{43}$/);
      await unlink(path); // Only this invocation's disposable transfer file.
      return value;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await delay(250);
  }
}
async function createAccount({email,password,username}) {
  await account.startEntry({email}); await account.confirmEntry({code:await challenge('entry')});
  assert.equal(account.snapshot().entry.step,'enrollment');
  const content = await account.terms();
  const terms = Object.fromEntries(['id','version','content_sha256'].map(key=>[key,content[key]]));
  await account.create({email,password,username,roles:['R','O'],terms,deliberate:true});
  checks.push('confirmed email ownership, unique username and versioned account terms bound to enrollment');
}
try {
  const email = `app-${crypto.randomUUID()}@example.invalid`;
  const password = fixturePassword(), nextPassword = fixturePassword();
  if (minimumPassword) { assert.equal([...password].length,8); assert.equal([...nextPassword].length,8); }
  // The same WebCrypto provider used in Chromium; no Android assurance claim.
  globalThis.window = new EventTarget();
  const device = createDeviceAttestationTool();
  account = createServiceAccountAdapter({request,device});
  await account.configure(); checks.push('actual pinned service discovery');
  await createAccount({email,password,username:'app_'+crypto.randomUUID().replaceAll('-','').slice(0,20)});
  assert.equal(account.snapshot().state,'pending_confirmation');
  await account.enrollmentStatus(); checks.push('actual enrollment and private status');
  await account.confirm({code:await challenge('enrollment'),deliberate:true});
  assert.equal(account.snapshot().state,'confirmed');
  const recoveryCode = account.recoveryCode(); assert.match(recoveryCode,/^[A-Za-z0-9_-]{43}$/);
  checks.push('actual deliberate confirmation creates no session');
  await account.signIn({email,password});
  assert.equal(account.snapshot().device_status,'unverified');
  let inventory = await account.devices();
  assert.equal(inventory.devices.length,1); assert.equal(inventory.devices[0].current,true);
  assert.equal(inventory.devices[0].attestation.status,'unverified');
  assert.equal(inventory.devices[0].platform,'browser');
  const other = createServiceAccountAdapter({request,device}); await other.signIn({email,password});
  inventory = await account.devices();
  assert.equal(inventory.devices.length,1,'Stable document key is one device across login sessions.');
  assert.equal(inventory.devices[0].active_sessions,2);
  const otherSession = inventory.devices[0].sessions.find(row=>!row.current);
  assert.ok(otherSession); await account.revokeSession(otherSession.session_id);
  await assert.rejects(other.getAccount());
  inventory = await account.devices(); assert.equal(inventory.devices[0].active_sessions,1);
  checks.push('real server nonce and WebCrypto possession proof; owner inventory groups sessions and revokes another session');
  const context = await account.getAccount(); assert.equal(context.identity_verification,'pending'); assert.equal(context.session.device_bound,false);
  checks.push('actual email PKCE, CSRF cookie, signed ID token and coherent unbound context');
  await account.signOut(); assert.equal(account.snapshot().session_outcome,'revoked');
  checks.push('actual explicit server sign-out');
  await account.startRecovery({email,recoveryCode}); await account.recoveryStatus();
  await account.recover({code:await challenge('recovery'),newPassword:nextPassword,deliberate:true});
  checks.push('actual recovery completion returned');
  assert.equal(account.snapshot().state,'signed_out'); assert.ok(account.recoveryCode());
  checks.push('recovery requires fresh login and reveals replacement code');
  await assert.rejects(account.signIn({email,password}));
  checks.push('old password refused after recovery');
  await account.signIn({email,password:nextPassword});
  checks.push('fresh login with new password succeeded');
  const recovered = await account.getAccount();
  assert.equal(recovered.account_id,context.account_id); assert.equal(recovered.recovery_generation,context.recovery_generation+1);
  assert.equal(recovered.identity_verification,'pending');
  if (deleteRecreate) {
    loseDeletionReply = true;
    await assert.rejects(account.deleteAccount({password:nextPassword,confirmEmail:email,deliberate:true}),error=>error.code === 'transport_unavailable');
    assert.equal(account.snapshot().deletion_pending,true);
    await account.deletionStatus(); assert.equal(account.snapshot().state,'deleted');
    checks.push('actual owned test deletion with lost reply resolved by original operation status');
    await assert.rejects(account.signIn({email,password:nextPassword}));
    const recreatedPassword = fixturePassword();
    await createAccount({email,password:recreatedPassword,username:'new_'+crypto.randomUUID().replaceAll('-','').slice(0,20)});
    await account.confirm({code:await challenge('enrollment'),deliberate:true}); assert.ok(account.recoveryCode());
    await account.signIn({email,password:recreatedPassword});
    const recreated = await account.getAccount();
    assert.notEqual(recreated.account_id,recovered.account_id); assert.notEqual(recreated.principal_id,recovered.principal_id);
    checks.push('same email recreates a new confirmed account and principal; old login stays invalid');
  }
  await account.signOut(); checks.push('actual two-factor recovery, old-password denial, fresh sign-in and generation change');
  if (minimumPassword) checks.push('exactly eight-character enrollment and replacement passwords succeeded through live authentication');
  const result = {passed:true,checks,scope:'one owned synthetic account through the live local relay and shared client',
    confirmation_transport:useMock ? 'operation_bound_mock' : 'private_operator_fixture',
    real_mail_delivered:false,identity_verified:false,media_uploaded:false,phone_tested:false};
  await writeFile(output+'/result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify(result));
} catch (error) {
  const result = {passed:false,checks,error_code:typeof error.code === 'string' ? error.code : 'live_account_check_failed',
    assertion_operator:typeof error.operator === 'string' ? error.operator : null,
    scope:'local synthetic application account check; private state preserved'};
  await writeFile(output+'/result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify(result)); process.exitCode = 1;
}
