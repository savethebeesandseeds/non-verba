// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {contextOf,fail} from './admission.mjs';
import {checkedPath,sha} from './input-io.mjs';
import {channelOf} from './control.mjs';
import {METADATA_OUTPUTS,LIMITS} from './builtin-gate.mjs';
export async function writeMetadata(permit,name,value){
  const c=contextOf(permit),allowed=METADATA_OUTPUTS.slice(c.role==='PARENT'?0:3,c.role==='PARENT'?3:6);if(!allowed.includes(name))fail('EXECUTOR_WRITE_ROLE_SCOPE');const b=Buffer.from(JSON.stringify(value,null,2)+'\n');if(b.length<1||b.length>LIMITS.metadata_bytes)fail('EXECUTOR_METADATA_BOUND');
  const channel=channelOf(permit),grant=await channel.request({type:'WRITE_REQUEST',path:name,bytes:b.length,decoded_bytes:b.length}),target=await checkedPath(c.output_root,name,{missing:true}),fd=await fs.open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);let before;try{before=await fd.stat();await fd.writeFile(b);await fd.sync();const after=await fd.stat();if(!after.isFile()||before.dev!==after.dev||before.ino!==after.ino||after.size!==b.length)fail('EXECUTOR_WRITE_IDENTITY');}finally{await fd.close();}const directory=await fs.open(path.dirname(target),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await directory.sync();}finally{await directory.close();}
  const reference={path:name,sha256:sha(b),bytes:b.length,decoded_sha256:sha(b),decoded_bytes:b.length};await channel.commit(grant.request_id,reference);return reference;
}
