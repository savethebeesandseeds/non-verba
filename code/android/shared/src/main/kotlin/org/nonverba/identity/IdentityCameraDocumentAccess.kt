// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.identity

import org.nonverba.attestation.AttestationDocumentAccess

/** Revocation may cross a permission pause; it never creates capture/key authority. */
internal object IdentityCameraDocumentAccess {
    fun allows(expected: String, current: String?, origin: String, mainFrame: Boolean, foreground: Boolean,
        closed: Boolean, revocationOnly: Boolean, foregroundDocument: () -> Boolean): Boolean =
        AttestationDocumentAccess.allows(expected, current, origin, mainFrame, true, closed) {
            revocationOnly || foreground && foregroundDocument()
        }
}
