# SPDX-License-Identifier: AGPL-3.0-only
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
throw 'Host MSVC oracle generation is disabled. Validate the retained synthetic fixtures inside the managed container with: cargo test --locked -p nonverba-core rtklib. This does not regenerate the upstream oracle; a Linux regeneration port remains pending. See docs/development/CONTAINER_MIGRATION.md.'
