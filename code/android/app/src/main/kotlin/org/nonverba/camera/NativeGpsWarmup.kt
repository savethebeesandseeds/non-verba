// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import android.webkit.JavascriptInterface

/** Foreground GPS power lease only. Every fix is discarded; no evidence or signing state is shared. */
internal class NativeGpsWarmup(
    private val postToMain: (() -> Unit) -> Unit,
    private val readiness: () -> String?,
    private val startListening: (() -> Unit, () -> Unit) -> (() -> Unit),
    private val notifyState: (String) -> Unit,
    private val elapsedMs: () -> Long,
    private val schedule: (Long, () -> Unit) -> (() -> Unit)
) {
    // Lifecycle and listener mutations are confined to the Activity thread.
    private var paused = true
    private var pageReady = false
    private var destroyed = false
    private var autoAllowed = false
    private var leaseStarted: Long? = null
    private var lastElapsed = -1L
    private var listening = false
    private var listenerGeneration = 0L
    private var cancelListener: (() -> Unit)? = null
    private var timerGeneration = 0L
    private var cancelTimer: (() -> Unit)? = null
    private var reason = "inactive"
    @Volatile private var lifecycleGeneration = 0L
    @Volatile private var snapshot = stateJson(false, 0, reason)

    @JavascriptInterface
    fun state(): String = snapshot

    @JavascriptInterface
    fun prepare() {
        val generation = lifecycleGeneration
        postToMain { if (generation == lifecycleGeneration) prepareForRequest() }
    }

    @JavascriptInterface
    fun stop() {
        val generation = lifecycleGeneration
        postToMain { if (!destroyed && generation == lifecycleGeneration) finish("stopped") }
    }

    /** Called only for actual GPS preparation/acquisition, never by a status poll. */
    fun prepareForRequest() {
        if (!destroyed) refresh(renew = true)
    }

    fun resume() {
        if (destroyed || !paused) return
        lifecycleGeneration++
        paused = false
        autoAllowed = true
        refresh()
    }

    fun pause() {
        lifecycleGeneration++
        paused = true
        finish(if (destroyed) "destroyed" else "background")
    }

    fun pageStarted() {
        lifecycleGeneration++
        pageReady = false
        detach()
        publish(false, 0, if (destroyed) "destroyed" else "page-loading")
    }

    fun pageFinished() {
        if (destroyed) return
        pageReady = true
        refresh()
    }

    fun destroy() {
        lifecycleGeneration++
        destroyed = true
        paused = true
        finish("destroyed")
    }

    private fun refresh(renew: Boolean = false) {
        if (destroyed) { finish("destroyed"); return }
        if (paused) { finish("background"); return }
        if (!pageReady) { detach(); publish(false, 0, "page-loading"); return }
        val unavailable = readiness()
        if (unavailable != null) { finish(unavailable); return }
        val now = elapsedMs()
        if (now < 0 || now < lastElapsed || now > Long.MAX_VALUE - DURATION_MS) {
            finish("clock-invalid"); return
        }
        lastElapsed = now
        if (renew || (leaseStarted == null && autoAllowed)) {
            leaseStarted = now
            autoAllowed = false
        }
        val started = leaseStarted
        if (started == null) { publish(false, 0, reason); return }
        val remaining = DURATION_MS - (now - started)
        if (remaining <= 0) { finish("expired"); return }
        if (!listening) {
            val generation = ++listenerGeneration
            listening = true
            try {
                val cancel = startListening(
                    // Callback timing and coordinates never renew the lease or enter evidence.
                    { if (listening && generation == listenerGeneration) refresh() },
                    { if (listening && generation == listenerGeneration) finish("provider-unavailable") }
                )
                // Also handles a synchronous failure callback during registration.
                if (listening && generation == listenerGeneration) cancelListener = cancel
                else { runCatching { cancel() }; return }
            } catch (_: Exception) {
                if (generation == listenerGeneration) finish("unavailable")
                return
            }
        }
        publish(true, remaining, "active")
        cancelTimer?.invoke()
        val generation = ++timerGeneration
        // Check revocation even when the receiver supplies no fixes. No wake lock or background service.
        cancelTimer = schedule(minOf(remaining, 1_000L)) {
            if (generation == timerGeneration && listening) refresh()
        }
    }

    private fun finish(nextReason: String) {
        leaseStarted = null
        autoAllowed = false
        detach()
        publish(false, 0, nextReason)
    }

    private fun detach() {
        listenerGeneration++
        listening = false
        val cancel = cancelListener
        cancelListener = null
        runCatching { cancel?.invoke() }
        timerGeneration++
        cancelTimer?.invoke()
        cancelTimer = null
    }

    private fun publish(active: Boolean, remaining: Long, nextReason: String) {
        reason = nextReason
        snapshot = stateJson(active, remaining, nextReason)
        notifyState(snapshot)
    }

    private companion object {
        const val DURATION_MS = 300_000L
        fun stateJson(active: Boolean, remaining: Long, reason: String) =
            "{\"version\":1,\"unsigned\":true,\"active\":$active,\"remaining_ms\":$remaining,\"reason\":\"$reason\"}"
    }
}
