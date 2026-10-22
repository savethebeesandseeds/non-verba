// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import org.nonverba.attestation.SigninDeviceChallenge

/** Developer tool accepts only an isolated synthetic context, never a real account session. */
internal object DeveloperAttestationProfile {
    private val SCOPE = Regex("dev-tool:attestation:[a-f0-9]{32}")

    fun allows(challenge: SigninDeviceChallenge): Boolean =
        SCOPE.matches(challenge.accountId) && challenge.recoveryGeneration == 0L &&
            challenge.currentSessionId == "dev-tool-session:" + challenge.challengeId
}
