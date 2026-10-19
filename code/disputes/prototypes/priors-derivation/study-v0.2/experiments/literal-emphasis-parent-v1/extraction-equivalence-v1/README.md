# Fixed extraction cache equivalence — PROTOTYPE / UNADOPTED

## Executed checkpoint — 18 October 2026

The ten SOURCE_FREE controls passed with native exit 0 (tool chunk `81120f`;
208.7376 ms). The separately admitted actual comparison then completed all 994
cache pairs with **native exit 0** (tool chunk `aa208e`) in 164,512 ms. Its result
is `qa/old874-new194-cache-equivalence-v1/comparison/result.json`, SHA-256
`f958fb7adc899d0d0344a3c4e7f3d0fd3b362e8738a1b22366d24df1f560492a`,
3,306 B. The metadata-only ledger is `contract-metadata.json` in that directory,
SHA-256 `8661bedd1df68187f0b27f622aa10af5d893a014f9a5848d19e1e5409085188b`,
615,110 B. Paths are relative to the existing `20261013-study-15000` run.

All non-masked decoded-cache fields matched deeply; the six allowed changes were
validated and derived. Native gzip hashes/lengths matched, cache serialization
lengths matched and source-defined gzip re-encoding matched both receipts.
Remaining cache/native/receipt input reads were 701,350,020 B; total measured
physical reads within the explicitly reported scope were 837,220,547 B. Decoded
cache payloads and recompression inputs were each 1,955,741,174 B of memory/CPU
work, separately recorded rather than charged as file IO. Native envelopes were
not decompressed by this comparison.

This confirms mechanical preservation within the stated scope. It does not
establish source quality, new actual reading, fresh-review qualification, issue
clearance, persisted normalized-file/Parquet equality or model readiness. The
earlier extraction retains `HELD RUNNER_RSS_UNKNOWN`; Q25's whole combined
resource-budget pass remains withdrawn. The closed reading records and manually
declared annotations retain their original limitations.

`compare.mjs` compares the exact old874 and new194 calibration caches after a
separate ROOT admission. It does not extract, repair, read source for a person,
call a model/tokenizer, qualify fresh reading or clear a quality/materiality hold.
No actual comparison or test execution follows from authoring these files.

The decoded-cache mask contains exactly six JSON pointers, exported as
`CACHE_MASK`: the three pinned source-file SHA fields (embedding/workflow/store),
the complete source identity seal, the exact relocated native artifact path,
and the recomputed native reference seal. The ordered 23-file source identity,
remaining 20 hashes, all parameters and runtime must otherwise match. Both source
seals are checked against the fixed old874/new194 identities. No collector or
tracer identity exception is allowed.

All other cache content is compared with deep strict equality, including the
entire normalized literal, full stored parents, nested and top-level units,
navigation, contexts, governor frames, exclusions, warnings and rejected records.
Only 64-character hexadecimal hashes and 16-character ASCII namespace prefixes
change, so the expected source/reference/whole-cache serialization length delta
is exactly zero. This is checked, not assumed or masked. B3 `store.readJSON`
verifies each exact receipt, gzip encoding hash/bytes, bounded decoded output,
strict UTF-8, complete pretty-JSON-plus-LF serialization and canonical result
digest. The comparator additionally reproduces the writer's gzip level 6 for
both cache values and verifies the actual encoded hash and byte length.

Native reference seals are recomputed. Their complete bodies must otherwise
match, including compressed and uncompressed hashes/lengths and envelope seals.
Both named native gzip files are hashed through 64 KiB reads with before/after
single-FD and path identity checks. No native decompression is needed to prove
their byte preservation; this does not independently rebuild raw-origin evidence.

The manifest comparison fixes all header/input/population fields, ordered 994
cache/contract IDs, 937 accepted, 57 rejected and six missing members of the
terminal 1,000 prefix. Old accounting must be absent; new accounting must equal
the frozen method epoch and B3's exact approved accounting provenance. Accepted
normalized paths may change only their fixed namespace. Persisted normalized
files and Parquet shard contents are explicitly outside this comparison: their
absence from the claim must remain visible in any later report. Recomputing model
windows or vectors is also outside scope.

## Future fixed CLI and required policy

```text
node --max-old-space-size=1024 --disable-proto=throw --experimental-vm-modules \
  compare.mjs POLICY_PATH POLICY_SHA256 POLICY_BYTES
```

The CLI policy is an external ROOT authority, not a generated default. It requires
exactly these keys:

