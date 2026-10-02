#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/harness-env.sh"
out="$1"
cargo build --locked --offline -p nonverba-android
classes="$(mktemp -d "$CARGO_TARGET_DIR/gps-attempt-jni.XXXXXXXX")"
compile_harness "$classes" "$KOTLIN_PRODUCTION/NativeLocationCore.kt" "$HARNESS_DIR/GpsAttemptJniSmoke.kt"
run_harness "$classes" org.nonverba.camera.GpsAttemptJniSmokeKt "$out/snapshot.json" "$out"
