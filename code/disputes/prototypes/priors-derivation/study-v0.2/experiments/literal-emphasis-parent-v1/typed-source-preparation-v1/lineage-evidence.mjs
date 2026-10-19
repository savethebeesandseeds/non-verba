// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED. Inert diagnostics; no observer or authority connection.
export const LINEAGE_EVIDENCE_LIMITS=Object.freeze({tick_digits:32,held_code_characters:96,record_json_characters:2048,readout_json_characters:8192});
const MAX=Number.MAX_SAFE_INTEGER;
const type=value=>value===null?'null':typeof value;
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
const copy=value=>value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,copy(item)])):value;
const omitted=(kind,value)=>({kind,value:null,input_type:type(value)});

// Only the named own data property is inspected. Accessors are never invoked;
// messages, command lines, child lists and unrelated properties are not read.
function own(record,key){
  try{const d=Object.getOwnPropertyDescriptor(record,key);return !d?{kind:'MISSING',value:null}:Object.hasOwn(d,'value')?{kind:'DATA',value:d.value}:{kind:'ACCESSOR_OMITTED',value:null};}
  catch{return{kind:'DESCRIPTOR_UNKNOWN',value:null};}
}
function integerField(record,key){
  const d=own(record,key);if(d.kind!=='DATA')return d;
  return Number.isSafeInteger(d.value)?{kind:'RETAINED_SAFE_INTEGER',value:d.value}:omitted('INVALID_INTEGER_OMITTED',d.value);
}
function ticksField(record){
  const d=own(record,'start_ticks');if(d.kind!=='DATA')return d;
  return typeof d.value==='string'&&d.value.length<=32&&/^\d+$/.test(d.value)?{kind:'RETAINED_DIGITS',value:d.value}:omitted('INVALID_TICKS_OMITTED',d.value);
}
function observation(value){
  if(value===null)return{observation:'ABSENT',fields:null};
  if(value==='UNKNOWN')return{observation:'UNKNOWN',fields:null};
  if(!value||typeof value!=='object')return{observation:'INVALID_OBSERVATION',fields:null,input_type:type(value)};
  return{observation:'REPORTED_DATA_NOT_OWNERSHIP_PROOF',fields:{pid:integerField(value,'pid'),start_ticks:ticksField(value),group:integerField(value,'group'),ppid:integerField(value,'ppid')}};
}
function elapsed(value){return Number.isSafeInteger(value)?{kind:'RETAINED_SAFE_INTEGER',value}:omitted('INVALID_ELAPSED_OMITTED',value);}
function held(value){
  if(value===null)return{kind:'NO_EXISTING_HELD_CODE',value:null};
  return typeof value==='string'&&value.length<=96&&/^[A-Z][A-Z0-9_]*$/.test(value)?{kind:'RETAINED_CODE',value}:omitted('INVALID_HELD_CODE_OMITTED',value);
}

export function createLineageEvidenceRecorder(){
  let sequence=0,last=null,first=null,marksWithoutCandidate=0;
  const read=()=>freeze({schema:'inert-lineage-evidence-readout-v1',classification:'UNADMITTED',authority:'NONE',last_discovered_candidate:copy(last),first_held_lineage_candidate:copy(first),marks_without_candidate:marksWithoutCandidate});
  return Object.freeze({
    capture(candidate,expectedParent,observedParent,elapsedMs,heldAtCapture=null){
      const saturated=sequence===MAX;if(!saturated)sequence++;
      let row={schema:'inert-lineage-candidate-v1',classification:'UNADMITTED',authority:'NONE',sequence,sequence_saturated:saturated,elapsed_ms:elapsed(elapsedMs),held_at_capture:held(heldAtCapture),candidate:observation(candidate),expected_parent:observation(expectedParent),expected_parent_is_fresh_observation:false,observed_parent:observation(observedParent)};
      // Shape overflow is diagnostic data, never a new admission/ownership gate.
      // Retained strings are ASCII digits/codes; characters also bound UTF8 bytes.
      if(JSON.stringify(row).length>LINEAGE_EVIDENCE_LIMITS.record_json_characters)row={schema:'inert-lineage-candidate-v1',classification:'UNADMITTED',authority:'NONE',sequence,sequence_saturated:saturated,elapsed_ms:elapsed(elapsedMs),held_at_capture:held(heldAtCapture),diagnostic_shape:'BOUNDED_INVALID_SHAPE',candidate:{observation:'UNKNOWN',fields:null},expected_parent:{observation:'UNKNOWN',fields:null},expected_parent_is_fresh_observation:false,observed_parent:{observation:'UNKNOWN',fields:null}};
      last=freeze(row);return read();
    },
    markHeldLineage(){if(first===null&&last!==null)first=last;else if(last===null&&marksWithoutCandidate<MAX)marksWithoutCandidate++;return read();},
    read
  });
}
