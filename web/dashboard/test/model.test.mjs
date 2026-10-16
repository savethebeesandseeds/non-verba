// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  deriveGoalStatus, deriveHeroStatus, filterHeroes, flattenMilestones,
  loadHeroFiles, summarize, summarizeGoal, validateHero, validateManifest, validateProject,
} from '../src/model.js';

const DATE = '2026-10-14';
function milestone(id, status = 'proposed', changes = {}) {
  return {
    id, title: id.replaceAll('-', ' '), status,
    ...(status === 'blocked' ? { description: 'Waiting for verified physical-device access.' } : {}),
    ...(status === 'done' ? {
      acceptance: ['The described behavior has been demonstrated.'],
      evidence: [{ label: 'Validation record', path: 'docs/development/VALIDATION.md' }],
    } : {}),
    ...changes,
  };
}
function goal(milestones = [milestone('sensors-camera')], changes = {}) {
  return { id: 'sensors-quality', title: 'Evidence quality', milestones, ...changes };
}
function hero(goals = [goal()], changes = {}) {
  return {
    schemaVersion: 2, id: 'sensors', number: 1, title: 'Sensor hardening',
    summary: 'Reliable acquisition and inspectable evidence.', updatedAt: DATE, goals, ...changes,
  };
}
function manifest(heroes = [{ id: 'sensors', file: '01-sensors.json' }], changes = {}) {
  return { schemaVersion: 2, title: 'Non-verba heroes', description: 'Goals and milestones.', heroes, ...changes };
}
function jsonFile(value, name = 'sensors.json', changes = {}) {
  const content = JSON.stringify(value);
  return { name, size: Buffer.byteLength(content, 'utf8'), text: async () => content, ...changes };
}

test('small authoring records validate without requiring optional fields or mutating the source', () => {
  const index = manifest();
  const value = hero();
  const before = structuredClone(value);
  assert.equal(validateManifest(index), index);
  assert.equal(validateHero(value), value);
  assert.doesNotThrow(() => validateProject(index, [value]));
  assert.deepEqual(value, before);
  assert.deepEqual(Object.keys(value.goals[0].milestones[0]).sort(), ['id', 'status', 'title']);
  assert.doesNotThrow(() => validateHero(hero([goal([milestone('sensors-camera', 'ready', {
    description: 'Recover interrupted acquisition.', owner: null, updatedAt: DATE, completedAt: null,
    acceptance: ['Recovery retains inspectable attempts.'], evidence: [], dependsOn: [],
  })], { description: 'Assess quality without overstating authenticity.' })])));
});

test('empty planning Goals and Heroes remain visible without inventing Milestones', () => {
  const emptyGoalHero = hero([goal([])]), emptyHero = hero([]);
  assert.doesNotThrow(() => validateHero(emptyGoalHero));
  assert.equal(filterHeroes([emptyGoalHero]).length, 1);
  assert.equal(filterHeroes([emptyGoalHero], {query: 'Evidence quality'})[0].goals.length, 1);
  assert.equal(summarize(filterHeroes([emptyGoalHero])).total, 0);
  assert.deepEqual(filterHeroes([emptyGoalHero], {status: 'done'}), []);
  assert.deepEqual(filterHeroes([emptyGoalHero], {query: 'unrelated'}), []);
  assert.equal(filterHeroes([emptyHero]).length, 1);
});

test('fixed Heroes → Goals → Milestones depth rejects nested children and misplaced groups', () => {
  assert.throws(() => validateHero(hero([goal([milestone('sensors-camera', 'ready', { children: [] })])])));
  assert.throws(() => validateHero(hero([goal([], { goals: [goal()] })])));
  assert.throws(() => validateHero(hero([goal([goal()])])));
  assert.throws(() => validateHero(hero([], { items: [] })));
  assert.throws(() => validateManifest({ schemaVersion: 1, title: 'Old record', description: 'Old shape', categories: [] }));
});

test('unknown fields, invalid states and wrong optional types fail clearly', () => {
  for (const value of [
    milestone('sensors-camera', 'almost_done'),
    milestone('sensors-camera', 'ready', { privateNote: 'Unspecified field' }),
    milestone('sensors-camera', 'ready', { owner: 123 }),
    milestone('sensors-camera', 'ready', { acceptance: [''] }),
    milestone('sensors-camera', 'ready', { dependsOn: null }),
  ]) assert.throws(() => validateHero(hero([goal([value])])));
  const missing = hero();
  delete missing.goals[0].milestones[0].status;
  assert.throws(() => validateHero(missing));
  assert.throws(() => validateManifest(manifest(undefined, { updatedAt: DATE })));
});

