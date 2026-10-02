# Non-verba camera, microphone and location evidence

Non-verba evidence capture for Android and browsers, published with the cooperation and Assignment protocols under the repository license. The [project description](https://github.com/savethebeesandseeds/non-verba) describes an open protocol and marketplace where agents and humans exchange verifiable signed offers, evidence, and outcomes. This app implements challenge-bound photos with GPS and live acoustic challenge-response recordings.

Non-verba is intended primarily for agents. Full MCP control of authorized
requester/operator/verifier workflows is a product requirement; the current UI
is a testing surface, not the final app interaction design. The shared Rust APIs
are the foundation, while an MCP server and durable agent service remain planned.
See [agent workflow and MCP requirements](../development/AGENT_WORKFLOWS_MCP.md) for lifecycle,
delegation, sensor independence, retry, transport and evidence-trust boundaries.

The [implementation status](STATUS.md) summarizes native location, camera and microphone acquisition and the remaining assurance limits. The [physical acceptance checklist](DEVICE_ACCEPTANCE.md) describes an ordered phone test plan; it records no new physical result by itself.

The shared Rust core runs as WebAssembly in the browser and Android WebView, and through JNI for native Android sensor evidence. Kotlin adapts permissions, GNSS and Camera2 callbacks, lifecycle, Keystore signing, protected storage and file import/export. C++ owns the realtime AAudio buffers; Rust owns protocol, DSP and verification. There are **no Java source files**, server signing keys, remote signing services, CDN assets, or photo uploads.

The 0.7.0 implementation connects live audio to the shared requester API: the
requester receives and verifies the complete signed WAV, signs its arrival receipt,
and can accept it once locally. Pairing precedes release of the fresh signed request.
An explicit policy can require monitored Android microphone capture. Camera
acceptance re-verifies retained bytes and checks expiry inside its atomic write;
native camera sealing also checks delivery order and expiry after signing delays.
Live camera supports paired image delivery, and live location now shares the
requester receipt/acceptance path with explicit native/raw policy and optional
independently supplied attestation/position context. Live composed camera/location
sessions retain both signing IDs and receive the complete JPEG and separate location
proof before observing arrival. The original request, both artifacts and the receipt
are reverified before local acceptance; standalone composed capture remains available.
These extend the independent RINEX navigation import, GPS recomputation, native
acquisition and key enrollment from earlier releases. Sensor modules remain
independent; the shared requester API handles policy, receipt and acceptance.
See [the agent interface](AGENT_EVIDENCE.md),
[native camera](NATIVE_CAMERA.md), [native audio](NATIVE_AUDIO.md), and
[live requester sessions](LIVE_SESSIONS.md). Physical-device acceptance remains
partial; these features do not establish sensor truth.

Binary releases, device captures and earlier review journals are not included in this source import. Generated outputs remain ignored. See [sensor validation boundaries](VALIDATION.md) and [the current unification checks](../development/VALIDATION.md) for their distinct scope.

## Independent location workflow

Open **Location proof** to request location alone, collect a short raw-GPS trace and export a standard COSE-signed record. **Try demo** uses actual location updates without an operator ID. Verification needs the original request and independently trusted location key ID. Browser records explicitly lack native mock detection; Android collects and signs within a native session using a separate Keystore key.

Camera requests can include the same location module. New camera and location requester forms default to a native GPS proof with raw satellite observations, a two-second minimum and at least three fixes/epochs; live camera also requires a correlated native capture clock. Reduced profiles are inside Details. The combined workflow exports a C2PA JPEG and a matching location proof that hashes the complete JPEG. Keep both files and verify them against both trusted key IDs. Required capabilities never silently fall back. See [complete packages and measured timing costs](COMPLETE_SENSOR_PACKAGES.md) and [location usage](LOCATION.md).

[GPS preparation and short observations](GPS_PREPARATION.md) explains the
foreground receiver warm-up, discarded preparation fixes and why a two-second
minimum does not promise two-second completion.

## Microphone workflow

To try it without an operator ID, choose **Try demo**, then **Start demo recording**. This device handles both roles, uses its real microphone and speaker, records four seconds, and verifies the signed result automatically. Demo mode is explicitly signed into the recording and is labelled throughout; it does not represent an independent requester.

Open **Live audio evidence**. The requester and operator pair directly using offer/answer JSON on a reachable local network. The operator's phone emits and records a high-frequency pattern while capturing 4–30 seconds of continuous sound. The requester generates a fresh random challenge only after receiving the preceding two-second audio segment. The final WAV contains C2PA Content Credentials; verification checks the original requester receipt, expected device key, all received audio hashes, deadlines, duration, and recovered signals.

Pairing uses independently exchanged requester and operator IDs. The signed request
is released after connection; its three-minute delivery window includes microphone
setup, recording and final WAV receipt. Completion requires verification of that
exact signed file. Save both the received WAV and final requester receipt bundle.
The requester can then accept once locally; importing the bundle for verification
does not record acceptance. New requester forms default to ten seconds of
**Android monitored recording**; browser-compatible recording remains an explicit
reduced profile in Details. An unsupported operator must reject the stronger policy.

A speaker/microphone test gates capture. The fixed 20.25/20.75 kHz profile is experimental and is not universally supported or guaranteed inaudible. Rust handles processing, through JNI for native AAudio capture and WASM for browser capture; the audio is sent directly to the requester during the session. There is no public relay or account backend. Keep the independently retained requester receipt separately from the operator's WAV. This raises the effort required for simple replays but does not prove physical sound freshness against a modified app or a live external replay. See [audio protocol, usage and limits](AUDIO.md).

## Workflow

Native GPS raw-GNSS policy rejections and collection timeouts with zero raw
callbacks now have separate signed attempt reports.
Use Location → **GPS failed attempts** to retain/export reports and verify them
against an independently kept original request and trusted location key ID.
Retries retain up to 32 attempts; full storage and signing failures are explicit.
These reports never establish a successful measurement or successful acceptance.
See [GPS attempt reports and limits](GPS_ATTEMPT_REPORTS.md).

1. **Requester:** choose a location requirement, enter a task and create a fresh 256-bit challenge. Save the complete original JSON and send it to the operator. Obtain the photo key ID and, for combined requests, the location key ID through a trusted channel.
2. **Operator:** import that request, open the live camera and capture before expiry. New combined requests collect location while the camera is open, use a fresh fix at shutter time, and finish remaining observations after the frame. Keep Non-verba open until both records finish. Rust adds the pixel watermark and C2PA Content Credentials; the location proof binds the final JPEG. Save/share both exported files when requested. Local ledgers reserve challenges before signing; retakes or failed signing attempts require a new challenge.
3. **Verifier:** supply the JPEG, original request and independently received key IDs, plus the location proof for combined requests. Verification checks signatures, file bindings, exact request equality, GPS correspondence and claimed times. A requester can accept evidence once on this device while its challenge window remains open.

Expired requests can still be verified historically. Acceptance is a separate operation, with an atomic IndexedDB ledger preventing a second acceptance in the same browser profile or Android app installation. There is no shared requester service yet, so this ledger cannot stop replay across devices or after local data is cleared.

For completed live requester sessions, save the displayed session ID. The camera
page's **Retained requester evidence** test panel can reopen and reverify the
original evidence after reload, show its existing local acceptance record, and
exercise duplicate rejection without starting a sensor. See [camera sessions](CAMERA_SESSIONS.md).

## What the evidence means

C2PA supplies the standard provenance container, image hard binding, certificate chain, and COSE signature. The custom `org.nonverba.capture` assertion holds the requester challenge, device certificate fingerprint, watermarked image digest, claimed capture time, and watermark lookup identifier. It is an application assertion inside C2PA, not a replacement provenance format.

A valid signature with a nonce establishes that the signing operation occurred after that nonce became known, assuming the requester chose it unpredictably. It **does not cryptographically prove when photons reached the camera**, the truth of a scene, or the honesty of the device clock. The UI only offers a live camera capture path, but a modified client or compromised device can bypass it. Requester receipt during the challenge window supplies a useful upper bound on when evidence was received.

This preview creates a unique local ES256 signing identity and local certificate chain on first operator use. Verifiers pin the actual signer certificate’s SHA-256 fingerprint, not a fingerprint merely asserted in metadata. These certificates are not enrolled in a C2PA trust list. Reports explicitly return `certificate_trusted: false`, `hardware_attested: false`, and `camera_freshness_proven: false`.

Android native camera/audio use a separate non-exportable ES256 Keystore key, with StrongBox preferred when available and the actual local security level reported. Its certificate pin must be enrolled separately from older software photo/audio keys, which remain preserved. Native location keeps its separate SPKI pin. Browser signing and live requester signing remain protected software identities whose private material is available during use. Local KeyInfo is not remote attestation. Missing or mismatched key records fail instead of silently rotating identities.

**Signing keys** provides a separate requester/operator/verifier enrollment flow.
Each requester challenge creates an additional immutable Android identity, up to
32 retained generations per purpose, and never selects it automatically. The
requester checks the certificate chain, original challenge and arrival, app signer,
boot state, patches, pinned Google roots and current revocation data. A helper
fetches trust data independently over HTTPS:
`pwsh -File code/tools/fetch-attestation-trust.ps1`. The default enrollment page
policy pins the development APK signer and must be reviewed for a deployment.
See [native enrollment](NATIVE_KEY_ENROLLMENT.md) and
[verification policy](KEY_ATTESTATION_VERIFIER.md).

Agent appraisal can bind that independently verified enrollment to the actual
key that signed a sensor artifact. Its result describes the key's state at
generation; it does not authenticate the current app or sensor path. Synthetic
test roots never satisfy a hardware-attestation requirement. Existing sensor
verifiers remain conservative unless the caller explicitly supplies the separate
trust context; no operator-supplied verdict can substitute for verification.

## Pixel watermark

Rust embeds a repeated 64-bit lookup identifier with a version marker and CRC32 into mid-frequency luminance DCT coefficients, before signing. Tests cover metadata removal and JPEG quality-85 recompression. The generated test fixture measured approximately 39 dB PSNR; this is not a broad natural-image robustness benchmark.

The watermark is experimental and is not a registered C2PA soft-binding algorithm. It is a recovery/search hint, never authentication. Resizing, cropping, rotation, screenshots, strong recompression, or deliberate removal may destroy it. There is no remote original-file lookup service in this version. Keep the original JPEG; any modification invalidates its C2PA image binding even if the watermark survives.

## Capture location

New captures require foreground location permission and a fresh WGS84 position. New combined requests collect a bounded trace alongside the camera and retain a fresh observation selected at shutter time for the photo. Legacy combined requests retain their final-observation rule. Metadata-only requests use the previous single-fix workflow. Denied permission, timeout, an unavailable fix or a stale position prevents signing; a failed location acquisition before reservation does not consume the challenge.

Latitude/longitude, hemisphere, fix time/date, and horizontal accuracy are written to standard EXIF GPS metadata **before** C2PA signing. The same device-reported location, including available altitude information, is stored in the signed capture assertion. The operator and verifier can see the coordinates and reported accuracy. GPS metadata travels with every exported new photo; no independent location history or background location access is added.

The Rust core rejects invalid coordinates, accuracy and timing. New combined requests use a five-second maximum fix age at collection end and a separate thirty-second finalization allowance; native camera acquisition also checks GPS within five seconds of exposure. Browser metadata-only captures retain the previous thirty-second bound. Android can require the GPS provider and raw receiver/satellite observations. Raw clock, signal, uncertainty and coverage checks alone do not recompute position. The separate GPS L1 verifier can solve position and receiver-clock bias using independently pinned navigation input, then compare every claimed fix, altitude and epoch. It checks mathematical consistency; satellite/RF authenticity remains unproven. Reports keep `location_authenticity_proven: false`. Legacy photos remain readable; fresh acceptance requires valid signed GPS metadata and any location proof required by the original request.

Raw satellite evidence remains an optional stronger request. New raw requests allow up to 100 ms of reported Android clock-alignment uncertainty, separately from receiver/satellite precision. Actual uncertainty consumes the requested time budgets and appears in the report; clock compatibility does not prove precise clock stability. This task-scale default is tested against simulated device variation, not calibrated to one phone. Reports distinguish an intact signature with unmet collection requirements from integrity/binding failures. Previously issued requests keep their original rules. See [the compatibility decision and validation](RAW_GNSS_ALIGNMENT_REVIEW.md).

## Source layout

The evidence application shares this repository with the cooperation, Assignment and dispute components. The paths below are relative to the repository root. The public homepage lives in `web/site/` and the fictional simulator in `web/simulator/`; neither is a sensor runtime.

| Path | Purpose |
| --- | --- |
| `web/src` | Responsive requester/operator/verifier UI and platform adapters |
| `web/dist` | Generated browser assets, including the compiled Rust/WASM core |
| `code/crates/nonverba-core` | Rust challenges, ES256 identity, C2PA image/WAV sign/verify, acoustic DSP, watermark, and Rust tests |
| `code/crates/nonverba-android` | Internal JNI entry points for native sensor validation, DSP and C2PA/COSE signing |
| `code/android` | Kotlin platform adapters, C++ AAudio buffers and Gradle APK packaging |
| `code/tools` | Web builds, Android asset staging, local preview, and packaging scripts |
| `code/test` | JavaScript adapter and browser integration tests |
| `code/Cargo.toml`, `code/Cargo.lock`, `code/rust-toolchain.toml`, `code/package.json` | Build configuration and pinned dependencies |
| `code/target`, `code/dist`, `code/artifacts/qa` | Generated Rust builds, packaged releases, and QA results |
| `code/.tools` | Ignored local tooling and existing smoke-test material |
| `docs` | Audio/location protocols, security boundaries, validation records, and the managed container procedure |

On Android, **Keep screen awake** is an optional foreground development convenience on each workflow page. Enabling it starts a two-hour session retained across app restarts and updates on the same boot. Tap again to turn it off; expiry, reboot or clock inconsistency cancels it. It does not change Android lock settings or sensor timing/lifecycle rules.

## Build

The pinned Rust/WASM and Android toolchains run inside the managed Debian container. Use the [container guide](../development/CONTAINER_PLAN.md) and the [checkout migration procedure](../development/CONTAINER_MIGRATION.md). Android details are in [the Android package guide](../../code/android/README.md). Builds and caches remain inside container filesystems or named volumes, with deliberately exported outputs under ignored `code/artifacts/` paths.

The capture preview uses localhost or HTTPS. Its generated local review entry has the narrow annotation exception and is excluded from Android assets; production pages retain the strict CSP. Release signing keys, user evidence and credentials are not source assets.

## References

- [C2PA specification](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification)
- [C2PA Rust SDK 0.91.0](https://docs.rs/c2pa/0.91.0/c2pa/)
- [C2PA soft-binding algorithm registry](https://github.com/c2pa-org/softbinding-algorithm-list)
- [Android key attestation](https://developer.android.com/privacy-and-security/security-key-attestation)
