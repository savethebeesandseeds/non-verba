# SPDX-License-Identifier: AGPL-3.0-only
[CmdletBinding()]
param(
    [ValidateSet('Setup','Test','Acquire','Analyze','Complete','Verify','Serve')]
    [string]$Action = 'Test',
    [ValidatePattern('^[a-z0-9][a-z0-9_-]{0,63}$')]
    [string]$RunName = 'mcc-pilot-v01',
    [ValidateRange(1,300)]
    [int]$Count = 100,
    [string]$ReviewPath,
    [switch]$Replay,
    [string]$PlaywrightPath = '/opt/nonverba-tools/browser-tests/node_modules/playwright',
    [string]$BrowserExecutable
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-ContainerPath([string]$Value, [string]$Name) {
    if ([string]::IsNullOrWhiteSpace($Value) -or
        $Value -cnotmatch '^/[A-Za-z0-9/_.-]+$' -or
        @($Value.Split('/') | Where-Object { $_ -in @('.','..') }).Count -ne 0) {
        throw "$Name must be a literal absolute Linux path without traversal or shell characters."
    }
}

if ($Replay -and $Action -ne 'Verify') { throw '-Replay applies only to Verify.' }
if ($ReviewPath -and $Action -ne 'Complete') { throw '-ReviewPath applies only to Complete.' }
if ($Action -eq 'Complete') { Assert-ContainerPath $ReviewPath 'ReviewPath' }
if ($Action -eq 'Test') {
    Assert-ContainerPath $PlaywrightPath 'PlaywrightPath'
    if ($BrowserExecutable) { Assert-ContainerPath $BrowserExecutable 'BrowserExecutable' }
} elseif ($BrowserExecutable -or $PSBoundParameters.ContainsKey('PlaywrightPath')) {
    throw 'Browser runtime arguments apply only to Test.'
}

$codeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$launcher = Join-Path $codeRoot 'dev.ps1'
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
    throw 'The authoritative public code/dev.ps1 launcher is missing.'
}
$prototypePath = 'disputes/prototypes/priors-derivation'
$runDirectory = "/opt/nonverba-build/priors-derivation/$RunName"

if ($Action -eq 'Setup') {
    $containerCommand = @('bash', "$prototypePath/setup.sh")
} else {
    # Fixed shell text only. User values are positional arguments passed to exec;
    # no interpolated command string, eval, lifecycle operation or host toolchain.
    $dispatch = @'
set -euo pipefail
prototype_path=disputes/prototypes/priors-derivation
dependency_path=/opt/nonverba-tools/priors-derivation-0.1/node_modules
if [[ ! -d "$dependency_path" ]]; then
  echo 'Prototype dependencies are unavailable. Run Invoke-Prototype.ps1 -Action Setup in the existing managed container.' >&2
  exit 2
fi
if [[ ! -e "$prototype_path/node_modules" && ! -L "$prototype_path/node_modules" ]]; then
  ln -s "$dependency_path" "$prototype_path/node_modules"
fi
if [[ $(readlink -f "$prototype_path/node_modules") != "$dependency_path" ]]; then
  echo 'Unexpected prototype dependency link; preserved without changes.' >&2
  exit 2
fi
exec "$@"
'@
    switch ($Action) {
        'Test' {
            $prototypeCommand = @(
                'env',
                "NONVERBA_PLAYWRIGHT_PATH=$PlaywrightPath",
                'PLAYWRIGHT_BROWSERS_PATH=/opt/nonverba-tools/browser-tests/browsers'
            )
            if ($BrowserExecutable) { $prototypeCommand += "NONVERBA_BROWSER_EXECUTABLE=$BrowserExecutable" }
            $prototypeCommand += @('npm','--prefix',$prototypePath,'test')
        }
        'Acquire' {
            $prototypeCommand = @('node',"$prototypePath/cli.mjs",'acquire',"--run-dir=$runDirectory","--count=$Count")
        }
        'Analyze' {
            $prototypeCommand = @('node',"$prototypePath/cli.mjs",'analyze',"--run-dir=$runDirectory")
        }
        'Complete' {
            $prototypeCommand = @('node',"$prototypePath/cli.mjs",'complete',"--run-dir=$runDirectory","--review=$ReviewPath")
        }
        'Verify' {
            $prototypeCommand = @('node',"$prototypePath/cli.mjs",'verify',"--run-dir=$runDirectory")
            if ($Replay) { $prototypeCommand += '--replay=true' }
        }
        'Serve' {
            $prototypeCommand = @('node',"$prototypePath/serve.mjs","--run=$runDirectory",'--host=0.0.0.0','--port=4173')
        }
    }
    $containerCommand = @('bash','-c',$dispatch,'nonverba-priors-prototype') + $prototypeCommand
}

Write-Host "Priors Derivation Lab 0.1 — PROTOTYPE / RESEARCH ONLY — $Action"
if ($Action -notin @('Setup','Test')) { Write-Host "Retained container run: $runDirectory" }
& $launcher -Snapshot -Action Exec -Command $containerCommand
if ($LASTEXITCODE -ne 0) { throw "Prototype $Action failed ($LASTEXITCODE). Inspect retained failures in Debian." }
