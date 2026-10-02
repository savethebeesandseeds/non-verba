// SPDX-License-Identifier: AGPL-3.0-only
mod common;
use common::*;
use nonverba_requests::{
    actions, bundle::verify_assignment_bundle, contract, crypto, encoding, model::*,
};

const ALL: [Role; 3] = [Role::Requester, Role::Operator, Role::Mediator];

fn excluded_coalition(excluded: Role) -> Vec<Role> {
    ALL.into_iter().filter(|role| *role != excluded).collect()
}
fn applied(report: &BundleReport, certificate: &ActionCertificate) -> bool {
    let hash = encoding::digest(&certificate.proposal).unwrap();
    report
        .effects
        .iter()
        .any(|effect| effect.certificate_id == hash)
}

#[test]
fn every_two_party_coalition_fails_to_change_the_excluded_partys_agreement_rights() {
    for excluded in ALL {
        let (mut bundle, trust, keys) = fixture();
        let root = encoding::digest(&bundle.agreement.agreement).unwrap();
        let mut replacement = next_agreement(&bundle);
        match excluded {
            Role::Operator => {
                replacement.payments.destination = "coalition-controlled-account".into()
            }
            Role::Requester => {
                replacement.quote.quote.compensation = money("20000");
                replacement.quote.quote.milestones[0].compensation = money("20000");
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
            }
            Role::Mediator => replacement
                .mediation
                .obligations
                .push("Invented unlimited extra service obligation.".into()),
        }
        let attack = sign_action(
            &bundle,
            &keys,
            Action::AmendAgreement {
                replacement: Box::new(replacement),
            },
            &excluded_coalition(excluded),
            &[],
            &format!("excluded-{}-attack", excluded.code()),
        );
        bundle.actions.push(attack.clone());
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert!(report.agreement.bound);
        assert_eq!(report.current_agreement_hash, root);
        assert!(!applied(&report, &attack));
        assert!(report.obligations.is_empty());
    }
}

#[test]
fn coalition_cannot_forge_requester_completion_acceptance() {
    let (mut bundle, trust, keys) = fixture();
    let completion = completion(&mut bundle, &keys);
    let attack = sign_action(
        &bundle,
        &keys,
        Action::AcknowledgeCompletion {
            completion_event_hash: completion.clone(),
            milestone_id: "work".into(),
        },
        &[Role::Operator, Role::Mediator],
        &[completion],
        "fake-requester-acceptance",
    );
    bundle.actions.push(attack.clone());
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert!(!applied(&report, &attack));
    assert!(report.obligations.is_empty());
}

#[test]
fn requester_and_mediator_cannot_invent_operator_receipt_or_waiver() {
    let (mut bundle, trust, keys) = fixture();
    let entitlement = establish_compensation(&mut bundle, &keys);
    let receipt = sign_action(
        &bundle,
        &keys,
        Action::PaymentReceipt {
            payment_id: "fake-payment".into(),
            obligation_id: "milestone:work".into(),
            amount: money("10000"),
            rail_reference: "coalition-screenshot".into(),
        },
        &[Role::Requester, Role::Mediator],
        std::slice::from_ref(&entitlement),
        "false-receipt",
    );
    let waiver = sign_action(
        &bundle,
        &keys,
        Action::BilateralSettlement {
            settlement_id: "fake-waiver".into(),
            releases: vec![BalanceRelease {
                obligation_id: "milestone:work".into(),
                amount: money("10000"),
            }],
            reservation_of_other_rights: "Purported reservation does not create Operator consent."
                .into(),
        },
        &[Role::Requester, Role::Mediator],
        &[entitlement],
        "false-waiver",
    );
    bundle.actions.extend([receipt.clone(), waiver.clone()]);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert!(!applied(&report, &receipt));
    assert!(!applied(&report, &waiver));
    let work = report
        .obligations
        .iter()
        .find(|item| item.id == "milestone:work")
        .unwrap();
    assert_eq!(work.unresolved_balance, "10000");
    assert_eq!(work.released_amount, "0");
    assert_eq!(work.discharged_amount, "0");
}

