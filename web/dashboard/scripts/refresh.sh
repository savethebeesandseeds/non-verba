#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Inside Debian, refresh this source tree. Windows Bash delegates snapshot/copy-back.
set -euo pipefail
dashboard_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
check=0
browser_check=0
for argument in "$@"; do
  case "$argument" in
    --check) check=1 ;;
    --browser-check) browser_check=1 ;;
    --help|-h)
      printf '%s\n' 'Usage: bash web/dashboard/scripts/refresh.sh [--check] [--browser-check]' \
        'Windows Bash: uses refresh.ps1 to validate in the managed container and copy HTML back.' \
        'Managed Debian: refreshes index.html in the current source snapshot.' \
        '--check checks data and HTML freshness without writing; --browser-check adds focused tests.'
      exit 0
      ;;
    *) printf 'Unknown option: %s\n' "$argument" >&2; exit 2 ;;
  esac
done

if [[ ${NONVERBA_CONTAINER:-} != 1 || $(uname -s) != Linux ]]; then
  # No host Node/build fallback. Reuse the authoritative Windows snapshot bridge.
  if ! command -v pwsh.exe >/dev/null 2>&1; then
    printf '%s\n' 'Run this helper inside the managed Debian container, or use refresh.ps1 on Windows.' >&2
    exit 1
  fi
  if command -v cygpath >/dev/null 2>&1; then
    powershell_script=$(cygpath -w "$dashboard_root/scripts/refresh.ps1")
  elif command -v wslpath >/dev/null 2>&1; then
    powershell_script=$(wslpath -w "$dashboard_root/scripts/refresh.ps1")
  else
    printf '%s\n' 'Windows Bash needs cygpath (Git Bash) or wslpath (WSL) for the existing refresh.ps1 helper.' >&2
    exit 1
  fi
  powershell_options=()
  if (( check )); then powershell_options+=(-Check); fi
  if (( browser_check )); then powershell_options+=(-BrowserCheck); fi
  exec pwsh.exe -NoLogo -NoProfile -NonInteractive -File "$powershell_script" "${powershell_options[@]}"
fi

repository_root=$(cd -- "$dashboard_root/../.." && pwd)
source "$repository_root/code/container/env.sh"
validator_options=()
if (( check )); then validator_options+=(--check); fi
node "$dashboard_root/scripts/validate.mjs" "${validator_options[@]}"
if (( ! check )); then node "$dashboard_root/scripts/validate.mjs" --check; fi
if (( browser_check )); then
  node --test "$dashboard_root/tests/model.test.mjs"
  NONVERBA_PLAYWRIGHT_PATH=${NONVERBA_PLAYWRIGHT_PATH:-/opt/nonverba-tools/browser-tests/node_modules/playwright} \
    PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-/opt/nonverba-tools/browser-tests/browsers} \
    node "$dashboard_root/tests/browser.mjs"
fi
