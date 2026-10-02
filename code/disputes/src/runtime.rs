// SPDX-License-Identifier: AGPL-3.0-only
//! Bounded native local inference; no signing, process launch, downloads or tool dispatch.
//! Server and build observations are attributed execution claims, not attestation.
use nonverba_requests::encoding::{bytes_digest, digest, strict_parse, validate_digest};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    fs::File,
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

pub const LLAMA_CPP_COMMIT: &str = "14a9d09f75683c94c2c4f229efe54670d4209089";
pub const EVIDENCE_PROMPT: &str = include_str!("../prompts/evidence-v1.txt");
pub const PRIOR_PROMPT: &str = include_str!("../prompts/prior-comparison-v1.txt");
pub const OUTPUT_SCHEMA: &str = include_str!("../prompts/output-v1.schema.json");
pub const EVIDENCE_PROMPT_V2: &str = include_str!("../prompts/evidence-v2.txt");
pub const PRIOR_PROMPT_V2: &str = include_str!("../prompts/prior-comparison-v2.txt");
pub const EVIDENCE_SCHEMA_V2: &str = include_str!("../prompts/evidence-v2.schema.json");
pub const PRIOR_SCHEMA_V2: &str = include_str!("../prompts/prior-comparison-v2.schema.json");
pub const MODEL_INPUT_PROJECTION_V2: &str = "nv-reasoning-projection-v2";
pub const EVIDENCE_PROMPT_V3: &str = include_str!("../prompts/evidence-v3.txt");
pub const PRIOR_PROMPT_V3: &str = include_str!("../prompts/prior-comparison-v3.txt");
pub const EVIDENCE_SCHEMA_V3: &str = include_str!("../prompts/evidence-v3.schema.json");
pub const PRIOR_SCHEMA_V3: &str = include_str!("../prompts/prior-comparison-v3.schema.json");
pub const MODEL_INPUT_PROJECTION_V3: &str = "nv-reasoning-projection-v3";
pub const EVIDENCE_PROMPT_V4: &str = include_str!("../prompts/evidence-v4.txt");
pub const PRIOR_PROMPT_V4: &str = include_str!("../prompts/prior-comparison-v4.txt");
pub const EVIDENCE_SCHEMA_V4: &str = include_str!("../prompts/evidence-v4.schema.json");
pub const PRIOR_SCHEMA_V4: &str = include_str!("../prompts/prior-comparison-v4.schema.json");
pub const MODEL_INPUT_PROJECTION_V4: &str = "nv-reasoning-projection-v4";
pub const EVIDENCE_PROMPT_V5: &str = include_str!("../prompts/evidence-v5.txt");
pub const PRIOR_PROMPT_V5: &str = include_str!("../prompts/prior-comparison-v5.txt");
pub const EVIDENCE_SCHEMA_V5: &str = include_str!("../prompts/evidence-v5.schema.json");
pub const PRIOR_SCHEMA_V5: &str = include_str!("../prompts/prior-comparison-v5.schema.json");
pub const MODEL_INPUT_PROJECTION_V5: &str = "nv-reasoning-projection-v5";
pub const CUDA_RUNTIME_ROOT: &str =
    "/usr/local/lib/nonverba/llama.cpp/14a9d09f75683c94c2c4f229efe54670d4209089/build-cuda/bin";
pub const DEFAULT_SEEDS: [u32; 3] = [17, 29, 43];
const MAX_HTTP_BYTES: usize = 2 * 1024 * 1024;
const MAX_HEADER_BYTES: usize = 16 * 1024;
const POLL: Duration = Duration::from_millis(50);

pub fn output_schema() -> Value {
    serde_json::from_str(OUTPUT_SCHEMA).expect("compiled schema is valid")
}