#[test]
fn requester_cannot_change_an_operator_quote_even_if_all_root_signatures_are_new() {
    let (mut bundle, trust, keys) = fixture();
    bundle.agreement.agreement.quote.quote.compensation = money("5000");
    bundle.agreement.agreement.quote.quote.milestones[0].compensation = money("5000");
    let quote = &bundle.agreement.agreement.quote.quote;
    // Deliberately use R's real signature. R is not authorized to issue this quote.
    bundle.agreement.agreement.quote.authorization = crypto::sign(
        &contract::claims(
            TEST_DOMAIN,
            &bundle.agreement.agreement.request_id,
            &encoding::digest(quote).unwrap(),
            &bundle.agreement.agreement.parties[0],
            "QUOTE",
        ),
        &keys[0],
    )
    .unwrap();
    sign_root(&mut bundle, &keys);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert!(!report.agreement.bound);
    assert!(report.effects.is_empty());
}

#[test]
fn every_action_authorizer_subset_is_checked_against_the_closed_matrix() {
    let (mut bundle, _, keys) = artifact_fixture();
    let completion = completion(&mut bundle, &keys);
    let actions = [
        Action::AcknowledgeCompletion {
            completion_event_hash: completion.clone(),
            milestone_id: "work".into(),
        },
        Action::InvokeArtifactRule {
            rule_id: "exact-artifact".into(),
            completion_event_hash: completion.clone(),
        },
        Action::AuthorizeExpense {
            expense_id: "travel-1".into(),
            category: "travel".into(),
            amount: money("500"),
            evidence_event_hash: completion,
        },
        Action::BilateralSettlement {
            settlement_id: "settlement-1".into(),
            releases: vec![BalanceRelease {
                obligation_id: "milestone:work".into(),
                amount: money("100"),
            }],
            reservation_of_other_rights: "M and assurance rights unchanged.".into(),
        },
        Action::PaymentReceipt {
            payment_id: "payment-1".into(),
            obligation_id: "milestone:work".into(),
            amount: money("100"),
            rail_reference: "operator-reference".into(),
        },
        Action::ReconcileReversal {
            payment_certificate_id: "aa".repeat(32),
            amount: money("100"),
            reason: "Precisely bounded reversal.".into(),
        },
        Action::AmendAgreement {
            replacement: Box::new(next_agreement(&bundle)),
        },
        Action::ActivateProtectionService {
            commitment_id: "service-1".into(),
        },
    ];
    // Independent specification oracle: bits R=1, O=2, M=4. These constants
    // deliberately do not call required_authorizers (the implementation under
    // test). The artifact rule still requires a nonempty attributed submitter.
    let required_masks = [
        0b001, // Requester acknowledges completion.
        0b000, // Any attributed submitter may present a supported artifact proof.
        0b011, // R and O authorize an expense.
        0b011, // R and O settle only their allowed balances.
        0b010, // O acknowledges receipt of task compensation.
        0b111, // All parties reconcile an exact-grant reversal.
        0b111, // All parties amend the root Agreement.
        0b111, // All parties activate the separately defined service.
    ];
    let mut checked = 0;
    for (kind, action) in actions.iter().enumerate() {
        for mask in 0u8..8 {
            let roles: Vec<_> = ALL
                .into_iter()
                .enumerate()
                .filter_map(|(index, role)| {
                    if mask & (1 << index) != 0 {
                        Some(role)
                    } else {
                        None
                    }
                })
                .collect();
            let cert = sign_action(
                &bundle,
                &keys,
                action.clone(),
                &roles,
                &[],
                &format!("matrix-{kind}-{mask}"),
            );
            let result = actions::validate_authorizations(&cert, &bundle.agreement.agreement);
            let allowed = mask != 0 && mask & required_masks[kind] == required_masks[kind];
            assert_eq!(
                result.is_ok(),
                allowed,
                "closed authorization gate for {} subset {mask}",
                action.kind()
            );
            checked += 1;
        }
    }
    assert_eq!(
        checked, 64,
        "bounded exhaustive authority gate, not a proof of physical fairness"
    );
}

