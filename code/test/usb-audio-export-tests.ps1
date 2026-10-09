# SPDX-License-Identifier: AGPL-3.0-only
# Synthetic transport checks only. Run with existing PowerShell 7 inside the
# managed Debian container if available. Never install a runtime or run on the
# host as a workaround. No device commands, files, recordings or verification.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($PSVersionTable.PSVersion.Major -lt 7 -or $env:OS -eq 'Windows_NT') {
    throw 'Run these checks with existing PowerShell 7 in the managed Linux container.'
}
. (Join-Path $PSScriptRoot '../tools/usb-audio-export.ps1')
function Assert-Check([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Assert-Rejected([scriptblock]$Operation) {
    $rejected = $false
    try { & $Operation | Out-Null } catch { $rejected = $true }
    Assert-Check $rejected 'Expected a bounded local audio demo transport refusal.'
}
function ConvertTo-TestBytes($Value) { return [Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Depth 10 -Compress)) }
function New-TestReceipt {
    # Deliberately incomplete protocol: this transport is not the verifier.
    return [ordered]@{version=1;type='nonverba-audio-demo-receipt';request=[ordered]@{
        version=1;demo=$true;session_id=('a' * 64)};transcript=[ordered]@{}}
}
function New-TestWav([int]$Length) {
    $bytes = New-Object byte[] $Length
    [Text.Encoding]::ASCII.GetBytes('RIFF').CopyTo($bytes,0)
    [BitConverter]::GetBytes([UInt32]($Length - 8)).CopyTo($bytes,4)
    [Text.Encoding]::ASCII.GetBytes('WAVE').CopyTo($bytes,8)
    # Deliberately no PCM, signature or challenge: transport is not verification.
    return ,$bytes
}
$cases = 0
$receiptName = 'nonverba-demo-receipt-aaaaaaaaaaaa.json'
$wavName = 'nonverba-demo-audio-aaaaaaaaaaaa.wav'
$spec = Get-AudioExportSpec $wavName
Assert-Check ($spec.kind -ceq 'wav' -and $spec.purpose -ceq 'audio-demo' -and $spec.maximum -eq 8388608 -and $spec.session_prefix -ceq ('a' * 12)) 'Incorrect demo WAV classification.'
$spec = Get-AudioExportSpec $receiptName
Assert-Check ($spec.kind -ceq 'receipt' -and $spec.maximum -eq 65536) 'Incorrect demo receipt classification.'
$cases++
foreach ($badName in @('nonverba-audio-aaaaaaaaaaaa.wav','nonverba-audio-receipt-aaaaaaaaaaaa.json',
    'nonverba-audio-diagnostics-aaaaaaaaaaaa.json','nonverba-location-aaaaaaaaaaaa.json',
    'nonverba-demo-audio-AAAAAAAAAAAA.wav','nonverba-demo-receipt-aaaaaaaaaaaaa.json',
    'nonverba-demo-audio-aaaaaaaaaaaa.wav.extra', ('../' + $receiptName), ($receiptName + "`n"))) {
    Assert-Rejected { Get-AudioExportSpec $badName }; $cases++
}
$paths = @(1..16 | ForEach-Object { 'cache/exports/11111111-1111-4111-8111-' + ('{0:x12}' -f $_) + '/' + $wavName })
Assert-AudioExportInventory $paths; $cases++
Assert-Rejected { Assert-AudioExportInventory @() }; $cases++
Assert-Rejected { Assert-AudioExportInventory ($paths + ('cache/exports/11111111-1111-4111-8111-000000000017/' + $wavName)) }; $cases++
Assert-Rejected { Assert-AudioExportInventory @($paths[0],$paths[0]) }; $cases++
foreach ($path in @(('../' + $paths[0]), ($paths[0] + "`n"), $paths[0].Replace('cache/exports/','files/private/'),
    $paths[0].Replace('/nonverba-demo-audio-', '/../nonverba-demo-audio-'),
    $paths[0].Replace('nonverba-demo-audio-','nonverba-audio-'))) {
    Assert-Rejected { Assert-AudioExportInventory @($path) }; $cases++
}
$valid = New-TestReceipt
$bytes = ConvertTo-TestBytes $valid
$decoded = Assert-AudioPublicExport $bytes $receiptName
Assert-Check ($decoded.type -ceq 'nonverba-audio-demo-receipt' -and $decoded.request.demo -ceq $true) 'Transport lost the local demo marker.'
$cases++
foreach ($type in @('nonverba-audio-receipt','nonverba-audio-session','nonverba-gps-attempt-report')) {
    $bad = New-TestReceipt; $bad.type = $type
    Assert-Rejected { Assert-AudioPublicExport (ConvertTo-TestBytes $bad) $receiptName }; $cases++
}
foreach ($marker in @($false,'true',1,$null)) {
    $bad = New-TestReceipt; $bad.request.demo = $marker
    Assert-Rejected { Assert-AudioPublicExport (ConvertTo-TestBytes $bad) $receiptName }; $cases++
}
$bad = New-TestReceipt; $bad.request.Remove('demo')
Assert-Rejected { Assert-AudioPublicExport (ConvertTo-TestBytes $bad) $receiptName }; $cases++
$bad = New-TestReceipt; $bad['verified'] = $true
Assert-Rejected { Assert-AudioPublicExport (ConvertTo-TestBytes $bad) $receiptName }; $cases++
$bad = New-TestReceipt; $bad.transcript = @()
Assert-Rejected { Assert-AudioPublicExport (ConvertTo-TestBytes $bad) $receiptName }; $cases++
$source = [Text.Encoding]::UTF8.GetString($bytes)
foreach ($malformed in @($source.Replace('"version":1','"version":1,"version":1'),
    $source.Replace('"demo":true','"demo":true,"demo":true'), $source + '{}', '/* comment */' + $source,
    $source.Replace('"version":1','"version":1.0'))) {
    Assert-Rejected { Assert-AudioPublicExport ([Text.Encoding]::UTF8.GetBytes($malformed)) $receiptName }; $cases++
}
foreach ($digest in @(('A' * 64),('a' * 63),('g' * 64),$null)) {
    $bad = New-TestReceipt; $bad.request.session_id = $digest
    Assert-Rejected { Assert-AudioPublicExport (ConvertTo-TestBytes $bad) $receiptName }; $cases++
}
Assert-Rejected { Assert-AudioPublicExport $bytes 'nonverba-demo-receipt-bbbbbbbbbbbb.json' }; $cases++
Assert-Rejected { Assert-AudioPublicExport ([byte[]]@(0xc3,0x28)) $receiptName }; $cases++
Assert-Rejected { Assert-AudioPublicExport ([byte[]]@()) $receiptName }; $cases++
$atLimit = [Text.Encoding]::UTF8.GetBytes($source + (' ' * (65536 - $bytes.Length)))
$null = Assert-AudioPublicExport $atLimit $receiptName; $cases++
Assert-Rejected { Assert-AudioPublicExport ($atLimit + [byte]0x20) $receiptName }; $cases++
$wav = New-TestWav 12
$null = Assert-AudioPublicExport $wav $wavName; $cases++
foreach ($offset in @(0,8,4)) {
    $badWav = [byte[]]$wav.Clone(); $badWav[$offset] = 0
    Assert-Rejected { Assert-AudioPublicExport $badWav $wavName }; $cases++
}
Assert-Rejected { Assert-AudioPublicExport $bytes $wavName }; $cases++
Assert-Rejected { Assert-AudioPublicExport $wav $receiptName }; $cases++
Assert-Rejected { Assert-AudioPublicExport ([byte[]]@(0)) $wavName }; $cases++
$null = Assert-AudioPublicExport (New-TestWav 8388608) $wavName; $cases++
Assert-Rejected { Assert-AudioPublicExport (New-TestWav 8388609) $wavName }; $cases++
[pscustomobject]@{passed=$true;cases=$cases;scope='Synthetic demo filename/path/byte/JSON bounds only; nested protocol intentionally not validated';
    phone_operations=$false;acoustic_verification=$false;signature_verified=$false;
    independently_trusted_signer=$false;successful_measurement_acceptance=$false} | ConvertTo-Json
