# Typed Case Roster v1 — PROTOTYPE / UNADOPTED

This separate proposal represents **69 protocol cases**: 67 available focals
(53 actual units and 14 parent anchors) and two explicit unavailable controls.
It preserves the original mandatory 45 identities and their order, including
the two unavailable cases, followed by the original additional 24 selected by
the unchanged seed and 12/6/6 strata. The available mandatory count is 43.

The existing selector and metadata finalizer remain authoritative for their
existing contract: they require 69 available focals and correctly retain the
old result as HELD. This proposal does not turn that result into a successful
execution or checkpoint. A protocol case, a parent anchor, and an actual unit
retain distinct roles.

The roster carries the legacy requirement to disclose duplicate arm inputs.
These counts describe protocol-case roles; they do not assert that all focal
or parent inputs are distinct or statistically independent. Nothing is redrawn
or deduplicated to change the original mandatory case identities.

Only `development-0089` / `contract-007eb9c1d24333c81f8c` and
`development-0172` / `contract-ce88344b041aa6843ddb` may become unavailable
controls. Each must already be a
mandatory, authenticated rejected/unavailable anchor in the supplied metadata.
Control records contain no focal, parent, unit, source path, source excerpt,
or invented replacement. The remaining original 200 dispositions stay visible:
189 eligible, 11 ineligible, zero protected, and zero failed. The complete
fresh-100 guard still contains 29 protected contract identities.

`roster.mjs` exports two pure functions:

- `buildTypedCaseRoster(inputs, {fixture: false})` builds a planning roster.
- `validateTypedCaseRoster(roster, inputs, {fixture: false})` independently
  checks all 69 identities, ordering, memberships, roles, counts, existing focal
  rows, unavailable-control shapes, bindings, and seals. It does not call the
  builder or its case-construction helpers.

`inputs` has exactly eight entries: `preflight`, `ids`, `guard`, `projection`,
`legacy_plan`, `summary`, `roster`, and `origin`. Each entry has `{ref, bytes}`;
`ref` is `{path, sha256, bytes}`, and `bytes` is the supplied stored JSON byte
sequence. Every entry is bounded to 8 MiB and checked against its hash, length,
strict UTF-8, and existing pretty-JSON serialization. The first six paths are
the existing metadata output filenames; `roster` is the existing mandatory-45
roster reference, and `origin` is the retained HELD observer proof. There is no
filesystem, process, network, cache/native, model, or tokenizer access API.

The module checks the preflight, projection, current-source and legacy-plan
seals; the full 200-ID partition and CID/source joins; the complete fresh guard;
the mandatory roster order; and the retained HELD summary/proof and their six
output references. It recomputes the legacy selector through the existing pure
`selectTypedFocals` function, then reproduces the existing projection/source
binding and seal. The supplied original HELD-67 plan must match exactly, with
no missing/protected mandatory cases, failed projections, quota shortages,
replacement, refill, or changed source paths.

Hash agreement authenticates the supplied byte bundle and its internal joins.
It does not establish that caller-chosen references were admitted by ROOT.
ROOT must separately pin and review any real input bundle before applying this
pure proposal. No real roster artifact has been produced by adding this source.

`controls.test.mjs` uses entirely in-memory `SOURCE_FREE_FIXTURE` documents with
200 development identities, mandatory 45, fresh 100/29, and the same 67/2 role
counts. It checks forged hashes/seals, dispositions, source/CID joins, quotas,
control eligibility, ordering, paths, counts, and attempted authority promotion.
Fixture mode requires synthetic identifiers and remains visibly fictional.
One policy-literal control reads only this folder's own `roster.mjs` source.

All authority fields remain false or `NONE`: no old checkpoint promotion, phase
B admission, source reading, tokenizer execution, quality clearance, legal
judgment, or adoption follows from a valid planning roster. A future executable
protocol requires its own approved contract and full fictional prerequisite.
