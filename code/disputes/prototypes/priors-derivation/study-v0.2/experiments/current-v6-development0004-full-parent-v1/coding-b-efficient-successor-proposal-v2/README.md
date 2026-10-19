# B162 clock-wire repair — PROTOTYPE / UNADOPTED

Targeted successor to v1, which ROOT found would reject the actual old admission
before reading. V1 and its failed pre-admission finding remain unchanged.

The old clock has four fields. V2 compares its exact monotonic origin/deadline
projection, validates both original wall timestamps and preserves that metadata.
The pager and generic cached guard are byte-identical to v1. No deadline or
cumulative cap changes. All 12 fictional controls passed in the managed container.

The full old 262144-byte charge and patch 196608-byte charge remain. The ledger
uses materialized source writes; Docker's unmaterialized stream is separate
capture IO. No named transport archive or temporary transport file was created.

ROOT must issue actual bindings/admission. No actual case source, private body,
controller API, model or tokenizer was opened. See `source-free-handoff.json`.
