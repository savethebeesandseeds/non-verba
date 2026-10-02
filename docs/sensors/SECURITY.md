# Evidence and trust boundaries

## Independent enrollment and position verification (0.5.0)

Android enrollment creates a new challenged Keystore identity for either media
(camera/audio) or location. It preserves earlier keys and records; identity
selection is explicit and affects later captures. A session freezes its selected
key and pin before acquisition. The enrollment bridge never exposes arbitrary
signing or private-key import/export. Native publication and signing remain gated
by revocable foreground authority and monotonic deadlines, including after key
lock waits. See [native enrollment](NATIVE_KEY_ENROLLMENT.md).

The separate Rust/WASM verifier validates a bounded Android certificate chain,
the requester's original challenge and arrival observation, actual SPKI, expected
app identity, locked verified boot, hardware security level, patch minimums,
certificate validity and current revocation inputs. Its Google profile requires
both a compiled recognized root and the verifier's independently retained
allowlist. Private test roots never establish hardware enrollment. Unsupported
certificate/authorization profiles fail closed; compatibility with all Android
phones is not claimed. The verifier does not fetch or authenticate transport for
the supplied trust data. See [attestation verification](KEY_ATTESTATION_VERIFIER.md).

The `appraise_*_with_context` APIs bind the independently revalidated enrollment
to the signer extracted from the actual verified artifact. A valid artifact
signature proves possession of that key. Composed camera/location evidence needs
both key enrollments to meet a required hardware policy. This concerns protected
key generation and its reported boot/app state at that time. It does not attest
a later app process, Camera2 frame, AAudio buffer, GNSS observation or physical
environment. Application identity remains Android-software-reported inside the
signed hardware extension. Base sensor reports keep their narrower flags;
the context appraisal reports the additional evidence separately.

Independent GPS position/receiver-clock recomputation is also implemented. It
requires the signed raw trace and separately retained, digest-pinned GPS LNAV
navigation data and policy. Every retained GPS L1 C/A epoch must solve without
using the operator's claimed coordinates as an initializer. Satellite clocks,
orbit propagation, Earth rotation, approximate atmosphere, geometry and residuals
are checked, and every reported fix must agree in position and time. This is a
mathematical consistency check, not authenticated location. It does not solve
velocity, authenticate satellite RF/navigation sources or certify the device's
clock. Consistently fabricated observations can still pass. The separate bounded
Rust/WASM [RINEX 3 GPS-LNAV importer](../../code/crates/nonverba-core/src/location_proof/position/importer/README.md)
normalizes an independently pinned source file into at most 128 records for an
independently supplied capture window. It retains the exact source digest and
produces a separate digest for the emitted navigation JSON. Importing or fetching
a file over HTTPS does not authenticate satellite signals or establish a trusted
provider; automatic provider integration remains absent. See the
[position profile](../../code/crates/nonverba-core/src/location_proof/position/README.md).

These capabilities satisfy agent requirements only when explicitly supplied and
verified through context. Local KeyInfo or raw-observation readiness alone cannot
satisfy them. Original challenges, enrollment expectations, app policies, trust
snapshots, navigation and pins belong to the requester; accepting their
authoritative values from the operator defeats these boundaries. Software test
and package/device validation status is tracked separately in [VALIDATION.md](VALIDATION.md).

## Native acquisition hardening (0.4.0)

The Android camera uses Camera2-owned JPEGs, exposure/image timestamp matching,
bounded sessions, disabled zero-shutter-lag/test-pattern requests and a separate
non-exportable Android Keystore media key. Rust checks native capture records,
five-second GPS freshness, C2PA and watermarking before output. Android audio
uses separate pilot/evidence AAudio streams, owned continuous PCM, built-in routes,
unprocessed input, successive requester nonces and bounded hardware frame/time
checkpoints. Neither media bridge accepts image/audio bytes or arbitrary signing
messages. Kotlin is platform glue; protocol, DSP and verification remain Rust,
with C++ handling realtime AAudio buffers.

Raw GNSS can be mandatory in standalone or composed location requests. Receiver
clock, measurement state, uncertainty, satellite diversity, chronology, coverage
and final freshness checks are signed and independently re-evaluated. That basic
raw-readiness layer does not authenticate RF signals or recompute position; the
separate 0.5 position verifier above performs the additional mathematical checks.

Native metadata is a signed app claim. Local Keystore security levels and
timestamp counters do not prove an honest OS. A separately verified key enrollment
does not extend its key-generation claims to those later measurements.
The audio xrun count may under-report hardware loss; its reporting completeness
is explicitly unknown. Camera UNKNOWN timebases cannot establish exposure-to-
elapsed-realtime correlation. Requester policies can reject missing capabilities
through the Rust agent appraisal APIs. See [agent appraisal](AGENT_EVIDENCE.md),
[native camera](NATIVE_CAMERA.md) and [native audio](NATIVE_AUDIO.md).

