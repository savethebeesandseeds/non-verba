#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/../harness-env.sh"
[[ $# -eq 0 ]] || { printf 'Usage: bash %s\n' "$0" >&2; exit 2; }
mkdir -p "$CARGO_TARGET_DIR"
output="$(mktemp -d "$CARGO_TARGET_DIR/login-device-proof.XXXXXXXX")"
compile_harness "$output" \
    "$CODE_ROOT/android/shared/src/main/kotlin/org/nonverba/attestation/DeviceAttestationProof.kt" \
    "$CODE_ROOT/android/shared/src/main/kotlin/org/nonverba/attestation/AttestationOperations.kt" \
    "$CODE_ROOT/android/shared/src/main/kotlin/org/nonverba/attestation/AttestationDocumentAccess.kt" \
    "$CODE_ROOT/android/app/src/main/kotlin/org/nonverba/camera/DeveloperAttestationProfile.kt" \
    "$HARNESS_DIR/LoginDeviceProofSmoke.kt" \
    "$HARNESS_DIR/DeviceAttestationOperationsSmoke.kt" \
    "$HARNESS_DIR/DeveloperAttestationProfileSmoke.kt" \
    "$HARNESS_DIR/AttestationDocumentAccessSmoke.kt"
run_harness "$output" org.nonverba.participant.LoginDeviceProofSmokeKt
run_harness "$output" org.nonverba.attestation.DeviceAttestationOperationsSmokeKt
run_harness "$output" org.nonverba.camera.DeveloperAttestationProfileSmokeKt
run_harness "$output" org.nonverba.attestation.AttestationDocumentAccessSmokeKt