pub fn evidence_prompt(spec: &AnalysisSpecificationV1) -> &'static str {
    match spec.version {
        5 => EVIDENCE_PROMPT_V5,
        4 => EVIDENCE_PROMPT_V4,
        3 => EVIDENCE_PROMPT_V3,
        2 => EVIDENCE_PROMPT_V2,
        _ => EVIDENCE_PROMPT,
    }
}
pub fn prior_prompt(spec: &AnalysisSpecificationV1) -> &'static str {
    match spec.version {
        5 => PRIOR_PROMPT_V5,
        4 => PRIOR_PROMPT_V4,
        3 => PRIOR_PROMPT_V3,
        2 => PRIOR_PROMPT_V2,
        _ => PRIOR_PROMPT,
    }
}
fn schema_text(spec: &AnalysisSpecificationV1, stage: InputStage) -> &'static str {
    match (spec.version, stage) {
        (5, InputStage::Evidence) => EVIDENCE_SCHEMA_V5,
        (5, InputStage::PriorComparison) => PRIOR_SCHEMA_V5,
        (4, InputStage::Evidence) => EVIDENCE_SCHEMA_V4,
        (4, InputStage::PriorComparison) => PRIOR_SCHEMA_V4,
        (3, InputStage::Evidence) => EVIDENCE_SCHEMA_V3,
        (3, InputStage::PriorComparison) => PRIOR_SCHEMA_V3,
        (2, InputStage::Evidence) => EVIDENCE_SCHEMA_V2,
        (2, InputStage::PriorComparison) => PRIOR_SCHEMA_V2,
        _ => OUTPUT_SCHEMA,
    }
}
pub fn output_schema_for(spec: &AnalysisSpecificationV1, stage: InputStage) -> Value {
    serde_json::from_str(schema_text(spec, stage)).expect("compiled versioned schema is valid")
}
/// The versioned package pins both stage schemas; each call uses only its own.
pub fn output_schema_bundle(spec: &AnalysisSpecificationV1) -> Value {
    if spec.version == 1 {
        return output_schema();
    }
    json!({"evidence":output_schema_for(spec,InputStage::Evidence),
        "prior_comparison":output_schema_for(spec,InputStage::PriorComparison)})
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CudaProfileV2 {
    /// Explicit administrator launch setting; not established by server /props.
    pub device: String,
    pub n_gpu_layers: u32,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeProfileV2 {
    pub model_input_projection_version: String,
    pub evidence_schema_sha256: String,
    pub comparison_schema_sha256: String,
    pub cuda: Option<CudaProfileV2>,
}

fn deserialize_v2<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<RuntimeProfileV2>, D::Error> {
    // Missing is defaulted for historical v1. Explicit null is never a v1 extension.
    RuntimeProfileV2::deserialize(deserializer).map(Some)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SamplingSettings {
    pub temperature: f64,
    pub top_k: u32,
    pub top_p: f64,
    pub min_p: f64,
    pub repeat_penalty: f64,
    /// This exact chain is the only supported sampler profile in v1.
    pub samplers: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AnalysisSpecificationV1 {
    pub version: u32,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_v2"
    )]
    pub v2: Option<RuntimeProfileV2>,
    pub authority_mode: String,
    pub settlement_policy_status: String,
    pub runtime_status: String,
    pub llama_cpp_commit: String,
    pub llama_cpp_build: Option<String>,
    pub server_binary_sha256: Option<String>,
    pub backend: String,
    pub threads: u32,
    pub parallel_slots: u32,
    pub context_shift: bool,
    pub offline: bool,
    pub tools_enabled: bool,
    pub model_id: String,
    pub gguf_sha256: Option<String>,
    pub quantization: String,
    pub adapter_sha256s: Vec<String>,
    pub tokenizer_id: String,
    /// The tokenizer is embedded in and pinned by the complete GGUF bytes.
    pub tokenizer_sha256: Option<String>,
    pub chat_template_sha256: Option<String>,
    pub evidence_prompt_sha256: String,
    pub prior_prompt_sha256: String,
    pub output_schema_sha256: String,
    pub qualitative_prompt_version: String,
    pub dictionary_hash: String,
    pub requester_profile_hash: String,
    pub operator_profile_hash: String,
    pub context_tokens: u32,
    pub max_input_tokens: u32,
    pub max_output_tokens: u32,
    pub max_prompt_bytes: u32,
    pub max_output_bytes: u32,
    pub timeout_ms: u64,
    pub seeds: Vec<u32>,
    pub sampling: SamplingSettings,
    pub evidence_selection_policy: String,
    pub evidence_ordering_policy: String,
    pub extraction_policy: String,
    pub redaction_policy: String,
}

/// An editable specification draft. None is honest missing provenance, not a hash.
pub fn development_spec(
    dictionary_hash: String,
    requester_profile_hash: String,
    operator_profile_hash: String,
) -> AnalysisSpecificationV1 {
    AnalysisSpecificationV1 {
        version: 1,
        v2: None,
        authority_mode: "ANALYSIS_ONLY".into(),
        settlement_policy_status: "UNSPECIFIED".into(),
        runtime_status: "MODEL_UNAVAILABLE".into(),
        llama_cpp_commit: LLAMA_CPP_COMMIT.into(),
        llama_cpp_build: None,
        server_binary_sha256: None,
        backend: "cpu".into(),
        threads: 4,
        parallel_slots: 1,
        context_shift: false,
        offline: true,
        tools_enabled: false,
        model_id: "Qwen/Qwen3-4B-Instruct-2507 (evaluation candidate; not installed)".into(),
        gguf_sha256: None,
        quantization: "Q4_K_M".into(),
        adapter_sha256s: vec![],
        tokenizer_id: "gguf-embedded-v1".into(),
        tokenizer_sha256: None,
        chat_template_sha256: None,
        evidence_prompt_sha256: bytes_digest(EVIDENCE_PROMPT.as_bytes()),
        prior_prompt_sha256: bytes_digest(PRIOR_PROMPT.as_bytes()),
        output_schema_sha256: bytes_digest(OUTPUT_SCHEMA.as_bytes()),
        qualitative_prompt_version: "nv-qualitative-comparison-v1".into(),
        dictionary_hash,
        requester_profile_hash,
        operator_profile_hash,
        context_tokens: 8192,
        max_input_tokens: 6144,
        max_output_tokens: 2048,
        max_prompt_bytes: 512 * 1024,
        max_output_bytes: 64 * 1024,
        timeout_ms: 120_000,
        seeds: DEFAULT_SEEDS.to_vec(),
        sampling: SamplingSettings {
            temperature: 0.2,
            top_k: 40,
            top_p: 0.9,
            min_p: 0.05,
            repeat_penalty: 1.0,
            samplers: vec![
                "top_k".into(),
                "top_p".into(),
                "min_p".into(),
                "temperature".into(),
            ],
        },
        evidence_selection_policy: "explicit-shared-manifest-v1".into(),
        evidence_ordering_policy: "stable-item-id-v1".into(),
        extraction_policy: "attributed-text-only-v1".into(),
        redaction_policy: "explicit-shared-omissions-v1".into(),
    }
}

/// A new specification draft; never mutates or reinterprets a signed v1 context.
pub fn development_spec_v2(
    dictionary_hash: String,
    requester_profile_hash: String,
    operator_profile_hash: String,
) -> AnalysisSpecificationV1 {
    let mut spec = development_spec(
        dictionary_hash,
        requester_profile_hash,
        operator_profile_hash,
    );
    spec.version = 2;
    spec.model_id =
        "Qwen/Qwen3-4B-Instruct-2507 (evaluation candidate; runtime pins not selected)".into();
    spec.v2 = Some(RuntimeProfileV2 {
        model_input_projection_version: MODEL_INPUT_PROJECTION_V2.into(),
        evidence_schema_sha256: bytes_digest(EVIDENCE_SCHEMA_V2.as_bytes()),
        comparison_schema_sha256: bytes_digest(PRIOR_SCHEMA_V2.as_bytes()),
        cuda: None,
    });
    spec.qualitative_prompt_version = "nv-qualitative-comparison-v2".into();
    spec.evidence_prompt_sha256 = bytes_digest(EVIDENCE_PROMPT_V2.as_bytes());
    spec.prior_prompt_sha256 = bytes_digest(PRIOR_PROMPT_V2.as_bytes());
    spec.output_schema_sha256 =
        digest(&output_schema_bundle(&spec)).expect("compiled schema bundle can be hashed");
    spec
}

/// Disclosed engineering iteration; v1 and v2 byte pins remain unchanged.
pub fn development_spec_v3(
    dictionary_hash: String,
    requester_profile_hash: String,
    operator_profile_hash: String,
) -> AnalysisSpecificationV1 {
    let mut spec = development_spec_v2(
        dictionary_hash,
        requester_profile_hash,
        operator_profile_hash,
    );
    spec.version = 3;
    let profile = spec.v2.as_mut().expect("versioned profile exists");
    profile.model_input_projection_version = MODEL_INPUT_PROJECTION_V3.into();
    profile.evidence_schema_sha256 = bytes_digest(EVIDENCE_SCHEMA_V3.as_bytes());
    profile.comparison_schema_sha256 = bytes_digest(PRIOR_SCHEMA_V3.as_bytes());
    spec.qualitative_prompt_version = "nv-qualitative-comparison-v3".into();
    spec.evidence_prompt_sha256 = bytes_digest(EVIDENCE_PROMPT_V3.as_bytes());
    spec.prior_prompt_sha256 = bytes_digest(PRIOR_PROMPT_V3.as_bytes());
    spec.output_schema_sha256 =
        digest(&output_schema_bundle(&spec)).expect("compiled schema bundle can be hashed");
    spec
}

/// A new v4 specification; all earlier version pins remain independently valid.
pub fn development_spec_v4(
    dictionary_hash: String,
    requester_profile_hash: String,
    operator_profile_hash: String,
) -> AnalysisSpecificationV1 {
    let mut spec = development_spec_v3(
        dictionary_hash,
        requester_profile_hash,
        operator_profile_hash,
    );
    spec.version = 4;
    let profile = spec.v2.as_mut().expect("versioned profile exists");
    profile.model_input_projection_version = MODEL_INPUT_PROJECTION_V4.into();
    profile.evidence_schema_sha256 = bytes_digest(EVIDENCE_SCHEMA_V4.as_bytes());
    profile.comparison_schema_sha256 = bytes_digest(PRIOR_SCHEMA_V4.as_bytes());
    spec.qualitative_prompt_version = "nv-qualitative-comparison-v4".into();
    spec.evidence_prompt_sha256 = bytes_digest(EVIDENCE_PROMPT_V4.as_bytes());
    spec.prior_prompt_sha256 = bytes_digest(PRIOR_PROMPT_V4.as_bytes());
    spec.output_schema_sha256 =
        digest(&output_schema_bundle(&spec)).expect("compiled schema bundle can be hashed");
    spec
}

/// A new v5 specification; no prior signed specification is upgraded implicitly.
pub fn development_spec_v5(
    dictionary_hash: String,
    requester_profile_hash: String,
    operator_profile_hash: String,
) -> AnalysisSpecificationV1 {
    let mut spec = development_spec_v4(
        dictionary_hash,
        requester_profile_hash,
        operator_profile_hash,
    );
    spec.version = 5;
    let profile = spec.v2.as_mut().expect("versioned profile exists");
    profile.model_input_projection_version = MODEL_INPUT_PROJECTION_V5.into();
    profile.evidence_schema_sha256 = bytes_digest(EVIDENCE_SCHEMA_V5.as_bytes());
    profile.comparison_schema_sha256 = bytes_digest(PRIOR_SCHEMA_V5.as_bytes());
    spec.qualitative_prompt_version = "nv-qualitative-comparison-v5".into();
    spec.evidence_prompt_sha256 = bytes_digest(EVIDENCE_PROMPT_V5.as_bytes());
    spec.prior_prompt_sha256 = bytes_digest(PRIOR_PROMPT_V5.as_bytes());
    spec.output_schema_sha256 =
        digest(&output_schema_bundle(&spec)).expect("compiled schema bundle can be hashed");
    spec
}

impl AnalysisSpecificationV1 {
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(self.version, 1..=5)
            || self.authority_mode != "ANALYSIS_ONLY"
            || self.settlement_policy_status != "UNSPECIFIED"
            || !matches!(
                self.runtime_status.as_str(),
                "MODEL_UNAVAILABLE" | "PINNED_READY"
            )
            || self.llama_cpp_commit != LLAMA_CPP_COMMIT
            || !(1..=64).contains(&self.threads)
            || self.parallel_slots != 1
            || self.context_shift
            || !self.offline
            || self.tools_enabled
            || self.model_id.is_empty()
            || self.model_id.len() > 256
            || self.quantization != "Q4_K_M"
            || !self.adapter_sha256s.is_empty()
            || self.tokenizer_id != "gguf-embedded-v1"
        {
            return Err("ANALYSIS_SPEC: unsupported runtime, identity or authority profile".into());
        }
        match (self.version, &self.v2) {
            (1, None)
                if self.backend == "cpu"
                    && self.qualitative_prompt_version == "nv-qualitative-comparison-v1" => {}
            (2..=5, Some(profile))
                if self.qualitative_prompt_version
                    == match self.version {
                        5 => "nv-qualitative-comparison-v5",
                        4 => "nv-qualitative-comparison-v4",
                        3 => "nv-qualitative-comparison-v3",
                        _ => "nv-qualitative-comparison-v2",
                    }
                    && profile.model_input_projection_version
                        == match self.version {
                            5 => MODEL_INPUT_PROJECTION_V5,
                            4 => MODEL_INPUT_PROJECTION_V4,
                            3 => MODEL_INPUT_PROJECTION_V3,
                            _ => MODEL_INPUT_PROJECTION_V2,
                        }
                    && profile.evidence_schema_sha256
                        == bytes_digest(schema_text(self, InputStage::Evidence).as_bytes())
                    && profile.comparison_schema_sha256
                        == bytes_digest(
                            schema_text(self, InputStage::PriorComparison).as_bytes(),
                        ) =>
            {
                match (self.backend.as_str(), &profile.cuda) {
                    ("cpu", None) => (),
                    ("cuda", Some(cuda))
                        if cuda.device == "CUDA0" && (1..=999).contains(&cuda.n_gpu_layers) => {}
                    _ => {
                        return Err(
                            "ANALYSIS_SPEC: backend differs from explicit v2 execution profile"
                                .into(),
                        );
                    }
                }
            }
            _ => {
                return Err(
                    "ANALYSIS_SPEC: incompatible version, projection, schemas or backend profile"
                        .into(),
                );
            }
        }
        for hash in [
            &self.dictionary_hash,
            &self.requester_profile_hash,
            &self.operator_profile_hash,
        ] {
            validate_digest(hash)?;
        }
        for hash in [
            &self.gguf_sha256,
            &self.server_binary_sha256,
            &self.tokenizer_sha256,
            &self.chat_template_sha256,
        ]
        .into_iter()
        .flatten()
        {
            validate_digest(hash)?;
        }
        let expected_schema = if self.version != 1 {
            digest(&output_schema_bundle(self))?
        } else {
            bytes_digest(OUTPUT_SCHEMA.as_bytes())
        };
        if self.evidence_prompt_sha256 != bytes_digest(evidence_prompt(self).as_bytes())
            || self.prior_prompt_sha256 != bytes_digest(prior_prompt(self).as_bytes())
            || self.output_schema_sha256 != expected_schema
        {
            return Err("ANALYSIS_SPEC: unsupported prompt or output schema digest".into());
        }
        let ready = self.runtime_status == "PINNED_READY";
        let identities = [
            &self.gguf_sha256,
            &self.server_binary_sha256,
            &self.tokenizer_sha256,
            &self.chat_template_sha256,
        ];
        if ready && (identities.iter().any(|x| x.is_none()) || self.llama_cpp_build.is_none())
            || !ready && (identities.iter().any(|x| x.is_some()) || self.llama_cpp_build.is_some())
            || self.gguf_sha256 != self.tokenizer_sha256
        {
            return Err("ANALYSIS_SPEC: incomplete or contradictory artifact provenance".into());
        }
        if let Some(build) = &self.llama_cpp_build {
            let suffix = build.rsplit('-').next().unwrap_or("");
            if build.len() > 128
                || !build.starts_with('b')
                || suffix.len() < 7
                || !LLAMA_CPP_COMMIT.starts_with(suffix)
            {
                return Err(
                    "ANALYSIS_SPEC: build does not identify pinned llama.cpp commit".into(),
                );
            }
        }
        if !(512..=32768).contains(&self.context_tokens)
            || self.max_input_tokens == 0
            || self.max_output_tokens == 0
            || self.max_output_tokens > 4096
            || self
                .max_input_tokens
                .checked_add(self.max_output_tokens)
                .is_none_or(|n| n > self.context_tokens)
            || !(1..=512 * 1024).contains(&self.max_prompt_bytes)
            || !(128..=64 * 1024).contains(&self.max_output_bytes)
            || !(100..=300_000).contains(&self.timeout_ms)
            || self.seeds.len() != 3
            || self.seeds.contains(&u32::MAX)
            || self.seeds[0] == self.seeds[1]
            || self.seeds[0] == self.seeds[2]
            || self.seeds[1] == self.seeds[2]
        {
            return Err(
                "ANALYSIS_SPEC: invalid resource bounds or fixed three-seed schedule".into(),
            );
        }
        let s = &self.sampling;
        if !s.temperature.is_finite()
            || !(0.0..=2.0).contains(&s.temperature)
            || !(1..=200).contains(&s.top_k)
            || !s.top_p.is_finite()
            || !(0.01..=1.0).contains(&s.top_p)
            || !s.min_p.is_finite()
            || !(0.0..=1.0).contains(&s.min_p)
            || s.repeat_penalty != 1.0
            || s.samplers != ["top_k", "top_p", "min_p", "temperature"]
            || self.evidence_selection_policy != "explicit-shared-manifest-v1"
            || self.evidence_ordering_policy != "stable-item-id-v1"
            || self.extraction_policy != "attributed-text-only-v1"
            || self.redaction_policy != "explicit-shared-omissions-v1"
        {
            return Err("ANALYSIS_SPEC: unsupported sampling or evidence inclusion policy".into());
        }
        Ok(())
    }
    pub fn digest(&self) -> Result<String, String> {
        self.validate()?;
        digest(self)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InputStage {
    Evidence,
    PriorComparison,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeProvenance {
    pub kind: String,
    pub specification_hash: String,
    pub prompt_sha256: String,
    pub formatted_prompt_sha256: Option<String>,
    pub input_stage: InputStage,
    pub seed: u32,
    pub runtime_claim: String,
    pub artifacts_hash_checked: bool,
    pub execution_attested: bool,
    pub independently_rerun: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawCompletion {
    pub text: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub elapsed_ms: u64,
    pub provenance: RuntimeProvenance,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeError {
    pub code: String,
    pub message: String,
    pub raw_output: Option<String>,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub elapsed_ms: u64,
}
impl RuntimeError {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            raw_output: None,
            input_tokens: None,
            output_tokens: None,
            elapsed_ms: 0,
        }
    }
}
impl std::fmt::Display for RuntimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for RuntimeError {}

pub trait Backend: Send + Sync {
    /// Execution-kind label for retained attempts, including failures without output.
    /// This declaration is a runner claim and supplies no execution attestation.
    fn kind(&self) -> &'static str {
        "UNSPECIFIED"
    }
    fn generate(
        &self,
        stage: InputStage,
        prompt: &str,
        spec: &AnalysisSpecificationV1,
        seed: u32,
    ) -> Result<RawCompletion, RuntimeError>;
}

#[derive(Clone, Default)]
pub struct CancellationToken(Arc<AtomicBool>);
impl CancellationToken {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

pub struct UnavailableBackend;
impl Backend for UnavailableBackend {
    fn kind(&self) -> &'static str {
        "UNAVAILABLE"
    }
    fn generate(
        &self,
        _: InputStage,
        _: &str,
        _: &AnalysisSpecificationV1,
        _: u32,
    ) -> Result<RawCompletion, RuntimeError> {
        Err(RuntimeError::new(
            "MODEL_UNAVAILABLE",
            "Local pinned runtime/model are unavailable; inference NOT RUN. No cloud fallback.",
        ))
    }
}

/// Tests and replay must never label this backend as a real model execution.
pub struct MockBackend {
    responses: Mutex<VecDeque<Result<String, RuntimeError>>>,
}
impl MockBackend {
    pub fn new(responses: Vec<Result<String, RuntimeError>>) -> Self {
        Self {
            responses: Mutex::new(responses.into()),
        }
    }
}
impl Backend for MockBackend {
    fn kind(&self) -> &'static str {
        "MOCK"
    }
    fn generate(
        &self,
        stage: InputStage,
        prompt: &str,
        spec: &AnalysisSpecificationV1,
        seed: u32,
    ) -> Result<RawCompletion, RuntimeError> {
        admission(prompt, spec, seed)?;
        let text = self
            .responses
            .lock()
            .map_err(|_| RuntimeError::new("MOCK_FAILURE", "Mock lock failed"))?
            .pop_front()
            .ok_or_else(|| {
                RuntimeError::new("MOCK_EXHAUSTED", "No scripted response; no automatic retry")
            })??;
        Ok(RawCompletion {
            text,
            input_tokens: 0,
            output_tokens: 0,
            elapsed_ms: 0,
            provenance: RuntimeProvenance {
                kind: "MOCK".into(),
                specification_hash: spec.digest().map_err(spec_error)?,
                prompt_sha256: bytes_digest(prompt.as_bytes()),
                formatted_prompt_sha256: None,
                input_stage: stage,
                seed,
                runtime_claim: "Scripted text; token counts are zero, not measured inference"
                    .into(),
                artifacts_hash_checked: false,
                execution_attested: false,
                independently_rerun: false,
            },
        })
    }
}

/// Construct only from local administrator configuration, never dispute/model input.
/// The path allowlists deliberately exclude the workspace and signing vaults.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdminRuntimeConfig {
    pub endpoint: SocketAddr,
    pub model_path: PathBuf,
    pub server_binary_path: PathBuf,
}
impl AdminRuntimeConfig {
    pub fn loopback(model_path: PathBuf, server_binary_path: PathBuf) -> Self {
        Self {
            endpoint: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 8087),
            model_path,
            server_binary_path,
        }
    }
    fn validate(&self) -> Result<(), RuntimeError> {
        if !self.endpoint.ip().is_loopback() || self.endpoint.port() == 0 {
            return Err(RuntimeError::new(
                "ADMIN_CONFIGURATION",
                "Only a fixed numeric loopback endpoint is supported",
            ));
        }
        allowed_path(&self.model_path, true)?;
        allowed_path(&self.server_binary_path, false)?;
        Ok(())
    }
}

