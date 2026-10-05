# SPDX-License-Identifier: AGPL-3.0-only
<#
User-approved Windows exception: native ADB transports USB traffic only.
Builds, Java, compilers and tests remain in the Debian development container.
No wireless pairing, TCP device connections, unrestricted shell or driver install.
#>
[CmdletBinding()]
param(
    [ValidateSet('Status','DeviceInfo','AppStatus','GpsDiagnostics','InstallVerified','Launch','RestartApp','AppUiState','AppUiBatch','AppCameraChallenge','StageCameraOffer','AppScreenshot','AppTap','AppSwipe','AppBack','AppText','AppDismissShare','ExportEnrollments','ExportLocations','ExportCamera','ExportCameraQuality','ExportCameraPairing','VerifySavedDownloads','Preview','Stop')]
    [string]$Action = 'Status',
    [string]$VerificationReport,
    [string]$RetrievalManifest,
    [string]$UiPlan,
    [string]$CameraChallengeFile,
    [string]$CameraOfferFile,
    [string]$ScreenshotPath,
    [ValidatePattern('\A[A-Za-z0-9][A-Za-z0-9 ._-]{0,199}\z', Options = 'None')][string]$Text,
    [ValidatePattern('\A(?:0|[1-9][0-9]{0,4})\z')][string]$X,
    [ValidatePattern('\A(?:0|[1-9][0-9]{0,4})\z')][string]$Y,
    [ValidatePattern('\A(?:0|[1-9][0-9]{0,4})\z')][string]$ToX,
    [ValidatePattern('\A(?:0|[1-9][0-9]{0,4})\z')][string]$ToY,
    [ValidatePattern('\A(?:[1-9][0-9]{2}|1000)\z')][string]$DurationMs = '300'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'This helper is only for the Windows USB transport.' }
$codeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$approvedTransportRoot = [IO.Path]::GetFullPath((Join-Path $codeRoot '../../private-source/code'))
if ($codeRoot -cne $approvedTransportRoot) {
    throw 'The Windows USB exception remains limited to the original private-source/code/tools/usb-device.ps1 and its verified ADB files. This public checkout does not extend that exception. See docs/development/CONTAINER_MIGRATION.md.'
}
$platformTools = Join-Path $codeRoot 'android/.toolchain/sdk/platform-tools'
$adb = Join-Path $platformTools 'adb.exe'
$port = 5038
if ($VerificationReport -and $Action -ne 'InstallVerified') { throw 'VerificationReport is only used by InstallVerified.' }
if ($PSBoundParameters.ContainsKey('RetrievalManifest') -and $Action -cne 'VerifySavedDownloads') { throw 'RetrievalManifest is only used by VerifySavedDownloads.' }
if ($Action -ceq 'VerifySavedDownloads' -and [string]::IsNullOrEmpty($RetrievalManifest)) { throw 'VerifySavedDownloads requires an existing public RetrievalManifest.' }
if ($PSBoundParameters.ContainsKey('UiPlan') -and $Action -cne 'AppUiBatch') { throw 'UiPlan is only accepted by AppUiBatch.' }
if ($Action -ceq 'AppUiBatch' -and [string]::IsNullOrEmpty($UiPlan)) { throw 'AppUiBatch requires a bounded local UiPlan JSON.' }
if ($PSBoundParameters.ContainsKey('CameraChallengeFile') -and $Action -cne 'AppCameraChallenge') { throw 'CameraChallengeFile is only accepted by AppCameraChallenge.' }
if ($Action -ceq 'AppCameraChallenge') {
    if ([string]::IsNullOrEmpty($CameraChallengeFile)) { throw 'AppCameraChallenge requires CameraChallengeFile.' }
    if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'AppCameraChallenge requires PowerShell 7 for exact native argument handling.' }
    . (Join-Path $PSScriptRoot 'usb-camera-challenge.ps1')
    # Validate before any device query or server start. Keep the requester file
    # untouched; report its original hash separately from compact field JSON.
    $cameraChallenge = Read-BoundedCameraChallenge $CameraChallengeFile (Join-Path $codeRoot 'artifacts/device-acceptance')
    $cameraWire = ConvertTo-CameraChallengeWire $cameraChallenge.canonical
}
if ($PSBoundParameters.ContainsKey('CameraOfferFile') -and $Action -cne 'StageCameraOffer') { throw 'CameraOfferFile is only accepted by StageCameraOffer.' }
if ($Action -cin @('StageCameraOffer','ExportCameraPairing')) {
    if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Camera pairing transfer requires PowerShell 7.' }
    . (Join-Path $PSScriptRoot 'usb-camera-pairing.ps1')
}
if ($Action -ceq 'ExportCameraQuality') {
    if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Unsigned camera quality retrieval requires PowerShell 7.' }
    . (Join-Path $PSScriptRoot 'usb-camera-quality.ps1')
}
if ($Action -ceq 'StageCameraOffer') {
    if ([string]::IsNullOrEmpty($CameraOfferFile)) { throw 'StageCameraOffer requires CameraOfferFile.' }
    # Validate the bounded public file before any USB/server operation.
    $cameraOffer = Read-CameraOfferFile $CameraOfferFile (Join-Path $codeRoot 'artifacts/device-acceptance')
}
$inputParameters = @('ScreenshotPath','Text','X','Y','ToX','ToY','DurationMs')
foreach ($parameter in $inputParameters) {
    if ($PSBoundParameters.ContainsKey($parameter)) {
        $allowed = if ($parameter -cin @('ToX','ToY','DurationMs')) { @('AppSwipe') }
            elseif ($parameter -ceq 'Text') { @('AppText') }
            elseif ($parameter -ceq 'ScreenshotPath') { @('AppTap','AppSwipe','AppText','AppDismissShare') }
            else { @('AppTap','AppSwipe') }
        if ($Action -cnotin $allowed) { throw "$parameter is not accepted by $Action." }
    }
}
if ($Action -cin @('AppTap','AppSwipe','AppText','AppDismissShare')) {
    $required = if ($Action -ceq 'AppText') { @('ScreenshotPath','Text') }
        elseif ($Action -ceq 'AppDismissShare') { @('ScreenshotPath') }
        else { @('ScreenshotPath','X','Y') }
    if ($Action -ceq 'AppSwipe') { $required += @('ToX','ToY') }
    foreach ($parameter in $required) {
        if (-not $PSBoundParameters.ContainsKey($parameter) -or [string]::IsNullOrEmpty([string]$PSBoundParameters[$parameter])) {
            throw "$Action requires $parameter from a fresh own-app screenshot."
        }
    }
}
# These three existing Platform Tools 37.0.1 files were checked for valid
# Google LLC Authenticode signatures before enabling this exception.
$approved = @{
    'adb.exe' = 'B4A6B455702684652CCCF7B46258B29E653538904359A58FD4931CF3EF286B3F'
    'AdbWinApi.dll' = 'C1D653030B4BDE65D3E07E4D0B0979E17BE56DF1436CDD15528630F27808050D'
    'AdbWinUsbApi.dll' = '0710E894D9B40F71A670C13C694079D564C92C1279DA382CFE4850983AAEBE1B'
}
foreach ($file in $approved.GetEnumerator()) {
    $path = Join-Path $platformTools $file.Key
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.Value) {
        throw "Unverified USB tool: $($file.Key). Review an official update before changing the pinned hash."
    }
}
function Get-BridgeListeners {
    @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq $port)
}
function Assert-BridgeOwner($listeners) {
    foreach ($listener in $listeners) {
        if (-not [Net.IPAddress]::IsLoopback([Net.IPAddress]::Parse($listener.LocalAddress))) {
            throw 'The USB helper port has a non-loopback listener. No device command was run.'
        }
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
        if ($owner.ExecutablePath -ne $adb) { throw 'Port 5038 belongs to another program; it was preserved.' }
    }
}
function Invoke-Bridge([string[]]$Arguments) {
    & $adb -H 127.0.0.1 -P $port @Arguments
    if ($LASTEXITCODE -ne 0) { throw "USB ADB command failed (exit $LASTEXITCODE): $($Arguments -join ' '). No wireless fallback is used." }
}
function Get-AppUiState {
    $focusCommand = "'dumpsys window | grep mCurrentFocus'"
    $focusPattern = '^mCurrentFocus=Window\{[^{}\r\n]* u0 org\.nonverba\.camera/(?:org\.nonverba\.camera\.)?\.?(?:MainActivity)\}$'
    $user = ((Invoke-Bridge @('-d','shell','am','get-current-user')) -join '').Trim()
    $focusBefore = ((Invoke-Bridge @('-d','shell','sh','-c',$focusCommand)) -join [Environment]::NewLine).Trim()
    if ($user -cne '0' -or $focusBefore -cnotmatch $focusPattern) { throw 'AppUiState requires focused user-0 Non-verba; other windows are not inspected.' }
    $temporary = '/data/local/tmp/nonverba-ui-' + [Guid]::NewGuid().ToString('N') + '.xml'
    $reserved = $false
    try {
        $reserve = 'test -d /data/local/tmp && test ! -L /data/local/tmp && (umask 077; set -C; : > {0})' -f $temporary
        Invoke-Bridge @('-d','shell','sh','-c',("'" + $reserve + "'")) | Out-Null
        $reserved = $true
        $command = 'uiautomator dump {0} >/dev/null && test -f {0} && test ! -L {0} && test $(stat -c %u {0}) = 2000 && test $(stat -c %s {0}) -gt 0 && test $(stat -c %s {0}) -le 1048576 && head -c 1048577 {0} | base64' -f $temporary
        $encoded = (Invoke-Bridge @('-d','shell','sh','-c',("'" + $command + "'"))) -join ''
        $user = ((Invoke-Bridge @('-d','shell','am','get-current-user')) -join '').Trim()
        $focusAfter = ((Invoke-Bridge @('-d','shell','sh','-c',$focusCommand)) -join [Environment]::NewLine).Trim()
        if ($user -cne '0' -or $focusAfter -cne $focusBefore) { throw 'App focus changed; accessibility dump discarded.' }
        if ($encoded.Length -gt 1398104 -or $encoded -cnotmatch '\A[A-Za-z0-9+/]+={0,2}\z') { throw 'Invalid bounded accessibility transfer.' }
        $bytes = [Convert]::FromBase64String($encoded)
        if ($bytes.Length -gt 1048576 -or [Convert]::ToBase64String($bytes) -cne $encoded) { throw 'Invalid canonical accessibility transfer.' }
        $settings = New-Object Xml.XmlReaderSettings
        $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
        $settings.XmlResolver = $null
        $settings.MaxCharactersInDocument = 1048576
        $stream = New-Object IO.MemoryStream(,$bytes)
        $reader = [Xml.XmlReader]::Create($stream,$settings)
        try {
            $document = New-Object Xml.XmlDocument
            $document.XmlResolver = $null
            $document.Load($reader)
        } finally { $reader.Dispose(); $stream.Dispose() }
        if ($document.DocumentElement.Name -cne 'hierarchy' -or $document.DocumentElement.GetAttribute('rotation') -cnotmatch '\A[0-3]\z') { throw 'Unexpected UI hierarchy root.' }
        $allNodes = @($document.SelectNodes('//node'))
        if ($allNodes.Count -gt 2048) { throw 'Too many UI nodes.' }
        $nodes = @()
        foreach ($element in $allNodes) {
            if ($element.GetAttribute('package') -cne 'org.nonverba.camera') { continue }
            $node = [ordered]@{}
            $fullIdentity = @{}
            foreach ($field in @('text','content-desc','resource-id','class','bounds')) {
                $node[$field] = $element.GetAttribute($field)
                if ($field -cin @('text','content-desc')) { $fullIdentity[$field] = $node[$field] }
                if ($field -cin @('text','content-desc')) {
                    $node[$field + '-length'] = $node[$field].Length
                    $node[$field + '-truncated'] = $node[$field].Length -gt 512
                    if ($node[$field + '-truncated']) { $node[$field] = $node[$field].Substring(0,512) }
                } elseif ($node[$field].Length -gt 2048) { throw 'Oversized UI attribute.' }
            }
            foreach ($field in @('clickable','enabled','focused','scrollable','password')) {
                $value = $element.GetAttribute($field)
                if ($value -cnotin @('true','false')) { throw 'Invalid UI boolean.' }
                $node[$field] = $value -ceq 'true'
            }
            if ($node.password) { $node.text = ''; $node['content-desc'] = ''; $fullIdentity.text = ''; $fullIdentity['content-desc'] = '' }
            $node.editable = $node.class -ceq 'android.widget.EditText'
            if ($node.editable -and -not $node.password -and $node['resource-id'] -ceq 'operator-challenge' -and $fullIdentity.text.Length -le 16384) {
                $fieldSha = [Security.Cryptography.SHA256]::Create()
                try { $node['text-sha256'] = ([BitConverter]::ToString($fieldSha.ComputeHash([Text.Encoding]::UTF8.GetBytes($fullIdentity.text)))).Replace('-','').ToLowerInvariant() }
                finally { $fieldSha.Dispose() }
            }
            if (-not ($node.text -or $node['content-desc'] -or $node['resource-id'] -or $node.clickable -or $node.focused -or $node.scrollable -or $node.editable)) { continue }
            if ($node.bounds -cnotmatch '\A\[([0-9]{1,5}),([0-9]{1,5})\]\[([0-9]{1,5}),([0-9]{1,5})\]\z') { throw 'Invalid UI bounds.' }
            $node.bounds = @([int]$Matches[1],[int]$Matches[2],[int]$Matches[3],[int]$Matches[4])
            if ($node.bounds[2] -le $node.bounds[0] -or $node.bounds[3] -le $node.bounds[1]) { continue }
            $identity = [string]::Join([char]0,@($node['resource-id'],$node.class,$fullIdentity.text,$fullIdentity['content-desc']))
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $node.id = 'ui-' + ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity)))).Replace('-','').ToLowerInvariant().Substring(0,24) }
            finally { $sha.Dispose() }
            $nodes += [pscustomobject]$node
            if ($nodes.Count -gt 512) { throw 'Too many useful UI nodes.' }
        }
        if ($nodes.Count -eq 0) { throw 'No useful Non-verba accessibility nodes; use AppScreenshot.' }
        $state = [ordered]@{type='nonverba-app-ui-state';version=1;observed_at_utc=[DateTime]::UtcNow.ToString('o');
            android_user_id=0;package='org.nonverba.camera';focus=$focusAfter;rotation=[int]$document.DocumentElement.GetAttribute('rotation');nodes=$nodes;
            selector_note='IDs hash semantic attributes. Identical nodes share IDs; selection must require exactly one match.'}
    } finally {
        if ($reserved) {
            $cleanup = 'if test -f {0} && test ! -L {0} && test $(stat -c %u {0}) = 2000; then rm -- {0}; else exit 1; fi' -f $temporary
            Invoke-Bridge @('-d','shell','sh','-c',("'" + $cleanup + "'")) | Out-Null
        }
    }
    return [pscustomobject]$state
}
function Save-AppUiJson($Value, [string]$Prefix) {
    $root = Join-Path $codeRoot 'artifacts/device-acceptance'
    [IO.Directory]::CreateDirectory($root) | Out-Null
    $path = Join-Path $root ($Prefix + '-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ') + '-' + [Guid]::NewGuid().ToString('N') + '.json')
    $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes(($Value | ConvertTo-Json -Depth 12))
    $stream = [IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
    try { $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
    return $path
}
function Get-AppUiSummary($State) {
    @($State.nodes | Where-Object {
        $_.clickable -or $_.editable -or $_.scrollable -or $_.'resource-id' -cmatch '(?:^|-)(?:notice|status|runtime|engine|progress|demo-active)(?:-|$)'
    } | Select-Object -First 80 | ForEach-Object {
        $label = if ($_.'text-truncated' -or $_.text.Length -gt 180 -or $_.text -match '^\s*[\{\[]') { '[long text omitted]' } else { $_.text }
        $description = if ($_.'content-desc'.Length -gt 180) { '[long description omitted]' } else { $_.'content-desc' }
        [ordered]@{id=$_.id;resource_id=$_.'resource-id';text=$label;description=$description;
            clickable=$_.clickable;enabled=$_.enabled;focused=$_.focused;editable=$_.editable;scrollable=$_.scrollable;bounds=$_.bounds}
    })
}
function Get-OwnUiFocus {
    $user = ((Invoke-Bridge @('-d','shell','am','get-current-user')) -join '').Trim()
    $focus = ((Invoke-Bridge @('-d','shell','sh','-c',"'dumpsys window | grep mCurrentFocus'")) -join [Environment]::NewLine).Trim()
    if ($user -cne '0' -or $focus -cnotmatch '^mCurrentFocus=Window\{[^{}\r\n]* u0 org\.nonverba\.camera/(?:org\.nonverba\.camera\.)?\.?(?:MainActivity)\}$') {
        throw 'Non-verba lost foreground user-0 focus; batch stopped without following another window.'
    }
    return $focus
}
function Get-NativeCameraUiContainer($State) {
    if (@($State.nodes | Where-Object { $_.class -ceq 'android.webkit.WebView' }).Count) { throw 'Native camera taps require no WebView.' }
    $titles = @($State.nodes | Where-Object { $_.class -ceq 'android.widget.TextView' -and $_.text -ceq 'Non-verba camera' -and -not $_.'text-truncated' })
    $containers = @($State.nodes | Where-Object { $_.'resource-id' -ceq 'android:id/content' -and $_.class -ceq 'android.widget.FrameLayout' -and $_.enabled })
    $buttons = @($State.nodes | Where-Object { $_.class -ceq 'android.widget.Button' })
    if ($titles.Count -ne 1 -or $containers.Count -ne 1 -or $buttons.Count -ne 2) { throw 'Expected the exact native camera dialog and its two buttons.' }
    foreach ($label in @('TAKE PHOTO','CANCEL')) {
        $matches = @($buttons | Where-Object { $_.text -ceq $label -and -not $_.'text-truncated' -and
            $_.enabled -and $_.clickable -and -not $_.password -and -not $_.editable })
        if ($matches.Count -ne 1) { throw 'Native camera requires one enabled Take photo button and one enabled Cancel button.' }
    }
    return $containers[0]
}
function Get-AppUiViewport($State, [switch]$NativeCameraOnly) {
    $sizes = @((Invoke-Bridge @('-d','shell','wm','size')) | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($sizes.Count -lt 1 -or $sizes.Count -gt 2 -or $sizes[0] -cnotmatch '\APhysical size: ([1-9][0-9]{0,4})x([1-9][0-9]{0,4})\z') { throw 'Ambiguous physical screen dimensions.' }
    $width = [int]$Matches[1]; $height = [int]$Matches[2]
    if ($sizes.Count -eq 2) {
        if ($sizes[1] -cnotmatch '\AOverride size: ([1-9][0-9]{0,4})x([1-9][0-9]{0,4})\z') { throw 'Ambiguous override screen dimensions.' }
        $width = [int]$Matches[1]; $height = [int]$Matches[2]
    }
    $rotationText = ((Invoke-Bridge @('-d','shell','sh','-c',"'dumpsys input | grep SurfaceOrientation'")) -join [Environment]::NewLine).Trim()
    if ($rotationText -cnotmatch '\ASurfaceOrientation: ([0-3])\z' -or [int]$Matches[1] -ne $State.rotation) { throw 'Hierarchy and current display rotation differ.' }
    if ($State.rotation -in @(1,3)) { $naturalWidth = $width; $width = $height; $height = $naturalWidth }
    if ($width -lt 100 -or $height -lt 100 -or $width -gt 32767 -or $height -gt 32767) { throw 'Screen dimensions outside supported bounds.' }
    $views = @($State.nodes | Where-Object { $_.class -ceq 'android.webkit.WebView' -and $_.enabled })
    $container = if ($NativeCameraOnly) { Get-NativeCameraUiContainer $State }
        else {
            if ($views.Count -ne 1) { throw 'Exactly one enabled own-app WebView is required.' }
            $views[0]
        }
    $inset = [int][Math]::Ceiling($height * 0.04)
    $bounds = @([Math]::Max(0,$container.bounds[0]),[Math]::Max($inset,$container.bounds[1]),
        [Math]::Min($width,$container.bounds[2]),[Math]::Min($height-$inset,$container.bounds[3]))
    if ($bounds[2]-$bounds[0] -lt 100 -or $bounds[3]-$bounds[1] -lt 200) { throw 'Own app container has insufficient safe visible bounds.' }
    return [pscustomobject]@{bounds=$bounds;webview=$(if ($NativeCameraOnly) { $null } else { $container });rotation=$State.rotation}
}
function Assert-CameraPublicExport([byte[]]$Bytes, [string]$Kind, [string]$ChallengePrefix) {
    # File-shape checks only; Rust must verify C2PA, request binding and keys.
    if ($Kind -ceq 'photo') {
        if ($Bytes.Length -lt 4 -or $Bytes[0] -ne 0xff -or $Bytes[1] -ne 0xd8 -or $Bytes[2] -ne 0xff) {
            throw 'Camera export is not a JPEG.'
        }
        return
    }
    $utf8 = New-Object Text.UTF8Encoding($false, $true)
    $text = $utf8.GetString($Bytes)
    if ($Kind -ceq 'key') {
        # Exact LF-delimited TextEncoder output from app.js, with one of its
        # two fixed descriptions. No arbitrary text/private-key format allowed.
        $pattern = '\A[a-f0-9]{64}\n\n(?:Non-verba native camera signing identity\. This is separate from older software photo/audio keys\.|Non-verba local software signing identity\.) Share through a trusted channel\.\n\z'
        if ($text -cnotmatch $pattern) { throw 'Unexpected public camera key export.' }
        return
    }
    if ($Kind -cne 'request') { throw 'Unsupported public camera export.' }
    $publicRequest = $text | ConvertFrom-Json
    if ($publicRequest -isnot [pscustomobject] -or $publicRequest.version -ne 1) { throw 'Invalid public camera request export.' }
    $challenge = $publicRequest
    if ($publicRequest.PSObject.Properties.Name -ccontains 'type') {
        if ($publicRequest.type -cne 'nonverba-camera-location-request' -or
            @($publicRequest.PSObject.Properties.Name | Where-Object { $_ -cnotin @('version','type','location_request') }).Count) {
            throw 'Unexpected camera request envelope.'
        }
        $locationRequest = $publicRequest.location_request
        if ($locationRequest -isnot [pscustomobject] -or $locationRequest.version -ne 1 -or
            $locationRequest.type -cne 'nonverba-location-request' -or
            @($locationRequest.PSObject.Properties.Name | Where-Object { $_ -cnotin @('version','type','challenge','demo','policy','context') }).Count -or
            $locationRequest.context.purpose -cne 'camera') { throw 'Unexpected composed camera request.' }
        $challenge = $locationRequest.challenge
    }
    $challengeFields = @('version','id','requester','task','nonce','issued_at','expires_at')
    if ($challenge -isnot [pscustomobject] -or $challenge.version -ne 1 -or
        @($challenge.PSObject.Properties.Name | Where-Object { $_ -cnotin $challengeFields }).Count -or
        @($challengeFields | Where-Object { $_ -cnotin $challenge.PSObject.Properties.Name }).Count -or
        $challenge.id -cnotmatch '^[a-f0-9]{64}$' -or $challenge.id.Substring(0,12) -cne $ChallengePrefix) {
        throw 'Camera challenge does not match its exported filename or public shape.'
    }
}
$environmentNames = @('ADB_MDNS','ADB_MDNS_AUTO_CONNECT','ADB_SERVER_SOCKET','ANDROID_SERIAL',
    'ADB_SERVER_ADDRESS','ADB_SERVER_PORT','ANDROID_ADB_SERVER_ADDRESS','ANDROID_ADB_SERVER_PORT')
$saved = @{}
foreach ($name in $environmentNames) {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name,'Process')
    [Environment]::SetEnvironmentVariable($name,$null,'Process')
}
try {
    # Process-local settings, inherited by the helper server. No user/machine
    # environment, firewall or Windows service configuration is changed.
    $env:ADB_MDNS = '0'
    $env:ADB_MDNS_AUTO_CONNECT = '0'
    $listeners = @(Get-BridgeListeners)
    if ($listeners.Count) { Assert-BridgeOwner $listeners }
    if ($Action -eq 'Stop') {
        if ($listeners.Count) { Invoke-Bridge @('kill-server') }
        Write-Output 'Project USB bridge stopped. Other ADB server ports were not touched.'
        return
    }
    if (-not $listeners.Count) {
        # ADB requires the hostname "localhost" to recognize an auto-start as
        # local. The actual listener addresses are verified immediately below.
        & $adb -L tcp:localhost:5038 start-server
        if ($LASTEXITCODE -ne 0) { throw 'Could not start the local USB helper.' }
        $listeners = @(Get-BridgeListeners)
        if (-not $listeners.Count) { throw 'USB helper has no listener.' }
        Assert-BridgeOwner $listeners
    }
    $status = (Invoke-Bridge @('server-status')) -join "`n"
    if ($status -notmatch '(?m)^mdns_enabled: false\s*$' -or $status -notmatch 'mdns_backend: MDNS_DISABLED') {
        throw 'Network discovery is not disabled. Refusing to issue a device command.'
    }
    $owners = @($listeners.OwningProcess | Select-Object -Unique)
    if (@(Get-NetUDPEndpoint -ErrorAction Stop | Where-Object OwningProcess -in $owners).Count) {
        throw 'Unexpected UDP endpoint on the USB helper. Refusing a device command.'
    }
    switch ($Action) {
        'Status' {
            Write-Output 'Verified: Google-signed pinned ADB; localhost:5038 only; mDNS disabled; no UDP endpoints.'
            Invoke-Bridge @('devices','-l')
        }
        'DeviceInfo' {
            # -d selects physical USB; multiple USB devices cause an error.
            Invoke-Bridge @('-d','get-state')
            foreach ($property in @('ro.product.manufacturer','ro.product.model','ro.build.version.release','ro.build.version.sdk')) {
                $value = (Invoke-Bridge @('-d','shell','getprop',$property)) -join ''
                Write-Output "$property=$value"
            }
        }
        'AppStatus' {
            # Fixed, read-only app queries. No unrestricted shell or package
            # selection is exposed. Always inspect the foreground Android user.
            Invoke-Bridge @('-d','get-state') | Out-Null
            $userId = ((Invoke-Bridge @('-d','shell','am','get-current-user')) -join '').Trim()
            if ($userId -notmatch '^\d{1,6}$') { throw 'Could not identify the foreground Android user.' }
            $properties = [ordered]@{}
            foreach ($property in @('ro.product.manufacturer','ro.product.model','ro.build.version.release',
                    'ro.build.version.sdk','ro.build.version.security_patch','ro.product.cpu.abilist')) {
                $properties[$property] = ((Invoke-Bridge @('-d','shell','getprop',$property)) -join '').Trim()
            }
            # `pm path` returns exit 1 when absent. First use the list query,
            # which succeeds with an empty result for a missing package.
            $packages = @((Invoke-Bridge @('-d','shell','pm','list','packages','--user',$userId,'org.nonverba.camera')) |
                ForEach-Object { $_.Trim() } | Where-Object { $_ })
            if (@($packages | Where-Object { $_ -cne 'package:org.nonverba.camera' }).Count -or $packages.Count -gt 1) {
                throw 'Unexpected package inventory; no file query was run.'
            }
            $packagePath = ''
            if ($packages.Count -eq 1) {
                $packagePath = ((Invoke-Bridge @('-d','shell','pm','path','--user',$userId,'org.nonverba.camera')) -join "`n").Trim()
                if (-not $packagePath) { throw 'Installed package disappeared during inspection.' }
            }
            $installedHash = $null
            if ($packagePath) {
                if ($packagePath -notmatch '^package:(/data/app/[A-Za-z0-9_~+./=-]+/base\.apk)$' -or $packagePath.Contains('/../')) {
                    throw 'Unexpected installed package path; no file query was run.'
                }
                $baseApk = $Matches[1]
                $digest = ((Invoke-Bridge @('-d','shell','sha256sum',$baseApk)) -join "`n").Trim()
                if ($digest -notmatch '^([a-fA-F0-9]{64})\s+([^\r\n]+)$' -or $Matches[2] -cne $baseApk) { throw 'Unrecognized installed APK hash.' }
                $installedHash = $Matches[1].ToLowerInvariant()
            }
            $features = @((Invoke-Bridge @('-d','shell','pm','list','features')) | Where-Object {
                $_ -match '^feature:android\.hardware\.(camera(?:\.[A-Za-z0-9_.]+)?|microphone|location\.gps|strongbox_keystore)(?:=\d+)?$'
            })
            $sameUser = ((Invoke-Bridge @('-d','shell','am','get-current-user')) -join '').Trim() -ceq $userId
            if (-not $sameUser) { throw 'The foreground Android user changed during inspection.' }
            [ordered]@{type='nonverba-usb-app-status';checked_at_utc=[DateTime]::UtcNow.ToString('o');
                usb_transport=$true;android_user_id=[int]$userId;properties=$properties;features=$features;
                package='org.nonverba.camera';installed=[bool]$packagePath;installed_apk_sha256=$installedHash;
                sensor_tests_run=$false;attestation_verified=$false} | ConvertTo-Json -Depth 5
        }
        'GpsDiagnostics' {
            # Fixed read-only queries; no sensor start, settings mutation, log clear,
            # caller-supplied shell, full location dump, or other-app log inventory.
            $focus = Get-OwnUiFocus
            $properties = [ordered]@{}
            foreach ($name in @('ro.build.version.sdk','ro.build.version.security_patch','ro.build.version.incremental')) {
                $properties[$name] = ((Invoke-Bridge @('-d','shell','getprop',$name)) -join '').Trim()
            }
            $settings = [ordered]@{}
            foreach ($name in @('development_settings_enabled','enable_gnss_raw_meas_full_tracking')) {
                $value = ((Invoke-Bridge @('-d','shell','settings','get','global',$name)) -join '').Trim()
                if ($value -cnotmatch '^(?:null|[0-9]{1,8})$') { throw 'Unexpected GNSS diagnostic setting format.' }
                $settings[$name] = $value
            }
            # Only scalar receiver flags are retained, never coordinates/listeners.
            $flagsCommand = @'
'dumpsys location | grep -iE "^[[:space:]]*m?(Started|Enabled|TopHalCapabilities|GnssCapabilities|Capabilities|SupportsGnssMeasurements|IsRegistered|StartedCollection|StartedFullTracking|IsCollectionStarted|MeasurementsSupported)[=:][[:space:]]*(true|false|0x[0-9a-fA-F]+|[0-9]+)" | sed -E "s/([=:][[:space:]]*(true|false|0x[0-9a-fA-F]+|[0-9]+)).*$/\1/" | head -c 16384'
'@
            $flags = ((Invoke-Bridge @('-d','shell','sh','-c',$flagsCommand)) -join "`n").Trim()
            # Vendor dumps differ: keep field names only to diagnose a missing
            # scalar format, never their location values or client identities.
            $namesCommand = @'
'dumpsys location | grep -E "^[[:space:]]*[A-Za-z_][A-Za-z_ ]{0,70}[=:]" | sed -E "s/[=:].*$//" | head -c 4096'
'@
            $names = ((Invoke-Bridge @('-d','shell','sh','-c',$namesCommand)) -join "`n").Trim()
            # These framework tags report measurement startup/delivery errors. An
            # empty result means no matching retained logs, not a healthy receiver.
            $logCommand = "'logcat -d -v epoch -t 1000 GnssMeasProvider:V GnssLocationProvider:W LocationManagerService:W LocSvc_GnssAdapter:W LocSvc_GnssInterface:W LocSvc_ApiV02:W LocSvc_HIDL_GnssMeasurement:W *:S | grep -i measurement | head -c 32768'"
            $logs = ((Invoke-Bridge @('-d','shell','sh','-c',$logCommand)) -join "`n").Trim()
            if ($flags.Length -gt 16384 -or $logs.Length -gt 32768 -or $names.Length -gt 4096) { throw 'GNSS diagnostic output exceeded its bound.' }
            if ((Get-OwnUiFocus) -cne $focus) { throw 'Non-verba focus changed during GNSS diagnostics.' }
            $record = [ordered]@{type='nonverba-usb-gps-diagnostics';version=1;checked_at_utc=[DateTime]::UtcNow.ToString('o');
                android_user_id=0;unsigned=$true;properties=$properties;settings=$settings;
                receiver_flags=$flags;receiver_diagnostic_field_names=$names;measurement_framework_logs=$logs;logs_may_be_incomplete=$true;
                sensor_started=$false;settings_changed=$false;physical_cause='unknown'}
            $path = Save-AppUiJson $record 'gps-diagnostics'
            [ordered]@{report=$path;diagnostics=$record} | ConvertTo-Json -Depth 6
        }
        'InstallVerified' {
            # Only transfer this project's already inspected Linux build. No
            # host package tooling, downgrade, uninstall, data clear or grants.
            if (-not $VerificationReport) { throw 'Supply a successful Linux APK VerificationReport.' }
            $reportRoot = [IO.Path]::GetFullPath((Join-Path $codeRoot 'artifacts/qa')) + [IO.Path]::DirectorySeparatorChar
            $reportPath = [IO.Path]::GetFullPath($VerificationReport)
            if (-not $reportPath.StartsWith($reportRoot, [StringComparison]::OrdinalIgnoreCase) -or
                [IO.Path]::GetExtension($reportPath) -ne '.json') { throw 'Use a package report in code/artifacts/qa.' }
            $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
            foreach ($field in @('passed','package_checks_passed','current_linux_build_verified','signature_verified','same_signer_as_previous')) {
                if ($report.$field -isnot [bool] -or -not $report.$field) { throw "Package report does not pass $field." }
            }
            if ($report.schema_version -ne 2 -or $report.errors.Count -ne 0 -or $report.current_build_gaps.Count -ne 0 -or
                $report.signing_certificate_sha256 -cne '7ed35bc9854def89ea0e3130865941b408c2a54d62b28e6ece7f01300bdc8649') {
                throw 'Package report schema, checks or retained development signer do not match.'
            }
            if ($report.apk -cnotmatch '^/workspace/code/(artifacts/container-builds/[0-9]{8}T[0-9]{6}Z/nonverba-debug\.apk)$') {
                throw 'Only an exported container build can be installed.'
            }
            $apkPath = Join-Path $codeRoot $Matches[1]
            if ($report.sha256 -cnotmatch '^[a-f0-9]{64}$' -or
                (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $report.sha256) {
                throw 'APK bytes differ from the successful Linux verification report.'
            }
            $before = (& $PSCommandPath -Action AppStatus) | ConvertFrom-Json
            # Stream into the package installer instead of overwriting a
            # predictable shared /data/local/tmp filename on the phone.
            Invoke-Bridge @('-d','install','--user',[string]$before.android_user_id,'-r','--streaming',$apkPath)
            $after = (& $PSCommandPath -Action AppStatus) | ConvertFrom-Json
            if ($after.android_user_id -ne $before.android_user_id -or -not $after.installed -or
                $after.installed_apk_sha256 -cne $report.sha256) { throw 'Installation post-check failed; preserve phone state and inspect it.' }
            $after | ConvertTo-Json -Depth 5
        }
        'Launch' {
            $app = (& $PSCommandPath -Action AppStatus) | ConvertFrom-Json
            if (-not $app.installed) { throw 'Non-verba is not installed for the foreground user.' }
            # MainActivity opens the bundled camera page, without capturing,
            # requesting permissions or playing an acoustic challenge.
            Invoke-Bridge @('-d','shell','am','start','-W','--user',[string]$app.android_user_id,
                '-n','org.nonverba.camera/.MainActivity')
        }
        'RestartApp' {
            # Explicit process stop/relaunch for already persisted reports. The
            # caller must first finish collection, save/export evidence and turn
            # preparation/awake controls off. Never clear app data or OS settings.
            $record = [ordered]@{type='nonverba-app-process-restart';version=1;status='checking';
                package='org.nonverba.camera';android_user_id=0;started_at_utc=[DateTime]::UtcNow.ToString('o');
                before_apk_sha256=$null;after_apk_sha256=$null;before_process_ids=@();after_process_ids=@();
                stop_attempted=$false;process_stop_verified=$false;launch_attempted=$false;own_focus_verified=$false;
                collection_invoked=$false;preparation_after_restart='unknown';app_data_cleared=$false;settings_changed=$false;error=$null}
            try {
                $before = (& $PSCommandPath -Action AppStatus) | ConvertFrom-Json
                if (-not $before.installed -or $before.android_user_id -ne 0 -or
                    $before.installed_apk_sha256 -cnotmatch '\A[a-f0-9]{64}\z') {
                    throw 'RestartApp requires installed Non-verba for foreground Android user 0.'
                }
                $record.before_apk_sha256 = $before.installed_apk_sha256
                $focus = Get-OwnUiFocus
                # pidof exits 1 when absent; only that fixed package is queried.
                $pidCommand = "'pidof org.nonverba.camera || true'"
                $pids = ((Invoke-Bridge @('-d','shell','sh','-c',$pidCommand)) -join ' ').Trim()
                if ($pids.Length -gt 256 -or $pids -cnotmatch '\A[1-9][0-9]{0,9}(?: [1-9][0-9]{0,9}){0,3}\z') {
                    throw 'Could not identify the focused Non-verba process before restart.'
                }
                $record.before_process_ids = @($pids -split ' ')
                if ((Get-OwnUiFocus) -cne $focus) { throw 'Non-verba focus changed before process stop.' }
                $record.stop_attempted = $true
                Invoke-Bridge @('-d','shell','am','force-stop','--user','0','org.nonverba.camera') | Out-Null
                $stoppedPids = ((Invoke-Bridge @('-d','shell','sh','-c',$pidCommand)) -join ' ').Trim()
                if ($stoppedPids.Length -ne 0) { throw 'Non-verba process stop was not verified; no launch was attempted.' }
                $record.process_stop_verified = $true
                $user = ((Invoke-Bridge @('-d','shell','am','get-current-user')) -join '').Trim()
                if ($user -cne '0') { throw 'Foreground Android user changed after process stop; no launch was attempted.' }
                $record.launch_attempted = $true
                Invoke-Bridge @('-d','shell','am','start','-W','--user','0',
                    '-n','org.nonverba.camera/.MainActivity') | Out-Null
                $after = (& $PSCommandPath -Action AppStatus) | ConvertFrom-Json
                $record.after_apk_sha256 = $after.installed_apk_sha256
                if (-not $after.installed -or $after.android_user_id -ne 0 -or
                    $after.installed_apk_sha256 -cne $record.before_apk_sha256) {
                    throw 'App installation or foreground user changed during restart.'
                }
                $null = Get-OwnUiFocus
                $record.own_focus_verified = $true
                $afterPids = ((Invoke-Bridge @('-d','shell','sh','-c',$pidCommand)) -join ' ').Trim()
                if ($afterPids.Length -gt 256 -or $afterPids -cnotmatch '\A[1-9][0-9]{0,9}(?: [1-9][0-9]{0,9}){0,3}\z') {
                    throw 'Could not identify the relaunched Non-verba process.'
                }
                $record.after_process_ids = @($afterPids -split ' ')
                $null = Get-OwnUiFocus
                $record.status = 'verified-process-restart'
            } catch { $record.status = 'stopped-user-needed'; $record.error = $_.Exception.Message }
            $record.completed_at_utc = [DateTime]::UtcNow.ToString('o')
            $path = Save-AppUiJson $record 'app-process-restart'
            [ordered]@{report=$path;restart=$record} | ConvertTo-Json -Depth 6
        }
        'AppUiState' {
            $state = Get-AppUiState
            $path = Save-AppUiJson $state 'app-ui'
            [ordered]@{state=$path;node_count=$state.nodes.Count;nodes=@(Get-AppUiSummary $state)} | ConvertTo-Json -Depth 7 -Compress
        }
        'StageCameraOffer' {
            $before = (& $PSCommandPath -Action AppStatus) | ConvertFrom-Json
            if (-not $before.installed -or $before.android_user_id -ne 0) { throw 'Camera offer staging requires installed debug Non-verba and foreground Android user 0.' }
            # Do not launch, alter fields or bypass the explicit in-app import.
            $focus = Get-OwnUiFocus
            $token = [Guid]::NewGuid().ToString('N')
            $remote = 'cache/camera-pairing/' + $token + '.json'
            $record = [ordered]@{type='nonverba-camera-offer-staging';version=1;status='incomplete';token=$token;
                source=$cameraOffer.path;original_sha256=$cameraOffer.sha256;original_bytes=$cameraOffer.bytes.Length;
                pairing_id=$cameraOffer.value.pairing_id;remote=$remote;installed_apk_sha256=$before.installed_apk_sha256;
                started_at_utc=[DateTime]::UtcNow.ToString('o');offer_loaded=$false;challenge_created=$false;sensors_started=$false;error=$null}
            try {
                if ((Get-OwnUiFocus) -cne $focus) { throw 'App focus changed before staging.' }
                $digest = Send-CameraOfferBytes $cameraOffer.bytes $token
                $record.staging_response = [string]$digest
                if ($digest -isnot [string] -or $digest -cne ($cameraOffer.sha256 + '  ' + $remote)) { throw 'Staged offer digest differs from the original; do not load this token.' }
                $guard = 'test -d cache && test ! -L cache && test -d cache/camera-pairing && test ! -L cache/camera-pairing && test -f ' + $remote + ' && test ! -L ' + $remote
                $command = $guard + ' && stat -c %s ' + $remote + ' && sha256sum ' + $remote
                $readback = @((Invoke-Bridge @('-d','shell','run-as','org.nonverba.camera','sh','-c',("'" + $command + "'"))) | ForEach-Object { $_.Trim() } | Where-Object { $_ })
                if ($readback.Count -ne 2 -or $readback[0] -cne [string]$cameraOffer.bytes.Length -or $readback[1] -cne $digest) { throw 'Staged offer size/hash changed; do not load this token.' }
                $after = (& $PSCommandPath -Action AppStatus) | ConvertFrom-Json
                if ($after.android_user_id -ne 0 -or -not $after.installed -or $after.installed_apk_sha256 -cne $before.installed_apk_sha256 -or
                    (Get-OwnUiFocus) -cne $focus) { throw 'User, app or focus changed during staging; import not authorized by this result.' }
                $record.status = 'verified-public-offer-staged'
            } catch { $record.error = $_.Exception.Message }
            $record.completed_at_utc = [DateTime]::UtcNow.ToString('o')
            $report = Save-AppUiJson $record 'camera-offer-stage'
            $instruction = if ($record.status -ceq 'verified-public-offer-staged') {
                'On Camera Operator, enter this token and explicitly load the staged offer. Supply the requester ID independently. Staging neither pairs nor starts a challenge.'
            } else { 'Do not load this token. Inspect the preserved staging report; partial or unverified files remain unused.' }
            [ordered]@{status=$record.status;token=$token;report=$report;offer_loaded=$false;sensors_started=$false;error=$record.error;
                instruction=$instruction} | ConvertTo-Json -Compress
        }
        'AppCameraChallenge' {
            $report = [ordered]@{type='nonverba-camera-challenge-transfer';version=1;status='checking';
                source=$cameraChallenge.path;original_sha256=$cameraChallenge.original_sha256;original_bytes=$cameraChallenge.original_bytes;
                canonical_sha256=$cameraChallenge.canonical_sha256;canonical_characters=$cameraChallenge.canonical.Length;
                wire_sha256=$cameraWire.sha256;wire_characters=$cameraWire.text.Length;
                wire_decoded_canonical_sha256=$cameraWire.decoded_canonical_sha256;
                challenge_id=$cameraChallenge.value.id;started_at_utc=[DateTime]::UtcNow.ToString('o');
                field_resource_id='operator-challenge';clearing_attempted=$false;insertion_attempted=$false;
                observed_sha256=$null;exact_field_verified=$false;challenge_loaded=$false;sensors_started=$false;error=$null}
            try {
                $state = Get-AppUiState
                $field = Get-CameraChallengeField $state
                if ($field.'text-length' -ne 0) { throw 'Camera challenge field must be empty. Reload the camera page before this action; existing text was preserved.' }
                $viewport = Get-AppUiViewport $state
                $pixelX = [int][Math]::Floor(($field.bounds[0]+$field.bounds[2])/2)
                $pixelY = [int][Math]::Floor(($field.bounds[1]+$field.bounds[3])/2)
                if ($pixelX -lt $viewport.bounds[0] -or $pixelX -ge $viewport.bounds[2] -or
                    $pixelY -lt $viewport.bounds[1] -or $pixelY -ge $viewport.bounds[3]) { throw 'Camera challenge field is outside the safe visible WebView.' }
                if ((Get-OwnUiFocus) -cne $state.focus) { throw 'App focus changed before targeting the challenge field.' }
                Invoke-Bridge @('-d','shell','input','tap',[string]$pixelX,[string]$pixelY) | Out-Null
                $focusedState = Get-AppUiState
                $focusedField = Get-CameraChallengeField $focusedState $true
                if ($focusedField.'text-sha256' -cne $field.'text-sha256' -or $focusedField.'text-length' -ne $field.'text-length') {
                    throw 'Camera challenge text changed while focusing the field.'
                }
                $unchanged = Read-BoundedCameraChallenge $cameraChallenge.path (Join-Path $codeRoot 'artifacts/device-acceptance')
                if ($unchanged.original_sha256 -cne $cameraChallenge.original_sha256) { throw 'Requester challenge file changed; no insertion attempted.' }
                $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
                if ($now -lt $cameraChallenge.value.issued_at -or $now -ge $cameraChallenge.value.expires_at) { throw 'Requester camera challenge is outside its original validity window.' }
                if ((Get-OwnUiFocus) -cne $focusedState.focus) { throw 'App focus changed before inserting the camera challenge.' }
                $report.insertion_attempted = $true
                Invoke-CameraChallengeText $cameraChallenge.canonical
                $finalState = Get-AppUiState
                $finalField = Get-CameraChallengeField $finalState $true
                $report.observed_sha256 = $finalField.'text-sha256'
                if ($finalField.'text-length' -ne $cameraWire.text.Length -or $finalField.'text-sha256' -cne $cameraWire.sha256) {
                    throw 'Full challenge field readback differs; delivery is unverified. Do not load this field.'
                }
                $report.exact_field_verified = $true; $report.status = 'verified-field-insertion'
            } catch { $report.status = 'stopped-user-needed'; $report.error = $_.Exception.Message }
            $report.completed_at_utc = [DateTime]::UtcNow.ToString('o')
            $reportPath = Save-AppUiJson $report 'app-camera-challenge'
            [ordered]@{status=$report.status;report=$reportPath;challenge_id=$report.challenge_id;
                exact_field_verified=$report.exact_field_verified;challenge_loaded=$false;sensors_started=$false;error=$report.error} | ConvertTo-Json -Compress
        }
        'AppUiBatch' {
            $planRoot = [IO.Path]::GetFullPath((Join-Path $codeRoot 'artifacts/device-acceptance'))
            $planPath = [IO.Path]::GetFullPath($UiPlan)
            if ([IO.Path]::GetDirectoryName($planPath) -ine $planRoot -or
                [IO.Path]::GetFileName($planPath) -cnotmatch '\A[A-Za-z0-9._-]{1,120}\.json\z') { throw 'UiPlan must be a JSON file directly inside device-acceptance.' }
            $planInfo = Get-Item -LiteralPath $planPath
            if ($planInfo.PSIsContainer -or $planInfo.Length -lt 1 -or $planInfo.Length -gt 16384 -or
                ($planInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
                ((Get-Item -LiteralPath $planRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Invalid bounded local UI plan.' }
            $plan = [IO.File]::ReadAllText($planPath,(New-Object Text.UTF8Encoding($false,$true))) | ConvertFrom-Json
            if ($plan -isnot [pscustomobject] -or $plan.version -ne 1 -or
                @($plan.PSObject.Properties.Name | Where-Object { $_ -cnotin @('version','steps') }).Count -or
                $plan.steps -isnot [Array] -or $plan.steps.Count -lt 1 -or $plan.steps.Count -gt 8) { throw 'UI plan requires version 1 and one to eight steps.' }
            foreach ($step in $plan.steps) {
                if ($step -isnot [pscustomobject] -or $step.action -cnotin @('tap','text','scroll')) { throw 'Unsupported UI plan action.' }
                $fields = switch ($step.action) {
                    'tap' { @('action','selector') }; 'text' { @('action','selector','text') }
                    'scroll' { @('action','direction') }
                }
                if (@($step.PSObject.Properties.Name | Where-Object { $_ -cnotin $fields }).Count -or
                    @($fields | Where-Object { $_ -cnotin $step.PSObject.Properties.Name }).Count) { throw 'Unexpected or missing UI step fields.' }
                if ($step.action -cin @('tap','text')) {
                    if ($step.selector -isnot [pscustomobject] -or @($step.selector.PSObject.Properties).Count -ne 1) { throw 'Exactly one selector field is required.' }
                    $property = @($step.selector.PSObject.Properties)[0]
                    if ($property.Name -cnotin @('resource-id','text','content-desc','id') -or $property.Value -isnot [string] -or
                        $property.Value.Length -lt 1 -or $property.Value.Length -gt 256 -or $property.Value -match '[\x00-\x1f\x7f]') { throw 'Invalid exact UI selector.' }
                    if ($property.Name -ceq 'id' -and $property.Value -cnotmatch '\Aui-[a-f0-9]{24}\z') { throw 'Invalid semantic selector ID.' }
                }
                if ($step.action -ceq 'text' -and ($step.text -isnot [string] -or $step.text -cnotmatch '\A[A-Za-z0-9][A-Za-z0-9 ._-]{0,199}\z')) { throw 'Only bounded public ASCII text insertion is supported.' }
                if ($step.action -ceq 'scroll' -and $step.direction -cnotin @('up','down')) { throw 'Scroll direction must be up or down.' }
            }
            $report = [ordered]@{type='nonverba-app-ui-batch';version=1;status='running';plan=$planPath;
                started_at_utc=[DateTime]::UtcNow.ToString('o');steps=@();final_state=$null;error=$null;last_observed_state=$null;last_observation_step=$null;last_observation_phase=$null;
                note='Each step uses a fresh own-app hierarchy. Input acknowledgement is not proof that a save or sensor operation succeeded.'}
            $finalState = $null
            $lastObservedState = $null; $lastObservedStep = $null
            try {
                foreach ($step in $plan.steps) {
                    $evidence = [ordered]@{index=($report.steps.Count+1);action=$step.action;status='checking';input_attempted=$false;input_sent=$false}
                    $report.steps += $evidence
                    $state = Get-AppUiState
                    $lastObservedState = $state; $lastObservedStep = $evidence.index
                    $evidence.observed_at_utc = $state.observed_at_utc
                    # Quiet-session scope: batch control never enters or acts on
                    # the audio workflow while microphone playback is on hold.
                    if (@($state.nodes | Where-Object { $_.'resource-id' -cmatch '\Aaudio-' }).Count) {
                        throw 'Audio workflow batch input is disabled during the microphone sound hold.'
                    }
                    # Only these two exact tap selectors can enter the native
                    # camera dialog branch. Text/scroll and all other selectors
                    # retain the existing WebView-only restriction.
                    $nativeCameraTap = $false
                    if ($step.action -ceq 'tap') {
                        $nativeSelector = @($step.selector.PSObject.Properties)[0]
                        $nativeCameraTap = $nativeSelector.Name -ceq 'text' -and $nativeSelector.Value -cin @('TAKE PHOTO','CANCEL')
                    }
                    $viewport = Get-AppUiViewport $state -NativeCameraOnly:$nativeCameraTap
                    $bounds = $viewport.bounds
                    $inputArgs = $null
                    if ($step.action -cin @('tap','text')) {
                        $property = @($step.selector.PSObject.Properties)[0]
                        $selectedNodes = @($state.nodes | Where-Object {
                            $_.($property.Name) -ceq $property.Value -and
                            ($property.Name -cnotin @('text','content-desc') -or -not $_.($property.Name+'-truncated'))
                        })
                        if ($selectedNodes.Count -ne 1) { throw 'UI selector is missing or ambiguous; batch stopped.' }
                        $node = $selectedNodes[0]
                        if ($node.'content-desc' -cmatch '\AAudio(?:\s|$)' -or $node.text -cmatch '\AAudio(?:\s|$)') {
                            throw 'Audio navigation is excluded from the quiet test batch.'
                        }
                        if (-not $node.enabled -or -not $node.clickable -or $node.password) { throw 'Selected node is disabled, non-clickable or a password field.' }
                        $pixelX = [int][Math]::Floor(($node.bounds[0]+$node.bounds[2])/2)
                        $pixelY = [int][Math]::Floor(($node.bounds[1]+$node.bounds[3])/2)
                        if ($pixelX -lt $bounds[0] -or $pixelX -ge $bounds[2] -or $pixelY -lt $bounds[1] -or $pixelY -ge $bounds[3]) { throw 'Selected node is outside safe visible app bounds.' }
                        $evidence.selector = $step.selector; $evidence.matched_id = $node.id
                        $evidence.resource_id = $node.'resource-id'; $evidence.bounds = $node.bounds
                        if ($nativeCameraTap) {
                            if ($node.class -cne 'android.widget.Button' -or $node.editable) { throw 'Only the exact native camera buttons accept native batch taps.' }
                            $evidence.native_camera_button = $node.text
                        }
                        if ($step.action -ceq 'text') {
                            if (-not $node.editable -or -not $node.focused) { throw 'Text insertion requires the exact selected EditText already focused.' }
                            $inputArgs = @('-d','shell','input','text',$step.text.Replace(' ','%s'))
                            $evidence.inserted_characters = $step.text.Length
                        } else { $inputArgs = @('-d','shell','input','tap',[string]$pixelX,[string]$pixelY) }
                    } elseif ($step.action -ceq 'scroll') {
                        if (-not $viewport.webview.scrollable) { throw 'The own WebView is not exposed as scrollable.' }
                        $pixelX = [int][Math]::Floor(($bounds[0]+$bounds[2])/2)
                        $upper = [int][Math]::Floor($bounds[1]+($bounds[3]-$bounds[1])*0.25)
                        $lower = [int][Math]::Floor($bounds[1]+($bounds[3]-$bounds[1])*0.75)
                        $from = if ($step.direction -ceq 'down') { $lower } else { $upper }
                        $to = if ($step.direction -ceq 'down') { $upper } else { $lower }
                        $inputArgs = @('-d','shell','input','swipe',[string]$pixelX,[string]$from,[string]$pixelX,[string]$to,'350')
                        $evidence.direction = $step.direction; $evidence.webview_bounds = $bounds
                    }
                    $focusBefore = Get-OwnUiFocus
                    if ($focusBefore -cne $state.focus) { throw 'App focus changed after selecting the fresh node.' }
                    $evidence.input_attempted = $true
                    Invoke-Bridge $inputArgs | Out-Null
                    $evidence.input_sent = $true
                    $evidence.focus_after = Get-OwnUiFocus
                    $evidence.status = 'input-sent-own-app-focused'
                }
                $finalState = Get-AppUiState
                $report.final_state = Save-AppUiJson $finalState 'app-ui'
                $report.status = 'complete'
            } catch {
                $report.status = 'stopped-user-needed'; $report.error = $_.Exception.Message
                if ($report.steps.Count) { $report.steps[-1].status = 'stopped' }
                if ($lastObservedState) {
                    $report.last_observed_state = Save-AppUiJson $lastObservedState 'app-ui'
                    $report.last_observation_step = $lastObservedStep
                    $report.last_observation_phase = 'before-step-input; not the final app state'
                }
            }
            $report.completed_at_utc = [DateTime]::UtcNow.ToString('o')
            $reportPath = Save-AppUiJson $report 'app-ui-batch'
            [ordered]@{status=$report.status;steps=$report.steps.Count;report=$reportPath;error=$report.error;
                final_state=$report.final_state;last_observed_state=$report.last_observed_state;
                last_observation_step=$report.last_observation_step;last_observation_phase=$report.last_observation_phase;
                last_observed_nodes=$(if ($report.last_observed_state) { @(Get-AppUiSummary $lastObservedState) } else { @() });
                nodes=$(if ($finalState) { @(Get-AppUiSummary $finalState) } else { @() })} | ConvertTo-Json -Depth 8 -Compress
        }
        'AppScreenshot' {
            # Observe only the focused Non-verba activity. No capture/shutter,
            # microphone, input injection, remote file or private app data read.
            $focusCommand = "'dumpsys window | grep mCurrentFocus'"
            $focus = ((Invoke-Bridge @('-d','shell','sh','-c',$focusCommand)) -join "`n").Trim()
            $pattern = '^mCurrentFocus=Window\{[^{}\r\n]* u0 org\.nonverba\.camera/(?:org\.nonverba\.camera\.)?\.?(?:MainActivity)\}$'
            if ($focus -cnotmatch $pattern) { throw "Non-verba is not the focused foreground user-0 app; no screenshot was taken. Focus: $focus" }
            $encoded = (Invoke-Bridge @('-d','shell','sh','-c',"'screencap -p | head -c 8388609 | base64'")) -join ''
            $focusAfter = ((Invoke-Bridge @('-d','shell','sh','-c',$focusCommand)) -join "`n").Trim()
            if ($focusAfter -cne $focus) { throw 'App focus changed; screenshot discarded.' }
            if ($encoded.Length -gt 11184812 -or $encoded -cnotmatch '^[A-Za-z0-9+/]+={0,2}$') { throw 'Invalid bounded screenshot transfer.' }
            $bytes = [Convert]::FromBase64String($encoded)
            if ($bytes.Length -lt 8 -or $bytes.Length -gt 8388608 -or
                [Convert]::ToBase64String($bytes) -cne $encoded -or
                [BitConverter]::ToString($bytes,0,8) -cne '89-50-4E-47-0D-0A-1A-0A') { throw 'Invalid PNG screenshot.' }
            $screenName = 'app-screen-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ') + '-' + [Guid]::NewGuid().ToString('N') + '.png'
            $path = Join-Path (Join-Path $codeRoot 'artifacts/device-acceptance') $screenName
            $stream = [IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
            try { $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
            Write-Output $path
        }
        { $_ -cin @('AppTap','AppSwipe','AppBack','AppText','AppDismissShare') } {
            # Explicit routine UI control only: no free-form shell input,
            # external-app navigation or permission/lock-screen interaction.
            $focusCommand = "'dumpsys window | grep mCurrentFocus'"
            $ownFocusPattern = '^mCurrentFocus=Window\{[^{}\r\n]* u0 org\.nonverba\.camera/(?:org\.nonverba\.camera\.)?\.?(?:MainActivity)\}$'
            # The only external-window exception dismisses the observed system
            # share chooser with Back; it cannot select a recipient or send.
            $focusPattern = if ($Action -ceq 'AppDismissShare') {
                '^mCurrentFocus=Window\{[a-f0-9]+ u0 android/com\.android\.internal\.app\.ChooserActivity\}$'
            } else { $ownFocusPattern }
            $focus = ((Invoke-Bridge @('-d','shell','sh','-c',$focusCommand)) -join "`n").Trim()
            if ($focus -cnotmatch $focusPattern) { throw 'The expected user-0 window is not focused; no input was sent. User interaction is required.' }
            $inputArgs = @('-d','shell','input','keyevent','KEYCODE_BACK')
            $screen = $null
            if ($Action -cne 'AppBack') {
                $sizes = @((Invoke-Bridge @('-d','shell','wm','size')) | ForEach-Object { $_.Trim() } | Where-Object { $_ })
                if ($sizes.Count -lt 1 -or $sizes.Count -gt 2 -or
                    $sizes[0] -cnotmatch '^Physical size: ([1-9][0-9]{0,4})x([1-9][0-9]{0,4})$') {
                    throw 'Ambiguous physical screen dimensions; no input was sent.'
                }
                $width = [int]$Matches[1]; $height = [int]$Matches[2]
                if ($sizes.Count -eq 2) {
                    if ($sizes[1] -cnotmatch '^Override size: ([1-9][0-9]{0,4})x([1-9][0-9]{0,4})$') {
                        throw 'Ambiguous override screen dimensions; no input was sent.'
                    }
                    $width = [int]$Matches[1]; $height = [int]$Matches[2]
                }
                if ($width -lt 100 -or $height -lt 100 -or $width -gt 32767 -or $height -gt 32767) {
                    throw 'Screen dimensions are outside supported bounds; no input was sent.'
                }
                $rotationText = ((Invoke-Bridge @('-d','shell','sh','-c',"'dumpsys input | grep SurfaceOrientation'")) -join "`n").Trim()
                if ($rotationText -cnotmatch '^SurfaceOrientation: ([0-3])$') {
                    throw 'Current display rotation is unavailable or ambiguous; no input was sent.'
                }
                $rotation = [int]$Matches[1]
                if ($rotation -in @(1,3)) { $naturalWidth = $width; $width = $height; $height = $naturalWidth }
                $screenshotRoot = [IO.Path]::GetFullPath((Join-Path $codeRoot 'artifacts/device-acceptance'))
                $screenshot = [IO.Path]::GetFullPath($ScreenshotPath)
                if ([IO.Path]::GetDirectoryName($screenshot) -ine $screenshotRoot -or
                    [IO.Path]::GetFileName($screenshot) -cnotmatch '^app-screen-([0-9]{8}T[0-9]{13}Z)-[a-f0-9]{32}\.png$') {
                    throw 'Use an original AppScreenshot file in code/artifacts/device-acceptance.'
                }
                $screenshotTime = [DateTime]::ParseExact($Matches[1], 'yyyyMMddTHHmmssfffffffZ',
                    [Globalization.CultureInfo]::InvariantCulture,
                    [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal)
                $age = ([DateTime]::UtcNow - $screenshotTime).TotalSeconds
                $info = Get-Item -LiteralPath $screenshot
                $modifiedAge = ([DateTime]::UtcNow - $info.LastWriteTimeUtc).TotalSeconds
                # Closing a share chooser has no coordinate target; allow time for export.
                $maximumAge = if ($Action -ceq 'AppDismissShare') { 600 } else { 120 }
                if ($age -lt 0 -or $age -gt $maximumAge -or $modifiedAge -lt 0 -or $modifiedAge -gt $maximumAge -or
                    $info.PSIsContainer -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
                    $info.Length -lt 33 -or $info.Length -gt 8388608) { throw 'Screenshot is stale or invalid; no input was sent.' }
                $header = New-Object byte[] 24
                $stream = [IO.File]::OpenRead($screenshot)
                try { $headerLength = $stream.Read($header,0,24) } finally { $stream.Dispose() }
                if ($headerLength -ne 24 -or [BitConverter]::ToString($header,0,16) -cne '89-50-4E-47-0D-0A-1A-0A-00-00-00-0D-49-48-44-52') {
                    throw 'Screenshot has no expected PNG IHDR; no input was sent.'
                }
                $pngWidth = [long]$header[16] * 16777216 + [long]$header[17] * 65536 + [long]$header[18] * 256 + $header[19]
                $pngHeight = [long]$header[20] * 16777216 + [long]$header[21] * 65536 + [long]$header[22] * 256 + $header[23]
                if ($pngWidth -ne $width -or $pngHeight -ne $height) { throw 'Screenshot and current rotated screen dimensions differ; no input was sent.' }
                $inset = [int][Math]::Ceiling($height * 0.04)
                if ($Action -ceq 'AppText') {
                    # The parameter allowlist excludes %, quotes, shell syntax,
                    # control characters and Unicode. Encoding spaces yields one
                    # shell-safe token; Android input text decodes %s as spaces.
                    # This only inserts into the observed focused field. It does
                    # not clear text, select all, access a clipboard or submit.
                    $inputArgs = @('-d','shell','input','text',$Text.Replace(' ','%s'))
                } elseif ($Action -cne 'AppDismissShare') {
                    $points = ,@([int]$X,[int]$Y)
                    if ($Action -ceq 'AppSwipe') { $points += ,@([int]$ToX,[int]$ToY) }
                    foreach ($point in $points) {
                        if ($point[0] -lt 0 -or $point[0] -ge $width -or $point[1] -lt $inset -or $point[1] -ge $height - $inset) {
                            throw 'Input is outside the screen or inside its protected status/navigation inset.'
                        }
                    }
                    $inputArgs = if ($Action -ceq 'AppTap') { @('-d','shell','input','tap',$X,$Y) }
                        else { @('-d','shell','input','swipe',$X,$Y,$ToX,$ToY,$DurationMs) }
                }
                $screen = [ordered]@{width=$width;height=$height;rotation=$rotation;vertical_inset=$inset;screenshot=$screenshot}
                # Refuse if rotation changed while the screenshot was checked.
                $rotationAgain = ((Invoke-Bridge @('-d','shell','sh','-c',"'dumpsys input | grep SurfaceOrientation'")) -join "`n").Trim()
                if ($rotationAgain -cne $rotationText) { throw 'Display rotation changed; no input was sent.' }
            }
            # This is the final phone query before the one fixed input command.
            $focusAgain = ((Invoke-Bridge @('-d','shell','sh','-c',$focusCommand)) -join "`n").Trim()
            if ($focusAgain -cne $focus -or $focusAgain -cnotmatch $focusPattern) { throw 'App focus changed; no input was sent.' }
            Invoke-Bridge $inputArgs | Out-Null
            $focusAfter = ((Invoke-Bridge @('-d','shell','sh','-c',$focusCommand)) -join "`n").Trim()
            $stillInApp = $focusAfter -cmatch $ownFocusPattern
            [ordered]@{type='nonverba-ui-input';action=$Action;input_sent=$true;
                status=$(if ($stillInApp) { 'app-focused' } else { 'stopped-user-needed' });
                user_action_required=(-not $stillInApp);focus_before=$focus;focus_after=$focusAfter;screen=$screen;
                instruction='Observe a fresh AppScreenshot before any next input. If focus left Non-verba, stop and ask the user; do not follow into another app or permission screen.'} | ConvertTo-Json -Depth 5
        }
        { $_ -cin @('ExportEnrollments','ExportLocations','ExportCamera','ExportCameraQuality','ExportCameraPairing') } {
            # These fixed actions share the bounded transfer path. Only their
            # explicit UI-export filename/shape/size allowlists differ.
            # No caller-supplied command/path, private app files or keys.
            $enrollments = $Action -ceq 'ExportEnrollments'
            $camera = $Action -ceq 'ExportCamera'
            $cameraQuality = $Action -ceq 'ExportCameraQuality'
            $pairing = $Action -ceq 'ExportCameraPairing'
            $category = if ($enrollments) { 'enrollment' } elseif ($camera) { 'camera' } elseif ($cameraQuality) { 'camera-quality' } elseif ($pairing) { 'camera-pairing' } else { 'location' }
            $names = if ($enrollments) {
                @('nonverba-key-enrollment-request.json','nonverba-key-enrollment-response.json')
            } elseif ($camera) {
                @('nonverba-????????????.jpg','nonverba-challenge-????????????.json','nonverba-public-device-id.txt')
            } elseif ($cameraQuality) {
                @('nonverba-camera-quality-????????????.json')
            } elseif ($pairing) {
                @('nonverba-camera-offer.json','nonverba-camera-answer.json')
            } else {
                @('nonverba-location-????????????.json','nonverba-location-request-????????????.json','nonverba-public-location-key.json',
                    'nonverba-gps-attempt-????????-????-????-????-????????????.json',
                    'nonverba-gps-attempt-request-????????-????-????-????-????????????.json')
            }
            $uuidPattern = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
            $exportPattern = if ($enrollments) {
                '^cache/exports/(' + $uuidPattern + ')/(nonverba-key-enrollment-(request|response)\.json)$'
            } elseif ($camera) {
                '^cache/exports/(' + $uuidPattern + ')/((?:nonverba-[a-f0-9]{12}\.jpg|nonverba-challenge-[a-f0-9]{12}\.json|nonverba-public-device-id\.txt))$'
            } elseif ($cameraQuality) {
                '\Acache/exports/(' + $uuidPattern + ')/(nonverba-camera-quality-[a-f0-9]{12}\.json)\z'
            } elseif ($pairing) {
                '^cache/exports/(' + $uuidPattern + ')/(nonverba-camera-(offer|answer)\.json)$'
            } else {
                '^cache/exports/(' + $uuidPattern + ')/((?:nonverba-location-(?:request-)?[a-f0-9]{12}|nonverba-public-location-key|nonverba-gps-attempt-(?:request-)?' + $uuidPattern + ')\.json)$'
            }
            $before = (& $PSCommandPath -Action AppStatus) | ConvertFrom-Json
            if (-not $before.installed -or $before.android_user_id -ne 0) {
                throw 'Public export retrieval currently requires the installed debug app and foreground Android user 0.'
            }
            $rootGuard = 'test -d cache/exports && test ! -L cache && test ! -L cache/exports'
            $paths = @()
            foreach ($name in $names) {
                # find does not follow symlinks. Limit listing output before it
                # crosses USB, and reject a truncated/excessive inventory.
                # Escape the fixed glob for the remote shell; find alone should
                # interpret its question marks. Avoid nested native-CLI quotes.
                $findName = $name.Replace('?', '\?')
                $command = "$rootGuard && find cache/exports -mindepth 2 -maxdepth 2 -type f -name $findName | head -n 129"
                $paths += @((Invoke-Bridge @('-d','shell','run-as','org.nonverba.camera','sh','-c',("'" + $command + "'"))) |
                    ForEach-Object { $_.Trim() } | Where-Object { $_ })
            }
            if ($paths.Count -eq 0) { throw "No public $category exports found. Use this page's explicit Save controls in the app first." }
            if ($paths.Count -gt 128 -or @($paths | Select-Object -Unique).Count -ne $paths.Count) {
                throw 'Unexpected or excessive public export inventory; no files were read.'
            }
            if ($cameraQuality) { Assert-CameraQualityExportInventory $paths }
            foreach ($remotePath in $paths) {
                if ($remotePath -cnotmatch $exportPattern) { throw 'Unexpected public export path; no files were read.' }
            }
            $runName = $category + '-exports-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ') + '-' + [Guid]::NewGuid().ToString('N')
            $output = Join-Path (Join-Path $codeRoot 'artifacts/device-acceptance') $runName
            [IO.Directory]::CreateDirectory($output) | Out-Null
            $record = [ordered]@{type=('nonverba-public-' + $category + '-retrieval');version=1;status='incomplete';
                started_at_utc=[DateTime]::UtcNow.ToString('o');usb_transport=$true;android_user_id=0;
                package='org.nonverba.camera';installed_apk_sha256=$before.installed_apk_sha256;
                files=@();independent_requester_freshness_witness=$false;attestation_verified=$false;
                sensor_tests_run=$false;timing_note='Retrieval times describe this USB copy only. They do not establish independently witnessed challenge issuance or earlier response arrival.'}
            if ($camera) {
                $record.context_note = 'Operator-exported camera artifacts. Retrieval does not verify C2PA, the scene, GPS, request freshness or signing-key trust; independent Linux verification is required.'
                $record.camera_evidence_verified = $false
            } elseif ($cameraQuality) {
                $record.context_note = 'Explicitly exported unsigned image quality guidance only. Retrieval checks bytes and bounded shape, not authenticity, metric correctness, task usability, operator effort or responsibility. Recompute independently retained JPEG/profile bytes with Rust/WASM.'
                $record.guidance_only = $true
                $record.authenticity_proven = $false
                $record.quality_metrics_verified = $false
                $record.successful_measurement_acceptance_available = $false
            } elseif ($pairing) {
                $record.context_note = 'Public pre-challenge camera signaling only. Retrieval does not authenticate peer identities, prove ICE connectivity, create a challenge or verify evidence.'
            } elseif (-not $enrollments) {
                $record.context_note = 'Operator-exported location records. Local demos remain local demos; signatures, coordinates, request binding and any demo labels require independent Rust verification.'
                $record.location_evidence_verified = $false
            }
            try {
                foreach ($remotePath in ($paths | Sort-Object)) {
                    if ($remotePath -cnotmatch $exportPattern) { throw 'Unexpected public export path.' }
                    $exportId = $Matches[1]; $name = $Matches[2]
                    $challengePrefix = $null
                    if ($enrollments) {
                        $kind = $Matches[3]
                        $maximum = if ($kind -eq 'request') { 4096 } else { 256 * 1024 }
                    } elseif ($pairing) {
                        $kind = $Matches[3]; $maximum = 120000
                    } elseif ($camera) {
                        if ($name -cmatch '^nonverba-([a-f0-9]{12})\.jpg$') {
                            $kind = 'photo'; $challengePrefix = $Matches[1]; $maximum = 32 * 1024 * 1024
                        } elseif ($name -cmatch '^nonverba-challenge-([a-f0-9]{12})\.json$') {
                            $kind = 'request'; $challengePrefix = $Matches[1]; $maximum = 16 * 1024
                        } else { $kind = 'key'; $maximum = 1024 }
                    } elseif ($cameraQuality) {
                        $qualitySpec = Get-CameraQualityExportSpec $name
                        $kind = $qualitySpec.kind; $maximum = $qualitySpec.maximum
                    } elseif ($name -cmatch ('^nonverba-gps-attempt-request-(' + $uuidPattern + ')\.json$')) {
                        $kind = 'attempt-request'; $attemptId = $Matches[1]; $maximum = 64 * 1024
                    } elseif ($name -cmatch ('^nonverba-gps-attempt-(' + $uuidPattern + ')\.json$')) {
                        $kind = 'attempt'; $attemptId = $Matches[1]; $maximum = 4 * 1024 * 1024 + 32 * 1024
                    } elseif ($name -cmatch '^nonverba-location-request-([a-f0-9]{12})\.json$') {
                        $kind = 'request'; $challengePrefix = $Matches[1]; $maximum = 64 * 1024
                    } elseif ($name -cmatch '^nonverba-location-([a-f0-9]{12})\.json$') {
                        $kind = 'proof'; $challengePrefix = $Matches[1]
                        # MAX_LOCATION_PROOF * 2 is the existing JSON envelope
                        # limit in location-platform.js and location-ui.js.
                        $maximum = 2 * (2 * 1024 * 1024 + 16 * 1024)
                    } else {
                        $kind = 'key'; $maximum = 16 * 1024
                    }
                    $folder = 'cache/exports/' + $exportId
                    $guard = "$rootGuard && test -d $folder && test ! -L $folder && test -f $remotePath && test ! -L $remotePath"
                    $userId = ((Invoke-Bridge @('-d','shell','am','get-current-user')) -join '').Trim()
                    if ($userId -cne '0') { throw 'Foreground user changed; retrieval stopped.' }
                    $command = "$guard && stat -c %s $remotePath"
                    $sizeText = ((Invoke-Bridge @('-d','shell','run-as','org.nonverba.camera','sh','-c',("'" + $command + "'"))) -join '').Trim()
                    if ($sizeText -cnotmatch '^[1-9][0-9]{0,8}$' -or [long]$sizeText -gt $maximum) { throw 'Public export exceeds its size bound.' }
                    $command = "$guard && sha256sum $remotePath"
                    $hashBefore = ((Invoke-Bridge @('-d','shell','run-as','org.nonverba.camera','sh','-c',("'" + $command + "'"))) -join '').Trim()
                    if ($hashBefore -cnotmatch '^([a-f0-9]{64})  ([A-Za-z0-9/._-]+)$' -or $Matches[2] -cne $remotePath) { throw 'Unexpected public export digest.' }
                    $expectedHash = $Matches[1]
                    # A bounded head prevents a changed/growing file from
                    # producing an unbounded base64 response. Exact length and
                    # hashes below reject truncation, replacement or read errors.
                    $command = "$guard && head -c $($maximum + 1) $remotePath | base64"
                    $encoded = (Invoke-Bridge @('-d','shell','run-as','org.nonverba.camera','sh','-c',("'" + $command + "'"))) -join ''
                    $retrievedAt = [DateTime]::UtcNow.ToString('o')
                    if ($encoded.Length -gt [Math]::Ceiling(($maximum + 1) / 3.0) * 4 -or
                        $encoded -cnotmatch '^[A-Za-z0-9+/]+={0,2}$') { throw 'Invalid public export base64 transport.' }
                    $bytes = [Convert]::FromBase64String($encoded)
                    if ($bytes.Length -ne [long]$sizeText -or $bytes.Length -gt $maximum -or
                        [Convert]::ToBase64String($bytes) -cne $encoded) { throw 'Public export changed size or has noncanonical transport encoding.' }
                    $sha = [Security.Cryptography.SHA256]::Create()
                    try { $actualHash = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() }
                    finally { $sha.Dispose() }
                    $command = "$guard && sha256sum $remotePath"
                    $hashAfter = ((Invoke-Bridge @('-d','shell','run-as','org.nonverba.camera','sh','-c',("'" + $command + "'"))) -join '').Trim()
                    if ($actualHash -cne $expectedHash -or $hashAfter -cne $hashBefore) { throw 'Public export bytes changed during retrieval.' }
                    # Transport shape checks only. Preserve original bytes for
                    # independent Rust protocol/signature/chain verification.
                    if ($camera) {
                        Assert-CameraPublicExport -Bytes $bytes -Kind $kind -ChallengePrefix $challengePrefix
                    } elseif ($cameraQuality) {
                        $publicRecord = Assert-CameraQualityPublicExport -Bytes $bytes -Name $name
                    } elseif ($pairing) {
                        $publicRecord = Assert-CameraPairingRecord -Bytes $bytes -Kind $kind
                    } else {
                        $utf8 = New-Object Text.UTF8Encoding($false, $true)
                        $publicRecord = $utf8.GetString($bytes) | ConvertFrom-Json
                        if ($enrollments) {
                            $expectedType = if ($kind -eq 'request') { 'nonverba-key-enrollment-request' } else { 'nonverba-key-enrollment' }
                            $allowed = if ($kind -eq 'request') {
                                @('version','type','purpose','nonce_b64','challenge_b64','issued_at','expires_at')
                            } else {
                                @('version','type','purpose','challenge_b64','public_spki_der_b64','spki_sha256','fingerprint','chain',
                                    'key_profile','security_level','strongbox_requested','strongbox_fallback','hardware_attested','certificate_pem')
                            }
                        } else {
                            switch ($kind) {
                                'request' { $expectedType = 'nonverba-location-request'; $allowed = @('version','type','challenge','demo','policy','context') }
                                'attempt-request' { $expectedType = 'nonverba-location-request'; $allowed = @('version','type','challenge','demo','policy','context') }
                                'attempt' { $expectedType = 'nonverba-gps-attempt-export'; $allowed = @('version','type','attempt_id','status','original_request_json','native_snapshot_json','report_base64','error') }
                                'proof' { $expectedType = 'nonverba-location-proof'; $allowed = @('version','type','proof_base64') }
                                'key' { $expectedType = 'nonverba-public-location-key'; $allowed = @('version','type','fingerprint','public_spki_der_b64','profile') }
                            }
                        }
                        if ($publicRecord -isnot [pscustomobject] -or $publicRecord.version -ne 1 -or
                            $publicRecord.type -cne $expectedType -or
                            @($publicRecord.PSObject.Properties.Name | Where-Object { $_ -cnotin $allowed }).Count) {
                            throw 'The exported JSON is not the expected public record.'
                        }
                        $demoClaim = $null
                        if ($enrollments) {
                            if ($publicRecord.purpose -cnotin @('location','media')) { throw 'The exported JSON is not the expected public enrollment record.' }
                        } elseif ($kind -eq 'attempt') {
                            if ($publicRecord.attempt_id -cne $attemptId -or
                                $publicRecord.status -cnotin @('signed','signed-storage-failed','unsigned-pending','unsigned-signing-failed','unsigned-storage-failed') -or
                                $publicRecord.original_request_json -isnot [string] -or
                                $utf8.GetByteCount($publicRecord.original_request_json) -gt 65536 -or
                                ($null -ne $publicRecord.error -and ($publicRecord.error -isnot [string] -or $publicRecord.error.Length -gt 400))) {
                                throw 'Invalid public GPS attempt export.'
                            }
                            if ($publicRecord.status -clike 'signed*') {
                                $reportLimit = 2 * 1024 * 1024 + 16 * 1024
                                if ($null -ne $publicRecord.native_snapshot_json -or $publicRecord.report_base64 -isnot [string] -or
                                    $publicRecord.report_base64.Length -gt [Math]::Ceiling($reportLimit / 3.0) * 4 -or
                                    $publicRecord.report_base64 -cnotmatch '^[A-Za-z0-9+/]+={0,2}$') { throw 'Invalid signed GPS attempt envelope.' }
                                $reportBytes = [Convert]::FromBase64String($publicRecord.report_base64)
                                if ($reportBytes.Length -lt 1 -or $reportBytes.Length -gt $reportLimit -or
                                    [Convert]::ToBase64String($reportBytes) -cne $publicRecord.report_base64) { throw 'Invalid bounded GPS report.' }
                            } elseif ($null -ne $publicRecord.report_base64 -or $publicRecord.native_snapshot_json -isnot [string] -or
                                $utf8.GetByteCount($publicRecord.native_snapshot_json) -gt 2 * 1024 * 1024) { throw 'Invalid unsigned GPS attempt envelope.' }
                        } elseif ($kind -in @('request','attempt-request')) {
                            if ($kind -eq 'attempt-request' -and $publicRecord.challenge.id -cmatch '^[a-f0-9]{64}$') {
                                $challengePrefix = $publicRecord.challenge.id.Substring(0,12)
                            }
                            if ($publicRecord.challenge -isnot [pscustomobject] -or
                                $publicRecord.challenge.id -cnotmatch '^[a-f0-9]{64}$' -or
                                $publicRecord.challenge.id.Substring(0,12) -cne $challengePrefix) { throw 'Location request does not match its exported filename.' }
                            if ($publicRecord.PSObject.Properties.Name -ccontains 'demo') {
                                if ($publicRecord.demo -isnot [bool]) { throw 'Invalid location demo label.' }
                                $demoClaim = $publicRecord.demo
                            } else { $demoClaim = $false }
                        } elseif ($kind -eq 'proof') {
                            $proofLimit = 2 * 1024 * 1024 + 16 * 1024
                            $proofBase64 = $publicRecord.proof_base64
                            if ($proofBase64 -isnot [string] -or $proofBase64.Length -gt [Math]::Ceiling($proofLimit / 3.0) * 4 -or
                                $proofBase64 -cnotmatch '^[A-Za-z0-9+/]+={0,2}$') { throw 'Invalid bounded location proof envelope.' }
                            $proofBytes = [Convert]::FromBase64String($proofBase64)
                            if ($proofBytes.Length -lt 1 -or $proofBytes.Length -gt $proofLimit -or
                                [Convert]::ToBase64String($proofBytes) -cne $proofBase64) { throw 'Invalid bounded location proof envelope.' }
                        } elseif ($publicRecord.fingerprint -cnotmatch '^[a-f0-9]{64}$' -or
                            $publicRecord.profile -cnotin @('native-android','software-browser') -or
                            $publicRecord.public_spki_der_b64 -isnot [string] -or
                            $publicRecord.public_spki_der_b64.Length -gt 8192 -or
                            $publicRecord.public_spki_der_b64 -cnotmatch '^[A-Za-z0-9+/]+={0,2}$') {
                            throw 'Invalid public location key record.'
                        }
                    }
                    $localName = $exportId + '-' + $name
                    $destination = Join-Path $output $localName
                    $stream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
                    try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
                    $entry = [ordered]@{source=$remotePath;file=$localName;kind=$kind;bytes=$bytes.Length;
                        sha256=$actualHash;retrieved_at_utc=$retrievedAt;purpose='location'}
                    if ($enrollments) { $entry.purpose = $publicRecord.purpose }
                    elseif ($camera) { $entry.purpose = 'camera'; $entry.challenge_id_prefix = $challengePrefix }
                    elseif ($cameraQuality) {
                        $entry.purpose = 'camera-quality'; $entry.artifact_type = 'nonverba-camera-quality-report'
                        $entry.image_sha256 = $publicRecord.image_sha256; $entry.analysis_profile_sha256 = $publicRecord.analysis_profile_sha256
                        $entry.guidance_only = $true; $entry.signed = $false
                    }
                    elseif ($pairing) { $entry.purpose = 'camera-pairing'; $entry.pairing_id = $publicRecord.pairing_id }
                    elseif ($kind -in @('attempt','attempt-request')) { $entry.attempt_id = $attemptId }
                    else { $entry.challenge_id_prefix = $challengePrefix; $entry.unverified_demo_claim = $demoClaim }
                    $record.files += $entry
                }
                $after = (& $PSCommandPath -Action AppStatus) | ConvertFrom-Json
                if ($after.android_user_id -ne 0 -or -not $after.installed -or
                    $after.installed_apk_sha256 -cne $before.installed_apk_sha256) { throw 'Foreground user or installed app changed during retrieval.' }
                $record.status = 'complete'
            } catch {
                $record.error = $_.Exception.Message
                throw
            } finally {
                $record.completed_at_utc = [DateTime]::UtcNow.ToString('o')
                $manifest = Join-Path $output 'retrieval.json'
                $json = $record | ConvertTo-Json -Depth 8
                [IO.File]::WriteAllText($manifest, $json, (New-Object Text.UTF8Encoding($false)))
            }
            [ordered]@{status=$record.status;files=$record.files.Count;manifest=$manifest;
                attestation_verified=$false;independent_requester_freshness_witness=$false} | ConvertTo-Json
        }
        'VerifySavedDownloads' {
            # Validate the complete local retrieval before deriving any phone
            # path. No supplied device path, directory listing or private files.
            $acceptanceRoot = [IO.Path]::GetFullPath((Join-Path $codeRoot 'artifacts/device-acceptance'))
            $manifestPath = [IO.Path]::GetFullPath($RetrievalManifest)
            $retrievalDirectory = [IO.Path]::GetDirectoryName($manifestPath)
            if ([IO.Path]::GetFileName($manifestPath) -cne 'retrieval.json' -or
                [IO.Path]::GetDirectoryName($retrievalDirectory) -ine $acceptanceRoot -or
                [IO.Path]::GetFileName($retrievalDirectory) -cnotmatch '^(enrollment|location|camera)-exports-[0-9]{8}T[0-9]{13}Z-[a-f0-9]{32}$') {
                throw 'Use a public export retrieval.json directly inside its original device-acceptance retrieval directory.'
            }
            $category = $Matches[1]
            foreach ($localPath in @($acceptanceRoot,$retrievalDirectory,$manifestPath)) {
                if (((Get-Item -LiteralPath $localPath).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                    throw 'Linked retrieval paths are not accepted.'
                }
            }
            $manifestInfo = Get-Item -LiteralPath $manifestPath
            if ($manifestInfo.PSIsContainer -or $manifestInfo.Length -lt 1 -or $manifestInfo.Length -gt 1048576) { throw 'Invalid bounded retrieval manifest.' }
            $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
            $retrieval = [IO.File]::ReadAllText($manifestPath, (New-Object Text.UTF8Encoding($false,$true))) | ConvertFrom-Json
            if ($retrieval -isnot [pscustomobject] -or $retrieval.type -cne ('nonverba-public-' + $category + '-retrieval') -or
                $retrieval.version -ne 1 -or $retrieval.status -cne 'complete' -or $retrieval.usb_transport -cne $true -or
                $retrieval.android_user_id -ne 0 -or $retrieval.package -cne 'org.nonverba.camera' -or
                $retrieval.installed_apk_sha256 -cnotmatch '\A[a-f0-9]{64}\z' -or
                $retrieval.files -isnot [Array] -or $retrieval.files.Count -lt 1 -or $retrieval.files.Count -gt 128) {
                throw 'Expected a complete, bounded, user-0 public USB retrieval manifest.'
            }
            $uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
            $sourcePattern = '\Acache/exports/(' + $uuid + ')/([a-z0-9.-]+)\z'
            $expected = @()
            foreach ($entry in $retrieval.files) {
                if ($entry -isnot [pscustomobject] -or $entry.source -cnotmatch $sourcePattern -or
                    $entry.sha256 -cnotmatch '\A[a-f0-9]{64}\z' -or
                    [string]$entry.bytes -cnotmatch '\A[1-9][0-9]{0,8}\z') { throw 'Invalid public retrieval file entry.' }
                # Re-match after validating other fields to retain captures.
                $null = $entry.source -cmatch $sourcePattern
                $exportId = $Matches[1]; $name = $Matches[2]
                $kind = $null; $maximum = 0
                if ($category -ceq 'enrollment') {
                    if ($name -ceq 'nonverba-key-enrollment-request.json') { $kind = 'request'; $maximum = 4096 }
                    elseif ($name -ceq 'nonverba-key-enrollment-response.json') { $kind = 'response'; $maximum = 256 * 1024 }
                    if ($entry.purpose -cnotin @('location','media')) { throw 'Invalid public enrollment purpose.' }
                } elseif ($category -ceq 'location') {
                    if ($name -cmatch ('\Anonverba-gps-attempt-' + $uuid + '\.json\z')) { $kind = 'attempt'; $maximum = 4 * 1024 * 1024 + 32 * 1024 }
                    elseif ($name -cmatch ('\Anonverba-gps-attempt-request-' + $uuid + '\.json\z')) { $kind = 'attempt-request'; $maximum = 64 * 1024 }
                    elseif ($name -cmatch '\Anonverba-location-[a-f0-9]{12}\.json\z') { $kind = 'proof'; $maximum = 2 * (2 * 1024 * 1024 + 16 * 1024) }
                    elseif ($name -cmatch '\Anonverba-location-request-[a-f0-9]{12}\.json\z') { $kind = 'request'; $maximum = 64 * 1024 }
                    elseif ($name -ceq 'nonverba-public-location-key.json') { $kind = 'key'; $maximum = 16 * 1024 }
                    if ($entry.purpose -cne 'location') { throw 'Invalid public location purpose.' }
                } else {
                    if ($name -cmatch '\Anonverba-[a-f0-9]{12}\.jpg\z') { $kind = 'photo'; $maximum = 32 * 1024 * 1024 }
                    elseif ($name -cmatch '\Anonverba-challenge-[a-f0-9]{12}\.json\z') { $kind = 'request'; $maximum = 16 * 1024 }
                    elseif ($name -ceq 'nonverba-public-device-id.txt') { $kind = 'key'; $maximum = 1024 }
                    if ($entry.purpose -cne 'camera') { throw 'Invalid public camera purpose.' }
                }
                if (-not $kind -or $entry.kind -cne $kind -or [long]$entry.bytes -gt $maximum -or
                    $entry.file -cne ($exportId + '-' + $name)) { throw 'Retrieval entry is outside its public filename, kind or size allowlist.' }
                $localFile = Join-Path $retrievalDirectory $entry.file
                $localInfo = Get-Item -LiteralPath $localFile
                if ($localInfo.PSIsContainer -or ($localInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
                    $localInfo.Length -ne [long]$entry.bytes -or
                    (Get-FileHash -LiteralPath $localFile -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256) {
                    throw 'Original public retrieval bytes no longer match their manifest.'
                }
                $expected += [pscustomobject]@{name=$name;file=$entry.file;kind=$kind;bytes=[long]$entry.bytes;
                    sha256=$entry.sha256;maximum=$maximum}
            }
            if (@($expected.file | Select-Object -Unique).Count -ne $expected.Count -or
                (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifestHash) {
                throw 'Retrieval manifest changed or contains duplicate local entries.'
            }
            $before = (& $PSCommandPath -Action AppStatus) | ConvertFrom-Json
            if (-not $before.installed -or $before.android_user_id -ne 0 -or
                $before.installed_apk_sha256 -cne $retrieval.installed_apk_sha256 -or
                $before.properties.'ro.build.version.sdk' -cnotmatch '\A[0-9]{1,3}\z' -or
                [int]$before.properties.'ro.build.version.sdk' -lt 29) {
                throw 'Saved Downloads verification requires user 0, API29+, and the same installed APK as the public retrieval.'
            }
            $reportName = 'downloads-check-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ') + '-' + [Guid]::NewGuid().ToString('N') + '.json'
            $reportPath = Join-Path $acceptanceRoot $reportName
            $report = [ordered]@{type='nonverba-saved-downloads-check';version=1;status='incomplete';
                started_at_utc=[DateTime]::UtcNow.ToString('o');retrieval_manifest=$manifestPath;retrieval_manifest_sha256=$manifestHash;
                installed_apk_sha256=$before.installed_apk_sha256;android_user_id=0;usb_transport=$true;files=@();
                all_exact_paths_match=$false;sensor_tests_run=$false;attestation_verified=$false;independent_requester_freshness_witness=$false;
                scope_note='Only exact unsuffixed Download/Non-verba names were inspected. No directory enumeration or duplicate-suffix search. A match proves these bytes were present at that path when read, not which MediaStore row/save created them, freshness or physical authenticity.'}
            try {
                foreach ($expectedFile in $expected) {
                    $result = [ordered]@{file=$expectedFile.file;name=$expectedFile.name;expected_bytes=$expectedFile.bytes;
                        expected_sha256=$expectedFile.sha256;status='not-checked';checked_at_utc=$null}
                    $report.files += $result
                    if (@($expected | Where-Object name -CEQ $expectedFile.name).Count -gt 1) {
                        $result.status = 'ambiguous-repeated-export-name'; continue
                    }
                    $userId = ((Invoke-Bridge @('-d','shell','am','get-current-user')) -join '').Trim()
                    if ($userId -cne '0') { throw 'Foreground user changed; public Downloads checks stopped.' }
                    $remoteFile = '/storage/emulated/0/Download/Non-verba/' + $expectedFile.name
                    $result.path = $remoteFile
                    # Filename is from the strict public allowlist above. Read
                    # at most maximum+1 bytes into SHA-256, never across USB.
                    # Missing and inaccessible paths are deliberately combined:
                    # test -e cannot distinguish them without broader access.
                    $command = 'if test -L /storage || test -L /storage/emulated || test -L /storage/emulated/0 || test -L /storage/emulated/0/Download || test -L /storage/emulated/0/Download/Non-verba || test -L {0}; then echo UNSAFE_LINK; elif test ! -d /storage/emulated/0/Download/Non-verba; then echo MISSING_OR_INACCESSIBLE_DIRECTORY; elif test ! -e {0}; then echo MISSING_OR_INACCESSIBLE_FILE; elif test ! -f {0}; then echo NOT_REGULAR_FILE; elif test ! -r {0}; then echo NOT_READABLE; elif test $(stat -c %s {0}) -gt {1}; then echo OVERSIZED; else echo FILE; stat -c %s {0}; head -c {2} {0} | sha256sum; stat -c %s {0}; fi' -f $remoteFile,$expectedFile.maximum,($expectedFile.maximum + 1)
                    $lines = @((Invoke-Bridge @('-d','shell','sh','-c',("'" + $command + "'"))) | ForEach-Object { $_.Trim() } | Where-Object { $_ })
                    $result.checked_at_utc = [DateTime]::UtcNow.ToString('o')
                    if ($lines.Count -eq 1 -and $lines[0] -cin @('UNSAFE_LINK','MISSING_OR_INACCESSIBLE_DIRECTORY','MISSING_OR_INACCESSIBLE_FILE','NOT_REGULAR_FILE','NOT_READABLE','OVERSIZED')) {
                        $result.status = $lines[0].ToLowerInvariant().Replace('_','-'); continue
                    }
                    if ($lines.Count -ne 4 -or $lines[0] -cne 'FILE' -or
                        $lines[1] -cnotmatch '\A(?:0|[1-9][0-9]{0,8})\z' -or $lines[3] -cne $lines[1] -or
                        [long]$lines[1] -gt $expectedFile.maximum -or $lines[2] -cnotmatch '\A([a-f0-9]{64})  -\z') {
                        throw 'Unexpected or changed public Downloads metadata; checks stopped.'
                    }
                    $result.observed_bytes = [long]$lines[1]; $result.observed_sha256 = $Matches[1]
                    $result.status = if ($result.observed_bytes -eq $expectedFile.bytes -and $result.observed_sha256 -ceq $expectedFile.sha256) {
                        'exact-path-matches-original'
                    } else { 'exact-path-differs-from-original' }
                }
                $after = (& $PSCommandPath -Action AppStatus) | ConvertFrom-Json
                if (-not $after.installed -or $after.android_user_id -ne 0 -or $after.installed_apk_sha256 -cne $before.installed_apk_sha256) {
                    throw 'Foreground user or installed APK changed during saved Downloads verification.'
                }
                $report.all_exact_paths_match = @($report.files | Where-Object { $_.status -cne 'exact-path-matches-original' }).Count -eq 0
                $report.status = 'complete'
            } catch {
                $report.error = $_.Exception.Message
                throw
            } finally {
                $report.completed_at_utc = [DateTime]::UtcNow.ToString('o')
                $json = $report | ConvertTo-Json -Depth 8
                $stream = [IO.File]::Open($reportPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
                try {
                    $reportBytes = (New-Object Text.UTF8Encoding($false)).GetBytes($json)
                    $stream.Write($reportBytes,0,$reportBytes.Length)
                } finally { $stream.Dispose() }
            }
            [ordered]@{status=$report.status;files=$report.files.Count;all_exact_paths_match=$report.all_exact_paths_match;report=$reportPath} | ConvertTo-Json
        }
        'Preview' {
            Invoke-Bridge @('-d','reverse','tcp:4173','tcp:4173')
            Write-Output 'USB preview: open http://localhost:4173 on the phone. The server runs in Debian.'
        }
    }
} finally {
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name,$saved[$name],'Process') }
}
