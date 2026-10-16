// SPDX-License-Identifier: AGPL-3.0-only
// Explicit bounded source view and manual-claim validation; no automatic reads.
import {sha,digest} from './finite-codec.mjs';
import {immutableCopy} from './immutable-state.mjs';
import {preparedPilotReadDocuments} from './pilot-adapter.mjs';
import {PILOT_LIMITS} from './pilot-resources.mjs';
const point=(text,n)=>!(n>0&&n<text.length&&/[\uD800-\uDBFF]/u.test(text[n-1])&&/[\uDC00-\uDFFF]/u.test(text[n]));
export function createPilotReader(handle){
  const documents=preparedPilotReadDocuments(handle),scope=JSON.parse(documents.preparation_scope_manifest),descriptors=immutableCopy(Object.entries(documents).map(([kind,text])=>({kind,characters:text.length,sha256:sha(text),required:true}))),documentHashes=new Map(descriptors.map(doc=>[doc.kind,doc.sha256]));
  const plan=immutableCopy({schema:'prototype-source-only-required-read-plan-v1',epoch_sha256:handle.epoch.sha256,descriptor_sha256:digest(handle.descriptor),audit_id:handle.descriptor.audit_id,source_kind:handle.descriptor.source_kind,documents:descriptors,maximum_complete_serialized_response_characters:PILOT_LIMITS.single_reader_response_characters,candidate_preparation_complete:scope.candidate_preparation_complete,raw_scope:scope.required_raw_scope,normalized_scope:scope.required_normalized_scope,actual_reading:false,dependency_completeness_verified:false,authority:'NONE'});
  function page({kind,cursor=0}={}){
    const text=documents[kind];if(typeof text!=='string'||!Number.isSafeInteger(cursor)||cursor<0||cursor>text.length||!point(text,cursor))throw new Error('Exact document and codepoint-safe cursor required');
    const build=end=>JSON.stringify({schema:'prototype-source-only-visible-page-v1',epoch_sha256:plan.epoch_sha256,audit_id:plan.audit_id,kind,document_sha256:documentHashes.get(kind),start:cursor,end,total_characters:text.length,text:text.slice(cursor,end),trailer:{page_id:sha(JSON.stringify([plan.descriptor_sha256,kind,cursor,end])).slice(0,32),literal_sha256:sha(text.slice(cursor,end)),next_cursor:end<text.length?end:null,terminal:end===text.length,manual_observation_required:true,actual_reading_recorded:false}});
    let low=cursor+1,high=Math.min(text.length,cursor+PILOT_LIMITS.single_reader_response_characters),best=cursor;
    while(low<=high){const middle=(low+high)>>>1,end=point(text,middle)?middle:middle-1;if(end<=cursor){low=middle+1;continue;}if(build(end).length<=PILOT_LIMITS.single_reader_response_characters){best=end;low=middle+1;}else high=middle-1;}
    if(best===cursor&&cursor<text.length)throw new Error('Required page cannot fit its metadata/literal codepoint; retained missing scope');const response=build(best);if(response.length>PILOT_LIMITS.single_reader_response_characters)throw new Error('Serialized response bound exceeded');return response;
  }
  /** A visible tool response and a manually authored journal remain necessary.
   * Hash/range validation cannot establish that an agent or person read text. */
  function validateManualClaims(journal){
    if(!journal||!/^[-a-f0-9]{36}$/u.test(journal.journal_id??'')||typeof journal.reviewer!=='string'||!journal.reviewer||!Array.isArray(journal.pages))throw new Error('New own-ID source-review journal required');
    const observed=new Map();for(const entry of journal.pages){if(typeof entry.tool_response_ref!=='string'||!entry.tool_response_ref||typeof entry.manual_note!=='string'||entry.manual_note.trim().length<10||entry.literal_trailer_seen!==true)throw new Error('Actual visible response reference/trailer and manual note required');const response=page({kind:entry.kind,cursor:entry.start}),parsed=JSON.parse(response);if(entry.end!==parsed.end||entry.response_sha256!==sha(response)||entry.page_id!==parsed.trailer.page_id)throw new Error('Manual claim does not bind the exact emitted page');if(!observed.has(entry.kind))observed.set(entry.kind,[]);observed.get(entry.kind).push([entry.start,entry.end]);}
    const missing=[];for(const doc of descriptors){const ranges=(observed.get(doc.kind)??[]).sort((a,b)=>a[0]-b[0]);let cursor=0;for(const [start,end] of ranges){if(start!==cursor)throw new Error('Journal duplicates or skips a required visible page');cursor=end;}if(cursor!==doc.characters||!ranges.length)missing.push({kind:doc.kind,start:cursor,end:doc.characters});}
    return immutableCopy({schema:'prototype-declared-read-scope-check-v1',journal_id:journal.journal_id,status:missing.length?'PARTIAL_DECLARED_SCOPE':scope.candidate_preparation_complete?'DECLARED_SCOPE_COMPLETE_NOT_READ_ATTESTED':'DECLARED_SCOPE_COMPLETE_PREPARATION_FAILED',missing_scope:missing,actual_reading_verified:false,scope_validation_only:true,candidate_preparation_complete:scope.candidate_preparation_complete,source_quality_passed:false,authority:'NONE'});
  }
  return Object.freeze({plan,page:Object.freeze(page),validateManualClaims:Object.freeze(validateManualClaims)});
}
