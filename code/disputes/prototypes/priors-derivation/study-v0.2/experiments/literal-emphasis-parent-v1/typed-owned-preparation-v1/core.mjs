// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE: inert shared data checks; no filesystem or actual admission.
import {digest,sha} from '../finite-codec.mjs';
import {immutableCopy} from '../immutable-state.mjs';
import {ROOT_PATTERN} from './configuration.mjs';
export {digest,sha,immutableCopy};
export const HASH=/^[a-f0-9]{64}$/u;
export const fail=code=>{throw Object.assign(Error(code),{code});};
export const check=(value,code)=>{if(!value)fail(code);};
export const seal=body=>immutableCopy({...body,sha256:digest(body)});
export const sealed=value=>{const{sha256,...body}=value??{};return HASH.test(sha256??'')&&digest(body)===sha256;};
export const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export const byteRef=(path,bytes)=>({path,sha256:sha(bytes),bytes:bytes.length});
export function syntheticRoot(root){check(typeof root==='string'&&ROOT_PATTERN.test(root),'TYPED_OWNED_ROOT');return root;}
export function syntheticID(id){check(typeof id==='string'&&/^SYNTHETIC_[A-Za-z0-9_:-]{1,200}$/u.test(id),'TYPED_OWNED_SYNTHETIC_ID');return id;}
export function sourcePath(root,path){syntheticRoot(root);check(typeof path==='string'&&path.startsWith(root+'/fixture/')&&!/[\\\0\r\n]/u.test(path)&&!path.slice(1).split('/').some(p=>!p||p==='.'||p==='..')&&path.slice(root.length+9).split('/').every(p=>/^[A-Za-z0-9_.-]+$/u.test(p)),'TYPED_OWNED_SOURCE_PATH');return path;}
export function safeCode(error){if(!error||!['object','function'].includes(typeof error))return'TYPED_OWNED_AVAILABLE_FAILURE';const d=Object.getOwnPropertyDescriptor(error,'code');return d&&Object.hasOwn(d,'value')&&typeof d.value==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/u.test(d.value)?d.value:'TYPED_OWNED_AVAILABLE_FAILURE';}
export function exactUTF8(bytes){const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);check(Buffer.from(text).equals(bytes),'TYPED_OWNED_UTF8');return text;}
