// SPDX-License-Identifier: AGPL-3.0-only
//! Declared synthetic DP-2 experiment; shares the native driver's process/I/O guards.
//! Public fixture keys only. No provisioning, retries or live participant records.
#[path = "../../../requests/tests/common/mod.rs"]
mod common;

use super::*;
use nonverba_disputes::{binding, case, pipeline, runtime};
use nonverba_requests::{
    agreement, crypto,
    encoding::{canonical, digest},
    model::{AssignmentBundle, Role, TrustConfiguration},
};
use p256::ecdsa::SigningKey;
use std::sync::atomic::AtomicBool;

const BINARY: &str = "/usr/local/lib/nonverba/llama.cpp/14a9d09f75683c94c2c4f229efe54670d4209089/build-cuda/bin/llama-server";
const BINARY_HASH: &str = "94dd78d6648e8da325a117054a7bdcc689fd6cdd2b8e7fb3a8afc4b146788b9d";
const MODEL: &str = "/usr/local/share/nonverba/models/smollm2-135m-instruct/09816acd5d99df7be770d85ea30822623dab342c/SmolLM2-135M-Instruct-Q4_K_M.gguf";
const MODEL_HASH: &str = "2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d";
const QWEN: &str = "/opt/nonverba-tools/models/qwen3-4b-instruct-2507/a06e946bb6b655725eafa393f4a9745d460374c9/Qwen3-4B-Instruct-2507-Q4_K_M.gguf";
const QWEN_HASH: &str = "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597";

#[derive(Clone, Serialize)]
struct ExperimentCase {
    id: String,
    factual_case: String,
    requester_points: [u32; 5],
    operator_points: [u32; 5],
    requester_statement: String,
    operator_statement: String,
    reverse_evidence_order: bool,
    expected_observations_for_review_only: Vec<String>,
}

fn schedule() -> Vec<ExperimentCase> {
    let clear = ExperimentCase {
        id: "clear-balanced".into(), factual_case: "clear-shortfall".into(),
        requester_points: [50; 5], operator_points: [50; 5],
        requester_statement: "I received a CSV containing rows A,1 and B,2 only. The agreed third row C,3 is absent. There is no dispute about the two rows received. I supplied all source rows before work began.".into(),
        operator_statement: "I delivered rows A,1 and B,2. I omitted row C,3 by mistake, although the Requester supplied all three source rows. I can provide the missing row. I am not claiming the three-row deliverable was complete.".into(),
        reverse_evidence_order: false,
        expected_observations_for_review_only: vec!["Both parties agree that row C,3 is absent: supported clear shortfall, not invented symmetrical uncertainty.".into(), "Operator identifies its own omission; repair is available, without creating an obligation or award.".into()],
    };
    let mut result = clear.clone();
    result.id = "clear-result-priority".into();
    result.requester_points = [100, 25, 25, 50, 50];
    result.operator_points = [75, 25, 25, 50, 75];
    let mut effort = clear.clone();
    effort.id = "clear-effort-repair-priority".into();
    effort.requester_points = [50, 25, 25, 50, 100];
    effort.operator_points = [25, 100, 25, 25, 75];
    let prerequisite = ExperimentCase {
        id: "prerequisite-balanced".into(), factual_case: "requester-prerequisite".into(),
        requester_points: [50; 5], operator_points: [50; 5],
        requester_statement: "The Operator needed my source rows to create the CSV. I did not provide those rows by the agreed start. The Operator asked me twice for them. No CSV was delivered. I still control the missing source rows.".into(),
        operator_statement: "I prepared the CSV header and asked the Requester twice for the source rows. I did not receive any source rows and could not populate the CSV. I did not deliver a finished CSV. I can resume once the Requester supplies the rows.".into(),
        reverse_evidence_order: false,
        expected_observations_for_review_only: vec!["The Requester controlled and did not supply the prerequisite; both accounts support this cause of noncompletion.".into(), "Preparation and requests are evidence of effort, not completion; useful next step is supplying the source rows.".into()],
    };
    let mut order = prerequisite.clone();
    order.id = "prerequisite-reversed-evidence".into();
    order.reverse_evidence_order = true;
    let mut paraphrase = prerequisite.clone();
    paraphrase.id = "prerequisite-paraphrase".into();
    paraphrase.requester_statement = "The input rows were mine to send before the start, but I never sent them. I received two requests for that input from the Operator. The CSV is unfinished; I retain the source rows.".into();
    paraphrase.operator_statement = "I made the header, requested the input rows on two occasions, and received none. With those Requester-held rows missing, I could not fill the CSV or deliver it complete. Work can continue after the input arrives.".into();
    let mut verbose = prerequisite.clone();
    verbose.id = "prerequisite-verbose-operator".into();
    verbose.operator_statement.push_str(" To repeat the same facts in more words: my preparatory work was the header. My two messages requested the source rows. The rows remained with the Requester. I did not receive them. I therefore did not populate the file and did not deliver a completed CSV. This restates my account and adds no observation, expertise claim or new fact.");
    let ambiguity = ExperimentCase {
        id: "ambiguity-balanced".into(), factual_case: "conflicting-delivery".into(),
        requester_points: [50; 5], operator_points: [50; 5],
        requester_statement: "I supplied all three source rows before work. The file I received contained only A,1 and B,2. I have not supplied the received file or its hash for this review. I say row C,3 was missing on receipt.".into(),
        operator_statement: "I say the file I sent contained A,1, B,2 and C,3. I have not supplied the sent file, hash or transfer log for this review. I do not know why the Requester reports only two rows.".into(),
        reverse_evidence_order: false,
        expected_observations_for_review_only: vec!["Conflicting claims about sent/received row C,3 cannot be resolved from these statements alone.".into(), "Request sent and received files/hashes or a relevant transfer record; do not fabricate verification or causal blame.".into()],
    };
    vec![
        clear,
        result,
        effort,
        prerequisite,
        order,
        paraphrase,
        verbose,
        ambiguity,
    ]
}

