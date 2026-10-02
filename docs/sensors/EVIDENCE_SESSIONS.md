# Requester evidence sessions

`code/crates/nonverba-core/src/evidence_session/` adds one requester receipt protocol for image, location, camera-location and audio. It preserves the original sensor APIs, signed formats and location-only `live_session` protocol. A session is independent of the transport. The browser agent controller supplies its own durable reservation and acceptance workflow.

The requester signs a COSE_Sign1 request that freezes a typed original sensor request, operator pins, `EvidencePolicy` and delivery limits. The operator returns the original sensor artifact(s). The requester observes dispatch and final artifact reception, reruns the matching `appraise_*_with_context` verifier, and signs a separate receipt. Verification takes the independently retained original signed request and requester SPKI pin; the receipt's embedded copy cannot replace them. No API accepts a caller-provided verification report.

Both COSE messages use ES256 and distinct protected content types:

- `application/vnd.nonverba.evidence-session-request+json`
- `application/vnd.nonverba.evidence-session-receipt+json`

These domains differ from both each other and the legacy location-only protocol. Existing COSE parsing enforces the protected algorithm, content type and key ID, rejects unprotected headers, and authenticates the actual public key. The requester identity currently uses a software P-256 key; a signed requester observation is not an attested clock.

## Exported interface

All JSON objects are versioned and reject unknown fields. Time arguments use integer Unix seconds, as in the existing core. Artifacts are byte arrays, not base64 inside JSON.

```text
create_evidence_session_request(spec_json, requester_identity_json, now_secs)
validate_evidence_session_request(envelope_json, expected_requester_pin,
    expected_operator_pins_json, now_secs)
async seal_evidence_session_receipt(original_request_envelope,
    primary_bytes, secondary_bytes, audio_transcript_json, timing_json,
    requester_identity_json, expected_requester_pin, context_json, now_secs)
async verify_evidence_session_receipt(receipt_envelope, original_request_envelope,
    primary_bytes, secondary_bytes, audio_transcript_json,
    expected_requester_pin, context_json, now_secs)
```

The first export returns a request envelope. The validator returns its authenticated payload. Sealing returns a receipt envelope after sensor verification succeeds. Verification returns a `nonverba-evidence-session-verification` version 1 report. Structural input errors either return an error or a report with `verified:false`; callers must require explicit positive fields and handle both.

```json
{
  "version": 1,
  "evidence": {"type": "location", "request": "the existing typed request object"},
  "operator_pins": {
    "media_certificate_sha256": null,
    "location_spki_sha256": "64 lowercase hexadecimal characters"
  },
  "policy": {
    "version": 1,
    "native_acquisition_required": false,
    "raw_gnss_required": false,
    "correlated_camera_clock_required": false,
    "hardware_attestation_required": false,
    "independent_position_required": false
  },
  "delivery": {"max_response_ms": 90000, "max_receipt_age_ms": 60000}
}
```

The `request` placeholder above is an object, not a string in real input. Both operator pin fields must be present; unused fields must be `null`. `image` carries a `Challenge`; `location` and `camera-location` carry a location `Request`; `audio` carries an `AudioRequest`. Standalone location rejects an asset context. Camera-location requires a non-demo request with `context.purpose:"camera"`.

The outer session spec remains version 1 and accepts evidence-policy versions 1
and 2 through the same central policy validator as direct appraisal. A version 2
policy adds mandatory `audio_recording_monitoring_required:true|false`; version 1
must omit it and preserves its original serialization. Explicit `null`, unknown
fields, and switching the version without the required field shape fail. To
require the current monitored native microphone profile, set this version 2 flag
to true before dispatch. The frozen request and receipt then require the actual
verified signed recording-configuration observations; legacy native or browser
audio cannot silently satisfy that requirement. This audio-only flag also fails
for other sensor kinds. See [AGENT_EVIDENCE.md](AGENT_EVIDENCE.md) for the full
policy boundary.

| Evidence | Primary bytes | Secondary bytes | Retained audio transcript |
| --- | --- | --- | --- |
| image | C2PA JPEG | empty | empty string |
| location | COSE location proof | empty | empty string |
| camera-location | C2PA JPEG | matching COSE location proof | empty string |
| audio | C2PA WAV | empty | exact original transcript JSON |

The independently retained verifier context uses the existing appraisal schema; the minimal context is `{"version":1}`. A receipt hashes the **exact UTF-8 context and transcript**, including whitespace, as well as exact primary/secondary bytes. Retain their original serialization. Operator-supplied trust data or reports must not replace that context. Later trust refresh requires an explicit new verification/acceptance policy; changing the context bytes breaks the receipt binding.

## Request, receipt and replay identity

