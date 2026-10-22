// SPDX-License-Identifier: AGPL-3.0-only
//! Transport-free recovery checks. No service credentials, routes or private schemas.

use nonverba_requests::{
    client_operation::{
        MAX_OPERATION_BODY_BYTES, Observation, OperationBinding, OperationContext, OperationState,
        PreparedOperation, RecoveryAdvice, ServiceOutcome, TrackedOperation, bytes_digest,
        verify_exact_bytes,
    },
    encoding,
};
use serde_json::json;
use std::collections::BTreeMap;

fn context() -> OperationContext {
    OperationContext::new("synthetic-operator", "synthetic-key-1").unwrap()
}

fn identities() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("original".into(), bytes_digest(b"original exact bytes")),
        ("event".into(), bytes_digest(b"signed event exact bytes")),
    ])
}

fn binding() -> OperationBinding {
    OperationBinding::new(
        context(),
        "local-operation-1",
        "synthetic-assignment-1",
        "evidence",
        identities(),
    )
    .unwrap()
}

fn tracked() -> TrackedOperation {
    TrackedOperation::new(
        PreparedOperation::new(binding(), b"exact opaque signed bytes".to_vec()).unwrap(),
    )
}

fn dispatched() -> TrackedOperation {
    let mut operation = tracked();
    operation.begin_dispatch(&context()).unwrap();
    operation
}

fn receipt(binding: OperationBinding, outcome: ServiceOutcome) -> Observation {
    Observation::Receipt { binding, outcome }
}

#[test]
fn preparation_retains_whitespace_and_unicode_without_normalization() {
    let exact = " {\n \"text\": \"e\u{301} / é / 🌱\"\n}\r\n"
        .as_bytes()
        .to_vec();
    let expected = exact.clone();
    let prepared = PreparedOperation::new(binding(), exact).unwrap();
    assert_eq!(prepared.body(), expected);
    assert_eq!(prepared.body_sha256(), bytes_digest(&expected));

    let normalized = " {\n \"text\": \"é / é / 🌱\"\n}\r\n";
    assert_ne!(prepared.body_sha256(), bytes_digest(normalized.as_bytes()));
    let parsed: serde_json::Value = serde_json::from_slice(&expected).unwrap();
    assert_ne!(prepared.body_sha256(), encoding::digest(&parsed).unwrap());
}

#[test]
fn dispatch_exposes_the_retained_bytes_and_leaves_the_operation_unconfirmed() {
    let mut operation = tracked();
    let original_digest = operation.prepared().body_sha256().to_owned();
    assert_eq!(operation.state(), OperationState::Ready);
    assert_eq!(operation.recovery_advice(), RecoveryAdvice::ReadyDispatch);
    {
        let dispatch = operation.begin_dispatch(&context()).unwrap();
        assert_eq!(dispatch.operation_id, "local-operation-1");
        assert_eq!(dispatch.body, b"exact opaque signed bytes");
        assert_eq!(dispatch.body_sha256, original_digest);
        assert_eq!(dispatch.binding, &binding());
    }
    assert_eq!(operation.state(), OperationState::Unconfirmed);
    assert_eq!(operation.recovery_advice(), RecoveryAdvice::Lookup);
    assert!(operation.begin_dispatch(&context()).is_err());
    assert_eq!(operation.state(), OperationState::Unconfirmed);
}

#[test]
fn a_different_principal_or_key_cannot_dispatch_or_reconcile() {
    for other in [
        OperationContext::new("another-principal", "synthetic-key-1").unwrap(),
        OperationContext::new("synthetic-operator", "another-key").unwrap(),
    ] {
        let mut operation = tracked();
        assert!(operation.begin_dispatch(&other).is_err());
        assert_eq!(operation.state(), OperationState::Ready);
        operation.begin_dispatch(&context()).unwrap();
        for observation in [
            Observation::Lost,
            Observation::ProviderConflict,
            receipt(binding(), ServiceOutcome::Accepted),
        ] {
            assert!(operation.observe(&other, observation).is_err());
            assert_eq!(operation.state(), OperationState::Unconfirmed);
            assert_eq!(operation.prepared().binding(), &binding());
        }
    }
}

#[test]
fn no_observation_can_accept_or_cancel_an_operation_before_dispatch() {
    for observation in [
        Observation::Lost,
        Observation::Unavailable,
        Observation::NotFound,
        Observation::ProviderConflict,
        receipt(binding(), ServiceOutcome::Pending),
        receipt(binding(), ServiceOutcome::Accepted),
    ] {
        let mut operation = tracked();
        assert!(operation.observe(&context(), observation).is_err());
        assert_eq!(operation.state(), OperationState::Ready);
        assert_eq!(operation.recovery_advice(), RecoveryAdvice::ReadyDispatch);
        assert_eq!(operation.prepared().body(), b"exact opaque signed bytes");
    }
}

