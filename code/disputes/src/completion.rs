// SPDX-License-Identifier: AGPL-3.0-only
//! Replaceable one-shot text completion.
//!
//! The pipeline depends on [`Backend`], not on a provider. A later provider is
//! another `Backend`. The Grok preset is one headless prompt: it launches no
//! tool-using session, and an unapproved config starts no process.
use crate::runtime::{
    AnalysisSpecificationV1, Backend, CancellationToken, InputStage, RawCompletion, RuntimeError,
    RuntimeProvenance, admission,
};
use nonverba_requests::encoding::bytes_digest;
use serde::Deserialize;
use serde_json::Value;
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const GROK_KIND: &str = "GROK_HEADLESS";
const RULES: &str =
    "Reply with only the requested JSON object. Do not call tools, read files, or change anything.";

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GrokHeadlessConfig {
    pub program: PathBuf,
    pub effort: String,
    pub approved: bool,
}

/// How the prompt is handed to a replacement process.
#[derive(Clone, Debug)]
pub enum PromptChannel {
    Stdin,
    /// Append this flag and the temporary prompt-file path.
    Flag(String),
}

/// How the process stdout becomes the completion text.
#[derive(Clone, Debug)]
pub enum OutputMode {
    /// Stdout is the completion text. Token counts stay zero.
    RawText,
    /// Stdout is a Grok headless JSON object with `text` and `usage`.
    GrokJson,
}

pub struct ProcessCompletionBackend {
    kind: &'static str,
    program: PathBuf,
    args: Vec<String>,
    channel: PromptChannel,
    output: OutputMode,
    claim: &'static str,
    approved: bool,
    cancellation: CancellationToken,
    env: Vec<(&'static str, &'static str)>,
}

impl ProcessCompletionBackend {
    pub fn new(
        kind: &'static str,
        program: PathBuf,
        args: Vec<String>,
        channel: PromptChannel,
        output: OutputMode,
        claim: &'static str,
        approved: bool,
        cancellation: CancellationToken,
    ) -> Result<Self, RuntimeError> {
        check_program(&program)?;
        if !hosted_kind(kind) {
            return Err(RuntimeError::new(
                "ADMIN_CONFIGURATION",
                "Completion kind must be a short uppercase token",
            ));
        }
        Ok(Self {
            kind,
            program,
            args,
            channel,
            output,
            claim,
            approved,
            cancellation,
            env: Vec::new(),
        })
    }
}

pub struct GrokHeadlessBackend {
    inner: ProcessCompletionBackend,
}

impl GrokHeadlessBackend {
    pub fn new(
        config: GrokHeadlessConfig,
        cancellation: CancellationToken,
    ) -> Result<Self, RuntimeError> {
        let _ = grok_headless_arguments(&config.effort)?;
        let mut inner = ProcessCompletionBackend::new(
            GROK_KIND,
            config.program,
            grok_headless_arguments(&config.effort)?,
            PromptChannel::Flag("--prompt-file".into()),
            OutputMode::GrokJson,
            "One-shot grok completion. Tools, subagents, and web search are disallowed. This is not execution attestation or a local pinned run.",
            config.approved,
            cancellation,
        )?;
        inner.env = vec![
            ("GROK_WEB_FETCH", "0"),
            ("GROK_WRITE_FILE", "0"),
            ("GROK_WORKFLOWS", "0"),
            ("GROK_LSP_TOOLS", "0"),
            ("GROK_BACKEND_SEARCH", "0"),
        ];
        Ok(Self { inner })
    }
}

/// Fixed guardrails for the current preset. Effort is only `low` or `minimal`.
pub fn grok_headless_arguments(effort: &str) -> Result<Vec<String>, RuntimeError> {
    if !matches!(effort, "low" | "minimal") {
        return Err(RuntimeError::new(
            "ADMIN_CONFIGURATION",
            "Grok completion effort must be low or minimal",
        ));
    }
    Ok(vec![
        "--max-turns".into(),
        "1".into(),
        "--effort".into(),
        effort.into(),
        "--verbatim".into(),
        "--output-format".into(),
        "json".into(),
        "--no-auto-update".into(),
        "--disable-web-search".into(),
        "--disallowed-tools".into(),
        "Agent,task,run_terminal_cmd,run_terminal_command,write,search_replace,web_search,web_fetch".into(),
        "--rules".into(),
        RULES.into(),
    ])
}

