# Account Terms: draft review and version contract

Prepared 22 October 2026 for the owner's account-creation request. **Draft for
owner and jurisdiction-specific legal review; not adopted, legally approved or
release-ready.** Countries, contracting operator and eligibility remain undecided.
This review supplies account-only text and an exact-content integration contract.
The [legal document register](../LEGAL_DOCUMENT_REGISTER.md) tracks this draft,
related notices and adoption decisions under Hx02's continuing stewardship.
It does not approve public enrollment or change a backend, UI, country policy,
identity workflow, notice or existing accepted record.

## Authored source and scope

The frontend-consumable source is
[`ACCOUNT_TERMS`](../../web/apps/non-verba/src/account-terms.js). Its eight
sections contain 466 words of proposed terms: draft/scope, account details,
separate role/action authority, security, account data/privacy, closure, versions
and non-excludable rights. The full source is the authoritative draft; this
review is not another agreement to incorporate silently.

| Field | Draft value |
| --- | --- |
| `id` | `nonverba-account-terms` |
| `version` | `0.1.0-draft.2` (current); `0.1.0-draft.1` preserved |
| `status` | `draft` |
| `title` | `Account Terms and Conditions (Draft)` |
| `contentSha256` | `6fa35455cdd833e3253f44dbcf7cfb9b61342d2d22fd99a6318996433c7d60a7` |
| Content format | `nonverba-account-terms-jcs-v1` |

28 October 2026 successor: the closure section now says that closing an account
keeps the account record for a retention period, so the account can still be
found if information about it is required. The length of that period is not
selected. Exact `0.1.0-draft.1` bytes remain
[account-terms-0.1.0-draft.1.json](../legal/account-terms-0.1.0-draft.1.json),
digest `88609610130c0a7a2594399402aea6db298f6218b5c91eaa07783bd97b746db4`.
This successor is still a draft. It names no operator, country, or number of days.

The draft supports one account containing both Requester and Operator roles. It
does not treat role availability, confirmed email or a username as identity,
qualification, signing, work/sensor or other domain authority. Signup is account
creation; identity capture/verification remains a separate action. A password
meter is not an assurance decision. No provider linking, billing, settlement,
insurance, union membership or Assignment contract is agreed through this text.

## Existing documents reviewed

- [Governance principles](../../GOVERNANCE.md) expressly remain draft
  constitutional design, not a legal charter. Do not convert those principles
  into adopted institutions or incorporate the whole document by a signup tick.
- [Registration boundaries](REGISTRATION_PIPELINES.md) distinguish local review,
  private fields, optional sharing, identity verification and action authority.
- [Private participant-record checkpoint](SERVICE_PARTICIPANT_RECORDS_CHECKPOINT.md)
  distinguishes synthetic versioned notices from adopted legal terms. Existing
  inspection booleans are insufficient agreement to a newly authored document.
- [Account integration](PARTICIPANT_ACCOUNT_INTEGRATION.md) separates account
  enrollment, PKCE/current context, recovery and exact operation replay. Its
  later linked checkpoints govern the current mock-mail/capture scope.
- [Current capture contract](PARTICIPANT_CAPTURE.md) keeps document/photo
  processing deliberate and transient, separate from account creation and any
  identity verdict. Account terms grant no added collection or custody authority.
- [Test-account deletion](PARTICIPANT_ACCOUNT_DELETION.md) records closure by
  tombstone, fresh IDs on re-registration and retained history/backups. The draft
  therefore does not promise that sign-out or closure purges all previous copies.

No adopted account agreement or complete product Privacy Notice was identified
in these scoped materials. This is a bounded document review, not an inventory
of private legal advice or a claim that no other agreement can exist.

## Exact-content and agreement contract

The module exports `ACCOUNT_TERMS`, `ACCOUNT_TERMS_CONTENT_JSON`,
`ACCOUNT_TERMS_CONTENT_SHA256` and `ACCOUNT_TERMS_CONTENT_FORMAT`. The first
retains the requested `{id, version, status, title, sections}` shape and adds
`contentSha256`. Each section has a title and ordered paragraph strings. The
exported objects/arrays are frozen to prevent accidental edits; that is not an
authorization or tamper-proofing mechanism.

The hash input is **only** the UTF-8 bytes of `ACCOUNT_TERMS_CONTENT_JSON`:

1. The payload is `{id, sections, status, title, version}`. Section objects are
   `{paragraphs, title}`. All values are strings or arrays/objects of strings.
   Object keys use RFC 8785 order; section and paragraph arrays preserve author
   order. JSON serialization uses the standard ECMAScript string encoding.
2. No BOM, trailing newline, indentation or Unicode normalization is added.
   Compare exact canonical bytes, not a rendered DOM, Markdown, minified JS,
   HTML-escaped copy or separately reconstructed plain-text layout.
