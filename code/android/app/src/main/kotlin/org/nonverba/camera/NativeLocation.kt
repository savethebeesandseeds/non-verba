// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.AtomicFile
import android.util.Base64
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Android collection and lifecycle adapter. Rust validates and signs session-owned records.
 * This boundary protects against WebView callers supplying coordinates or arbitrary signing data;
 * it is not device attestation, authenticated GPS, or native camera exposure evidence.
 */
internal class NativeLocation(
    private val activity: Activity,
    private val isForeground: () -> Boolean,
    private val requestFinePermission: ((Boolean) -> Unit) -> Unit,
    private val prepareGps: () -> Unit
) {
    private val lock = Any()
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val manager = activity.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private val ledger = AtomicFile(File(activity.noBackupFilesDir, "location-capture-ledger-v1.json"))
    private val attempts = NativeGpsAttemptJournal(File(activity.noBackupFilesDir, "gps-attempts-v1"),
        read = { file -> AtomicFile(file).openRead().use { input ->
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(16 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                check(output.size() + count <= NativeGpsAttemptJournal.MAX_BYTES) { "Attempt record exceeds limit" }
                output.write(buffer, 0, count)
            }
            output.toByteArray()
        } },
        commit = { file, bytes ->
            val atomic = AtomicFile(file)
            val stream = atomic.startWrite()
            try { stream.write(bytes); atomic.finishWrite(stream) }
            catch (error: Throwable) { atomic.failWrite(stream); throw error }
        })
    private var current: Session? = null
    private var closed = false
    private var lifecycleGeneration = 0L
    @Volatile private var foreground = false

    private class Session(val id: String, val request: JSONObject, val originalRequest: String, val key: LocationCaptureKey, val spki: ByteArray, val startedAt: Long, val anchorNs: Long) {
        val cameraSelection = NativeCameraLocationSelection(request.optJSONObject("context")?.optString("camera_timing") == "concurrent")
        var cameraSelected: JSONObject? = null
        var state = "requesting-permission"
        var error: String? = null
        val timing = NativeSessionGuards.PhaseTimings()
        var selectedProvider: String? = null
        var failureStage: String? = null
        var trace: JSONObject? = null
        var result: JSONObject? = null
        val samples = JSONArray()
        var rejectedSamples = 0
        var listener: LocationListener? = null
        var rawCollector: RawGnssCollector? = null
        var gnssStatusCollector: NativeGnssStatusCollector? = null
        val gnssStatusDiagnostics = NativeGnssStatusDiagnostics()
        var rawChecks: JSONObject? = null
        val rawDiagnostics = NativeLocationDiagnostics.Raw()
        val rawEpochs = JSONArray()
        var rejectedRawEpochs = 0
        val rawRequired = request.getJSONObject("policy").optJSONObject("raw_gnss") != null
        var timeout: Runnable? = null
        val terminal = NativeLocationTerminal()
        var frozenStatus: String? = null
        var rawPolicyRejected = false
        var attemptStatus = "not-covered"
        var attemptError: String? = null
        var attemptExport: String? = null
        var permissionGrantedMs: Long? = null
        var firstRawAdmittedMs: Long? = null
    }

    @JavascriptInterface
    fun capabilities(): String = try {
        val key = NativeAttestedKeyStore.locationKey(activity)
        val spki = key.publicSpki()
        JSONObject().put("available", true).put("version", 1).put("platform", "android-native")
            .put("key_fingerprint", NativeLocationCore.fingerprint(spki))
            .put("key_profile", key.profile)
            .put("public_key_spki_b64", Base64.encodeToString(spki, Base64.NO_WRAP))
            .put("fine_permission", activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED)
            .put("hardware_attested", false).put("collection_attested", false)
            .put("raw_gnss_api_available", Build.VERSION.SDK_INT >= 29)
            .put("raw_gnss_receiver_verified", false)
            .put("gps_attempt_reports", "raw-policy-rejection-and-no-callback-timeout-v1")
            .put("camera_exposure_attested", false).toString()
    } catch (failure: Throwable) {
        JSONObject().put("available", false).put("error", safeError(failure)).toString()
    }

    @JavascriptInterface
    fun begin(requestJson: String): String = try {
        require(requestJson.length <= MAX_REQUEST) { "Location request is too large" }
        val now = System.currentTimeMillis()
        val validated = JSONObject(NativeLocationCore.validateRequest(requestJson, now))
        val generation = synchronized(lock) {
            check(!closed && current?.state !in ACTIVE_STATES) { "Location collector is closed or already active" }
            lifecycleGeneration
        }
        // Never acquire the key lock while holding the session lock: a queued
        // signer rechecks its session authority from inside that key lock.
        val key = NativeAttestedKeyStore.locationKey(activity)
        val spki = key.publicSpki()
        val created = synchronized(lock) {
            check(!closed && lifecycleGeneration == generation) { "Location setup was cancelled during key provisioning" }
            check(current?.state !in ACTIVE_STATES) { "A native location session is already active" }
            val nonce = validated.getJSONObject("challenge").getString("id")
            check(!readLedger().has(nonce)) { "This challenge was already finalized on this device" }
            Session(UUID.randomUUID().toString(), validated, requestJson, key, spki, System.currentTimeMillis(), SystemClock.elapsedRealtimeNanos()).also { current = it }
        }
        main.post { start(created) }
        synchronized(lock) { snapshot(created).toString() }
    } catch (failure: Throwable) { failure(failure) }

    @JavascriptInterface
    fun status(sessionId: String): String = synchronized(lock) {
        val session = current?.takeIf { it.id == sessionId }
        if (session == null) failureMessage("Unknown native location session") else snapshot(session).toString()
    }

    /** Read-only retrieval. No observations or signing input accepted from WebView. */
    @JavascriptInterface fun listAttempts(): String = try {
        val ids = attempts.ids().toMutableList()
        synchronized(lock) { current?.takeIf { it.attemptExport != null && it.id !in ids }?.let { ids.add(it.id) } }
        JSONObject().put("ok", true).put("attempt_ids", JSONArray(ids))
            .put("capacity", NativeGpsAttemptJournal.MAX_RECORDS).toString()
    } catch (error: Throwable) { failure(error) }

    @JavascriptInterface fun readAttempt(attemptId: String): String = try {
        // A current report whose durable write failed remains exportable in memory.
        synchronized(lock) { current?.takeIf { it.id == attemptId }?.attemptExport }
            ?: attempts.get(attemptId).toString(Charsets.UTF_8)
    } catch (error: Throwable) { failure(error) }


    /**
     * Select one native-owned fix for an exposure without waiting for the full
     * evidence window. Remaining collection stays independent of the camera.
     */
    @JavascriptInterface
    fun selectForCamera(sessionId: String): String = synchronized(lock) {
        val session = current?.takeIf { it.id == sessionId }
            ?: return@synchronized failureMessage("Unknown native location session")
        if (!session.cameraSelection.concurrent) return@synchronized failureMessage("This request does not authorize concurrent camera selection")
        if (session.cameraSelected != null) return@synchronized failureMessage("A camera location fix was already selected")
        if (session.state !in setOf("requesting-permission", "collecting")) return@synchronized snapshot(session).toString()
        try {
            // JavascriptInterface runs on JavaBridge. The injected predicate reads
            // WebView state and belongs to the main thread; use the lifecycle flag
            // established by start() and revoked by pause()/destroy(), as signing does.
            NativeSessionGuards.requireAuthority(foreground, closed, current === session, true)
            val nowMs = System.currentTimeMillis()
            val elapsedMs = NativeSessionGuards.elapsedMillis(session.startedAt, session.anchorNs, nowMs, SystemClock.elapsedRealtimeNanos())
            val challenge = session.request.getJSONObject("challenge")
            NativeSessionGuards.requireRequestWindow(nowMs, challenge.getLong("issued_at"), challenge.getLong("expires_at"))
            if (session.state == "requesting-permission") return@synchronized cameraSelectionPending(session)
            check(hasPrecisePermission()) { "Precise location permission was revoked before camera selection" }
            if (session.samples.length() == 0) return@synchronized cameraSelectionPending(session)
            val sample = session.samples.getJSONObject(session.samples.length() - 1)
            if (!session.cameraSelection.select(sample.getInt("sequence"), elapsedMs, sample.getLong("fix_elapsed_ms"),
                    nowMs, sample.getLong("fix_timestamp_ms"), session.request.getJSONObject("policy").getLong("max_fix_age_ms"))) {
                return@synchronized cameraSelectionPending(session)
            }
            session.cameraSelected = selectedLocation(sample)
            // Receiver registration and teardown belong to the main thread.
            main.post {
                try {
                    synchronized(lock) {
                        if (current === session && session.state == "collecting") prepareTraceIfReady(session)
                    }
                } catch (error: Throwable) { fail(session, safeError(error)) }
            }
            snapshot(session).toString()
        } catch (error: Throwable) {
            fail(session, safeError(error))
            snapshot(session).toString()
        }
    }

    private fun cameraSelectionPending(session: Session): String = JSONObject().put("ok", false)
        .put("retryable", true).put("session_id", session.id).put("state", session.state)
        .put("error", "Waiting for a fresh native location fix before exposure").toString()

    @JavascriptInterface
    fun cancel(sessionId: String): String {
        val result = synchronized(lock) {
            val session = current?.takeIf { it.id == sessionId }
                ?: return failureMessage("Unknown native location session")
            if (session.state in ACTIVE_STATES) {
                session.failureStage = session.state
                session.state = "cancelled"
                session.error = "Native location session was cancelled"
                freezeTerminal(session)
                main.post { detach(session) }
            }
            snapshot(session).toString()
        }
        return result
    }

    @JavascriptInterface
    fun finalize(sessionId: String, jpegBase64: String): String {
        val session = synchronized(lock) {
            val found = current?.takeIf { it.id == sessionId }
                ?: return failureMessage("Unknown native location session")
            if (found.state != "ready") return failureMessage("Native location session is not ready")
            if (jpegBase64.length > ((MAX_JPEG + 2) / 3) * 4) return failureMessage("JPEG exceeds 32 MiB")
            found.state = "finalizing"
            found.timing.mark(NativeSessionGuards.PhaseTimings.Mark.FINALIZE_REQUEST, SystemClock.elapsedRealtimeNanos())
            found
        }
        // Finalization is posted through the Activity so background callers cannot invoke it.
        main.post {
            if (!isForeground()) { fail(session, "Finalization requires the foreground application"); return@post }
            if (!hasPrecisePermission()) { fail(session, "Precise location permission was revoked before finalization"); return@post }
            synchronized(lock) {
                if (current !== session || session.state != "finalizing") return@post
            }
            worker.execute {
                try {
                    val jpeg = if (jpegBase64.isEmpty()) ByteArray(0) else Base64.decode(jpegBase64, Base64.NO_WRAP)
                    require(jpeg.size <= MAX_JPEG) { "JPEG exceeds 32 MiB" }
                    if (jpeg.isNotEmpty()) require(jpeg.size >= 4 && jpeg[0] == 0xff.toByte() && jpeg[1] == 0xd8.toByte()) { "Media must be a JPEG" }
                    val trace = synchronized(lock) {
                        check(current === session && session.state == "finalizing") { "Finalization was cancelled" }
                        reserve(session) // Persist before signing. A failed attempt also consumes this nonce.
                        requireNotNull(session.trace).toString()
                    }
                    val authority = NativeSessionGuards.SigningAuthority {
                        synchronized(lock) { requireFinalizationAllowed(session, NativeSessionGuards.Stage.SIGNING_AUTHORITY) }
                    }
                    val signer = LocationEvidenceSigner(session.key) { authority.active() }
                    val spki = session.spki
                    val sealedAtMs = synchronized(lock) { requireFinalizationAllowed(session, NativeSessionGuards.Stage.SEAL_ENTRY) }
                    val proof = try {
                        authority.preservingFailure { NativeLocationCore.seal(trace, spki, jpeg, sealedAtMs, signer) }
                    } finally {
                        synchronized(lock) { session.timing.mark(NativeSessionGuards.PhaseTimings.Mark.SEAL_RETURNED, SystemClock.elapsedRealtimeNanos()) }
                    }
                    synchronized(lock) {
                        if (current === session && session.state == "finalizing") {
                            requireFinalizationAllowed(session, NativeSessionGuards.Stage.RESULT_DELIVERY)
                            session.result = JSONObject(proof)
                            session.state = "complete"
                            freezeTerminal(session)
                            main.post { detach(session) }
                        }
                    }
                } catch (error: Throwable) { fail(session, safeError(error)) }
            }
        }
        return synchronized(lock) { snapshot(session).toString() }
    }

    /** Main-thread lifecycle hook. Completed public evidence remains available. */
    fun pause() {
        foreground = false
        val session = synchronized(lock) {
            lifecycleGeneration++
            current?.takeIf { it.state in ACTIVE_STATES }?.also {
                it.failureStage = it.state
                it.state = "cancelled"
                it.error = "The application left the foreground; start a new location session"
                freezeTerminal(it)
            }
        }
        if (session != null) detach(session)
    }

    fun destroy() {
        pause()
        synchronized(lock) { closed = true; current = null }
        worker.shutdown()
    }

    private fun start(session: Session) {
        synchronized(lock) { if (current !== session || session.state != "requesting-permission") return }
        if (!isForeground()) { fail(session, "Location collection requires the foreground application"); return }
        foreground = true
        val deadline = Runnable {
            synchronized(lock) {
                if (current === session && session.state in setOf("requesting-permission", "collecting", "ready")) {
                    val policy = session.request.getJSONObject("policy")
                    fail(session, NativeLocationDiagnostics.timeoutReason(session.state,
                        session.samples.length(), session.rejectedSamples, policy.getInt("min_samples"),
                        sampleSpan(session), policy.getLong("duration_ms"), session.rawRequired), "collection-timeout")
                }
            }
        }
        session.timeout = deadline
        main.postDelayed(deadline, SESSION_TIMEOUT_MS)
        requestFinePermission { granted ->
            synchronized(lock) { if (current !== session || session.state != "requesting-permission") return@requestFinePermission }
            if (!granted) fail(session, "Precise foreground location permission is required for native evidence")
            else collect(session)
        }
    }

    @SuppressLint("MissingPermission") // Fine permission and foreground checked immediately before registration.
    private fun collect(session: Session) {
        if (!isForeground() || activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            fail(session, "Precise foreground location permission is required"); return
        }
        try {
            val enabled = manager.getProviders(true)
            val requiredGnss = session.request.getJSONObject("policy").getString("required_provider") == "gnss"
            if (session.rawRequired) {
                check(Build.VERSION.SDK_INT >= 29) { "Raw GNSS evidence requires Android 10 or later and receiver elapsed timestamps" }
                check(requiredGnss) { "Raw GNSS evidence requires the native GPS provider" }
            }
            val provider = when {
                LocationManager.GPS_PROVIDER in enabled -> LocationManager.GPS_PROVIDER
                !requiredGnss && "fused" in enabled -> "fused"
                !requiredGnss && LocationManager.NETWORK_PROVIDER in enabled -> LocationManager.NETWORK_PROVIDER
                else -> error("The requested location provider is unavailable; enable location services")
            }
            val listener = object : LocationListener {
                override fun onLocationChanged(location: Location) { observe(session, location) }
                override fun onProviderDisabled(provider: String) { fail(session, "The native location provider was disabled") }
                override fun onProviderEnabled(provider: String) = Unit
                @Suppress("OVERRIDE_DEPRECATION")
                @Deprecated("Legacy Android callback")
                override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
            }
            synchronized(lock) {
                if (current !== session || session.state != "requesting-permission") return
                session.selectedProvider = provider
                session.state = "collecting"
                session.permissionGrantedMs = elapsed(session)
                session.listener = listener
            }
            if (provider == LocationManager.GPS_PROVIDER) prepareGps()
            manager.requestLocationUpdates(provider, 1_000L, 0f, listener, Looper.getMainLooper())
            if (provider == LocationManager.GPS_PROVIDER) {
                val status = NativeGnssStatusCollector(manager, main, session.anchorNs, session.gnssStatusDiagnostics) {
                    synchronized(lock) { current === session && session.state == "collecting" && foreground }
                }
                synchronized(lock) {
                    if (current !== session || session.state != "collecting") return
                    session.gnssStatusCollector = status
                }
                status.start()
            }
            if (session.rawRequired) {
                val raw = RawGnssCollector(manager, main, session.anchorNs, session.rawDiagnostics,
                    onEpoch = { observeRaw(session, it) },
                    onWarmupRejected = { rejectRawWarmup(session) },
                    onFailure = { fail(session, it) })
                synchronized(lock) {
                    if (current !== session || session.state != "collecting") return
                    session.rawCollector = raw
                }
                raw.start()
            }
        } catch (error: Throwable) { fail(session, safeError(error)) }
    }

    @Suppress("DEPRECATION")
    private fun observe(session: Session, location: Location) {
        try {
            synchronized(lock) {
                if (current !== session || session.state != "collecting") return
                check(isForeground()) { "Location collection left the foreground" }
                check(activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) { "Precise location permission was revoked" }
                val mock = if (Build.VERSION.SDK_INT >= 31) location.isMock else location.isFromMockProvider
                check(!mock) { "Android marked this location as simulated; native evidence was not signed" }
                // Start the requested location window only once its raw receiver evidence
                // is available, so receiver warmup cannot leave an uncovered first fix.
                if (session.rawRequired && session.rawEpochs.length() == 0) {
                    session.rejectedSamples++
                    return
                }
                val observed = elapsed(session)
                val fixNs = location.elapsedRealtimeNanos - session.anchorNs
                val fix = fixNs / 1_000_000
                val policy = session.request.getJSONObject("policy")
                val last = if (session.samples.length() == 0) null else session.samples.getJSONObject(session.samples.length() - 1)
                // Historical, duplicated and delayed updates do not count toward the trace.
                if (fixNs <= 0 || fix <= 0 || fix > observed || observed - fix > policy.getLong("max_delivery_delay_ms") ||
                    !location.hasAccuracy() || !location.accuracy.isFinite() || location.accuracy < 0 ||
                    location.accuracy > policy.getDouble("max_accuracy_m") ||
                    (last != null && (fix <= last.getLong("fix_elapsed_ms") || location.time <= last.getLong("fix_timestamp_ms")))) {
                    session.rejectedSamples++
                    return
                }
                check(session.samples.length() < 128) { "Native location trace exceeded its sample limit" }
                val sample = JSONObject().put("sequence", session.samples.length())
                    .put("observed_elapsed_ms", observed).put("fix_elapsed_ms", fix).put("fix_timestamp_ms", location.time)
                    .put("provider", location.provider ?: "unknown")
                    .put("latitude", location.latitude).put("longitude", location.longitude).put("accuracy_m", location.accuracy.toDouble())
                    .put("altitude_m", if (location.hasAltitude()) location.altitude else JSONObject.NULL)
                    .put("altitude_accuracy_m", if (location.hasVerticalAccuracy() && location.hasAltitude()) location.verticalAccuracyMeters.toDouble() else JSONObject.NULL)
                    .put("mock", false)
                session.samples.put(sample)
                prepareTraceIfReady(session)
            }
        } catch (error: Throwable) { fail(session, safeError(error)) }
    }

    private fun rejectRawWarmup(session: Session) {
        synchronized(lock) {
            if (current !== session || session.state != "collecting") return
            checkCollectionAllowed()
            check(session.rawEpochs.length() == 0) { "Raw GNSS measurements became unavailable after collection began" }
            check(session.rejectedRawEpochs < RawGnssCollector.MAX_REJECTED_EPOCHS) { "Raw GNSS warmup exceeded its callback limit" }
            session.rejectedRawEpochs++
        }
    }

    private fun observeRaw(session: Session, epoch: JSONObject): Boolean = synchronized(lock) {
        if (current !== session || session.state != "collecting") return@synchronized false
        checkCollectionAllowed()
        check(session.rawEpochs.length() < RawGnssCollector.MAX_EPOCHS) { "Raw GNSS trace exceeded its epoch limit" }
        epoch.put("sequence", session.rawEpochs.length())
        session.rawEpochs.put(epoch)
        val checks = JSONObject(NativeLocationCore.rawGnssProgress(boundedTraceJson(buildTrace(session))))
        // Retain failure details before the policy check can terminate collection.
        session.rawChecks = checks
        // Rust decides whether this is an excluded startup candidate or a fatal
        // interruption. Neither the request anchor nor its deadline is restarted.
        val errors = checks.getJSONArray("error_codes")
        val codes = (0 until errors.length()).map { errors.getString(it) }
        when (checks.getString("collection_action")) {
            "discard-startup" -> {
                check(session.rawEpochs.length() == 1 && session.samples.length() == 0) {
                    "Raw GNSS startup discard is not allowed after evidence collection begins"
                }
                session.rawEpochs.remove(0)
                if (!checks.getBoolean("satellite_count_valid")) {
                    session.rawDiagnostics.warmup(NativeLocationDiagnostics.RawWarmup.INSUFFICIENT_SATELLITES)
                }
                rejectRawWarmup(session)
                return@synchronized false
            }
            "retain" -> Unit
            else -> { session.rawPolicyRejected = true; error(rawPolicyFailure(codes, checks)) }
        }
        if (session.firstRawAdmittedMs == null) session.firstRawAdmittedMs = elapsed(session)
        prepareTraceIfReady(session)
        true
    }

    /** Called with the session lock held, after either native collector advances. */
    private fun prepareTraceIfReady(session: Session) {
        if (session.samples.length() == 0 || !session.cameraSelection.mayFreeze) return
        val policy = session.request.getJSONObject("policy")
        val first = session.samples.getJSONObject(0)
        val last = session.samples.getJSONObject(session.samples.length() - 1)
        val duration = policy.getLong("duration_ms")
        if (session.samples.length() < policy.getInt("min_samples") ||
            last.getLong("fix_elapsed_ms") - first.getLong("fix_elapsed_ms") < duration ||
            last.getLong("observed_elapsed_ms") - first.getLong("observed_elapsed_ms") < duration ||
            last.getLong("fix_timestamp_ms") - first.getLong("fix_timestamp_ms") < duration) return
        val trace = buildTrace(session)
        val traceJson = boundedTraceJson(trace)
        if (session.rawRequired) {
            val checks = JSONObject(NativeLocationCore.rawGnssProgress(traceJson))
            session.rawChecks = checks
            val errors = checks.getJSONArray("error_codes")
            val codes = (0 until errors.length()).map { errors.getString(it) }
            if (checks.getString("collection_action") != "retain") {
                session.rawPolicyRejected = checks.getString("collection_action") == "reject"
                error(rawPolicyFailure(codes, checks))
            }
            if (!checks.getBoolean("ready")) return
        }
        NativeLocationCore.validateTrace(traceJson, trace.getLong("ended_at_ms"))
        session.trace = trace
        session.state = "ready"
        session.timing.mark(NativeSessionGuards.PhaseTimings.Mark.READY, SystemClock.elapsedRealtimeNanos())
        detach(session, keepDeadline = true)
    }

    private fun buildTrace(session: Session): JSONObject {
        val trace = JSONObject().put("version", 1).put("type", "nonverba-location-trace")
            .put("request", session.request).put("profile", "native-android").put("permission_precision", "fine")
            .put("uncertainty_semantics", "android-68-percent").put("capture_correlation", "none")
            .put("started_at_ms", session.startedAt).put("ended_at_ms", session.terminal.wallMs ?: System.currentTimeMillis()).put("elapsed_ms", elapsed(session))
            .put("samples", session.samples)
        if (session.rawRequired) {
            trace.put("raw_gnss", JSONObject().put("version", 1).put("type", "android-raw-gnss")
                .put("anchor_elapsed_realtime_ns", session.anchorNs.toString())
                .put("full_tracking_requested", session.rawCollector?.fullTrackingRequested ?: (Build.VERSION.SDK_INT >= 31))
                .put("collection_interval_ms", RawGnssCollector.COLLECTION_INTERVAL_MS)
                .put("rejected_epoch_count", session.rejectedRawEpochs)
                .put("epochs", session.rawEpochs))
        }
        return trace
    }

    private fun boundedTraceJson(trace: JSONObject): String = trace.toString().also {
        check(it.toByteArray(Charsets.UTF_8).size <= RawGnssCollector.MAX_TRACE_BYTES) { "Native location trace exceeds the 2 MiB evidence limit" }
    }

    private fun checkCollectionAllowed() {
        check(isForeground()) { "Location collection left the foreground" }
        check(hasPrecisePermission()) { "Precise location permission was revoked" }
    }

    private fun sampleSpan(session: Session): Long {
        if (session.samples.length() < 2) return 0
        fun timing(sample: JSONObject) = NativeLocationDiagnostics.Timing(
            sample.getLong("fix_elapsed_ms"), sample.getLong("observed_elapsed_ms"), sample.getLong("fix_timestamp_ms"))
        return NativeLocationDiagnostics.spanMs(timing(session.samples.getJSONObject(0)),
            timing(session.samples.getJSONObject(session.samples.length() - 1)))
    }

    private fun snapshot(session: Session): JSONObject {
        val result = session.frozenStatus?.let { JSONObject(it) } ?: liveSnapshot(session)
        return result.put("attempt_report_status", session.attemptStatus)
            .put("attempt_report_error", session.attemptError ?: JSONObject.NULL)
            .put("attempt_id", session.id)
    }

    private fun liveSnapshot(session: Session): JSONObject {
        val result = JSONObject().put("ok", session.state !in setOf("error", "cancelled"))
            .put("session_id", session.id).put("state", session.state)
            .put("key_profile", session.key.profile).put("key_fingerprint", NativeLocationCore.fingerprint(session.spki))
            .put("elapsed_ms", session.terminal.elapsedMs ?: session.trace?.getLong("elapsed_ms") ?: elapsed(session))
            .put("eligible_samples", session.samples.length()).put("rejected_samples", session.rejectedSamples)
            .put("selected_provider", session.selectedProvider ?: JSONObject.NULL)
            .put("timing_diagnostics", JSONObject(session.timing.snapshot()).put("unsigned", true))
            .put("failure_stage", session.failureStage ?: JSONObject.NULL).put("span_ms", sampleSpan(session))
        if (session.rawRequired) {
            result.put("raw_gnss_epochs", session.rawEpochs.length()).put("raw_gnss_rejected_epochs", session.rejectedRawEpochs)
            session.rawChecks?.let { result.put("raw_gnss_checks", it) }
            val diagnostic = session.rawDiagnostics.snapshot()
            val reasons = JSONObject()
            diagnostic.warmupReasons.forEach { (reason, count) -> reasons.put(reason.label, count) }
            result.put("raw_gnss_diagnostics", JSONObject()
                .put("unsigned", true).put("registration", diagnostic.registration.label)
                .put("registration_api", diagnostic.branch?.label ?: JSONObject.NULL)
                .put("receiver_status", diagnostic.receiverStatus?.label ?: JSONObject.NULL)
                .put("receiver_status_code", diagnostic.receiverStatusCode ?: JSONObject.NULL)
                .put("callback_count", diagnostic.callbackCount)
                .put("last_callback_elapsed_ms", diagnostic.lastCallbackElapsedMs ?: JSONObject.NULL)
                .put("cadence_skipped", diagnostic.cadenceSkipped).put("warmup_reasons", reasons)
                .put("os_has_measurements", diagnostic.osHasMeasurements ?: JSONObject.NULL)
                .put("os_hardware_year", diagnostic.osHardwareYear ?: JSONObject.NULL)
                .put("os_hardware_model", diagnostic.osHardwareModel ?: JSONObject.NULL))
        }
        if (session.selectedProvider == LocationManager.GPS_PROVIDER) {
            result.put("gnss_status_diagnostics", NativeGnssStatusCollector.snapshot(session.gnssStatusDiagnostics))
        }
        session.error?.let { result.put("error", it) }
        if (session.samples.length() > 0 && (session.state == "collecting" || session.trace != null)) {
            result.put("selected", selectedLocation(session.samples.getJSONObject(session.samples.length() - 1)))
        }
        session.cameraSelected?.let { result.put("capture_selected", it) }
        session.result?.let { result.put("result", it) }
        return result
    }

    private fun selectedLocation(sample: JSONObject): JSONObject = JSONObject()
        .put("latitude", sample.getDouble("latitude")).put("longitude", sample.getDouble("longitude"))
        .put("accuracy_m", sample.getDouble("accuracy_m"))
        .put("altitude_m", sample.get("altitude_m")).put("altitude_accuracy_m", sample.get("altitude_accuracy_m"))
        .put("timestamp_ms", sample.getLong("fix_timestamp_ms")).put("source", "device-geolocation")

    private fun elapsed(session: Session) = session.terminal.elapsedMs ?: ((SystemClock.elapsedRealtimeNanos() - session.anchorNs) / 1_000_000).coerceAtLeast(0)

    /** Called with lock held. Freeze every public counter before queued teardown changes diagnostics. */
    private fun freezeTerminal(session: Session) {
        session.terminal.freeze(elapsed(session), System.currentTimeMillis())
        if (session.frozenStatus == null) session.frozenStatus = liveSnapshot(session).toString()
    }

    /** Called under lock at seal entry, inside the key gate, and before result delivery. */
    private fun requireFinalizationAllowed(session: Session, stage: NativeSessionGuards.Stage): Long {
        NativeSessionGuards.requireAuthority(foreground, closed,
            current === session && session.state == "finalizing", hasPrecisePermission())
        val nowMs = System.currentTimeMillis()
        val elapsedNs = SystemClock.elapsedRealtimeNanos()
        val elapsedMs = NativeSessionGuards.elapsedMillis(session.startedAt, session.anchorNs, nowMs, elapsedNs)
        if (stage == NativeSessionGuards.Stage.SEAL_ENTRY) session.timing.mark(NativeSessionGuards.PhaseTimings.Mark.SEAL_ENTRY, elapsedNs)
        if (stage == NativeSessionGuards.Stage.RESULT_DELIVERY) session.timing.mark(NativeSessionGuards.PhaseTimings.Mark.DELIVERY_CHECK, elapsedNs)
        val policy = session.request.getJSONObject("policy")
        val maximumAge = policy.getLong("max_fix_age_ms")
        val finalizationDelay = if (policy.has("max_finalization_delay_ms")) policy.getLong("max_finalization_delay_ms") else null
        val traceEnd = requireNotNull(session.trace).getLong("elapsed_ms")
        val sample = session.samples.getJSONObject(session.samples.length() - 1)
        val challenge = session.request.getJSONObject("challenge")
        NativeSessionGuards.requireRequestWindow(nowMs, challenge.getLong("issued_at"), challenge.getLong("expires_at"))
        NativeSessionGuards.requireLocationFreshness(elapsedMs, traceEnd, sample.getLong("fix_elapsed_ms"), maximumAge, finalizationDelay,
            NativeSessionGuards.FreshnessContext(NativeSessionGuards.Sensor.LOCATION_FIX, stage))
        if (session.rawRequired) {
            val epoch = session.rawEpochs.getJSONObject(session.rawEpochs.length() - 1)
            val measurementNs = epoch.getJSONObject("clock").getString("elapsed_realtime_ns").toLong()
            check(measurementNs >= session.anchorNs) { "Raw GNSS measurement predates its native session" }
            NativeSessionGuards.requireLocationFreshness(elapsedMs, traceEnd, (measurementNs - session.anchorNs) / 1_000_000, maximumAge, finalizationDelay,
                NativeSessionGuards.FreshnessContext(NativeSessionGuards.Sensor.RAW_GNSS, stage))
        }
        return nowMs
    }

    private fun hasPrecisePermission() =
        activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun fail(session: Session, message: String, trigger: String? = null) {
        synchronized(lock) {
            if (current !== session || session.state !in ACTIVE_STATES) return
            session.failureStage = session.state
            session.state = "error"
            session.error = message.take(400)
            freezeTerminal(session)
            val reportTrigger = when {
                session.rawPolicyRejected -> "raw-policy-rejection"
                trigger == "collection-timeout" && NativeGpsAttemptEligibility.noCallbackTimeout(
                    session.failureStage, session.rawRequired, elapsed(session), SESSION_TIMEOUT_MS,
                    session.rawDiagnostics.snapshot().callbackCount, session.rawEpochs.length(), session.rejectedRawEpochs
                ) -> "collection-timeout"
                else -> null
            }
            if (reportTrigger != null) {
                try { retainAttempt(session, reportTrigger) }
                catch (error: Throwable) { session.attemptStatus = "snapshot-failed"; session.attemptError = safeError(error) }
            }
        }
        main.post { detach(session) }
    }

    /** Single terminal invocation; owns immutable bytes and key even after a retry replaces current. */
    private fun retainAttempt(session: Session, trigger: String) {
        session.attemptStatus = "pending"
        val frozen = JSONObject(requireNotNull(session.frozenStatus))
        val raw = frozen.getJSONObject("raw_gnss_diagnostics")
        val collectorStatus = JSONObject()
        for (name in listOf("raw_gnss_diagnostics", "gnss_status_diagnostics", "timing_diagnostics")) {
            frozen.optJSONObject(name)?.let { collectorStatus.put(name, it) }
        }
        val snapshot = JSONObject().put("version", 1).put("type", "nonverba-gps-attempt-snapshot")
            .put("attempt_id", session.id).put("original_request_json", session.originalRequest)
            .put("stopping_stage", session.failureStage).put("local_timeout_ms", SESSION_TIMEOUT_MS)
            .put("terminal_trigger", trigger)
            .put("partial_trace", buildTrace(session))
            .put("diagnostics", JSONObject().put("rejected_fixes", session.rejectedSamples)
                .put("raw_callback_count", raw.getInt("callback_count"))
                .put("last_raw_callback_elapsed_ms", raw.get("last_callback_elapsed_ms"))
                .put("permission_granted_elapsed_ms", session.permissionGrantedMs ?: JSONObject.NULL)
                .put("first_raw_admitted_elapsed_ms", session.firstRawAdmittedMs ?: JSONObject.NULL)
                .put("collector_status_json", collectorStatus.toString())).toString()
        val record = JSONObject().put("version", 1).put("type", "nonverba-gps-attempt-export")
            .put("attempt_id", session.id).put("status", "unsigned-pending")
            .put("original_request_json", session.originalRequest).put("native_snapshot_json", snapshot)
            .put("report_base64", JSONObject.NULL).put("error", JSONObject.NULL)
        worker.execute {
            fun publish() {
                val text = record.toString()
                synchronized(lock) { session.attemptExport = text }
                attempts.put(session.id, text.toByteArray(Charsets.UTF_8))
            }
            try { publish() }
            catch (error: Throwable) {
                record.put("status", "unsigned-storage-failed").put("error", safeError(error))
                synchronized(lock) { session.attemptExport = record.toString(); session.attemptStatus = "storage-failed"; session.attemptError = safeError(error) }
                return@execute // Do not claim a durable report if the initial journal write failed.
            }
            try {
                val signer = LocationEvidenceSigner(session.key) { true } // Immutable failed snapshot capability, no sensor authority.
                val signed = JSONObject(NativeLocationCore.sealAttempt(snapshot, session.spki, System.currentTimeMillis(), signer))
                record.put("report_base64", signed.getString("report_base64"))
                    .put("native_snapshot_json", JSONObject.NULL).put("status", "signed")
            } catch (error: Throwable) {
                record.put("status", "unsigned-signing-failed").put("error", safeError(error))
            }
            try {
                publish()
                synchronized(lock) { session.attemptStatus = record.getString("status"); session.attemptError = record.optString("error").takeIf { it != "null" } }
            } catch (error: Throwable) {
                record.put("status", if (record.getString("status") == "signed") "signed-storage-failed" else "unsigned-storage-failed")
                    .put("error", safeError(error))
                synchronized(lock) { session.attemptExport = record.toString(); session.attemptStatus = "storage-failed"; session.attemptError = safeError(error) }
            }
        }
    }

    private fun detach(session: Session, keepDeadline: Boolean = false) {
        try {
            session.listener?.let { manager.removeUpdates(it) }
        } finally {
            session.listener = null
            try {
                session.rawCollector?.stop()
            } finally {
                session.rawCollector = null
                session.gnssStatusCollector?.stop()
                session.gnssStatusCollector = null
                if (!keepDeadline) {
                    session.timeout?.let { main.removeCallbacks(it) }
                    session.timeout = null
                }
            }
        }
    }

    // Successful-proof reservation stores only nonce IDs. The separate bounded
    // attempt journal deliberately retains failed partial traces in app-private storage.
    private fun readLedger(): JSONObject {
        val file = ledger.baseFile
        if (!file.exists() && !File(file.path + ".bak").exists()) return JSONObject()
        return ledger.openRead().use {
            val bytes = it.readBytes()
            check(bytes.size <= 1024 * 1024) { "Native capture replay ledger is too large" }
            JSONObject(bytes.toString(Charsets.UTF_8))
        }
    }

    private fun reserve(session: Session) {
        val entries = readLedger()
        val nonce = session.request.getJSONObject("challenge").getString("id")
        check(!entries.has(nonce)) { "This challenge was already finalized on this device" }
        check(entries.length() < 4096) { "Native capture replay ledger is full" }
        entries.put(nonce, System.currentTimeMillis())
        val stream = ledger.startWrite()
        try { stream.write(entries.toString().toByteArray(Charsets.UTF_8)); ledger.finishWrite(stream) }
        catch (error: Throwable) { ledger.failWrite(stream); throw error }
    }

    /** Rust's bounded local diagnostic is unsigned and never enters the evidence trace. */
    private fun rawPolicyFailure(codes: List<String>, checks: JSONObject): String {
        val diagnostic = checks.optJSONObject("alignment_diagnostic")?.optString("summary")
            ?.takeIf { it.isNotBlank() }?.take(240)
        return "Raw GNSS policy failed: ${codes.joinToString(", ")}" +
            (diagnostic?.let { "; unsigned timing: $it" } ?: "")
    }

    private fun safeError(error: Throwable) = (error.message ?: "Native location collection failed").take(400)
    private fun failure(error: Throwable) = failureMessage(safeError(error))
    private fun failureMessage(message: String) = JSONObject().put("ok", false).put("state", "error").put("error", message).toString()

    private companion object {
        const val MAX_REQUEST = 64 * 1024
        const val MAX_JPEG = 32 * 1024 * 1024
        const val SESSION_TIMEOUT_MS = 60_000L
        val ACTIVE_STATES = setOf("requesting-permission", "collecting", "ready", "finalizing")
    }
}
