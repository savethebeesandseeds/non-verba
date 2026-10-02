// SPDX-License-Identifier: AGPL-3.0-only
//! NV2-01 regressions reconstructed from the follow-up handoff text.
//! No reviewer archive or proposed Rust file was attached. PUBLIC TEST KEYS only.
mod common;

use common::*;
use nonverba_requests::{
    actions,
    bundle::verify_assignment_bundle,
    crypto, encoding, local,
    model::*,
    transcript::{ArtifactRef, EventBody, EvidenceManifest},
};
use serde::Serialize;

const FEE_ID: &str = "protection:assistance-fee";

#[derive(Serialize)]
struct CaseIdentifiers {
    root_agreement_hash: String,
    initial_event_x: String,
    context_event_e: String,
    activation_f: String,
    expense_a: String,
    expense_b: String,
}

struct Cases {
    late_prefix: AssignmentBundle,
    partial_prefix: AssignmentBundle,
    extension: AssignmentBundle,
    operator_signatures: AssignmentBundle,
    trust: TrustConfiguration,
    ids: CaseIdentifiers,
}

fn assert_active_fee(report: &BundleReport, activation: &str) {
    assert_eq!(
        report.action_status[activation], "APPLIED",
        "F has a complete constitutive service proof; unrelated contextual expense records cannot withdraw it"
    );
    let fee = report
        .obligations
        .iter()
        .find(|item| item.id == FEE_ID)
        .expect("the independently established mediator fee must remain an active obligation");
    assert_eq!(fee.creditor, Role::Mediator);
    assert_eq!(fee.amount.minor_units, "500");
    assert_eq!(fee.unresolved_balance, "500");
    assert!(
        !report
            .unresolved_rights
            .iter()
            .any(|item| item.certificate_id == activation),
        "moving this independent fee into unresolved rights does not preserve its established applicability"
    );
}

fn cases() -> Cases {
    let (mut prefix, trust, keys) = service_fixture();
    let x = event(
        &prefix,
        &keys,
        Role::Operator,
        0,
        None,
        vec![],
        EventBody::StartClaim,
    );
    let x_hash = encoding::digest(&x.envelope).unwrap();
    prefix.events.push(x.clone());
    let expenses: Vec<_> = ["late-expense-a", "late-expense-b"]
        .into_iter()
        .map(|name| {
            sign_action(
                &prefix,
                &keys,
                Action::AuthorizeExpense {
                    expense_id: name.into(),
                    category: "travel".into(),
                    amount: money("1500"),
                    evidence_event_hash: x_hash.clone(),
                },
                &[Role::Requester, Role::Operator],
                std::slice::from_ref(&x_hash),
                name,
            )
        })
        .collect();
    let expense_hashes: Vec<_> = expenses
        .iter()
        .map(|item| encoding::digest(&item.proposal).unwrap())
        .collect();
    // Neither expense depends on the other. Both are individually applicable.
    for (expense, hash) in expenses.iter().zip(&expense_hashes) {
        let mut separate = prefix.clone();
        separate.actions.push(expense.clone());
        let report = verify_assignment_bundle(&separate, &trust).unwrap();
        assert_eq!(report.action_status[hash], "APPLIED");
        assert_eq!(report.obligations[0].amount.minor_units, "1500");
    }
    let e = event(
        &prefix,
        &keys,
        Role::Operator,
        1,
        Some(&x),
        expense_hashes.clone(),
        EventBody::StartClaim,
    );
    let e_hash = encoding::digest(&e.envelope).unwrap();
    prefix.events.push(e);

    let mut partial_prefix = prefix.clone();
    for expense in &expenses {
        let mut partial = expense.clone();
        partial
            .authorizations
            .retain(|signature| signature.claims.role == "R");
        assert_eq!(partial.authorizations.len(), 1);
        partial_prefix.actions.push(partial);
    }
    let mut activation = sign_action(
        &prefix,
        &keys,
        Action::ActivateProtectionService {
            commitment_id: "evidence-assistance".into(),
        },
        &[Role::Requester, Role::Operator],
        std::slice::from_ref(&e_hash),
        "late-context-activation",
    );
    assert!(
        !activation
            .authorizations
            .iter()
            .any(|signature| signature.claims.role == "M")
    );
    // Exercise the honest M signing boundary BEFORE adding M's authorization.
    let late_claims =
        actions::prepare_action_signature(&activation.proposal, &prefix, &trust, Role::Mediator)
            .expect("prefix must pass M pre-signing with missing unrelated expense certificates");
    let partial_claims = actions::prepare_action_signature(
        &activation.proposal,
        &partial_prefix,
        &trust,
        Role::Mediator,
    )
    .expect("prefix must pass M pre-signing with R-only unrelated expense authorizations");
    assert_eq!(late_claims, partial_claims);
    activation
        .authorizations
        .push(crypto::sign(&late_claims, &keys[2]).unwrap());
    let activation_hash = encoding::digest(&activation.proposal).unwrap();
    prefix.actions.push(activation.clone());
    partial_prefix.actions.push(activation.clone());
    let mut extension = prefix.clone();
    extension.actions.extend(expenses.clone());
    let mut operator_signatures = prefix.clone();
    for mut expense in expenses {
        expense
            .authorizations
            .retain(|signature| signature.claims.role == "O");
        assert_eq!(expense.authorizations.len(), 1);
        operator_signatures.actions.push(expense);
    }
    let late_report = verify_assignment_bundle(&prefix, &trust).unwrap();
    let partial_report = verify_assignment_bundle(&partial_prefix, &trust).unwrap();
    assert_active_fee(&late_report, &activation_hash);
    assert_active_fee(&partial_report, &activation_hash);
    println!(
        "NV2-01 setup: both honest M pre-signing checks succeed; both prefix reports have F=APPLIED, M fee principal=500, balance=500"
    );
    Cases {
        ids: CaseIdentifiers {
            root_agreement_hash: encoding::digest(&prefix.agreement.agreement).unwrap(),
            initial_event_x: x_hash,
            context_event_e: e_hash,
            activation_f: activation_hash,
            expense_a: expense_hashes[0].clone(),
            expense_b: expense_hashes[1].clone(),
        },
        late_prefix: prefix,
        partial_prefix,
        extension,
        operator_signatures,
        trust,
    }
}

