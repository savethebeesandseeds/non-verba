# Priors Derivation Lab 0.2 Study Plan

Proposed on 13 October 2026. Status: **PREDECLARED PROTOTYPE RESEARCH PROTOCOL**.
Execution has begun; [actual checkpoints and remaining gates](../study-v0.2/README.md)
are reported separately. Targets below are not completion claims. The completed
100-contract study remains the retained engineering baseline. Its six drafts are examples to challenge, rather than
required labels or a prescribed number of priors for this attempt.

The next attempt targets **15,000 selected MCC contract records**, following a
census of the entire pinned metadata release: 10,000 for discovery, 3,000 for
confirmation after meanings are frozen, and 2,000 for later-period replication.
Accepted texts, independent filers and agreement/template families will be
reported separately. Fifteen thousand URLs cannot be described as fifteen
thousand independent agreements.

These are operating targets, not sample sizes justified by a power calculation.
The study should establish coverage, representation quality, recurring concerns,
counterexamples and credible candidate distinctions. Selecting the first priors
also requires relevance and comprehension evidence beyond corporate contracts.

## Sampling the larger corpus

Pin the release manifest, codebook, metadata bytes and schema. Use the already
retained release for baseline comparison unless a newer release is explicitly
frozen before sampling. Count all records by available type, year, format and
filer fields, including missing values and excluded records. Count language,
industry or other attributes only when the schema provides them; otherwise use
an explicitly audited derived classification. The census uses the complete
metadata index, not keyword search results or a download of the entire text corpus.