test('done requires acceptance and evidence while unknown historical completion dates stay absent or null', () => {
  const recorded = hero([goal([milestone('sensors-camera', 'done')])]);
  assert.doesNotThrow(() => validateHero(recorded));
  assert.equal(Object.hasOwn(recorded.goals[0].milestones[0], 'completedAt'), false);
  assert.doesNotThrow(() => validateHero(hero([goal([milestone('sensors-camera', 'done', { completedAt: null })])])));
  for (const changes of [{ evidence: [] }, { acceptance: [] }, { evidence: undefined }, { acceptance: undefined }]) {
    assert.throws(() => validateHero(hero([goal([milestone('sensors-camera', 'done', changes)])])));
  }
  assert.throws(() => validateHero(hero([goal([milestone('sensors-camera', 'ready', { completedAt: '2026-10-13' })])])));
});

test('blocked milestones must explain what prevents progress', () => {
  assert.doesNotThrow(() => validateHero(hero([goal([milestone('sensors-camera', 'blocked')])])));
  for (const description of [undefined, '', '   ']) {
    assert.throws(() => validateHero(hero([goal([milestone('sensors-camera', 'blocked', { description })])])));
  }
});

test('calendar dates are real and completion uses the milestone date or falls back to the hero date', () => {
  assert.doesNotThrow(() => validateHero(hero([goal([milestone('sensors-camera', 'done', { completedAt: '2024-02-29' })])])));
  for (const date of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-1-01', '14/10/2026']) {
    assert.throws(() => validateHero(hero([goal([milestone('sensors-camera', 'done', { completedAt: date })])])));
    assert.throws(() => validateHero(hero(undefined, { updatedAt: date })));
  }
  assert.throws(() => validateHero(hero([goal([milestone('sensors-camera', 'ready', { updatedAt: '2026-10-15' })])])));
  assert.throws(() => validateHero(hero([goal([milestone('sensors-camera', 'done', { completedAt: '2026-10-15' })])])));
  assert.throws(() => validateHero(hero([goal([milestone('sensors-camera', 'done', { updatedAt: '2026-10-12', completedAt: '2026-10-13' })])])));
});

test('evidence paths stay inside the repository and Hero files beside the dashboard', () => {
  for (const path of [
    'https://example.com/claim', 'javascript:alert(1)', '//example.com/claim',
    '/docs/README.md', '../private-source/README.md', 'docs/../README.md',
    'C:/Work/Non-verba/README.md', 'docs\\README.md', 'docs/%2e%2e/README.md',
  ]) assert.throws(() => validateHero(hero([goal([milestone('sensors-camera', 'ready', {
    evidence: [{ label: 'Evidence', path }],
  })])])), path);
  assert.doesNotThrow(() => validateHero(hero([goal([milestone('sensors-camera', 'ready', {
    evidence: [{ label: 'Acceptance note', path: 'docs/development/VALIDATION.md#sensor-checks' }],
  })])])));
  for (const file of ['../outside.json', '/heroes/sensors.json', 'https://example.com/sensors.json', 'categories/01-sensors.json', 'heroes/01-sensors.json']) {
    assert.throws(() => validateManifest(manifest([{ id: 'sensors', file }])));
  }
});

test('manifest identity, order and unique hero numbers remain consistent', () => {
  const one = hero();
  const two = hero([goal([milestone('identity-enrollment')], { id: 'identity-continuity' })], { id: 'identity', number: 2, title: 'Identity' });
  const index = manifest([{ id: 'sensors', file: '01-sensors.json' }, { id: 'identity', file: '02-identity.json' }]);
  assert.doesNotThrow(() => validateProject(index, [one, two]));
  assert.throws(() => validateProject(index, [two, one]));
  assert.throws(() => validateProject(index, [one]));
  assert.throws(() => validateProject(index, [one, { ...two, number: 1 }]));
});

test('IDs cannot collide across heroes, goals or milestones', () => {
  for (const value of [
    hero([goal([milestone('sensors')])]),
    hero([goal([milestone('sensors-quality')])]),
    hero([goal(), goal([milestone('sensors-audio')])]),
    hero([goal([milestone('sensors-camera'), milestone('sensors-camera')])]),
  ]) assert.throws(() => validateProject(manifest(), [value]));
  const index = manifest([{ id: 'sensors', file: '01-sensors.json' }, { id: 'identity', file: '02-identity.json' }]);
  assert.throws(() => validateProject(index, [hero(), hero([goal([milestone('sensors-camera')], { id: 'identity-continuity' })], { id: 'identity', number: 2 })]));
});

