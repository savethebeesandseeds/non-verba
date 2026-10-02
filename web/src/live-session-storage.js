// SPDX-License-Identifier: AGPL-3.0-only
// Dedicated requester vault and LOCAL ledger. No global uniqueness claim.
const opened=new Promise((resolve,reject)=>{const r=indexedDB.open('nonverba-live-sessions-v1',1);
  r.onupgradeneeded=()=>{for(const name of ['vault','sessions','challenges','outcomes','accepted'])r.result.createObjectStore(name);};
  r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result);};r.onerror=()=>reject(r.error);});
async function get(store,key){const db=await opened;return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function transaction(stores,work){const db=await opened;return new Promise((resolve,reject)=>{const tx=db.transaction(stores,'readwrite');try{work(tx);}catch(error){tx.abort();reject(error);return;}tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error||new Error('The local live-session ledger could not be saved.'));});}
async function decrypt(record){if(!record?.key||!record.iv||!record.bytes)throw new Error('The requester identity cannot be unlocked; identity rotation is not automatic.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv},record.key,record.bytes));}
let identityPromise;
export function loadRequesterIdentity(engine){
  identityPromise??=(async()=>{const existing=await get('vault','requester');if(existing)return decrypt(existing);
    const identity=await engine.call('create_identity'),key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
    const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(identity));
    try{await transaction(['vault'],tx=>tx.objectStore('vault').add({key,iv,bytes},'requester'));return identity;}
    catch(error){const winner=await get('vault','requester');if(winner)return decrypt(winner);throw error;}
  })();return identityPromise;
}
export async function reserveLiveSession(sessionId,challengeId,record){
  if(!/^[0-9a-f]{64}$/.test(sessionId)||!/^[0-9a-f]{64}$/.test(challengeId))throw new Error('Invalid live-session reservation.');
  await transaction(['sessions','challenges'],tx=>{tx.objectStore('sessions').add({...record,session_id:sessionId,challenge_id:challengeId},sessionId);tx.objectStore('challenges').add(sessionId,challengeId);});
}
export async function retainLiveOutcome(sessionId,record){await transaction(['outcomes'],tx=>tx.objectStore('outcomes').add(record,sessionId));}
export async function localLiveSession(sessionId){return get('sessions',sessionId);}
export async function localLiveOutcome(sessionId){return get('outcomes',sessionId);}
let verifierPromise;
function currentAcceptance(stillCurrent){if(typeof stillCurrent!=='function'||stillCurrent()!==true)throw new Error('The live-location acceptance context changed.');}
export async function acceptLiveSession(sessionId,stillCurrent=()=>true){
  currentAcceptance(stillCurrent);
  verifierPromise??=import('./core-client.js').then(module=>module.createCoreClient());
  const engine=await verifierPromise;
  const [session,outcome]=await Promise.all([localLiveSession(sessionId),localLiveOutcome(sessionId)]);
  const requester=await engine.json('live_requester_identity',await loadRequesterIdentity(engine));
  if(!session||outcome?.state!=='complete'||session.requester_pin!==requester.pin.sha256||outcome.request!==session.request)throw new Error('This requester has no complete original live reservation.');
  const report=await engine.json('verify_live_session_receipt',outcome.receipt,session.request,outcome.proof,
    requester.pin.sha256,JSON.stringify({type:'operator-location-spki-sha256',sha256:session.operator_pin}),Math.floor(Date.now()/1000));
  currentAcceptance(stillCurrent);
  if(!report.verified||!report.fresh_action_eligible||report.demo||report.request?.session_id!==sessionId
    ||report.request.location_request.challenge.id!==session.challenge_id)throw new Error('The retained raw evidence is invalid, expired or ineligible.');
  const sameBytes=(a,b)=>a instanceof Uint8Array&&b instanceof Uint8Array&&a.length===b.length&&a.every((v,i)=>v===b[i]);
  const db=await opened;return new Promise((resolve,reject)=>{let accepted,pending=2;
    const tx=db.transaction(['sessions','outcomes','accepted'],'readwrite'),s=tx.objectStore('sessions').get(sessionId),r=tx.objectStore('outcomes').get(sessionId);
    const ready=()=>{if(--pending)return;
      try{currentAcceptance(stillCurrent);}catch{tx.abort();return;}
      const current=r.result,at=Date.now();
      if(JSON.stringify(s.result)!==JSON.stringify(session)||current?.state!=='complete'||current.request!==outcome.request
        ||current.receipt!==outcome.receipt||!sameBytes(current.proof,outcome.proof)
        ||at<report.receipt.sealed_at_ms||at>=report.request.location_request.challenge.expires_at*1000){tx.abort();return;}
      accepted={session_id:sessionId,challenge_id:session.challenge_id,accepted_at_ms:at,artifact_sha256:report.receipt.artifact_binding.sha256};
      tx.objectStore('accepted').add(accepted,`session:${sessionId}`);tx.objectStore('accepted').add(accepted,`challenge:${session.challenge_id}`);};
    s.onsuccess=ready;r.onsuccess=ready;
    tx.oncomplete=()=>resolve(accepted);tx.onerror=tx.onabort=()=>reject(new Error('This request changed, expired, or was already accepted in this local ledger.'));
  });
}
