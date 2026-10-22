// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.attestation

import java.math.BigInteger
import java.util.Base64

/** Fixed sign-in purpose: callers cannot supply arbitrary bytes for this key to sign. */
internal data class SigninDeviceChallenge(
    val challengeId: String,
    val accountId: String,
    val currentSessionId: String,
    val recoveryGeneration: Long,
    val platform: String,
    val challengeB64: String,
    val issuedAt: Long,
    val expiresAt: Long
) {
    fun validate(nowSeconds: Long? = null): SigninDeviceChallenge {
        require(challengeId.length == 43 && DeviceAttestationProof.url32(challengeId))
        require(IDENTIFIER.matches(accountId) && IDENTIFIER.matches(currentSessionId))
        require(recoveryGeneration in 0..MAX_SAFE_INTEGER && platform == "android")
        DeviceAttestationProof.challengeBytes(challengeB64)
        require(issuedAt in 0..MAX_SAFE_INTEGER && expiresAt in 0..MAX_SAFE_INTEGER)
        require(expiresAt > issuedAt && expiresAt - issuedAt <= 120)
        if (nowSeconds != null) {
            require(nowSeconds >= 0 && issuedAt <= nowSeconds + 30 && expiresAt > nowSeconds)
            require(nowSeconds - issuedAt <= 120)
        }
        return this
    }

    fun transcript(): ByteArray {
        validate()
        return ("NONVERBA:SIGNIN_DEVICE:v1\n$challengeId\n$accountId\n$currentSessionId\n" +
            "$recoveryGeneration\n$platform\n$issuedAt\n$expiresAt\n$challengeB64\n").toByteArray(Charsets.UTF_8)
    }

    companion object {
        const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
        private val IDENTIFIER = Regex("[A-Za-z0-9._:-]{1,128}")
    }
}

/** Canonical encodings shared by the Android bridge and its platform-independent checks. */
internal object DeviceAttestationProof {
    val P256_ORDER = BigInteger("ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551", 16)

    fun b64(value: ByteArray): String = Base64.getEncoder().encodeToString(value)

    fun decode(value: String, maximum: Int): ByteArray {
        require(value.length <= (maximum + 2) / 3 * 4)
        val bytes = Base64.getDecoder().decode(value)
        require(bytes.size <= maximum && b64(bytes) == value)
        return bytes
    }

    fun challengeBytes(value: String): ByteArray {
        require(value.length == 44)
        return decode(value, 32).also { require(it.size == 32) }
    }

    fun url32(value: String): Boolean = try {
        val bytes = Base64.getUrlDecoder().decode(value)
        bytes.size == 32 && Base64.getUrlEncoder().withoutPadding().encodeToString(bytes) == value
    } catch (_: IllegalArgumentException) { false }

    /** Android returns DER ECDSA. The server accepts exactly 64 bytes, in low-S form. */
    fun rawP256(der: ByteArray): ByteArray {
        require(der.size in 8..72 && der[0] == 0x30.toByte())
        require((der[1].toInt() and 255) == der.size - 2)
        var offset = 2
        fun integer(): BigInteger {
            require(offset + 2 <= der.size && der[offset++] == 0x02.toByte())
            val length = der[offset++].toInt() and 255
            require(length in 1..33 && offset + length <= der.size)
            val bytes = der.copyOfRange(offset, offset + length)
            offset += length
            require((bytes[0].toInt() and 0x80) == 0)
            require(length == 1 || bytes[0] != 0.toByte() || (bytes[1].toInt() and 0x80) != 0)
            return BigInteger(1, bytes).also { require(it.signum() > 0 && it < P256_ORDER) }
        }
        val r = integer()
        val originalS = integer()
        require(offset == der.size)
        val s = if (originalS > P256_ORDER.shiftRight(1)) P256_ORDER - originalS else originalS
        fun fixed(value: BigInteger): ByteArray {
            val bytes = value.toByteArray()
            val significant = if (bytes.size == 33 && bytes[0] == 0.toByte()) bytes.copyOfRange(1, 33) else bytes
            require(significant.size <= 32)
            return ByteArray(32 - significant.size) + significant
        }
        return fixed(r) + fixed(s)
    }
}
