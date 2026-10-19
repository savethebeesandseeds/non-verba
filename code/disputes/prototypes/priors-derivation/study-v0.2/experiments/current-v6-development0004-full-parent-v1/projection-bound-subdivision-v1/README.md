# Inactive exact-0106 projection-bound diagnostic

This source-only recipe is not a reading phase and has no enabled CLI. No actual
packet, normalized/cache/raw/native input or reader call was used to author or
test it. A separate exact ROOT admission is required before `runDiagnostic` may
be called. All existing expired phases, clocks, permanent locks, records and
charges remain closed and unchanged.

The only prospective interval is coding-0106 parent-relative `[28000,29000)`
(absolute normalized `[28054,29054)`), within the 46,415-character parent
`[54,46469)`. The original failed 1,000-character call is retained as the pinned
prior checkpoint, without replay or refund. The first candidates are its two
codepoint-safe halves. A failed candidate is split deterministically, left
before right. At most **32 new attempts**, including bound failures, are allowed.
The union of accepted, unresolved and unattempted leaves must remain exactly the
original interval, with no gap, overlap or skipped offset.

A leaf with no interior codepoint boundary can still exceed the native bound.
Its classification says only that the tested leaf could not fit; it does not
attribute that failure to an indivisible joint group. Budget, clock, interruption
or non-projection errors preserve a permanent new diagnostic HOLD and all prior
attempts. There is no retry, lock removal on failure, native:none probe, plain
fallback, cap increase or projection implementation change.

Every candidate calls the exact frozen source82 `readAuditSource` with
`source:'parent', showProposedHeading:false, nativeDecorations:'all'`. Its internal
caps remain `maxRuns:512,maxCharacters:20000,maxOrigins:4096`. Full successful
responses are retained unchanged, with hashes, after exact identity/range/text
inverse checks. An encoded response above 2 MiB is a separate capture HOLD; it
is never accepted as a partial projection or retried with weakened inputs.
All candidates end before the parent end, so the frozen reader's
`includeEndZeroWidth:end===row.parent.end` is false. At subdivision boundaries,
zero-width ownership remains the frozen reader's half-open rule; joint witnesses
and every returned native qualifier are retained in the complete response.

Before payload I/O, the future ROOT admission and guard must authenticate the
exact source82 method, pinned packet and case lineage, unchanged registry receipt
and native observation, the complete issue/resolution reference set and exact
current registry rosters. The guard must carry all 29 distinct Fresh100 contract
IDs and the complete 100-section scope. All 500 ordered packet rows are checked
against that set; a check of coding-0106 alone is insufficient. No Fresh payload
or other coder material is read. The full source dependency identity remains a
ROOT pre-admission attestation: ROOT must independently verify the exact current
source epoch's 23 method files and its case-lineage/registry join before payload
access. Reader and projector bytes are also checked directly. Full Fresh metadata
is validated in guard() before packet I/O; packet-wide CID exclusion remains after
the bound packet read. Each meter has its own prospective reservation; candidate
capture reserves both the nonrefundable charge and retained response bytes.

Only after those checks may a named normalized witness be read. Its exact SHA
`4888fbb6c46d880bc7b306dc1a5fa7d35674b1b3df5e33b5bf9a2d307acd5186`
and 46,725 bytes must join the coding-0106 packet lineage and whole parent hash.
It supplies codepoint boundaries and the exact leaf-text inverse only. No plain
text is emitted or treated as an alternative native reading.

The future admission must supply exact `normalized_ref`, `raw_ref`, `cache_ref`
and a pinned metadata-only `guard_ref`. The cache must bind the compressed native
sidecar reference; no inline/unknown storage is silently substituted. The driver
charges every named read before it occurs. The compressed cache is loaded only
with the exact frozen store.readJSON, after its encoded lineage and pinned
760-byte manifest are checked. That manifest binds 665,576 decoded bytes, their
SHA and complete canonical JSON result digest; no new gzip parser is added.
Setup charges the separate manifest and encoded checks, then readJSON's manifest,
encoded and decoded inputs. Each reader attempt charges packet x1, normalized x1,
encoded cache x2, cache manifest x1, decoded cache x1, raw x1, compressed native x1
and decoded native bytes x1, plus a nonrefundable 2 MiB response reservation. Guard and setup
reads are also charged. Directory entries and all new files count as artifacts.
Charges are retained on failure; a 32-attempt ceiling does not imply 32 will fit.

The proposed separately prospective diagnostic clock is at most 15 minutes, with
a 60-second reserve before operations and the managed 60-second process watchdog,
512 MiB heap and 1 GiB RSS. Suggested new-phase maximums in code are 1 MiB visible,
256 MiB capture and 128 MiB artifacts. ROOT must explicitly admit its selected
new-phase limits and engineering costs; these are not extensions or resets of
the expired reading phase. The carried counters have floors visible 4,144,325 B,
capture 19,321,916 B, artifacts 27,919,155 B and source-copy floor 262,144 B.
Output is one new exclusive diagnostic namespace. Returned/stdout information is
metadata only; actual reading, semantic completion and adoption remain false.

Source-only validation: run `controls.test.mjs` in the existing managed container,
plus the existing frozen `tests/source-decoration.test.mjs` synthetic codepoint,
projection-bound, joint-whitespace and terminal-zero controls. New engineering
source copies, including directory entries, must total at most 65,536 bytes.
No actual diagnostic is run by these tests. A control receipt proves synthetic
behavior only and cannot prove this actual interval will fit.

Before admission ROOT must review the quiet exact sources, supply the complete
guard/input pins and source-copy measurement, choose explicit engineering/capture
charges and issue a new diagnostic-only monotonic clock. Existing D/O helpers and
their failed locks are never invoked or changed by this recipe.
