# Direct comparisons and final-window commitment — PROTOTYPE / UNADOPTED

`stableCoreDifferences(old, fresh)` and `stableSelectionDifferences(old, fresh)`
return the old adapter's same ordered difference paths, capped at128. They compare
trusted acyclic plain JSON trees already owned by the caller: finite JSON
primitives, ordinary/null-prototype objects and dense arrays without accessors,
symbols, named array properties, maps, functions or proxies. Core roots contain
plain section/unit records and optional arrays; selection roots contain a
`selected` array of plain records. These helpers do not validate or admit arbitrary
JavaScript values. They perform no IO, canonical hashing, mutation or cloning.

Core exclusions exactly match the old clone/delete transform: root `source`,
`raw_sha256`, `native_source_decorations`; `parameters.native_decoration_policy`;
the native reference on root section/unit rows and their immediate nested unit
rows. Selection excludes only the native reference on immediate `selected` rows.
All other fields, unknown fields, ordering, missing keys and primitive equality
remain compared. The exclusion decision precedes either value read, so excluded
native envelopes are neither traversed nor cloned. No stored evidence is removed,
and no decoded-byte ledger or other cap changes. Getter non-evaluation is a narrow
additional check, not a claim of general support for accessor-bearing input.

`prepareTypedWindows(input, counter, budgetOptions = {}, context = {})` is an
isolated successor of the experiment-root planner. Budget options retain the old
strict schema and ceilings. Optional context is exactly `{streamID,onFinalWindow}`;
the callback is caller-owned, synchronous, and must return undefined or true.
This defines no actual tokenizer connection or admission capability.

The no-hook path retains the old planner's counting, segmentation, fallback,
coverage and output behavior. Hook mode first completes the same provisional
word/codepoint plan and complete literal/zero checks. It then freshly recounts
each chosen complete encoded string and synchronously calls `onFinalWindow`
before any next count. This is necessary because an earlier provisional word
window can be abandoned when a later word forces codepoint fallback. Provisional
counts never commit windows. Extra final recounts consume the same20k per-stream
and caller-enforced60k global call budgets, with no added allowance.

Each immutable event contains stream_id, input_sha256, tokens,
tokenizer_policy_sha256, window_index, source_range and include_end_zero_width.
The SHA is computed before that final count; the event uses its exact returned
tokens. Counter/commit rejection fails the whole stream with retained work and
partial_stream_accepted:false. Earlier successful commit counters remain spent
resource facts, never an accepted partial stream or permission to retry.
Hook work distinguishes planned_windows, final_window_recounts and
final_window_commits; completed_windows then counts successful diagnostic bindings.
Failed final calls remain charged, and a bounded own-data error code may be
retained as cause_code. No partial window list is returned on failure.
No source text is cut, no zero event dropped and no inferred source/pooling or
quality claim is added. Synthetic controls are source-free in-memory evidence;
full owned fictional A/B, external accounting and actual bridges remain separate.
