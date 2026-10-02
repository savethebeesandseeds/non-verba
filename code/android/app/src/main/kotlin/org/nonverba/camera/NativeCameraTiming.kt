// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Camera scheduling against its existing wall/elapsed mapping; no sensor values change. */
internal object NativeCameraTiming {
    data class Anchor(val sessionId: String, val wallMs: Long, val elapsedNs: Long)

    fun anchor(newSessionId: () -> String, wallClock: () -> Long, elapsedClock: () -> Long): Anchor {
        // UUID generation may touch entropy/storage. It must not separate the clock
        // samples and bias every mapped exposure backwards by its runtime.
        val sessionId = newSessionId()
        val wallMs = wallClock()
        val elapsedNs = elapsedClock()
        check(wallMs >= 0 && elapsedNs >= 0) { "Native camera clock is invalid" }
        return Anchor(sessionId, wallMs, elapsedNs)
    }

    /** A future reported GPS wall time must precede the actual exposure, not gain tolerance. */
    fun exposureDelayMs(anchorWallMs: Long, anchorNs: Long, wallMs: Long, elapsedNs: Long,
        fixTimestampMs: Long): Long {
        check(fixTimestampMs >= 0) { "Native camera GPS timestamp is invalid" }
        val elapsedMs = NativeSessionGuards.elapsedMillis(anchorWallMs, anchorNs, wallMs, elapsedNs)
        val mappedNowMs = Math.addExact(anchorWallMs, elapsedMs)
        val leadMs = Math.subtractExact(fixTimestampMs, mappedNowMs)
        // Use only the existing native wall/elapsed alignment bound. A larger
        // disagreement is a failed clock relationship, never permission to wait it out.
        check(leadMs <= 1000) { "Native camera GPS exceeds the one-second clock alignment before exposure" }
        if (leadMs > 0) return leadMs
        val ageMs = Math.negateExact(leadMs)
        check(ageMs <= 5000) {
            "Native camera GPS must be within five seconds of acquisition (selected fix age before exposure: $ageMs ms; maximum: 5000 ms)"
        }
        return 0
    }
}