fn allowed_path(path: &Path, model: bool) -> Result<(), RuntimeError> {
    let roots: &[&str] = if model {
        &[
            "/opt/nonverba-models",
            "/opt/nonverba-tools/models",
            "/opt/nonverba-build/models",
            "/usr/local/share/nonverba/models",
        ]
    } else {
        &[
            "/opt/nonverba-tools/llama.cpp",
            "/opt/nonverba-tools/llama-cpp",
            CUDA_RUNTIME_ROOT,
        ]
    };
    if !path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        || !roots.iter().any(|root| path.starts_with(root))
        || model && path.extension().is_none_or(|ext| ext != "gguf")
        || !model && path.file_name().is_none_or(|name| name != "llama-server")
    {
        return Err(RuntimeError::new(
            "ADMIN_CONFIGURATION",
            "Artifact path is outside the dedicated runtime/model directories",
        ));
    }
    Ok(())
}

pub struct LlamaCppBackend {
    admin: AdminRuntimeConfig,
    cancellation: CancellationToken,
    busy: AtomicBool,
}
impl LlamaCppBackend {
    pub fn new(
        admin: AdminRuntimeConfig,
        cancellation: CancellationToken,
    ) -> Result<Self, RuntimeError> {
        if !cfg!(target_os = "linux") || std::env::var("NONVERBA_CONTAINER").as_deref() != Ok("1") {
            return Err(RuntimeError::new(
                "CONTAINER_REQUIRED",
                "Run local inference only inside the managed Linux development container",
            ));
        }
        admin.validate()?;
        Ok(Self {
            admin,
            cancellation,
            busy: AtomicBool::new(false),
        })
    }
    fn check(&self, deadline: Instant) -> Result<(), RuntimeError> {
        if self.cancellation.is_cancelled() {
            return Err(RuntimeError::new(
                "CANCELLED",
                "Analysis cancelled; late results discarded",
            ));
        }
        if Instant::now() >= deadline {
            return Err(RuntimeError::new(
                "TIMEOUT",
                "Local analysis deadline exceeded; late results discarded",
            ));
        }
        Ok(())
    }
    fn artifact_hash(
        &self,
        path: &Path,
        model: bool,
        deadline: Instant,
    ) -> Result<String, RuntimeError> {
        self.check(deadline)?;
        let canonical = path.canonicalize().map_err(|_| {
            RuntimeError::new("MODEL_UNAVAILABLE", "Pinned runtime/model file is absent")
        })?;
        allowed_path(&canonical, model)?;
        let mut file = File::open(&canonical).map_err(|_| {
            RuntimeError::new("MODEL_UNAVAILABLE", "Pinned artifact cannot be read")
        })?;
        let metadata = file.metadata().map_err(|_| {
            RuntimeError::new("MODEL_UNAVAILABLE", "Pinned artifact metadata unavailable")
        })?;
        if !metadata.is_file() || metadata.len() < 4 || metadata.len() > 8 * 1024 * 1024 * 1024 {
            return Err(RuntimeError::new(
                "ARTIFACT_MISMATCH",
                "Pinned artifact has unsupported type/size",
            ));
        }
        let mut hasher = Sha256::new();
        let mut buf = [0u8; 64 * 1024];
        let mut first = true;
        loop {
            self.check(deadline)?;
            let n = file
                .read(&mut buf)
                .map_err(|_| RuntimeError::new("MODEL_UNAVAILABLE", "Artifact read failed"))?;
            if n == 0 {
                break;
            }
            if first
                && (n < 4 || (model && &buf[..4] != b"GGUF") || (!model && &buf[..4] != b"\x7fELF"))
            {
                return Err(RuntimeError::new(
                    "ARTIFACT_MISMATCH",
                    "Expected Linux ELF runtime or GGUF model",
                ));
            }
            first = false;
            hasher.update(&buf[..n]);
        }
        Ok(format!("{:x}", hasher.finalize()))
    }
    fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
        deadline: Instant,
    ) -> Result<Value, RuntimeError> {
        self.check(deadline)?;
        let body = body
            .map(|v| serde_json::to_vec(&v))
            .transpose()
            .map_err(|_| RuntimeError::new("REQUEST_INVALID", "Request JSON encoding failed"))?
            .unwrap_or_default();
        if body.len() > MAX_HTTP_BYTES {
            return Err(RuntimeError::new(
                "OVERSIZED_INPUT",
                "HTTP request exceeds byte bound",
            ));
        }
        let connect_time = deadline
            .saturating_duration_since(Instant::now())
            .min(Duration::from_millis(250));
        let mut stream =
            TcpStream::connect_timeout(&self.admin.endpoint, connect_time).map_err(|_| {
                RuntimeError::new(
                    "SERVER_UNAVAILABLE",
                    "Pinned local server is unavailable; no fallback",
                )
            })?;
        stream.set_read_timeout(Some(POLL)).map_err(io_error)?;
        stream.set_write_timeout(Some(POLL)).map_err(io_error)?;
        let header = format!(
            "{method} {path} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nAccept: application/json\r\nAccept-Encoding: identity\r\nConnection: close\r\nContent-Length: {}\r\n\r\n",
            self.admin.endpoint,
            body.len()
        );
        let request = [header.as_bytes(), &body].concat();
        let mut sent = 0;
        while sent < request.len() {
            self.check(deadline)?;
            match stream.write(&request[sent..]) {
                Ok(0) => {
                    return Err(RuntimeError::new(
                        "HTTP_PROTOCOL",
                        "Connection closed while sending request",
                    ));
                }
                Ok(n) => sent += n,
                Err(e) if transient(&e) => continue,
                Err(e) => return Err(io_error(e)),
            }
        }
        let mut bytes = Vec::new();
        let mut framed: Option<(usize, usize)> = None;
        let mut chunk = [0u8; 8192];
        loop {
            self.check(deadline)?;
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => bytes.extend_from_slice(&chunk[..n]),
                Err(e) if transient(&e) => continue,
                Err(e) => return Err(io_error(e)),
            }
            if bytes.len() > MAX_HTTP_BYTES + MAX_HEADER_BYTES {
                return Err(RuntimeError::new(
                    "RESPONSE_TOO_LARGE",
                    "Server response exceeds fixed byte bound",
                ));
            }
            if framed.is_none() {
                if let Some(pos) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    if pos > MAX_HEADER_BYTES {
                        return Err(RuntimeError::new(
                            "HTTP_PROTOCOL",
                            "HTTP headers exceed bound",
                        ));
                    }
                    framed = Some((pos + 4, parse_headers(&bytes[..pos])?));
                } else if bytes.len() > MAX_HEADER_BYTES {
                    return Err(RuntimeError::new(
                        "HTTP_PROTOCOL",
                        "HTTP headers exceed bound",
                    ));
                }
            }
            if let Some((offset, length)) = framed
                && bytes.len() >= offset + length
            {
                break;
            }
        }
        self.check(deadline)?;
        let (offset, length) = framed
            .ok_or_else(|| RuntimeError::new("HTTP_PROTOCOL", "Incomplete response headers"))?;
        if bytes.len() != offset + length {
            return Err(RuntimeError::new(
                "TRUNCATED_RESPONSE",
                "Response Content-Length does not match received bytes",
            ));
        }
        strict_parse(&bytes[offset..]).map_err(|_| {
            RuntimeError::new("MALFORMED_RESPONSE", "Server response is not strict JSON")
        })
    }
    fn execute(
        &self,
        stage: InputStage,
        prompt: &str,
        spec: &AnalysisSpecificationV1,
        seed: u32,
        deadline: Instant,
    ) -> Result<RawCompletion, RuntimeError> {
        self.check(deadline)?;
        admission(prompt, spec, seed)?;
        if spec.runtime_status != "PINNED_READY" {
            return Err(RuntimeError::new(
                "MODEL_UNAVAILABLE",
                "Specification has no installed pinned model/runtime; inference NOT RUN",
            ));
        }
        self.check_profile_paths(spec)?;
        // Recheck bytes each run; model input never chooses these filesystem paths.
        if self.artifact_hash(&self.admin.model_path, true, deadline)?
            != *spec.gguf_sha256.as_ref().unwrap()
            || self.artifact_hash(&self.admin.server_binary_path, false, deadline)?
                != *spec.server_binary_sha256.as_ref().unwrap()
        {
            return Err(RuntimeError::new(
                "ARTIFACT_MISMATCH",
                "Actual local GGUF/runtime hash differs from signed specification",
            ));
        }
        let props = self.request("GET", "/props", None, deadline)?;
        self.check_properties(&props, spec)?;
        let system = match stage {
            InputStage::Evidence => evidence_prompt(spec),
            InputStage::PriorComparison => prior_prompt(spec),
        };
        let user = prompt
            .strip_prefix(system)
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| {
                RuntimeError::new(
                    "SPECIFICATION_MISMATCH",
                    "Full prompt must start with its exact pinned stage instructions",
                )
            })?;
        let formatted = self.request(
            "POST",
            "/apply-template",
            Some(json!({"messages":[
                {"role":"system","content":system}, {"role":"user","content":user}
            ]})),
            deadline,
        )?;
        let formatted = formatted
            .get("prompt")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                RuntimeError::new("MALFORMED_RESPONSE", "Template endpoint returned no prompt")
            })?;
        if formatted.len() > spec.max_prompt_bytes as usize {
            return Err(RuntimeError::new(
                "OVERSIZED_INPUT",
                "Full formatted prompt exceeds byte bound",
            ));
        }
        let tokenized = self.request(
            "POST",
            "/tokenize",
            Some(json!({
                "content":formatted,"add_special":true,"parse_special":true,"with_pieces":false
            })),
            deadline,
        )?;
        let tokens = tokenized
            .get("tokens")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                RuntimeError::new("MALFORMED_RESPONSE", "Tokenizer returned no token IDs")
            })?;
        if tokens.is_empty()
            || tokens
                .iter()
                .any(|v| v.as_u64().is_none_or(|v| v > i32::MAX as u64))
        {
            return Err(RuntimeError::new(
                "MALFORMED_RESPONSE",
                "Tokenizer returned invalid token IDs",
            ));
        }
        let input_tokens = u32::try_from(tokens.len())
            .map_err(|_| RuntimeError::new("OVERSIZED_INPUT", "Token count overflow"))?;
        if input_tokens > spec.max_input_tokens
            || input_tokens
                .checked_add(spec.max_output_tokens)
                .is_none_or(|n| n >= spec.context_tokens)
        {
            let mut e = RuntimeError::new(
                "CONTEXT_OVERFLOW",
                "Complete templated input plus reserved output exceeds context; nothing was truncated or generated",
            );
            e.input_tokens = Some(input_tokens);
            return Err(e);
        }
        let s = &spec.sampling;
        // Exact token IDs avoid adding a second template/BOS after token accounting.
        let response = self.request(
            "POST",
            "/completion",
            Some(json!({
                "prompt":tokens,"n_predict":spec.max_output_tokens,"seed":seed,"stream":false,
                "cache_prompt":false,"n_keep":input_tokens,"ignore_eos":false,"stop":[],
                "json_schema":output_schema_for(spec,stage),"temperature":s.temperature,"top_k":s.top_k,
                "top_p":s.top_p,"min_p":s.min_p,"repeat_penalty":1.0,"repeat_last_n":0,
                "presence_penalty":0.0,"frequency_penalty":0.0,"dry_multiplier":0.0,
                "mirostat":0,"dynatemp_range":0.0,"typical_p":1.0,"xtc_probability":0.0,
                "samplers":s.samplers,"lora":[],"return_tokens":false
            })),
            deadline,
        )?;
        self.check(deadline)?;
        let text = response
            .get("content")
            .and_then(Value::as_str)
            .ok_or_else(|| RuntimeError::new("MALFORMED_RESPONSE", "Completion has no text"))?;
        if text.len() > spec.max_output_bytes as usize {
            return Err(RuntimeError::new(
                "RESPONSE_TOO_LARGE",
                "Completion text exceeds output byte bound",
            ));
        }
        let predicted = response
            .get("tokens_predicted")
            .and_then(Value::as_u64)
            .or_else(|| {
                response
                    .pointer("/timings/predicted_n")
                    .and_then(Value::as_u64)
            });
        let malformed = response.get("truncated") != Some(&json!(false))
            || !matches!(
                response.get("stop_type").and_then(Value::as_str),
                Some("eos" | "word")
            )
            || predicted.is_none_or(|n| n == 0 || n > spec.max_output_tokens as u64)
            || response.get("tokens_evaluated").and_then(Value::as_u64)
                != Some(input_tokens as u64);
        if malformed || strict_parse::<Value>(text.as_bytes()).is_err() {
            let mut e = RuntimeError::new(
                if malformed {
                    "TRUNCATED_RESPONSE"
                } else {
                    "MALFORMED_OUTPUT"
                },
                "Completion failed strict JSON, token accounting or nontruncation checks",
            );
            e.raw_output = Some(text.into());
            e.input_tokens = Some(input_tokens);
            e.output_tokens = predicted.and_then(|v| v.try_into().ok());
            return Err(e);
        }
        // Pins are re-observed after generation; local observations still do not attest execution.
        let after = self
            .request("GET", "/props", None, deadline)
            .and_then(|after| self.check_properties(&after, spec));
        if let Err(mut error) = after {
            error.raw_output = Some(text.into());
            error.input_tokens = Some(input_tokens);
            error.output_tokens = predicted.and_then(|v| v.try_into().ok());
            return Err(error);
        }
        Ok(RawCompletion {
            text: text.into(),
            input_tokens,
            output_tokens: predicted.unwrap() as u32,
            elapsed_ms: 0,
            provenance: RuntimeProvenance {
                kind: "LOCAL_LLAMA_CPP".into(),
                specification_hash: spec.digest().map_err(spec_error)?,
                prompt_sha256: bytes_digest(prompt.as_bytes()),
                formatted_prompt_sha256: Some(bytes_digest(formatted.as_bytes())),
                input_stage: stage,
                seed,
                runtime_claim: format!(
                    "Local file hashes checked; loopback server reported pinned build/template/model. Backend {} and device/offload settings are administrator runner claims, not execution attestation or proof of loaded bytes or honest inference.",
                    spec.backend
                ),
                artifacts_hash_checked: true,
                execution_attested: false,
                independently_rerun: false,
            },
        })
    }
    fn check_profile_paths(&self, spec: &AnalysisSpecificationV1) -> Result<(), RuntimeError> {
        let binary = &self.admin.server_binary_path;
        let model = &self.admin.model_path;
        let cpu_roots = [
            "/opt/nonverba-tools/llama.cpp",
            "/opt/nonverba-tools/llama-cpp",
        ];
        let binary_allowed = |path: &Path| {
            if spec.backend == "cuda" {
                path.parent() == Some(Path::new(CUDA_RUNTIME_ROOT))
            } else {
                cpu_roots.iter().any(|root| path.starts_with(root))
            }
        };
        // Version 1 keeps its original administrative artifact scope as well as
        // exact prompts/schema. Canonical checks forbid symlink escape/profile swaps.
        let model_allowed = |path: &Path| {
            spec.version != 1 || !path.starts_with("/usr/local/share/nonverba/models")
        };
        if !binary_allowed(binary) || !model_allowed(model) {
            return Err(RuntimeError::new(
                "SPECIFICATION_MISMATCH",
                "Artifact paths do not match the signed runtime version/backend profile",
            ));
        }
        let missing =
            |_| RuntimeError::new("MODEL_UNAVAILABLE", "Pinned runtime/model file is absent");
        let actual_binary = binary.canonicalize().map_err(missing)?;
        let actual_model = model.canonicalize().map_err(missing)?;
        if !binary_allowed(&actual_binary) || !model_allowed(&actual_model) {
            return Err(RuntimeError::new(
                "SPECIFICATION_MISMATCH",
                "Canonical artifact paths do not match the signed runtime profile",
            ));
        }
        Ok(())
    }
    fn check_properties(
        &self,
        props: &Value,
        spec: &AnalysisSpecificationV1,
    ) -> Result<(), RuntimeError> {
        let path = props
            .get("model_path")
            .and_then(Value::as_str)
            .map(Path::new);
        let template = props.get("chat_template").and_then(Value::as_str);
        if props.get("build_info").and_then(Value::as_str) != spec.llama_cpp_build.as_deref()
            || path != Some(self.admin.model_path.as_path())
            || props.get("total_slots").and_then(Value::as_u64) != Some(1)
            || props
                .pointer("/default_generation_settings/n_ctx")
                .and_then(Value::as_u64)
                != Some(spec.context_tokens as u64)
            || template.map(|t| bytes_digest(t.as_bytes())).as_ref()
                != spec.chat_template_sha256.as_ref()
        {
            return Err(RuntimeError::new(
                "RUNTIME_MISMATCH",
                "Server build, model path, template, slots or context differs from pinned specification",
            ));
        }
        Ok(())
    }
}

