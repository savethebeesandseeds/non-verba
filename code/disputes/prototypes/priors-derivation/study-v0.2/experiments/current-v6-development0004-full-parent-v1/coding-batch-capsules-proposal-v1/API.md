# Ordered 20 case capsules — PROTOTYPE / UNADOPTED

Source-only, reviewer-neutral metadata policy. No actual packet, source, model,
private reading or runtime admission is included. The purpose is to replace a
hardcoded single-case cursor without adding source IO to cached actions.

`policy.mjs` imports only Node crypto/path. `cached-adapter.mjs` imports that
policy and the byte-identical frozen generic `cached-guard.mjs`.
`fixture.mjs` and `example.mjs` are declared fictional controls/examples only.
Call `syntheticExample()` for one valid complete roster/allocation/basis and
first capsule/request/permit/page example. It performs no IO or clock calls.

## Exact interface

`createBatchCursor({...args, packet, guard})` validates a full externally
authenticated identity projection of all 500 ordered packet rows and full
Fresh100/29 guard. `restoreBatchCursor(args)` takes ONLY hash-pinned roster,
allocation and basis JSON strings/refs; supplying packet/guard keys rejects.
`args` is `{roster_document,roster_ref,admission_document,admission_ref,
basis_document,basis_ref}`. Every ref is `{path,sha256,bytes}` with absolute
canonical POSIX path and exact serialized UTF8-byte hash. The pure helper does
not read those paths or authenticate the external issuer.

The acyclic issue order is: roster with 20 case bindings; external basis receipt
binding its ref; 20 capsules binding roster+basis; allocation binding those 20
capsule refs and any exact ROOT disposition receipts. The fictional factory
shows all schema fields. No numeric actual allocation or real clock is issued.

Roster cases are exactly 20 contiguous packet-order audit IDs. Every case starts
at parent offset zero; no historical 102/161/77 reading qualification transfers.
Each binding has audit_id, source_id, contract_id, availability and exact four
field parent `{id,start,end,sha256}`. Explicit rejected/unavailable rows have
parent:null; an audit normalized-document placeholder never becomes a parent.
The full500 projection is `{purpose:'coding',rows:[{audit_id,id,contract_id,
record:{status:'accepted'|'rejected'},parent},...]}`. A runtime must derive and
authenticate this identity projection from its actual current packet, not treat
this helper as a schema replacement or a full source/method verifier.

`currentIdentity(cursor)` returns the one current case + its capsule ref, roster,
basis, packet/method/full-guard/closed-phase refs, presenter and protected IDs.
`snapshot(cursor)` returns the original denominator20, opaque ordered terminal
refs, counts, observed usage and unchanged external clock/carry. Public metadata
and constructor inputs are detached; returned values are recursively frozen.

`recordTerminal(cursor,{receipt_document,receipt_ref})` accepts the current case
only. Own SOURCE_SCOPE_COMPLETE requires available stored parent, exact own
mechanical/private pointers and no pending pages. Existing runtime completeCase
must verify full scopes, current ACKs and live acquisition guards BEFORE issuing
that opaque own receipt. Replay reads ordered immutable terminal metadata only;
it neither rescans previous ACKs/private bodies nor infers genuine reading.
HELD_DISPOSITION is separate, partial and never source complete. It requires the
exact ROOT-issued receipt AND reason-proof refs already pinned in allocation's
dispositions[ordinal]. There is no mint/dispose action. Unadmitted unavailable
cases remain current/held. No case21, refill or silent retry exists.

`cachedPermit(cursor,{capsule_document,capsule_ref,manifest_document,manifest_ref})`
and `verifyCachedPage(cursor,request,{permit,expected_page_ref,page_ref})` check
only current capsule/manifest/page identity metadata. They preserve A single
native V3 (1MiB response,500 parent slice) and partitioned native (2MiB, externally pinned5000 or20000)
as distinct pinned presenters. Reviewer identity does not determine presenter choice. Both retain 4MiB presentation/1MiB review,
100000 nodes/depth64, raw7000/page6000/whole-tool9000 bounds. They do not present
source or relax each presenter's rules. The legacy helper's anchor compatibility
slot is bound only to the explicit zero-start roster, never old reading credit.

`acquisitionRequirements(cursor)` is a requirements list, NOT a capability.
Prepare and completion must still physically rehash current full500/Fresh100,
deny all29 CIDs before cache, verify current method/native/raw/normalized/source
lineage, apply existing full pager guard, budgets and source obligations. Cached
emit/ACK/status must verify current-case request/page/presentation/permit/ACK
joins and current allocation/terminal metadata without rereading all500 rows,
old terminal ACK histories or another coder's private bodies. No ROOT meanings
are inputs. Existing atomic emission/ACK and no-cap-retry behavior remain.

## Metering and integration boundary

No new ledger framework. `validateObservedUsage(cursor,{phase_used,now_ns})`
supports allocation.case_limits:null (GLOBAL_ONLY), case_used:null and
per_case_limits_issued:false. Existing authoritative O(1) global
`{capture,visible,why}` ledger plus exact artifact tree/source charges remain
the runtime proof. Supply absolute four-field phase totals
`{visible,capture,artifact,source_copy}` and external monotonic time. Rollback,
deadline or issued-limit excess rejects; a cap failure retains charged usage.
Only if ROOT issues 20 independent case_limits does case_used[20] become required
and enforce their sum/per-case bounds. No per-case quotas are invented.

`charge(cursor,delta,{now_ns,reserve})` is an optional pure incremental checker;
it adds failed-attempt costs before a sticky budget/time hold. `source_copy_floor`
is an external conservative batch charge >=65536 applied ONCE globally, including
artifact bytes; if per-case quotas exist it belongs to the initial case. Advancing
the cursor never resets budget/clock/carry. All original closed floors, wall time,
captures, artifact IO, guarded source loads and failure costs remain external and
must be preserved. Numeric/self-sealed metadata is not resource/issuer authority.

Smallest later integration: A/B controller imports these two pure modules,
authenticates externally issued roster/allocation/basis/capsules, reconstructs the
cursor with opaque own terminals and existing global totals, selects the current
case, and uses its existing full acquisition/presenter/ACK/completeCase machinery.
One controller can then advance20 without a fixed-code fork per case. Actual
20-case cost, source adequacy, semantics, quality qualification and runtime
admission remain untested/unissued. All materiality holds remain.