#[test]
fn lost_unavailable_and_not_found_require_lookup_without_rearming_dispatch() {
    let mut operation = dispatched();
    for observation in [
        Observation::Lost,
        Observation::Unavailable,
        Observation::NotFound,
        Observation::Lost,
    ] {
        assert_eq!(
            operation.observe(&context(), observation).unwrap(),
            OperationState::Unconfirmed
        );
        assert_eq!(operation.recovery_advice(), RecoveryAdvice::Lookup);
        assert!(operation.begin_dispatch(&context()).is_err());
        assert_eq!(operation.prepared().body(), b"exact opaque signed bytes");
    }
}

#[test]
fn a_matching_pending_receipt_is_neither_acceptance_nor_permission_to_resubmit() {
    let mut operation = dispatched();
    assert_eq!(
        operation
            .observe(&context(), receipt(binding(), ServiceOutcome::Pending))
            .unwrap(),
        OperationState::Pending
    );
    assert_eq!(operation.recovery_advice(), RecoveryAdvice::Lookup);
    assert!(operation.begin_dispatch(&context()).is_err());
    for observation in [
        Observation::Lost,
        Observation::Unavailable,
        Observation::NotFound,
    ] {
        assert_eq!(
            operation.observe(&context(), observation).unwrap(),
            OperationState::Pending
        );
    }
}

#[test]
fn matching_acceptance_is_idempotent_and_stale_pending_does_not_regress_it() {
    let mut operation = dispatched();
    for outcome in [
        ServiceOutcome::Accepted,
        ServiceOutcome::Accepted,
        ServiceOutcome::Pending,
        ServiceOutcome::Accepted,
    ] {
        assert_eq!(
            operation
                .observe(&context(), receipt(binding(), outcome))
                .unwrap(),
            OperationState::ServiceAccepted
        );
        assert_eq!(
            operation.recovery_advice(),
            RecoveryAdvice::AcceptedVerifyOriginals
        );
    }
    for observation in [
        Observation::Lost,
        Observation::Unavailable,
        Observation::NotFound,
    ] {
        assert_eq!(
            operation.observe(&context(), observation).unwrap(),
            OperationState::ServiceAccepted
        );
    }
    assert!(operation.begin_dispatch(&context()).is_err());
}

#[test]
fn a_pending_operation_can_become_service_accepted_without_new_bytes() {
    let mut operation = dispatched();
    let retained_digest = operation.prepared().body_sha256().to_owned();
    operation
        .observe(&context(), receipt(binding(), ServiceOutcome::Pending))
        .unwrap();
    assert_eq!(
        operation
            .observe(&context(), receipt(binding(), ServiceOutcome::Accepted))
            .unwrap(),
        OperationState::ServiceAccepted
    );
    assert_eq!(operation.prepared().body_sha256(), retained_digest);
    assert_eq!(operation.prepared().body(), b"exact opaque signed bytes");
}

#[test]
fn provider_conflict_remains_visible_until_separate_review() {
    let mut operation = dispatched();
    assert_eq!(
        operation
            .observe(&context(), Observation::ProviderConflict)
            .unwrap(),
        OperationState::Conflict
    );
    for observation in [
        Observation::ProviderConflict,
        Observation::Lost,
        Observation::Unavailable,
        Observation::NotFound,
        receipt(binding(), ServiceOutcome::Pending),
        receipt(binding(), ServiceOutcome::Accepted),
    ] {
        assert_eq!(
            operation.observe(&context(), observation).unwrap(),
            OperationState::Conflict
        );
        assert_eq!(operation.recovery_advice(), RecoveryAdvice::ConflictReview);
    }
    assert!(operation.begin_dispatch(&context()).is_err());
}

#[test]
fn a_conflicting_observation_does_not_erase_previously_matched_service_acceptance() {
    let mut operation = dispatched();
    assert!(!operation.service_acceptance_observed());
    operation
        .observe(&context(), receipt(binding(), ServiceOutcome::Accepted))
        .unwrap();
    assert!(operation.service_acceptance_observed());
    assert_eq!(
        operation
            .observe(&context(), Observation::ProviderConflict)
            .unwrap(),
        OperationState::Conflict
    );
    assert!(operation.service_acceptance_observed());
    operation
        .observe(&context(), receipt(binding(), ServiceOutcome::Pending))
        .unwrap();
    assert_eq!(operation.state(), OperationState::Conflict);
    assert!(operation.service_acceptance_observed());
    assert_eq!(operation.recovery_advice(), RecoveryAdvice::ConflictReview);
}

