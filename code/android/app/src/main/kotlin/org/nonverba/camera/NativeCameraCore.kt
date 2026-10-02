// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Internal Rust entry points; never installed as a JavaScript interface. */
internal object NativeCameraCore {
    init { System.loadLibrary("nonverba_android") }
    external fun createCertificate(publicSpki: ByteArray): String
    external fun identity(certificatePem: String, publicSpki: ByteArray): String
    external fun validateRequest(challenge: String, locationRequest: String, nowMs: Long): String
    external fun validateLocation(request: String, location: String, nowMs: Long): String
    external fun seal(
        jpeg: ByteArray,
        request: String,
        location: String,
        metadata: String,
        publicSpki: ByteArray,
        certificatePem: String,
        nowMs: Long,
        signer: NativeMediaEvidenceSigner
    ): String
}
