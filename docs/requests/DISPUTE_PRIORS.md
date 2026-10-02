# Dispute priorities and local analysis

Development implementation record DP-1 / DP-2 · 29 September 2026 · `nonverba-disputes` 0.1.0

This extension adds separately signed priorities and an inspectable analysis
process to the accepted protocol-2 / package-0.2.1 / adapter-1 / AN-2 baseline.
It does not change that baseline's financial rules. These are implementation and
drafting notes, not newly adopted terms. The [decision record](DISPUTE_PRIORS_DECISIONS.md)
lists what would have to be decided before priorities could determine settlement.

**DP-2 is closed and accepted as a synthetic workflow-integration increment.**
The owner clarification (local review record, not included in this source release)
separates that acceptance from model quality. The current local Qwen model remains
a workflow test component; the recorded negative findings are unchanged. Reliable
reasoning and priors-to-settlement interpretation are separate future work, not
closure blockers. This documentation update introduces no implementation, model
change, prompt tuning or further model-quality experiment.

## What a participant can do

The Requester and Operator each distribute **250 points** across five questions:

| Priority | What it asks about | Limit on its meaning |
| --- | --- | --- |
| Result | The usable result and conformity to agreed scope, quality and timing | Does not rewrite the agreed standard after performance |
| Effort | Reasonable, diligent work within scope | Does not reward invented hours or unauthorized extra work |
| Reliance | Reasonable commitments, reserved resources and unrecovered costs | Applies to either party; does not double-count expenses or create uncapped liability |
| Responsibility | Who could reasonably control, prevent, communicate or mitigate a shortfall | Requires evidence; is not character, criminal guilt or presumed Operator fault |
| Remedy | A practical, proportionate opportunity to correct, complete or replace an outcome | Does not require indefinite work, expanded scope or automatic unpaid rework |

Both profiles stay visible separately. More points express greater declared
emphasis when the consideration is relevant. **Zero does not waive a right;
100 does not claim 100% of the payment.** Points are not honesty scores,
probabilities or percentages. The Mediator has no preference vector.

The dictionary is `nv-dispute-priors-5-v1`. Its exact definitions and bounds are
returned by `dictionary` and retained in the signed context. Each value is an
integer from 0 to 100. The validator derives the budget as checked `50 × N`
from the exact supported five-dimension dictionary. Missing, duplicate, extra,
fractional, negative, over-limit or wrong-total allocations are rejected.
An editable 50/50/50/50/50 draft is available; it is never inferred as historical
consent or used to repair an invalid profile.

Today the points provide declared inputs to an experimental analysis of priorities
and tradeoffs; useful interpretation is not established by their validation.
**How they translate into settlement remains UNSPECIFIED.** There is no average,
payment formula, automatic split or award. Existing obligations remain visible
even when analysis fails, evidence is missing or the parties disagree.
The separate future research direction remains an explainable settlement procedure
accepted in advance, including possible bounded remedies or payment consequences.
This increment does not select its formula or authority. An unresolved label is
not a claim that both parties bear equal economic losses.

## Exact consent and compatibility

DP-2 brings profile review before cooperation: signed Request plus R's signed
profile, then signed Quote plus O's signed profile, then comparison of both
profiles and the proposed analysis settings **before base endorsement**.
`preflight-review` verifies the existing authorship and exact Request/Quote against
independent trust and retains complete sources, settings and their fingerprints.
Both allocations are displayed in the same dictionary order. `preflight-decide`
records acceptance or decline of the full review digest without opening a vault.
An Operator can decline an extreme but valid Requester allocation before signing
the base. This automated workflow is not a resumed participant walkthrough.

The decision is **unsigned local workflow evidence**, not authenticated consent
by someone else. In the new guarded path, `preflight-base-review` and
`authorize-preflight-base` require acceptance and unchanged sources, then obtain
separate exact consent to the base Agreement under its existing authority rules.
`authorize-preflight-context` and `complete-setup` require the annex's exact
profiles, dictionary and settings to match the retained preflight. Changing
reviewed material requires a new review and local decision. Existing commands
and historical records retain their original validity; the preflight is a local
workflow protection, not a new financial-authority rule or robot safety approval.

