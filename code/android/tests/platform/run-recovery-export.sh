#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/../harness-env.sh"
[[ $# -eq 0 ]] || { printf 'Usage: bash %s\n' "$0" >&2; exit 2; }
mkdir -p "$CARGO_TARGET_DIR"
output="$(mktemp -d "$CARGO_TARGET_DIR/recovery-export.XXXXXXXX")"
compile_harness "$output" \
    "$CODE_ROOT/android/participant/src/main/kotlin/org/nonverba/participant/RecoveryExportSession.kt" \
    "$HARNESS_DIR/RecoveryExportSmoke.kt"
run_harness "$output" org.nonverba.participant.RecoveryExportSmokeKt