impl Backend for LlamaCppBackend {
    fn kind(&self) -> &'static str {
        "LOCAL_LLAMA_CPP"
    }
    fn generate(
        &self,
        stage: InputStage,
        prompt: &str,
        spec: &AnalysisSpecificationV1,
        seed: u32,
    ) -> Result<RawCompletion, RuntimeError> {
        if self
            .busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(RuntimeError::new(
                "BUSY",
                "One inference call is already in progress; no queued retry",
            ));
        }
        struct Release<'a>(&'a AtomicBool);
        impl Drop for Release<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::SeqCst);
            }
        }
        let _release = Release(&self.busy);
        let start = Instant::now();
        let result = self.execute(
            stage,
            prompt,
            spec,
            seed,
            start + Duration::from_millis(spec.timeout_ms.min(300_000)),
        );
        let elapsed_ms = start.elapsed().as_millis().try_into().unwrap_or(u64::MAX);
        match result {
            Ok(mut result) => {
                result.elapsed_ms = elapsed_ms;
                Ok(result)
            }
            Err(mut error) => {
                error.elapsed_ms = elapsed_ms;
                Err(error)
            }
        }
    }
}

fn admission(prompt: &str, spec: &AnalysisSpecificationV1, seed: u32) -> Result<(), RuntimeError> {
    spec.validate().map_err(spec_error)?;
    if !spec.seeds.contains(&seed) {
        return Err(RuntimeError::new(
            "SPECIFICATION_MISMATCH",
            "Seed is outside the recorded schedule",
        ));
    }
    if prompt.is_empty() || prompt.len() > spec.max_prompt_bytes as usize {
        return Err(RuntimeError::new(
            "OVERSIZED_INPUT",
            "Input prompt is empty or exceeds its byte bound",
        ));
    }
    Ok(())
}
fn spec_error(message: String) -> RuntimeError {
    RuntimeError::new("SPECIFICATION_MISMATCH", &message)
}
fn transient(e: &std::io::Error) -> bool {
    matches!(
        e.kind(),
        std::io::ErrorKind::WouldBlock
            | std::io::ErrorKind::TimedOut
            | std::io::ErrorKind::Interrupted
    )
}
fn io_error(_: std::io::Error) -> RuntimeError {
    RuntimeError::new("HTTP_IO", "Local server transport failed")
}

