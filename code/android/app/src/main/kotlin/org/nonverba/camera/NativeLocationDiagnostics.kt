// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Local status only: these observations do not change evidence admission or its signed schema. */
internal object NativeLocationDiagnostics {
    data class Timing(val fixElapsedMs: Long, val observedElapsedMs: Long, val fixWallMs: Long)

    enum class RawRegistration(val label: String) {
        NOT_ATTEMPTED("not-attempted"), ATTEMPTING("attempting"), REGISTERED("registered"), REFUSED("refused"), EXCEPTION("exception")
    }
    enum class RawBranch(val label: String) { COMPAT_HANDLER("androidx-compat-handler"), FULL_TRACKING("api31-full-tracking") }
    enum class RawStatus(val label: String) {
        READY("ready"), NOT_SUPPORTED("not-supported"), LOCATION_DISABLED("location-disabled"), NOT_ALLOWED("not-allowed"), UNKNOWN("unknown")
    }
    enum class RawWarmup(val label: String) {
        MISSING_ELAPSED("missing-elapsed-realtime"), MISSING_UNCERTAINTY("missing-elapsed-uncertainty"),
        MISSING_FULL_BIAS("missing-full-bias"), EMPTY_SIGNALS("empty-signals"), INSUFFICIENT_SATELLITES("insufficient-qualifying-satellites")
    }
    data class RawSnapshot(
        val registration: RawRegistration, val branch: RawBranch?, val receiverStatus: RawStatus?, val receiverStatusCode: Int?,
        val callbackCount: Int, val lastCallbackElapsedMs: Long?, val cadenceSkipped: Int,
        val warmupReasons: Map<RawWarmup, Int>, val osHasMeasurements: Boolean?, val osHardwareYear: Int?, val osHardwareModel: String?
    )

    /** Session-local and unsigned. Counters are bounded; no receiver absence becomes a capability claim. */
    class Raw {
        private var registration = RawRegistration.NOT_ATTEMPTED
        private var branch: RawBranch? = null
        private var receiverStatus: RawStatus? = null
        private var receiverStatusCode: Int? = null
        private var callbackCount = 0
        private var lastCallbackElapsedMs: Long? = null
        private var cadenceSkipped = 0
        private val warmupReasons = mutableMapOf<RawWarmup, Int>()
        private var osHasMeasurements: Boolean? = null
        private var osHardwareYear: Int? = null
        private var osHardwareModel: String? = null

        @Synchronized fun registrationAttempt(api: RawBranch) { branch = api; registration = RawRegistration.ATTEMPTING }
        @Synchronized fun registrationResult(registered: Boolean) {
            registration = if (registered) RawRegistration.REGISTERED else RawRegistration.REFUSED
        }
        @Synchronized fun registrationException() { registration = RawRegistration.EXCEPTION }
        @Synchronized fun status(value: RawStatus, code: Int) { receiverStatus = value; receiverStatusCode = code }
        @Synchronized fun callback(observedElapsedMs: Long) {
            callbackCount = increment(callbackCount)
            lastCallbackElapsedMs = observedElapsedMs.takeIf { it >= 0 }
        }
        @Synchronized fun skippedCadence() { cadenceSkipped = increment(cadenceSkipped) }
        @Synchronized fun warmup(reason: RawWarmup) { warmupReasons[reason] = increment(warmupReasons[reason] ?: 0) }
        @Synchronized fun osReport(hasMeasurements: Boolean?, hardwareYear: Int?, hardwareModel: String?) {
            osHasMeasurements = hasMeasurements
            // Android reports zero for a pre-2016/unspecified year; preserve that literal report.
            osHardwareYear = hardwareYear?.takeIf { it == 0 || it in 2016..9999 }
            osHardwareModel = hardwareModel?.takeIf { it.length in 1..120 && it.all { character -> character in ' '..'~' } }
        }
        @Synchronized fun snapshot() = RawSnapshot(registration, branch, receiverStatus, receiverStatusCode,
            callbackCount, lastCallbackElapsedMs, cadenceSkipped, warmupReasons.toMap(), osHasMeasurements, osHardwareYear, osHardwareModel)
        private fun increment(value: Int) = if (value < MAX_RAW_DIAGNOSTIC_COUNT) value + 1 else value
    }
    const val MAX_RAW_DIAGNOSTIC_COUNT = 1_000_000

    // Android 11 maps unavailable/unsupported AND internal receiver startup errors
    // to STATUS_NOT_SUPPORTED (0). Preserve the OS code without claiming a cause.
    fun rawStatusFailure(code: Int): String? = when (code) {
        0 -> "Android could not provide raw GNSS measurements (status 0: unsupported, unavailable, or receiver startup failed); cause is unknown"
        1 -> null
        2 -> "Location services were disabled during raw GNSS collection"
        3 -> "Raw GNSS measurement access was denied"
        else -> "Unknown raw GNSS receiver status ($code)"
    }

    fun spanMs(first: Timing, last: Timing): Long {
        fun span(start: Long, end: Long) = if (start < 0 || end < start) 0L else end - start
        return minOf(span(first.fixElapsedMs, last.fixElapsedMs),
            span(first.observedElapsedMs, last.observedElapsedMs), span(first.fixWallMs, last.fixWallMs))
    }

    fun timeoutReason(stage: String, eligible: Int, rejected: Int, minimumSamples: Int,
        spanMs: Long, requiredSpanMs: Long, rawRequired: Boolean, rawCallbacks: Int? = null): String = when {
        stage == "requesting-permission" -> "Location session timed out while waiting for precise location permission"
        stage == "ready" -> "Location evidence was ready but was not finalized before the session timed out"
        stage != "collecting" -> "Native location session timed out; request a new session"
        rawRequired && rawCallbacks == 0 && rejected > 0 ->
            "GPS position updates arrived, but Android delivered no raw GNSS measurements before the session timed out"
        rawRequired && rawCallbacks == 0 ->
            "No raw GNSS measurements arrived before the session timed out"
        eligible == 0 && rejected == 0 -> "No native location callbacks arrived before the session timed out"
        eligible == 0 -> "Native location callbacks arrived, but no updates met the requested policy before timeout"
        eligible < minimumSamples -> "Location session timed out with insufficient eligible samples ($eligible of $minimumSamples)"
        spanMs < requiredSpanMs -> "Location session timed out with insufficient measured sample span ($spanMs of $requiredSpanMs ms)"
        rawRequired -> "Location sample window completed, but requested raw GNSS evidence was not ready before timeout"
        else -> "Native location collection did not become ready before the session timed out"
    }
}
