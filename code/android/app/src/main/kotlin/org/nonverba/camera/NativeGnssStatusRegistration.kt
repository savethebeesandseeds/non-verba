// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Optional observation registration; failed releases retain ownership without reactivation. */
internal class NativeGnssStatusRegistration<T : Any>(
    private val diagnostics: NativeGnssStatusDiagnostics,
    private val unregister: (T) -> Unit
) {
    private var callback: T? = null
    var active = false; private set
    val pendingCleanup: Boolean get() = callback != null

    fun start(listener: T, register: (T) -> Boolean) {
        if (callback != null || !diagnostics.registrationAttempt()) return
        callback = listener
        active = true
        val registered = try { register(listener) }
        catch (_: Throwable) {
            diagnostics.registrationException()
            // Status observation is optional. Retain failed cleanup for the owning
            // session's later stop; registration failure must not refuse GPS proof.
            runCatching { stop() }
            return
        }
        diagnostics.registrationResult(registered)
        if (!registered) runCatching { stop() }
    }

    fun stop() {
        active = false
        diagnostics.stop()
        try {
            NativeLifecycleCleanup.release("GNSS status callback", { callback }, unregister,
                { callback = null }).run()
        } catch (error: Throwable) {
            diagnostics.cleanupFailure()
            throw error // Outer cleanup must keep this collector until unregister succeeds.
        }
    }
}
