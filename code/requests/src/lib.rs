// SPDX-License-Identifier: AGPL-3.0-only
//! Portable, deterministic three-party assignment verification. No mediator custody.
pub mod actions;
pub mod agreement;
pub mod bundle;
pub mod crypto;
mod cutover;
pub mod encoding;
pub mod evidence;
pub mod legacy;
#[cfg(not(target_arch = "wasm32"))]
pub mod local;
pub mod model;
pub mod money;
pub mod ports;
pub mod rights;
pub mod transcript;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn verify_assignment_bundle_json(
    bundle_json: &str,
    trust_json: &str,
) -> Result<String, wasm_bindgen::JsValue> {
    let run = || -> Result<String, String> {
        let bundle = encoding::strict_parse(bundle_json.as_bytes())?;
        let trust = encoding::strict_parse(trust_json.as_bytes())?;
        serde_json::to_string(&bundle::verify_assignment_bundle(&bundle, &trust)?)
            .map_err(|e| e.to_string())
    };
    run().map_err(|e| wasm_bindgen::JsValue::from_str(&e))
}
