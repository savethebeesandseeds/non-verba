# Stored-case reader — PROTOTYPE / UNADOPTED

This is a source-only implementation with **actual admission unconditionally CLOSED**. `openStoredCaseReader()` throws before touching either argument, getters or files. No file seal, permit-shaped object, read plan or fixture result changes that. The executable factory is `openFixtureStoredCaseReader(request,{permit})`, using the module-owned `MANUAL_READER` fictional permit from `../admission.mjs`, an unlinked `/tmp/literal-emphasis-next-*` or `/tmp/literal-emphasis-actual-*` root, and synthetic case/CID identities. The factory never opens raw inputs, caches, fresh packets, models or tokenizers. It reads only explicitly bound fictional stored artifacts and metadata. Later actual reading needs a separately reviewed revision and approval.

The explicit source set is `reader/schema.mjs`, `reader/index.mjs`, `reader/journal.mjs`, `reader/transport.mjs`, `reader/controls.test.mjs`, and this note. Named project dependencies are the surrounding `admission.mjs` and the accepted `../../finite-codec.mjs` (including its accepted immutable-state dependency). There are no copied/forked upstream files or new packages. The combined source epoch must bind every named dependency; this is not general dynamic-dependency discovery.

## Input contracts

The request has exactly these **eight** data fields:

```
root, case_id, case_index_ref, read_plan_ref, source_epoch_ref,
protected_guard_ref, ordered69_ref, case_ref
```

Metadata refs are `{path,sha256,bytes}` with strict relative paths (at most4096 characters/128 components). `case_ref` adds `decoded_sha256,decoded_bytes` and is exactly `cases/<case_id>.json.gz`. Every ancestor is opened as an `O_DIRECTORY|O_NOFOLLOW` directory and held through a private `/proc/self/fd` chain until the final `O_NOFOLLOW|O_NONBLOCK` file is closed. This avoids a pathname ancestor-check/open race. Final files must be regular; sizes, bounded reads, final stat and hashes must match. Each metadata file is at most8MiB; no directory or whole-study scan occurs. Parsed JSON is limited to depth128 and one million nodes before recursive sealing/serialization.

The exact metadata schemas are:

```
case index: {
  schema:'stored-pilot-case-index-v1', source_epoch_ref, phase_config_ref,
  protected_guard_ref, ordered69_ref, current_source_sha256,
  rows:[{audit_id,contract_id,original_index,case_ref,
         descriptor_sha256:null|SHA,original_source_refs_sha256,status,
         documents:[{kind,sha256:null|SHA,bytes,utf16,
                     status:'AVAILABLE'|'MISSING',missing_code:null|CODE}]}] // 69
}
read plan: {
  schema:'stored-pilot-read-plan-v1', case_index_ref,source_epoch_ref,
  phase_config_ref,protected_guard_ref,ordered69_ref,reviewer_id,
  own_audit_ids,tokenizer_policies,visible_tool_evidence_ref:null|REF,
  authority:'NONE'
}
fresh guard: {
  schema:'stored-reader-complete-fresh100-guard-v1',fresh_packet_ref,
  source_epoch_sha256,rows:[{audit_id,contract_id}], // 100 unique audit IDs
  contract_ids, // exactly29 unique sorted CIDs, exactly the rows' CID set
  projection_sha256 // digest of all other fields, not a file-byte SHA
}
```

`source_epoch_ref` binds the full source epoch file. Its internal `epoch.sha256` is separately checked against the digest of its complete body. The epoch's `current_source_proof_sha256` must match index and frozen-row source identities. The phase config is rehashed and must contain phase `PREPARE_SELECTED69` and the exact source-epoch/guard/ordered69 file refs. The `typed-focal-prospective69-freeze-v2` file must have a valid full seal, complete ordered69 status and nominal/planned69 counts. Its `fresh_guard_sha256` must equal the legacy guard projection seal recomputed from this wrapper's exact packet SHA,100 count and29-CID set. All69 index rows must preserve exact order, ID/CID, original-row digest and case path. The read plan must bind all those exact refs, the requesting reviewer's own IDs and the two fixed policy/file-set pairs from the accepted resource plan. Any protected CID in the frozen69 is rejected **before the gzip file is opened**. The reader does not independently reopen the original fresh packet: complete guard provenance still depends on the externally bound, separately reviewed metadata producer.

The nine stored document descriptors occur in this exact order:

1. `raw_full`
2. `normalized_full`
3. `native_parent_dictionary`
4. `omitted_fields`
5. `candidate_<baseline-policy-SHA>_focal`
6. `candidate_<baseline-policy-SHA>_parent`
7. `candidate_<comparison-policy-SHA>_focal`
8. `candidate_<comparison-policy-SHA>_parent`
9. `preparation_scope_manifest`

A missing document has null SHA, zero bytes/UTF16 and an explicit uppercase reason code. A present document must match its whole UTF8 SHA, bytes and UTF16 length. The case is canonical gzip6 containing canonical UTF8 `JSON.stringify(value,null,2)+'\n'`, at most8MiB encoded and32MiB decoded. Decode bounds apply before allocation/parse; source document bytes are not double-charged as a second copy of the same serialized payload. The aggregate document bytes also must fit32MiB. Raw bytes and normalized characters remain within2MiB. Unpaired-surrogate document strings are refused.

