#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/harness-env.sh"
[[ $# -eq 0 ]] || { printf 'Usage: bash %s\n' "$0" >&2; exit 2; }
mkdir -p "$CARGO_TARGET_DIR"
output="$(mktemp -d "$CARGO_TARGET_DIR/native-gps-warmup.XXXXXXXX")"
# Only the JavascriptInterface annotation comes from Android; no receiver is used.
android_api="$ANDROID_HOME/platforms/android-36/android.jar"
[[ -f "$android_api" ]] || { printf 'Configured Android API jar missing.\n' >&2; exit 1; }
"$JAVA_HOME/bin/java" -Djava.awt.headless=true -cp "$KOTLIN_COMPILER_CP" \
    org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect \
    -classpath "$KOTLIN_STDLIB:$KOTLIN_ANNOTATIONS:$android_api" -jvm-target 17 -d "$output" \
    "$KOTLIN_PRODUCTION/NativeGpsWarmup.kt" "$HARNESS_DIR/NativeGpsWarmupSmoke.kt"
run_harness "$output" org.nonverba.camera.NativeGpsWarmupSmokeKt
