// SPDX-License-Identifier: AGPL-3.0-only
use crate::{
    crypto::{self, DetachedSignature, SignatureClaims},
    encoding::{canonical, digest, validate_digest, validate_domain, validate_id},
    model::*,
    money::{Money, parse_minor_units},
};
use std::collections::BTreeSet;

pub(crate) fn ensure(condition: bool, code: &str, message: &str) -> Result<(), String> {
    if condition {
        Ok(())
    } else {
        Err(format!("{code}: {message}"))
    }
}
pub(crate) fn text(value: &str) -> Result<(), String> {
    ensure(
        !value.trim().is_empty() && value.len() <= 16384,
        "TEXT_BOUNDS",
        "required text must contain 1..16384 bytes",
    )
}
pub(crate) fn unique<'a>(items: impl Iterator<Item = &'a str>) -> Result<(), String> {
    let mut set = BTreeSet::new();
    for item in items {
        ensure(
            set.insert(item),
            "DUPLICATE_ID",
            "identifiers must be unique",
        )?;
    }
    Ok(())
}
pub(crate) fn version(value: &str) -> Result<(), String> {
    ensure(
        value == "2",
        "VERSION",
        "new agreements require protocol/schema/policy 2; inspect legacy signatures separately",
    )
}
pub fn party(agreement: &AssignmentAgreement, role: Role) -> Result<&PartyBinding, String> {
    agreement
        .parties
        .iter()
        .find(|p| p.role == role)
        .ok_or_else(|| "KEY_AUTHORITY: missing role".into())
}
pub fn claims(
    domain: &str,
    assignment: &str,
    hash: &str,
    party: &PartyBinding,
    purpose: &str,
) -> SignatureClaims {
    claims_for_version(PROTOCOL_VERSION, domain, assignment, hash, party, purpose)
}

/// Historical inspection must request its actual signed version explicitly.
/// Normal formation and signing use `claims`, which selects current protocol 2.
pub fn claims_for_version(
    protocol_version: &str,
    domain: &str,
    assignment: &str,
    hash: &str,
    party: &PartyBinding,
    purpose: &str,
) -> SignatureClaims {
    SignatureClaims {
        protocol_version: protocol_version.into(),
        deployment_domain: domain.into(),
        assignment_id: assignment.into(),
        content_hash: hash.into(),
        role: party.role.code().into(),
        key_id: party.key.key_id.clone(),
        purpose: purpose.into(),
    }
}
pub(crate) fn artifact(value: &TextArtifact) -> Result<(), String> {
    validate_id(&value.id)?;
    validate_id(&value.version)?;
    ensure(
        matches!(value.media_type.as_str(), "text/plain" | "text/markdown"),
        "TERMS_MEDIA",
        "terms must be embedded plain text or Markdown",
    )?;
    text(&value.text)
}
pub(crate) fn service(value: &Service) -> Result<(), String> {
    text(&value.description)?;
    ensure(
        !value.deliverables.is_empty() && value.deliverables.len() <= 64,
        "SERVICE",
        "bounded deliverables required",
    )?;
    for t in value
        .deliverables
        .iter()
        .chain(&value.exclusions)
        .chain(&value.prerequisites)
        .chain(&value.requester_inputs)
        .chain(&value.safety_stop_conditions)
        .chain(&value.execution_resources)
    {
        text(t)?;
    }
    if let Some(location) = &value.location {
        text(location)?;
    }
    Ok(())
}
pub fn validate_trust(trust: &TrustConfiguration) -> Result<(), String> {
    version(&trust.protocol_version)?;
    validate_trust_bindings(trust)
}

