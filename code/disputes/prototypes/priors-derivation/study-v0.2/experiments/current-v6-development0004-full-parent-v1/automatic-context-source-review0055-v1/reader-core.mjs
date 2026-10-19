// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED. Pure checks and transport; no IO, tokenizer or judgment.
import {createHash} from 'node:crypto';
export const H=v=>createHash('sha256').update(v).digest('hex');
export const C=v=>Array.isArray(v)?'['+v.map(C).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+C(v[k])).join(',')+'}':JSON.stringify(v);
export const D=v=>H(C(v));
export const same=(a,b)=>C(a)===C(b);
export const check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});};
export const integer=(v,a=0,b=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
export const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
export const ID=Object.freeze({audit_id:'development-0055',contract_id:'contract-5e4763782d47aca7d67c',reviewer:'/root/actual_source_reader'});
export const METHOD='82a3dab1396336edccf77f27a7800cccddff67ca928e919e824a663e1d563601';
export const LIMITS=Object.freeze({phase_ms:1200000,operation_ms:60000,input_bytes:33554432,visible_and_capture_bytes:262144,artifact_bytes:16777216,source_copy_bytes:65536,heap_bytes:536870912,rss_bytes:1073741824,source_utf16:8500,stdout_utf16:8800,whole_tool_utf16:9000,wrapper_capture_reserve:2048,status_reserve_bytes:16384,start_input_reserve:6291456,operation_input_reserve:262144,max_operations:128,max_pages:60});
export const CLOSED_POOL_CARRY=Object.freeze({planning:39061,recount:158,elapsed_ms:475387.035676,output_bytes:14239376});
const R='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000';
export const RUN=R;
export const Q=R+'/qa/current-v6-0055-automatic-context-source-review-20261019-v1';
const ref=(name,sha256,bytes)=>Object.freeze({path:R+'/qa/'+name,sha256,bytes});
export const PINS=Object.freeze({
 result:ref('current-v6-0055-automatic-native-dictionary-windows-20261019-v1/result.json','18bcedcd1a468589b943bc0747c714acd6be2eae64db4dfd20728270e09f5313',5904),
 acceptance:ref('current-v6-0055-automatic-native-dictionary-windows-20261019-v1/ROOT-acceptance.json','8afee8c3c78d480853c5a3940e3a680a95c59e138d7f40e037ec42fae40c1c64',1626),
 model0:ref('current-v6-0055-automatic-native-dictionary-windows-20261019-v1/model-0-windows.json','837ae9b260536b7718577b2abc104abd7852b91d820e3ce377dce28892712f40',119386),
 model1:ref('current-v6-0055-automatic-native-dictionary-windows-20261019-v1/model-1-windows.json','4a3d7dae846c9fa329cb190fe062bd626ce69d040cf8bf3ed5b9d32582043a35',119402),
 selection:ref('current-v6-context-selector-ten-held-20261019-v2/development-0055-selection.json','d56df7a20b8316036b5e2441a7844ae2f46b941a650a8b22f2ca708c23c01747',14070),
 epoch:ref('current-v6-calibration-refresh-20261018-v1/source-epoch.json','1b33359ad35f7e14a1326d7de7748001f204e309bf6f54ddbec2a43178aadc16',6798),
 body:ref('current-v6-development-scope-qualification-20261018-v1/development-body-qualification.json','0aa99a615536dfffaf6d18614ecb95a1925a16610b1db7eb880359ca13993aa1',3816051),
 guard:ref('literal-emphasis-actualA-metadata-engineering-20261017-bound80-v8/execution/complete-fresh-guard.json','0a578b37ff01716daf9c4d68b8d446b5e79e2ffc36b22f55dd38e5f4428f2996',12856)
});
export function scalarText(s){check(typeof s==='string'&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s),'READER_UNPAIRED_SURROGATE');return s;}
export function exactRef(r){check(r&&Object.keys(r).sort().join('|')==='bytes|path|sha256'&&typeof r.path==='string'&&r.path.startsWith(R+'/')&&!r.path.includes('/../')&&!r.path.includes('/./')&&!/[\u0000-\u001f]/u.test(r.path)&&hash(r.sha256)&&integer(r.bytes,1,LIMITS.input_bytes),'READER_REF');return r;}
export function validateFreshGuard(g){
 const{projection_sha256,...body}=g;
 check(g.schema==='stored-reader-complete-fresh100-guard-v1'&&D(body)===projection_sha256&&Array.isArray(g.rows)&&g.rows.length===100&&Array.isArray(g.contract_ids)&&g.contract_ids.length===29&&g.rows.every(r=>typeof r.audit_id==='string'&&typeof r.contract_id==='string')&&new Set(g.rows.map(r=>r.audit_id)).size===100&&new Set(g.rows.map(r=>r.contract_id)).size===29&&same([...new Set(g.rows.map(r=>r.contract_id))].sort(),[...g.contract_ids].sort())&&!g.contract_ids.includes(ID.contract_id),'READER_FRESH100_CID29');return true;
}
/** Only metadata may be supplied here. No cache/native envelope is required. */
export function qualifyMetadata({body,epoch,guard,selection,result}){
 validateFreshGuard(guard);
 check(body.schema==='current-v6-body-prior-actual-scope-qualification-v1'&&body.source_sha256===METHOD&&body.rows?.length===200&&body.current_supporting_review_assembled===false&&body.materiality_holds_cleared===0&&body.new_actual_readings===0,'READER_BODY_METADATA');
 const rows=body.rows.filter(r=>r.audit_id===ID.audit_id);check(rows.length===1&&rows[0].contract_id===ID.contract_id,'READER_FIXED_ONE_CASE');
 const row=rows[0],p=row.current_v6_body_scope_qualification,raw=row.prior_qualification_unchanged?.source_scopes?.raw;
 check(p?.status==='EXACT_PRIOR_OBSERVATION_SCOPE_INPUTS_PRESERVED_CURRENT_V6'&&p.current_extraction_source_sha256===METHOD&&p.new_actual_reading===false&&p.current_supporting_review_ready===false&&p.quality_gate_pass===false&&raw?.sha256===p.raw_sha256&&hash(p.normalized_sha256),'READER_CURRENT_ROW');
 const raw_ref=exactRef({path:raw.path.startsWith('/')?raw.path:R+'/'+raw.path,sha256:raw.sha256,bytes:raw.bytes});
 check(raw_ref.bytes<=131072,'READER_RAW_BOUND');
 const{sha256,...sourceBody}=epoch.source??{};
 check(epoch.schema==='ROOT-current-method-frozen-extraction-source-v1'&&sha256===METHOD&&D(sourceBody)===sha256&&epoch.snapshot_code==='/tmp/nonverba-unified-source/4e609b88e04645d1892e9ee6724b28e1/code'&&epoch.source.files?.length===23,'READER_CURRENT_EPOCH');
 check(selection.schema==='automatic-literal-context-selection-v1'&&selection.status==='SELECTED_BOUNDED_PROVISIONAL_CONTEXT'&&selection.source?.normalized_sha256===p.normalized_sha256&&selection.focal?.start===13926&&selection.focal?.end===15707&&selection.attachments?.length===6&&selection.attached_characters===11408&&selection.prototype===true&&selection.adopted===false&&selection.authority==='NONE'&&selection.semantic_completeness_verified===false&&selection.quality_gate_pass===false,'READER_SELECTION');
 check(result.schema==='automatic-0055-native-dictionary-diagnostic-result-v1'&&result.status==='COMPLETE_TOKENIZATION_DIAGNOSTIC_NOT_ADEQUACY'&&result.audit_id===ID.audit_id&&result.source_sha256===METHOD&&result.actual_reading===false&&result.source_text_displayed===false&&result.model_inference===false&&result.semantic_completeness_verified===false&&result.materiality_holds_cleared===0&&result.quality_gate_pass===false&&result.authority==='NONE'&&result.model_outcomes?.length===2,'READER_CANDIDATE_RESULT');
 for(let i=0;i<2;i++){const m=result.model_outcomes[i];check(m.index===i&&m.status==='COMPLETE'&&m.nodes===7&&m.complete_nodes===7&&m.window_count===15&&same(m.plan_ref,PINS['model'+i]),'READER_CANDIDATE_PLAN_REF');}
 return {raw_ref,normalized_sha256:p.normalized_sha256,nodes:[{id:'focal',range:selection.focal},...selection.attachments.map(a=>({id:a.id,range:a.range}))]};
}
/** Validate every text, including generated dictionary definitions. Never decode,
 * replace, shorten, join different windows, or use coordinate fields as reading. */
