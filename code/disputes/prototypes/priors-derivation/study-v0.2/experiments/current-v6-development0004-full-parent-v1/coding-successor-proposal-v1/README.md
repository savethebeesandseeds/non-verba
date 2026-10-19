# Fixed500 coding successor — PROTOTYPE

This inactive successor preserves both expired phases. It never edits their
admissions, clocks, locks, requests, ACKs, meanings or canonical records. It
uses the same V6 source and exact500 packet. There is no aggregate coding,
reconciliation, source-quality or reserve authorization here.

`successor-pager.mjs` implements actual continuation operations. It imports the
predecessor pager only for its pure pagination, page-order and observed-tool
checks. It never calls an expired predecessor entry point. A uses the unchanged
frozen reader. B uses its existing bounded subdivision reader and partitions
in place. No generated loader, code rewriting or new native projection method
is used. The accepted registry receipt and its exact files/rosters are checked;
no registry verifier, repair replay or accepted-method callback is invoked.

`successor-policy.mjs` validates the separate prospective reservation. Each
runtime root is exactly one of:

- `RUN/coding/open-coding-a/current-v6/successor-v1`
- `RUN/coding/open-coding-b/current-v6/successor-v1`

Here `RUN` is `/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000`.

## Exact reservation and inherited state

The new phase has its own90-minute monotonic and wall clocks, a60-second external
per-operation watchdog,1GiB sampled RSS ceiling,16MiB cumulative visible ceiling,
64MiB cumulative capture ceiling and128MiB cumulative artifact ceiling. The last
three include the conservative predecessor floors. Page JSON, including its
fragment wrapper, remains at most8,500 UTF16. The complete forwarded tool output
must be measured at no more than9,000 UTF16.

New runtime source copies, phase admission and an8,192-byte directory reserve
must fit65,536 bytes. The measurement counts **every** new top-level `.mjs` or
`.cjs` file, not just the two expected modules. Charge the complete65,536-byte
prospective reservation; do not reuse old source-copy headroom. There are only
two required new runtime modules: the pager and policy. Existing imported
implementation remains separately charged and is reused in place.

B retains39,543+81,416=120,959 nominal source/setup bytes and127,602 conservative
bytes; its original131,072-byte hard cap remains unchanged. The separately
reserved successor therefore records193,138 cumulative conservative runtime
source/setup bytes when its complete65,536-byte reservation is spent. A's
nominal and conservative predecessor copy floors must come from ROOT's actual
copy ledger; this proposal does not invent them. Preserve the source-free
engineering copies and captures separately as spent work.

Both predecessor phases are conservatively charged their full5,400,000ms. The
successor adds at most another5,400,000ms. This does not revive an old admission.
B's permanent `run-v1/operation-lock` must remain. Any declared A predecessor
lock must remain. Every mutation is confined to the new runtime root. A failed
operation retains its **new** operation lock; no timeout or failed guard refunds
any charge.

A starts at0103, retaining the reported102 meaning finals. Its exact inherited
manifest paths are `run-v1/requests/r000016/manifest.json` and
`run-v1/requests/r000017/manifest.json`. They must still establish all31 retained
parent/native pages and the one complete raw-markup page as separately ACKed.
The new `disposeUnusable` operation requires the exact technical evidence and
all68 proof references. It records only `UNUSABLE_SOURCE_UNCODED`, then advances
the operational cursor to0104. It does not read images, infer a meaning, create
`FINAL_READING`, replace0103 or add a meaning final. The original partial remains.

B starts at0162 with161 reported historical meaning finals; their current-source
qualification is not established here. Its exact inherited manifest is
`run-v2/requests/r000001/manifest.json`. Old ACK29 remains in place. Emission30
and its ACK are appended under the new
`retained-transitions/r000001/` directory. All77 pages must be read/ACKed in order;
the saved response is not prepared again. Subsequent preparation uses the same
reader, current-case order and full response retention. New coverage receipts
are called reading-complete, never inferred meaning finals. Own coding outputs
remain the responsibility of the original isolated coder.

