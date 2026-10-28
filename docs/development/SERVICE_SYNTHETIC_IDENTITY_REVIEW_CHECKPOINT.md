# Synthetic identity review service contract

## Agreed contract — 23 October 2026

This is the exact client/service contract selected by Hx02, Hx10 and Hx11 for
the small synthetic reviewer workflow. The aligned private service is now
running after focused validation and the reviewed single-container activation.
The maintained main contract uses one aligned rollout; there is no older or
hand-patched second preview. Actual Hx10 client integration is a separate result
and is not claimed here. Real-data intake and actual identity proofing remain
pending.

The wire DTOs below are finalized for client integration, including the closed
photo JSON envelope, full current reviewer binding and original-operation GET.
Scoped activation and verification evidence is recorded at the end of this page.

The successor intake notice is `identity-intake`, version `3`, with SHA-256
`e53aa71140a8fb50507e3f2330bb6c6ee90976c7a9240b7b12d567f619561ebd`
over exactly 5,849 UTF-8 bytes. The detached capture protocol remains version 1;
the maintained capture-capable intake profile succeeds the earlier v1-only live
profile. The activated release includes the existing capture schema migration and the new
review decision schema migration. Exact historical v1/v2 notice bytes and
receipts are retained. Old-notice custody is not retrospectively disclosed to a
reviewer; a new submission under the successor notice is needed for review.

Every endpoint below requires a current Non-verba account-session bearer. Edge
admission, Operator/Requester roles, intake admission and a client flag do not
grant reviewer permission. Reviewer access is separately selected by a protected
synthetic reviewer principal allowlist. Self-review is denied. The existing
deliberately selected synthetic intake accounts remain the only intake subjects.

All responses use `Cache-Control: no-store` and grant no CORS access. All fields
listed below are literal wire names. Identifiers use the existing bounded
identifier format; SHA-256 values are 64 lowercase hexadecimal characters.
Counters and timestamps are nonnegative JSON-safe integers; timestamps are
service-observed Unix seconds. `scope` is always `"synthetic-only"` and
`policy_id` is always `"identity-review-synthetic-v1"`.

Client response reads are bounded to 64 KiB for context, pending list, subject
summary and individual decision/operation results; selected-case details with
up to 20 history entries use 256 KiB (262,144 bytes). Photo JSON uses exactly
3 MiB (3,145,728 bytes) as its response-read ceiling. Decision POST bodies are
limited to 8,192 bytes. These distinct bounds keep the full Unicode reason and
history slice usable without permitting an unbounded response read.

## Custody and subject status

`GET /v1/account/identity/status` keeps its existing closed response unchanged:
four current binding fields plus `level_1: {status, receipt}`. Its `received`
status and original receipt always mean retained custody, including after a
synthetic review decision. The receipt's `identity_verification` stays `pending`.
The generic account context also keeps identity verification pending.

`GET /v1/account/identity/review/status` returns exactly:

```json
{
  "account_id": "account:synthetic",
  "principal_id": "principal:synthetic",
  "recovery_generation": 0,
  "current_session_id": "session:synthetic",
  "scope": "synthetic-only",
  "level_1": {
    "status": "pending",
    "receipt": {
      "submission_id": "submission:synthetic",
      "operation_id": "intake:synthetic",
      "status": "received",
      "identity_verification": "pending",
      "level": 1,
      "created_at": 1
    },
    "submission_sha256": "<64 lowercase hexadecimal characters>",
    "receipt_sha256": "<64 lowercase hexadecimal characters>",
    "review_revision": 0,
    "decision": null
  }
}
```

The illustrative identifiers above are invented, not operational records.
`submission_sha256` is the service's retained canonical submission commitment,
including the accepted content/authority/notice hashes; it is not a photo hash.
`receipt_sha256` is SHA-256 of canonical JSON for the exact original six-field
receipt. Clients use the service-returned values rather than recomputing a
different serialization.

The newest own submission determines the summary, including across fresh
sessions and recovery generations. Successor-notice submissions use immutable
database admission order, so submissions accepted within the same timestamp
second cannot be ordered by random identifiers. Earlier v1/v2 custody retains
its historical timestamp/identifier ordering. The states are:

| `level_1.status` | Meaning |
| --- | --- |
| `not_submitted` | No own custody exists; receipt and both hashes are null, revision is 0 and decision is null. |
| `not_eligible` | Own newest custody does not carry the exact successor review notice; custody and hashes remain visible to its subject, revision is 0 and decision is null. |
| `pending` | Newest eligible custody has no review decision; revision is 0 and decision is null. |
| `approved` | Latest decision approves only this synthetic test submission. |
| `rejected` | Latest decision rejects this exact submission. |
| `needs_correction` | Latest decision requests a fresh corrected submission. |