/// Version-independent shape/identity checks; no contractual policy is selected.
pub(crate) fn validate_trust_bindings(trust: &TrustConfiguration) -> Result<(), String> {
    validate_domain(&trust.deployment_domain)?;
    ensure(
        trust.parties.len() == 3,
        "KEY_AUTHORITY",
        "exactly three trusted role bindings required",
    )?;
    unique(trust.parties.iter().map(|p| p.role.code()))?;
    unique(trust.parties.iter().map(|p| p.key.key_id.as_str()))?;
    unique(
        trust
            .parties
            .iter()
            .map(|p| p.key.public_key_sec1_b64.as_str()),
    )?;
    for p in &trust.parties {
        validate_id(&p.party_id)?;
        artifact(&p.identity_record)?;
        ensure(
            p.role.code() == p.key.role,
            "KEY_AUTHORITY",
            "role mismatch",
        )?;
        p.key.validate()?;
    }
    Ok(())
}
fn trusted(trust: &TrustConfiguration, role: Role) -> Result<&PartyBinding, String> {
    trust
        .parties
        .iter()
        .find(|p| p.role == role)
        .ok_or_else(|| "KEY_AUTHORITY: trusted role missing".into())
}

pub fn verify_request(
    signed: &SignedRequest,
    trust: &TrustConfiguration,
) -> Result<String, String> {
    validate_trust(trust)?;
    let r = &signed.request;
    version(&r.protocol_version)?;
    validate_id(&r.request_id)?;
    ensure(
        r.deployment_domain == trust.deployment_domain,
        "DOMAIN",
        "request domain mismatch",
    )?;
    ensure(
        parse_minor_units(&r.revision)? > 0,
        "REVISION",
        "request revision must be positive",
    )?;
    ensure(
        &r.requester == trusted(trust, Role::Requester)?,
        "KEY_AUTHORITY",
        "requester differs from trusted binding",
    )?;
    service(&r.service)?;
    ensure(
        r.accepts_platform_terms && !r.terms.is_empty(),
        "TERMS_CONSENT",
        "requester must accept included platform terms",
    )?;
    unique(r.terms.iter().map(|t| t.id.as_str()))?;
    for t in &r.terms {
        artifact(t)?;
    }
    let hash = digest(r)?;
    crypto::verify(
        &signed.authorization,
        &claims_for_version(
            &r.protocol_version,
            &r.deployment_domain,
            &r.request_id,
            &hash,
            &r.requester,
            "REQUEST",
        ),
        &r.requester.key,
    )?;
    Ok(hash)
}
pub fn verify_quote(
    signed: &SignedQuote,
    request: &SignedRequest,
    trust: &TrustConfiguration,
) -> Result<String, String> {
    let rh = verify_request(request, trust)?;
    let q = &signed.quote;
    version(&q.protocol_version)?;
    validate_id(&q.quote_id)?;
    ensure(
        q.deployment_domain == trust.deployment_domain && q.request_hash == rh,
        "QUOTE_BINDING",
        "quote references another request/domain",
    )?;
    ensure(
        &q.operator == trusted(trust, Role::Operator)?,
        "KEY_AUTHORITY",
        "only trusted Operator may issue a quote",
    )?;
    ensure(
        q.service_hash == digest(&request.request.service)?
            && q.accepted_terms_hash == digest(&request.request.terms)?,
        "QUOTE_BINDING",
        "scope or platform terms differ",
    )?;
    let amount = q.compensation.validate()?;
    ensure(
        amount > 0,
        "QUOTE_PRICE",
        "positive Operator compensation required",
    )?;
    ensure(
        !q.milestones.is_empty() && q.milestones.len() <= 64 && q.expenses.len() <= 64,
        "QUOTE_BOUNDS",
        "bounded milestones and expenses required",
    )?;
    unique(q.milestones.iter().map(|m| m.id.as_str()))?;
    unique(q.expenses.iter().map(|e| e.category.as_str()))?;
    let mut total = Money::new("0", &q.compensation.currency)?;
    for m in &q.milestones {
        validate_id(&m.id)?;
        text(&m.deliverable)?;
        ensure(
            m.compensation.validate()? > 0,
            "QUOTE_PRICE",
            "positive milestone amount required",
        )?;
        total = total.checked_add(&m.compensation)?;
    }
    ensure(
        total == q.compensation,
        "QUOTE_TOTAL",
        "milestones must equal full compensation",
    )?;
    for e in &q.expenses {
        validate_id(&e.category)?;
        total = total.checked_add(&e.cap)?;
    }
    let hash = digest(q)?;
    crypto::verify(
        &signed.authorization,
        &claims_for_version(
            &q.protocol_version,
            &q.deployment_domain,
            &request.request.request_id,
            &hash,
            &q.operator,
            "QUOTE",
        ),
        &q.operator.key,
    )?;
    Ok(hash)
}

