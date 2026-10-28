#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/../harness-env.sh"
[[ $# -eq 0 ]] || { printf 'Usage: bash %s\n' "$0" >&2; exit 2; }
mkdir -p "$CARGO_TARGET_DIR"
output="$(mktemp -d "$CARGO_TARGET_DIR/identity-camera.XXXXXXXX")"
shared="$CODE_ROOT/android/shared/src/main/kotlin/org/nonverba"
compile_harness "$output" "$shared/attestation/DeviceAttestationProof.kt" \
    "$shared/camera/NativeCameraLensPolicy.kt" "$shared/camera/NativeCameraWorkQueue.kt" "$shared/attestation/AttestationDocumentAccess.kt" \
    "$shared/identity/IdentityCameraDocumentAccess.kt" "$shared/identity/IdentityCaptureProtocol.kt" \
    "$shared/identity/IdentityJpegPolicy.kt" "$HARNESS_DIR/IdentityCameraSmoke.kt"
run_harness "$output" org.nonverba.identity.IdentityCameraSmokeKt "$output/identity-capture-interop.json"
