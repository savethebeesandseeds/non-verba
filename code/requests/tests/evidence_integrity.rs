// SPDX-License-Identifier: AGPL-3.0-only
use nonverba_requests::{crypto, encoding, evidence::*, model::Attachment, transcript::*};
use p256::ecdsa::SigningKey;

fn attachment(bytes: &[u8]) -> Attachment {
    Attachment {
        sha256: encoding::bytes_digest(bytes),
        bytes_b64: crypto::encode_base64url(bytes),
    }
}
fn manifest(length: &str) -> EvidenceManifest {
    EvidenceManifest {
        artifacts: vec![ArtifactRef {
            sha256: encoding::bytes_digest(b"photo bytes"),
            byte_length: length.into(),
            media_type: "image/jpeg".into(),
            capture_reference: None,
        }],
        description: "Signed declaration, not proof of a physical event.".into(),
    }
}
fn hash(event: &SignedEvent) -> String {
    encoding::digest(&event.envelope).unwrap()
}

struct Fixture {
    keys: [SigningKey; 3],
    context: EventContext,
}
impl Fixture {
    fn new() -> Self {
        let keys = [7u8, 8, 9].map(|n| SigningKey::from_bytes((&[n; 32]).into()).unwrap());
        let context = EventContext {
            deployment_domain: "evidence.test".into(),
            assignment_id: "assignment-1".into(),
            agreement_hash: "ab".repeat(32),
            keys: ["R", "O", "M"]
                .iter()
                .enumerate()
                .map(|(i, role)| crypto::key_binding(role, &format!("key-{role}"), &keys[i]))
                .collect(),
        };
        Self { keys, context }
    }
    fn event(
        &self,
        role: &str,
        sequence: u64,
        previous: Option<&SignedEvent>,
        body: EventBody,
    ) -> SignedEvent {
        let causal_references = match &body {
            EventBody::EvidenceReveal {
                commitment_event_hash,
                ..
            } => vec![commitment_event_hash.clone()],
            _ => vec![],
        };
        let envelope = EventEnvelope {
            protocol_version: "2".into(),
            deployment_domain: self.context.deployment_domain.clone(),
            assignment_id: self.context.assignment_id.clone(),
            agreement_hash: self.context.agreement_hash.clone(),
            author_role: role.into(),
            key_id: format!("key-{role}"),
            key_epoch: "1".into(),
            sequence: sequence.to_string(),
            previous_event_hash: previous.map(hash),
            nonce: format!("nonce-{role}-{sequence}"),
            causal_references,
            claimed_creation_time: None,
            body,
        };
        let key = &self.keys[match role {
            "R" => 0,
            "O" => 1,
            _ => 2,
        }];
        sign_event(&envelope, key).unwrap()
    }
    fn commitment_and_reveal(
        &self,
        manifest: &EvidenceManifest,
        salt: &[u8; 32],
    ) -> (SignedEvent, SignedEvent) {
        let context = crypto::CommitmentContext {
            deployment_domain: self.context.deployment_domain.clone(),
            assignment_id: self.context.assignment_id.clone(),
            agreement_hash: self.context.agreement_hash.clone(),
            dispute_id: "dispute-1".into(),
            round_id: "round-1".into(),
            author_role: "O".into(),
            manifest_digest: encoding::digest(manifest).unwrap(),
        };
        let commit = self.event(
            "O",
            0,
            None,
            EventBody::EvidenceCommitment {
                dispute_id: "dispute-1".into(),
                round_id: "round-1".into(),
                commitment: crypto::commitment(&context, salt).unwrap(),
            },
        );
        let reveal = self.event(
            "O",
            1,
            Some(&commit),
            EventBody::EvidenceReveal {
                dispute_id: "dispute-1".into(),
                round_id: "round-1".into(),
                commitment_event_hash: hash(&commit),
                salt_b64: crypto::encode_base64url(salt),
                manifest: manifest.clone(),
            },
        );
        (commit, reveal)
    }
}

