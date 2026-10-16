#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# FD 9 is reserved for the shared Android producer lock. Children may reuse the
# inherited open file description only when it names this exact managed lock.
nonverba_acquire_android_build_lock() {
  local lock_path="${NONVERBA_BUILD_ROOT:?Source container/env.sh before acquiring the build lock}/locks/android-build.lock"
  local inherited
  inherited=$(readlink "/proc/$$/fd/9" 2>/dev/null || true)
  if [[ $inherited != "$lock_path" ]]; then
    mkdir -p "${lock_path%/*}" || return
    exec 9>> "$lock_path" || return
  fi
  local result
  if flock -n -E 75 9; then return 0; else result=$?; fi
  if [[ $result == 75 ]]; then
    echo 'Another Android build or web/native producer owns the shared build tree. Retry after it finishes.' >&2
  else
    echo 'Could not acquire the shared Android producer lock.' >&2
  fi
  return "$result"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  set -euo pipefail
  [[ $# -gt 0 ]] || { echo 'Usage: android-build-lock.sh COMMAND [ARGS...]' >&2; exit 2; }
  code_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
  cd "$code_root"
  source container/env.sh
  # Node callers must validate inherited descriptors against the fixed paths
  # from env.sh, rather than trusting a caller-provided environment marker.
  if [[ $1 == --check-inherited && $# == 1 ]]; then
    lock_path="$NONVERBA_BUILD_ROOT/locks/android-build.lock"
    [[ $(readlink "/proc/$$/fd/9" 2>/dev/null || true) == "$lock_path" ]] || exit 76
    flock -n -E 75 9
    exit
  fi
  nonverba_acquire_android_build_lock
  exec "$@"
fi