#[test]
fn no_reducer_effect_without_required_signers_for_valid_supported_operations() {
    for mask in 0u8..8 {
        let (mut bundle, trust, keys) = fixture();
        let entitlement = establish_compensation(&mut bundle, &keys);
        let roles: Vec<_> = ALL
            .into_iter()
            .enumerate()
            .filter_map(|(i, role)| (mask & (1 << i) != 0).then_some(role))
            .collect();
        let action = Action::PaymentReceipt {
            payment_id: format!("bounded-payment-{mask}"),
            obligation_id: "milestone:work".into(),
            amount: money("1000"),
            rail_reference: "exact-payment-reference".into(),
        };
        let cert = sign_action(
            &bundle,
            &keys,
            action,
            &roles,
            &[entitlement],
            &format!("bounded-receipt-{mask}"),
        );
        bundle.actions.push(cert.clone());
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        let expected = roles.contains(&Role::Operator);
        assert_eq!(
            applied(&report, &cert),
            expected,
            "receipt authorizer subset {mask}"
        );
        let work = report
            .obligations
            .iter()
            .find(|item| item.id == "milestone:work")
            .unwrap();
        assert_eq!(work.discharged_amount, if expected { "1000" } else { "0" });
    }
}

#[test]
fn signatures_cannot_replay_into_other_domain_assignment_policy_or_scope() {
    let (mut base, trust, keys) = fixture();
    let completion = completion(&mut base, &keys);
    let original = sign_action(
        &base,
        &keys,
        Action::AcknowledgeCompletion {
            completion_event_hash: completion.clone(),
            milestone_id: "work".into(),
        },
        &[Role::Requester],
        &[completion],
        "original-ack",
    );
    for mutation in 0..5 {
        let mut bundle = base.clone();
        let mut cert = original.clone();
        match mutation {
            0 => cert.proposal.deployment_domain = "another.test".into(),
            1 => cert.proposal.assignment_id = "another-assignment".into(),
            2 => cert.proposal.policy_hash = "ab".repeat(32),
            3 => cert.proposal.scope_id = "milestone:other".into(),
            4 => cert.proposal.protocol_version = "3".into(),
            _ => unreachable!(),
        }
        bundle.actions.push(cert.clone());
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert!(!applied(&report, &cert));
        assert!(report.obligations.is_empty());
    }
}

#[test]
fn conflicting_fully_signed_amendments_have_no_last_write_wins_winner() {
    let (mut bundle, trust, keys) = fixture();
    establish_compensation(&mut bundle, &keys);
    let root = encoding::digest(&bundle.agreement.agreement).unwrap();
    let left = next_agreement(&bundle);
    let mut right = left.clone();
    right.timing.review_window = "A different incompatible reminder window.".into();
    let first = sign_action(
        &bundle,
        &keys,
        Action::AmendAgreement {
            replacement: Box::new(left),
        },
        &ALL,
        &[],
        "amendment-left",
    );
    let second = sign_action(
        &bundle,
        &keys,
        Action::AmendAgreement {
            replacement: Box::new(right),
        },
        &ALL,
        &[],
        "amendment-right",
    );
    bundle.actions.extend([second.clone(), first.clone()]);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(report.current_agreement_hash, root);
    assert!(!applied(&report, &first));
    assert!(!applied(&report, &second));
    assert_eq!(
        report
            .obligations
            .iter()
            .find(|item| item.id == "milestone:work")
            .unwrap()
            .unresolved_balance,
        "10000"
    );
    assert!(
        report
            .diagnostics
            .iter()
            .any(|item| item.code.to_ascii_uppercase().contains("CONFLICT"))
    );
}

