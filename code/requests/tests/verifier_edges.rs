// SPDX-License-Identifier: AGPL-3.0-only
mod common;
use common::*;
use nonverba_requests::{
    actions, bundle::verify_assignment_bundle, contract, crypto, encoding, model::*, transcript,
};

fn receipt(
    bundle: &AssignmentBundle,
    keys: &[p256::ecdsa::SigningKey; 3],
    id: &str,
    amount: &str,
    parents: &[String],
) -> ActionCertificate {
    sign_action(
        bundle,
        keys,
        Action::PaymentReceipt {
            payment_id: id.into(),
            obligation_id: "milestone:work".into(),
            amount: money(amount),
            rail_reference: "SYNTHETIC TEST PAYEE RECEIPT - no funds moved".into(),
        },
        &[Role::Operator],
        parents,
        id,
    )
}

#[test]
fn appended_forged_signatures_and_request_duplicates_cannot_poison_valid_certificates() {
    let (mut bundle, trust, keys) = fixture();
    establish_compensation(&mut bundle, &keys);
    let mut forged = bundle.agreement.signatures[0].clone();
    forged.signature = crypto::encode_base64url(&[0; 64]);
    bundle.agreement.signatures.insert(0, forged.clone());
    let mut request = bundle.requests[0].clone();
    request.authorization.signature = forged.signature.clone();
    bundle.requests.insert(0, request);
    let mut action = bundle.actions[0].clone();
    action.authorizations[0].signature = forged.signature;
    bundle.actions.insert(0, action);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert!(report.agreement.bound);
    assert_eq!(report.obligations[0].unresolved_balance, "10000");
    assert!(!report.diagnostics.is_empty());
    assert_eq!(
        report
            .action_status
            .values()
            .filter(|s| *s == "APPLIED")
            .count(),
        1
    );
}

#[test]
fn unordered_overlapping_receipts_preserve_signed_coverage_without_double_counting() {
    let (mut bundle, trust, keys) = fixture();
    let basis = establish_compensation(&mut bundle, &keys);
    let first = receipt(&bundle, &keys, "one", "6000", std::slice::from_ref(&basis));
    let second = receipt(&bundle, &keys, "two", "6000", &[basis]);
    bundle.actions.extend([first, second]);
    for _ in 0..2 {
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert_eq!(report.obligations[0].unresolved_balance, "4000");
        assert_eq!(report.obligations[0].discharged_amount, "6000");
        assert_eq!(report.obligations[0].credit_grants.len(), 2);
        assert_eq!(
            report
                .action_status
                .values()
                .filter(|s| *s == "APPLIED")
                .count(),
            3
        );
        bundle.actions.reverse();
    }
}

#[test]
fn ordered_excess_receipt_is_reported_separately_and_resigning_is_idempotent() {
    let (mut bundle, trust, keys) = fixture();
    let basis = establish_compensation(&mut bundle, &keys);
    let first = receipt(&bundle, &keys, "one", "6000", std::slice::from_ref(&basis));
    let parent = encoding::digest(&first.proposal).unwrap();
    bundle.actions.push(first);
    let second = receipt(&bundle, &keys, "two", "6000", &[basis, parent]);
    bundle.actions.insert(0, second.clone());
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(report.obligations[0].discharged_amount, "10000");
    assert_eq!(
        report
            .payments
            .iter()
            .find(|p| p.certificate_id == encoding::digest(&second.proposal).unwrap())
            .unwrap()
            .excess_amount,
        "2000"
    );
    assert!(
        actions::prepare_action_signature(&second.proposal, &bundle, &trust, Role::Operator)
            .is_ok()
    );
}

