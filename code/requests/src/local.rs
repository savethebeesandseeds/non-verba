// SPDX-License-Identifier: AGPL-3.0-only
//! User-owned software vaults and append-only local records.
//!
//! The vault is not hardware protection. Its directory, independent verifier,
//! updates, passphrase and signing guard history must remain under the user's
//! control. Copying/restoring a vault without its guards can defeat local
//! refusal of conflicting signatures. This module never resets signing keys.

use crate::{
    crypto::{self, KeyBinding},
    encoding::{self, canonical, digest, strict_parse},
    model::{AssignmentBundle, BundleReport, TrustConfiguration},
};
use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::{Aead, Payload},
};
use p256::ecdsa::SigningKey;
use pbkdf2::pbkdf2_hmac;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::Sha256;
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use zeroize::Zeroizing;

pub const VAULT_ITERATIONS: u32 = 600_000;
pub const MAX_PLAINTEXT_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_PASSPHRASE_BYTES: usize = 4096;
const CIPHER: &str = "AES256_GCM_V1";
const KDF: &str = "PBKDF2_HMAC_SHA256_V1";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EncryptionHeader {
    pub format_version: String,
    pub cipher: String,
    pub kdf: String,
    pub iterations: u32,
    pub kind: String,
    /// Public authenticated context; never place evidence secrets here.
    pub context: String,
    pub salt_b64: String,
    pub nonce_b64: String,
    pub plaintext_bytes: u32,
    pub key_binding: Option<KeyBinding>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EncryptedRecord {
    pub header: EncryptionHeader,
    pub ciphertext_b64: String,
}

fn passphrase_bounds(passphrase: &[u8]) -> Result<(), String> {
    if !(12..=MAX_PASSPHRASE_BYTES).contains(&passphrase.len()) {
        return Err("VAULT_PASSPHRASE: passphrase must contain 12..4096 bytes".into());
    }
    Ok(())
}

fn random<const N: usize>() -> Result<[u8; N], String> {
    let mut output = [0u8; N];
    getrandom::getrandom(&mut output)
        .map_err(|_| "RANDOMNESS_UNAVAILABLE: secure local randomness unavailable".to_owned())?;
    Ok(output)
}

fn validate_header(
    header: &EncryptionHeader,
    expected_kind: &str,
    expected_context: &str,
) -> Result<(), String> {
    if header.format_version != "1"
        || header.cipher != CIPHER
        || header.kdf != KDF
        || header.iterations != VAULT_ITERATIONS
    {
        return Err("VAULT_PROFILE: unsupported encryption/KDF profile".into());
    }
    if header.kind != expected_kind
        || header.context != expected_context
        || header.context.is_empty()
        || header.context.len() > 1024
    {
        return Err("VAULT_CONTEXT: encrypted data belongs to another purpose/context".into());
    }
    if header.plaintext_bytes as usize > MAX_PLAINTEXT_BYTES {
        return Err("VAULT_SIZE: plaintext length exceeds the local bound".into());
    }
    match header.kind.as_str() {
        "KEY_VAULT" => {
            if header.plaintext_bytes != 32 {
                return Err("VAULT_KEY: invalid private key length".into());
            }
            let binding = header
                .key_binding
                .as_ref()
                .ok_or_else(|| "VAULT_KEY: public key binding required".to_owned())?;
            binding.validate()?;
            if header.context != binding.key_id {
                return Err("VAULT_CONTEXT: vault context must be its key ID".into());
            }
        }
        "EVIDENCE" | "BUNDLE_SNAPSHOT" => {
            if header.key_binding.is_some() {
                return Err("VAULT_PROFILE: evidence cannot contain a key binding".into());
            }
            if header.kind == "BUNDLE_SNAPSHOT" {
                encoding::validate_digest(&header.context)?;
            }
        }
        _ => return Err("VAULT_PROFILE: unsupported encrypted record purpose".into()),
    }
    crypto::decode_base64url(&header.salt_b64, 16)?;
    crypto::decode_base64url(&header.nonce_b64, 12)?;
    Ok(())
}

fn derive_key(passphrase: &[u8], salt: &[u8]) -> Zeroizing<[u8; 32]> {
    let mut key = Zeroizing::new([0u8; 32]);
    pbkdf2_hmac::<Sha256>(passphrase, salt, VAULT_ITERATIONS, key.as_mut());
    key
}

fn seal(
    plaintext: &[u8],
    passphrase: &[u8],
    kind: &str,
    context: &str,
    key_binding: Option<KeyBinding>,
) -> Result<EncryptedRecord, String> {
    passphrase_bounds(passphrase)?;
    if plaintext.len() > MAX_PLAINTEXT_BYTES {
        return Err("VAULT_SIZE: plaintext exceeds 2 MiB".into());
    }
    let salt = random::<16>()?;
    let nonce = random::<12>()?;
    let header = EncryptionHeader {
        format_version: "1".into(),
        cipher: CIPHER.into(),
        kdf: KDF.into(),
        iterations: VAULT_ITERATIONS,
        kind: kind.into(),
        context: context.into(),
        salt_b64: crypto::encode_base64url(&salt),
        nonce_b64: crypto::encode_base64url(&nonce),
        plaintext_bytes: plaintext.len() as u32,
        key_binding,
    };
    validate_header(&header, kind, context)?;
    let key = derive_key(passphrase, &salt);
    let cipher = Aes256Gcm::new_from_slice(key.as_ref())
        .map_err(|_| "VAULT_ENCRYPTION: invalid local encryption key".to_owned())?;
    let aad = canonical(&header)?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(|_| "VAULT_ENCRYPTION: encryption failed".to_owned())?;
    Ok(EncryptedRecord {
        header,
        ciphertext_b64: crypto::encode_base64url(&ciphertext),
    })
}

fn open(
    record: &EncryptedRecord,
    passphrase: &[u8],
    kind: &str,
    context: &str,
) -> Result<Zeroizing<Vec<u8>>, String> {
    passphrase_bounds(passphrase)?;
    validate_header(&record.header, kind, context)?;
    let salt = crypto::decode_base64url(&record.header.salt_b64, 16)?;
    let nonce = crypto::decode_base64url(&record.header.nonce_b64, 12)?;
    let ciphertext = crypto::decode_base64url(
        &record.ciphertext_b64,
        record.header.plaintext_bytes as usize + 16,
    )?;
    let key = derive_key(passphrase, &salt);
    let cipher = Aes256Gcm::new_from_slice(key.as_ref())
        .map_err(|_| "VAULT_DECRYPTION: invalid local encryption key".to_owned())?;
    let aad = canonical(&record.header)?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: &aad,
            },
        )
        .map_err(|_| {
            "VAULT_AUTHENTICATION: wrong passphrase or altered encrypted data".to_owned()
        })?;
    Ok(Zeroizing::new(plaintext))
}

