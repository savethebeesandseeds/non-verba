# Android key enrollment and independent verification

Non-verba can verify an Android key attestation on a separate requester or agent. The Rust verifier is shared by native builds and WebAssembly. Its result concerns the enrolled key and the boot/app state reported when that key was generated. It does not attest a later camera frame, microphone sample, GNSS observation, current app process, or current operating system.

The implementation is in `code/crates/nonverba-core/src/android_attestation/`. Enrollment request binding is in `key_enrollment.rs`; binding an enrollment to the signer of actual sensor evidence is in `agent_appraisal/context.rs`. Android key generation and export remain separate from capture in `NativeAttestedKeyStore.kt` and `NativeKeyEnrollment.kt`. Existing keys are preserved; selecting an enrolled identity is an explicit operation.

## Verification inputs

`verify_key_attestation(chain_json, expected_json, trust_json, now_secs)` returns a JSON report or an error. All errors fail closed. The verifier performs no network requests. The separate verifier must retain the request, observe response arrival itself, choose app and patch policy, obtain authenticated trust material, and supply its own clock. Copying these inputs from an operator's response defeats their purpose.

| Input | Required contents and responsibility |
| --- | --- |
| `chain_json` | `version: 1`, `certificates_der_b64`: a leaf-first array of 2–8 canonical base64 DER certificates. This is untrusted operator data. |
| `expected_json` | `version: 1`; original `challenge_b64`, `challenge_issued_at`, `challenge_expires_at`; independently observed `response_received_at`; requester-selected `max_enrollment_age_secs`; actual intended key's `expected_spki_sha256`; app and hardware policy described below. |
| `trust_json` | `version: 1`; `profile`; independently retained `root_spki_sha256` allowlist; independently obtained `revocation` snapshot. |
| `now_secs` | Verifier time in Unix seconds. Never use an operator-provided clock as the verifier's time. |

The expected app and hardware policy has mandatory fields `package_name`, `min_version_code`, `signing_certificate_sha256` (an exact set of app certificate SHA-256 hashes), `minimum_security_level` (`trusted-environment` or `strongbox`), `minimum_os_version`, `minimum_os_patch_level`, `minimum_vendor_patch_level`, and `minimum_boot_patch_level`. Hashes are lowercase hex. OS versions use Android's numeric encoding; OS patch levels use `YYYYMM`, and vendor/boot patch levels use `YYYYMMDD`. The code checks real calendar dates. Policy should come from the requester’s supported APK and deployment requirements, not defaults learned from the enrollment response.

The challenge contains 32–128 bytes. The request window is at most 600 seconds. Arrival must be within that window, and the verifier limits the retained enrollment's age to its chosen 1–2,592,000 seconds. An enrollment can be rechecked after the original request expires if it arrived on time and still meets the age, certificate, and current revocation policies. This is reusable key enrollment; each sensor request still needs its own fresh challenge.

Unknown JSON fields and malformed or excessive input sizes are rejected. Bounds include 160 KiB chain JSON, 16 KiB expectations, 2 MiB trust JSON, 32 KiB per DER certificate, and 96 KiB total DER.

## Trust anchors and revocation

For `profile: "google-hardware-attestation"`, the last certificate's SPKI hash must match both the verifier's allowlist and the compiled Google anchor set:

| Anchor | SHA-256 of DER SubjectPublicKeyInfo |
| --- | --- |
| Google factory RSA root | `feb2ea7551ee316ed4bb443c8293b884dbfdea40b603ee3e4f4a897e4580fbae` |
| Google P-384 root introduced in 2026 | `3ee44512a1af2beb39c889490c60ea3f82e43f5d5a5532f5ab9419f676cd07ec` |

