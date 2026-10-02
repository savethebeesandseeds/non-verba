// SPDX-License-Identifier: AGPL-3.0-only
//! Required financial witnesses stay closed even when contextual history grows.
mod common;
use common::*;
use nonverba_requests::{
    actions, agreement,
    bundle::verify_assignment_bundle,
    crypto, encoding,
    model::*,
    transcript::{ArtifactRef, EventBody, EvidenceManifest, SignedEvent},
};
use p256::ecdsa::SigningKey;

const ALL: [Role; 3] = [Role::Requester, Role::Operator, Role::Mediator];
fn hash(c: &ActionCertificate) -> String {
    encoding::digest(&c.proposal).unwrap()
}
fn initial(bundle: &mut AssignmentBundle, keys: &[SigningKey; 3]) -> SignedEvent {
    let event = event(
        bundle,
        keys,
        Role::Operator,
        0,
        None,
        vec![],
        EventBody::StartClaim,
    );
    bundle.events.push(event.clone());
    event
}
fn expense(
    bundle: &AssignmentBundle,
    keys: &[SigningKey; 3],
    id: &str,
    category_amount: (&str, &str),
    evidence: &str,
    parents: &[String],
    nonce: &str,
) -> ActionCertificate {
    let (category, amount) = category_amount;
    let mut parents = parents.to_vec();
    if !parents.iter().any(|p| p == evidence) {
        parents.push(evidence.into());
    }
    sign_action(
        bundle,
        keys,
        Action::AuthorizeExpense {
            expense_id: id.into(),
            category: category.into(),
            amount: money(amount),
            evidence_event_hash: evidence.into(),
        },
        &[Role::Requester, Role::Operator],
        &parents,
        nonce,
    )
}
fn late_expenses(
    bundle: &AssignmentBundle,
    keys: &[SigningKey; 3],
    evidence: &str,
) -> [ActionCertificate; 2] {
    ["context-a", "context-b"]
        .map(|id| expense(bundle, keys, id, ("travel", "1500"), evidence, &[], id))
}
fn two_categories() -> (AssignmentBundle, TrustConfiguration, [SigningKey; 3]) {
    let (mut bundle, trust, keys) = fixture();
    let a = &mut bundle.agreement.agreement;
    a.quote.quote.expenses.push(ExpenseCap {
        category: "materials".into(),
        cap: money("1000"),
    });
    a.quote.authorization = crypto::sign(
        &agreement::claims(
            &a.deployment_domain,
            &a.request_id,
            &encoding::digest(&a.quote.quote).unwrap(),
            &a.quote.quote.operator,
            "QUOTE",
        ),
        &keys[1],
    )
    .unwrap();
    sign_root(&mut bundle, &keys);
    (bundle, trust, keys)
}

#[test]
fn paid_and_released_expenses_still_consume_the_same_category_cap() {
    let (mut bundle, trust, keys) = fixture();
    let x = initial(&mut bundle, &keys);
    let x_id = encoding::digest(&x.envelope).unwrap();
    let a = expense(
        &bundle,
        &keys,
        "incurred",
        ("travel", "1500"),
        &x_id,
        &[],
        "incurred",
    );
    let a_id = hash(&a);
    bundle.actions.push(a);
    let paid = sign_action(
        &bundle,
        &keys,
        Action::PaymentReceipt {
            payment_id: "expense-paid".into(),
            obligation_id: "expense:incurred".into(),
            amount: money("1500"),
            rail_reference: "SYNTHETIC expense receipt".into(),
        },
        &[Role::Operator],
        std::slice::from_ref(&a_id),
        "expense-paid",
    );
    let paid_id = hash(&paid);
    bundle.actions.push(paid);
    let released = sign_action(
        &bundle,
        &keys,
        Action::BilateralSettlement {
            settlement_id: "expense-release".into(),
            releases: vec![BalanceRelease {
                obligation_id: "expense:incurred".into(),
                amount: money("1500"),
            }],
            reservation_of_other_rights: "This release cannot replenish the agreed expense cap"
                .into(),
        },
        &[Role::Requester, Role::Operator],
        std::slice::from_ref(&a_id),
        "expense-release",
    );
    let released_id = hash(&released);
    bundle.actions.push(released);
    let over = expense(
        &bundle,
        &keys,
        "over-cap",
        ("travel", "600"),
        &x_id,
        &[a_id.clone(), paid_id, released_id],
        "ordered-over-cap",
    );
    assert!(
        actions::prepare_action_signature(&over.proposal, &bundle, &trust, Role::Requester)
            .is_err()
    );
    let over_id = hash(&over);
    bundle.actions.push(over);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(report.action_status[&a_id], "APPLIED");
    assert_eq!(report.action_status[&over_id], "REJECTED");
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.subject == over_id && d.code == "EXPENSE_CAP")
    );
    assert_eq!(report.obligations.len(), 1);
    assert_eq!(report.obligations[0].unresolved_balance, "0");
    assert_eq!(report.obligations[0].discharged_amount, "1500");
    assert_eq!(report.obligations[0].released_amount, "1500");
}

