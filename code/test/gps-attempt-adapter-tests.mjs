// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readGpsAttemptExport, MAX_ATTEMPT_EXPORT} from '../../web/src/gps-attempt.js';
import {readLocationProofEnvelope} from '../../web/src/location-platform.js';
const record = {version:1,type:'nonverba-gps-attempt-export',attempt_id:'11111111-1111-4111-8111-111111111111',
  status:'signed',original_request_json:'{}',native_snapshot_json:null,report_base64:'AQID',error:null};
test('signed report has a separate export and never parses as a successful proof', () => {
  assert.deepEqual(readGpsAttemptExport(JSON.stringify(record)).bytes, new Uint8Array([1,2,3]));
  assert.throws(()=>readLocationProofEnvelope(JSON.stringify(record)));
  assert.throws(()=>readGpsAttemptExport(JSON.stringify({version:1,type:'nonverba-location-proof',proof_base64:'AQID'})));
});
test('unsigned pending, signing failure and storage failure remain explicitly unsigned',()=>{
  for(const status of ['unsigned-pending','unsigned-signing-failed','unsigned-storage-failed']) {
    const v = readGpsAttemptExport(JSON.stringify({...record,status,report_base64:null,native_snapshot_json:'{}',error:'Failure claim'}));
    assert.equal(v.bytes,undefined);
  }
  assert.deepEqual(readGpsAttemptExport(JSON.stringify({...record,status:'signed-storage-failed',error:'Save failed'})).bytes,new Uint8Array([1,2,3]));
});
test('shape, ids, bounds, unrecognized states and misleading mixed records fail closed',()=>{
  for(const v of [{...record,attempt_id:'../path'}, {...record,status:'success'}, {...record,report_base64:'%%%'} ,
    {...record,native_snapshot_json:'unsigned arbitrary claims'}, {...record,extra:true}, {...record,original_request_json:'x'.repeat(65537)},
    {...record,status:'unsigned-pending'}, {...record,error:'x'.repeat(401)}]) assert.throws(()=>readGpsAttemptExport(JSON.stringify(v)));
  assert.throws(()=>readGpsAttemptExport('x'.repeat(MAX_ATTEMPT_EXPORT+1)));
});
