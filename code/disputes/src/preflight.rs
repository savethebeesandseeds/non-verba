// SPDX-License-Identifier: AGPL-3.0-only
//! Local pre-cooperation workflow protection, separate from contractual consent.
use crate::{
    binding::{self, *},
    consent::{self, ConsentReviewV1},
};
use nonverba_requests::{
    contract,
    crypto::{self, DetachedSignature},
    encoding, local,
    model::{AssignmentBundle, Role, TrustConfiguration},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use zeroize::Zeroizing;

const FORMAT: &str = "nv-dispute-preflight-v1";
fn ensure(ok: bool, error: &str) -> Result<(), String> {
    if ok { Ok(()) } else { Err(error.into()) }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreflightReviewV1 {
    pub format: String,
    pub dictionary: PriorsCatalogV1,
    pub requester_profile: SignedDeclaredPriorsV1,
    pub operator_profile: SignedDeclaredPriorsV1,
    pub analysis_specification: Value,
    pub request_hash: String,
    pub quote_hash: String,
    pub requester_profile_hash: String,
    pub operator_profile_hash: String,
    pub specification_hash: String,
    pub trust_hash: String,
    pub settlement_policy_status: SettlementPolicyStatus,
    pub authority_mode: AuthorityMode,
}

impl PreflightReviewV1 {
    pub fn new(
        r: SignedDeclaredPriorsV1,
        o: SignedDeclaredPriorsV1,
        spec: Value,
        trust: &TrustConfiguration,
    ) -> Result<Self, String> {
        let r_hash = binding::verify_declared_priors(&r, trust)?;
        let o_hash = binding::verify_declared_priors(&o, trust)?;
        ensure(
            r.profile.author.role == Role::Requester && o.profile.author.role == Role::Operator,
            "PREFLIGHT_ROLES: separate independently authored R and O profiles required",
        )?;
        let request_hash = encoding::digest(&binding::declared_priors_request(&r.profile).request)?;
        ensure(
            request_hash
                == encoding::digest(&binding::declared_priors_request(&o.profile).request)?,
            "PREFLIGHT_SOURCE: profiles must reference the same exact Request",
        )?;
        let ProfileProvenance::Quote { signed_quote, .. } = &o.profile.provenance else {
            return Err("PREFLIGHT_SOURCE: signed Operator Quote required".into());
        };
        crate::spec::validate_spec_value(&spec)?;
        for (field, hash) in [
            ("dictionary_hash", binding::priors_catalog_digest()?),
            ("requester_profile_hash", r_hash.clone()),
            ("operator_profile_hash", o_hash.clone()),
        ] {
            ensure(
                spec.get(field).and_then(Value::as_str) == Some(hash.as_str()),
                "PREFLIGHT_SPEC: exact dictionary and profile hashes required",
            )?;
        }
        Ok(Self {
            format: FORMAT.into(),
            dictionary: binding::priors_catalog(),
            quote_hash: encoding::digest(&signed_quote.quote)?,
            request_hash,
            requester_profile_hash: r_hash,
            operator_profile_hash: o_hash,
            specification_hash: encoding::digest(&spec)?,
            requester_profile: r,
            operator_profile: o,
            analysis_specification: spec,
            trust_hash: encoding::digest(trust)?,
            settlement_policy_status: SettlementPolicyStatus::Unspecified,
            authority_mode: AuthorityMode::AnalysisOnly,
        })
    }
    pub fn validate(&self, trust: &TrustConfiguration) -> Result<(), String> {
        let expected = Self::new(
            self.requester_profile.clone(),
            self.operator_profile.clone(),
            self.analysis_specification.clone(),
            trust,
        )?;
        ensure(
            encoding::canonical(self)? == encoding::canonical(&expected)?,
            "PREFLIGHT_CHANGED: retained source, fingerprint, dictionary, settings or independent trust changed",
        )
    }
    pub fn digest(&self) -> Result<String, String> {
        encoding::digest(self)
    }
    pub fn render(&self, trust: &TrustConfiguration) -> Result<String, String> {
        self.validate(trust)?;
        let mut text = format!(
            "PRE-COOPERATION REVIEW\nExact preflight digest: {}\nLOCAL WORKFLOW REVIEW — not a Contract endorsement.\nPrior | Requester points | Operator points\n",
            self.digest()?
        );
        for d in &self.dictionary.dimensions {
            let points = |p: &SignedDeclaredPriorsV1| {
                p.profile
                    .allocations
                    .iter()
                    .find(|a| a.dimension_id == d.id)
                    .map(|a| a.points)
                    .ok_or("PREFLIGHT_DIMENSION")
            };
            text.push_str(&format!(
                "{} | {} | {}\n",
                d.label,
                points(&self.requester_profile)?,
                points(&self.operator_profile)?
            ));
        }
        text.push_str("Each declaration totals 250 points. Zero waives no right; 100 is not a payment percentage. There is no settlement prediction or selected formula.\nAccept or decline before signing the base Contract. Acceptance is a local workflow record, not authenticated consent by another party. Base and annex signatures remain separate and are not atomic. This is not permission to actuate a robot or a physical-safety finding.\nEXACT DECLARED PRIORS, SETTINGS, SOURCES AND FINGERPRINTS:\n");
        text.push_str(&serde_json::to_string_pretty(self).map_err(|e| e.to_string())?);
        Ok(text)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Decision {
    Accept,
    Decline,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalDecisionV1 {
    pub format: String,
    pub record_kind: String,
    pub participant_role: Role,
    pub review_hash: String,
    pub decision: Decision,
}
pub fn decide(
    review: &PreflightReviewV1,
    trust: &TrustConfiguration,
    role: Role,
    decision: Decision,
    confirmed: &str,
) -> Result<LocalDecisionV1, String> {
    review.validate(trust)?;
    ensure(
        !confirmed.is_empty(),
        "PREFLIGHT_CANCELLED: no local decision recorded",
    )?;
    ensure(
        confirmed == review.digest()?,
        "PREFLIGHT_CONFIRMATION: exact full preflight digest required",
    )?;
    Ok(LocalDecisionV1 {
        format: FORMAT.into(),
        record_kind: "UNSIGNED_LOCAL_WORKFLOW_DECISION".into(),
        participant_role: role,
        review_hash: confirmed.into(),
        decision,
    })
}
fn accepted(
    review: &PreflightReviewV1,
    decision: &LocalDecisionV1,
    trust: &TrustConfiguration,
) -> Result<(), String> {
    review.validate(trust)?;
    ensure(
        decision.format == FORMAT
            && decision.record_kind == "UNSIGNED_LOCAL_WORKFLOW_DECISION"
            && decision.review_hash == review.digest()?,
        "PREFLIGHT_CHANGED: local decision does not cover this exact reviewed material",
    )?;
    ensure(
        decision.decision == Decision::Accept,
        "PREFLIGHT_DECLINED: no base endorsement or extended setup through this local workflow",
    )
}
pub fn check_candidate(
    review: &PreflightReviewV1,
    decision: &LocalDecisionV1,
    base: &AssignmentBundle,
    trust: &TrustConfiguration,
) -> Result<(), String> {
    accepted(review, decision, trust)?;
    let a = &base.agreement.agreement;
    contract::validate_contract(a, &base.requests, trust)?;
    ensure(
        a.request_hash == review.request_hash
            && encoding::digest(&a.quote.quote)? == review.quote_hash,
        "PREFLIGHT_SUBSTITUTION: candidate Contract differs from the reviewed Request or Quote",
    )
}
pub fn check_context(
    review: &PreflightReviewV1,
    decision: &LocalDecisionV1,
    context: &DisputeContextV1,
    base: &AssignmentBundle,
    trust: &TrustConfiguration,
) -> Result<(), String> {
    accepted(review, decision, trust)?;
    binding::validate_context(context, base, trust)?;
    ensure(
        encoding::canonical(&context.requester_profile)?
            == encoding::canonical(&review.requester_profile)?
            && encoding::canonical(&context.operator_profile)?
                == encoding::canonical(&review.operator_profile)?
            && encoding::canonical(&context.dictionary)?
                == encoding::canonical(&review.dictionary)?
            && context.analysis_specification_hash == review.specification_hash
            && encoding::canonical(&context.analysis_specification)?
                == encoding::canonical(&review.analysis_specification)?,
        "PREFLIGHT_SUBSTITUTION: annex profiles, dictionary or analysis settings differ from the retained review",
    )
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BaseSigningReviewV1 {
    pub format: String,
    pub preflight: PreflightReviewV1,
    pub local_decision: LocalDecisionV1,
    pub base: AssignmentBundle,
    pub agreement_hash: String,
}
impl BaseSigningReviewV1 {
    pub fn new(
        preflight: PreflightReviewV1,
        decision: LocalDecisionV1,
        base: AssignmentBundle,
        trust: &TrustConfiguration,
    ) -> Result<Self, String> {
        check_candidate(&preflight, &decision, &base, trust)?;
        let a = &base.agreement.agreement;
        ensure(
            a.revision == "1" && a.previous_agreement_hash.is_none(),
            "PREFLIGHT_BASE: this command endorses only an initial base Contract; amendments keep their existing path",
        )?;
        let result = contract::verify_contract(&base.agreement, &base.requests, trust);
        if let Some(d) = result
            .diagnostics
            .iter()
            .find(|d| d.code != "MISSING_SIGNATURE")
        {
            return Err(format!("{}: {}", d.code, d.message));
        }
        Ok(Self {
            format: FORMAT.into(),
            agreement_hash: encoding::digest(a)?,
            preflight,
            local_decision: decision,
            base,
        })
    }
    pub fn validate(&self, trust: &TrustConfiguration) -> Result<(), String> {
        let expected = Self::new(
            self.preflight.clone(),
            self.local_decision.clone(),
            self.base.clone(),
            trust,
        )?;
        ensure(
            encoding::canonical(self)? == encoding::canonical(&expected)?,
            "PREFLIGHT_CHANGED: exact base signing review changed",
        )
    }
    pub fn render(&self, trust: &TrustConfiguration) -> Result<String, String> {
        self.validate(trust)?;
        Ok(format!(
            "{}\nEXACT BASE ENDORSEMENT REVIEW\nConfirm full signing review digest: {}\nCore Contract digest: {}\n{}\nThe signature authorizes this exact base Contract under its existing rules. It does not make annex signing atomic or transfer analysis authority.\n{}\n",
            self.preflight.render(trust)?,
            encoding::digest(self)?,
            self.agreement_hash,
            contract::preview(&self.base.agreement.agreement)?,
            serde_json::to_string_pretty(self).map_err(|e| e.to_string())?
        ))
    }
}
pub fn authorize_base<F>(
    review: &BaseSigningReviewV1,
    confirmed: &str,
    trust: &TrustConfiguration,
    vault: &Path,
    password: F,
) -> Result<DetachedSignature, String>
where
    F: FnOnce() -> Result<Zeroizing<Vec<u8>>, String>,
{
    ensure(
        !confirmed.is_empty(),
        "CONSENT_CANCELLED: vault was not accessed",
    )?;
    ensure(
        confirmed == encoding::digest(review)?,
        "CONSENT_DIGEST: exact full base signing review required",
    )?;
    review.validate(trust)?;
    let (key, binding) = local::unlock_vault(vault, &password()?)?;
    let a = &review.base.agreement.agreement;
    let party = contract::party(a, review.local_decision.participant_role)?;
    ensure(
        binding == party.key,
        "PREFLIGHT_SIGNER: vault differs from the locally accepting independently trusted role",
    )?;
    let directory = local::guard_directory(vault)?;
    if party.role == Role::Requester {
        local::reserve_signing_slot(
            &directory,
            &local::ExclusiveSlot {
                deployment_domain: a.deployment_domain.clone(),
                assignment_id: a.request_id.clone(),
                key_id: binding.key_id.clone(),
                scope_id: "request-assignment".into(),
                scope_version: "0".into(),
            },
            &encoding::digest(&a.assignment_id)?,
        )?;
    }
    local::reserve_signing_slot(
        &directory,
        &local::ExclusiveSlot {
            deployment_domain: a.deployment_domain.clone(),
            assignment_id: a.assignment_id.clone(),
            key_id: binding.key_id.clone(),
            scope_id: "terms".into(),
            scope_version: "0".into(),
        },
        &review.agreement_hash,
    )?;
    let claims = contract::claims(
        &a.deployment_domain,
        &a.assignment_id,
        &review.agreement_hash,
        party,
        "AGREEMENT",
    );
    let signed = crypto::sign(&claims, &key)?;
    crypto::verify(&signed, &claims, &party.key)?;
    Ok(signed)
}
pub fn authorize_context<F>(
    preflight: &PreflightReviewV1,
    decision: &LocalDecisionV1,
    review: &ConsentReviewV1,
    confirmed: &str,
    trust: &TrustConfiguration,
    vault: &Path,
    password: F,
) -> Result<DetachedSignature, String>
where
    F: FnOnce() -> Result<Zeroizing<Vec<u8>>, String>,
{
    ensure(
        review.kind == consent::ConsentKind::Context,
        "PREFLIGHT_CONTEXT: exact context signing review required",
    )?;
    review.validate(trust)?;
    let context: DisputeContextV1 =
        encoding::strict_parse(&encoding::canonical(&review.exact_content)?)?;
    check_context(
        preflight,
        decision,
        &context,
        review
            .retained_base
            .as_ref()
            .ok_or("PREFLIGHT_BASE: retained base required")?,
        trust,
    )?;
    consent::authorize_for_role(
        review,
        Some(confirmed),
        trust,
        vault,
        decision.participant_role,
        password,
    )
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetupReportV1 {
    pub local_decision_kind: String,
    pub participant_role: Role,
    pub reviewed_material_hash: String,
    pub base_agreement_bound: bool,
    pub annex_bound: bool,
    pub extended_workflow_ready: bool,
    pub contractual_authority: String,
    pub note: String,
}
pub fn complete_setup(
    preflight: &PreflightReviewV1,
    decision: &LocalDecisionV1,
    annex: &SignedDisputeContextV1,
    base: &AssignmentBundle,
    trust: &TrustConfiguration,
) -> Result<SetupReportV1, String> {
    check_context(preflight, decision, &annex.context, base, trust)?;
    let report = binding::verify_context(Some(annex), base, trust)?;
    Ok(SetupReportV1 {
        local_decision_kind: decision.record_kind.clone(),
        participant_role: decision.participant_role,
        reviewed_material_hash: preflight.digest()?,
        base_agreement_bound: report.base_agreement_bound,
        annex_bound: report.extended_setup_complete,
        extended_workflow_ready: report.base_agreement_bound && report.extended_setup_complete,
        contractual_authority: "NO_NEW_AUTHORITY; BASE_RULES_UNCHANGED; ANNEX_ANALYSIS_ONLY".into(),
        note: "Local review acceptance is not authenticated third-party consent. Base and annex signatures are separate, not atomic; a failed workflow check does not invalidate existing base rights. No robot actuation or physical-safety permission is established.".into(),
    })
}
