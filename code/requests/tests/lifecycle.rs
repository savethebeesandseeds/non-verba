// SPDX-License-Identifier: AGPL-3.0-only
mod common;
use common::*;
use nonverba_requests::{
    bundle::verify_assignment_bundle, contract, crypto, encoding, model::*, transcript::EventBody,
};

fn obligation<'a>(report: &'a BundleReport, id: &str) -> &'a Obligation {
    report
        .obligations
        .iter()
        .find(|item| item.id == id)
        .unwrap_or_else(|| panic!("missing obligation {id}: {:?}", report.diagnostics))
}

#[test]
fn real_signed_happy_path_preserves_partial_payments_and_portable_verification() {
    let (mut bundle, trust, keys) = fixture();
    assert!(contract::verify_request(&bundle.requests[0], &trust).is_ok());
    assert!(
        contract::verify_quote(
            &bundle.agreement.agreement.quote,
            &bundle.requests[0],
            &trust
        )
        .is_ok()
    );
    let initial = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert!(initial.agreement.bound, "{:?}", initial.diagnostics);
    assert!(initial.ready_to_start, "{:?}", initial.readiness_reasons);
    assert!(initial.obligations.is_empty());

    let entitlement = establish_compensation(&mut bundle, &keys);
    let accepted = verify_assignment_bundle(&bundle, &trust).unwrap();
    let work = obligation(&accepted, "milestone:work");
    assert_eq!(work.amount, money("10000"));
    assert_eq!(work.discharged_amount, "0");
    assert_eq!(work.unresolved_balance, "10000");
    assert!(
        accepted
            .effects
            .iter()
            .any(|effect| effect.certificate_id == entitlement)
    );

    let first = sign_action(
        &bundle,
        &keys,
        Action::PaymentReceipt {
            payment_id: "payment-first".into(),
            obligation_id: "milestone:work".into(),
            amount: money("4000"),
            rail_reference: "operator-bank-receipt-first".into(),
        },
        &[Role::Operator],
        std::slice::from_ref(&entitlement),
        "first-receipt",
    );
    let first_hash = encoding::digest(&first.proposal).unwrap();
    bundle.actions.push(first.clone());
    bundle.actions.push(first);
    let partial = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(
        obligation(&partial, "milestone:work").discharged_amount,
        "4000"
    );
    assert_eq!(
        obligation(&partial, "milestone:work").unresolved_balance,
        "6000"
    );
    assert_eq!(
        partial
            .effects
            .iter()
            .filter(|effect| effect.certificate_id == first_hash)
            .count(),
        1
    );

    let second = sign_action(
        &bundle,
        &keys,
        Action::PaymentReceipt {
            payment_id: "payment-second".into(),
            obligation_id: "milestone:work".into(),
            amount: money("6000"),
            rail_reference: "operator-bank-receipt-second".into(),
        },
        &[Role::Operator],
        &[entitlement, first_hash],
        "second-receipt",
    );
    bundle.actions.insert(0, second);
    let completed = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(
        obligation(&completed, "milestone:work").discharged_amount,
        "10000"
    );
    assert_eq!(
        obligation(&completed, "milestone:work").unresolved_balance,
        "0"
    );
    let exported = encoding::canonical(&bundle).unwrap();
    let imported: AssignmentBundle = encoding::strict_parse(&exported).unwrap();
    let offline = verify_assignment_bundle(&imported, &trust).unwrap();
    assert_eq!(
        encoding::canonical(&completed).unwrap(),
        encoding::canonical(&offline).unwrap()
    );
    assert!(offline.transcript.completeness_unknown);
    assert!(
        offline
            .history_completeness
            .to_ascii_lowercase()
            .contains("unknown")
    );
}

#[test]
fn missing_root_signer_prevents_readiness_without_inventing_consent() {
    for excluded in [Role::Requester, Role::Operator, Role::Mediator] {
        let (mut bundle, trust, _) = fixture();
        bundle
            .agreement
            .signatures
            .retain(|signature| signature.claims.role != excluded.code());
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert!(!report.agreement.bound);
        assert!(!report.ready_to_start);
        assert!(report.obligations.is_empty());
        assert!(report.effects.is_empty());
    }
}

