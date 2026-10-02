// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

/** Internal Rust protocol/DSP/C2PA entry points. Never installed as a JavaScript interface. */
internal object NativeAudioCore {
    init { System.loadLibrary("nonverba_android") }
    external fun validateRequest(request: String, nowMs: Long): String
    external fun createPilot(request: String, nowMs: Long): String
    external fun validateRound(request: String, round: String, priorRounds: String, nowMs: Long): String
    external fun probe(round: String): FloatArray
    external fun validatePilot(pcm: FloatArray, round: String): String
    external fun encodeChunk(pcm: FloatArray): String
    external fun validateReceipt(request: String, rounds: String, receipt: String, nowMs: Long): String
    external fun seal(
        pcm: FloatArray,
        request: String,
        transcript: String,
        metadata: String,
        publicSpki: ByteArray,
        certificatePem: String,
        nowMs: Long,
        signer: NativeMediaEvidenceSigner
    ): String
}
