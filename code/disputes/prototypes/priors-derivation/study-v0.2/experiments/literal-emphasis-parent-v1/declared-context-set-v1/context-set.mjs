// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED. Plain supplied declarations; no IO or runtime representation.
import {createHash} from 'node:crypto';
export const LIMITS=Object.freeze({source_utf16:2097152,attachments:32,output_bytes:262144});
const H=s=>createHash('sha256').update(s).digest('hex'),J=v=>JSON.stringify(v,null,2)+'\n';
const fail=(code='DECLARED_CONTEXT_INPUT')=>{throw Object.assign(Error(code),{code});};
const check=(ok,code)=>{if(!ok)fail(code);},hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const integer=(v,lo,hi)=>Number.isSafeInteger(v)&&v>=lo&&v<=hi;
function object(v,required,optional=[]){
  check(v&&Object.getPrototypeOf(v)===Object.prototype);const keys=Reflect.ownKeys(v);
  check(keys.length>=required.length&&keys.length<=required.length+optional.length&&keys.every(k=>typeof k==='string'&&[...required,...optional].includes(k))&&required.every(k=>keys.includes(k)));
  for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);check(d.enumerable&&Object.hasOwn(d,'value'));}
}
function array(v,max){
  check(Array.isArray(v)&&Object.getPrototypeOf(v)===Array.prototype&&v.length<=max,'DECLARED_CONTEXT_BOUND');
  check(Reflect.ownKeys(v).length===v.length+1);for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));check(d&&d.enumerable&&Object.hasOwn(d,'value'));}
}
function source(s){
  object(s,['contract_id','source_sha256','normalized_sha256','normalized_utf16_length']);
  check(typeof s.contract_id==='string'&&/^[A-Za-z0-9_-]{1,128}$/u.test(s.contract_id)&&hash(s.source_sha256)&&hash(s.normalized_sha256)&&integer(s.normalized_utf16_length,1,LIMITS.source_utf16),'DECLARED_CONTEXT_SOURCE');
  return {contract_id:s.contract_id,source_sha256:s.source_sha256,normalized_sha256:s.normalized_sha256,normalized_utf16_length:s.normalized_utf16_length};
}
export const declaredContextSourceIdentity=s=>H(JSON.stringify(source(s)));
const point=(s,n)=>!(n>0&&n<s.length&&/[\uD800-\uDBFF]/u.test(s[n-1])&&/[\uDC00-\uDFFF]/u.test(s[n]));
function unicode(s){for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c>=0xD800&&c<=0xDBFF){const d=s.charCodeAt(++i);check(d>=0xDC00&&d<=0xDFFF);}else check(c<0xDC00||c>0xDFFF);}}
function input(x){
  object(x,['source','normalized_text','focal','attachments'],['limits']);const limits={...LIMITS};
  if(x.limits!==undefined){object(x.limits,[],Object.keys(LIMITS));for(const[k,v]of Object.entries(x.limits)){check(integer(v,1,LIMITS[k]),'DECLARED_CONTEXT_BOUND');limits[k]=v;}}
  const s=source(x.source),text=x.normalized_text;check(typeof text==='string'&&text.length<=limits.source_utf16,'DECLARED_CONTEXT_BOUND');unicode(text);
  check(text.length===s.normalized_utf16_length&&H(text)===s.normalized_sha256,'DECLARED_CONTEXT_SOURCE');array(x.attachments,limits.attachments);
  const identity=declaredContextSourceIdentity(s),nodes=[x.focal,...x.attachments],ids=new Set();let characters=0;
  for(const [i,n]of nodes.entries()){
    object(n,['id','source_identity_sha256','range','declared_role','annotation_ref']);
    check(typeof n.id==='string'&&/^[A-Za-z0-9_-]{1,128}$/u.test(n.id)&&!ids.has(n.id),'DECLARED_CONTEXT_NODE');ids.add(n.id);
    check(n.source_identity_sha256===identity,'DECLARED_CONTEXT_SOURCE');check(typeof n.declared_role==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/u.test(n.declared_role)&&(i? n.declared_role!=='FOCAL':n.declared_role==='FOCAL'),'DECLARED_CONTEXT_NODE');
    const r=n.range;object(r,['start','end','sha256']);check(integer(r.start,0,text.length)&&integer(r.end,r.start+1,text.length)&&point(text,r.start)&&point(text,r.end)&&hash(r.sha256),'DECLARED_CONTEXT_NODE');
    characters+=r.end-r.start;check(characters<=limits.output_bytes,'DECLARED_CONTEXT_BOUND');check(H(text.slice(r.start,r.end))===r.sha256,'DECLARED_CONTEXT_NODE');
    const a=n.annotation_ref;object(a,['path','sha256','bytes']);check(typeof a.path==='string'&&a.path.length>0&&a.path.length<=1024&&!/[\u0000-\u001F]/u.test(a.path)&&hash(a.sha256)&&integer(a.bytes,1,16777216),'DECLARED_CONTEXT_NODE');
  }
  return {s,text,identity,nodes,limits};
}
const FLAGS=Object.freeze({schema:'declared-noncontiguous-context-set-v1',status:'EXPERIMENTAL_REVIEWER_DECLARED_CONTEXT_ONLY',order:'FOCAL_FIRST_THEN_DECLARED_ATTACHMENT_ORDER',roles_are_reviewer_declarations:true,annotation_refs_authenticated:false,actual_reading_established:false,context_adequate:null,governance_verified:false,legal_effect_verified:false,semantic_completeness_verified:false,source_text_concatenated:false,source_text_truncated:false,selection_recomputed:false,focal_replaced:false,accepted_runtime_brand_minted:false,model_execution_performed:false,quality_gate_pass:false,adopted:false,authority:'NONE'});
function metadata(a){return {schema:'declared-context-set-metadata-v1',source_identity_sha256:a.source_identity_sha256,artifact_sha256:H(J(a)),artifact_bytes:Buffer.byteLength(J(a)),node_count:a.nodes.length,attachment_count:a.nodes.length-1,annotation_refs_authenticated:false,context_adequate:null,quality_gate_pass:false,authority:'NONE'};}
function bound(a,limits){const m=metadata(a);check(m.artifact_bytes+Buffer.byteLength(J(m))<=limits.output_bytes,'DECLARED_CONTEXT_BOUND');return m;}
function frozen(v){if(v&&typeof v==='object'){for(const x of Object.values(v))frozen(x);Object.freeze(v);}return v;}
/** Refs/roles are declarations, never evidence authentication or semantic judgments. */
export function createDeclaredContextSet(x){
  const p=input(x),nodes=p.nodes.map(n=>({id:n.id,source_identity_sha256:p.identity,range:{...n.range},declared_role:n.declared_role,annotation_ref:{...n.annotation_ref},text:p.text.slice(n.range.start,n.range.end)}));
  const artifact={...FLAGS,source:p.s,source_identity_sha256:p.identity,nodes};return frozen({artifact,metadata:bound(artifact,p.limits)});
}
/** Independently read back each source span; never calls the creator or joins text. */
export function verifyDeclaredContextSet(request){
  object(request,['artifact','source','normalized_text','focal','attachments'],['limits']);const {artifact,...x}=request;
  const p=input(x);object(artifact,[...Object.keys(FLAGS),'source','source_identity_sha256','nodes']);
  for(const[k,v]of Object.entries(FLAGS))check(artifact[k]===v,'DECLARED_CONTEXT_ARTIFACT');
  object(artifact.source,Object.keys(p.s));for(const[k,v]of Object.entries(p.s))check(artifact.source[k]===v,'DECLARED_CONTEXT_ARTIFACT');
  check(artifact.source_identity_sha256===p.identity,'DECLARED_CONTEXT_ARTIFACT');array(artifact.nodes,p.nodes.length);check(artifact.nodes.length===p.nodes.length,'DECLARED_CONTEXT_ARTIFACT');
  for(let i=0;i<p.nodes.length;i++){
    const n=artifact.nodes[i],wanted=p.nodes[i];object(n,['id','source_identity_sha256','range','declared_role','annotation_ref','text']);
    for(const k of ['id','source_identity_sha256','declared_role'])check(n[k]===wanted[k],'DECLARED_CONTEXT_ARTIFACT');
    for(const k of ['range','annotation_ref']){object(n[k],Object.keys(wanted[k]));for(const[key,v]of Object.entries(wanted[k]))check(n[k][key]===v,'DECLARED_CONTEXT_ARTIFACT');}
    check(n.text===p.text.slice(wanted.range.start,wanted.range.end),'DECLARED_CONTEXT_ARTIFACT');
  }
  bound(artifact,p.limits);return true;
}