test('dependencies reference milestones only and cannot be missing, repeated, self-referential or cyclic', () => {
  for (const dependsOn of [['absent-milestone'], ['sensors-quality'], ['sensors'], ['sensors-camera'], ['sensors-audio', 'sensors-audio']]) {
    assert.throws(() => validateProject(manifest(), [hero([goal([
      milestone('sensors-camera', 'ready', { dependsOn }), milestone('sensors-audio', 'done'),
    ])])]));
  }
  assert.throws(() => validateProject(manifest(), [hero([goal([
    milestone('sensors-camera', 'ready', { dependsOn: ['sensors-audio'] }),
    milestone('sensors-audio', 'ready', { dependsOn: ['sensors-camera'] }),
  ])])]));
  assert.doesNotThrow(() => validateProject(manifest(), [hero([goal([
    milestone('sensors-camera', 'ready', { dependsOn: ['sensors-audio'] }), milestone('sensors-audio', 'done'),
  ])])]));
});

test('flattening keeps the Hero and Goal context and counts every milestone once', () => {
  const first = goal([milestone('sensors-camera', 'done'), milestone('sensors-gps', 'blocked')]);
  const second = goal([milestone('sensors-audio', 'in_progress'), milestone('sensors-replay', 'ready'), milestone('sensors-probe')], { id: 'sensors-lifecycle' });
  const value = hero([first, second]);
  const rows = flattenMilestones([value]);
  assert.deepEqual(rows.map(({ milestone: entry, hero: parent, goal: group }) => [entry.id, parent.id, group.id]), [
    ['sensors-camera', 'sensors', 'sensors-quality'], ['sensors-gps', 'sensors', 'sensors-quality'],
    ['sensors-audio', 'sensors', 'sensors-lifecycle'], ['sensors-replay', 'sensors', 'sensors-lifecycle'],
    ['sensors-probe', 'sensors', 'sensors-lifecycle'],
  ]);
  assert.equal(rows[0].hero, value);
  assert.equal(rows[0].goal, first);
  assert.deepEqual(summarize([value]), {
    total: 5, done: 1, active: 1, blocked: 1, ready: 1, proposed: 1,
    counts: { proposed: 1, ready: 1, in_progress: 1, blocked: 1, done: 1 },
  });
  assert.equal(summarizeGoal(first).total, 2);
  assert.equal(summarizeGoal(first).blocked, 1);
  assert.equal(summarize([]).total, 0);
});

test('Hero and Goal states derive consistently from milestone states', () => {
  for (const [states, expected] of [
    [['done', 'done'], 'done'], [['done', 'ready'], 'in_progress'],
    [['proposed', 'in_progress'], 'in_progress'], [['in_progress', 'blocked'], 'blocked'],
    [['proposed', 'ready'], 'ready'], [['proposed'], 'proposed'], [[], 'proposed'],
  ]) {
    const group = goal(states.map((state, index) => milestone(`sensors-task-${index}`, state)));
    assert.equal(deriveGoalStatus(group), expected);
    assert.equal(deriveHeroStatus(hero([group])), expected);
  }
});

test('filters prune milestones while retaining their Hero and Goal without mutation', () => {
  const value = hero([
    goal([milestone('sensors-recovery', 'done', { title: 'Recover interrupted acquisition' }), milestone('sensors-physical', 'ready')]),
    goal([milestone('sensors-audio', 'done')], { id: 'sensors-lifecycle', title: 'Acquisition lifecycle' }),
  ]);
  const before = structuredClone(value);
  const matches = filterHeroes([value], { query: 'RECOVER', status: 'done', heroId: 'sensors' });
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].goals.map(({ id }) => id), ['sensors-quality']);
  assert.deepEqual(matches[0].goals[0].milestones.map(({ id }) => id), ['sensors-recovery']);
  assert.deepEqual(value, before);
  assert.notEqual(matches[0], value);
  assert.notEqual(matches[0].goals[0], value.goals[0]);
  assert.deepEqual(filterHeroes([value], { query: 'no such milestone', status: 'done' }), []);
  assert.deepEqual(filterHeroes([value], { heroId: 'identity' }), []);
});

test('matching a Hero or Goal title exposes that scope and the status filter still narrows milestones', () => {
  const value = hero([goal([milestone('sensors-camera', 'done'), milestone('sensors-gps', 'ready')])]);
  assert.equal(flattenMilestones(filterHeroes([value], { query: 'Sensor hardening' })).length, 2);
  assert.equal(flattenMilestones(filterHeroes([value], { query: 'Evidence quality' })).length, 2);
  assert.deepEqual(flattenMilestones(filterHeroes([value], { query: 'Evidence quality', status: 'ready' })).map(({ milestone: entry }) => entry.id), ['sensors-gps']);
});

test('selected local JSON files sort by Hero number and synthesize a consistent manifest', async () => {
  const identity = hero([goal([milestone('identity-enrollment')], { id: 'identity-continuity' })], { id: 'identity', number: 2 });
  const result = await loadHeroFiles([jsonFile(identity, 'second.json'), jsonFile(hero(), 'first.json')]);
  assert.deepEqual(result.heroes.map(({ id }) => id), ['sensors', 'identity']);
  assert.deepEqual(result.errors, []);
  assert.doesNotThrow(() => validateProject(result.manifest, result.heroes));
  assert.equal(result.manifest.heroes[0].id, 'sensors');
  assert.ok(result.manifest.heroes[0].file.endsWith('01-sensors.json'));
  assert.ok(result.manifest.heroes[1].file.endsWith('02-identity.json'));
});

