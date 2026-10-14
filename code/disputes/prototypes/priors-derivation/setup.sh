#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Prototype dependencies only; no container or service lifecycle.
set -euo pipefail
prototype_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
code_root=$(cd -- "$prototype_root/../../.." && pwd)
source "$code_root/container/env.sh"
task_deps=/opt/nonverba-tools/priors-derivation-0.1
mkdir -p "$task_deps"
[[ ! -L $task_deps ]] || { echo 'Linked prototype dependency path refused'; exit 2; }
if [[ -f $task_deps/package.json ]] && ! cmp -s "$prototype_root/package.json" "$task_deps/package.json"; then
  echo 'Existing prototype dependency configuration differs; preserved for explicit review.' >&2
  exit 2
fi
cp "$prototype_root/package.json" "$prototype_root/package-lock.json" "$task_deps/"
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci --prefix "$task_deps" --no-audit --no-fund
if [[ ! -e $prototype_root/node_modules ]]; then ln -s "$task_deps/node_modules" "$prototype_root/node_modules"; fi
[[ $(readlink -f "$prototype_root/node_modules") == "$task_deps/node_modules" ]] || { echo 'Unexpected prototype dependency link'; exit 2; }
printf 'Prototype dependencies pinned in %s; no inference or project service started.\n' "$task_deps"
