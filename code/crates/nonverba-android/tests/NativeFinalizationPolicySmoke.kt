// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Signed policy changes processing time only; acquisition clocks are unchanged. */
fun main() {
    var passed = 0
    fun failure(action: () -> Unit): String = runCatching(action).exceptionOrNull()?.message ?: error("Expected rejection")
    for (stage in NativeSessionGuards.Stage.entries) {
        for (sensor in listOf(NativeSessionGuards.Sensor.LOCATION_FIX, NativeSessionGuards.Sensor.RAW_GNSS)) {
            val context = NativeSessionGuards.FreshnessContext(sensor, stage)
            fun checkFresh(now: Long, end: Long = 11000, fix: Long = 11000, delay: Long? = 30000) =
                NativeSessionGuards.requireLocationFreshness(now, end, fix, 5000, delay, context)
            // The physically observed 7.4-second sealing delay is authorized only by the new policy.
            checkFresh(18400); passed++
            check(failure { checkFresh(18400, delay = null) }.contains("sensor=" + sensor.label)); passed++
            checkFresh(16000, delay = null); passed++
            check(failure { checkFresh(16001, delay = null) }.contains("age_ms=5001")); passed++
            // Absent policy must not introduce a dependency on the frozen end field.
            checkFresh(16000, end = Long.MAX_VALUE, delay = null); passed++
            checkFresh(41000); passed++
            val late = failure { checkFresh(41001) }
            check(late.contains("sensor=location-finalization") && late.contains("stage=" + stage.label)
                && late.contains("age_ms=30001") && late.contains("limit_ms=30000")); passed++
            checkFresh(11000, fix = 6000); passed++
            check(failure { checkFresh(11000, fix = 5999) }.contains("sensor=" + sensor.label)); passed++
            check(failure { checkFresh(11000, fix = 11001) }.contains("future-sample")); passed++
            check(failure { checkFresh(10999) }.contains("sensor=location-finalization")); passed++
            for (invalid in listOf(-1L, 0L, 30001L, Long.MAX_VALUE)) {
                check(failure { checkFresh(11000, delay = invalid) } == "Invalid native location finalization delay policy"); passed++
            }
            checkFresh(11001, delay = 1); passed++
            check(failure { checkFresh(11002, delay = 1) }.contains("limit_ms=1")); passed++
        }
    }
    // Ordinary and raw epochs remain independently fresh at the original frozen end.
    val ordinary = NativeSessionGuards.FreshnessContext(NativeSessionGuards.Sensor.LOCATION_FIX, NativeSessionGuards.Stage.SIGNING_AUTHORITY)
    val raw = NativeSessionGuards.FreshnessContext(NativeSessionGuards.Sensor.RAW_GNSS, NativeSessionGuards.Stage.SIGNING_AUTHORITY)
    NativeSessionGuards.requireLocationFreshness(20000, 11000, 11000, 5000, 30000, ordinary); passed++
    check(failure { NativeSessionGuards.requireLocationFreshness(20000, 11000, 5999, 5000, 30000, raw) }.contains("sensor=raw-gnss")); passed++
    // The processing allowance cannot extend the request or repair divergent clocks.
    check(failure {
        NativeSessionGuards.requireRequestWindow(20000, 1, 20)
        NativeSessionGuards.requireLocationFreshness(20000, 11000, 11000, 5000, 30000, ordinary)
    } == "Native capture request is outside its validity window"); passed++
    check(failure {
        val elapsed = NativeSessionGuards.elapsedMillis(1000, 1000000, 23001, 21001000000)
        NativeSessionGuards.requireLocationFreshness(elapsed, 11000, 11000, 5000, 30000, ordinary)
    } == "Native capture wall and monotonic clocks diverged"); passed++
    println("Native finalization policy: $passed checks passed (synthetic clocks; no device evidence)")
}
