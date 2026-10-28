# Legal document register and upkeep

**Steward: Hx02. Last source inventory: 22 October 2026.** The owner assigned
Hx02 continuing responsibility for tracking and updating Non-verba's legal
documents. This register records canonical sources, versions, document states,
unresolved decisions and review triggers. Maintenance continues after the initial
inventory is complete.

Hx02 keeps this record and the relevant drafts current, checks consistency with
implementation evidence, and brings unresolved decisions to the owner. The
owner and applicable legal reviewers decide operator identity, coverage and
adoption. Each Hero retains its implementation and subject responsibilities.
Document stewardship does not confer authority to adopt agreements for a legal
person or approve jurisdiction-specific legal coverage.

## Documents and notices

The rows below were checked against their named repository sources on
22 October 2026 unless a row records a later check. “No document version” means the source has no dedicated version
identifier; it is not permission to invent one. Repository history tracks those
edits. Private agreement, notice and acceptance bytes stay private; the public
checkpoint supplies a pointer and its limits.

| Record | Canonical source and version | Current state | Next review trigger or decision |
| --- | --- | --- | --- |
| Account Terms | [Full draft](../web/apps/non-verba/src/account-terms.js), `nonverba-account-terms`, `0.1.0-draft.2`; exact digest below. [Preserved 0.1.0-draft.1](legal/account-terms-0.1.0-draft.1.json) | Draft, not adopted. Closing an account keeps the account record for a retention period so it can still be found if information about it is required. The length of that period is not selected. [Signup integration](development/PARTICIPANT_SIGNUP.md) documents the inline link and signup checkbox opening full-text review, agreement only at the document end. Deletion uses the same read-then-agree checkbox for the closure section. | Resolve the [adoption decisions](development/ACCOUNT_TERMS_REVIEW.md#review-findings-and-adoption-decisions), including the retention period's length; review any account offering or agreement-flow change. |
| Account Terms review | [Review and version contract](development/ACCOUNT_TERMS_REVIEW.md), prepared 22 October 2026 | Drafting and conditional primary-source review record; no legal approval | Revisit applicable sources when countries, operator, users or offering are selected, or a relevant rule changes. |
| Level 1 identity intake notice | [Canonical draft text](../web/apps/non-verba/src/identity-intake-notice.js) and [acceptance/custody review](development/IDENTITY_INTAKE_NOTICE_REVIEW.md), `identity-intake`, integer version `3`; checked 23 October 2026 | Synthetic reviewer/audit successor adds separately authorized test-review access and retained decision/reason/revision/policy/operation/service-time metadata. V1/v2 exact text and receipts remain historical and unchanged. V3 still grants no real identity, work, signing, payment or sensor authority and selects no retention duration. Hx11 activated the aligned v3 service and append-only synthetic review endpoint with preserved history and unchanged intake selection. Hx10 passed focused client checks and one actual-service synthetic approval journey, including a fresh subject session matching the exact package/receipt/decision while work stayed locked. | Preserve every exact version/history and test-only scope. Older policy pins must refuse incompatible current notice/capture fields. New review decisions require fresh current-notice subject intake. Real-user custody, necessary-data/eligibility, reviewer authority, retention/deletion/backups and adoption decisions remain pending. |
| Synthetic Level 1 review policy | [Minimal workflow and acceptance](development/SYNTHETIC_IDENTITY_REVIEW.md), initial synthetic policy version `1`; checked 23 October 2026 | Hx11's selected synthetic service scope is complete, including explicit reviewer selection, denied self-review, exact current-submission/revision binding, immutable audit and three test outcomes. The small Hx10 UI is implemented with three deliberate test actions. One actual-service approval journey passed through synthetic browser capture, exact-case review and a matching fresh subject read with work locked; other outcomes and failure paths have controlled browser/service evidence. Hx10 owns client UI/integration; Hx11 service/activation/evidence; Hx02 policy/notice/custody. | Recheck notice/API versions, reviewer access, exact-case/revision binding, audit and retry behavior when those contracts or data handling change. Keep real identity/work privileges unchanged; add no real-data intake or general review framework. |
| Browser login-key retention coverage | [Tool behavior](sensors/ATTESTATION_TOOL.md) and [account consumer](development/PARTICIPANT_SIGNIN_DEVICES.md), no document version; technical checkpoint checked 22 October 2026 | Owner-selected automatic origin-local key retention profile, recorded below; implementation/validation evidence remains with the linked technical records. No adopted Privacy Notice is recorded. | Keep notice coverage aligned with account-specific continuity, browser storage/clearing, recovery, capacity and fallback behavior; resolve the pending privacy and adoption decisions below. |
| Recovery-code export coverage | [Shared signup/export behavior](development/PARTICIPANT_SIGNUP.md#recovery-codes-and-download) and [service checkpoint](development/SERVICE_ACCOUNT_LIFECYCLE_CHECKPOINT.md#recovery-code-set-continuation--22-october-2026), no document version; checked 22 October 2026 | Eight independent memory-only codes, explicit user-selected plaintext `.txt` export, no saved-code acknowledgment. The service retains hashes; one code plus separate email proof rotates the entire set. Legacy factors remain compatible. No adopted Privacy Notice is recorded. | Cover the explicit export purpose, user-selected file storage and user-controlled deletion, page/native pending-data lifetime, hash retention and full-set recovery rotation in the pending Privacy Notice. Physical Android picker acceptance remains pending. |
| Username sign-in routing coverage | [Shared entry behavior](development/PARTICIPANT_SIGNUP.md), no document version; checked 23 October 2026 | Public handles or email proceed locally to password without a lookup or email challenge. The confirmed contact is returned only after successful password authentication and current binding; generic credential denials do not publish an account directory. Signup and recovery retain their email proofs. Existing PKCE/device steps remain. | Include alias use, authentication records, throttling and retention in the pending account Privacy Notice. This selects no new legal basis, notice adoption or real-person assurance. |
| Workflow identity prerequisites | [Shared participant enforcement](../web/apps/non-verba/README.md#identity-prerequisites--22-october-2026) and [level presentation](../web/apps/non-verba/README.md#compact-account-and-identity-levels--23-october-2026), no document version; checked 23 October 2026 | Request creation requires basic/Level 1 verification; operation creation and offers require advanced/Level 2 verification. Target stamps explicitly say Not verified; earned stamps share the workflow-access gate. The current pending-only account contract unlocks neither. Email confirmation, photos and attestation do not establish person verification. | Define the actual verification authority, decisions, data handling and applicable notices before connecting eligibility or enabling work mutations. The current UI gate and stamp artwork establish no server-side person-verification policy or legal adoption. |
| Synthetic identity notice | [Shared enrollment source](../code/test/fixtures/identity/synthetic-enrollment-workflow.js), `synthetic-identity-enrollment`, version `1` | Illustrated-fixture processing/retention notice; no real identity or liveness decision | Any notice, media, purpose, recipient or custody change; keep real-data use pending. |
| Private participant notices | [Public service checkpoint](development/SERVICE_PARTICIPANT_RECORDS_CHECKPOINT.md), dated 21 October 2026 | Separate versioned synthetic retention, unverified-certification and publication notices. Exact text/version/digest are private; this checkpoint does not expose their catalog identifiers. | Hx11 supplies a shareable catalog reference/version-change record when these notices change; preserve private originals and earlier acknowledgments. These are not adopted legal terms. |
| Governance principles | [Governance](../GOVERNANCE.md), `0.1` | Draft constitutional design, not a legal charter | Chosen legal structure, institutions, rights, authority or adoption changes. |
| Real-user identity intake successor proposal | [Owner decision sheet and proposed text](development/IDENTITY_INTAKE_REAL_USER_PROPOSAL.md), prepared 23 October 2026; D4 recorded 28 October 2026; only the next unallocated successor may be used, with no number reserved | Pending reference for future real-user intake. Capture v2 and reviewer/audit v3 remain synthetic only; no final real-user bytes/digest or adoption exists. D4 is a two-year ceiling. D1, D2, D3, D5, D6 and D7 are deferred. Original bytes and history remain unchanged. | The deferred items still need a custodian, purpose, access, deletion, backups and publication decision. Then finalize exact text and digest and evidence the selected implementation before admission. |
| Source license | [LICENSE](../LICENSE), GNU AGPL version 3; [repository application](../README.md#license-and-contributions) selects `AGPL-3.0-only` | Existing source license, separate from account agreements; earlier Apache grants remain recorded in the README | Any licensing, contribution or distribution change; preserve existing grants and corresponding-source notices. |
| Contribution conditions | [CONTRIBUTING](../CONTRIBUTING.md), no document version | Existing contribution and intellectual-property guidance | Contribution conditions, provenance, licensing or publication workflow changes. |
| External licenses and attribution | [Third-party index](../THIRD_PARTY_NOTICES.md), no document version; individual notices and model lock linked there | Existing material-specific notices; dependency/model/data rights remain separate | Added, changed or distributed external material. Keep the index and applicable individual notices together; an entry is not new rights clearance. |
| Security reporting | [SECURITY](../SECURITY.md), no document version | Existing reporting guidance | Reporting contact, process, supported scope or disclosure-policy changes. |

### Account Terms version record

| Version | Status | Content format | SHA-256 |
| --- | --- | --- | --- |
| `0.1.0-draft.2` | `draft`, current | `nonverba-account-terms-jcs-v1` | `6fa35455cdd833e3253f44dbcf7cfb9b61342d2d22fd99a6318996433c7d60a7` |
| `0.1.0-draft.1` | `draft`, preserved | `nonverba-account-terms-jcs-v1` | `88609610130c0a7a2594399402aea6db298f6218b5c91eaa07783bd97b746db4` |

The digest covers exactly `ACCOUNT_TERMS_CONTENT_JSON` as UTF-8 without a BOM or
trailing newline. The [review contract](development/ACCOUNT_TERMS_REVIEW.md)
defines the canonical fields and agreement binding. Preserve this version and
its accepted bytes when adding a successor. Keep earlier version rows and their
retrievable text; changed content requires a new version and digest. No adopted
Account Terms version is recorded here.

### Identity intake version record

| Version | Status | Content format | SHA-256 |
| --- | --- | --- | --- |
| `1` (integer) | `draft`, synthetic development only | `nonverba-identity-intake-text-v1` | `e758daf9412756dd37ea43c79a7ebec21745109fa0dc9e9125fd029adbde8a27` |
| `2` (integer) | `draft`, synthetic development with detached capture metadata | `nonverba-identity-intake-text-v1` | `d39fa9049feb18fc7db8d2ce0731fecba738b3c10fadce09130521c3a270fbca` |
| `3` (integer) | `draft`, synthetic capture plus private review/audit exercise | `nonverba-identity-intake-text-v1` | `e53aa71140a8fb50507e3f2330bb6c6ee90976c7a9240b7b12d567f619561ebd` |

Checked 23 October 2026. The current digest covers exactly the canonical module's
5849-byte UTF-8 `IDENTITY_INTAKE_NOTICE_TEXT` for v3. The preserved historical
texts remain [v1, 3509 bytes](legal/identity-intake-v1.txt) and
[v2, 4694 bytes](legal/identity-intake-v2.txt). All use LF line breaks,
no BOM or final newline. It is a text format, separate from the Account Terms JSON
format. Admit the selected version only if the catalog has no different retained bytes or
acceptance for that tuple; otherwise allocate a successor and preserve history.
The [review](development/IDENTITY_INTAKE_NOTICE_REVIEW.md) owns the exact-byte,
acknowledgment, submission and pending custody decisions. The [synthetic review
policy](development/SYNTHETIC_IDENTITY_REVIEW.md) defines the new test-only
decision boundary. Closing a page or test
account does not prove service deletion. No retention duration is selected
for these synthetic notices. The separate real-user D4 ceiling does not apply
to them.

### Real user intake decision proposal

Checked 23 October 2026. The owner's earlier request to enable local submission
and explain unfinished validation was clarified as **test-data submissions under
existing v1**. The later [synthetic v3 review slice](development/SYNTHETIC_IDENTITY_REVIEW.md)
keeps that test-data scope and preserves historical receipts. Hx11 owns service
intake/activation and its evidence; Hx10 owns client UI/integration. The
[decision proposal](development/IDENTITY_INTAKE_REAL_USER_PROPOSAL.md) is held as
a pending reference for future real-user scope. On 28 October 2026 the owner
selected a two-year retention ceiling for D4 and deferred D1, D2, D3, D5, D6
and D7 because those choices need institutional maturity the project does not
yet have. The sheet still does not identify a legal custodian, appoint a
reviewer, select deletion or backup mechanics, or adopt a real-user notice.
The successor text states the D4 ceiling and leaves the deferred inputs marked.
It is not a catalog document and has no final digest.
“Processing takes time” must not imply an operating review service; the proposed
post-receipt status expressly confirms no review start or completion time.
Preserve v1/history and the current synthetic-only direction. The subsequent
camera-hardening v2 is synthetic only. Do not finalize a real-user successor
or admit real data without its selected scope, applicable review
and implementation evidence. D1-D7 are not a new gate on the authorized test-data
exercise.

### Browser login-key retention checkpoint — 22 October 2026

The owner selected automatic, prompt-free best-effort browser retention of a
nonextractable P-256 login key in origin-local IndexedDB. The fixed scope is
purpose plus account ID, with at most 32 retained rows and no automatic eviction
or key rotation. Reload and account recovery reuse that scope's retained key;
each fresh possession signature still binds the current account, session and
recovery generation. Recovery generation is not an additional stored key scope.
Storage unavailable means an explicitly reported memory-only fallback; a corrupt
existing record is refused rather than silently replaced. The technical sources
above own the implementation details and actual validation results.

Stored material includes the account scope and public/private CryptoKey objects;
it adds no passwords, login tokens, biometrics or browser fingerprint traits.
A retained account-scoped key nevertheless supports continuity
between that account's browser sign-ins. Browser/profile storage and site-data
clearing affect that continuity; retention is not a hardware-attestation,
cross-device identity or durable-storage guarantee. Account/session authority and
backend retention remain separate from the browser key's lifecycle.

Privacy Notice coverage remains pending: describe the actual stored fields and
purposes, account-specific continuity, recipients and associated service records,
browser/profile storage and clearing, recovery/account-closure behavior, and the
32-row capacity, fallback and corrupt-record outcomes. Responsible organization,
applicable coverage, notice wording and adoption remain owner/reviewer decisions.
This technical checkpoint adopts no notice or legal conclusion and changes no
Account Terms text, version, digest or historical agreement record.

## Domain drafts and unresolved documents

These existing records define separate subject boundaries. Tracking them does
not turn research or technical specifications into agreements.

| Subject | Existing record and state | Outstanding document or decision |
| --- | --- | --- |
| Assignment and service terms | [Contract drafting AN-2](notes/assignments/CONTRACT_NOTES.md), 28 September 2026, with later dated addenda; explanatory, unadopted. [Contract specification](requests/CONTRACT.md) owns the signed technical record. | Actual parties, services, charges, rights and applicable-law review in the drafting worksheet; account signup does not accept an Assignment. |
| Disputes and settlement | [Settlement handling](requests/SETTLEMENT_HANDLING.md) and [dispute lifecycle](requests/DISPUTE_LIFECYCLE.md), working technical/procedural records | Applicable procedure, access, notice, escalation and separate exact settlement authorization; no adopted general dispute-service agreement recorded here. |
| Operators union | [Union notes](notes/cooperation/OPERATORS_UNION_NOTES.md), working research notes, no adopted document version | Membership, representation, collective authorization, privacy and institutional adoption. |
| Incidents and insurance | [Incident and insurance notes](notes/research/INCIDENT_HANDLING_AND_INSURANCE.md), working research directions | Notice/materiality procedure, responsible institutions and any coverage/product terms; no insurer or coverage selected by these notes. |
| Product Privacy Notice | Required by the [Account Terms review](development/ACCOUNT_TERMS_REVIEW.md#review-findings-and-adoption-decisions); complete adopted notice pending | Responsible organization, actual data/purposes/bases, recipients/transfers, retention/backups, rights and contact route. Include the [browser login-key retention checkpoint](#browser-login-key-retention-checkpoint--22-october-2026), checked 22 October 2026. Draft against selected behavior before public adoption. |
| Real identity and biometric processing | [Enrollment scope](development/IDENTITY_ENROLLMENT_SLICE.md), [23 October synthetic intake checkpoint](development/PARTICIPANT_CAPTURE.md#identity-details-image-preparation-and-private-intake--23-october-2026), [data lifecycle requirements](development/REGISTRATION_PIPELINES.md) and [notice review](development/IDENTITY_INTAKE_NOTICE_REVIEW.md), technical/design/draft records; checked 23 October 2026 | The scoped synthetic intake checks evidence normalization, durable custody/receipt, exact acceptance and ownership/retry enforcement. The later [synthetic review policy](development/SYNTHETIC_IDENTITY_REVIEW.md) and Hx10/Hx11 checkpoints add private test-review access, immutable decisions and one matching fresh-session UI outcome. These remain synthetic-development results. Legal custodian, purpose, eligible users, actual reviewer/recipients, retention/deletion/history/backups, rights channels and adoption remain unresolved for real data. No real-person decision or deletion guarantee follows from these synthetic checks. Real-data storage and identity verification remain pending. |
| Account support and closure | [Current test-account deletion](development/PARTICIPANT_ACCOUNT_DELETION.md) and Account Terms review | Adoptable support, complaint, suspension/review and closure policy. Draft 0.1.0-draft.2 keeps a closed account record for a retention period so it can still be found if information about the account is required. The length is not selected. Current tombstoning is not a history, shared-record or backup purge promise. |
| Identity validation language and liability | [Owner direction](notes/legal/IDENTITY_VALIDATION_AND_LIABILITY.md), recorded 27 October 2026; no document version | Working language and trust-design boundary. "Verified" or "real" requires an issuing-body check. Diplomas and certificates stay user-uploaded and unverified. "Validating" may describe an ID-photo plus face-photo account step and does not guarantee authenticity. A verified display, rank, or badge that drives trust in a transaction is outside mere content hosting. The liability note left identity-intake bytes unchanged. Hero 2 keeps this with the drafts; the certification goal stays empty. Country is not claimed. | Participant labels name ID and face photos. A missing level says No ID and face photos. A recorded level says ID and face on record. Waiting submissions say Awaiting review. The setup screen says the photos are not confirmed with the issuer. The stamps can still gate Requests and Operations, and the pending account contract does not award them. This is not an issuing-body check or legal adoption. Map outlines, fixture country codes and research mentions do not settle a country. The 23 October seals remain the stamp artwork. |

## Maintenance procedure

1. On any legal-text, notice, agreement-flow or relevant behavior change, Hx02
   updates the affected row, its checked date, source/version and outstanding
   action in the same task. Relevant behavior includes collection, use, access,
   recipients, storage, retention, deletion, recovery, charges and public claims.
   Adding a document, selecting an operator/country/user group, or receiving an
   applicable legal decision also triggers review. Unaffected rows retain their
   earlier checked date; the inventory date advances only after rechecking all
   rows. Add a row-specific date when reviews diverge.
2. Check the canonical text against Hx10/Hx11 or the relevant Hero's current
   evidence. Record a gap explicitly; do not silently convert a proposal or a
   historical check into current implemented behavior. Keep private material
   private and link its shareable checkpoint.
3. For substantive legal analysis, verify current primary legal sources for the
   actual scope and record source/review dates and unresolved questions. A source
   inventory date is not a legal-validity review date. Keep owner decisions and
   applicable legal approval evidence distinct from drafting progress.
4. Preserve exact earlier agreement/notice text, versions, digests and attributable
   acceptance records. Record each successor separately. Mark adoption only from
   an explicit authorized decision identifying text, scope and effective
   applicability; identify superseded versions without rewriting history.
5. Update H02's ongoing stewardship record when a concrete milestone is achieved,
   and refresh the private dashboard after any Hero JSON edit. Keep the register
   as the document index and the dashboard as the progress record.

## Change record

| Date | Change |
| --- | --- |
| 28 October 2026 | Account terms successor 0.1.0-draft.2 states that closing an account keeps the account record for a retention period, so the account can still be found if information about it is required. The length is not selected. Exact 0.1.0-draft.1 bytes remain. Deletion uses the same read-then-agree checkbox as account creation. No operator, country, Privacy Notice, or identity-intake bytes changed. The draft is not adopted. |
| 28 October 2026 | Restored the 23 October identity seals. The redrawn seals were set aside. No notice, terms bytes, version or digest changed. |
| 27 October 2026 | Replaced the earned identity label Verified with On file. Unearned levels stay Not verified. Internal identity status fields, Account Terms and identity-intake bytes are unchanged. |
| 27 October 2026 | Replaced that visible wording with the photo labels: No ID and face photos, ID and face on record, and Awaiting review, plus the line that the photos are not confirmed with the issuer. Internal status fields, Account Terms and identity-intake bytes are unchanged. |
| 27 October 2026 | Corrected the legal findings on country. Country is unset. Map outlines, fixture country codes and research mentions are not a claim. No notice, terms bytes, version or digest changed. |
| 27 October 2026 | Reviewed the legal notes against Hero 2. Legal stewardship stays on that Hero. The certification goal no longer describes a trusted-verification process, and Account Terms adoption stays unstarted. No notice, terms bytes, version or digest changed. |
| 27 October 2026 | Recorded the owner's identity-validation and liability direction: no verified or real claim without an issuing-body check; diplomas and certificates stay user-uploaded and unverified; validating may describe an ID-photo plus face-photo account step without guaranteeing authenticity; vouching, ranking, or a trust-bearing badge sits outside mere content hosting. The [note](notes/legal/IDENTITY_VALIDATION_AND_LIABILITY.md) also records that earned Level 1/2 participant copy still says Verified. Account Terms and identity-intake text, versions and digests are unchanged. No notice was adopted. |
| 23 October 2026 | Owner authorized maintained client/service version alignment and a small synthetic reviewer UI/audited decision endpoint. Hx02 prepared notice v3 for reviewer access and decision/audit metadata, preserving exact v1/v2 history and the pending real-user proposal. Hx11 activated aligned notice v3/migrations 19–20 and passed scoped live review and preservation checks. Hx10 passed 163 focused checks, 27 controlled Chromium groups, Android assembly/lint, root asset parity and one actual-service synthetic approval with exact-case fresh-session readback and unchanged work/identity authority. No actual identity/work privilege, real-data policy, retention duration or legal adoption is supplied. |
| 23 October 2026 | Hx11 completed the owner-selected test-only service activation for two explicitly selected confirmed synthetic accounts in the existing private environment. The [service checkpoint](development/SERVICE_IDENTITY_INTAKE_CHECKPOINT.md) records synthetic submission, exact notice/receipt and private byte readback, retry/conflict checks and unchanged pending identity/work authority. Other accounts remain closed by policy; account selection does not classify image content. This supersedes the earlier unavailable runtime observation only for the selected test scope. Synthetic v1 and Account Terms bytes/history remain unchanged; real-ID collection, identity review, retention/erasure decisions and legal adoption remain pending. |
| 23 October 2026 | At the owner's direction the browser preview now runs unmodified main, including the existing synthetic v2 notice/camera client. At that checkpoint the selected service remained v1; its exact notice policy, historical agreements and receipts were preserved. Incompatible camera/intake operations stay unavailable, with no notice substitution, old-client fallback, new admission or adoption. The [source-parity checkpoint](development/VALIDATION.md#one-preview-from-main--23-october-2026) records the launch and compatibility checks. |
| 23 October 2026 | Subsequent identity-camera hardening prepares synthetic-only v2 to disclose capture challenges, public keys, signatures, image identifiers and acquisition timing. Exact v1 text/history and Account Terms remain unchanged. At that checkpoint the source pinned v2; the source change did not change the protected live policy, reload a service, admit real data, choose retention or adopt a real-user notice. The pending real-user proposal now needs the next unallocated version. |
| 23 October 2026 | The owner clarified the enabling scope as “Test-data submissions now” under the unchanged synthetic v1 notice. At that checkpoint the real-user decision/proposed-successor packet remained a pending reference only; no canonical v2, final digest, real-ID adoption, retention period or active review was created. Hx11 owns actual service intake/activation and service evidence; Hx10 owns client UI/integration. |
| 23 October 2026 | Reviewed the request to enable local submission against recorded decisions and prepared a real-user successor-notice/decision proposal. D1-D7 remain open: responsible organization/locations, purpose/necessary data/eligible users, access/reviewer, retention, deletion/closure, backups/restore and notice publication. The proposal selects no duration or active review, assigns no final notice digest, changes no runtime gate and preserves synthetic v1 and Account Terms bytes/history. |
| 23 October 2026 | The owner requested a compact final identity step. Continue from the selected photo performs the revision-bound review; a closed disclosure retains optional field/photo inspection and editing. The final checkbox, label, notice link and unaccepted Submit open the full pinned notice without agreement or upload. Agreement remains solely at its end, returns through Back and precedes separate submission. Changed fields/photos invalidate acceptance, incomplete details return to the form, and unknown writes retain status-only handling. The [technical checkpoint](development/VALIDATION.md#compact-identity-submission--23-october-2026) owns validation. Canonical notice and Account Terms text/version/digests, historical acceptance, custody gate and adoption decisions are unchanged. |
| 23 October 2026 | Reconciled Hx02's initial in-flight/page-only observation with the completed Hx10/private-service synthetic intake checkpoints: full pinned notice and separate agreement/Submit, normalized JPEG and hidden-metadata refusal, durable synthetic readback, exact acceptance and ownership/retry/receipt checks. At that pre-activation checkpoint live intake was unavailable and refused photo payloads before reading. No real data, retention period, legal custodian, reviewer, deletion guarantee or adoption is selected; canonical notice and Account Terms bytes/history are unchanged. |
| 23 October 2026 | Hx02 prepared the separate Level 1 synthetic development intake notice, `identity-intake` version 1, with exact UTF-8 text/digest and immutable acceptance contract. It discloses durable synthetic submission and unresolved custody/retention/deletion/backup/reviewer decisions, with no chosen duration, real-data authority or verification award. Integration/copy/storage evidence remains with Hx10 and the private service owner; Account Terms bytes/history are unchanged. |
| 23 October 2026 | The owner's identity-flow refinement replaces level selection with sequential entry points: Level 2 requires authoritative Level 1 eligibility before dispatch and during revalidation. Current pending accounts instead show a gray Unverified stamp; local photo review and badge artwork grant no verification. Demo/page-lifetime notes moved below actions while deliberate page-only processing consent remains before capture. No new collection, identity authority, terms bytes/version/digest or historical agreement record changed. |
| 23 October 2026 | Owner-selected identity stamps now distinguish Level 1 Requests and Level 2 Operations. Setup and capture label them Not verified; earned stamps share existing eligibility gates and remain hidden under the pending-only service contract. Compact copy retains deliberate consent, page-only photo lifetime, no upload/verification or liveness claim, recovery factors and uncertain deletion/sign-out outcomes. No verification authority, new collection, terms bytes/version/digest or agreement record changed; notice and adoption decisions remain pending. |
| 23 October 2026 | Owner-requested existing-account sign-in now goes directly from identifier to password, without repeated email confirmation or anonymous contact disclosure. Signup and recovery keep their distinct email proofs; password, PKCE, current-account binding and device proof remain required. Account actions gain icons and Delete account styling, with missing identity shown beside its action rather than in a separate profile row. Exact Account Terms text/version/digest and earlier agreement records are unchanged; notice adoption remains pending. |
| 22 October 2026 | Owner-selected sign-in accepts a public unique username as an alternative to email, routing confirmation privately and disclosing the contact only after valid proof. Unknown aliases remain generic and cannot create an account. Existing password/PKCE and device proof remain separate. Account Terms text/version/digest and earlier agreements are unchanged; notice coverage and adoption remain pending. |
| 22 October 2026 | Owner-requested identity prerequisites now lock request creation, operation creation and offers at controls, navigation/history and form actions while authoritative eligibility is unavailable. Basic and advanced verification remain separate from signup, capture and device attestation. No identity decision or new data collection is added; service eligibility enforcement and relevant notices remain open. Account Terms bytes/version/digest and earlier agreements are unchanged. |
| 22 October 2026 | Owner-selected recovery now presents eight independent codes and an explicit text download instead of a saved-code checkbox. The [signup record](development/PARTICIPANT_SIGNUP.md#recovery-codes-and-download) states memory clearing, native picker/write outcomes, user-controlled exported-file retention, hash-only service storage and whole-set rotation. Existing single factors remain valid; no user account was silently rotated. Privacy Notice coverage remains pending. Account Terms text/version/digest and historical agreement records are unchanged. |
| 22 October 2026 | Owner-selected signup corrections now retain agreement to the same terms while editing username/password or correcting a refused username. Local validation keeps Create account actionable and reports the invalid field without enrollment. Changed/unavailable terms, withdrawal or leaving signup still reset agreement, and submitted passwords still clear. Exact terms bytes/version/digest and prior acceptance records remain unchanged; adoption is still pending. |
| 22 October 2026 | Activating the signup checkbox now opens full terms without changing agreement; only the checkbox after the complete document accepts or withdraws it. Mouse, keyboard and associated label use the same review gate. Username presentation adds a fixed `@`, preserving canonical API names. Terms text/version/digest and historical acceptance records are unchanged; no legal adoption is claimed. |
| 22 October 2026 | Owner-selected full-terms agreement checkbox synchronizes the signup choice and returns to the form through the shared Back action. Opening or leaving the document without agreement does not accept it; missing/current-text failures keep agreement disabled. The confirmed readonly email now appears first with gray styling. Terms bytes, version, hash and backend acceptance binding are unchanged. |
| 22 October 2026 | Initial source inventory and continuing Hx02 stewardship recorded at the owner's direction. Account Terms remain draft; privacy/adoption decisions, real-data storage and identity verification remain pending. |
| 22 October 2026 | Owner-selected signup presentation now places the account terms link in the checkbox sentence and shows draft/version only in the full terms view. Opening the link does not change consent. Exact terms bytes, version, digest and server acceptance binding are unchanged; adoption remains pending. |
| 22 October 2026 | Owner-selected account password minimum is now 8 Unicode characters for enrollment and recovery, with existing common/pattern/context refusals retained. Shorter accepted credentials work through authentication; historical multibyte credentials remain compatible. The [signup record](development/PARTICIPANT_SIGNUP.md) reflects this technical policy change. Exact terms text, version and acceptance binding are unchanged. |
| 22 October 2026 | Recorded the owner-selected origin-local browser login-key retention profile and its pending Privacy Notice coverage, including account continuity, reload/recovery reuse, bounded storage, explicit memory-only fallback and corrupt-record refusal. Implementation/validation evidence remains with the tool and sign-in records. Account Terms bytes/version/digest/history are unchanged; no Privacy Notice or legal adoption is claimed. |
