# Operators union notes

**Status:** Working research notes and development questions  
**Created:** 4 October 2026  
**Basis:** Existing cooperation protocol, simulator and integration boundaries

The operators union is an important part of Non Verba's intended cooperation
model. These notes give it a continuing home alongside the dispute research,
Assignment explanations and sensor proposals. They connect the implemented
remuneration calculations to the larger idea and preserve the work still needed
to make collective participation meaningful.

The reference calculator and fictional simulator already exist. Membership,
collective authorization and a complete operational union remain unfinished.
The current protocol choices are a foundation for study; their implementation
does not settle every question about the eventual institution. New possibilities
below are research questions, rather than adopted policy or implementation tasks.

## Purpose and relationship to Non Verba

The existing [cooperation protocol](../../cooperation/COOPERATION_PROTOCOL.md)
gives Operators direct influence over minimum remuneration for defined work.
Their personal hourly settings and completed performances contribute to a shared
task price and expected duration. An Operator can retain a higher personal
minimum while benefiting from the collective floor.

The broader union idea concerns how Operators participate in determining the
conditions under which they work. Price and time are the quantities represented
by the current calculator. Membership, representation, other working conditions
and the processes for adopting or changing shared rules need further design.

The protocol describes a calculation with no board or delegated pricing
discretion. This does not establish a complete union constitution or answer how
every administrative or representative function should work. Those institutional
choices remain open.

Non Verba's [governance principles](../../../GOVERNANCE.md) describe the project's
intended purpose, protected rights and treatment of surplus. The union will also
need an understandable account of its own membership and authority. The project
governance draft does not supply that account by itself.

## What the current reference implementation establishes

The following choices are implemented reference behavior, as described in the
protocol. They are distinct from a deployed service or an adopted collective
agreement.

| Area | Current behavior |
| --- | --- |
| Personal remuneration | Each Operator has a personal hourly setting. Later changes affect future quotes and ballot candidates; existing ballots and acceptances retain their recorded terms. |
| Participation through work | One eligible performance permits one ballot with equal initial weight. More performances give an Operator more total influence. Completion alone does not authorize ballot casting; the Operator's authorization is required by the verification contract. |
| Time | Ballot influence decays linearly from completion time. Delayed submission cannot make an old completion fresh. |
| Collective terms | Separate weighted medians determine proposed task price and expected duration. An exact half-weight tie selects the higher value. The agreed baseline protects the task floor. |
| Sufficient participation | Both the number of distinct active Operators and effective vote mass matter. Insufficient support restores the agreement's baseline price and duration. |
| Demand | An optional, bounded shortage premium uses requested and available labour time. The surrounding system is responsible for authenticating these observations. |
| Individual acceptance | An offer must meet the collective minimum and the Operator's personal rate applied to expected time. Higher offers remain possible. |
| Accepted terms | New votes, personal settings and policies do not rewrite an accepted Assignment's remuneration terms. Approved extra time raises the minimum proportionally; faster completion retains the accepted amount. |
| Scope | Agreements, tasks and versions, jurisdictions, regions, counterparties and currencies keep their calculations separate. |
| Verification | The calculator requires approval of policies, complete ballot sets, individual ballots, demand, acceptances and working time where applicable. The actual authentication and approval systems are outside this library. |

These choices have consequences worth continuing to examine. Equal weight per
performance gives frequent performers greater influence than occasional
performers; it is not equal influence per member. Vote decay reduces influence,
and the collective price can fall back to the approved baseline when support
expires. It does not preserve every previously observed price indefinitely.

Changing a task's work unit could also change who earns how many ballots. The
protocol therefore keeps task definitions and versions explicit and rejects
duplicate performances in its supplied records. Establishing genuine work and
preventing artificial splitting still require an operational admission process.

The [Rust core](../../../code/crates/nonverba-cooperation/src/lib.rs) implements
the calculations, and the [host API](../../../code/protocol/cooperation.mjs)
connects them to verification callbacks. A callback's approval is an integration
claim. The arithmetic cannot establish the underlying worker, performance or
agreement merely because a caller supplies plausible records.

## What the simulator helps us explore

The [operators union simulator](../../cooperation/SIMULATOR.md) provides
fictional Operators, task categories, personal rates, completion histories,
policy settings and demand. Its setup editor and configuration import and export
make alternative scenarios inspectable. It calls the shared calculation core.

It can help examine how rates, participation, vote age, support thresholds and
demand affect collective terms. It also shows offer acceptance, retained terms,
approved overruns and faster completion. Its exported snapshot preserves the
scenario and its stated assumptions.

The simulator automatically adds a hypothetical ballot when a hypothetical
completion is added. That convenience does not implement real Operator consent.
Editing a policy in the simulator likewise does not implement a member decision
or counterparty assent.

The timeline hides future completions and acceptances, but does not reconstruct
past policies, personal settings or demand controls. A scenario should therefore
state what its timeline represents before being used to support a conclusion.
The simulator's consistency verifier, synthetic demand and unsigned exports
remain demonstration components.

The [cooperation validation record](../../cooperation/VALIDATION.md) preserves
the historical checks and their limits. [Unification validation](../../development/VALIDATION.md)
records later integration checks. This note adds no new test results or evidence
about a live union.

## Membership and genuine participation

