# Independent location evidence

Location is a separate proof workflow. Open **Location proof** to request, collect, export or verify it without opening the camera or microphone. **Try demo** uses this device's actual location provider and needs no operator ID. The request and proof explicitly carry `demo: true`; this is not an independent requester.

## Standalone use

1. The requester creates and saves the original location request. Its unpredictable challenge, policy and optional application context are signed together; changing any of them invalidates verification against the original.
2. The operator imports the request, grants location permission and keeps the app visible while collecting. The new raw requester preset needs distinct fresh measurements spanning at least two seconds, at least three samples and reported horizontal accuracy of 100 m or better. Identical coordinates are allowed; repeated measurement timestamps do not count as new observations.
3. The operator exports a JSON envelope containing a standard COSE_Sign1 ES256 proof. The verifier supplies that file, the original request and a location key ID previously obtained through a trusted channel. The key bundled inside the proof alone is not a trusted identity.

The standalone page checks historical integrity and policy. It does not implement a requester acceptance service or share an acceptance ledger between devices. Applications composing this module must separately decide when to accept a request and prevent duplicate acceptance. Native and browser operator ledgers reserve location challenges before signing; a failed signing attempt requires a new request. Collection or permission failures before reservation can be retried.

## With a camera proof

New camera requester forms default to **Android raw satellite measurements + photo**. Standalone and live location forms also default to required native raw measurements with a two-second minimum observation window. Reduced ordinary/browser traces, Android GNSS traces and photo GPS-metadata-only profiles remain explicit choices inside **Details and reduced profiles**. Existing requests retain their original policy. See [complete sensor packages](COMPLETE_SENSOR_PACKAGES.md).

**Android raw satellite measurements + photo** adds the raw receiver policy below to the same independent location module. It exports the same JPEG and location sidecar pair; the raw observations are inside the signed sidecar. It does not change how the camera acquires its pixels.

New camera requests explicitly set context.camera_timing to concurrent. Location collection starts alongside the preview. At the shutter, one fresh observation is selected for the photo; the remaining sampling window can finish after exposure and camera closure. The selected observation is written to EXIF and the signed C2PA assertion. Old requests without that mode retain collection-before-photo and final-observation selection. Version 3 of the camera assertion includes the exact original location request. Finally the location record signs the SHA-256 of the complete, exported C2PA JPEG.

Export **both** the JPEG and the location proof JSON. Verification requires both files, the original combined request, the photo certificate fingerprint and the location SPKI key fingerprint. The verifier checks the final JPEG digest, the exact request, both signatures and pins, and equality of the photo observation with a retained trace sample and EXIF (the final sample for legacy requests). There is no circular hash: the location proof is not embedded back into the JPEG it hashes. A version 3 JPEG cannot pass the legacy verifier on its own. Earlier photo versions remain readable.

The two key IDs use different pin formats: the existing photo key ID hashes a signer certificate; the location key ID hashes a DER SubjectPublicKeyInfo. In a browser the same existing software signing key is reused with the separate SPKI pin. Android location uses a separate Android Keystore P-256 key, leaving existing camera/audio identities intact.

The native location session accepts bounded final JPEG bytes from the WebView for asset binding. That location-signing boundary does not itself establish camera exposure or pixel origin: `application-submission-interval` describes submission timing. The current APK separately acquires the image through Camera2, signs its native acquisition assertion with the selected media key, and verifies that assertion during composition. Browser capture retains its browser acquisition profile. See [native camera acquisition](NATIVE_CAMERA.md).

## Policy and source boundaries

New raw requester preset: at least two seconds and three distinct samples/epochs; low-level omitted policies, reduced profiles and demos remain ten seconds. All presets retain accuracy at most 100 m, fix age at most five seconds, delivery delay at most three seconds and motion at most 100 m/s after accounting for reported uncertainty. Requesters can use the bounded Rust policy interface to choose supported values. Collection has a sixty-second total budget, including acquisition and permission delay on Android. A slow or unavailable provider produces an error, not fabricated observations.

Android can prepare its GPS receiver on foreground camera/location pages using
existing precise permission. The five-minute preparation subscription discards
every fix; each request still collects fresh evidence. The UI reports an active
subscription, not a verified fix. See [GPS preparation and short observations](GPS_PREPARATION.md)
for lifecycle, observation minimums and timing limits.

