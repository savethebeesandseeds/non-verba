// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Production scheduling/cleanup policy with deterministic queues; no Android or audio. */
fun main() {
    var passed = 0
    fun expect(value: Boolean, label: String) { check(value) { label }; passed++ }
    class Queue {
        val tasks = mutableListOf<Runnable>()
        var accept = true
        var throwingPost = false
        var throwingRemove = false
        fun post(task: Runnable): Boolean {
            if (throwingPost) error("queue shutdown")
            if (accept) tasks.add(task)
            return accept
        }
        fun remove(task: Runnable) {
            tasks.removeAll { it === task }
            if (throwingRemove) error("remove failed")
        }
        fun run() { while (tasks.isNotEmpty()) tasks.removeAt(0).run() }
    }
    val main = Queue(); val worker = Queue()
    var clock = 1_000_000_000L; var owner = true; var state = "requesting-permission"
    val errors = mutableListOf<String>()
    lateinit var life: NativeAudioLifecycle
    life = NativeAudioLifecycle(clock, { owner && state in setOf("requesting-permission", "preparing", "sealing") },
        { error -> errors.add(error); state = "error"; life.close() }, { clock })
    expect(life.enqueue("permission setup", main::post, main::remove) { state = "preparing" }, "setup accepted")
    main.run()
    expect(state == "preparing" && errors.isEmpty(), "accepted setup runs once")

    life.enqueue("acquisition polling", worker::post, worker::remove) { error("capture rejected") }
    clock += 12_345_000_000L; worker.run()
    expect(state == "error" && errors == listOf("capture rejected"), "task exception becomes terminal failure")
    expect(life.elapsedMillis() == 12_345L && life.terminalElapsedMillis() == 12_345L, "terminal timing frozen")
    clock += 99_000_000_000L; life.close()
    expect(life.elapsedMillis() == 12_345L, "status and repeated cleanup cannot extend terminal timing")
    expect(!life.enqueue("late setup", main::post, main::remove) { state = "preparing" }, "terminal controller schedules no more work")

    for (label in listOf("permission setup", "finalization", "acquisition polling", "receipt timeout", "configuration failure", "session deadline")) {
        val rejected = Queue().apply { accept = false }; var failures = 0; var invoked = false
        lateinit var rejectedLife: NativeAudioLifecycle
        rejectedLife = NativeAudioLifecycle(clock, { true }, { failures++; rejectedLife.close() }, { clock })
        expect(!rejectedLife.enqueue(label, rejected::post, rejected::remove) { invoked = true }, "$label rejection reported")
        rejected.run()
        expect(failures == 1 && !invoked && rejectedLife.terminalElapsedMillis() == 0L, "$label rejection fails once without work")
    }
    val broken = Queue().apply { throwingPost = true }; var postError: String? = null
    val brokenLife = NativeAudioLifecycle(clock, { true }, { postError = it }, { clock })
    expect(!brokenLife.enqueue("deadline", broken::post, broken::remove) {}, "throwing post rejected")
    expect(postError?.contains("could not be scheduled") == true, "throwing post cannot leave silent pending work")

    val waitingMain = Queue(); val waitingWorker = Queue(); var signing = 0; var permission = 0; var timedOut = false
    lateinit var waiting: NativeAudioLifecycle
    waiting = NativeAudioLifecycle(clock, { true }, { timedOut = true; waiting.close() }, { clock })
    waiting.enqueue("permission callback", waitingWorker::post, waitingWorker::remove) { permission++ }
    waiting.enqueue("finalization", waitingWorker::post, waitingWorker::remove) { signing++ }
    val staleCallbacks = waitingWorker.tasks.toList()
    waiting.enqueue("session deadline", waitingMain::post, waitingMain::remove) { timedOut = true; waiting.close() }
    clock += 150_001_000_000L; waitingMain.run()
    expect(timedOut && waitingWorker.tasks.isEmpty(), "main deadline removes unanswered permission and blocked-worker work")
    staleCallbacks.forEach { it.run() }
    expect(permission == 0 && signing == 0, "already dequeued late callbacks cannot revive terminal controller")

    val cancelledQueue = Queue(); var late = 0; var cleanupFailures = 0
    val cancelled = NativeAudioLifecycle(clock, { true }, { cleanupFailures++ }, { clock })
    cancelled.enqueue("receipt timeout", cancelledQueue::post, cancelledQueue::remove) { late++ }
    val held = cancelledQueue.tasks.single()
    cancelledQueue.throwingRemove = true; cancelled.close(); held.run()
    expect(late == 0 && cleanupFailures == 0, "failed removal still revokes a queued task")
    expect(cancelledQueue.tasks.isEmpty(), "terminal removes tracked timer")

    val successorQueue = Queue(); var successorFailed = false; var successorWork = 0
    val successor = NativeAudioLifecycle(clock, { true }, { successorFailed = true }, { clock })
    successor.enqueue("retry", successorQueue::post, successorQueue::remove) { successorWork++ }
    held.run(); staleCallbacks.forEach { it.run() }; successorQueue.run()
    expect(!successorFailed && successorWork == 1, "predecessor timers cannot fail a fresh retry")
    val ownershipQueue = Queue(); var ownershipActions = 0; var owns = true
    val ownership = NativeAudioLifecycle(clock, { owns }, {}, { clock })
    ownership.enqueue("old owner", ownershipQueue::post, ownershipQueue::remove) { ownershipActions++ }
    owns = false; ownershipQueue.run()
    expect(ownershipActions == 0, "changed ownership prevents work")

    val anchorWall = 1_000_000L; val anchorNs = 5_000_000_000L
    fun remaining(elapsed: Long, expiry: Long = 2000) = NativeAudioLifecycle.deadlineDelayMillis(
        anchorWall, anchorNs, expiry, anchorWall + elapsed, anchorNs + elapsed * 1_000_000)
    expect(remaining(0) == 150_001L, "existing lifetime preserved at entry")
    expect(remaining(150_000) == 1L, "inclusive existing lifetime permits its exact boundary")
    expect(remaining(150_001) == 0L, "one millisecond beyond native lifetime expires")
    expect(remaining(500, 1001) == 500L, "original request expiry wins before native limit")
    expect(remaining(1000, 1001) == 0L, "original expiry remains exclusive")
    expect(runCatching { NativeAudioLifecycle.deadlineDelayMillis(anchorWall, anchorNs, 2000, anchorWall + 2000, anchorNs) }.isFailure,
        "wall discontinuity cannot extend deadline")

    var handle = 7; var focus: String? = "held"; var pcm: Any? = Any(); val chunks = arrayOfNulls<String>(15).apply { this[0] = "retained" }
    var pilot: String? = "pilot"; var monitorClosed = false
    fun closeHandle(fail: Boolean) { if (fail) error("native close failed"); handle = 0 }
    fun closeFocus(fail: Boolean) { if (fail) error("focus release failed"); focus = null }
    val teardown = NativeAudioLifecycle.cleanup(listOf(
        { monitorClosed = true },
        { closeHandle(true) },
        { closeFocus(true) }
    )) { pcm = null; chunks.fill(null); pilot = null }
    expect(monitorClosed && handle == 7 && focus == "held", "failed close retains cleanup handles honestly")
    expect(pcm == null && chunks.all { it == null } && pilot == null, "teardown exceptions cannot leave retained unsigned media")
    expect(teardown == listOf("native close failed", "focus release failed"), "all teardown failures preserved")
    val retried = NativeAudioLifecycle.cleanup(listOf({ closeHandle(false) }, { closeFocus(false) })) { pcm = null; chunks.fill(null); pilot = null }
    expect(retried.isEmpty() && handle == 0 && focus == null, "retained cleanup resources can be retried before a new session")

    var revocations = 0; var unregisterAttempts = 0; var callbackCalls = 0; var wiped = 0
    val callbackCleanup = NativeAudioCallbackCleanup(
        revoke = { revocations++ },
        unregister = { unregisterAttempts++; check(unregisterAttempts > 2) { "OS unregister failed" } }
    )
    var retainedMonitor: NativeAudioCallbackCleanup? = callbackCleanup
    fun queuedCallback() { if (!callbackCleanup.revoked) callbackCalls++ }
    fun releaseMonitor() = NativeAudioLifecycle.cleanup(listOf({ retainedMonitor?.close(); retainedMonitor = null })) { wiped++ }
    queuedCallback()
    expect(callbackCalls == 1, "active callback precedes revocation")
    expect(releaseMonitor() == listOf("OS unregister failed"), "first failed unregister reported")
    queuedCallback()
    expect(callbackCleanup.revoked && !callbackCleanup.unregistered && retainedMonitor != null && callbackCalls == 1,
        "unregister failure permanently revokes observations and retains cleanup ownership")
    expect(releaseMonitor() == listOf("OS unregister failed") && unregisterAttempts == 2 && revocations == 1,
        "second unregister failure retries OS cleanup without revoking twice")
    expect(retainedMonitor != null && wiped == 2, "unresolved monitor blocks replacement while unsigned media still wipes")
    expect(releaseMonitor().isEmpty() && retainedMonitor == null && callbackCleanup.unregistered && unregisterAttempts == 3,
        "successful unregister clears retained monitor only after OS cleanup succeeds")
    callbackCleanup.close(); queuedCallback()
    expect(revocations == 1 && unregisterAttempts == 3 && callbackCalls == 1, "completed cleanup stays revoked and does not unregister again")

    var revokeAttempts = 0; var revokeUnregisters = 0
    val revokeFailure = NativeAudioCallbackCleanup(
        revoke = { revokeAttempts++; error("fence cancellation failed") },
        unregister = { revokeUnregisters++ }
    )
    expect(runCatching { revokeFailure.close() }.isFailure && revokeFailure.revoked, "failed local revocation work still revokes authority")
    revokeFailure.close()
    expect(revokeAttempts == 1 && revokeUnregisters == 1 && revokeFailure.unregistered,
        "OS cleanup retry does not revive authority after revocation exception")

    data class Observation(val inputSessionId: Int, val observedNs: String, val phase: String,
        val format: MutableMap<String, String>)
    val observations = NativeAudioLastObservation<Observation> { value ->
        check(value.inputSessionId != 999) { "diagnostic copy failed" }
        value.copy(format = value.format.toMutableMap())
    }
    val pilotObservation = Observation(3161, "1234567890123", "pilot-recording",
        mutableMapOf("encoding" to "pcm-f32", "sample_rate" to "48000"))
    var liveObservation: Observation? = pilotObservation
    var pilotMonitorAttached = true; var pilotClosed = false; var pilotValidationInvoked = false
    var retentionClock = 1_000_000_000L; var retainedFailure: Observation? = null; var retainedMedia: Any? = Any()
    lateinit var retentionLife: NativeAudioLifecycle
    retentionLife = NativeAudioLifecycle(retentionClock, { true }, {
        retentionLife.close()
        // Same production policy as terminal diagnostics: a detached monitor
        // supplies null, which must not erase the pre-teardown observation.
        observations.remember(if (pilotMonitorAttached) liveObservation else null)
        retainedFailure = observations.snapshot()
        NativeAudioLifecycle.cleanup(emptyList()) { retainedMedia = null }
    }, { retentionClock })
    val pilotQueue = Queue()
    retentionLife.enqueue("pilot validation", pilotQueue::post, pilotQueue::remove) {
        observations.remember(liveObservation)
        pilotClosed = true; pilotMonitorAttached = false; liveObservation = null
        pilotValidationInvoked = true
        error("pilot challenge not detected")
    }
    retentionClock += 2_484_000_000L; pilotQueue.run()
    expect(pilotClosed && !pilotMonitorAttached && pilotValidationInvoked,
        "pilot validation runs after its collector has detached")
    expect(retainedFailure?.inputSessionId == 3161 && retainedFailure?.observedNs == "1234567890123" &&
        retainedFailure?.phase == "pilot-recording", "terminal failure retains original collector identity, time and stream phase")
    expect(retainedFailure?.format?.get("encoding") == "pcm-f32" && retainedMedia == null,
        "post-teardown failure retains bounded diagnostics while wiping media")
    expect(retentionLife.terminalElapsedMillis() == 2484L, "retained diagnostics do not extend the terminal lifetime")
    pilotObservation.format["encoding"] = "changed"
    expect(observations.snapshot()?.format?.get("encoding") == "pcm-f32",
        "later mutation of the collector observation cannot change its retained deep copy")
    retainedFailure?.format?.set("encoding", "changed by reader")
    expect(observations.snapshot()?.format?.get("encoding") == "pcm-f32",
        "terminal diagnostic readers cannot mutate the cached observation")
    observations.remember(null)
    expect(observations.snapshot()?.inputSessionId == 3161, "absent monitor does not clear last observation")
    val refusedCopy = pilotObservation.copy(inputSessionId = 999)
    expect(runCatching { observations.remember(refusedCopy) }.isFailure && observations.snapshot()?.inputSessionId == 3161,
        "failed diagnostic copy cannot destroy the last available observation")
    val successorObservations = NativeAudioLastObservation<Observation> { it.copy(format = it.format.toMutableMap()) }
    expect(successorObservations.snapshot() == null, "fresh native retry inherits no predecessor diagnostics")
    val successorObservation = Observation(3162, "1234567890999", "recording-opening", mutableMapOf("encoding" to "pcm-f32"))
    successorObservations.remember(successorObservation)
    expect(successorObservations.snapshot()?.inputSessionId == 3162 && observations.snapshot()?.inputSessionId == 3161,
        "successor observations cannot replace predecessor diagnostics")
    observations.remember(successorObservation)
    expect(observations.snapshot()?.phase == "recording-opening" && observations.snapshot()?.observedNs == "1234567890999",
        "a new observed stream replaces the old cache with its own phase and original timestamp")
    println("Native microphone lifecycle: $passed checks passed; silent deterministic queues and cleanup")
}