For the final three states, `review_revision` is positive and `decision` contains
`decision_id`, `submission_id`, `submission_sha256`, `receipt_sha256`, `revision`,
`action`, `reason`, `created_at`, `scope`, and `policy_id`. The subject view omits
the reviewer's principal and operation ID; those remain in the restricted audit.
This endpoint accepts no target-account argument: it always reads the
authenticated current account. A failed/missing route is unknown/unavailable,
never an empty, pending or approved state.
An active confirmed subject can still read their retained successor-notice
review summary when new intake is disabled or their account is removed from the
intake selection. Reviewer access and new decisions retain their separate
current intake/reviewer policy gates. No authority is granted by this historical
subject read.

## Reviewer entry, cases and exact details

`GET /v1/identity/reviewer/context` returns exactly
`{scope, can_review: true, account_id, principal_id, recovery_generation, current_session_id}` only for a currently
authorized reviewer. There is no successful `can_review: false` response;
denied callers cannot enter the reviewer flow by interpreting local UI state.

`GET /v1/identity/reviewer/cases` returns
`{scope, cases, has_more}` with at most 20 cases and no pagination parameter.
Each bounded pending-case item contains
`submission_id`, `account_id`, `receipt`, `submission_sha256`, `receipt_sha256`,
and `review: {status: "pending", revision: 0, decision: null}`. It contains no
photo bytes, contact email or unbounded participant directory. Self and
old-notice cases are excluded.

`GET /v1/identity/reviewer/cases/{submission_id}` returns exactly:
`scope`, `submission_id`, `account_id`, `receipt`, `submission_sha256`,
`receipt_sha256`, `details`, `notice`, `capture`, `is_current`, `review`, `history`, and
`history_has_more`. `details` uses the retained intake detail fields;
`notice` is `{notice_id, version, sha256, text}` with exact accepted text.
`capture` is `{document_front, face_front}`; each value is null or
`{proof, assessment}` from the retained server challenge consumption. A proof
and its assessment retain their original synthetic capture meaning; they do not
establish authenticity or real-person assurance. `review` is
`{status, revision, decision}`. History is newest first, bounded to
20 immutable decisions; `history_has_more` reports older retained decisions.

`GET /v1/identity/reviewer/cases/{submission_id}/photos/{kind}` is a separate
authenticated exact-case photo read. `kind` is exactly `document_front` or
`face_front`. Its closed JSON response is exactly
`{scope, submission_id, kind, media_type, sha256, size_bytes, base64}`,
where `media_type` is `"image/jpeg"`, `sha256` is the retained original photo's
lowercase digest, `size_bytes` is its decoded size and `base64` is canonical
padded standard base64 for those exact bytes. The original JPEG is at most
2 MiB and base64 is at most 2,796,204 characters, under the 3,145,728-byte JSON
response-read ceiling. This bounded JSON envelope is the finalized photo response for
client integration. It supplies no public URL, object key or shared client
secret. Every read rechecks reviewer permission, case eligibility and self-review
denial.

### Closed retained capture shape

Each non-null `capture.{kind}` has exactly `proof` and `assessment`. Assessment
has exactly these nine fields, with no unknown keys:

```json
{
  "signature_valid": true,
  "exact_image_bound": true,
  "original_request_bound": true,
  "source": "browser-camera",
  "hardware_attested": false,
  "native_origin_attested": false,
  "browser_origin_attested": false,
  "capture_time_trusted": false,
  "identity_verified": false
}
```

`source` is exactly `"browser-camera"` or `"native-camera2"`, matching the
retained request. The other eight values are the literal booleans shown, not
caller-selected confidence scores.

`proof` is the existing closed version 1 detached identity-capture proof,
bounded to 16 KiB of serialized JSON. Its exact schemas are
`IdentityCaptureProof`, `IdentityCapturePayload`, `IdentityCaptureRequest` and
`IdentityCaptureAcquisition` in the aligned service OpenAPI; the authoritative
public [protocol types and verifier](../../code/crates/nonverba-core/src/identity_capture.rs)
define their existing meaning. All four nested objects reject unknown fields.
The exact shapes and scalar bounds are:

