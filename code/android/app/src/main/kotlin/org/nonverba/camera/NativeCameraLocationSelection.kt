// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** One native fix is chosen for exposure; later observations cannot replace it. */
internal class NativeCameraLocationSelection(val concurrent: Boolean) {
    var selectedSequence: Int? = null
        private set
    val mayFreeze: Boolean get() = !concurrent || selectedSequence != null

    /** False means keep collecting; invalid order is a caller error. */
    fun select(sequence: Int, elapsedMs: Long, fixElapsedMs: Long, wallMs: Long,
        fixTimestampMs: Long, maximumAgeMs: Long): Boolean {
        check(concurrent) { "This request does not authorize concurrent camera selection" }
        check(selectedSequence == null) { "A camera location fix was already selected" }
        check(sequence >= 0 && maximumAgeMs >= 0) { "Invalid native camera location selection" }
        val ageLimit = minOf(maximumAgeMs, 5_000L)
        if (fixElapsedMs <= 0 || elapsedMs < fixElapsedMs || elapsedMs - fixElapsedMs > ageLimit ||
            fixTimestampMs < 0 || wallMs < fixTimestampMs || wallMs - fixTimestampMs > ageLimit) return false
        selectedSequence = sequence
        return true
    }
}
