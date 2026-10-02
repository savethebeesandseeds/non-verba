// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Local progress summaries only, with no fabricated sensor input or Android dependency. */
fun main() {
    var passed = 0
    fun equal(actual: Any?, expected: Any?) { check(actual == expected) { "$actual != $expected" }; passed++ }
    val first = NativeLocationDiagnostics.Timing(1000, 1100, 1_900_000_001_000)
    fun last(fix: Long, observed: Long, wallDelta: Long) =
        NativeLocationDiagnostics.Timing(1000 + fix, 1100 + observed, 1_900_000_001_000 + wallDelta)
    equal(NativeLocationDiagnostics.spanMs(first, first), 0L)
    equal(NativeLocationDiagnostics.spanMs(first, last(10000, 10001, 10002)), 10000L)
    equal(NativeLocationDiagnostics.spanMs(first, last(10002, 10000, 10001)), 10000L)
    equal(NativeLocationDiagnostics.spanMs(first, last(10002, 10001, 10000)), 10000L)
    equal(NativeLocationDiagnostics.spanMs(first, last(-1, 10000, 10000)), 0L)
    equal(NativeLocationDiagnostics.spanMs(first, last(10000, -1, 10000)), 0L)
    equal(NativeLocationDiagnostics.spanMs(first, last(10000, 10000, -1)), 0L)
    equal(NativeLocationDiagnostics.spanMs(NativeLocationDiagnostics.Timing(-1, 0, 0),
        NativeLocationDiagnostics.Timing(Long.MAX_VALUE, Long.MAX_VALUE, Long.MAX_VALUE)), 0L)
    fun reason(stage: String = "collecting", eligible: Int = 0, rejected: Int = 0,
        span: Long = 0, raw: Boolean = false) = NativeLocationDiagnostics.timeoutReason(stage,
        eligible, rejected, 3, span, 10000, raw)
    equal(reason(stage = "requesting-permission"),
        "Location session timed out while waiting for precise location permission")
    equal(reason(stage = "ready", eligible = 3, span = 10000),
        "Location evidence was ready but was not finalized before the session timed out")
    equal(reason(), "No native location callbacks arrived before the session timed out")
    equal(reason(rejected = 12),
        "Native location callbacks arrived, but no updates met the requested policy before timeout")
    equal(reason(eligible = 2, span = 10000),
        "Location session timed out with insufficient eligible samples (2 of 3)")
    equal(reason(eligible = 3, span = 9999),
        "Location session timed out with insufficient measured sample span (9999 of 10000 ms)")
    equal(reason(eligible = 3, span = 10000, raw = true),
        "Location sample window completed, but requested raw GNSS evidence was not ready before timeout")
    equal(reason(eligible = 3, span = 10000),
        "Native location collection did not become ready before the session timed out")
    val raw = NativeLocationDiagnostics.Raw()
    equal(raw.snapshot().registration, NativeLocationDiagnostics.RawRegistration.NOT_ATTEMPTED)
    equal(raw.snapshot().receiverStatus, null)
    equal(raw.snapshot().callbackCount, 0)
    equal(raw.snapshot().osHasMeasurements, null)
    raw.registrationAttempt(NativeLocationDiagnostics.RawBranch.COMPAT_HANDLER)
    equal(raw.snapshot().registration, NativeLocationDiagnostics.RawRegistration.ATTEMPTING)
    raw.registrationResult(true)
    equal(raw.snapshot().registration, NativeLocationDiagnostics.RawRegistration.REGISTERED)
    equal(raw.snapshot().branch, NativeLocationDiagnostics.RawBranch.COMPAT_HANDLER)
    // Registration success alone must not manufacture callbacks or a support report.
    equal(raw.snapshot().callbackCount, 0)
    equal(raw.snapshot().receiverStatus, null)
    equal(raw.snapshot().osHasMeasurements, null)
    raw.callback(1200)
    raw.warmup(NativeLocationDiagnostics.RawWarmup.MISSING_FULL_BIAS)
    raw.warmup(NativeLocationDiagnostics.RawWarmup.MISSING_UNCERTAINTY)
    raw.callback(1300)
    raw.skippedCadence()
    raw.status(NativeLocationDiagnostics.RawStatus.UNKNOWN, 127)
    raw.osReport(false, 0, "GNSS model")
    val retained = raw.snapshot()
    equal(retained.callbackCount, 2)
    equal(retained.lastCallbackElapsedMs, 1300L)
    equal(retained.cadenceSkipped, 1)
    equal(retained.receiverStatusCode, 127)
    equal(retained.osHasMeasurements, false)
    equal(retained.osHardwareYear, 0)
    raw.warmup(NativeLocationDiagnostics.RawWarmup.MISSING_FULL_BIAS)
    equal(retained.warmupReasons[NativeLocationDiagnostics.RawWarmup.MISSING_FULL_BIAS], 1)
    equal(raw.snapshot().warmupReasons[NativeLocationDiagnostics.RawWarmup.MISSING_FULL_BIAS], 2)
    raw.osReport(null, 2015, "unsafe\nmodel")
    equal(raw.snapshot().osHardwareYear, null)
    equal(raw.snapshot().osHardwareModel, null)
    raw.registrationResult(false)
    equal(raw.snapshot().registration, NativeLocationDiagnostics.RawRegistration.REFUSED)
    raw.registrationException()
    equal(raw.snapshot().registration, NativeLocationDiagnostics.RawRegistration.EXCEPTION)
    raw.callback(-1)
    equal(raw.snapshot().lastCallbackElapsedMs, null)
    repeat(NativeLocationDiagnostics.MAX_RAW_DIAGNOSTIC_COUNT + 2) { raw.callback(2000) }
    equal(raw.snapshot().callbackCount, NativeLocationDiagnostics.MAX_RAW_DIAGNOSTIC_COUNT)
    println("Native location diagnostic checks passed: $passed (pure summaries; no Android or RF cause claim)")
}
