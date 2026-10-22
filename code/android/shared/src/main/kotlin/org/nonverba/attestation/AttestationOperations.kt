// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.attestation

import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock

/** Revocable operation ownership, independent of Android and of an account transport. */
internal class AttestationOperations(
    private val elapsedMillis: () -> Long,
    private val nowSeconds: () -> Long,
    private val capacity: Int = 4
) {
    internal class Ticket internal constructor(
        val id: String,
        internal val started: Long,
        internal val expiresAt: Long
    ) {
        @Volatile internal var revoked = false
    }

    private val tickets = mutableMapOf<String, Ticket>()

    init { require(capacity in 1..4) }

    @Synchronized fun begin(id: String, expiresAt: Long): Ticket {
        require(UUID.matches(id))
        val now = nowSeconds()
        val started = elapsedMillis()
        require(started >= 0 && now >= 0 && expiresAt > now && expiresAt - now <= 150)
        if (tickets.size >= capacity || tickets.containsKey(id)) throw AttestationFailure("attestation_busy")
        return Ticket(id, started, expiresAt).also { tickets[id] = it }
    }

    @Synchronized fun active(ticket: Ticket): Boolean {
        val elapsed = elapsedMillis()
        val now = nowSeconds()
        return tickets[ticket.id] === ticket && !ticket.revoked && !Thread.currentThread().isInterrupted &&
            elapsed >= ticket.started && elapsed - ticket.started <= 120_000 && now >= 0 && now < ticket.expiresAt
    }

    @Synchronized fun cancel(id: String): Boolean {
        val ticket = tickets[id] ?: return false
        ticket.revoked = true
        // Retain ownership until its worker exits; a cancelled platform call may still be running.
        return true
    }

    @Synchronized fun finish(ticket: Ticket) {
        ticket.revoked = true
        if (tickets[ticket.id] === ticket) tickets.remove(ticket.id)
    }

    @Synchronized fun revokeAll() {
        tickets.values.forEach { it.revoked = true }
        // Old ticket objects stay revoked even if an Activity is later resumed.
        tickets.clear()
    }

    companion object {
        val UUID = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}")
    }
}

/** Small stable categories; never include platform messages, key material or a hardware verdict. */
internal class AttestationFailure(val code: String) : IllegalStateException(code)

/** Waiters remain bounded by their own ticket even if another platform call cannot be interrupted. */
internal object AttestationKeyLock {
    fun <T> withAuthority(lock: ReentrantLock, active: () -> Boolean, operation: () -> T): T {
        fun requireActive() { if (!active()) throw AttestationFailure("attestation_cancelled") }
        while (true) {
            requireActive()
            if (lock.tryLock(100, TimeUnit.MILLISECONDS)) break
        }
        try {
            requireActive()
            val result = operation()
            requireActive()
            return result
        } finally { lock.unlock() }
    }
}
