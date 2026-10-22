// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.participant

import java.util.Base64

private fun rejected(action: () -> Unit) {
    check(runCatching(action).isFailure)
}

fun main() {
    val id1 = "8a31ed83-9cb8-4179-bcca-eb9c0ef1452c"
    val id2 = "c3f75e36-2ca9-40a5-b9d0-234a2b2f9a7f"
    val codes = (1..8).map { value -> Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32) { value.toByte() }) }
    fun text(values: List<String>) = "Non-verba recovery codes\n\n" + values.chunked(2).joinToString("\n") { it.joinToString("  ") } +
        "\n\nKeep these codes private. Each code can be used once.\nA successful recovery replaces this set.\n"
    val content = text(codes)
    check(RecoveryExportSession.validContent(content))
    for (invalid in listOf(content.replace("\n", "\r\n"), content + "extra", text(codes.drop(1)),
        text(codes + codes.first()), text(codes.dropLast(1) + codes.first()),
        content.replace(codes.first(), "A".repeat(42) + "B"), content.replace("  ", "\t"),
        "x".repeat(RecoveryExportSession.REQUEST_LIMIT + 1))) {
        check(!RecoveryExportSession.validContent(invalid))
    }
    var clock = 50L
    val session = RecoveryExportSession { clock }
    rejected { session.begin("not-a-uuid", content) }
    val first = session.begin(id1, content)
    val retained = first.bytes ?: error("Expected private pending bytes")
    check(session.active(first))
    val copy = session.copyBytes(first) ?: error("Expected export copy")
    copy.fill(0)
    rejected { session.copyBytes(first) } // one tracked worker copy at a time
    session.releaseBytes(first, copy)
    check(session.copyBytes(first)!!.contentEquals(content.toByteArray()))
    val firstWorker = first.workerBytes ?: error("Expected tracked worker copy")
    rejected { session.begin(id2, content) }
    check(!session.cancel(id2) && session.active(first))
    check(session.cancel(id1) && !session.active(first) && retained.all { it == 0.toByte() })
    check(first.workerBytes == null && firstWorker.all { it == 0.toByte() })
    val second = session.begin(id2, content)
    val secondWorker = session.copyBytes(second) ?: error("Expected successor worker copy")
    session.releaseBytes(first, firstWorker)
    session.finish(first)
    check(session.active(second)) // stale completion cannot revoke a retry
    check(secondWorker.contentEquals(content.toByteArray()))
    clock += RecoveryExportSession.LIFETIME_MS
    check(!session.active(second) && second.bytes == null)
    check(second.workerBytes == null && secondWorker.all { it == 0.toByte() })
    // A worker returning from a blocked provider open after expiry cannot get
    // plaintext. A blocked write's existing tracked copy was already zeroed above.
    check(session.copyBytes(second) == null)
    val third = session.begin(id1, content)
    val thirdBytes = third.bytes ?: error("Expected private pending bytes")
    val thirdWorker = session.copyBytes(third) ?: error("Expected final worker copy")
    session.revoke()
    check(!session.active(third) && third.bytes == null && thirdBytes.all { it == 0.toByte() })
    check(third.workerBytes == null && thirdWorker.all { it == 0.toByte() })
    println("Recovery export: exact format, tracked worker copies, cancellation/expiry wiping and stale completion passed.")
}
