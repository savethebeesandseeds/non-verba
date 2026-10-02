// SPDX-License-Identifier: AGPL-3.0-only
use nonverba_disputes::runtime::*;
use nonverba_requests::encoding::{bytes_digest, strict_parse};
use serde_json::{Value, json};
use std::{
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpListener},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

fn spec() -> AnalysisSpecificationV1 {
    development_spec("1".repeat(64), "2".repeat(64), "3".repeat(64))
}
fn upgrade_to_v2(spec: &mut AnalysisSpecificationV1) {
    upgrade_to_version(spec, 2);
}
fn upgrade_to_version(spec: &mut AnalysisSpecificationV1, version: u32) {
    let constructor = match version {
        5 => development_spec_v5,
        4 => development_spec_v4,
        3 => development_spec_v3,
        _ => development_spec_v2,
    };
    let template =
        serde_json::to_value(constructor("1".repeat(64), "2".repeat(64), "3".repeat(64))).unwrap();
    let mut value = serde_json::to_value(&spec).unwrap();
    for name in [
        "version",
        "v2",
        "qualitative_prompt_version",
        "evidence_prompt_sha256",
        "prior_prompt_sha256",
        "output_schema_sha256",
    ] {
        value[name] = template[name].clone();
    }
    *spec = serde_json::from_value(value).unwrap();
}
fn output() -> String {
    json!({"issues":[],"questions":[],"prior_comparisons":[],"alternatives":[],"unresolved_reasons":["Settlement policy is unspecified"]}).to_string()
}
fn prompt() -> String {
    format!("{EVIDENCE_PROMPT}\nUNTRUSTED_CASE_DATA_JSON\n{{}}\nEND_UNTRUSTED_CASE_DATA\n")
}

#[test]
fn missing_artifacts_are_explicit_not_fabricated_provenance() {
    let s = spec();
    s.validate().unwrap();
    assert_eq!(s.context_tokens, 8192);
    assert_eq!(s.max_output_tokens, 2048);
    assert_eq!(s.runtime_status, "MODEL_UNAVAILABLE");
    assert!(s.gguf_sha256.is_none());
    let e = UnavailableBackend
        .generate(InputStage::Evidence, &prompt(), &s, 17)
        .unwrap_err();
    assert_eq!(e.code, "MODEL_UNAVAILABLE");
    assert!(e.raw_output.is_none());
}

#[test]
fn specification_rejects_authority_schema_provenance_and_policy_substitution() {
    for (name, value) in [
        ("authority_mode", json!("SETTLE")),
        ("settlement_policy_status", json!("AVERAGE")),
        ("output_schema_sha256", json!("4".repeat(64))),
        ("prior_prompt_sha256", json!("4".repeat(64))),
        ("runtime_status", json!("PINNED_READY")),
        ("gguf_sha256", json!("4".repeat(64))),
        ("context_shift", json!(true)),
        ("tools_enabled", json!(true)),
        ("offline", json!(false)),
        ("seeds", json!([17, 17, 43])),
        ("parallel_slots", json!(4)),
        ("redaction_policy", json!("secret-case-v1")),
        ("llama_cpp_commit", json!("master")),
        ("max_input_tokens", json!(8192)),
        ("adapter_sha256s", json!(["4".repeat(64)])),
    ] {
        let mut v = serde_json::to_value(spec()).unwrap();
        v[name] = value;
        assert!(
            serde_json::from_value::<AnalysisSpecificationV1>(v)
                .unwrap()
                .validate()
                .is_err(),
            "{name}"
        );
    }
    let mut v = serde_json::to_value(spec()).unwrap();
    v["endpoint"] = json!("https://cloud.example");
    assert!(serde_json::from_value::<AnalysisSpecificationV1>(v).is_err());
    let a = spec();
    let mut b = a.clone();
    b.seeds = vec![5, 7, 9];
    assert_ne!(a.digest().unwrap(), b.digest().unwrap());
}

