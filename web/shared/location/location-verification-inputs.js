// SPDX-License-Identifier: AGPL-3.0-only
import {MAX_LOCATION_CONTEXT, locationContext} from './location-session-policy.js';
// Compare the exact verifier inputs after every asynchronous read/verification.
// DOM edits and a changed File selection cannot publish an older successful verdict.
export const LOCATION_VERIFIER_FIELDS = Object.freeze(['live-original-input','live-receipt-input',
  'live-verify-requester','live-verify-operator','live-verify-context','live-verify-format']);
export function retainLocationVerificationInputs(root) {
  const values=Object.freeze(Object.fromEntries(LOCATION_VERIFIER_FIELDS.map(id=>[id,root.getElementById(id).value])));
  const proof=root.getElementById('live-proof-file').files?.[0];
  return Object.freeze({values,proof,current:()=>LOCATION_VERIFIER_FIELDS.every(id=>root.getElementById(id).value===values[id])
    && root.getElementById('live-proof-file').files?.[0]===proof});
}
// A selected context file owns one generation. Finishing an older read cannot
// replace a later file, manual edit, pairing configuration or verification.
export function createLocationContextImporter() {
  let generation=0;
  return {start(file,stillCurrent) {
    const own=++generation,isLatest=()=>own===generation;
    const result=(async()=>{
      if(!file||!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_LOCATION_CONTEXT)throw new Error('Choose a context JSON file no larger than 4 MiB.');
      const bytes=await file.arrayBuffer();
      if(!isLatest()||!stillCurrent())throw new Error('Verifier context import was cancelled.');
      if(bytes.byteLength>MAX_LOCATION_CONTEXT)throw new Error('Verifier context file exceeds its limit.');
      return locationContext(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    })();
    return {isLatest,result};
  }};
}