pub fn create_vault(
    path: &Path,
    role: &str,
    key_id: &str,
    passphrase: &[u8],
) -> Result<KeyBinding, String> {
    passphrase_bounds(passphrase)?;
    if path.try_exists().map_err(local_io)? {
        return Err("LOCAL_EXISTS: destination already exists".into());
    }
    encoding::validate_id(key_id)?;
    if !matches!(role, "R" | "O" | "M") {
        return Err("VAULT_ROLE: expected R, O or M".into());
    }
    let (key, scalar) = loop {
        let scalar = Zeroizing::new(random::<32>()?);
        if let Ok(key) = SigningKey::from_slice(scalar.as_ref()) {
            break (key, scalar);
        }
    };
    let binding = crypto::key_binding(role, key_id, &key);
    let record = seal(
        scalar.as_ref(),
        passphrase,
        "KEY_VAULT",
        key_id,
        Some(binding.clone()),
    )?;
    // Vault creation must never overwrite/reuse an existing key file.
    write_new(path, &canonical(&record)?)?;
    Ok(binding)
}

pub fn unlock_vault(path: &Path, passphrase: &[u8]) -> Result<(SigningKey, KeyBinding), String> {
    let record: EncryptedRecord = read_json(path)?;
    let scalar = open(&record, passphrase, "KEY_VAULT", &record.header.context)?;
    let key = SigningKey::from_slice(&scalar)
        .map_err(|_| "VAULT_KEY: invalid P-256 private scalar".to_owned())?;
    let binding = record
        .header
        .key_binding
        .ok_or_else(|| "VAULT_KEY: public binding absent".to_owned())?;
    if crypto::key_binding(&binding.role, &binding.key_id, &key) != binding {
        return Err(
            "VAULT_KEY: private key does not match its authenticated public binding".into(),
        );
    }
    Ok((key, binding))
}

pub fn seal_evidence(
    plaintext: &[u8],
    passphrase: &[u8],
    context: &str,
) -> Result<EncryptedRecord, String> {
    seal(plaintext, passphrase, "EVIDENCE", context, None)
}

pub fn open_evidence(
    record: &EncryptedRecord,
    passphrase: &[u8],
    expected_context: &str,
) -> Result<Zeroizing<Vec<u8>>, String> {
    open(record, passphrase, "EVIDENCE", expected_context)
}

/// Exclusive slot identity deliberately excludes causal parent references:
/// changing a parent cannot open a second slot for the same scope/version.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExclusiveSlot {
    pub deployment_domain: String,
    pub assignment_id: String,
    pub key_id: String,
    pub scope_id: String,
    pub scope_version: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SigningReservation {
    format_version: String,
    slot: ExclusiveSlot,
    proposal_digest: String,
}

