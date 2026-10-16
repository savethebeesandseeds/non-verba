// SPDX-License-Identifier: AGPL-3.0-only
// BUILTINS ONLY until independently registered parent sends INIT.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
const reject=code=>{throw Object.assign(Error(code),{code});},hash=b=>createHash('sha256').update(b).digest('hex');
const ownStat=await fs.readFile('/proc/self/stat','utf8'),start_ticks=ownStat.slice(ownStat.lastIndexOf(')')+2).split(' ')[19];
if(typeof process.send!=='function'||!process.connected)reject('EXACT69_OWNED_GUARDIAN_REQUIRED');
const args=process.argv.slice(2);if(args.length!==3||!/^\/tmp\/literal-emphasis-next-[A-Za-z0-9_-]+\/configuration\.json$/u.test(args[0])||!/^[a-f0-9]{64}$/u.test(args[1])||!/^\d+$/u.test(args[2]))reject('EXACT69_FIXTURE_CONFIG_ARGS_REQUIRED');
const receive=type=>new Promise((resolve,rejectPromise)=>{const onMessage=m=>{if(m?.type===type){process.off('disconnect',onDisconnect);process.off('message',onMessage);resolve(m);}},onDisconnect=()=>rejectPromise(Error('EXACT69_GUARDIAN_DISCONNECTED'));process.on('message',onMessage);process.once('disconnect',onDisconnect);});
const registeredPromise=receive('REGISTERED');process.send({type:'HELLO',schema:'pilot-owned-worker-hello-v1',pid:process.pid,start_ticks});const registered=await registeredPromise;
if(registered.schema!=='pilot-owned-worker-registered-v1'||registered.pid!==process.pid||registered.start_ticks!==start_ticks||!/^[a-f0-9]{64}$/u.test(registered.registry_sha256??''))reject('EXACT69_REGISTRY_BINDING');
const initPromise=receive('INIT');process.send({type:'READY',registry_sha256:registered.registry_sha256});const init=await initPromise;
if(init.schema!=='pilot-owned-worker-init-v1'||init.registry_sha256!==registered.registry_sha256||init.config_ref?.path!==args[0]||init.config_ref.sha256!==args[1]||init.config_ref.bytes!==Number(args[2]))reject('EXACT69_INIT_BINDING');
let at='/';for(const part of dirname(args[0]).split('/').filter(Boolean)){at=join(at,part);const s=await fs.lstat(at);if(!s.isDirectory()||s.isSymbolicLink())reject('EXACT69_LINKED_CONFIG_PARENT');}
const file=await fs.open(args[0],constants.O_RDONLY|constants.O_NOFOLLOW);let bytes;try{const s=await file.stat();if(!s.isFile()||s.size!==Number(args[2])||s.size>8388608)reject('EXACT69_CONFIG_SIZE');bytes=Buffer.alloc(s.size);let offset=0;while(offset<bytes.length){const r=await file.read(bytes,offset,bytes.length-offset,offset);if(!r.bytesRead)reject('EXACT69_CONFIG_TRUNCATED');offset+=r.bytesRead;}if((await file.stat()).size!==s.size||hash(bytes)!==args[1])reject('EXACT69_CONFIG_BYTE_BINDING');}finally{await file.close();}
let config;try{config=JSON.parse(bytes.toString('utf8'));}catch{reject('EXACT69_CONFIG_JSON');}
if(config.mode!=='SOURCE_FREE_FIXTURE'||config.root!==dirname(args[0])||config.phase!==init.phase||config.source_epoch_sha256!==init.source_epoch_sha256)reject('EXACT69_ACTUAL_EXECUTION_DISABLED');
// Fixed named entrypoints only, after capture/registration/INIT.
const{createWorkerTransport}=await import('./transport.mjs'),{runDriver}=await import('./driver.mjs'),transport=createWorkerTransport(init);
try{const result=await runDriver(config,transport);await transport.done(result);process.disconnect();}catch(error){console.error(/^[A-Z0-9_]+$/u.test(error.code??'')?error.code:'EXACT69_WORKER_HELD');process.exitCode=1;if(process.connected)process.disconnect();}
