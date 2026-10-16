// SPDX-License-Identifier: AGPL-3.0-only
// Builtin-only source preparation; import performs no proc IO and never signals.
import processFS from 'node:fs';

export const PROCESS_OBSERVATION_LIMITS=Object.freeze({file_bytes:65536,records:4096,candidates:16384,page_bytes:4096});
const processFail=code=>{throw Object.assign(Error(code),{code});};
const processFreeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))processFreeze(child);Object.freeze(value);}return value;};
const processPID=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
const processStart=value=>typeof value==='string'&&/^[1-9][0-9]{0,19}$/.test(value)&&BigInt(value)<=18446744073709551615n;
const processAbsent=error=>error?.code==='ENOENT'||error?.code==='ESRCH';
const processNumber=(text,{positive=false}={})=>{if(typeof text!=='string'||!/^(?:0|[1-9][0-9]*)$/.test(text))processFail('PROCESS_INTEGER_INVALID');const n=Number(text);if(!Number.isSafeInteger(n)||n<0||positive&&n===0)processFail('PROCESS_INTEGER_INVALID');return n;};
function processText(value){
  if(typeof value!=='string'&&!Buffer.isBuffer(value))processFail('PROCESS_BYTES_INVALID');
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);
  if(bytes.length>PROCESS_OBSERVATION_LIMITS.file_bytes)processFail('PROCESS_FILE_BOUND');
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{processFail('PROCESS_UTF8_INVALID');}
  if(text.includes('\0')||typeof value==='string'&&text!==value)processFail('PROCESS_BYTES_INVALID');return text;
}
function processStat(pid,value){
  if(!processPID(pid))processFail('PROCESS_PID_INVALID');
  const text=processText(value).replace(/\n$/,''),prefix=String(pid)+' (',end=text.lastIndexOf(') ');
  if(!text.startsWith(prefix)||end<prefix.length||text.slice(end+2).includes('\n'))processFail('PROCESS_STAT_INVALID');
  const fields=text.slice(end+2).split(' ');
  if(fields.length<50||fields.some(x=>x==='')||! /^[RSDZTWtXxKPI]$/.test(fields[0])||fields.slice(1).some(x=>! /^-?(?:0|[1-9][0-9]*)$/.test(x)))processFail('PROCESS_STAT_INVALID');
  const ppid=processNumber(fields[1]),group=processNumber(fields[2],{positive:true}),start_ticks=fields[19],pages=processNumber(fields[21]);
  if(ppid>2147483647||group>2147483647||!processStart(start_ticks)||!Number.isSafeInteger(pages*PROCESS_OBSERVATION_LIMITS.page_bytes))processFail('PROCESS_STAT_INVALID');
  return {pid,start_ticks,ppid,group,rss_bytes:pages*PROCESS_OBSERVATION_LIMITS.page_bytes};
}
export function parseProcessBytes(pid,{stat,status,children}){
  const parsed=processStat(pid,stat),text=processText(status),lines=text.split('\n'),required=new Map();
  for(const line of lines){const match=/^(Pid|Tgid|PPid|VmRSS):[ \t]*(.*)$/.exec(line);if(match){if(required.has(match[1]))processFail('PROCESS_STATUS_DUPLICATE');required.set(match[1],match[2]);}}
  if(required.size!==4)processFail('PROCESS_STATUS_INCOMPLETE');
  if(processNumber(required.get('Pid'),{positive:true})!==pid||processNumber(required.get('Tgid'),{positive:true})!==pid||processNumber(required.get('PPid'))!==parsed.ppid)processFail('PROCESS_STATUS_IDENTITY');
  const rss=/^((?:0|[1-9][0-9]*))[ \t]+kB$/.exec(required.get('VmRSS'));if(!rss)processFail('PROCESS_STATUS_RSS_INVALID');
  const rss_bytes=processNumber(rss[1])*1024;if(!Number.isSafeInteger(rss_bytes))processFail('PROCESS_STATUS_RSS_INVALID');
  const childText=processText(children);if(!/^(?:[ \t\r\n]*|[0-9]+(?:[ \t\r\n]+[0-9]+)*[ \t\r\n]*)$/.test(childText))processFail('PROCESS_CHILDREN_INVALID');
  const childPIDs=childText.trim()?childText.trim().split(/\s+/).map(x=>processNumber(x,{positive:true})):[];
  if(childPIDs.some(x=>!processPID(x)||x===pid)||new Set(childPIDs).size!==childPIDs.length)processFail('PROCESS_CHILDREN_INVALID');
  return processFreeze({...parsed,rss_bytes:Math.max(parsed.rss_bytes,rss_bytes),children:childPIDs});
}
function processRead(io,file){
  if(!io||!['openSync','readSync','closeSync','fstatSync'].every(k=>typeof io[k]==='function'))processFail('PROCESS_IO_INVALID');
  const flags=processFS.constants.O_RDONLY|processFS.constants.O_NOFOLLOW|processFS.constants.O_NONBLOCK;
  let fd;try{
    fd=io.openSync(file,flags);const s=io.fstatSync(fd);if(!s.isFile())processFail('PROCESS_FILE_NOT_REGULAR');
    const bytes=Buffer.alloc(PROCESS_OBSERVATION_LIMITS.file_bytes+1);let length=0;
    while(length<bytes.length){const count=io.readSync(fd,bytes,length,bytes.length-length,null);if(!Number.isSafeInteger(count)||count<0||count>bytes.length-length)processFail('PROCESS_READ_INVALID');if(count===0)break;length+=count;}
    if(length>PROCESS_OBSERVATION_LIMITS.file_bytes)processFail('PROCESS_FILE_BOUND');return bytes.subarray(0,length);
  }finally{if(fd!==undefined){try{io.closeSync(fd);}catch{processFail('PROCESS_CLOSE_UNKNOWN');}}}
}
const processUnknown=(pid,reason)=>processFreeze({state:'UNKNOWN',pid,start_ticks:null,ppid:null,group:null,rss_bytes:null,children:[],reason});
const processGone=pid=>processFreeze({state:'GONE',pid,start_ticks:null,ppid:null,group:null,rss_bytes:null,children:[],reason:'PROC_ABSENT'});
export function observeProcess(pid,{io=processFS}={}){
  if(!processPID(pid))processFail('PROCESS_PID_INVALID');
  const base='/proc/'+pid;let first;
  try{first=processStat(pid,processRead(io,base+'/stat'));}catch(error){return processAbsent(error)?processGone(pid):processUnknown(pid,'FIRST_STAT_UNKNOWN');}
  let parsed,last;
  try{parsed=parseProcessBytes(pid,{stat:processRead(io,base+'/stat'),status:processRead(io,base+'/status'),children:processRead(io,base+'/task/'+pid+'/children')});last=processStat(pid,processRead(io,base+'/stat'));}
  catch(error){
    if(processAbsent(error)){
      try{processStat(pid,processRead(io,base+'/stat'));return processUnknown(pid,'PARTIAL_PROC_DISAPPEARANCE');}catch(confirm){return processAbsent(confirm)?processGone(pid):processUnknown(pid,'ABSENCE_CONFIRMATION_UNKNOWN');}
    }
    return processUnknown(pid,'PROC_READ_OR_PARSE_UNKNOWN');
  }
  if([parsed,last].some(p=>p.start_ticks!==first.start_ticks||p.ppid!==first.ppid||p.group!==first.group))return processUnknown(pid,'UNSTABLE_PROCESS_IDENTITY');
  return processFreeze({state:'LIVE',...parsed,rss_bytes:Math.max(first.rss_bytes,parsed.rss_bytes,last.rss_bytes),reason:'VERIFIED_PROC_BYTES'});
}
function processRegistry(registry){
  if(!Array.isArray(registry)||registry.length>PROCESS_OBSERVATION_LIMITS.records)processFail('PROCESS_REGISTRY_BOUND');
  const seen=new Set();return registry.map(item=>{
    if(!item||typeof item!=='object'||!processPID(item.pid)||!processStart(item.start_ticks)||!processPID(item.group)||item.parent_pid!==undefined&&!processPID(item.parent_pid)||seen.has(item.pid))processFail('PROCESS_REGISTRY_INVALID');seen.add(item.pid);
    return {pid:item.pid,start_ticks:item.start_ticks,group:item.group,...(item.parent_pid===undefined?{}:{parent_pid:item.parent_pid})};
  });
}
function processObservation(pid,observe){
  let result;try{result=observe(pid);}catch{return processUnknown(pid,'OBSERVER_THROW');}
  if(!result||result.pid!==pid||!['LIVE','GONE','UNKNOWN'].includes(result.state))return processUnknown(pid,'OBSERVER_RESULT_INVALID');
  if(result.state!=='LIVE')return result.state==='GONE'?processGone(pid):processUnknown(pid,'OBSERVER_UNKNOWN');
  if(!processStart(result.start_ticks)||!Number.isSafeInteger(result.ppid)||result.ppid<0||result.ppid>2147483647||!processPID(result.group)||!Number.isSafeInteger(result.rss_bytes)||result.rss_bytes<0||!Array.isArray(result.children)||result.children.length>PROCESS_OBSERVATION_LIMITS.candidates||result.children.some(x=>!processPID(x)||x===pid)||new Set(result.children).size!==result.children.length)return processUnknown(pid,'OBSERVER_LIVE_INVALID');
  return processFreeze({state:'LIVE',pid,start_ticks:result.start_ticks,ppid:result.ppid,group:result.group,rss_bytes:result.rss_bytes,children:[...result.children],reason:'VERIFIED_OBSERVER_RESULT'});
}

