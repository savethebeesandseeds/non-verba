// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import java.util.Base64
import org.nonverba.attestation.SigninDeviceChallenge

fun main() {
    val challengeId = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32) { it.toByte() })
    val original = SigninDeviceChallenge(challengeId, "dev-tool:attestation:" + "a".repeat(32),
        "dev-tool-session:$challengeId", 0, "android", Base64.getEncoder().encodeToString(ByteArray(32) { 7 }),
        2_000_000_000, 2_000_000_120).validate(2_000_000_001)
    check(DeveloperAttestationProfile.allows(original))
    for (scope in listOf("account:real", "dev-tool:attestation:" + "A".repeat(32),
        "dev-tool:attestation:" + "a".repeat(31), "dev-tool:attestation:" + "a".repeat(33),
        "other-tool:attestation:" + "a".repeat(32), original.accountId + "\n")) {
        check(!DeveloperAttestationProfile.allows(original.copy(accountId = scope)))
    }
    check(!DeveloperAttestationProfile.allows(original.copy(recoveryGeneration = 1)))
    check(!DeveloperAttestationProfile.allows(original.copy(recoveryGeneration = -1)))
    check(!DeveloperAttestationProfile.allows(original.copy(currentSessionId = "session:real")))
    check(!DeveloperAttestationProfile.allows(original.copy(currentSessionId = "dev-tool-session:" + "b".repeat(43))))
    val nextId = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32) { 8 })
    check(!DeveloperAttestationProfile.allows(original.copy(challengeId = nextId)))
    check(DeveloperAttestationProfile.allows(original.copy(challengeId = nextId, currentSessionId = "dev-tool-session:$nextId")))
    println("Developer attestation synthetic-scope, zero-generation and exact-session isolation checks passed")
}
