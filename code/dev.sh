#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
code_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/." && pwd)
cd "$code_root"
source container/env.sh
action=${1:-health}
shift || true
case "$action" in
  health)
    uname -s; java -version; node --version; rustc --version; wasm-bindgen --version
    gradle --version; cmake --version; adb version
    ;;
  exec) exec "$@" ;;
  native) exec bash tools/build-android-native.sh "$@" ;;
  build)
    node tools/build-wasm.mjs
    node tools/build-web.mjs
    node tools/stage-android.mjs
    bash tools/build-android-native.sh
    bash tools/build-android.sh
    ;;
  test)
    node --run test
    ;;
  serve)
    node tools/build-web.mjs
    NONVERBA_BIND=0.0.0.0 NONVERBA_PORT=4173 exec node tools/serve.mjs
    ;;
  adb) exec adb "$@" ;;
  webview)
    # Forward only the explicitly selected app's debug socket. ADB listens on
    # container loopback; socat makes it reachable through Docker's 127.0.0.1 port.
    [[ $# == 1 ]] || { echo 'Usage: dev.sh webview DEVICE_SERIAL' >&2; exit 2; }
    pid=$(adb -s "$1" shell pidof org.nonverba.camera | tr -d '\r')
    [[ $pid =~ ^[0-9]+$ ]] || { echo 'Start the debug app on the selected phone first.' >&2; exit 1; }
    adb -s "$1" forward tcp:9223 "localabstract:webview_devtools_remote_$pid"
    exec socat TCP-LISTEN:9222,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:9223
    ;;
  *) echo "Unknown task: $action" >&2; exit 2 ;;
esac
