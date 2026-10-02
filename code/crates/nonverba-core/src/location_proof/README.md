# Location proof protocol v1

This module supports independently requested location evidence and optional
binding to the SHA-256 of a completed JPEG. It is separate from the camera's
existing certificate identity and from C2PA image verification.

`verified` means the COSE signature, independently retained request, pinned key,
requested collection policy and optional asset digest match. It does **not**
establish physical location, honest clocks, sensor origin or hardware attestation.
`hardware_attested`, `collection_attested`, `location_authenticity_proven` and
`clock_trusted` are always false in protocol v1. `native-android` and
`android-keystore` are signed source claims, not remotely verified attestation.

## Format and identity

The artifact is standard CBOR-tagged COSE_Sign1 (tag 18, RFC 9052), built with
coset. Its protected headers contain ES256, content type
`application/vnd.nonverba.location-proof+json`, and `kid` equal to the 32-byte
SHA-256 of the canonical DER P-256 SubjectPublicKeyInfo. Unprotected headers are
empty. External AAD is empty. The attached payload is UTF-8 JSON encoding of the
fixed `Evidence` struct in declaration order. The exact payload bytes, not a
reconstructed JSON value, are verified. COSE's signature is 64-byte `r || s`;
the native callback may provide DER, which Rust checks and converts.

The public pin is lowercase hex SHA-256 of SPKI DER. It differs from the photo
certificate pin even when the browser uses the same software key. Native uses
its dedicated Keystore key. Public SPKI bytes are included inside the signed
payload; the verifier must also receive a separately trusted expected pin.

All protocol structs reject unknown and duplicate JSON fields. Request JSON is
bounded to 64 KiB, trace/evidence JSON to 2 MiB, and proof bytes to 2 MiB + 16 KiB.
Array counts are also bounded while deserializing. Float coordinates/uncertainties must be
finite. Times are nonnegative integer milliseconds within JavaScript's exact
integer range. WASM API `now_secs` uses integer Unix seconds as a JS Number.

## Request and collection

`Request` contains `version:1`, `type:"nonverba-location-request"`, the existing
camera `Challenge`, optional `context:{session_id,purpose}`, policy, and a durable
`demo` flag (absent means false). The complete expected request, including policy,
context and demo flag, must match during verification.

Default policy: profile `browser-or-native`, required provider `any`, duration
10,000 ms, at least three samples, maximum accuracy radius 100 m, fix age 5,000 ms,
native callback delivery delay 3,000 ms, and motion allowance 100 m/s plus the
two adjacent uncertainty radii. Duration is configurable from 5 to 15 seconds,
or 2 to 15 seconds when raw GNSS is explicitly required. Short raw requests
still need at least three fixes and three epochs, actual uncertainty-budgeted
coverage and all existing quality/continuity checks. New requester forms select
the two-second raw minimum; the omitted Rust default remains ten seconds.
`native-required` and provider `gnss` constrain signed source claims; they do not
convert them into remote attestation. `gnss` requires native samples from `gps`.

`Trace` contains the complete request; `profile`; `permission_precision`;
`uncertainty_semantics`; `capture_correlation`; `started_at_ms`, `ended_at_ms`,
`elapsed_ms`; and ordered `samples`. Maximum collection time is 60 seconds and
maximum sample count is 128. Both first-to-last distinct fix timestamps and
callback elapsed timestamps must span the requested duration. Waiting with a
cached fix does not satisfy collection. Warmup before the first fresh fix is
allowed within the overall 60-second bound. The last sample is the standalone selected fix. Camera requests may explicitly
set context.camera_timing to concurrent, allowing the photo to use an earlier
fresh sample while the remaining trace completes. Composition checks exact
photo GPS/EXIF membership and freshness at exposure and reports camera_observation;
old requests retain final-sample-only binding.

Each `Sample` has `sequence`, `observed_elapsed_ms`, `fix_timestamp_ms`,
`fix_elapsed_ms`, `provider`, `latitude`, `longitude`, `accuracy_m`, `altitude_m`,
`altitude_accuracy_m`, and `mock`. Altitude fields are nullable and refer to the
provider's ellipsoidal altitude, not an EXIF sea-level conversion.

