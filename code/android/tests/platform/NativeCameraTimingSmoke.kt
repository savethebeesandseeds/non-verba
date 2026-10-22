// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Production camera clock decisions with deterministic clocks; no Android/sensor claim. */
fun main() {
    var passed = 0
    fun rejects(label: String, action: () -> Unit) {
        check(runCatching(action).isFailure) { "$label unexpectedly passed" }; passed++
    }
    val second = 1_900_000_000_000L
    val mono = 100_000_000_000L
    var clockMs = second + 990
    val calls = mutableListOf<String>()
    val anchor = NativeCameraTiming.anchor({ calls += "id"; clockMs += 6; "session" },
        { calls += "wall"; clockMs }, { calls += "elapsed"; mono + (clockMs - second) * 1_000_000 })
    check(calls == listOf("id", "wall", "elapsed")); passed++
    check(anchor.sessionId == "session" && anchor.wallMs == second + 996 && anchor.elapsedNs == mono + 996_000_000); passed++
    // Old ordering put six milliseconds of UUID work between these clocks and
    // mapped this actual next-second exposure back into the preceding second.
    val exposureNs = mono + 1_004_000_000
    val mapped = anchor.wallMs + (exposureNs - anchor.elapsedNs) / 1_000_000
    val oldMapped = second + 990 + (exposureNs - anchor.elapsedNs) / 1_000_000
    check(mapped == second + 1004 && oldMapped == second + 998); passed++

    fun delay(offsetMs: Long, fixOffsetMs: Long, wallOffsetMs: Long = offsetMs) =
        NativeCameraTiming.exposureDelayMs(second, mono, second + wallOffsetMs,
            mono + offsetMs * 1_000_000, second + fixOffsetMs)
    // Exact physical symptom: mapped clock at .994, selected fix in next second.
    check(delay(994, 1000) == 6L); passed++
    check(delay(999, 1000) == 1L); passed++
    check(delay(1000, 1000) == 0L); passed++
    check(delay(1001, 1000) == 0L); passed++
    check(delay(1000, 2000) == 1000L); passed++
    rejects("Future clock mismatch beyond retained native alignment") { delay(1000, 2001) }
    check(delay(6000, 1000) == 0L); passed++
    rejects("Delayed dispatch cannot use a fix older than five seconds") { delay(6001, 1000) }
    rejects("Backward monotonic clock") {
        NativeCameraTiming.exposureDelayMs(second, mono, second, mono - 1, second)
    }
    rejects("Wall jump cannot carry a deferred capture forward") { delay(1000, 1000, 2001) }
    rejects("Negative fix") { NativeCameraTiming.exposureDelayMs(second, mono, second, mono, -1) }
    rejects("Invalid anchor clock") { NativeCameraTiming.anchor({ "session" }, { -1 }, { mono }) }

    // The native deferred branch rechecks these existing gates at dispatch;
    // waiting never extends the request window or revives capture authority.
    NativeSessionGuards.requireRequestWindow(second + 999, second / 1000, second / 1000 + 1); passed++
    rejects("Expiry reached while deferring") {
        NativeSessionGuards.requireRequestWindow(second + 1000, second / 1000, second / 1000 + 1)
    }
    for ((name, flags) in listOf("foreground" to listOf(false, false, true, true),
        "destroyed" to listOf(true, true, true, true), "replacement session" to listOf(true, false, false, true),
        "permission" to listOf(true, false, true, false))) {
        rejects("Deferred $name loss") { NativeSessionGuards.requireAuthority(flags[0], flags[1], flags[2], flags[3]) }
    }
    println("Native camera timing: $passed checks passed (synthetic clocks, no device acquisition)")
}
