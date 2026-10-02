// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Fences queued app observations, never undelivered Android/HAL work. */
internal class NativeAudioObservationFence(
    private val postObservation: (Runnable) -> Boolean,
    private val postCompletion: (Runnable) -> Boolean,
    private val postTimeout: (Runnable, Long) -> Boolean,
    private val removeTimeout: (Runnable) -> Unit,
    private val requireHealthy: () -> Unit,
    private val complete: (String?) -> Unit,
    private val nowNs: () -> Long = System::nanoTime
) {
    private enum class Phase { PENDING, SCHEDULED, DELIVERED, CANCELLED }
    private val lock = Any()
    private var phase = Phase.PENDING
    private var started = false
    private var deadlineNs = 0L
    private val timeout = Runnable { settle(TIMEOUT) }
    private val observation = Runnable {
        if (pending()) {
            val failure = runCatching { requireHealthy() }.exceptionOrNull()
            settle(failure?.message ?: if (failure != null) "Microphone observation failed" else null)
        }
    }

    fun start() {
        synchronized(lock) {
            if (phase == Phase.CANCELLED) return
            check(!started) { "Microphone observation fence already started" }
            started = true
            deadlineNs = Math.addExact(nowNs(), TIMEOUT_MS * 1_000_000)
        }
        if (!postTimeout(timeout, TIMEOUT_MS)) {
            settle("Microphone observation timeout could not be scheduled")
            return
        }
        if (pending() && !postObservation(observation)) {
            settle("Microphone observation queue is unavailable")
        }
    }

    fun cancel() {
        synchronized(lock) {
            if (phase != Phase.DELIVERED) phase = Phase.CANCELLED
        }
        removeTimeout(timeout)
    }

    private fun pending() = synchronized(lock) { started && phase == Phase.PENDING }

    private fun settle(error: String?) {
        synchronized(lock) {
            if (!started || phase != Phase.PENDING) return
            phase = Phase.SCHEDULED
        }
        removeTimeout(timeout)
        val delivery = Runnable { deliver(error) }
        if (!postCompletion(delivery)) {
            // A rejected worker queue may deliver failure here, never success.
            deliver("Microphone completion queue is unavailable")
        }
    }

    private fun deliver(error: String?) {
        val expired = synchronized(lock) {
            if (phase != Phase.SCHEDULED) return
            phase = Phase.DELIVERED
            nowNs() > deadlineNs
        }
        val failure = runCatching { requireHealthy() }.exceptionOrNull()
        complete(if (expired) TIMEOUT else error ?: failure?.let { it.message ?: "Microphone observation failed" })
    }

    private companion object {
        const val TIMEOUT_MS = 2000L
        const val TIMEOUT = "Queued microphone observations did not settle before the deadline"
    }
}
