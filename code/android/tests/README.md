# Android platform and JNI checks

Pure Kotlin Android platform guard harnesses live in `platform/`. Rust JNI
integration harnesses remain in [the JNI crate](../../crates/nonverba-android/tests).
The shared `harness-env.sh` only selects the documented container compiler
dependencies; it uses the calling runner's directory for its test inputs.

Run these through the existing managed `non-verba-dev` container from the project root:

```powershell
./code/dev.ps1 -Action Exec -Command @('bash', 'android/tests/platform/run-native-session-guards.sh')
./code/dev.ps1 -Action Exec -Command @('bash', 'crates/nonverba-android/tests/run-jni-smoke.sh')
./code/dev.ps1 -Action Exec -Command @('bash', 'android/tests/platform/run-native-audio-lifecycle.sh')
./code/dev.ps1 -Action Exec -Command @('bash', 'android/tests/platform/run-native-lifecycle-cleanup.sh')
./code/dev.ps1 -Action Exec -Command @('bash', 'android/tests/platform/run-recovery-export.sh')
./code/dev.ps1 -Action Exec -Command @('bash', 'android/tests/platform/run-identity-camera.sh')
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

The recovery-export harness exercises the participant's exact eight-code text
format and bounded in-memory export lease: canonical distinct tokens, invalid
format refusal, copy isolation, request cancellation, expiry and stale completion
after a retry. It does not open an Android document provider. The platform bridge
uses the system Create document picker and requires a separate device check for
provider cancellation, chosen-destination writing and Activity round trips.

The identity-camera harness compiles the production closed capture protocol,
JPEG metadata/orientation policy, strict lens policy, exact-document revocation
guard and bounded signing queue. It checks a real JCA P-256 signature and emits
a synthetic detached proof for independent Rust/WebCrypto verification. Its
blocked-worker test permits one waiting job and refuses excess work without
growing the queue. Paused documents may revoke, while new authority requires the
foreground document. This is JVM/software evidence; Android Bitmap decoding,
Camera2 acquisition, physical front/rear lenses and OS permission-dialog behavior
still require Android/package and separate phone checks.