#[test]
fn versions_pin_distinct_stage_schemas_and_reject_implicit_cuda_or_v2_extensions() {
    let historical: Value = serde_json::from_str(include_str!(
        "fixtures/historical-v1/analysis-specification.json"
    ))
    .unwrap();
    let legacy: AnalysisSpecificationV1 = serde_json::from_value(historical.clone()).unwrap();
    legacy.validate().unwrap();
    assert_eq!(serde_json::to_value(&legacy).unwrap(), historical);
    assert!(serde_json::to_value(spec()).unwrap().get("v2").is_none());
    let mut null_extension = serde_json::to_value(spec()).unwrap();
    null_extension["v2"] = Value::Null;
    assert!(serde_json::from_value::<AnalysisSpecificationV1>(null_extension).is_err());
    let mut v2 = development_spec_v2("1".repeat(64), "2".repeat(64), "3".repeat(64));
    v2.validate().unwrap();
    assert_ne!(
        output_schema_for(&v2, InputStage::Evidence),
        output_schema_for(&v2, InputStage::PriorComparison)
    );
    assert_eq!(
        output_schema_bundle(&v2)["evidence"],
        output_schema_for(&v2, InputStage::Evidence)
    );
    assert_ne!(v2.output_schema_sha256, spec().output_schema_sha256);
    let valid_cpu = v2.clone();
    v2.backend = "cuda".into();
    assert!(v2.validate().is_err());
    v2.v2.as_mut().unwrap().cuda = Some(CudaProfileV2 {
        device: "CUDA0".into(),
        n_gpu_layers: 99,
    });
    v2.validate().unwrap();
    let cuda_hash = v2.digest().unwrap();
    v2.v2.as_mut().unwrap().cuda.as_mut().unwrap().n_gpu_layers = 31;
    assert_ne!(cuda_hash, v2.digest().unwrap());
    v2.v2.as_mut().unwrap().cuda.as_mut().unwrap().n_gpu_layers = 0;
    assert!(v2.validate().is_err());
    for field in [
        "model_input_projection_version",
        "evidence_schema_sha256",
        "comparison_schema_sha256",
    ] {
        let mut bad = serde_json::to_value(&valid_cpu).unwrap();
        bad["v2"][field] = json!("unsupported");
        assert!(crate_spec_validate(&bad).is_err());
    }
    let mut mixed = valid_cpu;
    mixed.version = 1;
    assert!(mixed.validate().is_err());
}

#[test]
fn version_three_is_an_explicit_new_experiment_and_cannot_relabel_v2() {
    let v2 = development_spec_v2("1".repeat(64), "2".repeat(64), "3".repeat(64));
    let v3 = development_spec_v3("1".repeat(64), "2".repeat(64), "3".repeat(64));
    v2.validate().unwrap();
    v3.validate().unwrap();
    for draft in [&v2, &v3] {
        assert!(draft.model_id.ends_with("runtime pins not selected)"));
        assert_eq!(draft.runtime_status, "MODEL_UNAVAILABLE");
        assert!(draft.gguf_sha256.is_none());
    }
    assert_eq!(v3.version, 3);
    assert_eq!(
        v3.v2.as_ref().unwrap().model_input_projection_version,
        MODEL_INPUT_PROJECTION_V3
    );
    assert_eq!(evidence_prompt(&v2), EVIDENCE_PROMPT_V2);
    assert_eq!(evidence_prompt(&v3), EVIDENCE_PROMPT_V3);
    assert_eq!(prior_prompt(&v2), PRIOR_PROMPT_V2);
    assert_eq!(prior_prompt(&v3), PRIOR_PROMPT_V3);
    assert_ne!(v2.digest().unwrap(), v3.digest().unwrap());
    assert_ne!(v2.output_schema_sha256, v3.output_schema_sha256);
    let mut changed = v2.clone();
    changed.version = 3;
    assert!(changed.validate().is_err());
    let mut changed = v3.clone();
    changed.v2 = v2.v2.clone();
    assert!(changed.validate().is_err());
    for stage in [InputStage::Evidence, InputStage::PriorComparison] {
        assert_ne!(output_schema_for(&v2, stage), output_schema_for(&v3, stage));
    }
}