These public anchors were obtained from the [official root endpoint](https://android.googleapis.com/attestation/root) on 2026-09-27. Their certificates are retained as `android_attestation/google-roots-2026.json` for reproducible tests. Anchor updates require review and a code update; an operator cannot add a new Google root through input JSON. The caller can restrict the compiled set further.

The `private-test` profile accepts only caller-pinned private roots and always returns `key_enrollment_attested: false`, even if every synthetic claim says StrongBox. It supports adversarial fixtures and private PKI experiments without converting those into a Google hardware verdict.

The `revocation` object contains `fetched_at`, `valid_until`, and `entries`. `entries` follows the certificate status dictionary from Google's [attestation status endpoint](https://android.googleapis.com/attestation/status). Keys are canonical lowercase certificate serial numbers; supported statuses are `REVOKED` and `SUSPENDED`. Presence of any chain certificate, including its root, rejects the chain. An entry's optional expiry never overrides its revoked status.

Snapshot validity must be positive and at most 24 hours; future fetch times and expired snapshots reject verification. Obtain the complete list over authenticated HTTPS in the independent verifier environment and set these timestamps there. The module cannot authenticate the transport used to obtain JSON and explicitly reports `trust_material_transport_authenticated: false`. An empty, fabricated, or operator-filtered list is not trustworthy simply because its JSON passes validation. Availability failures must not fall back to skipping revocation.

## Restricted supported certificate profile

The verifier validates all certificate signatures, including the root self-signature, and enforces ordering, CA constraints, path lengths, key usages, current validity, recognized algorithms, extension uniqueness, and applicable authority-key identifiers. Issuer keys can be RSA 2048–8192 with exponent 65537, P-256, or P-384. Certificate signatures support RSA PKCS#1 v1.5 with SHA-256/384/512 and ECDSA with SHA-256/384. The actual enrolled leaf must be P-256 and signing-only.

The only attestation extension must be on that leaf. A supplied chain with another attestation above it, an appended leaf, or a delegated attestation profile is rejected. If provisioning information exists, it must occur exactly once on the leaf's immediate issuer, and its declared TEE/StrongBox origin must agree with the key's claim. Lost-device provisioning rejects the chain. This narrow direct-key profile follows the trusted-root direction when deciding which extension could be authoritative; it does not assume an arbitrary final extension is trustworthy. Android's [verification guidance](https://developer.android.com/privacy-and-security/security-key-attestation) explains why appended attestations must not be trusted.

Unknown critical extensions and unimplemented path or purpose constraints reject the chain. Unknown or misplaced authorization tags also reject it. This is deliberately not a general Android PKIX compatibility library. New device schemas require inspection and explicit support; they do not silently become trusted.

Supported KeyDescription schema versions are 3, 4, 100, 200, 300, 400, and 500 with their corresponding Keymaster/KeyMint version. Required hardware authorizations establish generated P-256/SHA-256 signing-only keys, locked verified boot, nonempty boot key/image hashes, and the configured OS/patch minimums. A single expected package and its exact signing-certificate set must appear in application identity; shared-UID packages are unsupported. Device-unique IDs are rejected. Android defines these fields in its [attestation schema](https://source.android.com/docs/security/features/keystore/attestation).

All certificates must currently be valid, including factory-issued certificates. Google documents an exception for some expired factory chains; this implementation does **not** apply that exception. Such phones can retain their existing non-attested identity but cannot satisfy this strict profile. The report names this policy as `strict-current-validity-no-factory-expiry-exception`.

## Enrollment and use by agents

Use `create_key_enrollment_request("media" | "location", now_secs)` to obtain an unpredictable, typed request. The challenge hashes a domain separator, purpose, issue/expiry times, and a 32-byte random nonce. `validate_key_enrollment_request` checks that binding before collection.

The native enrollment export supplies the actual key's public SPKI and certificate chain. `verify_key_enrollment(response, original_request, policy, trust, response_received_at, now)` validates the original request, matching purpose/challenge, actual SPKI, and the identity pin. A location identity uses its SPKI hash. A media identity additionally binds the stable C2PA certificate to the same SPKI. Locally reported security labels are not accepted as the hardware verdict.

Enrollment alone returns `possession_proven: false`. An agent's `appraise_*_with_context` APIs rerun both sensor proof verification and attestation verification, require that the attested SPKI matches the actual artifact signer, and establish possession through that artifact's valid signature. Composed camera/location evidence needs both signing keys to pass when hardware attestation is required. The basic appraisal APIs without context cannot establish this additional evidence.

Keep three decisions separate:

1. **Enrollment verification:** a trusted authority signed supported key-generation claims for the original challenge and policy.
2. **Artifact verification:** the expected enrolled key signed this exact challenge-bound evidence record, and its measurement/continuity checks pass.
3. **Task acceptance:** the requester applies freshness, risk, replay, and sensor requirements and durably consumes the task before acting.

The report never claims current app state, physical sensor origin, sample freshness, a trusted device clock, or consumed/replay-protected enrollment. Application identity is explicitly labeled Android-software-reported inside the hardware-signed extension. Those limits remain even when `key_enrollment_attested` becomes true.

## Validation scope

Twelve focused Rust tests cover synthetic valid chains, independent trust/challenge/key/app policies, chain signatures and CA/path/expiry constraints, malformed DER, duplicate/appended extensions, authorization placement, revoked serials at every chain level, stale trust, and provisioning placement/origin/lost-device failures. Separate tests verify the actual public RSA and P-384 Google anchors and reject modified signatures. Synthetic chains always use `private-test`; no generated fixture claims to be a physical attested device.

Enrollment integration tests exercise both media certificate pins and location SPKI pins, mutation of the domain-bound request, substituted credentials, invalid arrival times, and trust/app policy failure. Context tests sign actual COSE location and C2PA image records with the fixture's attested key, verify possession and exact signer binding, reject another valid key's enrollment, and keep private-root hardware claims false. They also run the independent position solver over signed synthetic raw observations and reject altered navigation bytes. An empty context must produce exactly the same appraisal as the basic API.

To generate public-only interoperability fixtures, set `NONVERBA_TRUST_FIXTURE_DIR` to `code/artifacts/qa` and run the Rust workspace tests. The export test writes `trust-synthetic-fixtures.json`; private fixture keys stay in process memory. `code/test/trust-browser-tests.mjs` then runs 17 enrollment, actual-signer binding, rejection, and position-policy cases through the real compiled WASM worker. It requires the fresh web build and the existing Playwright/local preview setup. The official RSA/P-384 root self-signature tests run on the Rust host; the browser fixtures use a generated P-256 private-test chain and do not claim to exercise an actual Google-issued device chain.

This verifier still needs validation against actual supported phones and independently retained enrollment requests. Passing the synthetic and public-root tests is not evidence that a phone generated a key in hardware or that a particular device's certificate profile is compatible. Browser execution and final release packaging are tracked in `VALIDATION.md`.
