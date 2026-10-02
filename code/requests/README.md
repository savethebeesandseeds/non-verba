# Non Verba Assignment Protocol

Public Rust package for the three-party Requester (R), Operator (O), and
Mediator (M) Assignment Protocol. R and O are roles open to people, organizations,
agents and embodied robots under explicit signing authority. M is Non Verba's
contractual party; mediation is free and proposal-only. The protocol grants M no
commission or control over requester-to-operator task funds.

Current execution uses **protocol 2 / package 0.2.1**, a corrective prototype with explicit
financial unit grants and signed amendment cutover. Protocol-1 aggregation is
withdrawn: old signed records remain authenticated with an explicitly unresolved
financial projection. Earlier passing tests did not detect the six later review
regressions; current validation is tracked in the readiness report.

The synthetic-development baseline includes the **adapter-1 / AN-2** signing
and inspection presentation. See [readiness and limitations](../../docs/requests/READINESS.md).
This remains a development prototype. Project-owned source and documentation are
licensed under **AGPL-3.0-only**; see the [root license](../../LICENSE) and
[third-party notices](../../THIRD_PARTY_NOTICES.md). Participant keys, vaults and
actual evidence remain private to their owners.

29 September DP-1 / DP-2 additions provide the separate native [disputes companion](../disputes/README.md).
The explicit `nonverba-workflow disputes ...` command delegates to that sibling;
the shared verifier, signed core schemas and financial rules are unchanged.
The companion has its own version-1 annex, profiles, exact pre-cooperation review,
analysis and portable replay. It remains `ANALYSIS_ONLY`, with financial authority
`NONE` and settlement policy `UNSPECIFIED`. The implemented synthetic workflow
does not establish reliable model reasoning. The current Qwen model remains a workflow test
component; its negative findings are preserved. Reliable reasoning and interpreting
priorities into settlement remain separate future work.

The existing core `BILATERAL_SETTLEMENT` rule is distinct from that companion
policy: it supports exact R/O-authorized releases of established R-to-O
compensation or expense claims within the signed Agreement's permission. It
neither moves funds nor changes M's rights. Model output, including question
dispositions, cannot authorize this action. See [settlement handling](../../docs/requests/SETTLEMENT_HANDLING.md)
for the release, amendment, payment and receipt boundaries.

> **No coalition of two parties can create a valid contractual state that improperly alters the third party's rights.**

This invariant concerns authorization under declared trust assumptions. It does
not prove physical work, payment finality, solvency, identity or legal
enforceability. Unresolved disputes and incomplete local transcripts are valid
outcomes. Read the [specification](../../docs/requests/SPECIFICATION.md) and
[limitations](../../docs/requests/READINESS.md) before interpreting a verifier report.

## Package boundary

The package shares the Cargo workspace and lockfile in `code/` with the other
Rust packages. Sensor acquisition, Android/browser builds and the cooperation
simulator are separate components with separate validation responsibilities.
P-256/SHA-256 follows the existing project's signing algorithm family; contractual
role keys are separately pinned and never inferred from a sensor signature.

| Source | Responsibility |
| --- | --- |
| `src/model.rs` | Strict Agreement, Request, Operator quote, action, certificate and report schemas |
| `src/agreement.rs` | Request/quote/terms validation, R/O/M binding, exact preview and trusted role checks |
| `src/actions.rs` | Closed required-authorizer matrix, exact scopes and action-signing preparation |
| `src/bundle.rs` | Shared deterministic reducer, closed required-effect proof, itemized obligations and local-view report |
| `src/rights.rs` | Exact per-certificate credit/release grants, interval union and scoped reversal |
| `src/cutover.rs` | Authenticated causal knowledge, signed amendment frontier and positive successor knowledge |
| `src/legacy.rs` | Authentication-only v1 inspection without invented v2 grants or zero-debt projection |
| `src/evidence.rs` | Independent attachment/manifest/opening integrity reports |
| `src/encoding.rs` | Bounded strict JSON, RFC 8785 JCS, SHA-256 and identifier validation |
| `src/crypto.rs` | Fixed-suite P-256 signatures, domain-separated signing statements and HMAC commitments |
| `src/money.rs` | Canonical bounded integer minor units and currency/exponent checks |
| `src/transcript.rs` | Signed per-author streams, causal admission, conflicts, receipts and evidence rounds |
| `src/local.rs` | Password-encrypted software vault/evidence/snapshots, durable signing reservations and bundle merge |
| `src/bin/nonverba-assignment.rs` | Independent native signing, inspection, verification and import/export commands |
| `src/bin/nonverba-workflow/` | Guided synthetic drafts, exact signing reviews and readable core-report inspection |
| `src/ports.rs` | Signing, storage, transport, evidence and payment-observation integration boundaries |

