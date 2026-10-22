// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGradleLog, measurementErrors, summarizeBuildSamples, compareBuildBudget, compareBuildContexts} from '../../tools/build/android-build-metrics.mjs';

assert.equal(process.platform, 'linux', 'Run only inside non-verba-dev.');
assert.equal(process.env.NONVERBA_CONTAINER, '1', 'Run only inside non-verba-dev.');

// Synthetic observations retain the same task/log shape as Gradle without
// invoking Gradle, compilers, package inspectors or Android devices.
function observation(target = 'participant') {
  const module = target === 'participant' ? 'participant' : 'app';
  const names = target === 'participant'
    ? ['signer', 'android-source-sync', 'participant-assets', 'gradle']
    : ['signer', 'developer-web', 'developer-assets', 'developer-native', 'android-source-sync', 'gradle'];
  return {
    target, state:'completed', duration_ms:1500,
    export:{requested:false, state:'not-requested'},
    stages:names.map(name => ({name, status:'passed'})),
    packages:[{path:`/opt/nonverba-build/android/${module}/build/outputs/apk/debug/${module}-debug.apk`, bytes:2048, sha256:'a'.repeat(64)}],
    gradle:parseGradleLog(`> Task :${module}:verifySourceInputs\n> Task :${module}:compileDebugKotlin UP-TO-DATE\n> Task :${module}:packageDebug UP-TO-DATE\n3 actionable tasks: 1 executed, 2 up-to-date\n`),
  };
}

test('Gradle log parser retains task outcomes and the independent actionable summary', () => {
  const parsed = parseGradleLog([
    '\u001b[32m> Task :participant:verifyParticipantInputs\u001b[0m',
    '> Task :participant:compileDebugKotlin UP-TO-DATE',
    '> Task :participant:compileDebugJavaWithJavac NO-SOURCE',
    '> Task :participant:mergeDebugAssets FROM-CACHE',
    '> Task :participant:packageDebug UP-TO-DATE',
    '> Task :participant:lintReportDebug SKIPPED',
    '> Task :participant:lintDebug',
    'BUILD SUCCESSFUL in 2s',
    '5 actionable tasks: 2 executed, 1 from cache, 2 up-to-date',
  ].join('\n'));
  assert.deepEqual(parsed.tasks, [
    {path:':participant:verifyParticipantInputs', outcome:'EXECUTED'},
    {path:':participant:compileDebugKotlin', outcome:'UP-TO-DATE'},
    {path:':participant:compileDebugJavaWithJavac', outcome:'NO-SOURCE'},
    {path:':participant:mergeDebugAssets', outcome:'FROM-CACHE'},
    {path:':participant:packageDebug', outcome:'UP-TO-DATE'},
    {path:':participant:lintReportDebug', outcome:'SKIPPED'},
    {path:':participant:lintDebug', outcome:'EXECUTED'},
  ]);
  assert.equal(parsed.up_to_date_count, 2);
  assert.deepEqual(parsed.actionable, {total:5, executed:2, from_cache:1, up_to_date:2});
  assert.deepEqual(parseGradleLog('> Task :app:compileDebugKotlin FAILED\n').tasks,
    [{path:':app:compileDebugKotlin', outcome:'FAILED'}]);
  assert.deepEqual(parseGradleLog('1 actionable task: 1 executed\n').actionable,
    {total:1, executed:1, from_cache:0, up_to_date:0});
});

test('Gradle observations retain missing or inconsistent summaries as unavailable', () => {
  for (const text of ['', '> Task :app:assembleDebug\n', '3 actionable tasks: 1 executed, 1 up-to-date\n']) {
    assert.equal(parseGradleLog(text).actionable, null);
  }
  for (const change of [record => { record.gradle.actionable = null; }, record => { delete record.gradle.actionable; },
    record => { record.gradle.tasks = []; }]) {
    const record = observation(); change(record);
    assert.ok(measurementErrors(record).some(error => /Gradle/.test(error)));
  }
});

test('both application targets accept complete routine measurements and input verification freshness work', () => {
  for (const target of ['participant', 'developer']) {
    const record = observation(target), baseline = structuredClone(record);
    if (target === 'developer') {
      record.gradle.tasks.push(
        {path:':app:configureCMakeDebug[arm64-v8a]', outcome:'EXECUTED'},
        {path:':app:buildCMakeDebug[arm64-v8a]', outcome:'EXECUTED'},
      );
    }
    assert.deepEqual(measurementErrors(record), []);
    assert.deepEqual(measurementErrors(record, baseline, {unchanged:true}), []);
  }
});

test('unchanged measurements reject repeated expensive work while retaining reused task outcomes', () => {
  for (const name of ['compileDebugKotlin', 'compileDebugJavaWithJavac', 'mergeDebugAssets', 'compressDebugAssets',
    'packageDebug', 'dexBuilderDebug', 'mergeProjectDexDebug', 'lintAnalyzeDebug', 'generateDebugLintModel']) {
    const record = observation('developer'), baseline = structuredClone(record);
    const observed = record.gradle.tasks.find(task => task.path === ':app:' + name) || {path:':app:' + name};
    if (!record.gradle.tasks.includes(observed)) record.gradle.tasks.push(observed);
    observed.outcome = 'EXECUTED';
    assert.ok(measurementErrors(record, baseline, {unchanged:true}).some(error => /repeated/.test(error)), name);
    for (const outcome of ['UP-TO-DATE', 'FROM-CACHE', 'NO-SOURCE', 'SKIPPED']) {
      observed.outcome = outcome;
      assert.deepEqual(measurementErrors(record, baseline, {unchanged:true}), [], name + ' ' + outcome);
    }
  }
});

