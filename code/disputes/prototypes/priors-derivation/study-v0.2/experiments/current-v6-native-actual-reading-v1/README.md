# Inactive V6 bounded actual-reading transport

This source has not been executed. ROOT must independently review this exact
helper, pin its SHA-256 and source byte count, and provide one admitted phase
before any package/output access, source copy, Docker action, or clock start.
The helper does not author an actual review, adequacy judgment, replay,
qualification, inference, or resolution.

Run only in the existing managed Linux container and source82 snapshot, with
`node --max-old-space-size=512 <helper> <action> <absolute-run-root>
<admission-relative-path> <admission-sha256>`. Admission is an exact-byte pinned
JSON object with schema `native-v6-actual-reading-admission-v1`, `approved: true`,
`reader: "native0"`, this helper's `helper_sha256` and `source_copy_bytes`, and
`state_path`, `package`, `outputs`, and `limits` equal to their helper constants.
The admission grants only this bounded reading transport. Do not copy this README
as runtime source; the source-copy allowance covers the single helper file.

`start` creates the one fixed exclusive phase directory, establishes an immutable
Linux boot/uptime origin, and checks the package and all three output byte pins.
Each `next` emits exactly one globally ordered page. Complete output values are
compacted with `JSON.stringify(JSON.parse(original))`; no fields or projection
details are filtered. Concatenating each output's payload fragments reproduces
its entire compact value. Each payload is at most 7000 UTF-16 code units and
never splits a surrogate pair; the entire response is at most 7500 code units.
There are 24 pages in the pinned order: 10, 13, and 1.

After native0 has actually observed and read the returned tool chunk, native0
alone may call `ack` with these five trailing arguments:

```
native0 <global-index> <observed-tool-chunk-id> <response-sha256> DISPLAYED_AND_READ_BY_NATIVE0
```

The response hash appears in the corresponding immutable emission receipt, and
is the SHA-256 of the complete header/newline/payload/newline response. A chunk
identifier must name the real observed tool result. Never pre-ACK, automate the
reading affirmation, infer reading from byte verification, or treat ACK as an
adequacy judgment. The next page remains blocked until the current page's ACK.
Each native invocation is bounded to 60 seconds; thinking and ACK time remain
inside the one 30-minute phase. ROOT must use an outer process timeout no greater
than 60 seconds, a sufficient non-truncating tool response allowance, and capture
the actual chunk identifier. No retry, replayed display, clock reset, alternate
phase directory, or recovery emission is permitted after any failure.

Memory is sampled before/after bounded work: 512 MiB used heap and 1 GiB RSS,
with Node old space pinned to 512 MiB. One immutable phase has 1800000 ms, at most
524288 visible bytes, 2097152 captured response bytes, 8388608 new artifact bytes
including the state directory, and 65536 copied source bytes. State records and
full displayed responses are exclusive immutable files. ROOT must additionally
account for outer-tool framing and any capture beyond helper stdout, with the
ROOT-reserved 262144-byte additional charge within the 2 MiB aggregate capture
cap; the helper accounts for its own start, page, and ACK responses and reserves
artifact space.
All five whole-document/governing-parent/effectiveness/operative-version/human
flags remain false and authority remains `NONE`.
