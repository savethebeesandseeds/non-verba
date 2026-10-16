// SPDX-License-Identifier: AGPL-3.0-only
import {summarize} from '../src/model.js';
import {readProject} from './project.mjs';
import {updateStandalone} from './build-standalone.mjs';
if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Validate the dashboard inside the managed non-verba-dev container.');
const record = await readProject(), {heroes} = record;
const counts = summarize(heroes), goals = heroes.reduce((total, hero) => total + hero.goals.length, 0);
console.log(`Validated ${heroes.length} Heroes, ${goals} Goals, ${counts.total} Milestones (${counts.done} done, ${counts.active} in progress). All evidence file targets exist.`);
await updateStandalone(record, {check: process.argv.includes('--check')});
