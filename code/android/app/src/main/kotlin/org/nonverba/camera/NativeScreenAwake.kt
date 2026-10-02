// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import android.webkit.JavascriptInterface
import kotlin.math.abs

/** Explicit, bounded convenience lease; never changes sensor or Android lock authority. */
internal class NativeScreenAwake(
    private val postToMain: (() -> Unit) -> Unit,
    private val hasForegroundAppDocument: () -> Boolean,
    private val applyWindowFlag: (Boolean) -> Unit,
    private val notifyState: (String) -> Unit,
    private val clock: () -> Clock,
    private val loadLease: () -> Lease?,
    private val saveLease: (Lease?) -> Unit,
    private val schedule: (Long, () -> Unit) -> (() -> Unit)
) {
    data class Clock(val wallMs: Long, val elapsedMs: Long, val boot: Int)
    data class Lease(val wallMs: Long, val elapsedMs: Long, val boot: Int)
    // Mutations run on the Activity thread; JavaBridge reads only this immutable snapshot.
    private var lease = loadLease()
    private var paused = true
    private var destroyed = false
    private var cancelTimer: (() -> Unit)? = null
    @Volatile private var snapshot = stateJson(false, false, null, 0)

    @JavascriptInterface
    fun state(): String = snapshot

    @JavascriptInterface
    fun setEnabled(value: Boolean) {
        postToMain {
            if (!destroyed) {
                val now = clock()
                val prior = lease
                if (remaining(now) <= 0) lease = null
                if (!value) lease = null
                else if (lease == null && !paused && hasForegroundAppDocument() &&
                    now.wallMs in 0..Long.MAX_VALUE - DURATION_MS &&
                    now.elapsedMs in 0..Long.MAX_VALUE - DURATION_MS && now.boot >= 0) {
                    lease = Lease(now.wallMs, now.elapsedMs, now.boot)
                }
                if (lease != prior) saveLease(lease)
                refresh()
            }
        }
    }

    fun resume() {
        if (destroyed) return
        paused = false
        refresh()
    }

    fun pause() {
        paused = true
        refresh()
    }

    fun destroy() {
        destroyed = true
        paused = true
        refresh() // Preserve the unexpired opt-in lease for the next Activity.
    }

    private fun remaining(now: Clock): Long {
        val saved = lease ?: return 0
        if (saved.wallMs !in 0..Long.MAX_VALUE - DURATION_MS ||
            saved.elapsedMs !in 0..Long.MAX_VALUE - DURATION_MS || saved.boot < 0 ||
            now.boot != saved.boot || now.wallMs < saved.wallMs || now.elapsedMs < saved.elapsedMs) return 0
        val wallAge = now.wallMs - saved.wallMs
        val elapsedAge = now.elapsedMs - saved.elapsedMs
        // A rollback between process starts must not renew this opt-in interval.
        if (abs(wallAge - elapsedAge) > 1_000L) return 0
        return DURATION_MS - maxOf(wallAge, elapsedAge)
    }

    private fun refresh() {
        cancelTimer?.invoke()
        cancelTimer = null
        val left = remaining(clock())
        if (left <= 0 && lease != null) {
            lease = null
            saveLease(null)
        }
        val enabled = lease != null && !destroyed
        val active = enabled && !paused && hasForegroundAppDocument()
        applyWindowFlag(active)
        snapshot = stateJson(enabled, active, if (enabled) lease!!.wallMs + DURATION_MS else null, if (enabled) left else 0)
        notifyState(snapshot)
        // Handler callbacks do not wake or unlock the phone. Paused Activities
        // hold no window flag and validate the lease again when resumed.
        if (enabled && !paused) cancelTimer = schedule(minOf(left, 60_000L)) { refresh() }
    }

    private companion object {
        const val DURATION_MS = 2 * 60 * 60 * 1_000L
        fun stateJson(enabled: Boolean, active: Boolean, expires: Long?, remaining: Long) =
            "{\"version\":1,\"enabled\":$enabled,\"active\":$active,\"expires_at_ms\":$expires,\"remaining_ms\":$remaining}"
    }
}
