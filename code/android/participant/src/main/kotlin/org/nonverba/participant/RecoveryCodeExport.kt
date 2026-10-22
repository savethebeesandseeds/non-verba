// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.participant

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import org.json.JSONObject
import java.io.OutputStream
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** Explicit save picker for a validated recovery-code text file, never an arbitrary file bridge. */
internal class RecoveryCodeExport(
    private val activity: Activity,
    private val webView: WebView,
    private val documentUrl: String,
    private val foregroundDocument: () -> Boolean
) {
    private class Pending(
        val ticket: RecoveryExportSession.Ticket,
        val requestCode: Int,
        val generation: Int,
        val reply: JavaScriptReplyProxy,
        var picker: Boolean = true,
        var selected: Uri? = null
    ) {
        val output = AtomicReference<OutputStream?>()
    }
    private val session = RecoveryExportSession(SystemClock::elapsedRealtime)
    private val handler = Handler(Looper.getMainLooper())
    private val executor = ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
        ArrayBlockingQueue(1), ThreadPoolExecutor.AbortPolicy())
    private val cleanup = ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
        ArrayBlockingQueue(1), ThreadPoolExecutor.AbortPolicy())
    private val closePending = AtomicBoolean(false)
    @Volatile private var pending: Pending? = null
    @Volatile private var foreground = false
    @Volatile private var closed = false
    private var documentGeneration = 0
    private var nextRequestCode = REQUEST_FIRST
    private val expiry = Runnable { pending?.let { finish(it, "cancelled") } }

    init {
        WebViewCompat.addWebMessageListener(webView, BRIDGE, setOf(ORIGIN)) {
                view, message, sourceOrigin, isMainFrame, reply ->
            if (closed || !isMainFrame ||
                sourceOrigin.toString() != ORIGIN || view.url != documentUrl) return@addWebMessageListener
            val text = try { message.data } catch (_: Exception) { null } ?: return@addWebMessageListener
            if (text.toByteArray(Charsets.UTF_8).size > RecoveryExportSession.REQUEST_LIMIT) return@addWebMessageListener
            val request = try { JSONObject(text) } catch (_: Exception) { return@addWebMessageListener }
            val id = request.opt("id") as? String ?: return@addWebMessageListener
            if (!RecoveryExportSession.UUID.matches(id)) return@addWebMessageListener
            if (request.only("id", "cancel") && request.opt("cancel") == true) {
                // Cancellation revokes authority and remains available while
                // the owned picker has paused the initiating document.
                pending?.takeIf { it.ticket.id == id }?.let { finish(it, "cancelled") }
                return@addWebMessageListener
            }
            if (!foreground || !foregroundDocument()) {
                reply.postMessage(result(id, "failed"))
                return@addWebMessageListener
            }
            if (!request.only("id", "content") || request.opt("content") !is String ||
                nextRequestCode > REQUEST_LAST || pending != null || closePending.get()) {
                reply.postMessage(result(id, "failed"))
                return@addWebMessageListener
            }
            val ticket = try { session.begin(id, request.getString("content")) }
            catch (_: Exception) { reply.postMessage(result(id, "failed")); return@addWebMessageListener }
            val requestCode = nextRequestCode++
            val operation = Pending(ticket, requestCode, documentGeneration, reply)
            pending = operation
            handler.postDelayed(expiry, RecoveryExportSession.LIFETIME_MS)
            try {
                @Suppress("DEPRECATION")
                activity.startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TITLE, RecoveryExportSession.FILENAME)
                    addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                }, requestCode)
            } catch (_: Exception) { finish(operation, "failed") }
        }
    }

    fun resume() {
        if (closed) return
        foreground = true
        val operation = pending ?: return
        if (!foregroundDocument() || !session.active(operation.ticket)) finish(operation, "cancelled")
        else if (operation.selected != null) write(operation)
    }

    fun pause() {
        foreground = false
        // The owned system picker itself pauses/stops the Activity. Only that
        // bounded round trip may retain its bytes; background writes are cancelled.
        pending?.takeIf { !it.picker }?.let { finish(it, "cancelled") }
    }

    fun stop() = pause()

    fun documentChanged() {
        documentGeneration++
        pending?.let { finish(it, "cancelled", notify = false) }
        session.revoke()
    }

    fun activityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        if (requestCode !in REQUEST_FIRST..REQUEST_LAST) return false
        val operation = pending?.takeIf { it.requestCode == requestCode } ?: return true
        val uri = data?.data
        if (resultCode != Activity.RESULT_OK || uri?.scheme != "content" ||
            !session.active(operation.ticket) || operation.generation != documentGeneration || webView.url != documentUrl) {
            finish(operation, if (resultCode == Activity.RESULT_CANCELED) "cancelled" else "failed")
            return true
        }
        operation.selected = uri
        // Android normally delivers this result before onResume. Do not write
        // until the initiating bundled document is foreground again.
        if (foreground && foregroundDocument()) write(operation)
        return true
    }

    fun close() {
        closed = true
        documentChanged()
        handler.removeCallbacks(expiry)
        executor.shutdownNow()
        // Existing cleanup may be blocked in a provider. It owns no plaintext
        // and must not delay Activity teardown or be moved back to the UI thread.
        cleanup.shutdown()
        WebViewCompat.removeWebMessageListener(webView, BRIDGE)
    }

    private fun write(operation: Pending) {
        if (pending !== operation || !operation.picker || !foreground || !foregroundDocument()) return
        val uri = operation.selected ?: return
        operation.picker = false
        val active = { !closed && foreground && pending === operation && session.active(operation.ticket) }
        try {
            executor.execute {
                var bytes: ByteArray? = null
                var saved = false
                try {
                    check(active())
                    val destination = activity.contentResolver.openOutputStream(uri, "wt") ?: error("No output stream")
                    operation.output.set(destination)
                    check(active())
                    // A provider may block while opening. Allocate the one
                    // tracked worker copy only after that wait and a fresh lease check.
                    val content = session.copyBytes(operation.ticket) ?: error("Export expired")
                    bytes = content
                    check(active())
                    destination.write(content)
                    session.releaseBytes(operation.ticket, content)
                    bytes = null
                    check(active())
                    destination.flush()
                    check(active())
                    saved = true
                } catch (_: Exception) { /* Failure never reports a completed save. */ }
                finally {
                    bytes?.let { session.releaseBytes(operation.ticket, it) }
                    // Clear our byte copy before provider close, which can also
                    // block. Cancellation may already own that stream's close.
                    val owned = operation.output.getAndSet(null)
                    if (owned == null) saved = false
                    else try { owned.close() } catch (_: Exception) { saved = false }
                }
                activity.runOnUiThread {
                    if (pending === operation) finish(operation,
                        if (saved && active() && foregroundDocument()) "saved" else "failed")
                }
            }
        } catch (_: RejectedExecutionException) { finish(operation, "failed") }
    }

    private fun finish(operation: Pending, status: String, notify: Boolean = true) {
        if (pending !== operation) return
        pending = null
        handler.removeCallbacks(expiry)
        // Revoke and zero both buffers before any potentially blocking provider
        // cleanup. A stalled provider cannot extend the plaintext lease.
        session.finish(operation.ticket)
        operation.output.getAndSet(null)?.let(::closeLater)
        if (notify && !closed && operation.generation == documentGeneration &&
            webView.url == documentUrl && !activity.isFinishing) {
            try { operation.reply.postMessage(result(operation.ticket.id, status)) } catch (_: Exception) { }
        }
    }

    private fun closeLater(stream: OutputStream) {
        closePending.set(true)
        val completion = closePending
        // Only one operation is accepted while a stream is owned. Keep both
        // cleanup work and retry admission bounded if a provider stalls close.
        cleanup.execute {
            try { stream.close() } catch (_: Exception) { }
            finally { completion.set(false) }
        }
    }

    private fun JSONObject.only(vararg names: String) = length() == names.size && keys().asSequence().all { it in names }
    private fun result(id: String, status: String) = JSONObject().put("id", id).put("status", status).toString()

    companion object {
        private const val BRIDGE = "nonverbaRecoveryExport"
        private const val ORIGIN = "https://appassets.androidplatform.net"
        private const val REQUEST_FIRST = 0x5100
        private const val REQUEST_LAST = 0x5fff
    }
}