test('malformed or unreadable selections produce visible errors while valid Heroes remain readable', async () => {
  for (const bad of [
    jsonFile({ schemaVersion: 999 }, 'bad.json'),
    jsonFile(null, 'bad.json', { text: async () => '{invalid JSON' }),
    jsonFile(null, 'bad.json', { text: async () => { throw new Error('File permission denied'); } }),
    jsonFile(hero(), 'bad.txt'),
  ]) {
    const partial = await loadHeroFiles([jsonFile(hero()), bad]);
    assert.deepEqual(partial.heroes.map(({ id }) => id), ['sensors']);
    assert.ok(partial.errors.some(({ file, message }) => file === bad.name && typeof message === 'string' && message.length > 0));
  }
});

test('dependency failures remain visible while individually valid Heroes stay inspectable', async () => {
  const result = await loadHeroFiles([jsonFile(hero([goal([milestone('sensors-camera', 'ready', { dependsOn: ['missing-enrollment'] })])]))]);
  assert.equal(result.heroes.length, 1);
  assert.ok(result.errors.length > 0);
  assert.ok(result.errors.every(({ file, message }) => typeof file === 'string' && typeof message === 'string' && message.length > 0));
});

test('empty, absent and entirely invalid selections fail without implying an empty project', async () => {
  await assert.rejects(loadHeroFiles([]));
  await assert.rejects(loadHeroFiles(undefined));
  await assert.rejects(loadHeroFiles([jsonFile({ schemaVersion: 999 })]));
  await assert.rejects(loadHeroFiles([jsonFile(hero(), 'not-json.txt')]));
});

test('file count and four-MiB limits reject oversized input before reading it', async () => {
  await assert.rejects(loadHeroFiles(Array.from({ length: 101 }, () => jsonFile(hero()))));
  let readOversized = false;
  const oversized = jsonFile(hero(), 'too-large.json', {
    size: 4 * 1024 * 1024 + 1,
    text: async () => { readOversized = true; return JSON.stringify(hero()); },
  });
  const partial = await loadHeroFiles([jsonFile(hero()), oversized]);
  assert.deepEqual(partial.heroes.map(({ id }) => id), ['sensors']);
  assert.ok(partial.errors.some(({ file }) => file === 'too-large.json'));
  assert.equal(readOversized, false);
});

test('fresh selections read current bytes rather than retaining an earlier file snapshot', async () => {
  const value = hero();
  let contents = JSON.stringify(value);
  const selected = { name: 'sensors.json', text: async () => contents };
  assert.equal((await loadHeroFiles([selected])).heroes[0].title, 'Sensor hardening');
  contents = JSON.stringify({ ...value, title: 'Updated sensor goals' });
  assert.equal((await loadHeroFiles([selected])).heroes[0].title, 'Updated sensor goals');
});

test('ordinary Windows-authored JSON can include a UTF-8 BOM and an uppercase extension', async () => {
  const result = await loadHeroFiles([jsonFile(hero(), 'sensors.JSON', {
    text: async () => '\uFEFF' + JSON.stringify(hero()),
  })]);
  assert.equal(result.heroes[0].id, 'sensors');
  assert.deepEqual(result.errors, []);
});

test('duplicate selected Heroes are reported without silently discarding individually valid records', async () => {
  const result = await loadHeroFiles([jsonFile(hero(), 'first.json'), jsonFile(hero(), 'duplicate.json')]);
  assert.equal(result.heroes.length, 2);
  assert.ok(result.errors.length > 0);
});

test('the maintained eleven-Hero dataset validates its fixed hierarchy and existing evidence links', async () => {
  const dataRoot = new URL('../', import.meta.url);
  const repositoryRoot = new URL('../../../', import.meta.url);
  const index = JSON.parse(await readFile(new URL('manifest.json', dataRoot), 'utf8'));
  validateManifest(index);
  assert.equal(index.heroes.length, 11, 'Maintain one JSON file for each documented Hero.');
  const heroes = await Promise.all(index.heroes.map(async ({ file }) => JSON.parse(await readFile(new URL(file, dataRoot), 'utf8'))));
  assert.doesNotThrow(() => validateProject(index, heroes));
  assert.ok(flattenMilestones(heroes).length > 0);
  for (const { milestone: entry } of flattenMilestones(heroes)) for (const evidence of entry.evidence || []) {
    await assert.doesNotReject(access(new URL(evidence.path.split('#')[0], repositoryRoot)), `${entry.id}: missing evidence path ${evidence.path}`);
  }
});
