// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Production lifecycle adapter with fake monotonic time, OS callbacks and main-thread queue. */
private class WarmupFixture {
    data class Listener(val fix: () -> Unit, val unavailable: () -> Unit, var removed: Boolean = false)
    var now = 1_000_000L
    var blocked: String? = null
    var registrationFails = false
    var unavailableDuringRegistration = false
    var passed = 0
    val queued = ArrayDeque<() -> Unit>()
    val notices = mutableListOf<String>()
    val listeners = mutableListOf<Listener>()
    val timers = mutableMapOf<Int, Pair<Long, () -> Unit>>()
    private var timerId = 0
    val warmup = NativeGpsWarmup(
        postToMain = { queued.add(it) },
        readiness = { blocked },
        startListening = { fix, unavailable ->
            check(!registrationFails) { "Registration unavailable" }
            val listener = Listener(fix, unavailable)
            listeners.add(listener)
            if (unavailableDuringRegistration) unavailable()
            val cancel: () -> Unit = { check(!listener.removed); listener.removed = true }
            cancel
        },
        notifyState = { notices.add(it) },
        elapsedMs = { now },
        schedule = { delay, action ->
            check(delay in 1..1_000L)
            val id = ++timerId
            timers[id] = (now + delay) to action
            val cancel: () -> Unit = { timers.remove(id) }
            cancel
        }
    )
    fun start() { warmup.resume(); warmup.pageFinished() }
    fun drain() { while (queued.isNotEmpty()) queued.removeFirst().invoke() }
    fun advance(ms: Long) {
        now += ms
        val due = timers.filterValues { it.first <= now }.toMap()
        for ((id, entry) in due) { timers.remove(id); entry.second() }
    }
    fun expect(active: Boolean, reason: String, remaining: Long = 0) {
        check(warmup.state() == "{\"version\":1,\"unsigned\":true,\"active\":$active,\"remaining_ms\":$remaining,\"reason\":\"$reason\"}") { warmup.state() }
        check(listeners.count { !it.removed } == if (active) 1 else 0)
        check(timers.size == if (active) 1 else 0)
        passed++
    }
    fun checkValue(value: Boolean) { check(value); passed++ }
}

