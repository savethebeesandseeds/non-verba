// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Actual guards, Boolean key gate and unsigned phase recorder; deterministic inputs only. */
fun main() {
    var passed = 0
    val prefix = "Native capture became stale before finalization or delivery"
    fun failure(action: () -> Unit): Throwable = runCatching(action).exceptionOrNull()
        ?: error("Expected rejection")
    fun context(sensor: NativeSessionGuards.Sensor, stage: NativeSessionGuards.Stage) =
        NativeSessionGuards.FreshnessContext(sensor, stage)
    for (sensor in NativeSessionGuards.Sensor.entries) for (stage in NativeSessionGuards.Stage.entries) {
        val ctx = context(sensor, stage)
        val limit = if (sensor == NativeSessionGuards.Sensor.CAMERA) 30000L else 5000L
        NativeSessionGuards.requireFresh(1000 + limit, 1000, limit, ctx); passed++
        val error = failure { NativeSessionGuards.requireFresh(1001 + limit, 1000, limit, ctx) }
        check(error.message == prefix + " (sensor=" + sensor.label + "; stage=" + stage.label +
            "; age_ms=" + (limit + 1) + "; limit_ms=" + limit + "; reason=too-old; unsigned timing)"); passed++
        check(error.message!!.length < 400); passed++
    }
    // Exhaustively compare the unchanged predicate with contextual and legacy paths.
    val ctx = context(NativeSessionGuards.Sensor.LOCATION_FIX, NativeSessionGuards.Stage.SEAL_ENTRY)
    for (elapsed in listOf(-1L, 0L, 1L, 4999L, 5000L, 5001L, 30001L, Long.MAX_VALUE))
        for (sample in listOf(-1L, 0L, 1L, 5000L, Long.MAX_VALUE))
            for (limit in listOf(-1L, 0L, 5000L, 30000L, Long.MAX_VALUE)) {
                val expected = elapsed >= 0 && sample >= 0 && limit >= 0 && sample <= elapsed && elapsed - sample <= limit
                check(runCatching { NativeSessionGuards.requireFresh(elapsed, sample, limit, ctx) }.isSuccess == expected)
                check(runCatching { NativeSessionGuards.requireFresh(elapsed, sample, limit) }.isSuccess == expected)
                passed++
            }
    check(failure { NativeSessionGuards.requireFresh(5001, 0, 5000) }.message == prefix); passed++
    val future = failure { NativeSessionGuards.requireFresh(999, 1000, 5000, ctx) }.message!!
    check(future.contains("age_ms=-1") && future.contains("reason=future-sample")); passed++
    val invalid = failure { NativeSessionGuards.requireFresh(-1, 1000, 5000, ctx) }.message!!
    check(invalid.contains("age_ms=unknown") && invalid.contains("reason=invalid-bounds")); passed++
    val expired = failure { NativeSessionGuards.requireFreshRequest(2000, 1, 2, 5001, 0, 5000, ctx) }
    check(expired.message == "Native capture request is outside its validity window"); passed++

    val keyLock = Any()
    fun opaqueJni(action: () -> Unit) { try { action() } catch (_: Throwable) { error("Opaque JNI signing failure") } }
    for (failAfterSigning in listOf(false, true)) {
        var age = if (failAfterSigning) 5000L else 5001L
        var signed = 0
        var original: Throwable? = null
        val authority = NativeSessionGuards.SigningAuthority {
            try { NativeSessionGuards.requireFresh(age, 0, 5000,
                context(NativeSessionGuards.Sensor.LOCATION_FIX, NativeSessionGuards.Stage.SIGNING_AUTHORITY)) }
            catch (error: Throwable) { original = error; throw error }
        }
        val error = failure {
            authority.preservingFailure {
                opaqueJni {
                    NativeSessionGuards.withSigningAuthority(keyLock, authority::active) { signed++; age = 5001 }
                }
            }
        }
        check(error === original && error.message!!.contains("stage=signing-authority")); passed++
        check(signed == if (failAfterSigning) 1 else 0); passed++
        // No later clock/key state can revive an already failed signing attempt.
        age = 0
        check(!authority.active()); passed++
        check(failure { authority.preservingFailure { Unit } } === original); passed++
    }
    var checks = 0
    val validAuthority = NativeSessionGuards.SigningAuthority { checks++ }
    val result = validAuthority.preservingFailure {
        NativeSessionGuards.withSigningAuthority(keyLock, validAuthority::active) { "signed" }
    }
    check(result == "signed" && checks == 2); passed++
    val codecError = IllegalArgumentException("Unrelated encoding failure")
    check(failure { validAuthority.preservingFailure { throw codecError } } === codecError); passed++

    val timing = NativeSessionGuards.PhaseTimings()
    check(timing.snapshot().isEmpty()); passed++
    timing.mark(NativeSessionGuards.PhaseTimings.Mark.READY, 10_000_000_000)
    timing.mark(NativeSessionGuards.PhaseTimings.Mark.FINALIZE_REQUEST, 10_600_000_000)
    timing.mark(NativeSessionGuards.PhaseTimings.Mark.SEAL_ENTRY, 10_800_000_000)
    timing.mark(NativeSessionGuards.PhaseTimings.Mark.SEAL_RETURNED, 11_123_999_999)
    timing.mark(NativeSessionGuards.PhaseTimings.Mark.DELIVERY_CHECK, 11_124_000_000)
    val expected = mapOf("ready_to_finalize_request_ms" to 600L, "finalize_request_to_seal_entry_ms" to 200L,
        "ready_to_seal_entry_ms" to 800L, "seal_call_ms" to 323L, "ready_to_delivery_check_ms" to 1124L)
    check(timing.snapshot() == expected); passed++
    timing.mark(NativeSessionGuards.PhaseTimings.Mark.SEAL_ENTRY, 20_000_000_000)
    timing.mark(NativeSessionGuards.PhaseTimings.Mark.READY, -1)
    check(timing.snapshot() == expected); passed++
    val independent = timing.snapshot().toMutableMap(); independent["private-extra"] = 1
    check(timing.snapshot() == expected); passed++
    val reversed = NativeSessionGuards.PhaseTimings()
    reversed.mark(NativeSessionGuards.PhaseTimings.Mark.READY, 100); reversed.mark(NativeSessionGuards.PhaseTimings.Mark.SEAL_ENTRY, 99)
    check(reversed.snapshot().isEmpty()); passed++
    val bounded = NativeSessionGuards.PhaseTimings()
    bounded.mark(NativeSessionGuards.PhaseTimings.Mark.SEAL_ENTRY, 0); bounded.mark(NativeSessionGuards.PhaseTimings.Mark.SEAL_RETURNED, Long.MAX_VALUE)
    check(bounded.snapshot().values.single() <= 9_007_199_254_740_991L); passed++
    println("Native finalization diagnostics: $passed checks passed (synthetic clocks/signing adapter, no device evidence)")
}
