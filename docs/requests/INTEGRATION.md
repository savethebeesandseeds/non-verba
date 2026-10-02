# Guided terminal workflow and readable inspection

`nonverba-workflow disputes guide` opens the separate native
[analysis companion workflow](../../code/disputes/README.md). DP-2 is
closed as the synthetic workflow-integration increment (local review record, not included in this source release).
Its annex, profiles, cases and replay records do not grant financial authority.
Mode remains `ANALYSIS_ONLY`, financial authority `NONE`, and settlement policy
`UNSPECIFIED`. Use `disputes guide-data` for the case/analysis commands and
[settlement handling](SETTLEMENT_HANDLING.md) for the boundary between analysis
and the existing signed R/O release action.

`nonverba-workflow` is **adapter 1**, a development integration prototype around the
accepted protocol-2 core and `nonverba-assignment` signer. It helps participants
prepare proposals, retain exact signing reviews, exchange signed records and
read the actual verifier output. It does not create a hosted marketplace,
payment service, financial protection product or new authority rule.

The guided drafts and examples are **synthetic development records**. Requester
and Operator are roles usable by people, organizations, agents and robots under
explicit signing authority. M provides free, proposal-only mediation and never
controls R-to-O task money.

The AN-2 clarification pass adds signing-consequence explanations and qualifies
the inspection labels. The adapter record format remains version 1 and the
protocol remains version 2. No fixture terms, payer schema or authority rule is
changed. The [Contract notes](CONTRACT_NOTES.md) separately record the
requester-funded product direction, free Operator registration and unselected
Request-creation/service billing terms. The synthetic draft template keeps its
optional service disabled; this is not a billing implementation.

## Run inside the existing managed container

From the repository root in Windows PowerShell, use the approved container after
checking it through [the project procedure](../development/CONTAINER_PLAN.md).
The [snapshot bridge](../development/CONTAINER_MIGRATION.md) builds and inspects this
public checkout while preserving the old container bind. Do not create a replacement
container or install a host project toolchain for this guide.

```powershell
./code/dev.ps1 -Snapshot -Action Exec -Command @('bash', '-c', 'cargo build --locked --manifest-path requests/Cargo.toml --bins && /opt/nonverba-build/target/debug/nonverba-workflow guide')
```

Build both binaries: the adapter delegates key generation and signing to its
sibling `nonverba-assignment` executable. Retention, merge and export reuse the
existing core local-storage APIs on the loaded records. `guide` prints the exact
supported command arguments and sequence.

The following walkthrough describes a persistent interactive session inside a
matching managed checkout, with stdin and a terminal retained so the adapter can
disable passphrase echo. Snapshot mode does not provide that interactive owner
session. Do not create real vaults or attempt sensor/phone operations to exercise
the documentation. Inside a deliberately configured persistent shell, this
optional shorthand invokes the container-built adapter:

```bash
nv() { /opt/nonverba-build/target/debug/nonverba-workflow "$@"; }
nv guide
```

## One signing owner at a time

Each participant creates and uses its own vault, passphrase and retained records.
Share only the public binding and the signed records the recipient is entitled
to receive. Obtain and check role/key bindings independently; the `trust` command
assembles a synthetic trust draft and does not establish real identity.

Separate directories in this shared development container are **logical owner
contexts, not OS isolation**. They do not protect keys from another process with
the same operating-system authority. This demonstration is not a service that
holds R and O vaults for them, and M must not receive their vaults or passphrases.
A deployment needs participant-controlled custody and distribution reviewed under
the [threat model](THREAT_MODEL.md).

For example, R alone creates a new development directory and key in R's current
owner session. Use a fresh path; existing records are preserved:

```bash
nv_owner=/opt/nonverba-build/requester-demo-1
mkdir -m 700 "$nv_owner"
nv participant R requester-demo-key "$nv_owner/requester.vault.json" "$nv_owner/requester-public.json"
cd "$nv_owner"
```

O and M run their own `participant` commands in their own owner contexts, with
their own roles, names and private directories. Only their public-binding files
are exchanged to prepare `trust.json`. Keep each vault with its sibling
`<vault-filename>.signing-guards` directory during backup/restore. Copying only the
vault or rolling back guards can defeat local refusal of conflicting signatures.

## From Request to retained Contract

1. **R prepares and signs the Request.** `draft-request` creates an editable
   synthetic proposal from independently checked trust. R reviews the exact
   Request and its embedded platform terms, then authorizes it with R's vault.
