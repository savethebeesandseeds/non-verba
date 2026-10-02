// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Synthetic selection boundaries; these do not claim physical camera/GPS evidence. */
fun main() {
    var passed = 0
    fun expect(value: Boolean) { check(value); passed++ }
    fun rejects(action: () -> Unit) { expect(runCatching(action).isFailure) }
    val standalone = NativeCameraLocationSelection(false)
    expect(standalone.mayFreeze)
    rejects { standalone.select(0, 1000, 1000, 11000, 11000, 5000) }
    val concurrent = NativeCameraLocationSelection(true)
    expect(!concurrent.mayFreeze)
    expect(!concurrent.select(0, 6001, 1000, 16001, 11000, 5000))
    expect(concurrent.selectedSequence == null && !concurrent.mayFreeze)
    expect(concurrent.select(1, 6001, 6000, 16001, 16000, 5000))
    expect(concurrent.selectedSequence == 1 && concurrent.mayFreeze)
    rejects { concurrent.select(2, 7000, 7000, 17000, 17000, 5000) }
    expect(concurrent.selectedSequence == 1)
    // Both timestamps must be fresh. The camera's 5-second ceiling remains
    // even when a location policy allows older fixes; stricter requests win.
    for (policy in listOf(1L, 3000L, 5000L, 10000L)) {
        val limit = minOf(policy, 5000L)
        expect(NativeCameraLocationSelection(true).select(0, 1000 + limit, 1000, 11000 + limit, 11000, policy))
        expect(!NativeCameraLocationSelection(true).select(0, 1001 + limit, 1000, 11000 + limit, 11000, policy))
        expect(!NativeCameraLocationSelection(true).select(0, 1000 + limit, 1000, 11001 + limit, 11000, policy))
    }
    expect(!NativeCameraLocationSelection(true).select(0, 1000, 1001, 11000, 11000, 5000))
    expect(!NativeCameraLocationSelection(true).select(0, 1000, 1000, 11000, 11001, 5000))
    expect(!NativeCameraLocationSelection(true).select(0, 1000, 0, 11000, 11000, 5000))
    rejects { NativeCameraLocationSelection(true).select(-1, 1000, 1000, 11000, 11000, 5000) }
    rejects { NativeCameraLocationSelection(true).select(0, 1000, 1000, 11000, 11000, -1) }
    // Request expiry and clock authority are checked independently before selection.
    val expired = NativeCameraLocationSelection(true)
    rejects {
        NativeSessionGuards.requireRequestWindow(20000, 1, 20)
        expired.select(0, 1000, 1000, 20000, 20000, 5000)
    }
    expect(expired.selectedSequence == null)
    val skewed = NativeCameraLocationSelection(true)
    rejects {
        val elapsed = NativeSessionGuards.elapsedMillis(1000, 1000000, 4001, 1001000000)
        skewed.select(0, elapsed, 1000, 4001, 4001, 5000)
    }
    expect(skewed.selectedSequence == null)
    println("Native concurrent camera location selection: $passed checks passed (synthetic; no device evidence)")
}