#[test]
fn matched_acceptance_after_conflict_is_retained_without_hiding_the_conflict() {
    let mut operation = dispatched();
    operation
        .observe(&context(), Observation::ProviderConflict)
        .unwrap();
    assert!(!operation.service_acceptance_observed());
    let unrelated = OperationBinding::new(
        context(),
        "unrelated-operation",
        "synthetic-assignment-1",
        "evidence",
        identities(),
    )
    .unwrap();
    assert!(
        operation
            .observe(&context(), receipt(unrelated, ServiceOutcome::Accepted))
            .is_err()
    );
    assert!(!operation.service_acceptance_observed());
    assert_eq!(
        operation
            .observe(&context(), receipt(binding(), ServiceOutcome::Accepted))
            .unwrap(),
        OperationState::Conflict
    );
    assert!(operation.service_acceptance_observed());
    assert_eq!(operation.recovery_advice(), RecoveryAdvice::ConflictReview);
    assert!(operation.begin_dispatch(&context()).is_err());
}

#[test]
fn receipt_context_operation_assignment_kind_and_all_digests_must_match() {
    let mut replacements = vec![
        OperationBinding::new(
            OperationContext::new("other-principal", "synthetic-key-1").unwrap(),
            "local-operation-1",
            "synthetic-assignment-1",
            "evidence",
            identities(),
        )
        .unwrap(),
        OperationBinding::new(
            OperationContext::new("synthetic-operator", "other-key").unwrap(),
            "local-operation-1",
            "synthetic-assignment-1",
            "evidence",
            identities(),
        )
        .unwrap(),
        OperationBinding::new(
            context(),
            "another-valid-operation",
            "synthetic-assignment-1",
            "evidence",
            identities(),
        )
        .unwrap(),
        OperationBinding::new(
            context(),
            "local-operation-1",
            "another-assignment",
            "evidence",
            identities(),
        )
        .unwrap(),
        OperationBinding::new(
            context(),
            "local-operation-1",
            "synthetic-assignment-1",
            "original",
            identities(),
        )
        .unwrap(),
    ];
    let mut changed_event = identities();
    changed_event.insert("event".into(), bytes_digest(b"substituted signed event"));
    let mut changed_original = identities();
    changed_original.insert("original".into(), bytes_digest(b"substituted original"));
    let mut removed = identities();
    removed.remove("original");
    let mut extra = identities();
    extra.insert("unreviewed-artifact".into(), bytes_digest(b"extra bytes"));
    let mut renamed = identities();
    let event = renamed.remove("event").unwrap();
    renamed.insert("different-label".into(), event);
    for digests in [changed_event, changed_original, removed, extra, renamed] {
        replacements.push(
            OperationBinding::new(
                context(),
                "local-operation-1",
                "synthetic-assignment-1",
                "evidence",
                digests,
            )
            .unwrap(),
        );
    }

    for replacement in replacements {
        for outcome in [ServiceOutcome::Pending, ServiceOutcome::Accepted] {
            let mut operation = dispatched();
            operation
                .observe(&context(), receipt(binding(), ServiceOutcome::Pending))
                .unwrap();
            assert!(
                operation
                    .observe(&context(), receipt(replacement.clone(), outcome))
                    .is_err()
            );
            assert_eq!(operation.state(), OperationState::Pending);
            assert_eq!(operation.recovery_advice(), RecoveryAdvice::Lookup);
            assert_eq!(operation.prepared().binding(), &binding());
            assert_eq!(operation.prepared().body(), b"exact opaque signed bytes");
        }
    }
}

#[test]
fn even_a_conflicted_operation_rejects_an_unrelated_receipt() {
    let mut operation = dispatched();
    operation
        .observe(&context(), Observation::ProviderConflict)
        .unwrap();
    let unrelated = OperationBinding::new(
        context(),
        "unrelated-operation",
        "synthetic-assignment-1",
        "evidence",
        identities(),
    )
    .unwrap();
    assert!(
        operation
            .observe(&context(), receipt(unrelated, ServiceOutcome::Accepted))
            .is_err()
    );
    assert_eq!(operation.state(), OperationState::Conflict);
}

