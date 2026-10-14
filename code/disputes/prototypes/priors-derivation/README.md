# Priors Derivation Lab 0.1 — PROTOTYPE

An isolated, **RESEARCH_ONLY** experiment for deriving a candidate vocabulary from
Stanford's [Material Contracts Corpus](https://mcc.law.stanford.edu/). It implements
the proposed [contract-corpus discovery route](../../../../docs/notes/research/DISPUTE_PRIORS_NOTES.md#discovering-candidate-priors-from-contracts).
The output is an inspectable set of hypotheses about considerations people might
declare when resolving a disagreement. Its authority is **NONE**; no candidate is
adopted and the signed five-prior catalog, declarations and financial core are unchanged.
The number of candidate priors need not equal five or any cluster count.

This README describes the method and usage. Actual acquisition counts, failures,
timings, clustering diagnostics and interpretations belong to each retained run.
A test pass, separated cluster or repeated contractual phrase establishes neither
fairness nor the usefulness of a proposed prior.

The proposed [0.2 study plan](plans/STUDY_0_2_PLAN.md) expands to 10,000 discovery
records and a sealed 5,000-record confirmation/replication reserve, with improved
representation, scalable processing and independent meaning evaluation. It is
planned work; the 0.1 recipe and its limits below describe the completed prototype.

## The experiment

1. **Freeze the source and sample.** Acquire the corpus homepage/license description,
   codebook, release manifest and bounded metadata index. Select contracts by seeded
   ordering within type and era strata, without keyword filtering. The recipe is
   70% services, 15% employment and 15% lease, spanning 2000–2009, 2010–2019 and
   2020–2025, with at most two records per filer. Include only HTML/plain text;
   exclude machine-flagged amendments, joinders and terminations. Labels remain
   unverified metadata. Retain unavailable selections and shortages without replacements.
2. **Extract and control repetition.** Parse HTML inertly, retaining normalized text,
   source hashes, section headings, clause context, offsets and exclusions. Offsets
   identify UTF-16 positions in normalized text, rather than original HTML bytes.
   Exact repetition and conservative near-duplicate families are inspectable;
   near matches preserve numeric and specified critical-token differences. Full
   extraction remains available even when a unit is excluded from discovery.
   Seeded per-contract selection initially admits at most 20 units per contract and
   2,000 overall, with chunks up to 160 words. These are sampling bounds, not a claim
   that every part of every contract enters the experiment.
3. **Partition families before fitting.** Hold out approximately 20% of contract
   families. Fit on one representative of each admitted clause family; repeated
   holdout clauses already present in fit are excluded from independent support.
   Held-out units do not enter centroids, lexical descriptors, representatives or
   fit-quality metrics. The retained report discloses partitions and exclusions.
4. **Embed complete selected inputs.** Use the pinned Apache-2.0
   `Xenova/all-MiniLM-L6-v2` revision in `prototype.json`, CPU float32, 384 dimensions
   and mean pooling. Inputs contain the section heading and complete selected clause;
   surrounding context remains separately retained for interpretation. Measure actual
   tokenizer lengths including special tokens. Longer inputs become overlapping
   windows of at most 256 tokens; combine normalized vectors with new-word weights
   and normalize the mean. No omitted tail is treated as a complete input. This general
   sentence model has not been validated for legal meaning or fairness.
5. **Retain all discovery settings.** Seeded spherical k-means requests k=8, 12 and 16
   with three fixed repeats each. Effective k can fall when directions coincide or
   clusters empty. The preselected middle setting's first repeat supplies the main
   inspection; it is not chosen for the best observed score. Expose representatives,
   descriptive terms, outliers, held-out support, adjusted Rand/coassignment agreement
   and cosine silhouette on a deterministic subset. Terms describe words; they do
   not automatically name a principle.
6. **Draft and inspect candidate meanings.** An explicit review file supplies cards
   with declarations, higher/lower contrast under the same facts, boundaries, nearby
   confusions, source support, counterexamples and domain limits. Cite retained clause
   IDs and cluster memberships. `complete` validates structure and references, then
   adds the authored [meaning probes](fixtures/meaning-probes.json) for owner review.
   Probes distinguish fact, declared emphasis and settlement consequence, including
   situations where the same declaration favors its author's counterparty. Structural
   checks and agent interpretation do not constitute participant research or owner adoption.

An explicit `evaluation_notes` packet may retain an independent agent desk review
of every candidate/probe pair. The optional packet identifies relevance (including
honest non-application), higher/lower readings with facts fixed, evidence limits,
scope guardrails and paired-role consistency. `lib/desk-review.mjs` checks coverage
and references only. Authored judgments appear beside the actual synthetic terms
and facts in the review screen; the separate human evaluation remains `NOT_RUN`.

The recipe is explicit and frozen when acquisition starts. To change sampling,
model or geometry, edit a reviewed recipe for a **new run**; retain earlier runs.
Corporate filings, filer caps, document exclusions, duplicate rules and unit sampling
all limit the conclusions. Frequency is not fairness.

## Run in the existing managed Debian container

Follow the [container plan](../../../../docs/development/CONTAINER_PLAN.md) and
[snapshot migration guide](../../../../docs/development/CONTAINER_MIGRATION.md).
Node, dependencies, model weights and browser tooling remain in Debian and the
existing `/opt` volume. There is no Python or Windows build/toolchain fallback.
`setup.sh` only installs the prototype's pinned dependencies; it has no container,
service or project-operation lifecycle commands.

From `C:\Work\Non-verba\open-source`, inspect the preserved environment. If it is
stopped, the documented sibling bridge starts only that pinned existing container:

```powershell
./code/dev.ps1 -Snapshot -Action Status
../private-source/code/dev.ps1 Up
```

The prototype wrapper never starts, recreates or replaces a container. Each action
uses the public `code/dev.ps1 -Snapshot -Action Exec` bridge and a fresh source snapshot.
It reuses the pinned dependencies in `/opt/nonverba-tools/priors-derivation-0.1`.
Setup and model provisioning may require network access; inference uses local weights.

```powershell
$prototype = './code/disputes/prototypes/priors-derivation/Invoke-Prototype.ps1'
& $prototype -Action Setup
& $prototype -Action Test
& $prototype -Action Acquire -RunName mcc-pilot-v01 -Count 100
& $prototype -Action Analyze -RunName mcc-pilot-v01
```

`Count` accepts 1–300. Run names are lowercase basenames; all run artifacts stay under
`/opt/nonverba-build/priors-derivation/<name>`. Acquisition creates a new directory
and refuses existing runs. Commands write new artifacts and preserve failures; they
do not silently overwrite or automatically retry an analysis until it looks favorable.
The default download bounds are 64 MiB metadata, 4 MiB per contract and 48 MiB total
contract bytes. Network acquisition has bounded retries recorded per successful request.

After interpreting `discovery-report.json`, put the explicit candidate review JSON
at a literal **container** path and complete the run:

```powershell
& $prototype -Action Complete -RunName mcc-pilot-v01 `
  -ReviewPath /opt/nonverba-build/priors-derivation/mcc-pilot-v01/review-input.json
& $prototype -Action Verify -RunName mcc-pilot-v01 -Replay
& $prototype -Action Serve -RunName mcc-pilot-v01
```

The review file is an array of cards or an object with `candidates` and optional
`evaluation_notes`, `findings`, `recommendations` and `next_steps`.
[evaluate.mjs](lib/evaluate.mjs) defines the exact admission checks; every card keeps
`AGENT_DRAFT_REQUIRES_OWNER_REVIEW` status. `Complete` creates `report.json` and a
final artifact manifest. Earlier stages alone create no completed candidate review.

The read-only server uses port 4173, `0.0.0.0` **inside the existing container** and its
already documented loopback mapping. Open
[the local review](http://127.0.0.1:4173/review.html). Keep the foreground server terminal
attached; stop that server with Ctrl+C. If 4173 is occupied, preserve the existing service
and coordinate use of the documented port. The server exposes review assets and the
selected `report.json`, rather than a directory listing or arbitrary source files.
`/review.html` has the narrow local selector style exception; scripts remain strict,
style attributes are forbidden and entries are `noindex`.

`Test` uses the existing Playwright module and browser cache under
`/opt/nonverba-tools/browser-tests`. If the verified executable requires an explicit
path, pass `-BrowserExecutable /absolute/container/path`; an alternate existing
module uses `-PlaywrightPath /absolute/container/path`. Missing browser resources
cause a reported skip, not a claim that browser checks passed. Tests install nothing.

For direct commands, the snapshot starts in its `code/` directory:

```powershell
./code/dev.ps1 -Snapshot -Action Exec -Command @(
  'bash','disputes/prototypes/priors-derivation/setup.sh'
)
```

The wrapper also verifies the dependency link in every fresh snapshot before invoking
the CLI; plain direct CLI commands need the same link to the existing dependency volume.

## Retained artifacts and replay

`config.json`, `sample.json` and `acquisition.json` freeze recipe, selections, sources,
release and hashes. `sources/` retains the checked corpus descriptions/index; `raw/`
retains exact acquired contract bytes. `extraction.json` retains full normalized source,
context, selected/excluded units, duplicate hypotheses and partitions.
`embedding-progress.ndjson` preserves completed inputs/vectors if inference fails;
`embeddings.json` records model artifact identities and token windows.
`discovery.json` retains every declared geometry run; `discovery-report.json` makes
them inspectable before candidate drafting. `candidate-review.json`, `meaning-probes.json`
and `report.json` retain the completed draft review. Artifact manifests bind retained
files; acquisition failures and `failures.ndjson` remain inspectable.

`Verify -Replay` checks source and artifact bytes, clause lineage, retained model files,
embedding admission and exact clustering replay from retained vectors. It does **not**
rerun inference, independently attest execution, establish legal equivalence, verify
the normative argument or adopt a prior. Keep the local model files available for
the model-artifact checks. A self-contained export would need an explicitly reviewed
artifact set and source/model terms; the current verifier is a local research verifier.

Prototype source is [AGPL-3.0-only](../../../../LICENSE). Corpus material and corpus-derived
research artifacts retain the corpus's **CC BY-NC-SA 4.0** notice, attribution and
share-alike conditions in `DATA_NOTICE.txt`; original contract authors may retain rights.
The [corpus site](https://mcc.law.stanford.edu/) directs commercial-use inquiries to its
maintainers. No commercial permission is claimed. Model weights retain Apache-2.0;
source licensing does not relicense corpus data or weights. Acquired data, dependencies,
model files and generated research artifacts stay outside published source; any small
review export placed in this folder belongs under ignored `artifacts/`.
