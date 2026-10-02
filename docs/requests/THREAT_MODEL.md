# Threat model and assumptions

## Adversary and security objective

Any two of R, O and M may coordinate. They can lie, replay old messages, withhold
signatures or records, issue conflicting histories, operate multiple accounts,
and attempt API/admin bypasses. M may control hosting, the database, notifications
and web-application delivery. Neither honesty of M nor absence of private
communications is assumed.

> **No coalition of two parties can create a valid contractual state that improperly alters the third party's rights.**

The objective is that an honest excluded party's verifier accepts no unauthorized
effect on that party. The objective is not that the platform server cannot display
a false label, that every participant learns every event, or that adversaries
cannot prevent progress. An unresolved dispute can be the correct safe outcome.

## Necessary assumptions

| Assumption | What fails without it |
| --- | --- |
| The excluded party controls its signing authority | Stolen/coerced signing authority can produce apparently authorized actions |
| The excluded party runs uncompromised verification/signing software | A malicious client can conceal terms, sign another digest or display a fabricated report |
| Independent role/key binding reflects the intended party | Correct signatures can authenticate an impostor's key |
| Signature/hash/HMAC primitives remain secure | Attribution and content binding can fail |
| The implemented policy exactly limits each effect | A reducer bug can broaden an otherwise authentic authorization |
| Explicit external sources behave as their declared trust model assumes | A payment, time or outcome adapter can import a false authoritative fact |
| Participants durably retain certificates, keys and local refusal history | Loss, rollback or deletion can remove evidence or permit incompatible local signing |

No guarantee covers physical performance, truthful images/GPS, solvency, finality
of reversible payment rails, coercion resistance, uninterrupted availability,
undisclosed side conversations or objective judgment of every physical dispute.
If real and fabricated work produce the same accepted transcript, verification of
that transcript cannot distinguish them. More signatures on the story do not add
missing independent information.

## Coalition cases

| Coalition | Required resistance |
| --- | --- |
| R + M against O | Cannot lower O's price, redirect O's destination, waive O's claim, invent penalties or discharge debt with payer/M assertions |
| O + M against R | Cannot raise R's price, fabricate R's acknowledgment, waive R's remedies or turn a bare completion claim into a debt |
| R + O against M | Cannot expand M's cap/duties, alter triggers, remove defenses or generate new financial exposure through a bilateral settlement |
| M with either beneficiary | Cannot extinguish another party's established assurance rights merely by assessment or refusal |

Allowlisted R/O settlement changes only their permitted balances. All three must
authorize Agreement amendments. A pre-agreed rule can operate without a fresh
signature only within the exact proof/effect scope already authorized by each
affected party. There is no generic majority override.

## Signing-client and update trust

An M-delivered web page can replace signing code even when a device key is
nonexportable. A hardware key signing an undisplayed malicious digest does not
solve consent. The local signing/export-verification interface provides a path
outside that page, but is not by itself a reviewed software supply chain.

Before claiming full mediator resistance, review reproducible/reviewable releases,
authenticated distribution, update authorization and rollback, device key access,
exact preview-to-signature binding, agent delegation and durable local storage.
Participants must obtain the verifier and trusted key bindings independently of
the bundle they are asked to verify. Updating an application does not authorize
rewriting pinned policy in an existing Agreement.