New UI requests include a separate signed finalization allowance of at most thirty seconds from the frozen collection end. Their last fix must satisfy the requested age limit at that collection end; requests without the allowance retain the original last-fix-to-seal rule. If photo processing or signing exceeds the original request's limits, the app refuses to sign/export the combined proof; after a signing reservation, retry with a new requester challenge. See [separate collection freshness and finalization](#separate-collection-freshness-and-finalization--29-september-2026).

| Signal | Browser | Android native |
| --- | --- | --- |
| Collection owner | Browser Geolocation API adapter | Native session/controller |
| Fix time | Provider wall-clock timestamp | Provider wall clock plus monotonic elapsed-realtime timestamp |
| Delivery check | Local callback timing vs reported fix | Monotonic fix vs callback timing |
| Mock indication | Unavailable; explicitly unknown | OS mock flag; detected mock location is rejected |
| Provider | Browser geolocation, underlying provider unspecified | Reported GPS/network/fused; GNSS policy requires GPS |
| Permission precision | Browser-defined | Precise foreground location required |
| Horizontal uncertainty | W3C 95% semantics | Android 68% semantics |
| Signing | Existing software key in Rust/WASM | Separate Android Keystore key, invoked internally by Rust JNI |
| Raw satellite observations | Unavailable; a required request is rejected | Optional strict receiver profile on capable Android 10+ devices |

Browser collection combines `watchPosition` with at most one outstanding, uncached request per second so stationary devices can deliver fresh timestamps. Native collection never accepts coordinates, timestamps, source profiles or arbitrary signing payloads from JavaScript. A session owns its trace through validation and finalization. A present but failed native bridge does not fall back to browser collection. Native-required requests cannot be satisfied by browser records.

Navigation, backgrounding, permission loss, timeout or cancellation stops collection. The native session permits only one finalization, persists its nonce reservation, and checks foreground/session state before invoking the capture key. The native ledger is bounded to 4,096 reservations and fails closed when full; clearing app data removes both its ledger and key, requiring re-enrollment. Observations are kept in session memory and the exported proof, not an added location-history database.

## Raw satellite measurement profile

For standalone collection, choose **Android raw satellite measurements required** in the requester form. The resulting request requires the native GPS provider, precise foreground permission and a mandatory `policy.raw_gnss` object. A browser can create the request and verify the exported proof, but cannot collect it. An Android app cannot satisfy it using coordinate-only evidence. Existing requests without `raw_gnss` retain their previous behavior.

The default raw policy is:

```json
{
  "version": 1,
  "mode": "required",
  "min_epochs": 3,
  "min_satellites": 4,
  "max_epoch_gap_ms": 2500,
  "max_time_uncertainty_ns": 100000,
  "max_elapsed_realtime_uncertainty_ns": 100000000,
  "max_pseudorange_rate_uncertainty_mps": 20
}
```

An epoch is one native receiver measurement event. The native adapter retains events at a one-second target cadence, allowing 50 ms of scheduling jitter. This selection depends only on measurement time, never on which event has better signals. Actual retained epochs must span the full requested location duration; new raw requester forms select a two-second minimum; old requests and low-level omitted policies keep their original ten seconds. Multiple frequencies or codes from the same satellite do not count as multiple satellites.

The signed raw record preserves receiver clock time and full bias, available fractional bias/drift and their uncertainties, clock discontinuity count, hardware elapsed-realtime alignment and uncertainty, and native callback receipt time. Each satellite signal carries constellation/SVID, synchronization state, received satellite time and uncertainty, time offset, signal strength, pseudorange rate and uncertainty, and available frequency, code type, accumulated delta range and gain information. Integer nanosecond fields are canonical decimal strings, preserving Android's 64-bit values through JSON and JavaScript.

Rust checks the same record before signing and during independent verification. Checks cover bounds, ordered epochs, distinct qualifying satellites, required signal synchronization and uncertainties, receiver-clock continuity, monotonic alignment with the native session, delivery delay, trace coverage and finalization. The last raw epoch and last location fix must satisfy the original request's freshness rule at collection end or sealing, according to its signed finalization policy. Photo fix-to-exposure limits remain separate. The verifier exposes individual results and error codes; a passing signature alone does not satisfy the requested policy.

