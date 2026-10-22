// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.participant

import java.util.Base64

/** Bounded in-memory lease for the one explicitly requested recovery-code file. */
internal class RecoveryExportSession(private val now: () -> Long) {
    internal class Ticket internal constructor(val id: String, val deadline: Long, internal var bytes: ByteArray?) {
        internal var workerBytes: ByteArray? = null
    }
    private var current: Ticket? = null

    @Synchronized fun begin(id: String, content: String): Ticket {
        expire()
        require(UUID.matches(id) && validContent(content))
        check(current == null)
        return Ticket(id, Math.addExact(now(), LIFETIME_MS), content.toByteArray(Charsets.UTF_8)).also { current = it }
    }

    @Synchronized fun active(ticket: Ticket): Boolean {
        expire()
        return current === ticket && ticket.bytes != null
    }

    @Synchronized fun copyBytes(ticket: Ticket): ByteArray? {
        if (!active(ticket)) return null
        check(ticket.workerBytes == null)
        return ticket.bytes?.copyOf()?.also { ticket.workerBytes = it }
    }

    @Synchronized fun releaseBytes(ticket: Ticket, bytes: ByteArray) {
        if (ticket.workerBytes === bytes) ticket.workerBytes = null
        bytes.fill(0)
    }

    @Synchronized fun finish(ticket: Ticket) {
        if (current === ticket) current = null
        ticket.bytes?.fill(0)
        ticket.bytes = null
        ticket.workerBytes?.fill(0)
        ticket.workerBytes = null
    }

    @Synchronized fun cancel(id: String): Boolean {
        expire()
        val ticket = current?.takeIf { it.id == id } ?: return false
        finish(ticket)
        return true
    }

    @Synchronized fun revoke() { current?.let(::finish) }

    private fun expire() { current?.takeIf { now() >= it.deadline }?.let(::finish) }

    companion object {
        const val FILENAME = "non-verba-recovery-codes.txt"
        const val LIFETIME_MS = 120_000L
        const val REQUEST_LIMIT = 2048
        val UUID = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
        private const val HEADER = "Non-verba recovery codes\n\n"
        private const val FOOTER = "\nKeep these codes private. Each code can be used once.\nA successful recovery replaces this set.\n"
        private val TOKEN = Regex("[A-Za-z0-9_-]{43}")

        fun validContent(content: String): Boolean {
            if (content.toByteArray(Charsets.UTF_8).size > REQUEST_LIMIT ||
                !content.startsWith(HEADER) || !content.endsWith(FOOTER)) return false
            val rows = content.substring(HEADER.length, content.length - FOOTER.length).split('\n')
            if (rows.size != 5 || rows.last().isNotEmpty()) return false
            val codes = rows.dropLast(1).flatMap { row ->
                val pair = row.split("  ")
                if (pair.size != 2) return false
                pair
            }
            if (codes.size != 8 || codes.toSet().size != 8) return false
            return codes.all { code ->
                if (!TOKEN.matches(code)) false else try {
                    val bytes = Base64.getUrlDecoder().decode(code)
                    bytes.size == 32 && Base64.getUrlEncoder().withoutPadding().encodeToString(bytes) == code
                } catch (_: IllegalArgumentException) { false }
            }
        }
    }
}