Case schema remains `prospective-literal-emphasis-parent-case-v2`. The complete selected-row and descriptor digests, phase source epoch, typed focal/parent IDs/geometry/hashes, current method, raw/normalized document hashes, native envelope and tracer/collector identities must match. The native dictionary must retain full required arrays, all source associations and unassigned/no-run counts without claiming computed style or effect. Its complete bytes, including unknown rich fields, remain available. The omitted-field document must match the exact `omitted-fields.json` file ref in the epoch. The reader validates every stored window's encoded SHA, reversible literal source interval, codepoint endpoints, stored token-count cap256, tokenizer-policy identity and terminal zero ownership, plus the four measured-arm summaries. It does **not** rerun the tokenizer, verify actual special-token counting, rerun the tracer or finite-feature derivation, or independently prove producer completeness, legal effect or semantic adequacy from self-consistent stored artifacts.

Native evidence identifiers use their own bounded grammar, including the accepted tracer's `mark:<start>-<end>` IDs; they are never reinterpreted as file paths. Missing required documents, explicitly failed arms, unavailable whole cases and incomplete preparation remain `PARTIAL_REQUIRED_SCOPE`. No failure is replaced, no prefix becomes complete, and all original69 remain the denominator. A tenth derived required document, `stored_case_metadata`, retains **all** non-document case fields plus the complete stored-document manifest, so metadata and unknown case fields are available for literal inspection too.

## One response, forwarded once

The handle exposes:

```
plan()                       // immutable metadata only
page({kind,cursor:null|TOKEN}) // ONE already serialized literal JSON string
validateOwnJournal(journalRef) // mechanical consistency, never a reading attestation
```

`page()` accepts one object, never a batch. Start at null; continuation tokens must have been issued by that reader for the same document. Boundaries never split an astral surrogate pair. The exact returned string includes all metadata, the literal slice and trailer: case/epoch/document identity, start/end/total, literal SHA, page ID, next cursor or terminal flag, and `manual_observation_required:true`. JSON escapes quotes, backslashes and control characters, with `<`, `>`, `&`, U+2028/U+2029 explicitly escaped. HTML/CSS is never executed.

**The caller must forward this exact string once. Do not `JSON.stringify` it again, wrap it in another JSON response, append a label or add a newline.** Both the full returned string's UTF16 length≤7500 and its UTF8 bytes≤65536 are checked after final escaping, metadata and trailer. There is no uncounted LF. A transport that requires a fixed envelope must measure or reserve that complete envelope and obtain separate review; inner-string compliance does not authorize an oversized tool redisplay. `emitFixturePageResponse` demonstrates one exact `process.stdout.write(serialized)` with no LF, guarded by the fictional permit. Its focused child-process control compares every emitted byte to the already bounded response using quote/backslash/control-heavy/astral text. This is a fictional transport example, not an approved actual-display route.

Full document hashes and lengths are computed once at load and reused during pagination; page construction hashes only bounded slices. No quadratic full-document rehash occurs for each page probe. Pages remain mechanical output until actually displayed and observed by an authorized reviewer.

## Own journal and visible-tool evidence

The journal ref names canonical bounded JSON:

```
{
 schema:'stored-pilot-own-journal-v1',reviewer_id,case_id,
 source_epoch_sha256,case_ref,entries,manual_summary,manual_visibility_claim
}
entry = {
 kind,page_id,start,end,document_sha256,literal_sha256,response_sha256,
 tool_ref,trailer_observation,manual_note
}
```

Every entry needs a nonempty authored note, the exact observed trailer and one distinct visible-tool ref. The read plan must independently pin a separate evidence file before validation:

```
{
 schema:'stored-pilot-bound-visible-tool-evidence-v1',reviewer_id,case_id,
 source_epoch_sha256,case_ref,
 basis:'EXTERNALLY_PINNED_VISIBLE_TOOL_RECEIPT_PROJECTION',entries,authority:'NONE'
}
evidence entry = {tool_ref,page_id,response_ref,trailer_sha256}
```

`response_ref` points to the exact bounded, already serialized literal response bytes (no LF or extra JSON wrapper). The validator regenerates each page, matches range/document/literal/page/response/trailer identities, rehashes that exact external response file, and matches the tool ref against the externally pinned projection. Duplicate pages/tools, changed response bytes, forged tool refs, missing observations, wrong own reviewer and contradictory hashes reject. Missing evidence or any gap, failed scope, missing required document or incomplete notes/summary keeps the result partial. At most32768 journal entries and8MiB per journal/evidence file are accepted; exceeding these local limits requires a separately reviewed journal partition protocol, never silent entry dropping.

Even a fully consistent fictional journal returns only `MECHANICALLY_COVERED_NOT_READING_ATTESTATION`, with `actual_reading:false`, `human_visibility_authenticated:false`, `adequacy_attested:false`, `source_quality_passed:false`, `issue_state_changed:false` and authority `NONE`. Matching metadata files cannot authenticate their own external-tool provenance or prove human reading. That projection, any actual display and authored adequacy judgment need separate independent provenance review and authorization. No helper generates a reading attestation or issue-resolution artifact.

All ten known holds (0045/47/55/85/86/92/94/147/149/174) and every later finding remain preserved. This component has no issue writer, qualification path, inference or production-method activation.
