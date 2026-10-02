# Dispute analysis companion

`nonverba-disputes` 0.1.0 is a native Rust companion to the unchanged
`nonverba-requests` 0.2.1 library. Extension record version is `1`; the dictionary
is `nv-dispute-priors-5-v1`. It shares the Cargo workspace and lockfile in `code/`
with the other Rust packages. Project-owned source and documentation are licensed under
**AGPL-3.0-only**; see the [root license](../../LICENSE) and
[third-party notices](../../THIRD_PARTY_NOTICES.md). Actual participant records,
keys and vaults are not part of the public source repository.

Read [the participant and implementation explanation](../../docs/requests/DISPUTE_PRIORS.md),
[open decisions](../../docs/requests/DISPUTE_PRIORS_DECISIONS.md) and
[runtime prerequisites](RUNTIME.md). Financial authority is **NONE**; settlement
policy is **UNSPECIFIED**. No analysis function constructs or submits a core Action.

The implemented DP-2 synthetic workflow uses Qwen as a workflow test component in
`ANALYSIS_ONLY` mode. Its implementation does not establish reliable reasoning.
Model interpretations, including question
dispositions, are neither verified facts nor contractual authority. Reliable
reasoning and a policy for interpreting priorities into settlement are separate
future work. Deterministic tests do not establish useful model reasoning or fairness.

The core already has a narrow R/O-authorized release action. It requires separate
exact review and independent R/O signatures; it is not an effect of analysis.
See [settlement handling](../../docs/requests/SETTLEMENT_HANDLING.md) for its scope
and the separate amendment, payment and receipt paths.

| Module | Responsibility |
| --- | --- |
| `binding` | Exact dictionary, allocations, authenticated source profiles, three-party annex and domain-separated authorship |
| `consent` | Full retained review, typed digest confirmation, independent trust and existing vault/guard boundary |
| `preflight` | Pre-cooperation profile/settings comparison, unsigned local acceptance or decline, guarded base/annex signing and exact setup matching |
| `case` | Core snapshot, shared evidence, revision/history validation and attributed challenges |
| `runtime` | Pinned local adapter, bounded template/token admission, explicit mock and unavailable backends |
| `pipeline` | Two passes, structure/citation validation, fixed schedules, budgets, retention and independent replay |
| `report` | Readable case, consent, claim, financial and interpretation summary from independent verification, followed by the full inspection |
| `research` | Explicit synthetic candidate-policy manifest; evaluation not implemented |
| `main` / `commands` | Guided signing and JSON case/analysis commands over the same library functions |

Historical DP-1 real-model observation: the separately provisioned small SmolLM2 CPU model
reached the output limit in the opt-in probe. The pipeline retained the failure
and preserved core rights; usable two-pass analysis is not established. GPU use
was deferred in that checkpoint. The current managed GPU environment is documented
in [container development](../../docs/development/CONTAINER_PLAN.md); provisioning
alone does not establish useful two-pass analysis. The minimal
[historical failure replay fixture](tests/fixtures/historical-v1/README.md)
preserves that distinction without publishing runtime resource records or logs.

## Build in the existing managed container

From the repository root, use the managed Debian container and authoritative
launcher. Container reuse and setup are documented in the development guide.
An existing container bound to the former checkout uses `-Snapshot`; see
[container migration](../../docs/development/CONTAINER_MIGRATION.md).

```powershell
./code/dev.ps1 -Action Exec -Command @('cargo','build','--locked','--offline','--manifest-path','disputes/Cargo.toml','--bin','nonverba-disputes')
./code/dev.ps1 -Action Exec -Command @('cargo','build','--locked','--offline','--manifest-path','requests/Cargo.toml','--bin','nonverba-workflow')
./code/dev.ps1 -Action Exec -Command @('/opt/nonverba-build/target/debug/nonverba-workflow','disputes','guide')
./code/dev.ps1 -Action Exec -Command @('/opt/nonverba-build/target/debug/nonverba-workflow','disputes','guide-data')
```

The existing workflow delegates only the explicit `disputes` command to its
separately built sibling. The original signing/financial commands are unchanged.
For interactive authorization, use an attached terminal in Debian. Never put a
passphrase in command arguments. Each party retains its own vault and signing guards.

## Guided sequence

1. Establish independent role/key trust. Publish the signed Request with R's own
   signed profile; then O supplies its signed Quote and independently signed profile.
   Edit explicit allocation files if needed, validate, review and have each owner
   authorize its profile. **Do this before endorsing the base Agreement.**
2. Select the exact proposed analysis settings. `spec` preserves the version-1
   default; `spec-v2`, `spec-v3`, `spec-v4` and `spec-v5` explicitly select later drafts.
   `spec-v3` opts into the bounded-output experiment profile without changing any
   older signed specification; `spec-v4` and `spec-v5` select successive prompt/schema experiments.
   Changing versions requires a new exact preflight review and local decision;
   an earlier acceptance cannot approve the changed settings. These commands create `MODEL_UNAVAILABLE`
   drafts; actual model/runtime identities still need explicit review before
   binding. `preflight-review` verifies both profiles and their
   exact Request/Quote, displays both allocations in dictionary order, and retains
   the complete signed sources, settings, fingerprints and independent trust hash.
   Each participant uses `preflight-decide` to accept or decline that exact full
   digest locally. An extreme but valid allocation can be a reason to decline;
   points do not predict a payment, fairness or another party's actual intent.
