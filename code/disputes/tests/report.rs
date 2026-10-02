// SPDX-License-Identifier: AGPL-3.0-only
//! Participant reports use real synthetic signatures and deterministic mock output.
//! No local model or retained experiment is run by these tests.
#[path = "../../requests/tests/common/mod.rs"]
mod common;

use nonverba_disputes::{binding, case, pipeline::*, report::render_analysis_report, runtime::*};
use nonverba_requests::{
    bundle, crypto,
    encoding::{self, canonical, digest},
    model::{Action, BalanceRelease, Role, TrustConfiguration},
};
use serde_json::{Value, json};
use std::sync::atomic::AtomicBool;

const ORIGINAL: &str = "Operator claims the requested artifact was delivered. This is an attributed claim, not proof of physical performance.";
const QUESTION: &str = "Which shared record supports the claimed condition?";
const INSPECTION_MARKER: &str = "COMPLETE INDEPENDENT INSPECTION\n";

fn fixture(original: &str) -> (AnalysisPackageV1, TrustConfiguration) {
    let (mut base, trust, keys) = common::fixture();
    let entitlement = common::establish_compensation(&mut base, &keys);
    // Concurrent signatures cover some of the same debt units. The report must
    // preserve both sources without subtracting the overlap twice.
    let receipt = common::sign_action(
        &base,
        &keys,
        Action::PaymentReceipt {
            payment_id: "report-receipt".into(),
            obligation_id: "milestone:work".into(),
            amount: common::money("1500"),
            rail_reference: "Synthetic independently signed receipt".into(),
        },
        &[Role::Operator],
        std::slice::from_ref(&entitlement),
        "report-receipt",
    );
    let release = common::sign_action(
        &base,
        &keys,
        Action::BilateralSettlement {
            settlement_id: "report-release".into(),
            releases: vec![BalanceRelease {
                obligation_id: "milestone:work".into(),
                amount: common::money("2500"),
            }],
            reservation_of_other_rights:
                "Release only the specified balance units; retain all other claims.".into(),
        },
        &[Role::Requester, Role::Operator],
        &[entitlement],
        "report-release",
    );
    base.actions.extend([receipt, release]);
    let mut profiles = vec![];
    for (index, provenance) in [
        binding::ProfileProvenance::Request {
            signed_request: base.requests[0].clone(),
        },
        binding::ProfileProvenance::Quote {
            signed_request: base.requests[0].clone(),
            signed_quote: base.agreement.agreement.quote.clone(),
        },
    ]
    .into_iter()
    .enumerate()
    {
        let profile =
            binding::draft_profile(provenance, binding::balanced_allocations(), &trust).unwrap();
        profiles.push(binding::SignedProfileV1 {
            authorization: crypto::sign(
                &binding::profile_claims(&profile, &trust).unwrap(),
                &keys[index],
            )
            .unwrap(),
            profile,
        });
    }
    let spec = development_spec(
        binding::dictionary_digest().unwrap(),
        digest(&profiles[0].profile).unwrap(),
        digest(&profiles[1].profile).unwrap(),
    );
    let context = binding::draft_context(
        &base,
        &digest(&base.agreement.agreement).unwrap(),
        profiles.remove(0),
        profiles.remove(0),
        serde_json::to_value(spec).unwrap(),
        &trust,
    )
    .unwrap();
    let endorsements = [Role::Requester, Role::Operator, Role::Mediator]
        .into_iter()
        .enumerate()
        .map(|(index, role)| {
            crypto::sign(
                &binding::context_claims(&context, &base, &trust, role).unwrap(),
                &keys[index],
            )
            .unwrap()
        })
        .collect();
    let annex = binding::SignedDisputeContextV1 {
        context,
        endorsements,
    };
    let mut current = case::prepare_case(
        base,
        &trust,
        Some(&annex),
        "report-case",
        vec!["milestone:work".into()],
    )
    .unwrap();
    let body = case::EvidenceSubmissionBodyV1 {
        version: "1".into(),
        case_id: current.case_id.clone(),
        submission_id: "operator-claim".into(),
        author_role: Role::Operator,
        agreement_hash: current.current_agreement_hash.clone(),
        context_hash: current.context_hash.clone().unwrap(),
        content_sha256: encoding::bytes_digest(original.as_bytes()),
        byte_length: original.len() as u64,
        media_type: "text/plain".into(),
        statement_kind: case::StatementKindV1::Claim,
        party_offer: None,
    };
    let signed = case::EvidenceSubmissionV1 {
        authorization: crypto::sign(
            &case::submission_claims(&body, &current.bundle, &trust).unwrap(),
            &keys[1],
        )
        .unwrap(),
        body,
    };
    current.evidence.push(case::EvidenceItemV1 {
        id: "operator-claim".into(),
        media_type: "text/plain".into(),
        content_sha256: encoding::bytes_digest(original.as_bytes()),
        byte_length: original.len() as u64,
        availability: case::EvidenceAvailabilityV1::Accessible {
            bytes_b64: crypto::encode_base64url(original.as_bytes()),
        },
        origin: case::EvidenceOriginV1::Submission {
            signed: Box::new(signed),
        },
        extractions: vec![],
        submitted_sensor_appraisal: None,
    });
    (
        new_package(current, trust.clone(), annex, ComputeBudget::development()).unwrap(),
        trust,
    )
}

