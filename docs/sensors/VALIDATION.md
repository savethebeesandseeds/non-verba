# Sensor validation boundaries

The source tree includes Rust unit/integration tests, JavaScript adapter and
workflow tests, real WASM tests, browser tests and native Android guard checks.
Their presence is not a claim that all checks passed in this checkout. The
[unification validation record](../development/VALIDATION.md) records the checks
actually executed, including failures or environmental limits.

Run project builds and checks through the managed Debian environment described
in [the container guide](../development/CONTAINER_PLAN.md). Toolchains, Java and
dependency caches stay inside the managed container and its named volumes.

Software validation should cover request equality, independently supplied trust,
strict policy failure, challenge reservation, expiry, cancellation, signing gates,
artifact binding, requester receipt and local duplicate acceptance. Test fixtures
are synthetic inputs; accepting one does not establish physical sensor truth.

Native session guards are tested by the suites in
[`code/crates/nonverba-android/tests`](../../code/crates/nonverba-android/tests).
Browser and adapter suites are under [`code/test`](../../code/test), and the core
Rust tests remain alongside their modules in
[`nonverba-core`](../../code/crates/nonverba-core).

## Physical acceptance

Physical acceptance remains partial. A clean build, browser simulation, JNI test
or software attestation fixture does not demonstrate Camera2 exposure behavior,
AAudio recording support, actual raw-GNSS delivery, Keystore behavior, device
latency or resistance to a compromised sensor stack. Use a fresh physical request
and the [acceptance checklist](DEVICE_ACCEPTANCE.md) for those observations.

Earlier local device captures, review logs, QA outputs and binary releases are
preserved outside this public source import. Technical documents may describe
their historical conclusions, but the original private records are not provided
as public evidence here. No physical sensor run is claimed by this documentation
or by the folder reorganization.