There is no arbitrary policy interpreter. Incoming records cannot select an
algorithm, enroll a key, mutate a balance or make a mediator assessment binding.
Adapters must use the same validator/reducer boundary as the export verifier;
administrative visibility or account status is operational metadata only.

Keep causal knowledge distinct from required-effect proof. A valid proposal with
at least one actual pinned signature can expose its attributed context before
full financial authorization. The closed action rule selects its exact evidence,
named obligation/grant and relevant cap dependencies. Contextual references do
not make all reachable transactions financial prerequisites. Full knowledge still
supports cutover and successor checks; a partial amendment creates no successor.
The same boundary applies before signing and during verification/import/merge.
Applied effects expose their finite financial witness closure through
`effects[].proof_references`, alongside the exact event/artifact references used
by the rule. Inspect those references separately from arbitrary contextual
parents; a stored reference or audit field does not itself confer authority.
For repeated work/fee establishment, validated nonconditional witnesses for the
same stable obligation preserve its accrued due conditions. They do not import
unrelated expense context or promote an unresolved old claim to active provenance.

Platform assent is explicit before Agreement formation: R signs a Request with
`accepts_platform_terms: true` and embedded terms; O signs their exact
`accepted_terms_hash` in its quote. The Agreement retains those artifacts and
requires separate R/O/M signatures. This does not imply a hosted enrollment system.

## Wire profile

Protocol version is `"2"`; policy ID is `"nonverba-three-party-v2"`. Public keys
are compressed P-256 SEC1 (33 bytes), signatures are low-S `r || s` (64 bytes), and
binary signature/key fields use unpadded canonical base64url. Content digests and
commitments use lowercase 64-character SHA-256/HMAC-SHA-256 hexadecimal values.

The fixed signing suite is `P256_SHA256_V1`. Signature bytes are JCS of
`{domain_separator, suite, claims}`, with
`domain_separator = "NONVERBA:SIGNATURE:v1"`. Claims bind protocol version,
deployment domain, Assignment ID, content digest, role, key ID and signing
purpose. Independently obtained role/key bindings are supplied separately from an
untrusted bundle. Signed text is preserved exactly; no Unicode normalization.

The cryptographic primitive suite/domain strings intentionally remain `v1`:
signature claims and the signed objects bind the actual protocol version. A v1
signature cannot authorize v2 content. Legacy inspection uses actual version-1
contexts and never creates allocations absent from the original signed bytes.

Strict JSON input is bounded to 4 MiB and 64 nested levels. Generic identifiers
allow 1–128 ASCII letters/digits or `._:-`; deployment domains allow 1–200 ASCII
letters/digits or `._:/-`. Structured schemas reject unknown fields, duplicate
properties, malformed Unicode and inappropriate numeric values.

Money is a canonical nonnegative decimal string from `"0"` through
`"9007199254740991"` minor units. Leading zeroes, signs, decimal points, scientific
notation and Unicode digits are rejected. The supported currency/exponent table
is USD/EUR/NOK: 2, JPY: 0, KWD: 3. Cross-currency operations and overflow fail.
This table is a versioned protocol allowlist, not a currency-conversion service.

The initial evidence limits are 1,000 events per transcript, 256 KiB per canonical
event, 64 causal references per event and 256 artifacts per manifest. Repeated
identical events are idempotent; incompatible authenticated records are retained
as conflicts rather than resolved by arrival order.

Protocol-2 payment/release/reversal proposals include signed `allocations`: exact
obligation/root-Agreement coordinates with half-open integer minor-unit intervals.
Independent grants persist despite appended contradictions; overlapping coverage
is counted once and reported separately. All-party reversal revokes only its named
receipt grant's exact units. Amendments sign a `cutover` frontier, preserved claims
and grandfathered actions; they retain existing milestone principals and identities.

Bundles permit at most 1,000 actions, 64 Requests and 128 attachments; each raw
attachment is at most 1 MiB. Agreements are at most 512 KiB. Local encrypted
plaintext has a stricter 2 MiB bound, so a structurally valid 4 MiB bundle may be
too large for this local store. Large-evidence hosting is not implemented.

## Build and verification

All build and test execution belongs in the managed Debian development container.
From the repository root, use the authoritative launcher; see
[container development](../../docs/development/CONTAINER_PLAN.md) for setup and
container reuse. Do not install or run project toolchains on Windows.
For an existing container still bound to the former private checkout, use
`-Snapshot` as explained in [container migration](../../docs/development/CONTAINER_MIGRATION.md).

