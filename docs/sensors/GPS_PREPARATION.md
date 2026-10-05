# GPS preparation and short raw observations

Foreground receiver preparation can move GPS acquisition ahead of an individual
request. It targets acquisition and observation delay; camera signing,
finalization and transport remain separate costs. An active receiver subscription
is not a verified fix or evidence that a later request will succeed.

## Preparation lifecycle

The Android adapter starts a separate GPS subscription on foreground entry to a
bundled camera or location page when precise location permission already exists
and GPS is enabled. Every preparation fix is discarded. The subscription uses
power and lasts at most five minutes; **Prepare GPS** or an actual GPS request can
renew it. **Stop GPS warm-up** stops preparation without cancelling an independent
evidence session.

Pause, navigation outside camera/location, destruction, permission loss and
provider loss stop preparation. Preparation does not prompt for permission, use
the microphone, retain coordinates or run a background service. Reading its
capabilities or status does not start it. See the
[native preparation adapter](../../code/android/app/src/main/kotlin/org/nonverba/camera/NativeGpsWarmup.kt)
and [foreground controls](../../web/src/gps-warmup.js).

Preparation may keep the receiver available between nearby requests. It cannot
guarantee reception, prevent Android or hardware from restarting the receiver, or
remove the need for fresh observations. A later request may still pay acquisition
latency after an idle period, loss of reception or foreground exit.

Each evidence request creates a fresh wall/monotonic anchor and retains its own
callbacks, receiver state and original deadline. Cached preparation fixes never
become challenge evidence. An eligible raw startup callback entirely before the
new anchor may be discarded before the first retained observation; it cannot be
relabelled or used to hide an interruption after collection begins. Signing and
verification still enforce the signed acquisition window.

## Short raw-request minimum

New camera and location requester forms require a **two-second minimum**, at
least **three distinct location fixes** and **three raw receiver epochs**. All
satellite, signal quality, uncertainty, cadence, continuity, freshness and
delivery checks still apply. Three nominal one-second epochs may not cover two
seconds after endpoint uncertainty is deducted; a fourth epoch may be needed.
Collection ends only when every requirement is satisfied. Startup and camera
shutter coordination add time beyond this observation minimum.

Two seconds is a minimum useful span, not a maximum completion time or a speed
promise. Request expiry, evidence age, delivery rules and bounded-session limits
remain separate constraints. Android collection retains its sixty-second total
budget, including acquisition and permission delay. Slow or unavailable receivers
must fail those explicit limits rather than provide fabricated observations.

This supplies a short continuity sample, not an accuracy guarantee or a long
motion trace. Explicit raw policies support 2–15 seconds; nonraw policies retain
their 5–15 second bounds. Low-level omitted policies, demos and reduced requester
profiles retain ten seconds. Old signed requests remain exact and cannot be
shortened in place. New live offers commit their raw duration explicitly; an
absent duration in an old offer retains the original ten seconds. See
[location policy and source boundaries](LOCATION.md#policy-and-source-boundaries).

## Position calculation and missing inputs

A code-based position solution uses simultaneous pseudoranges and satellite
positions; it does not intrinsically need a ten-second time series. See
[ESA's positioning equations](https://gssc.esa.int/navipedia/index.php/Code_Based_Positioning_%28SPS%29).
Non-verba's stricter solver requires at least six usable, identified GPS L1 C/A
satellites per epoch, acceptable geometry and residuals, and independently
supplied pinned navigation data. It solves each retained epoch and compares
every retained device fix.

The base raw consistency profile instead requires at least four qualifying,
distinct satellites per epoch. Passing that check alone does not establish that
position can be recomputed. Raw-field availability varies by receiver; see
[Android raw GNSS documentation](https://developer.android.com/develop/sensors-and-location/sensors/gnss).
Waiting longer or lowering the requested duration cannot supply a missing signal
code or required clock field. Independent recomputation and hardware enrollment
remain explicit additional policies, and missing inputs fail. Valid signatures
and freshness checks do not prove physical location or authentic satellite radio
signals. See the [position profile](../../code/crates/nonverba-core/src/location_proof/position/README.md)
and [location assurance limits](LOCATION.md#what-verification-establishes).

## Validation and timing

Software coverage includes short signed proofs, exact original-request binding,
insufficient counts and spans, conservative uncertainty coverage, position
calculation against a pinned synthetic reference, preparation lifecycle and
legacy/new live agreements. These checks do not establish phone compatibility,
a measured speedup or physical acceptance. The
[sensor validation guide](VALIDATION.md) and
[current development validation](../development/VALIDATION.md) state their scope.

Counterfactual evaluation of a prefix from an older trace changes policy only in
a working copy. It does not create a valid signature for an altered request,
renew freshness or measure preparation savings. Actual device timings need to
separate preparation, first retained fix/raw epoch, evidence completion and
finalization. UI and USB transport waits are not GPS acquisition latency.

The dated [4 October checks](VALIDATION.md#gps-startup-and-reporting-validation--4-october-2026)
include independently verified signed collection durations after receiver
recovery. They do not establish preparation savings or a completion guarantee.
Active preparation does not guarantee usable reception, and a failed attempt
does not identify weather, effort or fault. Native raw-GNSS rejections,
zero-callback timeouts and covered startup refusals can produce separate
[signed GPS attempt reports](GPS_ATTEMPT_REPORTS.md); these describe failure,
never a successful measurement. The dated [sensor status](STATUS.md) separates
completed physical verification from remaining limits.