Browser uses profile `software-browser`, precision `browser`, uncertainty
`w3c-95-percent`, provider `browser-geolocation`, and null `fix_elapsed_ms`/`mock`.
The browser sealing entry rejects native profiles. Native uses `native-android`,
precision `fine`, uncertainty `android-68-percent`, provider `gps`, `network` or
`fused`, and explicit `mock:false`. Native fix/callback elapsed timestamps are
relative to the same native challenge receipt anchor; fix elapsed must be
positive and no later than the callback. Native monotonic fix age/delivery and
the correspondence of native fix time to wall time are checked independently.

Every sample's freshness is evaluated at its own callback. The selected fix must
follow collection start; browser delivery delay is bounded using the reported
wall timestamp, whereas native uses the independent elapsed fix timestamp.
The selected fix must
also satisfy the requested age at collection end and proof sealing. Sealing a
frozen trace after this bound fails; callers must collect again or explicitly
request a suitable policy. The wall/elapsed clock consistency tolerance is one
second. Collection and sealing must be inside the challenge lifetime. Historical
verification evaluates age at the recorded sealing time, not the verifier's
present time, but rejects evidence dated in the future.

## Optional raw GNSS profile

`Policy.raw_gnss` and `Trace.raw_gnss` are absent in legacy v1 proofs. Their absence
continues to serialize identically; old proofs remain readable. Each present raw
object has its own `version:1`. Older strict verifiers reject the new field rather
than ignoring the additional mandatory policy. A present raw policy only supports
`mode:"required"` and requires `native-required` plus `required_provider:"gnss"`.
Browser, absent measurements, and unrequested raw attachments fail closed.

`RawGnssPolicy` defaults to at least three epochs and four distinct qualifying
satellites per retained epoch, a maximum 2,500 ms epoch gap, 100,000 ns timing
uncertainty, and 20 m/s pseudorange-rate uncertainty. These are acquisition
consistency thresholds, not a position solution accuracy claim. Minimum epochs
are bounded to 3–64, satellites to 4–64, gaps to 1,500–5,000 ms, timing uncertainty
to 1–1,000,000 ns, and rate uncertainty to 0.001–100 m/s.

`RawGnssTrace` declares `type:"android-raw-gnss"`, a native elapsed-realtime anchor,
whether full tracking was requested, target `collection_interval_ms:1000`, and
the number of rejected incomplete/insufficient epochs before the first retained
epoch. Target cadence has a fixed 50 ms scheduling tolerance. The adapter must
select cadence before testing quality, keep every observation in a retained
epoch, reject overflow, and stop on invalid retained data; it cannot choose the
best satellites or silently truncate measurements. Maximums are 64 epochs and
128 observations per epoch, with the aggregate JSON limit applying additionally.
Collection still requires the complete actual requested duration; scheduling
tolerance never shortens it. Warmup rejections are bounded to 4,096.

Each epoch records its sequence, callback elapsed milliseconds, receiver clock,
and raw satellite observations. Signed receiver nanoseconds and full bias, and
unsigned elapsed-realtime/satellite nanoseconds, use canonical decimal strings.
This preserves Android long precision across JSON and JavaScript. Clock bias,
drift, optional uncertainties, hardware clock discontinuity count, and monotonic
timestamp uncertainty are retained. `time_uncertainty_ns` may be null because
Android can omit it for the reference clock. Raw collection requires the
Android 29+ monotonic measurement clock and its uncertainty. Optional fields
never receive invented zero values.

Per-signal observations include constellation/SVID, tracking state, satellite
receive time and uncertainty, time offset, C/N0, pseudorange rate and uncertainty,
and available carrier frequency, code type, accumulated delta range/state and
uncertainty, and gain control. Identifiers and state bits are bounded against the
Android API contract. Nonfinite/out-of-range values and duplicate signal
identities are rejected. Partial-lock observations remain in the record but do
not count toward the minimum satellite requirement. A qualifying observation
needs code lock, resolved satellite time, no millisecond ambiguity, nonzero C/N0,
and the requested uncertainties. Multiple frequencies/codes for one satellite
count once. GLONASS frequency-channel identifiers remain recorded but cannot
count as distinct satellites until an orbital-slot identifier is available.