Live location pairs before generating its sensor challenge. The requester retains
the exact signed request, records complete proof arrival before hashing, verifies
the proof and signs a COSE receipt. Both requester and operator pins are independent
inputs; included public keys cannot establish trust. Session and sensor challenge
identifiers are reserved together before transmission; acceptance is local and
atomic. Signed timing remains a requester assertion. See [live sessions](LIVE_SESSIONS.md).

## Independent location extension (0.3.0)

Location has its own Rust policy/types/COSE module, reusable collection adapter and standalone UI. Its exact requester challenge, bounded sampling policy, context, trace and optional final-JPEG hash are signed with COSE_Sign1 ES256. Verification requires a separately trusted SPKI fingerprint. Native Android sessions own coordinates, measurement times, mock flags and trace finalization; the WebView cannot submit these fields to the native signer. A separate Keystore key signs only the internally assembled evidence. Browser proofs remain software claims with mock status unknown. See [the location protocol and composition boundaries](LOCATION.md).

Combined camera requests bind the exact location request into C2PA and require an external location proof hashing the complete final JPEG. Both pins and signatures must pass; selected trace GPS must equal the camera assertion and EXIF. Omitting the required proof cannot turn a version 3 photo into an accepted legacy record. The location module receives the final JPEG through its coordinator and does not attest its camera origin; the camera module supplies its separate acquisition assertion. Older photo/audio software identities are preserved; new native media uses a separate enrolled certificate pin.

Freshness, sample ordering, motion and uncertainty checks catch inconsistent records and common replay/mocking errors. They do not establish physical presence or defeat a compromised OS or RF spoofing. The base location verifier's native-profile and local Keystore labels do not establish remote attestation. Collection attestation, authenticated physical location and trusted clock remain false even when the separate context verifier validates a hardware key enrollment or independently recomputes position. No Play Integrity service or deployed attestation backend is included; the independent attestation verifier can run in Rust or WASM. Foreground cancellation and bounded collection prevent continued tracking after the session ends; sharing a proof intentionally discloses its recorded trace.

## Live audio extension (0.2.0)

The microphone workflow uses separate Rust modules and a separate UI. An independent requester generates fresh per-round CSPRNG nonces after receiving prior actual PCM chunks; the operator records continuously and responds through its speaker. C2PA signs the complete lossless WAV, request and transcript. Verification needs the requester's independently retained original transcript and the expected operator key. Detection is recomputed from the final PCM. See [the audio protocol and full trust boundaries](AUDIO.md).

Audio is transmitted directly to the paired requester over an encrypted WebRTC data channel. Manual offer/answer exchange must use a trusted channel; this is not account authentication. No third-party signaling/STUN/TURN or public relay is configured. The preview requires directly reachable peers, usually on the same LAN. Requester receipt timestamps are local observations, not certified timestamps. The operator's local signing key does not attest the microphone, and real-time digital mixing or external sound replay remains possible.

The acoustic profile, detector thresholds and fixed timing budgets are experimental. Browser automation uses an explicitly synthetic speaker/microphone path and cannot establish device compatibility or inaudibility. Capture requires successful on-device acoustic recovery, reported raw48kHz settings, foreground operation, uninterrupted sample counts, bounded ordered challenges, and timely receipts. No fallback weakens the verdict on unsupported devices. The audio requester stores receipts separately from camera history; incomplete sessions do not produce completed signed evidence.

## Signed evidence

The requester generates 32 random nonce bytes using the operating system’s CSPRNG (WebCrypto in WASM). Challenge IDs are the nonce in canonical hex; the nonce is also present in canonical base64url. Rust rejects inconsistent encodings, unknown fields, empty requester/task text, oversized JSON, impossible time windows, future challenges, and expired capture attempts.

Signing binds the exact normalized challenge, capture assertion, and watermarked JPEG through the C2PA SDK. The SDK handles JPEG manifest embedding, asset-hash exclusions, COSE encoding, and validation. ES256 device keys are unique; no shared test key is packaged. Verification extracts the actual leaf certificate from the signature, hashes its DER, and compares it with the externally supplied fingerprint and the signed assertion.

The extra `watermarked_jpeg_sha256` is a signed digest of the JPEG before C2PA embedding. It is not the SHA-256 of the final manifest-containing file. C2PA’s standard hard binding validates that final exported asset with the manifest exclusions required by the standard. Acceptance receipts separately record the SHA-256 of the complete received file.

## Freshness and replay

An unpredictable requester nonce gives a lower bound on creation of a signature that binds it. The device's capture clock and physical camera path are not attested by that signature or by key enrollment. The native controller owns the acquired JPEG and will not accept imported bytes through its bridge, which restricts ordinary app misuse. A malicious client with signing authority can still sign old media after receiving a new nonce; the signature alone cannot exclude that attack. Photographing a screen or staging a scene also remains possible with an honest camera app.

The verifier always needs the original expected challenge and a previously trusted device fingerprint. It never establishes identity by trusting the key bundled with the photo alone. Requester labels are free text; importing a challenge does not authenticate a requester account.

