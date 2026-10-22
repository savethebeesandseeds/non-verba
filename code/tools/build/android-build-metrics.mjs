// SPDX-License-Identifier: AGPL-3.0-only
// Pure measurement rules shared by build records and the retained workload suite.
export function parseGradleLog(text) {
  const clean = text.replace(/\x1b\[[\d;]*m/g, '');
  const tasks = [...clean.matchAll(/^> Task (:\S+?)(?: (UP-TO-DATE|FROM-CACHE|NO-SOURCE|SKIPPED|FAILED))?\s*$/gm)]
    .map(([, path, outcome]) => ({path, outcome:outcome || 'EXECUTED'}));
  const summary = /^(\d+) actionable tasks?: (.+)$/m.exec(clean);
  let actionable = null;
  if (summary) {
    actionable = {total:Number(summary[1]), executed:0, from_cache:0, up_to_date:0};
    for (const [, count, state] of summary[2].matchAll(/(\d+) (executed|from cache|up-to-date)/g)) {
      actionable[{executed:'executed', 'from cache':'from_cache', 'up-to-date':'up_to_date'}[state]] = Number(count);
    }
    if (actionable.executed + actionable.from_cache + actionable.up_to_date !== actionable.total) actionable = null;
  }
  return {up_to_date_count:tasks.filter(task => task.outcome === 'UP-TO-DATE').length, actionable, tasks};
}

const stagesFor = target => ['signer',
  ...(target === 'developer' ? ['developer-web', 'developer-assets', 'developer-native'] : []),
  'android-source-sync', ...(target === 'participant' ? ['participant-assets'] : []), 'gradle'];

export function measurementErrors(record, baseline, {unchanged = false, cssOnly = false} = {}) {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  require(['developer', 'participant'].includes(record.target), 'Measurement requires one application target.');
  require(record.state === 'completed', 'Build did not complete.');
  require(record.export?.requested === false && record.export.state === 'not-requested', 'Measurement unexpectedly exported packages.');
  require(JSON.stringify(record.stages?.map(stage => stage.name)) === JSON.stringify(stagesFor(record.target))
    && record.stages.every(stage => stage.status === 'passed'), 'Build performed a different target stage graph.');
  const apk = record.packages?.[0], filename = record.target === 'developer' ? 'app-debug.apk' : 'participant-debug.apk';
  require(record.packages?.length === 1 && Number.isSafeInteger(apk.bytes) && apk.bytes > 0
    && /^[a-f0-9]{64}$/.test(apk.sha256) && typeof apk.path === 'string' && apk.path.endsWith('/' + filename),
  'Measurement lacks one observed APK for its target.');
  require(record.gradle?.tasks?.length > 0 && Number.isSafeInteger(record.gradle.actionable?.total)
    && record.gradle.actionable.total > 0, 'Gradle task observations or actionable summary are missing.');
  const module = record.target === 'developer' ? 'app' : 'participant';
  require(record.gradle?.tasks?.every(task => task.path.startsWith(':' + module + ':') && task.outcome !== 'FAILED'),
    'Gradle ran tasks outside the selected application or retained a failed task.');
  if (unchanged && baseline) {
    require(record.target === baseline.target, 'No-change comparison uses a different target.');
    require(record.packages?.[0]?.sha256 === baseline.packages?.[0]?.sha256
      && record.packages?.[0]?.bytes === baseline.packages?.[0]?.bytes, 'Unchanged build changed the APK bytes.');
    // Input-verification tasks and external CMake/Ninja freshness checks may run
    // every time. Actual app compilation, asset repackaging, DEX and lint
    // analysis must retain Gradle's incremental result for unchanged inputs.
    const work = /:(?:compile\w*(?:Kotlin|Javac)|(?:merge|compress)\w*Assets|packageDebug|dexBuilderDebug|mergeProjectDexDebug|lintAnalyze\w*|generate\w*Lint\w*Model)$/;
    const repeated = (record.gradle?.tasks || []).filter(task => task.outcome === 'EXECUTED' && work.test(task.path));
    require(repeated.length === 0, 'Unchanged build repeated compilation/packaging/analysis: ' + repeated.map(task => task.path).join(', '));
  }
  if (cssOnly) {
    const unrelated = /:(?:compile\w*(?:Kotlin|Javac)|dexBuilderDebug|mergeProjectDexDebug)$/;
    const repeated = (record.gradle?.tasks || []).filter(task => task.outcome === 'EXECUTED' && unrelated.test(task.path));
    require(repeated.length === 0, 'CSS-only build repeated application compilation/DEX work: ' + repeated.map(task => task.path).join(', '));
  }
  return errors;
}

export function summarizeBuildSamples(records) {
  if (!records.length || records.some(record => !Number.isFinite(record.duration_ms) || record.duration_ms < 0)) {
    throw new Error('Build samples need finite nonnegative durations.');
  }
  const values = records.map(record => record.duration_ms).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2), maximum = values.at(-1);
  return {samples:values.length, minimum_ms:values[0], maximum_ms:maximum,
    median_ms:values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
    // A small warm sample cannot support a strict wall-clock gate. Leave room
    // for scheduling/JVM variation and flag excess cost for human review.
    review_above_ms:Math.max(2 * maximum, maximum + 10000),
    apk_bytes:records[0].packages[0].bytes, apk_growth_review_bytes:0};
}

export function compareBuildBudget(current, retained) {
  const review = [];
  if (current.maximum_ms > retained.review_above_ms) review.push('Warm build duration exceeded the retained review threshold.');
  if (current.apk_bytes > retained.apk_bytes) review.push('APK size grew by ' + (current.apk_bytes - retained.apk_bytes) + ' bytes.');
  return review;
}

export function compareBuildContexts(current, retained) {
  return ['node', 'platform', 'arch', 'tools', 'cargo_lock_sha256', 'samples_per_target']
    .filter(key => JSON.stringify(current[key]) !== JSON.stringify(retained[key]));
}
