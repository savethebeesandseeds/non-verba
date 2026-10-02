// SPDX-License-Identifier: AGPL-3.0-only
//! Authentication-only inspection of immutable protocol-1 records.
//!
//! The withdrawn v1 financial reducer is never called. A legacy inspection
//! preserves independently authenticated statements and authorizations without
//! inventing interval grants, migrating consent, or interpreting absent balances
//! as zero debt. Its financial projection is explicitly unresolved.

use crate::{
    contract::{self, claims_for_version, diagnostic, ensure},
    crypto,
    encoding::{canonical, digest, validate_digest, validate_id},
    model::*,
    money::parse_minor_units,
    transcript::{EventDiagnostic, EventStatus, TranscriptReport},
};
use std::collections::{BTreeMap, BTreeSet};

const LEGACY_VERSION: &str = "1";
const LEGACY_POLICY: &str = "nonverba-three-party-v1";

fn trusted(trust: &TrustConfiguration, role: Role) -> Result<&PartyBinding, String> {
    trust
        .parties
        .iter()
        .find(|party| party.role == role)
        .ok_or_else(|| "LEGACY_KEY_AUTHORITY: independent role binding absent".into())
}

fn request(signed: &SignedRequest, trust: &TrustConfiguration) -> Result<String, String> {
    let value = &signed.request;
    ensure(
        value.protocol_version == LEGACY_VERSION,
        "LEGACY_VERSION",
        "Request is not protocol 1",
    )?;
    ensure(
        value.deployment_domain == trust.deployment_domain,
        "LEGACY_DOMAIN",
        "Request belongs to another deployment",
    )?;
    ensure(
        &value.requester == trusted(trust, Role::Requester)?,
        "LEGACY_KEY_AUTHORITY",
        "Request does not identify the independently pinned Requester",
    )?;
    validate_id(&value.request_id)?;
    ensure(
        parse_minor_units(&value.revision)? > 0,
        "LEGACY_REVISION",
        "Request revision must be positive",
    )?;
    let hash = digest(value)?;
    crypto::verify(
        &signed.authorization,
        &claims_for_version(
            LEGACY_VERSION,
            &value.deployment_domain,
            &value.request_id,
            &hash,
            &value.requester,
            "REQUEST",
        ),
        &value.requester.key,
    )?;
    Ok(hash)
}

fn contract_binding(
    value: &AssignmentContract,
    requests: &[SignedRequest],
    trust: &TrustConfiguration,
) -> Result<(), String> {
    ensure(
        value.protocol_version == LEGACY_VERSION && value.schema_version == LEGACY_VERSION,
        "LEGACY_VERSION",
        "Agreement must retain its protocol-1 schema",
    )?;
    ensure(
        value.policy.id == LEGACY_POLICY
            && value.policy.version == LEGACY_VERSION
            && value.policy_hash == digest(&value.policy)?,
        "LEGACY_POLICY",
        "legacy policy bytes or version differ",
    )?;
    ensure(
        value.deployment_domain == trust.deployment_domain,
        "LEGACY_DOMAIN",
        "Agreement deployment differs from independent trust",
    )?;
    validate_id(&value.assignment_id)?;
    validate_id(&value.request_id)?;
    ensure(
        value.parties.len() == 3,
        "LEGACY_KEY_AUTHORITY",
        "three exact role bindings required",
    )?;
    contract::unique(value.parties.iter().map(|party| party.role.code()))?;
    for party in &value.parties {
        ensure(
            party == trusted(trust, party.role)?,
            "LEGACY_KEY_AUTHORITY",
            "Agreement role differs from independent trust",
        )?;
    }
    let request_record = requests
        .iter()
        .find(|signed| request(signed, trust).ok().as_deref() == Some(value.request_hash.as_str()))
        .ok_or_else(|| {
            "LEGACY_MISSING_REQUEST: exact independently authenticated Request absent".to_owned()
        })?;
    ensure(
        request_record.request.request_id == value.request_id
            && request_record.request.service == value.service,
        "LEGACY_REQUEST_BINDING",
        "Agreement and Request scope differ",
    )?;
    let quote = &value.quote.quote;
    ensure(
        quote.protocol_version == LEGACY_VERSION
            && quote.deployment_domain == trust.deployment_domain
            && quote.request_hash == value.request_hash
            && quote.service_hash == digest(&request_record.request.service)?
            && quote.accepted_terms_hash == digest(&request_record.request.terms)?,
        "LEGACY_QUOTE_BINDING",
        "quote does not bind the exact legacy Request/terms",
    )?;
    ensure(
        &quote.operator == trusted(trust, Role::Operator)?,
        "LEGACY_KEY_AUTHORITY",
        "quote Operator is not independently pinned",
    )?;
    let hash = digest(quote)?;
    crypto::verify(
        &value.quote.authorization,
        &claims_for_version(
            LEGACY_VERSION,
            &value.deployment_domain,
            &value.request_id,
            &hash,
            &quote.operator,
            "QUOTE",
        ),
        &quote.operator.key,
    )
}