The local development CLI's software-key workflow is not hardware enrollment or
production key custody. R/O private keys must not be sent to M or exposed to a
server account-reset mechanism. Backups and recovery need an explicitly reviewed
scheme. If rotation on an existing Assignment would require unsupported authority,
the intended operating response is to stop new signing and preserve historical
records. There is no implemented account-recovery or administrative freeze
workflow; an admin/password reset supplies no contractual authority. See
[the Agreement's recovery boundary](AGREEMENT.md#amendment-and-settlement).

The current native client encrypts software vaults, evidence and imported/merged
snapshots using AES-256-GCM with a password-derived key. This protects retained
ciphertext under its cryptographic/passphrase assumptions; it does not protect a
compromised unlocked process. Signature reservations live beside the vault in a
`.signing-guards` directory. Copying/restoring only the vault or rolling back these
ordinary files can permit conflicting local authorizations. Keep guard history
with the key backup. There is no hardware rollback counter. Windows inherits
parent-directory ACLs, and the stdin passphrase path may echo terminal input.

## Partial views and local safety

Verify supplied bytes, not database statuses. Missing causal records produce
incompleteness; known conflicting signed records produce scoped conflict. Neither
implies a complete global history. Preserve both branches and independent
obligations. Do not treat concurrent R/O submissions as author equivocation.

The corrective requirement is exact:

> An authenticated contradiction is evidence of misconduct or uncertainty; it is not, by itself, authority to revoke a right previously established for another party.

Stream health is therefore separate from an exact authenticated proof and from a
financial grant. Appending a contradictory receipt or unrelated mediator fork
cannot reverse established coverage. New scoped reversal needs its own required
authorization. Missing evidence bytes produce incomplete integrity, not automatic
forfeiture. Old-rule cutover uses positive causal successor knowledge and explicit
grandfathering, never a claimed global latest state or server clock.

Late delivery and delayed signature completion are adversarial history extensions.
They must not make a previously nonessential contextual transaction a financial
veto. The NV2-01 example appends or completes conflicting R/O expense certificates
behind an already authorized M service activation. The required outcome preserves
the active fee and reports the expense conflict separately. This is distinct from
a genuinely conditional historical claim or a missing named obligation proof.

The knowledge graph admits a shape-valid proposal only with at least one actual
pinned signature; effect admission still requires all rule-specific authorizers.
Partial proposals expose their attributed references without authorizing money or
activating a successor Agreement. Required-effect proof is selected by the closed
rule. Invalid wrappers cannot authenticate knowledge, while authenticated context
continues to support positive successor-knowledge and provenance checks even if
its own financial effect is unresolved.

When old entitlement ordering or a joint expense cap remains unresolved, the
report preserves each independently valid financial proof with its conditional
principal/discharge/release in `unresolved_rights`. Do not add those alternatives
together or turn an absent active line into zero debt. The
`PARTIAL_UNRESOLVED_V2` projection distinguishes this ambiguity from a rejected
proof and from a fully supported active obligation.

Protocol-1 inspection deliberately produces no financial aggregate. It preserves
original proofs with `LEGACY_UNRESOLVED`; no unprojected amount is represented as
zero or silently translated into new protocol-2 allocations.

The current local client uses immutable files and signing reservations. A future
hosted store needs its own transaction and idempotency controls; those controls
would not constrain a malicious database operator. Participants' retained complete
certificates and independently checked exports make unsupported edits detectable
in those local views. Deletion of undisclosed history may remain undetectable.

M-controlled time, missing notifications and a local absence-of-complaint query
cannot prove silence/consent. Unsupported deadlines cause no forfeiture or debt
cancellation. Last-signature withholding, refusal to reveal and refusing a receipt
can block progress. The protocol records those limits without inventing judgment.

## Privacy and sensitive evidence

Signed does not mean encrypted. Raw evidence and exported bundles may reveal
identity, location, private text, media and payment references. Production storage
requires scoped access, authenticated encryption, key/access lifecycle, transport
protection, retention/deletion enforcement and audit. The local encrypted snapshot
and evidence commands implement authenticated encryption for local files only;
explicit exports/decryption create plaintext and leave source files in place.
A digest or commitment alone provides no confidentiality. Avoid sensitive real
evidence in unprotected development fixtures, logs and shared folders.

Commit–reveal uses a fresh private salt for each author/round. Do not expose the
salt or sensitive manifest before reveal. A participant may voluntarily leak its
own submission or refuse to reveal; M cannot promise secrecy after receiving the
honest party's plaintext. Record early disclosure and supplementary evidence
honestly. Access policy and content confidentiality require storage adapters beyond
the deterministic verifier.

See [readiness](READINESS.md) for deployment restrictions and review work.
