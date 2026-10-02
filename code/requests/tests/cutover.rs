// SPDX-License-Identifier: AGPL-3.0-only
mod common;
use common::*;
use nonverba_requests::{
    bundle::verify_assignment_bundle,
    crypto, encoding,
    model::*,
    transcript::{self, EventBody},
};
use p256::ecdsa::SigningKey;

const ALL: [Role; 3] = [Role::Requester, Role::Operator, Role::Mediator];
fn hash(cert: &ActionCertificate) -> String {
    encoding::digest(&cert.proposal).unwrap()
}
fn amendment(bundle: &AssignmentBundle, keys: &[SigningKey; 3]) -> ActionCertificate {
    let mut replacement = next_agreement(bundle);
    replacement.policy.artifact_rules.clear();
    replacement.policy_hash = encoding::digest(&replacement.policy).unwrap();
    sign_action(
        bundle,
        keys,
        Action::AmendAgreement {
            replacement: Box::new(replacement),
        },
        &ALL,
        &[],
        "cutover",
    )
}
fn replacement(c: &ActionCertificate) -> AssignmentAgreement {
    match &c.proposal.action {
        Action::AmendAgreement { replacement } => *replacement.clone(),
        _ => unreachable!(),
    }
}
fn invoke(
    bundle: &AssignmentBundle,
    keys: &[SigningKey; 3],
    completion: &str,
    other: &[String],
) -> ActionCertificate {
    let mut refs = vec![completion.to_string()];
    refs.extend_from_slice(other);
    sign_action(
        bundle,
        keys,
        Action::InvokeArtifactRule {
            rule_id: "exact-artifact".into(),
            completion_event_hash: completion.into(),
        },
        &[Role::Operator],
        &refs,
        "invoke-retired-rule",
    )
}

#[test]
fn signed_frontier_keeps_historical_entitlement_and_receipt_even_if_preserved_list_omits_them() {
    let (mut bundle, trust, keys) = artifact_fixture();
    let entitlement = establish_compensation(&mut bundle, &keys);
    let receipt = sign_action(
        &bundle,
        &keys,
        Action::PaymentReceipt {
            payment_id: "before-cutover".into(),
            obligation_id: "milestone:work".into(),
            amount: money("4000"),
            rail_reference: "SYNTHETIC receipt, no funds moved".into(),
        },
        &[Role::Operator],
        std::slice::from_ref(&entitlement),
        "historical-receipt",
    );
    let receipt_id = hash(&receipt);
    bundle.actions.push(receipt);
    let mut amend = amendment(&bundle, &keys);
    amend
        .proposal
        .cutover
        .as_mut()
        .unwrap()
        .preserved_claims
        .clear();
    resign_action_for(&bundle.agreement.agreement, &keys, &mut amend, &ALL);
    let new_hash = encoding::digest(&replacement(&amend)).unwrap();
    bundle.actions.push(amend);
    for _ in 0..2 {
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert_eq!(report.current_agreement_hash, new_hash);
        assert_eq!(report.action_status[&entitlement], "APPLIED");
        assert_eq!(report.action_status[&receipt_id], "APPLIED");
        assert_eq!(report.obligations[0].amount, money("10000"));
        assert_eq!(report.obligations[0].discharged_amount, "4000");
        assert_eq!(report.obligations[0].released_amount, "0");
        assert_eq!(report.obligations[0].unresolved_balance, "6000");
        bundle.actions.reverse();
    }
}