fn signers(
    signatures: &[crypto::DetachedSignature],
    value: &AssignmentContract,
    hash: &str,
    purpose: &str,
    diagnostics: &mut Vec<Diagnostic>,
) -> Vec<Role> {
    let mut roles = BTreeSet::new();
    for signature in signatures {
        let Some(party) = value
            .parties
            .iter()
            .find(|party| party.role.code() == signature.claims.role)
        else {
            diagnostics.push(diagnostic(
                hash,
                "LEGACY_KEY_AUTHORITY: unknown signature role",
            ));
            continue;
        };
        match crypto::verify(
            signature,
            &claims_for_version(
                LEGACY_VERSION,
                &value.deployment_domain,
                &value.assignment_id,
                hash,
                party,
                purpose,
            ),
            &party.key,
        ) {
            Ok(()) => {
                roles.insert(party.role);
            }
            Err(error) => diagnostics.push(diagnostic(hash, &error)),
        }
    }
    roles.into_iter().collect()
}

fn required(action: &Action) -> Vec<Role> {
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

fn proposal_binding(proposal: &ActionProposal, basis: &AssignmentContract) -> Result<(), String> {
    ensure(
        proposal.protocol_version == LEGACY_VERSION
            && proposal.allocations.is_empty()
            && proposal.cutover.is_none(),
        "LEGACY_VERSION",
        "legacy records cannot acquire v2 allocations or cutover semantics",
    )?;
    ensure(
        proposal.deployment_domain == basis.deployment_domain
            && proposal.assignment_id == basis.assignment_id
            && proposal.agreement_hash == digest(basis)?
            && proposal.policy_hash == basis.policy_hash,
        "LEGACY_ACTION_BINDING",
        "action context differs from exact legacy Agreement/policy",
    )?;
    validate_id(&proposal.scope_id)?;
    validate_id(&proposal.nonce)?;
    parse_minor_units(&proposal.scope_version)?;
    ensure(
        proposal.parent_certificate_ids.len() <= 64,
        "LEGACY_BOUNDS",
        "too many action references",
    )?;
    for hash in &proposal.parent_certificate_ids {
        validate_digest(hash)?;
    }
    Ok(())
}

/// Inspect exactly supplied v1 bytes. `recognized_legacy_proofs` means the
/// original role authorizations authenticate, not that v2 has re-adjudicated
/// the legacy effects. No numeric balance is manufactured for an old policy.
pub fn inspect(
    bundle: &AssignmentBundle,
    trust: &TrustConfiguration,
) -> Result<BundleReport, String> {
    ensure(
        bundle.protocol_version == LEGACY_VERSION && trust.protocol_version == LEGACY_VERSION,
        "LEGACY_VERSION",
        "legacy inspection requires exact protocol-1 bundle and independent trust",
    )?;
    ensure(
        bundle.deployment_domain == trust.deployment_domain,
        "LEGACY_DOMAIN",
        "bundle deployment differs from independent trust",
    )?;
    ensure(
        canonical(bundle)?.len() <= 4 * 1024 * 1024
            && bundle.actions.len() <= 1000
            && bundle.events.len() <= 1000
            && bundle.requests.len() <= 64
            && bundle.attachments.len() <= 128,
        "LEGACY_BOUNDS",
        "bundle exceeds inspection limits",
    )?;
    contract::validate_trust_bindings(trust)?;
    let root = &bundle.agreement.agreement;
    let root_hash = digest(root)?;
    let mut diagnostics = vec![diagnostic(
        &root_hash,
        "LEGACY_UNRESOLVED: protocol-1 financial aggregation is unsupported; retained signed claims are not zero balances, rejected entitlements, or migrated consent",
    )];
    for signed in &bundle.requests {
        if let Err(error) = request(signed, trust) {
            diagnostics.push(diagnostic(&digest(&signed.request)?, &error));
        }
    }
    let bindings_valid = match contract_binding(root, &bundle.requests, trust) {
        Ok(()) => true,
        Err(error) => {
            diagnostics.push(diagnostic(&root_hash, &error));
            false
        }
    };
    let valid_signers = if bindings_valid {
        signers(
            &bundle.agreement.signatures,
            root,
            &root_hash,
            "AGREEMENT",
            &mut diagnostics,
        )
    } else {
        vec![]
    };
    let bound = bindings_valid
        && valid_signers.len() == 3
        && root.revision == "1"
        && root.previous_agreement_hash.is_none();
    if !bound {
        diagnostics.push(diagnostic(
            &root_hash,
            "LEGACY_UNBOUND: complete authenticated initial R/O/M certificate unavailable",
        ));
    }
    let mut bases = BTreeMap::new();
    if bindings_valid {
        bases.insert(root_hash.clone(), root.clone());
    }
    let mut status = BTreeMap::new();
    let mut proofs = BTreeMap::new();
    let mut pending: BTreeMap<String, ActionCertificate> = BTreeMap::new();
    for certificate in &bundle.actions {
        let id = digest(&certificate.proposal)?;
        if let Some(existing) = pending.get_mut(&id) {
            for signature in &certificate.authorizations {
                if !existing.authorizations.contains(signature) {
                    existing.authorizations.push(signature.clone());
                }
            }
        } else {
            pending.insert(id, certificate.clone());
        }
    }
    loop {
        let mut progress = false;
        for id in pending.keys().cloned().collect::<Vec<_>>() {
            let certificate = &pending[&id];
            let proposal = &certificate.proposal;
            let Some(basis) = bases.get(&proposal.agreement_hash) else {
                continue;
            };
            if let Err(error) = proposal_binding(proposal, basis) {
                diagnostics.push(diagnostic(&id, &error));
                status.insert(id.clone(), "LEGACY_REJECTED_CONTEXT".into());
            } else {
                let authorizers = signers(
                    &certificate.authorizations,
                    basis,
                    &id,
                    "ACTION",
                    &mut diagnostics,
                );
                let complete = !authorizers.is_empty()
                    && required(&proposal.action)
                        .iter()
                        .all(|role| authorizers.contains(role));
                if complete {
                    proofs.insert(
                        id.clone(),
                        LegacyProof {
                            certificate_id: id.clone(),
                            action_kind: proposal.action.kind().into(),
                            authorizers,
                            proposal: proposal.clone(),
                        },
                    );
                    status.insert(id.clone(), "LEGACY_AUTHENTICATED_UNRESOLVED".into());
                    if let Action::AmendAgreement { replacement } = &proposal.action {
                        let binding = contract_binding(replacement, &bundle.requests, trust)
                            .and_then(|()| {
                                ensure(
                                    replacement.assignment_id == root.assignment_id
                                        && replacement.previous_agreement_hash.as_deref()
                                            == Some(proposal.agreement_hash.as_str()),
                                    "LEGACY_AMENDMENT_BINDING",
                                    "replacement lacks exact legacy parent/Assignment",
                                )
                            });
                        match binding {
                            Ok(()) => {
                                bases.insert(
                                    digest(replacement.as_ref())?,
                                    replacement.as_ref().clone(),
                                );
                            }
                            Err(error) => diagnostics.push(diagnostic(&id, &error)),
                        }
                    }
                } else {
                    status.insert(id.clone(), "LEGACY_PARTIAL_AUTHORIZATION".into());
                    diagnostics.push(diagnostic(&id, "LEGACY_MISSING_SIGNATURE: preserve partial authorization; no financial interpretation"));
                }
            }
            pending.remove(&id);
            progress = true;
        }
        if !progress {
            break;
        }
    }
    for id in pending.keys() {
        status.insert(id.clone(), "LEGACY_MISSING_AGREEMENT".into());
        diagnostics.push(diagnostic(id, "LEGACY_MISSING_AGREEMENT: signed authorization basis unavailable; preserve original record"));
    }
    let mut transcript = TranscriptReport::default();
    for event in &bundle.events {
        let envelope = &event.envelope;
        let hash = digest(envelope)?;
        if transcript.retained_events.contains_key(&hash) {
            transcript.duplicate_count += 1;
            continue;
        }
        let checked = (|| {
            ensure(
                envelope.protocol_version == LEGACY_VERSION
                    && envelope.deployment_domain == trust.deployment_domain
                    && envelope.assignment_id == root.assignment_id
                    && bases.contains_key(&envelope.agreement_hash),
                "LEGACY_EVENT_CONTEXT",
                "event does not reference an authenticated legacy Agreement",
            )?;
            let party = trust
                .parties
                .iter()
                .find(|party| {
                    party.role.code() == envelope.author_role && party.key.key_id == envelope.key_id
                })
                .ok_or_else(|| {
                    "LEGACY_KEY_AUTHORITY: event key is not independently pinned".to_owned()
                })?;
            crypto::verify(
                &event.authorization,
                &claims_for_version(
                    LEGACY_VERSION,
                    &envelope.deployment_domain,
                    &envelope.assignment_id,
                    &hash,
                    party,
                    "EVENT",
                ),
                &party.key,
            )
        })();
        match checked {
            Ok(()) => {
                transcript
                    .retained_events
                    .insert(hash.clone(), event.clone());
                transcript.event_status.insert(
                    hash,
                    EventStatus {
                        signature_valid: true,
                        policy_valid: false,
                        causal_complete: false,
                        status: "LEGACY_AUTHENTICATED_UNINTERPRETED".into(),
                    },
                );
            }
            Err(error) => {
                let detail = diagnostic(&hash, &error);
                transcript.rejected.push(EventDiagnostic {
                    event_hash: hash,
                    code: detail.code,
                    message: detail.message,
                    missing_references: vec![],
                });
            }
        }
    }
    let recognized_legacy_proofs: Vec<_> = proofs.into_values().collect();
    let unresolved_claims = recognized_legacy_proofs
        .iter()
        .map(|proof| proof.certificate_id.clone())
        .collect();
    Ok(BundleReport {
        financial_projection: "LEGACY_UNRESOLVED".into(), recognized_legacy_proofs, unresolved_rights: vec![], evidence_integrity: vec![],
        agreement: ContractResult { agreement_hash: root_hash.clone(), bound, valid_signers, diagnostics: diagnostics.clone() },
        current_agreement_hash: root_hash, ready_to_start: false,
        readiness_reasons: vec!["Legacy authentication is not current-policy readiness; no automatic migration or renewed consent".into()],
        performance: "LEGACY_UNRESOLVED".into(), mediation: "LEGACY_UNRESOLVED".into(), assurance: "LEGACY_UNRESOLVED".into(),
        obligations: vec![], effects: vec![], payments: vec![], diagnostics, action_status: status, transcript, unresolved_claims,
        history_completeness: "UNKNOWN: legacy inspection preserves supplied authenticated records and does not establish complete/latest history".into(),
        assumptions: vec!["Independent original role-key bindings are required; signatures preserve exact legacy authorizations".into(),
            "No protocol-1 aggregate balance, zero debt, new grant, revocation, migration, physical truth or payment finality is inferred".into()],
    })
}