#[test]
fn a_late_conflict_in_another_expense_category_cannot_retract_materials() {
    let (mut bundle, trust, keys) = two_categories();
    let x = initial(&mut bundle, &keys);
    let x_id = encoding::digest(&x.envelope).unwrap();
    let late = late_expenses(&bundle, &keys, &x_id);
    let late_ids = late.iter().map(hash).collect::<Vec<_>>();
    let e = event(
        &bundle,
        &keys,
        Role::Operator,
        1,
        Some(&x),
        late_ids.clone(),
        EventBody::StartClaim,
    );
    let e_id = encoding::digest(&e.envelope).unwrap();
    bundle.events.push(e);
    let materials = expense(
        &bundle,
        &keys,
        "materials",
        ("materials", "500"),
        &e_id,
        &[],
        "materials",
    );
    let materials_id = hash(&materials);
    bundle.actions.push(materials);
    let prefix = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(prefix.action_status[&materials_id], "APPLIED");
    bundle.actions.extend(late);
    for _ in 0..2 {
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert_eq!(report.action_status[&materials_id], "APPLIED");
        for id in &late_ids {
            assert_eq!(report.action_status[id], "CONFLICTED");
        }
        assert_eq!(report.obligations.len(), 1);
        assert_eq!(report.obligations[0].id, "expense:materials");
        assert_eq!(report.obligations[0].unresolved_balance, "500");
        bundle.actions.reverse();
    }
}

#[test]
fn repeated_compatible_expense_certificates_consume_the_cap_once_per_identity() {
    let (mut bundle, trust, keys) = fixture();
    let x = initial(&mut bundle, &keys);
    let x_id = encoding::digest(&x.envelope).unwrap();
    let a = expense(
        &bundle,
        &keys,
        "shared",
        ("travel", "1500"),
        &x_id,
        &[],
        "first-proof",
    );
    let a_id = hash(&a);
    bundle.actions.push(a);
    let b = expense(
        &bundle,
        &keys,
        "remaining",
        ("travel", "500"),
        &x_id,
        std::slice::from_ref(&a_id),
        "remaining-cap",
    );
    let b_id = hash(&b);
    bundle.actions.push(b);
    let alternate = expense(
        &bundle,
        &keys,
        "shared",
        ("travel", "1500"),
        &x_id,
        &[],
        "second-proof-same-expense",
    );
    let alt_id = hash(&alternate);
    bundle.actions.push(alternate);
    for _ in 0..2 {
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        for id in [&a_id, &b_id, &alt_id] {
            assert_eq!(report.action_status[id], "APPLIED");
        }
        assert_eq!(report.obligations.len(), 2);
        assert_eq!(
            report
                .obligations
                .iter()
                .map(|o| o.amount.validate().unwrap())
                .sum::<u64>(),
            2000
        );
        bundle.actions.reverse();
    }
}