#[test]
fn version_four_requires_its_exact_pins_and_preserves_runtime_bounds() {
    let v3 = development_spec_v3("1".repeat(64), "2".repeat(64), "3".repeat(64));
    let v4 = development_spec_v4("1".repeat(64), "2".repeat(64), "3".repeat(64));
    v3.validate().unwrap();
    v4.validate().unwrap();
    assert_eq!(v4.version, 4);
    assert_eq!(v4.runtime_status, "MODEL_UNAVAILABLE");
    assert!(v4.gguf_sha256.is_none());
    assert_eq!(v4.max_output_tokens, 2048);
    assert_eq!(v4.context_tokens, v3.context_tokens);
    assert_eq!(v4.max_input_tokens, v3.max_input_tokens);
    assert_eq!(v4.timeout_ms, v3.timeout_ms);
    assert_eq!(v4.seeds, v3.seeds);
    assert_eq!(v4.authority_mode, "ANALYSIS_ONLY");
    assert_eq!(v4.settlement_policy_status, "UNSPECIFIED");
    assert_eq!(evidence_prompt(&v4), EVIDENCE_PROMPT_V4);
    assert_eq!(prior_prompt(&v4), PRIOR_PROMPT_V4);
    assert_eq!(
        v4.v2.as_ref().unwrap().model_input_projection_version,
        MODEL_INPUT_PROJECTION_V4
    );
    assert_ne!(v3.digest().unwrap(), v4.digest().unwrap());
    assert_ne!(v3.output_schema_sha256, v4.output_schema_sha256);
    let mut relabeled = v3.clone();
    relabeled.version = 4;
    assert!(relabeled.validate().is_err());
    let mut mixed = v4.clone();
    mixed.v2 = v3.v2.clone();
    assert!(mixed.validate().is_err());
    for field in [
        "evidence_prompt_sha256",
        "prior_prompt_sha256",
        "output_schema_sha256",
    ] {
        let mut value = serde_json::to_value(&v4).unwrap();
        value[field] = serde_json::to_value(&v3).unwrap()[field].clone();
        assert!(crate_spec_validate(&value).is_err());
    }
    let mut unsupported = v4;
    unsupported.version = 6;
    assert!(unsupported.validate().is_err());
}

#[test]
fn version_five_changes_only_its_declared_profile_and_requires_exact_hashes() {
    let v4 = development_spec_v4("1".repeat(64), "2".repeat(64), "3".repeat(64));
    let v5 = development_spec_v5("1".repeat(64), "2".repeat(64), "3".repeat(64));
    v4.validate().unwrap();
    v5.validate().unwrap();
    assert_eq!(v5.version, 5);
    assert_eq!(evidence_prompt(&v5), EVIDENCE_PROMPT_V5);
    assert_eq!(prior_prompt(&v5), PRIOR_PROMPT_V5);
    assert_eq!(
        v5.v2.as_ref().unwrap().model_input_projection_version,
        MODEL_INPUT_PROJECTION_V5
    );
    let mut comparison = v5.clone();
    comparison.version = v4.version;
    comparison.v2 = v4.v2.clone();
    comparison.qualitative_prompt_version = v4.qualitative_prompt_version.clone();
    comparison.evidence_prompt_sha256 = v4.evidence_prompt_sha256.clone();
    comparison.prior_prompt_sha256 = v4.prior_prompt_sha256.clone();
    comparison.output_schema_sha256 = v4.output_schema_sha256.clone();
    assert_eq!(comparison, v4);
    let mut relabeled = v4;
    relabeled.version = 5;
    assert!(relabeled.validate().is_err());
    for field in [
        "evidence_prompt_sha256",
        "prior_prompt_sha256",
        "output_schema_sha256",
    ] {
        let mut value = serde_json::to_value(&v5).unwrap();
        value[field] = json!("0".repeat(64));
        assert!(crate_spec_validate(&value).is_err());
    }
    for field in ["evidence_schema_sha256", "comparison_schema_sha256"] {
        let mut value = serde_json::to_value(&v5).unwrap();
        value["v2"][field] = json!("0".repeat(64));
        assert!(crate_spec_validate(&value).is_err());
    }
}

