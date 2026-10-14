// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from '../../lib/common.mjs';
import { STUDY_BASE, validateStudyRoot, writeJSON, writeRows, readRows } from '../lib/store.mjs';
import { balancedAdmission, prepareDiscovery, readDiscoveryUnits } from '../lib/admission.mjs';

const schema = { id: 'VARCHAR', contract_id: 'VARCHAR', cohort: 'VARCHAR', kind: 'VARCHAR', payload: 'VARCHAR' };
async function collect(iterator) { const rows = []; for await (const row of iterator) rows.push(row); return rows; }
async function fixture(t, { count = 12, reserve = false } = {}) {
  const run = join(STUDY_BASE, `test-admission-${randomUUID()}`); validateStudyRoot(run); await mkdir(run, { recursive: true }); t.after(() => rm(run, { recursive: true, force: true }));
  await writeJSON(run, 'recipe.json', { seed: 'synthetic-balanced-admission', extraction: { maxUnits: 7 }, limits: { memoryBytes: 6 * 1024 ** 3, totalBytes: 1024 ** 3 } });
  const rows = Array.from({ length: count }, (_, index) => {
    const contract = `contract-${Math.floor(index / 4)}`; const cohort = reserve ? 'confirmation' : index < 8 ? 'discovery-broad' : 'discovery-relevant';
    const unit = { id: `unit-${index}`, contract_id: contract, cohort, parent_section_id: `section-${index}`, start: 0, end: 30, text: `Distinct operative provision number ${index} shall retain its original condition and requires documented performance.`, kind: 'operative', function_tags: [index % 2 ? 'payment_cost' : 'performance'], selection_rank: index % 4 };
    return { id: unit.id, contract_id: contract, cohort, kind: unit.kind, payload: JSON.stringify(unit) };
  });
  const shard = await writeRows(run, 'input/units.parquet', rows, { schema });
  return { run, rows, manifest: { schema_version: 2, source: { sha256: sha256('synthetic extraction source') }, selected_units: count, shards: { units: [shard], sections: [] } } };
}

test('global admission balances contracts and keeps deterministic per-contract priorities', () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({ id: `u-${index}`, contract_id: `c-${Math.floor(index / 5)}`, selection_rank: index % 5 }));
  const first = balancedAdmission(rows, { seed: 'balanced', maxUnits: 9 });
  const second = balancedAdmission([...rows].reverse(), { seed: 'balanced', maxUnits: 9 });
  assert.deepEqual(first.selected.map((row) => row.id), second.selected.map((row) => row.id));
  assert.equal(first.selected.length, 9); assert.equal(first.excluded.length, 11);
  const counts = rows.reduce((result, row) => result.set(row.contract_id, first.selected.filter((selected) => selected.contract_id === row.contract_id).length), new Map());
  assert.ok(Math.max(...counts.values()) - Math.min(...counts.values()) <= 1);
  for (const id of counts.keys()) assert.ok(first.selected.some((row) => row.contract_id === id && row.selection_rank === 0));
  assert.ok(first.excluded.every((row) => row.reason === 'explicit_study_wide_unit_bound'));
});

test('Parquet admission enforces the global cap, preserves variant lineage and resumes exactly', async t => {
  const { run, manifest } = await fixture(t);
  const result = await prepareDiscovery(run, manifest, { maxUnits: 7, shardRows: 3 });
  assert.equal(result.counts.input_units, 12); assert.equal(result.counts.admitted_units, 7); assert.equal(result.counts.excluded_units, 5);
  assert.equal(result.gates.global_cap_enforced, true); assert.equal(result.gates.reserve_accessed, false);
  const representatives = await collect(readDiscoveryUnits(run, result)); assert.equal(representatives.length, result.counts.representatives);
  assert.ok(representatives.every((unit) => unit.parent_section_id && unit.family_id && unit.template_blocking_id && unit.admission_source.payload_sha256));
  const members = []; for (const shard of result.shards.membership) members.push(...await collect(readRows(run, shard.path)));
  assert.equal(members.length, 7);
  const excluded = []; for (const shard of result.shards.excluded) excluded.push(...await collect(readRows(run, shard.path)));
  assert.equal(excluded.length, 5);
  const again = await prepareDiscovery(run, manifest, { maxUnits: 7, shardRows: 3 }); assert.equal(again.resumed, true); assert.equal(again.source.sha256, result.source.sha256);
  assert.deepEqual(again.shards, result.shards); assert.ok(result.memory.peak.rss >= result.memory.start.rss);
});

test('declared input bounds fail the whole stage rather than accepting an arbitrary prefix', async t => {
  const { run, manifest } = await fixture(t);
  await assert.rejects(prepareDiscovery(run, manifest, { maxUnits: 4, maxInputRows: 8 }), /ADMISSION_INPUT_BOUND/);
});

test('reserve data and changed input bytes are refused before discovery', async t => {
  const reserve = await fixture(t, { reserve: true }); await assert.rejects(prepareDiscovery(reserve.run, reserve.manifest), /reserve input refused/);
  const actual = await fixture(t); await writeFile(join(actual.run, actual.manifest.shards.units[0].path), 'modified source shard');
  await assert.rejects(prepareDiscovery(actual.run, actual.manifest), /ADMISSION_INPUT_CHANGED/);
});

test('changed operating scope gets a distinct immutable stage identity', async t => {
  const { run, manifest } = await fixture(t);
  const first = await prepareDiscovery(run, manifest, { maxUnits: 6 }); const second = await prepareDiscovery(run, manifest, { maxUnits: 8 });
  assert.notEqual(first.source.sha256, second.source.sha256); assert.notEqual(first.manifest_path, second.manifest_path);
  assert.equal(first.counts.admitted_units, 6); assert.equal(second.counts.admitted_units, 8);
});

test('discovery leaves the declared confirmation and temporal capacity available',async t=>{const {run,manifest}=await fixture(t);await writeJSON(run,'main-unit-budget.json',{main_limit:7,discovery_limit:4,confirmation_limit:2,temporal_limit:1});await assert.rejects(prepareDiscovery(run,manifest,{maxUnits:5}),/reserved main-unit allocation/);const result=await prepareDiscovery(run,manifest);assert.equal(result.counts.admitted_units,4);assert.equal(result.parameters?.mainUnitBudget?.confirmation_limit??result.source.parameters.mainUnitBudget.confirmation_limit,2);});