fn base(case: &ExperimentCase) -> (AssignmentBundle, TrustConfiguration, [SigningKey; 3]) {
    let (mut bundle, trust, keys) = common::fixture();
    let mut service = bundle.agreement.agreement.service.clone();
    service.description =
        "Create one CSV file with header item,value and rows A,1; B,2; C,3.".into();
    service.deliverables = vec!["CSV with all three rows exactly: A,1; B,2; C,3.".into()];
    service.prerequisites = vec!["Requester must provide the three source rows before the agreed start; Operator cannot populate the CSV without them.".into()];
    service.requester_inputs = vec!["All three source rows.".into()];
    let request = &mut bundle.requests[0];
    request.request.request_id = format!("dp2-{}", case.id);
    request.request.service = service.clone();
    request.authorization = crypto::sign(
        &agreement::claims(
            common::TEST_DOMAIN,
            &request.request.request_id,
            &digest(&request.request).unwrap(),
            &request.request.requester,
            "REQUEST",
        ),
        &keys[0],
    )
    .unwrap();
    let request_hash = digest(&request.request).unwrap();
    let a = &mut bundle.agreement.agreement;
    a.assignment_id = format!("dp2-{}", case.id);
    a.request_id = request.request.request_id.clone();
    a.request_hash = request_hash.clone();
    a.service = service.clone();
    a.quote.quote.quote_id = format!("dp2-quote-{}", case.id);
    a.quote.quote.request_hash = request_hash;
    a.quote.quote.service_hash = digest(&service).unwrap();
    a.quote.quote.milestones[0].deliverable = service.deliverables[0].clone();
    a.quote.authorization = crypto::sign(
        &agreement::claims(
            common::TEST_DOMAIN,
            &a.request_id,
            &digest(&a.quote.quote).unwrap(),
            &a.quote.quote.operator,
            "QUOTE",
        ),
        &keys[1],
    )
    .unwrap();
    a.acceptance[0].description =
        "Check that the CSV contains header item,value and all three agreed rows.".into();
    common::sign_root(&mut bundle, &keys);
    (bundle, trust, keys)
}

fn profile(
    provenance: binding::ProfileProvenance,
    points: [u32; 5],
    trust: &TrustConfiguration,
    key: &SigningKey,
) -> binding::SignedProfileV1 {
    let mut allocations = binding::balanced_allocations();
    for (allocation, points) in allocations.iter_mut().zip(points) {
        allocation.points = points as _;
    }
    let profile = binding::draft_profile(provenance, allocations, trust).unwrap();
    binding::SignedProfileV1 {
        authorization: crypto::sign(&binding::profile_claims(&profile, trust).unwrap(), key)
            .unwrap(),
        profile,
    }
}

