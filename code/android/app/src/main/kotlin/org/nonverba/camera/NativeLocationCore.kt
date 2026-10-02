// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Internal JNI entry points. This object is never installed as a WebView bridge. */
internal object NativeLocationCore {
    init { System.loadLibrary("nonverba_android") }
    external fun validateRequest(request: String, nowMs: Long): String
    external fun validateTrace(trace: String, nowMs: Long): String
    external fun rawGnssProgress(trace: String): String
    external fun fingerprint(publicSpki: ByteArray): String
    external fun seal(trace: String, publicSpki: ByteArray, jpeg: ByteArray, nowMs: Long, key: LocationEvidenceSigner): String
    external fun sealAttempt(snapshot: String, publicSpki: ByteArray, nowMs: Long, key: LocationEvidenceSigner): String
}