#[test]
fn old_receipt_after_cutover_can_still_discharge_the_exact_historical_obligation() {
    let (mut bundle, trust, keys) = fixture();
    let entitlement = establish_compensation(&mut bundle, &keys);
    let amend = amendment(&bundle, &keys);
    let amend_id = hash(&amend);
    bundle.actions.push(amend);
    let receipt = sign_action(
        &bundle,
        &keys,
        Action::PaymentReceipt {
            payment_id: "after-cutover".into(),
            obligation_id: "milestone:work".into(),
            amount: money("10000"),
            rail_reference: "SYNTHETIC post-cutover creditor grant".into(),
        },
        &[Role::Operator],
        &[entitlement, amend_id],
        "historical-obligation-paid-later",
    );
    let id = hash(&receipt);
    bundle.actions.push(receipt);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(report.action_status[&id], "APPLIED");
    assert_eq!(report.obligations[0].unresolved_balance, "0");
}

#[test]
fn retired_rule_with_direct_successor_knowledge_cannot_create_a_fresh_entitlement() {
    let (mut bundle, trust, keys) = artifact_fixture();
    let amend = amendment(&bundle, &keys);
    let amend_id = hash(&amend);
    bundle.actions.push(amend);
    let completion = completion(&mut bundle, &keys);
    let claim = invoke(&bundle, &keys, &completion, &[amend_id]);
    let id = hash(&claim);
    bundle.actions.push(claim);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(report.action_status[&id], "REJECTED");
    assert!(report.obligations.is_empty());
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.subject == id && d.code == "RETIRED_AUTHORITY")
    );
}

#[test]
fn retired_rule_detects_successor_knowledge_through_new_revision_author_stream() {
    let (mut bundle, trust, keys) = artifact_fixture();
    let amend = amendment(&bundle, &keys);
    let new = replacement(&amend);
    bundle.actions.push(amend);
    let mut start = event(
        &bundle,
        &keys,
        Role::Operator,
        0,
        None,
        vec![],
        EventBody::StartClaim,
    )
    .envelope;
    start.agreement_hash = encoding::digest(&new).unwrap();
    let start = transcript::sign_event(&start, &keys[1]).unwrap();
    completion(&mut bundle, &keys);
    let mut old_claim = bundle.events.pop().unwrap().envelope;
    old_claim.sequence = "1".into();
    old_claim.previous_event_hash = Some(encoding::digest(&start.envelope).unwrap());
    old_claim.nonce = "old-revision-after-successor".into();
    let old_claim = transcript::sign_event(&old_claim, &keys[1]).unwrap();
    let claim_hash = encoding::digest(&old_claim.envelope).unwrap();
    bundle.events.extend([old_claim, start]);
    let claim = invoke(&bundle, &keys, &claim_hash, &[]);
    let id = hash(&claim);
    bundle.actions.push(claim);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert!(report.transcript.proof_events.contains_key(&claim_hash));
    assert_eq!(report.action_status[&id], "REJECTED");
    assert!(report.obligations.is_empty());
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.subject == id && d.code == "RETIRED_AUTHORITY")
    );
}

#[test]
fn unordered_old_rule_is_retained_as_unresolved_and_never_reinterpreted_as_a_current_grant() {
    let (mut bundle, trust, keys) = artifact_fixture();
    let amend = amendment(&bundle, &keys);
    let new_hash = encoding::digest(&replacement(&amend)).unwrap();
    bundle.actions.push(amend);
    let completion = completion(&mut bundle, &keys);
    let claim = invoke(&bundle, &keys, &completion, &[]);
    let id = hash(&claim);
    bundle.actions.push(claim);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(report.current_agreement_hash, new_hash);
    assert_eq!(report.action_status[&id], "UNRESOLVED");
    assert!(report.obligations.is_empty());
    assert!(report.transcript.proof_events.contains_key(&completion));
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.subject == id && d.code == "CUTOVER_UNRESOLVED")
    );
}

