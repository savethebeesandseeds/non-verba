// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.participant

import android.app.Activity
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Debug-only USB loopback transport. No arbitrary URL, cookie jar or token storage. */
internal class AccountTransport(
    private val activity: Activity,
    private val webView: WebView,
    private val documentUrl: String
) {
    private var executor: ThreadPoolExecutor? = null
    @Volatile private var generation = 0
    @Volatile private var connection: HttpURLConnection? = null

    init {
        check(BuildConfig.DEBUG)
        WebViewCompat.addWebMessageListener(webView, BRIDGE, setOf(ASSET_ORIGIN)) {
                view, message, sourceOrigin, isMainFrame, reply ->
            if (!isMainFrame || sourceOrigin.toString() != ASSET_ORIGIN || view.url != documentUrl) return@addWebMessageListener
            val text = try { message.data } catch (_: Exception) { null } ?: return@addWebMessageListener
            if (text.toByteArray(Charsets.UTF_8).size > 208 * 1024) return@addWebMessageListener
            val input = try { JSONObject(text) } catch (_: Exception) { return@addWebMessageListener }
            val id = input.opt("id") as? String ?: return@addWebMessageListener
            if (!UUID.matches(id)) return@addWebMessageListener
            if (input.only("id", "config") && input.opt("config") == true) {
                reply.postMessage(JSONObject().put("id", id).put("config", JSONObject()
                    .put("enabled", true).put("development_only", true)).toString())
                return@addWebMessageListener
            }
            if (!validWire(input)) {
                reply.postMessage(failure(id, 400, "account_transport_invalid"))
                return@addWebMessageListener
            }
            val path = input.getJSONObject("request").getString("path")
            if (text.toByteArray(Charsets.UTF_8).size > if (path == PROVE) 208 * 1024 else REQUEST_LIMIT) return@addWebMessageListener
            val responseLimit = if (path == DEVICES) 256 * 1024 * 6 + 2048 else RESPONSE_LIMIT
            val expectedGeneration = generation
            try {
                val target = executor ?: throw RejectedExecutionException()
                target.execute {
                    if (expectedGeneration != generation || Thread.currentThread().isInterrupted) return@execute
                    val result = try { exchange(id, text, responseLimit) }
                    catch (_: Exception) { failure(id, 503, "account_transport_unavailable") }
                    activity.runOnUiThread {
                        if (expectedGeneration == generation && webView.url == documentUrl && !activity.isFinishing) {
                            reply.postMessage(result)
                        }
                    }
                }
            } catch (_: RejectedExecutionException) {
                reply.postMessage(failure(id, 429, "account_transport_busy"))
            }
        }
        start()
    }

    fun start() {
        if (executor != null) return
        generation++
        executor = ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
            ArrayBlockingQueue(4), ThreadPoolExecutor.AbortPolicy())
    }

    fun stop() {
        generation++
        executor?.shutdownNow()
        executor = null
        connection?.disconnect()
        connection = null
    }

    fun close() {
        stop()
        WebViewCompat.removeWebMessageListener(webView, BRIDGE)
    }

    private fun exchange(id: String, wire: String, responseLimit: Int): String {
        val request = URL(RELAY).openConnection() as HttpURLConnection
        connection = request
        try {
            request.requestMethod = "POST"
            request.instanceFollowRedirects = false
            request.useCaches = false
            request.connectTimeout = 3000
            request.readTimeout = 9000
            request.setRequestProperty("Content-Type", "application/json")
            request.setRequestProperty("Origin", RELAY_ORIGIN)
            request.setRequestProperty("X-Nonverba-Account", "1")
            request.doOutput = true
            val bytes = wire.toByteArray(Charsets.UTF_8)
            request.setFixedLengthStreamingMode(bytes.size)
            request.outputStream.use { it.write(bytes) }
            val status = request.responseCode
            val stream = if (status < 400) request.inputStream else request.errorStream
            val output = ByteArrayOutputStream()
            stream?.use {
                val buffer = ByteArray(4096)
                while (true) {
                    val count = it.read(buffer)
                    if (count < 0) break
                    check(output.size() + count <= responseLimit)
                    output.write(buffer, 0, count)
                }
            }
            val body = output.toString("UTF-8")
            if (status == 200) {
                val result = JSONObject(body)
                check(result.only("id", "response") && result.opt("id") == id && result.opt("response") is JSONObject)
                return result.toString()
            }
            return JSONObject().put("id", id).put("response", JSONObject().put("status", status)
                .put("headers", JSONObject().put("content-type", "application/json")).put("body", body)).toString()
        } finally {
            request.disconnect()
            if (connection === request) connection = null
        }
    }

    private fun validWire(input: JSONObject): Boolean {
        if (!input.only("id", "request")) return false
        val request = input.opt("request") as? JSONObject ?: return false
        if (!request.allowed("method", "path", "body", "headers", "flow_id")
            || request.opt("method") !is String || request.opt("path") !is String) return false
        val method = request.getString("method")
        val path = request.getString("path")
        // The relay independently validates the complete request. Keep this
        // native entry point bounded to the same account protocol namespaces.
        val allowedPath = when (method) {
            "GET" -> path in setOf("/v1/accounts/capabilities", "/v1/accounts/terms", "/v1/account/context", "/v1/account/devices", DEVICES, "/readyz", "/dev-oidc/jwks",
                "/dev-oidc/.well-known/openid-configuration") || path.startsWith("/dev-oidc/authorize?")
            "POST" -> path in setOf("/v1/accounts/enrollments", "/v1/accounts/enrollments/status",
                "/v1/accounts/entry/start", "/v1/accounts/entry/confirm",
                "/v1/accounts/enrollments/confirm", "/v1/accounts/recovery/start",
                "/v1/accounts/recovery/status", "/v1/accounts/recovery/finish",
                "/v1/accounts/mock-mail", "/v1/account/deletion", "/v1/account/deletion/status",
                "$DEVICES/challenge", PROVE, "/v1/account/sessions/revoke",
                "/dev-oidc/authorize", "/dev-oidc/token")
            "DELETE" -> path == "/v1/auth/session"
            else -> false
        }
        if (!allowedPath || path.any { it <= ' ' || it == '\\' || it == '#' || it == '\u007f' }) return false
        for (key in listOf("body", "flow_id")) if (request.has(key) && request.opt(key) !is String) return false
        if (request.has("body") && request.getString("body").toByteArray(Charsets.UTF_8).size >
            if (path == PROVE) 192 * 1024 else REQUEST_LIMIT) return false
        if (request.has("headers")) {
            val headers = request.opt("headers") as? JSONObject ?: return false
            val names = headers.keys().asSequence().toList()
            if (names.map { it.lowercase() }.toSet().size != names.size
                || names.any { it.lowercase() !in setOf("authorization", "content-type") || headers.opt(it) !is String }) return false
        }
        return true
    }

    private fun JSONObject.allowed(vararg names: String) = keys().asSequence().all { it in names }
    private fun JSONObject.only(vararg names: String) = length() == names.size && allowed(*names)

    private fun failure(id: String, status: Int, code: String) = JSONObject().put("id", id)
        .put("response", JSONObject().put("status", status).put("headers", JSONObject()
            .put("content-type", "application/json")).put("body", JSONObject().put("error", code).toString())).toString()

    companion object {
        private const val BRIDGE = "NonverbaAccount"
        private const val ASSET_ORIGIN = "https://appassets.androidplatform.net"
        private const val RELAY_ORIGIN = "http://127.0.0.1:4173"
        private const val RELAY = "$RELAY_ORIGIN/account-api/transport"
        private const val REQUEST_LIMIT = 16 * 1024
        private const val RESPONSE_LIMIT = 64 * 1024
        private const val DEVICES = "/v1/account/signin-devices"
        private const val PROVE = "$DEVICES/prove"
        private val UUID = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}")
    }
}
