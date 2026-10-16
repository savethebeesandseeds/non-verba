// SPDX-License-Identifier: AGPL-3.0-only
// Builtins ONLY at load. Dedicated fixture CLI captures real fd1/fd2 before
// importing project code. Actual entry remains closed before any arguments.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const SELF=fileURLToPath(import.meta.url),proofs=new WeakMap(),hash=b=>createHash('sha256').update(b).digest('hex'),fail=code=>{throw Object.assign(Error(code),{code});};
export const ACTUAL_BOOTSTRAP_ENABLED=false;
export function monotonicActiveMs(start,now=performance.now()){if(!Number.isFinite(start)||!Number.isFinite(now)||start<0||now<start)fail('ACTUAL_MONOTONIC_CLOCK_REQUIRED');const elapsed=Math.ceil(now-start);if(!Number.isSafeInteger(elapsed))fail('ACTUAL_MONOTONIC_CLOCK_REQUIRED');return elapsed;}
export function startActualPhase(){fail('ACTUAL_ENTRY_CLOSED');}
export function assertOwnedBootstrapProof(proof){const value=proofs.get(proof);if(!value)fail('ACTUAL_OWNED_BOOTSTRAP_REQUIRED');return value;}
export function validateFixtureBootstrapReference(input){
  const descriptors=Object.getOwnPropertyDescriptors(input??{});if(Object.keys(descriptors).sort().join(',')!=='bytes,path,sha256'||Object.values(descriptors).some(d=>!Object.hasOwn(d,'value')))fail('ACTUAL_BOOTSTRAP_REF');const ref={path:descriptors.path.value,sha256:descriptors.sha256.value,bytes:descriptors.bytes.value};if(typeof ref.path!=='string'||!/^\/tmp\/literal-emphasis-next-[A-Za-z0-9_-]+\/configuration\.json$/u.test(ref.path)||!/^[a-f0-9]{64}$/u.test(ref.sha256??'')||!Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>262144)fail('ACTUAL_BOOTSTRAP_REF');return Object.freeze(ref);
}
function regularAncestors(file){let at='/';for(const part of path.dirname(file).split('/').filter(Boolean)){at=path.join(at,part);const s=fs.lstatSync(at);if(!s.isDirectory()||s.isSymbolicLink())fail('ACTUAL_BOOTSTRAP_LINKED_PATH');}}
function capture(root,fd,name){const p=root+'/bootstrap/'+name,opened=fs.openSync(p,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600),before=fs.fstatSync(opened);fs.closeSync(fd);const rebound=fs.openSync(p,fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW);if(rebound!==fd)fail('ACTUAL_CAPTURE_FD_REBIND');const after=fs.fstatSync(fd);if(!after.isFile()||before.dev!==after.dev||before.ino!==after.ino)fail('ACTUAL_CAPTURE_FD_IDENTITY');fs.closeSync(opened);return Object.freeze({path:p,dev:after.dev,ino:after.ino,fd});}
async function fixtureCLI(input){
  const started_monotonic_ms=performance.now(),started=Date.now(),ref=validateFixtureBootstrapReference(input);if(process.platform!=='linux'||process.version!=='v22.23.3'||process.env.NONVERBA_CONTAINER!=='1')fail('ACTUAL_BOOTSTRAP_RUNTIME');regularAncestors(ref.path);const root=path.dirname(ref.path);fs.mkdirSync(root+'/bootstrap',{mode:0o700});const stdout=capture(root,1,'supervisor.stdout.private.log'),stderr=capture(root,2,'supervisor.stderr.private.log'),stat=fs.readFileSync('/proc/self/stat','utf8'),birth=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
  const proof=Object.freeze({kind:'OWNED_FICTIONAL_BOOTSTRAP_NOT_AUTHORITY'}),context=Object.freeze({started,started_monotonic_ms,pid:process.pid,birth,root,config_ref:ref,capture:Object.freeze([stdout,stderr])});proofs.set(proof,context);
  const initial={schema:'closed-source-only-bootstrap-first-v1',started,started_monotonic_ms,elapsed_ms:monotonicActiveMs(started_monotonic_ms),pid:process.pid,start_ticks:birth,config_ref:ref,RSS:process.memoryUsage().rss,private_capture_before_project_imports:true,actual_authority:false};fs.writeFileSync(root+'/bootstrap/first.json',JSON.stringify(initial,null,2)+'\n',{flag:'wx',mode:0o600});
  // No project import, packet or code evaluation occurs above this boundary.
  const {superviseFixturePhase}=await import('./guardian.mjs');const result=await superviseFixturePhase(ref,{bootstrapProof:proof}),captured=context.capture.reduce((n,r)=>n+fs.fstatSync(r.fd).size,0)+(result.result.private_capture_observed_bytes??0);if(captured>262144)fail('ACTUAL_COMBINED_PRIVATE_CAPTURE_CAP');
  // Do not mutate captured bytes after the guardian's final capture readback.
  // The fixed guardian/result.json path and exit status carry fixture outcome.
  if(result.result.status!=='SOURCE_FREE_FIXTURE_COMPLETE_NOT_ACTUAL_AUTHORIZATION')process.exitCode=2;
}
if(process.argv[1]&&path.resolve(process.argv[1])===SELF){
  if(process.argv.length!==6||process.argv[2]!=='--fictional-config'){process.stderr.write('ACTUAL_ENTRY_CLOSED\n');process.exitCode=2;}
  else try{await fixtureCLI({path:process.argv[3],sha256:process.argv[4],bytes:Number(process.argv[5])});}catch(error){const code=/^[A-Z0-9_]{1,100}$/u.test(error.code??'')?error.code:'ACTUAL_BOOTSTRAP_HELD';fs.writeSync(2,code+'\n');process.exitCode=2;}
}
