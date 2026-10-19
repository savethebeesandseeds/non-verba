# Reverse Native Tail Partition — PROTOTYPE / UNADOPTED

Pure source-only hypothesis. No actual source/counter/model/allocation is opened.
Old forward/geometric/terminal diagnostic pools remain closed; no budget is reset
or refunded and all ten materiality holds remain unresolved.

`proposeReverseNativeTail({text,encode,countTokens,encoder_identity_sha256,
tokenizer_identity_sha256,limits?})` operates on one well-formed nonempty source
node of at most1000UTF16. `encode({start,end,includeEndZeroWidth})` must return
`{text,source,original_native_sha256}` using the unchanged external native codec;
source must exactly equal the indicated slice. The caller owns native inversion,
current source/authenticity, pinned tokenizers/special-token inclusion and any
future admitted cumulative meter. This pure API authenticates none of them.

At each remaining tail, try the whole prefix ending there. If it fails, binary
probe suffix lengths as a heuristic, accepting only observed <=256 token ranges.
If none fits, explicitly measure one codepoint; failure holds without claiming
that no possible range fits. Every chosen range is freshly encoded/counted again
and must match its original measured identity/count. The next iteration ends at
that range's start. Success returns ascending, adjacent, disjoint exact full
coverage. Attempts retain suffix-first order. The original node terminal belongs
only to the last range; other seams are half-open. No labels/headings are added.

Finite per-model ceilings:4096 encoder attempts AND4096 tokenizer attempts,
512 windows,262144 encoded UTF16 per call,2MiB serialized result. Optional limits
can only reduce probe/window/output ceilings. Failed callbacks are counted before
execution; holds retain charged counters and partial windows without adopting a
whole candidate. A repeated pure call is not permission to retry/reset a pool.

`recountReverseNativeTail(sameInputs,completeProposal)` is a separate future
caller operation: fresh unchanged encoding+count for every final window, no
search. It verifies source/encoder/tokenizer identities and proposal hash, ranges,
native/encoding hashes and count equality. Its counters are distinct from planning.
Independence is an external execution/provenance requirement, not established by
calling this function in the same process. Any change holds. No partial proposal
is eligible. The module retains hashes/ranges/counts, not source/encoded strings.

No monotonic token cost, maximal/minimum capacity, universal feasibility,
per-input qualifier binding, source adequacy, reading, model inference, pooling,
quality clearance or adoption is claimed. Any actual finite tail diagnostic needs
separate ROOT-reviewed source/native/model guards and a new explicit allocation.