## ROOT metadata-only bootstrap

This is the remaining admission step, not an already executed phase.

1. Preserve the originals. Measure current predecessor copy, visible, capture
   and artifact floors from the existing ROOT meters, including failed attempts,
   engineering work and external capture reservations. B's last diagnostic
   projected at least2,906,642 visible,3,905,105 capture and1,824,263 artifact
   bytes; later work may require larger floors. Obtain A's actual copy floors.
   Names, metadata and file sizes suffice; ROOT must not open meanings.
2. Exclusively create the appropriate new root and its `requests`,
   `retained-transitions`, `readings`, `case-completions` and `dispositions`
   directories. Copy the two reviewed modules. In the copied pager only, change
   the single `ROOT_ACTIVATED = false` literal to `true`; retain the authored
   source and exact one-literal copy delta. Pin the activated copy, policy,
   predecessor `phase-admission.json`, predecessor `pager.mjs` and the exact
   pending manifests by SHA256 and bytes. No source pages or meanings are copied.
3. Write `phase-admission.json` exclusively using the concrete schema below.
   Measure the complete new source/setup set and charge65,536 bytes. Use fresh
   clocks only after review/copy preparation. Pin the admission externally.
4. Invoke `status` first through the watchdog. It displays metadata only and
   creates no operation lock. Require the exact expected current case and ACK
   counts. Any incompatibility holds before source emission. Then dispatch the
   original A and B readers to their own roots only.

The following is the admission construction shape. `ref(path)` means an exact
regular-file SHA256/byte reference. `LIVE_METER` is ROOT's current, recorded
conservative meter, not a guessed example value. No field may be omitted.

```js
const a = {
  schema: 'coding-successor-admission-v1', status: 'ADMITTED', admitted_by: 'ROOT',
  reviewer_id: reviewer, // A: open-coding-a; B: open_coding_clean_b
  source_sha256: '82a3dab1396336edccf77f27a7800cccddff67ca928e919e824a663e1d563601',
  packet_ref: {
    path: 'audits/049d0f4fe07080f7e7f0/coding.json',
    sha256: '51143feeddcc5f35be66a62748642adb1af7442ffea7134e640816f68f2943e2',
    bytes: 1643742
  },
  helper_ref: ref(Q + '/successor-pager.mjs'),
  policy_module_ref: ref(Q + '/successor-policy.mjs'),
  predecessor: {
    root: OLD, // A run-v1; B run-v2
    admission_ref: ref(OLD + '/phase-admission.json'),
    pager_ref: ref(OLD + '/pager.mjs'),
    expired_deadline_wall_ms: Date.parse(oldAdmission.expires_at),
    source_copy_nominal_bytes: NOMINAL, // B120959; A actual ledger
    source_copy_conservative_bytes: CONSERVATIVE, // B127602; A actual ledger
    original_phase_ms: 5400000,
    permanent_locks: LOCKS // B exact run-v1/operation-lock; A actual existing locks
  },
  carry: {
    visible_bytes: LIVE_METER.visible_bytes,
    capture_bytes: LIVE_METER.capture_bytes,
    artifact_bytes: LIVE_METER.artifact_bytes,
    semantic_final_cases: reviewer === 'open-coding-a' ? 102 : 161,
    fixed_case_cursor: reviewer === 'open-coding-a' ? 103 : 162,
    unusable_source_cases: 0, elapsed_ms: 5400000
  },
  phase: {
    origin_ns: String(origin), deadline_ns: String(origin + 5400000000000n),
    started_wall_ms: started, deadline_wall_ms: started + 5400000
  },
  limits: {
    new_source_copy_bytes: 65536, predecessor_source_copy_bytes: 131072,
    phase_ms: 5400000, tool_ms: 60000, visible_bytes: 16777216,
    capture_bytes: 67108864, artifact_bytes: 134217728,
    page_utf16: 8500, rss_bytes: 1073741824
  },
  root_control: {
    per_tool_watchdog_60s_confirmed: true, external_capture_meter_confirmed: true,
    global_registry_reexecution: false, other_coder_access: false,
    fresh_or_reserve_access: false, source_quality_gate_pass: false,
    formal500_gate_satisfied: false
  },
  successor_source_copy_charge_bytes: 65536,
  pending_manifest_refs: PENDING // A ordered r000016,r000017; B r000001
};
```

