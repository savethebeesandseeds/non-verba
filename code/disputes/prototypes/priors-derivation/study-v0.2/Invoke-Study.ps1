# SPDX-License-Identifier: AGPL-3.0-only
[CmdletBinding()]
param(
  [ValidateSet('Init','Acquire','Extract','Audit','Prepare','Embed','Discover','Verify','Serve','Test','Comparison-Model')]
  [string]$Action='Test',
  [ValidatePattern('^[a-z0-9][a-z0-9_-]{0,63}$')][string]$RunName='20261013-study-15000',
  [ValidateRange(1,10000)][int]$Limit=1000,
  [string]$Manifest,
  [string]$Admission,
  [string]$Embeddings,
  [string]$Geometry,
  [switch]$FullDiscovery,
  [switch]$ModelSmoke
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
function Assert-RelativeManifest([string]$Value) {
  if([string]::IsNullOrWhiteSpace($Value) -or $Value -cnotmatch '^[A-Za-z0-9/_-]+[.]json$' -or $Value.StartsWith('/')) {throw 'A literal relative JSON artifact path is required.'}
}
$codeRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..'))
$launcher=Join-Path $codeRoot 'dev.ps1'
$runDirectory="/opt/nonverba-build/priors-derivation/study-v0.2/$RunName"
if($FullDiscovery -and $Action -ne 'Extract'){throw '-FullDiscovery applies only to Extract.'}
if($ModelSmoke -and $Action -ne 'Test'){throw '-ModelSmoke applies only to Test.'}
$command=$Action.ToLowerInvariant()
$arguments=@("--run-dir=$runDirectory")
if($Action -in @('Acquire','Extract')){$arguments+="--limit=$Limit"}
if($Action -eq 'Extract'){$arguments+="--calibration=$((-not $FullDiscovery).ToString().ToLowerInvariant())"}
if($Action -in @('Audit','Prepare','Embed','Discover')){Assert-RelativeManifest $Manifest;$arguments+="--manifest=$Manifest"}
if($Action -eq 'Verify'){
  if($Embeddings){Assert-RelativeManifest $Embeddings;$arguments+="--embeddings=$Embeddings"}
  if($Geometry){Assert-RelativeManifest $Geometry;$arguments+="--geometry=$Geometry"}
}
if($Action -eq 'Serve'){Assert-RelativeManifest $Admission;Assert-RelativeManifest $Geometry;$arguments+=@("--admission=$Admission","--geometry=$Geometry")}
$dispatch=@'
set -euo pipefail
prototype_path=disputes/prototypes/priors-derivation
dependency_path=/opt/nonverba-tools/priors-derivation-0.1/node_modules
if [[ ! -d "$dependency_path" ]]; then
  echo 'Pinned prototype dependencies are missing in Debian; use the existing prototype setup procedure.' >&2
  exit 2
fi
if [[ ! -e "$prototype_path/node_modules" && ! -L "$prototype_path/node_modules" ]]; then
  ln -s "$dependency_path" "$prototype_path/node_modules"
fi
if [[ $(readlink -f "$prototype_path/node_modules") != "$dependency_path" ]]; then
  echo 'Unexpected dependency link; preserved without changes.' >&2
  exit 2
fi
if [[ "$1" == 'test' ]]; then
  export NONVERBA_EMBEDDING_SMOKE="$2"
  exec node --test "$prototype_path/study-v0.2/tests/"*.test.mjs
fi
exec node "$prototype_path/study-v0.2/cli.mjs" "$@"
'@
if($Action -eq 'Test'){$arguments=@($(if($ModelSmoke){'1'}else{'0'}))}
Write-Host "Priors Derivation Lab v0.2 — PROTOTYPE / RESEARCH ONLY — $Action"
if($Action -ne 'Test'){Write-Host "Retained managed-container run: $runDirectory"}
& $launcher -Snapshot -Action Exec -Command (@('bash','-c',$dispatch,'nonverba-priors-v02',$command)+$arguments)
if($LASTEXITCODE -ne 0){throw "Study operation failed ($LASTEXITCODE); retained artifacts are preserved in Debian."}
