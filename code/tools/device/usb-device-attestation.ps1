# SPDX-License-Identifier: AGPL-3.0-only
# Public developer-tool exports only. Importing this file runs no device command.
function Get-DeviceAttestationExportSpec([string]$Name) {
    $uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
    if ($Name -cnotmatch ('\Anonverba-device-attestation-(request|proof)-' + $uuid + '\.json\z')) { throw 'Unexpected device attestation export filename.' }
    $kind = $Matches[1]
    return [pscustomobject]@{name=$Name;kind=$kind;maximum=$(if ($kind -ceq 'request') {4096} else {192 * 1024})}
}
function Assert-DeviceAttestationExportInventory([string[]]$Paths) {
    if ($Paths.Count -lt 1 -or $Paths.Count -gt 8 -or @($Paths | Select-Object -Unique).Count -ne $Paths.Count) { throw 'Device attestation retrieval accepts one to eight distinct public files.' }
    $uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
    foreach ($path in $Paths) {
        if ($path -cnotmatch ('\Acache/exports/' + $uuid + '/([^/]+)\z')) { throw 'Unexpected public device attestation export path.' }
        $null = Get-DeviceAttestationExportSpec $Matches[1]
    }
}
function Assert-DeviceAttestationFields($Object, [string[]]$Fields) {
    if ($Object.ValueKind -ne [Text.Json.JsonValueKind]::Object) { throw 'Expected a device attestation export object.' }
    $names = @($Object.EnumerateObject() | ForEach-Object {$_.Name})
    if ($names.Count -ne $Fields.Count) { throw 'Unexpected device attestation export fields.' }
    foreach ($field in $Fields) {
        if (@($names | Where-Object {$_ -ceq $field}).Count -ne 1) { throw 'Missing, repeated or unexpected device attestation export field.' }
    }
}
function Read-DeviceAttestationString($Value) {
    if ($Value.ValueKind -ne [Text.Json.JsonValueKind]::String) { throw 'Expected a device attestation string.' }
    return $Value.GetString()
}
function Read-DeviceAttestationBase64($Value, [int]$Maximum, [int]$Minimum = 1) {
    $text = Read-DeviceAttestationString $Value
    if ($text.Length -gt [Math]::Ceiling($Maximum / 3.0) * 4 -or $text -cnotmatch '\A[A-Za-z0-9+/]+={0,2}\z') { throw 'Invalid bounded public attestation encoding.' }
    $bytes = [Convert]::FromBase64String($text)
    if ($bytes.Length -lt $Minimum -or $bytes.Length -gt $Maximum -or [Convert]::ToBase64String($bytes) -cne $text) { throw 'Invalid canonical public attestation encoding.' }
    return ,$bytes
}
function Assert-DeviceAttestationRequest($Request) {
    Assert-DeviceAttestationFields $Request @('challenge_id','account_id','current_session_id','recovery_generation','platform','issued_at','expires_at','challenge_b64')
    $id = Read-DeviceAttestationString ($Request.GetProperty('challenge_id'))
    if ($id -cnotmatch '\A[A-Za-z0-9_-]{43}\z') { throw 'Invalid developer attestation challenge ID.' }
    $idBytes = [Convert]::FromBase64String($id.Replace('-','+').Replace('_','/') + '=')
    if ($idBytes.Length -ne 32 -or [Convert]::ToBase64String($idBytes).TrimEnd('=').Replace('+','-').Replace('/','_') -cne $id) { throw 'Noncanonical developer attestation challenge ID.' }
    if ((Read-DeviceAttestationString ($Request.GetProperty('account_id'))) -cnotmatch '\Adev-tool:attestation:[a-f0-9]{32}\z' -or
        (Read-DeviceAttestationString ($Request.GetProperty('current_session_id'))) -cne ('dev-tool-session:' + $id) -or
        (Read-DeviceAttestationString ($Request.GetProperty('platform'))) -cne 'android' -or $Request.GetProperty('recovery_generation').GetRawText() -cne '0') { throw 'Request is outside the fixed developer attestation profile.' }
    $issued = $Request.GetProperty('issued_at').GetRawText(); $expires = $Request.GetProperty('expires_at').GetRawText()
    if ($issued -cnotmatch '\A[1-9][0-9]{0,15}\z' -or $expires -cnotmatch '\A[1-9][0-9]{0,15}\z' -or
        [long]$issued -gt 9007199254740991 -or [long]$expires -gt 9007199254740991 -or [long]$expires - [long]$issued -ne 120) { throw 'Invalid developer attestation request window.' }
    $null = Read-DeviceAttestationBase64 ($Request.GetProperty('challenge_b64')) 32 32
}
function Assert-DeviceAttestationPublicExport([byte[]]$Bytes, [string]$Name) {
    $spec = Get-DeviceAttestationExportSpec $Name
    if ($Bytes.Length -lt 1 -or $Bytes.Length -gt $spec.maximum) { throw 'Device attestation export exceeds its byte bound.' }
    $source = [Text.UTF8Encoding]::new($false,$true).GetString($Bytes)
    $options = [Text.Json.JsonDocumentOptions]::new(); $options.MaxDepth = 16
    $document = [Text.Json.JsonDocument]::Parse($source,$options)
    try {
        $root = $document.RootElement
        if ($spec.kind -ceq 'request') { Assert-DeviceAttestationRequest $root; return }
        Assert-DeviceAttestationFields $root @('type','version','purpose','request','proof','hardware_attested')
        if ((Read-DeviceAttestationString ($root.GetProperty('type'))) -cne 'nonverba-device-attestation-proof' -or
            $root.GetProperty('version').GetRawText() -cne '1' -or (Read-DeviceAttestationString ($root.GetProperty('purpose'))) -cne 'signin-device' -or
            $root.GetProperty('hardware_attested').ValueKind -ne [Text.Json.JsonValueKind]::False) { throw 'Expected an unverified public developer attestation proof.' }
        Assert-DeviceAttestationRequest ($root.GetProperty('request'))
        $proof = $root.GetProperty('proof')
        Assert-DeviceAttestationFields $proof @('public_spki_der_b64','signature_b64','attestation_chain','platform','name')
        if ((Read-DeviceAttestationString ($proof.GetProperty('platform'))) -cne 'android') { throw 'Expected an Android developer attestation proof.' }
        $name = Read-DeviceAttestationString ($proof.GetProperty('name'))
        if ($name -cne $name.Trim() -or [Text.Encoding]::UTF8.GetByteCount($name) -lt 1 -or [Text.Encoding]::UTF8.GetByteCount($name) -gt 80 -or @($name.ToCharArray() | Where-Object {[char]::IsControl($_)}).Count -gt 0) { throw 'Invalid self-reported Android export label.' }
        $null = Read-DeviceAttestationBase64 ($proof.GetProperty('public_spki_der_b64')) 128
        $null = Read-DeviceAttestationBase64 ($proof.GetProperty('signature_b64')) 64 64
        $chain = $proof.GetProperty('attestation_chain')
        if ($chain.ValueKind -eq [Text.Json.JsonValueKind]::Null) { return }
        Assert-DeviceAttestationFields $chain @('version','certificates_der_b64')
        $certificates = $chain.GetProperty('certificates_der_b64')
        if ($chain.GetProperty('version').GetRawText() -cne '1' -or $certificates.ValueKind -ne [Text.Json.JsonValueKind]::Array -or $certificates.GetArrayLength() -lt 2 -or $certificates.GetArrayLength() -gt 8) { throw 'Invalid bounded attestation chain shape.' }
        $total = 0; $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($certificate in $certificates.EnumerateArray()) {
            $der = Read-DeviceAttestationBase64 $certificate (32 * 1024)
            $total += $der.Length
            if ($total -gt 96 * 1024 -or -not $seen.Add($certificate.GetString())) { throw 'Oversized or repeated public attestation certificate.' }
        }
        # These are encoding/schema checks only; the independent verifier must
        # parse DER, verify signatures/key binding and apply selected trust/policy.
    } finally { $document.Dispose() }
}
function Invoke-DeviceAttestationExport([string]$CodeRoot, [scriptblock]$Bridge, [scriptblock]$AppStatus, [scriptblock]$OwnFocus) {
    $before = & $AppStatus
    if ($before.package -cne 'org.nonverba.camera' -or $before.installed -cne $true -or $before.android_user_id -ne 0 -or $before.installed_apk_sha256 -cnotmatch '\A[a-f0-9]{64}\z') { throw 'Attestation retrieval requires the installed developer app and Android user 0.' }
    $focus = & $OwnFocus
    $rootGuard = 'test -d cache/exports && test ! -L cache && test ! -L cache/exports'
    $paths = @()
    foreach ($kind in @('request','proof')) {
        $glob = 'nonverba-device-attestation-' + $kind + '-????????-????-????-????-????????????.json'
        $command = "$rootGuard && find cache/exports -mindepth 2 -maxdepth 2 -type f -name $($glob.Replace('?', '\?')) | head -n 9"
        $paths += @((& $Bridge @('-d','shell','run-as','org.nonverba.camera','sh','-c',("'" + $command + "'"))) | ForEach-Object {$_.Trim()} | Where-Object {$_})
    }
    Assert-DeviceAttestationExportInventory $paths
    $acceptanceRoot = [IO.Path]::GetFullPath((Join-Path $CodeRoot 'artifacts/device-acceptance'))
    $ancestor = [IO.DirectoryInfo]$acceptanceRoot
    while ($null -ne $ancestor) {
        $item = Get-Item -LiteralPath $ancestor.FullName
        if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked attestation output ancestors are refused.' }
        $ancestor = $ancestor.Parent
    }
    $output = Join-Path $acceptanceRoot ('device-attestation-exports-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ') + '-' + [Guid]::NewGuid().ToString('N'))
    if (Test-Path -LiteralPath $output) { throw 'Attestation retrieval output already exists.' }
    $null = [IO.Directory]::CreateDirectory($output)
    if (((Get-Item -LiteralPath $output).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked attestation output is refused.' }
    $record = [ordered]@{type='nonverba-public-device-attestation-retrieval';version=1;status='incomplete';started_at_utc=[DateTime]::UtcNow.ToString('o');
        usb_transport=$true;android_user_id=0;package='org.nonverba.camera';installed_apk_sha256=$before.installed_apk_sha256;files=@();attestation_verified=$false;hardware_attested=$false;
        independent_requester_freshness_witness=$false;scope='Explicitly saved public developer-tool exports; exact bytes and closed schema only. No cryptographic, hardware, current-state or independent freshness verdict.'}
    $manifest = Join-Path $output 'retrieval.json'
    try {
        foreach ($path in ($paths | Sort-Object)) {
            $segments = $path.Split('/'); $folder = 'cache/exports/' + $segments[2]; $name = $segments[3]
            $spec = Get-DeviceAttestationExportSpec $name
            $status = & $AppStatus
            if ($status.package -cne 'org.nonverba.camera' -or $status.installed -cne $true -or $status.android_user_id -ne 0 -or $status.installed_apk_sha256 -cne $before.installed_apk_sha256 -or (& $OwnFocus) -cne $focus) { throw 'Developer app, Android user or own focus changed before retrieval.' }
            $guard = "$rootGuard && test -d $folder && test ! -L $folder && test -f $path && test ! -L $path"
            $command = "$guard && stat -c %s $path && head -c $($spec.maximum + 1) $path | sha256sum"
            $metadata = @((& $Bridge @('-d','shell','run-as','org.nonverba.camera','sh','-c',("'" + $command + "'"))) | ForEach-Object {$_.Trim()} | Where-Object {$_})
            if ($metadata.Count -ne 2 -or $metadata[0] -cnotmatch '\A[1-9][0-9]{0,6}\z' -or [long]$metadata[0] -gt $spec.maximum -or $metadata[1] -cnotmatch '\A([a-f0-9]{64})  -\z') { throw 'Invalid bounded public attestation metadata.' }
            $expectedHash = $Matches[1]; $expectedLength = [long]$metadata[0]
            $command = "$guard && head -c $($spec.maximum + 1) $path | base64"
            $encoded = (& $Bridge @('-d','shell','run-as','org.nonverba.camera','sh','-c',("'" + $command + "'"))) -join ''
            if ($encoded.Length -gt [Math]::Ceiling(($spec.maximum + 1) / 3.0) * 4 -or $encoded -cnotmatch '\A[A-Za-z0-9+/]+={0,2}\z') { throw 'Invalid bounded attestation transport.' }
            $bytes = [Convert]::FromBase64String($encoded)
            if ($bytes.Length -ne $expectedLength -or $bytes.Length -gt $spec.maximum -or [Convert]::ToBase64String($bytes) -cne $encoded) { throw 'Public attestation bytes changed length or encoding.' }
            # Host-observed complete byte arrival, before subsequent hash/schema
            # and app checks. Publish it only with a successfully retained file.
            $receivedAt = [DateTime]::UtcNow.ToString('o')
            $actualHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
            $command = "$guard && stat -c %s $path && head -c $($spec.maximum + 1) $path | sha256sum"
            $afterMetadata = @((& $Bridge @('-d','shell','run-as','org.nonverba.camera','sh','-c',("'" + $command + "'"))) | ForEach-Object {$_.Trim()} | Where-Object {$_})
            if ($afterMetadata.Count -ne 2 -or $afterMetadata[0] -cne $metadata[0] -or $afterMetadata[1] -cne $metadata[1] -or $actualHash -cne $expectedHash) { throw 'Public attestation bytes changed during retrieval.' }
            Assert-DeviceAttestationPublicExport $bytes $name
            $status = & $AppStatus
            if ($status.package -cne 'org.nonverba.camera' -or $status.installed -cne $true -or $status.android_user_id -ne 0 -or $status.installed_apk_sha256 -cne $before.installed_apk_sha256 -or (& $OwnFocus) -cne $focus) { throw 'Developer app, Android user or own focus changed; bytes were not stored.' }
            $localName = $segments[2] + '-' + $name; $destination = Join-Path $output $localName
            $stream = [IO.File]::Open($destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
            try {$stream.Write($bytes,0,$bytes.Length)} finally {$stream.Dispose()}
            $record.files += [ordered]@{source=$path;file=$localName;kind=$spec.kind;bytes=$bytes.Length;sha256=$actualHash;received_at_utc=$receivedAt;retrieved_at_utc=[DateTime]::UtcNow.ToString('o');purpose='signin-device'}
        }
        $record.status = 'complete'
    } catch { $record.error = 'Public device attestation retrieval failed; retained files are incomplete.'; throw }
    finally {
        $record.completed_at_utc = [DateTime]::UtcNow.ToString('o')
        $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($record | ConvertTo-Json -Depth 8))
        $stream = [IO.File]::Open($manifest,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try {$stream.Write($bytes,0,$bytes.Length)} finally {$stream.Dispose()}
    }
    [ordered]@{status=$record.status;files=$record.files.Count;manifest=$manifest;attestation_verified=$false;hardware_attested=$false} | ConvertTo-Json
}
