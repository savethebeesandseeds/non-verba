// SPDX-License-Identifier: AGPL-3.0-only
//! Strict supported Android signing-key attestation profile; no merging of
//! software and hardware authorization lists or silent unknown-tag acceptance.
use super::{
    der::{self, Node},
    Expected,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn authorizations(node: Node<'_>) -> Result<BTreeMap<u32, Node<'_>>, String> {
    let mut result = BTreeMap::new();
    let mut prior = None;
    for item in node.children(16)? {
        if item.class != 2 || !item.constructed || prior.is_some_and(|p| item.tag <= p) {
            return Err("Android authorization tags are duplicated or unordered".into());
        }
        prior = Some(item.tag);
        result.insert(item.tag, der::one(item.body)?);
    }
    Ok(result)
}
fn required<'a>(values: &BTreeMap<u32, Node<'a>>, tag: u32) -> Result<Node<'a>, String> {
    values
        .get(&tag)
        .copied()
        .ok_or_else(|| format!("Required hardware authorization tag {tag} is absent"))
}
fn number(values: &BTreeMap<u32, Node<'_>>, tag: u32) -> Result<u64, String> {
    required(values, tag)?.expect(2, false)?.integer()
}
fn integer_set(node: Node<'_>) -> Result<Vec<u64>, String> {
    node.children(17)?
        .into_iter()
        .map(|n| n.expect(2, false)?.integer())
        .collect()
}
fn null(node: Node<'_>) -> Result<(), String> {
    if !node.expect(5, false)?.body.is_empty() {
        return Err("Invalid Android NULL authorization".into());
    }
    Ok(())
}

