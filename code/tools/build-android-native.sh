#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
code_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$code_root"
source container/env.sh
grep -qx 'Pkg.Revision = 30.0.16248370' "$ANDROID_NDK_HOME/source.properties"
clang=$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin
abis=("${@:-}")
if [[ $# == 0 ]]; then abis=(arm64-v8a x86_64); fi
for abi in "${abis[@]}"; do
  case "$abi" in
    arm64-v8a) triple=aarch64-linux-android ;;
    x86_64) triple=x86_64-linux-android ;;
    *) echo "Unsupported ABI: $abi" >&2; exit 2 ;;
  esac
  key=${triple//-/_}
  env "CARGO_TARGET_${key^^}_LINKER=$clang/${triple}26-clang" \
    "CARGO_TARGET_${key^^}_RUSTFLAGS=-C link-arg=-Wl,-z,max-page-size=16384 -C link-arg=-Wl,-z,common-page-size=16384" \
    "CC_$key=$clang/${triple}26-clang" "AR_$key=$clang/llvm-ar" \
    cargo build --locked --release --target "$triple" -p nonverba-android
  mkdir -p "android/app/src/main/jniLibs/$abi"
  cp "$CARGO_TARGET_DIR/$triple/release/libnonverba_android.so" "android/app/src/main/jniLibs/$abi/"
done
