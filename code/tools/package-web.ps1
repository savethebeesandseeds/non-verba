# SPDX-License-Identifier: AGPL-3.0-only
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
throw 'Host release packaging is disabled. In the managed container run: node tools/package-web.mjs. See docs/development/CONTAINER_MIGRATION.md for the snapshot bridge.'
