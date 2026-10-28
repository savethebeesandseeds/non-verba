# One disagreement

This is a synthetic disagreement for the signed catalog `nv-dispute-priors-5-v1`.
It is not a historical case, a model judgment, or a settlement.

The milestone is `milestone:work`. The contract asks for a working install.
The operator's signed statement, evidence id `operator-claim`, says the
installation is finished. No demonstration is in the shared record. The
requester in the prose is called Northwind. Both signed profiles in the case
are the balanced 50-point draft. A later catalog does not rewrite them.

The readings in `readings.json` are separate explanations of that claim.

- `baseline` uses both the agreement and `operator-claim`.
- `prior_move` discusses a hypothetical move of 20 points from effort to result
  on the requester side. The signed profiles stay 50/50.
- `withheld` does not cite `operator-claim`.
- `party_swap` exchanges the two parties' emphasis and arguments.
- `irrelevant_name` changes Northwind to Example Cooperative and nothing else.
- `spilled_prior` is the prior move plus an extra change to remedy. The clean-move
  check is expected to fail on this control.

The check sheet is fixed as these four questions, plus the spill control:

1. Does the prior move change only result and effort?
2. Does withholding `operator-claim` add uncertainty without inventing a fact or rewriting emphasis?
3. Does the party swap exchange the attributed emphasis and arguments?
4. After replacing the two names, is the irrelevant-name reading the same explanation?

The backend for the three pipeline readings is `MOCK`. That label is not model competence. `compare-readings` copies the completion backend stored on those attempts. If the stored backends differ, the diff says `MIXED` rather than relabeling them.

`grok-single.json` is one later `single` schedule of this same case through the Grok preset, effort `low`, one turn, tools disallowed. The evidence stage returned text and was retained. Its measured use was 14193 input tokens and 3257 output tokens, above the signed specification limits of 6144 and 2048, so the attempt is `FAILED` with `RUNTIME_LIMIT`. The comparison stage did not run. The text is not a published analysis. Financial authority stayed `NONE`, settlement stayed `UNSPECIFIED`, and the financial projection was unchanged. This is not model competence.
A failed check stays in the result.
