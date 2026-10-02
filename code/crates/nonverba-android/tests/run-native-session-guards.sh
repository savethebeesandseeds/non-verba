#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/harness-env.sh"
[[ $# -eq 0 ]] || { printf 'Usage: bash %s\n' "$0" >&2; exit 2; }
mkdir -p "$CARGO_TARGET_DIR"
output="$(mktemp -d "$CARGO_TARGET_DIR/native-session-guards.XXXXXXXX")"
compile_harness "$output" \
    "$KOTLIN_PRODUCTION/NativeSessionGuards.kt" \
    "$KOTLIN_PRODUCTION/NativeCameraLocationSelection.kt" \
    "$KOTLIN_PRODUCTION/NativeLocationDiagnostics.kt" \
    "$KOTLIN_PRODUCTION/NativeGnssStatusDiagnostics.kt" \
    "$KOTLIN_PRODUCTION/NativeEnrollmentCatalog.kt" \
    "$KOTLIN_PRODUCTION/NativeAudioRecordingGuard.kt" \
    "$KOTLIN_PRODUCTION/NativeAudioObservationFence.kt" \
    "$HARNESS_DIR/NativeSessionGuardsSmoke.kt" \
    "$HARNESS_DIR/NativeFinalizationDiagnosticsSmoke.kt" \
    "$HARNESS_DIR/NativeFinalizationPolicySmoke.kt" \
    "$HARNESS_DIR/NativeCameraLocationSelectionSmoke.kt" \
    "$HARNESS_DIR/NativeLocationDiagnosticsSmoke.kt" \
    "$HARNESS_DIR/NativeGnssStatusDiagnosticsSmoke.kt" \
    "$HARNESS_DIR/NativeEnrollmentCatalogSmoke.kt" \
    "$HARNESS_DIR/NativeAudioObservationFenceSmoke.kt" \
    "$HARNESS_DIR/NativeAudioRecordingGuardSmoke.kt"
run_harness "$output" org.nonverba.camera.NativeSessionGuardsSmokeKt
run_harness "$output" org.nonverba.camera.NativeEnrollmentCatalogSmokeKt
run_harness "$output" org.nonverba.camera.NativeAudioRecordingGuardSmokeKt
run_harness "$output" org.nonverba.camera.NativeLocationDiagnosticsSmokeKt
run_harness "$output" org.nonverba.camera.NativeAudioObservationFenceSmokeKt
run_harness "$output" org.nonverba.camera.NativeGnssStatusDiagnosticsSmokeKt
run_harness "$output" org.nonverba.camera.NativeFinalizationDiagnosticsSmokeKt
run_harness "$output" org.nonverba.camera.NativeFinalizationPolicySmokeKt
run_harness "$output" org.nonverba.camera.NativeCameraLocationSelectionSmokeKt