3. If proceeding, `preflight-base-review` requires the local acceptance and a
   matching proposed base Agreement. It retains that Agreement for a separate
   exact review. `authorize-preflight-base` checks again before requesting the
   passphrase, signs only the accepting role's base endorsement, and preserves
   the existing core authority and exclusive signing guards. Use the existing
   workflow's `attach endorsement` to assemble the base signatures.
   After base formation, `draft-context` and `review context` retain the same
   profiles/settings against the exact formed Agreement. Each participant uses
   `authorize-preflight-context`; it rejects substituted profiles/settings and
   a vault for a different locally accepting role. Merge with `attach-context`.
   `complete-setup` requires the retained local acceptance, exact material match,
   independently verified base and all three annex endorsements.

The preflight decision is **unsigned local workflow evidence**, not proof of
another participant's consent or a new contractual signature. These checks are
mandatory in the new `*-preflight-*` signing path and `complete-setup`; existing
signing commands remain valid under their original rules. `inspect-context`
reports base and annex formation only. Neither local acceptance nor a failed
preflight check changes those historical states or accrued rights. Base and
annex signatures are separate, not atomic. No step grants robot actuation or
establishes physical safety. A changed profile or specification requires a new
exact preflight review and decision; accepted annex succession remains restricted
as described in [the participant notes](../../docs/requests/DISPUTE_PRIORS.md).

After separately verified formation:

4. `draft-case` takes the base bundle, independent trust, complete annex, case ID
   and an explicit scope JSON array, for example `["milestone:work"]`. Keep the
   independently computed financial projection separate from the analysis.
5. To submit a claim or answer, retain its original file. `draft-submission` binds
   its exact bytes. `review evidence` followed by the owner's `authorize` creates
   the attributed submission. `add-evidence` puts those bytes in a case draft.
   `inspect-case` and `package` perform complete verification before analysis.
   Extraction, omission or a voluntary offer needs an explicitly edited typed
   draft and the applicable validation; no generated guess becomes original evidence.
6. Create a budget with `draft-budget`. A useful synthetic starting budget is
   `synthetic-development 3 65536 900000 8`. `package` freezes the initial case and
   budget. `mock-responses` creates a labelled script; `run-analysis` can use that
   script or the unavailable backend now. `local` requires the actual independently
   provisioned server/configuration described in RUNTIME.md. No fallback downloads.
7. Choose `single` for one declared attempt or `diagnostic` for all three seeds.
   Use a new output filename and either an explicit cancel-file path or `none`.
   Creating that file requests cancellation. Both modes consume the same cumulative
   budget; a diagnostic run after a single may require a budget allowing four runs
   selected before the package is frozen. Repeated identical schedules are refused.
8. `report-analysis` writes a readable report; `inspect-analysis` produces JSON.
   The report separates signed Agreement/annex/profile records, attributed evidence,
   existing core balances and scoped releases, model interpretations and question
   dispositions, and signed challenges. It shows source hashes, exact amounts and
   receipt/release overlap, preserves failed and stale attempts, and appends the
   complete independent inspection. Invalid packages suppress participant/model
   summaries while independently verified core results remain visible. Displayed
   text is quoted and control-escaped; long source excerpts are labelled and never
   replace original records. Rendering neither runs inference nor signs a record.
   Each attempt identifies its execution origin. Mock output is visibly synthetic
   and is not eligible as a real local analysis; a local label remains an
   unverified runner claim. Stage-specific provenance remains in the report.
   `revise-case` starts a new revision retaining previous evidence, using the
   updated core bundle. Add the signed answer/evidence, then `append-case` validates
   and retains it. Previous attempts become stale for the new case. Do not edit a
   published case or hide an earlier failed attempt.
   A changed Agreement/annex needs a separate case and package; appending preserves
   the existing context. Redaction in a new revision does not erase retained
   earlier evidence, prompts or raw outputs from an export.
9. `draft-challenge`, `review challenge`, the author's `authorize`, then
   `append-challenge` retain an attributed contest. Challenges do not undo rights
   or declare an appeal result. For a challenge to an older case, construct the
   typed body against that retained case; the validator checks its exact identity.
10. `export-analysis` writes the portable plaintext record. The recipient runs
   `replay-analysis` against independently retained trust; `import-analysis` saves
   a verified package under a new path. Replay does not run a model or acquire
   authority. Keep original source records and any incomplete attempt journals.

Use `guide` and `guide-data` for exact current argument order. Rust consumers use
the same typed public library functions; no unattended signing authority, hosted
API, marketplace or MCP service is created by this increment.

The [lifecycle specification](../../docs/requests/DISPUTE_LIFECYCLE.md) records
the future negotiation interface and its open decisions. The readable report
adds no case-closure or escalation command and does not select a settlement policy.

## Deterministic checks and research

```powershell
./code/dev.ps1 -Action Exec -Command @('cargo','test','--locked','--offline','--manifest-path','disputes/Cargo.toml','--all-targets')
./code/dev.ps1 -Action Exec -Command @('cargo','fmt','--manifest-path','disputes/Cargo.toml','--check')
./code/dev.ps1 -Action Exec -Command @('cargo','clippy','--locked','--offline','--manifest-path','disputes/Cargo.toml','--all-targets','--','-D','warnings')
```

The ignored real-model smoke is intentionally excluded; its explicit command is
in RUNTIME.md. [Synthetic research cases](fixtures/research/README.md) are scenario
inputs and perturbation recipes, not completed model evaluation or human fairness
labels. The fixtures in `tests/fixtures/historical-v1` retain the original failed
version-1 portable replay bytes. The companion also checks the public synthetic
Assignment vectors in `../requests/tests/fixtures/integration`. Operational
captures, sensor evidence and resource provisioning are separate from these tests.
