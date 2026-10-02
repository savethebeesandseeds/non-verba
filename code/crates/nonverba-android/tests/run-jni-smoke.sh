#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/harness-env.sh"

skip_build=false
case "${1:-}" in
    '') ;;
    --skip-build) skip_build=true; shift ;;
    *) printf 'Usage: bash %s [--skip-build]\n' "$0" >&2; exit 2 ;;
esac
[[ $# -eq 0 ]] || { printf 'Unexpected arguments.\n' >&2; exit 2; }
if [[ "$skip_build" == false ]]; then
    cargo build --locked -p nonverba-android
fi
[[ -f "$CARGO_TARGET_DIR/debug/libnonverba_android.so" ]] || {
    printf 'Missing Linux JNI library. Run this harness without --skip-build.\n' >&2
    exit 1
}
mkdir -p "$CARGO_TARGET_DIR"
output="$(mktemp -d "$CARGO_TARGET_DIR/jni-smoke.XXXXXXXX")"
compile_harness "$output" \
    "$KOTLIN_PRODUCTION/NativeLocationCore.kt" \
    "$KOTLIN_PRODUCTION/NativeCameraCore.kt" \
    "$KOTLIN_PRODUCTION/NativeAudioCore.kt" \
    "$HARNESS_DIR/JniSmoke.kt" "$HARNESS_DIR/CameraJniSmoke.kt" "$HARNESS_DIR/AudioJniSmoke.kt"
run_harness "$output" org.nonverba.camera.JniSmokeKt \
    "$CODE_ROOT/crates/nonverba-core/src/location_proof/raw_gnss_fixture.json" \
    "$CODE_ROOT/artifacts/qa"
