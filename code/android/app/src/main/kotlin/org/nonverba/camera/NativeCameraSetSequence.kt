// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Ordered handoff: both close confirmations are required, and advance happens once.
 * The controller owns authority, locks, resource cleanup and actual camera operations.
 */
internal class NativeCameraSetSequence(private val count: Int) {
    init { require(count in 2..4) }
    var index = 0
        private set
    private var waiting = false
    private var cancelled = false
    fun memberAcquired(member: Int) {
        check(!cancelled && member == index && !waiting)
        waiting = true
    }
    fun advanceIfReleased(member: Int, deviceClosed: Boolean, sessionClosed: Boolean): Int? {
        if (cancelled || !waiting || member != index || !deviceClosed || !sessionClosed) return null
        waiting = false
        index++
        return index.takeIf { it < count }
    }
    fun cancel() { cancelled = true }
}