MCC's parties and broad contract labels are machine generated and may be
inaccurate. Its source population consists of SEC material-contract exhibits.
These conditions remain relevant even with a large sample.
[Corpus description](https://mcc.law.stanford.edu/),
[collection and classification paper](https://arxiv.org/html/2504.02864v1).

| Sample | Selected records | Purpose and access |
| --- | ---: | --- |
| Broad discovery | 6,000 | Cover observed types, eras and filers, with minimum representation for rare nonempty strata. Allocate final quotas after the census and freeze them before downloading. Include audited unknown/noncontract labels as controls. |
| Assignment-relevance discovery | 4,000 | Enrich for services, supply, maintenance, construction, consulting, procurement and outsourcing using an explicit classifier/selection rule. Audit that rule. Analyze this sample separately from broad discovery. |
| Confirmation reserve | 3,000 | Unseen filers/agreement families, with type/era coverage comparable to discovery. Candidate authors cannot use this material while drafting. |
| Later-period replication | 2,000 | Later filings from reserved filers. Freeze the date boundary from the census; provisionally discovery through 2021 and replication from 2022 to the pinned release. Report the combined time and filer shift. |

Use reproducible ordering and a provisional cap of two selected records per
primary filer within its assigned sample. Feasibility and shortages must be
checked against actual populations; any revised cap or quota is frozen before
text inspection. Preserve selection ranks, sampling reasons and failure records.
Do not substitute attractive examples for failed selections. A reserve ordering
may supply replacements only if that mechanical rule is declared beforehand;
the originally selected failures remain counted and visible.

The relevance sample is deliberately enriched. Its frequencies cannot be treated
as corpus prevalence or participant preference strength. Exact inclusion weights
require a defined sampling design; until then, report coverage and separate
sample results rather than population estimates.

## Keeping confirmation independent

Assign primary-filer groups to samples before inspecting candidate meanings.
Use exact document identities, agreement/amendment/restatement links and broader
template evidence to detect cross-sample leakage. Reliable entity links may
extend a group; uncertain aliases or affiliates remain uncertainty, rather than
being silently treated as verified ownership relations.

Maintain two distinct notions of repetition:

- **Text repetition:** conservative exact/near families used to avoid counting
  repeated language as multiple discoveries. Changed amounts, negations, modals,
  conditions or exceptions remain available and cannot be collapsed as equivalent.
- **Template relatedness:** a broader blocking signal, including versions with
  changed names or numbers. Masking can help find a template for split control;
  it does not alter the retained text or establish equivalent legal meaning.

Generic boilerplate and ubiquitous counterparties must not join nearly the whole
corpus into one giant agreement family. Audit large components and report which
relationships create them. Reserve material that repeats a discovery template
belongs in a disclosed familiar-template diagnostic, rather than novel-family
confirmation. Pilot-seen records and filers cannot silently enter an unseen test.

Seal manifests and hashes for the reserve. Separate review agents receive only
frozen candidate cards and their evaluation packets, without the drafting
conversation. Record what was opened and when. This creates separately conducted
agent reviews; it does not make identical models independent human observers.
Once confirmation is opened, its results cannot be reused as a fresh test after
rewriting the cards. Revisions need a new untouched evaluation set.

## Improving the representation before scaling

Retain complete acquired source and normalized text. Extract operative sections
with conditions, exceptions, enumerated subclauses and continuations. Attach
verified heading paths and source offsets; expose uncertainty when the structure
cannot be reconstructed. Precompute word offsets once per document for context
retrieval instead of tokenizing most of the document again for every unit.

Identify signatures, address lists, inventories, page artifacts and redacted or
image-only material. Keep these records inspectable, with explicit reasons for
their discovery treatment. An address inside an operative notice rule or a
delivery inventory cannot be discarded merely because it resembles scaffolding.
Amendments should be linked to their base agreement where possible, or handled
as a separate incomplete-context cohort. Do not trust the metadata flags alone.

The provisional embedding target is **150,000–300,000 distinct contextual units
across all 15,000 selected records**, including the sealed evaluation samples.
It is a resource envelope to calibrate, not observed section coverage. The pilot's
17.9 embedded units per acquired contract resulted largely from its 20-unit cap.
Retain every extracted section and its exclusion/sampling reason. Benchmark
complete section coverage on 1,000 contracts before freezing the larger unit
recipe. If all sections cannot enter discovery, use a seeded, contract-balanced
sample with reported section-function coverage and a separate rare-function
sample. Do not silently return to 20 arbitrary fragments per contract.

Predeclare a 1,000-section review packet from discovery:

| Review packet | Sections | Purpose |
| --- | ---: | --- |
| Representation audit | 300 | Stratified random checks of source reconstruction, continuation, headings, conditions and exceptions. The first 200 can support development; reserve the remaining 100 for a fresh check after fixes. |
| Independent concept coding | 500 | Two separately conducted open codings, followed by reconciliation. Do not supply the original five or pilot six as category names. |
| Difficult and negative cases | 200 | Rare types, redactions, apparent amendments, structural noise, reversed duties and near matches with meaningful differences. Purposive findings are not prevalence estimates. |

Before expanding past calibration, require complete source reconstruction for
selected units and no unresolved observed loss of a material condition, exception,
negation or amount. Target at least 95% context/heading adequacy on the fresh
audit and report the denominator, uncertainty and variation across strata. This
is an engineering gate, not a guarantee that every provision was legally parsed.
Material failures trigger a repaired recipe and a fresh audit, with earlier
versions retained.

## Discovery and interpretation

Use the pinned MiniLM CPU model as a measured baseline, with actual token lengths
and complete admitted inputs. Batch inference and cache by normalized input,
model/revision, tokenizer and window-policy digest. Compare heading-plus-clause
with verified-section context on a fixed stratified subset. Compare a second,
separately pinned and license-checked sentence model on approximately 30,000 of
the same units. Select that model and its configuration before inspecting which
one gives preferred candidate names. Preserve a lexical retrieval/grouping
baseline to identify language and drafting-topic effects.

Benchmark scalable mini-batch clustering; predeclare k=32,64,128,256 and five
repeats, with a fixed primary schedule and contract/family-balanced influence.
Retain the exact spherical algorithm on a bounded comparison subset. A standard
MiniBatchKMeans run on normalized inputs remains an Euclidean implementation;
it must not be silently called spherical k-means. A spherical implementation
requires separate geometry and determinism validation. Mini-batches provide an
established scalable baseline, with an explicit quality tradeoff.
[Official clustering documentation](https://scikit-learn.org/stable/modules/clustering.html#mini-batch-kmeans).

Compare seed agreement, model/representation sensitivity, contract/era mix,
outliers, rare concepts and the influence of structural noise. Compute agreement
from contingency counts and use bounded diagnostic samples, rather than an
all-pairs similarity matrix. Cluster stability is one diagnostic, not the gate
that chooses the first priors.

Open coding should distinguish duties, rights, permissions, risk allocation,
procedure, factual conditions, purpose and potentially generalizable
considerations. Source comparisons and negative cases then inform ordinary-language
candidate declarations. Each candidate needs a fixed-facts higher/lower contrast,
scope, evidence, counterexamples, nearest confusion and transfer limits. Consider
competing or merged framings; no target count is prescribed.

Track discovery at cumulative checkpoints of 1,000, 3,000, 6,000 and 10,000
records. Compare concepts on shared evaluation material so changing cluster IDs
does not look like conceptual novelty. After coverage gates pass, use three fresh
predeclared batches of 100 sections to inspect whether new distinctions survive
coding and reconciliation. Continued novelty triggers an extension proposal,
potentially to 25,000 discovery records with a fresh reserve. Stable findings
describe those batches; they cannot establish an exhaustive moral vocabulary.

## Validation beyond the discovery sample

Freeze candidate wording, contrast, scope and evidence-selection rules before
opening confirmation. Search all reserved records, then inspect a fixed random
sample of 300 sections plus, provisionally, 50 retrieved matches and 20 nearest
confusions per candidate across distinct source families. Counts may overlap and
must be reported. Code each passage as supportive, contradictory, unrelated or
unclear; do not equate nearest-cluster assignment with confirmation. Repeat the
frozen procedure on the later-period sample and expose new or missing concepts.

Prepare at least 50 independently authored disagreement pairs, including
counterparty-benefiting invocations, irrelevant candidates and situations that
separate close concepts. Retain mandatory scope, consent, protected rights and
evidence rules at both emphases. Missing facts remain missing; no financial
outcome or historical payout becomes a target. Agent desk judgments remain
preparatory qualitative evidence.

For transfer outside MCC, identify and permission-check approximately 500–1,000
assignment-like agreements and 200–500 published disagreement/resolution records.
Treat these as later study targets until named sources and access terms are
reviewed. Retain jurisdictions, task types, selection methods and rights notices;
published outcomes are comparison material, not fairness ground truth.

Participant comprehension is a separate phase: formative interviews with roughly
8–12 people in each role, followed by a preregistered study whose sample size is
chosen from its actual design and uncertainty goals. A provisional 60–100-person
planning range is not a power calculation. Measure paraphrases, distinctions,
counterparty-benefit consistency and rule/preference confusion. This phase needs
real participants and cannot be completed through agent reviews or overnight compute.

## Engineering and resource envelope

Implement the new orchestration under this prototype's `study-v0.2/` subtree.
Preserve the completed 0.1 source recipe and results as the comparison baseline.
Use the existing managed Debian container and source snapshot procedure; do not
create a container, change ports/mounts or install host toolchains.

Large outputs stay under
`/opt/nonverba-build/priors-derivation/study-v0.2/<run-name>/`; pinned dependencies
and models stay under `/opt/nonverba-tools/priors-derivation-0.2/`. Keep local
exports to small reviewed reports inside ignored `artifacts/`. MCC material and
derived research outputs retain the stated CC BY-NC-SA conditions and attribution;
source licensing does not replace those terms.
[MCC license statement](https://mcc.law.stanford.edu/).

The runner needs an append-only acquisition ledger, immutable content hashes,
atomic completed shards and resumable verified work. Begin with one active
download; allow at most two after checking the documented download route and
observed service behavior. Respect Retry-After, use bounded backoff and pause
on persistent throttling. Resume the same selected IDs rather than selecting
different examples. A documented prepared subset archive may be more suitable
than individual requests; verify its exact manifest and recovery behavior first.

Store contracts, sections, variants, family membership, embeddings and coding in
bounded Parquet/typed-vector shards with a DuckDB query layer and small manifests.
Retain context through source offsets instead of duplicating the surrounding
text in every JSON record. Use indexed candidate generation for near repetition,
followed by the conservative exact comparison; audit candidate-generation misses
on a bounded exact subset. Paginate the review UI and fetch evidence by stable
ID. A 25 MiB browser-import limit cannot accommodate the whole expanded dataset.
Keep the clustering fit and all parameter selection restricted to discovery;
reserve vectors and content cannot enter candidate-author review or tune methods.

| Resource | Planning estimate or gate |
| --- | --- |
| Raw contracts | Pilot-average extrapolation is about 2.5 GB for 15,000 records. Broader types and larger sections may change this substantially; start with an 8 GiB raw-byte ceiling. |
| Main 384-dimensional float32 vectors | About 220–440 MiB for 150,000–300,000 units, excluding metadata and alternative representations. |
| Complete run storage | Provisionally 10–20 GiB with columnar storage; freeze a 24 GiB total ceiling after calibration and verify available space/headroom. No automatic cleanup or ceiling increase. |
| CPU inference | Pilot whole-analysis throughput was roughly 22 units/second, including other stages. Use a conservative planning band of 5–20 contextual units/second until the longer-input benchmark: about 2–17 hours for 150,000–300,000 units alone. |
| Acquisition | At an assumed aggregate 0.5–1 completed request/second, 15,000 requests take roughly 4–8 hours before failures/backoff. This is a scenario, not an observed large-run rate. |
| GPU | The existing container exposes GPU access, but prototype 0.1 forces CPU and skipped CUDA runtime installation. Acceleration needs an existing-runtime capability check and measured parity; no GPU speedup is assumed. |

## The first eight-hour execution stage

These are scheduling envelopes, with acquisition and processing overlapped after
manifests are frozen. The larger study remains resumable when the window ends.

| Elapsed stage | Concrete result |
| --- | --- |
| 0–1 hour | Metadata census, frozen provisional quotas/splits, reserve isolation and explicit byte/time limits. |
| 1–3 hours | Resumable shard storage/acquisition, indexed representation changes, source-integrity and interruption/resume checks. |
| 3–5 hours | A 1,000-contract calibration subset from the discovery sample, measured download/inference/storage throughput and initial representation audit. |
| 5–8 hours | Repair material representation failures, begin independent coding and continue the frozen acquisition toward the full discovery target as capacity permits; retain verified checkpoints and revised completion estimates. |

The 1,000-contract stage is a calibration checkpoint, not the final study size.
At its end, publish actual accepted/family counts, complete-section yield,
throughput, peak memory, storage and unresolved quality gates. Proceed toward
10,000 discovery records using those measurements; open the 5,000 reserve only
after candidate freeze. Acquisition and processing may require multiple compute
windows, and external relevance/participant work takes a separate research phase.

## Deliverable and definition of completion

Deliver a versioned census and frozen protocol; sample/split and leakage manifests;
complete sources with reconstruction records; scalable embeddings and all fixed
discovery attempts; coding/disagreement records; candidate revision history;
negative cases; sealed confirmation and temporal findings; and a paginated
review surface showing source-to-hypothesis lineage. Report external transfer
and participant phases as completed only when their actual evidence exists.

The contract-compute stage is complete when the declared discovery sample has
been processed or its explicit shortages documented, quality gates have passed,
candidate meanings have been frozen and independently challenged, and the reserved
evaluation results have been sealed. If the evidence supports retiring a candidate,
merging several or leaving a consideration unresolved, retain that result.
The first-prior decision remains an owner design decision supported by the
subsequent relevance and comprehension work.
