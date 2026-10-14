// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionFamilies, selectClauses } from '../lib/analyze.mjs';

test('holdout partitions whole families reproducibly rather than clauses within one contract',()=>{
  const families=Array.from({length:20},(_,i)=>({id:`family-${i}`,members:[`contract-${i}a`,`contract-${i}b`]}));
  const first=partitionFamilies(families,'seed',.2);const second=partitionFamilies([...families].reverse(),'seed',.2);
  assert.deepEqual([...first].sort(),[...second].sort());assert.equal([...first.values()].filter(p=>p==='holdout').length,4);
  assert.equal(partitionFamilies([{id:'only'}],'seed').get('only'),'fit');
});
test('bounded clause selection remains spread over every contract and retains exclusion reasons',()=>{
  const clauses=Array.from({length:6},(_,contract)=>Array.from({length:10},(_,i)=>({id:`c${contract}-${i}`,contract_id:`c${contract}`,text:'The parties shall communicate promptly about a delay in the agreed work and retain a record of the affected delivery.',sha256:`${contract}-${i}`,segmentation:{word_count:i===0?5:22}}))).flat();
  const config={minWords:20,max_clauses_per_contract:4,max_clauses:12};const first=selectClauses(clauses,config,'seed');const second=selectClauses([...clauses].reverse(),config,'seed');
  assert.deepEqual(first.admitted,second.admitted);assert.equal(first.admitted.length,12);
  const counts=new Map();for(const clause of first.admitted)counts.set(clause.contract_id,(counts.get(clause.contract_id)??0)+1);
  assert.equal(counts.size,6);assert.ok([...counts.values()].every(n=>n===2));
  assert.equal(first.excluded.filter(row=>row.reason==='below_discovery_minimum_retained_in_extraction').length,6);
});