R signs its profile against an authenticated Request revision. O signs its own
profile against the exact signed quote and Request. The existing closed Agreement
schema has no suitable extension slot, so this implementation uses a separate
version-1 companion annex. R, O and M endorse the same dictionary, final signed
profiles, analysis specification and **already formed exact Agreement digest**.
It has typed `ANALYSIS_ONLY` authority and `UNSPECIFIED` settlement policy.

Base formation and annex formation are reported independently. A base Agreement
can be bound while the annex is missing, incomplete, invalid or unsupported.
Only three valid annex endorsements complete annex formation. The new preflight
workflow also requires `complete-setup` to verify the accepted material matches.
Base and annex signatures are separate, not atomic. A later annex
does not change when the base Agreement formed. Endorsing someone else's profile
acknowledges its place in the context; it does not transfer authorship.

The P-256/SHA-256 suite and core signing statement are reused with distinct
profile, context, evidence-submission and challenge purposes. Review retains the
whole exact object and its source context. Authorization requires independent
trust and confirmation of the **full review digest**, before requesting a
passphrase or accessing a vault. Editing profiles, running analysis and replaying
exports do not unlock a vault. Agents and robots use the same explicit authority
boundary as other participants; no new delegation mechanism is supplied.

Local signing guards reserve one profile for a Request revision or quote identity,
and one context for an exact accepted Agreement digest. Changing a pending draft
invalidates its review. Changing an already signed profile requires a new signed
Request revision or quote identity. Replacing an accepted context under the same
Agreement is unsupported. A separately authorized base amendment or new Assignment
can carry a new context; old cases retain their exact old context. This deliberately
restrictive first path also applies when moving from an unavailable model
specification to a provisioned one. There is no silent runtime upgrade.

A different accepted Agreement/annex starts a separate case and package. Appending
a case revision preserves the package's existing exact context; there is no
mixed-context package or automatic migration of earlier dispute records.

No historical profile is guessed. An unsupported extension never rewrites
protocol-1 or protocol-2 records, conditional proofs or accrued rights.

## Case, evidence and analysis

Each case revision retains the supplied Assignment bundle, its locally observed
frontier, exact Agreement/context/trust hashes, scope and shared evidence manifest.
The existing verifier computes the financial report. Evidence authentication
attributes a statement; it does not establish that the statement is true.

Original bytes, extracted text, supplied sensor appraisals and model interpretations
remain distinct. Original bytes are digest-checked and tied to either an
authenticated core event or a signed participant submission. Extraction producer
and tool labels are claims, not independently authenticated attestations. Redacted,
omitted and inaccessible items remain explicit entries. Only authenticated items
accessible to all three parties enter the merits input and citation allowlist.
This is a local manifest and access declaration, not a delivery service or proof
that a recipient downloaded everything. The supplied history can be incomplete.

Omission or redaction affects the selected revision's model input, not erasure.
Earlier cases, prompts, raw responses and the full supplied core bundle can still
contain those bytes in a plaintext export. Inspect the whole export before sharing;
this mechanism is not a deletion or sanitization service.

The first pass receives terms, claims, accessible evidence and the core financial
projection, with the numeric profiles withheld. The second receives the first
interpretation and both signed profiles, separately labelled. This sequencing is
a precaution, not proof of unbiased reasoning. Evidence text stays untrusted even
when it contains instructions. Prompt delimiters cannot establish security; the
absence of financial/signing actions in the analysis path supplies that boundary.

DP-2 adds versioned specifications with a deterministic model-input projection.
The retained package still contains complete signed originals; the model receives
exact reasoning material and ordered allocations without repeated cryptographic
envelopes. The projection's version, source mapping and digest are retained with
each stage. Both passes are independently counted after chat-template formatting;
the second pass also includes the first interpretation. Version-1 prompts,
specifications and outputs remain supported without rewriting their hashes.

Versions 3–5 add bounded formats and explicit source references. Versions 4–5
permit empty unresolved-reason lists where the model claims the observations are
settled. Version 5 also checks that each priority explanation begins with the
exact points from that party's signed profile. Its comparison table joins by
dimension ID while preserving Requester order, so independently ordered valid
profiles remain usable. These checks do not validate the meaning of the prose.