#[test]
fn identifiers_are_bounded_ascii_without_whitespace_paths_or_controls() {
    let overlong = "a".repeat(129);
    for invalid in [
        "",
        "with space",
        "with/slash",
        "with?query",
        "line\nfeed",
        "é",
        &overlong,
    ] {
        assert!(OperationContext::new(invalid, "key-1").is_err());
        assert!(OperationContext::new("principal-1", invalid).is_err());
        assert!(
            OperationBinding::new(context(), invalid, "assignment-1", "evidence", identities())
                .is_err()
        );
        assert!(
            OperationBinding::new(context(), "operation-1", invalid, "evidence", identities())
                .is_err()
        );
        assert!(
            OperationBinding::new(
                context(),
                "operation-1",
                "assignment-1",
                invalid,
                identities()
            )
            .is_err()
        );
        assert!(
            OperationBinding::new(
                context(),
                "operation-1",
                "assignment-1",
                "evidence",
                BTreeMap::from([(invalid.into(), bytes_digest(b"bytes"))]),
            )
            .is_err()
        );
    }
    let maximum = "a".repeat(128);
    assert!(OperationContext::new(&maximum, "key._:-0129").is_ok());
    assert!(
        OperationBinding::new(context(), &maximum, &maximum, "opaque.kind", identities()).is_ok()
    );
}

#[test]
fn content_identity_requires_a_nonempty_map_of_strict_lowercase_sha256_values() {
    assert!(
        OperationBinding::new(
            context(),
            "operation-1",
            "assignment-1",
            "evidence",
            BTreeMap::new()
        )
        .is_err()
    );
    for invalid in [
        "".to_owned(),
        "0".repeat(63),
        "0".repeat(65),
        "A".repeat(64),
        "g".repeat(64),
        format!("{} ", "0".repeat(63)),
    ] {
        assert!(
            OperationBinding::new(
                context(),
                "operation-1",
                "assignment-1",
                "evidence",
                BTreeMap::from([("original".into(), invalid)]),
            )
            .is_err()
        );
    }
    for valid in ["0".repeat(64), "f".repeat(64)] {
        assert!(
            OperationBinding::new(
                context(),
                "operation-1",
                "assignment-1",
                "evidence",
                BTreeMap::from([("original".into(), valid)]),
            )
            .is_ok()
        );
    }
}

#[test]
fn prepared_body_has_a_nonempty_four_mib_budget() {
    assert_eq!(MAX_OPERATION_BODY_BYTES, 4 * 1024 * 1024);
    assert!(PreparedOperation::new(binding(), Vec::new()).is_err());
    let maximum = vec![b'x'; MAX_OPERATION_BODY_BYTES];
    let expected_digest = bytes_digest(&maximum);
    let prepared = PreparedOperation::new(binding(), maximum).unwrap();
    assert_eq!(prepared.body().len(), MAX_OPERATION_BODY_BYTES);
    assert_eq!(prepared.body_sha256(), expected_digest);
    assert!(PreparedOperation::new(binding(), vec![b'x'; MAX_OPERATION_BODY_BYTES + 1]).is_err());
}

#[test]
fn exact_byte_verification_rejects_reserialization_and_content_substitution() {
    let original = b"{ \"count\": 1, \"text\": \"garden\" }\n";
    let expected = bytes_digest(original);
    assert!(verify_exact_bytes(&expected, original).is_ok());
    assert!(verify_exact_bytes(&expected, br#"{"count":1,"text":"garden"}"#).is_err());
    assert!(verify_exact_bytes(&expected, b"different original").is_err());
    assert!(verify_exact_bytes(&expected.to_uppercase(), original).is_err());
    assert!(verify_exact_bytes("not-a-digest", original).is_err());
}

#[test]
fn raw_signed_event_identity_is_distinct_from_its_protocol_envelope_digest() {
    let envelope = json!({"sequence":"0", "body":{"text":"synthetic preview"}});
    let protocol_digest = encoding::digest(&envelope).unwrap();
    let signed_record = serde_json::to_vec(&json!({
        "envelope": envelope,
        "signature": "deliberately-invalid-public-test-signature",
    }))
    .unwrap();
    let raw_digest = bytes_digest(&signed_record);
    assert_ne!(raw_digest, protocol_digest);
    assert!(verify_exact_bytes(&raw_digest, &signed_record).is_ok());
    assert!(verify_exact_bytes(&protocol_digest, &signed_record).is_err());
    // Matching opaque bytes says nothing about validity of this test signature.
    let malformed_protocol = b"not even a protocol JSON document";
    assert!(verify_exact_bytes(&bytes_digest(malformed_protocol), malformed_protocol).is_ok());
}
