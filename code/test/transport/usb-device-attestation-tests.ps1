# SPDX-License-Identifier: AGPL-3.0-only
# Pure synthetic USB transport/schema checks. Runs no ADB, Java or build tool.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Existing PowerShell 7 is required.' }
. (Join-Path $PSScriptRoot '../../tools/device/usb-device-attestation.ps1')
function Assert-Test([bool]$Value, [string]$Message) { if (-not $Value) {throw $Message} }
function Assert-Rejected([scriptblock]$Operation) {
    $rejected = $false; try {& $Operation | Out-Null} catch {$rejected = $true}
    Assert-Test $rejected 'Expected a synthetic attestation transport refusal.'
}
function Test-Bytes($Value) { return ,([Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Depth 12 -Compress))) }
function New-TestRequest {
    $id = [Convert]::ToBase64String([byte[]](1..32)).TrimEnd('=').Replace('+','-').Replace('/','_')
    return [ordered]@{challenge_id=$id;account_id=('dev-tool:attestation:' + ('a' * 32));current_session_id=('dev-tool-session:' + $id);
        recovery_generation=0;platform='android';issued_at=1792663258;expires_at=1792663378;challenge_b64=[Convert]::ToBase64String([byte[]](33..64))}
}
function New-TestProof {
    return [ordered]@{type='nonverba-device-attestation-proof';version=1;purpose='signin-device';request=(New-TestRequest);hardware_attested=$false;
        proof=[ordered]@{public_spki_der_b64='MAA=';signature_b64=[Convert]::ToBase64String([byte[]]::new(64));attestation_chain=$null;platform='android';name='Synthetic Android'}}
}
$cases = 0
$uuid = '11111111-1111-4111-8111-111111111111'
$requestName = 'nonverba-device-attestation-request-' + $uuid + '.json'
$proofName = 'nonverba-device-attestation-proof-' + $uuid + '.json'
$requestBytes = Test-Bytes (New-TestRequest)
$null = Assert-DeviceAttestationPublicExport $requestBytes $requestName; $cases++
$null = Assert-DeviceAttestationPublicExport (Test-Bytes (New-TestProof)) $proofName; $cases++
foreach ($name in @(('../' + $requestName), ($requestName + "`n"), 'nonverba-device-attestation-proof-SECRET.json', 'nonverba-key-enrollment-response.json')) {
    Assert-Rejected {Get-DeviceAttestationExportSpec $name}; $cases++
}
$paths = @(1..8 | ForEach-Object {'cache/exports/' + ('{0:x8}' -f $_) + '-1111-4111-8111-111111111111/' + $requestName})
Assert-DeviceAttestationExportInventory $paths; $cases++
foreach ($inventory in @(@(), @($paths[0],$paths[0]), ($paths + $paths[0]), @($paths[0].Replace('cache/exports','files/no_backup')), @($paths[0] + "`n"))) {
    Assert-Rejected {Assert-DeviceAttestationExportInventory $inventory}; $cases++
}
foreach ($change in @(
    @{account_id='real-account'}, @{platform='browser'}, @{recovery_generation=1}, @{expires_at=1792663379},
    @{current_session_id='wrong'}, @{challenge_id=('A' * 42)}, @{challenge_b64='AQ=='}, @{issued_at=1792663258.5})) {
    $value = New-TestRequest; foreach ($key in $change.Keys) {$value[$key]=$change[$key]}
    Assert-Rejected {Assert-DeviceAttestationPublicExport (Test-Bytes $value) $requestName}; $cases++
}
$source = [Text.Encoding]::UTF8.GetString($requestBytes)
foreach ($malformed in @(($source.Replace('"platform":"android"','"platform":"android","platform":"android"')), ($source + '{}'), ('/*comment*/' + $source), ($source.Replace('"recovery_generation":0','"recovery_generation":0.0')))) {
    Assert-Rejected {Assert-DeviceAttestationPublicExport ([Text.Encoding]::UTF8.GetBytes($malformed)) $requestName}; $cases++
}
$padded = $requestBytes + [Text.Encoding]::ASCII.GetBytes(' ' * (4096 - $requestBytes.Length))
$null = Assert-DeviceAttestationPublicExport $padded $requestName; $cases++
Assert-Rejected {Assert-DeviceAttestationPublicExport ($padded + [byte]32) $requestName}; $cases++
foreach ($change in @(@{hardware_attested=$true}, @{version=1.0}, @{purpose='work-key'}, @{extra='secret'})) {
    $value=New-TestProof; foreach ($key in $change.Keys) {$value[$key]=$change[$key]}
    Assert-Rejected {Assert-DeviceAttestationPublicExport (Test-Bytes $value) $proofName}; $cases++
}
foreach ($change in @(@{signature_b64='AA=='}, @{public_spki_der_b64=[Convert]::ToBase64String([byte[]]::new(129))}, @{name=('Synthetic' + [char]0x85)}, @{extra='synthetic'})) {
    $value=New-TestProof; foreach ($key in $change.Keys) {$value.proof[$key]=$change[$key]}
    Assert-Rejected {Assert-DeviceAttestationPublicExport (Test-Bytes $value) $proofName}; $cases++
}
foreach ($chain in @(
    @{version=1;certificates_der_b64=@('MAA=','MAEA')},
    @{version=1;certificates_der_b64=@('MAA=','MAEA') + @(1..6 | ForEach-Object {[Convert]::ToBase64String([byte[]]@(48,1,$_))})})) {
    $value=New-TestProof; $value.proof.attestation_chain=$chain
    $null=Assert-DeviceAttestationPublicExport (Test-Bytes $value) $proofName; $cases++
}
foreach ($certificates in @(@('MAA='), @('MAA=','MAA='), @('MA','MAEA'), (@('MAA=','MAEA') + @('MAEA') * 7),
    @([Convert]::ToBase64String([byte[]]::new(32769)),'MAEA'), @(1..4 | ForEach-Object {[Convert]::ToBase64String([byte[]](@($_) * 32768))}))) {
    $value=New-TestProof; $value.proof.attestation_chain=@{version=1;certificates_der_b64=$certificates}
    Assert-Rejected {Assert-DeviceAttestationPublicExport (Test-Bytes $value) $proofName}; $cases++
}
# Fake bridge exercises real transfer guards and retained byte checks without USB.
$fixtureRoot=Join-Path ([IO.Path]::GetTempPath()) ('nonverba-attestation-transport-' + [Guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory((Join-Path $fixtureRoot 'artifacts/device-acceptance'))
$remote='cache/exports/' + $uuid + '/' + $requestName
$hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($requestBytes)).ToLowerInvariant()
$state=@{hashReads=0;statusReads=0;focusReads=0;mode='valid';finalStatusAt=$null;commands=[Collections.Generic.List[string]]::new()}
$bridge={param($Arguments)
    Assert-Test (($Arguments[0..3] -join ' ') -ceq '-d shell run-as org.nonverba.camera') 'USB/package guard changed.'
    $command=$Arguments[-1]; $state.commands.Add($command)
    Assert-Test (-not $command.Contains('no_backup') -and -not $command.Contains('keystore')) 'Private app storage was accessed.'
    if ($command.Contains('find ')) {if ($command.Contains('-request-')) {return $remote}; return}
    if ($command.Contains('sha256sum')) {
        $state.hashReads++; [string]$requestBytes.Length
        if ($state.mode -ceq 'changed-hash' -and $state.hashReads -gt 1) {('b' * 64) + '  -'} else {$hash + '  -'}
        return
    }
    if ($command.Contains('| base64')) {return [Convert]::ToBase64String($requestBytes)}
    throw 'Unexpected synthetic bridge command.'
}
$status={
    $state.statusReads++; $observed=if ($state.mode -ceq 'changed-apk' -and $state.statusReads -gt 2) {'b' * 64} else {'a' * 64}
    if ($state.statusReads -eq 3) {$state.finalStatusAt=[DateTimeOffset]::UtcNow; Start-Sleep -Milliseconds 25}
    $observedUser=if ($state.mode -ceq 'changed-user' -and $state.statusReads -gt 2) {1} else {0}
    return [pscustomobject]@{package='org.nonverba.camera';installed=$true;android_user_id=$observedUser;installed_apk_sha256=$observed}
}
$focus={ $state.focusReads++; if ($state.mode -ceq 'changed-focus' -and $state.focusReads -gt 2) {return 'changed'}; return 'own-focus' }
$result=Invoke-DeviceAttestationExport $fixtureRoot $bridge $status $focus | ConvertFrom-Json
Assert-Test ($result.status -ceq 'complete' -and $result.files -eq 1 -and $result.hardware_attested -ceq $false) 'Synthetic retrieval did not complete honestly.'
$manifest=Get-Content -LiteralPath $result.manifest -Raw | ConvertFrom-Json
Assert-Test ((Get-FileHash -LiteralPath (Join-Path ([IO.Path]::GetDirectoryName($result.manifest)) $manifest.files[0].file)).Hash.ToLowerInvariant() -ceq $hash) 'Retrieval changed original bytes.'
$received=[DateTimeOffset]$manifest.files[0].received_at_utc
$retrieved=[DateTimeOffset]$manifest.files[0].retrieved_at_utc
Assert-Test ($received -le $state.finalStatusAt -and $retrieved -gt $state.finalStatusAt -and $received -lt $retrieved) 'Complete byte arrival must precede later app checks and retained-file time.'
$cases++
foreach ($mode in @('changed-hash','changed-apk','changed-focus','changed-user')) {
    $state.mode=$mode; $state.hashReads=0; $state.statusReads=0; $state.focusReads=0
    Assert-Rejected {Invoke-DeviceAttestationExport $fixtureRoot $bridge $status $focus}; $cases++
}
[ordered]@{passed=$true;cases=$cases;phone_operations=$false;cryptographic_verification=$false;fixture_root=$fixtureRoot} | ConvertTo-Json
