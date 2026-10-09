# Registration pipelines: ready to inspect, ready to grow

Registration should welcome a person without making them surrender their privacy
or mistake a form for proof of identity. An Operator should be able to describe
the support they need and the qualifications they bring. A Requester should be
able to do the same. Neither should need to disclose a disability to participate.

The current implementation is an isolated browser inspection workflow for
**Operators and Requesters**. It prepares a local registration record; there is
no account server. It does not create an account, authenticate a person, verify
identity or qualifications, publish a profile, or connect devices. Keep existing
developer tools directly accessible. Assemble the actual app in a later, explicitly
requested integration.

## The pipeline available now

Open [registration inspection](../../web/src/registration.html). The guided flow
collects personal details, optional accessibility needs, optional certifications,
privacy choices and a final review. Requesters have these five steps. Operators
have a sixth step before the final review: deliberate local face reference
enrollment. Both roles use the same reusable registration workflow and shared
Rust policy; the selected role is retained explicitly in the result. Requester
registration has no face step and instantiates no biometric model or store.

Display name and contact email are draft contact information. Legal name and
organization, country/region and preferred language are optional. Email syntax
checks do not prove mailbox ownership;
names and organizations remain self-reported. This inspection is for synthetic
details. It deliberately avoids passwords, government documents, medical records,
and automatic sensor collection. Only the separately started Operator face step
can open a bounded camera operation; entering personal details opens no sensor.

The disability/accessibility form asks about practical accommodations or support
needs, in the participant's own words. It is optional, and skipping it does not
block preparation. Do not request a diagnosis, medical proof or disability rating
by default. The note is private and excluded from the public profile candidate.
An explicit optional preference can express future sharing with a task
counterparty; it sends nothing and grants no general access.

Certifications are structured entries with a title, issuer, reference and optional
issue/expiry dates. They are **self-reported and unverified**. An expiry date is
reported information, not proof that an issuer recognizes a credential. Neither
role must supply a certification to prepare a draft. Future tasks may have
separate, specific qualification requirements.

Privacy review separates acknowledgment of this inspection's data handling from
optional future sharing. Publishing the display name or organization is off by
default. Private contact details, legal name, accessibility notes and certification
references do not silently become searchable profile content. A public profile
candidate contains only the deliberately selected fields; it is never published
by this workflow.

The final step reviews the exact current draft before **Prepare local
registration**. Any edit invalidates the review and prepared result, requiring a
new review. A changed or deleted face reference also invalidates Operator review
and preparation. Cancellation/reset discards the form draft, result and transient
face capture. Form data lives in page memory only: no personal form storage,
upload, download or server submission. Reloading starts a new form draft.

Operator face retention is a separate, deliberate action. After a quality-accepted
local capture, explicit processing and retention consent plus review are required
to enroll the 128D feature reference. It is bound to the selected account and
principal, encrypted in device-local IndexedDB and retained across reload/reset
until explicitly replaced or deleted. The photograph is discarded after feature
extraction and is never retained in that store. Reference metadata shown in review
does not expose the feature vector or publish it in the profile candidate.

An existing compatible reference can satisfy the Operator enrollment step without
asking for another capture. Replacement requires a newly reviewed capture and a
deliberate replacement action. Deletion is explicit and checks that the reference
has not changed concurrently. An unreadable record can be deliberately replaced
or deleted; it is never silently accepted or overwritten. This inspection uses
the visible synthetic account binding, not a real account enrollment service.
See [Operator face pipeline](OPERATOR_FACE_PIPELINE.md) for storage limits and
the boundary between matching and identity verification.

## Keep these four boundaries separate

| Boundary | What it establishes | Current result |
| --- | --- | --- |
| Registration | The participant's chosen role, supplied details and privacy preferences | Local record prepared for review |
| Identity verification | Evidence and a decision about the person or organization behind an account | Not implemented |
| Authentication | Whether the expected account user is present at login or a required task check | Separate [authentication inspection](AUTHENTICATION_AND_WORK_PRIVACY.md); Operator feature comparison available, liveness and trusted capture unresolved |
| Authorization | Permission for a specific action, task, device, publication or contract signature | No authority issued by registration |

A completed form is not a verified identity. A certification entry is not an
issuer's approval. A sharing preference is not an upload. Preparing a record does
not clock anyone in, change hold/clock-out, start a sensor or grant signing rights.
The face reference records enrollment continuity without verifying legal identity.
Future recurring authentication can reference a separately verified registration
identity, but must retain its own purpose, result, validity and revocation rules.

## What is still missing, and why it matters

