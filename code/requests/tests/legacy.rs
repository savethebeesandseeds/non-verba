// SPDX-License-Identifier: AGPL-3.0-only
//! Immutable captured v1 evidence remains authenticated, without silently
//! interpreting old credits under protocol-2 interval allocation semantics.
use nonverba_requests::{contract, crypto, encoding, legacy, model::*};

fn original() -> (AssignmentBundle, TrustConfiguration) {
    (
        encoding::strict_parse(include_bytes!("fixtures/legacy-v1/bundle.json")).unwrap(),
        encoding::strict_parse(include_bytes!("fixtures/legacy-v1/trust.json")).unwrap(),
    )
}

#[test]
fn immutable_original_v1_bytes_authenticate_without_zero_balance_or_migration() {
    let (bundle, trust) = original();
    let before = encoding::canonical(&bundle).unwrap();
    let report = legacy::inspect(&bundle, &trust).unwrap();
    assert!(report.agreement.bound);
    assert_eq!(report.agreement.valid_signers.len(), 3);
    assert_eq!(report.financial_projection, "LEGACY_UNRESOLVED");
    assert!(!report.ready_to_start);
    assert!(report.obligations.is_empty());
    assert!(report.effects.is_empty());
    assert!(report.payments.is_empty());
    assert!(
        report
            .recognized_legacy_proofs
            .iter()
            .any(|proof| proof.action_kind == "PAYMENT_RECEIPT"
                && proof.authorizers.contains(&Role::Operator))
    );
    assert!(!report.transcript.retained_events.is_empty());
    assert!(
        report
            .diagnostics
            .iter()
            .any(|item| item.code == "LEGACY_UNRESOLVED")
    );
    assert_eq!(encoding::canonical(&bundle).unwrap(), before);
    assert!(
        report
            .recognized_legacy_proofs
            .iter()
            .all(|proof| proof.proposal.allocations.is_empty() && proof.proposal.cutover.is_none())
    );
}

#[test]
fn appended_invalid_authorizations_do_not_hide_the_original_receipt() {
    let (mut bundle, trust) = original();
    let expected = legacy::inspect(&bundle, &trust)
        .unwrap()
        .recognized_legacy_proofs
        .len();
    let mut corrupt = bundle.actions[0].authorizations[0].clone();
    corrupt.signature = "invalid".into();
    bundle.actions[0].authorizations.insert(0, corrupt);
    let report = legacy::inspect(&bundle, &trust).unwrap();
    assert_eq!(report.recognized_legacy_proofs.len(), expected);
    assert_eq!(report.financial_projection, "LEGACY_UNRESOLVED");
    assert!(!report.diagnostics.is_empty());
}

#[test]
fn v1_signature_cannot_authorize_v2_context_and_unknown_versions_fail_closed() {
    let (bundle, trust) = original();
    let signature = &bundle.agreement.signatures[0];
    let binding = trust
        .parties
        .iter()
        .find(|party| party.role.code() == signature.claims.role)
        .unwrap();
    let mut expected = signature.claims.clone();
    expected.protocol_version = "2".into();
    assert!(crypto::verify(signature, &expected, &binding.key).is_err());
    expected.protocol_version = "3".into();
    assert!(expected.validate().is_err());
    assert_eq!(
        contract::claims(
            "nonverba.test",
            "assignment",
            &"00".repeat(32),
            binding,
            "AGREEMENT"
        )
        .protocol_version,
        "2"
    );
    assert!(
        contract::validate_contract(&bundle.agreement.agreement, &bundle.requests, &trust).is_err()
    );
}

#[test]
fn legacy_inspection_requires_original_independent_domain_and_key_bindings() {
    let (bundle, mut trust) = original();
    trust.deployment_domain = "another.deployment".into();
    assert!(legacy::inspect(&bundle, &trust).is_err());
    trust.deployment_domain = bundle.deployment_domain.clone();
    trust.parties[0].party_id = "another-party".into();
    let report = legacy::inspect(&bundle, &trust).unwrap();
    assert!(!report.agreement.bound);
    assert!(report.recognized_legacy_proofs.is_empty());
    assert!(report.obligations.is_empty());
    assert_eq!(report.financial_projection, "LEGACY_UNRESOLVED");
}

#[test]
fn legacy_dispatch_retains_original_records_instead_of_reinterpreting_them() {
    let (bundle, trust) = original();
    let report = nonverba_requests::bundle::verify_assignment_bundle(&bundle, &trust).unwrap();
    assert_eq!(report.financial_projection, "LEGACY_UNRESOLVED");
    assert!(report.agreement.bound);
    assert!(!report.recognized_legacy_proofs.is_empty());
    assert!(!report.ready_to_start);
}