fn crate_spec_validate(value: &Value) -> Result<(), String> {
    nonverba_disputes::spec::validate_spec_value(value)
}

#[test]
fn mocks_are_labeled_and_do_not_retry_or_execute_output() {
    let backend = MockBackend::new(vec![Ok(output()), Ok("{\"tool\":\"shell\"}".into())]);
    let first = backend
        .generate(InputStage::Evidence, &prompt(), &spec(), 17)
        .unwrap();
    assert_eq!(first.provenance.kind, "MOCK");
    assert!(!first.provenance.execution_attested);
    assert!(!first.provenance.artifacts_hash_checked);
    // Raw model output is not an action. The application's ordinary validator rejects its schema.
    assert!(
        backend
            .generate(InputStage::Evidence, &prompt(), &spec(), 29)
            .unwrap()
            .text
            .contains("shell")
    );
    assert_eq!(
        backend
            .generate(InputStage::Evidence, &prompt(), &spec(), 43)
            .unwrap_err()
            .code,
        "MOCK_EXHAUSTED"
    );
}

#[test]
fn admin_configuration_cannot_redirect_to_cloud_or_vaults() {
    let mut admin = AdminRuntimeConfig::loopback(
        PathBuf::from("/opt/nonverba-build/models/test.gguf"),
        PathBuf::from("/opt/nonverba-tools/llama.cpp/bin/llama-server"),
    );
    admin.endpoint = "192.0.2.1:8087".parse().unwrap();
    assert!(LlamaCppBackend::new(admin.clone(), CancellationToken::default()).is_err());
    admin.endpoint = "127.0.0.1:8087".parse().unwrap();
    admin.model_path = PathBuf::from("/workspace/requester.vault.json");
    assert!(LlamaCppBackend::new(admin.clone(), CancellationToken::default()).is_err());
    admin.model_path = PathBuf::from("/opt/nonverba-build/models/../requester.gguf");
    assert!(LlamaCppBackend::new(admin, CancellationToken::default()).is_err());
}

static SERIAL: AtomicU64 = AtomicU64::new(0);
struct Fixture {
    admin: AdminRuntimeConfig,
    spec: AnalysisSpecificationV1,
}
impl Fixture {
    fn new(endpoint: SocketAddr) -> Self {
        assert_eq!(
            std::env::var("NONVERBA_CONTAINER").as_deref(),
            Ok("1"),
            "Run runtime tests only in managed Debian"
        );
        let id = format!(
            "disputes-runtime-test-{}-{}",
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::SeqCst)
        );
        let model = PathBuf::from(format!("/opt/nonverba-build/models/{id}.gguf"));
        let binary = PathBuf::from(format!("/opt/nonverba-tools/llama.cpp/{id}/llama-server"));
        fs::create_dir_all(model.parent().unwrap()).unwrap();
        fs::create_dir_all(binary.parent().unwrap()).unwrap();
        // Mock HTTP protocol fixtures, deliberately not executable runtimes or usable model weights.
        fs::write(&model, b"GGUF-mock-protocol-fixture").unwrap();
        fs::write(&binary, b"\x7fELF-mock-protocol-fixture").unwrap();
        let mut s = spec();
        s.runtime_status = "PINNED_READY".into();
        s.gguf_sha256 = Some(bytes_digest(b"GGUF-mock-protocol-fixture"));
        s.tokenizer_sha256 = s.gguf_sha256.clone();
        s.server_binary_sha256 = Some(bytes_digest(b"\x7fELF-mock-protocol-fixture"));
        s.chat_template_sha256 = Some(bytes_digest(b"test-template"));
        s.llama_cpp_build = Some("b-test-14a9d09".into());
        Self {
            admin: AdminRuntimeConfig {
                endpoint,
                model_path: model,
                server_binary_path: binary,
            },
            spec: s,
        }
    }
    fn props(&self) -> Value {
        json!({"build_info":self.spec.llama_cpp_build,"model_path":self.admin.model_path,
        "chat_template":"test-template","total_slots":1,"default_generation_settings":{"n_ctx":8192}})
    }
    fn backend(&self, token: CancellationToken) -> LlamaCppBackend {
        LlamaCppBackend::new(self.admin.clone(), token).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_file(&self.admin.model_path).unwrap();
        fs::remove_file(&self.admin.server_binary_path).unwrap();
        fs::remove_dir(self.admin.server_binary_path.parent().unwrap()).unwrap();
    }
}

