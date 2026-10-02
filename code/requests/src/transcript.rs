// SPDX-License-Identifier: AGPL-3.0-only
//! Attributed observations in independent signed author streams.
//!
//! Admission here establishes signatures, local policy and supplied causal
//! references. It never creates an obligation, proves a physical claim, consults
//! a clock, or establishes that this is the complete/latest history.

use crate::{crypto, encoding, money::Money};
use p256::ecdsa::SigningKey;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const MAX_EVENTS: usize = 1_000;
const MAX_EVENT_BYTES: usize = 256 * 1024;
const MAX_REFERENCES: usize = 64;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ArtifactRef {
    pub sha256: String,
    pub byte_length: String,
    pub media_type: String,
    pub capture_reference: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EvidenceManifest {
    pub artifacts: Vec<ArtifactRef>,
    pub description: String,
}

impl EvidenceManifest {
    pub fn validate(&self) -> Result<(), String> {
        prose(&self.description, 16_384, true)?;
        if self.artifacts.len() > 256 {
            return Err("MANIFEST_LIMIT: at most 256 artifacts are supported".into());
        }
        let mut hashes = BTreeSet::new();
        for artifact in &self.artifacts {
            encoding::validate_digest(&artifact.sha256)?;
            decimal(&artifact.byte_length)?;
            if !hashes.insert(&artifact.sha256) {
                return Err("MANIFEST_DUPLICATE: artifact digest appears more than once".into());
            }
            if artifact.media_type.is_empty()
                || artifact.media_type.len() > 128
                || !artifact.media_type.contains('/')
                || !artifact.media_type.bytes().all(|b| b.is_ascii_graphic())
            {
                return Err("MEDIA_TYPE: expected a bounded ASCII media type".into());
            }
            if let Some(reference) = &artifact.capture_reference {
                encoding::validate_id(reference)?;
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum EventBody {
    StartClaim,
    CompletionClaim {
        milestone_id: String,
        manifest: EvidenceManifest,
    },
    RejectionClaim {
        completion_hash: String,
        reason: String,
    },
    DisputeOpened {
        dispute_id: String,
        subject_id: String,
        reason: String,
    },
    Recommendation {
        dispute_id: String,
        text: String,
    },
    AssuranceClaim {
        case_id: String,
        commitment_id: String,
        details: String,
    },
    AssuranceAssessment {
        case_id: String,
        position: String,
    },
    CancellationNotice {
        reason: String,
    },
    EvidenceCommitment {
        dispute_id: String,
        round_id: String,
        commitment: String,
    },
    EvidenceReveal {
        dispute_id: String,
        round_id: String,
        commitment_event_hash: String,
        salt_b64: String,
        manifest: EvidenceManifest,
    },
    SupplementaryEvidence {
        dispute_id: String,
        round_id: String,
        manifest: EvidenceManifest,
    },
    ReceiptAcknowledgment {
        event_hash: String,
    },
    PayerStatement {
        obligation_id: String,
        amount: Money,
        reference: String,
    },
    MediatorPaymentObservation {
        obligation_id: String,
        amount: Money,
        reference: String,
    },
    PaymentReversalClaim {
        payment_certificate_id: String,
        reason: String,
    },
}

// Serde's internally tagged unit variant otherwise accepts additional fields
// even with deny_unknown_fields. Explicit admission closes START_CLAIM too.
impl<'de> Deserialize<'de> for EventBody {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::Error;
        let mut fields = BTreeMap::<String, serde_json::Value>::deserialize(deserializer)?;
        let kind = fields
            .remove("type")
            .ok_or_else(|| D::Error::custom("missing event type"))?;
        let kind = kind
            .as_str()
            .ok_or_else(|| D::Error::custom("event type must be a string"))?;
        macro_rules! field {
            ($name:literal) => {
                serde_json::from_value(
                    fields
                        .remove($name)
                        .ok_or_else(|| D::Error::custom(concat!("missing ", $name)))?,
                )
                .map_err(D::Error::custom)?
            };
        }
        let body = match kind {
            "START_CLAIM" => Self::StartClaim,
            "COMPLETION_CLAIM" => Self::CompletionClaim {
                milestone_id: field!("milestone_id"),
                manifest: field!("manifest"),
            },
            "REJECTION_CLAIM" => Self::RejectionClaim {
                completion_hash: field!("completion_hash"),
                reason: field!("reason"),
            },
            "DISPUTE_OPENED" => Self::DisputeOpened {
                dispute_id: field!("dispute_id"),
                subject_id: field!("subject_id"),
                reason: field!("reason"),
            },
            "RECOMMENDATION" => Self::Recommendation {
                dispute_id: field!("dispute_id"),
                text: field!("text"),
            },
            "ASSURANCE_CLAIM" => Self::AssuranceClaim {
                case_id: field!("case_id"),
                commitment_id: field!("commitment_id"),
                details: field!("details"),
            },
            "ASSURANCE_ASSESSMENT" => Self::AssuranceAssessment {
                case_id: field!("case_id"),
                position: field!("position"),
            },
            "CANCELLATION_NOTICE" => Self::CancellationNotice {
                reason: field!("reason"),
            },
            "EVIDENCE_COMMITMENT" => Self::EvidenceCommitment {
                dispute_id: field!("dispute_id"),
                round_id: field!("round_id"),
                commitment: field!("commitment"),
            },
            "EVIDENCE_REVEAL" => Self::EvidenceReveal {
                dispute_id: field!("dispute_id"),
                round_id: field!("round_id"),
                commitment_event_hash: field!("commitment_event_hash"),
                salt_b64: field!("salt_b64"),
                manifest: field!("manifest"),
            },
            "SUPPLEMENTARY_EVIDENCE" => Self::SupplementaryEvidence {
                dispute_id: field!("dispute_id"),
                round_id: field!("round_id"),
                manifest: field!("manifest"),
            },
            "RECEIPT_ACKNOWLEDGMENT" => Self::ReceiptAcknowledgment {
                event_hash: field!("event_hash"),
            },
            "PAYER_STATEMENT" => Self::PayerStatement {
                obligation_id: field!("obligation_id"),
                amount: field!("amount"),
                reference: field!("reference"),
            },
            "MEDIATOR_PAYMENT_OBSERVATION" => Self::MediatorPaymentObservation {
                obligation_id: field!("obligation_id"),
                amount: field!("amount"),
                reference: field!("reference"),
            },
            "PAYMENT_REVERSAL_CLAIM" => Self::PaymentReversalClaim {
                payment_certificate_id: field!("payment_certificate_id"),
                reason: field!("reason"),
            },
            _ => return Err(D::Error::custom("unknown event type")),
        };
        if !fields.is_empty() {
            return Err(D::Error::custom("unknown event body field"));
        }
        Ok(body)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EventEnvelope {
    pub protocol_version: String,
    pub deployment_domain: String,
    pub assignment_id: String,
    pub agreement_hash: String,
    pub author_role: String,
    pub key_id: String,
    pub key_epoch: String,
    pub sequence: String,
    pub previous_event_hash: Option<String>,
    pub nonce: String,
    pub causal_references: Vec<String>,
    /// An attributed claim, never authoritative time or notice evidence.
    pub claimed_creation_time: Option<String>,
    pub body: EventBody,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SignedEvent {
    pub envelope: EventEnvelope,
    pub authorization: crypto::DetachedSignature,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventContext {
    pub deployment_domain: String,
    pub assignment_id: String,
    pub agreement_hash: String,
    pub keys: Vec<crypto::KeyBinding>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EventDiagnostic {
    pub event_hash: String,
    pub code: String,
    pub message: String,
    pub missing_references: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EventStatus {
    pub signature_valid: bool,
    pub policy_valid: bool,
    /// Every referenced ancestor is supplied and authenticated in this view.
    /// Presence does not imply admissibility: inspect `status` and `accepted`
    /// for rejected, conflicted, or blocked records and their descendants.
    pub causal_complete: bool,
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EventConflict {
    pub kind: String,
    pub assignment_id: String,
    pub author_role: String,
    pub key_epoch: String,
    pub sequence: String,
    pub dispute_id: Option<String>,
    pub round_id: Option<String>,
    pub event_hashes: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EvidenceRoundReport {
    pub dispute_id: String,
    pub round_id: String,
    pub committed_roles: Vec<String>,
    pub revealed_roles: Vec<String>,
    pub conflicted_roles: Vec<String>,
    pub supplementary_event_hashes: Vec<String>,
    pub premature_reveal_event_hashes: Vec<String>,
    pub status: String,
    pub secrecy_weakened: bool,
    pub nonresponse_is_fault: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct DeliveryAcknowledgment {
    pub recipient_role: String,
    pub acknowledgment_hash: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TranscriptReport {
    /// Only causally admitted observations. These are not authorized effects.
    pub accepted: BTreeMap<String, SignedEvent>,
    /// Authenticated records, including every conflicting branch and pending item.
    pub retained_events: BTreeMap<String, SignedEvent>,
    /// Authenticated, body-valid records whose direct identity/proof relations
    /// validate against authenticated records. Contextual ancestor conflicts
    /// do not erase this evidence. This map grants no contractual authority;
    /// each financial rule must check its own exact Agreement/role/body proof.
    pub proof_events: BTreeMap<String, SignedEvent>,
    pub pending: Vec<EventDiagnostic>,
    pub rejected: Vec<EventDiagnostic>,
    pub warnings: Vec<EventDiagnostic>,
    pub conflicts: Vec<EventConflict>,
    pub event_status: BTreeMap<String, EventStatus>,
    pub rounds: Vec<EvidenceRoundReport>,
    pub delivery_acknowledgments: BTreeMap<String, Vec<DeliveryAcknowledgment>>,
    pub duplicate_count: usize,
    pub completeness_unknown: bool,
}

impl Default for TranscriptReport {
    fn default() -> Self {
        Self {
            accepted: BTreeMap::new(),
            retained_events: BTreeMap::new(),
            proof_events: BTreeMap::new(),
            pending: Vec::new(),
            rejected: Vec::new(),
            warnings: Vec::new(),
            conflicts: Vec::new(),
            event_status: BTreeMap::new(),
            rounds: Vec::new(),
            delivery_acknowledgments: BTreeMap::new(),
            duplicate_count: 0,
            completeness_unknown: true,
        }
    }
}

fn claims(envelope: &EventEnvelope) -> Result<crypto::SignatureClaims, String> {
    Ok(crypto::SignatureClaims {
        protocol_version: envelope.protocol_version.clone(),
        deployment_domain: envelope.deployment_domain.clone(),
        assignment_id: envelope.assignment_id.clone(),
        content_hash: encoding::digest(envelope)?,
        role: envelope.author_role.clone(),
        key_id: envelope.key_id.clone(),
        purpose: "EVENT".into(),
    })
}

pub fn sign_event(envelope: &EventEnvelope, key: &SigningKey) -> Result<SignedEvent, String> {
    validate_envelope(envelope)?;
    validate_body(envelope)?;
    Ok(SignedEvent {
        envelope: envelope.clone(),
        authorization: crypto::sign(&claims(envelope)?, key)?,
    })
}

/// Verify a supplied local view, reconciling out-of-order records deterministically.
/// Unsupported or incomplete data cannot be interpreted as contractual authority.
pub fn verify_events(events: &[SignedEvent], context: &EventContext) -> TranscriptReport {
    verify_events_for_agreements(
        events,
        context,
        &BTreeSet::from([context.agreement_hash.clone()]),
    )
}

/// The caller supplies only fully authorized, nonconflicted Agreement hashes.
/// Amendments do not reset author sequences or permit replay into new terms.
pub fn verify_events_for_agreements(
    events: &[SignedEvent],
    context: &EventContext,
    agreement_hashes: &BTreeSet<String>,
) -> TranscriptReport {
    let mut report = TranscriptReport::default();
    if events.len() > MAX_EVENTS {
        report.rejected.push(diagnostic(
            "",
            "EVENT_LIMIT",
            "At most 1000 events may be supplied.",
            vec![],
        ));
        return report;
    }
    if let Err(error) = validate_context(context) {
        report
            .rejected
            .push(diagnostic("", "EVENT_CONTEXT", &error, vec![]));
        return report;
    }
    if agreement_hashes.is_empty()
        || agreement_hashes
            .iter()
            .any(|hash| encoding::validate_digest(hash).is_err())
    {
        report.rejected.push(diagnostic(
            "",
            "EVENT_CONTEXT",
            "Expected nonempty authorized Agreement digests.",
            vec![],
        ));
        return report;
    }

    // Only authenticated, correctly scoped envelopes participate in conflicts.
    // A forged competing record must never suspend an authentic author stream.
    for event in events {
        let hash = match encoding::digest(&event.envelope) {
            Ok(hash) => hash,
            Err(error) => {
                report
                    .rejected
                    .push(diagnostic("", "EVENT_ENCODING", &error, vec![]));
                continue;
            }
        };
        let result = authenticate(event, context, agreement_hashes);
        if let Err(error) = result {
            // Do not overwrite a valid record's status when a forged copy uses
            // the same envelope with a damaged/different authorization.
            report
                .event_status
                .entry(hash.clone())
                .or_insert(EventStatus {
                    signature_valid: false,
                    policy_valid: false,
                    causal_complete: false,
                    status: "REJECTED".into(),
                });
            report
                .rejected
                .push(diagnostic(&hash, "EVENT_AUTHENTICATION", &error, vec![]));
            continue;
        }
        if report.retained_events.contains_key(&hash) {
            report.duplicate_count += 1;
            continue;
        }
        let policy = validate_body(&event.envelope);
        report.event_status.insert(
            hash.clone(),
            EventStatus {
                signature_valid: true,
                policy_valid: policy.is_ok(),
                causal_complete: false,
                status: if policy.is_ok() {
                    "PENDING"
                } else {
                    "REJECTED"
                }
                .into(),
            },
        );
        report.retained_events.insert(hash.clone(), event.clone());
        if let Err(error) = policy {
            report
                .rejected
                .push(diagnostic(&hash, "EVENT_POLICY", &error, vec![]));
        }
    }

    // A stream is a delivery/ordering projection, not an authority to retract
    // someone else's signed acknowledgment. Keep direct evidence independent
    // of contextual stream admission and preserve exact competing bodies.
    let body_valid: BTreeMap<_, _> = report
        .retained_events
        .iter()
        .filter(|(_, event)| validate_body(&event.envelope).is_ok())
        .map(|(hash, event)| (hash.clone(), event.clone()))
        .collect();
    report.proof_events = body_valid
        .iter()
        .filter(|(_, event)| validate_relations(event, &body_valid).is_ok())
        .map(|(hash, event)| (hash.clone(), event.clone()))
        .collect();

    let mut blocked = BTreeSet::new();
    detect_conflicts(&mut report, &mut blocked);
    let mut remaining: BTreeSet<String> = report
        .retained_events
        .keys()
        .filter(|hash| report.event_status[*hash].policy_valid && !blocked.contains(*hash))
        .cloned()
        .collect();
    loop {
        let mut progress = false;
        for hash in remaining.clone() {
            let event = &report.retained_events[&hash];
            let dependencies = dependencies(&event.envelope);
            if !dependencies
                .iter()
                .all(|dependency| report.accepted.contains_key(dependency))
            {
                continue;
            }
            let relation = validate_relations(event, &report.accepted);
            remaining.remove(&hash);
            progress = true;
            if let Err(error) = relation {
                report.event_status.get_mut(&hash).unwrap().status = "REJECTED".into();
                report.event_status.get_mut(&hash).unwrap().policy_valid = false;
                report
                    .rejected
                    .push(diagnostic(&hash, "EVENT_RELATION", &error, vec![]));
                continue;
            }
            let status = report.event_status.get_mut(&hash).unwrap();
            status.status = "ACCEPTED".into();
            report.accepted.insert(hash, event.clone());
        }
        if !progress {
            break;
        }
    }
    for hash in blocked {
        report.event_status.get_mut(&hash).unwrap().status = "CONFLICTED".into();
        report.pending.push(diagnostic(
            &hash,
            "EVENT_CONFLICTED",
            "Signed conflicting records are retained; no branch is selected.",
            vec![],
        ));
    }
    for hash in remaining {
        let missing: Vec<String> = dependencies(&report.retained_events[&hash].envelope)
            .into_iter()
            .filter(|dependency| !report.accepted.contains_key(dependency))
            .collect();
        let code = if missing
            .iter()
            .any(|dependency| !report.retained_events.contains_key(dependency))
        {
            "MISSING_EVENT_DEPENDENCY"
        } else {
            "BLOCKED_EVENT_DEPENDENCY"
        };
        report.pending.push(diagnostic(
            &hash,
            code,
            "Required records are missing, rejected, conflicted, or causally unresolved.",
            missing,
        ));
    }
    // Causal presence and admission are separate facts. A supplied conflicting
    // predecessor is present even though neither it nor its child may be used.
    for (hash, event) in &report.retained_events {
        report.event_status.get_mut(hash).unwrap().causal_complete =
            ancestors(&event.envelope, &report.retained_events)
                .iter()
                .all(|ancestor| report.retained_events.contains_key(ancestor));
    }
    derive_rounds_and_receipts(&mut report);
    report
        .pending
        .sort_by(|a, b| (&a.event_hash, &a.code).cmp(&(&b.event_hash, &b.code)));
    report.rejected.sort_by(|a, b| {
        (&a.event_hash, &a.code, &a.message).cmp(&(&b.event_hash, &b.code, &b.message))
    });
    report
        .warnings
        .sort_by(|a, b| (&a.event_hash, &a.code).cmp(&(&b.event_hash, &b.code)));
    report
}

fn validate_context(context: &EventContext) -> Result<(), String> {
    encoding::validate_domain(&context.deployment_domain)?;
    encoding::validate_id(&context.assignment_id)?;
    encoding::validate_digest(&context.agreement_hash)?;
    if context.keys.len() != 3 {
        return Err("Exactly one pinned key per R/O/M role is required.".into());
    }
    let roles: BTreeSet<&str> = context.keys.iter().map(|key| key.role.as_str()).collect();
    if roles != BTreeSet::from(["R", "O", "M"]) {
        return Err("Pinned R/O/M key roles must be unique.".into());
    }
    Ok(())
}

fn authenticate(
    event: &SignedEvent,
    context: &EventContext,
    agreement_hashes: &BTreeSet<String>,
) -> Result<(), String> {
    validate_envelope(&event.envelope)?;
    if encoding::canonical(event)?.len() > MAX_EVENT_BYTES {
        return Err("EVENT_SIZE: signed event exceeds 256 KiB".into());
    }
    let envelope = &event.envelope;
    if envelope.deployment_domain != context.deployment_domain
        || envelope.assignment_id != context.assignment_id
        || !agreement_hashes.contains(&envelope.agreement_hash)
    {
        return Err(
            "EVENT_SCOPE: event does not belong to this deployment, assignment and agreement"
                .into(),
        );
    }
    let key = context
        .keys
        .iter()
        .find(|key| key.role == envelope.author_role && key.key_id == envelope.key_id)
        .ok_or("EVENT_KEY: author key is not pinned for this role")?;
    crypto::verify(&event.authorization, &claims(envelope)?, key)
}

fn validate_envelope(envelope: &EventEnvelope) -> Result<(), String> {
    if !matches!(envelope.protocol_version.as_str(), "1" | "2") || envelope.key_epoch != "1" {
        return Err(
            "EVENT_VERSION: only protocols 1/2 and pinned key epoch 1 are supported".into(),
        );
    }
    encoding::validate_domain(&envelope.deployment_domain)?;
    encoding::validate_id(&envelope.assignment_id)?;
    encoding::validate_digest(&envelope.agreement_hash)?;
    if !["R", "O", "M"].contains(&envelope.author_role.as_str()) {
        return Err("EVENT_ROLE: unknown role".into());
    }
    encoding::validate_id(&envelope.key_id)?;
    encoding::validate_id(&envelope.nonce)?;
    let sequence = decimal(&envelope.sequence)?;
    match (&envelope.previous_event_hash, sequence) {
        (None, 0) => (),
        (Some(hash), n) if n > 0 => encoding::validate_digest(hash)?,
        _ => {
            return Err(
                "EVENT_SEQUENCE: sequence zero has no predecessor; every later event requires one"
                    .into(),
            );
        }
    }
    if envelope.causal_references.len() > MAX_REFERENCES {
        return Err("EVENT_REFERENCE_LIMIT: at most 64 causal references".into());
    }
    let mut references = BTreeSet::new();
    for reference in &envelope.causal_references {
        encoding::validate_digest(reference)?;
        if !references.insert(reference) {
            return Err("EVENT_REFERENCE_DUPLICATE: repeated causal reference".into());
        }
    }
    if let Some(time) = &envelope.claimed_creation_time {
        decimal(time)?;
    }
    Ok(())
}

pub(crate) fn validate_body(envelope: &EventEnvelope) -> Result<(), String> {
    use EventBody::*;
    let role = envelope.author_role.as_str();
    let expected_role = match &envelope.body {
        StartClaim | CompletionClaim { .. } => Some("O"),
        RejectionClaim { .. } | PayerStatement { .. } => Some("R"),
        AssuranceAssessment { .. } | MediatorPaymentObservation { .. } => Some("M"),
        _ => None,
    };
    if expected_role.is_some_and(|expected| expected != role) {
        return Err("EVENT_ROLE_POLICY: event type is not permitted for this role".into());
    }
    match &envelope.body {
        StartClaim => (),
        CompletionClaim {
            milestone_id,
            manifest,
        } => {
            encoding::validate_id(milestone_id)?;
            manifest.validate()?;
        }
        RejectionClaim {
            completion_hash,
            reason,
        } => {
            required_reference(envelope, completion_hash)?;
            prose(reason, 16_384, false)?;
        }
        DisputeOpened {
            dispute_id,
            subject_id,
            reason,
        } => {
            encoding::validate_id(dispute_id)?;
            encoding::validate_id(subject_id)?;
            prose(reason, 16_384, false)?;
        }
        Recommendation { dispute_id, text } => {
            encoding::validate_id(dispute_id)?;
            prose(text, 16_384, false)?;
        }
        AssuranceClaim {
            case_id,
            commitment_id,
            details,
        } => {
            encoding::validate_id(case_id)?;
            encoding::validate_id(commitment_id)?;
            prose(details, 16_384, false)?;
        }
        AssuranceAssessment { case_id, position } => {
            encoding::validate_id(case_id)?;
            prose(position, 16_384, false)?;
        }
        CancellationNotice { reason } => prose(reason, 16_384, false)?,
        EvidenceCommitment {
            dispute_id,
            round_id,
            commitment,
        } => {
            encoding::validate_id(dispute_id)?;
            encoding::validate_id(round_id)?;
            encoding::validate_digest(commitment)?;
        }
        EvidenceReveal {
            dispute_id,
            round_id,
            commitment_event_hash,
            salt_b64,
            manifest,
        } => {
            encoding::validate_id(dispute_id)?;
            encoding::validate_id(round_id)?;
            required_reference(envelope, commitment_event_hash)?;
            crypto::decode_base64url(salt_b64, 32)?;
            manifest.validate()?;
        }
        SupplementaryEvidence {
            dispute_id,
            round_id,
            manifest,
        } => {
            encoding::validate_id(dispute_id)?;
            encoding::validate_id(round_id)?;
            manifest.validate()?;
        }
        ReceiptAcknowledgment { event_hash } => required_reference(envelope, event_hash)?,
        PayerStatement {
            obligation_id,
            amount,
            reference,
        }
        | MediatorPaymentObservation {
            obligation_id,
            amount,
            reference,
        } => {
            encoding::validate_id(obligation_id)?;
            amount.validate()?;
            prose(reference, 4_096, false)?;
        }
        PaymentReversalClaim {
            payment_certificate_id,
            reason,
        } => {
            encoding::validate_digest(payment_certificate_id)?;
            prose(reason, 16_384, false)?;
        }
    }
    Ok(())
}

fn required_reference(envelope: &EventEnvelope, hash: &str) -> Result<(), String> {
    encoding::validate_digest(hash)?;
    if !envelope
        .causal_references
        .iter()
        .any(|reference| reference == hash)
    {
        return Err(
            "EVENT_CAUSAL_REFERENCE: body reference must also be an explicit causal reference"
                .into(),
        );
    }
    Ok(())
}

fn dependencies(envelope: &EventEnvelope) -> BTreeSet<String> {
    envelope
        .causal_references
        .iter()
        .chain(envelope.previous_event_hash.iter())
        .cloned()
        .collect()
}

fn validate_relations(
    event: &SignedEvent,
    accepted: &BTreeMap<String, SignedEvent>,
) -> Result<(), String> {
    let envelope = &event.envelope;
    if let Some(previous_hash) = &envelope.previous_event_hash {
        let previous = &accepted
            .get(previous_hash)
            .ok_or("EVENT_PREDECESSOR: missing predecessor")?
            .envelope;
        if previous.author_role != envelope.author_role
            || previous.key_id != envelope.key_id
            || previous.key_epoch != envelope.key_epoch
            || decimal(&previous.sequence)?.checked_add(1) != Some(decimal(&envelope.sequence)?)
        {
            return Err("EVENT_PREDECESSOR: predecessor must be the immediately prior event in the same author's pinned stream".into());
        }
    }
    match &envelope.body {
        EventBody::RejectionClaim {
            completion_hash, ..
        } => {
            if !matches!(
                accepted
                    .get(completion_hash)
                    .map(|event| &event.envelope.body),
                Some(EventBody::CompletionClaim { .. })
            ) {
                return Err("REJECTION_REFERENCE: rejection must name an admitted Operator completion claim".into());
            }
        }
        EventBody::EvidenceReveal { .. } => verify_commitment_opening(event, accepted)?,
        EventBody::ReceiptAcknowledgment { event_hash } if !accepted.contains_key(event_hash) => {
            return Err("RECEIPT_REFERENCE: acknowledged authenticated record is missing".into());
        }
        _ => (),
    }
    Ok(())
}

/// Check the exact authenticated commitment opening independently of ordering
/// admission. `authenticated` must come from this verifier's retained records;
/// this result says nothing about attachment integrity, secrecy or truth.
pub fn verify_commitment_opening(
    event: &SignedEvent,
    authenticated: &BTreeMap<String, SignedEvent>,
) -> Result<(), String> {
    let envelope = &event.envelope;
    validate_body(envelope)?;
    let EventBody::EvidenceReveal {
        dispute_id,
        round_id,
        commitment_event_hash,
        salt_b64,
        manifest,
    } = &envelope.body
    else {
        return Err("REVEAL_TYPE: expected an evidence reveal".into());
    };
    let committed = &authenticated
        .get(commitment_event_hash)
        .ok_or("MISSING_COMMITMENT: authenticated commitment is unavailable")?
        .envelope;
    validate_body(committed)?;
    let EventBody::EvidenceCommitment {
        dispute_id: committed_dispute,
        round_id: committed_round,
        commitment,
    } = &committed.body
    else {
        return Err("REVEAL_REFERENCE: named record is not a commitment".into());
    };
    if committed.author_role != envelope.author_role
        || committed.key_id != envelope.key_id
        || committed.protocol_version != envelope.protocol_version
        || committed.deployment_domain != envelope.deployment_domain
        || committed.assignment_id != envelope.assignment_id
        || committed_dispute != dispute_id
        || committed_round != round_id
        || committed.agreement_hash != envelope.agreement_hash
    {
        return Err("REVEAL_SCOPE: opening must match its author's commitment and exact assignment, Agreement and round".into());
    }
    let salt: [u8; 32] = crypto::decode_base64url(salt_b64, 32)?
        .try_into()
        .map_err(|_| "REVEAL_SALT: expected 32 bytes")?;
    let context = crypto::CommitmentContext {
        deployment_domain: envelope.deployment_domain.clone(),
        assignment_id: envelope.assignment_id.clone(),
        agreement_hash: envelope.agreement_hash.clone(),
        dispute_id: dispute_id.clone(),
        round_id: round_id.clone(),
        author_role: envelope.author_role.clone(),
        manifest_digest: encoding::digest(manifest)?,
    };
    crypto::verify_commitment(&context, &salt, commitment)
}

fn detect_conflicts(report: &mut TranscriptReport, blocked: &mut BTreeSet<String>) {
    type StreamSlot = (String, String, String);
    type RoundSlot = (String, String, String);
    let mut streams: BTreeMap<StreamSlot, Vec<String>> = BTreeMap::new();
    let mut rounds: BTreeMap<RoundSlot, Vec<String>> = BTreeMap::new();
    let mut nonces: BTreeMap<(String, String), Vec<String>> = BTreeMap::new();
    for (hash, event) in &report.retained_events {
        let envelope = &event.envelope;
        streams
            .entry((
                envelope.author_role.clone(),
                envelope.key_epoch.clone(),
                envelope.sequence.clone(),
            ))
            .or_default()
            .push(hash.clone());
        nonces
            .entry((envelope.author_role.clone(), envelope.nonce.clone()))
            .or_default()
            .push(hash.clone());
        if report.event_status[hash].policy_valid
            && let EventBody::EvidenceCommitment {
                dispute_id,
                round_id,
                ..
            } = &envelope.body
        {
            rounds
                .entry((
                    envelope.author_role.clone(),
                    dispute_id.clone(),
                    round_id.clone(),
                ))
                .or_default()
                .push(hash.clone());
        }
    }
    for ((_role, _epoch, _sequence), hashes) in
        streams.into_iter().filter(|(_, hashes)| hashes.len() > 1)
    {
        let envelope = &report.retained_events[&hashes[0]].envelope;
        report.conflicts.push(conflict(
            "STREAM_EQUIVOCATION",
            envelope,
            None,
            None,
            hashes.clone(),
        ));
        blocked.extend(hashes);
    }
    for ((_role, dispute, round), hashes) in
        rounds.into_iter().filter(|(_, hashes)| hashes.len() > 1)
    {
        let envelope = &report.retained_events[&hashes[0]].envelope;
        report.conflicts.push(conflict(
            "ROUND_COMMITMENT_CONFLICT",
            envelope,
            Some(dispute),
            Some(round),
            hashes.clone(),
        ));
        blocked.extend(hashes);
    }
    for ((_role, _nonce), hashes) in nonces.into_iter().filter(|(_, hashes)| hashes.len() > 1) {
        let envelope = &report.retained_events[&hashes[0]].envelope;
        report.conflicts.push(conflict(
            "AUTHOR_NONCE_REUSE",
            envelope,
            None,
            None,
            hashes.clone(),
        ));
        blocked.extend(hashes);
    }
}

fn conflict(
    kind: &str,
    envelope: &EventEnvelope,
    dispute_id: Option<String>,
    round_id: Option<String>,
    event_hashes: Vec<String>,
) -> EventConflict {
    EventConflict {
        kind: kind.into(),
        assignment_id: envelope.assignment_id.clone(),
        author_role: envelope.author_role.clone(),
        key_epoch: envelope.key_epoch.clone(),
        sequence: envelope.sequence.clone(),
        dispute_id,
        round_id,
        event_hashes,
    }
}

fn derive_rounds_and_receipts(report: &mut TranscriptReport) {
    let mut rounds: BTreeMap<(String, String), EvidenceRoundReport> = BTreeMap::new();
    for (hash, event) in &report.accepted {
        let envelope = &event.envelope;
        match &envelope.body {
            EventBody::EvidenceCommitment {
                dispute_id,
                round_id,
                ..
            } => {
                round(&mut rounds, dispute_id, round_id)
                    .committed_roles
                    .push(envelope.author_role.clone());
            }
            EventBody::EvidenceReveal {
                dispute_id,
                round_id,
                ..
            } => {
                round(&mut rounds, dispute_id, round_id)
                    .revealed_roles
                    .push(envelope.author_role.clone());
            }
            EventBody::SupplementaryEvidence {
                dispute_id,
                round_id,
                ..
            } => {
                round(&mut rounds, dispute_id, round_id)
                    .supplementary_event_hashes
                    .push(hash.clone());
            }
            EventBody::ReceiptAcknowledgment { event_hash } => {
                report
                    .delivery_acknowledgments
                    .entry(event_hash.clone())
                    .or_default()
                    .push(DeliveryAcknowledgment {
                        recipient_role: envelope.author_role.clone(),
                        acknowledgment_hash: hash.clone(),
                    });
            }
            _ => (),
        }
    }
    // Disclosure is a fact about received plaintext, not admission. A signed
    // invalid opening or withheld dependency cannot make recipients forget the
    // supplied manifest. Only admitted openings count as revealed submissions.
    for (hash, event) in &report.retained_events {
        let envelope = &event.envelope;
        match &envelope.body {
            EventBody::EvidenceCommitment {
                dispute_id,
                round_id,
                ..
            }
            | EventBody::EvidenceReveal {
                dispute_id,
                round_id,
                ..
            }
            | EventBody::SupplementaryEvidence {
                dispute_id,
                round_id,
                ..
            } => {
                let entry = round(&mut rounds, dispute_id, round_id);
                if report.event_status[hash].status == "CONFLICTED" {
                    entry.conflicted_roles.push(envelope.author_role.clone());
                }
                if matches!(envelope.body, EventBody::EvidenceReveal { .. }) {
                    if !report.accepted.contains_key(hash) {
                        report.warnings.push(diagnostic(hash, "UNADMITTED_EVIDENCE_DISCLOSURE", "An authenticated reveal discloses its manifest and claimed salt even though its opening is rejected, conflicted, or pending. Disclosure cannot be undone; this is not an admitted reveal, fault finding, or financial effect.", vec![]));
                    }
                    let earlier_roles: BTreeSet<&str> =
                        ancestors(envelope, &report.retained_events)
                            .iter()
                            .filter_map(|ancestor| {
                                let earlier = &report.accepted.get(ancestor)?.envelope;
                                match &earlier.body {
                                    EventBody::EvidenceCommitment {
                                        dispute_id: d,
                                        round_id: r,
                                        ..
                                    } if d == dispute_id
                                        && r == round_id
                                        && earlier.agreement_hash == envelope.agreement_hash =>
                                    {
                                        Some(earlier.author_role.as_str())
                                    }
                                    _ => None,
                                }
                            })
                            .collect();
                    if earlier_roles != BTreeSet::from(["R", "O", "M"]) {
                        entry.premature_reveal_event_hashes.push(hash.clone());
                        entry.secrecy_weakened = true;
                        report.warnings.push(diagnostic(hash, "EARLY_EVIDENCE_REVEAL", "The supplied view lacks causal evidence of admitted commitments by all R/O/M roles under the exact Agreement before disclosure. Secrecy before disclosure is unsupported and cannot be restored by rejecting the reveal; no fault or financial effect is inferred.", vec![]));
                    }
                }
            }
            _ => (),
        }
    }
    for mut entry in rounds.into_values() {
        entry.committed_roles.sort();
        entry.committed_roles.dedup();
        entry.revealed_roles.sort();
        entry.revealed_roles.dedup();
        entry.conflicted_roles.sort();
        entry.conflicted_roles.dedup();
        entry.status = if !entry.conflicted_roles.is_empty() {
            "CONFLICTED"
        } else if entry.revealed_roles.len() == 3 {
            "REVEALED"
        } else if entry.committed_roles.len() == 3 && entry.revealed_roles.is_empty() {
            "COMMITTED"
        } else {
            "INCOMPLETE"
        }
        .into();
        report.rounds.push(entry);
    }
}

fn round<'a>(
    rounds: &'a mut BTreeMap<(String, String), EvidenceRoundReport>,
    dispute: &str,
    id: &str,
) -> &'a mut EvidenceRoundReport {
    rounds
        .entry((dispute.into(), id.into()))
        .or_insert_with(|| EvidenceRoundReport {
            dispute_id: dispute.into(),
            round_id: id.into(),
            committed_roles: Vec::new(),
            revealed_roles: Vec::new(),
            conflicted_roles: Vec::new(),
            supplementary_event_hashes: Vec::new(),
            premature_reveal_event_hashes: Vec::new(),
            status: "INCOMPLETE".into(),
            secrecy_weakened: false,
            nonresponse_is_fault: false,
        })
}

fn ancestors(
    envelope: &EventEnvelope,
    accepted: &BTreeMap<String, SignedEvent>,
) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    let mut pending: Vec<String> = dependencies(envelope).into_iter().collect();
    while let Some(hash) = pending.pop() {
        if found.insert(hash.clone())
            && let Some(event) = accepted.get(&hash)
        {
            pending.extend(dependencies(&event.envelope));
        }
    }
    found
}

fn decimal(value: &str) -> Result<u64, String> {
    if value.is_empty()
        || value.len() > 16
        || !value.bytes().all(|b| b.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return Err("EVENT_DECIMAL: expected canonical bounded nonnegative decimal string".into());
    }
    let number: u64 = value.parse().map_err(|_| "EVENT_DECIMAL: overflow")?;
    if number > encoding::MAX_SAFE_INTEGER {
        return Err("EVENT_DECIMAL: value exceeds interoperable bound".into());
    }
    Ok(number)
}

fn prose(value: &str, limit: usize, empty_allowed: bool) -> Result<(), String> {
    if value.len() > limit
        || (!empty_allowed && value.trim().is_empty())
        || value
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t')
    {
        return Err("EVENT_TEXT: empty, oversized or unsupported control-character text".into());
    }
    Ok(())
}

fn diagnostic(
    hash: &str,
    code: &str,
    message: &str,
    missing_references: Vec<String>,
) -> EventDiagnostic {
    EventDiagnostic {
        event_hash: hash.into(),
        code: code.into(),
        message: message.into(),
        missing_references,
    }
}