pub fn validate_agreement(
    a: &AssignmentAgreement,
    requests: &[SignedRequest],
    trust: &TrustConfiguration,
) -> Result<(), String> {
    validate_trust(trust)?;
    version(&a.protocol_version)?;
    version(&a.schema_version)?;
    validate_id(&a.assignment_id)?;
    validate_id(&a.request_id)?;
    ensure(
        a.deployment_domain == trust.deployment_domain,
        "DOMAIN",
        "agreement deployment mismatch",
    )?;
    ensure(
        a.parties.len() == 3,
        "KEY_AUTHORITY",
        "agreement needs R/O/M",
    )?;
    unique(a.parties.iter().map(|p| p.role.code()))?;
    for p in &a.parties {
        ensure(
            p == trusted(trust, p.role)?,
            "KEY_AUTHORITY",
            "agreement role/key/party differs from independent trust",
        )?;
    }
    ensure(
        parse_minor_units(&a.revision)? > 0,
        "REVISION",
        "positive agreement revision required",
    )?;
    if let Some(hash) = &a.previous_agreement_hash {
        validate_digest(hash)?;
    }
    let request = requests
        .iter()
        .find(|r| {
            digest(&r.request).ok().as_deref() == Some(&a.request_hash)
                && verify_request(r, trust).is_ok()
        })
        .ok_or_else(|| "MISSING_REQUEST: original signed Request unavailable".to_string())?;
    ensure(
        request.request.request_id == a.request_id && a.service == request.request.service,
        "REQUEST_BINDING",
        "agreement does not bind exact Request scope",
    )?;
    verify_quote(&a.quote, request, trust)?;
    service(&a.service)?;
    let p = &a.policy;
    version(&p.version)?;
    ensure(
        p.id == POLICY_ID && a.policy_hash == digest(p)?,
        "POLICY_PIN",
        "unsupported or changed policy",
    )?;
    ensure(
        p.no_commission && !p.mediator_has_task_fund_control,
        "CONSTITUTION",
        "no commission or mediator task-fund control",
    )?;
    ensure(
        a.payments.payer == Role::Requester && a.payments.payee == Role::Operator,
        "PAYMENT_PARTIES",
        "task payments must go directly R to O",
    )?;
    for s in [
        &a.payments.rail,
        &a.payments.destination,
        &a.payments.due_conditions,
        &a.payments.reversal_treatment,
    ] {
        text(s)?;
    }
    ensure(
        a.mediation.free && a.mediation.proposal_only,
        "MEDIATOR_AUTHORITY",
        "mediation is free and proposal-only",
    )?;
    ensure(
        a.remedies.preserve_accrued_claims && a.legal.mandatory_rights_reserved,
        "RIGHTS_PRESERVATION",
        "accrued claims and mandatory rights cannot be disabled",
    )?;
    ensure(
        !a.legal.artifacts.is_empty(),
        "TERMS_REQUIRED",
        "exact legal artifacts required",
    )?;
    unique(a.legal.artifacts.iter().map(|t| t.id.as_str()))?;
    for t in &a.legal.artifacts {
        artifact(t)?;
    }
    for t in &request.request.terms {
        ensure(
            a.legal.artifacts.contains(t),
            "TERMS_BINDING",
            "platform terms accepted before posting/quoting must be retained",
        )?;
    }
    artifact(&a.privacy.retention)?;
    text(&a.legal.consent_text)?;
    for s in [
        &a.timing.start_window,
        &a.timing.completion_window,
        &a.timing.review_window,
        &a.timing.notices,
        &a.timing.grace_extensions,
        &a.timing.time_assumptions,
        &a.mediation.availability_commitment,
        &a.mediation.escalation,
        &a.remedies.cancellation,
        &a.remedies.interruption,
        &a.remedies.partial_completion,
        &a.remedies.expenses,
        &a.remedies.escalation,
        &a.privacy.export_rights,
        &a.privacy.disclosure_rules,
    ] {
        text(s)?;
    }
    ensure(
        !a.acceptance.is_empty() && a.acceptance.len() <= 128 && p.artifact_rules.len() <= 64,
        "POLICY_BOUNDS",
        "bounded acceptance criteria required",
    )?;
    unique(a.acceptance.iter().map(|c| c.id.as_str()))?;
    unique(p.artifact_rules.iter().map(|r| r.id.as_str()))?;
    for c in &a.acceptance {
        validate_id(&c.id)?;
        text(&c.description)?;
        ensure(
            a.quote
                .quote
                .milestones
                .iter()
                .any(|m| m.id == c.milestone_id),
            "CRITERION_SCOPE",
            "unknown milestone",
        )?;
    }
    for milestone in &a.quote.quote.milestones {
        ensure(
            a.acceptance.iter().any(|c| c.milestone_id == milestone.id),
            "CRITERION_SCOPE",
            "milestone lacks criteria",
        )?;
    }
    for r in &p.artifact_rules {
        validate_id(&r.id)?;
        ensure(
            !r.artifact_digests.is_empty(),
            "RULE_PROOF",
            "artifact rule needs exact pinned bytes",
        )?;
        unique(r.artifact_digests.iter().map(String::as_str))?;
        for h in &r.artifact_digests {
            validate_digest(h)?;
        }
        let criteria: Vec<_> = a
            .acceptance
            .iter()
            .filter(|c| c.milestone_id == r.milestone_id)
            .collect();
        ensure(
            !criteria.is_empty()
                && criteria
                    .iter()
                    .all(|c| c.evaluation == Evaluation::ArtifactBytes),
            "RULE_SCOPE",
            "artifact rule cannot satisfy physical/judgment criteria",
        )?;
        let ids: BTreeSet<_> = criteria.iter().map(|c| c.id.as_str()).collect();
        let selected: BTreeSet<_> = r.criterion_ids.iter().map(String::as_str).collect();
        ensure(
            ids == selected && selected.len() == r.criterion_ids.len(),
            "RULE_SCOPE",
            "rule must cover exactly all milestone criteria",
        )?;
    }
    match &a.assurance {
        Assurance::Disabled { reason } => text(reason)?,
        Assurance::Service {
            id,
            provider,
            beneficiaries,
            services,
            limits,
            triggers,
            exclusions,
            evidence_requirements,
            claim_path,
            challenge_path,
            prerequisites,
            response_commitment,
            fee,
            financial_compensation,
        } => {
            validate_id(id)?;
            ensure(
                *provider == Role::Mediator && !financial_compensation,
                "ASSURANCE_UNSUPPORTED",
                "only explicit nonfinancial M service commitments are supported",
            )?;
            ensure(
                !beneficiaries.is_empty() && !services.is_empty(),
                "ASSURANCE_SCOPE",
                "beneficiaries/services required",
            )?;
            for s in services
                .iter()
                .chain(exclusions)
                .chain(prerequisites)
                .chain([
                    limits,
                    triggers,
                    evidence_requirements,
                    claim_path,
                    challenge_path,
                    response_commitment,
                ])
            {
                text(s)?;
            }
            if let Some(f) = fee {
                validate_id(&f.fee_id)?;
                f.amount.validate()?;
                ensure(
                    f.provider == Role::Mediator && f.payer != Role::Mediator,
                    "PROTECTION_FEE",
                    "protection fee must name separate payer and provider",
                )?;
                text(&f.destination)?;
                text(&f.service_scope)?;
                text(&f.due_conditions)?;
            }
        }
    }
    ensure(
        canonical(a)?.len() <= 512 * 1024,
        "AGREEMENT_SIZE",
        "agreement exceeds 512KiB",
    )?;
    Ok(())
}