```powershell
./code/dev.ps1 -Action Exec -Command @('cargo','test','--locked','--manifest-path','requests/Cargo.toml','--all-targets','--','--include-ignored')
./code/dev.ps1 -Action Exec -Command @('cargo','fmt','--manifest-path','requests/Cargo.toml','--check')
./code/dev.ps1 -Action Exec -Command @('cargo','clippy','--locked','--manifest-path','requests/Cargo.toml','--all-targets','--','-D','warnings')
```

The complete test command includes the Node-dependent primitive interoperability
test, which ordinary `cargo test` leaves explicitly ignored. Native tests cover
formation, exact consent, authorization, hostile histories, scoped financial
unit grants, retained review and encrypted local exchange. They exercise declared
software trust assumptions; they establish no bank payment, legal enforceability,
physical work, production identity enrollment or independent human participation.

The same strict reducer is exposed as `verify_assignment_bundle_json` in WASM.
Native filesystem and key-vault APIs are not exposed through that function.
Generate the bindings and run parity entirely inside Debian:

```powershell
./code/dev.ps1 -Action Exec -Command @('cargo','build','--locked','--manifest-path','requests/Cargo.toml','--release','--lib','--target','wasm32-unknown-unknown')
./code/dev.ps1 -Action Exec -Command @('cargo','build','--locked','--manifest-path','requests/Cargo.toml','--bins')
./code/dev.ps1 -Action Exec -Command @('wasm-bindgen','/opt/nonverba-build/target/wasm32-unknown-unknown/release/nonverba_requests.wasm','--target','web','--out-dir','/opt/nonverba-build/target/requests-wasm-pkg','--out-name','nonverba_requests')
./code/dev.ps1 -Action Exec -Command @('node','--experimental-default-type=module','requests/tools/verify-wasm.mjs')
```

The parity helper defaults to the build volume paths and the checked-in
[nv2-01](tests/fixtures/nv2-01/README.md) and
[integration](tests/fixtures/integration/README.md) vector sets: eleven built-in
cases, ten retained corrective cases and six workflow cases. Explicit module,
binary and additional fixture-directory arguments remain supported. The retained
JSON input/report bytes are unchanged; their provenance manifests record their
hashes and synthetic origin. Historical operational logs are not published.

Native/WASM agreement checks policy consistency across runtimes. It is not an
independent proof of that policy. See [readiness](../../docs/requests/READINESS.md)
and the repository's current validation summary for the scope of an executed run;
commands above do not imply that a new validation has already occurred.

## Local client

The guided `nonverba-workflow` adapter adds editable development drafts, retained
exact signing reviews and readable core-report inspection. Follow the
[integration guide](../../docs/requests/INTEGRATION.md) for its owner-by-owner
terminal workflow. It delegates signatures to the existing client below and
reuses the core local-storage library for encrypted retention, merge and export;
it adds no financial authority or OS isolation between owners.

Run the independent client through the managed container from the repository root.
To inspect checked-in synthetic fixtures without generating keys or moving funds:

```powershell
./code/dev.ps1 -Action Exec -Command @('cargo','run','--locked','--manifest-path','requests/Cargo.toml','--bin','nonverba-assignment','--','preview','requests/tests/fixtures/agreement-bound.json')
./code/dev.ps1 -Action Exec -Command @('cargo','run','--locked','--manifest-path','requests/Cargo.toml','--bin','nonverba-assignment','--','verify','requests/tests/fixtures/lifecycle-bundle.json','requests/tests/fixtures/trust.json')
```

Fixture keys are public test keys. Fixture trust is suitable only for those test
records; real participants obtain trust bindings independently. The generated
receipt acknowledges synthetic payment data and establishes no actual bank payment.

Run `--help` for these exact command forms (angle-bracket arguments are filenames
or values supplied by the caller):

```text
keygen <R|O|M> <key-id> <new-vault-file>
preview <bundle.json>
verify <bundle.json> <independent-trust.json>
inspect-json <protocol-object.json>
sign-request <request.json> <trust.json> <vault> <new-signed-request.json> <reviewed-request-digest>
sign-quote <quote.json> <signed-request.json> <trust.json> <vault> <new-signed-quote.json> <reviewed-quote-digest>
endorse <bundle.json> <trust.json> <vault> <new-signature.json> <reviewed-agreement-digest>
sign-action <bundle.json> <trust.json> <proposal.json> <vault> <new-signature.json> <reviewed-proposal-digest>
sign-event <bundle.json> <trust.json> <envelope.json> <vault> <new-signed-event.json> <reviewed-envelope-digest>
import <bundle.json> <trust.json> <local-store-directory>
merge <left-bundle.json> <right-bundle.json> <trust.json> <local-store-directory>
export <bundle.json> <new-export.json>
export-store <encrypted-snapshot.json> <trust.json> <new-plaintext-bundle.json> <expected-root-digest>
seal-evidence <plaintext-file> <new-encrypted-file> <public-context>
open-evidence <encrypted-file> <new-plaintext-file> <expected-public-context>
```

