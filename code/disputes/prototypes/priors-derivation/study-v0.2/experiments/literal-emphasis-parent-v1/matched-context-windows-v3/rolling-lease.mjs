// SPDX-License-Identifier: AGPL-3.0-only
// Fixed rolling observation only; this does not relax immutable stored refs.
export const LEASE_DIRECTORY='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000/qa/literal-emphasis-parent-v1-matched-context-windows-v3/execution';
const check=(v,code)=>{if(!v)throw Object.assign(Error(code),{code});};
/** Caller supplies its already-captured IO. No IO capability is issued here.
 * Atomic rename may unlink the opened inode; its same FD remains authoritative
 * for these bytes. The caller still verifies nonce, birth, phase and freshness. */
export function readRollingLease({io,constants,noLinks}){
 noLinks(LEASE_DIRECTORY,true);
 const fd=io.openSync(LEASE_DIRECTORY+'/current-lease.json',constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const a=io.fstatSync(fd);check(a.isFile()&&(a.nlink===0||a.nlink===1)&&Number.isSafeInteger(a.size)&&a.size>0&&a.size<=8192,'CENSUS_LEASE_FILE');
  const b=Buffer.alloc(a.size);let at=0;while(at<b.length){const n=io.readSync(fd,b,at,b.length-at,at);check(Number.isSafeInteger(n)&&n>0&&n<=b.length-at,'CENSUS_LEASE_SHORT');at+=n;}
  const z=io.fstatSync(fd);check(z.isFile()&&(z.nlink===0||z.nlink===1)&&z.dev===a.dev&&z.ino===a.ino&&z.size===a.size&&io.readSync(fd,Buffer.alloc(1),0,1,at)===0,'CENSUS_LEASE_CHANGED');
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));check(Buffer.from(JSON.stringify(value,null,2)+'\n').equals(b),'CENSUS_LEASE_SERIALIZATION');return value;
 }finally{io.closeSync(fd);}
}
