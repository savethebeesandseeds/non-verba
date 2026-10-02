// SPDX-License-Identifier: AGPL-3.0-only
use nonverba_requests::{crypto, encoding, money::Money, transcript::*};
use p256::ecdsa::SigningKey;

struct Fixture {
    keys: [SigningKey; 3],
    context: EventContext,
}

impl Fixture {
    fn new() -> Self {
        let keys = [1u8, 2, 3].map(|n| SigningKey::from_bytes((&[n; 32]).into()).unwrap());
        let context = EventContext {
            deployment_domain: "local.test".into(),
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
    fn key(&self, role: &str) -> &SigningKey {
        &self.keys[match role {
            "R" => 0,
            "O" => 1,
            "M" => 2,
            _ => panic!("role"),
        }]
    }
    fn envelope(
        &self,
        role: &str,
        sequence: u64,
        previous: Option<&SignedEvent>,
        body: EventBody,
    ) -> EventEnvelope {
        EventEnvelope {
            protocol_version: "1".into(),
            deployment_domain: self.context.deployment_domain.clone(),
            assignment_id: self.context.assignment_id.clone(),
            agreement_hash: self.context.agreement_hash.clone(),
            author_role: role.into(),
            key_id: format!("key-{role}"),
            key_epoch: "1".into(),
            sequence: sequence.to_string(),
            previous_event_hash: previous.map(hash),
            nonce: format!("nonce-{role}-{sequence}"),
            causal_references: vec![],
            claimed_creation_time: Some("0".into()),
            body,
        }
    }
    fn event(
        &self,
        role: &str,
        sequence: u64,
        previous: Option<&SignedEvent>,
        body: EventBody,
    ) -> SignedEvent {
        sign_event(
            &self.envelope(role, sequence, previous, body),
            self.key(role),
        )
        .unwrap()
    }
    fn commit(&self, role: &str, manifest: &EvidenceManifest, salt: &[u8; 32]) -> SignedEvent {
        let context = crypto::CommitmentContext {
            deployment_domain: self.context.deployment_domain.clone(),
            assignment_id: self.context.assignment_id.clone(),
            agreement_hash: self.context.agreement_hash.clone(),
            dispute_id: "dispute-1".into(),
            round_id: "round-1".into(),
            author_role: role.into(),
            manifest_digest: encoding::digest(manifest).unwrap(),
        };
        self.event(
            role,
            0,
            None,
            EventBody::EvidenceCommitment {
                dispute_id: "dispute-1".into(),
                round_id: "round-1".into(),
                commitment: crypto::commitment(&context, salt).unwrap(),
            },
        )
    }
    fn reveal(
        &self,
        role: &str,
        commitment: &SignedEvent,
        causal: &[SignedEvent],
        manifest: &EvidenceManifest,
        salt: &[u8; 32],
    ) -> SignedEvent {
        let mut envelope = self.envelope(
            role,
            1,
            Some(commitment),
            EventBody::EvidenceReveal {
                dispute_id: "dispute-1".into(),
                round_id: "round-1".into(),
                commitment_event_hash: hash(commitment),
                salt_b64: crypto::encode_base64url(salt),
                manifest: manifest.clone(),
            },
        );
        envelope.causal_references = causal.iter().map(hash).collect();
        sign_event(&envelope, self.key(role)).unwrap()
    }
}

fn hash(event: &SignedEvent) -> String {
    encoding::digest(&event.envelope).unwrap()
}
fn cancel() -> EventBody {
    EventBody::CancellationNotice {
        reason: "Attributed notice, no debt erasure.".into(),
    }
}
fn manifest() -> EvidenceManifest {
    EvidenceManifest {
        artifacts: vec![ArtifactRef {
            sha256: encoding::bytes_digest(b"photo bytes"),
            byte_length: "11".into(),
            media_type: "image/jpeg".into(),
            capture_reference: Some("capture-1".into()),
        }],
        description: "A claimed photograph; its physical interpretation remains disputed.".into(),
    }
}

/// Test-only malicious signer: bypass local signing policy while producing a
/// genuine signature so verifier admission, not the helper, is under test.
fn maliciously_sign(envelope: EventEnvelope, key: &SigningKey) -> SignedEvent {
    let claims = crypto::SignatureClaims {
        protocol_version: envelope.protocol_version.clone(),
        deployment_domain: envelope.deployment_domain.clone(),
        assignment_id: envelope.assignment_id.clone(),
        content_hash: encoding::digest(&envelope).unwrap(),
        role: envelope.author_role.clone(),
        key_id: envelope.key_id.clone(),
        purpose: "EVENT".into(),
    };
    SignedEvent {
        authorization: crypto::sign(&claims, key).unwrap(),
        envelope,
    }
}

#[test]
fn separate_authors_can_concurrently_reference_same_prior_event() {
    let f = Fixture::new();
    let common = f.event("M", 0, None, cancel());
    let mut r = f.envelope("R", 0, None, cancel());
    r.causal_references.push(hash(&common));
    let mut o = f.envelope("O", 0, None, EventBody::StartClaim);
    o.causal_references.push(hash(&common));
    let r = sign_event(&r, f.key("R")).unwrap();
    let o = sign_event(&o, f.key("O")).unwrap();
    let report = verify_events(&[r, o, common], &f.context);
    assert_eq!(report.accepted.len(), 3);
    assert!(report.conflicts.is_empty());
    assert!(report.pending.is_empty());
    assert!(report.completeness_unknown);
}

#[test]
fn missing_dependencies_are_pending_then_reconciled_independent_of_input_order() {
    let f = Fixture::new();
    let first = f.event("O", 0, None, EventBody::StartClaim);
    let second = f.event(
        "O",
        1,
        Some(&first),
        EventBody::CompletionClaim {
            milestone_id: "work".into(),
            manifest: manifest(),
        },
    );
    let report = verify_events(std::slice::from_ref(&second), &f.context);
    assert!(report.accepted.is_empty());
    assert_eq!(report.pending[0].code, "MISSING_EVENT_DEPENDENCY");
    assert_eq!(report.pending[0].missing_references, vec![hash(&first)]);
    assert!(report.event_status[&hash(&second)].signature_valid);
    assert!(!report.event_status[&hash(&second)].causal_complete);
    let forward = verify_events(&[first.clone(), second.clone()], &f.context);
    let reverse = verify_events(&[second, first], &f.context);
    assert_eq!(forward.accepted, reverse.accepted);
    assert_eq!(forward.accepted.len(), 2);
}

#[test]
fn identical_retransmissions_are_idempotent() {
    let f = Fixture::new();
    let event = f.event("O", 0, None, EventBody::StartClaim);
    let report = verify_events(&[event.clone(), event.clone(), event], &f.context);
    assert_eq!(report.accepted.len(), 1);
    assert_eq!(report.duplicate_count, 2);
    assert!(report.conflicts.is_empty());
}

#[test]
fn equivocation_retains_both_bodies_and_suspends_only_their_descendants() {
    let f = Fixture::new();
    let first = f.event("O", 0, None, EventBody::StartClaim);
    let mut competing = f.envelope("O", 0, None, cancel());
    competing.nonce = "different-nonce".into();
    let competing = sign_event(&competing, f.key("O")).unwrap();
    let child = f.event("O", 1, Some(&first), cancel());
    let independent = f.event("R", 0, None, cancel());
    let report = verify_events(
        &[
            child.clone(),
            competing.clone(),
            independent.clone(),
            first.clone(),
        ],
        &f.context,
    );
    assert_eq!(
        report.accepted.keys().cloned().collect::<Vec<_>>(),
        vec![hash(&independent)]
    );
    assert_eq!(report.retained_events.len(), 4);
    assert_eq!(report.conflicts.len(), 1);
    assert_eq!(report.conflicts[0].kind, "STREAM_EQUIVOCATION");
    assert_eq!(report.conflicts[0].event_hashes.len(), 2);
    assert_eq!(report.event_status[&hash(&first)].status, "CONFLICTED");
    assert_eq!(report.event_status[&hash(&competing)].status, "CONFLICTED");
    assert_eq!(report.event_status[&hash(&child)].status, "PENDING");
    assert!(report.event_status[&hash(&first)].causal_complete);
    assert!(report.event_status[&hash(&competing)].causal_complete);
    assert!(
        report.event_status[&hash(&child)].causal_complete,
        "conflicted dependencies are present but not admissible"
    );
}

#[test]
fn forged_conflicting_record_does_not_taint_authentic_stream() {
    let f = Fixture::new();
    let first = f.event("O", 0, None, EventBody::StartClaim);
    let mut forged = first.clone();
    forged.envelope.body = cancel();
    forged.envelope.nonce = "forged".into();
    let report = verify_events(&[forged, first.clone()], &f.context);
    assert_eq!(report.accepted.len(), 1);
    assert!(report.accepted.contains_key(&hash(&first)));
    assert!(report.conflicts.is_empty());
    assert_eq!(report.rejected.len(), 1);
}

#[test]
fn invalid_signature_copy_cannot_overwrite_a_valid_status_in_either_order() {
    let f = Fixture::new();
    let valid = f.event("O", 0, None, EventBody::StartClaim);
    let mut invalid = valid.clone();
    invalid.authorization.signature = crypto::encode_base64url(&[0u8; 64]);
    for events in [
        vec![valid.clone(), invalid.clone()],
        vec![invalid, valid.clone()],
    ] {
        let report = verify_events(&events, &f.context);
        assert_eq!(report.accepted.len(), 1);
        assert!(report.event_status[&hash(&valid)].signature_valid);
        assert_eq!(report.event_status[&hash(&valid)].status, "ACCEPTED");
    }
}

#[test]
fn wrong_domain_assignment_agreement_role_key_and_purpose_are_rejected() {
    let f = Fixture::new();
    let valid = f.event("O", 0, None, EventBody::StartClaim);
    let mut wrongs = Vec::new();
    let mut item = valid.clone();
    item.envelope.deployment_domain = "other.test".into();
    wrongs.push(item);
    let mut item = valid.clone();
    item.envelope.assignment_id = "other-assignment".into();
    wrongs.push(item);
    let mut item = valid.clone();
    item.envelope.agreement_hash = "cd".repeat(32);
    wrongs.push(item);
    let mut item = valid.clone();
    item.envelope.author_role = "M".into();
    wrongs.push(item);
    let mut item = valid.clone();
    item.envelope.key_id = "unknown".into();
    wrongs.push(item);
    let mut item = valid.clone();
    item.authorization.claims.purpose = "PAYMENT_RECEIPT".into();
    wrongs.push(item);
    for item in wrongs {
        let report = verify_events(&[item], &f.context);
        assert!(report.accepted.is_empty());
        assert_eq!(report.rejected.len(), 1);
    }
    let mut another_domain = valid.envelope.clone();
    another_domain.deployment_domain = "other.test".into();
    let report = verify_events(&[maliciously_sign(another_domain, f.key("O"))], &f.context);
    assert!(
        report.accepted.is_empty(),
        "even a freshly valid signature cannot cross deployment scope"
    );
}

#[test]
fn authentic_wrong_role_claim_is_attributed_but_not_admitted() {
    let f = Fixture::new();
    for (role, body) in [
        ("R", EventBody::StartClaim),
        (
            "M",
            EventBody::CompletionClaim {
                milestone_id: "work".into(),
                manifest: manifest(),
            },
        ),
        (
            "O",
            EventBody::AssuranceAssessment {
                case_id: "case-1".into(),
                position: "denied".into(),
            },
        ),
    ] {
        let item = maliciously_sign(f.envelope(role, 0, None, body), f.key(role));
        let report = verify_events(std::slice::from_ref(&item), &f.context);
        assert!(report.accepted.is_empty());
        assert!(report.event_status[&hash(&item)].signature_valid);
        assert!(!report.event_status[&hash(&item)].policy_valid);
    }
}

#[test]
fn predecessor_must_be_own_immediately_prior_stream_event() {
    let f = Fixture::new();
    let r = f.event("R", 0, None, cancel());
    let o = f.event("O", 1, Some(&r), EventBody::StartClaim);
    let report = verify_events(&[r.clone(), o], &f.context);
    assert_eq!(report.accepted.len(), 1);
    assert!(report.accepted.contains_key(&hash(&r)));
    assert!(report.rejected[0].message.contains("EVENT_PREDECESSOR"));
}

#[test]
fn strict_schema_and_decimal_limits_reject_ambiguous_events() {
    let f = Fixture::new();
    let event = f.event("O", 0, None, EventBody::StartClaim);
    let mut value = serde_json::to_value(&event).unwrap();
    value["envelope"]["administrator_override"] = true.into();
    assert!(encoding::strict_parse::<SignedEvent>(&serde_json::to_vec(&value).unwrap()).is_err());
    let mut value = serde_json::to_value(&event).unwrap();
    value["envelope"]["body"]["unknown"] = true.into();
    assert!(encoding::strict_parse::<SignedEvent>(&serde_json::to_vec(&value).unwrap()).is_err());
    for sequence in ["00", "-1", "1.0", "1e2", " 0", "9007199254740992"] {
        let mut envelope = event.envelope.clone();
        envelope.sequence = sequence.into();
        assert!(sign_event(&envelope, f.key("O")).is_err());
    }
    let too_many = vec![event; MAX_EVENTS + 1];
    let report = verify_events(&too_many, &f.context);
    assert!(report.accepted.is_empty());
    assert_eq!(report.rejected[0].code, "EVENT_LIMIT");
}

#[test]
fn full_round_commits_reveals_and_reorders_without_clock_assumptions() {
    let f = Fixture::new();
    let manifest = manifest();
    let salts = [[11u8; 32], [12u8; 32], [13u8; 32]];
    let commits: Vec<_> = ["R", "O", "M"]
        .iter()
        .enumerate()
        .map(|(i, role)| f.commit(role, &manifest, &salts[i]))
        .collect();
    let mut events: Vec<_> = ["R", "O", "M"]
        .iter()
        .enumerate()
        .map(|(i, role)| f.reveal(role, &commits[i], &commits, &manifest, &salts[i]))
        .collect();
    events.extend(commits);
    let report = verify_events(&events, &f.context);
    assert_eq!(report.accepted.len(), 6);
    assert!(report.rejected.is_empty());
    assert!(report.pending.is_empty());
    assert_eq!(report.rounds[0].status, "REVEALED");
    assert!(!report.rounds[0].secrecy_weakened);
    assert!(!report.rounds[0].nonresponse_is_fault);
    assert!(report.completeness_unknown);
}

#[test]
fn wrong_salt_manifest_and_round_fail_even_with_real_author_signatures() {
    let f = Fixture::new();
    let original = manifest();
    let salt = [42u8; 32];
    let commit = f.commit("O", &original, &salt);
    let wrong_salt = f.reveal(
        "O",
        &commit,
        std::slice::from_ref(&commit),
        &original,
        &[43u8; 32],
    );
    let mut changed = original.clone();
    changed.artifacts[0].sha256 = encoding::bytes_digest(b"changed photo");
    let wrong_manifest = f.reveal("O", &commit, std::slice::from_ref(&commit), &changed, &salt);
    let mut wrong_round = f
        .reveal(
            "O",
            &commit,
            std::slice::from_ref(&commit),
            &original,
            &salt,
        )
        .envelope;
    if let EventBody::EvidenceReveal { round_id, .. } = &mut wrong_round.body {
        *round_id = "round-2".into();
    }
    let wrong_round = sign_event(&wrong_round, f.key("O")).unwrap();
    for opening in [wrong_salt, wrong_manifest, wrong_round] {
        let report = verify_events(&[opening, commit.clone()], &f.context);
        assert_eq!(report.accepted.len(), 1);
        assert_eq!(report.rejected.len(), 1);
        assert!(
            report
                .rounds
                .iter()
                .all(|round| round.revealed_roles.is_empty())
        );
    }
}

#[test]
fn another_role_cannot_open_a_commitment_as_its_own() {
    let f = Fixture::new();
    let manifest = manifest();
    let salt = [7u8; 32];
    let commit = f.commit("O", &manifest, &salt);
    let mut envelope = f.envelope(
        "R",
        0,
        None,
        EventBody::EvidenceReveal {
            dispute_id: "dispute-1".into(),
            round_id: "round-1".into(),
            commitment_event_hash: hash(&commit),
            salt_b64: crypto::encode_base64url(&salt),
            manifest,
        },
    );
    envelope.causal_references.push(hash(&commit));
    let reveal = sign_event(&envelope, f.key("R")).unwrap();
    let report = verify_events(&[commit, reveal], &f.context);
    assert_eq!(report.accepted.len(), 1);
    assert!(report.rejected[0].message.contains("REVEAL_SCOPE"));
}

#[test]
fn early_reveal_is_retained_and_later_commitments_cannot_erase_disclosure() {
    let f = Fixture::new();
    let manifest = manifest();
    let salt = [4u8; 32];
    let o = f.commit("O", &manifest, &salt);
    let reveal = f.reveal("O", &o, std::slice::from_ref(&o), &manifest, &salt);
    let r = f.commit("R", &manifest, &[5u8; 32]);
    let m = f.commit("M", &manifest, &[6u8; 32]);
    let report = verify_events(&[r, m, o, reveal.clone()], &f.context);
    assert_eq!(report.accepted.len(), 4);
    assert_eq!(report.rounds[0].status, "INCOMPLETE");
    assert!(report.rounds[0].secrecy_weakened);
    assert_eq!(
        report.rounds[0].premature_reveal_event_hashes,
        vec![hash(&reveal)]
    );
    assert_eq!(report.warnings[0].code, "EARLY_EVIDENCE_REVEAL");
    assert!(!report.rounds[0].nonresponse_is_fault);
}

#[test]
fn withheld_reveals_and_claimed_deadlines_never_establish_fault() {
    let f = Fixture::new();
    let manifest = manifest();
    let mut events: Vec<_> = ["R", "O", "M"]
        .iter()
        .enumerate()
        .map(|(i, role)| f.commit(role, &manifest, &[i as u8 + 1; 32]))
        .collect();
    let mut statement = f.envelope(
        "M",
        1,
        Some(&events[2]),
        EventBody::Recommendation {
            dispute_id: "dispute-1".into(),
            text: "I claim a deadline elapsed; this remains a proposal only.".into(),
        },
    );
    statement.claimed_creation_time = Some("9007199254740991".into());
    events.push(sign_event(&statement, f.key("M")).unwrap());
    let report = verify_events(&events, &f.context);
    assert_eq!(report.accepted.len(), 4);
    assert_eq!(report.rounds[0].status, "COMMITTED");
    assert!(report.rounds[0].revealed_roles.is_empty());
    assert!(!report.rounds[0].nonresponse_is_fault);
}

#[test]
fn conflicting_initial_commitments_cannot_replace_a_prior_round_submission() {
    let f = Fixture::new();
    let manifest = manifest();
    let first = f.commit("O", &manifest, &[1u8; 32]);
    let other = f.commit("O", &manifest, &[2u8; 32]);
    let next = f.event("O", 1, Some(&first), other.envelope.body);
    let report = verify_events(&[first, next], &f.context);
    assert!(report.accepted.is_empty());
    assert_eq!(report.retained_events.len(), 2);
    assert!(
        report
            .conflicts
            .iter()
            .any(|conflict| conflict.kind == "ROUND_COMMITMENT_CONFLICT")
    );
    assert_eq!(report.rounds[0].status, "CONFLICTED");
}

#[test]
fn later_evidence_is_preserved_as_a_separate_supplementary_submission() {
    let f = Fixture::new();
    let original = manifest();
    let commit = f.commit("O", &original, &[5u8; 32]);
    let reveal = f.reveal(
        "O",
        &commit,
        std::slice::from_ref(&commit),
        &original,
        &[5u8; 32],
    );
    let supplementary = f.event(
        "O",
        2,
        Some(&reveal),
        EventBody::SupplementaryEvidence {
            dispute_id: "dispute-1".into(),
            round_id: "supplement-1".into(),
            manifest: EvidenceManifest {
                artifacts: vec![],
                description: "New material account.".into(),
            },
        },
    );
    let report = verify_events(&[supplementary.clone(), reveal, commit], &f.context);
    assert_eq!(report.accepted.len(), 3);
    assert_eq!(report.rounds.len(), 2);
    assert_eq!(
        report
            .rounds
            .iter()
            .find(|round| round.round_id == "supplement-1")
            .unwrap()
            .supplementary_event_hashes,
        vec![hash(&supplementary)]
    );
}

#[test]
fn acknowledgment_is_separate_from_the_claim_and_does_not_gate_admission() {
    let f = Fixture::new();
    let claim = f.event(
        "O",
        0,
        None,
        EventBody::CompletionClaim {
            milestone_id: "work".into(),
            manifest: manifest(),
        },
    );
    let mut envelope = f.envelope(
        "M",
        0,
        None,
        EventBody::ReceiptAcknowledgment {
            event_hash: hash(&claim),
        },
    );
    envelope.causal_references.push(hash(&claim));
    let receipt = sign_event(&envelope, f.key("M")).unwrap();
    let no_receipt = verify_events(std::slice::from_ref(&claim), &f.context);
    assert_eq!(no_receipt.accepted.len(), 1);
    let report = verify_events(&[receipt, claim.clone()], &f.context);
    assert_eq!(report.accepted.len(), 2);
    assert_eq!(
        report.delivery_acknowledgments[&hash(&claim)][0].recipient_role,
        "M"
    );
}

#[test]
fn payment_statements_and_mediator_observations_remain_typed_claims() {
    let f = Fixture::new();
    let amount = Money::new("1500", "EUR").unwrap();
    let payer = f.event(
        "R",
        0,
        None,
        EventBody::PayerStatement {
            obligation_id: "compensation-1".into(),
            amount: amount.clone(),
            reference: "bank-reference".into(),
        },
    );
    let mediator = f.event(
        "M",
        0,
        None,
        EventBody::MediatorPaymentObservation {
            obligation_id: "compensation-1".into(),
            amount,
            reference: "mediator-webhook".into(),
        },
    );
    let report = verify_events(&[payer, mediator], &f.context);
    assert_eq!(report.accepted.len(), 2);
    assert!(report.delivery_acknowledgments.is_empty());
}

#[test]
fn authorized_amendments_keep_one_continuous_author_stream() {
    let f = Fixture::new();
    let first = f.event("O", 0, None, EventBody::StartClaim);
    let mut next = f.envelope("O", 1, Some(&first), cancel());
    next.agreement_hash = "de".repeat(32);
    let second = sign_event(&next, f.key("O")).unwrap();
    let authorized = std::collections::BTreeSet::from([
        f.context.agreement_hash.clone(),
        next.agreement_hash.clone(),
    ]);
    let report =
        verify_events_for_agreements(&[second.clone(), first.clone()], &f.context, &authorized);
    assert_eq!(report.accepted.len(), 2);
    assert!(report.conflicts.is_empty());
    let singleton = verify_events(&[second, first.clone()], &f.context);
    assert_eq!(singleton.accepted.len(), 1);
    let mut reset = next;
    reset.sequence = "0".into();
    reset.previous_event_hash = None;
    let reset = sign_event(&reset, f.key("O")).unwrap();
    let report = verify_events_for_agreements(&[reset, first], &f.context, &authorized);
    assert!(
        report.accepted.is_empty(),
        "new agreement does not grant a new stream slot"
    );
    assert_eq!(report.conflicts[0].kind, "STREAM_EQUIVOCATION");
}

#[test]
fn withheld_commitment_cannot_hide_received_reveal_plaintext() {
    let f = Fixture::new();
    let manifest = manifest();
    let salt = [31u8; 32];
    let commitment = f.commit("O", &manifest, &salt);
    let reveal = f.reveal(
        "O",
        &commitment,
        std::slice::from_ref(&commitment),
        &manifest,
        &salt,
    );
    let report = verify_events(std::slice::from_ref(&reveal), &f.context);
    assert!(report.accepted.is_empty());
    assert_eq!(report.event_status[&hash(&reveal)].status, "PENDING");
    assert!(!report.event_status[&hash(&reveal)].causal_complete);
    assert!(report.retained_events.contains_key(&hash(&reveal)));
    assert!(
        report
            .warnings
            .iter()
            .any(|item| item.code == "UNADMITTED_EVIDENCE_DISCLOSURE"
                && item.event_hash == hash(&reveal))
    );
    assert!(
        report
            .warnings
            .iter()
            .any(|item| item.code == "EARLY_EVIDENCE_REVEAL")
    );
    assert!(report.rounds[0].secrecy_weakened);
    assert!(report.rounds[0].revealed_roles.is_empty());
    assert!(!report.rounds[0].nonresponse_is_fault);
}

#[test]
fn invalid_opening_still_discloses_its_authenticated_manifest() {
    let f = Fixture::new();
    let manifest = manifest();
    let commitment = f.commit("O", &manifest, &[32u8; 32]);
    let reveal = f.reveal(
        "O",
        &commitment,
        std::slice::from_ref(&commitment),
        &manifest,
        &[33u8; 32],
    );
    let report = verify_events(&[reveal.clone(), commitment], &f.context);
    let status = &report.event_status[&hash(&reveal)];
    assert!(status.signature_valid);
    assert!(!status.policy_valid);
    assert!(
        status.causal_complete,
        "all required records are present even when the opening is invalid"
    );
    assert_eq!(status.status, "REJECTED");
    assert!(
        report
            .warnings
            .iter()
            .any(|item| item.code == "UNADMITTED_EVIDENCE_DISCLOSURE")
    );
    assert!(report.rounds[0].secrecy_weakened);
    assert_eq!(
        report.rounds[0].premature_reveal_event_hashes,
        vec![hash(&reveal)]
    );
    assert!(report.rounds[0].revealed_roles.is_empty());
}

#[test]
fn malformed_signed_salt_cannot_suppress_the_disclosure_warning() {
    let f = Fixture::new();
    let manifest = manifest();
    let salt = [34u8; 32];
    let commitment = f.commit("O", &manifest, &salt);
    let mut envelope = f
        .reveal(
            "O",
            &commitment,
            std::slice::from_ref(&commitment),
            &manifest,
            &salt,
        )
        .envelope;
    if let EventBody::EvidenceReveal { salt_b64, .. } = &mut envelope.body {
        *salt_b64 = "not-a-32-byte-salt".into();
    }
    let reveal = maliciously_sign(envelope, f.key("O"));
    let report = verify_events(&[commitment, reveal.clone()], &f.context);
    assert_eq!(report.event_status[&hash(&reveal)].status, "REJECTED");
    assert!(
        report
            .warnings
            .iter()
            .any(|item| item.code == "UNADMITTED_EVIDENCE_DISCLOSURE")
    );
    assert!(report.rounds[0].secrecy_weakened);
    assert!(report.rounds[0].revealed_roles.is_empty());
}

#[test]
fn invalid_opening_after_complete_commitments_is_disclosed_but_not_called_early() {
    let f = Fixture::new();
    let manifest = manifest();
    let commits: Vec<_> = ["R", "O", "M"]
        .into_iter()
        .enumerate()
        .map(|(i, role)| f.commit(role, &manifest, &[i as u8 + 40; 32]))
        .collect();
    let reveal = f.reveal("O", &commits[1], &commits, &manifest, &[99u8; 32]);
    let mut events = commits;
    events.push(reveal.clone());
    let report = verify_events(&events, &f.context);
    assert_eq!(report.event_status[&hash(&reveal)].status, "REJECTED");
    assert!(report.event_status[&hash(&reveal)].causal_complete);
    assert_eq!(report.warnings.len(), 1);
    assert_eq!(report.warnings[0].code, "UNADMITTED_EVIDENCE_DISCLOSURE");
    assert_eq!(report.rounds[0].status, "COMMITTED");
    assert!(report.rounds[0].revealed_roles.is_empty());
    assert!(!report.rounds[0].secrecy_weakened);
}

#[test]
fn a_conflicting_signed_reveal_still_records_disclosure_without_admitting_it() {
    let f = Fixture::new();
    let manifest = manifest();
    let salt = [50u8; 32];
    let commitment = f.commit("O", &manifest, &salt);
    let reveal = f.reveal(
        "O",
        &commitment,
        std::slice::from_ref(&commitment),
        &manifest,
        &salt,
    );
    let mut alternate = f.envelope("O", 1, Some(&commitment), cancel());
    alternate.nonce = "alternate-branch".into();
    let alternate = sign_event(&alternate, f.key("O")).unwrap();
    let report = verify_events(&[alternate, commitment, reveal.clone()], &f.context);
    assert_eq!(report.event_status[&hash(&reveal)].status, "CONFLICTED");
    assert!(report.event_status[&hash(&reveal)].causal_complete);
    assert!(
        report
            .warnings
            .iter()
            .any(|item| item.code == "UNADMITTED_EVIDENCE_DISCLOSURE")
    );
    assert_eq!(report.rounds[0].status, "CONFLICTED");
    assert!(report.rounds[0].revealed_roles.is_empty());
    assert!(report.rounds[0].secrecy_weakened);
}

#[test]
fn forged_reveal_cannot_attribute_disclosure_to_the_claimed_author() {
    let f = Fixture::new();
    let manifest = manifest();
    let salt = [51u8; 32];
    let commitment = f.commit("O", &manifest, &salt);
    let mut forged = f.reveal(
        "O",
        &commitment,
        std::slice::from_ref(&commitment),
        &manifest,
        &salt,
    );
    forged.authorization.signature = crypto::encode_base64url(&[0u8; 64]);
    let report = verify_events(&[commitment, forged], &f.context);
    assert!(report.warnings.is_empty());
    assert!(!report.rounds[0].secrecy_weakened);
    assert!(report.rounds[0].revealed_roles.is_empty());
}

#[test]
fn causal_presence_does_not_admit_a_rejected_predecessor_or_its_descendants() {
    let f = Fixture::new();
    let invalid = maliciously_sign(f.envelope("R", 0, None, EventBody::StartClaim), f.key("R"));
    let child = f.event("R", 1, Some(&invalid), cancel());
    let independent = f.event("O", 0, None, EventBody::StartClaim);
    let report = verify_events(&[child.clone(), invalid.clone(), independent], &f.context);
    assert_eq!(report.accepted.len(), 1);
    assert_eq!(report.event_status[&hash(&invalid)].status, "REJECTED");
    assert_eq!(report.event_status[&hash(&child)].status, "PENDING");
    assert!(report.event_status[&hash(&invalid)].causal_complete);
    assert!(report.event_status[&hash(&child)].causal_complete);
    assert!(
        report
            .pending
            .iter()
            .any(|item| item.event_hash == hash(&child) && item.code == "BLOCKED_EVENT_DEPENDENCY")
    );
}

#[test]
fn causal_completeness_includes_missing_transitive_ancestors() {
    let f = Fixture::new();
    let absent = f.event("O", 0, None, EventBody::StartClaim);
    let parent = f.event("O", 1, Some(&absent), cancel());
    let child = f.event("O", 2, Some(&parent), cancel());
    let report = verify_events(&[child.clone(), parent.clone()], &f.context);
    assert!(report.accepted.is_empty());
    assert!(!report.event_status[&hash(&parent)].causal_complete);
    assert!(
        !report.event_status[&hash(&child)].causal_complete,
        "the immediate parent alone does not complete its history"
    );
}

#[test]
fn contextual_mediator_fork_does_not_erase_direct_operator_proof() {
    let f = Fixture::new();
    let m = f.event("M", 0, None, cancel());
    let mut fork = f.envelope("M", 0, None, cancel());
    fork.nonce = "forked-mediator".into();
    let fork = sign_event(&fork, f.key("M")).unwrap();
    let mut completion = f.envelope(
        "O",
        0,
        None,
        EventBody::CompletionClaim {
            milestone_id: "work".into(),
            manifest: manifest(),
        },
    );
    completion.causal_references.push(hash(&m));
    let completion = sign_event(&completion, f.key("O")).unwrap();
    let prefix = verify_events(&[m.clone(), completion.clone()], &f.context);
    assert!(prefix.accepted.contains_key(&hash(&completion)));
    let report = verify_events(&[completion.clone(), fork, m], &f.context);
    assert!(!report.accepted.contains_key(&hash(&completion)));
    assert!(report.proof_events.contains_key(&hash(&completion)));
    assert_eq!(report.conflicts.len(), 1);
    assert_eq!(
        report.proof_events.len(),
        3,
        "both authenticated branches remain evidence, not authorized effects"
    );
}

#[test]
fn direct_proof_checks_identity_body_and_authentication_without_contextual_admission() {
    let f = Fixture::new();
    let m = f.event("M", 0, None, cancel());
    let invalid_predecessor = f.event(
        "O",
        1,
        Some(&m),
        EventBody::CompletionClaim {
            milestone_id: "work".into(),
            manifest: manifest(),
        },
    );
    let invalid_role = maliciously_sign(
        f.envelope(
            "R",
            0,
            None,
            EventBody::CompletionClaim {
                milestone_id: "work".into(),
                manifest: manifest(),
            },
        ),
        f.key("R"),
    );
    let mut forged = f.event("O", 0, None, EventBody::StartClaim);
    forged.authorization.signature = crypto::encode_base64url(&[0u8; 64]);
    let report = verify_events(
        &[m.clone(), invalid_predecessor, invalid_role, forged],
        &f.context,
    );
    assert_eq!(
        report.proof_events.keys().cloned().collect::<Vec<_>>(),
        vec![hash(&m)]
    );
}

#[test]
fn direct_reveal_opening_is_preserved_across_contextual_commitment_conflict() {
    let f = Fixture::new();
    let manifest = manifest();
    let salt = [71u8; 32];
    let commitment = f.commit("O", &manifest, &salt);
    let mut competing = f.envelope("O", 0, None, cancel());
    competing.nonce = "competing-commitment-slot".into();
    let competing = sign_event(&competing, f.key("O")).unwrap();
    let reveal = f.reveal(
        "O",
        &commitment,
        std::slice::from_ref(&commitment),
        &manifest,
        &salt,
    );
    let report = verify_events(&[competing, commitment.clone(), reveal.clone()], &f.context);
    assert!(!report.accepted.contains_key(&hash(&reveal)));
    assert!(report.proof_events.contains_key(&hash(&reveal)));
    assert!(verify_commitment_opening(&reveal, &report.retained_events).is_ok());
    let wrong = f.reveal(
        "O",
        &commitment,
        std::slice::from_ref(&commitment),
        &manifest,
        &[72u8; 32],
    );
    let report = verify_events(&[commitment, wrong.clone()], &f.context);
    assert!(!report.proof_events.contains_key(&hash(&wrong)));
    assert!(verify_commitment_opening(&wrong, &report.retained_events).is_err());
}

#[test]
fn protocol_two_event_signs_and_authenticates_its_actual_version() {
    let f = Fixture::new();
    let mut envelope = f.envelope("O", 0, None, EventBody::StartClaim);
    envelope.protocol_version = "2".into();
    let event = sign_event(&envelope, f.key("O")).unwrap();
    assert_eq!(event.authorization.claims.protocol_version, "2");
    let report = verify_events(std::slice::from_ref(&event), &f.context);
    assert!(report.accepted.contains_key(&hash(&event)));
    let mut changed = event;
    changed.envelope.protocol_version = "1".into();
    assert!(
        verify_events(&[changed], &f.context)
            .retained_events
            .is_empty()
    );
}

#[test]
fn old_revision_claim_after_new_revision_is_retained_as_proof_without_assigning_authority() {
    let f = Fixture::new();
    let old_hash = f.context.agreement_hash.clone();
    let new_hash = "cd".repeat(32);
    let mut new = f.envelope("O", 0, None, EventBody::StartClaim);
    new.protocol_version = "2".into();
    new.agreement_hash = new_hash.clone();
    let new = sign_event(&new, f.key("O")).unwrap();
    let mut old = f.envelope(
        "O",
        1,
        Some(&new),
        EventBody::CompletionClaim {
            milestone_id: "work".into(),
            manifest: manifest(),
        },
    );
    old.protocol_version = "2".into();
    let old = sign_event(&old, f.key("O")).unwrap();
    let allowed = std::collections::BTreeSet::from([old_hash.clone(), new_hash]);
    let report = verify_events_for_agreements(&[new, old.clone()], &f.context, &allowed);
    assert!(report.proof_events.contains_key(&hash(&old)));
    assert_eq!(
        report.proof_events[&hash(&old)].envelope.agreement_hash,
        old_hash
    );
    // Transcript admission cannot decide amendment cutover or payment authority.
    assert!(report.accepted.contains_key(&hash(&old)));
}
