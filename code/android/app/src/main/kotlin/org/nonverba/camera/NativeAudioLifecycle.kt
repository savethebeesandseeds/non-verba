// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Tracked native-controller work and unsigned terminal timing; no Android or media. */
internal class NativeAudioLifecycle(
    private val startedNs: Long,
    private val active: () -> Boolean,
    private val failure: (String) -> Unit,
    private val nowNs: () -> Long = System::nanoTime
) {
    private class Work(val remove: (Runnable) -> Unit) { lateinit var runnable: Runnable }
    private val lock = Any()
    private val pending = mutableSetOf<Work>()
    private var terminalNs: Long? = null

    fun enqueue(label: String, post: (Runnable) -> Boolean, remove: (Runnable) -> Unit, action: () -> Unit): Boolean {
        val work = Work(remove)
        work.runnable = Runnable {
            val run = synchronized(lock) { terminalNs == null && pending.remove(work) }
            if (run && active()) {
                try { action() }
                catch (error: Throwable) { failure(error.message ?: "Native microphone $label failed") }
            }
        }
        synchronized(lock) {
            if (terminalNs != null) return false
            pending.add(work)
        }
        val accepted = try { post(work.runnable) } catch (_: Throwable) { false }
        if (!accepted) {
            val report = synchronized(lock) { terminalNs == null && pending.remove(work) }
            if (report && active()) failure("Native microphone $label could not be scheduled")
            return false
        }
        // Cancellation can race with posting after it removed the pending work.
        if (synchronized(lock) { terminalNs != null }) runCatching { remove(work.runnable) }
        return true
    }

    /** Freeze at the first terminal transition, before potentially slow teardown. */
    fun close() {
        val work = synchronized(lock) {
            if (terminalNs == null) terminalNs = nowNs()
            pending.toList().also { pending.clear() }
        }
        work.forEach { runCatching { it.remove(it.runnable) } }
    }

    fun elapsedMillis(): Long = synchronized(lock) { ((terminalNs ?: nowNs()) - startedNs).coerceAtLeast(0) / 1_000_000 }
    fun terminalElapsedMillis(): Long? = synchronized(lock) { terminalNs?.let { (it - startedNs).coerceAtLeast(0) / 1_000_000 } }

    companion object {
        const val MAX_LIFETIME_MS = 150_000L

        /** Preserve the existing inclusive lifetime and the original exclusive request expiry. */
        fun deadlineDelayMillis(anchorWallMs: Long, anchorNs: Long, expiresAtSecs: Long, wallMs: Long, monotonicNs: Long): Long {
            val elapsed = NativeSessionGuards.elapsedMillis(anchorWallMs, anchorNs, wallMs, monotonicNs)
            val requestRemaining = Math.subtractExact(Math.multiplyExact(expiresAtSecs, 1000L), wallMs)
            return minOf(MAX_LIFETIME_MS + 1 - elapsed, requestRemaining).coerceAtLeast(0)
        }

        /** One failed teardown must not skip other resources or retained-media wiping. */
        fun cleanup(actions: List<() -> Unit>, wipe: () -> Unit): List<String> {
            val failures = mutableListOf<String>()
            try {
                actions.forEach { action ->
                    try { action() } catch (error: Throwable) { failures.add((error.message ?: "Native microphone cleanup failed").take(400)) }
                }
            } finally { wipe() }
            return failures
        }
    }
}

/** Caller serializes access. Revocation is permanent; OS unregister may be retried. */
internal class NativeAudioCallbackCleanup(private val revoke: () -> Unit, private val unregister: () -> Unit) {
    var revoked = false; private set
    var unregistered = false; private set

    fun close() {
        if (!revoked) { revoked = true; revoke() }
        if (!unregistered) { unregister(); unregistered = true }
    }
}

/** Caller serializes access; detached collectors cannot erase the last unsigned observation. */
internal class NativeAudioLastObservation<T>(private val copy: (T) -> T) {
    private var retained: T? = null

    fun remember(observation: T?) {
        if (observation != null) retained = copy(observation)
    }

    fun snapshot(): T? = retained?.let(copy)
}
