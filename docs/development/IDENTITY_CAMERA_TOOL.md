# Identity camera tool

The identity camera profile reuses the hardened Camera2 acquisition controller
with the developer camera. It produces a bounded, metadata-free JPEG and a
separate identity-purpose proof. The developer camera retains its own keys,
location/C2PA format and signing policy. Identity capture does not acquire GPS,
use the login key or turn the image into ordinary signed task evidence.

The participant keeps deliberate Start, shutter, review and Retake actions.
Android owns its camera preview and shutter in a native overlay; the browser
uses the inline video preview. There is no passkey setup or additional account
factor. An available native bridge must not silently fall back to browser
capture when it refuses. Document-file selection remains a separate import
path without camera provenance.

Native capture loses authority on every Activity pause, including a pause for
the Android camera-permission overlay. If that dialog pauses the Activity, the
attempt cancels; after granting permission, press Start again. The grant itself
must not resume a cancelled preview. Exact-document cancellation remains
available while paused, but key creation, capture start and result publication
require the foreground document. Actual OS-dialog behavior still needs a phone
check.

## Request and exact-byte proof

Before capture, the authenticated account asks for a fresh challenge using only
its current account/principal/session/recovery context, photo kind, source and
the dedicated capture public key. It sends no image or image hash. Challenge
issuance obeys the selected synthetic-only service policy. No camera result is
published if challenge acquisition or proof verification fails.

The closed original request contains:

| Field | Meaning |
| --- | --- |
| `version`, `purpose` | `1`, `identity-capture` |
| `challenge_id`, `nonce` | Independent canonical base64url 32-byte values |
| `account_id`, `principal_id`, `current_session_id`, `recovery_generation` | Authenticated context |
| `kind` | `document_front` or `face_front` |
| `source` | `native-camera2` or `browser-camera` |
| `public_spki_sha256` | Expected P-256 SPKI SHA-256, lowercase hex |
| `issued_at_ms`, `capture_expires_at_ms`, `submit_expires_at_ms` | Server times; capture within 120 seconds and submit within 900 seconds of issue |

The detached envelope is `{payload, public_spki_der_b64, signature_b64}`.
`payload` contains exactly the original `request`, final `image_sha256`,
`image_bytes`, `width`, `height`, `captured_at_ms`, `lens_facing` and
`acquisition`. Public key and raw 64-byte IEEE-P1363 signature use canonical
standard base64. The signature is P-256/SHA-256 over the UTF-8 domain
`NONVERBA:IDENTITY_CAPTURE:v1\n` followed by compact JSON of the unsigned payload,
recursively sorted by lexical field name. Numbers must be nonnegative safe
integers. Nanosecond counters are canonical decimal strings bounded to signed
64-bit range. Unknown fields are refused. The detached proof is at most 16 KiB.

Preparation happens **before signing**. The final JPEG is at most 2 MiB, with
document edges at most 2400 pixels and face edges at most 1280 pixels. The
workflow verifies its hash, byte length, dimensions, signature and expected
request before selecting it; it must preserve those exact bytes through review
and submission. A signed native image must never pass through the former
unconditional browser re-encoding step. The service independently decodes the
submitted JPEG, rejects hidden metadata and verifies the proof against its own
retained original request. Client verification is not service acceptance.

Native capture requires the rear lens for a document and front lens for a
face; a missing requested lens refuses. The controller owns Camera2 JPEG
acquisition, a deliberate shutter, matching image/result sensor timestamps,
bounded callback delivery, foreground/lifecycle cancellation, and requested
ZSL/test-pattern disabling with checked result metadata. The identity profile
normalizes orientation and strips metadata before signing. It accepts neither
JavaScript-supplied image bytes nor arbitrary signing payloads.

Native `acquisition` is a closed version-1 record with `timestamp_source`
(`realtime` or `unknown`), request/image/result elapsed-realtime counters,
sensor/image timestamps, requested ZSL/test-pattern disabling and nullable
reported ZSL/test-pattern results. Sensor and image timestamps must match;
receipt must follow request within fifteen seconds. A realtime sensor timestamp
must also fit that interval. Unknown timebase stays explicit. It includes no
camera identifier, location, device fingerprint or GPS assertion.

Browser capture normalizes the JPEG first, then signs with a separate,
nonextractable, identity-purpose software key in the current document. Its
`acquisition` is `null`; the reported lens is observed when available and
otherwise `unknown`. Browser proof cannot establish an honest camera stream,
unmodified page, trusted clock, physical lens or uncompromised browser/OS.

## Service acceptance and assurance

The service binds the challenge to the current authenticated context, photo
kind/source, key and original deadline. It checks both capture and submission
windows and consumes the challenge atomically with intake. Exact operation
retries retain their original receipt; changed input and cross-operation replay
must refuse. Key pinning during an authenticated challenge establishes only
which key that operation selected. It is not a hardware certificate or trusted
native-origin attestation. Native acquisition checks are signed application
claims, even when all structural and cryptographic checks pass.

Intake remains pending custody. No proof supplies document authenticity, face
recognition, liveness, identity/age/nationality verification, an identity badge
or work authority. File import has no camera assurance. The separate
[synthetic notice successor](IDENTITY_INTAKE_NOTICE_REVIEW.md#capture-proof-successor--23-october-2026)
discloses retained capture metadata while preserving v1 history. Its source pin
does not activate or reload the live service. Existing protected policy must
match the selected current notice before new challenges/intake are admitted.

Executed software and platform limits are recorded in
[validation](VALIDATION.md). Build or fixture success does not establish a
physical front/rear capture, orientation, permission or lifecycle result.
