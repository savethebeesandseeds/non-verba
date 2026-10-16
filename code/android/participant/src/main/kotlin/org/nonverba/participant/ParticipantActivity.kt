// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.participant

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream

/** Bundled participant preview only. No native bridge, identity or sensor authority. */
class ParticipantActivity : Activity() {
    private lateinit var webView: WebView

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
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !request.isForMainFrame || !isBundled(request.url, setOf(DOCUMENT_PATH))

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                if (request.method != "GET" || !isBundled(request.url, ASSET_PATHS)) return blockedResponse()
                val response = assets.shouldInterceptRequest(request.url) ?: return blockedResponse()
                response.responseHeaders = (response.responseHeaders ?: emptyMap()) + mapOf(
                    "Content-Security-Policy" to CONTENT_SECURITY_POLICY,
                    "X-Content-Type-Options" to "nosniff",
                    "Referrer-Policy" to "no-referrer",
                    "Permissions-Policy" to "camera=(), microphone=(), geolocation=()",
                    "Cache-Control" to "no-store"
                )
                return response
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { request.deny() }
            }

            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                callback.invoke(origin, false, false)
            }
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

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) webView.onResume()
    }

    override fun onPause() {
        try {
            if (::webView.isInitialized) webView.onPause()
        } finally {
            super.onPause()
        }
    }

    override fun onDestroy() {
        try {
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

    private fun isBundled(uri: Uri, paths: Set<String>): Boolean =
        uri.scheme == "https" && uri.host == APP_HOST && (uri.port == -1 || uri.port == 443) &&
            uri.userInfo == null && uri.query == null && uri.fragment == null &&
            uri.encodedPath == uri.path && uri.path in paths

    private fun blockedResponse() = WebResourceResponse(
        "text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0))
    )

    companion object {
        private const val APP_HOST = "appassets.androidplatform.net"
        private const val DOCUMENT_PATH = "/assets/participant/index.html"
        private val ASSET_PATHS = setOf(
            DOCUMENT_PATH, "/assets/participant/participant.css",
            "/assets/participant/participant.js", "/assets/participant/branding/sprout.svg"
        )
        private const val CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'self'; " +
            "style-src 'self'; img-src 'self'; font-src 'none'; connect-src 'none'; worker-src 'none'; " +
            "media-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; " +
            "base-uri 'none'; form-action 'none'"
    }
}