fn export_baseline(cases: &Cases) {
    let Some(directory) = std::env::var_os("NONVERBA_NV2_BASELINE_DIR") else {
        return;
    };
    let directory = std::path::PathBuf::from(directory);
    std::fs::create_dir_all(&directory).unwrap();
    let mut files = vec![
        (
            "late-context-prefix.json",
            serde_json::to_value(&cases.late_prefix).unwrap(),
        ),
        (
            "late-context-extension.json",
            serde_json::to_value(&cases.extension).unwrap(),
        ),
        (
            "partial-authorization-prefix.json",
            serde_json::to_value(&cases.partial_prefix).unwrap(),
        ),
        ("trust.json", serde_json::to_value(&cases.trust).unwrap()),
        (
            "case-identifiers.json",
            serde_json::to_value(&cases.ids).unwrap(),
        ),
    ];
    for (name, bundle) in [
        ("late-context-prefix-native-report.json", &cases.late_prefix),
        (
            "late-context-extension-native-report.json",
            &cases.extension,
        ),
        (
            "partial-authorization-prefix-native-report.json",
            &cases.partial_prefix,
        ),
    ] {
        files.push((
            name,
            serde_json::to_value(verify_assignment_bundle(bundle, &cases.trust).unwrap()).unwrap(),
        ));
    }
    for (name, value) in files {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(directory.join(name))
            .expect("baseline artifacts are immutable; use a fresh output directory");
        file.write_all(&serde_json::to_vec_pretty(&value).unwrap())
            .unwrap();
    }
}