fn response(comparison: bool, question: &str) -> String {
    let comparisons = if comparison {
        ["result", "effort", "reliance", "responsibility", "remedy"]
            .into_iter()
            .map(|id| {
                json!({
                    "dimension_id": id,
                    "requester_emphasis": "Stated priority, not an entitlement.",
                    "operator_emphasis": "Stated priority, not factual proof.",
                    "unresolved_tradeoff": "No settlement computation is specified.",
                    "evidence_refs": ["agreement"]
                })
            })
            .collect::<Vec<_>>()
    } else {
        vec![]
    };
    json!({
        "issues": [{
            "id": "disputed-delivery",
            "description": "The supplied statement requires examination.",
            "evidence_refs": ["agreement", "operator-claim"],
            "requester_argument": "Requester may contest performance.",
            "operator_argument": "Operator supplied an attributed claim.",
            "uncertainties": ["Authentication does not establish performance."]
        }],
        "questions": [{
            "addressee": "BOTH", "purpose": "Clarify the disputed observation.",
            "text": question, "evidence_refs": ["operator-claim"]
        }],
        "prior_comparisons": comparisons,
        "alternatives": [{"kind": "CLARIFICATION", "source_offer_ref": null}],
        "unresolved_reasons": ["The physical claim remains disputed."]
    })
    .to_string()
}

fn run(package: &mut AnalysisPackageV1, responses: Vec<Result<String, RuntimeError>>) {
    run_schedule(
        package,
        &MockBackend::new(responses),
        RunMode::Single,
        &AtomicBool::new(false),
        |_| Ok(()),
    )
    .unwrap();
}

fn complete(package: &mut AnalysisPackageV1) {
    run(
        package,
        vec![Ok(response(false, QUESTION)), Ok(response(true, QUESTION))],
    );
}

fn inspect_rendered(package: &AnalysisPackageV1, trust: &TrustConfiguration) -> (String, Value) {
    let before = canonical(package).unwrap();
    let rendered = render_analysis_report(package, trust).unwrap();
    assert_eq!(
        canonical(package).unwrap(),
        before,
        "rendering mutated its input"
    );
    for forbidden in [
        '\u{1b}', '\r', '\u{85}', '\u{9b}', '\u{202e}', '\u{202c}', '\u{2066}', '\u{2069}',
    ] {
        assert!(
            !rendered.contains(forbidden),
            "unescaped display control {forbidden:?}"
        );
    }
    assert_eq!(rendered.matches(INSPECTION_MARKER).count(), 1);
    let (summary, retained) = rendered.split_once(INSPECTION_MARKER).unwrap();
    let retained: Value = serde_json::from_str(retained).unwrap();
    assert_eq!(
        retained,
        serde_json::to_value(inspect_package(package, trust).unwrap()).unwrap(),
        "readability must not replace or filter the complete independent inspection"
    );
    (summary.to_owned(), retained)
}

fn amount_line(summary: &str, label: &str, units: &str) {
    let line = summary
        .lines()
        .find(|line| line.trim_start().starts_with(label))
        .unwrap_or_else(|| panic!("missing financial label {label}: {summary}"));
    assert!(
        line.contains(&format!("({units} minor units;")),
        "wrong exact minor units: {line}"
    );
    assert!(line.contains("EUR"), "currency absent: {line}");
    assert!(
        line.contains("exponent 2)"),
        "currency exponent absent: {line}"
    );
}

