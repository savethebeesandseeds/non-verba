// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.attestation

fun main() {
    val document = AttestationDocumentAccess.ASSET_ORIGIN + "/assets/web/device-attestation.html"
    fun allowed(current: String? = document, origin: String = AttestationDocumentAccess.ASSET_ORIGIN,
        mainFrame: Boolean = true, foreground: Boolean = true, closed: Boolean = false, visible: Boolean = true) =
        AttestationDocumentAccess.allows(document, current, origin, mainFrame, foreground, closed) { visible }
    check(allowed()) // A newly executing exact document can discover before onPageFinished.
    check(!allowed(current = AttestationDocumentAccess.ASSET_ORIGIN + "/assets/web/index.html"))
    check(!allowed(current = document + "?other=1"))
    check(!allowed(current = document + "#other"))
    check(!allowed(current = null))
    check(!allowed(origin = "http://appassets.androidplatform.net"))
    check(!allowed(origin = "https://other.example"))
    check(!allowed(mainFrame = false))
    check(!allowed(foreground = false))
    check(!allowed(closed = true))
    check(!allowed(visible = false))
    check(!AttestationDocumentAccess.allows(document, null, "https://other.example", false, true, false) {
        error("Rejected origin/document must not inspect foreground app state")
    })

    // Navigation revokes old work without preventing admission of the new exact foreground document.
    val operations = AttestationOperations({ 0 }, { 100 })
    val old = operations.begin("00000000-0000-4000-8000-000000000001", 220)
    operations.revokeAll()
    check(!operations.active(old) && allowed())
    val fresh = operations.begin("00000000-0000-4000-8000-000000000002", 220)
    check(operations.active(fresh) && !operations.active(old))
    operations.finish(old)
    check(operations.active(fresh))
    operations.finish(fresh)
    println("Attestation exact-document discovery, foreground admission and navigation revocation checks passed")
}
