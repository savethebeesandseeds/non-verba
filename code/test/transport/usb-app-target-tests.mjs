// SPDX-License-Identifier: AGPL-3.0-only
// Static guards and fixtures for actual fixed-package PowerShell source.
// This does not execute PowerShell, ADB, APK tooling or Android commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
if (process.platform !== 'linux' || process.env.NONVERBA_CONTAINER !== '1') throw new Error('Run inside non-verba-dev.');
if (process.argv.length !== 3) throw new Error('Supply the explicit reviewed usb-device.ps1 source path.');
const source = (await readFile(resolve(process.argv[2]), 'utf8')).replaceAll('\r\n', '\n');
function extract(pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `Actual helper ${label} missing or changed; review before adapting the guard.`);
  return match;
}
test('target selection is a fixed pair, developer remains default, and only bounded actions accept a target', () => {
  assert.match(source, /\[ValidateSet\('developer','participant'\)\]\s+\[string\]\$AppTarget = 'developer'/);
  const actions = extract(/\$targetActions = @\(([^)]+)\)/, 'target action allowlist')[1].match(/'[^']+'/g).map(value => value.slice(1, -1));
  assert.deepEqual(actions, ['AppStatus', 'AppWindowState', 'InstallVerified', 'Launch', 'AppUiState', 'AppScreenshot', 'AppUiBatch', 'AppTap', 'AppSwipe', 'AppBack', 'AppText']);
  for (const action of ['GpsDiagnostics', 'RestartApp', 'AppCameraChallenge', 'StageCameraOffer', 'AppDismissShare',
    'ExportEnrollments', 'ExportLocations', 'ExportCamera', 'ExportCameraSet', 'ExportCameraQuality', 'ExportCameraPairing',
    'ExportAudio', 'VerifySavedDownloads', 'Preview', 'Stop']) assert.ok(!actions.includes(action), `${action} remains developer-only.`);
  assert.match(source, /if \(\$PSBoundParameters\.ContainsKey\('AppTarget'\) -and \$Action -notin \$targetActions\) \{\s+throw /);
  assert.ok(source.indexOf('$targetActions =') < source.indexOf('foreach ($file in $approved.GetEnumerator())'), 'Reject unsupported targets before native tool validation or transport.');
  assert.match(source, /\$appPackage = if \(\$AppTarget -ceq 'participant'\) \{ 'org\.nonverba\.participant' \} else \{ 'org\.nonverba\.camera' \}/);
  assert.match(source, /\$appActivity = if \(\$AppTarget -ceq 'participant'\) \{ 'org\.nonverba\.participant\/\.ParticipantActivity' \} else \{ 'org\.nonverba\.camera\/\.MainActivity' \}/);
});
test('actual participant focus regex accepts only its own user-0 activity and semantic nodes use the selected package', () => {
  const pattern = extract(/\$appFocusPattern = if \(\$AppTarget -ceq 'participant'\) \{\s+'([^'\n]+)'/, 'participant focus regex')[1];
  const regex = new RegExp(pattern.replaceAll('\\A', '^').replaceAll('\\z', '$'));
  for (const activity of ['.ParticipantActivity', 'org.nonverba.participant.ParticipantActivity']) {
    assert.match(`mCurrentFocus=Window{abc u0 org.nonverba.participant/${activity}}`, regex);
  }
  for (const focus of ['mCurrentFocus=Window{abc u0 org.nonverba.camera/.MainActivity}',
    'mCurrentFocus=Window{abc u10 org.nonverba.participant/.ParticipantActivity}',
    'mCurrentFocus=Window{abc u0 org.nonverba.participant/.OtherActivity}',
    'mCurrentFocus=Window{abc u0 com.android.permissioncontroller/.GrantPermissionsActivity}']) assert.doesNotMatch(focus, regex);
  assert.match(source, /\$focusPattern = \$appFocusPattern/);
  assert.match(source, /\$pattern = \$appFocusPattern/);
  assert.match(source, /if \(\$element\.GetAttribute\('package'\) -cne \$appPackage\) \{ continue \}/);
});
test('focus failures classify only fixed project apps and system overlays without exposing unknown names', () => {
  const classifier = extract(/function Get-FixedAppFocusClassification\(\[string\]\$Focus, \[string\]\$User\) \{([\s\S]+?)\n\}/, 'redacted focus classifier')[1];
  const patterns = ['developerFocus', 'participantFocus', 'integrationFocus', 'overlayFocus'].map(name => {
    const value = extract(new RegExp('\\$' + name + " = '([^'\\n]+)'"), name)[1];
    return new RegExp(value.replaceAll('\\A', '^').replaceAll('\\z', '$'));
  });
  const labels = ['developer app', 'participant app', 'private integration test app', 'system overlay'];
  function classify(focus, user = '0') {
    if (/^[1-9][0-9]{0,5}$/.test(user)) return 'another Android user';
    if (user !== '0') return 'unknown Android user';
    const index = patterns.findIndex(pattern => pattern.test(focus));
    return index < 0 ? 'another window' : labels[index];
  }
  for (const [window, label] of [
    ['org.nonverba.camera/.MainActivity', 'developer app'],
    ['org.nonverba.participant/org.nonverba.participant.ParticipantActivity', 'participant app'],
    ['org.nonverba.serviceintegration/.MainActivity', 'private integration test app'],
    ['NotificationShade', 'system overlay'],
    ['com.android.systemui/.SomeOverlay', 'system overlay']
  ]) assert.equal(classify(`mCurrentFocus=Window{abc u0 ${window}}`), label);
  for (const value of ['mCurrentFocus=null', 'mCurrentFocus=Window{abc u0 secret.example/.Private}',
    'mCurrentFocus=Window{abc u0 org.nonverba.participant.other/.Private}',
    'mCurrentFocus=Window{abc u0 NotificationShade}\\nsecret.example',
    'mCurrentFocus=Window{abc u10 org.nonverba.participant/.ParticipantActivity}']) {
    assert.equal(classify(value), 'another window');
  }
  assert.equal(classify('unknown-window', '10'), 'another Android user');
  assert.equal(classify('unknown-window', ''), 'unknown Android user');
  assert.doesNotMatch(classifier, /Invoke-Bridge|Write-|Save-|throw|return \$(?:Focus|User)/);
  assert.match(classifier, /return 'another window'/);
  assert.equal([...source.matchAll(/Get-FixedAppFocusClassification \$focus(?:Before|After)? \$user/g)].length, 3);
  const state = extract(/function Get-AppUiState \{([\s\S]+?)\n\}/, 'semantic state focus diagnostics')[1];
  assert.match(state, /\$user -cne '0' -or \$focusBefore -cnotmatch \$focusPattern/);
  assert.match(state, /\$user -cne '0' -or \$focusAfter -cne \$focusBefore/);
});
test('routine semantic and screenshot inputs use selected own-app focus while native camera stays developer-only', () => {
  const focus = extract(/function Get-OwnUiFocus \{([\s\S]+?)\n\}/, 'routine own-app focus')[1];
  assert.match(focus, /\$user -cne '0' -or \$focus -cnotmatch \$appFocusPattern/);
  const input = extract(/\{ \$_ -cin @\('AppTap','AppSwipe','AppBack','AppText','AppDismissShare'\) \} \{([\s\S]+?)\n        \{ \$_ -cin @\('ExportEnrollments'/, 'standalone UI input')[1];
  assert.match(input, /\$ownFocusPattern = \$appFocusPattern/);
  assert.match(input, /\$user -cne '0' -or \$focusAgain -cne \$focus -or \$focusAgain -cnotmatch \$focusPattern/);
  assert.match(input, /\$stillInApp = \$user -ceq '0' -and \$focusAfter -cmatch \$ownFocusPattern/);
  const batch = extract(/'AppUiBatch' \{([\s\S]+?)\n        'AppScreenshot' \{/, 'semantic batch')[1];
  assert.match(batch, /if \(\$AppTarget -ceq 'developer' -and \$step\.action -ceq 'tap'\) \{/);
  assert.match(batch, /\$focusBefore = Get-OwnUiFocus/);
  assert.match(batch, /\$evidence\.focus_after = Get-OwnUiFocus/);
  assert.match(batch, /\$selectedNodes\.Count -ne 1/);
  assert.match(batch, /-not \$node\.enabled -or -not \$node\.clickable -or \$node\.password/);
  assert.match(batch, /-not \$node\.editable -or -not \$node\.focused/);
  const native = extract(/function Get-NativeCameraUiContainer\(\$State\) \{([\s\S]+?)\n\}/, 'native camera guard')[1];
  assert.match(native, /\$AppTarget -cne 'developer' -or \$State\.package -cne 'org\.nonverba\.camera'/);
});
test('short non-scrollable pages retain their own structural WebView without weakening viewport guards', () => {
  const state = extract(/function Get-AppUiState \{([\s\S]+?)\n\}/, 'semantic state parser')[1];
  const structuralClass = extract(/if \(\$node\.class -cne '([^']+)' -and -not \(\$node\.text -or \$node\['content-desc'\] -or \$node\['resource-id'\] -or \$node\.clickable -or \$node\.focused -or \$node\.scrollable -or \$node\.editable\)\) \{ continue \}/, 'structural viewport retention')[1];
  assert.equal(structuralClass, 'android.webkit.WebView');
  const useful = node => node.class === structuralClass || !!(node.text || node['content-desc'] || node['resource-id']
    || node.clickable || node.focused || node.scrollable || node.editable);
  const inert = {class: 'android.webkit.WebView', text: '', 'content-desc': '', 'resource-id': '',
    clickable: false, focused: false, scrollable: false, editable: false};
  assert.equal(useful(inert), true, 'inert WebView remains the viewport for useful descendant controls');
  assert.equal(useful({...inert, class: 'android.widget.TextView'}), false, 'other inert nodes remain omitted');
  assert.equal(useful({...inert, class: 'android.widget.Button', clickable: true}), true);
  assert.ok(state.indexOf("$element.GetAttribute('package') -cne $appPackage") < state.indexOf("$node.class -cne 'android.webkit.WebView'"));
  assert.ok(state.indexOf("$node.class -cne 'android.webkit.WebView'") < state.indexOf('if ($node.bounds -cnotmatch'));
  assert.match(state, /\$node\.bounds\[2\] -le \$node\.bounds\[0\] -or \$node\.bounds\[3\] -le \$node\.bounds\[1\]/);
  assert.match(state, /\$nodes\.Count -gt 512/);
  const viewport = extract(/function Get-AppUiViewport\(\$State, \[switch\]\$NativeCameraOnly\) \{([\s\S]+?)\n\}/, 'viewport checks')[1];
  assert.match(viewport, /\$_.class -ceq 'android.webkit.WebView' -and \$_.enabled/);
  assert.match(viewport, /\$views\.Count -ne 1/);
});
test('the identical-bound folding pass accepts only nested enabled own WebViews', () => {
  const state = extract(/function Get-AppUiState \{([\s\S]+?)\n\}/, 'semantic state parser')[1];
  assert.match(state, /\$validatedWebViews = New-Object 'Collections\.Generic\.HashSet\[Xml\.XmlElement\]'/);
  assert.match(state, /if \(\$node\.class -ceq 'android\.webkit\.WebView' -and \$node\.enabled\) \{/);
  assert.match(state, /\$ancestor = \$element\.ParentNode/);
  assert.match(state, /while \(\$ancestor -is \[Xml\.XmlElement\]\) \{/);
  assert.match(state, /\$validatedWebViews\.Contains\(\$ancestor\) -and\s+\$ancestor\.GetAttribute\('bounds'\) -ceq \$element\.GetAttribute\('bounds'\)/);
  assert.match(state, /\$ancestor = \$ancestor\.ParentNode/);
  assert.match(state, /\$retainedViewport = \$validatedWebViewNodes\[\$viewportAncestor\]/);
  assert.match(state, /\$retainedViewport\.scrollable = \$retainedViewport\.scrollable -or \$node\.scrollable\s+continue/);
  assert.match(state, /\$validatedWebViewNodes\.Add\(\$element,\$retainedNode\)/);
  assert.ok(state.indexOf('if ($node.bounds[2] -le') < state.indexOf('$duplicateViewport = $false'));
  assert.match(state, /foreach \(\$element in \$allNodes\)/, 'flattened traversal preserves children of omitted structural duplicates');
  const own = 'org.nonverba.participant', bounds = '[0,53][1080,2124]';
  const webview = parent => ({package: own, class: 'android.webkit.WebView', enabled: true, scrollable: false, bounds, parent});
  const host = webview(null), inner = {...webview(host), scrollable: true};
  const control = {package: own, class: 'android.widget.Button', enabled: true, bounds: '[40,300][1000,480]', parent: inner};
  function viewports(nodes) {
    const retained = [], validated = new Set();
    for (const node of nodes) {
      if (node.package !== own) continue;
      assert.match(node.bounds, /^\[\d{1,5},\d{1,5}\]\[\d{1,5},\d{1,5}\]$/);
      if (node.class === 'android.webkit.WebView' && node.enabled) {
        let duplicate = null;
        for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
          if (validated.has(ancestor) && ancestor.bounds === node.bounds) { duplicate = ancestor; break; }
        }
        if (duplicate) { duplicate.scrollable ||= node.scrollable; continue; }
        validated.add(node);
      }
      retained.push(node);
    }
    assert.equal(retained.filter(node => node.class === 'android.webkit.WebView' && node.enabled).length, 1, 'exactly one enabled viewport');
    return retained;
  }
  assert.deepEqual(viewports([host, inner, control]), [host, control], 'virtual document is collapsed while its control survives');
  assert.equal(host.scrollable, true, 'validated document scrollability survives on the retained viewport');
  assert.throws(() => viewports([host, webview(null)]), /exactly one enabled viewport/, 'identical sibling bounds remain ambiguous');
  assert.throws(() => viewports([host, {...inner, bounds: '[0,53][1080,2000]'}]), /exactly one enabled viewport/, 'different nested bounds are not merged by the identical-bound pass');
  const disabled = {...host, enabled: false}, child = webview(disabled);
  assert.deepEqual(viewports([disabled, child]), [disabled, child], 'disabled ancestor does not swallow enabled child');
  const foreign = {...host, package: 'other.app'}, ownChild = webview(foreign);
  assert.deepEqual(viewports([foreign, ownChild]), [ownChild], 'foreign ancestor cannot suppress own viewport');
});

test('contained document resolution requires raw hierarchy ownership and an inert host', () => {
  const resolver = extract(/function Resolve-AppUiDocumentViewport\([^\n]+\) \{([\s\S]+?)\n\}/, 'contained document resolver')[1];
  assert.match(resolver, /\$ViewNodes\.Count -ne 2/);
  assert.match(resolver, /\$views\.Count -ne 2/);
  assert.match(resolver, /\$isAncestor \$views\[0\] \$views\[1\]/);
  assert.match(resolver, /@\('text','content-desc','resource-id'\)/);
  assert.match(resolver, /@\('clickable','focused','scrollable','password'\)/);
  for (const [index, op] of [[0, 'lt'], [1, 'lt'], [2, 'gt'], [3, 'gt']]) {
    assert.match(resolver, new RegExp(`\\$inner\\.bounds\\[${index}\\] -${op} \\$outer\\.bounds\\[${index}\\]`));
  }
  assert.match(resolver, /\$isAncestor \$documentView \$element/);
  assert.match(resolver, /if \(-not \$scaffold\) \{ \$Diagnostics\.refusal_reason=\$outsideReason; \$Diagnostics\.refusal_detail=\$outsideDetail; return \$Nodes \}/);
  assert.match(resolver, /@\('android:id\/statusBarBackground','android:id\/navigationBarBackground'\)/);
  assert.match(resolver, /-not \$element\.HasChildNodes/);
  assert.match(resolver, /\$barBounds\[3\] -le \$outer\.bounds\[1\]/);
  assert.match(resolver, /\$barBounds\[2\] -ge \$barBounds\[0\] -and \$barBounds\[3\] -ge \$barBounds\[1\]/);
  assert.match(resolver, /\$barBounds\[2\] -eq \$barBounds\[0\] -or \$barBounds\[3\] -eq \$barBounds\[1\]/);
  assert.match(resolver, /'focusable','long-clickable','checkable','checked','selected'/);
  assert.doesNotMatch(resolver, /Abs\(|[Tt]olerance\s*=/);
  assert.match(source, /\$nodes = @\(Resolve-AppUiDocumentViewport \$allNodes \$validatedWebViewNodes \$nodes \$viewportDiagnostics\)/);
  assert.match(resolver, /\$Diagnostics\.raw_enabled_own_webviews = \$views\.Count/);
  assert.match(resolver, /refusal_reason='raw_count_not_two'/);
});
test('actual screenshot filename guards reject cross-target provenance and preserve legacy developer screenshots only', () => {
  const patterns = extract(/\$screenshotPattern = if \(\$AppTarget -ceq 'participant'\) \{\s+'([^'\n]+)'\s+\} else \{ '([^'\n]+)' \}/, 'target screenshot patterns');
  const participant = new RegExp(patterns[1]), developer = new RegExp(patterns[2]);
  const tail = '20261021T1200001234567Z-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png';
  assert.match(`app-screen-participant-${tail}`, participant);
  assert.doesNotMatch(`app-screen-participant-${tail}`, developer);
  for (const prefix of ['app-screen-', 'app-screen-developer-']) {
    assert.match(prefix + tail, developer); assert.doesNotMatch(prefix + tail, participant);
  }
  for (const pattern of [participant, developer]) for (const name of [`../app-screen-participant-${tail}`,
    `app-screen-camera-${tail}`, `app-screen-participant-${tail}.extra`,
    `app-screen-participant-${tail.replace('T1200001234567Z', 'T120000Z')}`]) assert.doesNotMatch(name, pattern);
  assert.match(source, /\$screenName = 'app-screen-' \+ \$AppTarget \+ '-'/);
  assert.match(source, /\$age -lt 0 -or \$age -gt \$maximumAge/);
  assert.match(source, /\$pngWidth -ne \$width -or \$pngHeight -ne \$height/);
  assert.match(source, /\$rotationAgain -cne \$rotationText/);
});
test('saved semantic state and returned input/batch summaries identify the selected target without broadening transport', () => {
  assert.match(source, /android_user_id=0;app_target=\$AppTarget;package=\$appPackage;activity=\$appActivity;focus=\$focusAfter/);
  assert.match(source, /app_target=\$AppTarget;package=\$appPackage;activity=\$appActivity;state=\$path/);
  assert.match(source, /app_target=\$AppTarget;package=\$appPackage;activity=\$appActivity;status=\$report\.status/);
  assert.match(source, /type='nonverba-ui-input';action=\$Action;input_sent=\$true;\s+app_target=\$AppTarget;package=\$appPackage;activity=\$appActivity/);
  assert.match(source, /\$approvedTransportRoot = \[IO\.Path\]::GetFullPath\(\(Join-Path \$codeRoot '\.\.\/\.\.\/private-source\/code'\)\)/);
  assert.match(source, /\$port = 5038/);
  assert.match(source, /& \$adb -H 127\.0\.0\.1 -P \$port @Arguments/);
  assert.match(source, /\$env:ADB_MDNS = '0'/);
  assert.match(source, /\$env:ADB_MDNS_AUTO_CONNECT = '0'/);
});
test('actual export path guards separate both app identities and reject traversal, suffixes and ordinary build outputs', () => {
  const patterns = [...source.matchAll(/\$exportPattern = '([^'\n]+)'/g)].map(match => new RegExp(match[1]));
  assert.equal(patterns.length, 2);
  const prefix = '/workspace/code/artifacts/container-builds/20261021T120000Z/';
  const participant = prefix + 'nonverba-participant-debug.apk', developer = prefix + 'nonverba-debug.apk';
  assert.match(participant, patterns[0]); assert.doesNotMatch(developer, patterns[0]);
  assert.match(developer, patterns[1]); assert.doesNotMatch(participant, patterns[1]);
  for (const pattern of patterns) for (const path of [participant + '.extra', developer + '.extra',
    prefix + '../nonverba-debug.apk', '/workspace/code/android/app/build/outputs/apk/debug/nonverba-debug.apk',
    '/workspace/code/artifacts/container-builds/20261021T120000Z-other/nonverba-debug.apk']) assert.doesNotMatch(path, pattern);
});
test('participant reports require their authentic schema fields, exact identity and retained signer; developer schema is preserved', () => {
  const checks = extract(/\$requiredChecks = if \(\$AppTarget -ceq 'participant'\) \{\s+@\(([^)]+)\)\s+\} else \{ @\(([^)]+)\) \}/, 'report check lists');
  const fields = text => text.match(/'[^']+'/g).map(value => value.slice(1, -1));
  assert.deepEqual(fields(checks[1]), ['passed', 'package_checks_passed', 'debug_signature_verified', 'same_debug_signer_as_baseline',
    'compiled_manifest_permissions_verified', 'zip_alignment_verified', 'license_source_notices_verified']);
  assert.deepEqual(fields(checks[2]), ['passed', 'package_checks_passed', 'current_linux_build_verified', 'signature_verified', 'same_signer_as_previous']);
  assert.match(source, /\$report\.\$field -isnot \[bool\] -or -not \$report\.\$field/);
  assert.match(source, /\$expectedSchema = if \(\$AppTarget -ceq 'participant'\) \{ 1 \} else \{ 2 \}/);
  assert.match(source, /\$report\.application_id -cne 'org\.nonverba\.participant' -or \$report\.package_kind -cne 'participant-shell-debug'/);
  assert.match(source, /\$report\.signing_certificate_sha256 -cne '7ed35bc9854def89ea0e3130865941b408c2a54d62b28e6ece7f01300bdc8649'/);
});
test('install and launch propagate target selection and exact hashes remain checked around streaming installation', () => {
  const install = extract(/'InstallVerified' \{([\s\S]+?)\n        'Launch' \{/, 'installation action')[1];
  assert.equal([...install.matchAll(/& \$PSCommandPath -Action AppStatus -AppTarget \$AppTarget/g)].length, 2);
  assert.equal([...install.matchAll(/Get-FileHash -LiteralPath \$apkPath -Algorithm SHA256/g)].length, 2);
  assert.match(install, /\$after\.installed_apk_sha256 -cne \$report\.sha256/);
  assert.match(install, /@\('-d','install','--user',\[string\]\$before\.android_user_id,'-r','--streaming',\$apkPath\)/);
  const launch = extract(/'Launch' \{([\s\S]+?)\n        'RestartApp' \{/, 'launch action')[1];
  assert.match(launch, /& \$PSCommandPath -Action AppStatus -AppTarget \$AppTarget/);
  assert.match(launch, /'-n',\$appActivity/);
});

const windowFunction = extract(/function Read-AppWindowFlags\(\[string\]\$Dump, \[string\]\$Focus\) \{([\s\S]+?)\n\}/, 'focused window parser')[1];
const windowPattern = name => {
  const pattern = extract(new RegExp('\\$' + name + " = '([^'\\n]+)'"), name)[1];
  return new RegExp(pattern.replace('(?m)', '').replaceAll('\\A', '^').replaceAll('\\z', '$'));
};
function fixtureWindowFlags(dump, focus) {
  // Fixtures use the production regexes; static assertions below separately
  // bind bounded capture, exact identity, ambiguity and return-field guards.
  const header = windowPattern('windowHeaderPattern');
  let selected = false, found = 0, lines = [];
  for (const line of dump.split(/\r?\n/)) {
    const match = header.exec(line);
    if (match) { selected = match[1] === focus.slice('mCurrentFocus='.length); if (selected) found++; continue; }
    if (selected) lines.push(line);
  }
  assert.equal(found, 1, 'exact focused own window');
  const block = lines.join('\n');
  const attr = [...block.matchAll(/^\s*mAttrs=(\{)/gm)];
  assert.equal(attr.length, 1, 'one attributes record');
  const start = attr[0].index + attr[0][0].length - 1;
  let depth = 0, end = -1;
  for (let i = start; i < block.length; i++) {
    if (block[i] === '{') depth++;
    else if (block[i] === '}' && --depth === 0) { end = i; break; }
  }
  assert.ok(end >= start, 'complete attributes');
  const flagPattern = new RegExp(windowPattern('flagsPattern').source.replace('(?m)', ''), 'gm');
  const matches = [...block.slice(start, end + 1).matchAll(flagPattern)];
  assert.equal(matches.length, 1, 'one flags field');
  const text = matches[0][1].trim(), numeric = windowPattern('numericFlagsPattern').exec(text);
  if (numeric) { const flags = Number.parseInt(numeric[1], 16); return {flags, keep_screen_on: (flags & 0x80) !== 0}; }
  assert.match(text, windowPattern('symbolicFlagsPattern'), 'supported flags format');
  const names = text.split(' ');
  assert.equal(new Set(names).size, names.length, 'no duplicate names');
  return {flags: null, keep_screen_on: names.includes('KEEP_SCREEN_ON')};
}
test('window observations select exact focus and handle numeric and symbolic flags without inventing numbers', () => {
  const own = 'Window{abc u0 org.nonverba.participant/org.nonverba.participant.ParticipantActivity}';
  const focus = `mCurrentFocus=${own}`;
  const dump = flags => `  Window #0 Window{other u0 other.app/.Other}:\n    mAttrs={ fl=80}\n  Window #1 ${own}:\n    mAttrs={(0,0)(fillxfill) sim={adjust=resize}\n      fl=${flags}\n    }\n`;
  assert.deepEqual(fixtureWindowFlags(dump('81810180'), focus), {flags: 0x81810180, keep_screen_on: true});
  assert.deepEqual(fixtureWindowFlags(dump('0x81810100'), focus), {flags: 0x81810100, keep_screen_on: false});
  assert.deepEqual(fixtureWindowFlags(dump('LAYOUT_IN_SCREEN KEEP_SCREEN_ON HARDWARE_ACCELERATED'), focus), {flags: null, keep_screen_on: true});
  assert.deepEqual(fixtureWindowFlags(dump('LAYOUT_IN_SCREEN HARDWARE_ACCELERATED'), focus), {flags: null, keep_screen_on: false});
  assert.deepEqual(fixtureWindowFlags(dump('NOT_KEEP_SCREEN_ON'), focus), {flags: null, keep_screen_on: false});
  assert.throws(() => fixtureWindowFlags(dump('KEEP_SCREEN_ON').replaceAll(own, own.replace('u0 ', 'u10 ')), focus), /exact focused own window/);
  assert.throws(() => fixtureWindowFlags(dump('80') + dump('80'), focus), /exact focused own window/);
  for (const flags of ['', '0xzz', 'KEEP_SCREEN_ON KEEP_SCREEN_ON', 'KEEP_SCREEN_ON;OTHER', 'keep_screen_on']) {
    assert.throws(() => fixtureWindowFlags(dump(flags), focus));
  }
  assert.throws(() => fixtureWindowFlags(dump('80').replace('fl=80\n', 'fl=80\n      fl=0\n'), focus), /one flags field/);
  assert.throws(() => fixtureWindowFlags(dump('80').replace('    }\n', ''), focus), /complete attributes/);
});
test('window diagnostic is bounded, read only, guarded around observation and never emits raw inventory', () => {
  assert.match(windowFunction, /\$Focus -cnotmatch \$appFocusPattern/);
  assert.match(windowFunction, /\$Matches\[1\] -ceq \$focusedWindow/);
  assert.match(windowFunction, /\$matchesFound -ne 1/);
  assert.match(windowFunction, /\$attributes\.Count -ne 1/);
  assert.match(windowFunction, /\$flagMatches\.Count -ne 1/);
  assert.match(windowFunction, /\$flags -band \[uint32\]0x80/);
  assert.match(windowFunction, /\$names -ccontains 'KEEP_SCREEN_ON'/);
  const action = extract(/'AppWindowState' \{([\s\S]+?)\n        'GpsDiagnostics' \{/, 'window action')[1];
  assert.match(action, /\$focus = Get-OwnUiFocus/);
  assert.match(action, /\(Get-OwnUiFocus\) -cne \$focus/);
  assert.match(action, /dumpsys window windows \| head -c 262145 \| base64/);
  assert.match(action, /\$bytes\.Length -gt 262144/);
  assert.match(action, /\[Convert\]::ToBase64String\(\$bytes\) -cne \$encoded/);
  assert.match(action, /input_sent=\$false;sensors_started=\$false/);
  assert.match(action, /finally \{ \$dump = \$null; \$encoded = \$null; \$bytes = \$null \}/);
  assert.doesNotMatch(action, /Save-AppUiJson|WriteAll|input','|settings','put|raw_dump|raw_windows/);
});

const timeoutFunction = extract(/function Read-ConfiguredScreenOffTimeoutMs\(\[string\]\$Text\) \{([\s\S]+?)\n\}/, 'configured timeout parser')[1];
function fixtureConfiguredTimeout(text) {
  const pattern = extract(/\$screenOffTimeoutPattern = '([^'\n]+)'/, 'configured timeout scalar pattern')[1];
  // Use a true end-of-input assertion: JS $ alone also permits a final newline.
  const exact = new RegExp(pattern.replaceAll('\\A', '^').replaceAll('\\z', '(?![\\s\\S])'));
  const value = text ?? '';
  if (value.length > 64) return null;
  const match = exact.exec(value);
  if (!match) return null;
  const milliseconds = Number(match[1]);
  return milliseconds <= 2147483647 ? milliseconds : null;
}
test('configured timeout retains only one positive bounded decimal scalar and never invents unavailable values', () => {
  assert.match(timeoutFunction, /\$Text\.Length -gt 64 -or \$Text -cnotmatch \$screenOffTimeoutPattern/);
  assert.match(timeoutFunction, /\$value = \[int64\]\$Matches\[1\]/);
  assert.match(timeoutFunction, /\$value -gt 2147483647/);
  assert.doesNotMatch(timeoutFunction, /Invoke-Bridge|Write-|Save-|throw|Trim\(|return \$Text/);
  for (const [text, expected] of [['1', 1], ['60000', 60000], ['60000\n', 60000],
    ['60000\r\n', 60000], ['2147483647', 2147483647]]) {
    assert.equal(fixtureConfiguredTimeout(text), expected);
  }
  for (const text of [null, '', 'null', '0', '00060', '+60000', '-1', ' 60000', '60000 ',
    '60000\n60000', '60000\n\n', '60000\r', '6e4', '60.0', '60000\nnull',
    '2147483648', '9999999999', '1'.repeat(65), '٦٠٠٠٠', '60000;other-setting',
    ('60000' + ' '.repeat(80)).slice(0, 65)]) {
    assert.equal(fixtureConfiguredTimeout(text), null, `unsupported scalar remains unavailable: ${JSON.stringify(text)}`);
  }
});
test('window timeout uses one fixed user-0 read between existing own-window guards without settings mutation', () => {
  const action = extract(/'AppWindowState' \{([\s\S]+?)\n        'GpsDiagnostics' \{/, 'window timeout action')[1];
  const query = "settings --user 0 get system screen_off_timeout 2>/dev/null | head -c 65";
  assert.equal(action.split(query).length - 1, 1);
  assert.ok(action.indexOf('$focus = Get-OwnUiFocus') < action.indexOf(query));
  assert.ok(action.indexOf('$windowState = Read-AppWindowFlags $dump $focus') < action.indexOf(query));
  assert.ok(action.indexOf(query) < action.indexOf('(Get-OwnUiFocus) -cne $focus'));
  assert.match(action, /\$configuredScreenOffTimeoutMs = Read-ConfiguredScreenOffTimeoutMs \$timeoutOutput/);
  assert.match(action, /catch \{ \$configuredScreenOffTimeoutMs = \$null \}/);
  assert.match(action, /finally \{ \$timeoutOutput = \$null \}/);
  assert.match(action, /configured_screen_off_timeout_ms=\$configuredScreenOffTimeoutMs/);
  assert.match(action, /input_sent=\$false;sensors_started=\$false/);
  assert.doesNotMatch(action, /settings(?:','|\s+)(?:put|delete|list|reset)|PowerManager|raw_timeout|timeout_output=/i);
});

const powerFunction = extract(/function Read-AppPowerScalars\(\[string\]\$Text\) \{([\s\S]+?)\n\}/, 'power scalar parser')[1];
function fixturePowerScalars(text) {
  if (!text || text.length > 128) return null;
  const pattern = name => {
    const value = extract(new RegExp('\\$' + name + " = '([^'\\n]+)'"), name)[1];
    return new RegExp(value.replaceAll('\\A', '^').replaceAll('\\z', '(?![\\s\\S])'));
  };
  const wake = pattern('powerWakefulnessPattern'), display = pattern('powerDisplayStatePattern');
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  if (lines.length < 1 || lines.length > 2) return null;
  const result = {wakefulness: null, display_state: null};
  for (const line of lines) {
    const wakeMatch = wake.exec(line), displayMatch = display.exec(line);
    if (wakeMatch) {
      if (result.wakefulness !== null) return null;
      result.wakefulness = wakeMatch[1];
    } else if (displayMatch) {
      if (result.display_state !== null) return null;
      result.display_state = displayMatch[1];
    } else return null;
  }
  return result;
}
function fixturePowerTransfer(encoded) {
  if (encoded.length > 172 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > 128 || bytes.toString('base64') !== encoded) return null;
  try { return fixturePowerScalars(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { return null; }
}
test('power observation admits only the filtered scalar enums and rejects duplicates malformed or truncated input', () => {
  assert.match(powerFunction, /\$Text\.Length -gt 128/);
  assert.match(powerFunction, /\$lines\.Count -lt 1 -or \$lines\.Count -gt 2/);
  assert.match(powerFunction, /\$null -ne \$wakefulness/);
  assert.match(powerFunction, /\$null -ne \$displayState/);
  assert.doesNotMatch(powerFunction, /Invoke-Bridge|Write-|Save-|throw|return \$Text/);
  for (const wakefulness of ['Awake', 'Asleep', 'Dreaming', 'Dozing']) {
    for (const display_state of ['ON', 'OFF', 'DOZE', 'DOZE_SUSPEND', 'VR', 'ON_SUSPEND']) {
      const text = `  mWakefulness=${wakefulness}\n  Display Power: state=${display_state}\n`;
      assert.deepEqual(fixturePowerTransfer(Buffer.from(text).toString('base64')), {wakefulness, display_state});
    }
  }
  assert.deepEqual(fixturePowerScalars('mWakefulness=Awake'), {wakefulness: 'Awake', display_state: null});
  assert.deepEqual(fixturePowerScalars('\tDisplay Power: state=OFF\r\n'), {wakefulness: null, display_state: 'OFF'});
  assert.deepEqual(fixturePowerScalars('Display Power: state=ON\nmWakefulness=Awake'), {wakefulness: 'Awake', display_state: 'ON'});
  for (const text of ['', 'null', 'mWakefulness=awake', 'mWakefulness=Unknown', 'Display Power: state=UNKNOWN',
    'mWakefulness=Awake\nmWakefulness=Awake', 'Display Power: state=ON\nDisplay Power: state=OFF',
    'mWakefulness=Awake\nDisplay Power: state=ON\nother=private', 'mWakefulness=Awake\n\n',
    'mWakefulness=Awake other=private', 'mWakefulness=Awake\r', 'Display Power: state=O',
    ' '.repeat(112) + 'mWakefulness=Awake', 'mWakefulness=Awake\nDisplay Power: state=ON\n\n']) {
    assert.equal(fixturePowerScalars(text), null);
  }
  assert.equal(fixturePowerTransfer(Buffer.from(' '.repeat(112) + 'mWakefulness=Awake').toString('base64')), null);
  assert.equal(fixturePowerTransfer(Buffer.alloc(129, 32).toString('base64')), null, 'the capture sentinel remains unavailable');
  assert.equal(fixturePowerTransfer(Buffer.from([0xff]).toString('base64')), null);
  assert.equal(fixturePowerTransfer('YWJj='), null, 'noncanonical transfer remains unavailable');
});
test('power query is fixed filtered capped and enclosed by existing own-focus guards without exposing its dump', () => {
  const action = extract(/'AppWindowState' \{([\s\S]+?)\n        'GpsDiagnostics' \{/, 'power scalar action')[1];
  const query = 'dumpsys power 2>/dev/null | grep -E "^[[:space:]]*mWakefulness=|^[[:space:]]*Display Power: state=" | head -c 129 | base64';
  assert.equal(action.split(query).length - 1, 1);
  assert.ok(action.indexOf('$focus = Get-OwnUiFocus') < action.indexOf(query));
  assert.ok(action.indexOf('$windowState = Read-AppWindowFlags $dump $focus') < action.indexOf(query));
  assert.ok(action.indexOf(query) < action.indexOf('(Get-OwnUiFocus) -cne $focus'));
  assert.match(action, /\$powerEncoded\.Length -gt 172/);
  assert.match(action, /\$powerBytes\.Length -gt 128/);
  assert.match(action, /\[Convert\]::ToBase64String\(\$powerBytes\) -cne \$powerEncoded/);
  assert.match(action, /New-Object Text\.UTF8Encoding\(\$false,\$true\)/);
  assert.match(action, /\$powerState = Read-AppPowerScalars \$powerText/);
  assert.match(action, /catch \{ \$wakefulness = \$null; \$displayState = \$null \}/);
  assert.match(action, /finally \{ \$powerEncoded = \$null; \$powerBytes = \$null; \$powerText = \$null \}/);
  assert.match(action, /wakefulness=\$wakefulness;display_state=\$displayState/);
  assert.match(action, /input_sent=\$false;sensors_started=\$false/);
  assert.doesNotMatch(action, /raw_power|power_dump=|power_text=|settings(?:','|\s+)(?:put|delete|list|reset)|WriteAll|Save-AppUiJson|input','/i);
});