type Observations = Arc<Mutex<Vec<(String, Value)>>>;
fn server(listener: TcpListener, replies: Vec<Value>) -> (thread::JoinHandle<()>, Observations) {
    let observed = Arc::new(Mutex::new(vec![]));
    let result = observed.clone();
    let thread = thread::spawn(move || {
        listener.set_nonblocking(true).unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        for reply in replies {
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        if Instant::now() > deadline {
                            return;
                        }
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(e) => panic!("{e}"),
                }
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(1)))
                .unwrap();
            let mut request = vec![];
            let mut buf = [0u8; 4096];
            let (offset, length) = loop {
                let n = stream.read(&mut buf).unwrap();
                if n == 0 {
                    return;
                }
                request.extend_from_slice(&buf[..n]);
                if let Some(p) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                    let h = std::str::from_utf8(&request[..p]).unwrap();
                    let len = h
                        .lines()
                        .find_map(|line| line.strip_prefix("Content-Length: "))
                        .unwrap()
                        .parse::<usize>()
                        .unwrap();
                    if request.len() >= p + 4 + len {
                        break (p + 4, len);
                    }
                }
            };
            let path = std::str::from_utf8(&request[..offset])
                .unwrap()
                .split_whitespace()
                .nth(1)
                .unwrap()
                .to_string();
            let body = if length == 0 {
                Value::Null
            } else {
                serde_json::from_slice(&request[offset..offset + length]).unwrap()
            };
            result.lock().unwrap().push((path, body));
            let bytes = serde_json::to_vec(&reply).unwrap();
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",bytes.len()).unwrap();
            stream.write_all(&bytes).unwrap();
        }
    });
    (thread, observed)
}
fn complete(text: String) -> Value {
    json!({"content":text,"truncated":false,"stop_type":"eos","tokens_predicted":30,"tokens_evaluated":3})
}

#[test]
fn protocol_mock_counts_complete_template_and_sends_exact_token_ids() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let f = Fixture::new(listener.local_addr().unwrap());
    let (server, requests) = server(
        listener,
        vec![
            f.props(),
            json!({"prompt":"template + system + all case text"}),
            json!({"tokens":[1,2,3]}),
            complete(output()),
            f.props(),
        ],
    );
    let result = f
        .backend(CancellationToken::default())
        .generate(InputStage::Evidence, &prompt(), &f.spec, 17)
        .unwrap();
    server.join().unwrap();
    let requests = requests.lock().unwrap();
    assert_eq!(
        requests.iter().map(|(p, _)| p.as_str()).collect::<Vec<_>>(),
        [
            "/props",
            "/apply-template",
            "/tokenize",
            "/completion",
            "/props"
        ]
    );
    assert_eq!(requests[1].1["messages"][0]["content"], EVIDENCE_PROMPT);
    assert_eq!(
        requests[2].1["content"],
        "template + system + all case text"
    );
    assert_eq!(requests[3].1["prompt"], json!([1, 2, 3]));
    assert_eq!(requests[3].1["cache_prompt"], false);
    assert!(requests[3].1.get("tools").is_none());
    assert_eq!(requests[3].1["json_schema"], output_schema());
    assert_eq!(result.input_tokens, 3);
    assert_eq!(result.output_tokens, 30);
    // This tests the local HTTP adapter against a fake server, not model quality or real provenance.
    assert!(!result.provenance.execution_attested);
    assert!(!result.provenance.independently_rerun);
}

