// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.identity

import android.app.Activity
import android.os.SystemClock
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import org.json.JSONObject
import org.nonverba.attestation.AttestationDocumentAccess
import org.nonverba.attestation.AttestationOperations
import org.nonverba.attestation.DeviceAttestationProof
import org.nonverba.camera.NativeCameraEngine
import org.nonverba.camera.NativeCameraLabels
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Exact-document structured bridge. No image/hash/signing bytes are accepted from JavaScript. */
internal class NativeIdentityCameraBridge(private val activity: Activity, private val webView: WebView,
    private val documentUrl: String, private val foregroundDocument: () -> Boolean,
    requestPermission: ((Boolean) -> Unit) -> Unit) {
    private class Ticket(val id: String, val generation: Long, val started: Long, val maximumMs: Long) {
        @Volatile var cancelled = false
        @Volatile var session: String? = null
    }
    private val lock = Any()
    private val tickets = mutableMapOf<String, Ticket>()
    private var lease: Ticket? = null
    private var generation = 0L
    @Volatile private var foreground = false
    @Volatile private var closed = false
    private var executor: ThreadPoolExecutor? = null
    private val key = IdentityCaptureKey(activity)
    private fun documentAllowed() = !activity.isFinishing && !activity.isDestroyed && foregroundDocument()
    private val engine = NativeCameraEngine(activity, ::documentAllowed, requestPermission,
        NativeCameraLabels("Identity photo", "Opening the required camera…", "Take photo", "Cancel", "Taking photo…",
            "Center the document or face, then take the photo.", "Preparing photo…"), "identity-camera-replay-v1.json") { request, auxiliary, active ->
        require(auxiliary.isEmpty()); IdentityCameraProfile.prepare(request, key, active)
    }
    init {
        WebViewCompat.addWebMessageListener(webView, BRIDGE, setOf(AttestationDocumentAccess.ASSET_ORIGIN)) {
                view, message, origin, mainFrame, reply ->
            // Only revocation is admitted across an OS permission pause. The exact
            // document/main-frame/origin checks still precede parsing any message.
            if (!IdentityCameraDocumentAccess.allows(documentUrl, view.url, origin.toString(), mainFrame, foreground, closed, true, ::documentAllowed)) return@addWebMessageListener
            val text = try { message.data } catch (_: Exception) { null } ?: return@addWebMessageListener
            if (text.toByteArray(Charsets.UTF_8).size > 16_384) return@addWebMessageListener
            val input = try { JSONObject(text) } catch (_: Exception) { return@addWebMessageListener }
            val id = input.opt("id") as? String ?: return@addWebMessageListener
            if (!AttestationOperations.UUID.matches(id)) return@addWebMessageListener
            if (input.only("id", "cancel")) {
                val target = input.opt("cancel") as? String
                val cancelled = if (target != null && AttestationOperations.UUID.matches(target)) cancel(target) else false
                reply.postMessage(JSONObject().put("id", id).put("cancelled", cancelled).toString()); return@addWebMessageListener
            }
            val op = input.optString("op")
            if (op == "cancel" && input.only("id", "op", "session_id")) {
                val session = input.opt("session_id") as? String
                val current = synchronized(lock) { lease }
                if (session == null || current?.session != session) reply.postMessage(failure(id, "identity_camera_invalid"))
                else { cancelSession(session); reply.postMessage(JSONObject().put("id", id).put("cancelled", true).toString()) }
                return@addWebMessageListener
            }
            if (!IdentityCameraDocumentAccess.allows(documentUrl, view.url, origin.toString(), mainFrame, foreground, closed, false, ::documentAllowed)) return@addWebMessageListener
            val valid = when (op) {
                "key" -> input.only("id", "op", "context") && input.opt("context") is JSONObject
                "start" -> input.only("id", "op", "request") && input.opt("request") is JSONObject
                "result" -> input.only("id", "op", "session_id") && input.opt("session_id") is String
                else -> false
            }
            if (!valid) { reply.postMessage(failure(id, "identity_camera_invalid")); return@addWebMessageListener }
            val ticket = synchronized(lock) {
                if (tickets.size >= 4 || tickets.containsKey(id)) null
                else Ticket(id, generation, SystemClock.elapsedRealtime(), if (op == "result") 120_000 else 30_000).also { tickets[id] = it }
            }
            if (ticket == null) { reply.postMessage(failure(id, "identity_camera_busy")); return@addWebMessageListener }
            try {
                (executor ?: throw RejectedExecutionException()).execute {
                    val response = try {
                        requireActive(ticket)
                        when (op) {
                            "key" -> {
                                val context = input.getJSONObject("context")
                                require(context.only("account_id", "principal_id", "current_session_id", "recovery_generation"))
                                for (field in listOf("account_id", "principal_id", "current_session_id")) require(context.opt(field) is String && IdentityCaptureProtocol.identifier(context.getString(field)))
                                IdentityCaptureProtocol.integer(context.get("recovery_generation"))
                                val identity = key.identity(context.getString("account_id")) { active(ticket) }
                                JSONObject().put("id", id).put("key", JSONObject().put("public_spki_der_b64", DeviceAttestationProof.b64(identity.spki))
                                    .put("public_spki_sha256", identity.pin))
                            }
                            "start" -> {
                                val request = input.getJSONObject("request")
                                IdentityCaptureProtocol.request(IdentityCameraProfile.objectMap(request), System.currentTimeMillis())
                                synchronized(lock) {
                                    check(lease == null || lease?.cancelled == true || lease?.session == null) { "identity_camera_busy" }
                                    lease = ticket
                                }
                                val started = JSONObject(engine.begin(request.toString(), "") { leaseActive(ticket) })
                                check(started.optBoolean("ok", false))
                                ticket.session = started.getString("session_id")
                                requireActive(ticket)
                                JSONObject().put("id", id).put("session_id", ticket.session)
                            }
                            else -> {
                                val session = input.getString("session_id")
                                val owner = synchronized(lock) { lease?.takeIf { it.session == session } } ?: error("identity_camera_invalid")
                                ticket.session = session
                                var result: JSONObject? = null
                                while (result == null) {
                                    requireActive(ticket); check(leaseActive(owner)) { "identity_camera_cancelled" }
                                    val status = JSONObject(engine.status(session))
                                    if (status.optString("state") == "cancelled") error("identity_camera_cancelled")
                                    check(status.optBoolean("ok", false))
                                    if (status.optString("state") == "complete" && status.optString("cleanup") == "confirmed") result = status.getJSONObject("result")
                                    else Thread.sleep(100)
                                }
                                result.put("cleanup", "confirmed")
                                owner.cancelled = true
                                JSONObject().put("id", id).put("result", result)
                            }
                        }.also { requireActive(ticket) }
                    } catch (error: Exception) {
                        if (op != "key") {
                            ticket.session?.let { session ->
                                engine.cancel(session)
                                synchronized(lock) { lease?.takeIf { it.session == session }?.cancelled = true }
                            }
                            if (op == "start") synchronized(lock) { if (lease === ticket) lease = null }
                        }
                        val code = error.message?.takeIf { it in ERRORS } ?: if (error is IllegalArgumentException) "identity_camera_invalid" else "identity_camera_unavailable"
                        JSONObject().put("id", id).put("error", code)
                    }
                    activity.runOnUiThread {
                        try {
                            if (active(ticket) && documentAllowed() && webView.url == documentUrl) {
                                val encoded = response.toString(); check(encoded.toByteArray(Charsets.UTF_8).size <= 3 * 1024 * 1024)
                                reply.postMessage(encoded)
                                if (op == "result") ticket.session?.let { engine.consume(it) }
                            }
                        } finally { synchronized(lock) { if (tickets[id] === ticket) tickets.remove(id) } }
                    }
                }
            } catch (_: RejectedExecutionException) {
                synchronized(lock) { tickets.remove(id) }
                reply.postMessage(failure(id, "identity_camera_busy"))
            }
        }
    }
    private fun active(ticket: Ticket) = synchronized(lock) {
        val elapsed = SystemClock.elapsedRealtime() - ticket.started
        !closed && foreground && !ticket.cancelled && ticket.generation == generation && tickets[ticket.id] === ticket &&
            elapsed in 0..ticket.maximumMs && !Thread.currentThread().isInterrupted
    }
    private fun leaseActive(ticket: Ticket) = synchronized(lock) {
        !closed && foreground && !ticket.cancelled && ticket.generation == generation && lease === ticket &&
            SystemClock.elapsedRealtime() - ticket.started in 0..120_000
    }
    private fun requireActive(ticket: Ticket) { check(active(ticket)) { "identity_camera_cancelled" } }
    private fun cancel(id: String): Boolean {
        val ticket = synchronized(lock) { tickets[id] ?: lease?.takeIf { it.id == id } } ?: return false
        ticket.cancelled = true; ticket.session?.let { cancelSession(it) }; return true
    }
    private fun cancelSession(session: String) {
        synchronized(lock) {
            tickets.values.filter { it.session == session }.forEach { it.cancelled = true }
            lease?.takeIf { it.session == session }?.cancelled = true
        }
        engine.cancel(session)
    }
    fun start() {
        if (closed || executor != null) return
        executor = ThreadPoolExecutor(2, 2, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue(4), ThreadPoolExecutor.AbortPolicy())
    }
    fun resume() { if (!closed) foreground = true }
    fun documentChanged() { revoke(); engine.pause() }
    private fun revoke() = synchronized(lock) {
        generation++; tickets.values.forEach { it.cancelled = true }; tickets.clear(); lease?.cancelled = true; lease = null
    }
    fun pause() { foreground = false; revoke(); engine.revokeAuthority(); engine.pause() }
    fun stop() { pause(); executor?.shutdownNow(); executor = null }
    fun close() { closed = true; stop(); engine.destroy(); WebViewCompat.removeWebMessageListener(webView, BRIDGE) }
    private fun JSONObject.only(vararg names: String) = length() == names.size && keys().asSequence().all { it in names }
    private fun failure(id: String, code: String) = JSONObject().put("id", id).put("error", code).toString()
    companion object {
        private const val BRIDGE = "NativeIdentityCamera"
        private val ERRORS = setOf("identity_camera_invalid", "identity_camera_busy", "identity_camera_unavailable", "identity_camera_cancelled",
            "identity_camera_timeout", "identity_camera_store_full", "identity_camera_record_invalid")
    }
}
