// SPDX-License-Identifier: AGPL-3.0-only
//! Exact, shared dispute inputs. This module never creates contractual actions.
//! Authentication attributes a statement; it does not establish its truth.
use crate::binding::{
    self, AttributionScopeV1, ContextReport, SignedDisputeContextV1, SubmissionKind,
};
use nonverba_requests::{
    bundle, crypto,
    encoding::{bytes_digest, canonical, digest, validate_digest, validate_id},
    local,
    model::{AssignmentBundle, BundleReport, Role, TrustConfiguration},
    money::Money,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;

pub const MAX_CASE_ITEMS: usize = 128;
pub const MAX_EVIDENCE_BYTES: u64 = 256 * 1024;
pub const MAX_TEXT_BYTES: usize = 32 * 1024;
pub const RESERVED_REFERENCES: [&str; 2] = ["agreement", "financial-report"];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CaseLifecycleV1 {
    Open,
    UnderReview,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SharedAccessPolicyV1 {
    pub version: String,
    pub audience: Vec<Role>,
    pub selection_policy: String,
    pub redaction_policy: String,
}

impl Default for SharedAccessPolicyV1 {
    fn default() -> Self {
        Self {
            version: "1".into(),
            audience: vec![Role::Requester, Role::Operator, Role::Mediator],
            selection_policy: "explicit-shared-manifest-v1".into(),
            redaction_policy: "explicit-shared-omissions-v1".into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StatementKindV1 {
    Claim,
    PartyOffer,
    EvidenceDescription,
    SensorAppraisalClaim,
}

/// The signature binds the exact original bytes by digest. Text is in those
/// bytes, never silently substituted by an extraction or supplied appraisal.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EvidenceSubmissionBodyV1 {
    pub version: String,
    pub case_id: String,
    pub submission_id: String,
    pub author_role: Role,
    pub agreement_hash: String,
    pub context_hash: String,
    pub content_sha256: String,
    pub byte_length: u64,
    pub media_type: String,
    pub statement_kind: StatementKindV1,
    /// An attributed voluntary offer, not an obligation, award or payment.
    pub party_offer: Option<Money>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EvidenceSubmissionV1 {
    pub body: EvidenceSubmissionBodyV1,
    pub authorization: crypto::DetachedSignature,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum EvidenceOriginV1 {
    Submission {
        signed: Box<EvidenceSubmissionV1>,
    },
    /// Exact canonical EventEnvelope bytes from the authenticated core report.
    CoreEvent {
        event_hash: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum EvidenceAvailabilityV1 {
    Accessible { bytes_b64: String },
    Redacted { reason: String },
    Omitted { reason: String },
    Inaccessible { reason: String },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExtractedTextV1 {
    pub source_sha256: String,
    /// Claimed producer/tool identifiers, not cryptographic attribution.
    pub producer: String,
    pub tool_version: String,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SuppliedSensorAppraisalV1 {
    pub source_sha256: String,
    pub producer: String,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EvidenceItemV1 {
    pub id: String,
    pub media_type: String,
    pub content_sha256: String,
    pub byte_length: u64,
    pub availability: EvidenceAvailabilityV1,
    pub origin: EvidenceOriginV1,
    pub extractions: Vec<ExtractedTextV1>,
    /// No supplied sensor report is promoted to independent sensor verification.
    pub submitted_sensor_appraisal: Option<SuppliedSensorAppraisalV1>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisputeCaseV1 {
    pub version: String,
    pub case_id: String,
    pub revision: u64,
    pub parent_case_hash: Option<String>,
    pub deployment_domain: String,
    pub assignment_id: String,
    pub root_agreement_hash: String,
    pub current_agreement_hash: String,
    pub context_hash: Option<String>,
    /// Commits independently supplied trust; does not make bundled trust trusted.
    pub trust_hash: String,
    pub bundle: AssignmentBundle,
    /// Sorted inventory of supplied root/request/action/event/attachment hashes.
    /// This is a local frontier, never a global history-completeness assertion.
    pub frontier: Vec<String>,
    pub scope: Vec<String>,
    pub access: SharedAccessPolicyV1,
    pub evidence: Vec<EvidenceItemV1>,
    pub lifecycle: CaseLifecycleV1,
}

#[derive(Clone, Debug, Serialize)]
pub struct EvidenceInspectionV1 {
    pub id: String,
    pub authenticated_role: Option<Role>,
    pub original_bytes_verified: bool,
    pub accessible_to_all_parties: bool,
    pub interpretation: String,
    pub diagnostics: Vec<String>,
}

/// Not deserializable: imported verdicts must be recomputed from exact inputs.
#[derive(Clone, Debug, Serialize)]
pub struct CaseInspection {
    pub case_hash: String,
    pub core_report: BundleReport,
    pub ancillary_valid: bool,
    pub analysis_ready: bool,
    pub context_report: ContextReport,
    pub diagnostics: Vec<String>,
    pub items: Vec<EvidenceInspectionV1>,
    #[serde(skip)]
    material: Value,
    #[serde(skip)]
    references: Vec<String>,
    #[serde(skip)]
    offers: Vec<String>,
}

fn ensure(condition: bool, message: &str) -> Result<(), String> {
    if condition {
        Ok(())
    } else {
        Err(message.into())
    }
}

fn text(value: &str, limit: usize) -> Result<(), String> {
    ensure(
        !value.trim().is_empty() && value.len() <= limit,
        "CASE_TEXT: empty or oversized text",
    )
}

pub fn supplied_frontier(bundle: &AssignmentBundle) -> Result<Vec<String>, String> {
    let mut hashes = BTreeSet::from([digest(&bundle.agreement.agreement)?]);
    for request in &bundle.requests {
        hashes.insert(digest(&request.request)?);
    }
    for action in &bundle.actions {
        hashes.insert(digest(&action.proposal)?);
    }
    for event in &bundle.events {
        hashes.insert(digest(&event.envelope)?);
    }
    for attachment in &bundle.attachments {
        hashes.insert(attachment.sha256.clone());
    }
    Ok(hashes.into_iter().collect())
}

pub fn prepare_case(
    bundle: AssignmentBundle,
    trust: &TrustConfiguration,
    annex: Option<&SignedDisputeContextV1>,
    case_id: &str,
    scope: Vec<String>,
) -> Result<DisputeCaseV1, String> {
    validate_id(case_id)?;
    let report = bundle::verify_assignment_bundle(&bundle, trust)?;
    let case = DisputeCaseV1 {
        version: "1".into(),
        case_id: case_id.into(),
        revision: 0,
        parent_case_hash: None,
        deployment_domain: bundle.deployment_domain.clone(),
        assignment_id: bundle.agreement.agreement.assignment_id.clone(),
        root_agreement_hash: digest(&bundle.agreement.agreement)?,
        current_agreement_hash: report.current_agreement_hash,
        context_hash: annex.map(|a| digest(&a.context)).transpose()?,
        trust_hash: digest(trust)?,
        frontier: supplied_frontier(&bundle)?,
        bundle,
        scope,
        access: SharedAccessPolicyV1::default(),
        evidence: vec![],
        lifecycle: CaseLifecycleV1::Open,
    };
    // An absent/incomplete annex may be retained for inspection, not analysis.
    validate_shape(&case, trust, None)?;
    Ok(case)
}

fn validate_shape(
    case: &DisputeCaseV1,
    trust: &TrustConfiguration,
    previous: Option<&DisputeCaseV1>,
) -> Result<(), String> {
    ensure(
        case.version == "1",
        "CASE_VERSION: unsupported case version",
    )?;
    validate_id(&case.case_id)?;
    ensure(case.revision <= 1_000_000, "CASE_REVISION: revision limit")?;
    ensure(
        case.deployment_domain == case.bundle.deployment_domain
            && case.assignment_id == case.bundle.agreement.agreement.assignment_id,
        "CASE_BINDING: assignment/domain changed",
    )?;
    ensure(
        case.trust_hash == digest(trust)?,
        "CASE_TRUST: independent trust differs",
    )?;
    ensure(
        case.root_agreement_hash == digest(&case.bundle.agreement.agreement)?,
        "CASE_ROOT: wrong root",
    )?;
    ensure(
        case.frontier == supplied_frontier(&case.bundle)?,
        "CASE_FRONTIER: supplied history inventory differs",
    )?;
    ensure(
        !case.scope.is_empty() && case.scope.len() <= 32,
        "CASE_SCOPE: bounded nonempty scope required",
    )?;
    let mut scopes = BTreeSet::new();
    for scope in &case.scope {
        validate_id(scope)?;
        ensure(scopes.insert(scope), "CASE_SCOPE: duplicate scope")?;
    }
    ensure(
        case.access.version == "1"
            && case.access.audience == SharedAccessPolicyV1::default().audience,
        "CASE_ACCESS: every party must receive the same package",
    )?;
    validate_id(&case.access.selection_policy)?;
    validate_id(&case.access.redaction_policy)?;
    ensure(
        case.evidence.len() <= MAX_CASE_ITEMS,
        "CASE_ITEMS: too many items",
    )?;
    let mut ids = BTreeSet::new();
    for item in &case.evidence {
        validate_id(&item.id)?;
        ensure(
            !RESERVED_REFERENCES.contains(&item.id.as_str()) && ids.insert(&item.id),
            "CASE_ITEM_ID: reserved or duplicate id",
        )?;
    }
    if let Some(context) = &case.context_hash {
        validate_digest(context)?;
    }
    match (previous, case.parent_case_hash.as_ref()) {
        (None, None) => ensure(case.revision == 0, "CASE_PARENT: missing previous revision")?,
        (Some(prior), Some(parent)) => {
            ensure(
                parent == &digest(prior)? && case.revision == prior.revision + 1,
                "CASE_PARENT: revision or parent differs",
            )?;
            ensure(
                case.case_id == prior.case_id
                    && case.root_agreement_hash == prior.root_agreement_hash
                    && case.trust_hash == prior.trust_hash
                    && case.context_hash == prior.context_hash
                    && case.scope == prior.scope,
                "CASE_REPLACEMENT: old dispute identity/context/scope cannot be replaced",
            )?;
            let merged = local::merge_bundles(&prior.bundle, &case.bundle)?;
            let normalized = local::merge_bundles(&case.bundle, &case.bundle)?;
            ensure(
                digest(&merged)? == digest(&normalized)?,
                "CASE_HISTORY: contractual records cannot be removed",
            )?;
            for old in &prior.evidence {
                let new = case
                    .evidence
                    .iter()
                    .find(|item| item.id == old.id)
                    .ok_or("CASE_HISTORY: mark removed evidence explicitly omitted")?;
                ensure(
                    old.content_sha256 == new.content_sha256
                        && old.byte_length == new.byte_length
                        && old.media_type == new.media_type
                        && old.origin == new.origin,
                    "CASE_HISTORY: an original claim cannot be silently replaced",
                )?;
            }
        }
        _ => return Err("CASE_PARENT: exact previous revision required".into()),
    }
    canonical(case)?;
    Ok(())
}

fn submission_scope(body: &EvidenceSubmissionBodyV1) -> AttributionScopeV1 {
    AttributionScopeV1 {
        agreement_hash: body.agreement_hash.clone(),
        context_hash: body.context_hash.clone(),
        record_id: body.submission_id.clone(),
        kind: SubmissionKind::EvidenceSubmission,
        author_role: body.author_role,
    }
}

pub fn submission_claims(
    body: &EvidenceSubmissionBodyV1,
    base: &AssignmentBundle,
    trust: &TrustConfiguration,
) -> Result<crypto::SignatureClaims, String> {
    binding::attributed_claims(body, &submission_scope(body), base, trust)
}

fn inspect_item(
    item: &EvidenceItemV1,
    case: &DisputeCaseV1,
    trust: &TrustConfiguration,
    core: &BundleReport,
) -> Result<(EvidenceInspectionV1, Value, bool), String> {
    validate_digest(&item.content_sha256)?;
    ensure(
        item.byte_length <= MAX_EVIDENCE_BYTES,
        "EVIDENCE_SIZE: original exceeds item limit",
    )?;
    text(&item.media_type, 128)?;
    ensure(
        item.media_type.contains('/'),
        "EVIDENCE_MEDIA: expected media type",
    )?;
    let (role, offer) = match &item.origin {
        EvidenceOriginV1::Submission { signed } => {
            let b = &signed.body;
            ensure(
                b.version == "1"
                    && b.case_id == case.case_id
                    && b.submission_id == item.id
                    && Some(&b.context_hash) == case.context_hash.as_ref()
                    && b.agreement_hash == case.current_agreement_hash,
                "EVIDENCE_BINDING: wrong case, context, Agreement or item",
            )?;
            ensure(
                b.content_sha256 == item.content_sha256
                    && b.byte_length == item.byte_length
                    && b.media_type == item.media_type,
                "EVIDENCE_ORIGINAL: signed original metadata differs",
            )?;
            binding::verify_attributed(
                b,
                &signed.authorization,
                &submission_scope(b),
                &case.bundle,
                trust,
            )?;
            ensure(
                (b.statement_kind == StatementKindV1::PartyOffer) == b.party_offer.is_some(),
                "EVIDENCE_OFFER: explicit typed party offer required",
            )?;
            if let Some(money) = &b.party_offer {
                ensure(
                    matches!(b.author_role, Role::Requester | Role::Operator),
                    "EVIDENCE_OFFER: only R/O party-authored offers supported",
                )?;
                money.validate()?;
            }
            (b.author_role, b.party_offer.clone())
        }
        EvidenceOriginV1::CoreEvent { event_hash } => {
            ensure(
                item.media_type == "application/json",
                "EVIDENCE_EVENT: canonical envelope has application/json media type",
            )?;
            let event =
                core.transcript.proof_events.get(event_hash).ok_or(
                    "EVIDENCE_EVENT: authenticated structurally valid original event absent",
                )?;
            let bytes = canonical(&event.envelope)?;
            ensure(
                bytes_digest(&bytes) == item.content_sha256
                    && bytes.len() as u64 == item.byte_length,
                "EVIDENCE_EVENT: original must be the exact canonical signed envelope",
            )?;
            let role = match event.envelope.author_role.as_str() {
                "R" => Role::Requester,
                "O" => Role::Operator,
                "M" => Role::Mediator,
                _ => return Err("EVIDENCE_ROLE".into()),
            };
            (role, None)
        }
    };
    let original = match &item.availability {
        EvidenceAvailabilityV1::Accessible { bytes_b64 } => {
            let bytes = crypto::decode_base64url(bytes_b64, item.byte_length as usize)?;
            ensure(
                bytes_digest(&bytes) == item.content_sha256,
                "EVIDENCE_BYTES: original digest mismatch",
            )?;
            Some(bytes)
        }
        EvidenceAvailabilityV1::Redacted { reason }
        | EvidenceAvailabilityV1::Omitted { reason }
        | EvidenceAvailabilityV1::Inaccessible { reason } => {
            text(reason, 2048)?;
            None
        }
    };
    ensure(item.extractions.len() <= 8, "EXTRACTION_LIMIT")?;
    for extraction in &item.extractions {
        ensure(
            extraction.source_sha256 == item.content_sha256,
            "EXTRACTION_SOURCE: source digest differs",
        )?;
        text(&extraction.producer, 256)?;
        text(&extraction.tool_version, 256)?;
        text(&extraction.text, MAX_TEXT_BYTES)?;
    }
    if let Some(appraisal) = &item.submitted_sensor_appraisal {
        ensure(
            appraisal.source_sha256 == item.content_sha256,
            "APPRAISAL_SOURCE: source digest differs",
        )?;
        text(&appraisal.producer, 256)?;
        text(&appraisal.text, MAX_TEXT_BYTES)?;
    }
    // Unavailable originals do not secretly contribute extracts or sensor claims.
    ensure(
        original.is_some()
            || (item.extractions.is_empty() && item.submitted_sensor_appraisal.is_none()),
        "HIDDEN_EVIDENCE: inaccessible/redacted originals cannot contribute merits text",
    )?;
    let accessible = original.is_some();
    let original_text = original.as_ref().and_then(|bytes| {
        if item.media_type.starts_with("text/") || item.media_type == "application/json" {
            std::str::from_utf8(bytes).ok().map(str::to_owned)
        } else {
            None
        }
    });
    let material = json!({
        "id":item.id, "content_sha256":item.content_sha256,"media_type":item.media_type,"byte_length":item.byte_length,
        "author_role":role,"original_bytes_verified":accessible,"availability": match &item.availability {
            EvidenceAvailabilityV1::Accessible { .. } => json!({"type":"ACCESSIBLE"}), other => serde_json::to_value(other).map_err(|e|e.to_string())? },
        "original_text_untrusted":original_text,"extractions_untrusted":item.extractions,
        "supplied_sensor_appraisal_unverified":item.submitted_sensor_appraisal,
        "party_offer_not_an_award":if accessible {offer.clone()} else {None},
        "boundary":"Authorship/integrity only. Text model has not seen images, heard audio, or independently verified sensor evidence. No physical truth or fault inferred."
    });
    Ok((
        EvidenceInspectionV1 {
            id: item.id.clone(),
            authenticated_role: Some(role),
            original_bytes_verified: accessible,
            accessible_to_all_parties: accessible,
            interpretation: "ATTRIBUTED_CLAIM_NOT_ESTABLISHED_FACT".into(),
            diagnostics: vec![],
        },
        material,
        accessible && offer.is_some(),
    ))
}

pub fn inspect_case(
    case: &DisputeCaseV1,
    trust: &TrustConfiguration,
    annex: Option<&SignedDisputeContextV1>,
    previous: Option<&DisputeCaseV1>,
) -> Result<CaseInspection, String> {
    // Always recompute the financial projection before considering ancillary data.
    let core = bundle::verify_assignment_bundle(&case.bundle, trust)?;
    let case_hash = digest(case)?;
    let mut diagnostics = Vec::new();
    let context_report = match binding::verify_context(annex, &case.bundle, trust) {
        Ok(report) => report,
        Err(error) => {
            diagnostics.push(format!("CASE_CONTEXT: {error}"));
            ContextReport {
                base_agreement_bound: core.agreement.bound,
                extension_status: "INVALID".into(),
                extended_setup_complete: false,
                context_hash: None,
                valid_signers: vec![],
                diagnostics: vec![error],
            }
        }
    };
    if let Err(error) = validate_shape(case, trust, previous) {
        diagnostics.push(error);
    }
    if case.current_agreement_hash != core.current_agreement_hash {
        diagnostics
            .push("CASE_AGREEMENT: current Agreement does not match core verification".into());
    }
    let expected_context = annex.map(|a| digest(&a.context)).transpose()?;
    if expected_context != case.context_hash {
        diagnostics.push("CASE_CONTEXT: exact annex absent or substituted".into());
    }
    if annex.is_some_and(|a| a.context.agreement_hash != case.current_agreement_hash) {
        diagnostics.push("CASE_CONTEXT: annex must bind the exact applicable Agreement; no retrospective profile replacement".into());
    }
    if let Some(annex) = annex {
        let spec = &annex.context.analysis_specification;
        if spec
            .get("evidence_selection_policy")
            .and_then(Value::as_str)
            != Some(case.access.selection_policy.as_str())
            || spec.get("redaction_policy").and_then(Value::as_str)
                != Some(case.access.redaction_policy.as_str())
            || spec.get("evidence_ordering_policy").and_then(Value::as_str)
                != Some("stable-item-id-v1")
            || spec.get("extraction_policy").and_then(Value::as_str)
                != Some("attributed-text-only-v1")
        {
            diagnostics.push("CASE_POLICY: evidence selection/order/extraction/redaction differs from the signed specification".into());
        }
    }
    let mut items = Vec::new();
    let mut materials = Vec::new();
    let mut references = RESERVED_REFERENCES
        .iter()
        .map(|id| (*id).to_owned())
        .collect::<Vec<_>>();
    let mut offers = Vec::new();
    for item in &case.evidence {
        match inspect_item(item, case, trust, &core) {
            Ok((report, material, offer)) => {
                if report.original_bytes_verified {
                    references.push(item.id.clone());
                }
                if offer {
                    offers.push(item.id.clone());
                }
                items.push(report);
                materials.push(material);
            }
            Err(error) => {
                diagnostics.push(format!("{}: {error}", item.id));
                items.push(EvidenceInspectionV1 {
                    id: item.id.clone(),
                    authenticated_role: None,
                    original_bytes_verified: false,
                    accessible_to_all_parties: false,
                    interpretation: "UNVERIFIED_ANCILLARY_INPUT".into(),
                    diagnostics: vec![error],
                });
                materials.push(json!({"id":item.id,"status":"UNVERIFIED_EXCLUDED_FROM_ANALYSIS"}));
            }
        }
    }
    let ancillary_valid = diagnostics.is_empty();
    let analysis_ready = ancillary_valid && context_report.extended_setup_complete;
    materials.sort_by(|left, right| left["id"].as_str().cmp(&right["id"].as_str()));
    references.sort();
    offers.sort();
    let agreement = if core.agreement.bound && case.bundle.protocol_version == "2" {
        serde_json::to_value(bundle::known_contract(
            &case.bundle,
            &core.current_agreement_hash,
            trust,
        )?)
        .map_err(|e| e.to_string())?
    } else {
        serde_json::to_value(&case.bundle.agreement.agreement).map_err(|e| e.to_string())?
    };
    let material = json!({
        "authority_mode":"ANALYSIS_ONLY","settlement_policy_status":"UNSPECIFIED","financial_authority":"NONE",
        "case_hash":case_hash,"scope":case.scope,"access":case.access,"agreement":agreement,
        "financial-report": {"financial_projection":core.financial_projection,"obligations":core.obligations,
            "unresolved_rights":core.unresolved_rights,"recognized_legacy_proofs":core.recognized_legacy_proofs,
            "payments":core.payments,"effects":core.effects,"unresolved_claims":core.unresolved_claims,
            "history_completeness":core.history_completeness,"diagnostics":core.diagnostics},
        "evidence":materials,"history_notice":"The supplied frontier may be incomplete. Missing evidence is not fault."
    });
    Ok(CaseInspection {
        case_hash,
        core_report: core,
        ancillary_valid,
        analysis_ready,
        context_report,
        diagnostics,
        items,
        material,
        references,
        offers,
    })
}

pub fn analysis_material(
    case: &DisputeCaseV1,
    inspection: &CaseInspection,
) -> Result<Value, String> {
    ensure(
        inspection.case_hash == digest(case)?,
        "CASE_STALE: inspection is for another exact revision",
    )?;
    ensure(
        inspection.analysis_ready,
        "CASE_NOT_READY: verified annex and ancillary inputs required",
    )?;
    Ok(inspection.material.clone())
}

pub fn reference_ids(inspection: &CaseInspection) -> Vec<String> {
    inspection.references.clone()
}
pub fn party_offer_refs(inspection: &CaseInspection) -> Vec<String> {
    inspection.offers.clone()
}

/// Exact reasoning fields, not a generated summary. The archive retains originals.
/// The mapping identifies source objects and deterministic field selections.
pub fn reasoning_projection_v2(
    case: &DisputeCaseV1,
    inspection: &CaseInspection,
) -> Result<Value, String> {
    let source = analysis_material(case, inspection)?;
    let agreement = &source["agreement"];
    let mut terms = serde_json::Map::new();
    let mut mapping = vec![
        json!({"projected_pointer":"/scope","source_id":"case","source_hash":inspection.case_hash,"source_pointer":"/scope","transformation":"EXACT_FIELD"}),
    ];
    for field in [
        "service",
        "policy",
        "acceptance",
        "timing",
        "payments",
        "mediation",
        "assurance",
        "remedies",
        "privacy",
        "legal",
    ] {
        terms.insert(field.into(), agreement[field].clone());
        mapping.push(json!({"projected_pointer":format!("/terms/{field}"),"source_id":"agreement","source_hash":case.current_agreement_hash,"source_pointer":format!("/{field}"),"transformation":"EXACT_FIELD"}));
    }
    for field in ["compensation", "expenses", "milestones"] {
        terms.insert(field.into(), agreement["quote"]["quote"][field].clone());
        mapping.push(json!({"projected_pointer":format!("/terms/{field}"),"source_id":"agreement","source_hash":case.current_agreement_hash,"source_pointer":format!("/quote/quote/{field}"),"transformation":"EXACT_FIELD"}));
    }
    let facts = source["financial-report"].clone();
    mapping.push(json!({"projected_pointer":"/verified_record_facts","source_id":"financial-report","source_hash":digest(&inspection.core_report)?,"transformation":"DETERMINISTIC_CORE_PROJECTION"}));
    let mut evidence = Vec::new();
    for item in source["evidence"].as_array().ok_or("PROJECTION_EVIDENCE")? {
        let mut compact = item.clone();
        if let Some(object) = compact.as_object_mut() {
            // This fixed warning is present in the pinned prompt; never remove
            // source text, extracts, omissions or supplied appraisal content.
            object.remove("boundary");
        }
        let id = item["id"].as_str().ok_or("PROJECTION_EVIDENCE_ID")?;
        let original = case
            .evidence
            .iter()
            .find(|e| e.id == id)
            .ok_or("PROJECTION_SOURCE")?;
        if matches!(&original.origin, EvidenceOriginV1::CoreEvent { .. })
            && let Some(raw) = compact["original_text_untrusted"].as_str()
        {
            let envelope: Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
            compact["exact_core_event_body_untrusted"] = envelope["body"].clone();
            compact["original_text_untrusted"] = Value::Null;
        }
        mapping.push(json!({"projected_pointer":format!("/evidence/{}", evidence.len()),"source_id":id,"source_hash":digest(original)?,"original_content_sha256":original.content_sha256,"transformation":"VERIFIED_ITEM_EXACT_TEXT_AND_CLAIMED_EXTRACTS"}));
        evidence.push(compact);
    }
    Ok(
        json!({"version":"nv-reasoning-projection-v2","case_hash":inspection.case_hash,
        "material":{"scope":case.scope,"terms":terms,"verified_record_facts":facts,"evidence":evidence},"source_map":mapping}),
    )
}

/// New disclosed projection; v2 remains replayable with its original exact bytes.
pub fn reasoning_projection_v3(
    case: &DisputeCaseV1,
    inspection: &CaseInspection,
) -> Result<Value, String> {
    validate_v3_citation_profile(inspection)?;
    let mut p = reasoning_projection_v2(case, inspection)?;
    p["version"] = json!("nv-reasoning-projection-v3");
    p["material"]["available_refs"] = json!(reference_ids(inspection));
    for item in p["material"]["evidence"]
        .as_array_mut()
        .ok_or("PROJECTION_EVIDENCE")?
    {
        let id = item["id"].as_str().ok_or("PROJECTION_ID")?;
        if let Some(original) = case.evidence.iter().find(|e| e.id == id)
            && let EvidenceOriginV1::CoreEvent { event_hash } = &original.origin
            && let Some(event) = inspection
                .core_report
                .transcript
                .proof_events
                .get(event_hash)
        {
            let e = &event.envelope;
            item["attributed_event_context_not_verified_chronology"] = json!({"author_role":e.author_role,"claimed_creation_time":e.claimed_creation_time,"sequence":e.sequence,"previous_event_hash":e.previous_event_hash,"causal_references":e.causal_references,"agreement_hash":e.agreement_hash});
        }
    }
    p["source_map"].as_array_mut().ok_or("PROJECTION_MAP")?.push(json!({"projected_pointer":"/available_refs","source_id":"case","source_hash":inspection.case_hash,"transformation":"VERIFIED_ACCESSIBLE_REFERENCE_ALLOWLIST"}));
    Ok(p)
}

/// Never silently exclude authenticated evidence whose ID the pinned output
/// grammar cannot express. This limit belongs to v3 analysis, not core records.
pub fn validate_v3_citation_profile(inspection: &CaseInspection) -> Result<(), String> {
    validate_citation_profile(inspection, "v3")
}

/// V4 preserves every exact v3 reasoning field, with its own pinned version.
pub fn reasoning_projection_v4(
    case: &DisputeCaseV1,
    inspection: &CaseInspection,
) -> Result<Value, String> {
    validate_v4_citation_profile(inspection)?;
    let mut projection = reasoning_projection_v3(case, inspection)?;
    projection["version"] = json!("nv-reasoning-projection-v4");
    Ok(projection)
}

pub fn validate_v4_citation_profile(inspection: &CaseInspection) -> Result<(), String> {
    validate_citation_profile(inspection, "v4")
}

pub fn reasoning_projection_v5(
    case: &DisputeCaseV1,
    inspection: &CaseInspection,
) -> Result<Value, String> {
    validate_v5_citation_profile(inspection)?;
    let mut projection = reasoning_projection_v4(case, inspection)?;
    projection["version"] = json!("nv-reasoning-projection-v5");
    Ok(projection)
}

pub fn validate_v5_citation_profile(inspection: &CaseInspection) -> Result<(), String> {
    validate_citation_profile(inspection, "v5")
}

fn validate_citation_profile(inspection: &CaseInspection, version: &str) -> Result<(), String> {
    for id in reference_ids(inspection) {
        if id.is_empty()
            || id.len() > 64
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b':' | b'-'))
        {
            return Err(format!(
                "UNSUPPORTED_CITATION_PROFILE: {version} cannot express source ID {id:?}; retain the complete case and use a separately reviewed compatible profile"
            ));
        }
    }
    Ok(())
}

pub fn validate_case_history(
    cases: &[DisputeCaseV1],
    trust: &TrustConfiguration,
    annex: Option<&SignedDisputeContextV1>,
) -> Result<Vec<CaseInspection>, String> {
    ensure(
        !cases.is_empty() && cases.len() <= 128,
        "CASE_HISTORY_LIMIT: expected 1..128 revisions",
    )?;
    let mut reports = Vec::new();
    for (index, case) in cases.iter().enumerate() {
        let mut report = inspect_case(
            case,
            trust,
            annex,
            index.checked_sub(1).map(|previous| &cases[previous]),
        )?;
        if reports
            .iter()
            .any(|prior: &CaseInspection| !prior.ancillary_valid)
        {
            report.ancillary_valid = false;
            report.analysis_ready = false;
            report
                .diagnostics
                .push("CASE_HISTORY: an earlier retained revision is invalid".into());
        }
        reports.push(report);
    }
    Ok(reports)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ChallengeKindV1 {
    Input,
    Attribution,
    Procedure,
    Interpretation,
    RuntimeSpecification,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AnalysisChallengeBodyV1 {
    pub version: String,
    pub challenge_id: String,
    pub case_hash: String,
    pub attempt_hash: Option<String>,
    pub author_role: Role,
    pub agreement_hash: String,
    pub context_hash: String,
    pub kind: ChallengeKindV1,
    pub references: Vec<String>,
    pub text: String,
    pub previous_challenge_hash: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AnalysisChallengeV1 {
    pub body: AnalysisChallengeBodyV1,
    pub authorization: crypto::DetachedSignature,
}

fn challenge_scope(body: &AnalysisChallengeBodyV1) -> AttributionScopeV1 {
    AttributionScopeV1 {
        agreement_hash: body.agreement_hash.clone(),
        context_hash: body.context_hash.clone(),
        record_id: body.challenge_id.clone(),
        kind: SubmissionKind::AnalysisChallenge,
        author_role: body.author_role,
    }
}

pub fn challenge_claims(
    body: &AnalysisChallengeBodyV1,
    base: &AssignmentBundle,
    trust: &TrustConfiguration,
) -> Result<crypto::SignatureClaims, String> {
    binding::attributed_claims(body, &challenge_scope(body), base, trust)
}

pub fn verify_challenge(
    challenge: &AnalysisChallengeV1,
    case: &DisputeCaseV1,
    trust: &TrustConfiguration,
    attempt_hashes: &BTreeSet<String>,
    previous: Option<&AnalysisChallengeV1>,
) -> Result<(), String> {
    let b = &challenge.body;
    ensure(
        b.version == "1"
            && b.case_hash == digest(case)?
            && Some(&b.context_hash) == case.context_hash.as_ref()
            && b.agreement_hash == case.current_agreement_hash,
        "CHALLENGE_CONTEXT: wrong case/annex/Agreement",
    )?;
    validate_id(&b.challenge_id)?;
    text(&b.text, MAX_TEXT_BYTES)?;
    ensure(
        b.references.len() <= MAX_CASE_ITEMS,
        "CHALLENGE_REFERENCES: too many references",
    )?;
    for reference in &b.references {
        ensure(
            RESERVED_REFERENCES.contains(&reference.as_str())
                || case.evidence.iter().any(|item| &item.id == reference),
            "CHALLENGE_REFERENCE: source does not exist",
        )?;
    }
    if let Some(attempt) = &b.attempt_hash {
        ensure(
            attempt_hashes.contains(attempt),
            "CHALLENGE_ATTEMPT: unknown retained attempt",
        )?;
    }
    ensure(
        b.previous_challenge_hash == previous.map(digest).transpose()?,
        "CHALLENGE_HISTORY: exact previous challenge required",
    )?;
    binding::verify_attributed(
        b,
        &challenge.authorization,
        &challenge_scope(b),
        &case.bundle,
        trust,
    )
}

/// Late results are retained under their original identity, never relabelled current.
pub fn attempt_is_stale(
    case: &DisputeCaseV1,
    attempt_case_hash: &str,
    cancelled: bool,
) -> Result<bool, String> {
    validate_digest(attempt_case_hash)?;
    Ok(cancelled || digest(case)? != attempt_case_hash)
}
