// SPDX-License-Identifier: AGPL-3.0-only
#[path = "../../requests/tests/common/mod.rs"]
mod common;

use nonverba_disputes::{
    binding::*,
    consent::{self, ConsentReviewV1},
    runtime,
};
use nonverba_requests::{bundle, contract, crypto, encoding, local, model::*};
use p256::ecdsa::SigningKey;
use std::{
    cell::Cell,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
use zeroize::Zeroizing;

fn allocations(values: [u16; 5]) -> Vec<Allocation> {
    priors_catalog()
        .dimensions
        .into_iter()
        .zip(values)
        .map(|(d, points)| Allocation {
            dimension_id: d.id,
            points,
        })
        .collect()
}

fn profiles(
    base: &AssignmentBundle,
    trust: &TrustConfiguration,
    keys: &[SigningKey; 3],
) -> (SignedDeclaredPriorsV1, SignedDeclaredPriorsV1) {
    let r = draft_declared_priors(
        ProfileProvenance::Request {
            signed_request: base.requests[0].clone(),
        },
        allocations([80, 30, 40, 70, 30]),
        trust,
    )
    .unwrap();
    let o = draft_declared_priors(
        ProfileProvenance::Quote {
            signed_request: base.requests[0].clone(),
            signed_quote: base.agreement.agreement.quote.clone(),
        },
        allocations([50, 70, 60, 40, 30]),
        trust,
    )
    .unwrap();
    (
        SignedDeclaredPriorsV1 {
            authorization: crypto::sign(&declared_priors_claims(&r, trust).unwrap(), &keys[0])
                .unwrap(),
            profile: r,
        },
        SignedDeclaredPriorsV1 {
            authorization: crypto::sign(&declared_priors_claims(&o, trust).unwrap(), &keys[1])
                .unwrap(),
            profile: o,
        },
    )
}

fn annex(
    base: &AssignmentBundle,
    trust: &TrustConfiguration,
    keys: &[SigningKey; 3],
) -> SignedDisputeContextV1 {
    let (r, o) = profiles(base, trust, keys);
    let spec = runtime::development_spec(
        priors_catalog_digest().unwrap(),
        encoding::digest(&r.profile).unwrap(),
        encoding::digest(&o.profile).unwrap(),
    );
    let context = draft_context(
        base,
        &encoding::digest(&base.agreement.agreement).unwrap(),
        r,
        o,
        serde_json::to_value(spec).unwrap(),
        trust,
    )
    .unwrap();
    let endorsements = [Role::Requester, Role::Operator, Role::Mediator]
        .into_iter()
        .enumerate()
        .map(|(i, role)| {
            crypto::sign(
                &context_claims(&context, base, trust, role).unwrap(),
                &keys[i],
            )
            .unwrap()
        })
        .collect();
    SignedDisputeContextV1 {
        context,
        endorsements,
    }
}

#[test]
fn exact_dictionary_and_individual_budget_accept_only_the_five_integer_dimensions() {
    for values in [
        [50, 50, 50, 50, 50],
        [80, 30, 40, 70, 30],
        [50, 70, 60, 40, 30],
        [100, 100, 50, 0, 0],
    ] {
        validate_allocations(&allocations(values), &priors_catalog()).unwrap();
    }
    for values in [
        [49, 50, 50, 50, 50],
        [51, 50, 50, 50, 50],
        [101, 49, 50, 50, 0],
    ] {
        assert!(validate_allocations(&allocations(values), &priors_catalog()).is_err());
    }
    let mut duplicate = balanced_allocations();
    duplicate[1].dimension_id = "result".into();
    assert!(validate_allocations(&duplicate, &priors_catalog()).is_err());
    let mut unknown = balanced_allocations();
    unknown[0].dimension_id = "honesty".into();
    assert!(validate_allocations(&unknown, &priors_catalog()).is_err());
    assert!(validate_allocations(&balanced_allocations()[..4], &priors_catalog()).is_err());
    let mut extra = balanced_allocations();
    extra.push(Allocation {
        dimension_id: "trustworthiness".into(),
        points: 0,
    });
    assert!(validate_allocations(&extra, &priors_catalog()).is_err());
    let mut altered = priors_catalog();
    altered.dimensions[0].boundary = "100 percent of payment".into();
    assert!(validate_priors_catalog(&altered).is_err());
    for points in ["-1", "50.5", "\"50\""] {
        let json = format!("{{\"dimension_id\":\"result\",\"points\":{points}}}");
        assert!(encoding::strict_parse::<Allocation>(json.as_bytes()).is_err());
    }
    assert!(
        encoding::strict_parse::<Allocation>(
            br#"{"dimension_id":"result","points":50,"points":50}"#
        )
        .is_err()
    );
    let mut fake_n = serde_json::to_value(priors_catalog()).unwrap();
    fake_n["N"] = 100.into();
    assert!(
        encoding::strict_parse::<PriorsCatalogV1>(&encoding::canonical(&fake_n).unwrap()).is_err()
    );
}

#[test]
fn profile_authorship_pins_source_revision_owner_dictionary_and_exact_allocations() {
    let (base, trust, keys) = common::fixture();
    let (r, o) = profiles(&base, &trust, &keys);
    verify_declared_priors(&r, &trust).unwrap();
    verify_declared_priors(&o, &trust).unwrap();
    let original = encoding::digest(&r.profile).unwrap();
    let mut edited_defaults = balanced_allocations();
    edited_defaults[0].points = 0;
    assert_eq!(encoding::digest(&r.profile).unwrap(), original);
    let mut tampered = r.clone();
    tampered.profile.allocations = balanced_allocations();
    assert!(verify_declared_priors(&tampered, &trust).is_err());
    let mut tampered = r.clone();
    tampered.profile.dictionary_hash = "0".repeat(64);
    assert!(verify_declared_priors(&tampered, &trust).is_err());
    let mut tampered = r.clone();
    tampered.authorization = crypto::sign(
        &declared_priors_claims(&r.profile, &trust).unwrap(),
        &keys[1],
    )
    .unwrap();
    assert!(verify_declared_priors(&tampered, &trust).is_err());
    let mut wrong_role = r.profile.clone();
    wrong_role.author = trust.parties[2].clone();
    assert!(validate_declared_priors(&wrong_role, &trust).is_err());
    let mut changed_source = r.profile.clone();
    if let ProfileProvenance::Request { signed_request } = &mut changed_source.provenance {
        signed_request.request.revision = "2".into();
    }
    assert!(validate_declared_priors(&changed_source, &trust).is_err());
    let json = serde_json::to_value(&r.profile).unwrap();
    assert_eq!(
        serde_json::to_value(&r.profile).unwrap(),
        json,
        "validation must not rebalance signed allocations"
    );
}

#[test]
fn three_annex_endorsements_are_separate_from_already_complete_base_formation() {
    let (base, trust, keys) = common::fixture();
    let before =
        encoding::digest(&bundle::verify_assignment_bundle(&base, &trust).unwrap()).unwrap();
    let complete = annex(&base, &trust, &keys);
    let absent = verify_context(None, &base, &trust).unwrap();
    assert!(absent.base_agreement_bound);
    assert_eq!(absent.extension_status, "NOT_SPECIFIED");
    assert!(!absent.extended_setup_complete);
    assert!(absent.context_hash.is_none());
    for excluded in 0..3 {
        let mut partial = complete.clone();
        partial.endorsements.remove(excluded);
        let report = verify_context(Some(&partial), &base, &trust).unwrap();
        assert!(report.base_agreement_bound);
        assert_eq!(report.extension_status, "INCOMPLETE");
        assert!(!report.extended_setup_complete);
        assert_eq!(report.valid_signers.len(), 2);
    }
    assert!(
        verify_context(Some(&complete), &base, &trust)
            .unwrap()
            .extended_setup_complete
    );
    let mut unsupported = complete.clone();
    unsupported.context.extension_version = "99".into();
    let report = verify_context(Some(&unsupported), &base, &trust).unwrap();
    assert!(report.base_agreement_bound);
    assert_eq!(report.extension_status, "UNSUPPORTED");
    let after =
        encoding::digest(&bundle::verify_assignment_bundle(&base, &trust).unwrap()).unwrap();
    assert_eq!(before, after);
}

#[test]
fn annex_rejects_tampered_profile_spec_dictionary_and_wrong_agreement_without_poisoning_base() {
    let (base, trust, keys) = common::fixture();
    let complete = annex(&base, &trust, &keys);
    for selector in 0..5 {
        let mut changed = complete.clone();
        match selector {
            0 => changed.context.requester_profile.profile.allocations = balanced_allocations(),
            1 => {
                changed.context.analysis_specification["dictionary_hash"] =
                    serde_json::Value::String("0".repeat(64))
            }
            2 => changed.context.dictionary.dimensions[0].label = "Guaranteed outcome".into(),
            3 => changed.context.agreement_hash = "0".repeat(64),
            _ => changed.context.assignment_id = "different-assignment".into(),
        }
        let result = verify_context(Some(&changed), &base, &trust).unwrap();
        assert!(result.base_agreement_bound);
        assert!(!result.extended_setup_complete);
        assert_eq!(result.extension_status, "INVALID");
        assert!(merge_context_endorsements(&complete, &changed).is_err());
    }
    let mut wrong_key = complete.clone();
    wrong_key.endorsements[0] = crypto::sign(
        &context_claims(&complete.context, &base, &trust, Role::Requester).unwrap(),
        &keys[1],
    )
    .unwrap();
    assert!(
        !verify_context(Some(&wrong_key), &base, &trust)
            .unwrap()
            .extended_setup_complete
    );
    let mut unsigned_financial = serde_json::to_value(&complete).unwrap();
    unsigned_financial["context"]["authority_mode"] = "AWARD_PAYMENT".into();
    assert!(
        encoding::strict_parse::<SignedDisputeContextV1>(
            &encoding::canonical(&unsigned_financial).unwrap()
        )
        .is_err()
    );
}

#[test]
fn legacy_missing_profiles_remain_not_specified_and_cannot_receive_a_new_annex() {
    let base: AssignmentBundle = encoding::strict_parse(include_bytes!(
        "../../requests/tests/fixtures/legacy-v1/bundle.json"
    ))
    .unwrap();
    let trust: TrustConfiguration = encoding::strict_parse(include_bytes!(
        "../../requests/tests/fixtures/legacy-v1/trust.json"
    ))
    .unwrap();
    let report = verify_context(None, &base, &trust).unwrap();
    assert_eq!(report.extension_status, "NOT_SPECIFIED");
    assert!(!report.extended_setup_complete);
    let (current, current_trust, keys) = common::fixture();
    let attempted = annex(&current, &current_trust, &keys);
    let report = verify_context(Some(&attempted), &base, &trust).unwrap();
    assert_eq!(report.extension_status, "UNSUPPORTED");
    assert_eq!(
        bundle::verify_assignment_bundle(&base, &trust)
            .unwrap()
            .financial_projection,
        "LEGACY_UNRESOLVED"
    );
}

static NEXT: AtomicU64 = AtomicU64::new(0);
fn temp() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "nonverba-dispute-binding-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&path).unwrap();
    path
}
const PASSWORD: &[u8] = b"synthetic-binding-test-password";