/// Deliberately narrow HTTP/1.1 profile: no redirects, compression or chunked bodies.
fn parse_headers(bytes: &[u8]) -> Result<usize, RuntimeError> {
    let header = std::str::from_utf8(bytes)
        .map_err(|_| RuntimeError::new("HTTP_PROTOCOL", "Non-UTF8 response headers"))?;
    let mut lines = header.split("\r\n");
    let status = lines
        .next()
        .unwrap_or("")
        .split_whitespace()
        .collect::<Vec<_>>();
    if status.len() < 2 || !matches!(status[0], "HTTP/1.1" | "HTTP/1.0") || status[1] != "200" {
        return Err(RuntimeError::new(
            "SERVER_REJECTED",
            "Local server returned non-success status; no redirect/fallback",
        ));
    }
    let mut length = None;
    let mut content_type = false;
    for line in lines {
        let (name, value) = line
            .split_once(':')
            .ok_or_else(|| RuntimeError::new("HTTP_PROTOCOL", "Malformed response header"))?;
        match name.to_ascii_lowercase().as_str() {
            "content-length" => {
                if length.is_some() {
                    return Err(RuntimeError::new(
                        "HTTP_PROTOCOL",
                        "Duplicate Content-Length",
                    ));
                }
                length =
                    Some(value.trim().parse::<usize>().map_err(|_| {
                        RuntimeError::new("HTTP_PROTOCOL", "Invalid Content-Length")
                    })?);
            }
            "content-type" => {
                content_type = value.trim().split(';').next() == Some("application/json")
            }
            "transfer-encoding" | "content-encoding" => {
                return Err(RuntimeError::new(
                    "HTTP_PROTOCOL",
                    "Encoded/chunked responses unsupported; no silent transport downgrade",
                ));
            }
            _ => {}
        }
    }
    let length =
        length.ok_or_else(|| RuntimeError::new("HTTP_PROTOCOL", "Missing Content-Length"))?;
    if !content_type || length == 0 || length > MAX_HTTP_BYTES {
        return Err(RuntimeError::new(
            "HTTP_PROTOCOL",
            "Missing JSON content type or unsupported response size",
        ));
    }
    Ok(length)
}
