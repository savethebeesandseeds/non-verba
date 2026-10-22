#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# One target-aware preparation, validation and optional export path.
set -euo pipefail
code_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$code_root"

usage() {
  echo 'Usage: build-android.sh developer|participant|all [--export --baseline-report PATH]'
  echo 'Routine builds keep managed Gradle outputs; --export requires an independent signer baseline.'
}
if [[ ${1:-} == --help && $# == 1 ]]; then usage; exit 0; fi
target=${1:-}
case "$target" in developer|participant|all) shift ;; *) usage >&2; exit 2 ;; esac
export_requested=0
baseline=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --export)
      [[ $export_requested == 0 ]] || { usage >&2; exit 2; }
      export_requested=1; shift ;;
    --baseline-report)
      [[ -z $baseline && $# -ge 2 && -n $2 && $2 != --* ]] || { usage >&2; exit 2; }
      baseline=$2; shift 2 ;;
    *) usage >&2; exit 2 ;;
  esac
done
if [[ $export_requested == 1 && -z $baseline || $export_requested == 0 && -n $baseline ]]; then
  usage >&2; exit 2
fi
if [[ -n $baseline && ( ! -f $baseline || -L $baseline ) ]]; then
  echo 'Signer baseline must be an existing regular report file.' >&2; exit 2
fi
source container/env.sh

# Every snapshot and standalone producer shares these managed caches. Reuse a
# real inherited lock for child builds; contend before preparation or writes.
source tools/build/android-build-lock.sh
nonverba_acquire_android_build_lock
record=$(node tools/build/android-build-record.mjs start "$target" "$export_requested")
printf 'Android %s build record: %s\n' "$target" "$record"
logs="${record%.json}-logs"
mkdir "$logs"
build_root="$NONVERBA_BUILD_ROOT/android"
output=''
completed=0
packages=()
on_exit() {
  local result=$?
  if [[ $completed == 0 ]]; then
    node tools/build/android-build-record.mjs finish "$record" failed "${packages[@]}" || true
  fi
  return "$result"
}
trap on_exit EXIT

run_stage() {
  local name=$1; shift
  local started finished result log="$logs/$name.log"
  printf 'Android stage: %s (log: %s)\n' "$name" "$log"
  started=$(date +%s%3N)
  set +e
  "$@" > "$log" 2>&1
  result=$?
  set -e
  finished=$(date +%s%3N)
  cat "$log"
  node tools/build/android-build-record.mjs stage "$record" "$name" "$result" "$started" "$finished" "$log"
  return "$result"
}

check_signer() {
  # Gradle uses the retained root debug key. Never search for, copy or generate
  # another identity if that key is missing.
  [[ -s $NONVERBA_ANDROID_DEBUG_KEYSTORE && ! -L $NONVERBA_ANDROID_DEBUG_KEYSTORE ]] || {
    echo 'The retained Android debug keystore is missing or linked. Resolve it before building; no key was generated.' >&2
    return 1
  }
}

sync_sources() {
  mkdir -p "$build_root/app" "$build_root/participant" || return
  # Reusable Android tools are source inputs, separate from either app host.
  if [[ -d android/shared ]]; then
    mkdir -p "$build_root/shared" || return
    rsync -a --delete --exclude='build/' android/shared/ "$build_root/shared/" || return
  fi
  rsync -a android/settings.gradle.kts android/build.gradle.kts android/gradle.properties "$build_root/" || return
  # Both tiny metadata files remain available to the existing package inspector.
  rsync -a android/app/build.gradle.kts "$build_root/app/" || return
  rsync -a android/participant/build.gradle.kts "$build_root/participant/" || return
  local modules=()
  [[ $target == participant ]] || modules+=(app)
  [[ $target == developer ]] || modules+=(participant)
  local module
  for module in "${modules[@]}"; do
    # Preserve any old generated source-shaped directories. New sourceSets use
    # build/generated exclusively, so these retained files are not build inputs.
    rsync -a --delete --exclude='.toolchain/' --exclude='.gradle/' --exclude='.kotlin/' \
      --exclude='build/' --exclude='.cxx/' --exclude='local.properties' \
      --exclude='/src/main/assets/' --exclude='/src/main/jniLibs/' "android/$module/" "$build_root/$module/" || return
  done
  local properties="$build_root/local.properties"
  local current
  current=$(printf 'sdk.dir=%s\ncmake.dir=%s\n' "$ANDROID_HOME" "$CMAKE_HOME")
  if [[ ! -f $properties || $(cat "$properties") != "$current" ]]; then
    printf '%s\n' "$current" > "$properties" || return
  fi
}

export_packages() {
  mkdir -p "$code_root/artifacts/container-builds" || return
  local candidate="$code_root/artifacts/container-builds/$(date -u +%Y%m%dT%H%M%SZ)"
  # Exclusive creation preserves a prior export even on a timestamp collision.
  mkdir "$candidate" || return
  output=$candidate
  printf '%s\n' "$record" > "$output/INCOMPLETE.txt" || return
  node tools/build/android-build-record.mjs export-start "$record" "$output" || return
  packages=()
  if [[ $target != participant ]]; then
    cp "$build_root/app/build/outputs/apk/debug/app-debug.apk" "$output/nonverba-debug.apk" || return
    cp "$build_root/app/build/reports/lint-results-debug.html" "$output/" || return
    packages+=("$output/nonverba-debug.apk")
  fi
  if [[ $target != developer ]]; then
    cp "$build_root/participant/build/outputs/apk/debug/participant-debug.apk" "$output/nonverba-participant-debug.apk" || return
    cp "$build_root/participant/build/reports/lint-results-debug.html" "$output/participant-lint-results-debug.html" || return
    packages+=("$output/nonverba-participant-debug.apk")
  fi
  sha256sum "${packages[@]}" > "$output/SHA256SUMS.txt"
}

run_stage signer check_signer
if [[ $target != participant ]]; then
  run_stage developer-web node tools/build/build-web.mjs --android
  run_stage developer-assets node tools/build/stage-android.mjs
  run_stage developer-native bash tools/build/build-android-native.sh
fi
run_stage android-source-sync sync_sources
if [[ $target != developer ]]; then
  run_stage participant-assets node tools/build/stage-participant.mjs
fi
tasks=()
if [[ $target != participant ]]; then
  tasks+=(:app:assembleDebug :app:lintDebug)
  packages+=("$build_root/app/build/outputs/apk/debug/app-debug.apk")
fi
if [[ $target != developer ]]; then
  tasks+=(:participant:assembleDebug :participant:lintDebug)
  packages+=("$build_root/participant/build/outputs/apk/debug/participant-debug.apk")
fi
run_stage gradle gradle -p "$build_root" --no-daemon --max-workers=2 "-Pnonverba.target=$target" "${tasks[@]}"
if [[ $export_requested == 1 ]]; then
  run_stage export-copy export_packages
  if [[ $target != participant ]]; then
    run_stage developer-inspection node tools/build/verify-android-package.mjs \
      --apk "$output/nonverba-debug.apk" --baseline-report "$baseline"
  fi
  if [[ $target != developer ]]; then
    run_stage participant-inspection node tools/build/verify-participant-package.mjs \
      --apk "$output/nonverba-participant-debug.apk" --baseline-report "$baseline"
  fi
fi
node tools/build/android-build-record.mjs finish "$record" completed "${packages[@]}"
if [[ $export_requested == 1 ]]; then
  node tools/build/android-build-record.mjs manifest "$record" "$output"
fi
completed=1
printf 'Android %s build complete. Record: %s\n' "$target" "$record"
if [[ -n $output ]]; then printf 'Verified debug export: %s\n' "$output"; fi
