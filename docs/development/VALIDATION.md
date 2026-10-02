# Unified repository validation

The consolidation was prepared from the current source working trees on
2 October 2026. It retains the public Git history and imports reviewed application
source without private Git history, personal captures, operational journals,
credentials, or build artifacts. Canonical synthetic regression inputs are
retained separately with byte-length and SHA-256 provenance.

Checks run inside the existing managed Debian development container. Its
immutable identity, image, original bind mount, named volumes, loopback ports,
GPU configuration, and restart policy were preserved. Unified source runs from
an explicit snapshot rather than the original private checkout. No Windows
compiler, Java runtime, phone install, or physical sensor capture is part of
these checks.

## Initial source-unification checks — 2 October 2026

| Check | Result |
| --- | --- |
| Main Rust workspace | Offline locked metadata and tests passed: cooperation, evidence core and Android JNI crate |
| Assignment and dispute workspaces | Offline locked tests passed; the independent Rust/Node signature and HMAC interoperability test also passed when explicitly enabled |
| Rust formatting | All three workspace checks passed |
| JavaScript syntax | Published JavaScript modules passed `node --check` |
| Cooperation WASM and example | Real compiled module, 88 JavaScript tests and the runnable example passed |
| Evidence WASM and Linux JNI | Build, synthetic JNI camera/audio/GNSS harness and native/WASM checks passed |
| JavaScript integration | 443 adapter, storage, session, policy, packaging and release-notice tests passed |
| Assignment WASM | Build and all 27 native/WASM parity cases passed |
| Cooperation browser and simulator | Real Chromium/module Worker checks and simulator checks passed |
| Camera browser | All 25 real Chromium checks passed, including location-only permission revocation, media-track shutdown, expiry, cancellation and replay refusal |
| Location browser | Passed against the built evidence application |
| Homepage export | Exact ten-file export and byte-identical AGPL/Primer notices verified |
| Browser release package | Archive contents and license/source notices verified |
| Android | Web assets staged; native libraries built for arm64-v8a and x86_64; `assembleDebug` and `lintDebug` passed |
| APK inspection | Libraries, assets, version, source/license notices and independently retained debug signer baseline verified |
| Publication review | Source namespaces, Markdown targets and source/key/artifact exclusions checked; all 49 migrated synthetic fixture hashes and lengths matched |
| Original checkout | Imported source hashes unchanged; original private checkout, Git history and uncommitted work preserved |

The camera suite initially stalled because `clearPermissions()` revoked camera
permission as well as location, ending the live track and disabling capture.
The test now checks that shutdown separately and uses an isolated Chromium
permission override to exercise location-only refusal. Both paths retain the
no-signing and unused-challenge assertions. The production capture code was
unchanged.

Three optional Rust checks were not run: the complete external IGS daily archive
import and two opt-in real-model dispute probes. They require separately
retained data or a provisioned pinned model/runtime. Synthetic importer and
mock-runtime tests passed; this is not a claim that a real dispute model was
validated. Android lint/build also reports existing Gradle deprecations for a
future Gradle 9 migration.

## Single Cargo workspace and final cleanup — 2 October 2026

The five Rust packages now share `code/Cargo.toml` and `code/Cargo.lock`.
Focused checks reused one public-source snapshot in the same managed container
and its existing build cache. The snapshot also captured concurrent assignment
terminology edits; those edits remain outside the consolidation commits.

| Check | Result |
| --- | --- |
| Workspace metadata | Offline locked metadata resolved all five members in one workspace |
| Native Rust tests | `cargo test --offline --locked --workspace` passed for all five members; optional checks remained opt-in |
| Historical prompt replay | The existing version-1 failed-record replay passed with combined workspace dependency features |
| Retained signing review | All five workflow acceptance tests passed with `serde_json/preserve_order` explicitly enabled |
| WebAssembly libraries | Offline locked `--lib` checks passed for core, cooperation and requests on `wasm32-unknown-unknown`; terminal binaries are native |
| Rust formatting | `cargo fmt --all --check` passed in the shared workspace |
| Dependency pins | Existing root-lock dependency versions and checksums were preserved; the separate protocol packages and required dependencies were added |
| Private reserve | Clean index with only README, ignore rules and text attributes; original history and ignored operational files retained |
| Documentation | Reviewed local Markdown targets resolve against the publication index and the new GPS preparation guide; scoped whitespace checks passed |

Combined dependency features exposed JSON key-order changes in historical
dispute prompts and terminal consent previews. Local formatting now sorts object
keys explicitly, preserving the original presentation while leaving signed
content, canonical hashes, schemas and fixtures unchanged. Existing assertions
continue to check historical replay and that retained content was displayed.

The optional external-data, real-model and interoperability probes retain their
explicit opt-in behavior. Existing `generic-array` deprecation warnings remain.
This final cleanup did not build Android, export packages, install an APK or
capture physical sensor data. The initial broader checks above are historical
evidence, not repeated checks for this workspace change.

## Running related checks

Run commands from `code/` inside one managed source snapshot. See
[the migration guide](CONTAINER_MIGRATION.md) for preserving generated outputs
between related commands. The aggregate `node --run test` covers the default
Rust, cooperation and JavaScript adapter suites. Extended native/WASM checks
need synthetic fixture generation first:

```sh
node tools/build-web.mjs
bash crates/nonverba-android/tests/run-jni-smoke.sh
node test/native-wasm-node-tests.mjs
```

Browser checks use the managed Playwright installation and a running preview
of the built application:

```sh
export NONVERBA_PLAYWRIGHT_PATH=/opt/nonverba-tools/browser-tests/node_modules/playwright
export PLAYWRIGHT_BROWSERS_PATH=/opt/nonverba-tools/browser-tests/browsers
export NONVERBA_TEST_URL=http://127.0.0.1:4173
# Keep this running in another shell in the same snapshot:
NONVERBA_BIND=127.0.0.1 NONVERBA_PORT=4173 node tools/serve.mjs
# Then run the browser checks from that snapshot's code directory:
node test/browser-tests.mjs
node test/location-browser-tests.mjs
```

These checks created synthetic artifacts and development packages only in
ignored container scratch storage. No APK was installed on a phone or released
as a binary. Development package source notices identify the base revision,
dirty state and source-snapshot digest; distribution requires complete
corresponding source for the exact package. Signing vaults and the independently
retained signer report were not imported into public source.

Software tests do not establish physical sensor authenticity, model reasoning
quality, fairness, payment finality, or a deployed multi-party service. Read
[sensor limits](../sensors/SECURITY.md),
[assignment assumptions](../requests/THREAT_MODEL.md), and the
[physical-device checklist](../sensors/DEVICE_ACCEPTANCE.md).