#[test]
fn unordered_release_and_payment_preserve_both_grants_and_report_their_overlap() {
    let (mut bundle, trust, keys) = fixture();
    let basis = establish_compensation(&mut bundle, &keys);
    let payment = receipt(&bundle, &keys, "one", "5000", std::slice::from_ref(&basis));
    let release = sign_action(
        &bundle,
        &keys,
        Action::BilateralSettlement {
            settlement_id: "release".into(),
            releases: vec![BalanceRelease {
                obligation_id: "milestone:work".into(),
                amount: money("10000"),
            }],
            reservation_of_other_rights:
                "Only the identified R/O balance; retain all other claims.".into(),
        },
        &[Role::Requester, Role::Operator],
        &[basis],
        "release",
    );
    bundle.actions.extend([payment, release]);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(report.obligations[0].amount, money("10000"));
    assert_eq!(report.obligations[0].discharged_amount, "5000");
    assert_eq!(report.obligations[0].released_amount, "10000");
    assert_eq!(report.obligations[0].overlap_amount, "5000");
    assert_eq!(report.obligations[0].unresolved_balance, "0");
    assert_eq!(
        report
            .action_status
            .values()
            .filter(|s| *s == "APPLIED")
            .count(),
        3
    );
}

#[test]
fn protection_activation_is_specific_to_each_agreement_revision() {
    let (mut bundle, trust, keys) = service_fixture();
    let activation = sign_action(
        &bundle,
        &keys,
        Action::ActivateProtectionService {
            commitment_id: "evidence-assistance".into(),
        },
        &[Role::Requester, Role::Operator, Role::Mediator],
        &[],
        "activate-old",
    );
    bundle.actions.push(activation);
    assert!(
        verify_assignment_bundle(&bundle, &trust)
            .unwrap()
            .ready_to_start
    );
    let replacement = next_agreement(&bundle);
    let amendment = sign_action(
        &bundle,
        &keys,
        Action::AmendAgreement {
            replacement: Box::new(replacement.clone()),
        },
        &[Role::Requester, Role::Operator, Role::Mediator],
        &[],
        "amend",
    );
    bundle.actions.push(amendment);
    assert!(
        !verify_assignment_bundle(&bundle, &trust)
            .unwrap()
            .ready_to_start
    );
    let activation = sign_action_for(
        &replacement,
        &keys,
        Action::ActivateProtectionService {
            commitment_id: "evidence-assistance".into(),
        },
        &[Role::Requester, Role::Operator, Role::Mediator],
        &[],
        "activate-new",
    );
    assert_eq!(activation.proposal.scope_version, "2");
    bundle.actions.push(activation);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert!(report.ready_to_start, "{:?}", report.diagnostics);
    assert_eq!(
        report.obligations.len(),
        1,
        "stable fee ID is not charged again"
    );
}

#[test]
fn thirty_two_junk_signature_wrappers_cannot_revoke_an_intact_entitlement() {
    let (mut bundle, trust, keys) = fixture();
    let entitlement = establish_compensation(&mut bundle, &keys);
    let valid_root = bundle.agreement.signatures[0].clone();
    let valid_action = bundle.actions[0].clone();
    for index in 0..32 {
        let mut extra_root = valid_root.clone();
        extra_root.claims.purpose = format!("UNTRUSTED_ROOT_EXTRA_{index}");
        bundle.agreement.signatures.push(extra_root);
        // Leave the original certificate intact. An untrusted relay merely
        // appends wrappers whose claimed authorizations cannot verify.
        let mut extra_action = valid_action.clone();
        extra_action.authorizations[0].claims.purpose = format!("UNTRUSTED_ACTION_EXTRA_{index}");
        bundle.actions.push(extra_action);
    }
    assert_eq!(bundle.agreement.signatures.len(), 35);
    assert_eq!(bundle.actions.len(), 33);
    for _ in 0..2 {
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert!(report.agreement.bound);
        assert_eq!(
            report.agreement.valid_signers,
            vec![Role::Requester, Role::Operator, Role::Mediator]
        );
        assert_eq!(report.action_status[&entitlement], "APPLIED");
        assert_eq!(report.obligations.len(), 1);
        assert_eq!(report.obligations[0].unresolved_balance, "10000");
        assert_eq!(
            report
                .effects
                .iter()
                .filter(|effect| effect.certificate_id == entitlement)
                .count(),
            1
        );
        assert!(
            report.diagnostics.len() >= 64,
            "invalid extras remain visible as diagnostics"
        );
        bundle.actions.reverse();
        bundle.agreement.signatures.reverse();
    }
}