impl Backend for GrokHeadlessBackend {
    fn kind(&self) -> &'static str {
        GROK_KIND
    }
    fn generate(
        &self,
        stage: InputStage,
        prompt: &str,
        spec: &AnalysisSpecificationV1,
        seed: u32,
    ) -> Result<RawCompletion, RuntimeError> {
        if spec.authority_mode != "ANALYSIS_ONLY" {
            return Err(RuntimeError::new(
                "SPECIFICATION_MISMATCH",
                "Grok completion requires ANALYSIS_ONLY",
            ));
        }
        if spec.tools_enabled {
            return Err(RuntimeError::new(
                "SPECIFICATION_MISMATCH",
                "Grok completion refuses a tools-enabled specification",
            ));
        }
        self.inner.generate(stage, prompt, spec, seed)
    }
}

impl Backend for ProcessCompletionBackend {
    fn kind(&self) -> &'static str {
        self.kind
    }
    fn generate(
        &self,
        stage: InputStage,
        prompt: &str,
        spec: &AnalysisSpecificationV1,
        seed: u32,
    ) -> Result<RawCompletion, RuntimeError> {
        admission(prompt, spec, seed)?;
        if !self.approved {
            return Err(RuntimeError::new(
                "APPROVAL_REQUIRED",
                "Completion is not approved. No process was started.",
            ));
        }
        if self.cancellation.is_cancelled() {
            return Err(RuntimeError::new(
                "CANCELLED",
                "Cancelled before the completion process",
            ));
        }
        let started = Instant::now();
        let dir = prompt_dir()?;
        let _dir = PromptDir(dir.clone());
        let prompt_path = dir.join("prompt.txt");
        write_private(&prompt_path, prompt)?;
        let mut command = Command::new(&self.program);
        command
            .args(&self.args)
            .current_dir(&dir)
            .envs(self.env.iter().copied())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        match &self.channel {
            PromptChannel::Stdin => {
                command.stdin(Stdio::piped());
            }
            PromptChannel::Flag(flag) => {
                command.stdin(Stdio::null()).arg(flag).arg(&prompt_path);
            }
        }
        let mut child = command
            .spawn()
            .map_err(|_| RuntimeError::new("PROCESS_FAILED", "Completion process did not start"))?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let out_handle = thread::spawn(move || read_capped(stdout, 1_048_576));
        let err_handle = thread::spawn(move || read_capped(stderr, 8_192));
        if matches!(self.channel, PromptChannel::Stdin) {
            if let Some(mut stdin) = child.stdin.take() {
                stdin.write_all(prompt.as_bytes()).map_err(|_| {
                    RuntimeError::new("PROCESS_FAILED", "Could not write the prompt")
                })?;
            }
        }
        let deadline = started + Duration::from_millis(spec.timeout_ms.min(300_000));
        let status = loop {
            if self.cancellation.is_cancelled() {
                let _ = child.kill();
                let _ = child.wait();
                return Err(RuntimeError::new(
                    "CANCELLED",
                    "Cancelled while the completion process was running",
                ));
            }
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if Instant::now() >= deadline => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(RuntimeError::new(
                        "TIMEOUT",
                        "Completion process exceeded the specification timeout",
                    ));
                }
                Ok(None) => thread::sleep(Duration::from_millis(20)),
                Err(_) => {
                    return Err(RuntimeError::new(
                        "PROCESS_FAILED",
                        "Completion process could not be awaited",
                    ));
                }
            }
        };
        let stdout = String::from_utf8(out_handle.join().unwrap_or_default()).map_err(|_| {
            RuntimeError::new("MALFORMED_RESPONSE", "Completion stdout was not UTF-8")
        })?;
        let _stderr = err_handle.join().unwrap_or_default();
        if !status.success() {
            let mut error = RuntimeError::new(
                "PROCESS_FAILED",
                "Completion process exited without success",
            );
            error.raw_output = Some(clip(&stdout));
            error.elapsed_ms = elapsed(started);
            return Err(error);
        }
        let (text, input_tokens, output_tokens) = match self.output {
            OutputMode::RawText => (stdout, 0, 0),
            OutputMode::GrokJson => match grok_json(&stdout) {
                Ok(parsed) => parsed,
                Err(mut error) => {
                    error.elapsed_ms = elapsed(started);
                    return Err(error);
                }
            },
        };
        if text.len() > spec.max_output_bytes as usize {
            let mut error = RuntimeError::new(
                "OVERSIZED_OUTPUT",
                "Completion text exceeds the specification byte bound",
            );
            error.raw_output = Some(clip(&text));
            error.input_tokens = Some(input_tokens);
            error.output_tokens = Some(output_tokens);
            error.elapsed_ms = elapsed(started);
            return Err(error);
        }
        Ok(RawCompletion {
            text,
            input_tokens,
            output_tokens,
            elapsed_ms: elapsed(started),
            provenance: RuntimeProvenance {
                kind: self.kind.into(),
                specification_hash: spec
                    .digest()
                    .map_err(|message| RuntimeError::new("SPECIFICATION_MISMATCH", &message))?,
                prompt_sha256: bytes_digest(prompt.as_bytes()),
                formatted_prompt_sha256: None,
                input_stage: stage,
                seed,
                runtime_claim: self.claim.into(),
                artifacts_hash_checked: false,
                execution_attested: false,
                independently_rerun: false,
            },
        })
    }
}