fn private_vault_fixture() -> (
    PathBuf,
    AssignmentBundle,
    TrustConfiguration,
    [SigningKey; 3],
) {
    let path = temp().join("requester-vault.json");
    let (mut base, mut trust, mut keys) = common::fixture();
    trust.parties[0].key =
        local::create_vault(&path, "R", "independent-requester-test-key", PASSWORD).unwrap();
    keys[0] = local::unlock_vault(&path, PASSWORD).unwrap().0;
    base.requests[0].request.requester = trust.parties[0].clone();
    let request = &base.requests[0].request;
    base.requests[0].authorization = crypto::sign(
        &contract::claims(
            &request.deployment_domain,
            &request.request_id,
            &encoding::digest(request).unwrap(),
            &request.requester,
            "REQUEST",
        ),
        &keys[0],
    )
    .unwrap();
    let a = &mut base.agreement.agreement;
    a.parties = trust.parties.clone();
    a.request_hash = encoding::digest(&base.requests[0].request).unwrap();
    a.quote.quote.request_hash = a.request_hash.clone();
    common::sign_quote(&mut base, &keys);
    common::sign_root(&mut base, &keys);
    (path, base, trust, keys)
}

#[test]
fn cancellation_stale_review_and_context_tampering_do_not_request_password_or_touch_vault() {
    let (base, trust, keys) = common::fixture();
    let (profile, _) = profiles(&base, &trust, &keys);
    let review = ConsentReviewV1::profile(profile.profile, &trust).unwrap();
    let path = temp().join("must-not-open-or-create.json");
    let called = Cell::new(false);
    assert!(
        consent::authorize(&review, None, &trust, &path, || {
            called.set(true);
            Ok(Zeroizing::new(PASSWORD.to_vec()))
        })
        .unwrap_err()
        .starts_with("CONSENT_CANCELLED")
    );
    assert!(!called.get());
    assert!(!path.exists());
    let approved = review.review_digest().unwrap();
    let mut stale = review.clone();
    stale.exact_content["allocations"][0]["points"] = 79.into();
    assert!(
        consent::authorize(&stale, Some(&approved), &trust, &path, || {
            called.set(true);
            Ok(Zeroizing::new(PASSWORD.to_vec()))
        })
        .is_err()
    );
    assert!(!called.get());
    let mut altered_trust = trust.clone();
    altered_trust.parties[0].party_id = "another-principal".into();
    assert!(
        consent::authorize(&review, Some(&approved), &altered_trust, &path, || {
            called.set(true);
            Ok(Zeroizing::new(PASSWORD.to_vec()))
        })
        .is_err()
    );
    assert!(!called.get());
    assert!(!local::guard_directory(&path).unwrap().exists());
}