#[test]
fn exact_receipt_release_and_reversal_proofs_survive_late_unrelated_cap_conflicts() {
    let (mut bundle, trust, keys) = fixture();
    let x = initial(&mut bundle, &keys);
    let x_id = encoding::digest(&x.envelope).unwrap();
    let late = late_expenses(&bundle, &keys, &x_id);
    let late_ids = late.iter().map(hash).collect::<Vec<_>>();
    let completion = event(
        &bundle,
        &keys,
        Role::Operator,
        1,
        Some(&x),
        late_ids.clone(),
        EventBody::CompletionClaim {
            milestone_id: "work".into(),
            manifest: EvidenceManifest {
                artifacts: vec![ArtifactRef {
                    sha256: encoding::bytes_digest(EVIDENCE_BYTES),
                    byte_length: EVIDENCE_BYTES.len().to_string(),
                    media_type: "text/plain".into(),
                    capture_reference: None,
                }],
                description: "Constitutive completion with unrelated expense context".into(),
            },
        },
    );
    let completion_id = encoding::digest(&completion.envelope).unwrap();
    bundle.events.push(completion);
    let ack = sign_action(
        &bundle,
        &keys,
        Action::AcknowledgeCompletion {
            completion_event_hash: completion_id.clone(),
            milestone_id: "work".into(),
        },
        &[Role::Requester],
        &[completion_id],
        "work-ack",
    );
    let ack_id = hash(&ack);
    bundle.actions.push(ack);
    let receipt = sign_action(
        &bundle,
        &keys,
        Action::PaymentReceipt {
            payment_id: "paid-work".into(),
            obligation_id: "milestone:work".into(),
            amount: money("10000"),
            rail_reference: "SYNTHETIC complete creditor proof".into(),
        },
        &[Role::Operator],
        std::slice::from_ref(&ack_id),
        "paid-work",
    );
    let receipt_id = hash(&receipt);
    bundle.actions.push(receipt);
    let release = sign_action(
        &bundle,
        &keys,
        Action::BilateralSettlement {
            settlement_id: "protected-release".into(),
            releases: vec![BalanceRelease {
                obligation_id: "milestone:work".into(),
                amount: money("2000"),
            }],
            reservation_of_other_rights:
                "Release exact units independently of unrelated contextual expenses".into(),
        },
        &[Role::Requester, Role::Operator],
        std::slice::from_ref(&ack_id),
        "release-work",
    );
    let release_id = hash(&release);
    bundle.actions.push(release);
    let reversal = sign_action(
        &bundle,
        &keys,
        Action::ReconcileReversal {
            payment_certificate_id: receipt_id.clone(),
            amount: money("1000"),
            reason: "All parties authorize only this exact grant range".into(),
        },
        &ALL,
        &[ack_id.clone(), receipt_id.clone()],
        "targeted-reversal",
    );
    let reversal_id = hash(&reversal);
    bundle.actions.push(reversal);
    let before = verify_assignment_bundle(&bundle, &trust).unwrap();
    let prior = before
        .obligations
        .iter()
        .find(|o| o.id == "milestone:work")
        .unwrap();
    assert_eq!(prior.discharged_amount, "9000");
    assert_eq!(prior.released_amount, "2000");
    assert_eq!(prior.unresolved_balance, "0");
    bundle.actions.extend(late);
    for _ in 0..2 {
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        for id in [&ack_id, &receipt_id, &release_id, &reversal_id] {
            assert_eq!(report.action_status[id], "APPLIED");
        }
        for id in &late_ids {
            assert_eq!(report.action_status[id], "CONFLICTED");
        }
        let work = report
            .obligations
            .iter()
            .find(|o| o.id == "milestone:work")
            .unwrap();
        assert_eq!(
            encoding::canonical(work).unwrap(),
            encoding::canonical(prior).unwrap()
        );
        bundle.actions.reverse();
    }
}

#[test]
fn missing_actual_obligation_and_receipt_proofs_never_become_authority() {
    let (mut bundle, trust, keys) = fixture();
    let missing = "ab".repeat(32);
    let cases = [
        (
            Action::PaymentReceipt {
                payment_id: "unproved-payment".into(),
                obligation_id: "milestone:work".into(),
                amount: money("1000"),
                rail_reference: "No actual obligation proof".into(),
            },
            vec![Role::Operator],
        ),
        (
            Action::BilateralSettlement {
                settlement_id: "unproved-release".into(),
                releases: vec![BalanceRelease {
                    obligation_id: "milestone:work".into(),
                    amount: money("1000"),
                }],
                reservation_of_other_rights: "No actual balance proof".into(),
            },
            vec![Role::Requester, Role::Operator],
        ),
        (
            Action::ReconcileReversal {
                payment_certificate_id: missing.clone(),
                amount: money("1000"),
                reason: "No actual target receipt".into(),
            },
            ALL.to_vec(),
        ),
    ];
    for (i, (action, roles)) in cases.into_iter().enumerate() {
        let certificate = sign_action(
            &bundle,
            &keys,
            action,
            &roles,
            std::slice::from_ref(&missing),
            &format!("missing-basis-{i}"),
        );
        assert!(
            actions::prepare_action_signature(&certificate.proposal, &bundle, &trust, roles[0])
                .is_err()
        );
        let id = hash(&certificate);
        bundle.actions.push(certificate);
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert_ne!(report.action_status[&id], "APPLIED");
        assert!(report.effects.is_empty());
        assert!(report.obligations.is_empty());
    }
}

