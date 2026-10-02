// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Actual immutable-generation selection rules; no Android Keystore claim. */
fun main() {
    var passed = 0
    fun rejects(label: String, operation: () -> Unit) {
        check(runCatching(operation).isFailure) { "$label unexpectedly passed" }
        passed++
    }
    val oldPin = "11".repeat(32)
    val newPin = "22".repeat(32)
    val original = NativeEnrollmentCatalog.Entry("v2", "original-challenge", oldPin)
    val renewed = NativeEnrollmentCatalog.Entry("v3-challenge-hash", "fresh-challenge", newPin)
    val pending = NativeEnrollmentCatalog.Entry("v3-pending-hash", "pending-challenge", null)
    val entries = listOf(original, renewed, pending)

    check(NativeEnrollmentCatalog.byChallenge(entries, "original-challenge") === original)
    passed++
    check(NativeEnrollmentCatalog.byChallenge(entries, "pending-challenge") === pending)
    passed++
    check(NativeEnrollmentCatalog.byChallenge(entries, "another-challenge") == null)
    passed++
    // A running capture's frozen pin resolves its original generation even when
    // another identity has been enrolled and selected for later captures.
    check(NativeEnrollmentCatalog.defaultEntry(entries, "attested", newPin, "v2") === renewed)
    check(NativeEnrollmentCatalog.byFingerprint(entries, oldPin) === original)
    passed++
    check(NativeEnrollmentCatalog.defaultEntry(entries, "legacy", null, "v2") === original)
    passed++
    check(NativeEnrollmentCatalog.defaultEntry(listOf(renewed, pending), "legacy", null, "v2") === renewed)
    passed++
    check(NativeEnrollmentCatalog.defaultEntry(listOf(original.copy(id = "v3-first"), renewed), "legacy", null, "v2") == null)
    passed++
    check(NativeEnrollmentCatalog.defaultEntry(listOf(pending), "legacy", null, "v2") == null)
    passed++
    check(NativeEnrollmentCatalog.byFingerprint(entries, "33".repeat(32)) == null)
    check(NativeEnrollmentCatalog.defaultEntry(entries, "attested", "33".repeat(32), "v2") == null)
    passed++
    rejects("Missing selected key ID cannot fall back to another identity") {
        NativeEnrollmentCatalog.defaultEntry(entries, "attested", null, "v2")
    }
    rejects("Malformed explicit key ID") { NativeEnrollmentCatalog.byFingerprint(entries, "not-a-key-pin") }
    rejects("Duplicate challenge records") { NativeEnrollmentCatalog.byChallenge(entries + original.copy(id = "duplicate"), original.challenge) }
    rejects("Duplicate key pins") { NativeEnrollmentCatalog.byFingerprint(entries + original.copy(id = "duplicate"), oldPin) }
    NativeEnrollmentCatalog.requireCapacity(31)
    passed++
    rejects("Full preserved-generation capacity") { NativeEnrollmentCatalog.requireCapacity(32) }
    rejects("Corrupt capacity value") { NativeEnrollmentCatalog.requireCapacity(-1) }
    val full = List(32) { index -> NativeEnrollmentCatalog.Entry("generation-$index", "challenge-$index", "%064x".format(index + 1)) }
    check(NativeEnrollmentCatalog.byChallenge(full, "challenge-0") === full.first())
    passed++ // Resuming an existing challenge needs no new slot.
    println("Native enrollment catalog checks passed: $passed (host identity-selection rules; no Android Keystore claim)")
}