pub(super) fn claims(bytes: &[u8], expected: &Expected, challenge: &[u8]) -> Result<Value, String> {
    if bytes.len() > 16 * 1024 {
        return Err("Android attestation extension exceeds bound".into());
    }
    der::canonical(bytes)?;
    let fields = der::one(bytes)?.children(16)?;
    if fields.len() != 8 {
        return Err("Invalid Android KeyDescription field count".into());
    }
    let version = fields[0].expect(2, false)?.integer()?;
    let keymaster = fields[2].expect(2, false)?.integer()?;
    let correct_keymaster = match version {
        3 => 4,
        4 => 41,
        100 | 200 | 300 | 400 | 500 => version,
        _ => return Err("Unsupported Android attestation schema version".into()),
    };
    if keymaster != correct_keymaster {
        return Err("Inconsistent Android attestation and KeyMint versions".into());
    }
    let security = fields[1].expect(10, false)?.integer()?;
    let key_security = fields[3].expect(10, false)?.integer()?;
    let min = if expected.minimum_security_level == "strongbox" {
        2
    } else {
        1
    };
    if !(min..=2).contains(&security) || !(min..=2).contains(&key_security) {
        return Err("Attestation or key is below required hardware security level".into());
    }
    if fields[4].octets()? != challenge {
        return Err("Attestation challenge differs from independently retained challenge".into());
    }
    if !fields[5].octets()?.is_empty() {
        return Err("Privacy-sensitive device-unique attestation is unsupported".into());
    }
    let software = authorizations(fields[6])?;
    let hardware = authorizations(fields[7])?;
    if software.keys().any(|tag| hardware.contains_key(tag)) {
        return Err("Android authorization duplicated across security levels".into());
    }
    for (tag, value) in &software {
        match tag {
            503 => null(*value)?,
            701 => {
                value.expect(2, false)?.integer()?;
            }
            709 => {
                value.octets()?;
            }
            _ => {
                return Err(format!(
                    "Unsupported or misplaced software authorization tag {tag}"
                ))
            }
        }
    }
    for (tag, value) in &hardware {
        match tag {
            1 | 5 => {
                integer_set(*value)?;
            }
            2 | 3 | 10 | 702 | 705 | 706 | 718 | 719 => {
                value.expect(2, false)?.integer()?;
            }
            303 | 503 | 509 => null(*value)?,
            704 => {
                value.expect(16, true)?;
            }
            _ => {
                return Err(format!(
                    "Unsupported or misplaced hardware authorization tag {tag}"
                ))
            }
        }
    }
    if integer_set(required(&hardware, 1)?)? != [2]
        || integer_set(required(&hardware, 5)?)? != [4]
        || number(&hardware, 2)? != 3
        || number(&hardware, 3)? != 256
        || number(&hardware, 10)? != 1
        || number(&hardware, 702)? != 0
    {
        return Err("Attested key is not hardware-generated P-256 SHA256 signing-only".into());
    }
    let root = required(&hardware, 704)?.children(16)?;
    if root.len() != 4 || !root[1].boolean()? || root[2].expect(10, false)?.integer()? != 0 {
        return Err("Attested boot state is not locked and verified".into());
    }
    let boot_key = root[0].octets()?;
    let boot_hash = root[3].octets()?;
    if !matches!(boot_key.len(), 32 | 64)
        || !matches!(boot_hash.len(), 32 | 64)
        || boot_key.iter().all(|b| *b == 0)
        || boot_hash.iter().all(|b| *b == 0)
    {
        return Err("Invalid verified boot key or boot image hash".into());
    }
    let os = number(&hardware, 705)?;
    let os_patch = number(&hardware, 706)?;
    let vendor_patch = number(&hardware, 718)?;
    let boot_patch = number(&hardware, 719)?;
    super::patch(os_patch, false)?;
    super::patch(vendor_patch, true)?;
    super::patch(boot_patch, true)?;
    if os < expected.minimum_os_version
        || os > 999999
        || os_patch < expected.minimum_os_patch_level
        || vendor_patch < expected.minimum_vendor_patch_level
        || boot_patch < expected.minimum_boot_patch_level
    {
        return Err("Attested OS or patch state is below requester policy".into());
    }
    let app = required(&software, 709)?.octets()?;
    der::canonical(app)?;
    let app_fields = der::one(app)?.children(16)?;
    if app_fields.len() != 2 {
        return Err("Invalid attestation application identity".into());
    }
    let packages = app_fields[0].children(17)?;
    if packages.len() != 1 {
        return Err("Shared-UID or missing application identities are unsupported".into());
    }
    let package = packages[0].children(16)?;
    if package.len() != 2 || package[0].octets()? != expected.package_name.as_bytes() {
        return Err("Attestation package differs from independently expected application".into());
    }
    let version_code = package[1].expect(2, false)?.integer()?;
    if version_code < expected.min_version_code || version_code > i64::MAX as u64 {
        return Err("Attestation application version is below policy".into());
    }
    let mut digests = app_fields[1]
        .children(17)?
        .into_iter()
        .map(|v| {
            let bytes = v.octets()?;
            if bytes.len() != 32 {
                return Err("Invalid application signing-certificate digest".into());
            }
            Ok(hex::encode(bytes))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut expected_digests = expected.signing_certificate_sha256.clone();
    digests.sort();
    expected_digests.sort();
    if digests != expected_digests {
        return Err(
            "Attested app signing certificates differ from independently pinned identity".into(),
        );
    }
    Ok(
        json!({"attestation_version":version,"keymint_version":keymaster,
        "attestation_security_level":if security==2{"strongbox"}else{"trusted-environment"},
        "key_security_level":if key_security==2{"strongbox"}else{"trusted-environment"},
        "key_origin":"generated","algorithm":"EC-P256-SHA256","purpose":"sign",
        "device_locked":true,"verified_boot_state":"verified","verified_boot_key":hex::encode(boot_key),
        "verified_boot_hash":hex::encode(boot_hash),"os_version":os,"os_patch_level":os_patch,
        "vendor_patch_level":vendor_patch,"boot_patch_level":boot_patch,
        "package_name":expected.package_name,"version_code":version_code,"signing_certificate_sha256":digests,
        "app_identity_enforcement":"android-software-reported-in-hardware-signed-extension"}),
    )
}

pub(super) fn provisioning(bytes: &[u8], claims: &Value) -> Result<(), String> {
    use coset::cbor::value::Value as Cbor;
    if bytes.len() > 4096 {
        return Err("Provisioning extension exceeds limit".into());
    }
    let mut remaining = bytes;
    let value: Cbor = coset::cbor::de::from_reader(&mut remaining).map_err(crate::err)?;
    if !remaining.is_empty() {
        return Err("Trailing provisioning extension data".into());
    }
    let Cbor::Map(entries) = value else {
        return Err("Provisioning extension is not a CBOR map".into());
    };
    let mut seen = std::collections::HashSet::new();
    let mut entity = None;
    for (key, value) in entries {
        let Cbor::Integer(key) = key else {
            return Err("Invalid provisioning field key".into());
        };
        let key = i128::from(key);
        if !seen.insert(key) {
            return Err("Duplicate provisioning field".into());
        }
        match (key, value) {
            (1, Cbor::Integer(n)) if i128::from(n) >= 0 => {}
            (4, Cbor::Text(s)) if matches!(s.as_str(), "TEE" | "STRONG_BOX") => entity = Some(s),
            (6, Cbor::Bool(false)) => {}
            (6, Cbor::Bool(true)) => {
                return Err("Attestation provisioning identifies a lost device".into())
            }
            _ => return Err("Unknown or malformed provisioning extension field".into()),
        }
    }
    if !seen.contains(&1)
        || entity.as_deref()
            != Some(if claims["key_security_level"] == "strongbox" {
                "STRONG_BOX"
            } else {
                "TEE"
            })
    {
        return Err("Provisioning origin does not match attested hardware security".into());
    }
    Ok(())
}
