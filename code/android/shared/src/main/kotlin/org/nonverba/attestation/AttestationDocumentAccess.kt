// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.attestation

/** Activity foreground and exact-document admission are independent of page-finished timing. */
internal object AttestationDocumentAccess {
    const val ASSET_ORIGIN = "https://appassets.androidplatform.net"

    fun allows(expectedDocument: String, currentDocument: String?, sourceOrigin: String, mainFrame: Boolean,
        foreground: Boolean, closed: Boolean, foregroundDocument: () -> Boolean): Boolean =
        !closed && foreground && mainFrame && sourceOrigin == ASSET_ORIGIN &&
            expectedDocument.startsWith("$ASSET_ORIGIN/") && currentDocument == expectedDocument && foregroundDocument()
}