#[test]
fn missing_unsigned_and_forged_frontiers_cannot_advance_current_authority() {
    for attack in 0..3 {
        let (mut bundle, trust, keys) = fixture();
        let root = encoding::digest(&bundle.agreement.agreement).unwrap();
        let mut amend = amendment(&bundle, &keys);
        match attack {
            0 => amend.proposal.cutover = None,
            1 => amend
                .proposal
                .cutover
                .as_mut()
                .unwrap()
                .frontier
                .push("ab".repeat(32)),
            _ => {
                let mut forged = event(
                    &bundle,
                    &keys,
                    Role::Mediator,
                    0,
                    None,
                    vec![],
                    EventBody::CancellationNotice {
                        reason: "forged frontier".into(),
                    },
                );
                forged.authorization.signature = crypto::encode_base64url(&[0u8; 64]);
                let id = encoding::digest(&forged.envelope).unwrap();
                bundle.events.push(forged);
                amend.proposal.parent_certificate_ids.push(id.clone());
                amend.proposal.cutover.as_mut().unwrap().frontier.push(id);
            }
        }
        resign_action_for(&bundle.agreement.agreement, &keys, &mut amend, &ALL);
        let id = hash(&amend);
        bundle.actions.push(amend);
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert_eq!(report.current_agreement_hash, root);
        assert_ne!(report.action_status[&id], "APPLIED");
        assert!(report.obligations.is_empty());
    }
}

#[test]
fn a_fresh_current_revision_completion_and_requester_acknowledgment_still_establish_compensation() {
    let (mut bundle, trust, keys) = artifact_fixture();
    let amend = amendment(&bundle, &keys);
    let new = replacement(&amend);
    bundle.actions.push(amend);
    completion(&mut bundle, &keys);
    let mut envelope = bundle.events.pop().unwrap().envelope;
    envelope.agreement_hash = encoding::digest(&new).unwrap();
    let completion = transcript::sign_event(&envelope, &keys[1]).unwrap();
    let completion_id = encoding::digest(&completion.envelope).unwrap();
    bundle.events.push(completion);
    let ack = sign_action_for(
        &new,
        &keys,
        Action::AcknowledgeCompletion {
            completion_event_hash: completion_id.clone(),
            milestone_id: "work".into(),
        },
        &[Role::Requester],
        &[completion_id],
        "current-ack",
    );
    let id = hash(&ack);
    bundle.actions.push(ack);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(report.action_status[&id], "APPLIED");
    assert_eq!(
        report.current_agreement_hash,
        encoding::digest(&new).unwrap()
    );
    assert_eq!(report.obligations[0].unresolved_balance, "10000");
    assert_eq!(
        report.obligations[0].basis_agreement_hash,
        encoding::digest(&bundle.agreement.agreement).unwrap(),
        "a current-revision authority still uses the stable original debt-unit coordinates"
    );
}

#[test]
fn an_entirely_omitted_old_frontier_retains_conditional_debt_and_discharge_instead_of_asserting_zero()
 {
    let (mut bundle, trust, keys) = fixture();
    let entitlement = establish_compensation(&mut bundle, &keys);
    let receipt = sign_action(
        &bundle,
        &keys,
        Action::PaymentReceipt {
            payment_id: "omitted-historical-payment".into(),
            obligation_id: "milestone:work".into(),
            amount: money("10000"),
            rail_reference: "SYNTHETIC confirmed payee grant before ambiguous cutover".into(),
        },
        &[Role::Operator],
        std::slice::from_ref(&entitlement),
        "omitted-history-receipt",
    );
    let receipt_id = hash(&receipt);
    bundle.actions.push(receipt);
    let before = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(before.obligations[0].amount, money("10000"));
    assert_eq!(before.obligations[0].discharged_amount, "10000");

    let mut amend = amendment(&bundle, &keys);
    amend.proposal.parent_certificate_ids =
        vec![encoding::digest(&bundle.agreement.agreement).unwrap()];
    amend.proposal.cutover = Some(AmendmentCutover {
        frontier: vec![],
        preserved_claims: vec![],
        grandfathered_actions: vec![],
    });
    resign_action_for(&bundle.agreement.agreement, &keys, &mut amend, &ALL);
    let new_hash = encoding::digest(&replacement(&amend)).unwrap();
    bundle.actions.push(amend);
    for _ in 0..2 {
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert_eq!(report.current_agreement_hash, new_hash);
        assert_eq!(report.action_status[&entitlement], "UNRESOLVED");
        assert!(
            report.obligations.is_empty(),
            "unproved cutover order does not execute old authority"
        );
        assert!(
            report.financial_projection.contains("PARTIAL"),
            "empty active obligations must not represent zero debt"
        );
        let accrued = report
            .unresolved_rights
            .iter()
            .find(|r| r.certificate_id == entitlement)
            .expect("the omitted signed entitlement remains explicit financial proof");
        assert!(!accrued.reason.is_empty());
        assert!(
            accrued
                .obligations
                .iter()
                .any(|o| o.id == "milestone:work" && o.amount == money("10000"))
        );
        let paid = report
            .unresolved_rights
            .iter()
            .find(|r| r.certificate_id == receipt_id)
            .expect("a dependent signed receipt must remain an explicit conditional discharge");
        assert!(
            paid.obligations
                .iter()
                .any(|o| o.id == "milestone:work" && o.discharged_amount == "10000")
        );
        assert!(
            report
                .effects
                .iter()
                .all(|e| e.certificate_id != entitlement && e.certificate_id != receipt_id)
        );
        bundle.actions.reverse();
    }
}