#[test]
fn versioned_runtime_counts_each_complete_stage_and_dispatches_its_pinned_schema() {
    for (version, stage) in [
        (2, InputStage::Evidence),
        (2, InputStage::PriorComparison),
        (3, InputStage::Evidence),
        (3, InputStage::PriorComparison),
        (4, InputStage::Evidence),
        (4, InputStage::PriorComparison),
        (5, InputStage::Evidence),
        (5, InputStage::PriorComparison),
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let mut fixture = Fixture::new(listener.local_addr().unwrap());
        upgrade_to_version(&mut fixture.spec, version);
        let system = match stage {
            InputStage::Evidence => evidence_prompt(&fixture.spec),
            InputStage::PriorComparison => prior_prompt(&fixture.spec),
        };
        let (server, requests) = server(
            listener,
            vec![
                fixture.props(),
                json!({"prompt":"entire independently formatted stage"}),
                json!({"tokens":[11,12,13]}),
                complete("{}".into()),
                fixture.props(),
            ],
        );
        let prompt = format!("{system}\nUNTRUSTED_CASE_DATA_JSON\n{{}}\nEND_UNTRUSTED_CASE_DATA\n");
        let result = fixture
            .backend(CancellationToken::default())
            .generate(stage, &prompt, &fixture.spec, 17)
            .unwrap();
        server.join().unwrap();
        let requests = requests.lock().unwrap();
        assert_eq!(requests[1].1["messages"][0]["content"], system);
        assert_eq!(
            requests[2].1["content"],
            "entire independently formatted stage"
        );
        assert_eq!(requests[3].1["prompt"], json!([11, 12, 13]));
        assert_eq!(
            requests[3].1["json_schema"],
            output_schema_for(&fixture.spec, stage)
        );
        assert_eq!(result.input_tokens, 3);
        assert_eq!(result.provenance.input_stage, stage);
    }
}

#[test]
fn version_two_comparison_overflow_is_independent_and_never_generates() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let mut fixture = Fixture::new(listener.local_addr().unwrap());
    upgrade_to_v2(&mut fixture.spec);
    fixture.spec.max_input_tokens = 2;
    let (server, requests) = server(
        listener,
        vec![
            fixture.props(),
            json!({"prompt":"template plus first interpretation plus profiles"}),
            json!({"tokens":[1,2,3]}),
        ],
    );
    let prompt = format!("{}\nprojected comparison", prior_prompt(&fixture.spec));
    let error = fixture
        .backend(CancellationToken::default())
        .generate(InputStage::PriorComparison, &prompt, &fixture.spec, 17)
        .unwrap_err();
    server.join().unwrap();
    assert_eq!(error.code, "CONTEXT_OVERFLOW");
    assert_eq!(error.input_tokens, Some(3));
    assert_eq!(requests.lock().unwrap().len(), 3);
}

#[test]
fn cuda_profile_rejects_cpu_artifact_paths_before_network_access() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let mut fixture = Fixture::new(listener.local_addr().unwrap());
    upgrade_to_v2(&mut fixture.spec);
    fixture.spec.backend = "cuda".into();
    fixture.spec.v2.as_mut().unwrap().cuda = Some(CudaProfileV2 {
        device: "CUDA0".into(),
        n_gpu_layers: 99,
    });
    let prompt = format!("{}\nprojected evidence", evidence_prompt(&fixture.spec));
    let error = fixture
        .backend(CancellationToken::default())
        .generate(InputStage::Evidence, &prompt, &fixture.spec, 17)
        .unwrap_err();
    assert_eq!(error.code, "SPECIFICATION_MISMATCH");
    // Administrative GPU paths are admitted only under the one pinned CUDA build.
    let admin = AdminRuntimeConfig::loopback(
        PathBuf::from("/usr/local/share/nonverba/models/test.gguf"),
        PathBuf::from(format!("{CUDA_RUNTIME_ROOT}/llama-server")),
    );
    assert!(LlamaCppBackend::new(admin.clone(), CancellationToken::default()).is_ok());
    let mut wrong = admin;
    wrong.server_binary_path =
        PathBuf::from("/usr/local/lib/nonverba/llama.cpp/unpinned/build-cuda/bin/llama-server");
    assert!(LlamaCppBackend::new(wrong, CancellationToken::default()).is_err());
}

