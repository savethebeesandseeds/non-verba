// SPDX-License-Identifier: AGPL-3.0-only
//! Explicit real CPU plumbing probe. Every model failure is retained, never retried.
//! Fixed test signing keys authorize synthetic records only and are never exported.
#[path = "../../requests/tests/common/mod.rs"]
mod common;

use nonverba_disputes::{binding, case, pipeline::*, runtime::*};
use nonverba_requests::{
    crypto,
    encoding::{canonical, digest, strict_parse},
    model::{Role, TrustConfiguration},
};
use serde::Serialize;
use serde_json::{Value, json};
use std::{fs, io::Write, path::Path, sync::atomic::AtomicBool};

fn retain<T: Serialize>(directory: &Path, name: &str, value: &T) {
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(directory.join(name))
        .unwrap();
    file.write_all(&serde_json::to_vec_pretty(value).unwrap())
        .unwrap();
    file.write_all(b"\n").unwrap();
    file.sync_all().unwrap();
}

fn fixture(pins: &Value) -> (AnalysisPackageV1, TrustConfiguration) {
    let pin = |name: &str| {
        pins[name]
            .as_str()
            .expect("missing artifact pin")
            .to_owned()
    };
    let (mut bundle, trust, keys) = common::fixture();
    common::establish_compensation(&mut bundle, &keys);
    let request = bundle.requests[0].clone();
    let requester = binding::draft_declared_priors(
        binding::ProfileProvenance::Request {
            signed_request: request.clone(),
        },
        binding::balanced_allocations(),
        &trust,
    )
    .unwrap();
    let operator = binding::draft_declared_priors(
        binding::ProfileProvenance::Quote {
            signed_request: request,
            signed_quote: bundle.agreement.agreement.quote.clone(),
        },
        binding::balanced_allocations(),
        &trust,
    )
    .unwrap();
    let requester = binding::SignedDeclaredPriorsV1 {
        authorization: crypto::sign(
            &binding::declared_priors_claims(&requester, &trust).unwrap(),
            &keys[0],
        )
        .unwrap(),
        profile: requester,
    };
    let operator = binding::SignedDeclaredPriorsV1 {
        authorization: crypto::sign(
            &binding::declared_priors_claims(&operator, &trust).unwrap(),
            &keys[1],
        )
        .unwrap(),
        profile: operator,
    };
    let mut spec = development_spec(
        binding::priors_catalog_digest().unwrap(),
        digest(&requester.profile).unwrap(),
        digest(&operator.profile).unwrap(),
    );
    spec.runtime_status = "PINNED_READY".into();
    spec.model_id = format!(
        "{}; revision {}",
        pin("model_id"),
        pin("model_repository_revision")
    );
    spec.llama_cpp_commit = pin("llama_cpp_commit");
    spec.llama_cpp_build = Some(pin("build_info_from_server"));
    spec.server_binary_sha256 = Some(pin("server_binary_sha256"));
    spec.gguf_sha256 = Some(pin("gguf_sha256"));
    spec.tokenizer_sha256 = Some(pin("tokenizer_sha256"));
    spec.chat_template_sha256 = Some(pin("chat_template_sha256"));
    spec.quantization = pin("quantization");
    spec.backend = pin("backend");
    spec.threads = 2;
    spec.validate().unwrap();
    // These exact actual pins are installed before anyone signs this new context.
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
    let case = case::prepare_case(
        bundle,
        &trust,
        Some(&annex),
        "real-cpu-synthetic-case",
        vec!["milestone:work".into()],
    )
    .unwrap();
    (
        new_package(case, trust.clone(), annex, ComputeBudget::development()).unwrap(),
        trust,
    )
}

