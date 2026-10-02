#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/harness-env.sh"
[[ $# -eq 0 ]] || { printf 'Usage: bash %s\n' "$0" >&2; exit 2; }
mkdir -p "$CARGO_TARGET_DIR"
output="$(mktemp -d "$CARGO_TARGET_DIR/native-camera-pairing.XXXXXXXX")"
android_api="$ANDROID_HOME/platforms/android-36/android.jar"
[[ -f "$android_api" ]] || { printf 'Configured Android API jar missing.\n' >&2; exit 1; }
# Production uses only the Android JavascriptInterface annotation here; file IO
# and guard tests execute in the existing Debian JVM with retained temp fixtures.
"$JAVA_HOME/bin/java" -Djava.awt.headless=true -cp "$KOTLIN_COMPILER_CP" \
    org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect \
    -classpath "$KOTLIN_STDLIB:$KOTLIN_ANNOTATIONS:$android_api" -jvm-target 17 -d "$output" \
    "$KOTLIN_PRODUCTION/NativeCameraPairing.kt" "$HARNESS_DIR/NativeCameraPairingSmoke.kt"
run_harness "$output" org.nonverba.camera.NativeCameraPairingSmokeKt "$output/fixtures"