pub fn verify_agreement(
    c: &AgreementCertificate,
    requests: &[SignedRequest],
    trust: &TrustConfiguration,
) -> AgreementResult {
    let hash = digest(&c.agreement).unwrap_or_default();
    let mut result = AgreementResult {
        agreement_hash: hash.clone(),
        bound: false,
        valid_signers: vec![],
        diagnostics: vec![],
    };
    if let Err(e) = validate_agreement(&c.agreement, requests, trust) {
        result.diagnostics.push(diagnostic(&hash, &e));
        return result;
    }
    if c.agreement.revision != "1" || c.agreement.previous_agreement_hash.is_some() {
        result.diagnostics.push(diagnostic(
            &hash,
            "ROOT_REVISION: root must be revision 1 without parent",
        ));
        return result;
    }
    for s in &c.signatures {
        let p = c
            .agreement
            .parties
            .iter()
            .find(|p| p.role.code() == s.claims.role);
        match p {
            Some(p) => {
                match crypto::verify(
                    s,
                    &claims_for_version(
                        &c.agreement.protocol_version,
                        &c.agreement.deployment_domain,
                        &c.agreement.assignment_id,
                        &hash,
                        p,
                        "AGREEMENT",
                    ),
                    &p.key,
                ) {
                    Ok(()) => {
                        if !result.valid_signers.contains(&p.role) {
                            result.valid_signers.push(p.role);
                        }
                    }
                    Err(e) => result.diagnostics.push(diagnostic(&hash, &e)),
                }
            }
            None => result
                .diagnostics
                .push(diagnostic(&hash, "KEY_AUTHORITY: unknown signer")),
        }
    }
    result.valid_signers.sort();
    // Invalid extra encodings are retained as diagnostics, not a revocation of
    // an independently complete certificate. An untrusted relay can append junk.
    result.bound = result.valid_signers.len() == 3;
    if !result.bound && result.diagnostics.is_empty() {
        result.diagnostics.push(diagnostic(
            &hash,
            "MISSING_SIGNATURE: complete R/O/M certificate required",
        ));
    }
    result
}
pub fn diagnostic(subject: &str, error: &str) -> Diagnostic {
    let (code, message) = error.split_once(':').unwrap_or(("INVALID", error));
    Diagnostic {
        code: code.into(),
        subject: subject.into(),
        message: message.trim().into(),
    }
}

