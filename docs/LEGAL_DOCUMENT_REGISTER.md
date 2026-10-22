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
22 October 2026. “No document version” means the source has no dedicated version
identifier; it is not permission to invent one. Repository history tracks those
edits. Private agreement, notice and acceptance bytes stay private; the public
checkpoint supplies a pointer and its limits.

| Record | Canonical source and version | Current state | Next review trigger or decision |
| --- | --- | --- | --- |
| Account Terms | [Full draft](../web/apps/non-verba/src/account-terms.js), `nonverba-account-terms`, `0.1.0-draft.1`; exact digest below | Draft, not adopted. [Signup integration](development/PARTICIPANT_SIGNUP.md) documents the inline link and signup checkbox opening full-text review, agreement only at the document end, draft/version display, exact-content comparison and a retained development agreement. | Resolve the [adoption decisions](development/ACCOUNT_TERMS_REVIEW.md#review-findings-and-adoption-decisions); review any account offering or agreement-flow change. |
| Account Terms review | [Review and version contract](development/ACCOUNT_TERMS_REVIEW.md), prepared 22 October 2026 | Drafting and conditional primary-source review record; no legal approval | Revisit applicable sources when countries, operator, users or offering are selected, or a relevant rule changes. |
| Browser login-key retention coverage | [Tool behavior](sensors/ATTESTATION_TOOL.md) and [account consumer](development/PARTICIPANT_SIGNIN_DEVICES.md), no document version; technical checkpoint checked 22 October 2026 | Owner-selected automatic origin-local key retention profile, recorded below; implementation/validation evidence remains with the linked technical records. No adopted Privacy Notice is recorded. | Keep notice coverage aligned with account-specific continuity, browser storage/clearing, recovery, capacity and fallback behavior; resolve the pending privacy and adoption decisions below. |
| Recovery-code export coverage | [Shared signup/export behavior](development/PARTICIPANT_SIGNUP.md#recovery-codes-and-download) and [service checkpoint](development/SERVICE_ACCOUNT_LIFECYCLE_CHECKPOINT.md#recovery-code-set-continuation--22-october-2026), no document version; checked 22 October 2026 | Eight independent memory-only codes, explicit user-selected plaintext `.txt` export, no saved-code acknowledgment. The service retains hashes; one code plus separate email proof rotates the entire set. Legacy factors remain compatible. No adopted Privacy Notice is recorded. | Cover the explicit export purpose, user-selected file storage and user-controlled deletion, page/native pending-data lifetime, hash retention and full-set recovery rotation in the pending Privacy Notice. Physical Android picker acceptance remains pending. |
| Username sign-in routing coverage | [Shared entry behavior](development/PARTICIPANT_SIGNUP.md), no document version; checked 23 October 2026 | Public handles or email proceed locally to password without a lookup or email challenge. The confirmed contact is returned only after successful password authentication and current binding; generic credential denials do not publish an account directory. Signup and recovery retain their email proofs. Existing PKCE/device steps remain. | Include alias use, authentication records, throttling and retention in the pending account Privacy Notice. This selects no new legal basis, notice adoption or real-person assurance. |
| Workflow identity prerequisites | [Shared participant enforcement](../web/apps/non-verba/README.md#identity-prerequisites--22-october-2026), no document version; checked 22 October 2026 | Request creation requires basic identity verification; operation creation and offers require advanced verification. The current pending-only account contract unlocks neither. Email confirmation, photos and attestation do not establish person verification. | Define the actual verification authority, decisions, data handling and applicable notices before connecting eligibility or enabling work mutations. The current UI gate establishes no server-side person-verification policy or legal adoption. |
| Synthetic identity notice | [Shared enrollment source](../code/test/fixtures/identity/synthetic-enrollment-workflow.js), `synthetic-identity-enrollment`, version `1` | Illustrated-fixture processing/retention notice; no real identity or liveness decision | Any notice, media, purpose, recipient or custody change; keep real-data use pending. |
| Private participant notices | [Public service checkpoint](development/SERVICE_PARTICIPANT_RECORDS_CHECKPOINT.md), dated 21 October 2026 | Separate versioned synthetic retention, unverified-certification and publication notices. Exact text/version/digest are private; this checkpoint does not expose their catalog identifiers. | Hx11 supplies a shareable catalog reference/version-change record when these notices change; preserve private originals and earlier acknowledgments. These are not adopted legal terms. |
| Governance principles | [Governance](../GOVERNANCE.md), `0.1` | Draft constitutional design, not a legal charter | Chosen legal structure, institutions, rights, authority or adoption changes. |
| Source license | [LICENSE](../LICENSE), GNU AGPL version 3; [repository application](../README.md#license-and-contributions) selects `AGPL-3.0-only` | Existing source license, separate from account agreements; earlier Apache grants remain recorded in the README | Any licensing, contribution or distribution change; preserve existing grants and corresponding-source notices. |
| Contribution conditions | [CONTRIBUTING](../CONTRIBUTING.md), no document version | Existing contribution and intellectual-property guidance | Contribution conditions, provenance, licensing or publication workflow changes. |
| External licenses and attribution | [Third-party index](../THIRD_PARTY_NOTICES.md), no document version; individual notices and model lock linked there | Existing material-specific notices; dependency/model/data rights remain separate | Added, changed or distributed external material. Keep the index and applicable individual notices together; an entry is not new rights clearance. |
| Security reporting | [SECURITY](../SECURITY.md), no document version | Existing reporting guidance | Reporting contact, process, supported scope or disclosure-policy changes. |

### Account Terms version record

| Version | Status | Content format | SHA-256 |
| --- | --- | --- | --- |
| `0.1.0-draft.1` | `draft` | `nonverba-account-terms-jcs-v1` | `88609610130c0a7a2594399402aea6db298f6218b5c91eaa07783bd97b746db4` |

The digest covers exactly `ACCOUNT_TERMS_CONTENT_JSON` as UTF-8 without a BOM or
trailing newline. The [review contract](development/ACCOUNT_TERMS_REVIEW.md)
defines the canonical fields and agreement binding. Preserve this version and
its accepted bytes when adding a successor. Keep earlier version rows and their
retrievable text; changed content requires a new version and digest. No adopted
Account Terms version is recorded here.

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
| Real identity and biometric processing | [Enrollment scope](development/IDENTITY_ENROLLMENT_SLICE.md), [capture](development/PARTICIPANT_CAPTURE.md) and [data lifecycle requirements](development/REGISTRATION_PIPELINES.md), technical/design records | Custodian, processing purpose, role policy, recipients, retention/deletion, recovery and decision authority, with distinct notices/choices as applicable. Real-data storage and identity verification remain pending. |
| Account support and closure | [Current test-account deletion](development/PARTICIPANT_ACCOUNT_DELETION.md) and Account Terms review | Adoptable support, complaint, suspension/review and closure policy plus retention/erasure explanations. Current tombstoning is not a history, shared-record or backup purge promise. |

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
