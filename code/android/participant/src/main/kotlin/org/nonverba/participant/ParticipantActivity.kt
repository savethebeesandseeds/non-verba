// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.participant

import android.annotation.SuppressLint
import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import android.widget.Toast
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewFeature
import org.nonverba.identity.NativeIdentityCameraBridge
import java.io.ByteArrayInputStream

/** Shared participant UI with deliberate camera-only enrollment and debug account transport. */
class ParticipantActivity : Activity() {
    private lateinit var webView: WebView
    private var removeBackCallback: (() -> Unit)? = null
    private var accountTransport: AccountTransport? = null
    private var loginDevice: LoginDevice? = null
    private var recoveryExport: RecoveryCodeExport? = null
    private var identityCamera: NativeIdentityCameraBridge? = null
    private var nativeCameraPermission: ((Boolean) -> Unit)? = null
    private var resumed = false
    private var visible = false
    private var cameraRequest: PermissionRequest? = null
    private var cameraPermissionInFlight = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        webView.setBackgroundColor(Color.rgb(246, 244, 232))
        WebView.setWebContentsDebuggingEnabled(false)
        CookieManager.getInstance().setAcceptCookie(false)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
        webView.settings.apply {
            javaScriptEnabled = true
            // Bundled synthetic fixtures only; the shared adapter restricts its
            // localStorage prefix. Credentials and session tokens are not stored.
            domStorageEnabled = false
            allowFileAccess = false
            allowContentAccess = false
            blockNetworkLoads = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            setGeolocationEnabled(false)
            mediaPlaybackRequiresUserGesture = true
            cacheMode = WebSettings.LOAD_NO_CACHE
        }

        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                loginDevice?.documentChanged()
                recoveryExport?.documentChanged()
                identityCamera?.documentChanged()
                super.onPageStarted(view, url, favicon)
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.isForMainFrame) stopEnrollmentCamera()
                if (request.isForMainFrame && request.hasGesture() && request.method == "GET" &&
                    !request.isRedirect && request.url.toString() == CREDIT_URL) {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(CREDIT_URL))
                            .addCategory(Intent.CATEGORY_BROWSABLE))
                    } catch (_: ActivityNotFoundException) {
                        Toast.makeText(this@ParticipantActivity, "No browser is available.", Toast.LENGTH_SHORT).show()
                    }
                    return true
                }
                return !request.isForMainFrame || !isBundled(request.url, setOf(DOCUMENT_PATH))
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                super.doUpdateVisitedHistory(view, url, isReload)
                updateBackHandling()
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                if (request.method != "GET" || !isBundled(request.url, ASSET_PATHS)) return blockedResponse()
                val response = assets.shouldInterceptRequest(request.url) ?: return blockedResponse()
                response.responseHeaders = (response.responseHeaders ?: emptyMap()) + mapOf(
                    "Content-Security-Policy" to CONTENT_SECURITY_POLICY,
                    "X-Content-Type-Options" to "nosniff",
                    "Referrer-Policy" to "no-referrer",
                    "Permissions-Policy" to "camera=(self), microphone=(), geolocation=()",
                    "Cache-Control" to "no-store"
                )
                return response
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    // Exact bundled origin and camera-only resource. No microphone,
                    // file picker, external frame or future WebView permission.
                    if (!foregroundDocument() || !isCameraOrigin(request.origin) ||
                        request.resources.size != 1 || request.resources[0] != PermissionRequest.RESOURCE_VIDEO_CAPTURE ||
                        cameraRequest != null || cameraPermissionInFlight
                    ) { request.deny(); return@runOnUiThread }
                    cameraRequest = request
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        completeCameraPermission()
                    } else {
                        cameraPermissionInFlight = true
                        requestPermissions(arrayOf(Manifest.permission.CAMERA), CAMERA_PERMISSION)
                    }
                }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                runOnUiThread { if (cameraRequest === request) cameraRequest = null }
            }

            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                callback.invoke(origin, false, false)
            }
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            if (BuildConfig.DEBUG) accountTransport = AccountTransport(this, webView, "https://$APP_HOST$DOCUMENT_PATH")
            loginDevice = LoginDevice(this, webView, "https://$APP_HOST$DOCUMENT_PATH", ::foregroundDocument)
            recoveryExport = RecoveryCodeExport(this, webView, "https://$APP_HOST$DOCUMENT_PATH", ::foregroundDocument)
            identityCamera = NativeIdentityCameraBridge(this, webView, "https://$APP_HOST$DOCUMENT_PATH", ::foregroundDocument, ::requestNativeCameraPermission)
        }
        setContentView(webView)
        ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
            val safeArea = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime()
            )
            view.setPadding(safeArea.left, safeArea.top, safeArea.right, safeArea.bottom)
            insets
        }
        webView.loadUrl("https://$APP_HOST$DOCUMENT_PATH")
    }

    override fun onStart() {
        super.onStart()
        visible = true
        accountTransport?.start()
        loginDevice?.start()
        identityCamera?.start()
        if (BuildConfig.KEEP_SCREEN_AWAKE) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        if (BuildConfig.KEEP_SCREEN_AWAKE) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (::webView.isInitialized) { webView.onResume(); completeCameraPermission() }
        loginDevice?.resume()
        recoveryExport?.resume()
        identityCamera?.resume()
    }

    override fun onPause() {
        resumed = false
        loginDevice?.pause()
        recoveryExport?.pause()
        // Identity capture always loses authority on pause, including the first
        // OS permission overlay. A later grant needs a new deliberate Start.
        identityCamera?.pause()
        try {
            // The Android permission overlay may pause us. Preserve only that
            // pending prompt; losing the foreground later still cancels it.
            if (!cameraPermissionInFlight || nativeCameraPermission != null) stopEnrollmentCamera()
            if (::webView.isInitialized) webView.onPause()
        } finally {
            super.onPause()
        }
    }

    override fun onStop() {
        visible = false
        try {
            stopEnrollmentCamera()
            accountTransport?.stop()
            loginDevice?.stop()
            recoveryExport?.stop()
            identityCamera?.stop()
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } finally {
            super.onStop()
        }
    }

    override fun onDestroy() {
        try {
            stopEnrollmentCamera()
            accountTransport?.close()
            accountTransport = null
            loginDevice?.close()
            loginDevice = null
            recoveryExport?.close()
            recoveryExport = null
            identityCamera?.close()
            identityCamera = null
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            removeBackCallback?.invoke()
            removeBackCallback = null
            if (::webView.isInitialized) {
                try {
                    webView.stopLoading()
                } finally {
                    webView.webChromeClient = null
                    try {
                        (webView.parent as? ViewGroup)?.removeView(webView)
                    } finally {
                        webView.destroy()
                    }
                }
            }
        } finally {
            super.onDestroy()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, results)
        if (requestCode != CAMERA_PERMISSION) return
        cameraPermissionInFlight = false
        // Check the OS permission again only once the Activity has resumed.
        completeCameraPermission()
    }

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (recoveryExport?.activityResult(requestCode, resultCode, data) == true) return
        super.onActivityResult(requestCode, resultCode, data)
    }

    private fun foregroundDocument() = resumed && visible && ::webView.isInitialized &&
        webView.url == "https://$APP_HOST$DOCUMENT_PATH"

    private fun isCameraOrigin(uri: Uri): Boolean = uri.scheme == "https" && uri.host == APP_HOST &&
        (uri.port == -1 || uri.port == 443) && uri.userInfo == null && uri.query == null &&
        uri.fragment == null && uri.path in setOf("", "/")

    private fun completeCameraPermission() {
        if (!resumed || cameraPermissionInFlight) return
        nativeCameraPermission?.let { callback ->
            nativeCameraPermission = null
            callback(foregroundDocument() && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
            return
        }
        val request = cameraRequest ?: return
        cameraRequest = null
        if (foregroundDocument() && isCameraOrigin(request.origin) && request.resources.size == 1 &&
            request.resources[0] == PermissionRequest.RESOURCE_VIDEO_CAPTURE &&
            checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        ) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else request.deny()
    }

    private fun stopEnrollmentCamera() {
        nativeCameraPermission?.let { callback -> nativeCameraPermission = null; callback(false) }
        val request = cameraRequest
        cameraRequest = null
        request?.deny()
        if (::webView.isInitialized) webView.evaluateJavascript(
            "window.dispatchEvent(new Event('nonverba:camera-stop'));" +
                "document.querySelectorAll('video').forEach(v=>{v.pause();" +
                "if(v.srcObject){v.srcObject.getTracks().forEach(t=>t.stop());v.srcObject=null;}});", null
        )
    }

    private fun requestNativeCameraPermission(callback: (Boolean) -> Unit) {
        if (!foregroundDocument() || cameraPermissionInFlight || cameraRequest != null || nativeCameraPermission != null) {
            callback(false); return
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) { callback(true); return }
        nativeCameraPermission = callback
        cameraPermissionInFlight = true
        requestPermissions(arrayOf(Manifest.permission.CAMERA), CAMERA_PERMISSION)
    }

    // Views and Back history stay inside the shared UI. Bundled URLs carry no app state.
    private fun isBundled(uri: Uri, paths: Set<String>): Boolean =
        uri.scheme == "https" && uri.host == APP_HOST && (uri.port == -1 || uri.port == 443) &&
            uri.userInfo == null && uri.query == null && uri.fragment == null &&
            uri.encodedPath == uri.path && uri.path in paths

    // Compatibility for API 26–32. API 33+ uses the platform dispatcher below;
    // the legacy-method lint cannot infer that separate gesture callback.
    @SuppressLint("GestureBackNavigation")
    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    private fun updateBackHandling() {
        if (Build.VERSION.SDK_INT >= 33) {
            removeBackCallback?.invoke()
            removeBackCallback = null
            if (::webView.isInitialized && webView.canGoBack()) {
                val callback = OnBackInvokedCallback { webView.goBack() }
                onBackInvokedDispatcher.registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback
                )
                removeBackCallback = {
                    onBackInvokedDispatcher.unregisterOnBackInvokedCallback(callback)
                }
            }
        }
    }

    private fun blockedResponse() = WebResourceResponse(
        "text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0))
    )

    companion object {
        private const val APP_HOST = "appassets.androidplatform.net"
        private const val DOCUMENT_PATH = "/assets/participant/index.html"
        private const val CAMERA_PERMISSION = 2101
        private const val CREDIT_URL = "https://waajacu.com/"
        private val ASSET_PATHS = setOf(
            DOCUMENT_PATH, "/assets/participant/participant.css",
            "/assets/participant/participant.js", "/assets/participant/branding/sprout.svg",
            "/assets/participant/branding/home-sprout.webp", "/assets/participant/branding/home-succulent.webp",
            "/assets/participant/branding/waajacu.webp",
            "/assets/participant/identity/level-1.webp", "/assets/participant/identity/level-2.webp",
            "/assets/participant/identity/unverified.webp",
            "/assets/participant/onboarding-ui.js", "/assets/participant/onboarding-account.js", "/assets/participant/account-transport.js",
            "/assets/participant/account-terms.js",
            "/assets/participant/identity-intake-notice.js",
            "/assets/participant/identity-state.js", "/assets/participant/password-manager-sign-in.js",
            "/assets/participant/identity-review-client.js", "/assets/participant/identity-review-ui.js",
            "/assets/participant/recovery-export.js",
            "/assets/participant/identity/enrollment-camera.js", "/assets/participant/identity/identity-capture.js",
            "/assets/participant/identity/identity-camera-tool.js", "/assets/participant/identity/identity-capture-proof.js",
            "/assets/participant/identity/device-attestation.js",
            "/assets/participant/identity/browser-attestation-keys.js"
        )
        private const val CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'self'; " +
            "style-src 'self'; img-src 'self' blob:; font-src 'none'; connect-src 'none'; worker-src 'none'; " +
            "media-src 'self' blob:; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; " +
            "base-uri 'none'; form-action 'none'"
    }
}
