// SPDX-License-Identifier: AGPL-3.0-only
//! Reconstructed from the corrective handoff text, not supplied upstream tests.
//! The first run used policy 1. Current helpers explicitly sign policy 2; the
//! captured policy-1 baseline files are preserved separately and never upgraded.
//! PUBLIC TEST KEYS and synthetic receipts only; no real payment is represented.
mod common;

use common::*;
use nonverba_requests::{
    bundle::verify_assignment_bundle, encoding, model::*, transcript, transcript::EventBody,
};
use p256::ecdsa::SigningKey;

const RECEIPT_REFERENCE: &str = "SYNTHETIC TEST PAYEE RECEIPT - no funds moved";

fn work(report: &BundleReport) -> &Obligation {
    report
        .obligations
        .iter()
        .find(|obligation| obligation.id == "milestone:work")
        .expect("an established Operator receivable must remain represented")
}

// Set only during deliberate baseline export. Ordinary tests do not write files.
fn capture(
    name: &str,
    bundle: &AssignmentBundle,
    trust: &TrustConfiguration,
    report: &BundleReport,
) {
    println!(
        "RECONSTRUCTED CASE {name}: {}",
        serde_json::to_string(report).unwrap()
    );
    if let Some(directory) = std::env::var_os("NONVERBA_REVIEW_BASELINE_DIR") {
        let directory = std::path::PathBuf::from(directory);
        std::fs::create_dir_all(&directory).unwrap();
        for (suffix, value) in [
            ("bundle", serde_json::to_value(bundle).unwrap()),
            ("trust", serde_json::to_value(trust).unwrap()),
            ("report", serde_json::to_value(report).unwrap()),
        ] {
            use std::io::Write;
            let mut output = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(directory.join(format!("{name}-{suffix}.json")))
                .expect("baseline exports are immutable; choose a fresh directory for another run");
            output
                .write_all(&serde_json::to_vec_pretty(&value).unwrap())
                .unwrap();
        }
    }
}

fn receipt(
    bundle: &AssignmentBundle,
    keys: &[SigningKey; 3],
    entitlement: &str,
    payment_id: &str,
    obligation_id: &str,
    amount: &str,
    author: Role,
) -> ActionCertificate {
    sign_action(
        bundle,
        keys,
        Action::PaymentReceipt {
            payment_id: payment_id.into(),
            obligation_id: obligation_id.into(),
            amount: money(amount),
            rail_reference: RECEIPT_REFERENCE.into(),
        },
        &[author],
        &[entitlement.into()],
        &format!("review-{}-{amount}-{}", author.code(), payment_id),
    )
}

fn paid_baseline() -> (
    AssignmentBundle,
    TrustConfiguration,
    [SigningKey; 3],
    String,
) {
    let (mut bundle, trust, keys) = fixture();
    let entitlement = establish_compensation(&mut bundle, &keys);
    bundle.actions.push(receipt(
        &bundle,
        &keys,
        &entitlement,
        "review-payment",
        "milestone:work",
        "10000",
        Role::Operator,
    ));
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(work(&report).discharged_amount, "10000");
    assert_eq!(work(&report).unresolved_balance, "0");
    (bundle, trust, keys, entitlement)
}

fn full_discharge_survives_merge_and_reordering(
    bundle: &AssignmentBundle,
    trust: &TrustConfiguration,
) {
    let mut replay = bundle.clone();
    replay.actions.reverse();
    replay.events.reverse();
    for duplicate_delivery in [false, true] {
        if duplicate_delivery {
            replay.actions.extend(bundle.actions.clone());
            replay.events.extend(bundle.events.clone());
        }
        let report = verify_assignment_bundle(&replay, trust).unwrap();
        assert_eq!(work(&report).discharged_amount, "10000");
        assert_eq!(work(&report).unresolved_balance, "0");
    }
}