#[test]
fn correct_hash_and_length_report_integrity_without_verifying_declared_media_type() {
    let index = index_attachments(&[attachment(b"photo bytes")]);
    let report = validate_manifest(&manifest("11"), &index);
    assert_eq!(report.status, "INTEGRITY_VALID");
    assert!(report.schema_valid);
    assert_eq!(report.artifacts[0].digest_match, Some(true));
    assert_eq!(report.artifacts[0].length_match, Some(true));
    assert_eq!(
        report.artifacts[0].actual_byte_length.as_deref(),
        Some("11")
    );
    assert_eq!(report.artifacts[0].media_type_status, "DECLARED_UNVERIFIED");
}

#[test]
fn correct_digest_does_not_validate_false_declared_byte_length() {
    let index = index_attachments(&[attachment(b"photo bytes")]);
    let report = validate_manifest(&manifest("1"), &index);
    assert_eq!(report.status, "INTEGRITY_INVALID");
    assert!(
        report.schema_valid,
        "a canonical integer can still be factually false"
    );
    assert_eq!(report.artifacts[0].digest_match, Some(true));
    assert_eq!(report.artifacts[0].length_match, Some(false));
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code == "MANIFEST_LENGTH_MISMATCH")
    );
}

#[test]
fn missing_bytes_are_incomplete_not_valid_or_invalid_supplied_content() {
    let report = validate_manifest(&manifest("11"), &AttachmentIndex::default());
    assert_eq!(report.status, "INCOMPLETE");
    assert_eq!(report.artifacts[0].availability, "MISSING");
    assert_eq!(report.artifacts[0].digest_match, None);
    assert_eq!(report.artifacts[0].length_match, None);
}

#[test]
fn malformed_and_wrong_digest_duplicates_cannot_shadow_valid_bytes_in_any_order() {
    let good = attachment(b"photo bytes");
    let bad_encoding = Attachment {
        bytes_b64: "$$invalid".into(),
        ..good.clone()
    };
    let bad_digest = Attachment {
        bytes_b64: crypto::encode_base64url(b"different"),
        ..good.clone()
    };
    let a = index_attachments(&[good.clone(), bad_encoding.clone(), bad_digest.clone()]);
    let b = index_attachments(&[bad_digest, bad_encoding.clone(), good]);
    assert_eq!(a.verified_bytes, b.verified_bytes);
    assert_eq!(a.diagnostics, b.diagnostics);
    assert_eq!(a.diagnostics.len(), 2);
    assert_eq!(
        validate_manifest(&manifest("11"), &a).status,
        "INTEGRITY_VALID"
    );
    let only_bad = index_attachments(&[bad_encoding]);
    let report = validate_manifest(&manifest("11"), &only_bad);
    assert_eq!(report.status, "INTEGRITY_INVALID");
    assert_eq!(report.artifacts[0].availability, "SUPPLIED_INVALID");
}

#[test]
fn noncanonical_encoding_size_and_manifest_schema_are_rejected() {
    let mut padded = attachment(b"x");
    padded.bytes_b64.push_str("==");
    let oversized = Attachment {
        sha256: "ab".repeat(32),
        bytes_b64: "A".repeat(MAX_ATTACHMENT_BYTES * 2),
    };
    let index = index_attachments(&[padded, oversized]);
    assert!(index.verified_bytes.is_empty());
    assert_eq!(index.diagnostics.len(), 2);
    let report = validate_manifest(
        &manifest("011"),
        &index_attachments(&[attachment(b"photo bytes")]),
    );
    assert!(!report.schema_valid);
    assert_eq!(report.status, "INTEGRITY_INVALID");
}

