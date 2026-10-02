#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/harness-env.sh"
output="$(mktemp -d "$CARGO_TARGET_DIR/native-gps-attempt.XXXXXXXX")"
compile_harness "$output" "$KOTLIN_PRODUCTION/NativeGpsAttemptJournal.kt" "$HARNESS_DIR/NativeGpsAttemptJournalSmoke.kt"
run_harness "$output" org.nonverba.camera.NativeGpsAttemptJournalSmokeKt
