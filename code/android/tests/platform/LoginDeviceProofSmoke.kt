// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.participant

import org.nonverba.attestation.SigninDeviceChallenge as LoginDeviceChallenge
import org.nonverba.attestation.DeviceAttestationProof as LoginDeviceProof
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64

private fun rejected(body: () -> Unit) {
    check(runCatching(body).exceptionOrNull() is IllegalArgumentException)
}

private fun integer(value: BigInteger): ByteArray = value.toByteArray().let { byteArrayOf(2, it.size.toByte()) + it }
private fun der(r: BigInteger, s: BigInteger): ByteArray = (integer(r) + integer(s)).let { byteArrayOf(0x30, it.size.toByte()) + it }

fun main() {
    val nonce = ByteArray(32) { it.toByte() }
    val challenge = LoginDeviceChallenge(Base64.getUrlEncoder().withoutPadding().encodeToString(nonce),
        "account:one", "session:one", 7, "android", LoginDeviceProof.b64(nonce), 2_000_000_000, 2_000_000_120)
    challenge.validate(2_000_000_001)
    val expected = "NONVERBA:SIGNIN_DEVICE:v1\nAAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8\n" +
        "account:one\nsession:one\n7\nandroid\n2000000000\n2000000120\nAAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=\n"
    check(challenge.transcript().contentEquals(expected.toByteArray(Charsets.UTF_8)))
    check(challenge.copy(recoveryGeneration = LoginDeviceChallenge.MAX_SAFE_INTEGER).validate().recoveryGeneration > 0)
    rejected { challenge.copy(recoveryGeneration = LoginDeviceChallenge.MAX_SAFE_INTEGER + 1).validate() }
    rejected { challenge.copy(recoveryGeneration = -1).validate() }
    rejected { challenge.copy(accountId = "account\nother").validate() }
    rejected { challenge.copy(accountId = "a".repeat(129)).validate() }
    rejected { challenge.copy(currentSessionId = "").validate() }
    rejected { challenge.copy(platform = "browser").validate() }
    rejected { challenge.copy(challengeId = challenge.challengeId + "=").validate() }
    rejected { challenge.copy(challengeB64 = challenge.challengeB64.dropLast(1)).validate() }
    rejected { challenge.copy(challengeB64 = challenge.challengeB64.replace('8', '9')).validate() }
    rejected { challenge.copy(expiresAt = challenge.issuedAt + 121).validate() }
    rejected { challenge.copy(expiresAt = challenge.issuedAt).validate() }
    rejected { challenge.validate(challenge.expiresAt) }
    rejected { challenge.validate(challenge.issuedAt - 31) }
    rejected { challenge.copy(challengeB64 = "\n" + challenge.challengeB64).validate() }

    val one = BigInteger.ONE
    val two = BigInteger.TWO
    val raw = LoginDeviceProof.rawP256(der(one, two))
    check(raw.size == 64 && raw[31] == 1.toByte() && raw[63] == 2.toByte())
    check(raw.take(31).all { it == 0.toByte() } && raw.slice(32..62).all { it == 0.toByte() })
    check(LoginDeviceProof.rawP256(der(one, LoginDeviceProof.P256_ORDER - two)).contentEquals(raw))
    rejected { LoginDeviceProof.rawP256(der(BigInteger.ZERO, one)) }
    rejected { LoginDeviceProof.rawP256(der(one, LoginDeviceProof.P256_ORDER)) }
    rejected { LoginDeviceProof.rawP256(der(one.negate(), one)) }
    rejected { LoginDeviceProof.rawP256(byteArrayOf(0x30, 7, 2, 2, 0, 1, 2, 1, 1)) }
    rejected { LoginDeviceProof.rawP256(der(one, one) + 0) }
    rejected { LoginDeviceProof.rawP256(byteArrayOf(0x30, 6, 2, 0x80.toByte(), 1, 2, 1, 1)) }

    // Exercise a real JCA signature as well as boundary encodings. No Android or hardware claim.
    val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
    val signed = Signature.getInstance("SHA256withECDSA").run { initSign(pair.private); update(challenge.transcript()); sign() }
    val normalized = LoginDeviceProof.rawP256(signed)
    val canonicalDer = der(BigInteger(1, normalized.copyOfRange(0, 32)), BigInteger(1, normalized.copyOfRange(32, 64)))
    check(Signature.getInstance("SHA256withECDSA").run { initVerify(pair.public); update(challenge.transcript()); verify(canonicalDer) })
    check(BigInteger(1, normalized.copyOfRange(32, 64)) <= LoginDeviceProof.P256_ORDER.shiftRight(1))
    println("Login-device transcript, challenge bounds and canonical P-256 proof checks passed")
}