#[test]
fn conflicting_payment_labels_preserve_each_explicit_credit_grant() {
    let (mut bundle, trust, keys) = fixture();
    let entitlement = establish_compensation(&mut bundle, &keys);
    for (amount, nonce) in [("3000", "receipt-left"), ("9000", "receipt-right")] {
        let cert = sign_action(
            &bundle,
            &keys,
            Action::PaymentReceipt {
                payment_id: "same-payment-slot".into(),
                obligation_id: "milestone:work".into(),
                amount: money(amount),
                rail_reference: "same-bank-reference".into(),
            },
            &[Role::Operator],
            std::slice::from_ref(&entitlement),
            nonce,
        );
        bundle.actions.push(cert);
    }
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    let work = report
        .obligations
        .iter()
        .find(|item| item.id == "milestone:work")
        .unwrap();
    assert_eq!(work.unresolved_balance, "1000");
    assert_eq!(work.discharged_amount, "9000");
    assert_eq!(work.credit_grants.len(), 2);
    assert_eq!(
        report
            .action_status
            .values()
            .filter(|s| *s == "APPLIED")
            .count(),
        3
    );
    assert!(
        report
            .diagnostics
            .iter()
            .any(|item| item.code.to_ascii_uppercase().contains("CONFLICT"))
    );
}

#[test]
fn administrator_key_replacement_cannot_change_existing_agreement_authority() {
    let (mut bundle, trust, keys) = fixture();
    let replacement = p256::ecdsa::SigningKey::from_bytes((&[99u8; 32]).into()).unwrap();
    bundle.agreement.agreement.parties[1].key =
        crypto::key_binding("O", "password-reset-key", &replacement);
    sign_root(&mut bundle, &keys);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert!(!report.agreement.bound);
    assert!(!report.ready_to_start);
    assert!(report.obligations.is_empty());
}

#[test]
fn a_new_platform_policy_or_terms_artifact_cannot_rewrite_old_signatures() {
    let (bundle, trust, _) = fixture();
    let mut changed = bundle.clone();
    changed.agreement.agreement.legal.artifacts[0].text =
        "New remote platform policy purports to grant admin override.".into();
    let result = verify_assignment_bundle(&changed, &trust).unwrap();
    assert!(!result.agreement.bound);
    let original = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert!(original.agreement.bound);
}

#[test]
fn ro_settlement_cannot_release_m_service_fee_or_expand_assurance_exposure() {
    let (mut bundle, trust, keys) = service_fixture();
    let activation = sign_action(
        &bundle,
        &keys,
        Action::ActivateProtectionService {
            commitment_id: "evidence-assistance".into(),
        },
        &ALL,
        &[],
        "activate-service",
    );
    let activation_hash = encoding::digest(&activation.proposal).unwrap();
    bundle.actions.push(activation);
    let settlement = sign_action(
        &bundle,
        &keys,
        Action::BilateralSettlement {
            settlement_id: "attack-m-fee".into(),
            releases: vec![BalanceRelease {
                obligation_id: "protection:assistance-fee".into(),
                amount: money("500"),
            }],
            reservation_of_other_rights: "Labels cannot authorize releasing M's own receivable."
                .into(),
        },
        &[Role::Requester, Role::Operator],
        &[activation_hash],
        "ro-waive-m-fee",
    );
    let mut replacement = next_agreement(&bundle);
    if let Assurance::Service {
        services, limits, ..
    } = &mut replacement.assurance
    {
        services.push("Invented additional on-site service at M's expense.".into());
        *limits = "Expanded service exposure without M's authorization.".into();
    }
    let amendment = sign_action(
        &bundle,
        &keys,
        Action::AmendAgreement {
            replacement: Box::new(replacement),
        },
        &[Role::Requester, Role::Operator],
        &[],
        "ro-expand-m-assurance",
    );
    bundle
        .actions
        .extend([settlement.clone(), amendment.clone()]);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert!(!applied(&report, &settlement));
    assert!(!applied(&report, &amendment));
    let fee = report
        .obligations
        .iter()
        .find(|item| item.id == "protection:assistance-fee")
        .unwrap();
    assert_eq!(fee.unresolved_balance, "500");
    assert_eq!(fee.released_amount, "0");
}

