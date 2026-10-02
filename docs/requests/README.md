# Three-party Assignment Protocol

Protocol documentation, 28 September 2026. Requester (R),
Operator (O), and Mediator (M) sign an exact Assignment Contract. Non Verba acts
as M, provides free mediation, takes no commission, and has no authority to hold,
move, redirect, or refund R-to-O task money.

29 September addition: [dispute priors and local analysis](DISPUTE_PRIORS.md)
adds separate R/O profiles, exact three-party annex consent, local analysis and
portable case/challenge replay. Settlement policy remains unspecified and the
financial core is unchanged. DP-1 evidence (local review record, not included in this source release)
is separate from the accepted AN-2 evidence. The
DP-2 follow-up (local review record, not included in this source release) adds
pre-cooperation review, question/provenance corrections and the recorded local
model experiments, including their failures and semantic limitations. DP-2 is
**closed as an accepted synthetic workflow-integration increment** under the
owner's scope clarification (local review record, not included in this source release).
The retained Qwen model is a workflow test component; reliable reasoning and a
future policy for interpreting priors into settlement remain separate work.
The [settlement guide](SETTLEMENT_HANDLING.md) explains the existing signed R/O
release path and why companion analysis has no authority to apply it.

> **No coalition of two parties can create a valid contractual state that improperly alters the third party's rights.**

This is a requirement for scoped authorization under declared assumptions, not a
claim that a signature establishes truth, solvency, legal enforceability, or
physical performance. An unresolved dispute is a legitimate result.

The accepted synthetic-development baseline is **protocol 2 / package 0.2.1 /
terminal adapter format 1 / notes AN-2**. The AN-2 acceptance record (local review record, not included in this source release)
closes the preceding documentation and consent clarification pass. It records a
focused review, not production approval or adopted legal terms. The optional
participant walkthrough is deferred and has not been run.

Requester and Operator are roles, not human-only identity classes. People,
organizations, agents and embodied robots can participate through an explicitly
established signing authority. A robot used to perform work is not automatically
the party responsible for its obligations.

## Read this design

For the component boundaries and next integration work, use the [protocol context](CONTEXT.md):
it condenses the Assignment decisions, review evidence and separate sensor
hardening status before the next protocol extension.

Start with the participant notes for the meaning of the records, the integration
guide to use the terminal workflow, or readiness for implemented scope and limits.

| Document | Purpose |
| --- | --- |
| [Participant notes](PARTICIPANT_NOTES.md) | Plain-language explanation for Requesters and Operators, including robotic execution |
| [Contract notes and implementation record](CONTRACT_NOTES.md) | Proposed wording, implemented rules versus signed promises, code evidence and unresolved launch decisions |
| [Terminology](TERMINOLOGY.md) | Living vocabulary: working conventions, draft dispute terms, current implementation names and later development alignment |
| [Specification](SPECIFICATION.md) | Constitutional invariants, strict authorization and verification rules |
| [Contract](CONTRACT.md) | Exact signed terms, formation and proposed core clause |
| [Workflow](WORKFLOW.md) | Request, quote, local signing/readiness, evidence, disputes and direct payment |
| [Guided integration](INTEGRATION.md) | Adapter-1 terminal workflow, separate owner contexts and readable core inspection |
| [Settlement handling](SETTLEMENT_HANDLING.md) | From discussion to an exact signed R/O release; separate analysis, amendments, payment and receipts |
| [Dispute lifecycle and consent](DISPUTE_LIFECYCLE.md) | Existing case records, proposed negotiation interface, exact mutual consent and unresolved closure/escalation decisions |
| [Dispute priors and local analysis](DISPUTE_PRIORS.md) | Profiles, pre-cooperation review, annex, evidence/analysis boundaries and reports |
| [Open settlement decisions](DISPUTE_PRIORS_DECISIONS.md) | Decisions needed before priors could determine a binding outcome |
| [Dispute settlement research notes](research/README.md) | Priors, commitments, resolver and inspection harnesses, material incidents, insurance and external scrutiny; discussion for future work |
| [Threat model](THREAT_MODEL.md) | Coalition attacks, assumptions, client distribution and privacy |
| [Migration](MIGRATION.md) | Preserving legacy evidence and avoiding invented acceptance |
| [Readiness](READINESS.md) | Implemented scope, verification evidence and deployment gaps |
| [Rust package](../../code/requests/README.md) | Standalone package and executable verifier |

