// SPDX-License-Identifier: AGPL-3.0-only
// Fixed version-2 hierarchy: Hero -> Goal -> Milestone. Only milestones have states.
export const STATUS_LABELS = Object.freeze({proposed: 'Proposed', ready: 'Ready', in_progress: 'In progress', blocked: 'Blocked', done: 'Done'});
export const STATUS_ORDER = Object.freeze(['in_progress', 'blocked', 'ready', 'proposed', 'done']);
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const insist = (condition, message) => { if (!condition) throw new Error(message); };
const text = (value, name) => insist(typeof value === 'string' && value.trim().length > 0, `${name} must be nonempty text`);
const id = (value, name) => insist(typeof value === 'string' && slug.test(value), `${name} must be a slug`);
function shape(value, required, optional, name) {
  insist(value !== null && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`);
  insist(required.every(key => Object.hasOwn(value, key)), `${name} is missing required fields`);
  insist(Object.keys(value).every(key => [...required, ...optional].includes(key)), `${name} has unknown fields`);
}
function date(value, name) {
  insist(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), `${name} must be a YYYY-MM-DD date`);
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  insist(Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value, `${name} must be a real calendar date`);
}
const array = (value, name, maximum = 2000) => insist(Array.isArray(value) && value.length <= maximum, `${name} must be a bounded array`);
function strings(value, name) { array(value, name); value.forEach(entry => text(entry, name)); }
export function isSafeEvidencePath(value) {
  if (typeof value !== 'string' || value.length > 500) return false;
  const [file, anchor, ...extra] = value.split('#');
  return extra.length === 0 && (!anchor || /^[a-zA-Z0-9_-]+$/.test(anchor)) &&
    /^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(file) && file.split('/').every(part => part !== '.' && part !== '..');
}
export function validateManifest(value) {
  shape(value, ['schemaVersion', 'title', 'description', 'heroes'], [], 'Manifest');
  insist(value.schemaVersion === 2, 'Unsupported manifest schemaVersion');
  text(value.title, 'Manifest title'); text(value.description, 'Manifest description');
  array(value.heroes, 'Manifest heroes', 100); insist(value.heroes.length > 0, 'Manifest heroes must not be empty');
  const ids = new Set(), files = new Set();
  for (const entry of value.heroes) {
    shape(entry, ['id', 'file'], [], 'Manifest Hero'); id(entry.id, 'Manifest Hero id');
    insist(typeof entry.file === 'string' && /^heroes\/[0-9]{2,3}-[a-z0-9-]+\.json$/.test(entry.file), 'Manifest Hero file must be a numbered JSON in heroes/');
    insist(!ids.has(entry.id) && !files.has(entry.file), 'Duplicate manifest Hero id or file');
    ids.add(entry.id); files.add(entry.file);
  }
  return value;
}
export function validateHero(hero) {
  shape(hero, ['schemaVersion', 'id', 'number', 'title', 'summary', 'updatedAt', 'goals'], [], 'Hero');
  insist(hero.schemaVersion === 2, 'Unsupported Hero schemaVersion'); id(hero.id, 'Hero id');
  insist(Number.isInteger(hero.number) && hero.number > 0 && hero.number <= 100, 'Hero number must be an integer from 1 to 100');
  text(hero.title, 'Hero title'); text(hero.summary, 'Hero summary'); date(hero.updatedAt, 'Hero updatedAt');
  array(hero.goals, 'Hero goals', 200);
  const ids = new Set([hero.id]); let count = 0;
  const unique = value => { id(value, 'Goal or Milestone id'); insist(!ids.has(value), `Duplicate id: ${value}`); ids.add(value); };
  for (const goal of hero.goals) {
    shape(goal, ['id', 'title', 'milestones'], ['description'], 'Goal'); unique(goal.id); text(goal.title, 'Goal title');
    if (Object.hasOwn(goal, 'description')) text(goal.description, 'Goal description');
    array(goal.milestones, 'Goal milestones');
    for (const milestone of goal.milestones) {
      insist(++count <= 2000, 'Hero milestone count exceeds limit');
      shape(milestone, ['id', 'title', 'status'], ['description', 'owner', 'updatedAt', 'completedAt', 'acceptance', 'evidence', 'dependsOn'], 'Milestone');
      unique(milestone.id); text(milestone.title, 'Milestone title');
      insist(Object.hasOwn(STATUS_LABELS, milestone.status), `Unknown Milestone status: ${milestone.status}`);
      if (Object.hasOwn(milestone, 'description')) text(milestone.description, 'Milestone description');
      if (Object.hasOwn(milestone, 'owner')) insist(milestone.owner === null || (typeof milestone.owner === 'string' && milestone.owner.trim()), 'Milestone owner must be text or null');
      if (Object.hasOwn(milestone, 'updatedAt')) { date(milestone.updatedAt, 'Milestone updatedAt'); insist(milestone.updatedAt <= hero.updatedAt, 'Hero updatedAt precedes a Milestone'); }
      if (milestone.completedAt != null) {
        date(milestone.completedAt, 'Milestone completedAt');
        insist(milestone.status === 'done' && milestone.completedAt <= (milestone.updatedAt || hero.updatedAt), 'Completion date requires done status and cannot follow updatedAt');
      }
      if (Object.hasOwn(milestone, 'acceptance')) strings(milestone.acceptance, 'Milestone acceptance');
      if (Object.hasOwn(milestone, 'dependsOn')) {
        strings(milestone.dependsOn, 'Milestone dependsOn');
        insist(new Set(milestone.dependsOn).size === milestone.dependsOn.length && milestone.dependsOn.every(dependency => slug.test(dependency) && dependency !== milestone.id), 'Dependencies must be distinct other Milestone IDs');
      }
      if (Object.hasOwn(milestone, 'evidence')) {
        array(milestone.evidence, 'Milestone evidence');
        for (const entry of milestone.evidence) {
          shape(entry, ['label', 'path'], [], 'Evidence'); text(entry.label, 'Evidence label');
          insist(isSafeEvidencePath(entry.path), `Unsafe evidence path: ${entry.path}`);
        }
      }
      if (milestone.status === 'done') insist(milestone.acceptance?.length > 0 && milestone.evidence?.length > 0, `Done Milestone ${milestone.id} requires acceptance criteria and evidence`);
      if (milestone.status === 'blocked') text(milestone.description, 'Blocked Milestone reason');
    }
  }
  return hero;
}
export function flattenMilestones(heroes) {
  return heroes.flatMap(hero => hero.goals.flatMap(goal => goal.milestones.map(milestone => ({milestone, hero, goal}))));
}
export function validateProject(manifest, heroes) {
  validateManifest(manifest); insist(heroes.length === manifest.heroes.length, 'Project Hero set differs from manifest');
  const numbers = new Set(), identifiers = new Set(), milestones = new Map();
  const unique = value => { insist(!identifiers.has(value), `Duplicate global id: ${value}`); identifiers.add(value); };
  heroes.forEach((hero, index) => {
    validateHero(hero); insist(hero.id === manifest.heroes[index].id, 'Hero ID or order differs from manifest');
    insist(!numbers.has(hero.number), 'Duplicate Hero number'); numbers.add(hero.number); unique(hero.id);
    for (const goal of hero.goals) { unique(goal.id); for (const milestone of goal.milestones) { unique(milestone.id); milestones.set(milestone.id, milestone); } }
  });
  for (const milestone of milestones.values()) for (const dependency of milestone.dependsOn || []) insist(milestones.has(dependency), `Missing Milestone dependency ${dependency} for ${milestone.id}`);
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    insist(!visiting.has(id), `Dependency cycle at ${id}`); if (visited.has(id)) return;
    visiting.add(id); (milestones.get(id).dependsOn || []).forEach(visit); visiting.delete(id); visited.add(id);
  }
  milestones.forEach((_, id) => visit(id));
}
function countMilestones(milestones) {
  const counts = Object.fromEntries(Object.keys(STATUS_LABELS).map(status => [status, 0]));
  milestones.forEach(milestone => counts[milestone.status]++);
  return {total: milestones.length, done: counts.done, active: counts.in_progress, blocked: counts.blocked, ready: counts.ready, proposed: counts.proposed, counts};
}
export const summarize = heroes => countMilestones(flattenMilestones(heroes).map(({milestone}) => milestone));
export const summarizeGoal = goal => countMilestones(goal.milestones);
function rollup({total, done, active, blocked, ready}) {
  if (total > 0 && done === total) return 'done';
  if (blocked > 0) return 'blocked';
  if (active > 0 || done > 0) return 'in_progress';
  return ready > 0 ? 'ready' : 'proposed';
}
export const deriveHeroStatus = hero => rollup(summarize([hero]));
export const deriveGoalStatus = goal => rollup(summarizeGoal(goal));
export function filterHeroes(heroes, {query = '', status = 'all', heroId = 'all'} = {}) {
  const needle = query.trim().toLocaleLowerCase();
  const contains = values => values.filter(Boolean).join(' ').toLocaleLowerCase().includes(needle);
  return heroes.flatMap(hero => {
    if (heroId !== 'all' && hero.id !== heroId) return [];
    const heroMatch = contains([hero.id, hero.title, hero.summary]);
    const goals = hero.goals.flatMap(goal => {
      const goalMatch = heroMatch || contains([goal.id, goal.title, goal.description]);
      const milestones = goal.milestones.filter(milestone => (status === 'all' || milestone.status === status) &&
        (goalMatch || contains([milestone.id, milestone.title, milestone.description, milestone.owner, ...(milestone.acceptance || []), ...(milestone.evidence || []).flatMap(entry => [entry.label, entry.path])])));
      const emptyPlanningGoal = goal.milestones.length === 0 && goalMatch && status === 'all';
      return milestones.length || emptyPlanningGoal ? [{...goal, milestones}] : [];
    });
    const emptyPlanningHero = hero.goals.length === 0 && heroMatch && status === 'all';
    return goals.length || emptyPlanningHero ? [{...hero, goals}] : [];
  });
}
export async function loadHeroFiles(files) {
  const selected = Array.from(files || []), errors = [];
  insist(selected.length > 0, 'Select the numbered Hero JSON files from web/dashboard/heroes.');
  insist(selected.length <= 100, 'Select at most 100 Hero JSON files.');
  const results = await Promise.allSettled(selected.map(async file => {
    insist(typeof file.name === 'string' && /\.json$/i.test(file.name), 'Select a Hero JSON file.');
    insist(typeof file.text === 'function', 'The selected file cannot be read.');
    insist(file.size == null || (Number.isFinite(file.size) && file.size >= 0 && file.size <= 4 * 1024 * 1024), 'Hero JSON exceeds the 4 MiB file limit.');
    const contents = await file.text();
    insist(typeof contents === 'string' && contents.length <= 4 * 1024 * 1024, 'Hero JSON exceeds the text limit.');
    return validateHero(JSON.parse(contents.replace(/^\uFEFF/, '')));
  }));
  const heroes = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') heroes.push(result.value);
    else errors.push({file: selected[index].name || 'Selected file', message: String(result.reason.message || result.reason)});
  });
  insist(heroes.length > 0, `No valid Hero JSON files were selected. ${errors.map(error => `${error.file}: ${error.message}`).join(' ')}`);
  heroes.sort((left, right) => left.number - right.number);
  const manifest = {
    schemaVersion: 2, title: 'Non Verba project dashboard', description: 'Heroes loaded from explicitly selected local JSON files.',
    heroes: heroes.map(hero => ({id: hero.id, file: `heroes/${String(hero.number).padStart(2, '0')}-${hero.id}.json`})),
  };
  try { validateProject(manifest, heroes); } catch (error) { errors.push({file: 'Selected Heroes', message: error.message}); }
  return {manifest, heroes, errors};
}