export function extractWindows(prepared,binding,index){
 const a=prepared?.artifact,b=a?.input_binding,n=a?.native_artifact?.nodes;
 check(a?.schema==='automatic-context-native-dictionary-windows-v1'&&a.prototype===true&&a.adopted===false&&a.authority==='NONE'&&a.actual_reading===false&&a.semantic_completeness_verified===false&&a.model_inference===false&&a.quality_gate_pass===false&&a.input_sha256===D(b)&&same(b.selection_ref,PINS.selection)&&same(b.current_epoch_ref,PINS.epoch)&&b.current_source_sha256===METHOD&&b.raw_sha256===binding.raw_ref.sha256&&b.normalized_sha256===binding.normalized_sha256&&Array.isArray(n)&&n.length===7,'READER_PLAN_BINDING');
 const out=[];
 for(let j=0;j<n.length;j++){
  const node=n[j],expected=binding.nodes[j];
  check(node.status==='COMPLETE'&&node.declaration?.id===expected.id&&same(node.declaration.range,expected.range)&&Array.isArray(node.windows)&&node.windows.length>0,'READER_NODE_ORDER');
  for(let k=0;k<node.windows.length;k++){
   const w=node.windows[k],text=scalarText(w.text);
   check(text.length>0&&Buffer.byteLength(text)<=131072&&w.sha256===H(text)&&w.input_policy==='NATIVE_EMPTY_DICTIONARY_SELF_CONTAINED_WINDOW_V1_UNADOPTED'&&w.empty_native_dictionary?.encoded_text_sha256===w.sha256&&w.empty_native_dictionary.encoded_text_UTF8_bytes===Buffer.byteLength(text)&&integer(w.tokens,1,256),'READER_EXACT_WINDOW_TEXT');
   out.push({model:index,node_index:j,node_id:expected.id,window_index:k,text,sha256:H(text),tokens:w.tokens});
  }
 }
 check(out.length===15,'READER_EXACT15');return out;
}
export function compareModelTexts(a,b){
 check(Array.isArray(a)&&Array.isArray(b)&&a.length===15&&b.length===15,'READER_COMPARE_COUNT');
 const rows=a.map((x,i)=>({index:i,node_order_equal:x.node_index===b[i].node_index&&x.node_id===b[i].node_id&&x.window_index===b[i].window_index,UTF8_equal:Buffer.from(scalarText(x.text)).equals(Buffer.from(scalarText(b[i].text))),model0_sha256:H(x.text),model1_sha256:H(b[i].text)}));
 return {schema:'fixed0055-exact-model-input-text-comparison-v1',all15_exact_equal:rows.every(r=>r.node_order_equal&&r.UTF8_equal),rows,qualification_scope:'EXACT_ORDERED_TEXT_BYTES_ONLY_NOT_MODEL_SEMANTICS_OR_PLAN_JSON'};
}
export function prepareDocuments(raw,binding,models){
 scalarText(raw);check(raw.length===47662&&H(raw)===binding.raw_ref.sha256,'READER_COMPLETE_ORIGINAL_HTML');
 const comparison=compareModelTexts(models[0],models[1]);
 const documents=[{id:'raw-original-html',models:[],source_ref:binding.raw_ref,text:raw}];
 for(const index of(comparison.all15_exact_equal?[0]:[0,1]))for(const w of models[index])documents.push({id:'model'+index+'-node'+w.node_index+'-window'+w.window_index,models:comparison.all15_exact_equal?[0,1]:[index],source_ref:PINS['model'+index],text:w.text});
 for(const d of documents){d.sha256=H(d.text);d.utf16=d.text.length;d.bytes=Buffer.byteLength(d.text);}
 return {documents,comparison};
}
const safeEnd=(s,n)=>n>0&&n<s.length&&s.charCodeAt(n-1)>=0xd800&&s.charCodeAt(n-1)<=0xdbff&&s.charCodeAt(n)>=0xdc00&&s.charCodeAt(n)<=0xdfff?n-1:n;
export function renderPage(document,{global,page,start,end}){
 check(integer(global,1,LIMITS.max_pages)&&integer(page,1,LIMITS.max_pages)&&integer(start,0,document.text.length)&&integer(end,start+1,document.text.length)&&end-start<=LIMITS.source_utf16&&safeEnd(document.text,start)===start&&safeEnd(document.text,end)===end,'READER_PAGE_RANGE');
 const payload=document.text.slice(start,end),header={schema:'0055-exact-input-source-page-v1',global,document:document.id,models:document.models,page,utf16:[start,end],full_utf16:document.text.length,full_sha256:document.sha256,payload_sha256:H(payload)};
 const response=JSON.stringify(header)+'\n'+payload+'\n';check(response.length<=LIMITS.stdout_utf16,'READER_PAGE_RESPONSE_BOUND');return response;
}
export function paginateDocuments(documents){
 const pages=[];
 for(let di=0;di<documents.length;di++){
  const doc=documents[di];scalarText(doc.text);check(doc.sha256===H(doc.text)&&doc.text.length>0,'READER_DOCUMENT_IDENTITY');let start=0,page=0;
  while(start<doc.text.length){
   let end=safeEnd(doc.text,Math.min(start+LIMITS.source_utf16,doc.text.length)),response;
   for(;;){try{response=renderPage(doc,{global:pages.length+1,page:page+1,start,end});break;}catch(e){if(e.code!=='READER_PAGE_RESPONSE_BOUND')throw e;end=safeEnd(doc.text,end-1);check(end>start,'READER_ENVELOPE_NO_PROGRESS');}}
   pages.push({global:pages.length+1,document_index:di,page:++page,start,end,sha256:H(response),bytes:Buffer.byteLength(response),utf16:response.length});start=end;
  }
 }
 check(pages.length<=LIMITS.max_pages,'READER_PAGE_COUNT');
 const charged=LIMITS.status_reserve_bytes+pages.reduce((n,p)=>n+2*p.bytes+LIMITS.wrapper_capture_reserve,0);
 check(charged<=LIMITS.visible_and_capture_bytes,'READER_TOTAL_VISIBLE_CAPTURE');
 return {pages,visible_capture_charge:charged};
}
/** Observed-tool facts are a separate reader-authored declaration. Machine
 * equality proves bytes/order, never that the agent actually attended to text. */