#[test]
fn local_signing_guards_profiles_and_exact_agreement_context_against_retroactive_replacement() {
    let (vault, base, trust, keys) = private_vault_fixture();
    let (profile, _) = profiles(&base, &trust, &keys);
    let review = ConsentReviewV1::profile(profile.profile.clone(), &trust).unwrap();
    let signature = consent::authorize(
        &review,
        Some(&review.review_digest().unwrap()),
        &trust,
        &vault,
        || Ok(Zeroizing::new(PASSWORD.to_vec())),
    )
    .unwrap();
    verify_declared_priors(
        &SignedDeclaredPriorsV1 {
            profile: profile.profile.clone(),
            authorization: signature,
        },
        &trust,
    )
    .unwrap();
    let mut replaced = profile.profile;
    replaced.allocations = balanced_allocations();
    let changed_review = ConsentReviewV1::profile(replaced, &trust).unwrap();
    assert!(
        consent::authorize(
            &changed_review,
            Some(&changed_review.review_digest().unwrap()),
            &trust,
            &vault,
            || Ok(Zeroizing::new(PASSWORD.to_vec()))
        )
        .unwrap_err()
        .starts_with("SIGNER_CONFLICT")
    );
    let complete = annex(&base, &trust, &keys);
    let context_review = ConsentReviewV1::context(complete.context.clone(), &base, &trust).unwrap();
    consent::authorize(
        &context_review,
        Some(&context_review.review_digest().unwrap()),
        &trust,
        &vault,
        || Ok(Zeroizing::new(PASSWORD.to_vec())),
    )
    .unwrap();
    let mut replaced = complete.context.clone();
    replaced.requester_profile.profile.allocations = balanced_allocations();
    replaced.requester_profile.authorization = crypto::sign(
        &declared_priors_claims(&replaced.requester_profile.profile, &trust).unwrap(),
        &keys[0],
    )
    .unwrap();
    replaced.analysis_specification["requester_profile_hash"] =
        encoding::digest(&replaced.requester_profile.profile)
            .unwrap()
            .into();
    replaced.analysis_specification_hash =
        encoding::digest(&replaced.analysis_specification).unwrap();
    let changed_review = ConsentReviewV1::context(replaced, &base, &trust).unwrap();
    assert!(
        consent::authorize(
            &changed_review,
            Some(&changed_review.review_digest().unwrap()),
            &trust,
            &vault,
            || Ok(Zeroizing::new(PASSWORD.to_vec()))
        )
        .unwrap_err()
        .starts_with("SIGNER_CONFLICT")
    );
}

