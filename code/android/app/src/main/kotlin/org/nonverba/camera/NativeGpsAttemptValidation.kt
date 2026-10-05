// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Debug-only, one-shot reporting faults. This class never creates collector observations. */
internal class NativeGpsAttemptValidation(private val enabled: Boolean) {
    private var armedMode: String? = null
    @Synchronized fun mode(): String? = armedMode
    @Synchronized fun arm(mode: String, foreground: Boolean, active: Boolean) {
        check(enabled) { "Attempt validation requires a debug build" }
        check(foreground) { "Attempt validation requires the foreground bundled application" }
        check(!active) { "A location session is already active" }
        require(mode == "clear" || mode in MODES) { "Unknown attempt validation fault" }
        armedMode = mode.takeUnless { it == "clear" }
    }
    @Synchronized fun take(): Fault? = armedMode?.let { mode ->
        armedMode = null
        Fault(mode)
    }
    @Synchronized fun clear() { armedMode = null }

    class Fault(val mode: String) {
        private var writes = 0
        private var used = false
        val message get() = "SIMULATED validation fault: $mode (report finalization only)"
        @Synchronized fun triggered(): Boolean = used
        @Synchronized fun failStorageWrite(): Boolean {
            writes++
            val fail = !used && (mode == "initial-storage" && writes == 1 || mode == "final-storage" && writes == 2)
            if (fail) used = true
            return fail
        }
        /** Actual Keystore signing has finished; the signature is discarded before JNI receives it. */
        @Synchronized fun afterKeystoreSigning() {
            if (!used && mode == "signing") {
                used = true
                error("$message; signature discarded after Android Keystore signing")
            }
        }
    }
    companion object { val MODES = setOf("signing", "initial-storage", "final-storage") }
}

/** Initial durability is a precondition for signing; a failed final write never becomes durable. */
internal object NativeGpsAttemptFinalization {
    fun run(writePending: () -> Unit, sign: () -> Unit, writeFinal: () -> Unit,
        initialStorageFailed: (Throwable) -> Unit, signingFailed: (Throwable) -> Unit,
        finalStorageFailed: (Throwable) -> Unit, durable: () -> Unit) {
        try { writePending() } catch (error: Throwable) { initialStorageFailed(error); return }
        try { sign() } catch (error: Throwable) { signingFailed(error) }
        try { writeFinal() } catch (error: Throwable) { finalStorageFailed(error); return }
        durable()
    }
}
