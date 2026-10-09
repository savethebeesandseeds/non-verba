# Container JVM/JNI checks

Run these through the existing managed `non-verba-dev` container from the project root:

```powershell
./code/dev.ps1 -Action Exec -Command @('bash', 'crates/nonverba-android/tests/run-native-session-guards.sh')
./code/dev.ps1 -Action Exec -Command @('bash', 'crates/nonverba-android/tests/run-jni-smoke.sh')
./code/dev.ps1 -Action Exec -Command @('bash', 'crates/nonverba-android/tests/run-native-audio-lifecycle.sh')
./code/dev.ps1 -Action Exec -Command @('bash', 'crates/nonverba-android/tests/run-native-lifecycle-cleanup.sh')
```

The first command compiles the production pure Kotlin session, enrollment-catalog,
and microphone-recording guards plus location progress/timeout diagnostics with
their test harnesses. The second builds the
Linux Rust JNI library, compiles the production JNI declarations, and exercises
location, camera, and audio signing through real JVM-to-Rust calls. Use
`--skip-build` only to deliberately reuse the current Linux debug library.

All entrypoints require the managed Linux container environment. They use its
pinned JDK and cached Kotlin compiler dependencies, write fresh compiled classes
to the named build volume, and never install tools or use a Windows JDK. Missing
compiler dependencies fail with an instruction to use the documented container
setup/Android build; there is no host fallback. The old PowerShell harnesses stay
disabled.

The JNI harness writes public synthetic signed fixtures to `code/artifacts/qa`
for the existing cross-runtime WASM tests. These are synthetic host-JVM tests:
they do not access a phone, attest physical sensor acquisition, or establish
hardware-backed key trust. Session guards likewise do not require Android/USB.

The focused audio-lifecycle entrypoint compiles the production scheduling,
deadline and cleanup helper with deterministic queues and clocks. It covers
rejected submissions, unanswered permission work, terminal timing, stale
callbacks, retry ownership and teardown failures without recording or playback.
It also tests deep-copy retention of the last collector configuration after
pilot detachment, failed diagnostic copies and isolation from successor attempts.
The JNI harness exercises the internal Rust pilot assessment with timely, absent,
late and malformed synthetic samples; a diagnostic response never signs evidence.
Use the documented `-Snapshot` bridge for the preserved pre-unification container,
and reuse its printed snapshot for related checks.

The lifecycle-cleanup entrypoint exercises the production shared cleanup runner
with failing releases and diagnostic sinks. It verifies authority revocation
before cleanup, independent subsystem releases, framework lifecycle completion,
retained resource ownership and safe retry without reviving collection. It does
not emulate an Activity or establish physical Android cleanup behavior.
