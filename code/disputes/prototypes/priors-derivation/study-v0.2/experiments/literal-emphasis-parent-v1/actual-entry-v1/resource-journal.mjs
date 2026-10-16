// SPDX-License-Identifier: AGPL-3.0-only
// Bounded numeric proof stream, distinct from private stdout/source pages.
import fs from 'node:fs';
import {join} from 'node:path';
import {digest,sha,integer,assessExecutionSample,EXECUTION_RESERVATION as R,fail} from '../pilot-execution-control.mjs';
import {assertFictionalPermit} from './admission.mjs';
import {checkedPriorCost} from './checkpoint.mjs';
export const JOURNAL_LIMITS=Object.freeze({max_bytes:8388608,max_records:4096,max_record_bytes:1024});
export function createFictionalResourceJournal(root,{permit,phase,source_epoch_sha256,prior_cost,limits=JOURNAL_LIMITS}={}){
  assertFictionalPermit(permit,root,{phase});if(!/^[a-f0-9]{64}$/u.test(source_epoch_sha256??'')||Object.keys(limits).some(k=>!Object.hasOwn(JOURNAL_LIMITS,k)))fail('ACTUAL_JOURNAL_SCOPE');
  for(const[k,cap]of Object.entries(JOURNAL_LIMITS))integer(limits[k],1,cap);const file=join(root,'guardian','resource-proof.jsonl'),directory=fs.lstatSync(join(root,'guardian'));if(!directory.isDirectory()||directory.isSymbolicLink())fail('ACTUAL_JOURNAL_LINKED_PARENT');
  const retainedPrior=checkedPriorCost(prior_cost),fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);let bytes=0,sequence=0,previous=null,closed=false,complete=false,lastKind=null;
  function append(kind,sample,{admission=false,case_id=null}={}){
    if(closed||typeof kind!=='string'||!/^[A-Z0-9_]{1,64}$/u.test(kind)||case_id!==null&&(typeof case_id!=='string'||!/^SYNTHETIC_[A-Za-z0-9_-]{1,120}$/u.test(case_id)))fail('ACTUAL_JOURNAL_RECORD_SCOPE');
    assessExecutionSample(sample,{admission}); // Includes original physical floor on EVERY row.
    const body={sequence,kind,phase,case_id,source_epoch_sha256,original_RUN_floor_bytes:R.run_at_reservation,original_growth_baseline_bytes:R.baseline,prior_cost:retainedPrior,sample,previous_sha256:previous};
    const record={...body,sha256:digest(body)},line=Buffer.from(JSON.stringify(record)+'\n');if(sequence>=limits.max_records||line.length>limits.max_record_bytes||bytes+line.length>limits.max_bytes)fail('ACTUAL_RESOURCE_JOURNAL_BOUND');
    let offset=0;while(offset<line.length){const written=fs.writeSync(fd,line,offset,line.length-offset);if(!written)fail('ACTUAL_RESOURCE_JOURNAL_WRITE');offset+=written;}bytes+=line.length;sequence++;previous=record.sha256;lastKind=kind;return record;
  }
  function finish({success=false}={}){if(success&&lastKind!=='FINAL_OUTPUT_READBACK')fail('ACTUAL_JOURNAL_TERMINAL_MISSING');if(!closed){fs.fsyncSync(fd);fs.closeSync(fd);closed=true;complete=success;}const encoded=fs.readFileSync(file);if(encoded.length!==bytes)fail('ACTUAL_RESOURCE_JOURNAL_BYTE_COUNT');return Object.freeze({path:file,sha256:sha(encoded),bytes,records:sequence,last_record_sha256:previous,complete,authority:'NONE'});}
  return Object.freeze({append,finish,snapshot:()=>Object.freeze({bytes,records:sequence,last_record_sha256:previous,closed,complete})});
}
export function verifyResourceJournal(bytes,{limits=JOURNAL_LIMITS,requireCompleteTerminal=false}={}){
  if(!Buffer.isBuffer(bytes)||bytes.length>limits.max_bytes||!bytes.length||bytes.at(-1)!==10)fail('ACTUAL_JOURNAL_INCOMPLETE_BYTES');const lines=bytes.toString('utf8').split('\n').slice(0,-1);if(lines.length>limits.max_records)fail('ACTUAL_RESOURCE_JOURNAL_BOUND');let previous=null,last=null;
  for(const[sequence,line]of lines.entries()){if(Buffer.byteLength(line+'\n')>limits.max_record_bytes)fail('ACTUAL_RESOURCE_JOURNAL_BOUND');let row;try{row=JSON.parse(line);}catch{fail('ACTUAL_JOURNAL_PARSE');}const{sha256,...body}=row;if(body.sequence!==sequence||body.previous_sha256!==previous||digest(body)!==sha256||body.original_RUN_floor_bytes!==R.run_at_reservation||body.original_growth_baseline_bytes!==R.baseline)fail('ACTUAL_JOURNAL_CHAIN');assessExecutionSample(body.sample);previous=sha256;last=body;}
  if(requireCompleteTerminal&&last?.kind!=='FINAL_OUTPUT_READBACK')fail('ACTUAL_JOURNAL_TERMINAL_MISSING');return Object.freeze({records:lines.length,last_sha256:previous,scope_validation_only:true,authority:'NONE'});
}
