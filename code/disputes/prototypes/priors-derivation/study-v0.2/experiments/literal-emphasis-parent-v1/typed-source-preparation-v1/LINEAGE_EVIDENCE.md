# Inert lineage evidence — PROTOTYPE / UNADOPTED

This three-file component prepares diagnostic data for a separately reviewed V5
observer successor. It is not attached to an observer, registry, actor, guardian,
writer or admission path. It imports nothing and performs no filesystem, process,
role, signal, clock or other observation. No real process or source input was
opened to implement it. The synthetic test file is not the full owned fictional
two-phase prerequisite, an execution receipt or actual authority.

`createLineageEvidenceRecorder()` returns `capture(candidate, expectedParent,
observedParent, elapsedMs, heldAtCapture = null)`, `markHeldLineage()` and `read()`.
The future caller supplies only its already observed local data. `capture` copies
the four named own data fields `pid`, `start_ticks`, `group`, `ppid`; it does not
evaluate accessors or enumerate unrelated fields. `null` means ABSENT and the
literal `UNKNOWN` means UNKNOWN. Other invalid/missing/accessor fields receive
bounded diagnostic tags. Safe integers, including PPID0, negative diagnostic
values and zero, remain data: their retention is not an ownership predicate.
Tick strings retain at most 32 ASCII digits; existing held codes retain at most
96 uppercase code characters. Arbitrary error messages, command text and child
arrays are not retained. Caller-controlled proxies are outside the local
data-only contract; descriptor failures are recorded as unknown, not ownership.

Every candidate and readout is visibly UNADMITTED with authority NONE. Only the
last discovered candidate and sticky first marked lineage candidate are kept.
Readouts are detached, recursively frozen data. Capture sequences saturate at
the largest safe integer rather than opening an error/admission path. The
constructed ASCII JSON record is capped at 2,048 characters/bytes; a diagnostic
shape overflow becomes a bounded UNKNOWN diagnostic rather than a new ownership
gate. The two-record readout is bounded by 8,192 ASCII JSON characters/bytes.
An invalid elapsed value or held code is diagnostic data, never a new reason to
admit, reject, signal or reset the external observer's sticky held state.

The exact future insertion is in external `observe-v2.mjs::family()`, inside
the existing `!saved` branch: after its existing
`observe(edge.parent.pid, 'PARENT')` and before the unchanged lineage condition.
Pass the already observed `p`, `edge.parent`, `parent`, existing elapsed value
and existing sticky held code to `capture`. Only inside that condition's existing
failure block call `markHeldLineage()` immediately before its existing
`die('ROOT_DESCENDANT_LINEAGE')`. Add the detached readout to the existing bounded
held report. This component does not perform that integration or reserve output.
The future successor must explicitly charge the added source/report bytes.

Keep the original condition byte-for-byte: unknown parent, unequal parent birth,
child PPID mismatch or child group unequal to child PID still rejects. Preserve
the original role checks and `known.set` ordering after successful lineage;
`ownedSignal` continues iterating only that known registry and freshly checking
births. A diagnostic record never enters it. Do not add observations, role reads,
signals, grace periods, retries, PPID-positive requirements or admission gates.
ROOT-level PPID0 acceptance and all original predicates remain unchanged.

The focused synthetic controls cover a valid PPID0 parent, wrong PPID, changed
parent birth, ABSENT/UNKNOWN parents, wrong group, existing held-code retention,
capture without marking, sticky first/advancing last, detached immutable output,
ignored getters/unrelated payloads, bounded invalid data and fixed retained
history. Their tiny branch model is explicitly fictional/inert; no registry,
signal or process is exercised. Full owned fictional B, startup registration
barriers, typed B consumers and the private actual runtime bridge remain pending.
This component grants no checkpoint, source reading, quality, inference or adoption
authority and changes none of the study's existing gates or resource limits.
