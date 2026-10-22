// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.attestation

import android.app.Activity
import android.os.SystemClock
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import org.json.JSONObject
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Shared, exact-document WebView adapter for the tool's fixed sign-in possession profile. */
internal class DeviceAttestationBridge(
    private val activity: Activity,
    private val webView: WebView,
    private val documentUrl: String,
    private val foregroundDocument: () -> Boolean,
    private val challengeAllowed: (SigninDeviceChallenge) -> Boolean = { true }
) {
    private val store = DeviceAttestationStore(activity)
    private val operations = AttestationOperations(SystemClock::elapsedRealtime, ::now)
    private var executor: ThreadPoolExecutor? = null
    @Volatile private var foreground = false
    @Volatile private var closed = false

    init {
        WebViewCompat.addWebMessageListener(webView, BRIDGE, setOf(AttestationDocumentAccess.ASSET_ORIGIN)) {
                view, message, sourceOrigin, isMainFrame, reply ->
            if (!AttestationDocumentAccess.allows(documentUrl, view.url, sourceOrigin.toString(), isMainFrame,
                foreground, closed, foregroundDocument)) return@addWebMessageListener
            val text = try { message.data } catch (_: Exception) { null } ?: return@addWebMessageListener
            if (text.toByteArray(Charsets.UTF_8).size > REQUEST_LIMIT) return@addWebMessageListener
            val input = try { JSONObject(text) } catch (_: Exception) { return@addWebMessageListener }
            val id = input.opt("id") as? String ?: return@addWebMessageListener
            if (!AttestationOperations.UUID.matches(id)) return@addWebMessageListener
            if (input.only("id", "config") && input.opt("config") == true) {
                reply.postMessage(JSONObject().put("id", id).put("capabilities", JSONObject()
                    .put("available", true).put("platform", "android").put("version", 1)
                    .put("name", DeviceAttestationStore.deviceName())).toString())
                return@addWebMessageListener
            }
            if (input.only("id", "cancel")) {
                val target = input.opt("cancel") as? String
                if (target == null || !AttestationOperations.UUID.matches(target)) {
                    reply.postMessage(failure(id, "attestation_invalid"))
                } else {
                    reply.postMessage(JSONObject().put("id", id).put("cancelled", operations.cancel(target)).toString())
                }
                return@addWebMessageListener
            }
            val challenge = try {
                require(input.only("id", "challenge"))
                DeviceAttestationStore.parseChallenge(input.getJSONObject("challenge")).validate(now())
                    .also { require(challengeAllowed(it)) }
            } catch (_: Exception) {
                reply.postMessage(failure(id, "attestation_invalid"))
                return@addWebMessageListener
            }
            val ticket = try { operations.begin(id, challenge.expiresAt) }
            catch (error: AttestationFailure) {
                reply.postMessage(failure(id, error.code))
                return@addWebMessageListener
            } catch (_: Exception) {
                reply.postMessage(failure(id, "attestation_invalid"))
                return@addWebMessageListener
            }
            val active = { !closed && foreground && operations.active(ticket) }
            try {
                val target = executor ?: throw RejectedExecutionException()
                target.execute {
                    if (!active()) { operations.finish(ticket); return@execute }
                    val result = try {
                        JSONObject().put("id", id).put("proof", store.prove(challenge, active)).toString()
                            .also { check(it.toByteArray(Charsets.UTF_8).size <= DeviceAttestationStore.RESPONSE_LIMIT) }
                    } catch (error: AttestationFailure) { failure(id, error.code) }
                    catch (_: Exception) { failure(id, "attestation_unavailable") }
                    activity.runOnUiThread {
                        try {
                            if (active() && foregroundDocument() && webView.url == documentUrl && !activity.isFinishing) {
                                reply.postMessage(result)
                            }
                        } finally { operations.finish(ticket) }
                    }
                }
            } catch (_: RejectedExecutionException) {
                operations.finish(ticket)
                reply.postMessage(failure(id, "attestation_busy"))
            }
        }
    }

    fun start() {
        if (closed || executor != null) return
        operations.revokeAll()
        executor = ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
            ArrayBlockingQueue(4), ThreadPoolExecutor.AbortPolicy())
    }

    fun resume() { if (!closed) foreground = true }

    fun documentChanged() { operations.revokeAll() }

    fun pause() { foreground = false; operations.revokeAll() }

    fun stop() {
        pause()
        executor?.shutdownNow()
        executor = null
    }

    fun close() {
        closed = true
        stop()
        WebViewCompat.removeWebMessageListener(webView, BRIDGE)
    }

    private fun JSONObject.only(vararg names: String): Boolean = length() == names.size && keys().asSequence().all { it in names }
    private fun failure(id: String, error: String) = JSONObject().put("id", id).put("error", error).toString()
    private fun now() = System.currentTimeMillis() / 1000

    companion object {
        private const val BRIDGE = "NonverbaLoginDevice"
        private const val REQUEST_LIMIT = 8 * 1024
    }
}
