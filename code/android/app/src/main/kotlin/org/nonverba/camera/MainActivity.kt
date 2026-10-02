// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream

/** OS glue only: the shared Rust core owns protocol validation and provenance. */
class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var nativeLocation: NativeLocation
    private lateinit var nativeCamera: NativeCamera
    private lateinit var nativeAudio: NativeAudio
    private lateinit var nativeKeyEnrollment: NativeKeyEnrollment
    private lateinit var nativeScreenAwake: NativeScreenAwake
    private lateinit var nativeGpsWarmup: NativeGpsWarmup
    private var nativeCameraPairing: NativeCameraPairing? = null
    private var mediaRequest: PermissionRequest? = null
    private var locationRequest: LocationRequest? = null
    private var nativePermissionCallback: ((Boolean) -> Unit)? = null
    private var nativePermission: String? = null
    private var runtimePermissionInFlight: Int? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var visible = false
    private var resumed = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        webView.setBackgroundColor(Color.rgb(17, 20, 18))
        WebView.setWebContentsDebuggingEnabled(false)
        CookieManager.getInstance().setAcceptCookie(false)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
        GeolocationPermissions.getInstance().clear(APP_ORIGIN)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            // The system picker supplies content URIs to <input type=file>.
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            blockNetworkLoads = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            setGeolocationEnabled(true)
            mediaPlaybackRequiresUserGesture = true
            cacheMode = WebSettings.LOAD_NO_CACHE
        }

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                if (::nativeGpsWarmup.isInitialized) nativeGpsWarmup.pageStarted()
                nativeCameraPairing?.setForeground(false)
                if (::nativeLocation.isInitialized) nativeLocation.pause()
                if (::nativeCamera.isInitialized) nativeCamera.pause()
                if (::nativeAudio.isInitialized) nativeAudio.pause()
                if (::nativeKeyEnrollment.isInitialized) nativeKeyEnrollment.pause()
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (::nativeGpsWarmup.isInitialized) nativeGpsWarmup.pageFinished()
                if (::nativeScreenAwake.isInitialized && resumed) nativeScreenAwake.resume()
                refreshCameraPairingAccess()
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // No remote pages, imported HTML, frames, custom schemes, or external links.
                return !request.isForMainFrame || !isAppDocument(request.url)
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                if (request.method != "GET" || !isBundledAsset(request.url)) return blockedResponse()
                val response = assetLoader.shouldInterceptRequest(request.url) ?: return blockedResponse()
                if (request.url.path?.endsWith(".wasm") == true) response.mimeType = "application/wasm"
                response.responseHeaders = (response.responseHeaders ?: emptyMap()) + mapOf(
                    "Content-Security-Policy" to CONTENT_SECURITY_POLICY,
                    "X-Content-Type-Options" to "nosniff",
                    "Referrer-Policy" to "no-referrer",
                    "Permissions-Policy" to "camera=(self), microphone=(self), geolocation=(self)",
                    "Cache-Control" to "no-store"
                )
                return response
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    val permissions = requiredMediaPermissions(request.resources)
                    if (!isPermissionOrigin(request.origin) ||
                        permissions == null ||
                        !hasForegroundAppDocument() || runtimePermissionInFlight != null
                    ) {
                        request.deny()
                        return@runOnUiThread
                    }
                    val missing = permissions.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
                    if (missing.isEmpty()) {
                        grantAllowedMediaResources(request)
                    } else if (mediaRequest == null && locationRequest == null && nativePermissionCallback == null) {
                        mediaRequest = request
                        runtimePermissionInFlight = MEDIA_PERMISSION
                        requestPermissions(missing.toTypedArray(), MEDIA_PERMISSION)
                    } else {
                        request.deny()
                    }
                }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (mediaRequest === request) mediaRequest = null
            }

            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                runOnUiThread {
                    if (!isPermissionOrigin(Uri.parse(origin)) || !hasForegroundAppDocument() ||
                        runtimePermissionInFlight != null || mediaRequest != null || locationRequest != null || nativePermissionCallback != null
                    ) {
                        callback.invoke(origin, false, false)
                        return@runOnUiThread
                    }
                    if (hasLocationPermission()) {
                        callback.invoke(origin, true, false)
                    } else {
                        locationRequest = LocationRequest(origin, callback)
                        runtimePermissionInFlight = LOCATION_PERMISSION
                        // Android 12+ must receive both together so approximate access remains valid.
                        requestPermissions(
                            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                            LOCATION_PERMISSION
                        )
                    }
                }
            }

            override fun onGeolocationPermissionsHidePrompt() {
                // The originating web request was canceled. Do not grant its late OS result.
                locationRequest = null
            }

            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: WebChromeClient.FileChooserParams
            ): Boolean {
                if (!hasForegroundAppDocument() || !isAppDocument(Uri.parse(view.url ?: ""))) return false
                finishDocumentPicker(null)
                fileCallback = callback
                // Imports are for challenges/signaling and verification, never live capture.
                val allowed = params.acceptTypes.flatMap { it.split(',') }
                    .map { it.trim() }.filter { it in IMPORT_MIME_TYPES }.distinct()
                val picker = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = if (allowed.size == 1) allowed.single() else "*/*"
                    if (allowed.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, allowed.toTypedArray())
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                // Deliver the narrow own-picker signal before Android can pause
                // the page. No sensor or Activity lifecycle guard is relaxed.
                view.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('nonverba:file-picker',{detail:{active:true}}));"
                ) {
                    if (fileCallback !== callback) return@evaluateJavascript
                    if (!hasForegroundAppDocument()) {
                        finishDocumentPicker(null)
                        return@evaluateJavascript
                    }
                    try {
                        @Suppress("DEPRECATION")
                        startActivityForResult(picker, PICK_DOCUMENT)
                    } catch (_: ActivityNotFoundException) {
                        finishDocumentPicker(null)
                        Toast.makeText(this@MainActivity, R.string.picker_failed, Toast.LENGTH_LONG).show()
                    }
                }
                return true
            }
        }
        webView.addJavascriptInterface(NativeVault(this, ::confirmArtifactSaved), "NativeVault")
        if (BuildConfig.DEBUG) {
            nativeCameraPairing = NativeCameraPairing(cacheDir.canonicalFile, true)
            webView.addJavascriptInterface(nativeCameraPairing!!, "NativeCameraPairing")
        }
        val gpsHandler = Handler(Looper.getMainLooper())
        val gpsManager = getSystemService(LOCATION_SERVICE) as LocationManager
        nativeGpsWarmup = NativeGpsWarmup(
            postToMain = { action -> runOnUiThread { action() } },
            readiness = {
                when {
                    !hasForegroundAppDocument() || Uri.parse(webView.url ?: "").path !in GPS_DOCUMENT_PATHS -> "page-unavailable"
                    checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED -> "permission-required"
                    !runCatching { gpsManager.isProviderEnabled(LocationManager.GPS_PROVIDER) }.getOrDefault(false) -> "provider-unavailable"
                    else -> null
                }
            },
            startListening = { onFix, onUnavailable ->
                registerGpsWarmup(gpsManager, onFix, onUnavailable)
            },
            elapsedMs = SystemClock::elapsedRealtime,
            schedule = { delay, action ->
                val runnable = Runnable { action() }
                gpsHandler.postDelayed(runnable, delay)
                val cancel: () -> Unit = { gpsHandler.removeCallbacks(runnable) }
                cancel
            },
            notifyState = { state ->
                if (hasForegroundAppDocument()) webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('nonverba:gps-warmup',{detail:$state}));", null
                )
            }
        )
        webView.addJavascriptInterface(nativeGpsWarmup, "NativeGpsWarmup")
        nativeLocation = NativeLocation(this, ::hasForegroundAppDocument, ::requestNativeFinePermission,
            nativeGpsWarmup::prepareForRequest)
        webView.addJavascriptInterface(nativeLocation, "NativeLocation")
        nativeCamera = NativeCamera(this, ::hasForegroundAppDocument, ::requestNativeCameraPermission)
        webView.addJavascriptInterface(nativeCamera, "NativeCamera")
        nativeAudio = NativeAudio(this, ::hasForegroundAppDocument, ::requestNativeAudioPermission)
        webView.addJavascriptInterface(nativeAudio, "NativeAudio")
        nativeKeyEnrollment = NativeKeyEnrollment(this) {
            hasForegroundAppDocument() && Uri.parse(webView.url ?: "").path == KEY_ENROLLMENT_DOCUMENT_PATH
        }
        webView.addJavascriptInterface(nativeKeyEnrollment, "NativeKeyEnrollment")
        val awakePreferences = getSharedPreferences("foreground-screen-awake-lease-v1", MODE_PRIVATE)
        val awakeHandler = Handler(Looper.getMainLooper())
        nativeScreenAwake = NativeScreenAwake(
            postToMain = { action -> runOnUiThread { action() } },
            hasForegroundAppDocument = ::hasForegroundAppDocument,
            applyWindowFlag = { enabled ->
                if (enabled) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            },
            clock = { NativeScreenAwake.Clock(System.currentTimeMillis(), SystemClock.elapsedRealtime(),
                runCatching { Settings.Global.getInt(contentResolver, Settings.Global.BOOT_COUNT, -1) }.getOrDefault(-1)) },
            loadLease = {
                if (awakePreferences.contains("wall_ms")) NativeScreenAwake.Lease(
                    awakePreferences.getLong("wall_ms", -1), awakePreferences.getLong("elapsed_ms", -1),
                    awakePreferences.getInt("boot", -1)) else null
            },
            saveLease = { lease ->
                awakePreferences.edit().apply {
                    if (lease == null) clear()
                    else putLong("wall_ms", lease.wallMs).putLong("elapsed_ms", lease.elapsedMs).putInt("boot", lease.boot)
                }.apply()
            },
            schedule = { delay, action ->
                val runnable = Runnable { action() }
                awakeHandler.postDelayed(runnable, delay)
                val cancel: () -> Unit = { awakeHandler.removeCallbacks(runnable) }
                cancel
            },
            notifyState = { state ->
                if (hasForegroundAppDocument()) {
                    webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('nonverba:screen-awake',{detail:$state}));", null
                    )
                }
            }
        )
        webView.addJavascriptInterface(nativeScreenAwake, "NativeScreenAwake")
        setContentView(webView)
        ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
            val safeArea = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime()
            )
            view.setPadding(safeArea.left, safeArea.top, safeArea.right, safeArea.bottom)
            insets
        }
        webView.loadUrl(APP_URL)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, results)
        if (requestCode != runtimePermissionInFlight) return
        runtimePermissionInFlight = null
        // A permission overlay can pause the Activity. Resolve only after it is resumed.
        // Read current OS permission state instead of assuming result array order or precision.
        completePendingPermissions()
    }

    @Deprecated("Framework callback retained for a minimal Activity without an AndroidX Activity dependency")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != PICK_DOCUMENT) return
        val uri = data?.data?.takeIf { resultCode == RESULT_OK && it.scheme == "content" }
        finishDocumentPicker(uri?.let { arrayOf(it) })
    }

    private fun finishDocumentPicker(value: Array<Uri>?) {
        val callback = fileCallback ?: return
        fileCallback = null
        webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('nonverba:file-picker',{detail:{active:false}}));",
            null
        )
        callback.onReceiveValue(value)
    }

    override fun onPause() {
        resumed = false
        nativeCameraPairing?.setForeground(false)
        nativeScreenAwake.pause()
        nativeGpsWarmup.pause()
        nativeKeyEnrollment.pause()
        if (runtimePermissionInFlight != NATIVE_LOCATION_PERMISSION) nativeLocation.pause()
        if (runtimePermissionInFlight != NATIVE_CAMERA_PERMISSION) nativeCamera.pause()
        if (runtimePermissionInFlight != NATIVE_AUDIO_PERMISSION) nativeAudio.pause()
        if (runtimePermissionInFlight == null) disableGeolocation()
        // Preserve the camera page's permission-overlay flow. Audio must always be told
        // to release unattached microphone streams/worklets, even during an OS overlay.
        stopSensitiveActivity(
            notifyPage = runtimePermissionInFlight == null ||
                (Uri.parse(webView.url ?: "").path == AUDIO_DOCUMENT_PATH && runtimePermissionInFlight != NATIVE_AUDIO_PERMISSION)
        )
        webView.onPause()
        super.onPause()
    }

    private fun stopSensitiveActivity(notifyPage: Boolean = true) {
        webView.evaluateJavascript(
            (if (notifyPage) "window.dispatchEvent(new Event('nonverba:pause'));" else "") +
                "document.querySelectorAll('video,audio').forEach(v=>{v.pause();" +
                "if(v.srcObject){v.srcObject.getTracks().forEach(t=>t.stop());v.srcObject=null;}});",
            null
        )
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        if (::nativeScreenAwake.isInitialized) nativeScreenAwake.resume()
        if (::webView.isInitialized) {
            webView.settings.setGeolocationEnabled(true)
            webView.onResume()
            completePendingPermissions()
            refreshCameraPairingAccess()
            nativeGpsWarmup.resume()
        }
    }

    override fun onStart() {
        super.onStart()
        visible = true
        if (::webView.isInitialized) refreshCameraPairingAccess()
    }

    override fun onStop() {
        visible = false
        resumed = false
        nativeCameraPairing?.setForeground(false)
        nativeScreenAwake.pause()
        nativeGpsWarmup.pause()
        nativeLocation.pause()
        nativeCamera.pause()
        nativeAudio.pause()
        nativeKeyEnrollment.pause()
        disableGeolocation()
        cancelPendingPermissions()
        stopSensitiveActivity()
        super.onStop()
    }

    override fun onDestroy() {
        nativeCameraPairing?.destroy()
        nativeScreenAwake.destroy()
        nativeGpsWarmup.destroy()
        nativeLocation.destroy()
        nativeCamera.destroy()
        nativeAudio.destroy()
        nativeKeyEnrollment.destroy()
        disableGeolocation()
        cancelPendingPermissions()
        runtimePermissionInFlight = null
        finishDocumentPicker(null)
        webView.removeJavascriptInterface("NativeVault")
        webView.removeJavascriptInterface("NativeLocation")
        webView.removeJavascriptInterface("NativeCamera")
        webView.removeJavascriptInterface("NativeAudio")
        webView.removeJavascriptInterface("NativeKeyEnrollment")
        webView.removeJavascriptInterface("NativeScreenAwake")
        webView.removeJavascriptInterface("NativeGpsWarmup")
        webView.removeJavascriptInterface("NativeCameraPairing")
        webView.stopLoading()
        webView.destroy()
        super.onDestroy()
    }

    private fun confirmArtifactSaved(destination: String) {
        runOnUiThread {
            if (!isFinishing && !isDestroyed) {
                Toast.makeText(this, getString(R.string.artifact_saved, destination), Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun blockedResponse() = WebResourceResponse(
        "text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0))
    )

    private fun isAppOrigin(uri: Uri) = uri.scheme == "https" && uri.host == APP_HOST &&
        (uri.port == -1 || uri.port == 443) && uri.userInfo == null

    private fun isPermissionOrigin(uri: Uri) = isAppOrigin(uri) &&
        (uri.path.isNullOrEmpty() || uri.path == "/") && uri.query == null && uri.fragment == null

    private fun isAppDocument(uri: Uri) = isAppOrigin(uri) && uri.path in APP_DOCUMENT_PATHS

    private fun hasForegroundAppDocument() = visible && resumed && !isFinishing && !isDestroyed &&
        isAppDocument(Uri.parse(webView.url ?: ""))

    private fun refreshCameraPairingAccess() {
        nativeCameraPairing?.setForeground(hasForegroundAppDocument() &&
            Uri.parse(webView.url ?: "").path == "/assets/web/index.html")
    }

    private fun hasLocationPermission() =
        checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission") // Warm-up checks precise permission and foreground immediately before registration.
    private fun registerGpsWarmup(manager: LocationManager, onFix: () -> Unit, onUnavailable: () -> Unit): () -> Unit {
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) { onFix() } // Discard the entire fix.
            override fun onProviderDisabled(provider: String) { onUnavailable() }
            override fun onProviderEnabled(provider: String) = Unit
            @Suppress("OVERRIDE_DEPRECATION")
            @Deprecated("Legacy Android callback")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
        }
        try {
            manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1_000L, 0f, listener, Looper.getMainLooper())
        } catch (error: Exception) {
            runCatching { manager.removeUpdates(listener) }
            throw error
        }
        return { manager.removeUpdates(listener) }
    }

    private fun requestNativeFinePermission(callback: (Boolean) -> Unit) = requestNativePermission(
        Manifest.permission.ACCESS_FINE_LOCATION,
        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
        NATIVE_LOCATION_PERMISSION, callback
    )

    private fun requestNativeCameraPermission(callback: (Boolean) -> Unit) = requestNativePermission(
        Manifest.permission.CAMERA, arrayOf(Manifest.permission.CAMERA), NATIVE_CAMERA_PERMISSION, callback
    )

    private fun requestNativeAudioPermission(callback: (Boolean) -> Unit) = requestNativePermission(
        Manifest.permission.RECORD_AUDIO, arrayOf(Manifest.permission.RECORD_AUDIO), NATIVE_AUDIO_PERMISSION, callback
    )

    private fun requestNativePermission(permission: String, permissions: Array<String>, requestCode: Int, callback: (Boolean) -> Unit) {
        if (!hasForegroundAppDocument() || runtimePermissionInFlight != null || mediaRequest != null ||
            locationRequest != null || nativePermissionCallback != null
        ) { callback(false); return }
        if (checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) {
            callback(true)
        } else {
            nativePermissionCallback = callback
            nativePermission = permission
            runtimePermissionInFlight = requestCode
            requestPermissions(permissions, requestCode)
        }
    }

    private fun disableGeolocation() {
        webView.settings.setGeolocationEnabled(false)
        GeolocationPermissions.getInstance().clear(APP_ORIGIN)
    }

    private fun requiredMediaPermissions(resources: Array<String>): List<String>? {
        // Exact nonempty audio/video sets only. Never approve unknown future WebView resources.
        if (resources.isEmpty() || resources.size != resources.toSet().size) return null
        return resources.map { MEDIA_RUNTIME_PERMISSIONS[it] ?: return null }
    }

    private fun grantAllowedMediaResources(request: PermissionRequest) {
        request.grant(MEDIA_RUNTIME_PERMISSIONS.keys.filter { it in request.resources }.toTypedArray())
    }

    private fun completePendingPermissions() {
        if (!resumed || runtimePermissionInFlight != null) return
        mediaRequest?.let { request ->
            mediaRequest = null
            val permissions = requiredMediaPermissions(request.resources)
            if (hasForegroundAppDocument() && isPermissionOrigin(request.origin) && permissions != null &&
                permissions.all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
            ) grantAllowedMediaResources(request) else request.deny()
        }
        locationRequest?.let { request ->
            locationRequest = null
            request.callback.invoke(
                request.origin,
                hasForegroundAppDocument() && isPermissionOrigin(Uri.parse(request.origin)) && hasLocationPermission(),
                false // Never persist a WebView grant beyond this page; Android remains authoritative.
            )
        }
        nativePermissionCallback?.let { callback ->
            val permission = nativePermission
            nativePermissionCallback = null
            nativePermission = null
            callback(permission != null && hasForegroundAppDocument() && checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED)
        }
    }

    private fun cancelPendingPermissions() {
        mediaRequest?.deny()
        mediaRequest = null
        locationRequest?.let { it.callback.invoke(it.origin, false, false) }
        locationRequest = null
        nativePermissionCallback?.invoke(false)
        nativePermissionCallback = null
        nativePermission = null
        // Keep the runtime dialog slot occupied until its OS callback arrives.
    }

    private data class LocationRequest(val origin: String, val callback: GeolocationPermissions.Callback)

    private fun isBundledAsset(uri: Uri): Boolean {
        val path = uri.path ?: return false
        return isAppOrigin(uri) && path.startsWith("/assets/web/") &&
            path.split('/').none { it == ".." || it == "." } && !path.contains('\\')
    }

    companion object {
        private const val APP_HOST = "appassets.androidplatform.net"
        private const val APP_ORIGIN = "https://$APP_HOST"
        private const val APP_URL = "$APP_ORIGIN/assets/web/index.html"
        private const val MEDIA_PERMISSION = 101
        private const val PICK_DOCUMENT = 102
        private const val LOCATION_PERMISSION = 103
        private const val NATIVE_LOCATION_PERMISSION = 104
        private const val NATIVE_CAMERA_PERMISSION = 105
        private const val NATIVE_AUDIO_PERMISSION = 106
        private const val AUDIO_DOCUMENT_PATH = "/assets/web/audio.html"
        private const val KEY_ENROLLMENT_DOCUMENT_PATH = "/assets/web/key-enrollment.html"
        private val GPS_DOCUMENT_PATHS = setOf("/assets/web/index.html", "/assets/web/location.html", "/assets/web/live-location.html")
        private val APP_DOCUMENT_PATHS = setOf("/assets/web/index.html", AUDIO_DOCUMENT_PATH, "/assets/web/location.html", "/assets/web/live-location.html", KEY_ENROLLMENT_DOCUMENT_PATH)
        private val MEDIA_RUNTIME_PERMISSIONS = mapOf(
            PermissionRequest.RESOURCE_VIDEO_CAPTURE to Manifest.permission.CAMERA,
            PermissionRequest.RESOURCE_AUDIO_CAPTURE to Manifest.permission.RECORD_AUDIO
        )
        private val IMPORT_MIME_TYPES = setOf(
            "application/json", "image/jpeg", "application/octet-stream",
            "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"
        )
        private const val CONTENT_SECURITY_POLICY = "default-src 'none'; " +
            "script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; " +
            "img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; " +
            "connect-src 'self'; worker-src 'self'; object-src 'none'; frame-src 'none'; " +
            "frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    }
}
