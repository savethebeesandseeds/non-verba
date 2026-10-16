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
    val attempt = "12345678-1234-1234-1234-123456789abc"
    val profile = """{"version":1,"kind":"front-back","cameras":[{"camera_id":"0","lens_facing":"back"},{"camera_id":"1","lens_facing":"front"}],"timing":{"mode":"concurrent","max_start_skew_ns":"1000"}}"""
    val setRequest = """{"version":1,"type":"nonverba-camera-set-request","challenge":$challenge,"profile":$profile,"acquisition":"native-camera2"}"""
    NativeCameraSetCore.validateRequest(setRequest, now)
    NativeCameraSetCore.validateLocation(setRequest, location, now)
    val members = (0..1).map { index ->
        val member = """{"version":1,"request":$setRequest,"attempt_id":"$attempt","camera_id":"$index"}"""
        val capture = metadata.replace("synthetic-jni-camera",attempt)
            .replace("\"camera_id\":\"0\"","\"camera_id\":\"$index\"")
            .let { if(index==1)it.replace("\"lens_facing\":\"back\"","\"lens_facing\":\"front\"") else it }
        val result = NativeCameraSetCore.seal(jpeg,member,location,capture,pair.public.encoded,cert,now,signer)
        val encoded = Regex("\"image_base64\":\"([^\"]+)\"").find(result)!!.groupValues[1]
        passed("camera-set member $index seals through production JNI")
        """{"camera_id":"$index","jpeg_b64":"$encoded"}"""
    }
    val member = """{"version":1,"request":$setRequest,"attempt_id":"$attempt","camera_id":"0"}"""
    rejected("camera-set JNI refuses metadata from another attempt") {
        NativeCameraSetCore.seal(jpeg,member,location,metadata,pair.public.encoded,cert,now,signer)
    }
    rejected("camera-set JNI refuses expired original request") {NativeCameraSetCore.validateRequest(setRequest,now+900_000)}
    rejected("camera-set JNI cannot sign after native capability revocation") {
        NativeCameraSetCore.seal(jpeg,member,location,metadata.replace("synthetic-jni-camera",attempt),pair.public.encoded,cert,now,
            NativeMediaEvidenceSigner {error("camera-set authority revoked")})
    }
    File(output,"camera-set-synthetic-request.json").writeText(setRequest)
    File(output,"camera-set-synthetic-bundle.json").writeText("""{"version":1,"type":"nonverba-camera-set-bundle","request":$setRequest,"attempt_id":"$attempt","images":[${members.joinToString(",")}] }""")
    File(output,"camera-set-synthetic-key.txt").writeText(pin)
    val sequentialRequest=setRequest.replace("\"mode\":\"concurrent\",\"max_start_skew_ns\":\"1000\"", "\"mode\":\"sequential\"")
    NativeCameraSetCore.validateRequest(sequentialRequest,now)
    val sequentialMembers=(0..1).map {index ->
        val member="""{"version":1,"request":$sequentialRequest,"attempt_id":"$attempt","camera_id":"$index"}"""
        val capture=metadata.replace("synthetic-jni-camera",attempt)
            .replace("\"camera_id\":\"0\"","\"camera_id\":\"$index\"")
            .let {if(index==1)it.replace("\"lens_facing\":\"back\"","\"lens_facing\":\"front\"").replace("9007199254741013","9007199254741014") else it}
        val sealed=NativeCameraSetCore.seal(jpeg,member,location,capture,pair.public.encoded,cert,now,signer)
        val encoded=Regex("\"image_base64\":\"([^\"]+)\"").find(sealed)!!.groupValues[1]
        passed("sequential camera-set member $index seals through production JNI")
        """{"camera_id":"$index","jpeg_b64":"$encoded"}"""
    }
    File(output,"camera-set-sequential-request.json").writeText(sequentialRequest)
    File(output,"camera-set-sequential-bundle.json").writeText("""{"version":1,"type":"nonverba-camera-set-bundle","request":$sequentialRequest,"attempt_id":"$attempt","images":[${sequentialMembers.joinToString(",")}] }""")
    return checks
}
