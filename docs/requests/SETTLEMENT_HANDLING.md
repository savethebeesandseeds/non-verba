# Settlement handling: current workflow and authority

Working documentation · 29 September 2026

Requester and Operator can discuss a resolution and jointly authorize the
existing protocol's limited release of identified claims. The dispute companion
helps retain priorities, evidence and interpretations for that discussion. It
does not decide an award or authorize a settlement.

**DP-2 is closed as the completed synthetic workflow-integration increment.**
The owner closeout (local review record, not included in this source release)
accepts that workflow based on retained evidence. The current local Qwen model
remains a workflow test component. Its negative evaluation findings stand;
reliable reasoning and the interpretation of priors into settlement are separate
future work, not conditions for reopening DP-2.

The [dispute lifecycle specification](DISPUTE_LIFECYCLE.md) separates existing
case records from the proposed negotiation interface: unilateral opening, exact
mutual consent, partial settlement and the still-unselected escalation procedure.
It adds no executable closure state or authority.

## From review to an authorized release

1. **Before agreeing to work**, inspect the signed Request and Quote, both
   independently signed priority profiles, and the exact proposed analysis
   settings. A participant can decline before base endorsement. Local preflight
   acceptance records that review; base Agreement and companion-annex signatures
   still form separately.
2. **If a dispute arises**, retain the exact case, attributed evidence, competing
   accounts and existing financial record. A signed claim proves its authorship,
   not its truth. Review any model interpretation against those sources.
3. **Discuss a proposal.** R, O or M may propose a resolution. Model text,
   priorities, an assurance assessment and a mediation proposal supply no new
   authority. A repair suggestion does not itself require extra or unpaid work.
4. **Choose the applicable existing action.** If R and O agree to release a
   supported claim, prepare a separate `BILATERAL_SETTLEMENT` proposal identifying
   its exact obligations, amounts, debt units and supporting certificates, with
   other rights reserved. The companion does not generate or submit this action.
5. **Review and authorize that exact proposal.** R and O each use their existing
   independent signing workflow. The core validates the required signatures,
   Agreement/policy context, entitlement basis and release scope. An accepted
   analysis report cannot substitute for either authorization.
6. **Inspect and retain the result.** The core reports the authorized release and
   remaining balance. Actual payment and a payee-signed receipt remain separate.
   Keep the analysis history and the contractual records; a scoped release does
   not automatically close every dispute or erase unrelated claims.

The [guided integration](INTEGRATION.md) gives the existing signing commands;
[dispute priorities](DISPUTE_PRIORS.md) describes preflight, case records,
questions, challenges and replay. These are supported workflow capabilities,
not a request to run further model-quality experiments for the closed milestone.

## What the records mean

| Record or label | Meaning for settlement |
| --- | --- |
| R/O priority profiles and analysis annex | Separately declared emphases and exact accepted analysis settings; no payment percentages, waiver or settlement formula |
| Model issue, comparison or question disposition | An interpretation to inspect; even `ANSWERED_FROM_SOURCE` or `UNNECESSARY` does not verify a fact or grant contractual authority |
| `SUCCEEDED` | Both recorded stages and their outputs passed validation; questions may still remain, and successful execution does not establish correct reasoning |
| `ANALYSIS_READY` in current inspection | The derived question account has no outstanding questions; dispositions remain model interpretations, not factual resolution, settlement or payment |
| Party or Mediator proposal | A position to consider; no contractual effect merely because it was proposed |
| Valid core `BILATERAL_SETTLEMENT` certificate | The specific authorized release permitted by the core; unrelated rights remain |
| Payment observation / payee receipt | A payment claim / the actual creditor's scoped discharge record; neither is created by analysis, and no action transfers funds |

The companion remains `ANALYSIS_ONLY`, with financial authority `NONE` and
settlement policy `UNSPECIFIED`. Those labels concern the companion and the
unselected interpretation of priorities. The core's existing signed-release
rules remain implemented and separate.

## Exact limits of the existing settlement action

The current action is enabled only when the Agreement's
`bilateral_balance_releases` policy permits it. It releases existing obligations
whose debtor is R, creditor is O, and category is `COMPENSATION` or `EXPENSE`.
Each release must name its entitlement basis and exact allocated units, with
matching currency/exponent and release amount. R and O must authorize it.

This action cannot create a new payment obligation, refund, arbitrary Agreement
patch, protection-claim release or change to M's fees, duties or rights. A change
to agreed work or other supported terms needs the applicable separate amendment
path and its required authority. Unsupported outcomes remain unsupported.

Release coverage and receipt coverage are reported separately; overlapping units
count once when reducing the outstanding balance. The implemented release is irrevocable within this
action model: reversing a receipt does not revoke a release of the same units.
Historical records and unrelated rights remain visible.

For example, if EUR 100 of compensation is established, with no receipt coverage,
an authorized EUR 25 release leaves EUR 75 outstanding. M's separate EUR 5 fee
would remain untouched. The EUR 25 is the parties' chosen release, not a value
computed from priorities or inferred from the model. The retained
synthetic settlement inspection (local review record, not included in this source release)
illustrates the existing mechanism; it is not a new execution or adopted price.

Implementation references: [required authorizers](../../code/requests/src/actions.rs),
[settlement scope and entitlement checks](../../code/requests/src/bundle.rs),
[unit coverage and discharge](../../code/requests/src/rights.rs), and the
[analysis pipeline](../../code/disputes/src/pipeline.rs).

## Separate future work

Reliable reasoning and a procedure translating priorities into a settlement
remain distinct research and design tasks. The current research interface admits
candidate-policy metadata but returns `POLICY_NOT_IMPLEMENTED`; it selects no
default formula, split, award or enforcement rule.

A future procedure must define its evidence requirements, protected rights,
authority, challenge process and economic fallback. An unresolved case is not
necessarily economically neutral: already performed work and retained money
can leave parties with different unrecovered losses. Compute sponsorship alone
does not resolve those losses. See the [open decision record](DISPUTE_PRIORS_DECISIONS.md).
