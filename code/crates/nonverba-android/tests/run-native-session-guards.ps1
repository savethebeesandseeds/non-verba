# SPDX-License-Identifier: AGPL-3.0-only
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
throw 'Windows Java/Kotlin execution is prohibited. In the managed container run: bash crates/nonverba-android/tests/run-native-session-guards.sh. See docs/development/CONTAINER_MIGRATION.md.'
