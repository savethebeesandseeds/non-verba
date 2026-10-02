# SPDX-License-Identifier: AGPL-3.0-only
param([ValidateSet('arm64-v8a','x86_64')][string[]]$Abis = @('arm64-v8a','x86_64'))
$ErrorActionPreference = 'Stop'
# Windows only orchestrates Docker; all compiler execution stays in Linux.
& (Join-Path $PSScriptRoot '../dev.ps1') -Action Native -Command $Abis