2. **O quotes the signed Request.** `draft-quote` binds O's offer and exact
   platform-terms acceptance to that signed Request. O reviews and authorizes the
   quote. Scope/price changes require a fresh exact review and valid signatures.
3. **All three review the Contract.** `draft-contract` assembles the signed
   Request and O quote. Each participant reviews the same Contract digest in
   its own context and creates its own endorsement. `attach endorsement` writes
   a new bundle containing the supplied endorsement; it cannot invent the others.
4. **Inspect and retain locally.** `inspect` reports formation and readiness from
   the core. `retain` writes the participant's password-encrypted immutable
   snapshot. Partial signatures or unsupported prerequisites remain visible;
   saving a file never makes an incomplete Contract ready.

For a new Assignment using the companion's preflight path, review the signed R/O
profiles and exact analysis settings **before base endorsement**. Each role's
accept/decline record covers the full retained review digest but is unsigned local
workflow evidence, not another party's authenticated consent. The guarded base
and annex commands check the exact reviewed material; `complete-setup` also checks
base formation and all three annex endorsements. Base and annex signatures remain
separate, not atomic. A failed or declined extended setup does not invalidate an
already formed base Contract or its rights. Existing core signing paths retain
their original rules; follow the [companion sequence](../../code/disputes/README.md#guided-sequence)
for the additional checks.

The same retained-review pattern applies to each signed object. In R's owner
session, after the independently checked `trust.json` is available in that owner
directory:

```bash
nv draft-request trust.json request-draft.json
nv review request request-draft.json request-review.json
nv authorize request-review.json trust.json "$nv_owner/requester.vault.json" signed-request.json
```

`authorize` displays the exact retained content, its full digest, signing context
and supplied trust. The participant must type the **entire displayed digest**,
then enter the local passphrase. A blank digest cancels. The signer validates the
reviewed object and required authority before signing; editing the draft later
does not rewrite the retained review. Inspect the actual displayed scope, price,
destination, exclusions, policy, terms and consequences before consenting.

`review` supplies no independent trust, so its consequence description explicitly
labels the retained values as unauthenticated. `authorize` uses the independently
supplied trust and the existing core verifier to explain the referenced Contract,
existing obligations and evidence findings before asking for consent. It resolves
the exact Contract digest in the action; it never substitutes another revision's
price. A failed preflight is shown as rejected, not as an authorized effect.

The signing display distinguishes:

- A Requester's milestone acknowledgment, which can establish the exact agreed
  compensation even with missing attachments, from a message/file receipt. A
  repeated compatible acknowledgment does not create an additional charge.
- A payer statement, which grants no payment credit, from a payee receipt. The
  receipt's stated amount, exact unit allocations, core-checked allocation amount
  and unallocated excess are distinct. Existing grants remain visible; the
  display does not predict a balance reduction from the whole stated amount.
- A scoped R/O settlement from a release of unrelated claims or M's separate
  rights. The exact proposed obligations, amounts and ranges remain visible.

These explanations are not separate signed terms or waivers. Full exact JSON,
context and digest are still displayed; no preview manufactures a signature.

Review files and signing context are plaintext. Authorization also retains exact
temporary object/context files under the container build volume to pass them to
the existing signer. Do not treat these as an encrypted evidence store. Sensitive
real data, key custody, cleanup and access controls require a separately reviewed
deployment. Passphrases never belong in arguments, environment variables or logs.

## Performance, direct-payment records and disputes

The bounded draft commands cover ordinary completion, payer observation and
dispute events, plus acknowledgment, payee receipt, bilateral settlement,
grant-specific reversal and supported nonfinancial service activation actions.
Use `nv guide` for exact names, targets and optional minor-unit arguments. Drafts
are proposals; they receive no authority merely because this adapter created them.
The guided initial Contract supports one milestone and a synthetic payment
destination. Service activation is available only when the exact signed Contract
already contains the supported service; it does not add protection to a disabled
Contract.

Acknowledgment takes the exact completion-event hash. Receipt and settlement take
an explicit active obligation ID and minor-unit amount; reversal takes the exact
receipt-certificate digest and amount. The bounded financial drafts select the
explicit interval `[0, amount)`, not a guessed remaining balance. Review those
units, especially when earlier grants overlap. Conditional obligations are not
automatically selected, and a reversal prefix must belong to its named grant.

Use `demo-attachment` for the synthetic evidence bytes, `attach attachment` to
include them, and `review event` / `authorize` / `attach event` for the attributed
completion. R separately acknowledges completion through an action. A payer
observation remains a claim. Only the required payee authorization and actual
obligation/unit proof can create receipt credit under the core's rule. No command
transfers funds or proves bank settlement.

Settlement requires R/O authorization within their permitted obligations. A
reversal names the exact receipt grant and units and requires R/O/M. Service
activation requires its supported Contract configuration and all three roles;
it is not financial coverage. A draft requiring more than one signer needs each
owner's separate authorization over the same proposal digest. Attach the supplied
signatures without rewriting that proposal. Missing authority and proof remain
pending or rejected under the existing core.

The supported `BilateralSettlement` is specifically a release of named units of
existing R-to-O compensation or expense entitlements, when the signed policy
enables it. It records released coverage separately from payment receipts, counts
overlap once, and does not create a payment, new debt, amended price or change to
M's rights. See [settlement handling](SETTLEMENT_HANDLING.md) before preparing the
exact release for independent R/O review and signing.

Analysis does not construct or submit that core action. Its interpretations,
alternatives and question dispositions remain model statements, including when a
question is labelled answered or unnecessary. Structure, citation and replay
checks do not verify those interpretations as facts. The current local Qwen model
is a workflow test component; the retained negative reasoning findings remain
valid. Reliable reasoning and a policy interpreting priors into settlement are
separate future work, not blockers to the closed DP-2 increment.

## Read and exchange the actual local view

For a retained dispute-analysis package, run inside the existing container shell:

```bash
nv disputes report-analysis package.json independent-trust.json new-report.txt
```

This produces a readable case review followed by the full independent inspection.
It separates the exact signed context, attributed claims, existing balances and
release/receipt effects, model interpretations and outstanding questions, and
signed challenges. Source hashes and exact unit amounts remain visible. Stale,
failed and synthetic attempts keep their labels; a model's question disposition
never becomes a finding of truth or case closure. Invalid companion packages
withhold participant/model summaries while keeping independently checked core
results visible. No model is run and no signing vault is opened to render a report.
Existing report bytes cannot be replaced with different content.

The [dispute lifecycle specification](DISPUTE_LIFECYCLE.md) describes the intended
negotiation interface separately from implemented actions. Closure scope,
reopening and escalation remain design decisions.

Inspection is read-only. To see the preserved NV2-01 case without creating keys
or signing anything, run inside the container shell:

```bash
nv inspect requests/tests/fixtures/nv2-01/late-context-extension.json requests/tests/fixtures/nv2-01/trust.json
```

Supply an optional third path to retain a new plain-text report. The readable
sections preserve formation/readiness reasons, active obligations, conditional
rights, performance, payment observations, mediation, assurance, evidence,
action verdicts, effect rules/proofs, diagnostics and unknown history. A complete
escaped core `BundleReport` JSON appendix retains every report field.

A true `ready_to_start` is presented as **Protocol record checks passed —
operational readiness not assessed.** A false result displays failed record
checks and their reasons. The unchanged machine field remains visible under a
technical label. Neither result attests site safety, permission to actuate a
robot, durable certificate retention or every participant's receipt of it.
Performance disputes and independently established financial rights remain
visible alongside this flag.

Amounts are labeled as recorded principal and outstanding recorded balance.
Their due-condition text remains adjacent: a recorded balance does not establish
that a report was delivered or another narrative payment condition was met.

In that synthetic NV2-01 case, the active M fee is **500 minor units**. Two
conditional expense proofs of **1,500 each** remain separate and must not be
summed into an active debt. Exact currency/exponent, principal, discharge,
release, overlap, dispute amount, balance, due conditions and grant intervals are
shown per obligation. A legacy `LEGACY_UNRESOLVED` report has no supported aggregate;
an empty list is never displayed as zero debt. There is no single master status.

`retain`, `merge` and `export` reuse the existing core local-storage library.
`retain` and `merge` write encrypted immutable snapshots. `merge`
preserves supplied records and conflicts; it does not make every record valid.
`export` explicitly decrypts a selected snapshot and requires its expected root
digest. `exchange` writes an explicit plaintext copy of an already plaintext
bundle. The recipient runs `inspect` with independently pinned trust and may
retain its own encrypted copy. Neither operation requires M's continued service.

Choose the recipient and file location deliberately. Reports, reviews, exchanged
bundles and decrypted exports may contain private evidence; no command silently
erases them. JSON input and saved local output retain the core's 4 MiB bound, while encrypted
snapshot plaintext is limited to 2 MiB. A large valid bundle may exceed the local
store or expanded text-report limit. A zero process exit means the report/file was
produced, not that all supplied records are authorized.

## AN-2 focused validation

The AN-2 display changes were checked in the existing managed Linux container on
28 September 2026. **24 focused tests passed, zero failed or ignored**: 20 adapter
unit tests and four real terminal workflow tests. Formatting, all-target Clippy
with warnings denied and both native binary builds passed. The commands/results
are in the focused native log (local review record, not included in this source release) and
build log (local review record, not included in this source release). The native log retains
the same executed output as the development log; those are not two test runs.

This pass did not rerun the full core suite or WASM/parity checks. The original
168/27 results below remain historical evidence. In the retained AN-2 snapshot,
45 of the 49 package files were byte-identical to the AN-1 source manifest. Only
the adapter's `review.rs`, `main.rs`, `inspection.rs` and its workflow acceptance
test changed in that pass; core rules, wire schemas, draft defaults, signed
fixtures and dependencies were unchanged. This comparison describes the snapshot,
not later edits to live documentation such as the package README.

Six new inspection captures (local review record, not included in this source release)
use byte-identical historical input bundles/trust and preserve the same core JSON
results. Four new consent displays cover duplicate acknowledgment, an overlapping
receipt with excess, scoped settlement and payer observation. Each was cancelled
with a blank digest before vault/passphrase use; no new signature was produced.
The overlapping receipt (local review record, not included in this source release)
shows stated 4,000 minor units, allocated coverage 3,000 and unallocated excess
1,000 alongside existing grants, without predicting a new balance.

## Original integration validation

All integration compilation and checks ran inside the same managed container.
On **28 September 2026**, the complete run passed **168 native tests, 0 failures,
0 ignored**: the existing 152 core tests, 13 adapter unit tests (six drafts, four
inspection, three retained-review tests) and three real workflow acceptance tests.
The renderer tests cover separate NV2-01 rights, legacy unknown balances, complete
report preservation and escaped terminal controls, including C1, bidirectional
formatting and Unicode line separators.

The workflow tests use separately generated software vaults, actual signing
commands and immutable exchange/encrypted retention. They exercise the synthetic
lifecycle, reordered/duplicate/conflicted exchange, partial formation, physical
dispute and scoped settlement/reversal views. No funds moved. Formatting,
all-target Clippy with warnings denied, both native binaries, the release WASM
library and binding generation passed. Native/WASM comparison passed **27 cases**:
eleven built-in cases, ten prior NV2-01 vectors and six new adapter captures.

The native log (local review record, not included in this source release),
build log (local review record, not included in this source release) and
parity log (local review record, not included in this source release) retain the actual
results. The 18 recorded core source/Cargo hashes remain unchanged; this milestone
adds the bounded adapter and its tests. The previous 152/21 core baseline remains
documented in [readiness](READINESS.md). This is new integration work, not a claim
that the earlier reviewer accepted the new adapter.

Readable captured examples include the
synthetic completed lifecycle (local review record, not included in this source release)
and NV2-01 fee/expense separation (local review record, not included in this source release).
Each capture also retains its input bundle, independent test trust and exact core
report. The other captured views cover partial formation, physical dispute,
settlement and reversal.

To rerun checks without writing another capture, omit the capture environment
variable:

```powershell
./code/dev.ps1 -Snapshot -Action Exec -Command @('cargo', 'test', '--locked', '--manifest-path', 'requests/Cargo.toml', '--all-targets', '--', '--include-ignored')
./code/dev.ps1 -Snapshot -Action Exec -Command @('cargo', 'fmt', '--manifest-path', 'requests/Cargo.toml', '--check')
./code/dev.ps1 -Snapshot -Action Exec -Command @('cargo', 'clippy', '--locked', '--manifest-path', 'requests/Cargo.toml', '--all-targets', '--', '-D', 'warnings')
```

The historical capture command below names the **already populated** local
destination and an earlier container. It is a record, not a current reproduction
command. Its captures are omitted from this public import. Run the ordinary
checks above without that environment variable.

```text
docker exec -e NONVERBA_WORKFLOW_CAPTURE_DIR=/workspace/reviews/integration-final-vectors-2026-09-28 88253aa2f41822b2160155831f2a5237d382b7778e79bd6ce55d16da0fc1f6a6 bash /workspace/code/dev.sh exec cargo test --locked --manifest-path requests/Cargo.toml --test workflow -- --nocapture
```

Use the [package README](../../code/requests/README.md) for the full WASM build and
27-case parity command; it passes both the NV2-01 and integration vector directories.

The adapter introduces no new financial authority, account recovery, trusted
identity service, clock, payment/provider integration or physical-evidence truth.
Passing the workflow examples is not production approval or proof of every history.
