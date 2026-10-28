// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.identity

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONObject
import org.nonverba.attestation.AttestationKeyLock
import org.nonverba.attestation.DeviceAttestationProof
import java.io.File
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.concurrent.locks.ReentrantLock

/** Dedicated account-scoped identity-media keys. Existing aliases and partial records are never replaced. */
internal class IdentityCaptureKey(context: Context) {
    private val context = context.applicationContext
    data class Identity(val spki: ByteArray, val pin: String)
    fun identity(account: String, active: () -> Boolean): Identity = AttestationKeyLock.withAuthority(LOCK, active) {
        require(IdentityCaptureProtocol.identifier(account))
        val hash = IdentityCaptureProtocol.sha256(account.toByteArray(Charsets.UTF_8))
        val alias = PREFIX + hash
        val file = AtomicFile(File(context.noBackupFilesDir, "identity-camera-key-v1-$hash.json"))
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val exists = file.baseFile.exists() || File(file.baseFile.path + ".bak").exists()
        var record = if (exists) file.openRead().use {
            check(it.channel.size() <= 4096)
            JSONObject(it.readBytes().toString(Charsets.UTF_8))
        } else null
        if (record == null) {
            check(!store.containsAlias(alias)) { "identity_camera_record_invalid" }
            val slots = mutableSetOf<String>()
            val aliases = store.aliases()
            while (aliases.hasMoreElements()) aliases.nextElement().takeIf { it.startsWith(PREFIX) }?.let { slots.add(it.removePrefix(PREFIX)) }
            context.noBackupFilesDir.listFiles()?.forEach { entry -> RECORD.matchEntire(entry.name)?.groupValues?.get(1)?.let { slots.add(it) } }
                ?: error("identity_camera_unavailable")
            check(slots.size < 32) { "identity_camera_store_full" }
            record = JSONObject().put("version", 1).put("account_sha256", hash).put("state", "pending").put("attempted", false)
            write(file, record)
        }
        val saved = requireNotNull(record)
        check(saved.getInt("version") == 1 && saved.getString("account_sha256") == hash && saved.getString("state") in setOf("pending", "ready"))
        if (!store.containsAlias(alias)) {
            check(saved.getString("state") == "pending" && !saved.getBoolean("attempted")) { "identity_camera_record_invalid" }
            check(active())
            saved.put("attempted", true); write(file, saved)
            val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build()
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply { initialize(spec); generateKeyPair() }
        }
        val spki = requireNotNull(store.getCertificate(alias)).publicKey.encoded
        val pin = IdentityCaptureProtocol.sha256(spki)
        if (saved.getString("state") == "ready") {
            check(saved.getString("public_spki_der_b64") == DeviceAttestationProof.b64(spki) && saved.getString("public_spki_sha256") == pin)
        } else {
            saved.put("state", "ready").put("public_spki_der_b64", DeviceAttestationProof.b64(spki)).put("public_spki_sha256", pin)
            write(file, saved)
        }
        check(active())
        Identity(spki, pin)
    }
    fun sign(account: String, expectedPin: String, bytes: ByteArray, active: () -> Boolean): ByteArray =
        AttestationKeyLock.withAuthority(LOCK, active) {
            check(bytes.size in 1..16_384 && active())
            val public = identity(account, active); check(public.pin == expectedPin)
            val alias = PREFIX + IdentityCaptureProtocol.sha256(account.toByteArray(Charsets.UTF_8))
            val key = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.getKey(alias, null) as PrivateKey
            val signature = Signature.getInstance("SHA256withECDSA").run { initSign(key); update(bytes); sign() }
            check(active()); DeviceAttestationProof.rawP256(signature)
        }
    private fun write(file: AtomicFile, value: JSONObject) {
        val bytes = value.toString().toByteArray(Charsets.UTF_8); check(bytes.size <= 4096)
        val stream = file.startWrite()
        try { stream.write(bytes); file.finishWrite(stream) } catch (error: Throwable) { file.failWrite(stream); throw error }
    }
    companion object {
        private const val PREFIX = "org.nonverba.identity.capture.v1."
        private val RECORD = Regex("identity-camera-key-v1-([a-f0-9]{64})\\.json(?:\\.bak)?")
        private val LOCK = ReentrantLock()
    }
}