| Object | Required fields and bounds |
| --- | --- |
| Proof | Exactly `payload`, `public_spki_der_b64`, `signature_b64`. Public SPKI is canonical padded standard base64 of canonical P-256 SPKI DER, at most 128 decoded bytes and 172 base64 characters. Signature is canonical padded standard base64 of raw 64-byte P1363 P-256/SHA-256, exactly 88 characters. |
| Payload | Exactly `request`, `image_sha256`, `image_bytes`, `width`, `height`, `captured_at_ms`, `lens_facing`, `acquisition`. Image SHA-256 is lowercase hex; image bytes are 1–2,097,152. Width and height are integers 1–2,400; intake additionally limits face image edges to 1,280. Captured time is a nonnegative JSON-safe integer. Lens is `front`, `back`, `external` or `unknown`. |
| Request | Exactly `version`, `purpose`, `challenge_id`, `nonce`, `account_id`, `principal_id`, `current_session_id`, `recovery_generation`, `kind`, `source`, `public_spki_sha256`, `issued_at_ms`, `capture_expires_at_ms`, `submit_expires_at_ms`. Version is 1 and purpose is `identity-capture`. Challenge and nonce are each canonical unpadded base64url for 32 bytes, exactly 43 characters. Account/principal/session identifiers use the existing 1–128 ASCII-character identifier format. Recovery and times are nonnegative JSON-safe integers. Kind is `document_front` or `face_front`; source uses the two values above; public SPKI SHA-256 is lowercase hex. |
| Acquisition | Browser source requires explicit null. Native source requires exactly `version`, `timestamp_source`, `request_elapsed_realtime_ns`, `image_received_elapsed_realtime_ns`, `result_received_elapsed_realtime_ns`, `sensor_timestamp_ns`, `image_timestamp_ns`, `zsl_requested_disabled`, `test_pattern_requested_disabled`, `zsl_result_enabled`, `test_pattern_result_mode`. Version is 1; timestamp source is `realtime` or `unknown`. The five nanosecond fields are canonical decimal strings with 1–19 digits, no leading zero except `0`, and value at most 9,223,372,036,854,775,807. Both requested-disabled values are true. Observed ZSL is null or false; observed test-pattern mode is null or 0. Native document lens is back and native face lens is front. |

The original request requires a positive capture window of at most 120,000 ms
and a submission window through at most 900,000 ms after issuance, with submission
expiry at or after capture expiry. Native acquisition retains matching
sensor/image timestamps, monotonic request/receipt order and the existing bounded
15-second delivery checks. These are signed application claims, not trusted
hardware or wall-clock evidence.

Historical display validates retained shape, original request/content binding
and the recorded assessment. It does not require an already-consumed capture
challenge to remain unexpired at review time and does not issue or consume a new
challenge. The intake-time expiry checks retain their original meaning; a past
expiry does not invalidate the historical receipt or restart cameras.

## Deliberate decision write

`POST /v1/identity/reviewer/cases/{submission_id}/decisions` accepts only:

```json
{
  "operation_id": "review:synthetic",
  "submission_sha256": "<exact service-returned commitment>",
  "receipt_sha256": "<exact service-returned receipt hash>",
  "expected_revision": 0,
  "action": "needs_correction",
  "reason": "Synthetic document fixture needs correction."
}
```

The three actions are `approved`, `rejected`, and `needs_correction`. `reason`
must be trimmed, contain 1–500 Unicode characters and contain no control
characters. Unknown or duplicate JSON fields are rejected. A successful write
returns exactly `decision_id`, `submission_id`, `submission_sha256`,
`receipt_sha256`, `revision`, `operation_id`, `reviewer_principal_id`, `action`,
`reason`, `created_at`, `scope`, and `policy_id`.

The service binds the write to the exact retained submission and receipt,
expected current review revision, current reviewer principal/session and
selected synthetic policy. Decisions append immutable audit history. Identical
replay of the same reviewer operation returns the original decision unchanged;
reusing that operation with changed input conflicts. Stale revisions and racing
writes cannot silently overwrite a decision. A decision for a superseded
submission cannot approve the newer submission. New submissions/corrections
start fresh review; no earlier approval is inherited.

After an unknown transport result, first read the original operation through the
GET below. Do not automatically POST again. If that lookup confirms no retained
result and a deliberate manual retry is offered, reuse the exact original body
and operation ID. Never generate a replacement operation merely to make the UI
appear successful. Refresh case/subject status after conflicts; never treat a
local button click or timeout as a stored outcome.

