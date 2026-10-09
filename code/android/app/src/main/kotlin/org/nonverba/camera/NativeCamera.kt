// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.RectF
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureFailure
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.AtomicFile
import android.util.Base64
import android.util.Log
import android.util.Size
import android.view.Gravity
import android.view.Surface
import android.view.TextureView
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.max

/**
 * Camera2 acquisition and lifecycle glue. Captured JPEG bytes and result metadata
 * remain inside a native session until Rust has sealed them with the native key.
 * GPS is explicit caller-submitted metadata; a composed location proof verifies
 * its own independent collection requirements. This adapter is not attestation.
 */
internal class NativeCamera(
    private val activity: Activity,
    private val isForeground: () -> Boolean,
    private val requestCameraPermission: ((Boolean) -> Unit) -> Unit
) {
    private val lock = Any()
    private val main = Handler(Looper.getMainLooper())
    private val cameraThread = HandlerThread("nonverba-camera-capture").apply { start() }
    private val cameraHandler = Handler(cameraThread.looper)
    private val worker = Executors.newSingleThreadExecutor()
    private val manager = activity.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    private val ledger = AtomicFile(File(activity.noBackupFilesDir, "native-camera-capture-ledger-v1.json"))
    private var current: Session? = null
    private var closed = false
    private var lifecycleGeneration = 0L
    @Volatile private var foreground = false

    private class Session(
        val id: String,
        val request: JSONObject,
        val key: NativeMediaCaptureKey,
        val identity: NativeMediaCaptureKey.PublicIdentity,
        val anchorNs: Long,
        val anchorWallMs: Long
    ) {
        var state = "requesting-permission"
        var error: String? = null
        val timing = NativeSessionGuards.PhaseTimings()
        var timeout: Runnable? = null
        var captureTimeout: Runnable? = null
        var dialog: Dialog? = null
        var texture: TextureView? = null
        var statusText: TextView? = null
        var captureButton: Button? = null
        var cameraId = ""
        var characteristics: CameraCharacteristics? = null
        var previewSize: Size? = null
        var jpegSize: Size? = null
        var device: CameraDevice? = null
        var captureSession: CameraCaptureSession? = null
        var deviceOpenPending = false
        var configurationPending = false
        var previewSurface: Surface? = null
        var reader: ImageReader? = null
        var captureRequestedNs = 0L
        var jpegOrientation = 0
        var location: String? = null
        var locationTimestampMs = 0L
        var image: ByteArray? = null
        var imageTimestampNs = 0L
        var imageReceivedNs = 0L
        var imageWidth = 0
        var imageHeight = 0
        var resultMetadata: JSONObject? = null
        var result: JSONObject? = null
        val cleanupErrors = mutableListOf<String>()
    }

    @JavascriptInterface
    fun capabilities(): String = try {
        val key = NativeAttestedKeyStore.mediaKey(activity)
        val identity = key.publicIdentity()
        JSONObject().put("available", true).put("version", 1).put("platform", "android-camera2")
            .put("key_fingerprint", identity.fingerprint)
            .put("key_profile", key.profile)
            .put("public_key_spki_b64", Base64.encodeToString(identity.spki, Base64.NO_WRAP))
            .put("keystore_security_level", identity.securityLevel)
            .put("strongbox_requested", identity.strongBoxRequested).put("strongbox_fallback", identity.strongBoxFallback)
            .put("camera_permission", hasPermission()).put("hardware_attested", false)
            .put("collection_attested", false).put("camera_freshness_proven", false).toString()
    } catch (error: Throwable) { failure(error) }

    @JavascriptInterface
    fun begin(challengeJson: String, locationRequestJson: String): String = try {
        require(challengeJson.length <= MAX_REQUEST && locationRequestJson.length <= MAX_REQUEST) { "Camera request is too large" }
        val request = JSONObject(NativeCameraCore.validateRequest(challengeJson, locationRequestJson, System.currentTimeMillis()))
        val generation = synchronized(lock) {
            check(!closed && current?.state !in ACTIVE_STATES) { "Native camera is closed or already active" }
            lifecycleGeneration
        }
        val key = NativeAttestedKeyStore.mediaKey(activity)
        val identity = key.publicIdentity()
        val session = synchronized(lock) {
            check(!closed && lifecycleGeneration == generation) { "Camera setup was cancelled during key provisioning" }
            check(current?.state !in ACTIVE_STATES) { "A native camera session is already active" }
            current?.let { previous ->
                check(previous.captureSession == null && previous.device == null && previous.reader == null &&
                    previous.previewSurface == null && previous.dialog == null && previous.texture == null &&
                    !previous.deviceOpenPending && !previous.configurationPending) {
                    "Previous native camera resources could not be released; cancel or leave the page to retry cleanup"
                }
            }
            val nonce = request.getJSONObject("challenge").getString("id")
            check(!readLedger().has(nonce)) { "This camera challenge was already used on this device" }
            val anchor = NativeCameraTiming.anchor({ UUID.randomUUID().toString() },
                { System.currentTimeMillis() }, { SystemClock.elapsedRealtimeNanos() })
            Session(anchor.sessionId, request, key, identity, anchor.elapsedNs, anchor.wallMs).also { current = it }
        }
        main.post { start(session) }
        synchronized(lock) { snapshot(session).toString() }
    } catch (error: Throwable) { failure(error) }

    @JavascriptInterface
    fun status(sessionId: String): String = synchronized(lock) {
        val session = current?.takeIf { it.id == sessionId }
        if (session == null) failureMessage("Unknown native camera session") else snapshot(session).toString()
    }

    /** Called only after the operator presses the native shutter and location is obtained. */
    @JavascriptInterface
    fun capture(sessionId: String, locationJson: String): String = try {
        require(locationJson.length <= MAX_REQUEST) { "Camera location metadata is too large" }
        val session = synchronized(lock) {
            val session = current?.takeIf { it.id == sessionId } ?: error("Unknown native camera session")
            check(session.state == "awaiting-location") { session.error ?: "Use the native shutter before submitting location metadata" }
            check(foreground && hasPermission()) { "Native capture requires foreground camera permission" }
            session.location = NativeCameraCore.validateLocation(session.request.toString(), locationJson, System.currentTimeMillis())
            session.locationTimestampMs = JSONObject(requireNotNull(session.location)).getLong("timestamp_ms")
            reserve(session) // Reserve before any exposure; failed attempts cannot reuse this challenge.
            session.state = "capturing"
            session
        }
        cameraHandler.post { takePicture(session) }
        synchronized(lock) { snapshot(session).toString() }
    } catch (error: Throwable) { failure(error) }

    @JavascriptInterface
    fun cancel(sessionId: String): String = synchronized(lock) {
        val session = current?.takeIf { it.id == sessionId } ?: return@synchronized failureMessage("Unknown native camera session")
        if (session.state in ACTIVE_STATES) {
            session.state = "cancelled"
            session.error = "Native camera session was cancelled"
            session.image = null
        }
        main.post { detach(session) } // Terminal sessions may still own a failed release.
        snapshot(session).toString()
    }

    /** Revocation only; safe before another subsystem's potentially slow OS cleanup. */
    fun revokeAuthority() { foreground = false }

    /** Main-thread lifecycle hook. Completed evidence may still be exported. */
    fun pause() {
        foreground = false
        val session = synchronized(lock) {
            lifecycleGeneration++
            current?.also {
                if (it.state in ACTIVE_STATES) {
                    it.state = "cancelled"
                    it.error = "The application left the foreground; request a new camera session"
                    it.image = null
                }
            }
        }
        if (session != null) detach(session)
    }

    fun destroy() {
        revokeAuthority()
        synchronized(lock) { closed = true }
        NativeLifecycleCleanup.run(listOf(
            NativeLifecycleCleanup.Action("camera destruction cleanup", ::pause),
            NativeLifecycleCleanup.Action("camera worker shutdown") { worker.shutdown() },
            NativeLifecycleCleanup.Action("camera callback thread shutdown") { cameraThread.quitSafely() }
        )) { Log.w("NonverbaLifecycle", it.label, it.error) }
    }

    private fun start(session: Session) {
        synchronized(lock) { if (!isCurrent(session, "requesting-permission")) return }
        if (!isForeground()) { fail(session, "Native camera requires the foreground application"); return }
        foreground = true
        val timeout = Runnable { fail(session, "Native camera session timed out; start a new request") }
        session.timeout = timeout
        main.postDelayed(timeout, SESSION_TIMEOUT_MS)
        requestCameraPermission { granted ->
            synchronized(lock) { if (!isCurrent(session, "requesting-permission")) return@requestCameraPermission }
            if (!granted || !isForeground() || !hasPermission()) fail(session, "Foreground camera permission is required")
            else showPreview(session)
        }
    }

    private fun showPreview(session: Session) {
        try {
            check(isForeground() && hasPermission()) { "Foreground camera permission is required" }
            val chosen = manager.cameraIdList.map { it to manager.getCameraCharacteristics(it) }
                .filter { (_, c) -> c.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)?.getOutputSizes(ImageFormat.JPEG)?.isNotEmpty() == true }
                .sortedWith(compareBy<Pair<String, CameraCharacteristics>> {
                    if (it.second.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK) 0 else 1
                }.thenBy {
                    if (it.second.get(CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE) == CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME) 0 else 1
                }).firstOrNull() ?: error("No compatible Android camera is available")
            val map = requireNotNull(chosen.second.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP))
            val jpeg = map.getOutputSizes(ImageFormat.JPEG).filter { it.width.toLong() * it.height <= MAX_PIXELS && it.width >= 256 && it.height >= 256 }
                .maxByOrNull { it.width.toLong() * it.height } ?: error("No bounded JPEG capture size is available")
            val ratio = jpeg.width.toDouble() / jpeg.height
            val previews = map.getOutputSizes(SurfaceTexture::class.java)
                .filter { it.width <= 1920 && it.height <= 1080 }
            val preview = previews.minWithOrNull(compareBy<Size> { abs(it.width.toDouble() / it.height - ratio) }
                .thenByDescending { it.width.toLong() * it.height }) ?: error("No compatible preview stream is available")
            synchronized(lock) {
                if (!isCurrent(session, "requesting-permission")) return
                session.cameraId = chosen.first
                session.characteristics = chosen.second
                session.jpegSize = jpeg
                session.previewSize = preview
                session.state = "opening"
            }
            val dialog = Dialog(activity, android.R.style.Theme_Material_NoActionBar_Fullscreen)
            val layout = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundColor(Color.BLACK)
                setPadding(16, 16, 16, 16)
            }
            val title = TextView(activity).apply {
                setText(R.string.camera_title)
                textSize = 20f
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
            }
            val texture = TextureView(activity)
            val status = TextView(activity).apply {
                setText(R.string.camera_opening)
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                setPadding(0, 12, 0, 12)
            }
            val shutter = Button(activity).apply {
                setText(R.string.camera_shutter)
                isEnabled = false
                setOnClickListener { requestLocation(session) }
            }
            val cancelButton = Button(activity).apply {
                setText(R.string.camera_cancel)
                setOnClickListener { this@NativeCamera.cancel(session.id) }
            }
            layout.addView(title, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            layout.addView(texture, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            layout.addView(status)
            layout.addView(shutter)
            layout.addView(cancelButton)
            dialog.setContentView(layout)
            dialog.setCanceledOnTouchOutside(false)
            dialog.setOnCancelListener { cancel(session.id) }
            session.dialog = dialog
            session.texture = texture
            session.statusText = status
            session.captureButton = shutter
            texture.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
                    configureTransform(session, width, height)
                    cameraHandler.post { openCamera(session, surface) }
                }
                override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) { configureTransform(session, width, height) }
                override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
                    synchronized(lock) {
                        if (current === session && session.state in PREVIEW_STATES) fail(session, "Native camera preview was interrupted")
                    }
                    return true
                }
                override fun onSurfaceTextureUpdated(surface: SurfaceTexture) = Unit
            }
            dialog.show()
            dialog.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } catch (error: Throwable) { fail(session, safeError(error)) }
    }

    private fun requestLocation(session: Session) {
        synchronized(lock) {
            if (!isCurrent(session, "preview")) return
            if (!isForeground() || !hasPermission()) { fail(session, "Foreground camera permission is required"); return }
            session.state = "awaiting-location"
            session.captureButton?.isEnabled = false
            session.statusText?.setText(R.string.camera_location_pending)
        }
    }

    @SuppressLint("MissingPermission") // Rechecked immediately before the platform call and throughout capture.
    private fun openCamera(session: Session, texture: SurfaceTexture) {
        try {
            synchronized(lock) {
                if (!isCurrent(session, "opening")) return
                check(foreground && hasPermission()) { "Camera permission was revoked" }
                val previewSize = requireNotNull(session.previewSize)
                texture.setDefaultBufferSize(previewSize.width, previewSize.height)
                session.previewSurface = Surface(texture)
                val size = requireNotNull(session.jpegSize)
                session.reader = ImageReader.newInstance(size.width, size.height, ImageFormat.JPEG, 2).apply {
                    setOnImageAvailableListener({ receiveImage(session, it) }, cameraHandler)
                }
                session.deviceOpenPending = true
            }
            manager.openCamera(session.cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(device: CameraDevice) {
                    val configure = synchronized(lock) {
                        session.deviceOpenPending = false
                        session.device = device
                        isCurrent(session, "opening")
                    }
                    if (configure) configureSession(session, device)
                    else main.post { detach(session) }
                }
                override fun onDisconnected(device: CameraDevice) {
                    synchronized(lock) { session.deviceOpenPending = false; session.device = device }
                    fail(session, "Native camera disconnected")
                    main.post { detach(session) }
                }
                override fun onError(device: CameraDevice, error: Int) {
                    synchronized(lock) { session.deviceOpenPending = false; session.device = device }
                    fail(session, "Native camera failed ($error)")
                    main.post { detach(session) }
                }
            }, cameraHandler)
        } catch (error: Throwable) {
            synchronized(lock) { session.deviceOpenPending = false }
            fail(session, safeError(error))
        }
    }

    @Suppress("DEPRECATION") // API 21 session overload also supports the APK's API 26 floor.
    private fun configureSession(session: Session, device: CameraDevice) {
        try {
            val outputs = synchronized(lock) {
                if (!isCurrent(session, "opening")) return
                session.configurationPending = true
                listOf(requireNotNull(session.previewSurface), requireNotNull(session.reader).surface)
            }
            device.createCaptureSession(outputs, object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(captureSession: CameraCaptureSession) {
                    try {
                        synchronized(lock) {
                            session.configurationPending = false
                            session.captureSession = captureSession
                            if (!isCurrent(session, "opening")) { main.post { detach(session) }; return }
                            check(foreground && hasPermission()) { "Camera permission was revoked" }
                            val request = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
                                addTarget(requireNotNull(session.previewSurface))
                                set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
                                set(CaptureRequest.CONTROL_ENABLE_ZSL, false)
                                set(CaptureRequest.SENSOR_TEST_PATTERN_MODE, CaptureRequest.SENSOR_TEST_PATTERN_MODE_OFF)
                            }
                            captureSession.setRepeatingRequest(request.build(), null, cameraHandler)
                            session.state = "preview"
                        }
                        main.post {
                            synchronized(lock) {
                                if (isCurrent(session, "preview")) {
                                    session.captureButton?.isEnabled = true
                                    session.statusText?.setText(R.string.camera_ready)
                                }
                            }
                        }
                    } catch (error: Throwable) { fail(session, safeError(error)) }
                }
                override fun onConfigureFailed(captureSession: CameraCaptureSession) {
                    synchronized(lock) { session.configurationPending = false; session.captureSession = captureSession }
                    fail(session, "Native camera stream configuration failed")
                    main.post { detach(session) }
                }
            }, cameraHandler)
        } catch (error: Throwable) {
            synchronized(lock) { session.configurationPending = false }
            fail(session, safeError(error))
        }
    }

    private fun takePicture(session: Session) {
        try {
            synchronized(lock) {
                if (!isCurrent(session, "capturing")) return
                check(foreground && hasPermission()) { "Camera permission was revoked before exposure" }
                val wallMs = System.currentTimeMillis()
                val elapsedNs = SystemClock.elapsedRealtimeNanos()
                val challenge = session.request.getJSONObject("challenge")
                NativeSessionGuards.requireRequestWindow(wallMs, challenge.getLong("issued_at"), challenge.getLong("expires_at"))
                val delayMs = NativeCameraTiming.exposureDelayMs(session.anchorWallMs, session.anchorNs,
                    wallMs, elapsedNs, session.locationTimestampMs)
                if (delayMs > 0) {
                    // GPS and the camera's monotonic/wall mapping can straddle a
                    // second boundary. Schedule a later real exposure rather than
                    // modifying the fix, acquisition time, or verifier allowance.
                    // Every delayed dispatch re-enters all session/lifecycle/clock
                    // checks above; the original overall session deadline remains.
                    cameraHandler.postDelayed({ takePicture(session) }, delayMs)
                    return
                }
                val device = requireNotNull(session.device)
                val captureSession = requireNotNull(session.captureSession)
                val reader = requireNotNull(session.reader)
                session.jpegOrientation = jpegOrientation(requireNotNull(session.characteristics))
                val request = device.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE).apply {
                    addTarget(reader.surface)
                    set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
                    set(CaptureRequest.CONTROL_ENABLE_ZSL, false)
                    set(CaptureRequest.SENSOR_TEST_PATTERN_MODE, CaptureRequest.SENSOR_TEST_PATTERN_MODE_OFF)
                    set(CaptureRequest.JPEG_ORIENTATION, session.jpegOrientation)
                    set(CaptureRequest.JPEG_QUALITY, 95.toByte())
                    setTag(session.id)
                }.build()
                session.captureRequestedNs = SystemClock.elapsedRealtimeNanos()
                val deadline = Runnable { fail(session, "Native camera did not deliver a matching image and exposure result") }
                session.captureTimeout = deadline
                main.postDelayed(deadline, CAPTURE_TIMEOUT_MS)
                captureSession.capture(request, object : CameraCaptureSession.CaptureCallback() {
                    override fun onCaptureCompleted(captureSession: CameraCaptureSession, request: CaptureRequest, result: TotalCaptureResult) {
                        receiveResult(session, request, result)
                    }
                    override fun onCaptureFailed(captureSession: CameraCaptureSession, request: CaptureRequest, failure: CaptureFailure) {
                        fail(session, "Native camera exposure failed (${failure.reason})")
                    }
                    override fun onCaptureSequenceAborted(captureSession: CameraCaptureSession, sequenceId: Int) {
                        fail(session, "Native camera exposure was aborted")
                    }
                }, cameraHandler)
            }
            main.post { session.statusText?.setText(R.string.camera_capturing) }
        } catch (error: Throwable) { fail(session, safeError(error)) }
    }

    private fun receiveImage(session: Session, reader: ImageReader) {
        try {
            val image = reader.acquireNextImage() ?: return
            image.use {
                synchronized(lock) {
                    if (!isCurrent(session, "capturing")) return
                    check(foreground && hasPermission()) { "Camera permission was revoked during image delivery" }
                    check(session.image == null) { "Native camera delivered duplicate image data" }
                    check(image.format == ImageFormat.JPEG && image.planes.size == 1) { "Native camera returned an unexpected image format" }
                    val buffer = image.planes[0].buffer
                    check(buffer.remaining() in 4..MAX_JPEG_BYTES) { "Native camera JPEG exceeds its size limit" }
                    val jpeg = ByteArray(buffer.remaining())
                    buffer.get(jpeg)
                    session.image = jpeg
                    session.imageTimestampNs = image.timestamp
                    session.imageReceivedNs = SystemClock.elapsedRealtimeNanos()
                    session.imageWidth = image.width
                    session.imageHeight = image.height
                    sealIfReady(session)
                }
            }
        } catch (error: Throwable) { fail(session, safeError(error)) }
    }

    private fun receiveResult(session: Session, request: CaptureRequest, result: TotalCaptureResult) {
        try {
            val receivedNs = SystemClock.elapsedRealtimeNanos()
            val receivedMs = System.currentTimeMillis()
            synchronized(lock) {
                if (!isCurrent(session, "capturing")) return
                check(foreground && hasPermission()) { "Camera permission was revoked during exposure delivery" }
                check(request.tag == session.id && result.request.tag == session.id) { "Native camera exposure belongs to another request" }
                check(session.resultMetadata == null) { "Native camera delivered duplicate exposure results" }
                val sensorTime = requireNotNull(result.get(CaptureResult.SENSOR_TIMESTAMP)) { "Native camera omitted the exposure timestamp" }
                check(abs((receivedMs - session.anchorWallMs) - (receivedNs - session.anchorNs) / 1_000_000) <= 1000) { "Camera wall and monotonic clocks diverged" }
                val zsl = result.get(CaptureResult.CONTROL_ENABLE_ZSL)
                val pattern = result.get(CaptureResult.SENSOR_TEST_PATTERN_MODE)
                check(zsl != true) { "Native camera reported zero-shutter-lag capture despite the disabled request" }
                check(pattern == null || pattern == CaptureResult.SENSOR_TEST_PATTERN_MODE_OFF) { "Native camera reported synthetic sensor test-pattern mode" }
                val characteristics = requireNotNull(session.characteristics)
                val timestampSource = if (characteristics.get(CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE) == CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME) "realtime" else "unknown"
                if (timestampSource == "realtime") {
                    check(sensorTime >= session.captureRequestedNs && sensorTime <= receivedNs) { "Native camera exposure is outside the requested capture interval" }
                }
                val acquiredMs = if (timestampSource == "realtime") session.anchorWallMs + (sensorTime - session.anchorNs) / 1_000_000 else receivedMs
                val lensFacing = when (characteristics.get(CameraCharacteristics.LENS_FACING)) {
                    CameraCharacteristics.LENS_FACING_BACK -> "back"
                    CameraCharacteristics.LENS_FACING_FRONT -> "front"
                    else -> "external"
                }
                session.resultMetadata = JSONObject().put("version", 1).put("type", "nonverba-native-camera-capture")
                    .put("session_id", session.id).put("camera_id", session.cameraId).put("lens_facing", lensFacing)
                    .put("timestamp_source", timestampSource).put("request_received_elapsed_ns", session.anchorNs.toString())
                    .put("request_received_unix_ms", session.anchorWallMs).put("callback_received_unix_ms", receivedMs)
                    .put("capture_time_origin", if (timestampSource == "realtime") "monotonic-mapped-exposure" else "callback-receipt")
                    .put("capture_requested_elapsed_ns", session.captureRequestedNs.toString())
                    .put("callback_received_elapsed_ns", receivedNs.toString()).put("sensor_timestamp_ns", sensorTime.toString())
                    .put("acquired_at_unix_ms", acquiredMs).put("frame_number", result.frameNumber.toString())
                    .put("jpeg_orientation_degrees", session.jpegOrientation)
                    .put("zsl_requested_disabled", true).put("test_pattern_requested_disabled", true)
                    .put("zsl_result_enabled", zsl ?: JSONObject.NULL).put("test_pattern_result_mode", pattern ?: JSONObject.NULL)
                    .put("gps_origin", "caller-submitted-device-geolocation")
                    .put("keystore_security_level", session.identity.securityLevel)
                    .put("strongbox_requested", session.identity.strongBoxRequested).put("strongbox_fallback", session.identity.strongBoxFallback)
                    .put("exposure_time_ns", result.get(CaptureResult.SENSOR_EXPOSURE_TIME)?.toString() ?: JSONObject.NULL)
                    .put("sensitivity_iso", result.get(CaptureResult.SENSOR_SENSITIVITY) ?: JSONObject.NULL)
                    .put("focal_length_mm", result.get(CaptureResult.LENS_FOCAL_LENGTH)?.toDouble() ?: JSONObject.NULL)
                sealIfReady(session)
            }
        } catch (error: Throwable) { fail(session, safeError(error)) }
    }

    /** Both callbacks have delivered native-owned inputs; no WebView byte argument exists. */
    private fun sealIfReady(session: Session) {
        val jpeg = session.image ?: return
        val metadata = session.resultMetadata ?: return
        check(session.imageTimestampNs > 0 && metadata.getString("sensor_timestamp_ns") == session.imageTimestampNs.toString()) { "Native camera image does not match the exposure timestamp" }
        metadata.put("image_timestamp_ns", session.imageTimestampNs.toString())
            .put("image_received_elapsed_ns", session.imageReceivedNs.toString())
            .put("width", session.imageWidth).put("height", session.imageHeight)
        session.state = "sealing"
        session.timing.mark(NativeSessionGuards.PhaseTimings.Mark.READY, SystemClock.elapsedRealtimeNanos())
        val location = requireNotNull(session.location)
        val request = session.request.toString()
        val captureMetadata = metadata.toString()
        main.post { detach(session, keepDeadline = true) }
        worker.execute {
            try {
                val authority = NativeSessionGuards.SigningAuthority {
                    synchronized(lock) { requireSealingAllowed(session, NativeSessionGuards.Stage.SIGNING_AUTHORITY) }
                }
                val signer = NativeMediaEvidenceSigner(session.key) { authority.active() }
                val sealedAtMs = synchronized(lock) { requireSealingAllowed(session, NativeSessionGuards.Stage.SEAL_ENTRY) }
                val proof = try {
                    authority.preservingFailure {
                        NativeCameraCore.seal(jpeg, request, location, captureMetadata,
                            session.identity.spki, session.identity.certificatePem, sealedAtMs, signer)
                    }
                } finally {
                    synchronized(lock) { session.timing.mark(NativeSessionGuards.PhaseTimings.Mark.SEAL_RETURNED, SystemClock.elapsedRealtimeNanos()) }
                }
                synchronized(lock) {
                    if (!isCurrent(session, "sealing")) return@execute
                    requireSealingAllowed(session, NativeSessionGuards.Stage.RESULT_DELIVERY)
                    session.result = JSONObject(proof)
                    session.image = null
                    session.state = "complete"
                }
                main.post { detach(session) }
            } catch (error: Throwable) { fail(session, safeError(error)) }
        }
    }

    @Suppress("DEPRECATION")
    private fun jpegOrientation(characteristics: CameraCharacteristics): Int {
        val display = when (activity.windowManager.defaultDisplay.rotation) {
            Surface.ROTATION_90 -> 90
            Surface.ROTATION_180 -> 180
            Surface.ROTATION_270 -> 270
            else -> 0
        }
        val sensor = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0
        return if (characteristics.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_FRONT) (sensor + display) % 360
        else (sensor - display + 360) % 360
    }

    @Suppress("DEPRECATION")
    private fun configureTransform(session: Session, width: Int, height: Int) {
        val texture = session.texture ?: return
        val size = session.previewSize ?: return
        val rotation = activity.windowManager.defaultDisplay.rotation
        val matrix = Matrix()
        val view = RectF(0f, 0f, width.toFloat(), height.toFloat())
        val buffer = RectF(0f, 0f, size.height.toFloat(), size.width.toFloat())
        if (rotation == Surface.ROTATION_90 || rotation == Surface.ROTATION_270) {
            buffer.offset(view.centerX() - buffer.centerX(), view.centerY() - buffer.centerY())
            matrix.setRectToRect(view, buffer, Matrix.ScaleToFit.FILL)
            val scale = max(height.toFloat() / size.height, width.toFloat() / size.width)
            matrix.postScale(scale, scale, view.centerX(), view.centerY())
            matrix.postRotate(90f * (rotation - 2), view.centerX(), view.centerY())
        } else if (rotation == Surface.ROTATION_180) matrix.postRotate(180f, view.centerX(), view.centerY())
        texture.setTransform(matrix)
    }

    private fun detach(session: Session, keepDeadline: Boolean = false) {
        // Runs on the Activity thread; state is terminal or sealing before surfaces disappear.
        synchronized(lock) {
            val releases = listOf(
                NativeLifecycleCleanup.release("camera capture timeout", { session.captureTimeout },
                    { main.removeCallbacks(it) }, { session.captureTimeout = null }),
                NativeLifecycleCleanup.Action("camera session timeout") {
                    if (!keepDeadline) NativeLifecycleCleanup.release("timeout", { session.timeout },
                        { main.removeCallbacks(it) }, { session.timeout = null }).run()
                },
                NativeLifecycleCleanup.release("camera capture session", { session.captureSession },
                    { it.close() }, { session.captureSession = null }),
                NativeLifecycleCleanup.release("camera device", { session.device },
                    { it.close() }, { session.device = null }),
                NativeLifecycleCleanup.Action("camera image listener") { session.reader?.setOnImageAvailableListener(null, null) },
                NativeLifecycleCleanup.release("camera image reader", { session.reader },
                    { it.close() }, { session.reader = null }),
                NativeLifecycleCleanup.release("camera preview surface", { session.previewSurface },
                    { it.release() }, { session.previewSurface = null }),
                NativeLifecycleCleanup.release("camera preview listener", { session.texture },
                    { it.surfaceTextureListener = null }, { session.texture = null }),
                NativeLifecycleCleanup.release("camera dialog", { session.dialog },
                    { it.dismiss() }, { session.dialog = null }),
                NativeLifecycleCleanup.Action("camera UI references") { session.statusText = null; session.captureButton = null }
            )
            NativeLifecycleCleanup.run(releases) { failure ->
                val message = "${failure.label}: ${safeError(failure.error)}".take(400)
                if (message !in session.cleanupErrors && session.cleanupErrors.size < 8) session.cleanupErrors.add(message)
                Log.w("NonverbaLifecycle", failure.label, failure.error)
            }
        }
    }

    private fun isCurrent(session: Session, state: String) = current === session && !closed && session.state == state

    /** Platform clock continuity remains mandatory while Rust prepares/signs the image. */
    private fun requireSealingAllowed(session: Session, stage: NativeSessionGuards.Stage): Long {
        NativeSessionGuards.requireAuthority(foreground, closed, isCurrent(session, "sealing"), hasPermission())
        val nowMs = System.currentTimeMillis()
        val challenge = session.request.getJSONObject("challenge")
        NativeSessionGuards.requireRequestWindow(nowMs, challenge.getLong("issued_at"), challenge.getLong("expires_at"))
        val elapsedNs = SystemClock.elapsedRealtimeNanos()
        val elapsedMs = NativeSessionGuards.elapsedMillis(session.anchorWallMs, session.anchorNs, nowMs, elapsedNs)
        if (stage == NativeSessionGuards.Stage.SEAL_ENTRY) session.timing.mark(NativeSessionGuards.PhaseTimings.Mark.SEAL_ENTRY, elapsedNs)
        if (stage == NativeSessionGuards.Stage.RESULT_DELIVERY) session.timing.mark(NativeSessionGuards.PhaseTimings.Mark.DELIVERY_CHECK, elapsedNs)
        val metadata = requireNotNull(session.resultMetadata)
        val acquiredNs = if (metadata.getString("timestamp_source") == "realtime") metadata.getString("sensor_timestamp_ns").toLong()
            else metadata.getString("callback_received_elapsed_ns").toLong()
        check(acquiredNs >= session.anchorNs) { "Camera acquisition predates its native session" }
        NativeSessionGuards.requireFresh(elapsedMs, (acquiredNs - session.anchorNs) / 1_000_000, 30_000,
            NativeSessionGuards.FreshnessContext(NativeSessionGuards.Sensor.CAMERA, stage))
        return nowMs
    }
    private fun hasPermission() = activity.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    private fun snapshot(session: Session): JSONObject = JSONObject()
        .put("ok", session.state !in setOf("error", "cancelled")).put("session_id", session.id)
        .put("state", session.state).put("key_fingerprint", session.identity.fingerprint)
        .put("key_profile", session.key.profile)
        .put("timing_diagnostics", JSONObject(session.timing.snapshot()).put("unsigned", true))
        .also { if (session.cleanupErrors.isNotEmpty()) it.put("cleanup_errors", JSONArray(session.cleanupErrors)) }
        .also { result -> session.error?.let { result.put("error", it) }; session.result?.let { result.put("result", it) } }

    private fun fail(session: Session, message: String) {
        synchronized(lock) {
            if (current !== session || session.state !in ACTIVE_STATES) return
            session.state = "error"
            session.error = message.take(400)
            session.image = null
        }
        main.post { detach(session) }
    }

    private fun readLedger(): JSONObject {
        if (!ledger.baseFile.exists() && !File(ledger.baseFile.path + ".bak").exists()) return JSONObject()
        return ledger.openRead().use {
            check(it.channel.size() <= 1024 * 1024) { "Native camera replay ledger is too large" }
            JSONObject(it.readBytes().toString(Charsets.UTF_8))
        }
    }

    private fun reserve(session: Session) {
        val entries = readLedger()
        val nonce = session.request.getJSONObject("challenge").getString("id")
        check(!entries.has(nonce)) { "This camera challenge was already used on this device" }
        check(entries.length() < 4096) { "Native camera replay ledger is full" }
        entries.put(nonce, System.currentTimeMillis())
        val stream = ledger.startWrite()
        try { stream.write(entries.toString().toByteArray(Charsets.UTF_8)); ledger.finishWrite(stream) }
        catch (error: Throwable) { ledger.failWrite(stream); throw error }
    }

    private fun safeError(error: Throwable) = (error.message ?: "Native camera capture failed").take(400)
    private fun failure(error: Throwable) = failureMessage(safeError(error))
    private fun failureMessage(message: String) = JSONObject().put("ok", false).put("state", "error").put("error", message).toString()

    private companion object {
        const val MAX_REQUEST = 64 * 1024
        const val MAX_JPEG_BYTES = 32 * 1024 * 1024
        const val MAX_PIXELS = 12_000_000L
        const val SESSION_TIMEOUT_MS = 60_000L
        const val CAPTURE_TIMEOUT_MS = 15_000L
        val PREVIEW_STATES = setOf("opening", "preview", "awaiting-location", "capturing")
        val ACTIVE_STATES = PREVIEW_STATES + setOf("requesting-permission", "sealing")
    }
}