Request envelopes contain `version`, `type:"nonverba-evidence-session-request"` and `cose_b64`. The authenticated payload includes a random 256-bit session ID, requester SPKI pin/public key, frozen `spec`, creation time, sensor issuance/expiry, and a canonical typed sensor-request digest. Its `sensor_nonce` is `Challenge.id` for image/location/composition and `AudioRequest.session_id` for audio. Each is exactly 64 lowercase hexadecimal characters. Reserve both session ID and sensor nonce before handing a request to transport; a new wrapper must not authorize reusing the underlying challenge.

Receipt envelopes contain `version`, `type:"nonverba-evidence-session-receipt"`, `request_cose_b64`, and `receipt_cose_b64`. The signed receipt binds the exact original request COSE bytes, artifacts, transcript, context, requester key, session ID, demo marker, observed timing and sealing time. The outer verification report exposes the authenticated request and receipt, request byte digest, checks, actual appraisal, errors, `verified`, `demo`, and `fresh_action_eligible`.

All variants compare requester SPKI with the **actual successfully verified operator signer SPKI**. Comparing the media certificate hash with a requester SPKI hash would not establish different keys. Composition checks both the media and location signer. Distinct keys still do not prove distinct people or independent devices.

## Timing profile

- A sensor challenge may be at most 5 seconds old when wrapped. Validation and signed observations require dispatch within 5 seconds of wrapper creation.
- The maximum response interval is 180 seconds. The requested limit must exceed the sensor's minimum interval by at least one second and fit before challenge expiry. Location/composition use the requested trace duration; audio uses its duration minus the existing 100ms tolerance; image has no minimum interval.
- Receipt timing is `{sent_at_ms,received_at_ms,elapsed_ms}`. Wall time must be ordered and agree with monotonic elapsed time within 1000ms. Reception must precede sensor expiry.
- Receipt sealing must follow reception, with at most 30 seconds delay. A 1000ms tolerance accommodates the integer-second sealing API. Recorded capture/start/signing times must fit the witnessed interval with the same rounding tolerance. These remain signed device claims, not a trusted physical acquisition clock.
- For a verified native camera record, both its millisecond acquisition time and native finalization-entry time must fit that interval. A complete-file receipt cannot precede the photo's reported finalization entry beyond the existing 1000ms tolerance. This applies to standalone images and camera-location composition; composition also checks the separate location interval. Photos without native metadata retain their whole-second capture-time check. Finalization entry is not signature completion or proof of when photons reached the sensor.
- `max_receipt_age_ms` is 1–86,400,000ms. Age affects fresh-action eligibility, not historical signature integrity. The integer-second verification API uses the end of the supplied second for age, conservatively failing very short age policies. Fresh eligibility always ends at the original sensor expiry and is always false for demos.

The requester must record wall and monotonic dispatch/reception locally. Operator timing claims cannot replace these observations. For audio, the per-round transcript is necessary but insufficient: the requester must also receive and hash the **final signed WAV** before sealing this receipt.

## Live audio integration in 0.7

`web/src/audio-session.js` connects this protocol to the existing audio page,
WebRTC transport and browser/native microphone adapters. Version 2 audio pairing
offers carry connection details, requester and operator pins, a pairing ID, and
task/duration/assurance hints. They contain no sensor request. The operator must
enter a requester SPKI pin obtained through a trusted channel; accepting an ID
supplied only by the offer would not establish requester trust. The requester
likewise supplies the independently known operator certificate fingerprint.

Once the data channel connects, the requester creates the fresh audio challenge,
signs and reserves its wrapper, and dispatches it. The operator verifies the
original requester signature, addressed operator identity, agreed task and exact
policy before enabling microphone calibration. The live adapter uses evidence
policy version 2. **Android monitored recording** sets both
`native_acquisition_required:true` and
`audio_recording_monitoring_required:true`; a browser or historical native
recording cannot silently replace that profile. **Browser or Android** leaves
both requirements false. Neither choice requests hardware attestation.

The live audio wrapper permits 180,000ms from dispatch to arrival of the final
signed WAV and a 60,000ms final-receipt age for fresh action. This outer arrival
budget includes calibration and user waits as well as recording, signing and
transfer. Every two-second PCM segment must still meet its own 3,000ms response
deadline and the existing minimum whole-recording timing. A longer outer budget
does not relax those acoustic-round checks.

After the last PCM segment, the requester retains its own transcript and sends
it to the operator, but remains incomplete. The operator signs and transfers the
full WAV over the bounded peer transport. On completed delivery, the requester
immediately records arrival, verifies the actual WAV and retained transcript
against the frozen request/policy, and durably retains its signed final receipt.
It then returns that receipt. The operator verifies the return receipt against
the exact sent WAV, original wrapper, transcript and trusted requester pin before
showing completion. Failure to deliver the return receipt does not erase evidence
already verified and retained by the requester; it leaves the operator unable to
complete its side.

