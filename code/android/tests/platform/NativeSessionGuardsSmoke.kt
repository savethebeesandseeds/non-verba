// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

/** Actual production clock/signing gates with fake clocks and deterministic lock contention. */
fun main() {
    var passed = 0
    fun rejects(label: String, operation: () -> Unit) {
        val failure = runCatching(operation).exceptionOrNull()
        check(failure != null) { "$label unexpectedly passed" }
        passed++
    }

    val wall = 1_900_000_000_000L
    val mono = 100_000_000_000L
    check(NativeSessionGuards.elapsedMillis(wall, mono, wall + 1234, mono + 1_234_000_000) == 1234L)
    passed++
    check(NativeSessionGuards.elapsedMillis(wall, mono, wall + 1500, mono + 500_000_000) == 500L)
    passed++
    rejects("Monotonic regression") { NativeSessionGuards.elapsedMillis(wall, mono, wall, mono - 1) }
    rejects("Frozen wall clock after acquisition") { NativeSessionGuards.elapsedMillis(wall, mono, wall, mono + 5_000_000_000) }
    rejects("Forward wall jump") { NativeSessionGuards.elapsedMillis(wall, mono, wall + 2000, mono + 100_000_000) }
    rejects("Clock arithmetic overflow") { NativeSessionGuards.elapsedMillis(Long.MAX_VALUE, 0, 0, Long.MAX_VALUE) }

    NativeSessionGuards.requireFresh(15000, 10000, 5000)
    passed++
    rejects("One millisecond beyond freshness boundary") { NativeSessionGuards.requireFresh(15001, 10000, 5000) }
    rejects("Future native sample") { NativeSessionGuards.requireFresh(9999, 10000, 5000) }
    // A tolerated one-second wall offset must not extend a five-second sample
    // freshness budget. The wall age below is 4.5s, but the actual age is 5.5s.
    val elapsed = NativeSessionGuards.elapsedMillis(wall, mono, wall + 14500, mono + 15_500_000_000)
    rejects("Wall skew cannot refresh an old sample") { NativeSessionGuards.requireFresh(elapsed, 10000, 5000) }

    NativeSessionGuards.requireAuthority(true, false, true, true)
    passed++
    rejects("Pause between native signing and result commit") { NativeSessionGuards.requireAuthority(false, false, true, true) }
    rejects("Destroyed controller") { NativeSessionGuards.requireAuthority(true, true, true, true) }
    rejects("Replaced or cancelled session") { NativeSessionGuards.requireAuthority(true, false, false, true) }
    rejects("Permission revoked") { NativeSessionGuards.requireAuthority(true, false, true, false) }

    val keyLock = Any()
    val active = AtomicBoolean(true)
    val attempts = AtomicInteger(0)
    val approachingKey = CountDownLatch(1)
    val queuedError = AtomicReference<Throwable?>()
    lateinit var queued: Thread
    synchronized(keyLock) {
        queued = thread(name = "cancelled-signing-waiter") {
            try {
                check(active.get()) // This old pre-lock check alone is insufficient.
                approachingKey.countDown()
                NativeSessionGuards.withSigningAuthority(keyLock, { active.get() }) { attempts.incrementAndGet() }
            } catch (failure: Throwable) { queuedError.set(failure) }
        }
        check(approachingKey.await(3, TimeUnit.SECONDS)) { "Signer did not approach the held key" }
        active.set(false) // Cancellation occurs while the key remains locked.
    }
    queued.join(3000)
    check(!queued.isAlive && queuedError.get() != null && attempts.get() == 0) { "A queued cancelled signer reached cryptographic signing" }
    passed++

    active.set(true)
    rejects("Cancellation during cryptographic signing discards its result") {
        NativeSessionGuards.withSigningAuthority(keyLock, { active.get() }) {
            attempts.incrementAndGet()
            active.set(false)
            byteArrayOf(1, 2, 3)
        }
    }
    active.set(true)
    val result = NativeSessionGuards.withSigningAuthority(keyLock, { active.get() }) { byteArrayOf(4, 5, 6) }
    check(result.contentEquals(byteArrayOf(4, 5, 6)))
    passed++

    // Audio uses its final input callback, rather than a wall-clock completion
    // estimate, throughout key acquisition, signing and result publication.
    var audioElapsedMs = 35_000L
    val audioCompletedMs = 5_000L
    fun audioFresh(): Boolean = runCatching {
        NativeSessionGuards.requireFresh(audioElapsedMs, audioCompletedMs, 30_000)
        true
    }.getOrDefault(false)
    check(NativeSessionGuards.withSigningAuthority(keyLock, ::audioFresh) { "at-boundary" } == "at-boundary")
    passed++
    val attemptsBeforeExpiry = attempts.get()
    audioElapsedMs++
    rejects("Audio expires before the shared signing key becomes available") {
        NativeSessionGuards.withSigningAuthority(keyLock, ::audioFresh) { attempts.incrementAndGet() }
    }
    check(attempts.get() == attemptsBeforeExpiry) { "Expired audio reached the signing operation" }
    audioElapsedMs = 35_000
    rejects("Audio expires during signing and cannot be published") {
        NativeSessionGuards.withSigningAuthority(keyLock, ::audioFresh) { audioElapsedMs++; "late-signature" }
    }
    val issuedAt = wall / 1000
    val expiresAt = issuedAt + 10
    var cameraWall = wall + 9999
    fun cameraValid(): Boolean = runCatching {
        NativeSessionGuards.requireRequestWindow(cameraWall, issuedAt, expiresAt)
        true
    }.getOrDefault(false)
    check(NativeSessionGuards.withSigningAuthority(keyLock, ::cameraValid) { "valid-camera" } == "valid-camera")
    passed++
    cameraWall++
    val cameraAttempts = attempts.get()
    rejects("Camera challenge expires while waiting for signing authority") {
        NativeSessionGuards.withSigningAuthority(keyLock, ::cameraValid) { attempts.incrementAndGet() }
    }
    check(attempts.get() == cameraAttempts)
    cameraWall = wall + 9999
    rejects("Camera challenge expires during signing and cannot be published") {
        NativeSessionGuards.withSigningAuthority(keyLock, ::cameraValid) { cameraWall++; "late-camera-signature" }
    }
    rejects("Camera challenge not issued yet") { NativeSessionGuards.requireRequestWindow(wall - 1, issuedAt, expiresAt) }
    // Location can still have a fresh fix when the enclosing request expires.
    // Exercise the same combined gate used before/inside/after real native sealing.
    val locationWall = AtomicLong(wall + 9999)
    fun locationGate() = NativeSessionGuards.requireFreshRequest(locationWall.get(), issuedAt, expiresAt,
        locationWall.get() - wall, 9999, 5000)
    fun locationActive(): Boolean = runCatching { locationGate(); true }.getOrDefault(false)
    check(NativeSessionGuards.withSigningAuthority(keyLock, ::locationActive) { "live-location" } == "live-location")
    passed++
    val locationApproachingKey = CountDownLatch(1)
    val locationError = AtomicReference<Throwable?>()
    val locationAttempts = AtomicInteger(0)
    lateinit var locationWaiter: Thread
    synchronized(keyLock) {
        locationWaiter = thread(name = "location-expiry-key-waiter") {
            try {
                locationGate()
                locationApproachingKey.countDown()
                NativeSessionGuards.withSigningAuthority(keyLock, ::locationActive) { locationAttempts.incrementAndGet() }
            } catch (failure: Throwable) { locationError.set(failure) }
        }
        check(locationApproachingKey.await(3, TimeUnit.SECONDS))
        locationWall.set(wall + 10000) // Fix age is only 1ms; expiry must independently revoke signing.
    }
    locationWaiter.join(3000)
    check(!locationWaiter.isAlive && locationError.get() != null && locationAttempts.get() == 0)
    passed++
    locationWall.set(wall + 9999)
    rejects("Location request expires during signing even though the fix remains fresh") {
        NativeSessionGuards.withSigningAuthority(keyLock, ::locationActive) {
            locationWall.incrementAndGet()
            "late-location-signature"
        }
    }
    locationWall.set(wall + 9999)
    NativeSessionGuards.withSigningAuthority(keyLock, ::locationActive) { "signed-before-expiry" }
    locationWall.incrementAndGet()
    rejects("Location request expires after signing but before result publication") { locationGate() }
    rejects("Valid location request cannot refresh an expired fix") {
        NativeSessionGuards.requireFreshRequest(wall + 9999, issuedAt, expiresAt, 9999, 4998, 5000)
    }
    println("Native session guard checks passed: $passed (host fake clocks/gates; no sensor or Android Keystore claim)")
}
