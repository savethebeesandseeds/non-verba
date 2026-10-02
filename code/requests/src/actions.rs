// SPDX-License-Identifier: AGPL-3.0-only
//! Closed authorization matrix. No votes, administrator role, or generic patches.
use crate::{
    agreement::{claims, ensure, party, verify_role_signatures},
    crypto::SignatureClaims,
    encoding::{digest, validate_id},
    model::*,
    money::parse_minor_units,
};

pub fn required_authorizers(action: &Action) -> Vec<Role> {
    use Role::*;
    match action {
        Action::AcknowledgeCompletion { .. } => vec![Requester],
        Action::InvokeArtifactRule { .. } => vec![],
        Action::AuthorizeExpense { .. } | Action::BilateralSettlement { .. } => {
            vec![Requester, Operator]
        }
        Action::PaymentReceipt { obligation_id, .. } => {
            if obligation_id.starts_with("protection:") {
                vec![Mediator]
            } else {
                vec![Operator]
            }
        }
        Action::ReconcileReversal { .. }
        | Action::AmendAgreement { .. }
        | Action::ActivateProtectionService { .. } => vec![Requester, Operator, Mediator],
    }
}

pub fn expected_scope(
    proposal: &ActionProposal,
    a: &AssignmentAgreement,
) -> Result<String, String> {
    Ok(match &proposal.action {
        Action::AcknowledgeCompletion { milestone_id, .. } => format!("milestone:{milestone_id}"),
        Action::InvokeArtifactRule { rule_id, .. } => format!(
            "milestone:{}",
            a.policy
                .artifact_rules
                .iter()
                .find(|r| &r.id == rule_id)
                .ok_or_else(|| "UNKNOWN_RULE: not in pinned policy".to_string())?
                .milestone_id
        ),
        Action::AuthorizeExpense { expense_id, .. } => format!("expense:{expense_id}"),
        Action::BilateralSettlement { settlement_id, .. } => format!("settlement:{settlement_id}"),
        Action::PaymentReceipt { payment_id, .. } => format!("payment:{payment_id}"),
        Action::ReconcileReversal {
            payment_certificate_id,
            ..
        } => format!("reversal:{payment_certificate_id}"),
        Action::AmendAgreement { .. } => "terms".into(),
        Action::ActivateProtectionService { commitment_id } => {
            format!("protection:{commitment_id}")
        }
    })
}
pub fn exclusive(action: &Action) -> bool {
    !matches!(
        action,
        Action::AcknowledgeCompletion { .. } | Action::InvokeArtifactRule { .. }
    )
}

