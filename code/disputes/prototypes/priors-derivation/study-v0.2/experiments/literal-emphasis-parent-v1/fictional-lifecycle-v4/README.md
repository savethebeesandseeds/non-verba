# Fictional lifecycle v4 — PROTOTYPE / UNADOPTED / PREPARE ONLY

This isolated overlay preserves the exact b5 bootstrap source in `bootstrap.original.mjs` and records one CLI lifecycle correction in `bootstrap.mjs` / `bootstrap.patch.md`. It defers the caught async fixture CLI until entry-module evaluation completes, breaking the bootstrap → guardian → bootstrap top-level-await cycle while retaining the private WeakMap proof registry, public helpers, capture-first path and default actual CLOSED behavior.

These are reviewable overlay sources, not a standalone executable folder. A separately frozen managed source snapshot applies the exact successor bytes to `actual-entry-v1/bootstrap.mjs`; other named source files remain byte-identical. The existing host actual-entry namespace, b5 snapshot and v3 runner/attempt are preserved. No actual or fictional worker/observer suite, process probe, child, model, data access or rerun is authorized by these files.

The forthcoming v4 runner also closes its own parent IPC only after bounded owned-child joins and durable terminal metadata; it still requires observed real child close/absence. Source-extracted fake lifecycle/IPC controls and the exact source/epoch/delta freeze are separate evidence. ROOT must review and independently authorize any later run after owned-process absence is resolved.

