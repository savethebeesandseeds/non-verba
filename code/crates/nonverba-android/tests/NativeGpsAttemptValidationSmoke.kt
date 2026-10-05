// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/** Deterministic fault/control checks. Android AtomicFile and Keystore need separate device checks. */
fun main() {
    var checks = 0
    fun expect(value: Boolean) { check(value); checks++ }
    fun rejected(action: () -> Unit) { expect(runCatching(action).isFailure) }
    val validation = NativeGpsAttemptValidation(true)
    rejected { NativeGpsAttemptValidation(false).arm("signing", true, false) }
    rejected { validation.arm("signing", false, false) }
    rejected { validation.arm("signing", true, true) }
    rejected { validation.arm("arbitrary-signing", true, false) }
    expect(validation.mode() == null)
    validation.arm("signing", true, false)
    expect(validation.mode() == "signing")
    val signing = checkNotNull(validation.take())
    expect(validation.mode() == null && validation.take() == null)
    expect(!signing.triggered())
    expect(!signing.failStorageWrite())
    rejected { signing.afterKeystoreSigning() }
    expect(signing.triggered())
    signing.afterKeystoreSigning() // Exactly once; never affects another session.
    expect(!signing.failStorageWrite())
    validation.arm("initial-storage", true, false)
    validation.arm("clear", true, false)
    expect(validation.take() == null)
    validation.arm("final-storage", true, false)
    validation.clear()
    expect(validation.take() == null)

    val root = Files.createTempDirectory("gps-attempt-validation-").toFile()
    val originalId = "11111111-1111-4111-8111-111111111111"
    fun openJournal(fault: NativeGpsAttemptValidation.Fault? = null) = NativeGpsAttemptJournal(root,
        read = { it.readBytes() }, commit = { file, bytes ->
            val staged = File(file.path + ".new")
            try {
                // Linux file layer provides a real rollback/readback test; it does not emulate Android.
                if (fault?.failStorageWrite() == true) {
                    staged.writeBytes(bytes.copyOfRange(0, minOf(bytes.size, 8)))
                    error(fault.message)
                }
                staged.writeBytes(bytes)
                Files.move(staged.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            } finally { staged.delete() }
        })
    val original = "existing retained outcome".toByteArray()
    openJournal().put(originalId, original)
    for ((index, mode) in listOf("initial-storage", "signing", "final-storage", "none").withIndex()) {
        val id = "${(index + 2).toString().padStart(8, '0')}-0000-4000-8000-000000000000"
        val fault = mode.takeUnless { it == "none" }?.let { NativeGpsAttemptValidation.Fault(it) }
        val journal = openJournal(fault)
        var memory = "unsigned-pending"
        var signCalls = 0
        var durable = false
        var failurePhase: String? = null
        NativeGpsAttemptFinalization.run(writePending = { journal.put(id, memory.toByteArray()) },
            sign = { signCalls++; fault?.afterKeystoreSigning(); memory = "signed-synthetic-test" },
            writeFinal = { journal.put(id, memory.toByteArray()) },
            initialStorageFailed = { memory = "unsigned-storage-failed"; failurePhase = "initial" },
            signingFailed = { memory = "unsigned-signing-failed"; failurePhase = "signing" },
            finalStorageFailed = { memory = "signed-storage-failed"; failurePhase = "final" },
            durable = { durable = true })
        val restarted = openJournal() // No shared controller/current report or fault state.
        expect(restarted.get(originalId).contentEquals(original))
        when (mode) {
            "initial-storage" -> {
                expect(signCalls == 0 && !durable && failurePhase == "initial")
                expect(memory == "unsigned-storage-failed" && id !in restarted.ids())
            }
            "signing" -> {
                expect(signCalls == 1 && durable && failurePhase == "signing")
                expect(memory == "unsigned-signing-failed" && restarted.get(id).toString(Charsets.UTF_8) == memory)
            }
            "final-storage" -> {
                expect(signCalls == 1 && !durable && failurePhase == "final")
                expect(memory == "signed-storage-failed")
                expect(restarted.get(id).toString(Charsets.UTF_8) == "unsigned-pending")
            }
            else -> {
                expect(signCalls == 1 && durable && failurePhase == null)
                expect(restarted.get(id).toString(Charsets.UTF_8) == "signed-synthetic-test")
            }
        }
    }
    root.deleteRecursively() // Only the temporary directory created above.
    println("$checks GPS attempt validation checks passed (synthetic signing, real Linux file rollback; no Android claim)")
}
