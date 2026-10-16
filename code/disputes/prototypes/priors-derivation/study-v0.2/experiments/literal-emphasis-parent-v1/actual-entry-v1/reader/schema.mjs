// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE / UNADOPTED. Pure stored-artifact checks; never source authority.
import {digest,sha} from '../../finite-codec.mjs';
export {digest,sha};
export const LIMITS=Object.freeze({encoded:8388608,decoded:33554432,metadata:8388608,response_utf16:7500,response_bytes:65536,raw:2097152,windows:8192,tokens:256,journal_entries:32768});
export const TOKENIZERS=Object.freeze([
  Object.freeze({policy_sha256:'728bb65a00c45e8b6a4e1cdb1e5f8a69d5946234deb8bef089b61261dc8f541d',file_set_sha256:'bc15c895e656dfab584cd0e6b2e0e5f5877532fdc5c0195861ba8218d0ccf3b9'}),
  Object.freeze({policy_sha256:'e05a9bd1e27021b8857015953480d3653acd794e3c5d0cd5dba8f35a75618bf1',file_set_sha256:'d6aa9727a115f71b62888648644e6da8deab4fad8efd9047afe6f8923f5415b3'})
]);
export const REQUIRED=Object.freeze(['raw_full','normalized_full','native_parent_dictionary','omitted_fields',...TOKENIZERS.flatMap(t=>['focal','parent'].map(form=>'candidate_'+t.policy_sha256+'_'+form)),'preparation_scope_manifest']);
export const HOLDS=Object.freeze(['0045','0047','0055','0085','0086','0092','0094','0147','0149','0174']);
export const fail=code=>{throw Object.assign(new Error('Stored pilot reader refused the operation'),{code});};
export const integer=(n,min=0,max=Number.MAX_SAFE_INTEGER)=>{if(!Number.isSafeInteger(n)||n<min||n>max)fail('STORED_READER_INTEGER');return n;};
export const hash=h=>{if(typeof h!=='string'||!/^[a-f0-9]{64}$/u.test(h))fail('STORED_READER_HASH');return h;};
export const id=s=>{if(typeof s!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/u.test(s))fail('STORED_READER_ID');return s;};
export const same=(a,b)=>{if(digest(a)!==digest(b))fail('STORED_READER_BINDING');};
export function exact(value,keys){if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).sort().join('\0')!==[...keys].sort().join('\0'))fail('STORED_READER_FIELDS');return value;}
export function dataCopy(value){let nodes=0;const copy=(v,depth)=>{if(++nodes>200000||depth>64)fail('STORED_READER_DATA_BOUND');if(v===null||typeof v==='string'||typeof v==='boolean')return v;if(typeof v==='number'&&Number.isFinite(v))return v;if(Array.isArray(v)){const descriptors=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(v).length!==v.length+1||Object.keys(v).length!==v.length||Object.entries(descriptors).some(([k,d])=>k!=='length'&&(!Object.hasOwn(d,'value')||!d.enumerable)))fail('STORED_READER_PLAIN_DATA');return v.map(x=>copy(x,depth+1));}if(v&&Object.getPrototypeOf(v)===Object.prototype){const descriptors=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(v).length!==Object.keys(v).length||Object.values(descriptors).some(d=>!Object.hasOwn(d,'value')||!d.enumerable))fail('STORED_READER_PLAIN_DATA');return Object.fromEntries(Object.keys(v).map(k=>[k,copy(v[k],depth+1)]));}fail('STORED_READER_PLAIN_DATA');};return copy(value,0);}
export function frozen(value){const result=dataCopy(value);const freeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};return freeze(result);}
export function relative(name){if(typeof name!=='string'||name.length>4096||!/^[A-Za-z0-9][A-Za-z0-9_./-]*$/u.test(name)||name.split('/').length>128||name.split('/').some(p=>!p||p==='.'||p==='..'))fail('STORED_READER_PATH');return name;}
export function reference(ref,{gzip=false,max=LIMITS.encoded}={}){exact(ref,gzip?['path','sha256','bytes','decoded_sha256','decoded_bytes']:['path','sha256','bytes']);relative(ref.path);hash(ref.sha256);integer(ref.bytes,1,max);if(gzip){hash(ref.decoded_sha256);integer(ref.decoded_bytes,1,LIMITS.decoded);}return ref;}
export function sealed(value,key='sha256'){hash(value?.[key]);const {[key]:seal,...body}=value;if(digest(body)!==seal)fail('STORED_READER_SEAL');return value;}
export function point(text,n){return Number.isSafeInteger(n)&&n>=0&&n<=text.length&&!(n>0&&n<text.length&&/[\uD800-\uDBFF]/u.test(text[n-1])&&/[\uDC00-\uDFFF]/u.test(text[n]));}
export function range(text,start,end,{empty=false}={}){if(!point(text,start)||!point(text,end)||end<start+(empty?0:1))fail('STORED_READER_CODEPOINT_RANGE');return text.slice(start,end);}
function shape(value){const queue=[{value,depth:0}];let count=0;while(queue.length){const {value:v,depth}=queue.pop();if(++count>1000000||depth>128)fail('STORED_READER_JSON_STRUCTURE_BOUND');if(v&&typeof v==='object')for(const child of Object.values(v))queue.push({value:child,depth:depth+1});}return value;}
export function json(bytes){let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('STORED_READER_UTF8');}let value;try{value=JSON.parse(text);}catch{fail('STORED_READER_JSON');}shape(value);if(JSON.stringify(value,null,2)+'\n'!==text)fail('STORED_READER_SERIALIZATION');return value;}
export function embedded(text){if(typeof text!=='string')fail('STORED_READER_DOCUMENT_STRING');let value;try{value=JSON.parse(text);}catch{fail('STORED_READER_DOCUMENT_JSON');}return shape(value);}
export const literalJSON=value=>JSON.stringify(value).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