During receiver warmup, missing mandatory clock fields or insufficient qualifying satellites can be rejected and counted before the first retained epoch. The coordinate trace begins only after that first accepted raw epoch. After collection begins, losing mandatory fields, satellite eligibility or clock continuity fails the session. A missing stream, inadequate coverage or unsupported receiver cannot produce a completed raw proof. The sixty-second session budget includes this warmup.

The APK still installs on Android 8+; this additional profile requires Android 10/API 29 or later and a receiver that provides full clock bias, elapsed-realtime timestamps and their uncertainty. Android 12/API 31+ requests full tracking to reduce duty cycling; the signed `full_tracking_requested` field records the request, not confirmation that the receiver complied. Earlier supported devices can fail the strict continuity policy if their receiver duty cycles. The app uses AndroidX's callback compatibility path on Android 10/11. It does not change system developer settings.

Records are bounded to 64 epochs, 128 signal measurements per epoch, 4,096 rejected warmup events and 2 MiB of trace/evidence JSON; a COSE proof is bounded to 2 MiB plus 16 KiB. Overflow fails explicitly rather than truncating observations. These are resource limits, not evidence-quality targets. The native adapter unregisters both location and raw callbacks at ready/freeze, cancellation, error, timeout and lifecycle interruption.

The base raw-measurement verifier provides a signed consistency record. It does not retrieve navigation messages, authenticate Galileo OSNMA, recompute position or establish that the radio input was genuine. Its report continues to leave `satellite_authentication_verified`, `independent_position_recomputed` and `collection_attested` false. Version 0.5 adds the separate position verifier below; passing the base raw policy alone does not run or satisfy it. A compromised runtime can still fabricate mutually consistent inputs. Physical receiver compatibility and adversarial performance remain to be measured on phones.

## Independent position and enrollment context

Version 0.5 exposes `verify_location_position` in Rust and WebAssembly. It first
re-verifies the signed location proof, original request, expected key and optional
JPEG binding, then recomputes every retained supported GPS L1 C/A epoch from its
code observations and separately supplied GPS LNAV ephemerides. It solves position
and receiver clock bias and checks geometry, residuals and agreement with every
reported location fix. The operator's coordinates are not used to initialize the
solution. This profile does not solve velocity or use other constellations as
silent substitutes.

The verifier must independently obtain navigation data and the GPS/UTC offset;
its position policy pins the SHA-256 of the exact navigation JSON bytes. The
separate Rust/WASM [RINEX 3 GPS-LNAV importer](../../code/crates/nonverba-core/src/location_proof/position/importer/README.md)
accepts an independently pinned source and capture window, retains its exact
source digest, and emits at most 128 applicable GPS ephemerides with the JSON
digest needed by the policy. Mixed files disclose skipped non-GPS records. There
is no automatic navigation fetcher or authenticated navigation service. Source
labels, byte pins and HTTPS retrieval do not authenticate satellites. A successful
separate position report can establish `independent_position_recomputed`, but
cannot authenticate satellites, radio input, physical location or the device
clock. See the [position profile and schema](../../code/crates/nonverba-core/src/location_proof/position/README.md).

The separate Android enrollment workflow creates a challenged signing identity
for the location purpose. New challenges create additional immutable v3
generations, with at most 32 preserved slots per purpose; previous v1/v2 identities
remain intact. Choosing a new capture identity is explicit, and a capture freezes
its selected key pin at session start. The requester independently validates the
enrollment challenge, certificate chain, trusted roots, current revocation
snapshot and app/hardware policy. These checks describe key generation, not the
current collector or later measurements.

Agents can use `appraise_location_with_context` or
`appraise_camera_location_with_context` to rerun the corresponding enrollment and
position checks alongside the actual sensor proof. Attestation must bind to the
artifact's exact signer; a combined photo requires both the media and location
keys when hardware enrollment is required. Neither a locally displayed Keystore
label nor an operator-supplied successful report substitutes for these checks.
See [agent evidence requirements](AGENT_EVIDENCE.md),
[key attestation verification](KEY_ATTESTATION_VERIFIER.md) and
[native enrollment](NATIVE_KEY_ENROLLMENT.md).

