# Native context search V3 — PROTOTYPE

Experimental candidate; **not adopted**. Its actual tokenizer trial ended in a
bounded HOLD with zero accepted windows; whole-node feasibility remains unknown. Formal
`lib/embedding.mjs`, frozen snapshots, model assets, and the V2 experiment are
unchanged by this folder. The controls use authored literals and fictional costs.

This keeps V6's successful WORD/CJK fast paths, exact native encoder, counter
sequence, work fields, and every existing planner limit. If both fast paths fail,
the replacement whole-source search first tries previously successful **exact
UTF16 ranges**, then nearby Unicode endpoints suggested by up to eight recent
successful codepoint spans and their geometric size neighbours. A shifted start
always requires a fresh encoding and count. A hint's failure removes no other
candidate and establishes no monotonicity.

The fallback still traverses the complete reachable Unicode DAG with backtracking
and dead-suffix detection. Each frame eventually enumerates every endpoint not
already tried by its priority list. It can report infeasibility only after that
exhaustive search finishes and no edge remained unmeasured because of an encoding
bound. Any resource bound means feasibility is unknown. No partial path is
returned. A chosen path tiles the complete source without overlap, receives
positive exact source-codepoint weights, and is fully re-encoded and recounted
before return. Discarded fast windows and all probes remain in spent work.

The cache contains only successful numeric `(start,end)` geometry, bounded by the
unchanged encode-probe limit. It holds no source strings, encoded strings, or
per-shift token estimates. Unicode offsets are linear in the existing source cap;
priority lists contain at most their exact cached edges plus a bounded number of
nearby/geometric hints. The final descending iterator stores no candidate matrix.
The long synthetic control creates costs lazily, rather than pre-encoding every
substring. The tiny native-mark fixture deliberately has fewer than 11 codepoints.

`nativeContextSearchWindowsV3` calls the existing branded
`nativeRepresentationWindow` encoder for every actual measurement.
`planNativeContextNodeSearchV3` is a callback bridge for separately declared nodes;
it does not authenticate source, declaration, counter provenance, or reader
authority. A V2-style caller must perform those checks and bind this distinct
policy and source before using it. Existing V2 artifacts/verifiers do not accept
the new fallback segmentation. The separate adapter described below binds that
new identity. This folder does not perform inference, qualify context adequacy
or clear a hold. The actual trial below reports bounded tokenizer work only.

All ten source-free controls passed in managed Debian on 18 October 2026
(native exit zero, tool `9370fb`). The retained result is
`qa/native-context-search-v3-source-free-controls-20261018-v1/result.json`,
SHA256 `fab9bed35177ae17d211a8b8f85dfb7455b57b0344b657624c1db808bea49894`
(1,285 bytes). Runtime copies changed only relative library imports to exact
frozen V6 file URLs, with reverse checks; the formal snapshot was unchanged.
These checks used fictional costs and no actual tokenizer, model or contract.

`node-adapter.mjs` is a minimal separate fork of the pinned V2 declared-node
bridge. It retains complete context/declaration validation, the exact native-view
encoder, subset binding, retained failures, work accounting, and independent
range readback. It calls the V3 planner and uses distinct policy/schema identities.
It accepts the unchanged successful fast-path segmentations and the new V3
fallback segmentation; it rejects the old exhaustive fallback segmentation.
The six `node-adapter.test.mjs` groups subsequently passed in managed Debian
(`53537a`), alongside the ten planner controls recorded above. These controls
used fictional costs and no actual tokenizer, model or contract input.

`trial-runner.mjs` and `trial-proposal.json` preserve the original source-only
proposal for one tokenizer-only retry of case 0055's already exposed
`available_normalized_document` node from the frozen 194 input lineage, under the
separate V3 search identity. They do not run either historical production focal
reference or case 0047, and make no current formal V6 window claim. The genuine
focal remains in the fully validated declaration and is not planned.

That proposal bound the then-closed carry: 30,900 planning calls, 128 independent
recounts, 353,627.283871 active ms, and 1,240,338 output bytes. The original caps
remain 40,000 / 20,000 / 600,000 ms / 67,108,864 bytes. At most 8,192 additional
planning calls, 8,192 independent recounts and 200,000 active ms are proposed.
All copies, loading, planning, recounting and final accounting share one clock;
all prior failures remain charged. Trial source copies and directories must fit
128 KiB, inside the 8 MiB complete new QA-tree cap. An additional 2 MiB reservation
covers outside-tree captures and control receipts; all bytes use the original
output allowance. Unknown work is charged at its full remaining reservation.

Activation required ROOT source review, the six adapter controls, verification
of the three specified import rewrites and copied source pins, and a separate
actual admission. Source authoring itself granted no runtime authority or carry
reset. The following outcome records the separately admitted attempts.

## Executed bounded trial — 18 October 2026

The first actual runner (`802c61`) omitted the declared task policy from its task state and ended HELD before any real counter call. Its files and failed work
remain preserved. The minimal successor uses distinct `trial-runner-v2.mjs`
and `trial-proposal-v2.json` sources, reviewed before actual execution.

The v2 attempt (`c1062f` to `c70db5`) ended **HELD / SEARCH_EDGES at 8,192**.
It spent **7,899 planning calls and zero independent recounts**. Thirty-three
fast windows were completed before fallback but discarded; the terminal result
has **zero accepted windows** and accepts no partial path. A resource bound
leaves whole-node feasibility unknown.

These are frozen194 inputs under the separate, unadopted V3 search identity.
They are **never a qualification of formal V6 windows**. The original phase
carry is now **38,799 planning calls, 128 recounts, 385,387.035676 active ms and
5,850,768 output/reserved bytes**. The original 40,000 planning / 20,000 recount /
600,000 ms / 67,108,864-byte caps remain absolute; **1,201 planning credits
remain**. Failed and unobserved reservations are not refunded or reset.

All ten context/materiality holds and the source-quality gate remain open.
Fresh100 source material remains unread. The trial performs no inference,
pooling, semantic-adequacy qualification, first-prior decision or adoption.