fn check_delivery_orders(
    cases: &Cases,
    prefix: &AssignmentBundle,
    extension: &AssignmentBundle,
    variant: &str,
) {
    let mut appended = prefix.clone();
    appended.actions.extend(extension.actions.clone());
    let forward = local::merge_bundles(prefix, extension).unwrap();
    let reverse = local::merge_bundles(extension, prefix).unwrap();
    let mut reordered = forward.clone();
    reordered.actions.reverse();
    reordered.events.reverse();
    let deliveries = [
        ("append", appended),
        ("merge-forward", forward),
        ("merge-reverse", reverse),
        ("reversed-delivery", reordered),
    ];
    let mut reports = vec![];
    for (order, bundle) in deliveries {
        let report = verify_assignment_bundle(&bundle, &cases.trust).unwrap();
        let fee = report.obligations.iter().find(|item| item.id == FEE_ID);
        println!(
            "NV2-01 {variant}/{order}: F={}, M_fee_balance={:?}, F_unresolved={}, diagnostics={:?}",
            report.action_status[&cases.ids.activation_f],
            fee.map(|item| &item.unresolved_balance),
            report
                .unresolved_rights
                .iter()
                .any(|item| item.certificate_id == cases.ids.activation_f),
            report
                .diagnostics
                .iter()
                .map(|item| (&item.code, &item.subject))
                .collect::<Vec<_>>()
        );
        // Every delivery variant is actually evaluated before asserting the expected correction.
        reports.push(report);
    }
    for report in reports {
        assert_active_fee(&report, &cases.ids.activation_f);
        for hash in [&cases.ids.expense_a, &cases.ids.expense_b] {
            assert_eq!(
                report.action_status[hash], "CONFLICTED",
                "R/O expense cap conflict remains separately attributed"
            );
        }
        assert!(
            report
                .diagnostics
                .iter()
                .any(|item| item.code == "BALANCE_CONFLICT")
        );
    }
}

#[test]
fn late_delivery_of_unrelated_expenses_cannot_retract_mediator_fee() {
    let cases = cases();
    export_baseline(&cases);
    check_delivery_orders(&cases, &cases.late_prefix, &cases.extension, "late-records");
}

#[test]
fn late_operator_authorizations_cannot_retract_mediator_fee() {
    let cases = cases();
    check_delivery_orders(
        &cases,
        &cases.partial_prefix,
        &cases.operator_signatures,
        "late-signatures",
    );
}

#[test]
fn service_authority_scope_and_supported_prerequisites_remain_required() {
    for control in ["missing-m", "wrong-commitment", "unsupported-prerequisite"] {
        let (mut bundle, trust, keys) = service_fixture();
        if control == "unsupported-prerequisite" {
            let Assurance::Service { prerequisites, .. } =
                &mut bundle.agreement.agreement.assurance
            else {
                unreachable!()
            };
            prerequisites
                .push("An external prerequisite whose truth this policy cannot establish.".into());
            sign_root(&mut bundle, &keys);
        }
        let roles: &[Role] = if control == "missing-m" {
            &[Role::Requester, Role::Operator]
        } else {
            &[Role::Requester, Role::Operator, Role::Mediator]
        };
        let certificate = sign_action(
            &bundle,
            &keys,
            Action::ActivateProtectionService {
                commitment_id: if control == "wrong-commitment" {
                    "unsupported-service"
                } else {
                    "evidence-assistance"
                }
                .into(),
            },
            roles,
            &[],
            control,
        );
        if control != "missing-m" {
            assert!(
                actions::prepare_action_signature(
                    &certificate.proposal,
                    &bundle,
                    &trust,
                    Role::Mediator
                )
                .is_err(),
                "honest pre-signing must reject the invalid {control} service proposal"
            );
        }
        let id = encoding::digest(&certificate.proposal).unwrap();
        bundle.actions.push(certificate);
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert!(
            report.agreement.bound,
            "the negative control must reach action validation"
        );
        assert_ne!(
            report.action_status[&id], "APPLIED",
            "{control} cannot establish an M service fee"
        );
        assert!(!report.obligations.iter().any(|item| item.id == FEE_ID));
        assert!(!report.effects.iter().any(|item| item.certificate_id == id));
    }
}

#[test]
fn genuine_payee_receipt_still_requires_its_missing_obligation_proof() {
    let (mut bundle, trust, keys) = fixture();
    let entitlement = establish_compensation(&mut bundle, &keys);
    let receipt = sign_action(
        &bundle,
        &keys,
        Action::PaymentReceipt {
            payment_id: "genuine-receipt-missing-basis".into(),
            obligation_id: "milestone:work".into(),
            amount: money("10000"),
            rail_reference: "SYNTHETIC TEST PAYEE RECEIPT - no funds moved".into(),
        },
        &[Role::Operator],
        std::slice::from_ref(&entitlement),
        "missing-constitutive-basis",
    );
    let receipt_hash = encoding::digest(&receipt.proposal).unwrap();
    assert_eq!(
        actions::validate_authorizations(&receipt, &bundle.agreement.agreement).unwrap(),
        vec![Role::Operator]
    );
    let mut complete = bundle.clone();
    complete.actions.push(receipt.clone());
    let valid = verify_assignment_bundle(&complete, &trust).unwrap();
    assert_eq!(valid.action_status[&receipt_hash], "APPLIED");
    assert_eq!(valid.obligations[0].discharged_amount, "10000");

    bundle.actions.clear();
    assert!(
        actions::prepare_action_signature(&receipt.proposal, &bundle, &trust, Role::Operator)
            .is_err()
    );
    bundle.actions.push(receipt);
    let report = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert!(matches!(
        report.action_status[&receipt_hash].as_str(),
        "PENDING" | "REJECTED"
    ));
    assert!(
        report.obligations.is_empty(),
        "a signed receipt cannot invent its underlying entitlement"
    );
    assert!(
        !report
            .effects
            .iter()
            .any(|item| item.certificate_id == receipt_hash)
    );
}

