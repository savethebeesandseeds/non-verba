// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Public immutable generation lookup; no Android calls, key creation or mutation. */
internal object NativeEnrollmentCatalog {
    const val CAPACITY = 32
    data class Entry(val id: String, val challenge: String, val fingerprint: String?)

    fun requireCapacity(used: Int) {
        check(used in 0 until CAPACITY) { "This purpose has reached its 32 preserved enrollment slots; no key was deleted or replaced" }
    }

    fun byChallenge(entries: List<Entry>, challenge: String): Entry? = unique(entries.filter { it.challenge == challenge })

    fun byFingerprint(entries: List<Entry>, fingerprint: String): Entry? {
        require(Regex("^[0-9a-f]{64}$").matches(fingerprint)) { "An exact enrolled key ID is required" }
        return unique(entries.filter { it.fingerprint == fingerprint })
    }

    /** Compatibility export never guesses the most recently generated key. */
    fun defaultEntry(entries: List<Entry>, profile: String, selectedPin: String?, originalId: String): Entry? {
        if (profile == "attested") return byFingerprint(entries, requireNotNull(selectedPin) { "Selected enrolled key ID is missing" })
        check(profile == "legacy") { "Unknown key profile" }
        val ready = entries.filter { it.fingerprint != null }
        return unique(ready.filter { it.id == originalId }) ?: ready.singleOrNull()
    }

    private fun unique(entries: List<Entry>): Entry? {
        check(entries.size <= 1) { "Duplicate enrollment identity or challenge records are ambiguous; all keys were preserved" }
        return entries.singleOrNull()
    }
}
