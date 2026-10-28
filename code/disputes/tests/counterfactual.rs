// SPDX-License-Identifier: AGPL-3.0-only
//! A counterfactual comparison changes one input and leaves the signed annex fixed.
#[path = "../../requests/tests/common/mod.rs"]
mod common;

use nonverba_disputes::{
    binding, case,
    counterfactual::{self, PriorShift},
    pipeline::{self, *},
    runtime::*,
};
use nonverba_requests::{
    crypto,
    encoding::{self, digest},
    model::{Role, TrustConfiguration},
};
use serde_json::json;
use std::sync::atomic::AtomicBool;

fn prepared() -> (AnalysisPackageV1, TrustConfiguration) {
    let (mut bundle, trust, keys) = common::fixture();
    common::establish_compensation(&mut bundle, &keys);
    let request = bundle.requests[0].clone();
    let draft = |provenance, key: &p256::ecdsa::SigningKey| {
        let profile =
            binding::draft_declared_priors(provenance, binding::balanced_allocations(), &trust)
                .unwrap();
        binding::SignedDeclaredPriorsV1 {
            authorization: crypto::sign(
                &binding::declared_priors_claims(&profile, &trust).unwrap(),
                key,
            )
            .unwrap(),
            profile,
        }
    };
    let requester = draft(
        binding::ProfileProvenance::Request {
            signed_request: request.clone(),
        },
        &keys[0],
    );
    let operator = draft(
        binding::ProfileProvenance::Quote {
            signed_request: request,
            signed_quote: bundle.agreement.agreement.quote.clone(),
        },
        &keys[1],
    );
    let spec = development_spec(
        binding::priors_catalog_digest().unwrap(),
        digest(&requester.profile).unwrap(),
        digest(&operator.profile).unwrap(),
    );
    let context = binding::draft_context(
        &bundle,
        &digest(&bundle.agreement.agreement).unwrap(),
        requester,
        operator,
        serde_json::to_value(spec).unwrap(),
        &trust,
    )
    .unwrap();
    let endorsements = [Role::Requester, Role::Operator, Role::Mediator]
        .into_iter()
        .enumerate()
        .map(|(index, role)| {
            crypto::sign(
                &binding::context_claims(&context, &bundle, &trust, role).unwrap(),
                &keys[index],
            )
            .unwrap()
        })
        .collect();
    let annex = binding::SignedDisputeContextV1 {
        context,
        endorsements,
    };
    let mut dispute = case::prepare_case(
        bundle,
        &trust,
        Some(&annex),
        "counterfactual-case",
        vec!["milestone:work".into()],
    )
    .unwrap();
    let original = "Original O claim: the work is finished.";
    let body = case::EvidenceSubmissionBodyV1 {
        version: "1".into(),
        case_id: dispute.case_id.clone(),
        submission_id: "operator-claim".into(),
        author_role: Role::Operator,
        agreement_hash: dispute.current_agreement_hash.clone(),
        context_hash: dispute.context_hash.clone().unwrap(),
        content_sha256: encoding::bytes_digest(original.as_bytes()),
        byte_length: original.len() as u64,
        media_type: "text/plain".into(),
        statement_kind: case::StatementKindV1::Claim,
        party_offer: None,
    };
    dispute.evidence.push(case::EvidenceItemV1 {
        id: "operator-claim".into(),
        media_type: "text/plain".into(),
        content_sha256: encoding::bytes_digest(original.as_bytes()),
        byte_length: original.len() as u64,
        availability: case::EvidenceAvailabilityV1::Accessible {
            bytes_b64: crypto::encode_base64url(original.as_bytes()),
        },
        origin: case::EvidenceOriginV1::Submission {
            signed: Box::new(case::EvidenceSubmissionV1 {
                authorization: crypto::sign(
                    &case::submission_claims(&body, &dispute.bundle, &trust).unwrap(),
                    &keys[1],
                )
                .unwrap(),
                body,
            }),
        },
        extractions: vec![],
        submitted_sensor_appraisal: None,
    });
    (
        pipeline::new_package(dispute, trust.clone(), annex, ComputeBudget::development()).unwrap(),
        trust,
    )
}

fn response(stage: InputStage) -> String {
    let comparisons = if stage == InputStage::Evidence {
        Vec::new()
    } else {
        ["result", "effort", "reliance", "responsibility", "remedy"]
            .into_iter()
            .map(|id| {
                json!({
                    "dimension_id": id,
                    "requester_emphasis": "Stated priority, not an entitlement.",
                    "operator_emphasis": "Stated priority, not factual proof.",
                    "unresolved_tradeoff": "No agreed scalar settlement rule.",
                    "evidence_refs": ["agreement"]
                })
            })
            .collect()
    };
    json!({
        "issues": [{
            "id": "work-description",
            "description": "Scope and the attributed statement need comparison.",
            "evidence_refs": ["agreement", "operator-claim"],
            "requester_argument": "Requester may contest actual performance.",
            "operator_argument": "Operator has supplied a signed claim.",
            "uncertainties": ["A signature does not prove physical performance."]
        }],
        "questions": [],
        "prior_comparisons": comparisons,
        "alternatives": [{"kind": "CLARIFICATION", "source_offer_ref": null}],
        "unresolved_reasons": ["No financial award or settlement policy is supplied."]
    })
    .to_string()
}