#[test]
fn invalid_or_incomplete_context_wrappers_cannot_remove_the_signed_fee() {
    let cases = cases();
    let expenses: Vec<_> = cases
        .extension
        .actions
        .iter()
        .filter(|item| matches!(item.proposal.action, Action::AuthorizeExpense { .. }))
        .cloned()
        .collect();
    for wrapper in [
        "r-only",
        "o-only",
        "no-authorizations",
        "invalid-signatures",
    ] {
        let mut extended = cases.late_prefix.clone();
        for original in &expenses {
            let mut expense = original.clone();
            match wrapper {
                "r-only" => expense
                    .authorizations
                    .retain(|item| item.claims.role == "R"),
                "o-only" => expense
                    .authorizations
                    .retain(|item| item.claims.role == "O"),
                "no-authorizations" => expense.authorizations.clear(),
                _ => {
                    for signature in &mut expense.authorizations {
                        signature.signature = crypto::encode_base64url(&[0; 64]);
                    }
                }
            }
            extended.actions.push(expense);
        }
        // Damaged copies of the already valid F and E must not poison their intact copies.
        let mut damaged_activation = cases.late_prefix.actions[0].clone();
        for signature in &mut damaged_activation.authorizations {
            signature.signature = crypto::encode_base64url(&[0; 64]);
        }
        extended.actions.push(damaged_activation);
        let mut damaged_context = cases.late_prefix.events[1].clone();
        damaged_context.authorization.signature = crypto::encode_base64url(&[0; 64]);
        extended.events.push(damaged_context);
        for _ in 0..2 {
            let report = verify_assignment_bundle(&extended, &cases.trust).unwrap();
            assert_active_fee(&report, &cases.ids.activation_f);
            for expense in [&cases.ids.expense_a, &cases.ids.expense_b] {
                assert_ne!(
                    report.action_status[expense], "APPLIED",
                    "{wrapper} cannot establish an expense"
                );
            }
            assert!(
                !report.diagnostics.is_empty(),
                "invalid or incomplete context must remain attributable"
            );
            extended.actions.reverse();
            extended.events.reverse();
        }
    }
}

