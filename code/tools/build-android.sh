#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
code_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$code_root"
source container/env.sh
build_root=/opt/nonverba-build/android
mkdir -p "$build_root"
# A dedicated container build tree avoids reusing Windows CMake/Gradle caches.
# The source tree and its existing outputs are never deleted or reinitialized.
rsync -a --delete --exclude='.toolchain/' --exclude='.gradle/' --exclude='.kotlin/' \
  --exclude='build/' --exclude='.cxx/' --exclude='local.properties' android/ "$build_root/"
printf 'sdk.dir=%s\ncmake.dir=%s\n' "$ANDROID_HOME" "$CMAKE_HOME" > "$build_root/local.properties"
# Preserve the existing development signer rather than silently replacing it.
mapfile -t keys < <(find "$code_root/android/.toolchain/android-user" -name debug.keystore -type f 2>/dev/null || true)
if [[ ! -f /root/.android/debug.keystore ]]; then
  if [[ ${#keys[@]} != 1 ]]; then
    echo 'Expected one existing debug keystore. Resolve the signer before building; no new identity was generated.' >&2
    exit 1
  fi
  mkdir -p /root/.android
  cp "${keys[0]}" /root/.android/debug.keystore
  chmod 600 /root/.android/debug.keystore
elif [[ ${#keys[@]} == 1 ]]; then
  cmp "${keys[0]}" /root/.android/debug.keystore
fi
gradle -p "$build_root" --no-daemon --max-workers=2 :app:assembleDebug :app:lintDebug
output="$code_root/artifacts/container-builds/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$output"
cp "$build_root/app/build/outputs/apk/debug/app-debug.apk" "$output/nonverba-debug.apk"
cp "$build_root/app/build/reports/lint-results-debug.html" "$output/"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs "$output/nonverba-debug.apk" > "$output/apk-signature.txt"
sha256sum "$output/nonverba-debug.apk" > "$output/SHA256SUMS.txt"
printf 'Linux build: %s\n' "$output"
