# Priors Derivation PROTOTYPE Findings and Handoff

Non-verba | Priors Derivation Lab v0.2 | 19 October 2026

## Summary

**The study is stopped at the owner’s request. It has not produced a validated first set of priors.** The main outputs are a reproducible corpus sample, a working extraction and review system, and evidence that important conditions and exceptions can disappear from the text supplied to a model.

The work began as an overnight prototype and expanded into several days of investigations into source representation, context selection, token limits and review delivery. Some of that work is reusable. It did not complete the larger discovery study or answer which priors Non-verba should adopt.

### What we learned

A contract clause can retain its words while losing the condition, exception or definition that controls its meaning. A nearby-text window and even a complete stored section can miss that relationship. Several repairs restored literal evidence, but the experiments did not establish that the models understood the restored relationships or improved their judgments.

### What we have

We froze a large metadata census and a 15,000-record study selection. The current calibration still covers the first 1,000 selected records: 994 were acquired and 937 were accepted for processing. We preserved versioned extraction outputs, source audits, partial independent codings, reversible review tools and detailed failure records.

### What this means for us

These results can guide the evidence model and the design of a smaller, human-reviewed candidate exercise. They do not justify treating contract frequency, embedding clusters or agent agreement as participants’ priorities. We have no validated v0.2 candidate freeze, confirmation result, temporal replication result or participant-comprehension result.