fn analyzed() -> (AnalysisPackageV1, TrustConfiguration) {
    let (mut package, trust) = prepared();
    pipeline::run_schedule(
        &mut package,
        &MockBackend::new(vec![
            Ok(response(InputStage::Evidence)),
            Ok(response(InputStage::PriorComparison)),
        ]),
        RunMode::Single,
        &AtomicBool::new(false),
        |_| Ok(()),
    )
    .unwrap();
    (package, trust)
}

fn shift() -> PriorShift {
    PriorShift {
        role: Role::Requester,
        from_dimension: "effort".into(),
        to_dimension: "result".into(),
        points: 20,
    }
}

#[test]
fn one_prior_move_and_one_withheld_fact_leave_the_signed_inclusion_fixed() {
    let (package, trust) = analyzed();
    let before = pipeline::inspect_package(&package, &trust)
        .unwrap()
        .base_financial_projection;
    let record = counterfactual::compare(
        &package,
        &trust,
        "milestone:work",
        shift(),
        "operator-claim",
    )
    .unwrap();
    let after = pipeline::inspect_package(&package, &trust)
        .unwrap()
        .base_financial_projection;
    assert_eq!(before, after);
    assert_eq!(record.inclusion.dictionary_id, binding::DICTIONARY_ID);
    assert_eq!(record.inclusion.financial_authority, "NONE");
    assert_eq!(record.inclusion.authority_mode, "ANALYSIS_ONLY");
    assert_eq!(record.inclusion.settlement_policy_status, "UNSPECIFIED");
    assert_eq!(record.claim_id, "milestone:work");
    assert!(record.notice.contains("not notice"));
    assert!(record.notice.contains("Silence"));
    assert_eq!(record.arms.len(), 3);
    assert_eq!(record.arms[0].consent, "SIGNED_PROFILES");
    assert_eq!(record.arms[1].consent, "HYPOTHETICAL_NOT_A_SIGNATURE");
    assert_eq!(record.arms[2].consent, "HYPOTHETICAL_NOT_A_SIGNATURE");
    assert!(
        record
            .prior_deltas
            .iter()
            .any(|delta| delta.path == "prior_comparisons/result/requester_emphasis")
    );
    assert!(
        record
            .prior_deltas
            .iter()
            .any(|delta| delta.path == "prior_comparisons/effort/requester_emphasis")
    );
    assert!(
        record
            .prior_deltas
            .iter()
            .all(|delta| delta.path.contains("/result/") || delta.path.contains("/effort/"))
    );
    assert!(record.fact_deltas.iter().any(|delta| delta.path
        == "issues/work-description/evidence_refs"
        && !delta.variant.contains("operator-claim")));
    assert!(
        record
            .fact_deltas
            .iter()
            .all(|delta| !delta.path.ends_with("_emphasis"))
    );
    let signed = digest(&package.context.context.requester_profile.profile).unwrap();
    assert_eq!(record.inclusion.requester_profile_hash, signed);
    assert_eq!(
        record.arms[1].analysis.prior_comparisons[1].operator_emphasis,
        record.arms[0].analysis.prior_comparisons[1].operator_emphasis
    );
}

#[test]
fn an_unknown_claim_or_uncited_fact_is_rejected() {
    let (package, trust) = analyzed();
    assert!(
        counterfactual::compare(
            &package,
            &trust,
            "milestone:other",
            shift(),
            "operator-claim"
        )
        .is_err()
    );
    assert!(
        counterfactual::compare(
            &package,
            &trust,
            "milestone:work",
            shift(),
            "agreement-missing"
        )
        .is_err()
    );
    let too_far = PriorShift {
        points: 80,
        ..shift()
    };
    assert!(
        counterfactual::compare(
            &package,
            &trust,
            "milestone:work",
            too_far,
            "operator-claim"
        )
        .is_err()
    );
}

fn disagreement() -> serde_json::Value {
    serde_json::from_str(include_str!("../fixtures/one-disagreement/readings.json")).unwrap()
}

fn set_emphasis(
    reading: &mut serde_json::Value,
    dimension: &str,
    role: &str,
    text: serde_json::Value,
    tradeoff: Option<serde_json::Value>,
) {
    for comparison in reading["prior_comparisons"].as_array_mut().unwrap() {
        if comparison["dimension_id"] == dimension {
            comparison[role] = text.clone();
            if let Some(tradeoff) = tradeoff.clone() {
                comparison["unresolved_tradeoff"] = tradeoff;
            }
        }
    }
}

