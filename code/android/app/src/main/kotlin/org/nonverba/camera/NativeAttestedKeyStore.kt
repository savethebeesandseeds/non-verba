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
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/** Immutable, separately challenged keys. Existing aliases and pins are never migrated. */
internal object NativeAttestedKeyStore {
    private val lock = Any()
    private const val MAX_RECORD = 256 * 1024
    data class Selection(val profile: String, val fingerprint: String?)
    private data class Generation(val record: AtomicFile, val alias: String, val challengeHash: String?)

    fun purpose(value: String): String {
        require(value == "media" || value == "location") { "Unknown key purpose" }
        return value
    }

    fun challenge(value: String): ByteArray {
        require(value.length == 44) { "Enrollment challenge must contain exactly 32 bytes" }
        val decoded = Base64.decode(value, Base64.NO_WRAP)
        require(decoded.size == 32 && b64(decoded) == value) { "Enrollment challenge must use canonical standard Base64" }
        return decoded
    }

    fun selection(context: Context, purpose: String): Selection = synchronized(lock) {
        val saved = read(profileRecord(context, purpose(purpose))) ?: return@synchronized Selection("legacy", null)
        check(saved.getInt("version") == 1 && saved.getString("purpose") == purpose) { "Invalid key profile record" }
        val profile = saved.getString("key_profile")
        check(profile == "legacy" || profile == "attested") { "Unsupported key profile" }
        Selection(profile, saved.getString("fingerprint").also { check(it.length in 1..256) { "Invalid selected key pin" } })
    }

    fun mediaKey(context: Context): NativeMediaCaptureKey = selection(context, "media").let {
        NativeMediaCaptureKey(context, it.profile, it.fingerprint)
    }

    fun locationKey(context: Context): LocationCaptureKey = selection(context, "location").let {
        LocationCaptureKey(context, it.profile, it.fingerprint)
    }

    fun select(context: Context, purpose: String, profile: String, expected: String, active: () -> Boolean): JSONObject {
        purpose(purpose)
        require(profile == "legacy" || profile == "attested") { "Unknown key profile" }
        require(expected.length in 1..256) { "The exact independently displayed key pin is required" }
        check(active()) { "Key selection requires the foreground application" }
        // Resolve public identities outside the enrollment lock: media signing holds its
        // identity lock before entering this store, so the reverse order is forbidden.
        val actual = if (purpose == "media") NativeMediaCaptureKey(context, profile, expected).publicIdentity().fingerprint
            else NativeLocationCore.fingerprint(LocationCaptureKey(context, profile, expected).publicSpki())
        check(actual == expected) { "Key pin differs from the selected credential" }
        return synchronized(lock) {
            check(active()) { "Key selection was cancelled" }
            write(profileRecord(context, purpose), JSONObject().put("version", 1).put("purpose", purpose)
                .put("key_profile", profile).put("fingerprint", actual))
            check(active()) { "The application left the foreground during key selection; inspect the selected profile" }
            JSONObject().put("ok", true).put("purpose", purpose).put("key_profile", profile).put("fingerprint", actual)
        }
    }

