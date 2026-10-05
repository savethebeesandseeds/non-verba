# SPDX-License-Identifier: AGPL-3.0-only
# Pure bounds/shape checks for explicitly exported unsigned quality guidance.
# Importing runs no device command and grants no evidence-verification authority.
function Get-CameraQualityExportSpec([string]$Name) {
    if ($Name -cnotmatch '\Anonverba-camera-quality-([a-f0-9]{12})\.json\z') {
        throw 'Unexpected unsigned camera quality export filename.'
    }
    return [pscustomobject]@{name=$Name;kind='quality';purpose='camera-quality';maximum=(128 * 1024);image_prefix=$Matches[1]}
}
function Assert-CameraQualityExportInventory([string[]]$Paths) {
    if ($Paths.Count -lt 1 -or $Paths.Count -gt 128 -or
        @($Paths | Select-Object -Unique).Count -ne $Paths.Count) {
        throw 'Unexpected or excessive public camera quality export inventory.'
    }
    $uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
    foreach ($entry in $Paths) {
        if ($entry -cnotmatch ('\Acache/exports/' + $uuid + '/(nonverba-camera-quality-[a-f0-9]{12}\.json)\z')) {
            throw 'Unexpected public camera quality export path.'
        }
        $null = Get-CameraQualityExportSpec $Matches[1]
    }
}
function Assert-CameraQualityPublicExport([byte[]]$Bytes, [string]$Name) {
    $spec = Get-CameraQualityExportSpec $Name
    if ($Bytes.Length -lt 1 -or $Bytes.Length -gt $spec.maximum) {
        throw 'Camera quality JSON must be 1..131072 bytes.'
    }
    $source = (New-Object Text.UTF8Encoding($false,$true)).GetString($Bytes)
    # JsonDocument rejects trailing values/comments/commas. Enumerating the root
    # before ConvertFrom-Json also rejects repeated or unrecognized claim keys.
    $document = [System.Text.Json.JsonDocument]::Parse($source)
    try {
        $root = $document.RootElement
        if ($root.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) { throw 'Expected an unsigned camera quality report object.' }
        $fields = @('version','type','guidance_only','satisfies_successful_measurement','authenticity_proven',
            'image_sha256','analysis_profile_sha256','profile','image','rules','regions','guidance')
        $names = @($root.EnumerateObject() | ForEach-Object { $_.Name })
        if ($names.Count -ne $fields.Count) { throw 'Unexpected unsigned camera quality report fields.' }
        foreach ($field in $fields) {
            if (@($names | Where-Object { $_ -ceq $field }).Count -ne 1) { throw 'Missing, repeated or unexpected camera quality report field.' }
        }
        if ($root.GetProperty('version').GetRawText() -cne '1' -or
            $root.GetProperty('type').ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
            $root.GetProperty('type').GetString() -cne 'nonverba-camera-quality-report' -or
            $root.GetProperty('guidance_only').ValueKind -ne [System.Text.Json.JsonValueKind]::True -or
            $root.GetProperty('authenticity_proven').ValueKind -ne [System.Text.Json.JsonValueKind]::False -or
            $root.GetProperty('satisfies_successful_measurement').ValueKind -ne [System.Text.Json.JsonValueKind]::False) {
            throw 'Camera quality export must remain unsigned guidance without successful-measurement or authenticity claims.'
        }
        foreach ($field in @('image_sha256','analysis_profile_sha256')) {
            $value = $root.GetProperty($field)
            if ($value.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
                $value.GetString() -cnotmatch '\A[a-f0-9]{64}\z') { throw 'Invalid camera quality image/profile digest claim.' }
        }
        if ($root.GetProperty('image_sha256').GetString().Substring(0,12) -cne $spec.image_prefix) {
            throw 'Camera quality image digest does not match its exported filename.'
        }
        foreach ($field in @('profile','image','rules')) {
            if ($root.GetProperty($field).ValueKind -ne [System.Text.Json.JsonValueKind]::Object) { throw 'Invalid camera quality record object.' }
        }
        $regions = $root.GetProperty('regions')
        if ($regions.ValueKind -ne [System.Text.Json.JsonValueKind]::Array -or
            $regions.GetArrayLength() -lt 1 -or $regions.GetArrayLength() -gt 6) { throw 'Camera quality reports require 1..6 bounded regions.' }
        $guidance = $root.GetProperty('guidance')
        if ($guidance.ValueKind -ne [System.Text.Json.JsonValueKind]::Array -or $guidance.GetArrayLength() -gt 32) { throw 'Invalid bounded camera quality guidance list.' }
        foreach ($code in $guidance.EnumerateArray()) {
            if ($code.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or $code.GetString().Length -gt 128) {
                throw 'Invalid bounded camera quality guidance code.'
            }
        }
        # Transport shape only: recompute all metrics against independently
        # retained JPEG bytes using Rust/WASM. No signature or trust is inferred.
        return ($source | ConvertFrom-Json)
    } finally { $document.Dispose() }
}
