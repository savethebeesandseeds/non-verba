#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
usage() {
    printf 'Usage: bash %s OUT_DIRECTORY\n' "$0" >&2
    printf 'Requires an existing synthetic GPS attempt Snapshot at OUT_DIRECTORY/snapshot.json. See this directory\x27s README.md.\n' >&2
}
[[ $# -eq 1 && -n $1 ]] || { usage; exit 2; }
out="$1"
[[ -d "$out" && -f "$out/snapshot.json" && ! -L "$out/snapshot.json" ]] || {
    usage
    printf 'Missing regular synthetic snapshot input; no fixture was generated and no build was run.\n' >&2
    exit 2
}
out="$(cd -- "$out" && pwd -P)"
source "$(dirname -- "${BASH_SOURCE[0]}")/../../../android/tests/harness-env.sh"
cargo build --locked --offline -p nonverba-android
classes="$(mktemp -d "$CARGO_TARGET_DIR/gps-attempt-jni.XXXXXXXX")"
compile_harness "$classes" "$KOTLIN_PRODUCTION/NativeLocationCore.kt" "$HARNESS_DIR/GpsAttemptJniSmoke.kt"
run_harness "$classes" org.nonverba.camera.GpsAttemptJniSmokeKt "$out/snapshot.json" "$out"