The protocol does not provide member enrollment, identity recovery or a durable
completion ledger. A future design needs to explain who can participate, which
work qualifies and how eligibility is established and challenged. The meaning
of Operator in the Assignment protocol does not itself establish eligibility
for a particular collective labour arrangement.

Useful questions to preserve include:

- How does someone join, leave or recover access without losing the record of
  valid work or creating a second voting identity?
- What evidence supports a completion, its performer and covered working time?
  How can another participant contest those facts?
- How are genuine repeated performances distinguished from invented jobs,
  duplicated identities or task splitting intended to manufacture influence?
- What happens to a disputed ballot before a certified calculation, and how
  would a later correction work with the current immutable ballot format?
- How can a newcomer participate, and what does extended leave or infrequent
  access to work mean for influence?

The existing verification contract identifies these trust boundaries. It does
not choose the enrollment, appeal or correction mechanisms that fill them.

## Member decisions and amendments

Completion ballots supply observations for price and time under an approved
formula. They do not amend the formula, baseline, decay window, admission rules
or task definition. The protocol separately expects direct member approval and
counterparty assent for changes to the agreement and its policy.

The union still needs a reviewable process for proposing, discussing, accepting
and recording those changes. Questions include who participates in each
decision, what approval means, how dissent is handled, when a revision takes
effect and how participants inspect the exact terms they authorized.

The remuneration ballot's weighting should not silently become the rule for
every union decision. Whether constitutional, administrative and remuneration
decisions use the same participation mechanism remains an institutional question.
Funding, representation and administration are also open; this note assigns no
dues, governing body or new discretionary power.

## Task definitions and shared remuneration

An understandable task catalog is important to the calculation. Operators need
to know what work a task includes, which version applies and how measured time
relates to preparation, evidence production, additional work and expenses.
The current protocol includes covered labour time in the completion record and
expects that time to be approved or resolved under the agreement's process.

Further study could examine task granularity, inconsistent measurements,
heterogeneous equipment and experience, and the effect of a small or concentrated
group of performers. Baselines and support thresholds also need an adoption
process. Fictional simulator defaults do not select real remuneration or voting
policy.

The optional demand premium depends on credible demand and capacity. Defining
their scope, observation window and resistance to manipulation is unfinished.
The existing protocol permits this feature to be disabled while reliable inputs
are unavailable; simulated shortage does not establish real market shortage.

## Connection to Assignments and dispute resolution

The cooperation calculator and [Assignment protocol](../../requests/SPECIFICATION.md)
currently have separate records and verification boundaries. A future integration
needs to explain how a reviewed collective agreement, its policy version and
calculated terms become part of the exact Assignment accepted by the parties.
Approval of a collective formula, acceptance of a particular Assignment and
authorization of payment are distinct decisions.

Working time, scope changes, cancellation, partial completion and expenses need
an agreed treatment. The calculator supplies a minimum for approved time; it
does not decide disputed facts or transfer money. The existing
[settlement handling](../../requests/SETTLEMENT_HANDLING.md) has its own
authorization requirements. How the union's remuneration promises fit those
requirements is an integration question.

The [dispute research](../research/README.md) provides a place to develop the
interpretation and resolution mechanisms. Dispute priors express considerations
for disagreement; they are separate from remuneration ballots and do not give a
member extra union voting influence. The current dispute companion remains
analysis only, without financial authority.

Non Verba's protected-rights principle also remains relevant: a collective
calculation does not give two parties authority to improperly alter the third
party's contractual rights. Union participation and external accountability need
to fit that existing boundary.

## Legal scope and privacy

The [regulatory boundary](../../cooperation/REGULATORY_BOUNDARY.md) records the
existing review requirements for a future collective labour arrangement. It
distinguishes reviewed eligibility and agreement authority from successful
arithmetic. Its dated sources and jurisdictional scope remain attached to that
document; these notes add no new legal conclusion or selected organizational
form.

The operational design also needs to explain access to membership records,
personal rates, ballots and completion evidence. The protocol favors publishing
approved policies and aggregate calculation receipts while providing controlled
audit access to the underlying records. Removing an explicit rate field does
not necessarily hide the rate: price and time can reveal it together.

Retention and correction need their own policies. A ballot losing economic
influence does not remove the stored record or settle who may inspect it.
Research should consider what a member, counterparty, auditor and outside
reviewer each need to see, and how a calculation can be challenged without
unnecessary disclosure of individual records.

## Possible next research steps

The following is a proposed agenda for discussion, with no implementation order
or final mechanism selected:

1. Describe an Operator's journey from joining through performing work,
   authorizing a ballot, accepting an Assignment and contesting a record.
2. Describe a member decision that changes a shared rule, including the exact
   consent, counterparty assent and effective version.
3. Use explicit simulator scenarios to study frequent and occasional performers,
   newcomers, leave, limited participation, disputed work and manipulated inputs.
4. Trace one reviewed collective remuneration result into an exact signed
   Assignment, then follow approved extra time and a disputed payment through
   their separate authority boundaries.
5. Identify the smallest credible pilot scope and the evidence needed to assess
   participation, fairness, usability and operational trust within it.

The purpose is to develop the union idea progressively. New discussion can
extend these notes while preserving the distinction between an implemented
calculation, an observed result, a proposed institution and an authorized rule.

Return to [all notes](../README.md) or [all documentation](../../README.md).