3. SHA-256 yields the lowercase 64-character hexadecimal digest above. The
   digest itself and transport-format metadata are outside the hashed payload;
   do not hash the expanded `ACCOUNT_TERMS` export containing `contentSha256`.
4. Backend integration should use its independently controlled version catalog,
   validate the exact supported format, id/version/status/hash and current
   enrollment policy, and retain the catalog's exact text bytes with the record.
   A client-supplied hash or document is not authoritative by itself.

Any change to a title, paragraph, order, version or `status` changes the content.
Never replace bytes under an existing id/version. Editorial changes require a
new version and digest; adoption requires a separately reviewed version whose
status and text honestly reflect that decision. Keep historical versions/read
receipts immutable. Do not silently turn `draft` into `adopted` or treat a draft
agreement as agreement to a later final document.

The wire field names remain with the integrating app/backend owners. Their
record needs the exact terms id, version, draft/adoption status, content format,
digest, accepted content bytes and deliberate agreement. Bind presentation and
agreement to the exact enrollment operation/review revision, then the resulting
account/principal when account creation completes. Do not require an account to
already exist merely to read signup terms. Record service-observed time and its
provenance; a client timestamp is not proof of when agreement occurred.

Retries of the exact original operation preserve its historical agreement and
receipt. Changed terms or changed agreement input cannot overwrite an old
operation; require the applicable fresh review/action. A historical successful
receipt is not current authentication, approval of a later version, a task
signature, proof the person read every paragraph, a privacy consent or legal
adoption by the operator. Agreement records require their own access/retention
policy; recording the draft does not select indefinite retention.

## Frontend handoff

The APK chat owns all integration. This task does not change its index, account
client, onboarding UI, native host, active attestation work or backend.

- Offer an accessible full-text view before deliberate agreement, showing title,
  version and **Draft - not adopted** status. Render all sections/paragraphs as
  text; a summary or privacy-policy link cannot substitute for the full terms.
- An appropriate draft label is: **I agree to the Account Terms and Conditions
  (draft 0.1.0-draft.1).** Keep the draft status visible with the control and full
  text. Do not label it legally approved or use it to open public registration.
- Start unchecked. Changing the terms tuple or bytes invalidates agreement and
  affected review. Opening the view, scrolling, a timer, role flags or email
  confirmation cannot check the box or prove understanding. Keyboard/screen
  reader access and an ordinary exit path must work; no forced scroll gate is
  needed as purported proof of reading.
- Keep privacy information, marketing choices, public profile publication,
  identity-media processing/retention and sensor consent distinct. Do not rename
  an old private-data acknowledgment into assent to this document.
- Pending adoption permits only the already authorized development treatment of
  a deliberate agreement to this **draft**. A checked draft must not satisfy a
  backend policy that requires adopted terms. Client and server should expose a
  typed unavailable/stale/adoption-required outcome instead of faking agreement.
- Historical accepted text must stay retrievable in its exact version when
  supported. Decide the actual delivery/access route before public use; this
  module does not implement that route or promise an email receipt.

## Review findings and adoption decisions

Presentation update, 22 October 2026: the owner selected an inline **account
terms** link in the signup checkbox sentence and removed the separate signup
draft/version line. Draft status and version remain in the complete terms view.
This supersedes the earlier presentation recommendation above; the exact draft
text, version, digest and deliberate agreement binding are unchanged. Opening
the link does not toggle consent, and this presentation establishes no adoption.

A later owner-selected interaction adds a checkbox after the complete document.
Checking it synchronizes the signup agreement and returns through the shared
Back action, preserving the form draft. Merely opening or leaving the terms
does not accept them. The checkbox requires a loaded pinned document and current
confirmed enrollment entry; the final account submission still binds the exact
terms version and hash. No document bytes or adoption state changed.

The subsequent owner-selected review gate makes activation of the signup
checkbox open the full document as well, including mouse, Space and associated
label activation. It cannot check or clear agreement itself. Only the control
after the full text changes that choice. This is an explicit review opportunity,
not proof that a person read or understood every paragraph; no scroll or timer
is used as evidence. The exact draft/version/digest and adoption state remain
unchanged.

The owner subsequently retained agreement to that same document while correcting
the username or password, including a refused username submission. These edits
do not withdraw terms agreement. Changed/unavailable terms, explicit withdrawal
or leaving the signup context still reset it; submitted passwords still clear.
The exact terms snapshot remains bound to the final account submission. This
interaction change adds no legal adoption or proof of reading.

The draft deliberately avoids an invented service entity, jurisdiction, worldwide
coverage, age threshold, legal approval, launch guarantee, blanket data license,
indemnity, liability cap, forced arbitration, rights waiver or retroactive terms
change. None should be filled in by backend defaults, locale, IP address or this
chat's timezone. It also makes no production availability or erasure promise.