This handoff explains the approach, concrete findings, unfinished work, reasons for the delay and retained artifacts. The study will not resume automatically. All v0.2 outputs remain **PROTOTYPE and unadopted**. [evidence appendix](#evidence-and-artifact-locations)

## The question we were trying to answer

The purpose was to find a defensible starting vocabulary of candidate priors for Non-verba using recurring patterns in an open contract database. A candidate would need a clear meaning, traceable examples, counterexamples and later evaluation. Selecting the first priors remained a product and research decision; the prototype was intended to inform it.

The study used the MCC open contract dataset. It provides evidence about what particular contracts say. Contract drafting can reveal recurring obligations, permissions, conditions and allocations of risk. It cannot by itself establish what people ought to value or which priorities Non-verba’s participants will understand and endorse.

### The expanded study design

| Component | Planned scope |
| --- | --- |
| Discovery | 10,000 selected records across broad and relevance-oriented arms |
| Confirmation | 3,000 reserved records, held apart from discovery |
| Temporal replication | 2,000 reserved later-period records |
| Representation audits | 200 development cases, 100 fresh cases, two separate codings of the same 500 sections, difficult and negative cases, and rejection controls |
| Comparisons | Approximately 30,000 units for planned model, context and lexical comparisons |
| Overall unit budget | 300,000 units reserved in the study design; not a count of completed work |

The design separates filers across study partitions, preserves acquisition failures without replacing them, and controls repeated contract language so prolific filers and repeated forms do not dominate. Candidate meanings and evaluation were supposed to be frozen before the untouched reserves were opened. [E1]

### The distinction that governs this handoff

There are four different achievements: preserving source evidence, interpreting it correctly, showing a useful recurring pattern, and deciding that the pattern belongs in Non-verba. The work made progress mainly on the first and exposed problems in the second. It did not complete the third or fourth.

## The data we actually processed

The size of the frozen selection must be distinguished from the amount acquired and reviewed. The larger selection is ready as a sampling frame; it is not a completed 15,000-contract analysis. [E1], [E3]

| Measure | Retained result | Meaning |
| --- | --- | --- |
| Metadata census | 1,168,530 records<br>29,476 filers | A frozen metadata inventory, not that many reviewed originals |
| Study selection | 15,000 records | 10,000 discovery + 3,000 confirmation + 2,000 temporal |
| Calibration denominator | 1,000 selected records | The acquisition tranche actually attempted |
| Acquired | 994 | Six records ended in terminal acquisition failure |
| Accepted for processing | 937 | A processing status, not a semantic-quality pass |
| Rejected after acquisition | 57 | Retained as rejections rather than silently replaced |
| Current extracted parents | 13,583 | Stored section-level contexts |
| Current provisional units | 20,504 | Smaller spans prepared for study |
| Representative units | 20,266 | Deduplicated representatives; not a claim that all have current vectors |

The current frozen V6 extraction rebuild completed and produced a terminal manifest. It ran no new acquisition, model inference or reserve evaluation. Historical versions did complete particular vector and geometry runs, but those outputs cannot be relabeled as current-source completion. [E1], [E3]

Acquisition success and extraction success answer whether data was obtained and processed. They do not answer whether the text retains every qualification needed for interpretation. That distinction is why the source-quality investigation became central.

### What these numbers do not tell us

They do not establish a prior’s prevalence, an unbiased distribution of human concerns, model accuracy, generalization beyond this corpus or the adequacy of the first priors. The first 1,000 records are a calibration tranche, not a finished discovery result.

## The approach and its evidence standards

The intended pipeline was to freeze the sample, acquire originals, extract sections and smaller units, deduplicate repeated language, inspect source fidelity, create model representations, discover patterns, reconcile independent meanings, challenge candidates and finally evaluate frozen candidates on reserved material.

### Why source review came before candidate claims

The project instructions require more than plausible summaries. The investigation compared what the original contains, what the normalized text preserves, what a focal unit and its context include, and what each actual model input contains. It kept failures and unavailable sources visible rather than treating them as successful examples.

A stored parent is the section used to provide context around a smaller focal unit. The full contract can contain additional definitions, exceptions, schedules or exhibits beyond that parent. Native evidence retains details of the source representation; its metadata can be much larger than the readable clause.

### What the controls established

Exact hashes and source-version records kept outputs tied to particular inputs and methods. Round-trip checks established whether a compact review representation could reconstruct its original. Separate page emissions and reading acknowledgments recorded what an agent actually received. Fresh-set exclusions kept development work away from reserved audit material.

These controls establish provenance, transport and declared reading scope. They do not establish that an interpretation is correct. A passing synthetic test checks a program’s behavior on its fixture; it is not evidence that a contract was understood. An acknowledgment is an agent’s reading declaration, not a human review.

### Why versions matter

A source or representation repair can invalidate earlier vectors and audit conclusions. The retained records therefore separate historical results from the current frozen extraction method. Internal labels such as V9 and current V6 refer to method histories; they are not a simple count of product releases. [E1], [E2]

This was a careful evidence standard, but its implementation became too elaborate for the original overnight deliverable. The failure to keep that expansion bounded is addressed later in this report.

## What the source audits found

**Preserving words is insufficient when the relationship between them is lost.** Earlier reviews found construction conditions detached from the clauses they govern, license restrictions and confidentiality exceptions omitted from a focal view, and a vesting rule separated from the tables it controls. Repairs resolved particular cases for particular source versions. [E1]

### The clearest completed development audit

| Historical V9 judgments | Adequate | Inadequate | Unavailable controls |
| --- | --- | --- | --- |
| Context | 138 | 57 | 5 |
| Heading | 116 | 79 | 5 |

These are 200 completed historical development judgments: 195 assessable cases and five unavailable-source controls in each row. They are not a corpus prevalence estimate, a current V6 pass or an untouched fresh-audit result. They nevertheless show that context and heading problems were frequent enough in that reviewed set to require attention. [E1]

### A heading can change the implied meaning

A selected or generated heading can appear to govern text that the original places differently. A literal caption must be preserved as evidence without automatically importing an entire neighboring body or inventing a hierarchy. This is especially important when a focal view begins or ends inside a list.

### A complete available document can still be incomplete evidence

A document can refer to absent schedules or exhibits. Reading every stored character does not recover those missing materials. The correct result is an explicit limitation, not an inferred reconstruction.

### The practical requirement for the project

Evidence for a candidate meaning needs to retain who is acting, what is permitted or required, the conditions and exceptions, when the rule applies, and the definitions or references on which it depends. Each of these must remain connected to the focal rule. This is a design consequence of the observed failures; it is not an adopted prior vocabulary.

We have not yet established that the current automatic context-selection method reliably achieves this requirement across the corpus.

## The cases that explain the central problem

### Case 0004 restores a qualifier but leaves model behavior untested

The full stored parent contains 9,113 characters and restores a waiver or consent qualifier missing from the smaller view. An unadopted lossless dictionary representation fitted that parent into 23 independently recounted windows, each at most 256 tokens. This demonstrated a bounded representation and preserved literal content. [E2]

Ordinary placement still separated the qualifier from the focal covenant. A 123-token joint span included the qualifier and the first focal word while excluding most of the covenant. Neither result showed that a model bound the qualifier to the complete rule or produced a better judgment. The positive finding is literal availability within a representation, with a clear limit on what was tested.

### Case 0047 shows dependencies beyond the stored parent

The focal span ends inside a court-motion list covering clauses 53(a) through 53(o). Later timing, extension and termination provisions affect how the agreement operates. Referenced Exhibits A through D were absent from the available admitted original. [E1]

A full stored parent or normalized document therefore does not establish a complete account of the agreement. The missing exhibits must remain missing evidence. No complete interpretation was manufactured from their titles or references.

### What these cases establish together

A useful context strategy cannot be defined only by a fixed number of neighboring words or by the nearest section boundary. It must account for governing language and document references. The investigation established concrete failures of the simpler views, but it did not validate a general repair.

The useful outcome is a concrete requirement: make missing dependencies visible before interpreting a focal clause.

## Case 0055 and the unresolved context repair

Case 0055 is the most developed unresolved example. The focal span and its 60-word neighboring context omit the section 11 introduction containing an agreement-term limitation, an exception for written permission from the CEO, and a directly or indirectly qualifier. The original and retained raw context contain that language. Omitting it can materially change what a reader thinks the focal restriction says. [E1], [E2], [E7]

### What the later source review added

A previous source review separately acknowledged 21 pages: six contiguous pages covering the complete 47,662-character original HTML and 15 exact model-input texts. The ordered input texts were byte-equal across the two model preparations, qualifying their text coverage only. That did not establish equal model behavior or comprehension.

Those repaired inputs recover local actors, permissions and some references. They still omit definitions and provisions governing duration and termination, the meaning of Services, and potentially Shares. The introductory governor and focal continuation also remain distributed across separate model inputs.

### The named dependencies still to resolve

The retained assessment identifies Sections 1 and 9 for duration and termination, Section 2 for Services, the Section 11 governor and its distinct permission exceptions, and the Section 12 to 10 to 3 reference chain. Section 5 on Shares is relevant only if the substantive Section 13 body is retained. A literal Section 13 caption alone is not a reason to attach that body.

The general otherwise-provided exception remains unclosed. It requires explicit dispositions from a complete original-source review; a phrase match or the presence of related text somewhere in a set of windows does not close it.

### Where we stopped

A new reader was prepared to review the original and normalized text and propose exact source spans. Its eight synthetic controls passed. At the stop instruction, only one of nine planned source pages had a separate reading acknowledgment. It did not produce a complete new exception inventory or a finished repair. The old 21-page review remains a separate scoped record. [E7], [E10]

The hold on this case remains. No context-adequacy, model-benefit or adoption claim follows from the preparations.

## What the encoding and review experiments achieved

### Reversible review compression made inspection more practical

Some native review responses were dominated by repeated metadata. Compact reversible presentations reduced two B examples by approximately 92 percent and two A examples by 93 to 96 percent while preserving reconstruction of their originals. This reduced delivery overhead. It did not independently create a reading, validate a meaning or improve a model. [E2]

### The 256 token constraint exposed another limit

The context investigation tried to fit source-faithful inputs within the experimental models’ small token windows. These were representation and tokenizer investigations. A token count says whether an input fits a configuration; it says nothing by itself about the usefulness of that input.

The whole-document search did not produce an accepted complete plan. Later diagnostics showed that terminal annotations did not explain the failure. A reverse-tail attempt fitted an 18-character suffix at 256 tokens, then measured the preceding single codepoint’s unchanged native encoding at 292 tokens on both tokenizers. [E8]

The 292-token result includes that point’s native representation. It does not mean an ordinary character intrinsically requires 292 tokens. It identifies a measured bottleneck under the tested encoding and configuration. It is not a lower-bound proof, an impossibility proof or a complete document partition.

### The cost of this line of investigation

The closed search ledger retains 40,886 planning calls and 246 recounts across its phases, with 51,988,112 output bytes carried forward. The elapsed resource charge includes conservative reservations and failed attempts; it must not be treated as a task-wide wall-clock or financial accounting. [E8]

This investigation explains why the current representation was difficult to fit. It did not answer which priors to choose. Further blind searches were not justified as a substitute for resolving the actual missing source dependencies.

### Small slice continuation was prepared but unused

B’s next 5,000-character slice exceeded the fixed 2 MiB canonical-response bound before being displayed. A fixed 2,500-character continuation passed 91 synthetic controls and source review and was installed with the same deadline and cumulative caps. No new source request was present when work stopped. [E5], [E6], [E10]

## The exact state of coding and review at the stop

The two independent codings of the same 500-section packet are unfinished. Their private meanings remain separate. There is no completed reconciliation or full 500-case source-quality pass. Counts of authored records, displayed pages and fully qualified cases are different measures. [E1], [E4], [E5], [E6], [E10]

| Workstream | Last retained position | Limit |
| --- | --- | --- |
| Coder A | 106 authored records across historical and scoped work. Latest batch completed cases 0107 and 0108. | This is not 106 fully qualified current-source cases. |
| A current case 0109 | Complete 33,402-character parent. Raw requests through [0,35000) fully acknowledged; one of two pages for [35000,42000) acknowledged. | Current case unfinished. One emitted page pending acknowledgment. |
| A latest batch | 85 reading acknowledgments from 86 prepared and emitted pages across 0107-0109. | Page counts are not additional completed codings. |
| Coder B case 0162 | 128 acknowledged compact pages cover parent [0,108000) of 141,481 characters. | 33,481 parent characters and original/raw context remain unread in this continuation. |
| B smaller slice phase | Installed, no requests or acknowledgments. | No completed new reading or final meaning. |
| Case 0055 fresh reader | One acknowledged page out of nine prepared source pages. | No completed new exception inventory or span proposal. |

The bracketed ranges are half-open UTF16 text offsets: [0,35000) includes positions from zero up to, but not including, 35000. A pending review page must not be counted as a fully read source slice.

Historical B labels for 161 codings and earlier large JSON observations remain in the records under their original limits. They are not silently upgraded to fully qualified current-source evidence.

All ten context holds remain open: 0045, 0047, 0055, 0085, 0086, 0092, 0094, 0147, 0149 and 0174. The fresh 100-case audit and its 29 contract identifiers remain protected; confirmation and temporal reserves remain unopened. The latest batch’s 0118 unavailable-source disposition is separate from those ten holds.

The work has stopped. Earlier deadlines are historical controls, not authority to continue after the owner’s instruction.

## The reusable work and its boundaries

| Retained output | How it can help | What it cannot establish |
| --- | --- | --- |
| Frozen census and selection | Reuse the same sampling frame and preserve the untouched partitions. | Completion of the selected corpus or unbiased human priorities. |
| Current calibration extraction | Reproduce section and unit provenance for the accepted tranche. | Correct interpretation of every extracted unit. |
| Source failure cases | Use concrete examples to design context requirements and regression fixtures. | A validated general automatic context method. |
| Reversible review tools | Inspect large native evidence without losing the reconstructable original. | Model comprehension or semantic equivalence. |
| Scoped A and B records | Continue a future reconciliation only from each record’s actual reading scope. | A completed clean pair of 500 codings. |
| Method and resource receipts | Distinguish versions, failures, costs and actual delivered pages. | A scientific finding merely because tests or guards pass. |

### Where the work lives

The prototype remains isolated under the public workspace’s priors-derivation/study-v0.2 directory. The current investigation is in experiments/current-v6-development0004-full-parent-v1. Raw data, normalized data, operational QA records and coder artifacts remain in the existing managed Linux container’s study root. The appendix provides exact base paths and key records.

### What was kept separate

The work was not promoted into accepted priors or the financial runtime. v0.1 remains a historical baseline. No participant study or external-source transfer phase was simulated. The independent coders’ private meanings were not opened by ROOT to write this handoff.

### A known visibility problem

The retained READMEs are long chronological records containing overlapping checkpoints. Older active wording does not override this stop report. The dashboard descriptions were updated during the work, but the generated HTML refresh was pending because the snapshot export guard rejected retained generated control logs. It must not be treated as a current completion view. [E1], [E2]

The report and preserved records are useful even if the larger study is not resumed. No container replacement, data cleanup or publication is part of this handoff.

## Why this took days

**I let a bounded prototype expand into a sustained infrastructure and validation effort without giving you a clear, decision-focused account often enough.** The resulting record is detailed, but the distinction between technical activity and progress toward first priors became hard to see.

### The work changed direction

Source audits found meaning-changing omissions. Instead of reaching candidate synthesis, the work repeatedly returned to extraction, context attachment, headings, native annotations, token windows and reading delivery. Each repair required a version-specific check because older results could not safely be treated as current.

Large metadata responses then created their own bottleneck. Review compression, pagination, exact-output delivery, separate acknowledgments and cumulative accounting grew into substantial workstreams. They protected the integrity of the record but consumed effort without producing the intended candidate set.

### Interruptions compounded the drift

Docker unavailability, repeated approval-review interruptions and model-capacity failures disrupted execution. Some interruptions required recovery of the last emitted or acknowledged page rather than a blind retry. The retained state shows real partial progress and real unfinished work. Those operational problems do not excuse the lack of a clear handoff sooner.

### The management failure

The investigation did not maintain a firm boundary between a repair needed to answer the research question and another technical improvement that could be pursued indefinitely. It lacked a simple escalation rule: when a representation problem survives a bounded attempt, report it as a limitation, hand over the evidence and let the owner decide whether it warrants more time.

I should have made the product consequence explicit earlier: we had learned that evidence context was unreliable in important cases, while the first-prior decision was still unanswered. That should have triggered a concise results document, not more days of operational detail.

### What can be said about the effort

The records contain phase-specific clocks, captures, source charges and diagnostic counters. They do not provide a reconciled project-wide cost statement or a reliable allocation of all elapsed days between activities. This report therefore does not invent a total compute bill or an exact explanation of every hour.

The result should be assessed by what it establishes and what it enables, rather than by the volume of logs, tests or computation.

## What we can decide from this work

### Conclusions supported by the retained evidence

The corpus and prototype are usable starting infrastructure. The context problem is substantive: definitions, permissions, duration, exceptions and references can be lost or disconnected. Reversible compression can improve review delivery. Small model-input windows constrain the tested representations. None of these findings establishes a validated first-prior vocabulary.

### Conclusions we cannot draw

We cannot claim that frequent clauses are participants’ priorities, that a cluster is a stable normative category, that restored words improve model judgments, or that an adequate automatic context strategy has been validated. We cannot claim completion of the 15,000-record study, the current 30,000-unit comparison, either full independent coding, candidate freeze, confirmation or temporal replication.

### Recommended use now

Use the completed work as an evidence and design handoff. Preserve the data, code and failure examples. Treat any vocabulary derived from a small human review as a provisional product hypothesis with explicit examples and counterexamples. Keep the broader corpus study separate from the decision to choose an initial vocabulary.

| Possible owner decision | What this report supports |
| --- | --- |
| Move ahead with a small human-led prototype | Use the documented context requirements and known failure cases; make no corpus-validation claim. |
| Defer priors research | Retain the frozen sample, current extraction and scoped readings without spending further compute. |
| Commission a later bounded study | Specify a concrete decision artifact, time limit and stop condition before any additional technical repair. |

These are handoff options, not new work being started. The current study remains stopped.

### Conditions for any later continuation

A future owner should first decide which scientific claims are worth funding. Any resumed task should publish a short plain-language checkpoint after a bounded batch, keep historical evidence separate from current qualification, and stop when a new infrastructure investigation would exceed the agreed deliverable.

The immediate outcome is this explanation and the retained work. No automatic continuation, additional source review or candidate adoption follows from it.

## Evidence and artifact locations

The references below distinguish readable authored summaries from retained operational evidence. The main narrative cites these identifiers. Long READMEs contain historical checkpoints; the owner’s stop instruction and the stop-state compilation govern the final status.

### Base locations

### T Host study source root

`C:/Work/Non-verba/open-source/code/disputes/prototypes/priors-derivation/study-v0.2`

The authored prototype code and study README are here.

### X Host current experiment root

`C:/Work/Non-verba/open-source/code/disputes/prototypes/priors-derivation/study-v0.2/experiments/current-v6-development0004-full-parent-v1`

The current investigation and its source-only proposals are here.

### R Retained study root in the managed Linux container

`/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000`

Raw and normalized data, processing manifests, QA receipts and coder namespaces remain here. No host toolchain or container migration is required by this handoff.

### Readable summaries and extraction

### E1 Study design and chronological findings

[Open retained file](<C:/Work/Non-verba/open-source/code/disputes/prototypes/priors-derivation/study-v0.2/README.md>)

Design at the beginning; historical V9 audit around line 434; outstanding study work around line 1615; case 0047 around line 2047; case 0055 around line 2570; current V6 calibration around line 2699. Line numbers are locators in the retained source, not immutable evidence.

### E2 Current full parent and context investigation

[Open retained file](<C:/Work/Non-verba/open-source/code/disputes/prototypes/priors-derivation/study-v0.2/experiments/current-v6-development0004-full-parent-v1/README.md>)

Case 0004, native review compression, tokenization diagnostics, current partial A/B work and limits.

### E3 Current extraction terminal manifest

`/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000/processing/82a3dab1396336ed/calibration-1000-cea0eeae0bf69647/extraction-manifest.json`

SHA-256: `7726139476a239ded60b75a25ec033d51569f53556020739ae28c86835ad7b13`

5,179,014 bytes. Current calibration extraction, not a completed 15,000-record study.

### E4 Earlier immutable ROOT checkpoint

`/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000/qa/current-v6-calibration-refresh-20261018-v1/ROOT-B-prospective-A2-codings-and-0055-adverse-capacity-v25.json`

SHA-256: `ae5e9dd30ef78ef4f4d0e07fed71b632a296bc29b22f4bcaf9ed439daa7b72bf`

13,268 bytes; recorded 19 October at 05:27:35 Dubai time (01:27:35 UTC). It predates the later B closure and final stop-state compilation.

### E5 B final closed prospective phase

`/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000/coding/open-coding-b/current-v6/prospective-completion-0162-v1/run-v1/B-prospective-final-partial-close-v1.json`

SHA-256: `299c4ec53756981fd03835b72ae3242991c2ad099bf29fd797479acca7be9a12`

5,886 bytes. Records 128 total compact acknowledgments, prefix through 108,000 and the un-emitted fac019 response-bound failure.

### E6 B smaller slice installation

`/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000/qa/b162-smaller-fixed-slices-ROOT-preparation-20261019-v1/ROOT-installed.json`

SHA-256: `4bbd1079648c46ed31263c8f90babff5fb2f2331a4a4130831a0d364207915cc`

3,523 bytes. Installed at 06:03:28 Dubai time (02:03:28 UTC) with the same active clock and cumulative limits. Installation is not execution. Three-phase anchor: SHA256 94a964dd5a624aebe3b0049ca9ba33bafe31c446ed781fe1fb33a8f171c8bac0, 77,499 bytes.

### E7 Earlier case 0055 source assessment

`/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000/qa/current-v6-0055-automatic-context-source-review-20261019-v1`

SHA-256: `e54e15afdaeeda89d3b409017faa8fb94d309f581f5769afde771577c0303819`

7,905 bytes. The producing command exited 1 after writing; a later exact hash readback verified the retained artifact. No successful writer-process or fsync claim is inferred. This folder holds the source assessment identified by the digest above. The fresh reader’s separate admission is in R/qa/current-v6-0055-operative-context-source-review-v2/admission.json, SHA256 4bfbca8de26fd59f187e3095d1baef8d468459e326db27e22bbddf929d3e115a, 4,756 bytes.

### E8 Closed adverse reverse tail result

`/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000/qa/current-v6-0055-reverse-native-tail-partition-20261019-v2/ROOT-CLOSED-and-readback.json`

SHA-256: `0285178e89a2511b5c4dcb033ac4b7ec4c20aac27be8a316c3cf75fbc7660011`

5,509 bytes. A partial suffix and a measured 292-token point encoding; no complete partition or impossibility proof. The separate terminal diagnostic is described in E2 and remains closed.

### E9 Current frozen source identity

`/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000/qa/current-v6-calibration-refresh-20261018-v1/source-epoch.json`

SHA-256: `1b33359ad35f7e14a1326d7de7748001f204e309bf6f54ddbec2a43178aadc16`

6,798 bytes. Method identity 82a3dab1396336edccf77f27a7800cccddff67ca928e919e824a663e1d563601. The pinned snapshot has 23 method-source files; this identity must not be silently assigned to later concurrent workspace edits.

### E10 Stop state compilation

[Open retained file](<C:/Work/Non-verba/open-source/code/disputes/prototypes/priors-derivation/study-v0.2/handoff/2026-10-19/_work/stop-state.json>)

Compiled from retained manifests, completion filenames and source-reading session metadata. No source-page payload, private coding meaning, study helper or model was opened to compile the final stop position. A’s case requests are nested under cases, not the top-level requests directory.

### How to read the status evidence

A reader’s acknowledgment records its declaration that a complete page was observed. A machine-generated coverage result can check sequence and hashes but cannot replace that declaration. Neither is an independent correctness judgment.

Some operational outputs intentionally contain private coder meanings or contract evidence. This report names the recoverable locations and summarizes scoped findings without reproducing those bodies. No publication or promotion of those records is implied.

All quantities in this handoff are tied to their stated denominator and method version. Historical vector runs, current source tests and pending scientific evaluations must remain separate.

## Terms used in this report

| Term | Meaning here |
| --- | --- |
| Prior | A proposed starting concept or priority for Non-verba. The project had not yet chosen its first validated v0.2 set. |
| Focal unit | The smaller text span selected for analysis. |
| Parent | The stored section used as context around the focal unit. It may omit definitions and exceptions elsewhere in the agreement. |
| Normalized text | Text extracted into the study’s standard representation, with a recorded relationship to the source. |
| Native representation | Source evidence and annotations retained for fidelity. Repeated annotations can make a short textual slice very large. |
| Token window | The bounded input length supported by a tested model configuration. Fit does not demonstrate comprehension. |
| Embedding and geometry | Numerical representations of text and analyses of their similarity or arrangement. They can expose patterns without establishing participant priorities. |
| ACK | An agent’s separate declaration that it observed and read a specific complete delivered page. |
| Hash and source epoch | Identifiers tying particular bytes and method files to a retained result. They establish provenance, not semantic correctness. |
| Hold | An unresolved issue that prevents a stronger adequacy or adoption claim. |
| Fresh and reserved sets | Material protected from development work so later evaluation can remain meaningfully separate. |
| PROTOTYPE and unadopted | A research result or tool kept separate from accepted priors and production decisions. |

Prepared by Codex for the Non-verba project owner on 19 October 2026. Study activity was stopped at the owner’s instruction. This report is the handoff, not authorization to continue the study.

[E1]: #e1-study-design-and-chronological-findings
[E2]: #e2-current-full-parent-and-context-investigation
[E3]: #e3-current-extraction-terminal-manifest
[E4]: #e4-earlier-immutable-root-checkpoint
[E5]: #e5-b-final-closed-prospective-phase
[E6]: #e6-b-smaller-slice-installation
[E7]: #e7-earlier-case-0055-source-assessment
[E8]: #e8-closed-adverse-reverse-tail-result
[E9]: #e9-current-frozen-source-identity
[E10]: #e10-stop-state-compilation

