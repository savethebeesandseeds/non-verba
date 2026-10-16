// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Internal JNI only. No instance is registered with WebView. */
internal object NativeCameraSetCore {
    init { System.loadLibrary("nonverba_android") }
    external fun validateRequest(request: String, nowMs: Long): String
    external fun validateLocation(request: String, location: String, nowMs: Long): String
    external fun seal(jpeg: ByteArray, member: String, location: String, metadata: String,
        publicSpki: ByteArray, certificatePem: String, nowMs: Long, key: NativeMediaEvidenceSigner): String
}