The owner and appropriate legal reviewers still need the following decisions.
They are adoption gates and review questions, not selected policy:

| Decision | What must be identified or reviewed |
| --- | --- |
| Contracting party and accountability | Legal operator/counterparty, authority to adopt, business/contact/service details and a real complaint/support route. Product branding is not identification of a legal person. |
| Countries and users | Where the account service will actually be offered; establishment/user locations; consumer/business treatment; age/capacity and representation rules; relevant mandatory protections. Do not assume worldwide access from an accessible endpoint. |
| Applicable law and remedies | Applicable local contract/e-signature/consumer rules, legally permissible governing-law/forum choices if any, mandatory rights, complaints, suspension/review and closure processes. Task dispute/settlement terms remain separate. |
| Account offering and money | Exactly what account access supplies, whether any account charge or paid feature will exist, availability commitments and any required pre-contract/cancellation information. This draft creates no charge or subscription. |
| Privacy and security | Responsible controller/custodian, purposes and lawful bases, collected fields/security logs/acceptance records, processors/recipients/transfers, retention and deletion/backup exceptions, recovery and rights channels; a complete separate Privacy Notice. Terms assent is not a universal data-processing consent. |
| Identity and other actions | Preserve separate information/authority for documents, face media, biometrics, sensors, publishing, assignments, payments, membership and agents. Account defaults do not resolve those policies or responsible principals. |
| Adoption and communication | Named authorized approval, reviewed text/status/version/digest, effective applicability, covered languages and accessible full-text delivery. Any required translation needs its own unambiguous version/digest mapping and review. No date of effectiveness is selected here. |

Until these decisions and the applicable legal review are complete, keep the
source status `draft`. Owner review of this artifact is not proof that another
institution adopted it, a qualified lawyer approved it or a country is covered.

## Primary-source legal review references

Reviewed 22 October 2026. These are authoritative review inputs, not a choice of
jurisdiction or a complete legal opinion. The EU examples apply only if their
material/territorial scope and relevant national rules are established; they do
not imply EU-only or global coverage.

- The [UNCITRAL Model Law on Electronic Commerce](https://uncitral.un.org/en/texts/ecommerce/modellaw/electronic_commerce)
  supplies electronic-record and functional-equivalence concepts. A model law is
  not itself an enacted account contract rule for every country; the
  [UNCITRAL status notes](https://uncitral.un.org/en/texts/ecommerce/modellaw/electronic_commerce/status)
  explain that national enactments may differ. Our engineering inference is to
  preserve exact accessible records and attribution, not claim that a checkbox
  or hash establishes enforceability everywhere.
- The [OECD 2016 Recommendation on Consumer Protection in E-Commerce](https://www.oecd.org/content/dam/oecd/en/publications/reports/2016/05/oecd-recommendation-of-the-council-on-consumer-protection-in-e-commerce_g1g66e4e/9789264255258-en.pdf),
  particularly paragraphs 28-37, supports identifiable business/contact details,
  clear terms and a review/correction/confirmation process. It is a policy
  benchmark, not proof of this draft's local legal validity. These disclosure
  gaps explain why an unidentified operator cannot be papered over with branding.
- If applicable, [GDPR Articles 5-7, 12-13 and 17](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679)
  require a purpose/lawful-basis and transparency review and distinguish consent
  from other matters when consent is relied on. Erasure is subject to conditions
  and exceptions. Our design inference is separate notices/purpose-specific
  choices and an explicit retention/rights policy, not blanket consent through
  account terms or an absolute purge promise.
- If applicable, [Directive 93/13/EEC, Articles 3, 5 and 6](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:01993L0013-20220528)
  makes fairness and intelligibility substantive review issues for consumer
  terms, subject to implementing law. Omitting unilateral waivers is a drafting
  precaution; plain language alone does not establish fairness, coverage or
  enforceability. Local review must consider the actual offering and users.

## Verification of this deliverable

Static source JSON, shape, key order and independent SHA-256 inspection passed
22 October 2026, confirming the tuple/digest above and eight complete sections.
The first managed module-import attempt stopped before execution because an
unrelated app-test file changed during source-snapshot creation; the guard was
preserved. The subsequent successful dashboard refresh supplied a fixed source
snapshot, reused through its documented `dev.sh exec` environment with the same
source metadata. The focused Node check then passed import/shape, draft status,
stable tuple, recursive immutability, independently sorted canonical JSON and
SHA-256 comparisons against both the source constant and the expected digest.
No additional test harness or application/backend behavior was introduced.

No APK build, release, deployment, real agreement, backend integration or legal
adoption is performed by this document task. The Hero 2 draft milestone completes
the authored draft/version contract and scoped document review; it does not
complete the pending adoption gate or imply jurisdiction-specific legal approval.
