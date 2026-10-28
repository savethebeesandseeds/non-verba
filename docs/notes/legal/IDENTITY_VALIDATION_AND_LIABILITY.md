# Identity validation and liability notes

**Status:** Owner direction for product language and trust design  
**Recorded:** 27 October 2026  
**Steward:** Hx02

These notes record the owner's stated boundary for how Non-verba may describe
people, documents and account checks. They are working legal direction for copy
and product design. They do not adopt a notice, amend Account Terms, or name
an operator. No issuing-body check is implemented. ID-photo and face-photo
handling remains best-effort account process.

The [legal document register](../../LEGAL_DOCUMENT_REGISTER.md) indexes this
note. Synthetic intake text stays in the
[identity-intake notice](../../../web/apps/non-verba/src/identity-intake-notice.js).
Exact historical notice bytes stay in [docs/legal/](../../legal/).

## Country

Country is a detail this record does not have. Maps, fixture country codes,
self-reported profile fields and research mentions are not a selected country.
The legal notes do not claim one.

## Validation language

Non-verba must not claim that a person is "verified" or "real" unless that
claim was actually checked with the relevant issuing bodies. A photo of an
identity document plus a face photo does not meet that bar. Calling the person
verified, real, authentic, or confirmed as that document's subject would
overstate the check.

Uploaded diplomas and certificates use the safe display pattern:
**user-uploaded, unverified**, with a clear disclaimer. Showing the file,
the title the user typed, or the issuer the user named does not verify the
credential. The isolated registration inspection already follows this pattern:
entries stay self-reported and unverified, and the participant acknowledges
that before preparation. Naming an issuer there does not verify a certificate.

The word **validating** is acceptable as a process description for account
validation by an ID photo and a face photo. It describes the step Non-verba is
performing. It is not a guarantee that the document, the face, or the person
is authentic.

## Negligent misrepresentation

Hosting material a user supplied, in the way a classified listing hosts a
user's own words, keeps the platform in a content-hosting posture. The owner's
stated exposure changes when Non-verba appears to vouch for the person or the
credential. Displaying someone as verified, ranking them on that basis, or
letting a badge drive trust in a transaction moves the posture from mere
hosting toward recommender liability.

A concrete case of that shift: a badge that presents a fake veterinary diploma
as checked, then is used to take money. The owner identifies that pattern as
negligent misrepresentation exposure. A user-uploaded, unverified diploma with
an explicit disclaimer stays on the hosting side of this line. A badge, rank,
or "verified" label that a counterparty can rely on for payment does not.

## Identity binding

An ID photo together with a face photo can create an illusion of authentic
people for both requesters and operators. The owner treats that binding as
best-effort, not proof. Design, stamps, alt text, status labels, eligibility
copy and notices have to say so. A successful comparison, a stored receipt, or
a reviewer action inside a synthetic exercise does not become proof that the
account holder is the person on the document.

## Photo wording — 27 October 2026

The participant labels name the photos that were collected. A missing level
says **No ID and face photos**. A recorded level says **ID and face on record**.
A submission waiting for a reviewer says **Awaiting review**. The setup screen
says that a document photo and a face photo are kept with the account and are
not confirmed with the issuer.

The same words replace the earlier **Verified**, **On file**, and "identity
verification" labels on the account action, the request and operation
prerequisites, and the Level 2 error. Internal status fields are unchanged.
The stamps can still gate Requests and Operations. The pending account
contract does not award either stamp. This wording can be upgraded when a
stronger check is actually added. It is not an issuing-body check.
The 23 October seals remain the stamp artwork.

## Hero record — 27 October 2026

A short review left legal work on Hero 2. The eleven-Hero outline stays as it
is. The continuing legal goal is to keep drafts and trust language honest.
Account Terms adoption stays proposed and unstarted. The old certification
goal no longer describes a trusted-verification process; it stays empty until
an issuing-body check is actually chosen. Governance still holds legal form
and launch. No country is claimed. No notice text changed.