The normal path is:

```text
R terms acceptance -> signed Request
O terms acceptance -> signed Operator quote
R + O + M sign one exact Contract
each participant obtains its own complete certificate
protocol record checks -> performance claim / evidence -> accepted consequence
direct R-to-O payment observation -> O receipt -> portable export
```

When using the companion, review the exact profiles and analysis settings before
endorsing the base Contract, then form its annex separately. After a dispute,
analysis or a proposal does not change an obligation. Any supported settlement
release follows the independent authorization path in [settlement handling](SETTLEMENT_HANDLING.md).

Requests have one Assignment initially. Their identities remain separate so a
future version can introduce multiple independently bound Assignments without
reinterpreting existing records. A local verifier cannot infer the absence of
other assignments or hidden history from one supplied bundle.

Passed record checks do not assess operational safety or authorize robot actuation.
The [workflow](WORKFLOW.md) keeps those decisions separate. Sensor signatures do
not supply Contract consent or payment authority; sensor development and the
public cooperation repository are outside this documentation scope.

## Review evidence and maintenance

| Record | Use |
| --- | --- |
| AN-2 acceptance (local review record, not included in this source release) | Review conclusion, scope and deferred walkthrough status |
| Accepted AN-2 implementation export (local review record, not included in this source release) | Frozen 260-file snapshot of the exact source, notes and evidence reviewed |
| AN-2 notes snapshot (local review record, not included in this source release) | Retained note packet, source manifest and checksums |
| AN-2 synthetic captures (local review record, not included in this source release) | Six inspection cases and four cancelled signing previews |
| DP-2 evidence and owner closeout (local review record, not included in this source release) | Accepted synthetic workflow integration, retained experiments and negative model-quality findings |
| Readable report and lifecycle specification (local review record, not included in this source release) | Later presentation increment, retained report example and deterministic checks; no new settlement authority |
| [Validation and review history](READINESS.md#validation-evidence) | Executed checks, previous corrections and their limits |

The AN-2 focused run passed 24 tests. The earlier 168-test/27-parity integration
run and 152-test/21-parity core run are historical evidence; these are not counts
to add into a new test result. See [AN-2 validation](READINESS.md#an-2-documentation-and-consent-clarification)
for the exact scope.

Documentation maintenance after acceptance, 28 September 2026: the live index
now leads with the accepted baseline, historical validation is labeled explicitly,
and recovery guidance distinguishes intended operating restrictions from supported
features. The original scaffold inspection remains in the frozen export. These
editorial changes do not alter code, signed terms or accepted snapshot bytes.

Settlement documentation refresh, 29 September 2026: the live notes now explain
the existing release rule alongside DP-2's closed workflow scope. Companion mode
remains `ANALYSIS_ONLY`, financial authority `NONE` and settlement policy
`UNSPECIFIED`. This refresh adds no implementation, changes no signed record or
retained review artifact, and runs no further model-quality experiments.

Keep historical exports, logs, fixtures, manifests and their relative paths:
they preserve the evidence behind earlier findings, including failures. Similar
files can represent different review stages or intentional byte comparisons.
The dated export scripts reproduce their stated capture procedure; they are not
general commands for exporting a later working tree as a newly reviewed baseline.
The intermediate fixture cleanup note (local review record, not included in this source release)
identifies the redundant copies removed and the distinct report retained.