#[test]
fn unrelated_dependency_depth_cannot_erase_independently_signed_release_or_payment() {
    let (mut bundle, trust, keys) = fixture();
    let entitlement = establish_compensation(&mut bundle, &keys);
    let acknowledgment = sign_action(
        &bundle,
        &keys,
        bundle.actions[0].proposal.action.clone(),
        &[Role::Requester],
        std::slice::from_ref(&entitlement),
        "unrelated-extra-acknowledgment",
    );
    let acknowledgment_hash = encoding::digest(&acknowledgment.proposal).unwrap();
    let release = sign_action(
        &bundle,
        &keys,
        Action::BilateralSettlement {
            settlement_id: "unordered-release".into(),
            releases: vec![BalanceRelease {
                obligation_id: "milestone:work".into(),
                amount: money("7000"),
            }],
            reservation_of_other_rights:
                "Only the identified R/O balance; preserve unrelated rights.".into(),
        },
        &[Role::Requester, Role::Operator],
        std::slice::from_ref(&entitlement),
        "unordered-release",
    );
    let release_hash = encoding::digest(&release.proposal).unwrap();
    // The payment depends on X, not the release. Graph depth creates no consent
    // to allocating the release before this receipt.
    let payment = receipt(
        &bundle,
        &keys,
        "hidden-depth-payment",
        "7000",
        &[entitlement.clone(), acknowledgment_hash.clone()],
    );
    let payment_hash = encoding::digest(&payment.proposal).unwrap();
    bundle.actions.extend([payment, release, acknowledgment]);
    for _ in 0..2 {
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert_eq!(report.action_status[&entitlement], "APPLIED");
        assert_eq!(report.action_status[&acknowledgment_hash], "APPLIED");
        assert_eq!(report.action_status[&release_hash], "APPLIED");
        assert_eq!(report.action_status[&payment_hash], "APPLIED");
        assert_eq!(report.obligations[0].unresolved_balance, "3000");
        assert_eq!(report.obligations[0].released_amount, "7000");
        assert_eq!(report.obligations[0].discharged_amount, "7000");
        assert_eq!(report.obligations[0].overlap_amount, "7000");
        assert_eq!(report.effects.len(), 4);
        bundle.actions.reverse();
    }
}

#[test]
fn reactivated_service_retains_original_accrued_fee_due_conditions() {
    let (mut bundle, trust, keys) = service_fixture();
    let root = encoding::digest(&bundle.agreement.agreement).unwrap();
    let original_due = match &bundle.agreement.agreement.assurance {
        Assurance::Service { fee: Some(fee), .. } => fee.due_conditions.clone(),
        _ => panic!("service fixture must supply the separate fee"),
    };
    let activation = sign_action(
        &bundle,
        &keys,
        Action::ActivateProtectionService {
            commitment_id: "evidence-assistance".into(),
        },
        &[Role::Requester, Role::Operator, Role::Mediator],
        &[],
        "activate-original-service",
    );
    bundle.actions.push(activation);
    let mut replacement = next_agreement(&bundle);
    if let Assurance::Service { fee: Some(fee), .. } = &mut replacement.assurance {
        fee.due_conditions =
            "Prospective revision has different conditions; prior accrued debt is unchanged."
                .into();
    }
    let replacement_hash = encoding::digest(&replacement).unwrap();
    let amendment = sign_action(
        &bundle,
        &keys,
        Action::AmendAgreement {
            replacement: Box::new(replacement.clone()),
        },
        &[Role::Requester, Role::Operator, Role::Mediator],
        &[],
        "amend-prospective-fee-terms",
    );
    bundle.actions.push(amendment);
    let reactivation = sign_action_for(
        &replacement,
        &keys,
        Action::ActivateProtectionService {
            commitment_id: "evidence-assistance".into(),
        },
        &[Role::Requester, Role::Operator, Role::Mediator],
        &[],
        "reactivate-with-same-fee-id",
    );
    bundle.actions.push(reactivation);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(report.current_agreement_hash, replacement_hash);
    assert!(report.ready_to_start, "{:?}", report.diagnostics);
    assert_eq!(report.obligations.len(), 1);
    let fee = &report.obligations[0];
    assert_eq!(fee.id, "protection:assistance-fee");
    assert_eq!(fee.amount, money("500"));
    assert_eq!(fee.basis_agreement_hash, root);
    assert_eq!(
        fee.due_conditions, original_due,
        "prospective activation cannot rewrite an already accrued fee"
    );
}

