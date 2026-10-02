// SPDX-License-Identifier: AGPL-3.0-only
//! Authenticated causal knowledge is independent of complete effect authority.
mod common;
use common::*;
use nonverba_requests::{
    bundle::verify_assignment_bundle,
    crypto, encoding,
    model::*,
    transcript::{ArtifactRef, EventBody, EvidenceManifest},
};

const ALL: [Role; 3] = [Role::Requester, Role::Operator, Role::Mediator];

fn carrier_case(mode: &str) -> (AssignmentBundle, TrustConfiguration, String, String) {
    let (mut bundle, trust, keys) = artifact_fixture();
    let initial = event(
        &bundle,
        &keys,
        Role::Operator,
        0,
        None,
        vec![],
        EventBody::StartClaim,
    );
    let initial_id = encoding::digest(&initial.envelope).unwrap();
    bundle.events.push(initial.clone());
    let mut new = next_agreement(&bundle);
    new.policy.artifact_rules.clear();
    new.policy_hash = encoding::digest(&new.policy).unwrap();
    let amendment = sign_action(
        &bundle,
        &keys,
        Action::AmendAgreement {
            replacement: Box::new(new.clone()),
        },
        &ALL,
        &[],
        "knowledge-cutover",
    );
    bundle.actions.push(amendment);
    let signer = if mode == "mediator-only" {
        Role::Mediator
    } else {
        Role::Requester
    };
    let mut carrier = sign_action_for(
        &new,
        &keys,
        Action::AuthorizeExpense {
            expense_id: "knowledge-carrier".into(),
            category: "travel".into(),
            amount: money("500"),
            evidence_event_hash: initial_id.clone(),
        },
        &[signer],
        &[initial_id],
        "partial-expense-knowledge",
    );
    match mode {
        "unsigned" => carrier.authorizations.clear(),
        "forged" => carrier.authorizations[0].signature = crypto::encode_base64url(&[0u8; 64]),
        "invalid-proposal" => {
            carrier.proposal.scope_id = "expense:another-scope".into();
            resign_action_for(&new, &keys, &mut carrier, &[signer]);
        }
        _ => {}
    }
    let carrier_id = encoding::digest(&carrier.proposal).unwrap();
    bundle.actions.push(carrier);
    let completion = event(
        &bundle,
        &keys,
        Role::Operator,
        1,
        Some(&initial),
        vec![carrier_id.clone()],
        EventBody::CompletionClaim {
            milestone_id: "work".into(),
            manifest: EvidenceManifest {
                artifacts: vec![ArtifactRef {
                    sha256: encoding::bytes_digest(EVIDENCE_BYTES),
                    byte_length: EVIDENCE_BYTES.len().to_string(),
                    media_type: "text/plain".into(),
                    capture_reference: None,
                }],
                description: "Exact old-revision claim with an attributed knowledge carrier".into(),
            },
        },
    );
    let completion_id = encoding::digest(&completion.envelope).unwrap();
    bundle.events.push(completion);
    bundle.attachments.push(Attachment {
        sha256: encoding::bytes_digest(EVIDENCE_BYTES),
        bytes_b64: crypto::encode_base64url(EVIDENCE_BYTES),
    });
    let invoke = sign_action(
        &bundle,
        &keys,
        Action::InvokeArtifactRule {
            rule_id: "exact-artifact".into(),
            completion_event_hash: completion_id.clone(),
        },
        &[Role::Operator],
        &[completion_id],
        "retired-knowledge-rule",
    );
    let invoke_id = encoding::digest(&invoke.proposal).unwrap();
    bundle.actions.push(invoke);
    (bundle, trust, carrier_id, invoke_id)
}

#[test]
fn a_partial_real_signature_proves_successor_knowledge_without_authorizing_the_expense() {
    for mode in ["requester-only", "mediator-only"] {
        let (mut bundle, trust, carrier, invoke) = carrier_case(mode);
        for _ in 0..2 {
            let report = verify_assignment_bundle(&bundle, &trust).unwrap();
            assert_eq!(report.action_status[&carrier], "REJECTED");
            assert_eq!(report.action_status[&invoke], "REJECTED");
            assert!(
                report
                    .diagnostics
                    .iter()
                    .any(|d| d.subject == invoke && d.code == "RETIRED_AUTHORITY")
            );
            assert!(
                report.obligations.is_empty(),
                "context attribution cannot establish any expense or retired-rule entitlement"
            );
            bundle.actions.reverse();
        }
    }
}

#[test]
fn unsigned_forged_or_invalid_proposals_cannot_manufacture_positive_successor_knowledge() {
    for mode in ["unsigned", "forged", "invalid-proposal"] {
        let (bundle, trust, _, invoke) = carrier_case(mode);
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert_eq!(report.action_status[&invoke], "UNRESOLVED");
        assert!(
            report
                .diagnostics
                .iter()
                .any(|d| d.subject == invoke && d.code == "CUTOVER_UNRESOLVED")
        );
        assert!(
            !report
                .diagnostics
                .iter()
                .any(|d| d.subject == invoke && d.code == "RETIRED_AUTHORITY")
        );
        assert!(report.obligations.is_empty());
    }
}

#[test]
fn signed_frontier_can_retain_a_partial_proposal_without_turning_it_into_an_expense() {
    let (mut bundle, trust, keys) = service_fixture();
    let initial = event(
        &bundle,
        &keys,
        Role::Operator,
        0,
        None,
        vec![],
        EventBody::StartClaim,
    );
    let initial_id = encoding::digest(&initial.envelope).unwrap();
    bundle.events.push(initial);
    let expense = sign_action(
        &bundle,
        &keys,
        Action::AuthorizeExpense {
            expense_id: "partial-frontier-expense".into(),
            category: "travel".into(),
            amount: money("500"),
            evidence_event_hash: initial_id.clone(),
        },
        &[Role::Requester],
        &[initial_id],
        "partial-frontier-expense",
    );
    let expense_id = encoding::digest(&expense.proposal).unwrap();
    bundle.actions.push(expense);
    let new = next_agreement(&bundle);
    let amendment = sign_action(
        &bundle,
        &keys,
        Action::AmendAgreement {
            replacement: Box::new(new.clone()),
        },
        &ALL,
        &[],
        "partial-proposal-frontier",
    );
    let amendment_id = encoding::digest(&amendment.proposal).unwrap();
    assert!(
        amendment
            .proposal
            .cutover
            .as_ref()
            .unwrap()
            .frontier
            .contains(&expense_id)
    );
    bundle.actions.push(amendment);
    let activation = sign_action_for(
        &new,
        &keys,
        Action::ActivateProtectionService {
            commitment_id: "evidence-assistance".into(),
        },
        &ALL,
        &[],
        "fully-authorized-current-service",
    );
    let activation_id = encoding::digest(&activation.proposal).unwrap();
    bundle.actions.push(activation);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(
        report.current_agreement_hash,
        encoding::digest(&new).unwrap()
    );
    assert_eq!(report.action_status[&amendment_id], "APPLIED");
    assert_eq!(report.action_status[&activation_id], "APPLIED");
    assert_ne!(report.action_status[&expense_id], "APPLIED");
    assert_eq!(report.obligations.len(), 1);
    assert_eq!(report.obligations[0].id, "protection:assistance-fee");
    assert_eq!(report.obligations[0].unresolved_balance, "500");
}
