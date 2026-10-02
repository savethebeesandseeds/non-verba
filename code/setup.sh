#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Dependencies and environment only. Lifecycle/tasks live in dev.ps1 and dev.sh.
set -euo pipefail
code_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/." && pwd)
cd "$code_root"
source container/env.sh
fetch() {
  local url=$1 digest=$2 algorithm=$3 filename=$4
  local destination="${5:-$NONVERBA_TOOLS/downloads}/$filename"
  if [[ ! -f $destination ]]; then
    curl --fail --location --retry 3 --proto '=https' --proto-redir '=https' --tlsv1.2 "$url" -o "$destination.partial"
    printf '%s  %s\n' "$digest" "$destination.partial" | "${algorithm}sum" --check --status
    mv "$destination.partial" "$destination"
  fi
  printf '%s  %s\n' "$digest" "$destination" | "${algorithm}sum" --check --status
}
# Optional dependency paths exit before the default toolchain/GPU provisioning.
# Provisioning never starts a service or manages a container.
if [[ $# != 0 ]]; then
  if [[ $# == 1 && ( $1 == --help || $1 == -h ) ]]; then
    printf 'Dependencies: bash setup.sh\nBrowser tests only: bash setup.sh --browser-tests-only\nApproved model only: bash setup.sh --model-only qwen3-4b-instruct-2507-q4-k-m\n'
    exit 0
  fi
  if [[ $# == 1 && $1 == --browser-tests-only ]]; then
    exec bash container/browser-tests-setup.sh
  fi
  if [[ $# != 2 || $1 != --model-only || $2 != qwen3-4b-instruct-2507-q4-k-m ]]; then
    echo 'Unsupported setup option; use --help. No dependencies changed.' >&2
    exit 2
  fi
  qwen_revision=a06e946bb6b655725eafa393f4a9745d460374c9
  qwen_filename=Qwen3-4B-Instruct-2507-Q4_K_M.gguf
  qwen_sha256=3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597
  qwen_bytes=2497281120
  qwen_root="$NONVERBA_TOOLS/models/qwen3-4b-instruct-2507/$qwen_revision"
  command -v curl >/dev/null
  command -v sha256sum >/dev/null
  mkdir -p "$qwen_root"
  fetch "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/$qwen_revision/$qwen_filename" \
    "$qwen_sha256" sha256 "$qwen_filename" "$qwen_root"
  [[ $(stat -c '%s' "$qwen_root/$qwen_filename") == "$qwen_bytes" ]] || { echo 'Pinned model size mismatch' >&2; exit 1; }
  printf 'Approved evaluation model verified. No inference run.\nrepository=unsloth/Qwen3-4B-Instruct-2507-GGUF\nrevision=%s\npath=%s\nsha256=%s\nbytes=%s\n' \
    "$qwen_revision" "$qwen_root/$qwen_filename" "$qwen_sha256" "$qwen_bytes"
  exit 0
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
mapfile -t debian_packages < container/debian-packages.lock
apt-get install -y --no-install-recommends "${debian_packages[@]}"
mkdir -p "$NONVERBA_TOOLS/downloads" "$CARGO_TARGET_DIR" "$GRADLE_USER_HOME"
fetch 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jdk_x64_linux_hotspot_17.0.20.1_1.tar.gz' 3808d1d15e3ec6bd5b84057fb5d84c33d8a1536a258146bcea2e603fc726e08e sha256 jdk.tar.gz
if [[ ! -x $JAVA_HOME/bin/java ]]; then
  mkdir -p "$JAVA_HOME"
  tar -xzf "$NONVERBA_TOOLS/downloads/jdk.tar.gz" --strip-components=1 -C "$JAVA_HOME"
fi
fetch https://nodejs.org/dist/v22.23.3/node-v22.23.3-linux-x64.tar.xz df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de sha256 node.tar.xz
if [[ ! -x $NONVERBA_TOOLS/node/bin/node ]]; then
  mkdir -p "$NONVERBA_TOOLS/node"
  tar -xJf "$NONVERBA_TOOLS/downloads/node.tar.xz" --strip-components=1 -C "$NONVERBA_TOOLS/node"
fi
fetch https://services.gradle.org/distributions/gradle-8.14.3-bin.zip bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531 sha256 gradle.zip
if [[ ! -x $NONVERBA_TOOLS/gradle/gradle-8.14.3/bin/gradle ]]; then
  mkdir -p "$NONVERBA_TOOLS/gradle"
  unzip -q "$NONVERBA_TOOLS/downloads/gradle.zip" -d "$NONVERBA_TOOLS/gradle"
fi
fetch https://github.com/Kitware/CMake/releases/download/v4.3.3/cmake-4.3.3-linux-x86_64.tar.gz 927b2368a946c37269c3a66225ab00544e756459cdd0b5d0da438694fb9ff802 sha256 cmake.tar.gz
if [[ ! -x $CMAKE_HOME/bin/cmake ]]; then
  mkdir -p "$CMAKE_HOME"
  tar -xzf "$NONVERBA_TOOLS/downloads/cmake.tar.gz" --strip-components=1 -C "$CMAKE_HOME"
fi
fetch https://static.rust-lang.org/rustup/archive/1.28.2/x86_64-unknown-linux-gnu/rustup-init 20a06e644b0d9bd2fbdbfd52d42540bdde820ea7df86e92e533c073da0cdd43c sha256 rustup-init
if [[ ! -x $CARGO_HOME/bin/rustup ]]; then
  chmod +x "$NONVERBA_TOOLS/downloads/rustup-init"
  "$NONVERBA_TOOLS/downloads/rustup-init" -y --no-modify-path --profile minimal --default-toolchain 1.96.0
fi
rustup set auto-self-update disable
rustup toolchain install 1.96.0 --profile minimal --component rustfmt,clippy
rustup target add --toolchain 1.96.0 wasm32-unknown-unknown aarch64-linux-android x86_64-linux-android
fetch https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.122/wasm-bindgen-0.2.122-x86_64-unknown-linux-musl.tar.gz 122a3fe2ea9c6e3e89b50e42dd1a346e499f3f65a54aae0b4eaeb658139d1e0e sha256 wasm-bindgen.tar.gz
if [[ ! -x $NONVERBA_TOOLS/wasm-bindgen/wasm-bindgen ]]; then
  mkdir -p "$NONVERBA_TOOLS/wasm-bindgen"
  tar -xzf "$NONVERBA_TOOLS/downloads/wasm-bindgen.tar.gz" --strip-components=1 -C "$NONVERBA_TOOLS/wasm-bindgen"
fi
# Google publishes SHA-1 checksums in its HTTPS Android repository metadata.
fetch https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip e025545c62a8e64c7559119566a569fb1dec5f60 sha1 commandlinetools.zip
if [[ ! -x $ANDROID_HOME/cmdline-tools/23.0/bin/sdkmanager ]]; then
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  unzip -q "$NONVERBA_TOOLS/downloads/commandlinetools.zip" -d "$ANDROID_HOME/cmdline-tools"
  mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/23.0"
fi
# Reuse only the already accepted Android SDK license record. A missing record
# blocks a fresh installation instead of accepting additional agreements.
if [[ -f /run/secrets/android_license ]]; then
  mkdir -p "$ANDROID_HOME/licenses"
  if [[ -f $ANDROID_HOME/licenses/android-sdk-license ]]; then
    cmp /run/secrets/android_license "$ANDROID_HOME/licenses/android-sdk-license"
  else
    install -m 644 /run/secrets/android_license "$ANDROID_HOME/licenses/android-sdk-license"
  fi
fi
# Preserve matching installed SDK packages. Refuse revision drift on a fresh
# install rather than silently accepting a later platform-tools/platform revision.
packages=('platform-tools' 'platforms;android-36' 'build-tools;35.0.0' 'build-tools;36.0.0' 'ndk;30.0.16248370')
revisions=('37.0.1' '2' '35.0.0' '36.0.0' '30.0.16248370')
missing=()
for package in "${packages[@]}"; do
  [[ -f "$ANDROID_HOME/${package//;/\/}/source.properties" ]] || missing+=("$package")
done
if [[ ${#missing[@]} != 0 ]]; then
  # The existing Android SDK agreement also applies to this Linux installation.
  sdkmanager --sdk_root="$ANDROID_HOME" "${missing[@]}"
fi
for index in "${!packages[@]}"; do
  properties="$ANDROID_HOME/${packages[$index]//;/\/}/source.properties"
  revision=$(sed -n 's/^Pkg.Revision[[:space:]]*=[[:space:]]*//p' "$properties" | tr -d '\r')
  [[ $revision == "${revisions[$index]}" ]] || { echo "Unexpected SDK revision in $properties: $revision" >&2; exit 1; }
done
printf '%s\n' "${packages[@]}" > "$NONVERBA_TOOLS/android-packages.txt"
dpkg-query -W > "$NONVERBA_TOOLS/debian-packages.txt"

# GPU dependencies are provisioned only for the explicitly selected GPU image.
# This installs compiler/runtime libraries, never a Linux or Windows GPU driver.
if [[ ${NONVERBA_GPU:-none} == cuda ]]; then
  fetch https://developer.download.nvidia.com/compute/cuda/repos/debian13/x86_64/cuda-keyring_1.1-1_all.deb \
    d0d4ef986a44400f9db33c600ef33a985175e7cc63d805a10e1839c7a1e78f5f sha256 cuda-keyring_1.1-1_all.deb
  dpkg -i "$NONVERBA_TOOLS/downloads/cuda-keyring_1.1-1_all.deb"
  apt-get update
  mapfile -t cuda_packages < container/cuda-packages.lock
  apt-get install -y --no-install-recommends "${cuda_packages[@]}"
  source container/env.sh

  llama_commit=14a9d09f75683c94c2c4f229efe54670d4209089
  # Existing /opt and /root volumes survive the later cutover. Keep new GPU
  # payloads in standard image locations so those mounts cannot hide them.
  llama_root="/usr/local/lib/nonverba/llama.cpp/$llama_commit"
  fetch "https://codeload.github.com/ggml-org/llama.cpp/tar.gz/$llama_commit" \
    6fa7a11d03fc55f4c01b595f0d672a9b8ebfa2ab3fd1707171c1ce186416ba5b sha256 "llama.cpp-$llama_commit.tar.gz"
  if [[ ! -d $llama_root/source ]]; then
    mkdir -p "$llama_root/source"
    tar -xzf "$NONVERBA_TOOLS/downloads/llama.cpp-$llama_commit.tar.gz" --strip-components=1 -C "$llama_root/source"
  fi
  cmake -S "$llama_root/source" -B "$llama_root/build-cuda" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_CUDA_ARCHITECTURES="${NONVERBA_CUDA_ARCHITECTURES:-86}" \
    -DGGML_CUDA=ON -DGGML_CUDA_NCCL=OFF -DGGML_NATIVE=OFF \
    -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_APP=OFF \
    -DLLAMA_BUILD_SERVER=ON -DLLAMA_BUILD_UI=OFF -DLLAMA_USE_PREBUILT_UI=OFF \
    -DLLAMA_OPENSSL=OFF -DLLAMA_SUBPROCESS=OFF \
    -DLLAMA_BUILD_NUMBER=0 -DLLAMA_BUILD_COMMIT="$llama_commit"
  cmake --build "$llama_root/build-cuda" --parallel 2 --target llama-server llama-completion

  model_revision=09816acd5d99df7be770d85ea30822623dab342c
  model_name=SmolLM2-135M-Instruct-Q4_K_M.gguf
  model_hash=2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d
  model_root="/usr/local/share/nonverba/models/smollm2-135m-instruct/$model_revision"
  mkdir -p "$model_root"
  fetch "https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/$model_revision/$model_name" \
    "$model_hash" sha256 "$model_name" "$model_root"
  printf '%s  %s\n' "$model_hash" "$model_root/$model_name" | sha256sum --check --status
  # The actual NVIDIA driver is injected when the GPU container starts. Do not
  # execute GPU-linked binaries during image provisioning or claim a runtime test.
  printf 'source_commit=%s\nbackend=cuda\ncuda_architectures=%s\nruntime_execution=not_checked\n' \
    "$llama_commit" "${NONVERBA_CUDA_ARCHITECTURES:-86}" > "$llama_root/build-identity.txt"
  sha256sum "$llama_root/build-cuda/bin/llama-server" "$llama_root/build-cuda/bin/"*.so* \
    > "$llama_root/SHA256SUMS.txt"
  dpkg-query -W > "$NONVERBA_TOOLS/debian-packages.txt"
fi
printf '\nLinux development dependencies installed in the container volumes.\n'
