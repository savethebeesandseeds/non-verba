// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const out=process.argv[2];
const core=await import(pathToFileURL('/workspace/web/dist/pkg/nonverba_core.js'));
await core.default({module_or_path:await readFile('/workspace/web/dist/pkg/nonverba_core_bg.wasm')});
const original=await readFile(`${out}/original.json`,'utf8');
const pin=await readFile(`${out}/jni-key.txt`,'utf8');
const envelope=JSON.parse(await readFile(`${out}/jni-report.json`,'utf8'));
const bytes=new Uint8Array(Buffer.from(envelope.report_base64,'base64'));
const verify=(b=bytes,r=original,p=pin)=>JSON.parse(core.verify_gps_attempt_report(b,r,p));
const positive=verify(); assert(positive.report_verified,JSON.stringify(positive.errors));
assert.equal(positive.successful_acceptance_eligible,false); assert.equal(positive.operator_effort_proven,false);
assert.equal(verify(bytes,original,'0'.repeat(64)).report_verified,false);
const substituted=JSON.parse(original);substituted.challenge.task='Different task';
assert.equal(verify(bytes,JSON.stringify(substituted)).report_verified,false);
const changed=bytes.slice(); changed[changed.length-1]^=1;
assert.equal(verify(changed).report_verified,false);
assert.equal(JSON.parse(core.verify_location_proof(bytes,original,pin,'null',2000000012)).verified,false);
const resultPath=`${out}/wasm-verification-${Date.now()}.json`;
await writeFile(resultPath,JSON.stringify({scope:'Synthetic JNI/JCA to production WASM; no physical collection or Keystore',passed:5,
  report_sha256:createHash('sha256').update(bytes).digest('hex'),positive},null,2));
await writeFile(`${out}/current-wasm-result.txt`,resultPath);
console.log('5 GPS JNI-to-WASM verification and success-separation checks passed');