## Actual operation calls after admission

Use sanitized managed Debian, Node flags `--max-old-space-size=512
--disable-proto=throw`, and `/usr/bin/timeout --signal=KILL 60s` for each call.
Import only the activated own successor pager. All calls are
`await invoke(ADMISSION_REF, {action, args})`.

```js
await invoke(ADMISSION_REF, {action:'status'}); // ROOT metadata only
await invoke(ADMISSION_REF, {action:'disposeUnusable',args:{auditId:'coding-0103'}}); // A only
await invoke(ADMISSION_REF, {action:'emit',args:{requestId:'r000001',page:30}}); // B only
```

Forward emitted source stdout with `functions.text(execResult.output)`, never
`text(execResult)`. Add only compact chunk/native metadata. Measure the complete
forwarded output, including that metadata, and require at most9,000 UTF16.
Outer and nested tool budgets must cover the full response. An actual native
zero result, exact returned chunk, complete output and actual reading are
required; source-length guesses are not ACK evidence.

```js
await invoke(ADMISSION_REF, {action:'acknowledge',args:{
  requestId:'r000001',page:30,pageSHA:EXACT_PREPARED_PAGE_SHA,
  externalToolCallRef:ACTUAL_TOOL_CALL,externalChunkRef:ACTUAL_RETURNED_CHUNK,
  nativeExitCode:ACTUAL_RETURNED_EXIT,untruncated:true,reviewerObservedPage:true,
  outputSHA:ACTUAL_FORWARDED_STDOUT_SHA,outputBytes:ACTUAL_FORWARDED_STDOUT_BYTES,
  outputUTF16:ACTUAL_FORWARDED_STDOUT_UTF16,
  wholeToolOutputUTF16:ACTUAL_COMPLETE_FORWARDED_TOOL_OUTPUT_UTF16,
  outerToolResponseObservedComplete:true,outerTruncationMarkerObserved:false,
  forwardedStdoutExactPrepared:true
}});
await invoke(ADMISSION_REF, {action:'prepare',args:{
  auditId:EXACT_CURRENT_CASE,source:'parent',offset:0,limit:EXPLICIT_LIMIT_AT_MOST_20000
}});
await invoke(ADMISSION_REF, {action:'confirmCase',args:{
  auditId:EXACT_CURRENT_CASE,readingRef:EXACT_OWN_READING_REF,
  requiredRawRanges:ACTUAL_REQUIRED_UTF16_RANGES
}});
```

The own reading reference has relative path `readings/coding-NNNN.json`. Only
that coder may author/read its contents. Preparation, emission, observation,
authored reading and independent open coding remain distinct. No helper output
substitutes for the coder's actual source reading or catalog work.

## Source-free validation

All15 synthetic tests passed with native exit0, zero skips in managed Debian
(tool `cb8010`). The inactive module imports opened no corpus and invoked no
coding API. They cover wrong identities/fixed hashes, expired clocks, copy
undercharges and floors, predecessor write/lock confinement, retained29/77
continuity, explicit inherited intervals, whole-output truncation, exact68-ref
unavailable proof and absence of semantic-final promotion.

The preserved control copy is `/tmp/nonverba-coding-successor-controls-nfmaPe`:
51,185 source bytes plus an8,192-byte directory reservation. Keep that59,377-byte
engineering source-copy charge and its captures separate and nonrefundable.
This control result is not an actual successor admission or source reading.
