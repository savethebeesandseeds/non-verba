// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Deterministic delayed callback queues; no Android, microphone or playback. */
fun main() {
    var passed = 0
    fun expect(value: Boolean, label: String) { check(value) { label }; passed++ }
    class Queues {
        var clock = 10_000_000L
        val observations = ArrayDeque<Runnable>()
        val completions = ArrayDeque<Runnable>()
        val deadlines = mutableListOf<Pair<Long, Runnable>>()
        var allowObservation = true; var allowCompletion = true; var allowTimeout = true
        fun advance(ms: Long) {
            clock += ms * 1_000_000
            val due = deadlines.filter { it.first <= clock }; deadlines.removeAll(due.toSet())
            due.forEach { completions.addLast(it.second) }
        }
        fun observed() { while (observations.isNotEmpty()) observations.removeFirst().run() }
        fun completed() { while (completions.isNotEmpty()) completions.removeFirst().run() }
        fun fence(health: () -> Unit = {}, done: (String?) -> Unit) = NativeAudioObservationFence(
            postObservation = { if (allowObservation) { observations.addLast(it); true } else false },
            postCompletion = { if (allowCompletion) { completions.addLast(it); true } else false },
            postTimeout = { task, delay -> if (allowTimeout) { deadlines.add(clock + delay * 1_000_000 to task); true } else false },
            removeTimeout = { task -> deadlines.removeAll { it.second === task } },
            requireHealthy = health, complete = done, nowNs = { clock }
        )
    }
    val clean = Queues(); var cleanCalls = 0
    val healthy = clean.fence { error -> expect(error == null, "clean fence must pass"); cleanCalls++ }
    healthy.start()
    expect(cleanCalls == 0, "signing result cannot publish before queued observations")
    clean.observed()
    expect(cleanCalls == 0, "publication remains on worker queue")
    clean.completed()
    expect(cleanCalls == 1 && clean.deadlines.isEmpty(), "clean fence completes exactly once")
    clean.advance(3000); clean.completed()
    expect(cleanCalls == 1, "cancelled timeout cannot duplicate success")

    val delayed = Queues()
    val format = NativeAudioRecordingGuard.Format(48000, 1, "pcm-f32")
    val config = NativeAudioRecordingGuard.Configuration(71, 4, true, false, 9, 9, format, format, emptyList(), emptyList())
    val guard = NativeAudioRecordingGuard(71, 4)
    guard.observe(listOf(config), 100); guard.observe(listOf(config), 300); guard.finish(150, 250)
    var monitorClosed = false; var published = false; var rejection: String? = null
    // Already queued when signing finishes; closing first would discard it.
    delayed.observations.addLast(Runnable {
        if (!monitorClosed) runCatching { guard.observe(listOf(config.copy(silenced = true)), 400) }
    })
    val failing = delayed.fence(guard::requireHealthy) { error ->
        rejection = error; published = error == null; monitorClosed = true
    }
    failing.start()
    expect(!monitorClosed && !published, "monitor stays open while bad callback is queued")
    delayed.completed()
    expect(!monitorClosed && !published, "empty worker queue cannot bypass delayed callback")
    delayed.observed(); delayed.completed()
    expect(monitorClosed && !published && rejection?.contains("silenced") == true, "queued silencing rejects after recording ended")

    val cancelled = Queues(); var cancelledCalls = 0
    val cancelEarly = cancelled.fence { cancelledCalls++ }
    cancelEarly.start(); cancelEarly.cancel(); cancelled.observed(); cancelled.completed()
    expect(cancelledCalls == 0 && cancelled.deadlines.isEmpty(), "cancel before observation revokes delivery")
    val cancelLate = cancelled.fence { cancelledCalls++ }
    cancelLate.start(); cancelled.observed(); cancelLate.cancel(); cancelled.completed()
    expect(cancelledCalls == 0, "cancel after barrier revokes worker delivery")

    val ownerChanged = Queues(); var currentOwner = true; var ownerPublished = false
    ownerChanged.fence { error -> if (currentOwner && error == null) ownerPublished = true }.start()
    ownerChanged.observed(); currentOwner = false; ownerChanged.completed()
    expect(!ownerPublished, "controller ownership is rechecked on delivery")

    val timeout = Queues(); val timedResults = mutableListOf<String?>()
    timeout.fence { timedResults.add(it) }.start()
    timeout.advance(2001); timeout.completed()
    expect(timedResults.size == 1 && timedResults.single()?.contains("deadline") == true, "held observation queue times out")
    timeout.observed(); timeout.completed()
    expect(timedResults.size == 1, "late barrier cannot revive timed-out result")

    val lateWorker = Queues(); var lateResult: String? = null
    lateWorker.fence { lateResult = it }.start(); lateWorker.observed()
    lateWorker.advance(2001); lateWorker.completed()
    expect(lateResult?.contains("deadline") == true, "late completion fails after timely barrier")

    val secondCheck = Queues(); var changed = false; var secondResult: String? = null
    secondCheck.fence({ check(!changed) { "late observed failure" } }) { secondResult = it }.start()
    secondCheck.observed(); changed = true; secondCheck.completed()
    expect(secondResult == "late observed failure", "health is rechecked before result delivery")

    for (which in listOf("observation", "timeout", "completion")) {
        val unavailable = Queues(); var calls = 0; var error: String? = null
        when (which) {
            "observation" -> unavailable.allowObservation = false
            "timeout" -> unavailable.allowTimeout = false
            "completion" -> unavailable.allowCompletion = false
        }
        unavailable.fence { result -> calls++; error = result }.start()
        unavailable.observed(); unavailable.completed(); unavailable.advance(3000); unavailable.completed()
        expect(calls == 1 && error != null, "rejected $which queue fails closed once")
    }
    val neverStarted = Queues(); var neverCalls = 0
    val preCancelled = neverStarted.fence { neverCalls++ }; preCancelled.cancel(); preCancelled.start()
    neverStarted.observed(); neverStarted.completed()
    expect(neverCalls == 0 && neverStarted.deadlines.isEmpty(), "pre-start cancellation schedules no work")
    println("Native microphone observation fence: $passed checks passed; silent deterministic queues")
}
