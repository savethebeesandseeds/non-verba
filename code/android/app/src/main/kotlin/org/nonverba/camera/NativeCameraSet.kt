// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.graphics.SurfaceTexture
import android.hardware.camera2.*
import android.hardware.camera2.params.OutputConfiguration
import android.hardware.camera2.params.SessionConfiguration
import android.media.ImageReader
import android.os.*
import android.util.AtomicFile
import android.util.Size
import android.view.*
import android.webkit.JavascriptInterface
import android.widget.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

/** One native shutter, all explicitly requested Camera2 devices in the signed mode.
 * Sequential mode is explicit; concurrent requests never fall back.
 * Images and exposure metadata never enter JavaScript before per-member C2PA sealing.
 * This developer collector is not an Assignment grant or hardware attestation.
 */
@android.annotation.TargetApi(28)
internal class NativeCameraSet(
    private val activity: Activity,
    private val isForeground: () -> Boolean,
    private val requestPermission: ((Boolean) -> Unit) -> Unit
) {
    private val lock = Any()
    private val main = Handler(Looper.getMainLooper())
    private val thread = HandlerThread("nonverba-camera-set").apply { start() }
    private val handler = Handler(thread.looper)
    private val worker = Executors.newSingleThreadExecutor()
    private val manager = activity.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    private val ledger = AtomicFile(File(activity.noBackupFilesDir, "native-camera-set-ledger-v1.json"))
    private var current: Attempt? = null
    private var closed = false
    private var generation = 0L
    @Volatile private var foreground = false
    private class Slot(val id: String, val facing: String, val characteristics: CameraCharacteristics) {
        var texture: TextureView? = null
        var surface: Surface? = null
        var reader: ImageReader? = null
        var device: CameraDevice? = null
        var session: CameraCaptureSession? = null
        var openPending = false
        var configurePending = false
        var closingDevice = false
        var closingSession = false
        var requestedNs = 0L
        var orientation = 0
        var bytes: ByteArray? = null
        var imageNs = 0L
        var receivedNs = 0L
        var width = 0
        var height = 0
        var metadata: JSONObject? = null
        var outcome = "pending"
        var sealed: JSONObject? = null
        var paired = false
        var previewStarted = false
    }
    private class Attempt(val id: String, val request: JSONObject, val key: NativeMediaCaptureKey,
        val identity: NativeMediaCaptureKey.PublicIdentity, val anchorMs: Long, val anchorNs: Long,
        val slots: List<Slot>) {
        val sequence = if(request.getJSONObject("profile").getJSONObject("timing").getString("mode")=="sequential") NativeCameraSetSequence(slots.size) else null
        var state = "requesting-permission"
        var error: String? = null
        var dialog: Dialog? = null
        var shutter: Button? = null
        var timeout: Runnable? = null
        var location: String? = null
        var result: JSONObject? = null
        val cleanupErrors = mutableListOf<String>()
    }
    private fun permission() = activity.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    private fun readForeground() = NativeMainThreadRead.read(
        isMainThread = { Looper.myLooper() == main.looper },
        post = { action -> main.post { action() } }, value = isForeground)
    private fun facing(c: CameraCharacteristics) = when(c.get(CameraCharacteristics.LENS_FACING)) {
        CameraCharacteristics.LENS_FACING_FRONT -> "front"
        CameraCharacteristics.LENS_FACING_BACK -> "back"
        CameraCharacteristics.LENS_FACING_EXTERNAL -> "external"
        else -> "unknown"
    }
    @JavascriptInterface fun capabilities(): String = try {
        check(Build.VERSION.SDK_INT >= 28) { "This camera-set adapter requires Android 9 or later" }
        check(readForeground()) { "Open the foreground camera-set tool" }
        val identity = NativeAttestedKeyStore.mediaKey(activity).publicIdentity()
        val cameras = JSONArray()
        manager.cameraIdList.sorted().forEach { id -> cameras.put(JSONObject().put("camera_id",id).put("lens_facing",facing(manager.getCameraCharacteristics(id)))) }
        val groups: Any = if (Build.VERSION.SDK_INT >= 30) JSONArray().also { list ->
            manager.concurrentCameraIds.sortedBy { it.sorted().joinToString() }.forEach { list.put(JSONArray(it.sorted())) }
        } else JSONObject.NULL
        JSONObject().put("available",true).put("version",1).put("platform","android-camera2")
            .put("key_fingerprint",identity.fingerprint).put("camera_permission",permission())
            .put("cameras",cameras).put("concurrent_sets",groups).put("max_native_cameras",4)
            .put("hardware_attested",false).toString()
    } catch (e: Throwable) { failure(e) }

    @JavascriptInterface fun begin(requestJson: String): String = try {
        check(Build.VERSION.SDK_INT >= 28) { "This camera-set adapter requires Android 9 or later" }
        require(requestJson.length <= 32 * 1024) { "Camera-set request is too large" }
        check(readForeground()) { "Camera-set collection requires its foreground tool" }
        val request = JSONObject(NativeCameraSetCore.validateRequest(requestJson,System.currentTimeMillis()))
        val epoch = synchronized(lock) {
            check(!closed && current?.state !in ACTIVE) { "Camera set is closed or already active" }
            check(current?.let(::released) != false) { "Previous camera-set cleanup is still pending; cancel to retry" }
            generation
        }
        val key = NativeAttestedKeyStore.mediaKey(activity)
        val identity = key.publicIdentity()
        val a = synchronized(lock) {
            check(!closed && generation == epoch && current?.state !in ACTIVE) { "Camera-set setup was cancelled" }
            val cameras = request.getJSONObject("profile").getJSONArray("cameras")
            require(cameras.length() in 1..4) { "This native adapter supports at most four required cameras" }
            val slots = (0 until cameras.length()).map { i ->
                val expected = cameras.getJSONObject(i)
                val id = expected.getString("camera_id")
                check(id in manager.cameraIdList) { "Required camera is unavailable: $id" }
                val c = manager.getCameraCharacteristics(id)
                check(facing(c) == expected.getString("lens_facing")) { "Required camera facing changed: $id" }
                Slot(id,facing(c),c)
            }
            if (request.getJSONObject("profile").getJSONObject("timing").getString("mode")=="concurrent") {
                val groups = if (Build.VERSION.SDK_INT >= 30) manager.concurrentCameraIds
                    else error("Concurrent camera discovery requires Android 11 or later; no sequential fallback")
                check(groups.any { group -> group.containsAll(slots.map { it.id }) }) {
                    "Required camera combination is not advertised; no reduced or sequential fallback"
                }
            }
            check(!readLedger().has(request.getJSONObject("challenge").getString("id"))) { "This camera-set challenge was already used" }
            val anchor = NativeCameraTiming.anchor({UUID.randomUUID().toString()},{System.currentTimeMillis()},{SystemClock.elapsedRealtimeNanos()})
            Attempt(anchor.sessionId,request,key,identity,anchor.wallMs,anchor.elapsedNs,slots).also { current=it }
        }
        main.post { start(a) }
        synchronized(lock) { snapshot(a).toString() }
    } catch (e: Throwable) { failure(e) }

    @JavascriptInterface fun status(id: String): String = synchronized(lock) {
        current?.takeIf { it.id==id }?.let { snapshot(it).toString() } ?: failureMessage("Unknown camera-set attempt")
    }
    @JavascriptInterface fun capture(id: String, locationJson: String): String = try {
        require(locationJson.length <= 64*1024)
        val a = synchronized(lock) {
            val a = current?.takeIf { it.id==id } ?: error("Unknown camera-set attempt")
            check(a.state=="awaiting-location") { "Press the native shutter first" }
            authority(a,"awaiting-location")
            a.location=NativeCameraSetCore.validateLocation(a.request.toString(),locationJson,System.currentTimeMillis())
            reserve(a)
            a.state="capturing"
            a
        }
        handler.post { expose(a) }
        synchronized(lock) { snapshot(a).toString() }
    } catch (e: Throwable) { failure(e) }
    @JavascriptInterface fun cancel(id: String): String = synchronized(lock) {
        val a=current?.takeIf { it.id==id } ?: return@synchronized failureMessage("Unknown camera-set attempt")
        terminate(a,"cancelled","Camera-set attempt cancelled")
        main.post { cleanup(a) }
        snapshot(a).toString()
    }
    fun revokeAuthority() { foreground=false }
    fun pause() {
        foreground=false
        val a=synchronized(lock) { generation++; current?.also { terminate(it,"cancelled","Camera-set page left foreground") } }
        a?.let { cleanup(it) }
    }
    fun destroy() {
        revokeAuthority(); synchronized(lock) { closed=true }
        NativeLifecycleCleanup.run(listOf(
            NativeLifecycleCleanup.Action("camera-set cleanup",::pause),
            NativeLifecycleCleanup.Action("camera-set worker") {worker.shutdown()},
            NativeLifecycleCleanup.Action("camera-set callbacks") {thread.quitSafely()}))
    }
    private fun start(a: Attempt) {
        try {
            synchronized(lock) { check(current===a && a.state=="requesting-permission" && !closed); check(isForeground()); foreground=true }
            a.timeout=Runnable { fail(a,"Camera-set attempt exceeded its 60-second session deadline") }.also { main.postDelayed(it,60_000) }
            requestPermission { granted ->
                if (!granted) {fail(a,"Camera permission refused");return@requestPermission}
                try { synchronized(lock) { authority(a,"requesting-permission"); a.state="opening" }; show(a) }
                catch(e:Throwable) {fail(a,safe(e))}
            }
        } catch(e:Throwable) {fail(a,safe(e))}
    }
    private fun show(a: Attempt) {
        val dialog=Dialog(activity)
        val panel=LinearLayout(activity).apply {orientation=LinearLayout.VERTICAL;setPadding(20,20,20,20)}
        panel.addView(TextView(activity).apply {contentDescription="Non-verba camera set";text="Camera set: one shutter captures every listed camera.\n${if(a.sequence!=null) "Sequential: each camera closes before the next opens. These photos are taken at different times." else "Requested timing: ${a.request.getJSONObject("profile").getJSONObject("timing").getString("mode")}"}\n${a.slots.joinToString(" → ") { "${it.facing} (${it.id})" }}"})
        a.slots.forEach { slot ->
            panel.addView(TextView(activity).apply {text="${slot.facing}: ${slot.id}"})
            val texture=TextureView(activity);slot.texture=texture
            panel.addView(texture,LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,0,1f))
            texture.surfaceTextureListener=object:TextureView.SurfaceTextureListener {
                override fun onSurfaceTextureAvailable(surface:SurfaceTexture,width:Int,height:Int) { prepare(a,slot,surface) }
                override fun onSurfaceTextureSizeChanged(surface:SurfaceTexture,width:Int,height:Int) {}
                override fun onSurfaceTextureUpdated(surface:SurfaceTexture) {}
                override fun onSurfaceTextureDestroyed(surface:SurfaceTexture):Boolean {fail(a,"Camera-set preview surface was lost");return true}
            }
        }
        val button=Button(activity).apply {text="TAKE ALL REQUESTED PHOTOS";isEnabled=false;setOnClickListener {
            try { synchronized(lock) {authority(a,"preview");a.state="awaiting-location";isEnabled=false;text="Obtaining fresh location…"} }
            catch(e:Throwable) {fail(a,safe(e))}
        }}
        a.shutter=button;panel.addView(button)
        panel.addView(Button(activity).apply {text="Cancel";setOnClickListener {cancel(a.id)}})
        dialog.setContentView(panel);dialog.setOnCancelListener {cancel(a.id)}
        synchronized(lock) {authority(a,"opening");a.dialog=dialog}
        dialog.show();dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.MATCH_PARENT)
    }
    private fun prepare(a:Attempt,slot:Slot,texture:SurfaceTexture) {
        try { synchronized(lock) {
            authority(a,"opening")
            val map=requireNotNull(slot.characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP))
            fun choose(sizes:Array<Size>) = sizes.filter {it.width>=256 && it.height>=256 && it.width.toLong()*it.height<=1280L*720}
                .maxByOrNull {it.width.toLong()*it.height} ?: error("Required camera lacks this adapter's bounded stream profile: ${slot.id}")
            val jpeg=choose(requireNotNull(map.getOutputSizes(ImageFormat.JPEG)))
            val preview=choose(requireNotNull(map.getOutputSizes(SurfaceTexture::class.java)))
            texture.setDefaultBufferSize(preview.width,preview.height);slot.surface=Surface(texture)
            slot.reader=ImageReader.newInstance(jpeg.width,jpeg.height,ImageFormat.JPEG,2).also {reader ->
                reader.setOnImageAvailableListener({receiveImage(a,slot,it)},handler)
            }
            if (a.slots.all {it.reader!=null}) handler.post {openDevices(a,if(a.sequence!=null)listOf(a.slots[0]) else a.slots)}
        }} catch(e:Throwable) {fail(a,safe(e))}
    }
    private fun openingState(a:Attempt) = if(a.sequence!=null && a.state=="capturing")"capturing" else "opening"
    @SuppressLint("MissingPermission")
    private fun openDevices(a:Attempt,slots:List<Slot>) {
        try { synchronized(lock) {
            val phase=openingState(a);authority(a,phase)
            slots.forEach {slot ->
                slot.openPending=true
                try { manager.openCamera(slot.id,object:CameraDevice.StateCallback() {
                    override fun onOpened(camera:CameraDevice) {
                        try { synchronized(lock) {
                            slot.openPending=false;slot.device=camera
                            if (!active(a,phase)) {main.post {cleanup(a)};return}
                            authority(a,phase)
                            if (slots.all {it.device!=null}) configureDevices(a,slots,phase)
                        }} catch(e:Throwable) {fail(a,safe(e))}
                    }
                    override fun onDisconnected(camera:CameraDevice) {synchronized(lock) {slot.openPending=false;slot.device=camera};fail(a,"Camera disconnected: ${slot.id}");main.post {cleanup(a)}}
                    override fun onError(camera:CameraDevice,error:Int) {synchronized(lock) {slot.openPending=false;slot.device=camera};fail(a,"Camera ${slot.id} failed ($error)");main.post {cleanup(a)}}
                    override fun onClosed(camera:CameraDevice) {synchronized(lock) {if(slot.device===camera)slot.device=null;slot.closingDevice=false;advanceSequence(a,slot)}}
                },handler) } catch(e:Throwable) {slot.openPending=false;throw e}
            }
        }} catch(e:Throwable) {fail(a,safe(e))}
    }
    @SuppressLint("MissingPermission") // authority checks permission at entry and before each session.
    private fun configureDevices(a:Attempt,slots:List<Slot>,phase:String) {
        authority(a,phase)
        val configs=slots.associateWith {slot ->
            SessionConfiguration(SessionConfiguration.SESSION_REGULAR,
                listOf(OutputConfiguration(requireNotNull(slot.surface)),OutputConfiguration(requireNotNull(slot.reader).surface)),
                {action -> handler.post(action)},object:CameraCaptureSession.StateCallback() {
                    override fun onConfigured(session:CameraCaptureSession) {
                        try { synchronized(lock) {
                            slot.configurePending=false;slot.session=session
                            if(!active(a,phase)) {main.post {cleanup(a)};return}
                            authority(a,phase)
                            val preview=requireNotNull(slot.device).createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
                                addTarget(requireNotNull(slot.surface));set(CaptureRequest.CONTROL_MODE,CaptureRequest.CONTROL_MODE_AUTO)
                                set(CaptureRequest.CONTROL_ENABLE_ZSL,false);set(CaptureRequest.SENSOR_TEST_PATTERN_MODE,0)
                            }
                            session.setRepeatingRequest(preview.build(),object:CameraCaptureSession.CaptureCallback() {
                                override fun onCaptureCompleted(session:CameraCaptureSession,request:CaptureRequest,result:TotalCaptureResult) {
                                    synchronized(lock) {
                                        if(!active(a,phase) || slot.previewStarted)return
                                        slot.previewStarted=true
                                        if(slots.all {it.previewStarted}) {
                                            if(phase=="opening") {a.state="preview";main.post {synchronized(lock) {if(active(a,"preview"))a.shutter?.isEnabled=true}}}
                                            else handler.post {expose(a)}
                                        }
                                    }
                                }
                            },handler)
                        }} catch(e:Throwable) {fail(a,safe(e))}
                    }
                    override fun onConfigureFailed(session:CameraCaptureSession) {synchronized(lock) {slot.configurePending=false;slot.session=session};fail(a,"Stream configuration refused: ${slot.id}");main.post {cleanup(a)}}
                    override fun onClosed(session:CameraCaptureSession) {synchronized(lock) {if(slot.session===session)slot.session=null;slot.closingSession=false;advanceSequence(a,slot)}}
                })
        }
        if(a.sequence==null && slots.size>1) {
            check(Build.VERSION.SDK_INT>=30 && manager.isConcurrentSessionConfigurationSupported(configs.entries.associate {it.key.id to it.value})) {
                "Exact concurrent stream configuration is unsupported; no sequential fallback"
            }
        }
        configs.forEach {(slot,config) ->
            authority(a,phase)
            slot.configurePending=true
            try {requireNotNull(slot.device).createCaptureSession(config)} catch(e:Throwable) {slot.configurePending=false;throw e}
        }
    }
    @Suppress("DEPRECATION")
    private fun expose(a:Attempt) {
        try { synchronized(lock) {
            authority(a,"capturing")
            val delay=NativeCameraTiming.exposureDelayMs(a.anchorMs,a.anchorNs,System.currentTimeMillis(),SystemClock.elapsedRealtimeNanos(),JSONObject(requireNotNull(a.location)).getLong("timestamp_ms"))
            if(delay>0) {handler.postDelayed({expose(a)},delay);return}
            val slots=a.sequence?.let {listOf(a.slots[it.index])}?:a.slots
            slots.forEach {slot ->
                authority(a,"capturing")
                check(slot.requestedNs==0L) {"Camera-set member was already requested"}
                val display=when(activity.windowManager.defaultDisplay.rotation) {Surface.ROTATION_90->90;Surface.ROTATION_180->180;Surface.ROTATION_270->270;else->0}
                val sensor=slot.characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION)?:0
                slot.orientation=if(slot.facing=="front")(sensor+display)%360 else (sensor-display+360)%360
                val request=requireNotNull(slot.device).createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE).apply {
                    addTarget(requireNotNull(slot.reader).surface);set(CaptureRequest.CONTROL_MODE,CaptureRequest.CONTROL_MODE_AUTO)
                    set(CaptureRequest.CONTROL_ENABLE_ZSL,false);set(CaptureRequest.SENSOR_TEST_PATTERN_MODE,0)
                    set(CaptureRequest.JPEG_ORIENTATION,slot.orientation);set(CaptureRequest.JPEG_QUALITY,95.toByte());setTag(a.id+":"+slot.id)
                }.build()
                slot.requestedNs=SystemClock.elapsedRealtimeNanos();slot.outcome="requested"
                requireNotNull(slot.session).capture(request,object:CameraCaptureSession.CaptureCallback() {
                    override fun onCaptureCompleted(session:CameraCaptureSession,request:CaptureRequest,result:TotalCaptureResult) {receiveResult(a,slot,request,result)}
                    override fun onCaptureFailed(session:CameraCaptureSession,request:CaptureRequest,failure:CaptureFailure) {synchronized(lock){slot.outcome="failed"};fail(a,"Exposure failed: ${slot.id} (${failure.reason})")}
                    override fun onCaptureSequenceAborted(session:CameraCaptureSession,sequenceId:Int) {
                        synchronized(lock) {if(active(a,"capturing") && slot.metadata==null)fail(a,"Exposure aborted: ${slot.id}")}
                    }
                },handler)
            }
        }} catch(e:Throwable) {fail(a,safe(e))}
    }
    private fun receiveImage(a:Attempt,slot:Slot,reader:ImageReader) {
        synchronized(lock) {
        // Cleanup uses this same lock. A queued listener must not acquire from a
        // closed reader or turn an already sealing attempt into a false failure.
        if(!active(a,"capturing") || slot.paired)return
        try {val image=reader.acquireNextImage()?:return;image.use {
            synchronized(lock) {
                if(!active(a,"capturing"))return
                authority(a,"capturing");check(slot.bytes==null && image.format==ImageFormat.JPEG && image.planes.size==1)
                val buffer=image.planes[0].buffer
                check(buffer.remaining() in 4..(8*1024*1024)) {"Camera-set member exceeds 8 MiB"}
                val bytes=ByteArray(buffer.remaining());buffer.get(bytes);slot.bytes=bytes
                check(a.slots.sumOf {it.bytes?.size?:0}<=32*1024*1024) {"Camera set exceeds 32 MiB"}
                slot.imageNs=image.timestamp;slot.receivedNs=SystemClock.elapsedRealtimeNanos();slot.width=image.width;slot.height=image.height
                slot.outcome="image-acquired";memberReady(a,slot)
            }
        }} catch(e:Throwable) {fail(a,safe(e))}
        }
    }
    private fun receiveResult(a:Attempt,slot:Slot,request:CaptureRequest,result:TotalCaptureResult) {
        try {synchronized(lock) {
            if(!active(a,"capturing") || slot.paired)return
            authority(a,"capturing");check(slot.metadata==null && request.tag==a.id+":"+slot.id && result.request.tag==request.tag)
            val ns=SystemClock.elapsedRealtimeNanos();val ms=System.currentTimeMillis()
            NativeSessionGuards.elapsedMillis(a.anchorMs,a.anchorNs,ms,ns)
            val sensor=requireNotNull(result.get(CaptureResult.SENSOR_TIMESTAMP))
            val source=if(slot.characteristics.get(CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE)==CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME)"realtime" else "unknown"
            if(source=="realtime")check(sensor>=slot.requestedNs && sensor<=ns)
            val zsl=result.get(CaptureResult.CONTROL_ENABLE_ZSL);val pattern=result.get(CaptureResult.SENSOR_TEST_PATTERN_MODE)
            check(zsl!=true && (pattern==null || pattern==0)) {"Camera returned ZSL or a test pattern"}
            slot.metadata=JSONObject().put("version",1).put("type","nonverba-native-camera-capture")
                .put("session_id",a.id).put("camera_id",slot.id).put("lens_facing",slot.facing)
                .put("timestamp_source",source).put("request_received_unix_ms",a.anchorMs).put("callback_received_unix_ms",ms)
                .put("request_received_elapsed_ns",a.anchorNs.toString()).put("capture_requested_elapsed_ns",slot.requestedNs.toString())
                .put("callback_received_elapsed_ns",ns.toString()).put("sensor_timestamp_ns",sensor.toString())
                .put("capture_time_origin",if(source=="realtime")"monotonic-mapped-exposure" else "callback-receipt")
                .put("acquired_at_unix_ms",if(source=="realtime")a.anchorMs+(sensor-a.anchorNs)/1_000_000 else ms)
                .put("frame_number",result.frameNumber.toString()).put("jpeg_orientation_degrees",slot.orientation)
                .put("zsl_requested_disabled",true).put("test_pattern_requested_disabled",true)
                .put("zsl_result_enabled",zsl?:JSONObject.NULL).put("test_pattern_result_mode",pattern?:JSONObject.NULL)
                .put("gps_origin","caller-submitted-device-geolocation").put("keystore_security_level",a.identity.securityLevel)
                .put("strongbox_requested",a.identity.strongBoxRequested).put("strongbox_fallback",a.identity.strongBoxFallback)
                .put("exposure_time_ns",result.get(CaptureResult.SENSOR_EXPOSURE_TIME)?.toString()?:JSONObject.NULL)
                .put("sensitivity_iso",result.get(CaptureResult.SENSOR_SENSITIVITY)?:JSONObject.NULL)
                .put("focal_length_mm",result.get(CaptureResult.LENS_FOCAL_LENGTH)?.toDouble()?:JSONObject.NULL)
            memberReady(a,slot)
        }} catch(e:Throwable) {fail(a,safe(e))}
    }
    private fun memberReady(a:Attempt,slot:Slot) {
        if(slot.paired || slot.bytes==null || slot.metadata==null)return
        check(slot.imageNs>0 && requireNotNull(slot.metadata).getString("sensor_timestamp_ns")==slot.imageNs.toString()) {"Image/result timestamp mismatch: ${slot.id}"}
        slot.metadata!!.put("image_timestamp_ns",slot.imageNs.toString()).put("image_received_elapsed_ns",slot.receivedNs.toString()).put("width",slot.width).put("height",slot.height)
        slot.paired=true;slot.outcome="image-paired"
        if(a.sequence!=null && a.slots.indexOf(slot)<a.slots.lastIndex) {
            a.sequence.memberAcquired(a.slots.indexOf(slot))
            main.post {synchronized(lock) {if(active(a,"capturing")) {releaseSlot(a,slot);advanceSequence(a,slot)}}}
            return
        }
        if(a.slots.any {!it.paired})return
        a.state="sealing";main.post {cleanup(a,true)}
        worker.execute {
            try {
                a.slots.forEach {slot ->
                    val guard=NativeSessionGuards.SigningAuthority {synchronized(lock) {authority(a,"sealing");fresh(a,slot)}}
                    val key=NativeMediaEvidenceSigner(a.key) {guard.active()}
                    val member=JSONObject().put("version",1).put("request",a.request).put("attempt_id",a.id).put("camera_id",slot.id)
                    val bytes=synchronized(lock) {authority(a,"sealing");fresh(a,slot);requireNotNull(slot.bytes)}
                    val sealed=guard.preservingFailure {NativeCameraSetCore.seal(bytes,member.toString(),requireNotNull(a.location),requireNotNull(slot.metadata).toString(),a.identity.spki,a.identity.certificatePem,System.currentTimeMillis(),key)}
                    synchronized(lock) {authority(a,"sealing");fresh(a,slot);slot.sealed=JSONObject(sealed);slot.bytes=null;slot.outcome="signed"}
                }
                synchronized(lock) {
                    authority(a,"sealing");a.slots.forEach {fresh(a,it)}
                    val images=JSONArray();a.slots.forEach {images.put(JSONObject().put("camera_id",it.id).put("jpeg_b64",requireNotNull(it.sealed).getString("image_base64")))}
                    val bundle=JSONObject().put("version",1).put("type","nonverba-camera-set-bundle").put("request",a.request).put("attempt_id",a.id).put("images",images)
                    check(bundle.toString().length<=32*1024*1024) {"Sealed camera set exceeds this adapter's 32 MiB export limit"}
                    a.result=bundle
                    a.state="complete"
                }
                main.post {cleanup(a)}
            } catch(e:Throwable) {fail(a,safe(e))}
        }
    }
    private fun fresh(a:Attempt,slot:Slot) {
        val metadata=requireNotNull(slot.metadata)
        val elapsed=NativeSessionGuards.elapsedMillis(a.anchorMs,a.anchorNs,System.currentTimeMillis(),SystemClock.elapsedRealtimeNanos())
        val ns=metadata.getString(if(metadata.getString("timestamp_source")=="realtime")"sensor_timestamp_ns" else "callback_received_elapsed_ns").toLong()
        NativeSessionGuards.requireFresh(elapsed,(ns-a.anchorNs)/1_000_000,30_000)
    }
    private fun active(a:Attempt,state:String)=current===a && !closed && a.state==state
    private fun authority(a:Attempt,state:String) {
        NativeSessionGuards.requireAuthority(foreground,closed,active(a,state),permission())
        val challenge=a.request.getJSONObject("challenge")
        NativeSessionGuards.requireRequestWindow(System.currentTimeMillis(),challenge.getLong("issued_at"),challenge.getLong("expires_at"))
        check(NativeSessionGuards.elapsedMillis(a.anchorMs,a.anchorNs,System.currentTimeMillis(),SystemClock.elapsedRealtimeNanos())<60_000) {"Camera-set session expired"}
    }
    private fun terminate(a:Attempt,state:String,message:String) {
        if(a.state !in ACTIVE)return
        a.state=state;a.error=message.take(400);a.sequence?.cancel()
        a.slots.forEach {slot ->if(slot.bytes!=null)slot.outcome="image-discarded-unsigned";slot.bytes?.fill(0);slot.bytes=null}
    }
    private fun fail(a:Attempt,message:String) {synchronized(lock) {if(current!==a)return;terminate(a,"error",message)};main.post {cleanup(a)}}
    private fun cleanup(a:Attempt,keepDeadline:Boolean=false) {synchronized(lock) {
        val actions=mutableListOf<NativeLifecycleCleanup.Action>()
        if(!keepDeadline)actions+=NativeLifecycleCleanup.release("camera-set deadline",{a.timeout},{main.removeCallbacks(it)},{a.timeout=null})
        a.slots.forEach {slot -> actions+=NativeLifecycleCleanup.Action("${slot.id} release") {releaseSlot(a,slot)} }
        actions+=NativeLifecycleCleanup.release("camera-set dialog",{a.dialog},{it.dismiss()},{a.dialog=null;a.shutter=null})
        NativeLifecycleCleanup.run(actions) {failure ->if(a.cleanupErrors.size<16)a.cleanupErrors.add("${failure.label}: ${safe(failure.error)}")}
    }}
    private fun releaseSlot(a:Attempt,slot:Slot) {
        val actions=mutableListOf<NativeLifecycleCleanup.Action>()
            actions+=NativeLifecycleCleanup.Action("${slot.id} capture session") {slot.session?.let {if(!slot.closingSession){it.close();slot.closingSession=true}}}
            actions+=NativeLifecycleCleanup.Action("${slot.id} camera device") {slot.device?.let {if(!slot.closingDevice){it.close();slot.closingDevice=true}}}
            actions+=NativeLifecycleCleanup.Action("${slot.id} image listener") {slot.reader?.setOnImageAvailableListener(null,null)}
            actions+=NativeLifecycleCleanup.release("${slot.id} image reader",{slot.reader},{it.close()},{slot.reader=null})
            actions+=NativeLifecycleCleanup.release("${slot.id} surface",{slot.surface},{it.release()},{slot.surface=null})
            actions+=NativeLifecycleCleanup.release("${slot.id} preview listener",{slot.texture},{it.surfaceTextureListener=null},{slot.texture=null})
        NativeLifecycleCleanup.run(actions) {failure ->if(a.cleanupErrors.size<16)a.cleanupErrors.add("${failure.label}: ${safe(failure.error)}")}
    }
    private fun advanceSequence(a:Attempt,slot:Slot) {
        try {
            if(!active(a,"capturing"))return
            val sequence=a.sequence?:return
            val member=a.slots.indexOf(slot)
            val next=sequence.advanceIfReleased(member,
                slot.device==null && !slot.openPending && slot.reader==null && slot.surface==null && slot.texture==null,
                slot.session==null && !slot.configurePending)?:return
            authority(a,"capturing")
            handler.post {openDevices(a,listOf(a.slots[next]))}
        } catch(e:Throwable) {fail(a,safe(e))}
    }
    private fun released(a:Attempt)=a.dialog==null && a.slots.all {it.device==null && it.session==null && it.reader==null && it.surface==null && it.texture==null && !it.openPending && !it.configurePending}
    private fun snapshot(a:Attempt)=JSONObject().put("ok",a.state in ACTIVE || a.state=="complete").put("session_id",a.id).put("state",a.state)
        .put("key_fingerprint",a.identity.fingerprint).put("unsigned",true)
        .put("cleanup",if(released(a))"confirmed" else if(a.cleanupErrors.isNotEmpty())"failed-retained" else "unknown")
        .put("cleanup_errors",JSONArray(a.cleanupErrors)).put("members",JSONArray(a.slots.map {slot ->JSONObject().put("camera_id",slot.id).put("outcome",slot.outcome).put("signature_available",slot.sealed!=null)}))
        .also {a.error?.let {e->it.put("error",e)};a.result?.let {r->it.put("result",r)}}
    private fun readLedger():JSONObject {
        if(!ledger.baseFile.exists() && !File(ledger.baseFile.path+".bak").exists())return JSONObject()
        return ledger.openRead().use {check(it.channel.size()<=1024*1024);JSONObject(it.readBytes().toString(Charsets.UTF_8))}
    }
    private fun reserve(a:Attempt) {
        val entries=readLedger();val id=a.request.getJSONObject("challenge").getString("id")
        check(!entries.has(id) && entries.length()<4096) {"Camera-set replay ledger used or full"}
        entries.put(id,System.currentTimeMillis());val stream=ledger.startWrite()
        try {stream.write(entries.toString().toByteArray(Charsets.UTF_8));ledger.finishWrite(stream)}
        catch(e:Throwable) {ledger.failWrite(stream);throw e}
    }
    private fun safe(e:Throwable)=(e.message?:e.javaClass.simpleName).take(400)
    private fun failure(e:Throwable)=failureMessage(safe(e))
    private fun failureMessage(message:String)=JSONObject().put("ok",false).put("error",message).toString()
    companion object {private val ACTIVE=setOf("requesting-permission","opening","preview","awaiting-location","capturing","sealing")}
}
