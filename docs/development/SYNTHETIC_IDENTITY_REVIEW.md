# Synthetic Level 1 review workflow

Authorized by the owner on 23 October 2026: align maintained client/service
versions, then build a small reviewer interface and audited decision endpoint
using synthetic data. Real-data intake remains pending. Hx10 owns client UI and
integration; Hx11 owns service contracts, storage, authorization, activation and
service evidence; Hx02 owns this policy, notice/custody records and Hero 02.

## Scope and current notice

The exercise uses deliberately selected synthetic accounts, invented details
and synthetic document/face images. It tests an accountable review process; it
does not perform real document or person verification. Synthetic decisions
change only the development review outcome. Account identity assurance, Level 2,
work, signing, payment and sensor authority must remain unchanged.

The current source notice is `identity-intake` **version 3**, state `draft`, format
`nonverba-identity-intake-text-v1`, exact UTF-8 text length **5849 bytes**, SHA-256
`e53aa71140a8fb50507e3f2330bb6c6ee90976c7a9240b7b12d567f619561ebd`.
The [canonical module](../../web/apps/non-verba/src/identity-intake-notice.js)
discloses reviewer access and retained decisions/reasons/audit metadata, while
preserving synthetic-only scope and unresolved retention/real-user decisions.

The exact [v1 text](../legal/identity-intake-v1.txt) and
[v2 text](../legal/identity-intake-v2.txt) remain historical documents. Keep their
catalog bytes, acceptances and receipts unchanged. A conflicting already-used
version 3 must refuse rather than overwrite history; allocate a successor if
necessary. Existing older-notice custody remains readable under its original
authority, but is not newly reviewable through inferred v3 agreement. New
review decisions require a fresh current-notice subject submission.

## Simple reviewer experience

An authorized reviewer opens a bounded list of permitted current synthetic
cases, selects one case, inspects its details/photos, exact notice and immutable
submission reference, and chooses one action with a bounded test reason:

| Action | Meaning |
| --- | --- |
| Approve test review | The selected synthetic case meets this development exercise's explicit checklist. It supplies no real identity or workflow authority. |
| Request correction | The test package needs corrected or replacement information. A new subject submission requires a fresh review and notice agreement. |
| Reject test review | The selected synthetic case does not meet the exercise's checklist. This is not a real person's adverse identity decision. |

The reviewer checks that the permitted synthetic package is complete and
readable, fields and images correspond to the exact current case, the current
notice/receipt is present, and the chosen fixture outcome/reason is supported.
They must not infer document authenticity, a genuine person, age/nationality,
liveness or face-recognition accuracy from a JPEG or capture signature.

Keep the interface small: list, selected case, three explicit actions and saved,
conflict or uncertain-result feedback. Do not add assignment leases, bulk
decisions, a role-management product, automated identity classification or a
new general workflow framework. Opening a case neither changes its outcome nor
starts cameras. Do not claim review is active merely because a case exists.

## Authorization and exact decision

- Reviewer authority is a separate explicit protected service selection of an
  owned synthetic account. Requester/Operator roles, intake admission, edge
  admission and UI flags confer none. The server checks current session,
  principal/recovery state and reviewer permission on every read and write.
- Deny self-review and all unauthorized case/media access. List responses carry
  only necessary case metadata; details/photos use the private reviewer boundary
  with no public media URLs. The subject sees their own scoped summary, not the
  private reviewer queue or another account's records.
- A write binds the exact immutable submission/receipt and content hash, current
  case/review revision, synthetic review policy, deliberate action and bounded
  reason. Recheck that the submission is still the account's current eligible
  case in the same authority/transaction boundary as the decision. A new intake
  racing with an old review must not inherit that approval.
- The service derives reviewer attribution and observed time; client identity or
  timestamps are not authoritative. Retain an immutable event identifying the
  reviewer principal, case/submission, policy/revision, operation, action/reason,
  service time and resulting revision. Decision history is append-only.
