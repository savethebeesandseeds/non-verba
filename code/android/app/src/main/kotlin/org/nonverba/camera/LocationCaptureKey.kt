// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/** Separate, non-exportable location capture key. No JavascriptInterface methods. */
internal class LocationCaptureKey(private val context: Context, val profile: String = "legacy", private val expectedFingerprint: String? = null) {
    private val publicRecord = AtomicFile(File(context.noBackupFilesDir, "location-capture-public-v1.spki"))

    fun publicSpki(): ByteArray = synchronized(IDENTITY_LOCK) {
        if (profile == "attested") {
            val saved = NativeAttestedKeyStore.export(context, "location", expectedFingerprint)
            check(expectedFingerprint == null || expectedFingerprint == saved.getString("fingerprint")) { "Selected location key pin changed" }
            return@synchronized android.util.Base64.decode(saved.getString("public_spki_der_b64"), android.util.Base64.NO_WRAP)
        }
        check(profile == "legacy") { "Unknown native location key profile" }
        val publicFile = publicRecord.baseFile
        val recorded = if (publicFile.exists() || File(publicFile.path + ".bak").exists()) {
            publicRecord.openRead().use { it.readBytes() }.also {
                check(it.size in 1..4096) { "Location capture public key record is invalid" }
            }
        } else null
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!store.containsAlias(ALIAS)) {
            check(recorded == null) { "The saved location capture key is unavailable; its identity was preserved" }
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
                initialize(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .build())
                generateKeyPair()
            }
        }
        val spki = requireNotNull(store.getCertificate(ALIAS)) { "Location capture key certificate is unavailable" }.publicKey.encoded
        check(expectedFingerprint == null || expectedFingerprint == NativeLocationCore.fingerprint(spki)) { "Selected location key pin changed" }
        if (recorded != null) {
            check(recorded.contentEquals(spki)) { "The location capture key differs from its saved identity" }
        } else {
            val stream = publicRecord.startWrite()
            try { stream.write(spki); publicRecord.finishWrite(stream) }
            catch (error: Throwable) { publicRecord.failWrite(stream); throw error }
        }
        spki
    }

    // Called only by the Rust JNI adapter for a validated, session-owned COSE payload.
    // Android returns DER ECDSA; Rust converts it to the COSE fixed-width signature.
    fun sign(message: ByteArray, active: () -> Boolean): ByteArray = NativeSessionGuards.withSigningAuthority(IDENTITY_LOCK, active) {
        require(message.size in 1..(RawGnssCollector.MAX_TRACE_BYTES + 16 * 1024 + 1024)) { "Invalid native evidence size" }
        if (profile == "attested") return@withSigningAuthority NativeAttestedKeyStore.sign(context, "location",
            requireNotNull(expectedFingerprint) { "Native location session has no frozen enrolled key ID" }, message, active)
        check(profile == "legacy") { "Unknown native location key profile" }
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = store.getKey(ALIAS, null) as? PrivateKey ?: error("Location capture key is unavailable")
        Signature.getInstance("SHA256withECDSA").run {
            initSign(key)
            update(message)
            sign()
        }
    }

    private companion object {
        const val ALIAS = "org.nonverba.camera.location-capture.v1"
        val IDENTITY_LOCK = Any()
    }
}

/** A per-finalization capability, held only by the native session controller. */
internal class LocationEvidenceSigner(private val key: LocationCaptureKey,
    private val afterSign: () -> Unit = {}, private val active: () -> Boolean) {
    fun signEvidence(message: ByteArray): ByteArray {
        val signature = key.sign(message, active)
        afterSign()
        return signature
    }
}
