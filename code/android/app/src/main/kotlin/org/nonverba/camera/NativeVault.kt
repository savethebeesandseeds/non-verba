// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.camera

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import android.webkit.JavascriptInterface
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Seals the Rust software signing identity at rest with an Android Keystore AES key.
 * The signing key is necessarily available to the trusted WASM app while running.
 * This is NOT hardware-backed signing, device attestation, or a private-key export API.
 */
class NativeVault(context: Context, private val saved: (String) -> Unit) {
    private val appContext = context.applicationContext
    private val exports = NativeArtifactExports(appContext)
    private val identityPath = File(appContext.noBackupFilesDir, "identity-v1.sealed")
    private val identityFile = AtomicFile(identityPath)
    @Volatile private var error: String? = null

    /** Null plus no lastError means first run; null plus lastError must fail closed. */
    @JavascriptInterface
    @Synchronized
    fun loadIdentity(): String? {
        error = null
        if (!identityPath.exists() && !File(identityPath.path + ".bak").exists()) return null
        return try {
            val sealed = identityFile.openRead().use { it.readBytes() }
            require(sealed.size in 30..(MAX_IDENTITY_BYTES + 29) && sealed[0] == 1.toByte())
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, wrappingKey(create = false), GCMParameterSpec(128, sealed.copyOfRange(1, 13)))
            cipher.updateAAD(AAD)
            val plaintext = cipher.doFinal(sealed.copyOfRange(13, sealed.size))
            try { plaintext.toString(Charsets.UTF_8) } finally { plaintext.fill(0) }
        } catch (_: Exception) {
            error = "The saved device identity could not be unlocked. It was preserved; do not create a replacement."
            null
        }
    }

    @JavascriptInterface
    @Synchronized
    fun saveIdentity(identityJson: String): Boolean {
        error = null
        if (identityJson.isBlank() || identityJson.length > MAX_IDENTITY_BYTES) {
            error = "Invalid device identity size."
            return false
        }
        // No implicit key rotation if storage is unreadable or the caller generated a new key.
        if (identityPath.exists() || File(identityPath.path + ".bak").exists()) {
            val existing = loadIdentity()
            if (existing == identityJson) return true
            if (error == null) error = "A different device identity is already saved."
            return false
        }
        return try {
            val plaintext = identityJson.toByteArray(Charsets.UTF_8)
            require(plaintext.size <= MAX_IDENTITY_BYTES)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, wrappingKey(create = true))
            cipher.updateAAD(AAD)
            val ciphertext = try { cipher.doFinal(plaintext) } finally { plaintext.fill(0) }
            require(cipher.iv.size == 12)
            val stream = identityFile.startWrite()
            try {
                stream.write(byteArrayOf(1) + cipher.iv + ciphertext)
                identityFile.finishWrite(stream)
            } catch (failure: Exception) {
                identityFile.failWrite(stream)
                throw failure
            }
            true
        } catch (_: Exception) {
            error = "The device identity could not be saved securely. Capture must remain disabled."
            false
        }
    }

    @JavascriptInterface
    fun lastError(): String? = error

    /** True means an exact copy was saved on this device. No sharing UI or delivery claim. */
    @JavascriptInterface
    @Synchronized
    fun saveArtifact(name: String, mime: String, base64: String): Boolean {
        error = null
        return try {
            require(mime in EXPORT_MIME_TYPES)
            val maxBytes = if (mime in WAV_MIME_TYPES) MAX_WAV_BYTES else MAX_ARTIFACT_BYTES
            require(base64.length <= ((maxBytes + 2) / 3) * 4)
            val bytes = Base64.decode(base64, Base64.NO_WRAP)
            require(bytes.isNotEmpty() && bytes.size <= maxBytes)
            val safeName = name.replace(Regex("[^A-Za-z0-9._-]"), "_").take(120)
            require(safeName.isNotBlank() && safeName != "." && safeName != "..")
            if (mime in WAV_MIME_TYPES) require(safeName.endsWith(".wav", ignoreCase = true))
            val destination = exports.save(safeName, mime, bytes)
            saved(destination)
            true
        } catch (_: Exception) {
            error = "The evidence could not be saved to device storage. The original remains available in Non-verba."
            false
        }
    }

    private fun wrappingKey(create: Boolean): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        check(create) { "Wrapping key is unavailable" }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setKeySize(256)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true)
                    .build()
            )
            generateKey()
        }
    }

    companion object {
        private const val KEY_ALIAS = "org.nonverba.camera.identity-wrap.v1"
        private const val MAX_IDENTITY_BYTES = 128 * 1024
        private const val MAX_ARTIFACT_BYTES = 32 * 1024 * 1024
        private const val MAX_WAV_BYTES = 8 * 1024 * 1024
        private val AAD = "non-verba/android-identity/v1".toByteArray(Charsets.UTF_8)
        private val WAV_MIME_TYPES = setOf("audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave")
        private val EXPORT_MIME_TYPES = setOf(
            "image/jpeg", "application/json", "application/c2pa", "application/octet-stream", "text/plain"
        ) + WAV_MIME_TYPES
    }
}