#[test]
fn attributed_records_are_exact_scope_and_purpose_bound_and_cannot_be_financial_actions() {
    let (base, trust, keys) = common::fixture();
    let complete = annex(&base, &trust, &keys);
    let scope = AttributionScopeV1 {
        agreement_hash: complete.context.agreement_hash.clone(),
        context_hash: encoding::digest(&complete.context).unwrap(),
        record_id: "submission-1".into(),
        kind: SubmissionKind::EvidenceSubmission,
        author_role: Role::Operator,
    };
    let payload = nonverba_disputes::case::EvidenceSubmissionBodyV1 {
        version: "1".into(),
        case_id: "case-1".into(),
        submission_id: scope.record_id.clone(),
        author_role: scope.author_role,
        agreement_hash: scope.agreement_hash.clone(),
        context_hash: scope.context_hash.clone(),
        content_sha256: encoding::bytes_digest(b"authored evidence"),
        byte_length: 17,
        media_type: "text/plain".into(),
        statement_kind: nonverba_disputes::case::StatementKindV1::Claim,
        party_offer: None,
    };
    let signature = crypto::sign(
        &attributed_claims(&payload, &scope, &base, &trust).unwrap(),
        &keys[1],
    )
    .unwrap();
    verify_attributed(&payload, &signature, &scope, &base, &trust).unwrap();
    let mut changed = scope.clone();
    changed.kind = SubmissionKind::AnalysisChallenge;
    assert!(verify_attributed(&payload, &signature, &changed, &base, &trust).is_err());
    changed = scope.clone();
    changed.context_hash = "0".repeat(64);
    assert!(verify_attributed(&payload, &signature, &changed, &base, &trust).is_err());
    changed = scope.clone();
    changed.author_role = Role::Requester;
    assert!(verify_attributed(&payload, &signature, &changed, &base, &trust).is_err());
    let review = ConsentReviewV1::submission(&payload, &scope, &base, &complete, &trust).unwrap();
    assert_eq!(review.content_hash, signature.claims.content_hash);
    // Recomputing all public hashes cannot turn a differently attributed typed
    // body into valid consent. Check this before touching a nonexistent vault.
    let mut relabelled = review.clone();
    relabelled.exact_content["payload"]["author_role"] = "R".into();
    relabelled.content_hash = encoding::digest(&relabelled.exact_content).unwrap();
    let called = Cell::new(false);
    assert!(
        consent::authorize(
            &relabelled,
            Some(&relabelled.review_digest().unwrap()),
            &trust,
            &temp().join("absent.json"),
            || {
                called.set(true);
                Ok(Zeroizing::new(PASSWORD.to_vec()))
            }
        )
        .is_err()
    );
    assert!(!called.get());
    let mut mismatched = payload.clone();
    mismatched.author_role = Role::Requester;
    assert!(ConsentReviewV1::submission(&mismatched, &scope, &base, &complete, &trust).is_err());
    let arbitrary = serde_json::json!({"execute_payment":true});
    assert!(ConsentReviewV1::submission(&arbitrary, &scope, &base, &complete, &trust).is_err());
    let mut partial = complete;
    partial.endorsements.pop();
    assert!(ConsentReviewV1::submission(&payload, &scope, &base, &partial, &trust).is_err());
    let mut finance_claims = signature.claims.clone();
    finance_claims.purpose = "ACTION".into();
    assert!(crypto::verify(&signature, &finance_claims, &trust.parties[1].key).is_err());
}

