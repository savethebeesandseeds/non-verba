# Security properties and design record

Reviewed 2 October 2026 against the repository source, its component threat
models and the primary references linked below. This record compiles the owner's
two security checklists into a guide for design and review. It answers:
**What do we protect, how, under which assumptions, and what happens when those
assumptions fail?**

This is a source and documentation review, not a new test run, independent audit
or proof of production security. An implemented mechanism provides a scoped,
conditional property; it does not mean the whole property is solved. Proposed
controls below require separate design, implementation and validation.

## Scope and reading guide

Confidentiality, integrity and availability form the CIA triad: restrict
disclosure, resist improper modification or destruction, and provide timely,
reliable access. See [NIST FIPS 199](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.199.pdf).
Authentication, authorization, non-repudiation and accountability extend this
checklist. These properties overlap and include operational controls as well as
cryptography; the seven entries are a project review framework.

Non-verba combines cooperation calculations, assignment records, dispute
analysis and sensor evidence. Each keeps its own trust boundary. R means
Requester, O means Operator and M means Mediator. Read the
[assignment threat model](requests/THREAT_MODEL.md) and
[sensor security boundaries](sensors/SECURITY.md) with this record. The
[readiness record](requests/READINESS.md) describes deployment restrictions;
the [validation record](development/VALIDATION.md) records actual checks.

| Property | Current implementation and scope | Principal unresolved boundary |
| --- | --- | --- |
| Authentication | Signatures checked against independent key pins; separate Android key-enrollment verification | A key is not a verified person; enrollment does not authenticate later sensor readings |
| Authorization | Exact Agreement, pinned policy and action-specific authorizers | Compromised signing software/keys; no general live role-revocation or recovery service |
| Integrity | Canonical signed records, hashes, author-stream chaining and causal references | Complete, latest, globally consistent history is not established |
| Non-repudiation | Retained signatures provide evidence of use of a pinned key | Human consent, trustworthy signing time and attribution after compromise |
| Confidentiality | Authenticated encryption for specified local files; salted dispute commitments | Plaintext processing/exports; no implemented homomorphic computation or secure multiparty computation |
| Availability | Local retained records and portable verification | No implemented database replicated across independent hosts or production availability guarantee |
| Accountability | Attributed signed records, inspectable proofs and retained analysis records | Undisclosed history, key-to-person binding and unverified model execution |

## 1. Authentication