```text
schema: fixed-994-extraction-equivalence-policy-v1
status: ADMITTED_FIXED_994_CACHE_EQUIVALENCE
RUN: exact existing 20261013-study-15000 root
QA_root: RUN/qa/old874-new194-cache-equivalence-v1
old_manifest_ref: exact old 676e548d… / 5,178,351 B reference
new_manifest_ref: exact new 8f1fc4f8… / 5,179,014 B reference
source_epoch_ref: exact 3729deec… / 6,380 B method epoch reference
clock_ref: REQUIRED_UNRESOLVED_ROOT_REFERENCE_TO_QA_root/clock.json
runtime_node_ref: REQUIRED_UNRESOLVED_ROOT_NODE_BINARY_REFERENCE
limits: {phase_ms, heap_bytes, rss_bytes, QA_bytes, read_bytes}
external_aggregate_RSS_supervision_required: false
input_extraction_supervision_status: HELD_RUNNER_RSS_UNKNOWN
```

The new extraction produced complete outputs with child native exit zero, while
its parent retained `HELD RUNNER_RSS_UNKNOWN` at exit handoff. This comparator's
fresh admission explicitly acknowledges that status. A successful content check
would not convert the earlier extraction into a supervisor/resource pass.

Every reference is `{path,sha256,bytes}`. The clock is separately supplied as
`{schema:"fixed-994-extraction-equivalence-clock-v1",origin_ns:"…"}` using the
same host/container monotonic clock; it is never reset. Policy limits may only
lower 1,200,000 ms, 3 GiB child RSS, 4 MiB QA or 4 GiB conservative read bytes.
`heap_bytes` is fixed to 1 GiB: Node uses 1,024 MiB old space, and sampled
`heapUsed` must stay at most 1 GiB; the runtime's total V8 heap limit is checked
separately with its normal young-space allowance. This runner and the only B3
store/common functions invoked create no child processes. ROOT may launch the
Node process directly and independently monitor its native invocation. All memory
and deadline checks here are sampled at chunk/record boundaries, not continuous
resource guarantees. Self-sampling does not attest to external supervision.
No network/OS sandbox or unenumerated dependency-graph guarantee is claimed.

The QA parent may initially contain only ROOT-owned regular metadata files,
which are charged. A new exclusive `comparison/` child retains progress every
100 completed records, a metadata-only contract ledger, and the final result or
compact HELD partial count. Existing outputs are never overwritten. ROOT must
also charge its own external invocation/capture records. Failures print only
fixed error codes/phase/counts, never exception messages or contract literals.
Completion requires the result reference, native exit zero and ROOT's external
resource/custody checks; a held invocation cannot become success through an
earlier result file. Terminal evidence reserves 32 KiB within the same QA cap.

Before the first corpus access, the pinned epoch is checked, its ordered 23 B3
source files are rehashed, and only B3 store/common are imported. The recipe,
package manifests and model directories are identity metadata, never model input.
The two manifests alone supply the exact 994+994 cache and native file allowlists;
there is no corpus traversal or raw/component/page reader access. Every cache
and stream yields so the parent can monitor independently. Synchronous deep
equality/serialization is bracketed by sticky deadline/memory checks.

File-read budget charges and verified physical file reads are distinct from
decoded gzip payload bytes and recompression input bytes. B3's bounded readers
receive two conservatively charged sentinel bytes per cache+sidecar call; those
unused sentinels remain charged. Failed calls cannot assert a complete actual IO
count. Gzip output/input is memory/CPU work, never silently added to file IO.
The reported physical scope is explicit guarded data reads and successful B3
cache reads; Node's automatic source-module loading and filesystem block IO are
not measured. Before any cache is opened, exact pinned manifest receipt lengths,
encoded sizes and native sizes forecast all remaining scoped reads. Completion
joins that forecast to the observed totals. Authorized metadata alone forecasts
836,543,970 B including the two manifests, Node binary, epoch/accounting metadata
and both populations' cache/native/receipt reads, plus the 23 source files and
policy/clock; 3,976 reader-sentinel bytes remain additionally budget charged.
The 4 GiB read ceiling is a cap, not a claim that an actual comparison passed.

`compare.test.mjs` has ten authored SOURCE_FREE groups using fictional JSON and
native references. It tests strict source pins/order, content and native changes,
serialization/encoded lengths, accounting/population, exact relocation and cap/
terminal-reserve boundaries. It
does not open a corpus or attest to actual delivery, resources or source quality.
