#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Compatibility entry point; both APKs use the same explicit preparation recipe.
import {prepareLauncherIcon} from './prepare-launcher-icon.mjs';

if (process.argv.length !== 3 || !['--write', '--check'].includes(process.argv[2])) throw new Error('Use --write to prepare, or --check to compare the reviewed launcher resource.');
await prepareLauncherIcon('participant', process.argv[2]);