#[test]
fn unsigned_payment_preflight_validates_explicit_unit_ranges_including_independent_overlap() {
    let (mut bundle, trust, keys) = fixture();
    let entitlement = establish_compensation(&mut bundle, &keys);
    let release = sign_action(
        &bundle,
        &keys,
        Action::BilateralSettlement {
            settlement_id: "existing-release".into(),
            releases: vec![BalanceRelease {
                obligation_id: "milestone:work".into(),
                amount: money("4000"),
            }],
            reservation_of_other_rights:
                "Only the identified R/O balance; retain all other rights.".into(),
        },
        &[Role::Requester, Role::Operator],
        std::slice::from_ref(&entitlement),
        "existing-release",
    );
    let release_hash = encoding::digest(&release.proposal).unwrap();
    bundle.actions.push(release);
    let before = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(before.obligations[0].unresolved_balance, "6000");
    let unordered = receipt(
        &bundle,
        &keys,
        "preflight-unordered",
        "6000",
        std::slice::from_ref(&entitlement),
    );
    assert!(
        actions::prepare_action_signature(&unordered.proposal, &bundle, &trust, Role::Operator)
            .is_ok(),
        "the explicit independently signed range remains a valid grant even when it overlaps a release"
    );
    let ordered = receipt(
        &bundle,
        &keys,
        "preflight-ordered",
        "6000",
        &[entitlement, release_hash],
    );
    assert!(
        actions::prepare_action_signature(&ordered.proposal, &bundle, &trust, Role::Operator)
            .is_ok()
    );
    bundle.actions.push(ordered);
    let after = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(after.obligations[0].released_amount, "4000");
    assert_eq!(after.obligations[0].discharged_amount, "6000");
    assert_eq!(after.obligations[0].unresolved_balance, "0");
}

fn versioned_entitlement_case(
    new_amount: &str,
    explicitly_ordered: bool,
    artifact_rule: bool,
) -> (AssignmentBundle, TrustConfiguration, String, String, String) {
    let (mut bundle, trust, keys) = artifact_fixture();
    let original_completion = completion(&mut bundle, &keys);
    let unrelated_expense = sign_action(
        &bundle,
        &keys,
        Action::AuthorizeExpense {
            expense_id: "independent-travel".into(),
            category: "travel".into(),
            amount: money("500"),
            evidence_event_hash: original_completion.clone(),
        },
        &[Role::Requester, Role::Operator],
        std::slice::from_ref(&original_completion),
        "independent-expense",
    );
    let expense_hash = encoding::digest(&unrelated_expense.proposal).unwrap();
    let old_claim = sign_action(
        &bundle,
        &keys,
        Action::AcknowledgeCompletion {
            completion_event_hash: original_completion.clone(),
            milestone_id: "work".into(),
        },
        &[Role::Requester],
        &[original_completion, expense_hash.clone()],
        "delayed-old-agreement-entitlement",
    );
    let old_hash = encoding::digest(&old_claim.proposal).unwrap();
    bundle.actions.extend([unrelated_expense, old_claim]);

    let mut replacement = next_agreement(&bundle);
    replacement.quote.quote.compensation = money(new_amount);
    replacement.quote.quote.milestones[0].compensation = money(new_amount);
    replacement.quote.authorization = crypto::sign(
        &contract::claims(
            &replacement.deployment_domain,
            &replacement.request_id,
            &encoding::digest(&replacement.quote.quote).unwrap(),
            &replacement.quote.quote.operator,
            "QUOTE",
        ),
        &keys[1],
    )
    .unwrap();
    let amendment = sign_action(
        &bundle,
        &keys,
        Action::AmendAgreement {
            replacement: Box::new(replacement.clone()),
        },
        &[Role::Requester, Role::Operator, Role::Mediator],
        &[],
        "new-agreement-terms",
    );
    bundle.actions.push(amendment);

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
    envelope.agreement_hash = encoding::digest(&replacement).unwrap();
    let revised_completion = transcript::sign_event(&envelope, &keys[1]).unwrap();
    let completion_hash = encoding::digest(&revised_completion.envelope).unwrap();
    bundle.events.push(revised_completion);
    let mut parents = vec![completion_hash.clone()];
    if explicitly_ordered {
        parents.push(old_hash.clone());
    }
    let (action, authorizers) = if artifact_rule {
        (
            Action::InvokeArtifactRule {
                rule_id: "exact-artifact".into(),
                completion_event_hash: completion_hash,
            },
            vec![Role::Operator],
        )
    } else {
        (
            Action::AcknowledgeCompletion {
                completion_event_hash: completion_hash,
                milestone_id: "work".into(),
            },
            vec![Role::Requester],
        )
    };
    let new_claim = sign_action_for(
        &replacement,
        &keys,
        action,
        &authorizers,
        &parents,
        "new-agreement-entitlement",
    );
    let new_hash = encoding::digest(&new_claim.proposal).unwrap();
    bundle.actions.push(new_claim);
    (bundle, trust, old_hash, new_hash, expense_hash)
}

