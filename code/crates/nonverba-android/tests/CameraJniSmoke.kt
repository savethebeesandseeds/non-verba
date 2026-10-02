// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import javax.imageio.ImageIO

// JVM-only signature capability. Production uses a session-scoped Keystore key.
internal class NativeMediaEvidenceSigner(private val callback: (ByteArray) -> ByteArray) {
    fun signEvidence(message: ByteArray): ByteArray = callback(message)
}

internal fun cameraSmoke(output: File): Int {
    val now = 1_800_000_001_000L
    val nonce = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32) { 2 })
    val challenge = """{"version":1,"id":"${"02".repeat(32)}","requester":"JNI synthetic test","task":"Synthetic camera image","nonce":"$nonce","issued_at":1800000000,"expires_at":1800000900}"""
    val request = NativeCameraCore.validateRequest(challenge, "", now)
    val location = """{"latitude":47.4979,"longitude":19.0402,"accuracy_m":12,"altitude_m":null,"altitude_accuracy_m":null,"timestamp_ms":$now,"source":"device-geolocation"}"""
    val metadata = """{"version":1,"type":"nonverba-native-camera-capture","session_id":"synthetic-jni-camera","camera_id":"0","lens_facing":"back","timestamp_source":"realtime","request_received_unix_ms":$now,"callback_received_unix_ms":$now,"capture_time_origin":"monotonic-mapped-exposure","request_received_elapsed_ns":"9007199254740993","capture_requested_elapsed_ns":"9007199254741003","sensor_timestamp_ns":"9007199254741013","image_timestamp_ns":"9007199254741013","callback_received_elapsed_ns":"9007199254741033","image_received_elapsed_ns":"9007199254741043","acquired_at_unix_ms":$now,"frame_number":"2","width":640,"height":480,"jpeg_orientation_degrees":0,"zsl_requested_disabled":true,"test_pattern_requested_disabled":true,"zsl_result_enabled":null,"test_pattern_result_mode":0,"gps_origin":"caller-submitted-device-geolocation","keystore_security_level":"software","strongbox_requested":false,"strongbox_fallback":false,"exposure_time_ns":"10","sensitivity_iso":200,"focal_length_mm":4.5}"""
    val image = BufferedImage(640, 480, BufferedImage.TYPE_INT_RGB)
    for (y in 0 until 480) for (x in 0 until 640) image.setRGB(x, y, ((48 + x / 4 % 160) shl 16) or ((48 + y / 3 % 160) shl 8) or 100)
    val jpeg = ByteArrayOutputStream().apply { check(ImageIO.write(image, "jpeg", this)) }.toByteArray()
    fun key() = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
    val pair = key()
    val cert = NativeCameraCore.createCertificate(pair.public.encoded)
    val identity = NativeCameraCore.identity(cert, pair.public.encoded)
    val pin = Regex("\"fingerprint\":\"([a-f0-9]{64})\"").find(identity)!!.groupValues[1]
    var checks = 0
    fun passed(name: String) { checks++; println("PASS $name") }
    fun rejected(name: String, operation: () -> Unit) {
        var failed = false
        try { operation() } catch (_: IllegalArgumentException) { failed = true }
        check(failed) { "$name did not fail closed" }; passed(name)
    }
    var signCalls = 0
    val signer = NativeMediaEvidenceSigner { input ->
        signCalls++
        Signature.getInstance("SHA256withECDSA").run { initSign(pair.private); update(input); sign() }
    }
    fun seal(capture: String = metadata, at: Long = now, capability: NativeMediaEvidenceSigner = signer) =
        NativeCameraCore.seal(jpeg, request, location, capture, pair.public.encoded, cert, at, capability)
    check(NativeCameraCore.validateLocation(request, location, now).contains("device-geolocation"))
    passed("native camera request, location and external public certificate cross JNI")
    rejected("native camera certificate rejects a different key") { NativeCameraCore.identity(cert, key().public.encoded) }
    val result = seal()
    val signed = Base64.getDecoder().decode(Regex("\"image_base64\":\"([^\"]+)\"").find(result)!!.groupValues[1])
    check(signed.size > jpeg.size && signCalls > 0 && result.contains("native-camera2-jpeg"))
    check(result.contains("\"hardware_attested\":false") && result.contains("\"collection_attested\":false"))
    passed("native camera C2PA JPEG seals through real DER signature callback")
    val before = signCalls
    rejected("mismatched native image timestamp rejected before signing") {
        seal(metadata.replace("\"image_timestamp_ns\":\"9007199254741013\"", "\"image_timestamp_ns\":\"9007199254741012\""))
    }
    rejected("late native camera finalization rejected before signing") { seal(at = now + 30_001) }
    rejected("synthetic camera test-pattern claim rejected before signing") { seal(metadata.replace("\"test_pattern_result_mode\":0", "\"test_pattern_result_mode\":1")) }
    check(signCalls == before)
    rejected("native camera malformed signing response rejected") { seal(capability = NativeMediaEvidenceSigner { ByteArray(8) }) }
    rejected("native camera cancellation callback exception translated") { seal(capability = NativeMediaEvidenceSigner { error("cancelled camera session") }) }
    check(seal().contains("image_base64"))
    passed("camera JNI remains usable after a signing callback exception")
    File(output, "native-camera-synthetic.jpg").writeBytes(signed)
    File(output, "native-camera-synthetic-request.json").writeText(challenge)
    File(output, "native-camera-synthetic-key.txt").writeText(pin)
    return checks
}
