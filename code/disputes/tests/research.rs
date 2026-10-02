// SPDX-License-Identifier: AGPL-3.0-only
use nonverba_disputes::research::{CandidatePolicyResearchV1, SyntheticCaseReferenceV1};
use serde_json::json;

fn manifest() -> CandidatePolicyResearchV1 {
    CandidatePolicyResearchV1 {
        version: 1,
        candidate_policy_id: "explicit-future-candidate".into(),
        candidate_policy_version: "research-v1".into(),
        authority_mode: "RESEARCH_ONLY".into(),
        data_classification: "DECLARED_SYNTHETIC".into(),
        synthetic_cases: vec![SyntheticCaseReferenceV1 {
            case_id: "synthetic-missing-evidence".into(),
            content_sha256: "1".repeat(64),
        }],
        assumptions: vec!["Toy scenario; no human fairness ground truth is supplied.".into()],
        output_limitations: vec![
            "No contractual effects, financial authority or fairness conclusion.".into(),
        ],
        execution_status: "NOT_IMPLEMENTED".into(),
    }
}

#[test]
fn named_synthetic_metadata_is_inspectable_but_no_formula_executes() {
    let a = manifest();
    a.validate().unwrap();
    assert!(
        a.evaluate()
            .unwrap_err()
            .starts_with("POLICY_NOT_IMPLEMENTED")
    );
    let mut b = a.clone();
    b.assumptions
        .push("An explicit changed research assumption.".into());
    assert_ne!(a.digest().unwrap(), b.digest().unwrap());
}

#[test]
fn research_cannot_be_promoted_to_financial_authority_or_implicit_real_data() {
    for (field, value) in [
        ("authority_mode", json!("BINDING")),
        ("execution_status", json!("SUCCEEDED")),
        ("data_classification", json!("PRODUCTION")),
        ("assumptions", json!([])),
        ("output_limitations", json!([])),
    ] {
        let mut v = serde_json::to_value(manifest()).unwrap();
        v[field] = value;
        assert!(
            serde_json::from_value::<CandidatePolicyResearchV1>(v)
                .unwrap()
                .validate()
                .is_err()
        );
    }
    let mut a = manifest();
    a.synthetic_cases.push(a.synthetic_cases[0].clone());
    assert!(a.validate().is_err());
    let mut v = serde_json::to_value(manifest()).unwrap();
    v["payment_amount"] = json!(100);
    assert!(serde_json::from_value::<CandidatePolicyResearchV1>(v).is_err());
}