#[test]
fn payer_statement_and_mediator_webhook_do_not_discharge_operator_claim() {
    let (mut bundle, trust, keys) = fixture();
    establish_compensation(&mut bundle, &keys);
    let payer = event(
        &bundle,
        &keys,
        Role::Requester,
        0,
        None,
        vec![],
        EventBody::PayerStatement {
            obligation_id: "milestone:work".into(),
            amount: money("10000"),
            reference: "unverifiable-bank-screenshot".into(),
        },
    );
    let webhook = event(
        &bundle,
        &keys,
        Role::Mediator,
        0,
        None,
        vec![],
        EventBody::MediatorPaymentObservation {
            obligation_id: "milestone:work".into(),
            amount: money("10000"),
            reference: "webhook-authenticated-by-secret-held-by-M".into(),
        },
    );
    bundle.events.extend([payer, webhook]);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(report.transcript.accepted.len(), 3);
    assert_eq!(obligation(&report, "milestone:work").discharged_amount, "0");
    assert_eq!(
        obligation(&report, "milestone:work").unresolved_balance,
        "10000"
    );
}

#[test]
fn requester_rejection_cannot_erase_preagreed_exact_artifact_entitlement() {
    let (mut bundle, trust, keys) = artifact_fixture();
    let completion = completion(&mut bundle, &keys);
    let rule = sign_action(
        &bundle,
        &keys,
        Action::InvokeArtifactRule {
            rule_id: "exact-artifact".into(),
            completion_event_hash: completion.clone(),
        },
        &[Role::Operator],
        std::slice::from_ref(&completion),
        "invoke-exact-artifact",
    );
    bundle.actions.push(rule);
    let rejection = event(
        &bundle,
        &keys,
        Role::Requester,
        0,
        None,
        vec![completion.clone()],
        EventBody::RejectionClaim {
            completion_hash: completion,
            reason:
                "I dispute physical quality; digital bytes still satisfy the limited signed rule."
                    .into(),
        },
    );
    bundle.events.push(rejection);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(obligation(&report, "milestone:work").amount, money("10000"));
    assert_eq!(
        obligation(&report, "milestone:work").unresolved_balance,
        "10000"
    );
    assert!(!report.unresolved_claims.is_empty());
    assert!(report.effects.iter().any(|effect| {
        effect.explanation.to_ascii_lowercase().contains("digit")
            || effect.explanation.to_ascii_lowercase().contains("byte")
    }));
}

#[test]
fn changed_attachment_bytes_never_satisfy_an_exact_artifact_rule() {
    let (mut bundle, trust, keys) = artifact_fixture();
    let completion = completion(&mut bundle, &keys);
    let action = sign_action(
        &bundle,
        &keys,
        Action::InvokeArtifactRule {
            rule_id: "exact-artifact".into(),
            completion_event_hash: completion.clone(),
        },
        &[Role::Operator],
        &[completion],
        "invoke-changed-bytes",
    );
    bundle.actions.push(action);
    bundle.attachments[0].bytes_b64 =
        crypto::encode_base64url(b"Different file retaining a false digest label.");
    match verify_assignment_bundle(&bundle, &trust) {
        Err(_) => (),
        Ok(report) => assert!(
            report.obligations.is_empty(),
            "altered artifact cannot establish any compensation"
        ),
    }
}

#[test]
fn mediation_recommendation_and_assurance_assessment_do_not_erase_accrued_money() {
    let (mut bundle, trust, keys) = fixture();
    establish_compensation(&mut bundle, &keys);
    let recommendation = event(
        &bundle,
        &keys,
        Role::Mediator,
        0,
        None,
        vec![],
        EventBody::Recommendation {
            dispute_id: "dispute-1".into(),
            text: "I propose zero payment; this is not binding authority.".into(),
        },
    );
    let assessment = event(
        &bundle,
        &keys,
        Role::Mediator,
        1,
        Some(&recommendation),
        vec![],
        EventBody::AssuranceAssessment {
            case_id: "case-1".into(),
            position: "The mediator denies this claim; denial is attributed, not adjudication."
                .into(),
        },
    );
    bundle.events.extend([assessment, recommendation]);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(
        obligation(&report, "milestone:work").unresolved_balance,
        "10000"
    );
    assert_eq!(obligation(&report, "milestone:work").released_amount, "0");
    assert_eq!(
        report.performance, "ACCEPTED",
        "mediator assessments and assurance cases are separate from performance acceptance"
    );
}

