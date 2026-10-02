# Live standalone-location session, version 1

This independent module adds a signed requester envelope and signed portable
final receipt around an unchanged standalone location COSE proof. It does not
change sensor acquisition, add a server, implement streaming checkpoints, or
replace location verification. Multiround acquisition is deferred.

Requests and receipts use standard COSE_Sign1 ES256 with attached strict UTF-8
JSON and distinct protected content types. Signatures cover exact payload bytes;
hashes cover exact COSE/artifact bytes. Included public keys are not trust anchors:
verification requires separately retained requester/operator pins and the exact
original signed request envelope. Milliseconds are JavaScript-safe integers.

## API contract

Inputs named JSON are strings; artifact bytes are the original location COSE.

- `live_requester_identity(identity_json) -> JSON` returns requester public SPKI
  and its typed fingerprint. Provision a separate identity with `create_identity`
  and store it under a dedicated requester storage key. Operator and requester
  SPKI must differ in this phase.
- `create_live_session_request(location_request_json, requester_identity_json,
  operator_pin_json, now_secs, max_response_ms) -> request_envelope_json` signs a
  fresh session identifier, the normalized location request, expected operator
  pin and immutable timing policy.
- `validate_live_session_request(request_envelope_json, expected_requester_pin,
  expected_operator_pin_json, now_secs) -> payload_json` authenticates the request
  against independently supplied pins and checks current validity.
- `seal_live_session_receipt(request_envelope_json, artifact_bytes, timing_json,
  requester_identity_json, expected_requester_pin, now_secs) -> receipt_envelope_json`
  validates the location proof and original request before signing.
  `timing_json` is `{sent_at_ms,received_at_ms,elapsed_ms}`. Capture arrival at the
  end of transfer before asynchronous hashing; elapsed time is measured by the
  requester's monotonic clock from request transmission. These remain claims.
- `verify_live_session_receipt(receipt_envelope_json,
  original_request_envelope_json, artifact_bytes, expected_requester_pin,
  expected_operator_pin_json, now_secs) -> verification_json` verifies both
  signatures, original request, exact artifact digest/length, timing and the
  complete location proof. Historical verification and current fresh-action
  eligibility are separate findings; neither writes an acceptance ledger.

`expected_requester_pin` is lowercase SHA-256 of canonical P-256 SPKI DER. Typed
operator pin JSON is `{type:"operator-location-spki-sha256",sha256:"hex"}`. The
schema distinguishes requester SPKI, operator location SPKI and operator camera
certificate pins. Camera pins cannot substitute for location pins. This phase
only accepts standalone location proofs (`asset:null`).

Request envelope: `{version:1,type:"nonverba-live-session-request",cose_b64}`.
Receipt envelope: `{version:1,type:"nonverba-live-session-receipt",
request_cose_b64,receipt_cose_b64}`. Wrappers are strict but unsigned; authoritative
data lives inside the COSE messages. Base64 must be canonical. The included
signed request supports portability but must still match the verifier's original.

The request payload binds the sensor request digest/length, session identifier,
both pins, requester public key, creation time, and minimum/maximum response
intervals. Minimum is the location collection duration; maximum is explicitly
requested, bounded to minimum plus one second through 180 seconds, and must fit
inside the sensor challenge's remaining validity. Transmission must leave the
full maximum interval before expiry. The session marker does not alter the
sensor request. The requester must issue a fresh sensor challenge and withhold
it until transmission; this wrapper claims no additional physical freshness.

The receipt binds exact signed-request bytes, session identifier, sensor request
digest, operator pin, final artifact digest/length, timing and sealing time. The
operator proof never hashes this receipt, so finalization remains acyclic.

## Limits and trust

Request JSON/payload: 64 KiB; each signed COSE: 80 KiB; public SPKI: 256 bytes;
receipt-envelope JSON: 256 KiB. Artifact size uses
`location_proof::MAX_PROOF_BYTES`. Unknown/duplicate fields, versions, malformed
encodings, role substitutions, future times and partial inputs fail closed.
Wall/elapsed agreement tolerance is 1,000 ms. Receipt signing must occur no more
than 30 seconds after complete arrival. Demo status comes from the signed sensor
request and cannot be upgraded by an envelope.

`requester_clock_trusted`, `physical_freshness_proven`,
`independent_requester_proven` and `global_replay_checked` remain false.
`replay_status` is `not-checked`. A UI must atomically reserve before transmission,
persist terminal outcomes, and atomically accept once in its own ledger. This
library creates no global replay claim, and local storage loss destroys local
replay knowledge. Reserve both the session identifier and embedded sensor
challenge identifier atomically: a new wrapper nonce does not make an existing
sensor request or its proof fresh. Always create a new sensor request for a new
live acquisition. A signed receipt authenticates requester assertions under the
independently supplied pin; it does not authenticate the requester's clock.
