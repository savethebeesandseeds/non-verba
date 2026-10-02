// SPDX-License-Identifier: AGPL-3.0-only
//! Typed companion consent. None of these records is a contractual action.
use nonverba_requests::{
    agreement, bundle,
    crypto::{self, DetachedSignature, SignatureClaims},
    encoding,
    model::{
        AssignmentAgreement, AssignmentBundle, PartyBinding, Role, SignedQuote, SignedRequest,
        TrustConfiguration,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

pub const EXTENSION_VERSION: &str = "1";
pub const DICTIONARY_ID: &str = "nv-dispute-priors-5-v1";
pub const PROFILE_PURPOSE: &str = "NONVERBA_DISPUTE_PROFILE_V1";
pub const CONTEXT_PURPOSE: &str = "NONVERBA_DISPUTE_CONTEXT_V1";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DimensionV1 {
    pub id: String,
    pub label: String,
    pub question: String,
    pub boundary: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DictionaryV1 {
    pub dictionary_id: String,
    pub version: String,
    pub maximum_points: u16,
    pub budget_per_dimension: u16,
    pub dimensions: Vec<DimensionV1>,
}

pub fn dictionary() -> DictionaryV1 {
    let definitions = [
        (
            "result",
            "Result",
            "How much emphasis should a proposed resolution place on the usable result and conformity to the agreed scope, quality, and timing?",
            "Does not let either party rewrite the agreed standard after performance.",
        ),
        (
            "effort",
            "Effort",
            "How much emphasis should it place on reasonable, diligent work actually undertaken within the agreed scope?",
            "Does not reward invented hours, avoidable inefficiency, or unauthorized extra work.",
        ),
        (
            "reliance",
            "Reliance",
            "How much emphasis should it place on reasonable commitments, reserved resources, and unrecovered costs incurred in reliance on this agreement?",
            "Applies to either party; does not double-count an already recognized expense or create uncapped liability.",
        ),
        (
            "responsibility",
            "Responsibility",
            "How much emphasis should it place on who could reasonably control, prevent, communicate, or mitigate the cause of a shortfall?",
            "Requires relevant evidence; is not a moral-character score, criminal verdict, or presumption that the Operator caused every failure.",
        ),
        (
            "remedy",
            "Remedy",
            "How much emphasis should it place on a practical, proportionate opportunity to correct, complete, replace, or otherwise resolve a deficient outcome?",
            "Does not require indefinite work, unilateral scope expansion, or automatic unpaid rework. New performance needs the appropriate agreement.",
        ),
    ];
    DictionaryV1 {
        dictionary_id: DICTIONARY_ID.into(),
        version: EXTENSION_VERSION.into(),
        maximum_points: 100,
        budget_per_dimension: 50,
        dimensions: definitions
            .into_iter()
            .map(|(id, label, question, boundary)| DimensionV1 {
                id: id.into(),
                label: label.into(),
                question: question.into(),
                boundary: boundary.into(),
            })
            .collect(),
    }
}

fn ensure(condition: bool, message: &str) -> Result<(), String> {
    if condition {
        Ok(())
    } else {
        Err(message.into())
    }
}

pub fn validate_dictionary(value: &DictionaryV1) -> Result<(), String> {
    ensure(
        value == &dictionary(),
        "DISPUTE_DICTIONARY: unsupported or altered dictionary; definitions and budget are exact",
    )
}

pub fn dictionary_digest() -> Result<String, String> {
    encoding::digest(&dictionary())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Allocation {
    pub dimension_id: String,
    pub points: u16,
}

pub fn validate_allocations(
    allocations: &[Allocation],
    dictionary: &DictionaryV1,
) -> Result<(), String> {
    validate_dictionary(dictionary)?;
    let n = u32::try_from(dictionary.dimensions.len())
        .map_err(|_| "DISPUTE_BUDGET: dimension count overflow")?;
    let budget = u32::from(dictionary.budget_per_dimension)
        .checked_mul(n)
        .ok_or("DISPUTE_BUDGET: budget overflow")?;
    ensure(
        allocations.len() == dictionary.dimensions.len(),
        "DISPUTE_ALLOCATION: exact supported dimension set required",
    )?;
    let mut seen = BTreeSet::new();
    let mut total = 0u32;
    for allocation in allocations {
        ensure(
            dictionary
                .dimensions
                .iter()
                .any(|d| d.id == allocation.dimension_id)
                && seen.insert(&allocation.dimension_id),
            "DISPUTE_ALLOCATION: unknown or duplicate dimension",
        )?;
        ensure(
            allocation.points <= dictionary.maximum_points,
            "DISPUTE_ALLOCATION: points must be integers in 0..100",
        )?;
        total = total
            .checked_add(u32::from(allocation.points))
            .ok_or("DISPUTE_BUDGET: sum overflow")?;
    }
    ensure(
        total == budget,
        "DISPUTE_BUDGET: each Requester and Operator profile must allocate exactly 250 points",
    )
}

/// A suggested draft, never an inferred historical profile or evidence of consent.
pub fn balanced_allocations() -> Vec<Allocation> {
    dictionary()
        .dimensions
        .into_iter()
        .map(|d| Allocation {
            dimension_id: d.id,
            points: 50,
        })
        .collect()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
// Retain complete source records in this bounded, infrequently created annex.
#[allow(clippy::large_enum_variant)]
pub enum ProfileProvenance {
    Request {
        signed_request: SignedRequest,
    },
    Quote {
        signed_request: SignedRequest,
        signed_quote: SignedQuote,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PartyProfileV1 {
    pub extension_version: String,
    pub author: PartyBinding,
    pub dictionary_hash: String,
    pub provenance: ProfileProvenance,
    pub allocations: Vec<Allocation>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedProfileV1 {
    pub profile: PartyProfileV1,
    pub authorization: DetachedSignature,
}

pub fn profile_request(profile: &PartyProfileV1) -> &SignedRequest {
    match &profile.provenance {
        ProfileProvenance::Request { signed_request }
        | ProfileProvenance::Quote { signed_request, .. } => signed_request,
    }
}

pub fn draft_profile(
    provenance: ProfileProvenance,
    allocations: Vec<Allocation>,
    trust: &TrustConfiguration,
) -> Result<PartyProfileV1, String> {
    let author = match &provenance {
        ProfileProvenance::Request { signed_request } => signed_request.request.requester.clone(),
        ProfileProvenance::Quote { signed_quote, .. } => signed_quote.quote.operator.clone(),
    };
    let profile = PartyProfileV1 {
        extension_version: EXTENSION_VERSION.into(),
        author,
        dictionary_hash: dictionary_digest()?,
        provenance,
        allocations,
    };
    validate_profile(&profile, trust)?;
    Ok(profile)
}

pub fn validate_profile(
    profile: &PartyProfileV1,
    trust: &TrustConfiguration,
) -> Result<(), String> {
    ensure(
        profile.extension_version == EXTENSION_VERSION,
        "DISPUTE_VERSION: unsupported profile version",
    )?;
    ensure(
        profile.dictionary_hash == dictionary_digest()?,
        "DISPUTE_DICTIONARY: profile dictionary digest mismatch",
    )?;
    validate_allocations(&profile.allocations, &dictionary())?;
    let expected = match &profile.provenance {
        ProfileProvenance::Request { signed_request } => {
            agreement::verify_request(signed_request, trust)?;
            &signed_request.request.requester
        }
        ProfileProvenance::Quote {
            signed_request,
            signed_quote,
        } => {
            agreement::verify_quote(signed_quote, signed_request, trust)?;
            &signed_quote.quote.operator
        }
    };
    ensure(
        &profile.author == expected,
        "DISPUTE_AUTHOR: only the Requester/Operator that authored the exact source may author its profile",
    )
}

pub fn profile_claims(
    profile: &PartyProfileV1,
    trust: &TrustConfiguration,
) -> Result<SignatureClaims, String> {
    validate_profile(profile, trust)?;
    let request = &profile_request(profile).request;
    Ok(agreement::claims(
        &request.deployment_domain,
        &request.request_id,
        &encoding::digest(profile)?,
        &profile.author,
        PROFILE_PURPOSE,
    ))
}

pub fn verify_profile(
    profile: &SignedProfileV1,
    trust: &TrustConfiguration,
) -> Result<String, String> {
    let claims = profile_claims(&profile.profile, trust)?;
    crypto::verify(&profile.authorization, &claims, &profile.profile.author.key)?;
    Ok(claims.content_hash)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SettlementPolicyStatus {
    Unspecified,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AuthorityMode {
    AnalysisOnly,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisputeContextV1 {
    pub extension_version: String,
    pub deployment_domain: String,
    pub assignment_id: String,
    pub agreement_hash: String,
    pub dictionary: DictionaryV1,
    pub requester_profile: SignedProfileV1,
    pub operator_profile: SignedProfileV1,
    pub analysis_specification: Value,
    pub analysis_specification_hash: String,
    pub settlement_policy_status: SettlementPolicyStatus,
    pub authority_mode: AuthorityMode,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedDisputeContextV1 {
    pub context: DisputeContextV1,
    pub endorsements: Vec<DetachedSignature>,
}

fn base_agreement(
    base: &AssignmentBundle,
    hash: &str,
    trust: &TrustConfiguration,
) -> Result<AssignmentAgreement, String> {
    ensure(
        base.protocol_version == "2",
        "DISPUTE_BASE_UNSUPPORTED: legacy base records remain inspection-only; no inferred profiles",
    )?;
    bundle::known_agreement(base, hash, trust)
}

pub fn validate_context(
    context: &DisputeContextV1,
    base: &AssignmentBundle,
    trust: &TrustConfiguration,
) -> Result<(), String> {
    ensure(
        context.extension_version == EXTENSION_VERSION,
        "DISPUTE_VERSION: unsupported context version",
    )?;
    validate_dictionary(&context.dictionary)?;
    let a = base_agreement(base, &context.agreement_hash, trust)?;
    ensure(
        context.deployment_domain == a.deployment_domain
            && context.assignment_id == a.assignment_id,
        "DISPUTE_BINDING: wrong Agreement identity/domain",
    )?;
    let r_hash = verify_profile(&context.requester_profile, trust)?;
    let o_hash = verify_profile(&context.operator_profile, trust)?;
    let r = &context.requester_profile.profile;
    let o = &context.operator_profile.profile;
    ensure(
        r.author.role == Role::Requester && o.author.role == Role::Operator,
        "DISPUTE_AUTHOR: profiles must be independently authored by R and O",
    )?;
    ensure(
        encoding::digest(&profile_request(r).request)? == a.request_hash
            && encoding::digest(&profile_request(o).request)? == a.request_hash,
        "DISPUTE_BINDING: profiles reference another Request revision",
    )?;
    let ProfileProvenance::Quote { signed_quote, .. } = &o.provenance else {
        return Err("DISPUTE_BINDING: Operator profile requires exact signed Quote".into());
    };
    ensure(
        encoding::digest(&signed_quote.quote)? == encoding::digest(&a.quote.quote)?,
        "DISPUTE_BINDING: Operator profile references another Quote",
    )?;
    ensure(
        encoding::digest(&context.analysis_specification)? == context.analysis_specification_hash,
        "DISPUTE_SPEC: specification digest mismatch",
    )?;
    crate::spec::validate_spec_value(&context.analysis_specification)?;
    for (field, expected) in [
        ("dictionary_hash", encoding::digest(&context.dictionary)?),
        ("requester_profile_hash", r_hash),
        ("operator_profile_hash", o_hash),
    ] {
        ensure(
            context
                .analysis_specification
                .get(field)
                .and_then(Value::as_str)
                == Some(expected.as_str()),
            "DISPUTE_SPEC: specification must bind exact dictionary and both profile content digests",
        )?;
    }
    ensure(
        encoding::canonical(context)?.len() <= 1024 * 1024,
        "DISPUTE_SIZE: context exceeds 1 MiB",
    )
}

pub fn draft_context(
    base: &AssignmentBundle,
    agreement_hash: &str,
    requester_profile: SignedProfileV1,
    operator_profile: SignedProfileV1,
    analysis_specification: Value,
    trust: &TrustConfiguration,
) -> Result<DisputeContextV1, String> {
    let a = base_agreement(base, agreement_hash, trust)?;
    let context = DisputeContextV1 {
        extension_version: EXTENSION_VERSION.into(),
        deployment_domain: a.deployment_domain,
        assignment_id: a.assignment_id,
        agreement_hash: agreement_hash.into(),
        dictionary: dictionary(),
        requester_profile,
        operator_profile,
        analysis_specification_hash: encoding::digest(&analysis_specification)?,
        analysis_specification,
        settlement_policy_status: SettlementPolicyStatus::Unspecified,
        authority_mode: AuthorityMode::AnalysisOnly,
    };
    validate_context(&context, base, trust)?;
    Ok(context)
}

pub fn context_claims(
    context: &DisputeContextV1,
    base: &AssignmentBundle,
    trust: &TrustConfiguration,
    role: Role,
) -> Result<SignatureClaims, String> {
    validate_context(context, base, trust)?;
    let a = base_agreement(base, &context.agreement_hash, trust)?;
    Ok(agreement::claims(
        &context.deployment_domain,
        &context.assignment_id,
        &encoding::digest(context)?,
        agreement::party(&a, role)?,
        CONTEXT_PURPOSE,
    ))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContextReport {
    pub base_agreement_bound: bool,
    pub extension_status: String,
    pub extended_setup_complete: bool,
    pub context_hash: Option<String>,
    pub valid_signers: Vec<Role>,
    pub diagnostics: Vec<String>,
}

pub fn verify_context(
    annex: Option<&SignedDisputeContextV1>,
    base: &AssignmentBundle,
    trust: &TrustConfiguration,
) -> Result<ContextReport, String> {
    let base_report = bundle::verify_assignment_bundle(base, trust)?;
    let mut report = ContextReport {
        base_agreement_bound: base_report.agreement.bound,
        extension_status: "NOT_SPECIFIED".into(),
        extended_setup_complete: false,
        context_hash: None,
        valid_signers: vec![],
        diagnostics: vec![],
    };
    let Some(annex) = annex else {
        return Ok(report);
    };
    report.context_hash = Some(encoding::digest(&annex.context)?);
    if annex.context.extension_version != EXTENSION_VERSION || base.protocol_version != "2" {
        report.extension_status = "UNSUPPORTED".into();
        report.diagnostics.push("DISPUTE_VERSION: unsupported extension/base combination; independently verified base rights are unchanged".into());
        return Ok(report);
    }
    if let Err(error) = validate_context(&annex.context, base, trust) {
        report.extension_status = "INVALID".into();
        report.diagnostics.push(error);
        return Ok(report);
    }
    let a = base_agreement(base, &annex.context.agreement_hash, trust)?;
    for signature in &annex.endorsements {
        let Some(party) = a
            .parties
            .iter()
            .find(|p| p.role.code() == signature.claims.role)
        else {
            report
                .diagnostics
                .push("DISPUTE_SIGNER: signer is not an independently trusted party".into());
            continue;
        };
        let expected = agreement::claims(
            &a.deployment_domain,
            &a.assignment_id,
            report.context_hash.as_deref().unwrap_or_default(),
            party,
            CONTEXT_PURPOSE,
        );
        match crypto::verify(signature, &expected, &party.key) {
            Ok(()) => {
                if !report.valid_signers.contains(&party.role) {
                    report.valid_signers.push(party.role);
                }
            }
            Err(error) => report.diagnostics.push(error),
        }
    }
    report.valid_signers.sort();
    report.extended_setup_complete = report.valid_signers.len() == 3;
    report.extension_status = if report.extended_setup_complete {
        "BOUND"
    } else {
        "INCOMPLETE"
    }
    .into();
    if !report.extended_setup_complete {
        report
            .diagnostics
            .push("DISPUTE_ENDORSEMENTS: all three exact-context endorsements required".into());
    }
    Ok(report)
}

/// Merge signatures only for identical context content. No retroactive replacement.
pub fn merge_context_endorsements(
    left: &SignedDisputeContextV1,
    right: &SignedDisputeContextV1,
) -> Result<SignedDisputeContextV1, String> {
    ensure(
        encoding::digest(&left.context)? == encoding::digest(&right.context)?,
        "DISPUTE_IMMUTABLE: a different context cannot replace this retained context",
    )?;
    let mut merged = left.clone();
    for signature in &right.endorsements {
        if !merged.endorsements.contains(signature) {
            merged.endorsements.push(signature.clone());
        }
    }
    Ok(merged)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SubmissionKind {
    EvidenceSubmission,
    AnalysisChallenge,
}

impl SubmissionKind {
    pub fn purpose(self) -> &'static str {
        match self {
            Self::EvidenceSubmission => "NONVERBA_DISPUTE_SUBMISSION_V1",
            Self::AnalysisChallenge => "NONVERBA_DISPUTE_CHALLENGE_V1",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttributionScopeV1 {
    pub agreement_hash: String,
    pub context_hash: String,
    pub record_id: String,
    pub kind: SubmissionKind,
    pub author_role: Role,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttributedStatementV1 {
    pub extension_version: String,
    pub authority_mode: AuthorityMode,
    pub scope: AttributionScopeV1,
    pub payload: Value,
}

pub fn attributed_statement<T: Serialize>(
    payload: &T,
    scope: &AttributionScopeV1,
) -> Result<AttributedStatementV1, String> {
    encoding::validate_digest(&scope.agreement_hash)?;
    encoding::validate_digest(&scope.context_hash)?;
    encoding::validate_id(&scope.record_id)?;
    let statement = AttributedStatementV1 {
        extension_version: EXTENSION_VERSION.into(),
        authority_mode: AuthorityMode::AnalysisOnly,
        scope: scope.clone(),
        payload: serde_json::to_value(payload).map_err(|e| format!("DISPUTE_RECORD: {e}"))?,
    };
    ensure(
        encoding::canonical(&statement)?.len() <= 256 * 1024,
        "DISPUTE_RECORD: attributed record exceeds 256 KiB",
    )?;
    Ok(statement)
}

pub fn attributed_claims<T: Serialize>(
    payload: &T,
    scope: &AttributionScopeV1,
    base: &AssignmentBundle,
    trust: &TrustConfiguration,
) -> Result<SignatureClaims, String> {
    let a = base_agreement(base, &scope.agreement_hash, trust)?;
    let statement = attributed_statement(payload, scope)?;
    Ok(agreement::claims(
        &a.deployment_domain,
        &a.assignment_id,
        &encoding::digest(&statement)?,
        agreement::party(&a, scope.author_role)?,
        scope.kind.purpose(),
    ))
}

pub fn verify_attributed<T: Serialize>(
    payload: &T,
    signature: &DetachedSignature,
    scope: &AttributionScopeV1,
    base: &AssignmentBundle,
    trust: &TrustConfiguration,
) -> Result<(), String> {
    let claims = attributed_claims(payload, scope, base, trust)?;
    let a = base_agreement(base, &scope.agreement_hash, trust)?;
    crypto::verify(
        signature,
        &claims,
        &agreement::party(&a, scope.author_role)?.key,
    )
}