#[test]
fn oversized_full_template_is_rejected_before_generation() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let mut f = Fixture::new(listener.local_addr().unwrap());
    f.spec.max_input_tokens = 2;
    let (server, requests) = server(
        listener,
        vec![
            f.props(),
            json!({"prompt":"all overhead"}),
            json!({"tokens":[1,2,3]}),
        ],
    );
    let error = f
        .backend(CancellationToken::default())
        .generate(InputStage::Evidence, &prompt(), &f.spec, 17)
        .unwrap_err();
    server.join().unwrap();
    assert_eq!(error.code, "CONTEXT_OVERFLOW");
    assert_eq!(requests.lock().unwrap().len(), 3);
}

#[test]
fn wrong_artifact_or_server_identity_refuses_inference() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let mut f = Fixture::new(listener.local_addr().unwrap());
    f.spec.gguf_sha256 = Some("a".repeat(64));
    f.spec.tokenizer_sha256 = f.spec.gguf_sha256.clone();
    assert_eq!(
        f.backend(CancellationToken::default())
            .generate(InputStage::Evidence, &prompt(), &f.spec, 17)
            .unwrap_err()
            .code,
        "ARTIFACT_MISMATCH"
    );
    f.spec.gguf_sha256 = Some(bytes_digest(b"GGUF-mock-protocol-fixture"));
    f.spec.tokenizer_sha256 = f.spec.gguf_sha256.clone();
    let mut wrong = f.props();
    wrong["build_info"] = json!("different-runtime");
    let (server, requests) = server(listener, vec![wrong]);
    assert_eq!(
        f.backend(CancellationToken::default())
            .generate(InputStage::Evidence, &prompt(), &f.spec, 17)
            .unwrap_err()
            .code,
        "RUNTIME_MISMATCH"
    );
    server.join().unwrap();
    assert_eq!(requests.lock().unwrap().len(), 1);
}

#[test]
fn malformed_and_truncated_outputs_are_retained_as_failures() {
    for text in ["{broken", "{\"issues\":[],\"issues\":[]}"] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let f = Fixture::new(listener.local_addr().unwrap());
        let (server, _) = server(
            listener,
            vec![
                f.props(),
                json!({"prompt":"full"}),
                json!({"tokens":[1,2,3]}),
                complete(text.into()),
            ],
        );
        let error = f
            .backend(CancellationToken::default())
            .generate(InputStage::Evidence, &prompt(), &f.spec, 17)
            .unwrap_err();
        server.join().unwrap();
        assert_eq!(error.code, "MALFORMED_OUTPUT");
        assert_eq!(error.raw_output.as_deref(), Some(text));
    }
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let f = Fixture::new(listener.local_addr().unwrap());
    let mut response = complete(output());
    response["stop_type"] = json!("limit");
    let (server, _) = server(
        listener,
        vec![
            f.props(),
            json!({"prompt":"full"}),
            json!({"tokens":[1,2,3]}),
            response,
        ],
    );
    let error = f
        .backend(CancellationToken::default())
        .generate(InputStage::Evidence, &prompt(), &f.spec, 17)
        .unwrap_err();
    server.join().unwrap();
    assert_eq!(error.code, "TRUNCATED_RESPONSE");
    assert!(error.raw_output.is_some());
}

#[test]
fn cancellation_and_total_timeout_terminate_waiting_without_retry() {
    for cancel in [true, false] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let mut f = Fixture::new(listener.local_addr().unwrap());
        f.spec.timeout_ms = 150;
        let token = CancellationToken::default();
        let cancel_token = token.clone();
        let server = thread::spawn(move || {
            let (_socket, _) = listener.accept().unwrap();
            if cancel {
                cancel_token.cancel();
            }
            thread::sleep(Duration::from_millis(300));
        });
        let start = Instant::now();
        let error = f
            .backend(token)
            .generate(InputStage::Evidence, &prompt(), &f.spec, 17)
            .unwrap_err();
        assert!(start.elapsed() < Duration::from_secs(1));
        assert_eq!(error.code, if cancel { "CANCELLED" } else { "TIMEOUT" });
        server.join().unwrap();
    }
}