#[test]
fn a_new_revision_cannot_replace_existing_milestone_unit_principal() {
    for artifact_rule in [false, true] {
        let (mut bundle, trust, old_hash, new_hash, expense_hash) =
            versioned_entitlement_case("20000", false, artifact_rule);
        for _ in 0..2 {
            let report = verify_assignment_bundle(&bundle, &trust).unwrap();
            assert_eq!(report.action_status[&old_hash], "APPLIED");
            assert_ne!(report.action_status[&new_hash], "APPLIED");
            assert_eq!(report.action_status[&expense_hash], "APPLIED");
            assert!(
                report
                    .obligations
                    .iter()
                    .any(|item| item.id == "milestone:work" && item.amount == money("10000")),
                "signed policy 2 keeps existing unit coordinates and principal immutable"
            );
            assert_eq!(
                report
                    .obligations
                    .iter()
                    .find(|item| item.id == "expense:independent-travel")
                    .unwrap()
                    .amount,
                money("500")
            );
            assert!(
                report
                    .diagnostics
                    .iter()
                    .any(|item| item.code == "AMENDMENT_WORK_UNITS")
            );
            bundle.actions.reverse();
        }
    }
}

#[test]
fn same_value_entitlements_under_different_agreements_remain_compatible() {
    for artifact_rule in [false, true] {
        let (bundle, trust, old_hash, new_hash, _) =
            versioned_entitlement_case("10000", false, artifact_rule);
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert_eq!(report.action_status[&old_hash], "APPLIED");
        assert_eq!(report.action_status[&new_hash], "APPLIED");
        let work = report
            .obligations
            .iter()
            .find(|item| item.id == "milestone:work")
            .unwrap();
        assert_eq!(work.amount, money("10000"));
        assert_eq!(work.certificate_ids.len(), 2);
        assert!(work.certificate_ids.contains(&old_hash));
        assert!(work.certificate_ids.contains(&new_hash));
    }
}

#[test]
fn causally_later_different_entitlement_preserves_the_already_established_claim() {
    for artifact_rule in [false, true] {
        let (bundle, trust, old_hash, new_hash, _) =
            versioned_entitlement_case("20000", true, artifact_rule);
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert_eq!(report.action_status[&old_hash], "APPLIED");
        assert_ne!(report.action_status[&new_hash], "APPLIED");
        assert_eq!(
            report
                .obligations
                .iter()
                .find(|item| item.id == "milestone:work")
                .unwrap()
                .amount,
            money("10000")
        );
        assert!(
            report
                .diagnostics
                .iter()
                .any(|item| item.code == "AMENDMENT_WORK_UNITS")
        );
    }
}