pub fn guard_directory(vault_path: &Path) -> Result<PathBuf, String> {
    let filename = vault_path
        .file_name()
        .ok_or_else(|| "LOCAL_PATH: vault filename is required".to_owned())?;
    let mut guard_name = filename.to_os_string();
    guard_name.push(".signing-guards");
    Ok(vault_path.with_file_name(guard_name))
}

/// Persist the refusal record before a signature is produced. An incomplete
/// record after a crash is not removed or interpreted as unused permission.
pub fn reserve_signing_slot(
    directory: &Path,
    slot: &ExclusiveSlot,
    proposal_digest: &str,
) -> Result<(), String> {
    encoding::validate_domain(&slot.deployment_domain)?;
    encoding::validate_id(&slot.assignment_id)?;
    encoding::validate_id(&slot.key_id)?;
    encoding::validate_id(&slot.scope_id)?;
    crate::money::parse_minor_units(&slot.scope_version)?;
    encoding::validate_digest(proposal_digest)?;
    fs::create_dir_all(directory).map_err(local_io)?;
    let path = directory.join(format!("{}.json", digest(slot)?));
    let reservation = SigningReservation {
        format_version: "1".into(),
        slot: slot.clone(),
        proposal_digest: proposal_digest.into(),
    };
    let bytes = canonical(&reservation)?;
    match write_new(&path, &bytes) {
        Ok(()) => Ok(()),
        Err(error) if error.starts_with("LOCAL_EXISTS:") => {
            let previous = read_bytes(&path)?;
            if previous != bytes {
                return Err("SIGNER_CONFLICT: this key has already reserved a different or incomplete authorization for this exclusive slot; retain the local record".into());
            }
            Ok(())
        }
        Err(error) => Err(error),
    }
}

fn local_io(error: std::io::Error) -> String {
    format!("LOCAL_IO: {error}")
}

pub fn read_bytes(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::symlink_metadata(path).map_err(local_io)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("LOCAL_PATH: expected a regular file, not a link".into());
    }
    if metadata.len() > encoding::MAX_JSON_BYTES as u64 {
        return Err("LOCAL_SIZE: file exceeds 4 MiB".into());
    }
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(local_io)?
        .take(encoding::MAX_JSON_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(local_io)?;
    if bytes.len() > encoding::MAX_JSON_BYTES {
        return Err("LOCAL_SIZE: file exceeds 4 MiB".into());
    }
    Ok(bytes)
}

pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    strict_parse(&read_bytes(path)?)
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            "LOCAL_EXISTS: destination already exists".into()
        } else {
            local_io(e)
        }
    })?;
    file.write_all(bytes).map_err(local_io)?;
    file.sync_all().map_err(local_io)?;
    // Persist the directory entry on systems that support directory fsync.
    #[cfg(unix)]
    File::open(
        path.parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new(".")),
    )
    .map_err(local_io)?
    .sync_all()
    .map_err(local_io)?;
    Ok(())
}

/// Create once. Identical retransmission is idempotent; different bytes never
/// replace a prior export, reservation or certificate.
pub fn write_immutable(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > encoding::MAX_JSON_BYTES {
        return Err("LOCAL_SIZE: output exceeds 4 MiB".into());
    }
    match write_new(path, bytes) {
        Ok(()) => (),
        Err(error) if error.starts_with("LOCAL_EXISTS:") => {
            if read_bytes(path)? != bytes {
                return Err("LOCAL_IMMUTABLE: destination already contains different bytes".into());
            }
        }
        Err(error) => return Err(error),
    }
    if read_bytes(path)? != bytes {
        return Err("LOCAL_READBACK: stored bytes differ from intended immutable record".into());
    }
    Ok(())
}

pub fn snapshot_path(bundle: &AssignmentBundle, directory: &Path) -> Result<PathBuf, String> {
    Ok(directory.join(format!("{}.bundle.json", digest(bundle)?)))
}

/// Preserve the supplied view and its diagnostics, including conflicts and
/// rejected records. Storage is not an assertion that every record is valid.
pub fn store_snapshot(
    bundle: &AssignmentBundle,
    trust: &TrustConfiguration,
    directory: &Path,
) -> Result<BundleReport, String> {
    if !bundle.attachments.is_empty() {
        return Err("LOCAL_PRIVACY: raw attachments require encrypted local storage".into());
    }
    let report = crate::bundle::verify_assignment_bundle(bundle, trust)?;
    let bytes = canonical(bundle)?;
    fs::create_dir_all(directory).map_err(local_io)?;
    write_immutable(&snapshot_path(bundle, directory)?, &bytes)?;
    Ok(report)
}

