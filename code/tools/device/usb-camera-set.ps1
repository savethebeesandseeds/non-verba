# SPDX-License-Identifier: AGPL-3.0-only
# Public export shape only. This is neither C2PA nor camera-set verification.
function Assert-CameraSetPublicExport([byte[]]$Bytes, [string]$Name) {
    $isRequest = $Name -ceq 'camera-set-request.json'
    if (-not $isRequest -and $Name -cnotmatch '\Acamera-set-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.json\z') { throw 'Unexpected camera-set export filename.' }
    $attempt = if ($isRequest) { $null } else { $Matches[1] }
    $maximum = if ($isRequest) { 32 * 1024 } else { 32 * 1024 * 1024 }
    if ($Bytes.Length -lt 1 -or $Bytes.Length -gt $maximum) { throw 'Camera-set export exceeds its bound.' }
    $record = (New-Object Text.UTF8Encoding($false,$true)).GetString($Bytes) | ConvertFrom-Json -Depth 32
    $allowed = if ($isRequest) { @('version','type','challenge','profile','acquisition') } else { @('version','type','request','attempt_id','images') }
    $expected = if ($isRequest) { 'nonverba-camera-set-request' } else { 'nonverba-camera-set-bundle' }
    if ($record -isnot [pscustomobject] -or $record.version -ne 1 -or $record.type -cne $expected -or
        @($record.PSObject.Properties.Name).Count -ne $allowed.Count -or
        @($record.PSObject.Properties.Name | Where-Object { $_ -cnotin $allowed }).Count) { throw 'Unexpected public camera-set envelope.' }
    $request = if ($isRequest) { $record } else { $record.request }
    if ($request.type -cne 'nonverba-camera-set-request' -or $request.version -ne 1 -or
        $request.challenge.id -cnotmatch '\A[a-f0-9]{64}\z' -or $request.acquisition -cnotin @('native-camera2','browser') -or
        $request.profile.version -ne 1 -or $request.profile.cameras.Count -lt 1 -or $request.profile.cameras.Count -gt 16) { throw 'Unexpected bounded camera-set request.' }
    if (-not $isRequest) {
        if ($record.attempt_id -cne $attempt -or $record.images -isnot [array] -or $record.images.Count -lt 1 -or $record.images.Count -gt 16) { throw 'Unexpected camera-set bundle membership.' }
        foreach ($image in $record.images) {
            if ($image -isnot [pscustomobject] -or @($image.PSObject.Properties.Name).Count -ne 2 -or
                @($image.PSObject.Properties.Name | Where-Object { $_ -cnotin @('camera_id','jpeg_b64') }).Count -or
                $image.camera_id -isnot [string] -or $image.camera_id.Length -notin 1..128 -or
                $image.jpeg_b64 -isnot [string] -or $image.jpeg_b64 -cnotmatch '\A[A-Za-z0-9+/]+={0,2}\z') { throw 'Unexpected public camera-set image.' }
        }
    }
    return $record
}