#[test]
fn attempted_fee_payer_replacement_cannot_revoke_the_original_fee() {
    let (mut bundle, trust, keys) = service_fixture();
    let first = sign_action(
        &bundle,
        &keys,
        Action::ActivateProtectionService {
            commitment_id: "evidence-assistance".into(),
        },
        &[Role::Requester, Role::Operator, Role::Mediator],
        &[],
        "original-fee-payer",
    );
    let first_hash = encoding::digest(&first.proposal).unwrap();
    bundle.actions.push(first);
    let mut replacement = next_agreement(&bundle);
    if let Assurance::Service { fee: Some(fee), .. } = &mut replacement.assurance {
        fee.payer = Role::Operator;
    }
    let amendment = sign_action(
        &bundle,
        &keys,
        Action::AmendAgreement {
            replacement: Box::new(replacement.clone()),
        },
        &[Role::Requester, Role::Operator, Role::Mediator],
        &[],
        "amend-prospective-fee-payer",
    );
    bundle.actions.push(amendment);
    let second = sign_action_for(
        &replacement,
        &keys,
        Action::ActivateProtectionService {
            commitment_id: "evidence-assistance".into(),
        },
        &[Role::Requester, Role::Operator, Role::Mediator],
        &[],
        "changed-fee-payer",
    );
    let second_hash = encoding::digest(&second.proposal).unwrap();
    bundle.actions.push(second);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(report.action_status[&first_hash], "APPLIED");
    assert_ne!(report.action_status[&second_hash], "APPLIED");
    assert_eq!(report.obligations.len(), 1);
    assert_eq!(report.obligations[0].debtor, Role::Requester);
    assert_eq!(report.obligations[0].unresolved_balance, "500");
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code == "AMENDMENT_FEE_UNITS")
    );
    assert!(report.ready_to_start);
}

#[test]
fn reversal_of_one_receipt_cannot_revoke_another_grant_or_another_obligation() {
    let (mut bundle, trust, keys) = service_fixture();
    let activation = sign_action(
        &bundle,
        &keys,
        Action::ActivateProtectionService {
            commitment_id: "evidence-assistance".into(),
        },
        &[Role::Requester, Role::Operator, Role::Mediator],
        &[],
        "separate-fee",
    );
    let activation_id = encoding::digest(&activation.proposal).unwrap();
    bundle.actions.push(activation);
    let entitlement = establish_compensation(&mut bundle, &keys);
    let first = receipt(
        &bundle,
        &keys,
        "first-work-grant",
        "7000",
        std::slice::from_ref(&entitlement),
    );
    let first_id = encoding::digest(&first.proposal).unwrap();
    bundle.actions.push(first);
    let second = receipt(
        &bundle,
        &keys,
        "independent-overlap",
        "2000",
        std::slice::from_ref(&entitlement),
    );
    let second_id = encoding::digest(&second.proposal).unwrap();
    bundle.actions.push(second);
    let fee_receipt = sign_action(
        &bundle,
        &keys,
        Action::PaymentReceipt {
            payment_id: "paid-service".into(),
            obligation_id: "protection:assistance-fee".into(),
            amount: money("500"),
            rail_reference: "SYNTHETIC separate fee credit".into(),
        },
        &[Role::Mediator],
        &[activation_id],
        "fee-credit",
    );
    bundle.actions.push(fee_receipt);
    let reversal = sign_action(
        &bundle,
        &keys,
        Action::ReconcileReversal {
            payment_certificate_id: first_id.clone(),
            amount: money("2000"),
            reason: "Revoke only units in the named grant".into(),
        },
        &[Role::Requester, Role::Operator, Role::Mediator],
        &[entitlement, first_id.clone()],
        "targeted-reversal",
    );
    bundle.actions.push(reversal);
    for _ in 0..2 {
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        let work = report
            .obligations
            .iter()
            .find(|o| o.id == "milestone:work")
            .unwrap();
        assert_eq!(
            work.discharged_amount, "7000",
            "the other grant still covers the revoked range"
        );
        assert_eq!(work.unresolved_balance, "3000");
        assert!(
            !work
                .credit_grants
                .iter()
                .find(|g| g.certificate_id == first_id)
                .unwrap()
                .revoked
                .is_empty()
        );
        assert!(
            work.credit_grants
                .iter()
                .find(|g| g.certificate_id == second_id)
                .unwrap()
                .revoked
                .is_empty()
        );
        let fee = report
            .obligations
            .iter()
            .find(|o| o.id == "protection:assistance-fee")
            .unwrap();
        assert_eq!(fee.discharged_amount, "500");
        assert_eq!(fee.unresolved_balance, "0");
        assert!(fee.credit_grants[0].revoked.is_empty());
        bundle.actions.reverse();
    }
}
