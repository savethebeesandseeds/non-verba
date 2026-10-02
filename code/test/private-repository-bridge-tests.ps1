# SPDX-License-Identifier: AGPL-3.0-only
# Host orchestration verification only. Extracts pure validation/orchestration
# functions from the template AST; it never executes the deployed entry point,
# invokes Docker, touches a phone, or runs a project build/toolchain.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$template = Join-Path $PSScriptRoot '../container/private-repository-bridge.ps1'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($template,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach ($name in @('Assert-PrivateBridgeSnapshot','Invoke-ValidatedPrivateContainer')) {
    $definition = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true)
    if (-not $definition) { throw "Missing bridge function: $name" }
    . ([scriptblock]::Create($definition.Extent.Text))
}
$expected = [pscustomobject]@{
    Name='non-verba-dev'; Id=('a'*64); ImageId=('sha256:'+('b'*64))
    BoundWorkspace='C:\Work\Non-verba\private-source'; SnapshotSource='C:\Work\Non-verba\open-source'
}
function New-MockState([bool]$Running=$false) {
    [pscustomobject]@{Name=$expected.Name;Id=$expected.Id;ImageId=$expected.ImageId;BoundWorkspace=$expected.BoundWorkspace;SnapshotSource=$expected.SnapshotSource;Running=$Running}
}
function Assert-Check([bool]$Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
function Assert-Rejected([scriptblock]$Operation) {
    $rejected=$false
    try { & $Operation | Out-Null } catch { $rejected=$true }
    Assert-Check $rejected 'Expected bridge refusal.'
}
$cases=0
$script:startCount=0; $script:inspectCount=0
$inspect={ $script:inspectCount++; New-MockState ($script:startCount -gt 0) }
$start={param($Id) Assert-Check ($Id -ceq $expected.Id) 'Unexpected immutable start target.'; $script:startCount++}
$result=Invoke-ValidatedPrivateContainer Status $inspect $start $expected
Assert-Check (-not $result.Running -and $script:startCount -eq 0 -and $script:inspectCount -eq 1) 'Status mutated the mock container.'
$cases++
$script:startCount=0; $script:inspectCount=0
$result=Invoke-ValidatedPrivateContainer Up $inspect $start $expected
Assert-Check ($result.Running -and $script:startCount -eq 1 -and $script:inspectCount -eq 2) 'Up did not start once and revalidate.'
$cases++
$script:startCount=0
$null=Invoke-ValidatedPrivateContainer Up {New-MockState $true} $start $expected
Assert-Check ($script:startCount -eq 0) 'Running container was started again.'
$cases++
foreach ($field in @('Name','Id','ImageId','BoundWorkspace','SnapshotSource','Running')) {
    $script:startCount=0
    $bad=New-MockState
    $bad.$field=if ($field -ceq 'Running') {'false'} elseif ($field -cin @('BoundWorkspace','SnapshotSource')) {'C:\wrong'} else {'wrong'}
    Assert-Rejected {Invoke-ValidatedPrivateContainer Up {$bad} $start $expected}
    Assert-Check ($script:startCount -eq 0) "Mismatch in $field caused a start."
    $cases++
}
$script:startCount=0
Assert-Rejected {Invoke-ValidatedPrivateContainer Up {$null} $start $expected}
Assert-Check ($script:startCount -eq 0) 'Missing container status caused a start.'
$cases++
$script:startCount=0
Assert-Rejected {Invoke-ValidatedPrivateContainer Up {throw 'Missing container'} $start $expected}
Assert-Check ($script:startCount -eq 0) 'Inspector failure caused a start.'
$cases++
$script:startCount=0
Assert-Rejected {Invoke-ValidatedPrivateContainer Build {New-MockState} $start $expected}
Assert-Check ($script:startCount -eq 0) 'Unsupported project action caused a start.'
$cases++
$script:startCount=0
Assert-Rejected {Invoke-ValidatedPrivateContainer Up {New-MockState} $start $expected}
Assert-Check ($script:startCount -eq 1) 'Failed post-start readback attempted a fallback.'
$cases++
[pscustomobject]@{passed=$true;cases=$cases;docker_operations=$false;phone_operations=$false;project_toolchains_run=$false} | ConvertTo-Json
