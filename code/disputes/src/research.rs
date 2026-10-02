// SPDX-License-Identifier: AGPL-3.0-only
//! Isolated metadata admission for future synthetic candidate-policy research.
//! There is no settlement formula, policy interpreter or contractual action here.
use nonverba_requests::encoding::{digest, validate_digest, validate_id};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SyntheticCaseReferenceV1 {
    /// Synthetic designation is a dataset author's claim, not verified ground truth.
    pub case_id: String,
    pub content_sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CandidatePolicyResearchV1 {
    pub version: u32,
    pub candidate_policy_id: String,
    pub candidate_policy_version: String,
    pub authority_mode: String,
    pub data_classification: String,
    pub synthetic_cases: Vec<SyntheticCaseReferenceV1>,
    pub assumptions: Vec<String>,
    pub output_limitations: Vec<String>,
    pub execution_status: String,
}

impl CandidatePolicyResearchV1 {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1
            || self.authority_mode != "RESEARCH_ONLY"
            || self.data_classification != "DECLARED_SYNTHETIC"
            || self.execution_status != "NOT_IMPLEMENTED"
        {
            return Err(
                "RESEARCH_AUTHORITY: metadata only; no executable or adopted policy".into(),
            );
        }
        validate_id(&self.candidate_policy_id)?;
        validate_id(&self.candidate_policy_version)?;
        if self.synthetic_cases.is_empty() || self.synthetic_cases.len() > 64 {
            return Err("RESEARCH_CASES: require 1..64 explicitly synthetic cases".into());
        }
        let mut ids = BTreeSet::new();
        for case in &self.synthetic_cases {
            validate_id(&case.case_id)?;
            validate_digest(&case.content_sha256)?;
            if !case.case_id.starts_with("synthetic-") || !ids.insert(&case.case_id) {
                return Err("RESEARCH_CASES: duplicate or non-synthetic case label".into());
            }
        }
        for list in [&self.assumptions, &self.output_limitations] {
            if list.is_empty()
                || list.len() > 16
                || list.iter().any(|text| {
                    text.trim().is_empty()
                        || text.len() > 2048
                        || text.chars().any(char::is_control)
                })
            {
                return Err(
                    "RESEARCH_DISCLOSURE: bounded assumptions and limitations required".into(),
                );
            }
        }
        Ok(())
    }

    pub fn digest(&self) -> Result<String, String> {
        self.validate()?;
        digest(self)
    }

    /// Explicit future implementation slot. Registration cannot run any policy.
    pub fn evaluate(&self) -> Result<(), String> {
        self.validate()?;
        Err("POLICY_NOT_IMPLEMENTED: synthetic research metadata does not select a settlement formula or authorize an outcome".into())
    }
}