#[test]
fn mediator_nonexistent_fee_receipt_cannot_revoke_operator_discharge() {
    let (mut bundle, trust, keys, entitlement) = paid_baseline();
    let baseline = verify_assignment_bundle(&bundle, &trust).unwrap();
    capture("case0-paid-baseline", &bundle, &trust, &baseline);
    let invalid = receipt(
        &bundle,
        &keys,
        &entitlement,
        "review-payment",
        "protection:nonexistent",
        "500",
        Role::Mediator,
    );
    let invalid_hash = encoding::digest(&invalid.proposal).unwrap();
    bundle.actions.push(invalid);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    capture("case1-mediator-slot-poison", &bundle, &trust, &report);
    assert_ne!(report.action_status[&invalid_hash], "APPLIED");
    assert_eq!(
        work(&report).discharged_amount,
        "10000",
        "M's genuine signature on a nonexistent fee grants no revocation power over O's valid receipt"
    );
    assert_eq!(work(&report).unresolved_balance, "0");
    full_discharge_survives_merge_and_reordering(&bundle, &trust);
}

#[test]
fn same_payee_equivocation_cannot_revoke_previously_granted_discharge() {
    let (mut bundle, trust, keys, entitlement) = paid_baseline();
    bundle.actions.push(receipt(
        &bundle,
        &keys,
        &entitlement,
        "review-payment",
        "milestone:work",
        "4000",
        Role::Operator,
    ));
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    capture("case2-payee-equivocation", &bundle, &trust, &report);
    assert_eq!(
        work(&report).discharged_amount,
        "10000",
        "a contradictory O receipt is not the required R/O/M reversal authorization"
    );
    assert_eq!(work(&report).unresolved_balance, "0");
    assert!(
        !report.diagnostics.is_empty(),
        "the contradiction must remain explicit"
    );
    full_discharge_survives_merge_and_reordering(&bundle, &trust);
}

#[test]
fn unordered_overpayment_cannot_revoke_a_full_payee_receipt() {
    let (mut bundle, trust, keys, entitlement) = paid_baseline();
    bundle.actions.push(receipt(
        &bundle,
        &keys,
        &entitlement,
        "review-other-payment",
        "milestone:work",
        "6000",
        Role::Operator,
    ));
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    capture("case3-unordered-overpayment", &bundle, &trust, &report);
    assert_eq!(
        work(&report).discharged_amount,
        "10000",
        "uncertain allocation of another receipt cannot erase the independent full-discharge proof"
    );
    assert_eq!(work(&report).unresolved_balance, "0");
    assert!(
        !report.diagnostics.is_empty(),
        "allocation ambiguity must remain explicit"
    );
    full_discharge_survives_merge_and_reordering(&bundle, &trust);
}

#[test]
fn mediator_stream_fork_cannot_revoke_exact_operator_claim_and_requester_acknowledgment() {
    let (mut bundle, trust, keys) = fixture();
    let recommendation = event(
        &bundle,
        &keys,
        Role::Mediator,
        0,
        None,
        vec![],
        EventBody::Recommendation {
            dispute_id: "review-discussion".into(),
            text: "Nonbinding recommendation; no authority over compensation.".into(),
        },
    );
    let recommendation_hash = encoding::digest(&recommendation.envelope).unwrap();
    completion(&mut bundle, &keys);
    let mut completion_envelope = bundle.events[0].envelope.clone();
    completion_envelope.causal_references = vec![recommendation_hash];
    let completion = transcript::sign_event(&completion_envelope, &keys[1]).unwrap();
    let completion_hash = encoding::digest(&completion.envelope).unwrap();
    bundle.events = vec![recommendation.clone(), completion];
    let acknowledgment = sign_action(
        &bundle,
        &keys,
        Action::AcknowledgeCompletion {
            completion_event_hash: completion_hash.clone(),
            milestone_id: "work".into(),
        },
        &[Role::Requester],
        std::slice::from_ref(&completion_hash),
        "review-exact-acknowledgment",
    );
    bundle.actions.push(acknowledgment);
    let before = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(work(&before).amount.minor_units, "10000");
    assert_eq!(work(&before).unresolved_balance, "10000");
    let mut fork = recommendation.envelope.clone();
    fork.nonce = "review-mediator-fork".into();
    fork.body = EventBody::Recommendation {
        dispute_id: "review-discussion".into(),
        text: "Another nonbinding recommendation at the same author sequence.".into(),
    };
    bundle
        .events
        .push(transcript::sign_event(&fork, &keys[2]).unwrap());
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    capture("case4-mediator-stream-fork", &bundle, &trust, &report);
    assert_eq!(report.transcript.conflicts.len(), 1);
    assert!(
        report
            .transcript
            .retained_events
            .contains_key(&completion_hash)
    );
    assert_eq!(work(&report).amount.minor_units, "10000");
    assert_eq!(
        work(&report).unresolved_balance,
        "10000",
        "M's recommendation equivocation must not retract O's receivable authorized by exact R acknowledgment"
    );
}

