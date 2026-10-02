// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.AtomicFile
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/** Separate native media key; neither the web software identity nor location key is changed. */
internal class NativeMediaCaptureKey(private val context: Context, val profile: String = "legacy", private val expectedFingerprint: String? = null) {
    data class PublicIdentity(
        val spki: ByteArray,
        val certificatePem: String,
        val fingerprint: String,
        val securityLevel: String,
        val strongBoxRequested: Boolean,
        val strongBoxFallback: Boolean
    )

    private val record = AtomicFile(File(context.noBackupFilesDir, "native-media-capture-identity-v1.json"))

    fun publicIdentity(): PublicIdentity = synchronized(IDENTITY_LOCK) {
        if (profile == "attested") {
            val saved = NativeAttestedKeyStore.export(context, "media", expectedFingerprint)
            val pin = saved.getString("fingerprint")
            check(expectedFingerprint == null || expectedFingerprint == pin) { "Selected media key pin changed" }
            return@synchronized PublicIdentity(Base64.decode(saved.getString("public_spki_der_b64"), Base64.NO_WRAP),
                saved.getString("certificate_pem"), pin, saved.getString("security_level"),
                saved.getBoolean("strongbox_requested"), saved.getBoolean("strongbox_fallback"))
        }
        check(profile == "legacy") { "Unknown native media key profile" }
        val exists = record.baseFile.exists() || File(record.baseFile.path + ".bak").exists()
        val saved = if (exists) record.openRead().use {
            check(it.channel.size() <= MAX_RECORD_BYTES) { "Native media identity record is too large" }
            val bytes = it.readBytes()
            JSONObject(bytes.toString(Charsets.UTF_8))
        } else null
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val strongBoxRequested = saved?.getBoolean("strongbox_requested")
            ?: (Build.VERSION.SDK_INT >= 28 && context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE))
        var strongBoxFallback = saved?.getBoolean("strongbox_fallback") ?: false
        if (!store.containsAlias(ALIAS)) {
            check(saved == null) { "The enrolled native media signing key is unavailable; its identity was preserved" }
            if (Build.VERSION.SDK_INT >= 28 && strongBoxRequested) {
                try { generate(true) }
                catch (unavailable: StrongBoxUnavailableException) {
                    // Only unavailable StrongBox permits a fallback; preserve any partial key.
                    check(!store.containsAlias(ALIAS)) { "StrongBox failed after creating a key; automatic replacement is forbidden" }
                    strongBoxFallback = true
                    generate(false)
                }
            } else {
                generate(false)
            }
        } else {
            // Reissuing a C2PA certificate changes its pin even with the same public key.
            check(saved != null) { "The native media certificate record is missing; automatic identity replacement is forbidden" }
        }
        val spki = requireNotNull(store.getCertificate(ALIAS)) { "Native media public key is unavailable" }.publicKey.encoded
        val certificate = if (saved == null) NativeCameraCore.createCertificate(spki) else {
            check(saved.getInt("version") == 1) { "Unsupported native media identity record" }
            val recordedSpki = Base64.decode(saved.getString("public_spki_b64"), Base64.NO_WRAP)
            check(recordedSpki.contentEquals(spki)) { "Native media signing key differs from its enrolled identity" }
            saved.getString("certificate_pem")
        }
        val identity = JSONObject(NativeCameraCore.identity(certificate, spki))
        val fingerprint = identity.getString("fingerprint")
        check(expectedFingerprint == null || expectedFingerprint == fingerprint) { "Selected media key pin changed" }
        val privateKey = store.getKey(ALIAS, null) as? PrivateKey ?: error("Native media signing key is unavailable")
        val level = securityLevel(privateKey)
        if (saved == null) {
            val encoded = JSONObject().put("version", 1)
                .put("public_spki_b64", Base64.encodeToString(spki, Base64.NO_WRAP))
                .put("certificate_pem", certificate).put("fingerprint", fingerprint)
                .put("strongbox_requested", strongBoxRequested).put("strongbox_fallback", strongBoxFallback)
                .toString().toByteArray(Charsets.UTF_8)
            check(encoded.size <= MAX_RECORD_BYTES) { "Native media identity record exceeds its size limit" }
            val stream = record.startWrite()
            try { stream.write(encoded); record.finishWrite(stream) }
            catch (error: Throwable) { record.failWrite(stream); throw error }
        } else {
            check(saved.getString("fingerprint") == fingerprint) { "Native media certificate fingerprint changed" }
        }
        PublicIdentity(spki, certificate, fingerprint, level, strongBoxRequested, strongBoxFallback)
    }

    private fun generate(strongBox: Boolean) {
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
        if (Build.VERSION.SDK_INT >= 28 && strongBox) spec.setIsStrongBoxBacked(true)
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
            initialize(spec.build())
            generateKeyPair()
        }
    }

    @Suppress("DEPRECATION")
    private fun securityLevel(privateKey: PrivateKey): String {
        val info = KeyFactory.getInstance(privateKey.algorithm, "AndroidKeyStore").getKeySpec(privateKey, KeyInfo::class.java)
        if (Build.VERSION.SDK_INT >= 31) return when (info.securityLevel) {
            KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
            KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "trusted-environment"
            KeyProperties.SECURITY_LEVEL_SOFTWARE -> "software"
            KeyProperties.SECURITY_LEVEL_UNKNOWN_SECURE -> "hardware-unspecified"
            else -> "unknown"
        }
        return if (info.isInsideSecureHardware) "hardware-unspecified" else "software"
    }

    fun sign(message: ByteArray, active: () -> Boolean): ByteArray = NativeSessionGuards.withSigningAuthority(IDENTITY_LOCK, active) {
        require(message.size in 1..(256 * 1024)) { "Native media signing input is out of bounds" }
        if (profile == "attested") return@withSigningAuthority NativeAttestedKeyStore.sign(context, "media",
            requireNotNull(expectedFingerprint) { "Native media session has no frozen enrolled key ID" }, message, active)
        check(profile == "legacy") { "Unknown native media key profile" }
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = store.getKey(ALIAS, null) as? PrivateKey ?: error("Native media signing key is unavailable")
        Signature.getInstance("SHA256withECDSA").run {
            initSign(key)
            update(message)
            sign()
        }
    }

    private companion object {
        const val ALIAS = "org.nonverba.camera.native-media-capture.v1"
        const val MAX_RECORD_BYTES = 96 * 1024
        val IDENTITY_LOCK = Any()
    }
}

/** Per-session capability consumed only by Rust's validated C2PA sealing path. */
internal class NativeMediaEvidenceSigner(private val key: NativeMediaCaptureKey, private val active: () -> Boolean) {
    fun signEvidence(message: ByteArray): ByteArray {
        return key.sign(message, active)
    }
}