#[test]
#[ignore = "Opt-in real CPU model probe; run the native examples/real_smoke.rs driver in the existing managed Debian container"]
fn two_pass_real_smoke() {
    assert_eq!(std::env::var("NONVERBA_CONTAINER").as_deref(), Ok("1"));
    let capture = std::env::var("NONVERBA_REAL_SMOKE_CAPTURE").expect("driver capture path");
    let capture = Path::new(&capture);
    assert!(capture.is_absolute() && capture.is_dir());
    let admin: AdminRuntimeConfig =
        strict_parse(&fs::read(capture.join("admin-config.json")).unwrap()).unwrap();
    let pins: Value = strict_parse(&fs::read(capture.join("runtime-pins.json")).unwrap()).unwrap();
    let (mut package, trust) = fixture(&pins);
    let before = inspect_package(&package, &trust)
        .unwrap()
        .base_financial_projection;
    let original_bundle = canonical(&package.cases[0].bundle).unwrap();
    retain(capture, "synthetic-package-before.json", &package);
    retain(
        capture,
        "analysis-specification.json",
        &package.specification,
    );
    retain(capture, "independent-fixture-trust.json", &trust);
    let backend = LlamaCppBackend::new(admin, CancellationToken::default()).unwrap();
    // One small actual adapter call, separate from the one declared pipeline schedule.
    let prompt = format!(
        "{EVIDENCE_PROMPT}\nUNTRUSTED_CASE_DATA_JSON\n{{\"synthetic_probe\":true,\"evidence\":[],\"known_refs\":[]}}\nEND_UNTRUSTED_CASE_DATA\n"
    );
    retain(capture, "adapter-prompt.json", &prompt);
    let adapter = backend.generate(
        InputStage::Evidence,
        &prompt,
        &package.specification,
        package.specification.seeds[0],
    );
    retain(capture, "adapter-result.json", &adapter);
    let scheduled = run_schedule(
        &mut package,
        &backend,
        RunMode::Single,
        &AtomicBool::new(false),
        |attempt| {
            retain(
                capture,
                &format!("attempt-{}.json", attempt.schedule_index),
                attempt,
            );
            Ok(())
        },
    );
    retain(capture, "schedule-result.json", &scheduled);
    retain(capture, "synthetic-package-after.json", &package);
    let inspected = inspect_package(&package, &trust).unwrap();
    retain(capture, "package-inspection.json", &inspected);
    let export = export_package(&package, &trust);
    retain(capture, "portable-export-result.json", &export);
    if let Ok(archive) = &export {
        retain(capture, "portable-export.json", archive);
    }
    let replayed = export.as_ref().map(|archive| replay(archive, &trust));
    retain(capture, "replay-result.json", &replayed);
    let core_unchanged = inspected.base_financial_projection == before
        && canonical(&package.cases[0].bundle).unwrap() == original_bundle;
    let pipeline_success = package.attempts.len() == 1
        && package.attempts[0].execution_status == ExecutionStatus::Succeeded
        && package.attempts[0].stages.len() == 2;
    let summary = json!({
        "purpose":"Real CPU plumbing probe, not analysis quality or fairness validation",
        "synthetic_case":true,"test_fixture_keys_only":true,
        "model":"SmolLM2-135M-Instruct Q4_K_M","backend":"cpu","seed":17,
        "direct_adapter_succeeded":adapter.is_ok(),"schedule_returned_ok":scheduled.is_ok(),
        "two_pass_pipeline_succeeded":pipeline_success,"attempt_count":package.attempts.len(),
        "analysis_package_valid":inspected.analysis_package_valid,"core_bundle_and_projection_unchanged":core_unchanged,
        "financial_authority":"NONE","settlement_policy_status":"UNSPECIFIED",
        "quality_validated":false,"execution_attested":false,"independently_rerun":false,
        "diagnostic_seed_schedule_ran":false,"gpu_used":false,"qwen_downloaded":false
    });
    retain(capture, "test-summary.json", &summary);
    println!("{}", serde_json::to_string(&summary).unwrap());
    assert!(core_unchanged, "Analysis changed contractual records");
    assert!(
        inspected.analysis_package_valid,
        "Retained package failed independent validation"
    );
    assert!(scheduled.is_ok(), "Schedule failed; records retained");
    assert!(
        adapter.is_ok() && pipeline_success,
        "Real smoke did not complete both probes; all observed failures retained"
    );
}
