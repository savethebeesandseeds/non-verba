// SPDX-License-Identifier: AGPL-3.0-only
// Parent allowlist: builtins plus pure immutable/capability code, no cache reader.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {contextOf,fail} from './admission.mjs';
export const sha=b=>createHash('sha256').update(b).digest('hex');
export function reference(ref){if(!ref||Object.keys(ref).sort().join(',')!=='bytes,path,sha256'||typeof ref.path!=='string'||ref.path.startsWith('/')||ref.path.includes('\\')||ref.path.split('/').some(x=>!x||x==='.'||x==='..')||!/^[a-f0-9]{64}$/u.test(ref.sha256??'')||!Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>8388608)fail('METADATA_REFERENCE');return ref;}
export async function checkedPath(root,name,{missing=false}={}){
  if(typeof name!=='string'||name.startsWith('/')||name.includes('\\')||name.split('/').some(x=>!x||x==='.'||x==='..'))fail('METADATA_RELATIVE_PATH');
  const target=path.resolve(root,name);if(!target.startsWith(root+'/'))fail('METADATA_PATH_ESCAPE');let at='/';
  for(const part of path.dirname(target).split('/').filter(Boolean)){at=path.join(at,part);const s=await fs.lstat(at);if(!s.isDirectory()||s.isSymbolicLink())fail('METADATA_LINKED_PARENT');}
  try{const s=await fs.lstat(target);if(!s.isFile()||s.isSymbolicLink())fail('METADATA_REGULAR_FILE');}catch(e){if(!(missing&&e.code==='ENOENT'))throw e;}return target;
}
export function parseJSON(bytes){const text=bytes.toString('utf8');if(!Buffer.from(text).equals(bytes))fail('METADATA_STRICT_UTF8');try{return JSON.parse(text);}catch{fail('METADATA_JSON');}}
// Only the four exact parent metadata bindings are readable through this API.
export async function readParentMetadata(permit,ref){
  reference(ref);const c=contextOf(permit),allowed=[c.bindings.manifest,c.bindings.fresh,c.bindings.development,c.roster_ref];
  if(!allowed.some(r=>r.path===ref.path&&r.sha256===ref.sha256&&r.bytes===ref.bytes))fail('METADATA_PARENT_READ_NOT_ALLOWED');
  const target=await checkedPath(c.input_root,ref.path),fd=await fs.open(target,constants.O_RDONLY|constants.O_NOFOLLOW);try{const before=await fd.stat();if(!before.isFile()||before.size!==ref.bytes)fail('METADATA_PARENT_FILE_SIZE');const b=Buffer.alloc(ref.bytes);let at=0;while(at<b.length){const r=await fd.read(b,at,b.length-at,at);if(!r.bytesRead)fail('METADATA_PARENT_TRUNCATED');at+=r.bytesRead;}const after=await fd.stat();if(after.size!==before.size||after.ino!==before.ino||after.dev!==before.dev||sha(b)!==ref.sha256)fail('METADATA_PARENT_FILE_CHANGED');return b;}finally{await fd.close();}
}
