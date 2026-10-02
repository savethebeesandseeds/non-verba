// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import java.io.File
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec

// Test-only JCA fixture; production Keystore and physical sensors are not exercised.
internal class LocationEvidenceSigner(private val callback: (ByteArray) -> ByteArray) {
    fun signEvidence(message: ByteArray): ByteArray = callback(message)
}

fun main(args: Array<String>) {
    val snapshot = File(args[0]).readText()
    val output = File(args[1])
    val now = Regex("\"ended_at_ms\":([0-9]+)").find(snapshot)!!.groupValues[1].toLong() + 10
    val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
    var calls = 0
    val signer = LocationEvidenceSigner { input ->
        calls++
        val claims = input.toString(Charsets.UTF_8)
        check(claims.contains("org.nonverba.gps-attempt.v1") && claims.contains("nonverba-gps-attempt-report"))
        Signature.getInstance("SHA256withECDSA").run { initSign(pair.private); update(input); sign() }
    }
    val result = NativeLocationCore.sealAttempt(snapshot, pair.public.encoded, now, signer)
    check(calls == 1 && result.contains("report_base64"))
    File(output,"jni-report.json").writeText(result)
    File(output,"jni-key.txt").writeText(NativeLocationCore.fingerprint(pair.public.encoded))
    fun reject(fn: () -> Unit) { check(runCatching(fn).isFailure) }
    reject { NativeLocationCore.sealAttempt(snapshot, pair.public.encoded, now, LocationEvidenceSigner { error("Key unavailable") }) }
    reject { NativeLocationCore.sealAttempt(snapshot, pair.public.encoded, now, LocationEvidenceSigner { ByteArray(64) }) }
    reject { NativeLocationCore.sealAttempt(snapshot.replace("\"stopping_stage\":\"collecting\"", "\"stopping_stage\":\"cancelled\""), pair.public.encoded, now, signer) }
    check(calls == 1)
    println("5 GPS attempt JNI checks passed; synthetic JCA signer, no Android sensors or Keystore")
}
