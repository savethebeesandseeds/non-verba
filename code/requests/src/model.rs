// SPDX-License-Identifier: AGPL-3.0-only
//! Strict, explicitly versioned records. Constructing a value confers no authority.
use crate::{
    crypto::{DetachedSignature, KeyBinding},
    money::Money,
    transcript::SignedEvent,
};
use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: &str = "2";
pub const POLICY_ID: &str = "nonverba-three-party-v2";
pub const CONSTITUTION: &str = "No coalition of two parties can create a valid contractual state that improperly alters the third party's rights.";
pub const NON_RETRACTION: &str = "An authenticated contradiction is evidence of misconduct or uncertainty; it is not, by itself, authority to revoke a right previously established for another party.";

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum Role {
    #[serde(rename = "R")]
    Requester,
    #[serde(rename = "O")]
    Operator,
    #[serde(rename = "M")]
    Mediator,
}
impl Role {
    pub fn code(self) -> &'static str {
        match self {
            Self::Requester => "R",
            Self::Operator => "O",
            Self::Mediator => "M",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TextArtifact {
    pub id: String,
    pub version: String,
    pub media_type: String,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PartyBinding {
    pub role: Role,
    pub party_id: String,
    pub identity_record: TextArtifact,
    pub key: KeyBinding,
}

/// These bindings must be obtained independently of the bundle and account recovery.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrustConfiguration {
    pub protocol_version: String,
    pub deployment_domain: String,
    pub parties: Vec<PartyBinding>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Service {
    pub description: String,
    pub deliverables: Vec<String>,
    pub exclusions: Vec<String>,
    pub location: Option<String>,
    pub prerequisites: Vec<String>,
    pub requester_inputs: Vec<String>,
    pub safety_stop_conditions: Vec<String>,
    pub execution_resources: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub protocol_version: String,
    pub deployment_domain: String,
    pub request_id: String,
    pub revision: String,
    pub requester: PartyBinding,
    pub service: Service,
    pub terms: Vec<TextArtifact>,
    pub accepts_platform_terms: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedRequest {
    pub request: Request,
    pub authorization: DetachedSignature,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExpenseCap {
    pub category: String,
    pub cap: Money,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Milestone {
    pub id: String,
    pub deliverable: String,
    pub compensation: Money,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Quote {
    pub protocol_version: String,
    pub deployment_domain: String,
    pub quote_id: String,
    pub request_hash: String,
    pub service_hash: String,
    pub accepted_terms_hash: String,
    pub operator: PartyBinding,
    pub compensation: Money,
    pub expenses: Vec<ExpenseCap>,
    pub milestones: Vec<Milestone>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedQuote {
    pub quote: Quote,
    pub authorization: DetachedSignature,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AcceptanceCriterion {
    pub id: String,
    pub milestone_id: String,
    pub description: String,
    pub evaluation: Evaluation,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Evaluation {
    RequesterJudgment,
    ArtifactBytes,
}

/// Closed rule: exact artifact receipt proves only a digital byte condition.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ArtifactRule {
    pub id: String,
    pub milestone_id: String,
    pub criterion_ids: Vec<String>,
    pub artifact_digests: Vec<String>,
    pub effect: ArtifactEffect,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum ArtifactEffect {
    #[serde(rename = "ESTABLISH_MILESTONE_COMPENSATION")]
    EstablishMilestoneCompensation,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Policy {
    pub id: String,
    pub version: String,
    pub artifact_rules: Vec<ArtifactRule>,
    pub bilateral_balance_releases: bool,
    pub payment_rule: PaymentRule,
    pub time_rule: TimeRule,
    pub no_commission: bool,
    pub mediator_has_task_fund_control: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum PaymentRule {
    #[serde(rename = "PAYEE_SIGNED_RECEIPT")]
    PayeeSignedReceipt,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum TimeRule {
    #[serde(rename = "REMINDERS_ONLY")]
    RemindersOnly,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Timing {
    pub start_window: String,
    pub completion_window: String,
    pub review_window: String,
    pub notices: String,
    pub grace_extensions: String,
    pub time_assumptions: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PaymentTerms {
    pub payer: Role,
    pub payee: Role,
    pub rail: String,
    pub destination: String,
    pub due_conditions: String,
    pub preconditions: Vec<String>,
    pub reversal_treatment: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct MediationTerms {
    pub free: bool,
    pub proposal_only: bool,
    pub obligations: Vec<String>,
    pub availability_commitment: String,
    pub escalation: String,
}

/// Only nonfinancial service commitments are enabled; financial products fail closed.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "status",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
// Keep this small, bounded signed record as one transparent schema object.
#[allow(clippy::large_enum_variant)]
pub enum Assurance {
    Disabled {
        reason: String,
    },
    Service {
        id: String,
        provider: Role,
        beneficiaries: Vec<Role>,
        services: Vec<String>,
        limits: String,
        triggers: String,
        exclusions: Vec<String>,
        evidence_requirements: String,
        claim_path: String,
        challenge_path: String,
        prerequisites: Vec<String>,
        response_commitment: String,
        fee: Option<ProtectionFee>,
        financial_compensation: bool,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProtectionFee {
    pub fee_id: String,
    pub payer: Role,
    pub provider: Role,
    pub amount: Money,
    pub destination: String,
    pub service_scope: String,
    pub due_conditions: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Remedies {
    pub cancellation: String,
    pub interruption: String,
    pub partial_completion: String,
    pub expenses: String,
    pub escalation: String,
    pub preserve_accrued_claims: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Privacy {
    pub recipients: Vec<Role>,
    pub purposes: Vec<String>,
    pub retention: TextArtifact,
    pub export_rights: String,
    pub disclosure_rules: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct LegalTerms {
    pub artifacts: Vec<TextArtifact>,
    pub governing_law: Option<String>,
    pub jurisdiction: Option<String>,
    pub mandatory_rights_reserved: bool,
    pub consent_text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
/// Exact Assignment Contract terms. Legacy JSON field spellings are part of the
/// signed protocol; terminology changes do not change their encoding.
pub struct AssignmentContract {
    pub protocol_version: String,
    pub schema_version: String,
    pub deployment_domain: String,
    pub assignment_id: String,
    pub request_id: String,
    pub request_hash: String,
    pub revision: String,
    pub previous_agreement_hash: Option<String>,
    pub parties: Vec<PartyBinding>,
    pub policy: Policy,
    pub policy_hash: String,
    pub service: Service,
    pub quote: SignedQuote,
    pub acceptance: Vec<AcceptanceCriterion>,
    pub timing: Timing,
    pub payments: PaymentTerms,
    pub mediation: MediationTerms,
    pub assurance: Assurance,
    pub remedies: Remedies,
    pub privacy: Privacy,
    pub legal: LegalTerms,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContractCertificate {
    pub agreement: AssignmentContract,
    pub signatures: Vec<DetachedSignature>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BalanceRelease {
    pub obligation_id: String,
    pub amount: Money,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum Action {
    AcknowledgeCompletion {
        completion_event_hash: String,
        milestone_id: String,
    },
    InvokeArtifactRule {
        rule_id: String,
        completion_event_hash: String,
    },
    AuthorizeExpense {
        expense_id: String,
        category: String,
        amount: Money,
        evidence_event_hash: String,
    },
    BilateralSettlement {
        settlement_id: String,
        releases: Vec<BalanceRelease>,
        reservation_of_other_rights: String,
    },
    PaymentReceipt {
        payment_id: String,
        obligation_id: String,
        amount: Money,
        rail_reference: String,
    },
    ReconcileReversal {
        payment_certificate_id: String,
        amount: Money,
        reason: String,
    },
    AmendAgreement {
        replacement: Box<AssignmentContract>,
    },
    ActivateProtectionService {
        commitment_id: String,
    },
}
impl Action {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::AcknowledgeCompletion { .. } => "ACKNOWLEDGE_COMPLETION",
            Self::InvokeArtifactRule { .. } => "INVOKE_ARTIFACT_RULE",
            Self::AuthorizeExpense { .. } => "AUTHORIZE_EXPENSE",
            Self::BilateralSettlement { .. } => "BILATERAL_SETTLEMENT",
            Self::PaymentReceipt { .. } => "PAYMENT_RECEIPT",
            Self::ReconcileReversal { .. } => "RECONCILE_REVERSAL",
            Self::AmendAgreement { .. } => "AMEND_AGREEMENT",
            Self::ActivateProtectionService { .. } => "ACTIVATE_PROTECTION_SERVICE",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionProposal {
    pub protocol_version: String,
    pub deployment_domain: String,
    pub assignment_id: String,
    pub agreement_hash: String,
    pub policy_hash: String,
    pub scope_id: String,
    pub parent_certificate_ids: Vec<String>,
    pub scope_version: String,
    pub nonce: String,
    /// Exact half-open minor-unit coordinates. No allocation is inferred for v1.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allocations: Vec<UnitAllocation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cutover: Option<AmendmentCutover>,
    pub action: Action,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct UnitAllocation {
    pub obligation_id: String,
    pub basis_agreement_hash: String,
    pub start: String,
    pub end: String,
}

/// All three parties sign the observed frontier and any explicit grandfather.
/// Omission does not waive an accrued right or assert a globally complete log.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AmendmentCutover {
    pub frontier: Vec<String>,
    pub preserved_claims: Vec<String>,
    pub grandfathered_actions: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UnitGrant {
    pub certificate_id: String,
    pub allocations: Vec<UnitAllocation>,
    pub revoked: Vec<UnitAllocation>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionCertificate {
    pub proposal: ActionProposal,
    pub authorizations: Vec<DetachedSignature>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Attachment {
    pub sha256: String,
    pub bytes_b64: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssignmentBundle {
    pub protocol_version: String,
    pub deployment_domain: String,
    pub requests: Vec<SignedRequest>,
    pub agreement: ContractCertificate,
    pub actions: Vec<ActionCertificate>,
    pub events: Vec<SignedEvent>,
    pub attachments: Vec<Attachment>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Diagnostic {
    pub code: String,
    pub subject: String,
    pub message: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Obligation {
    pub id: String,
    pub debtor: Role,
    pub creditor: Role,
    pub category: String,
    pub amount: Money,
    pub basis_agreement_hash: String,
    pub certificate_ids: Vec<String>,
    pub due_conditions: String,
    pub disputed_amount: String,
    pub discharged_amount: String,
    pub released_amount: String,
    pub overlap_amount: String,
    pub credit_grants: Vec<UnitGrant>,
    pub release_grants: Vec<UnitGrant>,
    pub unresolved_balance: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EffectAudit {
    pub certificate_id: String,
    pub rule_id: String,
    pub authorizers: Vec<Role>,
    pub proof_references: Vec<String>,
    pub obligation_ids: Vec<String>,
    pub explanation: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaymentObservation {
    pub certificate_id: String,
    pub obligation_id: String,
    pub amount: Money,
    pub kind: String,
    pub discharged_amount: String,
    pub excess_amount: String,
    pub reference: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContractResult {
    pub agreement_hash: String,
    pub bound: bool,
    pub valid_signers: Vec<Role>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BundleReport {
    pub financial_projection: String,
    pub recognized_legacy_proofs: Vec<LegacyProof>,
    /// Separately validated financial proofs whose cutover/cap applicability is
    /// unresolved. These conditional projections are not additive or zero debt.
    pub unresolved_rights: Vec<UnresolvedRight>,
    pub evidence_integrity: Vec<crate::evidence::EventEvidenceReport>,
    pub agreement: ContractResult,
    pub current_agreement_hash: String,
    pub ready_to_start: bool,
    pub readiness_reasons: Vec<String>,
    pub performance: String,
    pub mediation: String,
    pub assurance: String,
    pub obligations: Vec<Obligation>,
    pub effects: Vec<EffectAudit>,
    pub payments: Vec<PaymentObservation>,
    pub diagnostics: Vec<Diagnostic>,
    pub action_status: std::collections::BTreeMap<String, String>,
    pub transcript: crate::transcript::TranscriptReport,
    pub unresolved_claims: Vec<String>,
    pub history_completeness: String,
    pub assumptions: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UnresolvedRight {
    pub certificate_id: String,
    pub reason: String,
    pub obligations: Vec<Obligation>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LegacyProof {
    pub certificate_id: String,
    pub action_kind: String,
    pub authorizers: Vec<Role>,
    pub proposal: ActionProposal,
}

/// Compatibility names. Serialized fields and signing identifiers retain their
/// versioned agreement spelling; the living vocabulary calls this a Contract.
pub type AssignmentAgreement = AssignmentContract;
pub type AgreementCertificate = ContractCertificate;
pub type AgreementResult = ContractResult;