fn grok_json(stdout: &str) -> Result<(String, u32, u32), RuntimeError> {
    let value: Value = serde_json::from_str(stdout.trim()).map_err(|_| {
        let mut error = RuntimeError::new(
            "MALFORMED_RESPONSE",
            "Grok completion was not a JSON object",
        );
        error.raw_output = Some(clip(stdout));
        error
    })?;
    let text = value
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| RuntimeError::new("MALFORMED_RESPONSE", "Grok completion has no text"))?
        .to_owned();
    if value.get("num_turns").and_then(Value::as_u64).unwrap_or(1) > 1 {
        let mut error =
            RuntimeError::new("TURNS_EXCEEDED", "Grok completion used more than one turn");
        error.raw_output = Some(clip(&text));
        return Err(error);
    }
    if value.get("stopReason").and_then(Value::as_str) == Some("max_tokens") {
        let mut error =
            RuntimeError::new("TRUNCATED_RESPONSE", "Grok completion hit the output limit");
        error.raw_output = Some(clip(&text));
        return Err(error);
    }
    let usage = value.get("usage").ok_or_else(|| {
        let mut error = RuntimeError::new(
            "USAGE_UNREPORTED",
            "Grok completion reported no token usage",
        );
        error.raw_output = Some(clip(&text));
        error
    })?;
    let input = usage_u64(usage, "input_tokens")?
        .saturating_add(
            usage
                .get("cache_read_input_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
        )
        .saturating_add(
            usage
                .get("cache_creation_input_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
        );
    let output = usage_u64(usage, "output_tokens")?;
    let input = u32::try_from(input)
        .map_err(|_| RuntimeError::new("USAGE_OVERFLOW", "Grok input token count does not fit"))?;
    let output = u32::try_from(output)
        .map_err(|_| RuntimeError::new("USAGE_OVERFLOW", "Grok output token count does not fit"))?;
    if text.is_empty() {
        return Err(RuntimeError::new(
            "EMPTY_RESPONSE",
            "Grok completion text was empty",
        ));
    }
    Ok((text, input, output))
}

fn usage_u64(usage: &Value, name: &str) -> Result<u64, RuntimeError> {
    usage.get(name).and_then(Value::as_u64).ok_or_else(|| {
        RuntimeError::new("USAGE_UNREPORTED", "Grok completion omitted a token count")
    })
}

fn hosted_kind(kind: &str) -> bool {
    !kind.is_empty()
        && kind.len() <= 32
        && kind
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
}

fn check_program(program: &Path) -> Result<(), RuntimeError> {
    let ok = !program.as_os_str().is_empty()
        && !program
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
        && (program.is_absolute() || program.components().count() == 1);
    if ok {
        Ok(())
    } else {
        Err(RuntimeError::new(
            "ADMIN_CONFIGURATION",
            "Completion program must be a command name or an absolute path",
        ))
    }
}

fn prompt_dir() -> Result<PathBuf, RuntimeError> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("nv-completion-{}-{nanos}", std::process::id()));
    fs::create_dir(&dir).map_err(|_| {
        RuntimeError::new(
            "PROCESS_FAILED",
            "Could not create the completion directory",
        )
    })?;
    Ok(dir)
}

fn write_private(path: &Path, prompt: &str) -> Result<(), RuntimeError> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .and_then(|mut file| file.write_all(prompt.as_bytes()))
        .map_err(|_| RuntimeError::new("PROCESS_FAILED", "Could not write the prompt file"))
}

fn read_capped(pipe: Option<impl Read>, cap: usize) -> Vec<u8> {
    let Some(mut pipe) = pipe else {
        return Vec::new();
    };
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let read = match pipe.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        };
        if buf.len() >= cap {
            continue;
        }
        let room = cap - buf.len();
        buf.extend_from_slice(&chunk[..read.min(room)]);
    }
    buf
}

fn clip(text: &str) -> String {
    text.chars().take(8_000).collect()
}

fn elapsed(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

struct PromptDir(PathBuf);
impl Drop for PromptDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
