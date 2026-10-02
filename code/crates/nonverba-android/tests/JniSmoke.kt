// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64

// Test-only substitute for the Android Keystore capability. Never packaged in the APK.
internal class LocationEvidenceSigner(private val callback: (ByteArray) -> ByteArray) {
    fun signEvidence(message: ByteArray): ByteArray = callback(message)
}

/** Exercises the production Kotlin external declarations and real Rust JNI library on the JVM.
 * This verifies marshalling, DER callback validation and exception recovery, not Android sensors
 * or Android Keystore behavior. Core tests independently cover COSE verification and tampering.
 */
fun main(args: Array<String>) {
    val start = 1_800_000_001_000L
    val end = start + 11_000
    val nonceBytes = ByteArray(32) { 1 }
    val nonce = Base64.getUrlEncoder().withoutPadding().encodeToString(nonceBytes)
    val request = """{"version":1,"type":"nonverba-location-request","challenge":{"version":1,"id":"${"01".repeat(32)}","requester":"JNI test","task":"Observe site","nonce":"$nonce","issued_at":1800000000,"expires_at":1800000900},"policy":{"profile":"native-required","required_provider":"gnss","duration_ms":10000,"min_samples":3,"max_accuracy_m":100,"max_fix_age_ms":5000,"max_delivery_delay_ms":3000,"max_speed_mps":100},"context":null}"""
    val samples = listOf(1000, 6000, 11000).mapIndexed { index, elapsed ->
        """{"sequence":$index,"observed_elapsed_ms":$elapsed,"fix_elapsed_ms":$elapsed,"fix_timestamp_ms":${start + elapsed},"provider":"gps","latitude":47.4979,"longitude":19.0402,"accuracy_m":12,"altitude_m":null,"altitude_accuracy_m":null,"mock":false}"""
    }.joinToString(",")
    val trace = """{"version":1,"type":"nonverba-location-trace","request":$request,"profile":"native-android","permission_precision":"fine","uncertainty_semantics":"android-68-percent","capture_correlation":"none","started_at_ms":$start,"ended_at_ms":$end,"elapsed_ms":11000,"samples":[$samples]}"""
    var checks = 0
    fun passed(name: String) { checks++; println("PASS $name") }
    fun rejected(name: String, operation: () -> Unit) {
        var rejected = false
        try { operation() } catch (_: IllegalArgumentException) { rejected = true }
        check(rejected) { "$name did not fail closed" }
        passed(name)
    }
    val pair = KeyPairGenerator.getInstance("EC").apply {
        initialize(ECGenParameterSpec("secp256r1"))
    }.generateKeyPair()
    val spki = pair.public.encoded
    val expectedPin = MessageDigest.getInstance("SHA-256").digest(spki).joinToString("") { "%02x".format(it) }
    check(NativeLocationCore.fingerprint(spki) == expectedPin)
    passed("SPKI fingerprint crosses JNI correctly")
    check(NativeLocationCore.validateRequest(request, start).contains("nonverba-location-request"))
    check(NativeLocationCore.validateTrace(trace, end).contains("android-68-percent"))
    passed("request and native trace validation")
    val ordinaryProgress = NativeLocationCore.rawGnssProgress(trace)
    check(ordinaryProgress.contains("\"required\":false") && ordinaryProgress.contains("\"present\":false"))
    passed("ordinary native location does not claim raw satellite evidence")
    val rawPolicy = """{"version":1,"mode":"required","min_epochs":3,"min_satellites":4,"max_epoch_gap_ms":2500,"max_time_uncertainty_ns":100000,"max_pseudorange_rate_uncertainty_mps":20}"""
    val rawRequiredTrace = trace.replace("\"max_speed_mps\":100}", "\"max_speed_mps\":100,\"raw_gnss\":$rawPolicy}")
    val missingRaw = NativeLocationCore.rawGnssProgress(rawRequiredTrace)
    check(missingRaw.contains("\"ready\":false") && missingRaw.contains("RAW_GNSS_REQUIRED"))
    check(missingRaw.contains("\"collection_action\":\"reject\""))
    rejected("raw-required native trace cannot seal without raw receiver observations") {
        NativeLocationCore.validateTrace(rawRequiredTrace, end)
    }
    rejected("raw progress rejects oversized protocol input") {
        NativeLocationCore.rawGnssProgress(" ".repeat(2 * 1024 * 1024 + 1))
    }
    rejected("malformed request rejected") { NativeLocationCore.validateRequest("{}", start) }
    rejected("mock-marked native trace rejected") { NativeLocationCore.validateTrace(trace.replace("\"mock\":false", "\"mock\":true"), end) }
    var signCalls = 0
    var lastSigningInput = ByteArray(0)
    val signer = LocationEvidenceSigner { input ->
        signCalls++
        lastSigningInput = input
        Signature.getInstance("SHA256withECDSA").run {
            initSign(pair.private); update(input); sign()
        }
    }
    fun seal(jpeg: ByteArray = ByteArray(0)) = NativeLocationCore.seal(trace, spki, jpeg, end, signer)
    val result = seal()
    val proof = Regex("\"proof_base64\":\"([^\"]+)\"").find(result)!!.groupValues[1]
    check(Base64.getDecoder().decode(proof)[0] == 0xd2.toByte())
    check(result.contains("\"media_origin\":\"none\"") && result.contains("\"hardware_attested\":false"))
    check(signCalls == 1 && lastSigningInput.toString(Charsets.UTF_8).contains("android-keystore"))
    passed("COSE tagged proof uses DER signature callback and explicit limits")
    val jpeg = byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 0xd9.toByte())
    val assetHash = MessageDigest.getInstance("SHA-256").digest(jpeg).joinToString("") { "%02x".format(it) }
    check(seal(jpeg).contains("\"media_origin\":\"webview-submitted-jpeg\""))
    check(lastSigningInput.toString(Charsets.UTF_8).contains(assetHash))
    passed("JPEG bytes hashed inside native proof boundary")
    val callsBefore = signCalls
    rejected("expired selected fix rejected before signing") { NativeLocationCore.seal(trace, spki, ByteArray(0), end + 5001, signer) }
    rejected("browser profile rejected by native entrypoint") { NativeLocationCore.seal(trace.replace("native-android", "software-browser"), spki, ByteArray(0), end, signer) }
    rejected("non-JPEG submission rejected before signing") { seal(byteArrayOf(1, 2, 3, 4)) }
    check(signCalls == callsBefore)
    rejected("invalid callback signature rejected") { NativeLocationCore.seal(trace, spki, ByteArray(0), end, LocationEvidenceSigner { ByteArray(8) }) }
    rejected("callback exception translated safely") { NativeLocationCore.seal(trace, spki, ByteArray(0), end, LocationEvidenceSigner { error("cancelled test session") }) }
    check(seal().contains("proof_base64"))
    passed("JNI remains usable after a callback exception")
    check(args.size == 2) { "Supply the shared synthetic raw GNSS trace fixture and QA output directory" }
    val rawTrace = java.io.File(args[0]).readText()
    val rawNow = 2_000_000_012_000L
    val rawProgress = NativeLocationCore.rawGnssProgress(rawTrace)
    check(rawProgress.contains("\"ready\":true") && rawProgress.contains("\"epoch_count\":11"))
    check(rawProgress.contains("\"collection_action\":\"retain\""))
    check(rawProgress.contains("\"satellite_authentication_verified\":false"))
    NativeLocationCore.validateTrace(rawTrace, rawNow)
    val rawResult = NativeLocationCore.seal(rawTrace, spki, ByteArray(0), rawNow, signer)
    val rawProof = Regex("\"proof_base64\":\"([^\"]+)\"").find(rawResult)!!.groupValues[1]
    check(lastSigningInput.toString(Charsets.UTF_8).contains("-1234567890123456789"))
    passed("raw satellite fixture crosses JNI, retains integer precision and seals with the native callback")
    rejected("changed receiver discontinuity counter is rejected through JNI") {
        NativeLocationCore.validateTrace(rawTrace.replaceFirst("\"hardware_clock_discontinuity_count\": 7", "\"hardware_clock_discontinuity_count\": 8"), rawNow)
    }
    val output = java.io.File(args[1]).apply { mkdirs() }
    java.io.File(output, "raw-gnss-synthetic-proof.json").writeText("""{"version":1,"type":"nonverba-location-proof","proof_base64":"$rawProof"}""")
    java.io.File(output, "raw-gnss-synthetic-key.txt").writeText(expectedPin)
    checks += cameraSmoke(output)
    checks += audioSmoke(output)
    println("$checks JNI smoke checks passed; Android sensors and Keystore were not exercised.")
}
