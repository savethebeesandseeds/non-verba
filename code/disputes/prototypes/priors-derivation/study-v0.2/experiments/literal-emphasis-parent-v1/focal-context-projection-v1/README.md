# Focal context projection — PROTOTYPE / UNADOPTED

This pure projection keeps a supplied focal unchanged and attaches complete
existing source-frame spans as separate evidence. It does not re-extract,
reselect, repair focal packing, invent governors, join disjoint source text or
change current874 or any collector. Input custody and every actual source read
remain external. Descriptive source flags and caller assertions grant no authority.

`projectFocalContext({extraction,focal_id,limits})` returns an immutable
`{artifact,metadata}`. `summarizeFocalContext(artifact)` reproduces the compact
metadata. `verifyFocalContext({artifact,extraction,focal_id,limits})` independently
checks the full source joins and literals without calling the projector. Inputs
are bounded trusted plain JSON from an authenticated extraction; this is not a
sandbox for executable JavaScript objects.

The limit keys are `context_payload_bytes` (default/hard maximum262144) and
`max_context_spans` (default/hard maximum32). Callers may only lower them. Accepted
payload size is the exact UTF8 byte sum of the canonical two-space artifact JSON
plus newline and final metadata JSON plus newline. The metadata's own byte fields
are solved to a fixed point. Frame/focal/source-metadata bytes count; JSON escaping
and serialization overhead count. No source payload is silently truncated.

The artifact retains the whole original focal record, its canonical digest, the
complete normalized-source/extraction digest and native-envelope reference hashes.
It resolves one exact parent by `parent_section_id`, validates the literal ranges,
hashes and native scoped references, and preserves focal frame-reference order.
The direct collector's sealed native envelope supplies the raw hash; a processor
cache's top-level `raw_sha256` is cross-checked when that optional field exists.
External actual-input custody still verifies full raw bytes against that envelope.
Every attached context has role `EXISTING_SOURCE_FRAME_CONTEXT`, an unchanged
whole stored frame object and the exact normalized slice for its full range.
Stored governor text is accepted only at its own exact range/hash inside that
frame. It is never replaced by a heading, number, caption, nearest label or an
inferred earlier/later governor. No frame is clipped to the focal or merged with
another frame. Source text separators already present in normalized input remain
literal; the projection introduces no purported source separator.

The full-parent reference has role `PARENT_REVIEW_CONTEXT_UNVERIFIED`; it contains
the exact parent ID/range/hash, full-parent-record digest and unchanged native
reference. It contains no whole-parent text fallback. Full native evidence stays
in the authenticated input artifact; its entire canonical digest binds unknown
fields. Focal/parent native reference fields and full frame metadata, including
unknown fields and closure hypotheses, are retained unchanged. This module makes
no new native projection or effectiveness judgment.

Statuses distinguish evidence from adequacy:

* `PROJECTED_EXISTING_SOURCE_FRAMES_UNVERIFIED`: all referenced existing spans and
  their stored literal governors were retained. This verifies literal projection,
  not complete governing context.
* `UNRESOLVED_CONTEXT_SCOPE`: frame references or stored governor evidence are
  unavailable. Missing references return the unchanged focal and full-parent
  reference with no partial frame set. A valid frame with no stored governor may
  remain complete literal review evidence, explicitly unresolved.
* `CONTEXT_SCOPE_TOO_LARGE`: the complete source payload or span count exceeds the
  declared limit. This is a refs-only failure: focal/context payloads are absent,
  their input digests remain, and no accepted partial result is substituted. Even
  an oversized focal record is not copied into that resource-failure payload.

Returned resource-failure metadata has a separate hard262144-byte combined
envelope ceiling, even if a caller lowers the accepted context limit to one byte.
If complete reference metadata itself exceeds that hard ceiling, the function
throws `CONTEXT_SCOPE_TOO_LARGE` with only bounded hash/numeric focal and parent
diagnostics. It does not return a truncated reference set or an oversized failure
artifact. The verifier checks the same failure-envelope ceiling independently.

Duplicate identities, corrupt literal ranges/hashes, mismatched native references
and caller-supplied positive governance claims raise `SOURCE_CONTEXT_BINDING`.
Invalid API/limit shape raises `INVALID_INPUT`. These integrity failures are not
laundered into a normal unknown scope. Every result keeps `context_adequate:null`,
governance/semantic verification false, antecedents unreviewed and later governors
unproven. A stored frame can omit an earlier antecedent or retain a later colon
list without recording its second governor. Complete stored span coverage does
not establish source adequacy. Actual full-parent/surrounding/original-passage
review and formal rubric gates remain necessary.

The SOURCE_FREE controls use the real baseline collector on a long list whose
middle focal lacks its lead-in and shared qualification, a numeric frame followed
by a second colon list, and an unnumbered governor. They exercise missing evidence,
integrity mutations, unknown native fields, exact final byte thresholds, bounded
oversized-focal failure and independent readback rejection. Run from the official
managed source snapshot repository root:

```sh
/opt/nonverba-tools/node/bin/node --test code/disputes/prototypes/priors-derivation/study-v0.2/experiments/literal-emphasis-parent-v1/focal-context-projection-v1/projection.test.mjs
```

Synthetic projection checks do not clear source quality, materiality, completeness,
native effectiveness, model/tokenizer access, coding or first-prior decisions.