export function validateObservation(v,p,usedChunks=[]){
 const keys=['reader','page','output_sha256','output_bytes','output_utf16','whole_tool_utf16','whole_tool_utf8_bytes','tool_call_id','chunk_id','complete_forwarded_response_observed','truncation_observed','stdout_exact_prepared','affirmation'];
 check(v&&same(Object.keys(v).sort(),keys.sort())&&v.reader===ID.reviewer&&v.page===p.global&&v.output_sha256===p.sha256&&v.output_bytes===p.bytes&&v.output_utf16===p.utf16&&integer(v.whole_tool_utf16,p.utf16,LIMITS.whole_tool_utf16)&&integer(v.whole_tool_utf8_bytes,p.bytes,p.bytes+LIMITS.wrapper_capture_reserve)&&v.complete_forwarded_response_observed===true&&v.truncation_observed===false&&v.stdout_exact_prepared===true&&v.affirmation==='ACTUALLY_READ_THIS_COMPLETE_PAGE'&&typeof v.tool_call_id==='string'&&/^[A-Za-z0-9_./:-]{1,160}$/u.test(v.tool_call_id)&&typeof v.chunk_id==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/u.test(v.chunk_id)&&!usedChunks.includes(v.chunk_id),'READER_OBSERVED_DECLARATION');return true;
}
export function forwardState(emissions,acks,total){
 check(Array.isArray(emissions)&&Array.isArray(acks)&&integer(total,1,LIMITS.max_pages)&&emissions.length===total&&acks.length===total,'READER_STATE_SHAPE');let acknowledged=0,pending=null;
 for(let i=0;i<total;i++){check(typeof emissions[i]==='boolean'&&typeof acks[i]==='boolean'&&(!acks[i]||emissions[i]),'READER_ACK_WITHOUT_EMISSION');if(emissions[i]){check(pending===null&&i===acknowledged,'READER_FORWARD_GAP');if(acks[i])acknowledged++;else pending=i+1;}else check(!emissions.slice(i+1).some(Boolean)&&!acks.slice(i+1).some(Boolean),'READER_FORWARD_GAP');}
 return {acknowledged,pending,complete:acknowledged===total};
}