#[test]
fn all_manifest_events_separate_signature_opening_and_blob_integrity() {
    let f = Fixture::new();
    let bad_manifest = manifest("1");
    let (commit, reveal) = f.commitment_and_reveal(&bad_manifest, &[10u8; 32]);
    let completion = f.event(
        "O",
        2,
        Some(&reveal),
        EventBody::CompletionClaim {
            milestone_id: "work".into(),
            manifest: bad_manifest.clone(),
        },
    );
    let supplementary = f.event(
        "R",
        0,
        None,
        EventBody::SupplementaryEvidence {
            dispute_id: "dispute-1".into(),
            round_id: "round-1".into(),
            manifest: bad_manifest,
        },
    );
    let events = [commit, reveal.clone(), completion, supplementary];
    let transcript = verify_events(&events, &f.context);
    assert_eq!(transcript.accepted.len(), 4);
    let reports = event_reports(
        &events,
        &transcript,
        &index_attachments(&[attachment(b"photo bytes")]),
    );
    assert_eq!(reports.len(), 3);
    for report in &reports {
        assert!(report.signature_valid);
        assert!(report.body_valid);
        assert_eq!(report.manifest.status, "INTEGRITY_INVALID");
        assert_eq!(report.manifest.artifacts[0].length_match, Some(false));
    }
    let report = reports
        .iter()
        .find(|r| r.event_hash == hash(&reveal))
        .unwrap();
    assert_eq!(report.commitment_opening, Some(true));
    assert_eq!(report.commitment_status, "VALID");
}

#[test]
fn malformed_reveal_authorization_does_not_change_independent_opening_result() {
    let f = Fixture::new();
    let (commit, mut reveal) = f.commitment_and_reveal(&manifest("11"), &[11u8; 32]);
    reveal.authorization.signature = crypto::encode_base64url(&[0u8; 64]);
    let events = [commit, reveal];
    let transcript = verify_events(&events, &f.context);
    let reports = event_reports(
        &events,
        &transcript,
        &index_attachments(&[attachment(b"photo bytes")]),
    );
    assert!(!reports[0].signature_valid);
    assert_eq!(reports[0].commitment_opening, Some(true));
    assert_eq!(reports[0].manifest.status, "INTEGRITY_VALID");
    assert_eq!(
        transcript.proof_events.len(),
        1,
        "unsigned reveal is never a direct proof record"
    );
}

#[test]
fn missing_commitment_and_invalid_opening_are_distinct_from_missing_blob() {
    let f = Fixture::new();
    let (commit, reveal) = f.commitment_and_reveal(&manifest("11"), &[12u8; 32]);
    let transcript = verify_events(std::slice::from_ref(&reveal), &f.context);
    let reports = event_reports(
        std::slice::from_ref(&reveal),
        &transcript,
        &AttachmentIndex::default(),
    );
    assert!(reports[0].signature_valid);
    assert_eq!(reports[0].commitment_opening, None);
    assert_eq!(reports[0].commitment_status, "MISSING_COMMITMENT");
    assert_eq!(reports[0].manifest.status, "INCOMPLETE");
    let wrong = f.event(
        "O",
        1,
        Some(&commit),
        EventBody::EvidenceReveal {
            dispute_id: "dispute-1".into(),
            round_id: "round-1".into(),
            commitment_event_hash: hash(&commit),
            salt_b64: crypto::encode_base64url(&[13u8; 32]),
            manifest: manifest("11"),
        },
    );
    let events = [commit, wrong];
    let transcript = verify_events(&events, &f.context);
    let reports = event_reports(
        &events,
        &transcript,
        &index_attachments(&[attachment(b"photo bytes")]),
    );
    assert_eq!(reports[0].commitment_opening, Some(false));
    assert_eq!(reports[0].commitment_status, "INVALID");
    assert_eq!(reports[0].manifest.status, "INTEGRITY_VALID");
}

#[test]
fn a_forged_duplicate_cannot_shadow_a_valid_manifest_event_report() {
    let f = Fixture::new();
    let good = f.event(
        "O",
        0,
        None,
        EventBody::CompletionClaim {
            milestone_id: "work".into(),
            manifest: manifest("11"),
        },
    );
    let mut bad = good.clone();
    bad.authorization.signature = crypto::encode_base64url(&[0u8; 64]);
    let index = index_attachments(&[attachment(b"photo bytes")]);
    let a = [bad.clone(), good.clone()];
    let b = [good, bad];
    let left = event_reports(&a, &verify_events(&a, &f.context), &index);
    let right = event_reports(&b, &verify_events(&b, &f.context), &index);
    assert_eq!(left, right);
    assert_eq!(left.len(), 1);
    assert!(left[0].signature_valid);
}