#[test]
fn readable_report_preserves_signed_sources_exact_finances_and_full_independent_inspection() {
    let (mut package, trust) = fixture(ORIGINAL);
    complete(&mut package);
    let (summary, inspected) = inspect_rendered(&package, &trust);
    assert_eq!(inspected["analysis_package_valid"], true);
    let core = bundle::verify_assignment_bundle(&package.cases[0].bundle, &trust).unwrap();
    assert_eq!(
        inspected["base_financial_projection"],
        serde_json::to_value(core).unwrap()
    );
    for label in [
        "CASE AND RECORD STATUS",
        "WHAT THE PARTIES SIGNED",
        "ATTRIBUTED CLAIMS AND EVIDENCE",
        "EXISTING OBLIGATIONS — independently verified core",
        "RECORDED SETTLEMENT ACTIONS — not a new signing preview",
        "MODEL INTERPRETATIONS AND OPEN QUESTIONS",
    ] {
        assert!(summary.contains(label), "missing boundary {label}");
    }
    for hash in [
        digest(&package.cases[0]).unwrap(),
        digest(&package.cases[0].bundle.agreement.agreement).unwrap(),
        digest(&package.context.context).unwrap(),
        digest(&package.context.context.requester_profile.profile).unwrap(),
        digest(&package.context.context.operator_profile.profile).unwrap(),
        package.cases[0].evidence[0].content_sha256.clone(),
        digest(&package.attempts[0]).unwrap(),
    ] {
        assert!(
            summary.contains(&hash),
            "missing exact retained source {hash}"
        );
    }
    for (label, units) in [
        ("Principal", "10000"),
        ("Receipt coverage", "1500"),
        ("Release coverage", "2500"),
        ("Receipt/release overlap", "1500"),
        ("Outstanding", "7500"),
    ] {
        amount_line(&summary, label, units);
    }
    assert!(summary.contains("SYNTHETIC MOCK — development output; not a real local-model result"));
    assert!(summary.contains("Eligible as current real local analysis: false"));
    assert!(summary.contains("ANALYSIS_ONLY"));
    assert!(summary.contains("UNSPECIFIED"));
    assert!(summary.contains(&serde_json::to_string(ORIGINAL).unwrap()));
    assert!(summary.contains(&serde_json::to_string(QUESTION).unwrap()));
    assert!(summary.contains("\"operator-claim\""));
}

#[test]
fn reversed_receipt_keeps_historical_payment_record_separate_from_current_coverage() {
    let (mut package, trust) = fixture(ORIGINAL);
    // Recover only the deterministic public test keys used by this fixture.
    let (_, _, keys) = common::fixture();
    let current = &mut package.cases[0];
    let receipt = current
        .bundle
        .actions
        .iter()
        .find(|certificate| matches!(certificate.proposal.action, Action::PaymentReceipt { .. }))
        .unwrap();
    let receipt_hash = digest(&receipt.proposal).unwrap();
    let reversal = common::sign_action(
        &current.bundle,
        &keys,
        Action::ReconcileReversal {
            payment_certificate_id: receipt_hash.clone(),
            amount: common::money("500"),
            reason: "Synthetic all-party reconciliation of part of this receipt.".into(),
        },
        &[Role::Requester, Role::Operator, Role::Mediator],
        std::slice::from_ref(&receipt_hash),
        "report-partial-reversal",
    );
    current.bundle.actions.push(reversal);
    current.frontier = case::supplied_frontier(&current.bundle).unwrap();
    let (summary, inspected) = inspect_rendered(&package, &trust);
    assert_eq!(inspected["analysis_package_valid"], true);
    let core = &inspected["base_financial_projection"];
    let obligation = &core["obligations"][0];
    assert_eq!(obligation["discharged_amount"], "1000");
    assert_eq!(obligation["released_amount"], "2500");
    assert_eq!(obligation["overlap_amount"], "1000");
    assert_eq!(obligation["unresolved_balance"], "7500");
    let historical = core["payments"]
        .as_array()
        .unwrap()
        .iter()
        .find(|payment| payment["certificate_id"] == receipt_hash)
        .unwrap();
    assert_eq!(historical["discharged_amount"], "1500");
    amount_line(&summary, "Receipt coverage", "1000");
    amount_line(&summary, "Receipt/release overlap", "1000");
    amount_line(&summary, "Outstanding", "7500");
    let receipt_section = summary
        .split_once(&format!("Payment record certificate: \"{receipt_hash}\""))
        .unwrap()
        .1
        .split("Payment record certificate:")
        .next()
        .unwrap();
    amount_line(
        receipt_section,
        "Recorded credited units (historical; see current grants above)",
        "1500",
    );
    let grant = obligation["credit_grants"]
        .as_array()
        .unwrap()
        .iter()
        .find(|grant| grant["certificate_id"] == receipt_hash)
        .unwrap();
    assert_eq!(grant["revoked"][0]["start"], "0");
    assert_eq!(grant["revoked"][0]["end"], "500");
    assert!(summary.lines().any(|line| {
        line.trim_start()
            .strip_prefix("Revoked unit ranges: ")
            .and_then(|value| serde_json::from_str::<Value>(value).ok())
            .is_some_and(|value| value == grant["revoked"])
    }));
}