#[test]
fn reversal_without_every_required_party_preserves_confirmed_discharge() {
    for excluded in ALL {
        let (mut bundle, trust, keys) = fixture();
        let entitlement = establish_compensation(&mut bundle, &keys);
        let receipt = sign_action(
            &bundle,
            &keys,
            Action::PaymentReceipt {
                payment_id: "paid-1".into(),
                obligation_id: "milestone:work".into(),
                amount: money("10000"),
                rail_reference: "SYNTHETIC TEST PAYEE RECEIPT - no funds moved".into(),
            },
            &[Role::Operator],
            &[entitlement],
            "original-receipt",
        );
        let receipt_hash = encoding::digest(&receipt.proposal).unwrap();
        bundle.actions.push(receipt);
        let reversal = sign_action(
            &bundle,
            &keys,
            Action::ReconcileReversal {
                payment_certificate_id: receipt_hash.clone(),
                amount: money("10000"),
                reason: "Coalition asserts reversal without exact required authority.".into(),
            },
            &excluded_coalition(excluded),
            &[receipt_hash],
            "unsupported-reversal",
        );
        bundle.actions.push(reversal.clone());
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert!(!applied(&report, &reversal));
        assert_eq!(
            report
                .obligations
                .iter()
                .find(|item| item.id == "milestone:work")
                .unwrap()
                .discharged_amount,
            "10000"
        );
    }
}

#[test]
fn requester_operator_junk_cannot_revoke_mediator_fee_credit_or_release_its_remaining_balance() {
    let (mut bundle, trust, keys) = service_fixture();
    let activation = sign_action(
        &bundle,
        &keys,
        Action::ActivateProtectionService {
            commitment_id: "evidence-assistance".into(),
        },
        &ALL,
        &[],
        "activate-fee-protection",
    );
    let activation_id = encoding::digest(&activation.proposal).unwrap();
    bundle.actions.push(activation);
    let receipt = sign_action(
        &bundle,
        &keys,
        Action::PaymentReceipt {
            payment_id: "mediator-payment".into(),
            obligation_id: "protection:assistance-fee".into(),
            amount: money("300"),
            rail_reference: "SYNTHETIC mediator creditor receipt".into(),
        },
        &[Role::Mediator],
        std::slice::from_ref(&activation_id),
        "mediator-receipt",
    );
    let receipt_id = encoding::digest(&receipt.proposal).unwrap();
    bundle.actions.push(receipt);
    let before = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(before.obligations[0].discharged_amount, "300");
    for role in [Role::Requester, Role::Operator] {
        let junk = sign_action(
            &bundle,
            &keys,
            Action::PaymentReceipt {
                payment_id: "mediator-payment".into(),
                obligation_id: "protection:assistance-fee".into(),
                amount: money("500"),
                rail_reference: "Same label does not give R or O payee authority".into(),
            },
            &[role],
            std::slice::from_ref(&activation_id),
            role.code(),
        );
        bundle.actions.push(junk);
    }
    let release = sign_action(
        &bundle,
        &keys,
        Action::BilateralSettlement {
            settlement_id: "cannot-release-m".into(),
            releases: vec![BalanceRelease {
                obligation_id: "protection:assistance-fee".into(),
                amount: money("200"),
            }],
            reservation_of_other_rights: "A label cannot waive the excluded creditor's rights"
                .into(),
        },
        &[Role::Requester, Role::Operator],
        &[activation_id],
        "invalid-m-release",
    );
    bundle.actions.push(release);
    for _ in 0..2 {
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert_eq!(report.action_status[&receipt_id], "APPLIED");
        assert_eq!(report.obligations[0].discharged_amount, "300");
        assert_eq!(report.obligations[0].released_amount, "0");
        assert_eq!(report.obligations[0].unresolved_balance, "200");
        assert_eq!(report.obligations[0].credit_grants.len(), 1);
        bundle.actions.reverse();
    }
}