## GPS raw measurements and ephemeris consistency

Non-verba reads the Android receiver's raw GNSS measurement records, including
receiver-clock and satellite-signal timing. It does not directly sample radio
waveforms or export the pseudorandom noise (PRN) code chips. The receiver tracks
each satellite's code; its timing observations let the verifier derive a
**pseudorange**, a propagation-time measurement expressed as distance that also
contains clock offsets, propagation effects and measurement error. GPS L1 C/A
codes are public, deterministic, repeating sequences. Neither the code nor the
pseudorange is a fresh random secret per measurement. See
[Android raw GNSS measurements](https://developer.android.com/develop/sensors-and-location/sensors/gnss)
and [IS-GPS-200N, sections 3.3.2.3 and 20.3.3](https://archive.gps.gov/technical/icwg/IS-GPS-200N.pdf).

The independent consistency check uses **broadcast ephemeris and satellite-clock
parameters**: the navigation data needed to calculate satellite positions and
clock corrections for the measurement time. The verifier independently supplies
and pins that data, derives the pseudoranges from the retained observations, and
solves receiver position plus a common receiver-clock bias. Multiple satellites
must agree within the selected geometry, uncertainty and residual limits, and
the solution must agree with the signed location fixes. This checks mathematical
consistency against independently selected navigation data, beyond accepting
the operator's reported coordinates.

This agreement can expose inconsistent observations or false coordinate claims,
but it is not satellite or physical-location authentication. A spoofer need not
forge orbital data: genuine public ephemerides can be reused to construct
observations consistent with a false receiver position. A compromised collector
can likewise fabricate mutually consistent records. Published
[GPS signal-simulator documentation](https://github.com/osqzss/gps-sdr-sim)
demonstrates deriving simulated ranges from broadcast ephemeris. The current
profile does not establish that defeating it is expensive or that attack cost
exceeds validation cost.

Ephemeris suitability is evaluated for the **capture time**, including health,
fit interval, orbit/clock reference age and transmission time. The current
profile supports the ordinary four-hour fit interval with additional age checks;
see the [exact position-profile limits](../../code/crates/nonverba-core/src/location_proof/position/README.md#inputs-and-trust-boundary).
New captures need applicable navigation data; historical verification needs the
retained data applicable to those original observations. No automatic navigation
refresh or authenticated provider integration is implemented.

The receiver already performs signal tracking, but independent validation still
propagates satellite orbits, applies clock, Earth-rotation and approximate
atmospheric corrections, and iteratively solves position and clock bias. This is
bounded numerical work, not merely a few arithmetic operations per satellite.
Capture, navigation acquisition and signature checks also have costs. Runtime,
battery use and adversarial cost require measurements; ephemeris freshness is
one operational dependency, not the only cost. See
[computation and acceptance](../../code/crates/nonverba-core/src/location_proof/position/README.md#computation-and-acceptance)
and the [security design record](../SECURITY_DESIGN_RECORD.md#additional-properties-to-review).

## What verification establishes

COSE provides standard signature packaging; the location schema is a versioned Non-verba application payload. C2PA remains the standard photo/audio provenance layer. Verification checks integrity, the independently pinned signer, exact request and optional file binding, and internal consistency of the recorded policy and observations.

It does **not** authenticate satellites or physical location. A modified browser, compromised Android runtime or GNSS spoofing can still provide false measurements. The base location report keeps `hardware_attested`, `collection_attested`, `location_authenticity_proven` and `clock_trusted` false. Separate signer-bound attestation context can establish supported hardware key enrollment, but its claims apply at key generation and do not attest the current app, OS, collector or sensor. Native source fields remain signed application claims, even when that signing key has independently verified enrollment.

No Play Integrity service, carrier/Wi-Fi corroboration, authenticated external beacon or trusted clock is included. The independent key-attestation and position algorithms require requester-maintained trust/navigation inputs, and physical phone validation remains pending. OS/browser providers may use their own positioning services; Non-verba adds no location upload, map service or background location permission. Sharing the proof discloses its coordinate trace, timing and any requested raw receiver observations.

## Code boundaries and extension points

| Module | Responsibility |
| --- | --- |
| `code/crates/nonverba-core/src/location_proof/` | Strict types, policy, COSE sign/verify, identities, asset hashes and tests |
| `code/crates/nonverba-core/src/location_proof/raw_gnss.rs` | Versioned raw receiver schema, bounds and deterministic consistency policy |
| `code/crates/nonverba-core/src/location_proof/position/` | Separate GPS L1 C/A position/clock recomputation against verifier-pinned LNAV data |
| `code/crates/nonverba-core/src/android_attestation/` and `agent_appraisal/context.rs` | Independent key-enrollment verification and binding to the actual location/media signer |
| `code/crates/nonverba-core/src/camera_location.rs` | Composition checks between existing C2PA camera evidence and the independent location record |
| `web/src/location-capture.js` | Reusable begin/finalize/collect orchestration with cancellation |
| `web/src/location-platform.js` | Native bridge transport, platform identification and proof envelope |
| `web/src/location-ui.js` | Standalone requester/operator/verifier UI |
| `web/src/camera-location.js` | Camera request wrapper and proof import/export |
| `code/android/.../NativeLocation.kt` | Android callbacks, session ownership, foreground permission and replay reservation |
| `code/android/.../RawGnssCollector.kt` | Native receiver callback registration, extraction, cadence and teardown; no signing interface |
| `code/android/.../LocationCaptureKey.kt` | Internal Keystore signing callback |
| `code/android/.../NativeAttestedKeyStore.kt` | Preserved challenged key generations and exact-pin export/selection/signing |
| `code/crates/nonverba-android/` | Narrow JNI adapter into the same Rust validator and COSE implementation |

`beginLocationCollection()` returns a frozen selected fix and an opaque collection handle. A caller can obtain media, then pass its final bytes to `finalizeLocationProof()`. `collectLocationProof()` is the standalone convenience interface. Native observations remain in the native session; browser traces remain private to the module. Callers own their UI and acceptance policy, and must reserve a browser challenge before finalization.

The current asset binding accepts JPEG. The request context already supports a session ID and purpose for future composition, but attaching location to WAV/audio or another media format requires an explicit schema/binding extension and corresponding verifier; that integration is not present yet.

See the [exact protocol/API contract](../../code/crates/nonverba-core/src/location_proof/README.md) and [validation record](VALIDATION.md).


## Separate collection freshness and finalization — 29 September 2026

New UI location requests, camera location requests and local demos explicitly set
max_finalization_delay_ms to 30000. The user approved this allowance. It is an
optional signed requester-policy field, accepted from 1 to 30000 milliseconds.
An agent can choose a shorter bound in its original request.

max_fix_age_ms continues to govern measurements during acquisition and the last
ordinary fix/raw epoch at the frozen collection end. max_delivery_delay_ms
continues to limit provider-to-collector delay. The new field bounds collection
end to location seal entry; Android additionally enforces it during signing
authority checks and before releasing its result. Wall/monotonic clock checks,
challenge expiry, permissions, foreground authority and nonce consumption remain
in force. Camera fix-to-exposure checks and independent requester receipt
deadlines are separate.

Absence of the new field preserves the old last-fix-to-seal rule exactly,
including existing signed records and API requests using the legacy default
policy. Old clients may reject the new policy field; they must not discard it.
The original request is required for verification: the operator cannot relax
its allowance by changing the returned record. No timestamp is rewritten.

The existing signed sealed_at_ms is sampled at seal entry. Subtracting the signed
trace ended_at_ms reports the claimed delay to that entry, not signing duration,
network delivery latency or an independent clock measurement. Android's later
unsigned phase diagnostics remain diagnostic only.

The unused retained-JPEG handoff experiment was removed. This change uses the
existing separate camera and location modules and signing keys. It does not
establish physical location authenticity or resolve this phone's rejected raw
GNSS observations. The measured historical 7400 ms run used the old request and
remains rejected; the new policy does not retroactively reclassify that result.

Concurrent composition reports the matched sample as location_proof.camera_observation. Later movement remains visible in the trace and does not replace photo GPS. The standalone selected_location field continues to describe the final trace observation. A fresh first fix is required before exposure; an unknown location is never filled in from a later fix. The app must remain in the foreground until completion; this change adds no background-location service or permission.