#[test]
fn conditional_duplicate_entitlement_keeps_the_already_accrued_due_conditions() {
    let (mut bundle, trust, keys) = fixture();
    let original_due = bundle.agreement.agreement.payments.due_conditions.clone();
    let original_ack = establish_compensation(&mut bundle, &keys);
    let mut second = next_agreement(&bundle);
    second.payments.due_conditions =
        "Prospective revision two conditions, not a novation of existing debt".into();
    let amend_second = sign_action(
        &bundle,
        &keys,
        Action::AmendAgreement {
            replacement: Box::new(second.clone()),
        },
        &ALL,
        &[],
        "second-revision",
    );
    bundle.actions.push(amend_second);
    let previous = bundle.events[0].clone();
    let mut completion = event(
        &bundle,
        &keys,
        Role::Operator,
        1,
        Some(&previous),
        vec![],
        previous.envelope.body.clone(),
    )
    .envelope;
    completion.agreement_hash = encoding::digest(&second).unwrap();
    let completion = nonverba_requests::transcript::sign_event(&completion, &keys[1]).unwrap();
    let completion_id = encoding::digest(&completion.envelope).unwrap();
    bundle.events.push(completion);
    let duplicate = sign_action_for(
        &second,
        &keys,
        Action::AcknowledgeCompletion {
            completion_event_hash: completion_id.clone(),
            milestone_id: "work".into(),
        },
        &[Role::Requester],
        &[completion_id],
        "same-unit-second-proof",
    );
    let duplicate_id = hash(&duplicate);
    bundle.actions.push(duplicate);

    let mut third = second.clone();
    third.revision = "3".into();
    third.previous_agreement_hash = Some(encoding::digest(&second).unwrap());
    third.timing.review_window = "Third-revision reminder".into();
    // The previous Agreement carries the original accrued frontier. The second
    // acknowledgment has no established order relative to this third revision.
    let amend_third = sign_action_for(
        &second,
        &keys,
        Action::AmendAgreement {
            replacement: Box::new(third.clone()),
        },
        &ALL,
        &[],
        "third-revision-omits-duplicate",
    );
    bundle.actions.push(amend_third);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(
        report.current_agreement_hash,
        encoding::digest(&third).unwrap()
    );
    assert_eq!(report.action_status[&original_ack], "APPLIED");
    assert_eq!(report.action_status[&duplicate_id], "UNRESOLVED");
    assert_eq!(report.obligations[0].due_conditions, original_due);
    let conditional = report
        .unresolved_rights
        .iter()
        .find(|r| r.certificate_id == duplicate_id)
        .unwrap();
    assert_eq!(
        conditional.obligations[0].due_conditions, original_due,
        "uncertain applicability of an additional proof cannot manufacture new terms for the already accrued debt units"
    );
}