#[test]
fn absent_server_is_not_replaced_by_cloud() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let f = Fixture::new(listener.local_addr().unwrap());
    drop(listener);
    assert_eq!(
        f.backend(CancellationToken::default())
            .generate(InputStage::Evidence, &prompt(), &f.spec, 17)
            .unwrap_err()
            .code,
        "SERVER_UNAVAILABLE"
    );
}

#[test]
fn concurrent_inference_is_rejected_and_cancellation_discards_active_response() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let f = Fixture::new(listener.local_addr().unwrap());
    let token = CancellationToken::default();
    let backend = Arc::new(f.backend(token.clone()));
    let other = backend.clone();
    let spec = f.spec.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    let server = thread::spawn(move || {
        let (_stream, _) = listener.accept().unwrap();
        tx.send(()).unwrap();
        thread::sleep(Duration::from_millis(200));
    });
    let active = thread::spawn(move || other.generate(InputStage::Evidence, &prompt(), &spec, 17));
    rx.recv_timeout(Duration::from_secs(2)).unwrap();
    assert_eq!(
        backend
            .generate(InputStage::Evidence, "other", &f.spec, 29)
            .unwrap_err()
            .code,
        "BUSY"
    );
    token.cancel();
    assert_eq!(active.join().unwrap().unwrap_err().code, "CANCELLED");
    server.join().unwrap();
}

#[test]
fn redirect_and_invalid_http_framing_never_trigger_fallback() {
    for (headers, expected) in [
        (
            "HTTP/1.1 302 Found\r\nLocation: https://example.invalid\r\nContent-Length: 0\r\n\r\n",
            "SERVER_REJECTED",
        ),
        (
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 9\r\n\r\n{}",
            "TRUNCATED_RESPONSE",
        ),
        (
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
            "HTTP_PROTOCOL",
        ),
        (
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n{}",
            "HTTP_PROTOCOL",
        ),
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let f = Fixture::new(listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 2048];
            assert!(stream.read(&mut buf).unwrap() > 0);
            stream.write_all(headers.as_bytes()).unwrap();
        });
        let error = f
            .backend(CancellationToken::default())
            .generate(InputStage::Evidence, &prompt(), &f.spec, 17)
            .unwrap_err();
        server.join().unwrap();
        assert_eq!(error.code, expected);
    }
}

/// Explicit opt-in only. Administrator supplies an existing pinned server; no downloads/launch.
#[test]
#[ignore = "NOT RUN / MODEL UNAVAILABLE unless an administrator provisions the pinned local runtime and GGUF"]
fn real_model_smoke_opt_in() {
    assert_eq!(std::env::var("NONVERBA_CONTAINER").as_deref(), Ok("1"));
    let config = std::env::var("NONVERBA_LLAMA_ADMIN_CONFIG")
        .expect("Set administrator JSON path inside Debian");
    let specification =
        std::env::var("NONVERBA_LLAMA_SPEC").expect("Set exact pinned specification path");
    let admin: AdminRuntimeConfig = strict_parse(&fs::read(config).unwrap()).unwrap();
    let spec: AnalysisSpecificationV1 = strict_parse(&fs::read(specification).unwrap()).unwrap();
    let result = LlamaCppBackend::new(admin, CancellationToken::default())
        .unwrap()
        .generate(InputStage::Evidence, &prompt(), &spec, spec.seeds[0])
        .unwrap();
    println!("{}", serde_json::to_string(&result).unwrap());
    assert_eq!(result.provenance.kind, "LOCAL_LLAMA_CPP");
    assert!(strict_parse::<Value>(result.text.as_bytes()).is_ok());
}