#[test]
fn bilateral_settlement_releases_only_the_specified_ro_balance_without_m_signature() {
    let (mut bundle, trust, keys) = fixture();
    let entitlement = establish_compensation(&mut bundle, &keys);
    let pinned_mediation = encoding::digest(&bundle.agreement.agreement.mediation).unwrap();
    let pinned_assurance = encoding::digest(&bundle.agreement.agreement.assurance).unwrap();
    let settlement = sign_action(
        &bundle,
        &keys,
        Action::BilateralSettlement {
            settlement_id: "settlement-1".into(),
            releases: vec![BalanceRelease {
                obligation_id: "milestone:work".into(),
                amount: money("2500"),
            }],
            reservation_of_other_rights:
                "All M duties/defenses/exposure and separate assurance benefits remain unchanged."
                    .into(),
        },
        &[Role::Requester, Role::Operator],
        &[entitlement],
        "narrow-ro-settlement",
    );
    let hash = encoding::digest(&settlement.proposal).unwrap();
    bundle.actions.push(settlement);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(
        obligation(&report, "milestone:work").released_amount,
        "2500"
    );
    assert_eq!(
        obligation(&report, "milestone:work").unresolved_balance,
        "7500"
    );
    let effect = report
        .effects
        .iter()
        .find(|effect| effect.certificate_id == hash)
        .expect("narrow bilateral settlement should apply");
    assert_eq!(effect.authorizers, vec![Role::Requester, Role::Operator]);
    assert_eq!(
        encoding::digest(&bundle.agreement.agreement.mediation).unwrap(),
        pinned_mediation
    );
    assert_eq!(
        encoding::digest(&bundle.agreement.agreement.assurance).unwrap(),
        pinned_assurance
    );
}

#[test]
fn signed_reversal_reopens_only_the_previously_receipted_amount() {
    let (mut bundle, trust, keys) = fixture();
    let entitlement = establish_compensation(&mut bundle, &keys);
    let payment = sign_action(
        &bundle,
        &keys,
        Action::PaymentReceipt {
            payment_id: "paid-1".into(),
            obligation_id: "milestone:work".into(),
            amount: money("7000"),
            rail_reference: "receipt-1".into(),
        },
        &[Role::Operator],
        std::slice::from_ref(&entitlement),
        "receipt-before-reversal",
    );
    let payment_hash = encoding::digest(&payment.proposal).unwrap();
    bundle.actions.push(payment);
    let reversal = sign_action(
        &bundle,
        &keys,
        Action::ReconcileReversal {
            payment_certificate_id: payment_hash.clone(),
            amount: money("2000"),
            reason: "All three authorize this exact observed reversal.".into(),
        },
        &[Role::Requester, Role::Operator, Role::Mediator],
        &[entitlement, payment_hash],
        "reconcile-reversal",
    );
    bundle.actions.insert(0, reversal);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(
        obligation(&report, "milestone:work").discharged_amount,
        "5000"
    );
    assert_eq!(
        obligation(&report, "milestone:work").unresolved_balance,
        "5000"
    );
}

#[test]
fn malformed_money_unknown_admin_fields_and_policy_changes_fail_closed() {
    let (bundle, trust, _) = fixture();
    let value = serde_json::to_value(&bundle).unwrap();
    for bad in ["-1", "01", "1.1", "1e3", "9007199254740992"] {
        let mut invalid = value.clone();
        invalid["agreement"]["agreement"]["quote"]["quote"]["compensation"]["minor_units"] =
            bad.into();
        assert!(
            encoding::strict_parse::<AssignmentBundle>(&serde_json::to_vec(&invalid).unwrap())
                .is_err()
        );
    }
    let mut invalid = value.clone();
    invalid["assignment_status"] = "PAID_BY_ADMIN".into();
    assert!(
        encoding::strict_parse::<AssignmentBundle>(&serde_json::to_vec(&invalid).unwrap()).is_err()
    );
    let mut invalid = value;
    invalid["agreement"]["agreement"]["quote"]["quote"]["compensation"]["exponent"] = 3.into();
    assert!(
        encoding::strict_parse::<AssignmentBundle>(&serde_json::to_vec(&invalid).unwrap()).is_err()
    );
    let mut changed = bundle;
    changed
        .agreement
        .agreement
        .policy
        .mediator_has_task_fund_control = true;
    let report = verify_assignment_bundle(&changed, &trust).unwrap();
    assert!(!report.agreement.bound);
    assert!(!report.ready_to_start);
}