    fun enroll(context: Context, purpose: String, challengeB64: String, active: () -> Boolean): JSONObject = synchronized(lock) {
        purpose(purpose)
        val challenge = challenge(challengeB64)
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val known = generations(context, purpose)
        val catalog = catalog(known, purpose)
        val existing = NativeEnrollmentCatalog.byChallenge(catalog, challengeB64)
        val generation = existing?.let { known.single { generation -> generation.alias == it.id } }
            ?: newGeneration(context, purpose, sha256(challenge))
        val record = generation.record
        val alias = generation.alias
        var saved = readGeneration(generation, purpose)
        check(active()) { "Enrollment was cancelled or exceeded its foreground lifetime" }
        if (saved != null) {
            check(saved.getString("challenge_b64") == challengeB64) { "Enrollment challenge differs from its immutable record" }
            if (saved.getString("state") == "ready") return@synchronized exportGenerationLocked(purpose, generation)
            check(saved.getString("state") == "pending") { "Invalid enrollment state" }
            check(store.containsAlias(alias) || !saved.getBoolean("generation_attempted")) {
                "A previous key generation attempt failed without a recoverable key; automatic retry is forbidden"
            }
        } else {
            check(!store.containsAlias(alias)) { "The enrollment record is missing; the existing key was preserved" }
            NativeEnrollmentCatalog.requireCapacity(slotCount(known, purpose, store))
            saved = JSONObject().put("version", 1).put("purpose", purpose).put("state", "pending")
                .put("challenge_b64", challengeB64).put("generation_attempted", false)
                .put("strongbox_requested", Build.VERSION.SDK_INT >= 28 && context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE))
                .put("strongbox_fallback", false)
            write(record, saved)
        }
        val pending = saved
        if (!store.containsAlias(alias)) {
            check(active()) { "Enrollment was cancelled" }
            pending.put("generation_attempted", true)
            write(record, pending) // A failed generation must not silently create another identity later.
            if (Build.VERSION.SDK_INT >= 28 && pending.getBoolean("strongbox_requested")) {
                try { generate(alias, challenge, true) }
                catch (unavailable: StrongBoxUnavailableException) {
                    check(!store.containsAlias(alias)) { "StrongBox created a partial key; automatic replacement is forbidden" }
                    check(active()) { "Enrollment was cancelled" }
                    pending.put("strongbox_fallback", true)
                    write(record, pending)
                    generate(alias, challenge, false)
                }
            } else generate(alias, challenge, false)
        }
        check(active()) { "Enrollment was cancelled; its key and recovery record were preserved" }
        val certificates = requireNotNull(store.getCertificateChain(alias)) { "Android did not return an attestation certificate chain" }
        check(certificates.size in 2..8) { "A complete attestation certificate chain is unavailable" }
        val encoded = certificates.map { it.encoded }
        check(encoded.all { it.size in 1..(32 * 1024) } && encoded.sumOf { it.size } <= 96 * 1024) { "Attestation chain exceeds its bounds" }
        val spki = certificates.first().publicKey.encoded
        val privateKey = store.getKey(alias, null) as? PrivateKey ?: error("Enrolled key is unavailable")
        val certificate = if (purpose == "media") NativeCameraCore.createCertificate(spki) else null
        val fingerprint = if (certificate != null) JSONObject(NativeCameraCore.identity(certificate, spki)).getString("fingerprint")
            else NativeLocationCore.fingerprint(spki)
        val exported = JSONObject().put("version", 1).put("type", "nonverba-key-enrollment")
            .put("purpose", purpose).put("challenge_b64", challengeB64).put("public_spki_der_b64", b64(spki))
            .put("spki_sha256", sha256(spki)).put("fingerprint", fingerprint)
            .put("chain", JSONObject().put("version", 1).put("certificates_der_b64", JSONArray(encoded.map(::b64))))
            .put("key_profile", "attested").put("security_level", securityLevel(privateKey))
            .put("strongbox_requested", pending.getBoolean("strongbox_requested"))
            .put("strongbox_fallback", pending.getBoolean("strongbox_fallback"))
            .put("hardware_attested", false)
        if (certificate != null) exported.put("certificate_pem", certificate)
        check(active()) { "Enrollment was cancelled before publication; its key was preserved" }
        write(record, JSONObject().put("version", 1).put("purpose", purpose).put("state", "ready")
            .put("challenge_b64", challengeB64).put("export", exported))
        check(active()) { "Enrollment finished after cancellation; export the preserved enrollment explicitly" }
        exported
    }

    fun export(context: Context, purpose: String, expectedFingerprint: String? = null): JSONObject = synchronized(lock) {
        exportGenerationLocked(purpose(purpose), resolveGeneration(context, purpose, expectedFingerprint))
    }

    fun summary(context: Context, purpose: String): JSONObject = synchronized(lock) {
        purpose(purpose)
        val known = generations(context, purpose)
        val entries = catalog(known, purpose)
        val enrollments = JSONArray()
        for (entry in entries.filter { it.fingerprint != null }) {
            val exported = exportGenerationLocked(purpose, known.single { it.alias == entry.id })
            enrollments.put(JSONObject().put("fingerprint", exported.getString("fingerprint"))
                .put("challenge_b64", exported.getString("challenge_b64")).put("spki_sha256", exported.getString("spki_sha256")))
        }
        val selected = selection(context, purpose)
        val default = NativeEnrollmentCatalog.defaultEntry(entries, selected.profile, selected.fingerprint, alias(purpose))
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        JSONObject().put("purpose", purpose).put("key_profile", selected.profile)
            .put("fingerprint", selected.fingerprint ?: JSONObject.NULL)
            .put("enrollment_state", if (enrollments.length() > 0) "ready" else if (entries.isNotEmpty()) "pending" else "absent")
            .put("enrollment_fingerprint", default?.fingerprint ?: JSONObject.NULL)
            .put("enrollments", enrollments).put("enrollment_capacity", NativeEnrollmentCatalog.CAPACITY)
            .put("enrollment_slots_used", slotCount(known, purpose, store))
    }

    fun sign(context: Context, purpose: String, expectedFingerprint: String, message: ByteArray, active: () -> Boolean): ByteArray =
        NativeSessionGuards.withSigningAuthority(lock, active) {
            val generation = resolveGeneration(context, purpose(purpose), expectedFingerprint)
            exportGenerationLocked(purpose, generation) // Never sign under the currently selected or newest key by accident.
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            val privateKey = store.getKey(generation.alias, null) as? PrivateKey ?: error("Enrolled signing key is unavailable")
            Signature.getInstance("SHA256withECDSA").run { initSign(privateKey); update(message); sign() }
        }

    private fun exportGenerationLocked(purpose: String, generation: Generation): JSONObject {
        val saved = readGeneration(generation, purpose) ?: error("No attested key is enrolled for this purpose")
        check(saved.getString("state") == "ready") { "Key enrollment is incomplete; resume only its original challenge" }
        val result = saved.getJSONObject("export")
        check(result.getString("purpose") == purpose && result.getString("challenge_b64") == saved.getString("challenge_b64")) { "Enrollment record binding differs" }
        challenge(result.getString("challenge_b64"))
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val chain = store.getCertificateChain(generation.alias) ?: error("The enrolled key is unavailable; its identity was preserved")
        val recordedChain = result.getJSONObject("chain").getJSONArray("certificates_der_b64")
        check(chain.size == recordedChain.length() && chain.size in 2..8) { "Enrolled certificate chain changed" }
        chain.forEachIndexed { index, cert -> check(b64(cert.encoded) == recordedChain.getString(index)) { "Enrolled certificate chain changed" } }
        val spki = chain.first().publicKey.encoded
        check(b64(spki) == result.getString("public_spki_der_b64") && sha256(spki) == result.getString("spki_sha256")) { "Enrolled public key changed" }
        val pin = if (purpose == "media") JSONObject(NativeCameraCore.identity(result.getString("certificate_pem"), spki)).getString("fingerprint")
            else NativeLocationCore.fingerprint(spki)
        check(pin == result.getString("fingerprint")) { "Enrolled key pin changed" }
        return result
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

    @Suppress("DEPRECATION")
    private fun securityLevel(key: PrivateKey): String {
        val info = KeyFactory.getInstance(key.algorithm, "AndroidKeyStore").getKeySpec(key, KeyInfo::class.java)
        if (Build.VERSION.SDK_INT >= 31) return when (info.securityLevel) {
            KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
            KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "trusted-environment"
            KeyProperties.SECURITY_LEVEL_SOFTWARE -> "software"
            KeyProperties.SECURITY_LEVEL_UNKNOWN_SECURE -> "hardware-unspecified"
            else -> "unknown"
        }
        return if (info.isInsideSecureHardware) "hardware-unspecified" else "software"
    }

    private fun alias(purpose: String) = "org.nonverba.camera.$purpose-capture.attested.v2"
    private fun enrollmentRecord(context: Context, purpose: String) = AtomicFile(File(context.noBackupFilesDir, "$purpose-key-enrollment-v2.json"))
    private fun newGeneration(context: Context, purpose: String, challengeHash: String) = Generation(
        AtomicFile(File(context.noBackupFilesDir, "$purpose-key-enrollment-v3-$challengeHash.json")),
        "org.nonverba.camera.$purpose-capture.attested.v3.$challengeHash", challengeHash
    )

    /** Deterministic record names avoid an index/record crash-consistency gap. */
    private fun generations(context: Context, purpose: String): List<Generation> {
        val known = mutableListOf<Generation>()
        val original = enrollmentRecord(context, purpose)
        if (exists(original)) known.add(Generation(original, alias(purpose), null))
        val pattern = Regex("^${purpose}-key-enrollment-v3-([0-9a-f]{64})\\.json(?:\\.bak)?$")
        val hashes = (context.noBackupFilesDir.listFiles() ?: error("Enrollment directory is unavailable"))
            .mapNotNull { pattern.matchEntire(it.name)?.groupValues?.get(1) }.distinct().sorted()
        hashes.forEach { known.add(newGeneration(context, purpose, it)) }
        check(known.size <= NativeEnrollmentCatalog.CAPACITY) { "Enrollment records exceed the supported capacity; all keys were preserved" }
        return known
    }

    private fun readGeneration(generation: Generation, purpose: String): JSONObject? {
        val saved = read(generation.record) ?: return null
        check(saved.getInt("version") == 1 && saved.getString("purpose") == purpose && saved.getString("state") in setOf("pending", "ready")) {
            "Invalid enrollment record"
        }
        val original = challenge(saved.getString("challenge_b64"))
        check(generation.challengeHash == null || generation.challengeHash == sha256(original)) { "Enrollment record does not match its immutable challenge" }
        return saved
    }

    private fun catalog(known: List<Generation>, purpose: String) = known.map { generation ->
        val saved = requireNotNull(readGeneration(generation, purpose)) { "An enrollment record disappeared; its key was preserved" }
        val fingerprint = if (saved.getString("state") == "ready") saved.getJSONObject("export").getString("fingerprint") else null
        NativeEnrollmentCatalog.Entry(generation.alias, saved.getString("challenge_b64"), fingerprint)
    }

    private fun slotCount(known: List<Generation>, purpose: String, store: KeyStore): Int {
        val aliases = known.map { it.alias }.toMutableSet()
        val existing = store.aliases()
        val prefix = "org.nonverba.camera.$purpose-capture.attested.v3."
        while (existing.hasMoreElements()) {
            val candidate = existing.nextElement()
            if (candidate == alias(purpose) || candidate.startsWith(prefix)) aliases.add(candidate)
        }
        return aliases.size // Orphaned aliases still occupy a slot and are never replaced.
    }

    private fun resolveGeneration(context: Context, purpose: String, expectedFingerprint: String?): Generation {
        val known = generations(context, purpose)
        val entries = catalog(known, purpose)
        val entry = if (expectedFingerprint != null) NativeEnrollmentCatalog.byFingerprint(entries, expectedFingerprint)
            else selection(context, purpose).let {
                NativeEnrollmentCatalog.defaultEntry(entries, it.profile, it.fingerprint, alias(purpose))
            }
        check(entry != null) { "Choose an exact enrolled key ID; no unambiguous enrolled identity is available" }
        return known.single { it.alias == entry.id }
    }

    private fun profileRecord(context: Context, purpose: String) = AtomicFile(File(context.noBackupFilesDir, "$purpose-key-profile-v1.json"))
    private fun b64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)
    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun exists(file: AtomicFile) = file.baseFile.exists() || File(file.baseFile.path + ".bak").exists()
    private fun read(file: AtomicFile): JSONObject? {
        if (!exists(file)) return null
        return file.openRead().use { check(it.channel.size() in 1..MAX_RECORD.toLong()) { "Key record exceeds its bounds" }; JSONObject(it.readBytes().toString(Charsets.UTF_8)) }
    }
    private fun write(file: AtomicFile, value: JSONObject) {
        val bytes = value.toString().toByteArray(Charsets.UTF_8)
        check(bytes.size in 1..MAX_RECORD) { "Key record exceeds its bounds" }
        val stream = file.startWrite()
        try { stream.write(bytes); file.finishWrite(stream) }
        catch (error: Throwable) { file.failWrite(stream); throw error }
    }
}