First-pass questions now have a visible carry-forward account. Omitting one from
the comparison output leaves it open. The supported version-2 output can explain
that it remains open, is answered from an identified source, is unnecessary or
is superseded by another identified question. These are contestable model
interpretations, not contractual facts. Completion of two model calls and
outstanding evidence requests are reported separately, including for version-1
records whose first-pass questions were omitted from their final response.

An explicit disposition can still be wrong. The retained Qwen evaluation includes
questions marked unnecessary while the accompanying reasons say they remain open.
Inspect the original question, disposition, explanation and sources together;
the derived outstanding-question list does not establish factual resolution.

The text path does not see images, hear audio or independently verify GNSS.
It can receive an attributed description or supplied sensor appraisal, explicitly
labelled as such. Sensor integrity, evidence usability, responsibility and
contractual acceptance remain different questions. Missing sensors, a timeout
or poor evidence do not create fault or a monetary default. No sensor or phone
acceptance work was performed for this increment.

The model schema permits bounded issues, competing arguments, uncertainties,
questions, five ordered priority comparisons and unresolved reasons. Alternatives
are clarification, voluntary repair or a reference to an existing authenticated
R/O monetary offer. There is no model-authored payment amount or executable action
field. The application rejects unknown authority metadata and fabricated or
inaccessible citations. It validates structure and references, not the truth or
semantic quality of prose: a model could still write an inappropriate numeric or
award-like sentence in a text field. Such prose remains nonauthoritative model
interpretation, never a core obligation or protocol-endorsed payment.

New evidence, changed frontier or changed shared access requires a new case
revision. Old attempts remain attached to their original case hashes and become
stale for the new revision. Cancellation is checked again after a response returns;
late output is retained without publishing a current analysis. A challenge is an
attributed appended record about inputs, attribution, procedure, interpretation
or runtime specification. It cannot delete analysis or reverse a contractual right.
Questions propose evidence; an answer is a signed submission. Silence causes no
forfeiture, automatic disclosure or obligation to keep working.

## Settlement handling after analysis

Analysis can be considered alongside the original evidence during discussion.
It creates no settlement certificate and supplies no signing authority. If R and
O choose a release that the existing core supports, they must separately review
and authorize an exact `BILATERAL_SETTLEMENT` proposal. The core checks the
permitted R-to-O compensation/expense obligations, entitlement basis and released
units. M's separate rights and unrelated claims remain protected.

The companion's `UNSPECIFIED` settlement policy concerns how priorities might
determine an outcome; it does not replace the existing core's signed-release
rules. Release, new work/amendment, actual payment and payee receipt remain
separate operations. See [settlement handling](SETTLEMENT_HANDLING.md) for the
workflow, exact limits and a retained synthetic example.

## Runtime, costs and reports

The standalone native companion has a narrow local llama.cpp adapter. The shared
native/WASM financial core has no model or inference dependency. See
[runtime configuration and limits](../../code/disputes/RUNTIME.md) for the pinned
source API, artifact checks, local paths, token accounting and explicit opt-in test.
The initial bounded inspection found no runtime/model. A later owner-authorized
resource handoff (local review record, not included in this source release)
provided the pinned CPU runtime and SmolLM2-135M-Instruct Q4_K_M in the existing
tools volume. One real direct probe and one signed-case attempt were then run
under a fresh synthetic specification. Both hit the 2,048-token output limit and
were rejected as `TRUNCATED_RESPONSE`. The case remains `FAILED / INCONCLUSIVE`;
its second pass did not run. The retained package/export/replay validated and
base records stayed unchanged. This is a recorded model limitation, not successful
two-pass analysis or a model-quality result. No inference retry was performed.
Mock responses remain labelled `MOCK`; their zero token counts are not measured
inference. The editable `development_spec` still defaults to `MODEL_UNAVAILABLE`
and cannot silently adopt the newly supplied artifacts.

