// SPDX-License-Identifier: AGPL-3.0-only
// Source regression guards for the temporary visible-window build feature.
// Actual Android compilation and device window flags are verified separately.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';

assert.equal(process.platform, 'linux', 'Run only in the managed Debian container.');
assert.equal(process.env.NONVERBA_CONTAINER, '1', 'Use the managed container launcher.');
const source = async path => readFile(new URL(path, import.meta.url), 'utf8');
const activities = {
  developer:'../../android/app/src/main/kotlin/org/nonverba/camera/MainActivity.kt',
  participant:'../../android/participant/src/main/kotlin/org/nonverba/participant/ParticipantActivity.kt',
};
const routes = ['camera/index', 'location/location', 'location/live-location', 'audio/audio', 'keys/key-enrollment'];
const gpsRoutes = new Set(['camera/index', 'location/location', 'location/live-location']);
const keepFlag = 'WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON';

function method(text, name) {
  const marker = 'override fun ' + name + '()';
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, 'Missing lifecycle boundary ' + name);
  const tail = text.slice(start + marker.length);
  const next = tail.search(/\n    (?:(?:override|private|protected|internal)\s+)?fun\s/);
  return tail.slice(0, next < 0 ? undefined : next);
}

test('both APKs consume one strictly parsed build flag with a false fallback', async () => {
  const properties = await source('../../android/gradle.properties');
  assert.equal([...properties.matchAll(/^nonverba\.keepScreenAwake=true\s*$/gm)].length, 1);
  assert.equal([...properties.matchAll(/^nonverba\.keepScreenAwake\s*=/gm)].length, 1);
  for (const app of ['app','participant']) {
    const gradle = await source('../../android/' + app + '/build.gradle.kts');
    assert.match(gradle, /buildFeatures\s*\{\s*buildConfig\s*=\s*true\s*\}/, app);
    assert.match(gradle, /buildConfigField\("boolean",\s*"KEEP_SCREEN_AWAKE",\s*providers\.gradleProperty\("nonverba\.keepScreenAwake"\)\s*\.orElse\("false"\)\.get\(\)\.toBooleanStrict\(\)\.toString\(\)\)/, app);
    assert.doesNotMatch(gradle, /\.toBoolean\(\)/, 'Malformed property values must fail rather than silently becoming false.');
  }
});

test('both visible activities apply the build flag on start and reassert it on resume', async () => {
  for (const [app, path] of Object.entries(activities)) {
    const text = await source(path);
    for (const boundary of ['onStart','onResume']) {
      assert.match(method(text, boundary), /if\s*\(BuildConfig\.KEEP_SCREEN_AWAKE\)\s*window\.addFlags\(WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON\)\s*else\s*window\.clearFlags\(WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON\)/, app + ':' + boundary);
    }
    assert.equal([...text.matchAll(/window\.addFlags\(WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON\)/g)].length, 2,
      app + ': only the start and resume boundaries may enable wakefulness.');
    assert.doesNotMatch(text, /NativeScreenAwake|nativeScreenAwake|foreground-screen-awake-lease|nonverba:screen-awake/);
    assert.doesNotMatch(text, /newWakeLock|PowerManager|Settings\.System\.put/);
  }
});

test('pause preserves visible-window wakefulness and stop or destruction releases both flags', async () => {
  for (const [app, path] of Object.entries(activities)) {
    const text = await source(path);
    assert.ok(!method(text, 'onPause').includes(keepFlag),
      app + ': a paused activity may remain visible; screen wakefulness must not change here.');
    for (const boundary of ['onStop','onDestroy']) {
      const body = method(text, boundary);
      assert.ok(body.includes('window.clearFlags(' + keepFlag + ')'), app + ':' + boundary);
      assert.doesNotMatch(body, /window\.addFlags\(/, 'Background cleanup cannot re-enable the flag.');
    }
    const manifest = await source('../../android/' + (app === 'developer' ? 'app' : 'participant') + '/src/main/AndroidManifest.xml');
    assert.doesNotMatch(manifest, /android\.permission\.(?:WAKE_LOCK|WRITE_SETTINGS)/,
      'Screen wakefulness must remain a visible-window setting.');
  }
});

test('obsolete native and JavaScript lease controllers and their dedicated smoke harness are absent', async () => {
  for (const path of ['../../android/app/src/main/kotlin/org/nonverba/camera/NativeScreenAwake.kt',
    '../../../web/apps/non-verba-dev/src/common/screen-awake.js',
    '../../crates/nonverba-android/tests/NativeScreenAwakeSmoke.kt',
    '../../crates/nonverba-android/tests/run-native-screen-awake.sh']) {
    await assert.rejects(access(new URL(path, import.meta.url)), {code:'ENOENT'}, path);
  }
  const catalog = await source('../../../web/assets.json');
  assert.doesNotMatch(catalog, /screen-awake\.js|NativeScreenAwake/);
});

test('all five developer routes remove the obsolete toggle and retain strict script and style policy', async () => {
  for (const page of routes) {
    const html = await source('../../../web/apps/non-verba-dev/src/' + page + '.html');
    assert.doesNotMatch(html, /screen-awake-(?:toggle|status|note)|screen-awake\.js|Keep screen awake|NativeScreenAwake/, page);
    const policy = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1];
    assert.ok(policy, page + ': missing content policy');
    for (const directive of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "style-src-attr 'none'", "form-action 'none'"]) {
      assert.ok(policy.includes(directive), page + ': ' + directive);
    }
    assert.doesNotMatch(policy, /'unsafe-inline'|'unsafe-eval'/, page);
    assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>[^<\s]/i, page + ': no inline script fallback');
  }
});

test('the three GPS routes keep one empty hidden insertion anchor and the existing warmup module', async () => {
  for (const page of routes) {
    const html = await source('../../../web/apps/non-verba-dev/src/' + page + '.html');
    const anchors = [...html.matchAll(/<div\b[^>]*\bid="screen-awake"[^>]*>([\s\S]*?)<\/div>/g)];
    assert.equal(anchors.length, gpsRoutes.has(page) ? 1 : 0, page);
    if (gpsRoutes.has(page)) {
      assert.match(anchors[0][0], /\bhidden(?:\s|>)/, page);
      assert.equal(anchors[0][1].trim(), '', page + ': anchor must not display a control.');
      assert.match(html, /<script\s+type="module"\s+src="(?:\.\/|\.\.\/location\/)gps-warmup\.js"><\/script>/, page);
    }
  }
  const warmup = await source('../../../web/apps/non-verba-dev/src/location/gps-warmup.js');
  assert.match(warmup, /getElementById\('screen-awake'\)/);
  assert.match(warmup, /anchor\.after\(mount\)/);
});
