#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/../harness-env.sh"
output="$(mktemp -d "$CARGO_TARGET_DIR/camera-set-sequence.XXXXXXXX")"
compile_harness "$output" "$KOTLIN_PRODUCTION/NativeCameraSetSequence.kt" "$HARNESS_DIR/NativeCameraSetSequenceSmoke.kt"
run_harness "$output" org.nonverba.camera.NativeCameraSetSequenceSmokeKt
