#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Source only inside the managed Linux development container.
if [[ $(uname -s) != Linux || ${NONVERBA_CONTAINER:-} != 1 || ( ! -f /.dockerenv && ${NONVERBA_IMAGE_BUILD:-0} != 1 ) ]]; then
  echo 'Use code/dev.ps1. Project toolchains may only run in the managed Linux container or its dependency-image build.' >&2
  return 1 2>/dev/null || exit 1
fi
export NONVERBA_TOOLS=/opt/nonverba-tools
export JAVA_HOME=$NONVERBA_TOOLS/jdk
export ANDROID_HOME=$NONVERBA_TOOLS/android-sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME
export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/30.0.16248370
export RUSTUP_HOME=$NONVERBA_TOOLS/rustup
export CARGO_HOME=$NONVERBA_TOOLS/cargo
export CARGO_TARGET_DIR=/opt/nonverba-build/target
export GRADLE_USER_HOME=/opt/nonverba-build/gradle-home
export CMAKE_HOME=$NONVERBA_TOOLS/cmake
export CUDA_HOME=/usr/local/cuda-13.1
export CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-2}
export PATH=$JAVA_HOME/bin:$NONVERBA_TOOLS/node/bin:$NONVERBA_TOOLS/gradle/gradle-8.14.3/bin:$CMAKE_HOME/bin:$CARGO_HOME/bin:$NONVERBA_TOOLS/wasm-bindgen:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/23.0/bin:$PATH
if [[ ${NONVERBA_GPU:-none} == cuda ]]; then
  export PATH=$CUDA_HOME/bin:$PATH
fi
