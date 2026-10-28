// SPDX-License-Identifier: AGPL-3.0-only
use nonverba_disputes::{
    completion::{
        GrokHeadlessBackend, GrokHeadlessConfig, OutputMode, ProcessCompletionBackend,
        PromptChannel, grok_headless_arguments,
    },
    runtime::{Backend, CancellationToken, InputStage, development_spec},
};
use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf};

fn spec() -> nonverba_disputes::runtime::AnalysisSpecificationV1 {
    development_spec("1".repeat(64), "2".repeat(64), "3".repeat(64))
}

#[test]
fn grok_preset_is_one_turn_and_rejects_a_larger_effort() {
    let args = grok_headless_arguments("low").unwrap();
    let has = |flag: &str, value: &str| {
        args.windows(2)
            .any(|pair| pair[0] == flag && pair[1] == value)
    };
    assert!(has("--max-turns", "1"));
    assert!(has("--effort", "low"));
    assert!(args.iter().any(|arg| arg == "--verbatim"));
    assert!(args.iter().any(|arg| arg == "--disable-web-search"));
    assert!(args.iter().any(|arg| arg.contains("Agent")));
    assert!(
        !args
            .iter()
            .any(|arg| arg == "--yolo" || arg.contains("always-approve"))
    );
    assert!(grok_headless_arguments("high").is_err());
    assert!(grok_headless_arguments("xhigh").is_err());
}

#[test]
fn unapproved_grok_config_starts_no_process() {
    let marker = std::env::temp_dir().join(format!("nv-grok-unapproved-{}", std::process::id()));
    let script = std::env::temp_dir().join(format!("nv-grok-unapproved-{}.sh", std::process::id()));
    let _ = fs::remove_file(&marker);
    fs::write(&script, format!("#!/bin/sh\ntouch {}\n", marker.display())).unwrap();
    let mut permissions = fs::metadata(&script).unwrap().permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&script, permissions).unwrap();
    let backend = GrokHeadlessBackend::new(
        GrokHeadlessConfig {
            program: script.clone(),
            effort: "minimal".into(),
            approved: false,
        },
        CancellationToken::default(),
    )
    .unwrap();
    let error = backend
        .generate(InputStage::Evidence, "prompt", &spec(), 17)
        .unwrap_err();
    assert_eq!(error.code, "APPROVAL_REQUIRED");
    assert!(!marker.exists());
    let _ = fs::remove_file(script);
}

#[test]
fn process_completion_returns_stdout_and_grok_usage() {
    let spec = spec();
    let raw = ProcessCompletionBackend::new(
        "GROK_HEADLESS",
        PathBuf::from("/bin/sh"),
        vec!["-c".into(), "cat".into()],
        PromptChannel::Stdin,
        OutputMode::RawText,
        "test process",
        true,
        CancellationToken::default(),
    )
    .unwrap()
    .generate(InputStage::Evidence, "same-words", &spec, 17)
    .unwrap();
    assert_eq!(raw.text, "same-words");
    assert!(!raw.provenance.execution_attested);
    assert_eq!(raw.provenance.kind, "GROK_HEADLESS");

    let json = r#"{"text":"alpha","stopReason":"end_turn","num_turns":1,"usage":{"input_tokens":2,"cache_read_input_tokens":5,"output_tokens":3}}"#;
    let parsed = ProcessCompletionBackend::new(
        "GROK_HEADLESS",
        PathBuf::from("/bin/sh"),
        vec!["-c".into(), format!("printf '%s' '{json}'")],
        PromptChannel::Stdin,
        OutputMode::GrokJson,
        "test process",
        true,
        CancellationToken::default(),
    )
    .unwrap()
    .generate(InputStage::PriorComparison, "ignored", &spec, 29)
    .unwrap();
    assert_eq!(parsed.text, "alpha");
    assert_eq!(parsed.input_tokens, 7);
    assert_eq!(parsed.output_tokens, 3);
    assert!(!parsed.provenance.artifacts_hash_checked);

    let error = ProcessCompletionBackend::new(
        "GROK_HEADLESS",
        PathBuf::from("/bin/sh"),
        vec![
            "-c".into(),
            format!("printf '%s' '{{\"text\":\"alpha\",\"num_turns\":2,\"usage\":{{\"input_tokens\":1,\"output_tokens\":1}}}}'"),
        ],
        PromptChannel::Stdin,
        OutputMode::GrokJson,
        "test process",
        true,
        CancellationToken::default(),
    )
    .unwrap()
    .generate(InputStage::Evidence, "ignored", &spec, 43)
    .unwrap_err();
    assert_eq!(error.code, "TURNS_EXCEEDED");
}
