# Test ownership and prerequisites

Run checks from `code/` through the managed Linux environment. The authoritative
Node prerequisite registry is
[`tools/test/test-suites.mjs`](../tools/test/test-suites.mjs); adding a Node test
without a group fails the registry check.

| Directory | Scope |
| --- | --- |
| `unit/` | Isolated adapters, UI policy and package inspectors. No automatic WASM build. |
| `evidence/` | Evidence workflows using the real compiled evidence WASM. |
| `cooperation/` | Cooperation WASM and simulator model checks. |
| `build/` | Build orchestration and measurement checks with synthetic tool outputs. |
| `transport/` | Static guards and isolated fixtures for the reviewed USB helpers. No phone access. |
| `models/` | Pinned face-model preparation checks. |
| `browser/` | Chromium integrations with synthetic inputs; no physical sensor acceptance claim. |
| `integration/` | Cross-runtime assertion scripts and the attributed GNSS oracle source. |
| `fixtures/` | Reviewed synthetic inputs and their generators. |

```sh
node tools/test/run-tests.mjs unit
node tools/test/run-tests.mjs javascript
node --run test:browser:camera
```

`javascript` runs unit, evidence, transport and build-process groups. Evidence
and cooperation groups prepare their own WASM prerequisites. Browser scripts
are separate from the Node groups: some own a synthetic server or route
interception; others require a compiled developer preview. Use the package
script or the prerequisites described in the browser harness.
[`browser/harness.mjs`](browser/harness.mjs) selects the managed Chromium runtime
and optional `NONVERBA_BROWSER_EXECUTABLE`; external preview checks use loopback
4173 unless `NONVERBA_TEST_URL` supplies another explicit fixture URL. Specialized
servers and synthetic media remain owned by their individual checks.

`node --run test:browser:attestation` serves the canonical participant assets in
an isolated Chromium fixture and exercises real IndexedDB/WebCrypto browser-key
continuity, concurrency, refusal and fallback. It needs no service, APK, passkey,
biometric prompt or physical-device acceptance.

Prepare fixture-dependent browser checks in the same source snapshot. The
self-contained `crates/nonverba-android/tests/run-jni-smoke.sh` creates the public
synthetic raw-GNSS, camera and audio records. Enrollment and trust checks use
`NONVERBA_TRUST_FIXTURE_DIR="$PWD/artifacts/qa" cargo test --locked -p nonverba-core export_public_trust_fixture_when_requested`
after creating `artifacts/qa`. These fixtures exercise real signatures with
synthetic inputs; they supply no physical-device or hardware-trust acceptance.
The separate optional GPS-attempt fixture flow has its own input requirements
in the [JNI harness guide](../crates/nonverba-android/tests/README.md).

Android-only Kotlin lifecycle and collector tests live under
[`android/tests/platform/`](../android/tests/README.md). JNI integration tests
stay with `crates/nonverba-android/tests/`, and Rust unit tests stay with the
module or crate that owns them. Do not mix those owners into this directory.
