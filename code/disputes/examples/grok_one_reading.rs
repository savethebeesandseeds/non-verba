// SPDX-License-Identifier: AGPL-3.0-only
//! One contained reading of the frozen disagreement through the Grok preset.
//! Refuses to start unless NONVERBA_GROK_READING=approved. One single schedule
//! is two completions. The output package is kept whether the model succeeds.
#[path = "../../requests/tests/common/mod.rs"]
mod common;

use nonverba_disputes::{
    binding, case,
    completion::{GrokHeadlessBackend, GrokHeadlessConfig},
    pipeline::{self, ComputeBudget, RunMode},
    runtime::{CancellationToken, development_spec},
};
use nonverba_requests::{crypto, encoding, model::Role};
use std::{
    env, fs,
    path::Path,
    process::ExitCode,
    sync::atomic::AtomicBool,
};

fn main() -> ExitCode {
    if env::var("NONVERBA_GROK_READING").ok().as_deref() != Some("approved") {
        eprintln!("Refusing to start. NONVERBA_GROK_READING=approved is required.");
        return ExitCode::from(2);
    }
    let output = env::args().nth(1).unwrap_or_else(|| {
        eprintln!("Usage: grok_one_reading <new-package.json>");
        String::new()
    });
    if output.is_empty() || Path::new(&output).exists() {
        eprintln!("Choose a new output path.");
        return ExitCode::from(2);
    }
    let program = env::var("NONVERBA_GROK_PROGRAM")
        .unwrap_or_else(|_| "/home/waajacu/.grok/bin/grok".into());
    let (mut package, trust) = prepared();
    let before = pipeline::inspect_package(&package, &trust)
        .map(|inspection| inspection.base_financial_projection)
        .ok();
    let backend = match GrokHeadlessBackend::new(
        GrokHeadlessConfig {
            program: program.into(),
            effort: "low".into(),
            approved: true,
        },
        CancellationToken::default(),
    ) {
        Ok(backend) => backend,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::from(2);
        }
    };
    let result = pipeline::run_schedule(
        &mut package,
        &backend,
        RunMode::Single,
        &AtomicBool::new(false),
        |_| Ok(()),
    );
    if let Err(error) = fs::write(
        &output,
        serde_json::to_vec_pretty(&package).expect("package serializes"),
    ) {
        eprintln!("Could not retain the package: {error}");
        return ExitCode::from(1);
    }
    let after = pipeline::inspect_package(&package, &trust).ok();
    if before.as_ref() != after.as_ref().map(|inspection| &inspection.base_financial_projection) {
        eprintln!("Financial projection changed. The retained package needs inspection.");
        return ExitCode::from(1);
    }
    for attempt in &package.attempts {
        eprintln!(
            "attempt seed={} execution={:?} analysis={:?} reason={} tokens={} runs={}",
            attempt.seed,
            attempt.execution_status,
            attempt.analysis_status,
            attempt.reason.as_deref().unwrap_or(""),
            attempt.consumed.tokens,
            attempt.consumed.runs
        );
        for stage in &attempt.stages {
            let kind = stage.backend_kind.as_deref().unwrap_or("");
            let error = stage
                .runtime_error
                .as_ref()
                .map(|runtime| runtime.code.as_str())
                .or(stage.error.as_deref())
                .unwrap_or("");
            eprintln!("  stage={} backend={kind} error={error}", stage.stage);
        }
    }
    if let Err(error) = result {
        eprintln!("Schedule retained with: {error}");
    }
    ExitCode::SUCCESS
}

fn prepared() -> (pipeline::AnalysisPackageV1, nonverba_requests::model::TrustConfiguration) {
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
        encoding::digest(&requester.profile).unwrap(),
        encoding::digest(&operator.profile).unwrap(),
    );
    let context = binding::draft_context(
        &bundle,
        &encoding::digest(&bundle.agreement.agreement).unwrap(),
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