`GET /v1/identity/reviewer/cases/{submission_id}/operations/{operation_id}`
retrieves the original immutable decision for that exact reviewer operation and
case. It returns the same full decision DTO as a successful POST, after current
reviewer/session and case checks. An operation belonging to another reviewer,
another case or an unknown operation returns `identity_review_case_not_found`;
it does not reveal that another reviewer used an operation ID. This gives the
client an authoritative lookup after a lost POST response.
Historical lookup and identical replay remain valid after a newer submission
supersedes the case; they report the original decision without approving the
replacement. A new decision still requires the case to be current.

## Errors and authority limits

| HTTP | Stable error |
| --- | --- |
| 400 | `invalid_identity_review_decision` for strict decision-body validation. |
| 401 | `invalid_authorization` for absent, expired, revoked or otherwise invalid current account/session authority. |
| 403 | `identity_reviewer_required` for a current account without selected reviewer authority. |
| 404 | `identity_review_case_not_found`, including unknown, self or ineligible cases; no case-existence disclosure. |
| 409 | `identity_review_context_changed`, `identity_review_revision_conflict`, or `identity_review_operation_retry_differs`. |
| 503 | `identity_review_unavailable`; no review outcome is inferred. |

A synthetic approval is visibly test-only. It is not verified real identity,
document authenticity, face/liveness assurance, certification, Level 2
eligibility, production/work/signing authority or permission to resume sensors.
No real media admission, real retention period, actual identity proofing or
public reviewer service is selected. Review authorization, immutable audit and
test outcomes are service behavior; legal adoption and real-user custody remain
with their owning decisions.

## Executed service validation and activation — 23 October 2026

The final focused matrix passed after scoped hardening and lint cleanup:

| Build mode | Identity unit cases | Retained identity DB/object cases | Schema/profile unit cases |
| --- | ---: | ---: | ---: |
| Current notice-v3/capture/review | 10 | 17 | 2 |
| Historical v1 compatibility | 7 | 8 | 2 |

These are separate mode counts, not a distinct aggregate across earlier runs.
Strict all-target lint passed in both modes, together with formatting and the
managed current build. The seven current review database cases cover ordinary,
self and legacy denial; policy-off subject history; exact binding/replay;
two distinct reviewers sharing the CAS mutex; real intake/review and revocation
waits; same-second replacement order; immutable bounded/malformed audit; and
historical expired capture display. Historical proof validation is a
component/database result, not live camera or real-person acceptance.
Independent source review found no unresolved request-reachable
authorization/CAS/audit/media bypass after hardening.

Candidate checks at `17:05:19Z` confirmed the intended profile/configuration and
refused normal startup against the unmigrated database before opening a
listener. Protected selection at `17:06:01Z` preceded the existing launcher's
successful additive capture/review migration and owned API/worker reload.
The actual running build uses notice v3 and exact migrations 1–20. Only seven
review HTTP paths and one capture path were added; original account-context and
custody-status wire closures match. Exact v1/v2/v3 notice bytes, the same two
intake accounts, historical custody and issuer-key hash were preserved. One
independent existing synthetic reviewer is selected separately and receives no
intake admission. No extra runtime or source projection was introduced.

Twelve live review groups passed across 88 loopback requests and three synthetic
submissions using generated flat JPEGs and invented details. They cover
reviewer/ordinary/legacy/unknown-case boundaries, closed photo byte/hash readback,
separate approval/correction history, exact retry/original-operation lookup,
changed-input/stale conflict, replacement review, same-reviewer live CAS and
fresh subject sign-in with genuine identity/work/signing authority unchanged.
Five exact decision audit rows matched read-only checks. Intentional POST
response-body discard was reconciled through the original-operation GET; no
actual transport failure was injected. Live self-review was not exercised;
self-review and two-distinct-reviewer concurrency are component checks. Live
uploads carried no capture proofs. The 12 groups are the helper's scoped groups,
not a claim of 12 independent user journeys or client acceptance.

Fourteen subsequent live custody-status groups passed with the unchanged closed
DTO and fresh sessions. Environment verification at `17:07:25Z` passed readiness,
authenticated hash-verified storage and actual viewer SELECT denial on 66
private account/auth/service tables. At `17:08:51Z`, all 20 independent postflight
flags passed: old custody rows and the earlier 18 migration checksums remained
stable, all 20 current schema source checksums matched, protected active policies
and key bytes matched their reviewed selections, and only API/outbox processes
changed while database/objects/viewer/tunnel and service targets were preserved.
Readiness returned 200.

This completes the selected synthetic server scope. Hx10 owns actual
main-client/browser/APK integration, which is not claimed here; Hx02 owns
policy/notice/register. Real-data admission, real identity proofing, a real
retention period, legal adoption, external/native authentication and production
readiness remain pending. Fixture paths, credentials and detailed operating
evidence remain private.
