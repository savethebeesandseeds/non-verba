# SPDX-License-Identifier: AGPL-3.0-only
<#
Deployment template only: copy verified bytes to the recorded
private-source/code/dev.ps1 path. Project development remains in public source.
This bridge can inspect or start the exact preserved container; it never creates
containers/images/volumes, rebuilds, changes mounts/ports, or runs project tasks.
#>
[CmdletBinding()]
param(
    [ValidateSet('Up','Status')]
    [string]$Action = 'Status'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-PrivateBridgeSnapshot($State, $Expected) {
    if ($State -isnot [pscustomobject]) { throw 'Missing or invalid preserved-container status; no creation or fallback is permitted.' }
    foreach ($name in @('Name','Id','ImageId','BoundWorkspace','SnapshotSource')) {
        if (-not $State.PSObject.Properties[$name] -or $State.$name -isnot [string]) {
            throw "Missing or invalid status field $name; no creation or fallback is permitted."
        }
    }
    if (-not $State.PSObject.Properties['Running'] -or $State.Running -isnot [bool] -or
        $State.Name -cne $Expected.Name -or $State.Id -cne $Expected.Id -or $State.ImageId -cne $Expected.ImageId -or
        -not [IO.Path]::GetFullPath($State.BoundWorkspace).Equals($Expected.BoundWorkspace,[StringComparison]::OrdinalIgnoreCase) -or
        -not [IO.Path]::GetFullPath($State.SnapshotSource).Equals($Expected.SnapshotSource,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'Preserved-container identity, source, bind or state mismatch; no creation or fallback is permitted.'
    }
}

function Invoke-ValidatedPrivateContainer([string]$RequestedAction, [scriptblock]$Inspect, [scriptblock]$Start, $Expected) {
    if ($RequestedAction -notin @('Up','Status')) { throw 'This private bridge supports only Up and Status.' }
    $state = & $Inspect
    Assert-PrivateBridgeSnapshot $state $Expected
    if ($RequestedAction -eq 'Up' -and -not $state.Running) {
        # The immutable ID comes only from the just-validated status. If it has
        # disappeared, start fails; no name lookup or recreation follows.
        & $Start $state.Id | Out-Null
        $state = & $Inspect
        Assert-PrivateBridgeSnapshot $state $Expected
        if (-not $state.Running) { throw 'The preserved container did not start. State was preserved; no replacement was created.' }
    }
    return $state
}

function Assert-PrivateBridgePath([string]$Path, [bool]$RegularFile) {
    $absolute = [IO.Path]::GetFullPath($Path)
    $cursor = $absolute
    while ($cursor) {
        $item = Get-Item -LiteralPath $cursor -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse point in bridge path: $cursor" }
        if ($cursor -ceq $absolute -and $RegularFile -and $item.PSIsContainer) { throw "Expected regular bridge file: $absolute" }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
    return $absolute
}

if ($env:OS -cne 'Windows_NT' -or $PSVersionTable.PSVersion.Major -lt 7) { throw 'The preserved local bridge requires the existing Windows PowerShell 7 environment.' }
$recordedWorkspace = 'C:\Work\Non-verba\private-source'
$recordedEntry = Join-Path $recordedWorkspace 'code/dev.ps1'
$actualEntry = [IO.Path]::GetFullPath($PSCommandPath)
if (-not $actualEntry.Equals([IO.Path]::GetFullPath($recordedEntry),[StringComparison]::OrdinalIgnoreCase)) {
    throw 'This is a deployment template. It can run only as C:\Work\Non-verba\private-source\code\dev.ps1; no Docker operation was attempted.'
}
$null = Assert-PrivateBridgePath $actualEntry $true
$publicWorkspace = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetDirectoryName($recordedWorkspace)) 'open-source'))
$publicLauncher = Assert-PrivateBridgePath (Join-Path $publicWorkspace 'code/dev.ps1') $true
$expected = [pscustomobject]@{
    Name = 'non-verba-dev'
    Id = 'fcb9461f2ccc1d76871ee40713fcc93752b72e51a454890188cf9b1f052d7d4e'
    ImageId = 'sha256:2fb1e6b1c3250aae15625a15c4496326bceb8487b26ac9f66cd94f7c2462bc1e'
    BoundWorkspace = [IO.Path]::GetFullPath($recordedWorkspace)
    SnapshotSource = $publicWorkspace
}
$powerShell = (Get-Command pwsh.exe -CommandType Application -ErrorAction Stop).Source
$inspect = {
    # Use a separate existing PowerShell process so the public launcher's exit
    # behavior cannot bypass this bridge's validation or post-start readback.
    $output = @(& $powerShell -NoProfile -NonInteractive -File $publicLauncher -Snapshot -Action Status)
    if ($LASTEXITCODE -ne 0) { throw 'Public snapshot validation refused the preserved environment. No creation or fallback was attempted.' }
    try { return (($output -join [Environment]::NewLine) | ConvertFrom-Json -ErrorAction Stop) }
    catch { throw 'Public snapshot status was not valid JSON. Operation stopped without creation or fallback.' }
}
$start = {
    param([string]$Id)
    $docker = (Get-Command docker.exe -CommandType Application -ErrorAction Stop).Source
    & $docker container start $Id
    if ($LASTEXITCODE -ne 0) { throw 'Starting the exact preserved container failed. No fallback or replacement was attempted.' }
}
$state = Invoke-ValidatedPrivateContainer $Action $inspect $start $expected
$state | ConvertTo-Json -Depth 4