**Question:** Which entity or key made this statement? Authentication can concern
a user, process or device; it is broader than identifying a person. See the
[NIST authentication glossary](https://csrc.nist.gov/glossary/term/authentication).

**Current mechanism.** Assignment signatures use independently trusted role/key
bindings. Sensor signatures use independently supplied signer pins. The Android
enrollment verifier separately checks the attestation chain, original challenge,
key, expected application identity, boot/security properties, patch policy and
revocation inputs. An artifact signature under the enrolled key supplies the
separate proof of possession. The implemented path is Android hardware key
attestation; Play Integrity and Apple App Attest are not implemented integrations
in this checkout.

**Assumptions and weakness.** Key bindings, verifier software and trust material
must be obtained independently of the evidence under examination. Hardware
claims depend on the accepted attestation authorities and device security. The
enrollment concerns reported state at key generation, not the current app, OS,
camera frame or physical location. Application identity includes software-reported
claims. Google's guidance likewise requires independent verification of chains
and revocation: [Android key attestation](https://developer.android.com/privacy-and-security/security-key-attestation).

**When an assumption breaks.** Wrong pins, invalid chains, unsupported profiles
and stale/revoked trust inputs fail the relevant checks. A compromised trusted
authority or falsely enrolled human identity can still produce accepted claims;
the verifier cannot discover that from a valid signature alone. The operational
response must stop relying on the affected identity/trust profile and preserve
the evidence. Rebinding and recovery need explicit authority and review; neither
an included public key nor an administrator reset supplies that authority.

Evidence: [assignment cryptography](../code/requests/src/crypto.rs),
[key-attestation verifier](sensors/KEY_ATTESTATION_VERIFIER.md) and
[native enrollment](sensors/NATIVE_KEY_ENROLLMENT.md).

## 2. Authorization

**Question:** May this actor perform this exact action with these consequences?
Authentication of a signature is only an input to that decision. See the
[NIST authorization glossary](https://csrc.nist.gov/glossary/term/authorization).

**Current mechanism.** R, O and M must authorize the same exact Agreement for
base formation. Subsequent effects follow a closed authorizer matrix and bind
their Agreement, policy, role, purpose, domain and scope. For example, an R/O
settlement requires R and O and cannot release M's separate rights; an Agreement
amendment requires all three. A pre-agreed artifact rule can operate within its
already authorized proof/effect scope without a fresh signature. Priors provide
signed analysis context with financial authority `NONE`, mode `ANALYSIS_ONLY`
and settlement policy `UNSPECIFIED`; they do not grant payment authority.

**Assumptions and weakness.** The signer controls its key, sees the exact terms
and uses uncompromised signing/verification software. The implemented policy
must correctly limit each effect. A signature authenticates the pinned
contractual role; there is no general service establishing that a person still
holds a changing real-world role. Narrative contract text is not automatically
executable policy or proof of its fulfillment.

**When an assumption breaks.** Missing required signatures and scope/context
substitutions cannot authorize the effect. A stolen key or malicious signing
client can create apparently valid consent. The documented intended response
to unsupported recovery is to stop new signing and preserve records. No automatic
account freeze or key-rotation workflow is implemented. Future recovery must
define its authority without creating an administrator bypass or rewriting
existing rights.

Evidence: [Agreement](requests/AGREEMENT.md),
[authorizer matrix](../code/requests/src/actions.rs) and
[dispute-priority boundary](requests/DISPUTE_PRIORS.md).

## 3. Integrity

**Question:** Are these the authentic bytes and references, without an
unauthorized modification? This is separate from whether their claims are true.

**Current mechanism.** Assignment records use strict canonical JSON, SHA-256,
pinned signatures, per-author sequence/predecessor hashes and explicit causal
references. Local storage refuses replacement through its immutable-write
interface. Evidence verification checks the supplied bytes against their signed
digest and length; sensor formats add their own signed content bindings.

**Assumptions and weakness.** Primitives, parsers and verifiers must be sound,
and participants must retain authentic records and comparison points. An honest
copy helps expose a conflicting view only when it is available and compared.
Hash chaining and signatures make supplied history checkable; they do not prevent
deletion, authenticate an unanchored replacement history, or guarantee a complete
and current global log. A host can withhold records or serve a valid stale prefix.
Ordinary local files are not tamper-proof storage.

**When an assumption breaks.** Altered content is rejected; missing referenced
records produce incompleteness; known authenticated conflicts are reported in
their scope. Completely undisclosed history may remain undetected. Preserve
both conflicting branches and independently established rights rather than
choosing a server's latest label. External checkpoints, history comparison and
rollback detection remain design work for any stronger global-history claim.

Evidence: [encoding](../code/requests/src/encoding.rs),
[signed author streams](../code/requests/src/transcript.rs),
[local-view verifier](../code/requests/src/bundle.rs) and
[partial-view threat model](requests/THREAT_MODEL.md#partial-views-and-local-safety).

## 4. Non-repudiation

**Question:** What evidence can another verifier inspect when an actor denies
a statement? Digital signatures support attribution and evidence of signing;
see [NIST FIPS 186-5](https://csrc.nist.gov/pubs/fips/186-5/final).

**Current mechanism.** Exact contract authorizations, signed observations,
prior profiles/annex endorsements and sensor artifacts can be retained and
independently verified under pinned keys. Coverage is record-specific. A
model-produced analysis or its stored hash is not automatically a participant's
signed acceptance or binding dispute outcome.

**Assumptions and weakness.** Keys, bindings, signed bytes and signing-client
consent must remain trustworthy. A signature does not by itself establish a
human's understanding, absence of coercion, physical performance or a trustworthy
signing time. Key compromise permits forged statements; it does not automatically
change previously retained signed bytes or prove every earlier signature false.
Without independent timing/evidence, distinguishing earlier genuine statements
from later forgeries or backdated claims can be difficult.

**When an assumption breaks.** Preserve the exact signed record, trust context
and independently observed copies; stop new use of the suspected key. The
current verifier does not resolve when a party key was compromised. A future
recovery policy needs a historical-evidence rule and authorized key lifecycle.
Trusted timestamps can help establish prior existence, with their own trust
assumptions; [RFC 3161](https://www.rfc-editor.org/rfc/rfc3161.html) describes this
building block. No such timestamp service is implemented here. Blanket deletion
of historical rights is not a recovery mechanism.

Evidence: [signature claims](../code/requests/src/crypto.rs),
[analysis retention and limits](requests/DISPUTE_PRIORS.md#retention-replay-and-remaining-limits)
and [recovery boundary](requests/AGREEMENT.md#amendment-and-settlement).

## 5. Confidentiality

**Question:** Who can learn which data, during storage, transfer, computation
and export?

**Current mechanism.** The assignment local client encrypts software vaults,
evidence and snapshots with AES-256-GCM and a password-derived key. Salted
HMAC commitments bind dispute submissions before reveal. These protections have
different purposes: a commitment is not encryption or permission control.
Processing and explicit exports can expose plaintext, including evidence shared
with the local analysis runner. Sensor proofs disclose the recorded material
and metadata to their recipients. Local vault protection varies by client.

**Assumptions and weakness.** Passphrases, randomness, cryptographic code and
unlocked endpoints must remain trustworthy. Recipients can disclose plaintext;
digests and metadata may also reveal information. Local computation by each
participant is not homomorphic encryption or a proof that only the result leaks.
Homomorphic encryption evaluates functions on ciphertext; secure multiparty
computation is another specific protocol family. See
[NIST's privacy-enhancing cryptography tools](https://csrc.nist.gov/Projects/pec/pec-tools).
Neither is implemented in the reviewed source.

**When an assumption breaks.** Wrong passphrases or altered authenticated
ciphertext fail decryption. Endpoint compromise or an authorized recipient's
disclosure can leak plaintext without a cryptographic error. The design response
must limit disclosure and recipients, define transport/access/key and retention
policies, and address affected credentials. Revoking access cannot recall copies
already disclosed. Any proposed private-computation design needs explicit inputs,
outputs, parties, adversary assumptions, allowed leakage and independent review.

Evidence: [local encryption](../code/requests/src/local.rs),
[commitments](../code/requests/src/crypto.rs),
[privacy threat model](requests/THREAT_MODEL.md#privacy-and-sensitive-evidence) and
[portable analysis exports](requests/DISPUTE_PRIORS.md#retention-replay-and-remaining-limits).

## 6. Availability

**Question:** Can participants obtain evidence and perform the needed operation
within an acceptable time, including during failure or attack?

**Current mechanism.** Local retained certificates, encrypted snapshots and
portable exports support independent inspection without trusting a host's
database status. Requester sessions retain evidence and replay state locally.
This is useful resilience, but the reviewed source does not implement a database
replicated across independent hosts. Treat that architecture as proposed.

**Assumptions and weakness.** Devices, keys, storage, verification software and
necessary trust inputs must remain accessible. A participant may withhold a
signature, receipt or evidence and block progress. Disk loss, origin-storage
deletion, resource exhaustion and unavailable dependencies are distinct failure
modes. Replicas alone would not solve lost keys or participant refusal; a future
replicated design must address partitions, consistency and correlated failures.

**When an assumption breaks.** Missing data or stale required attestation trust
material can prevent verification/acceptance. This must not silently waive a
security requirement or cancel another party's independently established rights.
Retained complete records can still support historical inspection where their
verification inputs are available. Backup/restore, failure isolation, bounded
resource use and recovery objectives require operational design and validation;
there is no deployed failover guarantee in this prototype.

Evidence: [local retention](../code/requests/src/local.rs),
[shared requester storage](../web/src/agent-evidence-storage.js),
[live-location sessions](sensors/LIVE_LOCATION_SHARED.md) and
[availability limits](requests/THREAT_MODEL.md).

## 7. Accountability

**Question:** Can an action be traced to its responsible actor with enough
evidence to inspect and challenge it? See the
[NIST accountability glossary](https://csrc.nist.gov/glossary/term/accountability).

**Current mechanism.** Signed author streams, action authorizations, dispute
source records, explicit proof references and signed sensor artifacts provide
attribution under supplied key bindings. Retained analysis exports include
selected evidence, prompts, specifications, attempts and challenges. An
attestation hash identifies bytes; its verified chain and context are needed
to interpret what those bytes establish.

**Assumptions and weakness.** Evidence must survive, be available to an
independent verifier and be correctly bound to the intended actor. Known missing
references can be detected; an entirely omitted action may leave no visible gap.
A shared/stolen key weakens actor attribution. Hash-consistent analysis records
do not prove execution with the claimed weights or correct reasoning. Attribution
of a claim is separate from factual correctness, fair judgment or authority to
impose a sanction.

**When an assumption breaks.** Report incomplete evidence and uncertainty,
retain contradictory records, and permit independent inspection. Do not replace
missing evidence with a model's confident conclusion. A future audit process
needs rules for required records, access, retention, omissions and investigation.
No universal completeness or automatic punishment mechanism is implemented.
The [candidate deterrents](requests/research/PRINCIPLES_OF_DISPUTE_RESOLUTION.md#4-candidate-deterrents-outside-the-payment-flow)
remain proposed and supply no new financial authority.

Evidence: [transcript reports](../code/requests/src/transcript.rs),
[bundle proofs](../code/requests/src/bundle.rs) and
[analysis limitations](requests/DISPUTE_PRIORS.md#retention-replay-and-remaining-limits).

## Additional properties to review

These cross-cutting questions prevent the seven properties from being mistaken
for a complete security claim.

| Property | Present boundary | Failure response or open design question |
| --- | --- | --- |
| Freshness and replay resistance | Signed challenges, policy windows, exact context and atomic local reservation/acceptance; historical verification is separate | Clearing/rolling back local state loses replay history. No global replay service or trusted physical clock is established; define safe recovery without treating old proof as fresh acceptance |
| Sensor provenance and factual truth | Restricted native acquisition, signed evidence, separate key enrollment and optional GNSS position-consistency checks | Compromised OS, fabricated observations or RF spoofing can defeat physical claims. Keep unproven authenticity flags explicit and define any independent corroboration needed |
| Privacy and disclosure | Selected evidence and local encryption limit some exposure | Valid disclosure can still expose identity, location, relationships and other people's data. Specify purpose, minimization, recipients and retention; public inspectability does not require public personal evidence |
| Consent and software trust | Exact digest review, independent verifier/key bindings and restricted signing interfaces | Malicious delivered code can mislead the signer or abuse a protected key. Review distribution, updates and preview-to-signature binding; source availability alone does not establish these |
| Recovery and rollback resistance | Local signing guards and requester ledgers preserve refusal/acceptance history while retained | Lost or restored state may permit conflicts. Define backup consistency, compromise response and authorized recovery; no hardware rollback counter or general recovery workflow is claimed |

Sources: [sensor boundaries](sensors/SECURITY.md),
[shared-session behavior](sensors/LIVE_LOCATION_SHARED.md),
[requester acceptance ledger](../web/src/agent-evidence-storage.js) and
[signing-client/storage assumptions](requests/THREAT_MODEL.md#signing-client-and-update-trust).

## Design and verification checklist

For each new mechanism or material change, update the relevant property here:

1. Name the protected asset, actor and exact operation. Distinguish physical
   truth, authenticated bytes, contractual authority and model interpretation.
2. State the current mechanism and link its implementation and threat model.
   Mark proposals and absent controls explicitly.
3. List trust anchors, keys, clocks, dependencies, storage and disclosure
   assumptions, including coordinated adversaries.
4. Describe what an adversary can achieve when each assumption fails. State
   whether the current system detects it, rejects it or cannot distinguish it.
5. Specify the safe outcome, retained evidence and authorized recovery path.
   Missing evidence must not become consent, forfeiture or fabricated certainty.
6. Link meaningful adversarial tests and record their execution separately.
   Source presence or a historical test result is not current validation.

Existing regression evidence includes
[signature/context and commitment checks](../code/requests/tests/primitives.rs),
[coalition and authority checks](../code/requests/tests/coalitions.rs),
[missing and substituted evidence](../code/requests/tests/evidence_integrity.rs),
[vault and signing-guard checks](../code/requests/tests/local.rs),
[attestation failures](../code/crates/nonverba-core/src/android_attestation/tests.rs)
and [session expiry/context checks](../code/crates/nonverba-core/src/evidence_session/tests.rs).
These are evidence locations, not a claim that they were executed for this note.

Record the rationale and unresolved choices in this document. Put enforceable
controls in the implementation and verify them with appropriate checks. Keep
both aligned: documentation guides design, but cannot enforce a security boundary.