`preview` displays exact Agreement terms and their digest; `inspect-json` displays
an object's exact parsed content and JCS digest. Inspection does not establish
validity. Signing requires the reviewed digest and independently trusted role key.
Request/quote/event signing writes their complete signed record; `endorse` and
`sign-action` write a detached authorization to include with the exact Agreement
or proposal. A caller still assembles the strict bundle records; there is no form
builder or account backend. `merge` combines partial authorizations in two bundles
with the same immutable root and retains conflicts.

`verify` prints a `BundleReport`. Exit zero means a report was generated, not that
every supplied record is valid. Inspect `financial_projection`, `agreement.bound`, `ready_to_start`,
`unresolved_rights`, `diagnostics`, `action_status`, transcript rejection/pending/conflict fields and
`history_completeness`. `import`/`merge` intentionally retain records and diagnostics
even for an incomplete or conflicted view; storing a file does not authorize it.

`PARTIAL_UNRESOLVED_V2` retains individually valid financial proofs with ambiguous
cutover or joint expense applicability in `unresolved_rights`. Each entry preserves
its certificate, reason and conditional principal/discharge/release amounts. These
alternatives are not additive or zero debt. Established historical obligations and
their independent receipt grants remain active; a conditional historical
entitlement keeps its conditional credit without authorizing a fresh retired rule.

For v1 inputs, `financial_projection` is `LEGACY_UNRESOLVED`, with authenticated
original action records in `recognized_legacy_proofs`. Empty legacy financial
lists mean no supported aggregate projection, not zero debt or revoked rights.
The inspector does not infer new interval allocations, migrate signatures or
require reconsent to preserve old evidence. Preserve the original bundle bytes.

## Local retention and keys

Vault, evidence and snapshot encryption use AES-256-GCM with an authenticated
strict header, a fresh 16-byte salt and 12-byte nonce, and PBKDF2-HMAC-SHA-256 with
600,000 iterations. Passphrases are 12–4,096 bytes, supplied as one stdin line.
Terminal input can be echoed: supply stdin through a private input mechanism;
do not place passphrases in command arguments or shared logs. Encryption context
is public, so it must not contain evidence secrets.

`import` and `merge` default to encrypted immutable local snapshots, including
attachments. `export-store` explicitly decrypts a retained snapshot; `export`
copies an already plaintext bundle. `open-evidence` also writes plaintext. Choose
the recipient and location deliberately; these commands do not erase input files
or implement remote retention/deletion. The low-level `store_snapshot` API permits
plaintext metadata-only bundles and rejects raw attachments.

The signer reserves an exclusive scope before releasing a signature. R's initial
Agreement endorsement also reserves one Assignment ID per Request. Conflicting
or incomplete guard records fail closed; identical reservations are idempotent.
Keep the vault and its sibling `<vault-filename>.signing-guards` directory together
when backing up or restoring. Deleting/copying/rolling back guards can defeat local
refusal; there is no hardware monotonic counter or global assignment registry.
Windows files inherit the directory's ACLs, so the participant must protect that
directory. Software keys are available to the local process during signing.

No command moves funds, resets a contractual key or silently replaces a record.

## Integrating safely

Keep private signing keys under participant control. Local preview and portable
verification supply an independent path, but production key custody, exact-consent
UX and trusted application distribution/update still require review. A mediator-
delivered signing page is not an independent trust boundary.

A payment observation cannot move funds. Under the supported payment rule, only
the payee's scoped signed receipt discharges an identified amount; screenshots,
payer statements and M-only webhooks remain attributed observations. No provider
proof, financial protection or independent adjudication is implied by a field.

Sensor evidence adapters retain exact artifacts and existing verification reports.
Manifest bytes satisfying an artifact rule do not prove physical work. Raw
evidence access and retention must be enforced by the actual host; signed or
explicitly exported bundles can contain sensitive information. The local encrypted
store does not supply a production account/access-control or backup service.

See [the design index](../../docs/requests/README.md),
[Agreement terms](../../docs/requests/AGREEMENT.md),
[workflow](../../docs/requests/WORKFLOW.md),
[threat model](../../docs/requests/THREAT_MODEL.md), and
[migration plan](../../docs/requests/MIGRATION.md).
