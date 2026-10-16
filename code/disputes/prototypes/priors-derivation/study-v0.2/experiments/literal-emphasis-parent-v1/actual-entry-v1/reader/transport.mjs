// SPDX-License-Identifier: AGPL-3.0-only
// Fixture-only transport example. Emits exactly one complete string, NO LF.
import {assertFictionalPermit} from '../admission.mjs';
import {LIMITS,fail,literalJSON} from './schema.mjs';
export function emitFixturePageResponse(serialized,{permit,root}={}){
  assertFictionalPermit(permit,root,{phase:'MANUAL_READER'});
  if(typeof serialized!=='string'||serialized.length>LIMITS.response_utf16||Buffer.byteLength(serialized)>LIMITS.response_bytes)fail('STORED_READER_TRANSPORT_BOUND');let value;try{value=JSON.parse(serialized);}catch{fail('STORED_READER_TRANSPORT_JSON');}
  if(value.schema!=='stored-pilot-literal-reader-response-v1'||!value.case_id?.startsWith('SYNTHETIC_')||value.actual_reading!==false||value.authority!=='NONE'||literalJSON(value)!==serialized)fail('STORED_READER_TRANSPORT_FORMAT');
  process.stdout.write(serialized); // Forward once. Never JSON.stringify again.
}
