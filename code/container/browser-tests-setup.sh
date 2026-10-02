#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Optional browser dependencies only; no service, project test or lifecycle work.
set -euo pipefail
code_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$code_root"
source container/env.sh
[[ ${NONVERBA_CONTAINER:-} == 1 && $(uname -s) == Linux && $(dpkg --print-architecture) == amd64 ]] || {
  echo 'Browser dependencies require the managed Linux amd64 container.' >&2; exit 1;
}
source /etc/os-release
[[ $ID == debian && $VERSION_ID == 13 ]] || { echo 'Pinned browser libraries require Debian 13.' >&2; exit 1; }
command -v node >/dev/null
command -v npm >/dev/null
if command -v python3 >/dev/null; then echo 'Python-free dependency prerequisite failed.' >&2; exit 1; fi

runtime="$NONVERBA_TOOLS/browser-tests"
[[ $runtime == /opt/nonverba-tools/browser-tests ]] || { echo 'Unexpected browser runtime root.' >&2; exit 1; }
qa="$code_root/artifacts/qa/browser-runtime-$(date -u +%Y%m%dT%H%M%S.%NZ)-$$"
[[ ! -L "$code_root/artifacts" && ! -L "$code_root/artifacts/qa" ]] || { echo 'Linked browser QA directory is unsupported.' >&2; exit 1; }
mkdir -p "$code_root/artifacts/qa"
mkdir "$qa"
exec > >(tee "$qa/setup.log") 2>&1
printf 'Optional browser dependency setup\nqa=%s\nruntime=%s\n' "$qa" "$runtime"
dpkg-query -W -f='${binary:Package}\t${Version}\n' | sort > "$qa/debian-before.tsv"
# Detect an unrelated or differently pinned runtime before changing libraries.
for manifest in package.json package-lock.json; do
  if [[ -e "$runtime/$manifest" ]]; then
    cmp "container/browser-tests/$manifest" "$runtime/$manifest" || { echo 'Existing browser runtime manifest differs; preserved.' >&2; exit 1; }
  elif [[ -e "$runtime/node_modules" ]]; then
    echo 'Existing browser modules have no retained dependency manifest; preserved.' >&2; exit 1
  fi
done

mapfile -t packages < container/browser-tests/debian-packages.lock
declare -A pinned
missing=()
for entry in "${packages[@]}"; do
  [[ $entry == *=* && $entry != *python* ]] || { echo "Invalid browser package pin: $entry" >&2; exit 1; }
  package=${entry%%=*}
  version=${entry#*=}
  pinned["$package"]=$version
  installed=$(dpkg-query -W -f='${Status}\t${Version}' "$package" 2>/dev/null || true)
  if [[ $installed == $'install ok installed\t'* ]]; then
    [[ ${installed#*$'\t'} == "$version" ]] || {
      echo "Refusing to change installed package version: $package ($installed), requested $version" >&2; exit 1;
    }
  else
    missing+=("$entry")
  fi
done
export DEBIAN_FRONTEND=noninteractive
if [[ ${#missing[@]} != 0 ]]; then apt-get update; fi
apt-get --simulate --no-install-recommends --no-upgrade --no-remove install "${packages[@]}" > "$qa/apt-plan.txt"
cat "$qa/apt-plan.txt"
while IFS= read -r line; do
  if [[ $line == Remv\ * ]]; then echo 'Refusing package removals.' >&2; exit 1; fi
  if [[ $line == Inst\ * ]]; then
    read -r _ package version _ <<< "$line"
    # An already-installed version appears in square brackets; reject upgrades
    # even if an APT option or future solver behavior would otherwise allow one.
    [[ $version == \(* ]] || { echo "Refusing installed-package change: $line" >&2; exit 1; }
    version=${version#(}
    [[ ${pinned[$package]:-} == "$version" ]] || { echo "Refusing unpinned dependency: $line" >&2; exit 1; }
  fi
done < "$qa/apt-plan.txt"
if [[ ${#missing[@]} != 0 ]]; then
  apt-get install -y --no-install-recommends --no-upgrade --no-remove "${packages[@]}"
fi
dpkg-query -W -f='${binary:Package}\t${Version}\n' | sort > "$qa/debian-after.tsv"
awk -F '\t' 'NR == FNR {before[$1]=$2; next} {if ($1 in before) {if (before[$1] != $2) exit 1; delete before[$1]}} END {if (length(before)) exit 1}' \
  "$qa/debian-before.tsv" "$qa/debian-after.tsv" || { echo 'Existing Debian package inventory changed unexpectedly.' >&2; exit 1; }
if command -v python3 >/dev/null; then echo 'Unexpected Python installation.' >&2; exit 1; fi

mkdir -p "$runtime"
for manifest in package.json package-lock.json; do
  if [[ -e "$runtime/$manifest" ]]; then
    cmp "container/browser-tests/$manifest" "$runtime/$manifest" || { echo 'Existing browser runtime manifest differs; preserved.' >&2; exit 1; }
  else
    install -m 644 "container/browser-tests/$manifest" "$runtime/$manifest"
  fi
done
export PLAYWRIGHT_BROWSERS_PATH="$runtime/browsers"
export PLAYWRIGHT_SKIP_BROWSER_GC=1
if [[ ! -d "$runtime/node_modules" ]]; then
  npm ci --prefix "$runtime" --cache "$runtime/npm-cache" --ignore-scripts --omit=optional --no-audit --no-fund
fi
npm ls --prefix "$runtime" --omit=optional
[[ $(node -p "require('$runtime/node_modules/playwright/package.json').version") == 1.58.2 ]] || {
  echo 'Installed Playwright differs from the pinned version.' >&2; exit 1;
}
node "$runtime/node_modules/playwright/cli.js" install --only-shell chromium
node "$runtime/node_modules/playwright/cli.js" --version
mapfile -t executables < <(find "$PLAYWRIGHT_BROWSERS_PATH" -type f -name chrome-headless-shell)
[[ ${#executables[@]} == 1 ]] || { echo 'Expected exactly one pinned Chromium headless shell.' >&2; exit 1; }
browser=${executables[0]}
ldd "$browser" > "$qa/browser-libraries.txt"
if grep -q 'not found' "$qa/browser-libraries.txt"; then cat "$qa/browser-libraries.txt"; exit 1; fi
"$browser" --version
find "$PLAYWRIGHT_BROWSERS_PATH" -type f -print0 | sort -z | xargs -0 sha256sum > "$qa/browser-files.sha256"
sha256sum setup.sh container/browser-tests-setup.sh container/browser-tests/* > "$qa/setup-inputs.sha256"
printf 'playwright=1.58.2\nmodule=%s/node_modules/playwright\nbrowsers=%s\nexecutable=%s\nexisting_packages_preserved=true\npython_present=false\nproject_tests_run=false\n' \
  "$runtime" "$PLAYWRIGHT_BROWSERS_PATH" "$browser" | tee "$qa/runtime.txt"
printf 'Browser dependencies ready; no project test or sensor session was started.\n'
