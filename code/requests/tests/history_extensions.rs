// SPDX-License-Identifier: AGPL-3.0-only
//! Contextual misconduct cannot revoke an independently authorized financial right.
//! All signatures are made with the public synthetic fixture keys.
mod common;

use common::*;
use nonverba_requests::{bundle::verify_assignment_bundle, encoding, model::*};
use p256::ecdsa::SigningKey;

fn expense(
    bundle: &AssignmentBundle,
    keys: &[SigningKey; 3],
    completion: &str,
    name: &str,
) -> ActionCertificate {
    sign_action(
        bundle,
        keys,
        Action::AuthorizeExpense {
            expense_id: name.into(),
            category: "travel".into(),
            amount: money("1500"),
            evidence_event_hash: completion.into(),
        },
        &[Role::Requester, Role::Operator],
        &[completion.into()],
        name,
    )
}

fn obligation<'a>(report: &'a BundleReport, id: &str) -> &'a Obligation {
    report
        .obligations
        .iter()
        .find(|item| item.id == id)
        .unwrap_or_else(|| {
            panic!(
                "previously established {id} disappeared; action status {:?}",
                report.action_status
            )
        })
}

#[test]
fn ro_expense_equivocation_cannot_retract_mediator_fee_with_contextual_expense_parent() {
    let (mut bundle, trust, keys) = service_fixture();
    let completion = completion(&mut bundle, &keys);
    let first = expense(&bundle, &keys, &completion, "first-expense");
    let expense_hash = encoding::digest(&first.proposal).unwrap();
    bundle.actions.push(first);
    let activation = sign_action(
        &bundle,
        &keys,
        Action::ActivateProtectionService {
            commitment_id: "evidence-assistance".into(),
        },
        &[Role::Requester, Role::Operator, Role::Mediator],
        &[expense_hash],
        "activation-after-observing-expense",
    );
    let activation_hash = encoding::digest(&activation.proposal).unwrap();
    bundle.actions.push(activation);
    let before = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(
        obligation(&before, "protection:assistance-fee").unresolved_balance,
        "500"
    );
    assert_eq!(
        obligation(&before, "protection:assistance-fee").creditor,
        Role::Mediator
    );

    // Only R and O sign the extension; no new M consent is present.
    let hostile = expense(&bundle, &keys, &completion, "competing-expense");
    bundle.actions.push(hostile);
    for _ in 0..2 {
        let after = verify_assignment_bundle(&bundle, &trust).unwrap();
        println!(
            "M fee extension: activation={}, obligations={:?}",
            after.action_status[&activation_hash],
            after
                .obligations
                .iter()
                .map(|item| (&item.id, &item.unresolved_balance))
                .collect::<Vec<_>>()
        );
        assert!(
            after
                .diagnostics
                .iter()
                .any(|item| item.code == "BALANCE_CONFLICT")
        );
        assert_eq!(
            obligation(&after, "protection:assistance-fee").unresolved_balance,
            "500",
            "unrelated R/O cap ambiguity does not authorize revocation of M's fee"
        );
        bundle.actions.reverse();
    }
}

#[test]
fn expense_context_conflict_cannot_revoke_independent_payee_unit_grant() {
    let (mut bundle, trust, keys) = fixture();
    let entitlement = establish_compensation(&mut bundle, &keys);
    let completion = encoding::digest(&bundle.events[0].envelope).unwrap();
    let first = expense(&bundle, &keys, &completion, "receipt-context-expense");
    let expense_hash = encoding::digest(&first.proposal).unwrap();
    bundle.actions.push(first);
    let receipt = sign_action(
        &bundle,
        &keys,
        Action::PaymentReceipt {
            payment_id: "independent-full-receipt".into(),
            obligation_id: "milestone:work".into(),
            amount: money("10000"),
            rail_reference: "SYNTHETIC TEST PAYEE RECEIPT - no funds moved".into(),
        },
        &[Role::Operator],
        &[entitlement, expense_hash],
        "receipt-after-context-expense",
    );
    let receipt_hash = encoding::digest(&receipt.proposal).unwrap();
    bundle.actions.push(receipt);
    let before = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(
        obligation(&before, "milestone:work").discharged_amount,
        "10000"
    );
    let hostile = expense(
        &bundle,
        &keys,
        &completion,
        "competing-receipt-context-expense",
    );
    bundle.actions.push(hostile);
    for _ in 0..2 {
        let after = verify_assignment_bundle(&bundle, &trust).unwrap();
        println!(
            "Receipt context extension: receipt={}, discharge={}",
            after.action_status[&receipt_hash],
            obligation(&after, "milestone:work").discharged_amount
        );
        assert_eq!(
            obligation(&after, "milestone:work").discharged_amount,
            "10000"
        );
        assert_eq!(obligation(&after, "milestone:work").unresolved_balance, "0");
        bundle.actions.reverse();
    }
}

#[test]
fn expense_context_conflict_cannot_revoke_independent_bilateral_release() {
    let (mut bundle, trust, keys) = fixture();
    let entitlement = establish_compensation(&mut bundle, &keys);
    let completion = encoding::digest(&bundle.events[0].envelope).unwrap();
    let first = expense(&bundle, &keys, &completion, "release-context-expense");
    let expense_hash = encoding::digest(&first.proposal).unwrap();
    bundle.actions.push(first);
    let release = sign_action(
        &bundle,
        &keys,
        Action::BilateralSettlement {
            settlement_id: "independent-release".into(),
            releases: vec![BalanceRelease {
                obligation_id: "milestone:work".into(),
                amount: money("4000"),
            }],
            reservation_of_other_rights: "Only these compensation units; retain all other rights."
                .into(),
        },
        &[Role::Requester, Role::Operator],
        &[entitlement, expense_hash],
        "release-after-context-expense",
    );
    let release_hash = encoding::digest(&release.proposal).unwrap();
    bundle.actions.push(release);
    let before = verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(
        obligation(&before, "milestone:work").released_amount,
        "4000"
    );
    let hostile = expense(
        &bundle,
        &keys,
        &completion,
        "competing-release-context-expense",
    );
    bundle.actions.push(hostile);
    for _ in 0..2 {
        let after = verify_assignment_bundle(&bundle, &trust).unwrap();
        println!(
            "Release context extension: release={}, released={}",
            after.action_status[&release_hash],
            obligation(&after, "milestone:work").released_amount
        );
        assert_eq!(obligation(&after, "milestone:work").released_amount, "4000");
        assert_eq!(
            obligation(&after, "milestone:work").unresolved_balance,
            "6000"
        );
        bundle.actions.reverse();
    }
}