fn protected_role_extension(protected: Role, release: bool) {
    let cases = cases();
    let (_, _, keys) = service_fixture();
    let mut prefix = cases.late_prefix.clone();
    let mut additions = vec![];
    let completing_role = if protected == Role::Operator {
        Role::Requester
    } else {
        Role::Operator
    };
    for original in cases
        .extension
        .actions
        .iter()
        .filter(|item| matches!(item.proposal.action, Action::AuthorizeExpense { .. }))
    {
        let mut partial = original.clone();
        partial
            .authorizations
            .retain(|item| item.claims.role == protected.code());
        assert_eq!(partial.authorizations.len(), 1);
        prefix.actions.push(partial);
        let mut completion = original.clone();
        completion
            .authorizations
            .retain(|item| item.claims.role == completing_role.code());
        assert_eq!(completion.authorizations.len(), 1);
        additions.push(completion);
    }
    let evidence_hash = encoding::bytes_digest(EVIDENCE_BYTES);
    let completion = event(
        &prefix,
        &keys,
        Role::Operator,
        2,
        Some(&prefix.events[1]),
        vec![],
        EventBody::CompletionClaim {
            milestone_id: "work".into(),
            manifest: EvidenceManifest {
                artifacts: vec![ArtifactRef {
                    sha256: evidence_hash.clone(),
                    byte_length: EVIDENCE_BYTES.len().to_string(),
                    media_type: "text/plain".into(),
                    capture_reference: None,
                }],
                description: "Synthetic digital evidence; no physical verification claim.".into(),
            },
        },
    );
    let completion_hash = encoding::digest(&completion.envelope).unwrap();
    prefix.events.push(completion);
    prefix.attachments.push(Attachment {
        sha256: evidence_hash,
        bytes_b64: crypto::encode_base64url(EVIDENCE_BYTES),
    });
    let acknowledgment = sign_action(
        &prefix,
        &keys,
        Action::AcknowledgeCompletion {
            completion_event_hash: completion_hash.clone(),
            milestone_id: "work".into(),
        },
        &[Role::Requester],
        &[completion_hash],
        "excluded-role-exact-acknowledgment",
    );
    let acknowledgment_hash = encoding::digest(&acknowledgment.proposal).unwrap();
    prefix.actions.push(acknowledgment);
    let protected_certificate = if protected == Role::Requester && release {
        let release = sign_action(
            &prefix,
            &keys,
            Action::BilateralSettlement {
                settlement_id: "excluded-requester-release".into(),
                releases: vec![BalanceRelease {
                    obligation_id: "milestone:work".into(),
                    amount: money("4000"),
                }],
                reservation_of_other_rights:
                    "Only exact work units; retain all other claims and M's rights.".into(),
            },
            &[Role::Requester, Role::Operator],
            std::slice::from_ref(&acknowledgment_hash),
            "excluded-requester-release",
        );
        let id = encoding::digest(&release.proposal).unwrap();
        prefix.actions.push(release);
        id
    } else if protected == Role::Requester {
        let receipt = sign_action(
            &prefix,
            &keys,
            Action::PaymentReceipt {
                payment_id: "excluded-requester-full-receipt".into(),
                obligation_id: "milestone:work".into(),
                amount: money("10000"),
                rail_reference: "SYNTHETIC TEST PAYEE RECEIPT - no funds moved".into(),
            },
            &[Role::Operator],
            std::slice::from_ref(&acknowledgment_hash),
            "excluded-requester-discharge",
        );
        let id = encoding::digest(&receipt.proposal).unwrap();
        prefix.actions.push(receipt);
        id
    } else {
        acknowledgment_hash
    };
    let assert_protection = |report: &BundleReport| {
        assert_eq!(report.action_status[&protected_certificate], "APPLIED");
        let work = report
            .obligations
            .iter()
            .find(|item| item.id == "milestone:work")
            .expect("constitutively established work obligation must remain represented");
        assert_eq!(work.amount.minor_units, "10000");
        assert_eq!(
            work.discharged_amount,
            if protected == Role::Requester && !release {
                "10000"
            } else {
                "0"
            }
        );
        assert_eq!(
            work.unresolved_balance,
            if release {
                "6000"
            } else if protected == Role::Requester {
                "0"
            } else {
                "10000"
            }
        );
        assert_eq!(work.released_amount, if release { "4000" } else { "0" });
        assert!(
            !report
                .unresolved_rights
                .iter()
                .any(|item| item.certificate_id == protected_certificate)
        );
    };
    let before = verify_assignment_bundle(&prefix, &cases.trust).unwrap();
    assert_protection(&before);
    assert!(
        additions
            .iter()
            .flat_map(|item| &item.authorizations)
            .all(|signature| signature.claims.role != protected.code()),
        "the extension must contain no new authorization by the protected role"
    );
    let mut extension = prefix.clone();
    extension.actions = additions;
    for mut combined in [
        local::merge_bundles(&prefix, &extension).unwrap(),
        local::merge_bundles(&extension, &prefix).unwrap(),
    ] {
        for _ in 0..2 {
            let after = verify_assignment_bundle(&combined, &cases.trust).unwrap();
            assert_protection(&after);
            for expense in [&cases.ids.expense_a, &cases.ids.expense_b] {
                assert_eq!(after.action_status[expense], "CONFLICTED");
            }
            combined.actions.reverse();
            combined.events.reverse();
        }
    }
}

#[test]
fn late_requester_signatures_cannot_retract_excluded_operator_entitlement() {
    protected_role_extension(Role::Operator, false);
}

#[test]
fn late_operator_signatures_cannot_retract_excluded_requester_credit_or_release() {
    for release in [false, true] {
        protected_role_extension(Role::Requester, release);
    }
}
