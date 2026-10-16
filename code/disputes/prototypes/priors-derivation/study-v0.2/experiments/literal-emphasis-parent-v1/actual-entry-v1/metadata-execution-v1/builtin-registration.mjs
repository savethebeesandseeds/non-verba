// SPDX-License-Identifier: AGPL-3.0-only
// Pure exception for one intentionally forked direct child before registry ACK.
// No unknown/reuse/registered escape is waived. Pending state authorizes no INIT.
export function registrationSample(collection,{ticket,now,observations,generation}){
  const deny=code=>({hold:true,code,registration_pending:false,candidates:[]});
  if(!collection||collection.aggregate_rss_bytes===null||collection.unknowns.length||collection.reused.length)return deny('EXECUTOR_REGISTRATION_UNKNOWN');
  const pending=collection.unregistered;
  if(!pending.length){if(collection.group_changes.length||collection.hold)return deny('EXECUTOR_REGISTERED_OWNERSHIP_CHANGED');return{hold:false,code:null,registration_pending:false,candidates:[]};}
  if(!ticket||!Number.isFinite(now)||now>ticket.deadline_ms||pending.length!==1||ticket.generation!==generation||!Number.isSafeInteger(generation))return deny('EXECUTOR_UNEXPECTED_DESCENDANT');
  const child=pending[0],actual=observations.find(o=>o.pid===child.pid);
  if(child.parent_pid!==ticket.parent.pid||!actual||actual.state!=='LIVE'||actual.ppid!==ticket.parent.pid||actual.start_ticks!==child.start_ticks||actual.group!==actual.pid||collection.group_changes.some(r=>r.pid!==child.pid))return deny('EXECUTOR_PENDING_CHILD_IDENTITY');
  const operation=actual.operation,argv=ticket.argv;if(!['PARENT','WORKER'].includes(ticket.role)||typeof ticket.entry!=='string'||!ticket.entry.endsWith('/bootstrap.mjs')||typeof ticket.executable!=='string'||!ticket.executable.startsWith('/')||!Array.isArray(argv)||argv.length!==8||argv[0]!=='--actor'||argv[1]!==ticket.role||argv[2]!=='--session'||!/^[a-f0-9]{48}$/u.test(argv[3]??'')||operation?.state!=='LIVE'||operation.pid!==actual.pid||operation.start_ticks!==actual.start_ticks||operation.group!==actual.group||operation.ppid!==actual.ppid||operation.exe!==ticket.executable||JSON.stringify(operation.argv)!==JSON.stringify([ticket.executable,'--max-old-space-size=256',ticket.entry,...argv]))return deny('EXECUTOR_PENDING_CHILD_OPERATION');
  return{hold:false,code:null,registration_pending:true,candidates:[{pid:actual.pid,start_ticks:actual.start_ticks,group:actual.group,parent_pid:actual.ppid}]};
}
