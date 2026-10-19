# Typed Source Preparation v1 — PROTOTYPE / UNADOPTED

This first layer plans and simulates routing for the separate typed-case roster:
69 protocol identities, 67 available focal records (53 actual units and 14
parent anchors), and two explicit unavailable controls. The existing mandatory
45 order, additional 24, original 200 dispositions, complete fresh guard, current
source bindings, and retained HELD origin remain bound to that roster. Nothing
changes the old selector, fixed-69 loader/driver/finalizer, checkpoint or reader.

`plan.mjs` provides pure `buildTypedPreparationPlan` and
`validateTypedPreparationPlan` functions. Inputs are the accepted typed roster,
its eight supplied stored-byte records, and exact options:

```js
{ fixture, model_policy_sha256s, prior_cost }
```

The existing roster validator rechecks the supplied byte hashes, seals and joins.
The actual planning targets are the two existing policy identities `728bb65a…`
and `e05a9bd1…`, in their existing order. These are **two models with twelve
artifact files**, not twelve models. SOURCE_FREE mode uses a separate fixed
pair of synthetic policy-hash markers with `SYNTHETIC_POLICY_MARKERS_NOT_OPENED`.
These markers are neither verified bindings to the existing fixture meter's
counter policies nor evidence that any codepoint counter executed. No counter,
model or artifact is opened or verified here.

Only the 67 available records receive streams: two policy identities × `focal`
and `parent` = **268 prospective stream descriptors**. Each descriptor binds
case ID, audit ID, CID, focal-record digest, focal role, model index, policy and
form. Controls have no streams or focal descriptors. The original duplicate-arm
disclosure remains required: a parent anchor can have equal focal/parent input;
four descriptors do not establish independent evidence. These data are planning
descriptors and confer no IO or tokenizer permission.

`consumer.mjs` exposes `consumeFictionalPreparation(plan, hooks)` for a closed
SOURCE_FREE routing simulation. Only a deeply immutable plan privately issued
by the builder in fictional mode is accepted. Cloned, forged or actual plans
reject before hook access. Every fictional focal identifier and stored source
path is checked as synthetic before that plan can be issued; paths are not
forwarded to the hooks. The only hook names are own data functions `loader`,
`adapter` and `meter`. Their function references and passed metadata are copied
or frozen. This interface does not sandbox malicious callback code.

For each unavailable control, the consumer branches before even inspecting a
hook object. It returns a small explicit no-source record with null descriptor,
no streams, zero loader/adapter/meter/counter calls, and no focal, parent, source
path, text, document or window. Available records alone take the three hook
routes. Hook return values are detached immutable metadata and are not emitted
as prepared source documents. Exceptions remain failed **available** cases;
they are neither replaced nor reclassified as unavailable controls.

The result separately reports all 69 terminal identities, successful available
routes, failed available identities, the two controls, and remaining identities.
Even a complete fictional routing result claims no prepared actual source or
counter calls. An available failure produces a HELD result while retaining all
69 terminal identities. Terminal accounting is distinct from successful source
preparation or quality clearance.

**B's original 32 MiB shared decoded-input limit and 32 MiB decoded/8 MiB encoded
case-output limits remain unchanged.** Metadata A's separate 80 MiB amendment
does not propagate here. Existing pure execution limits, reservation and prior
cost validation are retained; prior costs are declarations, not observations.
The synthetic oversized-case control uses a declared 32 MiB + 1 byte total and
tiny metadata markers: it does not allocate/decompress that source payload. It
retains the available case as a whole-case failure at the original limit.
Existing metadata already identifies selected available cases that exceed this
B input limit; availability alone does not establish B resource feasibility.

`fixtures.mjs` constructs only in-memory SOURCE_FREE documents, derived from the
earlier typed-roster fixture definitions without importing a test module.
`controls.test.mjs` covers exact roles/order/stream bindings, supplied-byte joins,
policy drift, forged plans and synthetic paths, control zero-access routing,
available failures, callback-state aliases, unchanged bounds and closed actual
entry. An exact own-source control checks the early unavailable branch without
touching any hook getters. No actual data, cache, raw source, process or model
is used by these controls.

This layer does **not** implement or satisfy the full owned fictional two-phase
B prerequisite. There is no typed loader, bootstrap/guardian integration,
resource/ownership observation, external exit readback, accounting checkpoint,
actual runtime-capability bridge, real counter connection or reader admission.
Observer lineage integration remains pending. Any separate inert lineage
diagnostic component in this folder is not attached to an observer by this layer.

`prepareActualTypedSources()` always rejects before inspecting arguments or
callbacks. All checkpoint, phase-B, actual IO, reading, tokenizer, quality and
adoption authority remains false or `NONE`. The prior HELD attempts and materiality
findings remain unchanged.
