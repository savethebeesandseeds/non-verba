// SPDX-License-Identifier: AGPL-3.0-only
//! Attachment integrity is independent of attribution, commitment openings,
//! transcript ordering, and the truth of an observation. No result in this
//! module creates contractual authority or verifies a declared media type.

use crate::{
    crypto, encoding,
    model::{Attachment, Diagnostic},
    transcript::{self, EventBody, EvidenceManifest, SignedEvent, TranscriptReport},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const MAX_ATTACHMENT_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, Default)]
pub struct AttachmentIndex {
    pub verified_bytes: BTreeMap<String, Vec<u8>>,
    pub diagnostics: Vec<Diagnostic>,
    pub invalid_claimed_digests: BTreeSet<String>,
}

/// Index only canonical base64url, bounded bytes matching the supplied digest.
/// An invalid duplicate never replaces or hides a valid supplied attachment.
pub fn index_attachments(attachments: &[Attachment]) -> AttachmentIndex {
    let mut index = AttachmentIndex::default();
    for attachment in attachments {
        let verified = (|| {
            encoding::validate_digest(&attachment.sha256)?;
            if attachment.bytes_b64.len() > MAX_ATTACHMENT_BYTES.saturating_mul(8).div_ceil(6) {
                return Err("ATTACHMENT_SIZE: attachment exceeds the supported byte limit".into());
            }
            let bytes = URL_SAFE_NO_PAD
                .decode(&attachment.bytes_b64)
                .map_err(|_| "ATTACHMENT_ENCODING: expected canonical unpadded base64url")?;
            if bytes.len() > MAX_ATTACHMENT_BYTES
                || crypto::encode_base64url(&bytes) != attachment.bytes_b64
            {
                return Err("ATTACHMENT_ENCODING: invalid size or noncanonical base64url".into());
            }
            if encoding::bytes_digest(&bytes) != attachment.sha256 {
                return Err(
                    "ATTACHMENT_DIGEST: supplied bytes do not match their claimed digest".into(),
                );
            }
            Ok::<_, String>(bytes)
        })();
        match verified {
            Ok(bytes) => {
                index
                    .verified_bytes
                    .entry(attachment.sha256.clone())
                    .or_insert(bytes);
            }
            Err(error) => {
                index
                    .invalid_claimed_digests
                    .insert(attachment.sha256.clone());
                index.diagnostics.push(diagnostic(
                    "ATTACHMENT_BINDING",
                    &attachment.sha256,
                    &error,
                ));
            }
        }
    }
    index
        .diagnostics
        .sort_by(|a, b| (&a.subject, &a.code, &a.message).cmp(&(&b.subject, &b.code, &b.message)));
    index.diagnostics.dedup();
    index
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ArtifactIntegrity {
    pub sha256: String,
    pub declared_byte_length: String,
    pub actual_byte_length: Option<String>,
    /// SUPPLIED_VALID means the bytes match this digest; inspect length_match too.
    pub availability: String,
    pub digest_match: Option<bool>,
    pub length_match: Option<bool>,
    pub media_type: String,
    pub media_type_status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ManifestIntegrity {
    pub manifest_digest: String,
    pub schema_valid: bool,
    /// INTEGRITY_VALID, INCOMPLETE (missing bytes), or INTEGRITY_INVALID.
    pub status: String,
    pub artifacts: Vec<ArtifactIntegrity>,
    pub diagnostics: Vec<Diagnostic>,
}

pub fn validate_manifest(
    manifest: &EvidenceManifest,
    index: &AttachmentIndex,
) -> ManifestIntegrity {
    let mut diagnostics = Vec::new();
    let manifest_digest = match encoding::digest(manifest) {
        Ok(digest) => digest,
        Err(error) => {
            diagnostics.push(diagnostic("MANIFEST_ENCODING", "", &error));
            String::new()
        }
    };
    let schema_valid = match manifest.validate() {
        Ok(()) => true,
        Err(error) => {
            diagnostics.push(diagnostic("MANIFEST_SCHEMA", &manifest_digest, &error));
            false
        }
    };
    let mut invalid = !schema_valid || manifest_digest.is_empty();
    let mut missing = false;
    let artifacts = manifest.artifacts.iter().map(|artifact| {
        let (availability, actual_byte_length, digest_match, length_match) =
            if let Some(bytes) = index.verified_bytes.get(&artifact.sha256) {
                let actual = bytes.len().to_string();
                let length_match = artifact.byte_length == actual;
                if !length_match {
                    invalid = true;
                    diagnostics.push(diagnostic("MANIFEST_LENGTH_MISMATCH", &artifact.sha256,
                        &format!("Manifest declares {} bytes; verified supplied content has {actual} bytes.", artifact.byte_length)));
                }
                ("SUPPLIED_VALID", Some(actual), Some(true), Some(length_match))
            } else if index.invalid_claimed_digests.contains(&artifact.sha256) {
                invalid = true;
                diagnostics.push(diagnostic("MANIFEST_ATTACHMENT_INVALID", &artifact.sha256,
                    "Supplied attachment failed encoding, size, or digest validation."));
                // A malformed encoding need not have a computable content digest.
                ("SUPPLIED_INVALID", None, None, None)
            } else {
                missing = true;
                diagnostics.push(diagnostic("MANIFEST_ATTACHMENT_MISSING", &artifact.sha256,
                    "No attachment with this verified content digest was supplied."));
                ("MISSING", None, None, None)
            };
        ArtifactIntegrity {
            sha256: artifact.sha256.clone(), declared_byte_length: artifact.byte_length.clone(),
            actual_byte_length, availability: availability.into(), digest_match, length_match,
            media_type: artifact.media_type.clone(), media_type_status: "DECLARED_UNVERIFIED".into(),
        }
    }).collect();
    ManifestIntegrity {
        manifest_digest,
        schema_valid,
        status: if invalid {
            "INTEGRITY_INVALID"
        } else if missing {
            "INCOMPLETE"
        } else {
            "INTEGRITY_VALID"
        }
        .into(),
        artifacts,
        diagnostics,
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EventEvidenceReport {
    pub event_hash: String,
    pub event_type: String,
    pub signature_valid: bool,
    pub body_valid: bool,
    pub commitment_opening: Option<bool>,
    pub commitment_status: String,
    pub transcript_status: String,
    pub manifest: ManifestIntegrity,
}

/// Report every supplied manifest, including nonadmitted/unauthenticated claims.
/// The transcript must describe the same input and trusted context. A valid
/// commitment opening alone does not authenticate the reveal's author.
pub fn event_reports(
    events: &[SignedEvent],
    transcript: &TranscriptReport,
    index: &AttachmentIndex,
) -> Vec<EventEvidenceReport> {
    let mut unique = BTreeMap::new();
    for event in events {
        if let Ok(hash) = encoding::digest(&event.envelope) {
            // Prefer the authenticated record when an input includes both it
            // and a forged authorization over an identical envelope.
            unique
                .entry(hash.clone())
                .or_insert_with(|| transcript.retained_events.get(&hash).unwrap_or(event));
        }
    }
    unique
        .into_iter()
        .filter_map(|(hash, event)| {
            let (kind, manifest) = match &event.envelope.body {
                EventBody::CompletionClaim { manifest, .. } => ("COMPLETION_CLAIM", manifest),
                EventBody::EvidenceReveal { manifest, .. } => ("EVIDENCE_REVEAL", manifest),
                EventBody::SupplementaryEvidence { manifest, .. } => {
                    ("SUPPLEMENTARY_EVIDENCE", manifest)
                }
                _ => return None,
            };
            let status = transcript.event_status.get(&hash);
            let body_valid = transcript::validate_body(&event.envelope).is_ok();
            let (commitment_opening, commitment_status) =
                if matches!(event.envelope.body, EventBody::EvidenceReveal { .. }) {
                    match transcript::verify_commitment_opening(event, &transcript.retained_events)
                    {
                        Ok(()) => (Some(true), "VALID"),
                        Err(error) if error.starts_with("MISSING_COMMITMENT:") => {
                            (None, "MISSING_COMMITMENT")
                        }
                        Err(_) => (Some(false), "INVALID"),
                    }
                } else {
                    (None, "NOT_APPLICABLE")
                };
            Some(EventEvidenceReport {
                event_hash: hash,
                event_type: kind.into(),
                signature_valid: status.is_some_and(|s| s.signature_valid),
                body_valid,
                commitment_opening,
                commitment_status: commitment_status.into(),
                transcript_status: status.map_or("UNAVAILABLE", |s| s.status.as_str()).into(),
                manifest: validate_manifest(manifest, index),
            })
        })
        .collect()
}

fn diagnostic(code: &str, subject: &str, message: &str) -> Diagnostic {
    Diagnostic {
        code: code.into(),
        subject: subject.into(),
        message: message.into(),
    }
}