/// CLI default for local retention, including raw evidence attachments. The
/// encrypted header authenticates the immutable root Agreement digest.
pub fn store_encrypted_snapshot(
    bundle: &AssignmentBundle,
    trust: &TrustConfiguration,
    directory: &Path,
    passphrase: &[u8],
) -> Result<BundleReport, String> {
    let report = crate::bundle::verify_assignment_bundle(bundle, trust)?;
    let plaintext = Zeroizing::new(canonical(bundle)?);
    let root_hash = digest(&bundle.agreement.agreement)?;
    let path = encrypted_snapshot_path(bundle, directory)?;
    fs::create_dir_all(directory).map_err(local_io)?;
    if path.try_exists().map_err(local_io)? {
        let previous: EncryptedRecord = read_json(&path)?;
        if open(&previous, passphrase, "BUNDLE_SNAPSHOT", &root_hash)?.as_slice()
            != plaintext.as_slice()
        {
            return Err(
                "LOCAL_IMMUTABLE: existing encrypted snapshot contains different bytes".into(),
            );
        }
        return Ok(report);
    }
    let record = seal(&plaintext, passphrase, "BUNDLE_SNAPSHOT", &root_hash, None)?;
    let bytes = canonical(&record)?;
    match write_new(&path, &bytes) {
        Ok(()) => {
            if read_bytes(&path)? != bytes {
                return Err("LOCAL_READBACK: encrypted snapshot differs after write".into());
            }
        }
        Err(error) if error.starts_with("LOCAL_EXISTS:") => {
            let previous: EncryptedRecord = read_json(&path)?;
            if open(&previous, passphrase, "BUNDLE_SNAPSHOT", &root_hash)?.as_slice()
                != plaintext.as_slice()
            {
                return Err(
                    "LOCAL_IMMUTABLE: competing encrypted snapshot contains different bytes".into(),
                );
            }
        }
        Err(error) => return Err(error),
    }
    Ok(report)
}

pub fn encrypted_snapshot_path(
    bundle: &AssignmentBundle,
    directory: &Path,
) -> Result<PathBuf, String> {
    Ok(directory.join(format!("{}.sealed-bundle.json", digest(bundle)?)))
}

pub fn load_encrypted_snapshot(
    path: &Path,
    passphrase: &[u8],
    expected_root_hash: &str,
) -> Result<AssignmentBundle, String> {
    encoding::validate_digest(expected_root_hash)?;
    let record: EncryptedRecord = read_json(path)?;
    let plaintext = open(&record, passphrase, "BUNDLE_SNAPSHOT", expected_root_hash)?;
    let bundle: AssignmentBundle = strict_parse(&plaintext)?;
    if digest(&bundle.agreement.agreement)? != expected_root_hash {
        return Err("IMPORT_ROOT: decrypted bundle differs from authenticated root digest".into());
    }
    Ok(bundle)
}

fn merge_records<T: Clone + Serialize>(left: &[T], right: &[T]) -> Result<Vec<T>, String> {
    let mut records = BTreeMap::new();
    for record in left.iter().chain(right) {
        records
            .entry(digest(record)?)
            .or_insert_with(|| record.clone());
    }
    Ok(records.into_values().collect())
}

/// Merge exact signed objects without latest-wins semantics. Conflicting bodies
/// and signatures remain present for the verifier to diagnose. Root changes
/// must arrive as amendment certificates, not replacements of the root.
pub fn merge_bundles(
    left: &AssignmentBundle,
    right: &AssignmentBundle,
) -> Result<AssignmentBundle, String> {
    if left.protocol_version != right.protocol_version
        || left.deployment_domain != right.deployment_domain
        || digest(&left.agreement.agreement)? != digest(&right.agreement.agreement)?
    {
        return Err(
            "IMPORT_ROOT: bundles must retain the exact same root Agreement/domain/version".into(),
        );
    }
    let mut combined = left.clone();
    combined.requests = merge_records(&left.requests, &right.requests)?;
    combined.agreement.signatures =
        merge_records(&left.agreement.signatures, &right.agreement.signatures)?;
    // Combine partial authorizations for the same proposal while preserving
    // genuinely conflicting proposal bodies and multiple signer records.
    let mut actions: BTreeMap<String, crate::model::ActionCertificate> = BTreeMap::new();
    for action in left.actions.iter().chain(&right.actions) {
        let key = digest(&action.proposal)?;
        if let Some(existing) = actions.get_mut(&key) {
            existing.authorizations =
                merge_records(&existing.authorizations, &action.authorizations)?;
        } else {
            let mut action = action.clone();
            action.authorizations = merge_records(&[], &action.authorizations)?;
            actions.insert(key, action);
        }
    }
    combined.actions = actions.into_values().collect();
    combined.events = merge_records(&left.events, &right.events)?;
    combined.attachments = merge_records(&left.attachments, &right.attachments)?;
    canonical(&combined)?;
    Ok(combined)
}
