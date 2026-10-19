// SPDX-License-Identifier: AGPL-3.0-only
// Fictional in-memory controls, never corpus or owned-actor execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {stableCoreDifferences,stableSelectionDifferences,MAX_DIFFERENCES} from './comparison.mjs';

// Exact old reference transforms and traversal, intentionally independent of
// the new path-exclusion implementation. Trusted fixture trees only.
function oldCore(input){const copy=structuredClone(input);delete copy.source;delete copy.raw_sha256;delete copy.native_source_decorations;if(copy.parameters)delete copy.parameters.native_decoration_policy;for(const row of [...copy.sections??[],...copy.units??[]]){delete row.native_source_decorations_ref;for(const unit of row.units??[])delete unit.native_source_decorations_ref;}return copy;}
function oldSelection(input){const copy=structuredClone(input);for(const row of copy.selected)delete row.native_source_decorations_ref;return copy;}
function oldDifferences(a,b,path='',out=[]){if(Object.is(a,b))return out;if(!a||!b||typeof a!=='object'||typeof b!=='object'){out.push(path||'/');return out;}for(const key of new Set([...Object.keys(a),...Object.keys(b)])){if(out.length>=128)break;if(!Object.hasOwn(a,key)||!Object.hasOwn(b,key))out.push(path+'/'+key);else oldDifferences(a[key],b[key],path+'/'+key,out);}return out;}
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const fixture=()=>({contract:{id:'SYNTHETIC_CONTRACT',extra:{untouched:true}},source:{sha256:'SYNTHETIC_OLD'},raw_sha256:'SYNTHETIC_RAW',native_source_decorations:{trace:{sources:[{id:'SYNTHETIC_SOURCE',unknown:'PRESERVED'}]}},parameters:{native_decoration_policy:'SYNTHETIC_OLD',unknown:{retain:true}},normalized_text:'SYNTHETIC literal α 🧭',sections:[{id:'SYNTHETIC_PARENT',native_source_decorations_ref:{old:true},units:[{id:'SYNTHETIC_NESTED',text:'SYNTHETIC',native_source_decorations_ref:{old:true},units:[{native_source_decorations_ref:{deep:'MUST_COMPARE'}}]}],unknown:{native_source_decorations_ref:{keep:true}}}],units:[{id:'SYNTHETIC_UNIT',text:'SYNTHETIC',native_source_decorations_ref:{old:true},units:[{id:'SYNTHETIC_CHILD',native_source_decorations_ref:{old:true}}]}],excluded:[{reason:'SYNTHETIC_KEEP',native_source_decorations_ref:{keep:true}}],warnings:[],unknown:{native_source_decorations:{keep:true}}});
const checkCore=(a,b)=>assert.deepEqual(stableCoreDifferences(a,b),oldDifferences(oldCore(a),oldCore(b)));
const checkSelection=(a,b)=>assert.deepEqual(stableSelectionDifferences(a,b),oldDifferences(oldSelection(a),oldSelection(b)));

test('all exact old core exclusions match, including absent excluded keys',()=>{
  const a=fixture(),b=fixture();b.source={changed:true};delete b.raw_sha256;b.native_source_decorations={different:true};delete b.parameters.native_decoration_policy;
  for(const row of [...b.sections,...b.units]){delete row.native_source_decorations_ref;for(const unit of row.units??[])unit.native_source_decorations_ref={changed:true};}
  checkCore(a,b);assert.deepEqual(stableCoreDifferences(a,b),[]);
});
test('non-excluded and unknown positions, including deeper native-named fields, remain compared',()=>{
  const mutations=[b=>{b.normalized_text+=' changed';},b=>{b.contract.extra.untouched=false;},b=>{b.parameters.unknown.retain=false;},b=>{b.sections[0].unknown.native_source_decorations_ref.keep=false;},b=>{b.sections[0].units[0].units[0].native_source_decorations_ref.deep='CHANGED';},b=>{b.excluded[0].native_source_decorations_ref.keep=false;},b=>{b.unknown.native_source_decorations.keep=false;},b=>{b.units[0].text='CHANGED';},b=>{b.sections[0].units[0].id='CHANGED';}];
  for(const mutate of mutations){const a=fixture(),b=fixture();mutate(b);checkCore(a,b);assert.ok(stableCoreDifferences(a,b).length>0);}
});
test('missing keys, ordered arrays, null/primitive equality and union traversal order match',()=>{
  const a=fixture(),b=fixture();delete b.contract.extra;b.contract.new='SYNTHETIC';a.warnings=[null,-0,{v:true},{v:'first'}];b.warnings=[null,0,{v:false},{v:'second'}];b.newRoot=1;
  checkCore(a,b);assert.deepEqual(stableCoreDifferences(a,b),['/contract/extra','/contract/new','/warnings/1','/warnings/2/v','/warnings/3/v','/newRoot']);
  const c=fixture();delete c.sections;checkCore(fixture(),c);
});
test('selection exclusions are only immediate selected rows; order and unknown content survive',()=>{
  const a={selected:[{id:'SYNTHETIC_A',native_source_decorations_ref:{a:1},unknown:{native_source_decorations_ref:'KEEP'}},{id:'SYNTHETIC_B'}],excluded:[{native_source_decorations_ref:'KEEP'}]},b=structuredClone(a);
  delete b.selected[0].native_source_decorations_ref;checkSelection(a,b);assert.deepEqual(stableSelectionDifferences(a,b),[]);
  b.selected[0].unknown.native_source_decorations_ref='CHANGED';b.excluded[0].native_source_decorations_ref='CHANGED';b.selected.reverse();checkSelection(a,b);assert.ok(stableSelectionDifferences(a,b).length>0);
});
test('difference cap and exact first128 ordered paths match the reference',()=>{
  const a=fixture(),b=fixture();for(let i=0;i<200;i++){a['SYNTHETIC_'+i]=i;b['SYNTHETIC_'+i]=-i-1;}checkCore(a,b);
  assert.equal(stableCoreDifferences(a,b).length,MAX_DIFFERENCES);assert.equal(stableCoreDifferences(a,b).at(-1),'/SYNTHETIC_127');
});
test('deep-frozen inputs stay unchanged and excluded envelope getters are never evaluated',()=>{
  const a=freeze(fixture()),b=freeze(fixture());checkCore(a,b);assert.deepEqual(stableCoreDifferences(a,b),[]);assert.ok(Object.isFrozen(a.sections[0]));
  let reads=0;const x=fixture(),y=fixture();for(const o of[x,y])Object.defineProperty(o,'native_source_decorations',{enumerable:true,get(){reads++;throw Error('Excluded subtree must not be read');}});
  assert.deepEqual(stableCoreDifferences(x,y),[]);assert.equal(reads,0);
});
