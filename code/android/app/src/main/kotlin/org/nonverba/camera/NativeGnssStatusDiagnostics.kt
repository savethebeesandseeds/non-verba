// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Bounded, unsigned receiver-status summaries. Never input to evidence admission or signing. */
internal class NativeGnssStatusDiagnostics {
    enum class Registration(val label: String) {
        NOT_ATTEMPTED("not-attempted"), ATTEMPTING("attempting"), REGISTERED("registered"), REFUSED("refused"), EXCEPTION("exception")
    }
    data class Satellite(val constellation: Int, val usedInFix: Boolean, val cn0DbHz: Double)
    data class Observation(val satelliteCount: Int, val usedInFixCount: Int, val cn0SampleCount: Int,
        val invalidCn0Count: Int, val cn0MinDbHz: Double?, val cn0MeanDbHz: Double?, val cn0MaxDbHz: Double?,
        val constellationCounts: Map<String, Int>)
    data class Snapshot(val registration: Registration, val active: Boolean, val callbackCount: Int,
        val lastCallbackElapsedMs: Long?, val unreadableCallbacks: Int, val cleanupFailed: Boolean,
        val observation: Observation?)

    private var registration = Registration.NOT_ATTEMPTED
    private var active = false
    private var callbackCount = 0
    private var lastCallbackElapsedMs: Long? = null
    private var unreadableCallbacks = 0
    private var cleanupFailed = false
    private var observation: Observation? = null

    @Synchronized fun registrationAttempt(): Boolean {
        if (registration != Registration.NOT_ATTEMPTED) return false
        registration = Registration.ATTEMPTING
        active = true
        return true
    }
    @Synchronized fun registrationResult(registered: Boolean) {
        registration = if (registered) Registration.REGISTERED else Registration.REFUSED
        if (!registered) active = false
    }
    @Synchronized fun registrationException() { registration = Registration.EXCEPTION; active = false }
    /** Count arrival before reading framework fields; clear older data rather than present it as current. */
    @Synchronized fun callback(observedElapsedMs: Long): Boolean {
        if (!active) return false
        callbackCount = increment(callbackCount)
        lastCallbackElapsedMs = observedElapsedMs.takeIf { it in 0..MAX_SAFE_ELAPSED_MS }
        observation = null
        return true
    }
    @Synchronized fun unreadableCallback() {
        if (!active) return
        observation = null
        unreadableCallbacks = increment(unreadableCallbacks)
    }
    @Synchronized fun observe(satellites: List<Satellite>) {
        if (!active || callbackCount == 0) return
        if (satellites.size > MAX_SATELLITES) { unreadableCallback(); return }
        val constellations = mutableMapOf<String, Int>()
        var used = 0
        var validCn0 = 0
        var totalCn0 = 0.0
        var minCn0: Double? = null
        var maxCn0: Double? = null
        for (satellite in satellites) {
            val constellation = when (satellite.constellation) {
                1 -> "gps"; 2 -> "sbas"; 3 -> "glonass"; 4 -> "qzss"; 5 -> "beidou"; 6 -> "galileo"; 7 -> "irnss"
                else -> "unknown"
            }
            constellations[constellation] = (constellations[constellation] ?: 0) + 1
            if (satellite.usedInFix) used++
            val cn0 = satellite.cn0DbHz
            // GnssStatusCompat documents antenna C/N0 in [0, 63] dB-Hz. Invalid values stay missing.
            if (cn0.isFinite() && cn0 in 0.0..63.0) {
                validCn0++
                totalCn0 += cn0
                minCn0 = minCn0?.let { minOf(it, cn0) } ?: cn0
                maxCn0 = maxCn0?.let { maxOf(it, cn0) } ?: cn0
            }
        }
        observation = Observation(satellites.size, used, validCn0, satellites.size - validCn0,
            minCn0, if (validCn0 > 0) totalCn0 / validCn0 else null, maxCn0, constellations.toMap())
    }
    @Synchronized fun stop() { active = false }
    @Synchronized fun cleanupFailure() { cleanupFailed = true }
    @Synchronized fun snapshot() = Snapshot(registration, active, callbackCount, lastCallbackElapsedMs,
        unreadableCallbacks, cleanupFailed, observation?.let { it.copy(constellationCounts = it.constellationCounts.toMap()) })

    private fun increment(value: Int) = if (value < MAX_CALLBACKS) value + 1 else value
    companion object {
        const val MAX_SATELLITES = 256
        const val MAX_CALLBACKS = 1_000_000
        const val MAX_SAFE_ELAPSED_MS = 9_007_199_254_740_991L
    }
}
