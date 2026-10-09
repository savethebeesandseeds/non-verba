#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/harness-env.sh"
[[ $# -eq 0 ]] || { printf 'Usage: bash %s\n' "$0" >&2; exit 2; }
mkdir -p "$CARGO_TARGET_DIR"
output="$(mktemp -d "$CARGO_TARGET_DIR/native-lifecycle-cleanup.XXXXXXXX")"
compile_harness "$output" \
    "$KOTLIN_PRODUCTION/NativeLifecycleCleanup.kt" \
    "$KOTLIN_PRODUCTION/NativeGnssStatusDiagnostics.kt" \
    "$KOTLIN_PRODUCTION/NativeGnssStatusRegistration.kt" \
    "$HARNESS_DIR/NativeLifecycleCleanupSmoke.kt"
run_harness "$output" org.nonverba.camera.NativeLifecycleCleanupSmokeKt