#[test]
fn successor_frontier_preserves_old_due_conditions_despite_unrelated_dependency_depth() {
    let (mut bundle, trust, keys) = fixture();
    let original_due = bundle.agreement.agreement.payments.due_conditions.clone();
    let completion_id = completion(&mut bundle, &keys);
    let expense = sign_action(
        &bundle,
        &keys,
        Action::AuthorizeExpense {
            expense_id: "delay-old-entitlement".into(),
            category: "travel".into(),
            amount: money("500"),
            evidence_event_hash: completion_id.clone(),
        },
        &[Role::Requester, Role::Operator],
        std::slice::from_ref(&completion_id),
        "old-dependency",
    );
    let expense_id = hash(&expense);
    bundle.actions.push(expense);
    let old_ack = sign_action(
        &bundle,
        &keys,
        Action::AcknowledgeCompletion {
            completion_event_hash: completion_id.clone(),
            milestone_id: "work".into(),
        },
        &[Role::Requester],
        &[completion_id, expense_id],
        "old-ack-delayed",
    );
    let old_ack_id = hash(&old_ack);
    bundle.actions.push(old_ack);
    let before = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(
        before
            .obligations
            .iter()
            .find(|o| o.id == "milestone:work")
            .unwrap()
            .due_conditions,
        original_due
    );

    let mut new = next_agreement(&bundle);
    new.payments.due_conditions =
        "Prospective conditions must never replace this existing debt's due conditions.".into();
    let amend = sign_action(
        &bundle,
        &keys,
        Action::AmendAgreement {
            replacement: Box::new(new.clone()),
        },
        &ALL,
        &[],
        "frontier-ordering",
    );
    assert!(
        amend
            .proposal
            .cutover
            .as_ref()
            .unwrap()
            .frontier
            .contains(&old_ack_id)
    );
    bundle.actions.push(amend);
    let previous = bundle.events[0].clone();
    let mut envelope = event(
        &bundle,
        &keys,
        Role::Operator,
        1,
        Some(&previous),
        vec![],
        previous.envelope.body.clone(),
    )
    .envelope;
    envelope.agreement_hash = encoding::digest(&new).unwrap();
    let new_completion = transcript::sign_event(&envelope, &keys[1]).unwrap();
    let new_completion_id = encoding::digest(&new_completion.envelope).unwrap();
    bundle.events.push(new_completion);
    let new_ack = sign_action_for(
        &new,
        &keys,
        Action::AcknowledgeCompletion {
            completion_event_hash: new_completion_id.clone(),
            milestone_id: "work".into(),
        },
        &[Role::Requester],
        &[new_completion_id],
        "new-ack-no-extra-depth",
    );
    bundle.actions.push(new_ack);
    let receipt = sign_action_for(
        &new,
        &keys,
        Action::PaymentReceipt {
            payment_id: "current-receipt-for-frontier-debt".into(),
            obligation_id: "milestone:work".into(),
            amount: money("10000"),
            rail_reference: "SYNTHETIC current-policy receipt naming exact old entitlement".into(),
        },
        &[Role::Operator],
        std::slice::from_ref(&old_ack_id),
        "current-frontier-receipt",
    );
    let receipt_id = hash(&receipt);
    bundle.actions.push(receipt);
    for _ in 0..2 {
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert_eq!(
            report.current_agreement_hash,
            encoding::digest(&new).unwrap()
        );
        assert_eq!(report.action_status[&old_ack_id], "APPLIED");
        assert_eq!(report.action_status[&receipt_id], "APPLIED");
        let work = report
            .obligations
            .iter()
            .find(|o| o.id == "milestone:work")
            .unwrap();
        assert_eq!(work.discharged_amount, "10000");
        assert_eq!(
            work.due_conditions, original_due,
            "successor authority causally follows its signed frontier; unrelated depth cannot replace accrued terms"
        );
        bundle.actions.reverse();
    }
}

