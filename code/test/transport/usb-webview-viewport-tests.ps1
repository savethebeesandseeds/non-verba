# SPDX-License-Identifier: AGPL-3.0-only
# Execute the real semantic parser against synthetic XML through a fake bridge.
# No ADB process, phone operation, build tool or personal UI fixture is used.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$helper=Join-Path $PSScriptRoot '../../tools/device/usb-device.ps1'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($helper,[ref]$tokens,[ref]$errors)
if ($errors.Count) {throw 'USB helper must parse before synthetic tests.'}
foreach ($name in @('Get-AppUiState','Resolve-AppUiDocumentViewport','Get-AppUiViewport','Get-FixedAppFocusClassification','Get-NativeCameraUiContainer')) {
    $definition=@($ast.FindAll({param($item) $item -is [Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -ceq $name},$false))
    if ($definition.Count -ne 1) {throw 'Expected one actual helper function.'}
    . ([scriptblock]::Create($definition[0].Extent.Text))
}
$appPackage='org.nonverba.camera'; $AppTarget='developer'; $appActivity='org.nonverba.camera/.MainActivity'
$appFocusPattern='\AmCurrentFocus=Window\{[^{}\r\n]* u0 org\.nonverba\.camera/(?:org\.nonverba\.camera\.)?\.?(?:MainActivity)\}\z'
$fixtureFocus='mCurrentFocus=Window{abc u0 org.nonverba.camera/.MainActivity}'
$fixtureXml=''; $bridgeCalls=0
function Invoke-Bridge([string[]]$Arguments) {
    $script:bridgeCalls++
    $joined=$Arguments -join ' '
    if ($joined -ceq '-d shell am get-current-user') {return '0'}
    if ($joined -ceq '-d shell wm size') {return 'Physical size: 1080x2160'}
    if ($joined.Contains('dumpsys window | grep mCurrentFocus')) {return $fixtureFocus}
    if ($joined.Contains('dumpsys input | grep SurfaceOrientation')) {return 'SurfaceOrientation: 0'}
    if ($joined.Contains('uiautomator dump')) {return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($fixtureXml))}
    if ($joined.Contains('set -C') -or $joined.Contains('if test -f')) {return}
    throw 'Unexpected synthetic bridge request; no process was started.'
}
function Node-Xml([string]$Children='', [string]$Class='android.webkit.WebView', [string]$Scrollable='false',
    [string]$Enabled='true', [string]$Bounds='[0,53][1080,2124]', [string]$Package='org.nonverba.camera',
    [string]$Resource='', [string]$Text='', [string]$Clickable='false', [string]$Focused='false',
    [string]$Description='', [string]$Focusable='false', [string]$LongClickable='false', [string]$Selected='false',
    [string]$Checkable='false', [string]$Checked='false', [string]$Password='false') {
    return '<node text="' + [Security.SecurityElement]::Escape($Text) + '" content-desc="' + [Security.SecurityElement]::Escape($Description) + '" resource-id="' + $Resource +
        '" class="' + $Class + '" bounds="' + $Bounds + '" package="' + $Package + '" clickable="' + $Clickable +
        '" enabled="' + $Enabled + '" focused="' + $Focused + '" scrollable="' + $Scrollable + '" password="' + $Password + '" focusable="' + $Focusable +
        '" long-clickable="' + $LongClickable + '" selected="' + $Selected + '" checkable="' + $Checkable + '" checked="' + $Checked + '">' + $Children + '</node>'
}
function Read-Fixture([string]$Nodes) {
    $script:fixtureXml='<hierarchy rotation="0">' + $Nodes + '</hierarchy>'
    return Get-AppUiState
}
function Check([bool]$Condition,[string]$Message) {if (-not $Condition) {throw $Message}}
function Refuses([scriptblock]$Operation) {
    $refused=$false; try {& $Operation | Out-Null} catch {$refused=$true}
    Check $refused 'Expected an ambiguous or invalid synthetic viewport to be refused.'
}
$cases=0
$button=Node-Xml -Class 'android.widget.Button' -Bounds '[40,300][1000,480]' -Resource 'attestation-load-request' -Text 'Load request' -Clickable 'true'
$inert=Read-Fixture (Node-Xml -Children $button)
Check (@($inert.nodes | Where-Object class -CEQ 'android.webkit.WebView').Count -eq 1) 'Inert own WebView must remain available.'
Check (-not (Get-AppUiViewport $inert).webview.scrollable) 'An inert document must not gain scrolling.'; $cases++
$state=Read-Fixture (Node-Xml -Children (Node-Xml -Children $button -Scrollable 'true' -Clickable 'true' -Focused 'true'))
$viewport=Get-AppUiViewport $state
Check ($state.nodes.Count -eq 2 -and $viewport.webview.scrollable) 'Nested virtual WebView lost observed scrollability or descendants.'
Check (-not $viewport.webview.clickable -and -not $viewport.webview.focused) 'Duplicate folding must not borrow focus or click authority.'
Check ($viewport.webview.id -ceq $inert.nodes[0].id) 'Viewport semantic identity changed during flag folding.'
Check (($viewport.bounds -join ',') -ceq '0,87,1080,2073') 'Safe display insets changed.'; $cases++
$state=Read-Fixture (Node-Xml -Children (Node-Xml -Children (Node-Xml -Scrollable 'true')))
Check ((Get-AppUiViewport $state).webview.scrollable -and $state.nodes.Count -eq 1) 'Transitive identical-bound descendants must fold to one viewport.'; $cases++
$state=Read-Fixture (Node-Xml -Scrollable 'true' -Children (Node-Xml))
Check ((Get-AppUiViewport $state).webview.scrollable) 'A non-scrollable child must not erase observed host scrolling.'; $cases++
foreach ($children in @((Node-Xml -Bounds '[0,50][1080,2124]' -Scrollable 'true'), (Node-Xml -Bounds '[00,53][1080,2124]' -Scrollable 'true'))) {
    $state=Read-Fixture (Node-Xml -Children $children)
    Check (@($state.nodes | Where-Object {$_.class -ceq 'android.webkit.WebView' -and $_.enabled}).Count -eq 2) 'Different raw viewports must remain separate.'
    Refuses {Get-AppUiViewport $state}; $cases++
}
$document=Node-Xml -Bounds '[0,55][1080,2124]' -Scrollable 'true' -Children $button
$state=Read-Fixture (Node-Xml -Children $document)
Check (@($state.nodes | Where-Object class -CEQ 'android.webkit.WebView').Count -eq 1 -and (Get-AppUiViewport $state).webview.bounds[1] -eq 55) 'An inert host must resolve to its sole strictly contained document.'
Check (@($state.nodes | Where-Object resource-id -CEQ 'attestation-load-request').Count -eq 1) 'Document controls were lost.'; $cases++
$state=Read-Fixture (Node-Xml -Class 'android.widget.FrameLayout' -Resource 'android:id/content' -Children (Node-Xml -Children $document))
Check (@($state.nodes | Where-Object class -CEQ 'android.webkit.WebView').Count -eq 1) 'Inert layout ancestors should remain structural scaffolding.'; $cases++
foreach ($hostXml in @(
    (Node-Xml -Children $document -Scrollable 'true'),
    (Node-Xml -Children $document -Clickable 'true'),
    (Node-Xml -Children $document -Focused 'true'),
    (Node-Xml -Children $document -Text 'Independent host content'),
    (Node-Xml -Children $document -Resource 'independent-host'),
    (Node-Xml -Children ($document + $button)),
    (Node-Xml -Children ($document + (Node-Xml -Class 'android.widget.TextView' -Text 'Outer label'))),
    (Node-Xml -Children ($document + (Node-Xml -Bounds '[0,55][1080,2124]' -Scrollable 'true'))))) {
    $state=Read-Fixture $hostXml
    Refuses {Get-AppUiViewport $state}; $cases++
}
$state=Read-Fixture ((Node-Xml -Children $document) + $button)
Refuses {Get-AppUiViewport $state}; $cases++
$state=Read-Fixture (Node-Xml -Class 'android.widget.FrameLayout' -Resource 'android:id/content' -Clickable 'true' -Children (Node-Xml -Children $document))
Refuses {Get-AppUiViewport $state}; $cases++
$inertHost=Node-Xml -Children $document
$statusBar=Node-Xml -Class 'android.view.View' -Resource 'android:id/statusBarBackground' -Bounds '[0,0][1080,53]'
$navigationBar=Node-Xml -Class 'android.view.View' -Resource 'android:id/navigationBarBackground' -Bounds '[0,2124][1080,2160]'
$state=Read-Fixture (Node-Xml -Class 'android.widget.FrameLayout' -Resource 'android:id/content' -Children ($inertHost + $statusBar + $navigationBar))
Check (@($state.nodes | Where-Object class -CEQ 'android.webkit.WebView').Count -eq 1 -and (Get-AppUiViewport $state).webview.bounds[1] -eq 55) 'Fixed inert window decorations must not create document ambiguity.'; $cases++
foreach ($change in @(
    @{Resource='arbitrary-outside-control'}, @{Class='android.widget.Button'}, @{Text='Outer content'}, @{Description='Outer label'},
    @{Clickable='true'}, @{Focused='true'}, @{Scrollable='true'}, @{Focusable='true'}, @{LongClickable='true'},
    @{Checkable='true'}, @{Checked='true'}, @{Selected='true'}, @{Children=$button}, @{Bounds='[0,0][1080,54]'},
    @{Bounds='[0,55][1080,2000]'}, @{Bounds='malformed'}, @{Focusable=''})) {
    $parameters=@{Class='android.view.View';Resource='android:id/statusBarBackground';Bounds='[0,0][1080,53]'}
    foreach ($key in $change.Keys) {$parameters[$key]=$change[$key]}
    $bar=Node-Xml @parameters
    Refuses {$state=Read-Fixture ($inertHost + $bar); Get-AppUiViewport $state}; $cases++
}
foreach ($kind in @('android:id/statusBarBackground','android:id/navigationBarBackground')) {
    foreach ($emptyBounds in @('[0,0][0,0]','[100,100][100,200]','[0,55][1080,55]')) {
        $emptyBar=Node-Xml -Class 'android.view.View' -Resource $kind -Bounds $emptyBounds
        $state=Read-Fixture (Node-Xml -Class 'android.widget.FrameLayout' -Resource 'android:id/content' -Children ($inertHost + $emptyBar))
        Check ($state.viewport_diagnostics.refusal_reason -ceq 'resolved_contained_document' -and @($state.nodes | Where-Object class -CEQ 'android.webkit.WebView').Count -eq 1) 'Qualified empty Android window decoration must not create viewport ambiguity.'
        Check (@($state.nodes | Where-Object resource-id -CEQ $kind).Count -eq 0) 'An empty decoration must never become a retained input node.'; $cases++
    }
}
$emptyNavigation=Node-Xml -Class 'android.view.View' -Resource 'android:id/navigationBarBackground' -Bounds '[0,0][0,0]'
$state=Read-Fixture (Node-Xml -Class 'android.widget.FrameLayout' -Resource 'android:id/content' -Children ($inertHost + $statusBar + $emptyNavigation))
Check ((Get-AppUiViewport $state).webview.bounds[1] -eq 55 -and $state.viewport_diagnostics.refusal_reason -ceq 'resolved_contained_document') 'Actual positive status bar plus empty navigation bar fixture must resolve safely.'; $cases++
foreach ($change in @(
    @{Resource='unknown-empty-node'}, @{Resource='android:id/navigationBarBackground.extra'}, @{Class='android.widget.Button'},
    @{Text='Empty labelled content'}, @{Description='Empty labelled content'}, @{Children=$button}, @{Enabled='false'},
    @{Clickable='true'}, @{Focused='true'}, @{Scrollable='true'}, @{Focusable='true'}, @{LongClickable='true'},
    @{Checkable='true'}, @{Checked='true'}, @{Selected='true'}, @{Password='true'}, @{Focusable=''},
    @{Bounds='[1,0][0,0]'}, @{Bounds='[0,2][0,1]'}, @{Bounds='[-1,0][0,0]'}, @{Bounds='malformed'})) {
    $parameters=@{Class='android.view.View';Resource='android:id/navigationBarBackground';Bounds='[0,0][0,0]'}
    foreach ($key in $change.Keys) {$parameters[$key]=$change[$key]}
    $bar=Node-Xml @parameters
    Refuses {$state=Read-Fixture ($inertHost + $bar); Get-AppUiViewport $state}; $cases++
}
$state=Read-Fixture (Node-Xml -Children (Node-Xml -Bounds '[0,55][1080,2124]' -Scrollable 'true' -Children (Node-Xml -Bounds '[0,55][1080,2124]' -Children $button)))
$diagnostics=$state.viewport_diagnostics
Check ($diagnostics.raw_enabled_own_webviews -eq 3 -and $diagnostics.retained_webviews_before -eq 2 -and $diagnostics.retained_webviews_after -eq 2 -and $diagnostics.refusal_reason -ceq 'raw_count_not_two') 'Raw duplicate document count must be observable without resolving it.'
Refuses {Get-AppUiViewport $state}; $cases++
$state=Read-Fixture ($inertHost + $statusBar)
Check ($state.viewport_diagnostics.refusal_reason -ceq 'resolved_contained_document' -and $state.viewport_diagnostics.ancestor_relation -ceq $true -and $state.viewport_diagnostics.strictly_contained -ceq $true -and $state.viewport_diagnostics.retained_webviews_after -eq 1) 'Successful structural resolution diagnostics are inaccurate.'; $cases++
$state=Read-Fixture ((Node-Xml) + (Node-Xml -Scrollable 'true'))
Check ($state.viewport_diagnostics.refusal_reason -ceq 'no_ancestor_relation' -and $state.viewport_diagnostics.ancestor_relation -ceq $false) 'Sibling refusal reason is inaccurate.'; $cases++
$state=Read-Fixture (Node-Xml -Children ($document + (Node-Xml -Class 'android.widget.TextView' -Text 'Synthetic private label')))
Check ($state.viewport_diagnostics.refusal_reason -ceq 'outside_useful_node') 'Outside control refusal reason is inaccurate.'
$diagnosticJson=$state.viewport_diagnostics | ConvertTo-Json -Compress
Check (-not $diagnosticJson.Contains('Synthetic private label') -and @($state.viewport_diagnostics.PSObject.Properties.Name).Count -eq 8) 'Diagnostics must contain only the closed bounded structural fields.'; $cases++
$bar=Node-Xml -Class 'android.view.View' -Resource 'android:id/statusBarBackground' -Bounds '[0,0][1080,53]' -Focusable ''
$state=Read-Fixture ($inertHost + $bar)
Check ($state.viewport_diagnostics.refusal_reason -ceq 'fixed_decoration_unverified_flag' -and $state.viewport_diagnostics.refusal_detail -ceq 'focusable') 'Decoration predicate diagnostics must identify the closed flag name only.'
Refuses {Get-AppUiViewport $state}; $cases++
$state=Read-Fixture ((Node-Xml) + (Node-Xml -Scrollable 'true'))
Refuses {Get-AppUiViewport $state}; $cases++
$state=Read-Fixture (Node-Xml -Children (Node-Xml -Enabled 'false' -Scrollable 'true'))
Check (-not (Get-AppUiViewport $state).webview.scrollable) 'Disabled descendants must not grant scrolling.'; $cases++
$state=Read-Fixture (Node-Xml -Children (Node-Xml -Package 'other.synthetic' -Scrollable 'true'))
Check (-not (Get-AppUiViewport $state).webview.scrollable) 'Foreign descendants must not grant scrolling.'; $cases++
$state=Read-Fixture (Node-Xml -Enabled 'false' -Children (Node-Xml -Scrollable 'true'))
Check ((Get-AppUiViewport $state).webview.scrollable -and $state.nodes.Count -eq 2) 'Disabled ancestors must not suppress independent enabled descendants.'; $cases++
foreach ($child in @((Node-Xml -Bounds 'bad-bounds' -Scrollable 'true'), (Node-Xml -Scrollable 'yes'))) {
    Refuses {Read-Fixture (Node-Xml -Children $child)}; $cases++
}
[ordered]@{passed=$true;cases=$cases;mock_bridge_calls=$bridgeCalls;phone_operations=$false;actual_helper_functions=$true} | ConvertTo-Json
