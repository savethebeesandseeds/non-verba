// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.AtomicFile
import android.util.Base64
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * Foreground microphone/speaker acquisition. The WebView supplies only original
 * requests, successive requester nonces and the final requester receipt. AAudio
 * owns capture buffers; Rust owns acoustic codes, receipt validation and C2PA.
 */
internal class NativeAudio(
    private val activity: Activity,
    private val isForeground: () -> Boolean,
    private val requestMicrophonePermission: ((Boolean) -> Unit) -> Unit
) {
    private val lock = Any()
    private val main = Handler(Looper.getMainLooper())
    private val thread = HandlerThread("nonverba-native-audio").apply { start() }
    private val worker = Handler(thread.looper)
    private val observationThread = HandlerThread("nonverba-audio-configuration").apply { start() }
    private val observations = Handler(observationThread.looper)
    private val audio = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val ledger = AtomicFile(File(activity.noBackupFilesDir, "native-audio-capture-ledger-v1.json"))
    private var current: Session? = null
    private var closed = false
    private var lifecycleGeneration = 0L
    @Volatile private var foreground = false

    private class Session(
        val id: String,
        val request: JSONObject,
        val key: NativeMediaCaptureKey,
        val identity: NativeMediaCaptureKey.PublicIdentity,
        val requestNs: Long,
        val requestWallMs: Long
    ) {
        var state = "requesting-permission"
        var phase = "pilot-opening"
        var phaseNs = requestNs
        var handle = 0L
        var recordingMonitor: NativeAudioRecordingMonitor? = null
        var inputId = 0
        var outputId = 0
        var volume = 0
        var pilot: String? = null
        var pilotVerified = false
        var pilotAssessment: JSONObject? = null
        var roundAssessment: JSONObject? = null
        var roundAssessmentError: String? = null
        var pilotProbeEnqueued = false
        var lastDeviceDiagnostic: JSONObject? = null
        var lastPilotTiming: JSONObject? = null
        val lastRecordingDiagnostic = NativeAudioLastObservation<JSONObject> { value ->
            val encoded = value.toString()
            check(encoded.length <= 16 * 1024) { "Native microphone configuration diagnostics exceed their bound" }
            JSONObject(encoded)
        }
        var recordingDiagnosticError: String? = null
        var diagnostics: JSONObject? = null
        var diagnosticsError: String? = null
        var focus: AudioFocusRequest? = null
        var capturedFrames = 0
        var exportedChunks = 0
        val rounds = JSONArray()
        val timing = JSONArray()
        val chunks = arrayOfNulls<String>(15)
        var pcm: FloatArray? = null
        var metadata: JSONObject? = null
        var error: String? = null
        var result: JSONObject? = null
        lateinit var lifecycle: NativeAudioLifecycle
        val cleanupErrors = mutableListOf<String>()
    }

    @JavascriptInterface
    fun capabilities(): String = try {
        val key = NativeAttestedKeyStore.mediaKey(activity)
        val identity = key.publicIdentity()
        JSONObject().put("ok", true).put("version", 1).put("platform", "android-aaudio")
            .put("available", Build.VERSION.SDK_INT >= 29 && unprocessedSupported() && builtIn(true) != null && builtIn(false) != null)
            .put("minimum_android_api", 29).put("microphone_permission", hasPermission())
            .put("recording_configuration_required", true).put("privacy_sensitive_supported", Build.VERSION.SDK_INT >= 30)
            .put("key_fingerprint", identity.fingerprint).put("public_key_spki_b64", Base64.encodeToString(identity.spki, Base64.NO_WRAP))
            .put("key_profile", key.profile)
            .put("keystore_security_level", identity.securityLevel)
            .put("strongbox_requested", identity.strongBoxRequested).put("strongbox_fallback", identity.strongBoxFallback)
            .put("hardware_attested", false).put("collection_attested", false).toString()
    } catch (error: Throwable) { failure(error) }

    @JavascriptInterface
    fun begin(requestJson: String): String = try {
        require(requestJson.length <= MAX_REQUEST) { "Audio request is too large" }
        val request = JSONObject(NativeAudioCore.validateRequest(requestJson, System.currentTimeMillis()))
        val generation = synchronized(lock) {
            check(!closed && current?.state !in ACTIVE) { "Native microphone is closed or already active" }
            lifecycleGeneration
        }
        val key = NativeAttestedKeyStore.mediaKey(activity)
        val identity = key.publicIdentity()
        val session = synchronized(lock) {
            check(!closed && lifecycleGeneration == generation && current?.state !in ACTIVE) { "Native microphone setup was cancelled or another session started" }
            check(Build.VERSION.SDK_INT >= 29 && unprocessedSupported()) { "This phone cannot observe the required unprocessed microphone path (Android API29 required)" }
            check(!readLedger().has(request.getString("session_id"))) { "This audio request was already used on this device" }
            current?.let { previous ->
                release(previous)
                check(previous.handle == 0L && previous.focus == null && previous.recordingMonitor == null) { "Previous native microphone resources could not be released; retry cleanup before starting another session" }
            }
            Session(UUID.randomUUID().toString(), request, key, identity, System.nanoTime(), System.currentTimeMillis())
                .also { created ->
                    created.lifecycle = NativeAudioLifecycle(created.requestNs,
                        active = { synchronized(lock) { current === created && created.state in ACTIVE && !closed } },
                        failure = { message -> synchronized(lock) { fail(created, message) } })
                    current = created
                    try { scheduleDeadline(created) } catch (error: Throwable) { fail(created, safeError(error)) }
                }
        }
        enqueue(session, main, "permission setup") { start(session) }
        synchronized(lock) { snapshot(session).toString() }
    } catch (error: Throwable) { failure(error) }

    @JavascriptInterface
    fun status(sessionId: String): String = synchronized(lock) {
        current?.takeIf { it.id == sessionId }?.let { snapshot(it).toString() } ?: failureMessage("Unknown native audio session")
    }

    @JavascriptInterface
    fun round(sessionId: String, roundJson: String): String = operation(sessionId) { session ->
        require(roundJson.length <= 4096) { "Audio challenge is too large" }
        check(session.state in setOf("ready", "recording")) { "Native microphone is not ready for an acoustic challenge" }
        ensureActive(session)
        check(requireNotNull(session.recordingMonitor).poll()) { "Active microphone recording configuration is unavailable" }
        val receivedNs = System.nanoTime()
        val round = JSONObject(NativeAudioCore.validateRound(session.request.toString(), roundJson, session.rounds.toString(), System.currentTimeMillis()))
        val index = round.getInt("index")
        check(index == session.rounds.length() && (index == 0 || session.exportedChunks >= index)) { "The previous microphone segment must be delivered first" }
        val probe = NativeAudioCore.probe(round.toString())
        val device = JSONObject(NativeAudioDevice.snapshot(session.handle))
        val position = device.getInt("captured_frames")
        check(position in (index * CHUNK)..(index * CHUNK + 36000)) { "The requester challenge arrived outside its microphone window" }
        if (index == 0) {
            check(session.pilotVerified && session.state == "ready") { "The native microphone pilot has not passed" }
            reserve(session) // One use, including recordings that subsequently fail.
            NativeAudioDevice.record(session.handle, session.request.getInt("duration_secs") * RATE)
            session.state = "recording"
            session.phaseNs = receivedNs
        }
        session.rounds.put(round)
        session.timing.put(JSONObject().put("received_monotonic_ns", receivedNs.toString()).put("requested_at_frame", position))
        NativeAudioDevice.play(session.handle, index, probe)
        snapshot(session)
    }

    @JavascriptInterface
    fun chunk(sessionId: String, index: Int): String = operation(sessionId) { session ->
        check(session.state in setOf("recording", "awaiting-receipt")) { "No native microphone recording is available" }
        ensureActive(session)
        val total = session.request.getInt("duration_secs") / 2
        require(index in 0 until total && index <= session.exportedChunks) { "Microphone segments must be retrieved in order" }
        session.chunks[index]?.let { return@operation JSONObject(it) }
        val reply = JSONObject().put("ok", true).put("session_id", session.id).put("index", index)
        if (index >= session.rounds.length() || session.capturedFrames < (index + 1) * CHUNK) return@operation reply.put("pending", true)
        val pcm = session.pcm?.copyOfRange(index * CHUNK, (index + 1) * CHUNK)
            ?: NativeAudioDevice.copyFrames(session.handle, index * CHUNK, CHUNK)
        val encoded = JSONObject(NativeAudioCore.encodeChunk(pcm))
        check(encoded.getInt("sample_count") == CHUNK) { "Native audio encoder returned an invalid segment" }
        reply.put("pending", false).put("pcm_base64", encoded.getString("pcm_base64"))
            .put("pcm_sha256", encoded.getString("pcm_sha256")).put("sample_count", CHUNK)
        session.chunks[index] = reply.toString()
        session.exportedChunks++
        reply
    }

    @JavascriptInterface
    fun finalize(sessionId: String, receiptJson: String): String = operation(sessionId) { session ->
        require(receiptJson.length <= MAX_RECEIPT) { "Requester audio receipt is too large" }
        check(session.state == "awaiting-receipt" && session.exportedChunks == session.request.getInt("duration_secs") / 2) { "Native audio capture is incomplete" }
        ensureActive(session)
        val transcript = NativeAudioCore.validateReceipt(session.request.toString(), session.rounds.toString(), receiptJson, System.currentTimeMillis())
        session.state = "sealing"
        session.phaseNs = System.nanoTime()
        enqueue(session, worker, "finalization") { seal(session, transcript) }
        snapshot(session)
    }

    @JavascriptInterface
    fun cancel(sessionId: String): String = synchronized(lock) {
        val session = current?.takeIf { it.id == sessionId } ?: return@synchronized failureMessage("Unknown native audio session")
        if (session.state in ACTIVE) {
            val stoppedState = session.state
            session.state = "cancelled"
            session.error = "Native microphone session cancelled"
            try { freezeDiagnostics(session, stoppedState) }
            catch (error: Throwable) { session.diagnosticsError = safeError(error).take(160) }
            finally { release(session) }
        }
        snapshot(session).toString()
    }

    /** Revocation only: Activity clears every signer before attempting OS cleanup. */
    fun revokeAuthority() { foreground = false }

    fun pause() {
        foreground = false
        synchronized(lock) {
            lifecycleGeneration++
            current?.takeIf { it.state in ACTIVE }?.let { fail(it, "Native microphone requires uninterrupted foreground operation") }
        }
    }

    fun destroy() {
        foreground = false
        synchronized(lock) {
            closed = true
            current?.let { if (it.state in ACTIVE) fail(it, "Native microphone closed") else release(it) }
            thread.quitSafely()
            observationThread.quitSafely()
        }
    }

    private fun start(session: Session) {
        try {
            synchronized(lock) {
                if (current !== session || session.state != "requesting-permission" || closed) return
                foreground = isForeground()
                check(foreground) { "Open the microphone from the foreground app" }
                if (hasPermission()) { prepare(session); return }
            }
            requestMicrophonePermission { granted ->
                synchronized(lock) {
                    if (current !== session || session.state != "requesting-permission" || closed) return@synchronized
                    foreground = isForeground()
                    if (!granted || !hasPermission() || !foreground) fail(session, "Foreground microphone permission was not granted")
                    else try { prepare(session) } catch (error: Throwable) { fail(session, safeError(error)) }
                }
            }
        } catch (error: Throwable) { synchronized(lock) { fail(session, safeError(error)) } }
    }

    private fun prepare(session: Session) {
        ensureActive(session)
        session.inputId = requireNotNull(builtIn(true)) { "A built-in microphone is required" }.id
        session.outputId = requireNotNull(builtIn(false)) { "A built-in speaker is required" }.id
        session.volume = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
        check(session.volume > 0) { "Android media volume is zero. Set a comfortable non-zero media volume before retrying." }
        check(!audio.isMicrophoneMute) { "Android reports the microphone muted. Unmute it before retrying." }
        val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setOnAudioFocusChangeListener({ change ->
                if (change != AudioManager.AUDIOFOCUS_GAIN) synchronized(lock) {
                    if (current === session && session.state in ACQUIRING) fail(session, "Native speaker audio focus was interrupted")
                }
            }, main).build()
        check(audio.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { "The native speaker could not acquire audio focus" }
        session.focus = focus
        session.state = "preparing"
        session.phaseNs = System.nanoTime()
        enqueue(session, worker, "acquisition polling") { poll(session) }
    }

    private fun poll(session: Session) {
        synchronized(lock) {
            if (current !== session || session.state !in ACQUIRING || closed) return
            try {
                ensureActive(session)
                checkRoutes(session)
                val ageMs = (System.nanoTime() - session.phaseNs) / 1_000_000
                when (session.state) {
                    "preparing", "pilot" -> check(ageMs <= 8000) { "Native microphone pilot or stream startup timed out" }
                    "ready" -> check(ageMs <= 60000) { "No requester challenge arrived before native audio expired" }
                    "recording" -> check(ageMs <= session.request.getInt("duration_secs") * 1000L + 3000) { "Native microphone did not deliver its complete recording" }
                }
                if (session.handle == 0L) openStreams(session)
                val device = JSONObject(NativeAudioDevice.snapshot(session.handle))
                val observedNs = System.nanoTime().toString()
                session.lastDeviceDiagnostic = JSONObject().put("input", JSONObject(device.getJSONObject("input").toString()))
                    .put("output", JSONObject(device.getJSONObject("output").toString()))
                    .put("input_session_id", device.getInt("input_session_id"))
                    .put("captured_frames", device.getInt("captured_frames"))
                    .put("timestamps_ready", device.getBoolean("timestamps_ready"))
                    .put("stream_phase", session.phase)
                    .put("observed_monotonic_ns", observedNs)
                if (session.phase == "pilot-opening" || session.phase == "pilot-recording") {
                    session.lastPilotTiming = pilotTiming(device, observedNs)
                }
                val observed = requireNotNull(session.recordingMonitor).poll()
                when (session.phase) {
                    "pilot-opening" -> if (observed && device.getBoolean("timestamps_ready")) {
                        session.pilot = NativeAudioCore.createPilot(session.request.toString(), System.currentTimeMillis())
                        val generatedProbe = NativeAudioCore.probe(requireNotNull(session.pilot))
                        try {
                            NativeAudioDevice.record(session.handle, CHUNK)
                            NativeAudioDevice.play(session.handle, 0, generatedProbe)
                            session.pilotProbeEnqueued = true
                        } finally { generatedProbe.fill(0.0f) }
                        session.state = "pilot"
                        session.phase = "pilot-recording"
                        session.phaseNs = System.nanoTime()
                    }
                    "pilot-recording" -> if (device.getInt("captured_frames") == CHUNK) {
                        val pilotPcm = NativeAudioDevice.copyFrames(session.handle, 0, CHUNK)
                        try {
                            rememberRecordingDiagnostic(session)
                            NativeAudioDevice.close(session.handle)
                            session.handle = 0
                            session.recordingMonitor?.close()
                            session.recordingMonitor = null
                            val assessment = JSONObject(NativeAudioCore.inspectPilot(pilotPcm, requireNotNull(session.pilot)))
                            session.pilotAssessment = assessment
                            check(assessment.getBoolean("passed")) {
                                when (assessment.getString("reason")) {
                                    "not_detected" -> "Native microphone/speaker pilot did not detect the challenge"
                                    "detected_late" -> "Native microphone/speaker pilot detected the challenge after the 800 ms start limit"
                                    else -> "Native microphone/speaker pilot assessment refused the challenge"
                                }
                            }
                        } finally { pilotPcm.fill(0.0f) }
                        session.pilotVerified = true
                        session.pilot = null
                        // New streams and new native buffers: no pilot sample can
                        // enter the evidence, and capture remains unarmed until round0.
                        session.phase = "recording-opening"
                        session.state = "preparing"
                        session.phaseNs = System.nanoTime()
                    }
                    "recording-opening" -> if (observed && device.getBoolean("timestamps_ready")) {
                        session.phase = "recording-ready"
                        session.state = "ready"
                        session.phaseNs = System.nanoTime()
                    }
                    "recording-ready" -> if (session.state == "recording") {
                        session.capturedFrames = device.getInt("captured_frames")
                        val nextRound = session.rounds.length()
                        check(nextRound == session.request.getInt("duration_secs") / 2 || session.capturedFrames <= nextRound * CHUNK + 36000) {
                            "The next unpredictable requester challenge missed its microphone window"
                        }
                        if (session.capturedFrames == session.request.getInt("duration_secs") * RATE) finishRecording(session, device)
                    }
                }
                if (session.state in ACQUIRING) enqueue(session, worker, "acquisition polling", 25) { poll(session) }
            } catch (error: Throwable) { fail(session, safeError(error)) }
        }
    }

    private fun openStreams(session: Session) {
        check(Build.VERSION.SDK_INT >= 29) { "Microphone configuration observation requires Android API29" }
        val inputSessionId = audio.generateAudioSessionId()
        check(inputSessionId > 0) { "Android could not allocate a microphone recording session" }
        // Register before AAudio starts. Each pilot/evidence stream has its own
        // monitor; a callback from an old generation cannot poison its successor.
        lateinit var monitor: NativeAudioRecordingMonitor
        monitor = NativeAudioRecordingMonitor(audio, observations, inputSessionId, session.inputId) { message ->
            enqueue(session, worker, "configuration failure") { synchronized(lock) {
                if (current === session && session.recordingMonitor === monitor) fail(session, message)
            } }
        }
        session.recordingMonitor = monitor
        session.handle = NativeAudioDevice.open(session.inputId, session.outputId, inputSessionId)
    }

    private fun finishRecording(session: Session, device: JSONObject) {
        check(device.getJSONArray("rounds").length() == session.rounds.length() && session.rounds.length() == session.request.getInt("duration_secs") / 2) {
            "Native speaker did not complete every requester challenge"
        }
        session.pcm = NativeAudioDevice.copyFrames(session.handle, 0, session.capturedFrames)
        session.metadata = metadata(session, device)
        NativeAudioDevice.close(session.handle)
        session.handle = 0
        session.state = "awaiting-receipt"
        session.phaseNs = System.nanoTime()
        releaseFocus(session)
        enqueue(session, worker, "receipt timeout", 15000) { synchronized(lock) {
            if (current === session && session.state == "awaiting-receipt") fail(session, "Requester receipt did not arrive before the native recording expired")
        } }
    }

    private fun metadata(session: Session, device: JSONObject): JSONObject {
        val output = JSONObject(device.toString())
        output.remove("timestamps_ready")
        output.put("recording_configuration", requireNotNull(session.recordingMonitor).finish(device))
        for (field in listOf("input_session_id", "privacy_sensitive_supported", "privacy_sensitive_requested", "privacy_sensitive_actual")) output.remove(field)
        output.put("version", 1).put("type", "nonverba-native-audio-capture").put("backend", "android-aaudio")
            .put("session_id", session.id).put("request_session_id", session.request.getString("session_id"))
            .put("request_received_unix_ms", session.requestWallMs).put("request_received_monotonic_ns", session.requestNs.toString())
            .put("completed_unix_ms", System.currentTimeMillis()).put("clock", "monotonic")
            .put("sample_rate", RATE).put("channels", 1).put("format", "pcm-f32").put("input_preset", "unprocessed")
            .put("xrun_reporting_completeness", "unknown")
            .put("keystore_security_level", session.identity.securityLevel)
            .put("strongbox_requested", session.identity.strongBoxRequested).put("strongbox_fallback", session.identity.strongBoxFallback)
        val rounds = output.getJSONArray("rounds")
        for (index in 0 until rounds.length()) {
            val timing = session.timing.getJSONObject(index)
            rounds.getJSONObject(index).put("nonce", session.rounds.getJSONObject(index).getString("nonce"))
                .put("received_monotonic_ns", timing.getString("received_monotonic_ns"))
                .put("requested_at_frame", timing.getInt("requested_at_frame"))
        }
        check(output.toString().length <= 256 * 1024) { "Native microphone acquisition evidence exceeds its bound" }
        return output
    }

    private fun seal(session: Session, transcript: String) {
        try {
            val input = synchronized(lock) {
                if (current !== session || session.state != "sealing" || closed) return
                requireSealingAllowed(session)
                Pair(requireNotNull(session.pcm), requireNotNull(session.metadata).toString())
            }
            val signer = NativeMediaEvidenceSigner(session.key) {
                synchronized(lock) { runCatching { requireSealingAllowed(session); true }.getOrDefault(false) }
            }
            val sealedAtMs = synchronized(lock) { requireSealingAllowed(session) }
            val result = JSONObject(NativeAudioCore.seal(input.first, session.request.toString(), transcript, input.second,
                session.identity.spki, session.identity.certificatePem, sealedAtMs, signer))
            val monitor = synchronized(lock) {
                if (current !== session || session.state != "sealing" || closed) return
                rememberRoundAssessment(session, result)
                check(result.optBoolean("ok", true)) {
                    result.optString("error", "Native microphone acoustic policy refused the recording")
                }
                requireSealingAllowed(session)
                check(result.getString("fingerprint") == session.identity.fingerprint && result.getString("media_origin") == "native-aaudio-pcm") {
                    "Native audio sealing identity or origin changed"
                }
                requireNotNull(session.recordingMonitor)
            }
            // Never wait while holding lock. Keep the signed result private
            // until already-queued recording callbacks reach their queue fence.
            monitor.afterQueuedObservations(worker) { error ->
                synchronized(lock) {
                    if (current !== session || session.state != "sealing" || closed ||
                        session.recordingMonitor !== monitor) return@synchronized
                    try {
                        check(error == null) { requireNotNull(error) }
                        requireSealingAllowed(session)
                        session.result = result
                        session.state = "complete"
                        release(session)
                    } catch (failure: Throwable) { fail(session, safeError(failure)) }
                }
            }
        } catch (error: Throwable) { synchronized(lock) { fail(session, safeError(error)) } }
    }

    private fun checkRoutes(session: Session) {
        check(audio.getDevices(AudioManager.GET_DEVICES_INPUTS).any { it.id == session.inputId && it.type == AudioDeviceInfo.TYPE_BUILTIN_MIC } &&
            audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { it.id == session.outputId && it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }) {
            "The built-in microphone or speaker route disappeared"
        }
        check(!audio.isMicrophoneMute && audio.getStreamVolume(AudioManager.STREAM_MUSIC) == session.volume) { "Microphone mute or speaker volume changed during capture" }
    }

    private fun ensureActive(session: Session, nowMs: Long = System.currentTimeMillis()): Long {
        session.recordingMonitor?.requireHealthy()
        // The injected predicate reads WebView state and is main-thread only.
        // MainActivity pause, stop and document navigation revoke this cached flag.
        NativeSessionGuards.requireAuthority(foreground, closed, current === session, hasPermission())
        val elapsed = NativeSessionGuards.elapsedMillis(session.requestWallMs, session.requestNs, nowMs, System.nanoTime())
        check(elapsed <= NativeAudioLifecycle.MAX_LIFETIME_MS) { "Native microphone session lifetime expired" }
        NativeSessionGuards.requireRequestWindow(nowMs, session.request.getLong("issued_at"), session.request.getLong("expires_at"))
        return elapsed
    }

    /** Recheck actual sample age and the request window after waiting for the key. */
    private fun requireSealingAllowed(session: Session): Long {
        check(session.state == "sealing") { "Native microphone is not finalizing" }
        val nowMs = System.currentTimeMillis()
        val elapsedMs = ensureActive(session, nowMs)
        val lastCallbackNs = requireNotNull(session.metadata).getString("last_input_callback_monotonic_ns").toLong()
        check(lastCallbackNs >= session.requestNs) { "Native microphone completion predates its request" }
        NativeSessionGuards.requireFresh(elapsedMs, (lastCallbackNs - session.requestNs) / 1_000_000, 30_000)
        NativeAudioCore.validateRequest(session.request.toString(), nowMs)
        return nowMs
    }

    private fun operation(sessionId: String, body: (Session) -> JSONObject): String = synchronized(lock) {
        val session = current?.takeIf { it.id == sessionId } ?: return@synchronized failureMessage("Unknown native audio session")
        try { body(session).toString() }
        catch (error: Throwable) { fail(session, safeError(error)); snapshot(session).toString() }
    }

    private fun releaseFocus(session: Session) {
        session.focus?.let {
            check(audio.abandonAudioFocusRequest(it) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { "Native speaker audio focus could not be released" }
            session.focus = null
        }
    }

    private fun release(session: Session) {
        session.lifecycle.close()
        val errors = NativeAudioLifecycle.cleanup(listOf(
            { session.recordingMonitor?.close(); session.recordingMonitor = null },
            { if (session.handle != 0L) { NativeAudioDevice.close(session.handle); session.handle = 0 } },
            { releaseFocus(session) }
        )) {
            session.pcm = null
            session.chunks.fill(null)
            session.pilot = null
        }
        errors.forEach { if (it !in session.cleanupErrors && session.cleanupErrors.size < 8) session.cleanupErrors.add(it) }
    }

    private fun enqueue(session: Session, handler: Handler, label: String, delayMs: Long = 0, action: () -> Unit) =
        session.lifecycle.enqueue(label,
            post = { if (delayMs == 0L) handler.post(it) else handler.postDelayed(it, delayMs) },
            remove = { handler.removeCallbacks(it) }, action = action)

    /** Independent of the native worker, including while an OS permission reply is absent. */
    private fun scheduleDeadline(session: Session) {
        val delay = NativeAudioLifecycle.deadlineDelayMillis(session.requestWallMs, session.requestNs,
            session.request.getLong("expires_at"), System.currentTimeMillis(), System.nanoTime())
        enqueue(session, main, "session deadline", delay) { synchronized(lock) {
            if (current === session && session.state in ACTIVE && !closed) {
                val wallMs = System.currentTimeMillis()
                val elapsed = NativeSessionGuards.elapsedMillis(session.requestWallMs, session.requestNs, wallMs, System.nanoTime())
                when {
                    elapsed > NativeAudioLifecycle.MAX_LIFETIME_MS -> fail(session, "Native microphone session lifetime expired")
                    wallMs / 1000 >= session.request.getLong("expires_at") -> fail(session, "Native microphone request expired")
                    else -> scheduleDeadline(session)
                }
            }
        } }
    }

    private fun fail(session: Session, message: String) {
        if (current !== session || session.state !in ACTIVE) return
        val stoppedState = session.state
        session.state = "error"
        session.error = message.take(400)
        try { freezeDiagnostics(session, stoppedState) }
        catch (error: Throwable) { session.diagnosticsError = safeError(error).take(160) }
        finally { release(session) }
    }

    /** Freeze observations before teardown; never query hardware or sign diagnostics here. */
    private fun freezeDiagnostics(session: Session, stoppedState: String) {
        if (session.diagnostics != null) return
        session.lifecycle.close()
        rememberRecordingDiagnostic(session)
        val errors = JSONArray()
        session.recordingDiagnosticError?.let { errors.put(it) }
        session.roundAssessmentError?.let { errors.put(it) }
        val configuration = session.lastRecordingDiagnostic.snapshot()
        fun requested(performance: String) = JSONObject().put("sample_rate", RATE).put("channels", 1)
            .put("format", "pcm-f32").put("performance_mode", performance)
        val diagnostics = JSONObject().put("version", 1).put("type", "nonverba-native-audio-diagnostics")
            .put("signed", false).put("successful_measurement", false)
            .put("session_id", session.id).put("request_session_id", session.request.getString("session_id"))
            .put("key_fingerprint", session.identity.fingerprint)
            .put("stopped_state", stoppedState).put("stopping_phase", session.phase)
            .put("error", session.error ?: "Native audio stopped")
            .put("terminal_elapsed_ms", session.lifecycle.terminalElapsedMillis())
            .put("retained_frames_last_observed", session.lastDeviceDiagnostic?.optInt("captured_frames") ?: JSONObject.NULL)
            .put("pilot_probe_enqueued", session.pilotProbeEnqueued).put("pilot_verified", session.pilotVerified)
            .put("pilot_assessment", session.pilotAssessment ?: JSONObject.NULL)
            .put("round_assessment", session.roundAssessment?.let { JSONObject(it.toString()) } ?: JSONObject.NULL)
            .put("pilot_native_timing_last_observed", session.lastPilotTiming?.let { JSONObject(it.toString()) } ?: JSONObject.NULL)
            .put("challenge_count", session.rounds.length())
            .put("android_recording_configuration_last_observed", configuration ?: JSONObject.NULL)
            .put("aaudio_requested", JSONObject().put("input", requested("none")).put("output", requested("low-latency")))
            .put("aaudio_actual_last_observed", session.lastDeviceDiagnostic ?: JSONObject.NULL).put("diagnostic_errors", errors)
        check(diagnostics.toString().toByteArray(Charsets.UTF_8).size <= 16 * 1024) { "Native microphone diagnostics exceed their bound" }
        session.diagnostics = diagnostics
    }

    /** Native sealer observations only; a diagnostic copy failure cannot replace its original refusal. */
    private fun rememberRoundAssessment(session: Session, result: JSONObject) {
        if (!result.has("round_assessment") || result.isNull("round_assessment")) return
        try {
            val assessment = result.getJSONObject("round_assessment")
            check(assessment.getInt("version") == 1 && assessment.getString("type") == "nonverba-native-audio-round-assessment" &&
                assessment.getString("signal_algorithm") == "org.nonverba.audio-fsk.v1" && assessment.getString("sample_format") == "pcm16" &&
                assessment.getInt("maximum_start_offset_samples") == 38400 && assessment.get("passed") is Boolean &&
                assessment.getJSONArray("rounds").length() <= 15) {
                "Native microphone round assessment has an invalid diagnostic schema"
            }
            val encoded = assessment.toString()
            check(encoded.toByteArray(Charsets.UTF_8).size <= 8192) { "Native microphone round assessment exceeds its bound" }
            session.roundAssessment = JSONObject(encoded)
        } catch (error: Throwable) {
            session.roundAssessmentError = safeError(error).take(160)
        }
    }

    /** Existing collector counters only; a completed callback probe does not establish physical playback. */
    private fun pilotTiming(device: JSONObject, observedNs: String): JSONObject {
        fun available(field: String, minimum: Long = 1): Any {
            val value = device.getString(field)
            return if (value.toLong() >= minimum) value else JSONObject.NULL
        }
        val rounds = device.getJSONArray("rounds")
        val completed = if (rounds.length() == 0) null else {
            val round = rounds.getJSONObject(0)
            check(round.getInt("index") == 0) { "Native pilot output observation is not round zero" }
            JSONObject().put("index", round.getInt("index"))
                .put("output_start_stream_frame", round.getString("output_start_stream_frame"))
                .put("output_end_stream_frame", round.getString("output_end_stream_frame"))
                .put("output_first_callback_monotonic_ns", round.getString("output_first_callback_monotonic_ns"))
                .put("input_frame_at_output_start", round.getInt("input_frame_at_output_start"))
        }
        val timing = JSONObject().put("input_session_id", device.getInt("input_session_id"))
            .put("observed_monotonic_ns", observedNs).put("captured_frames", device.getInt("captured_frames"))
            .put("record_requested_monotonic_ns", available("record_requested_monotonic_ns"))
            .put("record_start_stream_frame", available("record_start_stream_frame", 0))
            .put("first_input_callback_monotonic_ns", available("first_input_callback_monotonic_ns"))
            .put("last_input_callback_monotonic_ns", available("last_input_callback_monotonic_ns"))
            .put("completed_output_probe", completed ?: JSONObject.NULL)
        check(timing.toString().toByteArray(Charsets.UTF_8).size <= 2048) { "Native pilot timing diagnostics exceed their bound" }
        return timing
    }

    /** Copy the existing collector observation before detaching it; never poll hardware here. */
    private fun rememberRecordingDiagnostic(session: Session) {
        try {
            val observed = session.recordingMonitor?.diagnostics()?.put("stream_phase", session.phase)
            session.lastRecordingDiagnostic.remember(observed)
        } catch (error: Throwable) {
            session.recordingDiagnosticError = safeError(error).take(160)
        }
    }

    private fun readLedger(): JSONObject {
        if (!ledger.baseFile.exists() && !File(ledger.baseFile.path + ".bak").exists()) return JSONObject()
        return ledger.openRead().use {
            check(it.channel.size() <= 1024 * 1024) { "Native audio replay ledger is too large" }
            JSONObject(it.readBytes().toString(Charsets.UTF_8))
        }
    }

    private fun reserve(session: Session) {
        val entries = readLedger()
        val id = session.request.getString("session_id")
        check(!entries.has(id)) { "This audio request was already used on this device" }
        check(entries.length() < 4096) { "Native audio replay ledger is full" }
        entries.put(id, System.currentTimeMillis())
        val stream = ledger.startWrite()
        try { stream.write(entries.toString().toByteArray(Charsets.UTF_8)); ledger.finishWrite(stream) }
        catch (error: Throwable) { ledger.failWrite(stream); throw error }
    }

    private fun builtIn(input: Boolean): AudioDeviceInfo? = audio.getDevices(if (input) AudioManager.GET_DEVICES_INPUTS else AudioManager.GET_DEVICES_OUTPUTS)
        .filter { it.type == if (input) AudioDeviceInfo.TYPE_BUILTIN_MIC else AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }.minByOrNull { it.id }
    private fun unprocessedSupported() = audio.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED) == "true"
    private fun hasPermission() = activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    private fun snapshot(session: Session) = JSONObject().put("ok", session.state !in setOf("error", "cancelled"))
        .put("session_id", session.id).put("key_fingerprint", session.identity.fingerprint).put("state", session.state)
        .put("key_profile", session.key.profile)
        .put("pilot_verified", session.pilotVerified).put("captured_frames", session.capturedFrames)
        .put("elapsed_ms", session.lifecycle.elapsedMillis()).put("timing_signed", false)
        .also { session.lifecycle.terminalElapsedMillis()?.let { elapsed -> it.put("terminal_elapsed_ms", elapsed) }
            if (session.cleanupErrors.isNotEmpty()) it.put("cleanup_errors", JSONArray(session.cleanupErrors)) }
        .also { session.error?.let { error -> it.put("error", error) }; session.result?.let { result -> it.put("result", result) } }
        .also { session.diagnostics?.let { diagnostics -> it.put("diagnostics", JSONObject(diagnostics.toString())) } }
        .also { session.diagnosticsError?.let { error -> it.put("diagnostics_error", error) } }
    private fun safeError(error: Throwable) = (error.message ?: "Native audio capture failed").take(400)
    private fun failure(error: Throwable) = failureMessage(safeError(error))
    private fun failureMessage(message: String) = JSONObject().put("ok", false).put("state", "error").put("error", message).toString()

    private companion object {
        const val RATE = 48000
        const val CHUNK = 96000
        const val MAX_REQUEST = 64 * 1024
        const val MAX_RECEIPT = 64 * 1024
        val ACQUIRING = setOf("preparing", "pilot", "ready", "recording")
        val ACTIVE = ACQUIRING + setOf("requesting-permission", "awaiting-receipt", "sealing")
    }
}
