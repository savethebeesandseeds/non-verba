# Current194 audit regeneration — one-off PROTOTYPE

## Executed checkpoint — 18 October 2026

The frozen entry completed with **native exit 0** (tool chunk `0b4c6d`) in
49,822 ms. ROOT's separate metadata readback was tool chunk `dc56de`. Its result
is `qa/current194-audit-regeneration-v1/regeneration/result.json`, SHA-256
`a7c1eca30d90a15ad3c49e2085b0dac88a5d4171403ec7d99207645aab56d207`,
2,038 B. Paths in this checkpoint are relative to the existing
`20261013-study-15000` run.

The regenerated manifest is `audits/6117a6f51bac9ea11b66/manifest.json`, SHA-256
`76ae272fbd0cdb99abbe6022c900613424c50d883db60881b5c5ae1e2fb4a195`,
9,638 B; its complete audit-source identity is
`6117a6f51bac9ea11b6677c71d2926c4cd008cb09157f587d66b48b47a74c002`.
All five packets matched the fixed old rows and non-source headers after only
the four exact manifest-joined lineage changes. Counts remain development 200,
fresh representation 100, coding 500, negative 200 and source integrity 57.
The fresh packet retains the same 100 unique parents over 29 contracts. Every
packet and every review remains **AUDIT_NOT_RUN / NOT_RUN**; no refill occurred.

The six-file namespace measured 3,969,110 B; the conservative temporary-commit
charge was 7,938,220 B. The entry's maximum ceilings are 600,000 ms, 1,024 MiB Node old
space / 1 GiB sampled heap used, 3 GiB sampled RSS, 16 MiB namespace, 16 MiB QA
and 32 MiB prospective combined new writes; an admission may only lower them.
Sampling is not a continuous resource
guarantee. This mechanical regeneration is no actual source reading, judgment
transfer or quality clearance. It does not promote the earlier extraction's
`HELD RUNNER_RSS_UNKNOWN` status or restore Q25's withdrawn resource pass.

This entry calls unchanged frozen B3 `audit.buildAuditPackets` directly. It does
not run a reader, transfer judgments, refill a shortage, repair source, qualify
fresh reading or clear a hold. No corpus access/build is authorized by authoring
this source. ROOT must freeze it, review it and supply a fresh admission.

CLI: Node with exactly `--max-old-space-size=1024 --disable-proto=throw
--experimental-vm-modules`, then `run.mjs POLICY_PATH POLICY_SHA256 POLICY_BYTES`.
Policy JSON must use pretty two-space serialization plus LF and exactly:

```text
schema: current194-audit-regeneration-policy-v1
status: ADMITTED_CURRENT194_FIXED_AUDIT_REGENERATION
RUN: exact existing study root
QA_root: RUN/qa/current194-audit-regeneration-v1
clock_ref: unresolved ROOT ref to QA_root/clock.json
runtime_node_ref: unresolved ROOT ref to the actual physical Node binary
source_epoch_ref: pinned 3729deec… / 6380 B
audit_module_ref: B3 audit.mjs 923f4e3d… / 19910 B
old_extraction_ref: pinned 676e548d… / 5178351 B
new_extraction_ref: pinned 8f1fc4f8… / 5179014 B
old_audit_ref: audits/592ddf76b713d8ad4a13/manifest.json, 4e5c8565… / 9638 B
protocol_ref: audit-protocols/repair-v13/protocol-v2-corrected-exposure.json,
              a26b31fc… / 21262 B
comparison_result_ref: f958fb7a… / 3306 B
comparison_attestation_ref: ROOT-native-exit-attestation.json, d2ce5487… / 462 B
expected_audit_source_sha256: unresolved ROOT prediction from exact metadata
limits: {phase_ms,heap_bytes,rss_bytes,namespace_bytes,QA_bytes,
         combined_new_writes_bytes}
```

Refs are exact `{path,sha256,bytes}` objects. The clock is separately supplied as
`{schema:"current194-audit-regeneration-clock-v1",origin_ns:"decimal hrtime"}`;
it is never reset. Limits may lower 600,000 ms, 3 GiB sampled RSS, 16 MiB namespace,
16 MiB QA and 32 MiB prospective new writes. Heap used is sampled against 1 GiB,
with Node old space fixed to 1,024 MiB. Checks are not continuous guarantees.
A 100 ms in-process timer stops only this process on an observed cap violation,
retaining a compact HELD marker when possible; synchronous builder work can
delay a sample. ROOT's native observation remains separate from self-report.

The entry first authenticates the complete 994-case comparison and ROOT's
observed native-zero attestation. These preserve the earlier extraction parent's
`HELD RUNNER_RSS_UNKNOWN`; they do not grant it a resource pass. Before any cache
call it checks identical ordered 1,000-prefix snapshots, terminal 994/937/57/6,
discovery-only cohorts and exact available/missing/cache lineage. All 23 B3
extraction source files plus audit.mjs are rehashed before imports. The audit
factory's five-file identity is predicted from those exact bindings.

It predicts the source/namespace and complete expected outputs before the builder
is called. The new namespace must not exist. Only four row fields change, each
joined to exact old/new extraction metadata: `lineage.cache_path`,
`lineage.cache_sha256`, `lineage.normalized_path`, `parent.normalized_path`.
Rejected normalized paths remain null. Every other row field—including text,
hashes, IDs/order, focal/parent geometry, omission flags and NOT_RUN responses—
must deeply match. The historical negative-0093 exception is inert here.
All non-source packet headers must also match. Freshness remains the same 100
unique parents over 29 contracts, with zero declared exposure overlap.

The unchanged builder independently verifies its frozen study/selection,
selected-unit shards, caches, raw and normalized hashes and all underlying
exposure records. It reads those files mechanically; no payload text is printed
or represented as human/agent source reading. Errors expose fixed codes only.
The final six namespace files are checked against exact predicted bytes/hashes.
Prospective write accounting reserves twice the complete predicted namespace
for the existing builder's exclusive temporary commits, plus charged QA files.
Existing records are never intentionally reused or overwritten.

The QA parent initially contains only regular ROOT metadata files. Its new
exclusive `regeneration/` child contains preflight/result or HELD metadata only.
No supervisor, cache copier, new source snapshot or duplicate audit algorithm is
introduced. All five generated packets remain `AUDIT_NOT_RUN`; quality and
materiality decisions, coding, model use and Q25's withdrawn resource pass stay
outside scope. Existing builder tests are reused; no mirror tests are authored.
