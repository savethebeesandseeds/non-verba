# Migration and legacy preservation

## No automatic upgrade

Protocol 2 introduces signed unit allocations and amendment cutover semantics.
Protocol-1 objects did not authorize those rules. Do not change a version field,
supply inferred allocations, regenerate signatures, reinterpret old balances under
the new reducer, or require reconsent merely to retain an established old claim.

Retain exact original bundles, trust bindings, policies, text, requests, evidence,
signatures and receipts. The authentication-only v1 inspector verifies actual
version-1 signature contexts without invoking the withdrawn financial reducer.
`recognized_legacy_proofs` preserves authenticated action proposals/authorizers;
`retained_events` preserves authenticated events without claiming that the new
policy has validated their historical effects.

A legacy report always identifies `financial_projection: LEGACY_UNRESOLVED`,
returns no synthesized aggregate obligations/payments/effects and never marks
readiness. Its empty aggregate list is not zero debt, payment reversal, a waiver,
or rejection of a previously established entitlement. Incomplete signatures and
unavailable references remain explicit diagnostics.

The retained synthetic baseline at
`code/requests/tests/fixtures/legacy-v1/{bundle,trust}.json` remains unchanged.
It is copied from the original corrective-review record, not re-signed as v2.
Tests compare its existing signatures and preserve its exact authorization bytes.
Test identities/receipts establish no real-world payment or identity.

## Explicit future adoption

Any decision to use protocol 2 for future work needs the actual parties' exact
new agreement. Preserve prior rights independently. An explicit negotiated
settlement or future novation must identify the claims it changes and obtain the
necessary authority; a database migration cannot perform that legal or contractual
operation. Protocol 2 does not implement general novation of existing units.

The earlier bilateral type/trait scaffold likewise supplies no invented R/O/M
signatures. Legacy sensor artifacts retain their own request, keys, format,
evidence bytes and verifier limitations. This work does not rotate sensor keys,
change enrollment or acceptance ledgers, or turn old photos/GPS into Agreement
consent.

For prospective protocol-2 records:

1. Establish independent original role/key bindings and the exact applicable terms.
2. R signs a Request and O signs its quote/terms hash; all three review/sign the
   exact new Agreement.
3. Retain the complete local certificate before readiness. Check the actually
   supported prerequisites.
4. Financial receipts/releases sign their exact obligation/root-basis/unit ranges.
   Never allocate old observations using a presumed remaining balance.
5. An amendment signs its observed frontier, preserved claims and exact
   grandfathered actions. Positive causal successor knowledge limits fresh
   retired powers; missing history does not waive omitted accrued claims.
6. Export each participant's entitled signed records without depending on M's
   continued availability.

## Storage and adapter transition

Keep `code/requests` independent of concurrent sensor code and build files.
A future application adapter must use the same strict verification boundary for
admin, batch, migration and payment paths. Discovery visibility, moderation and
operational metadata never gain authority to alter signed rights.

Retain raw input bundles and rebuild projections from verified records. Preserve
incompatible signed statements as evidence without retracting an independent
grant. Exact duplicates are idempotent. A new version cannot become authoritative
through a mutable policy URL, server status or application update alone.

Protocol-2 snapshots must retain `unresolved_rights` as well as active obligations.
An omitted cutover frontier or incompatible joint expense claims may leave
individually valid proofs with conditional principal/discharge/release amounts.
`PARTIAL_UNRESOLVED_V2` does not authorize summing these alternatives or replacing
them with zero debt. Their records must survive projection and storage upgrades.

The current local R signer reserves one Assignment ID per Request across its
revisions; this is local refusal, not proof of global uniqueness. Back up the
vault with its sibling signing-guard directory. Copying only the key or rolling
back ordinary guard files can defeat local anti-equivocation history.

Import/merge writes encrypted immutable snapshots. `export-store` explicitly
decrypts to a selected plaintext file; exporting does not erase either source.
Enforce recipient access and retention separately, and respect the local 2 MiB
encrypted-plaintext bound. Build/test only through the approved managed container,
as described in the [package README](../../code/requests/README.md).

## Rollback

Keep exact source bundles and the verifier version used. Restoring an older local
projection cannot make it a complete/latest history. Unsupported future versions
remain rejected or unverified; do not apply the nearest old policy.

When key recovery would require unsupported authority, the intended operational
restriction is to stop new signing and preserve historical signatures and rights.
This prototype does not implement account recovery or an administrative freeze
workflow. An account administrator cannot replace contractual signing authority;
see [the Agreement's recovery boundary](AGREEMENT.md#amendment-and-settlement).