Every epoch and individual signal time must lie in the native collection window
and satisfy callback delivery limits. Epochs must be chronological, cover the
requested actual duration with bounded gaps, and overlap the location-fix window.
Receiver and derived GPS clock deltas are compared with monotonic elapsed time
with a 100 ms sanity tolerance. Any hardware clock discontinuity invalidates the
retained collection; it is never silently repaired. The last raw epoch must still
satisfy `max_fix_age_ms` at collection end and at sealing.

Verification includes a separate `raw_gnss` result with granular predicates,
counts, `ready`, and stable `RAW_GNSS_*` error codes. `evaluate_raw_gnss(&Trace)`
exposes the same raw checks for native progress. `RAW_GNSS_EPOCH_COUNT` and
`RAW_GNSS_COVERAGE` can indicate incomplete collection; failing fields are not
fixed by waiting. All raw predicates run again on the independent verifier.

This version checks internal consistency only. It does not obtain ephemerides,
recompute position, authenticate navigation messages, detect every RF attack,
or verify acquisition attestation. `satellite_authentication_verified`,
`independent_position_recomputed`, and `collection_attested` remain false even
when `ready` and the proof's `verified` result are true. The shared
`raw_gnss_fixture.json` is explicitly synthetic test data, not phone validation.

## Public API

- `create_location_request(requester, task, now_secs, lifetime_secs, policy_json, context_json)`
  returns request JSON; JSON `null` selects the default policy or no context.
- `create_location_demo_request(now_secs)` produces a labelled, durable demo
  request with a fresh nonce, default policy and 15-minute lifetime.
- `validate_location_request(request_json, now_secs)` and
  `validate_location_trace(trace_json, now_secs)` return validated JSON.
- `location_identity(identity_json)` returns public SPKI base64, fingerprint and
  browser profile; it never returns private key material.
- `location_asset(jpeg_bytes)` returns `{kind:"image/jpeg",sha256}`.
- `seal_location_proof(trace_json, identity_json, asset_json, now_secs)` returns
  COSE bytes using the browser's software identity. Asset JSON `null` means
  standalone evidence.
- `verify_location_proof(proof_bytes, expected_request_json, expected_pin,
  expected_asset_json, now_secs)` returns report JSON. Media proofs require the
  caller to calculate the expected digest independently; `null` accepts only
  standalone proofs.

Native-only Rust `seal_with_signer(&Trace, spki_der, Option<AssetBinding>, now_ms,
callback)` takes a callback receiving the full COSE Sig_structure and returning
an ES256 DER/raw signature. It is not exported to WASM. `parse_request`,
`parse_trace`, `validate_request`, `validate_trace`, `asset_from_jpeg`,
`fingerprint_spki`, and typed `verify` support native adapters without duplicating
policy logic. Native adapters must gather their own observations and keep
signing callbacks inaccessible to untrusted JS.

The report exposes the signed payload as `evidence`, the complete trace as
`evidence.trace`, and its final sample as `selected_location`. Granular `checks`
are separate from the explicit false attestation claims. Replay consumption is
the requester's durable, atomic ledger responsibility; the stateless verifier
does not pretend to detect reuse across installations.

## Camera composition

Bind the proof to the final signed JPEG bytes. The camera independently embeds
the expected location request and selected fix inside its C2PA record. The
location proof then signs that final file digest as a separate artifact, avoiding
a circular hash. Asset binding changes `capture_correlation` to
`application-submission-interval`; standalone proofs use `none`. This establishes
an application-level association and makes no exposure-time or sensor-path claim.
Consumers must verify both artifacts, match their requests, and compare the
selected fix to the protected camera metadata.

Run `cargo test -p nonverba-core location_proof --locked` from `code/` for protocol
regressions covering tampering, substituted requests/keys/media, native callback
format, policy downgrades, duplicate/missing/stale samples, clocks, uncertainty,
mock reports, strict parsing and preservation of demo labels.