- An authorized exact idempotent replay returns its original historical result
  without changing the current case, even if a newer case/review exists. It is
  not a current approval or a new decision. Changed bytes under the same operation
  conflict; stale/racing revision checks apply to new decisions. Lost/late replies
  require original-operation status lookup before another action; do not guess
  that the decision failed or resubmit a new operation automatically.
- New or changed subject evidence starts a fresh pending review. Earlier
  decisions remain historical. Any supported reversal must append an attributed
  revision; if reversal is outside this slice, refuse it rather than editing
  history. Closing an account or disabling new intake does not erase its earlier
  custody/decision records or confer fresh reviewer access.

The policy is the initial synthetic review policy, version 1. Exact wire names,
closed schemas, routes and error codes belong to Hx11's shareable API contract;
Hx10 must consume that contract rather than invent parallel DTOs. Review status
is separate from immutable custody-received status and genuine identity status.

## Version alignment and acceptance

Use the maintained main source and one participant preview at
`http://127.0.0.1:4173/`. Hx11 aligns the service's selected notice/catalog,
capture-proof schema and migrations with that source using the existing managed
environment. Preserve exact migration checks, retained data and earlier v1/v2
receipts. Compatibility or authorization failure remains unavailable; do not
weaken guards, maintain an older client beside main or convert old receipts.

Completion requires focused evidence of matching current notice/capture
contracts and synthetic intake/status, reviewer/subject separation, denied
self-review/ordinary-user/cross-account access, deliberate three-action UI,
exact-case revision binding, stale/race refusal, immutable audit/replay/conflict,
unknown-outcome lookup, fresh review after replacement, and unchanged genuine
identity/work authority. Service and client checks belong to their respective
owners; a browser pass is not a phone-camera or real-person result.

## Custody and evidence

Decision/reviewer/reason records are private synthetic-development records under
the current notice. No new retention duration, erasure deadline, public access,
actual verification staff or real-data processing basis is chosen. The
[real-user decisions](IDENTITY_INTAKE_REAL_USER_PROPOSAL.md) remain open, and the
synthetic scope does not adopt that proposal.

Hx11 activated the aligned notice v3 service and migrations 19–20 on
23 October. Its 12 live checks passed for reviewer access, all three synthetic
outcomes, conflicts, historical operation lookup and fresh-session persistence.
Preservation checks confirmed earlier custody, notice history, issuer key and
the same two-account intake selection remained intact. The
[exact service API](SERVICE_SYNTHETIC_IDENTITY_REVIEW_CHECKPOINT.md), including
bounded case/photo responses, separate subject/reviewer contexts and original
decision-operation lookup, records Hx11's scoped evidence. Hx10's
[client checkpoint](PARTICIPANT_IDENTITY_REVIEW.md) records 163 focused checks,
27 Chromium groups, participant Android assembly/lint and exact root-preview
asset parity. The actual UI admitted synthetic data under v3, opened the exact
case's retained details/photos and recorded a test approval while Requests and
Operations stayed locked. A fresh subject-only session then matched the same
account/principal/recovery generation, exact submission, receipt hashes and
decision/revision under a different current session. It displayed Approved for
test, kept all four work-creation controls disabled and awarded no identity
stamp. The two linked phases completed media cleanup and sign-out without
creating another package to retry the final read. This completes the bounded
synthetic integration acceptance on 23 October.

The live UI intake used synthetic Chromium camera frames and exercised browser
capture challenges/proofs. It establishes no physical-camera, native-device or
real-person result. One approval journey has actual-service UI evidence; other
actions, conflicts, replacement and unknown outcomes have the separate
controlled browser and Hx11 service-matrix evidence. Real-data intake, actual
verification authority, retention/adoption and production readiness remain
pending.

Independent bounded source review on 23 October found no material issue in the
reviewer authorization/self-review boundary, transaction-time current-case and
revision checks, immutable audit, historical replay, client binding/media
cleanup or browser/Android response bounds. This was static inspection, not
runtime, physical-device or real-identity acceptance evidence.