#[test]
fn point_review_orders_each_exact_profile_without_rewriting_signed_allocation_order() {
    let (base, trust, keys) = common::fixture();
    let mut complete = annex(&base, &trust, &keys);
    complete
        .context
        .requester_profile
        .profile
        .allocations
        .reverse();
    complete.context.requester_profile.authorization = crypto::sign(
        &declared_priors_claims(&complete.context.requester_profile.profile, &trust).unwrap(),
        &keys[0],
    )
    .unwrap();
    complete.context.analysis_specification["requester_profile_hash"] =
        encoding::digest(&complete.context.requester_profile.profile)
            .unwrap()
            .into();
    complete.context.analysis_specification_hash =
        encoding::digest(&complete.context.analysis_specification).unwrap();
    let before = encoding::canonical(&complete.context).unwrap();
    let review = ConsentReviewV1::context(complete.context, &base, &trust).unwrap();
    let display = review.render().unwrap();
    let expected = "Prior | R points | O points\nResult | 80 | 50\nEffort | 30 | 70\nReliance | 40 | 60\nResponsibility | 70 | 40\nRemedy | 30 | 30";
    assert!(display.contains(expected));
    assert_eq!(encoding::canonical(&review.exact_content).unwrap(), before);
    assert!(display.contains("Does not reward invented hours"));
}
