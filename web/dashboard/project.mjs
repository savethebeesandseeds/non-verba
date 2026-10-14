// SPDX-License-Identifier: AGPL-3.0-only
import {readFile, access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {validateManifest, validateHero, validateProject, flattenMilestones} from './model.js';

export const dashboardDirectory = dirname(fileURLToPath(import.meta.url));
export async function readProject(directory = dashboardDirectory) {
  const json = async file => JSON.parse((await readFile(resolve(directory, file), 'utf8')).replace(/^\uFEFF/, ''));
  const manifest = validateManifest(await json('manifest.json'));
  const heroes = await Promise.all(manifest.heroes.map(async entry => validateHero(await json(entry.file))));
  validateProject(manifest, heroes);
  const root = resolve(directory, '../..');
  for (const {milestone} of flattenMilestones(heroes)) for (const evidence of milestone.evidence || []) {
    await access(resolve(root, evidence.path.split('#')[0]));
  }
  return {manifest, heroes};
}
