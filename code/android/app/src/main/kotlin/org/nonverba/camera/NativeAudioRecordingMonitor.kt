// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecordingConfiguration
import android.os.Build
import android.os.Handler
import androidx.annotation.RequiresApi
import org.json.JSONArray
import org.json.JSONObject

/** Android observations, deliberately separate from capture buffers and signing. */
internal class NativeAudioRecordingMonitor(
    private val audio: AudioManager,
    private val handler: Handler,
    val inputSessionId: Int,
    deviceId: Int,
    private val onFailure: (String) -> Unit
) {
    private val lock = Any()
    private val guard = NativeAudioRecordingGuard(inputSessionId, deviceId)
    private val closed: Boolean get() = cleanup.revoked
    private var failure: String? = null
    private var diagnosticConfiguration: JSONObject? = null
    private var fence: NativeAudioObservationFence? = null
    private val callback = object : AudioManager.AudioRecordingCallback() {
        override fun onRecordingConfigChanged(configs: MutableList<AudioRecordingConfiguration>) {
            val error = synchronized(lock) {
                if (closed || failure != null) return
                try {
                    if (Build.VERSION.SDK_INT < 29) error("Microphone observation is unavailable")
                    observe(configs); null
                } catch (error: Throwable) {
                    (error.message ?: "Microphone configuration callback failed").also { failure = it }
                }
            }
            if (error != null) onFailure(error)
        }
    }
    private val cleanup = NativeAudioCallbackCleanup(
        revoke = { fence?.cancel() },
        unregister = { audio.unregisterAudioRecordingCallback(callback) }
    )

    init {
        check(Build.VERSION.SDK_INT >= 29) { "Microphone configuration observation requires Android API29" }
        audio.registerAudioRecordingCallback(callback, handler)
    }

    fun poll(): Boolean = synchronized(lock) {
        requireHealthy()
        if (Build.VERSION.SDK_INT < 29) error("Microphone observation is unavailable")
        observe(audio.activeRecordingConfigurations)
    }

    fun requireHealthy() = synchronized(lock) {
        check(!closed) { "Microphone recording configuration monitor is closed" }
        check(failure == null) { requireNotNull(failure) }
        guard.requireHealthy()
    }

    fun finish(device: JSONObject): JSONObject = synchronized(lock) {
        check(poll()) { "Active microphone recording configuration is unavailable" }
        check(device.getInt("input_session_id") == inputSessionId) { "AAudio input session identity changed" }
        val supported = device.getBoolean("privacy_sensitive_supported")
        val requested = device.getBoolean("privacy_sensitive_requested")
        check(supported == (Build.VERSION.SDK_INT >= 30) && requested == supported) { "AAudio privacy-sensitive request differs from API support" }
        check(if (supported) device.getBoolean("privacy_sensitive_actual") else device.isNull("privacy_sensitive_actual")) {
            "AAudio privacy-sensitive input could not be confirmed"
        }
        guard.finish(device.getString("record_requested_monotonic_ns").toLong(), device.getString("last_input_callback_monotonic_ns").toLong())
        val baseline = requireNotNull(guard.baseline)
        JSONObject().put("version", 1).put("api_level", Build.VERSION.SDK_INT)
            .put("input_session_id", inputSessionId).put("client_silenced", baseline.silenced)
            .put("client_source", "unprocessed").put("source", "unprocessed").put("device_id", baseline.deviceId)
            .put("client_format", formatJson(baseline.clientFormat)).put("device_format", formatJson(baseline.deviceFormat))
            .put("client_effects", JSONArray(baseline.clientEffects)).put("effects", JSONArray(baseline.effects))
            .put("observation_count", guard.count).put("first_observed_monotonic_ns", guard.firstNs.toString())
            .put("last_observed_monotonic_ns", guard.lastNs.toString())
            .put("observation_monotonic_ns", JSONArray(guard.observationNs.map { it.toString() }))
            .put("privacy_sensitive_supported", supported).put("privacy_sensitive_requested", requested)
            .put("privacy_sensitive_actual", device.get("privacy_sensitive_actual"))
    }

    /** Call outside NativeAudio's lock; completion returns asynchronously. */
    fun afterQueuedObservations(completion: Handler, settled: (String?) -> Unit) {
        val pending = synchronized(lock) {
            requireHealthy()
            check(fence == null) { "Microphone observation fence already exists" }
            NativeAudioObservationFence(
                postObservation = { handler.post(it) },
                postCompletion = { completion.post(it) },
                postTimeout = { task, delay -> completion.postDelayed(task, delay) },
                removeTimeout = { completion.removeCallbacks(it) },
                requireHealthy = { requireHealthy() },
                complete = settled
            ).also { fence = it }
        }
        pending.start()
    }

    fun close() = synchronized(lock) { cleanup.close() }

    /** Bounded unsigned values; remains readable after a refused observation. */
    fun diagnostics(): JSONObject? = synchronized(lock) {
        diagnosticConfiguration?.let { JSONObject(it.toString()) }
    }

    @RequiresApi(29)
    private fun observe(configs: List<AudioRecordingConfiguration>): Boolean {
        guard.requireHealthy() // A later clean callback cannot replace refused diagnostics.
        // Public Android callbacks redact application identity, but retain the
        // session ID. Never attribute another application's recording to ours.
        val matching = configs.filter { it.clientAudioSessionId == inputSessionId }
        if (matching.size == 1) {
            val config = matching.single()
            val device = config.audioDevice
            diagnosticConfiguration = JSONObject().put("input_session_id", inputSessionId)
                .put("observed_monotonic_ns", System.nanoTime().toString())
                .put("device_id", device?.id ?: 0).put("built_in", device?.type == AudioDeviceInfo.TYPE_BUILTIN_MIC)
                .put("client_silenced", config.isClientSilenced)
                .put("client_source", config.clientAudioSource).put("source", config.audioSource)
                .put("client_format", diagnosticFormat(config.clientFormat)).put("device_format", diagnosticFormat(config.format))
                .put("client_effect_count", config.clientEffects.size).put("effect_count", config.effects.size)
        }
        val values = matching.map { config ->
            val device = config.audioDevice
            NativeAudioRecordingGuard.Configuration(config.clientAudioSessionId, device?.id ?: 0,
                device?.type == AudioDeviceInfo.TYPE_BUILTIN_MIC, config.isClientSilenced,
                config.clientAudioSource, config.audioSource, format(config.clientFormat), format(config.format),
                config.clientEffects.map { it.uuid.toString() }.sorted(), config.effects.map { it.uuid.toString() }.sorted())
        }
        return guard.observe(values, System.nanoTime())
    }

    private fun format(value: AudioFormat) = NativeAudioRecordingGuard.Format(value.sampleRate, value.channelCount,
        when (value.encoding) {
            AudioFormat.ENCODING_PCM_8BIT -> "pcm-u8"
            AudioFormat.ENCODING_PCM_16BIT -> "pcm-i16"
            AudioFormat.ENCODING_PCM_FLOAT -> "pcm-f32"
            AudioFormat.ENCODING_PCM_24BIT_PACKED -> "pcm-i24" // Inlined constants; no API31 method linkage.
            AudioFormat.ENCODING_PCM_32BIT -> "pcm-i32"
            else -> "unsupported"
        })
    private fun formatJson(value: NativeAudioRecordingGuard.Format) = JSONObject()
        .put("sample_rate", value.sampleRate).put("channels", value.channels).put("encoding", value.encoding)
    private fun diagnosticFormat(value: AudioFormat) = formatJson(format(value))
        .put("android_encoding", value.encoding).put("channel_mask", value.channelMask)
        .put("channel_index_mask", value.channelIndexMask)
}
