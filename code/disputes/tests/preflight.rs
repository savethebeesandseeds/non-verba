// SPDX-License-Identifier: AGPL-3.0-only
#[path = "../../requests/tests/common/mod.rs"]
mod common;
use nonverba_disputes::{binding::*, consent::ConsentReviewV1, preflight::*, runtime};
use nonverba_requests::{bundle, contract, crypto, encoding, local, model::*};
use p256::ecdsa::SigningKey;
use std::{
    cell::Cell,
    fs,
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
};
use zeroize::Zeroizing;

fn review(
    base: &AssignmentBundle,
    trust: &TrustConfiguration,
    keys: &[SigningKey; 3],
) -> PreflightReviewV1 {
    let mut allocation = balanced_allocations();
    for (point, value) in allocation.iter_mut().zip([100, 100, 50, 0, 0]) {
        point.points = value;
    }
    let r = draft_declared_priors(
        ProfileProvenance::Request {
            signed_request: base.requests[0].clone(),
        },
        allocation,
        trust,
    )
    .unwrap();
    let o = draft_declared_priors(
        ProfileProvenance::Quote {
            signed_request: base.requests[0].clone(),
            signed_quote: base.agreement.agreement.quote.clone(),
        },
        balanced_allocations(),
        trust,
    )
    .unwrap();
    let r = SignedDeclaredPriorsV1 {
        authorization: crypto::sign(&declared_priors_claims(&r, trust).unwrap(), &keys[0]).unwrap(),
        profile: r,
    };
    let o = SignedDeclaredPriorsV1 {
        authorization: crypto::sign(&declared_priors_claims(&o, trust).unwrap(), &keys[1]).unwrap(),
        profile: o,
    };
    let spec = runtime::development_spec(
        priors_catalog_digest().unwrap(),
        encoding::digest(&r.profile).unwrap(),
        encoding::digest(&o.profile).unwrap(),
    );
    PreflightReviewV1::new(r, o, serde_json::to_value(spec).unwrap(), trust).unwrap()
}
fn annex(
    review: &PreflightReviewV1,
    base: &AssignmentBundle,
    trust: &TrustConfiguration,
    keys: &[SigningKey; 3],
) -> SignedDisputeContextV1 {
    let context = draft_context(
        base,
        &encoding::digest(&base.agreement.agreement).unwrap(),
        review.requester_profile.clone(),
        review.operator_profile.clone(),
        review.analysis_specification.clone(),
        trust,
    )
    .unwrap();
    let endorsements = [Role::Requester, Role::Operator, Role::Mediator]
        .into_iter()
        .enumerate()
        .map(|(i, r)| {
            crypto::sign(&context_claims(&context, base, trust, r).unwrap(), &keys[i]).unwrap()
        })
        .collect();
    SignedDisputeContextV1 {
        context,
        endorsements,
    }
}
fn decision(
    review: &PreflightReviewV1,
    trust: &TrustConfiguration,
    choice: Decision,
) -> LocalDecisionV1 {
    decide(
        review,
        trust,
        Role::Operator,
        choice,
        &review.digest().unwrap(),
    )
    .unwrap()
}
fn dir() -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let path = std::env::temp_dir().join(format!(
        "nv-preflight-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&path).unwrap();
    path
}
fn save<T: serde::Serialize>(path: PathBuf, value: &T) {
    local::write_immutable(&path, &encoding::canonical(value).unwrap()).unwrap();
}

#[test]
fn operator_can_decline_extreme_valid_profile_before_any_base_endorsement_in_actual_cli() {
    let (mut base, trust, keys) = common::fixture();
    base.agreement.signatures.clear();
    let review = review(&base, &trust, &keys);
    let root = dir();
    save(root.join("preflight.json"), &review);
    save(root.join("trust.json"), &trust);
    save(root.join("base.json"), &base);
    let mut command = Command::new(env!("CARGO_BIN_EXE_nonverba-disputes"))
        .current_dir(&root)
        .args([
            "preflight-decide",
            "preflight.json",
            "trust.json",
            "O",
            "decline",
            "decision.json",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    command
        .stdin
        .take()
        .unwrap()
        .write_all(format!("{}\n", review.digest().unwrap()).as_bytes())
        .unwrap();
    let output = command.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("Result | 100 | 50"));
    assert!(text.contains("Responsibility | 0 | 50"));
    assert!(text.contains("UNSIGNED_LOCAL_WORKFLOW_DECISION"));
    let rejected = Command::new(env!("CARGO_BIN_EXE_nonverba-disputes"))
        .current_dir(&root)
        .args([
            "preflight-base-review",
            "preflight.json",
            "decision.json",
            "base.json",
            "trust.json",
            "blocked.json",
        ])
        .output()
        .unwrap();
    assert!(!rejected.status.success());
    assert!(String::from_utf8_lossy(&rejected.stderr).contains("PREFLIGHT_DECLINED"));
    assert!(!root.join("blocked.json").exists());
    assert!(base.agreement.signatures.is_empty());
    let decline: LocalDecisionV1 = local::read_json(&root.join("decision.json")).unwrap();
    let forged = BaseSigningReviewV1 {
        format: "nv-dispute-preflight-v1".into(),
        agreement_hash: encoding::digest(&base.agreement.agreement).unwrap(),
        preflight: review,
        local_decision: decline,
        base,
    };
    let called = Cell::new(false);
    assert!(
        authorize_base(
            &forged,
            &encoding::digest(&forged).unwrap(),
            &trust,
            &root.join("absent-vault"),
            || {
                called.set(true);
                Ok(Zeroizing::new(b"not-used-password".to_vec()))
            }
        )
        .unwrap_err()
        .contains("PREFLIGHT_DECLINED")
    );
    assert!(!called.get());
    assert!(!root.join("absent-vault").exists());
}

#[test]
fn changed_profile_settings_sources_or_trust_require_new_review_and_exact_annex_match() {
    let (base, trust, keys) = common::fixture();
    let review = review(&base, &trust, &keys);
    let accepted = decision(&review, &trust, Decision::Accept);
    let complete = annex(&review, &base, &trust, &keys);
    let v2 = runtime::development_spec_v2(
        priors_catalog_digest().unwrap(),
        review.requester_profile_hash.clone(),
        review.operator_profile_hash.clone(),
    );
    let v2_review = PreflightReviewV1::new(
        review.requester_profile.clone(),
        review.operator_profile.clone(),
        serde_json::to_value(v2).unwrap(),
        &trust,
    )
    .unwrap();
    v2_review.validate(&trust).unwrap();
    assert!(
        check_candidate(&v2_review, &accepted, &base, &trust)
            .unwrap_err()
            .contains("PREFLIGHT_CHANGED")
    );
    assert!(
        complete_setup(&review, &accepted, &complete, &base, &trust)
            .unwrap()
            .extended_workflow_ready
    );
    let mut partial = complete.clone();
    partial.endorsements.pop();
    let report = complete_setup(&review, &accepted, &partial, &base, &trust).unwrap();
    assert!(report.base_agreement_bound);
    assert!(!report.extended_workflow_ready);
    let before =
        encoding::digest(&bundle::verify_assignment_bundle(&base, &trust).unwrap()).unwrap();
    for change in ["profile", "settings"] {
        let mut candidate = review.clone();
        if change == "profile" {
            candidate.requester_profile.profile.allocations = balanced_allocations();
            candidate.requester_profile.authorization = crypto::sign(
                &declared_priors_claims(&candidate.requester_profile.profile, &trust).unwrap(),
                &keys[0],
            )
            .unwrap();
            candidate.analysis_specification["requester_profile_hash"] =
                encoding::digest(&candidate.requester_profile.profile)
                    .unwrap()
                    .into();
        } else {
            candidate.analysis_specification["threads"] = 3.into();
        }
        let changed = PreflightReviewV1::new(
            candidate.requester_profile,
            candidate.operator_profile,
            candidate.analysis_specification,
            &trust,
        )
        .unwrap();
        assert!(
            check_candidate(&changed, &accepted, &base, &trust)
                .unwrap_err()
                .contains("PREFLIGHT_CHANGED")
        );
        let changed_annex = annex(&changed, &base, &trust, &keys);
        assert!(
            complete_setup(&review, &accepted, &changed_annex, &base, &trust)
                .unwrap_err()
                .contains("PREFLIGHT_SUBSTITUTION")
        );
        let context_review =
            ConsentReviewV1::context(changed_annex.context.clone(), &base, &trust).unwrap();
        let called = Cell::new(false);
        assert!(
            authorize_context(
                &review,
                &accepted,
                &context_review,
                &context_review.review_digest().unwrap(),
                &trust,
                &dir().join("absent"),
                || {
                    called.set(true);
                    Ok(Zeroizing::new(b"not-used-password".to_vec()))
                }
            )
            .is_err()
        );
        assert!(!called.get());
    }
    let mut other = base.clone();
    other.agreement.agreement.quote.quote.quote_id = "other-quote".into();
    common::sign_quote(&mut other, &keys);
    common::sign_root(&mut other, &keys);
    assert!(
        check_candidate(&review, &accepted, &other, &trust)
            .unwrap_err()
            .contains("PREFLIGHT_SUBSTITUTION")
    );
    let mut wrong_trust = trust.clone();
    wrong_trust.parties[1].party_id = "different-operator".into();
    assert!(review.validate(&wrong_trust).is_err());
    assert_eq!(
        encoding::digest(&bundle::verify_assignment_bundle(&base, &trust).unwrap()).unwrap(),
        before
    );
}

#[test]
fn accepted_preflight_native_base_signing_reuses_core_authority_and_exclusive_guard() {
    const PASSWORD: &[u8] = b"synthetic-dp2-preflight-password";
    let (mut base, mut trust, mut keys) = common::fixture();
    let vault = dir().join("operator-vault.json");
    trust.parties[1].key =
        local::create_vault(&vault, "O", "preflight-operator", PASSWORD).unwrap();
    keys[1] = local::unlock_vault(&vault, PASSWORD).unwrap().0;
    base.agreement.agreement.parties = trust.parties.clone();
    base.agreement.agreement.quote.quote.operator = trust.parties[1].clone();
    common::sign_quote(&mut base, &keys);
    common::sign_root(&mut base, &keys);
    let review = review(&base, &trust, &keys);
    let accepted = decision(&review, &trust, Decision::Accept);
    base.agreement.signatures.clear();
    let signing =
        BaseSigningReviewV1::new(review.clone(), accepted.clone(), base.clone(), &trust).unwrap();
    let signed = authorize_base(
        &signing,
        &encoding::digest(&signing).unwrap(),
        &trust,
        &vault,
        || Ok(Zeroizing::new(PASSWORD.to_vec())),
    )
    .unwrap();
    let a = &base.agreement.agreement;
    crypto::verify(
        &signed,
        &contract::claims(
            &a.deployment_domain,
            &a.assignment_id,
            &encoding::digest(a).unwrap(),
            contract::party(a, Role::Operator).unwrap(),
            "AGREEMENT",
        ),
        &trust.parties[1].key,
    )
    .unwrap();
    let mut bound = base.clone();
    common::sign_root(&mut bound, &keys);
    let context = annex(&review, &bound, &trust, &keys).context;
    let context_review = ConsentReviewV1::context(context, &bound, &trust).unwrap();
    let mut wrong_role = accepted.clone();
    wrong_role.participant_role = Role::Mediator;
    assert!(
        authorize_context(
            &review,
            &wrong_role,
            &context_review,
            &context_review.review_digest().unwrap(),
            &trust,
            &vault,
            || Ok(Zeroizing::new(PASSWORD.to_vec()))
        )
        .unwrap_err()
        .contains("PREFLIGHT_SIGNER")
    );
    authorize_context(
        &review,
        &accepted,
        &context_review,
        &context_review.review_digest().unwrap(),
        &trust,
        &vault,
        || Ok(Zeroizing::new(PASSWORD.to_vec())),
    )
    .unwrap();
    // Changed exact base terms still need separate exact base approval and cannot
    // bypass the original terms0 signer guard even with unchanged priors.
    base.agreement
        .agreement
        .legal
        .consent_text
        .push_str(" Additional disclosed sentence.");
    let changed = BaseSigningReviewV1::new(review, accepted, base, &trust).unwrap();
    assert!(
        authorize_base(
            &changed,
            &encoding::digest(&changed).unwrap(),
            &trust,
            &vault,
            || Ok(Zeroizing::new(PASSWORD.to_vec()))
        )
        .unwrap_err()
        .contains("SIGNER_CONFLICT")
    );
}
