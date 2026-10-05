// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import java.io.File

/** Bounded persistent outcomes, independent of the successful-proof nonce ledger. */
internal class NativeGpsAttemptJournal(
    private val root: File,
    private val read: (File) -> ByteArray,
    private val commit: (File, ByteArray) -> Unit
) {
    @Synchronized fun ids(): List<String> {
        if (!root.exists()) return emptyList()
        check(root.isDirectory && !java.nio.file.Files.isSymbolicLink(root.toPath())) { "Attempt directory is invalid" }
        val files = checkNotNull(root.listFiles()) { "Attempt inventory unavailable" }
        check(files.all { NAME.matches(it.name) && it.canonicalFile.parentFile == root.canonicalFile }) { "Attempt inventory is invalid" }
        return files.map { it.name.substringBefore('.') }.distinct().sorted().also {
            check(it.size <= MAX_RECORDS) { "Attempt journal exceeds capacity" }
        }
    }

    @Synchronized fun put(id: String, bytes: ByteArray) {
        require(ID.matches(id) && bytes.size in 1..MAX_BYTES) { "Invalid bounded attempt record" }
        check(root.isDirectory || root.mkdirs()) { "Attempt directory unavailable" }
        val existing = ids()
        check(id in existing || existing.size < MAX_RECORDS) { "Attempt journal is full; older reports preserved" }
        val file = File(root, "$id.json")
        commit(file, bytes)
        check(read(file).contentEquals(bytes)) { "Attempt storage readback failed" }
    }

    @Synchronized fun get(id: String): ByteArray {
        require(ID.matches(id)) { "Invalid attempt ID" }
        check(id in ids()) { "Unknown retained attempt" }
        return read(File(root, "$id.json")).also { check(it.size in 1..MAX_BYTES) { "Attempt record exceeds limit" } }
    }

    companion object {
        const val MAX_RECORDS = 32
        const val MAX_BYTES = 4 * 1024 * 1024 + 32 * 1024
        private val ID = Regex("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")
        private val NAME = Regex("${ID.pattern}\\.json(?:\\.bak|\\.new)?")
    }
}

/** Freeze once before terminal publication; later inspection never supplies timing. */
internal class NativeLocationTerminal {
    var elapsedMs: Long? = null
        private set
    var wallMs: Long? = null
        private set
    @Synchronized fun freeze(elapsed: Long, wall: Long) {
        if (elapsedMs != null) return
        elapsedMs = elapsed.coerceAtLeast(0)
        wallMs = wall
    }
}

/** Route only the native timer's no-callback case; Rust independently checks the snapshot. */
internal object NativeGpsAttemptEligibility {
    /** Only the actual legacy Android status callback can supply this trigger. */
    fun startupUnavailable(stage: String?, rawRequired: Boolean, permissionGranted: Boolean,
        registration: String, status: String?, statusCode: Int?, callbacks: Int, lastCallback: Long?,
        epochs: Int, rejectedEpochs: Int, eligibleFixes: Int, firstAdmitted: Long?, cadenceSkipped: Int,
        hasWarmupReasons: Boolean): Boolean =
        stage == "collecting" && rawRequired && permissionGranted && registration == "registered" &&
            status == "not-supported" && statusCode == 0 && callbacks == 0 && lastCallback == null &&
            epochs == 0 && rejectedEpochs == 0 && eligibleFixes == 0 && firstAdmitted == null &&
            cadenceSkipped == 0 && !hasWarmupReasons

    fun noCallbackTimeout(stage: String?, rawRequired: Boolean, elapsed: Long, timeout: Long,
        callbacks: Int, epochs: Int, rejectedEpochs: Int): Boolean =
        stage == "collecting" && rawRequired && timeout == 60_000L && elapsed >= timeout &&
            callbacks == 0 && epochs == 0 && rejectedEpochs == 0
}
