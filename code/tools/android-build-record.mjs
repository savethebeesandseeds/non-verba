#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Private per-invocation build observations; not reproducibility or device proof.
import {createHash, randomBytes} from 'node:crypto';
import {mkdir, readFile, stat, unlink, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseGradleLog} from './android-build-metrics.mjs';

const code = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const insist = (condition, message) => { if (!condition) throw new Error(message); };
const stages = ['signer', 'developer-web', 'developer-assets', 'developer-native',
  'android-source-sync', 'participant-assets', 'gradle', 'export-copy',
  'developer-inspection', 'participant-inspection'];
const iso = milliseconds => new Date(Number(milliseconds)).toISOString();
const save = (file, record) => writeFile(file, JSON.stringify(record, null, 2) + '\n');

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'start') {
    const [target, requested] = args;
    insist(args.length === 2 && ['developer', 'participant', 'all'].includes(target)
      && ['0', '1'].includes(requested), 'Invalid build-record start arguments.');
    insist(!process.env.NONVERBA_SOURCE_REVISION || /^[a-f0-9]{40}$/.test(process.env.NONVERBA_SOURCE_REVISION),
      'Invalid source revision.');
    insist(!process.env.NONVERBA_SOURCE_SNAPSHOT_SHA256 || /^[a-f0-9]{64}$/.test(process.env.NONVERBA_SOURCE_SNAPSHOT_SHA256),
      'Invalid source snapshot digest.');
    insist(process.env.NONVERBA_SOURCE_DIRTY === undefined || ['0', '1'].includes(process.env.NONVERBA_SOURCE_DIRTY),
      'Invalid source working-tree state.');
    const now = new Date();
    const run = 'android-build-' + now.toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(6).toString('hex');
    const file = join(code, 'artifacts/qa', run + '.json');
    const planned = stages.filter(name =>
      !(target === 'participant' && name.startsWith('developer-'))
      && !(target === 'developer' && ['participant-assets', 'participant-inspection'].includes(name))
      && !(requested === '0' && ['export-copy', 'developer-inspection', 'participant-inspection'].includes(name)));
    const record = {schema_version:1, run_id:run, target, state:'running', started_at_utc:now.toISOString(),
      source:{revision:process.env.NONVERBA_SOURCE_REVISION || null,
        dirty:process.env.NONVERBA_SOURCE_DIRTY === undefined ? null : process.env.NONVERBA_SOURCE_DIRTY === '1',
        snapshot_sha256:process.env.NONVERBA_SOURCE_SNAPSHOT_SHA256 || null},
      export:{requested:requested === '1', state:requested === '1' ? 'pending' : 'not-requested', directory:null},
      planned_stages:planned, skipped_stages:stages.filter(name => !planned.includes(name)), stages:[],
      gradle:{up_to_date_count:0, actionable:null, tasks:[]}, packages:[],
      limitations:['Timings describe this run; they do not establish a speed improvement.',
        'Assembly, lint and package inspection do not establish reproducibility, device acceptance or release readiness.']};
    await mkdir(dirname(file), {recursive:true});
    await writeFile(file, JSON.stringify(record, null, 2) + '\n', {flag:'wx'});
    process.stdout.write(file + '\n');
    return;
  }
  const [file, ...values] = args;
  insist(file, 'Build-record path is required.');
  const record = JSON.parse(await readFile(file, 'utf8'));
  if (command === 'stage') {
    const [name, exitCode, started, finished, log] = values;
    insist(values.length === 5 && record.state === 'running' && record.planned_stages.includes(name)
      && !record.stages.some(stage => stage.name === name) && /^\d+$/.test(exitCode)
      && /^\d+$/.test(started) && /^\d+$/.test(finished) && Number(finished) >= Number(started),
    'Invalid build stage observation.');
    record.stages.push({name, status:exitCode === '0' ? 'passed' : 'failed', exit_code:Number(exitCode),
      started_at_utc:iso(started), finished_at_utc:iso(finished), duration_ms:Number(finished) - Number(started), log});
    if (name === 'gradle') {
      const text = await readFile(log, 'utf8');
      record.gradle = parseGradleLog(text);
    }
    await save(file, record);
  } else if (command === 'finish') {
    const [state, ...packages] = values;
    insist(['completed', 'failed'].includes(state), 'Invalid build completion state.');
    if (state === 'completed') insist(record.planned_stages.every(name =>
      record.stages.some(stage => stage.name === name && stage.status === 'passed')), 'A required stage did not pass.');
    record.state = state;
    record.finished_at_utc = new Date().toISOString();
    record.duration_ms = Date.parse(record.finished_at_utc) - Date.parse(record.started_at_utc);
    record.packages = [];
    for (const path of packages) {
      try {
        const info = await stat(path);
        insist(info.isFile(), 'Expected APK file: ' + path);
        const bytes = await readFile(path);
        record.packages.push({path, bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex')});
      } catch (error) {
        if (state === 'completed') throw error;
        (record.package_observation_errors ??= []).push({path, error:error.message});
      }
    }
    if (record.export.requested) {
      record.export.state = state === 'completed' ? 'verified' : 'incomplete';
    }
    await save(file, record);
  } else if (command === 'export-start') {
    const [output] = values;
    insist(values.length === 1 && record.state === 'running' && record.export.requested
      && record.export.directory === null, 'Invalid export start observation.');
    record.export.directory = output;
    await save(file, record);
  } else if (command === 'manifest') {
    const [output] = values;
    insist(values.length === 1 && record.state === 'completed' && record.export.requested
      && record.export.state === 'verified' && record.export.directory === output, 'Export is not ready to finalize.');
    const marker = join(output, 'INCOMPLETE.txt');
    insist((await readFile(marker, 'utf8')).trim() === file, 'Export marker belongs to another invocation.');
    const manifest = join(output, 'build-manifest.json');
    // Remove only our marker. If final creation fails, restore the marker and
    // leave every partially exported artifact available for diagnosis.
    await unlink(marker);
    try { await writeFile(manifest, JSON.stringify(record, null, 2) + '\n', {flag:'wx'}); }
    catch (error) { await writeFile(marker, file + '\n', {flag:'wx'}); throw error; }
  } else throw new Error('Unknown build-record command.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
