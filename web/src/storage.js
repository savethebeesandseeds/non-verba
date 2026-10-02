// SPDX-License-Identifier: AGPL-3.0-only
const database = new Promise((resolve,reject) => {
  const request = indexedDB.open('nonverba-camera-v1',2);
  request.onupgradeneeded=()=> {for(const name of ['vault','requests','accepted','captures']) if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
});
export async function read(store,key) {
  const db=await database;
  return new Promise((resolve,reject)=>{const request=db.transaction(store).objectStore(store).get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
export async function write(store,key,value) {
  const db=await database;
  return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Storage transaction aborted'));});
}
export async function values(store) {
  const db=await database;
  return new Promise((resolve,reject)=>{const request=db.transaction(store).objectStore(store).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
export class AcceptanceClockChanged extends Error {}
export async function acceptOnce(challengeId,record,{issuedAt,expiresAt,verifiedAt,isCurrent}) {
  if(!Number.isSafeInteger(issuedAt)||!Number.isSafeInteger(expiresAt)||!Number.isSafeInteger(verifiedAt)||issuedAt<0||expiresAt<=issuedAt||typeof isCurrent!=='function')throw new Error('A bounded original request, verification time and current-input guard are required for acceptance.');
  const db=await database;
  return new Promise((resolve,reject)=> {
    let accepted,failure;
    const tx=db.transaction('accepted','readwrite'),store=tx.objectStore('accepted');
    // add(), rather than put(), makes simultaneous accepts across tabs atomic.
    // A request event runs only once a previously queued write transaction has
    // released the store; check time and UI authority here, not before queuing.
    const ready=store.get(challengeId);
    ready.onsuccess=()=>{try{
      const at=Math.floor(Date.now()/1000);
      if(!isCurrent())throw new Error('The verification inputs changed before the acceptance transaction.');
      if(at<issuedAt||at>=expiresAt)throw new Error('The request window closed before acceptance could be saved.');
      if(at!==verifiedAt)throw new AcceptanceClockChanged('The verification clock changed before acceptance; verify again.');
      accepted={...record,accepted_at:at};store.add(accepted,challengeId);
    }catch(error){failure=error;tx.abort();}};
    tx.oncomplete=()=>resolve(accepted);
    tx.onerror=()=>reject(new Error('This challenge was already accepted on this device.'));
    tx.onabort=()=>reject(failure||new Error('Acceptance could not be saved, or this challenge was already accepted.'));
  });
}
export async function reserveCapture(challengeId,record) {
  const db=await database;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('captures','readwrite');
    tx.objectStore('captures').add(record,challengeId);
    tx.oncomplete=()=>resolve();
    tx.onerror=tx.onabort=()=>reject(new Error('This challenge was already used for a capture on this device. Request a fresh challenge.'));
  });
}
export async function loadIdentity() {
  if(window.NativeVault) {
    const identity=window.NativeVault.loadIdentity();
    const failure=window.NativeVault.lastError();
    if(failure) throw new Error(failure);
    return identity || null;
  }
  const envelope=await read('vault','identity');
  if(!envelope) return null;
  const key=await read('vault','wrapping-key');
  if(!key) throw new Error('The stored identity cannot be unlocked. Use a different browser profile to create a new identity.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:envelope.iv},key,envelope.ciphertext));
}
export async function saveIdentity(identity) {
  if(window.NativeVault) {if(!window.NativeVault.saveIdentity(identity)) throw new Error('Android could not securely save this signing identity.');return;}
  let key=await read('vault','wrapping-key');
  if(!key){key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);await write('vault','wrapping-key',key);}
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(identity));
  await write('vault','identity',{iv,ciphertext});
}