#[test]
fn retired_artifact_rule_cannot_create_fresh_debt_after_known_amendment() {
    let (mut bundle, trust, keys) = artifact_fixture();
    let mut replacement = next_agreement(&bundle);
    replacement.policy.artifact_rules.clear();
    replacement.policy_hash = encoding::digest(&replacement.policy).unwrap();
    replacement.acceptance[0].evaluation = Evaluation::RequesterJudgment;
    replacement.acceptance[0].description =
        "Requester judgment now required; prior exact-artifact authority retired.".into();
    let replacement_hash = encoding::digest(&replacement).unwrap();
    let amendment = sign_action(
        &bundle,
        &keys,
        Action::AmendAgreement {
            replacement: Box::new(replacement),
        },
        &[Role::Requester, Role::Operator, Role::Mediator],
        &[],
        "review-retire-artifact-rule",
    );
    let amendment_hash = encoding::digest(&amendment.proposal).unwrap();
    bundle.actions.push(amendment);
    let mut start_envelope = event(
        &bundle,
        &keys,
        Role::Operator,
        0,
        None,
        vec![],
        EventBody::StartClaim,
    )
    .envelope;
    start_envelope.agreement_hash = replacement_hash.clone();
    let start = transcript::sign_event(&start_envelope, &keys[1]).unwrap();
    completion(&mut bundle, &keys);
    let mut old_completion = bundle.events[0].envelope.clone();
    old_completion.sequence = "1".into();
    old_completion.previous_event_hash = Some(encoding::digest(&start.envelope).unwrap());
    old_completion.nonce = "review-regress-to-retired-revision".into();
    let old_completion = transcript::sign_event(&old_completion, &keys[1]).unwrap();
    let completion_hash = encoding::digest(&old_completion.envelope).unwrap();
    bundle.events = vec![start, old_completion];
    let invocation = sign_action(
        &bundle,
        &keys,
        Action::InvokeArtifactRule {
            rule_id: "exact-artifact".into(),
            completion_event_hash: completion_hash.clone(),
        },
        &[Role::Operator],
        &[completion_hash, amendment_hash],
        "review-known-retired-rule-invocation",
    );
    let invocation_hash = encoding::digest(&invocation.proposal).unwrap();
    bundle.actions.push(invocation);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    capture("case5-retired-rule", &bundle, &trust, &report);
    assert_eq!(report.current_agreement_hash, replacement_hash);
    assert!(
        report.obligations.is_empty(),
        "a fresh post-cutover invocation of the explicitly retired power cannot establish compensation without current authorization"
    );
    assert_ne!(report.action_status[&invocation_hash], "APPLIED");
}

#[test]
fn ordinary_completion_reports_manifest_attachment_length_mismatch() {
    let (mut bundle, trust, keys) = fixture();
    completion(&mut bundle, &keys);
    let mut envelope = bundle.events[0].envelope.clone();
    let EventBody::CompletionClaim { manifest, .. } = &mut envelope.body else {
        unreachable!()
    };
    assert!(EVIDENCE_BYTES.len() > 1);
    manifest.artifacts[0].byte_length = "1".into();
    bundle.events[0] = transcript::sign_event(&envelope, &keys[1]).unwrap();
    let completion_hash = encoding::digest(&envelope).unwrap();
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    capture("case6-manifest-length", &bundle, &trust, &report);
    assert!(report.transcript.event_status[&completion_hash].signature_valid);
    assert!(
        report.diagnostics.iter().any(|diagnostic| {
            let text = format!("{} {}", diagnostic.code, diagnostic.message).to_ascii_lowercase();
            text.contains("length")
                && (text.contains("manifest")
                    || text.contains("artifact")
                    || text.contains("attachment"))
        }),
        "a valid signature and attachment digest do not make the claimed one-byte manifest length correct"
    );
}
