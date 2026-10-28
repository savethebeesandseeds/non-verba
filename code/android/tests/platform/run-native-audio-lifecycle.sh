#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
source "$(dirname -- "$0")/../harness-env.sh"
[[ $# -eq 0 ]] || { printf 'Usage: bash %s\n' "$0" >&2; exit 2; }
mkdir -p "$CARGO_TARGET_DIR"
output="$(mktemp -d "$CARGO_TARGET_DIR/native-audio-lifecycle.XXXXXXXX")"
compile_harness "$output" \
    "$CODE_ROOT/android/shared/src/main/kotlin/org/nonverba/camera/NativeSessionGuards.kt" \
    "$KOTLIN_PRODUCTION/NativeAudioLifecycle.kt" \
    "$HARNESS_DIR/NativeAudioLifecycleSmoke.kt"
run_harness "$output" org.nonverba.camera.NativeAudioLifecycleSmokeKt