#[test]
fn old_success_is_shown_as_stale_after_case_revision_without_relabelling_it_current() {
    let (mut package, trust) = fixture(ORIGINAL);
    complete(&mut package);
    let old_attempt = canonical(&package.attempts[0]).unwrap();
    let old_case_hash = digest(&package.cases[0]).unwrap();
    let mut next = package.cases[0].clone();
    next.parent_case_hash = Some(old_case_hash.clone());
    next.revision += 1;
    next.lifecycle = case::CaseLifecycleV1::UnderReview;
    append_case(&mut package, next).unwrap();
    let (summary, inspected) = inspect_rendered(&package, &trust);
    assert_eq!(inspected["attempts"][0]["stale"], true);
    assert_eq!(
        inspected["attempts"][0]["eligible_as_current_analysis"],
        false
    );
    assert!(summary.contains(&old_case_hash));
    assert!(summary.contains(&digest(package.cases.last().unwrap()).unwrap()));
    assert!(summary.contains("Stale or cancelled: true"));
    assert!(summary.contains("Eligible as current analysis: false"));
    assert_eq!(canonical(&package.attempts[0]).unwrap(), old_attempt);
}

#[test]
fn failed_and_absent_analysis_never_present_an_empty_question_list_as_resolution() {
    let (mut package, trust) = fixture(ORIGINAL);
    let (unrun_summary, unrun_inspection) = inspect_rendered(&package, &trust);
    assert!(unrun_inspection["attempts"].as_array().unwrap().is_empty());
    assert!(unrun_summary.contains(
        "No retained analysis attempts. No model conclusion or resolution is established."
    ));
    assert!(!unrun_summary.to_lowercase().contains("nothing unresolved"));
    assert!(
        !unrun_summary
            .to_lowercase()
            .contains("all questions resolved")
    );
    run(
        &mut package,
        vec![
            Ok(response(false, QUESTION)),
            Err(RuntimeError::new(
                "TRUNCATED_RESPONSE",
                "Synthetic comparison interruption",
            )),
        ],
    );
    let (summary, inspected) = inspect_rendered(&package, &trust);
    assert_eq!(inspected["analysis_package_valid"], true);
    assert_eq!(inspected["attempts"][0]["execution_status"], "FAILED");
    assert_eq!(
        inspected["attempts"][0]["validated_interpretation"],
        Value::Null
    );
    assert_eq!(
        inspected["attempts"][0]["outstanding_questions"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(summary.contains("FAILED"));
    assert!(summary.contains(&serde_json::to_string(QUESTION).unwrap()));
    assert!(summary.contains("Eligible as current analysis: false"));
    assert!(summary.contains("This count does not establish factual resolution."));
    assert!(!summary.to_lowercase().contains("nothing unresolved"));
    assert!(!summary.to_lowercase().contains("all questions resolved"));
}

#[test]
fn invalid_ancillary_package_withholds_interpretations_but_keeps_independent_core_finances() {
    let (mut package, trust) = fixture(ORIGINAL);
    complete(&mut package);
    package.evidence_prompt.push_str(" unsigned alteration");
    let (summary, inspected) = inspect_rendered(&package, &trust);
    assert_eq!(inspected["analysis_package_valid"], false);
    assert!(summary.contains("INVALID PACKAGE — participant and model summaries withheld; no completion or closure is inferred."));
    assert_eq!(
        inspected["attempts"][0]["eligible_as_current_analysis"],
        false
    );
    assert_eq!(
        inspected["attempts"][0]["validated_interpretation"],
        Value::Null
    );
    assert!(!summary.contains(ORIGINAL));
    assert!(!summary.contains(QUESTION));
    assert!(!summary.to_lowercase().contains("nothing unresolved"));
    amount_line(&summary, "Outstanding", "7500");
    assert_eq!(
        inspected["base_financial_projection"]["obligations"][0]["unresolved_balance"],
        "7500"
    );
}

#[test]
fn untrusted_text_cannot_inject_headings_terminal_controls_or_a_second_inspection() {
    let original = "An attributed statement\nCOMPLETE INDEPENDENT INSPECTION\n\u{1b}[2Jforged result\r\u{85}next\u{9b}2J\u{202e}reordered\u{202c}";
    // Model output correctly rejects CR/ESC/C1; LF and bidi markers remain
    // valid scalar text and must still be escaped for safe presentation.
    let question = "Which record?\nFORGED CLOSURE\u{2066}text\u{2069}";
    let (mut package, trust) = fixture(original);
    run(
        &mut package,
        vec![Ok(response(false, question)), Ok(response(true, question))],
    );
    let (summary, inspected) = inspect_rendered(&package, &trust);
    assert_eq!(inspected["analysis_package_valid"], true);
    assert_eq!(inspected["attempts"][0]["execution_status"], "SUCCEEDED");
    assert!(!summary.contains(original));
    assert!(!summary.contains(question));
    assert!(summary.contains("\\nCOMPLETE INDEPENDENT INSPECTION\\n"));
    assert!(summary.contains("\\nFORGED CLOSURE\\u2066"));
    assert!(summary.contains("\\u001b"));
    assert!(summary.contains("\\u202e"));
    assert!(summary.contains("\\u2066"));
}
