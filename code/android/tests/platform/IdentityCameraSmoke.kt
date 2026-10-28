// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.identity

import org.nonverba.attestation.DeviceAttestationProof
import org.nonverba.camera.NativeCameraLensPolicy
import org.nonverba.camera.NativeCameraWorkQueue
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import javax.imageio.ImageIO
import java.util.concurrent.CountDownLatch
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit

private fun refuses(block: () -> Unit) { check(runCatching(block).isFailure) }
fun main(args: Array<String>) {
    check(args.size == 1)
    val worker = NativeCameraWorkQueue.create()
    val entered = CountDownLatch(1); val release = CountDownLatch(1); val finished = CountDownLatch(2)
    try {
        worker.execute { entered.countDown(); release.await(); finished.countDown() }
        check(entered.await(5, TimeUnit.SECONDS))
        worker.execute { finished.countDown() }
        check(worker.queue.size == 1)
        check(runCatching { worker.execute { error("An excess JPEG must not execute") } }.exceptionOrNull() is RejectedExecutionException)
        check(worker.queue.size == 1)
        release.countDown(); check(finished.await(5, TimeUnit.SECONDS))
        worker.shutdown(); check(worker.awaitTermination(5, TimeUnit.SECONDS)); check(worker.queue.isEmpty())
        check(runCatching { worker.execute {} }.exceptionOrNull() is RejectedExecutionException)
    } finally { release.countDown(); worker.shutdownNow() }
    val document = "https://appassets.androidplatform.net/assets/participant/index.html"
    val origin = "https://appassets.androidplatform.net"
    check(IdentityCameraDocumentAccess.allows(document, document, origin, true, false, false, true) { error("Revocation must not ask for foreground authority") })
    check(!IdentityCameraDocumentAccess.allows(document, document, origin, true, false, false, false) { true })
    check(IdentityCameraDocumentAccess.allows(document, document, origin, true, true, false, false) { true })
    for (closed in listOf(false, true)) for (mainFrame in listOf(false, true)) {
        if (closed || !mainFrame) check(!IdentityCameraDocumentAccess.allows(document, document, origin, mainFrame, true, closed, true) { true })
    }
    check(!IdentityCameraDocumentAccess.allows(document, document + "?changed", origin, true, true, false, true) { true })
    check(!IdentityCameraDocumentAccess.allows(document, document, "https://foreign.invalid", true, true, false, true) { true })
    val now = 1_792_750_000_000L
    val key = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
    val pin = IdentityCaptureProtocol.sha256(key.public.encoded)
    val opaque = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32) { 7 })
    val request = linkedMapOf<String, Any?>("version" to 1, "purpose" to "identity-capture", "challenge_id" to opaque,
        "nonce" to java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32) { 9 }),
        "account_id" to "account:synthetic", "principal_id" to "principal:synthetic", "current_session_id" to "session:synthetic",
        "recovery_generation" to 0, "kind" to "document_front", "source" to "native-camera2", "public_spki_sha256" to pin,
        "issued_at_ms" to now, "capture_expires_at_ms" to now + 120_000, "submit_expires_at_ms" to now + 900_000)
    IdentityCaptureProtocol.request(request, now, pin)
    for ((field, value) in listOf("purpose" to "signin-device", "source" to "browser-camera", "kind" to "arbitrary",
        "public_spki_sha256" to "0".repeat(64), "recovery_generation" to -1, "nonce" to "invalid")) {
        refuses { IdentityCaptureProtocol.request(request + (field to value), now, pin) }
    }
    refuses { IdentityCaptureProtocol.request(request + ("extra" to true), now, pin) }
    refuses { IdentityCaptureProtocol.window(request, now + 120_000) }
    refuses { IdentityCaptureProtocol.canonical(mapOf("fraction" to 1.5)) }
    check(IdentityCaptureProtocol.canonical(mapOf("z" to 2, "a" to mapOf("b" to "\n\"", "a" to false))) == "{\"a\":{\"a\":false,\"b\":\"\\n\\\"\"},\"z\":2}")
    check(IdentityCaptureProtocol.lens("document_front") == "back" && IdentityCaptureProtocol.lens("face_front") == "front")
    check(NativeCameraLensPolicy.allows(null, "external") && NativeCameraLensPolicy.allows("front", "front"))
    check(listOf("back", "external").none { NativeCameraLensPolicy.allows("front", it) })
    check(listOf("front", "external").none { NativeCameraLensPolicy.allows("back", it) })
    refuses { NativeCameraLensPolicy.allows("external", "external") }

    val acquisition = linkedMapOf<String, Any?>("version" to 1, "timestamp_source" to "realtime",
        "request_elapsed_realtime_ns" to "1000000000", "image_received_elapsed_realtime_ns" to "1600000000",
        "result_received_elapsed_realtime_ns" to "1500000000", "sensor_timestamp_ns" to "1200000000", "image_timestamp_ns" to "1200000000",
        "zsl_requested_disabled" to true, "test_pattern_requested_disabled" to true, "zsl_result_enabled" to false,
        "test_pattern_result_mode" to 0)
    IdentityCaptureProtocol.acquisition(acquisition)
    IdentityCaptureProtocol.acquisition(acquisition + ("timestamp_source" to "unknown"))
    for ((field, value) in listOf("request_elapsed_realtime_ns" to "01", "image_timestamp_ns" to "1200000001",
        "image_received_elapsed_realtime_ns" to "16000000001", "result_received_elapsed_realtime_ns" to "1199999999",
        "zsl_result_enabled" to true, "test_pattern_result_mode" to 1)) refuses {
        IdentityCaptureProtocol.acquisition(acquisition + (field to value))
    }
    refuses { IdentityCaptureProtocol.acquisition(acquisition + ("timestamp_source" to "unknown") + ("result_received_elapsed_realtime_ns" to "16000000001")) }

    val jpeg = ByteArrayOutputStream().also { check(ImageIO.write(BufferedImage(320, 240, BufferedImage.TYPE_INT_RGB), "jpeg", it)) }.toByteArray()
    fun segment(marker: Int, bytes: ByteArray) = byteArrayOf(0xff.toByte(), marker.toByte(), ((bytes.size + 2) / 256).toByte(), ((bytes.size + 2) % 256).toByte()) + bytes
    val exif = byteArrayOf(69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0)
    val annotated = jpeg.copyOfRange(0, 2) + segment(0xe1, exif) + segment(0xeb, "synthetic C2PA".toByteArray()) +
        segment(0xfe, "synthetic metadata".toByteArray()) + jpeg.copyOfRange(2, jpeg.size)
    check(IdentityJpegPolicy.orientation(annotated) == 6)
    val clean = IdentityJpegPolicy.sanitize(annotated)
    check(IdentityJpegPolicy.orientation(clean) == 1)
    val decoded = ImageIO.read(clean.inputStream()); check(decoded.width == 320 && decoded.height == 240)
    check(!clean.toString(Charsets.ISO_8859_1).contains("Exif") && !clean.toString(Charsets.ISO_8859_1).contains("C2PA"))
    check(IdentityJpegPolicy.sanitize(clean).contentEquals(clean))
    refuses { IdentityJpegPolicy.sanitize(clean + byteArrayOf(0)) }
    refuses { IdentityJpegPolicy.sanitize(clean.copyOf(clean.size - 1)) }
    val payload = linkedMapOf<String, Any?>("request" to request, "image_sha256" to IdentityCaptureProtocol.sha256(clean),
        "image_bytes" to clean.size, "width" to 320, "height" to 240, "captured_at_ms" to now + 200,
        "lens_facing" to "back", "acquisition" to acquisition)
    val bytes = IdentityCaptureProtocol.signingBytes(payload)
    val der = Signature.getInstance("SHA256withECDSA").run { initSign(key.private); update(bytes); sign() }
    val raw = DeviceAttestationProof.rawP256(der)
    fun verify(unsigned: Map<String, Any?>) = Signature.getInstance("SHA256withECDSAinP1363Format").run {
        initVerify(key.public); update(IdentityCaptureProtocol.signingBytes(unsigned)); verify(raw)
    }
    check(verify(payload))
    for ((field, value) in listOf("account_id" to "account:other", "current_session_id" to "session:other", "recovery_generation" to 1,
        "kind" to "face_front", "source" to "browser-camera", "nonce" to java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32) { 8 }))) {
        check(!verify(payload + ("request" to request + (field to value))))
    }
    check(!verify(payload + ("image_sha256" to "0".repeat(64))))
    val proof = mapOf("payload" to payload, "public_spki_der_b64" to DeviceAttestationProof.b64(key.public.encoded), "signature_b64" to DeviceAttestationProof.b64(raw))
    val fixture = mapOf("type" to "synthetic-jca-identity-capture", "hardware_attested" to false, "now_ms" to now + 1000,
        "proof" to proof, "image_base64" to DeviceAttestationProof.b64(clean))
    Files.writeString(Path.of(args[0]), IdentityCaptureProtocol.canonical(fixture) + "\n", StandardOpenOption.CREATE_NEW)
    println("PASS bounded native worker, exact document/revocation guard, identity profile, canonical/JCA context, native timing, required lens and JPEG metadata bounds; synthetic interoperability fixture: " + args[0])
}
