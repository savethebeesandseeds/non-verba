// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Pure policy for observations of one allocated Android input session. */
internal class NativeAudioRecordingGuard(private val sessionId: Int, private val deviceId: Int) {
    data class Format(val sampleRate: Int, val channels: Int, val encoding: String)
    data class Configuration(
        val sessionId: Int, val deviceId: Int, val builtIn: Boolean,
        val silenced: Boolean, val clientSource: Int, val source: Int,
        val clientFormat: Format, val deviceFormat: Format,
        val clientEffects: List<String>, val effects: List<String>
    )
    var baseline: Configuration? = null; private set
    var count = 0; private set
    var firstNs = 0L; private set
    var lastNs = 0L; private set
    private val observedNs = mutableListOf<Long>()
    val observationNs: List<Long> get() = observedNs.toList()
    private var ended = false
    private var failure: String? = null

    init { require(sessionId > 0 && deviceId > 0) }

    fun requireHealthy() { check(failure == null) { requireNotNull(failure) } }

    fun observe(configurations: List<Configuration>, nowNs: Long): Boolean {
        requireHealthy()
        try {
            val matching = configurations.filter { it.sessionId == sessionId }
            check(matching.size <= 1) { "Ambiguous microphone recording configuration" }
            if (matching.isEmpty()) {
                check(baseline == null || ended) { "Active microphone recording configuration disappeared" }
                return false
            }
            val value = matching.single()
            check(!value.silenced) { "Android silenced this microphone recording client" }
            check(value.deviceId == deviceId && value.builtIn) { "Active microphone recording route changed" }
            check(value.clientSource == 9 && value.source == 9) { "Active microphone source is not unprocessed" }
            check(value.clientEffects.isEmpty() && value.effects.isEmpty()) { "Android enabled microphone preprocessing" }
            check(value.clientFormat == Format(48000, 1, "pcm-f32")) { "Microphone client format differs from the AAudio contract" }
            check(value.deviceFormat.sampleRate in 8000..192000 && value.deviceFormat.channels in 1..32 &&
                value.deviceFormat.encoding in setOf("pcm-u8", "pcm-i16", "pcm-i24", "pcm-i32", "pcm-f32")) {
                "Actual microphone device format is unavailable or unsupported"
            }
            check(baseline == null || baseline == value) { "Active microphone recording configuration changed" }
            if (!ended) {
                check(nowNs > 0 && (lastNs == 0L || nowNs >= lastNs)) { "Microphone observation clock regressed" }
                check(lastNs == 0L || nowNs - lastNs <= 1_000_000_000L) { "Microphone configuration observation was interrupted" }
                check(count < 10000) { "Microphone configuration observation count exceeded its bound" }
                if (baseline == null) { baseline = value; firstNs = nowNs }
                lastNs = nowNs
                observedNs.add(nowNs)
                count++
            }
            return true
        } catch (error: IllegalStateException) {
            failure = error.message ?: "Microphone configuration observation failed"
            throw error
        }
    }

    fun finish(recordRequestedNs: Long, lastInputNs: Long) {
        requireHealthy()
        check(!ended && count >= 2 && firstNs <= recordRequestedNs && lastNs >= lastInputNs) {
            "Microphone configuration observations do not cover the retained recording"
        }
        ended = true
    }
}
