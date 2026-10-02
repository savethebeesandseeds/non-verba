# SPDX-License-Identifier: AGPL-3.0-only
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
throw 'Windows Java verification is prohibited. In the managed container run: node tools/verify-android-package.mjs --apk PATH --baseline-report PATH. See docs/development/CONTAINER_MIGRATION.md.'
