# SPDX-License-Identifier: AGPL-3.0-only
# Pure unsigned-transport negative cases. No USB, device commands or files read
# apart from this source module. Run only in the managed Linux development
# container if PowerShell 7 is already available; do not install a runtime.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($PSVersionTable.PSVersion.Major -lt 7 -or $env:OS -eq 'Windows_NT') {
    throw 'Run these checks with existing PowerShell 7 in the managed Linux container.'
}
. (Join-Path $PSScriptRoot '../tools/usb-camera-quality.ps1')
function Assert-Check([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Assert-Rejected([scriptblock]$Operation) {
    $rejected = $false
    try { & $Operation | Out-Null } catch { $rejected = $true }
    Assert-Check $rejected 'Expected an unsigned camera quality transport refusal.'
}
function ConvertTo-TestBytes($Value) { return [Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Depth 20 -Compress)) }
function New-TestRecord {
    # Synthetic shape only. Metrics are not trusted or recomputed by transport.
    return [ordered]@{version=1;type='nonverba-camera-quality-report';guidance_only=$true;
        satisfies_successful_measurement=$false;authenticity_proven=$false;
        image_sha256=('a' * 64);analysis_profile_sha256=('b' * 64);
        profile=[ordered]@{version=1;type='nonverba-camera-quality-profile';metric_profile='jpeg-rgb8-zune-tenengrad-v1';subject_region=$null};
        image=[ordered]@{byte_length=100;encoded_width=1;encoded_height=1;oriented_width=1;oriented_height=1;exif_orientation=1};
        rules=[ordered]@{decoder='synthetic transport test';scales=@(1,2,4)};
        regions=@([ordered]@{id='full_frame';bounds=[ordered]@{x=0;y=0;width=1;height=1};
            exposure=[ordered]@{sample_count=1;near_black_count=0;near_white_count=0;histogram=@(1);minimum=128;maximum=128;range=0};
            sharpness=@([ordered]@{scale=1;width=1;height=1;sample_count=0;gradient_squared_sum=0;nonzero_gradient_count=0;assessment='insufficient-data'})});
        guidance=@('subject-region-not-selected','full_frame:scale-1:insufficient-data')}
}
$cases = 0
$name = 'nonverba-camera-quality-aaaaaaaaaaaa.json'
$spec = Get-CameraQualityExportSpec $name
Assert-Check ($spec.kind -ceq 'quality' -and $spec.purpose -ceq 'camera-quality' -and $spec.maximum -eq 131072 -and $spec.image_prefix -ceq ('a' * 12)) 'Incorrect distinct quality export specification.'
$valid = New-TestRecord
$bytes = ConvertTo-TestBytes $valid
$decoded = Assert-CameraQualityPublicExport $bytes $name
Assert-Check ($decoded.type -ceq $valid.type -and $decoded.guidance_only -ceq $true -and $decoded.authenticity_proven -ceq $false -and $decoded.satisfies_successful_measurement -ceq $false) 'Valid unsigned shape changed its meaning.'
$cases++
foreach ($badName in @('nonverba-aaaaaaaaaaaa.jpg','nonverba-challenge-aaaaaaaaaaaa.json',
    'nonverba-location-aaaaaaaaaaaa.json','nonverba-camera-quality-AAAAAAAAAAAA.json',
    'nonverba-camera-quality-aaaaaaaaaaaaa.json','nonverba-camera-quality-aaaaaaaaaaaa.json.extra',
    '../nonverba-camera-quality-aaaaaaaaaaaa.json')) {
    Assert-Rejected { Get-CameraQualityExportSpec $badName }; $cases++
}
$paths = @(1..128 | ForEach-Object { 'cache/exports/11111111-1111-4111-8111-' + ('{0:x12}' -f $_) + '/' + $name })
Assert-CameraQualityExportInventory $paths
$cases++
Assert-Rejected { Assert-CameraQualityExportInventory @() }; $cases++
Assert-Rejected { Assert-CameraQualityExportInventory ($paths + ('cache/exports/11111111-1111-4111-8111-000000000129/' + $name)) }; $cases++
Assert-Rejected { Assert-CameraQualityExportInventory @($paths[0],$paths[0]) }; $cases++
Assert-Rejected { Assert-CameraQualityExportInventory @('cache/exports/11111111-1111-4111-8111-000000000001/nonverba-aaaaaaaaaaaa.jpg') }; $cases++
Assert-Rejected { Assert-CameraQualityExportInventory @('../cache/exports/11111111-1111-4111-8111-000000000001/' + $name) }; $cases++
foreach ($field in @('guidance_only','authenticity_proven','satisfies_successful_measurement')) {
    $bad = New-TestRecord; $bad[$field] = -not $bad[$field]
    Assert-Rejected { Assert-CameraQualityPublicExport (ConvertTo-TestBytes $bad) $name }; $cases++
    $bad = New-TestRecord; $bad[$field] = 'false'
    Assert-Rejected { Assert-CameraQualityPublicExport (ConvertTo-TestBytes $bad) $name }; $cases++
}
foreach ($badType in @('nonverba-location-proof','nonverba-key-enrollment','nonverba-camera-offer')) {
    $bad = New-TestRecord; $bad.type = $badType
    Assert-Rejected { Assert-CameraQualityPublicExport (ConvertTo-TestBytes $bad) $name }; $cases++
}
foreach ($field in @('image_sha256','analysis_profile_sha256')) {
    foreach ($badDigest in @(('A' * 64), ('a' * 63), ('g' * 64))) {
        $bad = New-TestRecord; $bad[$field] = $badDigest
        Assert-Rejected { Assert-CameraQualityPublicExport (ConvertTo-TestBytes $bad) $name }; $cases++
    }
}
Assert-Rejected { Assert-CameraQualityPublicExport $bytes 'nonverba-camera-quality-bbbbbbbbbbbb.json' }; $cases++
$bad = New-TestRecord; $bad.version = 2
Assert-Rejected { Assert-CameraQualityPublicExport (ConvertTo-TestBytes $bad) $name }; $cases++
$bad = New-TestRecord; $bad['signature_verified'] = $true
Assert-Rejected { Assert-CameraQualityPublicExport (ConvertTo-TestBytes $bad) $name }; $cases++
$bad = New-TestRecord; $bad.regions = @()
Assert-Rejected { Assert-CameraQualityPublicExport (ConvertTo-TestBytes $bad) $name }; $cases++
$bad = New-TestRecord; $bad.regions = @(1..7 | ForEach-Object { [ordered]@{id='full_frame'} })
Assert-Rejected { Assert-CameraQualityPublicExport (ConvertTo-TestBytes $bad) $name }; $cases++
$source = [Text.Encoding]::UTF8.GetString($bytes)
Assert-Rejected { Assert-CameraQualityPublicExport ([Text.Encoding]::UTF8.GetBytes($source + '{}')) $name }; $cases++
Assert-Rejected { Assert-CameraQualityPublicExport ([Text.Encoding]::UTF8.GetBytes($source.Replace('"version":1','"version":1,"version":1'))) $name }; $cases++
Assert-Rejected { Assert-CameraQualityPublicExport ([Text.Encoding]::UTF8.GetBytes('/* comment */' + $source)) $name }; $cases++
Assert-Rejected { Assert-CameraQualityPublicExport ([byte[]]@(0xc3,0x28)) $name }; $cases++
Assert-Rejected { Assert-CameraQualityPublicExport ([byte[]]@()) $name }; $cases++
$atLimit = [Text.Encoding]::UTF8.GetBytes($source + (' ' * (131072 - $bytes.Length)))
Assert-Check ($atLimit.Length -eq 131072) 'Incorrect exact-size fixture.'
$null = Assert-CameraQualityPublicExport $atLimit $name
$cases++
Assert-Rejected { Assert-CameraQualityPublicExport ($atLimit + [byte]0x20) $name }; $cases++
[pscustomobject]@{passed=$true;cases=$cases;scope='Synthetic unsigned public-export shape and filename/byte/inventory bounds only';
    phone_operations=$false;metric_verification=$false;attestation_verified=$false;successful_measurement_acceptance=$false} | ConvertTo-Json