#[test]
fn successor_frontier_preserves_old_fee_due_conditions_when_old_activation_has_extra_ancestors() {
    let (mut bundle, trust, keys) = service_fixture();
    let original_due = match &bundle.agreement.agreement.assurance {
        Assurance::Service { fee: Some(fee), .. } => fee.due_conditions.clone(),
        _ => unreachable!(),
    };
    let completion_id = completion(&mut bundle, &keys);
    let expense = sign_action(
        &bundle,
        &keys,
        Action::AuthorizeExpense {
            expense_id: "delay-old-activation".into(),
            category: "travel".into(),
            amount: money("500"),
            evidence_event_hash: completion_id.clone(),
        },
        &[Role::Requester, Role::Operator],
        &[completion_id],
        "activation-dependency",
    );
    let expense_id = hash(&expense);
    bundle.actions.push(expense);
    let old = sign_action(
        &bundle,
        &keys,
        Action::ActivateProtectionService {
            commitment_id: "evidence-assistance".into(),
        },
        &ALL,
        &[expense_id],
        "old-activation-with-depth",
    );
    let old_id = hash(&old);
    bundle.actions.push(old);
    let mut new = next_agreement(&bundle);
    if let Assurance::Service { fee: Some(fee), .. } = &mut new.assurance {
        fee.due_conditions =
            "Prospective fee conditions cannot revise the already established fee.".into();
    }
    let amend = sign_action(
        &bundle,
        &keys,
        Action::AmendAgreement {
            replacement: Box::new(new.clone()),
        },
        &ALL,
        &[],
        "fee-frontier-ordering",
    );
    assert!(
        amend
            .proposal
            .cutover
            .as_ref()
            .unwrap()
            .frontier
            .contains(&old_id)
    );
    bundle.actions.push(amend);
    let new_activation = sign_action_for(
        &new,
        &keys,
        Action::ActivateProtectionService {
            commitment_id: "evidence-assistance".into(),
        },
        &ALL,
        &[],
        "new-activation-no-extra-depth",
    );
    bundle.actions.push(new_activation);
    for _ in 0..2 {
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert!(report.ready_to_start, "{:?}", report.diagnostics);
        assert_eq!(report.action_status[&old_id], "APPLIED");
        let fee = report
            .obligations
            .iter()
            .find(|o| o.id == "protection:assistance-fee")
            .unwrap();
        assert_eq!(fee.amount, money("500"));
        assert_eq!(
            fee.due_conditions, original_due,
            "the amendment's signed frontier establishes that the original fee terms accrued first"
        );
        bundle.actions.reverse();
    }
}
