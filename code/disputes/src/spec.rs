// SPDX-License-Identifier: AGPL-3.0-only
use crate::runtime::AnalysisSpecificationV1;
use serde_json::Value;

pub fn validate_spec_value(value: &Value) -> Result<(), String> {
    // The versioned runtime validator preserves the exact v1 field/prompt/schema
    // profile and requires explicit v2 projection, stage schemas and CUDA settings.
    let spec: AnalysisSpecificationV1 =
        serde_json::from_value(value.clone()).map_err(|e| format!("ANALYSIS_SPEC: {e}"))?;
    spec.validate()
}
