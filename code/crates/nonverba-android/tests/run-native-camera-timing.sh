#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/harness-env.sh"
[[ $# -eq 0 ]] || { printf 'Usage: bash %s\n' "$0" >&2; exit 2; }
mkdir -p "$CARGO_TARGET_DIR"
output="$(mktemp -d "$CARGO_TARGET_DIR/native-camera-timing.XXXXXXXX")"
compile_harness "$output" \
    "$KOTLIN_PRODUCTION/NativeSessionGuards.kt" \
    "$KOTLIN_PRODUCTION/NativeCameraTiming.kt" \
    "$HARNESS_DIR/NativeCameraTimingSmoke.kt"
run_harness "$output" org.nonverba.camera.NativeCameraTimingSmokeKt
