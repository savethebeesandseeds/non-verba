// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Platform lifecycle/clock gates, independent of Android for deterministic host tests. */
internal object NativeSessionGuards {
    enum class Sensor(val label: String) { CAMERA("camera"), LOCATION_FIX("location-fix"), RAW_GNSS("raw-gnss"), LOCATION_FINALIZATION("location-finalization") }
    enum class Stage(val label: String) { SEAL_ENTRY("seal-entry"), SIGNING_AUTHORITY("signing-authority"), RESULT_DELIVERY("result-delivery") }
    data class FreshnessContext(val sensor: Sensor, val stage: Stage)

    fun requireAuthority(foreground: Boolean, closed: Boolean, current: Boolean, permission: Boolean) {
        check(foreground && !closed && current && permission) { "Native capture authority was revoked" }
    }

    fun elapsedMillis(anchorWallMs: Long, anchorNs: Long, wallMs: Long, monotonicNs: Long): Long {
        check(anchorWallMs >= 0 && wallMs >= 0 && anchorNs >= 0 && monotonicNs >= anchorNs) { "Native capture clock moved backwards" }
        val elapsed = (monotonicNs - anchorNs) / 1_000_000
        val skew = Math.subtractExact(Math.subtractExact(wallMs, anchorWallMs), elapsed)
        check(skew in -1000L..1000L) { "Native capture wall and monotonic clocks diverged" }
        return elapsed
    }

    fun requireFresh(elapsedMs: Long, sampleElapsedMs: Long, maximumAgeMs: Long, context: FreshnessContext? = null) {
        check(elapsedMs >= 0 && sampleElapsedMs >= 0 && maximumAgeMs >= 0 && sampleElapsedMs <= elapsedMs &&
            elapsedMs - sampleElapsedMs <= maximumAgeMs) {
            val prefix = "Native capture became stale before finalization or delivery"
            if (context == null) prefix else {
                val age = if (elapsedMs >= 0 && sampleElapsedMs >= 0) (elapsedMs - sampleElapsedMs).toString() else "unknown"
                val reason = if (elapsedMs < 0 || sampleElapsedMs < 0 || maximumAgeMs < 0) "invalid-bounds"
                    else if (sampleElapsedMs > elapsedMs) "future-sample" else "too-old"
                prefix + " (sensor=" + context.sensor.label + "; stage=" + context.stage.label +
                    "; age_ms=" + age + "; limit_ms=" + maximumAgeMs + "; reason=" + reason + "; unsigned timing)"
            }
        }
    }

    /** An explicit request policy separates fresh acquisition from bounded processing. */
    fun requireLocationFreshness(elapsedMs: Long, traceEndElapsedMs: Long, sampleElapsedMs: Long,
        maximumAgeMs: Long, maximumFinalizationDelayMs: Long?, context: FreshnessContext) {
        if (maximumFinalizationDelayMs == null) {
            requireFresh(elapsedMs, sampleElapsedMs, maximumAgeMs, context)
            return
        }
        check(maximumFinalizationDelayMs in 1L..30_000L) { "Invalid native location finalization delay policy" }
        requireFresh(traceEndElapsedMs, sampleElapsedMs, maximumAgeMs, context)
        requireFresh(elapsedMs, traceEndElapsedMs, maximumFinalizationDelayMs,
            FreshnessContext(Sensor.LOCATION_FINALIZATION, context.stage))
    }

    fun requireRequestWindow(nowMs: Long, issuedAtSecs: Long, expiresAtSecs: Long) {
        check(nowMs >= 0 && issuedAtSecs >= 0 && expiresAtSecs > issuedAtSecs &&
            nowMs / 1000 >= issuedAtSecs && nowMs / 1000 < expiresAtSecs) {
            "Native capture request is outside its validity window"
        }
    }

    /** Both the retained sample and the request must still authorize finalization. */
    fun requireFreshRequest(nowMs: Long, issuedAtSecs: Long, expiresAtSecs: Long,
        elapsedMs: Long, sampleElapsedMs: Long, maximumAgeMs: Long, context: FreshnessContext? = null) {
        requireRequestWindow(nowMs, issuedAtSecs, expiresAtSecs)
        requireFresh(elapsedMs, sampleElapsedMs, maximumAgeMs, context)
    }

    /** Retain the first authority failure when a JNI callback accepts only a Boolean. */
    class SigningAuthority(private val authorize: () -> Unit) {
        @Volatile private var failure: Throwable? = null
        @Synchronized fun active(): Boolean {
            if (failure != null) return false
            return try { authorize(); true } catch (error: Throwable) { failure = error; false }
        }
        fun <T> preservingFailure(operation: () -> T): T {
            try {
                val result = operation()
                failure?.let { throw it }
                return result
            } catch (error: Throwable) { throw failure ?: error }
        }
    }

    /** Fixed-size, unsigned relative durations. Never used as signing authority. */
    class PhaseTimings {
        enum class Mark { READY, FINALIZE_REQUEST, SEAL_ENTRY, SEAL_RETURNED, DELIVERY_CHECK }
        private val times = mutableMapOf<Mark, Long>()
        fun mark(mark: Mark, elapsedNs: Long) {
            if (elapsedNs >= 0 && !times.containsKey(mark)) times[mark] = elapsedNs
        }
        fun snapshot(): Map<String, Long> {
            val result = linkedMapOf<String, Long>()
            fun duration(name: String, from: Mark, to: Mark) {
                val start = times[from] ?: return
                val end = times[to] ?: return
                if (end >= start) result[name] = (end - start) / 1_000_000
            }
            duration("ready_to_finalize_request_ms", Mark.READY, Mark.FINALIZE_REQUEST)
            duration("finalize_request_to_seal_entry_ms", Mark.FINALIZE_REQUEST, Mark.SEAL_ENTRY)
            duration("ready_to_seal_entry_ms", Mark.READY, Mark.SEAL_ENTRY)
            duration("seal_call_ms", Mark.SEAL_ENTRY, Mark.SEAL_RETURNED)
            duration("ready_to_delivery_check_ms", Mark.READY, Mark.DELIVERY_CHECK)
            return result
        }
    }

    /** Authorization is checked after acquiring the key lock, and after signing. */
    fun <T> withSigningAuthority(keyLock: Any, active: () -> Boolean, sign: () -> T): T = synchronized(keyLock) {
        check(active()) { "Native signing authority was revoked while waiting for the key" }
        val signature = sign()
        check(active()) { "Native signing authority was revoked during signing" }
        signature
    }
}
