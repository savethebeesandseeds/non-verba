// SPDX-License-Identifier: AGPL-3.0-only
//! Native, exact-review signing boundary. Editing/analysis never unlocks a vault.
use crate::binding::{self, *};
use crate::case::{self, AnalysisChallengeBodyV1, EvidenceSubmissionBodyV1, StatementKindV1};
use nonverba_requests::{
    crypto::{self, DetachedSignature, SignatureClaims},
    encoding, local,
    model::{AssignmentBundle, Role, TrustConfiguration},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use zeroize::Zeroizing;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConsentKind {
    Profile,
    Context,
    Submission,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConsentReviewV1 {
    pub review_version: String,
    pub kind: ConsentKind,
    pub content_hash: String,
    pub exact_content: Value,
    pub retained_base: Option<AssignmentBundle>,
    pub base_hash: Option<String>,
    pub retained_annex: Option<SignedDisputeContextV1>,
    pub annex_hash: Option<String>,
    pub trust_hash: String,
}

fn value<T: Serialize>(object: &T) -> Result<Value, String> {
    serde_json::to_value(object).map_err(|e| format!("DISPUTE_REVIEW: {e}"))
}

fn typed<T: serde::de::DeserializeOwned>(value: &Value) -> Result<T, String> {
    encoding::strict_parse(&encoding::canonical(value)?)
}

fn fail_if(condition: bool, message: &str) -> Result<(), String> {
    if condition {
        Err(message.into())
    } else {
        Ok(())
    }
}

fn validate_payload(statement: &AttributedStatementV1) -> Result<(), String> {
    let scope = &statement.scope;
    let (version, role, agreement_hash, context_hash, record_id) = match scope.kind {
        SubmissionKind::EvidenceSubmission => {
            let body: EvidenceSubmissionBodyV1 = typed(&statement.payload)?;
            encoding::validate_id(&body.case_id)?;
            encoding::validate_digest(&body.content_sha256)?;
            fail_if(
                body.byte_length > case::MAX_EVIDENCE_BYTES
                    || body.media_type.is_empty()
                    || body.media_type.len() > 128
                    || !body.media_type.contains('/')
                    || body.media_type.chars().any(char::is_control),
                "CONSENT_PAYLOAD: invalid evidence size or media type",
            )?;
            fail_if(
                body.party_offer.is_some() != (body.statement_kind == StatementKindV1::PartyOffer)
                    || (body.party_offer.is_some() && body.author_role == Role::Mediator),
                "CONSENT_PAYLOAD: only an explicitly labelled R/O party offer may carry an amount",
            )?;
            if let Some(amount) = &body.party_offer {
                amount.validate()?;
            }
            (
                body.version,
                body.author_role,
                body.agreement_hash,
                body.context_hash,
                body.submission_id,
            )
        }
        SubmissionKind::AnalysisChallenge => {
            let body: AnalysisChallengeBodyV1 = typed(&statement.payload)?;
            encoding::validate_digest(&body.case_hash)?;
            for hash in [&body.attempt_hash, &body.previous_challenge_hash]
                .into_iter()
                .flatten()
            {
                encoding::validate_digest(hash)?;
            }
            fail_if(
                body.text.is_empty()
                    || body.text.len() > case::MAX_TEXT_BYTES
                    || body.text.chars().any(|c| c.is_control() && c != '\n')
                    || body.references.len() > case::MAX_CASE_ITEMS,
                "CONSENT_PAYLOAD: challenge text or reference limit",
            )?;
            for reference in &body.references {
                encoding::validate_id(reference)?;
            }
            (
                body.version,
                body.author_role,
                body.agreement_hash,
                body.context_hash,
                body.challenge_id,
            )
        }
    };
    encoding::validate_id(&record_id)?;
    fail_if(
        version != EXTENSION_VERSION
            || role != scope.author_role
            || agreement_hash != scope.agreement_hash
            || context_hash != scope.context_hash
            || record_id != scope.record_id,
        "CONSENT_PAYLOAD: typed version/author/Agreement/context/record identity differs from reviewed scope",
    )
}

impl ConsentReviewV1 {
    fn new<T: Serialize>(
        kind: ConsentKind,
        object: &T,
        base: Option<&AssignmentBundle>,
        annex: Option<&SignedDisputeContextV1>,
        trust: &TrustConfiguration,
    ) -> Result<Self, String> {
        Ok(Self {
            review_version: EXTENSION_VERSION.into(),
            kind,
            content_hash: encoding::digest(object)?,
            exact_content: value(object)?,
            retained_base: base.cloned(),
            base_hash: base.map(encoding::digest).transpose()?,
            retained_annex: annex.cloned(),
            annex_hash: annex.map(encoding::digest).transpose()?,
            trust_hash: encoding::digest(trust)?,
        })
    }

    pub fn profile(profile: DeclaredPriorsV1, trust: &TrustConfiguration) -> Result<Self, String> {
        binding::validate_declared_priors(&profile, trust)?;
        Self::new(ConsentKind::Profile, &profile, None, None, trust)
    }

    pub fn context(
        context: DisputeContextV1,
        base: &AssignmentBundle,
        trust: &TrustConfiguration,
    ) -> Result<Self, String> {
        binding::validate_context(&context, base, trust)?;
        Self::new(ConsentKind::Context, &context, Some(base), None, trust)
    }

    pub fn submission<T: Serialize>(
        payload: &T,
        scope: &AttributionScopeV1,
        base: &AssignmentBundle,
        annex: &SignedDisputeContextV1,
        trust: &TrustConfiguration,
    ) -> Result<Self, String> {
        let report = binding::verify_context(Some(annex), base, trust)?;
        fail_if(
            !report.extended_setup_complete,
            "DISPUTE_CONTEXT: attributed submission needs a complete independently verified annex",
        )?;
        fail_if(
            report.context_hash.as_deref() != Some(&scope.context_hash)
                || annex.context.agreement_hash != scope.agreement_hash,
            "DISPUTE_CONTEXT: submission scope differs from its retained exact annex",
        )?;
        binding::attributed_claims(payload, scope, base, trust)?;
        let statement = binding::attributed_statement(payload, scope)?;
        validate_payload(&statement)?;
        Self::new(
            ConsentKind::Submission,
            &statement,
            Some(base),
            Some(annex),
            trust,
        )
    }

    /// Approve this full retained review, not a digest copied from a new draft.
    pub fn review_digest(&self) -> Result<String, String> {
        encoding::digest(self)
    }

    pub fn validate(&self, trust: &TrustConfiguration) -> Result<(), String> {
        fail_if(
            self.review_version != EXTENSION_VERSION,
            "DISPUTE_REVIEW_VERSION: unsupported review version",
        )?;
        fail_if(
            self.trust_hash != encoding::digest(trust)?,
            "CONSENT_TRUST: independently supplied trust differs from the exact reviewed trust",
        )?;
        fail_if(
            self.content_hash != encoding::digest(&self.exact_content)?,
            "CONSENT_DIGEST: exact reviewed content changed",
        )?;
        fail_if(
            self.base_hash
                != self
                    .retained_base
                    .as_ref()
                    .map(encoding::digest)
                    .transpose()?
                || self.annex_hash
                    != self
                        .retained_annex
                        .as_ref()
                        .map(encoding::digest)
                        .transpose()?,
            "CONSENT_CONTEXT: retained signing context changed",
        )?;
        let rebuilt = match self.kind {
            ConsentKind::Profile => Self::profile(typed(&self.exact_content)?, trust)?,
            ConsentKind::Context => Self::context(
                typed(&self.exact_content)?,
                self.retained_base
                    .as_ref()
                    .ok_or("CONSENT_CONTEXT: base Agreement required")?,
                trust,
            )?,
            ConsentKind::Submission => {
                let statement: AttributedStatementV1 = typed(&self.exact_content)?;
                fail_if(
                    statement.extension_version != EXTENSION_VERSION,
                    "DISPUTE_VERSION: unsupported attributed statement",
                )?;
                Self::submission(
                    &statement.payload,
                    &statement.scope,
                    self.retained_base
                        .as_ref()
                        .ok_or("CONSENT_CONTEXT: base Agreement required")?,
                    self.retained_annex
                        .as_ref()
                        .ok_or("CONSENT_CONTEXT: complete annex required")?,
                    trust,
                )?
            }
        };
        fail_if(
            encoding::canonical(self)? != encoding::canonical(&rebuilt)?,
            "CONSENT_REPRESENTATION: review is not the exact supported typed representation",
        )
    }

    pub fn render(&self) -> Result<String, String> {
        fail_if(
            self.content_hash != encoding::digest(&self.exact_content)?,
            "CONSENT_DIGEST: reviewed content changed",
        )?;
        let points = match self.kind {
            ConsentKind::Profile => {
                let profile: DeclaredPriorsV1 = typed(&self.exact_content)?;
                profile_table(&[&profile])?
            }
            ConsentKind::Context => {
                let context: DisputeContextV1 = typed(&self.exact_content)?;
                profile_table(&[
                    &context.requester_profile.profile,
                    &context.operator_profile.profile,
                ])?
            }
            ConsentKind::Submission => {
                "Attribution does not establish truth or the merits of a challenge.\n".into()
            }
        };
        let header = format!(
            "DISPUTE PRIORS — EXACT ANALYSIS-ONLY REVIEW\nFull review digest to confirm: {}\nSigned content digest: {}\n\nPoints express declared priors, not probabilities, honesty scores or payment percentages. Each R/O declaration has its own 250-point budget. Zero waives no right; 100 grants no payment fraction. How declared priors influence a settlement is UNSPECIFIED.\nAll three annex endorsements acknowledge the same context; they do not transfer profile authorship or financial authority.\nThis review grants no model, sponsor or agent signing authority. Existing core obligations and rights remain separate.\nEditing declared priors and this display have not opened a signing vault. Validate against independent trust before signing.\n\nEXACT RETAINED REVIEW (including source signatures, context and trust digest):\n{}\n",
            self.review_digest()?,
            self.content_hash,
            serde_json::to_string_pretty(self).map_err(|e| format!("DISPUTE_REVIEW: {e}"))?,
        );
        Ok(escape_controls(&format!("{points}\n{header}")))
    }
}

fn profile_table(profiles: &[&DeclaredPriorsV1]) -> Result<String, String> {
    let dictionary = binding::priors_catalog();
    let mut table = String::from("DECLARED PRIORS — supported catalog order\nPrior");
    for profile in profiles {
        binding::validate_allocations(&profile.allocations, &dictionary)?;
        table.push_str(&format!(" | {} points", profile.author.role.code()));
    }
    table.push('\n');
    for dimension in &dictionary.dimensions {
        table.push_str(&dimension.label);
        for profile in profiles {
            let allocation = profile
                .allocations
                .iter()
                .find(|a| a.dimension_id == dimension.id)
                .ok_or("DISPUTE_ALLOCATION: missing dimension")?;
            table.push_str(&format!(" | {}", allocation.points));
        }
        table.push('\n');
    }
    table.push_str("\nEXACT CATALOG DEFINITIONS (digest-bound by each declaration):\n");
    table.push_str(&serde_json::to_string_pretty(&dictionary).map_err(|e| e.to_string())?);
    table.push('\n');
    Ok(table)
}

fn escape_controls(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    for ch in text.chars() {
        if ('\u{0080}'..='\u{009f}').contains(&ch)
            || matches!(ch, '\u{200e}' | '\u{200f}' | '\u{2028}' | '\u{2029}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        {
            output.push_str(&format!("\\u{:04x}", ch as u32));
        } else {
            output.push(ch);
        }
    }
    output
}

fn role(code: &str) -> Result<Role, String> {
    match code {
        "R" => Ok(Role::Requester),
        "O" => Ok(Role::Operator),
        "M" => Ok(Role::Mediator),
        _ => Err("DISPUTE_SIGNER: unknown local key role".into()),
    }
}

fn claims_and_slot(
    review: &ConsentReviewV1,
    trust: &TrustConfiguration,
    signer: Role,
) -> Result<(SignatureClaims, local::ExclusiveSlot), String> {
    let (claims, scope_id, scope_version) = match review.kind {
        ConsentKind::Profile => {
            let profile: DeclaredPriorsV1 = typed(&review.exact_content)?;
            fail_if(
                profile.author.role != signer,
                "DISPUTE_AUTHOR: only the profile owner may sign its allocations",
            )?;
            let claims = binding::declared_priors_claims(&profile, trust)?;
            let (scope, version) = match &profile.provenance {
                ProfileProvenance::Request { signed_request } => (
                    "dispute-profile:R".into(),
                    signed_request.request.revision.clone(),
                ),
                ProfileProvenance::Quote { signed_quote, .. } => (
                    format!(
                        "dispute-profile:O:{}",
                        encoding::digest(&signed_quote.quote.quote_id)?
                    ),
                    "0".into(),
                ),
            };
            (claims, scope, version)
        }
        ConsentKind::Context => {
            let context: DisputeContextV1 = typed(&review.exact_content)?;
            let claims = binding::context_claims(
                &context,
                review
                    .retained_base
                    .as_ref()
                    .ok_or("CONSENT_CONTEXT: base required")?,
                trust,
                signer,
            )?;
            // A separately authorized base amendment can support another annex.
            // An arbitrary context ID or changed specification cannot open this slot.
            (
                claims,
                format!("dispute-context:{}", context.agreement_hash),
                "0".into(),
            )
        }
        ConsentKind::Submission => {
            let statement: AttributedStatementV1 = typed(&review.exact_content)?;
            fail_if(
                statement.scope.author_role != signer,
                "DISPUTE_AUTHOR: submission author differs from local signer",
            )?;
            let claims = binding::attributed_claims(
                &statement.payload,
                &statement.scope,
                review
                    .retained_base
                    .as_ref()
                    .ok_or("CONSENT_CONTEXT: base required")?,
                trust,
            )?;
            // Same author/context/kind/record identity cannot replace its old body.
            let identity = (
                &statement.scope.context_hash,
                statement.scope.kind,
                &statement.scope.record_id,
            );
            (
                claims,
                format!("dispute-record:{}", encoding::digest(&identity)?),
                "0".into(),
            )
        }
    };
    let slot = local::ExclusiveSlot {
        deployment_domain: claims.deployment_domain.clone(),
        assignment_id: claims.assignment_id.clone(),
        key_id: claims.key_id.clone(),
        scope_id,
        scope_version,
    };
    Ok((claims, slot))
}

/// The caller obtains an explicit full-review digest. Cancellation and all typed
/// review/context validation happen before password acquisition or vault access.
pub fn authorize<F>(
    review: &ConsentReviewV1,
    approved_review_digest: Option<&str>,
    trust: &TrustConfiguration,
    vault_path: &Path,
    password_provider: F,
) -> Result<DetachedSignature, String>
where
    F: FnOnce() -> Result<Zeroizing<Vec<u8>>, String>,
{
    authorize_inner(
        review,
        approved_review_digest,
        trust,
        vault_path,
        None,
        password_provider,
    )
}

/// The preflight-aware workflow additionally pins the role that locally accepted.
pub fn authorize_for_role<F>(
    review: &ConsentReviewV1,
    approved_review_digest: Option<&str>,
    trust: &TrustConfiguration,
    vault_path: &Path,
    expected_role: Role,
    password_provider: F,
) -> Result<DetachedSignature, String>
where
    F: FnOnce() -> Result<Zeroizing<Vec<u8>>, String>,
{
    authorize_inner(
        review,
        approved_review_digest,
        trust,
        vault_path,
        Some(expected_role),
        password_provider,
    )
}

fn authorize_inner<F>(
    review: &ConsentReviewV1,
    approved_review_digest: Option<&str>,
    trust: &TrustConfiguration,
    vault_path: &Path,
    expected_role: Option<Role>,
    password_provider: F,
) -> Result<DetachedSignature, String>
where
    F: FnOnce() -> Result<Zeroizing<Vec<u8>>, String>,
{
    let approved = approved_review_digest
        .filter(|s| !s.is_empty())
        .ok_or("CONSENT_CANCELLED: no approval; vault was not accessed")?;
    encoding::validate_digest(approved)?;
    fail_if(
        review.review_digest()? != approved,
        "CONSENT_DIGEST: approved review differs from the complete retained review",
    )?;
    review.validate(trust)?;
    let password = password_provider()?;
    let (key, binding) = local::unlock_vault(vault_path, &password)?;
    fail_if(
        expected_role.is_some_and(|expected| expected.code() != binding.role),
        "PREFLIGHT_SIGNER: vault differs from the role that locally accepted the exact preflight",
    )?;
    let (claims, slot) = claims_and_slot(review, trust, role(&binding.role)?)?;
    fail_if(
        claims.content_hash != review.content_hash,
        "CONSENT_DIGEST: signing statement differs from exact reviewed content",
    )?;
    let trusted = trust
        .parties
        .iter()
        .find(|party| party.role.code() == claims.role)
        .ok_or("DISPUTE_SIGNER: role missing from independent trust")?;
    fail_if(
        binding != trusted.key || binding.key_id != claims.key_id,
        "DISPUTE_SIGNER: local vault does not match the independently trusted author key",
    )?;
    local::reserve_signing_slot(
        &local::guard_directory(vault_path)?,
        &slot,
        &claims.content_hash,
    )?;
    let signature = crypto::sign(&claims, &key)?;
    crypto::verify(&signature, &claims, &trusted.key)?;
    Ok(signature)
}