test('changed target stage graphs, incomplete work and package exports cannot become baseline samples', () => {
  const cases = [
    ['failed run', record => { record.state = 'failed'; }],
    ['combined target', record => { record.target = 'all'; }],
    ['extra preparation', record => { record.stages.splice(1, 0, {name:'developer-web', status:'passed'}); }],
    ['reordered preparation', record => { [record.stages[1], record.stages[2]] = [record.stages[2], record.stages[1]]; }],
    ['missing preparation', record => { record.stages.splice(2, 1); }],
    ['failed preparation', record => { record.stages[2].status = 'failed'; }],
    ['other application task', record => { record.gradle.tasks.push({path:':app:packageDebug', outcome:'UP-TO-DATE'}); }],
    ['failed task', record => { record.gradle.tasks[0].outcome = 'FAILED'; }],
    ['requested export', record => { record.export.requested = true; }],
    ['completed export', record => { record.export.state = 'verified'; }],
    ['missing package', record => { record.packages = []; }],
    ['two packages', record => { record.packages.push({...record.packages[0]}); }],
    ['empty package', record => { record.packages[0].bytes = 0; }],
    ['wrong application package', record => { record.packages[0].path = '/opt/nonverba-build/android/app/build/outputs/apk/debug/app-debug.apk'; }],
  ];
  for (const [name, change] of cases) {
    const record = observation(); change(record);
    assert.ok(measurementErrors(record).length > 0, name);
  }
});

test('CSS-only changes allow asset packaging and lint but refuse application recompilation and DEX work', () => {
  for (const target of ['participant', 'developer']) {
    const record = observation(target), module = target === 'participant' ? 'participant' : 'app';
    record.gradle.tasks.push({path:`:${module}:mergeDebugAssets`, outcome:'EXECUTED'},
      {path:`:${module}:packageDebug`, outcome:'EXECUTED'}, {path:`:${module}:lintAnalyzeDebug`, outcome:'EXECUTED'});
    assert.deepEqual(measurementErrors(record, null, {cssOnly:true}), []);
    for (const name of ['compileDebugKotlin', 'compileDebugJavaWithJavac', 'dexBuilderDebug', 'mergeProjectDexDebug']) {
      const task = {path:`:${module}:${name}`, outcome:'EXECUTED'};
      record.gradle.tasks.push(task);
      assert.ok(measurementErrors(record, null, {cssOnly:true}).some(error => /CSS-only/.test(error)), name);
      record.gradle.tasks.pop();
    }
  }
});

test('unchanged comparison requires the same application and observed APK bytes and digest', () => {
  const baseline = observation();
  for (const change of [
    record => { record.packages[0].sha256 = 'b'.repeat(64); },
    record => { record.packages[0].bytes++; },
  ]) {
    const record = structuredClone(baseline); change(record);
    assert.ok(measurementErrors(record, baseline, {unchanged:true}).some(error => /APK bytes/.test(error)));
  }
  assert.ok(measurementErrors(observation('developer'), baseline, {unchanged:true}).some(error => /different target/.test(error)));
});

test('warm sample statistics retain median and range with an advisory variation allowance', () => {
  const sample = duration_ms => ({duration_ms, packages:[{bytes:2048}]});
  assert.deepEqual(summarizeBuildSamples([100, 10, 30].map(sample)), {
    samples:3, minimum_ms:10, maximum_ms:100, median_ms:30,
    review_above_ms:10100, apk_bytes:2048, apk_growth_review_bytes:0,
  });
  assert.deepEqual(summarizeBuildSamples([40000, 10000, 50000, 20000].map(sample)), {
    samples:4, minimum_ms:10000, maximum_ms:50000, median_ms:30000,
    review_above_ms:100000, apk_bytes:2048, apk_growth_review_bytes:0,
  });
  for (const durations of [[], [-1], [NaN], [Infinity]]) {
    assert.throws(() => summarizeBuildSamples(durations.map(sample)), /finite nonnegative durations/);
  }
});

test('budget comparison flags any APK growth and only timings beyond the retained advisory threshold', () => {
  const retained = {review_above_ms:12000, apk_bytes:2048};
  assert.deepEqual(compareBuildBudget({maximum_ms:12000, apk_bytes:2048}, retained), []);
  assert.deepEqual(compareBuildBudget({maximum_ms:1000, apk_bytes:2000}, retained), []);
  assert.deepEqual(compareBuildBudget({maximum_ms:12001, apk_bytes:2048}, retained),
    ['Warm build duration exceeded the retained review threshold.']);
  assert.deepEqual(compareBuildBudget({maximum_ms:12000, apk_bytes:2049}, retained), ['APK size grew by 1 bytes.']);
  assert.equal(compareBuildBudget({maximum_ms:12001, apk_bytes:2049}, retained).length, 2);
});

test('unlike toolchains, platforms, dependency locks and sample policies are explicitly non-comparable', () => {
  const baseline = {node:'v22.0.0', platform:'linux', arch:'x64', tools:{cargo:'cargo 1.96.0'},
    cargo_lock_sha256:'a'.repeat(64), samples_per_target:2};
  assert.deepEqual(compareBuildContexts(structuredClone(baseline), baseline), []);
  for (const key of Object.keys(baseline)) {
    const current = structuredClone(baseline); current[key] = 'changed context';
    assert.deepEqual(compareBuildContexts(current, baseline), [key]);
  }
});