#[test]
fn deterministic_reordering_and_duplicate_delivery_preserve_financial_result() {
    let (mut bundle, trust, keys) = fixture();
    let entitlement = establish_compensation(&mut bundle, &keys);
    for i in 0..5 {
        let mut receipt = sign_action(
            &bundle,
            &keys,
            Action::PaymentReceipt {
                payment_id: format!("payment-{i}"),
                obligation_id: "milestone:work".into(),
                amount: money("1000"),
                rail_reference: format!("operator-receipt-{i}"),
            },
            &[Role::Operator],
            std::slice::from_ref(&entitlement),
            &format!("nonce-payment-{i}"),
        );
        receipt.proposal.allocations[0].start = (i * 1000).to_string();
        receipt.proposal.allocations[0].end = ((i + 1) * 1000).to_string();
        resign_action_for(
            &bundle.agreement.agreement,
            &keys,
            &mut receipt,
            &[Role::Operator],
        );
        bundle.actions.push(receipt);
    }
    let expected = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(
        obligation(&expected, "milestone:work").unresolved_balance,
        "5000"
    );
    let mut seed = 0x4e4f4e5645524241u64;
    for _ in 0..32 {
        let mut shuffled = bundle.clone();
        for i in (1..shuffled.actions.len()).rev() {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            shuffled.actions.swap(i, (seed as usize) % (i + 1));
        }
        shuffled.actions.push(shuffled.actions[0].clone());
        shuffled.events.push(shuffled.events[0].clone());
        let actual = verify_assignment_bundle(&shuffled, &trust).unwrap();
        assert_eq!(
            encoding::canonical(&actual.obligations).unwrap(),
            encoding::canonical(&expected.obligations).unwrap()
        );
        assert_eq!(actual.effects.len(), expected.effects.len());
    }
}

#[test]
fn prospective_all_party_amendment_preserves_already_accrued_compensation() {
    let (mut bundle, trust, keys) = fixture();
    establish_compensation(&mut bundle, &keys);
    let mut replacement = next_agreement(&bundle);
    replacement.timing.review_window =
        "Prospective review process changes; existing debt units remain unchanged.".into();
    let amended_hash = encoding::digest(&replacement).unwrap();
    let amendment = sign_action(
        &bundle,
        &keys,
        Action::AmendAgreement {
            replacement: Box::new(replacement),
        },
        &[Role::Requester, Role::Operator, Role::Mediator],
        &[],
        "prospective-amendment",
    );
    bundle.actions.push(amendment);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(report.current_agreement_hash, amended_hash);
    assert_eq!(obligation(&report, "milestone:work").amount, money("10000"));
    assert_eq!(
        obligation(&report, "milestone:work").unresolved_balance,
        "10000"
    );
    assert_ne!(
        obligation(&report, "milestone:work").basis_agreement_hash,
        amended_hash
    );
}

#[test]
fn nonfinancial_protection_service_has_separate_fee_and_actual_payee_authority() {
    let (mut bundle, trust, keys) = service_fixture();
    let before = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert!(!before.ready_to_start);
    assert!(before.obligations.is_empty());
    let activation = sign_action(
        &bundle,
        &keys,
        Action::ActivateProtectionService {
            commitment_id: "evidence-assistance".into(),
        },
        &[Role::Requester, Role::Operator, Role::Mediator],
        &[],
        "activate-service",
    );
    let activated_hash = encoding::digest(&activation.proposal).unwrap();
    bundle.actions.push(activation);
    establish_compensation(&mut bundle, &keys);
    let active = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert!(active.ready_to_start);
    assert_eq!(obligation(&active, "milestone:work").amount, money("10000"));
    assert_eq!(
        obligation(&active, "protection:assistance-fee").amount,
        money("500")
    );
    assert_eq!(
        obligation(&active, "protection:assistance-fee").creditor,
        Role::Mediator
    );
    let receipt = sign_action(
        &bundle,
        &keys,
        Action::PaymentReceipt {
            payment_id: "service-payment".into(),
            obligation_id: "protection:assistance-fee".into(),
            amount: money("500"),
            rail_reference: "SYNTHETIC TEST PAYEE RECEIPT - no funds moved".into(),
        },
        &[Role::Mediator],
        &[activated_hash],
        "service-receipt",
    );
    bundle.actions.push(receipt);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(
        obligation(&report, "protection:assistance-fee").discharged_amount,
        "500"
    );
    assert_eq!(
        obligation(&report, "milestone:work").unresolved_balance,
        "10000"
    );
}