fn submission(
    c: &case::DisputeCaseV1,
    trust: &TrustConfiguration,
    key: &SigningKey,
    role: Role,
    id: &str,
    text: &str,
) -> case::EvidenceItemV1 {
    let body = case::EvidenceSubmissionBodyV1 {
        version: "1".into(),
        case_id: c.case_id.clone(),
        submission_id: id.into(),
        author_role: role,
        agreement_hash: c.current_agreement_hash.clone(),
        context_hash: c.context_hash.clone().unwrap(),
        content_sha256: bytes_digest(text.as_bytes()),
        byte_length: text.len() as u64,
        media_type: "text/plain".into(),
        statement_kind: case::StatementKindV1::Claim,
        party_offer: None,
    };
    let signed = case::EvidenceSubmissionV1 {
        authorization: crypto::sign(
            &case::submission_claims(&body, &c.bundle, trust).unwrap(),
            key,
        )
        .unwrap(),
        body,
    };
    case::EvidenceItemV1 {
        id: id.into(),
        media_type: "text/plain".into(),
        content_sha256: bytes_digest(text.as_bytes()),
        byte_length: text.len() as u64,
        availability: case::EvidenceAvailabilityV1::Accessible {
            bytes_b64: crypto::encode_base64url(text.as_bytes()),
        },
        origin: case::EvidenceOriginV1::Submission {
            signed: Box::new(signed),
        },
        extractions: vec![],
        submitted_sensor_appraisal: None,
    }
}

fn package(
    definition: &ExperimentCase,
    props: &Value,
    version: u32,
    qwen: bool,
) -> pipeline::AnalysisPackageV1 {
    let mut identity = definition.clone();
    if version != 2 {
        identity.id = format!("v{version}-{}", definition.id);
    }
    if qwen {
        identity.id = format!("qwen-{}", identity.id);
    }
    let (bundle, trust, keys) = base(&identity);
    let request = bundle.requests[0].clone();
    let r = profile(
        binding::ProfileProvenance::Request {
            signed_request: request.clone(),
        },
        definition.requester_points,
        &trust,
        &keys[0],
    );
    let o = profile(
        binding::ProfileProvenance::Quote {
            signed_request: request,
            signed_quote: bundle.agreement.agreement.quote.clone(),
        },
        definition.operator_points,
        &trust,
        &keys[1],
    );
    let constructor = match version {
        2 => runtime::development_spec_v2,
        3 => runtime::development_spec_v3,
        4 => runtime::development_spec_v4,
        5 => runtime::development_spec_v5,
        _ => unreachable!("validated experiment version"),
    };
    let mut spec = constructor(
        binding::dictionary_digest().unwrap(),
        digest(&r.profile).unwrap(),
        digest(&o.profile).unwrap(),
    );
    spec.runtime_status = "PINNED_READY".into();
    spec.model_id=if qwen {"Qwen/Qwen3-4B-Instruct-2507; Unsloth Q4_K_M a06e946bb6b655725eafa393f4a9745d460374c9"} else {"HuggingFaceTB/SmolLM2-135M-Instruct; bartowski Q4_K_M 09816acd5d99df7be770d85ea30822623dab342c"}.into();
    spec.backend = "cuda".into();
    spec.threads = 2;
    spec.v2.as_mut().unwrap().cuda = Some(runtime::CudaProfileV2 {
        device: "CUDA0".into(),
        n_gpu_layers: 99,
    });
    spec.server_binary_sha256 = Some(BINARY_HASH.into());
    spec.gguf_sha256 = Some(if qwen { QWEN_HASH } else { MODEL_HASH }.into());
    spec.tokenizer_sha256 = spec.gguf_sha256.clone();
    spec.llama_cpp_build = Some(props["build_info"].as_str().unwrap().into());
    spec.chat_template_sha256 = Some(bytes_digest(
        props["chat_template"].as_str().unwrap().as_bytes(),
    ));
    spec.validate().unwrap();
    let context = binding::draft_context(
        &bundle,
        &digest(&bundle.agreement.agreement).unwrap(),
        r,
        o,
        serde_json::to_value(&spec).unwrap(),
        &trust,
    )
    .unwrap();
    let endorsements = [Role::Requester, Role::Operator, Role::Mediator]
        .into_iter()
        .enumerate()
        .map(|(i, role)| {
            crypto::sign(
                &binding::context_claims(&context, &bundle, &trust, role).unwrap(),
                &keys[i],
            )
            .unwrap()
        })
        .collect();
    let annex = binding::SignedDisputeContextV1 {
        context,
        endorsements,
    };
    let mut case = case::prepare_case(
        bundle,
        &trust,
        Some(&annex),
        &format!("dp2-{}", identity.id),
        vec!["milestone:work".into()],
    )
    .unwrap();
    let (r_id, o_id) = if definition.reverse_evidence_order {
        ("b-requester", "a-operator")
    } else {
        ("a-requester", "b-operator")
    };
    case.evidence.push(submission(
        &case,
        &trust,
        &keys[0],
        Role::Requester,
        r_id,
        &definition.requester_statement,
    ));
    case.evidence.push(submission(
        &case,
        &trust,
        &keys[1],
        Role::Operator,
        o_id,
        &definition.operator_statement,
    ));
    case.evidence.sort_by(|a, b| a.id.cmp(&b.id));
    pipeline::new_package(case, trust, annex, pipeline::ComputeBudget::development()).unwrap()
}

