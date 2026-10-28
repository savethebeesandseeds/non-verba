# Participant synthetic identity review client

The owner authorized this slice on 23 October 2026 through Hx02: align the
maintained client/service versions, then implement a small reviewer interface
and audited decisions using synthetic data. This is the Hero 10 client
checkpoint. Hx11 owns the exact service contract and activation; Hx02 owns the
[review policy](SYNTHETIC_IDENTITY_REVIEW.md), notice and custody records.

## Client boundary

The interface belongs to the existing participant application and its one local
URL, `http://127.0.0.1:4173/`. It consumes Hx11's published closed API. A fresh
positive permission exposes the test-review entry in Account; an ordinary
account cannot enter by changing a local control. Account roles do not supply
reviewer authority. A missing or incompatible service keeps review unavailable.

Custody receipt, synthetic review outcome and genuine identity assurance are
separate. A saved test approval cannot unlock Requests, Operations, Level 2,
signing, payment or sensors. New subject evidence requires a fresh review; an
older case's decision or notice agreement cannot be inherited by its replacement.

The small interface consists of an authorized bounded case list, one selected
case with its exact submission reference, accepted notice, details and photos,
and three deliberate test actions with a bounded reason. Saved, conflicting and
unknown outcomes must be distinct. It adds no bulk actions, leases, role editor,
automatic identity classification or general workflow engine.

## Required enforcement

- A fresh positive service permission controls entry. The server checks current
  reviewer authority on every list, case, media and decision request. Requester
  and Operator roles, intake admission, edge access and client flags confer none.
- Keep the current reviewer binding separate from the applicant/case binding.
  Session/recovery changes, selection changes and revocation fence late results.
- Load only the selected authorized case's bounded media. Render submitted text
  literally, keep media out of URLs/history/storage/logs, and revoke local image
  URLs on case departure, logout, backgrounding or permission loss.
- Decisions pin the exact service-defined case/revision and immutable submission.
  A stale/conflicting result requires refresh, never an overwrite or automatic
  decision retry. Lost replies preserve the original operation for lookup only.
- Use the selected case's historical accepted notice, never the current notice
  substituted into an older acknowledgment. Only fresh current-notice intake is
  eligible for new review under the Hx02 policy.

## Integration status

The shared browser/Android client implements Hx11's finalized
[closed service contract](SERVICE_SYNTHETIC_IDENTITY_REVIEW_CHECKPOINT.md).
Hx02 supplied synthetic notice version 3. Separate subject outcome reads and
reviewer permission/case/decision routes preserve the older context and custody
DTOs. Photos use bounded JSON/base64, with 3 MiB response reads and at most 2 MiB
decoded JPEG bytes; selected details use 256 KiB and ordinary responses 64 KiB.
The two reviewer modules are registered in the same browser/native asset closure,
with a reviewed 448 KiB runtime ceiling; image and APK ceilings stay unchanged.
Existing unavailable guards and real-data restrictions remain in force. The
separate subject read displays Approved for test, Correction requested or
Rejected for test alongside genuine identity verification still pending and
work access unavailable. A fresh service-confirmed completed test outcome can
start a new package with empty details, new photos and fresh notice agreement.
The contract now defines the closed retained capture assessment/proof shapes.
Historical validation does not require a consumed challenge to remain unexpired.
Historical operation lookup receipts will not replace the current case or
subject status. Unknown writes check the original operation before any fresh
current-case read or deliberate action.

## Live boundary diagnosis

The initial actual-client journey authenticated normally but failed the saved
custody presentation. Both authenticated status routes returned HTTP 200: the
synthetic review displayed Approved for test while custody stayed unavailable.
The failed field assertion was the old custody reader's `operation_id` regex,
which required this client's own generated token format instead of the published
1–128-character opaque identifier. The narrow correction preserves the exact
server receipt, closed fields, actor binding, pending verification and locked
prerequisites. Own submission creation and original-operation retry continue to
use their existing strict generated-token rules. No notice substitution, fixture
rewrite, new account, admission change or alternate compatibility mode is used.

## Executed client checks

The final unmodified main-source snapshot is
`/tmp/nonverba-unified-source/79c81afff1d744a9b1ce558f5f329e4b`.
All 163 focused client, state, relay and packaging checks passed, as did all 27
account/capture Chromium groups and participant Android assembly and lint.
The five added browser groups cover ordinary-account entry denial, all three
test decisions and subject labels, correction with a fresh draft, original-only
lookup after a lost reply, revision conflict with explicit reload, and late
media/sign-out fencing. Their service responses are controlled synthetic fixtures.

The 25 runtime assets total 454917 bytes within 448 KiB. At the sole root URL,
all 24 non-HTML runtime assets matched the tested snapshot byte for byte; root
returned 200 and the former review document redirected to `/` with 308. Normal
and 320-pixel/200%-text reviewer views were inspected for clipping, actions and
status readability. The container's existing font fallback limits typography
assessment. These checks do not establish physical-device or real-ID acceptance.

## Aligned actual-service UI acceptance

The normal subject UI accepted invented details and two synthetic Chromium
camera captures under exact notice version 3. This exercised browser capture
challenges/proofs; it used no real document, real face, selected image file or
physical camera. The resulting current package was then completed through two
linked UI phases rather than resubmitted during status-read retries.

A separately authenticated existing reviewer opened that exact pending package,
matched its subject, receipt and both hashes, viewed its retained details,
accepted notice and two photos, and deliberately recorded one approval for test.
Its exact decision was retained in protected local evidence. A fresh subject-only
browser session then signed in through normal password/PKCE forms and matched
the same account/principal/recovery generation, a different current session,
the exact submission/receipt/hashes and the recorded decision/revision. The UI
showed Approved for test; all four Requests/Operations creation controls remained
disabled, and no earned identity stamp appeared.

The final read report passed with case, receipt and decision match flags true,
work blocked, root URL preserved, media released and its session signed out.
The reviewer phase likewise completed its deliberate write, media cleanup and
sign-out. Earlier procedural attempts are retained as failed reports: they are
not whole-journey passes. The private helper now observes the current password
action finishing its own navigation before opening Account; no authentication,
binding or product authority guard was bypassed. No new package or decision was
created to retry the final read.

The managed snapshot's sanitized phase records end in
`5d52a9b06f8e4526bc3c470b13d5973b.json` (accepted camera intake),
`review-current-pending-5f347d9eb6e943e1b68422a219e24875.json` (completed exact-case
reviewer phase), and `subject-read-fcc9d3f865bf4f5390e62697378a872e.json` (passing
fresh subject read). Credentials, identifiers, protected decision pins and media
remain outside public source and reports. This proves one synthetic approval
journey; other actions, conflicts and unknown outcomes have the separate
controlled browser and Hx11 service-matrix evidence. Real-data operation,
appointments, adoption and physical-device acceptance remain pending.