#[test]
fn unresolved_old_provenance_cannot_replace_a_fresh_current_entitlements_terms() {
    let (mut bundle, trust, keys) = fixture();
    let old_ack = establish_compensation(&mut bundle, &keys);
    let mut second = next_agreement(&bundle);
    second.payments.due_conditions = "Fresh revision two entitlement has its own due terms".into();
    let amend_second = sign_action_for(
        &bundle.agreement.agreement,
        &keys,
        Action::AmendAgreement {
            replacement: Box::new(second.clone()),
        },
        &ALL,
        &[],
        "second-omits-old-proof",
    );
    bundle.actions.push(amend_second);
    let previous = bundle.events[0].clone();
    let mut completion = event(
        &bundle,
        &keys,
        Role::Operator,
        1,
        Some(&previous),
        vec![],
        previous.envelope.body.clone(),
    )
    .envelope;
    completion.agreement_hash = encoding::digest(&second).unwrap();
    let completion = nonverba_requests::transcript::sign_event(&completion, &keys[1]).unwrap();
    let completion_id = encoding::digest(&completion.envelope).unwrap();
    bundle.events.push(completion);
    let current_ack = sign_action_for(
        &second,
        &keys,
        Action::AcknowledgeCompletion {
            completion_event_hash: completion_id.clone(),
            milestone_id: "work".into(),
        },
        &[Role::Requester],
        &[completion_id, old_ack.clone()],
        "fresh-proof-knows-conditional-claim",
    );
    let current_id = hash(&current_ack);
    bundle.actions.push(current_ack);
    let active = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(active.action_status[&old_ack], "UNRESOLVED");
    assert_eq!(active.action_status[&current_id], "APPLIED");
    assert_eq!(
        active.obligations[0].due_conditions,
        second.payments.due_conditions
    );
    assert!(
        !active
            .effects
            .iter()
            .find(|e| e.certificate_id == current_id)
            .unwrap()
            .proof_references
            .contains(&old_ack),
        "an unresolved contextual claim cannot become a constitutive accrued-term witness"
    );

    let mut third = second.clone();
    third.revision = "3".into();
    third.previous_agreement_hash = Some(encoding::digest(&second).unwrap());
    third.timing.review_window = "Third reminder".into();
    let amend_third = sign_action_for(
        &second,
        &keys,
        Action::AmendAgreement {
            replacement: Box::new(third.clone()),
        },
        &ALL,
        &[],
        "third-omits-current-proof",
    );
    bundle.actions.push(amend_third);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(
        report.current_agreement_hash,
        encoding::digest(&third).unwrap()
    );
    assert_eq!(report.action_status[&current_id], "UNRESOLVED");
    let proof = report
        .unresolved_rights
        .iter()
        .find(|r| r.certificate_id == current_id)
        .unwrap();
    assert_eq!(
        proof.obligations[0].due_conditions, second.payments.due_conditions,
        "conditional snapshots preserve their valid current proof, not unrelated old conditional terms"
    );
}

#[test]
fn conditional_duplicate_service_fee_keeps_the_original_accrued_due_conditions() {
    let (mut bundle, trust, keys) = service_fixture();
    let original_due = match &bundle.agreement.agreement.assurance {
        Assurance::Service { fee: Some(fee), .. } => fee.due_conditions.clone(),
        _ => unreachable!(),
    };
    let first = sign_action(
        &bundle,
        &keys,
        Action::ActivateProtectionService {
            commitment_id: "evidence-assistance".into(),
        },
        &ALL,
        &[],
        "original-fee-proof",
    );
    let first_id = hash(&first);
    bundle.actions.push(first);
    let mut second = next_agreement(&bundle);
    if let Assurance::Service { fee: Some(fee), .. } = &mut second.assurance {
        fee.due_conditions = "Prospective service terms must not replace the accrued fee".into();
    }
    let amend_second = sign_action(
        &bundle,
        &keys,
        Action::AmendAgreement {
            replacement: Box::new(second.clone()),
        },
        &ALL,
        &[],
        "fee-revision-two",
    );
    bundle.actions.push(amend_second);
    let duplicate = sign_action_for(
        &second,
        &keys,
        Action::ActivateProtectionService {
            commitment_id: "evidence-assistance".into(),
        },
        &ALL,
        &[],
        "duplicate-fee-proof",
    );
    let duplicate_id = hash(&duplicate);
    bundle.actions.push(duplicate);
    let mut third = second.clone();
    third.revision = "3".into();
    third.previous_agreement_hash = Some(encoding::digest(&second).unwrap());
    third.timing.review_window = "Third service reminder".into();
    let amend_third = sign_action_for(
        &second,
        &keys,
        Action::AmendAgreement {
            replacement: Box::new(third.clone()),
        },
        &ALL,
        &[],
        "fee-revision-three",
    );
    bundle.actions.push(amend_third);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(
        report.current_agreement_hash,
        encoding::digest(&third).unwrap()
    );
    assert_eq!(report.action_status[&first_id], "APPLIED");
    assert_eq!(report.action_status[&duplicate_id], "UNRESOLVED");
    assert_eq!(report.obligations[0].due_conditions, original_due);
    let proof = report
        .unresolved_rights
        .iter()
        .find(|r| r.certificate_id == duplicate_id)
        .unwrap();
    assert_eq!(proof.obligations[0].amount, money("500"));
    assert_eq!(proof.obligations[0].due_conditions, original_due);
}
