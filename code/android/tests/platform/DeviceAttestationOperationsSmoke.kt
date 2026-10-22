// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.attestation

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.locks.ReentrantLock

private fun id(value: Int) = "00000000-0000-4000-8000-" + value.toString().padStart(12, '0')
private fun rejected(body: () -> Unit) { check(runCatching(body).isFailure) }

fun main() {
    var elapsed = 100L
    var now = 2_000_000_000L
    val operations = AttestationOperations({ elapsed }, { now })
    val first = operations.begin(id(1), now + 120)
    val second = operations.begin(id(2), now + 120)
    check(operations.active(first) && operations.active(second))
    rejected { operations.begin(id(1), now + 120) }
    check(!operations.cancel(id(99)))
    check(operations.cancel(first.id))
    check(!operations.active(first) && operations.active(second))

    // Cancel does not claim a running platform call has exited or free its resource slot.
    val third = operations.begin(id(3), now + 120)
    val fourth = operations.begin(id(4), now + 120)
    rejected { operations.begin(id(5), now + 120) }
    operations.finish(first)
    val reused = operations.begin(id(1), now + 120)
    operations.finish(first)
    check(operations.active(reused)) // Late completion cannot remove a successor with the same ID.
    operations.finish(third)
    operations.finish(fourth)
    operations.finish(second)

    // Native operation tickets remain revoked across foreground/document generations.
    operations.revokeAll()
    check(!operations.active(reused))
    val successor = operations.begin(id(1), now + 120)
    check(operations.active(successor) && !operations.active(reused))
    operations.finish(reused)
    check(operations.active(successor))

    elapsed = successor.started - 1
    check(!operations.active(successor))
    elapsed = successor.started + 120_001
    check(!operations.active(successor))
    elapsed = successor.started + 120_000
    check(operations.active(successor))
    now = successor.expiresAt
    check(!operations.active(successor))
    now = 2_000_000_000
    elapsed = successor.started
    operations.finish(successor)
    rejected { operations.begin("bad", now + 120) }
    rejected { operations.begin(id(1), now) }
    rejected { operations.begin(id(1), now + 151) }
    rejected { AttestationOperations({ 0 }, { 0 }, 5) }

    // A real worker blocked on a platform-like barrier observes cancellation before publication.
    val ticket = operations.begin(id(9), now + 120)
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    val published = AtomicBoolean(false)
    val workerFailure = AtomicReference<Throwable?>(null)
    val worker = Thread {
        try {
            check(operations.active(ticket))
            entered.countDown()
            check(release.await(5, TimeUnit.SECONDS))
            if (operations.active(ticket)) published.set(true)
            operations.finish(ticket)
        } catch (error: Throwable) { workerFailure.set(error) }
    }
    worker.start()
    check(entered.await(5, TimeUnit.SECONDS))
    check(operations.cancel(ticket.id))
    release.countDown()
    worker.join(5_000)
    check(!worker.isAlive && !published.get() && workerFailure.get() == null)

    val interrupted = operations.begin(id(10), now + 120)
    Thread.currentThread().interrupt()
    check(!operations.active(interrupted))
    check(Thread.interrupted())
    operations.finish(interrupted)

    // Waiting for a different long-running platform call must not defeat this operation's cancel/deadline.
    fun checkWaiter(expire: Boolean) {
        val wall = AtomicLong(2_000_000_000)
        val ownOperations = AttestationOperations({ 0 }, wall::get)
        val waitingTicket = ownOperations.begin(id(if (expire) 21 else 20), wall.get() + 120)
        val lock = ReentrantLock()
        val attempted = CountDownLatch(1)
        val bodyRan = AtomicBoolean(false)
        val failure = AtomicReference<Throwable?>(null)
        lock.lock()
        val waiting = Thread {
            try {
                AttestationKeyLock.withAuthority(lock, {
                    attempted.countDown()
                    ownOperations.active(waitingTicket)
                }) { bodyRan.set(true) }
            } catch (error: Throwable) { failure.set(error) }
            finally { ownOperations.finish(waitingTicket) }
        }
        var exitedBeforeRelease = false
        try {
            waiting.start()
            check(attempted.await(5, TimeUnit.SECONDS))
            if (expire) wall.set(waitingTicket.expiresAt) else check(ownOperations.cancel(waitingTicket.id))
            waiting.join(2_000)
            exitedBeforeRelease = !waiting.isAlive
        } finally { lock.unlock(); waiting.join(5_000) }
        check(exitedBeforeRelease && !bodyRan.get() && failure.get() is AttestationFailure)
    }
    checkWaiter(expire = false)
    checkWaiter(expire = true)

    val lock = ReentrantLock()
    var authorized = true
    rejected { AttestationKeyLock.withAuthority(lock, { authorized }) { authorized = false; "late-result" } }
    check(!lock.isLocked)
    check(AttestationKeyLock.withAuthority(lock, { true }) { "fresh-result" } == "fresh-result")
    println("Device-attestation ticket bounds, targeted cancellation, lifecycle, clocks and stale-worker checks passed")
}
