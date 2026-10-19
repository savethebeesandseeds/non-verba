# Boundary activation probe — PROTOTYPE / UNADOPTED

This diagnostic copy measures existing V2 decisions. It introduces no boundary
heuristic and changes no frozen V1/V2, current874, actual reader or selection.
The retained V1 and V2 actual replays both reported zero closures/geometry changes
for fixed0055 and0047. Their normalized/native preservation is separate evidence
from boundary improvement. Neither result establishes the reason for inactivity.

The V2 fixtures style the terminal title punctuation. Code inspection identifies
an uncovered shape: `N. <b><u>Title</u></b>. body`. The literal-tag sidecar stops
before the unstyled period; the existing inline-title grammar includes it. Exact
title equality therefore rejects that synthetic shape. This is a refutable
coverage finding, not a diagnosis of either actual document or a rule proposal.

`sections.prototype.mjs` copies frozen V2. Ordinary `extractSections(record,
options)` has the same result contract. `probeExtractSections(record,options)`
returns `{extraction,probe}` using a private recorder passed only through that
call. The extraction contains no probe field; the V2 boundary policy, warnings,
closures, geometry, literal normalization and native origin behavior remain
unchanged. Diagnostic method identity must be distinct in an actual replay.

`probe.mjs` has no IO or permit authority. It exports `createBoundaryProbe()`,
`verifyBoundaryProbe(probe)` and `projectBoundaryProbe(probe)`. The full result is
`{schema_version:1,event_count,counters,caption_records,truncated:false,sha256}`.
Counters use numeric `stage:reason_mask` keys. Every record value is a bounded
integer, boolean, null or 64-hex SHA. There are no source words, labels, URLs or
paths. The seal is SHA256 of compact JSON excluding `sha256`. Complete canonical
two-space JSON plus newline is limited to262144 bytes and1024 records. Overflow throws sticky
`PROBE_BOUND`; no successful result truncates evidence. Record limits may fail
before that physical bound because reservation is conservative.

Stages and reason-mask bits:

| Stage | Meaning | Bits (zero means admitted/matched) |
|---|---|---|
|1|Literal-caption annotation|1 no literal evidence;2 multiple/no emitted block;4 exact title mismatch;8 missing prefix;16 typed prefix;32 non-top-level integer;64 heading grammar;128 navigation kind;256 navigation literal mismatch|
|2|Existing peer-caption eligibility|1 heading kind;2 missing prefix;4 typed;8 non-integer;16 sourceLI;32 list depth;64 quote;128 continuation;256 sentence continuation;512 delimiter;1024 table;2048 no private caption;4096 private literal mismatch;8192 private number mismatch;16384 old navigation evidence missing|
|3|Ordinary introduced-frame creation|1 non-letter scheme;2 no explicit letter/roman first marker;4 no admitted governing number|
|4|Existing next-peer decision|1 no frame;2 dependency frame;4 non-letter scheme;8 no explicit item marker;16 missing governing number;32 candidate not admitted;64 not next integer;128 existing strong boundary bypassed peer test|

Stage2 counts function invocations, which may revisit a caption while creating or
updating a frame. Stage4 counts decisions, including aggregate body decisions.
They are not unique-heading counts. Caption records retain ordinal, stage, mask,
source-block SHA and UTF16 length. Stage1 adds literal/title hashes and lengths,
their common-prefix length, and at most the following title code point. A46 with
an exact-prefix relationship and a one-character length difference distinguishes
the hypothesized external period without emitting text. `raw_start/end` are the
parse5 source element range, or null; they include markup and are not invented
raw caption spans. Input-block indexes at stage1 and post-split block indexes at
later stages are distinct coordinate spaces. No normalized offsets are guessed.

The compact projection is limited to65536 canonical bytes and contains schema version, full probe SHA/bytes, event count,
counters, caption-record count and caption-record SHA. Its validator establishes
shape/seal/bounds, not provenance or actual branch truth. ROOT must pin this copy,
authenticate fixed-case custody and full fresh100/29 exclusion, and independently
compare its full extraction against frozen V2. Only collector identity/native
seal may differ; geometry, normalized literals, source origin and unknown evidence
must be equal. Full probes belong in retained artifacts; visible outcomes should
carry only the compact numeric/hash projection. Failed preservation, overflow or
unexplained inactivity remains a failure or unresolved observation.

The focused SOURCE_FREE controls exercise real collectors, internal/external
punctuation, missing governing-caption admission, list/quote/table and wrong-peer
gates, CSS/partial-body rejection, unchanged full output/native evidence, bounded
failure and forged-ledger rejection. Run from the official source snapshot root:

```sh
/opt/nonverba-tools/node/bin/node --test code/disputes/prototypes/priors-derivation/study-v0.2/experiments/literal-emphasis-parent-v1/boundary-activation-probe-v1/probe.test.mjs
```

No source review, model/tokenizer access, semantic closure, focal packing repair,
quality gate, coding authority or first-prior decision is granted by this probe.