fun main() {
    var passed = 0
    fun scenario(block: WarmupFixture.() -> Unit) {
        val fixture = WarmupFixture()
        fixture.block()
        fixture.warmup.destroy()
        fixture.checkValue(fixture.listeners.all { it.removed } && fixture.timers.isEmpty())
        passed += fixture.passed
    }

    scenario {
        expect(false, "inactive")
        warmup.resume()
        expect(false, "page-loading")
        warmup.pageFinished()
        expect(true, "active", 300_000)
        advance(15_000)
        val noticeCount = notices.size
        repeat(10) { listeners.single().fix() } // Cached/repeated fixes carry no data and never renew.
        expect(true, "active", 285_000)
        checkValue(notices.size == noticeCount + 10)
        checkValue(listeners.size == 1)
        warmup.resume(); warmup.pageFinished()
        expect(true, "active", 285_000)
        advance(284_999)
        expect(true, "active", 1)
        advance(1)
        expect(false, "expired")
        val snapshot = warmup.state()
        repeat(3) { warmup.state(); warmup.pageFinished(); warmup.resume(); listeners.single().fix() }
        checkValue(warmup.state() == snapshot && listeners.size == 1)
    }

    scenario {
        start(); advance(10_000)
        val oldListener = listeners.single()
        val oldTimer = timers.values.single().second
        warmup.pageStarted()
        expect(false, "page-loading")
        advance(10_000)
        warmup.pageFinished()
        expect(true, "active", 280_000) // Eligible navigation resumes only the remaining lease.
        oldListener.fix(); oldListener.unavailable(); oldTimer()
        expect(true, "active", 280_000)
        checkValue(listeners.size == 2)
        warmup.pageStarted(); blocked = "page-unavailable"; warmup.pageFinished()
        expect(false, "page-unavailable")
        blocked = null; warmup.pageStarted(); warmup.pageFinished()
        checkValue(listeners.size == 2 && timers.isEmpty())
        warmup.prepare(); drain()
        expect(true, "active", 300_000)
    }

    scenario {
        start()
        warmup.stop()
        expect(true, "active", 300_000) // Bridge writes must wait for the Activity thread.
        drain()
        expect(false, "stopped")
        warmup.pageFinished(); warmup.resume(); listeners.single().fix()
        expect(false, "stopped")
        warmup.pageStarted(); warmup.pageFinished()
        checkValue(listeners.size == 1 && timers.isEmpty())
        warmup.prepare(); drain()
        expect(true, "active", 300_000)
        advance(1234)
        val oldTimer = timers.values.single().second
        warmup.prepareForRequest()
        expect(true, "active", 300_000)
        oldTimer()
        expect(true, "active", 300_000)
        checkValue(listeners.size == 2) // Actual request renews the existing receiver registration.
    }

    scenario {
        start(); warmup.stop(); drain()
        warmup.prepare(); warmup.pageStarted(); warmup.pageFinished(); drain()
        checkValue(listeners.size == 1 && timers.isEmpty()) // Old page cannot start GPS late.
        warmup.prepare(); warmup.pause(); drain()
        expect(false, "background")
        warmup.resume()
        expect(true, "active", 300_000)
        warmup.stop(); warmup.pause(); warmup.resume(); drain()
        expect(true, "active", 300_000) // Old-page queued stop cannot cancel a new foreground lease.
    }

    for (reason in listOf("permission-required", "provider-unavailable", "page-unavailable")) scenario {
        blocked = reason; start()
        expect(false, reason)
        warmup.prepare(); drain()
        expect(false, reason)
        checkValue(listeners.isEmpty())
        blocked = null; warmup.prepare(); drain()
        expect(true, "active", 300_000)
        blocked = reason; advance(1_000) // Permission/provider polling also works without GPS callbacks.
        expect(false, reason)
        blocked = null; warmup.pageFinished()
        expect(false, reason) // Granting permission or enabling GPS alone does not revive an ended lease.
    }

    scenario {
        start()
        val oldListener = listeners.single()
        val oldTimer = timers.values.single().second
        oldListener.unavailable()
        expect(false, "provider-unavailable")
        warmup.prepareForRequest()
        oldListener.fix(); oldListener.unavailable(); oldTimer()
        expect(true, "active", 300_000)
        warmup.pause()
        expect(false, "background")
        warmup.prepare(); drain()
        expect(false, "background")
        warmup.resume()
        expect(true, "active", 300_000)
        warmup.prepare(); warmup.destroy(); drain()
        expect(false, "destroyed")
        warmup.resume(); warmup.pageFinished(); warmup.prepareForRequest()
        listeners.forEach { it.fix(); it.unavailable() }
        expect(false, "destroyed")
    }

    scenario {
        registrationFails = true; start()
        expect(false, "unavailable")
        registrationFails = false; warmup.pageFinished()
        expect(false, "unavailable")
        warmup.prepareForRequest()
        expect(true, "active", 300_000)
    }

    scenario {
        unavailableDuringRegistration = true; start()
        expect(false, "provider-unavailable")
        checkValue(listeners.single().removed) // A synchronous callback still removes the returned registration.
    }

    for (invalidNow in listOf(-1L, Long.MAX_VALUE, Long.MAX_VALUE - 299_999L)) scenario {
        now = invalidNow; start()
        expect(false, "clock-invalid")
        checkValue(listeners.isEmpty())
    }

    scenario {
        start(); advance(1_000)
        now -= 1
        listeners.single().fix()
        expect(false, "clock-invalid")
        warmup.prepareForRequest()
        expect(false, "clock-invalid")
    }

    println("Native GPS warm-up lifecycle: $passed checks passed (fake receiver/clock; no hardware or evidence claim)")
}
