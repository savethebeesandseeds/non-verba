// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Independent lifecycle releases; authority revocation must precede OS cleanup. */
internal object NativeLifecycleCleanup {
    data class Action(val label: String, val run: () -> Unit)
    data class Failure(val label: String, val error: Throwable)

    fun run(actions: List<Action>, report: (Failure) -> Unit = {}): List<Failure> {
        val failures = mutableListOf<Failure>()
        actions.forEach { action ->
            try { action.run() }
            catch (error: Throwable) {
                val failure = Failure(action.label, error)
                failures.add(failure)
                // Diagnostic delivery cannot prevent another release.
                try { report(failure) } catch (_: Throwable) { }
            }
        }
        return failures
    }

    fun lifecycle(revoke: List<Action>, release: List<Action>, complete: () -> Unit,
        report: (Failure) -> Unit = {}): List<Failure> {
        val failures = mutableListOf<Failure>()
        try {
            failures.addAll(run(revoke, report))
            failures.addAll(run(release, report))
        } finally { complete() }
        return failures
    }

    /** Forget ownership only after the OS confirms release; a later call retries failure. */
    fun <T : Any> release(label: String, retained: () -> T?, close: (T) -> Unit,
        forget: () -> Unit): Action = Action(label) {
        retained()?.let { value -> close(value); forget() }
    }
}
