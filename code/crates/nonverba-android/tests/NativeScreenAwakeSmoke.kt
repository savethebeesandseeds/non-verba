// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Production helper with fake clocks/storage, queued bridge calls and window flags. */
fun main() {
    val queued = ArrayDeque<() -> Unit>()
    val notices = mutableListOf<String>()
    val timers = mutableMapOf<Int, Pair<Long, () -> Unit>>()
    var timerId = 0
    var wall = 1_800_000_000_000L
    var elapsed = 1_000_000L
    var boot = 7
    var stored: NativeScreenAwake.Lease? = null
    var foreground = true
    var windowFlag = false
    var passed = 0
    val duration = 7_200_000L
    fun controller() = NativeScreenAwake(
        { queued.add(it) }, { foreground }, { windowFlag = it }, { notices.add(it) },
        { NativeScreenAwake.Clock(wall, elapsed, boot) }, { stored }, { stored = it },
        { delay, action ->
            check(delay in 1..60_000L)
            val id = ++timerId
            timers[id] = (elapsed + delay) to action
            val cancel: () -> Unit = { timers.remove(id) }
            cancel
        }
    )
    fun expect(controller: NativeScreenAwake, enabled: Boolean, active: Boolean) {
        check(controller.state().contains("\"enabled\":$enabled,\"active\":$active,"))
        check(windowFlag == active)
        passed++
    }
    fun checkValue(value: Boolean) { check(value); passed++ }
    fun drain() { while (queued.isNotEmpty()) queued.removeFirst().invoke() }
    fun advance(ms: Long) {
        wall += ms; elapsed += ms
        val due = timers.filterValues { it.first <= elapsed }.toMap()
        for ((id, callback) in due) { timers.remove(id); callback.second() }
    }

    val awake = controller()
    expect(awake, false, false)
    awake.resume()
    awake.setEnabled(true)
    expect(awake, false, false) // JavaBridge cannot mutate a Window off the main thread.
    drain()
    expect(awake, true, true)
    val firstLease = stored
    checkValue(awake.state().contains("\"expires_at_ms\":" + (wall + duration)))
    checkValue(awake.state().contains("\"remaining_ms\":7200000"))
    val beforeRepeatedEnable = notices.size
    advance(1_000)
    awake.setEnabled(true)
    drain()
    checkValue(notices.size == beforeRepeatedEnable + 1)
    checkValue(stored == firstLease) // Duplicate On must not renew the interval.
    foreground = false
    awake.pause()
    expect(awake, true, false)
    checkValue(timers.isEmpty())
    awake.resume()
    expect(awake, true, false)
    foreground = true
    awake.resume()
    expect(awake, true, true)
    awake.setEnabled(false)
    drain()
    expect(awake, false, false)
    checkValue(stored == null && timers.isEmpty())

    awake.setEnabled(true)
    foreground = false
    awake.pause()
    drain()
    expect(awake, false, false)
    foreground = true
    awake.resume()
    expect(awake, false, false)
    awake.setEnabled(true); drain()
    awake.pause()
    awake.setEnabled(false); drain()
    expect(awake, false, false)

    awake.resume(); awake.setEnabled(true); drain()
    val savedBeforeRestart = stored
    expect(awake, true, true)
    awake.setEnabled(true)
    awake.destroy()
    expect(awake, false, false)
    checkValue(stored == savedBeforeRestart && timers.isEmpty())
    drain(); awake.resume()
    expect(awake, false, false)
    advance(30_000)
    val restarted = controller()
    expect(restarted, false, false) // No flag before main-thread resume.
    restarted.resume()
    expect(restarted, true, true) // Same boot restores the unexpired opt-in.
    checkValue(stored == savedBeforeRestart)
    advance(duration - 30_001)
    expect(restarted, true, true)
    advance(1)
    expect(restarted, false, false)
    checkValue(stored == null && timers.isEmpty())

    fun rejectRestored(lease: NativeScreenAwake.Lease) {
        stored = lease
        val invalid = controller()
        invalid.resume()
        expect(invalid, false, false)
        checkValue(stored == null && timers.isEmpty())
        invalid.destroy()
    }
    rejectRestored(NativeScreenAwake.Lease(wall - duration, elapsed - duration, boot))
    rejectRestored(NativeScreenAwake.Lease(wall, elapsed, boot - 1)) // Reboot.
    rejectRestored(NativeScreenAwake.Lease(wall + 1, elapsed, boot)) // Wall rollback.
    rejectRestored(NativeScreenAwake.Lease(wall, elapsed + 1, boot)) // Monotonic rollback.
    rejectRestored(NativeScreenAwake.Lease(wall - 30_000, elapsed - 60_000, boot)) // Rollback still after creation.
    rejectRestored(NativeScreenAwake.Lease(-1, elapsed, boot))
    rejectRestored(NativeScreenAwake.Lease(wall, -1, boot))
    rejectRestored(NativeScreenAwake.Lease(wall, elapsed, -1))
    rejectRestored(NativeScreenAwake.Lease(Long.MAX_VALUE, elapsed, boot))

    val pausedExpiry = controller()
    pausedExpiry.resume(); pausedExpiry.setEnabled(true); drain(); pausedExpiry.pause()
    advance(duration)
    pausedExpiry.resume()
    expect(pausedExpiry, false, false)
    checkValue(stored == null)
    pausedExpiry.setEnabled(true); drain()
    val priorTimer = timers.values.single().second
    pausedExpiry.setEnabled(false); drain()
    priorTimer() // A stale timer cannot resurrect an explicitly cleared lease.
    expect(pausedExpiry, false, false)
    checkValue(stored == null && timers.isEmpty())
    println("Native screen-awake lease/lifecycle: $passed checks passed (fake clocks/storage; no device claim)")
}
