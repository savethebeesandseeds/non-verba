// SPDX-License-Identifier: AGPL-3.0-only
//! Adapters cannot mint authority: all authoritative bundles pass the same verifier.
use crate::{
    crypto::{DetachedSignature, SignatureClaims},
    model::*,
};
pub trait SigningPort {
    fn sign(&mut self, claims: &SignatureClaims) -> Result<DetachedSignature, String>;
}
pub trait BundleStore {
    fn load(&self) -> Result<AssignmentBundle, String>;
    fn import(
        &mut self,
        bundle: &AssignmentBundle,
        trust: &TrustConfiguration,
    ) -> Result<BundleReport, String>;
}
pub trait Transport {
    fn send_bundle(&mut self, bundle: &AssignmentBundle) -> Result<(), String>;
}
/// Observations are attributed evidence only. No fund-moving method exists for M.
pub trait PaymentObservationPort {
    fn observations(
        &self,
        assignment_id: &str,
    ) -> Result<Vec<crate::transcript::SignedEvent>, String>;
}
/// Sensor adapters supply manifests with native reports, not a universal truth flag.
pub trait EvidencePort {
    fn manifest(&self, assignment_id: &str) -> Result<crate::transcript::EvidenceManifest, String>;
}
