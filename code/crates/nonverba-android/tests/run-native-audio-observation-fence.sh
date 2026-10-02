#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
source "$(dirname -- "$0")/harness-env.sh"
[[ $# -eq 0 ]] || { printf 'Usage: bash %s\\n' "$0" >&2; exit 2; }
mkdir -p "$CARGO_TARGET_DIR"
output="$(mktemp -d "$CARGO_TARGET_DIR/native-audio-fence.XXXXXXXX")"
compile_harness "$output" \
    "$KOTLIN_PRODUCTION/NativeAudioRecordingGuard.kt" \
    "$KOTLIN_PRODUCTION/NativeAudioObservationFence.kt" \
    "$HARNESS_DIR/NativeAudioObservationFenceSmoke.kt"
run_harness "$output" org.nonverba.camera.NativeAudioObservationFenceSmokeKt
