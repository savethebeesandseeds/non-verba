# Container JVM/JNI checks

Run these through the existing managed `non-verba-dev` container from the project root:

```powershell
./code/dev.ps1 -Action Exec -Command @('bash', 'crates/nonverba-android/tests/run-native-session-guards.sh')
./code/dev.ps1 -Action Exec -Command @('bash', 'crates/nonverba-android/tests/run-jni-smoke.sh')
```

The first command compiles the production pure Kotlin session, enrollment-catalog,
and microphone-recording guards plus location progress/timeout diagnostics with
their test harnesses. The second builds the
Linux Rust JNI library, compiles the production JNI declarations, and exercises
location, camera, and audio signing through real JVM-to-Rust calls. Use
`--skip-build` only to deliberately reuse the current Linux debug library.

Both entrypoints require the managed Linux container environment. They use its
pinned JDK and cached Kotlin compiler dependencies, write fresh compiled classes
to the named build volume, and never install tools or use a Windows JDK. Missing
compiler dependencies fail with an instruction to use the documented container
setup/Android build; there is no host fallback. The old PowerShell harnesses stay
disabled.

The JNI harness writes public synthetic signed fixtures to `code/artifacts/qa`
for the existing cross-runtime WASM tests. These are synthetic host-JVM tests:
they do not access a phone, attest physical sensor acquisition, or establish
hardware-backed key trust. Session guards likewise do not require Android/USB.