fn authored_readings(spec: &serde_json::Value) -> [serde_json::Value; 6] {
    let baseline = spec["baseline"].clone();
    let mut prior = baseline.clone();
    let move_spec = &spec["prior_move"];
    set_emphasis(
        &mut prior,
        "result",
        "requester_emphasis",
        move_spec["result_requester_emphasis"].clone(),
        Some(move_spec["tradeoff"].clone()),
    );
    set_emphasis(
        &mut prior,
        "effort",
        "requester_emphasis",
        move_spec["effort_requester_emphasis"].clone(),
        Some(move_spec["tradeoff"].clone()),
    );
    let mut withheld = baseline.clone();
    withheld["issues"][0]["description"] = spec["withheld"]["description"].clone();
    withheld["issues"][0]["evidence_refs"] = json!(["agreement"]);
    withheld["issues"][0]["uncertainties"]
        .as_array_mut()
        .unwrap()
        .push(spec["withheld"]["uncertainty"].clone());
    withheld["unresolved_reasons"]
        .as_array_mut()
        .unwrap()
        .push(spec["withheld"]["reason"].clone());
    let mut swapped = baseline.clone();
    let requester = swapped["issues"][0]["requester_argument"].clone();
    swapped["issues"][0]["requester_argument"] = swapped["issues"][0]["operator_argument"].clone();
    swapped["issues"][0]["operator_argument"] = requester;
    for comparison in swapped["prior_comparisons"].as_array_mut().unwrap() {
        let requester = comparison["requester_emphasis"].clone();
        comparison["requester_emphasis"] = comparison["operator_emphasis"].clone();
        comparison["operator_emphasis"] = requester;
    }
    let mut irrelevant = baseline.clone();
    irrelevant["issues"][0]["requester_argument"] = spec["irrelevant_name_argument"].clone();
    let mut spilled = prior.clone();
    set_emphasis(
        &mut spilled,
        "remedy",
        "requester_emphasis",
        spec["spill_remedy_requester_emphasis"].clone(),
        None,
    );
    [baseline, prior, withheld, swapped, irrelevant, spilled]
}

fn evidence_pass(reading: &serde_json::Value) -> String {
    let mut evidence = reading.clone();
    evidence["prior_comparisons"] = json!([]);
    evidence["alternatives"] = json!([]);
    evidence.to_string()
}

#[test]
fn one_disagreement_diffs_three_mock_readings_and_keeps_a_failed_check() {
    let spec = disagreement();
    let readings = authored_readings(&spec);
    let (mut package, trust) = prepared();
    let before = pipeline::inspect_package(&package, &trust)
        .unwrap()
        .base_financial_projection;
    let script = readings[..3]
        .iter()
        .flat_map(|reading| [Ok(evidence_pass(reading)), Ok(reading.to_string())])
        .collect();
    pipeline::run_schedule(
        &mut package,
        &MockBackend::new(script),
        RunMode::Diagnostic,
        &AtomicBool::new(false),
        |_| Ok(()),
    )
    .unwrap();
    let record =
        counterfactual::compare_retained_attempts(&package, &trust, "milestone:work", 0, 1, 2)
            .unwrap();
    let after = pipeline::inspect_package(&package, &trust)
        .unwrap()
        .base_financial_projection;
    assert_eq!(before, after);
    assert_eq!(record.kind, "RETAINED_READINGS");
    assert_eq!(record.backend, "MOCK");
    for stage in &mut package.attempts[2].stages {
        stage.backend_kind = Some("GROK_HEADLESS".into());
        if let Some(completion) = stage.completion.as_mut() {
            completion["provenance"]["kind"] = json!("GROK_HEADLESS");
        }
    }
    let mixed =
        counterfactual::compare_retained_attempts(&package, &trust, "milestone:work", 0, 1, 2)
            .unwrap();
    assert_eq!(mixed.backend, "MIXED");
    assert_eq!(
        record.inclusion.requester_profile_hash,
        digest(&package.context.context.requester_profile.profile).unwrap()
    );
    assert!(record.notice.contains("not notice"));
    let parsed = |value: &serde_json::Value| {
        DisputeAnalysisV1::parse(
            &value.to_string(),
            InputStage::PriorComparison,
            &[
                "agreement".into(),
                "financial-report".into(),
                "operator-claim".into(),
            ],
            &[],
        )
        .unwrap()
    };
    let checks = counterfactual::explanation_checks(counterfactual::ExplanationChecks {
        baseline: &parsed(&readings[0]),
        prior_move: &parsed(&readings[1]),
        withheld: &parsed(&readings[2]),
        party_swap: &parsed(&readings[3]),
        irrelevant_name: &parsed(&readings[4]),
        spilled_prior: &parsed(&readings[5]),
        withheld_ref: "operator-claim",
        from_dimension: "effort",
        to_dimension: "result",
        names: ("Northwind", "Example Cooperative"),
    })
    .unwrap();
    let result = |id: &str| checks.iter().find(|check| check.id == id).unwrap().passed;
    assert!(result("prior-move-changes-only-its-dimensions"));
    assert!(result("withheld-fact-adds-uncertainty-without-a-new-fact"));
    assert!(result("party-swap-swaps-attributed-emphasis"));
    assert!(result("irrelevant-name-leaves-the-explanation-stable"));
    assert!(!result("spilled-prior-move-fails-the-clean-move-rule"));
}