That historical test used CPU and changed no container. The subsequently
authorized environment cutover enabled GPU execution; DP-2 adds separately
pinned versioned CUDA runtime profiles and fresh synthetic contexts. Installing
the GPU image does not upgrade an existing signed specification. After the two
DP-2 Smol experiments, the owner explicitly approved local Qwen3-4B evaluation.
Those weights are installed through the existing setup procedure and retained
as a workflow test component. This is not acceptance of their reasoning quality.
The exact DP-1 model, runtime pins, usage and failure records are in the
real CPU capture (local review record, not included in this source release).

The signed development specification uses 8,192 context tokens, at most 6,144
input and 2,048 output tokens, a 120-second deadline per pass and seeds 17, 29, 43.
The full chat template is tokenized before generation. Oversized cases fail without
silent truncation. These limits are hypotheses, not measured model capacity.
One run has two passes. Diagnostic mode declares three seeds in advance and retains
every attempt, including failure. A repeated schedule for the same case is rejected;
there is no retry-until-preferred loop. Three samples are not three independent
adjudicators or a calibrated confidence estimate.

A development compute budget names a sponsor and caps runs, tokens, elapsed time
and evidence rounds across the retained package. The helper default is three
runs, 65,536 budget tokens, 900,000 ms and eight revisions including the initial
case. Admission conservatively reserves two context windows and two full stage
deadlines. Failed calls with unknown usage reserve one context window; raw observed
usage remains separately retained. A known unavailable-model response charges zero
tokens. Counts are local runner claims, not tamper-proof billing or global quotas.
The library rejects another run when the budget is exhausted; overrun/failure
records remain inspectable. Cancellation does not prove the separate server stopped
CPU work immediately.

These counters are not an assurance purchase, a price, a funding promise or an
activation of M's optional service. Sponsors acquire no control over evidence,
profiles or outcomes. `BUDGET_EXHAUSTED` creates no fee, deduction or adverse award.
Commercial activation and the service worksheet remain unselected.

Reports separate case lifecycle, execution, analysis, settlement policy and core
financial projection. `SUCCEEDED`/`ANALYSIS_READY` never means settled, paid or
true. `NEEDS_EVIDENCE` remains an analysis status. V1 implements `OPEN` and
`UNDER_REVIEW`; it does not claim `CLOSED_BY_SUPPORTED_ACTION` because the current
core has no generic dispute-closure action. An existing scoped settlement release
does not necessarily close a case or create a new payment obligation.

Inspection, terminal reports and replay expose every stage's execution kind.
Mocks are visibly synthetic and cannot qualify as real local analysis merely
because their JSON validates. Mixed execution kinds are explicit. A local label
still records an unverified runner claim; it is not execution attestation or
evidence that the model's reasoning is useful.

## Retention, replay and remaining limits

Portable exports retain definitions, signed context and source records, exact case
revisions, accessible evidence, prompts, schema, specification, all scheduled
attempts including raw failures, budget charges and challenge history. They are
plaintext and include the shared evidence. They contain no signing keys. Replay
requires independently supplied trust and recomputes the core and extension
checks. The bundled trust is a reference, not its own trust anchor.

Hash-consistent records do not prove that a model actually ran, used the claimed
weights or reasoned correctly. Runtime file hashes and server properties are
observations, not attestation. A later independently performed run needs its own
attributed record. Validating an export does not secretly run a model or sign.

The existing strict canonical encoding bounds each JSON record/export to **4 MiB
and 64 nesting levels**. Case bounds additionally limit evidence items and bytes;
smaller combined package/runtime bounds can reject an otherwise valid component.
Use explicit selection/omission and new reviews where applicable; never silently
truncate evidence. The terminal writes immutable output files and a sibling
`.attempts` journal containing run intent and completed attempts. A process crash
can leave an incomplete journal; it is not a complete replayable export and there
is no automatic recovery/retry. There is no hosted storage, delivery guarantee,
distributed quota enforcement, remote attestation or provisioned OS sandbox for
the external server in this increment.

The DP-1 validation record (local review record, not included in this source release)
retains the earlier deterministic evidence and failed CPU probe. The compact
DP-2 record (local review record, not included in this source release) separates fresh
regression results from real GPU execution and observed reasoning quality.
Its 40 attempts and negative findings remain historical evidence; the later owner
closeout accepts workflow integration, not successful substantive reasoning.
No further model-quality experiments are part of this closed milestone. The
participant walkthrough remains deferred.
