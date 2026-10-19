// SPDX-License-Identifier: AGPL-3.0-only
// PROTOTYPE: pure decisions for the separately supervised tokenizer census.
const check=(v,code)=>{if(!v)throw Object.assign(Error(code),{code});};
const int=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
export const validActorNonce=v=>typeof v==='string'&&/^[a-f0-9]{32}$/u.test(v);
export function resourceDecision(sample,p){
 for(const k of['phase_elapsed_ms','source_elapsed_ms','aggregate_rss_bytes','qa_bytes','capture_bytes','whole_RUN_bytes','capacity_age_ms'])check(int(sample[k]),'CENSUS_RESOURCE_SAMPLE');
 check(sample.observations_known===true,'CENSUS_UNKNOWN_PROCESS_OBSERVATION');
 check(sample.phase_elapsed_ms<=p.tokenizer_phase_ms_cap&&sample.source_elapsed_ms>=p.initial_source_active_ms+sample.phase_elapsed_ms&&sample.source_elapsed_ms<=p.cumulative_source_active_ms_cap,'CENSUS_PHASE_CLOCK');
 check(sample.aggregate_rss_bytes<=p.limits.aggregate_RSS_bytes,'CENSUS_AGGREGATE_RSS');
 check(sample.qa_bytes<=p.limits.QA_bytes&&p.base_charged_bytes+sample.qa_bytes<=p.combined_prospective_cap,'CENSUS_PHYSICAL_BOUND');
 check(sample.capture_bytes>=p.initial_capture_bytes&&sample.capture_bytes<=p.capture_total_bytes,'CENSUS_CAPTURE_BOUND');
 check(sample.whole_RUN_bytes>=p.whole_RUN_floor&&sample.whole_RUN_bytes<=p.whole_RUN_cap&&sample.whole_RUN_bytes-p.growth_baseline<=p.growth_hard&&sample.capacity_age_ms<=1000,'CENSUS_SHARED_CAPACITY');
 return true;
}
export function verifyLease(lease,expected,nowNS){
 check(typeof nowNS==='bigint'&&lease?.schema==='matched-context-window-live-lease-v1'&&lease.status==='LIVE_WITHIN_FIXED_RESOURCE_LIMITS','CENSUS_LEASE_SHAPE');
 for(const k of['nonce','role','source_epoch_sha256','boot_id','phase_origin_ns'])check(lease[k]===expected[k],'CENSUS_LEASE_IDENTITY');
 const actorSame=(a,b)=>a?.pid===b?.pid&&a?.start_ticks===b?.start_ticks&&a?.group===b?.group;
 check(actorSame(lease.supervisor,expected.supervisor)&&actorSame(lease.actor,expected.actor),'CENSUS_LEASE_ACTOR');
 check(/^[0-9]{1,32}$/u.test(lease.observed_ns??'')&&/^[0-9]{1,32}$/u.test(lease.deadline_ns??''),'CENSUS_LEASE_CLOCK');
 const observed=BigInt(lease.observed_ns),deadline=BigInt(lease.deadline_ns),origin=BigInt(expected.phase_origin_ns);
 check(observed>=origin&&observed<=nowNS&&nowNS-observed<=1000000000n&&nowNS<=deadline&&deadline<=observed+1000000000n&&deadline<=origin+180000000000n,'CENSUS_LEASE_STALE');
 check(lease.observations_known===true&&int(lease.aggregate_rss_bytes)&&lease.aggregate_rss_bytes<=1073741824,'CENSUS_LEASE_RESOURCE');
 return true;
}
export function reserveCounterBatch({global,stream,globalLimit=60000,streamLimit=20000,batch=32}){
 check(int(global)&&int(stream)&&int(globalLimit,1)&&int(streamLimit,1)&&int(batch,1)&&globalLimit<=60000&&streamLimit<=20000&&batch<=32&&global<=globalLimit&&stream<=streamLimit,'CENSUS_COUNTER_LEDGER');
 const reserved=Math.min(batch,globalLimit-global,streamLimit-stream);
 check(reserved>0,'CENSUS_COUNTER_CALL_BOUND');
 return Object.freeze({reserved,global_after:global+reserved,stream_after:stream+reserved});
}
export function parseProcStat(text){
 check(typeof text==='string'&&text.length<=8192,'CENSUS_PROC_BOUND');
 const end=text.lastIndexOf(') '),head=text.slice(0,text.indexOf(' ')),fields=text.slice(end+2).trim().split(/\s+/u);
 check(end>0&&/^[1-9][0-9]*$/u.test(head)&&fields.length>=22&&/^[A-Za-z]$/u.test(fields[0]),'CENSUS_PROC_STAT');
 const out={pid:Number(head),ppid:Number(fields[1]),group:Number(fields[2]),start_ticks:fields[19],state:fields[0]};
 check(int(out.pid,1)&&int(out.ppid)&&int(out.group,1)&&/^[0-9]{1,32}$/u.test(out.start_ticks),'CENSUS_PROC_IDENTITY');return out;
}
export function sameBirth(a,b){return a?.pid===b?.pid&&a?.start_ticks===b?.start_ticks&&a?.group===b?.group;}
export function ownedProcessSet(rows,actor,known=[]){
 check(Array.isArray(rows)&&rows.length<=65536&&Array.isArray(known),'CENSUS_PROCESS_INVENTORY');
 const byPID=new Map();for(const row of rows){check(!byPID.has(row.pid),'CENSUS_DUPLICATE_PROCESS');byPID.set(row.pid,row);}
 const root=byPID.get(actor.pid);if(root)check(sameBirth(root,actor),'CENSUS_ACTOR_BIRTH_CHANGED');
 const selected=new Map();if(root)selected.set(root.pid,root);
 for(const prior of known){const row=byPID.get(prior.pid);if(row){check(sameBirth(row,prior),'CENSUS_KNOWN_BIRTH_CHANGED');selected.set(row.pid,row);}}
 const originalGroupLive=Boolean(root)||[...selected.values()].some(row=>row.group===actor.group);
 for(const row of rows)if(row.group===actor.group){check(originalGroupLive||selected.has(row.pid),'CENSUS_UNKNOWN_ORIGINAL_GROUP_MEMBER');selected.set(row.pid,row);}
 for(let i=0;i<=rows.length;i++){let changed=false;for(const row of rows)if(!selected.has(row.pid)&&selected.has(row.ppid)){selected.set(row.pid,row);changed=true;}if(!changed)break;}
 return [...selected.values()];
}