// Caller retains every returned record and sticky HOLD between samples. These
// predicates cover known identities/lineage, not an enumeration of all /proc.
export function collectOwnedTree(registry,{observe=observeProcess}={}){
  if(typeof observe!=='function')processFail('PROCESS_OBSERVER_INVALID');
  const records=processRegistry(registry),byPID=new Map(records.map(r=>[r.pid,r])),observations=new Map(),queue=[...records];
  const candidates=[],unknowns=[],reused=[],unregistered=[],group_changes=[],gone=[],counted=new Map(),candidateSeen=new Set(),unknownSeen=new Set(),groupSeen=new Set(),reuseSeen=new Set();let known_rss_bytes=0,bound=false,descendant_steps=0;
  const candidate=(pid,reason,detail={})=>{const key=pid+':'+reason;if(candidateSeen.has(key))return true;if(candidates.length>=PROCESS_OBSERVATION_LIMITS.candidates){bound=true;return false;}candidateSeen.add(key);candidates.push({pid,reason,...detail});if(candidates.length===PROCESS_OBSERVATION_LIMITS.candidates)bound=true;return true;};
  const unknown=(pid,reason)=>{const key=pid+':'+reason;if(unknownSeen.has(key)||!candidate(pid,reason))return;unknownSeen.add(key);unknowns.push({pid,reason});};
  const step=()=>{if(bound)return false;if(++descendant_steps>PROCESS_OBSERVATION_LIMITS.candidates){bound=true;return false;}return true;};
  const retainGroup=(record,current)=>{if(current.group===record.group)return;const key=record.pid+':'+current.group;if(!groupSeen.has(key)){groupSeen.add(key);group_changes.push({pid:record.pid,start_ticks:record.start_ticks,expected_group:record.group,observed_group:current.group});}};
  const retainReuse=(record,current)=>{const key=record.pid+':'+current.start_ticks;if(!reuseSeen.has(key)){reuseSeen.add(key);reused.push({pid:record.pid,expected_start_ticks:record.start_ticks,observed_start_ticks:current.start_ticks});candidate(record.pid,'PID_REUSED',{observed_start_ticks:current.start_ticks});}};
  const observeOnce=pid=>{if(!observations.has(pid))observations.set(pid,processObservation(pid,observe));return observations.get(pid);};
  const retainRSS=current=>{const previous=counted.get(current.pid)??0,next=Math.max(previous,current.rss_bytes);if(!Number.isSafeInteger(known_rss_bytes+next-previous)){unknown(current.pid,'RSS_SUM_UNKNOWN');return;}known_rss_bytes+=next-previous;counted.set(current.pid,next);};
  for(let at=0;at<queue.length;at++){
    if(bound)break;
    const record=queue[at],current=observeOnce(record.pid);
    if(current.state==='GONE'){gone.push({pid:record.pid,start_ticks:record.start_ticks});continue;}
    if(current.state==='UNKNOWN'){unknown(record.pid,current.reason);continue;}
    if(current.start_ticks!==record.start_ticks){retainReuse(record,current);continue;}
    retainRSS(current);
    // Keep child candidates and their RSS even when an owned process escaped its group.
    retainGroup(record,current);const initialChildren=new Set(current.children);
    for(const childPID of current.children){
      if(!step())break;
      if(byPID.has(childPID))continue;
      if(records.length>=PROCESS_OBSERVATION_LIMITS.records){candidate(childPID,'RECORD_BOUND');bound=true;break;}
      const child=observeOnce(childPID),parentAgain=processObservation(record.pid,observe);
      const sameParent=parentAgain.state==='LIVE'&&parentAgain.start_ticks===record.start_ticks;
      if(sameParent){retainRSS(parentAgain);retainGroup(record,parentAgain);}else if(parentAgain.state==='LIVE')retainReuse(record,parentAgain);else if(parentAgain.state==='UNKNOWN')unknown(record.pid,'LINEAGE_PARENT_RECHECK_UNKNOWN');
      if(child.state!=='LIVE'||child.ppid!==record.pid||!sameParent)unknown(childPID,'UNPROVEN_DESCENDANT_IDENTITY');
      else if(!bound){
        const discovered={pid:childPID,start_ticks:child.start_ticks,group:record.group,parent_pid:record.pid};
        retainRSS(child);retainGroup(discovered,child);
        records.push(discovered);byPID.set(childPID,discovered);queue.push(discovered);unregistered.push({...discovered});candidate(childPID,'NEW_DESCENDANT_REQUIRES_REGISTRATION',{start_ticks:child.start_ticks});
      }
      // A positive child seen only on recheck is retained, never silently adopted.
      if(sameParent)for(const freshPID of parentAgain.children){if(!step())break;if(!initialChildren.has(freshPID)&&!byPID.has(freshPID))unknown(freshPID,'DESCENDANT_DISCOVERED_DURING_RECHECK');}
    }
  }
  if(bound)unknowns.push({pid:null,reason:'PROCESS_COLLECTION_BOUND'});
  const uncertain=unknowns.length>0||reused.length>0,hold=uncertain||unregistered.length>0||group_changes.length>0;
  return processFreeze({records,candidates,aggregate_rss_bytes:uncertain?null:known_rss_bytes,known_rss_bytes,unknowns,reused,unregistered,group_changes,gone,hold,absence_known:!hold&&gone.length===records.length,group_absence_claim:false,registry_retention_required:true,sticky_hold_required:true});
}

