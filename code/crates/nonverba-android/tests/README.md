# Rust JNI integration harnesses

These Kotlin harnesses call the real Linux `nonverba-android` shared library.
They remain with the Rust JNI crate because they verify its exported boundary.
Run `run-jni-smoke.sh` for the self-contained location, camera and audio signing
checks.

Pure Kotlin Android platform checks live in
[`code/android/tests/platform`](../../../android/tests/platform). The shared
[Android harness guide](../../../android/tests/README.md) documents the managed
Linux compiler environment and launcher commands. Windows Java is prohibited;
the retained PowerShell JNI runner stops with those directions.

## Optional GPS attempt cross-runtime fixture

`run-gps-attempt-jni.sh OUT_DIRECTORY` is a separate fixture-dependent check.
Its existing input must be `OUT_DIRECTORY/snapshot.json`: a synthetic raw GPS
attempt `Snapshot`, rather than a signed report or a public export envelope.
The harness expects the compact collecting-stage policy-rejection fixture and
writes `jni-report.json` and `jni-key.txt` in that same directory. It uses a
synthetic JCA key and never uses phone observations or Android Keystore.

There is currently no maintained source command that generates this snapshot
file. The Rust `location_attempt_tests.rs` fixtures are constructed in memory;
they do not export `snapshot.json`. Do not infer a generator or treat this
optional runner as self-contained. Missing arguments or input fail before any
compiler environment or build is started.

For an already prepared synthetic fixture, run these commands from `code/`
inside the documented managed container:

```bash
bash crates/nonverba-android/tests/run-gps-attempt-jni.sh /absolute/container/path/prepared-synthetic-gps-fixture
```

The separate `test/integration/gps-attempt-cross-runtime.mjs OUT_DIRECTORY`
also requires that fixture's exact `original.json` and the already built
`web/dist` WASM module. It consumes the JNI outputs and writes the verification
result used by `test/browser/gps-attempt-browser-tests.mjs OUT_DIRECTORY`.
Their unavailable fixture-generation prerequisite remains explicit; the core
Rust tests and the self-contained JNI smoke checks are separate validation.
