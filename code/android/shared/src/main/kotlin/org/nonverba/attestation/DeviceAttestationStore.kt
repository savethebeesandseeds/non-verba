// SPDX-License-Identifier: AGPL-3.0-only
package org.nonverba.attestation

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.concurrent.locks.ReentrantLock

/**
 * Native tool mechanism. The initial supported profile is fixed sign-in possession, not arbitrary signing.
 * No account service, WebView, policy verdict, key retirement or sensor permission is owned here.
 */
internal class DeviceAttestationStore(context: Context) {
    private val context = context.applicationContext

    fun prove(challenge: SigninDeviceChallenge, active: () -> Boolean): JSONObject {
        challenge.validate(now())
        return AttestationKeyLock.withAuthority(STORE_LOCK, active) { proofLocked(challenge, active) }
    }

    private fun requireActive(active: () -> Boolean) {
        if (!active()) throw AttestationFailure("attestation_cancelled")
    }

    private fun proofLocked(challenge: SigninDeviceChallenge, active: () -> Boolean): JSONObject {
        requireActive(active)
        val accountHash = sha256(challenge.accountId.toByteArray(Charsets.UTF_8))
        val alias = ALIAS_PREFIX + accountHash
        val record = AtomicFile(File(context.noBackupFilesDir, "$RECORD_PREFIX$accountHash.json"))
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        var saved = try { read(record) } catch (_: Exception) { throw AttestationFailure("attestation_record_invalid") }
        if (saved == null) {
            // Existing aliases and missing metadata never authorize replacement.
            if (store.containsAlias(alias)) throw AttestationFailure("attestation_record_invalid")
            requireCapacity(store)
            saved = JSONObject().put("version", 1).put("account_id", challenge.accountId).put("alias", alias)
                .put("state", "pending").put("original_challenge", challenge.json())
                .put("generation_attempted", false)
                .put("strongbox_requested", Build.VERSION.SDK_INT >= 28 &&
                    context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE))
                .put("strongbox_fallback", false)
            requireActive(active)
            write(record, saved)
        }
        try { validateRecord(saved, challenge.accountId, alias) }
        catch (_: Exception) { throw AttestationFailure("attestation_record_invalid") }
        if (saved.getString("state") == "pending") {
            if (!store.containsAlias(alias) && saved.getBoolean("generation_attempted"))
                throw AttestationFailure("attestation_record_invalid")
            if (!store.containsAlias(alias)) {
                requireActive(active)
                val original = parseChallenge(saved.getJSONObject("original_challenge")).validate(now())
                saved.put("generation_attempted", true)
                write(record, saved)
                requireActive(active)
                val nonce = DeviceAttestationProof.challengeBytes(original.challengeB64)
                if (Build.VERSION.SDK_INT >= 28 && saved.getBoolean("strongbox_requested")) {
                    try { generate(alias, nonce, true) }
                    catch (_: StrongBoxUnavailableException) {
                        check(!store.containsAlias(alias))
                        requireActive(active)
                        saved.put("strongbox_fallback", true)
                        write(record, saved)
                        requireActive(active)
                        generate(alias, nonce, false)
                    }
                } else generate(alias, nonce, false)
            }
            requireActive(active)
            val material = material(store, alias)
            saved.put("state", "ready").put("public_spki_der_b64", DeviceAttestationProof.b64(material.spki))
                .put("certificates_der_b64", JSONArray(material.certificates.map(DeviceAttestationProof::b64)))
            requireActive(active)
            write(record, saved)
        }
        requireActive(active)
        val material = material(store, alias)
        try {
            check(saved.getString("public_spki_der_b64") == DeviceAttestationProof.b64(material.spki))
            val recorded = saved.getJSONArray("certificates_der_b64")
            check(recorded.length() == material.certificates.size)
            material.certificates.forEachIndexed { index, bytes ->
                check(recorded.getString(index) == DeviceAttestationProof.b64(bytes))
            }
        } catch (_: Exception) { throw AttestationFailure("attestation_record_invalid") }
        val privateKey = store.getKey(alias, null) as? PrivateKey ?: throw AttestationFailure("attestation_unavailable")
        val transcript = challenge.transcript()
        requireActive(active)
        val signature = Signature.getInstance("SHA256withECDSA").run {
            initSign(privateKey); update(transcript); sign()
        }
        requireActive(active)
        // Chain bytes are key-generation evidence, never a local hardware verdict or a fresh-state claim.
        val chain = if (material.certificates.size >= 2) JSONObject().put("version", 1)
            .put("certificates_der_b64", JSONArray(material.certificates.map(DeviceAttestationProof::b64))) else JSONObject.NULL
        return JSONObject().put("public_spki_der_b64", DeviceAttestationProof.b64(material.spki))
            .put("signature_b64", DeviceAttestationProof.b64(DeviceAttestationProof.rawP256(signature)))
            .put("attestation_chain", chain).put("name", deviceName()).put("platform", "android")
    }

    private data class Material(val spki: ByteArray, val certificates: List<ByteArray>)

    private fun material(store: KeyStore, alias: String): Material {
        val chain = store.getCertificateChain(alias) ?: throw AttestationFailure("attestation_unavailable")
        check(chain.size in 1..8)
        val certificates = chain.map { it.encoded }
        check(certificates.all { it.size in 1..32 * 1024 } && certificates.sumOf { it.size } <= 96 * 1024)
        check(certificates.map(::sha256).distinct().size == certificates.size)
        val key = chain.first().publicKey as? ECPublicKey ?: throw AttestationFailure("attestation_unavailable")
        check(key.params.order == DeviceAttestationProof.P256_ORDER && key.params.curve.field.fieldSize == 256 && key.params.cofactor == 1)
        return Material(key.encoded.also { check(it.size in 1..128) }, certificates)
    }

    private fun generate(alias: String, challenge: ByteArray, strongBox: Boolean) {
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256).setAttestationChallenge(challenge)
        if (Build.VERSION.SDK_INT >= 28 && strongBox) spec.setIsStrongBoxBacked(true)
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
            initialize(spec.build()); generateKeyPair()
        }
    }

    private fun validateRecord(saved: JSONObject, account: String, alias: String) {
        val base = arrayOf("version", "account_id", "alias", "state", "original_challenge", "generation_attempted",
            "strongbox_requested", "strongbox_fallback")
        val state = saved.opt("state")
        check(state == "pending" || state == "ready")
        check(if (state == "ready") saved.only(*base, "public_spki_der_b64", "certificates_der_b64") else saved.only(*base))
        check(saved.opt("version") == 1 && saved.opt("account_id") == account && saved.opt("alias") == alias)
        check(parseChallenge(saved.getJSONObject("original_challenge")).validate().accountId == account)
        check(saved.opt("generation_attempted") is Boolean && saved.opt("strongbox_requested") is Boolean && saved.opt("strongbox_fallback") is Boolean)
        check(state != "ready" || saved.getBoolean("generation_attempted"))
        check(!saved.getBoolean("strongbox_fallback") || saved.getBoolean("strongbox_requested"))
    }

    private fun requireCapacity(store: KeyStore) {
        val accounts = mutableSetOf<String>()
        val pattern = Regex("^$RECORD_PREFIX([0-9a-f]{64})\\.json(?:\\.bak)?$")
        val files = context.noBackupFilesDir.listFiles() ?: throw AttestationFailure("attestation_unavailable")
        files.forEach { pattern.matchEntire(it.name)?.groupValues?.get(1)?.let(accounts::add) }
        val aliases = store.aliases()
        while (aliases.hasMoreElements()) {
            val alias = aliases.nextElement()
            if (alias.startsWith(ALIAS_PREFIX)) accounts.add(alias.removePrefix(ALIAS_PREFIX))
        }
        if (accounts.size >= 32) throw AttestationFailure("attestation_store_full")
    }

    private fun read(file: AtomicFile): JSONObject? {
        if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) return null
        return file.openRead().use {
            check(it.channel.size() in 1..RESPONSE_LIMIT.toLong())
            JSONObject(it.readBytes().toString(Charsets.UTF_8))
        }
    }

    private fun write(file: AtomicFile, saved: JSONObject) {
        val bytes = saved.toString().toByteArray(Charsets.UTF_8)
        check(bytes.size in 1..RESPONSE_LIMIT)
        val stream = file.startWrite()
        try { stream.write(bytes); file.finishWrite(stream) }
        catch (error: Throwable) { file.failWrite(stream); throw error }
    }

    companion object {
        // This namespace is an on-device compatibility contract; extraction does not rotate identities.
        private const val ALIAS_PREFIX = "org.nonverba.participant.login-device.v1."
        private const val RECORD_PREFIX = "login-device-v1-"
        const val RESPONSE_LIMIT = 192 * 1024
        private val STORE_LOCK = ReentrantLock()

        fun parseChallenge(input: JSONObject): SigninDeviceChallenge {
            require(input.only("challenge_id", "account_id", "current_session_id", "recovery_generation", "platform",
                "challenge_b64", "issued_at", "expires_at"))
            fun string(name: String): String = input.opt(name) as? String ?: error("Invalid sign-in challenge")
            fun integer(name: String): Long = when (val number = input.opt(name)) {
                is Int -> number.toLong()
                is Long -> number
                else -> error("Invalid sign-in challenge integer")
            }
            return SigninDeviceChallenge(string("challenge_id"), string("account_id"), string("current_session_id"),
                integer("recovery_generation"), string("platform"), string("challenge_b64"), integer("issued_at"), integer("expires_at"))
        }

        fun deviceName(): String {
            val label = "${Build.MANUFACTURER.orEmpty()} ${Build.MODEL.orEmpty()}".replace(Regex("[\\p{Cc}\\p{Cf}\\s]+"), " ").trim()
            return label.take(80).let { value ->
                var bounded = value
                while (bounded.toByteArray(Charsets.UTF_8).size > 80) bounded = bounded.dropLast(1)
                bounded.ifEmpty { "Android device" }
            }
        }

        private fun SigninDeviceChallenge.json(): JSONObject = JSONObject().put("challenge_id", challengeId)
            .put("account_id", accountId).put("current_session_id", currentSessionId).put("recovery_generation", recoveryGeneration)
            .put("platform", platform).put("challenge_b64", challengeB64).put("issued_at", issuedAt).put("expires_at", expiresAt)

        private fun now() = System.currentTimeMillis() / 1000
        private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        private fun JSONObject.only(vararg names: String): Boolean = length() == names.size && keys().asSequence().all { it in names }
    }
}