The completed requester session can export the WAV and a separate
`nonverba-audio-session-evidence` bundle containing the original signed request,
final signed receipt, fixed minimal verifier context and original audio transcript.
Bundle verification requires independently supplied requester and operator pins;
the bundle's identity labels are not trust anchors. It reruns the receipt and
sensor verification and checks the original request's operator pin. Importing a
bundle records no acceptance. **Accept once on this requester** instead uses the
retained live session, re-verifies it and atomically records local session/nonce
acceptance as described below. The plain legacy round-transcript export alone
does not witness final WAV arrival. The local demo remains outside this workflow
and cannot acquire live acceptance through import.

The [image requester CLI](../development/IMAGE_REQUESTER_CLI.md) can run the same image request/receipt
protocol in one Debian process, with explicit stdout handoff and complete-file
reception. It has no transport service, restart or acceptance ledger.

## Acceptance boundary and tests

`web/src/agent-requester.js` exposes `AgentRequester`, using the shared Rust/WASM
worker and a separate IndexedDB ledger. Create it with `createCoreClient()`.
`identity()` loads the persistent requester key before a sensor challenge exists.
`start(async (engine, nowSecs) => spec, {contextJson, send})` creates and signs the
fresh request, reserves the session and underlying sensor nonce atomically, then
passes `{sessionId, envelope, request}` to the supplied transport callback. Pair
with the operator and obtain consent before calling `start`.

The transport supplies complete raw artifacts to
`receive(sessionId, {primary, secondary})`. For audio, the requester must first
call `retainAudioTranscript(sessionId, exactTranscriptJson)` once with its own
observed round transcript, before final WAV arrival. `receive` timestamps arrival
before copying/hashing, verifies and signs the receipt, then retains the original
authority, exact context, raw artifacts and receipt. Transport code must not
accept an operator's saved report or substitute its transcript.

`verify(sessionId)` reruns verification from retained bytes.
`inspectRetained(sessionId)` returns `{report, acceptance}` after the same Rust
verification using the current stored requester identity. `acceptance` is null
when neither local acceptance key exists; otherwise both session and challenge
keys must agree with the verified bindings and original acceptance time limits.
A missing, incomplete, abandoned, wrong-requester or inconsistent ledger record
fails. The local record is separate from the signed verification report and
does not establish trusted acceptance time or global replay knowledge. Inspection
does not revive a suspended live session, create a receipt or renew freshness.
The camera page's retained lookup panel exposes this read path and explicit
acceptance after reload; it never starts acquisition.

`accept(sessionId, stillCurrent = () => true)` does the same, then atomically checks unchanged stored inputs and exact current
expiry before adding unique session and sensor-nonce acceptance records. Two
concurrent acceptances cannot both commit. A failure never frees a used nonce.
The optional synchronous current-context guard must return exactly `true`; it is
checked before/after asynchronous verification and again immediately before the
atomic writes. Camera, audio and live-location UI owners invalidate their guard on cancellation,
replacement or page suspension. Successful normal transport closure preserves
completed evidence for a later explicit acceptance action. Interactive live
location now uses this shared path and freezes the displayed result during
acceptance. The preserved legacy `acceptLiveSession(sessionId, stillCurrent)`
API applies the same lifecycle boundary under its original v1 timing semantics;
it is not the new interactive page's acceptance path.
The commit must occur in the same integer second used by Rust to verify the
trust context. If the clock advances, the controller reruns verification up to
three times; a stale certificate or revocation verdict cannot cross that boundary.
`cancel(sessionId)` abandons an active reservation. Page suspension closes active
sessions; a pending session cannot resume using a saved monotonic clock. Call
`close()` when disposing the controller.

The generic controller leaves peer transport, operator consent and sensor
acquisition to its caller; the live audio adapter above supplies those parts for
the audio page. Existing collectors can also be called independently by a
connected operator. Neither layer supplies a remote account service. The
[shared live-location integration](LIVE_LOCATION_SHARED.md) retains its exact
COSE proof, frozen native/raw policy and explicit verifier context, and checks
complete-proof arrival plus receipt age before local acceptance. A saved
`report.verified` field is never authoritative. Historical location-only v1
receipt verification remains a separate explicit import mode with no fallback.

The Rust protocol never records acceptance or claims replay protection: `acceptance_recorded`, `local_replay_checked`, and `global_replay_checked` are always false. It also keeps requester-clock trust, independent-requester proof and physical-measurement authenticity false. An agent must separately reverify retained bytes, require fresh eligibility, and atomically consume its durable session/nonce reservation. An isolated ledger cannot establish global replay knowledge.

Tests use actual signed synthetic JPEG, WAV and location artifacts in all four dispatch paths. They cover requester/operator key reuse, original-request/pin substitutions, stale/demo eligibility, resigned impossible timing, exact transcript/context binding, policy enforcement, COSE domain/signature failures and attempts to bless a corrupt artifact with a requester signature. These fixtures validate the software protocol; they are not physical sensor or hardware-attestation evidence.
