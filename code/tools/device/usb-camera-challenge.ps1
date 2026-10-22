# SPDX-License-Identifier: AGPL-3.0-only
# Narrow public-request transport helpers. No device commands run on import.
# This is host OS/USB integration, not an alternative build/runtime toolchain.
function Get-CameraChallengeSha256([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function ConvertFrom-BoundedCameraChallenge([byte[]]$Bytes) {
    if ($Bytes.Length -lt 1 -or $Bytes.Length -gt 8192) { throw 'Camera challenge must be 1..8192 bytes.' }
    $source = (New-Object Text.UTF8Encoding($false,$true)).GetString($Bytes)
    # Deliberately narrower than the product format: this USB test transport
    # accepts ASCII labels without JSON escapes or shell metacharacters. In
    # particular %, apostrophe and literal backslash are rejected in the source.
    if ($source -cnotmatch '\A[\t\r\n A-Za-z0-9._{}":,\-]+\z') { throw 'Camera challenge contains unsupported transport characters.' }
    $fields = @('version','id','requester','task','nonce','issued_at','expires_at')
    $properties = @([regex]::Matches($source,'"([^"\r\n]+)"\s*:') | ForEach-Object { $_.Groups[1].Value })
    if ($properties.Count -ne $fields.Count) { throw 'Camera challenge must have seven unique fields.' }
    foreach ($field in $fields) {
        if (@($properties | Where-Object { $_ -ceq $field }).Count -ne 1) { throw 'Camera challenge has missing, repeated or unknown fields.' }
    }
    $value = $source | ConvertFrom-Json
    if ($value -isnot [pscustomobject] -or @($value.PSObject.Properties).Count -ne 7 -or
        ($value.version -isnot [long] -and $value.version -isnot [int]) -or $value.version -ne 1) { throw 'Expected a bare version-1 camera challenge.' }
    if ($value.id -isnot [string] -or $value.id -cnotmatch '\A[a-f0-9]{64}\z' -or
        $value.nonce -isnot [string] -or $value.nonce -cnotmatch '\A[A-Za-z0-9_-]{43}\z' -or
        $value.requester -isnot [string] -or $value.requester -cnotmatch '\A[A-Za-z0-9][A-Za-z0-9 ._-]{0,199}\z' -or
        $value.task -isnot [string] -or $value.task -cnotmatch '\A[A-Za-z0-9][A-Za-z0-9 ._-]{0,1999}\z') { throw 'Camera challenge identifiers or ASCII labels are invalid.' }
    $nonce = [Convert]::FromBase64String($value.nonce.Replace('-','+').Replace('_','/') + '=')
    if ($nonce.Length -ne 32 -or [Convert]::ToBase64String($nonce).TrimEnd('=').Replace('+','-').Replace('/','_') -cne $value.nonce -or
        ([BitConverter]::ToString($nonce)).Replace('-','').ToLowerInvariant() -cne $value.id) { throw 'Camera nonce must be canonical and match its ID.' }
    foreach ($field in @('issued_at','expires_at')) {
        if (($value.$field -isnot [long] -and $value.$field -isnot [int]) -or $value.$field -lt 0 -or $value.$field -gt 9007199254740991) {
            throw 'Camera timestamps must be nonnegative safe integer Unix seconds.'
        }
        if (-not [regex]::IsMatch($source,('"' + $field + '"\s*:\s*(?:0|[1-9][0-9]*)\s*(?:,|\})'))) { throw 'Noncanonical integer timestamp token.' }
    }
    $lifetime = $value.expires_at - $value.issued_at
    if ($lifetime -lt 1 -or $lifetime -gt 86400) { throw 'Camera challenge lifetime must be 1 second to 24 hours.' }
    $canonical = [ordered]@{version=1;id=$value.id;requester=$value.requester;task=$value.task;nonce=$value.nonce;
        issued_at=$value.issued_at;expires_at=$value.expires_at} | ConvertTo-Json -Compress
    return [pscustomobject]@{value=$value;canonical=$canonical;original_sha256=(Get-CameraChallengeSha256 $Bytes);
        canonical_sha256=(Get-CameraChallengeSha256 ([Text.Encoding]::UTF8.GetBytes($canonical)));original_bytes=$Bytes.Length}
}
function Read-BoundedCameraChallenge([string]$Path, [string]$Root) {
    $absolute = [IO.Path]::GetFullPath($Path)
    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\','/')
    if (-not $absolute.StartsWith($rootPath + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'Camera challenge must be inside artifacts/device-acceptance.'
    }
    $relative = $absolute.Substring($rootPath.Length + 1)
    if ([IO.Path]::GetExtension($absolute) -cne '.json' -or @($relative.Split([IO.Path]::DirectorySeparatorChar) |
        Where-Object { $_ -cnotmatch '\A[A-Za-z0-9][A-Za-z0-9._-]{0,119}\z' }).Count) { throw 'Unexpected camera challenge path.' }
    # Reject every reparse component, including ancestor junctions. Keep a read
    # lock while loading; do not follow another name through a replaced file.
    $cursor = $absolute
    while ($cursor) {
        $item = Get-Item -LiteralPath $cursor -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Camera challenge path contains a reparse point.' }
        if ($cursor -ceq $absolute -and ($item.PSIsContainer -or $item.Length -lt 1 -or $item.Length -gt 8192)) { throw 'Invalid bounded regular challenge file.' }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
    $stream = [IO.File]::Open($absolute,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try {
        if ($stream.Length -lt 1 -or $stream.Length -gt 8192) { throw 'Camera challenge changed size before reading.' }
        $bytes = New-Object byte[] ([int]$stream.Length)
        $used = 0
        while ($used -lt $bytes.Length) {
            $count = $stream.Read($bytes,$used,$bytes.Length-$used)
            if ($count -le 0) { throw 'Incomplete camera challenge file.' }
            $used += $count
        }
        if ($stream.ReadByte() -ne -1) { throw 'Camera challenge changed while reading.' }
        $request = ConvertFrom-BoundedCameraChallenge $bytes
        $request | Add-Member NoteProperty path $absolute
        return $request
    } finally { $stream.Dispose() }
}
function Get-CameraChallengeField($State, [bool]$RequireFocused = $false) {
    if (@($State.nodes | Where-Object { $_.class -ceq 'android.webkit.WebView' -and $_.enabled }).Count -ne 1 -or
        @($State.nodes | Where-Object { $_.'resource-id' -cmatch '\Aaudio-' }).Count) { throw 'Camera insertion requires exactly one own camera WebView.' }
    $matches = @($State.nodes | Where-Object { $_.'resource-id' -ceq 'operator-challenge' })
    if ($matches.Count -ne 1) { throw 'Exactly one operator-challenge field is required.' }
    $node = $matches[0]
    if (-not $node.editable -or -not $node.enabled -or -not $node.clickable -or $node.password -or
        ($RequireFocused -and -not $node.focused) -or $node.'text-length' -gt 16384 -or -not $node.'text-sha256') {
        throw 'Camera challenge field must be enabled, editable, bounded, and focused for text input.'
    }
    return $node
}
function ConvertTo-CameraChallengeWire([string]$Canonical) {
    $checked = ConvertFrom-BoundedCameraChallenge ([Text.Encoding]::UTF8.GetBytes($Canonical))
    if ($checked.canonical -cne $Canonical) { throw 'Camera insertion requires canonical challenge JSON.' }
    # Android input passes through a keyboard that autocorrects JSON field names
    # such as id. Escape each key using standard JSON Unicode syntax, keeping
    # already-validated ASCII values compact to bound synthetic key injection.
    # Escaped input is derived here only; the source-file allowlist stays strict.
    function ConvertTo-CameraWireString([string]$Value) {
        return '"' + (($Value.ToCharArray() | ForEach-Object { '\u{0:x4}' -f [int]$_ }) -join '') + '"'
    }
    $pairs = foreach ($field in @('version','id','requester','task','nonce','issued_at','expires_at')) {
        $encodedKey = ConvertTo-CameraWireString $field
        $value = $checked.value.$field
        $encodedValue = if ($value -is [string]) { '"' + $value + '"' }
            else { $value.ToString([Globalization.CultureInfo]::InvariantCulture) }
        $encodedKey + ':' + $encodedValue
    }
    $wire = '{' + ($pairs -join ',') + '}'
    if ($wire.Length -gt 16384 -or $wire -cnotmatch '\A[{}":,0-9A-Za-z ._\\-]+\z') { throw 'Unexpected bounded camera wire encoding.' }
    $decodedCanonical = ($wire | ConvertFrom-Json) | ConvertTo-Json -Compress
    if ($decodedCanonical -cne $Canonical) { throw 'Camera wire JSON does not preserve the original challenge semantics.' }
    return [pscustomobject]@{text=$wire;sha256=(Get-CameraChallengeSha256 ([Text.Encoding]::UTF8.GetBytes($wire)));
        decoded_canonical_sha256=(Get-CameraChallengeSha256 ([Text.Encoding]::UTF8.GetBytes($decodedCanonical)))}
}
function Invoke-CameraChallengeText([string]$Canonical) {
    # Never accept arbitrary escaped JSON at this boundary. Reparse the original
    # strict canonical format and derive the deterministic wire representation.
    $wire = ConvertTo-CameraChallengeWire $Canonical
    if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'AppCameraChallenge requires PowerShell 7 for exact native ArgumentList handling.' }
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $adb; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    # ArgumentList performs Windows argv escaping; ADB then joins these into
    # Android's shell command. Single quotes protect JSON quotes and backslashes.
    # No nested sh -c, cmd.exe, clipboard or generic shell parameter is exposed.
    # Conservative upper bound includes Windows escaping and executable path;
    # spaces become Android's %s tokens; the argument has no trailing backslash.
    $transportText = $wire.text.Replace(' ','%s')
    $argumentBound = $adb.Length + 128 + $transportText.Length * 2
    if ($argumentBound -ge 32767) { throw 'Camera wire exceeds the Windows command-line bound.' }
    foreach ($argument in @('-H','127.0.0.1','-P','5038','-d','shell','input','text',("'" + $transportText + "'"))) {
        $start.ArgumentList.Add($argument)
    }
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    try {
        if (-not $process.Start()) { throw 'Could not start the bounded USB text transfer.' }
        $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(60000)) {
            $process.Kill()
            throw 'USB text transfer timed out. Observe the field before retrying; completion is unproven.'
        }
        $output = $stdout.GetAwaiter().GetResult(); $errors = $stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0 -or $output.Length -gt 0 -or $errors.Length -gt 0) { throw 'USB camera challenge transfer failed; observe the field before retrying.' }
    } finally { $process.Dispose() }
}
