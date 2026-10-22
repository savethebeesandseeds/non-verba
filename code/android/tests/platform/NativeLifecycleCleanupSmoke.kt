// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Failure injection against the production lifecycle/release runner; no Android or sensors. */
fun main() {
    var passed = 0
    fun expect(value: Boolean, label: String) { check(value) { label }; passed++ }
    val events = mutableListOf<String>()
    val authority = mutableMapOf("location" to true, "camera" to true, "audio" to true)
    val retained = mutableMapOf("location" to "registration", "camera" to "device", "audio" to "stream")
    val releaseAttempts = mutableMapOf<String, Int>()
    val failures = mutableListOf<NativeLifecycleCleanup.Failure>()
    var frameworkCalls = 0
    val releaseError = IllegalStateException("camera close unavailable")
    fun release(name: String) = NativeLifecycleCleanup.release(name, { retained[name] }, {
        expect(authority.values.none { it }, "all sensor authority is revoked before $name cleanup")
        events.add("release:$name")
        releaseAttempts[name] = (releaseAttempts[name] ?: 0) + 1
        if (name == "camera" && releaseAttempts[name] == 1) throw releaseError
    }, { retained.remove(name) })
    val releases = authority.keys.map(::release)
    val revoke = authority.keys.map { name -> NativeLifecycleCleanup.Action(name) {
        authority[name] = false; events.add("revoke:$name")
    } }
    val first = NativeLifecycleCleanup.lifecycle(revoke, releases,
        complete = { events.add("framework"); frameworkCalls++ }, report = failures::add)
    expect(events == listOf("revoke:location", "revoke:camera", "revoke:audio",
        "release:location", "release:camera", "release:audio", "framework"), "release failure cannot skip microphone or framework lifecycle")
    expect(first.size == 1 && first.single().error === releaseError && failures == first, "original cleanup error is retained")
    expect(retained == mapOf("camera" to "device"), "only the failed OS resource remains owned")
    expect(frameworkCalls == 1, "framework completion runs exactly once")

    val second = NativeLifecycleCleanup.lifecycle(revoke, releases,
        complete = { frameworkCalls++ }, report = failures::add)
    expect(second.isEmpty() && retained.isEmpty(), "later lifecycle retries the retained camera resource")
    expect(releaseAttempts == mapOf("location" to 1, "camera" to 2, "audio" to 1), "successfully released resources are not closed twice")
    expect(authority.values.none { it } && frameworkCalls == 2, "cleanup retry cannot renew sensor authority")
    NativeLifecycleCleanup.run(releases)
    expect(releaseAttempts == mapOf("location" to 1, "camera" to 2, "audio" to 1), "repeated cleanup is idempotent")

    for (failurePhase in listOf("revocation", "release", "reporting")) {
        val reached = mutableListOf<String>()
        val revokeFailure = IllegalStateException("revocation failure")
        val releaseFailure = IllegalStateException("release failure")
        val result = NativeLifecycleCleanup.lifecycle(listOf(
            NativeLifecycleCleanup.Action("first authority") {
                reached.add("first authority")
                if (failurePhase == "revocation") throw revokeFailure
            },
            NativeLifecycleCleanup.Action("second authority") { reached.add("second authority") }
        ), listOf(
            NativeLifecycleCleanup.Action("first resource") {
                reached.add("first resource")
                if (failurePhase != "revocation") throw releaseFailure
            },
            NativeLifecycleCleanup.Action("second resource") { reached.add("second resource") }
        ), complete = { reached.add("framework") }, report = {
            if (failurePhase == "reporting") error("diagnostic sink unavailable")
        })
        expect(reached == listOf("first authority", "second authority", "first resource", "second resource", "framework"),
            "$failurePhase failure does not abort independent actions")
        expect(result.size == 1 && result.single().error ===
            (if (failurePhase == "revocation") revokeFailure else releaseFailure), "$failurePhase error is preserved")
    }

    // Raw GNSS callbacks become inert before unregistering. Ownership survives
    // each failed OS call, while a stale callback cannot republish observations.
    var active = true
    var listener: (() -> Unit)? = { if (active) events.add("raw observation") }
    val stale = listener!!
    var unregisterCalls = 0
    val unregister = NativeLifecycleCleanup.release("raw GNSS registration", { listener }, {
        unregisterCalls++
        if (unregisterCalls <= 2) error("receiver unregister failed")
    }, { listener = null })
    for (attempt in 1..3) {
        active = false
        val cleanup = NativeLifecycleCleanup.run(listOf(unregister))
        stale()
        expect((listener != null) == (attempt < 3), "raw registration ownership survives failure $attempt")
        expect(cleanup.size == (if (attempt < 3) 1 else 0), "raw unregistration retry result $attempt")
        expect("raw observation" !in events && !active, "failed unregistration never revives raw collection $attempt")
    }
    NativeLifecycleCleanup.run(listOf(unregister))
    expect(unregisterCalls == 3, "released raw callback is not unregistered twice")

    for (startup in listOf("registered", "refused", "exception")) {
        val diagnostics = NativeGnssStatusDiagnostics()
        val listenerIdentity = Any()
        val unregisterError = IllegalStateException("status unregister unavailable")
        var attempts = 0
        val status = NativeGnssStatusRegistration<Any>(diagnostics) { observed ->
            expect(observed === listenerIdentity, "$startup status retries the original listener")
            attempts++
            if (attempts == 1) throw unregisterError
        }
        val startupError = runCatching {
            status.start(listenerIdentity) {
                when (startup) {
                    "registered" -> true
                    "refused" -> false
                    else -> error("optional status registration unavailable")
                }
            }
        }.exceptionOrNull()
        expect(startupError == null, "$startup optional status startup never refuses proof")
        if (startup == "registered") {
            expect(status.active && diagnostics.callback(10), "registered status admits its initial observation")
            val stopError = runCatching { status.stop() }.exceptionOrNull()
            expect(stopError === unregisterError, "status stop surfaces its original unregister failure")
        }
        val frozen = diagnostics.snapshot()
        expect(status.pendingCleanup && !status.active && !frozen.active && frozen.cleanupFailed,
            "$startup failed status cleanup retains inactive ownership")
        expect(!diagnostics.callback(20) && diagnostics.snapshot().callbackCount == frozen.callbackCount,
            "$startup stale status callback cannot change frozen observations")
        var replacementRegistered = false
        status.start(Any()) { replacementRegistered = true; true }
        expect(!replacementRegistered && status.pendingCleanup && !status.active,
            "$startup failed status cleanup cannot be hidden by a replacement listener")
        status.stop()
        expect(attempts == 2 && !status.pendingCleanup && !status.active,
            "$startup retry releases only the retained status listener")
        status.stop()
        expect(attempts == 2, "$startup successful status release is idempotent")
        expect(diagnostics.snapshot().registration.label == startup && diagnostics.snapshot().cleanupFailed,
            "$startup preserves the original registration and cleanup diagnostics")
    }

    var released = false
    var completionCount = 0
    val frameworkError = IllegalStateException("framework lifecycle failed")
    val thrown = runCatching {
        NativeLifecycleCleanup.lifecycle(emptyList(), listOf(
            NativeLifecycleCleanup.Action("resource") { released = true }
        ), complete = { completionCount++; throw frameworkError })
    }.exceptionOrNull()
    expect(released && completionCount == 1 && thrown === frameworkError, "framework errors propagate after resources were attempted")
    println("Native lifecycle cleanup: $passed deterministic checks passed")
}