// A proposal only. Never calls kill, never yields a negative process-group PID.
// A production caller must reverify an identity immediately before any signal.
export function verifiedSignalPlan(registry,{observe=observeProcess}={}){
  if(typeof observe!=='function')processFail('PROCESS_OBSERVER_INVALID');
  const records=processRegistry(registry),verified=[],unknowns=[],reused=[],group_changes=[],gone=[];
  for(const record of records){const current=processObservation(record.pid,observe);
    if(current.state==='UNKNOWN'){unknowns.push({pid:record.pid,reason:current.reason});continue;}
    if(current.state==='GONE'){gone.push({pid:record.pid,start_ticks:record.start_ticks});continue;}
    if(current.start_ticks!==record.start_ticks){reused.push({pid:record.pid,expected_start_ticks:record.start_ticks,observed_start_ticks:current.start_ticks});continue;}
    if(current.group!==record.group)group_changes.push({pid:record.pid,start_ticks:record.start_ticks,expected_group:record.group,observed_group:current.group});
    verified.push({pid:record.pid,start_ticks:record.start_ticks,group:current.group});
  }
  return processFreeze({verified,unknowns,reused,group_changes,gone,hold:unknowns.length>0||reused.length>0||group_changes.length>0,absence_known:gone.length===records.length,signals_sent:false,group_signals_proposed:false,reverification_required:true});
}