pub(super) fn run(args: &[String]) -> Result<()> {
    let (version, args) = if args.first().is_some_and(|a| a == "--spec-version") {
        let version = args
            .get(1)
            .ok_or("Missing specification version")?
            .parse::<u32>()?;
        if !(2..=5).contains(&version) {
            return Err("Supported experiment specification versions: 2 through 5".into());
        }
        (version, &args[2..])
    } else {
        (2, args)
    };
    let (qwen, args) = if args.first().is_some_and(|a| a == "--model") {
        let selected = args.get(1).ok_or("Missing model choice")?;
        if selected != "smol" && selected != "qwen" {
            return Err("Approved choices: smol or qwen".into());
        }
        (selected == "qwen", &args[2..])
    } else {
        (false, args)
    };
    if qwen && version < 3 {
        return Err(
            "The declared Qwen experiments use specification3 through specification5".into(),
        );
    }
    if !qwen && version >= 4 {
        return Err("Specifications4 and5 are declared for the approved Qwen evaluation".into());
    }
    let (model, model_hash) = if qwen {
        (QWEN, QWEN_HASH)
    } else {
        (MODEL, MODEL_HASH)
    };
    let experiment = if qwen { version } else { version - 1 };
    if args.len() != 2 || args[0] != "--run-in" {
        return Err("Usage: real_smoke --demo-dp2 [--spec-version 2|3|4|5] [--model smol|qwen] --run-in /existing/empty/capture-directory (explicit real GPU execution)".into());
    }
    if !cfg!(target_os = "linux") || env::var("NONVERBA_CONTAINER").as_deref() != Ok("1") {
        return Err("Use the existing managed Linux container".into());
    }
    let capture = PathBuf::from(&args[1]).canonicalize()?;
    if !capture.is_absolute() || !capture.is_dir() || fs::read_dir(&capture)?.next().is_some() {
        return Err(
            "Capture directory must exist and be empty; never overwrite an experiment".into(),
        );
    }
    if sha256(Path::new(BINARY))? != BINARY_HASH || sha256(Path::new(model))? != model_hash {
        return Err("Approved GPU binary/model pin mismatch".into());
    }
    let definitions = schedule();
    save(
        &capture,
        "experiment-plan.json",
        &json!({"id":format!("DP2-GPU-EXPERIMENT-{experiment}"),"specification_version":version,"model":model,"model_sha256":model_hash,"binary":BINARY,"binary_sha256":BINARY_HASH,"seed":17,"schedule":"all eight SINGLE attempts; no automatic retries or selection","context_tokens":8192,"max_output_tokens_per_stage":2048,"cases":definitions,"expected_observations_are_not_model_input":true,"financial_authority":"NONE","settlement_policy":"UNSPECIFIED","new_synthetic_assignment_per_variant_and_experiment":true,"factual_freeze":"clear/prerequisite variants differ only as explicitly listed; fixture IDs are newly signed","quality_review":"manual source/citation/issue coverage, question usefulness, priority relevance, variation sensitivity; never inferred from valid JSON"}),
    )?;
    let executable = env::current_exe()?;
    save(
        &capture,
        "driver-identity.json",
        &json!({"kind":"RUST_NATIVE_EXAMPLE_DP2","executable":executable,"executable_sha256":sha256(&executable)?,"debug_assertions":cfg!(debug_assertions),"hash_verification":"unchanged full artifact hashes before each call; server properties rechecked after generation"}),
    )?;
    let mut sources = Vec::new();
    for path in [
        "disputes/examples/real_smoke.rs",
        "disputes/examples/dp2/mod.rs",
        "disputes/src/pipeline.rs",
        "disputes/src/runtime.rs",
        "disputes/src/case.rs",
        "disputes/src/binding.rs",
    ] {
        let path = Path::new("/workspace/code").join(path);
        sources.push(json!({"path":path,"sha256":sha256(&path)?}));
    }
    for entry in fs::read_dir("/workspace/code/disputes/prompts")? {
        let path = entry?.path();
        if path.is_file() {
            sources.push(json!({"path":path,"sha256":sha256(&path)?}));
        }
    }
    save(&capture, "source-hashes.json", &sources)?;
    let reservation = TcpListener::bind("127.0.0.1:0")?;
    let endpoint = reservation.local_addr()?;
    let mut command = vec![
        BINARY.to_owned(),
        "--model".into(),
        model.into(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        endpoint.port().to_string(),
        "--ctx-size".into(),
        "8192".into(),
        "--parallel".into(),
        "1".into(),
        "--threads".into(),
        "2".into(),
        "--threads-batch".into(),
        "2".into(),
        "--device".into(),
        "CUDA0".into(),
        "--n-gpu-layers".into(),
        "99".into(),
        "--no-context-shift".into(),
        "--offline".into(),
        "--no-webui".into(),
        "--no-warmup".into(),
    ];
    if qwen {
        command.extend(["-lv".into(), "4".into()]);
    }
    save(&capture, "server-command.json", &command)?;
    drop(reservation);
    let mut server = logged(
        Command::new(BINARY).args(&command[1..]),
        &capture,
        "server.log",
    )?;
    let mut result = json!({"status":"STARTING","owned_server_pid":server.0.id(),"financial_authority":"NONE","execution_attested":false});
    let execution = (|| -> Result<()> {
        let deadline = Instant::now() + Duration::from_secs(45);
        loop {
            if let Some(status) = server.0.try_wait()? {
                return Err(format!("Server exited: {status}").into());
            }
            if get(endpoint, "/health").is_ok_and(|v| v["status"] == "ok") {
                break;
            }
            if Instant::now() >= deadline {
                return Err("GPU server startup deadline".into());
            }
            thread::sleep(Duration::from_millis(200));
        }
        let props = get(endpoint, "/props")?;
        save(&capture, "server-properties.json", &props)?;
        let admin = runtime::AdminRuntimeConfig {
            endpoint,
            model_path: PathBuf::from(model),
            server_binary_path: PathBuf::from(BINARY),
        };
        save(&capture, "admin-config.json", &admin)?;
        let backend = runtime::LlamaCppBackend::new(admin, runtime::CancellationToken::default())?;
        let mut summaries = Vec::new();
        for definition in definitions {
            let directory = capture.join(&definition.id);
            fs::create_dir(&directory)?;
            let mut package = package(&definition, &props, version, qwen);
            let trust = package.trust.clone();
            let before = pipeline::inspect_package(&package, &trust)?.base_financial_projection;
            let original = canonical(&package.cases[0].bundle)?;
            save(&directory, "before.json", &package)?;
            save(&directory, "independent-trust.json", &trust)?;
            let outcome = pipeline::run_schedule(
                &mut package,
                &backend,
                pipeline::RunMode::Single,
                &AtomicBool::new(false),
                |attempt| {
                    save(
                        &directory,
                        &format!("attempt-{}.json", attempt.schedule_index),
                        attempt,
                    )
                    .map_err(|e| e.to_string())
                },
            );
            save(&directory, "schedule-result.json", &outcome)?;
            save(&directory, "after.json", &package)?;
            let inspection = pipeline::inspect_package(&package, &trust)?;
            save(&directory, "inspection.json", &inspection)?;
            let export = pipeline::export_package(&package, &trust)?;
            save(&directory, "portable-export.json", &export)?;
            let replay = pipeline::replay(&export, &trust)?;
            save(&directory, "replay.json", &replay)?;
            let unchanged = inspection.base_financial_projection == before
                && canonical(&package.cases[0].bundle)? == original;
            let summary = json!({"id":definition.id,"schedule_ok":outcome.is_ok(),"attempts":package.attempts.len(),"analysis_package_valid":inspection.analysis_package_valid,"core_unchanged":unchanged,"consumption":pipeline::consumption(&package.attempts)?,"quality_review":"PENDING; structural success alone does not establish useful reasoning"});
            save(&directory, "summary.json", &summary)?;
            println!("{}", serde_json::to_string(&summary)?);
            summaries.push(summary);
            if !unchanged {
                return Err("Core changed during analysis".into());
            }
        }
        save(&capture, "execution-summaries.json", &summaries)?;
        result["status"] = json!("DECLARED_SCHEDULE_RETAINED_REQUIRES_QUALITY_REVIEW");
        Ok(())
    })();
    if let Err(error) = &execution {
        result["status"] = json!("FAILED_CAPTURE_RETAINED");
        result["error"] = json!(error.to_string());
    }
    match server.stop() {
        Ok(status) => {
            result["owned_server_stopped"] = json!(true);
            result["owned_server_exit"] = json!(status.to_string());
        }
        Err(error) => {
            result["owned_server_stopped"] = json!(false);
            result["cleanup_error"] = json!(error.to_string());
        }
    }
    save(&capture, "driver-result.json", &result)?;
    println!("{}", serde_json::to_string(&result)?);
    execution
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn declared_variants_are_valid_and_keep_frozen_facts_separate_from_research_labels() {
        let definitions = schedule();
        assert_eq!(definitions.len(), 8);
        let ids = definitions
            .iter()
            .map(|d| &d.id)
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(ids.len(), 8);
        let props = json!({"build_info":format!("b0-{}",runtime::LLAMA_CPP_COMMIT),"chat_template":"synthetic test template, no inference"});
        for definition in &definitions {
            assert_eq!(definition.requester_points.iter().sum::<u32>(), 250);
            assert_eq!(definition.operator_points.iter().sum::<u32>(), 250);
            let p = package(definition, &props, 2, false);
            let inspected = pipeline::inspect_package(&p, &p.trust).unwrap();
            assert!(
                inspected.analysis_package_valid,
                "{:?}",
                inspected.diagnostics
            );
            assert_eq!(p.cases[0].evidence.len(), 2);
            assert!(p.attempts.is_empty());
            assert!(
                !serde_json::to_string(&p)
                    .unwrap()
                    .contains("expected_observations_for_review_only")
            );
        }
        for variant in &definitions[1..3] {
            assert_eq!(
                variant.requester_statement,
                definitions[0].requester_statement
            );
            assert_eq!(
                variant.operator_statement,
                definitions[0].operator_statement
            );
        }
        assert_eq!(
            definitions[4].requester_statement,
            definitions[3].requester_statement
        );
        assert_eq!(
            definitions[4].operator_statement,
            definitions[3].operator_statement
        );
        assert!(definitions[4].reverse_evidence_order);
        let v3 = package(&definitions[0], &props, 3, false);
        assert!(
            pipeline::inspect_package(&v3, &v3.trust)
                .unwrap()
                .analysis_package_valid
        );
        assert_eq!(v3.specification.version, 3);
        assert_ne!(
            v3.cases[0].assignment_id,
            package(&definitions[0], &props, 2, false).cases[0].assignment_id
        );
        let qwen = package(&definitions[0], &props, 3, true);
        assert_eq!(qwen.specification.gguf_sha256.as_deref(), Some(QWEN_HASH));
        assert_ne!(qwen.cases[0].assignment_id, v3.cases[0].assignment_id);
        let v4 = package(&definitions[0], &props, 4, true);
        assert!(
            pipeline::inspect_package(&v4, &v4.trust)
                .unwrap()
                .analysis_package_valid
        );
        assert_eq!(v4.specification.version, 4);
        assert_ne!(v4.cases[0].assignment_id, qwen.cases[0].assignment_id);
        let v5 = package(&definitions[0], &props, 5, true);
        assert!(
            pipeline::inspect_package(&v5, &v5.trust)
                .unwrap()
                .analysis_package_valid
        );
        assert_ne!(v5.cases[0].assignment_id, v4.cases[0].assignment_id);
    }
}
