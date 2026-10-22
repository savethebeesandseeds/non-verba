# SPDX-License-Identifier: AGPL-3.0-only
# Pure bounds/shape checks for explicitly saved local audio demo artifacts.
# Importing runs no device command. Transport checks confer no verification,
# successful-measurement acceptance, or independently trusted signing identity.
function Get-AudioExportSpec([string]$Name) {
    if ($Name -cmatch '\Anonverba-demo-audio-([a-f0-9]{12})\.wav\z') {
        return [pscustomobject]@{name=$Name;kind='wav';purpose='audio-demo';maximum=(8 * 1024 * 1024);session_prefix=$Matches[1]}
    }
    if ($Name -cmatch '\Anonverba-demo-receipt-([a-f0-9]{12})\.json\z') {
        return [pscustomobject]@{name=$Name;kind='receipt';purpose='audio-demo';maximum=(64 * 1024);session_prefix=$Matches[1]}
    }
    throw 'Unexpected local audio demo export filename.'
}
function Assert-AudioExportInventory([string[]]$Paths) {
    if ($Paths.Count -lt 1 -or $Paths.Count -gt 16 -or
        @($Paths | Select-Object -Unique).Count -ne $Paths.Count) {
        throw 'Unexpected or excessive public audio demo export inventory.'
    }
    $uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
    foreach ($entry in $Paths) {
        if ($entry -cnotmatch ('\Acache/exports/' + $uuid + '/(nonverba-demo-(?:audio-[a-f0-9]{12}\.wav|receipt-[a-f0-9]{12}\.json))\z')) {
            throw 'Unexpected public audio demo export path.'
        }
        $null = Get-AudioExportSpec $Matches[1]
    }
}
function Assert-AudioExportFields($Object, [string[]]$Fields) {
    if ($Object.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) { throw 'Expected an audio demo export object.' }
    $names = @($Object.EnumerateObject() | ForEach-Object { $_.Name })
    if ($names.Count -ne $Fields.Count) { throw 'Unexpected audio demo export fields.' }
    foreach ($field in $Fields) {
        if (@($names | Where-Object { $_ -ceq $field }).Count -ne 1) { throw 'Missing, repeated or unexpected audio demo export field.' }
    }
}
function Assert-AudioPublicExport([byte[]]$Bytes, [string]$Name) {
    $spec = Get-AudioExportSpec $Name
    if ($Bytes.Length -lt 1 -or $Bytes.Length -gt $spec.maximum) { throw 'Audio demo export exceeds its byte bound.' }
    if ($spec.kind -ceq 'wav') {
        # RIFF framing only. Rust must parse the signed WAV, recompute PCM and
        # acoustic checks, and verify its signer against a separate trusted pin.
        if ($Bytes.Length -lt 12 -or [Text.Encoding]::ASCII.GetString($Bytes,0,4) -cne 'RIFF' -or
            [Text.Encoding]::ASCII.GetString($Bytes,8,4) -cne 'WAVE') { throw 'Expected a bounded RIFF/WAVE audio demo export.' }
        $declared = [UInt64]$Bytes[4] + ([UInt64]$Bytes[5] * 256) + ([UInt64]$Bytes[6] * 65536) + ([UInt64]$Bytes[7] * 16777216)
        if ($declared + 8 -ne $Bytes.Length) { throw 'Audio demo RIFF size differs from its exact exported bytes.' }
        return
    }
    $source = (New-Object Text.UTF8Encoding($false,$true)).GetString($Bytes)
    $options = New-Object System.Text.Json.JsonDocumentOptions
    $options.MaxDepth = 16
    $document = [System.Text.Json.JsonDocument]::Parse($source,$options)
    try {
        $root = $document.RootElement
        Assert-AudioExportFields $root @('version','type','request','transcript')
        if ($root.GetProperty('version').GetRawText() -cne '1' -or
            $root.GetProperty('type').ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $root.GetProperty('type').GetString() -cne 'nonverba-audio-demo-receipt') { throw 'Expected a v1 local audio demo receipt.' }
        $request = $root.GetProperty('request')
        if ($request.ValueKind -ne [System.Text.Json.JsonValueKind]::Object -or
            $root.GetProperty('transcript').ValueKind -ne [System.Text.Json.JsonValueKind]::Object) { throw 'Expected audio demo request and transcript objects.' }
        # Reject repeated request names before locating the minimal demo/session
        # marker. Nested schema and protocol validation belong to Rust/import.
        $requestNames = @($request.EnumerateObject() | ForEach-Object { $_.Name })
        if (@($requestNames | Select-Object -Unique).Count -ne $requestNames.Count) { throw 'Repeated audio demo request field.' }
        if ($request.GetProperty('version').GetRawText() -cne '1' -or
            $request.GetProperty('demo').ValueKind -ne [System.Text.Json.JsonValueKind]::True) { throw 'Audio demo export must preserve its explicit local demo marker.' }
        $session = $request.GetProperty('session_id')
        if ($session.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $session.GetString() -cnotmatch '\A[a-f0-9]{64}\z' -or
            $session.GetString().Substring(0,12) -cne $spec.session_prefix) { throw 'Audio demo session differs from its receipt filename.' }
        # Shape checks deliberately grant no protocol, timing, acoustic,
        # signature or acceptance verdict. Keep original bytes for Rust.
        return ($source | ConvertFrom-Json)
    } finally { $document.Dispose() }
}