pub fn validate_proposal(proposal: &ActionProposal, a: &AssignmentAgreement) -> Result<(), String> {
    ensure(
        proposal.protocol_version == PROTOCOL_VERSION
            && proposal.deployment_domain == a.deployment_domain
            && proposal.assignment_id == a.assignment_id,
        "ACTION_DOMAIN",
        "action belongs to another version/domain/assignment",
    )?;
    ensure(
        proposal.agreement_hash == digest(a)? && proposal.policy_hash == a.policy_hash,
        "ACTION_BINDING",
        "agreement or policy digest mismatch",
    )?;
    validate_id(&proposal.nonce)?;
    validate_id(&proposal.scope_id)?;
    ensure(
        proposal.scope_id == expected_scope(proposal, a)?,
        "ACTION_SCOPE",
        "noncanonical or unauthorized effect scope",
    )?;
    let n = parse_minor_units(&proposal.scope_version)?;
    if matches!(
        proposal.action,
        Action::AmendAgreement { .. } | Action::ActivateProtectionService { .. }
    ) {
        ensure(
            n == parse_minor_units(&a.revision)?,
            "SCOPE_VERSION",
            "amendment/service activation version must equal its Agreement revision",
        )?;
    } else {
        ensure(
            n == 0,
            "SCOPE_VERSION",
            "effects use a stable scope at version 0",
        )?;
    }
    ensure(
        proposal.parent_certificate_ids.len() <= 64
            && proposal
                .parent_certificate_ids
                .contains(&proposal.agreement_hash),
        "ACTION_PARENTS",
        "exact Agreement parent is required",
    )?;
    crate::agreement::unique(proposal.parent_certificate_ids.iter().map(String::as_str))?;
    for hash in &proposal.parent_certificate_ids {
        crate::encoding::validate_digest(hash)?;
    }
    ensure(
        proposal.allocations.len() <= 128,
        "ALLOCATION_BOUNDS",
        "at most 128 signed unit ranges",
    )?;
    if !matches!(
        proposal.action,
        Action::PaymentReceipt { .. }
            | Action::BilateralSettlement { .. }
            | Action::ReconcileReversal { .. }
    ) {
        ensure(
            proposal.allocations.is_empty(),
            "ALLOCATION_SCOPE",
            "this action cannot allocate financial units",
        )?;
    }
    match (&proposal.action, &proposal.cutover) {
        (Action::AmendAgreement { .. }, Some(cutover)) => {
            for list in [
                &cutover.frontier,
                &cutover.preserved_claims,
                &cutover.grandfathered_actions,
            ] {
                ensure(
                    list.len() <= 64,
                    "CUTOVER_BOUNDS",
                    "bounded signed cutover references required",
                )?;
                crate::agreement::unique(list.iter().map(String::as_str))?;
                for hash in list {
                    crate::encoding::validate_digest(hash)?;
                }
            }
            ensure(
                cutover
                    .frontier
                    .iter()
                    .all(|id| proposal.parent_certificate_ids.contains(id)),
                "CUTOVER_FRONTIER",
                "signed frontier must be explicit causal parents",
            )?;
            ensure(
                cutover
                    .preserved_claims
                    .iter()
                    .chain(&cutover.grandfathered_actions)
                    .all(|id| cutover.frontier.contains(id)),
                "CUTOVER_FRONTIER",
                "preserved claims and grandfathered exact actions must be in the observed frontier",
            )?;
        }
        (Action::AmendAgreement { .. }, None) => {
            return Err(
                "CUTOVER_REQUIRED: policy 2 amendment requires an explicit signed frontier".into(),
            );
        }
        (_, Some(_)) => return Err("CUTOVER_SCOPE: only an amendment can define cutover".into()),
        _ => {}
    }
    Ok(())
}

pub fn validate_authorizations(
    cert: &ActionCertificate,
    a: &AssignmentAgreement,
) -> Result<Vec<Role>, String> {
    validate_proposal(&cert.proposal, a)?;
    let roles =
        verify_role_signatures(&cert.authorizations, a, &digest(&cert.proposal)?, "ACTION")?;
    ensure(
        !roles.is_empty(),
        "MISSING_SIGNATURE",
        "an action requires an attributed submitter",
    )?;
    ensure(
        required_authorizers(&cert.proposal.action)
            .iter()
            .all(|r| roles.contains(r)),
        "AUTHORIZATION",
        "missing required scoped party authorization",
    )?;
    Ok(roles)
}

/// Local signers preview exact proposals and reserve the exclusive slot before signing.
/// Candidate semantics and dependencies use the same reducer as the export verifier.
pub fn prepare_action_signature(
    proposal: &ActionProposal,
    bundle: &AssignmentBundle,
    trust: &TrustConfiguration,
    role: Role,
) -> Result<SignatureClaims, String> {
    let report = crate::bundle::verify_assignment_bundle(bundle, trust)?;
    ensure(
        report.agreement.bound,
        "AGREEMENT_UNBOUND",
        "complete retained certificate required",
    )?;
    let a = crate::bundle::known_agreement(bundle, &proposal.agreement_hash, trust)?;
    validate_proposal(proposal, &a)?;
    ensure(
        required_authorizers(&proposal.action).is_empty()
            || required_authorizers(&proposal.action).contains(&role),
        "SIGNING_ROLE",
        "role has no required authority for this operation",
    )?;
    crate::bundle::validate_unsigned_action(proposal, bundle, trust)?;
    Ok(claims(
        &a.deployment_domain,
        &a.assignment_id,
        &digest(proposal)?,
        party(&a, role)?,
        "ACTION",
    ))
}
