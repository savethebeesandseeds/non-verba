// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import java.io.File
import java.nio.file.Files

fun main() {
    var checks = 0
    fun expect(value: Boolean) { check(value); checks++ }
    fun rejected(fn: () -> Unit) { expect(runCatching(fn).isFailure) }
    val terminal = NativeLocationTerminal()
    terminal.freeze(26_299, 100_000)
    terminal.freeze(80_000, 160_000)
    expect(terminal.elapsedMs == 26_299L && terminal.wallMs == 100_000L)
    fun eligible(stage: String? = "collecting", raw: Boolean = true, elapsed: Long = 60_000,
        timeout: Long = 60_000, callbacks: Int = 0, epochs: Int = 0, rejected: Int = 0) =
        NativeGpsAttemptEligibility.noCallbackTimeout(stage, raw, elapsed, timeout, callbacks, epochs, rejected)
    expect(eligible())
    expect(eligible(elapsed = 65_000)) // Scheduler delay never becomes a shorter device deadline.
    expect(!eligible(elapsed = 59_999))
    expect(!eligible(stage = "requesting-permission"))
    expect(!eligible(stage = "ready"))
    expect(!eligible(raw = false))
    expect(!eligible(timeout = 2000))
    expect(!eligible(callbacks = 1))
    expect(!eligible(epochs = 1))
    expect(!eligible(rejected = 1))
    val root = Files.createTempDirectory("gps-attempt-journal-").toFile()
    fun journal(write: (File, ByteArray) -> Unit = { f,b -> f.writeBytes(b) }) =
        NativeGpsAttemptJournal(root, { it.readBytes() }, write)
    val j = journal()
    val id = "11111111-1111-4111-8111-111111111111"
    j.put(id, "unsigned-pending".toByteArray())
    j.put(id, "signed-original".toByteArray())
    j.put("22222222-2222-4222-8222-222222222222", "retry".toByteArray())
    expect(journal().get(id).toString(Charsets.UTF_8) == "signed-original")
    expect(journal().ids().size == 2)
    rejected { journal { _,_ -> error("Full storage") }.put(id, "replacement".toByteArray()) }
    expect(j.get(id).toString(Charsets.UTF_8) == "signed-original")
    rejected { j.put("../escape", byteArrayOf(1)) }
    rejected { j.put(id, ByteArray(NativeGpsAttemptJournal.MAX_BYTES + 1)) }
    rejected { j.get("33333333-3333-4333-8333-333333333333") }
    for (i in 3..32) j.put("${i.toString(16).padStart(8,'0')}-0000-4000-8000-000000000000", byteArrayOf(1))
    rejected { j.put("ffffffff-ffff-4fff-8fff-ffffffffffff", byteArrayOf(1)) }
    expect(j.ids().size == 32 && j.get(id).toString(Charsets.UTF_8) == "signed-original")
    val alias = File(root, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json")
    Files.createSymbolicLink(alias.toPath(), File(root.parentFile, "elsewhere").toPath())
    rejected { j.ids() }
    // Only this harness's own temporary directory is removed, never project evidence.
    root.deleteRecursively()
    println("$checks GPS terminal/journal checks passed (synthetic clocks, real Linux files)")
}
