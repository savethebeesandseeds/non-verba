// SPDX-License-Identifier: AGPL-3.0-only
import {readFile} from 'node:fs/promises';
import {readJSON,within,requireContainer} from '../../lib/common.mjs';
import {atomicJSON} from './workflow.mjs';
export async function freezeMainUnitBudget(runDir) {requireContainer();const budget=JSON.parse(await readFile(new URL('../main-unit-budget.json',import.meta.url),'utf8'));const recipe=await readJSON(within(runDir,'recipe.json'));if(budget.main_limit!==recipe.extraction.maxUnits||budget.discovery_limit+budget.confirmation_limit+budget.temporal_limit!==budget.main_limit)throw new Error('Main unit allocation differs from frozen resource ceiling');await atomicJSON(within(runDir,'main-unit-budget.json'),budget);return budget;}