The next step is to connect this prepared record to a trustworthy account
lifecycle. Adding a server endpoint alone would leave the most important promises
unfinished: who controls an account, which devices can act for it, and who can see
its most personal information.

| Future capability | Work needed before actual-app use |
| --- | --- |
| Real account enrollment | Define account IDs, role changes, uniqueness, duplicate handling, durable transactions and confirmation. Verify contact ownership separately from form validation. Preserve draft/error recovery without accidentally submitting twice. |
| Google account linking | Select the provider flow and requested scopes, bind a verified provider identity to the intended account, and handle linking, unlinking, conflicts and recovery. Google login is neither identity verification nor proof of a certification. No provider buttons or tokens are simulated here. |
| Access from another device | Define enrollment approval, session/device keys, account binding, synchronization, revocation and lost-device recovery. Reuse the account-wide work privacy boundary; a new login must not undo hold or clock-out. A copied local record is not device access. |
| Registration identity verification | Choose the evidence, validator, review/appeal process and reference binding. Define when it is required for each role, who receives evidence, and its retention/deletion. Keep that decision independent of enrollment continuity and later authentication. |
| Operator authentication assurance | Calibrate the selected face comparison pipeline at the required low false-match operating point, including acquisition failures and relevant capture conditions. Define liveness, trusted capture, credential combination, threshold policy and recovery. A retained reference or an experimental match is insufficient. Requesters remain free of face requirements. |
| Certification verification | Define issuer lookup or evidence review, credential identifiers, status/expiry checks, renewal, revocation and disputes. Model pending, verified, rejected and expired states distinctly. Do not promote self-reported entries automatically. |
| Sensitive information handling | Define protected storage, transport, access controls, retention, correction/deletion and backups before retaining real accessibility or identity data. The local encrypted face store and its non-extractable key share the browser origin's trust boundary; it is not a server vault, backup or cross-device account store. Scope counterparty sharing to a named task/recipient and explain what happens to already shared copies. |
| Published profile and discovery | Let participants preview exactly what others see; publish through an explicit authorized action. Keep private notes and authentication media out of search. Hold/clock-out/sign-out must retain an already published profile without fresh sensing. |
| Privacy and terms records | Write the actual product notices and applicable terms, version them, and record their separate acceptance where needed. The inspection acknowledgments are not acceptance of future contracts, medical-data policies or unspecified legal terms. |
| Organizations, teams and agents | Identify the responsible principal and delegated authority. A supplied organization name, robot identity or account login does not establish permission to sign for another party. The current human-facing form does not enroll a team or machine. |
| Product assembly | Connect registration, verified account status, reusable authentication, tasks, notifications and every sensor entry point. Keep enrollment separate from availability and scoped sensor consent. Validate the complete privacy boundary before presenting it as account-wide protection. |

Operator registration remains free under the existing
[participant policy](../notes/assignments/PARTICIPANT_NOTES.md#who-takes-each-role).
Requester charges, contractual acceptance and any task-specific eligibility belong
to their own workflows; registration does not implement billing or contractual
consent. Avoid repeatedly asking Operators for information that can be reused
under a selected policy. Optional accommodations should help someone participate,
not become a hidden search ranking or exclusion signal.

## Implementation and focused checks

The [Rust module](../../code/crates/nonverba-core/src/registration.rs) validates
drafts, derives the limited public candidate and requires deliberate preparation
of the reviewed revision. Its JSON/WASM interface is exposed through the existing
core Worker. The [workflow adapter](../../web/src/registration-workflow.js) owns
page-memory drafts and fences late replies after edits/reset; the
[UI](../../web/src/registration-ui.js) presents the guided forms and safe review.
The selected Operator face step composes the existing bounded authentication
camera workflow with local MobileFaceNet/YuNet inference and explicit encrypted
reference retention. It requires a separately prepared, pinned local model/runtime
bundle. Missing assets fail closed; preparation never downloads a model on demand
or contacts a third-party service.

Run inside the documented managed Debian container:

```sh
node --run test:registration
node --run test:browser:registration
node --run test:operator-face
node --run test:browser:operator-face
```

The first checks shared policy and adapter behavior. The second builds the actual
WASM and exercises both roles, optional data, privacy choices, validation, review
freshness, reset/reload and browser isolation. Record executed checks in
[validation](VALIDATION.md). These checks establish local component behavior;
they do not establish durable account creation, biometric authentication accuracy
or the future services above. See the [face pipeline setup and limits](OPERATOR_FACE_PIPELINE.md)
before running model-dependent checks.