Historical verification and fresh acceptance differ. Verification checks the claimed capture timestamp against the original window. Acceptance must occur on the requester’s clock before challenge expiry and atomically insert a receipt into a local unique-key ledger. Duplicate acceptance is rejected even across concurrent tabs sharing that ledger. Other browsers/devices do not share it. Clearing browser or app data clears the ledger.

The operator also atomically reserves a challenge before signing. Reuse in this profile/installation, including retries after a signing failure, requires a new challenge. This prevents accidental or concurrent local reuse; it does not stop a modified client or another device from using the same challenge. The requester ledger remains the authority for acceptance.

## Metadata-only camera location

Capture requests a fresh foreground position before camera activation and again immediately before taking the frame. There is no background location permission, operator-entered coordinate override, or separate location-history database. Missing/denied/unavailable location fails closed before the challenge is reserved. Pending callbacks are discarded after navigation, backgrounding, expiry, or a different capture operation.

Coordinates and reported accuracy are visible before export and included in both EXIF GPS and the signed capture assertion. Rust validates coordinate ranges and timing: the fix must follow the challenge and be at most 30 seconds old for browser capture, or five seconds old at native acquisition. The second-granularity capture field retains a bounded future-rounding allowance; it is not a trusted-clock claim. Native acquisition also checks monotonic freshness separately. EXIF is inserted after pixel watermarking and before hashing/signing, so metadata alteration invalidates the C2PA image binding. Requiring a composed location proof adds its separate native collection, signature and final-JPEG binding; it does not turn EXIF into independently trusted GPS.

Device geolocation is not independent proof of physical presence. The browser/platform may return GPS, fused/network, approximate, or spoofed positions. Accuracy is retained rather than pretending all fixes are equally precise. `location_authenticity_proven` remains false; no reverse geocoder, external map embed, or app-level location upload is used. OS/browser location providers may use their own network positioning services.

## Key custody

The browser stores an AES-GCM-encrypted identity envelope in IndexedDB and a non-extractable WebCrypto wrapping key. Its signing key remains available to Rust/WASM during use. The separate live requester identity uses the same software-custody model. Android preserves its older wrapped software identity and location key; native camera/audio use a separate non-exportable Keystore media identity. Challenged enrollment can create additional immutable identities for either purpose; explicit pin-based selection controls future captures. StrongBox is preferred when available, with restricted fallback and actual local KeyInfo reporting. Missing or mismatched records fail instead of replacing a key. None of these mechanisms attests the entire sensor pipeline or protects against all compromised-app/OS behavior.

The C2PA media certificate and Android attestation chain serve different purposes. C2PA's certificate pin binds the media identity; the separately validated Android chain can establish protected enrollment of that same SPKI. This does not promote the media certificate to a public C2PA trust-list credential, certify freshness or attest the image sensor pipeline. Production operation still needs an operator-account/enrollment policy, maintained trust/revocation inputs, and compatible trusted C2PA issuance if public ecosystem trust is required. A development APK signer policy is not a production identity policy.

## UI and platform boundary

All content is bundled. Production CSP allows local scripts and WASM compilation, forbids inline script, frames, remote connections, and object embeds. User strings use text nodes. The browser adapter passes frames from `getUserMedia` to Rust; there is no photo-import option in the operator capture path. Verification and challenge import use explicit file inputs.

The Android WebView only serves allowlisted assets at its internal HTTPS origin, denies remote navigation and network requests, and grants camera access only to that origin while visible. Kotlin contains permission, secure-storage, picker, and file-export glue. The bridge has no arbitrary file read/write, shell, network, or signature API. Export filenames and MIME types are constrained. Save writes an exact byte-checked copy to Downloads/Non-verba on Android 10+, using a new pending MediaStore entry that is published only after completion. Android 8-9 use app-specific external Documents without broad storage permission; those files are removed on uninstall. Older exports are preserved. Save does not launch a share sheet or grant another app access. Explicit public cache copies remain available to the bounded USB retrieval helper.

Camera operation generations invalidate pending permission requests after navigation, backgrounding, expiry, or another operation. Capture and verification generations prevent stale asynchronous results from being assigned to new inputs. Acceptance uses an immutable report snapshot and atomic database insertion.

## Watermark

The repeated DCT QIM packet contains a lookup identifier and CRC, not a secret or signature. CRC catches accidental decoding errors; an attacker can forge a watermark. Successful recovery from an edited file never changes an invalid C2PA verdict. The algorithm does not survive all transformations and has no deployed resolution service.

## Resource and privacy limits

Input JPEGs are capped at 32 MiB; watermark decoding also bounds pixel dimensions and decoder allocations. Browser camera output is normalized through canvas and capped at 1600 pixels on its longest edge. Images, identities, and challenge records are processed locally. There is no telemetry, photo upload, requester backend, account authentication, or public publication in this implementation.
