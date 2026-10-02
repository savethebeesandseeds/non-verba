#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Shared Linux-only environment for the JNI and pure Kotlin guard tests.
set -euo pipefail
HARNESS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CODE_ROOT="$(cd -- "$HARNESS_DIR/../../.." && pwd)"
source "$CODE_ROOT/container/env.sh"
cd "$CODE_ROOT"

cached_jar() {
    local coordinate="$1"
    local cache="$GRADLE_USER_HOME/caches/modules-2/files-2.1/$coordinate"
    local -a matches=()
    if [[ -d "$cache" ]]; then
        mapfile -d '' matches < <(find "$cache" -type f -name '*.jar' -print0)
    fi
    if [[ ${#matches[@]} -ne 1 ]]; then
        printf 'Expected one cached compiler dependency: %s (found %s). Run the documented container setup/Android build first.\n' "$coordinate" "${#matches[@]}" >&2
        return 1
    fi
    printf '%s' "${matches[0]}"
}

KOTLIN_STDLIB="$(cached_jar org.jetbrains.kotlin/kotlin-stdlib/2.2.20)"
KOTLIN_ANNOTATIONS="$(cached_jar org.jetbrains/annotations/13.0)"
KOTLIN_COMPILER_JARS=(
    "$(cached_jar org.jetbrains.kotlin/kotlin-compiler-embeddable/2.2.20)"
    "$KOTLIN_STDLIB"
    "$(cached_jar org.jetbrains.kotlin/kotlin-script-runtime/2.2.20)"
    "$(cached_jar org.jetbrains.kotlin/kotlin-reflect/1.6.10)"
    "$(cached_jar org.jetbrains.kotlin/kotlin-daemon-embeddable/2.2.20)"
    "$(cached_jar org.jetbrains.kotlinx/kotlinx-coroutines-core-jvm/1.8.0)"
    "$KOTLIN_ANNOTATIONS"
)
# An array assignment can mask a failed command substitution.
for dependency in "${KOTLIN_COMPILER_JARS[@]}"; do
    [[ -f "$dependency" ]] || { printf 'Missing cached Kotlin compiler dependency.\n' >&2; exit 1; }
done
KOTLIN_COMPILER_CP="$(IFS=:; printf '%s' "${KOTLIN_COMPILER_JARS[*]}")"
KOTLIN_PRODUCTION="$CODE_ROOT/android/app/src/main/kotlin/org/nonverba/camera"

compile_harness() {
    local output="$1"
    shift
    "$JAVA_HOME/bin/java" -Djava.awt.headless=true -cp "$KOTLIN_COMPILER_CP" \
        org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect \
        -classpath "$KOTLIN_STDLIB:$KOTLIN_ANNOTATIONS" -jvm-target 17 -d "$output" "$@"
}

run_harness() {
    local output="$1"
    local entrypoint="$2"
    shift 2
    "$JAVA_HOME/bin/java" -Djava.awt.headless=true \
        "-Djava.library.path=$CARGO_TARGET_DIR/debug" \
        -cp "$output:$KOTLIN_STDLIB" "$entrypoint" "$@"
}
