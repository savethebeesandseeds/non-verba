#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/harness-env.sh"
[[ $# -eq 0 ]] || { printf 'Usage: bash %s\n' "$0" >&2; exit 2; }
mkdir -p "$CARGO_TARGET_DIR"
output="$(mktemp -d "$CARGO_TARGET_DIR/native-screen-awake.XXXXXXXX")"
# The sole Android reference in this helper is the real JavascriptInterface annotation.
android_api="$ANDROID_HOME/platforms/android-36/android.jar"
[[ -f "$android_api" ]] || { printf 'Configured Android API jar missing.\n' >&2; exit 1; }
"$JAVA_HOME/bin/java" -Djava.awt.headless=true -cp "$KOTLIN_COMPILER_CP" \
    org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect \
    -classpath "$KOTLIN_STDLIB:$KOTLIN_ANNOTATIONS:$android_api" -jvm-target 17 -d "$output" \
    "$KOTLIN_PRODUCTION/NativeScreenAwake.kt" "$HARNESS_DIR/NativeScreenAwakeSmoke.kt"
run_harness "$output" org.nonverba.camera.NativeScreenAwakeSmokeKt