pub fn preview(a: &AssignmentAgreement) -> Result<String, String> {
    let mut result = format!(
        "Non Verba — three-party Assignment\nAgreement: {} / revision {}\nDigest: {}\nDomain: {}\n\n{}\n\nOperator compensation: {} minor {} (exponent {})\nTask payment: R -> O, {} / {}\nMediation: FREE; proposal-only. No task-money custody.\nDelegates/recovery: not enabled in this v2 prototype profile.\nDeadlines: reminders and escalation only; silence is not consent.\nAssurance (including exclusions):\n{}\n\nEXACT SIGNED TERMS AND POLICY:\n",
        a.assignment_id,
        a.revision,
        digest(a)?,
        a.deployment_domain,
        CONSTITUTION,
        a.quote.quote.compensation.minor_units,
        a.quote.quote.compensation.currency,
        a.quote.quote.compensation.exponent,
        a.payments.rail,
        a.payments.destination,
        serde_json::to_string_pretty(&a.assurance).map_err(|e| e.to_string())?
    );
    result.push_str("\nNON-RETRACTION PRINCIPLE:\n");
    result.push_str(NON_RETRACTION);
    result
        .push_str("\nThis is a prototype protocol preview, not deployment or legal readiness.\n\n");
    result.push_str(&serde_json::to_string_pretty(a).map_err(|e| e.to_string())?);
    Ok(result)
}

pub fn verify_role_signatures(
    signatures: &[DetachedSignature],
    a: &AssignmentAgreement,
    hash: &str,
    purpose: &str,
) -> Result<Vec<Role>, String> {
    let mut roles = vec![];
    for s in signatures {
        let Some(p) = a.parties.iter().find(|p| p.role.code() == s.claims.role) else {
            continue;
        };
        if crypto::verify(
            s,
            &claims_for_version(
                &a.protocol_version,
                &a.deployment_domain,
                &a.assignment_id,
                hash,
                p,
                purpose,
            ),
            &p.key,
        )
        .is_err()
        {
            continue;
        }
        if !roles.contains(&p.role) {
            roles.push(p.role);
        }
    }
    roles.sort();
    Ok(roles)
}
